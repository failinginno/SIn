import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const port = 46219;
const url = `http://127.0.0.1:${port}/admin-mainnet.html`;
const server = resolve(import.meta.dirname, 'serve-app.mjs');

async function ready() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    const html = await response.text();
    return response.ok && html.includes('SINGULAR · 主网管理员控制台')
      && html.includes('0xe7cbe024811788ed6158c10d3399ab8738ef421d');
  } catch {
    return false;
  }
}

if (!await ready()) {
  const child = spawn(process.execPath, [server], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, SINGULAR_APP_PORT: String(port) }
  });
  child.unref();
  for (let attempt = 0; attempt < 30 && !await ready(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!await ready()) throw new Error(`无法启动本地管理后台：${url}`);
}

spawn('cmd.exe', ['/c', 'start', '""', url], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
}).unref();
