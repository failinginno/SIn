// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainlinkVRFProvider, IVRFCoordinatorV2PlusMinimal} from "../src/ChainlinkVRFProvider.sol";
import {SingularNativePoolManager} from "../src/SingularNativePoolManager.sol";

contract CoordinatorHarness is IVRFCoordinatorV2PlusMinimal {
    uint256 public nextRequestId = 100;
    RandomWordsRequest private _last;

    function requestRandomWords(RandomWordsRequest calldata request) external returns (uint256 requestId) {
        _last = request;
        return nextRequestId++;
    }

    function last() external view returns (RandomWordsRequest memory) {
        return _last;
    }

    function deliver(ChainlinkVRFProvider provider, uint256 requestId, uint256[] memory words) external {
        provider.rawFulfillRandomWords(requestId, words);
    }
}

contract ChainlinkVRFProviderTest is Test {
    CoordinatorHarness coordinator;
    ChainlinkVRFProvider provider;
    SingularNativePoolManager manager;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    bytes32 constant KEY_HASH = bytes32(uint256(123));

    function setUp() public {
        coordinator = new CoordinatorHarness();
        provider = new ChainlinkVRFProvider(address(this), address(coordinator), KEY_HASH, 42, 3, 250_000, true);
        manager = new SingularNativePoolManager(address(this), address(provider), address(this));
        provider.bindManager(address(manager));
        manager.createPool(0.002 ether, 0.001 ether, 3, 180, 0.001 ether);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    function testRecurringFulfillmentWithFiveHundredThousandGas() public {
        ChainlinkVRFProvider recurringProvider = new ChainlinkVRFProvider(
            address(this), address(coordinator), KEY_HASH, 42, 3, 500_000, true
        );
        SingularNativePoolManager recurringManager = new SingularNativePoolManager(
            address(this), address(recurringProvider), address(this)
        );
        recurringProvider.bindManager(address(recurringManager));
        uint256 id = recurringManager.createRecurringPool(0.0018 ether, 0.001 ether, 2, 1800, 0.0002 ether);
        vm.prank(alice);
        recurringManager.buyEntries{value: 0.001 ether}(id, 1);
        vm.prank(bob);
        recurringManager.buyEntries{value: 0.001 ether}(id, 1);
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        coordinator.deliver{gas: 500_000}(recurringProvider, 100, words);
        assertEq(recurringManager.poolCount(), 2);
        assertEq(uint8(recurringManager.getPool(2).status), uint8(SingularNativePoolManager.Status.WAITING));
    }

    function testTimedOutRecurringCallbackWithFiveHundredThousandGas() public {
        ChainlinkVRFProvider recurringProvider = new ChainlinkVRFProvider(
            address(this), address(coordinator), KEY_HASH, 42, 3, 500_000, true
        );
        SingularNativePoolManager recurringManager = new SingularNativePoolManager(
            address(this), address(recurringProvider), address(this)
        );
        recurringProvider.bindManager(address(recurringManager));
        uint256 id = recurringManager.createRecurringPool(0.0018 ether, 0.001 ether, 2, 1800, 0.0002 ether);
        vm.prank(alice);
        recurringManager.buyEntries{value: 0.001 ether}(id, 1);
        vm.prank(bob);
        recurringManager.buyEntries{value: 0.001 ether}(id, 1);
        vm.warp(recurringManager.drawTimeoutAt(id));
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        coordinator.deliver{gas: 500_000}(recurringProvider, 100, words);
        assertEq(uint8(recurringManager.getPool(id).status), uint8(SingularNativePoolManager.Status.EXPIRED));
        assertEq(recurringManager.poolCount(), 1);
        assertEq(recurringManager.getRefundableAmount(id, alice), 0.001 ether);
        assertEq(recurringManager.getRefundableAmount(id, bob), 0.001 ether);
    }

    function fillPool() internal {
        vm.prank(alice);
        manager.buyEntries{value: 0.001 ether}(1, 1);
        vm.prank(bob);
        manager.buyEntries{value: 0.002 ether}(1, 2);
    }

    function testRequestMappingAndOfficialV25Parameters() public {
        fillPool();
        assertEq(provider.poolForRequest(100), 1);
        assertEq(provider.requestForPool(1), 100);
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        assertEq(pool.randomnessRequestId, 100);
        assertEq(pool.requestProvider, address(provider));
        IVRFCoordinatorV2PlusMinimal.RandomWordsRequest memory request = coordinator.last();
        assertEq(request.keyHash, KEY_HASH);
        assertEq(request.subId, 42);
        assertEq(request.requestConfirmations, 3);
        assertEq(request.callbackGasLimit, 250_000);
        assertEq(request.numWords, 1);
        assertEq(request.extraArgs, abi.encodeWithSelector(bytes4(keccak256("VRF ExtraArgsV1")), true));
    }

    function testOnlyManagerMayRequestAndBindingIsOneTime() public {
        vm.expectRevert(ChainlinkVRFProvider.OnlyManager.selector);
        provider.requestRandomness(1);
        vm.expectRevert(ChainlinkVRFProvider.ManagerAlreadyBound.selector);
        provider.bindManager(address(manager));
    }

    function testUnauthenticatedUnknownAndMalformedCallbacks() public {
        fillPool();
        uint256[] memory words = new uint256[](1);
        words[0] = 2;
        vm.expectRevert(ChainlinkVRFProvider.OnlyCoordinator.selector);
        provider.rawFulfillRandomWords(100, words);
        vm.expectRevert(ChainlinkVRFProvider.UnknownRequest.selector);
        coordinator.deliver(provider, 999, words);
        vm.expectRevert(ChainlinkVRFProvider.InvalidRandomWords.selector);
        coordinator.deliver(provider, 100, new uint256[](0));
        assertFalse(provider.fulfilled(100));
    }

    function testValidFulfillmentIsFinalAndDuplicateRejected() public {
        fillPool();
        uint256[] memory words = new uint256[](1);
        words[0] = 2;
        uint256 gasBefore = gasleft();
        coordinator.deliver(provider, 100, words);
        emit log_named_uint("local coordinator-to-manager fulfillment gas", gasBefore - gasleft());
        SingularNativePoolManager.Pool memory pool = manager.getPool(1);
        assertEq(uint8(pool.status), uint8(SingularNativePoolManager.Status.COMPLETED));
        assertEq(pool.winningTicket, 2);
        assertEq(pool.winner, bob);
        assertTrue(provider.fulfilled(100));
        vm.expectRevert(ChainlinkVRFProvider.AlreadyFulfilled.selector);
        coordinator.deliver(provider, 100, words);
        assertEq(manager.getPool(1).winner, bob);
    }

    function testPoolMustBeDrawingAndNoWrongPoolResolution() public {
        // This adversarial request is impossible through the manager's normal fill path.
        vm.prank(address(manager));
        provider.requestRandomness(1);
        uint256[] memory words = new uint256[](1);
        words[0] = 99;
        vm.expectRevert(SingularNativePoolManager.InvalidRandomnessRequest.selector);
        coordinator.deliver(provider, 100, words);
        assertFalse(provider.fulfilled(100));
        assertEq(uint8(manager.getPool(1).status), uint8(SingularNativePoolManager.Status.WAITING));
    }

    function testDifferentRequestsBindDifferentPools() public {
        manager.createPool(0.002 ether, 0.001 ether, 3, 180, 0.001 ether);
        fillPool();
        vm.prank(alice);
        manager.buyEntries{value: 0.003 ether}(2, 3);
        assertEq(provider.poolForRequest(100), 1);
        assertEq(provider.poolForRequest(101), 2);
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        coordinator.deliver(provider, 101, words);
        assertEq(uint8(manager.getPool(1).status), uint8(SingularNativePoolManager.Status.DRAWING));
        assertEq(manager.getPool(2).winner, alice);
    }
}
