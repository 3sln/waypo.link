// DX-3 workerd and Node parity (docs/architecture/account-deletion-export.md §2.3 "Node parity", §8.3): a long owner
// deletion (thousands of refs, budget 64) continues through Durable Object alarms over real SQLite-backed DO storage
// (no purgeAll: the Worker deleteAll branch) and R2, and the same scenario on Node (SqliteMetadata, FileBucket) ends
// in the same state. The probe objects compose the same DeletionService the account slice uses; the full
// AccountObject alarm wiring is a coordinator hunk (accounts.mjs) and is not exercised here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteMetadata,FileBucket} from '../../apps/node/resources.mjs';
import {IdentityRepository} from '../../packages/runtime/accounts.mjs';
import {lifecycleIdentityPort} from '../../packages/identity/lifecycle-tombstone.mjs';
import {DeletionService,deletionDueIndex,armAlarm} from '../../packages/runtime/account-deletion.mjs';

const BANNER="import * as util from 'node:util'; import * as fs from 'node:fs'; import * as stream from 'node:stream'; import * as buffer from 'node:buffer'; import * as nodeAssertBuiltin from 'node:assert'; import * as zlib from 'node:zlib'; import * as nodeCrypto from 'node:crypto'; import * as nodeHttps from 'node:https'; import * as nodeUrl from 'node:url'; import * as nodeHttp from 'node:http'; import * as nodeNet from 'node:net'; import * as nodeTls from 'node:tls'; const nodeModules={'node:util':util,'node:fs':fs,'node:stream':stream,'node:buffer':buffer,'node:assert':nodeAssertBuiltin,'node:zlib':zlib,'node:crypto':nodeCrypto,'node:https':nodeHttps,'node:url':nodeUrl,'node:http':nodeHttp,'node:net':nodeNet,'node:tls':nodeTls}; const require=name=>{if(!nodeModules[name])throw new Error('Unexpected builtin '+name);return nodeModules[name].default??{...nodeModules[name]};};";
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',REFS=2000,DAY=86400000;
const identityRecord=now=>({id:OWNER,handle:'parity.owner1234',assignmentId:'assignment-1',status:'active',createdAt:now-DAY,revision:1,verifiedEmail:null,emailVerifiedAt:null,sessions:[{id:'s'}],credentials:[{id:'c'}],passwordHash:'h',recoveryHash:'r',audit:[]});
const input={confirmHandle:'parity.owner1234',acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-parity-0123456789'};
// Shared by both runtimes: the same ports, flags and service options.
const probeSource=`
import {DurableObject} from 'cloudflare:workers';
import {DeletionService,deletionDueIndex,armAlarm} from './packages/runtime/account-deletion.mjs';
import {lifecycleIdentityPort} from './packages/identity/lifecycle-tombstone.mjs';
const OWNER='${OWNER}';
export class IdentityProbe extends DurableObject{
 async seed(record){await this.ctx.storage.put('account/'+record.id,record);}
 async get(id){return this.ctx.storage.get('account/'+id);}
 async compareAndSwap(id,revision,account){return this.ctx.storage.transaction(async tx=>{const old=await tx.get('account/'+id);if(!old||old.revision!==revision||old.handle!==account.handle||old.assignmentId!==account.assignmentId)return false;await tx.put('account/'+id,account);return true;});}
 async put(name,value){await this.ctx.storage.put(name,value);}
 async delete(name){await this.ctx.storage.delete(name);}
 async list(options){return this.ctx.storage.list(options);}
}
export class DeletionProbe extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.offset=0;this.alarms=0;}
 now(){return Date.now()+this.offset;}
 service(){
  const identity=this.env.IDENTITY.get(this.env.IDENTITY.idFromName('identity'));
  const repository={get:id=>identity.get(id),compareAndSwap:(id,revision,account)=>identity.compareAndSwap(id,revision,account)};
  const directory={put:(k,v)=>identity.put(k,v),delete:k=>identity.delete(k),list:o=>identity.list(o)};
  const clock={now:()=>this.now()};
  const ports={identity:lifecycleIdentityPort(repository,{clock:clock.now}),security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,
   notices:{deliver:async()=>({accepted:true})},erasure:{federation:null,mcp:null,emailBridge:null,operatorApps:null},exports:null,due:deletionDueIndex(directory)};
  const executor={metadata:this.ctx.storage,blobs:this.env.BLOBS,archives:this.env.ARCHIVES,config:{}};
  return new DeletionService({executor,ports,flags:{for:()=>({enabled:()=>true,background:()=>true,global:()=>true})},clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},budget:64,busyMs:20,
   wake:async time=>armAlarm(this.ctx.storage,Date.now()+Math.max(1,time-this.now()),Date.now())});
 }
 async seed(refs){
  await this.ctx.storage.put('owner',OWNER);
  for(let i=0;i<refs;i+=100){const batch={};for(let j=i;j<Math.min(refs,i+100);j++){batch['hosted-object/res/f'+String(j).padStart(5,'0')]={blobRef:'objects/'+OWNER+'/res/v'+j};}await this.ctx.storage.put(batch);}
  await Promise.all(Array.from({length:refs},(_,j)=>this.env.BLOBS.put('objects/'+OWNER+'/res/v'+j,'d')));
  await this.ctx.storage.put('foreign-reference',{blobRef:'objects/${FOREIGN}/res/v1'});await this.env.BLOBS.put('objects/${FOREIGN}/res/v1','other');
 }
 async request(input){return this.service().request({kind:'owner',owner:OWNER,stepUpAt:this.now()-1000},input);}
 async jump(ms){this.offset+=ms;await this.ctx.storage.setAlarm(Date.now()+1);}
 async alarm(){this.alarms++;await this.service().step({kind:'system',owner:OWNER,reason:'alarm'});}
 async state(){return {rows:[...(await this.ctx.storage.list()).keys()],tombstone:await this.ctx.storage.get('lifecycle/tombstone-v1'),alarms:this.alarms,alarm:await this.ctx.storage.getAlarm()};}
}
export default {fetch(){return new Response('probe');}};`;

async function waitFor(check,{timeout=90000,interval=100}={}){const end=Date.now()+timeout;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw new Error('timed out');await new Promise(resolve=>setTimeout(resolve,interval));}}

