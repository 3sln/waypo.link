// DX-2 tests use the unmounted modules: coordinator registries/adapters are not
// modified by this workstream. The facade runs the same ngin operations as RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
import {fakeClock,forEachSeed,createScheduler} from './helpers/chaos.mjs';
import {CreateExport,StepExport,CancelExport,ExportStatus} from '../packages/app/domains/account-export.mjs';
import {MintExportGrant,RevokeExportGrant,DownloadExport,ExportStepUp,methods,rpc,parseExportGrant} from '../packages/runtime/account/exports.mjs';
import {ExportPinStatus,exportPinKey,exportPinned} from '../packages/runtime/export-pins.mjs';
import {createExportDigest} from '../packages/runtime/export-generation.mjs';
import {exportLayout,streamExport} from '../packages/runtime/export-tar.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {stages,allowedMethods} from '../packages/runtime/routes/exports.mjs';
const ORIGIN='https://account.example',OP='00000000-0000-4000-8000-000000000001',DAY=86400000;
function bucket(){const rows=new Map(),calls=[];return {rows,calls,async put(k,v){rows.set(k,new Uint8Array(v));},async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])rows.delete(k);},async get(k,{range}={}){calls.push({key:k,range});const v=rows.get(k);return v?{size:v.length,body:new Blob([range?v.slice(range.offset,range.offset+range.length):v]).stream(),arrayBuffer:async()=>v.slice().buffer}:null;}};}
async function fixture(t,{seed=1,wrap={}}={}){
 const clock=fakeClock(),archives=bucket(),blobs=bucket(),security={epoch:1,changedAt:0},notices=[],env={ACCOUNT_EXPORT_ENABLED:'true'},flags={for:ctx=>createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env,clock:clock.now}).for(ctx)};
 const ref=`messages/${OWNER}/m1`,bytes=Uint8Array.from({length:300001},(_,i)=>i%251);await blobs.put(ref,bytes);
 const ports={identitySecurity:async()=>security,digest:createExportDigest(),quota:async()=>10**9,notice:async event=>notices.push(event),contributors:[{name:'messages',version:1,page:async()=>({rows:[{id:'m1'}],payloads:[{entryId:'m1',kind:'message',source:{message:'m1',part:0},ref,size:bytes.length,path:'data/messages/m1/0.bin'}],done:true})}]};
 const f=await createTestEngine({seed,clock,wrap,providers:{archives,blobs,flags},config:{APP_ORIGIN:ORIGIN,exportPorts:ports}});t?.after(()=>f.dispose());await f.metadata.put('owner',OWNER);
 const actor={kind:'owner',owner:OWNER,sessionId:'s1',stepUpAt:clock.now()},system={kind:'system',owner:OWNER};
 const run=(C,params={})=>{const op=new C({actor,...params});return ['exports.download','exports.status','exports.pin'].includes(C.operation)?f.read(op):f.perform(op);};
 const create=()=>run(CreateExport,{input:{operationId:OP}}),ready=async id=>{for(let i=0;i<30;i++){const state=await run(ExportStatus,{id});if(state.state==='ready')return state;await run(StepExport,{actor:system});}assert.fail('generation did not converge');};
 const controller={metadata:f.metadata,archives,blobs,config:{APP_ORIGIN:ORIGIN,flags,exportPorts:ports,LIFECYCLE_CLOCK:clock.now},warm:async()=>{},scheduleAlarm:async()=>{},...methods},owner={account:{id:OWNER},csrfToken:'csrf1',sessionContext:'s1'};
 const identityEngine={query:q=>({peek:async()=>{assert(q instanceof ExportStepUp);if(!Number.isSafeInteger(actor.stepUpAt)||actor.stepUpAt+300000<=clock.now())throw Object.assign(new Error('step up'),{code:'step_up_required',status:401});return {owner:OWNER,sessionId:actor.sessionId,stepUpAt:actor.stepUpAt};}})};
 const http=async(path,{method='GET',headers={},input,who=owner}={})=>{
  const request=new Request(ORIGIN+path,{method,headers:{...method==='GET'?{}:{Origin:ORIGIN,'X-CSRF-Token':'csrf1','Content-Type':'application/json'},...headers},...input!==undefined?{body:JSON.stringify(input)}:{}}),env={APP_ORIGIN:ORIGIN,BLOBS:blobs,ARCHIVES:archives,ACCOUNTS:{get:id=>({invoke:async({method,args})=>controller[method](...args)})}},context={csrfToken:request.headers.get('X-CSRF-Token')},route={request,env,path:new URL(request.url).pathname,engine:identityEngine,context,owner:who,id:who.account.id,object:controller};
  try{return await stages.api(route)??await stages.beforeActivity(route)??new Response(null,{status:404});}catch(e){return new Response(JSON.stringify({error:e.code??'error'}),{status:e.status??500,headers:{'Content-Type':'application/json'}});}
 };
 return {...f,clock,archives,blobs,security,notices,env,flags,ports,ref,bytes,actor,system,run,create,ready,controller,http};
}

