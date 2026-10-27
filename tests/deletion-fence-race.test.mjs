// Wargame D1 (2026-10-23): no item blob may survive the purge, and ungated orchestration and queued invokes respect
// the deletion fence. `gated()` re-checks deletion/fence-v1, lifecycle/purge-v1 and the tombstone; the purge blobs
// stage makes one final pass from the beginning (defence in depth). The contact-delivery half of this suite left the
// core with legacy messaging on 2026-10-27 (formerly deletion-delivery-race.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import {PURGE_KEY,TOMBSTONE_KEY} from '../packages/runtime/lifecycle-storage.mjs';
import {key} from '../packages/core/records.mjs';

const origin='https://race.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',DAY=86400000,KEK=Buffer.alloc(32,9).toString('base64');
function recordingBucket(){const map=new Map();return {map,
 async get(k){const v=map.get(k);if(!v)return null;return {size:v.byteLength,body:new Blob([v]).stream(),arrayBuffer:async()=>v.buffer.slice(0),text:async()=>new TextDecoder().decode(v),json:async()=>JSON.parse(new TextDecoder().decode(v))};},
 async put(k,v){map.set(k,typeof v==='string'?new TextEncoder().encode(v):new Uint8Array(v));await this.afterPut?.(k);return {};},
 async delete(k){for(const n of [k].flat())map.delete(n);}};}
async function fixture(t){
 let now=Date.now();const clock=()=>now;
 const identity={id:owner,status:'active',handle:'person',assignmentId:'assign-1',createdAt:now-10*DAY};
 const base=createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}}});
 const flags={for:ctx=>({...base.for(ctx),enabled:n=>n==='ACCOUNT_DELETION_ENABLED'?true:base.for(ctx).enabled(n),background:()=>true,global:()=>true})};
 const ports={identity:{get:async()=>structuredClone(identity),tombstone:async()=>{identity.status='deleted';return true;}},security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices:{deliver:async()=>({accepted:true})},due:{put:async()=>{},delete:async()=>{}},exports:null,erasure:{federation:null,mcp:null,emailBridge:null,operatorApps:null}};
 const db=new SqliteMetadata(':memory:'),blobs=recordingBucket(),archives=recordingBucket();
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs,archives,sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:KEK,flags,LIFECYCLE_CLOCK:clock,LIFECYCLE_LOG:()=>{},ACCOUNT_DELETION_PORTS:ports,IDENTITY_ACCOUNT:async()=>structuredClone(identity)}});
 t.after(async()=>{await controller.engine.dispose();db.close();});
 await controller.warm(owner);
 const invoke=(method,...args)=>controller.invoke({method,args});
 const leaked=()=>[...blobs.map.keys()].filter(k=>k.startsWith(`messages/${owner}/`));
 const request=async()=>{const r=await invoke('deletionRequest',owner,{confirmHandle:'@person',acknowledgements:{messages:true,storage:true,names:true},operationId:'race-operation-'+String(Math.random()).slice(2,12).padEnd(10,'0')},{stepUpAt:clock()});assert.equal(r.$fault,undefined,JSON.stringify(r));now+=15*DAY;};
 // Enough rows that the purge blobs stage spans more than one batch (16 pages x 32 rows per tick).
 const filler=async()=>{for(let i=0;i<700;i++)await db.put('zz-filler/'+String(i).padStart(4,'0'),{i});};
 const toBlobsStage=async()=>{for(let i=0;i<20;i++){await invoke('deletionTick',owner,{source:'test'});const job=await db.get(PURGE_KEY);if(job?.stage==='blobs'&&job.cursor>'app-message/')return job;}assert.fail('purge never reached the blobs stage past item rows');};
 const finish=async()=>{for(let i=0;i<60;i++){await invoke('deletionTick',owner,{source:'test'});if(await db.get(TOMBSTONE_KEY)&&!await db.get(PURGE_KEY))return;}};
 return {controller,db,blobs,invoke,leaked,request,filler,toBlobsStage,finish};
}

test('the purge blobs stage makes a final pass from the beginning',async t=>{
 const x=await fixture(t);await x.filler();
 await x.request();await x.toBlobsStage();
 // A blob-bearing row written behind the cursor (an operation admitted before the fence, by any path).
 const id=crypto.randomUUID(),ref=`messages/${owner}/${id}`;await x.blobs.put(ref,new TextEncoder().encode('behind the cursor'));
 await x.db.put(key('app-message',owner,id),{id,owner,blobRef:ref,size:17,mimeType:'text/plain',collection:'x',receivedAt:Date.now()});
 await x.finish();assert.ok(await x.db.get(TOMBSTONE_KEY));
 assert.deepEqual(x.leaked(),[],'a row written behind the cursor kept its blob');
});

test('gated orchestration refuses to start once the fence, a purge job or the tombstone exists',async t=>{
 const x=await fixture(t),c=x.controller;let ran=0;
 assert.equal(await c.gated(async()=>++ran),1);
 for(const [name,code] of [[FENCE_KEY,'account_deleting'],[PURGE_KEY,'account_deleting'],[TOMBSTONE_KEY,'account_deleted']]){
  await x.db.put(name,{owner});await assert.rejects(c.gated(async()=>++ran),{code});await x.db.delete(name);
 }
 assert.equal(ran,1);
});

test('an invoke queued behind the account gate is refused if the fence commits while it waits',async t=>{
 const x=await fixture(t),c=x.controller;let release;const held=new Promise(r=>{release=r;});let holding;const started=new Promise(r=>{holding=r;});
 const blocker=c.gate.run(async()=>{holding();await held;});await started;
 const queued=x.invoke('contacts',owner);
 await new Promise(r=>setTimeout(r,20));await x.db.put(FENCE_KEY,{owner});release();await blocker;
 assert.equal((await queued)?.$fault?.code,'account_deleting');
});
