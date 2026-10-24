// Red-team round 3 D1/D2: TURN credentials issued for a beam outlive the beam.
// docs/architecture/beaming.md:33 — "Cancellation should revoke issued credentials and stop renewal".
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';

const origin='http://localhost:8797',password='Beam integration password enough entropy!';
const files=[{id:'one',name:'one.txt',size:12,type:'text/plain'},{id:'two',name:'two.txt',size:24,type:'text/plain'}];
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'rt3-beam-turn-')),config={APP_ORIGIN:origin,BEAM_ENABLED:'true',BEAM_STUN_ENABLED:'false',BEAM_MONTHLY_DELIVERY_BYTES:'1000000000',BEAM_MONTHLY_OFFERS:'20'};let signups=0;const app=await createNodeServer({directory,config});
 const request=async(path,{method='GET',input,headers={}}={})=>{const response=await app.fetch(new Request(new URL(path,origin),{method,headers:{Origin:origin,...path==='/api/auth/signup'?{'CF-Connecting-IP':`127.0.0.${++signups}`}:{},...headers,...input!==undefined?{'Content-Type':'application/json'}:{}},...input===undefined?{}:{body:JSON.stringify(input)}}));return {status:response.status,value:await response.json(),response};};
 const post=(path,input)=>request(path,{method:'POST',input});
 const signup=async()=>{const pending=await post('/api/auth/signup',{password,method:'password',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'});assert.equal(pending.status,200,JSON.stringify(pending.value));const recovery=await post('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken});const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:recovery.value.recoveryToken,downloadConfirmed:true});assert.equal(activated.status,200);return {...activated.value,headers:{Cookie:activated.response.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':activated.value.csrfToken}};};
 const sender=await signup(),recipient=await signup();
 await app.resources.accounts.get(sender.account.id).metadata.put('billing/state',{owner:sender.account.id,source:'polar',plan:'plus',validUntil:Date.now()+3600000});
 const device=async s=>(await request('/api/session',{headers:s.headers})).value.devices.find(d=>d.current).id;
 const controller=app.resources.accounts.get(sender.account.id),actor={account:sender.account.id,device:await device(sender)},recipientDevice=await device(recipient),recipientActor={account:recipient.account.id,device:recipientDevice};
 const record=await controller.beams.create(sender.account.id,actor,{recipient:recipient.account.id,devices:[recipientDevice],deviceId:recipientDevice,files});
 await controller.beams.action(record.id,recipientActor,'accept',{fileIds:['one']});
 Object.assign(controller.config,{BEAM_TURN_ENABLED:'true',CLOUDFLARE_TURN_KEY_ID:'mock-key',CLOUDFLARE_TURN_API_TOKEN:'mock-token'});
 controller.config.BEAM_RELAY_BUDGET={reserve:async()=>({enforced:true}),commit:async()=>{},release:async()=>{}};
 return {controller,actor,recipientActor,record,sender,close:async()=>{await app.close();await rm(directory,{force:true,recursive:true});}};
}
let counter=0;
function mockTurn(){const revoked=[],issued=[];const fetch=async url=>{url=String(url);if(url.includes('/revoke')){revoked.push(decodeURIComponent(url.split('/credentials/')[1].split('/')[0]));return new Response(null,{status:204});}const username='user-'+(++counter);issued.push(username);return new Response(JSON.stringify({iceServers:[{urls:['turn:turn.cloudflare.com:3478?transport=udp'],username,credential:'c'}]}),{status:201});};return {fetch,revoked,issued};}

for(const [label,end] of [
 ['sender cancels',f=>f.controller.beamAction(f.sender.account.id,f.record.id,f.actor,'reject',{})],
 ['recipient rejects',f=>f.controller.beamAction(f.sender.account.id,f.record.id,f.recipientActor,'reject',{})],
 ['recipient marks complete',f=>f.controller.beamAction(f.sender.account.id,f.record.id,f.recipientActor,'signal',{seq:1,type:'complete',data:{}})],
]){
 test(`TURN credentials issued for a beam are revoked when the ${label}`,async()=>{
  const f=await fixture(),original=globalThis.fetch,turn=mockTurn();globalThis.fetch=turn.fetch;
  try{
   const senderIce=await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor);
   const recipientIce=await f.controller.beamIce(f.sender.account.id,f.record.id,f.recipientActor);
   assert.equal(senderIce.relayEnabled,true);assert.equal(recipientIce.relayEnabled,true);
   assert.equal(turn.issued.length,2);
   await end(f);
   assert.notEqual((await f.controller.beams.raw(f.record.id)).state,'accepted');
   assert.deepEqual(turn.revoked.sort(),[...turn.issued].sort(),'both participants\' relay usernames must be revoked once the beam ends; they otherwise stay usable for up to 300 s of unbudgeted relay');
  }finally{globalThis.fetch=original;await f.close();}
 });
}

