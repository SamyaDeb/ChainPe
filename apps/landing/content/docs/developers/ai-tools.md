---
title: AI tools
description: Let a Vercel AI SDK or LangChain agent find and pay for APIs, with spending limits.
---

`@chainpearc/ai-tools` gives an LLM agent two tools, built on the [SDK](/docs/developers/sdk). The model decides what to call, and the SDK handles the 402, the limit and the signature.

```bash
npm install @chainpearc/ai-tools @chainpearc/sdk
# plus your framework: `ai` (Vercel AI SDK) or `@langchain/core`
```

## Before you give an agent money

An LLM decides what to pay for, and a page it reads can try to influence it. Set limits that hold even if it misbehaves:

- **Use a dedicated wallet, with only what it may spend.** That's your real limit.
- **Set `maxPerCall`.** It's refused before signing. The default is 1 USDC, so lower it.
- **Treat listings and responses as untrusted.** Tool results go to the model, and could contain instructions.
- **Leave `autoFeedback` off for cheap calls.** A rating's gas can cost more than the call.

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpearc/ai-tools/vercel'

const tools = createChainPeTools({
  privateKey: process.env.AGENT_KEY!,
  maxPerCall: '0.05',
})

const { text, steps } = await generateText({
  model: anthropic('claude-opus-4-8'),
  tools,
  stopWhen: stepCountIs(8), // also limits how many calls it can pay for
  prompt: 'Find a weather API on ChainPe and get the forecast for Mumbai.',
})
```

## LangChain

```ts
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createChainPeLangChainTools } from '@chainpearc/ai-tools/langchain'

const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
  privateKey: process.env.AGENT_KEY!,
  maxPerCall: '0.05',
})

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-opus-4-8' }),
  tools: [discoverServiceTool, chainpeFetchTool],
})
```

A working example of both is in [`examples/agent-surfaces`](https://github.com/SamyaDeb/ChainPe/tree/arc/examples/agent-surfaces).

## The tools

### Fetch: `chainpeFetch` / `chainpe_fetch`

Calls a URL, paying a 402 in USDC.

| Input | Type | Meaning |
|---|---|---|
| `url` | string, required | The URL to call |
| `method` | `GET`, `POST`, `PUT`, `DELETE`, `PATCH` | Default `GET` |
| `headers` | object | Request headers |
| `body` | string | Request body, such as JSON |

It returns this to the model:

```json
{
  "status": 200,
  "ok": true,
  "data": { "success": true },
  "payment": {
    "amount": "0.01",
    "recipient": "0x261f…2e73",
    "network": "arc-testnet",
    "rail": "exact",
    "txHash": "0x…"
  }
}
```

`payment` is missing if nothing was charged, and on Gateway it holds `transferId` instead of `txHash`. `reputation` appears when `autoFeedback` posted a rating.

### Discover: `discoverService` / `discover_service`

Searches Circle's Discovery API and ChainPe's on-chain listings, best-rated first.

| Input | Type | Meaning |
|---|---|---|
| `query` | string | Free-text search |
| `tags` | string list | Filter by tags |
| `maxPrice` | string | Highest price in USDC, such as `"0.05"` |

Each result has `name`, `description`, `endpoint`, `pricePerRequest`, `tags`, `walletAddress`, `agentId`, `reputationScore` and `reputationCount`.

## Options

Both functions take the same options as [`new ChainPe(...)`](/docs/developers/sdk#options), or a client you built yourself. Sharing a client gives you one place for your settings, and lets you check the balance from your own code:

```ts
import { ChainPe } from '@chainpearc/sdk'

const client = new ChainPe({ privateKey, maxPerCall: '0.05' })
const tools = createChainPeTools({ client })

console.log(await client.balance())
```

## Other frameworks

The core is exported from the package root, with Zod schemas you can hand to any tool-calling runtime:

```ts
import {
  fetchInputSchema,
  discoverInputSchema,
  FETCH_TOOL_DESCRIPTION,
  runFetch,
  runDiscover,
  getClient,
} from '@chainpearc/ai-tools'

const client = getClient({ privateKey, maxPerCall: '0.05' })
const result = await runFetch(client, fetchInputSchema.parse(args))
```

## Errors

A failed tool call throws the [SDK's errors](/docs/developers/sdk#handling-errors). Most frameworks return them to the model as a tool error, which lets it pick another service or stop. A price over `maxPerCall` throws before anything is signed.
