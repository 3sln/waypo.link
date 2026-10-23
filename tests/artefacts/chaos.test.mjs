import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {createAppEngine,perform,read} from '../../packages/app/engine.mjs';
import {PinArtefact,ResolveArtefact,RefreshArtefact} from '../../packages/federation/artefact-store.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {createFlags} from '../../packages/flags/evaluate.mjs';
import {forEachSeed,createScheduler,injectFaults,fakeClock} from '../helpers/chaos.mjs';
const ID='https://chaos.example/line',reference=(version,digest)=>({artefact:ID,version,digest});
test('seeded concurrent publication, pins, retractions and store/fetch faults preserve immutable authority',async()=>{
 await forEachSeed(24,async random=>{
  const db=new SqliteMetadata(':memory:'),clock=fakeClock(),scheduler=createScheduler(random),versions=[],digests=[],snapshots=[],failures=['timeout','404','410','5xx','TLS','oversized','truncated','slow','redirect','media'];
  try{
   for(let n=1;n<=3;n++){const body={id:ID,title:'Preferences',fields:Object.fromEntries(Array.from({length:n},(_,i)=>['field'+i,{title:'Field '+i,type:'boolean',cardinality:{min:0,max:1}}]))},entry={version:n,prev:digests.at(-1)??null,body};versions.push(entry);digests.push(await versionDigest(versionRecord({id:ID,kind:'fragment'},entry)));snapshots.push({bindle_artefact:1,id:ID,kind:'fragment',versions:structuredClone(versions)});}
   const flags=createFlags({snapshot:{v:1,version:1,issuedAt:clock.now(),flags:{}},env:{ARTEFACT_VERSIONS_ENABLED:'true'},clock:clock.now});let current=snapshots[0],failure=null,abort=false;
   const faulted=injectFaults({transaction:fn=>db.transaction(async tx=>{const result=await fn(tx);await new Promise(resolve=>setImmediate(resolve));return result;}),get:key=>db.get(key)},[{method:'transaction',when:()=>abort&&random.chance(.12),mode:'throw',error:Object.assign(Error('transaction abort'),{code:'transaction_abort'})}],{random});
   const store=scheduler.wrap(faulted,'store'),egress=scheduler.wrap({async fetch(){if(failure){const kind=failure;failure=null;if(kind==='truncated')return '{"bindle_artefact":';if(kind==='oversized')throw Object.assign(Error(),{code:'too_large'});throw Object.assign(Error(kind),{code:'timeout'});}return structuredClone(current);}},'fetch');
   const engine=createAppEngine({providers:{federationStore:store,egress,flags,clock,config:{validateArtefactBody:body=>body.id===ID},random:{},audit:{record(){}}}}),pin=input=>perform(engine,new PinArtefact({input})),resolve=input=>read(engine,new ResolveArtefact({input}));
   const first=await pin(reference(1,digests[0]));clock.advance(3600000);abort=true;
   const settled=await scheduler.run([
    async()=>{current=snapshots[1];return pin(reference(2,digests[1]));},
    async()=>{current=snapshots[2];return pin(reference(3,digests[2]));},
    async()=>{current={...snapshots[2],notices:[{type:'retracted',head:digests[2],from:2,reason:'Withdrawn',issued:'2026-10-22T00:00:00Z'}]};return perform(engine,new RefreshArtefact({input:{artefact:ID}}));},
    async()=>{failure=random.pick(failures);return pin({artefact:ID});},
    ()=>resolve(first.reference)
   ]);abort=false;
   const before=await db.get('artefacts/line/'+ID),stored=[...await db.list({prefix:'artefacts/record/'})];
   assert(before.head>=1&&before.head<=3);assert.equal((await resolve(first.reference)).reference.digest,digests[0]);
   for(const outcome of settled)if(outcome.status==='fulfilled'&&outcome.value?.reference){const value=await resolve(outcome.value.reference);assert.deepEqual(value.body,outcome.value.body);assert.equal(await versionDigest(versionRecord({id:ID,kind:'fragment'},{version:value.reference.version,prev:digests[value.reference.version-2]??null,body:value.body})),value.reference.digest);}
   for(const [key,record]of stored)assert.equal(key,'artefacts/record/'+await versionDigest(record));
   failure=null;current=snapshots[2];clock.advance(3600000);await perform(engine,new RefreshArtefact({input:{artefact:ID}})).catch(()=>{});const after=await db.get('artefacts/line/'+ID);assert.equal(after.head,before.head);assert(after.notices.length>=before.notices.length);assert(after.faults.length>=before.faults.length);
   for(const [key,record]of stored)assert.deepEqual(await db.get(key),record);
  }finally{db.close();}
 });
});
