// DX integration over the real Node adapter (apps/node): deletion ports wired independent of the lifecycle, the
// account deletion RPCs and alarm hook, the deletion-due index, MCP and federation erasure, DX-6 email removal route
// and the account channel RPCs. Everything new is behind default-off flags; the flag-off paths are asserted too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createNodeServer} from '../apps/node/server.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const origin='http://localhost:8791',key=randomBytes(32).toString('base64url'),PASSWORD='Integration test long password!';
class Jar{constructor(){this.map=new Map();}apply(response){for(const line of response.headers.getSetCookie()){const [pair,...attributes]=line.split(';'),i=pair.indexOf('='),name=pair.slice(0,i),value=pair.slice(i+1);if(attributes.some(a=>/^\s*Max-Age=0$/i.test(a)))this.map.delete(name);else this.map.set(name,value);}return response;}header(){return [...this.map].map(([k,v])=>k+'='+v).join('; ');}}
async function fixture(t,config={}){
 const directory=await mkdtemp(join(tmpdir(),'bindle-dx-'));const app=await createNodeServer({directory,config:{APP_ORIGIN:origin,SESSION_COOKIE_KEY:key,SIGNUP_IP_DAILY_LIMIT:'50',SIGNUP_SUBNET_DAILY_LIMIT:'50',SIGNUP_REGION_HOURLY_LIMIT:'50',SIGNUP_REGION_DAILY_LIMIT:'50',SIGNUP_GLOBAL_HOURLY_LIMIT:'50',SIGNUP_GLOBAL_DAILY_LIMIT:'200',...config}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});let ip=0;
 const call=(path,{jar,method='GET',value,headers={}}={})=>app.fetch(new Request(origin+path,{method,headers:{...method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'},...jar?{Cookie:jar.header()}:{},'CF-Connecting-IP':'198.51.100.'+(++ip%250),...headers},...value!==undefined?{body:JSON.stringify(value)}:{}}));
 async function signup(jar=new Jar()){const pending=await jar.apply(await call('/api/auth/signup',{jar,method:'POST',value:{method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'}})).json();const recovery=await jar.apply(await call('/api/auth/recovery/download',{jar,method:'POST',value:{pendingToken:pending.pendingToken}})).json();const response=jar.apply(await call('/api/auth/recovery/confirm',{jar,method:'POST',value:{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}}));return {jar,body:await response.json()};}
 const as=session=>({'X-Bindle-Account':session.account.id,'X-Bindle-Session-Context':session.sessionContext,'X-CSRF-Token':session.csrfToken});
 const invoke=(owner,method,args=[])=>app.resources.accounts.get(owner).invoke({method,args:[owner,...args]});
 return {app,directory,call,signup,as,invoke};
}
const request=(owner,stepUpAt,handle)=>[{confirmHandle:handle,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-integration-0123456789'},{stepUpAt}];

test('flags off: deletion requests are not found, email removal is unavailable, the lifecycle is untouched',async t=>{
 const f=await fixture(t),{jar,body}=await f.signup(),owner=body.account.id,handle=(await f.app.resources.repository.get(owner)).handle;
 const refused=await f.invoke(owner,'deletionRequest',request(owner,Date.now()-1000,handle));assert.equal(refused.$fault.code,'not_found');
 assert.deepEqual(await f.invoke(owner,'deletionStatus'),{state:'none'});
 const removal=await f.call('/api/auth/email/remove',{jar,method:'POST',value:{confirmed:true},headers:f.as(body)});assert.equal(removal.status,404);assert.equal((await removal.json()).error,'email_removal_unavailable');
 const csrf=await f.call('/api/auth/email/remove',{jar,method:'POST',value:{confirmed:true},headers:{...f.as(body),'X-CSRF-Token':'wrong'}});assert.equal(csrf.status,403);
 const channels=await f.invoke(owner,'accountChannels');assert.equal(channels.owner,owner);assert.equal(channels.ready,false);assert.equal(channels.count,0);
 assert.deepEqual(await f.invoke(owner,'accountSecurityNotice',[{event:'email-removed'}]),{accepted:0});
 assert.equal((await f.call('/api/account',{jar,headers:f.as(body)})).status,200);
});

test('flag on: request over the real controller, due index in the identity directory, alarm hook, cancel; a fenced account answers 410',async t=>{
 const f=await fixture(t,{ACCOUNT_DELETION_ENABLED:'true'}),{jar,body}=await f.signup(),owner=body.account.id,handle=(await f.app.resources.repository.get(owner)).handle;
 const stale=await f.invoke(owner,'deletionRequest',request(owner,Date.now()-300000,handle));assert.equal(stale.$fault.code,'step_up_required');
 const scheduled=await f.invoke(owner,'deletionRequest',request(owner,Date.now()-1000,handle));
 assert.equal(scheduled.state,'scheduled',JSON.stringify(scheduled));assert.equal(scheduled.graceDays,30,'a new account counts as a recent security change (DX-6)');assert.equal(scheduled.billing.pending,false);
 const identities=new SqliteMetadata(join(f.directory,'identities.sqlite'));t.after(()=>identities.close());
 assert.equal((await identities.list({prefix:'deletion-due/'})).size,1);
 // The account alarm runs the deletion step first; before the deadline it only waits, and shelving is refused.
 await f.app.resources.accounts.get(owner).alarm();assert.equal(await f.app.resources.accounts.get(owner).deletionMaintenanceRefused(),true);
 // Checkout and plan changes are refused while scheduled (DX-4 guard).
 assert.equal((await f.invoke(owner,'billingCheckout',['paid',{}])).$fault.code,'deletion_scheduled');
 const cancelled=await f.invoke(owner,'deletionCancel');assert.equal(cancelled.state,'cancelled');
 assert.equal((await identities.list({prefix:'deletion-due/'})).size,0);
 assert.equal((await f.call('/api/account',{jar,headers:f.as(body)})).status,200,'cancelling restores everything');
 // A committed fence answers 410 for every non-purging operation, in lifecycle mode off.
 const metadata=new SqliteMetadata(join(f.directory,'accounts',owner+'.sqlite'));t.after(()=>metadata.close());
 await f.app.resources.accounts.get(owner).metadata.put('deletion/fence-v1',{v:1,owner,requestId:'r',at:Date.now()});
 const fenced=await f.call('/api/account',{jar,headers:f.as(body)});assert.equal(fenced.status,410);assert.equal((await fenced.json()).error,'account_deleting');
});

test('erasure ports: MCP rows on existing shards and the federation shard are erased; absent stores are never created',async t=>{
 const f=await fixture(t,{ACCOUNT_DELETION_ENABLED:'true',LOCAL_DEVELOPMENT:'true'}),{body}=await f.signup(),owner=body.account.id;
 const ports=f.app.resources.accounts.get(owner).config.ACCOUNT_DELETION_PORTS;
 assert.equal(typeof ports.identity.tombstone,'function');assert.equal(ports.erasure.emailBridge,null);assert.equal(ports.erasure.operatorApps,null);
 assert.deepEqual(await ports.erasure.federation.eraseSubject(owner),{deleted:0,absent:true});
 assert.equal(existsSync(join(f.directory,'federation')),true);
 assert.deepEqual(await ports.erasure.mcp.eraseSubject(owner),{deleted:0});
 // Seed one MCP shard with this owner's grant and another owner's grant, then erase.
 const shard=new SqliteMetadata(join(f.directory,'mcp','mcp-auth-v1-64-07.sqlite'));
 await shard.put('mcp/v1/grant/07.a',{id:'07.a',owner});await shard.put('mcp/v1/token/t1',{owner,grantId:'07.a'});await shard.put('mcp/v1/grant/07.b',{id:'07.b',owner:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});await shard.put(`mcp/v1/owner/${owner}`,['07.a']);shard.close();
 assert.deepEqual(await ports.erasure.mcp.eraseSubject(owner),{deleted:2});
 const check=new SqliteMetadata(join(f.directory,'mcp','mcp-auth-v1-64-07.sqlite'));t.after(()=>check.close());
 assert.deepEqual([...(await check.list({prefix:'mcp/v1/'})).keys()],['mcp/v1/grant/07.b']);
});

// ---- Export end to end over the real Node adapter (DX-1/DX-2 with the composed ports) ----
import {FileBucket} from '../apps/node/resources.mjs';
import {key as recordKey} from '../packages/core/records.mjs';
function untar(bytes){
 const entries=new Map(),text=(at,length)=>new TextDecoder().decode(bytes.subarray(at,at+length)).replace(/\0.*$/s,'');let at=0,pax=null;
 while(at+512<=bytes.length){
  if(bytes.subarray(at,at+512).every(b=>b===0))break;
  const size=parseInt(text(at+124,12).trim(),8),type=text(at+156,1),name=(text(at+345,155)?text(at+345,155)+'/':'')+text(at,100),data=bytes.subarray(at+512,at+512+size);
  at+=512+Math.ceil(size/512)*512;
  if(type==='x'){pax=Object.fromEntries(new TextDecoder().decode(data).split('\n').filter(Boolean).map(line=>{const [k,...v]=line.slice(line.indexOf(' ')+1).split('=');return [k,v.join('=')];}));continue;}
  entries.set(pax?.path??name,data.slice());pax=null;
 }
 return entries;
}
test('export end to end: create with step-up, alarm generation, HTTP download with Range resume, tar contents against the inventory, expiry',async t=>{
 let offset=0;const f=await fixture(t,{ACCOUNT_EXPORT_ENABLED:'true',LOCAL_DEVELOPMENT:'true',LIFECYCLE_CLOCK:()=>Date.now()+offset}),{jar,body}=await f.signup(),owner=body.account.id;
 const controller=f.app.resources.accounts.get(owner),blobs=new FileBucket(join(f.directory,'blobs'));
 // A small (packed) and a large (streamed from BLOBS) message payload; the large one exercises the Node range reader.
 const small=new TextEncoder().encode('hello export'),large=Uint8Array.from({length:300*1024},(_,i)=>i%251);
 for(const [id,bytes] of [['m-small',small],['m-large',large]]){const ref=`messages/${owner}/${id}`;await blobs.put(ref,bytes);await controller.metadata.put(recordKey('message',owner,id),{id,owner,collection:'inbox',mimeType:'text/plain',size:bytes.length,receivedAt:Date.now(),blobRef:ref});}
 const headers=f.as(body),post=(path,value,extra={})=>f.call(path,{jar,method:'POST',value,headers:{...headers,...extra}});
 // Creation needs a fresh step-up; without it the route refuses.
 {const refused=await post('/api/exports',{operationId:crypto.randomUUID()});assert.equal((await refused.json()).error,'step_up_required');}
 assert.equal((await post('/api/auth/step-up',{method:'password',password:PASSWORD})).status,200);
 const created=await post('/api/exports',{operationId:crypto.randomUUID()});assert.equal(created.status,200,await created.clone().text());const job=await created.json();
 assert.equal((await f.app.resources.repository.get(owner)).audit.filter(e=>e.type==='export-created').length,1,'the owner security log records creation');
 // A new account counts as a recent security change: the export is ready only 72 hours later.
 offset=4*86400000;
 for(let i=0;i<60;i++){const status=await (await f.call('/api/exports/'+job.id,{jar,headers})).json();if(status.state==='ready')break;await controller.alarm();}
 const ready=await (await f.call('/api/exports/'+job.id,{jar,headers})).json();assert.equal(ready.state,'ready',JSON.stringify(ready));
 const volumes=[];
 for(const volume of ready.volumes){
  const path=`/api/exports/${job.id}/volumes/${volume.n}.tar`,full=new Uint8Array(await (await f.call(path,{jar,headers})).arrayBuffer());assert.equal(full.length,volume.bytes);
  // Resume: a partial download, then the remainder by Range; the bytes equal the full stream.
  const cut=Math.min(1000,volume.bytes-1),first=await f.call(path,{jar,headers:{...headers,Range:`bytes=0-${cut-1}`}});assert.equal(first.status,206);
  const rest=await f.call(path,{jar,headers:{...headers,Range:`bytes=${cut}-`}});assert.equal(rest.status,206);assert.equal(rest.headers.get('Content-Type'),'application/x-tar');assert.match(rest.headers.get('Cache-Control'),/no-store/);
  const joined=new Uint8Array([...new Uint8Array(await first.arrayBuffer()),...new Uint8Array(await rest.arrayBuffer())]);assert.deepEqual(joined,full);volumes.push(full);
 }
 const files=new Map(volumes.flatMap(v=>[...untar(v)]));
 const manifest=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));assert.equal(manifest.format,'bindle-export/1');assert.equal(manifest.subject,owner);
 for(const part of manifest.parts.filter(p=>!p.path.startsWith('pack.')))assert(files.has(part.path),`manifest part ${part.path} is in the archive`);
 assert.deepEqual(files.get('data/messages/m-small/0.bin'),small);assert.deepEqual(files.get('data/messages/m-large/0.bin'),large);
 const jsonl=[...files].filter(([name])=>name.endsWith('.jsonl')).map(([,data])=>new TextDecoder().decode(data)).join('\n');
 for(const contributor of ['identity','keys','grants','external-storage','messages','features'])assert(manifest.parts.some(p=>p.path.startsWith(`account/${contributor}.`))||manifest.counts[contributor],`contributor ${contributor} is present`);
 // Redaction: no password or recovery hash, session token, CSRF token, private key or blob reference.
 const record=await f.app.resources.repository.get(owner);
 for(const secret of [record.passwordHash,record.recoveryHash,body.csrfToken,...record.sessions.map(s=>s.hash)].filter(Boolean))assert.equal(jsonl.includes(secret),false);
 assert.doesNotMatch(jsonl,/"(?:d|privateJwk|blobRef|passwordHash|recoveryHash)"\s*:/);assert.match(jsonl,/"publicJwk"/);
 // Expiry deletes every exact part key.
 const stored=await controller.metadata.get('export/job/'+job.id),keys=stored.keys;assert(keys.length>0);
 offset+=8*86400000;for(let i=0;i<10;i++)await controller.alarm();
 assert.equal((await (await f.call('/api/exports/'+job.id,{jar,headers})).json()).state,'expired');
 const archives=new FileBucket(join(f.directory,'archives'));for(const name of keys)assert.equal(await archives.get(name),null,name);
});

test('closure-export sessions: credential sign-in to a closed account is restricted, time-bound and server-enforced',async t=>{
 const f=await fixture(t,{ACCOUNT_EXPORT_ENABLED:'true',ACCOUNT_DELETION_ENABLED:'true',ADMIN_ENABLED:'true'}),{body}=await f.signup(),owner=body.account.id,repo=f.app.resources.repository;
 const handle=(await repo.get(owner)).handle,login=jar=>f.call('/api/auth/login/password',{jar,method:'POST',value:{handle,password:PASSWORD,turnstileToken:'local-browser-test-token'}});
 // Closed by an administrator (as AdminService.closeUser leaves it): suspended, sessions ended, closure applied.
 const exportUntil=Date.now()+30*86400000,account=await repo.get(owner);
 assert(await repo.compareAndSwap(owner,account.revision,{...account,status:'suspended',sessions:[],revision:account.revision+1}));
 // Without an applied closure a suspended account cannot sign in at all.
 assert.equal((await login(new Jar())).status,401);
 await f.app.resources.adminStore.commit({writes:{['principal/'+owner]:{owner,assignmentId:account.assignmentId,roles:[],hold:null,closure:{state:'applied',basis:'admin-closure',exportUntil,executeAfter:exportUntil,operationId:crypto.randomUUID(),adminAuditSeq:1}}}});
 const scheduled=await f.invoke(owner,'deletionSchedule',[{basis:'admin-closure',operationId:'op-closure-integration-1',adminAuditSeq:1,exportUntil}]);assert.equal(scheduled.state,'scheduled',JSON.stringify(scheduled));
 const jar=new Jar(),signedIn=jar.apply(await login(jar));assert.equal(signedIn.status,200);const session=await signedIn.json();
 assert.equal(session.scope,'closure-export');assert.equal(session.account.scope,'closure-export');assert.equal(session.closure.exportUntil,exportUntil);
 assert(session.expiresAt<=Date.now()+3600000+1000,'restricted sessions last at most an hour');
 const headers={'X-Bindle-Account':owner,'X-Bindle-Session-Context':session.sessionContext,'X-CSRF-Token':session.csrfToken};
 const who=await f.call('/api/session',{jar,headers});assert.equal(who.status,200);assert.equal((await who.json()).scope,'closure-export');
 const status=await f.call('/api/account/deletion',{jar,headers});assert.equal(status.status,200);const view=await status.json();assert.equal(view.basis,'admin-closure');assert.equal(view.cancellable,false);
 for(const [path,method] of [['/api/account','GET'],['/api/contacts','POST'],['/api/account/deletion','POST'],['/api/account/deletion/cancel','POST'],['/api/messages','GET']]){const r=await f.call(path,{jar,method,value:method==='POST'?{}:undefined,headers});assert([401,403,404].includes(r.status),`${method} ${path} answered ${r.status}`);}
 // Export: list and create (the credential sign-in counts as a fresh step-up for five minutes).
 assert.equal((await f.call('/api/exports',{jar,headers})).status,200);
 const created=await f.call('/api/exports',{jar,method:'POST',value:{operationId:crypto.randomUUID()},headers});assert.equal(created.status,200,await created.clone().text());
 // Reopening (or the window ending) ends restricted access; sign-out works for the restricted session.
 assert.equal((await f.call('/api/auth/logout',{jar,method:'POST',value:{},headers})).status,200);
 assert.equal((await f.call('/api/exports',{jar,headers})).status,401);
});
