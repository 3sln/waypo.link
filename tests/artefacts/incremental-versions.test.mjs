import test from 'node:test';
import assert from 'node:assert/strict';
import {createIncrementalProvider,incrementalMembers,IncrementalAdmit,IncrementalBegin,IncrementalDecide,IncrementalAbandon} from '../../packages/federation/incremental.mjs';
import {contractUpgradeDelta,resolvedContractMethod} from '../../packages/consent/reviewed-contracts.mjs';
import {MemoryMessagingStore} from '../../packages/core/records.mjs';
import {fixture,engine,grantMoreInput,calRequest,tasks,subject,CAL,CALENDAR,registrableDomain} from '../incremental-authorization-helpers.mjs';
import {forEachSeed,createScheduler} from '../helpers/chaos.mjs';
const hash=n=>'sha256-'+String(n).repeat(42)+'A',ref=n=>({version:n,digest:hash(n)});
const first={$id:CALENDAR,'x-methods':{createEvent:{effect:'write',request:'#/$defs/request',result:'#/$defs/result',summary:{en:'Create'}}},$defs:{request:{type:'object',properties:{args:{$ref:'#/$defs/args'}}},args:{type:'object',properties:{title:{type:'string'}}},result:{type:'object',properties:{id:{type:'string'}}}}};
first['x-methods'].readEvents={effect:'read',request:'#/$defs/read',result:'#/$defs/read'};first.$defs.read={type:'object',properties:{id:{type:'string'}}};
const second=structuredClone(first);second.$defs.args.properties.attendees={type:'array',items:{type:'string'}};second.$defs.result.properties.privateEmail={type:'string'};second['x-methods'].createEvent.summary.es='Crear';
const pins=[first,second].map((schema,i)=>({schema,...ref(i+1)}));
function setup({enabled=true,scheduler,heldExtra=false,unchanged=false}={}){
 const f=fixture(),current={fields:['calendar'],methods:{calendar:{[CALENDAR]:['createEvent']}},resources:{calendar:['https://cal.example/resource']},...ref(1),contract_versions:{[CALENDAR]:ref(1)}},store=new MemoryMessagingStore(),calls=[];
 if(heldExtra)current.methods.calendar[CALENDAR].push('readEvents');
 const port={connection:async()=>true,current:async()=>structuredClone(current),async commit(input){calls.push(structuredClone(input));const after={...current,...input.changes[0]};return {results:[{fragment:CAL,before:current,after}]};}};
 f.incremental=createIncrementalProvider({store:scheduler?scheduler.wrap(store,'incremental'):store,issuer:'https://provider.example',clock:f.time,registrableDomain,artefactVersions:enabled,grants:port,preferences:f.p.preferencesPort,sessions:f.p.sessionsPort,pinSchema:async target=>({schema:{fields:{calendar:{type:'resource',contracts:[CALENDAR]}}},...ref(typeof target==='object'?target.version:2)}),pinContract:async target=>{const index=typeof target==='object'?target.version-1:1;const pin=unchanged?{schema:first,...ref(index+1)}:pins[index];if(typeof target==='object'&&target.digest!==pin.digest)throw Object.assign(Error('mismatch'),{code:'artefact_digest_mismatch'});return pin;},clients:id=>f.clients.get(id)});
 return {f,calls,current};
}
const run=(e,Kind,input)=>e.perform(new Kind({input}));
test('ART-5b references are flag gated and require a digest for a version',()=>{
 const input={intent:'grant-more',requests:[calRequest({version:2,digest:hash(2),contract_versions:{[CALENDAR]:ref(2)}})]};
 assert.throws(()=>incrementalMembers(input),{code:'invalid_request'});assert.deepEqual(incrementalMembers(input,{artefactVersions:true}).requests[0].contract_versions,input.requests[0].contract_versions);
 assert.throws(()=>incrementalMembers({...input,requests:[calRequest({version:2})]},{artefactVersions:true}),{code:'invalid_request'});
});
test('ART-5b resolved request and result growth and added display text are explicit upgrade deltas',()=>{
 const delta=contractUpgradeDelta(pins[0],pins[1],['createEvent']);assert.deepEqual(delta.updated,['createEvent']);assert.deepEqual(delta.display,[{method:'createEvent',lang:'es',text:'Crear'}]);assert.deepEqual(delta.additions.map(a=>a.path),['/request/properties/args/properties/attendees','/result/properties/privateEmail']);
 const alias=structuredClone(first);alias.$defs.unused={type:'string'};assert.deepEqual(contractUpgradeDelta(pins[0],{schema:alias},['createEvent']),{updated:[],display:[]});
 const broken=structuredClone(first);broken.$defs.request.properties.args.$ref='#/$defs/missing';assert.throws(()=>resolvedContractMethod({schema:broken},'createEvent'),/Unresolved/);
});
test('ART-5b an already held method is reviewed again and decline never advances authority',async t=>{
 const {f,calls}=setup(),e=await engine(t,f),entry=grantMoreInput([calRequest({...ref(2),contract_versions:{[CALENDAR]:ref(2)}})]);
 await run(e,IncrementalAdmit,entry.input);const {view}=await run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject});
 assert.equal(view.requests[0].version,2);assert.deepEqual(view.requests[0].delta.updated,{calendar:{[CALENDAR]:['createEvent']}});assert.equal(view.requests[0].delta.display[0].text,'Crear');assert.equal(view.requests[0].delta.additions[1].path,'/result/properties/privateEmail');
 f.time.advance(1500);await run(e,IncrementalDecide,{entryHash:entry.input.entryHash,subject,decision:{denied:true}});assert.equal(calls.length,0);
});
test('ART-5b approval preserves the old explicit sets and records the consented contract reference',async t=>{
 const {f,calls}=setup(),e=await engine(t,f),entry=grantMoreInput([calRequest({...ref(2),contract_versions:{[CALENDAR]:ref(2)}})]);
 await run(e,IncrementalAdmit,entry.input);await run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject});f.time.advance(1500);
 await run(e,IncrementalDecide,{entryHash:entry.input.entryHash,subject,decision:{approved:[{fragment:CAL,fields:[],methods:{calendar:{[CALENDAR]:['createEvent']}}}]}});
 assert.equal(calls.length,1);assert.deepEqual(calls[0].changes[0].contract_versions,{[CALENDAR]:ref(2)});assert.deepEqual(calls[0].changes[0].fields,['calendar']);assert.deepEqual(calls[0].changes[0].resources,{calendar:['https://cal.example/resource']});
});
test('ART-5b a foreign contract digest mismatch affects only its request',async t=>{
 const {f,calls}=setup(),e=await engine(t,f),bad=grantMoreInput([calRequest({...ref(2),contract_versions:{[CALENDAR]:{version:2,digest:hash(3)}}})]);
 await assert.rejects(run(e,IncrementalAdmit,bad.input),{code:'artefact_digest_mismatch'});
 const good=grantMoreInput([calRequest({...ref(2),contract_versions:{[CALENDAR]:ref(2)}})]);await run(e,IncrementalAdmit,good.input);assert((await run(e,IncrementalBegin,{entryHash:good.input.entryHash,subject})).view);assert.equal(calls.length,0);
});
test('ART-5b seeded competing approval and decline never commit more than one upgrade',async t=>{
 await forEachSeed(8,async random=>{const scheduler=createScheduler(random),{f,calls}=setup({scheduler}),e=await engine(t,f),entry=grantMoreInput([calRequest({...ref(2),contract_versions:{[CALENDAR]:ref(2)}})]);
  await run(e,IncrementalAdmit,entry.input);await run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject});f.time.advance(1500);
  const outcomes=await scheduler.run([()=>run(e,IncrementalDecide,{entryHash:entry.input.entryHash,subject,decision:{approved:[{fragment:CAL,methods:{calendar:{[CALENDAR]:['createEvent']}}}]}}),()=>run(e,IncrementalDecide,{entryHash:entry.input.entryHash,subject,decision:{denied:true}})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert(calls.length<=1);if(calls.length)assert.deepEqual(calls[0].changes[0].contract_versions,{[CALENDAR]:ref(2)});
 });
});