test('engine CLI grants are hashed, job-scoped, read-only, epoch-bound and expire within 24 hours',async t=>{
 const f=await fixture(t),job=await f.create();await f.ready(job.id);const grant=await f.run(MintExportGrant,{id:job.id,input:{}});
 assert.equal(grant.expiresAt,f.clock.now()+DAY);assert.deepEqual(parseExportGrant(grant.token),{owner:OWNER,jobId:job.id,grantId:grant.id});
 const stored=await f.metadata.get('export/job/'+job.id);assert.equal(stored.grants[0].tokenHash.length,64);assert(!JSON.stringify(stored).includes(grant.token));assert(!JSON.stringify(await f.run(ExportStatus,{id:job.id})).includes('tokenHash'));
 const actor={kind:'export-grant',owner:OWNER,token:grant.token},input={volume:2,range:'bytes=10-99'};
 assert.equal((await f.run(DownloadExport,{id:job.id,actor,input})).contentLength,90);
 for(const wrong of [{...actor,owner:OTHER},{...actor,token:grant.token.slice(0,-2)+'xx'},{kind:'export-grant',owner:OWNER,grantId:grant.id,jobId:job.id}])await assert.rejects(f.run(DownloadExport,{id:job.id,actor:wrong,input}),{code:'unauthorized'});
 await assert.rejects(f.run(CreateExport,{actor,input:{operationId:OP}}),{code:'unauthorized'});
 f.security.epoch++;await assert.rejects(f.run(DownloadExport,{id:job.id,actor,input}),{code:'unauthorized'});f.security.epoch--;
 f.clock.advance(DAY);await assert.rejects(f.run(DownloadExport,{id:job.id,actor,input}),{code:'unauthorized'});
 assert(f.notices.some(n=>n.type==='export-grant-created'));assert(f.notices.some(n=>n.type==='export-downloaded'&&n.session==='grant:'+grant.id));
});

test('grant step-up, expiry, readiness, owner binding, cap, revocation and notice failures are enforced by the engine',async t=>{
 const f=await fixture(t),job=await f.create();await assert.rejects(f.run(MintExportGrant,{id:job.id}),{code:'export_not_ready'});await f.ready(job.id);
 for(const stepUpAt of [undefined,f.clock.now()-300000,f.clock.now()+1])await assert.rejects(f.run(MintExportGrant,{id:job.id,actor:{...f.actor,stepUpAt}}),{code:'step_up_required'});
 await assert.rejects(f.run(MintExportGrant,{id:job.id,input:{stepUpAt:f.clock.now()}}),{code:'invalid_export'});
 await assert.rejects(f.run(MintExportGrant,{id:job.id,actor:{...f.actor,owner:OTHER}}),{code:'forbidden'});
 const grant=await f.run(MintExportGrant,{id:job.id});await f.run(RevokeExportGrant,{id:job.id,input:{grantId:grant.id}});await f.run(RevokeExportGrant,{id:job.id,input:{grantId:grant.id}});
 await assert.rejects(f.run(DownloadExport,{id:job.id,actor:{kind:'export-grant',owner:OWNER,token:grant.token},input:{volume:1}}),{code:'unauthorized'});
 const row=await f.metadata.get('export/job/'+job.id);row.expiresAt=f.clock.now()+123;await f.metadata.put('export/job/'+job.id,row);assert.equal((await f.run(MintExportGrant,{id:job.id})).expiresAt,row.expiresAt);
 f.ports.notice=async()=>{throw Object.assign(new Error('transport'),{code:'notice_down'});};await assert.rejects(f.run(MintExportGrant,{id:job.id}),{code:'notice_down'});
 const after=await f.metadata.get('export/job/'+job.id);assert(!JSON.stringify(after).includes('bex1.'));after.grants=Array.from({length:32},(_,i)=>({id:String(i)}));await f.metadata.put('export/job/'+job.id,after);await assert.rejects(f.run(MintExportGrant,{id:job.id}),{code:'export_grant_limit'});
});

