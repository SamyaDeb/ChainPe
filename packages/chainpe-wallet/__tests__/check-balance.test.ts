import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { registerCheckBalance } from '../src/tools/check-balance.js'

vi.mock('../src/clients.js', () => ({
  getWalletAddress: vi.fn(),
  getUsdcBalance: vi.fn(),
  getAvaxBalance: vi.fn()
}))

import { getWalletAddress, getUsdcBalance, getAvaxBalance } from '../src/clients.js'

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

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'check_balance')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

describe('check_balance tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerCheckBalance(server, makeConfig())
    expect(server.tool).toHaveBeenCalledWith(
      'check_balance',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerCheckBalance(server, makeConfig({ canPay: false }))

    const handler = extractToolHandler(server)
    const result = (await handler({})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns balance and address on success', async () => {
    vi.mocked(getWalletAddress).mockReturnValue('0xWALLET')
    vi.mocked(getUsdcBalance).mockResolvedValue('100.500000')
    vi.mocked(getAvaxBalance).mockResolvedValue('2.5')

    const server = { tool: vi.fn() } as unknown as McpServer
    registerCheckBalance(
      server,
      makeConfig({ canPay: true, privateKey: '0xkey', mode: 'AVALANCHE' })
    )

    const handler = extractToolHandler(server)
    const result = (await handler({})) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.address).toBe('0xWALLET')
    expect(parsed.usdc).toBe('100.500000 USDC')
    expect(parsed.avax).toBe('2.5 AVAX')
    expect(parsed.network).toBe('fuji')
    expect(parsed.mode).toBe('AVALANCHE')
  })

  it('returns error when address derivation fails', async () => {
    vi.mocked(getWalletAddress).mockImplementation(() => {
      throw new Error('bad key')
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    registerCheckBalance(server, makeConfig({ canPay: true, privateKey: '0xkey' }))

    const handler = extractToolHandler(server)
    const result = (await handler({})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('bad key')
  })
})
