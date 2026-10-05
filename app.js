// Read-only mainnet preview. Wallet writes and claims live in /mainnet-app/.
const config = window.SINGULAR_TESTNET_CONFIG;
const grid = document.querySelector('#poolGrid');
const countLabel = document.querySelector('#poolCount');
let pools = [];
let activeFilter = 'all';
const ENTRY_TOPIC = '0x9fcdbd517515925d5e946a3bd7b3985b7f45d6c42848d738e8dad721773ae772';
let purchaseEvents = [];
let lastEntryBlock = 0;
let ribbonInitialized = false;
let lastPoolRenderKey = '';
const shortWallet = address => `${address.slice(0, 8)}…${address.slice(-4)}`;

async function rpc(method, params = [], url = config.rpcUrl) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.result == null) throw new Error(body.error?.message || 'Mainnet RPC returned no result');
  return body.result;
}

function renderPurchaseRibbon(message) {
  const target = document.querySelector('#purchaseRibbon');
  if (!target) return;
  if (!purchaseEvents.length) { target.textContent = message || 'No recent confirmed ticket purchases.'; return; }
  const items = purchaseEvents.slice(0, 8).map(event => `<a href="./mainnet-app/pool.html?id=${event.poolId}">${shortWallet(event.wallet)} bought <strong>${event.quantity} ${event.quantity === 1 ? 'ticket' : 'tickets'}</strong> in Pool #${event.poolId}</a>`).join('<span aria-hidden="true">✦</span>');
  target.innerHTML = `<div class="purchase-ribbon__track">${items}<span aria-hidden="true">✦</span>${items}</div>`;
}

async function refreshPurchases() {
  try {
    const latest = Number(BigInt(await rpc('eth_blockNumber')));
    const floor = Math.max(Number(config.deploymentBlock || 0), latest - 2500);
    const from = lastEntryBlock ? Math.max(floor, lastEntryBlock + 1) : floor;
    const logRpc = config.logRpcUrl || config.rpcUrl;
    const previousKeys = purchaseEvents.map(event => event.key).join('|');
    const changedPools = new Set();
    for (let end = latest; end >= from; end -= 500) {
      const start = Math.max(from, end - 499);
      const logs = await rpc('eth_getLogs', [{ address: config.poolManagerAddress, topics: [ENTRY_TOPIC], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }], logRpc);
      const parsed = logs.map(log => {
        if (!log.topics?.[1] || !log.topics?.[2] || !log.data || log.data.length < 66) return null;
        const wallet = `0x${log.topics[2].slice(-40)}`;
        const poolId = Number(BigInt(log.topics[1]));
        const quantity = Number(BigInt(`0x${log.data.slice(2, 66)}`));
        if (!/^0x[a-f\d]{40}$/i.test(wallet) || !Number.isSafeInteger(poolId) || !Number.isSafeInteger(quantity) || quantity < 1) return null;
        return { wallet, poolId, quantity, block: Number(BigInt(log.blockNumber)), index: Number(BigInt(log.logIndex)), key: `${log.transactionHash}:${log.logIndex}` };
      }).filter(Boolean);
      if (lastEntryBlock) parsed.forEach(event => changedPools.add(event.poolId));
      purchaseEvents = [...purchaseEvents, ...parsed].sort((a, b) => b.block - a.block || b.index - a.index).filter((event, index, all) => all.findIndex(item => item.key === event.key) === index).slice(0, 8);
      if (!lastEntryBlock && purchaseEvents.length >= 8) break;
    }
    lastEntryBlock = latest;
    const keys = purchaseEvents.map(event => event.key).join('|');
    if (!ribbonInitialized || keys !== previousKeys) { renderPurchaseRibbon(); ribbonInitialized = true; }
    if (changedPools.size) {
      const updates = await Promise.all([...changedPools].map(async id => decodePool(id, await read('0x068bcd8d' + BigInt(id).toString(16).padStart(64, '0')))));
      for (const pool of updates) { const index = pools.findIndex(item => item.id === pool.id); if (index >= 0) pools[index] = pool; }
      render(); updateMetrics();
    }
  } catch (error) {
    console.warn('Recent purchase events unavailable:', error);
    renderPurchaseRibbon(purchaseEvents.length ? undefined : 'Recent purchases are temporarily unavailable.');
  }
}

