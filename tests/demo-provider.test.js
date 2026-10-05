const test = require('node:test');
const assert = require('node:assert/strict');
const { DemoSingularProvider, initialState, deriveStatus, mapContractStatus, chance, TX_STATES } = require('../app/demo-core.js');

class MemoryStorage { constructor(){ this.map = new Map(); } getItem(k){ return this.map.get(k) || null; } setItem(k,v){ this.map.set(k,v); } }
const provider = () => new DemoSingularProvider(new MemoryStorage());

test('odds are calculated from owned and total entries', () => assert.equal(chance(3, 11).toFixed(2), '27.27'));
test('status derives waiting, live, convergence, near-resolution and expiry', () => {
  const p={capacity:100,entriesSold:0,status:'WAITING'}; assert.equal(deriveStatus(p),'WAITING');
  Object.assign(p,{entriesSold:20,status:'LIVE',deadline:Date.now()+1000}); assert.equal(deriveStatus(p),'LIVE');
  p.entriesSold=60; assert.equal(deriveStatus(p),'CONVERGING');
  p.entriesSold=95; assert.equal(deriveStatus(p),'NEAR RESOLUTION');
  Object.assign(p,{entriesSold:20,deadline:Date.now()-1}); assert.equal(deriveStatus(p),'EXPIRED');
});
test('first entry starts timer and updates pool, activity and position', () => {
  const p=provider(); p.connectWallet(); const before=Date.now(); p.enterPool(1,3); const pool=p.getPool(1);
  assert.equal(pool.entriesSold,3); assert.ok(pool.startTime>=before); assert.equal(pool.deadline-pool.startTime,180000);
  assert.equal(p.getEntries().find(x=>x.poolId===1).quantity,3); assert.equal(pool.activity[0].type,'ENTRY');
});
test('capacity validation prevents oversubscription without partial fill', () => {
  const p=provider(); p.connectWallet(); assert.throws(()=>p.enterPool(1,12),/capacity/); assert.equal(p.getPool(1).entriesSold,0);
});
test('final entry enters resolving then creates deterministic outcome', () => {
  const p=provider(); p.connectWallet(); const result=p.enterPool(1,11); assert.equal(result.finalEntry,true); assert.equal(p.getPool(1).status,'RESOLVING');
  p.finalizeDue(Date.now()+2000); const pool=p.getPool(1); assert.equal(pool.status,'RESOLVED'); assert.ok(pool.winningTicket>=1&&pool.winningTicket<=11);
});
test('expired contribution is refundable exactly once', () => {
  const p=provider(); const item=p.getRefunds().find(x=>x.poolId===12); assert.equal(item.amount,.03); assert.equal(item.claimed,false);
  p.claimRefund(12); assert.equal(p.getRefunds().find(x=>x.poolId===12).claimed,true); assert.throws(()=>p.claimRefund(12),/already claimed/);
});
test('provider persists local state across instances', () => {
  const storage=new MemoryStorage(), a=new DemoSingularProvider(storage); a.connectWallet(); a.enterPool(1,2); const b=new DemoSingularProvider(storage); assert.equal(b.getPool(1).entriesSold,2);
});
test('transaction state sequence is complete', () => assert.deepEqual(TX_STATES,['Preparing','Wallet confirmation','Submitted','Confirmed']));
test('seed keeps original BNB economics', () => {
  const s=initialState(), pools=s.pools.filter(p=>p.id<10); assert.deepEqual(pools.map(p=>[p.prize,p.entryPrice,p.fee,p.capacity]),[[.1,.01,.01,11],[.5,.01,.05,55],[1,.01,.1,110]]);
});
test('future contract status adapter maps canonical state to existing UI state', () => {
  assert.deepEqual([mapContractStatus(0),mapContractStatus(1,5,11),mapContractStatus(1,9,11),mapContractStatus(1,10,11),mapContractStatus(2),mapContractStatus(3),mapContractStatus(4)],['WAITING','LIVE','CONVERGING','NEAR RESOLUTION','RESOLVING','RESOLVED','EXPIRED']);
});
