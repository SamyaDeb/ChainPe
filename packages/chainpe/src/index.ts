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
  createGateway,
  GatewayGuard,
  RailRouter,
} from "./proxy/index.js";
export type {
  RoutesConfig,
  CircleClient,
  FacilitatorMode,
  SettlementGuardOptions,
  GatewayGuardOptions,
  GatewayTerms,
} from "./proxy/index.js";

// EVM helpers
export {
  createClient,
  isValidAddress,
  toChecksum,
  getUsdcBalance,
  formatUsdc,
  parseUsdc,
} from "./evm.js";

// Provider accounts and identity on Arc
export { AccountsReader, AccountsWriter, accountsAddress, serviceKey } from "./accounts.js";
export type { OnChainService, ProviderAccount, ServiceInput } from "./accounts.js";
export { ensureIdentity, IDENTITY_REGISTRY_ABI } from "./erc8004.js";
export { chainPeAccountsAbi } from "./abi/ChainPeAccounts.js";

// Logger
export { logger, setLogLevel, getLogLevel, logPayment, logRequest, logServerStart } from "./logger.js";
