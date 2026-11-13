---
id: quickstart
title: Quickstart
sidebar_position: 2
---

# Quickstart

Make your first USDC micropayment to a ChainPe-registered API on Avalanche C-Chain in under 5 minutes.

## Prerequisites

- Node.js 18+
- An Avalanche C-Chain wallet private key (0x-prefixed hex, 32 bytes)
- USDC on Avalanche C-Chain — available on major CEXes and bridges (e.g., [Stargate](https://stargate.finance))

You do NOT need AVAX in the agent wallet. The ChainPe facilitator pays gas on your behalf.

## Step 1 — Install

```bash
npm install @chainpeavax/sdk
```

## Step 2 — Create a ChainPe client

```ts
import { ChainPe } from '@chainpeavax/sdk'

const cp = new ChainPe({
  privateKey: process.env.CHAINPE_PRIVATE_KEY!,
  network: 'avalanche',
  // Optional: set a per-call spending cap (default: 1 USDC)
  maxPerCall: '0.10',
  // Optional: auto-post ERC-8004 reputation after each paid call
  autoFeedback: false
})

console.log('Wallet address:', cp.getAddress())
```

## Step 3 — Check your balance

```ts
const balances = await cp.balance()
console.log(`USDC: ${balances.usdc}`)
console.log(`AVAX: ${balances.avax}`)
```

## Step 4 — Discover available services

```ts
const services = await cp.discover()
for (const svc of services) {
  console.log(`${svc.name} — ${svc.pricePerRequest} USDC — ${svc.endpoint}`)
  if (svc.reputation) {
    console.log(`  Reputation: ${svc.reputation.score} (${svc.reputation.count} ratings)`)
  }
}
```

## Step 5 — Make a paid API call

```ts
// cp.fetch() is a drop-in fetch() replacement.
// It intercepts HTTP 402, signs a USDC payment, and retries automatically.
const response = await cp.fetch('https://api.example.com/data')
const data = await response.json()
console.log(data)
```

If the endpoint returns `402 Payment Required`, the SDK will:
1. Parse the x402 payment requirements from the response body
2. Sign a USDC `transferWithAuthorization` (EIP-3009) with your private key
3. Attach the payment header (`X-PAYMENT`) and retry the request
4. Return the successful `200` response

## Step 6 — Use `pay()` for structured results

`cp.pay()` is like `cp.fetch()` but returns a structured object including payment details:

```ts
const result = await cp.pay<{ answer: string }>('https://api.example.com/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'What is the capital of France?' })
})

console.log('Status:', result.status)
console.log('Answer:', result.data.answer)

if (result.payment) {
  console.log('Paid:', result.payment.amount, 'USDC')
  console.log('Recipient:', result.payment.recipient)
  console.log('Tx hash:', result.payment.txHash)
}
```

## Step 7 — Register your own service (optional)

If you have an API you want to monetize, initialize the CLI:

```bash
npm install -g @chainpeavax/cli
chainpe init      # interactive wizard → saves to ~/.chainpe/config.json
chainpe start     # starts the x402 payment proxy
chainpe register  # publishes your service on-chain
```

See [Merchant Registration](../merchants/registration.md) for a full walkthrough.

## Complete working example

```ts
import { ChainPe } from '@chainpeavax/sdk'

async function main() {
  const cp = new ChainPe({
    privateKey: process.env.CHAINPE_PRIVATE_KEY!,
    network: 'avalanche',
    maxPerCall: '0.10'
  })

  // Check balance
  const { usdc } = await cp.balance()
  console.log(`Balance: ${usdc} USDC`)

  // Discover what's available
  const services = await cp.discover({ maxPrice: '0.05' })
  console.log(`Found ${services.length} services under 0.05 USDC/call`)

  if (services.length === 0) {
    console.log('No services found. Try the live indexer:')
    console.log('https://chainpe-indexer-production.up.railway.app/services')
    return
  }

  const target = services[0]
  console.log(`Calling: ${target.name} at ${target.endpoint}`)

  // Make the paid call
  const result = await cp.pay(target.endpoint)
  console.log('Response:', result.data)
  console.log('Payment:', result.payment)
}

main().catch(console.error)
```

## Expected output

```
Balance: 5.00 USDC
Found 2 services under 0.05 USDC/call
Calling: Weather Oracle at https://weather.chainpe.app
Response: { temperature: 22, unit: "C", location: "San Francisco" }
Payment: { amount: "0.01", recipient: "0xAbc...", txHash: "0x123..." }
```

## Troubleshooting

**`x402: server accepts [...] but wallet is on fuji`**
The endpoint is on a different network. Pass `network: 'avalanche'` to use mainnet services.

**`x402: payment of X USDC exceeds maxPerCall`**
Increase `maxPerCall` in the constructor, or the endpoint is more expensive than expected.

**`ChainPePaymentError: x402: failed to sign payment`**
Check that `CHAINPE_PRIVATE_KEY` is a valid 0x-prefixed 64-hex-character private key.

**Response status 402 after payment**
The facilitator could not settle. Check that you have USDC on Avalanche C-Chain at your wallet address. The hosted facilitator is at `https://chainpe-facilitator-production.up.railway.app`.
