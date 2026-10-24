// Conversations wargame round 3 (2026-10-23): regression tests ported from the red-team repros (C1–C5 and the refused
// re-invite). Every test here fails when its fix is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {ConversationService,INVITE_MIME,sign,memberId,REMOVED_GRACE_MS,ROOM_RETENTION_MS,RECEIPT_RETENTION_MS,MAX_HISTORY_PER_ROOM} from '../packages/conversations/index.mjs';

function memoryMetadata(){
 const rows=new Map();
 const api={
  async get(k){const v=rows.get(k);return v===undefined?undefined:structuredClone(v);},
  async put(k,v){rows.set(k,structuredClone(v));},
  async delete(k){rows.delete(k);},
  async list({prefix='',startAfter,limit=1000}={}){const out=new Map();for(const k of [...rows.keys()].sort()){if(!k.startsWith(prefix))continue;if(startAfter!==undefined&&k<=startAfter)continue;out.set(k,structuredClone(rows.get(k)));if(out.size>=limit)break;}return out;},
  async setAlarm(){},
  async transaction(fn){return fn(api);},
  rows
 };
 return api;
}
async function keypair(){const k=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const j=await crypto.subtle.exportKey('jwk',k.publicKey);return {privateKey:k.privateKey,publicJwk:{kty:j.kty,crv:j.crv,x:j.x,y:j.y}};}
const ORIGIN='https://a.example';
let now=1_800_000_000_000;
async function source({maxPending=512,maxRooms=100,transport=async()=>{},origin=ORIGIN}={}){
 const metadata=memoryMetadata(),id=await keypair(),owner=crypto.randomUUID(),inbox=[];
 const svc=new ConversationService({metadata,owner,origin,seal:async v=>structuredClone(v),open:async v=>structuredClone(v),identity:async()=>id,transport:(...a)=>transport(...a),inbox:async(room,event)=>{inbox.push(event);return {id:crypto.randomUUID()};},clock:()=>now,maxPending,maxRooms});
 return {svc,metadata,id,owner,inbox,self:{origin,owner}};
}
const advance=ms=>{now+=ms;};
const ownerOp=async(s,room,operation,input)=>{const r=await s.svc.record(s.self,room.id);const env=await s.svc.ownerEnvelope(r,operation,input);return s.svc.submit(s.self,room.id,await s.svc.capability(r),env);};
const memberOp=async(s,room,member,key,operation,input)=>{const r=await s.svc.record(s.self,room.id);const env=await sign({version:1,id:r.id,source:r.source,epoch:r.epoch,eventId:crypto.randomUUID(),actor:memberId(member),operation,input},key.privateKey);return s.svc.submit(s.self,room.id,await s.svc.capability(r),env);};
const pendingFor=async(s,room,member)=>[...(await s.metadata.list({prefix:`conversation/pending/${room.id}/`})).values()].find(p=>memberId(p.target)===memberId(member));
const acceptance=(s,room,pend,member,key)=>sign({version:1,kind:'acceptance',id:room.id,source:s.self,invitationId:pend.invitationId,member:{...member,key:key.publicJwk,collection:crypto.randomUUID()},confirmed:true},key.privateKey);
const inviteInput=member=>({confirmed:true,contactURL:member.origin+'/users/x/contact/'+crypto.randomUUID(),target:member,collection:crypto.randomUUID()});
async function addMember(s,room,member,key){await ownerOp(s,room,'invite',inviteInput(member));const pend=await pendingFor(s,room,member);return s.svc.join(await acceptance(s,room,pend,member,key),{...member,key:key.publicJwk});}
const peer=async origin=>({who:{origin,owner:crypto.randomUUID()},key:await keypair()});
const rows=async(s,prefix)=>[...(await s.metadata.list({prefix})).entries()];

