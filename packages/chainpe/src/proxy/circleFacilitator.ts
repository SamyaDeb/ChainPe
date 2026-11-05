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
const MAX_TRACKED_PAYMENTS = 50_000;

export function facilitatorMode(apiKey = process.env.CIRCLE_API_KEY): FacilitatorMode {
  return apiKey ? "circle-key" : "circle-keyless";
}

/** Loads the seller key and checks that it controls the payout wallet. */
export function resolveSellerSigner(
  walletAddress: string,
  key = process.env.CHAINPE_SELLER_PRIVATE_KEY
): PrivateKeyAccount {
  if (!key) {
    throw new Error("CHAINPE_SELLER_PRIVATE_KEY is not set (the key of your payout wallet).");
  }
  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  } catch {
    throw new Error("CHAINPE_SELLER_PRIVATE_KEY is not a valid private key.");
  }
  if (getAddress(account.address) !== getAddress(walletAddress)) {
    throw new Error(
      `Seller key address ${account.address} does not match walletAddress ${walletAddress}. ` +
        "Circle only settles to a payTo the seller key controls."
    );
  }
  return account;
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
}

export class SettlementGuard implements FacilitatorClient {
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  /** Payments being settled or already delivered, oldest first. */
  private readonly tracked = new Map<string, "settling" | "delivered">();

  constructor(
    private readonly client: CircleClient,
    options: SettlementGuardOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 20_000;
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

    const result = await this.settleToCompletion(id, payload, requirements);
    if (result.success) this.tracked.set(id, "delivered");
    else this.tracked.delete(id);
    return result;
  }

  private track(id: string, state: "settling"): void {
    if (this.tracked.size >= MAX_TRACKED_PAYMENTS) {
      this.tracked.delete(this.tracked.keys().next().value as string);
    }
    this.tracked.set(id, state);
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
      return fromSettleError(err, requirements);
    }
    if (!isSettlementPending(result as Parameters<typeof isSettlementPending>[0])) return result;

    const status = result.extensions?.[SETTLEMENT_STATUS] as { paymentId?: string } | undefined;
    if (!status?.paymentId) {
      logger.error("Circle reported settlement_pending without a paymentId");
      return result;
    }
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
    }

    logger.warn(`Settlement still pending after ${this.pollTimeoutMs} ms, paymentId ${paymentId}`);
    return pending;
  }
}

function failure(requirements: PaymentRequirements, errorReason: string, errorMessage?: string): SettleResponse {
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
