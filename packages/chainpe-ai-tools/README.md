# @chainpearc/ai-tools

[![npm](https://img.shields.io/npm/v/@chainpearc/ai-tools.svg)](https://www.npmjs.com/package/@chainpearc/ai-tools)

> **Use Arc testnet for now.** It is the default. ChainPe has not been tested with real USDC on Arc mainnet.

**Drop-in ChainPe tools for AI agents** — let any Vercel AI SDK or LangChain agent
**discover, pay for, and rate** HTTP APIs and other agents per request in USDC on
Arc. Thin adapters over [`@chainpearc/sdk`](../chainpe-sdk).

Two tools per framework:

- **`chainpeFetch` / `chainpe_fetch`** — call a URL; if it returns `402 Payment
  Required`, pay it automatically in USDC and return the result.
- **`discoverService` / `discover_service`** — search Circle's Discovery API and
  ChainPe's on-chain listings, ranked by ERC-8004 reputation.

```bash
npm install @chainpearc/ai-tools @chainpearc/sdk
# plus your framework: `ai` (Vercel AI SDK) or `@langchain/core`
```

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpearc/ai-tools/vercel'

const tools = createChainPeTools({
  privateKey: process.env.PRIVATE_KEY!,
  autoFeedback: true // leave on-chain reputation after each paid call
})

const { text } = await generateText({
  model: anthropic('claude-opus-4-8'),
  tools,
  stopWhen: stepCountIs(8),
  prompt: 'Find a summarizer agent on ChainPe and summarize today\'s top AI news.'
})
```

## LangChain

```ts
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createChainPeLangChainTools } from '@chainpearc/ai-tools/langchain'

const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
  privateKey: process.env.PRIVATE_KEY!,
  autoFeedback: true
})

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-opus-4-8' }),
  tools: [discoverServiceTool, chainpeFetchTool]
})
```

## Options

`createChainPeTools(options)` / `createChainPeLangChainTools(options)` take the same
options as [`new ChainPe(...)`](../chainpe-sdk#api) — `privateKey`, `network`,
`rails?`, `accountsAddress?`, `reputationRegistry?`, `maxPerCall?`, `autoFeedback?` — or a
pre-built client via `{ client }`:

```ts
import { ChainPe } from '@chainpearc/sdk'
const client = new ChainPe({ privateKey })
const tools = createChainPeTools({ client })
```

## Custom frameworks

The framework-agnostic core is exported from the package root, so you can wire the
same logic into any tool-calling runtime:

```ts
import { fetchInputSchema, runFetch, getClient } from '@chainpearc/ai-tools'

const client = getClient({ privateKey })
const result = await runFetch(client, { url: 'https://api.example.com/paid' })
```

## License

MIT
