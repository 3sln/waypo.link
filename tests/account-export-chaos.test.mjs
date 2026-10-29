// DX-1 contention/restart tests. DX-2 owns physical garbage collection and the
// HTTP stream; the fence transaction below is the agreed DX-3/E6 boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {forEachSeed,createScheduler,injectFaults,fakeClock} from './helpers/chaos.mjs';
import {CreateExport,StepExport,CancelExport,ExportStatus} from '../packages/app/domains/account-export.mjs';
import {createExportDigest} from '../packages/runtime/export-generation.mjs';
const OP='00000000-0000-4000-8000-000000000001';
const encoder=new TextEncoder();
function bucket(){const rows=new Map();return {rows,async put(key,bytes){rows.set(key,new Uint8Array(bytes));},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])rows.delete(key);},async get(key,{range}={}){const bytes=rows.get(key);return bytes?{size:bytes.length,body:new Blob([range?bytes.slice(range.offset,range.offset+range.length):bytes]).stream(),arrayBuffer:async()=>bytes.slice().buffer,text:async()=>new TextDecoder().decode(bytes)}:null;}};}
async function fixture(t,{seed=1,db=':memory:',clock=fakeClock(),archives=bucket(),blobs=bucket(),decorateStore,decorateArchives}={}){
 let store;const f=await createTestEngine({db,seed,clock,wrap:{accountStore:s=>store=decorateStore?decorateStore(s):s},providers:{archives:decorateArchives?decorateArchives(archives):archives,blobs},config:{APP_ORIGIN:'https://issuer.example',ACCOUNT_EXPORT_ENABLED:'true',exportPorts:{identitySecurity:async()=>({epoch:0,changedAt:0}),digest:createExportDigest(),quota:async()=>1000000,notice:async()=>{},contributors:[{name:'messages',version:1,async page({cursor=0}){const at=cursor??0,ids=[at,at+1];return {rows:ids.map(id=>({id:'m'+id})),payloads:ids.map(id=>({entryId:'m'+id,path:`data/messages/m${id}/0.bin`,kind:'message',source:{message:'m'+id,part:0},ref:`messages/${OWNER}/m${id}`,size:5})),cursor:at+2,done:at>=4};}}]}}});
 if(!await f.metadata.get('owner'))await f.metadata.put('owner',OWNER);for(let id=0;id<6;id++)await blobs.put(`messages/${OWNER}/m${id}`,encoder.encode('hello'));
 t.after(()=>f.dispose());const owner={kind:'owner',owner:OWNER,sessionId:'s1',stepUpAt:clock.now(),stepUpMethod:'passkey'},system={kind:'system',owner:OWNER};
 const create=()=>f.perform(new CreateExport({actor:owner,input:{operationId:OP}})),step=()=>f.perform(new StepExport({actor:system})),status=id=>f.read(new ExportStatus({actor:owner,id})),cancel=id=>f.perform(new CancelExport({actor:system,id}));
 async function converge(){let job;for(let attempts=0;attempts<100;attempts++)try{job??=await create();if((await status(job.id)).state==='ready')return f.metadata.get('export/job/'+job.id);const result=await step();if(result.wakeAt&&result.wakeAt>clock.now()+2000)clock.set(result.wakeAt+1);}catch(error){if(error.code!=='injected_fault')throw error;}assert.fail('Export did not converge after injected failures');}
 return {...f,store,archives,blobs,create,step,status,cancel,converge,clock};
}
async function assertComplete(f,job){
 assert.equal(job.state,'ready');assert.equal(job.payloads.count,6);const parts=job.parts.filter(p=>p.path.startsWith('account/')),text=(await Promise.all(parts.map(p=>f.archives.get(p.key).then(o=>o.text())))).join('');
 assert.deepEqual(text.trim().split('\n').map(JSON.parse).map(row=>row.id),['m0','m1','m2','m3','m4','m5']);
 const index=(await Promise.all(job.parts.filter(p=>p.path.startsWith('payloads/')).map(p=>f.archives.get(p.key).then(o=>o.text())))).join('').trim().split('\n').map(JSON.parse);assert.equal(new Set(index.map(row=>row.path)).size,6);assert.ok(index.every(row=>row.volume===2));
 for(const part of job.parts)assert.equal(await createExportDigest().sha256(f.archives.rows.get(part.key)),part.sha256);
 assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,6);
}

