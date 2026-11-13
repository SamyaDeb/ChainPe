---
id: sdk-reference-agent
title: "@chainpeavax/agent"
sidebar_position: 4
---

# @chainpeavax/agent

Standalone LLM agent loop for autonomous discovery and payment of ChainPe services.

## Installation

```bash
npm install @chainpeavax/agent
```

## Key exports

```ts
export { AgentRunner } from './agent.js'
export { WalletManager } from './wallet.js'
export { PaymentClient } from './payment.js'
export { RegistryClient } from './registry.js'
export { ReputationClient } from './reputation.js'
export { AgentKeychain } from './keychain.js'
```

## AgentRunner

The top-level orchestrator that combines LLM inference with ChainPe tools.

```ts
import { AgentRunner } from '@chainpeavax/agent'

const runner = new AgentRunner({
  // Wallet
  privateKey: process.env.CHAINPE_PRIVATE_KEY!,
  network: 'avalanche',
  maxPerCall: '0.10',
  autoFeedback: true,

  // LLM
  llmProvider: 'openai',          // 'openai' | 'anthropic'
  llmModel: 'gpt-4o',
  llmApiKey: process.env.OPENAI_API_KEY!,

  // Behavior
  maxSteps: 10,
  verbose: false
})

const result = await runner.run('Find a weather API and get conditions in Paris')
```

## Built-in tools

### callPaidApi

Calls an x402-gated URL, auto-paying in USDC. Source: `src/tools/callPaidApi.ts`.

```ts
// Input
{ url: string; method?: string; body?: string; headers?: Record<string, string> }

// Output
{ status: number; data: unknown; payment?: { amount: string; txHash?: string } }
```

### callFreeApi

Calls a non-402 URL. Source: `src/tools/callFreeApi.ts`.

```ts
// Input
{ url: string; method?: string; body?: string }

// Output
{ status: number; data: unknown }
```

### discoverService

Searches and ranks the ChainPe registry. Source: `src/tools/discoverService.ts`.

```ts
// Input
{ query?: string; tag?: string; maxPrice?: string }

// Output
Array<{ name: string; endpoint: string; pricePerRequest: string; reputation: ... }>
```

## AgentKeychain

Manages secure key storage for long-running agents:

```ts
import { AgentKeychain } from '@chainpeavax/agent'

const keychain = new AgentKeychain()
await keychain.store('myAgent', '0xPrivateKey')
const key = await keychain.retrieve('myAgent')
```

## WalletManager

```ts
import { WalletManager } from '@chainpeavax/agent'

const wallet = new WalletManager({ privateKey, network: 'avalanche' })
const balance = await wallet.getBalance()
const address = wallet.getAddress()
```

## PaymentClient

Direct x402 payment without the full agent loop:

```ts
import { PaymentClient } from '@chainpeavax/agent'

const client = new PaymentClient({ privateKey, network: 'avalanche', maxPerCall: '0.10' })
const result = await client.payAndFetch('https://api.example.com/data')
```

## CLI interface

The package also exports a CLI entry for running the agent from the terminal:

```bash
CHAINPE_PRIVATE_KEY=0x... \
CHAINPE_NETWORK=avalanche \
AGENT_LLM_PROVIDER=openai \
AGENT_LLM_MODEL=gpt-4o \
AGENT_LLM_API_KEY=sk-... \
npx @chainpeavax/agent "summarize the latest AI research"
```
