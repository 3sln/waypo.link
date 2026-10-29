
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccountWorkBudget,WORK_LAYOUT,workPartitionLimit,workShard,workLimits} from '../packages/runtime/work-budget.mjs';
import {FixedWindowGuard,AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {key} from '../packages/core/records.mjs';
import {createNodeServer} from '../apps/node/server.mjs';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function authority(){const databases=new Map();let calls=0;return {get calls(){return calls;},databases,consume:async(key,limits)=>{calls++;if(!databases.has(key))databases.set(key,new SqliteMetadata(':memory:'));return new FixedWindowGuard({metadata:databases.get(key)}).consume(limits);},close(){for(const db of databases.values())db.close();}};}

test('multi-unit fixed-window and lifetime allocation is atomic and rejects malformed accounting',async()=>{
 const db=new SqliteMetadata(':memory:');try{/* Mid-window fixed clock: the 1 s window cannot roll over between consumes. */const guard=new FixedWindowGuard({metadata:db,clock:()=>Date.UTC(2026,9,12,12,0,0,500)});
  for(const units of [0,-1,1.5,17,NaN,'2'])assert.equal(await guard.consume({lifetime:true,limit:100,units}),false);
  const results=await Promise.all(Array.from({length:12},()=>guard.consume({lifetime:true,limit:100,units:16})));assert.equal(results.filter(Boolean).length,6);assert.equal(await db.get('lifetime'),96);
  assert.equal(await guard.consume({lifetime:true,limit:100,units:4}),true);assert.equal(await guard.consume({lifetime:true,limit:100}),false);
  assert.equal(await guard.consume({windowMs:1000,limit:17,units:16}),true);assert.equal(await guard.consume({windowMs:1000,limit:17,units:2}),false);assert.equal(await guard.consume({windowMs:1000,limit:17}),true);
 }finally{db.close();}
});

test('owner monthly caps survive concurrency and restart while prepaid leases avoid shared ordinary writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'work-budget-')),service=authority();let db;
 try{db=new SqliteMetadata(join(dir,'owner.sqlite'));await db.put('owner',OWNER);const options={metadata:db,authority:service,config:{FREE_MONTHLY_WORK_LIMIT:33},clock:()=>Date.UTC(2026,9,12)};let budget=new AccountWorkBudget(options);
  const results=await Promise.allSettled(Array.from({length:50},()=>budget.admit(OWNER)));assert.equal(results.filter(r=>r.status==='fulfilled').length,33);assert(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='owner_work_exceeded'));assert.equal(service.calls,3);
  assert.deepEqual(await db.get('work/month'),{version:1,month:'2026-10',used:33,remaining:15});db.close();db=new SqliteMetadata(join(dir,'owner.sqlite'));budget=new AccountWorkBudget({...options,metadata:db});await assert.rejects(budget.admit(OWNER),{code:'owner_work_exceeded'});assert.equal(service.calls,3);
  budget=new AccountWorkBudget({...options,metadata:db,clock:()=>Date.UTC(2026,10,1)});await budget.admit(OWNER);assert.equal((await db.get('work/month')).used,1);assert.equal((await db.get('work/month')).month,'2026-11');assert.equal(service.calls,4);
 }finally{db?.close();service.close();await rm(dir,{recursive:true,force:true});}
});

test('all 16 immutable partition capacities sum to the service cap and shared callers cannot exceed a partition',async()=>{
 assert.equal(Array.from({length:16},(_,p)=>workPartitionLimit(250000,p)).reduce((a,b)=>a+b),250000);
 const service=authority(),databases=[];try{let owners=[];const wanted=await workShard(OWNER);/* Deterministic owner sequence, filtered to the same shard. */for(let i=1;owners.length<4;i++){const owner=`00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`;if(await workShard(owner)===wanted)owners.push(owner);}
  const budgets=await Promise.all(owners.map(async owner=>{const db=new SqliteMetadata(':memory:');databases.push(db);await db.put('owner',owner);return new AccountWorkBudget({metadata:db,authority:service,config:{SERVICE_MONTHLY_WORK_LIMIT:320},clock:()=>Date.UTC(2026,9,1)});}));
  const results=await Promise.allSettled(Array.from({length:60},(_,i)=>budgets[i%4].admit(owners[i%4])));const granted=results.filter(r=>r.status==='fulfilled').length;
  assert(granted<=20);const key=`work-v1/2026-10/${wanted}`;assert.equal(await service.databases.get(key).get('lifetime'),20);assert(results.some(r=>r.status==='rejected'&&r.reason.code==='service_work_exceeded'));
 }finally{for(const db of databases)db.close();service.close();}
});

test('failed authority and uncertain lease persistence never refund debits or allocate outside their UTC month',async()=>{
 const db=new SqliteMetadata(':memory:');try{await db.put('owner',OWNER);let month=Date.UTC(2026,9,31,23,59,59),global=0;
  let budget=new AccountWorkBudget({metadata:db,authority:{consume:async()=>{global+=16;throw Error('response lost');}},clock:()=>month});await assert.rejects(budget.admit(OWNER),{code:'work_unavailable'});assert.equal((await db.get('work/month')).used,1);assert.equal((await db.get('work/month')).remaining,0);assert.equal(global,16);
  budget=new AccountWorkBudget({metadata:db,authority:{consume:async()=>{global+=16;month=Date.UTC(2026,10,1);return true;}},clock:()=>month});await assert.rejects(budget.admit(OWNER),{code:'work_unavailable'});assert.equal((await db.get('work/month')).used,2);assert.equal((await db.get('work/month')).remaining,0);assert.equal(global,32);
 }finally{db.close();}
});

