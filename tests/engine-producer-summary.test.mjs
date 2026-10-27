import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {cryptoRandom,nullAudit} from '../packages/app/providers.mjs';
import {ProducerSummaryService,RemovalRemaining,RemovalRemainingAction,producerSummaryProvider,producerAttribution,PRODUCER_DELETION,PRODUCER_KEEP,PRODUCER_LINEAGE,PRODUCER_GC,KEEP_ROWS_PER_REMOVAL,lineageRow} from '../packages/storage/producer-summary.mjs';
import {methods} from '../packages/runtime/account/storage.mjs';
import {GoogleDriveService} from '../packages/storage/google-drive.mjs';
import {AccountItemIndex} from '../packages/runtime/item-index.mjs';
import {createExportContributors,exportInventory} from '../packages/runtime/export-contributors.mjs';
import {mcpOperation} from '../packages/mcp/account.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor={kind:'owner',owner};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setTimeout(r,5));
const connection=(db,id,generation,status='active')=>db.put('resource/'+id,{id,owner,kind:'app-connection',provider:'app',status,generation,clientId:`https://${id}.example/client`});
const by=(id,generation,key)=>producerAttribution({id,generation},{},key);
function hostedController(db,extra={}){
 const blobs=new Map();let hold=null,holds=0;
 return {metadata:db,blobStore:blobs,blobs:{put:async(k,b)=>{if(holds>0){holds--;await hold;}blobs.set(k,b);},get:async k=>blobs.has(k)?{arrayBuffer:async()=>blobs.get(k).slice().buffer}:null,delete:async k=>{blobs.delete(k);}},quota:{check:async()=>{},reserve:async()=>({id:'reservation'}),commit:async()=>{},release:async()=>{}},admitWork:async()=>{},scheduleAlarm:async()=>{},
  // Stalls only the next `count` blob writes; later writes proceed.
  stall(count=1){const d=deferred();hold=d.promise;holds=count;return ()=>{holds=0;d.resolve();};},...extra};
}
const hostedResource={id:'files',owner,provider:'hosted',capabilities:{}};
const hostedPut=(c,key,{condition,producer,data='data'})=>methods.hostedOperation.call(c,hostedResource,'put',{key,condition,dataBase64:Buffer.from(data).toString('base64')},undefined,'client',false,producer);
function driveHarness(db){
 const files=new Map();let next=0,hold=null,holds=0;
 const fetcher=async(value,options={})=>{const url=new URL(value);if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'});if(url.pathname==='/drive/v3/about')return Response.json({user:{permissionId:'principal_1'}});if(url.pathname.endsWith('/generateIds'))return Response.json({ids:['file_'+(++next)]});if(options.method==='POST'&&url.pathname==='/drive/v3/files'){const m=JSON.parse(options.body);files.set(m.id,m);return Response.json({id:m.id});}
  if(url.pathname==='/upload/drive/v3/files'){if(holds>0){holds--;await hold;}const raw=new TextDecoder().decode(options.body),start=raw.indexOf('{'),end=raw.indexOf('\r\n--',start),m=JSON.parse(raw.slice(start,end));files.set(m.id,m);return Response.json({id:m.id});}return new Response('',{status:404});};
 const service=new GoogleDriveService({metadata:db,fetcher,config:{APP_ORIGIN:'https://identity.example',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',KEY_ENCRYPTION_KEY:btoa('k'.repeat(32))}});
 return {service,files,stall(count=1){const d=deferred();hold=d.promise;holds=count;return ()=>{holds=0;d.resolve();};},async connect(){const begin=await service.begin(owner,'session','Drive');return service.complete(owner,'session',{state:new URL(begin.url).searchParams.get('state'),code:'code'});}};
}
const drivePut=(h,id,key,{condition,producer,data='data'})=>h.service.put(owner,id,{key,bytes:new TextEncoder().encode(data),condition,producer});
// Real executors; `commit` runs inside each adapter's delete transaction.
const executor=({hosted,drive,after=async()=>{}})=>async({resource,object,commit})=>{const result=resource.provider==='hosted'?await methods.hostedOperation.call(hosted,resource,'delete',{key:object.key,version:object.version},undefined,'@system',false,undefined,{commit}):await drive.service.delete(owner,resource.id,{key:object.key,version:object.version},{commit});await after();return result;};
async function base(t,{generation=1}={}){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());await db.put('owner',owner);await db.put('resource/files',hostedResource);
 const removal={removal:'removed',entity:owner,connection:'app',generation,state:'forced'};await db.put('app-removal/record/removed',removal);return {db,removal};
}
const engineFor=service=>createAppEngine({providers:{clock:{now:Date.now},random:cryptoRandom,audit:nullAudit,producerSummary:producerSummaryProvider(service)}});
// Synthetic rows for summary/deletion logic: `created` is the creating generation of 'app', or null for an owner/other creator.
async function fixture(t){
 const {db,removal}=await base(t);let crash=false,calls=0;
 const service=new ProducerSummaryService({metadata:db,deleteObject:async({resource,object,commit})=>{calls++;const path='hosted/'+resource.id+'/'+encodeURIComponent(object.key);await db.transaction(async tx=>{const live=await tx.get(path);if(live?.version!==object.version)throw Object.assign(Error(),{code:'conflict'});await tx.delete(path);await commit(tx);});if(crash){crash=false;throw Error('crash after effect');}}});
 const engine=engineFor(service);
 return {db,service,removal,crash:()=>{crash=true;},calls:()=>calls,
  put:async(key,generation=1,size=5,{created=generation,connection='app'}={})=>db.put('hosted/files/'+encodeURIComponent(key),{key,version:crypto.randomUUID(),size,producer:{connection,generation,prefix:'notes/'},...created===null?{}:{createdBy:{connection,generation:created}}}),
  query:input=>read(engine,new RemovalRemaining({actor,input:{removal:'removed',...input}})),act:input=>perform(engine,new RemovalRemainingAction({actor,input:{removal:'removed',...input}}))};
}
const until=async act=>{let r;do{r=await act();}while(!r.complete);return r;};

test('engine producer summaries split created from last-changed files and expose no names',async t=>{const f=await fixture(t);await f.put('notes/a',1,4);await f.put('notes/b',1,7);await f.put('notes/c',1,3,{created:null});await f.put('notes/new',3,9);const r=await f.query();assert.deepEqual(r.resources[0].prefixes,[{prefix:'notes/',items:3,bytes:14}]);assert.deepEqual(r.resources[0].created,{items:2,bytes:11});assert.deepEqual(r.resources[0].changed,{items:1,bytes:3});assert.equal(r.resources[0].deletable,true);assert.ok(!JSON.stringify(r).includes('notes/a'));assert.deepEqual(r.transports,['bindle','mcp']);assert.deepEqual(producerAttribution({id:'app',generation:2},{prefix:'notes/deep/'}),{connection:'app',generation:2,prefix:'notes/'});});

test('engine bounded deletion resumes after crash, counts exactly and never deletes a reinstall generation',async t=>{const f=await fixture(t);for(let i=0;i<9;i++)await f.put('notes/'+i);await f.put('notes/new',3);f.crash();await assert.rejects(f.act({action:'delete',limit:3}),/crash/);const r=await until(async()=>{const r=await f.act({action:'delete',limit:3});assert.ok(r.scanned<=3);assert.equal(r.cursor,undefined);return r;});assert.equal(r.totalDeleted,9);assert.equal((await f.query()).resources.length,0);assert.ok(await f.db.get('hosted/files/notes%2Fnew'));const calls=f.calls();assert.equal((await f.act({action:'delete',limit:3})).deleted,0);assert.equal(f.calls(),calls);});

test('M1: a completed deletion is not terminal; a later request starts a new pass for newly found rows',async t=>{const f=await fixture(t);await f.put('notes/a');const done=await until(()=>f.act({action:'delete',resource:'files'}));assert.equal(done.totalDeleted,1);assert.equal(done.passes,1);await f.put('notes/late');assert.equal((await f.query()).resources[0].created.items,1);const again=await until(()=>f.act({action:'delete',resource:'files'}));assert.equal(again.deleted,1);assert.equal(again.totalDeleted,2);assert.equal(again.passes,2);assert.equal(await f.db.get('hosted/files/notes%2Flate'),undefined);});

test('M3: Delete excludes files the app changed but did not create unless the owner opts in',async t=>{const f=await fixture(t);await f.put('notes/owner-made',1,4,{created:null});await f.put('notes/other-made',1,4,{created:2});await f.put('notes/app-made',1,4);let r=await until(()=>f.act({action:'delete',resource:'files'}));assert.equal(r.totalDeleted,1);assert.equal(r.skipped.changed,2);assert.ok(await f.db.get('hosted/files/notes%2Fowner-made'));assert.ok(await f.db.get('hosted/files/notes%2Fother-made'));r=await until(()=>f.act({action:'delete',resource:'files',includeChanged:true}));assert.equal(r.includeChanged,true);assert.equal(await f.db.get('hosted/files/notes%2Fowner-made'),undefined);await assert.rejects(f.act({action:'delete',includeChanged:'yes'}),{code:'invalid_request'});});

test('engine keep/export do not delete, foreign owners and pending removals refused',async t=>{const f=await fixture(t);await f.put('notes/a');await f.act({action:'keep',resource:'files'});assert.equal((await f.query()).resources[0].items,1);assert.deepEqual((await f.query()).keeps.map(k=>[k.resource,k.active]),[['files',true]]);assert.equal((await f.act({action:'export'})).exportRequired,true);await assert.rejects(read(engineFor(f.service),new RemovalRemaining({actor:{kind:'owner',owner:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},input:{removal:'removed'}})),{code:'forbidden'});await f.db.put('app-removal/record/removed',{...f.removal,state:'pending'});await assert.rejects(f.act({action:'delete'}),{code:'removal_pending'});});

test('L3: keep is stored apart from deletion, stops an unfinished job and protects data from a later removal of a reinstall',async t=>{
 const f=await fixture(t);for(let i=0;i<4;i++)await f.put('notes/kept'+i,1);
 const partial=await f.act({action:'delete',resource:'files',limit:1});assert.equal(partial.complete,false);assert.equal(partial.totalDeleted,1);
 await f.act({action:'keep',resource:'files'});const keepRows=[...(await f.db.list({prefix:PRODUCER_KEEP})).entries()];assert.equal(keepRows.length,1);assert.equal(keepRows[0][1].generation,1);
 const job=(await f.query()).deletions.find(j=>j.resource==='files');assert.equal(job.stopped,true);assert.equal(job.totalDeleted,1);
 // Reinstall at generation 3, which writes more data, then a second removal covering generations up to 3.
 for(let i=0;i<2;i++)await f.put('notes/new'+i,3);await f.put('notes/kept0',3,5,{created:1});
 const second={removal:'second',entity:owner,connection:'app',generation:3,state:'forced'};await f.db.put('app-removal/record/second',second);
 const act=input=>perform(engineFor(f.service),new RemovalRemainingAction({actor,input:{removal:'second',...input}}));
 const summary=await read(engineFor(f.service),new RemovalRemaining({actor,input:{removal:'second'}}));assert.equal(summary.resources[0].kept.items,4);assert.equal(summary.resources[0].created.items,2);
 let r=await until(()=>act({action:'delete',resource:'files'}));assert.equal(r.totalDeleted,2);assert.equal(r.skipped.kept,4);for(let i=1;i<4;i++)assert.ok(await f.db.get('hosted/files/notes%2Fkept'+i));assert.ok(await f.db.get('hosted/files/notes%2Fkept0'));
 // Choosing again: an explicit opt-in deletes kept data.
 r=await until(()=>act({action:'delete',resource:'files',includeKept:true}));assert.equal(r.totalDeleted,6);assert.equal((await f.db.list({prefix:'hosted/files/'})).size,0);
 // Deleting under the same removal supersedes its own keep choice.
 await f.put('notes/again',1);await f.act({action:'delete',resource:'files'});assert.equal((await f.query()).keeps[0].active,false);
});

test('I1: summary bounds prefixes; cursors are opaque, removal-bound and never expose names or paths',async t=>{const f=await fixture(t);for(let i=0;i<75;i++)await f.db.put('hosted/files/secret-'+i,{key:'secret-'+i,version:String(i),size:1,producer:{connection:'app',generation:1,prefix:'p'+i+'/'},createdBy:{connection:'app',generation:1}});const r=await f.query();assert.equal(r.resources[0].prefixes.length,65);assert.equal(r.resources[0].items,75);let cursor=null,total=0,seen=[];do{const page=await f.query({limit:7,cursor});total+=page.resources.reduce((n,r)=>n+r.items,0);cursor=page.cursor;if(cursor)seen.push(cursor);}while(cursor);assert.equal(total,75);for(const c of seen){assert.doesNotMatch(c,/secret|hosted|files/);assert.doesNotMatch(Buffer.from(c.split('.')[1]??'','base64url').toString('latin1'),/secret|hosted/);}
 await assert.rejects(f.query({cursor:JSON.stringify({removal:'removed',root:0,after:'hosted/files/secret-1'})}),{code:'invalid_cursor'});await f.db.put('app-removal/record/other',{...f.removal,removal:'other'});await assert.rejects(read(engineFor(f.service),new RemovalRemaining({actor,input:{removal:'other',limit:7,cursor:seen[0]}})),{code:'invalid_cursor'});const tampered=seen[0].slice(0,-2)+(seen[0].endsWith('A')?'BB':'AA');await assert.rejects(f.query({cursor:tampered}),{code:'invalid_cursor'});
 const job=await f.act({action:'delete',limit:3});assert.equal(job.cursor,undefined);assert.ok((await f.query()).deletions.every(d=>d.cursor===undefined));});

test('L2: disconnected storage is marked not deletable here, skips are counted and permanent errors advance the job',async t=>{
 const f=await fixture(t);await f.db.put('drive/object/gone/h1',{key:'x',version:'v1',size:3,producer:{connection:'app',generation:1,prefix:''},createdBy:{connection:'app',generation:1}});await f.put('notes/a');
 const r=await f.query();const gone=r.resources.find(v=>v.resource==='gone');assert.equal(gone.deletable,false);assert.equal(gone.reason,'unavailable');
 await assert.rejects(f.act({action:'delete',resource:'gone'}),{code:'not_deletable'});await f.act({action:'keep',resource:'gone'});
 const all=await until(()=>f.act({action:'delete'}));assert.equal(all.skipped.unavailable,1);assert.equal(all.totalDeleted,1);
 await f.db.put('resource/drive2',{id:'drive2',owner,provider:'google-drive',status:'reauthorization_required'});await f.db.put('drive/object/drive2/h',{key:'y',version:'v',size:1,producer:{connection:'app',generation:1,prefix:''},createdBy:{connection:'app',generation:1}});assert.equal((await f.query()).resources.find(v=>v.resource==='drive2').reason,'reconnect');
 // A permanent executor refusal is counted and checkpointed past instead of wedging the job.
 for(let i=0;i<3;i++)await f.put('notes/p'+i);const failing=new ProducerSummaryService({metadata:f.db,deleteObject:async()=>{throw Object.assign(Error('limit'),{code:'retention_limit'});}});
 const result=await until(()=>failing.act(f.removal,{action:'delete',resource:'files',limit:2}));assert.equal(result.skipped.failed,3);assert.equal(result.totalDeleted,0);
 const transient=new ProducerSummaryService({metadata:f.db,deleteObject:async()=>{throw Object.assign(Error('later'),{code:'temporarily_unavailable'});}});await assert.rejects(transient.act(f.removal,{action:'delete',resource:'files'}),/later/);
});

test('suspend/resume generation advances retain earlier attribution while newer reinstall remains fenced',async t=>{const f=await fixture(t);await f.put('notes/old',1,4);await f.put('notes/resumed',2,7);await f.put('notes/reinstalled',4,9);await f.db.put('app-removal/record/removed',{...f.removal,generation:2});assert.equal((await f.query()).resources[0].items,2);await until(()=>f.act({action:'delete',limit:2}));assert.equal((await f.db.list({prefix:'hosted/files/'})).size,1);assert.equal((await f.db.get('hosted/files/notes%2Freinstalled')).producer.generation,4);assert.equal(producerAttribution({id:'app',generation:1},{prefix:'/'},'flat').prefix,'');});

test('persisted per-resource deletion remains discoverable after service restart',async t=>{const f=await fixture(t);for(let i=0;i<4;i++)await f.put('notes/'+i);await f.act({action:'delete',resource:'files',limit:1});const restarted=new ProducerSummaryService({metadata:f.db,deleteObject:async()=>{}}),summary=await restarted.summary(f.removal);assert.ok(summary.deletions.some(row=>row.resource==='files'&&row.action==='delete'&&!row.complete));});

test('M3 real hosted adapter: markers stay in the existing record, createdBy survives overwrites, catalog and reads omit them',async t=>{
 const {db}=await base(t),itemIndex=new AccountItemIndex(db.sql),c=hostedController(db,{itemIndex});await connection(db,'app',1);await connection(db,'other',1);
 const svc=new ProducerSummaryService({metadata:db,deleteObject:executor({hosted:c})}),removal=await db.get('app-removal/record/removed');
 let object=await hostedPut(c,'notes/a',{condition:{absent:true},producer:by('app',1,'notes/a'),data:'first'});assert.equal(object.object.producer,undefined);assert.equal(object.object.createdBy,undefined);
 object=await hostedPut(c,'notes/a',{condition:{version:object.object.version},producer:by('other',1,'notes/a'),data:'second'});assert.equal((await svc.summary(removal)).resources.length,0);
 object=await hostedPut(c,'notes/a',{condition:{version:object.object.version},data:'owner'});const row=await db.get('hosted/files/notes%2Fa');assert.equal(row.producer,undefined);assert.deepEqual(row.createdBy,{connection:'app',generation:1});
 // Owner-created file later overwritten by the app: counted as changed, never deleted by default.
 const owned=await hostedPut(c,'notes/owner',{condition:{absent:true},data:'mine'});await hostedPut(c,'notes/owner',{condition:{version:owned.object.version},producer:by('app',1,'notes/owner'),data:'app edit'});
 const summary=await svc.summary(removal);assert.deepEqual(summary.resources[0].changed,{items:1,bytes:8});assert.equal(summary.resources[0].created.items,0);
 let r=await until(()=>svc.act(removal,{action:'delete',resource:'files'}));assert.equal(r.totalDeleted,0);assert.ok(await db.get('hosted/files/notes%2Fowner'));
 // I2: the SQL catalog row and owner object page carry no marker.
 assert.ok([...db.sql.exec('SELECT record FROM hosted_catalog')].every(v=>!/producer|createdBy/.test(v.record)));
 db.sql.exec('INSERT INTO hosted_catalog(resource,object_key,record) VALUES(?,?,?)','files','legacy',JSON.stringify({key:'legacy',version:'v',producer:{connection:'app',generation:1},createdBy:{connection:'app',generation:1}}));
 const page=itemIndex.objectPage('files',{});assert.ok(page.objects.some(o=>o.key==='legacy'));for(const o of page.objects){assert.equal(o.producer,undefined);assert.equal(o.createdBy,undefined);}
 const read=await methods.hostedOperation.call(c,hostedResource,'get',{key:'notes/owner'});assert.equal(read.object.producer,undefined);assert.equal(read.object.createdBy,undefined);
 r=await until(()=>svc.act(removal,{action:'delete',resource:'files',includeChanged:true}));assert.equal(r.totalDeleted,1);
 // Final delete transaction fences a racing replacement.
 await connection(db,'app',3);const old=object.object.version;await assert.rejects(methods.hostedOperation.call(c,hostedResource,'delete',{key:'notes/a',version:old},async()=>{await hostedPut(c,'notes/a',{condition:{version:old},producer:by('app',3,'notes/a'),data:'new reinstall'});}),{code:'conflict'});
 assert.equal((await db.get('hosted/files/notes%2Fa')).producer.generation,3);
});

test('M1 hosted: the put condition is rechecked inside the commit transaction (stalled blob write)',async t=>{
 const {db}=await base(t),c=hostedController(db),first=await hostedPut(c,'notes/a',{condition:{absent:true},data:'v1'});
 const release=c.stall(2),a=hostedPut(c,'notes/a',{condition:{version:first.object.version},data:'a'}),b=hostedPut(c,'notes/a',{condition:{version:first.object.version},data:'b'});await tick();release();
 const results=await Promise.allSettled([a,b]);assert.equal(results.filter(v=>v.status==='fulfilled').length,1);assert.equal(results.find(v=>v.status==='rejected').reason.code,'conflict');
 assert.equal((await db.get('hosted-usage')).objects,1);assert.ok([...(await db.list({prefix:'blob-garbage/'})).values()].length>=2);
});

test('M1 hosted: an in-flight old-generation write cannot reappear after removal and deletion',async t=>{
 const {db,removal}=await base(t),c=hostedController(db);await connection(db,'app',1);const svc=new ProducerSummaryService({metadata:db,deleteObject:executor({hosted:c})});
 const a=await hostedPut(c,'notes/a',{condition:{absent:true},producer:by('app',1,'notes/a')});
 const release=c.stall(2),inflight=hostedPut(c,'notes/a',{condition:{version:a.object.version},producer:by('app',1,'notes/a')}),fresh=hostedPut(c,'notes/fresh',{condition:{absent:true},producer:by('app',1,'notes/fresh')});await tick();
 await connection(db,'app',1,'disconnected');const done=await until(()=>svc.act(removal,{action:'delete',resource:'files'}));assert.equal(done.totalDeleted,1);
 release();await assert.rejects(inflight,{code:'conflict'});await assert.rejects(fresh,{code:'invalid_token'});
 assert.equal(await db.get('hosted/files/notes%2Fa'),undefined);assert.equal(await db.get('hosted/files/notes%2Ffresh'),undefined);assert.equal((await svc.summary(removal)).resources.length,0);
 // A reinstall generation bump also fences writes that started under the old generation.
 await connection(db,'app',2);const r2=c.stall(),stale=hostedPut(c,'notes/b',{condition:{absent:true},producer:by('app',1,'notes/b')});await tick();await connection(db,'app',3);r2();await assert.rejects(stale,{code:'invalid_token'});
});

test('M1 Drive: publication rechecks the app connection; retained versions drop markers; deletion counts in the delete transaction',async t=>{
 const {db,removal}=await base(t),drive=driveHarness(db),resource=await drive.connect();await connection(db,'app',1);const svc=new ProducerSummaryService({metadata:db,deleteObject:executor({drive})});
 const first=await drivePut(drive,resource.id,'notes/a',{condition:{absent:true},producer:by('app',1,'notes/a')});
 const second=await drivePut(drive,resource.id,'notes/a',{condition:{version:first.version},data:'owner'});const path=await drive.service.path(resource.id,'notes/a');assert.equal((await db.get(path)).producer,undefined);assert.deepEqual((await db.get(path)).createdBy,{connection:'app',generation:1});
 await drivePut(drive,resource.id,'notes/b',{condition:{absent:true},producer:by('app',1,'notes/b')});
 const release=drive.stall(),inflight=drivePut(drive,resource.id,'notes/c',{condition:{absent:true},producer:by('app',1,'notes/c')});await tick();await connection(db,'app',1,'disconnected');
 const done=await until(()=>svc.act(removal,{action:'delete',resource:resource.id}));assert.equal(done.totalDeleted,1);assert.equal(done.skipped.changed??0,0);
 release();await assert.rejects(inflight,{code:'invalid_token'});assert.equal(await db.get(await drive.service.path(resource.id,'notes/c')),undefined);
 for(const [,row]of await db.list({prefix:'drive/retained/'})){assert.equal(row.producer,undefined);assert.equal(row.createdBy,undefined);}
 assert.equal((await db.list({prefix:'drive/retained/'})).size,2);assert.ok(second.version);
 // Disconnecting the Drive resource marks remaining rows as not deletable here.
 await connection(db,'app',1,'active');await drivePut(drive,resource.id,'notes/d',{condition:{absent:true},producer:by('app',1,'notes/d')});await drive.service.disconnect(owner,resource.id);
 const summary=await svc.summary(removal);assert.equal(summary.resources.find(r=>r.resource===resource.id).deletable,false);
});

test('L1: MCP storage writes carry the verified connection; federation RPC attributes them and ignores it for other callers',async t=>{
 const calls=[],account={warm:async()=>{},config:{APP_ORIGIN:'https://identity.example'},metadata:{get:async k=>k.startsWith('resource/')?{id:'r',owner,provider:'hosted',status:'connected',capabilities:{read:true,write:true}}:undefined,list:async()=>new Map([['resource/'+'1'.repeat(8)+'-1111-4111-8111-'+'1'.repeat(12),{id:'1'.repeat(8)+'-1111-4111-8111-'+'1'.repeat(12),owner,name:'Files',provider:'hosted',status:'connected',capabilities:{read:true,write:true}}]])},items:{collections:async()=>[]},federationRPC:async(...args)=>{calls.push(args);return {ok:true};}};
 await mcpOperation(account,owner,'https://app.example/client','item_write',{collectionId:'resource:'+'1'.repeat(8)+'-1111-4111-8111-'+'1'.repeat(12),key:'notes/a',dataBase64:'AA==',condition:{absent:true}},{connection:{id:'app',generation:4,extra:'x'}});
 assert.deepEqual(calls[0][2],{connection:{id:'app',generation:4}});
 const {db}=await base(t),resourceId='22222222-2222-4222-8222-222222222222',resource={id:resourceId,owner,provider:'hosted',status:'connected',capabilities:{}};await db.put('resource/'+resourceId,resource);await connection(db,'app',4);
 const c=hostedController(db,{config:{APP_ORIGIN:'https://identity.example'},warm:async()=>{},apps:{check:async()=>{}},hostedOperation:methods.hostedOperation});
 const rpc=(clientId,key,trusted)=>methods.federationRPC.call(c,{subject:'https://identity.example/entities/'+owner,clientId,resource:'https://identity.example/entities/'+owner+'/resources/'+resourceId,contract:'https://3sln.me/artefacts/contracts/object-storage/v1',method:'put',args:{key,condition:{absent:true},dataBase64:'AA=='},tx:crypto.randomUUID()},undefined,trusted);
 await rpc('mcp:https://app.example/client','notes/mcp',{connection:{id:'app',generation:4}});assert.deepEqual((await db.get('hosted/'+resourceId+'/notes%2Fmcp')).producer,{connection:'app',generation:4,prefix:'notes/'});
 await rpc('automation','notes/auto',{connection:{id:'app',generation:4}});assert.equal((await db.get('hosted/'+resourceId+'/notes%2Fauto')).producer,undefined);
});

test('L5: keep and deletion decisions are exported with removal history, never the continuation position',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.put('notes/'+i);await f.act({action:'delete',resource:'files',limit:1});await f.act({action:'keep',resource:'files'});
 const contributor=createExportContributors({accountStore:f.db}).find(v=>v.name==='app-removals');let cursor=null,out=[];do{const page=await contributor.page({owner,cursor,limit:20});out.push(...page.rows.map(r=>r.record));cursor=page.cursor;}while(cursor);
 assert.ok(out.some(r=>r.action==='delete'&&r.resource==='files'&&r.totalDeleted===1));assert.ok(out.some(r=>r.action==='keep'&&r.resource==='files'&&r.active===true));assert.ok(out.every(r=>r.cursor===undefined));assert.doesNotMatch(JSON.stringify(out),/hosted\/files/);
 assert.equal(exportInventory([PRODUCER_DELETION+'x/y'])[0].contributor,'app-removals');assert.equal(exportInventory([PRODUCER_KEEP+'x/y/z'])[0].contributor,'app-removals');assert.match(exportInventory(['storage/producer-cursor-key'])[0].reason,/Secret/);
});

test('seeded real hosted writes, engine force removal, fresh registration and crash recovery fence every reinstall write',async t=>{
 const {AppConnections}=await import('../packages/apps/connections.mjs');
 const {AppRemovalService,appRemovalProvider,ForceRemoval}=await import('../packages/app/domains/app-removal.mjs');
 await forEachSeed(8,async random=>{
  const db=new SqliteMetadata(':memory:');t.after(()=>db.close());await db.put('owner',owner);await db.put('resource/files',hostedResource);
  let now=1000,crash=false;const clock={now:()=>now++},client={id:'https://notes.example/client',name:'Notes'},apps=new AppConnections({metadata:db,origin:'https://provider.example',clock:clock.now,config:{}});
  let conn=await apps.register(owner,client);const id=conn.id,c=hostedController(db);
  const write=async key=>{await apps.check(owner,id,conn.generation,client.id);const current=await db.get('hosted/files/'+encodeURIComponent(key));return hostedPut(c,key,{condition:current?{version:current.version}:{absent:true},producer:by(id,conn.generation,key),data:'bytes-'+random.int(10000)});};
  const removalService=new AppRemovalService({metadata:db,clock,commit:async(tx,{connection,expectedGeneration})=>{const bound={get:k=>tx.get(k),put:(k,v)=>tx.put(k,v),delete:k=>tx.delete(k),list:o=>tx.list(o),transaction:fn=>fn(tx)};await new AppConnections({metadata:bound,origin:'https://provider.example',clock:clock.now,config:{}}).disconnect(owner,connection,{expectedGeneration});return {committed_at:clock.now(),access_ends_by:clock.now()};}});
  const build=()=>createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,appRemoval:appRemovalProvider(removalService),producerSummary:producerSummaryProvider(new ProducerSummaryService({metadata:db,clock,deleteObject:executor({hosted:c,after:async()=>{if(crash){crash=false;throw Error('crash after delete transaction');}}})}))}});
  let engine=build();for(let i=0;i<12;i++)await write('notes/'+i);
  const removed=await perform(engine,new ForceRemoval({actor,input:{connection:id,expectedGeneration:conn.generation}}));assert.equal(removed.state,'forced');
  await assert.rejects(apps.check(owner,id,conn.generation,client.id),{code:'invalid_token'});
  conn=await apps.register(owner,client);assert.ok(conn.generation>removed.generation);
  const newKeys=new Set();for(let step=0;step<40;step++){
   if(random.chance(.55)){const key='notes/'+random.int(20);await write(key);newKeys.add(key);}
   else{crash=random.chance(.4);try{const result=await perform(engine,new RemovalRemainingAction({actor,input:{removal:removed.removal,action:'delete',resource:'files',limit:1+random.int(5)}}));assert.ok(result.scanned<=5);}catch(error){assert.match(error.message,/crash after delete/);engine=build();}}
   for(const key of newKeys)assert.equal((await db.get('hosted/files/'+encodeURIComponent(key)))?.producer.generation,conn.generation);
  }
  crash=false;await until(()=>perform(engine,new RemovalRemainingAction({actor,input:{removal:removed.removal,action:'delete',resource:'files',limit:5}})));
  for(const key of newKeys)assert.equal((await db.get('hosted/files/'+encodeURIComponent(key)))?.producer.generation,conn.generation);
 });
});

