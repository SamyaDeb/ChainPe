// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title ChainPeRegistryUpgradeableV1 (frozen copy of the pre-Phase-3 mainnet implementation)
 * @notice UUPS-upgradeable version of ChainPeRegistry for mainnet deployment.
 *
 * Identical semantics to ChainPeRegistry but behind an ERC-1967 proxy,
 * enabling emergency patching. The owner (multisig) controls upgrades.
 *
 * Deploy via:
 *   1. Deploy this implementation contract.
 *   2. Deploy ERC1967Proxy(impl, abi.encodeCall(initialize, (token, recipient, fee, identityReg, owner))).
 *   3. Interact with the proxy address only.
 *
 * Storage layout (do NOT reorder when releasing upgrades; append only):
 *   feeToken / feeRecipient / registrationFee / identityRegistry
 *   _services / _serviceKeys / _keyIndex
 */
contract ChainPeRegistryUpgradeableV1 is
    Initializable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_SERVICES_PER_PAGE = 100;
    uint256 private constant MAX_NAME_LEN = 64;
    uint256 private constant MAX_DESC_LEN = 1024;
    uint256 private constant MAX_TAGS_LEN = 256;
    uint256 private constant MAX_ENDPOINT_LEN = 256;
    uint256 private constant MAX_PRICE_LEN = 32;

    // ─── Types ───────────────────────────────────────────────────────────────

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

    struct ServiceInput {
        string name;
        string description;
        string tags;
        string endpoint;
        string pricePerRequest;
        string paymentToken;
        string network;
        address payTo;
        uint256 agentId;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    IERC20 public feeToken;
    address public feeRecipient;
    uint256 public registrationFee;
    address public identityRegistry;

    mapping(bytes32 => Service) private _services;
    bytes32[] private _serviceKeys;
    mapping(bytes32 => uint256) private _keyIndex;
    // ↑ Append new storage variables below this line only (preserve layout).
    /// @notice Fee charged on `update()`. Defaults to 0 (free updates).
    uint256 public updateFee;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ServiceRegistered(bytes32 indexed key, address indexed developer, string name, string endpoint, string pricePerRequest, string paymentToken, address payTo, uint256 indexed agentId);
    event ServiceUpdated(bytes32 indexed key, address indexed developer, string name, string endpoint, string pricePerRequest, string paymentToken, address payTo, uint256 indexed agentId);
    event ServiceDeregistered(bytes32 indexed key, address indexed developer, string name);
    event RegistrationFeePaid(address indexed payer, address indexed feeRecipient, uint256 amount);
    event FeeTokenUpdated(address indexed oldToken, address indexed newToken);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event UpdateFeeUpdated(uint256 oldFee, uint256 newFee);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ServiceAlreadyExists(bytes32 key);
    error ServiceNotFound(bytes32 key);
    error NotServiceDeveloper(address caller, address developer);
    error ZeroAddress();
    error EmptyName();
    error StringTooLong(string field);
    error InvalidPagination(uint256 offset, uint256 limit);

    // ─── Constructor / Initializer ───────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the registry.
     * @param feeToken_         ERC-20 fee token (USDC).
     * @param feeRecipient_     Treasury address.
     * @param registrationFee_  Fee in feeToken atomic units.
     * @param identityRegistry_ ERC-8004 Identity Registry (0 = unset).
     * @param owner_            Initial owner (should be a Gnosis Safe on mainnet).
     */
    function initialize(
        IERC20 feeToken_,
        address feeRecipient_,
        uint256 registrationFee_,
        address identityRegistry_,
        address owner_
    ) public initializer {
        if (address(feeToken_) == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        feeToken = feeToken_;
        feeRecipient = feeRecipient_;
        registrationFee = registrationFee_;
        identityRegistry = identityRegistry_;
    }

    // ─── UUPS upgrade gate ───────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Emergency controls ──────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Key helper ──────────────────────────────────────────────────────────

    function computeKey(address developer, string memory name) public pure returns (bytes32) {
        return keccak256(abi.encode(developer, name));
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    function register(ServiceInput calldata input) external nonReentrant whenNotPaused returns (bytes32 key) {
        if (bytes(input.name).length == 0) revert EmptyName();
        if (input.payTo == address(0)) revert ZeroAddress();
        _validateInput(input);

        key = computeKey(msg.sender, input.name);
        if (_services[key].exists) revert ServiceAlreadyExists(key);

        uint64 nowTs = uint64(block.timestamp);
        _services[key] = Service({ name: input.name, description: input.description, tags: input.tags, endpoint: input.endpoint, pricePerRequest: input.pricePerRequest, paymentToken: input.paymentToken, network: input.network, payTo: input.payTo, developer: msg.sender, agentId: input.agentId, createdAt: nowTs, updatedAt: nowTs, exists: true });
        _serviceKeys.push(key);
        _keyIndex[key] = _serviceKeys.length;
        _collectFee();
        emit ServiceRegistered(key, msg.sender, input.name, input.endpoint, input.pricePerRequest, input.paymentToken, input.payTo, input.agentId);
    }

    /**
     * @dev Note: pause the contract before changing feeToken to avoid mid-flight
     * races between callers who approved the old token.
     */
    function update(ServiceInput calldata input) external nonReentrant whenNotPaused returns (bytes32 key) {
        if (input.payTo == address(0)) revert ZeroAddress();
        _validateInput(input);

        key = computeKey(msg.sender, input.name);
        Service storage svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        if (svc.developer != msg.sender) revert NotServiceDeveloper(msg.sender, svc.developer);

        svc.description = input.description;
        svc.tags = input.tags;
        svc.endpoint = input.endpoint;
        svc.pricePerRequest = input.pricePerRequest;
        svc.paymentToken = input.paymentToken;
        svc.network = input.network;
        svc.payTo = input.payTo;
        svc.agentId = input.agentId;
        svc.updatedAt = uint64(block.timestamp);
        _collectUpdateFee();
        emit ServiceUpdated(key, msg.sender, input.name, input.endpoint, input.pricePerRequest, input.paymentToken, input.payTo, input.agentId);
    }

    function deregister(string calldata name) external nonReentrant whenNotPaused {
        bytes32 key = computeKey(msg.sender, name);
        Service storage svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        if (svc.developer != msg.sender) revert NotServiceDeveloper(msg.sender, svc.developer);
        _removeKey(key);
        delete _services[key];
        emit ServiceDeregistered(key, msg.sender, name);
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    function getService(address developer, string calldata name) external view returns (Service memory) {
        bytes32 key = computeKey(developer, name);
        Service memory svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        return svc;
    }

    function getServiceByKey(bytes32 key) external view returns (Service memory) {
        Service memory svc = _services[key];
        if (!svc.exists) revert ServiceNotFound(key);
        return svc;
    }

    function hasService(address developer, string calldata name) external view returns (bool) {
        return _services[computeKey(developer, name)].exists;
    }

    function getServiceCount() external view returns (uint256) { return _serviceKeys.length; }

    function getServices(uint256 offset, uint256 limit) external view returns (Service[] memory page) {
        uint256 total = _serviceKeys.length;
        if (offset > total) revert InvalidPagination(offset, limit);
        if (limit == 0) revert InvalidPagination(offset, limit);
        if (limit > MAX_SERVICES_PER_PAGE) revert InvalidPagination(offset, limit);
        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 size = end - offset;
        page = new Service[](size);
        for (uint256 i = 0; i < size; ++i) page[i] = _services[_serviceKeys[offset + i]];
    }

    function getServiceKeyAt(uint256 index) external view returns (bytes32) { return _serviceKeys[index]; }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setRegistrationFee(uint256 newFee) external onlyOwner {
        emit RegistrationFeeUpdated(registrationFee, newFee);
        registrationFee = newFee;
    }

    function setUpdateFee(uint256 newFee) external onlyOwner {
        emit UpdateFeeUpdated(updateFee, newFee);
        updateFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setFeeToken(IERC20 newToken) external onlyOwner {
        if (address(newToken) == address(0)) revert ZeroAddress();
        emit FeeTokenUpdated(address(feeToken), address(newToken));
        feeToken = newToken;
    }

    function setIdentityRegistry(address newRegistry) external onlyOwner {
        emit IdentityRegistryUpdated(identityRegistry, newRegistry);
        identityRegistry = newRegistry;
    }

    function ownerWithdraw(IERC20 tkn, uint256 amount) external onlyOwner {
        tkn.safeTransfer(owner(), amount);
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _collectFee() private {
        uint256 fee = registrationFee;
        if (fee == 0) return;
        feeToken.safeTransferFrom(msg.sender, feeRecipient, fee);
        emit RegistrationFeePaid(msg.sender, feeRecipient, fee);
    }

    function _collectUpdateFee() private {
        uint256 fee = updateFee;
        if (fee == 0) return;
        feeToken.safeTransferFrom(msg.sender, feeRecipient, fee);
        emit RegistrationFeePaid(msg.sender, feeRecipient, fee);
    }

    function _validateInput(ServiceInput calldata input) private pure {
        if (bytes(input.name).length > MAX_NAME_LEN) revert StringTooLong("name");
        if (bytes(input.description).length > MAX_DESC_LEN) revert StringTooLong("description");
        if (bytes(input.tags).length > MAX_TAGS_LEN) revert StringTooLong("tags");
        if (bytes(input.endpoint).length > MAX_ENDPOINT_LEN) revert StringTooLong("endpoint");
        if (bytes(input.pricePerRequest).length > MAX_PRICE_LEN) revert StringTooLong("pricePerRequest");
    }

    function _removeKey(bytes32 key) private {
        uint256 idx1 = _keyIndex[key];
        uint256 lastIdx = _serviceKeys.length;
        if (idx1 != lastIdx) {
            bytes32 lastKey = _serviceKeys[lastIdx - 1];
            _serviceKeys[idx1 - 1] = lastKey;
            _keyIndex[lastKey] = idx1;
        }
        _serviceKeys.pop();
        delete _keyIndex[key];
    }
}
