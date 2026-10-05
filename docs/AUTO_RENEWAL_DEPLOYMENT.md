# SINGULAR automatic renewal status

The original BSC Testnet Pool Manager (`0x6912609208BE953FD6B9d0176841F3A64746Ce82`) **does not** have automatic renewal. It cannot be upgraded in place. Its pools remain on that contract and winners can claim there. The local website and admin console now point to the separately deployed recurring-test Manager (`0x0128bf9d65bc88ae0cb1849e4cde85e4b2161bf6`), but an end-to-end recurring draw has not yet been verified.

The new source in `contracts/src/SingularNativePoolManager.sol` adds `createRecurringPool`. Only the immutable `poolCreator` can call it. Once a recurring pool fills, the fixed VRF provider requests randomness. In the successful callback, the manager records the winner and creates one fresh `WAITING` pool with the same prize, ticket price, capacity, duration and fee in the same transaction. The new pool is also recurring. Non-recurring `createPool` behavior remains unchanged. An unfilled, expired pool does not renew because it has not drawn.

No local Keeper or administrator computer needs to remain online for the draw or renewal. Chainlink VRF subscription funding and an approved consumer are still required. A missing/failed VRF callback means the pool remains `DRAWING` and no renewal occurs. Renewing inside the callback uses more gas; new VRF Provider deployments should configure at least the tested 500,000 callback gas limit, then verify the actual network limits and fulfillment before any public launch.

Before activation:

1. Deploy a fresh VRF Provider configured with a 500,000 callback gas limit, then a fresh Pool Manager bound to it. The old Provider's manager binding is one-time and cannot be reused.
2. Add the new Provider address to the Chainlink VRF 2.5 subscription consumers and keep the subscription funded.
3. Verify the new addresses, fixed creator and fee recipient, and run a full testnet pool: creation via `createRecurringPool`, two distinct ticket holders, VRF fulfillment, automatic creation of exactly one identical successor, winner claim, protocol-fee sweep, and fee withdrawal.
4. Keep this release on BSC Testnet while testing. The admin console probes whether the configured manager supports recurring pools and only then offers the recurring option. Do not describe automatic renewal as verified until the full test succeeds.

Until these steps are completed and wallet transactions are confirmed, do not describe renewal as verified or use this release on Mainnet.
