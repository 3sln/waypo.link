// Wargame follow-up (2026-10-23): a conversation `receive` must not pass signed tags, reply targets or createdAt
// through unvalidated. createdAt also names the receiver's history row, so a string value could address other keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {INVITE_MIME,sign} from '../packages/conversations/index.mjs';
import {conversationInbox} from '../packages/conversations/runtime.mjs';
import {FENCE_KEY} from '../packages/runtime/account-deletion.mjs';

test('signed event metadata from the source is validated like contact-delivery input',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'conversation-event-metadata-'));let app;const origin='http://localhost:8788';let network=1;
 try{
  app=await createNodeServer({directory,config:{WORK_LIMITS_ENABLED:'false'}});
  const req=async(path,{user,method='GET',value}={})=>app.fetch(new Request(origin+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+network++,...user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:origin}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
  const j=async(path,options)=>{const r=await req(path,options);assert.ok(r.ok,`${r.status} ${await r.clone().text()}`);return r.json();};
  const signup=async handle=>{const post=(path,value)=>req(path,{method:'POST',value,user:{cookie:'',csrf:''}});const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'Conversation fixture long password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();assert.ok(pending.pendingToken,JSON.stringify(pending));const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();const user={cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,owner:session.account.id};user.collection=(await j('/api/account',{user})).collections[0].id;return user;};
  const a=await signup('event_meta_a'),b=await signup('event_meta_b');
  const room=await j('/api/conversations',{user:a,method:'POST',value:{title:'Metadata room',collection:a.collection}}),path='/api/conversations/'+a.owner+'/'+room.id+'/action';
  const action=(user,operation,input)=>j(path,{user,method:'POST',value:{operation,input}});
  const contact=await j('/api/contacts',{user:b,method:'POST',value:{name:'Conversation contact',collections:[b.collection],mimeTypes:[INVITE_MIME],expiresAt:Date.now()+3600000,maxMessages:10}});
  assert.equal((await action(a,'invite',{target:{origin,owner:b.owner},confirmed:true,contactURL:contact.url,collection:b.collection})).complete,true);
  await action(b,'accept',{confirmed:true});
  const post=await action(b,'post',{text:'A valid event',tags:['shared']});assert.equal(post.complete,true);
  const receiver=app.resources.accounts.get(b.owner),source=app.resources.accounts.get(a.owner),stored=await source.metadata.get('conversation/event/'+room.id+'/'+post.eventId),signer=await source.signingKey(a.owner);
  const deliver=async changes=>{const event={...stored,eventId:crypto.randomUUID(),...changes};return receiver.invoke({method:'conversationReceive',args:[b.owner,'event',{source:{origin,owner:a.owner},id:room.id,payload:await sign(event,signer.privateKey)}]});};
  for(const changes of [{createdAt:'0000000000000001/../../conversation/room/x'},{createdAt:Date.now()+3600000},{createdAt:-1},{tags:Array.from({length:17},(_,i)=>'t'+i)},{tags:['dup','dup']},{tags:['bad\u0000tag']},{tags:'not-a-list'},{replyTo:'../x'}]){
   const result=await deliver(changes);assert.equal(result?.$fault?.code,'conversation_event_invalid',JSON.stringify(changes));
  }
  assert.equal((await receiver.metadata.list({prefix:'conversation/history/'})).size,1,'no refused event reached history');
  const accepted=await deliver({createdAt:Date.now(),tags:['ok']});assert.equal(accepted?.$fault,undefined,JSON.stringify(accepted));
  // D1: the conversation inbox (also reached from the ungated drain) refuses to write once the deletion fence exists.
  const receiverRoom=[...(await receiver.metadata.list({prefix:'conversation/room/'})).values()][0],blobsBefore=(await receiver.metadata.list({prefix:'message/'})).size;
  await receiver.metadata.put(FENCE_KEY,{owner:b.owner});
  await assert.rejects(conversationInbox(receiver,b.owner,receiverRoom,{...stored,eventId:crypto.randomUUID(),createdAt:Date.now()}),{code:'account_deleting'});
  assert.equal((await receiver.metadata.list({prefix:'message/'})).size,blobsBefore);
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});
