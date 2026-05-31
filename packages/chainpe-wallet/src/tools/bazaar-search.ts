/**
 * search_bazaar tool — discover x402-gated services from the on-chain
 * ChainPe registry (ChainPeRegistry contract on Algorand).
 *
 * Lets the agent see which paid APIs are available, with their price and the
 * endpoint to hand to `x402_fetch` for automatic payment.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import { RegistryClient, type ChainPeNetwork } from '@/chainpe-registry.js'

/** Maps the wallet's payment network to a ChainPe registry network. */
function toChainPeNetwork(network: PaymentNetwork): ChainPeNetwork {
  // The registry is Algorand-only. Mainnet only when explicitly on `algorand`.
  return network === 'algorand' ? 'mainnet' : 'testnet'
}

export function registerBazaarSearch(server: McpServer, config: AppConfig): void {
  server.tool(
    'search_bazaar',
    'Discover x402-gated services registered on the ChainPe on-chain registry ' +
      '(Algorand). Returns each service with its description, price, tags, and the ' +
      'endpoint URL. To use a service, pass its endpoint to the `x402_fetch` tool, ' +
      'which handles the USDC/ALGO payment automatically.',
    {
      query: z
        .string()
        .optional()
        .describe(
          'Optional keyword to filter by name, description, or tag (e.g. "weather", "btc", "chat")'
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional list of tags to filter by (matches any)'),
      maxPrice: z
        .string()
        .optional()
        .describe('Optional maximum price per request as a decimal string, e.g. "0.05"')
    },
    async ({ query, tags, maxPrice }) => {
      const net = toChainPeNetwork(config.network)

      try {
        const client = new RegistryClient(net)
        const services = await client.search({ name: query, tags, maxPrice })

        if (services.length === 0) {
          const where = query ? ` matching "${query}"` : ''
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `No ChainPe services found${where} on ${net} ` +
                  `(registry app ${client.getAppId()}).`
              }
            ]
          }
        }

        const serviceList = services
          .map(
            (s, i) =>
              `${i + 1}. ${s.name} — ${s.description}\n` +
              `   Price: ${s.pricePerRequest} ${s.paymentToken}` +
              (s.tags.length ? `  ·  Tags: ${s.tags.join(', ')}` : '') +
              `\n   Endpoint: ${s.endpoint}`
          )
          .join('\n\n')

        const header = query
          ? `Found ${services.length} ChainPe service(s) matching "${query}":`
          : `Found ${services.length} ChainPe service(s):`

        const summary =
          `\n\n📋 Network: ${net}  ·  Registry App: ${client.getAppId()}\n` +
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
