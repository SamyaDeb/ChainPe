/**
 * Settlement through Circle Gateway (batched nanopayments).
 *
 * A successful Gateway settle means the payment was accepted: the buyer's funds
 * are locked and queued for an on-chain batch. `/verify` proves nothing about
 * funds, so settle is the only check that counts. `GatewayGuard` makes sure the
 * pipeline forwards only on that success, and at most once per signed payment.
 */
import { getAddress } from "viem";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { BatchFacilitatorClient, isBatchPayment } from "@circle-fin/x402-batching/server";
import { getNetwork, type ChainPeNetwork } from "../chains.js";
import { logger } from "../logger.js";
import { failure, paymentIdentifierFor } from "./circleFacilitator.js";

const NONCE_ALREADY_USED = "nonce_already_used";
const GATEWAY_UNAVAILABLE = "gateway_unavailable";
const GATEWAY_NOT_FINAL = "gateway_not_final";
/** Gateway's answer to a server error: the payment may or may not have been accepted. */
const UNEXPECTED_ERROR = "unexpected_error";
const MAX_TRACKED_PAYMENTS = 50_000;
const MAX_UNCERTAIN_PAYMENTS = 10_000;
const LOOKUP_TIMEOUT_MS = 5_000;

/** What a buyer needs to sign a Gateway payment. */
export interface GatewayTerms {
  name: string;
  version: string;
  verifyingContract: string;
}

export interface GatewayTransfer {
  id: string;
  status: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  nonce: string;
}

export type TransferLookup = (nonce: string, network: string) => Promise<GatewayTransfer[]>;

export interface GatewayGuardOptions {
  settleTimeoutMs?: number;
  /** How long a payment with an unknown outcome can still be recovered by a retry. */
  uncertainTtlMs?: number;
}

export class GatewayGuard implements FacilitatorClient {
  private readonly settleTimeoutMs: number;
  private readonly uncertainTtlMs: number;
  /** Payments being settled or already delivered, oldest first. */
  private readonly tracked = new Map<string, "settling" | "delivered">();
  /** Payments Gateway may have accepted without us seeing the answer, oldest first. */
  private readonly uncertain = new Map<string, number>();

  constructor(
    private readonly client: FacilitatorClient,
    private readonly lookup: TransferLookup,
    options: GatewayGuardOptions = {}
  ) {
    this.settleTimeoutMs = options.settleTimeoutMs ?? 15_000;
    this.uncertainTtlMs = options.uncertainTtlMs ?? 3_600_000;
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.client.verify(payload, requirements);
  }

  getSupported() {
    return this.client.getSupported();
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const id = paymentIdentifierFor(payload);

    const state = this.tracked.get(id);
    if (state) {
      return failure(requirements, state === "delivered" ? "payment_already_used" : "payment_in_progress");
    }
    if (this.tracked.size >= MAX_TRACKED_PAYMENTS) {
      this.tracked.delete(this.tracked.keys().next().value as string);
    }
    this.tracked.set(id, "settling");
    this.dropExpiredUncertain();

    const result = await this.settleOnce(id, payload, requirements);
    if (result.success) {
      this.tracked.set(id, "delivered");
      this.uncertain.delete(id);
    } else {
      this.tracked.delete(id);
    }
    return result;
  }

  private async settleOnce(
    id: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    let result: SettleResponse;
    try {
      result = await this.settleWithTimeout(payload, requirements);
    } catch (err) {
      logger.error(`Could not reach Circle Gateway: ${(err as Error).message}`);
      this.rememberUncertain(id);
      return failure(requirements, GATEWAY_UNAVAILABLE);
    }

    if (result.success) {
      if (result.transaction) return result;
      logger.error("Circle Gateway reported success without a transfer id");
      this.rememberUncertain(id);
      return failure(requirements, GATEWAY_NOT_FINAL);
    }

    if (result.errorReason === UNEXPECTED_ERROR) {
      this.rememberUncertain(id);
    } else if (result.errorReason === NONCE_ALREADY_USED && this.uncertain.has(id)) {
      return this.recover(id, payload, requirements);
    } else {
      this.uncertain.delete(id);
    }
    return {
      ...failure(requirements, result.errorReason ?? "gateway_rejected", result.errorMessage),
      payer: result.payer,
    };
  }

