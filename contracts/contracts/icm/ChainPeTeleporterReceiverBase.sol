// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITeleporterReceiver} from "./ITeleporter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ChainPeTeleporterReceiverBase
 * @notice Shared, fail-closed authentication for every ChainPe ICM receiver.
 *
 * A message is processed only when ALL of these hold:
 *   1. `msg.sender` is the local Teleporter messenger (Teleporter has already
 *      verified the Warp signature for `sourceBlockchainID` / `originSenderAddress`);
 *   2. the owner registered a trusted sender for `sourceBlockchainID`;
 *   3. `originSenderAddress` is exactly that trusted sender.
 *
 * An unconfigured source chain is REJECTED (fail closed). There is no "open" mode.
 */
abstract contract ChainPeTeleporterReceiverBase is ITeleporterReceiver, Ownable {
    address public immutable messenger;

    /// sourceBlockchainID => trusted sender contract on that chain. Unset = rejected.
    mapping(bytes32 => address) public trustedSenders;

    event TrustedSenderSet(bytes32 indexed sourceBlockchainID, address indexed sender);

    constructor(address messenger_) Ownable(msg.sender) {
        require(messenger_ != address(0), "messenger=0");
        messenger = messenger_;
    }

    /**
     * @notice Register the trusted sender contract for a source chain.
     * @dev Set to address(0) to stop accepting messages from that chain.
     */
    function setTrustedSender(bytes32 sourceBlockchainID, address sender) external onlyOwner {
        trustedSenders[sourceBlockchainID] = sender;
        emit TrustedSenderSet(sourceBlockchainID, sender);
    }

    /// @inheritdoc ITeleporterReceiver
    function receiveTeleporterMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external {
        require(msg.sender == messenger, "only teleporter");
        address trusted = trustedSenders[sourceBlockchainID];
        require(trusted != address(0), "untrusted source chain");
        require(originSenderAddress == trusted, "untrusted sender");
        _handleMessage(sourceBlockchainID, originSenderAddress, message);
    }

    /// @dev Called only after the message has been authenticated.
    function _handleMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) internal virtual;
}
