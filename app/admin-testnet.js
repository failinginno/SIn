(() => {
  const config = window.SINGULAR_TESTNET_CONFIG;
  const feeStyles=document.createElement('link');feeStyles.rel='stylesheet';feeStyles.href='app/admin-fees.css';document.head.append(feeStyles);
  const manager = config.poolManagerAddress, vault = config.feeVaultAddress;
  const isMainnet = config.chainId === 56, chainName = isMainnet ? 'BSC Mainnet' : 'BSC Testnet', unit = isMainnet ? 'BNB' : 'tBNB';
  const creator = '0xa3ff9722b93580d95aae0d9fce09bd1957b916a5';
  const sel = { create:'0xac075b1e', createRecurring:'0x65777293', recurring:'0x03ceba58', pool:'0x068bcd8d', count:'0xf525cb68', timeout:'0xf4d1c5f6', provider:'0xce9bf5ac', feeVault:'0x478222c2', sweep:'0xeaea9cdb', withdraw:'0x2e1a7d4d', available:'0x289a74c9', received:'0x9fbaf3de', withdrawn:'0xfffeaf60' };
  const $ = id => document.getElementById(id);
  const word = n => BigInt(n).toString(16).padStart(64,'0');
  const terms = hex => (hex.slice(2).match(/.{64}/g)||[]).map(x => BigInt('0x'+x));
  const fmt = n => `${Number(n)/1e18} ${unit}`;
  let account = null, busy = false, feePools = [], available = 0n, supportsRecurring = false;
  const log = text => { $('log').textContent = `${new Date().toLocaleTimeString()}  ${text}\n${$('log').textContent==='尚未操作。'?'':$('log').textContent}`; };
  async function rpc(method, params=[]) { if(!window.ethereum?.request)throw Error('请在安装 MetaMask 的浏览器中打开。'); return window.ethereum.request({method,params}); }
  async function verified(){
    if((await rpc('eth_chainId')).toLowerCase()!==(isMainnet?'0x38':'0x61'))throw Error(`请切换到 ${chainName}（链 ID ${config.chainId}）。`);
    const accounts=await rpc('eth_accounts');
    if(!accounts[0]||accounts[0].toLowerCase()!==creator)throw Error('只有固定管理员钱包可以执行操作。');
    if(account&&accounts[0].toLowerCase()!==account.toLowerCase())throw Error('钱包已切换，请重新连接。');
    if(await rpc('eth_getCode',[manager,'latest'])==='0x')throw Error('当前网络找不到奖池合约。');
    if(isMainnet){
      const [timeout,provider,vaultAddress]=await Promise.all([read(manager,sel.timeout),read(manager,sel.provider),read(manager,sel.feeVault)]);
      const addressFrom=wordValue=>'0x'+wordValue.toString(16).padStart(40,'0').slice(-40);
      if(timeout[0]!==21600n||addressFrom(provider[0]).toLowerCase()!==config.randomnessProviderAddress.toLowerCase()||addressFrom(vaultAddress[0]).toLowerCase()!==vault.toLowerCase())throw Error('新版合约地址或 6 小时规则与链上不一致，已停止操作。');
    }
    return accounts[0];
  }
  async function read(to,data){return terms(await rpc('eth_call',[{to,data},'latest']));}
  async function send(to,data){
    await verified();
    const tx={from:account,to,data};
    await rpc('eth_estimateGas',[tx]);
    const hash=await rpc('eth_sendTransaction',[tx]);
    log(`交易已提交：${hash}`);
    for(let i=0;i<90;i++){
      const receipt=await rpc('eth_getTransactionReceipt',[hash]);
      if(receipt){if(receipt.status!=='0x1')throw Error(`交易失败：${hash}`);log(`交易已确认：${hash}`);return receipt;}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw Error(`交易仍未确认。请先检查浏览器交易记录，勿重复提交：${hash}`);
  }
  const wei = id => {const value=$(id).value.trim();if(!/^\d+(?:\.\d{1,18})?$/.test(value))throw Error(`${id} 请输入不超过 18 位小数的正数。`);const [a,b='']=value.split('.');return BigInt(a)*10n**18n+BigInt(b.padEnd(18,'0'));};
  const uint = id => {const value=$(id).value.trim();if(!/^[1-9]\d*$/.test(value))throw Error(`${id} 请输入正整数。`);return BigInt(value);};
  const exactBNB = amount => {const whole=amount/10n**18n,fraction=(amount%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:String(whole);};
  const economics=document.createElement('p');economics.id='economics';economics.setAttribute('aria-live','polite');$('create').before(economics);
  function syncEconomics(changed='fee'){
    try{
      const price=wei('price'),capacity=uint('capacity'),gross=price*capacity;
      if(price===0n||capacity>500n)throw Error('票价须大于 0，容量须在 1–500 张之间。');
      if(changed==='prize'){
        const prize=wei('prize');if(prize===0n||prize>gross)throw Error('奖金须大于 0，且不能超过票款总额。');
        $('fee').value=exactBNB(gross-prize);
      }else{
        const fee=wei('fee');if(fee>=gross)throw Error('协议费须小于票款总额，奖金须大于 0。');
        $('prize').value=exactBNB(gross-fee);
      }
      economics.textContent=`票款总额 ${exactBNB(gross)} ${unit} = 奖金 ${$('prize').value} ${unit} + 协议费 ${$('fee').value} ${unit}`;
      economics.dataset.valid='yes';
    }catch(error){economics.textContent=error.message;economics.dataset.valid='no'}
    $('create').disabled=busy||!account||economics.dataset.valid!=='yes';
  }
  for(const id of ['price','capacity','fee','prize'])$(id).addEventListener('input',()=>syncEconomics(id));
  const tierPresets=[
    {price:'0.01',capacity:'6',prize:'0.05',fee:'0.01',duration:'10'},
    {price:'0.01',capacity:'11',prize:'0.1',fee:'0.01',duration:'10'},
    {price:'0.01',capacity:'55',prize:'0.5',fee:'0.05',duration:'20'},
    {price:'0.01',capacity:'110',prize:'1',fee:'0.1',duration:'30'}
  ];
  document.querySelectorAll('[data-tier]').forEach(button=>button.addEventListener('click',()=>{
    const preset=tierPresets[Number(button.dataset.tier)];if(!preset)return;
    for(const [id,value] of Object.entries(preset))$(id).value=value;
    document.querySelectorAll('[data-tier]').forEach(item=>item.classList.toggle('selected',item===button));
    syncEconomics();
  }));
  syncEconomics();
  $('poolId').closest('section').innerHTML=`<h2>03 / 全部奖池协议费</h2><p>自动读取当前合约的全部奖池。票款总额包含用户奖金与潜在退款，不等于可提取协议费。</p><button id="readFee">刷新全部奖池收入</button><div id="feeState" aria-live="polite">连接钱包后自动读取。</div><div id="feeRows"></div><button id="sweep" disabled>划转所有待划转协议费</button><button id="withdraw" disabled>领取 Fee Vault 全部可用协议费</button><p>批量划转仍是每个奖池一笔链上交易，需要逐笔在钱包确认；只有已开奖奖池的固定协议费可以划转。</p>`;
  const statusNames=['等待购票','购票中','等待开奖','已开奖','已到期退款'];
  async function updateFee(){
    await verified();
    $('feeState').textContent='正在读取全部奖池…';
    $('sweep').disabled=true;$('withdraw').disabled=true;
    const count=Number((await read(manager,sel.count))[0]);
    if(!Number.isSafeInteger(count)||count>2000)throw Error('奖池数量超出页面安全上限，请先核对合约。');
    const pools=[];
    for(let start=1;start<=count;start+=4){
      const ids=Array.from({length:Math.min(4,count-start+1)},(_,i)=>start+i);
      const batch=await Promise.all(ids.map(async id=>{
        const p=await read(manager,sel.pool+word(id));
        return {id,status:Number(p[9]),fee:p[2],swept:p[15]!==0n,gross:p[1]*p[4]};
      }));
      pools.push(...batch);
      $('feeState').textContent=`已读取 ${pools.length} / ${count} 个奖池…`;
    }
    const [vaultAvailable,received,withdrawn]=await Promise.all([read(vault,sel.available),read(vault,sel.received),read(vault,sel.withdrawn)]);
    feePools=pools;available=vaultAvailable[0];
    const gross=pools.reduce((sum,p)=>sum+p.gross,0n);
    const realized=pools.reduce((sum,p)=>sum+(p.status===3?p.fee:0n),0n);
    const pending=pools.filter(p=>p.status===3&&!p.swept&&p.fee>0n);
    const pendingAmount=pending.reduce((sum,p)=>sum+p.fee,0n);
    $('feeState').innerHTML=`<div class="fee-metrics"><div><small>奖池总数</small><strong>${count}</strong></div><div><small>全部已售票款</small><strong>${exactBNB(gross)} ${unit}</strong></div><div><small>已开奖协议费合计</small><strong>${exactBNB(realized)} ${unit}</strong></div><div><small>待划转到 Fee Vault</small><strong>${exactBNB(pendingAmount)} ${unit}</strong></div><div><small>当前可领取</small><strong>${exactBNB(available)} ${unit}</strong></div><div><small>历史已领取</small><strong>${exactBNB(withdrawn[0])} ${unit}</strong></div></div><p>Fee Vault 历史到账 ${exactBNB(received[0])} ${unit}。待划转 ${pending.length} 个奖池，领取操作只针对“当前可领取”余额。</p>`;
    $('feeRows').innerHTML=pools.length?`<details><summary>查看全部 ${count} 个奖池明细</summary><div class="fee-list">${pools.slice().reverse().map(p=>`<div><span>Pool #${p.id} · ${statusNames[p.status]||'未知状态'}</span><span>${p.status===3?`${exactBNB(p.fee)} ${unit} · ${p.swept?'已划转':'待划转'}`:'尚未产生可提协议费'}</span></div>`).join('')}</div></details>`:'<p>尚无奖池。</p>';
    $('sweep').disabled=busy||pending.length===0;
    $('sweep').textContent=`划转所有待划转协议费（${pending.length} 笔）`;
    $('withdraw').disabled=busy||available===0n;
  }
  async function action(fn){if(busy)return;busy=true;const buttonStates=Array.from(document.querySelectorAll('button'),b=>[b,b.disabled]);buttonStates.forEach(([b])=>b.disabled=true);try{await fn();}catch(e){log(`错误：${e.message||e}`);}finally{busy=false;buttonStates.forEach(([b,disabled])=>b.disabled=disabled);$('connect').disabled=false;syncEconomics();$('readFee').disabled=!account;if(account){try{await updateFee()}catch(e){$('feeState').textContent=`读取失败：${e.message}`;$('sweep').disabled=true;$('withdraw').disabled=true;log(`费用状态读取失败：${e.message}`)}}}}
  $('connect').onclick=()=>action(async()=>{
    await rpc('eth_requestAccounts');account=await verified();
    $('identity').textContent=`已核验：${account} · ${chainName}`;
    try{await read(manager,sel.recurring+word(1));supportsRecurring=true}
    catch{supportsRecurring=false;$('controls').hidden=true;throw Error('当前 Pool Manager 无法确认支持自动续池。已禁用创建操作，请先核对新版合约地址和网络。')}
    $('controls').hidden=false;
    if(supportsRecurring&&!$('recurring')){
      const label=document.createElement('label');label.className='recurring-option';
      label.innerHTML='<input id="recurring" type="checkbox" checked> 开奖成功后在链上自动续建同款奖池';
      $('create').before(label);
      document.querySelector('.warn').textContent='此合约支持链上自动续池：仅在 Chainlink VRF 开奖成功后创建下一个同参数奖池，不依赖本机服务。';
    }
    log(`管理员钱包与${chainName}核验通过。`);
  });
  $('create').onclick=()=>action(async()=>{
    await verified();const price=wei('price'),capacity=uint('capacity'),prize=wei('prize'),fee=wei('fee'),minutes=uint('duration');
    if(price===0n||prize===0n||capacity>500n||minutes>43200n||price*capacity!==prize+fee)throw Error('参数无效：票价 × 容量须等于奖金 + 协议费，容量最多 500，时长最多 30 天。');
    const recurring=supportsRecurring&&$('recurring')?.checked;
    if(!confirm(`确认在${chainName}创建${recurring?'自动续建':''}奖池？这会消耗真实 BNB gas。\n票价 ${fmt(price)} × ${capacity}\n奖金 ${fmt(prize)}，协议费 ${fmt(fee)}\n首张票后 ${minutes} 分钟截止。`))return;
    await send(manager,(recurring?sel.createRecurring:sel.create)+[prize,price,capacity,minutes*60n,fee].map(word).join(''));
    log(`奖池创建确认。当前 Pool Count：${(await read(manager,sel.count))[0]}`);
  });
  $('readFee').onclick=()=>action(async()=>{});
  $('sweep').onclick=()=>action(async()=>{await updateFee();const pending=feePools.filter(p=>p.status===3&&!p.swept&&p.fee>0n);if(!pending.length)throw Error('没有待划转协议费。');const amount=pending.reduce((sum,p)=>sum+p.fee,0n);if(!confirm(`将 ${pending.length} 个奖池的 ${exactBNB(amount)} ${unit} 协议费划转到 Fee Vault？\n每个奖池需要独立钱包确认，过程中可以在钱包拒绝后停止。`))return;for(const pool of pending){await send(manager,sel.sweep+word(pool.id));log(`Pool #${pool.id} 协议费已划转。`)} });
  $('withdraw').onclick=()=>action(async()=>{await updateFee();const current=(await read(vault,sel.available))[0];if(current===0n)throw Error('当前无可领取协议费。');if(!confirm(`将 ${exactBNB(current)} ${unit} 已结算协议费领取到固定接收钱包？`))return;await send(vault,sel.withdraw+word(current));});
  window.ethereum?.on?.('accountsChanged',()=>location.reload());window.ethereum?.on?.('chainChanged',()=>location.reload());
})();