// Seeded chaos across both adapters: the removed app (A, generation 1), another app (B), the owner, unattributed legacy
// rows and a reinstall (A, generation 2) write concurrently with bounded deletion, executor crashes and stalled
// in-flight writes that straddle the removal. Invariants are checked after every step.
test('CHAOS_SEED producer deletion across hosted and Drive preserves every non-target write and counts exactly',async t=>{
 await forEachSeed(6,async random=>{
  const {db,removal}=await base(t),drive=driveHarness(db),driveResource=await drive.connect(),c=hostedController(db);await connection(db,'app',1);await connection(db,'other',1);
  let crash=false,actual=0,aGeneration=1,reinstalled=false;
  const svc=new ProducerSummaryService({metadata:db,deleteObject:executor({hosted:c,drive,after:async()=>{actual++;if(crash){crash=false;throw Error('crash after effect');}}})});
  const resources=[{id:'files',kind:'hosted'},{id:driveResource.id,kind:'drive'}],last=new Map();
  const pathOf=async(r,key)=>r.kind==='hosted'?'hosted/files/'+encodeURIComponent(key):drive.service.path(r.id,key);
  const writeAs=async(writer,r,key,{stalled=false}={})=>{const path=await pathOf(r,key),current=await db.get(path),producer=writer==='A'?by('app',aGeneration,key):writer==='B'?by('other',1,key):undefined,condition=current?{version:current.version}:{absent:true};
   if(writer==='legacy'){if(r.kind!=='hosted'||current)return;const version=crypto.randomUUID(),blobRef='objects/legacy/'+version;c.blobStore.set(blobRef,new Uint8Array([1]));await db.put(path,{key,version,size:1,contentType:'application/octet-stream',modifiedAt:1,blobRef});last.set(path,{version,writer:'legacy',created:'legacy',gen:null});return;}
   const gen=aGeneration,promise=r.kind==='hosted'?hostedPut(c,key,{condition,producer,data:writer+random.int(1000)}):drivePut(drive,r.id,key,{condition,producer,data:writer+random.int(1000)});
   const record=result=>{const version=result.object?.version??result.version,prior=last.get(path);last.set(path,{version,writer:writer==='A'?'A'+gen:writer,created:current?prior?.created??'unknown':writer==='A'?'A'+gen:writer});};
   if(stalled)return {path,promise,record};record(await promise);};
  let changedToo=false;const target=e=>e.writer==='A1'&&(changedToo||e.created==='A1');
  const check=async()=>{for(const [path,e]of [...last]){const row=await db.get(path);if(!row){assert.ok(target(e),`non-target ${path} written by ${e.writer} was deleted`);last.delete(path);continue;}assert.equal(row.version,e.version,`unexpected change at ${path}`);}
   let total=0;for(const [,job]of await db.list({prefix:PRODUCER_DELETION+removal.removal+'/'}))total+=job.totalDeleted??0;assert.equal(total,actual,'totalDeleted must equal committed deletions');};
  for(let i=0;i<14;i++)await writeAs(random.pick(['A','A','B','owner','legacy']),random.pick(resources),'k/'+random.int(8));
  // Writes in flight when the app is removed.
  const releaseHosted=c.stall(),releaseDrive=drive.stall(),stalled=[await writeAs('A',resources[0],'k/'+random.int(8),{stalled:true}),await writeAs('A',resources[1],'k/stalled'+random.int(3),{stalled:true})].filter(Boolean);await tick();
  await connection(db,'app',1,'disconnected');let released=false;
  for(let step=0;step<45;step++){
   const roll=random.next();
   if(!released&&(roll<.08||step===30)){releaseHosted();releaseDrive();for(const s of stalled)await assert.rejects(s.promise,e=>['invalid_token','conflict'].includes(e.code));released=true;}
   else if(roll<.2&&!reinstalled){aGeneration=2;reinstalled=true;await connection(db,'app',2);}
   else if(roll<.55){const writer=random.pick(['B','owner','legacy',...reinstalled?['A']:[]]);if(released||writer!=='A')await writeAs(writer,random.pick(resources),'k/'+random.int(8)).catch(e=>{assert.equal(e.code,'conflict');});}
   else{crash=random.chance(.3);const input={action:'delete',limit:1+random.int(6),...random.chance(.5)?{resource:random.pick(resources).id}:{}};await svc.act(removal,input).catch(e=>assert.match(e.message,/crash after effect/));crash=false;}
   await check();
  }
  if(!released){releaseHosted();releaseDrive();for(const s of stalled)await assert.rejects(s.promise,e=>['invalid_token','conflict'].includes(e.code));}
  await until(()=>svc.act(removal,{action:'delete',limit:7}));await check();
  const summary=await svc.summary(removal);assert.ok(summary.resources.every(r=>r.created.items===0&&r.kept.items===0));assert.equal(summary.resources.reduce((n,r)=>n+r.changed.items,0),[...last.values()].filter(e=>e.writer==='A1').length);
  changedToo=true;await until(()=>svc.act(removal,{action:'delete',limit:7,includeChanged:true}));await check();
  for(const [path,row]of [...await db.list({prefix:'hosted/'}),...await db.list({prefix:'drive/object/'})])assert.ok(!(row.producer?.connection==='app'&&row.producer.generation<=1),`removed app data remains at ${path}`);
  for(const e of last.values())assert.notEqual(e.writer,'A1');
  for(const [,row]of await db.list({prefix:'drive/retained/'}))assert.equal(row.producer,undefined);
 });
});

