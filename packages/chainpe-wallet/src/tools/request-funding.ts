/**
 * request_funding — Generate an Algorand payment deep-link / QR URI
 * so a human (or another agent) can top up this wallet with USDC or ALGO.
 *
 * Works with Pera Wallet and any standard Algorand URI handler.
 * Format: algorand://<address>?amount=<microAmount>&asset=<assetId>&note=<note>
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { getWalletAddress } from '@/clients.js'

const USDC_ASA: Record<string, number> = {
  algorand: 31566704,
  'algorand-testnet': 10458941
}

export function registerRequestFunding(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'request_funding',
    'Generate an Algorand payment URI (deep-link) to ask a human or another agent to ' +
      'send USDC or ALGO to this wallet. Returns a clickable algorand:// link that ' +
      'opens directly in Pera Wallet on mobile. Use this when the wallet is low on funds.',
    {
      currency: z
        .enum(['USDC', 'ALGO'])
        .default('USDC')
        .describe('Which currency to request — USDC (default) or native ALGO'),
      amount: z
        .string()
        .describe('Amount to request as decimal, e.g. "5.00" for $5 USDC or "2.5" for 2.5 ALGO'),
      note: z
        .string()
        .optional()
        .describe('Optional message to include, e.g. "Agent needs gas for Weather API task"'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Network (default: algorand-testnet)')
    },
    async ({ currency, amount, note, network }) => {
      if (!config.algorandMnemonic) {
        return {
          content: [{ type: 'text' as const, text: 'No Algorand wallet configured. Set ALGORAND_MNEMONIC.' }],
          isError: true
        }
      }

      try {
        const address = await getWalletAddress(network, config)

        // Convert decimal amount → micro units (6 decimals for both USDC and ALGO)
        const parts = amount.split('.')
        const whole = parts[0] || '0'
        const frac = (parts[1] || '').padEnd(6, '0').slice(0, 6)
        const microAmount = BigInt(whole) * 1_000_000n + BigInt(frac)

        // Build the Algorand URI (ARC-26 standard)
        // https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0026.md
        const params = new URLSearchParams()
        params.set('amount', microAmount.toString())

        if (currency === 'USDC') {
          const assetId = USDC_ASA[network]
          params.set('asset', String(assetId))
        }
        // ALGO doesn't need an asset param — it's the native currency

        if (note) {
          params.set('note', note)
          params.set('xnote', '1') // mark note as readonly in wallets that support it
        }

        const uri = `algorand://${address}?${params.toString()}`

        // Also build a Pera Web Wallet link for desktop users
        const peraLink = `https://app.perawallet.app/#${encodeURIComponent(uri)}`

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  message: `Please send ${amount} ${currency} to fund this agent wallet.`,
                  walletAddress: address,
                  currency,
                  amount: `${amount} ${currency}`,
                  network,
                  deepLink: uri,
                  peraWebLink: peraLink,
                  instructions: [
                    '📱 Mobile: Tap the deepLink on your phone to open directly in Pera Wallet',
                    '💻 Desktop: Open the peraWebLink in your browser',
                    '📋 Manual: Copy the walletAddress and send manually'
                  ]
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true
        }
      }
    }
  )
}
