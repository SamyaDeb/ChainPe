---
title: SDK
description: Find, pay for and rate APIs from your own code.
---

`@chainpearc/sdk` lets any app or agent pay per call in USDC on Arc. It isn't on npm yet. From the repo root, run `npm run build:sdk`.

Get test USDC at https://faucet.circle.com (pick Arc Testnet). Arc testnet is the default network.

## Quickstart

```ts
import { ChainPe } from '@chainpearc/sdk'

const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY! })
const res = await cp.fetch('https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai')
const data = await res.json()
```

`cp.fetch` works like `fetch`. If the server answers `402 Payment Required`, it checks the price against your limit, signs a USDC payment, retries and returns the final `Response`.

## Find, pay and rate

```ts
const services = await cp.discover({ query: 'weather', maxPrice: '0.01' })

const result = await cp.pay('https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai')
console.log(result.data)     // the parsed response
console.log(result.payment)  // { amount, recipient, network, rail, txHash or transferId }

await cp.giveFeedback(services[0].agentId!, 90)
```

`discover` searches Circle's Discovery API and the `ChainPeAccounts` contract, so it also finds providers Circle has not listed yet. A service's `endpoint` is either a full route (Circle) or the provider's base URL (ChainPe). For a base URL, read `<endpoint>/openapi.json` for its paths.

## Choosing a rail

By default ChainPe uses Gateway when your deposit covers the price, and your wallet otherwise. To change that, pass `rails` in order of preference. To fund Gateway, call `await cp.depositGateway('1')`. See [payment rails](/docs/concepts/payment-rails).

## Options

| Option | Default | Purpose |
|---|---|---|
| `privateKey` | required | The key that signs payments and ratings |
| `network` | `'arc-testnet'` | `'arc-testnet'` or `'arc'` |
| `rails` | `['gateway', 'exact']` | Payment rails, in order of preference |
| `maxPerCall` | `'1'` | Most USDC to pay for one call. A higher price is refused before signing |
| `autoFeedback` | `false` | Rates the provider 100 after a paid call. This costs gas |
| `accountsAddress` | the deployed contract | `ChainPeAccounts`. Also read from `CHAINPE_ACCOUNTS_ADDRESS` |
| `reputationRegistry` | Arc's registry | ERC-8004 registry. Also read from `ERC8004_REPUTATION_REGISTRY` |

## Methods

| Method | Returns | What it does |
|---|---|---|
| `fetch(url, opts?)` | `Response` | Calls a URL, paying a 402 |
| `pay(url, opts?)` | `PaidResult` | The same, with the parsed body and payment details |
| `request(url, opts?)` | `{ response, payment, agentId }` | The same, with the unread `Response` |
| `discover(query?)` | `RankedService[]` | Finds services. Takes a search string or an options object |
| `balance()` | `{ usdc, gateway }` | Your wallet and Gateway balances |
| `depositGateway(amount)` | `{ txHash, amount }` | Deposits USDC into Circle Gateway |
| `getReputation(agentId)` | `{ count, score }` or `null` | Reads a provider's rating |
| `giveFeedback(agentId, score, opts?)` | tx hash | Posts a 0 to 100 rating |
| `getAddress()` | `string` | Your wallet address |

`discover` options are `query`, `tags`, `maxPrice`, `category`, `gatewayOnly` and `limit`.

## Errors

- A price above `maxPerCall` throws before anything is signed.
- A server that refuses a signed payment throws `ChainPePaymentError`, with the cause in `.reason`, such as `insufficient_funds`.
