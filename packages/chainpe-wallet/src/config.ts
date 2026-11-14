import type { PaymentNetwork, AppConfig } from '@/types.js'
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

function normalizeNetwork(value: string | undefined): PaymentNetwork {
  // Mainnet by default; only an explicit "fuji" selects the testnet.
  return value === 'fuji' ? 'fuji' : 'avalanche'
}

/** Claude Desktop passes an untouched user_config field as "", which must mean "use the default". */
function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

function buildState(): Omit<AppConfig, 'reload'> {
  const wallet = loadWalletConfig()

  const privateKey =
    blankToUndefined(process.env.CHAINPE_PRIVATE_KEY) ?? wallet?.privateKey ?? undefined
  const network = normalizeNetwork(blankToUndefined(process.env.NETWORK) ?? wallet?.network)
  const registryAddress =
    blankToUndefined(process.env.CHAINPE_REGISTRY_ADDRESS) ?? wallet?.registryAddress ?? undefined
  const reputationRegistry =
    blankToUndefined(process.env.ERC8004_REPUTATION_REGISTRY) ??
    wallet?.reputationRegistry ??
    undefined

  const maxPerCall = process.env.MAX_PER_CALL ?? '0.10'
  const maxPerDay = process.env.MAX_PER_DAY ?? '20.00'
  const maxAvaxPerTransfer = process.env.MAX_AVAX_PER_TRANSFER
  const maxAvaxPerDay = process.env.MAX_AVAX_PER_DAY

  const minReputation = parseScore(process.env.MIN_REPUTATION, 0, 'MIN_REPUTATION')
  const minPaidReviews = Math.round(parseScore(process.env.MIN_PAID_REVIEWS, 3, 'MIN_PAID_REVIEWS', Infinity))
  const cloudEnv = process.env.CHAINPE_CLOUD_URL?.trim()
  const cloudUrl = cloudEnv === 'off' ? false : cloudEnv || undefined

  const canPay = !!privateKey

  return {
    privateKey,
    network,
    registryAddress,
    reputationRegistry,
    minReputation,
    minPaidReviews,
    cloudUrl,
    budget: { maxPerCall, maxPerDay, maxAvaxPerTransfer, maxAvaxPerDay },
    canPay,
    mode: canPay ? 'AVALANCHE' : 'READ_ONLY'
  }
}

/**
 * A number from an env var. Unset or blank (a Claude Desktop setting left empty) gives the fallback; anything else
 * that is not a number in range throws, so a typo cannot silently turn a safety minimum off.
 */
function parseScore(raw: string | undefined, fallback: number, name: string, max = 100): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new Error(`${name} must be a number between 0 and ${max === Infinity ? 'infinity' : max} (got "${raw}")`)
  }
  return n
}
