/**
 * ChainPeRegistry reader (read-only, viem).
 *
 * Reads service registrations from the on-chain `ChainPeRegistry` via the
 * paginated `getServices` view. Pure decode/filter/rank helpers are exported so
 * they can be unit-tested without an RPC connection.
 */
import { publicClientFor } from './networks.js'
import type {
  ChainPeNetwork,
  ChainPeService,
  DiscoverOptions,
  RankedService
} from './types.js'

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
  }
] as const

export interface RawService {
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

/** Decodes an on-chain service tuple into the public {@link ChainPeService}. */
export function decodeService(raw: RawService): ChainPeService {
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
    paymentToken: (raw.paymentToken || 'USDC') as 'USDC',
    walletAddress: raw.payTo,
    network: (raw.network as ChainPeNetwork) ?? 'fuji',
    developer: raw.developer,
    agentId: raw.agentId > 0n ? raw.agentId.toString() : undefined,
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined
  }
}

/** Filters services by free-text query, tags, and max price. Pure. */
export function filterServices(
  services: ChainPeService[],
  options: DiscoverOptions
): ChainPeService[] {
  let results = [...services]
  if (options.query) {
    const q = options.query.toLowerCase()
    results = results.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(tag => tag.toLowerCase().includes(q))
    )
  }
  if (options.tags?.length) {
    const tl = options.tags.map(t => t.toLowerCase())
    results = results.filter(s =>
      s.tags.some(tag => tl.includes(tag.toLowerCase()))
    )
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice)
    results = results.filter(s => parseFloat(s.pricePerRequest) <= max)
  }
  return results
}

/**
 * Ranks services by reputation: scored before unscored, higher score first,
 * then more feedback, then cheaper. Stable for equal keys. Pure.
 */
export function rankByReputation(services: RankedService[]): RankedService[] {
  return [...services].sort((a, b) => {
    const sa = a.reputation?.score
    const sb = b.reputation?.score
    const aHas = sa != null
    const bHas = sb != null
    if (aHas !== bHas) return aHas ? -1 : 1
    if (aHas && bHas && sa !== sb) return sb - sa
    const ca = a.reputation?.count ?? 0
    const cb = b.reputation?.count ?? 0
    if (ca !== cb) return cb - ca
    return parseFloat(a.pricePerRequest) - parseFloat(b.pricePerRequest)
  })
}

/** Reads the on-chain ChainPeRegistry. */
export class RegistryClient {
  constructor(
    private readonly network: ChainPeNetwork,
    private readonly address: `0x${string}`
  ) {}

  getAddress(): string {
    return this.address
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
}
