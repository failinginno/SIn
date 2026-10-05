// One-transaction, BSC-Testnet-only factory deployment through MetaMask.
const config = Object.freeze({
  chainId: '0x61',
  owner: '0xa3ff9722b93580d95aae0d9fce09bd1957b916a5',
  manager: '0x6912609208BE953FD6B9d0176841F3A64746Ce82',
  portal: '0x027e3704fC5C16522e9393d04C60A3ac5c0d775f',
});
const key = `singular:bsc-testnet:flap-factory:${config.owner}`;
const $ = id => document.getElementById(id);
let connected = false;
let busy = false;
let deployed = false;
function word(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw Error('Invalid address');
  return address.slice(2).toLowerCase().padStart(64, '0');
}
function outputAddress(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw Error('Invalid contract readback');
  return `0x${value.slice(-40)}`.toLowerCase();
}
function same(a, b) { return a?.toLowerCase() === b?.toLowerCase(); }
function log(message, error = false) {
  if ($('log').textContent === '尚未开始。') $('log').textContent = '';
  $('log').textContent += `${error ? '错误：' : ''}${message}\n`;
}
function buttons() { $('deploy').disabled = !connected || !($('ack').checked) || busy || deployed; }
async function rpc(method, params = []) {
  if (!window.ethereum?.request) throw Error('未检测到 MetaMask。请使用已安装扩展的浏览器。');
  return window.ethereum.request({ method, params });
}
async function preflight() {
  if ((await rpc('eth_chainId')).toLowerCase() !== config.chainId) throw Error('请切换到 BNB Chain Testnet（链 ID 97）。');
  const accounts = await rpc('eth_accounts');
  if (!same(accounts[0], config.owner)) throw Error('当前 MetaMask 钱包不是已确认的项目钱包。');
  for (const address of [config.manager, config.portal]) {
    if ((await rpc('eth_getCode', [address, 'latest'])) === '0x') throw Error(`合约地址未在此网络找到：${address}`);
  }
  const creator = outputAddress(await rpc('eth_call', [{ to: config.manager, data: '0xc6c1decd' }, 'latest']));
  if (!same(creator, config.owner)) throw Error('Pool Manager 的固定创建者与当前钱包不符。');
  const balance = BigInt(await rpc('eth_getBalance', [config.owner, 'latest']));
  if (balance < 10000000000000000n) throw Error('钱包 gas 余额低于 0.01 tBNB。');
}
async function verify(address) {
  if ((await rpc('eth_getCode', [address, 'latest'])) === '0x') throw Error('部署地址没有合约代码。');
  const reads = [
    ['0xdc4c90d3', config.manager, 'Pool Manager'],
    ['0xc6c1decd', config.owner, 'poolCreator'],
    ['0x737ea06e', config.owner, 'taxRecipient'],
    ['0xeac7cfd7', '0x0000000000000000000000000000000000000000', 'officialVault'],
  ];
  for (const [selector, expected, name] of reads) {
    const actual = outputAddress(await rpc('eth_call', [{ to: address, data: selector }, 'latest']));
    if (!same(actual, expected)) throw Error(`${name} 链上值不符合预期。`);
  }
  const native = await rpc('eth_call', [{ to: address, data: `0xb62a4f9a${word('0x0000000000000000000000000000000000000000')}` }, 'latest']);
  if (BigInt(native) !== 1n) throw Error('工厂未声明支持原生 BNB 计价。');
}
async function action(fn) {
  if (busy) return;
  busy = true; buttons();
  try { await fn(); } catch (error) { log(error?.message || String(error), true); }
  finally { busy = false; buttons(); }
}
const saved = localStorage.getItem(key);
if (saved && /^0x[0-9a-fA-F]{40}$/.test(saved)) {
  $('factory').textContent = saved;
  deployed = true;
}
$('owner').textContent = config.owner;
$('manager').textContent = config.manager;
$('portal').textContent = config.portal;
$('ack').addEventListener('change', buttons);
$('connect').addEventListener('click', () => action(async () => {
  await rpc('eth_requestAccounts');
  await preflight();
  if (saved) await verify(saved);
  connected = true;
  $('status').textContent = 'BNB Chain Testnet、钱包、Manager、VaultPortal 均已核对';
  log('预检通过。');
}));
$('deploy').addEventListener('click', () => action(async () => {
  await preflight();
  const response = await fetch('./contracts/out/SingularFlapVaultFactory.sol/SingularFlapVaultFactory.json', { cache: 'no-store' });
  if (!response.ok) throw Error('找不到工厂编译产物；请先运行 forge build。');
  const artifact = await response.json();
  const types = artifact.abi.find(item => item.type === 'constructor')?.inputs.map(item => item.type);
  if (JSON.stringify(types) !== JSON.stringify(['address', 'address', 'address'])) throw Error('工厂构造函数与部署页面不匹配。');
  const bytecode = artifact.bytecode?.object;
  if (typeof bytecode !== 'string' || !/^(?:0x)?[0-9a-fA-F]+$/.test(bytecode)) throw Error('工厂编译字节码无效。');
  const data = `0x${bytecode.replace(/^0x/, '')}${word(config.manager)}${word(config.owner)}${word(config.owner)}`;
  const hash = await rpc('eth_sendTransaction', [{ from: config.owner, data }]);
  log(`工厂部署交易已提交：${hash}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (!receipt) continue;
    if (receipt.status !== '0x1' || !receipt.contractAddress) throw Error(`工厂部署交易失败：${hash}`);
    await verify(receipt.contractAddress);
    localStorage.setItem(key, receipt.contractAddress);
    $('factory').textContent = receipt.contractAddress;
    deployed = true;
    log(`工厂已部署并核对：${receipt.contractAddress}`);
    return;
  }
  throw Error(`等待确认超时，请先查询交易，不要盲目重试：${hash}`);
}));
window.ethereum?.on?.('accountsChanged', () => location.reload());
window.ethereum?.on?.('chainChanged', () => location.reload());
buttons();
