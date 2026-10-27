import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageReceiptBudget,MESSAGE_RECEIPT_DEFAULTS,MESSAGE_RECEIPT_STATE,MESSAGE_RECEIPT_MAX_PARENTS,MESSAGE_RECEIPT_MAX_STATE_BYTES,messageReceiptLimits} from '../packages/runtime/message-receipt-budget.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {key} from '../packages/core/records.mjs';
import application from '../packages/runtime/http.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const START=Date.UTC(2026,9,13,12,0,0);
function limits(ownerCount=10,contactCount=5,ownerBytes=10485760,contactBytes=5242880){const policy=structuredClone(MESSAGE_RECEIPT_DEFAULTS);for(const p of Object.values(policy))for(const [scope,count,bytes]of [['owner',ownerCount,ownerBytes],['contact',contactCount,contactBytes]])for(const name of ['minute','hour','day'])p[scope][name]={messages:count,bytes};return policy;}
async function fixture(t,policy=limits()){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());await db.put('owner',OWNER);let now=START;
 const config={MESSAGE_RECEIPT_LIMITS:policy},budget=new MessageReceiptBudget({metadata:db,config,clock:()=>now});
 const parent=async(owner=OWNER)=>{const id=crypto.randomUUID();await db.put(key('contact-grant',id),{id,owner,active:true,claims:{sub:owner,exp:Math.floor((START+10*86400000)/1000)}});return id;};
 return {db,budget,config,parent,clock:v=>{now=v;},get now(){return now;}};
}

test('receipt configuration is strict, bounded by owner, and preserves approved defaults',()=>{
 assert.equal(MESSAGE_RECEIPT_DEFAULTS.free.owner.minute.messages,30);assert.equal(MESSAGE_RECEIPT_DEFAULTS.free.contact.minute.messages,15);
 assert.equal(MESSAGE_RECEIPT_DEFAULTS.ultra.owner.day.bytes,8192*1048576);
 for(const input of [null,[],new Date(),1,'{',{'unknown':{}},{free:{}},JSON.stringify({free:{owner:{},contact:{}}})])assert.throws(()=>messageReceiptLimits({MESSAGE_RECEIPT_LIMITS:input}),{code:'message_receipt_unavailable'});
 for(const value of [-1,1.5,'2',NaN,Infinity]){const p=limits();p.free.owner.minute.messages=value;assert.throws(()=>messageReceiptLimits({MESSAGE_RECEIPT_LIMITS:p}),{code:'message_receipt_unavailable'});}
 const p=limits();p.free.contact.minute.messages=11;assert.throws(()=>messageReceiptLimits({MESSAGE_RECEIPT_LIMITS:p}),{code:'message_receipt_unavailable'});
 const valid=messageReceiptLimits({MESSAGE_RECEIPT_LIMITS:JSON.stringify({free:limits(0,0,0,0).free})});assert.equal(valid.free.owner.day.messages,0);assert.equal(valid.paid.owner.minute.messages,120);
});

// The per-contact-parent lane left the core with messaging (2026-10-27): v1 app intake (source 'app-notification', the
// default) is the only lane, and naming a parent or another source is refused.
test('owner count/byte windows admit atomically without rejection writes; only the app-intake lane exists',async t=>{
 const f=await fixture(t,limits(3,2,9,6)),a=await f.parent();
 await assert.rejects(f.budget.admit(OWNER,{parent:a,bytes:1}),{code:'invalid_message'});await assert.rejects(f.budget.admit(OWNER,{source:'contact',bytes:1}),{code:'invalid_message'});
 await f.budget.admit(OWNER,{bytes:3});await f.budget.admit(OWNER,{source:'app-notification',bytes:3});const state=await f.db.get(MESSAGE_RECEIPT_STATE);
 await assert.rejects(f.budget.admit(OWNER,{bytes:4}),{code:'message_receipt_limited'});assert.deepEqual(await f.db.get(MESSAGE_RECEIPT_STATE),state);
 await assert.rejects(f.budget.admit(OWNER,{bytes:10}),error=>error.code==='message_receipt_too_large'&&error.status===413&&error.retryAfter===undefined);
 await f.budget.admit(OWNER,{bytes:3});await assert.rejects(f.budget.admit(OWNER,{bytes:0}),{code:'message_receipt_limited',retryAfter:43200});assert.deepEqual((await f.db.get(MESSAGE_RECEIPT_STATE)).contacts,{});
 const status=await f.budget.status(OWNER);assert.equal(status.unit,'admitted-new-message-attempts');assert.equal(status.windows.day.messages,3);assert.equal(status.windows.day.bytes,9);assert.deepEqual(status.windows.day.remaining,{messages:0,bytes:0});
});

test('simultaneous parent lanes cannot exceed one owner cap; restart retains state',async t=>{
 const f=await fixture(t,limits(12,12)),parents=await Promise.all(Array.from({length:4},()=>f.parent()));
 const competing=new MessageReceiptBudget({metadata:f.db,config:f.config,clock:()=>f.now});
 const result=await Promise.allSettled(Array.from({length:40},(_,i)=>(i%2?f.budget:competing).admit(OWNER,{bytes:1})));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,12);assert(result.filter(r=>r.status==='rejected').every(r=>r.reason.code==='message_receipt_limited'));
 const restarted=new MessageReceiptBudget({metadata:f.db,config:f.config,clock:()=>f.now});await assert.rejects(restarted.admit(OWNER,{bytes:1}),{code:'message_receipt_limited'});
});

