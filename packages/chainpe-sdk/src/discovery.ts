/** Searches Circle's Discovery API, the directory behind its Agent Marketplace. No API key needed. */
import { formatUnits } from 'viem'
import {
  getCaip2,
  resolveAccountsAddress,
  resolveReputationRegistry,
  USDC_DECIMALS
} from './networks.js'
import { RegistryClient, filterServices, rankByReputation } from './registry.js'
import { getReputation } from './reputation.js'
import type {
  ChainPeNetwork,
  ChainPeService,
  DiscoverOptions,
  PaymentRail,
  RankedService
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
  return (body.items ?? [])
    .flatMap(item => mapCircleItem(item, network) ?? [])
    .filter(service => isRelevant(service, options.query))
}

/** Words of 3+ letters in a search, lower case. */
function queryWords(query?: string): string[] {
  return (query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3)
}

/**
 * Circle's search can return listings that share no word with the query. Keeps a
 * listing only when one of its words is a query word, or that word plus "s". Pure.
 */
export function isRelevant(service: ChainPeService, query?: string): boolean {
  const words = queryWords(query)
  if (words.length === 0) return true
  const text = [service.name, service.description, service.category ?? '', service.endpoint, ...service.tags].join(' ').toLowerCase()
  const tokens = new Set(text.split(/[^a-z0-9]+/))
  return words.some(w => tokens.has(w) || tokens.has(`${w}s`) || (w.endsWith('s') && tokens.has(w.slice(0, -1))))
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

/**
 * Finds services through Circle's Discovery API and ChainPeAccounts, annotated
 * with ERC-8004 reputation and ranked. Needs no wallet. ChainPeAccounts also covers
 * providers Circle has not listed yet. Throws only when neither source can be read.
 */
export async function discoverServices(
  network: ChainPeNetwork,
  query: string | DiscoverOptions = {},
  addresses: { accountsAddress?: string; reputationRegistry?: string } = {}
): Promise<RankedService[]> {
  const options: DiscoverOptions = typeof query === 'string' ? { query } : query
  const accounts = resolveAccountsAddress(network, addresses.accountsAddress)
  const reputationRegistry = resolveReputationRegistry(
    network,
    addresses.reputationRegistry
  )

  const [circle, chainpe] = await Promise.allSettled([
    searchCircle(network, options),
    accounts
      ? new RegistryClient(network, accounts)
          .listAllServices()
          .then(services => filterServices(services, options))
      : Promise.resolve([])
  ])
  if (circle.status === 'rejected' && chainpe.status === 'rejected') {
    throw new Error(
      `Could not discover services: ${String(circle.reason)}; ${String(chainpe.reason)}`
    )
  }
  const services = mergeListings(
    circle.status === 'fulfilled' ? circle.value : [],
    chainpe.status === 'fulfilled' ? chainpe.value : []
  ).slice(0, options.limit ?? DEFAULT_LIMIT)

  const ranked: RankedService[] = await Promise.all(
    services.map(async s => ({
      ...s,
      reputation: s.agentId
        ? await getReputation(network, reputationRegistry, s.agentId)
        : null
    }))
  )
  return rankByReputation(ranked)
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}
