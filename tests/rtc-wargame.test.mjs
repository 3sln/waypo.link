// RTC wargame 2026-10-27 (engine and route layer): each finding a read-only wargame confirmed with an engine test,
// ported here inverted so it asserts the fix. DEVLOG "2026-10-27 — RTC wargame findings and fixes (engine/route)".
// Local behaviour only (the loopback fixture of tests/helpers/rtc-fixture.mjs and the two-provider world of
// tests/helpers/rtc-federation-fixture.mjs); reserved .example hosts; every RTC flag off by default outside the fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rtcHost,CALL,SYNC,REF,ISS,APP,OTHER_APP,subOf,identityOf,relay,payloadOf,fault} from './helpers/rtc-fixture.mjs';
import {rtcWorld,A,B,C,identityURI,keyPair as worldKeyPair,OPS as WOPS,perform,read} from './helpers/rtc-federation-fixture.mjs';
import {AppQuery} from '../packages/app/engine.mjs';
import {buildBatch,linkDigest,RTC_BATCH_MEDIA_TYPE} from '../packages/rtc/messages.mjs';
import {signLegCertificate,signMessage} from '../packages/rtc/certificates.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {RTC_BOUNDS} from '../packages/rtc/sessions.mjs';
import {fanoutOrder,inviteLimits,takeLimits,limitsOpen,LIMITS} from '../packages/rtc/admission.mjs';
import {RtcRelay} from '../packages/rtc/relay.mjs';
import {rtcEndpoint} from '../packages/runtime/routes/rtc.mjs';

const MIN=60000,P256={name:'ECDSA',namedCurve:'P-256'};
const FAKE=Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
const nonce=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
async function kp(){const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}
const states=(d,sid)=>d.events.filter(e=>e.sid===sid&&e.type==='state').map(e=>e.state+(e.control?':control('+payloadOf(e.control).reason+')':''));
const inRec=async(h,n,sid)=>(await h.rows(n,'rtc/in/')).map(([,v])=>v).find(r=>r.sid===sid);
const outRec=async(h,n,sid)=>(await h.rows(n,'rtc/out/')).map(([,v])=>v).find(r=>r.sid===sid);
/** A ringing ticket invite from entity 1 to entity 2 (device b registered). */
async function ringingCall(h,{uses=20}={}){
 const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();
 return {a,b,s,link};
}

// ---- H1: no control statement for an unanswered incoming invite (spec §12 MUST) ----------------------------------------
test('H1/L4 (W5): pre-claim messages other than invite and cancel are dropped by the callee provider; nothing tells the caller whether it was admitted or blocked',async()=>{
 const h=await rtcHost();const {a,b,link}=await ringingCall(h);
 const probe=async()=>{
  const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();
  // Posted around the caller's own provider: two different `sas` at the same seq before any claim.
  const m1=await a.sign(s,'sas',{nonce:nonce()},{seq:1,to:FAKE}),m2=await a.sign(s,'sas',{nonce:nonce()},{seq:1,to:FAKE});
  await h.ingest(2,buildBatch({certificates:[s.certificate],messages:[m1,m2]}));await h.pump();await a.listen();
  return {seen:states(a,s.sid),rec:await inRec(h,2,s.sid)};
 };
 const admitted=await probe();assert.deepEqual(admitted.seen,[],'admitted: nothing comes back');
 // L4: the first `sas` is dropped at step 7 (after step 5); the second, reusing its seq, fails the leg, which H1 ends
 // silently (no control statement).
 assert.equal(admitted.rec.state,'ended');assert.equal(admitted.rec.endReason,'failed');
 await h.run(2,'rtc.block',{input:{principal:h.principal(1)}});
 const blocked=await probe();assert.deepEqual(blocked.seen,admitted.seen,'blocked: the same observation');assert.equal(blocked.rec,undefined);
 await h.run(2,'rtc.unblock',{input:{principal:h.principal(1)}});await b.run('rtc.unregister',b.auth());
 const noDevice=await probe();assert.deepEqual(noDevice.seen,admitted.seen,'no device: the same observation');
});

