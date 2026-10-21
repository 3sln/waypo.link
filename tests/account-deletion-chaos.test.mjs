// DX-3 seeded chaos tests (docs/architecture/account-deletion-export.md §8.3): a crash at every stage boundary with a
// restart, concurrent export and delete, a sign-in racing the deadline, a maintenance alarm racing execution, and the
// restore path racing the wipe. Rerun a failure with CHAOS_SEED=<seed>. Operations run through an app engine over the
// same DeletionService the account slice composes; stores are linearizable in-memory doubles of DO/SQLite metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed,createScheduler,fakeClock} from './helpers/chaos.mjs';
import {createAppEngine,perform} from '../packages/app/engine.mjs';
import {nullAudit} from '../packages/app/providers.mjs';
import {IdentityRepository} from '../packages/runtime/accounts.mjs';
import {lifecycleIdentityPort} from '../packages/identity/lifecycle-tombstone.mjs';
import {DeletionService,REQUEST_KEY,FENCE_KEY,deletionDueIndex,restoreDeletedAccount,deletionBlocksMaintenance} from '../packages/runtime/account-deletion.mjs';
import {PURGE_KEY,TOMBSTONE_KEY} from '../packages/runtime/lifecycle-storage.mjs';
import {RequestAccountDeletion,CancelAccountDeletion,StepAccountDeletion} from '../packages/app/domains/account-deletion.mjs';
import {key} from '../packages/core/records.mjs';

const DAY=86400000,OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',HANDLE='chaos.owner1234',EMAIL='owner@chaos.example';
const RUNS=Number(process.env.DELETION_CHAOS_RUNS??0);

// Linearizable metadata: serialized transactions with rollback, ordered paging, purgeAll like SqliteMetadata.
class MemoryMetadata{
 rows=new Map();queue=Promise.resolve();alarm=null;
 async get(name){return structuredClone(this.rows.get(name));}
 async put(name,value){if(typeof name==='object'){for(const [k,v]of Object.entries(name))this.rows.set(k,structuredClone(v));return;}this.rows.set(name,structuredClone(value));}
 async delete(names){for(const name of [names].flat())this.rows.delete(name);}
 async list({prefix='',startAfter='',limit=100000}={}){return new Map([...this.rows].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,limit).map(([k,v])=>[k,structuredClone(v)]));}
 async purgeAll({keep=[]}={}){for(const k of [...this.rows.keys()])if(!keep.includes(k))this.rows.delete(k);}
 async deleteAll(){this.rows.clear();}
 async getAlarm(){return this.alarm;}async setAlarm(time){this.alarm=time;}
 transaction(operation){const run=this.queue.then(async()=>{const before=new Map(this.rows);const tx={get:k=>this.get(k),put:(k,v)=>this.put(k,v),delete:k=>this.delete(k),list:o=>this.list(o)};try{return await operation(tx);}catch(error){this.rows=before;throw error;}});this.queue=run.catch(()=>{});return run;}
}
function memoryBucket(){const map=new Map();return {map,async get(name){const v=map.get(name);return v===undefined?null:{size:v.length,text:async()=>v,json:async()=>JSON.parse(v)};},async put(name,value){map.set(name,String(value));},async delete(names){for(const name of [names].flat())map.delete(name);}};}

// A process: everything the service touches goes through `crash.wrap`, so a crash point kills every later call
// until `restart()` builds a fresh service over the same durable stores.
function crashPlan({at=Infinity,mode='after'}={}){
 let n=0,dead=false;const MUTATING=new Set(['put','delete','transaction','purgeAll','deleteAll','compareAndSwap','tombstone','revokeAll','anonymize','eraseSubject','erase','deliver','cancelAtPeriodEnd']);
 const wrap=(object,label)=>new Proxy({},{get(_,name){const target=object,value=Reflect.get(target,name);if(typeof value!=='function'||typeof name==='symbol')return value;return async(...args)=>{if(dead)throw Object.assign(new Error('process crashed'),{code:'crashed'});if(!MUTATING.has(name))return value.apply(target,args);n++;if(n!==at)return value.apply(target,args);dead=true;if(mode==='after'){await value.apply(target,args);}throw Object.assign(new Error(`crash ${mode} ${label}.${String(name)} #${n}`),{code:'crashed'});};}});
 return {wrap,get calls(){return n;},get dead(){return dead;}};
}

