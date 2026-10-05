import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.SINGULAR_APP_PORT || 4175);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const paths = new Set(['/index.html', '/app.js', '/styles.css', '/experience.css', '/experience.js', '/pool-visual.css', '/protocol.css', '/home-refinement.css', '/test-bsc-pools.html', '/admin-testnet.html', '/admin-mainnet.html', '/admin-mainnet-v3.html', '/scripts/test-bsc-pools-browser.mjs']);
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    if (!paths.has(pathname) && !/^\/(app|mainnet-app|mainnet-v3-app|legacy-app|assets|docs|whitepaper|transparency)\/[a-zA-Z0-9._/-]+$/.test(pathname)) { response.writeHead(404).end(); return; }
    const file = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`SINGULAR Enter App: http://127.0.0.1:${port}/app/\n`));
