// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ChainPeFees
/// @notice Non-upgradeable collection of provider usage fees directly into the treasury.
/// @dev Revenue is supplied by the collector; provider allowance limits collection.
contract ChainPeFees is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 500;

    IERC20 public immutable usdc;
    address public treasury;
    address public collector;

    mapping(bytes32 => bool) public batchCollected;

    event FeeCollected(
        bytes32 indexed batchId,
        address indexed provider,
        uint256 revenueAtomic,
        uint256 feeAtomic
    );
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event CollectorUpdated(address indexed oldCollector, address indexed newCollector);

    error ZeroAddress();
    error ZeroProvider();
    error ZeroBatchId();
    error ZeroFee();
    error BatchAlreadyCollected(bytes32 batchId);
    error FeeExceedsMaximum(uint256 revenueAtomic, uint256 feeAtomic);
    error NotCollector(address caller);
    error RenounceDisabled();

    modifier onlyCollector() {
        if (msg.sender != collector) revert NotCollector(msg.sender);
        _;
    }

    /// @notice Create a fee collector with explicit ownership and payment configuration.
    /// @param usdc_ ERC-20 USDC collected from providers; must be nonzero.
    /// @param treasury_ Recipient of collected fees; must be nonzero.
    /// @param collector_ Account authorized to collect fees; must be nonzero.
    /// @param initialOwner Initial administrative owner; must be nonzero.
    constructor(
        IERC20 usdc_,
        address treasury_,
        address collector_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (address(usdc_) == address(0) || treasury_ == address(0) || collector_ == address(0)) {
            revert ZeroAddress();
        }
        // Ownable(initialOwner) rejects a zero initial owner with its custom error.
        usdc = usdc_;
        treasury = treasury_;
        collector = collector_;
    }

    /// @notice Collect a unique batch's fee directly from a provider into the treasury.
    /// @param provider Provider whose USDC allowance funds the fee; must be nonzero.
    /// @param revenueAtomic Collector-stated revenue in USDC atomic units.
    /// @param feeAtomic Nonzero fee in USDC atomic units, capped at 5% of stated revenue.
    /// @param batchId Nonzero globally unique identifier for this collection.
    function collect(
        address provider,
        uint256 revenueAtomic,
        uint256 feeAtomic,
        bytes32 batchId
    ) external onlyCollector nonReentrant whenNotPaused {
        if (provider == address(0)) revert ZeroProvider();
        if (batchId == bytes32(0)) revert ZeroBatchId();
        if (feeAtomic == 0) revert ZeroFee();
        if (batchCollected[batchId]) revert BatchAlreadyCollected(batchId);
        if (feeAtomic * 10000 > revenueAtomic * MAX_FEE_BPS) {
            revert FeeExceedsMaximum(revenueAtomic, feeAtomic);
        }

        batchCollected[batchId] = true;
        emit FeeCollected(batchId, provider, revenueAtomic, feeAtomic);
        usdc.safeTransferFrom(provider, treasury, feeAtomic);
    }

    /// @notice Change the recipient of future fee collections.
    /// @param newTreasury Nonzero treasury address.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /// @notice Change the account authorized to collect future fees.
    /// @param newCollector Nonzero collector address.
    function setCollector(address newCollector) external onlyOwner {
        if (newCollector == address(0)) revert ZeroAddress();
        address oldCollector = collector;
        collector = newCollector;
        emit CollectorUpdated(oldCollector, newCollector);
    }

    /// @notice Pause fee collection; owner operations remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume fee collection.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Always revert so ownership cannot be renounced, regardless of the caller.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
