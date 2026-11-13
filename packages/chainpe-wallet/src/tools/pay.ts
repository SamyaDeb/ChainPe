import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createPaymentHeader } from 'x402/client'
import type { PaymentRequirements } from 'x402/types'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import {
  buildSigner,
  getX402Network,
  getUsdcAddress,
  USDC_DECIMALS
} from '@/clients.js'

const X402_VERSION = 1

export function registerPay(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'pay',
    'Sign and create an x402 payment header (USDC EIP-3009 transfer authorization) on Avalanche. ' +
      'Returns the X-PAYMENT header value to attach to your HTTP request.',
    {
      amount: z.string().describe('USDC amount as decimal string, e.g. "0.05"'),
      recipient: z.string().describe('Recipient EVM address (0x…)'),
      network: z
        .enum(['fuji', 'avalanche'])
        .default('fuji')
        .describe('Avalanche payment network'),
      resource: z
        .string()
        .optional()
        .describe('URL of the resource being paid for')
    },
    async ({ amount, recipient, network, resource }) => {
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY to sign payments.'
            }
          ],
          isError: true
        }
      }

      const net = network as PaymentNetwork

      try {
        spending.check(amount)

        const signer = await buildSigner(net, config)

        const paymentRequirements = {
          scheme: 'exact' as const,
          network: getX402Network(net),
          maxAmountRequired: toAtomicUnits(amount),
          resource: (resource ??
            'https://chainpe.x402/pay') as `${string}://${string}`,
          description: '',
          mimeType: '',
          payTo: recipient,
          maxTimeoutSeconds: 300,
          asset: getUsdcAddress(net),
          extra: { name: 'USD Coin', version: '2' }
        }

        const headerValue = await createPaymentHeader(
          signer,
          X402_VERSION,
          paymentRequirements as unknown as PaymentRequirements
        )

        if (!headerValue) {
          throw new Error('Failed to generate payment header')
        }

        spending.record(amount, recipient, network)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  paymentHeader: headerValue,
                  headerName: 'X-PAYMENT',
                  amount: `${amount} USDC`,
                  recipient,
                  network,
                  resource: resource ?? null,
                  hint: 'Set this as the X-PAYMENT header in your HTTP request.'
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
              text: `Payment failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}

function toAtomicUnits(amount: string): string {
  const parts = amount.split('.')
  const whole = parts[0] || '0'
  const frac = (parts[1] || '')
    .padEnd(USDC_DECIMALS, '0')
    .slice(0, USDC_DECIMALS)
  return (BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac)).toString()
}
