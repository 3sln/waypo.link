// Regression (simulation finding, 2026-10-29): with ARTEFACT_VERSIONS_ENABLED on, a reader's first event-bus `read`
// on a bus with nothing above its floor failed `invalid_result`. The store (and the conformance client,
// packages/events/client.mjs) answer `head: null` when no record above the reader's floor exists (events §4.2: head,
// oldest and gap are computed only above the floor), while event-bus/v1 declared `head` a non-null integer. The
// contract now declares `head` integer ≥ 1 or null, like `oldest`. The reviewed digest follows the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {compileContractVersion} from '../packages/federation/integrations.mjs';
import {canonical,digest} from '../packages/core/records.mjs';
import {REVIEWED_CONTRACTS,EVENT_BUS_CONTRACT} from '../packages/consent/reviewed-contracts.mjs';
import {readProblems} from '../packages/events/client.mjs';
import {busHarness,app} from './event-bus-fixture.mjs';

const doc=JSON.parse(readFileSync(new URL('../docs/artefacts/event-bus-v1.json',import.meta.url),'utf8'));
const contract=compileContractVersion(doc);

test('store read results, empty and populated, satisfy the event-bus/v1 result schema',async t=>{
 const h=await busHarness(t),bus=await h.create(),a=app();h.grants.allow(a.clientId,['read','publish']);
 const empty=await h.read(a,bus.id,{start:'oldest'});
 assert.equal(empty.head,null,'nothing above the floor: head is null');
 assert.doesNotThrow(()=>contract.shape('read',empty),'an empty read is a valid result');
 assert.deepEqual(readProblems(empty,{floorSeq:0}),[]);
 await h.publish(a,bus.id,'created',{task:'t1',title:'File taxes'});
 const page=await h.read(a,bus.id,{cursor:empty.cursor});
 assert.equal(page.head,1);assert.equal(page.records.length,1);
 assert.doesNotThrow(()=>contract.shape('read',page));
 assert.throws(()=>contract.shape('read',{...page,head:0}),{code:'invalid_result'},'head 0 is not a visible seq');
});

test('the reviewed event-bus/v1 digest matches the shipped contract',async()=>{
 assert.equal(REVIEWED_CONTRACTS[EVENT_BUS_CONTRACT].digest,'sha256-'+await digest(webcrypto,canonical(doc)));
});
