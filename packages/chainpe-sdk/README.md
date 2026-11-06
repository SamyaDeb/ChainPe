# @chainpearc/sdk

[![npm](https://img.shields.io/npm/v/@chainpearc/sdk.svg)](https://www.npmjs.com/package/@chainpearc/sdk)

**Let any app or AI agent find, pay for and rate APIs per call, in USDC on Arc.**

```bash
npm install @chainpearc/sdk
```

> **Use Arc testnet for now.** It is the default. ChainPe has not been tested with real USDC on Arc mainnet.

## Quickstart

Get free test USDC at https://faucet.circle.com (pick Arc Testnet). On Arc, gas is also paid in USDC.

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

`discover` searches Circle's Discovery API and the `ChainPeAccounts` contract, so it also finds ChainPe providers Circle has not listed yet. A service's `endpoint` is either a full route (Circle) or the provider's base URL (ChainPe). For a base URL, read `<endpoint>/openapi.json` for its paths.

## Two ways to pay

| Rail | How it works | Needs |
|---|---|---|
| `exact` | Moves USDC from your wallet for each call, starting at $0.01. Circle settles it on Arc. | USDC in your wallet |
| `gateway` | Pays from a prepaid Circle Gateway deposit with no gas, from fractions of a cent. Circle settles in batches. | A deposit: `await cp.depositGateway('1')` |

By default ChainPe uses Gateway when your deposit covers the price, and your wallet otherwise. To change that, pass `rails`, in order of preference.

## API

`new ChainPe(options)`

| Option | Default | Purpose |
|---|---|---|
| `privateKey` | required | The key that signs payments and ratings |
| `network` | `'arc-testnet'` | `'arc-testnet'` or `'arc'` |
| `rails` | `['gateway', 'exact']` | Payment rails, in order of preference |
| `maxPerCall` | `'1'` | Most USDC to pay for one call. A higher price is refused before signing |
| `autoFeedback` | `false` | Rate the provider 100 after a paid call. This costs gas |
| `accountsAddress` | the deployed contract | `ChainPeAccounts`. Also read from `CHAINPE_ACCOUNTS_ADDRESS` |
| `reputationRegistry` | Arc's registry | ERC-8004 registry. Also read from `ERC8004_REPUTATION_REGISTRY` |

| Method | Returns | What it does |
|---|---|---|
| `fetch(url, opts?)` | `Response` | Calls a URL, paying a 402 |
| `pay(url, opts?)` | `PaidResult` | The same, with the parsed body and payment details |
| `discover(query?)` | `RankedService[]` | Finds services. Takes a search string or `{ query, tags, maxPrice, category, gatewayOnly, limit }` |
| `balance()` | `{ usdc, gateway }` | Your wallet and Gateway balances |
| `depositGateway(amount)` | `{ txHash, amount }` | Deposits USDC into Circle Gateway |
| `getReputation(agentId)` | `{ count, score }` or `null` | Reads a provider's rating |
| `giveFeedback(agentId, score, opts?)` | tx hash | Posts a 0 to 100 rating. You can't rate your own agent |
| `getAddress()` | `string` | Your wallet address |

`PolicyVaultClient` is also exported. No `PolicyVault` contract is deployed on Arc yet, so it needs a `vaultAddress` of your own.

## Errors

- A price above `maxPerCall` throws before anything is signed.
- A server that refuses a signed payment throws `ChainPePaymentError`, with the cause in `.reason`, such as `insufficient_funds`.

## License

MIT
