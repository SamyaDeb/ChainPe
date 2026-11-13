/**
 * Configuration Manager (Avalanche C-Chain)
 *
 * Loads/saves agent configuration from ~/.chainpe/agent.json.
 *
 * SECURITY: Wallet private keys are stored in the OS keychain, NOT in the config
 * file. The config file only stores the wallet address and a keychain flag.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { isAddress, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { AgentConfig, LLMProvider, PaymentToken, LLMMode, ChainPeNetwork } from "./types.js";
import { savePrivateKey, getPrivateKey } from "./keychain.js";
import { addressFromPrivateKey } from "./wallet.js";

const CONFIG_DIR = path.join(os.homedir(), ".chainpe");
const CONFIG_FILE = path.join(CONFIG_DIR, "agent.json");
const DEFAULT_REGISTRY_PATH = path.join(CONFIG_DIR, "registry.json");

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/** Loads the agent configuration from disk (null if none). */
export async function loadConfig(): Promise<AgentConfig | null> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8")) as AgentConfig;
    if (!config.llm.mode) config.llm.mode = "api";
    if (config.wallet.useKeychain === undefined) config.wallet.useKeychain = true;
    return config;
  } catch {
    return null;
  }
}

/** Saves the agent configuration (never writes the private key). */
export async function saveConfig(config: AgentConfig): Promise<void> {
  await ensureConfigDir();
  const clean = {
    llm: config.llm,
    wallet: {
      address: config.wallet.address,
      useKeychain: config.wallet.useKeychain !== false,
    },
    payment: config.payment,
    registryPath: config.registryPath,
    registryAddress: config.registryAddress,
    reputationRegistry: config.reputationRegistry,
    network: config.network,
  };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(clean, null, 2), { mode: 0o600 });
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getDefaultRegistryPath(): string {
  return DEFAULT_REGISTRY_PATH;
}

// ============================================================================
// Keychain integration
// ============================================================================

export async function saveWalletToKeychain(walletAddress: string, privateKey: string): Promise<void> {
  await savePrivateKey(walletAddress, privateKey);
}

export async function getWalletPrivateKey(walletAddress: string): Promise<string | null> {
  return getPrivateKey(walletAddress);
}

export async function isWalletAvailable(walletAddress: string): Promise<boolean> {
  return (await getWalletPrivateKey(walletAddress)) !== null;
}

// ============================================================================
// Wallet utilities
// ============================================================================

export { addressFromPrivateKey };

/** Validates an EVM private key (0x + 64 hex). */
export function isValidPrivateKey(privateKey: string): boolean {
  try {
    privateKeyToAccount((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`);
    return true;
  } catch {
    return false;
  }
}

/** Validates an EVM wallet address. */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

export function toChecksum(address: string): string {
  return getAddress(address);
}

// ============================================================================
// Config builder
// ============================================================================

export interface ConfigBuilder {
  llmMode?: LLMMode;
  llmProvider: LLMProvider;
  llmModel: string;
  llmApiKey?: string;
  llmBaseURL?: string;
  walletAddress: string;
  preferredToken: PaymentToken;
  registryPath?: string;
  registryAddress?: string;
  reputationRegistry?: string;
  network?: ChainPeNetwork;
}

export function buildConfig(builder: ConfigBuilder): AgentConfig {
  const llm: AgentConfig["llm"] = {
    mode: builder.llmMode || "api",
    provider: builder.llmProvider,
    model: builder.llmModel,
  };
  if (builder.llmApiKey) llm.apiKey = builder.llmApiKey;
  if (builder.llmBaseURL) llm.baseURL = builder.llmBaseURL;

  return {
    llm,
    wallet: { address: builder.walletAddress, useKeychain: true },
    payment: { preferredToken: builder.preferredToken },
    registryPath: builder.registryPath || DEFAULT_REGISTRY_PATH,
    registryAddress: builder.registryAddress,
    reputationRegistry: builder.reputationRegistry,
    network: builder.network || "fuji",
  };
}

// ============================================================================
// Default model suggestions
// ============================================================================

export const DEFAULT_MODELS: Record<LLMProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro-latest", "gemini-1.5-flash-latest"],
  groq: ["qwen/qwen3-32b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
};

export function getDefaultModel(provider: LLMProvider): string {
  return DEFAULT_MODELS[provider][0];
}
