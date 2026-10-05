import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
if (!output.startsWith(root + sep) || output === root) throw new Error('Unsafe build output path');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const files = [
  'index.html', 'styles.css', 'app.js', 'experience.css', 'experience.js',
  'pool-visual.css', 'protocol.css', 'home-refinement.css', 'admin-mainnet.html',
  'app/admin-testnet.js', 'app/admin-testnet.css', 'app/admin-fees.css',
  'app/runtime-env-mainnet.js', 'app/runtime-env-mainnet-legacy.js',
  'app/testnet-config.js', 'app/home-copy.js', 'app/demo-core.js', 'app/onchain-core.js',
  'app/singular-pool-visual.js', 'app/demo-app.js', 'app/demo-app.css'
];
for (const file of files) {
  const destination = join(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(root, file), destination);
}
for (const directory of ['assets', 'whitepaper', 'mainnet-app', 'legacy-app', 'transparency']) {
  const source = join(root, directory);
  if (!(await stat(source)).isDirectory()) throw new Error(`Missing ${directory}`);
  await cp(source, join(output, directory), { recursive: true });
}
await mkdir(join(output, 'docs'), { recursive: true });
await cp(join(root, 'docs', 'index.html'), join(output, 'docs', 'index.html'));
process.stdout.write('Mainnet release built in dist/; testnet and verification pages excluded.\n');
