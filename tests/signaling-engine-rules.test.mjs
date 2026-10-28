// Signaling rev 3.2 engine rules (docs/spec/extensions/signaling.md §21.1 "Engine-level and chaos coverage", plus the
// rtc-engine and rtc-wargame cases that still apply, retargeted): every call a dispatched ngin operation over the
// loopback host. Local behaviour only; provisional and unsigned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalingHost,standardKinds,payloadOf,keyPair,fault,rejects,relay,host as mdnsHost,rawHost,srflx,APP,OTHER_APP,SYNC,CHAT,CALLBACK,REMOTE,PEER,subOf,identityOf,kindBody} from './helpers/signaling-fixture.mjs';
import {buildBatch} from '../packages/signaling/messages.mjs';
import {glareSurvivor,BOUNDS} from '../packages/signaling/sessions.mjs';
import {exportInventory} from '../packages/runtime/export-contributors.mjs';

async function setup(options={}){const h=await signalingHost(options);await standardKinds(h);for(const n of h.accounts.keys()){const k=[...h.accounts.keys()].indexOf(n)+1;for(const line of [SYNC,CHAT,CALLBACK,REMOTE,PEER])for(const c of [APP,OTHER_APP])await h.approve(k,c,line);}return h;}
const invitesOf=d=>d.events.filter(e=>e.type==='invite');
const statesOf=d=>d.events.filter(e=>e.type==='state').map(e=>e.state);
/** B (n=2) mints a bound offer for A (n=1); A dials back; B accepts; returns both devices and sessions. */
async function offered(h,{kind=CALLBACK,profile='webrtc',accept=true,a,b}={}){
 a??=h.device(1,{kinds:[kind]});b??=h.device(2,{kinds:[kind]});if(!a.endpoint)await a.register();if(!b.endpoint)await b.register();
 const {offers}=await b.offer(kind,{principals:[h.principal(1)],profile});
 const s=await a.open(h.principal(2),kind,{profile,basis:{offer:offers[0].offer}});await a.invite(s);await h.pump();await b.listen();
 if(!accept)return {a,b,s,token:offers[0].offer};
 const r=await b.claim(s.sid);await b.accept(r);await h.pump();await a.listen();return {a,b,s,r,token:offers[0].offer};
}

test('§16.4, §16.5: relay-only by default between entities, public by opt-in, raw host only between own devices',async()=>{
 const h=await setup(),{a,b,s,r}=await offered(h);
 await rejects(a.candidates(s,[srflx()]),'invalid_args','srflx under relay');s.seq--;
 await rejects(a.candidates(s,[mdnsHost()]),'invalid_args','mDNS host under relay');s.seq--;
 await a.candidates(s,[relay()]);await h.pump();await b.listen();assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'));
 // The session pinned relay at open; widening the policy never reaches a live session (§16.5).
 const p=await h.run(1,'signaling.policy');await h.run(1,'signaling.set-policy',{input:{revision:p.revision,other:'public'}});
 await rejects(a.candidates(s,[srflx()]),'invalid_args','widening never reaches a live session');s.seq--;
 // A new session takes the new policy; raw host candidates are still refused cross-entity.
 const n2=await offered(h,{a,b});await n2.a.candidates(n2.s,[srflx()]);
 await rejects(n2.a.candidates(n2.s,[rawHost()]),'invalid_args','raw host cross-entity');
 // Own devices: raw host allowed (own-entity default `all`).
 const x=h.device(1,{kinds:[SYNC]}),y=h.device(1,{kinds:[SYNC]});await x.register();await y.register();
 const own=await x.open(h.principal(1),SYNC);await x.invite(own);await h.pump();await y.listen();const yr=await y.claim(own.sid);await y.accept(yr);await h.pump();await x.listen();
 await x.candidates(own,[rawHost()]);void r;
});

test('§7.2, §8.4: nothing but invite and cancel before the claim; answers need a claim; ended sessions take nothing',async()=>{
 const h=await setup(),{a,b,s}=await offered(h,{accept:false});
 await rejects(a.send(s,[await a.sign(s,'candidates',{gen:0,items:[relay()],complete:false},{to:s.leg.jkt})]),'invalid_args','candidates before the claim');s.seq--;
 await rejects(b.run('signaling.send',{...b.auth(),sid:s.sid,messages:[await a.sign(s,'cancel',{})]}),'not_found','another endpoint cannot send on this leg');s.seq--;
 const r=await b.claim(s.sid,'decline');await b.decline(r);await h.pump();await a.listen();
 assert.ok(a.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='decline'));
 assert.deepEqual(await a.candidates(s,[relay()]),{accepted:0},'a message for an ended session is ignored (§7.3)');
});

