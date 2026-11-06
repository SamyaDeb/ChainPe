/**
 * Pricing for an MCP server behind the proxy. MCP clients connect, list tools and
 * read resources for free; only `tools/call` is paid, at that tool's price.
 *
 * A paid call is gated as if it were a request to `<path>/tools/<name>`, so each
 * tool gets its own x402 route and price. The backend still receives the original
 * request to `<path>`.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { parseUsdc } from "../evm.js";
import type { ChainPeConfig, McpConfig, RouteConfig } from "../types.js";

export const DEFAULT_MCP_PATH = "/mcp";
const MAX_BODY = "1mb";

export interface McpDecision {
  /** No payment needed. */
  free: boolean;
  /** The path to gate a paid tool call as. */
  gatePath?: string;
}

export function mcpPath(mcp: McpConfig): string {
  const path = mcp.path ?? DEFAULT_MCP_PATH;
  return path.startsWith("/") ? path.replace(/\/+$/, "") : `/${path.replace(/\/+$/, "")}`;
}

function toolPrice(config: ChainPeConfig, name: string): string {
  const mcp = config.mcp ?? {};
  return mcp.tools?.[name] ?? mcp.toolPrice ?? config.pricePerRequest;
}

function isFree(price: string): boolean {
  return parseUsdc(price.trim().replace(/^\$/, "")) === 0n;
}

/** The x402 routes for paid tools: one per named tool, plus one for any other tool. */
export function mcpRoutes(config: ChainPeConfig): RouteConfig[] {
  if (!config.mcp) return [];
  const base = `POST ${mcpPath(config.mcp)}/tools`;
  const named = Object.entries(config.mcp.tools ?? {})
    .filter(([, price]) => !isFree(price))
    .map(([name, price]) => ({ path: `${base}/${encodeURIComponent(name)}`, pricePerRequest: price, paymentToken: "USDC" as const, description: `MCP tool ${name}` }));
  const other = config.mcp.toolPrice ?? config.pricePerRequest;
  return isFree(other) ? named : [...named, { path: `${base}/*`, pricePerRequest: other, paymentToken: "USDC", description: "Any other MCP tool" }];
}

/** Decides whether one parsed JSON-RPC body needs a payment. Throws a client error for a batch with a tool call. */
export function classifyMcpRequest(config: ChainPeConfig, method: string, body: unknown): McpDecision {
  if (method !== "POST") return { free: true };
  const messages = Array.isArray(body) ? body : [body];
  const calls = messages.filter((m) => (m as { method?: unknown })?.method === "tools/call");
  if (calls.length === 0) return { free: true };
  if (Array.isArray(body)) throw new McpRequestError("Send each tools/call in its own request, not in a batch, so it can be priced.");
  const name = (calls[0] as { params?: { name?: unknown } }).params?.name;
  if (typeof name !== "string" || name === "") throw new McpRequestError("tools/call needs params.name.");
  if (isFree(toolPrice(config, name))) return { free: true };
  return { free: false, gatePath: `${mcpPath(config.mcp ?? {})}/tools/${encodeURIComponent(name)}` };
}

export class McpRequestError extends Error {}

/**
 * Parses the JSON body at the MCP path and records the decision in res.locals. The
 * proxy re-sends the parsed body to the backend.
 */
export function mcpClassifier(config: ChainPeConfig) {
  const path = mcpPath(config.mcp ?? {});
  const parse = express.json({ limit: MAX_BODY, type: () => true });
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path !== path || req.method === "OPTIONS") {
      next();
      return;
    }
    const decide = () => {
      try {
        res.locals.mcp = classifyMcpRequest(config, req.method, req.body);
        next();
      } catch (err) {
        const message = (err as Error).message;
        res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } });
      }
    };
    if (req.method !== "POST") {
      decide();
      return;
    }
    parse(req, res, (err?: unknown) => {
      if (err) {
        res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      decide();
    });
  };
}