test('C1: a permanently failing peer is dead-lettered outside the outbox bound and cannot wedge other rooms',async()=>{
 const bob=await peer('https://b.example'),maxPending=8;
 const s=await source({maxPending,transport:async(kind,target)=>{if(memberId(target)===memberId(bob.who)&&kind!=='invite')throw Object.assign(new Error('nope'),{code:'conversation_peer_rejected'});}});
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});
 await addMember(s,room,bob.who,bob.key);
 const drainAll=async()=>{for(let i=0;i<12;i++){await s.svc.drain({limit:32});advance(3600001);}};
 await drainAll();
 let last;for(let i=0;i<maxPending*2;i++){last=await ownerOp(s,room,'post',{text:'hi '+i});await drainAll();}
 assert.equal((await rows(s,'conversation/outbox/')).length,0,'retry-exhausted tasks leave the outbox');
 const dead=(await rows(s,'conversation/dead/')).map(([,t])=>t);
 assert.ok(dead.length>=maxPending*2&&dead.every(t=>t.state==='paused'&&memberId(t.target)===memberId(bob.who)));
 const receipt=await s.svc.delivery(room.id,last.eventId);
 assert.equal(receipt.peers.find(p=>p.peer===memberId(bob.who)).state,'paused','the per-peer delivery record is kept');
 await ownerOp(s,room,'remove',{confirmed:true,target:bob.who});await drainAll();
 const other=await s.svc.create({title:'Other',collection:crypto.randomUUID()});
 await assert.doesNotReject(()=>ownerOp(s,other,'post',{text:'after removal'}));
});

test('C1: removal cancels queued and dead-lettered tasks of any kind to the removed member; events only after the grace',async()=>{
 const bob=await peer('https://b.example');let failing=false;
 const s=await source({transport:async(kind,target)=>{if(failing&&memberId(target)===memberId(bob.who))throw Object.assign(new Error('down'),{code:'conversation_peer_rejected'});}});
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});
 await addMember(s,room,bob.who,bob.key);await s.svc.drain({limit:32});
 failing=true;
 const early=await ownerOp(s,room,'post',{text:'dead letter'});for(let i=0;i<10;i++){await s.svc.drain({limit:32});advance(3600001);}
 assert.equal((await rows(s,'conversation/dead/')).length,1,'the exhausted event to bob is dead-lettered');
 const posted=await ownerOp(s,room,'post',{text:'accepted before removal'});
 await ownerOp(s,room,'permissions',{confirmed:true,target:bob.who,permissions:{invite:false}});
 const removal=await ownerOp(s,room,'remove',{confirmed:true,target:bob.who});
 const queued=(await rows(s,'conversation/outbox/')).map(([,t])=>t).filter(t=>memberId(t.target)===memberId(bob.who));
 assert.deepEqual(queued.map(t=>t.kind).sort(),['event','removed'],'membership tasks to the removed member are cancelled at removal');
 assert.equal((await rows(s,'conversation/dead/')).length,0,'dead letters to the removed member are cancelled');
 assert.equal((await s.svc.delivery(room.id,early.eventId)).peers.find(p=>p.peer===memberId(bob.who)).state,'cancelled');
 advance(REMOVED_GRACE_MS+1);await s.svc.drain({limit:32});
 const bobPeer=(await s.svc.delivery(room.id,posted.eventId)).peers.find(p=>p.peer===memberId(bob.who));
 assert.equal(bobPeer.state,'cancelled','the pre-removal event is cancelled once the recipient grace has passed');
 assert.deepEqual((await rows(s,'conversation/outbox/')).map(([,t])=>t.kind),['removed'],'only the removal notice is still queued');
 assert.equal((await s.svc.delivery(room.id,removal.eventId)).peers.find(p=>p.peer===memberId(bob.who)).state,'pending');
});

