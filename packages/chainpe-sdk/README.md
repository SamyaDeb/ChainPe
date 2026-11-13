# @chainpeavax/sdk

[![npm](https://img.shields.io/npm/v/@chainpeavax/sdk.svg)](https://www.npmjs.com/package/@chainpeavax/sdk)

**x402 USDC payments + on-chain ERC-8004 reputation for the Avalanche agent economy — in 3 lines.**

Give any app or AI agent the ability to **discover, pay for, and rate** HTTP APIs
per request in USDC, settled on Avalanche C-Chain. The provider's facilitator pays
the gas, so your wallet only needs USDC.

```bash
npm install @chainpeavax/sdk
```

## Quickstart (the 3 lines)

```ts
import { ChainPe } from '@chainpeavax/sdk'

const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY!, network: 'avalanche' })
const res = await cp.fetch('https://api.example.com/paid') // auto-pays a 402
const data = await res.json()
```

`cp.fetch` is a drop-in `fetch`: it makes the request, and if the server answers
`402 Payment Required`, it signs a USDC payment (EIP-3009), retries with the
`X-PAYMENT` header, and returns the final `Response`.

## Discover + pay an agent (ranked by reputation)

```ts
const cp = new ChainPe({ privateKey, network: 'avalanche' })

// Ranked: scored services first, highest ⭐ first.
const services = await cp.discover('summarize')

const best = services[0]
const result = await cp.pay(best.endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '…' }),
  autoFeedback: true // leave on-chain ERC-8004 feedback after paying
})

console.log(result.data)        // parsed response body
console.log(result.payment)     // { amount, recipient, network, txHash }
console.log(result.reputation)  // { agentId, score, txHash } when autoFeedback
```

## API

`new ChainPe(options)`

| option | default | purpose |
|---|---|---|
| `privateKey` | — (required) | EOA key that signs payments + feedback |
| `network` | `'avalanche'` | `'avalanche'` or `'fuji'` |
| `registryAddress` | deployed default (mainnet) | ChainPeRegistry address |
| `reputationRegistry` | deployed default (mainnet) | ERC-8004 Reputation Registry |
| `maxPerCall` | `'1'` | max USDC to auto-pay for one 402 |
| `autoFeedback` | `false` | post positive feedback after a paid call |
| `facilitatorUrl` | — | reserved for facilitator-routed flows |

Methods:

- **`fetch(url, opts?)` → `Response`** — drop-in fetch that auto-pays a 402.
- **`pay(url, opts?)` → `PaidResult`** — same, but returns parsed `data` plus
  `payment` and (optional) `reputation` details.
- **`discover(query?)` → `RankedService[]`** — read the on-chain registry,
  annotate each service with its ERC-8004 reputation, ranked best-first.
  `query` is a search string or `{ query, tags, maxPrice }`.
- **`getReputation(agentId)` → `ReputationSummary | null`** — aggregate score.
- **`giveFeedback(agentId, score, opts?)` → `txHash`** — post 0–100 feedback.
- **`getAddress()` → `string`** — the wallet address.
- **`balance()` → `{ usdc, avax }`** — on-chain balances (human units).

## Environment overrides

`registryAddress` / `reputationRegistry` fall back to `CHAINPE_REGISTRY_ADDRESS`
and `ERC8004_REPUTATION_REGISTRY` env vars, then the built-in deployed defaults.

## Live on Avalanche C-Chain

Works out of the box against the deployed mainnet contracts (see `docs/DEPLOYMENTS.md`):
ChainPeRegistry `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`, ERC-8004 Reputation
`0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543`. USDC is available on major CEXes and bridges (e.g., [Stargate](https://stargate.finance)).

Run the example:

```bash
CHAINPE_PRIVATE_KEY=0x... npx tsx examples/quickstart.ts
```

## License

MIT
