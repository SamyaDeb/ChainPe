---
id: payment-settlement
title: Payment Settlement
sidebar_position: 4
---

# Payment Settlement

Settlement is the on-chain phase where USDC moves from the agent's wallet to the provider's wallet. It happens in a single Avalanche transaction submitted by the facilitator.

## Settle endpoint

```
POST https://chainpe-facilitator-production.up.railway.app/settle
Content-Type: application/json

{
  "paymentPayload": { ... signed x402 payload ... },
  "paymentRequirements": { ... offer from 402 ... }
}
```

## What happens on-chain

The facilitator calls `USDC.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` where:

- `from` = agent's wallet address
- `to` = provider's `payTo` address (from the `accepts` offer)
- `value` = the exact amount in atomic units (e.g. `10000` for 0.01 USDC, 6 decimals)
- `validAfter` / `validBefore` = validity window from the signed authorization
- `nonce` = the random bytes32 from the signed authorization
- `v, r, s` = the agent's EIP-3009 signature

The USDC contract on Avalanche supports EIP-3009 (`transferWithAuthorization`) natively.

## Gas

The facilitator's key pays all AVAX gas. The agent never needs AVAX. The gas cost of a `transferWithAuthorization` on Avalanche C-Chain is approximately 60,000–80,000 gas units. At ~25 gwei base fee on mainnet, this is roughly 0.002 AVAX (~$0.001) per settlement — sustainable for the facilitator to subsidize.

## Settlement response

```json
{
  "success": true,
  "transaction": "0xabc123def456...",
  "network": "avalanche"
}
```

The proxy attaches the settlement transaction hash in the `X-PAYMENT-RESPONSE` header:

```
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4YWJjLi4uIn0=
```

## Finality

Avalanche C-Chain uses Snowman consensus, which provides deterministic, single-slot finality. A transaction that is included in a block is final — there are no reorgs. Settlement is typically confirmed in **1–2 seconds** from submission.

This is why PolicyVault's on-chain enforcement is reliable: there is no reorg window to exploit.

## PolicyVault settlement

When using a PolicyVault, settlement is different:

1. The agent signs an EIP-712 `Spend` authorization off-chain
2. A relayer calls `PolicyVault.spend(owner, to, amount, deadline, sig)`
3. The contract verifies the session signature and all policy constraints
4. The contract calls `USDC.safeTransfer(to, amount)` directly from the vault balance

The vault holds USDC on-chain (deposited by the owner via `deposit()`). No EIP-3009 is involved — the vault itself owns the USDC and transfers it directly.

## Prometheus metrics

The facilitator exposes settlement counters at `/metrics`:

```
chainpe_settle_total{result="success"} 42
chainpe_settle_total{result="error"} 1
chainpe_gas_balance_avax{network="avalanche",facilitator="0x8cC8..."} 0.312
```

Monitor these to track settlement health and gas balance.
