/**
 * ChainPe Agent SDK Types
 * Types for the consumer-side AI agent with x402 payment capabilities (Avalanche C-Chain)
 */

// ============================================================================
// LLM Configuration
// ============================================================================

export type LLMMode = "api" | "local";
export type LLMProvider = "openai" | "anthropic" | "gemini" | "groq";

export interface LLMConfig {
  mode?: LLMMode; // Defaults to "api" for backwards compatibility
  provider: LLMProvider;
  model: string;
  apiKey?: string; // Optional for local mode
  baseURL?: string; // Optional custom base URL (e.g., for Ollama)
}

// ============================================================================
// Network / Payment Configuration
// ============================================================================

export type ChainPeNetwork = "fuji" | "avalanche";

// x402 "exact" on EVM settles in USDC.
export type PaymentToken = "USDC";

export interface WalletConfig {
  address: string; // EVM wallet address (0x), derived from the private key
  useKeychain?: boolean; // Whether the private key is stored in the OS keychain (default: true)
}

export interface PaymentConfig {
  preferredToken: PaymentToken;
  maxPricePerRequest?: string; // Optional spending limit
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
  llm: LLMConfig;
  wallet: WalletConfig;
  payment: PaymentConfig;
  registryPath?: string;
  network?: ChainPeNetwork;
  registryAddress?: string; // Deployed ChainPeRegistry contract address (0x)
  reputationRegistry?: string; // ERC-8004 Reputation Registry address (0x)
}

// ============================================================================
// Registry Types
// ============================================================================

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string;
  network: ChainPeNetwork;
  agentId?: string; // ERC-8004 agent identity
  createdAt?: string;
  updatedAt?: string;
}

export interface Registry {
  version: string;
  services: ServiceInfo[];
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentReceipt {
  txId?: string;
  amount: string;
  token: PaymentToken;
  recipient: string;
  timestamp: Date;
  service: string;
  path: string;
}

export interface PaymentSummary {
  totalSpent: Record<PaymentToken, string>;
  transactionCount: number;
  receipts: PaymentReceipt[];
}

// ============================================================================
// Task Types
// ============================================================================

export interface RunOptions {
  provider?: string; // Service name to use
  maxSteps?: number; // Max agentic loop iterations
  verbose?: boolean;
  onStep?: (step: StepInfo) => void;
  onPayment?: (receipt: PaymentReceipt) => void;
}

export interface StepInfo {
  stepNumber: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  text?: string;
  thinking?: string;
}

export interface TaskResult {
  text: string;
  success: boolean;
  steps: StepInfo[];
  payments: PaymentSummary;
  error?: string;
  duration: number;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultInfo {
  name: string;
  result: unknown;
}

// ============================================================================
// HTTP Client Types
// ============================================================================

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  paid?: boolean;
  paymentReceipt?: PaymentReceipt;
}

// ============================================================================
// Constants — Avalanche C-Chain
// ============================================================================

export const CHAIN_IDS: Record<ChainPeNetwork, number> = {
  fuji: 43113,
  avalanche: 43114,
};

export const RPC_URLS: Record<ChainPeNetwork, string> = {
  fuji: "https://api.avax-test.network/ext/bc/C/rpc",
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
};

// Canonical Circle USDC (6 decimals).
export const USDC_ADDRESS: Record<ChainPeNetwork, `0x${string}`> = {
  fuji: "0x5425890298aed601595a70AB815c96711a31Bc65",
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};

// x402 network identifiers.
export const X402_NETWORK: Record<ChainPeNetwork, "avalanche-fuji" | "avalanche"> = {
  fuji: "avalanche-fuji",
  avalanche: "avalanche",
};

export const EXPLORER: Record<ChainPeNetwork, string> = {
  fuji: "https://testnet.snowtrace.io",
  avalanche: "https://snowtrace.io",
};

export const USDC_DECIMALS = 6;

export const DEFAULT_REGISTRY_PATH = "~/.chainpe/registry.json";
export const CONFIG_PATH = "~/.chainpe/agent.json";