// Re-review follow-ups.
const marked=(db,key,{connection='app',generation=1,created=generation,size=1}={})=>db.put('hosted/files/'+encodeURIComponent(key),{key,version:crypto.randomUUID(),size,blobRef:'objects/x/'+key,producer:{connection,generation,prefix:''},...created===null?{}:{createdBy:{connection,generation:created}}});

test('R1: pruning a concluded removal leaves a lineage row; What\'s left stays reachable and deletable by its id',async t=>{
 const {AppRemovalService,REMOVAL_RETENTION_MS}=await import('../packages/app/domains/app-removal.mjs');
 const f=await fixture(t);await f.db.put('app-removal/record/removed',{...f.removal,client_id:'https://app.example/client',concluded_at:1,committed_at:1,started_at:1});await f.put('notes/a');await f.put('notes/b');
 const removal=new AppRemovalService({metadata:f.db,clock:{now:()=>REMOVAL_RETENTION_MS+10}});await removal.tick({kind:'system',owner});
 assert.equal(await f.db.get('app-removal/record/removed'),undefined);const lineage=await f.db.get(PRODUCER_LINEAGE+'removed');assert.deepEqual([lineage.connection,lineage.generation,lineage.state,lineage.swept],['app',1,'forced',false]);
 const listed=(await removal.list(actor)).removals.find(r=>r.removal==='removed');assert.deepEqual([listed.state,listed.pruned,listed.connection,listed.generation],['forced',true,'app',1]);
 const summary=await f.query();assert.equal(summary.pruned,true);assert.equal(summary.resources[0].created.items,2);
 const done=await until(()=>f.act({action:'delete',resource:'files'}));assert.equal(done.totalDeleted,2);
 await f.db.delete(PRODUCER_LINEAGE+'removed');await assert.rejects(f.query(),{code:'not_found'});
});

