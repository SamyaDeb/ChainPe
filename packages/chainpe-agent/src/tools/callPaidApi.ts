/**
 * Call Paid API Tool
 * AI tool for calling x402-protected APIs with automatic payment
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import type { PaymentClient } from "../payment.js";
import type { RegistryClient } from "../registry.js";
import type { ServiceInfo, Registry } from "../types.js";

export interface CallPaidApiToolOptions {
  paymentClient: PaymentClient;
  registryClient: RegistryClient;
  providerHint?: string;
}

// Track paid calls to prevent duplicates within same session
const paidCallCache = new Map<string, { success: boolean; data: unknown; paid: boolean }>();

/**
 * Reset the paid call cache (call at start of each agent run)
 */
export function resetPaidCallCache(): void {
  paidCallCache.clear();
}

/**
 * Find service by name from local registry
 */
async function findServiceByName(name: string): Promise<ServiceInfo | undefined> {
  try {
    const registryPath = path.join(os.homedir(), ".chainpe", "registry.json");
    const content = await fs.readFile(registryPath, "utf-8");
    const registry: Registry = JSON.parse(content);
    return registry.services?.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
  } catch {
    return undefined;
  }
}

/**
 * Load developer address from provider config (if exists locally)
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
 * Creates a tool for calling paid APIs with automatic x402 payment
 */
export function createCallPaidApiTool(options: CallPaidApiToolOptions) {
  const { paymentClient, registryClient, providerHint } = options;

  return tool({
    description:
      "Call a paid AI service API. This tool automatically handles x402 payments on Algorand. Use the 'discoverService' tool first to find available services.",
    inputSchema: z.object({
      serviceName: z
        .string()
        .describe("The name of the service to call (from discoverService results)"),
      path: z
        .string()
        .optional()
        .default("/")
        .describe("API path to call (default: '/')"),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .optional()
        .default("POST")
        .describe("HTTP method"),
      body: z
        .record(z.unknown())
        .optional()
        .describe("Request body (for POST/PUT requests)"),
    }),
    execute: async ({ serviceName, path, method, body }) => {
      // Smart path defaulting: If LLM forgets to set proper path, infer from service name
      let effectivePath = path || "/";
      
      // Fix: If LLM passes a full URL as path, extract just the path portion
      if (effectivePath.startsWith("http://") || effectivePath.startsWith("https://")) {
        try {
          const url = new URL(effectivePath);
          effectivePath = url.pathname + url.search;
        } catch {
          effectivePath = "/";
        }
      }
      
      // If path is just "/" or empty, infer from service name
      if (effectivePath === "/" || effectivePath === "") {
        const svcLower = serviceName.toLowerCase();
        if (["btc", "eth", "sol", "algo", "avax"].includes(svcLower)) {
          effectivePath = `/crypto?symbol=${serviceName.toUpperCase()}`;
        } else if (svcLower.includes("bitcoin")) {
          effectivePath = "/btc"; // Bitcoin API endpoint
        } else if (svcLower.includes("weather")) {
          effectivePath = "/weather?city=New%20York"; // Default city
        } else if (svcLower.includes("market")) {
          effectivePath = "/market/summary";
        }
      }
      
      // PREVENT DOUBLE PAYMENTS: Check if we already made a paid call for this service+path
      const cacheKey = `${serviceName.toLowerCase()}:${effectivePath}:${method}`;
      console.log(`[callPaidApi] Cache check - key: "${cacheKey}", cached: ${paidCallCache.has(cacheKey)}`);
      const cachedResult = paidCallCache.get(cacheKey);
      if (cachedResult) {
        console.log(`[callPaidApi] ✓ Returning cached result for "${serviceName}" (preventing duplicate payment)`);
        return {
          success: cachedResult.success,
          data: cachedResult.data,
          paid: false, // Not paying again
          cached: true,
          note: "Result from previous call - no additional payment made"
        };
      }
      
      console.log(`[callPaidApi] No cache hit - proceeding with API call for "${serviceName}"`);
      
      // Debug logging (can be removed for production)
      // console.log(`[callPaidApi] Called with: serviceName="${serviceName}", path="${effectivePath}" (original: "${path}"), method="${method}"`);
      
      // If provider hint exists, try it first before using the LLM's serviceName
      const namesToTry = providerHint ? [providerHint, serviceName] : [serviceName];
      
      let service: ServiceInfo | undefined;
      
      for (const nameToTry of namesToTry) {
        // First try local registry
        service = await findServiceByName(nameToTry);
        
        if (!service) {
          // Try on-chain registry with local developer address
          const developerAddr = await getLocalDeveloperAddress();
          
          if (developerAddr) {
            service = await registryClient.findByName(nameToTry, developerAddr);
          }
        }
        
        if (service) {
          break; // Found it!
        }
      }

      if (!service) {
        return {
          success: false,
          error: `Service "${serviceName}" not found in registry`,
          suggestion: "Use the discoverService tool to find available services",
        };
      }

      try {
        // Make the paid API call
        const response = await paymentClient.callService(service, effectivePath, {
          method: method as "GET" | "POST" | "PUT" | "DELETE",
          body,
        });

        // Cache the successful result to prevent duplicate payments
        paidCallCache.set(cacheKey, {
          success: true,
          data: response.data,
          paid: response.paid ?? false,
        });

        return {
          success: true,
          status: response.status,
          data: response.data,
          paid: response.paid,
          payment: response.paymentReceipt
            ? {
                amount: response.paymentReceipt.amount,
                token: response.paymentReceipt.token,
                recipient: response.paymentReceipt.recipient,
              }
            : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: `API call failed: ${(error as Error).message}`,
          serviceName,
          endpoint: service.endpoint,
        };
      }
    },
  });
}
