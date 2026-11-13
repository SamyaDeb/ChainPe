import {
  createPublicClient,
  http,
  erc20Abi,
  formatUnits,
  getAddress,
  type PublicClient
} from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createSigner } from 'x402-fetch'
import type { Network as X402Network } from 'x402/types'
import type { PaymentNetwork, AppConfig } from '@/types.js'

// ─── Network constants ───────────────────────────────────────────────────────

const X402_NETWORKS: Record<PaymentNetwork, X402Network> = {
  fuji: 'avalanche-fuji',
  avalanche: 'avalanche'
}

const RPC_URLS: Record<PaymentNetwork, string> = {
  fuji: 'https://api.avax-test.network/ext/bc/C/rpc',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc'
}

// Canonical Circle USDC (6 decimals) per Avalanche network.
const USDC_ADDRESS: Record<PaymentNetwork, `0x${string}`> = {
  fuji: '0x5425890298aed601595a70AB815c96711a31Bc65',
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
}

const CHAINS = { fuji: avalancheFuji, avalanche }
export const USDC_DECIMALS = 6

export function getX402Network(network: PaymentNetwork): X402Network {
  return X402_NETWORKS[network]
}

export function getUsdcAddress(network: PaymentNetwork): `0x${string}` {
  return USDC_ADDRESS[network]
}

export function rpcUrlFor(network: PaymentNetwork): string {
  return RPC_URLS[network]
}

export function publicClientFor(network: PaymentNetwork): PublicClient {
  return createPublicClient({
    chain: CHAINS[network],
    transport: http(RPC_URLS[network])
  })
}

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}

// ─── Signer / wallet ─────────────────────────────────────────────────────────

/**
 * Builds an x402 EVM signer (viem wallet client) for the configured network.
 * Used by both `createPaymentHeader` (pay tool) and `wrapFetchWithPayment`.
 */
export async function buildSigner(network: PaymentNetwork, config: AppConfig) {
  if (!config.privateKey) {
    throw new Error(`No private key configured for network ${network}`)
  }
  // createSigner accepts the x402 network id and a 0x private key.
  return createSigner(getX402Network(network), normalizeKey(config.privateKey))
}

export function getWalletAddress(config: AppConfig): string {
  if (!config.privateKey) {
    throw new Error('No private key configured')
  }
  return privateKeyToAccount(normalizeKey(config.privateKey)).address
}

// ─── Balances ──────────────────────────────────────────────────────────────

export async function getUsdcBalance(
  network: PaymentNetwork,
  config: AppConfig
): Promise<string> {
  if (!config.privateKey) {
    throw new Error(`No key configured for network ${network}`)
  }
  try {
    const client = publicClientFor(network)
    const address = getAddress(getWalletAddress(config))
    const raw = (await client.readContract({
      address: getUsdcAddress(network),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address]
    })) as bigint
    return formatUnits(raw, USDC_DECIMALS)
  } catch {
    return '0.000000'
  }
}

export async function getAvaxBalance(
  network: PaymentNetwork,
  address: string
): Promise<string> {
  try {
    const client = publicClientFor(network)
    const wei = await client.getBalance({ address: getAddress(address) })
    return formatUnits(wei, 18)
  } catch {
    return 'unavailable'
  }
}
