/**
 * ChainPe - Provider SDK
 * Monetize any API with x402 micropayments on Avalanche C-Chain.
 */

// Types
export * from "./types.js";

// Networks
export {
  NETWORKS,
  getNetwork,
  fromX402Network,
  explorerTxUrl,
  USDC_DECIMALS,
} from "./chains.js";
export type { ChainPeNetwork, NetworkInfo } from "./chains.js";

// Proxy Server
export {
  createProxyServer,
  startProxyServer,
  analytics,
  Analytics,
  createRoutesConfig,
  formatRoutesForDisplay,
} from "./proxy/index.js";
export type { RoutesConfig } from "./proxy/index.js";

// EVM helpers
export {
  createClient,
  isValidAddress,
  toChecksum,
  getAccountBalances,
  formatUsdc,
  formatAvax,
  parseUsdc,
} from "./evm.js";
export type { AccountBalances } from "./evm.js";

// On-Chain Registry
export {
  ChainPeRegistryClient,
  onChainToServiceRegistration,
  resolveRegistryAddress,
  CHAINPE_REGISTRY_ABI,
} from "./registry.js";
export type { RegistrationResult, OnChainService } from "./registry.js";

// Browser / MetaMask registration handoff
export { registerViaBrowser } from "./wallet-connect-browser.js";
export type { BrowserRegisterParams, BrowserRegisterResult } from "./wallet-connect-browser.js";

// Logger
export { logger, setLogLevel, getLogLevel, logPayment, logRequest, logServerStart } from "./logger.js";
