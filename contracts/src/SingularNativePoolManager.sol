// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IRandomnessProvider} from "./IRandomnessProvider.sol";
import {SingularFeeVault} from "./SingularFeeVault.sol";

/// @notice Native BNB pools with fixed economics and one immutable ticket-derived winner.
/// @dev One entry is one ticket. Internal ticket IDs start at zero; UI numbers start at one.
contract SingularNativePoolManager is ReentrancyGuard {
    using SafeCast for uint256;
    uint32 public constant MAX_CAPACITY = 500;
    uint64 public constant MAX_DURATION = 30 days;
    uint64 public constant VRF_TIMEOUT = 6 hours;

    enum Status {
        WAITING,
        LIVE,
        DRAWING,
        COMPLETED,
        EXPIRED
    }

    struct Pool {
        uint128 prizeAmount;
        uint128 entryPrice;
        uint128 protocolFee;
        uint32 capacity;
        uint32 entriesSold;
        uint64 duration;
        uint64 startTime;
        uint64 deadline;
        uint64 createdAt;
        Status status;
        address winner;
        uint32 winningTicket;
        uint256 randomnessRequestId;
        address requestProvider;
        bool prizeClaimed;
        bool feeSwept;
    }

    error PoolNotFound();
    error InvalidEconomics();
    error InvalidCapacity();
    error InvalidDuration();
    error InvalidQuantity();
    error InvalidBeneficiary();
    error IncorrectBNBAmount();
    error PoolNotAcceptingEntries();
    error PoolExpired();
    error InsufficientRemainingEntries();
    error RefundUnavailable();
    error PrizeUnavailable();
    error NotWinner();
    error InvalidRandomnessRequest();
    error PoolNotDrawing();
    error NativeTransferFailed();
    error InvalidProvider();
    error FeeUnavailable();
    error DirectPaymentDisabled();
    error OnlyPoolCreator();
    error InvalidPoolCreator();

    address public immutable poolCreator;
    /// @notice Fixed for this deployment. No owner action can replace the draw source.
    IRandomnessProvider public immutable randomnessProvider;
    SingularFeeVault public immutable feeVault;
    uint256 public poolCount;
    uint256 public activePoolLiabilities;
    uint256 public refundLiabilities;
    uint256 public winnerLiabilities;
    uint256 public protocolFeeLiabilities;
    uint256 public totalPrizeClaimed;
    uint256 public totalRefunded;
    uint256 public totalFeesRealized;

    mapping(uint256 => Pool) private _pools;
    mapping(uint256 => mapping(uint32 => address)) private _ticketOwner;
    mapping(uint256 => mapping(address => uint32[])) private _userTicketIds;
    mapping(uint256 => mapping(address => uint256)) private _contribution;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;
    mapping(bytes32 => uint256) private _requestPool;
    mapping(bytes32 => bool) private _requestPending;
    /// @notice Fixed at creation. A recurring pool renews only after a successful draw.
    mapping(uint256 => bool) public recurringPool;
    mapping(uint256 => uint256) public renewedFrom;
    mapping(uint256 => uint64) public drawTimeoutAt;

    event PoolCreated(
        uint256 indexed poolId,
        uint256 prizeAmount,
        uint256 entryPrice,
        uint32 capacity,
        uint64 duration,
        uint256 protocolFee
    );
    event PoolStarted(uint256 indexed poolId, uint64 startTime, uint64 deadline);
    event EntriesPurchased(
        uint256 indexed poolId,
        address indexed wallet,
        uint32 quantity,
        uint32 firstTicket,
        uint32 lastTicket,
        uint256 amount
    );
    event PoolFilled(uint256 indexed poolId);
    event RandomnessRequested(uint256 indexed poolId, address indexed provider, uint256 indexed requestId);
    event OutcomeResolved(uint256 indexed poolId, address indexed winner, uint32 winningTicket, uint256 randomValue);
    event PrizeClaimed(uint256 indexed poolId, address indexed winner, uint256 amount);
    event ProtocolFeeAccrued(uint256 indexed poolId, uint256 amount);
    event ProtocolFeeTransferred(uint256 indexed poolId, uint256 amount);
    event PoolExpiredEvent(uint256 indexed poolId);
    event PoolVrfTimedOut(uint256 indexed poolId, uint256 indexed requestId);
    event RefundClaimed(uint256 indexed poolId, address indexed wallet, uint256 amount);
    event PoolRenewed(uint256 indexed previousPoolId, uint256 indexed nextPoolId);
    event RandomnessIgnoredAfterTimeout(uint256 indexed poolId, uint256 indexed requestId);

    constructor(address initialCreator, address provider, address feeRecipient) {
        if (initialCreator == address(0)) revert InvalidPoolCreator();
        if (provider.code.length == 0) revert InvalidProvider();
        poolCreator = initialCreator;
        randomnessProvider = IRandomnessProvider(provider);
        feeVault = new SingularFeeVault(address(this), feeRecipient);
    }

    function createPool(uint128 prizeAmount, uint128 entryPrice, uint32 capacity, uint64 duration, uint128 protocolFee)
        external
        returns (uint256 poolId)
    {
        if (msg.sender != poolCreator) revert OnlyPoolCreator();
        return _createPool(prizeAmount, entryPrice, capacity, duration, protocolFee, false);
    }

    /// @notice A new identical WAITING pool follows verified draw settlement only.
    /// @dev Expired pools remain refundable; the creator decides whether to create a replacement.
    function createRecurringPool(uint128 prizeAmount, uint128 entryPrice, uint32 capacity, uint64 duration, uint128 protocolFee)
        external
        returns (uint256 poolId)
    {
        if (msg.sender != poolCreator) revert OnlyPoolCreator();
        return _createPool(prizeAmount, entryPrice, capacity, duration, protocolFee, true);
    }

    function _createPool(uint128 prizeAmount, uint128 entryPrice, uint32 capacity, uint64 duration, uint128 protocolFee, bool recurring)
        internal returns (uint256 poolId)
    {
        if (capacity == 0 || capacity > MAX_CAPACITY) revert InvalidCapacity();
        if (duration == 0 || duration > MAX_DURATION) revert InvalidDuration();
        if (prizeAmount == 0 || entryPrice == 0 || uint256(entryPrice) * capacity != uint256(prizeAmount) + protocolFee)
        {
            revert InvalidEconomics();
        }
        poolId = ++poolCount;
        Pool storage pool = _pools[poolId];
        pool.prizeAmount = prizeAmount;
        pool.entryPrice = entryPrice;
        pool.protocolFee = protocolFee;
        pool.capacity = capacity;
        pool.duration = duration;
        pool.createdAt = block.timestamp.toUint64();
        pool.status = Status.WAITING;
        recurringPool[poolId] = recurring;
        emit PoolCreated(poolId, prizeAmount, entryPrice, capacity, duration, protocolFee);
    }

    function buyEntries(uint256 poolId, uint32 quantity) external payable nonReentrant {
        _buyEntries(poolId, quantity, msg.sender);
    }

    /// @notice Allows a UI adapter to purchase tickets directly for its user.
    /// @dev The adapter never owns the ticket or the user's claim; the beneficiary is recorded onchain.
    function buyEntriesFor(uint256 poolId, uint32 quantity, address beneficiary) external payable nonReentrant {
        _buyEntries(poolId, quantity, beneficiary);
    }

    function _buyEntries(uint256 poolId, uint32 quantity, address beneficiary) internal {
        Pool storage pool = _existingPool(poolId);
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (quantity == 0) revert InvalidQuantity();
        if (pool.status != Status.WAITING && pool.status != Status.LIVE) revert PoolNotAcceptingEntries();
        if (pool.status == Status.LIVE && block.timestamp >= pool.deadline) revert PoolExpired();
        if (quantity > pool.capacity - pool.entriesSold) revert InsufficientRemainingEntries();
        uint256 cost = uint256(pool.entryPrice) * quantity;
        if (msg.value != cost) revert IncorrectBNBAmount();

        if (pool.status == Status.WAITING) {
            pool.startTime = block.timestamp.toUint64();
            pool.deadline = (block.timestamp + pool.duration).toUint64();
            pool.status = Status.LIVE;
            emit PoolStarted(poolId, pool.startTime, pool.deadline);
        }

        uint32 firstTicket = pool.entriesSold;
        pool.entriesSold += quantity;
        _contribution[poolId][beneficiary] += cost;
        activePoolLiabilities += cost;
        for (uint32 i; i < quantity; ++i) {
            uint32 ticketId = firstTicket + i;
            _ticketOwner[poolId][ticketId] = beneficiary;
            _userTicketIds[poolId][beneficiary].push(ticketId);
        }
        emit EntriesPurchased(poolId, beneficiary, quantity, firstTicket, pool.entriesSold - 1, cost);

        if (pool.entriesSold == pool.capacity) {
            pool.status = Status.DRAWING;
            drawTimeoutAt[poolId] = (block.timestamp + VRF_TIMEOUT).toUint64();
            emit PoolFilled(poolId);
            // This external call must return a request ID. A callback must occur in a later transaction.
            address provider = address(randomnessProvider);
            uint256 requestId = randomnessProvider.requestRandomness(poolId);
            bytes32 key = _requestKey(provider, requestId);
            if (_requestPending[key] || _requestPool[key] != 0) revert InvalidRandomnessRequest();
            pool.requestProvider = provider;
            pool.randomnessRequestId = requestId;
            _requestPool[key] = poolId;
            _requestPending[key] = true;
            emit RandomnessRequested(poolId, provider, requestId);
        }
    }

    function fulfillRandomness(uint256 requestId, uint256 randomValue) external nonReentrant {
        bytes32 key = _requestKey(msg.sender, requestId);
        if (!_requestPending[key]) revert InvalidRandomnessRequest();
        uint256 poolId = _requestPool[key];
        Pool storage pool = _pools[poolId];
        if (pool.requestProvider != msg.sender || pool.randomnessRequestId != requestId) {
            revert InvalidRandomnessRequest();
        }

        _requestPending[key] = false;
        if (pool.status == Status.EXPIRED || (pool.status == Status.DRAWING && block.timestamp >= drawTimeoutAt[poolId])) {
            _syncExpired(poolId, pool);
            emit RandomnessIgnoredAfterTimeout(poolId, requestId);
            return;
        }
        if (pool.status != Status.DRAWING) revert PoolNotDrawing();
        uint32 winningTicket = (randomValue % pool.capacity).toUint32();
        address winner = _ticketOwner[poolId][winningTicket];
        assert(winner != address(0));
        pool.winningTicket = winningTicket;
        pool.winner = winner;
        pool.status = Status.COMPLETED;

        uint256 gross = uint256(pool.entryPrice) * pool.capacity;
        activePoolLiabilities -= gross;
        winnerLiabilities += pool.prizeAmount;
        protocolFeeLiabilities += pool.protocolFee;
        totalFeesRealized += pool.protocolFee;
        emit OutcomeResolved(poolId, winner, winningTicket, randomValue);
        emit ProtocolFeeAccrued(poolId, pool.protocolFee);
        _renewPool(poolId, pool);
    }

    function claimPrize(uint256 poolId) external nonReentrant {
        _claimPrize(poolId, msg.sender);
    }

    /// @notice Permissionless trigger; the prize can only go to the recorded winner.
    function claimPrizeFor(uint256 poolId, address winner) external nonReentrant {
        _claimPrize(poolId, winner);
    }

    function _claimPrize(uint256 poolId, address winner) internal {
        Pool storage pool = _existingPool(poolId);
        if (pool.status != Status.COMPLETED || pool.prizeClaimed) revert PrizeUnavailable();
        if (winner != pool.winner) revert NotWinner();
        uint256 amount = pool.prizeAmount;
        pool.prizeClaimed = true;
        winnerLiabilities -= amount;
        totalPrizeClaimed += amount;
        emit PrizeClaimed(poolId, winner, amount);
        (bool success,) = payable(winner).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    function claimRefund(uint256 poolId) external nonReentrant {
        _claimRefund(poolId, msg.sender);
    }

    /// @notice Permissionless trigger; refund always goes to the original contributor.
    function claimRefundFor(uint256 poolId, address wallet) external nonReentrant {
        _claimRefund(poolId, wallet);
    }

    function _claimRefund(uint256 poolId, address wallet) internal {
        Pool storage pool = _existingPool(poolId);
        _syncExpired(poolId, pool);
        if (pool.status != Status.EXPIRED || refundClaimed[poolId][wallet]) revert RefundUnavailable();
        uint256 amount = _contribution[poolId][wallet];
        if (amount == 0) revert RefundUnavailable();
        refundClaimed[poolId][wallet] = true;
        refundLiabilities -= amount;
        totalRefunded += amount;
        emit RefundClaimed(poolId, wallet, amount);
        (bool success,) = payable(wallet).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    /// @notice Optional public sync for events and storage classification; claims do not depend on it.
    function syncExpired(uint256 poolId) external {
        Pool storage pool = _existingPool(poolId);
        _syncExpired(poolId, pool);
        if (pool.status != Status.EXPIRED) revert RefundUnavailable();
    }

    function sweepProtocolFee(uint256 poolId) external nonReentrant {
        Pool storage pool = _existingPool(poolId);
        if (pool.status != Status.COMPLETED || pool.feeSwept) revert FeeUnavailable();
        pool.feeSwept = true;
        uint256 amount = pool.protocolFee;
        protocolFeeLiabilities -= amount;
        emit ProtocolFeeTransferred(poolId, amount);
        feeVault.recordFee{value: amount}(poolId);
    }

    function getPool(uint256 poolId) external view returns (Pool memory pool) {
        Pool storage stored = _existingPool(poolId);
        Status effective = _effectiveStatus(poolId, stored);
        pool = stored;
        pool.status = effective;
    }

    function getEffectiveStatus(uint256 poolId) external view returns (Status) {
        return _effectiveStatus(poolId, _existingPool(poolId));
    }

    function getTicketOwner(uint256 poolId, uint32 ticketId) external view returns (address) {
        Pool storage pool = _existingPool(poolId);
        if (ticketId >= pool.entriesSold) return address(0);
        return _ticketOwner[poolId][ticketId];
    }

    function getUserEntries(uint256 poolId, address wallet) external view returns (uint256) {
        _existingPool(poolId);
        return _userTicketIds[poolId][wallet].length;
    }

    function getUserTicketIds(uint256 poolId, address wallet) external view returns (uint32[] memory) {
        _existingPool(poolId);
        return _userTicketIds[poolId][wallet];
    }

    function getContribution(uint256 poolId, address wallet) external view returns (uint256) {
        _existingPool(poolId);
        return _contribution[poolId][wallet];
    }

    function getRefundableAmount(uint256 poolId, address wallet) external view returns (uint256) {
        Pool storage pool = _existingPool(poolId);
        if (_effectiveStatus(poolId, pool) != Status.EXPIRED || refundClaimed[poolId][wallet]) return 0;
        return _contribution[poolId][wallet];
    }

    function getClaimablePrize(uint256 poolId, address wallet) external view returns (uint256) {
        Pool storage pool = _existingPool(poolId);
        return pool.status == Status.COMPLETED && !pool.prizeClaimed && pool.winner == wallet ? pool.prizeAmount : 0;
    }

    function totalLiabilities() public view returns (uint256) {
        return activePoolLiabilities + refundLiabilities + winnerLiabilities + protocolFeeLiabilities;
    }

    function liabilityDiagnostics()
        external
        view
        returns (
            uint256 assets,
            uint256 activeFunds,
            uint256 refundableFunds,
            uint256 winnerPrizes,
            uint256 realizedFees,
            uint256 unaccountedFunds
        )
    {
        assets = address(this).balance;
        activeFunds = activePoolLiabilities;
        refundableFunds = refundLiabilities;
        winnerPrizes = winnerLiabilities;
        realizedFees = protocolFeeLiabilities;
        uint256 liabilities = totalLiabilities();
        unaccountedFunds = assets > liabilities ? assets - liabilities : 0;
    }

    function _existingPool(uint256 poolId) internal view returns (Pool storage pool) {
        if (poolId == 0 || poolId > poolCount) revert PoolNotFound();
        pool = _pools[poolId];
    }

    function _effectiveStatus(uint256 poolId, Pool storage pool) internal view returns (Status) {
        if (pool.status == Status.LIVE && block.timestamp >= pool.deadline) return Status.EXPIRED;
        if (pool.status == Status.DRAWING && block.timestamp >= drawTimeoutAt[poolId]) return Status.EXPIRED;
        return pool.status;
    }

    function _syncExpired(uint256 poolId, Pool storage pool) internal {
        bool unfilled = pool.status == Status.LIVE && block.timestamp >= pool.deadline;
        bool vrfTimedOut = pool.status == Status.DRAWING && block.timestamp >= drawTimeoutAt[poolId];
        if (!unfilled && !vrfTimedOut) return;
        pool.status = Status.EXPIRED;
        uint256 funds = uint256(pool.entryPrice) * pool.entriesSold;
        activePoolLiabilities -= funds;
        refundLiabilities += funds;
        emit PoolExpiredEvent(poolId);
        if (vrfTimedOut) emit PoolVrfTimedOut(poolId, pool.randomnessRequestId);
    }

    function _renewPool(uint256 poolId, Pool storage pool) internal {
        if (!recurringPool[poolId]) return;
        uint256 nextPoolId = _createPool(pool.prizeAmount, pool.entryPrice, pool.capacity, pool.duration, pool.protocolFee, true);
        renewedFrom[nextPoolId] = poolId;
        emit PoolRenewed(poolId, nextPoolId);
    }

    function _requestKey(address provider, uint256 requestId) internal pure returns (bytes32) {
        return keccak256(abi.encode(provider, requestId));
    }

    receive() external payable {
        revert DirectPaymentDisabled();
    }
}