test('workerd: a long owner deletion continues through Durable Object alarms to a tombstone (deleteAll branch, R2)',{timeout:180000},async t=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'3sln-deletion-'));t.after(()=>rm(temporary,{recursive:true,force:true}));
 const out=path.join(temporary,'probe.mjs');
 await build({stdin:{contents:probeSource,resolveDir:process.cwd(),sourcefile:'probe.mjs'},outfile:out,bundle:true,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],target:'es2022',logLevel:'silent',
  // The same builtin shims as tests/worker/harness.mjs.
  banner:{js:BANNER},plugins:[{name:'worker-test-imports',setup(b){b.onResolve({filter:/^(?:util|fs|stream|buffer|assert|zlib|crypto|https|url|http|net|tls)$/},args=>({path:`node:${args.path}`,external:true}));}}]});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'deletion-probe',modulesRoot:temporary,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),durableObjects:{ACCOUNT:{className:'DeletionProbe',useSQLite:true},IDENTITY:{className:'IdentityProbe',useSQLite:true}},r2Buckets:["BLOBS","ARCHIVES"]}));
 t.after(()=>mf.dispose());
 const accounts=await mf.getDurableObjectNamespace('ACCOUNT'),identities=await mf.getDurableObjectNamespace('IDENTITY');
 const account=accounts.get(accounts.idFromName(OWNER)),identity=identities.get(identities.idFromName('identity'));
 await identity.seed(identityRecord(Date.now()));await account.seed(REFS);
 const scheduled=await account.request(input);assert.equal(scheduled.state,'scheduled');assert.equal(scheduled.graceDays,14);
 const due=[...(await identity.list({prefix:'deletion-due/'})).keys()];assert.equal(due.length,1);
 // Jump the object's clock past the deadline; alarms then commit and drive every batch.
 await account.jump(15*DAY);
 const final=await waitFor(async()=>{const state=await account.state();return state.tombstone?state:null;});
 assert.deepEqual(final.rows.sort(),['lifecycle/tombstone-v1','owner']);
 assert.equal(final.tombstone.reason,'owner');assert.equal(final.tombstone.deletedBlobs,REFS);assert.equal(final.tombstone.foreignReferences,1);
 assert(final.alarms>REFS/64,`expected alarm continuation across batches, got ${final.alarms} alarms`);
 const blobs=await mf.getR2Bucket('BLOBS');
 assert.equal((await blobs.list({prefix:`objects/${OWNER}/`})).objects.length,0);assert.notEqual(await blobs.get(`objects/${FOREIGN}/res/v1`),null);
 const deleted=await identity.get(OWNER);assert.equal(deleted.status,'deleted');assert.equal(deleted.handle,'parity.owner1234');assert.deepEqual(deleted.sessions,[]);
 assert.equal([...(await identity.list({prefix:'deletion-due/'})).keys()].length,0);
 globalThis.workerdParity={rows:final.rows.sort(),deletedBlobs:final.tombstone.deletedBlobs,foreignReferences:final.tombstone.foreignReferences,reason:final.tombstone.reason};
});

