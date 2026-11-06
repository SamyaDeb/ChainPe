/**
 * ChainPeAccounts reader (read-only, viem).
 *
 * Reads active service listings through the paginated `getServices` view. Pure
 * decode/filter/rank helpers are exported so they can be unit-tested without an
 * RPC connection.
 */
import { publicClientFor } from './networks.js'
import type {
  ChainPeNetwork,
  ChainPeService,
  DiscoverOptions,
  PaymentRail,
  RankedService
} from './types.js'

const SERVICE_COMPONENTS = [
  { name: 'key', type: 'bytes32' },
  { name: 'provider', type: 'address' },
  { name: 'payTo', type: 'address' },
  { name: 'agentId', type: 'uint256' },
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'tags', type: 'string' },
  { name: 'endpoint', type: 'string' },
  { name: 'pricePerRequest', type: 'string' },
  { name: 'network', type: 'string' },
  { name: 'acceptsExact', type: 'bool' },
  { name: 'acceptsGateway', type: 'bool' },
  { name: 'active', type: 'bool' },
  { name: 'createdAt', type: 'uint64' },
  { name: 'updatedAt', type: 'uint64' }
] as const

const ACCOUNTS_ABI = [
  {
    type: 'function',
    name: 'serviceCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'MAX_SERVICES_PER_PAGE',
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
  key: string
  provider: string
  payTo: string
  agentId: bigint
  name: string
  description: string
  tags: string
  endpoint: string
  pricePerRequest: string
  network: string
  acceptsExact: boolean
  acceptsGateway: boolean
  active: boolean
  createdAt: bigint
  updatedAt: bigint
}

/** Decodes an on-chain service tuple into the public {@link ChainPeService}. */
export function decodeService(
  raw: RawService,
  network: ChainPeNetwork
): ChainPeService {
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  const rails: PaymentRail[] = []
  if (raw.acceptsGateway) rails.push('gateway')
  if (raw.acceptsExact) rails.push('exact')
  return {
    id: raw.key,
    name: raw.name,
    description: raw.description,
    tags: raw.tags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
    endpoint: raw.endpoint,
    pricePerRequest: raw.pricePerRequest,
    paymentToken: 'USDC',
    walletAddress: raw.payTo,
    network,
    rails,
    source: 'chainpe',
    developer: raw.provider,
    agentId: raw.agentId > 0n ? raw.agentId.toString() : undefined,
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined
  }
}

/** Filters services by free-text query, tags, max price and rail. Pure. */
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
  if (options.gatewayOnly) {
    results = results.filter(s => s.rails.includes('gateway'))
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

/** Reads the on-chain ChainPeAccounts contract. */
export class RegistryClient {
  constructor(
    private readonly network: ChainPeNetwork,
    private readonly address: `0x${string}`
  ) {}

  getAddress(): string {
    return this.address
  }

  /** Lists every active service. Deactivated listings stay on-chain, so they are dropped here. */
  async listAllServices(): Promise<ChainPeService[]> {
    const client = publicClientFor(this.network)
    const [count, maxPage] = (await Promise.all([
      client.readContract({
        address: this.address,
        abi: ACCOUNTS_ABI,
        functionName: 'serviceCount'
      }),
      client.readContract({
        address: this.address,
        abi: ACCOUNTS_ABI,
        functionName: 'MAX_SERVICES_PER_PAGE'
      })
    ])) as [bigint, bigint]

    const total = Number(count)
    const pageSize = Number(maxPage)
    const out: ChainPeService[] = []
    for (let offset = 0; offset < total; offset += pageSize) {
      const limit = Math.min(pageSize, total - offset)
      const page = (await client.readContract({
        address: this.address,
        abi: ACCOUNTS_ABI,
        functionName: 'getServices',
        args: [BigInt(offset), BigInt(limit)]
      })) as unknown as RawService[]
      for (const raw of page) {
        if (raw.active) out.push(decodeService(raw, this.network))
      }
    }
    return out
  }
}
