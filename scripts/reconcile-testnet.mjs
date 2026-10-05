import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read-only utility. It intentionally does not load a wallet or sign transactions.
const root = resolve(import.meta.dirname, '..');
const deployment = JSON.parse(readFileSync(resolve(root, 'deployments/bsc-testnet.json'), 'utf8'));
if (deployment.chainId !== 97) throw new Error('Refusing to reconcile a non-BSC-Testnet deployment.');
const rpcUrl = process.env.BSC_TESTNET_RPC_URL || 'https://bsc-testnet-dataseed.bnbchain.org';
let nextId = 1;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const call = async (address, selector, args = '') => BigInt(await rpc('eth_call', [{ to: address, data: selector + args }, 'latest']));
const pad = n => BigInt(n).toString(16).padStart(64, '0');
const manager = deployment.poolManager, vault = deployment.feeVault;
const count = Number(await call(manager, '0xf525cb68'));
const totals = {
  managerBalance: BigInt(await rpc('eth_getBalance', [manager, 'latest'])),
  active: await call(manager, '0x030d2a87'), refunds: await call(manager, '0x6434429a'),
  winners: await call(manager, '0xd22a4c03'), feesPending: await call(manager, '0x1f9fa726'),
  prizeClaimed: await call(manager, '0x5a02efa9'), refunded: await call(manager, '0xd9082962'),
  vaultBalance: BigInt(await rpc('eth_getBalance', [vault, 'latest'])),
  vaultAvailable: await call(vault, '0x289a74c9'), vaultWithdrawn: await call(vault, '0xfffeaf60')
};
let entered = 0n;
const pools = [];
for (let id = 1; id <= count; id++) {
  const data = await rpc('eth_call', [{ to: manager, data: '0x068bcd8d' + pad(id) }, 'latest']);
  const w = (data.slice(2).match(/.{64}/g) || []).map(x => BigInt('0x' + x));
  const gross = w[1] * w[4]; entered += gross;
  pools.push({ id, enteredWei: String(gross), prizeWei: String(w[0]), protocolFeeWei: String(w[2]), entriesSold: Number(w[4]), capacity: Number(w[3]), status: Number(w[9]), prizeClaimed: w[14] !== 0n, feeSwept: w[15] !== 0n });
}
const managerDifference = totals.managerBalance - totals.active - totals.refunds - totals.winners - totals.feesPending;
const vaultDifference = totals.vaultBalance - totals.vaultAvailable;
const flowDifference = entered - totals.prizeClaimed - totals.refunded - totals.vaultAvailable - totals.vaultWithdrawn - totals.managerBalance;
console.log(JSON.stringify({ network: 'BSC Testnet', chainId: 97, pools,
  totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, String(value)])),
  enteredWei: String(entered), managerDifferenceWei: String(managerDifference),
  vaultDifferenceWei: String(vaultDifference), flowDifferenceWei: String(flowDifference),
  note: 'Nonzero differences may represent forced BNB; investigate every discrepancy.' }, null, 2));
