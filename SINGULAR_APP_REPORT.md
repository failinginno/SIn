# SINGULAR Application Completion Report

## Application routes

- `/app/` — live pool overview, metrics, filters, recent entries and outcomes.
- `/app/pool.html?id=:id` — pool details and entry workflow.
- `/app/entries.html` — demo wallet positions.
- `/app/outcomes.html` — resolved demo pools.
- `/app/refunds.html` — expired-pool refund eligibility and claims.
- `/app/result.html?id=:id` — immutable result-style summary for a resolved demo pool.

The project remains a static site, so query-string detail routes are used instead of pretending a development HTTP server supports history fallbacks.

## Data/provider layer

`app/demo-core.js` defines a small `SingularProvider` contract and implements `DemoSingularProvider`. It covers pool reads, pool detail, entries, outcomes, refunds, wallet state, entry submission, timer/status derivation, deterministic demo resolution, refund claims, persistence and reset. `OnchainSingularProvider` is an intentionally inactive boundary for future contract wiring.

The current build uses local demo state only. It is stored under `singular-demo-state-v2` in browser `localStorage`. Every application route displays a persistent `DEMO MODE · LOCAL STATE · NO REAL FUNDS` banner. No mainnet transaction, transaction hash, wallet balance, or explorer record is fabricated.

## Demo behavior

1. Connect the demo wallet from the application header or a pool entry panel.
2. Open a pool and select an entry quantity.
3. Review the quantity, BNB total and pool in a confirmation modal.
4. Confirm to see `Preparing → Wallet confirmation → Submitted → Confirmed`.
5. The pool, position, distribution, activity and entries page update immediately and persist after refresh.
6. A final-capacity entry moves the pool to `RESOLVING`; the deterministic local resolver then publishes an outcome.
7. The refunds page includes an expired demo contribution. Claiming it persists and a second claim is rejected.
8. Use `Reset demo` on `/app/` to restore seed data.

## Tests

Run `npm test` from the site root. Coverage includes odds, status derivation, first-entry timer, capacity limits, final-entry resolution, refund eligibility, double-refund prevention, persistence, transaction states and preservation of the original BNB economics.

## Mainnet boundary

This completion does not connect contracts, ship ABIs, invent addresses, or claim that demo data is onchain. Mainnet work still requires a configured provider, deployed contract addresses, ABI/event integration, wallet-network enforcement, receipt indexing and independent contract/security review.
