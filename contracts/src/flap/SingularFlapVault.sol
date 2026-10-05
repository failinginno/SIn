// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SingularNativePoolManager} from "../SingularNativePoolManager.sol";
import {VaultBaseV3} from "./VaultBaseV3.sol";
import {FieldDescriptor, ApproveAction, VaultMethodSchema, VaultUISchema} from "./FlapVaultTypes.sol";

/// @notice Flap's native-BNB tax revenue vault and a non-custodial SINGULAR interaction surface.
/// @dev Ticket payment is forwarded in full to the independent manager. Neither tickets nor
///      prize/refund liabilities are held by this vault; tax revenue is accounted separately.
contract SingularFlapVault is VaultBaseV3, ReentrancyGuard {
    using SafeCast for uint256;
    error InvalidConfiguration();
    error InvalidQuantity();
    error NativeTransferFailed();

    SingularNativePoolManager public immutable poolManager;
    address public immutable taxToken;
    address public immutable taxRecipient;
    uint256 public accountedQuote;
    uint256 public totalRevenueRecognized;
    uint256 public totalRevenuePaid;

    event RevenueRecognized(uint256 amount);
    event RevenuePaid(address indexed recipient, uint256 amount);

    constructor(address manager_, address taxToken_, address recipient_) {
        if (manager_.code.length == 0 || taxToken_ == address(0) || recipient_ == address(0)) {
            revert InvalidConfiguration();
        }
        poolManager = SingularNativePoolManager(payable(manager_));
        taxToken = taxToken_;
        taxRecipient = recipient_;
    }

    function vaultQuoteToken() public pure override returns (address) {
        return address(0);
    }

    function description() public view override returns (string memory) {
        return string.concat(
            "SINGULAR BNB vault. Tax revenue available: ", Strings.toString(accountedQuote),
            " wei. No additional vault commission. Tax revenue is paid only to ",
            Strings.toHexString(taxRecipient),
            ". Ticket funds go directly to the immutable pool manager; claims pay users directly."
        );
    }

    receive() external payable {
        _syncRevenue();
    }

    function sync() external {
        _syncRevenue();
    }

    function _syncRevenue() internal {
        uint256 balance = address(this).balance;
        if (balance <= accountedQuote) return;
        uint256 delta = balance - accountedQuote;
        accountedQuote = balance;
        totalRevenueRecognized += delta;
        emit RevenueRecognized(delta);
    }

    /// @notice Anyone may release recognized tax revenue, but only to the fixed recipient.
    function releaseRevenue() external nonReentrant {
        _syncRevenue();
        uint256 amount = accountedQuote;
        if (amount == 0) return;
        accountedQuote -= amount;
        totalRevenuePaid += amount;
        emit RevenuePaid(taxRecipient, amount);
        (bool success,) = payable(taxRecipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    /// @notice A Flap-generated form can buy for its caller without becoming ticket owner.
    function buyEntries(uint256 poolId, uint256 quantity) external payable nonReentrant {
        if (quantity == 0 || quantity > poolManager.MAX_CAPACITY()) revert InvalidQuantity();
        poolManager.buyEntriesFor{value: msg.value}(poolId, quantity.toUint32(), msg.sender);
    }

    /// @notice Requests payout directly from the manager to the recorded winner.
    function claimPrize(uint256 poolId) external nonReentrant {
        poolManager.claimPrizeFor(poolId, msg.sender);
    }

    /// @notice Requests a direct refund from the manager to the original contributor.
    function claimRefund(uint256 poolId) external nonReentrant {
        poolManager.claimRefundFor(poolId, msg.sender);
    }

    function poolSummary(uint256 poolId)
        external
        view
        returns (uint256 prize, uint256 entry, uint256 capacity, uint256 sold, uint256 deadline, uint256 status)
    {
        SingularNativePoolManager.Pool memory pool = poolManager.getPool(poolId);
        return (
            pool.prizeAmount,
            pool.entryPrice,
            pool.capacity,
            pool.entriesSold,
            pool.deadline,
            uint256(pool.status)
        );
    }

    function userEntries(uint256 poolId, address wallet) external view returns (uint256) {
        return poolManager.getUserEntries(poolId, wallet);
    }

    function vaultUISchema() public pure override returns (VaultUISchema memory schema) {
        schema.vaultType = "SINGULAR BNB Pools";
        schema.description = "Tickets settle in the independent pool manager; this vault receives token tax revenue separately.";
        schema.methods = new VaultMethodSchema[](7);

        schema.methods[0] = _method("poolSummary", "Read fixed pool terms and status.", false, 1, 6);
        schema.methods[0].inputs[0] = _field("poolId", "uint256", "Pool ID", 0);
        schema.methods[0].outputs[0] = _field("prize", "uint256", "Prize BNB", 18);
        schema.methods[0].outputs[1] = _field("entry", "uint256", "Entry BNB", 18);
        schema.methods[0].outputs[2] = _field("capacity", "uint256", "Maximum tickets", 0);
        schema.methods[0].outputs[3] = _field("sold", "uint256", "Tickets sold", 0);
        schema.methods[0].outputs[4] = _field("deadline", "time", "Deadline", 0);
        schema.methods[0].outputs[5] = _field("status", "uint256", "0 waiting, 1 live, 2 drawing, 3 completed, 4 expired", 0);

        schema.methods[1] = _method("userEntries", "Read a wallet's ticket count.", false, 2, 1);
        schema.methods[1].inputs[0] = _field("poolId", "uint256", "Pool ID", 0);
        schema.methods[1].inputs[1] = _field("wallet", "address", "Wallet", 0);
        schema.methods[1].outputs[0] = _field("tickets", "uint256", "Owned tickets", 0);

        schema.methods[2] = _method("buyEntries", "Buy BNB tickets for your own wallet. Enter exact ticket price multiplied by quantity as BNB value.", true, 3, 0);
        schema.methods[2].inputs[0] = _field("poolId", "uint256", "Pool ID", 0);
        schema.methods[2].inputs[1] = _field("quantity", "uint256", "Number of tickets", 0);
        schema.methods[2].inputs[2] = _field("payment", "msg.value", "Exact BNB payment", 18);

        schema.methods[3] = _method("claimPrize", "Winner claims BNB directly from the pool manager.", true, 1, 0);
        schema.methods[3].inputs[0] = _field("poolId", "uint256", "Pool ID", 0);

        schema.methods[4] = _method("claimRefund", "Expired-pool contributor claims BNB directly from the manager.", true, 1, 0);
        schema.methods[4].inputs[0] = _field("poolId", "uint256", "Pool ID", 0);

        schema.methods[5] = _method("sync", "Recognize newly received token tax revenue.", true, 0, 0);
        schema.methods[6] = _method("releaseRevenue", "Send recognized tax revenue to the fixed recipient.", true, 0, 0);
    }

    function _field(string memory name, string memory fieldType, string memory label, uint8 decimals)
        private
        pure
        returns (FieldDescriptor memory)
    {
        return FieldDescriptor(name, fieldType, label, decimals);
    }

    function _method(string memory name, string memory label, bool write, uint256 inputs, uint256 outputs)
        private
        pure
        returns (VaultMethodSchema memory method)
    {
        method.name = name;
        method.description = label;
        method.inputs = new FieldDescriptor[](inputs);
        method.outputs = new FieldDescriptor[](outputs);
        method.approvals = new ApproveAction[](0);
        method.isWriteMethod = write;
    }
}
