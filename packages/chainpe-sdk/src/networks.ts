/**
 * Network constants for the Avalanche C-Chain (Fuji testnet + mainnet).
 *
 * These mirror the values used across the ChainPe wallet/agent packages and the
 * live Fuji deployment (see docs/DEPLOYMENTS.md). Baking the deployed addresses
 * in as defaults is what lets the SDK work with zero config on Fuji.
 */
import { createPublicClient, http, getAddress, type PublicClient } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import type { Network as X402Network } from 'x402/types'
import type { ChainPeNetwork } from './types.js'

export const USDC_DECIMALS = 6

/** ChainPe network id → x402 network id. */
const X402_NETWORKS: Record<ChainPeNetwork, X402Network> = {
  fuji: 'avalanche-fuji',
  avalanche: 'avalanche'
}

const RPC_URLS: Record<ChainPeNetwork, string> = {
  fuji: 'https://api.avax-test.network/ext/bc/C/rpc',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc'
}

/** Canonical Circle USDC (6 decimals) per network. */
const USDC_ADDRESS: Record<ChainPeNetwork, `0x${string}`> = {
  fuji: '0x5425890298aed601595a70AB815c96711a31Bc65',
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
}

/** Deployed ChainPeRegistry per network (override via constructor/env). */
const DEFAULT_REGISTRY: Record<ChainPeNetwork, `0x${string}` | undefined> = {
  fuji: '0x91677a35599f052E99Ed0ab9E45c17E736a22Bf6',
  avalanche: '0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E'
}

/** Deployed ERC-8004 Reputation Registry per network. */
const DEFAULT_REPUTATION: Record<ChainPeNetwork, `0x${string}` | undefined> = {
  fuji: '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4',
  avalanche: '0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543'
}

const CHAINS = { fuji: avalancheFuji, avalanche } as const

export function getX402Network(network: ChainPeNetwork): X402Network {
  return X402_NETWORKS[network]
}

export function rpcUrlFor(network: ChainPeNetwork): string {
  return RPC_URLS[network]
}

export function getUsdcAddress(network: ChainPeNetwork): `0x${string}` {
  return USDC_ADDRESS[network]
}

export function chainFor(network: ChainPeNetwork) {
  return CHAINS[network]
}

export function publicClientFor(network: ChainPeNetwork): PublicClient {
  return createPublicClient({
    chain: CHAINS[network],
    transport: http(RPC_URLS[network])
  })
}

/**
 * Resolves the ChainPeRegistry address: explicit arg → env → built-in default.
 * Throws when none is available (e.g. mainnet without an override).
 */
export function resolveRegistryAddress(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` {
  const candidate =
    explicit ?? process.env.CHAINPE_REGISTRY_ADDRESS ?? DEFAULT_REGISTRY[network]
  if (!candidate) {
    throw new Error(
      `No ChainPe registry address for network "${network}". Pass registryAddress or set CHAINPE_REGISTRY_ADDRESS.`
    )
  }
  return getAddress(candidate)
}

/** Resolves the ERC-8004 Reputation Registry, or undefined when unset. */
export function resolveReputationRegistry(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` | undefined {
  const candidate =
    explicit ??
    process.env.ERC8004_REPUTATION_REGISTRY ??
    DEFAULT_REPUTATION[network]
  return candidate ? getAddress(candidate) : undefined
}

export function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}
