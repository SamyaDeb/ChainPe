import { ChainPe, type PaymentRail } from '@chainpearc/sdk'
import type { AppConfig } from '@/types.js'

/** Builds an SDK client for the configured wallet. Throws when there is no key. */
export function clientFor(
  config: AppConfig,
  options: { maxPerCall?: string; rails?: PaymentRail[] } = {}
): ChainPe {
  if (!config.privateKey) throw new Error('No private key configured')
  return new ChainPe({
    privateKey: config.privateKey,
    network: config.network,
    rails: options.rails ?? config.rails,
    accountsAddress: config.accountsAddress,
    reputationRegistry: config.reputationRegistry,
    maxPerCall: options.maxPerCall
  })
}

export const NO_WALLET_MESSAGE =
  'No wallet configured. Set CHAINPE_PRIVATE_KEY environment variable.'

/** The result of a tool that failed. */
export function toolError(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

/** The JSON result of a tool. */
export function toolJson(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