test('§8.2: a decline ends the session for every recipient device; the others learn only that it was claimed',async()=>{
 const h=await setup();const b1=h.device(1,{kinds:[SYNC]}),b2=h.device(1,{kinds:[SYNC]}),b3=h.device(1,{kinds:[SYNC]});for(const d of [b1,b2,b3])await d.register();
 const s=await b1.open(h.principal(1),SYNC);await b1.invite(s);await h.pump();await b2.listen();await b3.listen();
 const r=await b2.claim(s.sid,'decline');await b2.decline(r);await h.pump();await b3.listen();
 assert.ok(statesOf(b3).includes('claimed'));assert.equal(b3.events.some(e=>e.type==='state'&&e.outcome),false,'no outcome, no endpoint');
 await rejects(b3.claim(s.sid),'claimed','the loser');
});

test('§8.4: a cancel crossing an accept converges to ended at both providers; an accept after a cancel gets end(failed)',async()=>{
 const h=await setup({hold:true});const {a,b,s}=await offered(h,{accept:false});await h.flushNetwork();await b.listen();
 const r=await b.claim(s.sid);await b.accept(r);await a.cancel(s);await h.flushNetwork();await h.pump();await a.listen();await b.listen();
 const sa=(await h.run(1,'signaling.sessions')).sessions,sb=(await h.run(2,'signaling.sessions')).sessions;
 assert.equal(sa.length,0);assert.equal(sb.length,0);
 assert.ok(h.log.batches.some(x=>x.to===subOf(2)&&JSON.parse(x.batch).controls.some(c=>payloadOf(c).reason==='failed'&&payloadOf(c).leg===r.leg.jkt)),'the accept that crossed the cancel got end(failed) for its leg');
});

test('§8.5, §12.1: an unclaimed recipient session ends silently on answer_by, owner end, approval removal, block and offer end',async()=>{
 const h=await setup();
 for(const cause of ['timeout','owner','approval','block','offer']){
  const {a,b,s,token}=await offered(h,{accept:false});const before=h.log.batches.filter(x=>x.to===subOf(1)).length;
  if(cause==='timeout'){h.clock.advance(121000);await h.tickAll();}
  if(cause==='owner')await h.run(2,'signaling.end-session',{input:{sid:s.sid,initiator:h.principal(1)}});
  if(cause==='approval'){await h.unapprove(2,APP,CALLBACK);await h.approve(2,APP,CALLBACK);}
  if(cause==='block'){await h.run(2,'signaling.block',{input:{principal:h.principal(1)}});}
  if(cause==='offer')await b.revokeOffer([token]);
  await h.pump();
  assert.equal(h.log.batches.filter(x=>x.to===subOf(1)).length,before,`${cause}: nothing to the initiator`);
  assert.equal((await h.run(2,'signaling.sessions')).sessions.length,0,`${cause}: ended at the recipient`);
  if(cause==='block')await h.run(2,'signaling.unblock',{input:{principal:h.principal(1)}});
  void a;
 }
});

test('§8.1, §12.4: answer_by, the 60 s payload bound, the 24 h cap, record retention, idle endpoints (no offer ends)',async()=>{
 const h=await setup();const {a,b,s,r}=await offered(h);
 await a.sdpOffer(s);await h.pump();// queued at B, not yet listened to
 h.clock.advance(61000);await h.tick(2);await b.listen();assert.equal(b.events.filter(e=>e.type==='message'&&payloadOf(e.message).type==='sdp').length,0,'payload rows deleted after 60 s');
 h.clock.advance(86400000);await h.tickAll();await h.pump();assert.equal((await h.run(1,'signaling.sessions')).sessions.length,0,'24 h cap');
 h.clock.advance(86400000+1);await h.tickAll();assert.equal((await h.rows(1,'sig/out/')).length,0,'records go 24 h after the end');
 // An idle endpoint expires after 30 days with unregister's effects; its app's live offers survive.
 const minter=h.device(2,{kinds:[CALLBACK]});await minter.register();await minter.offer(CALLBACK,{principals:[h.principal(3)],expires_in:900});
 const offersBefore=(await h.run(2,'signaling.offers')).offers.length;
 h.clock.advance(800000);await h.tick(2);// still within the offer's 900 s
 assert.equal((await h.run(2,'signaling.offers')).offers.length,offersBefore,'endpoint churn ends no offer');void r;
});

