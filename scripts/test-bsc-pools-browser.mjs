// Small-value BSC Testnet integration checks. All writes require MetaMask confirmation.
const manager = '0x6912609208BE953FD6B9d0176841F3A64746Ce82';
const feeVault = '0xDbFbf21d83415C3907104130aDEc8cC39092Fd3a';
const creator = '0xa3ff9722b93580d95aae0d9fce09bd1957b916a5';
const price = 1000000000000000n; // 0.001 tBNB
const prize = 1800000000000000n;
const fee = 200000000000000n;
const selectors = Object.freeze({
  create: '0xac075b1e', buy: '0xa1bdd4cb', status: '0xa47f65dd',
  claimable: '0xef135ed6', refundable: '0x0eb21530',
  claimPrize: '0xd7098154', claimRefund: '0x5b7baf64',
  userEntries: '0xf2e42fd3', getPool: '0x068bcd8d',
  sweepFee: '0xeaea9cdb', withdrawFee: '0x2e1a7d4d', availableFees: '0x289a74c9',
});
const poolCreated = '0x1280587dfe424b175b3be9a4044e7692904250bf2760c36a79274db0d335686e';
const storageKey = 'singular:bsc-testnet:small-pool-checks';
const $ = id => document.getElementById(id);
const names = ['WAITING', 'LIVE', 'DRAWING', 'COMPLETED', 'EXPIRED'];
let wallet;
let busy = false;

