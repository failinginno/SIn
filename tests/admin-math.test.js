const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

test('admin form derives exact prize and reverses to fee without a transaction', () => {
  const controls = new Map();
  for (const [id, value] of Object.entries({ price: '0.001', capacity: '2', prize: '0.0018', fee: '0.0002', duration: '30', create: '', connect: '', readFee: '', feeRows: '', feeState: '', sweep: '', withdraw: '', poolId: '', log: '尚未操作。' })) {
    controls.set(id, { value, textContent: '', disabled: false, dataset: {}, listeners: {}, before() {}, closest() { return { innerHTML: '' }; }, addEventListener(type, callback) { this.listeners[type] = callback; }, setAttribute() {} });
  }
  const document = {
    head: { append() {} },
    getElementById: id => controls.get(id),
    createElement: () => ({ id: '', textContent: '', dataset: {}, setAttribute() {} }),
    querySelectorAll: () => [],
  };
  const code = readFileSync(resolve(__dirname, '../app/admin-testnet.js'), 'utf8');
  vm.runInNewContext(code, { window: { SINGULAR_TESTNET_CONFIG: { poolManagerAddress: '0x0', feeVaultAddress: '0x0' } }, document, console });
  controls.get('price').value = '0.01'; controls.get('price').listeners.input();
  controls.get('capacity').value = '50'; controls.get('capacity').listeners.input();
  controls.get('fee').value = '0.05'; controls.get('fee').listeners.input();
  assert.equal(controls.get('prize').value, '0.45');
  controls.get('prize').value = '0.4'; controls.get('prize').listeners.input();
  assert.equal(controls.get('fee').value, '0.1');
  controls.get('fee').value = '0.6'; controls.get('fee').listeners.input();
  assert.equal(controls.get('create').disabled, true);
});

test('admin fee dashboard reads all pools and separates withdrawable fees from ticket revenue', async () => {
  const controls = new Map();
  for (const [id, value] of Object.entries({ price: '0.001', capacity: '2', prize: '0.0018', fee: '0.0002', duration: '30', create: '', connect: '', readFee: '', feeRows: '', feeState: '', sweep: '', withdraw: '', poolId: '', log: '尚未操作。', identity: '', controls: '' })) {
    controls.set(id, { value, textContent: '', innerHTML: '', disabled: false, hidden: false, dataset: {}, listeners: {}, before() {}, closest() { return { innerHTML: '' }; }, addEventListener(type, callback) { this.listeners[type] = callback; }, setAttribute() {} });
  }
  const encode = (...values) => '0x' + values.map(value => BigInt(value).toString(16).padStart(64, '0')).join('');
  const pool = (status, fee, swept, sold) => { const words = Array(16).fill(0n); words[1] = 10n ** 15n; words[2] = fee; words[4] = BigInt(sold); words[9] = BigInt(status); words[15] = swept ? 1n : 0n; return encode(...words); };
  const account = '0xa3ff9722b93580d95aae0d9fce09bd1957b916a5';
  const presets = Array.from({ length: 4 }, (_, tier) => ({ disabled: false, dataset: { tier: String(tier) }, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, classList: { toggle() {} } }));
  let writes = 0;
  const ethereum = { on() {}, async request({ method, params = [] }) {
    if (method === 'eth_chainId') return '0x61';
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_sendTransaction') { writes++; throw Error('unexpected write'); }
    if (method === 'eth_call') {
      const data = params[0].data;
      if (data.startsWith('0x03ceba58')) throw Error('old manager');
      if (data.startsWith('0xf525cb68')) return encode(3);
      if (data.startsWith('0x068bcd8d')) {
        const id = Number(BigInt('0x' + data.slice(10)));
        return id === 1 ? pool(3, 200000000000000n, false, 2) : id === 2 ? pool(3, 300000000000000n, true, 2) : pool(1, 400000000000000n, false, 1);
      }
      if (data === '0x289a74c9') return encode(300000000000000n);
      if (data === '0x9fbaf3de') return encode(300000000000000n);
      if (data === '0xfffeaf60') return encode(0);
    }
    throw Error(`unexpected ${method}`);
  } };
  const document = { head: { append() {} }, getElementById: id => controls.get(id), createElement: () => ({ id: '', textContent: '', dataset: {}, setAttribute() {} }), querySelectorAll: selector => selector === '[data-tier]' ? presets : selector === 'button' ? [...presets, controls.get('connect'), controls.get('create')] : [] };
  vm.runInNewContext(readFileSync(resolve(__dirname, '../app/admin-testnet.js'), 'utf8'), { window: { ethereum, SINGULAR_TESTNET_CONFIG: { poolManagerAddress: '0x123', feeVaultAddress: '0x456' } }, document, console });
  await controls.get('connect').onclick();
  assert.ok(presets.every(button => !button.disabled), 'connecting must restore all preset buttons');
  presets[2].listeners.click();
  assert.equal(controls.get('prize').value, '0.5');
  assert.equal(controls.get('duration').value, '20');
  const summary = controls.get('feeState').innerHTML;
  assert.match(summary, /0\.005 tBNB/);
  assert.match(summary, /0\.0005 tBNB/);
  assert.match(summary, /0\.0002 tBNB/);
  assert.match(summary, /0\.0003 tBNB/);
  assert.equal(writes, 0);
});
