// RTC-f: hosted TURN relay in the planning cost model (scripts/cost-model.mjs relayEconomics; docs/architecture/
// unit-economics.md "Hosted relay"). Provisional, unsigned: a planning check, not a measured cost or an invoice cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relayEconomics,relayAssumptions,relayAbuseStress,report} from '../scripts/cost-model.mjs';
import {RELAY_PLAN_BYTES,RELAY_LIMITS} from '../packages/rtc/relay.mjs';

test('every paid plan keeps a 50% or better margin with its whole relay allowance spent (typical profile)',()=>{
 const rows=relayEconomics();
 assert.deepEqual(rows.map(r=>r.plan),['free','paid','plus','ultra']);
 for(const r of rows.filter(r=>r.price>0))assert.ok(r.margin>=.5,`${r.plan}: ${(r.margin*100).toFixed(1)}%`);
 assert.equal(rows.find(r=>r.plan==='free').gbMonth,0,'free includes no hosted relay');
 assert.equal(RELAY_PLAN_BYTES.free,0);
 assert.ok(report().relay.length===4,'the report carries the relay rows');
});

test('the allowance is the binding assumption: doubling the TURN price breaks the 50% floor',()=>{
 const doubled=relayEconomics({...relayAssumptions,turnUSDPerGB:relayAssumptions.turnUSDPerGB*2});
 assert.ok(doubled.some(r=>r.price>0&&r.margin<.5),'a relay price change must be rechecked against the allowances');
 // Prices are unchanged by this slice.
 assert.deepEqual(relayEconomics().map(r=>r.price),[0,5,35,250]);
});

test('review M1 stress row: without spend-authority enforcement, 4 abusive legs for a month cost more than any plan earns',()=>{
 const stress=relayAbuseStress();
 assert.equal(stress.enforcement,'none');assert.equal(stress.legs,RELAY_LIMITS.accountLegs,'the occupant\'s concurrent-leg limit');
 assert.equal(stress.gbMonth,5184,'4 legs x 4 Mbit/s x 30 days');
 // The local allowance bounds issuances, not bytes: the stress cost does not depend on it, and dwarfs every paid price.
 for(const p of stress.plans){assert.ok(p.margin<0,`${p.plan}: ${(p.margin*100).toFixed(0)}%`);assert.ok(p.relayCostToPrice>10,p.plan);}
 assert.ok(stress.usdMonth>Math.max(...relayEconomics().map(r=>r.price)),'one unenforced month exceeds the highest annual price');
 assert.ok(report().relayStress.usdYear>0,'the report carries the stress row');
});
