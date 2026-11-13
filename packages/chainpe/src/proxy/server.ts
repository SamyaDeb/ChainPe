/**
 * ChainPe Proxy Server (Avalanche C-Chain)
 *
 * x402 payment gateway built on Coinbase's `x402-express` middleware. Every
 * proxied request is gated by a USDC payment (EIP-3009) on Avalanche; once paid
 * and settled by a facilitator, the request is forwarded to the provider's
 * backend.
 *
 * Facilitator modes:
 *   1. External (default): set `facilitatorUrl` (e.g. an Avalanche-capable
 *      facilitator). The provider needs no key — it only receives payments.
 *   2. Local (`--facilitator <privateKey>`): runs an in-process facilitator that
 *      settles on-chain using a funded gas wallet. No external dependency.
 */

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import { paymentMiddleware } from "x402-express";

import type { ChainPeConfig, PaymentEvent, RouteConfig } from "../types.js";
import { createRoutesConfig, formatRoutesForDisplay } from "./routeConfig.js";
import { createLocalFacilitatorRouter } from "./localFacilitator.js";
import { analytics } from "./analytics.js";
import { logger, logPayment, logRequest, logServerStart } from "../logger.js";

export interface ProxyServerOptions {
  config: ChainPeConfig;
  additionalRoutes?: RouteConfig[];
  onPayment?: (event: PaymentEvent) => void;
  /** Optional EVM private key to run an in-process facilitator (settles on-chain). */
  facilitatorKey?: string;
}

const LOCAL_FACILITATOR_PATH = "/chainpe-facilitator";

export function createProxyServer(options: ProxyServerOptions): Express {
  const { config, additionalRoutes, onPayment, facilitatorKey } = options;
  const app = express();

  app.use(cors({ exposedHeaders: ["X-PAYMENT-RESPONSE", "X-CHAINPE-AGENT-ID"] }));

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

  // Admin endpoints (JSON-parsed, optionally key-protected) — not gated.
  const adminRouter = express.Router();
  adminRouter.use(express.json());
  if (config.adminKey) {
    adminRouter.use((req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers["x-admin-key"] || req.query.adminKey;
      if (apiKey !== config.adminKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }
  adminRouter.get("/stats", (_req: Request, res: Response) => {
    res.json({ ...analytics.getStats(), revenue: analytics.getRevenueSummary(), totalRevenue: undefined, revenueByToken: undefined });
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
  app.use("/chainpe-admin", adminRouter);

  // Resolve the facilitator. Local mode mounts an in-process facilitator and
  // points x402 at it; otherwise use the configured external facilitator URL.
  let facilitatorUrl = config.facilitatorUrl;
  if (facilitatorKey) {
    app.use(LOCAL_FACILITATOR_PATH, createLocalFacilitatorRouter(facilitatorKey, config.network));
    facilitatorUrl = `http://localhost:${config.proxyPort}${LOCAL_FACILITATOR_PATH}`;
    logger.info("Using in-process facilitator (settles on-chain with the provided gas key)");
  } else if (facilitatorUrl) {
    logger.info(`Using external facilitator: ${facilitatorUrl}`);
  } else {
    logger.warn(
      "No facilitator configured. Payments cannot be settled on Avalanche.\n" +
        "  Set facilitatorUrl in config, or run `chainpe start --facilitator <privateKey>`."
    );
  }

  // 3b: advertise this provider's ERC-8004 agentId on the 402 so consumers can
  // leave reputation feedback without scanning the whole registry by payTo. The
  // id is added to the response body (top-level + each accept's `extra`) and an
  // `X-CHAINPE-AGENT-ID` header.
  const advertisedAgentId = config.agentId ?? process.env.CHAINPE_AGENT_ID;
  if (advertisedAgentId && advertisedAgentId !== "0") {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (
          res.statusCode === 402 &&
          body !== null &&
          typeof body === "object" &&
          Array.isArray((body as { accepts?: unknown }).accepts)
        ) {
          res.setHeader("X-CHAINPE-AGENT-ID", advertisedAgentId);
          const b = body as {
            agentId?: string;
            accepts: Array<Record<string, unknown>>;
          };
          b.agentId = advertisedAgentId;
          for (const accept of b.accepts) {
            accept.extra = {
              ...((accept.extra as Record<string, unknown>) ?? {}),
              agentId: advertisedAgentId,
            };
          }
        }
        return originalJson(body);
      }) as typeof res.json;
      next();
    });
  }

  // x402 routes.
  const routesConfig = createRoutesConfig(config, additionalRoutes);
  logger.info("Configured x402 routes:");
  for (const r of formatRoutesForDisplay(routesConfig)) {
    logger.info(`  ${r.path} → ${r.price} ${r.token}`);
  }

  // Payment middleware (gates everything after it).
  const facilitatorConfig = facilitatorUrl ? { url: facilitatorUrl as `${string}://${string}` } : undefined;
  app.use(
    paymentMiddleware(
      config.walletAddress as `0x${string}`,
      routesConfig,
      facilitatorConfig,
      { appName: config.serviceName }
    )
  );

  // Payment tracking — record successful settlements (x402 sets X-PAYMENT-RESPONSE).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const originalEnd = res.end.bind(res);
    res.on("finish", () => {
      const header = res.getHeader("X-PAYMENT-RESPONSE");
      if (header && res.statusCode < 400) {
        let payer = "unknown";
        let txId: string | undefined;
        try {
          const decoded = JSON.parse(Buffer.from(String(header), "base64").toString("utf-8"));
          payer = decoded.payer ?? decoded.payerAddress ?? "unknown";
          txId = decoded.transaction ?? decoded.txHash;
        } catch {
          /* header not JSON — ignore */
        }
        const event: PaymentEvent = {
          timestamp: new Date(),
          path: req.path,
          amount: config.pricePerRequest,
          token: config.paymentToken,
          payer,
          txId,
          success: true,
        };
        analytics.recordPayment(event);
        logPayment(event.amount, event.token, payer, req.path);
        onPayment?.(event);
      }
    });
    void originalEnd;
    next();
  });

  // Reverse proxy to the provider backend.
  const proxyOptions: ProxyOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (_proxyReq, req) => logger.verbose(`Proxying ${req.method} ${req.url} → ${config.targetUrl}`),
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
