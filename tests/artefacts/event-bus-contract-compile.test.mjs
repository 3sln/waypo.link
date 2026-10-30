// Regression (simulation finding, 2026-10-29): with ARTEFACT_VERSIONS_ENABLED on, every event-bus/v1 call failed
// `artefact_unverifiable` because the pinned contract's root carries the descriptive `x-runtime-validation` list, which
// compileContractVersion did not treat as an annotation. Annotations never assert; unknown assertion keywords still fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileContractVersion} from '../../packages/federation/integrations.mjs';

const doc=JSON.parse(readFileSync(new URL('../../docs/artefacts/event-bus-v1.json',import.meta.url),'utf8'));
const body=doc.versions?doc.versions.at(-1).body:doc;

test('the shipped event-bus/v1 contract compiles and validates its methods',async()=>{
 assert.ok(Object.hasOwn(body,'x-runtime-validation'));
 const contract=compileContractVersion(body);
 assert.equal(await contract.validate({method:'read',args:{start:'latest',limit:1}}),true);
 assert.equal(await contract.validate({method:'publish',args:{type:'moved',data:{card:'c1'}}}),true);
 assert.equal(await contract.validate({method:'read',args:{start:'sideways'}}),false);
});
test('an unknown assertion keyword still fails closed',()=>{
 assert.throws(()=>compileContractVersion({...body,'x-made-up':true}).validate({method:'read',args:{}}),{code:'artefact_unverifiable'});
});
