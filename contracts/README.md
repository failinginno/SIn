# SINGULAR Native BNB Pool Manager (renewal and VRF-timeout candidate)

This source is a candidate for a **new** deployment. It does not alter the existing BNB mainnet Pool Manager at `0x6912609208be953fd6b9d0176841f3a64746ce82`. The existing contract and its prize/refund claims must remain accessible. This revision has not received an independent security audit. The included mock randomness provider is controlled by its owner and is **not production randomness**.

## Layout and dependencies

- `src/SingularNativePoolManager.sol`: pool state, ticket ledger, winner finality, claims, accounting.
- `src/SingularFeeVault.sol`: realized fee custody and owner withdrawal.
- `src/IRandomnessProvider.sol`: vendor-independent request/callback interface.
- `src/MockRandomnessProvider.sol`: deterministic local and early testnet testing only.
- `src/ChainlinkVRFProvider.sol`: BSC Testnet VRF V2.5 subscription adapter; coordinator-authenticated callback.
- `src/flap/SingularFlapVault.sol`: native-BNB Flap tax-revenue vault and non-custodial pool interaction page methods.
- `src/flap/SingularFlapVaultFactory.sol`: one-off official factory for a BNB-quoted Flap token, with v2.3 validation and schema discovery.
- `test/`: unit, fuzz and state-sequence invariant tests.
- `script/DeployBscTestnet.s.sol`: manual BSC Testnet script with a chain ID 97 guard.
- `script/DeployFlapFactoryBscTestnet.s.sol`: separate manual factory deployment after the manager is verified.
- `abi/SingularNativePoolManager.min.json`: narrow future frontend ABI.

The local vendor snapshot contains OpenZeppelin Contracts 5.4.0 (`Ownable2Step`, `Pausable`, `ReentrancyGuard`) and forge-std 1.16.2. Licenses are retained under `lib/`.

## Fixed economics and BNB flow

`entryPrice × capacity == prizeAmount + protocolFee` is checked at creation. For example, `0.01 BNB × 11 == 0.10 BNB + 0.01 BNB`. Capacity must be 1–500 and duration 1 second–30 days. These bounds keep onchain ticket writes and deadline values finite; a 500-entry single purchase is still expensive and must be checked against the target chain's transaction gas policy before launch.

`buyEntries(poolId, quantity)` requires exact native BNB. Underpayment, overpayment, zero quantity, expiry and overselling revert the entire transaction. There is no administrator pause. One entry records one ticket. Ticket IDs inside the contract begin at **0**; interfaces may show ticket number `ID + 1`. Repeated purchases append ticket IDs for the same wallet and add to its contribution total.

`buyEntriesFor(poolId, quantity, beneficiary)` supports a Flap interaction adapter without assigning tickets to the adapter. It records each ticket and contribution for the nonzero beneficiary. Permissionless `claimPrizeFor` and `claimRefundFor` can trigger a payout for someone else, but the destination is always the onchain-recorded winner or original contributor; the caller cannot redirect it. Direct user methods remain available.

First successful purchase records tickets and starts the timer in one transaction. At capacity, the same transaction changes `LIVE → DRAWING` and requests randomness exactly once. If the provider request reverts, the final purchase also reverts; no partial fill occurs.

## State machine and settlement

Authoritative states are `WAITING → LIVE → DRAWING → COMPLETED`, `WAITING → LIVE → EXPIRED`, or `WAITING → LIVE → DRAWING → EXPIRED` if VRF has not fulfilled by the fixed 6-hour timeout. A `WAITING` pool with zero entries has no deadline and no refundable funds. `getPool()` and `getEffectiveStatus()` report `EXPIRED` at either deadline even before anyone writes a sync transaction. `claimRefund()` performs that sync internally. `syncExpired()` is permissionless but not needed for a user to claim. Expiry never creates a new pool.

The randomness provider is fixed in the manager constructor and cannot be changed by the owner. The provider used when a pool fills is also stored in that pool. A callback is accepted once, only from the stored provider, for the stored request ID while the pool is `DRAWING`. Request IDs are scoped by provider address. The winning ticket is `randomValue % capacity`; its recorded owner is the winner. Neither the owner nor the callback supplies a winner address. The result is stored before any user claim or fee transfer.

The winner calls `claimPrize()`. A failed BNB transfer reverts that claim and preserves the same winner's entitlement. From creation onward, nobody can cancel the pool or edit its economics or tickets. There is no upgrade mechanism.

An incomplete pool at or after its deadline owes every participant exactly their cumulative contribution. A full pool still awaiting VRF after 6 hours also owes every participant their full contribution; a subsequent VRF callback is ignored and cannot select a winner. `claimRefund()` requires no owner action; it marks the wallet claimed before sending BNB. A second claim cannot succeed. Completed pools cannot refund. A recurring pool renews once with identical terms only after a successful draw. An expired pool does not renew; the fixed pool creator may manually create a replacement later. The previous pool and all its claim rights remain intact.

## Liability accounting and fees

