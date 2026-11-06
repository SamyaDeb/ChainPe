import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import { callSchema, paidCall } from '@/tools/x402-fetch.js'

export function registerPay(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'pay',
    'Pay an x402 URL on a chosen payment rail, within the spending limits. "exact" moves USDC from ' +
      'the wallet, and needs a price of at least $0.01. "gateway" pays from a Circle Gateway deposit ' +
      'with no gas. Use x402_fetch to let the wallet choose, and transfer_usdc to send USDC to an address.',
    {
      ...callSchema,
      rail: z.enum(['exact', 'gateway']).describe('The payment rail to use')
    },
    async ({ url, method, headers, body, rail }) =>
      paidCall(config, spending, { url, method, headers, body, rail })
  )
}
