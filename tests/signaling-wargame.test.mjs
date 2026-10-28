// RTC wargame findings that still apply to signaling rev 3.2, retargeted (engine level; the route-level H1 and R1 cases
// are in tests/signaling-wargame-routes.test.mjs). Withdrawn with their features: M1 contact-link starvation, L2 missed
// folding, L5 ticket pruning, R2 ticket windows, R3 mutes, I2 round-robin preference, I5 ticket mint rate (signaling
// Appendix B.10). Provisional and unsigned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalingHost,standardKinds,payloadOf,keyPair,fault,relay,APP,OTHER_APP,CALLBACK,SYNC,subOf,identityOf} from './helpers/signaling-fixture.mjs';
import {buildBatch} from '../packages/signaling/messages.mjs';
import {signLegCertificate,signMessage} from '../packages/signaling/certificates.mjs';
import {BOUNDS} from '../packages/signaling/sessions.mjs';

const states=(d,sid)=>d.events.filter(e=>e.sid===sid&&e.type==='state').map(e=>e.state+(e.control?':control('+payloadOf(e.control).reason+')':''));
const inRec=async(h,n,sid)=>(await h.rows(n,'sig/in/')).map(([,v])=>v).find(r=>r.sid===sid);
const outRec=async(h,n,sid)=>(await h.rows(n,'sig/out/')).map(([,v])=>v).find(r=>r.sid===sid);
async function setup(){const h=await signalingHost();await standardKinds(h);for(const n of [1,2,3])for(const c of [APP,OTHER_APP]){await h.approve(n,c,CALLBACK);await h.approve(n,c,SYNC);}return h;}
/** A pending bound-offer invite from entity 1 to entity 2 (device b registered); `again()` dials a fresh offer. */
async function pending(h){
 const a=h.device(1,{kinds:[CALLBACK]}),b=h.device(2,{kinds:[CALLBACK]});await a.register();await b.register();
 const again=async()=>{const {offers}=await b.offer(CALLBACK,{principals:[h.principal(1)]});const s=await a.open(h.principal(2),CALLBACK,{basis:{offer:offers[0].offer}});await a.invite(s);await h.pump();return s;};
 return {a,b,s:await again(),again};
}
const FAKE='A'.repeat(43);

test('H1/L4 (W5): pre-claim messages other than invite and cancel are dropped; nothing tells the initiator whether it was admitted, blocked or unrouted',async()=>{
 const h=await setup();const {a,b,again}=await pending(h);
 const probe=async()=>{
  const s=await again();
  // Posted around the initiator's own provider: two different `end`s at the same seq before any claim.
  const m1=await a.sign(s,'end',{reason:'closed'},{seq:1,to:FAKE}),m2=await a.sign(s,'end',{reason:'failed'},{seq:1,to:FAKE});
  await h.ingest(2,buildBatch({certificates:[s.certificate],messages:[m1,m2]}));await h.pump();await a.listen();
  return {seen:states(a,s.sid),rec:await inRec(h,2,s.sid)};
 };
 const admitted=await probe();assert.deepEqual(admitted.seen,[],'admitted: nothing comes back');
 assert.equal(admitted.rec.state,'ended');assert.equal(admitted.rec.endReason,'failed','the reused seq fails the leg, silently');
 await h.run(2,'signaling.block',{input:{principal:h.principal(1)}});
 const blocked=await probe().catch(()=>({seen:[],rec:undefined}));assert.deepEqual(blocked.seen,admitted.seen,'blocked: the same observation');assert.equal(blocked.rec,undefined);
 await h.run(2,'signaling.unblock',{input:{principal:h.principal(1)}});
});

test('H1 (offerSeq fail): a buffer overflow on an unanswered invite ends it without a control statement',async()=>{
 const h=await setup();const {a,b,s}=await pending(h);await b.listen();
 const messages=[];for(let seq=2;seq<=34;seq++)messages.push(await a.sign(s,'cancel',{},{seq}));
 await h.ingest(2,buildBatch({certificates:[s.certificate],messages:messages.slice(0,32)}));
 await h.ingest(2,buildBatch({messages:messages.slice(32)}));await h.pump();await a.listen();
 const rec=await inRec(h,2,s.sid);assert.equal(rec.state,'ended');assert.equal(rec.endReason,'failed');
 assert.deepEqual(states(a,s.sid),[],'no control statement to the initiator');assert.equal((await outRec(h,1,s.sid)).state,'pending','the initiator waits out answer_by');
 await b.listen();assert.equal(b.events.at(-1).state,'ended','the recipient devices are told');
 assert.equal((await h.rows(2,'sig/outbox/')).length,0);
});

