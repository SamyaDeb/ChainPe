/**
 * ChainPe tools for **LangChain** (`@langchain/core`).
 *
 * @example
 * ```ts
 * import { ChatAnthropic } from '@langchain/anthropic'
 * import { createReactAgent } from '@langchain/langgraph/prebuilt'
 * import { createChainPeLangChainTools } from '@chainpe/ai-tools/langchain'
 *
 * const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
 *   privateKey, network: 'fuji', autoFeedback: true
 * })
 *
 * const agent = createReactAgent({
 *   llm: new ChatAnthropic({ model: 'claude-opus-4-8' }),
 *   tools: [discoverServiceTool, chainpeFetchTool]
 * })
 * ```
 */
import { tool } from '@langchain/core/tools'
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
 * Builds the ChainPe LangChain `StructuredTool`s:
 * `{ chainpeFetchTool, discoverServiceTool }`. Tool results are returned as
 * JSON strings (LangChain tool outputs are strings).
 */
export function createChainPeLangChainTools(options: ChainPeToolOptions) {
  const client = getClient(options)

  const chainpeFetchTool = tool(
    async input => JSON.stringify(await runFetch(client, input)),
    {
      name: 'chainpe_fetch',
      description: FETCH_TOOL_DESCRIPTION,
      schema: fetchInputSchema
    }
  )

  const discoverServiceTool = tool(
    async input => JSON.stringify(await runDiscover(client, input)),
    {
      name: 'discover_service',
      description: DISCOVER_TOOL_DESCRIPTION,
      schema: discoverInputSchema
    }
  )

  return { chainpeFetchTool, discoverServiceTool }
}

export type ChainPeLangChainTools = ReturnType<
  typeof createChainPeLangChainTools
>
export type { ChainPeToolOptions } from './core.js'