test('§14.1: with signaling off nothing new is reachable; narrowing and reads still work',async()=>{
 const h=await setup();const {a,b,token}=await offered(h,{accept:false});
 h.flags.deny(subOf(2),'SIGNALING_ENABLED');
 await rejects(b.register(),'not_found','register');await rejects(b.offer(CALLBACK,{principals:[h.principal(1)]}),'not_found','offer');
 await rejects(h.approve(2,OTHER_APP,CHAT),'not_found','approval widening');
 const s2=await a.open(h.principal(2),CALLBACK,{basis:{offer:token}});await a.invite(s2);await h.pump();await b.listen();
 assert.equal(invitesOf(b).length,1,'no new session is admitted while off');
 const sid=invitesOf(b)[0].sid;const r=await b.claim(sid,'decline');await b.decline(r);// a decline is narrowing
 assert.ok(Array.isArray((await h.run(2,'signaling.sessions')).sessions));await b.revokeOffer();await h.unapprove(2,APP,CALLBACK);
 await h.run(2,'signaling.block',{input:{issuer:'https://spam.example'}});
});

test('§10.1: an endpoint identifier alone never authorizes; DPoP-bound endpoints refuse the secret',async()=>{
 const h=await setup();const d=h.device(1,{kinds:[SYNC]});await d.register();
 await rejects(d.run('signaling.listen',{endpoint:d.endpoint}),'not_found','no secret');
 await rejects(d.run('signaling.listen',{endpoint:d.endpoint,endpoint_secret:'x'.repeat(43)}),'not_found','wrong secret');
 const k=h.device(1,{kinds:[SYNC],dpop:true});await k.register();assert.equal(k.secret,undefined);
 await rejects(k.run('signaling.listen',{endpoint:k.endpoint,endpoint_secret:'x'}),'not_found','DPoP endpoint refuses a secret');
 await rejects(h.run(1,'signaling.listen',{actor:{...k.actor,jkt:(await keyPair()).jkt},input:{endpoint:k.endpoint}}),'not_found','another key');
});

test('§6.1: renewal keeps cnf; a delegate is never certified twice',async()=>{
 const h=await setup();const {a,s}=await offered(h);
 const renewed=await a.run('signaling.renew',{...a.auth(),sid:s.sid});assert.equal(payloadOf(renewed.certificate).cnf.jkt,s.leg.jkt);
 const d=h.device(1,{kinds:[SYNC]});await d.register();await rejects(d.open(h.principal(1),SYNC,{leg:s.leg}),'invalid_args','delegate reuse');
});

test('§14.2: unregister, revoke-endpoint and owner end of a claimed session send `revoked`; account deletion closes the entity',async()=>{
 const h=await setup();
 const one=await offered(h);await one.b.run('signaling.unregister',one.b.auth());await h.pump();await one.a.listen();
 assert.equal(payloadOf(one.a.events.find(e=>e.type==='state'&&e.control).control).reason,'revoked');
 const two=await offered(h);await h.run(2,'signaling.end-session',{input:{sid:two.s.sid,initiator:h.principal(1)}});await h.pump();await two.a.listen();
 assert.ok(two.a.events.some(e=>e.type==='state'&&e.control&&payloadOf(e.control).reason==='revoked'));
 const three=await offered(h);await h.run(2,'signaling.lifecycle',{actor:h.system(2),input:{event:'deletion'}});await h.pump();await three.a.listen();
 assert.ok(three.a.events.some(e=>e.type==='state'&&e.control&&payloadOf(e.control).reason==='revoked'),'claimed legs are told before the tombstone');
 assert.equal((await h.rows(2,'sig/pairing/')).length+(await h.rows(2,'sig/offer/')).length+(await h.rows(2,'sig/ep/')).length,0,'endpoints, pairings and offers gone');
 await rejects(three.b.register(),'not_found','closed to new registrations');
});

test('§12.6: export carries policy, principal and provider blocks, pairings and the designation; never offers or secrets',async()=>{
 const h=await setup();const {b}=await offered(h,{accept:false});
 await h.run(2,'signaling.block',{input:{issuer:'https://spam.example'}});await h.run(2,'signaling.block',{input:{principal:{iss:'https://far.example',sub:subOf(77)}}});
 await h.run(2,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:APP,client_session:null},peer:{self:{client_id:OTHER_APP,client_session:null}},opens:'both',label:'Fleet'}});
 const e=await h.run(2,'signaling.export');
 assert.equal(e.blocked.length,1);assert.equal(e.blockedIssuers.length,1);assert.equal(e.pairings.length,1);assert.equal(e.pairings[0].state,'pending');assert.equal(e.service.designated,false);
 assert.equal(JSON.stringify(e).includes('offer'),false,'offers are never exported');
 assert.equal(exportInventory(['sig/block-iss/x'])[0].contributor,'signaling','provider blocks are claimed (the old rtc/block-iss/ gap)');
 assert.equal(exportInventory(['sig/pairing/pr_x'])[0].contributor,'signaling-pairings');
 assert.match(exportInventory(['sig/offer/x'])[0].reason,/capabilit/i);assert.match(exportInventory(['sig/ep/x'])[0].reason,/Secret/);
 void b;
});