test('window boundaries, failed attempts, disabled limits and backward/corrupt state fail conservatively',async t=>{
 const p=limits(10,10);p.free.owner.minute.messages=1;p.free.contact.minute.messages=1;const f=await fixture(t,p),parent=await f.parent();
 await f.budget.admit(OWNER,{bytes:0});await assert.rejects(f.budget.admit(OWNER,{bytes:0}),{retryAfter:60});
 f.clock(START+60000);await f.budget.admit(OWNER,{bytes:0});assert.equal((await f.budget.status(OWNER)).windows.hour.messages,2);
 f.clock(START+59999);await assert.rejects(f.budget.admit(OWNER,{bytes:0}),{code:'message_receipt_unavailable'});
 f.clock(START+2*3600000);const later=await f.parent();await f.budget.admit(OWNER,{bytes:1});assert.equal((await f.budget.status(OWNER)).windows.day.messages,3);
 f.clock(START+86400000);await f.budget.admit(OWNER,{bytes:1});assert.equal((await f.budget.status(OWNER)).windows.day.messages,1);
 const zero=new MessageReceiptBudget({metadata:f.db,config:{MESSAGE_RECEIPT_LIMITS:limits(0,0,0,0)},clock:()=>f.now});await assert.rejects(zero.admit(OWNER,{bytes:1}),error=>error.code==='message_receipt_disabled'&&error.retryAfter===undefined);
 const good=await f.db.get(MESSAGE_RECEIPT_STATE);
 for(const bad of [null,{...good,last:NaN},{...good,owner:OTHER},{...good,last:good.last+60000},{...good,windows:{...good.windows,hour:{...good.windows.hour,epoch:good.windows.hour.epoch-1}}},{...good,contacts:{bad:{}}},{...good,windows:{...good.windows,day:{...good.windows.day,bytes:-1}}}]){await f.db.put(MESSAGE_RECEIPT_STATE,bad);await assert.rejects(f.budget.status(OWNER),{code:'message_receipt_unavailable'});}
});

test('owner and confirmed plan checks precede accounting; downgrade does not reset usage',async t=>{
 const p=limits(1,1);p.paid=limits(3,3).paid;const f=await fixture(t,p);
 await assert.rejects(f.budget.admit(OTHER,{bytes:1}),{code:'forbidden'});
 for(const bytes of [-1,1048577,1.5,NaN])await assert.rejects(f.budget.admit(OWNER,{bytes}),{code:'invalid_message'});
 assert.equal(await f.db.get(MESSAGE_RECEIPT_STATE),undefined);
 await f.db.put('billing/state',{owner:OWNER,source:'polar',catalogVersion:2,plan:'paid',validUntil:START+1000});
 await f.budget.admit(OWNER,{bytes:1});await f.budget.admit(OWNER,{bytes:1});assert.equal((await f.budget.status(OWNER)).plan,'paid');
 f.clock(START+1001);await assert.rejects(f.budget.admit(OWNER,{bytes:1}),{code:'message_receipt_limited'});assert.equal((await f.budget.status(OWNER)).windows.day.messages,2);
});

test('all current plan tiers map directly and provisional or foreign billing cannot inflate allowance',async t=>{
 const f=await fixture(t);for(const plan of ['paid','plus','ultra']){await f.db.put('billing/state',{owner:OWNER,source:'polar',catalogVersion:2,plan,validUntil:START+60000});assert.equal((await f.budget.status(OWNER)).plan,plan);}
 const parameters=id=>({id,name:id,storageBytes:1000000,activityHour:100,activityDay:1000}),config={...f.config,APP_ORIGIN:'https://provider.example',POLAR_SERVER:'sandbox'};
 const billing={owner:OWNER,source:'polar',catalogVersion:3,plan:'paid',validUntil:START+60000,origin:config.APP_ORIGIN,server:'sandbox',metadataPrefix:'3sln_me_',catalogMode:'static',organizationId:'org',productId:'product',subscriptionId:'subscription',currency:'usd',verifiedPlan:parameters('paid')};
 billing.upgrade={version:1,plan:'ultra',parameters:parameters('ultra'),owner:OWNER,origin:billing.origin,server:billing.server,organizationId:billing.organizationId,subscriptionId:billing.subscriptionId,targetProductId:'upgrade',currency:'usd',startedAt:START,expiresAt:START+1000};
 await f.db.put('billing/state',billing);const budget=new MessageReceiptBudget({metadata:f.db,config,clock:()=>START});assert.equal((await budget.status(OWNER)).plan,'paid');
 await f.db.put('billing/state',{...billing,origin:'https://other.example'});assert.equal((await budget.status(OWNER)).plan,'free');
 await f.db.put('billing/state',{...billing,owner:OTHER});assert.equal((await budget.status(OWNER)).plan,'free');
});