test('Node parity: the same deletion over SqliteMetadata, FileBucket and the Node alarm emulation ends identically',{timeout:180000},async t=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'3sln-deletion-node-'));t.after(()=>rm(temporary,{recursive:true,force:true}));
 const metadata=new SqliteMetadata(':memory:'),idDb=new SqliteMetadata(':memory:');t.after(()=>{metadata.close();idDb.close();});
 const blobs=new FileBucket(path.join(temporary,'blobs')),archives=new FileBucket(path.join(temporary,'archives'));
 let offset=0;const clock={now:()=>Date.now()+offset},repository=new IdentityRepository({metadata:idDb,config:{}});
 assert.equal(await repository.create(identityRecord(Date.now())),true);
 const ports={identity:lifecycleIdentityPort(repository,{clock:clock.now}),security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,
  notices:{deliver:async()=>({accepted:true})},erasure:{federation:null,mcp:null,emailBridge:null,operatorApps:null},exports:null,due:deletionDueIndex(idDb)};
 let alarms=0,finished;const done=new Promise(resolve=>{finished=resolve;});
 const service=new DeletionService({executor:{metadata,blobs,archives,config:{}},ports,flags:{for:()=>({enabled:()=>true,background:()=>true,global:()=>true})},clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},budget:64,busyMs:5,
  wake:time=>armAlarm(metadata,Date.now()+Math.max(1,time-clock.now()),Date.now())});
 // The Node account alarm emulation: SqliteMetadata.setAlarm arms a timer that calls onAlarm.
 metadata.onAlarm=async()=>{alarms++;const out=await service.step({kind:'system',owner:OWNER,reason:'alarm'});if(out.action==='deleted')finished();};
 await metadata.put('owner',OWNER);
 for(let j=0;j<REFS;j++){await metadata.put('hosted-object/res/f'+String(j).padStart(5,'0'),{blobRef:`objects/${OWNER}/res/v${j}`});}
 for(let j=0;j<REFS;j+=50)await Promise.all(Array.from({length:Math.min(50,REFS-j)},(_,k)=>blobs.put(`objects/${OWNER}/res/v${j+k}`,'d')));
 await metadata.put('foreign-reference',{blobRef:`objects/${FOREIGN}/res/v1`});await blobs.put(`objects/${FOREIGN}/res/v1`,'other');
 const scheduled=await service.request({kind:'owner',owner:OWNER,stepUpAt:clock.now()-1000},input);assert.equal(scheduled.state,'scheduled');
 offset=15*DAY;await metadata.setAlarm(Date.now()+1);
 let timer;await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Node alarm continuation timed out')),150000);})]).finally(()=>clearTimeout(timer));
 const rows=[...(await metadata.list({prefix:''})).keys()].filter(k=>k!=='@alarm').sort(),tombstone=await metadata.get('lifecycle/tombstone-v1');
 assert.deepEqual(rows,['lifecycle/tombstone-v1','owner']);assert(alarms>REFS/64);
 assert.equal(await blobs.get(`objects/${OWNER}/res/v0`),null);assert.notEqual(await blobs.get(`objects/${FOREIGN}/res/v1`),null);
 assert.equal((await repository.get(OWNER)).status,'deleted');
 const node={rows,deletedBlobs:tombstone.deletedBlobs,foreignReferences:tombstone.foreignReferences,reason:tombstone.reason};
 assert.deepEqual(node,{rows:['lifecycle/tombstone-v1','owner'],deletedBlobs:REFS,foreignReferences:1,reason:'owner'});
 if(globalThis.workerdParity)assert.deepEqual(node,globalThis.workerdParity,'workerd and Node end in the same state');
});

test('Worker adapter: deletion ports are wired; request, scheduler due index, cancel, and the bridge and federation erasers',{timeout:180000},async t=>{
 const {createHarness}=await import('./harness.mjs');
 const h=await createHarness({bindings:{ACCOUNT_DELETION_ENABLED:'true'}});t.after(()=>h.close());
 const {result}=await h.signup(),owner=result.account.id,handle=(await h.directory.get(owner)).handle,account=h.accounts.get(h.accounts.idFromName(owner));
 const refused=await account.invoke({method:'deletionRequest',args:[owner,{...input,confirmHandle:handle},{stepUpAt:Date.now()-400000}]});assert.equal(refused.$fault.code,'step_up_required');
 const scheduled=await account.invoke({method:'deletionRequest',args:[owner,{...input,confirmHandle:handle},{stepUpAt:Date.now()-1000}]});
 assert.equal(scheduled.state,'scheduled',JSON.stringify(scheduled));assert.equal(scheduled.cancellable,true);
 const scheduler=await h.mf.getDurableObjectNamespace('LIFECYCLE_SCHEDULER'),sweep=scheduler.get(scheduler.idFromName('lifecycle-sweep-v1'));
 const swept=await sweep.run({trigger:'cron'});assert.equal(swept.mode,'off');
 assert.equal((await account.invoke({method:'deletionStatus',args:[owner]})).state,'scheduled');
 assert.equal((await account.invoke({method:'deletionCancel',args:[owner]})).state,'cancelled');
 // E5b and E3 erasers over the real objects: an unbound store holds nothing; a bound bridge instance is emptied.
 const bridge=await h.mf.getDurableObjectNamespace('EMAIL_BRIDGE'),stub=bridge.get(bridge.idFromName(`owner/${owner}`));
 assert.equal((await stub.erase(owner)).erased,true);
 const federation=await h.mf.getDurableObjectNamespace('FEDERATION'),shard=federation.get(federation.idFromName(`bindle-federation-v1/${owner}`));
 const erased=await shard.eraseSubject(owner);assert.equal(erased.absent,true);assert.equal(erased.deleted,0);
});
