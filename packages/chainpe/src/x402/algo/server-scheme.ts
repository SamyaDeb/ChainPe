/**
 * ALGO Native x402 Server Scheme
 * 
 * Implements x402 payment scheme for native ALGO payments (not ASA/USDC).
 * Handles pricing in microALGO and payment requirement enhancement.
 */

import type { Price, Network, AssetAmount, PaymentRequirements } from "@x402-avm/core/types";
import { ALGO_DECIMALS } from "../../types.js";

/**
 * ALGO Native Server Scheme
 * Uses native ALGO payment transactions instead of asset transfers
 */
export class AlgoNativeServerScheme {
  readonly scheme = "algo-exact";

  /**
   * Parse a price into microALGO amount
   * 
   * The price from routes config is already in microALGO (Money type).
   * We just need to wrap it in an AssetAmount structure.
   * 
   * @param price - Price in microALGO (Money type string/number) or AssetAmount
   * @param network - Network identifier (unused, ALGO is same on all networks)
   * @returns Asset amount with microALGO
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    void network; // ALGO pricing doesn't vary by network
    
    let amount: string;
    
    if (typeof price === "string" || typeof price === "number") {
      // Money type - already in microALGO from routes config
      amount = String(price);
    } else {
      // Already an AssetAmount - validate and return
      if (price.asset !== "ALGO") {
        throw new Error(`Invalid asset for algo-exact scheme: ${price.asset}`);
      }
      amount = price.amount;
    }

    return {
      amount,
      asset: "ALGO",
      extra: {
        decimals: ALGO_DECIMALS,
        tokenName: "ALGO",
      },
    };
  }

  /**
   * Enhance payment requirements with scheme-specific data
   * 
   * @param paymentRequirements - Base requirements
   * @param supportedKind - Supported kind from facilitator
   * @param facilitatorExtensions - Extensions supported by facilitator
   * @returns Enhanced payment requirements
   */
  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    facilitatorExtensions: string[]
  ): Promise<PaymentRequirements> {
    void facilitatorExtensions; // Not using extensions for basic ALGO payments

    // Add ALGO-specific metadata
    const enhanced: PaymentRequirements = {
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        decimals: ALGO_DECIMALS,
        tokenName: "ALGO",
        ...(supportedKind.extra?.feePayer ? { feePayer: supportedKind.extra.feePayer } : {}),
      },
    };

    return enhanced;
  }

  /**
   * Convert user-friendly amount to microALGO
   * 
   * @param price - Price as string or number (e.g., "0.01" or 0.01)
   * @returns Amount in microALGO as string
   */
  private convertToMicroAlgo(price: string | number): string {
    const priceStr = typeof price === "number" ? price.toString() : price;
    
    // Remove $ if present
    const cleanPrice = priceStr.replace(/^\$/, "").trim();
    
    // Parse as float
    const amount = parseFloat(cleanPrice);
    if (isNaN(amount) || amount < 0) {
      throw new Error(`Invalid ALGO price: ${price}`);
    }

    // Convert to microALGO (1 ALGO = 1,000,000 microALGO)
    const parts = cleanPrice.split(".");
    const whole = BigInt(parts[0] || "0");
    const fractionStr = (parts[1] || "").padEnd(ALGO_DECIMALS, "0").slice(0, ALGO_DECIMALS);
    const fraction = BigInt(fractionStr);
    
    const microAlgo = whole * BigInt(10 ** ALGO_DECIMALS) + fraction;
    return microAlgo.toString();
  }
}
