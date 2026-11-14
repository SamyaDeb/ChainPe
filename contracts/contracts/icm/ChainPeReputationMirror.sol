// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainPeTeleporterReceiverBase} from "./ChainPeTeleporterReceiverBase.sol";

/**
 * @title ChainPeReputationMirror
 * @notice Read-only copy, on another Avalanche L1, of the payment-verified
 * reputation that ChainPeReputationOracle holds on the C-Chain. An agent on this
 * L1 calls `getReputation(payTo)` before hiring a service.
 *
 * Updates arrive over ICM (Teleporter) from the trusted ChainPeICMSender on the
 * source chain (fail closed, see ChainPeTeleporterReceiverBase). An update whose
 * `sourceTimestamp` (the oracle's `updatedAt`) is not newer than the stored one
 * is rejected, so a delayed or replayed message can never roll a score back.
 *
 * Payload: abi.encode(uint8 version, address payTo, uint256 agentId,
 *                     uint8 paidScore, uint32 paidReviews, uint64 sourceTimestamp)
 * `agentId` is 0 when the sender did not link the payTo to an ERC-8004 agent.
 */
contract ChainPeReputationMirror is ChainPeTeleporterReceiverBase {
    uint8 public constant PAYLOAD_VERSION = 1;

    struct Reputation {
        uint256 agentId;
        uint8 paidScore; // 0-100
        uint32 paidReviews;
        uint64 sourceTimestamp; // oracle updatedAt on the source chain
        uint64 receivedAt; // block.timestamp on this chain
        bytes32 sourceBlockchainID;
    }

    mapping(address => Reputation) private _reputation;

    event ReputationMirrored(
        address indexed payTo,
        uint256 indexed agentId,
        uint8 paidScore,
        uint32 paidReviews,
        uint64 sourceTimestamp,
        bytes32 indexed sourceBlockchainID
    );

    error UnsupportedVersion(uint8 version);
    error StaleUpdate(address payTo, uint64 sourceTimestamp, uint64 storedTimestamp);
    error ZeroPayTo();

    constructor(address messenger_) ChainPeTeleporterReceiverBase(messenger_) {}

    function _handleMessage(
        bytes32 sourceBlockchainID,
        address,
        bytes calldata message
    ) internal override {
        (uint8 version, address payTo, uint256 agentId, uint8 paidScore, uint32 paidReviews, uint64 sourceTimestamp) =
            abi.decode(message, (uint8, address, uint256, uint8, uint32, uint64));
        if (version != PAYLOAD_VERSION) revert UnsupportedVersion(version);
        if (payTo == address(0)) revert ZeroPayTo();

        Reputation storage r = _reputation[payTo];
        if (sourceTimestamp <= r.sourceTimestamp) revert StaleUpdate(payTo, sourceTimestamp, r.sourceTimestamp);

        r.agentId = agentId;
        r.paidScore = paidScore;
        r.paidReviews = paidReviews;
        r.sourceTimestamp = sourceTimestamp;
        r.receivedAt = uint64(block.timestamp);
        r.sourceBlockchainID = sourceBlockchainID;

        emit ReputationMirrored(payTo, agentId, paidScore, paidReviews, sourceTimestamp, sourceBlockchainID);
    }

    /// @notice The mirrored record. `sourceTimestamp == 0` means nothing has arrived for this payTo.
    function getReputation(address payTo) external view returns (Reputation memory) {
        return _reputation[payTo];
    }
}
