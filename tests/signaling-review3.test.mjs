// Signaling rev 3.2 engine: fixes for the independent review of 2026-10-28 (H-1, M-2, M-3, M-4, L-1, L-2, L-3).
// Engine level over tests/helpers/signaling-fixture.mjs (loopback host, dispatched ngin operations), with the
// app-connection port wired (`connections: true`) where liveness matters. Each test fails on the code before the fix.
// Local behaviour only; provisional and unsigned. Hosts are reserved .example names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalingHost,standardKinds,fault,rejects,APP,OTHER_APP,CALLBACK,PEER,REMOTE,CHAT,SYNC,subOf} from './helpers/signaling-fixture.mjs';
import {capacityAllows,capacityCounts,K} from '../packages/signaling/admission.mjs';
import {BOUNDS} from '../packages/signaling/sessions.mjs';
import {memoryKey} from '../packages/intents/sessions.mjs';

const LINES=[SYNC,CHAT,CALLBACK,REMOTE,PEER];
async function setup(options={}){const h=await signalingHost(options);await standardKinds(h);for(let n=1;n<=h.accounts.size;n++)for(const line of LINES)for(const c of [APP,OTHER_APP])await h.approve(n,c,line);return h;}
const approvalsOf=async(h,n,clientId=APP)=>(await h.run(n,'intents.session-approvals')).approvals.filter(a=>a.handler===clientId);
const pending=async(h,n,sid)=>(await h.rows(n,'sig/in/')).filter(([k,r])=>k.endsWith('/'+sid)&&r.state==='pending');
/** Entity 2's APP holds an endpoint, an open offer and a live cross-entity pairing with entity 1 (both sides paired). */
async function world(){
 const h=await setup({connections:true});
 const a=h.device(1,{kinds:[CALLBACK,PEER]}),b=h.device(2,{kinds:[CALLBACK,PEER]});await a.register();await b.register();
 const token=(await b.offer(CALLBACK,{uses:5,expires_in:900})).offers[0].offer;
 for(const [n,m] of [[1,2],[2,1]])await h.run(n,'signaling.pairing-create',{actor:h.owner(n,{freshAuth:true}),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(m)},opens:'both',label:'Peer',activate:true}});
 const dial=async()=>{const s1=await a.open(h.principal(2),CALLBACK,{basis:{offer:token}});await a.invite(s1);const s2=await a.open(h.principal(2),PEER,{basis:{relation:'pairing'}});await a.invite(s2);await h.pump();return [s1,s2];};
 return {h,a,b,token,dial};
}

test('H-1 baseline: with the connection live, the offer and the pairing admit and route to the app',async()=>{
 const {h,b,dial}=await world();const [s1,s2]=await dial();await b.listen();
 assert.deepEqual(b.invites().map(e=>e.sid).sort(),[s1.sid,s2.sid].sort());
});

test('H-1: a dead connection admits, routes and authorizes nothing before any cleanup runs, and nothing revives on reconnect',async()=>{
 const {h,a,b,dial}=await world();
 h.disconnect(2);// the connection ends; no lifecycle hook runs (INTEGRATIONS off, or the hook failed)
 let [s1,s2]=await dial();
 assert.equal((await pending(h,2,s1.sid)).length+(await pending(h,2,s2.sid)).length,0,'neither the offer nor the pairing admits an invite');
 assert.equal((await h.run(2,'signaling.offers')).offers[0].reserved,0,'no offer use is reserved for a dead app');
 await rejects(b.listen(),'not_found','the endpoint secret of a dead connection authorizes nothing');
 // The owner reconnects the app (a new connection generation); still no cleanup has run.
 h.reconnect(2);
 await rejects(b.listen(),'not_found','an old endpoint secret never revives after a reconnect (§14.2 step 5)');
 await rejects(h.device(2,{kinds:[CALLBACK]}).register(),'approval_required','the earlier approval is inert (§20.1.4 clearing)');
 [s1,s2]=await dial();
 assert.equal((await pending(h,2,s1.sid)).length+(await pending(h,2,s2.sid)).length,0,'old offers and pairings stay dead (§14.2 steps 6 and 7)');
 // The tick's sweep clears what belonged to the ended connection, durably (the connection record is the marker).
 await h.tick(2);
 assert.deepEqual(await approvalsOf(h,2),[],'approvals cleared');
 assert.equal((await approvalsOf(h,2,OTHER_APP)).length,LINES.length,'another app is untouched');
 assert.deepEqual((await h.run(2,'signaling.offers')).offers,[],'offers revoked');
 assert.deepEqual((await h.run(2,'signaling.pairings')).pairings,[],'pairings deleted');
 assert.deepEqual((await h.run(2,'signaling.endpoint-list')).endpoints.filter(e=>e.clientId===APP),[],'endpoints removed');
 // Restoring the approval restores no pairing (§5.8 P3) and no offer.
 await h.approve(2,APP,PEER);await h.approve(2,APP,CALLBACK);
 assert.deepEqual((await h.run(2,'signaling.pairings')).pairings,[]);assert.deepEqual((await h.run(2,'signaling.offers')).offers,[]);
 void a;
});

