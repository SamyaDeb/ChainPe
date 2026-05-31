import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerX402Fetch } from '../src/tools/x402-fetch.js'

const mockCreatePaymentPayload = vi.fn()
const mockEncodePaymentSignatureHeader = vi.fn()

vi.mock('../src/clients.js', () => ({
  createHttpClient: vi.fn().mockResolvedValue({
    createPaymentPayload: (...args: unknown[]) =>
      mockCreatePaymentPayload(...args),
    encodePaymentSignatureHeader: (...args: unknown[]) =>
      mockEncodePaymentSignatureHeader(...args)
  }),
  isAlgorandNetwork: vi.fn((net: string) => net.startsWith('algorand'))
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Algorand testnet CAIP-2 (genesis hash) and USDC ASA / recipient fixtures.
const ALGO_TESTNET_CAIP2 =
  'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
const USDC_TESTNET_ASA = '10458941'
const RECIPIENT = 'ALGORECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7A'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    algorandMnemonic: undefined,
    network: 'algorand-testnet',
    budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
    canPay: false,
    canPayAlgorand: false,
    mode: 'READ_ONLY',
    reload: vi.fn(),
    ...overrides
  }
}

function payableConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return makeConfig({
    canPay: true,
    canPayAlgorand: true,
    algorandMnemonic: 'test mnemonic',
    mode: 'ALGORAND_ONLY',
    ...overrides
  })
}

function acceptsAlgo(amount: string) {
  return {
    scheme: 'exact',
    network: ALGO_TESTNET_CAIP2,
    asset: USDC_TESTNET_ASA,
    amount,
    payTo: RECIPIENT,
    maxTimeoutSeconds: 300,
    extra: {}
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
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)
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
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

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
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

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

  it('handles 402 and retries with payment header', async () => {
    const paymentRequiredBody = {
      x402Version: 2,
      error: '',
      resource: { url: '', description: '', mimeType: '' },
      accepts: [acceptsAlgo('50000')] // 0.05 USDC (6 decimals)
    }

    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue(paymentRequiredBody)
    })
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: vi.fn().mockResolvedValue('paid content')
    })

    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'signed-header-value'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

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
    expect(parsed.payment.network).toBe('algorand-testnet')

    expect(mockFetch).toHaveBeenCalledTimes(2)

    const retryCall = mockFetch.mock.calls[1]
    expect(retryCall[1].headers['PAYMENT-SIGNATURE']).toBe('signed-header-value')
  })

  it('parses payment info from base64 Payment-Required header', async () => {
    const paymentRequiredBody = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: '', description: '', mimeType: '' },
      accepts: [acceptsAlgo('50000')]
    }

    const headerValue = Buffer.from(
      JSON.stringify(paymentRequiredBody)
    ).toString('base64')

    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: {
        get: (name: string) =>
          name === 'Payment-Required' ? headerValue : null
      },
      json: vi.fn().mockResolvedValue({})
    })
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: vi.fn().mockResolvedValue('paid via header')
    })

    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'signed-header-value'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.body).toBe('paid via header')
    expect(parsed.payment.amount).toBe('0.050000 USDC')
    expect(parsed.payment.network).toBe('algorand-testnet')
  })

  it('returns error when 402 has no accepts', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 2,
        error: '',
        resource: { url: '', description: '', mimeType: '' },
        accepts: []
      })
    })

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
    expect(result.content[0].text).toContain('no payment options')
  })

  it('returns error when wallet cannot fulfill any accepted network', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 2,
        error: '',
        resource: { url: '', description: '', mimeType: '' },
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:84532', // non-Algorand → unsupported
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            amount: '500000',
            payTo: '0xRecipient',
            maxTimeoutSeconds: 300,
            extra: {}
          }
        ]
      })
    })

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
    expect(result.content[0].text).toContain('Cannot fulfill payment')
  })

  it('checks spending limits before signing', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 2,
        error: '',
        resource: { url: '', description: '', mimeType: '' },
        accepts: [acceptsAlgo('5000000')] // 5.0 USDC — over the 1.00 per-call cap
      })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({
      budget: { maxPerCall: '1.00', maxPerDay: '20.00' }
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/expensive',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
    // Signing must NOT have happened
    expect(mockCreatePaymentPayload).not.toHaveBeenCalled()
  })

  it('returns isError with funding instructions when retry also returns 402 (settle failure)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          x402Version: 2,
          error: '',
          resource: { url: '', description: '', mimeType: '' },
          accepts: [acceptsAlgo('20000')] // 0.02 USDC
        })
      })
      .mockResolvedValueOnce({
        // Settle failed — server re-issues 402 with empty body
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => 'application/json' },
        text: vi.fn().mockResolvedValue('{}')
      })

    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'header'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    // Must be marked as an error with funding instructions
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('wallet needs')
    expect(result.content[0].text).toContain('10458941')
    // Spending must NOT be recorded for a failed settlement
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
          x402Version: 2,
          error: '',
          resource: { url: '', description: '', mimeType: '' },
          accepts: [acceptsAlgo('50000')]
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'text/plain' },
        text: vi.fn().mockResolvedValue('result')
      })

    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'header'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })

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
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

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
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/down',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network error')
  })
})
