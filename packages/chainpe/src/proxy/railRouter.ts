/**
 * Sends each payment to the facilitator of its rail.
 *
 * x402ResourceServer picks a facilitator by (version, network, scheme). Circle's
 * Facilitator and Gateway both publish `exact` on Arc, so it can only reach the
 * first of them. The rails differ by `extra.name`, which this router reads.
 * See docs/arc/specs/03a-gateway-design.md.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { isBatchPayment } from "@circle-fin/x402-batching/server";
import { logger } from "../logger.js";
import { failure } from "./circleFacilitator.js";

const RAIL_NOT_ENABLED = "rail_not_enabled";

export interface Rails {
  exact?: FacilitatorClient;
  gateway?: FacilitatorClient;
}

export class RailRouter implements FacilitatorClient {
  constructor(private readonly rails: Rails) {}

  private railFor(requirements: PaymentRequirements): FacilitatorClient | undefined {
    return isBatchPayment(requirements) ? this.rails.gateway : this.rails.exact;
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const rail = this.railFor(requirements);
    if (!rail) return { isValid: false, invalidReason: RAIL_NOT_ENABLED };
    return rail.verify(payload, requirements);
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const rail = this.railFor(requirements);
    if (!rail) return failure(requirements, RAIL_NOT_ENABLED);
    return rail.settle(payload, requirements);
  }

  /** One rail being down must not take the other with it. */
  async getSupported(): Promise<SupportedResponse> {
    const rails = Object.values(this.rails).filter(Boolean) as FacilitatorClient[];
    const results = await Promise.allSettled(rails.map(async (rail) => rail.getSupported()));

    const merged: SupportedResponse = { kinds: [], extensions: [], signers: {} };
    let lastError: unknown;
    let answered = false;
    for (const result of results) {
      if (result.status === "rejected") {
        lastError = result.reason;
        logger.warn(`A payment rail did not report its capabilities: ${(result.reason as Error).message}`);
        continue;
      }
      answered = true;
      merged.kinds.push(...result.value.kinds);
      merged.extensions = [...new Set([...merged.extensions, ...result.value.extensions])];
      for (const [network, signers] of Object.entries(result.value.signers)) {
        merged.signers[network] = [...new Set([...(merged.signers[network] ?? []), ...signers])];
      }
    }
    if (!answered) throw lastError;
    return merged;
  }
}
