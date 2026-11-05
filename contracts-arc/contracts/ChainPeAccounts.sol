// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ChainPeAccounts
/// @notice Non-upgradeable provider accounts, service listings and USDC-paid Pro plans.
contract ChainPeAccounts is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant PERIOD = 30 days;
    uint256 public constant FREE_MAX_SERVICES = 1;
    uint256 public constant PRO_MAX_SERVICES = 10;
    uint256 public constant MAX_SERVICES_PER_PAGE = 100;

    struct Provider {
        bool exists;
        uint256 agentId;
        uint64 createdAt;
        uint64 paidUntil;
        uint32 activeServices;
    }

    struct Service {
        bytes32 key;
        address provider;
        address payTo;
        uint256 agentId;
        string name;
        string description;
        string tags;
        string endpoint;
        string pricePerRequest;
        string network;
        bool acceptsExact;
        bool acceptsGateway;
        bool active;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct ServiceInput {
        string name;
        string description;
        string tags;
        string endpoint;
        string pricePerRequest;
        string network;
        address payTo;
        bool acceptsExact;
        bool acceptsGateway;
    }

    IERC20 public immutable usdc;
    address public treasury;
    address public immutable identityRegistry;
    uint256 public proPricePerPeriod;

    mapping(address => Provider) public providers;
    mapping(bytes32 => Service) internal services;
    mapping(address => bytes32[]) internal servicesByProvider;
    bytes32[] internal allKeys;

    event ProviderRegistered(address indexed provider, uint256 indexed agentId);
    event AgentIdUpdated(address indexed provider, uint256 indexed agentId);
    event ServiceRegistered(
        bytes32 indexed key,
        address indexed provider,
        string name,
        string endpoint,
        string pricePerRequest,
        address payTo,
        string network,
        bool acceptsExact,
        bool acceptsGateway,
        uint256 agentId
    );
    event ServiceUpdated(
        bytes32 indexed key,
        address indexed provider,
        string name,
        string endpoint,
        string pricePerRequest,
        address payTo,
        string network,
        bool acceptsExact,
        bool acceptsGateway,
        uint256 agentId
    );
    event ServiceDeactivated(bytes32 indexed key, address indexed provider);
    event Subscribed(address indexed provider, uint8 periods, uint256 amount, uint64 paidUntil);
    event ProPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event TreasuryUpdated(address oldT, address newT);

    error ZeroAddress();
    error ZeroPrice();
    error ProviderAlreadyExists(address provider);
    error ProviderNotFound(address provider);
    error NotAgentOwner(uint256 agentId, address caller);
    error ServiceAlreadyActive(bytes32 key);
    error ServiceNotFound(bytes32 key);
    error ServiceNotActive(bytes32 key);
    error ServiceLimitReached(uint256 maximum);
    error InvalidStringLength(bytes32 field, uint256 length);
    error NoPaymentRail();
    error InvalidPeriods(uint8 periods);
    error RenounceDisabled();

    /// @notice Create accounts with explicit ownership and subscription configuration.
    /// @param usdc_ ERC-20 USDC used to pay for Pro subscriptions; must be nonzero.
    /// @param treasury_ Recipient of subscription payments; must be nonzero.
    /// @param identityRegistry_ ERC-721 identity registry; must be nonzero.
    /// @param proPricePerPeriod_ Nonzero USDC atomic-unit price per 30-day period.
    /// @param initialOwner Initial administrative owner; must be nonzero.
    constructor(
        IERC20 usdc_,
        address treasury_,
        address identityRegistry_,
        uint256 proPricePerPeriod_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (address(usdc_) == address(0) || treasury_ == address(0) || identityRegistry_ == address(0)) {
            revert ZeroAddress();
        }
        // Ownable(initialOwner) rejects a zero initial owner with its custom error.
        if (proPricePerPeriod_ == 0) revert ZeroPrice();
        usdc = usdc_;
        treasury = treasury_;
        identityRegistry = identityRegistry_;
        proPricePerPeriod = proPricePerPeriod_;
    }

    /// @notice Register the caller as a provider for free, optionally linking an owned identity.
    /// @param agentId ERC-721 identity token owned by the caller, or zero for no identity.
    function registerProvider(uint256 agentId) external whenNotPaused {
        if (providers[msg.sender].exists) revert ProviderAlreadyExists(msg.sender);
        _checkAgentOwner(agentId);
        providers[msg.sender] = Provider({
            exists: true,
            agentId: agentId,
            createdAt: block.timestamp.toUint64(),
            paidUntil: 0,
            activeServices: 0
        });
        emit ProviderRegistered(msg.sender, agentId);
    }

    /// @notice Change the caller's identity without changing existing service snapshots.
    /// @param agentId Owned identity token ID, or zero to clear the link.
    function setAgentId(uint256 agentId) external whenNotPaused {
        Provider storage provider = _requireProvider(msg.sender);
        _checkAgentOwner(agentId);
        provider.agentId = agentId;
        emit AgentIdUpdated(msg.sender, agentId);
    }

    /// @notice Register a new service or reactivate an inactive service without duplicating its history.
    /// @param input Service details; the name determines the provider-scoped key.
    /// @return key Stable key of the registered or reactivated service.
    function registerService(ServiceInput calldata input) external whenNotPaused returns (bytes32 key) {
        Provider storage provider = _requireProvider(msg.sender);
        _validateInput(input);
        key = computeKey(msg.sender, input.name);
        Service storage service = services[key];
        if (service.provider != address(0) && service.active) revert ServiceAlreadyActive(key);
        uint256 maximum = maxServices(msg.sender);
        if (provider.activeServices >= maximum) revert ServiceLimitReached(maximum);

        if (service.provider == address(0)) {
            service.key = key;
            service.provider = msg.sender;
            service.createdAt = block.timestamp.toUint64();
            allKeys.push(key);
            servicesByProvider[msg.sender].push(key);
        }
        _writeService(service, input, provider.agentId);
        service.active = true;
        provider.activeServices += 1;
        _emitServiceRegistered(service);
    }

    /// @notice Update an active service, preserving its key, creation time and active count.
    /// @param input Replacement service details; name selects an existing service of the caller.
    function updateService(ServiceInput calldata input) external whenNotPaused {
        Provider storage provider = _requireProvider(msg.sender);
        bytes32 key = computeKey(msg.sender, input.name);
        Service storage service = _requireActiveService(key);
        _validateInput(input);
        _writeService(service, input, provider.agentId);
        _emitServiceUpdated(service);
    }

    /// @notice Deactivate one of the caller's active services while retaining its history.
    /// @param name Exact service name used to derive its key.
    function deactivateService(string calldata name) external whenNotPaused {
        bytes32 key = computeKey(msg.sender, name);
        Service storage service = _requireActiveService(key);
        service.active = false;
        providers[msg.sender].activeServices -= 1;
        service.updatedAt = block.timestamp.toUint64();
        emit ServiceDeactivated(key, msg.sender);
    }

    /// @notice Buy Pro periods, extending from the later of now and the current expiry.
    /// @param periods Number of 30-day periods to buy, between 1 and 12 inclusive.
    function subscribe(uint8 periods) external nonReentrant whenNotPaused {
        Provider storage provider = _requireProvider(msg.sender);
        if (periods == 0 || periods > 12) revert InvalidPeriods(periods);
        uint256 start = provider.paidUntil > block.timestamp ? uint256(provider.paidUntil) : block.timestamp;
        uint64 newPaidUntil = (start + uint256(periods) * PERIOD).toUint64();
        uint256 amount = proPricePerPeriod * uint256(periods);
        provider.paidUntil = newPaidUntil;
        emit Subscribed(msg.sender, periods, amount, newPaidUntil);
        usdc.safeTransferFrom(msg.sender, treasury, amount);
    }

    /// @notice Compute a service's deterministic provider-scoped key.
    /// @param provider Address publishing the service.
    /// @param name Exact service name, encoded without normalization.
    /// @return key Hash of the ABI-encoded provider and name.
    function computeKey(address provider, string memory name) public pure returns (bytes32 key) {
        return keccak256(abi.encode(provider, name));
    }

    /// @notice Return the currently effective plan; expiration never deactivates services.
    /// @param provider Address whose plan is requested.
    /// @return plan One for unexpired Pro, otherwise zero for Free.
    function planOf(address provider) public view returns (uint8 plan) {
        return providers[provider].paidUntil > block.timestamp ? 1 : 0;
    }

    /// @notice Return the active-service limit applied to new registrations and reactivations.
    /// @param provider Address whose limit is requested.
    /// @return maximum Ten for Pro, otherwise one for Free.
    function maxServices(address provider) public view returns (uint256 maximum) {
        return planOf(provider) == 1 ? PRO_MAX_SERVICES : FREE_MAX_SERVICES;
    }

    /// @notice Read an existing service, including an inactive service.
    /// @param key Deterministic service key.
    /// @return service Full service details and identity snapshot.
    function getService(bytes32 key) external view returns (Service memory service) {
        if (services[key].provider == address(0)) revert ServiceNotFound(key);
        return services[key];
    }

    /// @notice List every key ever registered by a provider, including inactive services.
    /// @param provider Address whose service keys are requested.
    /// @return keys Service keys in first-registration order, without duplicates.
    function servicesOf(address provider) external view returns (bytes32[] memory keys) {
        return servicesByProvider[provider];
    }

    /// @notice Read services in first-registration order, including inactive services.
    /// @param offset Zero-based starting index; an index at or past the end returns an empty page.
    /// @param limit Requested page size, capped at 100; zero returns an empty page.
    /// @return page Full service structs for the requested page.
    function getServices(uint256 offset, uint256 limit) external view returns (Service[] memory page) {
        uint256 total = allKeys.length;
        if (offset >= total || limit == 0) return new Service[](0);
        if (limit > MAX_SERVICES_PER_PAGE) limit = MAX_SERVICES_PER_PAGE;
        uint256 size = total - offset;
        if (size > limit) size = limit;
        page = new Service[](size);
        for (uint256 i = 0; i < size; ++i) {
            page[i] = services[allKeys[offset + i]];
        }
    }

    /// @notice Count unique service keys, including inactive services.
    /// @return count Number of services ever registered.
    function serviceCount() external view returns (uint256 count) {
        return allKeys.length;
    }

    /// @notice Set the nonzero USDC price for future subscription purchases.
    /// @param newPrice Price per period in USDC atomic units.
    function setProPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        uint256 oldPrice = proPricePerPeriod;
        proPricePerPeriod = newPrice;
        emit ProPriceUpdated(oldPrice, newPrice);
    }

    /// @notice Change the recipient of future subscription payments.
    /// @param newTreasury Nonzero treasury address.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /// @notice Pause provider mutations and subscription purchases; owner operations remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume provider mutations and subscription purchases.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Always revert so ownership cannot be renounced, regardless of the caller.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function _requireProvider(address account) private view returns (Provider storage provider) {
        provider = providers[account];
        if (!provider.exists) revert ProviderNotFound(account);
    }

    function _checkAgentOwner(uint256 agentId) private view {
        if (agentId != 0 && IERC721(identityRegistry).ownerOf(agentId) != msg.sender) {
            revert NotAgentOwner(agentId, msg.sender);
        }
    }

    function _requireActiveService(bytes32 key) private view returns (Service storage service) {
        service = services[key];
        if (service.provider == address(0)) revert ServiceNotFound(key);
        if (!service.active) revert ServiceNotActive(key);
    }

    function _validateInput(ServiceInput calldata input) private pure {
        _validateLength("name", bytes(input.name).length, 1, 64);
        _validateLength("endpoint", bytes(input.endpoint).length, 1, 256);
        _validateLength("pricePerRequest", bytes(input.pricePerRequest).length, 1, 32);
        _validateLength("network", bytes(input.network).length, 1, 32);
        _validateLength("description", bytes(input.description).length, 0, 1024);
        _validateLength("tags", bytes(input.tags).length, 0, 256);
        if (input.payTo == address(0)) revert ZeroAddress();
        if (!input.acceptsExact && !input.acceptsGateway) revert NoPaymentRail();
        _requireNonzeroPrice(input.pricePerRequest);
    }

    function _validateLength(bytes32 field, uint256 length, uint256 minimum, uint256 maximum) private pure {
        if (length < minimum || length > maximum) revert InvalidStringLength(field, length);
    }

    // Cheap zero-price guard only, not a decimal-format parser.
    function _requireNonzeroPrice(string calldata price) private pure {
        bytes calldata value = bytes(price);
        for (uint256 i = 0; i < value.length; ++i) {
            if (value[i] >= 0x31 && value[i] <= 0x39) return;
        }
        revert ZeroPrice();
    }

    function _writeService(Service storage service, ServiceInput calldata input, uint256 agentId) private {
        service.name = input.name;
        service.description = input.description;
        service.tags = input.tags;
        service.endpoint = input.endpoint;
        service.pricePerRequest = input.pricePerRequest;
        service.network = input.network;
        service.payTo = input.payTo;
        service.acceptsExact = input.acceptsExact;
        service.acceptsGateway = input.acceptsGateway;
        service.agentId = agentId;
        service.updatedAt = block.timestamp.toUint64();
    }

    // Materialize a memory struct to keep dynamic event arguments off the callers' stack.
    function _emitServiceRegistered(Service memory service) private {
        emit ServiceRegistered(
            service.key,
            service.provider,
            service.name,
            service.endpoint,
            service.pricePerRequest,
            service.payTo,
            service.network,
            service.acceptsExact,
            service.acceptsGateway,
            service.agentId
        );
    }

    function _emitServiceUpdated(Service memory service) private {
        emit ServiceUpdated(
            service.key,
            service.provider,
            service.name,
            service.endpoint,
            service.pricePerRequest,
            service.payTo,
            service.network,
            service.acceptsExact,
            service.acceptsGateway,
            service.agentId
        );
    }
}
