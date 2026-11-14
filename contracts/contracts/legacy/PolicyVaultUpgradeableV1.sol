// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title PolicyVaultUpgradeableV1 (frozen copy of the pre-Phase-3 mainnet implementation)
 * @notice UUPS-upgradeable version of PolicyVault for mainnet deployment.
 *
 * Identical semantics to PolicyVault but deployable behind an ERC-1967 proxy,
 * enabling emergency patching without requiring users to migrate funds. The
 * owner (multisig) controls upgrades via `_authorizeUpgrade`.
 *
 * Deploy via:
 *   1. Deploy this implementation contract.
 *   2. Deploy ERC1967Proxy(impl, abi.encodeCall(initialize, (token, owner))).
 *   3. Interact with the proxy address only.
 *
 * Trust assumptions:
 *  - Relayers: any address may submit `spend()`. A malicious relayer can hold a
 *    signed authorization until after `deadline`; the session key can re-sign
 *    with a fresh deadline to recover.
 *  - Fee token (USDC): USDC is centrally administered — it can blacklist
 *    addresses and is itself pausable/upgradeable by its issuer. If the vault or
 *    a `to` recipient is blacklisted, the corresponding `spend`/`withdraw`
 *    transfer will revert and those funds are frozen at the token layer. This is
 *    inherent to using USDC and is outside this contract's control.
 *  - Owner: controls UUPS upgrades via `_authorizeUpgrade`. On mainnet the owner
 *    MUST be a timelock (see ChainPeTimelock) behind a multisig so depositors get
 *    a delay window — and can always `withdraw` (not pausable) — before any
 *    privileged action takes effect.
 */
