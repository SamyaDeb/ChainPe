---
id: sdk-reference-chainpe-sdk
title: "@chainpeavax/sdk"
sidebar_position: 2
---

# @chainpeavax/sdk

Complete API reference for the core ChainPe SDK.

## Installation

```bash
npm install @chainpeavax/sdk
```

## Exports

```ts
// Main class
export { ChainPe } from './chainpe.js'

// Registry
export { RegistryClient, filterServices, rankByReputation, decodeService } from './registry.js'
export type { RawService } from './registry.js'

// Reputation
export { getReputation, giveFeedback, summaryToScore } from './reputation.js'
export type { GiveFeedbackParams } from './reputation.js'

// PolicyVault
export { PolicyVaultClient } from './policyvault.js'
export type { PolicyVaultOptions, PolicyParams, SpendAuthorization } from './policyvault.js'

// Networks
export { publicClientFor, resolveRegistryAddress, resolveReputationRegistry,
         getUsdcAddress, getX402Network, rpcUrlFor, USDC_DECIMALS } from './networks.js'

// Error + types
export { ChainPePaymentError } from './types.js'
export type { ChainPeNetwork, ChainPeOptions, FetchOptions, ChainPeService,
              DiscoverOptions, ReputationSummary, RankedService, PaymentInfo,
              PaidResult, Balances } from './types.js'
```

---

## ChainPe class

The primary entry point for consumers.

### Constructor

```ts
new ChainPe(options: ChainPeOptions): ChainPe
```

Throws if `privateKey` is missing or invalid.

### Properties (readonly)

| Property | Type | Description |
|---|---|---|
| `network` | `ChainPeNetwork` | The resolved network (`'avalanche'` or `'fuji'`) |
| `registryAddress` | `` `0x${string}` `` | Resolved ChainPeRegistry contract address |
| `reputationRegistry` | `` `0x${string}` \| undefined `` | Resolved ERC-8004 ReputationRegistry address |

### Methods

#### `getAddress(): string`
Returns the wallet address (no RPC call).

#### `get config`
Returns resolved config object (no private key included).

#### `balance(): Promise<Balances>`
Reads on-chain USDC and AVAX balances.

```ts
interface Balances { usdc: string; avax: string }
```

#### `fetch(url: string, opts?: FetchOptions): Promise<Response>`
Drop-in `fetch` that auto-pays a `402`. Returns the live `Response` object.

```ts
interface FetchOptions extends RequestInit {
  autoFeedback?: boolean  // override constructor setting
  timeout?: number        // ms, default 30000
}
```

#### `pay<T>(url: string, opts?: FetchOptions): Promise<PaidResult<T>>`
Like `fetch` but parses the body and returns payment metadata.

```ts
interface PaidResult<T> {
  status: number
  ok: boolean
  headers: Record<string, string>
  data: T
  payment?: PaymentInfo
  reputation?: { agentId: string; score: number; txHash: string }
}

interface PaymentInfo {
  amount: string
  recipient: string
  network: ChainPeNetwork
  txHash?: string
  settlement?: unknown
}
```

#### `discover(query?: string | DiscoverOptions): Promise<RankedService[]>`
Returns services sorted by ERC-8004 reputation (scored first, highest score first).

```ts
interface DiscoverOptions {
  query?: string    // free-text over name/description/tags
  tags?: string[]
  maxPrice?: string // human USDC
}

interface RankedService extends ChainPeService {
  reputation: ReputationSummary | null
}
```

#### `getReputation(agentId: string): Promise<ReputationSummary | null>`
Reads aggregate ERC-8004 reputation.

```ts
interface ReputationSummary {
  count: number        // number of distinct raters
  score: number | null // 0–100 aggregate, null if no feedback
}
```

#### `giveFeedback(agentId, score, opts?): Promise<string>`
Posts ERC-8004 feedback. Returns tx hash.