test('R1: the alarm sweep strips only markers of pruned removals without an active keep, in bounded batches with one write per changed object',async t=>{
 const f=await fixture(t);await f.db.delete('app-removal/record/removed');
 await f.db.put(PRODUCER_LINEAGE+'old',lineageRow({removal:'old',entity:owner,connection:'app',generation:1,state:'forced'},5));
 await f.db.put(PRODUCER_LINEAGE+'kept',lineageRow({removal:'kept',entity:owner,connection:'keeper',generation:2,state:'forced'},5));
 await f.db.put(PRODUCER_KEEP+'keeper/kept/~all',{action:'keep',removal:'kept',connection:'keeper',generation:2,resource:null,active:true,at:1});await f.db.put(PRODUCER_KEEP+'app/old/files',{action:'keep',removal:'old',connection:'app',generation:1,resource:'files',active:false,supersededAt:2});await f.db.put(PRODUCER_DELETION+'old/files',{action:'delete',complete:true});
 // Retained removal record for another connection covering generation 1 prevents its stripping.
 await f.db.put('app-removal/record/live',{removal:'live',entity:owner,connection:'other',generation:3,state:'forced'});await f.db.put(PRODUCER_LINEAGE+'other-old',lineageRow({removal:'other-old',entity:owner,connection:'other',generation:1,state:'forced'},5));
 for(let i=0;i<5;i++)await marked(f.db,'a'+i);await marked(f.db,'mixed',{created:null});await marked(f.db,'reinstall',{generation:2});await marked(f.db,'k',{connection:'keeper',generation:2});await marked(f.db,'o',{connection:'other',generation:1});await f.db.put('hosted/files/plain',{key:'plain',version:'v',size:1});
 const writes=[],original=f.db.transaction.bind(f.db);f.db.transaction=fn=>original(tx=>fn({...tx,get:k=>tx.get(k),list:o=>tx.list(o),delete:k=>tx.delete(k),put:(k,v)=>{writes.push(k);return tx.put(k,v);}}));
 const svc=new ProducerSummaryService({metadata:f.db,deleteObject:async()=>{},clock:{now:()=>10}});let r,batches=0;do{r=await svc.collectMarkers({limit:3});batches++;assert.ok(batches<20);}while(!r.done);assert.ok(batches>=4);
 f.db.transaction=original;
 for(let i=0;i<5;i++){const row=await f.db.get('hosted/files/a'+i);assert.equal(row.producer,undefined);assert.equal(row.createdBy,undefined);}
 assert.equal((await f.db.get('hosted/files/mixed')).producer,undefined);assert.equal((await f.db.get('hosted/files/reinstall')).producer.generation,2);assert.equal((await f.db.get('hosted/files/k')).producer.connection,'keeper');assert.equal((await f.db.get('hosted/files/o')).producer.connection,'other');
 assert.equal(writes.filter(k=>k.startsWith('hosted/')).length,6);
 assert.equal(await f.db.get(PRODUCER_LINEAGE+'old'),undefined);assert.equal(await f.db.get(PRODUCER_KEEP+'app/old/files'),undefined);assert.equal(await f.db.get(PRODUCER_DELETION+'old/files'),undefined);assert.equal((await f.db.get(PRODUCER_LINEAGE+'kept')).swept,true);assert.equal(await f.db.get(PRODUCER_GC),undefined);
 // Idle once swept: no scan and no write.
 const before=writes.length,scans=[],list=f.db.list.bind(f.db);f.db.list=o=>{scans.push(o.prefix);return list(o);};assert.deepEqual(await svc.collectMarkers(),{done:true,stripped:0});f.db.list=list;assert.equal(writes.length,before);assert.ok(!scans.some(p=>p.startsWith('hosted/')||p.startsWith('drive/object/')),'idle sweep must not scan objects');
});

