---
id: smart-contracts-icm-receiver
title: ChainPeICMReceiver
sidebar_position: 4
---

# ChainPeICMReceiver

Receives ChainPe payment intents from another Avalanche L1 over ICM (Teleporter).

**Solidity:** `contracts/contracts/icm/ChainPeICMReceiver.sol`
**Inherits:** `ITeleporterReceiver`, `Ownable`

**Mainnet receiver address:** [`0xc8aBD919F597C46dA889e76704F69A2809cd6D33`](https://snowtrace.io/address/0xc8aBD919F597C46dA889e76704F69A2809cd6D33)
**Mainnet sender address:** [`0x097D7D4B46CB894142a72E91c3b8F8b5834255dF`](https://snowtrace.io/address/0x097D7D4B46CB894142a72E91c3b8F8b5834255dF)

## State variables

| Variable | Type | Description |
|---|---|---|
| `messenger` | `address` (`immutable`) | The local Teleporter messenger. Only this address can call `receiveTeleporterMessage`. |
| `trustedSenders` | `mapping(bytes32 => address)` | Per-source-chain trusted ChainPeICMSender addresses. Zero = accept any sender. |

## Intents are event-sourced

Received payment intents are **not** stored in contract storage. Every delivered
intent is emitted as a `CrossChainPaymentIntent` event carrying the full payload.
Off-chain consumers (indexers, dashboards) should read that event log. This keeps
the per-message cost to a single LOG instead of ~6 cold storage writes.

## Functions

### `setTrustedSender(bytes32 sourceBlockchainID, address sender)`

Registers the trusted ChainPeICMSender for a source chain. Only owner.

Set to `address(0)` to accept any sender from that chain again.

**Events:** `TrustedSenderSet(sourceBlockchainID, sender)`

### `receiveTeleporterMessage(bytes32 sourceBlockchainID, address originSenderAddress, bytes message)`

Called by the Teleporter messenger when a message arrives.

**Access:** Only `messenger` (the Teleporter contract). Reverts with `"only teleporter"` otherwise.

**Flow:**
1. Verifies `msg.sender == messenger`
2. If `trustedSenders[sourceBlockchainID] != address(0)`, verifies `originSenderAddress` matches
3. Decodes `message` as `(bytes32 serviceId, address payTo, uint256 amount, address buyer)`
4. Emits `CrossChainPaymentIntent`

## Events

```solidity
event CrossChainPaymentIntent(
    bytes32 indexed sourceBlockchainID,
    address indexed buyer,
    address indexed payTo,
    uint256 amount,
    bytes32 serviceId,
    address originSender
);

event TrustedSenderSet(bytes32 indexed sourceBlockchainID, address indexed sender);
```

## Message encoding

Messages are ABI-encoded as:
```solidity
abi.encode(bytes32 serviceId, address payTo, uint256 amount, address buyer)
```

The sender (`ChainPeICMSender`) encodes; the receiver decodes.

## Teleporter messenger addresses

| Network | Address |
|---|---|
| **Avalanche mainnet** | `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` |
| Fuji testnet (reference) | `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` |
