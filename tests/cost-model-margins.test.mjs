// Worst-case margin floor per plan with relayed signaling `data` bytes (docs/architecture/unit-economics.md "Relayed
// signaling `data` bytes"; signaling §3.5 production gate). Combines relayEconomics() (typical infra, payment fee and,
// optionally, the whole relay allowance) with dataEconomics() (the whole aggregate `data` budget every window).
// A planning check, not a measured cost. The `data` budget is 256 KiB per hour on every plan (owner-approved
// 2026-10-28); prices and the cost model's other inputs stay provisional and unsigned.
//
// At that budget Paid holds the floor without relay (60.5%) but not with its whole relay allowance as well (48.5%).
// That case is a `todo` naming the relay byte-cap gate, so it is visible without failing the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relayEconomics,dataEconomics} from '../scripts/cost-model.mjs';

const FLOOR=.5;
const GATE='release gate: docs/3sln/release-gates.md "Signaling" → Data profile (hosted relay issuance stays refused until the spend authority enforces a per-owner relay byte cap, signaling §16.7; docs/architecture/unit-economics.md)';
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
const assertFloorWithoutRelay=plan=>{const m=row(plan);assert.ok(m.withoutRelay>=FLOOR,`${plan}: ${pct(m.withoutRelay)} with typical infra, fee and the full data budget (no relay)`);};
const assertFloorWithRelay=plan=>{const m=row(plan);assert.ok(m.withRelay>=FLOOR,`${plan}: ${pct(m.withRelay)} with the relay allowance and the full data budget`);};
const assertFloor=plan=>{assertFloorWithoutRelay(plan);assertFloorWithRelay(plan);};

test('the margin rows cover every plan, and Free has no price to hold a margin',()=>{
 const rows=margins();
 assert.deepEqual(rows.map(r=>r.plan),['free','paid','plus','ultra']);
 const free=rows.find(r=>r.plan==='free');assert.equal(free.price,0);assert.equal(free.withoutRelay,null);assert.equal(free.withRelay,null);
 // The documented values (unit-economics.md), so a model change that moves them is noticed.
 const doc={paid:[.605,.485],plus:[.711,.539],ultra:[.774,.534]};
 for(const [plan,[a,b]] of Object.entries(doc)){const m=row(plan);assert.ok(Math.abs(m.withoutRelay-a)<.0006,`${plan}: ${pct(m.withoutRelay)}`);assert.ok(Math.abs(m.withRelay-b)<.0006,`${plan}: ${pct(m.withRelay)}`);}
});

test('Plus keeps the 50% floor at the full data budget, with and without its relay allowance',()=>assertFloor('plus'));
test('Ultra keeps the 50% floor at the full data budget, with and without its relay allowance',()=>assertFloor('ultra'));
test('Paid keeps the 50% floor at the full data budget without relay',()=>assertFloorWithoutRelay('paid'));
test.todo(`Paid keeps the 50% floor at the full data budget with its whole relay allowance (fails today: 48.5%) — ${GATE}`,()=>assertFloorWithRelay('paid'));
