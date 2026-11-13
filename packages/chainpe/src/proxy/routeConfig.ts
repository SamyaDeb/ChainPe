/**
 * Route Configuration
 *
 * Builds the x402-express RoutesConfig from a ChainPeConfig. On EVM, x402 prices
 * are expressed as a USD/USDC string (e.g. "$0.01") and x402 maps that to the
 * network's default asset (USDC). A catch-all "/*" gates every proxied path, and
 * additional per-path overrides may be supplied.
 */
import type { RoutesConfig, RouteConfig as X402RouteConfig } from "x402-express";
import { getNetwork } from "../chains.js";
import type { ChainPeConfig, RouteConfig as ChainPeRouteConfig } from "../types.js";

/** Converts a human USDC price ("0.01") to the x402 Money string ("$0.01"). */
function toMoney(price: string): string {
  const clean = price.trim().replace(/^\$/, "");
  return `$${clean}`;
}

export type { RoutesConfig };

export function createRoutesConfig(
  config: ChainPeConfig,
  additionalRoutes?: ChainPeRouteConfig[]
): RoutesConfig {
  const x402Network = getNetwork(config.network).x402Network;

  const build = (price: string, description?: string): X402RouteConfig => ({
    price: toMoney(price),
    network: x402Network,
    config: {
      description: description ?? `Pay ${price} USDC per request`,
    },
  });

  const routes: RoutesConfig = {};

  // Specific routes first.
  if (additionalRoutes) {
    for (const r of additionalRoutes) {
      routes[r.path] = build(r.pricePerRequest || config.pricePerRequest, r.description);
    }
  }

  // Catch-all: "/*" → regex matches every path beginning with "/".
  routes["/*"] = build(config.pricePerRequest);

  return routes;
}

/** Human-readable summary of the configured routes for CLI display. */
export function formatRoutesForDisplay(
  routes: RoutesConfig
): Array<{ path: string; price: string; token: string }> {
  return Object.entries(routes).map(([path, cfg]) => {
    let value: string;
    if (typeof cfg === "string" || typeof cfg === "number") {
      value = String(cfg);
    } else if ("price" in cfg) {
      value = String(cfg.price);
    } else {
      // ERC20TokenAmount / SPLTokenAmount
      value = String((cfg as { amount?: string }).amount ?? "");
    }
    return { path, price: value, token: "USDC" };
  });
}
