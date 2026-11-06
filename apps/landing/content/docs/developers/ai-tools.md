---
title: AI tools
description: Let a Vercel AI SDK or LangChain agent find and pay for APIs.
---

`@chainpearc/ai-tools` gives an agent two tools, built on the [SDK](/docs/developers/sdk). It isn't on npm yet. From the repo root, run `npm run build:sdk && npm run build:ai-tools`.

| Vercel AI SDK | LangChain | What it does |
|---|---|---|
| `chainpeFetch` | `chainpe_fetch` | Calls a URL. If it returns 402, pays in USDC and returns the result |
| `discoverService` | `discover_service` | Searches Circle's Discovery API and ChainPe's on-chain listings, ranked by rating |

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpearc/ai-tools/vercel'

const tools = createChainPeTools({
  privateKey: process.env.PRIVATE_KEY!,
  autoFeedback: true // rate the provider after each paid call
})

const { text } = await generateText({
  model: anthropic('claude-opus-4-8'),
  tools,
  stopWhen: stepCountIs(8),
  prompt: 'Find a weather API on ChainPe and get the forecast for Mumbai.'
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

Both functions take the same options as `new ChainPe(...)`, or a client you built yourself:

```ts
import { ChainPe } from '@chainpearc/sdk'

const client = new ChainPe({ privateKey })
const tools = createChainPeTools({ client })
```

Arc testnet is the default network. ChainPe has not been tested with real USDC on Arc mainnet.

## Other frameworks

The core is exported from the package root, so you can use it from any tool-calling runtime:

```ts
import { fetchInputSchema, runFetch, getClient } from '@chainpearc/ai-tools'

const client = getClient({ privateKey })
const result = await runFetch(client, { url: 'https://api.example.com/paid' })
```

A working example of both frameworks is in [`examples/agent-surfaces`](https://github.com/SamyaDeb/ChainPe/tree/arc/examples/agent-surfaces).