test('relay credentials cannot be renewed during an accepted beam although they expire long before it',async()=>{
 const f=await fixture(),original=globalThis.fetch,turn=mockTurn();globalThis.fetch=turn.fetch;
 try{
  const first=await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor),raw=await f.controller.beams.raw(f.record.id);
  const remainingSeconds=Math.floor((raw.expiresAt-Date.now())/1000);
  assert.ok(remainingSeconds>first.expiresIn,`beam lives ${remainingSeconds}s, credential ${first.expiresIn}s`);
  // Simulate the credential lifetime passing (iceIssued is a boolean; time is not consulted for re-issuance).
  const realNow=Date.now;Date.now=()=>realNow()+(first.expiresIn+1)*1000;
  try{
   const second=await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor).catch(error=>error);
   assert.ok(!(second instanceof Error),`after the ${first.expiresIn}s credential expired the still-accepted beam cannot get relay again: ${second?.code}`);
  }finally{Date.now=realNow;}
 }finally{globalThis.fetch=original;await f.close();}
});

test('a re-issue after expiry revokes the expired username, takes a new reservation, and is bounded',async()=>{
 const f=await fixture(),original=globalThis.fetch,turn=mockTurn(),reservations=[];globalThis.fetch=turn.fetch;
 f.controller.config.BEAM_RELAY_BUDGET={reserve:async input=>{reservations.push(input);return {enforced:true};},commit:async()=>{},release:async()=>{}};
 const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
 try{
  const first=await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor);
  await assert.rejects(f.controller.beamIce(f.sender.account.id,f.record.id,f.actor),{code:'beam_turn_already_issued'});
  offset=(first.expiresIn+1)*1000;
  const second=await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor);
  assert.equal(reservations.length,2);assert.deepEqual(turn.revoked,[turn.issued[0]],'the expired username is revoked on re-issue');
  const raw=await f.controller.beams.raw(f.record.id);
  assert.ok(second.expiresIn*1000<=raw.expiresAt-Date.now()+1000,'a credential never outlives the beam');
  assert.deepEqual(raw.iceIssued.sender.usernames.map(u=>u.username),[turn.issued[1]],'the expired username is dropped once revoked or dead');
  // Usernames never reach a participant view.
  const view=await f.controller.beamAction(f.sender.account.id,f.record.id,f.actor,'get',{});
  assert.ok(!JSON.stringify(view).includes(turn.issued[1]));assert.equal(view.iceIssued,undefined);
  // Bounded: at most four issues per participant per beam (the beam's remaining life ends first in practice).
  for(let i=0;i<2;i++){offset+=(second.expiresIn+1)*1000;if(Date.now()>=raw.expiresAt)break;await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor).catch(()=>{});}
  assert.ok(turn.issued.length<=4);
 }finally{Date.now=realNow;globalThis.fetch=original;await f.close();}
});

test('a failed revocation at a terminal transition is retried by the alarm sweep',async()=>{
 const f=await fixture(),original=globalThis.fetch,turn=mockTurn();let failing=true;
 globalThis.fetch=async(url,init)=>{if(String(url).includes('/revoke')&&failing)return new Response(null,{status:503});return turn.fetch(url,init);};
 try{
  await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor);
  await f.controller.beamAction(f.sender.account.id,f.record.id,f.actor,'reject',{});
  assert.equal(turn.revoked.length,0);
  assert.equal((await f.controller.beams.raw(f.record.id)).iceIssued.sender.usernames.length,1,'an unrevoked username is kept for the sweep');
  failing=false;await f.controller.beamTurnSweep();
  assert.deepEqual(turn.revoked,turn.issued);
  assert.equal((await f.controller.beams.raw(f.record.id)).iceIssued.sender.usernames.length,0);
 }finally{globalThis.fetch=original;await f.close();}
});

test('a crash mid-issuance leaves only a lease, never a permanent issuing marker',async()=>{
 const f=await fixture(),original=globalThis.fetch,turn=mockTurn();globalThis.fetch=turn.fetch;
 const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
 try{
  await f.controller.metadata.transaction(async tx=>{const r=await tx.get('beam/offer/'+f.record.id);r.iceIssued.sender={state:'issuing',at:Date.now(),count:1,usernames:[]};await tx.put('beam/offer/'+f.record.id,r);});
  await assert.rejects(f.controller.beamIce(f.sender.account.id,f.record.id,f.actor),{code:'beam_turn_already_issued'});
  offset=61000;
  assert.equal((await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor)).relayEnabled,true);
  // The pre-round-3 bare marker is also not a permanent wedge.
  await f.controller.metadata.transaction(async tx=>{const r=await tx.get('beam/offer/'+f.record.id);r.iceIssued.recipient='issuing';await tx.put('beam/offer/'+f.record.id,r);});
  assert.equal((await f.controller.beamIce(f.sender.account.id,f.record.id,f.recipientActor)).relayEnabled,true);
 }finally{Date.now=realNow;globalThis.fetch=original;await f.close();}
});

