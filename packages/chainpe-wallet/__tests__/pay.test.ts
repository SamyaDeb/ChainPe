import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerPay } from '../src/tools/pay.js'

const mockCreatePaymentPayload = vi.fn()
const mockEncodePaymentSignatureHeader = vi.fn()

vi.mock('../src/clients.js', () => ({
  createHttpClient: vi.fn().mockResolvedValue({
    createPaymentPayload: (...args: unknown[]) =>
      mockCreatePaymentPayload(...args),
    encodePaymentSignatureHeader: (...args: unknown[]) =>
      mockEncodePaymentSignatureHeader(...args)
  }),
  getCaip2Network: vi.fn((net: string) => {
    const map: Record<string, string> = {
      algorand: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
      'algorand-testnet':
        'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
    }
    return map[net]
  })
}))

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

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'pay')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

const RECIPIENT = 'RECIPIENTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7A'

describe('pay tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)
    expect(server.tool).toHaveBeenCalledWith(
      'pay',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'algorand-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('rejects payment exceeding per-call budget', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({
      budget: { maxPerCall: '0.01', maxPerDay: '20.00' }
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.50',
      recipient: RECIPIENT,
      network: 'algorand-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
  })

  it('returns payment header on success', async () => {
    mockCreatePaymentPayload.mockResolvedValue({
      x402Version: 2,
      payload: 'signed-data'
    })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'base64-payment-header-value'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'algorand-testnet',
      resource: 'https://api.example.com/data'
    })) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.paymentHeader).toBe('base64-payment-header-value')
    expect(parsed.headerName).toBe('PAYMENT-SIGNATURE')
    expect(parsed.amount).toBe('0.05 USDC')
    expect(parsed.recipient).toBe(RECIPIENT)
    expect(parsed.network).toBe('algorand-testnet')
    expect(parsed.hint).toContain('PAYMENT-SIGNATURE')
  })

  it('uses an empty extra for the Algorand AVM exact scheme', async () => {
    mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: 'd' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'header-value'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'algorand-testnet'
    })

    const paymentRequired = mockCreatePaymentPayload.mock.calls[0][0]
    expect(paymentRequired.accepts[0].extra).toEqual({})
    // USDC has 6 decimals on Algorand → 0.05 USDC = 50000 atomic units
    expect(paymentRequired.accepts[0].amount).toBe('50000')
  })

  it('records spending after successful payment', async () => {
    mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: 'd' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'header-value'
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'algorand-testnet'
    })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments).toHaveLength(1)
    expect(summary.recentPayments[0].recipient).toBe(RECIPIENT)
  })

  it('returns error when payment signing fails', async () => {
    mockCreatePaymentPayload.mockRejectedValue(new Error('Signing failed'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'algorand-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Signing failed')
  })

  it('does not record spending when payment fails', async () => {
    mockCreatePaymentPayload.mockRejectedValue(new Error('fail'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'algorand-testnet'
    })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBe(0)
    expect(summary.recentPayments).toHaveLength(0)
  })
})
