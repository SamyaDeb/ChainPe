import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import { createHttpClient, isAlgorandNetwork } from '@/clients.js'

interface PaymentAccept {
  scheme: string
  network: `${string}:${string}`
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra: Record<string, unknown>
}

interface PaymentRequiredBody {
  x402Version: number
  error: string
  resource: { url: string; description: string; mimeType: string }
  accepts: PaymentAccept[]
}

function isLikelyTextContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const normalized = contentType.toLowerCase()
  return (
    normalized.startsWith('text/') ||
    normalized.includes('application/json') ||
    normalized.includes('application/xml') ||
    normalized.includes('application/javascript') ||
    normalized.includes('application/x-www-form-urlencoded')
  )
}

async function formatResponseBody(response: Response): Promise<{
  body: string
  bodyEncoding: 'text' | 'base64'
  contentType: string | null
  contentLength: string | null
}> {
  const contentType = response.headers.get('content-type')
  const contentLength = response.headers.get('content-length')

  if (isLikelyTextContentType(contentType)) {
    return {
      body: await response.text(),
      bodyEncoding: 'text',
      contentType,
      contentLength
    }
  }

  const arrayBuffer = await response.arrayBuffer()
  return {
    body: Buffer.from(arrayBuffer).toString('base64'),
    bodyEncoding: 'base64',
    contentType,
    contentLength
  }
}

const CAIP2_TO_NETWORK: Record<string, PaymentNetwork> = {
  'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=': 'algorand',
  'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=': 'algorand-testnet'
}

function caip2ToNetwork(caip2: string): PaymentNetwork | undefined {
  return CAIP2_TO_NETWORK[caip2]
}

function atomicToUsdc(atomicAmount: string): string {
  // USDC on Algorand has 6 decimals
  const decimals = 6
  const raw = BigInt(atomicAmount)
  const whole = raw / BigInt(10 ** decimals)
  const frac = raw % BigInt(10 ** decimals)
  return `${whole}.${frac.toString().padStart(decimals, '0')}`
}

export function registerX402Fetch(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'x402_fetch',
    'Fetch a URL with automatic x402 payment. Makes the HTTP request, and if the server responds with 402 Payment Required, automatically signs the USDC payment and retries with the X-PAYMENT header. Returns the final response.',
    {
      url: z.string().url().describe('The URL to fetch'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .default('GET')
        .describe('HTTP method (default: GET)'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Optional HTTP headers as key-value pairs'),
      body: z.string().optional().describe('Optional request body')
    },
    async ({ url, method, headers, body }) => {
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set STELLAR_SECRET, EVM_PRIVATE_KEY, or ALGORAND_MNEMONIC environment variable.'
            }
          ],
          isError: true
        }
      }

      try {
        // Step 1: Make the initial request
        const fetchOptions: RequestInit = {
          method,
          headers: headers ?? {}
        }
        if (body && method !== 'GET') {
          fetchOptions.body = body
        }

        const initialResponse = await fetch(url, fetchOptions)

        // If not 402, return the response directly
        if (initialResponse.status !== 402) {
          const responsePayload = await formatResponseBody(initialResponse)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    status: initialResponse.status,
                    statusText: initialResponse.statusText,
                    body: responsePayload.body,
                    bodyEncoding: responsePayload.bodyEncoding,
                    contentType: responsePayload.contentType,
                    contentLength: responsePayload.contentLength
                  },
                  null,
                  2
                )
              }
            ]
          }
        }

        // Step 2: Parse the 402 Payment Required response
        // x402 v2 sends payment info in the Payment-Required header (base64-encoded JSON)
        // Fall back to the response body for backwards compatibility
        let paymentRequired: PaymentRequiredBody

        const paymentRequiredHeader =
          initialResponse.headers.get('Payment-Required')

        if (paymentRequiredHeader) {
          const decoded = Buffer.from(paymentRequiredHeader, 'base64').toString(
            'utf-8'
          )
          paymentRequired = JSON.parse(decoded)
        } else {
          paymentRequired = await initialResponse.json()
        }

        if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Server returned 402 but no payment options were provided.'
              }
            ],
            isError: true
          }
        }

        // Step 3: Find a payment option we can fulfill
        const accept = paymentRequired.accepts.find(a => {
          const net = caip2ToNetwork(a.network)
          if (!net) return false
          return isAlgorandNetwork(net) && config.canPayAlgorand
        })

        if (!accept) {
          const networks = paymentRequired.accepts
            .map(a => a.network)
            .join(', ')
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot fulfill payment. Server accepts networks: [${networks}] but wallet is not configured for any of them.`
              }
            ],
            isError: true
          }
        }

        const network = caip2ToNetwork(accept.network)!
        const usdcAmount = atomicToUsdc(accept.amount)

        // Step 4: Check spending limits
        spending.check(usdcAmount)

        // Step 5: Sign the payment
        const httpClient = await createHttpClient(network, config)
        const payload = await httpClient.createPaymentPayload(paymentRequired)
        const signatureHeaders =
          httpClient.encodePaymentSignatureHeader(payload)

        if (!signatureHeaders || Object.keys(signatureHeaders).length === 0) {
          throw new Error('Failed to generate payment header')
        }

        // Step 6: Retry the request with the payment header
        // v1 returns X-PAYMENT, v2 returns PAYMENT-SIGNATURE
        const retryOptions: RequestInit = {
          method,
          headers: {
            ...(headers ?? {}),
            ...signatureHeaders
          }
        }
        if (body && method !== 'GET') {
          retryOptions.body = body
        }

        const paidResponse = await fetch(url, retryOptions)
        const responsePayload = await formatResponseBody(paidResponse)

        // If the retry ALSO returns 402, the server accepted the signature but
        // settlement (broadcast) failed — almost always an unfunded wallet.
        if (paidResponse.status === 402) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  'Payment signed and sent, but the server could not settle the transaction.',
                  'This almost always means the paying wallet needs:',
                  `  1. Testnet USDC (ASA ID 10458941) — at least ${usdcAmount} USDC`,
                  '  2. Opted-in to the USDC asset (Pera Wallet → Add asset → 10458941)',
                  '  3. A small amount of ALGO for the network fee (~0.001 ALGO)',
                  '',
                  'Get testnet funds:',
                  '  • ALGO:  https://bank.testnet.algorand.network/',
                  '  • USDC:  https://faucet.circle.com  (choose Algorand Testnet)',
                  '',
                  `Attempted payment: ${usdcAmount} USDC → ${accept.payTo} on ${network}`
                ].join('\n')
              }
            ],
            isError: true
          }
        }

        // Step 7: Record the spending only on success
        spending.record(usdcAmount, accept.payTo, network)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  status: paidResponse.status,
                  statusText: paidResponse.statusText,
                  body: responsePayload.body,
                  bodyEncoding: responsePayload.bodyEncoding,
                  contentType: responsePayload.contentType,
                  contentLength: responsePayload.contentLength,
                  payment: {
                    amount: `${usdcAmount} USDC`,
                    recipient: accept.payTo,
                    network
                  },
                  hint:
                    responsePayload.bodyEncoding === 'base64'
                      ? 'Binary response returned as base64. Decode and save it using the reported contentType.'
                      : undefined
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
              text: `x402 fetch failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
