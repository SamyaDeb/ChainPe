import type { PaymentRail } from '@chainpearc/sdk'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import { loadWalletConfig } from '@/wallet-store.js'

export function loadConfig(): AppConfig {
  const state = buildState()
  return {
    ...state,
    reload() {
      const fresh = buildState()
      Object.assign(this, fresh)
    }
  }
}

/** Anything but an explicit, allowed mainnet is testnet, so a typo can't spend real USDC. */
function normalizeNetwork(value: string | undefined): PaymentNetwork {
  if (value !== 'arc') return 'arc-testnet'
  if (process.env.ALLOW_MAINNET === 'true') return 'arc'
  console.error(
    'NETWORK=arc takes real USDC and is not tested yet. Using arc-testnet. Set ALLOW_MAINNET=true to use it anyway.'
  )
  return 'arc-testnet'
}

function parseRails(value: string | undefined): PaymentRail[] {
  const rails = (value ?? '')
    .split(',')
    .map(rail => rail.trim())
    .filter(
      (rail): rail is PaymentRail => rail === 'gateway' || rail === 'exact'
    )
  return rails.length > 0 ? rails : ['gateway', 'exact']
}

function buildState(): Omit<AppConfig, 'reload'> {
  const wallet = loadWalletConfig()

  // An empty value from the Claude Desktop form means not set.
  const privateKey =
    process.env.CHAINPE_PRIVATE_KEY || wallet?.privateKey || undefined
  const network = normalizeNetwork(process.env.NETWORK || wallet?.network)
  const accountsAddress =
    process.env.CHAINPE_ACCOUNTS_ADDRESS || wallet?.accountsAddress || undefined
  const reputationRegistry =
    process.env.ERC8004_REPUTATION_REGISTRY ||
    wallet?.reputationRegistry ||
    undefined

  const maxPerCall = process.env.MAX_PER_CALL || '0.10'
  const maxPerDay = process.env.MAX_PER_DAY || '20.00'

  const canPay = !!privateKey

  return {
    privateKey,
    network,
    rails: parseRails(process.env.RAILS),
    accountsAddress,
    reputationRegistry,
    budget: { maxPerCall, maxPerDay },
    canPay,
    mode: canPay ? 'ARC' : 'READ_ONLY'
  }
}
