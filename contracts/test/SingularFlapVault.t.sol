// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SingularNativePoolManager} from "../src/SingularNativePoolManager.sol";
import {MockRandomnessProvider} from "../src/MockRandomnessProvider.sol";
import {SingularFlapVault} from "../src/flap/SingularFlapVault.sol";
import {SingularFlapVaultFactory} from "../src/flap/SingularFlapVaultFactory.sol";
import {VaultFactoryBaseV2} from "../src/flap/VaultFactoryBaseV2.sol";
import {VaultUISchema} from "../src/flap/FlapVaultTypes.sol";

contract SingularFlapVaultTest is Test {
    SingularNativePoolManager manager;
    MockRandomnessProvider random;
    SingularFlapVaultFactory factory;
    SingularFlapVault vault;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address portal = 0x027e3704fC5C16522e9393d04C60A3ac5c0d775f;
    address guardian = 0x76Fa8C526f8Bc27ba6958B76DeEf92a0dbE46950;
    address token = address(0xCAFE);

    function setUp() public {
        vm.chainId(97);
        random = new MockRandomnessProvider(address(this));
        manager = new SingularNativePoolManager(address(this), address(random), bob);
        random.setManager(address(manager));
        manager.createPool(0.1 ether, 0.01 ether, 11, 180, 0.01 ether);
        factory = new SingularFlapVaultFactory(address(manager), address(this), bob);
        vm.prank(portal);
        vault = SingularFlapVault(payable(factory.newVault(token, address(0), address(this), "")));
        vm.deal(alice, 1 ether);
    }

    function testFactoryRequiresPortalAndOfficialCreator() public {
        assertEq(factory.officialVault(), address(vault));
        assertEq(factory.officialTaxToken(), token);
        assertEq(vault.taxToken(), token);
        assertEq(vault.vaultQuoteToken(), address(0));
        assertEq(vault.vaultSpecVersion(), "v3");
        assertEq(factory.factorySpecVersion(), "v2.3");
        assertFalse(factory.isQuoteTokenSupported(token));
        assertTrue(factory.isQuoteTokenSupported(address(0)));
        vm.expectRevert(SingularFlapVaultFactory.OnlyPortalOrGuardian.selector);
        factory.newVault(address(0xBEEF), address(0), address(this), "");
        vm.prank(portal);
        vm.expectRevert(SingularFlapVaultFactory.VaultAlreadyCreated.selector);
        factory.newVault(address(0xBEEF), address(0), address(this), "");
        VaultUISchema memory schema = vault.vaultUISchema();
        assertEq(schema.methods[2].name, "buyEntries");
        assertEq(schema.methods[2].inputs[2].fieldType, "msg.value");
    }

    function testGuardianBackupCannotConsumeOfficialPortalLaunchSlot() public {
        SingularFlapVaultFactory freshFactory = new SingularFlapVaultFactory(address(manager), address(this), bob);
        vm.prank(guardian);
        address backupVault = freshFactory.newVault(address(0xBEEF), address(0), address(this), "");
        assertTrue(backupVault != address(0));
        assertEq(freshFactory.officialVault(), address(0));
        assertEq(freshFactory.officialTaxToken(), address(0));

        vm.prank(portal);
        address official = freshFactory.newVault(token, address(0), address(this), "");
        assertTrue(official != backupVault);
        assertEq(freshFactory.officialVault(), official);
        assertEq(freshFactory.officialTaxToken(), token);
    }

    function testFactoryPrelaunchValidationRejectsNonNativeAndZeroShare() public view {
        VaultFactoryBaseV2.LaunchValidationDataV1 memory data;
        data.quoteToken = token;
        data.vaultBps = 100;
        (bool success,) = factory.onBeforeLaunch(abi.encode(data));
        assertFalse(success);
        data.quoteToken = address(0);
        data.vaultBps = 0;
        (success,) = factory.onBeforeLaunch(abi.encode(data));
        assertFalse(success);
        data.vaultBps = 100;
        (success,) = factory.onBeforeLaunch(abi.encode(data));
        assertTrue(success);
    }

    function testVaultPurchaseAndClaimNeverCustodyUserFunds() public {
        vm.prank(alice);
        vault.buyEntries{value: 0.11 ether}(1, 11);
        assertEq(manager.getUserEntries(1, alice), 11);
        assertEq(manager.getUserEntries(1, address(vault)), 0);
        assertEq(address(vault).balance, 0);
        assertEq(vault.accountedQuote(), 0);
        random.fulfill(1, 7);
        uint256 beforeBalance = alice.balance;
        vm.prank(alice);
        vault.claimPrize(1);
        assertEq(alice.balance, beforeBalance + 0.1 ether);
        assertEq(address(vault).balance, 0);
    }

    function testVaultRefundGoesDirectlyToOriginalContributor() public {
        vm.prank(alice);
        vault.buyEntries{value: 0.02 ether}(1, 2);
        vm.warp(manager.getPool(1).deadline);
        uint256 beforeBalance = alice.balance;
        vm.prank(alice);
        vault.claimRefund(1);
        assertEq(alice.balance, beforeBalance + 0.02 ether);
        assertEq(address(vault).balance, 0);
        assertEq(manager.getRefundableAmount(1, alice), 0);
    }

    function testTaxRevenueDeltaAndPermissionlessFixedRecipientPayout() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool success,) = payable(address(vault)).call{value: 0.03 ether}("");
        assertTrue(success);
        assertEq(vault.accountedQuote(), 0.03 ether);
        vm.prank(alice);
        (success,) = payable(address(vault)).call("");
        assertTrue(success);
        assertEq(vault.totalRevenueRecognized(), 0.03 ether);
        uint256 recipientBalance = bob.balance;
        vm.prank(alice);
        vault.releaseRevenue();
        assertEq(bob.balance, recipientBalance + 0.03 ether);
        assertEq(vault.accountedQuote(), 0);
        assertEq(vault.totalRevenuePaid(), 0.03 ether);
        assertEq(address(manager).balance, 0);
    }

    function testTaxRevenueRemainsSeparateDuringTicketPurchase() public {
        vm.prank(alice);
        (bool success,) = payable(address(vault)).call{value: 0.03 ether}("");
        assertTrue(success);
        vm.prank(alice);
        vault.buyEntries{value: 0.01 ether}(1, 1);
        assertEq(vault.accountedQuote(), 0.03 ether);
        assertEq(address(vault).balance, 0.03 ether);
        assertEq(manager.getContribution(1, alice), 0.01 ether);
        assertEq(manager.getUserEntries(1, address(vault)), 0);
    }

    function testReceiveGasStaysBelowFlapLimit() public {
        uint256 beforeGas = gasleft();
        vm.prank(alice);
        (bool success,) = payable(address(vault)).call{value: 0.01 ether}("");
        assertTrue(success);
        assertLt(beforeGas - gasleft(), 1_000_000);
    }
}
