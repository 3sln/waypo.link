// FF-2 provider under real ngin Actions/Queries with deterministic storage
// interleavings. FF-3 owns the public domain, so wrappers here are test-local.
import test from 'node:test';import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/index.js';
import {AppAction,AppQuery,perform,read} from '../packages/app/engine.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {AdminStorage} from '../packages/identity/admin-store.mjs';
import {FlagService} from '../packages/flags/service.mjs';
import {createScheduler,forEachSeed,fakeClock} from './helpers/chaos.mjs';
class FlagAction extends AppAction {static deps=['flags'];run({flags}){return flags[this.input.method](this.input.value,this.actor);}}
class FlagQuery extends AppQuery {static deps=['flags'];fetch({flags}){return flags[this.input.method](this.input.value,this.actor);}}
const start=1792000000000,beam='BEAM_ENABLED',search='SEMANTIC_SEARCH_ENABLED',activity='ACTIVITY_V2_ENABLED',names=[beam,search,activity];
const draft=()=>({id:'00000000-0000-4000-8000-000000000010',status:'draft',variants:[{key:'control',weight:5000},{key:'treatment',weight:5000}],eligibility:{percent:10000},variantSalt:'draft-salt'});
function fixture(random){
 const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw),clock=fakeClock(start),scheduler=createScheduler(random),snapshots=[],commits=[];
 const tracked={get:key=>storage.get(key),flagsSnapshot:async()=>{const value=await storage.flagsSnapshot();snapshots.push(structuredClone(value));return value;},commit:async input=>{const result=await storage.commit(input);if(result.committed)commits.push(result.audit);return result;}};
 let seq=1;const flags=new FlagService({store:scheduler.wrap(tracked,'flags-store'),env:{RELEASE_READY:'true'},clock:clock.now,randomId:()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`}),engine=new Engine({providers:{flags:Provider.fromSingleton(flags)}}),context={actor:{kind:'boot',expect:{'boot/principal':null}},stepUpAt:start,stepUpMethod:'passkey'};
 const query=(method,value={})=>read(engine,new FlagQuery({actor:context,input:{method,value}})),action=(method,value)=>perform(engine,new FlagAction({actor:context,input:{method,value}}));
 const prepare=async(method,name,extra={})=>{const {record,version}=await query('get',{name}),input={name,expectedRevision:record?.rev??null,expectedVersion:version,...extra},preview=await query('preview',{...input,action:method.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())});return {...input,typedName:name,reason:'Seeded concurrency exercise.',previewDigest:preview.digest,acknowledgeGates:preview.requiredGates};};
 const change=async(method,name,extra={})=>action(method,await prepare(method,name,extra));
 const edit=async(name,patch)=>{const {record}=await query('get',{name});return change('update',name,{record:{...record,...patch}});};
 return {raw,storage,flags,scheduler,query,action,prepare,change,edit,snapshots,commits,close:()=>raw.close()};
}
const retry=async fn=>{for(let attempt=0;;attempt++)try{return await fn();}catch(error){if(!['conflict','preview_stale'].includes(error.code)||attempt>=30)throw error;}};
const errors=results=>results.filter(r=>r.status==='rejected').map(r=>r.reason?.code);
async function invariant(f){
 const audit=(await f.storage.list('audit/',{limit:100})).map(row=>row.value),last=await f.flags.snapshot();assert.deepEqual(await f.storage.verifyAudit(),{valid:true,seq:audit.length});assert.deepEqual(audit.map(r=>r.seq),audit.map((_,i)=>i+1));assert.deepEqual(audit.map(r=>r.version),audit.map((_,i)=>i+1));assert.equal(last.version,audit.length);
 // Every read is exactly a committed prefix: no mixed flags/head or skipped
 // revisions. History and the current record account for every successful edit.
 const prefix=new Map([[0,{}]]),state={};for(const entry of audit){assert.deepEqual(entry.before,state[entry.target]??null);state[entry.target]=entry.after;prefix.set(entry.version,structuredClone(state));}
 for(const [i,snapshot]of f.snapshots.entries()){assert.deepEqual(snapshot.flags,prefix.get(snapshot.version),`snapshot version ${snapshot.version} is a committed prefix`);if(i)assert(snapshot.version>=f.snapshots[i-1].version,'observed snapshot versions never decrease');}
 for(const name of names){const {entries}=await f.query('history',{name}),changes=audit.filter(row=>row.target===name);assert.deepEqual(entries.map(row=>row.record),changes.map(row=>row.after).reverse());}
 assert.deepEqual(last.flags,state);assert.equal(f.commits.length,audit.length);return audit;
}

test('seeded concurrent edits: same/different flags, stale CAS losers, snapshot prefixes and complete audit history',async()=>{
 await forEachSeed(16,async random=>{const f=fixture(random);try{
  for(const name of names)await f.change('seed',name);
  const blind=await Promise.all([beam,beam,search,activity].map(async(name,i)=>{const {record}=await f.query('get',{name});return {name,input:await f.prepare('update',name,{record:{...record,on:true,fallthrough:Boolean(i%2)}})};}));
  const outcomes=await f.scheduler.run([...blind.map(({input})=>()=>f.action('update',input)),...Array.from({length:3},()=>()=>f.query('snapshot'))]);assert.equal(outcomes.slice(0,blind.length).filter(r=>r.status==='fulfilled').length,1);assert(errors(outcomes).every(code=>code==='conflict'),errors(outcomes).join());
  const work=Array.from({length:7},(_,i)=>()=>retry(()=>f.edit(names[i%names.length],{on:Boolean(i%2),fallthrough:Boolean((i+1)%2)}))),settled=await f.scheduler.run([...work,()=>f.query('snapshot'),()=>f.query('snapshot')]);assert(settled.every(r=>r.status==='fulfilled'),errors(settled).join());await invariant(f);
 }finally{f.close();}});
});

test('seeded rollback racing update creates exactly one new head; retries append a fresh rollback revision',async()=>{
 await forEachSeed(16,async random=>{const f=fixture(random);try{
  await f.change('seed',beam);await f.edit(beam,{on:true,fallthrough:true});const {record}=await f.query('get',{name:beam}),rollback=await f.prepare('rollback',beam,{revision:1}),update=await f.prepare('update',beam,{record:{...record,fallthrough:false}}),results=await f.scheduler.run([()=>f.action('rollback',rollback),()=>f.action('update',update),()=>f.query('snapshot')]);
  assert.equal(results.slice(0,2).filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(errors(results),['conflict']);assert.equal((await f.flags.snapshot()).version,3);
  await f.change('rollback',beam,{revision:1});const rows=await invariant(f);assert.equal(rows.at(-1).rollbackRevision,1);assert.equal(rows.at(-1).after.rev,4);assert.equal(rows.at(-1).after.on,false);
 }finally{f.close();}});
});

test('seeded experiment start racing conclude cannot skip states or mix cohort assignments',async()=>{
 await forEachSeed(16,async random=>{const f=fixture(random);try{
  await f.change('seed',beam);await f.edit(beam,{on:true,experiment:draft()});
  // Starting a draft and concluding it are independent requests. Conclude must
  // refuse in every schedule; after start, its old expected revision is stale.
  const input=await f.prepare('experimentStart',beam),conclude={...input,winner:'treatment'},results=await f.scheduler.run([()=>f.action('experimentStart',input),()=>f.action('experimentConclude',conclude),()=>f.query('snapshot')]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert(['invalid_state','conflict'].includes(results[1].reason.code));
  const running=(await f.query('get',{name:beam})).record.experiment;await f.change('experimentStop',beam);const old=await f.query('get',{name:beam}),finish=await f.prepare('experimentConclude',beam,{winner:'treatment'}),restart={...finish};delete restart.winner;
  const stopped=await f.scheduler.run([()=>f.action('experimentStart',restart),()=>f.action('experimentConclude',finish)]);assert.equal(stopped[0].status,'rejected');assert(['invalid_state','conflict'].includes(stopped[0].reason.code));assert.equal(stopped[1].status,'fulfilled');
  const after=(await f.query('get',{name:beam})).record.experiment;assert.equal(after.id,running.id);assert.equal(after.variantSalt,running.variantSalt);assert.deepEqual(after.variants,running.variants);assert.equal(old.record.experiment.status,'stopped');assert.equal(after.status,'concluded');await invariant(f);
 }finally{f.close();}});
});

test('seeded starts/stops on different experiments preserve lifecycle metadata and the audit chain',async()=>{
 await forEachSeed(12,async random=>{const f=fixture(random);try{
  for(const name of names){await f.change('seed',name);await f.edit(name,{on:true,experiment:draft()});}
  let settled=await f.scheduler.run(names.map(name=>()=>retry(()=>f.change('experimentStart',name))));assert(settled.every(r=>r.status==='fulfilled'),errors(settled).join());assert.equal(Object.values((await f.flags.snapshot()).flags).filter(r=>r.experiment?.status==='running').length,3);
  settled=await f.scheduler.run(random.shuffle(names).map(name=>()=>retry(async()=>{const {record}=await f.query('get',{name});return f.change(record.experiment.status==='running'?'experimentStop':'experimentConclude',name,record.experiment.status==='running'?{}:{winner:'control'});})));assert(settled.every(r=>r.status==='fulfilled'),errors(settled).join());
  settled=await f.scheduler.run(names.map(name=>()=>retry(()=>f.change('experimentConclude',name,{winner:'control'}))));assert(settled.every(r=>r.status==='fulfilled'),errors(settled).join());const snapshot=await f.flags.snapshot();for(const [name,record]of Object.entries(snapshot.flags)){const metadata=await f.storage.get('flag-experiment/'+record.experiment.id);assert.equal(metadata.name,name);assert.deepEqual(metadata.experiment,record.experiment);assert.equal(metadata.experiment.status,'concluded');}await invariant(f);
 }finally{f.close();}});
});
