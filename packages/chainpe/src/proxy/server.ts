/**
 * ChainPe Proxy Server
 * x402 payment gateway for Algorand using the GoPlausible x402-avm libraries
 * 
 * Supports two modes:
 * 1. Simple verifier (default) - verifies payments by checking Algorand blockchain
 * 2. Local facilitator (when mnemonic is provided) - runs in-process with signing
 */

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import { paymentMiddleware } from "@x402-avm/express";
import { x402ResourceServer } from "@x402-avm/core/server";
import { ExactAvmScheme } from "@x402-avm/avm/exact/server";
import { AlgoNativeServerScheme } from "../x402/algo/server-scheme.js";

import type { ChainPeConfig, PaymentEvent, RouteConfig } from "../types.js";
import {
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
} from "../types.js";
import { createLocalFacilitator, type FacilitatorClient } from "../facilitator/local-facilitator-client.js";
import { createSimpleVerifier } from "../facilitator/simple-verifier.js";
import { createAlgoNativeFacilitator } from "../facilitator/algo-facilitator.js";
import { createRoutesConfig, formatRoutesForDisplay } from "./routeConfig.js";
import { analytics } from "./analytics.js";
import { logger, logPayment, logRequest, logServerStart } from "../logger.js";

export interface ProxyServerOptions {
  config: ChainPeConfig;
  additionalRoutes?: RouteConfig[];
  onPayment?: (event: PaymentEvent) => void;
  /** Optional mnemonic for local facilitator mode (enables gasless transactions) */
  facilitatorMnemonic?: string;
}

/**
 * Creates and configures the x402 proxy server
 */
export function createProxyServer(options: ProxyServerOptions): Express {
  const { config, additionalRoutes, onPayment, facilitatorMnemonic } = options;
  const app = express();

  // Enable CORS
  app.use(cors());

  // Parse JSON bodies
  app.use(express.json());

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    analytics.recordRequest();

    res.on("finish", () => {
      const duration = Date.now() - start;
      logRequest(req.method, req.path, res.statusCode, duration);
    });

    next();
  });

  // Health check endpoint (not behind paywall)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: config.serviceName,
      uptime: process.uptime(),
    });
  });

  // Admin endpoints (optionally protected by API key)
  const adminRouter = express.Router();

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
    const stats = analytics.getStats();
    const revenue = analytics.getRevenueSummary();
    res.json({
      ...stats,
      revenue,
      totalRevenue: undefined, // Remove bigint (not JSON serializable)
      revenueByToken: undefined,
    });
  });

  adminRouter.get("/payments", (_req: Request, res: Response) => {
    res.json(analytics.getRecentPayments());
  });

  adminRouter.get("/config", (_req: Request, res: Response) => {
    // Return config without sensitive data
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

  app.use("/chainpe-admin", adminRouter);

  // Set up x402 payment middleware
  const networkCaip2 =
    config.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;

  // Create facilitator client
  // - For ALGO: use native ALGO facilitator (broadcasts native payment txns)
  // - For USDC with mnemonic: use local facilitator with signing
  // - For USDC without mnemonic: use simple verifier (blockchain checks)
  let facilitator: FacilitatorClient;
  
  if (config.paymentToken === "ALGO") {
    logger.info("Using ALGO native facilitator (native payment transactions)");
    facilitator = createAlgoNativeFacilitator(config.walletAddress, config.network);
  } else if (facilitatorMnemonic) {
    logger.info("Using local facilitator (in-process payment verification with signing)");
    facilitator = createLocalFacilitator(facilitatorMnemonic, config.network);
  } else {
    logger.info("Using simple verifier (blockchain-based payment verification)");
    facilitator = createSimpleVerifier(config.walletAddress, config.network);
  }

  // Create resource server and register payment schemes
  const resourceServer = new x402ResourceServer(facilitator as any);
  
  // Register ALGO native scheme (algo-exact)
  resourceServer.register(networkCaip2, new AlgoNativeServerScheme());
  
  // Register ASA/USDC scheme (exact) for future compatibility
  resourceServer.register(networkCaip2, new ExactAvmScheme());

  // Create routes config for x402 middleware
  const routesConfig = createRoutesConfig(config, additionalRoutes);

  logger.info("Configured routes for x402 payment:");
  for (const route of formatRoutesForDisplay(routesConfig)) {
    logger.info(`  ${route.path} → ${route.price} ${route.token}`);
  }

  // Paywall configuration (optional HTML paywall for browser requests)
  const paywallConfig = {
    appName: config.serviceName,
    testnet: config.network === "testnet",
  };

  // Apply x402 payment middleware
  // The middleware handles 402 responses automatically - no callbacks needed
  app.use(paymentMiddleware(routesConfig, resourceServer, paywallConfig));

  // Payment tracking middleware (runs after x402 middleware processes payment)
  // We track successful requests that made it past the paywall
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Check for x402 payment header in the response (indicates payment was made)
    const originalSend = res.send.bind(res);
    res.send = function (body: unknown): Response {
      // If we got here, the request passed the x402 paywall
      // Check if there was a payment (via headers or other indicators)
      const paymentReceipt = res.getHeader("X-Payment-Receipt") as string | undefined;
      
      if (paymentReceipt) {
        try {
          const receipt = JSON.parse(paymentReceipt);
          const event: PaymentEvent = {
            timestamp: new Date(),
            path: req.path,
            amount: receipt.amount || config.pricePerRequest,
            token: config.paymentToken,
            payer: receipt.payer || "unknown",
            txId: receipt.transaction,
            success: true,
          };

          analytics.recordPayment(event);
          logPayment(event.amount, event.token, event.payer, event.path);

          if (onPayment) {
            onPayment(event);
          }
        } catch {
          // Ignore parsing errors
        }
      }

      return originalSend(body);
    };

    next();
  });

  // Proxy middleware to forward requests to the target
  const proxyOptions: ProxyOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (proxyReq, req) => {
        // Forward relevant headers
        if (req.headers["content-type"]) {
          proxyReq.setHeader("Content-Type", req.headers["content-type"]);
        }
        logger.verbose(`Proxying ${req.method} ${req.url} → ${config.targetUrl}`);
      },
      proxyRes: (proxyRes, req) => {
        logger.verbose(
          `Response from ${config.targetUrl}${req.url}: ${proxyRes.statusCode}`
        );
      },
      error: (err, _req, res) => {
        logger.error(`Proxy error: ${err.message}`);
        if (res && "writeHead" in res && typeof res.writeHead === "function") {
          (res as Response).status(502).json({
            error: "Bad Gateway",
            message: "Failed to reach upstream server",
          });
        }
      },
    },
  };

  app.use("/", createProxyMiddleware(proxyOptions));

  return app;
}

/**
 * Starts the proxy server
 */
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
