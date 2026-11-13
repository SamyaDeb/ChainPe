import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerPay } from '../src/tools/pay.js'

const mockCreatePaymentHeader = vi.fn()

vi.mock('x402/client', () => ({
  createPaymentHeader: (...args: unknown[]) => mockCreatePaymentHeader(...args)
}))

vi.mock('../src/clients.js', () => ({
  buildSigner: vi.fn().mockResolvedValue({ account: { address: '0xSigner' } }),
  getX402Network: vi.fn(() => 'avalanche-fuji'),
  getUsdcAddress: vi.fn(() => '0x5425890298aed601595a70AB815c96711a31Bc65'),
  USDC_DECIMALS: 6
}))

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

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'pay')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

const RECIPIENT = '0x1111111111111111111111111111111111111111'

describe('pay tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    registerPay(server, config, new SpendingTracker(config.budget))
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
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'fuji'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('rejects payment exceeding per-call budget', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({ budget: { maxPerCall: '0.01', maxPerDay: '20.00' } })
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.50',
      recipient: RECIPIENT,
      network: 'fuji'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
  })

  it('returns payment header on success', async () => {
    mockCreatePaymentHeader.mockResolvedValue('base64-payment-header-value')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'fuji',
      resource: 'https://api.example.com/data'
    })) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.paymentHeader).toBe('base64-payment-header-value')
    expect(parsed.headerName).toBe('X-PAYMENT')
    expect(parsed.amount).toBe('0.05 USDC')
    expect(parsed.recipient).toBe(RECIPIENT)
    expect(parsed.network).toBe('fuji')
    expect(parsed.hint).toContain('X-PAYMENT')
  })

  it('builds requirements with correct atomic amount (6 decimals)', async () => {
    mockCreatePaymentHeader.mockResolvedValue('header-value')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    await handler({ amount: '0.05', recipient: RECIPIENT, network: 'fuji' })

    const requirements = mockCreatePaymentHeader.mock.calls[0][2]
    expect(requirements.maxAmountRequired).toBe('50000') // 0.05 * 1e6
    expect(requirements.scheme).toBe('exact')
    expect(requirements.network).toBe('avalanche-fuji')
    expect(requirements.payTo).toBe(RECIPIENT)
  })

  it('records spending after successful payment', async () => {
    mockCreatePaymentHeader.mockResolvedValue('header-value')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({ amount: '0.05', recipient: RECIPIENT, network: 'fuji' })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments).toHaveLength(1)
    expect(summary.recentPayments[0].recipient).toBe(RECIPIENT)
  })

  it('returns error when payment signing fails', async () => {
    mockCreatePaymentHeader.mockRejectedValue(new Error('Signing failed'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'fuji'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Signing failed')
  })

  it('does not record spending when payment fails', async () => {
    mockCreatePaymentHeader.mockRejectedValue(new Error('fail'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({ amount: '0.05', recipient: RECIPIENT, network: 'fuji' })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBe(0)
    expect(summary.recentPayments).toHaveLength(0)
  })
})
