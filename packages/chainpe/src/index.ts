/**
 * ChainPe - Provider SDK
 * Monetize any API with x402 micropayments on Algorand
 */

// Types
export * from "./types.js";

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

// Algorand Facilitator
export {
  createFacilitatorClient,
  createAlgodClient,
  isValidAlgorandAddress,
  isValidMnemonic,
  addressFromMnemonic,
  getAccountInfo,
  formatAlgo,
  parseAmount,
} from "./facilitator/index.js";

// On-Chain Registry
export { ChainPeRegistryClient, onChainToServiceRegistration } from "./registry.js";
export type { RegistrationResult, OnChainService } from "./registry.js";

// Logger
export { logger, setLogLevel, getLogLevel, logPayment, logRequest, logServerStart } from "./logger.js";