test('H1 (W6a): a seq gap timeout on an unanswered invite ends it silently towards the initiator',async()=>{
 const h=await setup();const {a,s}=await pending(h);
 await h.ingest(2,buildBatch({certificates:[s.certificate],messages:[await a.sign(s,'cancel',{},{seq:2})]}));
 h.clock.advance(11000);await h.tick(2);await h.pump();await a.listen();
 assert.equal((await inRec(h,2,s.sid)).endReason,'failed');assert.deepEqual(states(a,s.sid),[]);
 assert.equal((await outRec(h,1,s.sid)).state,'pending');
});

test('H1 (W6b): account deletion ends an unanswered invite without `revoked`; a claimed one is still told',async()=>{
 const h=await setup();const {a,b,s,again}=await pending(h);
 const answered=await again();await b.listen();await b.claim(answered.sid);
 const out=await h.run(2,'signaling.lifecycle',{actor:h.system(2),input:{event:'deletion'}});assert.equal(out.ended,2);await h.pump();await a.listen();
 assert.deepEqual(states(a,s.sid),[],'unanswered: silent');assert.equal((await outRec(h,1,s.sid)).state,'pending');
 assert.deepEqual(states(a,answered.sid),['ended:control(revoked)'],'claimed: the initiator is told');
});

test('M3 (W4): one application cannot squat the endpoint cap: 8 per application within 32',async()=>{
 const h=await setup();
 for(let i=0;i<BOUNDS.endpointsPerApp;i++)await h.device(2,{kinds:[CALLBACK]}).register();
 assert.equal((await fault(h.device(2,{kinds:[CALLBACK]}).register())).code,'rate_limited','8 per application');
 await h.device(2,{clientId:OTHER_APP,kinds:[CALLBACK]}).register();// another application still registers
});

test('M4 (W2): an application whose approval was removed without its ending steps can no longer renew or signal; it can still end',async()=>{
 const h=await setup();const {a,b,s}=await pending(h);await b.listen();const c=await b.claim(s.sid);await b.accept(c);await h.pump();await a.listen();
 // The approval is read live on every widening method: remove it directly (as after a crash before §14.2 ran).
 const {memoryKey,withoutApproval}=await import('../packages/intents/sessions.mjs');const key=memoryKey(subOf(1),CALLBACK);
 await h.account(1).store.put(key,withoutApproval(await h.account(1).store.get(key),{handler:APP,feature:false}).memory);
 assert.equal((await fault(a.run('signaling.renew',{...a.auth(),sid:s.sid}))).code,'approval_required');
 assert.equal((await fault(a.candidates(s,[relay()]))).code,'approval_required');s.seq--;// refused whole: its seq was not used
 assert.deepEqual(await a.end(s),{accepted:1},'end is narrowing and never refused');
});

test('L1 (W8): a second initiator\'s invite with a colliding sid is dropped; the live session keeps its index',async()=>{
 const h=await setup();const {a,b,s}=await pending(h);await b.listen();const c=await b.claim(s.sid);await b.accept(c);await h.pump();await a.listen();
 // Entity 3's provider certifies an initiator leg for the same sid and invites entity 2 on an offer of its own.
 const {offers}=await b.offer(CALLBACK,{principals:[h.principal(3)]});const {offerDigest}=await import('../packages/signaling/messages.mjs');
 const leg=await keyPair(),now=h.clock.now(),kind=payloadOf(s.certificate).kind;
 const cert=await signLegCertificate({issuer:h.ISS,sub:subOf(3),identity:identityOf(subOf(3)),aud:identityOf(subOf(2)),sid:s.sid,role:'initiator',kind,profile:'webrtc',client:{client_id:APP,origin:'https://app.example',feature:null},delegate:leg.jwk,aep:0,now,lifetime:600,maxSeconds:600},h.account(3).cert);
 const body={kind,profile:'webrtc',answer_by:Math.floor(now/1000)+60,basis:{offer_digest:await offerDigest(offers[0].offer)},context:null,params:{offer:null}};
 const inv=await signMessage({bindle:'signaling-message',v:1,iss:h.ISS,sub:subOf(3),aud:identityOf(subOf(2)),sid:s.sid,leg:leg.jkt,to:null,seq:0,iat:Math.floor(now/1000),type:'invite',body},leg.privateKey);
 await h.ingest(2,buildBatch({certificates:[cert.certificate],messages:[inv],offers:[offers[0].offer]}));await h.pump();
 assert.equal((await h.rows(2,'sig/in/')).filter(([,r])=>r.sid===s.sid&&r.state!=='ended').length,1,'the colliding invite is not admitted');
 assert.equal((await b.candidates(c,[relay()])).accepted,1,'the recipient endpoint still sends on its live session');
 await b.listen();assert.equal(b.invites().filter(e=>e.sid===s.sid).length,1,'no second invite reached the endpoint');
});