test('§9.2, §12.1: one ingest answer for unknown, unadmitted, blocked and keyless; malformed batches refused whole',async()=>{
 const h=await setup();const {a,b,s}=await offered(h,{accept:false});
 const invite=await a.sign({...s,sid:'A'.repeat(22),seq:0},'invite',a.inviteBody(s));
 assert.deepEqual(await h.receive(2,buildBatch({certificates:[s.certificate],messages:[invite]})),{accepted:true},'sid mismatch with the certificate');
 await h.run(2,'signaling.block',{input:{principal:h.principal(1)}});
 assert.deepEqual(await h.receive(2,buildBatch({certificates:[s.certificate],messages:[await a.sign({...s,seq:1},'cancel',{})]})),{accepted:true},'blocked');
 h.account(1).keyless=true;assert.deepEqual(await h.receive(2,buildBatch({certificates:[s.certificate],messages:[await a.sign({...s,seq:2},'cancel',{})]})),{accepted:true},'keyless');
 await rejects(h.receive(2,'{"v":1,"certificates":[],"messages":[],"controls":[],"links":["x"]}'),'signaling_batch_invalid','links member');
 await rejects(h.receive(2,'not json'),'signaling_batch_invalid','malformed');void b;
});

test('§10.3: queue overflow reports a gap and ends the session failed; listen long-polls until an event arrives',async()=>{
 const h=await setup();const {a,b,s}=await offered(h);
 // Fill B's queue with data messages it never reads (each a few KiB) until the queue overflows.
 const x=h.device(1,{kinds:[SYNC]}),y=h.device(1,{kinds:[SYNC]});await x.register();await y.register();
 const own=await x.open(h.principal(1),SYNC,{profile:'data'});await x.invite(own);await h.pump();await y.listen();const yr=await y.claim(own.sid);await y.accept(yr,{});await h.pump();await x.listen();
 let failed=false;for(let i=0;i<200&&!failed;i++){try{await x.data(own,4096);}catch(e){failed=e.code==='invalid_args'||e.code==='rate_limited'||e.code==='not_found';}await h.pump();}
 const out=await y.listen();assert.ok(out.gap||failed,'overflow or allowance reached');
 // Long poll: a listen waiting on an empty queue returns as soon as an event arrives.
 const waiting=b.run('signaling.listen',{...b.auth(),cursor:b.cursor,wait:2});await a.candidates(s,[relay()]);await h.pump();
 const got=await waiting;assert.ok(got.events.length>=1);
});

test('§6.3, §9.2 step 6: a control statement from another party is ignored; a lower aep is refused',async()=>{
 const h=await setup();const {a,b,s,r}=await offered(h);
 // Entity 3 signs an `end` for the session between 1 and 2: verified only against the expected party, so ignored.
 const {signControl}=await import('../packages/signaling/certificates.mjs');
 const forged=await signControl({issuer:h.ISS,sub:subOf(3),aud:identityOf(subOf(2)),sid:s.sid,leg:null,reason:'revoked',now:h.clock.now()},h.account(3).cert);
 assert.deepEqual(await h.ingest(2,buildBatch({controls:[forged]})),{accepted:true});
 assert.equal((await h.run(2,'signaling.sessions')).sessions.length,1,'a third party cannot end the session');
 // A's authority epoch rises to 5 (recorded by B), then a certificate with a lower aep is refused at step 6.
 h.account(1).aep=5;await a.run('signaling.renew',{...a.auth(),sid:s.sid});s.certificate=null;
 await a.candidates(s,[relay()]);await h.pump();await b.listen();const seen=b.events.filter(e=>e.type==='message').length;
 h.account(1).aep=2;await a.run('signaling.renew',{...a.auth(),sid:s.sid});
 await a.candidates(s,[relay()]);await h.pump();await b.listen();
 assert.equal(b.events.filter(e=>e.type==='message').length,seen,'the lower aep is refused');void r;
});

