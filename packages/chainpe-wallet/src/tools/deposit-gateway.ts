import { z } from 'zod'
import { explorerFor } from '@chainpearc/sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import {
  clientFor,
  errorMessage,
  NO_WALLET_MESSAGE,
  toolError,
  toolJson
} from '@/clients.js'

export function registerDepositGateway(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'deposit_gateway',
    'Move USDC from this wallet into its Circle Gateway balance, so x402 calls can be paid with no gas, ' +
      'from fractions of a cent. The funds stay yours. This is a real transaction, so only do it when the ' +
      'user asks. Limited to the daily spending limit.',
    {
      amount: z.string().describe('USDC amount as decimal string, e.g. "1.00"')
    },
    async ({ amount }) => {
      if (!config.canPay) return toolError(NO_WALLET_MESSAGE)
      if (parseFloat(amount) > parseFloat(config.budget.maxPerDay)) {
        return toolError(
          `Deposit of $${amount} is above the daily limit of $${config.budget.maxPerDay}.`
        )
      }
      try {
        const { txHash, amount: deposited } =
          await clientFor(config).depositGateway(amount)
        return toolJson({
          success: true,
          amount: `${deposited} USDC`,
          network: config.network,
          txHash,
          explorerUrl: `${explorerFor(config.network)}/tx/${txHash}`
        })
      } catch (err) {
        return toolError(`Deposit failed: ${errorMessage(err)}`)
      }
    }
  )
}
