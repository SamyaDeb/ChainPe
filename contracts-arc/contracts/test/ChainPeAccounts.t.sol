// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ChainPeAccounts} from "../ChainPeAccounts.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockIdentityRegistry {
    mapping(uint256 => address) private _owners;

    function mint(address to, uint256 id) external {
        _owners[id] = to;
    }

    function ownerOf(uint256 id) external view returns (address) {
        address o = _owners[id];
        require(o != address(0), "ERC721: invalid token ID");
        return o;
    }
}

contract ChainPeAccountsTest is Test {
    ChainPeAccounts internal acc;
    MockUSDC internal usdc;
    MockIdentityRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal payTo = makeAddr("payTo");

    uint256 internal constant PRICE = 10e6;
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant PERIOD = 30 days;

    function setUp() public {
        vm.warp(T0);
        usdc = new MockUSDC();
        registry = new MockIdentityRegistry();
        acc = new ChainPeAccounts(IERC20(address(usdc)), treasury, address(registry), PRICE, owner);
    }

    // ------------------------------------------------------------ helpers

    function _input(string memory name) internal view returns (ChainPeAccounts.ServiceInput memory i) {
        i = ChainPeAccounts.ServiceInput({
            name: name,
            description: "desc",
            tags: "tag1,tag2",
            endpoint: "https://api.example.com/v1",
            pricePerRequest: "0.01",
            network: "arc-testnet",
            payTo: payTo,
            acceptsExact: true,
            acceptsGateway: false
        });
    }

    function _rep(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 k = 0; k < n; k++) {
            b[k] = "a";
        }
        return string(b);
    }

    function _repDigit(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 k = 0; k < n; k++) {
            b[k] = "1";
        }
        return string(b);
    }

    function _provider(address who) internal {
        vm.prank(who);
        acc.registerProvider(0);
    }

    function _register(address who, string memory name) internal returns (bytes32 key) {
        vm.prank(who);
        key = acc.registerService(_input(name));
    }

    function _registerIn(address who, ChainPeAccounts.ServiceInput memory i) internal returns (bytes32 key) {
        vm.prank(who);
        key = acc.registerService(i);
    }

    function _subscribe(address who, uint8 periods) internal {
        usdc.mint(who, PRICE * periods);
        vm.startPrank(who);
        usdc.approve(address(acc), PRICE * periods);
        acc.subscribe(periods);
        vm.stopPrank();
    }

    function _paidUntil(address who) internal view returns (uint64 pu) {
        (,,, pu,) = acc.providers(who);
    }

    function _activeServices(address who) internal view returns (uint32 n) {
        (,,,, n) = acc.providers(who);
    }

    function _agentIdOf(address who) internal view returns (uint256 a) {
        (, a,,,) = acc.providers(who);
    }

    function _svcName(uint256 idx) internal pure returns (string memory) {
        return string.concat("svc", vm.toString(idx));
    }

    function _emitReg(ChainPeAccounts.Service memory s) internal {
        emit ChainPeAccounts.ServiceRegistered(
            s.key, s.provider, s.name, s.endpoint, s.pricePerRequest, s.payTo, s.network, s.acceptsExact, s.acceptsGateway, s.agentId
        );
    }

    function _emitUpd(ChainPeAccounts.Service memory s) internal {
        emit ChainPeAccounts.ServiceUpdated(
            s.key, s.provider, s.name, s.endpoint, s.pricePerRequest, s.payTo, s.network, s.acceptsExact, s.acceptsGateway, s.agentId
        );
    }

    function _asService(address p, ChainPeAccounts.ServiceInput memory i, uint256 aid)
        internal
        view
        returns (ChainPeAccounts.Service memory s)
    {
        s.key = acc.computeKey(p, i.name);
        s.provider = p;
        s.name = i.name;
        s.endpoint = i.endpoint;
        s.pricePerRequest = i.pricePerRequest;
        s.payTo = i.payTo;
        s.network = i.network;
        s.acceptsExact = i.acceptsExact;
        s.acceptsGateway = i.acceptsGateway;
        s.agentId = aid;
    }

    function _expectRegistered(address p, ChainPeAccounts.ServiceInput memory i, uint256 aid) internal {
        vm.expectEmit(true, true, false, true, address(acc));
        _emitReg(_asService(p, i, aid));
    }

    function _expectUpdated(address p, ChainPeAccounts.ServiceInput memory i, uint256 aid) internal {
        vm.expectEmit(true, true, false, true, address(acc));
        _emitUpd(_asService(p, i, aid));
    }

    // ------------------------------------------------------------ constructor

    function test_Constructor_SetsState() public view {
        assertEq(address(acc.usdc()), address(usdc));
        assertEq(acc.treasury(), treasury);
        assertEq(acc.identityRegistry(), address(registry));
        assertEq(acc.proPricePerPeriod(), PRICE);
        assertEq(acc.owner(), owner);
        assertEq(acc.PERIOD(), 30 days);
        assertEq(acc.serviceCount(), 0);
    }

    function test_Constructor_ZeroUsdcReverts() public {
        vm.expectRevert(ChainPeAccounts.ZeroAddress.selector);
        new ChainPeAccounts(IERC20(address(0)), treasury, address(registry), PRICE, owner);
    }

    function test_Constructor_ZeroTreasuryReverts() public {
        vm.expectRevert(ChainPeAccounts.ZeroAddress.selector);
        new ChainPeAccounts(IERC20(address(usdc)), address(0), address(registry), PRICE, owner);
    }

    function test_Constructor_ZeroRegistryReverts() public {
        vm.expectRevert(ChainPeAccounts.ZeroAddress.selector);
        new ChainPeAccounts(IERC20(address(usdc)), treasury, address(0), PRICE, owner);
    }

    function test_Constructor_ZeroPriceReverts() public {
        vm.expectRevert(ChainPeAccounts.ZeroPrice.selector);
        new ChainPeAccounts(IERC20(address(usdc)), treasury, address(registry), 0, owner);
    }

    function test_Constructor_ZeroOwnerReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ChainPeAccounts(IERC20(address(usdc)), treasury, address(registry), PRICE, address(0));
    }

    // ------------------------------------------------------------ registerProvider

    function test_RegisterProvider_SetsStateAndEmits() public {
        registry.mint(alice, 7);
        vm.expectEmit(true, true, false, false, address(acc));
        emit ChainPeAccounts.ProviderRegistered(alice, 7);
        vm.prank(alice);
        acc.registerProvider(7);

        (bool exists, uint256 agentId, uint64 createdAt, uint64 paidUntil, uint32 active) = acc.providers(alice);
        assertTrue(exists);
        assertEq(agentId, 7);
        assertEq(createdAt, T0);
        assertEq(paidUntil, 0);
        assertEq(active, 0);
        assertEq(acc.planOf(alice), 0);
    }

    function test_RegisterProvider_ZeroAgentIdAllowed() public {
        _provider(alice);
        assertEq(_agentIdOf(alice), 0);
    }

    function test_RegisterProvider_DuplicateReverts() public {
        _provider(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ProviderAlreadyExists.selector, alice));
        acc.registerProvider(0);
    }

    function test_RegisterProvider_AgentOwnedByOtherReverts() public {
        registry.mint(bob, 5);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.NotAgentOwner.selector, 5, alice));
        acc.registerProvider(5);
    }

    function test_RegisterProvider_NonexistentAgentReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        acc.registerProvider(99);
    }

    // ------------------------------------------------------------ setAgentId

    function test_SetAgentId_SetsAndEmits() public {
        _provider(alice);
        registry.mint(alice, 3);
        vm.expectEmit(true, true, false, false, address(acc));
        emit ChainPeAccounts.AgentIdUpdated(alice, 3);
        vm.prank(alice);
        acc.setAgentId(3);
        assertEq(_agentIdOf(alice), 3);
    }

    function test_SetAgentId_ClearWithZero() public {
        registry.mint(alice, 3);
        vm.prank(alice);
        acc.registerProvider(3);
        vm.expectEmit(true, true, false, false, address(acc));
        emit ChainPeAccounts.AgentIdUpdated(alice, 0);
        vm.prank(alice);
        acc.setAgentId(0);
        assertEq(_agentIdOf(alice), 0);
    }

    function test_SetAgentId_NotOwnerReverts() public {
        _provider(alice);
        registry.mint(bob, 4);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.NotAgentOwner.selector, 4, alice));
        acc.setAgentId(4);
    }

    function test_SetAgentId_RequiresProvider() public {
        registry.mint(bob, 4);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ProviderNotFound.selector, bob));
        acc.setAgentId(4);
    }

    function test_SetAgentId_DoesNotChangeExistingServiceSnapshot_UpdateRefreshes() public {
        registry.mint(alice, 8);
        vm.prank(alice);
        acc.registerProvider(8);
        bytes32 key = _register(alice, "a");
        assertEq(acc.getService(key).agentId, 8);

        vm.prank(alice);
        acc.setAgentId(0);
        assertEq(acc.getService(key).agentId, 8);

        vm.prank(alice);
        acc.updateService(_input("a"));
        assertEq(acc.getService(key).agentId, 0);
    }

    // ------------------------------------------------------------ subscribe

    function test_Subscribe_PullsExactAmountToTreasuryAndSetsPaidUntil() public {
        _provider(alice);
        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        usdc.approve(address(acc), type(uint256).max);

        vm.expectEmit(true, false, false, true, address(acc));
        emit ChainPeAccounts.Subscribed(alice, 3, 3 * PRICE, uint64(T0 + 3 * PERIOD));
        acc.subscribe(3);
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury), 3 * PRICE);
        assertEq(usdc.balanceOf(alice), 100e6 - 3 * PRICE);
        assertEq(usdc.balanceOf(address(acc)), 0);
        assertEq(_paidUntil(alice), T0 + 3 * PERIOD);
        assertEq(acc.planOf(alice), 1);
    }

    function test_Subscribe_TwiceStacks() public {
        _provider(alice);
        _subscribe(alice, 1);
        _subscribe(alice, 2);
        assertEq(_paidUntil(alice), T0 + 3 * PERIOD);
        assertEq(usdc.balanceOf(treasury), 3 * PRICE);
    }

    function test_Subscribe_StacksOntoRemainingTime() public {
        _provider(alice);
        _subscribe(alice, 1);
        skip(10 days);
        _subscribe(alice, 1);
        assertEq(_paidUntil(alice), T0 + 2 * PERIOD);
    }

    function test_Subscribe_RestartsFromNowAfterExpiry() public {
        _provider(alice);
        _subscribe(alice, 1);
        skip(45 days);
        assertEq(acc.planOf(alice), 0);
        _subscribe(alice, 2);
        assertEq(_paidUntil(alice), block.timestamp + 2 * PERIOD);
        assertEq(acc.planOf(alice), 1);
    }

    function test_Subscribe_WithoutProviderReverts() public {
        usdc.mint(bob, PRICE);
        vm.startPrank(bob);
        usdc.approve(address(acc), PRICE);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ProviderNotFound.selector, bob));
        acc.subscribe(1);
        vm.stopPrank();
    }

    function test_Subscribe_ZeroPeriodsReverts() public {
        _provider(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.InvalidPeriods.selector, uint8(0)));
        acc.subscribe(0);
    }

    function test_Subscribe_13PeriodsReverts() public {
        _provider(alice);
        usdc.mint(alice, 13 * PRICE);
        vm.startPrank(alice);
        usdc.approve(address(acc), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.InvalidPeriods.selector, uint8(13)));
        acc.subscribe(13);
        vm.stopPrank();
    }

    function test_Subscribe_12PeriodsOk() public {
        _provider(alice);
        _subscribe(alice, 12);
        assertEq(_paidUntil(alice), T0 + 12 * PERIOD);
    }

    function test_Subscribe_RevertsWithoutAllowance() public {
        _provider(alice);
        usdc.mint(alice, PRICE);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(acc), 0, PRICE)
        );
        acc.subscribe(1);
        assertEq(_paidUntil(alice), 0);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_Subscribe_RevertsWithoutBalance() public {
        _provider(alice);
        vm.startPrank(alice);
        usdc.approve(address(acc), PRICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, PRICE));
        acc.subscribe(1);
        vm.stopPrank();
        assertEq(_paidUntil(alice), 0);
        assertEq(acc.planOf(alice), 0);
    }

    function test_Subscribe_FailureLeavesExistingPaidUntilUnchanged() public {
        _provider(alice);
        _subscribe(alice, 1);
        uint64 before_ = _paidUntil(alice);
        vm.prank(alice);
        vm.expectRevert();
        acc.subscribe(1); // no allowance, no balance
        assertEq(_paidUntil(alice), before_);
    }

    function test_Subscribe_UsesPriceAtPurchaseTime() public {
        _provider(alice);
        vm.prank(owner);
        acc.setProPrice(25e6);
        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(acc), 50e6);
        acc.subscribe(2);
        vm.stopPrank();
        assertEq(usdc.balanceOf(treasury), 50e6);
    }

    function testFuzz_Subscribe(uint8 periods, uint256 price, uint32 gap) public {
        periods = uint8(bound(periods, 1, 12));
        price = bound(price, 1, 1e12);
        vm.prank(owner);
        acc.setProPrice(price);
        _provider(alice);

        uint256 amount = price * periods;
        usdc.mint(alice, amount * 2);
        vm.startPrank(alice);
        usdc.approve(address(acc), type(uint256).max);
        acc.subscribe(periods);
        assertEq(usdc.balanceOf(treasury), amount);
        assertEq(usdc.balanceOf(alice), amount);
        assertEq(_paidUntil(alice), T0 + uint256(periods) * PERIOD);

        // second purchase after an arbitrary gap
        uint256 expiry = _paidUntil(alice);
        skip(gap);
        uint256 start = expiry > block.timestamp ? expiry : block.timestamp;
        acc.subscribe(periods);
        vm.stopPrank();
        assertEq(_paidUntil(alice), start + uint256(periods) * PERIOD);
        assertEq(usdc.balanceOf(treasury), amount * 2);
        assertEq(usdc.balanceOf(alice), 0);
    }

    // ------------------------------------------------------------ plan / limits

    function test_PlanOf_FreeThenProThenExpired() public {
        _provider(alice);
        assertEq(acc.planOf(alice), 0);
        _subscribe(alice, 1);
        assertEq(acc.planOf(alice), 1);
        vm.warp(T0 + PERIOD - 1);
        assertEq(acc.planOf(alice), 1);
        vm.warp(T0 + PERIOD);
        assertEq(acc.planOf(alice), 0);
        vm.warp(T0 + PERIOD + 1);
        assertEq(acc.planOf(alice), 0);
    }

    function test_MaxServices_FreeOneProTen() public {
        _provider(alice);
        assertEq(acc.maxServices(alice), 1);
        assertEq(acc.FREE_MAX_SERVICES(), 1);
        assertEq(acc.PRO_MAX_SERVICES(), 10);
        _subscribe(alice, 1);
        assertEq(acc.maxServices(alice), 10);
        skip(PERIOD + 1);
        assertEq(acc.maxServices(alice), 1);
        assertEq(acc.maxServices(bob), 1); // unknown address -> Free
    }

    function test_FreePlan_SecondServiceReverts() public {
        _provider(alice);
        _register(alice, "a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceLimitReached.selector, 1));
        acc.registerService(_input("b"));
    }

    function test_ProPlan_TenServicesAllowedEleventhReverts() public {
        _provider(alice);
        _subscribe(alice, 1);
        for (uint256 k = 0; k < 10; k++) {
            _register(alice, _svcName(k));
        }
        assertEq(_activeServices(alice), 10);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceLimitReached.selector, 10));
        acc.registerService(_input("svc10"));
    }

    function test_ExpiredPro_KeepsServicesActiveButCannotAdd() public {
        _provider(alice);
        _subscribe(alice, 1);
        bytes32[] memory keys = new bytes32[](10);
        for (uint256 k = 0; k < 10; k++) {
            keys[k] = _register(alice, _svcName(k));
        }
        skip(PERIOD + 1);
        assertEq(acc.planOf(alice), 0);
        assertEq(_activeServices(alice), 10);
        for (uint256 k = 0; k < 10; k++) {
            assertTrue(acc.getService(keys[k]).active);
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceLimitReached.selector, 1));
        acc.registerService(_input("extra"));

        // existing services can still be updated
        ChainPeAccounts.ServiceInput memory i = _input(_svcName(0));
        i.endpoint = "https://new.example.com";
        vm.prank(alice);
        acc.updateService(i);
        assertEq(acc.getService(keys[0]).endpoint, "https://new.example.com");
    }

    // ------------------------------------------------------------ registerService

    function test_RegisterService_StoresFieldsAndEmits() public {
        registry.mint(alice, 11);
        vm.prank(alice);
        acc.registerProvider(11);

        ChainPeAccounts.ServiceInput memory i = _input("weather");
        i.acceptsGateway = true;
        _expectRegistered(alice, i, 11);
        bytes32 key = _registerIn(alice, i);

        assertEq(key, acc.computeKey(alice, "weather"));
        ChainPeAccounts.Service memory s = acc.getService(key);
        assertEq(s.key, key);
        assertEq(s.provider, alice);
        assertEq(s.payTo, payTo);
        assertEq(s.agentId, 11);
        assertEq(s.name, "weather");
        assertEq(s.description, "desc");
        assertEq(s.tags, "tag1,tag2");
        assertEq(s.endpoint, "https://api.example.com/v1");
        assertEq(s.pricePerRequest, "0.01");
        assertEq(s.network, "arc-testnet");
        assertTrue(s.acceptsExact);
        assertTrue(s.acceptsGateway);
        assertTrue(s.active);
        assertEq(s.createdAt, T0);
        assertEq(s.updatedAt, T0);
        assertEq(_activeServices(alice), 1);
        assertEq(acc.serviceCount(), 1);
    }

    function test_RegisterService_WithoutProviderReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ProviderNotFound.selector, bob));
        acc.registerService(_input("a"));
    }

    function test_RegisterService_ActiveKeyReverts() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceAlreadyActive.selector, key));
        acc.registerService(_input("a"));
    }

    function test_RegisterService_SameNameDifferentProvidersDistinctKeys() public {
        _provider(alice);
        _provider(bob);
        bytes32 k1 = _register(alice, "a");
        bytes32 k2 = _register(bob, "a");
        assertTrue(k1 != k2);
        assertEq(acc.serviceCount(), 2);
    }

    // ------------------------------------------------------------ updateService

    function test_UpdateService_OverwritesKeepsCreatedAtAndActive() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        skip(1 days);

        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.description = "new desc";
        i.tags = "x";
        i.endpoint = "https://other.example.com";
        i.pricePerRequest = "2.5";
        i.network = "base";
        i.payTo = bob;
        i.acceptsExact = false;
        i.acceptsGateway = true;
        _expectUpdated(alice, i, 0);
        vm.prank(alice);
        acc.updateService(i);

        ChainPeAccounts.Service memory s = acc.getService(key);
        assertEq(s.createdAt, T0);
        assertEq(s.updatedAt, T0 + 1 days);
        assertTrue(s.active);
        assertEq(_activeServices(alice), 1);
        assertEq(acc.serviceCount(), 1);
        assertEq(s.description, "new desc");
        assertEq(s.tags, "x");
        assertEq(s.endpoint, "https://other.example.com");
        assertEq(s.pricePerRequest, "2.5");
        assertEq(s.network, "base");
        assertEq(s.payTo, bob);
        assertFalse(s.acceptsExact);
        assertTrue(s.acceptsGateway);
    }

    function test_UpdateService_InactiveReverts() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        vm.prank(alice);
        acc.deactivateService("a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotActive.selector, key));
        acc.updateService(_input("a"));
    }

    function test_UpdateService_NonexistentReverts() public {
        _provider(alice);
        bytes32 key = acc.computeKey(alice, "nope");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotFound.selector, key));
        acc.updateService(_input("nope"));
    }

    function test_UpdateService_OtherAddressCannotReachKey() public {
        _provider(alice);
        _provider(bob);
        bytes32 key = _register(alice, "a");
        bytes32 bobKey = acc.computeKey(bob, "a");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotFound.selector, bobKey));
        acc.updateService(_input("a"));
        assertEq(acc.getService(key).provider, alice);
    }

    function test_UpdateService_WithoutProviderReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ProviderNotFound.selector, bob));
        acc.updateService(_input("a"));
    }

    function test_UpdateService_InvalidInputReverts() public {
        _provider(alice);
        _register(alice, "a");
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.endpoint = "";
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.InvalidStringLength.selector, bytes32("endpoint"), 0));
        acc.updateService(i);
    }

    // ------------------------------------------------------------ deactivateService

    function test_Deactivate_SetsInactiveDecrementsAndEmits() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        skip(2 days);
        vm.expectEmit(true, true, false, false, address(acc));
        emit ChainPeAccounts.ServiceDeactivated(key, alice);
        vm.prank(alice);
        acc.deactivateService("a");

        ChainPeAccounts.Service memory s = acc.getService(key);
        assertFalse(s.active);
        assertEq(s.createdAt, T0);
        assertEq(s.updatedAt, T0 + 2 days);
        assertEq(_activeServices(alice), 0);
        assertEq(acc.serviceCount(), 1);
    }

    function test_Deactivate_FreesSlotForAnotherService() public {
        _provider(alice);
        _register(alice, "a");
        vm.prank(alice);
        acc.deactivateService("a");
        _register(alice, "b");
        assertEq(_activeServices(alice), 1);
    }

    function test_Deactivate_AlreadyInactiveReverts() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        vm.startPrank(alice);
        acc.deactivateService("a");
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotActive.selector, key));
        acc.deactivateService("a");
        vm.stopPrank();
        assertEq(_activeServices(alice), 0);
    }

    function test_Deactivate_NonexistentReverts() public {
        _provider(alice);
        bytes32 key = acc.computeKey(alice, "zzz");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotFound.selector, key));
        acc.deactivateService("zzz");
    }

    function test_Deactivate_OtherAddressCannotReachKey() public {
        _provider(alice);
        _provider(bob);
        bytes32 key = _register(alice, "a");
        bytes32 bobKey = acc.computeKey(bob, "a");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotFound.selector, bobKey));
        acc.deactivateService("a");
        assertTrue(acc.getService(key).active);
        assertEq(_activeServices(alice), 1);
    }

    function test_Deactivate_WithoutProviderStillNotFound() public {
        bytes32 carolKey = acc.computeKey(carol, "a");
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotFound.selector, carolKey));
        acc.deactivateService("a");
    }

    // ------------------------------------------------------------ reactivation

    function test_Reactivate_SameKeyKeepsCreatedAtOverwritesFieldsNoDuplicate() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        vm.prank(alice);
        acc.deactivateService("a");
        skip(5 days);

        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.description = "reborn";
        i.endpoint = "https://reborn.example.com";
        i.pricePerRequest = "9";
        i.network = "eth";
        i.payTo = carol;
        i.acceptsExact = false;
        i.acceptsGateway = true;
        _expectRegistered(alice, i, 0);
        bytes32 key2 = _registerIn(alice, i);

        assertEq(key2, key);
        ChainPeAccounts.Service memory s = acc.getService(key);
        assertTrue(s.active);
        assertEq(s.createdAt, T0);
        assertEq(s.updatedAt, T0 + 5 days);
        assertEq(s.description, "reborn");
        assertEq(s.endpoint, "https://reborn.example.com");
        assertEq(s.pricePerRequest, "9");
        assertEq(s.network, "eth");
        assertEq(s.payTo, carol);
        assertFalse(s.acceptsExact);
        assertTrue(s.acceptsGateway);
        assertEq(acc.servicesOf(alice).length, 1);
        assertEq(acc.serviceCount(), 1);
        assertEq(_activeServices(alice), 1);
    }

    function test_Reactivate_CountsAgainstFreeLimit() public {
        _provider(alice);
        bytes32 keyA = _register(alice, "a");
        vm.prank(alice);
        acc.deactivateService("a");
        _register(alice, "b");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceLimitReached.selector, 1));
        acc.registerService(_input("a"));
        assertFalse(acc.getService(keyA).active);
        assertEq(_activeServices(alice), 1);
    }

    function test_Reactivate_UsesCurrentAgentIdSnapshot() public {
        _provider(alice);
        bytes32 key = _register(alice, "a");
        registry.mint(alice, 21);
        vm.startPrank(alice);
        acc.setAgentId(21);
        acc.deactivateService("a");
        acc.registerService(_input("a"));
        vm.stopPrank();
        assertEq(acc.getService(key).agentId, 21);
    }

    // ------------------------------------------------------------ validation

    function _expectLen(string memory field, uint256 len) internal {
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.InvalidStringLength.selector, bytes32(bytes(field)), len));
    }

    function test_Validation_NameEmptyReverts() public {
        _provider(alice);
        _expectLen("name", 0);
        vm.prank(alice);
        acc.registerService(_input(""));
    }

    function test_Validation_Name65Reverts_64Ok() public {
        _provider(alice);
        _expectLen("name", 65);
        vm.prank(alice);
        acc.registerService(_input(_rep(65)));
        bytes32 key = _register(alice, _rep(64));
        assertEq(bytes(acc.getService(key).name).length, 64);
    }

    function test_Validation_EndpointEmptyReverts() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.endpoint = "";
        _expectLen("endpoint", 0);
        vm.prank(alice);
        acc.registerService(i);
    }

    function test_Validation_Endpoint257Reverts_256Ok() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.endpoint = _rep(257);
        _expectLen("endpoint", 257);
        vm.prank(alice);
        acc.registerService(i);
        i.endpoint = _rep(256);
        bytes32 key = _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).endpoint).length, 256);
    }

    function test_Validation_PriceEmptyReverts() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.pricePerRequest = "";
        _expectLen("pricePerRequest", 0);
        vm.prank(alice);
        acc.registerService(i);
    }

    function test_Validation_Price33Reverts_32Ok() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.pricePerRequest = _repDigit(33);
        _expectLen("pricePerRequest", 33);
        vm.prank(alice);
        acc.registerService(i);
        i.pricePerRequest = _repDigit(32);
        bytes32 key = _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).pricePerRequest).length, 32);
    }

    function test_Validation_ZeroPriceStringsRevert() public {
        _provider(alice);
        string[] memory zeros = new string[](5);
        zeros[0] = "0";
        zeros[1] = "0.00";
        zeros[2] = "000";
        zeros[3] = "0.0";
        zeros[4] = "00.000000";
        for (uint256 k = 0; k < zeros.length; k++) {
            ChainPeAccounts.ServiceInput memory i = _input("a");
            i.pricePerRequest = zeros[k];
            vm.prank(alice);
            vm.expectRevert(ChainPeAccounts.ZeroPrice.selector);
            acc.registerService(i);
        }
    }

    function test_Validation_SmallNonzeroPricesAccepted() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.pricePerRequest = "0.000001";
        bytes32 key = _registerIn(alice, i);
        assertEq(acc.getService(key).pricePerRequest, "0.000001");
    }

    function test_Validation_NetworkEmptyReverts() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.network = "";
        _expectLen("network", 0);
        vm.prank(alice);
        acc.registerService(i);
    }

    function test_Validation_Network33Reverts_32Ok() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.network = _rep(33);
        _expectLen("network", 33);
        vm.prank(alice);
        acc.registerService(i);
        i.network = _rep(32);
        bytes32 key = _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).network).length, 32);
    }

    function test_Validation_Description1025Reverts_1024Ok_EmptyOk() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.description = _rep(1025);
        _expectLen("description", 1025);
        vm.prank(alice);
        acc.registerService(i);
        i.description = _rep(1024);
        bytes32 key = _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).description).length, 1024);

        vm.prank(alice);
        acc.deactivateService("a");
        i.description = "";
        _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).description).length, 0);
    }

    function test_Validation_Tags257Reverts_256Ok_EmptyOk() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.tags = _rep(257);
        _expectLen("tags", 257);
        vm.prank(alice);
        acc.registerService(i);
        i.tags = _rep(256);
        bytes32 key = _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).tags).length, 256);

        vm.prank(alice);
        acc.deactivateService("a");
        i.tags = "";
        _registerIn(alice, i);
        assertEq(bytes(acc.getService(key).tags).length, 0);
    }

    function test_Validation_PayToZeroReverts() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.payTo = address(0);
        vm.prank(alice);
        vm.expectRevert(ChainPeAccounts.ZeroAddress.selector);
        acc.registerService(i);
    }

    function test_Validation_NoRailReverts_GatewayOnlyOk() public {
        _provider(alice);
        ChainPeAccounts.ServiceInput memory i = _input("a");
        i.acceptsExact = false;
        i.acceptsGateway = false;
        vm.prank(alice);
        vm.expectRevert(ChainPeAccounts.NoPaymentRail.selector);
        acc.registerService(i);
        i.acceptsGateway = true;
        bytes32 key = _registerIn(alice, i);
        assertTrue(acc.getService(key).acceptsGateway);
        assertFalse(acc.getService(key).acceptsExact);
    }

    // ------------------------------------------------------------ pause

    function test_Pause_BlocksEveryWrite() public {
        _provider(alice);
        _subscribe(alice, 1);
        _register(alice, "a");
        registry.mint(alice, 2);
        usdc.mint(alice, PRICE);
        vm.prank(alice);
        usdc.approve(address(acc), PRICE);

        vm.prank(owner);
        acc.pause();
        assertTrue(acc.paused());

        bytes memory err = abi.encodeWithSelector(Pausable.EnforcedPause.selector);
        vm.startPrank(alice);
        vm.expectRevert(err);
        acc.registerProvider(0);
        vm.expectRevert(err);
        acc.setAgentId(2);
        vm.expectRevert(err);
        acc.registerService(_input("b"));
        vm.expectRevert(err);
        acc.updateService(_input("a"));
        vm.expectRevert(err);
        acc.deactivateService("a");
        vm.expectRevert(err);
        acc.subscribe(1);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(err);
        acc.registerProvider(0);
    }

    function test_Pause_ViewsAndOwnerFunctionsStillWork() public {
        _provider(alice);
        _subscribe(alice, 1);
        bytes32 key = _register(alice, "a");
        vm.prank(owner);
        acc.pause();

        assertEq(acc.planOf(alice), 1);
        assertEq(acc.maxServices(alice), 10);
        assertEq(acc.getService(key).name, "a");
        assertEq(acc.servicesOf(alice).length, 1);
        assertEq(acc.getServices(0, 10).length, 1);
        assertEq(acc.serviceCount(), 1);
        assertEq(acc.computeKey(alice, "a"), key);

        vm.startPrank(owner);
        acc.setProPrice(1);
        acc.setTreasury(bob);
        acc.unpause();
        vm.stopPrank();
        assertFalse(acc.paused());
        assertEq(acc.proPricePerPeriod(), 1);
        assertEq(acc.treasury(), bob);

        _provider(carol); // writes work again
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        acc.pause();
        vm.prank(owner);
        acc.pause();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        acc.unpause();
    }

    // ------------------------------------------------------------ views

    function test_GetService_UnknownKeyReverts() public {
        bytes32 key = keccak256("unknown");
        vm.expectRevert(abi.encodeWithSelector(ChainPeAccounts.ServiceNotFound.selector, key));
        acc.getService(key);
    }

    function test_ServicesOf_ReturnsKeysIncludingInactive() public {
        _provider(alice);
        _subscribe(alice, 1);
        bytes32 k0 = _register(alice, "a");
        bytes32 k1 = _register(alice, "b");
        vm.prank(alice);
        acc.deactivateService("a");

        bytes32[] memory keys = acc.servicesOf(alice);
        assertEq(keys.length, 2);
        assertEq(keys[0], k0);
        assertEq(keys[1], k1);
        assertEq(acc.servicesOf(bob).length, 0);
    }

    function test_ComputeKey_MatchesAbiEncodedHash() public view {
        assertEq(acc.computeKey(alice, "x"), keccak256(abi.encode(alice, "x")));
    }

    function test_GetServices_PaginationOrderAndInactiveIncluded() public {
        _provider(alice);
        _subscribe(alice, 1);
        for (uint256 k = 0; k < 5; k++) {
            _register(alice, _svcName(k));
        }
        vm.prank(alice);
        acc.deactivateService("svc1");

        ChainPeAccounts.Service[] memory page = acc.getServices(1, 3);
        assertEq(page.length, 3);
        assertEq(page[0].name, "svc1");
        assertFalse(page[0].active);
        assertEq(page[1].name, "svc2");
        assertEq(page[2].name, "svc3");

        page = acc.getServices(3, 10);
        assertEq(page.length, 2);
        assertEq(page[1].name, "svc4");

        assertEq(acc.getServices(0, 5).length, 5);
    }

    function test_GetServices_OffsetPastEndAndZeroLimitEmpty() public {
        _provider(alice);
        _register(alice, "a");
        assertEq(acc.getServices(1, 10).length, 0);
        assertEq(acc.getServices(2, 10).length, 0);
        assertEq(acc.getServices(type(uint256).max, 10).length, 0);
        assertEq(acc.getServices(0, 0).length, 0);
        assertEq(acc.getServices(0, 1).length, 1);
    }

    function test_GetServices_EmptyRegistry() public view {
        assertEq(acc.getServices(0, 10).length, 0);
    }

    function test_GetServices_CapsAt100() public {
        uint256 n = 105;
        for (uint256 k = 0; k < n; k++) {
            address p = address(uint160(0x10000 + k));
            vm.prank(p);
            acc.registerProvider(0);
            vm.prank(p);
            acc.registerService(_input(_svcName(k)));
        }
        assertEq(acc.serviceCount(), n);
        assertEq(acc.MAX_SERVICES_PER_PAGE(), 100);

        assertEq(acc.getServices(0, 1000).length, 100);
        assertEq(acc.getServices(0, 100).length, 100);
        assertEq(acc.getServices(0, 101).length, 100);
        assertEq(acc.getServices(0, type(uint256).max).length, 100);
        assertEq(acc.getServices(100, 1000).length, 5);
        assertEq(acc.getServices(104, 1000).length, 1);
        assertEq(acc.getServices(105, 1000).length, 0);
        assertEq(acc.getServices(0, 1000)[99].name, "svc99");
        assertEq(acc.getServices(5, 1000)[0].name, "svc5");
    }

    // ------------------------------------------------------------ admin

    function test_SetProPrice_UpdatesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(acc));
        emit ChainPeAccounts.ProPriceUpdated(PRICE, 42e6);
        vm.prank(owner);
        acc.setProPrice(42e6);
        assertEq(acc.proPricePerPeriod(), 42e6);
    }

    function test_SetProPrice_ZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(ChainPeAccounts.ZeroPrice.selector);
        acc.setProPrice(0);
        assertEq(acc.proPricePerPeriod(), PRICE);
    }

    function test_SetProPrice_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        acc.setProPrice(1);
    }

    function test_SetTreasury_UpdatesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(acc));
        emit ChainPeAccounts.TreasuryUpdated(treasury, bob);
        vm.prank(owner);
        acc.setTreasury(bob);
        assertEq(acc.treasury(), bob);
    }

    function test_SetTreasury_ZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(ChainPeAccounts.ZeroAddress.selector);
        acc.setTreasury(address(0));
        assertEq(acc.treasury(), treasury);
    }

    function test_SetTreasury_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        acc.setTreasury(bob);
    }

    function test_SetTreasury_NewTreasuryReceivesLaterFunds() public {
        _provider(alice);
        _subscribe(alice, 1);
        assertEq(usdc.balanceOf(treasury), PRICE);

        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        acc.setTreasury(newTreasury);
        _subscribe(alice, 2);

        assertEq(usdc.balanceOf(treasury), PRICE);
        assertEq(usdc.balanceOf(newTreasury), 2 * PRICE);
    }

    // ------------------------------------------------------------ ownership

    function test_RenounceOwnership_RevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(ChainPeAccounts.RenounceDisabled.selector);
        acc.renounceOwnership();
        assertEq(acc.owner(), owner);
    }

    function test_RenounceOwnership_RevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(ChainPeAccounts.RenounceDisabled.selector);
        acc.renounceOwnership();
        assertEq(acc.owner(), owner);
    }

    function test_TransferOwnership_OnlySetsPending() public {
        vm.prank(owner);
        acc.transferOwnership(bob);
        assertEq(acc.owner(), owner);
        assertEq(acc.pendingOwner(), bob);

        // bob has no powers yet, owner keeps them
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        acc.setProPrice(1);
        vm.prank(owner);
        acc.setProPrice(1);
    }

    function test_TransferOwnership_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        acc.transferOwnership(alice);
    }

    function test_AcceptOwnership_WrongAddressReverts() public {
        vm.prank(owner);
        acc.transferOwnership(bob);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        acc.acceptOwnership();
        assertEq(acc.owner(), owner);
        assertEq(acc.pendingOwner(), bob);
    }

    function test_AcceptOwnership_PendingCompletesAndOldOwnerLosesPowers() public {
        vm.prank(owner);
        acc.transferOwnership(bob);
        vm.prank(bob);
        acc.acceptOwnership();
        assertEq(acc.owner(), bob);
        assertEq(acc.pendingOwner(), address(0));

        vm.startPrank(owner);
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner);
        vm.expectRevert(err);
        acc.setProPrice(1);
        vm.expectRevert(err);
        acc.setTreasury(alice);
        vm.expectRevert(err);
        acc.pause();
        vm.stopPrank();

        vm.prank(bob);
        acc.setProPrice(7);
        assertEq(acc.proPricePerPeriod(), 7);
    }
}
