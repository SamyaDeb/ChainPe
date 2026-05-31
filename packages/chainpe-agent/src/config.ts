/**
 * Configuration Manager
 * Handles loading and saving agent configuration from ~/.chainpe/agent.json
 * 
 * SECURITY: Wallet mnemonics are stored in OS keychain, NOT in the config file.
 * The config file only stores the wallet address and a flag indicating keychain usage.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import algosdk from "algosdk";

import type { AgentConfig, LLMProvider, PaymentToken, LLMMode, LegacyWalletConfig } from "./types.js";
import { saveMnemonic, getMnemonic, hasMnemonic, isKeychainAvailable, migrateToKeychain } from "./keychain.js";

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".chainpe");
const CONFIG_FILE = path.join(CONFIG_DIR, "agent.json");
const DEFAULT_REGISTRY_PATH = path.join(CONFIG_DIR, "registry.json");

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Ensures the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * Loads the agent configuration from disk
 * Returns null if no configuration exists
 * 
 * NOTE: This function does NOT load the mnemonic from keychain.
 * Use getWalletMnemonic() to retrieve the mnemonic when needed.
 */
export async function loadConfig(): Promise<AgentConfig | null> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const rawConfig = JSON.parse(data);

    // Check for legacy config with plaintext mnemonic
    if (rawConfig.wallet?.mnemonic) {
      // This is a legacy config - we'll handle migration separately
      // For now, derive address if missing
      if (!rawConfig.wallet.address) {
        rawConfig.wallet.address = addressFromMnemonic(rawConfig.wallet.mnemonic);
      }
      // Mark as legacy (not using keychain)
      rawConfig.wallet._isLegacy = true;
    }

    const config = rawConfig as AgentConfig;

    // Migration: Add default mode if not present (backwards compatibility)
    if (!config.llm.mode) {
      config.llm.mode = "api";
    }

    // Set default useKeychain if not present
    if (config.wallet.useKeychain === undefined) {
      // If we detected legacy config, it's not using keychain
      config.wallet.useKeychain = !(rawConfig.wallet as any)._isLegacy;
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Checks if the current config is using legacy plaintext storage
 */
export async function isLegacyConfig(): Promise<boolean> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const rawConfig = JSON.parse(data);
    return !!(rawConfig.wallet?.mnemonic);
  } catch {
    return false;
  }
}

/**
 * Gets the legacy mnemonic from config file (for migration)
 */
export async function getLegacyMnemonic(): Promise<string | null> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const rawConfig = JSON.parse(data);
    return rawConfig.wallet?.mnemonic || null;
  } catch {
    return null;
  }
}

/**
 * Saves the agent configuration to disk
 * NOTE: This does NOT save the mnemonic to the config file.
 * Use saveWalletToKeychain() to store the mnemonic securely.
 */
export async function saveConfig(config: AgentConfig): Promise<void> {
  await ensureConfigDir();

  // Create a clean config without any mnemonic
  const cleanConfig = {
    llm: config.llm,
    wallet: {
      address: config.wallet.address,
      useKeychain: config.wallet.useKeychain !== false, // Default to true
    },
    payment: config.payment,
    registryPath: config.registryPath,
    registryAppId: config.registryAppId,
    network: config.network,
  };

  await fs.writeFile(CONFIG_FILE, JSON.stringify(cleanConfig, null, 2), {
    mode: 0o600, // Read/write only for owner (contains API keys)
  });
}

/**
 * Checks if configuration exists
 */
export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the config file path
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Returns the default registry path
 */
export function getDefaultRegistryPath(): string {
  return DEFAULT_REGISTRY_PATH;
}

// ============================================================================
// Keychain Integration
// ============================================================================

/**
 * Saves wallet mnemonic to OS keychain
 * This is the secure way to store the mnemonic
 */
export async function saveWalletToKeychain(
  walletAddress: string,
  mnemonic: string
): Promise<void> {
  await saveMnemonic(walletAddress, mnemonic);
}

/**
 * Gets wallet mnemonic from OS keychain
 * Returns null if not found or keychain unavailable
 */