test('ART-5b reference siblings preserve the referenced constraints during upgrade comparison',()=>{
 const old=structuredClone(first),next=structuredClone(second);old['x-methods'].createEvent.request={ $ref:'#/$defs/request',properties:{label:{type:'string'}}};next['x-methods'].createEvent.request=structuredClone(old['x-methods'].createEvent.request);
 assert.deepEqual(contractUpgradeDelta({schema:old},{schema:next},['createEvent']).updated,['createEvent']);
 assert(contractUpgradeDelta({schema:old},{schema:next},['createEvent']).additions.some(a=>a.path.includes('/allOf/0/properties/args/properties/attendees')));
});

test('ART-5b a silent request cannot upgrade an unrequested held method on the same contract',async t=>{
 const {f,calls}=setup({heldExtra:true}),e=await engine(t,f),entry=grantMoreInput([calRequest({...ref(2),methods:{calendar:{[CALENDAR]:['readEvents']}},contract_versions:{[CALENDAR]:ref(2)}})]);
 await run(e,IncrementalAdmit,entry.input);const {view}=await run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject});
 assert.deepEqual(view.requests[0].delta.updated,{calendar:{[CALENDAR]:['createEvent']}});assert.equal(calls.length,0);
 f.time.advance(1500);await run(e,IncrementalDecide,{entryHash:entry.input.entryHash,subject,decision:{denied:true}});assert.equal(calls.length,0);
});

