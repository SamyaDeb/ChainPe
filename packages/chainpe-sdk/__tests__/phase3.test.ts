/** Phase 3: payment proof on ratings, registry-resolved agentId, and the reputation gate (before signing). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sign = vi.fn(async () => 'SIGNED-HEADER')
vi.mock('x402/client', () => ({ createPaymentHeader: (...a: unknown[]) => sign(...(a as [])) }))
vi.mock('x402-fetch', async importOriginal => ({
  ...(await importOriginal<typeof import('x402-fetch')>()),
  createSigner: vi.fn(async () => ({}))
}))

const giveFeedbackFn = vi.fn(async (..._a: unknown[]) => '0xfeedbacktx')
const getReputationFn = vi.fn(async (..._a: unknown[]) => ({ count: 9, score: 99, source: 'unverified' as const }))
vi.mock('../src/reputation.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/reputation.js')>()),
  giveFeedback: (...a: unknown[]) => giveFeedbackFn(...a),
  getReputation: (...a: unknown[]) => getReputationFn(...a)
}))

const registryServices = vi.fn()
vi.mock('../src/registry.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/registry.js')>()),
  RegistryClient: class {
    getAddress() {
      return '0x0'
    }
    listAllServices() {
      return registryServices()
    }
  }
}))

import { ChainPe } from '../src/chainpe.js'
import { ReputationTooLow } from '../src/types.js'
import { checkMinimum, type CloudService } from '../src/cloud.js'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const WEATHER_PAYTO = '0x1111111111111111111111111111111111111111'
const CHEAP_PAYTO = '0x2222222222222222222222222222222222222222'
const TX = `0x${'ab'.repeat(32)}`
const URL_ = 'https://weather.example.com/forecast?apikey=secret'

const reg = (name: string, payTo: string, agentId?: string) => ({
  id: name,
  name,
  description: '',
  tags: [],
  endpoint: `https://${name}.example.com`,
  pricePerRequest: '0.01',
  paymentToken: 'USDC',
  walletAddress: payTo,
  network: 'avalanche',
  developer: '0x9',
  agentId
})

const cloud = (name: string, payTo: string, paidScore: number | null, paidReviews: number, extra: Partial<CloudService> = {}): CloudService => ({
  key: '0x1',
  name,
  endpoint: `https://${name}.example.com`,
  price: '0.01',
  payTo,
  agentId: '1',
  paidScore,
  paidReviews,
  rawScore: 95,
  rawReviews: 12,
  totalSettledAtomic: '0',
  paidCalls: 0,
  payToShared: false,
  ...extra
})

/** x402 server (402 then 200) plus the chainpe-cloud public API. */
function stubNetwork(o: { payTo?: string; settleTx?: string | null; cloudServices?: CloudService[] | 'down'; agentHeader?: string } = {}) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/v1/public/services')) {
        if (o.cloudServices === 'down') throw new Error('ECONNREFUSED')
        return new Response(JSON.stringify({ services: o.cloudServices ?? [] }), { status: 200 })
      }
      const headers = new Headers(init?.headers)
      if (!headers.get('X-PAYMENT')) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [{ scheme: 'exact', network: 'avalanche', asset: '0x0', maxAmountRequired: '10000', payTo: o.payTo ?? WEATHER_PAYTO }]
          }),
          // A malicious server tries to point feedback at someone else's agent.
          { status: 402, headers: { 'content-type': 'application/json', 'x-chainpe-agent-id': o.agentHeader ?? '999' } }
        )
      }
      const settle = o.settleTx === null ? {} : { 'X-PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, transaction: o.settleTx ?? TX, payer: '0x0' })).toString('base64') }
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', ...settle } })
    })
  )
  return calls
}

beforeEach(() => {
  sign.mockClear()
  giveFeedbackFn.mockClear()
  getReputationFn.mockClear()
  registryServices.mockReset()
  registryServices.mockResolvedValue([reg('weather', WEATHER_PAYTO, '7'), reg('cheap', CHEAP_PAYTO, '8')])
})
afterEach(() => vi.unstubAllGlobals())

