/**
 * ChainPe Agent types: an AI agent that finds, pays for and uses x402 services on Arc.
 */
import type { ChainPeNetwork, PaymentRail, RankedService } from "@chainpearc/sdk";

export type { ChainPeNetwork, PaymentRail };

// ============================================================================
// LLM configuration
// ============================================================================

export type LLMMode = "api" | "local";
export type LLMProvider = "openai" | "anthropic" | "gemini" | "groq";

export interface LLMConfig {
  mode?: LLMMode; // Defaults to "api"
  provider: LLMProvider;
  model: string;
  apiKey?: string; // Optional for local mode
  baseURL?: string; // Optional custom base URL (e.g., for Ollama)
}

// ============================================================================
// Wallet and payment configuration
// ============================================================================

export type PaymentToken = "USDC";

export interface WalletConfig {
  address: string; // EVM address, derived from the private key
  useKeychain?: boolean; // The key lives in the OS keychain (default: true)
}

export interface PaymentConfig {
  preferredToken: PaymentToken;
  /** Most USDC for one call. Default "0.10". */
  maxPricePerRequest?: string;
  /** Most USDC for one task. Default "1.00". */
  maxPerRun?: string;
  /** Payment rails, in order of preference. Default: gateway, then exact. */
  rails?: PaymentRail[];
}

export interface AgentConfig {
  llm: LLMConfig;
  wallet: WalletConfig;
  payment: PaymentConfig;
  /** Default "arc-testnet". "arc" also needs ALLOW_MAINNET=true. */
  network?: ChainPeNetwork;
  /** ChainPeAccounts address. Default: the deployed contract. */
  accountsAddress?: string;
  /** ERC-8004 Reputation Registry. Default: Arc's registry. */
  reputationRegistry?: string;
}

// ============================================================================
// Services and payments
// ============================================================================

/** A service found by `discoverService`. */
export type ServiceInfo = RankedService;

export interface PaymentReceipt {
  /** On-chain tx hash (exact rail). */
  txId?: string;
  /** Circle transfer id (Gateway rail), settled in a later batch. */
  transferId?: string;
  amount: string;
  token: PaymentToken;
  rail: PaymentRail;
  recipient: string;
  timestamp: Date;
  /** The URL that was paid for. */
  service: string;
  path: string;
  /** The provider's ERC-8004 agent id, when it advertises one. */
  agentId?: string;
}

export interface PaymentSummary {
  totalSpent: Record<PaymentToken, string>;
  transactionCount: number;
  receipts: PaymentReceipt[];
}

// ============================================================================
// Task types
// ============================================================================

export interface RunOptions {
  /** Use only the service with this name. */
  provider?: string;
  /** Max agentic loop iterations. Default 10. */
  maxSteps?: number;
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
}

export interface TaskResult {
  text: string;
  success: boolean;
  steps: StepInfo[];
  payments: PaymentSummary;
  error?: string;
  duration: number;
}

export const DEFAULT_MAX_PER_CALL = "0.10";
export const DEFAULT_MAX_PER_RUN = "1.00";
export const CONFIG_PATH = "~/.chainpe/agent.json";
