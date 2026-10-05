const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../app/onchain-core.js');

const address = '0x1111111111111111111111111111111111111111';
const config = { chainId: 97, rpcUrl: 'https://example.invalid', explorerUrl: 'https://testnet.bscscan.com', poolManagerAddress: address, deploymentBlock: 100 };
const tuple = (values) => '0x' + values.map(O.pad).join('');

test('parse a live pool without losing wei-denominated economics', () => {
  const p = O.parsePool(7, tuple([2n * 10n ** 15n, 10n ** 15n, 10n ** 15n, 3, 1, 180, 100, 280, 99, 1, 0, 0, 0, 0, 0, 0]));
  assert.equal(p.prizeWei, 2n * 10n ** 15n);
  assert.equal(p.entryPriceWei, 10n ** 15n);
  assert.equal(p.status, 'LIVE');
  assert.equal(p.deadline, 280000);
});

test('parse dynamic sequential ticket IDs into one-based UI ticket numbers', () => {
  assert.deepEqual(O.parseTicketIds(tuple([32, 3, 0, 3, 4])), [1, 4, 5]);
});

test('decode a confirmed entry log with deduplication identity', () => {
  const log = { topics: [O.TOPIC.EntriesPurchased, '0x' + O.pad(2), '0x' + address.slice(2).padStart(64, '0')], data: tuple([3, 0, 2, 3n * 10n ** 15n]), transactionHash: '0xabc', logIndex: '0x1', blockNumber: '0x64' };
  const event = O.parseEntryLog(log);
  assert.equal(event.poolId, 2);
  assert.equal(event.quantity, 3);
  assert.equal(event.amountWei, 3n * 10n ** 15n);
  assert.equal(event.transactionHash + ':' + event.logIndex, '0xabc:1');
});

