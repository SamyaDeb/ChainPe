/**
 * ChainPe - Provider SDK
 * Monetize any API with x402 micropayments on Arc.
 */

// Types
export * from "./types.js";

// Networks
export {
  NETWORKS,
  getNetwork,
  parseNetwork,
  fromX402Network,
  explorerTxUrl,
  USDC_DECIMALS,
} from "./chains.js";
export type { ChainPeNetwork, GasToken, NetworkInfo } from "./chains.js";

// Proxy Server
export {
  createProxyServer,
  startProxyServer,
  analytics,
  Analytics,
  createRoutesConfig,
  formatRoutesForDisplay,
  assertExactSupported,
  createCircleFacilitator,
  facilitatorMode,
  paymentIdentifierFor,
  resolveSellerSigner,
  SettlementGuard,
} from "./proxy/index.js";
export type { RoutesConfig, CircleClient, FacilitatorMode, SettlementGuardOptions } from "./proxy/index.js";

// EVM helpers
export {
  createClient,
  isValidAddress,
  toChecksum,
  getUsdcBalance,
  formatUsdc,
  parseUsdc,
} from "./evm.js";

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
