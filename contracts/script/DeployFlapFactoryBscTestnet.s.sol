// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SingularNativePoolManager} from "../src/SingularNativePoolManager.sol";
import {SingularFlapVaultFactory} from "../src/flap/SingularFlapVaultFactory.sol";

/// @notice Deploy the Flap adapter factory after verifying the BSC Testnet manager.
/// @dev The official token launch through Flap VaultPortal creates the actual vault later.
contract DeployFlapFactoryBscTestnet is Script {
    error WrongChain();
    error MissingConfiguration();
    error ReadbackFailed();

    function run() external returns (SingularFlapVaultFactory factory) {
        if (block.chainid != 97) revert WrongChain();
        address creator = vm.envAddress("DEPLOYER_ACCOUNT");
        address managerAddress = vm.envAddress("POOL_MANAGER_ADDRESS");
        address taxRecipient = vm.envAddress("FLAP_TAX_RECIPIENT");
        if (
            creator == address(0) || managerAddress.code.length == 0 || taxRecipient == address(0)
                || SingularNativePoolManager(payable(managerAddress)).poolCreator() != creator
        ) revert MissingConfiguration();

        vm.startBroadcast(creator);
        factory = new SingularFlapVaultFactory(managerAddress, creator, taxRecipient);
        vm.stopBroadcast();

        if (
            address(factory.poolManager()) != managerAddress || factory.poolCreator() != creator
                || factory.taxRecipient() != taxRecipient || factory.officialVault() != address(0)
                || !factory.isQuoteTokenSupported(address(0)) || factory.isQuoteTokenSupported(address(1))
        ) revert ReadbackFailed();
    }
}
