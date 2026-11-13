---
id: security-overview
title: Security Overview
sidebar_position: 1
---

# Security

ChainPe is infrastructure that handles real on-chain USDC payments. This section documents the security model, trust assumptions, and known risk areas.

## Scope of what ChainPe protects

- **Agent funds**: the EIP-3009 signature is exact-amount, exact-recipient. The facilitator cannot steal or redirect signed authorizations.
- **PolicyVault funds**: every constraint is enforced on-chain. The relayer can delay a transaction but cannot exceed any cap.
- **Registry integrity**: only the registrant's wallet can update or deregister their service.
- **Reputation integrity**: self-feedback is blocked on-chain by the ERC-8004 contracts.

## Scope of what ChainPe does NOT protect

- **LLM decisions**: if an agent's LLM is told to pay an attacker, ChainPe signs the payment. Policy caps limit the damage; they do not prevent it.
- **Indexer data freshness**: the indexer is an off-chain cache. During a sync gap, stale data may appear. Always verify critical data on-chain.
- **Facilitator liveness**: if the facilitator is down, payments cannot settle. Run your own facilitator for production.

## Sections

- [Trust Model](./trust-model.md) — detailed trust assumptions per component
- [Audit Checklist](./audit-checklist.md) — pre-audit checklist and access control inventory
