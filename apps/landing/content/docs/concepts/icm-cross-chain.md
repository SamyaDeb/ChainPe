---
id: icm-cross-chain
title: ICM Cross-Chain Payments
sidebar_position: 5
---

# ICM Cross-Chain Payments

Avalanche Interchain Messaging (ICM), built on the Teleporter protocol, enables agents on one Avalanche L1 to hire services on another. `ChainPeICMSender` and `ChainPeICMReceiver` implement cross-subnet payment intents for ChainPe.

## What is Avalanche ICM?

Avalanche ICM (formerly Teleporter) is a native cross-subnet messaging protocol. Unlike bridges that lock and mint tokens, ICM sends arbitrary messages between Avalanche L1s (subnets) with cryptographic authenticity guaranteed by the Avalanche validator set. No third-party bridge operator, no lock-up period.

The Teleporter messenger contract is deployed at the same address on every Avalanche L1 (identical on mainnet and Fuji testnet):
- `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf`

## ChainPe ICM contracts

### ChainPeICMSender

Deployed on the source L1 (where the buyer agent lives). Sends a payment intent message via Teleporter to the destination L1.

```solidity
function sendPaymentIntent(
    bytes32 destinationBlockchainID,
    address receiverContract,
    bytes32 serviceId,
    address payTo,
    uint256 amount,
    address buyer
) external payable
```

### ChainPeICMReceiver

Deployed on the destination L1 (where the service lives). Receives the Teleporter message and records the intent.

```solidity
function receiveTeleporterMessage(
    bytes32 sourceBlockchainID,
    address originSenderAddress,
    bytes calldata message
) external
```

The receiver:
1. Verifies `msg.sender == messenger` (the Teleporter contract) — only real Teleporter messages accepted
2. Optionally verifies `originSenderAddress` matches the registered trusted sender
3. Decodes `(serviceId, payTo, amount, buyer)` from the message bytes
4. Pushes an `Intent` struct to the `intents` array
5. Emits `CrossChainPaymentIntent`

## Security model

The `msg.sender == messenger` check ensures only the canonical Teleporter contract can deliver messages. The Teleporter protocol guarantees that a message claiming to originate from a given `sourceBlockchainID` and `originSenderAddress` actually did.

For additional defense, the owner can register `trustedSenders`:

```solidity
// Only accept messages from this specific ChainPeICMSender on source chain X
receiver.setTrustedSender(sourceBlockchainID, senderContractAddress)
```

Once set, any message from an unexpected sender on that chain is rejected.

## Intent structure

```solidity
struct Intent {
    bytes32 sourceBlockchainID;
    address originSender;     // ChainPeICMSender on the source L1
    address buyer;            // who initiated the intent on the source L1
    address payTo;            // provider payment address
    uint256 amount;           // USDC amount in atomic units
    bytes32 serviceId;        // ChainPeRegistry service key
}
```

Intents are stored in an array (`intents[]`) on the receiver. An off-chain relayer or service then processes them — executing the actual USDC transfer or service delivery.

## Deployment status

:::note
ICM contracts are deployed on mainnet (`ChainPeICMSender` at `0x097D7D4B46CB894142a72E91c3b8F8b5834255dF`, `ChainPeICMReceiver` at `0xc8aBD919F597C46dA889e76704F69A2809cd6D33`) but the cross-L1 flow requires a second Avalanche L1 to be live. A full end-to-end demo of cross-L1 agent hiring is planned. The contracts and tests are complete.
:::

The ICM test (`contracts/test/ChainPeICM.test.ts`) uses a `MockTeleporterMessenger` to simulate message delivery.

## Why this matters

Today, an agent on Avalanche C-Chain can hire a service also on C-Chain. With ICM, an agent on a specialized Avalanche L1 (e.g. a gaming subnet, a DeFi subnet, a private enterprise L1) can hire a service on C-Chain — or vice versa — without bridging tokens or trusting an intermediary. The agent economy spans the entire Avalanche ecosystem.

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
