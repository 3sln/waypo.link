// Review follow-up #1 (2026-10-23): an invited room must not become active without the owner's acceptance, and a
// room admitted through a quarantined parent stays quarantined (hidden from the default list, events quarantined
// and unnotified) until the owner accepts it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {INVITE_MIME,sign} from '../packages/conversations/index.mjs';
import {conversationService,conversationInbox} from '../packages/conversations/runtime.mjs';

async function world(t){
 const directory=await mkdtemp(join(tmpdir(),'conversation-acceptance-'));const origin='http://localhost:8788';let network=1;
 const app=await createNodeServer({directory,config:{WORK_LIMITS_ENABLED:'false'}});t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const req=async(path,{user,method='GET',value}={})=>app.fetch(new Request(origin+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+network++,...user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:origin}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
 const j=async(path,options)=>{const r=await req(path,options);assert.ok(r.ok,`${r.status} ${await r.clone().text()}`);return r.json();};
 const signup=async handle=>{const post=(path,value)=>req(path,{method:'POST',value,user:{cookie:'',csrf:''}});const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'Conversation fixture long password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();const user={cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,owner:session.account.id};user.collection=(await j('/api/account',{user})).collections[0].id;return user;};
 const a=await signup('accept_a'+network),b=await signup('accept_b'+network);
 const room=await j('/api/conversations',{user:a,method:'POST',value:{title:'Room',collection:a.collection}}),path='/api/conversations/'+a.owner+'/'+room.id+'/action';
 const action=(user,operation,input)=>j(path,{user,method:'POST',value:{operation,input}});
 const inviteRaw=async quarantined=>{const contact=await j('/api/contacts',{user:b,method:'POST',value:{name:'C',collections:[b.collection],mimeTypes:[INVITE_MIME],expiresAt:Date.now()+3600000,maxMessages:10}});if(quarantined)await j('/api/contacts/'+contact.id+'/quarantine',{user:b,method:'POST',value:{quarantined:true}});return action(a,'invite',{target:{origin,owner:b.owner},confirmed:true,contactURL:contact.url,collection:b.collection});};
 const invite=async quarantined=>{const contact=await j('/api/contacts',{user:b,method:'POST',value:{name:'C',collections:[b.collection],mimeTypes:[INVITE_MIME],expiresAt:Date.now()+3600000,maxMessages:10}});if(quarantined)await j('/api/contacts/'+contact.id+'/quarantine',{user:b,method:'POST',value:{quarantined:true}});assert.equal((await action(a,'invite',{target:{origin,owner:b.owner},confirmed:true,contactURL:contact.url,collection:b.collection})).complete,true);};
 const receiver=app.resources.accounts.get(b.owner),source=app.resources.accounts.get(a.owner);
 // A malicious source adds the invitee as a member without its acceptance and pushes the membership.
 const forceMembership=async()=>{const svc=conversationService(source,a.owner),rpath=[...(await source.metadata.list({prefix:'conversation/room/'})).keys()][0],r=await source.metadata.get(rpath);const identity=await receiver.invoke({method:'conversationPublicIdentity',args:[b.owner]});r.members=[...r.members,{origin,owner:b.owner,key:identity.key,permissions:{send:true,invite:false,admin:false},collection:b.collection}];r.revision++;await source.metadata.put(rpath,r);const membership=await svc.membership(r);return {r,membership,result:await receiver.invoke({method:'conversationReceive',args:[b.owner,'membership',{source:{origin,owner:a.owner},id:room.id,payload:membership,secret:await svc.capability(r)}]})};};
 const pushEvent=async(r,membership)=>{const event={version:1,kind:'event',conversationId:room.id,source:{origin,owner:a.owner},eventId:crypto.randomUUID(),epoch:r.epoch,revision:r.revision,threadId:crypto.randomUUID(),replyTo:null,title:r.title,text:'Pushed text',tags:[],actor:`${origin}/entities/${a.owner}`,createdAt:Date.now(),membership};return receiver.invoke({method:'conversationReceive',args:[b.owner,'event',{source:{origin,owner:a.owner},id:room.id,payload:await sign(event,(await source.conversationIdentity(a.owner)).privateKey)}]});};
 const rooms=async()=>[...(await receiver.metadata.list({prefix:'conversation/room/'})).values()];
 const svc=()=>conversationService(source,a.owner),sourceRoom=async()=>{const rpath=[...(await source.metadata.list({prefix:'conversation/room/'})).keys()][0];return {rpath,r:await source.metadata.get(rpath)};};
 const withB=async r=>{const identity=await receiver.invoke({method:'conversationPublicIdentity',args:[b.owner]});return r.members.some(m=>m.owner===b.owner)?r:{...r,members:[...r.members,{origin,owner:b.owner,key:identity.key,permissions:{send:true,invite:false,admin:false},collection:b.collection}]};};
 const receive=(kind,payload,extra={})=>receiver.invoke({method:'conversationReceive',args:[b.owner,kind,{source:{origin,owner:a.owner},id:room.id,payload,...extra}]});
 const eventAt=async(snapshot,{epoch,revision})=>receive('event',await sign({version:1,kind:'event',conversationId:room.id,source:{origin,owner:a.owner},eventId:crypto.randomUUID(),epoch,revision,threadId:crypto.randomUUID(),replyTo:null,title:'Room',text:'Event text',tags:[],actor:`${origin}/entities/${a.owner}`,createdAt:Date.now(),membership:snapshot},(await source.conversationIdentity(a.owner)).privateKey));
 return {a,b,j,action,invite,inviteRaw,receiver,source,forceMembership,pushEvent,rooms,svc,sourceRoom,withB,receive,eventAt};
}

test('a membership push cannot activate an invited room the owner never accepted',async t=>{
 const w=await world(t);await w.invite(false);
 const {r,membership,result}=await w.forceMembership();
 assert.equal(result?.$fault?.code,'conversation_acceptance_required');
 assert.deepEqual((await w.rooms()).map(x=>x.state),['invited']);
 assert.equal((await w.pushEvent(r,membership))?.$fault?.code,'conversation_event_invalid');
 assert.equal((await w.receiver.metadata.list({prefix:'notification-event/'})).size,1,'only the invitation notified');
});

test('a quarantined parent cannot be used to bypass quarantine; the room stays hidden and quarantined until accepted',async t=>{
 const w=await world(t);await w.invite(true);
 const [room]=await w.rooms();assert.equal(room.quarantined,true);assert.equal(room.state,'invited');
 assert.equal((await w.j('/api/conversations',{user:w.b})).items.length,0,'a quarantined room is hidden from the default list');
 assert.equal((await w.j('/api/conversations?quarantined=1',{user:w.b})).items[0].quarantined,true);
 const {r,membership,result}=await w.forceMembership();
 assert.equal(result?.$fault?.code,'conversation_acceptance_required');
 assert.equal((await w.pushEvent(r,membership))?.$fault?.code,'conversation_event_invalid');
 assert.equal((await w.receiver.metadata.list({prefix:'notification-event/'})).size,0);
 // Events of a quarantined room (however reached) are stored quarantined and unnotified.
 const stored=await conversationInbox(w.receiver,w.b.owner,{...room,state:'active'},{version:1,kind:'event',conversationId:room.id,source:room.source,eventId:crypto.randomUUID(),threadId:crypto.randomUUID(),replyTo:null,title:room.title,text:'x',actor:'bearer',tags:[],createdAt:Date.now()});
 const message=await w.receiver.metadata.get('message/'+encodeURIComponent(w.b.owner)+'/'+stored.id+'/')??[...(await w.receiver.metadata.list({prefix:'message/'})).values()].find(m=>m.id===stored.id);
 assert.equal(message.quarantined,true);assert.equal((await w.receiver.metadata.list({prefix:'notification-event/'})).size,0);
 // The owner's explicit acceptance records acceptedAt and releases the room's quarantine.
 await w.action(w.b,'accept',{confirmed:true});
 const [accepted]=await w.rooms();assert.ok(Number.isSafeInteger(accepted.acceptedAt));assert.equal(accepted.quarantined,undefined);
});

test('a removal pushed to a room the owner never joined changes nothing and opens no path to activation',async t=>{
 for(const quarantined of [false,true]){
  const w=await world(t);await w.invite(quarantined);const svc=w.svc(),{rpath,r}=await w.sourceRoom();
  r.revision++;r.epoch++;await w.source.metadata.put(rpath,r);
  assert.equal((await w.receive('removed',await svc.membership(r)))?.$fault,undefined,'removal stays silent');
  assert.deepEqual((await w.rooms()).map(x=>x.state),['invited']);
  const forged=await w.withB(r);
  assert.equal((await w.eventAt(await svc.membership(forged),{epoch:r.epoch,revision:r.revision}))?.$fault?.code,'conversation_event_invalid');
  forged.revision++;
  assert.equal((await w.receive('membership',await svc.membership(forged),{secret:await svc.capability(r)}))?.$fault?.code,'conversation_acceptance_required');
  assert.deepEqual((await w.rooms()).map(x=>x.state),['invited']);
  assert.equal((await w.receiver.metadata.list({prefix:'notification-event/'})).size,quarantined?0:1,'only the invitation may notify');
 }
});

test('after removal only events predating the removal epoch are accepted, and a membership cannot reactivate the room',async t=>{
 const w=await world(t);await w.invite(false);await w.action(w.b,'accept',{confirmed:true});
 const [joined]=await w.rooms();assert.equal(joined.state,'active');assert.ok(Number.isSafeInteger(joined.joinedAt));
 const before=await w.sourceRoom(),snapshot=before.r.membership;
 await w.action(w.a,'remove',{confirmed:true,target:{origin:'http://localhost:8788',owner:w.b.owner}});
 const [removed]=await w.rooms();assert.equal(removed.state,'removed');assert.ok(removed.removedEpoch>before.r.epoch);
 assert.equal((await w.eventAt(snapshot,{epoch:before.r.epoch,revision:before.r.revision}))?.$fault,undefined,'a late event from before the removal is lost');
 const svc=w.svc(),{r}=await w.sourceRoom(),forged=await w.withB(r);
 assert.equal((await w.eventAt(await svc.membership(forged),{epoch:r.epoch,revision:r.revision}))?.$fault?.code,'conversation_event_invalid');
 forged.revision++;
 assert.equal((await w.receive('membership',await svc.membership(forged),{secret:await svc.capability(r)}))?.$fault?.code,'conversation_acceptance_required');
 assert.equal((await w.rooms())[0].state,'removed');
});

test('a fresh invitation resets a removed room to invited and needs a new acceptance',async t=>{
 const w=await world(t);await w.invite(false);await w.action(w.b,'accept',{confirmed:true});
 await w.action(w.a,'remove',{confirmed:true,target:{origin:'http://localhost:8788',owner:w.b.owner}});
 await w.invite(true);
 const [reset]=await w.rooms();assert.equal(reset.state,'invited');assert.equal(reset.acceptedAt,undefined);assert.equal(reset.joinedAt,undefined);assert.equal(reset.quarantined,true,'quarantine follows the current parent');
 await w.action(w.b,'accept',{confirmed:true});
 const [active]=await w.rooms();assert.equal(active.state,'active');assert.ok(Number.isSafeInteger(active.acceptedAt));
});

test('expired invitations are collected and quarantined invitations have their own small cap',async t=>{
 const {SqliteMetadata}=await import('../apps/node/resources.mjs'),{ConversationService}=await import('../packages/conversations/index.mjs');
 const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());let now=Date.now();
 const service=new ConversationService({metadata,owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',origin:'https://provider.example',clock:()=>now,maxRooms:3,maxQuarantinedRooms:2});
 const put=(i,row)=>metadata.put(`conversation/room/x/${String(i).padStart(4,'0')}`,row);
 for(let i=0;i<2;i++)await put(i,{state:'invited',quarantined:true,expiresAt:now+60000});
 await assert.rejects(service.roomQuota({quarantined:true}),{code:'conversation_room_quota'});
 await service.roomQuota({quarantined:false});
 for(let i=2;i<5;i++)await put(i,{state:'declined',expiresAt:now+60000});
 await put(5,{state:'active'});await put(6,{state:'removed'});await put(7,{state:'invited',expiresAt:now+60000});
 await assert.rejects(service.roomQuota({quarantined:false}),{code:'conversation_room_quota'},'declined rooms are excluded but the rest count');
 now+=120000;
 await service.roomQuota({quarantined:true});await service.roomQuota({quarantined:false});
 assert.equal((await metadata.list({prefix:'conversation/room/'})).size,2,'expired invited and declined rooms are collected');
});

test('a declined invitation stands until it expires, and replacing an expired one takes the room quota',async t=>{
 const w=await world(t);await w.invite(false);await w.action(w.b,'decline',{});
 assert.deepEqual((await w.rooms()).map(x=>x.state),['declined']);
 await w.inviteRaw(false);
 assert.deepEqual((await w.rooms()).map(x=>x.state),['declined'],'a re-invite overrode the owner\'s decline');
 // Expire the declined invitation and fill the account's room quota with active rooms.
 const [path]=[...(await w.receiver.metadata.list({prefix:'conversation/room/'})).keys()],room=await w.receiver.metadata.get(path);
 await w.receiver.metadata.put(path,{...room,expiresAt:Date.now()-1000});
 for(let i=0;i<100;i++)await w.receiver.metadata.put(`conversation/room/zz/${String(i).padStart(3,'0')}`,{state:'active'});
 const refused=await w.inviteRaw(false);
 assert.equal(refused.peers?.[0]?.code,'conversation_room_quota',JSON.stringify(refused.peers));
 assert.equal((await w.receiver.metadata.get(path))?.state,'declined','a refused replacement leaves the expired record untouched');
});

test('events from before a removal are refused once the 10-minute grace has passed',async t=>{
 const w=await world(t);await w.invite(false);await w.action(w.b,'accept',{confirmed:true});
 const before=await w.sourceRoom(),snapshot=before.r.membership;
 await w.action(w.a,'remove',{confirmed:true,target:{origin:'http://localhost:8788',owner:w.b.owner}});
 const [path]=[...(await w.receiver.metadata.list({prefix:'conversation/room/'})).keys()],removed=await w.receiver.metadata.get(path);
 assert.ok(Number.isSafeInteger(removed.removedAt));
 await w.receiver.metadata.put(path,{...removed,removedAt:Date.now()-600001});
 assert.equal((await w.eventAt(snapshot,{epoch:before.r.epoch,revision:before.r.revision}))?.$fault?.code,'conversation_event_invalid');
});
