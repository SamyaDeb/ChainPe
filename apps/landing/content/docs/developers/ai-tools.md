---
id: ai-tools
title: AI Framework Tools
sidebar_position: 3
---

# AI Framework Tools

`@chainpeavax/ai-tools` wraps the ChainPe SDK as framework-native tool objects for Vercel AI SDK and LangChain. Drop them into your agent's tool set and it can discover and pay for APIs autonomously.

## Installation

```bash
npm install @chainpeavax/ai-tools
```

## Available tools

Both adapters expose two tools:

| Tool | SDK name | Description |
|---|---|---|
| `chainpeFetch` / `chainpe_fetch` | Vercel / LangChain | Fetch a URL, auto-paying any 402 in USDC. Returns parsed response + payment info. |
| `discoverService` / `discover_service` | Vercel / LangChain | Search and rank the ChainPe registry by ERC-8004 reputation. |

## Vercel AI SDK

```ts
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpeavax/ai-tools/vercel'

const tools = createChainPeTools({
  privateKey: process.env.CHAINPE_PRIVATE_KEY!,
  network: 'avalanche',
  maxPerCall: '0.10',
  autoFeedback: true  // post ERC-8004 rating after each paid call
})

const { text } = await generateText({
  model: anthropic('claude-opus-4-8'),
  tools,
  prompt: 'Find a summarizer service and summarize: "Avalanche is a fast blockchain"',
  maxSteps: 5
})

console.log(text)
```

### Tool input schemas

**`chainpeFetch`**:
```ts
{
  url: string        // The URL to fetch (must be an x402-enabled endpoint)
  method?: string    // HTTP method (default: GET)
  body?: string      // Request body (for POST/PUT)
  headers?: Record<string, string>  // Additional headers
}
```

**`discoverService`**:
```ts
{
  query?: string     // Free-text search over name, description, tags
  tag?: string       // Filter by tag
  maxPrice?: string  // Max price per request in USDC (e.g. "0.05")
}
```

### Tool result type

`chainpeFetch` returns:
```ts
{
  status: number
  ok: boolean
  data: unknown      // parsed JSON or text body
  payment?: {
    amount: string
    recipient: string
    txHash?: string
  }
}
```

`discoverService` returns an array of:
```ts
{
  name: string
  description: string
  endpoint: string
  pricePerRequest: string
  tags: string[]
  reputation: { count: number; score: number | null } | null
}
```

### Options

`createChainPeTools(options: ChainPeToolOptions)` accepts all `ChainPeOptions` fields:

```ts
interface ChainPeToolOptions {
  privateKey: string
  network?: 'avalanche' | 'fuji'
  registryAddress?: string
  reputationRegistry?: string
  maxPerCall?: string
  autoFeedback?: boolean
}
```

## LangChain

```ts
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createChainPeLangChainTools } from '@chainpeavax/ai-tools/langchain'

const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
  privateKey: process.env.CHAINPE_PRIVATE_KEY!,
  network: 'avalanche',
  autoFeedback: true
})

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-opus-4-8' }),
  tools: [discoverServiceTool, chainpeFetchTool]
})

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Find the cheapest weather API and get current conditions' }]
})

console.log(result.messages.at(-1)?.content)
```

LangChain tool results are returned as JSON strings (LangChain tools always return strings).

## Framework-agnostic core

For custom integrations, import from the main entry point:

```ts
import {
  getClient,
  runFetch,
  runDiscover,
  fetchInputSchema,
  discoverInputSchema,
  FETCH_TOOL_DESCRIPTION,
  DISCOVER_TOOL_DESCRIPTION
} from '@chainpeavax/ai-tools'

const client = getClient({ privateKey, network: 'avalanche' })

// Execute directly
const result = await runFetch(client, { url: 'https://api.example.com/data' })
const services = await runDiscover(client, { query: 'weather' })

// Build your own framework adapter using the schemas and descriptions
console.log(FETCH_TOOL_DESCRIPTION)
console.log(fetchInputSchema)  // zod schema
```

## Full agent example

Here is a complete Vercel AI SDK agent that discovers and hires two services:

```ts
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpeavax/ai-tools/vercel'

async function runBuyerAgent(task: string) {
  const tools = createChainPeTools({
    privateKey: process.env.CHAINPE_PRIVATE_KEY!,
    network: 'avalanche',
    maxPerCall: '0.05',
    autoFeedback: true
  })

  const { text, steps } = await generateText({
    model: anthropic('claude-opus-4-8'),
    tools,
    prompt: task,
    maxSteps: 10,
    system: `You are an agent with access to the ChainPe API marketplace.
Use discoverService to find APIs, then chainpeFetch to call and pay for them.
Prefer services with higher reputation scores. Always summarize what you found.`
  })

  // Print all tool calls and payments made
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      console.log(`Tool: ${call.toolName}`)
      if (call.toolName === 'chainpeFetch' && call.result?.payment) {
        console.log(`  Paid: ${call.result.payment.amount} USDC → ${call.result.payment.txHash}`)
      }
    }
  }

  return text
}

runBuyerAgent('Find a weather API and get the current temperature in Tokyo')
  .then(console.log)
  .catch(console.error)
```
