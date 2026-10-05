# SINGULAR Native BNB Smart Contract V1 — Local Report

> Historical V1 snapshot. Its pause, owner-transfer, and provider-rotation descriptions no longer match current source. For the current immutable-authority and Flap adapter status, see `FLAP_TESTNET_READINESS.md` and `contracts/README.md`. This report must not be used as a deployment checklist.

Date: 2026-10-05 (Asia/Shanghai). Scope: local Solidity implementation and verification only. No BNB Chain deployment, real-value transfer, frontend contract connection, token or swap work occurred.

## Deliverables

- `contracts/src/SingularNativePoolManager.sol`: fixed native BNB pool economics, one-ticket-per-entry ledger, timer, randomness callback, immutable winner, pull claims and four-category liability accounting.
- `contracts/src/SingularFeeVault.sol`: realized protocol fee custody with two-step owner transfer and guarded withdrawal.
- `contracts/src/IRandomnessProvider.sol`: vendor-independent request/callback interface.
- `contracts/src/MockRandomnessProvider.sol`: deterministic owner-controlled **test-only** provider.
- `contracts/test/`: unit, fuzz, adversarial and state-sequence invariant tests.
- `contracts/script/DeployBscTestnet.s.sol` and `.env.example`: manual testnet preparation, chain ID 97 guard and secure account configuration names.
- `contracts/abi/SingularNativePoolManager.min.json`: minimal future frontend reads, writes and indexing events.
- `contracts/README.md` and `contracts/THREAT_MODEL.md`: design, operating assumptions and residual risks.

The existing Demo App remains the running product. Its inactive `OnchainSingularProvider` now accepts future ABI, address and transport configuration and maps the five contract states to existing UI states, but performs no chain calls.

## Architecture and state machine

`WAITING → LIVE → DRAWING → COMPLETED`, or `WAITING → LIVE → EXPIRED`. The first successful purchase atomically records sequential zero-based tickets, starts the countdown and emits start/purchase events. Exact payment and remaining capacity are enforced for every purchase. The final ticket closes entry and requests randomness in the same transaction. If that external request fails, the purchase reverts in full.

The provider and request ID are bound to the full pool at request time. The callback must come from that provider and can be fulfilled only once. `randomValue % capacity` selects a recorded ticket; its owner becomes the winner. There is no winner-wallet parameter, reroll or admin result setter. Prize transfer happens later by winner pull claim. Incomplete pools become economically expired at the exact deadline, and participant refunds work without an admin sync transaction. Pause blocks creation and entries, while fulfillment and claims remain available.

## Funds and admin powers

The manager tracks active funds, expired refund funds, winner prizes and realized fees awaiting vault transfer. Its balance equals their sum in normal flows; forced BNB is reported separately and has no owner withdrawal path. Successful resolution converts active funds to winner and fee liabilities. Expiration converts active funds to refunds and realizes no fee. Anyone may sweep each resolved pool's fee once to the fee vault. The vault owner may withdraw only recorded realized fees.

The manager owner may create pools, pause/unpause new activity and change the provider for **future** requests. Two-step ownership applies to manager and vault. No owner function can alter an active pool's terms or tickets, select a winner, cancel a funded pool, withdraw participant liabilities or reroll a result.

## Verification

- Solidity 0.8.24 compilation succeeded.
- `forge test --profile ci -vv`: **30/30 tests passed** (29 unit/fuzz tests plus one invariant suite), zero failed.
- Four fuzz tests each ran **2,048** inputs: quantity, valid economics, wallet purchase ordering and winning random value.
- Four invariants ran **512 × 128 = 65,536** randomized handler calls with zero handler reverts: asset/liability equality, capacity/ticket ownership, outcome/refund exclusivity and refund/claim limits.
- Tests cover the exact deadline boundary, stale competing final entry, no partial fill, repeated purchases, provider rotation, failed provider request, duplicate/wrong callback, first/last ticket, failed native transfers, pause, admin rejection, fee isolation, forced BNB and double claims.
- `npm test` for the Demo Provider and future status mapping should be run whenever the application files are changed; the browser UI was not connected to contracts.

## Gas report

`forge test --gas-report` completed. Representative successful-call gas measured with local `gasleft` checks (includes a small measurement overhead):

| Operation | Approximate gas |
|---|---:|
| `createPool` | 107,199 |
| `buyEntries` first 1 ticket | 149,291 |
| `buyEntries` later 3 tickets | 159,237 |
| `fulfillRandomness` | 149,541 |
| `claimPrize` | 77,217 |
| `claimRefund` including first expiry sync | 128,452 |
| `sweepProtocolFee` | 101,214 |
| Maximum 500-ticket purchase test transaction | 13,407,370 |

The per-ticket storage writes dominate large purchases. Before testnet, confirm acceptable transaction gas limits and consider reducing `MAX_CAPACITY` or changing the ticket storage scheme while preserving auditability.

## Compiler and lint observations

`solc` compilation succeeded without a compiler error. The Windows Foundry Solar preprocessor reports an `Ownable(initialOwner)` parse diagnostic (and sometimes duplicate forge-std path diagnostics) even though `solc 0.8.24` compiles the same files successfully. Foundry lint also flags timestamp boundary comparisons and low-level native transfers; these are intentional parts of the timer and pull-payment model. It flags the provider call and its following request event; `buyEntries` and fulfillment are `nonReentrant`, and an unsuccessful request reverts the entire purchase. These diagnostics need review again in an independent audit, not blanket suppression.

## ABI and known limits

The exported ABI contains only pool/ticket/contribution/refund/prize reads, `poolCount`, entry/prize/refund writes and relevant lifecycle events. It omits admin, mock, fee and debug methods.

The largest unresolved protocol dependency is randomness delivery. The mock lets its owner choose a value and must never be marketed as production randomness. A provider that never fulfills leaves a full pool in `DRAWING`; no recovery path is implemented because an unsafe retry could permit rerolls. A rejecting recipient keeps its original entitlement but cannot redirect a claim in V1. Forced BNB stays unaccounted and unrecoverable by the owner. This local test result is not an audit claim.

## Recommended next phase

Select and review a BSC Testnet randomness provider, model its failure/retry semantics without post-result rerolls, validate transaction gas limits, perform a separate security review, then manually deploy and verify on **BSC Testnet** only. Connect the frontend only after the provider, deployed addresses, event indexing and user-facing network checks have been verified end to end. Mainnet remains out of scope.
