---
id: sdk-reference-ai-tools
title: "@chainpeavax/ai-tools"
sidebar_position: 3
---

# @chainpeavax/ai-tools

Framework adapters that wrap the ChainPe SDK as native tool objects for Vercel AI SDK and LangChain.

## Installation

```bash
npm install @chainpeavax/ai-tools
```

## Subpath exports

The package uses subpath exports so you only import the framework you need:

```ts
// Vercel AI SDK
import { createChainPeTools } from '@chainpeavax/ai-tools/vercel'

// LangChain
import { createChainPeLangChainTools } from '@chainpeavax/ai-tools/langchain'

// Framework-agnostic core
import { runFetch, runDiscover, fetchInputSchema, discoverInputSchema } from '@chainpeavax/ai-tools'
```

## Vercel AI SDK adapter

### `createChainPeTools(options)`

```ts
function createChainPeTools(options: ChainPeToolOptions): ChainPeTools
```

Returns an object with two Vercel AI SDK `tool()` instances:

```ts
type ChainPeTools = {
  chainpeFetch: Tool<FetchInput, FetchResult>
  discoverService: Tool<DiscoverInput, DiscoverResultItem[]>
}
```

### FetchInput

```ts
interface FetchInput {
  url: string
  method?: string
  body?: string
  headers?: Record<string, string>
}
```

### FetchResult

```ts
interface FetchResult {
  status: number
  ok: boolean
  data: unknown
  payment?: {
    amount: string
    recipient: string
    network: string
    txHash?: string
  }
  reputation?: {
    agentId: string
    score: number
    txHash: string
  }
}
```

### DiscoverInput

```ts
interface DiscoverInput {
  query?: string
  tag?: string
  maxPrice?: string
}
```

### DiscoverResultItem

```ts
interface DiscoverResultItem {
  name: string
  description: string
  endpoint: string
  pricePerRequest: string
  tags: string[]
  reputation: { count: number; score: number | null } | null
}
```

## LangChain adapter

### `createChainPeLangChainTools(options)`

```ts
function createChainPeLangChainTools(options: ChainPeToolOptions): ChainPeLangChainTools
```

Returns:

```ts
type ChainPeLangChainTools = {
  chainpeFetchTool: StructuredTool   // name: 'chainpe_fetch'
  discoverServiceTool: StructuredTool  // name: 'discover_service'
}
```

LangChain tool outputs are JSON strings (LangChain tool contract).

## Framework-agnostic core

For building custom adapters:

### `getClient(options): ChainPe`

Constructs (or reuses a cached) `ChainPe` instance from the options.

### `runFetch(client, input): Promise<FetchResult>`

Executes a paid fetch using the given `ChainPe` client.

### `runDiscover(client, input): Promise<DiscoverResultItem[]>`

Executes a discovery search.

### Schemas and descriptions

```ts
const fetchInputSchema: ZodObject<...>    // Zod schema for FetchInput
const discoverInputSchema: ZodObject<...>  // Zod schema for DiscoverInput
const FETCH_TOOL_DESCRIPTION: string       // LLM description for chainpeFetch
const DISCOVER_TOOL_DESCRIPTION: string    // LLM description for discoverService
```

## ChainPeToolOptions

Identical to `ChainPeOptions` from `@chainpeavax/sdk`:

```ts
interface ChainPeToolOptions {
  privateKey: string
  network?: 'fuji' | 'avalanche'
  registryAddress?: string
  reputationRegistry?: string
  maxPerCall?: string
  autoFeedback?: boolean
}
```
