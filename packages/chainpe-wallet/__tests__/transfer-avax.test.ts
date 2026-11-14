import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerTransferAvax } from '../src/tools/transfer-avax.js'

const sendTransaction = vi.fn().mockResolvedValue('0xhash')
vi.mock('viem', async orig => ({
  ...(await orig<typeof import('viem')>()),
  createWalletClient: () => ({ sendTransaction })
}))
vi.mock('../src/clients.js', () => ({
  rpcUrlFor: () => 'http://localhost',
  publicClientFor: () => ({
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 1n })
  })
}))

const config = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  network: 'fuji',
  canPay: true,
  mode: 'AVALANCHE',
  budget: { maxPerCall: '1', maxPerDay: '10' },
  reload: vi.fn()
} as unknown as AppConfig
const TO = '0x1111111111111111111111111111111111111111'

function handlerFor(spending: SpendingTracker) {
  const server = { tool: vi.fn() } as unknown as McpServer
  registerTransferAvax(server, config, spending)
  const call = vi.mocked(server.tool).mock.calls[0]
  return call[call.length - 1] as (a: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>
}

describe('transfer_avax caps', () => {
  it('refuses a transfer over the per-transfer cap without sending', async () => {
    const h = handlerFor(new SpendingTracker(config.budget))
    const r = await h({ to: TO, amount: '5', network: 'fuji' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('per-transfer limit')
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('sends within the cap, then refuses once the daily cap is used', async () => {
    const h = handlerFor(
      new SpendingTracker({ ...config.budget, maxAvaxPerTransfer: '0.1', maxAvaxPerDay: '0.15' })
    )
    expect((await h({ to: TO, amount: '0.1', network: 'fuji' })).isError).toBeUndefined()
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    const r = await h({ to: TO, amount: '0.1', network: 'fuji' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('daily AVAX limit')
    expect(sendTransaction).toHaveBeenCalledTimes(1)
  })
})
