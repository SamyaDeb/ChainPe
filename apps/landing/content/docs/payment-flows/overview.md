---
id: payment-flows-overview
title: Payment Flows
sidebar_position: 1
---

# Payment Flows

ChainPe supports two payment paths. Both settle on Avalanche C-Chain in USDC; they differ in who signs what and who pays gas.

## Standard x402 flow (EIP-3009)

The most common path. The agent wallet signs a USDC `transferWithAuthorization` and the facilitator submits it on-chain:

1. **Initiation** — agent sends request; server returns 402 with payment requirements
2. **Signing** — agent signs an EIP-3009 authorization off-chain (no gas)
3. **Settlement** — facilitator submits the signed authorization; Avalanche confirms in ~1-2s
4. **Response** — server returns 200 with `X-PAYMENT-RESPONSE` header

[Full initiation details →](./initiation.md)

## PolicyVault flow (EIP-712)

For agents that operate under an owner-defined spending policy:

1. **Funding** — owner deposits USDC into PolicyVault and sets a policy
2. **Signing** — agent signs an EIP-712 `Spend` authorization off-chain (no gas)
3. **Relay** — relayer submits `PolicyVault.spend()` and pays gas
4. **On-chain enforcement** — contract checks all policy constraints before transferring

[PolicyVault concept →](../concepts/policy-vaults.md)

## Cross-chain ICM flow

For agents on one Avalanche L1 hiring services on another:

1. **Intent** — agent calls `ChainPeICMSender.sendPaymentIntent()` on source L1
2. **Teleporter delivery** — ICM relays the message to destination L1 (~seconds)
3. **Receipt** — `ChainPeICMReceiver.receiveTeleporterMessage()` records the intent
4. **Settlement** — off-chain relayer or destination service processes the intent

[ICM concept →](../concepts/icm-cross-chain.md)