function bnb(wei) {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

async function read(data) {
  const response = await fetch(config.rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: config.poolManagerAddress, data }, 'latest'] })
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || !body.result) throw new Error(body.error?.message || 'Mainnet RPC returned no result');
  return body.result;
}

function decodePool(id, raw) {
  const words = (raw.slice(2).match(/.{64}/g) || []).map(word => BigInt(`0x${word}`));
  if (words.length < 16) throw new Error('Incomplete mainnet pool data');
  return { id, prizeWei: words[0], ticketWei: words[1], capacity: Number(words[3]), sold: Number(words[4]),
    duration: Number(words[5]), deadline: Number(words[7]) * 1000, status: Number(words[9]),
    winner: `0x${words[10].toString(16).padStart(40, '0').slice(-40)}`, winningTicket: Number(words[11]) + 1,
    prizeClaimed: words[14] !== 0n };
}

function poolStatus(pool) {
  if (pool.status === 0) return 'waiting';
  if (pool.status === 1 && pool.deadline && Date.now() >= pool.deadline) return 'expired';
  if (pool.status === 1) return 'live';
  return 'closed';
}

function render() {
  if (!grid) return;
  const visible = pools.filter(pool => {
    const status = poolStatus(pool);
    return status !== 'closed' && status !== 'expired' && (activeFilter === 'all' || activeFilter === status);
  }).sort((a, b) => a.prizeWei === b.prizeWei ? a.id - b.id : a.prizeWei < b.prizeWei ? -1 : 1);
  countLabel.textContent = `${visible.length} open pool${visible.length === 1 ? '' : 's'}`;
  const key = `${activeFilter}|${visible.map(pool => `${pool.id}:${pool.sold}:${pool.status}:${pool.deadline}`).join('|')}`;
  if (key === lastPoolRenderKey) return;
  lastPoolRenderKey = key;
  if (!visible.length) {
    grid.innerHTML = '<div class="pool-card"><h3>No open pools right now.</h3><p>Completed draws and eligible refunds remain available in the App.</p><div class="pool-card__bottom"><a href="./mainnet-app/outcomes.html">View outcomes →</a></div></div>';
    return;
  }
  grid.innerHTML = visible.map(pool => {
    const status = poolStatus(pool), pct = pool.capacity ? Math.min(100, pool.sold / pool.capacity * 100) : 0;
    const time = status === 'waiting' ? `${pool.duration / 60} min` : `${Math.max(0, Math.ceil((pool.deadline - Date.now()) / 60000))} min`;
    return `<article class="pool-card"><div class="pool-card__top"><span>POOL #${String(pool.id).padStart(2, '0')}</span><span class="status ${status}">● ${status.toUpperCase()}</span></div><h3>${bnb(pool.prizeWei)} BNB</h3><small>PRIZE</small><div class="pool-card__meta"><div><b>${bnb(pool.ticketWei)} BNB</b><span>PER TICKET</span></div><div><b>${pool.sold} / ${pool.capacity}</b><span>TICKETS SOLD</span></div><div><b>${time}</b><span>${status === 'waiting' ? 'STARTS ON ENTRY' : 'TIME REMAINING'}</span></div></div><div class="bar"><i style="width:${pct}%"></i></div><div class="pool-card__bottom"><span>${Math.max(0, pool.capacity - pool.sold)} tickets remaining</span><a href="./mainnet-app/pool.html?id=${pool.id}">View Pool →</a></div></article>`;
  }).join('');
}