test('H1 (offerSeq fail): a buffer overflow on an unanswered invite ends it without a control statement',async()=>{
 const h=await rtcHost();const {a,b,s}=await ringingCall(h);await b.listen();
 // Cancels are allowed before the claim; 33 of them ahead of a gap at seq 1 overflow the 32-message buffer.
 const messages=[];for(let seq=2;seq<=34;seq++)messages.push(await a.sign(s,'cancel',{},{seq}));
 await h.ingest(2,buildBatch({certificates:[s.certificate],messages:messages.slice(0,32)}));
 await h.ingest(2,buildBatch({messages:messages.slice(32)}));await h.pump();await a.listen();
 const rec=await inRec(h,2,s.sid);assert.equal(rec.state,'ended');assert.equal(rec.endReason,'failed');
 assert.deepEqual(states(a,s.sid),[],'no control statement to the caller');assert.equal((await outRec(h,1,s.sid)).state,'ringing','the caller rings out');
 await b.listen();assert.equal(b.events.at(-1).state,'ended','the callee devices stop ringing');
 assert.equal((await h.rows(2,'rtc/outbox/')).length,0);
});

test('H1 (W6a): a seq gap timeout on an unanswered invite ends it silently towards the caller',async()=>{
 const h=await rtcHost();const {a,s}=await ringingCall(h);
 await h.ingest(2,buildBatch({certificates:[s.certificate],messages:[await a.sign(s,'cancel',{},{seq:2})]}));
 h.clock.advance(11000);await h.tick(2);await h.pump();await a.listen();
 assert.equal((await inRec(h,2,s.sid)).endReason,'failed');assert.deepEqual(states(a,s.sid),[]);
 assert.equal((await outRec(h,1,s.sid)).state,'ringing');
});

test('H1 (W6b): account deletion ends an unanswered invite without `revoked`; a claimed one is still told',async()=>{
 const h=await rtcHost();const {a,b,s,link}=await ringingCall(h);
 const answered=await a.open(h.principal(2),CALL,{basis:link});await a.invite(answered);await h.pump();await b.listen();await b.claim(answered.sid);
 const out=await h.run(2,'rtc.lifecycle',{actor:h.system(2),input:{event:'deletion'}});assert.equal(out.ended,2);await h.pump();await a.listen();
 assert.deepEqual(states(a,s.sid),[],'unanswered: rings out');assert.equal((await outRec(h,1,s.sid)).state,'ringing');
 assert.deepEqual(states(a,answered.sid),['ended:control(revoked)'],'claimed: the caller is told');
});

test('H1 (route): POST /bindle/rtc refuses a batch with any element issued by this host (same-host traffic only via rtcPeer)',async()=>{
 const W=await rtcWorld();const P=W.provider(B),env=P.env,b=P.device(1);await b.register();
 const answer=async body=>{const r=await rtcEndpoint({request:new Request(`${B}/bindle/rtc`,{method:'POST',headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body}),env,local:false});return [r.status,await r.text()];};
 const leg=await worldKeyPair(),iat=Math.floor(W.clock.now()/1000),sid=Buffer.from(Array(16).fill(5)).toString('base64url');
 const msg=(iss,sub)=>signMessage({bindle:'rtc-message',v:1,iss,sub,aud:identityURI(b.principal),sid,leg:leg.jkt,to:null,seq:1,iat,type:'cancel',body:{}},leg.privateKey);
 assert.deepEqual(await answer(buildBatch({messages:[await msg(B,P.entity(2).sub)]})),[400,'{"error":"rtc_batch_invalid"}']);
 assert.deepEqual(await answer(buildBatch({messages:[await msg(A,subOf(9))]})),[202,''],'a foreign issuer\'s element passes step 1');
 assert.deepEqual(await answer(buildBatch({messages:[await msg(A,subOf(9)),await msg(B,P.entity(2).sub)]})),[400,'{"error":"rtc_batch_invalid"}'],'one same-host element refuses the batch');
});

// ---- M1: own-device budget and ringing reserve -------------------------------------------------------------------------
test('M1 (W1): a contact-link holder cannot starve the owner\'s own device-to-device invites',async()=>{
 const h=await rtcHost();const atk=h.device(1),v1=h.device(2),v2=h.device(2);
 await atk.register();await v1.register();await v2.register();
 const contact=`${ISS}/users/user2/contact/c1?bindle_meta=a.b.c`;h.contacts.set(contact,{owner:subOf(2),parent:'grant-1'});
 await h.run(2,'rtc.set-contact-rtc',{input:{parent:'grant-1',purposes:[CALL]}});
 for(let i=0;i<20;i++){if(i&&i%6===0)h.clock.advance(10*MIN+1);const s=await atk.open(h.principal(2),CALL,{basis:contact});await atk.invite(s);await h.pump();await atk.cancel(s);await h.pump();}
 await v2.listen();const before=v2.claims().length;
 const own=await v1.open(h.principal(2),SYNC,{media:['data']});await v1.invite(own);await h.pump();await v2.listen();
 assert.equal(v2.claims().length-before,1,'the own-device invite is delivered in the same hour');
 assert.deepEqual(inviteLimits({sender:h.principal(2),issuer:ISS,own:true,parent:null}),[{name:'self',parts:[]}],'self counts only against its own budget');
});

