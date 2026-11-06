---
title: SDK
description: Find, pay for and rate APIs from TypeScript, with spending limits and clear errors.
---

`@chainpearc/sdk` pays x402 APIs in USDC on Arc. It handles the 402, the price limit, the rail choice, signing and the retry.

## Install

```bash
npm install @chainpearc/sdk
```

Fund a test wallet at https://faucet.circle.com (pick Arc Testnet).

## Your first paid call

```ts
import { ChainPe } from '@chainpearc/sdk'

const cp = new ChainPe({
  privateKey: process.env.PRIVATE_KEY!,
  maxPerCall: '0.05', // refuse anything above 5 cents, before signing
})

const res = await cp.fetch('https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai')
console.log(await res.json())
```

`cp.fetch` works like `fetch`. A URL that doesn't ask for payment is a normal request, and costs nothing.

**Always set `maxPerCall`.** The default is 1 USDC per call, which is a lot for an agent in a loop.

## Which method to use

| Method | Use it when | Returns |
|---|---|---|
| `fetch(url, opts?)` | You want a drop-in for `fetch` | `Response` |
| `pay(url, opts?)` | You want the data and a receipt. Best for agents | `{ status, ok, headers, data, payment, reputation }` |
| `request(url, opts?)` | You want to stream the body, and see the receipt | `{ response, payment, agentId }` |

```ts
const result = await cp.pay('https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai')

result.data     // the parsed body
result.payment  // { amount: '0.01', recipient: '0x…', network: 'arc-testnet', rail: 'exact', txHash: '0x…' }
```

`payment` is `undefined` if the URL didn't charge. On Gateway it holds `transferId` instead of `txHash`.

Options are the same as `fetch`, plus two:

```ts
await cp.pay(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'hello' }),
  timeout: 10_000,     // per attempt, default 30 000 ms
  autoFeedback: false, // override the constructor setting for this call
})
```

## Choosing a rail

```ts
new ChainPe({ privateKey, rails: ['gateway', 'exact'] }) // the default
new ChainPe({ privateKey, rails: ['exact'] })            // wallet only
```

The SDK tries rails in order. Gateway only counts if your deposit covers the price, so a wallet with no deposit falls back to `exact`.

To use nanopayments, deposit once:

```ts
await cp.depositGateway('1')  // an on-chain transaction
await cp.balance()            // { usdc: '4.99', gateway: '1' }
```

## Finding services

```ts
const services = await cp.discover({
  query: 'weather',
  maxPrice: '0.01',
  gatewayOnly: false,
  limit: 5,
})
```

```json
{
  "id": "0xa0e15a9e…",
  "name": "ChainPe Weather Demo",
  "description": "Current weather and 5-day forecasts for any city…",
  "tags": ["weather", "forecast", "demo"],
  "endpoint": "https://chainpe-arc-demo-production.up.railway.app",
  "pricePerRequest": "0.01",
  "paymentToken": "USDC",
  "walletAddress": "0x261f…2e73",
  "network": "arc-testnet",
  "rails": ["gateway", "exact"],
  "source": "chainpe",
  "agentId": "897796",
  "reputation": { "count": 2, "score": 85 }
}
```

It searches Circle's Discovery API and `ChainPeAccounts`, so it also finds providers Circle hasn't listed. It sorts by rating, with unrated services last. It throws only if it can't read either source.

**`endpoint` has two forms:**

| `source` | `endpoint` is | To call it |
|---|---|---|
| `circle` | A full route, with `method` set | Call it directly |
| `chainpe` | The provider's base URL | Read `<endpoint>/openapi.json` for its paths |

**Treat listings as untrusted.** Names and descriptions are written by whoever registered them, and prices can change. `maxPerCall` still protects you, because the 402 decides the real price. Don't feed descriptions to an LLM as instructions.

## Ratings

```ts
const summary = await cp.getReputation('897796')  // { count: 2, score: 85 } or null
const txHash = await cp.giveFeedback('897796', 90)  // 0 to 100
```