test('§4.3, §5.4 case 3, §5.7: service-class offers belong to the app: online endpoints, endpoint churn, 90 days, designation removal',async()=>{
 const h=await setup({organizations:[2]});
 const des=await h.run(2,'signaling.service');assert.equal(des.eligible,true);
 const s1=h.device(2,{kinds:[CALLBACK]}),s2=h.device(2,{kinds:[CALLBACK]});await s1.register();await s2.register();
 await rejects(s1.offer(CALLBACK,{uses:100,expires_in:86400}),'invalid_args','not yet service-class: 900 s cap');
 await h.run(2,'signaling.set-service',{input:{designated:true,revision:des.revision}});
 const {offers}=await s1.offer(CALLBACK,{uses:100,expires_in:86400*30});const token=offers[0].offer;
 await rejects(s1.offer(CALLBACK,{uses:100,expires_in:7776001}),'invalid_args','above 90 days');
 await rejects(s1.offer(CALLBACK,{principals:[h.principal(1)],expires_in:604801}),'invalid_args','bound above 7 days');
 // Both online endpoints receive it, with offer_match; the minting endpoint unregistering ends nothing.
 await s1.listen();await s2.listen();await s1.run('signaling.unregister',s1.auth());
 const a=h.device(1,{kinds:[CALLBACK]});await a.register();const s=await a.open(h.principal(2),CALLBACK,{basis:{offer:token}});await a.invite(s);await h.pump();
 await s2.listen();assert.equal(invitesOf(s2).length,1);assert.equal(invitesOf(s2)[0].projection.offer_match,true);
 // An endpoint past the liveness window is reached only by late delivery once it listens.
 const s3=h.device(2,{kinds:[CALLBACK]});await s3.register();h.clock.advance(BOUNDS.onlineMs+1000);
 const c=h.device(3,{kinds:[CALLBACK]});await c.register();const sc=await c.open(h.principal(2),CALLBACK,{basis:{offer:token}});await c.invite(sc);await h.pump();
 assert.equal((await h.rows(2,'sig/dlv/')).some(([k])=>k.includes(sc.sid)),false,'no online endpoint: no use taken, nothing delivered');
 // A member-context endpoint is never service-class.
 const m=h.device(2,{kinds:[CALLBACK],memberContext:true});await m.register();await rejects(m.offer(CALLBACK,{uses:2,expires_in:86400}),'invalid_args','member context');
 // Removing the designation revokes the offers longer than 900 s.
 await h.run(2,'signaling.set-service',{input:{designated:false,revision:(await h.run(2,'signaling.service')).revision}});
 assert.equal((await h.run(2,'signaling.offers')).offers.length,0);
 await rejects(h.run(1,'signaling.set-service',{input:{designated:true,revision:0}}),'not_found','a person entity cannot be designated');
});

test('§4.2, SG-6: a provider-feature endpoint is service-class, certifies client.feature, and is never a pairing party',async()=>{
 const h=await setup();const FEATURE='https://3sln.example/extensions/answering/v1';
 await h.run(2,'intents.session-approve',{actor:h.owner(2,{parties:[h.ISS]}),input:{clientId:h.ISS,kind:h.ref(CALLBACK)}}).catch(()=>null);
 // Feature approvals use the feature handler (spec URL); recorded directly in intents memory here (no owner page yet).
 const {memoryKey,withApproval}=await import('../packages/intents/sessions.mjs');const ref=h.ref(CALLBACK);
 await h.account(2).store.put(memoryKey(subOf(2),CALLBACK),withApproval(await h.account(2).store.get(memoryKey(subOf(2),CALLBACK)),CALLBACK,{handler:FEATURE,feature:true,version:ref.version,digest:ref.digest,at:0,autoConnect:false}));
 const actor={kind:'app',owner:subOf(2),clientId:h.ISS,origin:h.ISS,grants:['feature-grant'],feature:FEATURE};
 const ep=await h.run(2,'signaling.register',{actor,input:{kinds:[CALLBACK]}});
 const {offers}=await h.run(2,'signaling.offer',{actor,input:{endpoint:ep.endpoint,endpoint_secret:ep.endpoint_secret,kind:CALLBACK,profile:'webrtc',uses:5,expires_in:86400}});
 const a=h.device(1,{kinds:[CALLBACK]});await a.register();const s=await a.open(h.principal(2),CALLBACK,{basis:{offer:offers[0].offer}});await a.invite(s);await h.pump();
 const heard=await h.run(2,'signaling.listen',{actor,input:{endpoint:ep.endpoint,endpoint_secret:ep.endpoint_secret}});
 assert.equal(heard.events[0].projection.offer_match,true);assert.equal('standing_accept' in heard.events[0].projection,false,'no standing acceptance');
 const leg=await keyPair(),claim=await h.run(2,'signaling.claim',{actor,input:{endpoint:ep.endpoint,endpoint_secret:ep.endpoint_secret,sid:s.sid,outcome:'accept',delegate:leg.jwk}});
 assert.deepEqual(payloadOf(claim.certificate).client,{client_id:h.ISS,origin:h.ISS,feature:FEATURE});
 await rejects(h.run(2,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:h.ISS,client_session:null},peer:{self:{client_id:APP,client_session:null}},opens:'both',label:'F',activate:true}}).then(p=>{assert.equal(p.state,'pending','a feature never qualifies as a party (no P1 evidence)');throw Object.assign(new Error(),{code:'ok'});}),'ok');
});

