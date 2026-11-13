---
id: developers-overview
title: Developer Overview
sidebar_position: 1
---

# For Developers

This section covers integrating ChainPe into your applications, agents, and AI frameworks.

## Entry points by use case

| Use case | Package | Guide |
|---|---|---|
| Add USDC micropayments to any Node.js app | `@chainpeavax/sdk` | [SDK Setup](./sdk-setup.md) |
| Build a Vercel AI SDK agent that pays for APIs | `@chainpeavax/ai-tools` | [AI Tools](./ai-tools.md) |
| Build a LangChain agent that pays for APIs | `@chainpeavax/ai-tools` | [AI Tools](./ai-tools.md) |
| Build a standalone LLM agent with discovery+pay | `@chainpeavax/agent` | [Agent Integration](./agent-integration.md) |
| Use Claude to pay for APIs | `chainpe-wallet-mcp` | [Agent Integration](./agent-integration.md) |

## Core SDK capabilities

The `@chainpeavax/sdk` package is the foundation. All other packages build on it.

```ts
import { ChainPe, RegistryClient, PolicyVaultClient, getReputation, giveFeedback } from '@chainpeavax/sdk'
```

**`ChainPe` class** — the main entry point:
- `cp.fetch(url)` — drop-in fetch with automatic x402 payment
- `cp.pay(url)` — like fetch but returns structured `PaidResult`
- `cp.discover(query)` — reputation-ranked service discovery
- `cp.getReputation(agentId)` — read ERC-8004 reputation
- `cp.giveFeedback(agentId, score)` — post ERC-8004 reputation
- `cp.balance()` — USDC + AVAX wallet balance

**`RegistryClient`** — direct registry access:
- `listAllServices()` — paginated on-chain registry read
- `filterServices(services, options)` — filter by query/tags/price
- `rankByReputation(rankedServices)` — sort by ERC-8004 score

**`PolicyVaultClient`** — gasless spending:
- `deposit()`, `withdraw()`, `setPolicy()`, `revokeSession()`
- `signSpend()` — agent signs off-chain (no gas)
- `relaySpend()` — relayer submits (pays gas)

## Networks

ChainPe supports two networks:

```ts
type ChainPeNetwork = 'avalanche' | 'fuji'
```

- **`avalanche`** — Avalanche C-Chain mainnet (chainId 43114). Primary network.
- **`fuji`** — Avalanche Fuji testnet (chainId 43113). Use for development.

The `network` parameter in the constructor determines which RPC, USDC address, and registry address are used automatically.
