# @chainpeavax/ai-tools

[![npm](https://img.shields.io/npm/v/@chainpeavax/ai-tools.svg)](https://www.npmjs.com/package/@chainpeavax/ai-tools)

**Drop-in ChainPe tools for AI agents** — let any Vercel AI SDK or LangChain agent
**discover, pay for, and rate** HTTP APIs and other agents per request in USDC on
Avalanche C-Chain. Thin adapters over [`@chainpeavax/sdk`](../chainpe-sdk).

Two tools per framework:

- **`chainpeFetch` / `chainpe_fetch`** — call a URL; if it returns `402 Payment
  Required`, pay it automatically in USDC (EIP-3009) and return the result.
- **`discoverService` / `discover_service`** — browse the on-chain marketplace,
  ranked by ERC-8004 reputation.

```bash
npm install @chainpeavax/ai-tools @chainpeavax/sdk
# plus your framework: `ai` (Vercel AI SDK) or `@langchain/core`
```

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpeavax/ai-tools/vercel'

const tools = createChainPeTools({
  privateKey: process.env.PRIVATE_KEY!,
  network: 'avalanche',
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
import { createChainPeLangChainTools } from '@chainpeavax/ai-tools/langchain'

const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
  privateKey: process.env.PRIVATE_KEY!,
  network: 'avalanche',
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
`registryAddress?`, `reputationRegistry?`, `maxPerCall?`, `autoFeedback?` — or a
pre-built client via `{ client }`:

```ts
import { ChainPe } from '@chainpeavax/sdk'
const client = new ChainPe({ privateKey, network: 'avalanche' })
const tools = createChainPeTools({ client })
```

## Custom frameworks

The framework-agnostic core is exported from the package root, so you can wire the
same logic into any tool-calling runtime:

```ts
import { fetchInputSchema, runFetch, getClient } from '@chainpeavax/ai-tools'

const client = getClient({ privateKey, network: 'avalanche' })
const result = await runFetch(client, { url: 'https://api.example.com/paid' })
```

## License

MIT
