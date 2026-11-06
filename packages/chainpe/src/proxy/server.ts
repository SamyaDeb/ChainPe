/**
 * ChainPe Proxy Server
 *
 * x402 v2 payment gateway. Every proxied request is gated by a USDC payment on
 * Arc. Routes use the `upfront` payment flow, so x402 settles before calling
 * next(): the backend is reached only after settlement has completed.
 */

import fs from "fs/promises";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { isBatchPayment } from "@circle-fin/x402-batching/server";

import type { ChainPeConfig, PaymentEvent, RouteConfig } from "../types.js";
import { createRoutesConfig, formatRoutesForDisplay } from "./routeConfig.js";
import { buildAgentCard } from "../agentCard.js";
import { getNetwork } from "../chains.js";
import { AGENT_CARD_PATH } from "../erc8004.js";
import { formatUsdc } from "../evm.js";
import { analytics } from "./analytics.js";
import { paymentIdentifierFor } from "./circleFacilitator.js";
import type { GatewayTerms } from "./gateway.js";
import { logger, logPayment, logRequest, logServerStart } from "../logger.js";

export interface ProxyServerOptions {
  config: ChainPeConfig;
  additionalRoutes?: RouteConfig[];
  onPayment?: (event: PaymentEvent) => void;
  /** Settles payments. With more than one rail this is a RailRouter. */
  facilitator: FacilitatorClient;
  /** Needed when the gateway rail is enabled. */
  gateway?: GatewayTerms;
  /** Files `chainpe doctor` generated. Unset or missing files answer 404. */
  documents?: { openapi?: string; x402?: string };
}

const RECENT_PAYMENTS_IN_STATS = 10;

const PAYMENT_REQUEST_HEADERS = ["payment-signature", "x-payment"];

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * True for a caller on this machine. A forwarded request came through a local
 * tunnel or reverse proxy, and an Origin means a web page is calling through the
 * developer's browser (CORS is open), so neither counts as local.
 */
export function isLocalRequest(req: Pick<Request, "headers" | "socket">): boolean {
  const { headers, socket } = req;
  if (headers.origin || headers.forwarded || headers["x-forwarded-for"]) return false;
  return LOOPBACK_ADDRESSES.has(socket.remoteAddress ?? "");
}