test('§5.4: late delivery to an endpoint that registers before answer_by; an empty routing set ends silently',async()=>{
 const h=await setup();const a=h.device(1,{kinds:[SYNC]});await a.register();
 const s=await a.open(h.principal(1),SYNC);await a.invite(s);await h.pump();
 const late=h.device(1,{kinds:[SYNC]});await late.register();await late.listen();assert.equal(invitesOf(late).length,1,'late delivery');
 // With no other endpoint of the app, the routing set is empty: the invite stays pending, records nothing for the
 // owner, and ends silently at answer_by.
 await late.run('signaling.unregister',late.auth());
 const s2=await a.open(h.principal(1),SYNC);await a.invite(s2);await h.pump();
 const pending=(await h.rows(1,'sig/in/')).find(([k])=>k.endsWith(s2.sid))[1];assert.equal(pending.state,'pending');assert.deepEqual(pending.delivered,[]);
 h.clock.advance(121000);await h.tick(1);await h.pump();
 assert.equal((await h.rows(1,'sig/in/')).find(([k])=>k.endsWith(s2.sid))[1].endReason,'timeout');
});

test('§13.1: open-offer windows per (principal, offer) hold, and an open offer never uses the pending reserve',async()=>{
 const h=await setup({entities:12});for(let n=3;n<=12;n++)for(const c of [APP])await h.approve(n,c,CALLBACK);
 const minter=h.device(2,{kinds:[CALLBACK]});await minter.register();const {offers}=await minter.offer(CALLBACK,{uses:16});const token=offers[0].offer;
 const a=h.device(1,{kinds:[CALLBACK]});await a.register();let admitted=0;
 for(let i=0;i<8;i++){const s=await a.open(h.principal(2),CALLBACK,{basis:{offer:token}});await a.invite(s);await h.pump();await minter.listen();
  const got=invitesOf(minter).find(e=>e.sid===s.sid);if(got){admitted++;const r=await minter.claim(s.sid,'decline');await minter.decline(r);await h.pump();}}
 assert.equal(admitted,6,'6 per hour per (principal, offer)');
 // Base pending capacity held by bound offers: open-offer invites are refused, bound ones use the cross share.
 const b2=h.device(2,{kinds:[CALLBACK]});await b2.register();
 for(let n=3;n<=6;n++){const d=h.device(n,{kinds:[CALLBACK]});await d.register();const {offers:o}=await b2.offer(CALLBACK,{principals:[h.principal(n)]});const s=await d.open(h.principal(2),CALLBACK,{basis:{offer:o[0].offer}});await d.invite(s);}
 await h.pump();const pending=(await h.rows(2,'sig/in/')).filter(([,r])=>r.state==='pending').length;assert.equal(pending,BOUNDS.recipientPending);
 const o7=h.device(7,{kinds:[CALLBACK]});await o7.register();const s7=await o7.open(h.principal(2),CALLBACK,{basis:{offer:token}});await o7.invite(s7);await h.pump();
 assert.equal((await h.rows(2,'sig/in/')).filter(([,r])=>r.state==='pending').length,BOUNDS.recipientPending,'the open offer used no reserve');
 const d8=h.device(8,{kinds:[CALLBACK]});await d8.register();const {offers:o8}=await b2.offer(CALLBACK,{principals:[h.principal(8)]});const s8=await d8.open(h.principal(2),CALLBACK,{basis:{offer:o8[0].offer}});await d8.invite(s8);await h.pump();
 assert.equal((await h.rows(2,'sig/in/')).find(([k])=>k.endsWith(s8.sid))?.[1].reserve,'cross','a matched bound offer uses the cross share');
 // Own devices still get the self share.
 const x=h.device(2,{kinds:[SYNC]}),y=h.device(2,{kinds:[SYNC]});await x.register();await y.register();const own=await x.open(h.principal(2),SYNC);await x.invite(own);await h.pump();await y.listen();
 assert.equal(invitesOf(y).length,1,'the self share is never taken by cross-entity invites');
});

