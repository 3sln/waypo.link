// DX-9 ownership: engine hooks plus the optional CLI on a loopback Node adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,open,symlink,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {setDefaultResultOrder} from 'node:dns';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
import {fakeClock,forEachSeed,createScheduler,injectFaults} from './helpers/chaos.mjs';
import {AppAction} from '../packages/app/engine.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {CreateExportWithHooks,OfferOverQuotaExport,OverQuotaExportEvidence,claimOverQuotaExport,OVER_QUOTA_EPISODE,OVER_QUOTA_NOTICE_MS} from '../packages/runtime/export-hooks.mjs';
import {downloadBindleExport,nodeExportDownloadPorts,inspectTar} from '../scripts/bindle-export.mjs';
import {createNodeServer} from '../apps/node/server.mjs';
import {key} from '../packages/core/records.mjs';
import {CancelExport,StepExport,ExportStatus} from '../packages/app/domains/account-export.mjs';
import {createExportDigest} from '../packages/runtime/export-generation.mjs';
import {tarHeader,concatBytes} from '../packages/runtime/export-tar.mjs';
// Match the fixture's explicit IPv4 listener in both this process and CLI children; localhost may resolve to ::1.
// Bound tests and child lifetimes so a failed network/cleanup path cannot hang the suite indefinitely.
setDefaultResultOrder('ipv4first');
const IPV4_FIRST='--dns-result-order=ipv4first',NODE_TEST={timeout:180000},CLI_TIMEOUT_MS=120000,ALARM_BOUND=1000;
const EP='00000000-0000-4000-8000-000000000001',JOB='00000000-0000-4000-8000-000000000002',JOB2='00000000-0000-4000-8000-000000000003',DAY=86400000;
class Claim extends AppAction {static deps=['accountStore','clock'];static operation='test.claim-over-quota';run({accountStore,clock}){return accountStore.transaction(tx=>claimOverQuotaExport(tx,{owner:this.actor.owner,episodeId:EP,jobId:this.id,now:clock.now()}));}}
async function fixture(t,{seed,wrap={},faults={}}={}){
 const rows=new Map(),archives={async put(k,v){rows.set(k,new Uint8Array(v));},async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])rows.delete(k);},async get(k){const b=rows.get(k);return b?{size:b.length,body:new Blob([b]).stream(),arrayBuffer:async()=>b.slice().buffer}:null;}},ports={identitySecurity:async()=>({epoch:0,changedAt:0}),notice:async()=>{},digest:createExportDigest(),quota:async()=>10**9,contributors:[{name:'identity',version:1,page:async()=>({rows:[{id:OWNER}],done:true})}]};
 const clock=fakeClock(),env={ACCOUNT_EXPORT_ENABLED:'true'},flags={for:ctx=>createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env,clock:clock.now}).for(ctx)},f=await createTestEngine({clock,seed,wrap,faults,providers:{flags,archives,blobs:archives},config:{APP_ORIGIN:'https://account.example',exportPorts:ports}});t?.after(()=>f.dispose());await f.metadata.put('owner',OWNER);
 const episode={v:1,id:EP,owner:OWNER,revision:1,state:'grace',effectiveAt:clock.now()-DAY,deadlineAt:clock.now()+29*DAY,quotaBytes:10,usageBytes:20};await f.metadata.put(OVER_QUOTA_EPISODE,episode);
 const system={kind:'system',owner:OWNER},owner={kind:'owner',owner:OWNER,sessionId:'s1',stepUpAt:clock.now()},offer=(input={episodeId:EP,expectedRevision:1},actor=system)=>f.perform(new OfferOverQuotaExport({actor,input})),evidence=()=>f.read(new OverQuotaExportEvidence({actor:owner})),claim=(id=JOB)=>f.perform(new Claim({actor:owner,id}));const create=(operationId=JOB,purpose='over-quota',episodeId=EP,actor=owner)=>f.perform(new CreateExportWithHooks({actor,input:{operationId,purpose,...purpose==='over-quota'?{episodeId}:{}}})),cancel=id=>f.perform(new CancelExport({actor:owner,id}));return {...f,clock,env,ports,episode,system,owner,offer,evidence,claim,create,cancel};
}
test('over-quota offer is flag gated, account bound, system only and does not assert delivered notice or enable removal',NODE_TEST,async t=>{
 const f=await fixture(t);await assert.rejects(f.offer(undefined,f.owner),{code:'unauthorized'});await assert.rejects(f.offer(undefined,{kind:'system',owner:OTHER}),{code:'forbidden'});delete f.env.ACCOUNT_EXPORT_ENABLED;await assert.rejects(f.offer(),{code:'not_found'});f.env.ACCOUNT_EXPORT_ENABLED='true';
 const offer=await f.offer();assert.equal(offer.at,f.clock.now());assert.equal(offer.href,`/console?account=${OWNER}&view=account-data`);const state=await f.evidence();assert.equal(state.removalEnabled,false);assert.equal(state.offerWindowElapsed,false);assert.equal(state.episode.deadlineAt,offer.at+OVER_QUOTA_NOTICE_MS);assert.equal(state.episode.notice,undefined);assert.equal(state.episode.exportOffered.jobId,undefined);
 f.clock.advance(DAY);assert.deepEqual(await f.offer(),offer);assert.equal((await f.evidence()).episode.deadlineAt,state.episode.deadlineAt);f.clock.advance(29*DAY);assert.equal((await f.evidence()).offerWindowElapsed,true);assert.equal((await f.evidence()).removalEnabled,false);assert.equal(await f.metadata.get('deletion/fence-v1'),undefined);
});
test('allowance requires a matching grace episode and offer, is consumed once, and resets only for a new episode',NODE_TEST,async t=>{
 const f=await fixture(t);await assert.rejects(f.claim(),{code:'export_not_offered'});await assert.rejects(f.offer({episodeId:JOB,expectedRevision:1}),{code:'export_episode_unavailable'});await assert.rejects(f.offer({episodeId:EP,expectedRevision:0}),{code:'retention_conflict'});await f.offer();await f.claim();assert.equal((await f.evidence()).episode.exportOffered.jobId,JOB);await assert.rejects(f.claim(JOB2),{code:'export_episode_used'});
 let row=(await f.evidence()).episode;row.revision++;await f.metadata.put(OVER_QUOTA_EPISODE,row);await f.offer();await assert.rejects(f.claim(JOB2),{code:'export_episode_used'});
 for(const patch of [{state:'resolved'},{state:'cleanup-eligible'},{usageBytes:10},{deadlineAt:f.clock.now()+1},{effectiveAt:f.clock.now()+1},{revision:Number.MAX_SAFE_INTEGER},{owner:OTHER}]){await f.metadata.put(OVER_QUOTA_EPISODE,{...f.episode,...patch});await assert.rejects(f.offer());}
 await f.metadata.put(OVER_QUOTA_EPISODE,{...f.episode,id:JOB2});await f.offer({episodeId:JOB2,expectedRevision:1});await f.metadata.put('deletion/fence-v1',{owner:OWNER});await assert.rejects(f.offer({episodeId:JOB2,expectedRevision:1}),{code:'account_deleting'});
});
test('seeded offer/claim contention and lost replies preserve the original offer and one allowance',NODE_TEST,async()=>{
 await forEachSeed(80,async random=>{const scheduler=createScheduler(random),f=await fixture(null,{seed:random.seed,wrap:{accountStore:s=>scheduler.wrap(s,'store')}});try{
  await scheduler.run([()=>f.offer(),()=>f.offer()]);const before=(await f.evidence()).episode;const outcomes=await scheduler.run([()=>f.claim(),()=>f.claim(JOB2)]);assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);assert.equal(outcomes.find(v=>v.status==='rejected').reason.code,'export_episode_used');const after=(await f.evidence()).episode;assert.equal(after.exportOffered.at,before.exportOffered.at);assert.equal(after.deadlineAt,before.deadlineAt);
 }finally{await f.dispose();}});
 const f=await fixture(null,{wrap:{accountStore:s=>injectFaults(s,[{method:'transaction',when:1,mode:'after'}])}});try{await assert.rejects(f.offer(),{code:'injected_fault'});const committed=await f.metadata.get(OVER_QUOTA_EPISODE);f.clock.advance(DAY);assert.equal((await f.offer()).at,committed.exportOffered.at);assert.equal((await f.evidence()).episode.deadlineAt,committed.deadlineAt);}finally{await f.dispose();}
});
const removeTree=dir=>rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'dx9-'));t.after(()=>removeTree(dir));return dir;}
async function nodeFixture(t){
 // A failed after hook skips the hooks after it, and an adapter left open keeps the file's process alive forever (it
 // reports the failure, then never exits). Hooks run in registration order, so removing the directory first raced the
 // still-running adapter (ENOTEMPTY) and skipped its close. One hook now closes every adapter, dropping open
 // connections, and only then removes the directory (with retries). The origin must name the port before the adapter
 // exists, so a port is probed and then listened on; another process can take it in between, so a lost port retries
 // with a fresh probe instead of throwing before cleanup was registered.
 const directory=await mkdtemp(join(tmpdir(),'dx9-')),clock=fakeClock(Date.now()),apps=[];let app,origin;
 t.after(async()=>{try{for(const a of apps){a.server.closeAllConnections?.();await a.close();}}finally{await removeTree(directory);}});
 for(let attempt=0;;attempt++){
  const probe=createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',r);});const port=probe.address().port;await new Promise(r=>probe.close(r));origin='http://localhost:'+port;
  const candidate=await createNodeServer({directory:join(directory,'server-'+attempt),config:{APP_ORIGIN:origin,ACCOUNT_EXPORT_ENABLED:'true',LIFECYCLE_CLOCK:clock.now}});apps.push(candidate);
  const error=await new Promise(r=>{candidate.server.once('error',r);candidate.server.listen(port,'127.0.0.1',()=>{candidate.server.off('error',r);r(null);});});
  if(!error){app=candidate;break;}if(error.code!=='EADDRINUSE'||attempt>=9)throw error;
 }
 const post=(path,input)=>app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)}));
 const pending=await(await post('/api/auth/signup',{handle:'export_cli',method:'password',password:'local export CLI fixture password',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();const recovery=await(await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true});assert.equal(activated.status,200,await activated.clone().text());const session=await activated.json(),owner=session.account.id,c=app.resources.accounts.get(owner);await c.warm(owner);clock.advance(4*DAY);
 const large=Uint8Array.from({length:5*1024**2+17},(_,i)=>i%251),small=new Uint8Array([7,9,11]);for(const [id,bytes]of [['large',large],['small',small]]){const ref=`messages/${owner}/${id}`;await c.blobs.put(ref,bytes);await c.metadata.put(key('message',owner,id),{id,owner,blobRef:ref,size:bytes.length,mimeType:'application/octet-stream'});}
 const actor={stepUpAt:clock.now(),sessionId:'cli-test'},job=await c.exportCreate(owner,{operationId:EP},actor);// One contributor page or seal step per alarm (60 for this account today); the bound only stops a stuck job.
 let alarms=0,status;for(;(status=await c.exportStatus(owner,job.id)).state!=='ready'&&!['failed','cancelled','expired'].includes(status.state)&&alarms<ALARM_BOUND;alarms++)await c.exportAlarm();assert.equal(status.state,'ready',`export not ready after ${alarms} alarms: ${JSON.stringify(status)}`);const grant=await c.exportGrant(owner,job.id,{},actor);
 const options={origin,job:job.id,token:grant.token,out:join(directory,'download')};return {app,c,directory,options,large,small,owner,clock,actor};
}
function cli(options,extra={}){return new Promise((resolveResult,reject)=>{const child=spawn(process.execPath,[IPV4_FIRST,'scripts/bindle-export.mjs','--origin',options.origin,'--job',options.job,'--out',options.out,...extra.args??[]],{cwd:resolve('.'),env:{...process.env,BINDLE_EXPORT_GRANT:options.token,...extra.env??{}},stdio:['ignore','pipe','pipe'],timeout:CLI_TIMEOUT_MS,killSignal:'SIGKILL'});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('exit',code=>resolveResult({code,stdout,stderr}));});}
test('CLI uses a real Node job grant, checkpoints interruption, resumes exact ranges, verifies tar/pack/index and rehashes local output',NODE_TEST,async t=>{
 const f=await nodeFixture(t),requests=[],base=nodeExportDownloadPorts();let interrupted=false;
 await assert.rejects(downloadBindleExport(f.options,{io:{...base,async fetch(url,init){requests.push({url,range:init.headers.Range,authorization:init.headers.Authorization});if(url.endsWith('/2.tar')&&init.headers.Range.startsWith('bytes=4194304-')&&!interrupted){interrupted=true;throw Error('controlled interruption');}return base.fetch(url,init);}}}),/controlled interruption/);
 const checkpoint=JSON.parse(await readFile(join(f.options.out,'checkpoint.json')));assert.equal(checkpoint.volumes[2].chunks.length,1);assert.equal(checkpoint.verified,undefined);assert(!JSON.stringify(checkpoint).includes(f.options.token));assert(requests.every(r=>!r.url.includes(f.options.token)&&r.authorization==='Bearer '+f.options.token));
 const grant=await f.c.exportGrant(f.owner,f.options.job,{},f.actor),result=await cli({...f.options,token:grant.token});assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).verified,true);assert.equal(JSON.parse(await readFile(join(f.options.out,'checkpoint.json'))).verified,true);assert.deepEqual((await readdir(f.options.out)).sort(),['checkpoint.json','volume-1.tar','volume-2.tar']);
 const h=await open(join(f.options.out,'volume-2.tar'),'r');let largeSeen=false;try{await inspectTar(h,(await h.stat()).size,async entry=>{if(entry.path.includes('/large/')){largeSeen=true;assert.equal(entry.size,f.large.length);}});}finally{await h.close();}assert(largeSeen);assert.equal((await cli({...f.options,token:grant.token})).code,0);
 const corrupted=await open(join(f.options.out,'volume-2.tar'),'r+');await corrupted.write(new Uint8Array([255]),0,1,600);await corrupted.close();const bad=await cli(f.options);assert.equal(bad.code,1);assert.match(bad.stderr,/checkpoint chunk digest mismatch/);
});
test('CLI detects a corrupt network chunk against the sealed manifest and rejects 200 on resumed Range',NODE_TEST,async t=>{
 const f=await nodeFixture(t),base=nodeExportDownloadPorts();let corrupted=false;
 await assert.rejects(downloadBindleExport(f.options,{io:{...base,async fetch(url,init){const response=await base.fetch(url,init);if(url.endsWith('/2.tar')&&!corrupted){corrupted=true;const b=new Uint8Array(await response.arrayBuffer());b[600]^=1;return new Response(b,{status:response.status,headers:response.headers});}return response;}}}),/does not match the manifest/);assert(corrupted);assert.equal(JSON.parse(await readFile(join(f.options.out,'checkpoint.json'))).verified,undefined);
 const out=join(f.directory,'range-mismatch');let stopped=false;await assert.rejects(downloadBindleExport({...f.options,out},{io:{...base,async fetch(url,init){if(url.endsWith('/2.tar')&&init.headers.Range.startsWith('bytes=4194304-')){stopped=true;throw Error('stop');}return base.fetch(url,init);}}}),/stop/);assert(stopped);
 await assert.rejects(downloadBindleExport({...f.options,out},{io:{...base,async fetch(url,init){const response=await base.fetch(url,init);return new Response(response.body,{status:200,headers:response.headers});}}}),{code:'export_range_mismatch'});
});
test('CLI refuses a foreign job/root, expired grant and unsafe output paths',NODE_TEST,async t=>{
 const f=await nodeFixture(t);await assert.rejects(downloadBindleExport({...f.options,job:JOB}),/grant must belong/);await assert.rejects(downloadBindleExport({...f.options,rootDigest:'0'.repeat(64)}),/root digest changed/);
 const out=join(f.directory,'linked'),elsewhere=join(f.directory,'elsewhere');await mkdir(elsewhere);await symlink(elsewhere,out);await assert.rejects(downloadBindleExport({...f.options,out}),/symlink/);
 const record=await f.c.metadata.get('export/job/'+f.options.job),oldNotBefore=record.notBefore;record.notBefore=f.clock.now()+DAY;await f.c.metadata.put('export/job/'+record.id,record);await assert.rejects(downloadBindleExport({...f.options,out:join(f.directory,'delayed')}),{code:'export_access_refused'});record.notBefore=oldNotBefore;await f.c.metadata.put('export/job/'+record.id,record);
 f.clock.advance(2*DAY);await assert.rejects(downloadBindleExport({...f.options,out:join(f.directory,'expired')}),{code:'export_grant_required'});

});