/** Builds the event for a request that reached settlement; undefined if it never did. */
function toPaymentEvent(
  signature: string,
  res: Response,
  method: string,
  route: string,
  latencyMs: number
): PaymentEvent | undefined {
  const receiptHeader = res.getHeader("PAYMENT-RESPONSE");
  if (typeof receiptHeader !== "string") return undefined;

  try {
    const payload = decodePaymentSignatureHeader(signature);
    const receipt = decodePaymentResponseHeader(receiptHeader);
    const settlement = receipt.extensions?.["settlement-status"] as { paymentId?: string } | undefined;
    const failed = receipt.errorReason === "settlement_pending" ? "pending" : "failed";
    const gateway = isBatchPayment(payload.accepted);
    // Gateway answers with a transfer id; its tx hash only exists after the batch lands.
    const transaction = receipt.transaction || undefined;
    return {
      id: paymentIdentifierFor(payload),
      ts: Date.now(),
      route,
      method,
      rail: gateway ? "gateway" : "exact",
      network: payload.accepted.network,
      amountAtomic: receipt.amount ?? payload.accepted.amount,
      payer: receipt.payer ?? "unknown",
      payTo: payload.accepted.payTo,
      txHash: transaction && TX_HASH.test(transaction) ? transaction : undefined,
      paymentId: settlement?.paymentId ?? (gateway ? transaction : undefined),
      status: receipt.success ? "completed" : failed,
      latencyMs,
      backendStatus: receipt.success ? res.statusCode : undefined,
      error: receipt.errorReason,
    };
  } catch (err) {
    logger.warn(`Could not record payment: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Answers the free discovery documents here, from the proxy. They must never fall
 * through to the reverse proxy: that would reach the backend without a payment.
 * Exact matches, so a path cannot smuggle in a paid route.
 */
function discoveryDocuments(config: ChainPeConfig, documents: ProxyServerOptions["documents"]) {
  const readFile = (file?: string) => async () => (file ? fs.readFile(file, "utf-8") : undefined);
  const sources = new Map<string, () => Promise<string | undefined>>([
    ["/.well-known/x402", readFile(documents?.x402)],
    ["/openapi.json", readFile(documents?.openapi)],
    [
      AGENT_CARD_PATH,
      async () => {
        const card = buildAgentCard(config);
        return card && JSON.stringify(card, null, 2);
      },
    ],
  ]);
  return (req: Request, res: Response, next: NextFunction) => {
    const source = sources.get(req.path);
    if (!source) {
      next();
      return;
    }
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }
    source().then(
      (body) => {
        if (body === undefined) res.status(404).json({ error: "Not generated. Run `chainpe doctor`." });
        else res.type("application/json").send(body);
      },
      (err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") logger.warn(`Could not read ${req.path}: ${err.message}`);
        res.status(404).json({ error: "Not generated. Run `chainpe doctor`." });
      }
    );
  };
}

export function createProxyServer(options: ProxyServerOptions): Express {
  const { config, additionalRoutes, onPayment, facilitator, gateway, documents } = options;
  const app = express();

  app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-CHAINPE-AGENT-ID"] }));

  // Request logging / counting (raw — no body parsing, so proxying is unaffected).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    analytics.recordRequest();
    res.on("finish", () => logRequest(req.method, req.path, res.statusCode, Date.now() - start));
    next();
  });

  // Health check (not gated).
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: config.serviceName, uptime: process.uptime() });
  });

  // Admin endpoints expose payer addresses: they need the admin key or a local caller.
  const adminRouter = express.Router();
  adminRouter.use(express.json());
  adminRouter.use((req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers["x-admin-key"] || req.query.adminKey;
    const hasKey = Boolean(config.adminKey) && apiKey === config.adminKey;
    if (!hasKey && !isLocalRequest(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
  adminRouter.get("/stats", (_req: Request, res: Response) => {
    const { totalRequests, paidRequests, failedPayments, chargedButBackendFailed, requestsPerMinute, lastHourRequests } =
      analytics.getStats();
    res.json({
      totalRequests,
      paidRequests,
      failedPayments,
      chargedButBackendFailed,
      requestsPerMinute,
      lastHourRequests,
      revenue: analytics.getRevenueSummary(),
      recentPayments: analytics.getRecentPayments().slice(0, RECENT_PAYMENTS_IN_STATS),
    });
  });
  adminRouter.get("/payments", (_req: Request, res: Response) => res.json(analytics.getRecentPayments()));
  adminRouter.get("/config", (_req: Request, res: Response) => {
    res.json({
      serviceName: config.serviceName,
      serviceDescription: config.serviceDescription,
      targetUrl: config.targetUrl,
      pricePerRequest: config.pricePerRequest,
      paymentToken: config.paymentToken,
      walletAddress: config.walletAddress,
      network: config.network,
      tags: config.tags,
    });
  });
  // Pass-through: fetch /schema from the backend so agents can self-describe
  // their routes without going through the payment gate.
  adminRouter.get("/schema", async (_req: Request, res: Response) => {
    try {
      const r = await fetch(`${config.targetUrl}/schema`);
      if (!r.ok) { res.status(404).json({ error: "Agent has no /schema endpoint" }); return; }
      res.json(await r.json());
    } catch {
      res.status(503).json({ error: "Backend unreachable" });
    }
  });
  adminRouter.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use("/chainpe-admin", adminRouter);

  // Advertise this provider's ERC-8004 agentId so consumers can leave reputation
  // feedback without scanning a registry by payTo.
  const advertisedAgentId = config.agentId ?? process.env.CHAINPE_AGENT_ID;
  if (advertisedAgentId && advertisedAgentId !== "0") {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("X-CHAINPE-AGENT-ID", advertisedAgentId);
      next();
    });
  }

  // x402 routes.
  const routesConfig = createRoutesConfig(config, [...(config.routes ?? []), ...(additionalRoutes ?? [])], gateway);
  logger.info("Configured x402 routes:");
  for (const r of formatRoutesForDisplay(routesConfig)) {
    logger.info(`  ${r.path} → ${r.price} ${r.token} (${r.rails.join(", ")})`);
  }

  app.use(discoveryDocuments(config, documents));

  // Payment tracking runs first so that refused payments are recorded too.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const signature = req.get("payment-signature");
    if (!signature) {
      next();
      return;
    }
    const start = Date.now();
    const route = req.path;
    res.on("finish", () => {
      const event = toPaymentEvent(signature, res, req.method, route, Date.now() - start);
      if (!event) return;
      analytics.recordPayment(event);
      if (event.status === "completed") {
        logPayment(formatUsdc(BigInt(event.amountAtomic)), "USDC", event.payer, event.route);
      }
      onPayment?.(event);
    });
    next();
  });

  // Payment middleware (gates everything after it). ExactEvmScheme serves both
  // rails: `exact` is the only scheme name, and route `extra` carries the rail.
  const resourceServer = new x402ResourceServer(facilitator).register(
    getNetwork(config.network).caip2,
    new ExactEvmScheme()
  );
  const paymentGate = paymentMiddleware(routesConfig, resourceServer);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    void paymentGate(req, res, next);
  });

  // Reverse proxy to the provider backend.
  const proxyOptions: ProxyOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    // WebSocket upgrades would skip the payment gate, so they are not proxied.
    ws: false,
    on: {
      proxyReq: (proxyReq, req) => {
        for (const header of PAYMENT_REQUEST_HEADERS) proxyReq.removeHeader(header);
        logger.verbose(`Proxying ${req.method} ${req.url} → ${config.targetUrl}`);
      },
      proxyRes: (proxyRes, req) => logger.verbose(`Response ${config.targetUrl}${req.url}: ${proxyRes.statusCode}`),
      error: (err, _req, res) => {
        logger.error(`Proxy error: ${err.message}`);
        if (res && "writeHead" in res && typeof (res as Response).status === "function") {
          (res as Response).status(502).json({ error: "Bad Gateway", message: "Failed to reach upstream server" });
        }
      },
    },
  };
  app.use("/", createProxyMiddleware(proxyOptions));

  return app;
}

export async function startProxyServer(
  options: ProxyServerOptions
): Promise<{ app: Express; server: ReturnType<Express["listen"]> }> {
  const { config } = options;
  const app = createProxyServer(options);
  return new Promise((resolve) => {
    const server = app.listen(config.proxyPort, () => {
      logServerStart(config.proxyPort, config.serviceName);
      resolve({ app, server });
    });
  });
}

export { analytics };
