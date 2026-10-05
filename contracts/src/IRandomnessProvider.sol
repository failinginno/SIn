// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRandomnessProvider {
    /// @dev The request ID is scoped to the provider address, not globally unique.
    function requestRandomness(uint256 poolId) external returns (uint256 requestId);
}

interface IRandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomValue) external;
}