test('C1: each peer and each room gets a fair share of the outbox bound',async()=>{
 const bob=await peer('https://b.example');
 const s=await source({maxPending:256,transport:async(kind,target)=>{if(memberId(target)===memberId(bob.who)&&kind!=='invite')throw Object.assign(new Error('slow'),{code:'conversation_peer_rejected'});}});
 // Peer share (32 of 256): bob is in two rooms and never answers; posts keep working and the overflow is dead-lettered.
 const rooms=[];for(let i=0;i<2;i++){const room=await s.svc.create({title:'P'+i,collection:crypto.randomUUID()});await addMember(s,room,bob.who,bob.key);rooms.push(room);}
 for(let i=0;i<40;i++)await ownerOp(s,rooms[i%2],'post',{text:'p'+i});
 const toBob=(await rows(s,'conversation/outbox/')).filter(([,t])=>memberId(t.target)===memberId(bob.who)).length;
 assert.ok(toBob<=32,`bob holds ${toBob} outbox slots`);
 const backlog=(await rows(s,'conversation/dead/')).map(([,t])=>t);
 assert.ok(backlog.length>0&&backlog.every(t=>t.code==='conversation_peer_backlog'));
 // An admin retry brings a backlogged task back once the peer has room.
 await s.svc.drain({limit:32});for(let i=0;i<10;i++){await s.svc.drain({limit:32});advance(3600001);}
 const [, sample]=backlog.map(t=>[t.id,t]).find(([id])=>id===rooms[0].id)||[];
 assert.ok(sample,'room 0 has a backlogged task');await s.svc.retry(s.self,sample.id,sample.eventId);assert.ok((await rows(s,'conversation/outbox/')).some(([,t])=>t.eventId===sample.eventId&&memberId(t.target)===memberId(bob.who)),'retry requeues a dead letter');assert.equal((await s.svc.delivery(sample.id,sample.eventId)).peers.find(p=>p.peer===memberId(bob.who)).state,'pending');
 // Room share (64 of 256): one busy room is refused while another still accepts.
 const t2=await source({maxPending:256});
 const busy=await t2.svc.create({title:'Busy',collection:crypto.randomUUID()}),quiet=await t2.svc.create({title:'Quiet',collection:crypto.randomUUID()});
 let accepted=0;for(;accepted<200;accepted++){try{await ownerOp(t2,busy,'post',{text:'b'+accepted});}catch(e){assert.equal(e.code,'conversation_outbox_quota');break;}}
 assert.equal(accepted,64,'one room takes at most its share');
 await assert.doesNotReject(()=>ownerOp(t2,quiet,'post',{text:'still open'}));
});

test('C2: a member joining after a policy lockdown gets the current policy, not the invite-time snapshot',async()=>{
 const s=await source(),bob=await peer('https://b.example');
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});
 await ownerOp(s,room,'invite',inviteInput(bob.who));
 await ownerOp(s,room,'policy',{confirmed:true,policy:{send:false,invite:false}});
 const view=await s.svc.join(await acceptance(s,room,await pendingFor(s,room,bob.who),bob.who,bob.key),{...bob.who,key:bob.key.publicJwk});
 const m=view.members.find(x=>memberId(x)===memberId(bob.who));
 assert.deepEqual(m.permissions,{send:false,invite:false,admin:false});
});

test('C3: removing a member voids its invitations; stale non-admin invitations are refused; admins see pending ones',async()=>{
 const s=await source(),bob=await peer('https://b.example'),carol=await peer('https://c.example'),alt=await peer('https://evil.example'),dan=await peer('https://d.example');
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});
 await addMember(s,room,bob.who,bob.key);await addMember(s,room,carol.who,carol.key);
 await memberOp(s,room,bob.who,bob.key,'invite',inviteInput(alt.who));
 await ownerOp(s,room,'invite',inviteInput(dan.who));
 let view=await s.svc.adminView(await s.svc.record(s.self,room.id));
 const altPending=view.pending.find(p=>memberId(p.target)===memberId(alt.who));
 assert.equal(altPending.issuer,memberId(bob.who));assert.equal(altPending.epoch,view.epoch);
 const altInvite=await pendingFor(s,room,alt.who);
 // carol (non-admin) invites too; then bob is removed and the epoch rotates.
 const eve=await peer('https://e.example');await memberOp(s,room,carol.who,carol.key,'invite',inviteInput(eve.who));const eveInvite=await pendingFor(s,room,eve.who);
 await ownerOp(s,room,'remove',{confirmed:true,target:bob.who});
 assert.equal(await pendingFor(s,room,alt.who),undefined,'the removed member\'s pending invitation is deleted');
 assert.ok(!(await rows(s,'conversation/outbox/')).some(([,t])=>t.kind==='invite'&&memberId(t.target)===memberId(alt.who)),'its queued invite is cancelled');
 await assert.rejects(async()=>s.svc.join(await acceptance(s,room,altInvite,alt.who,alt.key),{...alt.who,key:alt.key.publicJwk}),{code:'conversation_acceptance_invalid'});
 await assert.rejects(async()=>s.svc.join(await acceptance(s,room,eveInvite,eve.who,eve.key),{...eve.who,key:eve.key.publicJwk}),{code:'conversation_invitation_stale'},'a non-admin invitation from an earlier epoch admits nobody');
 view=await s.svc.adminView(await s.svc.record(s.self,room.id));
 assert.equal(view.pending.find(p=>memberId(p.target)===memberId(eve.who)).current,false);
 // The admin's own invitation survives the rotation.
 const joined=await s.svc.join(await acceptance(s,room,await pendingFor(s,room,dan.who),dan.who,dan.key),{...dan.who,key:dan.key.publicJwk});
 assert.ok(joined.members.some(m=>memberId(m)===memberId(dan.who)));
 assert.equal(Object.hasOwn(s.svc.view(await s.svc.record(s.self,room.id)),'pending'),false,'only the admin view lists pending invitations');
});

