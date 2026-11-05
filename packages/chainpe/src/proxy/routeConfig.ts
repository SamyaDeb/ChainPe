/**
 * Route Configuration
 *
 * Builds x402 v2 routes from a ChainPeConfig. Keys are "METHOD /path"; a
 * catch-all gates every proxied path, and specific routes may override it.
 */
import type {
  PaymentOption,
  RouteConfig as X402RouteConfig,
  RoutesConfig,
  SettlementFailedResponseBody,
} from "@x402/core/http";
import { GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS, isBatchPayment } from "@circle-fin/x402-batching/server";
import { getNetwork } from "../chains.js";
import { parseUsdc } from "../evm.js";
import { logger } from "../logger.js";
import type { ChainPeConfig, PaymentRail, RouteConfig as ChainPeRouteConfig } from "../types.js";
import type { GatewayTerms } from "./gateway.js";

export const CATCH_ALL_ROUTE = "* /*";

export const ALL_RAILS: PaymentRail[] = ["exact", "gateway"];

/** On-chain settlement costs make `exact` pointless below one cent. */
const MIN_EXACT_PRICE_ATOMIC = 10_000n;

/** Parses "exact,gateway" from the command line. */
export function parseRails(value: string): PaymentRail[] {
  const rails = value.split(",").map((rail) => rail.trim());
  for (const rail of rails) {
    if (!ALL_RAILS.includes(rail as PaymentRail)) {
      throw new Error(`Invalid rail "${rail}" (expected ${ALL_RAILS.join(" or ")}).`);
    }
  }
  return [...new Set(rails)] as PaymentRail[];
}

/** Converts a human USDC price ("0.01") to the x402 Money string ("$0.01"). */
function toMoney(price: string): string {
  const clean = price.trim().replace(/^\$/, "");
  return `$${clean}`;
}

/** Accepts "GET /path" or "/path" (any method). */
function toRouteKey(path: string): string {
  return path.includes(" ") ? path : `* ${path}`;
}

/** Tells the buyer why a settlement failed, as JSON in the 402 body. */
const settlementFailedResponseBody: SettlementFailedResponseBody = (_context, failure) => {
  const status = failure.extensions?.["settlement-status"] as { paymentId?: string } | undefined;
  return {
    contentType: "application/json",
    body: {
      error: "payment_failed",
      reason: failure.errorReason,
      message: failure.errorMessage,
      ...(status?.paymentId && { paymentId: status.paymentId }),
    },
  };
};

export type { RoutesConfig };

export function createRoutesConfig(
  config: ChainPeConfig,
  additionalRoutes?: ChainPeRouteConfig[],
  gateway?: GatewayTerms
): Record<string, X402RouteConfig> {
  const network = getNetwork(config.network).caip2;
  const rails = config.rails ?? ALL_RAILS;
  if (rails.includes("gateway") && !gateway) {
    throw new Error("The gateway rail is enabled but Gateway's terms were not provided.");
  }
  const tooCheapForExact: string[] = [];

  const build = (key: string, price: string, description?: string): X402RouteConfig => {
    const atomic = parseUsdc(price.trim().replace(/^\$/, ""));
    if (atomic <= 0n) throw new Error(`Route ${key} has no valid price: "${price}".`);

    // Every option settles before the handler runs, so the backend only sees paid requests.
    const accepts: PaymentOption[] = [];
    const common = { scheme: "exact", price: toMoney(price), network, payTo: config.walletAddress };
    if (rails.includes("exact")) {
      // Listed first: stock x402 clients take the first option they can sign.
      if (atomic >= MIN_EXACT_PRICE_ATOMIC) accepts.push({ ...common, extra: { paymentFlow: "upfront" } });
      else tooCheapForExact.push(key);
    }
    if (rails.includes("gateway")) {
      accepts.push({
        ...common,
        maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
        extra: { ...gateway, paymentFlow: "upfront" },
      });
    }
    if (accepts.length === 0) {
      throw new Error(`Route ${key} costs $${price}: exact needs at least $0.01, so enable the gateway rail.`);
    }
    return {
      accepts,
      description: description ?? `Pay ${price} USDC per request`,
      settlementFailedResponseBody,
    };
  };

  const routes: Record<string, X402RouteConfig> = {};

  // Specific routes first: the first matching route wins.
  for (const r of additionalRoutes ?? []) {
    const key = toRouteKey(r.path);
    routes[key] = build(key, r.pricePerRequest || config.pricePerRequest, r.description);
  }

  routes[CATCH_ALL_ROUTE] = build(CATCH_ALL_ROUTE, config.pricePerRequest);

  if (tooCheapForExact.length > 0) {
    logger.warn(`Gateway only (exact needs at least $0.01): ${tooCheapForExact.join(", ")}`);
  }
  return routes;
}

/** Human-readable summary of the configured routes for CLI display. */
export function formatRoutesForDisplay(
  routes: Record<string, X402RouteConfig>
): Array<{ path: string; price: string; token: string; rails: PaymentRail[] }> {
  return Object.entries(routes).map(([path, cfg]) => {
    const options = (Array.isArray(cfg.accepts) ? cfg.accepts : [cfg.accepts]) as PaymentOption[];
    const rails = options.map((option): PaymentRail => (isBatchPayment(option) ? "gateway" : "exact"));
    return { path, price: String(options[0].price), token: "USDC", rails };
  });
}
