// Contacts spike phase 3 (messaging §4.1–§4.2; provisional, unsigned): the Parlay web handler for `connect`, at the
// client engine level with a recording mailbox. No provider code is imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {forEachSeed,createScheduler} from '../helpers/chaos.mjs';
import {createClientEngine} from '../../apps/parlay/web/bl/client.mjs';
import {CONNECT_KIND,CONNECT_REFERENCE} from '../../apps/parlay/web/bl/intents.mjs';
import {WEB_OPERATIONS} from '../../apps/parlay/web/providers/mailbox.mjs';
import {encodeIntent} from '../../packages/intents/format.mjs';
import {validateIntentKind,validateIntentData} from '../../packages/intents/schema.mjs';
import {verifyChain} from '../../packages/core/artefacts.mjs';

const uuid='00000000-0000-4000-8000-000000000001';
const data=(extra={})=>({inviter:{iss:'https://inviter.example',sub:uuid},token:'Qk9CLWludml0YXRpb24tdG9rZW4tZml4dHVyZS0wMQ',delegation:'aGVhZGVy.Y2xhaW1z.c2ln',expires_at:1893456000,...extra});
const value=d=>encodeIntent({bintent:1,kind:{...CONNECT_REFERENCE},data:d});
function fixture({fail={},scheduler}={}){
 let now=0;const calls=[],mailbox={async run(name,args){calls.push([name,structuredClone(args)]);if(fail[name])throw Object.assign(new Error(fail[name]),{code:fail[name]});
  if(name==='invites.inspect')return {inviter:{issuer:'https://inviter.example',subject:uuid},handle:null,host:'inviter.example',expiresAt:null,hint:null,alreadyContact:false,pending:null};
  if(name==='invites.redeem')return {state:'pending',conversationId:uuid};return {};}};
 const client=createClientEngine({PARLAY_ENABLED:true,INTENT_LINKS_ENABLED:true,browser:{now:()=>now,owner:uuid,id:()=>uuid},mailbox:scheduler?scheduler.wrap(mailbox,'mailbox'):mailbox});
 return {client,calls,time:v=>{now=v;},names:()=>calls.map(c=>c[0])};
}

test('connect artefact is a valid intent kind whose verified digest is the pinned handler reference',async()=>{
 const envelope=JSON.parse(await readFile(new URL('../../docs/artefacts/intents/connect-v1.json',import.meta.url),'utf8'));
 assert.equal(envelope.id,CONNECT_KIND);assert.equal(envelope.versions.length,1);assert.equal(envelope.versions[0].prev,null);
 const body=validateIntentKind(envelope.versions[0].body);assert.equal(body.effect,'send');assert.equal(body.capability,true);assert.deepEqual(body.disclosure.categories,['personal-data','send-as-you']);
 assert.deepEqual(body.data.required,['delegation','inviter','token']);assert.equal(body.disclosure.fields.token.display,'presence');assert.equal(body.disclosure.fields.hint.title.en,"The inviter says you won't be able to reply");
 assert.equal((await verifyChain(envelope)).digest,CONNECT_REFERENCE.digest);
 validateIntentData(body,data({hint:'no-reply'}));assert.throws(()=>validateIntentData(body,data({hint:'other'})));assert.throws(()=>validateIntentData(body,{...data(),token:'x'.repeat(44)}));
});

test('connect: receipt is inert, the first armed confirmation only inspects, the second re-armed one redeems the same data',async()=>{
 const f=fixture();try{
  await f.client.run('intent',{value:value(data())});assert.deepEqual(f.names(),[]);
  await f.client.run('confirmIntent');assert.deepEqual(f.names(),[]);
  f.time(800);await f.client.run('confirmIntent');assert.deepEqual(f.names(),['invites.inspect']);assert.deepEqual(f.calls[0][1].input,{data:data()});
  assert.deepEqual(f.client.state.value.intentFlow.inspected,{handle:null,host:'inviter.example',hint:null,alreadyContact:false,pending:false});
  await f.client.run('confirmIntent');assert.deepEqual(f.names(),['invites.inspect']);
  f.time(1600);await f.client.run('confirmIntent');assert.deepEqual(f.names(),['invites.inspect','invites.redeem']);assert.deepEqual(f.calls[1][1].input,{data:data()});
  assert.equal(f.client.state.value.intentFlow,null);assert.equal(f.client.state.value.section,'conversations');
  await f.client.run('confirmIntent');assert.equal(f.calls.length,2);
 }finally{await f.client.dispose();}
});