async function world({seed=1,clock=fakeClock(),pushRows=true,messages=0,completion={accepted:true}}={}){
 const metadata=new MemoryMetadata(),idDb=new MemoryMetadata(),dueDb=new MemoryMetadata(),blobs=memoryBucket(),archives=memoryBucket();
 const repository=new IdentityRepository({metadata:idDb,config:{}});
 assert.equal(await repository.create({id:OWNER,handle:HANDLE,assignmentId:'assignment-1',status:'active',createdAt:clock.now()-DAY,revision:1,verifiedEmail:EMAIL,emailVerifiedAt:clock.now()-DAY,emailLoginEnabled:true,sessions:[{id:'s1'}],credentials:[{id:'c1'}],passwordHash:'hash',recoveryHash:'recovery',audit:[]}),true);
 await idDb.put(`email/${EMAIL}`,OWNER);
 await metadata.put('owner',OWNER);
 if(pushRows)await metadata.put(key('push-subscription',OWNER,'p1'),{id:'p1',owner:OWNER,endpoint:'https://push.example/p1',keys:{p256dh:'k',auth:'a'}});
 for(let i=0;i<40;i++){await metadata.put(`hosted-object/res/f${String(i).padStart(2,'0')}`,{blobRef:`objects/${OWNER}/res/v${i}`});await blobs.put(`objects/${OWNER}/res/v${i}`,'d');}
 for(let i=0;i<messages;i++){await metadata.put(`message/${OWNER}/m${String(i).padStart(2,'0')}`,{owner:OWNER,id:`m${i}`,blobRef:`messages/${OWNER}/m${i}`});await blobs.put(`messages/${OWNER}/m${i}`,'body');}
 await metadata.put('foreign-reference',{blobRef:`objects/${FOREIGN}/res/v1`});await blobs.put(`objects/${FOREIGN}/res/v1`,'other');
 await metadata.put('export/job/j1',{v:1,id:'j1',owner:OWNER,state:'ready',parts:[{key:`exports/${OWNER}/j1/pack.0000`}]});await archives.put(`exports/${OWNER}/j1/pack.0000`,'part');await metadata.put('export/active','j1');
 const calls={revokeAll:0,anonymize:0,federation:0,mcp:0,uncancel:0,cancelAtPeriodEnd:0};
 const flags={for:()=>({enabled:()=>true,background:()=>true,global:()=>true})};
 let ids=seed*1000;const random={uuid:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`,bytes:n=>Uint8Array.from({length:n},(_,i)=>(ids*31+i*7)&255)};
 /** A process over the durable stores, optionally crashing at one mutating call. */
 const process=(plan=crashPlan())=>{
  const w=plan.wrap,identityPort=lifecycleIdentityPort(w(repository,'identity'),{clock:clock.now});
  const ports={identity:w({get:owner=>identityPort.get(owner),tombstone:(owner,options)=>identityPort.tombstone(owner,options)},'identityPort'),security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),
   billing:w({async cancelAtPeriodEnd(){calls.cancelAtPeriodEnd++;return {set:[{subscriptionId:'sub_1',canceledAt:'2026-10-14T12:00:00Z'}]};},async uncancel(owner,set){calls.uncancel++;return {restored:set.map(s=>s.subscriptionId),unrestored:[]};},async revokeAll(){calls.revokeAll++;return {revoked:['sub_1']};},async anonymize(){calls.anonymize++;return {anonymized:true};}},'billing'),
   notices:w({async deliver(input){return {accepted:input.kind!=='completed'||completion.accepted};}},'notices'),
   erasure:{federation:w({async eraseSubject(){calls.federation++;return {};}},'federation'),mcp:w({async eraseSubject(){calls.mcp++;return {};}},'mcp'),emailBridge:null,operatorApps:null},
   due:w(deletionDueIndex(dueDb),'due'),
   exports:w({async cancelAll(){for(const [path,job]of await metadata.list({prefix:'export/job/'})){for(const part of job.parts??[])await archives.delete(part.key);await metadata.delete(path);}await metadata.delete('export/active');return {done:true};}},'exports')};
  const executor={metadata:w(metadata,'metadata'),blobs:w(blobs,'blobs'),archives:w(archives,'archives'),config:{}};
  const service=new DeletionService({executor,ports,flags,clock,random,budget:8});
  const engine=createAppEngine({providers:{clock,random,audit:nullAudit,lifecycle:service}});
  return {plan,service,engine,ports,executor,
   request:()=>perform(engine,new RequestAccountDeletion({actor:{kind:'owner',owner:OWNER,stepUpAt:clock.now()-1000},input:{confirmHandle:HANDLE,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-chaos-0123456789'}})),
   cancel:()=>perform(engine,new CancelAccountDeletion({actor:{kind:'owner',owner:OWNER}})),
   step:()=>perform(engine,new StepAccountDeletion({actor:{kind:'system',owner:OWNER,reason:'chaos'}}))};
 };
 /** Steps a healthy process to completion, jumping the clock to each wake. */
 async function converge(p=process(),limit=600){for(let i=0;i<limit;i++){const out=await p.step();if(out.action==='deleted')return out;if(Number.isSafeInteger(out.wakeAt)&&out.wakeAt>clock.now())clock.set(out.wakeAt);}throw new Error('deletion did not converge');}
 async function invariants(){
  assert.deepEqual([...metadata.rows.keys()].sort(),[TOMBSTONE_KEY,'owner'],'only owner and the tombstone remain');
  assert.equal((await metadata.get(TOMBSTONE_KEY)).owner,OWNER);
  const account=await repository.get(OWNER);
  assert.equal(account.status,'deleted');assert.equal(account.handle,HANDLE);assert.equal(account.assignmentId,'assignment-1');assert.equal(account.id,OWNER);assert.deepEqual(account.sessions,[]);assert.deepEqual(account.credentials,[]);
  // The handle cannot be claimed again; the address can be verified by another account.
  assert.equal(await repository.create({id:FOREIGN,handle:HANDLE,assignmentId:'other',status:'active',revision:1,audit:[]}),false);
  assert.equal(await repository.create({id:FOREIGN,handle:'someone.else1',assignmentId:'other',status:'active',revision:1,audit:[]}),true);
  const other=await repository.get(FOREIGN);assert.equal(await repository.compareAndSwap(FOREIGN,1,{...other,verifiedEmail:EMAIL,emailVerifiedAt:clock.now(),revision:2}),true);
  assert.equal([...blobs.map.keys()].some(k=>k.startsWith(`objects/${OWNER}/`)||k.startsWith(`messages/${OWNER}/`)),false,'no owned blob remains');
  assert.equal(blobs.map.get(`objects/${FOREIGN}/res/v1`),'other','foreign refs are untouched');
  assert.equal([...archives.map.keys()].some(k=>k.startsWith('exports/')||k.startsWith('accounts/')),false,'no export part or archive envelope remains');
  assert(calls.revokeAll>=1);assert(calls.federation>=1&&calls.mcp>=1);
  assert.equal([...dueDb.rows.keys()].length,0,'the due index row is removed');
 }
 return {metadata,idDb,dueDb,blobs,archives,repository,clock,calls,process,converge,invariants};
}

test('crash at every mutating call from the deadline commit to the wipe, then restart, converges to a complete deletion',async()=>{
 // A clean run counts the mutating calls; then each one becomes a crash point (effect committed, reply lost).
 const clean=await world();const counter=crashPlan();await clean.process().request();clean.clock.set((await clean.metadata.get(REQUEST_KEY)).executeAfter);
 const counted=clean.process(counter);await clean.converge(counted);await clean.invariants();const total=counter.calls;assert(total>40,`expected many crash points, got ${total}`);
 for(const mode of ['after','throw'])for(let at=1;at<=total;at++){
  const w=await world();await w.process().request();w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);
  const crashing=w.process(crashPlan({at,mode}));
  try{for(let i=0;i<600&&!crashing.plan.dead;i++){const out=await crashing.step();if(out.action==='deleted')break;if(Number.isSafeInteger(out.wakeAt)&&out.wakeAt>w.clock.now())w.clock.set(out.wakeAt);}}catch(error){if(error.code!=='crashed')throw error;}
  try{await w.converge();await w.invariants();}catch(error){throw new Error(`crash ${mode} at mutating call ${at}/${total}: ${error.message.split('\n')[0]}`,{cause:error});}
 }
});

test('seeded crashes anywhere from the request through the wipe, including inside E2, with repeated restarts',async()=>{
 await forEachSeed(RUNS||40,async random=>{
  const w=await world({seed:random.seed});let requested=false;
  for(let restart=0;restart<4;restart++){
   const p=w.process(crashPlan({at:1+random.int(60),mode:random.pick(['after','throw'])}));
   try{
    if(!requested){await p.request();requested=true;w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);}
    for(let i=0;i<600;i++){const out=await p.step();if(out.action==='deleted')break;if(Number.isSafeInteger(out.wakeAt)&&out.wakeAt>w.clock.now())w.clock.set(out.wakeAt);}
   }catch(error){if(error.code!=='crashed')throw error;}
   if(!requested&&!(await w.metadata.get(REQUEST_KEY))){continue;}requested=true;
   if((await w.metadata.get(REQUEST_KEY))?.state==='scheduled'&&w.clock.now()<(await w.metadata.get(REQUEST_KEY)).executeAfter)w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);
  }
  if(!(await w.metadata.get(REQUEST_KEY))&&!(await w.metadata.get(TOMBSTONE_KEY))){await w.process().request();w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);}
  await w.converge();await w.invariants();
 });
});

test('concurrent export and delete: no export part survives, and cancelling deletion leaves a ready export intact',async()=>{
 await forEachSeed(RUNS||60,async random=>{
  const w=await world({seed:random.seed}),scheduler=createScheduler(random);
  await w.process().request();w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);
  const metadata=scheduler.wrap(w.metadata,'metadata'),archives=scheduler.wrap(w.archives,'archives');
  // The DX-1 generation contract this relies on (§1.4, R1-H3): a step never runs while a fence or purge job
  // exists, R2 parts are written outside the transaction, and a cursor commit that finds a fence or purge job
  // deletes the part it just wrote instead of recording it.
  const exportStep=async n=>{
   if(await metadata.get(FENCE_KEY)!==undefined||await metadata.get(PURGE_KEY)!==undefined)return 'refused';
   const part=`exports/${OWNER}/j2/account.${String(n).padStart(4,'0')}`;await archives.put(part,'jsonl');
   const recorded=await metadata.transaction(async tx=>{if(await tx.get(FENCE_KEY)!==undefined||await tx.get(PURGE_KEY)!==undefined)return false;const job=await tx.get('export/job/j2')??{v:1,id:'j2',owner:OWNER,state:'generating',parts:[]};job.parts.push({key:part});await tx.put('export/job/j2',job);await tx.put('export/active','j2');return true;});
   if(!recorded)await archives.delete(part);return recorded?'recorded':'discarded';
  };
  const p=w.process();
  const deleting=async()=>{for(let i=0;i<4;i++){const out=await p.step();if(out.action==='deleted')return;}};
  // The deletion executor runs over the same scheduled stores.
  p.executor.metadata=metadata;p.executor.archives=archives;
  await scheduler.run([()=>exportStep(1),()=>exportStep(2),deleting,()=>exportStep(3)]);
  await w.converge();await w.invariants();
  assert.equal(await w.metadata.get('export/active'),undefined);
 });
 const kept=await world();const p=kept.process();await p.request();await p.cancel();
 assert.equal(kept.archives.map.has(`exports/${OWNER}/j1/pack.0000`),true);assert.equal((await kept.metadata.get('export/job/j1')).state,'ready');assert.equal(await kept.metadata.get('export/active'),'j1');
});

test('sign-in racing the deadline: exactly one of cancel and commit wins; a window session dies at E2',async()=>{
 const tally={cancelled:0,executing:0};
 await forEachSeed(RUNS||1000,async random=>{
  const w=await world({seed:random.seed,pushRows:false}),scheduler=createScheduler(random);
  const healthy=w.process();await healthy.request();w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);
  const p=w.process();p.executor.metadata=scheduler.wrap(w.metadata,'account');p.service.executor=p.executor;
  const repository=scheduler.wrap(w.repository,'identity');
  const signIn=async()=>{for(;;){const account=await repository.get(OWNER);if(account.status==='deleted')return 'refused';if(await repository.compareAndSwap(OWNER,account.revision,{...account,sessions:[...account.sessions,{id:'window'}],revision:account.revision+1}))return 'signed-in';}};
  const [cancel,commit]=await scheduler.run([()=>p.cancel(),()=>p.step(),signIn]);
  const state=(await w.metadata.get(REQUEST_KEY)).state;
  if(state==='cancelled'){
   tally.cancelled++;assert.equal(cancel.status,'fulfilled');assert.notEqual(commit.value?.action,'committed');
   assert.equal(await w.metadata.get(FENCE_KEY),undefined);assert.equal(w.calls.revokeAll,0);assert.equal(w.calls.uncancel,1,'our cancel_at_period_end is undone');
   assert.equal((await w.repository.get(OWNER)).status,'active');assert.equal(w.blobs.map.size,41);
   assert.equal((await w.process().step()).action,'cancelled','a later tick never resumes a cancelled request');
  }else{
   tally.executing++;assert.equal(state,'executing');assert.equal(commit.value.action,'committed');
   assert.equal(cancel.status,'rejected');assert.equal(cancel.reason.code,'deletion_in_progress');assert.equal(cancel.reason.status,410);
   assert.notEqual(await w.metadata.get(FENCE_KEY),undefined,'every account operation now answers 410');
   await w.converge();await w.invariants();
  }
 });
 assert(tally.cancelled>0&&tally.executing>0,`both outcomes must occur across seeds: ${JSON.stringify(tally)}`);
});

test('maintenance racing the deadline: guarded shelving refuses while scheduled; forced shelving during execution never strands a blob',async()=>{
 await forEachSeed(RUNS||80,async random=>{
  const w=await world({seed:random.seed,messages:12});
  // The guarded alarm path (coordinator hunk): shelving and semantic backfill refuse while a request is scheduled.
  const guardedShelve=async()=>await deletionBlocksMaintenance(w.metadata)?'refused':'shelved';
  const p=w.process();await p.request();
  assert.equal(await guardedShelve(),'refused');
  w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);
  // Unguarded shelving (a pre-hunk alarm, or a race) at a seeded step boundary during execution.
  const shelveAt=random.int(30);let shelved=false;
  const shelve=async()=>{
   const rows=[...await w.metadata.list({prefix:`message/${OWNER}/`})];if(!rows.length||await w.metadata.get('shelved'))return;
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows))))].map(b=>b.toString(16).padStart(2,'0')).join('');
   await w.archives.put(`accounts/${OWNER}.json`,JSON.stringify({version:1,owner:OWNER,rows,digest}));await w.metadata.delete(rows.map(([k])=>k));await w.metadata.put('shelved',true);shelved=true;
  };
  for(let i=0;i<600;i++){if(i===shelveAt&&!await w.metadata.get(TOMBSTONE_KEY))await shelve();const out=await p.step();if(out.action==='deleted')break;if(Number.isSafeInteger(out.wakeAt)&&out.wakeAt>w.clock.now())w.clock.set(out.wakeAt);}
  await w.invariants();
  if(shelved)assert.equal([...w.blobs.map.keys()].some(k=>k.startsWith(`messages/${OWNER}/`)),false);
 });
});

test('restore racing the wipe (Worker deleteAll path): the object always ends with exactly owner and a tombstone',async()=>{
 await forEachSeed(RUNS||80,async random=>{
  const completion={accepted:false},w=await world({seed:random.seed,completion}),scheduler=createScheduler(random);
  const p=w.process();await p.request();w.clock.set((await w.metadata.get(REQUEST_KEY)).executeAfter);
  // Park the job at E10 (the completion notice is retried), the stage right before the wipe.
  for(let i=0;i<600;i++){const job=await w.metadata.get(PURGE_KEY);if(job?.stage==='notice'&&job.hooks?.notice?.attempts)break;const out=await p.step();if(Number.isSafeInteger(out.wakeAt)&&out.wakeAt>w.clock.now())w.clock.set(out.wakeAt);}
  assert.equal((await w.metadata.get(PURGE_KEY)).stage,'notice');completion.accepted=true;w.clock.advance(DAY);
  // No purgeAll: the Worker branch issues deleteAll() and the tombstone put concurrently.
  const scheduled=scheduler.wrap(w.metadata,'account'),noPurgeAll=new Proxy(scheduled,{get:(target,name)=>name==='purgeAll'?undefined:target[name]});
  p.executor.metadata=noPurgeAll;
  const identity=lifecycleIdentityPort(w.repository,{clock:w.clock.now}),c={metadata:scheduled};
  const results=await scheduler.run([()=>p.step(),()=>restoreDeletedAccount(c,OWNER,identity),()=>restoreDeletedAccount(c,OWNER,identity)]);
  assert.equal(results[0].status,'fulfilled',String(results[0].reason?.stack));
  assert.deepEqual([...w.metadata.rows.keys()].sort(),[TOMBSTONE_KEY,'owner']);
  const tombstone=await w.metadata.get(TOMBSTONE_KEY);assert.equal(tombstone.owner,OWNER);assert(['owner'].includes(tombstone.reason));
 });
});
