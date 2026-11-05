/**
 * ChainPe Provider Types
 *
 * EVM-native types for the x402 payment gateway. Payment gating uses USDC via
 * the x402 "exact" scheme (EIP-3009 transferWithAuthorization). Prices are
 * expressed as human-readable USDC, e.g. "0.01".
 */

import type { ChainPeNetwork } from "./chains.js";

export type { ChainPeNetwork, GasToken } from "./chains.js";

// ============================================================================
// Payment Token
// ============================================================================

// x402 "exact" on EVM settles in USDC. The network's gas token is paid by the
// facilitator and is not a payment-gating token.
export type PaymentToken = "USDC";

// ============================================================================
// Provider Configuration
// ============================================================================

export interface ChainPeConfig {
  // Service identity
  serviceName: string;
  serviceDescription: string;
  tags: string[];

  // Backend target
  targetUrl: string;

  // Pricing
  pricePerRequest: string; // Human-readable USDC, e.g. "0.01"
  paymentToken: PaymentToken;

  // Wallet (0x address that receives payments)
  walletAddress: string;

  // Server
  proxyPort: number;

  // Network
  network: ChainPeNetwork;

  // Payment rails to accept. Default: all of them.
  rails?: PaymentRail[];

  // Routes priced differently from pricePerRequest, e.g. { path: "GET /weather", ... }.
  routes?: RouteConfig[];

  // Deployed ChainPeRegistry contract address (0x...)
  registryAddress?: string;

  // ERC-8004 agent identity for this service (persisted on register). When set,
  // the proxy advertises it on 402 responses so consumers can leave reputation
  // feedback without scanning the registry. Override via CHAINPE_AGENT_ID.
  agentId?: string;

  // Optional settings
  logLevel?: "verbose" | "normal" | "quiet";
  adminKey?: string;
  rateLimit?: number;
}

// ============================================================================
// Registry Types
// ============================================================================

export interface ServiceRegistration {
  id: string; // "<developer>:<name>"
  name: string;
  description: string;
  tags: string[];
  endpoint: string; // Full URL to the x402-protected endpoint
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string; // payTo (0x)
  developer: string; // 0x address that registered
  network: ChainPeNetwork;
  agentId?: string; // ERC-8004 agent identity (optional)
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Registry {
  version: string;
  services: ServiceRegistration[];
}

// ============================================================================
// Route Configuration
// ============================================================================

export interface RouteConfig {
  path: string;
  pricePerRequest: string; // Human-readable USDC
  paymentToken: PaymentToken;
  description?: string;
}

// ============================================================================
// Analytics
// ============================================================================

export interface RequestStats {
  totalRequests: number;
  paidRequests: number;
  failedPayments: number;
  chargedButBackendFailed: number; // settled, then the backend answered 5xx or was unreachable
  totalRevenue: bigint; // atomic USDC (6 decimals)
  revenueByToken: Record<PaymentToken, bigint>;
  revenueByRail: Record<PaymentRail, bigint>;
  revenueByNetwork: Record<string, bigint>;
  requestsPerMinute: number[];
  lastHourRequests: number;
}

export type PaymentRail = "exact" | "gateway";

export interface PaymentEvent {
  id: string;
  ts: number;
  route: string;
  method: string;
  rail: PaymentRail;
  network: string; // CAIP-2
  amountAtomic: string; // atomic USDC (6 decimals)
  payer: string;
  payTo: string;
  txHash?: string;
  paymentId?: string;
  status: "completed" | "failed" | "pending";
  latencyMs: number;
  backendStatus?: number;
  error?: string;
}

export interface ServerState {
  isRunning: boolean;
  startedAt?: Date;
  config: ChainPeConfig;
  stats: RequestStats;
  recentPayments: PaymentEvent[];
}

// ============================================================================
// CLI Types
// ============================================================================

export interface InitAnswers {
  targetUrl: string;
  serviceName: string;
  serviceDescription: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  tags: string;
  walletAddress: string;
  proxyPort: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export type LogLevel = "verbose" | "normal" | "quiet";

export interface Logger {
  verbose: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  success: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}
