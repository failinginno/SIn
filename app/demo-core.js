(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SingularDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STORAGE_KEY = 'singular-demo-state-v2';
  const DEMO_WALLET = '0xDEMO000000000000000000000000000000A11';
  const TX_STATES = ['Preparing', 'Wallet confirmation', 'Submitted', 'Confirmed'];

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const now = () => Date.now();
  const short = (value) => value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—';
  const amount = (value) => Number(value || 0).toFixed(2);
  const chance = (owned, total) => total ? (owned / total) * 100 : 0;

  function deriveStatus(pool, at = now()) {
    if (pool.status === 'RESOLVED' || pool.status === 'EXPIRED' || pool.status === 'RESOLVING') return pool.status;
    if (pool.entriesSold >= pool.capacity) return 'RESOLVING';
    if (pool.entriesSold === 0) return 'WAITING';
    if (pool.deadline && at >= pool.deadline) return 'EXPIRED';
    const fill = pool.entriesSold / pool.capacity;
    if (fill >= .9) return 'NEAR RESOLUTION';
    if (fill >= .5) return 'CONVERGING';
    return 'LIVE';
  }

  function initialState(at = now()) {
    const participant = (wallet, quantity, start) => ({ wallet, quantity, start, end: start + quantity - 1, amount: quantity * .01 });
    return {
      version: 2,
      mode: 'demo',
      wallet: { connected: false, address: DEMO_WALLET, balance: 2.48, network: 'BNB Chain · Demo' },
      pools: [
        { id: 1, prize: .10, entryPrice: .01, fee: .01, capacity: 11, duration: 180, entriesSold: 0, startTime: null, deadline: null, status: 'WAITING', participants: [], activity: [] },
        { id: 2, prize: .50, entryPrice: .01, fee: .05, capacity: 55, duration: 600, entriesSold: 7, startTime: at - 78000, deadline: at + 522000, status: 'LIVE', participants: [participant('Demo · 0xA41…83F2', 4, 1), participant('Demo · 0x9B2…61C8', 3, 5)], activity: [{ type: 'ENTRY', text: '3 entries converged', time: at - 24000 }, { type: 'ENTRY', text: '4 entries converged', time: at - 78000 }] },
        { id: 3, prize: 1, entryPrice: .01, fee: .10, capacity: 110, duration: 900, entriesSold: 90, startTime: at - 360000, deadline: at + 540000, status: 'CONVERGING', participants: [participant('Demo · 0x84C…A219', 48, 1), participant('Demo · 0xF12…90B7', 42, 49)], activity: [{ type: 'ENTRY', text: '42 entries converged', time: at - 120000 }, { type: 'ENTRY', text: '48 entries converged', time: at - 360000 }] },
        { id: 12, prize: .25, entryPrice: .01, fee: .025, capacity: 30, duration: 180, entriesSold: 8, startTime: at - 420000, deadline: at - 240000, status: 'EXPIRED', participants: [{ wallet: DEMO_WALLET, quantity: 3, start: 6, end: 8, amount: .03 }], activity: [] },
        { id: 18, prize: 1, entryPrice: .01, fee: .10, capacity: 110, duration: 900, entriesSold: 110, startTime: at - 1200000, deadline: at - 300000, status: 'RESOLVED', winningTicket: 64, winner: 'Demo · 0x84C…A219', settledAt: at - 250000, participants: [], activity: [] }
      ],
      refunds: [],
      transactions: [],
      sequence: 1
    };
  }

  class SingularProvider {
    getPools() { throw new Error('Not implemented'); }
    getPool() { throw new Error('Not implemented'); }
    enterPool() { throw new Error('Not implemented'); }
    getEntries() { throw new Error('Not implemented'); }
    getOutcomes() { throw new Error('Not implemented'); }
    getRefunds() { throw new Error('Not implemented'); }
    claimRefund() { throw new Error('Not implemented'); }
  }

  class DemoSingularProvider extends SingularProvider {
    constructor(storage) {
      super();
      this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      this.listeners = new Set();
      this.state = this.load();
      this.tick();
    }
    load() {
      try { const saved = this.storage && this.storage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : initialState(); }
      catch (_) { return initialState(); }
    }
    save() {
      if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.emit();
    }
    emit() { this.listeners.forEach(fn => fn(clone(this.state))); }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    reset() { this.state = initialState(); this.save(); return clone(this.state); }
    connectWallet() { this.state.wallet.connected = true; this.save(); return clone(this.state.wallet); }
    disconnectWallet() { this.state.wallet.connected = false; this.save(); }
    getWallet() { return clone(this.state.wallet); }
    getPools() { this.tick(); return clone(this.state.pools.filter(p => p.id < 10)); }
    getPool(id) { this.tick(); return clone(this.state.pools.find(p => p.id === Number(id))); }
    getEntries() {
      const rows = [];
      this.state.pools.forEach(pool => (pool.participants || []).forEach(p => {
        if (p.wallet === DEMO_WALLET) rows.push({ poolId: pool.id, prize: pool.prize, quantity: p.quantity, amount: p.amount, range: `${p.start}–${p.end}`, status: deriveStatus(pool), deadline: pool.deadline });
      }));
      return clone(rows.sort((a, b) => b.poolId - a.poolId));
    }
    getOutcomes() { return clone(this.state.pools.filter(p => p.status === 'RESOLVED').sort((a, b) => b.settledAt - a.settledAt)); }
    getRefunds() {
      this.tick();
      return clone(this.state.pools.filter(p => p.status === 'EXPIRED').flatMap(pool => (pool.participants || []).filter(p => p.wallet === DEMO_WALLET).map(p => ({ poolId: pool.id, amount: p.amount, claimed: this.state.refunds.includes(pool.id) }))));
    }
    tick(at = now()) {
      let changed = false;
      this.state.pools.forEach(pool => { const next = deriveStatus(pool, at); if (next !== pool.status) { pool.status = next; changed = true; } });
      if (changed) this.save();
      return changed;
    }
    enterPool(id, quantity) {
      const pool = this.state.pools.find(p => p.id === Number(id));
      quantity = Number(quantity);
      if (!this.state.wallet.connected) throw new Error('Connect the demo wallet first.');
      if (!pool) throw new Error('Pool not found.');
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Choose at least one entry.');
      const status = deriveStatus(pool);
      if (!['WAITING', 'LIVE', 'CONVERGING', 'NEAR RESOLUTION'].includes(status)) throw new Error(`Pool is ${status.toLowerCase()}.`);
      if (quantity > pool.capacity - pool.entriesSold) throw new Error('Quantity exceeds remaining capacity.');
      if (pool.entriesSold === 0) { pool.startTime = now(); pool.deadline = pool.startTime + pool.duration * 1000; }
      const start = pool.entriesSold + 1;
      const existing = pool.participants.find(p => p.wallet === DEMO_WALLET);
      if (existing) { existing.quantity += quantity; existing.end += quantity; existing.amount += quantity * pool.entryPrice; }
      else pool.participants.push({ wallet: DEMO_WALLET, quantity, start, end: start + quantity - 1, amount: quantity * pool.entryPrice });
      pool.entriesSold += quantity;
      pool.activity.unshift({ type: 'ENTRY', text: `${quantity} ${quantity === 1 ? 'entry' : 'entries'} converged`, time: now(), wallet: DEMO_WALLET });
      const tx = { id: `demo-${this.state.sequence++}`, type: 'ENTRY', poolId: pool.id, quantity, amount: quantity * pool.entryPrice, state: 'Confirmed', time: now(), demo: true };
      this.state.transactions.unshift(tx);
      if (pool.entriesSold === pool.capacity) {
        pool.status = 'RESOLVING';
        pool.resolveAt = now() + 900;
        pool.activity.unshift({ type: 'STATUS', text: 'Capacity reached · resolving locally', time: now() });
      } else pool.status = deriveStatus(pool);
      this.save();
      return clone({ pool, tx, finalEntry: pool.status === 'RESOLVING' });
    }
    finalizeDue(at = now()) {
      let changed = false;
      this.state.pools.forEach(pool => {
        if (pool.status === 'RESOLVING' && pool.resolveAt <= at) {
          pool.winningTicket = ((pool.id * 37 + pool.capacity * 11) % pool.capacity) + 1;
          const owner = (pool.participants || []).find(p => pool.winningTicket >= p.start && pool.winningTicket <= p.end);
          pool.winner = owner ? owner.wallet : 'Demo participant';
          pool.status = 'RESOLVED'; pool.settledAt = at;
          pool.activity.unshift({ type: 'OUTCOME', text: `Outcome resolved · ticket #${pool.winningTicket}`, time: at }); changed = true;
        }
      });
      if (changed) this.save();
      return changed;
    }
    claimRefund(poolId) {
      poolId = Number(poolId);
      const item = this.getRefunds().find(r => r.poolId === poolId);
      if (!item) throw new Error('No refundable contribution for this pool.');
      if (item.claimed || this.state.refunds.includes(poolId)) throw new Error('Refund already claimed.');
      this.state.refunds.push(poolId);
      const tx = { id: `demo-${this.state.sequence++}`, type: 'REFUND', poolId, amount: item.amount, state: 'Confirmed', time: now(), demo: true };
      this.state.transactions.unshift(tx); this.save(); return clone(tx);
    }
  }

  function mapContractStatus(contractStatus, entriesSold = 0, capacity = 0) {
    switch (Number(contractStatus)) {
      case 0: return 'WAITING';
      case 1: {
        const fill = capacity > 0 ? entriesSold / capacity : 0;
        return fill >= .9 ? 'NEAR RESOLUTION' : fill >= .5 ? 'CONVERGING' : 'LIVE';
      }
      case 2: return 'RESOLVING';
      case 3: return 'RESOLVED';
      case 4: return 'EXPIRED';
      default: throw new Error('Unknown contract pool status.');
    }
  }

  class OnchainSingularProvider extends SingularProvider {
    constructor({ abi = null, address = null, transport = null } = {}) {
      super();
      this.abi = abi;
      this.address = address;
      this.transport = transport;
      this.available = false;
    }
    unavailable() { throw new Error('Onchain provider is not configured in this build.'); }
  }

  return { STORAGE_KEY, DEMO_WALLET, TX_STATES, SingularProvider, DemoSingularProvider, OnchainSingularProvider, mapContractStatus, initialState, deriveStatus, chance, amount, short };
});
