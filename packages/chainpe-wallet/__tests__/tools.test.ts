import { describe, it, expect, vi, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerX402Fetch } from '../src/tools/x402-fetch.js'
import { registerPay } from '../src/tools/pay.js'
import { registerBazaarSearch } from '../src/tools/bazaar-search.js'
import { registerRequestFunding } from '../src/tools/request-funding.js'
import { registerGiveFeedback } from '../src/tools/give-feedback.js'
import { registerCheckBalance } from '../src/tools/check-balance.js'
import { registerDepositGateway } from '../src/tools/deposit-gateway.js'
import { registerTransferUsdc } from '../src/tools/transfer-usdc.js'

// Well-known Hardhat test account #0 (public, not a real secret).
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const PAY_TO = '0x261f058496D81703c858DDFEd201834F0b5f2e73'
const NETWORK = 'eip155:5042002'
const TX = `0x${'ab'.repeat(32)}`
const URL_PAID = 'https://api.example.com/paid'

type Result = { isError?: boolean; content: { text: string }[] }
type Handler = (args: Record<string, unknown>) => Promise<Result>

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: KEY,
    network: 'arc-testnet',
    rails: ['exact'],
    budget: { maxPerCall: '0.10', maxPerDay: '1.00' },
    canPay: true,
    mode: 'ARC',
    reload: () => {},
    ...overrides
  }
}

function toolsOf(register: (server: McpServer) => void): Record<string, Handler> {
  const tool = vi.fn()
  register({ tool } as unknown as McpServer)
  return Object.fromEntries(tool.mock.calls.map(call => [call[0], call[call.length - 1]]))
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64')

function required(amount = '10000', headers: Record<string, string> = {}) {
  return new Response('{}', {
    status: 402,
    headers: {
      'PAYMENT-REQUIRED': encode({
        x402Version: 2,
        error: 'Payment required',
        resource: { url: URL_PAID, description: 'test', mimeType: '' },
        accepts: [
          {
            scheme: 'exact',
            network: NETWORK,
            amount,
            asset: '0x3600000000000000000000000000000000000000',
            payTo: PAY_TO,
            maxTimeoutSeconds: 300,
            extra: { name: 'USDC', version: '2', paymentFlow: 'upfront' }
          }
        ]
      }),
      ...headers
    }
  })
}

function paid() {
  return new Response(JSON.stringify({ forecast: 'sunny' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'PAYMENT-RESPONSE': encode({ success: true, transaction: TX, network: NETWORK, payer: ADDRESS })
    }
  })
}

function stubPaidFlow(first: () => Response = required, second: () => Response = paid) {
  const signed: boolean[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      signed.push(request.headers.has('PAYMENT-SIGNATURE'))
      return signed.length === 1 ? first() : second()
    })
  )
  return signed
}

afterEach(() => vi.unstubAllGlobals())

