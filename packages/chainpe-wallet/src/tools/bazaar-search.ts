/**
 * search_bazaar tool — discover x402-gated services from the on-chain ChainPe
 * registry (ChainPeRegistry contract on Avalanche C-Chain).
 *
 * Lets the agent see which paid APIs are available, with their price and the
 * endpoint to hand to `x402_fetch` for automatic payment.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { RegistryClient } from '@/chainpe-registry.js'
import { getReputation } from '@/reputation.js'

export function registerBazaarSearch(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'search_bazaar',
    'Discover x402-gated services registered on the ChainPe on-chain registry (Avalanche). Returns ' +
      'each service with its description, price, tags, and endpoint URL. To use a service, pass its ' +
      'endpoint to the `x402_fetch` tool, which handles the USDC payment automatically.',
    {
      query: z
        .string()
        .optional()
        .describe(
          'Optional keyword to filter by name, description, or tag (e.g. "weather", "btc")'
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional list of tags to filter by (matches any)'),
      maxPrice: z
        .string()
        .optional()
        .describe(
          'Optional maximum price per request as a decimal string, e.g. "0.05"'
        )
    },
    async ({ query, tags, maxPrice }) => {
      try {
        const client = new RegistryClient(
          config.network,
          config.registryAddress
        )
        const services = await client.search({ name: query, tags, maxPrice })

        if (services.length === 0) {
          const where = query ? ` matching "${query}"` : ''
          return {
            content: [
              {
                type: 'text' as const,
                text: `No ChainPe services found${where} on ${config.network} (registry ${client.getAddress()}).`
              }
            ]
          }
        }

        // Read each provider's on-chain ERC-8004 reputation (best-effort).
        const reputations = await Promise.all(
          services.map(s =>
            s.agentId ? getReputation(config, s.agentId) : Promise.resolve(null)
          )
        )

        // Rank by reputation: scored first, higher score, then more reviews,
        // then cheaper. Keeps the most trustworthy providers at the top.
        const ranked = services
          .map((s, i) => {
            const r = reputations[i]
            const score = r && r.count > 0 && r.score !== null ? r.score : null
            return { service: s, rep: r, score, count: r?.count ?? 0 }
          })
          .sort((a, b) => {
            const aHas = a.score != null
            const bHas = b.score != null
            if (aHas !== bHas) return aHas ? -1 : 1
            if (aHas && bHas && a.score !== b.score) return b.score! - a.score!
            if (a.count !== b.count) return b.count - a.count
            return (
              parseFloat(a.service.pricePerRequest) -
              parseFloat(b.service.pricePerRequest)
            )
          })

        const serviceList = ranked
          .map(({ service: s, rep }, i) => {
            let repLine = ''
            if (s.agentId) {
              if (rep && rep.count > 0 && rep.score !== null) {
                repLine = `  ·  ⭐ ${rep.score.toFixed(0)}/100 (${rep.count} review${rep.count === 1 ? '' : 's'})`
              } else {
                repLine = '  ·  ⭐ no ratings yet'
              }
            }
            return (
              `${i + 1}. ${s.name} — ${s.description}\n` +
              `   Price: ${s.pricePerRequest} ${s.paymentToken}` +
              (s.tags.length ? `  ·  Tags: ${s.tags.join(', ')}` : '') +
              (s.agentId ? `  ·  Agent ID: ${s.agentId}` : '') +
              repLine +
              `\n   Endpoint: ${s.endpoint}`
            )
          })
          .join('\n\n')

        const header = query
          ? `Found ${services.length} ChainPe service(s) matching "${query}":`
          : `Found ${services.length} ChainPe service(s):`

        const summary =
          `\n\n📋 Network: ${config.network}  ·  Registry: ${client.getAddress()}\n` +
          `Hint: call x402_fetch with a service's Endpoint to pay and fetch its result.`

        return {
          content: [
            {
              type: 'text' as const,
              text: `${header}\n\n${serviceList}${summary}`
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `ChainPe registry search failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            }
          ],
          isError: true
        }
      }
    }
  )
}
