# SINGULAR migration report

## Scope

The supplied template contained one visual-only `index.html` for an unrelated EOS landing page. There was no ONEDRAW application, wallet integration, contract repository, or documentation code to migrate. The template's approved cinematic video, premium black visual system, typography and pill-button language were retained and extended into a responsive SINGULAR prototype.

## Files added or changed

- `index.html` — SINGULAR marketing page, app surface, pool modal, protocol, transparency, token and documentation content.
- `styles.css` — retained dark/cosmic direction with responsive desktop/mobile layouts.
- `app.js` — dynamic demo pool data, filters, quantity controls, exact cost and odds calculations.
- `contracts/src/IRandomnessProvider.sol` — provider-neutral randomness boundary.
- `contracts/src/SingularNativePoolManager.sol` — native BNB pool lifecycle and liability accounting.
- `contracts/src/SingularFeeVault.sol` — fees isolated from participant liabilities.
- `contracts/test/SingularNativePoolManager.t.sol` — Foundry tests for native value, timer, capacity, settlement, refunds and fuzzed capacity.
- `contracts/foundry.toml` — Foundry configuration.

## Old logic removed

The production-facing files contain no ONEDRAW, Robinhood Chain, USDG, ERC-20 allowance/approval, Robinhood explorer, Robinhood chain ID, or old contract address. Because the starting template did not contain that implementation, no legacy archive was created.

## New native BNB logic

`buyTickets(poolId, quantity)` requires exact `msg.value`. The first successful purchase starts the timer. Purchases cannot oversell or partially fill. A full pool immediately enters `DRAWING`; an incomplete pool at its deadline becomes `EXPIRED`. Refund and prize transfers are claim-based and follow checks-effects-interactions.

## Chain configuration

The interface is explicitly labelled `BSC TEST MODE`. Production wallet connection remains disabled until verified addresses and an environment-supplied BSC RPC are configured. Target mainnet parameters are BNB Smart Chain chain ID `56`, native currency `BNB`. No RPC key is hardcoded.

## Contract architecture

- `SingularNativePoolManager`: pool economics, sequential ticket ownership, lifecycle and liabilities.
- `IRandomnessProvider`: abstract verifiable randomness request boundary.
- `SingularFeeVault`: receives fees only after successful winner selection.

The manager tracks active-pool, refund and winner liabilities independently. Admin functions do not accept a winner or winning ticket and cannot withdraw participant liabilities.

## Frontend architecture

The frontend is dependency-free static HTML/CSS/JavaScript. Pool definitions are data-driven rather than embedded in card markup. The purchase panel calculates quantity, cost and prospective odds. It intentionally sends no transaction in demo mode.

## Remaining deployment work

1. Select and integrate a production-grade BSC randomness provider, then test callbacks and funding assumptions on BSC testnet.
2. Complete an independent smart-contract audit and address every finding.
3. Add production deployment scripts, multisig/timelock ownership and verified BscScan sources.
4. Expand invariant/reentrancy/adversarial testing and run long-duration testnet simulations.
5. Deploy contracts, configure verified addresses through environment variables and only then enable wallet transactions.
6. Add an indexer or resilient RPC read layer for real-time pool state.

## Remaining randomness work

No provider is claimed. The current interface is intentionally generic. A production provider must provide a verifiable request/fulfilment path, request replay protection and operational monitoring. Provider changes must affect only future pools or requests with no active exposure.

## Remaining Flap token launch work

The Token section contains placeholders only. Add the verified token address, liquidity and creator-fee disclosure after launch. The prize protocol must remain independent of Flap and the SINGULAR token.
