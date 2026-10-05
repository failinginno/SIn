// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessProvider, IRandomnessConsumer} from "./IRandomnessProvider.sol";

/// @dev ABI-compatible subset of Chainlink VRF V2.5 subscription coordinator.
interface IVRFCoordinatorV2PlusMinimal {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function requestRandomWords(RandomWordsRequest calldata request) external returns (uint256 requestId);
}

/// @notice One VRF request per filled SINGULAR pool; only the coordinator can deliver a word.
/// @dev Deploy first, bind the manager once, then add this provider as a VRF subscription consumer.
contract ChainlinkVRFProvider is IRandomnessProvider, Ownable {
    bytes4 private constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));
    uint32 public constant NUM_WORDS = 1;

    error OnlyManager();
    error OnlyCoordinator();
    error ManagerAlreadyBound();
    error InvalidConfiguration();
    error UnknownRequest();
    error AlreadyFulfilled();
    error InvalidRandomWords();

    address public immutable coordinator;
    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint16 public immutable requestConfirmations;
    uint32 public immutable callbackGasLimit;
    bool public immutable nativePayment;
    address public manager;

    mapping(uint256 => uint256) public poolForRequest;
    mapping(uint256 => uint256) public requestForPool;
    mapping(uint256 => bool) public fulfilled;

    event ManagerBound(address indexed manager);
    event VRFRequested(uint256 indexed poolId, uint256 indexed requestId);
    event VRFFulfilled(uint256 indexed poolId, uint256 indexed requestId, uint256 randomWord);

    constructor(
        address initialOwner,
        address coordinator_,
        bytes32 keyHash_,
        uint256 subscriptionId_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) Ownable(initialOwner) {
        if (
            coordinator_.code.length == 0 || keyHash_ == bytes32(0) || subscriptionId_ == 0 || requestConfirmations_ < 3
                || requestConfirmations_ > 200 || callbackGasLimit_ < 100_000 || callbackGasLimit_ > 2_500_000
        ) revert InvalidConfiguration();
        coordinator = coordinator_;
        keyHash = keyHash_;
        subscriptionId = subscriptionId_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
        nativePayment = nativePayment_;
    }

    function bindManager(address manager_) external onlyOwner {
        if (manager != address(0)) revert ManagerAlreadyBound();
        if (manager_.code.length == 0) revert InvalidConfiguration();
        manager = manager_;
        emit ManagerBound(manager_);
    }

    function requestRandomness(uint256 poolId) external returns (uint256 requestId) {
        if (msg.sender != manager) revert OnlyManager();
        if (poolId == 0 || requestForPool[poolId] != 0) revert InvalidConfiguration();
        // Chainlink V2.5 encodes ExtraArgsV1 as its tag followed by abi.encode(bool).
        bytes memory extraArgs = abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, nativePayment);
        requestId = IVRFCoordinatorV2PlusMinimal(coordinator)
            .requestRandomWords(
                IVRFCoordinatorV2PlusMinimal.RandomWordsRequest({
                    keyHash: keyHash,
                    subId: subscriptionId,
                    requestConfirmations: requestConfirmations,
                    callbackGasLimit: callbackGasLimit,
                    numWords: NUM_WORDS,
                    extraArgs: extraArgs
                })
            );
        if (requestId == 0 || poolForRequest[requestId] != 0) revert InvalidConfiguration();
        poolForRequest[requestId] = poolId;
        requestForPool[poolId] = requestId;
        emit VRFRequested(poolId, requestId);
    }

    /// @notice Chainlink coordinator callback selector, authenticated before any state change.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != coordinator) revert OnlyCoordinator();
        uint256 poolId = poolForRequest[requestId];
        if (poolId == 0) revert UnknownRequest();
        if (fulfilled[requestId]) revert AlreadyFulfilled();
        if (randomWords.length != 1) revert InvalidRandomWords();
        fulfilled[requestId] = true;
        // Manager independently checks DRAWING, provider identity and request mapping.
        // Any manager rejection reverts this callback atomically; no reroll path exists.
        IRandomnessConsumer(manager).fulfillRandomness(requestId, randomWords[0]);
        emit VRFFulfilled(poolId, requestId, randomWords[0]);
    }
}
