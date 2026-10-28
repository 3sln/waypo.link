// Contacts after contacts spike phase 4: blocks (the one per-person setting; lists carry every relationship) and the
// removal of contact links (operations, the edge index's link entries and the shell's link-revocation method).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,P,uuidOf} from './receive-fixtures.test.mjs';
import {createEdgeIndex} from '../../packages/messaging-engine/store/edge-index.mjs';
import {ContactsBlock,ContactsBlocks,CONTACT_OPERATIONS} from '../../packages/messaging-engine/domains/contacts.mjs';
import {MAILBOX_OPERATIONS} from '../../packages/messaging-engine/operations.mjs';
import {createMailbox} from '../../apps/parlay/worker/mailbox.mjs';
import {memoryStore} from './helpers/engine.mjs';

const fresh=async t=>{const w=await createWorld();t.after(()=>w.dispose());return w;};
const code=(r,status,error)=>{assert.equal(r.status,status,JSON.stringify(r.json));assert.equal(r.json.error,error);};
const who=p=>({issuer:p.principal.issuer,subject:p.principal.subject});

test('a block refuses first contact uniformly and overrides every list; unblocking restores the earlier membership',async t=>{
 const w=await fresh(t),contacts=await w.admit('bob'),requests=await w.admit('bob',{policy:'request'});
 assert.equal((await w.deliver('alice','bob',contacts)).status,200);await w.enlist('alice','bob',requests);
 await w.run('bob','contacts.block',{principal:P.alice.principal});
 code(await w.deliver('alice','bob',contacts,{operationId:uuidOf(2)}),403,'not_authorized');
 // The same code and timing class as an author no list admits (§6.7).
 code(await w.deliver('carol','bob',null,{operationId:uuidOf(3)}),403,'not_authorized');
 // A replay of the admitted delivery no longer retrieves its receipt while the block holds.
 code(await w.deliver('alice','bob',contacts),403,'not_authorized');
 const listed=await w.run('bob','contacts.blocks');assert.deepEqual(listed.blocks.map(b=>b.principal),[who(P.alice)]);
 assert.equal((await w.run('bob','lists.members',{list:'contacts'})).members.length,1,'the membership is kept');
 await w.run('bob','contacts.block',{principal:P.alice.principal,blocked:false});
 assert.deepEqual((await w.run('bob','contacts.blocks')).blocks,[]);
 assert.equal((await w.deliver('alice','bob',contacts,{operationId:uuidOf(4)})).status,200);
});

test('block operations are owner-only and validate the principal',async t=>{
 const w=await fresh(t),bob=w.peer('bob');
 for(const kind of ['ingress','system']){
  await assert.rejects(bob.engine.perform(new ContactsBlock({actor:{kind,owner:bob.owner},input:{principal:P.alice.principal}})),{code:'unauthorized'});
  await assert.rejects(bob.engine.read(new ContactsBlocks({actor:{kind,owner:bob.owner}})),{code:'unauthorized'});
 }
 await assert.rejects(bob.engine.perform(new ContactsBlock({actor:{kind:'owner',owner:w.peer('alice').owner},input:{principal:P.alice.principal}})),{code:'forbidden'});
 for(const principal of [null,{issuer:'http://alice.provider.example',subject:P.alice.principal.subject},{issuer:P.alice.principal.issuer,subject:'not-a-uuid'}])
  await assert.rejects(w.run('bob','contacts.block',{principal}),{code:'invalid_input'});
});

test('contact-link operations are gone from the engine and the app shell (contacts spike phase 4)',async()=>{
 assert.deepEqual(CONTACT_OPERATIONS.map(o=>o.operation),['contacts.block','contacts.blocks']);
 for(const op of ['contacts.create-link','contacts.revoke-link','contacts.add','contacts.remove','contacts.list','receive.deliver','intake.update'])assert.equal(Object.hasOwn(MAILBOX_OPERATIONS,op),false,op);
 // The shell answers them as unknown operations (not_found), exactly like any other unregistered name.
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',box=createMailbox({store:memoryStore(),PARLAY_ENABLED:true,clock:{now:()=>Date.UTC(2026,9,28)}});
 try{
  await box.open(owner);
  for(const op of ['contacts.create-link','contacts.revoke-link','contacts.add','contacts.remove','contacts.list','shell.link-revoked','shell.conversation-create','receive.deliver'])
   await assert.rejects(box.run(owner,op,{input:{}}),{code:'not_found'},op);
 }finally{await box.dispose();}
});

test('the edge index has no contact-link entries: no link check, and a queued link publication is dropped',async()=>{
 const store=memoryStore(),edge=createEdgeIndex(store);
 assert.equal(edge.check,undefined);assert.equal(edge.get,undefined);
 assert.equal(await edge.publish({iss:'https://bob.provider.example',jti:'jti-1',owner:'o',claimsDigest:'x',revoked:false,generation:1}),false);
 assert.deepEqual([...(await store.list({prefix:''})).keys()],[]);
 assert.equal(await edge.publish({kind:'host',issuer:'https://bob.provider.example',subject:P.bob.principal.subject,owner:'o',active:true,generation:1}),true);
});