test('M1 (§13 SHOULD): bearer links ring up to calleeRinging; self and principal-bound tickets use the reserve above it',async()=>{
 const h=await rtcHost();const atk=h.device(1),v1=h.device(2),v2=h.device(2),friend=h.device(3);
 await atk.register();await v1.register();await v2.register();await friend.register();
 const {link}=await v1.run('rtc.mint-ticket',{purposes:[CALL],uses:20,expires_in:3600});
 for(let i=0;i<RTC_BOUNDS.calleeRinging+1;i++){const s=await atk.open(h.principal(2),CALL,{basis:link});await atk.invite(s);}await h.pump();
 const ringing=async()=>(await h.rows(2,'rtc/in/')).filter(([,r])=>r.state==='ringing').length;
 assert.equal(await ringing(),RTC_BOUNDS.calleeRinging,'the bearer link fills the shared capacity; the 5th is dropped');
 const own=await v1.open(h.principal(2),SYNC,{media:['data']});await v1.invite(own);await h.pump();
 const bound=(await v1.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600,principal:h.principal(3)})).link;
 const fs=await friend.open(h.principal(2),CALL,{basis:bound});await friend.invite(fs);await h.pump();
 assert.equal(await ringing(),RTC_BOUNDS.calleeRinging+RTC_BOUNDS.calleeRingingReserve,'self and the principal-bound ticket still ring');
 const own2=await v1.open(h.principal(2),SYNC,{media:['data']});await v1.invite(own2);await h.pump();
 assert.equal(await ringing(),RTC_BOUNDS.calleeRinging+RTC_BOUNDS.calleeRingingReserve,'the reserve is bounded too');
});

// ---- M3: per-application endpoint cap and round-robin fan-out ----------------------------------------------------------
test('M3 (W4): one application cannot squat the endpoint cap or the fan-out',async()=>{
 const h=await rtcHost();const appDevice=(id,origin)=>h.device(2,{grant:h.grant(2,{clientId:origin+'/'+id,origin,purposes:[CALL]}),purposes:[CALL]});
 const good=appDevice('c',OTHER_APP);await good.register([CALL]);
 const evilGrant=h.grant(2,{purposes:[CALL]}),evil=[];
 for(let i=0;i<RTC_BOUNDS.endpointsPerApp;i++){const d=h.device(2,{grant:evilGrant,purposes:[CALL]});await d.register([CALL]);evil.push(d);}
 assert.equal((await fault(h.device(2,{grant:evilGrant,purposes:[CALL]}).register([CALL]))).code,'rate_limited','8 per application');
 const late=appDevice('c','https://third.example');await late.register([CALL]);
 const x=[],y=[];for(let i=0;i<RTC_BOUNDS.endpointsPerApp;i++){const dx=appDevice('x','https://x.example');await dx.register([CALL]);x.push(dx);const dy=appDevice('y','https://y.example');await dy.register([CALL]);y.push(dy);}
 h.clock.advance(1000);for(const d of evil)await d.listen();// the squatter is the most recently active
 const caller=h.device(1);await caller.register();
 const {link}=await good.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});
 const s=await caller.open(h.principal(2),CALL,{basis:link});await caller.invite(s);await h.pump();
 const got=async list=>{let n=0;for(const d of list){await d.listen();n+=d.claims().filter(e=>e.sid===s.sid).length;}return n;};
 assert.equal(await got([good]),1,'the other application receives the invite');assert.equal(await got([late]),1);
 const counts=[await got(evil),await got(x),await got(y)];
 assert.equal(counts.reduce((a,b)=>a+b,0)+2,RTC_BOUNDS.fanout,'at most 16 in all');
 assert.ok(counts.every(n=>n>=4&&n<=RTC_BOUNDS.endpointsPerApp),`round-robin across applications: ${counts}`);
 // The order itself: the caller's application first in each round, then by most recent activity.
 const eps=[{id:'a1',clientId:'B',lastSeen:9},{id:'a2',clientId:'B',lastSeen:8},{id:'b1',clientId:'C',lastSeen:7},{id:'c1',clientId:'P',lastSeen:1}];
 assert.deepEqual(fanoutOrder(eps,{prefer:'P',max:3}).map(e=>e.id),['c1','a1','b1']);
});

