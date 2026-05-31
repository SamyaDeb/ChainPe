/**
 * Call Free API Tool
 * AI tool for calling regular (non-paid) HTTP APIs
 */

import { tool } from "ai";
import { z } from "zod";

/**
 * Creates a tool for calling free (non-x402) HTTP APIs
 */
export function createCallFreeApiTool() {
  return tool({
    description:
      "Call a free HTTP API (no payment required). Use this for public APIs that don't require x402 payments.",
    inputSchema: z.object({
      url: z.string().url().describe("The full URL to call"),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .optional()
        .default("GET")
        .describe("HTTP method"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Additional headers to send"),
      body: z
        .record(z.unknown())
        .optional()
        .describe("Request body (for POST/PUT requests)"),
    }),
    execute: async ({ url, method, headers, body }) => {
      try {
        const fetchOptions: RequestInit = {
          method: method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...(headers || {}),
          },
          signal: AbortSignal.timeout(30000),
        };

        if (body && method !== "GET") {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        const contentType = response.headers.get("Content-Type") || "";

        let data: unknown;
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          data,
        };
      } catch (error) {
        return {
          success: false,
          error: `Request failed: ${(error as Error).message}`,
          url,
        };
      }
    },
  });
}
