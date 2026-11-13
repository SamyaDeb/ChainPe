---
id: sdk-setup
title: SDK Setup
sidebar_position: 2
---

# SDK Setup

Full documentation for initializing and configuring `@chainpeavax/sdk`.

## Installation

```bash
npm install @chainpeavax/sdk
```

## ChainPe constructor

```ts
import { ChainPe } from '@chainpeavax/sdk'

const cp = new ChainPe(options: ChainPeOptions)
```

### ChainPeOptions

```ts
interface ChainPeOptions {
  /** EOA private key (0x-prefixed or bare hex) used to sign payments + feedback. Required. */
  privateKey: string

  /**
   * Avalanche network. Defaults to 'avalanche' (mainnet).
   * Use 'fuji' for testnet development.
   */
  network?: 'avalanche' | 'fuji'

  /** ChainPeRegistry address. Defaults to the deployed registry for the network. */
  registryAddress?: string

  /** ERC-8004 Reputation Registry address. Defaults to the deployed one for the network. */
  reputationRegistry?: string

  /**
   * Optional facilitator URL. Used for provider-side helpers and facilitator-routed flows.
   * Most consumers do not need to set this.
   */
  facilitatorUrl?: string

  /**
   * Max USDC to auto-pay for a single 402 (human units, e.g. "1.00").
   * The payment is refused if a 402 demands more. Defaults to "1".
   */
  maxPerCall?: string

  /**
   * When true, .fetch()/.pay() post positive ERC-8004 feedback after a successful
   * paid call. Defaults to false (opt-in, since resolving the agent scans the registry).
   */
  autoFeedback?: boolean
}
```

### Example configurations

```ts
// Minimal (mainnet)
const cp = new ChainPe({ privateKey: process.env.KEY! })

// Fuji testnet development
const cp = new ChainPe({
  privateKey: process.env.KEY!,
  network: 'fuji',  // Use 'avalanche' for mainnet; 'fuji' for testnet development
  maxPerCall: '0.05'  // never pay more than 5 cents per call
})

// With auto-feedback (reputation accrues after every paid call)
const cp = new ChainPe({
  privateKey: process.env.KEY!,
  network: 'avalanche',
  autoFeedback: true,
  maxPerCall: '0.10'
})

// Custom registry (for local testing)
const cp = new ChainPe({
  privateKey: process.env.KEY!,
  network: 'fuji',  // Use 'avalanche' for mainnet; 'fuji' for testnet
  registryAddress: '0xYourLocalRegistry',
  reputationRegistry: '0xYourLocalReputation'
})
```

## ChainPe methods

### `cp.getAddress(): string`

Returns the wallet address derived from the private key. No RPC call.

```ts
console.log(cp.getAddress())  // '0xAbc123...'
```

### `cp.config`

Returns the resolved configuration (no secrets):

```ts
console.log(cp.config)
// {
//   network: 'avalanche',
//   address: '0xAbc...',
//   registryAddress: '0x2a58...',
//   reputationRegistry: '0xfe7D...',
//   facilitatorUrl: undefined,
//   maxPerCall: '0.10'
// }
```

### `cp.balance(): Promise<Balances>`

Reads on-chain USDC and AVAX balances:

```ts
interface Balances {
  usdc: string  // human units, e.g. "5.230000"
  avax: string  // human units, e.g. "0.012"
}

const { usdc, avax } = await cp.balance()
```

### `cp.fetch(url, opts?): Promise<Response>`

Drop-in fetch replacement. Returns the raw `Response` object. On a `402`, signs and retries automatically.

```ts
interface FetchOptions extends RequestInit {
  /** Override autoFeedback for this call */
  autoFeedback?: boolean
  /** Request timeout in ms. Default: 30000 */
  timeout?: number
}

const response = await cp.fetch('https://api.example.com/data')
const data = await response.json()
```

### `cp.pay<T>(url, opts?): Promise<PaidResult<T>>`

Like `fetch` but returns a structured result with payment metadata:

```ts
interface PaidResult<T> {
  status: number
  ok: boolean
  headers: Record<string, string>
  data: T                    // parsed JSON or text
  payment?: PaymentInfo      // present when a payment was made
  reputation?: {             // present when autoFeedback posted a rating
    agentId: string
    score: number
    txHash: string
  }
}

interface PaymentInfo {
  amount: string             // human USDC, e.g. "0.01"
  recipient: string          // provider's payTo address
  network: 'avalanche' | 'fuji'
  txHash?: string            // Avalanche settlement tx
  settlement?: unknown       // raw decoded X-PAYMENT-RESPONSE
}

const result = await cp.pay<{ weather: string }>('https://api.example.com/weather')
console.log(result.data.weather)
console.log(result.payment?.txHash)
```

### `cp.discover(query?): Promise<RankedService[]>`

Discovers registered services, ranked by ERC-8004 reputation:

```ts
interface DiscoverOptions {
  query?: string       // free-text match over name/description/tags
  tags?: string[]      // filter by these tags (all must match)
  maxPrice?: string    // max price in human USDC
}

interface RankedService extends ChainPeService {
  reputation: ReputationSummary | null
}

// String shorthand
const services = await cp.discover('weather')

// Full options
const services = await cp.discover({
  query: 'weather',
  tags: ['api', 'data'],
  maxPrice: '0.05'
})
```

### `cp.getReputation(agentId): Promise<ReputationSummary | null>`

```ts
const rep = await cp.getReputation('42')
// { count: 15, score: 87.3 } or null
```

### `cp.giveFeedback(agentId, score, opts?): Promise<string>`

Posts ERC-8004 feedback. Returns the transaction hash.

```ts
const txHash = await cp.giveFeedback('42', 100, {
  endpoint: 'https://api.example.com',
  tag: 'x402-success',
  waitConfirm: true
})
```

## Error handling

```ts
import { ChainPePaymentError } from '@chainpeavax/sdk'

try {
  const result = await cp.pay('https://api.example.com/data')
} catch (err) {
  if (err instanceof ChainPePaymentError) {
    console.error('Payment failed:', err.message)
    console.error('Reason:', err.reason)       // e.g. 'settlement_rejected'
    console.error('Tx hash:', err.txHash)     // if available
  }
}
```