test('HTTP export routes enforce origin, CSRF, step-up and purpose; reads/reversal survive targeting ramp-down',async t=>{
 const f=await fixture(t);
 for(const [path,method]of [['/api/exports','POST'],['/api/exports','GET']])for(const headers of [{Origin:'https://attacker.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.http(path,{method,headers,input:method==='POST'?{operationId:OP}:undefined})).status,403);
 assert.equal((await f.http('/api/exports',{method:'POST',headers:{'X-CSRF-Token':'bad'},input:{operationId:OP}})).status,403);
 f.actor.stepUpAt=f.clock.now()-300000;assert.equal((await f.http('/api/exports',{method:'POST',input:{operationId:OP}})).status,401);f.actor.stepUpAt=f.clock.now();
 assert.equal((await f.http('/api/exports',{method:'POST',input:{operationId:OP,purpose:'closure'}})).status,400);
 const response=await f.http('/api/exports',{method:'POST',input:{operationId:OP}});assert.equal(response.status,200,await response.clone().text());const job=await response.json();await f.ready(job.id);
 delete f.env.ACCOUNT_EXPORT_ENABLED;assert.equal((await f.http('/api/exports')).status,200);assert.equal((await f.http('/api/exports/'+job.id)).status,200);
 for(const suffix of ['/cancel','/grants'])assert.equal((await f.http('/api/exports/'+job.id+suffix,{method:'POST',headers:{'X-CSRF-Token':'bad'},input:{}})).status,403);
 assert.equal((await f.http('/api/exports/'+job.id+'/grants',{method:'POST',input:{}})).status,404);f.env.ACCOUNT_EXPORT_ENABLED='true';
 const g=await f.http('/api/exports/'+job.id+'/grants',{method:'POST',input:{}});assert.equal(g.status,200);const grant=await g.json();
 assert.equal((await f.http('/api/exports/'+job.id+'/grants/'+grant.id,{method:'DELETE',headers:{Origin:'https://attacker.example'}})).status,403);
 assert.equal((await f.http('/api/exports/'+job.id+'/grants/'+grant.id,{method:'DELETE'})).status,200);
 assert.equal((await f.http('/api/exports/'+job.id+'/cancel',{method:'POST',input:{token:'deletion-cancel-token'}})).status,400);
 assert.equal((await f.http('/api/exports/'+job.id+'/cancel',{method:'POST',input:{}})).status,200);
 assert.equal((await f.http('/api/exports/'+job.id+'/cancel',{method:'POST',input:{}})).status,200);
 assert.equal(f.archives.rows.size,0);assert.equal(await exportPinned(f.metadata,f.ref),false);
 assert.deepEqual(allowedMethods('/api/exports/'+job.id+'/volumes/2.tar'),['GET']);assert.equal((await f.http('/api/exports/'+job.id,{method:'POST',input:{}})).status,405);
});

test('HTTP full/range/resume output is exact, private and session/grant confined; adversarial ranges never reserve bytes',async t=>{
 const f=await fixture(t),job=await f.create();await f.ready(job.id);const path='/api/exports/'+job.id+'/volumes/2.tar',full=await f.http(path);assert.equal(full.status,200);const all=new Uint8Array(await full.arrayBuffer());
 for(const [name,value]of [['Content-Type','application/x-tar'],['Cache-Control','no-store'],['X-Content-Type-Options','nosniff'],['Referrer-Policy','no-referrer']])assert.equal(full.headers.get(name),value);assert(full.headers.get('Content-Disposition').startsWith('attachment;'));assert.equal(Number(full.headers.get('Content-Length')),all.length);
 const etag=full.headers.get('ETag');for(const range of ['bytes=0-99','bytes=510-514','bytes=300510-300519','bytes=-300','bytes=300900-']){const partial=await f.http(path,{headers:{Range:range,'If-Range':etag}});assert.equal(partial.status,206);const m=/bytes (\d+)-(\d+)\//.exec(partial.headers.get('Content-Range'));assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),all.slice(Number(m[1]),Number(m[2])+1));}
 const before=(await f.run(ExportStatus,{id:job.id})).downloadedBytes;
 assert.equal((await f.http(path,{headers:{Range:'bytes=999999-'}})).headers.get('Content-Range'),'bytes */'+all.length);
 for(const range of ['bytes=0-1,3-4','bytes=999999999999999999999-','bytes=-0','bytes=100-20','items=0-1','bytes=999999-','bytes= -1','bytes=0- 1'])assert.equal((await f.http(path,{headers:{Range:range}})).status,416,range);
 assert.equal((await f.run(ExportStatus,{id:job.id})).downloadedBytes,before);
 const fallback=await f.http(path,{headers:{Range:'bytes=30-39','If-Range':'"old"'}});assert.equal(fallback.status,200);assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()),all);
 assert.equal((await f.http(path,{who:{account:{id:OTHER},csrfToken:'csrf1',sessionContext:'s2'}})).status,403);
 const grant=await f.run(MintExportGrant,{id:job.id}),authorization='Bearer '+grant.token,partial=await f.http(path,{headers:{Authorization:authorization,Range:'bytes=2-9'}});assert.equal(partial.status,206);assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),all.slice(2,10));
 for(const route of ['/api/exports','/api/exports/'+job.id,'/api/exports/'+job.id+'/cancel'])assert.equal((await f.http(route,{...route.endsWith('/cancel')?{method:'POST',input:{}}:{},headers:{Authorization:authorization}})).status,401);
 assert.equal((await f.http(path+'?token='+encodeURIComponent(grant.token))).status,400);
 assert.equal((await f.http(path,{headers:{Authorization:authorization,'Sec-Fetch-Site':'cross-site'}})).status,403);
 f.env.ACCOUNT_EXPORT_ENABLED='false';assert.equal((await f.http(path,{headers:{Authorization:authorization}})).status,503);
});

