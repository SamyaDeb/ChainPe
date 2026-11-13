/**
 * ChainPe Registry Reader (Avalanche C-Chain, read-only)
 *
 * Reads service registrations from the on-chain `ChainPeRegistry` Solidity
 * contract via viem. Replaces the Algorand algosdk box-enumeration reader with
 * a paginated `getServices` view.
 *
 * Registry address priority:
 *   1. explicit constructor arg
 *   2. CHAINPE_REGISTRY_ADDRESS environment variable
 */

import { getAddress } from 'viem'
import { publicClientFor } from '@/clients.js'
import type { PaymentNetwork } from '@/types.js'

export type ChainPeNetwork = PaymentNetwork
export type RegistryPaymentToken = 'USDC'

export interface ChainPeService {
  id: string
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string
  paymentToken: RegistryPaymentToken
  walletAddress: string
  network: ChainPeNetwork
  developer: string
  agentId?: string
  createdAt?: string
  updatedAt?: string
}

export interface SearchOptions {
  name?: string
  tags?: string[]
  paymentToken?: RegistryPaymentToken
  maxPrice?: string
}

// ─── ABI (read-only subset) ──────────────────────────────────────────────────

const SERVICE_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'tags', type: 'string' },
  { name: 'endpoint', type: 'string' },
  { name: 'pricePerRequest', type: 'string' },
  { name: 'paymentToken', type: 'string' },
  { name: 'network', type: 'string' },
  { name: 'payTo', type: 'address' },
  { name: 'developer', type: 'address' },
  { name: 'agentId', type: 'uint256' },
  { name: 'createdAt', type: 'uint64' },
  { name: 'updatedAt', type: 'uint64' },
  { name: 'exists', type: 'bool' }
] as const

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getServiceCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getServices',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' }
    ],
    outputs: [{ name: 'page', type: 'tuple[]', components: SERVICE_COMPONENTS }]
  },
  {
    type: 'function',
    name: 'getService',
    stateMutability: 'view',
    inputs: [
      { name: 'developer', type: 'address' },
      { name: 'name', type: 'string' }
    ],
    outputs: [{ name: '', type: 'tuple', components: SERVICE_COMPONENTS }]
  }
] as const

interface RawService {
  name: string
  description: string
  tags: string
  endpoint: string
  pricePerRequest: string
  paymentToken: string
  network: string
  payTo: string
  developer: string
  agentId: bigint
  createdAt: bigint
  updatedAt: bigint
  exists: boolean
}

function decodeService(raw: RawService): ChainPeService {
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  return {
    id: `${raw.developer}:${raw.name}`,
    name: raw.name,
    description: raw.description,
    tags: raw.tags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
    endpoint: raw.endpoint,
    pricePerRequest: raw.pricePerRequest,
    paymentToken: (raw.paymentToken || 'USDC') as RegistryPaymentToken,
    walletAddress: raw.payTo,
    network: (raw.network as ChainPeNetwork) ?? 'fuji',
    developer: raw.developer,
    agentId: raw.agentId > 0n ? raw.agentId.toString() : undefined,
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined
  }
}

function resolveAddress(explicit?: string): `0x${string}` {
  const candidate = explicit ?? process.env.CHAINPE_REGISTRY_ADDRESS
  if (!candidate) {
    throw new Error(
      'ChainPe registry address not set. Provide CHAINPE_REGISTRY_ADDRESS or configure it in the extension.'
    )
  }
  return getAddress(candidate)
}

// ─── Filtering ──────────────────────────────────────────────────────────────

export function filterServices(
  services: ChainPeService[],
  options: SearchOptions
): ChainPeService[] {
  let results = [...services]
  if (options.name) {
    const nl = options.name.toLowerCase()
    results = results.filter(
      s =>
        s.name.toLowerCase().includes(nl) ||
        s.description.toLowerCase().includes(nl) ||
        s.tags.some(tag => tag.toLowerCase().includes(nl))
    )
  }
  if (options.tags?.length) {
    const tl = options.tags.map(t => t.toLowerCase())
    results = results.filter(s =>
      s.tags.some(tag => tl.includes(tag.toLowerCase()))
    )
  }
  if (options.paymentToken) {
    results = results.filter(s => s.paymentToken === options.paymentToken)
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice)
    results = results.filter(s => parseFloat(s.pricePerRequest) <= max)
  }
  return results
}

// ─── RegistryClient (on-chain reads) ─────────────────────────────────────────

export class RegistryClient {
  private network: ChainPeNetwork
  private address: `0x${string}`

  constructor(network: ChainPeNetwork = 'fuji', registryAddress?: string) {
    this.network = network
    this.address = resolveAddress(registryAddress)
  }

  getAddress(): string {
    return this.address
  }

  async findService(
    developerAddress: string,
    name: string
  ): Promise<ChainPeService | undefined> {
    try {
      const client = publicClientFor(this.network)
      const raw = (await client.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: 'getService',
        args: [getAddress(developerAddress), name]
      })) as unknown as RawService
      return raw.exists ? decodeService(raw) : undefined
    } catch {
      return undefined
    }
  }

  /** Lists ALL services via the paginated on-chain view (page size 100). */
  async listAllServices(): Promise<ChainPeService[]> {
    const client = publicClientFor(this.network)
    const count = (await client.readContract({
      address: this.address,
      abi: REGISTRY_ABI,
      functionName: 'getServiceCount'
    })) as bigint

    const total = Number(count)
    if (total === 0) return []

    const pageSize = 100
    const out: ChainPeService[] = []
    for (let offset = 0; offset < total; offset += pageSize) {
      const limit = Math.min(pageSize, total - offset)
      const page = (await client.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: 'getServices',
        args: [BigInt(offset), BigInt(limit)]
      })) as unknown as RawService[]
      for (const raw of page) out.push(decodeService(raw))
    }
    return out
  }

  async search(options: SearchOptions = {}): Promise<ChainPeService[]> {
    const all = await this.listAllServices()
    return filterServices(all, options)
  }
}
