---
id: agent-integration
title: Agent Integration
sidebar_position: 4
---

# Agent Integration

This page covers integrating ChainPe into autonomous agents — systems that discover, pay for, and compose API services without human intervention.

## @chainpeavax/agent

The `@chainpeavax/agent` package provides a standalone LLM agent loop that discovers and pays for ChainPe services. It is framework-independent (uses its own LLM client, not Vercel AI SDK or LangChain).

### Installation

```bash
npm install @chainpeavax/agent
```

### Configuration

```ts
import { AgentRunner } from '@chainpeavax/agent'

const runner = new AgentRunner({
  // Wallet config
  privateKey: process.env.CHAINPE_PRIVATE_KEY!,
  network: 'avalanche',
  maxPerCall: '0.10',

  // LLM config
  llmProvider: 'openai',         // or 'anthropic'
  llmModel: 'gpt-4o',
  llmApiKey: process.env.OPENAI_API_KEY!,

  // Agent behavior
  autoFeedback: true,
  maxSteps: 10
})

const result = await runner.run('Summarize the latest AI news')
console.log(result)
```

### Available tools in the agent

The `@chainpeavax/agent` exposes these built-in tools:

| Tool | Description |
|---|---|
| `callPaidApi` | Call an x402-gated URL and auto-pay in USDC |
| `callFreeApi` | Call a free (non-402) URL |
| `discoverService` | Search and rank the ChainPe registry |

### Tool source files

- `packages/chainpe-agent/src/tools/callPaidApi.ts`
- `packages/chainpe-agent/src/tools/callFreeApi.ts`
- `packages/chainpe-agent/src/tools/discoverService.ts`

## chainpe-wallet-mcp (Claude Desktop)

The `chainpe-wallet-mcp` MCP extension gives Claude Desktop an Avalanche x402 wallet. After building and installing it, Claude can:

1. Search the marketplace (`search_bazaar`)
2. Make paid API calls (`x402_fetch`)
3. Transfer USDC (`transfer_usdc`)
4. Check its balance (`check_balance`)
5. Post reputation feedback (`give_feedback`)
6. View spending reports (`spending_report`)

### MCP tools exposed

| Tool | Description |
|---|---|
| `search_bazaar` | Search the ChainPe marketplace, ranked by ERC-8004 reputation |
| `x402_fetch` | Fetch a URL, auto-paying the x402 402 in USDC |
| `pay` | Direct USDC payment to an address |
| `transfer_usdc` | Transfer USDC to another wallet |
| `transfer_avax` | Transfer AVAX to another wallet |
| `check_balance` | Read USDC and AVAX wallet balance |
| `give_feedback` | Post ERC-8004 reputation feedback for a provider |
| `spending_report` | Summary of recent payments |
| `request_funding` | Generate a funding request QR or address |

### Building the MCP extension

```bash
cd packages/chainpe-wallet
npm install
npm run build:mcpb  # produces chainpe.mcpb
```

Double-click `chainpe.mcpb` to install into Claude Desktop. See `packages/chainpe-wallet/README.md` for full setup.

## Pattern: buyer agent hiring seller agents

The seller-agent example in `examples/seller-agents/` demonstrates a buyer agent that discovers and hires two seller agents:

```bash
cd examples/seller-agents
cp .env.example .env   # fill in keys
npm install

# Launch the seller agents (in background)
./launch.sh

# Run the buyer agent
npm run orchestrate -- "summarize latest AI research"
```

The buyer agent:
1. Calls `discoverService` → gets ranked list with ERC-8004 scores
2. Calls the first seller agent (pays USDC) → gets partial result
3. Calls the second seller agent (pays USDC) → gets another result
4. Composes both results and returns the answer
5. Posts reputation feedback for both sellers (if `autoFeedback: true`)

Each seller agent:
- Runs behind the ChainPe x402 proxy
- Registers on `ChainPeRegistry` with an ERC-8004 identity
- Advertises its `agentId` on the 402 response

## Pattern: autonomous spending with PolicyVault

For long-running agents with controlled budgets:

```ts
import { PolicyVaultClient } from '@chainpeavax/sdk'

// Setup (done once by the operator)
const owner = new PolicyVaultClient({
  privateKey: process.env.OPERATOR_KEY!,
  network: 'avalanche',
  vaultAddress: '0xVaultAddress'
})
await owner.deposit('100.00')
await owner.setPolicy({
  sessionKey: '0xAgentSessionKey',
  maxPerCall: '0.10',
  dailyCap: '5.00',
  totalBudget: '100.00',
  expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
  allowlistOnly: false
})

// Agent loop (gasless)
const agent = new PolicyVaultClient({
  privateKey: process.env.AGENT_SESSION_KEY!,
  network: 'avalanche',
  vaultAddress: '0xVaultAddress'
})

// Agent signs (no gas) — relayer submits
const auth = await agent.signSpend({
  owner: '0xOperatorAddress',
  to: '0xProviderWallet',
  amount: '0.01'
})

// Relayer (could be the facilitator or any funded key)
const relayer = new PolicyVaultClient({
  privateKey: process.env.RELAYER_KEY!,
  network: 'avalanche',
  vaultAddress: '0xVaultAddress'
})
const txHash = await relayer.relaySpend(auth)
```