test('H-1: re-approving after a reconnect clears the earlier connection\'s state first, even if no tick ran',async()=>{
 const {h,b,dial}=await world();
 h.disconnect(2);h.reconnect(2);
 await h.approve(2,APP,CALLBACK);
 assert.deepEqual((await h.run(2,'signaling.pairings')).pairings,[],'the pairing is deleted, never restored');
 assert.deepEqual((await h.run(2,'signaling.offers')).offers,[],'the offer is revoked');
 assert.deepEqual((await approvalsOf(h,2)).map(a=>a.kind),[CALLBACK],'only the new approval stands');
 await rejects(b.listen(),'not_found');
 const fresh=h.device(2,{kinds:[CALLBACK]});await fresh.register();
 const [s1]=await dial();assert.equal((await pending(h,2,s1.sid)).length,0,'the revoked offer admits nothing');
});

test('H-1: a paused connection (new generation) makes everything inert at once; the sweep then clears it',async()=>{
 const {h,b,dial}=await world();h.pause(2);
 const [s1,s2]=await dial();assert.equal((await pending(h,2,s1.sid)).length+(await pending(h,2,s2.sid)).length,0);
 await rejects(b.listen(),'not_found');
 await h.tick(2);assert.deepEqual(await approvalsOf(h,2),[]);assert.deepEqual((await h.run(2,'signaling.pairings')).pairings,[]);
});

test('H-1: an approval without a recorded connection generation (imported) is inert, and the sweep leaves it alone',async()=>{
 const h=await setup({connections:true});
 await h.account(2).store.delete(await h.account(2).service.appKey(APP));
 await rejects(h.device(2,{kinds:[CALLBACK]}).register(),'approval_required');
 await h.tick(2);assert.equal((await approvalsOf(h,2)).length,LINES.length,'never swept: no ended connection is known');
 await h.approve(2,APP,CALLBACK);const d=h.device(2,{kinds:[CALLBACK]});await d.register();
});

test('M-2: offer scans are never truncated: caps, owner list, revoke-all, unapprove and the sweep see every row',async()=>{
 const h=await setup(),store=h.account(2).store,now=h.clock.now();
 // 300 rows that sort before any real digest: expired, not yet swept (more than the former 256-row scan).
 for(let i=0;i<300;i++){const digest='-'.repeat(8)+String(i).padStart(35,'0');await store.put(K.offer(digest),{v:1,digest,principal:null,kind:h.ref(CALLBACK),profile:'webrtc',endpoint:'ep_x',clientId:APP,feature:null,service:false,uses:1,spent:0,reserved:0,expiresAt:now-1,createdAt:now-1000,admitted:[]});}
 const b=h.device(2,{kinds:[CALLBACK]});await b.register();
 for(let i=0;i<BOUNDS.offersPerApp;i++)await b.offer(CALLBACK,{uses:1});
 await rejects(b.offer(CALLBACK,{uses:1}),'rate_limited','the per-app live cap counts every live offer');
 assert.equal((await h.run(2,'signaling.offers')).offers.length,BOUNDS.offersPerApp,'the owner list shows every live offer');
 // Revoke one: the record goes at once (no retained hash).
 const [first]=[...b.offers.values()];await b.revokeOffer([first.offer]);
 assert.equal((await h.run(2,'signaling.offers')).offers.length,BOUNDS.offersPerApp-1);
 assert.equal((await h.rows(2,'sig/offer/')).filter(([,o])=>o.endpoint===b.endpoint).length,BOUNDS.offersPerApp-1,'a revoked offer leaves no row');
 // Removing the approval revokes every live offer of that app and kind (§14.2 step 6).
 await h.unapprove(2,APP,CALLBACK);
 assert.deepEqual((await h.run(2,'signaling.offers')).offers,[]);
 await h.tick(2);assert.equal((await h.rows(2,'sig/offer/')).length,0,'the tick sweeps every expired row');
});

