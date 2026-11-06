/**
 * The ERC-8004 agent card served at /.well-known/agent.json. Arc's docs leave the
 * fields to the application; these are spec 10's plus the tutorial's conventions.
 * Built field by field, so nothing private in the config can reach it.
 */
import { serviceKey } from "./accounts.js";
import { getNetwork } from "./chains.js";
import { parseUsdc } from "./evm.js";
import { canonicalPrice } from "./listing.js";
import { ALL_RAILS, effectiveRails } from "./proxy/routeConfig.js";
import type { ChainPeConfig } from "./types.js";

export function buildAgentCard(config: ChainPeConfig): Record<string, unknown> | undefined {
  if (!config.publicUrl) return undefined;
  const price = canonicalPrice(config.pricePerRequest);
  return {
    name: config.serviceName,
    description: config.serviceDescription,
    agent_type: "api",
    capabilities: config.tags,
    version: "1.0.0",
    endpoint: config.publicUrl,
    x402: {
      networks: [getNetwork(config.network).caip2],
      rails: effectiveRails(parseUsdc(price), config.rails ?? ALL_RAILS),
      priceUsd: price,
    },
    chainpe: { serviceKey: serviceKey(config.walletAddress, config.serviceName) },
  };
}