test('ART-5b approval can review a carried method absent from the upgrade request',async t=>{
 const {f,calls}=setup({heldExtra:true}),e=await engine(t,f),entry=grantMoreInput([calRequest({...ref(2),methods:{calendar:{[CALENDAR]:['readEvents']}},contract_versions:{[CALENDAR]:ref(2)}})]);
 await run(e,IncrementalAdmit,entry.input);await run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject});f.time.advance(1500);
 await run(e,IncrementalDecide,{entryHash:entry.input.entryHash,subject,decision:{approved:[{fragment:CAL,methods:{calendar:{[CALENDAR]:['createEvent']}}}]}});
 assert.deepEqual(calls[0].changes[0].methods.calendar[CALENDAR],['createEvent','readEvents']);
});

test('ART-5b seeded silent begin versus abandon never widens explicit authority',async t=>{
 await forEachSeed(8,async random=>{const scheduler=createScheduler(random),{f,calls,current}=setup({scheduler,unchanged:true}),e=await engine(t,f),entry=grantMoreInput([calRequest({...ref(2),contract_versions:{[CALENDAR]:ref(2)}})]);
  await run(e,IncrementalAdmit,entry.input);
  const settled=await scheduler.run([()=>run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject}),()=>run(e,IncrementalAbandon,{entryHash:entry.input.entryHash})]);
  assert(settled.some(r=>r.status==='fulfilled'));assert(calls.length<=1);for(const call of calls){const change=call.changes[0];assert.equal(change.silent,true);for(const key of ['fields','methods','resources'])assert.deepEqual(change[key],current[key]);}
 });
});

test('ART-5b flag off keeps the legacy outcome bytes even with version metadata in storage',async t=>{
 const {f,calls}=setup({enabled:false}),e=await engine(t,f),entry=grantMoreInput([calRequest()]);await run(e,IncrementalAdmit,entry.input);
 const {complete}=await run(e,IncrementalBegin,{entryHash:entry.input.entryHash,subject});assert.equal(typeof complete.code,'string');assert.equal(calls.length,0);
 // The public pure outcome has the same opt-in boundary as the provider.
 const {fragmentOutcome}=await import('../../packages/federation/incremental.mjs');const grant={fields:['calendar'],methods:{},version:2,digest:hash(2),contract_versions:{[CALENDAR]:ref(2)}};
 assert.equal(JSON.stringify(fragmentOutcome({fragment:CAL,fields:['calendar'],methods:{}},grant,grant)),JSON.stringify({fragment:CAL,outcome:'granted',granted:{fields:['calendar'],methods:{}}}));
});
