import type { PaymentNetwork, AppConfig } from '@/types.js'

const CAIP2_NETWORKS: Record<PaymentNetwork, string> = {
  algorand: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  'algorand-testnet': 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
}

export function isAlgorandNetwork(network: PaymentNetwork): boolean {
  return network === 'algorand' || network === 'algorand-testnet'
}

export function getCaip2Network(network: PaymentNetwork): string {
  return CAIP2_NETWORKS[network]
}

function algodUrlFor(network: PaymentNetwork): string {
  return network === 'algorand-testnet'
    ? 'https://testnet-api.algonode.cloud'
    : 'https://mainnet-api.algonode.cloud'
}

// ─── Algorand Signer (from 25-word mnemonic) ─────────────────────────────────
// Uses algosdk.mnemonicToSecretKey to derive the secret key from the mnemonic.
// The ClientAvmSigner interface only needs address + signTransactions.
async function createAlgorandSigner(mnemonic: string) {
  const algosdk = await import('algosdk')
  const { sk, addr } = algosdk.default.mnemonicToSecretKey(mnemonic)
  const address = algosdk.default.encodeAddress(addr.publicKey)
  return {
    address,
    signTransactions: async (
      txns: Uint8Array[],
      indexesToSign?: number[]
    ): Promise<(Uint8Array | null)[]> => {
      return txns.map((txnBytes, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) return null
        const decoded = algosdk.default.decodeUnsignedTransaction(txnBytes)
        const signed = algosdk.default.signTransaction(decoded, sk)
        return signed.blob
      })
    }
  }
}

// Note: We return `any` because the AVM-specific x402HTTPClient has slightly
// different typing strictness than the generic client interface.
export async function createHttpClient(
  network: PaymentNetwork,
  config: AppConfig
): Promise<any> {
  if (!isAlgorandNetwork(network) || !config.algorandMnemonic) {
    throw new Error(`No Algorand key configured for network ${network}`)
  }

  const { x402Client, x402HTTPClient } = await import('@x402-avm/core/client')
  const { registerExactAvmScheme } = await import('@x402-avm/avm/exact/client')
  const client = new x402Client()
  const signer = await createAlgorandSigner(config.algorandMnemonic)

  registerExactAvmScheme(client, {
    signer,
    algodConfig: { algodUrl: algodUrlFor(network) }
  })
  return new x402HTTPClient(client)
}

export async function getWalletAddress(
  network: PaymentNetwork,
  config: AppConfig
): Promise<string> {
  if (isAlgorandNetwork(network) && config.algorandMnemonic) {
    const algosdk = await import('algosdk')
    const { addr } = algosdk.default.mnemonicToSecretKey(config.algorandMnemonic)
    return algosdk.default.encodeAddress(addr.publicKey)
  }
  throw new Error(`No key configured for network ${network}`)
}

// USDC ASA IDs for Algorand networks
const USDC_ASA: Record<PaymentNetwork, number> = {
  'algorand-testnet': 10458941, // USDC on Algorand Testnet
  algorand: 31566704 // USDC on Algorand Mainnet
}

export async function getUsdcBalance(
  network: PaymentNetwork,
  config: AppConfig
): Promise<string> {
  if (!isAlgorandNetwork(network) || !config.algorandMnemonic) {
    throw new Error(`No key configured for network ${network}`)
  }

  try {
    const algosdk = await import('algosdk')
    const { addr } = algosdk.default.mnemonicToSecretKey(config.algorandMnemonic)
    const algodClient = new algosdk.default.Algodv2('', algodUrlFor(network), '')
    const accountInfo = await algodClient.accountInformation(addr).do()

    // Find USDC ASA in assets — use any cast because algosdk AssetHolding
    // uses a different field name depending on SDK version
    const assetId = USDC_ASA[network]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usdcAsset = (accountInfo.assets as any[])?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => Number(a.assetId ?? a['asset-id']) === assetId
    )
    if (!usdcAsset) return '0.000000 (not opted-in to USDC)'

    const raw = BigInt(usdcAsset.amount ?? 0)
    const decimals = 6
    const whole = raw / BigInt(10 ** decimals)
    const frac = raw % BigInt(10 ** decimals)
    return `${whole}.${frac.toString().padStart(decimals, '0')}`
  } catch {
    return '0.000000'
  }
}
