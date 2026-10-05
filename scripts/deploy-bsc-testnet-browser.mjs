// EIP-1193 deployment. The signing key stays in the user's wallet.
const CONFIG = Object.freeze(window.__SINGULAR_DEPLOY_CONFIG__ || {
  chainId: '0x61',
  account: '0xa3ff9722b93580d95aae0d9fce09bd1957b916a5',
  coordinator: '0xDA3b641D438362C440Ac5458c57e00a712b66700',
  keyHash: '0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26',
  subscriptionId: '83031739480866487515948493284315060731467337081648492470471581697994280748804',
  confirmations: 3,
  callbackGasLimit: 500000,
  nativePayment: true,
});
const SELECTOR = Object.freeze({
  getSubscription: '0xdc311dd3', bindManager: '0x3c72b923',
  manager: '0x481c6a75', poolCreator: '0xc6c1decd',
  randomnessProvider: '0xce9bf5ac', feeVault: '0x478222c2',
  feeRecipient: '0x46904840', subscriptionId: '0x09c1ba2e',
  recurringPool: '0x03ceba58', vrfTimeout: '0xf4d1c5f6',
});
const $ = id => document.getElementById(id);
// Keep the recurring release separate from the previously deployed one-shot manager.
const isMainnet = CONFIG.chainId === '0x38';
const networkName = isMainnet ? 'BNB Chain Mainnet' : 'BNB Chain Testnet';
const currency = isMainnet ? 'BNB' : 'tBNB';
if (isMainnet && !['127.0.0.1', 'localhost'].includes(location.hostname)) {
  throw Error('主网部署控制台只能从本机 localhost 打开。');
}
const accountKey = `singular:bsc-${isMainnet?'mainnet':'testnet'}:draw-only-vrf-6h-v3:${CONFIG.account.toLowerCase()}`;
let wallet;
let providerAddress;
let managerAddress;
let busy = false;
let preflightPassed = false;