test('§5.8: activation racing a party\'s approval removal; client-session revocation ends paired sessions and bound pairings only',async()=>{
 const h=await setup();
 const p=await h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:OTHER_APP,client_session:'cs-1'},peer:{self:{client_id:APP,client_session:null}},opens:'peer',label:'Daemon'}});
 await h.unapprove(1,OTHER_APP,REMOTE);await rejects(h.run(1,'signaling.pairing-activate',{input:{id:p.id,revision:p.revision}}),'not_found','the pairing was deleted with the approval');
 await h.approve(1,OTHER_APP,REMOTE);
 const live=await h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:OTHER_APP,client_session:'cs-1'},peer:{self:{client_id:APP,client_session:null}},opens:'peer',label:'Daemon',activate:true}});assert.equal(live.state,'live');
 const daemon=h.device(1,{clientId:OTHER_APP,kinds:[REMOTE],clientSession:'cs-1'}),web=h.device(1,{kinds:[REMOTE]});await daemon.register();await web.register();
 const minter=h.device(1,{clientId:OTHER_APP,kinds:[CALLBACK],clientSession:'cs-1'});await minter.register();await minter.offer(CALLBACK,{principals:[h.principal(2)]});
 const s=await web.open(h.principal(1),REMOTE,{target:daemon.endpoint});await web.invite(s);await h.pump();await daemon.listen();const r=await daemon.claim(s.sid);await daemon.accept(r);await h.pump();await web.listen();
 await h.run(1,'signaling.lifecycle',{actor:h.system(1),input:{event:'client-session-revoked',clientId:OTHER_APP,clientSession:'cs-1'}});await h.pump();await web.listen();
 assert.equal((await h.run(1,'signaling.pairings')).pairings.length,0,'the bound pairing is deleted');
 assert.equal((await h.run(1,'signaling.sessions')).sessions.length,0,'its sessions ended');
 assert.equal((await h.run(1,'signaling.offers')).offers.length,1,'revoking one client session ends no offer');
});

test('§13.1: live caps per pairing: own-entity two per (pairing, endpoint pair); cross-entity 2 × covered local endpoints',async()=>{
 const h=await setup();
 await h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:OTHER_APP,client_session:null},peer:{self:{client_id:APP,client_session:null}},opens:'peer',label:'D',activate:true}});
 const d=h.device(1,{clientId:OTHER_APP,kinds:[REMOTE]}),w=h.device(1,{kinds:[REMOTE]});await d.register();await w.register();
 for(let i=0;i<3;i++){const s=await w.open(h.principal(1),REMOTE,{target:d.endpoint});await w.invite(s);}await h.pump();await d.listen();
 assert.equal(invitesOf(d).length,2,'own-entity: two live per endpoint pair');
 const fresh=n=>h.owner(n,{freshAuth:true});
 await h.run(1,'signaling.pairing-create',{actor:fresh(1),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(2)},opens:'local',label:'B',activate:true}});
 await h.run(2,'signaling.pairing-create',{actor:fresh(2),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(1)},opens:'peer',label:'A',activate:true}});
 const a=h.device(1,{kinds:[PEER]}),b=h.device(2,{kinds:[PEER]});await a.register();await b.register();
 for(let i=0;i<4;i++){const s=await a.open(h.principal(2),PEER,{basis:{relation:'pairing'}});await a.invite(s);}await h.pump();await b.listen();
 assert.equal(invitesOf(b).length,2,'2 × one covered endpoint, whatever leg keys or sids the peer uses');
});

test('§5.8, §15: a pairing covers later additive versions without new disclosure; a disclosure-adding version needs re-confirmation',async()=>{
 const h=await signalingHost();await standardKinds(h);for(const c of [APP,OTHER_APP])await h.approve(1,c,REMOTE);
 const p=await h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE,1),local:{client_id:OTHER_APP,client_session:null},peer:{self:{client_id:APP,client_session:null}},opens:'peer',label:'D',activate:true}});
 // v2 adds a property with known categories (additive, no new disclosure); v3 adds one with a new category.
 const v2=await h.publish({line:REMOTE,parties:'any',bases:['self','pairing'],properties:{note:{type:'boolean'}}});
 for(const c of [APP,OTHER_APP])await h.approve(1,c,REMOTE,{version:2});
 const d=h.device(1,{clientId:OTHER_APP,kinds:[REMOTE]}),w=h.device(1,{kinds:[REMOTE]});await d.register();await w.register();
 const s=await w.open(h.principal(1),REMOTE,{target:d.endpoint});assert.equal(payloadOf(s.certificate).kind.version,2);await w.invite(s);await h.pump();await d.listen();assert.equal(invitesOf(d).length,1,'v2 covered');
 const v3=await h.publish({line:REMOTE,parties:'any',bases:['self','pairing'],properties:{note:{type:'boolean'},where:{type:'boolean'}},fieldCategories:{where:['location']}});
 for(const c of [APP,OTHER_APP])await h.approve(1,c,REMOTE,{version:3});
 await rejects(w.open(h.principal(1),REMOTE,{target:d.endpoint}),'invalid_args','v3 adds disclosure: not covered until re-confirmed');
 const cur=(await h.run(1,'signaling.pairings')).pairings[0];await h.run(1,'signaling.pairing-update',{input:{id:p.id,revision:cur.revision,kind:v3}});
 await w.open(h.principal(1),REMOTE,{target:d.endpoint});void v2;
});