// Member-side fixture: the source room record is copied into a member service, as an accepted membership would.
async function memberWorld({maxRooms=100}={}){
 const s=await source(),b=await source({origin:'https://b.example',maxRooms});
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});
 await addMember(s,room,b.self,b.id);
 const r=await s.svc.record(s.self,room.id),rpath=[...(await s.metadata.list({prefix:'conversation/room/'})).keys()][0];
 const local={...structuredClone(r),state:'active',acceptedAt:now,joinedAt:now,joinedEpoch:r.epoch};delete local.events;delete local.operations;delete local.bytes;
 await b.metadata.put(rpath,local);
 const event=async(over={})=>{const cur=await s.svc.record(s.self,room.id);return {source:s.self,id:room.id,payload:await sign({version:1,kind:'event',conversationId:room.id,source:s.self,eventId:crypto.randomUUID(),epoch:cur.epoch,revision:cur.revision,threadId:crypto.randomUUID(),replyTo:null,title:cur.title,text:'hello',tags:[],actor:'bearer',createdAt:now,membership:cur.membership,...over},s.id.privateKey)};};
 return {s,b,room,rpath,event};
}

test('C4: history rows are message references, capped per room, and replay receipts are collected after retention',async()=>{
 const w=await memberWorld(),hp=`conversation/history/`;
 const first=await w.event();await w.b.svc.receive('event',first);
 const [[,row]]=await rows(w.b,hp);
 assert.equal(row.text,undefined,'history holds no text copy');assert.ok(row.messageId);
 // Cap: MAX_HISTORY_PER_ROOM rows at most (oldest evicted in batches).
 for(let i=0;i<MAX_HISTORY_PER_ROOM+5;i++){advance(1);await w.b.svc.receive('event',await w.event({createdAt:now}));}
 const count=(await rows(w.b,hp)).length;
 assert.ok(count<=MAX_HISTORY_PER_ROOM,`history rows ${count}`);
 assert.equal(await w.b.metadata.get((await rows(w.b,hp))[0][0]).then(x=>x.eventId===first.payload.payload.eventId),false,'the oldest row was evicted');
 // Receipts: stamped, collected after the retention window; the old event is then refused, not readmitted.
 const inbound=await rows(w.b,'conversation/inbound/');assert.ok(inbound.every(([,v])=>Number.isSafeInteger(v.at)));
 advance(RECEIPT_RETENTION_MS+1);
 for(let i=0;i<200;i++){const done=await w.b.svc.sweep({limit:64});if(!done.receipts&&!(await rows(w.b,'conversation/inbound/')).length)break;}
 assert.equal((await rows(w.b,'conversation/inbound/')).length,0,'inbound receipts are collected');
 await assert.rejects(()=>w.b.svc.receive('event',first),{code:'conversation_event_stale'});
});

