/** Phase 3 in the MCP wallet: MIN_REPUTATION gate before signing, payment proof on ratings, registry-resolved agent. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerX402Fetch } from '../src/tools/x402-fetch.js'
import { registerGiveFeedback } from '../src/tools/give-feedback.js'
import { loadConfig } from '../src/config.js'
import { resetCloudCache } from '../src/gate.js'

const createPaymentHeader = vi.fn()
vi.mock('x402/client', () => ({ createPaymentHeader: (...a: unknown[]) => createPaymentHeader(...a) }))
vi.mock('x402-fetch', () => ({
  decodeXPaymentResponse: (h: string) => JSON.parse(Buffer.from(h, 'base64').toString())
}))
const buildSigner = vi.fn().mockResolvedValue({})
vi.mock('../src/clients.js', () => ({ buildSigner: (...a: unknown[]) => buildSigner(...a), USDC_DECIMALS: 6, publicClientFor: vi.fn(), rpcUrlFor: vi.fn() }))

const giveFeedback = vi.fn(async (..._a: unknown[]) => '0xfeedbacktx')
vi.mock('../src/reputation.js', () => ({
  giveFeedback: (...a: unknown[]) => giveFeedback(...a),
  resolveReputationRegistry: () => '0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543',
  getReputation: vi.fn(async () => ({ count: 9, score: 99, source: 'unverified' }))
}))
const listAllServices = vi.fn()
vi.mock('../src/chainpe-registry.js', () => ({
  RegistryClient: class {
    getAddress() {
      return '0x0'
    }
    listAllServices() {
      return listAllServices()
    }
  }
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const PAYTO = '0x1111111111111111111111111111111111111111'
const TX = `0x${'cd'.repeat(32)}`
const URL_ = 'https://weather.example.com/forecast?key=secret'

const cfg = (o: Partial<AppConfig> = {}): AppConfig => ({
  privateKey: '0xkey',
  network: 'avalanche',
  minReputation: 0,
  minPaidReviews: 3,
  budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
  canPay: true,
  mode: 'AVALANCHE',
  reload: vi.fn(),
  ...o
})

const svc = (paidScore: number | null, paidReviews: number, extra: Record<string, unknown> = {}) => ({
  key: '0x1', name: 'weather', endpoint: 'https://weather.example.com', price: '0.01', payTo: PAYTO, agentId: '7',
  paidScore, paidReviews, rawScore: 97, rawReviews: 40, totalSettledAtomic: '0', paidCalls: 0, payToShared: false, ...extra
})

type Result = { isError?: boolean; content: { text: string }[] }
function handler(server: McpServer, name: string) {
  const call = vi.mocked(server.tool).mock.calls.find(c => c[0] === name)!
  return call[call.length - 1] as (args: Record<string, unknown>) => Promise<Result>
}

function network(o: { cloud?: unknown | 'down'; settle?: string | null } = {}) {
  mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/v1/public/services')) {
      if (o.cloud === 'down') throw new Error('ECONNREFUSED')
      return new Response(JSON.stringify({ services: o.cloud ?? [] }), { status: 200 })
    }
    if (!new Headers(init?.headers).get('X-PAYMENT')) {
      return new Response(
        JSON.stringify({ x402Version: 1, accepts: [{ scheme: 'exact', network: 'avalanche', asset: '0x0', maxAmountRequired: '10000', payTo: PAYTO, maxTimeoutSeconds: 60 }] }),
        { status: 402, headers: { 'content-type': 'application/json', 'x-chainpe-agent-id': '999' } }
      )
    }
    const settle = o.settle === null ? {} : { 'X-PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, transaction: o.settle ?? TX })).toString('base64') }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', ...settle } })
  })
}

function setup(config: AppConfig) {
  const server = { tool: vi.fn() } as unknown as McpServer
  const spending = new SpendingTracker(config.budget)
  registerX402Fetch(server, config, spending)
  return { run: handler(server, 'x402_fetch'), spending }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCloudCache()
  createPaymentHeader.mockResolvedValue('SIGNED')
  listAllServices.mockResolvedValue([{ walletAddress: PAYTO, agentId: '7', endpoint: 'https://weather.example.com' }])
})
afterEach(() => mockFetch.mockReset())

describe('MIN_REPUTATION gate in x402_fetch', () => {
  it('refuses a low verified score before signing, with a message an LLM can relay', async () => {
    network({ cloud: [svc(20, 5)] })
    const { run, spending } = setup(cfg({ minReputation: 60 }))
    const res = await run({ url: URL_, method: 'GET' })
    expect(res.isError).toBe(true)
    const text = res.content[0].text
    expect(text).toMatch(/^REFUSED, nothing was signed and no money moved/)
    expect(text).toContain('20/100')
    expect(text).toContain('MIN_REPUTATION=60')
    expect(text).toMatch(/search_bazaar/)
    expect(createPaymentHeader).not.toHaveBeenCalled()
    expect(buildSigner).not.toHaveBeenCalled()
    expect(spending.getSummary().spentToday).toBe('0.0000') // nothing counted as spent
  })

  it('pays a provider that meets the minimum', async () => {
    network({ cloud: [svc(88, 6)] })
    const { run } = setup(cfg({ minReputation: 60 }))
    const res = await run({ url: URL_, method: 'GET' })
    expect(res.isError).toBeFalsy()
    expect(createPaymentHeader).toHaveBeenCalledTimes(1)
  })

  it('does not let a flood of unpaid 5-star ratings through: only the verified score counts', async () => {
    network({ cloud: [svc(15, 4, { rawScore: 99, rawReviews: 200 })] })
    const { run } = setup(cfg({ minReputation: 60 }))
    expect((await run({ url: URL_, method: 'GET' })).isError).toBe(true)
    expect(createPaymentHeader).not.toHaveBeenCalled()
  })

  it('refuses when there are too few verified reviews, or the service is unknown, or the cloud is down', async () => {
    for (const [cloud, expected] of [
      [[svc(100, 1)], /only 1 verified paid review/],
      [[], /not a service registered/],
      ['down', /could not be checked/]
    ] as const) {
      resetCloudCache()
      network({ cloud })
      const { run } = setup(cfg({ minReputation: 60 }))
      const res = await run({ url: URL_, method: 'GET' })
      expect(res.isError).toBe(true)
      expect(res.content[0].text).toMatch(expected)
    }
    expect(createPaymentHeader).not.toHaveBeenCalled()
  })

  it('is off by default: no minimum, no lookup', async () => {
    network()
    const { run } = setup(cfg())
    expect((await run({ url: URL_, method: 'GET' })).isError).toBeFalsy()
    expect(mockFetch.mock.calls.some(c => String(c[0]).includes('/v1/public'))).toBe(false)
  })
})

describe('ratings carry payment proof', () => {
  it('sends the settlement tx as feedbackHash and resolves the agent from the registry, not the header', async () => {
    network()
    const { run } = setup(cfg())
    const res = await run({ url: URL_, method: 'GET' })
    const out = JSON.parse(res.content[0].text)
    expect(out.reputation).toMatchObject({ agentId: '7', paymentTx: TX })
    const params = giveFeedback.mock.calls[0][1] as Record<string, unknown>
    expect(params).toMatchObject({ agentId: '7', paymentTx: TX, endpoint: 'https://weather.example.com/forecast', value: 100 })
    expect(String(params.endpoint)).not.toContain('secret')
    expect(giveFeedback.mock.calls.some(c => (c[1] as { agentId: string }).agentId === '999')).toBe(false)
  })

  it('posts no rating without a settlement tx', async () => {
    network({ settle: null })
    const out = JSON.parse((await setup(cfg()).run({ url: URL_, method: 'GET' })).content[0].text)
    expect(giveFeedback).not.toHaveBeenCalled()
    expect(out.reputation.note).toMatch(/no settlement tx/)
  })

  it('posts no rating when the registry has no agent for that payTo', async () => {
    listAllServices.mockResolvedValue([{ walletAddress: PAYTO, endpoint: 'https://weather.example.com' }])
    network()
    await setup(cfg()).run({ url: URL_, method: 'GET' })
    expect(giveFeedback).not.toHaveBeenCalled()
  })
})

describe('give_feedback tool', () => {
  it('passes paymentTx through and says whether the rating can count', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, cfg())
    const run = handler(server, 'give_feedback')
    const ok = JSON.parse((await run({ agentId: '7', score: 90, paymentTx: TX })).content[0].text)
    expect(giveFeedback.mock.calls[0][1]).toMatchObject({ agentId: '7', value: 90, paymentTx: TX })
    expect(ok.note).toMatch(/payment proof/)
    const bare = JSON.parse((await run({ agentId: '7', score: 90 })).content[0].text)
    expect(bare.note).toMatch(/WITHOUT payment proof/)
  })
})

describe('MIN_REPUTATION config', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  it('reads MIN_REPUTATION and defaults MIN_PAID_REVIEWS to 3', () => {
    process.env.MIN_REPUTATION = '60'
    const c = loadConfig()
    expect(c.minReputation).toBe(60)
    expect(c.minPaidReviews).toBe(3)
  })
  it('treats blank (an empty Claude Desktop setting) and unset as no minimum', () => {
    delete process.env.MIN_REPUTATION
    expect(loadConfig().minReputation).toBe(0)
    process.env.MIN_REPUTATION = ''
    expect(loadConfig().minReputation).toBe(0)
  })
  it('refuses a typo instead of silently disabling the safety setting', () => {
    process.env.MIN_REPUTATION = 'sixty'
    expect(() => loadConfig()).toThrow(/MIN_REPUTATION/)
    process.env.MIN_REPUTATION = '150'
    expect(() => loadConfig()).toThrow(/MIN_REPUTATION/)
  })
})
