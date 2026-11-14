// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainPeTeleporterReceiverBase} from "./ChainPeTeleporterReceiverBase.sol";

/**
 * @title ChainPeICMReceiver
 * @notice Receives ChainPe payment intents from another Avalanche L1 over ICM
 * (Teleporter) and emits them. Deployed on the L1 where the service lives.
 *
 * @dev Fail closed: only the local Teleporter messenger may call, and only
 * messages from the registered `trustedSenders[sourceBlockchainID]` are accepted.
 * A source chain with no trusted sender is rejected (see ChainPeTeleporterReceiverBase).
 *
 * Intents are NOT stored on-chain. Every delivered intent is emitted as a
 * `CrossChainPaymentIntent` event carrying the full payload, so off-chain
 * consumers index that event. Payload: abi.encode(serviceId, payTo, amount, buyer).
 */
contract ChainPeICMReceiver is ChainPeTeleporterReceiverBase {
    event CrossChainPaymentIntent(
        bytes32 indexed sourceBlockchainID,
        address indexed buyer,
        address indexed payTo,
        uint256 amount,
        bytes32 serviceId,
        address originSender
    );

    constructor(address messenger_) ChainPeTeleporterReceiverBase(messenger_) {}

    function _handleMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) internal override {
        (bytes32 serviceId, address payTo, uint256 amount, address buyer) = abi.decode(
            message,
            (bytes32, address, uint256, address)
        );
        emit CrossChainPaymentIntent(sourceBlockchainID, buyer, payTo, amount, serviceId, originSenderAddress);
    }
}