test('C5: removed and left rooms are collected after grace plus retention; create() uses the room accounting; leave',async()=>{
 const metadata=memoryMetadata(),id=await keypair();
 const service=new ConversationService({metadata,owner:crypto.randomUUID(),origin:'https://provider.example',clock:()=>now,maxRooms:3,seal:async v=>v,open:async v=>v,identity:async()=>id});
 for(let i=0;i<3;i++)await metadata.put(`conversation/room/x/${i}`,{state:'removed',removedAt:now,removedEpoch:2,joinedAt:now-1,joinedEpoch:1});
 await assert.rejects(()=>service.roomQuota(),{code:'conversation_room_quota'},'recently removed rooms still count');
 advance(REMOVED_GRACE_MS+ROOM_RETENTION_MS);
 await assert.doesNotReject(()=>service.roomQuota());
 assert.equal((await metadata.list({prefix:'conversation/room/'})).size,0);
 for(let i=0;i<3;i++)await metadata.put(`conversation/room/y/${i}`,{state:'declined',expiresAt:now+1000});
 advance(86400000);
 await assert.doesNotReject(()=>service.create({title:'Mine',collection:crypto.randomUUID()}),'expired declined invitations do not block creating rooms');
 // Leave: a joined member leaves; later events are refused, the room stops counting and is collected later.
 const w=await memberWorld({maxRooms:1});
 await w.b.svc.receive('event',await w.event());
 const left=await w.b.svc.leave(w.s.self,w.room.id);assert.equal(left.state,'left');
 await assert.rejects(async()=>w.b.svc.receive('event',await w.event()),{code:'conversation_event_invalid'});
 await assert.doesNotReject(()=>w.b.svc.roomQuota(),'a left room does not hold the quota');
 await assert.rejects(()=>w.s.svc.leave(w.s.self,w.room.id),{code:'conversation_source_cannot_leave'});
 advance(REMOVED_GRACE_MS+ROOM_RETENTION_MS);await w.b.svc.sweep({limit:64});
 assert.equal(await w.b.metadata.get(w.rpath),undefined,'the left room is collected');
});

