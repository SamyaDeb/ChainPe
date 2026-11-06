import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PaymentRail } from '@chainpearc/sdk'
import type { AppConfig } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import {
  clientFor,
  errorMessage,
  NO_WALLET_MESSAGE,
  toolError,
  toolJson
} from '@/clients.js'

function isLikelyTextContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const n = contentType.toLowerCase()
  return (
    n.startsWith('text/') ||
    n.includes('application/json') ||
    n.includes('application/xml') ||
    n.includes('application/javascript') ||
    n.includes('application/x-www-form-urlencoded')
  )
}

async function formatResponseBody(response: Response) {
  const contentType = response.headers.get('content-type')
  const contentLength = response.headers.get('content-length')
  if (isLikelyTextContentType(contentType)) {
    return {
      body: await response.text(),
      bodyEncoding: 'text' as const,
      contentType,
      contentLength
    }
  }
  const arrayBuffer = await response.arrayBuffer()
  return {
    body: Buffer.from(arrayBuffer).toString('base64'),
    bodyEncoding: 'base64' as const,
    contentType,
    contentLength
  }
}

export interface PaidCall {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  rail?: PaymentRail
}

/** Calls a URL, paying a 402 within the budget. The price is checked before anything is signed. */
export async function paidCall(
  config: AppConfig,
  spending: SpendingTracker,
  call: PaidCall
) {
  if (!config.canPay) return toolError(NO_WALLET_MESSAGE)
  try {
    const client = clientFor(config, {
      maxPerCall: spending.paymentCap(),
      rails: call.rail ? [call.rail] : undefined
    })
    const init: RequestInit = {
      method: call.method,
      headers: call.headers ?? {}
    }
    if (call.body && call.method !== 'GET') init.body = call.body

    const { response, payment, agentId } = await client.request(call.url, init)
    if (payment) {
      spending.record(payment.amount, payment.recipient, payment.network)
    }
    return toolJson({
      status: response.status,
      statusText: response.statusText,
      ...(await formatResponseBody(response)),
      payment: payment && {
        amount: `${payment.amount} USDC`,
        recipient: payment.recipient,
        network: payment.network,
        rail: payment.rail,
        txHash: payment.txHash,
        transferId: payment.transferId
      },
      ...(payment && agentId && agentId !== '0'
        ? {
            rateWith: {
              tool: 'give_feedback',
              agentId,
              note: 'Rate this provider only if the user asks, or if the result was clearly good or bad. A rating costs a little gas in USDC.'
            }
          }
        : {})
    })
  } catch (err) {
    return toolError(
      `x402 fetch failed: ${errorMessage(err)}\n` +
        `This wallet pays on ${config.network}. Check check_balance, and use request_funding if it is low.`
    )
  }
}

export const callSchema = {
  url: z.string().url().describe('The URL to fetch'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    .default('GET')
    .describe('HTTP method (default: GET)'),
  headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers'),
  body: z.string().optional().describe('Optional request body')
}

export function registerX402Fetch(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'x402_fetch',
    'Fetch a URL with automatic x402 payment in USDC on Arc. Makes the HTTP request, and if the server ' +
      'responds with 402 Payment Required, pays within the spending limits and retries. Uses a Circle ' +
      'Gateway deposit when it covers the price, and the wallet otherwise. Returns the final response.',
    callSchema,
    async ({ url, method, headers, body }) =>
      paidCall(config, spending, { url, method, headers, body })
  )
}
