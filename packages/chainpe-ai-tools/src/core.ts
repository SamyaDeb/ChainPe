/**
 * Framework-agnostic core for the ChainPe agent tools.
 *
 * Both the Vercel AI SDK adapter (`./vercel`) and the LangChain adapter
 * (`./langchain`) are thin wrappers over the `runFetch` / `runDiscover`
 * functions here, which in turn wrap `@chainpe/sdk`. The input schemas and
 * serializable return shapes live here so the two adapters stay identical.
 */
import { z } from 'zod'
import { ChainPe, type ChainPeOptions } from '@chainpe/sdk'

/** Either SDK constructor options, or a pre-built {@link ChainPe} instance. */
export type ChainPeToolOptions = ChainPeOptions | { client: ChainPe }

export function getClient(options: ChainPeToolOptions): ChainPe {
  if ('client' in options) return options.client
  return new ChainPe(options)
}

// ─── Input schemas (shared by both frameworks) ───────────────────────────────

export const fetchInputSchema = z.object({
  url: z
    .string()
    .url()
    .describe(
      'The URL to call. If it responds 402 Payment Required, the USDC payment is signed and sent automatically.'
    ),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    .optional()
    .describe('HTTP method (default GET).'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Optional request headers.'),
  body: z
    .string()
    .optional()
    .describe('Optional request body, as a string (e.g. a JSON payload).')
})

export const discoverInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Free-text search over service name, description, and tags.'),
  tags: z.array(z.string()).optional().describe('Filter by tags.'),
  maxPrice: z
    .string()
    .optional()
    .describe('Maximum price per request, in USDC (e.g. "0.05").')
})

export type FetchInput = z.infer<typeof fetchInputSchema>
export type DiscoverInput = z.infer<typeof discoverInputSchema>

// ─── Serializable results ────────────────────────────────────────────────────

export interface FetchResult {
  status: number
  ok: boolean
  /** Parsed response body (object for JSON, string otherwise). */
  data: unknown
  /** Present when a USDC payment was made + settled. */
  payment?: {
    amount: string
    recipient: string
    network: string
    txHash?: string
  }
  /** Present when ERC-8004 feedback was posted (autoFeedback). */
  reputation?: { agentId: string; score: number; txHash: string }
}

export interface DiscoverResultItem {
  name: string
  description: string
  endpoint: string
  pricePerRequest: string
  tags: string[]
  walletAddress: string
  agentId?: string
  /** Aggregate ERC-8004 score (0–100) or null when unrated. */
  reputationScore: number | null
  /** Number of distinct clients that left feedback. */
  reputationCount: number
}

// ─── Tool descriptions (shared) ──────────────────────────────────────────────

export const FETCH_TOOL_DESCRIPTION =
  'Fetch a URL, automatically paying any x402 "402 Payment Required" response in ' +
  'USDC on Avalanche (EIP-3009). Use this to call paid HTTP APIs or hire paid AI ' +
  'agents. Returns the response body plus payment + reputation details.'

export const DISCOVER_TOOL_DESCRIPTION =
  'Discover services and AI agents registered on the ChainPe on-chain marketplace, ' +
  'ranked by ERC-8004 reputation (best first). Returns each service\'s endpoint, ' +
  'price, and reputation so you can pick one before paying.'

// ─── Execution (shared) ──────────────────────────────────────────────────────

export async function runFetch(
  client: ChainPe,
  input: FetchInput
): Promise<FetchResult> {
  const res = await client.pay(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body
  })
  return {
    status: res.status,
    ok: res.ok,
    data: res.data,
    payment: res.payment
      ? {
          amount: res.payment.amount,
          recipient: res.payment.recipient,
          network: res.payment.network,
          txHash: res.payment.txHash
        }
      : undefined,
    reputation: res.reputation
  }
}

export async function runDiscover(
  client: ChainPe,
  input: DiscoverInput
): Promise<DiscoverResultItem[]> {
  const services = await client.discover({
    query: input.query,
    tags: input.tags,
    maxPrice: input.maxPrice
  })
  return services.map(s => ({
    name: s.name,
    description: s.description,
    endpoint: s.endpoint,
    pricePerRequest: s.pricePerRequest,
    tags: s.tags,
    walletAddress: s.walletAddress,
    agentId: s.agentId,
    reputationScore: s.reputation?.score ?? null,
    reputationCount: s.reputation?.count ?? 0
  }))
}
