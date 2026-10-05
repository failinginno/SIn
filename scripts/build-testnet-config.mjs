import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const file = process.argv[2] || resolve(root, '.env.testnet');
const values = {};
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^(VITE_[A-Z_]+)=(.*)$/);
  if (match) values[match[1]] = match[2].trim();
}
const allowed = ['VITE_DATA_MODE', 'VITE_CHAIN_ID', 'VITE_RPC_URL', 'VITE_EXPLORER_URL', 'VITE_POOL_MANAGER_ADDRESS', 'VITE_FEE_VAULT_ADDRESS', 'VITE_RANDOMNESS_PROVIDER_ADDRESS', 'VITE_DEPLOYMENT_BLOCK'];
for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`Unexpected public key: ${key}`);
if (values.VITE_DATA_MODE === 'onchain') {
  if (values.VITE_CHAIN_ID !== '97') throw new Error('Only BSC Testnet chain ID 97 is supported.');
  for (const key of ['VITE_POOL_MANAGER_ADDRESS', 'VITE_FEE_VAULT_ADDRESS', 'VITE_RANDOMNESS_PROVIDER_ADDRESS']) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(values[key] || '')) throw new Error(`${key} is missing or invalid.`);
  }
  if (!/^\d+$/.test(values.VITE_DEPLOYMENT_BLOCK || '')) throw new Error('VITE_DEPLOYMENT_BLOCK is missing.');
}
writeFileSync(resolve(root, 'app/runtime-env.js'), `window.__SINGULAR_ENV__ = ${JSON.stringify(values, null, 2)};\n`);
console.log(`Public ${values.VITE_DATA_MODE || 'demo'} configuration generated.`);
