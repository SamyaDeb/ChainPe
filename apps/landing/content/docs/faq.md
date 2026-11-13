---
id: faq
title: FAQ
sidebar_position: 10
---

# Frequently Asked Questions

## General

### What is ChainPe?

ChainPe is payment + reputation infrastructure for AI agents on Avalanche. It lets providers monetize any HTTP API per-call in USDC (via the x402 protocol), and lets AI agents discover, pay for, and rate those services autonomously — all on Avalanche C-Chain.

### Is ChainPe custodial?

No. The facilitator is non-custodial. It only relays payer-signed USDC authorizations (EIP-3009) and cannot redirect or steal funds. It only needs AVAX to pay gas. Payer USDC goes directly from the payer's wallet to the provider's wallet.

### What blockchain does ChainPe use?

Avalanche C-Chain. It uses sub-cent gas fees and ~1-2 second deterministic finality, making pay-per-request economics viable. USDC is the payment token (Circle's native USDC on Avalanche, not bridged).

### Is this just for Claude/AI?

No. Claude/MCP is one client. The same payment core drives an SDK (`@chainpeavax/sdk`), Vercel AI SDK tools, LangChain tools, a CLI, and a standalone agent SDK. Any application that can make HTTP requests can use ChainPe.

---

## Payments

### Does the agent need AVAX for gas?

No. The non-custodial facilitator pays AVAX gas on the agent's behalf. The agent only needs USDC in its wallet.

### What is the minimum payment amount?

There is no minimum set in the protocol. In practice, the minimum meaningful amount is 0.000001 USDC (1 atomic unit, 6 decimals). Registration fees and service prices are set by the provider. The current mainnet registration fee is 1 USDC.

### How fast is settlement?

~1-2 seconds on Avalanche C-Chain, which provides single-slot deterministic finality. There are no reorgs.

### What if the facilitator goes down?

Payments cannot settle while the facilitator is down. The agent will receive a `402` after payment (the facilitator could not settle). The agent can retry. For production, run your own facilitator (`chainpe start --facilitator <key>` or deploy `services/chainpe-facilitator`).

### Can I use AVAX instead of USDC?

The primary payment token is USDC. The `paymentToken` field in `ServiceInput` supports `"AVAX"` as a value, but the facilitator currently implements EIP-3009 which is a USDC-specific standard. AVAX payment is declared at the registry level but not fully implemented end-to-end in the current version.

### What is EIP-3009?

EIP-3009 (`transferWithAuthorization`) is a standard for gasless USDC transfers. The token holder signs a message off-chain authorizing a specific transfer (amount, recipient, validity window). A third party submits the signed message on-chain. This is how agents pay without AVAX.

---

## Registry

### How much does it cost to register a service?

The current mainnet registration fee is **1 USDC**. The update fee is **0 USDC** (free updates). These are controlled by the contract owner via `setRegistrationFee()` and can be changed.

### Can I update my service listing after registering?

Yes. Call `chainpe register` again (the CLI detects an existing listing and calls `update()`), or call `ChainPeRegistry.update(ServiceInput)` directly. Updates are currently free (update fee is 0 USDC).

### What is the service key?

Each service is identified by `keccak256(abi.encode(developer, name))`. This is a `bytes32` storage key. The indexer also uses `developer:name` as a human-readable id (e.g. `0xAbc...:My Service`).

### Can multiple providers have the same service name?

Yes — the key includes the developer address. `0xAlice:Weather` and `0xBob:Weather` are distinct listings.

---

## ERC-8004 Reputation

### What is ERC-8004?

A proposed Ethereum standard for portable agent identity and reputation. An IdentityRegistry mints NFT identities; a ReputationRegistry stores scored feedback from counterparties; a ValidationRegistry stores external attestations.

### Can providers inflate their own reputation?

The `ReputationRegistry` blocks self-feedback on-chain: if the feedback poster's address is the same as the identity owner's address, the transaction reverts. A provider would need a separate wallet acting as a fake buyer to post feedback — which costs gas and is detectable.

### Is ERC-8004 finalized?

It is a draft proposal. ChainPe implements the reference contracts and tracks the canonical spec. The contracts may evolve.

### What does a reputation score of 100 mean?

Each feedback call passes a `score` parameter (0-100). A score of 100 is the maximum positive rating. `cp.giveFeedback(agentId, 100)` is posted automatically when `autoFeedback: true`. The aggregate `score` in `ReputationSummary` is the mean of all feedback scores.

---

## PolicyVault

### Who pays gas for PolicyVault `spend()` calls?

The relayer — anyone who calls `PolicyVault.spend()`. The agent only signs the authorization off-chain. This is why agents can operate gaslessly even with PolicyVault.

### What happens if the session key leaks?

Call `revokeSession()` immediately from the owner wallet. After revocation, all future `spend()` calls with that session key revert with `"session inactive"`. The session key cannot move more than the policy allows — an attacker with the session key cannot exceed caps or pay unapproved recipients.

### Can I have multiple active sessions?

No. Each owner has one active `Policy`. Calling `setPolicy()` again replaces the current policy and resets `totalSpent` to zero.

---

## Development

### How do I run the tests?

```bash
# Workspace tests (SDK, ai-tools, etc.)
npm test

# Contract tests (44+ tests)
cd contracts && npm test
```

### Does ChainPe work with OpenAI models?

Yes. `@chainpeavax/ai-tools` wraps the ChainPe SDK as framework-native tools, not model-native tools. The LangChain adapter works with any `ChatModel` including `ChatOpenAI`. The Vercel AI SDK adapter works with any provider that supports tool use.

### Can I run ChainPe completely locally?

Yes. Use:
1. `chainpe start --facilitator <key>` — in-process facilitator (no Railway needed)
2. The SDK reads from Avalanche C-Chain RPC directly for registry/reputation
3. Skip the indexer: use `RegistryClient.listAllServices()` which reads on-chain

For a fully local environment, deploy `MockUSDC` and `ChainPeRegistry` to a local Hardhat node.

### What's the npm scope?

Published packages use the `@chainpeavax` scope: `@chainpeavax/sdk`, `@chainpeavax/ai-tools`, `@chainpeavax/agent`, `@chainpeavax/cli`.
