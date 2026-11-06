// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ChainPeFees} from "../ChainPeFees.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ChainPeFeesTest is Test {
    event FeeCollected(bytes32 indexed batchId, address indexed provider, uint256 revenueAtomic, uint256 feeAtomic);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event CollectorUpdated(address indexed oldCollector, address indexed newCollector);

    MockUSDC internal usdc;
    ChainPeFees internal fees;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal collector = makeAddr("collector");
    address internal provider = makeAddr("provider");
    address internal rando = makeAddr("rando");

    bytes32 internal constant BATCH = keccak256("batch-1");
    uint256 internal constant REVENUE = 1_000e6;
    uint256 internal constant FEE = 50e6; // exactly 5%

    function setUp() public {
        usdc = new MockUSDC();
        fees = new ChainPeFees(IERC20(address(usdc)), treasury, collector, owner);
        usdc.mint(provider, 10_000e6);
        vm.prank(provider);
        usdc.approve(address(fees), type(uint256).max);
    }

    function _collect(address p, uint256 rev, uint256 fee, bytes32 id) internal {
        vm.prank(collector);
        fees.collect(p, rev, fee, id);
    }

    // ---------------------------------------------------------------- constructor

    function test_Constructor_StoresValuesAndConstants() public view {
        assertEq(address(fees.usdc()), address(usdc));
        assertEq(fees.treasury(), treasury);
        assertEq(fees.collector(), collector);
        assertEq(fees.owner(), owner);
        assertEq(fees.MAX_FEE_BPS(), 500);
        assertFalse(fees.paused());
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(ChainPeFees.ZeroAddress.selector);
        new ChainPeFees(IERC20(address(0)), treasury, collector, owner);
    }

    function test_Constructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(ChainPeFees.ZeroAddress.selector);
        new ChainPeFees(IERC20(address(usdc)), address(0), collector, owner);
    }

    function test_Constructor_RevertsOnZeroCollector() public {
        vm.expectRevert(ChainPeFees.ZeroAddress.selector);
        new ChainPeFees(IERC20(address(usdc)), treasury, address(0), owner);
    }

    function test_Constructor_RevertsOnZeroInitialOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ChainPeFees(IERC20(address(usdc)), treasury, collector, address(0));
    }

    // ---------------------------------------------------------------- collect happy path

    function test_Collect_MovesFeeFromProviderToTreasury() public {
        uint256 providerBefore = usdc.balanceOf(provider);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        _collect(provider, REVENUE, FEE, BATCH);
        assertEq(usdc.balanceOf(provider), providerBefore - FEE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + FEE);
    }

    function test_Collect_EmitsFeeCollected() public {
        vm.expectEmit(true, true, false, true, address(fees));
        emit FeeCollected(BATCH, provider, REVENUE, FEE);
        _collect(provider, REVENUE, FEE, BATCH);
    }

    function test_Collect_MarksBatchCollected() public {
        assertFalse(fees.batchCollected(BATCH));
        _collect(provider, REVENUE, FEE, BATCH);
        assertTrue(fees.batchCollected(BATCH));
    }

    function test_Collect_LeavesNoUsdcInContract() public {
        _collect(provider, REVENUE, FEE, BATCH);
        assertEq(usdc.balanceOf(address(fees)), 0);
    }

    // ---------------------------------------------------------------- collect access / reverts

    function test_Collect_RevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ChainPeFees.NotCollector.selector, owner));
        fees.collect(provider, REVENUE, FEE, BATCH);
    }

    function test_Collect_RevertsForRandomCaller() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(ChainPeFees.NotCollector.selector, rando));
        fees.collect(provider, REVENUE, FEE, BATCH);
    }

    function test_Collect_RevertsOnRepeatedBatchId() public {
        _collect(provider, REVENUE, FEE, BATCH);
        vm.prank(collector);
        vm.expectRevert(abi.encodeWithSelector(ChainPeFees.BatchAlreadyCollected.selector, BATCH));
        fees.collect(provider, REVENUE, FEE, BATCH);
    }

    function test_Collect_FeeExactlyFivePercentPasses() public {
        _collect(provider, 1_000e6, 50e6, BATCH);
        assertTrue(fees.batchCollected(BATCH));
    }

    function test_Collect_FeeOneAtomicAboveCapReverts() public {
        vm.prank(collector);
        vm.expectRevert(abi.encodeWithSelector(ChainPeFees.FeeExceedsMaximum.selector, 1_000e6, 50e6 + 1));
        fees.collect(provider, 1_000e6, 50e6 + 1, BATCH);
        assertFalse(fees.batchCollected(BATCH));
    }

    function test_Collect_RevertsOnZeroFee() public {
        vm.prank(collector);
        vm.expectRevert(ChainPeFees.ZeroFee.selector);
        fees.collect(provider, REVENUE, 0, BATCH);
    }

    function test_Collect_RevertsOnZeroBatchId() public {
        vm.prank(collector);
        vm.expectRevert(ChainPeFees.ZeroBatchId.selector);
        fees.collect(provider, REVENUE, FEE, bytes32(0));
    }

    function test_Collect_RevertsOnZeroProvider() public {
        vm.prank(collector);
        vm.expectRevert(ChainPeFees.ZeroProvider.selector);
        fees.collect(address(0), REVENUE, FEE, BATCH);
    }

    function test_Collect_RevertsWithoutAllowanceAndBatchStaysUncollected() public {
        address noAllow = makeAddr("noAllow");
        usdc.mint(noAllow, 1_000e6);
        vm.prank(collector);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(fees), 0, FEE)
        );
        fees.collect(noAllow, REVENUE, FEE, BATCH);
        assertFalse(fees.batchCollected(BATCH));
    }

    function test_Collect_RevertsAfterAllowanceRevoked() public {
        vm.prank(provider);
        usdc.approve(address(fees), 100e6);
        vm.prank(provider);
        usdc.approve(address(fees), 0);
        vm.prank(collector);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(fees), 0, FEE)
        );
        fees.collect(provider, REVENUE, FEE, BATCH);
        assertFalse(fees.batchCollected(BATCH));
    }

    // ---------------------------------------------------------------- pause

    function test_Pause_BlocksCollectAndUnpauseRestores() public {
        vm.prank(owner);
        fees.pause();
        assertTrue(fees.paused());

        vm.prank(collector);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fees.collect(provider, REVENUE, FEE, BATCH);

        vm.prank(owner);
        fees.unpause();
        assertFalse(fees.paused());

        _collect(provider, REVENUE, FEE, BATCH);
        assertTrue(fees.batchCollected(BATCH));
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        fees.pause();
    }

    function test_Unpause_OnlyOwner() public {
        vm.prank(owner);
        fees.pause();
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        fees.unpause();
        assertTrue(fees.paused());
    }

    // ---------------------------------------------------------------- setTreasury

    function test_SetTreasury_OwnerUpdatesAndEmits() public {
        address newTreasury = makeAddr("newTreasury");
        vm.expectEmit(true, true, false, false, address(fees));
        emit TreasuryUpdated(treasury, newTreasury);
        vm.prank(owner);
        fees.setTreasury(newTreasury);
        assertEq(fees.treasury(), newTreasury);
    }

    function test_SetTreasury_NewTreasuryReceivesFees() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        fees.setTreasury(newTreasury);
        _collect(provider, REVENUE, FEE, BATCH);
        assertEq(usdc.balanceOf(newTreasury), FEE);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_SetTreasury_OnlyOwner() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        fees.setTreasury(makeAddr("x"));
    }

    function test_SetTreasury_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(ChainPeFees.ZeroAddress.selector);
        fees.setTreasury(address(0));
    }

    // ---------------------------------------------------------------- setCollector

    function test_SetCollector_OwnerUpdatesAndEmits() public {
        address newCollector = makeAddr("newCollector");
        vm.expectEmit(true, true, false, false, address(fees));
        emit CollectorUpdated(collector, newCollector);
        vm.prank(owner);
        fees.setCollector(newCollector);
        assertEq(fees.collector(), newCollector);
    }

    function test_SetCollector_NewCollectorTakesEffect() public {
        address newCollector = makeAddr("newCollector");
        vm.prank(owner);
        fees.setCollector(newCollector);

        // old collector no longer allowed
        vm.prank(collector);
        vm.expectRevert(abi.encodeWithSelector(ChainPeFees.NotCollector.selector, collector));
        fees.collect(provider, REVENUE, FEE, BATCH);

        // new collector can collect
        vm.prank(newCollector);
        fees.collect(provider, REVENUE, FEE, BATCH);
        assertTrue(fees.batchCollected(BATCH));
    }

    function test_SetCollector_OnlyOwner() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        fees.setCollector(makeAddr("x"));
    }

    function test_SetCollector_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(ChainPeFees.ZeroAddress.selector);
        fees.setCollector(address(0));
    }

    // ---------------------------------------------------------------- ownership

    function test_RenounceOwnership_RevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(ChainPeFees.RenounceDisabled.selector);
        fees.renounceOwnership();
        assertEq(fees.owner(), owner);
    }

    function test_RenounceOwnership_RevertsForNonOwner() public {
        vm.prank(rando);
        vm.expectRevert(ChainPeFees.RenounceDisabled.selector);
        fees.renounceOwnership();
        assertEq(fees.owner(), owner);
    }

    function test_Ownable2Step_TransferRequiresAccept() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        fees.transferOwnership(newOwner);
        assertEq(fees.owner(), owner);
        assertEq(fees.pendingOwner(), newOwner);

        // pending owner has no powers until accepting
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        fees.pause();

        vm.prank(newOwner);
        fees.acceptOwnership();
        assertEq(fees.owner(), newOwner);
        assertEq(fees.pendingOwner(), address(0));

        // old owner loses power
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        fees.pause();
    }

    function test_Ownable2Step_NonPendingCannotAccept() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        fees.transferOwnership(newOwner);
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        fees.acceptOwnership();
        assertEq(fees.owner(), owner);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_Collect_TreasuryGainEqualsFee(uint256 revenue, uint256 fee, bytes32 batchId) public {
        vm.assume(batchId != bytes32(0));
        revenue = bound(revenue, 20, type(uint96).max);
        uint256 maxFee = (revenue * fees.MAX_FEE_BPS()) / 10_000;
        fee = bound(fee, 1, maxFee);

        address p = makeAddr("fuzzProvider");
        usdc.mint(p, fee);
        vm.prank(p);
        usdc.approve(address(fees), fee);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 providerBefore = usdc.balanceOf(p);
        _collect(p, revenue, fee, batchId);

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, fee);
        assertEq(providerBefore - usdc.balanceOf(p), fee);
        assertEq(usdc.balanceOf(address(fees)), 0);
        assertTrue(fees.batchCollected(batchId));
    }
}
