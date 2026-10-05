(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./demo-core.js') : root.SingularDemo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SingularOnchain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  const CHAIN_ID = 97;
  const CHAIN_HEX = '0x61';
  const SELECTOR = Object.freeze({
    poolCount: '0xf525cb68', getPool: '0x068bcd8d', getUserEntries: '0xf2e42fd3',
    getUserTicketIds: '0x5dd703e9', getTicketOwner: '0x9aaa8d31', getContribution: '0xe081dbf9',
    getRefundableAmount: '0x0eb21530', getClaimablePrize: '0xef135ed6',
    refundClaimed: '0x7d8022c0', buyEntries: '0xa1bdd4cb',
    claimPrize: '0xd7098154', claimRefund: '0x5b7baf64'
  });
  const TOPIC = Object.freeze({
    PoolCreated: '0x1280587dfe424b175b3be9a4044e7692904250bf2760c36a79274db0d335686e',
    PoolStarted: '0xc89963e5ab8bb9ff8143824ceb926d209aec4f5b10c2940a064eb7c47e4704d9',
    EntriesPurchased: '0x9fcdbd517515925d5e946a3bd7b3985b7f45d6c42848d738e8dad721773ae772',
    PoolFilled: '0xe1f1648d975d08b1a9b8393f53603c21a007c9770589917408e6c9099f8b1ea5',
    RandomnessRequested: '0x9cbe10499828304338b5191b737406d750036395ab0a1015c8c14b2f6e1046d5',
    OutcomeResolved: '0x22831321c1f0569d5455c795f2aa0d34a921a8a0fc5c07be4942173c12285584',
    PrizeClaimed: '0x4aa95f981a8337cb337de335b965507da0879c3b49f799d20058e913f5ad2c26',
    ProtocolFeeAccrued: '0xa7d3ed4c08f0a22ed87b5588418154edb430223dc6ecf5acdf1654acac9fbba3',
    RefundClaimed: '0xf3f402280ef0a7905e124aa621b65eaeb2725c343e8b36d398ed78c29daf285c'
  });
  const ZERO = '0x0000000000000000000000000000000000000000';
  const pad = value => BigInt(value).toString(16).padStart(64, '0');
  const addressWord = value => value.slice(2).toLowerCase().padStart(64, '0');
  const words = hex => (hex.slice(2).match(/.{64}/g) || []).map(x => BigInt('0x' + x));
  const toAddress = n => '0x' + n.toString(16).padStart(40, '0').slice(-40);
  const formatBNB = wei => {
    const n = BigInt(wei), whole = n / 10n ** 18n, fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
  };
  const hex = n => '0x' + BigInt(n).toString(16);
  const encode = (selector, ...args) => selector + args.map((arg, i) => i > 0 && typeof arg === 'string' && arg.startsWith('0x') && arg.length === 42 ? addressWord(arg) : pad(arg)).join('');
  const parsePool = (id, result) => {
    const w = words(result);
    if (w.length < 16) throw new Error('Pool read returned incomplete data.');
    const status = D.mapContractStatus(Number(w[9]), Number(w[4]), Number(w[3]));
    return {
      id, prize: Number(formatBNB(w[0])), entryPrice: Number(formatBNB(w[1])), fee: Number(formatBNB(w[2])),
      prizeWei: w[0], entryPriceWei: w[1], feeWei: w[2], capacity: Number(w[3]), entriesSold: Number(w[4]),
      duration: Number(w[5]), startTime: Number(w[6]) * 1000 || null, deadline: Number(w[7]) * 1000 || null,
      createdAt: Number(w[8]) * 1000, contractStatus: Number(w[9]), status, winner: toAddress(w[10]),
      winningTicket: Number(w[11]) + 1, randomnessRequestId: w[12].toString(), requestProvider: toAddress(w[13]),
      prizeClaimed: w[14] !== 0n, feeSwept: w[15] !== 0n, participants: [], activity: []
    };
  };
  function parseTicketIds(result) {
    const w = words(result);
    if (w.length < 2) return [];
    const offset = Number(w[0] / 32n), length = Number(w[offset]);
    if (length > 500 || offset + length >= w.length) throw new Error('Invalid ticket ledger response.');
    return w.slice(offset + 1, offset + 1 + length).map(n => Number(n) + 1);
  }
  function parseEntryLog(log) {
    const w = words(log.data);
    if (!log.topics || log.topics[0]?.toLowerCase() !== TOPIC.EntriesPurchased || w.length < 4) return null;
    return { type: 'ENTRY', poolId: Number(BigInt(log.topics[1])), wallet: toAddress(BigInt(log.topics[2])),
      quantity: Number(w[0]), start: Number(w[1]) + 1, end: Number(w[2]) + 1, amountWei: w[3],
      amount: Number(formatBNB(w[3])), text: `${Number(w[0])} ${Number(w[0])===1?'entry':'entries'} confirmed`,
      time: Date.now(), transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)),
      blockNumber: Number(BigInt(log.blockNumber)) };
  }
  function parseChainLog(log) {
    const entry = parseEntryLog(log);
    if (entry) return entry;
    const topic = log.topics?.[0]?.toLowerCase();
    const type = Object.keys(TOPIC).find(name => TOPIC[name] === topic);
    if (!type || !log.topics[1]) return null;
    const w = words(log.data);
    const event = { type, poolId: Number(BigInt(log.topics[1])), transactionHash: log.transactionHash,
      logIndex: Number(BigInt(log.logIndex)), blockNumber: Number(BigInt(log.blockNumber)), time: Date.now() };
    if (type === 'OutcomeResolved' && w.length >= 2) {
      event.winner = toAddress(BigInt(log.topics[2])); event.winningTicket = Number(w[0]) + 1;
      event.randomWord = w[1].toString();
    }
    if (type === 'RandomnessRequested') event.requestId = BigInt(log.topics[3]).toString();
    if (type === 'PrizeClaimed' || type === 'RefundClaimed') event.wallet = toAddress(BigInt(log.topics[2]));
    if ((type === 'PrizeClaimed' || type === 'RefundClaimed' || type === 'ProtocolFeeAccrued') && w.length) event.amountWei = w[0];
    event.text = type.replace(/([a-z])([A-Z])/g, '$1 $2');
    return event;
  }
  function translateError(error, currency = 'tBNB', network = 'testnet') {
    const message = String(error?.message || error || 'Transaction failed');
    if (/4001|user rejected|user denied/i.test(message)) return 'Wallet request rejected.';
    if (/InsufficientRemainingEntries|PoolNotAcceptingEntries|PoolExpired|0x/i.test(message) && /revert|execution|filled/i.test(message)) return 'Pool changed before your transaction confirmed. Refresh the pool and try again.';
    if (/insufficient funds/i.test(message)) return `Not enough ${currency} for the entry and network gas.`;
    return message.length > 180 ? `The ${network} transaction failed. Check your wallet or explorer, then refresh.` : message;
  }
  class OnchainSingularProvider extends D.SingularProvider {
    constructor(config, wallet = globalThis.ethereum, fetchFn = (...args) => globalThis.fetch(...args)) {
      super();
      if (![56, 97].includes(Number(config?.chainId)) || !/^0x[a-fA-F0-9]{40}$/.test(config?.poolManagerAddress || '')) throw new Error('BNB Chain contract configuration is incomplete.');
      this.config = config; this.walletApi = wallet; this.fetchFn = fetchFn; this.pools = []; this.events = [];
      this.chainId = Number(config.chainId); this.chainHex = hex(this.chainId);
      this.isMainnet = this.chainId === 56; this.currency = this.isMainnet ? 'BNB' : 'tBNB';
      this.networkName = this.isMainnet ? 'BSC Mainnet' : 'BSC Testnet';
      this.address = null; this.balanceWei = 0n; this.network = null; this.listeners = new Set();
      this.lastScanned = Number(config.deploymentBlock || 0) - 1; this.logKeys = new Set(); this.blockTimes = new Map();
      this.transactions = []; this.pending = false; this.refreshQueued = false; this.logScanError = null; this.userDisconnected = false;
      this.hasLoadedPools = false; this.logRefreshPending = false; this.ownerRefreshPending = new Set(); this.ticketOwners = new Map();
      this.walletVersion = 0; this.bindWalletEvents();
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { for (const fn of this.listeners) fn(); }
    clearWalletData() {
      this.balanceWei = 0n; this.walletVersion++; this.lastSnapshotKey = null;
      this.pools = this.pools.map(pool => ({ ...pool, myTicketIds: [], myEntries: 0, myContributionWei: 0n, refundableWei: 0n, claimableWei: 0n, refundClaimed: false }));
      this.emit();
    }
    bindWalletEvents() {
      const wallet = this.walletApi;
      if (!wallet?.on) return;
      this.onAccountsChanged = accounts => {
        if (this.userDisconnected) return;
        const next = accounts?.[0] || null;
        if (next?.toLowerCase() === this.address?.toLowerCase()) return;
        this.address = next; this.clearWalletData();
        if (next) this.refresh().catch(error => console.warn('Wallet account refresh failed:', error));
      };
      this.onChainChanged = chain => {
        this.network = Number(BigInt(chain)); this.clearWalletData();
        if (this.address && this.network === this.chainId) this.refresh().catch(error => console.warn('Wallet network refresh failed:', error));
      };
      this.onWalletDisconnect = () => { this.address = null; this.clearWalletData(); };
      wallet.on('accountsChanged', this.onAccountsChanged);
      wallet.on('chainChanged', this.onChainChanged);
      wallet.on('disconnect', this.onWalletDisconnect);
    }
    setWalletApi(wallet) {
      if (wallet === this.walletApi) return;
      this.walletApi?.removeListener?.('accountsChanged', this.onAccountsChanged);
      this.walletApi?.removeListener?.('chainChanged', this.onChainChanged);
      this.walletApi?.removeListener?.('disconnect', this.onWalletDisconnect);
      this.walletApi = wallet; this.address = null; this.network = null; this.clearWalletData(); this.bindWalletEvents();
    }
    async rpc(method, params = [], endpoint = this.config.rpcUrl) {
      const response = await this.fetchFn(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || 'BNB Chain RPC error');
      return body.result;
    }
    async read(selector, ...args) {
      return this.rpc('eth_call', [{ to: this.config.poolManagerAddress, data: encode(selector, ...args) }, 'latest']);
    }
    async connectWallet(wallet = this.walletApi) {
      if (wallet !== this.walletApi) this.setWalletApi(wallet);
      if (!this.walletApi?.request) throw new Error(`Install a browser wallet to use ${this.networkName}.`);
      const accounts = await this.walletApi.request({ method: 'eth_requestAccounts' });
      this.userDisconnected = false; this.address = accounts[0] || null; this.clearWalletData();
      this.network = Number(BigInt(await this.walletApi.request({ method: 'eth_chainId' })));
      if (this.network !== this.chainId) await this.switchNetwork();
      this.refresh().catch(error => console.warn('Wallet activity refresh failed:', error));
      return this.getWallet();
    }
    async restoreWallet() {
      if (!this.walletApi?.request) return false;
      const accounts = await this.walletApi.request({ method: 'eth_accounts' });
      if (!accounts?.[0]) return false;
      this.address = accounts[0];
      this.network = Number(BigInt(await this.walletApi.request({ method: 'eth_chainId' })));
      if (this.network !== this.chainId) return false;
      return true;
    }
    async switchNetwork() {
      try { await this.walletApi.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: this.chainHex }] }); }
      catch (error) {
        if (error.code !== 4902) throw error;
        await this.walletApi.request({ method: 'wallet_addEthereumChain', params: [{ chainId: this.chainHex, chainName: this.isMainnet ? 'BNB Smart Chain Mainnet' : 'BNB Smart Chain Testnet', nativeCurrency: { name: this.isMainnet ? 'BNB' : 'Testnet BNB', symbol: this.currency, decimals: 18 }, rpcUrls: [this.config.rpcUrl], blockExplorerUrls: [this.config.explorerUrl] }] });
      }
      this.network = this.chainId;
    }
    disconnectWallet() { this.userDisconnected = true; this.address = null; this.network = null; this.clearWalletData(); }
    getWallet() { return { connected: !!this.address, address: this.address || ZERO, balance: Number(formatBNB(this.balanceWei)), network: this.network === this.chainId ? this.networkName : 'Wrong Network', wrongNetwork: !!this.address && this.network != null && this.network !== this.chainId }; }
    getPools() { return this.pools.slice(); }
    getPool(id) { return this.pools.find(p => p.id === Number(id)); }
    getEntries() { return this.address ? this.pools.filter(p => p.myEntries).map(p => ({ poolId: p.id, prize: p.prize, quantity: p.myEntries, amount: Number(formatBNB(p.myContributionWei || 0n)), range: (p.myTicketIds || []).join(', '), status: p.status, deadline: p.deadline })) : []; }
    getOutcomes() { return this.pools.filter(p => p.contractStatus === 3); }
    getRefunds() { return this.address ? this.pools.filter(p => (p.myContributionWei || 0n) > 0n && p.contractStatus === 4).map(p => ({ poolId: p.id, amount: Number(formatBNB(p.refundableWei || 0n)), claimed: p.refundClaimed })) : []; }
    publishPools(pools, walletVersion) {
      if (walletVersion !== this.walletVersion) return;
      const ordered = pools.slice().sort((a, b) => a.id - b.id);
      const previous = new Map(this.pools.map(pool => [pool.id, pool]));
      for (const pool of ordered) {
        const old = previous.get(pool.id);
        if (old && !pool.activity?.length && old.activity?.length) pool.activity = old.activity;
        if (old && !pool.participants?.length && old.participants?.length) pool.participants = old.participants;
      }
      const key = `${this.balanceWei}:${this.events.length}:` + ordered.map(p => [p.id,p.contractStatus,p.entriesSold,p.deadline,p.winner,p.prizeClaimed,p.feeSwept,p.myEntries,p.refundableWei,p.claimableWei,p.participants?.length,(p.activity||[]).length].join(':')).join('|');
      this.pools = ordered;
      this.hasLoadedPools = true;
      if (key !== this.lastSnapshotKey) { this.lastSnapshotKey = key; this.emit(); }
    }
    tick() { return false; }
    finalizeDue() { return false; }
    async readPool(id) {
      const pool = parsePool(id, await this.read(SELECTOR.getPool, id));
      if (this.address) {
        const [tickets, contribution, refundable, claimable, claimed] = await Promise.all([
          this.read(SELECTOR.getUserTicketIds, id, this.address), this.read(SELECTOR.getContribution, id, this.address),
          this.read(SELECTOR.getRefundableAmount, id, this.address), this.read(SELECTOR.getClaimablePrize, id, this.address),
          this.read(SELECTOR.refundClaimed, id, this.address)
        ]);
        pool.myTicketIds = parseTicketIds(tickets); pool.myEntries = pool.myTicketIds.length;
        pool.myContributionWei = BigInt(contribution); pool.refundableWei = BigInt(refundable);
        pool.claimableWei = BigInt(claimable); pool.refundClaimed = BigInt(claimed) !== 0n;
      }
      return pool;
    }
    async refreshTicketOwners(id) {
      const pool = this.getPool(id), sold = pool?.entriesSold || 0;
      if (!sold || sold > 120 || this.ownerRefreshPending.has(id)) return;
      const cached = this.ticketOwners.get(id) || [];
      if (cached.length >= sold && pool.participants?.length) return;
      this.ownerRefreshPending.add(id);
      try {
        const owners = cached.slice(0, sold);
        for (let start = owners.length; start < sold; start += 10) {
          const batch = await Promise.all(Array.from({ length: Math.min(10, sold - start) }, (_, offset) => this.read(SELECTOR.getTicketOwner, id, start + offset)));
          owners.push(...batch.map(value => toAddress(BigInt(value))));
        }
        this.ticketOwners.set(id, owners);
        const grouped = new Map();
        owners.forEach((wallet, index) => {
          if (wallet === ZERO) return;
          const key = wallet.toLowerCase(), entry = grouped.get(key) || { wallet, quantity: 0, amount: 0, ticketIds: [] };
          entry.quantity++; entry.amount += pool.entryPrice; entry.ticketIds.push(index + 1); grouped.set(key, entry);
        });
        const current = this.getPool(id);
        if (current && current.entriesSold === sold && !current.participants?.length) {
          this.publishPools(this.pools.map(item => item.id === id ? { ...item, participants: [...grouped.values()] } : item), this.walletVersion);
        }
      } finally { this.ownerRefreshPending.delete(id); }
    }
    async refreshFocusedPool(id) {
      if (this.pending || this.focusedPending || !this.hasLoadedPools) return;
      const walletVersion = this.walletVersion;
      this.focusedPending = true;
      try {
        const fresh = await this.readPool(id);
        if (walletVersion !== this.walletVersion) return;
        const pools = this.pools.slice();
        const index = pools.findIndex(pool => pool.id === Number(id));
        if (index < 0) return;
        const oldSold = pools[index].entriesSold;
        pools[index] = fresh;
        this.publishPools(pools, walletVersion);
        if (fresh.entriesSold !== oldSold) this.refreshLogs(walletVersion).catch(() => {});
        if (!this.getPool(id)?.participants?.length || fresh.entriesSold !== oldSold) this.refreshTicketOwners(Number(id)).catch(error => console.warn('Ticket-owner lookup unavailable:', error));
      } finally { this.focusedPending = false; }
    }
    async refreshPendingOutcomes(excludeId = 0) {
      if (this.pending || this.outcomePending || !this.hasLoadedPools) return;
      const ids = this.pools.filter(pool => pool.contractStatus === 2 && pool.id !== Number(excludeId)).slice(0, 8).map(pool => pool.id);
      if (!ids.length) return;
      const walletVersion = this.walletVersion;
      this.outcomePending = true;
      try {
        const updates = await Promise.all(ids.map(id => this.readPool(id)));
        if (walletVersion !== this.walletVersion) return;
        const next = new Map(this.pools.map(pool => [pool.id, pool]));
        let changed = false;
        for (const pool of updates) {
          const old = next.get(pool.id);
          if (old && (old.contractStatus !== pool.contractStatus || old.winner !== pool.winner || old.refundableWei !== pool.refundableWei)) {
            next.set(pool.id, pool);
            changed = true;
          }
        }
        if (changed) this.publishPools([...next.values()], walletVersion);
      } finally { this.outcomePending = false; }
    }
    async refresh() {
      if (this.pending) { this.refreshQueued = true; return; }
      this.pending = true;
      const walletVersion = this.walletVersion;
      try {
        const count = Number(BigInt(await this.read(SELECTOR.poolCount)));
        if (count > 2000) throw new Error('Pool count exceeds frontend safety limit.');
        const ids = Array.from({ length: count }, (_, index) => index + 1);
        const focusedId = Number(new URLSearchParams(globalThis.location?.search || '').get('id'));
        if (focusedId > 0 && focusedId <= count) ids.sort((a, b) => (a === focusedId ? -1 : b === focusedId ? 1 : a - b));
        const pools = [];
        for (let start = 0; start < ids.length; start += 6) {
          const batch = await Promise.all(ids.slice(start, start + 6).map(id => this.readPool(id)));
          pools.push(...batch);
          // Progressive rendering is useful on the first load only. Replacing the
          // complete pool list with each batch on every refresh makes the UI flash.
          if (!this.hasLoadedPools) this.publishPools(pools, walletVersion);
          if (focusedId > 0 && batch.some(pool => pool.id === focusedId)) this.refreshTicketOwners(focusedId).catch(error => console.warn('Ticket-owner lookup unavailable:', error));
        }
        if (this.address) this.balanceWei = BigInt(await this.rpc('eth_getBalance', [this.address, 'latest']));
        this.publishPools(pools, walletVersion);
        this.refreshLogs(walletVersion).catch(error => console.warn('Event history unavailable; direct pool state remains available:', error));
      } finally { this.pending = false; if (walletVersion !== this.walletVersion || this.refreshQueued) { this.refreshQueued = false; this.refresh().catch(error => console.warn('Pool refresh retry failed:', error)); } }
    }
    async syncLive() {
      if (!this.hasLoadedPools || this.pending || this.logRefreshPending || this.livePending) return;
      this.livePending = true;
      const walletVersion = this.walletVersion;
      try {
        const before = this.events.length;
        await this.scanLogs(this.pools);
        if (walletVersion !== this.walletVersion) return;
        const freshEvents = this.events.slice(before);
        if (!freshEvents.length) return;
        const count = Number(BigInt(await this.read(SELECTOR.poolCount)));
        if (!Number.isSafeInteger(count) || count > 2000) throw new Error('Invalid pool count');
        const changed = new Set(freshEvents.map(event => event.poolId));
        for (let id = this.pools.length + 1; id <= count; id++) changed.add(id);
        const updates = await Promise.all([...changed].filter(id => id > 0 && id <= count).map(id => this.readPool(id)));
        if (walletVersion !== this.walletVersion) return;
        const next = new Map(this.pools.map(pool => [pool.id, pool]));
        for (const pool of updates) {
          const logs = this.events.filter(event => event.poolId === pool.id);
          pool.activity = logs.slice(-10).reverse();
          pool.outcomeEvent = logs.find(event => event.type === 'OutcomeResolved');
          const byWallet = new Map();
          for (const event of logs.filter(item => item.type === 'ENTRY')) {
            const key = event.wallet.toLowerCase();
            const participant = byWallet.get(key) || { wallet: event.wallet, quantity: 0, amount: 0, ticketIds: [] };
            participant.quantity += event.quantity;
            participant.amount += event.amount;
            for (let ticket = event.start; ticket <= event.end; ticket++) participant.ticketIds.push(ticket);
            byWallet.set(key, participant);
          }
          pool.participants = [...byWallet.values()];
          next.set(pool.id, pool);
        }
        this.publishPools([...next.values()], walletVersion);
        for (const pool of updates) {
          if (pool.entriesSold) this.refreshTicketOwners(pool.id).catch(error => console.warn('Ticket-owner lookup unavailable:', error));
        }
      } finally { this.livePending = false; }
    }
    async refreshLogs(walletVersion) {
      if (this.logRefreshPending) return;
      this.logRefreshPending = true;
      try {
        await this.scanLogs(this.pools);
        this.logScanError = null;
        if (walletVersion !== this.walletVersion) return;
        const pools = this.pools.slice();
        for (const p of pools) {
          const logs = this.events.filter(e => e.poolId === p.id), entries = logs.filter(e => e.type === 'ENTRY');
          const byWallet = new Map();
          for (const e of entries) {
            const k = e.wallet.toLowerCase(), previous = byWallet.get(k) || { wallet: e.wallet, quantity: 0, amount: 0, ticketIds: [] };
            previous.quantity += e.quantity; previous.amount += e.amount;
            for (let id = e.start; id <= e.end; id++) previous.ticketIds.push(id);
            byWallet.set(k, previous);
          }
          p.participants = [...byWallet.values()]; p.activity = logs.slice(-10).reverse();
          p.outcomeEvent = logs.find(e => e.type === 'OutcomeResolved');
        }
        this.publishPools(pools, walletVersion);
      } catch (error) { this.logScanError = error; throw error; }
      finally { this.logRefreshPending = false; }
    }
    async scanLogs(pools = []) {
      const logRpc = this.config.logRpcUrl || this.config.rpcUrl;
      const latest = Number(BigInt(await this.rpc('eth_blockNumber')));
      if (!this.historyFloorResolved && pools.length && pools[0].createdAt) {
        let low = Math.max(0, Number(this.config.deploymentBlock || 0));
        let high = latest;
        const target = Math.floor(pools[0].createdAt / 1000) - 30;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const block = await this.rpc('eth_getBlockByNumber', [hex(mid), false]);
          if (Number(BigInt(block.timestamp)) < target) low = mid + 1;
          else high = mid;
        }
        this.lastScanned = Math.max(this.lastScanned, low - 1);
        this.historyFloorResolved = true;
      }
      const from = Math.max(this.lastScanned + 1, Number(this.config.deploymentBlock));
      for (let start = from; start <= latest; start += 500) {
        const end = Math.min(start + 499, latest);
        const logs = await this.rpc('eth_getLogs', [{ address: this.config.poolManagerAddress, fromBlock: hex(start), toBlock: hex(end) }], logRpc);
        for (const log of logs) {
          const key = `${log.transactionHash}:${log.logIndex}`;
          if (this.logKeys.has(key)) continue;
          this.logKeys.add(key);
          const event = parseChainLog(log);
          if (event) {
            if (!this.blockTimes.has(event.blockNumber)) {
              const block = await this.rpc('eth_getBlockByNumber', [hex(event.blockNumber), false]);
              this.blockTimes.set(event.blockNumber, Number(BigInt(block.timestamp)) * 1000);
            }
            event.time = this.blockTimes.get(event.blockNumber);
            this.events.push(event);
          }
        }
        this.lastScanned = end;
      }
    }
    async send(selector, id, quantity, value, onState) {
      if (!this.address) throw new Error('Connect your wallet first.');
      const [walletChain, walletAccounts] = await Promise.all([
        this.walletApi.request({ method: 'eth_chainId' }),
        this.walletApi.request({ method: 'eth_accounts' })
      ]);
      this.network = Number(BigInt(walletChain));
      if (this.network !== this.chainId) throw new Error(`Switch to ${this.networkName} before signing.`);
      if (!walletAccounts?.[0] || walletAccounts[0].toLowerCase() !== this.address.toLowerCase()) {
        this.address = null;
        throw new Error('Wallet account changed. Reconnect before signing.');
      }
      onState?.('AWAITING_SIGNATURE');
      try {
        const data = quantity == null ? encode(selector, id) : encode(selector, id, quantity);
        const request = { from: this.address, to: this.config.poolManagerAddress, data, value: hex(value) };
        const [estimated, gasPrice, balance] = await Promise.all([
          this.walletApi.request({ method: 'eth_estimateGas', params: [request] }),
          this.rpc('eth_gasPrice'), this.rpc('eth_getBalance', [this.address, 'latest'])
        ]);
        if (BigInt(balance) < BigInt(value) + BigInt(estimated) * BigInt(gasPrice) * 12n / 10n) throw new Error(`Not enough ${this.currency} for the entry and network gas.`);
        const hash = await this.walletApi.request({ method: 'eth_sendTransaction', params: [request] });
        onState?.('SUBMITTED', hash); onState?.('CONFIRMING', hash);
        for (let i = 0; i < 90; i++) {
          const receipt = await this.rpc('eth_getTransactionReceipt', [hash]);
          if (receipt) {
            if (BigInt(receipt.status) === 0n) throw new Error('Transaction reverted. Pool may have filled before confirmation.');
            onState?.('CONFIRMED', hash);
            try { await this.refresh(); }
            catch (refreshError) { console.warn('Transaction confirmed; pool refresh will retry:', refreshError); }
            return { hash, receipt };
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error('Transaction is still pending. Check BscScan before retrying.');
      } catch (error) {
        onState?.(/4001|rejected/i.test(String(error?.message)) ? 'REJECTED' : 'FAILED');
        throw new Error(translateError(error, this.currency, this.isMainnet ? 'mainnet' : 'testnet'));
      }
    }
    async enterPool(id, quantity, onState) {
      if (!this.address) throw new Error('Connect your wallet first.');
      if (this.network !== this.chainId) throw new Error(`Switch to ${this.networkName} first.`);
      const p = await this.readPool(Number(id));
      if (![0, 1].includes(p.contractStatus) || (p.deadline && Date.now() >= p.deadline)) throw new Error('Pool no longer accepts entries.');
      if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > p.capacity - p.entriesSold) throw new Error('Pool filled before your transaction confirmed.');
      const cost = p.entryPriceWei * BigInt(quantity);
      const balance = BigInt(await this.rpc('eth_getBalance', [this.address, 'latest']));
      if (balance <= cost) throw new Error(`Not enough ${this.currency} for the entry and network gas.`);
      return this.send(SELECTOR.buyEntries, id, quantity, cost, onState);
    }
    async claimPrize(id, onState) {
      if (!this.address) throw new Error('Connect your wallet first.');
      const p = await this.readPool(Number(id));
      if (p.claimableWei === 0n || p.prizeClaimed) throw new Error('Prize is not claimable by this wallet.');
      return this.send(SELECTOR.claimPrize, id, null, 0n, onState);
    }
    async claimRefund(id, onState) {
      if (!this.address) throw new Error('Connect your wallet first.');
      const p = await this.readPool(Number(id));
      if (p.refundableWei === 0n || p.refundClaimed) throw new Error('No refund is available for this wallet.');
      return this.send(SELECTOR.claimRefund, id, null, 0n, onState);
    }
  }
  return { CHAIN_ID, SELECTOR, TOPIC, pad, words, parsePool, parseTicketIds, parseEntryLog, parseChainLog, formatBNB, translateError, OnchainSingularProvider };
});
