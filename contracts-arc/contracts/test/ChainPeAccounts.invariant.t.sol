// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdError} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChainPeAccounts} from "../ChainPeAccounts.sol";
import {MockIdentityRegistry, MockUSDC} from "./ChainPeAccounts.t.sol";

/// @dev Drives random valid and invalid calls. Reverts are expected and swallowed.
contract AccountsHandler is Test {
    ChainPeAccounts internal immutable accounts;
    MockUSDC internal immutable usdc;

    address[] public actors;
    uint256 public ghostPaid;
    mapping(address => uint64) public ghostPaidUntil;

    constructor(ChainPeAccounts accounts_, MockUSDC usdc_) {
        accounts = accounts_;
        usdc = usdc_;
        for (uint256 i = 0; i < 3; ++i) {
            address actor = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(actor);
            usdc.mint(actor, 1e15);
            vm.prank(actor);
            usdc.approve(address(accounts), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _input(address actor, uint256 nameSeed) private pure returns (ChainPeAccounts.ServiceInput memory) {
        return ChainPeAccounts.ServiceInput({
            name: string.concat("svc", vm.toString(nameSeed % 14)),
            description: "",
            tags: "",
            endpoint: "https://example.com",
            pricePerRequest: "0.01",
            network: "eip155:5042002",
            payTo: actor,
            acceptsExact: true,
            acceptsGateway: true
        });
    }

    function registerProvider(uint256 actorSeed) external {
        vm.prank(_actor(actorSeed));
        try accounts.registerProvider(0) {} catch {}
    }

    function registerService(uint256 actorSeed, uint256 nameSeed) external {
        address actor = _actor(actorSeed);
        vm.prank(actor);
        try accounts.registerService(_input(actor, nameSeed)) {} catch {}
    }

    function updateService(uint256 actorSeed, uint256 nameSeed) external {
        address actor = _actor(actorSeed);
        vm.prank(actor);
        try accounts.updateService(_input(actor, nameSeed)) {} catch {}
    }

    function deactivateService(uint256 actorSeed, uint256 nameSeed) external {
        address actor = _actor(actorSeed);
        ChainPeAccounts.ServiceInput memory input = _input(actor, nameSeed);
        vm.prank(actor);
        try accounts.deactivateService(input.name) {} catch {}
    }

    function subscribe(uint256 actorSeed, uint8 periods) external {
        address actor = _actor(actorSeed);
        vm.prank(actor);
        try accounts.subscribe(periods) {
            ghostPaid += accounts.proPricePerPeriod() * periods;
            (,,, uint64 paidUntil,) = accounts.providers(actor);
            ghostPaidUntil[actor] = paidUntil;
        } catch {}
    }

    function warp(uint32 seconds_) external {
        vm.warp(block.timestamp + seconds_);
    }
}

contract ChainPeAccountsInvariantTest is Test {
    uint256 internal constant PRICE = 1_000_000;

    ChainPeAccounts internal accounts;
    MockUSDC internal usdc;
    AccountsHandler internal handler;
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        usdc = new MockUSDC();
        MockIdentityRegistry registry = new MockIdentityRegistry();
        accounts = new ChainPeAccounts(IERC20(address(usdc)), treasury, address(registry), PRICE, address(this));
        handler = new AccountsHandler(accounts, usdc);
        targetContract(address(handler));
    }

    /// activeServices equals the number of active services, per provider.
    function invariant_activeServicesMatchesActiveCount() public view {
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address actor = handler.actors(i);
            bytes32[] memory keys = accounts.servicesOf(actor);
            uint256 active;
            for (uint256 k = 0; k < keys.length; ++k) {
                if (accounts.getService(keys[k]).active) ++active;
            }
            (,,,, uint32 activeServices) = accounts.providers(actor);
            assertEq(activeServices, active);
            assertLe(activeServices, accounts.PRO_MAX_SERVICES());
        }
    }

    /// Reactivation never duplicates a key, per provider or globally.
    function invariant_keysAreUnique() public view {
        uint256 total;
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            bytes32[] memory keys = accounts.servicesOf(handler.actors(i));
            total += keys.length;
            for (uint256 a = 0; a < keys.length; ++a) {
                for (uint256 b = a + 1; b < keys.length; ++b) {
                    assertTrue(keys[a] != keys[b]);
                }
            }
        }
        assertEq(accounts.serviceCount(), total);
    }

    /// Every unit paid reached the treasury and none stayed in the contract.
    function invariant_allPaymentsReachTreasury() public view {
        assertEq(usdc.balanceOf(treasury), handler.ghostPaid());
        assertEq(usdc.balanceOf(address(accounts)), 0);
    }

    /// paidUntil only changes through a successful subscribe.
    function invariant_paidUntilMatchesLastSubscribe() public view {
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address actor = handler.actors(i);
            (,,, uint64 paidUntil,) = accounts.providers(actor);
            assertEq(paidUntil, handler.ghostPaidUntil(actor));
        }
    }
}

