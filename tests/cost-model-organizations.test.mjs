import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationEconomics,organizationAssumptions} from '../scripts/cost-model.mjs';
import {ORGANIZATION_PLANS} from '../packages/billing/organizations.mjs';

test('every organization tier keeps at least a 50% worst-case contribution margin',()=>{
 const rows=organizationEconomics();assert.deepEqual(rows.map(r=>r.plan),Object.keys(ORGANIZATION_PLANS));
 for(const r of rows){assert.ok(r.margin>=.5,`${r.plan} margin ${r.margin.toFixed(3)}`);assert.ok(r.storage>0&&r.fee>0&&r.ai>0);}
});
test('storage dominates cost, and a backup copy is not covered by the price',()=>{
 for(const r of organizationEconomics())assert.ok(r.marginWithBackupCopy<r.margin&&r.storage>r.ai);
 const cheap=organizationEconomics({...organizationAssumptions,creditUSD:.001});assert.ok(cheap.some(r=>r.margin<.5),'a 10x credit valuation would break the margin; the credit definition is load-bearing');
});
