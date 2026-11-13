---
id: security-audit-checklist
title: Audit Checklist
sidebar_position: 3
---

# Audit Checklist

Pre-audit readiness status and known risk areas. See `contracts/SECURITY.md` in the repository for the full security notes and Slither triage.

## Access control inventory

| Contract | Privileged role | Functions |
|---|---|---|
| ChainPeRegistry | Owner (`Ownable2Step`) | `pause`, `unpause`, `setRegistrationFee`, `setUpdateFee`, `setFeeRecipient`, `setFeeToken`, `setIdentityRegistry`, `ownerWithdraw` |
| PolicyVault | Contract owner (deployer) | `pause`, `unpause` |
| PolicyVault | Vault owner (any address) | `deposit`, `withdraw`, `setPolicy`, `setAllowlist`, `revokeSession` |
| PolicyVault | Session key holder | signs `Spend` (no on-chain function, just signing) |
| PolicyVault | Any relayer | `spend` (submits signed authorization) |
| PolicyVault | Any address | `cleanupDailySpent` (gas reclaim, no funds moved) |
| ChainPeICMReceiver | Owner | `setTrustedSender` |
| ChainPeICMReceiver | Teleporter messenger only | `receiveTeleporterMessage` |
| ERC-8004 registries | Owner | Upgrade authorization (`_authorizeUpgrade`) |

## Known risk areas

### Critical
- None identified post-audit. See `contracts/SECURITY.md` for the full critical findings resolution.

### High
- Facilitator gas key compromise: an attacker who obtains the facilitator key cannot steal payer USDC (EIP-3009 is already signed), but can prevent settlement by spending the gas balance. Mitigation: keep the gas key balance minimal (top up in small amounts).
- Registry fee token change race: a `setFeeToken` call while users have pending transactions can cause reverts. Mitigation: pause before changing fee token.

### Medium
- ERC-8004 Sybil reputation: a provider can create multiple buyer wallets to inflate reputation. Gas cost and the single-address-one-identity enforcement partially mitigate this.
- Indexer trustfulness: as noted in the trust model, the indexer is an off-chain cache. Critical operations should read on-chain.

### Low
- PolicyVault `cleanupDailySpent` can be called by anyone; it only deletes past day slots. No funds can be moved. Primarily a gas optimization.
- String field validation in ChainPeRegistry: field lengths are checked (name ≤ 64, description ≤ 1024, etc.), but Unicode vs. byte counting: `bytes(input.name).length` counts bytes, not characters. Providers with multi-byte UTF-8 names may hit the limit unexpectedly.

## Static analysis

Slither and Aderyn (where applicable) are run as part of the CI pipeline. The output is recorded in `contracts/SECURITY.md`. The contracts had zero error-level findings at the time of audit submission.

## Fuzzing

:::note
Property-based fuzzing (e.g. Echidna) is not yet set up. This is a planned improvement before mainnet launch.
:::

## Upgrade safety

For upgradeable contracts:
- Storage layouts are documented in each contract and must not be reordered between upgrades
- `_authorizeUpgrade` is restricted to the owner (multisig on mainnet)
- New implementations must be independently reviewed before deployment
- A timelock on upgrades is recommended for mainnet (not yet implemented)