// ---- M4: live bound-purpose checks on send, renew and relay credentials ------------------------------------------------
test('M4 (W2): a narrowed application whose hook was lost can no longer renew or signal; it can still end',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:4,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();
 const c=await b.claim(s.sid);await b.accept(c);await h.pump();await a.listen();
 // The approval is the owner's interim record, read live on every method (extensions rev 3.2 removed AMD-X1): a record
 // narrowed without its ending steps (here written directly, as after a crash between the two) is still enforced.
 h.grants.get(a.grantInfo.id).purposes=[SYNC];// the approval record narrowed; no rtc.lifecycle ran
 assert.equal((await fault(a.run('rtc.renew',{...a.auth(),sid:s.sid}))).code,'forbidden');
 assert.equal((await fault(a.candidates(s,[relay()]))).code,'forbidden');s.seq--;// refused whole: its seq was not used
 assert.deepEqual(await a.end(s),{accepted:1},'end is narrowing and never refused');
});

test('M4: relay credentials re-check the session purpose against the signaling approval',async()=>{
 const turn={issue:async()=>({iceServers:[],expiresIn:60}),revoke:async()=>{}},spend={reserve:async()=>({enforced:true,id:1}),commit:async()=>{},release:async()=>{}};
 const h=await rtcHost({flags:{RTC_TURN_ENABLED:true},relay:x=>new RtcRelay({service:x.service,adapter:turn,spend,plan:async()=>'plus'})});
 const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:4,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();const c=await b.claim(s.sid);await b.accept(c);await h.pump();
 h.grants.get(a.grantInfo.id).purposes=[SYNC];
 assert.equal((await fault(a.run('rtc.relay-credentials',{...a.auth(),sid:s.sid}))).code,'forbidden');
 assert.equal((await h.rows(1,'rtc/relay')).length,0,'nothing reserved or recorded');
});

// ---- M5: local checks before eligibility -------------------------------------------------------------------------------
test('M5 (W7): blocked or unconfigured invites cost no eligibility check; one check per application grant per invite',async()=>{
 const h=await rtcHost();const atk=h.device(1);await atk.register();
 const grantA=h.grant(2),grantB=h.grant(2,{clientId:OTHER_APP+'/c',origin:OTHER_APP});
 for(let i=0;i<RTC_BOUNDS.endpointsPerApp;i++){await h.device(2,{grant:grantA}).register();}
 for(let i=0;i<4;i++)await h.device(2,{grant:grantB}).register();
 const {link}=await h.device(2,{grant:grantA}).run('rtc.mint-ticket',{purposes:[CALL],uses:20,expires_in:3600});
 const svc=h.account(2).service,inner=svc.approved.bind(svc);let calls=0;svc.approved=async(...x)=>{calls++;return inner(...x);};// approval reads at admission
 // No basis (requests are off): dropped at the local checks.
 for(let i=0;i<4;i++){const s=await atk.open(h.principal(2),CALL);await atk.invite(s);await atk.cancel(s);}await h.pump();
 assert.equal(calls,0,'no approval read for an unconfigured basis');
 await h.run(2,'rtc.block',{input:{principal:h.principal(1)}});
 for(let i=0;i<4;i++){const s=await atk.open(h.principal(2),CALL,{basis:link});await atk.invite(s);await atk.cancel(s);}await h.pump();
 assert.equal(calls,0,'no approval read for a blocked caller');assert.equal((await h.rows(2,'rtc/in/')).length,0,'nothing admitted');
 await h.run(2,'rtc.unblock',{input:{principal:h.principal(1)}});
 const s=await atk.open(h.principal(2),CALL,{basis:link});await atk.invite(s);await h.pump();
 assert.equal(calls,2,'an admitted invite: one check per application, not per endpoint');
 assert.equal((await inRec(h,2,s.sid)).delivered.length,RTC_BOUNDS.endpointsPerApp+4);
});

