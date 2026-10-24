// Scale round 2 review M1 (2026-10-24): the runtime inbox writes `conversation/inbox-message/` receipts through the raw
// account store, not ConversationService's metadata. After the legacy index migration finishes, the sweep reads only the
// due projection, so the account controller itself must maintain it for every writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {INVITE_MIME,ConversationService,RECEIPT_RETENTION_MS,memberId} from '../packages/conversations/index.mjs';
import {conversationInbox} from '../packages/conversations/runtime.mjs';

test('runtime inbox receipts written after index migration are indexed and collected',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'conversation-receipt-index-'));let app;const origin='http://localhost:8788';let network=1;
 try{
  app=await createNodeServer({directory,config:{WORK_LIMITS_ENABLED:'false'}});
  const req=async(path,{user,method='GET',value}={})=>app.fetch(new Request(origin+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+network++,...user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:origin}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
  const j=async(path,options)=>{const r=await req(path,options);assert.ok(r.ok,`${r.status} ${await r.clone().text()}`);return r.json();};
  const signup=async handle=>{const post=(path,value)=>req(path,{method:'POST',value,user:{cookie:'',csrf:''}});const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'Conversation fixture long password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();assert.ok(pending.pendingToken,JSON.stringify(pending));const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();const user={cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,owner:session.account.id};user.collection=(await j('/api/account',{user})).collections[0].id;return user;};
  const a=await signup('receipt_index_a'),b=await signup('receipt_index_b');
  const room=await j('/api/conversations',{user:a,method:'POST',value:{title:'Receipt room',collection:a.collection}}),path='/api/conversations/'+a.owner+'/'+room.id+'/action';
  const action=(user,operation,input)=>j(path,{user,method:'POST',value:{operation,input}});
  const contact=await j('/api/contacts',{user:b,method:'POST',value:{name:'Conversation contact',collections:[b.collection],mimeTypes:[INVITE_MIME],expiresAt:Date.now()+3600000,maxMessages:10}});
  assert.equal((await action(a,'invite',{target:{origin,owner:b.owner},confirmed:true,contactURL:contact.url,collection:b.collection})).complete,true);
  await action(b,'accept',{confirmed:true});
  const post=await action(b,'post',{text:'Seed event'});assert.equal(post.complete,true);
  const receiver=app.resources.accounts.get(b.owner),source=app.resources.accounts.get(a.owner),stored=await source.metadata.get('conversation/event/'+room.id+'/'+post.eventId);
  let now=Date.now();
  const svc=new ConversationService({metadata:receiver.metadata,owner:b.owner,origin,seal:async v=>v,open:async v=>v,identity:async()=>null,transport:async()=>{},inbox:async()=>({}),clock:()=>now});
  for(let i=0;i<20&&(await receiver.metadata.get('conversation/sweep/index-migration'))?.phase!==3;i++)await svc.sweep({limit:64});
  assert.equal((await receiver.metadata.get('conversation/sweep/index-migration'))?.phase,3,'the legacy index migration finished first');
  const receiverRoom=[...(await receiver.metadata.list({prefix:'conversation/room/'})).values()][0],event={...stored,eventId:crypto.randomUUID(),createdAt:Date.now()};
  assert.equal((await conversationInbox(receiver,b.owner,receiverRoom,event)).accepted,true);
  const receipt=`conversation/inbox-message/${encodeURIComponent(memberId({origin,owner:a.owner}))}/${room.id}/${event.eventId}`;
  assert.ok(await receiver.metadata.get(receipt),'the runtime write path stored a receipt');
  assert.ok([...(await receiver.metadata.list({prefix:'conversation/sweep/due/'})).values()].includes(receipt),'the receipt has a due pointer');
  now+=RECEIPT_RETENTION_MS*2;
  for(let i=0;i<20&&await receiver.metadata.get(receipt);i++)await svc.sweep({limit:64});
  assert.equal(await receiver.metadata.get(receipt),undefined,'the receipt is collected after retention');
  assert.ok(![...(await receiver.metadata.list({prefix:'conversation/sweep/due/'})).values()].includes(receipt),'its due pointer is gone');
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});
