/**
 * Network constants for Circle's Arc.
 *
 * Arc pays gas in USDC. The native balance has 18 decimals while the ERC-20
 * interface at the USDC address has 6, so amounts always go through the ERC-20.
 */
import { createPublicClient, http, getAddress, type Chain, type PublicClient } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import type { ChainPeNetwork } from './types.js'

export const USDC_DECIMALS = 6

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const

interface NetworkInfo {
  chain: Chain
  caip2: string
  gatewayChain: 'arcTestnet' | 'arc'
  rpcUrl: () => string
  explorer: string
  /** ChainPeAccounts, where it is deployed. */
  accounts?: `0x${string}`
  reputation: `0x${string}`
}

const NETWORKS: Record<ChainPeNetwork, NetworkInfo> = {
  'arc-testnet': {
    chain: arcTestnet,
    caip2: 'eip155:5042002',
    gatewayChain: 'arcTestnet',
    rpcUrl: () => process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
    accounts: '0xD315322c9D83A6f50A04236A2a242e0259bfB580',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713'
  },
  arc: {
    chain: arc,
    caip2: 'eip155:5042',
    gatewayChain: 'arc',
    rpcUrl: () => process.env.ARC_RPC_URL ?? 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
  }
}

function info(network: ChainPeNetwork): NetworkInfo {
  if (!Object.hasOwn(NETWORKS, network)) {
    throw new Error(`Invalid network "${network}" (expected arc-testnet or arc).`)
  }
  return NETWORKS[network]
}

/** Validates a network name. Throws on anything but an Arc network. */
export function assertNetwork(network: ChainPeNetwork): ChainPeNetwork {
  info(network)
  return network
}

export function getCaip2(network: ChainPeNetwork): string {
  return info(network).caip2
}

export function getGatewayChain(network: ChainPeNetwork): 'arcTestnet' | 'arc' {
  return info(network).gatewayChain
}

export function rpcUrlFor(network: ChainPeNetwork): string {
  return info(network).rpcUrl()
}

export function explorerFor(network: ChainPeNetwork): string {
  return info(network).explorer
}

/** Arc's USDC, through its 6-decimal ERC-20 interface. */
export function getUsdcAddress(network: ChainPeNetwork): `0x${string}` {
  info(network)
  return ARC_USDC
}

export function chainFor(network: ChainPeNetwork): Chain {
  const { chain, explorer } = info(network)
  return {
    ...chain,
    rpcUrls: { default: { http: [rpcUrlFor(network)] } },
    blockExplorers: { default: { name: 'Arc Explorer', url: explorer } }
  }
}

export function publicClientFor(network: ChainPeNetwork): PublicClient {
  return createPublicClient({
    chain: chainFor(network),
    transport: http(rpcUrlFor(network))
  })
}

/** ChainPeAccounts: explicit arg → env → built-in. Undefined where it is not deployed. */
export function resolveAccountsAddress(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` | undefined {
  const candidate =
    explicit ?? process.env.CHAINPE_ACCOUNTS_ADDRESS ?? info(network).accounts
  return candidate ? getAddress(candidate) : undefined
}

/** Arc's ERC-8004 Reputation Registry: explicit arg → env → built-in. */
export function resolveReputationRegistry(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` {
  return getAddress(
    explicit ?? process.env.ERC8004_REPUTATION_REGISTRY ?? info(network).reputation
  )
}

export function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}