test('wrong network offers switch and wallet_addEthereumChain fallback', async () => {
  const calls = [];
  const wallet = { request: async ({ method }) => { calls.push(method); if (method === 'eth_requestAccounts') return [address]; if (method === 'eth_chainId') return '0x38'; if (method === 'wallet_switchEthereumChain') throw { code: 4902 }; return null; } };
  const p = new O.OnchainSingularProvider(config, wallet, async () => ({ json: async () => ({ result: '0x0' }) }));
  p.refresh = async () => {};
  await p.connectWallet();
  assert.deepEqual(calls, ['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
  assert.equal(p.getWallet().network, 'BSC Testnet');
});

test('wallet switching and disconnect clear previous account records', async () => {
  const second = '0x2222222222222222222222222222222222222222';
  const listeners = new Map();
  const wallet = { request: async ({ method }) => method === 'eth_requestAccounts' ? [address] : '0x61', on: (name, fn) => listeners.set(name, fn), removeListener: name => listeners.delete(name) };
  const replacement = { request: async ({ method }) => method === 'eth_requestAccounts' ? [second] : '0x61', on: (name, fn) => listeners.set(`new:${name}`, fn) };
  const p = new O.OnchainSingularProvider(config, wallet, null);
  p.refresh = async () => {};
  await p.connectWallet();
  p.pools = [{ id: 1, myEntries: 2, myTicketIds: [1, 2], myContributionWei: 2n, refundableWei: 1n, claimableWei: 1n, refundClaimed: false, contractStatus: 4 }];
  listeners.get('accountsChanged')([second]);
  assert.equal(p.getWallet().address, second);
  assert.equal(p.getEntries().length, 0);
  assert.equal(p.getRefunds().length, 0);
  assert.equal(p.getPool(1).myEntries, 0);
  await p.connectWallet(replacement);
  assert.equal(p.getWallet().address, second);
  assert.equal(listeners.has('accountsChanged'), false);
  p.disconnectWallet();
  assert.equal(p.getWallet().connected, false);
  assert.equal(p.getWallet().wrongNetwork, false);
  assert.equal(p.getEntries().length, 0);
});

test('wallet connects before slow history refresh finishes', async () => {
  let finishRefresh;
  const wallet = { request: async ({ method }) => method === 'eth_requestAccounts' ? [address] : '0x61' };
  const p = new O.OnchainSingularProvider(config, wallet, null);
  p.refresh = () => new Promise(resolve => { finishRefresh = resolve; });
  const connected = await p.connectWallet();
  assert.equal(connected.connected, true);
  assert.equal(typeof finishRefresh, 'function');
  finishRefresh();
});

test('wallet restore checks existing permission without requesting a new connection', async () => {
  const methods = [];
  const wallet = { request: async ({ method }) => { methods.push(method); return method === 'eth_accounts' ? [address] : '0x61'; } };
  const p = new O.OnchainSingularProvider(config, wallet, null);
  assert.equal(await p.restoreWallet(), true);
  assert.equal(p.getWallet().address, address);
  assert.deepEqual(methods, ['eth_accounts', 'eth_chainId']);
});

test('purchase uses exact native wei and rejects stale pool before wallet signing', async () => {
  const calls = [];
  const wallet = { request: async ({ method, params }) => { calls.push({ method, params }); if (method === 'eth_chainId') return '0x61'; if (method === 'eth_accounts') return [address]; return method === 'eth_estimateGas' ? '0x186a0' : '0xhash'; } };
  const p = new O.OnchainSingularProvider(config, wallet, async () => ({ json: async () => ({ result: '0x' + (10n ** 18n).toString(16) }) }));
  p.address = address; p.network = 97;
  p.readPool = async () => ({ contractStatus: 1, deadline: Date.now() + 100000, capacity: 3, entriesSold: 1, entryPriceWei: 10n ** 15n });
  p.rpc = async method => method === 'eth_getTransactionReceipt' ? { status: '0x1' } : method === 'eth_gasPrice' ? '0x1' : '0x' + (10n ** 18n).toString(16);
  p.refresh = async () => {};
  await p.enterPool(2, 2);
  const tx = calls.find(x => x.method === 'eth_sendTransaction').params[0];
  assert.equal(tx.value, '0x71afd498d0000');
  assert.equal(tx.data, O.SELECTOR.buyEntries + O.pad(2) + O.pad(2));
  p.readPool = async () => ({ contractStatus: 2, capacity: 3, entriesSold: 3, entryPriceWei: 10n ** 15n });
  await assert.rejects(() => p.enterPool(2, 1), /no longer accepts/);
});

test('confirmed transaction stays successful when the following RPC refresh fails', async () => {
  const wallet = { request: async ({ method }) => {
    if (method === 'eth_chainId') return '0x61';
    if (method === 'eth_accounts') return [address];
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_sendTransaction') return '0xabc123';
    throw new Error(`Unexpected wallet method ${method}`);
  } };
  const p = new O.OnchainSingularProvider(config, wallet, null);
  p.address = address; p.network = 97;
  p.rpc = async method => method === 'eth_getTransactionReceipt' ? { status: '0x1' } : method === 'eth_gasPrice' ? '0x1' : '0x' + (10n ** 18n).toString(16);
  p.refresh = async () => { throw new Error('RPC unavailable after confirmation'); };
  const states = [], originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await p.send(O.SELECTOR.buyEntries, 2, 1, 10n ** 15n, (state) => states.push(state));
    assert.equal(result.hash, '0xabc123');
    assert.deepEqual(states, ['AWAITING_SIGNATURE', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED']);
  } finally { console.warn = originalWarn; }
});

test('wallet network and account are rechecked before signing', async () => {
  const calls = [];
  const wallet = { request: async ({ method }) => { calls.push(method); if (method === 'eth_chainId') return '0x38'; if (method === 'eth_accounts') return [address]; throw new Error('Signing must not start'); } };
  const p = new O.OnchainSingularProvider(config, wallet, async () => ({ json: async () => ({ result: '0x0' }) }));
  p.address = address; p.network = 97;
  await assert.rejects(() => p.send(O.SELECTOR.claimPrize, 1, null, 0n), /Switch to BSC Testnet/);
  assert.ok(!calls.includes('eth_sendTransaction'));
});

test('claim flows reject disconnected wallet and duplicate claims', async () => {
  const p = new O.OnchainSingularProvider(config, null, null);
  p.readPool = async () => ({ claimableWei: 0n, prizeClaimed: true, refundableWei: 0n, refundClaimed: true });
  await assert.rejects(() => p.claimPrize(1), /Connect your wallet/);
  await assert.rejects(() => p.claimRefund(1), /Connect your wallet/);
  p.address = address; p.network = 97;
  await assert.rejects(() => p.claimPrize(1), /not claimable/);
  await assert.rejects(() => p.claimRefund(1), /No refund/);
  assert.match(O.translateError({ message: 'User rejected request (4001)' }), /rejected/);
});

test('mainnet log reads use the dedicated event RPC', async () => {
  const urls = [];
  const p = new O.OnchainSingularProvider({ ...config, chainId: 56, logRpcUrl: 'https://logs.example.invalid' }, null,
    async (url) => { urls.push(url); return { json: async () => ({ result: [] }) }; });
  await p.rpc('eth_getLogs', [], p.config.logRpcUrl);
  assert.deepEqual(urls, ['https://logs.example.invalid']);
  assert.equal(p.getWallet().network, 'Wrong Network');
});

test('temporary event RPC failures are retried on the next refresh', async () => {
  const p = new O.OnchainSingularProvider(config, null, null);
  p.read = async () => '0x0';
  let attempts = 0;
  p.scanLogs = async () => { if (++attempts === 1) throw new Error('temporary RPC error'); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try { await p.refresh(); await p.refresh(); }
  finally { console.warn = originalWarn; }
  assert.equal(attempts, 2);
  assert.equal(p.logScanError, null);
});

test('pool state renders before slow event history completes', async () => {
  const p = new O.OnchainSingularProvider(config, null, null);
  p.read = async () => '0x0';
  let finishHistory;
  p.scanLogs = () => new Promise(resolve => { finishHistory = resolve; });
  await p.refresh();
  assert.equal(p.hasLoadedPools, true);
  assert.equal(typeof finishHistory, 'function');
  assert.equal(p.logRefreshPending, true);
  finishHistory();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.logRefreshPending, false);
});

test('focused pool refresh publishes a changed ticket count without full history scan', async () => {
  const p = new O.OnchainSingularProvider(config, null, null);
  p.hasLoadedPools = true;
  p.pools = [{ id: 1, entriesSold: 2, participants: [], activity: [] }];
  p.readPool = async () => ({ id: 1, entriesSold: 3, participants: [], activity: [] });
  p.read = async () => '0x1';
  let scans = 0;
  p.refreshLogs = async () => { scans++; };
  await p.refreshFocusedPool(1);
  assert.equal(p.getPool(1).entriesSold, 3);
  assert.equal(scans, 1);
});

test('ticket-owner ledger reconstructs buyer counts when event RPC is unavailable', async () => {
  const p = new O.OnchainSingularProvider(config, null, null);
  p.pools = [{ id: 1, entriesSold: 3, entryPrice: 0.01, participants: [], activity: [] }];
  p.read = async (_selector, _id, index) => '0x' + (index === 2 ? 2n : 1n).toString(16);
  await p.refreshTicketOwners(1);
  assert.deepEqual(p.getPool(1).participants.map(x => x.quantity), [2, 1]);
  assert.deepEqual(p.getPool(1).participants[0].ticketIds, [1, 2]);
});

test('live sync reads only the pool named by a new purchase and stays silent without new events', async () => {
  const p = new O.OnchainSingularProvider(config, null, null);
  p.hasLoadedPools = true;
  p.pools = [1, 2].map(id => ({ id, entriesSold: 0, entryPrice: 0.01, participants: [], activity: [] }));
  p.read = async () => '0x2';
  const reads = [];
  p.readPool = async id => { reads.push(id); return { id, entriesSold: 1, entryPrice: 0.01, participants: [], activity: [] }; };
  p.refreshTicketOwners = async () => {};
  let emissions = 0;
  p.subscribe(() => emissions++);
  p.scanLogs = async () => {};
  await p.syncLive();
  assert.deepEqual(reads, []);
  assert.equal(emissions, 0);
  p.scanLogs = async () => { p.events.push({ type: 'ENTRY', poolId: 2, wallet: address, quantity: 1, amount: 0.01, start: 1, end: 1, time: 1 }); };
  await p.syncLive();
  assert.deepEqual(reads, [2]);
  assert.equal(p.getPool(1).entriesSold, 0);
  assert.equal(p.getPool(2).entriesSold, 1);
  assert.equal(emissions, 1);
});
