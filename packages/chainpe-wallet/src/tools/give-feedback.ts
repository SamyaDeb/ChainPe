import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { giveFeedback, resolveReputationRegistry } from '@/reputation.js'

/**
 * give_feedback — post an on-chain reputation score for a provider's agent.
 * Writes to the ERC-8004 Reputation Registry (a real transaction). The score is
 * stored and aggregated on-chain; self-feedback is rejected by the contract.
 */
export function registerGiveFeedback(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'give_feedback',
    'Leave on-chain reputation feedback for a service provider (ERC-8004). Submits a real ' +
      'transaction to the Reputation Registry with a 0–100 score. Use after calling a paid service; ' +
      'pass the agentId shown by search_bazaar.',
    {
      agentId: z
        .string()
        .describe(
          "The provider service's ERC-8004 agent id (from search_bazaar)"
        ),
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
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY.'
            }
          ],
          isError: true
        }
      }
      if (!resolveReputationRegistry(config)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Reputation registry not configured. Set ERC8004_REPUTATION_REGISTRY.'
            }
          ],
          isError: true
        }
      }
      if (!agentId || agentId === '0') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'This provider has no ERC-8004 agent id, so it cannot be scored.'
            }
          ],
          isError: true
        }
      }

      try {
        const txHash = await giveFeedback(config, {
          agentId,
          value: score,
          endpoint,
          tag,
          waitConfirm: true
        })
        const explorer =
          config.network === 'fuji'
            ? `https://testnet.snowtrace.io/tx/${txHash}`
            : `https://snowtrace.io/tx/${txHash}`
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  agentId,
                  score,
                  txHash,
                  explorer,
                  note: 'Feedback recorded on-chain in the ERC-8004 Reputation Registry.'
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const hint = /self-feedback/i.test(msg)
          ? ' (you cannot rate your own agent)'
          : ''
        return {
          content: [
            { type: 'text' as const, text: `Feedback failed: ${msg}${hint}` }
          ],
          isError: true
        }
      }
    }
  )
}