contract PolicyVaultUpgradeableV1 is
    Initializable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Storage ─────────────────────────────────────────────────────────────
    // NOTE: Do NOT reorder or remove storage variables when releasing upgrades.
    // Add new variables only at the end to preserve the storage layout.

    IERC20 public token; // slot 0 — not immutable (proxy holds state)

    struct Policy {
        // Storage-packed: the three full-word amounts occupy one slot each, then
        // sessionKey(20) + expiry(8) + allowlistOnly(1) + active(1) = 30 bytes
        // share a single slot. 4 slots total (was 5). Field order here only
        // affects the `policyOf` getter tuple; `setPolicy`'s signature is unchanged.
        uint256 maxPerCall;
        uint256 dailyCap;
        uint256 totalBudget;
        address sessionKey;
        uint64 expiry;
        bool allowlistOnly;
        bool active;
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => Policy) public policyOf;
    mapping(address => mapping(address => bool)) public allowlist;
    mapping(address => uint256) public totalSpent;
    mapping(address => mapping(uint256 => uint256)) public dailySpent;
    mapping(address => uint256) public nonces;

    // NOTE: Do NOT change SPEND_TYPEHASH — it invalidates all signed authorizations.
    bytes32 private constant SPEND_TYPEHASH =
        keccak256("Spend(address owner,address to,uint256 amount,uint256 nonce,uint256 deadline)");

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAddressToken();
    error ZeroAddressOwner();
    error ZeroAmount();
    error InsufficientBalance();
    error ZeroSessionKey();
    error ZeroDailyCap();
    error MaxPerCallExceedsBudget();
    error ExpiryInPast();
    error SessionInactive();
    error SessionExpired();
    error AuthExpired();
    error ZeroRecipient();
    error OverPerCallCap();
    error InsufficientVaultBalance();
    error OverTotalBudget();
    error OverDailyCap();
    error RecipientNotAllowlisted();
    error BadSessionSig();
    error CannotClearCurrentOrFutureDay();

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event PolicySet(address indexed owner, address indexed sessionKey, uint256 maxPerCall, uint256 dailyCap, uint256 totalBudget, uint64 expiry, bool allowlistOnly);
    event AllowlistUpdated(address indexed owner, address indexed to, bool allowed);
    event SessionRevoked(address indexed owner, address indexed sessionKey);
    event Spent(address indexed owner, address indexed to, uint256 amount, address indexed relayer, uint256 nonce);

    // ─── Constructor / Initializer ───────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the vault. Called once via the proxy constructor.
     * @param _token  ERC-20 token the vault holds (USDC).
     * @param _owner  Initial owner (should be a Gnosis Safe multisig on mainnet).
     */
    function initialize(address _token, address _owner) public initializer {
        if (_token == address(0)) revert ZeroAddressToken();
        if (_owner == address(0)) revert ZeroAddressOwner();
        __EIP712_init("ChainPePolicyVault", "1");
        __ReentrancyGuard_init();
        __Ownable_init(_owner);
        __Pausable_init();
        __UUPSUpgradeable_init();
        token = IERC20(_token);
    }

    // ─── UUPS upgrade gate ───────────────────────────────────────────────────

    /// @dev Only the owner (multisig) may authorize an upgrade.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ─── Emergency controls ──────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Funding ─────────────────────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw your own unspent balance. Intentionally NOT pausable:
    /// pausing halts spending, but users must always be able to exit their funds.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount > balanceOf[msg.sender]) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Policy management ───────────────────────────────────────────────────

    /**
     * @dev Resets `totalSpent` on each new session. `maxPerCall <= totalBudget`,
     * `dailyCap > 0`, and `expiry > block.timestamp` are enforced.
     */
    function setPolicy(
        address sessionKey,
        uint256 maxPerCall,
        uint256 dailyCap,
        uint256 totalBudget,
        uint64 expiry,
        bool allowlistOnly
    ) external {
        if (sessionKey == address(0)) revert ZeroSessionKey();
        if (dailyCap == 0) revert ZeroDailyCap();
        if (maxPerCall > totalBudget) revert MaxPerCallExceedsBudget();
        if (expiry <= block.timestamp) revert ExpiryInPast();
        policyOf[msg.sender] = Policy({ sessionKey: sessionKey, maxPerCall: maxPerCall, dailyCap: dailyCap, totalBudget: totalBudget, expiry: expiry, allowlistOnly: allowlistOnly, active: true });
        totalSpent[msg.sender] = 0;
        emit PolicySet(msg.sender, sessionKey, maxPerCall, dailyCap, totalBudget, expiry, allowlistOnly);
    }

    function setAllowlist(address to, bool allowed) external {
        allowlist[msg.sender][to] = allowed;
        emit AllowlistUpdated(msg.sender, to, allowed);
    }

    function revokeSession() external {
        Policy storage p = policyOf[msg.sender];
        p.active = false;
        emit SessionRevoked(msg.sender, p.sessionKey);
    }

    // ─── Gasless spend ───────────────────────────────────────────────────────

    function spend(
        address owner,
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata sessionSig
    ) external nonReentrant whenNotPaused {
        Policy memory p = policyOf[owner];
        if (!p.active) revert SessionInactive();
        if (block.timestamp > p.expiry) revert SessionExpired();
        if (block.timestamp > deadline) revert AuthExpired();
        if (to == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();
        if (amount > p.maxPerCall) revert OverPerCallCap();
        if (balanceOf[owner] < amount) revert InsufficientVaultBalance();
        if (totalSpent[owner] + amount > p.totalBudget) revert OverTotalBudget();

        uint256 day = block.timestamp / 1 days;
        if (dailySpent[owner][day] + amount > p.dailyCap) revert OverDailyCap();

        if (p.allowlistOnly && !allowlist[owner][to]) revert RecipientNotAllowlisted();

        uint256 nonce = nonces[owner];
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SPEND_TYPEHASH, owner, to, amount, nonce, deadline)));
        if (ECDSA.recover(digest, sessionSig) != p.sessionKey) revert BadSessionSig();

        nonces[owner] = nonce + 1;
        totalSpent[owner] += amount;
        dailySpent[owner][day] += amount;
        balanceOf[owner] -= amount;

        token.safeTransfer(to, amount);
        emit Spent(owner, to, amount, msg.sender, nonce);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function dailyRemaining(address owner) external view returns (uint256) {
        Policy memory p = policyOf[owner];
        uint256 spent = dailySpent[owner][block.timestamp / 1 days];
        return p.dailyCap > spent ? p.dailyCap - spent : 0;
    }

    function budgetRemaining(address owner) external view returns (uint256) {
        Policy memory p = policyOf[owner];
        return p.totalBudget > totalSpent[owner] ? p.totalBudget - totalSpent[owner] : 0;
    }

    function previewSpend(address owner, address to, uint256 amount) external view returns (bool ok, string memory reason) {
        Policy memory p = policyOf[owner];
        if (!p.active) return (false, "session inactive");
        if (block.timestamp > p.expiry) return (false, "session expired");
        if (to == address(0)) return (false, "to=0");
        if (amount == 0) return (false, "amount=0");
        if (amount > p.maxPerCall) return (false, "over per-call cap");
        if (balanceOf[owner] < amount) return (false, "insufficient vault balance");
        if (totalSpent[owner] + amount > p.totalBudget) return (false, "over total budget");
        uint256 day = block.timestamp / 1 days;
        if (dailySpent[owner][day] + amount > p.dailyCap) return (false, "over daily cap");
        if (p.allowlistOnly && !allowlist[owner][to]) return (false, "recipient not allowlisted");
        return (true, "");
    }

    /**
     * @notice Delete stale daily-spend storage slots to reclaim gas (EIP-3529 refund).
     * @dev Any caller may invoke this — it only clears days strictly in the past.
     *      The current day's slot is live and cannot be cleared.
     */
    function cleanupDailySpent(address owner, uint256[] calldata dayIndices) external {
        uint256 today = block.timestamp / 1 days;
        for (uint256 i = 0; i < dayIndices.length; ++i) {
            if (dayIndices[i] >= today) revert CannotClearCurrentOrFutureDay();
            delete dailySpent[owner][dayIndices[i]];
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
