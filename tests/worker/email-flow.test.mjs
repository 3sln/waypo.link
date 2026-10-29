// The cross-device email flow store and routes on workerd (sign-in and intents spike §4.2, P3): flow records and link
// pointers live on their own identity shards (families `email-flow` and `email-flow-link`), CAS over Durable Object RPC,
// and the identity alarm purges them at expiry + 24 h. With EMAIL_FLOW_V2 off the routes answer like unknown paths; with it
// on and no mail transport, start refuses. The protocol is covered at engine level (tests/email-flow.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import {identityShardName} from '../../packages/runtime/identity-shards.mjs';
import {shardedEmailFlows} from '../../packages/runtime/email-flow-store.mjs';

test('workerd: email flows are single-key records on their own shards; CAS and pointers over Durable Object RPC; the alarm purges them',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const namespace=await h.mf.getDurableObjectNamespace('IDENTITIES'),stub=name=>namespace.get(namespace.idFromName(name)),store=shardedEmailFlows(stub);
 const now=Date.now(),record={flowId:'W'.repeat(22),revision:0,state:'pending',expiresAt:now-86400000+1500,linkIndex:'I'.repeat(43)};
 assert.equal(await store.create(record),true);assert.equal(await store.create(record),false);
 assert.deepEqual(JSON.parse(JSON.stringify(await store.get(record.flowId))),record);
 assert.equal(await store.compareAndSwap(record.flowId,0,{...record,revision:1,state:'approved-same-browser'}),true);
 assert.equal(await store.compareAndSwap(record.flowId,0,{...record,revision:1,state:'redeemed'}),false);
 await store.putLink(record.linkIndex,record.flowId,now+1500);assert.equal(await store.findByLink(record.linkIndex),record.flowId);
 const flowShard=stub(await identityShardName('email-flow',record.flowId)),linkShard=stub(await identityShardName('email-flow-link',record.linkIndex));
 assert.ok(new Map(await flowShard.rows()).has('email-flow/'+record.flowId));assert.ok(new Map(await linkShard.rows()).has('email-flow-link/'+record.linkIndex));
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,now+1600-Date.now())));
 await flowShard.fireAlarm();await linkShard.fireAlarm();
 assert.equal(new Map(await flowShard.rows()).has('email-flow/'+record.flowId),false,'purged 24 h after expiry');
 assert.equal(new Map(await linkShard.rows()).has('email-flow-link/'+record.linkIndex),false);
 assert.equal(await store.get(record.flowId),null);assert.equal(await store.findByLink(record.linkIndex),null);
});

test('workerd routes: off answers like an unknown path; on without a mail transport refuses start; the helper page is served only when on',async t=>{
 const off=await createHarness();t.after(()=>off.close());
 const post=async(h,path,body)=>{const r=await h.mf.dispatchFetch(h.origin+path,{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.text()};};
 assert.deepEqual(await post(off,'/api/auth/email/flow/start',{}),await post(off,'/api/auth/email/flow/unknown',{}));
 const on=await createHarness({bindings:{EMAIL_FLOW_V2:'true'}});t.after(()=>on.close());
 const refused=await post(on,'/api/auth/email/flow/start',{email:'a@mail.example',secretHash:'a'.repeat(43),channelTag:'b'.repeat(43),turnstileToken:'local-browser-test-token'});
 assert.equal(refused.status,503,refused.body);assert.equal(JSON.parse(refused.body).error,'email_unavailable');
 const page=await on.mf.dispatchFetch(on.origin+'/email/link',{headers:{Accept:'text/html'}});
 assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('Cache-Control'),'no-store');assert.equal(page.headers.get('set-cookie'),null);await page.text();
});