async function world(t){
 const directory=await mkdtemp(join(tmpdir(),'conv-wargame3-'));const origin='http://localhost:8788';let network=1;
 const app=await createNodeServer({directory,config:{WORK_LIMITS_ENABLED:'false'}});t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const req=async(path,{user,method='GET',value}={})=>app.fetch(new Request(origin+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+network++,...user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:origin}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
 const j=async(path,o)=>{const r=await req(path,o);assert.ok(r.ok,`${path} ${r.status} ${await r.clone().text()}`);return r.json();};
 const signup=async handle=>{const post=(p,v)=>req(p,{method:'POST',value:v,user:{cookie:'',csrf:''}});const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'Conversation fixture long password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),s=await r.json();const u={cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:s.csrfToken,owner:s.account.id};u.collection=(await j('/api/account',{user:u})).collections[0].id;return u;};
 const a=await signup('wg3_a'),b=await signup('wg3_b');
 const room=await j('/api/conversations',{user:a,method:'POST',value:{title:'Room',collection:a.collection}}),path='/api/conversations/'+a.owner+'/'+room.id+'/action';
 const action=(user,operation,input)=>j(path,{user,method:'POST',value:{operation,input}});
 const invite=async()=>{const contact=await j('/api/contacts',{user:b,method:'POST',value:{name:'C',collections:[b.collection],mimeTypes:[INVITE_MIME],expiresAt:Date.now()+3600000,maxMessages:10}});return action(a,'invite',{target:{origin,owner:b.owner},confirmed:true,contactURL:contact.url,collection:b.collection});};
 return {app,j,a,b,room,origin,action,invite,receiver:app.resources.accounts.get(b.owner),source:app.resources.accounts.get(a.owner)};
}

test('C4: deleting conversation messages leaves no uncounted history copy behind, and history still reads text',async t=>{
 const w=await world(t);await w.invite();await w.action(w.b,'accept',{confirmed:true});
 const rpath=[...(await w.source.metadata.list({prefix:'conversation/room/'})).keys()][0],r=await w.source.metadata.get(rpath),key=(await w.source.conversationIdentity(w.a.owner)).privateKey;
 for(let i=0;i<3;i++){const ev={version:1,kind:'event',conversationId:w.room.id,source:{origin:w.origin,owner:w.a.owner},eventId:crypto.randomUUID(),epoch:r.epoch,revision:r.revision,threadId:crypto.randomUUID(),replyTo:null,title:r.title,text:'x'.repeat(16000),tags:[],actor:'bearer',createdAt:Date.now(),membership:r.membership};
  const res=await w.receiver.invoke({method:'conversationReceive',args:[w.b.owner,'event',{source:{origin:w.origin,owner:w.a.owner},id:w.room.id,payload:await sign(ev,key)}]});assert.equal(res?.$fault,undefined,JSON.stringify(res));}
 const history=await w.action(w.b,'history',{});
 assert.equal(history.items.length,3);assert.ok(history.items.every(h=>h.text==='x'.repeat(16000)&&h.messageId===undefined));
 const messages=[...(await w.receiver.metadata.list({prefix:'message/'})).values()].filter(m=>m?.conversation);
 for(const m of messages)await w.j('/api/messages/'+m.id,{user:w.b,method:'DELETE'});
 const left=[...(await w.receiver.metadata.list({prefix:'conversation/history/'})).values()];
 assert.equal(left.length,0,'history rows go with their messages');
 assert.equal((await w.action(w.b,'history',{})).items.length,0);
});

test('a refused re-invite over a declined room lands no inbox message and no notification',async t=>{
 const w=await world(t);await w.invite();await w.action(w.b,'decline',{});
 const count=async prefix=>(await w.receiver.metadata.list({prefix})).size;
 const before={messages:await count('message/'),notifications:await count('notification-event/')};
 await w.invite();
 const rooms=[...(await w.receiver.metadata.list({prefix:'conversation/room/'})).values()];
 assert.deepEqual(rooms.map(x=>x.state),['declined']);
 assert.deepEqual({messages:await count('message/'),notifications:await count('notification-event/')},before);
});

// Review follow-ups (2026-10-23).
const failingSource=async(bad,opts={})=>{const set=new Set();const s=await source({...opts,transport:async(kind,target)=>{if(set.has(memberId(target)))throw Object.assign(new Error('down'),{code:'conversation_peer_rejected'});}});return {s,fail:who=>set.add(memberId(who)),heal:who=>set.delete(memberId(who))};};

test('follow-up 1: slow peers never refuse the owner\'s posts, in one room or across the owner',async()=>{
 const scenario=async(roomCount,posts)=>{const {s,fail}=await failingSource(null,{maxPending:128});const rooms=[],slow=new Set();
  for(let k=0;k<roomCount;k++){const room=await s.svc.create({title:'R'+k,collection:crypto.randomUUID()});const ps=[];for(const o of ['m1','m2','ok']){const p=await peer(`https://${o}${k}.example`);await addMember(s,room,p.who,p.key);ps.push(p);}rooms.push(room);slow.add(memberId(ps[0].who));slow.add(memberId(ps[1].who));}
  for(let j=0;j<4;j++)await s.svc.drain({limit:32});
  for(const p of slow)fail({origin:p.split('/entities/')[0],owner:p.split('/entities/')[1]});
  for(let i=0;i<posts;i++)for(const room of rooms){await ownerOp(s,room,'post',{text:'hi '+i});for(let j=0;j<2;j++)await s.svc.drain({limit:32});advance(50);}
  const backlog=(await rows(s,'conversation/dead/')).map(([,t])=>t);
  assert.ok(backlog.length>0,'the slow peers gave way');
  assert.ok(backlog.every(t=>t.code==='conversation_peer_backlog'&&slow.has(memberId(t.target))),'only the slow peers give way; the owner and healthy peers are never displaced');
  assert.ok((await rows(s,'conversation/outbox/')).length<=256);};
 // maxPending 128: room share 64, peer share 32.
 await scenario(1,40);   // two slow members of one room exceed the room share
 await scenario(5,20);   // ten slow members across five rooms exceed the owner-wide bound
});

test('follow-up 1: tasks backing off count only up to a small allowance, so slow peers keep their queue',async()=>{
 const {s,fail}=await failingSource(),room=await s.svc.create({title:'R',collection:crypto.randomUUID()}),slow=[];
 for(let k=0;k<3;k++){const p=await peer(`https://s${k}.example`);await addMember(s,room,p.who,p.key);slow.push(p);}
 await s.svc.drain({limit:32});await s.svc.drain({limit:32});for(const p of slow)fail(p.who);
 // 3 x 60 tasks exceed the room share (128) but are mostly backing off, so none is displaced.
 for(let i=0;i<60;i++){await ownerOp(s,room,'post',{text:'b'+i});await s.svc.drain({limit:32});advance(60000);}
 assert.equal((await rows(s,'conversation/dead/')).filter(([,t])=>t.code==='conversation_peer_backlog').length,0);
 assert.ok((await rows(s,'conversation/outbox/')).length>128);
});

test('follow-up 4: backlog dead letters are re-driven when the peer accepts deliveries again',async()=>{
 const {s,fail,heal}=await failingSource(),l=await peer('https://l.example');
 const rooms=[];for(let k=0;k<2;k++){const room=await s.svc.create({title:'R'+k,collection:crypto.randomUUID()});await addMember(s,room,l.who,l.key);rooms.push(room);}
 await s.svc.drain({limit:32});await s.svc.drain({limit:32});
 fail(l.who);const posts=[];
 for(let i=0;i<40;i++)for(const room of rooms){posts.push([room.id,(await ownerOp(s,room,'post',{text:'x'+i})).eventId]);await s.svc.drain({limit:32});}
 assert.ok((await rows(s,'conversation/dead/')).length>0,'the slow peer built a backlog');
 heal(l.who);
 for(let i=0;i<40;i++){await s.svc.drain({limit:32});advance(3600001);}
 assert.equal((await rows(s,'conversation/dead/')).length,0,'no backlog is left behind');
 for(const [id,eventId] of posts)assert.equal((await s.svc.delivery(id,eventId)).complete,true);
});

test('follow-up 5: an event dead letter expires before the receiver would refuse it as stale',async()=>{
 const {s,fail}=await failingSource(),bob=await peer('https://b.example');
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});await addMember(s,room,bob.who,bob.key);await s.svc.drain({limit:32});
 fail(bob.who);const createdAt=now;const posted=await ownerOp(s,room,'post',{text:'late'});
 for(let i=0;i<10;i++){await s.svc.drain({limit:32});advance(3600001);}
 assert.equal((await rows(s,'conversation/dead/')).length,1);
 now=createdAt+RECEIPT_RETENTION_MS-30*60000;
 const receipt=await s.svc.retry(s.self,room.id,posted.eventId);
 const p=receipt.peers.find(x=>x.peer===memberId(bob.who));
 assert.deepEqual([p.state,p.code],['expired','conversation_delivery_expired'],'a retry the receiver would refuse is reported expired');
 assert.equal((await rows(s,'conversation/outbox/')).length,0);
});

