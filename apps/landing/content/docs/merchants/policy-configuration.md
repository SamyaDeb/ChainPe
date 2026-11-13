---
id: merchant-policy-configuration
title: Policy Configuration
sidebar_position: 3
---

# Policy Configuration

PolicyVault lets you (the merchant/operator) set on-chain spending limits for buyers who use your service through a vault. This section covers setting up PolicyVault policies as a provider.

## When to use PolicyVault

PolicyVault is primarily for **buyers** (agents) who want their operator to control spending. As a merchant, you might:
- Run your own agent-as-buyer that has a PolicyVault with your own limits
- Offer a "managed" service where you deploy a vault for customers

See [PolicyVault Concepts](../concepts/policy-vaults.md) for the buyer-side perspective.

## Deploying a PolicyVault

:::note
PolicyVault is deployed on Avalanche C-Chain mainnet at `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`. See `docs/DEPLOYMENTS.md` for all contract addresses.
:::

```bash
cd contracts
npx hardhat run scripts/deploy-policyvault.ts --network avalanche
```

## Configuring a policy via SDK

```ts
import { PolicyVaultClient } from '@chainpeavax/sdk'

const vault = new PolicyVaultClient({
  privateKey: process.env.OWNER_KEY!,
  network: 'avalanche',
  vaultAddress: '0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8'
})

// First: deposit USDC into the vault (approve first)
await vault.deposit('50.00')  // deposit 50 USDC

// Then: set the spending policy for your agent session key
await vault.setPolicy({
  sessionKey: '0xAgentSessionKeyAddress',
  maxPerCall: '0.10',       // max 0.10 USDC per single API call
  dailyCap: '5.00',         // max 5 USDC per day
  totalBudget: '50.00',     // lifetime cap for this session
  expiry: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,  // 30 days
  allowlistOnly: true       // only allow pre-approved recipient addresses
})

// Allowlist the provider addresses your agent is allowed to pay
await vault.setAllowlist('0xProviderWallet1', true)
await vault.setAllowlist('0xProviderWallet2', true)
```

## Monitoring spend

```ts
// Check remaining budget
const daily = await vault.dailyRemaining('0xOwnerAddress')
console.log(`Daily remaining: ${daily} USDC`)

const lifetime = await vault.budgetRemaining('0xOwnerAddress')
console.log(`Lifetime remaining: ${lifetime} USDC`)

// Check vault balance
const balance = await vault.balanceOf('0xOwnerAddress')
console.log(`Vault balance: ${balance} USDC`)
```

## Revoking the session

```ts
await vault.revokeSession()
// All future spend() calls will revert with "session inactive"
```

## Withdrawing unused USDC

```ts
await vault.withdraw('10.00')  // withdraw 10 USDC back to your wallet
```
