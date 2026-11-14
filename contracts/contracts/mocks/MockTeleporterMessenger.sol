// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    ITeleporterMessenger,
    ITeleporterReceiver,
    TeleporterMessageInput
} from "../icm/ITeleporter.sol";

/**
 * @notice Test-only Teleporter messenger. Simulates Avalanche ICM by immediately
 * delivering each sent message to the destination receiver (as the relayer
 * would), calling back as `msg.sender` so the receiver's auth check passes.
 * NOT for production — clearly named, used only in tests.
 */
contract MockTeleporterMessenger is ITeleporterMessenger {
    uint256 public nonce;
    bytes32 public constant MOCK_SOURCE_BLOCKCHAIN_ID =
        keccak256("chainpe-mock-source-l1");

    event MessageSent(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        bytes message
    );

    function sendCrossChainMessage(
        TeleporterMessageInput calldata input
    ) external returns (bytes32 messageID) {
        messageID = keccak256(
            abi.encode(nonce++, input.destinationAddress, input.message)
        );
        emit MessageSent(
            input.destinationBlockchainID,
            input.destinationAddress,
            input.message
        );
        // Simulate relayer delivery on the destination L1. The original caller
        // (the ChainPeICMSender) is the message's origin sender.
        ITeleporterReceiver(input.destinationAddress).receiveTeleporterMessage(
            MOCK_SOURCE_BLOCKCHAIN_ID,
            msg.sender,
            input.message
        );
    }

    /// @notice Test helper: deliver `message` to `destination` as if relayed from
    /// `sourceBlockchainID` / `originSender`. Lets tests exercise untrusted chains and senders.
    function deliver(
        bytes32 sourceBlockchainID,
        address originSender,
        address destination,
        bytes calldata message
    ) external {
        ITeleporterReceiver(destination).receiveTeleporterMessage(sourceBlockchainID, originSender, message);
    }
}
