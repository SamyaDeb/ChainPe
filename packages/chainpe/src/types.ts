/**
 * ChainPe Provider Types
 * Algorand-native types for x402 payment gateway
 */

import type { PaymentRequirements } from "@x402-avm/core/types";

// ============================================================================
// Algorand Constants
// ============================================================================

export const ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const ALGORAND_WILDCARD_CAIP2 = "algorand:*";

export const USDC_TESTNET_ASA_ID = 10458941;
export const USDC_MAINNET_ASA_ID = 31566704;
export const USDC_DECIMALS = 6;
export const ALGO_DECIMALS = 6;

export const ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
export const ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";
export const FACILITATOR_URL = "https://facilitator.x402.goplausible.xyz";

// ============================================================================
// Payment Token
// ============================================================================

export type PaymentToken = "ALGO" | "USDC";

export interface TokenInfo {
  symbol: PaymentToken;
  decimals: number;
  asaId?: number; // undefined for ALGO (native token)
  name: string;
}

export const TOKENS: Record<PaymentToken, TokenInfo> = {
  ALGO: {
    symbol: "ALGO",
    decimals: ALGO_DECIMALS,
    name: "Algorand",
  },
  USDC: {
    symbol: "USDC",
    decimals: USDC_DECIMALS,
    asaId: USDC_TESTNET_ASA_ID,
    name: "USD Coin",
  },
};

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
  pricePerRequest: string; // Human-readable, e.g., "0.01"
  paymentToken: PaymentToken;

  // Wallet
  walletAddress: string;
  mnemonic?: string; // 25-word Algorand mnemonic (stored separately, not in config file)

  // Server
  proxyPort: number;

  // Network
  network: "testnet" | "mainnet";

  // Registry App ID (stored after deployment, auto-read by all commands)
  registryAppId?: string; // Algorand App ID as string (bigint serialization)

  // Optional settings
  logLevel?: "verbose" | "normal" | "quiet";
  adminKey?: string;
  rateLimit?: number;
}

// ============================================================================
// Registry Types
// ============================================================================

export interface ServiceRegistration {
  id: string; // UUID
  name: string;
  description: string;
  tags: string[];
  endpoint: string; // Full URL to the x402-protected endpoint
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string;
  network: "testnet" | "mainnet";
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
  pricePerRequest: string; // Human-readable price
  paymentToken: PaymentToken;
  description?: string;
}

export interface ResolvedRoute {
  path: string;
  requirements: PaymentRequirements;
}

// ============================================================================
// Analytics
// ============================================================================

export interface RequestStats {
  totalRequests: number;
  paidRequests: number;
  failedPayments: number;
  totalRevenue: bigint;
  revenueByToken: Record<PaymentToken, bigint>;
  requestsPerMinute: number[];
  lastHourRequests: number;
}

export interface PaymentEvent {
  timestamp: Date;
  path: string;
  amount: string;
  token: PaymentToken;
  payer: string;
  txId?: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Server State
// ============================================================================

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
  mnemonic: string;
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
