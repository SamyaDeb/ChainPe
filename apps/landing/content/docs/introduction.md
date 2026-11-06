---
title: Introduction
description: Turn any API into a paid service for AI agents on Arc, in one command.
---

AI agents want to pay for APIs, but most APIs only take API keys and monthly plans. ChainPe puts a price on any HTTP API. Agents pay per call in USDC on Arc, and Circle settles each payment.

ChainPe is for **developers** who already run an API, an MCP server or an AI agent. Your API's code doesn't change.

## How it works

1. **An agent calls your API.** ChainPe answers with `402 Payment Required` and a price in USDC.
2. **The agent pays.** It signs a USDC payment from its wallet. It never needs an API key or an account.
3. **Circle settles the payment on Arc.** Arc is Circle's blockchain, where fees are paid in USDC.
4. **Your API answers.** ChainPe calls your API only after the payment is settled.

## What's included

| Part | What it does |
|---|---|
| [`chainpe` CLI and proxy](/docs/developers/cli) | Puts a price in front of your API and takes payments |
| [SDK](/docs/developers/sdk) | Lets an app or agent find, pay for and rate APIs |
| [AI tools](/docs/developers/ai-tools) | The same abilities as Vercel AI SDK and LangChain tools |
| [MCP wallet](/docs/developers/mcp-wallet) | Gives Claude a USDC wallet with spending limits |
| [Provider dashboard](/docs/developers/dashboard) | Shows your verified revenue, buyers and ratings |
| [`ChainPeAccounts`](/docs/reference/chainpe-accounts) | Provider accounts, service listings and the Pro plan, on Arc |

## Where to start

- **Try a payment:** [pay a live API in 5 minutes](/docs/getting-started/quickstart).
- **Sell your API:** [put a price on it](/docs/getting-started/sell-your-api).

## Status

Everything runs on **Arc testnet** today. Nothing has run on Arc mainnet yet, so `chainpe start` refuses it without `--allow-mainnet`.

The packages are not on npm yet, so build them from source. The [quickstart](/docs/getting-started/quickstart) shows how.

ChainPe is not listed in Circle's Agent Marketplace yet. The listing is prepared, and Circle reviews each one by hand.