test('tar verification rejects traversal, duplicate/case aliases, special entries and corrupt headers without extraction',NODE_TEST,async t=>{
 const root=await temp(t);for(const [name,change]of [['traversal',h=>h.set(new TextEncoder().encode('../escape'),0)],['symlink',h=>h[156]=50],['corrupt',h=>h[99]^=1]]){const header=tarHeader({path:'safe-name',size:0});change(header);if(name!=='corrupt'){header.fill(32,148,156);const sum=header.reduce((n,b)=>n+b,0);header.set(new TextEncoder().encode(sum.toString(8).padStart(6,'0')+'\0 '),148);}const path=join(root,name);await writeFile(path,concatBytes([header,new Uint8Array(1024)]));const h=await open(path,'r');try{await assert.rejects(inspectTar(h,(await h.stat()).size,async()=>{}),{code:'export_verification_failed'});}finally{await h.close();}}
 const path=join(root,'aliases');await writeFile(path,concatBytes([tarHeader({path:'safe',size:0}),tarHeader({path:'SAFE',size:0}),new Uint8Array(1024)]));const h=await open(path,'r');try{await assert.rejects(inspectTar(h,(await h.stat()).size,async()=>{}),/case-colliding/);}finally{await h.close();}assert.deepEqual((await readdir(root)).sort(),['aliases','corrupt','symlink','traversal']);
});