// ---- L1: sid collision -------------------------------------------------------------------------------------------------
test('L1 (W8): a second caller\'s invite with a colliding sid is dropped; the live call keeps its index',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();
 const c=await b.claim(s.sid);await b.accept(c);await h.pump();await a.listen();
 // Entity 3's provider certifies a caller leg for the same sid and invites entity 2 (a hostile provider chooses sids).
 const e3=h.account(3),leg=await kp(),now=h.clock.now();
 const cert=await signLegCertificate({issuer:ISS,sub:subOf(3),identity:identityOf(subOf(3)),aud:identityOf(subOf(2)),sid:s.sid,role:'caller',purpose:REF[CALL],client:{client_id:APP+'/client',origin:APP},delegate:leg.jwk,aep:0,now,lifetime:600,maxSeconds:600,sessionEndsAt:Math.floor(now/1000)+86400,allowLoopback:false},e3.cert,crypto);
 const body={purpose:REF[CALL],media:['audio','video'],ring_until:Math.floor(now/1000)+60,basis:{link_digest:await linkDigest(link)},context:null,offer:null,callback_digest:null,sas_commit:null};
 const inv=await signMessage({bindle:'rtc-message',v:1,iss:ISS,sub:subOf(3),aud:identityOf(subOf(2)),sid:s.sid,leg:leg.jkt,to:null,seq:0,iat:Math.floor(now/1000),type:'invite',body},leg.privateKey);
 await h.ingest(2,buildBatch({certificates:[cert.certificate??cert],messages:[inv],links:[link]}));await h.pump();
 assert.equal((await h.rows(2,'rtc/in/')).filter(([,r])=>r.sid===s.sid).length,1,'the colliding invite is not admitted');
 assert.equal((await b.candidates(c,[relay()])).accepted,1,'the callee endpoint still sends on its live call');
 assert.ok((await b.run('rtc.renew',{...b.auth(),sid:s.sid})).certificate,'and renews');
 await b.listen();assert.equal(b.claims().filter(e=>e.sid===s.sid).length,1,'no second invite reached the endpoint');
});

// ---- L2: missed-list flooding -------------------------------------------------------------------------------------------
test('L2: repeated invites from one caller fold into one missed row and never evict another caller\'s',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2),c=h.device(3);await a.register();await b.register();await c.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:20,expires_in:3600});
 const sc=await c.open(h.principal(2),CALL,{basis:link});await c.invite(sc);await h.pump();await c.cancel(sc);await h.pump();
 for(let i=0;i<5;i++){const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await a.cancel(s);await h.pump();}
 const {missed}=await h.run(2,'rtc.missed');
 assert.equal(missed.length,2);assert.deepEqual(missed.map(m=>m.caller.sub).sort(),[subOf(1),subOf(3)].sort());
 assert.equal((await h.rows(2,'rtc/missed/')).map(([,v])=>v).find(r=>r.caller.sub===subOf(1)).count,5);
});

// ---- L5: ticket rows stay countable ------------------------------------------------------------------------------------
test('L5: short-lived tickets cannot push live ones out of the cap count',async()=>{
 const h=await rtcHost();const b=h.device(2);await b.register();
 // Review I5: the per-app mint rate (120 per hour) needs the clock to move an hour every 100 mints.
 for(let i=0;i<1000;i++){await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:1});if(i%50===49)h.clock.advance(i%100===99?3600001:2000);}
 h.clock.advance(3600001);
 let live=0;for(let i=0;i<RTC_BOUNDS.tickets+1;i++){if(await fault(b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600})))break;live++;}
 assert.ok(live<=RTC_BOUNDS.tickets,`live tickets within the cap (${live})`);
 const rows=await h.rows(2,'rtc/ticket/');assert.ok(rows.length<=RTC_BOUNDS.tickets*4,`every row fits one read (${rows.length})`);
 const {tickets}=await h.run(2,'rtc.tickets');assert.equal(tickets.filter(t=>t.live).length,live,'the owner list sees every live ticket');
});

// ---- Review follow-ups (2026-10-27): the reviewer's proofs of concept, inverted ---------------------------------------
// DEVLOG "2026-10-27 — RTC wargame review follow-ups". Provisional, unsigned.
const seconds=ms=>Math.floor(ms/1000);
/** A route env whose per-account RTC_FOREIGN_ENABLED is off for `offOwner` only (on site-wide). */
const accountOff=(env,offOwner)=>{env.flags={for:ctx=>({version:1,evaluate:name=>({value:!(name==='RTC_FOREIGN_ENABLED'&&ctx?.subject?.owner===offOwner),reason:'rule'}),envState:()=>({state:'managed'}),global:()=>true})};};
const post=async(env,body)=>{const r=await rtcEndpoint({request:new Request(`${B}/bindle/rtc`,{method:'POST',headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body}),env,local:false});return [r.status,await r.text()];};