test('R2: keep requires a known resource, is capped per removal, and a large keep history never locks the app out',async t=>{
 const f=await fixture(t);await f.put('notes/a');await assert.rejects(f.act({action:'keep',resource:'nonexistent'}),{code:'not_found'});await f.db.put('resource/empty',{id:'empty',owner,provider:'hosted'});assert.deepEqual(await f.act({action:'keep',resource:'empty'}),{action:'keep',kept:true});
 for(let i=0;i<1005;i++)await f.db.put(PRODUCER_KEEP+'app/history'+i+'/files',{action:'keep',removal:'history'+i,connection:'app',generation:0,resource:'files',active:false});
 assert.equal((await f.query()).resources[0].created.items,1);await until(()=>f.act({action:'delete',resource:'files'}));
 for(let i=0;i<KEEP_ROWS_PER_REMOVAL;i++)await f.db.put(PRODUCER_KEEP+'app/removed/r'+i,{action:'keep',removal:'removed',connection:'app',generation:1,resource:'r'+i,active:true});
 await assert.rejects(f.act({action:'keep',resource:'files'}),{code:'keep_limit'});await f.act({action:'keep',resource:'empty'});
});

test('R3: kept counts split into created and changed; the kept opt-in carries includeChanged when chosen',async t=>{
 const f=await fixture(t);await f.db.put(PRODUCER_KEEP+'app/earlier/files',{action:'keep',removal:'earlier',connection:'app',generation:1,resource:'files',active:true});await f.db.put('app-removal/record/removed',{...f.removal,generation:3});
 await f.put('notes/kc',1);await f.put('notes/kx',1,5,{created:null});const kept=(await f.query()).resources[0].kept;assert.deepEqual([kept.items,kept.created.items,kept.changed.items],[2,1,1]);
 let r=await until(()=>f.act({action:'delete',resource:'files',includeKept:true}));assert.equal(r.totalDeleted,1);assert.ok(await f.db.get('hosted/files/notes%2Fkx'));
 r=await until(()=>f.act({action:'delete',resource:'files',includeKept:true,includeChanged:true}));assert.equal(await f.db.get('hosted/files/notes%2Fkx'),undefined);
});
