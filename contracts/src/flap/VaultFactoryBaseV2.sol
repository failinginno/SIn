// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultDataSchema, FactoryPolicy} from "./FlapVaultTypes.sol";

/// @notice The current Flap factory discovery/validation ABI for BSC deployments.
abstract contract VaultFactoryBaseV2 {
    error UnsupportedChain(uint256 chainId);

    struct LaunchValidationDataV1 {
        uint8 tokenVersion;
        address quoteToken;
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint16 vaultBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        address dividendToken;
        uint256 minimumShareBalance;
    }

    function newVault(address taxToken, address quoteToken, address creator, bytes calldata vaultData)
        external
        virtual
        returns (address);

    function isQuoteTokenSupported(address quoteToken) external view virtual returns (bool);
    function vaultDataSchema() public pure virtual returns (VaultDataSchema memory);

    function onBeforeLaunch(bytes calldata validationData)
        external
        view
        virtual
        returns (bool success, string memory reason)
    {
        LaunchValidationDataV1 memory data = abi.decode(validationData, (LaunchValidationDataV1));
        return _validateBeforeLaunch(data);
    }

    function _validateBeforeLaunch(LaunchValidationDataV1 memory data)
        internal
        view
        virtual
        returns (bool success, string memory reason);

    function factorySpecVersion() public pure virtual returns (string memory) {
        return "v2.3";
    }

    function tokenCreationPolicies() public pure virtual returns (FactoryPolicy[] memory) {
        return new FactoryPolicy[](0);
    }

    function _getVaultPortal() internal view returns (address) {
        if (block.chainid == 56) return 0x90497450f2a706f1951b5bdda52B4E5d16f34C06;
        if (block.chainid == 97) return 0x027e3704fC5C16522e9393d04C60A3ac5c0d775f;
        revert UnsupportedChain(block.chainid);
    }

    function _getGuardian() internal view returns (address) {
        if (block.chainid == 56) return 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b;
        if (block.chainid == 97) return 0x76Fa8C526f8Bc27ba6958B76DeEf92a0dbE46950;
        revert UnsupportedChain(block.chainid);
    }
}