test('R1 inverted: a stale-iat batch answers the same 400 for a flag-on and a flag-off entity',async()=>{
 const W=await rtcWorld();const env=W.provider(B).env;
 const b=W.provider(B).device(1);await b.register();const a=W.provider(A).device(1);await a.register();
 const leg=await worldKeyPair(),now=W.clock.now(),sid=Buffer.from(Array(16).fill(7)).toString('base64url');
 const cancel=iat=>signMessage({bindle:'rtc-message',v:1,iss:A,sub:a.entity.sub,aud:identityURI(b.principal),sid,leg:leg.jkt,to:null,seq:1,iat,type:'cancel',body:{}},leg.privateKey);
 // iat one day in the past: fails step 1 (iatWithinWindow).
 const stale=buildBatch({messages:[await cancel(seconds(now)-86400)]}),fresh=buildBatch({messages:[await cancel(seconds(now))]});
 // The route runs step 1 itself: a step-1-invalid batch never reaches the writer.
 const accounts=env.ACCOUNTS;let calls=0;env.ACCOUNTS={get:id=>{const stub=accounts.get(id);return {invoke:args=>{calls++;return stub.invoke(args);}};}};
 const on=[await post(env,stale),await post(env,fresh)];
 accountOff(env,b.entity.sub);const off=[await post(env,stale),await post(env,fresh)];delete env.flags;
 env.ACCOUNTS=accounts;assert.equal(calls,2,'only the two step-1-valid batches reached the writer');
 assert.deepEqual(on,[[400,'{"error":"rtc_batch_invalid"}'],[202,'']]);
 assert.deepEqual(off,on,'the per-account flag is not observable');
 // The flag-off batch took a queue slot `dark` (its size only, no body) and is removed unprocessed.
 const queued=[...await b.entity.store.list({prefix:'rtc/inq/'})].map(([,v])=>v);
 assert.equal(queued.length,2);assert.equal(queued.filter(r=>r.dark===true&&r.batch===undefined).length,1);
 await W.pump();assert.equal([...await b.entity.store.list({prefix:'rtc/inq/'})].length,0);
});

test('R1: the inbound queue fills and answers 503 alike for flag-on and flag-off entities',async()=>{
 const W=await rtcWorld();const P=W.provider(B),env=P.env;
 const a=W.provider(A).device(1);await a.register();const leg=await worldKeyPair(),sid=Buffer.from(Array(16).fill(8)).toString('base64url');
 const batchFor=async e=>buildBatch({messages:[await signMessage({bindle:'rtc-message',v:1,iss:A,sub:a.entity.sub,aud:identityURI(e.principal),sid,leg:leg.jkt,to:null,seq:1,iat:seconds(W.clock.now()),type:'cancel',body:{}},leg.privateKey)]});
 const fill=async e=>{const body=await batchFor(e),out=[];for(let i=0;i<=RTC_BOUNDS.inbox;i++)out.push((await post(env,body))[0]);return out;};
 // Nothing drains (the fixture's defer is a no-op and nothing pumps), so each queue fills at RTC_BOUNDS.inbox.
 const on=await fill(P.entity(1));accountOff(env,P.entity(2).sub);const off=await fill(P.entity(2));delete env.flags;
 assert.deepEqual(off,on);assert.equal(on.at(-1),503);assert.equal(on.filter(x=>x===202).length,RTC_BOUNDS.inbox);
});

test('R2 inverted: same-host bearer-link callers cannot exhaust the per-callee window; the bound-ticket friend still rings',async()=>{
 const h=await rtcHost({entities:5});const v=h.device(2);await v.register();
 const contact=`${ISS}/users/user2/contact/c1?bindle_meta=a.b.c`;h.contacts.set(contact,{owner:subOf(2),parent:'grant-1'});
 await h.run(2,'rtc.set-contact-rtc',{input:{parent:'grant-1',purposes:[CALL]}});
 const atks=[h.device(1),h.device(3),h.device(4)];for(const a of atks)await a.register();
 for(let i=0;i<20;i++){if(i&&i%6===0)h.clock.advance(10*MIN+1);
  for(const a of atks){const s=await a.open(h.principal(2),CALL,{basis:contact});await a.invite(s);await h.pump();await a.cancel(s);await h.pump();}}
 const admitted=(await h.rows(2,'rtc/in/')).length;
 assert.ok(admitted<=LIMITS.sameHost.max,`same-host callers together stay within the sameHost window (${admitted})`);
 const friend=h.device(5);await friend.register();
 const bound=(await v.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600,principal:h.principal(5)})).link;
 const fs=await friend.open(h.principal(2),CALL,{basis:bound});await friend.invite(fs);await h.pump();
 assert.ok(await inRec(h,2,fs.sid),'the principal-bound ticket invite is admitted');
});

