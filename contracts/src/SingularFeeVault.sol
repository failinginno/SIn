// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Holds only fees realized after successful pool resolution.
contract SingularFeeVault is ReentrancyGuard {
    error OnlyManager();
    error InvalidRecipient();
    error InsufficientRealizedFees();
    error NativeTransferFailed();
    error DirectPaymentDisabled();
    error OnlyFeeRecipient();

    address public immutable manager;
    address public immutable feeRecipient;
    uint256 public availableFees;
    uint256 public totalFeesReceived;
    uint256 public totalFeesWithdrawn;

    event FeeReceived(uint256 indexed poolId, uint256 amount);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    constructor(address manager_, address initialRecipient) {
        if (manager_ == address(0) || initialRecipient == address(0)) revert InvalidRecipient();
        manager = manager_;
        feeRecipient = initialRecipient;
    }

    function recordFee(uint256 poolId) external payable {
        if (msg.sender != manager) revert OnlyManager();
        availableFees += msg.value;
        totalFeesReceived += msg.value;
        emit FeeReceived(poolId, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (msg.sender != feeRecipient) revert OnlyFeeRecipient();
        if (amount > availableFees) revert InsufficientRealizedFees();
        availableFees -= amount;
        totalFeesWithdrawn += amount;
        emit FeesWithdrawn(feeRecipient, amount);
        (bool success,) = payable(feeRecipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    /// @dev Forced native BNB may exceed availableFees. It is never withdrawable here.
    function unaccountedBNB() external view returns (uint256) {
        return address(this).balance - availableFees;
    }

    receive() external payable {
        revert DirectPaymentDisabled();
    }
}
