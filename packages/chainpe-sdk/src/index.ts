/**
 * @chainpe/sdk — x402 USDC payments + on-chain ERC-8004 reputation for the
 * Avalanche agent economy, in a few lines.
 *
 * @example
 * ```ts
 * import { ChainPe } from '@chainpe/sdk'
 *
 * const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY!, network: 'fuji' })
 * const res = await cp.fetch('https://api.example.com/paid')
 * console.log(await res.json())
 * ```
 */
export { ChainPe } from './chainpe.js'

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
  resolveRegistryAddress,
  resolveReputationRegistry,
  getUsdcAddress,
  getX402Network,
  rpcUrlFor,
  USDC_DECIMALS
} from './networks.js'

export { ChainPePaymentError } from './types.js'
export type {
  ChainPeNetwork,
  ChainPeOptions,
  FetchOptions,
  ChainPeService,
  DiscoverOptions,
  ReputationSummary,
  RankedService,
  PaymentInfo,
  PaidResult,
  Balances
} from './types.js'