describe('payment proof on ratings', () => {
  it('attaches the settlement tx as feedbackHash, with the resource as endpoint', async () => {
    stubNetwork()
    const cp = new ChainPe({ privateKey: KEY, autoFeedback: true })
    const paid = await cp.pay(URL_)
    expect(paid.reputation).toEqual({ agentId: '7', score: 100, txHash: '0xfeedbacktx' })
    const [, , , params] = giveFeedbackFn.mock.calls[0] as [unknown, unknown, unknown, Record<string, unknown>]
    expect(params).toMatchObject({ agentId: '7', paymentTx: TX, endpoint: 'https://weather.example.com/forecast' })
    expect(String(params.endpoint)).not.toContain('secret')
  })

  it('posts no rating when the provider reported no settlement tx', async () => {
    stubNetwork({ settleTx: null })
    const cp = new ChainPe({ privateKey: KEY, autoFeedback: true })
    const paid = await cp.pay(URL_)
    expect(paid.ok).toBe(true)
    expect(paid.reputation).toBeUndefined()
    expect(giveFeedbackFn).not.toHaveBeenCalled()
  })

  it('resolves the agentId from the registry by payTo and ignores the x-chainpe-agent-id header', async () => {
    stubNetwork({ agentHeader: '999' })
    const cp = new ChainPe({ privateKey: KEY, autoFeedback: true })
    await cp.pay(URL_)
    expect((giveFeedbackFn.mock.calls[0] as unknown[])[3]).toMatchObject({ agentId: '7' })
    expect(giveFeedbackFn.mock.calls.some(c => (c[3] as { agentId: string }).agentId === '999')).toBe(false)
  })

  it('does not rate when the registry has no agent for that payTo, even if the server names one', async () => {
    registryServices.mockResolvedValue([reg('weather', WEATHER_PAYTO, undefined)])
    stubNetwork({ agentHeader: '999' })
    const cp = new ChainPe({ privateKey: KEY, autoFeedback: true })
    expect((await cp.pay(URL_)).reputation).toBeUndefined()
    expect(giveFeedbackFn).not.toHaveBeenCalled()
  })

  it('cp.giveFeedback passes paymentTx through', async () => {
    const cp = new ChainPe({ privateKey: KEY })
    await cp.giveFeedback('7', 80, { paymentTx: TX })
    expect((giveFeedbackFn.mock.calls[0] as unknown[])[3]).toMatchObject({ agentId: '7', value: 80, paymentTx: TX })
  })
})

