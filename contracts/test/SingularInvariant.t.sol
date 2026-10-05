// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {SingularNativePoolManager} from "../src/SingularNativePoolManager.sol";
import {MockRandomnessProvider} from "../src/MockRandomnessProvider.sol";

contract SingularHandler is Test {
    SingularNativePoolManager public manager;
    MockRandomnessProvider public random;
    address public immutable providerOwner;
    address public constant ALICE = address(0xA11CE);
    address public constant BOB = address(0xB0B);
    address public fixedWinner;
    uint32 public fixedTicket;
    bool public hasResolved;

    constructor(SingularNativePoolManager manager_, MockRandomnessProvider random_, address owner_) {
        manager = manager_;
        random = random_;
        providerOwner = owner_;
    }

    function buy(uint8 who, uint8 quantitySeed) external {
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        if (
            pool.status != SingularNativePoolManager.Status.WAITING
                && pool.status != SingularNativePoolManager.Status.LIVE
        ) return;
        uint32 remaining = pool.capacity - pool.entriesSold;
        if (remaining == 0) return;
        uint32 quantity = uint32(bound(quantitySeed, 1, remaining));
        address buyer = who % 2 == 0 ? ALICE : BOB;
        vm.deal(buyer, 10 ether);
        vm.prank(buyer);
        try manager.buyEntries{value: uint256(quantity) * 0.01 ether}(1, quantity) {} catch {}
    }

    function advance(uint16 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 0, 240));
    }

    function fulfill(uint256 randomValue) external {
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        if (pool.status != SingularNativePoolManager.Status.DRAWING) return;
        vm.prank(providerOwner);
        random.fulfill(pool.randomnessRequestId, randomValue);
        pool = manager.getPool(1);
        fixedWinner = pool.winner;
        fixedTicket = pool.winningTicket;
        hasResolved = true;
    }

    function claim(uint8 who) external {
        address claimant = who % 2 == 0 ? ALICE : BOB;
        vm.prank(claimant);
        try manager.claimPrize(1) {} catch {}
    }

    function refund(uint8 who) external {
        address claimant = who % 2 == 0 ? ALICE : BOB;
        vm.prank(claimant);
        try manager.claimRefund(1) {} catch {}
    }

    function sweep() external {
        try manager.sweepProtocolFee(1) {} catch {}
    }
}

contract SingularInvariantTest is StdInvariant, Test {
    SingularNativePoolManager manager;
    MockRandomnessProvider random;
    SingularHandler handler;

    function setUp() public {
        vm.warp(1_000_000);
        random = new MockRandomnessProvider(address(this));
        manager = new SingularNativePoolManager(address(this), address(random), address(this));
        random.setManager(address(manager));
        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        handler = new SingularHandler(manager, random, address(this));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.buy.selector;
        selectors[1] = handler.advance.selector;
        selectors[2] = handler.fulfill.selector;
        selectors[3] = handler.claim.selector;
        selectors[4] = handler.refund.selector;
        selectors[5] = handler.sweep.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_AssetsEqualLiabilities() public view {
        assertEq(address(manager).balance, manager.totalLiabilities());
        assertEq(address(manager.feeVault()).balance, manager.feeVault().availableFees());
    }

    function invariant_CapacityAndTicketOwnership() public view {
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        assertLe(pool.entriesSold, pool.capacity);
        for (uint32 i; i < pool.entriesSold; ++i) {
            assertTrue(manager.getTicketOwner(1, i) != address(0));
        }
        assertEq(manager.getTicketOwner(1, pool.entriesSold), address(0));
    }

    function invariant_OutcomeAndRefundExclusivity() public view {
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        if (pool.status == SingularNativePoolManager.Status.COMPLETED) {
            assertTrue(pool.winner != address(0));
            assertLt(pool.winningTicket, pool.capacity);
            assertEq(pool.winner, manager.getTicketOwner(1, pool.winningTicket));
            assertEq(manager.getRefundableAmount(1, handler.ALICE()), 0);
            assertEq(manager.getRefundableAmount(1, handler.BOB()), 0);
        }
        if (pool.status == SingularNativePoolManager.Status.EXPIRED) assertEq(pool.winner, address(0));
        if (handler.hasResolved()) {
            assertEq(pool.winner, handler.fixedWinner());
            assertEq(pool.winningTicket, handler.fixedTicket());
        }
    }

    function invariant_RefundsNeverExceedContributions() public view {
        assertLe(
            manager.totalRefunded(),
            manager.getContribution(1, handler.ALICE()) + manager.getContribution(1, handler.BOB())
        );
        assertLe(manager.totalPrizeClaimed(), 0.1 ether);
        assertLe(manager.totalFeesRealized(), 0.01 ether);
    }
}
