// Wargame D2 (2026-10-23): a forged (never issued) export-grant bearer must not learn the target account's lifecycle
// state. public-unknown.mjs: credential validity is answered first; a credential whose own subject has a lifecycle
// fault is simply an invalid credential (never 404/410). The grant branch maps lifecycle faults to 401.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import http from '../packages/runtime/http.mjs';

const origin='https://oracle.example',DAY=86400000,KEK=Buffer.alloc(32,9).toString('base64');
const bucket=()=>({get:async()=>null,put:async()=>({}),delete:async()=>{}});
async function account(t,owner){
 let now=Date.now();const identity={id:owner,status:'active',handle:'person',assignmentId:'assign-1',createdAt:now-10*DAY};
 const base=createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}}});
 const flags={for:ctx=>({...base.for(ctx),enabled:n=>['ACCOUNT_DELETION_ENABLED','ACCOUNT_EXPORT_ENABLED'].includes(n)?true:base.for(ctx).enabled(n),background:()=>true,global:()=>true})};
 const ports={identity:{get:async()=>structuredClone(identity),tombstone:async()=>{identity.status='deleted';return true;}},security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices:{deliver:async()=>({accepted:true})},due:{put:async()=>{},delete:async()=>{}},exports:null,erasure:{federation:null,mcp:null,emailBridge:null,operatorApps:null}};
 const db=new SqliteMetadata(':memory:');
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket(),archives:bucket(),sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:KEK,flags,LIFECYCLE_CLOCK:()=>now,LIFECYCLE_LOG:()=>{},ACCOUNT_DELETION_PORTS:ports,IDENTITY_ACCOUNT:async()=>structuredClone(identity),exportPorts:{identitySecurity:async()=>({epoch:1,changedAt:0}),notice:async()=>({})}}});
 t.after(async()=>{await controller.engine.dispose();db.close();});await controller.warm(owner);
 return {controller,db,flags,advance:ms=>{now+=ms;},now:()=>now};
}
const forged=(owner,job)=>`bex1.${owner}.${job}.${crypto.randomUUID()}.${'A'.repeat(43)}`;
async function probe(env,owner){const job=crypto.randomUUID();const r=await http.fetch(new Request(`${origin}/api/exports/${job}/volumes/1.tar`,{headers:{Authorization:'Bearer '+forged(owner,job)}}),env,{});return {status:r.status,body:await r.text()};}

test('a forged export grant gets the same credential refusal for active, deleting and deleted targets',async t=>{
 const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const active=await account(t,A),deleting=await account(t,B);
 const req=await deleting.controller.invoke({method:'deletionRequest',args:[B,{confirmHandle:'@person',acknowledgements:{messages:true,storage:true,names:true},operationId:'oracle-operation-00001'},{stepUpAt:deleting.now()}]});
 assert.equal(req.$fault,undefined,JSON.stringify(req));deleting.advance(15*DAY);
 await deleting.controller.invoke({method:'deletionTick',args:[B,{source:'test'}]});assert.ok(await deleting.db.get(FENCE_KEY));
 const env={APP_ORIGIN:origin,flags:active.flags,ACCOUNTS:{get:id=>({invoke:call=>(id===A?active:deleting).controller.invoke(call)})}};
 const a=await probe(env,A),b=await probe(env,B);
 assert.equal(a.status,401);
 assert.notEqual(b.status,410,'a forged credential learned that its target is being deleted');
 assert.deepEqual(b,a,'active and deleting targets must be indistinguishable to a forged credential');
 for(let i=0;i<40&&!(await deleting.db.get('lifecycle/tombstone-v1'));i++)await deleting.controller.invoke({method:'deletionTick',args:[B,{source:'test'}]});
 assert.ok(await deleting.db.get('lifecycle/tombstone-v1'));
 assert.deepEqual(await probe(env,B),a,'a deleted target must also be indistinguishable');
});