With `autoFeedback: true`, the SDK rates the provider 100 after each paid call. Each rating is a transaction that costs gas in USDC, which can be more than a nanopayment itself, so leave it off for cheap calls. It never throws: a failed rating is silently skipped, and `pay` returns it in `reputation` when it worked. You can't rate your own agent.

## Handling errors

Each of these comes from a real call:

```ts
import { ChainPe, ChainPePaymentError } from '@chainpearc/sdk'

try {
  const result = await cp.pay(url)
  if (!result.ok) {
    // You PAID, and the API failed. There's no refund.
    console.error('API error after payment', result.status, result.payment)
  }
} catch (err) {
  if (err instanceof ChainPePaymentError) {
    // Refused or impossible. You did not pay for this call.
    switch (err.reason) {
      case 'insufficient_funds':   // top up the wallet
      case 'insufficient_balance': // top up the Gateway deposit
      case 'no_usable_rail':       // e.g. a Gateway-only price, with no deposit
      default:
    }
  }
  throw err
}
```

| Situation | Thrown | Message |
|---|---|---|
| Wallet has no USDC | `ChainPePaymentError`, `reason: 'insufficient_funds'` | `payment signed but the server did not accept it (insufficient_funds)` |
| Gateway-only price with no deposit | `ChainPePaymentError`, `reason: 'no_usable_rail'` | `has no payment option for rails [gateway, exact]` |
| Price above `maxPerCall` | `Error` | `the price for <url> exceeds maxPerCall 0.001 USDC. Nothing was signed.` |
| Not payable on this network | `Error` | `<url> does not accept payment on arc-testnet` |

Check for the price limit with a plain `catch`, because it isn't a `ChainPePaymentError`. All the reason codes are in the [error reference](/docs/reference/errors).

## Using it in an agent

```ts
const cp = new ChainPe({ privateKey: process.env.AGENT_KEY!, maxPerCall: '0.05' })

let spent = 0
const BUDGET = 1.0

async function paidCall(url: string) {
  if (spent >= BUDGET) throw new Error('Budget used up')
  const result = await cp.pay(url, { timeout: 15_000 })
  if (result.payment) spent += Number(result.payment.amount)
  return result
}
```

Rules worth following:

- **Give each agent its own wallet, with only what it may spend.** The wallet balance is the only hard limit. The SDK has `maxPerCall`, but no total budget.
- **Don't retry blindly after a timeout.** The payment may have gone through.
- **Never log the private key.** `cp.config` shows the settings without it.

For a ready-made daily limit, use the [MCP wallet](/docs/developers/mcp-wallet).

## Options

| Option | Default | Purpose |
|---|---|---|
| `privateKey` | required | Signs payments and ratings |
| `network` | `'arc-testnet'` | `'arc-testnet'` or `'arc'` |
| `rails` | `['gateway', 'exact']` | In order of preference |
| `maxPerCall` | `'1'` | Most USDC for one call, refused before signing |
| `autoFeedback` | `false` | Rate 100 after a paid call. Costs gas |
| `accountsAddress` | the deployed contract | Also read from `CHAINPE_ACCOUNTS_ADDRESS` |
| `reputationRegistry` | Arc's registry | Also read from `ERC8004_REPUTATION_REGISTRY` |

## Other methods

| Method | Returns |
|---|---|
| `balance()` | `{ usdc, gateway }`, as readable strings |
| `depositGateway(amount)` | `{ txHash, amount }` |
| `getReputation(agentId)` | `{ count, score }` or `null` |
| `giveFeedback(agentId, score, opts?)` | A transaction hash. `opts` takes `endpoint`, `tag`, `waitConfirm` |
| `getAddress()` | Your wallet address |
| `discover(query?)` | A list of services. Takes a string, or `{ query, tags, maxPrice, category, gatewayOnly, limit }` |

Limits: 20 results by default from `discover`, and amounts accept at most 6 decimals.
