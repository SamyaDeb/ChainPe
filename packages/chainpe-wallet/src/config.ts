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

function buildState(): Omit<AppConfig, 'reload'> {
  const wallet = loadWalletConfig()

  const algorandMnemonic =
    process.env.ALGORAND_MNEMONIC ?? wallet?.algorandMnemonic ?? undefined
  const network = (process.env.NETWORK ??
    wallet?.network ??
    'algorand-testnet') as PaymentNetwork
  const registryAppId =
    process.env.CHAINPE_REGISTRY_APP_ID ?? wallet?.registryAppId ?? undefined

  const maxPerCall = process.env.MAX_PER_CALL ?? '0.10'
  const maxPerDay = process.env.MAX_PER_DAY ?? '20.00'

  const canPayAlgorand = !!algorandMnemonic
  const canPay = canPayAlgorand

  return {
    algorandMnemonic,
    network,
    registryAppId,
    budget: { maxPerCall, maxPerDay },
    canPay,
    canPayAlgorand,
    mode: canPayAlgorand ? 'ALGORAND_ONLY' : 'READ_ONLY'
  }
}
