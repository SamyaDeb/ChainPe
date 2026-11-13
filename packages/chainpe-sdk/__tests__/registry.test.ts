import { describe, it, expect } from 'vitest'
import {
  decodeService,
  filterServices,
  rankByReputation,
  type RawService
} from '../src/registry.js'
import type { ChainPeService, RankedService } from '../src/types.js'

const DEV = '0x8cC8dADfAd2D39659314106bAf4Da10B3BA38A36'
const PAY = '0x1111111111111111111111111111111111111111'

function raw(over: Partial<RawService> = {}): RawService {
  return {
    name: 'translate',
    description: 'Translate text',
    tags: 'ai, nlp',
    endpoint: 'https://api.example.com/translate',
    pricePerRequest: '0.01',
    paymentToken: 'USDC',
    network: 'fuji',
    payTo: PAY,
    developer: DEV,
    agentId: 5n,
    createdAt: 1_700_000_000n,
    updatedAt: 1_700_000_500n,
    exists: true,
    ...over
  }
}

function svc(over: Partial<ChainPeService> = {}): ChainPeService {
  return { ...decodeService(raw()), ...over }
}

describe('decodeService', () => {
  it('builds id, splits tags, maps payTo and agentId', () => {
    const s = decodeService(raw())
    expect(s.id).toBe(`${DEV}:translate`)
    expect(s.tags).toEqual(['ai', 'nlp'])
    expect(s.walletAddress).toBe(PAY)
    expect(s.agentId).toBe('5')
    expect(s.paymentToken).toBe('USDC')
    expect(s.createdAt).toMatch(/^20/)
  })

  it('treats agentId 0 as unlinked (undefined)', () => {
    expect(decodeService(raw({ agentId: 0n })).agentId).toBeUndefined()
  })

  it('defaults empty paymentToken to USDC and drops empty tags', () => {
    const s = decodeService(raw({ paymentToken: '', tags: ' , ai ,, ' }))
    expect(s.paymentToken).toBe('USDC')
    expect(s.tags).toEqual(['ai'])
  })
})

describe('filterServices', () => {
  const a = svc({ name: 'translate', tags: ['ai', 'nlp'], pricePerRequest: '0.01' })
  const b = svc({
    name: 'weather',
    description: 'forecast',
    tags: ['data'],
    pricePerRequest: '0.5'
  })

  it('matches free-text query across name/description/tags', () => {
    expect(filterServices([a, b], { query: 'nlp' })).toEqual([a])
    expect(filterServices([a, b], { query: 'forecast' })).toEqual([b])
  })

  it('filters by tag and max price', () => {
    expect(filterServices([a, b], { tags: ['data'] })).toEqual([b])
    expect(filterServices([a, b], { maxPrice: '0.1' })).toEqual([a])
  })

  it('returns all with empty options', () => {
    expect(filterServices([a, b], {})).toHaveLength(2)
  })
})

describe('rankByReputation', () => {
  const mk = (name: string, score: number | null, count: number, price = '0.1') =>
    ({
      ...svc({ name, pricePerRequest: price }),
      reputation: score === null && count === 0 ? null : { score, count }
    }) as RankedService

  it('orders scored before unscored, higher score first', () => {
    const scoredHigh = mk('high', 90, 3)
    const scoredLow = mk('low', 40, 2)
    const unscored = mk('none', null, 0)
    const ranked = rankByReputation([unscored, scoredLow, scoredHigh])
    expect(ranked.map(s => s.name)).toEqual(['high', 'low', 'none'])
  })

  it('breaks score ties by feedback count then price', () => {
    const more = mk('more', 80, 10, '0.2')
    const fewer = mk('fewer', 80, 2, '0.05')
    const cheaperTie = mk('cheap', 80, 2, '0.01')
    const ranked = rankByReputation([fewer, more, cheaperTie])
    expect(ranked.map(s => s.name)).toEqual(['more', 'cheap', 'fewer'])
  })

  it('does not mutate the input array', () => {
    const input = [mk('a', 10, 1), mk('b', 90, 1)]
    const copy = [...input]
    rankByReputation(input)
    expect(input).toEqual(copy)
  })
})
