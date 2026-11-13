/**
 * ChainPe tools for the **Vercel AI SDK** (`ai`).
 *
 * @example
 * ```ts
 * import { generateText } from 'ai'
 * import { anthropic } from '@ai-sdk/anthropic'
 * import { createChainPeTools } from '@chainpe/ai-tools/vercel'
 *
 * const tools = createChainPeTools({ privateKey, network: 'fuji', autoFeedback: true })
 *
 * const { text } = await generateText({
 *   model: anthropic('claude-opus-4-8'),
 *   tools,
 *   prompt: 'Find a summarizer agent and summarize this article: …'
 * })
 * ```
 */
import { tool } from 'ai'
import {
  getClient,
  fetchInputSchema,
  discoverInputSchema,
  runFetch,
  runDiscover,
  FETCH_TOOL_DESCRIPTION,
  DISCOVER_TOOL_DESCRIPTION,
  type ChainPeToolOptions
} from './core.js'

/**
 * Builds the ChainPe tools as a Vercel AI SDK tool set:
 * `{ chainpeFetch, discoverService }`. Spread into `tools` on `generateText` /
 * `streamText`.
 */
export function createChainPeTools(options: ChainPeToolOptions) {
  const client = getClient(options)
  return {
    chainpeFetch: tool({
      description: FETCH_TOOL_DESCRIPTION,
      inputSchema: fetchInputSchema,
      execute: input => runFetch(client, input)
    }),
    discoverService: tool({
      description: DISCOVER_TOOL_DESCRIPTION,
      inputSchema: discoverInputSchema,
      execute: input => runDiscover(client, input)
    })
  }
}

export type ChainPeTools = ReturnType<typeof createChainPeTools>
export type { ChainPeToolOptions } from './core.js'