function updateMetrics() {
  const open = pools.filter(pool => ['waiting', 'live'].includes(poolStatus(pool)));
  const resolved = pools.filter(pool => pool.status === 3);
  const entered = pools.reduce((sum, pool) => sum + pool.ticketWei * BigInt(pool.sold), 0n);
  const paid = resolved.filter(pool => pool.prizeClaimed).reduce((sum, pool) => sum + pool.prizeWei, 0n);
  document.querySelector('#liveOpen').textContent = open.length;
  document.querySelector('#liveEntries').textContent = pools.reduce((sum, pool) => sum + pool.sold, 0);
  document.querySelector('#liveEntered').textContent = `${bnb(entered)} BNB`;
  document.querySelector('#liveResolved').textContent = resolved.length;
  document.querySelector('#livePaid').textContent = `${bnb(paid)} BNB`;
  document.querySelector('#liveActivity').innerHTML = open.length
    ? `<span class="live-feed__index">${String(open.length).padStart(2, '0')}</span><b>${open.length} pool${open.length === 1 ? '' : 's'} accepting entries</b><p>Review the fixed terms and remaining tickets before entering.</p><a class="section-action" href="./mainnet-app/">Explore pools <span aria-hidden="true">↗</span></a>`
    : '<span class="live-feed__index">00</span><b>No open pools at this moment</b><p>Closed pools remain available for outcome and refund checks.</p><a class="section-action" href="./mainnet-app/">Open the application <span aria-hidden="true">↗</span></a>';
  document.querySelector('#liveOutcome').innerHTML = resolved.length
    ? resolved.slice().reverse().slice(0, 6).map(pool => `<a class="winner-list__row" href="./mainnet-app/result.html?id=${pool.id}" aria-label="View Pool ${pool.id} draw"><span>POOL ${String(pool.id).padStart(2, '0')}</span><strong>${bnb(pool.prizeWei)} BNB</strong><span class="winner-list__wallet" title="${pool.winner}">${pool.winner.slice(0, 8)} ${pool.winner.slice(-4)}</span><span>TICKET ${pool.winningTicket}</span></a>`).join('')
    : '<p>No completed draws yet</p>';
}

async function refresh() {
  try {
    if (config.chainId !== 56 || !/^0x[a-f\d]{40}$/i.test(config.poolManagerAddress)) throw new Error('Mainnet configuration unavailable');
    const total = Number(BigInt(await read('0xf525cb68')));
    if (!Number.isSafeInteger(total) || total > 2000) throw new Error('Invalid pool count');
    const results = [];
    for (let id = 1; id <= total; id += 10) {
      const batch = Array.from({ length: Math.min(10, total - id + 1) }, (_, offset) => id + offset);
      results.push(...await Promise.all(batch.map(async poolId => decodePool(poolId, await read('0x068bcd8d' + BigInt(poolId).toString(16).padStart(64, '0'))))));
    }
    pools = results;
    render();
    updateMetrics();
  } catch (error) {
    console.warn('Mainnet pool preview unavailable:', error);
    lastPoolRenderKey = '';
    if (grid) grid.innerHTML = '<div class="pool-card"><h3>Pool data temporarily unavailable.</h3><p>Open the App to retry the mainnet connection.</p><div class="pool-card__bottom"><a href="./mainnet-app/">Open App →</a></div></div>';
    if (countLabel) countLabel.textContent = 'Live data unavailable';
    document.querySelector('#liveActivity').innerHTML = '<span class="live-feed__index">—</span><b>Live data is temporarily unavailable</b><p>No sample figures are substituted for chain data.</p><a class="section-action" href="./mainnet-app/">Retry in the application <span aria-hidden="true">↗</span></a>';
    document.querySelector('#liveOutcome').innerHTML = '<span class="live-feed__index">—</span><b>Draw history could not load</b><p>Check the application or Pool Manager on BscScan.</p>';
  }
}

document.querySelectorAll('.app-tabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.app-tabs button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  activeFilter = button.dataset.filter;
  render();
}));
refresh();
refreshPurchases();
setInterval(refresh, 30000);
setInterval(refreshPurchases, 3000);
