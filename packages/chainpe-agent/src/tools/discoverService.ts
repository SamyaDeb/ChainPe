/**
 * Discover Service Tool
 * AI tool for searching the service registry
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import type { RegistryClient } from "../registry.js";
import type { ServiceInfo, Registry } from "../types.js";

export interface DiscoverServiceToolOptions {
  registryClient: RegistryClient;
}

/**
 * Load local registry from ~/.chainpe/registry.json
 */
async function loadLocalRegistry(): Promise<ServiceInfo[]> {
  try {
    const registryPath = path.join(os.homedir(), ".chainpe", "registry.json");
    const content = await fs.readFile(registryPath, "utf-8");
    const registry: Registry = JSON.parse(content);
    return registry.services || [];
  } catch {
    return [];
  }
}

/**
 * Load provider config to get developer address
 */
async function getLocalDeveloperAddress(): Promise<string | undefined> {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config.walletAddress;
  } catch {
    return undefined;
  }
}

/**
 * Load service name from provider config
 */
async function getLocalServiceName(): Promise<string | undefined> {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return config.serviceName;
  } catch {
    return undefined;
  }
}

/**
 * Filter services by search criteria
 */
function filterServices(
  services: ServiceInfo[],
  options: { query?: string; tags?: string[]; maxPrice?: string; paymentToken?: string }
): ServiceInfo[] {
  let results = [...services];
  
  // For query search: match if ANY word appears in name, description, or tags
  // For tag filter: match if ANY specified tag appears in service tags
  // Both are OR conditions, not AND
  
  if (options.query || options.tags?.length) {
    const queryWords = options.query 
      ? options.query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
      : [];
    const searchTags = options.tags 
      ? options.tags.map(t => t.toLowerCase())
      : [];
    
    results = results.filter((s) => {
      const searchText = `${s.name} ${s.description} ${s.tags.join(' ')}`.toLowerCase();
      
      // Match if any query word is found
      const queryMatch = queryWords.length === 0 || queryWords.some(word => searchText.includes(word));
      
      // Match if any specified tag is found (case-insensitive)
      const tagMatch = searchTags.length === 0 || s.tags.some(t => 
        searchTags.some(st => t.toLowerCase().includes(st) || st.includes(t.toLowerCase()))
      );
      
      // Return true if either query or tag matches (not both required)
      return queryMatch || tagMatch;
    });
  }
  
  if (options.paymentToken) {
    results = results.filter((s) => s.paymentToken === options.paymentToken);
  }
  
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice);
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max);
  }
  
  return results;
}

/**
 * Creates a tool for discovering services in the registry
 */
export function createDiscoverServiceTool(options: DiscoverServiceToolOptions) {
  const { registryClient } = options;

  return tool({
    description:
      "Search for AI services in the ChainPe marketplace. Use this to find services that can help with a task. Returns service names, descriptions, prices, and endpoints.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Search query to match against service names and descriptions"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (e.g., ['ai', 'research', 'nlp'])"),
      maxPrice: z
        .string()
        .optional()
        .describe("Maximum price per request (e.g., '0.1')"),
      paymentToken: z
        .enum(["ALGO", "USDC"])
        .optional()
        .describe("Filter by payment token"),
    }),
    execute: async ({ query, tags, maxPrice, paymentToken }) => {
      // Debug logging (can be removed for production)
      // console.log(`[discoverService] Called with: query="${query}", tags=${JSON.stringify(tags)}, maxPrice="${maxPrice}", paymentToken="${paymentToken}"`);
      try {
        // Try to fetch ALL services from on-chain registry using indexer
        let allServices: ServiceInfo[] = [];
        
        try {
          allServices = await registryClient.listAllServices();
        } catch (indexerError) {
          // Fallback 1: Check local registry file
          const localServices = await loadLocalRegistry();
          if (localServices.length > 0) {
            allServices = localServices;
          } else {
            // Fallback 2: Try to load local provider's service
            const developerAddr = await getLocalDeveloperAddress();
            const serviceName = await getLocalServiceName();
            
            if (developerAddr && serviceName) {
              const localProviderService = await registryClient.findService(developerAddr, serviceName);
              if (localProviderService) {
                allServices = [localProviderService];
              }
            }
          }
        }
        
        // Apply filters
        const filtered = filterServices(allServices, { query, tags, maxPrice, paymentToken });
        
        if (filtered.length === 0) {
          return {
            found: false,
            message: allServices.length === 0 
              ? "No services found in registry. Make sure services are registered on-chain."
              : "No services found matching your criteria.",
            services: [],
          };
        }
        
        // Return results sorted by relevance (exact name matches first)
        const sorted = filtered.sort((a, b) => {
          if (!query) return 0;
          const qLower = query.toLowerCase();
          const aNameMatch = a.name.toLowerCase() === qLower;
          const bNameMatch = b.name.toLowerCase() === qLower;
          if (aNameMatch && !bNameMatch) return -1;
          if (!aNameMatch && bNameMatch) return 1;
          return 0;
        });

        return {
          found: true,
          message: `Found ${sorted.length} service(s)${allServices.length !== sorted.length ? ` (${allServices.length} total available)` : ''}`,
          services: sorted.map((s) => ({
            name: s.name,
            description: s.description,
            price: `${s.pricePerRequest} ${s.paymentToken}`,
            tags: s.tags,
            endpoint: s.endpoint,
          })),
        };
      } catch (error) {
        return {
          found: false,
          message: `Error discovering services: ${(error as Error).message}`,
          services: [],
        };
      }
    },
  });
}

/**
 * Format service info for display
 */
export function formatServiceForDisplay(service: ServiceInfo): string {
  return `**${service.name}**
  ${service.description}
  Price: ${service.pricePerRequest} ${service.paymentToken}
  Tags: ${service.tags.join(", ")}`;
}
