// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SingularNativePoolManager} from "../src/SingularNativePoolManager.sol";
import {SingularFeeVault} from "../src/SingularFeeVault.sol";
import {MockRandomnessProvider} from "../src/MockRandomnessProvider.sol";
import {IRandomnessProvider} from "../src/IRandomnessProvider.sol";

contract RevertingProvider is IRandomnessProvider {
    function requestRandomness(uint256) external pure returns (uint256) {
        revert("provider unavailable");
    }
}

contract RejectingWinner {
    SingularNativePoolManager immutable manager;

    constructor(SingularNativePoolManager manager_) {
        manager = manager_;
    }

    function enter(uint256 poolId, uint32 quantity) external payable {
        manager.buyEntries{value: msg.value}(poolId, quantity);
    }

    function claim(uint256 poolId) external {
        manager.claimPrize(poolId);
    }

    function refund(uint256 poolId) external {
        manager.claimRefund(poolId);
    }

    receive() external payable {
        revert("reject BNB");
    }
}

contract SingularNativePoolManagerTest is Test {
    SingularNativePoolManager manager;
    MockRandomnessProvider random;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address stranger = address(0xBAD);

    receive() external payable {}

    function setUp() public {
        vm.warp(1_000_000);
        random = new MockRandomnessProvider(address(this));
        manager = new SingularNativePoolManager(address(this), address(random), address(this));
        random.setManager(address(manager));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        manager.createPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
    }

    function _buy(address buyer, uint32 quantity) internal {
        vm.prank(buyer);
        manager.buyEntries{value: uint256(quantity) * 0.01 ether}(1, quantity);
    }

    function _fill() internal {
        _buy(alice, 5);
        _buy(bob, 6);
    }

    function _resolve(uint256 randomness) internal {
        _fill();
        random.fulfill(1, randomness);
    }

    function testVrfRefundBoundaryIsSixHoursAfterPoolFills() public {
        _fill();
        uint256 filledAt = block.timestamp;
        assertEq(manager.VRF_TIMEOUT(), 6 hours);
        assertEq(manager.drawTimeoutAt(1), filledAt + 6 hours);
        vm.warp(filledAt + 6 hours - 1);
        assertEq(uint8(manager.getEffectiveStatus(1)), uint8(SingularNativePoolManager.Status.DRAWING));
        vm.warp(filledAt + 6 hours);
        assertEq(uint8(manager.getEffectiveStatus(1)), uint8(SingularNativePoolManager.Status.EXPIRED));
        assertEq(manager.getRefundableAmount(1, alice), 0.05 ether);
    }

    function testRecurringPoolRenewsOnlyAfterVerifiedDraw() public {
        uint256 first = manager.createRecurringPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.05 ether}(first, 5);
        assertEq(manager.poolCount(), 2);
        vm.prank(bob);
        manager.buyEntries{value: 0.06 ether}(first, 6);
        assertEq(manager.poolCount(), 2);
        random.fulfill(1, 7);
        assertEq(manager.poolCount(), 3);
        assertEq(manager.renewedFrom(3), first);
        assertTrue(manager.recurringPool(3));
        SingularNativePoolManager.Pool memory original = manager.getPool(first);
        SingularNativePoolManager.Pool memory next = manager.getPool(3);
        assertEq(uint8(original.status), uint8(SingularNativePoolManager.Status.COMPLETED));
        assertEq(uint8(next.status), uint8(SingularNativePoolManager.Status.WAITING));
        assertEq(next.entriesSold, 0);
        assertEq(next.prizeAmount, original.prizeAmount);
        assertEq(next.entryPrice, original.entryPrice);
        assertEq(next.protocolFee, original.protocolFee);
        assertEq(next.capacity, original.capacity);
        assertEq(next.duration, original.duration);
        vm.prank(stranger);
        vm.expectRevert(SingularNativePoolManager.OnlyPoolCreator.selector);
        manager.createRecurringPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
    }

    function testRecurringUnfilledExpiryNeverRenewsAndPreservesRefunds() public {
        uint256 first = manager.createRecurringPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.02 ether}(first, 2);
        vm.warp(manager.getPool(first).deadline);
        assertEq(manager.getRefundableAmount(first, alice), 0.02 ether);
        manager.syncExpired(first);
        assertEq(manager.poolCount(), 2);
        manager.syncExpired(first);
        assertEq(manager.poolCount(), 2);
        assertEq(manager.totalLiabilities(), address(manager).balance);
        vm.prank(alice);
        manager.claimRefund(first);
        assertEq(manager.poolCount(), 2);
        assertEq(manager.totalLiabilities(), address(manager).balance);
    }

    function testRecurringExpiryFirstTriggeredByRefundDoesNotRenew() public {
        uint256 first = manager.createRecurringPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.01 ether}(first, 1);
        vm.warp(manager.getPool(first).deadline);
        vm.prank(alice);
        manager.claimRefund(first);
        assertEq(manager.poolCount(), 2);
        manager.syncExpired(first);
        assertEq(manager.poolCount(), 2);
    }

    function testVrfTimeoutRefundsFullPoolAndIgnoresLateCallback() public {
        uint256 first = manager.createRecurringPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.05 ether}(first, 5);
        vm.prank(bob);
        manager.buyEntries{value: 0.06 ether}(first, 6);
        uint64 timeout = manager.drawTimeoutAt(first);
        vm.warp(timeout - 1);
        assertEq(uint8(manager.getEffectiveStatus(first)), uint8(SingularNativePoolManager.Status.DRAWING));
        vm.warp(timeout);
        assertEq(uint8(manager.getEffectiveStatus(first)), uint8(SingularNativePoolManager.Status.EXPIRED));
        assertEq(manager.getRefundableAmount(first, alice), 0.05 ether);
        manager.syncExpired(first);
        assertEq(manager.poolCount(), 2);
        random.fulfill(1, 7);
        assertEq(uint8(manager.getPool(first).status), uint8(SingularNativePoolManager.Status.EXPIRED));
        assertEq(manager.getPool(first).winner, address(0));
        assertEq(manager.winnerLiabilities(), 0);
        assertEq(manager.protocolFeeLiabilities(), 0);
        assertEq(manager.poolCount(), 2);
        vm.prank(alice);
        manager.claimRefund(first);
        vm.prank(bob);
        manager.claimRefund(first);
        assertEq(manager.totalLiabilities(), 0);
        assertEq(address(manager).balance, 0);
    }

    function testLateVrfCallbackCanTriggerExpiryWithoutRenewal() public {
        uint256 first = manager.createRecurringPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.11 ether}(first, 11);
        vm.warp(manager.drawTimeoutAt(first));
        random.fulfill(1, 5);
        assertEq(manager.poolCount(), 2);
        assertEq(manager.getPool(first).winner, address(0));
        manager.syncExpired(first);
        assertEq(manager.poolCount(), 2);
        assertEq(manager.getRefundableAmount(first, alice), 0.11 ether);
    }

    function testFullPoolRefundCanTriggerTimeoutWithoutAdminOrVrfCallback() public {
        _fill();
        vm.warp(manager.drawTimeoutAt(1));
        uint256 beforeBalance = bob.balance;
        vm.prank(bob);
        manager.claimRefund(1);
        assertEq(bob.balance, beforeBalance + 0.06 ether);
        assertEq(manager.getRefundableAmount(1, alice), 0.05 ether);
        assertEq(manager.winnerLiabilities(), 0);
        assertEq(manager.protocolFeeLiabilities(), 0);
        random.fulfill(1, 8);
        assertEq(manager.getPool(1).winner, address(0));
        assertEq(manager.getRefundableAmount(1, alice), 0.05 ether);
        assertEq(manager.totalLiabilities(), address(manager).balance);
    }

    function testVrfFulfillmentBeforeTimeoutRemainsFinal() public {
        _fill();
        vm.warp(manager.drawTimeoutAt(1) - 1);
        random.fulfill(1, 7);
        vm.warp(block.timestamp + 2);
        assertEq(uint8(manager.getEffectiveStatus(1)), uint8(SingularNativePoolManager.Status.COMPLETED));
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.RefundUnavailable.selector);
        manager.claimRefund(1);
        assertEq(manager.getPool(1).winner, bob);
    }

    function testPoolCreationEconomicsAndWaitingState() public view {
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        assertEq(pool.prizeAmount, 0.1 ether);
        assertEq(pool.entryPrice, 0.01 ether);
        assertEq(pool.protocolFee, 0.01 ether);
        assertEq(pool.capacity, 11);
        assertEq(pool.startTime, 0);
        assertEq(pool.deadline, 0);
        assertEq(uint8(pool.status), uint8(SingularNativePoolManager.Status.WAITING));
        assertEq(address(manager.feeVault()).balance, 0);
    }

    function testInvalidCreationAndBounds() public {
        vm.expectRevert(SingularNativePoolManager.InvalidEconomics.selector);
        manager.createPool(0.11 ether, 0.01 ether, 11, 180, 0.01 ether);
        vm.expectRevert(SingularNativePoolManager.InvalidCapacity.selector);
        manager.createPool(0.1 ether, 0.01 ether, 0, 180, 0.01 ether);
        vm.expectRevert(SingularNativePoolManager.InvalidCapacity.selector);
        manager.createPool(0.1 ether, 0.01 ether, 501, 180, 0.01 ether);
        vm.expectRevert(SingularNativePoolManager.InvalidDuration.selector);
        manager.createPool(0.1 ether, 0.01 ether, 11, 0, 0.01 ether);
        vm.expectRevert(SingularNativePoolManager.InvalidDuration.selector);
        manager.createPool(0.1 ether, 0.01 ether, 11, 31 days, 0.01 ether);
    }

    function testFirstEntryStartsTimerAndLaterEntryDoesNotReset() public {
        _buy(alice, 2);
        SingularNativePoolManager.Pool memory first = manager.getPool(1);
        assertEq(first.startTime, block.timestamp);
        assertEq(first.deadline, block.timestamp + 3 minutes);
        assertEq(uint8(first.status), uint8(SingularNativePoolManager.Status.LIVE));
        vm.warp(block.timestamp + 30);
        _buy(alice, 3);
        SingularNativePoolManager.Pool memory later = manager.getPool(1);
        assertEq(later.startTime, first.startTime);
        assertEq(later.deadline, first.deadline);
        assertEq(later.entriesSold, 5);
        assertEq(manager.getUserEntries(1, alice), 5);
        assertEq(manager.getContribution(1, alice), 0.05 ether);
        uint32[] memory tickets = manager.getUserTicketIds(1, alice);
        for (uint32 i; i < 5; ++i) {
            assertEq(tickets[i], i);
            assertEq(manager.getTicketOwner(1, i), alice);
        }
    }

    function testExactPaymentAndZeroQuantity() public {
        vm.startPrank(alice);
        vm.expectRevert(SingularNativePoolManager.InvalidQuantity.selector);
        manager.buyEntries(1, 0);
        vm.expectRevert(SingularNativePoolManager.IncorrectBNBAmount.selector);
        manager.buyEntries{value: 0.009 ether}(1, 1);
        vm.expectRevert(SingularNativePoolManager.IncorrectBNBAmount.selector);
        manager.buyEntries{value: 0.011 ether}(1, 1);
        vm.stopPrank();
        assertEq(manager.getPool(1).entriesSold, 0);
    }

    function testAdapterPurchaseRecordsBeneficiaryNotCaller() public {
        vm.deal(stranger, 0.03 ether);
        vm.prank(stranger);
        vm.expectRevert(SingularNativePoolManager.InvalidBeneficiary.selector);
        manager.buyEntriesFor{value: 0.01 ether}(1, 1, address(0));
        vm.prank(stranger);
        manager.buyEntriesFor{value: 0.02 ether}(1, 2, alice);
        assertEq(manager.getUserEntries(1, alice), 2);
        assertEq(manager.getUserEntries(1, stranger), 0);
        assertEq(manager.getContribution(1, alice), 0.02 ether);
        assertEq(manager.getTicketOwner(1, 0), alice);
    }

    function testPermissionlessClaimTriggersNeverRedirectPayout() public {
        vm.deal(stranger, 0.11 ether);
        vm.prank(stranger);
        manager.buyEntriesFor{value: 0.11 ether}(1, 11, alice);
        random.fulfill(1, 5);
        vm.prank(stranger);
        vm.expectRevert(SingularNativePoolManager.NotWinner.selector);
        manager.claimPrizeFor(1, stranger);
        uint256 beforeBalance = alice.balance;
        vm.prank(stranger);
        manager.claimPrizeFor(1, alice);
        assertEq(alice.balance, beforeBalance + 0.1 ether);
        assertEq(stranger.balance, 0);

        uint256 secondPool = manager.createPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.deal(stranger, 0.02 ether);
        vm.prank(stranger);
        manager.buyEntriesFor{value: 0.02 ether}(secondPool, 2, bob);
        vm.warp(manager.getPool(secondPool).deadline);
        vm.prank(stranger);
        vm.expectRevert(SingularNativePoolManager.RefundUnavailable.selector);
        manager.claimRefundFor(secondPool, stranger);
        beforeBalance = bob.balance;
        vm.prank(stranger);
        manager.claimRefundFor(secondPool, bob);
        assertEq(bob.balance, beforeBalance + 0.02 ether);
        assertEq(stranger.balance, 0);
    }

    function testOversellAndCompetingFinalEntryRevertWithoutPartialFill() public {
        _buy(alice, 9);
        _buy(bob, 2);
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.PoolNotAcceptingEntries.selector);
        manager.buyEntries{value: 0.02 ether}(1, 2);
        assertEq(manager.getPool(1).entriesSold, 11);
        assertEq(manager.getUserEntries(1, alice), 9);
        assertEq(manager.getUserEntries(1, bob), 2);
    }

    function testOversellBeforeFullRevertsAtomically() public {
        _buy(alice, 9);
        vm.prank(bob);
        vm.expectRevert(SingularNativePoolManager.InsufficientRemainingEntries.selector);
        manager.buyEntries{value: 0.05 ether}(1, 5);
        assertEq(manager.getPool(1).entriesSold, 9);
        assertEq(manager.getUserEntries(1, bob), 0);
    }

    function testDeadlineBoundary() public {
        _buy(alice, 1);
        uint64 deadline = manager.getPool(1).deadline;
        vm.warp(deadline - 1);
        _buy(bob, 1);
        vm.warp(deadline);
        vm.prank(bob);
        vm.expectRevert(SingularNativePoolManager.PoolExpired.selector);
        manager.buyEntries{value: 0.01 ether}(1, 1);
        assertEq(uint8(manager.getEffectiveStatus(1)), uint8(SingularNativePoolManager.Status.EXPIRED));
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.PoolExpired.selector);
        manager.buyEntries{value: 0.01 ether}(1, 1);
    }

    function testFinalEntryRequestsOnceAndValidatesCallback() public {
        _fill();
        SingularNativePoolManager.Pool memory drawing = manager.getPool(1);
        assertEq(uint8(drawing.status), uint8(SingularNativePoolManager.Status.DRAWING));
        assertEq(drawing.randomnessRequestId, 1);
        assertEq(drawing.requestProvider, address(random));
        assertEq(random.nextRequestId(), 2);
        vm.prank(stranger);
        vm.expectRevert(SingularNativePoolManager.InvalidRandomnessRequest.selector);
        manager.fulfillRandomness(1, 0);
        vm.expectRevert(MockRandomnessProvider.UnknownRequest.selector);
        random.fulfill(999, 0);
        random.fulfill(1, 0);
        vm.expectRevert(MockRandomnessProvider.AlreadyFulfilled.selector);
        random.fulfill(1, 1);
        assertEq(manager.getPool(1).winner, alice);
    }

    function testFirstAndLastTicketCanWin() public {
        _fill();
        random.fulfill(1, 0);
        assertEq(manager.getPool(1).winner, alice);
        assertEq(manager.getPool(1).winningTicket, 0);
        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.1 ether}(2, 10);
        vm.prank(bob);
        manager.buyEntries{value: 0.01 ether}(2, 1);
        random.fulfill(2, 10);
        assertEq(manager.getPool(2).winner, bob);
        assertEq(manager.getPool(2).winningTicket, 10);
    }

    function testPrizeClaimAndDoubleClaim() public {
        _resolve(7);
        assertEq(manager.getPool(1).winner, bob);
        assertEq(manager.getClaimablePrize(1, bob), 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.NotWinner.selector);
        manager.claimPrize(1);
        uint256 beforeBalance = bob.balance;
        vm.prank(bob);
        manager.claimPrize(1);
        assertEq(bob.balance, beforeBalance + 0.1 ether);
        assertEq(manager.getClaimablePrize(1, bob), 0);
        vm.prank(bob);
        vm.expectRevert(SingularNativePoolManager.PrizeUnavailable.selector);
        manager.claimPrize(1);
    }

    function testPrizeTransferFailureDoesNotRerollOrClearClaim() public {
        RejectingWinner rejector = new RejectingWinner(manager);
        vm.deal(address(rejector), 0.11 ether);
        rejector.enter{value: 0.11 ether}(1, 11);
        random.fulfill(1, 0);
        vm.expectRevert(SingularNativePoolManager.NativeTransferFailed.selector);
        rejector.claim(1);
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        assertEq(pool.winner, address(rejector));
        assertEq(pool.winningTicket, 0);
        assertFalse(pool.prizeClaimed);
        assertEq(manager.getClaimablePrize(1, address(rejector)), 0.1 ether);
    }

    function testRefundTransferFailureLeavesEntitlementIntact() public {
        RejectingWinner rejector = new RejectingWinner(manager);
        vm.deal(address(rejector), 0.03 ether);
        rejector.enter{value: 0.03 ether}(1, 3);
        vm.warp(manager.getPool(1).deadline);
        vm.expectRevert(SingularNativePoolManager.NativeTransferFailed.selector);
        rejector.refund(1);
        assertEq(manager.getRefundableAmount(1, address(rejector)), 0.03 ether);
        assertFalse(manager.refundClaimed(1, address(rejector)));
    }

    function testExpiryRefundWithoutAdminSyncAndMultiPurchase() public {
        _buy(alice, 2);
        _buy(bob, 2);
        _buy(alice, 3);
        vm.warp(manager.getPool(1).deadline);
        assertEq(manager.getRefundableAmount(1, alice), 0.05 ether);
        uint256 beforeBalance = alice.balance;
        vm.prank(alice);
        manager.claimRefund(1);
        assertEq(alice.balance, beforeBalance + 0.05 ether);
        assertEq(manager.getContribution(1, alice), 0.05 ether);
        assertEq(manager.getRefundableAmount(1, alice), 0);
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.RefundUnavailable.selector);
        manager.claimRefund(1);
        assertEq(manager.refundLiabilities(), 0.02 ether);
        assertEq(manager.totalRefunded(), 0.05 ether);
    }

    function testFullPoolCannotRefundBeforeVrfTimeoutAndExpiredCannotResolve() public {
        _fill();
        vm.warp(manager.drawTimeoutAt(1) - 1);
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.RefundUnavailable.selector);
        manager.claimRefund(1);
        random.fulfill(1, 4);
        assertEq(uint8(manager.getPool(1).status), uint8(SingularNativePoolManager.Status.COMPLETED));

        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        vm.prank(alice);
        manager.buyEntries{value: 0.01 ether}(2, 1);
        vm.warp(block.timestamp + 180);
        manager.syncExpired(2);
        assertEq(uint8(manager.getPool(2).status), uint8(SingularNativePoolManager.Status.EXPIRED));
        vm.prank(address(random));
        vm.expectRevert(SingularNativePoolManager.InvalidRandomnessRequest.selector);
        manager.fulfillRandomness(2, 0);
    }

    function testZeroEntryPoolHasNoDeadlineOrRefund() public {
        vm.warp(block.timestamp + 365 days);
        assertEq(uint8(manager.getEffectiveStatus(1)), uint8(SingularNativePoolManager.Status.WAITING));
        assertEq(manager.getRefundableAmount(1, alice), 0);
        vm.prank(alice);
        vm.expectRevert(SingularNativePoolManager.RefundUnavailable.selector);
        manager.claimRefund(1);
    }

    function testCreatorCanOnlyCreatePoolsAndCannotChangeAuthority() public {
        vm.prank(stranger);
        vm.expectRevert(SingularNativePoolManager.OnlyPoolCreator.selector);
        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        assertEq(manager.poolCreator(), address(this));
        (bool canPause,) = address(manager).call(abi.encodeWithSignature("pause()"));
        (bool canTransfer,) = address(manager).call(abi.encodeWithSignature("transferOwnership(address)", bob));
        (bool canWithdraw,) = address(manager).call(abi.encodeWithSignature("withdraw(uint256)", 1));
        assertFalse(canPause);
        assertFalse(canTransfer);
        assertFalse(canWithdraw);
        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        assertEq(manager.poolCount(), 2);
    }

    function testProviderIsFixedForDeploymentAndPendingDraw() public {
        assertEq(address(manager.randomnessProvider()), address(random));
        MockRandomnessProvider replacement = new MockRandomnessProvider(address(this));
        (bool changed,) = address(manager).call(
            abi.encodeWithSignature("setRandomnessProvider(address)", address(replacement))
        );
        assertFalse(changed);
        _fill();
        random.fulfill(1, 7);
        assertEq(manager.getPool(1).winner, bob);
        assertEq(address(manager.randomnessProvider()), address(random));
    }

    function testProviderRequestFailureRevertsFinalPurchaseAtomically() public {
        RevertingProvider broken = new RevertingProvider();
        SingularNativePoolManager brokenManager = new SingularNativePoolManager(address(this), address(broken), address(this));
        uint256 poolId = brokenManager.createPool(0.1 ether, 0.01 ether, 11, 3 minutes, 0.01 ether);
        vm.prank(alice);
        brokenManager.buyEntries{value: 0.1 ether}(poolId, 10);
        vm.prank(bob);
        vm.expectRevert();
        brokenManager.buyEntries{value: 0.01 ether}(poolId, 1);
        assertEq(brokenManager.getPool(poolId).entriesSold, 10);
        assertEq(brokenManager.getUserEntries(poolId, bob), 0);
        assertEq(brokenManager.activePoolLiabilities(), 0.1 ether);
        assertEq(address(brokenManager).balance, 0.1 ether);
    }

    function testForcedBNBRemainsUnaccountedAndUnwithdrawable() public {
        _buy(alice, 1);
        vm.deal(address(manager), 0.04 ether);
        (uint256 assets, uint256 active, uint256 refunds, uint256 prizes, uint256 fees, uint256 extra) =
            manager.liabilityDiagnostics();
        assertEq(assets, 0.04 ether);
        assertEq(active, 0.01 ether);
        assertEq(refunds + prizes + fees, 0);
        assertEq(extra, 0.03 ether);
        assertEq(manager.totalLiabilities(), 0.01 ether);
    }

    function testFeeOnlyRealizedAfterResolutionAndCannotDrainUserFunds() public {
        _buy(alice, 3);
        SingularFeeVault vault = manager.feeVault();
        assertEq(vault.availableFees(), 0);
        vm.prank(stranger);
        vm.expectRevert(SingularFeeVault.OnlyFeeRecipient.selector);
        vault.withdraw(0);
        vm.expectRevert(SingularFeeVault.InsufficientRealizedFees.selector);
        vault.withdraw(0.01 ether);
        _buy(bob, 8);
        assertEq(vault.availableFees(), 0);
        random.fulfill(1, 2);
        assertEq(manager.protocolFeeLiabilities(), 0.01 ether);
        assertEq(manager.winnerLiabilities(), 0.1 ether);
        manager.sweepProtocolFee(1);
        assertEq(vault.availableFees(), 0.01 ether);
        assertEq(address(vault).balance, 0.01 ether);
        assertEq(address(manager).balance, 0.1 ether);
        vm.expectRevert(SingularNativePoolManager.FeeUnavailable.selector);
        manager.sweepProtocolFee(1);
        uint256 recipientBalance = address(this).balance;
        vault.withdraw(0.01 ether);
        assertEq(address(this).balance, recipientBalance + 0.01 ether);
        assertEq(vault.availableFees(), 0);
        assertEq(manager.totalLiabilities(), address(manager).balance);
    }

    function testLiabilityAccountingAcrossLifecycle() public {
        assertEq(manager.totalLiabilities(), 0);
        _buy(alice, 3);
        assertEq(manager.activePoolLiabilities(), 0.03 ether);
        assertEq(manager.totalLiabilities(), address(manager).balance);
        vm.warp(manager.getPool(1).deadline);
        vm.prank(alice);
        manager.claimRefund(1);
        assertEq(manager.totalLiabilities(), address(manager).balance);
        assertEq(manager.totalLiabilities(), 0);
    }

    function testFuzzWinningTicketAlwaysOwned(uint256 randomValue) public {
        _fill();
        random.fulfill(1, randomValue);
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        assertLt(pool.winningTicket, pool.capacity);
        assertEq(pool.winner, manager.getTicketOwner(1, pool.winningTicket));
    }

    function testFuzzQuantityNeverOversells(uint8 quantity) public {
        quantity = uint8(bound(quantity, 1, 11));
        _buy(alice, quantity);
        assertLe(manager.getPool(1).entriesSold, 11);
        assertEq(manager.getUserEntries(1, alice), quantity);
    }

    function testFuzzValidEconomics(uint8 capSeed, uint128 priceSeed, uint8 feeSeed) public {
        uint32 capacity = uint32(bound(capSeed, 2, 100));
        uint128 price = uint128(bound(priceSeed, 1 gwei, 0.1 ether));
        uint256 gross = uint256(price) * capacity;
        uint128 fee = uint128(bound(feeSeed, 0, gross - 1));
        uint128 prize = uint128(gross - fee);
        uint256 id = manager.createPool(prize, price, capacity, 600, fee);
        assertEq(uint256(manager.getPool(id).entryPrice) * capacity, uint256(prize) + fee);
    }

    function testFuzzWalletOrderAndPurchaseSequence(uint8 firstSeed, uint8 secondSeed, bool aliceFirst) public {
        uint32 first = uint32(bound(firstSeed, 1, 10));
        uint32 second = uint32(bound(secondSeed, 1, 11 - first));
        address firstWallet = aliceFirst ? alice : bob;
        address secondWallet = aliceFirst ? bob : alice;
        _buy(firstWallet, first);
        _buy(secondWallet, second);
        assertEq(manager.getPool(1).entriesSold, first + second);
        assertEq(manager.getTicketOwner(1, 0), firstWallet);
        assertEq(manager.getTicketOwner(1, first), secondWallet);
        assertEq(manager.getContribution(1, firstWallet), uint256(first) * 0.01 ether);
        assertEq(manager.getContribution(1, secondWallet), uint256(second) * 0.01 ether);
    }

    function testMaximumCapacityBatchFitsLocalGasBudget() public {
        uint32 capacity = manager.MAX_CAPACITY();
        uint256 id = manager.createPool(uint128(uint256(capacity) * 0.01 ether), 0.01 ether, capacity, 180, 0);
        vm.prank(alice);
        manager.buyEntries{value: uint256(capacity) * 0.01 ether}(id, capacity);
        assertEq(manager.getPool(id).entriesSold, capacity);
        assertEq(manager.getTicketOwner(id, capacity - 1), alice);
    }

    function testGasReferenceSuccessfulOperations() public {
        uint256 beforeGas = gasleft();
        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        emit log_named_uint("createPool", beforeGas - gasleft());

        vm.prank(alice);
        beforeGas = gasleft();
        manager.buyEntries{value: 0.01 ether}(1, 1);
        emit log_named_uint("buyEntries first one", beforeGas - gasleft());

        vm.prank(alice);
        beforeGas = gasleft();
        manager.buyEntries{value: 0.03 ether}(1, 3);
        emit log_named_uint("buyEntries later three", beforeGas - gasleft());

        vm.prank(bob);
        manager.buyEntries{value: 0.07 ether}(1, 7);
        vm.prank(address(random));
        beforeGas = gasleft();
        manager.fulfillRandomness(1, 0);
        emit log_named_uint("fulfillRandomness", beforeGas - gasleft());

        vm.prank(alice);
        beforeGas = gasleft();
        manager.claimPrize(1);
        emit log_named_uint("claimPrize", beforeGas - gasleft());

        beforeGas = gasleft();
        manager.sweepProtocolFee(1);
        emit log_named_uint("sweepProtocolFee", beforeGas - gasleft());
    }

    function testGasReferenceRefund() public {
        _buy(alice, 3);
        vm.warp(manager.getPool(1).deadline);
        vm.prank(alice);
        uint256 beforeGas = gasleft();
        manager.claimRefund(1);
        emit log_named_uint("claimRefund first sync", beforeGas - gasleft());
    }
}
