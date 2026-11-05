/**
 * Settlement through Circle's Facilitator Service.
 *
 * `SettlementGuard` wraps Circle's client so that the x402 pipeline only ever
 * sees a final outcome: `success: true` means the payment completed on-chain.
 * It polls pending settlements, tags each settle with a payment-identifier, maps
 * Circle's API errors to failed settlements, and refuses to deliver the same
 * payment twice.
 */
import { createHash } from "node:crypto";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  CircleFacilitatorClient,
  FacilitatorApiError,
  isSettlementPending,
  type FacilitatorPaymentStatus,
} from "@circle-fin/x402-batching/server";
import type { ChainPeConfig } from "../types.js";
import { logger } from "../logger.js";

export type FacilitatorMode = "circle-keyless" | "circle-key";

export const REGISTRATION_REQUIRED_MESSAGE =
  "Circle keyless trial used up for this payout wallet — set CIRCLE_API_KEY";

const PAYMENT_IDENTIFIER = "payment-identifier";
const SETTLEMENT_STATUS = "settlement-status";
const INVALID_TRANSACTION_STATE = "invalid_transaction_state";
const MAX_TRACKED_PAYMENTS = 50_000;
const MAX_PENDING_PAYMENTS = 10_000;

export function facilitatorMode(apiKey = process.env.CIRCLE_API_KEY): FacilitatorMode {
  return apiKey ? "circle-key" : "circle-keyless";
}

/** Loads the seller key and checks that it controls the payout wallet. */
export function resolveSellerSigner(
  walletAddress: string,
  key = process.env.CHAINPE_SELLER_PRIVATE_KEY
): PrivateKeyAccount {
  return privateKeyToAccount(resolveSellerKey(walletAddress, key));
}

/** The seller key, checked against the payout wallet. Never log the result. */
export function resolveSellerKey(walletAddress: string, key = process.env.CHAINPE_SELLER_PRIVATE_KEY): Hex {
  if (!key) {
    throw new Error("CHAINPE_SELLER_PRIVATE_KEY is not set (the key of your payout wallet).");
  }
  const hex = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount(hex);
  } catch {
    throw new Error("CHAINPE_SELLER_PRIVATE_KEY is not a valid private key.");
  }
  if (getAddress(account.address) !== getAddress(walletAddress)) {
    throw new Error(
      `Seller key address ${account.address} does not match walletAddress ${walletAddress}. ` +
        "Circle only settles to a payTo the seller key controls."
    );
  }
  return hex;
}

/** Stable id for one signed payment, so a retry of it reuses the same id. */
export function paymentIdentifierFor(payload: Pick<PaymentPayload, "payload">): string {
  const digest = createHash("sha256").update(JSON.stringify(payload.payload)).digest("hex");
  return `chainpe_${digest.slice(0, 48)}`;
}

/** The parts of Circle's client that the guard uses. */
export type CircleClient = FacilitatorClient & {
  getStatus(paymentId: string, options?: { network?: string }): Promise<FacilitatorPaymentStatus>;
};

export interface SettlementGuardOptions {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** How long a payment that outlasted polling can still be resolved by a retry. */
  pendingTtlMs?: number;
}

/** A payment Circle accepted but had not finished when polling gave up. */
interface PendingPayment {
  paymentId: string;
  network: string;
  firstSeen: number;
  /** Circle's pending answer, returned again while the payment stays pending. */
  response: SettleResponse;
}

export class SettlementGuard implements FacilitatorClient {
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly pendingTtlMs: number;
  /** Payments being settled or already delivered, oldest first. */
  private readonly tracked = new Map<string, "settling" | "delivered">();
  /** Payments Circle may still complete, oldest first. A retry must not settle these again. */
  private readonly pending = new Map<string, PendingPayment>();

  constructor(
    private readonly client: CircleClient,
    options: SettlementGuardOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 20_000;
    this.pendingTtlMs = options.pendingTtlMs ?? 3_600_000;
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.client.verify(payload, requirements);
  }

  getSupported() {
    return this.client.getSupported();
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const id = paymentIdentifierFor(payload);

    // Circle rejects a replay of a completed payment (invalid_transaction_state).
    // This check answers duplicates locally and covers concurrent ones, where
    // the first settle has not finished yet.
    const state = this.tracked.get(id);
    if (state) {
      const reason = state === "delivered" ? "payment_already_used" : "payment_in_progress";
      return failure(requirements, reason);
    }
    this.track(id, "settling");

    // A retry of a pending payment asks Circle for the outcome. Settling it again
    // would be refused once Circle completes it, leaving the buyer paid but unserved.
    this.dropExpiredPending();
    const known = this.pending.get(id);
    const result = known
      ? await this.checkPending(known, requirements)
      : await this.settleToCompletion(id, payload, requirements);

    if (result.success) this.tracked.set(id, "delivered");
    else this.tracked.delete(id);
    if (!isPending(result)) this.pending.delete(id);
    return result;
  }

  private track(id: string, state: "settling"): void {
    if (this.tracked.size >= MAX_TRACKED_PAYMENTS) {
      this.tracked.delete(this.tracked.keys().next().value as string);
    }
    this.tracked.set(id, state);
  }

  private rememberPending(id: string, paymentId: string, response: SettleResponse): void {
    if (this.pending.size >= MAX_PENDING_PAYMENTS) {
      this.pending.delete(this.pending.keys().next().value as string);
    }
    this.pending.set(id, { paymentId, network: response.network, firstSeen: Date.now(), response });
  }

