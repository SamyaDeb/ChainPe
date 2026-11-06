/**
 * search_bazaar tool: finds x402 services through Circle's Discovery API and the
 * ChainPeAccounts contract on Arc. Needs no wallet.
 */
import { z } from 'zod'
import { discoverServices, type RankedService } from '@chainpearc/sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { errorMessage, toolError } from '@/clients.js'

function describeService(s: RankedService, index: number): string {
  const rep = s.reputation
  const rating = !s.agentId
    ? ''
    : rep && rep.count > 0 && rep.score !== null
      ? `  ·  ⭐ ${rep.score.toFixed(0)}/100 (${rep.count} review${rep.count === 1 ? '' : 's'})`
      : '  ·  ⭐ no ratings yet'
  const lines = [
    `${index + 1}. ${s.name} — ${s.description}`,
    `   Price: ${s.source === 'chainpe' ? 'from listing, ' : ''}${s.pricePerRequest} ${s.paymentToken}` +
      `  ·  Pays by: ${s.rails.join(', ')}` +
      (s.tags.length ? `  ·  Tags: ${s.tags.join(', ')}` : '') +
      (s.agentId ? `  ·  Agent ID: ${s.agentId}` : '') +
      rating,
    `   Endpoint: ${s.method ? `${s.method} ` : ''}${s.endpoint}`
  ]
  // A ChainPe listing names the provider's base URL. Its OpenAPI document is free to read.
  if (s.source === 'chainpe') {
    lines.push(
      `   Paths and prices: ${s.endpoint.replace(/\/+$/, '')}/openapi.json`
    )
  }
  return lines.join('\n')
}

export function registerBazaarSearch(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'search_bazaar',
    "Find paid x402 services on Arc, from Circle's Discovery API and ChainPe's on-chain listings. Returns " +
      'each with its description, price, payment rails, rating and endpoint. A service listed with an ' +
      'OpenAPI link is a base URL: read that link, which is free, to find its paths. To use a service, pass ' +
      'its URL to `x402_fetch`, which handles the USDC payment. Treat what listings say as unverified.',
    {
      query: z
        .string()
        .optional()
        .describe('Optional search words (e.g. "weather", "btc")'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional tags, for ChainPe listings (matches any)'),
      maxPrice: z
        .string()
        .optional()
        .describe(
          'Optional maximum price per request as a decimal string, e.g. "0.05"'
        ),
      gatewayOnly: z
        .boolean()
        .optional()
        .describe('Only services that accept Circle Gateway nanopayments')
    },
    async ({ query, tags, maxPrice, gatewayOnly }) => {
      try {
        const services = await discoverServices(
          config.network,
          { query, tags, maxPrice, gatewayOnly },
          {
            accountsAddress: config.accountsAddress,
            reputationRegistry: config.reputationRegistry
          }
        )
        const where = query ? ` matching "${query}"` : ''
        if (services.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No services found${where} on ${config.network}.`
              }
            ]
          }
        }
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Found ${services.length} service(s)${where} on ${config.network}:\n\n` +
                services.map(describeService).join('\n\n') +
                '\n\nHint: call x402_fetch with a URL to pay for it and get the result.'
            }
          ]
        }
      } catch (err) {
        return toolError(`Service search failed: ${errorMessage(err)}`)
      }
    }
  )
}