function hexWord(value, type) {
  if (type === 'address') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw Error('Invalid address');
    return value.slice(2).toLowerCase().padStart(64, '0');
  }
  if (type === 'bytes32') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw Error('Invalid bytes32');
    return value.slice(2).toLowerCase();
  }
  const number = type === 'bool' ? (value ? 1n : 0n) : BigInt(value);
  const bits = type === 'uint16' ? 16n : type === 'uint32' ? 32n : 256n;
  if (number < 0n || number >= 2n ** bits) throw Error(`Invalid ${type}`);
  return number.toString(16).padStart(64, '0');
}
function encode(types, values) {
  if (types.length !== values.length) throw Error('ABI argument mismatch');
  return types.map((type, i) => hexWord(values[i], type)).join('');
}
function addressFromWord(word) { return `0x${word.slice(-40)}`.toLowerCase(); }
function words(data) {
  if (!/^0x(?:[a-fA-F0-9]{64})+$/.test(data)) throw Error('Invalid contract response');
  return data.slice(2).match(/.{64}/g);
}
function same(a, b) { return a?.toLowerCase() === b?.toLowerCase(); }
function log(message, error = false) {
  const output = $('log');
  if (output.textContent === '尚未开始。') output.textContent = '';
  output.textContent += `${error ? 'ERROR: ' : ''}${message}\n`;
  output.scrollTop = output.scrollHeight;
}
function updateButtons() {
  const ready = Boolean(wallet && preflightPassed && $('ack').checked && !busy);
  $('provider').disabled = !ready || Boolean(providerAddress);
  $('manager').disabled = !ready || !providerAddress || Boolean(managerAddress);
  $('bind').disabled = !ready || !managerAddress || $('bound').textContent.includes('已绑定');
}
async function rpc(method, params = []) {
  if (!window.ethereum?.request) throw Error('未检测到 MetaMask。请在安装 MetaMask 的浏览器中打开本地页面。');
  return window.ethereum.request({ method, params });
}
async function ensureWallet() {
  const chain = await rpc('eth_chainId');
  if (chain.toLowerCase() !== CONFIG.chainId) throw Error(`请在 MetaMask 切换到 ${networkName}（链 ID ${isMainnet?56:97}）。`);
  const accounts = await rpc('eth_accounts');
  if (!accounts.some(address => same(address, CONFIG.account))) throw Error('当前 MetaMask 账户与已确认的部署钱包不一致。');
  wallet = CONFIG.account;
}
async function call(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }
async function readAddress(to, selector) { return addressFromWord(words(await call(to, selector))[0]); }
async function verifyProvider(address) {
  if (await rpc('eth_getCode', [address, 'latest']) === '0x') throw Error('VRF Provider 地址没有合约代码。');
  if (BigInt(await call(address, SELECTOR.subscriptionId)) !== BigInt(CONFIG.subscriptionId)) throw Error('VRF 订阅 ID 不匹配。');
}
async function verifyManager(address, provider) {
  if (await rpc('eth_getCode', [address, 'latest']) === '0x') throw Error('Pool Manager 地址没有合约代码。');
  if (!same(await readAddress(address, SELECTOR.poolCreator), CONFIG.account)) throw Error('奖池创建者不匹配。');
  if (!same(await readAddress(address, SELECTOR.randomnessProvider), provider)) throw Error('随机数合约不匹配。');
  try { words(await call(address, SELECTOR.recurringPool + hexWord(1, 'uint256'))); }
  catch { throw Error('此 Pool Manager 不支持自动续建；请部署新版合约，不要复用旧地址。'); }
  if (BigInt(await call(address, SELECTOR.vrfTimeout)) !== 21600n) throw Error('Pool Manager 的 VRF 退款期限不是 6 小时，停止操作。');
  const feeVault = await readAddress(address, SELECTOR.feeVault);
  if (!same(await readAddress(feeVault, SELECTOR.feeRecipient), CONFIG.account)) throw Error('费用接收者不匹配。');
  return feeVault;
}
async function loadArtifact(name, expectedTypes) {
  const response = await fetch(`./contracts/out/${name}.sol/${name}.json`, { cache: 'no-store' });
  if (!response.ok) throw Error(`找不到 ${name} 编译产物。请从项目根目录运行本地服务器，并先运行 forge build。`);
  const artifact = await response.json();
  const actualTypes = artifact.abi.find(item => item.type === 'constructor')?.inputs.map(item => item.type);
  if (JSON.stringify(actualTypes) !== JSON.stringify(expectedTypes)) throw Error(`${name} 构造函数与部署页面不一致。`);
  if (name === 'SingularNativePoolManager' && !['createRecurringPool', 'recurringPool', 'renewedFrom', 'VRF_TIMEOUT', 'drawTimeoutAt'].every(method => artifact.abi.some(item => item.type === 'function' && item.name === method))) {
    throw Error('编译产物不是支持自动续建的 Pool Manager。');
  }
  const bytecode = artifact.bytecode?.object;
  if (typeof bytecode !== 'string' || !/^(?:0x)?[0-9a-fA-F]+$/.test(bytecode)) throw Error(`${name} 编译字节码无效或包含未链接库。`);
  return `0x${bytecode.replace(/^0x/, '')}`;
}
async function receipt(hash) {
  log(`已提交交易：${hash}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const result = await rpc('eth_getTransactionReceipt', [hash]);
    if (result) {
      if (result.status !== '0x1') throw Error(`交易失败：${hash}`);
      return result;
    }
  }
  throw Error(`等待确认超时。请在区块浏览器核对交易，不要直接重发：${hash}`);
}
async function send(data, to) {
  await ensureWallet();
  const tx = { from: CONFIG.account, data };
  if (to) tx.to = to;
  return receipt(await rpc('eth_sendTransaction', [tx]));
}
async function action(fn) {
  if (busy) return;
  busy = true;
  updateButtons();
  try { await fn(); } catch (error) { log(error?.message || String(error), true); }
  finally { busy = false; updateButtons(); }
}

$('expected').textContent = CONFIG.account;
$('subscription').textContent = CONFIG.subscriptionId;
$('ack').addEventListener('change', updateButtons);
$('connect').addEventListener('click', () => action(async () => {
  preflightPassed = false;
  await rpc('eth_requestAccounts');
  await ensureWallet();
  const code = await rpc('eth_getCode', [CONFIG.coordinator, 'latest']);
  if (code === '0x') throw Error('Chainlink Coordinator 未在当前网络找到。');
  const sub = words(await call(CONFIG.coordinator, SELECTOR.getSubscription + hexWord(CONFIG.subscriptionId, 'uint256')));
  if (!same(addressFromWord(sub[3]), CONFIG.account)) throw Error('VRF 订阅所有者与钱包不一致。');
  if (BigInt(`0x${sub[1]}`) === 0n) throw Error(`VRF 订阅没有 ${currency} 余额。`);
  const balance = BigInt(await rpc('eth_getBalance', [CONFIG.account, 'latest']));
  if (balance < 10000000000000000n) throw Error(`钱包 ${currency} gas 余额低于 0.01。`);
  $('wallet').textContent = `${CONFIG.account} · VRF 余额 ${Number(BigInt(`0x${sub[1]}`)) / 1e18} ${currency}`;
  const saved = JSON.parse(localStorage.getItem(accountKey) || '{}');
  if (saved.provider) {
    await verifyProvider(saved.provider);
    providerAddress = saved.provider;
    $('providerAddress').textContent = providerAddress;
  }
  if (saved.manager && providerAddress) {
    await verifyManager(saved.manager, providerAddress);
    managerAddress = saved.manager;
    $('managerAddress').textContent = managerAddress;
    if (same(await readAddress(providerAddress, SELECTOR.manager), managerAddress)) $('bound').textContent = '已绑定';
  }
  preflightPassed = true;
  log('网络、钱包、订阅和余额核对通过。');
}));
$('provider').addEventListener('click', () => action(async () => {
  await ensureWallet();
  const types = ['address', 'address', 'bytes32', 'uint256', 'uint16', 'uint32', 'bool'];
  const bytecode = await loadArtifact('ChainlinkVRFProvider', types);
  const args = [CONFIG.account, CONFIG.coordinator, CONFIG.keyHash, CONFIG.subscriptionId, CONFIG.confirmations, CONFIG.callbackGasLimit, CONFIG.nativePayment];
  const result = await send(bytecode + encode(types, args));
  if (!result.contractAddress) throw Error('确认交易没有合约地址。');
  await verifyProvider(result.contractAddress);
  providerAddress = result.contractAddress;
  $('providerAddress').textContent = providerAddress;
  localStorage.setItem(accountKey, JSON.stringify({ provider: providerAddress }));
  log(`VRF Provider 已部署：${providerAddress}`);
}));
$('manager').addEventListener('click', () => action(async () => {
  await ensureWallet();
  await verifyProvider(providerAddress);
  const types = ['address', 'address', 'address'];
  const bytecode = await loadArtifact('SingularNativePoolManager', types);
  const result = await send(bytecode + encode(types, [CONFIG.account, providerAddress, CONFIG.account]));
  if (!result.contractAddress) throw Error('确认交易没有合约地址。');
  const feeVault = await verifyManager(result.contractAddress, providerAddress);
  managerAddress = result.contractAddress;
  $('managerAddress').textContent = managerAddress;
  localStorage.setItem(accountKey, JSON.stringify({ provider: providerAddress, manager: managerAddress }));
  log(`Pool Manager 已部署：${managerAddress}; Fee Vault：${feeVault}`);
}));
$('bind').addEventListener('click', () => action(async () => {
  await ensureWallet();
  await verifyManager(managerAddress, providerAddress);
  const current = await readAddress(providerAddress, SELECTOR.manager);
  if (same(current, managerAddress)) { $('bound').textContent = '已绑定'; return; }
  if (!same(current, '0x0000000000000000000000000000000000000000')) throw Error('Provider 已绑定到其他 Manager，停止操作。');
  await send(SELECTOR.bindManager + hexWord(managerAddress, 'address'), providerAddress);
  if (!same(await readAddress(providerAddress, SELECTOR.manager), managerAddress)) throw Error('绑定交易已确认，但链上 readback 不匹配。');
  $('bound').textContent = '已绑定';
  log(`绑定完成。下一步在 Chainlink VRF 订阅中添加 consumer：${providerAddress}`);
}));
window.ethereum?.on?.('accountsChanged', () => location.reload());
window.ethereum?.on?.('chainChanged', () => location.reload());