test('R2: limit windows: same-host shares cap at sameHost, foreign callers keep callee headroom, preferred invites have their own window',async()=>{
 const rows=new Map(),tx={get:async k=>rows.get(k),put:async(k,v)=>{rows.set(k,v);}},now=Date.UTC(2026,9,27,12);
 const local=n=>({iss:ISS,sub:subOf(n)}),foreign=n=>({iss:'https://far.example',sub:subOf(n)});
 const take=(sender,{preferred=false,parent=null}={})=>takeLimits(tx,inviteLimits({sender,issuer:ISS,own:false,parent,preferred}),now);
 assert.deepEqual(inviteLimits({sender:local(1),issuer:ISS,own:false,parent:null}).map(i=>i.name),['pair','caller','issuerCallee','callee','sameHost']);
 assert.deepEqual(inviteLimits({sender:foreign(1),issuer:ISS,own:false,parent:null}).map(i=>i.name),['pair','caller','issuerCallee','callee']);
 assert.deepEqual(inviteLimits({sender:foreign(1),issuer:ISS,own:false,parent:'ticket:x',preferred:true}).map(i=>i.name),['pair','caller','preferred','issuerParent']);
 assert.deepEqual(inviteLimits({sender:local(1),issuer:ISS,own:true,parent:null,preferred:true}).map(i=>i.name),['self']);
 // Many same-host principals (each within its own pair and caller windows) together stop at sameHost (40).
 let n=0;for(let i=0;i<60;i++)if(await take(local(100+i)))n++;
 assert.equal(n,LIMITS.sameHost.max);
 // Foreign callers keep the rest of `callee` (60 - 40 = 20; their issuer window is 20 too).
 let f=0;for(let i=0;i<30;i++)if(await take(foreign(200+i)))f++;
 assert.equal(f,LIMITS.callee.max-LIMITS.sameHost.max);
 assert.equal(await limitsOpen(tx,inviteLimits({sender:foreign(300),issuer:ISS,own:false,parent:null}),now),false,'I1: the read-only pre-check sees the full window');
 // `callee` is exhausted, yet a principal-bound ticket invite still counts in its own window.
 assert.equal(await take(local(400),{preferred:true,parent:'ticket:t1'}),true);
 assert.equal(await take(foreign(401),{preferred:true,parent:'ticket:t2'}),true);
});

test('R2: a leaked principal-bound ticket presented by another principal gets no preferred treatment',async()=>{
 const h=await rtcHost({entities:4});const v=h.device(2);await v.register();
 const bound=(await v.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600,principal:h.principal(3)})).link;
 const thief=h.device(1);await thief.register();
 const s=await thief.open(h.principal(2),CALL,{basis:bound});await thief.invite(s);await h.pump();
 assert.equal(await inRec(h,2,s.sid),undefined,'refused at the spend');
 const limitNames=(await h.rows(2,'rtc/limit/')).map(([k])=>k.split('/')[2]);
 assert.ok(!limitNames.includes('preferred'),`no preferred window spent (${limitNames})`);
});

async function ownerOp(e,operation,input){const O=WOPS[operation],op=new O({actor:{kind:'owner',owner:e.sub},...input===undefined?{}:{input}});return O.prototype instanceof AppQuery?read(e.engine,op):perform(e.engine,op);}
async function foreignRing(W,caller,callee,link,rounds=6){
 const s=await caller.open(callee.principal,CALL,{basis:link});await caller.invite(s);await W.pump();
 for(let i=0;i<rounds;i++){await callee.listen();const got=callee.invites().find(e=>e.sid===s.sid);if(got)return got;W.clock.advance(2100);await W.tickAll();await W.pump();}
 return null;
}
/** foreignRing, then the caller cancels (the callee's ringing capacity stays free). Returns the projection. */
async function ringOnce(W,caller,callee,link){const got=await foreignRing(W,caller,callee,link);assert.ok(got,'delivered');await caller.cancel(caller.sessions.get(got.sid));await W.pump();return got.projection;}