function word(value) {
  const number = BigInt(value);
  if (number < 0n || number >= 2n ** 256n) throw Error('ABI number out of range');
  return number.toString(16).padStart(64, '0');
}
function addressWord(value) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw Error('Invalid address');
  return value.slice(2).toLowerCase().padStart(64, '0');
}
function decodeWords(value) {
  if (!/^0x(?:[0-9a-fA-F]{64})+$/.test(value)) throw Error('Invalid onchain response');
  return value.slice(2).match(/.{64}/g);
}
function poolId(kind) {
  const text = $(`${kind}Id`).value.trim();
  if (!/^[1-9]\d*$/.test(text)) throw Error('请输入有效 Pool ID');
  return BigInt(text);
}
function log(message, error = false) {
  if ($('log').textContent === '尚未开始。') $('log').textContent = '';
  $('log').textContent += `${error ? '错误：' : ''}${message}\n`;
  if (error && /MetaMask|钱包/.test(message) && !wallet) $('wallet').textContent = `连接失败：${message}`;
  $('log').scrollTop = $('log').scrollHeight;
}
function buttons() {
  const connected = Boolean(wallet && !busy);
  $('createDraw').disabled = !connected || wallet.toLowerCase() !== creator;
  $('createRefund').disabled = !connected || wallet.toLowerCase() !== creator;
  for (const kind of ['draw', 'refund']) {
    const hasId = /^[1-9]\d*$/.test($(`${kind}Id`).value.trim());
    $(`refresh${kind[0].toUpperCase()}${kind.slice(1)}`).disabled = !connected || !hasId;
    $(`buy${kind[0].toUpperCase()}${kind.slice(1)}`).disabled = !connected || !hasId || $(`${kind}Status`).dataset.buy !== 'yes';
  }
  $('claimDraw').disabled = !connected || $('drawStatus').dataset.claim !== 'yes';
  $('claimRefund').disabled = !connected || $('refundStatus').dataset.claim !== 'yes';
  $('refreshFee').disabled = !connected || !/^[1-9]\d*$/.test($('drawId').value.trim());
  $('sweepFee').disabled = !connected || $('feeStatus').dataset.sweep !== 'yes';
  $('withdrawFee').disabled = !connected || wallet.toLowerCase() !== creator || $('feeStatus').dataset.withdraw !== 'yes';
}
async function rpc(method, params = []) {
  if (!window.ethereum?.request) throw Error('未检测到 MetaMask，请在安装扩展的浏览器中打开此页面。');
  return window.ethereum.request({ method, params });
}
async function ensureWallet() {
  if ((await rpc('eth_chainId')).toLowerCase() !== '0x61') throw Error('请切换到 BNB Chain Testnet（链 ID 97）。');
  const accounts = await rpc('eth_accounts');
  if (!accounts.length) throw Error('请先连接 MetaMask。');
  wallet = accounts[0];
  if ((await rpc('eth_getCode', [manager, 'latest'])) === '0x') throw Error('当前网络上找不到 Pool Manager。');
}
async function call(data) { return rpc('eth_call', [{ to: manager, data }, 'latest']); }
async function send(data, value, to = manager) {
  await ensureWallet();
  const tx = { from: wallet, to, data };
  if (value !== undefined) tx.value = `0x${value.toString(16)}`;
  const hash = await rpc('eth_sendTransaction', [tx]);
  log(`已提交交易：${hash}`);
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      if (receipt.status !== '0x1') throw Error(`交易失败：${hash}`);
      return receipt;
    }
  }
  throw Error(`等待确认超时。请核对交易，不要盲目重发：${hash}`);
}
async function action(fn) {
  if (busy) return;
  busy = true; buttons();
  try { await fn(); } catch (error) { log(error?.message || String(error), true); }
  finally { busy = false; buttons(); }
}
async function refresh(kind) {
  await ensureWallet();
  const id = poolId(kind);
  const pool = decodeWords(await call(selectors.getPool + word(id)));
  const status = Number(BigInt(`0x${decodeWords(await call(selectors.status + word(id)))[0]}`));
  const sold = Number(BigInt(`0x${pool[4]}`));
  const capacity = Number(BigInt(`0x${pool[3]}`));
  const deadline = Number(BigInt(`0x${pool[7]}`));
  const owned = BigInt(`0x${decodeWords(await call(selectors.userEntries + word(id) + addressWord(wallet)))[0]}`);
  const claimable = BigInt(`0x${decodeWords(await call(selectors.claimable + word(id) + addressWord(wallet)))[0]}`);
  const refundable = BigInt(`0x${decodeWords(await call(selectors.refundable + word(id) + addressWord(wallet)))[0]}`);
  const details = `${names[status] || status} · ${sold}/${capacity} 张 · 当前钱包 ${owned} 张`;
  $(`${kind}Status`).textContent = deadline ? `${details} · 截止 ${new Date(deadline * 1000).toLocaleString()}` : details;
  $(`${kind}Status`).dataset.buy = status <= 1 && sold < capacity ? 'yes' : 'no';
  $(`${kind}Status`).dataset.claim = kind === 'draw' ? (claimable > 0n ? 'yes' : 'no') : (refundable > 0n ? 'yes' : 'no');
  if (claimable > 0n) log(`Pool #${id} 当前钱包可领取 0.0018 tBNB 奖金。`);
  if (refundable > 0n) log(`Pool #${id} 当前钱包可领取 ${Number(refundable) / 1e18} tBNB 退款。`);
  buttons();
}
async function refreshFee() {
  await ensureWallet();
  const pool = decodeWords(await call(selectors.getPool + word(poolId('draw'))));
  const status = Number(BigInt(`0x${pool[9]}`));
  const swept = BigInt(`0x${pool[15]}`) !== 0n;
  const amount = BigInt(`0x${pool[2]}`);
  const vaultBalance = BigInt(`0x${decodeWords(await rpc('eth_call', [{ to: feeVault, data: selectors.availableFees }, 'latest']))[0]}`);
  $('feeStatus').textContent = `Pool #${poolId('draw')} ${names[status] || status} · 协议费 ${Number(amount) / 1e18} tBNB · 已划转 ${swept ? '是' : '否'} · Fee Vault 可领取 ${Number(vaultBalance) / 1e18} tBNB`;
  $('feeStatus').dataset.sweep = status === 3 && !swept && amount > 0n ? 'yes' : 'no';
  $('feeStatus').dataset.withdraw = vaultBalance > 0n ? 'yes' : 'no';
  buttons();
}
async function create(kind, duration) {
  await ensureWallet();
  if (wallet.toLowerCase() !== creator) throw Error('只有固定管理员钱包能创建奖池。');
  const data = selectors.create + [prize, price, 2n, BigInt(duration), fee].map(word).join('');
  const receipt = await send(data);
  const event = receipt.logs.find(item => item.address.toLowerCase() === manager.toLowerCase() && item.topics[0]?.toLowerCase() === poolCreated);
  if (!event?.topics[1]) throw Error('交易成功但未找到 PoolCreated 事件。请检查交易记录。');
  const id = BigInt(event.topics[1]).toString();
  $(`${kind}Id`).value = id;
  save();
  log(`${kind === 'draw' ? '开奖' : '退款'}测试池创建成功：Pool #${id}`);
  await refresh(kind);
}
function save() {
  localStorage.setItem(storageKey, JSON.stringify({ draw: $('drawId').value.trim(), refund: $('refundId').value.trim() }));
}
const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
for (const kind of ['draw', 'refund']) {
  $(`${kind}Id`).value = saved[kind] || '';
  $(`${kind}Id`).addEventListener('input', () => { $(`${kind}Status`).dataset.buy = 'no'; $(`${kind}Status`).dataset.claim = 'no'; save(); buttons(); });
}
$('connect').addEventListener('click', () => action(async () => {
  await rpc('eth_requestAccounts');
  await ensureWallet();
  const balance = BigInt(await rpc('eth_getBalance', [wallet, 'latest']));
  $('wallet').textContent = `${wallet} · ${Number(balance) / 1e18} tBNB`;
  for (const kind of ['draw', 'refund']) if ($(`${kind}Id`).value) await refresh(kind);
  if ($('drawId').value) await refreshFee();
  log('测试网和钱包已核对。');
}));
$('createDraw').addEventListener('click', () => action(() => create('draw', 1800)));
$('createRefund').addEventListener('click', () => action(() => create('refund', 120)));
for (const kind of ['draw', 'refund']) {
  const label = kind[0].toUpperCase() + kind.slice(1);
  $(`refresh${label}`).addEventListener('click', () => action(() => refresh(kind)));
  $(`buy${label}`).addEventListener('click', () => action(async () => {
    await refresh(kind);
    if ($(`${kind}Status`).dataset.buy !== 'yes') throw Error('该奖池不再接受购票。');
    const id = poolId(kind);
    const result = await send(selectors.buy + word(id) + word(1), price);
    log(`Pool #${id} 买入 1 张票确认：${result.transactionHash}`);
    await refresh(kind);
  }));
}
$('claimDraw').addEventListener('click', () => action(async () => {
  await refresh('draw');
  if ($('drawStatus').dataset.claim !== 'yes') throw Error('当前钱包没有可领取奖金。');
  const id = poolId('draw');
  const result = await send(selectors.claimPrize + word(id));
  log(`Pool #${id} 奖金领取交易确认：${result.transactionHash}`);
  await refresh('draw');
}));
$('claimRefund').addEventListener('click', () => action(async () => {
  await refresh('refund');
  if ($('refundStatus').dataset.claim !== 'yes') throw Error('当前钱包没有可领退款，或尚未到期。');
  const id = poolId('refund');
  const result = await send(selectors.claimRefund + word(id));
  log(`Pool #${id} 退款领取交易确认：${result.transactionHash}`);
  await refresh('refund');
}));
$('refreshFee').addEventListener('click', () => action(refreshFee));
$('sweepFee').addEventListener('click', () => action(async () => {
  await refreshFee();
  if ($('feeStatus').dataset.sweep !== 'yes') throw Error('此奖池没有可划转的协议费。');
  const result = await send(selectors.sweepFee + word(poolId('draw')));
  log(`协议费划转交易确认：${result.transactionHash}`);
  await refreshFee();
}));
$('withdrawFee').addEventListener('click', () => action(async () => {
  await refreshFee();
  if (wallet.toLowerCase() !== creator) throw Error('只有固定接收钱包可以领取费用。');
  const available = BigInt(`0x${decodeWords(await rpc('eth_call', [{ to: feeVault, data: selectors.availableFees }, 'latest']))[0]}`);
  if (available === 0n) throw Error('Fee Vault 没有可领取费用。');
  const result = await send(selectors.withdrawFee + word(available), undefined, feeVault);
  log(`固定接收钱包已领取 ${Number(available) / 1e18} tBNB 协议费：${result.transactionHash}`);
  await refreshFee();
}));
window.ethereum?.on?.('accountsChanged', () => location.reload());
window.ethereum?.on?.('chainChanged', () => location.reload());
buttons();
