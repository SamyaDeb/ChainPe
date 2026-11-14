// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    ITeleporterMessenger,
    TeleporterMessageInput,
    TeleporterFeeInfo
} from "./ITeleporter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Read-only views of ChainPeReputationOracle used by the sender.
interface IChainPeReputationOracleView {
    function getEntry(address payTo) external view returns (uint8 score, uint32 paidReviews, uint64 updatedAt);
}

/// Read-only view of ChainPeRegistryUpgradeable (v2) used to link a payTo to its ERC-8004 agentId.
interface IChainPeRegistryView {
    struct Service {
        string name;
        string description;
        string tags;
        string endpoint;
        string pricePerRequest;
        string paymentToken;
        string network;
        address payTo;
        address developer;
        uint256 agentId;
        uint64 createdAt;
        uint64 updatedAt;
        bool exists;
    }

    function getServiceByKey(bytes32 key) external view returns (Service memory);
}

/**
 * @title ChainPeICMSender
 * @notice Sends a ChainPe payment intent from one Avalanche L1 to a
 * {ChainPeICMReceiver} on another L1, over Avalanche Interchain Messaging (ICM /
 * Teleporter). This lets an agent living on its own L1 hire a service registered
 * on the C-Chain (or any other L1) without leaving Avalanche.
 *
 * The intent is the cross-chain trigger; settlement still happens in USDC via
 * x402 on the destination. The payload is `(serviceId, payTo, amount, buyer)`.
 *
 * @dev Relayer fee: on mainnet a Teleporter message is only delivered if a
 * relayer is incentivized. Pass a non-zero `feeToken`/`feeAmount` to attach a
 * fee — the sender pulls it from the caller (who must approve this contract) and
 * forwards the allowance to the messenger. Passing `feeAmount = 0` keeps the
 * legacy free path (only delivered if a relayer relays gratis).
 *
 * Reputation: `sendReputation` / `sendServiceReputation` read the provider's
 * payment-verified score from ChainPeReputationOracle on THIS chain and send it
 * to a ChainPeReputationMirror on another L1. They are permissionless because
 * the data comes from the oracle, not the caller; the mirror rejects anything
 * not newer than what it already holds. Relayer fee is 0 (free relay path).
 */
contract ChainPeICMSender {
    using SafeERC20 for IERC20;

    ITeleporterMessenger public immutable messenger;
    /// ChainPeReputationOracle on this chain (address(0) disables reputation sends).
    IChainPeReputationOracleView public immutable oracle;
    /// ChainPe registry on this chain (address(0) disables sendServiceReputation).
    IChainPeRegistryView public immutable registry;

    /// Gas the mirror may use per update (2 cold SSTOREs + decode + event ≈ 70k; 2x headroom).
    uint256 public constant REPUTATION_GAS_LIMIT = 150_000;
    uint8 public constant REPUTATION_PAYLOAD_VERSION = 1;

    event PaymentIntentSent(
        bytes32 indexed destinationBlockchainID,
        address indexed destinationAddress,
        bytes32 indexed serviceId,
        address payTo,
        uint256 amount,
        bytes32 messageID
    );

    event ReputationSent(
        bytes32 indexed destinationBlockchainID,
        address indexed destinationAddress,
        address indexed payTo,
        uint256 agentId,
        uint8 paidScore,
        uint32 paidReviews,
        uint64 sourceTimestamp,
        bytes32 messageID
    );

    error NoOracle();
    error NoRegistry();
    error NoScore(address payTo);

    constructor(address messenger_, address oracle_, address registry_) {
        require(messenger_ != address(0), "messenger=0");
        messenger = ITeleporterMessenger(messenger_);
        oracle = IChainPeReputationOracleView(oracle_);
        registry = IChainPeRegistryView(registry_);
    }

    /**
     * @notice Send a payment intent to a receiver on another L1.
     * @param destinationBlockchainID the destination Avalanche L1 (blockchain id)
     * @param destinationAddress the {ChainPeICMReceiver} on that L1
     * @param serviceId the ChainPe service being hired
     * @param payTo the service's payout address (on the destination L1)
     * @param amount USDC amount (atomic) the buyer commits to pay
     * @param requiredGasLimit gas the receiver may use to process the message
     * @param feeToken ERC-20 used to pay the relayer (address(0) when feeAmount=0)
     * @param feeAmount relayer fee, pulled from msg.sender (0 = no fee)
     */
    function sendPaymentIntent(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        bytes32 serviceId,
        address payTo,
        uint256 amount,
        uint256 requiredGasLimit,
        address feeToken,
        uint256 feeAmount
    ) external returns (bytes32 messageID) {
        if (feeAmount > 0) {
            require(feeToken != address(0), "feeToken=0");
            // Pull the fee from the caller and grant the messenger an allowance
            // for exactly this fee (forceApprove resets any stale allowance).
            IERC20(feeToken).safeTransferFrom(msg.sender, address(this), feeAmount);
            IERC20(feeToken).forceApprove(address(messenger), feeAmount);
        }

        bytes memory payload = abi.encode(serviceId, payTo, amount, msg.sender);

        messageID = messenger.sendCrossChainMessage(
            TeleporterMessageInput({
                destinationBlockchainID: destinationBlockchainID,
                destinationAddress: destinationAddress,
                feeInfo: TeleporterFeeInfo({feeTokenAddress: feeToken, amount: feeAmount}),
                requiredGasLimit: requiredGasLimit,
                allowedRelayerAddresses: new address[](0),
                message: payload
            })
        );

        emit PaymentIntentSent(
            destinationBlockchainID,
            destinationAddress,
            serviceId,
            payTo,
            amount,
            messageID
        );
    }

    /**
     * @notice Send the oracle's current record for `payTo` to a mirror on another L1.
     * @dev agentId is sent as 0 (unlinked). Use sendServiceReputation to include it.
     */
    function sendReputation(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        address payTo
    ) external returns (bytes32 messageID) {
        return _sendReputation(destinationBlockchainID, destinationAddress, payTo, 0);
    }

    /**
     * @notice Same as sendReputation, with payTo and agentId taken from the registry entry `serviceKey`.
     */
    function sendServiceReputation(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        bytes32 serviceKey
    ) external returns (bytes32 messageID) {
        if (address(registry) == address(0)) revert NoRegistry();
        IChainPeRegistryView.Service memory svc = registry.getServiceByKey(serviceKey);
        return _sendReputation(destinationBlockchainID, destinationAddress, svc.payTo, svc.agentId);
    }

    function _sendReputation(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        address payTo,
        uint256 agentId
    ) private returns (bytes32 messageID) {
        if (address(oracle) == address(0)) revert NoOracle();
        (uint8 paidScore, uint32 paidReviews, uint64 updatedAt) = oracle.getEntry(payTo);
        if (updatedAt == 0) revert NoScore(payTo);

        bytes memory payload = abi.encode(
            REPUTATION_PAYLOAD_VERSION, payTo, agentId, paidScore, paidReviews, updatedAt
        );

        messageID = messenger.sendCrossChainMessage(
            TeleporterMessageInput({
                destinationBlockchainID: destinationBlockchainID,
                destinationAddress: destinationAddress,
                feeInfo: TeleporterFeeInfo({feeTokenAddress: address(0), amount: 0}),
                requiredGasLimit: REPUTATION_GAS_LIMIT,
                allowedRelayerAddresses: new address[](0),
                message: payload
            })
        );

        emit ReputationSent(
            destinationBlockchainID, destinationAddress, payTo, agentId, paidScore, paidReviews, updatedAt, messageID
        );
    }
}
