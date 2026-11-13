---
id: policy-vaults
title: Policy Vaults
sidebar_position: 4
---

# Policy Vaults

`PolicyVault.sol` is a programmable, gasless spending contract that lets owners set on-chain limits for agent payments in USDC. Every constraint is enforced by the Avalanche chain — an over-cap or non-allowlisted attempt reverts, not a backend check.

## The problem PolicyVault solves

An autonomous agent with a private key can spend all its USDC. If that key leaks, or if the agent's LLM makes unexpected decisions, funds can be drained. Traditional solutions (rate limiting in middleware, server-side caps) can be bypassed or spoofed.

PolicyVault moves the enforcement on-chain:

- The **owner** (you, a multisig, or a smart contract) deposits USDC and sets the policy
- The **agent** holds a session key and signs spend authorizations off-chain (no gas)
- A **relayer** submits signed authorizations and pays gas
- The **chain** enforces every constraint before releasing funds

## Three roles

```
Owner (you)
  ├── deposit() USDC into the vault
  ├── setPolicy(sessionKey, maxPerCall, dailyCap, totalBudget, expiry, allowlistOnly)
  ├── setAllowlist(address, true/false)
  └── revokeSession()

Agent (session key)
  └── signSpend(owner, to, amount, ttlSeconds)  → SpendAuthorization (no gas)

Relayer (facilitator or anyone)
  └── relaySpend(auth)  → submits to PolicyVault.spend(), pays gas
```

## Policy parameters

| Parameter | Type | Description |
|---|---|---|
| `sessionKey` | `address` | The agent's address (EOA). Signs spend authorizations. |
| `maxPerCall` | `uint256` | Maximum USDC per single spend, in atomic units (6 decimals) |
| `dailyCap` | `uint256` | Maximum USDC per UTC day |
| `totalBudget` | `uint256` | Lifetime cap for this session. Reset when `setPolicy` is called again. |
| `expiry` | `uint64` | Unix timestamp after which the session is invalid |
| `allowlistOnly` | `bool` | If true, `to` address must be in the owner's allowlist |

## Spend authorization: EIP-712

The agent signs a typed data message (EIP-712) off-chain:

```ts
{
  domain: {
    name: 'ChainPePolicyVault',
    version: '1',
    chainId: 43114,           // Avalanche C-Chain mainnet
    verifyingContract: '0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8' // PolicyVault address
  },
  types: {
    Spend: [
      { name: 'owner', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  },
  message: {
    owner: '0xOwnerAddress',
    to: '0xProviderWallet',
    amount: 100000n,           // 0.10 USDC
    nonce: 5n,                 // must match on-chain nonces[owner]
    deadline: 1718005000       // unix timestamp
  }
}
```

The relayer calls `PolicyVault.spend(owner, to, amount, deadline, sessionSig)`. The contract verifies the signature matches the session key, then checks every policy constraint before transferring USDC.

## Using PolicyVaultClient

The `@chainpeavax/sdk` package ships a `PolicyVaultClient`:

```ts
import { PolicyVaultClient } from '@chainpeavax/sdk'

// Owner: set up the vault
const owner = new PolicyVaultClient({
  privateKey: process.env.OWNER_KEY!,
  network: 'avalanche',
  vaultAddress: '0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8'
})

// Deposit 10 USDC (approve the vault first)
await owner.deposit('10.00')

// Set policy: agent can spend up to 0.10/call, 2/day, 20 total, expires in 7 days
await owner.setPolicy({
  sessionKey: '0xAgentAddress',
  maxPerCall: '0.10',
  dailyCap: '2.00',
  totalBudget: '20.00',
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  allowlistOnly: false
})

// Add a specific provider to the allowlist (optional)
await owner.setAllowlist('0xProviderWallet', true)
```

```ts
// Agent: sign a spend (no gas)
const agent = new PolicyVaultClient({
  privateKey: process.env.AGENT_SESSION_KEY!,
  network: 'avalanche',
  vaultAddress: '0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8'
})

const auth = await agent.signSpend({
  owner: '0xOwnerAddress',
  to: '0xProviderWallet',
  amount: '0.05',
  ttlSeconds: 300   // authorization valid for 5 minutes
})

// Relayer: submit the signed authorization (pays gas)
const relayer = new PolicyVaultClient({
  privateKey: process.env.RELAYER_KEY!,
  network: 'avalanche',
  vaultAddress: '0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8'
})

const txHash = await relayer.relaySpend(auth)
console.log('Settled:', txHash)
```

## On-chain enforcement

The `spend()` function checks all of these before transferring USDC, and reverts with a clear reason string if any fails:

```
"session inactive"        — policy not set or revokeSession() called
"session expired"         — block.timestamp > expiry
"auth expired"            — block.timestamp > deadline (from the signed authorization)
"over per-call cap"       — amount > maxPerCall
"insufficient vault balance" — balanceOf[owner] < amount
"over total budget"       — totalSpent[owner] + amount > totalBudget
"over daily cap"          — dailySpent[owner][today] + amount > dailyCap
"recipient not allowlisted" — allowlistOnly && !allowlist[owner][to]
"bad session sig"         — ECDSA.recover != sessionKey
```

## Checking spend feasibility

Before signing, the agent can simulate whether a spend would succeed:

```ts
const publicClient = /* viem public client for Avalanche C-Chain mainnet */
const [ok, reason] = await publicClient.readContract({
  address: vaultAddress,
  abi: PolicyVaultAbi,
  functionName: 'previewSpend',
  args: [ownerAddress, providerAddress, amountAtomic]
})
if (!ok) console.error('Spend would fail:', reason)
```

## Revoking a session

The owner can revoke the session key at any time:

```ts
await owner.revokeSession()
// All subsequent spend() calls will revert with "session inactive"
```

## Checking remaining budget

```ts
const daily = await owner.dailyRemaining('0xOwnerAddress')  // USDC remaining today
const budget = await owner.budgetRemaining('0xOwnerAddress') // USDC left in lifetime budget
```
