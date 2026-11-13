/**
 * @chainpe/ai-tools — ChainPe x402 pay + discover tools for AI agents.
 *
 * Framework adapters live behind subpath exports so you only pull in the
 * framework you use:
 *
 *   import { createChainPeTools } from '@chainpe/ai-tools/vercel'
 *   import { createChainPeLangChainTools } from '@chainpe/ai-tools/langchain'
 *
 * This entry exposes the shared, framework-agnostic core (schemas + the
 * `runFetch` / `runDiscover` executors) for custom integrations.
 */
export {
  getClient,
  fetchInputSchema,
  discoverInputSchema,
  runFetch,
  runDiscover,
  FETCH_TOOL_DESCRIPTION,
  DISCOVER_TOOL_DESCRIPTION
} from './core.js'

export type {
  ChainPeToolOptions,
  FetchInput,
  DiscoverInput,
  FetchResult,
  DiscoverResultItem
} from './core.js'
