// Worst-case margin floor per plan with relayed signaling `data` bytes (docs/architecture/unit-economics.md "Relayed
// signaling `data` bytes"; signaling §3.5 production gate). Combines relayEconomics() (typical infra, payment fee and,
// optionally, the whole relay allowance) with dataEconomics() (the whole aggregate `data` budget every window).
// Provisional, unsigned: a planning check, not a measured cost. Budgets and prices are not changed here.
//
// Paid is under the 50% floor at the full provisional `data` budget (45.6%; 33.6% with relay). That case is a `todo`,
// so it is visible without failing the suite; it starts passing (and should become a plain test) once the budget is
// lowered or tiered under the release gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relayEconomics,dataEconomics} from '../scripts/cost-model.mjs';

const FLOOR=.5;
const GATE='release gate: docs/3sln/release-gates.md "Signaling" → Data profile (the per-owner `data` budget must be lowered or tiered before SIGNALING_ENABLED; docs/architecture/unit-economics.md)';
// Worst-case annual margin per priced plan, without and with the whole relay allowance.
const margins=()=>{
 const data=new Map(dataEconomics().map(r=>[r.plan,r]));
 return relayEconomics().map(r=>{
  const d=data.get(r.plan);assert.ok(d,`${r.plan}: a data row`);
  const withoutRelay=r.price?(r.price-(r.costs-r.relay)-d.usdYear)/r.price:null;
  const withRelay=r.price?(r.price-r.costs-d.usdYear)/r.price:null;
  return {plan:r.plan,price:r.price,withoutRelay,withRelay};
 });
};
const row=plan=>margins().find(m=>m.plan===plan);
const pct=n=>(n*100).toFixed(1)+'%';
const assertFloor=plan=>{const m=row(plan);
 assert.ok(m.withoutRelay>=FLOOR,`${plan}: ${pct(m.withoutRelay)} with typical infra, fee and the full data budget (no relay)`);
 assert.ok(m.withRelay>=FLOOR,`${plan}: ${pct(m.withRelay)} with the relay allowance and the full data budget`);
};

test('the margin rows cover every plan, and Free has no price to hold a margin',()=>{
 const rows=margins();
 assert.deepEqual(rows.map(r=>r.plan),['free','paid','plus','ultra']);
 const free=rows.find(r=>r.plan==='free');assert.equal(free.price,0);assert.equal(free.withoutRelay,null);assert.equal(free.withRelay,null);
 // The documented values (unit-economics.md), so a model change that moves them is noticed.
 const doc={paid:[.456,.336],plus:[.690,.518],ultra:[.771,.531]};
 for(const [plan,[a,b]] of Object.entries(doc)){const m=row(plan);assert.ok(Math.abs(m.withoutRelay-a)<.0006,`${plan}: ${pct(m.withoutRelay)}`);assert.ok(Math.abs(m.withRelay-b)<.0006,`${plan}: ${pct(m.withRelay)}`);}
});

test('Plus keeps the 50% floor at the full data budget, with and without its relay allowance',()=>assertFloor('plus'));
test('Ultra keeps the 50% floor at the full data budget, with and without its relay allowance',()=>assertFloor('ultra'));
test.todo(`Paid keeps the 50% floor at the full data budget (fails today: 45.6% without relay, 33.6% with it) — ${GATE}`,()=>assertFloor('paid'));