test('engine export creation exempts one episode export from the weekly cap and preserves step-up, active-job and replay rules',NODE_TEST,async t=>{
 const f=await fixture(t);await assert.rejects(f.create(),{code:'export_not_offered'});await f.offer();await assert.rejects(f.create(JOB,'over-quota',EP,{...f.owner,stepUpAt:f.clock.now()-300000}),{code:'step_up_required'});
 for(const id of [EP,JOB2]){const j=await f.create(id,'owner');await f.cancel(j.id);}await assert.rejects(f.create(JOB,'owner'),{code:'export_rate_limited'});const job=await f.create();assert.equal(job.purpose,'over-quota');assert.equal((await f.evidence()).episode.exportOffered.jobId,job.id);assert.equal((await f.create()).id,job.id);await assert.rejects(f.create(JOB,'owner'),{code:'export_operation_conflict'});
 await assert.rejects(f.create('00000000-0000-4000-8000-000000000004'),{code:'export_active'});let steps=0,status;for(;(status=await f.read(new ExportStatus({actor:f.owner,id:job.id}))).state!=='ready'&&!['failed','cancelled','expired'].includes(status.state)&&steps<ALARM_BOUND;steps++)await f.perform(new StepExport({actor:f.system}));assert.equal(status.state,'ready',`export not ready after ${steps} steps: ${JSON.stringify(status)}`);await f.cancel(job.id);await assert.rejects(f.create('00000000-0000-4000-8000-000000000004'),{code:'export_episode_used'});
});
test('episode exports do not consume the two ordinary allowances; a real new episode gets a new one',NODE_TEST,async t=>{
 const f=await fixture(t);const first=await f.create(EP,'owner');await f.cancel(first.id);await f.offer();const special=await f.create();await f.cancel(special.id);const second=await f.create(JOB2,'owner');await f.cancel(second.id);await assert.rejects(f.create('00000000-0000-4000-8000-000000000004','owner'),{code:'export_rate_limited'});
 await f.metadata.put(OVER_QUOTA_EPISODE,{...f.episode,id:JOB2});await f.offer({episodeId:JOB2,expectedRevision:1});const next=await f.create('00000000-0000-4000-8000-000000000004','over-quota',JOB2);assert.equal(next.purpose,'over-quota');
});
test('seeded concurrent export creation atomically commits one job, receipt and allowance; failed notice replays it',NODE_TEST,async()=>{
 await forEachSeed(40,async random=>{const scheduler=createScheduler(random),f=await fixture(null,{seed:random.seed,wrap:{accountStore:s=>scheduler.wrap(s,'store')}});try{await f.offer();const outcomes=await scheduler.run([()=>f.create(),()=>f.create(JOB2)]);assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);const job=outcomes.find(v=>v.status==='fulfilled').value,episode=(await f.evidence()).episode;assert.equal(episode.exportOffered.jobId,job.id);assert.equal(await f.metadata.get('export/active'),job.id);assert.equal((await f.metadata.get('export/history')).length,1);}finally{await f.dispose();}});
 const f=await fixture(null);try{await f.offer();f.ports.notice=async()=>{throw Error('notice failed');};await assert.rejects(f.create(),/notice failed/);const episode=(await f.evidence()).episode;f.ports.notice=async()=>{};assert.equal((await f.create()).id,episode.exportOffered.jobId);assert.equal((await f.metadata.get('export/history')).length,1);}finally{await f.dispose();}
});