describe('reputation gate (minReputation / minPaidReviews)', () => {
  it('throws ReputationTooLow BEFORE signing when the verified score is below the minimum', async () => {
    const calls = stubNetwork({ payTo: CHEAP_PAYTO, cloudServices: [cloud('cheap', CHEAP_PAYTO, 20, 5)] })
    const cp = new ChainPe({ privateKey: KEY, minReputation: 60 })
    const err = await cp.fetch('https://cheap.example.com/x').catch(e => e)
    expect(err).toBeInstanceOf(ReputationTooLow)
    expect(err).toMatchObject({ reason: 'below_minimum', paidScore: 20, paidReviews: 5, minReputation: 60, payTo: CHEAP_PAYTO })
    expect(err.message).toMatch(/verified paid score is 20\/100, below the minimum 60/)
    expect(sign).not.toHaveBeenCalled()
    expect(calls.filter(u => u.includes('cheap.example.com'))).toHaveLength(1) // only the unpaid probe
  })

  it('pays a provider that meets the minimum', async () => {
    stubNetwork({ cloudServices: [cloud('weather', WEATHER_PAYTO, 88, 6)] })
    const cp = new ChainPe({ privateKey: KEY, minReputation: 60 })
    const res = await cp.fetch('https://weather.example.com/x')
    expect(res.status).toBe(200)
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('refuses a high score backed by too few paid reviews (default minimum 3)', async () => {
    stubNetwork({ cloudServices: [cloud('weather', WEATHER_PAYTO, 100, 2)] })
    const err = await new ChainPe({ privateKey: KEY, minReputation: 60 }).fetch('https://weather.example.com/x').catch(e => e)
    expect(err).toBeInstanceOf(ReputationTooLow)
    expect(err.reason).toBe('not_enough_reviews')
    expect(sign).not.toHaveBeenCalled()
  })

  it('minPaidReviews is configurable, and 0 admits an unrated provider only if it has a score', async () => {
    stubNetwork({ cloudServices: [cloud('weather', WEATHER_PAYTO, 100, 2)] })
    await new ChainPe({ privateKey: KEY, minReputation: 60, minPaidReviews: 2 }).fetch('https://weather.example.com/x')
    expect(sign).toHaveBeenCalledTimes(1)
    sign.mockClear()
    stubNetwork({ cloudServices: [cloud('weather', WEATHER_PAYTO, null, 0)] })
    const err = await new ChainPe({ privateKey: KEY, minReputation: 60, minPaidReviews: 0 }).fetch('https://weather.example.com/x').catch(e => e)
    expect(err).toBeInstanceOf(ReputationTooLow)
    expect(sign).not.toHaveBeenCalled()
  })

  it('never lets the raw average stand in for the paid score', async () => {
    stubNetwork({ payTo: CHEAP_PAYTO, cloudServices: [cloud('cheap', CHEAP_PAYTO, 10, 4, { rawScore: 98, rawReviews: 50 })] })
    const err = await new ChainPe({ privateKey: KEY, minReputation: 60 }).fetch('https://cheap.example.com/x').catch(e => e)
    expect(err.reason).toBe('below_minimum')
  })

  it('refuses a payTo chainpe-cloud does not know, and a payTo flagged as shared', async () => {
    stubNetwork({ cloudServices: [] })
    const unknown = await new ChainPe({ privateKey: KEY, minReputation: 60 }).fetch('https://weather.example.com/x').catch(e => e)
    expect(unknown.reason).toBe('unknown_service')
    stubNetwork({ cloudServices: [cloud('weather', WEATHER_PAYTO, 99, 9, { payToShared: true })] })
    const shared = await new ChainPe({ privateKey: KEY, minReputation: 60 }).fetch('https://weather.example.com/x').catch(e => e)
    expect(shared.reason).toBe('unknown_service')
    expect(sign).not.toHaveBeenCalled()
  })

  it('fails closed, still before signing, when chainpe-cloud is unreachable', async () => {
    stubNetwork({ cloudServices: 'down' })
    const err = await new ChainPe({ privateKey: KEY, minReputation: 60 }).fetch('https://weather.example.com/x').catch(e => e)
    expect(err).toBeInstanceOf(ReputationTooLow)
    expect(err.reason).toBe('unavailable')
    expect(sign).not.toHaveBeenCalled()
  })

  it('does nothing, and never calls chainpe-cloud, when no minimum is set', async () => {
    const calls = stubNetwork()
    await new ChainPe({ privateKey: KEY }).fetch('https://weather.example.com/x')
    expect(sign).toHaveBeenCalledTimes(1)
    expect(calls.some(u => u.includes('/v1/public'))).toBe(false)
  })

  it('rejects an out-of-range minReputation', () => {
    expect(() => new ChainPe({ privateKey: KEY, minReputation: 150 })).toThrow(/between 0 and 100/)
  })

  it('checkMinimum is pure and exhaustive', () => {
    const s = cloud('x', WEATHER_PAYTO, 70, 5)
    expect(checkMinimum(s, 60, 3)).toBeNull()
    expect(checkMinimum(s, 80, 3)).toBe('below_minimum')
    expect(checkMinimum(s, 60, 6)).toBe('not_enough_reviews')
    expect(checkMinimum(null, 60, 3)).toBe('unknown_service')
  })
})

describe('discover: paid score, with a labelled fallback', () => {
  it('uses chainpe-cloud paid scores and never the on-chain average', async () => {
    stubNetwork({ cloudServices: [cloud('weather', WEATHER_PAYTO, 91, 6), cloud('cheap', CHEAP_PAYTO, 22, 4)] })
    const ranked = await new ChainPe({ privateKey: KEY }).discover()
    expect(ranked.map(r => r.name)).toEqual(['weather', 'cheap'])
    expect(ranked[0].reputation).toMatchObject({ source: 'paid', score: 91, count: 6, rawScore: 95 })
    expect(getReputationFn).not.toHaveBeenCalled()
  })

  it('falls back to the on-chain average, labelled unverified, if chainpe-cloud is down', async () => {
    stubNetwork({ cloudServices: 'down' })
    const ranked = await new ChainPe({ privateKey: KEY }).discover()
    expect(ranked[0].reputation).toMatchObject({ source: 'unverified' })
    expect(getReputationFn).toHaveBeenCalled()
  })
})
