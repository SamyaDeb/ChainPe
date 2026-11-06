/**
 * @chainpearc/sdk — x402 USDC payments on Arc, service discovery and ERC-8004
 * reputation, in a few lines.
 *
 * @example
 * ```ts
 * import { ChainPe } from '@chainpearc/sdk'
 *
 * const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY! })
 * const res = await cp.fetch('https://api.example.com/paid')
 * console.log(await res.json())
 * ```
 */
export { ChainPe, railPolicy } from './chainpe.js'

export { searchCircle, mapCircleItem, mergeListings, CIRCLE_DISCOVERY_URL } from './discovery.js'

export {
  RegistryClient,
  filterServices,
  rankByReputation,
  decodeService
} from './registry.js'
export type { RawService } from './registry.js'

export {
  getReputation,
  giveFeedback,
  summaryToScore
} from './reputation.js'
export type { GiveFeedbackParams } from './reputation.js'

export { PolicyVaultClient } from './policyvault.js'
export type {
  PolicyVaultOptions,
  PolicyParams,
  SpendAuthorization
} from './policyvault.js'

export {
  publicClientFor,
  resolveAccountsAddress,
  resolveReputationRegistry,
  getUsdcAddress,
  getCaip2,
  explorerFor,
  rpcUrlFor,
  USDC_DECIMALS
} from './networks.js'

export { ChainPePaymentError } from './types.js'
export type {
  ChainPeNetwork,
  ChainPeOptions,
  PaymentRail,
  FetchOptions,
  ChainPeService,
  DiscoverOptions,
  ReputationSummary,
  RankedService,
  PaymentInfo,
  PaidResult,
  Balances
} from './types.js'
