import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { registerGiveFeedback } from '../src/tools/give-feedback.js'

vi.mock('../src/reputation.js', () => ({
  giveFeedback: vi.fn(),
  resolveReputationRegistry: vi.fn()
}))
import { giveFeedback, resolveReputationRegistry } from '../src/reputation.js'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: '0xkey',
    network: 'fuji',
    budget: { maxPerCall: '1', maxPerDay: '1' },
    canPay: true,
    mode: 'AVALANCHE',
    reload: () => {},
    ...overrides
  }
}

function handler(server: McpServer): (...a: unknown[]) => Promise<unknown> {
  const call = vi.mocked(server.tool).mock.calls.find(c => c[0] === 'give_feedback')
  return call![call!.length - 1] as (...a: unknown[]) => Promise<unknown>
}

const REG = '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4'

describe('give_feedback tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers the tool', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    expect(server.tool).toHaveBeenCalledWith(
      'give_feedback',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('errors when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig({ canPay: false }))
    const r = (await handler(server)({ agentId: '5', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('No wallet configured')
  })

  it('errors when reputation registry is not configured', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(undefined)
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '5', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('Reputation registry not configured')
  })

  it('errors when the provider has no agent id', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '0', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('no ERC-8004 agent id')
  })

  it('submits an on-chain score and returns the tx hash', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    vi.mocked(giveFeedback).mockResolvedValue('0xfeed')
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '5', score: 95, endpoint: 'https://x' })) as {
      content: { text: string }[]
    }
    const parsed = JSON.parse(r.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.agentId).toBe('5')
    expect(parsed.score).toBe(95)
    expect(parsed.txHash).toBe('0xfeed')
    expect(parsed.explorer).toContain('testnet.snowtrace.io/tx/0xfeed')
    expect(vi.mocked(giveFeedback)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: '5', value: 95, waitConfirm: true })
    )
  })

  it('surfaces a self-feedback hint', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    vi.mocked(giveFeedback).mockRejectedValue(new Error('Self-feedback not allowed'))
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '5', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('cannot rate your own agent')
  })
})
