/**
 * ChainPe Agent SDK
 * Pre-built AI agent with x402 payment capabilities on Algorand
 * 
 * SECURITY: Wallet mnemonics are stored in OS keychain, never in plaintext files.
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
  getDefaultRegistryPath,
  isValidMnemonic,
  isValidAddress,
  addressFromMnemonic,
  DEFAULT_MODELS,
  getDefaultModel,
  saveWalletToKeychain,
  getWalletMnemonic,
  isWalletAvailable,
  migrateToSecureStorage,
  isLegacyConfig,
  type ConfigBuilder,
} from "./config.js";

// Keychain (Secure Credential Storage)
export {
  saveMnemonic,
  getMnemonic,
  deleteMnemonic,
  hasMnemonic,
  listStoredWallets,
  clearAllCredentials,
  isKeychainAvailable,
  migrateToKeychain,
  getCredentialInfo,
} from "./keychain.js";

// Wallet
export {
  createWalletFromMnemonic,
  createWalletFromConfig,
  createWalletFromAddress,
  createAlgodClient,
  getWalletBalance,
  hasSufficientBalance,
  formatAmount,
  parseAmount,
  formatBalance,
  type WalletInstance,
  type WalletBalance,
} from "./wallet.js";

// Registry
export {
  RegistryClient,
  loadRegistry,
  registryExists,
  searchServices,
  findServiceByName,
  findServiceById,
  getAllTags,
  getServiceStats,
  type SearchOptions,
} from "./registry.js";

// Payment
export {
  PaymentClient,
  createPaymentClient,
  type PaymentClientOptions,
} from "./payment.js";

// Tools (for advanced users who want to customize the agent)
export {
  createDiscoverServiceTool,
  createCallPaidApiTool,
  createCallFreeApiTool,
  formatServiceForDisplay,
  type DiscoverServiceToolOptions,
  type CallPaidApiToolOptions,
} from "./tools/index.js";