  /**
   * Our earlier attempt may have been the one that used this nonce. Delivers only
   * if Gateway holds that exact transfer. Limited to payments we saw go uncertain:
   * for any other id this would turn a replay into a free backend call.
   */
  private async recover(
    id: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const { from, nonce } = (payload.payload as { authorization: { from: string; nonce: string } }).authorization;

    let transfers: GatewayTransfer[];
    try {
      transfers = await this.lookup(nonce, requirements.network);
    } catch (err) {
      logger.warn(`Gateway transfer lookup failed: ${(err as Error).message}`);
      return failure(requirements, GATEWAY_UNAVAILABLE);
    }

    const transfer = transfers.find(
      (t) =>
        t.nonce === nonce &&
        t.amount === requirements.amount &&
        sameAddress(t.fromAddress, from) &&
        sameAddress(t.toAddress, requirements.payTo)
    );
    if (!transfer) return failure(requirements, NONCE_ALREADY_USED);
    if (transfer.status === "failed") {
      this.uncertain.delete(id);
      return failure(requirements, "settlement_failed");
    }
    return {
      success: true,
      transaction: transfer.id,
      network: requirements.network,
      payer: transfer.fromAddress,
      amount: requirements.amount,
    };
  }

  private async settleWithTimeout(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer after ${this.settleTimeoutMs} ms`)), this.settleTimeoutMs);
    });
    try {
      return await Promise.race([this.client.settle(payload, requirements), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private rememberUncertain(id: string): void {
    if (this.uncertain.has(id)) return;
    if (this.uncertain.size >= MAX_UNCERTAIN_PAYMENTS) {
      this.uncertain.delete(this.uncertain.keys().next().value as string);
    }
    this.uncertain.set(id, Date.now());
  }

  private dropExpiredUncertain(): void {
    const cutoff = Date.now() - this.uncertainTtlMs;
    for (const [id, firstSeen] of this.uncertain) {
      if (firstSeen > cutoff) return;
      this.uncertain.delete(id);
    }
  }
}

function sameAddress(a: string, b: string): boolean {
  return getAddress(a) === getAddress(b);
}

/** Reads the terms for USDC on this network from Gateway's supported kinds. */
export async function gatewayTerms(
  client: Pick<FacilitatorClient, "getSupported">,
  caip2: string,
  usdc: string
): Promise<GatewayTerms> {
  const { kinds } = await client.getSupported();
  const kind = kinds.find((k) => k.x402Version === 2 && k.network === caip2 && isBatchPayment(k));
  const extra = kind?.extra as
    | { name: string; version: string; verifyingContract?: string; assets?: Array<{ address: string; authorizationVersions?: string[] }> }
    | undefined;
  if (!extra?.verifyingContract) {
    throw new Error(`Circle Gateway does not support batched payments on ${caip2}.`);
  }

  const asset = extra.assets?.find((a) => a.address.toLowerCase() === usdc.toLowerCase());
  if (extra.assets && !asset) {
    throw new Error(`Circle Gateway does not accept USDC (${usdc}) on ${caip2}.`);
  }
  // The lowest version keeps buyers on older SDK releases able to pay.
  const [version = extra.version] = [...(asset?.authorizationVersions ?? [])].sort((a, b) => Number(a) - Number(b));
  return { name: extra.name, version, verifyingContract: extra.verifyingContract };
}

function transferLookup(baseUrl: string): TransferLookup {
  return async (nonce, network) => {
    const res = await fetch(`${baseUrl}/v1/x402/transfers?nonce=${nonce}&network=${network}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return ((await res.json()) as { transfers: GatewayTransfer[] }).transfers;
  };
}

/** Builds the Gateway rail. Fails if Gateway cannot serve this network right now. */
export async function createGateway(
  network: ChainPeNetwork,
  url = process.env.CIRCLE_GATEWAY_URL
): Promise<{ guard: GatewayGuard; terms: GatewayTerms }> {
  const info = getNetwork(network);
  const batch = new BatchFacilitatorClient({ url: url ?? info.gatewayUrl });
  const client = batch as unknown as FacilitatorClient;
  const terms = await gatewayTerms(client, info.caip2, info.usdc).catch((err: Error) => {
    throw new Error(`Circle Gateway is not available at ${batch.url}: ${err.message.replace(/\.$/, "")}. Use --rails exact to run without it.`);
  });
  return { guard: new GatewayGuard(client, transferLookup(batch.url)), terms };
}