test('stream aborts before a changed object header; short bodies and cancellation never pad missing bytes',async t=>{
 const f=await fixture(t),layout=exportLayout([],[{path:'data/messages/m1/0.bin',key:f.ref,bucket:'blobs',size:f.bytes.length}])[1];f.blobs.rows.set(f.ref,new Uint8Array(1));const reader=streamExport(layout,{blobs:f.blobs,archives:f.archives}).getReader();await assert.rejects(reader.read(),{code:'export_payload_changed'});
 const short={get:async()=>({size:f.bytes.length,body:new Blob([new Uint8Array(1)]).stream()})};await assert.rejects(new Response(streamExport(layout,{blobs:short})).arrayBuffer(),{code:'export_payload_changed'});
 let cancelled=false;const source={get:async()=>({size:f.bytes.length,body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}})})};const stream=streamExport(layout,{blobs:source}).getReader();await stream.read();await stream.cancel();assert.equal(cancelled,true);
});

test('pin queries match only exact refs, release on cancel and enforce DX-1 pin budget under upload/delete loops',async t=>{
 const f=await fixture(t),job=await f.create();await f.ready(job.id);assert.equal((await f.run(ExportPinStatus,{actor:f.system,input:{ref:f.ref}})).pinned,true);
 for(const ref of [f.ref+'0',`messages/${OTHER}/m1`,`objects/${OWNER}/new/version`])assert.equal(await exportPinned(f.metadata,ref),false);
 assert.equal(await exportPinKey(f.ref),'export/pin/'+await f.ports.digest.sha256(new TextEncoder().encode(f.ref)));
 await f.run(CancelExport,{id:job.id});assert.equal(await exportPinned(f.metadata,f.ref),false);
 const g=await fixture(t);g.ports.quota=async()=>1;const fail=await g.create();await assert.rejects(g.ready(fail.id),{code:'export_pin_budget'});assert.equal(await exportPinned(g.metadata,g.ref),false);assert.equal(g.archives.rows.size,0);
});