The manager tracks four categories in wei: active pool funds, expired refund funds, winner prize funds and realized unswept protocol fees. A full pool converts active funds into prize and fee liabilities only after successful resolution. Expired pools realize **zero** fee. `liabilityDiagnostics()` exposes each category plus unaccounted native BNB. Forced BNB can increase the balance above liabilities; there is deliberately no owner withdrawal path for that excess.

After completion anyone can call `sweepProtocolFee(poolId)` once. It transfers only that pool's realized fee to `SingularFeeVault`; the vault then tracks `availableFees`. Only its constructor-fixed fee recipient can withdraw, only up to that amount, and only to that same address. Winner prizes and refund liabilities never enter the fee vault. Claims, refunds and fee withdrawal use checks-effects-interactions, low-level calls with success checks, and `ReentrancyGuard`.

## Fixed administrative authority

The constructor-fixed `poolCreator` can only create new pools. The constructor-fixed `feeRecipient` can only withdraw realized fees from the vault. There is no pause, ownership-transfer, manager withdrawal, proxy or upgrade function. Neither address can choose a winner, change any existing pool's terms, reroll a result, change the provider or withdraw participant liabilities. Claims, refunds, expiration sync, VRF fulfillment and realized fee sweeping remain permissionless. Losing either fixed key requires a new deployment; existing pools cannot be migrated or rescued by an administrator.

## Flap adapter boundary

The Flap factory supports native-BNB quoted tokens only, exposes factory v2.3 discovery/validation and creates one official `VaultBaseV3`-surface vault through Flap VaultPortal. Its only restricted method, `newVault`, permits the official Portal or Flap Guardian as required by the Flap factory specification; neither can change the independent manager's pool terms or withdraw user funds. The actual Vault has no privileged methods. Any caller can release recognized token-tax revenue, but only to the constructor-fixed tax recipient. It uses balance-delta accounting and ignores zero-delta wake calls. Ticket payment is forwarded in full to the manager, which records the user's wallet; claims pay users directly from the manager. Tax revenue must never be described as ticket revenue or as the pool protocol fee.

The Flap page is generated from `vaultUISchema()`: it offers pool reads, exact-value ticket purchases, claims and tax-revenue actions. The Flap UI does not automatically calculate `entryPrice × quantity`, so users must enter the exact native BNB payment. Real Flap-page behavior, the official spec checker and VaultPortal integration remain unverified until Testnet. This immutable design does not qualify for Flap's optional low-risk badge, which currently requires a Guardian-upgradeable beacon. Do not present local ABI compatibility as Flap approval or an audit.

As required by the native-revenue vault model, a plain BNB transfer into the Flap Vault is recognized as revenue and can be released to the fixed tax recipient. Users must **not** send ticket BNB directly to the Vault address; they must use `buyEntries`, which forwards payment to the manager and records their ticket. This distinction must be explicit in the Flap UI and public documentation.

Provider selection at deployment remains a major trust dependency. Deploying with the mock would allow its owner to choose draw values and must never be presented as verifiable production randomness. The fixed 6-hour VRF timeout refunds a non-fulfilled full pool instead of rerolling. If a callback arrives at or after that boundary, it is ignored. A new deployment is a distinct contract, not a change to the existing one.

## Local commands

From `contracts/`:

```text
forge build
forge test -vv
forge test --gas-report
forge test --profile ci
```

The code was tested locally with Solidity 0.8.24. The frontend keeps Demo mode as its default, and an opt-in `OnchainSingularProvider` is prepared for a verified BSC Testnet deployment. The onchain path has local tests but has not yet been exercised against a deployed contract.

## Manual testnet preparation

`script/DeployBscTestnet.s.sol` refuses any chain other than BSC Testnet (97). Public configuration names are in `.env.example`. The script deploys the VRF provider, then the manager (which constructs the vault), then binds the manager to the provider. A keystore-backed Forge `--account` must match `DEPLOYER_ACCOUNT`; do not put a private key in this repository or a command line. The subscription owner must add the provider contract as an authorized consumer and fund the selected billing balance. See `../SINGULAR_BSC_TESTNET_REPORT.md` for the current deployment status and Chainlink parameters. No deployment has yet been run.

## Known limitations

- Mock randomness is owner chosen and unsuitable for production.
- Expired pools never renew. The purchasing wallet can claim its refund without an administrator or an automated transaction sender. A replacement requires an explicit new-pool transaction by the fixed creator.
- This source is not the currently deployed mainnet bytecode. Do not redirect the website until a new provider is added to the VRF subscription, code and owner addresses are checked, end-to-end mainnet smoke tests pass, and legacy claims remain reachable.
- Native BNB sent forcibly outside `buyEntries` is visible as unaccounted funds but is intentionally not recoverable by the owner.
- A contract winner or refund recipient that always rejects BNB retains its entitlement but cannot receive funds until it supports a transfer path. No alternate recipient override is allowed.
- The gas cost of writing hundreds of individual ticket IDs is material.
- Tests and a threat model are not an independent audit.
