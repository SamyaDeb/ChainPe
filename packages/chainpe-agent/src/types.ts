/**
 * ChainPe Agent SDK Types
 * Types for the consumer-side AI agent with x402 payment capabilities
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
// Payment Configuration
// ============================================================================

export type PaymentToken = "ALGO" | "USDC";

export interface WalletConfig {
  address: string; // Wallet address (required, derived from mnemonic)
  useKeychain?: boolean; // Whether mnemonic is stored in OS keychain (default: true)
  // Note: mnemonic is now stored securely in OS keychain, not in config file
}

/**
 * Legacy wallet config for migration purposes
 * @deprecated Use WalletConfig with keychain storage instead
 */
export interface LegacyWalletConfig {
  mnemonic: string; // Plaintext mnemonic (INSECURE - migrate to keychain)
  address?: string;
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
  network?: "testnet" | "mainnet";
  registryAppId?: string; // Algorand App ID as string (stored after deployment)
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
  network: "testnet" | "mainnet";
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
// Tool Types (for Vercel AI SDK v4)
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
// x402 Types
// ============================================================================

export interface PaymentRequirementsHeader {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

export const ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";

export const USDC_TESTNET_ASA_ID = 10458941;
export const USDC_MAINNET_ASA_ID = 31566704;

export const ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
export const ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";

export const INDEXER_TESTNET_URL = "https://testnet-idx.algonode.cloud";
export const INDEXER_MAINNET_URL = "https://mainnet-idx.algonode.cloud";

export const DEFAULT_REGISTRY_PATH = "~/.chainpe/registry.json";
export const CONFIG_PATH = "~/.chainpe/agent.json";
