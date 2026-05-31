import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import { createHttpClient, getCaip2Network } from '@/clients.js'
import type { PaymentNetwork } from '@/types.js'

// USDC ASA IDs on Algorand
const USDC_ASA: Record<PaymentNetwork, string> = {
  algorand: '31566704', // mainnet
  'algorand-testnet': '10458941' // testnet
}

export function registerPay(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'pay',
    'Sign and create an x402 payment header (USDC transfer authorization) on Algorand. Returns the payment header value to attach to your HTTP request.',
    {
      amount: z.string().describe('USDC amount as decimal string, e.g. "0.05"'),
      recipient: z
        .string()
        .describe('Recipient Algorand address (58 chars)'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Algorand payment network'),
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
              text: 'No wallet configured. Set ALGORAND_MNEMONIC to sign payments.'
            }
          ],
          isError: true
        }
      }

      const net = network as PaymentNetwork

      try {
        spending.check(amount)

        const httpClient = await createHttpClient(net, config)
        const caip2 = getCaip2Network(net) as `${string}:${string}`

        // Build a PaymentRequired response as the server would send it
        const paymentRequired = {
          x402Version: 2,
          error: '',
          resource: {
            url: resource ?? '',
            description: '',
            mimeType: ''
          },
          accepts: [
            {
              scheme: 'exact',
              network: caip2,
              asset: USDC_ASA[net],
              amount: toAtomicUnits(amount),
              payTo: recipient,
              maxTimeoutSeconds: 300,
              // No extra fields needed for the Algorand AVM exact scheme
              extra: {}
            }
          ]
        }

        const payload = await httpClient.createPaymentPayload(paymentRequired)
        const signatureHeaders =
          httpClient.encodePaymentSignatureHeader(payload)

        if (!signatureHeaders || Object.keys(signatureHeaders).length === 0) {
          throw new Error('Failed to generate payment header')
        }

        spending.record(amount, recipient, network)

        // v1 returns X-PAYMENT, v2 returns PAYMENT-SIGNATURE
        const [[headerName, headerValue]] = Object.entries(signatureHeaders)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  paymentHeader: headerValue,
                  headerName,
                  amount: `${amount} USDC`,
                  recipient,
                  network,
                  resource: resource ?? null,
                  hint: `Set this as the ${headerName} header in your HTTP request.`
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
  const decimals = 6
  const parts = amount.split('.')
  const whole = parts[0] || '0'
  const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals)
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString()
}
