# SINGULAR BSC Testnet phase — progress and deployment gate

Status: **local implementation only; no BSC Testnet deployment or real tBNB transaction has occurred**. The existing Demo App remains the default. This report must not be read as completed onchain verification.

## Official network and VRF configuration checked

- Network: BNB Smart Chain Testnet, chain ID 97, native test currency tBNB. RPC is configurable; default public example `https://bsc-testnet-dataseed.bnbchain.org`. Explorer: `https://testnet.bscscan.com`.
- Chainlink VRF V2.5 subscription coordinator: `0xDA3b641D438362C440Ac5458c57e00a712b66700`.
- Testnet 50 gwei key hash: `0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26`.
- Official limits: minimum 3, maximum 200 request confirmations; 2,500,000 maximum callback gas; up to 500 random values for subscription. The adapter asks for one random word, 3 confirmations and native tBNB subscription billing by default. LINK billing is supported through `VRF_NATIVE_PAYMENT=false` after funding LINK instead.
- Source verified on 2026-10-05: [Chainlink VRF V2.5 Supported Networks](https://docs.chain.link/vrf/v2-5/supported-networks), [Chainlink VRF V2.5 Getting Started](https://docs.chain.link/vrf/v2-5/getting-started). Recheck immediately before broadcasting because network settings can change.

## Implementation and local evidence

- `ChainlinkVRFProvider.sol` keeps `SingularNativePoolManager` behind the existing `IRandomnessProvider` interface. A single immutable coordinator can call back; an owner binds the manager only once. Request ID ↔ pool ID mappings are permanent. Unknown, duplicate, unauthorized and malformed callbacks revert. The manager independently authenticates the provider/request and requires `DRAWING`; there is no reroll function.
- Local adapter-to-manager fulfillment measured **190,558 gas** using a coordinator harness. Selected callback limit is **250,000 gas**, allowing margin over this local path while staying far below the network maximum. This is an estimate, not Chainlink coordinator gas usage or proof of Testnet sufficiency. A real Testnet fulfillment must validate it; increase only after a measured failed callback and a security review of recovery implications.
- Foundry `forge test --profile ci`: **36/36 suites/tests passed** (29 prior manager tests, six new VRF adapter tests, one invariant suite). Invariants ran 65,536 state-sequence calls. JavaScript tests: **16/16 passed** at this checkpoint.
- `OnchainSingularProvider` supports testnet wallet switching, reads pool/position/balance, exact native wei entry, claims/refunds, transaction receipts, event indexing from deployment block, and preserves Demo mode. These paths are tested with mocked RPC/wallet responses, not a live browser-wallet/Testnet deployment.

## Deployment details — pending

| Item | Status |
| --- | --- |
| Deployer / owner | Not provided |
| Foundry secure keystore | Not confirmed |
| Funded VRF V2.5 subscription ID | Not provided |
| Fee recipient | Not provided |
| Provider address / tx / block | Not deployed |
| PoolManager address / tx / block | Not deployed |
| FeeVault address / tx / block | Not deployed |
| Source commit | Not available: supplied project directory has no Git repository |
| BscScan verification / bytecode match | Pending deployment |
| `deployments/bsc-testnet.json` | Intentionally absent until addresses are real |

The project directory is not a Git repository, so `git status`, `git diff`, and `git ls-files` cannot prove tracked-secret absence or provide a source commit. A filename scan found only `contracts/.env.example`; no private key was placed in new source, browser config, docs, or scripts. Before broadcasting, put the project under Git, inspect the complete tracked file list, and use a keystore rather than a private key in command history.

## End-to-end test evidence — pending

No small completed pool, expired/refunded pool, multi-wallet ownership, concurrent final entry, VRF callback, prize claim, fee transfer, explorer verification or reconciliation has happened on BSC Testnet. Do not claim any of these as passed. `deployments/bsc-testnet.example.json` is a template, not an address record. `scripts/reconcile-testnet.mjs` is a read-only wei-based accounting tool to run after a real deployment record exists.

## Deployment sequence and acceptance gate

1. Obtain an authorized, keystore-backed Testnet deployer with tBNB; create and fund a VRF V2.5 subscription. Record its ID and billing method privately but not its signing secret.
2. Recheck current official coordinator/key hash and onchain `getConfig`; validate confirmation and gas limits. Run `forge test --profile ci` and inspect Git-tracked files for secrets.
3. Set the public variables in `contracts/.env.example` in the local shell, use the secure Foundry account, and run the chain-97-guarded `DeployBscTestnet` script manually. It deploys provider, manager/vault, then binds manager. Add the **provider** to the subscription consumers and fund the chosen LINK or native balance.
4. Read back the immutable pool creator, fee recipient, vault, provider, pool count, limits and deployed bytecode. Confirm there are no pause, ownership-transfer or manager withdrawal selectors. Verify source and constructor settings on BscScan. Create `deployments/bsc-testnet.json` from actual receipts only.
5. Create tiny test pools with valid economics: `0.002 tBNB` prize, `0.001 tBNB` entry, capacity `3`, `0.001 tBNB` protocol fee, duration `180` seconds. Run a filled pool and a partially filled expiring pool with separate test wallets. Verify real VRF, exact payouts and refunds, then run reconciliation.
6. Populate `.env.testnet` with public deployed addresses/block, run `npm run config:testnet`, and test all App pages with a BSC Testnet wallet. Do not enable `onchain` mode before the above reads and contracts are verified.
7. Only after manager verification, deploy `DeployFlapFactoryBscTestnet` with the manager address and fixed tax recipient. A subsequent Flap VaultPortal test-token launch must create the actual vault; inspect its UI schema and execute a tiny purchase, claim and refund through the real Flap page before promising Flap participation. The factory and vault are not deployed yet.

## Known issues / next steps

- No funded subscription, Testnet deployer or confirmed fee recipient is available in this task. Without those, real transactions are blocked.
- A Chainlink request that never fulfills leaves a full pool in `DRAWING` indefinitely. There is intentionally no admin reroll, refund or client-selected winner. A recovery design needs independent security review.
- The static website uses a generated public runtime config, not a Vite build; `VITE_*` values are consumed by `scripts/build-testnet-config.mjs`. Never put secrets in any `VITE_*` value.
- Event scan chunks are bounded and advance from deployment block while the page is open. Reloading currently replays historical chunks; durable cache and an indexer should be added for a larger history.
- Browser/onchain mode and public RPC compatibility require live Testnet verification. No audit has been performed.