test('M-2: owner revoke-all reaches offers past the first 256 rows',async()=>{
 const h=await setup(),store=h.account(2).store,now=h.clock.now();
 for(let i=0;i<300;i++){const digest='-'.repeat(8)+String(i).padStart(35,'0');await store.put(K.offer(digest),{v:1,digest,principal:null,kind:h.ref(CALLBACK),profile:'webrtc',endpoint:'ep_x',clientId:APP,feature:null,service:false,uses:1,spent:0,reserved:0,expiresAt:now-1,createdAt:now-1000,admitted:[]});}
 const b=h.device(2,{kinds:[CALLBACK]});await b.register();await b.offer(CALLBACK,{uses:2});
 assert.equal((await h.run(2,'signaling.revoke-offers',{input:{all:true}})).revoked,1);
 assert.deepEqual((await h.run(2,'signaling.offers')).offers,[]);
});

test('M-3: the pairing sub-budget is half of BASE pending capacity, like the open-offer sub-budget (§13.1)',()=>{
 const P=BOUNDS.recipientPending,half=Math.floor(P*BOUNDS.subBudgetShare);
 const rows=(cls,n)=>Array.from({length:n},()=>({state:'pending',cls}));
 assert.equal(capacityAllows(capacityCounts(rows('relation',half-1)),'relation'),'base');
 assert.equal(capacityAllows(capacityCounts(rows('relation',half)),'relation'),false,'pairings stop at half of P');
 assert.equal(capacityAllows(capacityCounts([...rows('relation',1),...rows('ownPairing',half-1)]),'ownPairing'),false,'own-entity and relation pairings share it');
 assert.equal(capacityAllows(capacityCounts(rows('open',half)),'open'),false,'the open-offer sub-budget is the same share');
 // The rest of base capacity stays for bound offers and own devices.
 assert.equal(capacityAllows(capacityCounts(rows('relation',half)),'bound'),'base');
 assert.equal(capacityAllows(capacityCounts(rows('relation',half)),'self'),'base');
});

test('M-3 engine: one paired peer cannot fill base pending capacity; a bound offer still gets in',async()=>{
 const h=await setup();
 const b1=h.device(2,{kinds:[PEER,CALLBACK]}),b2=h.device(2,{kinds:[PEER,CALLBACK]});await b1.register();await b2.register();
 for(const [n,m] of [[1,2],[2,1]])await h.run(n,'signaling.pairing-create',{actor:h.owner(n,{freshAuth:true}),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(m)},opens:'both',label:'Peer',activate:true}});
 const a=h.device(1,{kinds:[PEER,CALLBACK]});await a.register();
 const sids=[];for(let i=0;i<4;i++){const s=await a.open(h.principal(2),PEER,{basis:{relation:'pairing'}});await a.invite(s);sids.push(s.sid);}await h.pump();
 let live=0;for(const sid of sids)live+=(await pending(h,2,sid)).length;
 assert.equal(live,Math.floor(BOUNDS.recipientPending*BOUNDS.subBudgetShare),'relation invites stop at the pairing sub-budget');
 const c=h.device(3,{kinds:[CALLBACK]});await c.register();const t=(await b1.offer(CALLBACK,{principals:[h.principal(3)]})).offers[0].offer;
 const s=await c.open(h.principal(2),CALLBACK,{basis:{offer:t}});await c.invite(s);await h.pump();
 assert.equal((await pending(h,2,s.sid)).length,1,'base capacity is left for a bound offer');
});

test('M-4: an endpoint registered in member context is never service-class, even for a designated organization',async()=>{
 const h=await setup({organizations:[2]});
 await h.run(2,'signaling.set-service',{input:{designated:true,revision:0}});
 const member=h.device(2,{kinds:[CALLBACK],memberContext:true}),service=h.device(2,{kinds:[CALLBACK]});await member.register();await service.register();
 await rejects(member.offer(CALLBACK,{uses:2,expires_in:3600}),'invalid_args','person-app rules: at most 900 s');
 assert.ok((await service.offer(CALLBACK,{uses:2,expires_in:3600})).offers.length,'a non-member endpoint of the designated entity is service-class');
 assert.throws(()=>h.account(2).service.app({...member.actor,memberContext:'yes'}),e=>e.code==='unauthorized','the marker is a boolean only');
});

