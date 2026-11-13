---
id: security-trust-model
title: Trust Model
sidebar_position: 2
---

# Trust Model

## EIP-3009 (standard x402 flow)

**Agent → Facilitator trust**: The agent signs a USDC `transferWithAuthorization` specifying exact `from`, `to`, `value`, `validBefore`, and a random nonce. The facilitator relays this authorization to the USDC contract. The USDC contract verifies the signature independently.

What the facilitator **can** do:
- Delay submission until after `validBefore` (authorization expires, no payment)
- Choose not to submit (the call is never paid)

What the facilitator **cannot** do:
- Redirect funds to a different address
- Transfer more than the signed amount
- Reuse a nonce (USDC contract tracks used nonces)
- Forge a signature

**Mitigation for delay attacks**: Authorization validity windows are short (default 5 minutes in the SDK). If the facilitator delays past `validBefore`, the payment fails and the client can retry with a fresh signature. Use the hosted facilitator for convenience, run your own for maximum reliability.

## PolicyVault

**Owner → PolicyVault trust**: The owner sets policy parameters and deposits USDC. The vault is a Solidity contract with no admin overrides — not even the contract owner (the deployer) can bypass the spending constraints.

**Agent → PolicyVault trust**: The agent signs EIP-712 data off-chain. The signature is single-use (nonce). If the session key leaks, the owner can call `revokeSession()` and the key cannot spend further.

**Relayer → PolicyVault trust**: The relayer submits `spend()` and pays gas. The relayer cannot steal funds — the contract enforces the signed parameters and transfers only to the `to` address in the signature.

**What the relayer can do**:
- Delay submission until after `deadline` (authorization expires)
- Front-run the nonce (submit a different pending authorization first) — mitigated by using short deadlines and single-pending-auth flows

## ChainPeRegistry

**Service listings**: Only `msg.sender` who registered can update or deregister. The service's `developer` field is permanently `msg.sender` at registration time — it cannot be changed.

**Fee collection**: `registrationFee` is pulled with `safeTransferFrom`, so the caller must explicitly approve first. The fee goes directly to `feeRecipient`, not held in the contract.

**Owner powers**: The contract owner can pause/unpause, change fees and fee recipient, change the fee token, and rescue accidentally sent tokens. The owner cannot steal registered service fees (they go directly to `feeRecipient` on registration), deregister services on behalf of developers, or modify service records.

## Indexer

**Trust level**: Low. The indexer is an off-chain process. It may lag behind the chain, have bugs in event parsing, or serve stale cached data. It is correct under normal operation but should not be trusted for critical path decisions. For any decision involving significant funds (e.g. approving a large USDC transfer), verify the relevant state on-chain.

## ERC-8004 Reputation

**Self-feedback blocking**: The `ReputationRegistry` reverts if the feedback poster's wallet matches the `agentId`'s owner. However, a provider could create a separate wallet to post fake high scores. The contract does not prevent Sybil attacks.

**Mitigation**: ERC-8004 feedback requires an on-chain transaction that costs gas. Spamming fake reputation is economically disincentivized. Future ValidationRegistry integrations could require verified identities.

## Admin key management

The deployer key (`0x8cC8dADfAd2D39659314106bAf4Da10B3BA38A36`) currently owns the mainnet contracts. This is a temporary state — ownership should be transferred to a Gnosis Safe multisig before significant TVL accumulates:
- Transfer to a Gnosis Safe multisig using the two-step `Ownable2Step` pattern — the new owner must call `acceptOwnership()`, preventing accidental loss
- The facilitator gas key is separate from the registry owner key and should also be rotated periodically
- Until the multisig transfer is complete, the deployer key is the single point of trust for contract upgrades

## USDC allowance risks

When calling `register()`, users must approve the registry for at least `registrationFee` USDC. If the owner changes the fee token via `setFeeToken()` while a user has a pending approval on the old token:
- The user's approval on the old token is worthless for future calls
- Users must re-approve the new token
- The recommended mitigation: `pause()` the registry, announce the fee token change, then `unpause()` after users re-approve

## Reentrancy

All state-changing functions that interact with external contracts use the `nonReentrant` modifier. The `_collectFee()` internal follows checks-effects-interactions (update storage, then transfer).
