/**
 * Route Configuration
 * Defines x402 payment requirements for protected routes
 */

import type { Network } from "@x402-avm/core/types";
import type { RoutesConfig } from "@x402-avm/core/server";
import type {
  ChainPeConfig,
  PaymentToken,
  RouteConfig as ChainPeRouteConfig,
} from "../types.js";
import {
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
  USDC_TESTNET_ASA_ID,
  USDC_MAINNET_ASA_ID,
  ALGO_DECIMALS,
  USDC_DECIMALS,
} from "../types.js";

// Re-export RoutesConfig type
export type { RoutesConfig };

/**
 * x402-avm Price types:
 * - Money = string | number (for native currency, represents smallest unit e.g. microALGO)
 * - AssetAmount = { asset: string; amount: string; extra?: Record<string, unknown> }
 * 
 * PaymentOption uses Price which is Money | AssetAmount
 * 
 * For Algorand:
 * - ALGO: Use Money (string) - amount in microALGO
 * - USDC: Use AssetAmount - { asset: "USDC", amount: "...", extra: { assetId: ... } }
 */

/**
 * Parses human-readable amount to microunits string
 */
function parseAmount(amount: string, decimals: number = 6): string {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fractionStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const fraction = BigInt(fractionStr);
  return (whole * BigInt(10 ** decimals) + fraction).toString();
}

/**
 * Gets the price in the x402-avm format
 * For ALGO: string (microALGO)
 * For USDC: AssetAmount object
 */
function getPrice(
  amount: string,
  token: PaymentToken,
  network: "testnet" | "mainnet"
): string | { asset: string; amount: string; extra?: Record<string, unknown> } {
  const decimals = token === "USDC" ? USDC_DECIMALS : ALGO_DECIMALS;
  const amountInMicrounits = parseAmount(amount, decimals);

  if (token === "ALGO") {
    // Native ALGO uses Money type (string)
    return amountInMicrounits;
  }

  // USDC uses AssetAmount type. The `asset` field MUST be the numeric ASA ID,
  // not the "USDC" label: the @x402-avm facilitator verifies a payment by
  // strict-comparing the on-chain assetId (e.g. "10458941") against
  // requirements.asset. A label like "USDC" never matches, so verify/settle
  // would always fail with ASSET_MISMATCH.
  const asaId = network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID;
  return {
    asset: String(asaId),
    amount: amountInMicrounits,
    extra: {
      name: "USDC",
      assetId: asaId,
      decimals: decimals,
    },
  };
}

/**
 * Internal type for route display
 */
interface RouteDisplayInfo {
  path: string;
  price: string;
  token: string;
  decimals: number;
}

/**
 * Creates a routes map for the x402 middleware
 */
export function createRoutesConfig(
  config: ChainPeConfig,
  additionalRoutes?: ChainPeRouteConfig[]
): RoutesConfig {
  const routes: Record<string, {
    accepts: {
      scheme: string;
      payTo: string;
      price: string | { asset: string; amount: string; extra?: Record<string, unknown> };
      network: Network;
      maxTimeoutSeconds?: number;
      extra?: Record<string, unknown>;
    };
    description?: string;
    resource?: string;
    mimeType?: string;
  }> = {};

  const buildRoute = (priceStr: string, tokenStr: PaymentToken, description?: string) => {
    const network = config.network;
    const networkId: Network =
      network === "testnet"
        ? ALGORAND_TESTNET_CAIP2
        : ALGORAND_MAINNET_CAIP2;

    const priceValue = getPrice(priceStr, tokenStr, network);
    
    // Get ASA ID for USDC
    const asaId = tokenStr === "USDC"
      ? (network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID)
      : undefined;

    // Use algo-exact scheme for ALGO, exact scheme for USDC/ASA
    const scheme = tokenStr === "ALGO" ? "algo-exact" : "exact";
    
    return {
      accepts: {
        scheme,
        payTo: config.walletAddress,
        price: priceValue,
        network: networkId,
        maxTimeoutSeconds: 300,
        ...(tokenStr === "USDC" && asaId ? {
          extra: {
            assetId: asaId,
            assetDecimals: USDC_DECIMALS,
          }
        } : {}),
      },
      description: description || `Pay ${priceStr} ${tokenStr} per request`,
      resource: config.targetUrl,
      mimeType: "application/json",
    };
  };

  // Add custom routes first (more specific)
  if (additionalRoutes) {
    for (const route of additionalRoutes) {
      routes[route.path] = buildRoute(
        route.pricePerRequest || config.pricePerRequest,
        route.paymentToken || config.paymentToken,
        route.description
      );
    }
  }

  // Add catch-all route - use /* pattern (not /(.*) which gets escaped)
  routes["/*"] = buildRoute(config.pricePerRequest, config.paymentToken);

  return routes as RoutesConfig;
}

/**
 * Formats routes for display in the CLI
 */
export function formatRoutesForDisplay(
  routes: RoutesConfig
): RouteDisplayInfo[] {
  // Handle both single RouteConfig and Record<string, RouteConfig>
  if (!routes || typeof routes !== "object") {
    return [];
  }

  // Check if it's a single RouteConfig (has 'accepts' directly)
  if ("accepts" in routes) {
    return [];
  }

  // It's a Record<string, RouteConfig>
  const routesMap = routes as Record<string, { accepts: unknown }>;

  return Object.entries(routesMap).map(([path, config]) => {
    const accepts = config.accepts;
    const option = Array.isArray(accepts) ? accepts[0] : accepts;

    // Extract price info - can be string/number (ALGO) or AssetAmount (USDC)
    let amount: string;
    let decimals: number;
    let token: string;

    const price = (option as { price?: unknown }).price;

    if (typeof price === "string" || typeof price === "number") {
      // ALGO - Money type
      amount = String(price);
      decimals = ALGO_DECIMALS;
      token = "ALGO";
    } else if (price && typeof price === "object" && "amount" in price) {
      // AssetAmount type (USDC)
      const assetPrice = price as { amount: string; asset?: string; extra?: { decimals?: number } };
      amount = assetPrice.amount;
      decimals = assetPrice.extra?.decimals || USDC_DECIMALS;
      token = assetPrice.asset || "USDC";
    } else {
      // Unknown format, use defaults
      amount = "0";
      decimals = ALGO_DECIMALS;
      token = "ALGO";
    }

    // Convert back to human-readable
    const amountBigInt = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = amountBigInt / divisor;
    const fraction = amountBigInt % divisor;
    const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
    const priceStr = fractionStr ? `${whole}.${fractionStr}` : whole.toString();

    return { path, price: priceStr, token, decimals };
  });
}