  private dropExpiredPending(): void {
    const cutoff = Date.now() - this.pendingTtlMs;
    for (const [id, payment] of this.pending) {
      if (payment.firstSeen > cutoff) return;
      logger.warn(`Gave up on pending payment ${payment.paymentId}: no final status after ${this.pendingTtlMs} ms`);
      this.pending.delete(id);
    }
  }

  /** One status lookup for a retry; an unreachable Circle leaves the payment pending. */
  private async checkPending(known: PendingPayment, requirements: PaymentRequirements): Promise<SettleResponse> {
    try {
      const status = await this.client.getStatus(known.paymentId, { network: known.network });
      return finalResult(status, known.response, requirements) ?? known.response;
    } catch (err) {
      logger.warn(`Status check for payment ${known.paymentId} failed: ${(err as Error).message}`);
      return known.response;
    }
  }

  private async settleToCompletion(
    id: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const tagged: PaymentPayload = {
      ...payload,
      extensions: { ...payload.extensions, [PAYMENT_IDENTIFIER]: { info: { required: false, id } } },
    };

    let result: SettleResponse;
    try {
      result = await this.client.settle(tagged, requirements);
    } catch (err) {
      const known = this.pending.get(id);
      if (known && err instanceof FacilitatorApiError && err.reason === INVALID_TRANSACTION_STATE) {
        return this.checkPending(known, requirements);
      }
      return fromSettleError(err, requirements);
    }
    if (!isPending(result)) return result;

    const status = result.extensions?.[SETTLEMENT_STATUS] as { paymentId?: string } | undefined;
    if (!status?.paymentId) {
      logger.error("Circle reported settlement_pending without a paymentId");
      return result;
    }
    this.rememberPending(id, status.paymentId, result);
    return this.pollUntilFinal(status.paymentId, result, requirements);
  }

  private async pollUntilFinal(
    paymentId: string,
    pending: SettleResponse,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      let status: FacilitatorPaymentStatus;
      try {
        status = await this.client.getStatus(paymentId, { network: requirements.network });
      } catch (err) {
        logger.warn(`Status check for payment ${paymentId} failed: ${(err as Error).message}`);
        continue;
      }

      const final = finalResult(status, pending, requirements);
      if (final) return final;
    }

    logger.warn(`Settlement still pending after ${this.pollTimeoutMs} ms, paymentId ${paymentId}`);
    return pending;
  }
}

function isPending(result: SettleResponse): boolean {
  return isSettlementPending(result as Parameters<typeof isSettlementPending>[0]);
}

/** The settle response for a final status; undefined while Circle is still working. */
function finalResult(
  status: FacilitatorPaymentStatus,
  pending: SettleResponse,
  requirements: PaymentRequirements
): SettleResponse | undefined {
  if (status.status === "completed") {
    return {
      success: true,
      transaction: status.transaction ?? "",
      network: requirements.network,
      payer: status.payer ?? pending.payer,
      amount: status.amount,
      extensions: pending.extensions,
    };
  }
  if (status.status === "failed") {
    return {
      ...failure(requirements, status.reason ?? "settlement_failed"),
      payer: status.payer ?? pending.payer,
      extensions: pending.extensions,
    };
  }
  return undefined;
}

export function failure(requirements: PaymentRequirements, errorReason: string, errorMessage?: string): SettleResponse {
  return {
    success: false,
    errorReason,
    errorMessage: errorMessage ?? errorReason,
    transaction: "",
    network: requirements.network,
  };
}

function fromSettleError(err: unknown, requirements: PaymentRequirements): SettleResponse {
  if (err instanceof FacilitatorApiError) {
    if (err.reason === "registration_required") {
      logger.error(REGISTRATION_REQUIRED_MESSAGE);
      return failure(requirements, "registration_required", REGISTRATION_REQUIRED_MESSAGE);
    }
    logger.error(`Circle rejected the settlement: ${err.status} ${err.reason ?? err.message}`);
    return failure(requirements, err.reason ?? "facilitator_error");
  }
  logger.error(`Could not reach Circle: ${(err as Error).message}`);
  return failure(requirements, "facilitator_unavailable");
}

export interface CircleFacilitatorOptions {
  /** Overrides CIRCLE_FACILITATOR_URL. */
  url?: string;
  sellerKey?: string;
  apiKey?: string;
}

export function createCircleFacilitator(
  config: Pick<ChainPeConfig, "walletAddress">,
  options: CircleFacilitatorOptions = {}
): SettlementGuard {
  const client = new CircleFacilitatorClient({
    sellerSigner: resolveSellerSigner(config.walletAddress, options.sellerKey),
    apiKey: options.apiKey ?? process.env.CIRCLE_API_KEY,
    url: options.url ?? process.env.CIRCLE_FACILITATOR_URL,
  });
  return new SettlementGuard(client as unknown as CircleClient);
}

/** Fails fast when the facilitator cannot settle `exact` on this network. */
export async function assertExactSupported(facilitator: FacilitatorClient, caip2: string): Promise<void> {
  const { kinds } = await facilitator.getSupported();
  if (!kinds.some((k) => k.scheme === "exact" && k.network === caip2)) {
    throw new Error(`Facilitator does not support exact payments on ${caip2}.`);
  }
}