test('the reservation is kept when revoking credentials that could not be recorded fails',async()=>{
 const f=await fixture(),original=globalThis.fetch,events=[];
 f.controller.config.BEAM_RELAY_BUDGET={reserve:async()=>{events.push('reserve');return {enforced:true};},commit:async()=>{events.push('commit');throw new Error('commit failed');},release:async()=>{events.push('release');}};
 globalThis.fetch=async url=>String(url).includes('/revoke')?new Response(null,{status:503}):new Response(JSON.stringify({iceServers:[{urls:['turn:turn.cloudflare.com:3478?transport=udp'],username:'stuck',credential:'c'}]}),{status:201});
 try{
  await assert.rejects(f.controller.beamIce(f.sender.account.id,f.record.id,f.actor));
  assert.deepEqual(events,['reserve','commit'],'a reservation backing still-usable credentials must not be released');
  assert.deepEqual((await f.controller.beams.raw(f.record.id)).iceIssued.sender.usernames.map(u=>u.username),['stuck']);
 }finally{globalThis.fetch=original;await f.close();}
});

test('one sender cannot fill a recipient beam mailbox',async()=>{
 const {BeamService,BEAM_LIMITS}=await import('../packages/beaming/index.mjs');
 const rows=new Map(),tx={get:async k=>structuredClone(rows.get(k)),put:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async({prefix,limit})=>new Map([...rows].filter(([k])=>k.startsWith(prefix)).slice(0,limit))};
 const service=new BeamService({metadata:{...tx,transaction:fn=>fn(tx)},config:{},entitlement:async()=>({plan:'plus'})}),owner=crypto.randomUUID(),loud=crypto.randomUUID();
 const offer=sender=>({id:crypto.randomUUID(),sender,allowedDevices:['d'],createdAt:Date.now()});
 let accepted=0;for(let i=0;i<BEAM_LIMITS.maxPending;i++){try{await service.notify(owner,offer(loud));accepted++;}catch(error){assert.equal(error.code,'beam_mailbox_full');}}
 assert.ok(accepted<BEAM_LIMITS.maxPending,'one sender took every mailbox slot');assert.equal(accepted,BEAM_LIMITS.maxPendingPerSender);
 assert.deepEqual(await service.notify(owner,offer(crypto.randomUUID())),{queued:true});
});

test('review follow-up: the total relay reservation of one beam is capped across participants and re-issues',async()=>{
 const f=await fixture(),original=globalThis.fetch,turn=mockTurn(),reservations=[];globalThis.fetch=turn.fetch;
 f.controller.config.BEAM_RELAY_BUDGET={reserve:async input=>{reservations.push(input.maxBytes);return {enforced:true};},commit:async()=>{},release:async()=>{}};
 const {BEAM_RELAY_RESERVATION_FACTOR}=await import('../packages/runtime/account/beams.mjs');
 const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
 try{
  for(let round=0;round<4;round++){
   for(const actor of [f.actor,f.recipientActor])await f.controller.beamIce(f.sender.account.id,f.record.id,actor).catch(error=>{assert.ok(['beam_turn_limit','beam_expired'].includes(error.code),error.code);});
   offset+=301000;
  }
  const envelope=reservations[0];
  assert.ok(reservations.reduce((n,b)=>n+b,0)<=envelope*BEAM_RELAY_RESERVATION_FACTOR,`${reservations.length} reservations of ${envelope} bytes for one beam`);
 }finally{Date.now=realNow;globalThis.fetch=original;await f.close();}
});

test('review follow-up: the success write requires the issuing lease, and the TTL is computed after the reservation',async()=>{
 const f=await fixture(),original=globalThis.fetch,turn=mockTurn();globalThis.fetch=turn.fetch;
 const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
 try{
  // A slow reservation: by the time it returns, the lease has lapsed and another call took it over.
  f.controller.config.BEAM_RELAY_BUDGET={reserve:async()=>{offset+=61000;await f.controller.metadata.transaction(async tx=>{const r=await tx.get('beam/offer/'+f.record.id);r.iceIssued.sender={...r.iceIssued.sender,at:Date.now()};await tx.put('beam/offer/'+f.record.id,r);});return {enforced:true};},commit:async()=>{},release:async()=>{}};
  await assert.rejects(f.controller.beamIce(f.sender.account.id,f.record.id,f.actor),{code:'beam_turn_lease_lost'});
  assert.deepEqual(turn.revoked,turn.issued,'credentials from a superseded issuance are revoked');
  assert.equal((await f.controller.beams.raw(f.record.id)).iceIssued.sender.state,'issuing','the new lease holder keeps its marker');
  // TTL after reserve: a reservation that consumes most of the beam's remaining life shortens the credential.
  offset=0;const raw=await f.controller.beams.raw(f.record.id);
  f.controller.config.BEAM_RELAY_BUDGET={reserve:async()=>{offset=raw.expiresAt-realNow()-100000;return {enforced:true};},commit:async()=>{},release:async()=>{}};
  const issued=await f.controller.beamIce(f.sender.account.id,f.record.id,f.recipientActor);
  assert.ok(issued.expiresIn<=100,`credential TTL ${issued.expiresIn}s exceeds the beam's remaining ~100s`);
 }finally{Date.now=realNow;globalThis.fetch=original;await f.close();}
});
