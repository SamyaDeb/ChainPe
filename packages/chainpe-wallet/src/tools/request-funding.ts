/**
 * request_funding — Generate an EIP-681 payment URI so a human (or another
 * agent) can top up this wallet with USDC or AVAX on Avalanche.
 *
 * EIP-681 (https://eips.ethereum.org/EIPS/eip-681) is understood by MetaMask,
 * Core, and most EVM wallets.
 *   AVAX:  ethereum:<wallet>@<chainId>?value=<wei>
 *   USDC:  ethereum:<usdc>@<chainId>/transfer?address=<wallet>&uint256=<atomic>
 */
import { z } from 'zod'
import { parseUnits, parseEther } from 'viem'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import { getWalletAddress, getUsdcAddress, USDC_DECIMALS } from '@/clients.js'

const CHAIN_IDS: Record<PaymentNetwork, number> = {
  fuji: 43113,
  avalanche: 43114
}

export function registerRequestFunding(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'request_funding',
    'Generate an EIP-681 payment link (and plain address) to ask a human or another agent to send ' +
      'USDC or AVAX to this wallet on Avalanche. Use this when the wallet is low on funds.',
    {
      currency: z
        .enum(['USDC', 'AVAX'])
        .default('USDC')
        .describe('Which currency to request — USDC (default) or native AVAX'),
      amount: z.string().describe('Amount to request as decimal, e.g. "5.00"'),
      network: z
        .enum(['fuji', 'avalanche'])
        .default('fuji')
        .describe('Network (default: fuji)')
    },
    async ({ currency, amount, network }) => {
      if (!config.privateKey) {
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

      try {
        const net = network as PaymentNetwork
        const address = getWalletAddress(config)
        const chainId = CHAIN_IDS[net]

        let uri: string
        if (currency === 'USDC') {
          const atomic = parseUnits(amount, USDC_DECIMALS)
          uri = `ethereum:${getUsdcAddress(net)}@${chainId}/transfer?address=${address}&uint256=${atomic}`
        } else {
          const wei = parseEther(amount)
          uri = `ethereum:${address}@${chainId}?value=${wei}`
        }

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
                  chainId,
                  paymentUri: uri,
                  instructions: [
                    '📱 Tap the paymentUri in a mobile EVM wallet (MetaMask / Core) to prefill the transfer',
                    '📋 Or copy walletAddress and send manually on Avalanche'
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
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