test('seeded concurrent grant revoke and download, cap reservations, and generation/cancel/pin release converge',async()=>{
 await forEachSeed(32,async random=>{
  const scheduler=createScheduler(random),f=await fixture(null,{seed:random.seed,wrap:{accountStore:store=>scheduler.wrap(store,'store')}});
  try{
   const job=await f.create();await f.ready(job.id);const grant=await f.run(MintExportGrant,{id:job.id}),actor={kind:'export-grant',owner:OWNER,token:grant.token};
   await scheduler.run([()=>f.run(RevokeExportGrant,{id:job.id,input:{grantId:grant.id}}),()=>f.run(DownloadExport,{id:job.id,actor,input:{volume:2,range:'bytes=0-9'}})]);
   await assert.rejects(f.run(DownloadExport,{id:job.id,actor,input:{volume:2,range:'bytes=0-9'}}),{code:'unauthorized'});
   const row=await f.metadata.get('export/job/'+job.id);row.downloadedBytes=0;row.downloadCap=10;await f.metadata.put('export/job/'+job.id,row);
   const results=await scheduler.run(Array.from({length:4},()=>()=>f.run(DownloadExport,{id:job.id,input:{volume:2,range:'bytes=0-9'}})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.metadata.get('export/job/'+job.id)).downloadedBytes,10);
   await f.run(CancelExport,{id:job.id});assert.equal(await exportPinned(f.metadata,f.ref),false);assert.equal(f.archives.rows.size,0);
  }finally{await f.dispose();}
  const g=await fixture(null,{seed:random.seed,wrap:{accountStore:store=>scheduler.wrap(store,'store')}});try{
   const job=await g.create();await scheduler.run([()=>g.run(StepExport,{actor:g.system}),()=>g.run(CancelExport,{id:job.id})]);g.clock.advance(60001);await g.run(CancelExport,{id:job.id});assert.equal(await g.metadata.get('export/active'),undefined);assert.equal(await exportPinned(g.metadata,g.ref),false);assert.equal(g.archives.rows.size,0);
  }finally{await g.dispose();}
 });
});

test('account facade policies keep generation internal and all export operations free of owner activity',async t=>{
 const f=await fixture(t);assert(!('exportAlarm' in rpc));for(const policy of Object.values(rpc))assert.equal(policy.activity,undefined);assert.equal(rpc.exportCancel.lifecycle,'purging');assert.equal(rpc.exportCreate.warm,true);
 const job=await f.controller.exportCreate(OWNER,{operationId:OP},f.actor);for(let i=0;i<20;i++){await f.controller.exportAlarm();if((await f.controller.exportStatus(OWNER,job.id)).state==='ready')break;}assert.equal((await f.controller.exportStatus(OWNER,job.id)).state,'ready');assert.equal(await f.metadata.get('lastOwnerActiveAt'),undefined);await f.controller.exportCancel(OWNER,job.id);let warmed=0;f.controller.warm=async()=>{warmed++;};await f.controller.exportAlarm();assert.equal(warmed,0);
});


test('failed create notices and transient alarm errors retain a durable retry wake',async t=>{
 const f=await fixture(t),wakes=[];f.controller.scheduleAlarm=async at=>wakes.push(at);f.ports.notice=async()=>{throw Object.assign(new Error('notice'),{code:'notice_unavailable'});};
 await assert.rejects(f.controller.exportCreate(OWNER,{operationId:OP},f.actor),{code:'notice_unavailable'});assert.equal(wakes.length,1);assert(await f.metadata.get('export/active'));
 const retried=await f.controller.exportAlarm();assert.equal(retried.busy,true);assert.equal(retried.error,'notice_unavailable');assert(wakes.includes(retried.wakeAt));
 f.ports.notice=async()=>{};for(let i=0;i<20;i++){await f.controller.exportAlarm();if((await f.controller.exportList(OWNER)).jobs[0].state==='ready')break;}assert.equal((await f.controller.exportList(OWNER)).jobs[0].state,'ready');
 const id=(await f.controller.exportList(OWNER)).jobs[0].id,original=f.archives.delete;f.archives.delete=async()=>{throw Object.assign(new Error('bucket'),{code:'bucket_unavailable'});};const count=wakes.length;await assert.rejects(f.controller.exportCancel(OWNER,id),{code:'bucket_unavailable'});assert(wakes.length>count);f.archives.delete=original;await f.controller.exportAlarm();assert.equal(await f.metadata.get('export/active'),undefined);assert.equal(f.archives.rows.size,0);
});
