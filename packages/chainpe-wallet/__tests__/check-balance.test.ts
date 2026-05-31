import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { registerCheckBalance } from '../src/tools/check-balance.js'

vi.mock('../src/clients.js', () => ({
  getWalletAddress: vi.fn(),
  getUsdcBalance: vi.fn(),
  // Return false so the tool skips the live ALGO-balance network call.
  isAlgorandNetwork: vi.fn(() => false)
}))

import { getWalletAddress, getUsdcBalance } from '../src/clients.js'

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
    const config = makeConfig()
    registerCheckBalance(server, config)
    expect(server.tool).toHaveBeenCalledWith(
      'check_balance',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns balance and address on success', async () => {
    vi.mocked(getWalletAddress).mockResolvedValue('ALGOADDR...XYZ')
    vi.mocked(getUsdcBalance).mockResolvedValue('100.500000')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'test mnemonic',
      mode: 'ALGORAND_ONLY'
    })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.address).toBe('ALGOADDR...XYZ')
    expect(parsed.usdc).toBe('100.500000 USDC')
    expect(parsed.network).toBe('algorand-testnet')
    expect(parsed.mode).toBe('ALGORAND_ONLY')
  })

  it('returns error when balance fetch fails', async () => {
    vi.mocked(getWalletAddress).mockRejectedValue(new Error('Network error'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'test mnemonic'
    })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network error')
  })
})
