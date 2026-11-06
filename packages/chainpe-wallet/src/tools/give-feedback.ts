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

/**
 * give_feedback — post an on-chain reputation score for a provider's agent.
 * Writes to Arc's ERC-8004 Reputation Registry (a real transaction). The score is
 * stored and aggregated on-chain; self-feedback is rejected by the contract.
 */
export function registerGiveFeedback(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'give_feedback',
    'Leave on-chain reputation feedback for a service provider (ERC-8004 on Arc). Submits a real ' +
      'transaction with a 0–100 score, which costs a little gas in USDC. Use after calling a paid service; ' +
      'pass the agentId shown by search_bazaar or x402_fetch.',
    {
      agentId: z.string().describe("The provider service's ERC-8004 agent id"),
      score: z
        .number()
        .min(0)
        .max(100)
        .describe('Score 0–100 (e.g. 100 = excellent, 0 = bad)'),
      endpoint: z
        .string()
        .optional()
        .describe('The service endpoint the feedback is about'),
      tag: z
        .string()
        .optional()
        .describe('Optional short tag, e.g. "weather" or "accuracy"')
    },
    async ({ agentId, score, endpoint, tag }) => {
      if (!config.canPay) return toolError(NO_WALLET_MESSAGE)
      if (!agentId || agentId === '0') {
        return toolError(
          'This provider has no ERC-8004 agent id, so it cannot be scored.'
        )
      }
      try {
        const txHash = await clientFor(config).giveFeedback(agentId, score, {
          endpoint,
          tag,
          waitConfirm: true
        })
        return toolJson({
          success: true,
          agentId,
          score,
          txHash,
          explorer: `${explorerFor(config.network)}/tx/${txHash}`,
          note: 'Feedback recorded on-chain in the ERC-8004 Reputation Registry.'
        })
      } catch (err) {
        const msg = errorMessage(err)
        const hint = /self.?feedback/i.test(msg)
          ? ' (you cannot rate your own agent)'
          : ''
        return toolError(`Feedback failed: ${msg}${hint}`)
      }
    }
  )
}