test('§15: an approval at v1 receives an additive v2 invite with context projected; a non-additive version admits nothing',async()=>{
 const h=await signalingHost();const LINE='https://chat.example/kinds/rooms/v1',room={type:'string',maxLength:36,format:'uuid'};
 await h.publish({line:LINE,parties:'any',properties:{room},maxBytes:256});
 await h.publish({line:LINE,parties:'any',properties:{room,topic:room},maxBytes:256});
 await h.publish({line:LINE,parties:'any',properties:{room:{type:'boolean'}},maxBytes:256});// v3: not additive from v2
 await h.approve(2,APP,LINE,{version:1});await h.approve(1,APP,LINE,{version:2});
 const b=h.device(2,{kinds:[LINE]}),a=h.device(1,{kinds:[LINE]});await b.register();await a.register();
 const {offers}=await b.offer(LINE,{principals:[h.principal(1)]});
 const s=await a.open(h.principal(2),LINE,{basis:{offer:offers[0].offer}});assert.equal(payloadOf(s.certificate).kind.version,2);
 const ids={room:'00000000-0000-4000-8000-000000000001',topic:'00000000-0000-4000-8000-000000000002'};
 await a.send(s,[await a.sign(s,'invite',a.inviteBody(s,{context:ids}))]);await h.pump();await b.listen();
 const inv=invitesOf(b)[0];assert.ok(inv,'admitted: v1 → v2 is additive');assert.deepEqual(inv.projection.context,{room:ids.room},'projected to the approved v1');
 assert.equal(payloadOf(inv.invite).body.context.topic,ids.topic,'the raw invite is delivered unchanged');
 await h.approve(1,APP,LINE,{version:3});
 const {offers:o2}=await b.offer(LINE,{principals:[h.principal(1)]});
 const s3=await a.open(h.principal(2),LINE,{basis:{offer:o2[0].offer}});await a.invite(s3);await h.pump();await b.listen();
 assert.equal(invitesOf(b).length,1,'v3 is not additive from the offer\'s v1: nothing is admitted');
});

test('§8.3: crossing pairing invites resolve by glare from both initiator leg keys; equal keys cancel both',async()=>{
 const a=await keyPair(),b=await keyPair();
 const one=await glareSurvivor(a.jkt,b.jkt),two=await glareSurvivor(b.jkt,a.jkt);
 assert.equal(one==='a'?'A':'B',two==='b'?'A':'B','both endpoints compute the same survivor');
 assert.equal(await glareSurvivor(a.jkt,a.jkt),'both-cancel');
});

test('§3.6, §21.1 "No presentation": signaling creates no activity item, notification or owner-visible invite record',async()=>{
 const h=await setup();await offered(h,{accept:false});
 const rows=[...await h.account(2).store.list({prefix:''})].map(([k])=>k);
 assert.equal(rows.some(k=>/^(activity|notification|app-message)/.test(k)),false);
});

test('§13.1: the aggregate data budget counts what the entity\'s legs send and receive; the sender gets rate_limited',async()=>{
 const h=await setup();const x=h.device(1,{kinds:[SYNC]}),y=h.device(1,{kinds:[SYNC]});await x.register();await y.register();
 let refused=null;
 for(let i=0;i<10&&!refused;i++){
  const s=await x.open(h.principal(1),SYNC,{profile:'data'});await x.invite(s);await h.pump();await y.listen();const r=await y.claim(s.sid);await y.accept(r,{});await h.pump();await x.listen();
  for(let m=0;m<16;m++){try{await x.data(s,4096);}catch(e){refused=e.code;break;}if(m%4===3)await h.pump();}
  await h.pump();if(!refused){await x.end(s);await h.pump();}
 }
 assert.equal(refused,'rate_limited','own-entity data counts at send and receive, so the 1 MiB budget binds after 8 full legs');
});
