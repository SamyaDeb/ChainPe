# @chainpearc/agent

[![npm](https://img.shields.io/npm/v/@chainpearc/agent.svg)](https://www.npmjs.com/package/@chainpearc/agent)

**An AI agent that finds paid APIs, pays for them per call in USDC on Arc, and uses the results.**

Ask it a question. It searches Circle's Discovery API and ChainPe's on-chain listings, picks a service, pays within your limits and answers. It works with Groq, OpenAI, Anthropic, Gemini, or a local model through Ollama.

> **Runs on Arc testnet.** ChainPe has not been tested with real USDC on Arc mainnet, so the agent refuses it unless `ALLOW_MAINNET=true` is set.

## Install

```bash
npm install -g @chainpearc/agent
```

Node.js 22.18 or newer.

## Set up

```bash
chainpe-agent init
```

The wizard asks for:

- **A model:** local (Ollama) or a provider and its API key.
- **A wallet:** import a key or generate one. Use a new wallet just for the agent. The key is stored in your OS keychain, never in a file.
- **Spending limits:** the most to pay for one call (default 0.10 USDC) and for one task (default 1.00 USDC).

Then get free test USDC at https://faucet.circle.com (pick Arc Testnet). On Arc, the same USDC pays for gas.

## Use it

```bash
chainpe-agent run "What is the weather in Mumbai?"
chainpe-agent services weather      # see what the agent can find
chainpe-agent status                # model, wallet, balance and limits
```

`--provider <name>` makes the agent use only the service with that name.

## In code

```ts
import { ChainPeAgent } from '@chainpearc/agent'

const agent = await ChainPeAgent.fromConfig()
const result = await agent.run('What is the weather in Mumbai?', {
  onPayment: (receipt) => console.log(`Paid ${receipt.amount} USDC to ${receipt.service}`)
})
console.log(result.text, result.payments)
```

On a server with no keychain, pass the config and key directly: `new ChainPeAgent({ config, privateKey })`.

## How it spends

- A price above the per-call limit, or above what is left of the task's limit, is refused **before** anything is signed.
- The same call is never paid for twice in one task.
- It pays from a Circle Gateway deposit when that covers the price, and from the wallet otherwise.
- It does not rate providers on its own. Use `giveFeedback` from `@chainpearc/sdk` to rate one.

## Commands

| Command | What it does |
|---|---|
| `chainpe-agent init` | Set up the model, wallet and limits |
| `chainpe-agent run <task>` | Run a task |
| `chainpe-agent services [query]` | Find paid services on Arc |
| `chainpe-agent status` | Show the configuration and balance |
| `chainpe-agent security` | Show how the key is stored |

## License

MIT
