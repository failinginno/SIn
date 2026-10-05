// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SingularNativePoolManager} from "../src/SingularNativePoolManager.sol";
import {ChainlinkVRFProvider} from "../src/ChainlinkVRFProvider.sol";

/// @notice Manual BSC Testnet deployment only; requires a funded VRF subscription.
/// @dev Effective order: provider -> manager + vault -> bind manager.
contract DeployBscTestnet is Script {
    error WrongChain();
    error MissingConfiguration();
    error ReadbackFailed();

    function run() external returns (SingularNativePoolManager manager, ChainlinkVRFProvider provider) {
        if (block.chainid != 97) revert WrongChain();
        address deployer = vm.envAddress("DEPLOYER_ACCOUNT");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address coordinator = vm.envAddress("VRF_COORDINATOR");
        bytes32 keyHash = vm.envBytes32("VRF_KEY_HASH");
        uint256 subscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        uint256 confirmationsInput = vm.envUint("VRF_CONFIRMATIONS");
        uint256 callbackGasLimitInput = vm.envUint("VRF_CALLBACK_GAS_LIMIT");
        if (
            confirmationsInput < 3 || confirmationsInput > 200 || callbackGasLimitInput < 100_000
                || callbackGasLimitInput > 2_500_000
        ) {
            revert MissingConfiguration();
        }
        uint16 confirmations = uint16(confirmationsInput);
        uint32 callbackGasLimit = uint32(callbackGasLimitInput);
        bool nativePayment = vm.envBool("VRF_NATIVE_PAYMENT");
        if (deployer == address(0) || feeRecipient == address(0) || coordinator.code.length == 0) {
            revert MissingConfiguration();
        }
        // Forge signs with the explicitly selected secure keystore account.
        vm.startBroadcast(deployer);
        provider = new ChainlinkVRFProvider(
            deployer, coordinator, keyHash, subscriptionId, confirmations, callbackGasLimit, nativePayment
        );
        manager = new SingularNativePoolManager(deployer, address(provider), feeRecipient);
        provider.bindManager(address(manager));
        vm.stopBroadcast();
        if (
            provider.manager() != address(manager) || manager.poolCreator() != deployer
                || address(manager.randomnessProvider()) != address(provider)
                || manager.feeVault().feeRecipient() != feeRecipient || manager.poolCount() != 0
        ) revert ReadbackFailed();
    }
}
