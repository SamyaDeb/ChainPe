/**
 * ChainPe Agent SDK
 * Pre-built AI agent with x402 payment capabilities on Avalanche C-Chain.
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
  getDefaultRegistryPath,
  isValidPrivateKey,
  isValidAddress,
  addressFromPrivateKey,
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
export {
  createWalletFromPrivateKey,
  createWalletFromAddress,
  createClient,
  getWalletBalance,
  hasSufficientUsdc,
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
export { PaymentClient, createPaymentClient, type PaymentClientOptions } from "./payment.js";

// Reputation (ERC-8004, on-chain)
export {
  getReputation,
  giveFeedback,
  resolveReputationRegistry,
  type ReputationSummary,
} from "./reputation.js";

// Tools (for advanced users who want to customize the agent)
export {
  createDiscoverServiceTool,
  createCallPaidApiTool,
  createCallFreeApiTool,
  formatServiceForDisplay,
  type DiscoverServiceToolOptions,
  type CallPaidApiToolOptions,
} from "./tools/index.js";
