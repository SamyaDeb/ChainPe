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
import { getNetwork } from "../chains.js";
import type { ChainPeConfig, RouteConfig as ChainPeRouteConfig } from "../types.js";

export const CATCH_ALL_ROUTE = "* /*";

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
  additionalRoutes?: ChainPeRouteConfig[]
): Record<string, X402RouteConfig> {
  const network = getNetwork(config.network).caip2;

  const build = (price: string, description?: string): X402RouteConfig => ({
    accepts: [
      {
        scheme: "exact",
        price: toMoney(price),
        network,
        payTo: config.walletAddress,
        // Settle before the handler runs, so the backend only sees paid requests.
        extra: { paymentFlow: "upfront" },
      },
    ],
    description: description ?? `Pay ${price} USDC per request`,
    settlementFailedResponseBody,
  });

  const routes: Record<string, X402RouteConfig> = {};

  // Specific routes first: the first matching route wins.
  for (const r of additionalRoutes ?? []) {
    routes[toRouteKey(r.path)] = build(r.pricePerRequest || config.pricePerRequest, r.description);
  }

  routes[CATCH_ALL_ROUTE] = build(config.pricePerRequest);

  return routes;
}

/** Human-readable summary of the configured routes for CLI display. */
export function formatRoutesForDisplay(
  routes: Record<string, X402RouteConfig>
): Array<{ path: string; price: string; token: string }> {
  return Object.entries(routes).map(([path, cfg]) => {
    const option = (Array.isArray(cfg.accepts) ? cfg.accepts[0] : cfg.accepts) as PaymentOption;
    return { path, price: String(option.price), token: "USDC" };
  });
}