```ts
// score: 0–100
// opts.endpoint: the URL you called (for context)
// opts.tag: string tag, e.g. 'x402-success'
// opts.waitConfirm: wait for tx receipt (default: false)
```

---

## RegistryClient

Low-level on-chain registry access.

```ts
import { RegistryClient, filterServices, rankByReputation } from '@chainpeavax/sdk'

const client = new RegistryClient(network, registryAddress)

// Read all services (paginated under the hood)
const services: ChainPeService[] = await client.listAllServices()

// Register (calls ChainPeRegistry.register)
const txHash = await client.registerService({ privateKey, name, description, ... })

// Check existence
const exists: boolean = await client.hasService(walletAddress, serviceName)

// Get registration fee
const fee: bigint = await client.registrationFee()

// Deregister
const { txnHash } = await client.deregisterService(privateKey, serviceName)
```

### filterServices

```ts
function filterServices(
  services: ChainPeService[],
  options: DiscoverOptions
): ChainPeService[]
```

Filters by `query` (name/description/tags), `tags`, and `maxPrice`.

### rankByReputation

```ts
function rankByReputation(services: RankedService[]): RankedService[]
```

Sorts: services with a non-null score (highest first) → services without a score.

---

## PolicyVaultClient

Gasless spending from a PolicyVault. See [Policy Vaults](../concepts/policy-vaults.md).

```ts
import { PolicyVaultClient } from '@chainpeavax/sdk'

const client = new PolicyVaultClient({
  privateKey: string,
  network?: ChainPeNetwork,
  vaultAddress: string
})
```

### Methods

| Method | Description |
|---|---|
| `getAddress(): string` | Returns this key's wallet address |
| `balanceOf(owner): Promise<string>` | Vault USDC balance in human units |
| `dailyRemaining(owner): Promise<string>` | USDC remaining today under daily cap |
| `budgetRemaining(owner): Promise<string>` | USDC remaining under lifetime budget |
| `nonce(owner): Promise<bigint>` | Current spend nonce |
| `deposit(human): Promise<Hex>` | Deposit USDC (owner role) |
| `withdraw(human): Promise<Hex>` | Withdraw USDC (owner role) |
| `setPolicy(params): Promise<Hex>` | Set spending policy (owner role) |
| `setAllowlist(to, allowed): Promise<Hex>` | Manage allowlist (owner role) |
| `revokeSession(): Promise<Hex>` | Revoke session key (owner role) |
| `signSpend(params): Promise<SpendAuthorization>` | Sign spend off-chain (agent role, no gas) |
| `relaySpend(auth): Promise<Hex>` | Submit signed spend (relayer role, pays gas) |

### SpendAuthorization

```ts
interface SpendAuthorization {
  owner: string
  to: string
  amount: string           // human USDC
  amountAtomic: string     // atomic units (bigint as string)
  nonce: string
  deadline: number         // unix seconds
  signature: Hex           // EIP-712 signature
}
```

---

## Error types

### ChainPePaymentError

Thrown when an x402 payment fails on-chain.

```ts
class ChainPePaymentError extends Error {
  readonly txHash?: string
  readonly reason?: string  // e.g. 'settlement_rejected'
}
```

---

## Network utilities

```ts
import { publicClientFor, getUsdcAddress, rpcUrlFor, USDC_DECIMALS } from '@chainpeavax/sdk'

const client = publicClientFor('avalanche')  // viem PublicClient
const usdc = getUsdcAddress('avalanche')     // '0xB97E...6a6E'
const rpc = rpcUrlFor('avalanche')           // 'https://api.avax.network/ext/bc/C/rpc'
const decimals = USDC_DECIMALS          // 6
```

---

## ChainPeService type

```ts
interface ChainPeService {
  id: string               // 'developer:name'
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string  // human USDC
  paymentToken: 'USDC'
  walletAddress: string    // the payTo address
  network: ChainPeNetwork
  developer: string        // registrant wallet address
  agentId?: string         // ERC-8004 agent id if linked
  createdAt?: string
  updatedAt?: string
}
```
