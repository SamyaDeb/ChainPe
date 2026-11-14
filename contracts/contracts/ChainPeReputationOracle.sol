// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title ChainPeReputationOracle
 * @notice On-chain copy of each provider's payment-verified reputation, keyed by the address it is paid at
 *         (the service's `payTo`), so a PolicyVault can refuse to pay a bad provider without trusting the agent.
 *
 * Scores are computed off-chain by chainpe-cloud from ERC-8004 ratings that each carry a verified x402 payment
 * (weighted by USDC paid) and pushed here by an attester. The attester is trusted for exactly one thing: reporting
 * that number. It cannot move funds, and the owner can replace it at any time.
 *
 * `score()` is what a vault checks. It reads 0 ("not good enough") unless the provider has at least `minPaidReviews`
 * verified paid reviews and the score is not older than `maxAge`, so a new, thin or abandoned record never passes.
 */
contract ChainPeReputationOracle is Ownable2Step {
    struct Entry {
        uint8 score; // 0-100
        uint32 paidReviews; // verified paid reviews behind the score
        uint64 updatedAt;
    }

    mapping(address => Entry) private _entries;
    mapping(address => bool) public isAttester;

    /// @notice Reviews a provider needs before its score is reported by `score()`.
    uint32 public minPaidReviews = 3;
    /// @notice Scores older than this many seconds read as 0. 0 disables the check.
    uint64 public maxAge;

    event ScoreUpdated(address indexed payTo, uint8 score, uint32 paidReviews, uint64 updatedAt);
    event AttesterSet(address indexed attester, bool allowed);
    event MinPaidReviewsSet(uint32 minPaidReviews);
    event MaxAgeSet(uint64 maxAge);

    error NotAttester();
    error ScoreOutOfRange(uint8 score);
    error LengthMismatch();
    error ZeroAddress();

    constructor(address owner_, address attester_) Ownable(owner_) {
        if (attester_ != address(0)) {
            isAttester[attester_] = true;
            emit AttesterSet(attester_, true);
        }
    }

    modifier onlyAttester() {
        if (!isAttester[msg.sender]) revert NotAttester();
        _;
    }

    // ─── Attester ────────────────────────────────────────────────────────────

    function setScore(address payTo, uint8 score_, uint32 paidReviews) external onlyAttester {
        _set(payTo, score_, paidReviews);
    }

    function setScores(address[] calldata payTos, uint8[] calldata scores, uint32[] calldata paidReviews) external onlyAttester {
        if (payTos.length != scores.length || payTos.length != paidReviews.length) revert LengthMismatch();
        for (uint256 i = 0; i < payTos.length; ++i) _set(payTos[i], scores[i], paidReviews[i]);
    }

    function _set(address payTo, uint8 score_, uint32 paidReviews) private {
        if (payTo == address(0)) revert ZeroAddress();
        if (score_ > 100) revert ScoreOutOfRange(score_);
        _entries[payTo] = Entry(score_, paidReviews, uint64(block.timestamp));
        emit ScoreUpdated(payTo, score_, paidReviews, uint64(block.timestamp));
    }

    // ─── Owner ───────────────────────────────────────────────────────────────

    function setAttester(address attester, bool allowed) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        isAttester[attester] = allowed;
        emit AttesterSet(attester, allowed);
    }

    function setMinPaidReviews(uint32 n) external onlyOwner {
        minPaidReviews = n;
        emit MinPaidReviewsSet(n);
    }

    function setMaxAge(uint64 seconds_) external onlyOwner {
        maxAge = seconds_;
        emit MaxAgeSet(seconds_);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice The score a vault should trust: 0 when unrated, too few paid reviews, or stale.
    function score(address payTo) external view returns (uint8) {
        Entry memory e = _entries[payTo];
        if (e.updatedAt == 0 || e.paidReviews < minPaidReviews) return 0;
        if (maxAge != 0 && block.timestamp > uint256(e.updatedAt) + maxAge) return 0;
        return e.score;
    }

    /// @notice The raw record, regardless of the thresholds.
    function getEntry(address payTo) external view returns (uint8 score_, uint32 paidReviews, uint64 updatedAt) {
        Entry memory e = _entries[payTo];
        return (e.score, e.paidReviews, e.updatedAt);
    }
}