contract ChainPeAccountsFuzzTest is Test {
    ChainPeAccounts internal accounts;
    MockUSDC internal usdc;
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        MockIdentityRegistry registry = new MockIdentityRegistry();
        accounts = new ChainPeAccounts(IERC20(address(usdc)), treasury, address(registry), 1_000_000, address(this));
        vm.startPrank(alice);
        accounts.registerProvider(0);
        usdc.approve(address(accounts), type(uint256).max);
        vm.stopPrank();
    }

    /// A price too large to multiply reverts, and takes no funds.
    function testFuzz_PriceTimesPeriodsOverflowReverts(uint256 price, uint8 periods) public {
        periods = uint8(bound(periods, 2, 12));
        price = bound(price, type(uint256).max / periods + 1, type(uint256).max);
        accounts.setProPrice(price);
        usdc.mint(alice, 1e12);

        vm.prank(alice);
        vm.expectRevert(stdError.arithmeticError);
        accounts.subscribe(periods);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    /// The exact price * periods moves to the treasury, whatever the price.
    function testFuzz_PriceTimesPeriodsIsExact(uint256 price, uint8 periods) public {
        periods = uint8(bound(periods, 1, 12));
        price = bound(price, 1, type(uint128).max);
        accounts.setProPrice(price);
        uint256 amount = price * periods;
        usdc.mint(alice, amount);

        vm.prank(alice);
        accounts.subscribe(periods);
        assertEq(usdc.balanceOf(treasury), amount);
        assertEq(usdc.balanceOf(alice), 0);
    }

    /// Stacking extends from max(now, paidUntil), across any gaps.
    function testFuzz_PaidUntilStacks(uint8[6] memory periods, uint32[6] memory gaps) public {
        usdc.mint(alice, 1e12);
        uint256 expected;
        for (uint256 i = 0; i < periods.length; ++i) {
            uint256 count = bound(periods[i], 1, 12);
            vm.warp(block.timestamp + gaps[i]);
            uint256 start = expected > block.timestamp ? expected : block.timestamp;
            expected = start + count * 30 days;

            vm.prank(alice);
            accounts.subscribe(uint8(count));
            (,,, uint64 paidUntil,) = accounts.providers(alice);
            assertEq(paidUntil, expected);
            assertEq(accounts.planOf(alice), 1);
        }
    }

    /// After a lapse, the next period starts now, not at the old expiry.
    function testFuzz_ExpiredPlanRestartsFromNow(uint8 periods, uint32 lateBy) public {
        periods = uint8(bound(periods, 1, 12));
        usdc.mint(alice, 1e12);
        vm.startPrank(alice);
        accounts.subscribe(1);
        (,,, uint64 firstExpiry,) = accounts.providers(alice);
        vm.warp(uint256(firstExpiry) + lateBy);
        accounts.subscribe(periods);
        vm.stopPrank();
        (,,, uint64 paidUntil,) = accounts.providers(alice);
        assertEq(paidUntil, block.timestamp + uint256(periods) * 30 days);
    }
}
