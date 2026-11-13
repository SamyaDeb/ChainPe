---
id: merchant-registration
title: Service Registration
sidebar_position: 2
---

# Service Registration

Registering your service on `ChainPeRegistry` makes it discoverable by agents through `cp.discover()`, the CLI's `chainpe discover`, and the marketplace dashboard.

## Prerequisites

- A funded Avalanche C-Chain wallet — receives USDC payments
- 0.1 USDC (the registration fee; current fee is 0.1 USDC on mainnet)
- Your service running and accessible at a public URL (or `localhost` for testing)

## Option A: CLI (recommended)

### Step 1 — Initialize

```bash
chainpe init
```

The wizard prompts for:
- **API URL** — your backend URL (e.g. `http://localhost:3000`)
- **Service name** — displayed in the marketplace (min 3 chars)
- **Description** — at least 10 characters, shown in discovery results
- **Tags** — comma-separated keywords for search (e.g. `ai,research,documents`)
- **Price per request** — human-readable USDC (e.g. `0.01`)
- **Network** — `avalanche` (mainnet) or `fuji` (testnet)
- **Wallet address** — where to receive payments (0x... EVM address)
- **Proxy port** — default `4402`

Config is saved to `~/.chainpe/config.json`.

### Step 2 — Start the proxy

```bash
chainpe start
```

This starts the x402 proxy on the configured port. Test it:

```bash
curl http://localhost:4402/any-path
# Should return: 402 Payment Required
```

### Step 3 — Register on-chain

```bash
chainpe register
```

Choose between:
- **Browser wallet (MetaMask / Core)** — opens a browser window to sign the transaction
- **Paste private key** — signs in the terminal and auto-mints an ERC-8004 identity

The CLI will:
1. Check if an ERC-8004 identity token exists for your wallet
2. If not, mint one (auto-links your service to a reputation identity)
3. Approve the USDC registration fee to the registry
4. Call `ChainPeRegistry.register(ServiceInput)`
5. Show the Snowtrace explorer link for the transaction

## Option B: register-seller.mjs (non-interactive)

For CI/CD or scripted registration:

```bash
SELLER_KEY=0x...
SELLER_NAME="My Research Agent"
SELLER_ENDPOINT=https://api.example.com
SELLER_PAYTO=0xYourWalletAddress
SELLER_DESCRIPTION="AI-powered research and summarization"
SELLER_TAGS=ai,research,summarization
SELLER_PRICE=0.01
CHAINPE_NETWORK=avalanche
CHAINPE_REGISTRY_ADDRESS=0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E

node register-seller.mjs
```

The script automatically mints an ERC-8004 identity if `SELLER_AGENT_ID` is not set.

## Option C: Direct contract call (TypeScript)

```ts
import { createWalletClient, createPublicClient, http, parseUnits, getAddress } from 'viem'
import { avalanche } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const REGISTRY_ADDRESS = '0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E'
const USDC_MAINNET = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'input',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'tags', type: 'string' },
        { name: 'endpoint', type: 'string' },
        { name: 'pricePerRequest', type: 'string' },
        { name: 'paymentToken', type: 'string' },
        { name: 'network', type: 'string' },
        { name: 'payTo', type: 'address' },
        { name: 'agentId', type: 'uint256' }
      ]
    }],
    outputs: [{ name: 'key', type: 'bytes32' }]
  }
] as const

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const

const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY')
const wallet = createWalletClient({ account, chain: avalanche, transport: http() })

// Step 1: Approve 0.1 USDC registration fee
await wallet.writeContract({
  account,
  chain: avalanche,
  address: USDC_MAINNET,
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [REGISTRY_ADDRESS, parseUnits('0.1', 6)]  // 0.1 USDC
})

// Step 2: Register the service
const txHash = await wallet.writeContract({
  account,
  chain: avalanche,
  address: REGISTRY_ADDRESS,
  abi: REGISTRY_ABI,
  functionName: 'register',
  args: [{
    name: 'My Research Agent',
    description: 'AI-powered research and summarization service',
    tags: 'ai,research,summarization',
    endpoint: 'https://api.example.com',
    pricePerRequest: '0.01',
    paymentToken: 'USDC',
    network: 'avalanche',
    payTo: getAddress('0xYourWalletAddress'),
    agentId: 0n    // 0 = no ERC-8004 identity linked
  }]
})

console.log('Registered! Tx:', txHash)
```

## ServiceInput fields

| Field | Type | Max length | Description |
|---|---|---|---|
| `name` | string | 64 bytes | Unique per developer; becomes part of the storage key |
| `description` | string | 1024 bytes | Shown in discovery results |
| `tags` | string | 256 bytes | Comma-separated keywords |
| `endpoint` | string | 256 bytes | Public URL where clients connect |
| `pricePerRequest` | string | 32 bytes | Human-readable USDC (e.g. `"0.01"`) |
| `paymentToken` | string | — | `"USDC"` or `"AVAX"` |
| `network` | string | — | `"avalanche"` (mainnet) or `"fuji"` (testnet) |
| `payTo` | address | — | Where to receive payments |
| `agentId` | uint256 | — | ERC-8004 agent identity; `0` if not linked |

## Updating a service

Call `chainpe register` again — the CLI detects an existing registration and calls `ChainPeRegistry.update(ServiceInput)` instead of `register`. The update fee is currently 0 (free updates).

## Deregistering

```bash
chainpe deregister
```

This calls `ChainPeRegistry.deregister(name)` from your wallet. The service is removed from the on-chain registry and will no longer appear in discovery results.
