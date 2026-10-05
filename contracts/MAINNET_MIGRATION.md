# Mainnet renewal and VRF-timeout migration

This is a real-BNB contract replacement, **not** an upgrade of the existing deployment. The public website source now points to the new manager `0xe7cbe024811788ed6158c10d3399ab8738ef421d`; it is not hosted until the owner publishes the repository. The old manager `0x6912609208be953fd6b9d0176841f3a64746ce82` and its pools remain reachable through `/legacy-app/`. Never delete its configuration or remove the old refund/prize claim path.

## New deployment read-only verification (2026-10-05)

- Provider: `0x4773f2e6ad78103ba47d5219a1a945378a49c840`.
- Manager: `0xe7cbe024811788ed6158c10d3399ab8738ef421d`.
- Fee Vault (a separate contract, not the Manager): `0xD842BA07dacE4ca7e320B4FD8F2b253061c2ba23`.
- BNB Chain ID 56; Manager and Provider point to each other; creator and fee recipient are `0xa3ff9722b93580d95aae0d9fce09bd1957b916a5`; Manager reports `VRF_TIMEOUT = 21600` seconds. Provider reports the expected coordinator, 200 gwei key hash, native billing and 500,000 callback gas. Manager has zero pools and zero liabilities.
- Subscription `69950175215913706087256987184682290497316186217230956864948872496659990396211` reports native balance `0.2099378064 BNB` and both the old Provider `0x2bd71367b1f516373ae9931327d5c04b4dcf8804` and new Provider `0x4773f2e6ad78103ba47d5219a1a945378a49c840` as consumers (rechecked 2026-10-05). This is a point-in-time read; recheck before signing.
- These readbacks do not establish an independent audit or byte-for-byte verification of all deployed code. The owner subsequently tested a completed draw, successful same-parameter renewal and winner claim on mainnet. As of the last read-only check, new pool #2 exists and is waiting for entries. Live refund paths were not rehearsed.

## Release gate

1. Disclose the VRF no-result period (**6 hours**, confirmed by the project owner) and obtain independent contract review. The boundary is absolute: callback before timeout resolves; callback at or after timeout refunds and its random word is ignored.
2. Compile the exact source/commit and record artifact hashes. Run Foundry tests, invariants, callback-gas test, and a fork or live small-value rehearsal. Confirm the official Chainlink coordinator, subscription ID, key hash, billing mode and callback gas limit from Chainlink's current BNB mainnet configuration before signing.
3. Deploy a **new** VRF Provider and Pool Manager/Fee Vault using the fixed administrator/fee-recipient wallet. The old provider is bound to the old manager and cannot be repurposed. Verify all three deployed bytecodes and constructor values on BscScan.
4. Bind the new provider to the new manager. Add the **new provider address** as a consumer of the correct funded mainnet VRF subscription. Check subscription balance and fulfillment history; do not assume a funded subscription guarantees callback. Keep gas in the transaction-sending wallet.
5. Create one small recurring mainnet pool and prove purchase, fulfillment, new same-parameter pool, winning-wallet claim and realized fee accounting. Separately prove unfilled expiry and refund **without renewal**; separately prove a full pool's VRF-timeout refund **without renewal** using tests and a controlled live rehearsal when practical. Do not create the full public pool set before these gates.
6. No automatic executor is required for expired-pool renewal: the contract deliberately does not renew refunded pools. Each purchaser can claim from the expired pool without an administrator sync. The fixed pool creator may manually create a replacement later, after reviewing demand and refund state. Never place an administrator private key in a website, repository or browser local storage.
7. Preserve a visible legacy-claims route targeting the old manager and verify a real old-pool refund/prize claim remains possible. Only then switch the public app's manager/provider/vault addresses and deployment block. Label old and new contracts clearly so a wallet never signs for an unexpected address.

The current mainnet deployment page can prepare and request MetaMask signatures; no deployment, consumer registration, pool creation, funding or public-site cutover has been performed by editing these files. Every real-BNB transaction requires the user's wallet confirmation and onchain receipt verification.