test('connect: local shape and expiry checks fetch nothing; failures are categorised and never reach redeem',async()=>{
 const f=fixture();try{
  await assert.rejects(f.client.run('intent',{value:value(data({token:'short'}))}),{code:'intent_malformed'});
  await assert.rejects(f.client.run('intent',{value:value(data({delegation:'not-a-jws'}))}),{code:'intent_malformed'});
  await f.client.run('intent',{value:value(data({expires_at:0}))});assert.equal(f.client.state.value.intentFlow.error,'used');f.time(5000);await f.client.run('confirmIntent');assert.deepEqual(f.names(),[]);
 }finally{await f.client.dispose();}
 for(const [code,category] of [['invite_unverifiable','unverifiable'],['invite_expired','used'],['invite_used','used'],['invalid_input','used']]){
  const g=fixture({fail:{'invites.inspect':code}});try{await g.client.run('intent',{value:value(data())});g.time(800);await g.client.run('confirmIntent');g.time(1e6);await g.client.run('confirmIntent');
   assert.deepEqual(g.names(),['invites.inspect']);assert.equal(g.client.state.value.intentFlow.error,category);assert.equal(g.client.state.value.intentFlow.terminal,true);}finally{await g.client.dispose();}
 }
 const r=fixture({fail:{'invites.inspect':'recipient_unavailable'}});try{await r.client.run('intent',{value:value(data())});r.time(800);await r.client.run('confirmIntent');assert.equal(r.client.state.value.intentFlow.error,'unavailable');
  await r.client.run('confirmIntent');assert.deepEqual(r.names(),['invites.inspect']);r.time(1600);await r.client.run('confirmIntent');assert.deepEqual(r.names(),['invites.inspect','invites.inspect']);}finally{await r.client.dispose();}
 const u=fixture({fail:{'invites.redeem':'invite_used'}});try{await u.client.run('intent',{value:value(data())});u.time(800);await u.client.run('confirmIntent');u.time(1600);await u.client.run('confirmIntent');u.time(1e6);await u.client.run('confirmIntent');
  assert.deepEqual(u.names(),['invites.inspect','invites.redeem']);assert.equal(u.client.state.value.intentFlow.error,'used');}finally{await u.client.dispose();}
 const late=fixture();try{await late.client.run('intent',{value:value(data())});late.time(3600000);await late.client.run('confirmIntent');assert.deepEqual(late.names(),[]);}finally{await late.client.dispose();}
});

test('seeded concurrent connect confirmations inspect once, then redeem once',()=>forEachSeed(12,async random=>{
 const scheduler=createScheduler(random),f=fixture({scheduler});try{
  await f.client.run('intent',{value:value(data())});f.time(800);
  const first=await scheduler.run(random.shuffle(Array.from({length:6},()=>()=>f.client.run('confirmIntent'))));assert.ok(first.every(r=>r.status==='fulfilled'));assert.deepEqual(f.names(),['invites.inspect']);
  f.time(1600);const second=await scheduler.run(random.shuffle(Array.from({length:6},()=>()=>f.client.run('confirmIntent'))));assert.ok(second.every(r=>r.status==='fulfilled'));assert.deepEqual(f.names(),['invites.inspect','invites.redeem']);
 }finally{await f.client.dispose();}
}));

test('owner web operations expose invitations and lists, never the system mint or ingress operations',()=>{
 for(const name of ['invites.inspect','invites.redeem','invites.create','invites.list','invites.revoke','lists.list','lists.members','lists.add','lists.remove'])assert.ok(WEB_OPERATIONS.includes(name),name);
 assert.equal(WEB_OPERATIONS.includes('invites.mint-bound'),false);assert.equal(WEB_OPERATIONS.some(name=>name.startsWith('receive.')&&name!=='receive.body'),false);
});

test('invite a person: the link carries the pinned connect kind, appears once in memory, and the token never leaves state',async()=>{
 const {fixture:mailboxFixture,INVITE_TOKEN}=await import('./browser/fixture.mjs'),{decodeIntent}=await import('../../packages/intents/format.mjs');
 const f=mailboxFixture({size:1}),client=createClientEngine({PARLAY_ENABLED:true,mailbox:f.mailbox,browser:f.browser});try{
  await client.run('navigate',{section:'contacts'});const result=await client.run('invite',{kind:'create',name:' for Bob '});
  assert.deepEqual(Object.keys(result),['id']);assert.deepEqual(f.calls.filter(c=>c.name==='invites.create').map(c=>c.input),[{template:'person',name:'for Bob'}]);
  const link=client.state.value.freshInvite.link;assert.match(link,/^web\+bindle:\/\/intent\?bintent=[A-Za-z0-9_-]+$/);const intent=decodeIntent(link.slice(link.indexOf('=')+1));
  assert.deepEqual(intent.kind,CONNECT_REFERENCE);assert.equal(intent.data.token,INVITE_TOKEN);assert.equal([...f.drafts.values()].some(v=>String(v).includes(INVITE_TOKEN)),false);
  await client.run('navigate',{section:'conversations'});assert.equal(client.state.value.freshInvite,null);
  await assert.rejects(client.run('invite',{kind:'unknown'}),TypeError);
 }finally{await client.dispose();}
});

test('contacts spike phase 4: the contact-link intent kinds are refused on receipt and nothing reaches the mailbox',async()=>{
 const f=fixture();try{
  // The former pinned digests of send-message and add-contact (their data carried a contact link).
  for(const [artefact,digest] of [['https://spec.bindle.example/intents/send-message/v1','sha256-lWZkE2SQRlCcsCRMZ2ven529CrbjGNAsgxHWSyIF4MU'],['https://spec.bindle.example/intents/add-contact/v1','sha256-Nu6S97f-t26Tk_KCTwaHtaWgxUGSOJ3JUIn4gdBeaZs']]){
   await assert.rejects(f.client.run('intent',{value:encodeIntent({bintent:1,kind:{artefact,version:1,digest},data:{contact:'https://person.example/c?bindle_meta=a.b.c'}})}),{code:'intent_kind_invalid'},artefact);
   assert.equal(f.client.state.value.intentFlow??null,null);
  }
  assert.deepEqual(f.names(),[]);
  for(const op of ['contacts.add','contacts.list','contacts.remove','shell.conversation-create'])assert.equal(WEB_OPERATIONS.includes(op),false,op);
 }finally{f.client.dispose();}
});