describe('x402_fetch and pay', () => {
  const tools = (config: AppConfig, spending: SpendingTracker) =>
    toolsOf(server => {
      registerX402Fetch(server, config, spending)
      registerPay(server, config, spending)
    })

  it('pays, returns the body, records the spend and offers a rating', async () => {
    const signed = stubPaidFlow(() => required('10000', { 'X-CHAINPE-AGENT-ID': '897796' }))
    const spending = new SpendingTracker(makeConfig().budget)
    const result = await tools(makeConfig(), spending).x402_fetch({ url: URL_PAID, method: 'GET' })
    const body = JSON.parse(result.content[0].text)

    expect(signed).toEqual([false, true])
    expect(JSON.parse(body.body)).toEqual({ forecast: 'sunny' })
    expect(body.payment).toMatchObject({ amount: '0.01 USDC', recipient: PAY_TO, rail: 'exact', txHash: TX, network: 'arc-testnet' })
    expect(body.rateWith.agentId).toBe('897796')
    expect(spending.getSummary().spentToday).toBe('0.0100')
  })

  it('does not count or charge a free call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } })))
    const spending = new SpendingTracker(makeConfig().budget)
    const result = await tools(makeConfig(), spending).x402_fetch({ url: URL_PAID, method: 'GET' })
    const body = JSON.parse(result.content[0].text)
    expect(body.body).toBe('ok')
    expect(body.payment).toBeUndefined()
    expect(spending.getSummary().spentToday).toBe('0.0000')
  })

  it('refuses a price above MAX_PER_CALL before signing', async () => {
    const signed = stubPaidFlow(() => required('200000'))
    const spending = new SpendingTracker(makeConfig().budget)
    const result = await tools(makeConfig(), spending).x402_fetch({ url: URL_PAID, method: 'GET' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/exceeds maxPerCall/)
    expect(signed).toEqual([false])
    expect(spending.getSummary().spentToday).toBe('0.0000')
  })

  it('refuses a price above what is left today before signing', async () => {
    const signed = stubPaidFlow(() => required('10000'))
    const config = makeConfig({ budget: { maxPerCall: '0.10', maxPerDay: '0.015' } })
    const spending = new SpendingTracker(config.budget)
    spending.record('0.01', PAY_TO, 'arc-testnet')
    const result = await tools(config, spending).x402_fetch({ url: URL_PAID, method: 'GET' })
    expect(result.isError).toBe(true)
    expect(signed).toEqual([false])
  })

  it('makes no request once the daily budget is used up', async () => {
    const signed = stubPaidFlow()
    const config = makeConfig({ budget: { maxPerCall: '0.10', maxPerDay: '0.01' } })
    const spending = new SpendingTracker(config.budget)
    spending.record('0.01', PAY_TO, 'arc-testnet')
    const result = await tools(config, spending).x402_fetch({ url: URL_PAID, method: 'GET' })
    expect(result.content[0].text).toMatch(/Daily limit/)
    expect(signed).toEqual([])
  })

  it('does not record a payment the server refused', async () => {
    stubPaidFlow(required, () => new Response(JSON.stringify({ reason: 'insufficient_funds' }), { status: 402, headers: { 'content-type': 'application/json' } }))
    const spending = new SpendingTracker(makeConfig().budget)
    const result = await tools(makeConfig(), spending).x402_fetch({ url: URL_PAID, method: 'GET' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/insufficient_funds/)
    expect(spending.getSummary().spentToday).toBe('0.0000')
  })

  it('pay uses only the chosen rail', async () => {
    const signed = stubPaidFlow()
    const spending = new SpendingTracker(makeConfig().budget)
    const result = await tools(makeConfig({ rails: ['gateway', 'exact'] }), spending).pay({ url: URL_PAID, method: 'GET', rail: 'exact' })
    expect(JSON.parse(result.content[0].text).payment.rail).toBe('exact')
    expect(signed).toEqual([false, true])
  })

  it('needs a wallet', async () => {
    const result = await tools(makeConfig({ canPay: false, privateKey: undefined }), new SpendingTracker(makeConfig().budget)).x402_fetch({ url: URL_PAID, method: 'GET' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/No wallet configured/)
  })
})

describe('search_bazaar', () => {
  it('works with no wallet and shows Circle listings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith('https://api.circle.com')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  resource: 'https://w.test/forecast',
                  accepts: [{ network: NETWORK, amount: '1000', payTo: PAY_TO, extra: { name: 'GatewayWalletBatched' } }],
                  metadata: { provider: { name: 'Weather Co' }, method: 'GET', description: 'Forecasts' }
                }
              ]
            })
          )
        }
        throw new Error('RPC is off in this test')
      })
    )
    const { search_bazaar } = toolsOf(server => registerBazaarSearch(server, makeConfig({ canPay: false, privateKey: undefined })))
    const { content, isError } = await search_bazaar({ query: 'weather' })
    expect(isError).toBeUndefined()
    expect(content[0].text).toContain('Weather Co')
    expect(content[0].text).toContain('0.001 USDC')
    expect(content[0].text).toContain('Pays by: gateway')
    expect(content[0].text).toContain('GET https://w.test/forecast')
  })

  it('reports a failure only when no source can be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { search_bazaar } = toolsOf(server => registerBazaarSearch(server, makeConfig()))
    expect((await search_bazaar({})).isError).toBe(true)
  })
})

describe('other tools need a wallet and validate input', () => {
  const noWallet = makeConfig({ canPay: false, privateKey: undefined })

  it('refuses with no wallet', async () => {
    const spending = new SpendingTracker(noWallet.budget)
    const all = toolsOf(server => {
      registerCheckBalance(server, noWallet)
      registerDepositGateway(server, noWallet)
      registerGiveFeedback(server, noWallet)
      registerRequestFunding(server, noWallet)
      registerTransferUsdc(server, noWallet, spending)
    })
    expect(Object.keys(all).sort()).toEqual(['check_balance', 'deposit_gateway', 'give_feedback', 'request_funding', 'transfer_usdc'])
    for (const handler of Object.values(all)) {
      const result = await handler({ agentId: '5', score: 100, amount: '1', to: PAY_TO })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/No wallet configured/)
    }
  })

  it('give_feedback refuses a provider with no agent id', async () => {
    const { give_feedback } = toolsOf(server => registerGiveFeedback(server, makeConfig()))
    const result = await give_feedback({ agentId: '0', score: 100 })
    expect(result.content[0].text).toMatch(/no ERC-8004 agent id/)
  })

  it('deposit_gateway refuses more than the daily limit', async () => {
    const { deposit_gateway } = toolsOf(server => registerDepositGateway(server, makeConfig()))
    const result = await deposit_gateway({ amount: '5' })
    expect(result.content[0].text).toMatch(/above the daily limit/)
  })

  it('transfer_usdc enforces the spending limit and a positive amount', async () => {
    const config = makeConfig()
    const { transfer_usdc } = toolsOf(server => registerTransferUsdc(server, config, new SpendingTracker(config.budget)))
    expect((await transfer_usdc({ to: PAY_TO, amount: '5' })).content[0].text).toMatch(/per-call limit/)
    expect((await transfer_usdc({ to: PAY_TO, amount: '0' })).content[0].text).toMatch(/greater than 0/)
  })

  it('request_funding builds an Arc link and points to the faucet on testnet', async () => {
    const { request_funding } = toolsOf(server => registerRequestFunding(server, makeConfig()))
    const body = JSON.parse((await request_funding({ amount: '5.00' })).content[0].text)
    expect(body.chainId).toBe(5042002)
    expect(body.walletAddress).toBe(ADDRESS)
    expect(body.paymentUri).toBe(`ethereum:0x3600000000000000000000000000000000000000@5042002/transfer?address=${ADDRESS}&uint256=5000000`)
    expect(body.instructions[0]).toContain('faucet.circle.com')
  })
})