test('every account transaction boundary survives an after-commit fault without duplicate or missing rows',async t=>{
 let recorder;const baseline=await fixture(t,{decorateStore:s=>recorder=injectFaults(s,[])});await baseline.converge();const boundaries=recorder.calls.filter(c=>c.method==='transaction').length;
 await forEachSeed(boundaries,async random=>{const boundary=1+(random.seed-1)%boundaries,f=await fixture(t,{seed:random.seed,decorateStore:s=>injectFaults(s,[{method:'transaction',when:boundary,mode:'after'}])});try{const job=await f.converge();await assertComplete(f,job);}finally{await f.dispose();}},{base:Number(process.env.CHAOS_SEED??1)});
 t.diagnostic(`Injected a durable after-commit fault at each of ${boundaries} account transaction boundaries.`);
});

test('every put boundary overwrites an orphan deterministically and preserves cursor consistency',async t=>{
 let recorder;const baseline=await fixture(t,{decorateArchives:s=>recorder=injectFaults(s,[])});await baseline.converge();const boundaries=recorder.calls.filter(c=>c.method==='put').length;
 await forEachSeed(boundaries,async random=>{const f=await fixture(t,{seed:random.seed,decorateArchives:s=>injectFaults(s,[{method:'put',when:1+(random.seed-1)%boundaries,mode:'after'}])});try{const job=await f.converge();await assertComplete(f,job);assert.ok([...f.archives.rows.keys()].every(key=>job.keys.includes(key)));}finally{await f.dispose();}});
});

test('a process restart after a committed put and lost transaction reply uses durable cursors and exact-key cleanup',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'dx1-export-'));t.after(()=>rm(directory,{recursive:true,force:true}));const db=join(directory,'account.sqlite'),archives=bucket(),blobs=bucket(),clock=fakeClock();let log;
 const first=await fixture(t,{db,archives,blobs,clock,decorateStore:s=>log=injectFaults(s,[{method:'transaction',when:6,mode:'after'}])});const job=await first.create();await assert.rejects(first.step(),{code:'injected_fault'});assert.ok(log.calls.some(c=>c.fault==='after'));await first.dispose();clock.advance(61000);
 const restarted=await fixture(t,{db,archives,blobs,clock});const ready=await restarted.converge();assert.equal(ready.id,job.id);await assertComplete(restarted,ready);await restarted.cancel(job.id);assert.equal(archives.rows.size,0);assert.equal(await restarted.metadata.get('export/active'),undefined);
});

test('seeded generation, cancellation and deletion-fence races leave no object, active job or pin',async t=>{
 await forEachSeed(80,async random=>{
  const scheduler=createScheduler(random),f=await fixture(t,{seed:random.seed,decorateStore:s=>scheduler.wrap(s,'accountStore'),decorateArchives:s=>scheduler.wrap(s,'archives')}),job=await f.create();
  await f.step();const outcomes=await scheduler.run([()=>f.step(),async()=>{await f.store.transaction(tx=>tx.put('deletion/fence-v1',{owner:OWNER}));return f.cancel(job.id);},()=>f.cancel(job.id)]);
  for(const result of outcomes)if(result.status==='rejected')assert.ok(['account_deleting','export_stale'].includes(result.reason.code),String(result.reason));
  await f.cancel(job.id);assert.equal(f.archives.rows.size,0);assert.equal(await f.metadata.get('export/active'),undefined);assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,0);
  await assert.rejects(f.create(),{code:'account_deleting'});await f.dispose();
 });
});

test('seeded simultaneous generation steps are single-writer and deterministic',async t=>{
 await forEachSeed(40,async random=>{const scheduler=createScheduler(random),f=await fixture(t,{seed:random.seed,decorateStore:s=>scheduler.wrap(s,'accountStore'),decorateArchives:s=>scheduler.wrap(s,'archives')});await f.create();const results=await scheduler.run([()=>f.step(),()=>f.step(),()=>f.step()]);assert.ok(results.every(r=>r.status==='fulfilled'));const job=await f.converge();await assertComplete(f,job);await f.dispose();});
});

test('a delayed writer whose lease expired cannot overwrite or delete a successor generation',async t=>{
 let entered,release,held=false;const enteredPromise=new Promise(resolve=>entered=resolve),heldPromise=new Promise(resolve=>release=resolve);
 const f=await fixture(t,{decorateArchives:bucket=>({...bucket,async put(key,bytes){if(!held){held=true;entered();await heldPromise;}return bucket.put(key,bytes);}})});await f.create();const delayed=f.step();await enteredPromise;f.clock.advance(61001);
 const job=await f.converge();assert.equal(job.writeEpoch,1);release();await delayed;await assertComplete(f,await f.metadata.get('export/job/'+job.id));await f.cancel(job.id);assert.equal(f.archives.rows.size,0);
});
