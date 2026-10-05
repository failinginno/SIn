// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessProvider, IRandomnessConsumer} from "./IRandomnessProvider.sol";

/// @notice NOT PRODUCTION RANDOMNESS. Owner chooses the value for local/testnet tests.
contract MockRandomnessProvider is Ownable, IRandomnessProvider {
    error ManagerAlreadySet();
    error OnlyManager();
    error UnknownRequest();
    error AlreadyFulfilled();
    error InvalidManager();

    struct Request {
        uint256 poolId;
        bool exists;
        bool fulfilled;
    }
    address public manager;
    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;

    event Requested(uint256 indexed requestId, uint256 indexed poolId);
    event Fulfilled(uint256 indexed requestId, uint256 randomValue);
    event ManagerSet(address indexed manager);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setManager(address manager_) external onlyOwner {
        if (manager != address(0)) revert ManagerAlreadySet();
        if (manager_ == address(0)) revert InvalidManager();
        manager = manager_;
        emit ManagerSet(manager_);
    }

    function requestRandomness(uint256 poolId) external returns (uint256 requestId) {
        if (msg.sender != manager) revert OnlyManager();
        requestId = nextRequestId++;
        requests[requestId] = Request(poolId, true, false);
        emit Requested(requestId, poolId);
    }

    function fulfill(uint256 requestId, uint256 randomValue) external onlyOwner {
        Request storage request = requests[requestId];
        if (!request.exists) revert UnknownRequest();
        if (request.fulfilled) revert AlreadyFulfilled();
        request.fulfilled = true;
        emit Fulfilled(requestId, randomValue);
        IRandomnessConsumer(manager).fulfillRandomness(requestId, randomValue);
    }
}
