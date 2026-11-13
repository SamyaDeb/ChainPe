import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerX402Fetch } from '../src/tools/x402-fetch.js'

const mockCreatePaymentHeader = vi.fn()

vi.mock('x402/client', () => ({
  createPaymentHeader: (...args: unknown[]) => mockCreatePaymentHeader(...args)
}))

vi.mock('x402-fetch', () => ({
  decodeXPaymentResponse: vi.fn(() => ({ success: true }))
}))

vi.mock('../src/clients.js', () => ({
  buildSigner: vi.fn().mockResolvedValue({ account: { address: '0xSigner' } }),
  USDC_DECIMALS: 6
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const USDC_FUJI = '0x5425890298aed601595a70AB815c96711a31Bc65'
const RECIPIENT = '0x1111111111111111111111111111111111111111'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: undefined,
    network: 'fuji',
    registryAddress: undefined,
    budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
    canPay: false,
    mode: 'READ_ONLY',
    reload: vi.fn(),
    ...overrides
  }
}

function payableConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return makeConfig({ canPay: true, privateKey: '0xkey', mode: 'AVALANCHE', ...overrides })
}

function acceptsFuji(maxAmountRequired: string) {
  return {
    scheme: 'exact',
    network: 'avalanche-fuji',
    asset: USDC_FUJI,
    maxAmountRequired,
    payTo: RECIPIENT,
    maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' }
  }
}

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'x402_fetch')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

type ToolResult = {
  isError?: boolean
  content: { type: string; text: string }[]
}

describe('x402_fetch tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))
    expect(server.tool).toHaveBeenCalledWith(
      'x402_fetch',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/data',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns response directly when status is not 402', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      text: vi.fn().mockResolvedValue('{"result":"success"}')
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/free',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.body).toBe('{"result":"success"}')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles 402 and retries with X-PAYMENT header', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 1,
        accepts: [acceptsFuji('50000')] // 0.05 USDC
      })
    })
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: vi.fn().mockResolvedValue('paid content')
    })

    mockCreatePaymentHeader.mockResolvedValue('signed-header-value')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.body).toBe('paid content')
    expect(parsed.payment.amount).toBe('0.050000 USDC')
    expect(parsed.payment.recipient).toBe(RECIPIENT)
    expect(parsed.payment.network).toBe('fuji')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    const retryCall = mockFetch.mock.calls[1]
    expect(retryCall[1].headers['X-PAYMENT']).toBe('signed-header-value')
  })

  it('returns error when 402 has no accepts', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({ x402Version: 1, accepts: [] })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('no payment options')
  })

  it('returns error when wallet cannot fulfill any accepted network', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 1,
        accepts: [
          {
            scheme: 'exact',
            network: 'base-sepolia', // not Avalanche → unsupported here
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            maxAmountRequired: '500000',
            payTo: '0xRecipient',
            maxTimeoutSeconds: 300,
            extra: {}
          }
        ]
      })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Cannot fulfill payment')
  })

  it('checks spending limits before signing', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 1,
        accepts: [acceptsFuji('5000000')] // 5.0 USDC — over the 1.00 cap
      })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({ budget: { maxPerCall: '1.00', maxPerDay: '20.00' } })
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/expensive',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
    expect(mockCreatePaymentHeader).not.toHaveBeenCalled()
  })

  it('returns funding instructions when retry also returns 402 (settle failure)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          x402Version: 1,
          accepts: [acceptsFuji('20000')] // 0.02 USDC
        })
      })
      .mockResolvedValueOnce({
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => 'application/json' },
        text: vi.fn().mockResolvedValue('{}')
      })

    mockCreatePaymentHeader.mockResolvedValue('header')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('wallet needs')
    expect(result.content[0].text).toContain('faucet.circle.com')
    expect(parseFloat(spending.getSummary().spentSession)).toBe(0)
    expect(spending.getSummary().recentPayments).toHaveLength(0)
  })

  it('records spending after successful paid fetch', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          x402Version: 1,
          accepts: [acceptsFuji('50000')]
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'text/plain' },
        text: vi.fn().mockResolvedValue('result')
      })

    mockCreatePaymentHeader.mockResolvedValue('header')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({ url: 'https://api.example.com/paid', method: 'GET' })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments).toHaveLength(1)
    expect(summary.recentPayments[0].recipient).toBe(RECIPIENT)
  })

  it('passes custom headers and body to fetch', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: vi.fn().mockResolvedValue('ok')
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    await handler({
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}'
    })

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.body).toBe('{"key":"value"}')
  })

  it('handles fetch network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/down',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network error')
  })
})