test('foreign owners and corrupt state fail closed; only authenticated initialization can bind an empty account',async()=>{
 const db=new SqliteMetadata(':memory:'),service=authority();try{const budget=new AccountWorkBudget({metadata:db,authority:service});await assert.rejects(budget.admit(OWNER),{code:'forbidden'});assert.equal(service.calls,0);await budget.admit(OWNER,{initialize:true});const record=await db.get('work/month');await assert.rejects(budget.admit(OTHER,{initialize:true}),{code:'forbidden'});assert.deepEqual(await db.get('work/month'),record);assert.equal(service.calls,1);
  await db.put('work/month',{...record,remaining:-1});await assert.rejects(budget.admit(OWNER),{code:'work_unavailable'});assert.equal(service.calls,1);for(const value of ['no',-1,1.2])assert.throws(()=>workLimits({SERVICE_MONTHLY_WORK_LIMIT:value}),{code:'work_unavailable'});
  assert.equal(WORK_LAYOUT.shards,16);
 }finally{db.close();service.close();}
});

test('paid owner admission follows durable billing entitlement and expires back to the free cap',async()=>{
 const db=new SqliteMetadata(':memory:'),service=authority();let now=Date.UTC(2026,9,12);try{await db.put('owner',OWNER);await db.put('billing/state',{owner:OWNER,source:'polar',plan:'plus',validUntil:now+1000});const budget=new AccountWorkBudget({metadata:db,authority:service,config:{FREE_MONTHLY_WORK_LIMIT:1,PLUS_MONTHLY_WORK_LIMIT:3},clock:()=>now});await budget.admit(OWNER);await budget.admit(OWNER);now+=1001;await assert.rejects(budget.admit(OWNER),{code:'owner_work_exceeded'});assert.equal((await db.get('work/month')).used,2);
 }finally{db.close();service.close();}
});

test('hosted writes debit after content and storage checks, failures are nonrefundable and read RPC creates no R2 journals',async()=>{
 const db=new SqliteMetadata(':memory:'),service=authority(),stored=new Map();let writes=0,failPut=false;
 const blobs={put:async(k,b)=>{writes++;if(failPut)throw Error('storage fault');stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{arrayBuffer:async()=>stored.get(k).buffer}:null,delete:async k=>stored.delete(k)};
 try{const config={APP_ORIGIN:'https://app.example',WORK_AUTHORITY:service,STORAGE_WRITE_FREE_PER_DAY:2},controller=new AccountController({metadata:db,gate:new SerialGate(),blobs,archives:{},config,sql:db.sql});await controller.touch(OWNER);const resource=await controller.addResource(OWNER,{name:'Private files',provider:'hosted'}),path=`https://app.example/entities/${OWNER}/resources/${resource.id}`;
  const rpc=(method,args)=>controller.invoke({method:'federationRPC',args:[{subject:`https://app.example/entities/${OWNER}`,resource:path,contract:'https://3sln.me/artefacts/contracts/object-storage/v1',clientId:'client',tx:crypto.randomUUID(),method,args}]});
  let result=await rpc('put',{key:'bad',condition:{absent:true},data:'bad!'});assert.equal(result.$fault.code,'invalid_args');assert.equal(await db.get('storage-write/v1'),undefined);assert.equal((await db.list({prefix:'rpc-journal/'})).size,0);assert.equal(writes,0);
  await db.put(key('app-message-usage',OWNER),{bytes:500000000,messages:1});result=await rpc('put',{key:'full',condition:{absent:true},data:new Uint8Array([120])});assert.equal(result.$fault.code,'account_quota_exceeded');assert.equal(service.calls,0);assert.equal(writes,0);assert.equal((await db.list({prefix:'rpc-journal/'})).size,0);await db.put(key('app-message-usage',OWNER),{bytes:0,messages:0});
  result=await rpc('put',{key:'a',condition:{absent:true},data:new Uint8Array(Buffer.alloc(100000,42))});assert.equal(result.$fault,undefined);assert.equal((await db.get('storage-write/v1')).foreground.used,1);const object=result.object,rows=(await db.list({prefix:'rpc-journal/'})).size;
  for(let i=0;i<3;i++){const read=await rpc('get',{key:'a'});assert.equal(read.$fault,undefined);assert.equal(Buffer.from(read.data).length,100000);}assert.equal(writes,1);assert.equal((await db.list({prefix:'rpc-journal/'})).size,rows);assert.equal((await db.get('storage-write/v1')).foreground.used,1);
  failPut=true;result=await rpc('put',{key:'b',condition:{absent:true},data:new Uint8Array([120])});assert.equal(result.$fault.code,'indeterminate');assert.equal((await db.get('storage-write/v1')).foreground.used,2);assert.equal((await db.get('storage/reservations')).count,0);
  result=await rpc('put',{key:'c',condition:{absent:true},data:new Uint8Array([120])});assert.equal(result.$fault.code,'rate_limited');assert.equal(writes,2);assert.equal((await db.get('storage/reservations')).count,0);
  result=await rpc('delete',{key:'a',version:object.version});assert.equal(result.deleted,true);assert.equal((await db.get('storage-write/v1')).foreground.used,2);
 }finally{db.close();service.close();}
});
