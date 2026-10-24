// Wargame M1 (2026-10-23): refused contact deliveries must not spend the owner's receipt budget, work budget or a
// blob write. messaging.md "Reference-service receipt limits": validation, live authorization, established replay
// and storage-quota checks run before the receipt debit. ContactDeliveryService.precheck runs them read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {authored} from './link-helpers.mjs';
import {MESSAGE_RECEIPT_DEFAULTS} from '../packages/runtime/message-receipt-budget.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',START=Date.UTC(2026,9,13,12,0,0);
function limits(owner,contact){const policy=structuredClone(MESSAGE_RECEIPT_DEFAULTS);for(const plan of Object.values(policy))for(const [scope,n] of [['owner',owner],['contact',contact]])for(const w of ['minute','hour','day'])plan[scope][w]={messages:n,bytes:10485760};return policy;}
async function runtime(t,policy){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const stored=new Map();let puts=0;
 const blobs={put:async(k,b)=>{puts++;stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{arrayBuffer:async()=>stored.get(k).buffer}:null,delete:async k=>stored.delete(k)};
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs,archives:{},config:{APP_ORIGIN:'https://provider.example',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MESSAGE_RECEIPT_LIMITS:policy},sql:db.sql});
 await controller.touch(OWNER);controller.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});
 const create=(name,maxMessages,mimeTypes=['text/plain'])=>controller.createContactLink(OWNER,'person',{name,mimeTypes,expiresAt:Date.now()+3600000,maxMessages});
 const link=await create('tiny',1);
 const send=async(target,opts)=>{const m=await authored(input=>controller.authorLinkEnvelope(OWNER,input),target.url,opts);return controller.deliverLink(OWNER,{url:target.url},{envelope:m.envelope,body:m.body});};
 const used=async()=>(await controller.messageReceiptBudget.status(OWNER)).windows.day.messages;
 let work=0;const admitWork=controller.admitWork.bind(controller);controller.admitWork=async(...args)=>{work++;return admitWork(...args);};
 return {controller,link,create,send,used,get puts(){return puts;},get work(){return work;}};
}

test('an exhausted per-link maxMessages refuses without debiting the owner receipt or work budget',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START+30000});
 const f=await runtime(t,limits(100,50));
 await f.send(f.link,{text:'first'});const puts=f.puts,work=f.work;
 for(let i=0;i<5;i++)await assert.rejects(f.send(f.link,{text:'spam'+i}),{code:'quota_exceeded'});
 assert.equal(await f.used(),1,'refused over-quota sends debited the owner receipt budget');
 assert.equal(f.work,work,'refused sends consumed work admission');
 assert.equal(f.puts,puts,'refused sends wrote blobs');
});

test('a MIME type the link never allowed is refused before receipt debit and blob write',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START+30000});
 const f=await runtime(t,limits(100,50));
 await assert.rejects(f.send(f.link,{text:'<b>x</b>',mimeType:'text/html'}),{code:'unsupported_media'});
 assert.equal(await f.used(),0);assert.equal(f.puts,0);assert.equal(f.work,0);
});

test('a createdAt outside the admission window is refused before any debit',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START+30000});
 const f=await runtime(t,limits(100,50));
 await assert.rejects(f.send(f.link,{text:'stale',createdAt:Date.now()-2*86400000}),{code:'operation_expired'});
 assert.equal(await f.used(),0);assert.equal(f.puts,0);
});

test('refused attempts on one link cannot starve the owner lane for another link',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START+30000});
 const f=await runtime(t,limits(3,3));
 await f.send(f.link,{text:'first'});
 for(let i=0;i<5;i++)await assert.rejects(f.send(f.link,{text:'again'+i}),{code:'quota_exceeded'});
 const other=await f.create('other',10);
 await f.send(other,{text:'legit 1'});await f.send(other,{text:'legit 2'});
 assert.equal(await f.used(),3);
 await assert.rejects(f.send(other,{text:'over the owner cap'}),{code:'message_receipt_limited'});
});

test('an identical replay still returns its receipt and a changed payload under the same operation conflicts',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START+30000});
 const f=await runtime(t,limits(100,50)),operationId=crypto.randomUUID();
 const m=await authored(input=>f.controller.authorLinkEnvelope(OWNER,input),f.link.url,{text:'once',operationId});
 const first=await f.controller.deliverLink(OWNER,{url:f.link.url},{envelope:m.envelope,body:m.body});
 const again=await f.controller.deliverLink(OWNER,{url:f.link.url},{envelope:m.envelope,body:m.body});
 assert.equal(again.replayed,true);assert.deepEqual(again.receipt,first.receipt);assert.equal(await f.used(),1);
 const changed=await authored(input=>f.controller.authorLinkEnvelope(OWNER,input),f.link.url,{text:'different',operationId});
 await assert.rejects(f.controller.deliverLink(OWNER,{url:f.link.url},{envelope:changed.envelope,body:changed.body}),{code:'operation_conflict'});
 assert.equal(await f.used(),1);
});
