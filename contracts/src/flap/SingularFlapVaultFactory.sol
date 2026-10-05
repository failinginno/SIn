// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SingularNativePoolManager} from "../SingularNativePoolManager.sol";
import {SingularFlapVault} from "./SingularFlapVault.sol";
import {VaultFactoryBaseV2} from "./VaultFactoryBaseV2.sol";
import {VaultDataSchema, FieldDescriptor, FactoryPolicy} from "./FlapVaultTypes.sol";

/// @notice Allows one official BNB-quoted Flap token to expose SINGULAR pool actions.
/// @dev Does not hold or control participant BNB. No upgrade, pause, or manager setter exists.
contract SingularFlapVaultFactory is VaultFactoryBaseV2 {
    error OnlyPortalOrGuardian();
    error InvalidLaunch();
    error VaultAlreadyCreated();

    address public immutable poolCreator;
    address public immutable taxRecipient;
    SingularNativePoolManager public immutable poolManager;
    address public officialVault;
    address public officialTaxToken;

    event VaultCreated(address indexed taxToken, address indexed vault, address indexed creator);

    constructor(address manager_, address creator_, address taxRecipient_) {
        if (
            manager_.code.length == 0 || creator_ == address(0) || taxRecipient_ == address(0)
                || SingularNativePoolManager(payable(manager_)).poolCreator() != creator_
        ) revert InvalidLaunch();
        poolManager = SingularNativePoolManager(payable(manager_));
        poolCreator = creator_;
        taxRecipient = taxRecipient_;
    }

    function newVault(address taxToken, address quoteToken, address creator, bytes calldata vaultData)
        external
        override
        returns (address vault)
    {
        if (msg.sender != _getVaultPortal() && msg.sender != _getGuardian()) revert OnlyPortalOrGuardian();
        if (creator != poolCreator || taxToken == address(0) || quoteToken != address(0) || vaultData.length != 0) {
            revert InvalidLaunch();
        }
        // Guardian is a Flap-mandated backup caller, but its calls must not consume
        // the one official launch slot. Only a launch from the canonical Portal
        // can designate the vault and tax token used by SINGULAR.
        bool isPortalLaunch = msg.sender == _getVaultPortal();
        if (isPortalLaunch && officialVault != address(0)) revert VaultAlreadyCreated();
        vault = address(new SingularFlapVault(address(poolManager), taxToken, taxRecipient));
        if (isPortalLaunch) {
            officialVault = vault;
            officialTaxToken = taxToken;
        }
        emit VaultCreated(taxToken, vault, creator);
    }

    function isQuoteTokenSupported(address quoteToken) external pure override returns (bool) {
        return quoteToken == address(0);
    }

    function vaultDataSchema() public pure override returns (VaultDataSchema memory schema) {
        schema.description = "Official SINGULAR BNB vault. No configurable launch data; pool manager and revenue recipient are fixed.";
        schema.fields = new FieldDescriptor[](0);
        schema.isArray = false;
    }

    function _validateBeforeLaunch(LaunchValidationDataV1 memory data)
        internal
        pure
        override
        returns (bool success, string memory reason)
    {
        if (data.quoteToken != address(0)) return (false, "SINGULAR Vault supports native BNB only.");
        if (data.vaultBps == 0) return (false, "Allocate a nonzero share of tax revenue to the vault.");
        return (true, "");
    }

    function tokenCreationPolicies() public pure override returns (FactoryPolicy[] memory policies) {
        policies = new FactoryPolicy[](2);
        policies[0] = FactoryPolicy("quoteToken", "eq", abi.encode(address(0)), "Native BNB quote only.");
        policies[1] = FactoryPolicy("vaultBps", "gt", abi.encode(uint256(0)), "Vault receives a positive share of tax revenue.");
    }
}