test('CLI process death leaves a checkpoint and dead-process lock that a new process safely resumes',NODE_TEST,async t=>{
 const f=await nodeFixture(t),listener=f.app.server.listeners('request')[0];let release;const blocked=new Promise(r=>release=r);f.app.server.removeListener('request',listener);f.app.server.on('request',function(req,res){if(req.headers.range?.startsWith('bytes=4194304-')){release();return;}listener.call(this,req,res);});
 const child=spawn(process.execPath,[IPV4_FIRST,'scripts/bindle-export.mjs','--origin',f.options.origin,'--job',f.options.job,'--out',f.options.out],{env:{...process.env,BINDLE_EXPORT_GRANT:f.options.token},stdio:['ignore','ignore','pipe'],timeout:CLI_TIMEOUT_MS,killSignal:'SIGKILL'});t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});let stderr='';child.stderr.on('data',b=>stderr+=b);const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));await Promise.race([blocked,exited.then(v=>{throw Error('CLI exited before interruption '+JSON.stringify(v)+stderr);})]);child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');f.app.server.removeAllListeners('request');f.app.server.on('request',listener);
 assert.equal(JSON.parse(await readFile(join(f.options.out,'checkpoint.json'))).volumes[2].chunks.length,1);assert.equal(JSON.parse(await readFile(join(f.options.out,'.bindle-export.lock'))).pid,child.pid);const result=await cli(f.options);assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).verified,true);
});