test('L-1: a claim after an offer\'s expires_at fails and ends the session, before any tick',async()=>{
 const h=await setup();const a=h.device(1,{kinds:[CALLBACK]}),b=h.device(2,{kinds:[CALLBACK]});await a.register();await b.register();
 const t=(await b.offer(CALLBACK,{uses:3,expires_in:30})).offers[0].offer;
 const s=await a.open(h.principal(2),CALLBACK,{basis:{offer:t}});await a.invite(s);await h.pump();await b.listen();assert.equal(b.invites().length,1);
 h.clock.advance(31000);
 await rejects(b.claim(s.sid),'claimed','an offer record ends at expires_at (§5.7)');
 assert.equal((await pending(h,2,s.sid)).length,0,'the pending session it admitted ended with it');
 assert.deepEqual((await h.run(2,'signaling.offers')).offers,[]);
});

test('L-1: a pending pairing older than 7 days cannot be activated, and an expired pairing cannot be renewed, before tick',async()=>{
 const h=await setup();
 const pend=await h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:APP,client_session:null},peer:{self:{client_id:OTHER_APP,client_session:null}},opens:'both',label:'Own'}});
 const cross=await h.run(1,'signaling.pairing-create',{actor:h.owner(1,{freshAuth:true}),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(2)},opens:'both',label:'X',activate:true,expiresAt:h.clock.now()+8*86400000}});
 h.clock.advance(BOUNDS.pairingPendingMs+1000);
 await rejects(h.run(1,'signaling.pairing-activate',{input:{id:pend.id,revision:pend.revision}}),'not_found','pending for more than 7 days');
 h.clock.advance(86400000);
 await rejects(h.run(1,'signaling.pairing-update',{input:{id:cross.id,revision:cross.revision,expiresAt:h.clock.now()+86400000}}),'not_found','an expired pairing is never renewed');
});

test('L-2: an own-entity pairing never names the same app on both sides',async()=>{
 const h=await setup();
 await rejects(h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:APP,client_session:null},peer:{self:{client_id:APP,client_session:'cs-1'}},opens:'both',label:'Same',activate:true}}),'invalid_args');
});

test('L-3: an excluded handler cannot be approved, and its earlier approval admits nothing while excluded (§20.1.4, §7.4)',async()=>{
 const h=await setup(),owner=subOf(1),store=h.account(1).store,key=memoryKey(owner,CALLBACK);
 const memory=await store.get(key);await store.put(key,{...memory,excluded:[{site:'app.example',at:h.clock.now()}]});
 await rejects(h.approve(1,APP,CALLBACK),'handler_excluded');
 await rejects(h.device(1,{kinds:[CALLBACK]}).register(),'approval_required','the standing approval is inert');
 const other=h.device(1,{clientId:OTHER_APP,kinds:[CALLBACK]});await other.register();
});

import {FederationService} from '../packages/federation/service.mjs';
test('H-1: a failed grant-changed hook is retried durably (grant-sync row drained by the cleanup alarm), never swallowed',async()=>{
 const rows=new Map(),store={transaction:async fn=>fn({get:async k=>rows.get(k),set:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([key,value])=>({key,value}))})};
 const subject='https://3sln.example/entities/x',clientId='https://app.example/client',calls=[];let failing=true;
 rows.set('federation/grant/g1',{id:'g1',subject,clientId,fragment:'https://3sln.me/fragments/signaling/v1',active:false});
 const self=Object.assign(Object.create(FederationService.prototype),{store,crypto:globalThis.crypto,clock:()=>1000,grantChanged:async x=>{calls.push(x);if(failing)throw new Error('account unavailable');}});
 assert.equal(await self.grantSync(subject,clientId),false);
 assert.equal([...rows.keys()].filter(k=>k.startsWith('federation/grant-sync/')).length,1,'a durable retry row');
 assert.deepEqual(await self.drainGrantSync(),{pending:true},'still failing: the alarm comes back');
 failing=false;assert.deepEqual(await self.drainGrantSync(),{pending:false});
 assert.equal([...rows.keys()].filter(k=>k.startsWith('federation/grant-sync/')).length,0,'drained once the hook succeeded');
 assert.equal(calls.length,3);assert.equal(calls.at(-1).active,false);
});

// Review L-4 (not wired yet, Appendix C.5 step 7): placeholder for the runtime path that must call
// signalingClientSessionRevoked when a device-authorization client session is revoked or ends.
test.todo('L-4: revoking a device-authorization client session runs signaling client-session-revoked (§5.8, §14.2)');
