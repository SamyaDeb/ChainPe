/**
 * discoverService: finds paid services through Circle's Discovery API and
 * ChainPeAccounts on Arc.
 */
import { tool } from "ai";
import { z } from "zod";
import { discoverServices } from "@chainpearc/sdk";
import type { ChainPeNetwork, ServiceInfo } from "../types.js";

export interface DiscoverServiceToolOptions {
  network: ChainPeNetwork;
  accountsAddress?: string;
  reputationRegistry?: string;
  /** Most results returned to the model. Default 8. */
  limit?: number;
}

/** A compact view of a service, for the model and the terminal. */
export function formatServiceForDisplay(service: ServiceInfo) {
  const rep = service.reputation;
  return {
    name: service.name,
    description: service.description,
    url: service.endpoint,
    method: service.method,
    price: `${service.pricePerRequest} USDC`,
    rails: service.rails,
    rating: rep && rep.count > 0 && rep.score !== null ? `${Math.round(rep.score)}/100 from ${rep.count}` : null,
    agentId: service.agentId,
    // A ChainPe listing is a base URL. Its OpenAPI document, free to read, lists the paths.
    openapi: service.source === "chainpe" ? `${service.endpoint.replace(/\/+$/, "")}/openapi.json` : undefined,
  };
}

export function createDiscoverServiceTool(options: DiscoverServiceToolOptions) {
  return tool({
    description:
      "Find paid x402 services on Arc by keyword. Returns each service's name, description, URL, price in USDC, " +
      "payment rails and rating. When a service has an `openapi` link, its URL is a base URL: read that link with " +
      "callFreeApi to find the right path before paying.",
    inputSchema: z.object({
      query: z.string().describe('One or two keywords, e.g. "weather" or "bitcoin price"'),
      maxPrice: z.string().optional().describe('Highest price per call in USDC, e.g. "0.05"'),
    }),
    execute: async ({ query, maxPrice }) => {
      try {
        const services = await discoverServices(
          options.network,
          { query, maxPrice, limit: options.limit ?? 8 },
          { accountsAddress: options.accountsAddress, reputationRegistry: options.reputationRegistry }
        );
        return { success: true, count: services.length, services: services.map(formatServiceForDisplay) };
      } catch (error) {
        return { success: false, error: `Search failed: ${(error as Error).message}` };
      }
    },
  });
}
