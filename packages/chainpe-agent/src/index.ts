/**
 * ChainPe Agent SDK
 * A pre-built AI agent that finds, pays for and uses x402 services on Arc.
 *
 * SECURITY: Wallet private keys are stored in the OS keychain, never in plaintext files.
 */

// Main Agent
export { ChainPeAgent, createAgent, type ChainPeAgentOptions } from "./agent.js";

// Types
export * from "./types.js";

// Configuration
export {
  loadConfig,
  saveConfig,
  configExists,
  buildConfig,
  getConfigPath,
  isValidPrivateKey,
  isValidAddress,
  toChecksum,
  DEFAULT_MODELS,
  getDefaultModel,
  saveWalletToKeychain,
  getWalletPrivateKey,
  isWalletAvailable,
  type ConfigBuilder,
} from "./config.js";

// Keychain (Secure Credential Storage)
export {
  savePrivateKey,
  getPrivateKey,
  deletePrivateKey,
  hasPrivateKey,
  listStoredWallets,
  clearAllCredentials,
  isKeychainAvailable,
  getCredentialInfo,
} from "./keychain.js";

// Wallet
export { addressFromPrivateKey, getWalletBalance, formatBalance, type WalletBalance } from "./wallet.js";

// Discovery, payments and reputation come from the SDK
export { ChainPe, discoverServices } from "@chainpearc/sdk";

// Tools (for advanced users who want to customize the agent)
export {
  createDiscoverServiceTool,
  createCallPaidApiTool,
  createCallFreeApiTool,
  formatServiceForDisplay,
  RunBudget,
  type DiscoverServiceToolOptions,
  type CallPaidApiToolOptions,
} from "./tools/index.js";
