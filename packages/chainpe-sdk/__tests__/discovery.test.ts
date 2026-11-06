import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapCircleItem, mergeListings, searchCircle } from '../src/discovery.js'
import type { ChainPeService } from '../src/types.js'

const TESTNET = 'eip155:5042002'
const item = (accepts: object[]) => ({
  resource: 'https://api.example.com/weather',
  lastUpdated: '2026-11-01T00:00:00.000Z',
  accepts,
  metadata: {
    provider: { name: 'Example', description: 'Provider', category: 'DATA_ENRICHMENT', tags: ['weather'] },
    method: 'GET',
    description: 'Current weather'
  }
})
const exactOffer = { network: TESTNET, amount: '10000', payTo: '0xaaa', extra: { name: 'USDC' } }
const gatewayOffer = { network: TESTNET, amount: '100', payTo: '0xaaa', extra: { name: 'GatewayWalletBatched' } }

afterEach(() => vi.unstubAllGlobals())

describe('mapCircleItem', () => {
  it('maps a listing and takes the cheapest option on this network', () => {
    const service = mapCircleItem(item([exactOffer, gatewayOffer, { network: 'eip155:8453', amount: '1', payTo: '0xbbb' }]), 'arc-testnet')
    expect(service).toMatchObject({
      name: 'Example',
      description: 'Current weather',
      endpoint: 'https://api.example.com/weather',
      method: 'GET',
      pricePerRequest: '0.0001',
      walletAddress: '0xaaa',
      network: 'arc-testnet',
      rails: ['gateway', 'exact'],
      source: 'circle',
      category: 'DATA_ENRICHMENT'
    })
  })

  it('skips a listing with no option on this network', () => {
    expect(mapCircleItem(item([exactOffer]), 'arc')).toBeUndefined()
    expect(mapCircleItem(item([]), 'arc-testnet')).toBeUndefined()
  })
})

describe('searchCircle', () => {
  it('sends the filters Circle understands', async () => {
    const stub = vi.fn(async (_url: URL) => new Response(JSON.stringify({ items: [item([exactOffer])] })))
    vi.stubGlobal('fetch', stub)
    const found = await searchCircle('arc-testnet', { query: 'weather', maxPrice: '0.01', category: 'DATA_ENRICHMENT', gatewayOnly: true, limit: 5 })
    const params = stub.mock.calls[0][0].searchParams
    expect(Object.fromEntries(params)).toEqual({
      network: TESTNET,
      limit: '5',
      query: 'weather',
      category: 'DATA_ENRICHMENT',
      maxUsdPrice: '0.01',
      supportsCircleGateway: 'true'
    })
    expect(found).toHaveLength(1)
  })

  it('throws when Circle fails, so that is not mistaken for no results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(searchCircle('arc-testnet', {})).rejects.toThrow(/503/)
  })
})

describe('mergeListings', () => {
  const service = (over: Partial<ChainPeService>): ChainPeService => ({
    id: 'x', name: 'x', description: '', tags: [], endpoint: 'https://a.test/x', pricePerRequest: '0.01',
    paymentToken: 'USDC', walletAddress: '0xAAA', network: 'arc-testnet', rails: ['exact'], source: 'circle', ...over
  })

  it('keeps providers Circle has not listed, first', () => {
    const chain = service({ source: 'chainpe', endpoint: 'https://new.test', walletAddress: '0xBBB' })
    const circle = service({})
    expect(mergeListings([circle], [chain])).toEqual([chain, circle])
  })

  it('drops a ChainPe listing Circle already has', () => {
    const chain = service({ source: 'chainpe', endpoint: 'https://a.test', walletAddress: '0xaaa' })
    const circle = service({})
    expect(mergeListings([circle], [chain])).toEqual([circle])
  })
})