test('R3: a foreign provider asserting a genuine app\'s origin or client_id gets only its own callers muted',async()=>{
 const W=await rtcWorld({providers:[A,B,C]});
 const callee=W.provider(B).device(1);await callee.register();const link=await callee.mintTicket({uses:50,expires_in:86400});
 const genuine=W.provider(A).device(1),evil=W.provider(C).device(1);await genuine.register();await evil.register();const b=W.entity(B,1);
 // Both certificates carry the same client (C merely asserts it); the owner mutes "this app" from C's ring.
 const first=await foreignRing(W,evil,callee,link);assert.equal(first.projection.origin,genuine.grantInfo.origin);assert.equal(first.projection.client_id,genuine.grantInfo.clientId);
 await ownerOp(b,'rtc.mute',{kind:'origin',value:first.projection.origin,issuer:C});
 await ownerOp(b,'rtc.mute',{kind:'app',value:first.projection.client_id,issuer:C});
 assert.equal((await ownerOp(b,'rtc.sessions')).sessions.find(s=>s.sid===first.sid).alert,false,'the C caller is silenced at once');
 assert.equal((await ringOnce(W,evil,callee,link)).alert,false,'new C invites never alert');
 assert.equal((await ringOnce(W,genuine,callee,link)).alert,true,'the genuine app on A still alerts');
 // Unscoped (this host's) app and origin mutes never cover a foreign caller.
 await ownerOp(b,'rtc.mute',{kind:'origin',value:first.projection.origin});await ownerOp(b,'rtc.mute',{kind:'app',value:first.projection.client_id});
 assert.equal((await ringOnce(W,genuine,callee,link)).alert,true);
 const rows=(await ownerOp(b,'rtc.blocked')).muted.map(m=>[m.kind,m.issuer]).sort((x,y)=>JSON.stringify(x)<JSON.stringify(y)?-1:1);
 assert.deepEqual(rows,[['app',C],['app',null],['origin',C],['origin',null]]);
 // Unmute takes the same scope.
 await ownerOp(b,'rtc.unmute',{kind:'origin',value:first.projection.origin,issuer:C});await ownerOp(b,'rtc.unmute',{kind:'app',value:first.projection.client_id,issuer:C});
 assert.equal((await ringOnce(W,evil,callee,link)).alert,true);
 // Strict input: `issuer` only for app and origin mutes, and an origin.
 for(const input of [{kind:'issuer',value:A,issuer:A},{kind:'purpose',value:CALL,issuer:A},{kind:'origin',value:APP,issuer:'not an origin'}]){
  let code=null;try{await ownerOp(b,'rtc.mute',input);}catch(e){code=e.code;}assert.equal(code,'invalid_args',JSON.stringify(input));}
});

test('R3: the same host\'s callers are covered by unscoped app and origin mutes (this host certified them)',async()=>{
 const W=await rtcWorld({providers:[A,B]});
 const callee=W.provider(B).device(1);await callee.register();const link=await callee.mintTicket({uses:50,expires_in:86400});
 const neighbour=W.provider(B).device(2);await neighbour.register();const b=W.entity(B,1);
 const loud=await foreignRing(W,neighbour,callee,link);assert.equal(loud.projection.alert,true);
 await ownerOp(b,'rtc.mute',{kind:'origin',value:loud.projection.origin,issuer:B});// this host's issuer: stored unscoped
 assert.deepEqual((await ownerOp(b,'rtc.blocked')).muted.map(m=>[m.kind,m.issuer]),[['origin',null]]);
 assert.equal((await ringOnce(W,neighbour,callee,link)).alert,false);
});

test('I2: fan-out prefers the caller\'s client_id only for a same-host caller',async()=>{
 const W=await rtcWorld({providers:[A,B]});const P=W.provider(B);
 const asserted=P.device(1);await asserted.register();// the default client, which every fixture caller's certificate names
 W.clock.advance(5000);const other=P.device(1,{grant:P.grant(1,{clientId:'https://other.example/client',origin:'https://other.example'})});await other.register();
 const link=await asserted.mintTicket({uses:10,expires_in:86400});
 const delivered=async sid=>(await W.entity(B,1).store.list({prefix:'rtc/in/'})).values().find(r=>r.sid===sid).delivered;
 // `other` listens (so it stays the most recently active endpoint of the two).
 const caller=W.provider(A).device(1);await caller.register();const foreignCall=await foreignRing(W,caller,other,link);
 assert.deepEqual(await delivered(foreignCall.sid),[other.endpoint,asserted.endpoint],'a foreign certificate\'s client_id is not preferred: most recently active first');
 const local=P.device(2);await local.register();const localCall=await foreignRing(W,local,other,link);
 assert.deepEqual(await delivered(localCall.sid),[asserted.endpoint,other.endpoint],'a same-host caller\'s own app first');
});

test('I5: mint_ticket is rate limited per app',async()=>{
 const h=await rtcHost();const b=h.device(2);await b.register();
 let n=0;for(let i=0;i<LIMITS.mint.max+5;i++){if(await fault(b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:1})))break;n++;if(i%50===49)h.clock.advance(2000);}
 assert.equal(n,LIMITS.mint.max);
 const other=h.device(2,{grant:h.grant(2,{clientId:OTHER_APP+'/client',origin:OTHER_APP})});await other.register();
 assert.ok(await other.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:1}),'another app is unaffected');
 h.clock.advance(3600001);assert.ok(await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:1}),'the window resets');
});
