import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const allowed = new Set([
  '/deploy-bsc-testnet.html',
  '/scripts/deploy-bsc-testnet-browser.mjs',
  '/test-bsc-pools.html',
  '/scripts/test-bsc-pools-browser.mjs',
  '/deploy-flap-factory-testnet.html',
  '/scripts/deploy-flap-factory-browser.mjs',
  '/contracts/out/SingularFlapVaultFactory.sol/SingularFlapVaultFactory.json',
  '/contracts/out/ChainlinkVRFProvider.sol/ChainlinkVRFProvider.json',
  '/contracts/out/SingularNativePoolManager.sol/SingularNativePoolManager.json',
]);
const port = Number(process.env.SINGULAR_LOCAL_PORT || 4174);
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!allowed.has(url.pathname)) { response.writeHead(404).end(); return; }
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    const info = await stat(path);
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(data);
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`SINGULAR local preview: http://127.0.0.1:${port}/\n`));