test('follow-up 6/7: withdrawing invite rights stales the issuer\'s pending invitations; legacy rows stay current',async()=>{
 const s=await source(),bob=await peer('https://b.example'),alt=await peer('https://x.example'),dan=await peer('https://d.example');
 const room=await s.svc.create({title:'R',collection:crypto.randomUUID()});await addMember(s,room,bob.who,bob.key);
 await memberOp(s,room,bob.who,bob.key,'invite',inviteInput(alt.who));const altInvite=await pendingFor(s,room,alt.who);
 await ownerOp(s,room,'invite',inviteInput(dan.who));
 await ownerOp(s,room,'permissions',{confirmed:true,target:bob.who,permissions:{invite:false}});
 assert.equal((await pendingFor(s,room,alt.who)).stale,true);
 assert.ok(!(await rows(s,'conversation/outbox/')).some(([,t])=>t.kind==='invite'&&memberId(t.target)===memberId(alt.who)),'its queued invite is cancelled');
 const view=await s.svc.adminView(await s.svc.record(s.self,room.id));
 assert.equal(view.pending.find(p=>memberId(p.target)===memberId(alt.who)).current,false);
 await assert.rejects(async()=>s.svc.join(await acceptance(s,room,altInvite,alt.who,alt.key),{...alt.who,key:alt.key.publicJwk}),{code:'conversation_invitation_stale'});
 // A legacy pending row (no issuer, no epoch) is treated as current.
 const [k,row]=(await rows(s,`conversation/pending/${room.id}/`)).find(([,v])=>memberId(v.target)===memberId(dan.who));delete row.issuer;delete row.epoch;await s.metadata.put(k,row);
 const joined=await s.svc.join(await acceptance(s,room,row,dan.who,dan.key),{...dan.who,key:dan.key.publicJwk});
 assert.ok(joined.members.some(m=>memberId(m)===memberId(dan.who)));
});
