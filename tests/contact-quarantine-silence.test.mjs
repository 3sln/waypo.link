// Wargame M2 (2026-10-23, provisional decision in DEVLOG): quarantine is silent to link holders
// (contact-tokens.md "do not expose recipient quarantine status"). A quarantined link's profile GET and preview
// answer exactly like an active link's, POST delivery stays 202, and a conversation invitation through a
// quarantined parent is admitted as a quarantined, unnotified message instead of `conversation_contact_denied`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import application from '../packages/runtime/http.mjs';
import {createNodeServer} from '../apps/node/server.mjs';
import {INVITE_MIME} from '../packages/conversations/index.mjs';
import {authored} from './link-helpers.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PROFILE='application/vnd.bindle.contact-profile+json';
async function world(t){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const stored=new Map();
 const blobs={put:async(k,b)=>{stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{arrayBuffer:async()=>stored.get(k).buffer}:null,delete:async k=>stored.delete(k)};
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs,archives:{},config:{APP_ORIGIN:'https://provider.example',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 await controller.touch(OWNER);controller.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});
 const env={APP_ORIGIN:'https://provider.example',ABUSE_HASH_KEY:'k',ABUSE:{consume:async()=>true},IDENTITY_REPOSITORY:{get:async()=>({id:OWNER,status:'active',handle:'person'})},ACCOUNTS:{get:()=>controller}};
 const link=async()=>controller.createContactLink(OWNER,'person',{name:'x',mimeTypes:['text/plain'],expiresAt:Date.now()+3600000,maxMessages:10});
 const get=(url,accept)=>application.fetch(new Request(url,accept?{headers:{Accept:accept}}:{}),env);
 return {controller,env,link,get};
}

test('a quarantined link profile answers exactly like an active one and its deliveries stay 202',async t=>{
 const w=await world(t),active=await w.link(),paused=await w.link(),revoked=await w.link();
 await w.controller.beamContacts.enable(OWNER,paused.id,{discloseProfile:false});await w.controller.beamContacts.enable(OWNER,active.id,{discloseProfile:false});
 await w.controller.quarantineContact(OWNER,paused.id,true);await w.controller.revokeContact(OWNER,revoked.id);
 const a=await w.get(active.url,PROFILE),p=await w.get(paused.url,PROFILE),r=await w.get(revoked.url,PROFILE);
 const ab=await a.json(),pb=await p.text();
 assert.equal(p.status,a.status,`paused link is distinguishable: ${p.status} ${pb}`);
 assert.deepEqual(JSON.parse(pb),ab);assert.doesNotMatch(pb,/quarantin/i);
 assert.equal(r.status,404,'a revoked link still answers the uniform unknown');
 const head=await application.fetch(new Request(paused.url,{method:'HEAD',headers:{Accept:PROFILE}}),w.env);assert.equal(head.status,200);
 const m=await authored(input=>w.controller.authorLinkEnvelope(OWNER,input),paused.url,{text:'hi'});
 const d=await application.fetch(new Request(paused.url,{method:'POST',headers:{'Content-Type':m.contentType},body:m.bytes}),w.env);
 assert.equal(d.status,202);
 const [message]=(await w.controller.messages.list(OWNER)).filter(x=>x.grantId===paused.id);assert.equal(message.quarantined,true);
});

test('the oEmbed preview of a quarantined link is the verified card, not the generic one',async t=>{
 const w=await world(t),active=await w.link(),paused=await w.link();
 await w.controller.quarantineContact(OWNER,paused.id,true);
 const preview=url=>application.fetch(new Request('https://provider.example/oembed?url='+encodeURIComponent(url)),w.env);
 const a=await preview(active.url),p=await preview(paused.url);
 assert.equal(p.status,a.status);assert.deepEqual(await p.json(),await a.json());
});

test('a conversation invitation through a quarantined parent is admitted silently, quarantined and unnotified',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'quarantine-conversation-'));let app;const origin='http://localhost:8788';let network=1;
 try{
  app=await createNodeServer({directory,config:{WORK_LIMITS_ENABLED:'false'}});
  const req=async(path,{user,method='GET',value}={})=>app.fetch(new Request(origin+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+network++,...user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:origin}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
  const j=async(path,options)=>{const r=await req(path,options);assert.ok(r.ok,`${r.status} ${await r.clone().text()}`);return r.json();};
  const signup=async handle=>{const post=(path,value)=>req(path,{method:'POST',value,user:{cookie:'',csrf:''}});const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'Conversation fixture long password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();assert.ok(pending.pendingToken,JSON.stringify(pending));const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();const user={cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,owner:session.account.id};user.collection=(await j('/api/account',{user})).collections[0].id;return user;};
  const a=await signup('quarantine_a'),b=await signup('quarantine_b');
  const room=await j('/api/conversations',{user:a,method:'POST',value:{title:'Paused contact room',collection:a.collection}}),path='/api/conversations/'+a.owner+'/'+room.id+'/action';
  const contact=await j('/api/contacts',{user:b,method:'POST',value:{name:'Paused contact',collections:[b.collection],mimeTypes:[INVITE_MIME],expiresAt:Date.now()+3600000,maxMessages:10}});
  await j('/api/contacts/'+contact.id+'/quarantine',{user:b,method:'POST',value:{quarantined:true}});
  const invitation=await j(path,{user:a,method:'POST',value:{operation:'invite',input:{target:{origin,owner:b.owner},confirmed:true,contactURL:contact.url,collection:b.collection}}});
  assert.equal(invitation.complete,true,JSON.stringify(invitation));assert.ok(!invitation.peers?.[0]?.code,JSON.stringify(invitation.peers));
  const controller=app.resources.accounts.get(b.owner),messages=(await controller.messages.list(b.owner)).filter(m=>m.grantId===contact.id);
  assert.equal(messages.length,1);assert.equal(messages[0].quarantined,true);
  assert.equal((await controller.metadata.list({prefix:'notification-event/'})).size,0,'a quarantined invitation must not notify');
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});

test('redeeming a quarantined link answers like an active one but cannot take the single redemption slot',async t=>{
 const w=await world(t),paused=await w.link(),peer=crypto.randomUUID(),other=crypto.randomUUID();
 await w.controller.quarantineContact(OWNER,paused.id,true);
 const first=await w.controller.beamContacts.redeem(OWNER,paused.url,peer);
 assert.deepEqual(Object.keys(first).sort(),['expiresAt','grantId','owner','peer']);
 assert.equal(await w.controller.metadata.get('beam/redeemed/'+paused.id),undefined,'a quarantined redemption was persisted');
 assert.equal((await w.controller.beamContacts.redeem(OWNER,paused.url,other)).peer,other,'another holder is answered the same way');
 await w.controller.quarantineContact(OWNER,paused.id,false);
 await w.controller.beamContacts.redeem(OWNER,paused.url,peer);
 assert.equal((await w.controller.metadata.get('beam/redeemed/'+paused.id))?.peer,peer,'after release the owner-chosen holder redeems normally');
 await assert.rejects(w.controller.beamContacts.redeem(OWNER,paused.url,other),{code:'contact_already_redeemed'});
});