export async function getWalletMnemonic(walletAddress: string): Promise<string | null> {
  // First try keychain
  const mnemonic = await getMnemonic(walletAddress);
  if (mnemonic) {
    return mnemonic;
  }

  // Fallback: check for legacy config
  const legacyMnemonic = await getLegacyMnemonic();
  if (legacyMnemonic) {
    const legacyAddress = addressFromMnemonic(legacyMnemonic);
    if (legacyAddress === walletAddress) {
      return legacyMnemonic;
    }
  }

  return null;
}

/**
 * Checks if wallet mnemonic is available (either in keychain or legacy config)
 */
export async function isWalletAvailable(walletAddress: string): Promise<boolean> {
  const mnemonic = await getWalletMnemonic(walletAddress);
  return mnemonic !== null;
}

/**
 * Migrates legacy plaintext config to secure keychain storage
 */
export async function migrateToSecureStorage(): Promise<{
  success: boolean;
  address?: string;
  error?: string;
}> {
  try {
    // Check if keychain is available
    const keychainAvailable = await isKeychainAvailable();
    if (!keychainAvailable) {
      return { success: false, error: "OS keychain is not available on this system" };
    }

    // Check for legacy config
    const legacyMnemonic = await getLegacyMnemonic();
    if (!legacyMnemonic) {
      return { success: false, error: "No legacy configuration found to migrate" };
    }

    // Get or derive address
    const address = addressFromMnemonic(legacyMnemonic);

    // Check if already in keychain
    const alreadyMigrated = await hasMnemonic(address);
    if (alreadyMigrated) {
      // Just update the config file to remove plaintext mnemonic
      const config = await loadConfig();
      if (config) {
        config.wallet.useKeychain = true;
        await saveConfig(config);
      }
      return { success: true, address };
    }

    // Migrate to keychain
    const migrated = await migrateToKeychain(address, legacyMnemonic);
    if (!migrated) {
      return { success: false, error: "Failed to store mnemonic in keychain" };
    }

    // Update config file to remove plaintext mnemonic
    const config = await loadConfig();
    if (config) {
      config.wallet.address = address;
      config.wallet.useKeychain = true;
      await saveConfig(config);
    }

    return { success: true, address };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Wallet Utilities
// ============================================================================

/**
 * Derives wallet address from mnemonic
 */
export function addressFromMnemonic(mnemonic: string): string {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  return account.addr.toString();
}

/**
 * Validates a 25-word Algorand mnemonic
 */
export function isValidMnemonic(mnemonic: string): boolean {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 25) {
    return false;
  }

  try {
    algosdk.mnemonicToSecretKey(mnemonic);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an Algorand wallet address
 */
export function isValidAddress(address: string): boolean {
  if (!address || address.length !== 58) {
    return false;
  }

  try {
    algosdk.decodeAddress(address);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Config Builder Helpers
// ============================================================================

export interface ConfigBuilder {
  llmMode?: LLMMode; // Defaults to "api"
  llmProvider: LLMProvider;
  llmModel: string;
  llmApiKey?: string; // Optional for local mode
  llmBaseURL?: string; // Optional custom base URL
  walletAddress: string; // Wallet address (mnemonic stored in keychain)
  preferredToken: PaymentToken;
  registryPath?: string;
  registryAppId?: string;
  network?: "testnet" | "mainnet";
}

/**
 * Creates an AgentConfig from builder parameters
 * NOTE: This does NOT include the mnemonic - it should be stored in keychain separately
 */
export function buildConfig(builder: ConfigBuilder): AgentConfig {
  const llmConfig: any = {
    mode: builder.llmMode || "api",
    provider: builder.llmProvider,
    model: builder.llmModel,
  };

  // Only add apiKey if provided (not needed for local mode)
  if (builder.llmApiKey) {
    llmConfig.apiKey = builder.llmApiKey;
  }

  // Only add baseURL if provided (for local mode)
  if (builder.llmBaseURL) {
    llmConfig.baseURL = builder.llmBaseURL;
  }

  return {
    llm: llmConfig,
    wallet: {
      address: builder.walletAddress,
      useKeychain: true, // Always use keychain for new configs
    },
    payment: {
      preferredToken: builder.preferredToken,
    },
    registryPath: builder.registryPath || DEFAULT_REGISTRY_PATH,
    registryAppId: builder.registryAppId,
    network: builder.network || "testnet",
  };
}

// ============================================================================
// Default Model Suggestions
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
