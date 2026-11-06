/** Searches Circle's Discovery API, the directory behind its Agent Marketplace. No API key needed. */
import { formatUnits } from 'viem'
import { getCaip2, USDC_DECIMALS } from './networks.js'
import type {
  ChainPeNetwork,
  ChainPeService,
  DiscoverOptions,
  PaymentRail
} from './types.js'

export const CIRCLE_DISCOVERY_URL =
  'https://api.circle.com/v2/x402/discovery/resources'

const GATEWAY_SCHEME_NAME = 'GatewayWalletBatched'
const DEFAULT_LIMIT = 20

interface CircleAccept {
  network: string
  amount: string
  payTo: string
  extra?: { name?: string }
}

interface CircleItem {
  resource: string
  lastUpdated?: string
  accepts?: CircleAccept[]
  metadata?: {
    provider?: {
      name?: string
      description?: string
      category?: string
      tags?: string[]
    }
    method?: string
    description?: string
  }
}

/** Maps one listing to a service on this network, or undefined if it has no option here. Pure. */
export function mapCircleItem(
  item: CircleItem,
  network: ChainPeNetwork
): ChainPeService | undefined {
  const caip2 = getCaip2(network)
  const accepts = (item.accepts ?? []).filter(a => a.network === caip2)
  if (accepts.length === 0) return undefined

  const cheapest = accepts.reduce((low, a) =>
    BigInt(a.amount) < BigInt(low.amount) ? a : low
  )
  const rails: PaymentRail[] = []
  if (accepts.some(a => a.extra?.name === GATEWAY_SCHEME_NAME)) rails.push('gateway')
  if (accepts.some(a => a.extra?.name !== GATEWAY_SCHEME_NAME)) rails.push('exact')

  const provider = item.metadata?.provider
  return {
    id: item.resource,
    name: provider?.name ?? new URL(item.resource).hostname,
    description: item.metadata?.description ?? provider?.description ?? '',
    tags: provider?.tags ?? [],
    endpoint: item.resource,
    method: item.metadata?.method,
    pricePerRequest: formatUnits(BigInt(cheapest.amount), USDC_DECIMALS),
    paymentToken: 'USDC',
    walletAddress: cheapest.payTo,
    network,
    rails,
    source: 'circle',
    category: provider?.category,
    updatedAt: item.lastUpdated
  }
}

/** Throws when Circle cannot be reached, so a caller can tell that apart from no results. */
export async function searchCircle(
  network: ChainPeNetwork,
  options: DiscoverOptions
): Promise<ChainPeService[]> {
  const url = new URL(CIRCLE_DISCOVERY_URL)
  url.searchParams.set('network', getCaip2(network))
  url.searchParams.set('limit', String(options.limit ?? DEFAULT_LIMIT))
  if (options.query) url.searchParams.set('query', options.query)
  if (options.category) url.searchParams.set('category', options.category)
  if (options.maxPrice) url.searchParams.set('maxUsdPrice', options.maxPrice)
  if (options.gatewayOnly) url.searchParams.set('supportsCircleGateway', 'true')

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Circle Discovery answered ${res.status}.`)
  const body = (await res.json()) as { items?: CircleItem[] }
  return (body.items ?? []).flatMap(item => mapCircleItem(item, network) ?? [])
}

/** Drops a ChainPe listing when Circle already lists that provider on the same host. Pure. */
export function mergeListings(
  circle: ChainPeService[],
  chainpe: ChainPeService[]
): ChainPeService[] {
  const key = (s: ChainPeService) =>
    `${s.walletAddress.toLowerCase()}@${hostOf(s.endpoint)}`
  const listed = new Set(circle.map(key))
  return [...chainpe.filter(s => !listed.has(key(s))), ...circle]
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}
