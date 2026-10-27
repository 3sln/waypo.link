// RTC-d engine tests (docs/spec/rtc-signaling.md §4–§14; design §8.1 RTC-d, §8.2). Every call is a dispatched ngin
// Action or Query on a loopback host (tests/helpers/rtc-fixture.mjs); the same-host transport runs the real §8.2
// verification path. Local behaviour only: nothing here asserts foreign delivery, relay, push or production readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rtcHost,CALL,SYNC,FILES,SCREEN,REF,ISS,APP,OTHER_APP,DAY,subOf,identityOf,fault,rejects,relay,host as hostCandidate,rawHost,srflx,sdp,payloadOf} from './helpers/rtc-fixture.mjs';
import {transition,canTransition,decideClaim,offerSeq,newLeg,gapExpired,dueEvent,SESSION_STATES,SESSION_EVENTS,ORDER_LIMITS,RTC_BOUNDS,RING_MAX_MS} from '../packages/rtc/sessions.mjs';
import {takeLimits,LIMITS} from '../packages/rtc/admission.mjs';
import {signRtcJws,RTC_MESSAGE_TYP} from '../packages/rtc/jws.mjs';
import {buildBatch,linkDigest} from '../packages/rtc/messages.mjs';
import {exportInventory,createExportContributors} from '../packages/runtime/export-contributors.mjs';
import {signLegCertificate,signMessage} from '../packages/rtc/certificates.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {RTC_NEVER_GATED,RTC_ENDPOINT_OPERATIONS,RTC_OWNER_OPERATIONS,RTC_SYSTEM_OPERATIONS,RTC_WIDENING} from '../packages/app/domains/rtc.mjs';
import {PROVIDERS} from '../packages/app/providers.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const MIN=60000;
/** A connected cross-entity session: A (entity 1) calls B (entity 2) through B's ticket. */
async function connected(h,{purpose=CALL,media=['audio','video'],a=h.device(1),b=h.device(2),uses=4}={}){
 if(!a.endpoint)await a.register();if(!b.endpoint)await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[purpose],uses,expires_in:3600});
 const s=await a.open(h.principal(b.n),purpose,{media,basis:link});await a.invite(s);await h.pump();
 await b.listen();const c=await b.claim(s.sid);await b.accept(c);await h.pump();await a.listen();
 return {a,b,s,c,link};
}
const types=events=>events.map(e=>e.type==='message'?payloadOf(e.message).type:e.type==='state'?`state:${e.state}`:e.type);
const samePrincipalOf=(p,n)=>p.sub===subOf(n);
const record=async(h,n,prefix)=>(await h.rows(n,prefix)).map(([,v])=>v);

test('catalogue, classification and the provider row',()=>{
 assert.equal(PROVIDERS.rtc.placement,'account');
 const names=new Set([...RTC_ENDPOINT_OPERATIONS,...RTC_OWNER_OPERATIONS,...RTC_SYSTEM_OPERATIONS].map(O=>O.operation));
 for(const name of RTC_NEVER_GATED)assert.ok(names.has(name),name);
 for(const name of RTC_WIDENING)assert.ok(!RTC_NEVER_GATED.includes(name),name);
 for(const O of RTC_SYSTEM_OPERATIONS)assert.equal(O.lifecycle,'suspended');
});

test('state machine: every legal transition and every illegal one',()=>{
 const legal={ringing:['claim-accept','claim-decline','answer-accept','answer-decline','cancel','timeout','expire','control','revoke','fail','block'],connected:['cancel','end','expire','control','revoke','fail'],ended:[]};
 for(const state of SESSION_STATES)for(const event of SESSION_EVENTS){
  assert.equal(canTransition(state,event),legal[state].includes(event),`${state} ${event}`);
  const rec={state};if(legal[state].includes(event))transition(rec,event,{now:5});else assert.throws(()=>transition(rec,event,{now:5}),e=>e.code==='rtc_illegal_transition');
 }
 // A cancel before the claim is `cancelled`; after it, `hangup` (spec §7.4).
 assert.equal(transition({state:'ringing'},'cancel',{now:1}).endReason,'cancelled');assert.equal(transition({state:'connected'},'cancel',{now:1}).endReason,'hangup');
 assert.equal(dueEvent({state:'ringing',ringUntil:10,endsAt:100},10),'timeout');assert.equal(dueEvent({state:'connected',ringUntil:10,endsAt:100},50),null);assert.equal(dueEvent({state:'connected',ringUntil:10,endsAt:100},100),'expire');
});

test('first claim: exactly one winner, repeats by the winner, refusal for others and the undelivered',()=>{
 const rec={state:'ringing',delivered:['e1','e2'],claim:null,ringUntil:100,endsAt:1000};
 assert.deepEqual(decideClaim(rec,{endpoint:'e3',jkt:'k3',outcome:'accept',now:1}),{won:false,code:'not_delivered'});
 assert.deepEqual(decideClaim(rec,{endpoint:'e1',jkt:'k1',outcome:'accept',now:1}),{won:true,repeat:false});
 assert.deepEqual(decideClaim(rec,{endpoint:'e1',jkt:'k1',outcome:'accept',now:2}),{won:true,repeat:true});
 assert.deepEqual(decideClaim(rec,{endpoint:'e2',jkt:'k2',outcome:'accept',now:2}),{won:false,code:'claimed'});
 assert.deepEqual(decideClaim(rec,{endpoint:'e1',jkt:'kX',outcome:'accept',now:2}),{won:false,code:'claimed'});
 const late={state:'ringing',delivered:['e1'],claim:null,ringUntil:100,endsAt:1000};assert.equal(decideClaim(late,{endpoint:'e1',jkt:'k',outcome:'accept',now:100}).code,'claimed');
});

test('ordering window: duplicates by payload bytes, different content fails, buffer bound and gap timeout',()=>{
 const leg=newLeg();
 assert.equal(offerSeq(leg,{seq:0,digest:'a',compact:'x.a.s1',now:0}).action,'deliver');
 assert.equal(offerSeq(leg,{seq:0,digest:'a',compact:'x.a.s2',now:0}).action,'duplicate');// another signature, same bytes
 assert.equal(offerSeq(leg,{seq:0,digest:'b',compact:'x.b.s',now:0}).action,'fail');
 assert.equal(offerSeq(leg,{seq:2,digest:'c',compact:'2',now:5}).action,'buffer');
 assert.equal(offerSeq(leg,{seq:2,digest:'c',compact:'2',now:6}).action,'duplicate');assert.equal(offerSeq(leg,{seq:2,digest:'d',compact:'2',now:6}).action,'fail');
 const r=offerSeq(leg,{seq:1,digest:'e',compact:'1',now:7});assert.deepEqual(r.ready.map(x=>x.seq),[1,2]);assert.equal(leg.gapSince,null);
 const gap=newLeg();offerSeq(gap,{seq:0,digest:'a',compact:'0',now:0});
 for(let i=2;i<2+ORDER_LIMITS.buffer;i++)assert.equal(offerSeq(gap,{seq:i,digest:String(i),compact:String(i),now:0}).action,'buffer');
 assert.equal(offerSeq(gap,{seq:40,digest:'z',compact:'z',now:0}).action,'fail','33rd buffered message');
 assert.equal(gapExpired(gap,ORDER_LIMITS.gapMs),false);assert.equal(gapExpired(gap,ORDER_LIMITS.gapMs+1),true);
});

test('fixed-window limits are all-or-nothing and expire with the window',async()=>{
 const db=new SqliteMetadata(':memory:');
 await db.transaction(async tx=>{for(let i=0;i<LIMITS.pair.max;i++)assert.equal(await takeLimits(tx,[{name:'pair',parts:['p']},{name:'callee',parts:[]}],0),true);
  assert.equal(await takeLimits(tx,[{name:'callee',parts:[]},{name:'pair',parts:['p']}],0),false);
  // The refused attempt counted nothing: the callee window still has room for other pairs.
  assert.equal(await takeLimits(tx,[{name:'pair',parts:['q']},{name:'callee',parts:[]}],0),true);
  assert.equal(await takeLimits(tx,[{name:'pair',parts:['p']}],LIMITS.pair.windowMs),true);});
 for(const [key] of await db.list({prefix:'rtc/limit/'}))assert.doesNotMatch(key,/https|0a0a/,'limit keys reveal only a hash');
 db.close();
});

test('cross-user call on one host: ticket basis, fan-out, claim, answer, relay candidates and hangup',async()=>{
 const h=await rtcHost();const b2=h.device(2,{grant:h.grant(2)});await b2.register();
 const {a,b,s,c}=await connected(h,{b:h.device(2)});
 // Fan-out reached both of B's eligible endpoints; the loser learns only "claimed".
 await b2.listen();assert.deepEqual(types(b2.events),['invite','state:claimed']);
 assert.deepEqual(types(a.events),['accept']);assert.ok(a.events[0].certificate,'the callee certificate travels with its first message');
 // The callee's projection never carries the basis link; the leg certificate names the caller app origin (RTC-17).
 const invite=b.events.find(e=>e.type==='invite');assert.equal(invite.projection.basis,'link');assert.equal(invite.projection.origin,APP);assert.equal(JSON.stringify(invite).includes('rtc/t/'),false);
 await a.candidates(s,[relay()]);await b.candidates(c,[relay('198.51.100.20')]);await h.pump();
 await a.listen();await b.listen();assert.deepEqual(types(b.events).slice(-1),['candidates']);assert.deepEqual(types(a.events).slice(-1),['candidates']);
 await a.end(s);await h.pump();await b.listen();assert.deepEqual(types(b.events).slice(-2),['end','state:ended']);
 assert.equal((await h.run(1,'rtc.sessions')).sessions.length,0);assert.equal((await h.run(2,'rtc.sessions')).sessions.length,0);
 assert.equal((await h.run(2,'rtc.tickets')).tickets[0].usesLeft,3);
});

test('relay-only default between users (RTC-6), opt-in public, raw host only between own devices',async()=>{
 const h=await rtcHost();const {a,s,b,c}=await connected(h);
 for(const item of [hostCandidate(),srflx(),rawHost()])await rejects(a.candidates(s,[item]),'invalid_args','relay-only blocks '+item.candidate.split(' ')[7]);
 await h.run(1,'rtc.set-policy',{input:{other:'public'}});
 // The policy is captured per session at open; a new session sends mDNS host and srflx candidates.
 const second=await connected(h,{a:h.device(1),b:h.device(2)});
 await second.a.candidates(second.s,[hostCandidate(),srflx()]);await rejects(second.a.candidates(second.s,[rawHost()]),'invalid_args');
 // Own devices may use raw host addresses (`all` default).
 const d1=h.device(3),d2=h.device(3);await d1.register();await d2.register();
 const own=await d1.open(h.principal(3),SYNC,{media:['data']});await d1.invite(own);await h.pump();await d2.listen();
 const oc=await d2.claim(own.sid);await d2.accept(oc);await h.pump();await d1.listen();
 assert.deepEqual(await d1.candidates(own,[rawHost()]),{accepted:1});
 assert.ok(b&&c);
});

test('own-entity sessions: self basis, no echo to the caller endpoint, target, auto-accept projection',async()=>{
 const h=await rtcHost();const [d1,d2,d3]=[h.device(1),h.device(1),h.device(1)];for(const d of [d1,d2,d3])await d.register();
 await h.run(1,'rtc.set-policy',{input:{autoAccept:{[APP+'/client']:[SYNC]}}});
 const s=await d1.open(h.principal(1),SYNC,{media:['data'],target:d3.endpoint});await d1.invite(s);await h.pump();
 for(const d of [d1,d2,d3])await d.listen();
 assert.equal(d1.claims().length,0,'the caller endpoint never receives its own invite');assert.equal(d2.claims().length,0,'target restricts fan-out');
 const inv=d3.claims()[0];assert.equal(inv.projection.basis,'self');assert.equal(inv.projection.auto_accept,true);assert.equal(inv.projection.alert,false);
 const c=await d3.claim(s.sid);await d3.accept(c);await h.pump();await d1.listen();assert.deepEqual(types(d1.events),['accept']);
 // device-sync is own-devices only; a call between own devices is fine.
 await rejects(d1.open(h.principal(2),SYNC,{media:['data']}),'invalid_args');
 const call=await d1.open(h.principal(1),CALL);await d1.invite(call);await h.pump();await d2.listen();assert.equal(d2.claims().at(-1).projection.auto_accept,false,'call never auto-accepts');
 await d1.listen();assert.equal(d1.claims().length,0,'no echo without a target either');
 // Auto-accept only when the caller's application is the claiming endpoint's application.
 const otherApp=h.device(1,{purposes:[SYNC],grant:h.grant(1,{clientId:OTHER_APP+'/c',origin:OTHER_APP,purposes:[SYNC]})});await otherApp.register([SYNC]);
 await h.run(1,'rtc.set-policy',{input:{autoAccept:{[APP+'/client']:[SYNC],[OTHER_APP+'/c']:[SYNC]}}});
 const sync=await d1.open(h.principal(1),SYNC,{media:['data']});await d1.invite(sync);await h.pump();await otherApp.listen();await d2.listen();
 assert.equal(otherApp.claims().at(-1).projection.auto_accept,false,'another application never auto-accepts');assert.equal(d2.claims().at(-1).projection.auto_accept,true);
 await rejects(d1.open(h.principal(1),SYNC,{media:['data'],target:d1.endpoint}),'invalid_args','a target is another device');
 // Both records live in the one writer; ending one ends its twin.
 await d1.end(s);await h.pump();await d3.listen();assert.deepEqual(types(d3.events).slice(-2),['end','state:ended'],'the other own device is told');const recs=[...await record(h,1,'rtc/out/'),...await record(h,1,'rtc/in/')].filter(r=>r.sid===s.sid);assert.deepEqual(recs.map(r=>r.state),['ended','ended']);
});

test('illegal transitions at the engine: candidates before the claim, answers without a claim, ended sessions',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2),b2=h.device(2);await a.register();await b.register();await b2.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:4,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});
 // Nothing but the invite or cancel travels before the claim (no address before the claim, RTC-5).
 await rejects(a.send(s,[await a.sign(s,'candidates',{gen:0,items:[relay()],complete:false},{seq:1,to:s.leg.jkt})]),'invalid_args');
 await a.invite(s);await h.pump();await b.listen();await b2.listen();
 await rejects(a.send(s,[await a.sign(s,'candidates',{gen:0,items:[relay()],complete:false},{seq:1,to:s.leg.jkt})]),'invalid_args','candidates before any answer');
 await rejects(a.send(s,[await a.sign(s,'end',{reason:'hangup'},{seq:1,to:s.leg.jkt})]),'invalid_args','end is not a pre-claim message');
 await rejects(a.send(s,[await a.sign(s,'cancel',{},{seq:3})]),'invalid_args','out of order');
 const c=await b.claim(s.sid,'accept');
 assert.equal((await fault(b2.claim(s.sid,'accept'))).code,'claimed');assert.equal((await fault(b2.claim(s.sid,'decline'))).code,'claimed');
 const stranger=h.device(2);await stranger.register();assert.equal((await fault(stranger.claim(s.sid))).status,404,'not delivered: uniform 404');
 await rejects(b.send(c,[await b.sign(c,'decline',{reason:'declined'},{seq:0})]),'invalid_args','the answer must match the claim');
 await b.accept(c);await h.pump();await a.listen();
 await a.end(s);await h.pump();
 assert.deepEqual(await a.end(s),{accepted:0},'a message for an ended session is ignored');
 await b.listen();assert.equal(b.events.at(-1).state,'ended');
});

test('decline: the session ends for every callee device and at the caller; nobody learns which device',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2),b2=h.device(2);await a.register();await b.register();await b2.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();await b2.listen();
 h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');// a decline is narrowing: never gated
 const c=await b.claim(s.sid,'decline');await b.decline(c);await h.pump();h.flags.allow(subOf(2),'RTC_SIGNALING_ENABLED');
 await b2.listen();await a.listen();assert.deepEqual(types(b2.events),['invite','state:claimed']);assert.deepEqual(types(a.events),['decline']);
 const out=(await record(h,1,'rtc/out/'))[0];assert.equal(out.state,'ended');assert.equal(out.endReason,'declined');
 assert.equal((await h.run(2,'rtc.missed')).missed.length,0,'an answered invite is not missed');
});

test('cancel crossing an accept converges to ended at both providers (§7.4)',async()=>{
 const h=await rtcHost({hold:true});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:2,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.flushNetwork();await b.listen();
 const c=await b.claim(s.sid);await b.accept(c);await a.cancel(s);
 // Deliver the accept to A after A's cancel, and the cancel to B after B's claim.
 await h.flushNetwork();await h.pump();await h.flushNetwork();
 const out=(await record(h,1,'rtc/out/'))[0],inn=(await record(h,2,'rtc/in/'))[0];
 assert.equal(out.state,'ended');assert.equal(inn.state,'ended');assert.ok(['hangup','failed'].includes(inn.endReason),inn.endReason);
 await b.listen();assert.ok(types(b.events).includes('state:ended'));
 // A later accept by another callee leg is answered with a control statement `failed`.
 assert.ok(h.log.batches.some(x=>JSON.parse(x.batch).controls.length>0)||inn.endReason==='hangup');
});

test('an accept reaching the caller after its cancel gets a control statement end(failed)',async()=>{
 const h=await rtcHost({hold:true});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:2,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.flushNetwork();await b.listen();
 await a.cancel(s);await h.drainAll();const cancelBatch=h.network.splice(0);
 const c=await b.claim(s.sid);await b.accept(c);await h.flushNetwork();// accept reaches A, whose session is cancelled
 await h.pump();await h.flushNetwork();// A's control statement reaches B
 const inn=(await record(h,2,'rtc/in/'))[0];assert.equal(inn.state,'ended');assert.equal(inn.endReason,'failed');
 await b.listen();const ended=b.events.find(e=>e.type==='state'&&e.state==='ended');assert.ok(ended.control,'the control statement is delivered with the state');
 assert.equal(payloadOf(ended.control).leg,c.leg.jkt);assert.equal(payloadOf(ended.control).reason,'failed');
 for(const item of cancelBatch)await h.ingest(2,item.input.batch);// the late cancel changes nothing
 assert.equal((await record(h,2,'rtc/in/'))[0].endReason,'failed');
});

test('admission refusals are silent: no basis, contact links, quarantine, block, principal-bound tickets, approval',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2),c3=h.device(3);await a.register();await b.register();await c3.register();
 const call=async(device,to,opts={})=>{const s=await device.open(h.principal(to),CALL,opts);await device.invite(s);await h.pump();return s;};
 // `none` basis: off by default; nothing is recorded or delivered.
 await call(a,2);await b.listen();assert.equal(b.claims().length,0);assert.equal((await record(h,2,'rtc/in/')).length,0);
 // On: held (never delivered or alerting), listed for the owner.
 await h.run(2,'rtc.set-policy',{input:{requests:[CALL]}});await call(a,2);await b.listen();assert.equal(b.claims().length,0);
 assert.deepEqual((await h.run(2,'rtc.missed')).missed.map(m=>m.kind),['held']);
 // A contact link verifies only with owner-side RTC configuration for the purpose.
 const contact=`${ISS}/users/user2/contact/c1?bindle_meta=a.b.c`;h.contacts.set(contact,{owner:subOf(2),parent:'grant-1'});
 await call(a,2,{basis:contact});await b.listen();assert.equal(b.claims().length,0,'no RTC configuration');
 await h.run(2,'rtc.set-contact-rtc',{input:{parent:'grant-1',purposes:[CALL]}});await call(a,2,{basis:contact});await b.listen();assert.equal(b.claims().length,1);
 // Quarantined parent: answered and processed, then held without ringing.
 h.contacts.set(contact,{owner:subOf(2),parent:'grant-1',quarantined:true});await call(c3,2,{basis:contact});await b.listen();assert.equal(b.claims().length,1);
 // Blocked principal: dropped, never recorded as missed.
 await h.run(2,'rtc.block',{input:{principal:h.principal(3)}});h.contacts.set(contact,{owner:subOf(2),parent:'grant-1'});const before=(await h.run(2,'rtc.missed')).missed.length;
 await call(c3,2,{basis:contact});await b.listen();assert.equal(b.claims().length,1);assert.equal((await h.run(2,'rtc.missed')).missed.length,before);
 // Blocking a caller whose invite is ringing ends it without listing it as missed.
 await h.run(2,'rtc.unblock',{input:{principal:h.principal(3)}});await call(c3,2,{basis:contact});await b.listen();const ringingFrom3=b.claims().length;assert.equal(ringingFrom3,2);
 const from3=async()=>(await h.run(2,'rtc.missed')).missed.filter(m=>m.kind==='missed'&&samePrincipalOf(m.caller,3)).length,missedBefore=await from3();await h.run(2,'rtc.block',{input:{principal:h.principal(3)}});
 h.clock.advance(3*MIN);await h.tickAll();assert.equal(await from3(),missedBefore,'a blocked caller is never listed');
 assert.equal((await record(h,2,'rtc/in/')).filter(r=>samePrincipalOf(r.caller,3)).at(-1).endReason,'blocked');
 // A principal-bound ticket admits only that VERIFIED principal and spends nothing otherwise.
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600,principal:h.principal(1)});
 const base=b.claims().length;
 await h.run(2,'rtc.unblock',{input:{principal:h.principal(3)}});await call(c3,2,{basis:link});await b.listen();assert.equal(b.claims().length,base);
 assert.equal((await h.run(2,'rtc.tickets')).tickets.find(t=>t.principal).usesLeft,1,'a refused invite spends no use');
 await call(a,2,{basis:link});await b.listen();assert.equal(b.claims().length,base+1);
 // A ticket for another purpose, a revoked ticket and an exhausted one admit nothing.
 const files=await b.run('rtc.mint-ticket',{purposes:[FILES],uses:3,expires_in:3600});await call(a,2,{basis:files.link});await b.listen();assert.equal(b.claims().length,base+1);
 await call(a,2,{basis:link});await b.listen();assert.equal(b.claims().length,base+1,'exhausted');
 const t2=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});await h.run(2,'rtc.revoke-ticket',{input:{jti:payloadOf(new URL(t2.link).searchParams.get('bindle_meta')).jti}});await call(a,2,{basis:t2.link});await b.listen();assert.equal(b.claims().length,base+1,'revoked');
});

test('a ticket verifies only as the exact stored meta, even without a recorded public key',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600});
 // Someone who learned only the jti (the owner's ticket view names it) cannot mint a working link for it.
 const jti=payloadOf(new URL(link).searchParams.get('bindle_meta')).jti,key='rtc/ticket/'+jti,row=await h.account(2).store.get(key);delete row.publicJwk;await h.account(2).store.put(key,row);
 // Same jti and audience, signed by someone else: refused, and the genuine use is not spent.
 const {signLinkJWS}=await import('../packages/links/envelope.mjs'),stranger=await (await import('./helpers/rtc-wire-fixture.mjs')).keyPair();
 const meta=await signLinkJWS({header:{alg:'ES256',kid:'x',typ:'bindle-link-meta+jwt'},claims:{...row.claims},privateKey:stranger.privateKey});
 const forged=`${row.claims.aud}?bindle_meta=${meta}`;const s=await a.open(h.principal(2),CALL,{basis:forged});await a.invite(s);await h.pump();await b.listen();
 assert.equal(b.claims().length,0);assert.equal((await h.account(2).store.get(key)).usesLeft,1);
});

test('ticket uses under concurrent invites: exactly `uses` admitted',async()=>{
 const h=await rtcHost({entities:6});const b=h.device(1);await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:2,expires_in:3600});
 const callers=[2,3,4,5,6].map(n=>h.device(n));for(const d of callers)await d.register();
 h.net.hold=true;for(const d of callers){const s=await d.open(h.principal(1),CALL,{basis:link});await d.invite(s);}await h.drainAll();
 await Promise.all(h.network.splice(0).map(item=>h.ingest(1,item.input.batch)));
 assert.equal((await record(h,1,'rtc/in/')).length,2);assert.equal((await h.run(1,'rtc.tickets')).tickets[0].usesLeft,0);
});

test('approval: unapproved purposes, unapproved callee apps and muting',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2,{purposes:[FILES]}),other=h.device(2,{purposes:[CALL],grant:h.grant(2,{clientId:OTHER_APP+'/c',origin:OTHER_APP,purposes:[CALL]})});
 await a.register();await b.register();await other.register();
 assert.equal((await fault(b.register([CALL]))).code,'forbidden','registering an unapproved purpose');
 const narrow=h.device(1,{grant:h.grant(1,{purposes:[FILES]})});await narrow.register([FILES]);assert.equal((await fault(narrow.open(h.principal(2),CALL))).code,'forbidden');
 await rejects(a.open(h.principal(2),CALL,{media:['screen']}),'invalid_args','media outside the purpose');
 const {link}=await other.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});
 // B's endpoint is not registered for call; only the other app's endpoint is eligible.
 let s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();await other.listen();assert.equal(b.claims().length,0);assert.equal(other.claims().length,1);assert.equal(other.claims()[0].projection.alert,true);
 // Revoking the other app's grant makes it ineligible at once (the live bound check).
 await h.run(2,'rtc.mute',{input:{kind:'principal',value:h.principal(1)}});s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await other.listen();assert.equal(other.claims().at(-1).projection.alert,false,'muted: delivered without alert');
 h.grants.get(other.grantInfo.id).active=false;s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await other.listen().catch(()=>null);
 assert.equal((await record(h,2,'rtc/in/')).at(-1).delivered.length,0);
 assert.equal((await fault(other.claim(s.sid))).status,404);
});

test('budgets: caller open sessions and opens per hour, callee ringing, pair limits, held requests',async()=>{
 const h=await rtcHost({entities:4});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1000,expires_in:3600});
 const opened=[];for(let i=0;i<RTC_BOUNDS.callerOpen;i++)opened.push(await a.open(h.principal(2),CALL,{basis:link}));
 assert.equal((await fault(a.open(h.principal(2),CALL,{basis:link}))).code,'rate_limited','8 open as caller');
 for(const s of opened.slice(0,5))await a.invite(s);await h.pump();await b.listen();
 assert.equal(b.claims().length,RTC_BOUNDS.calleeRinging,'4 ringing per callee; the 5th is dropped silently');
 h.clock.advance(3*MIN);await h.tickAll();assert.equal((await record(h,1,'rtc/out/')).filter(r=>r.state!=='ended').length,0,'uninvited and unanswered sessions time out');
 // Pair limit: 6 invites per (caller, callee) per 10 minutes, counted after verification.
 const pairStart=(await record(h,2,'rtc/in/')).length;h.clock.advance(11*MIN);
 for(let i=0;i<8;i++){const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await a.cancel(s);await h.pump();}
 assert.equal((await record(h,2,'rtc/in/')).length-pairStart,LIMITS.pair.max);
 // 60 opens per hour per caller entity.
 h.clock.advance(61*MIN);let refused=0;for(let i=0;i<70;i++){const r=await fault(a.open(h.principal(2),CALL,{basis:link}).then(async s=>{await a.invite(s);await a.cancel(s);await h.pump();}));if(r?.code==='rate_limited')refused++;else assert.equal(r,null);}assert.equal(refused,10);
 // Held requests are bounded per callee (32) and per sending issuer (20 per hour). RTC wargame M1: a same-host
 // caller's issuer window is a per-principal share (this host's principals are verified accounts), so 40 same-host
 // callers are bounded by the held cap. Excess is dropped silently.
 await h.run(2,'rtc.set-policy',{input:{requests:[CALL]}});const callers=[];for(let n=5;n<5+40;n++){await h.add(n);const d=h.device(n);await d.register();callers.push(d);}
 for(const d of callers){const s=await d.open(h.principal(2),CALL);await d.invite(s);}await h.pump();
 assert.equal((await record(h,2,'rtc/in/')).filter(r=>r.held&&r.state==='ringing').length,RTC_BOUNDS.heldRequests);
});

test('sequence reuse: duplicate bytes ignored, another signature is the same content, different bytes end the leg',async()=>{
 const h=await rtcHost();const {a,b,s,c}=await connected(h);
 const m=await a.sign(s,'candidates',{gen:0,items:[relay()],complete:false});
 assert.deepEqual(await a.send(s,[m]),{accepted:1});assert.deepEqual(await a.send(s,[m]),{accepted:0},'the same JWS again');
 const claims=payloadOf(m),resigned=await (await import('../packages/rtc/certificates.mjs')).signMessage(claims,s.leg.privateKey);
 assert.notEqual(resigned,m);assert.deepEqual(await a.send(s,[resigned]),{accepted:0},'a second signature over the same payload bytes is a duplicate');
 await h.pump();await b.listen();assert.equal(types(b.events).filter(t=>t==='candidates').length,1,'delivered once');
 assert.equal((await record(h,1,'rtc/out/'))[0].state,'connected','a duplicate never ends the leg');assert.equal((await record(h,2,'rtc/in/'))[0].state,'connected');
 // Equal JSON, different bytes (members reordered): different content, the leg ends `failed`.
 const {body,...rest}=claims,reordered=await signRtcJws({typ:RTC_MESSAGE_TYP,kid:claims.leg,claims:{body,...rest},privateKey:s.leg.privateKey});
 assert.deepEqual(await a.send(s,[reordered]),{accepted:0});await h.pump();
 const out=(await record(h,1,'rtc/out/'))[0];assert.equal(out.state,'ended');assert.equal(out.endReason,'failed');
 await b.listen();assert.equal(b.events.at(-1).state,'ended');assert.equal(payloadOf(b.events.at(-1).control).reason,'failed');
 assert.ok(c);
});

test('receiver ordering: duplicated, reordered and lost deliveries; the 10 s gap ends the leg',async()=>{
 const h=await rtcHost();const {a,b,s}=await connected(h);h.net.hold=true;
 for(const addr of ['203.0.113.1','203.0.113.2','203.0.113.3'])await a.candidates(s,[relay(addr)]);
 const [m1,m2,m3]=(await h.held());
 await h.ingest(2,m3.input.batch);await h.ingest(2,m2.input.batch);await h.ingest(2,m2.input.batch);await b.listen();assert.equal(types(b.events).filter(t=>t==='candidates').length,0,'buffered behind the gap');
 await h.ingest(2,m1.input.batch);await h.ingest(2,m1.input.batch);await b.listen();
 assert.deepEqual(b.events.filter(e=>e.type==='message').slice(-3).map(e=>payloadOf(e.message).body.items[0].candidate.split(' ')[4]),['203.0.113.1','203.0.113.2','203.0.113.3']);
 await a.candidates(s,[relay('203.0.113.4')]);await a.candidates(s,[relay('203.0.113.5')]);const [lost,late]=(await h.held());await h.ingest(2,late.input.batch);assert.ok(lost);
 h.clock.advance(ORDER_LIMITS.gapMs+1000);h.net.hold=false;await h.tick(2);await h.pump();
 assert.equal((await record(h,2,'rtc/in/'))[0].endReason,'failed');assert.equal((await record(h,1,'rtc/out/'))[0].state,'ended','the caller gets the control statement');
});

test('expiry: ring timeout (missed), SDP bound, 24 h session cap, record retention, idle endpoints',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:10,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.send(s,[await a.sign(s,'invite',a.inviteBody(s,{offer:sdp(['audio','video']),ring_until:Math.floor(h.clock.now()/1000)+120}))]);await h.pump();
 assert.equal((await h.rows(2,'rtc/epq/')).length,1);h.clock.advance(61000);await h.tick(2);assert.equal((await h.rows(2,'rtc/epq/')).length,0,'an invite with an SDP offer is deleted after 60 s');
 h.clock.advance(60000);await h.tickAll();await b.listen();assert.deepEqual(types(b.events),['state:expired']);
 assert.equal((await record(h,1,'rtc/out/'))[0].endReason,'timeout');assert.deepEqual((await h.run(2,'rtc.missed')).missed.map(m=>[m.kind,m.purpose]),[['missed',CALL]]);
 assert.equal((await fault(b.claim(s.sid))).code,'claimed','too late to claim');
 const live=await connected(h,{a,b});h.clock.advance(DAY);await h.tickAll();
 assert.equal((await record(h,1,'rtc/out/')).find(r=>r.sid===live.s.sid).endReason,'expired');assert.equal((await record(h,2,'rtc/in/')).find(r=>r.sid===live.s.sid).endReason,'expired');
 assert.ok((await h.rows(1,'rtc/dlg/')).length>0,'delegates outlive the session (reuse refusal window)');
 h.clock.advance(DAY+1);await h.tickAll();assert.equal((await h.rows(1,'rtc/out/')).length,0,'records go 24 h after the end');assert.equal((await h.rows(2,'rtc/in/')).length,0);
 h.clock.advance(31*DAY);await h.tickAll();assert.equal((await h.rows(2,'rtc/ep/')).length,0,'idle endpoints expire');assert.equal((await h.rows(2,'rtc/missed/')).length,0,'missed list: 30 days');assert.equal((await h.rows(1,'rtc/dlg/')).length,0);
});

test('flag off: nothing new is reachable; narrowing and reads of existing state still work',async()=>{
 const h=await rtcHost({flags:{RTC_SIGNALING_ENABLED:false}});const a=h.device(1),b=h.device(2);
 assert.equal((await fault(a.register())).status,404);
 for(const [op,input] of [['rtc.set-policy',{other:'public'}],['rtc.set-contact-rtc',{parent:'p',purposes:[CALL]}],['rtc.unblock',{principal:h.principal(3)}]])assert.equal((await fault(h.run(1,op,{input}))).status,404,op);
 // Narrowing works: block, mute, end-session (of nothing), clear missed; reads work.
 await h.run(1,'rtc.block',{input:{principal:h.principal(3)}});await h.run(1,'rtc.set-policy',{input:{other:'relay'}});assert.ok((await h.run(1,'rtc.policy')).enabled===false);
 // Existing state: turn the flag on for registration and a session, then off again.
 h.flags.state.names.RTC_SIGNALING_ENABLED=true;const {s,c}=await connected(h,{a,b});const s2=await a.open(h.principal(2),CALL,{basis:(await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:60})).link});h.flags.state.names.RTC_SIGNALING_ENABLED=false;
 assert.equal((await fault(a.open(h.principal(2),CALL))).status,404);assert.equal((await fault(b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:60}))).status,404);
 assert.equal((await fault(a.candidates(s,[relay()]))).status,404);assert.equal((await fault(a.run('rtc.renew',{...a.auth(),sid:s.sid}))).status,404);
 await a.invite(s2).catch(()=>null);await h.pump();await b.listen();assert.equal(b.claims().length,1,'a new invite is not admitted while off');
 await b.end(c);await h.pump();await a.listen();assert.deepEqual(types(a.events).slice(-2),['end','state:ended'],'ending an existing session works while off');
 assert.ok((await b.run('rtc.endpoints')).endpoints.length===1);await a.run('rtc.unregister',a.auth());
 // Ingest of a valid invite while the callee's flag is off creates nothing.
 h.flags.state.names.RTC_SIGNALING_ENABLED=true;h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');const a2=h.device(1);await a2.register();
 const t=await (async()=>{h.flags.allow(subOf(2),'RTC_SIGNALING_ENABLED');const r=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:600});h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');return r;})();
 const before=(await h.rows(2,'rtc/in/')).length;const s3=await a2.open(h.principal(2),CALL,{basis:t.link});await a2.invite(s3);await h.pump();assert.equal((await h.rows(2,'rtc/in/')).length,before);
 assert.equal((await h.run(2,'rtc.tickets')).tickets.find(x=>x.uses===5).usesLeft,5);
});

test('tickets need RTC_TICKETS_ENABLED to mint; existing tickets still admit; callbacks reach only the claimant',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2),b2=h.device(2);await a.register();await b.register();await b2.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:3,expires_in:3600});
 h.flags.state.names.RTC_TICKETS_ENABLED=false;assert.equal((await fault(b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:60}))).status,404);
 assert.equal((await fault(a.open(h.principal(2),CALL,{basis:link,callback:true}))).status,404);
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();assert.equal(b.claims().length,1,'existing tickets admit');
 h.flags.state.names.RTC_TICKETS_ENABLED=true;
 const s2=await a.open(h.principal(2),CALL,{basis:link,callback:true});assert.ok(s2.result.callback);await a.invite(s2);await h.pump();await b.listen();await b2.listen();
 for(const e of [...b.events,...b2.events])assert.equal(JSON.stringify(e).includes(s2.result.callback),false,'never in an invite event');
 const c=await b2.claim(s2.sid);assert.equal(c.result.callback,s2.result.callback);
 // The callback ticket is one use, bound to the callee, ≤ 24 h, and admits B ringing A back.
 const view=(await h.run(1,'rtc.tickets')).tickets.find(t=>t.callback);assert.deepEqual([view.uses,view.principal.sub,view.expiresAt-h.clock.now()<=DAY],[1,subOf(2),true]);
 const back=await b2.open(h.principal(1),CALL,{basis:c.result.callback});await b2.invite(back);await h.pump();await a.listen();assert.equal(a.claims().length,1);
});

test('endpoint binding: the secret or the DPoP key, never the identifier alone',async()=>{
 const h=await rtcHost();const a=h.device(1),d=h.device(1,{dpop:true});const out=await a.register();assert.ok(out.endpoint_secret);
 const dp=await d.register();assert.equal(dp.endpoint_secret,undefined);
 assert.equal((await fault(a.run('rtc.listen',{endpoint:a.endpoint}))).status,404);
 assert.equal((await fault(a.run('rtc.listen',{endpoint:a.endpoint,endpoint_secret:'x'.repeat(43)}))).status,404);
 assert.equal((await fault(h.run(1,'rtc.listen',{actor:{...d.actor,jkt:a.actor.jkt??(await import('./helpers/rtc-wire-fixture.mjs').then(m=>m.keyPair())).jkt},input:{endpoint:d.endpoint}}))).status,404);
 await d.listen();await a.listen();
 // Another application's actor cannot use the endpoint even with its secret.
 const other=h.device(1,{grant:h.grant(1,{clientId:OTHER_APP+'/c',origin:OTHER_APP})});assert.equal((await fault(h.run(1,'rtc.listen',{actor:other.actor,input:a.auth()}))).status,404);
 assert.equal((await a.run('rtc.endpoints')).endpoints.length,2);assert.equal((await other.run('rtc.endpoints')).endpoints.length,0);
 // No secret, push key or queue is ever in a read.
 const list=await h.run(1,'rtc.endpoint-list');assert.equal(JSON.stringify(list).includes(out.endpoint_secret),false);
 // RTC wargame M3: at most 8 live endpoints per application, 32 per entity across applications.
 for(let i=0;i<RTC_BOUNDS.endpointsPerApp-2;i++)await h.device(1).register();assert.equal((await fault(h.device(1).register())).code,'rate_limited','8 per application');
 const appDevice=n=>h.device(1,{grant:h.grant(1,{clientId:`https://app${n}.example/c`,origin:`https://app${n}.example`})});
 for(let n=1;n<RTC_BOUNDS.endpoints/RTC_BOUNDS.endpointsPerApp;n++)for(let i=0;i<RTC_BOUNDS.endpointsPerApp;i++)await appDevice(n).register();
 assert.equal((await fault(appDevice(99).register())).code,'rate_limited','32 per entity');
});

test('leg keys: renewal keeps cnf, a delegate is never certified twice',async()=>{
 const h=await rtcHost();const {a,s,b}=await connected(h);
 const renewed=await a.run('rtc.renew',{...a.auth(),sid:s.sid});const old=payloadOf(s.certificate),next=payloadOf(renewed.certificate);
 assert.deepEqual([next.sid,next.role,next.cnf.jkt],[old.sid,old.role,old.cnf.jkt]);assert.notEqual(next.jti,old.jti);
 await a.candidates(s,[relay()]);await h.pump();await b.listen();assert.equal(types(b.events).at(-1),'candidates','messages verify under the renewed certificate');
 await rejects(a.open(h.principal(2),CALL,{leg:s.leg,basis:(await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:60})).link}),'invalid_args');
});

test('revocation mid-session: unregister, revoke-endpoint, end-session and app revocation send control statements',async()=>{
 const h=await rtcHost();
 const one=await connected(h);await one.a.run('rtc.unregister',one.a.auth());await h.pump();await one.b.listen();
 const ended=one.b.events.at(-1);assert.equal(ended.state,'ended');assert.equal(payloadOf(ended.control).reason,'revoked');assert.equal(payloadOf(ended.control).iss,ISS);
 const two=await connected(h,{a:h.device(1),b:h.device(2)});await h.run(2,'rtc.revoke-endpoint',{input:{endpoint:two.b.endpoint}});await h.pump();await two.a.listen();assert.equal(two.a.events.at(-1).state,'ended');
 const three=await connected(h,{a:h.device(1),b:h.device(2)});await h.run(1,'rtc.end-session',{input:{sid:three.s.sid}});await h.pump();await three.b.listen();assert.equal(three.b.events.at(-1).state,'ended');
 const four=await connected(h,{a:h.device(1),b:h.device(2)});await h.run(2,'rtc.lifecycle',{actor:h.system(2),input:{event:'app-revoked',clientId:APP+'/client'}});await h.pump();await four.a.listen();assert.equal(four.a.events.at(-1).state,'ended');
 assert.equal((await h.rows(2,'rtc/ep/')).length,0,'that application\'s endpoints are removed');
 assert.equal((await fault(h.run(1,'rtc.lifecycle',{input:{event:'deletion'}}))).code,'forbidden','system only');
});

test('account deletion mid-session: peers are told, nothing new is admitted, the purge leaves nothing behind',async()=>{
 const h=await rtcHost();const {a,b,s}=await connected(h);const ringing=await a.open(h.principal(2),CALL,{basis:(await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:600})).link});await a.invite(ringing);await h.pump();
 const out=await h.run(2,'rtc.lifecycle',{actor:h.system(2),input:{event:'deletion'}});assert.equal(out.ended,2);await h.pump();
 // RTC wargame H1 (§12): only the connected session is told; the unanswered invite ends silently towards the caller,
 // whose session rings out at ring_until.
 await a.listen();assert.equal(a.events.filter(e=>e.type==='state'&&e.state==='ended').length,1);
 assert.equal((await record(h,1,'rtc/out/')).find(r=>r.sid===ringing.sid).state,'ringing');
 h.clock.advance(RING_MAX_MS+1);await h.tick(1);
 assert.equal((await record(h,1,'rtc/out/')).every(r=>r.state==='ended'),true);
 assert.equal((await h.rows(2,'rtc/ep/')).length,0);assert.equal((await fault(b.register())).status,404,'nothing new after the deletion step');
 // The purge removes the store; later messages to the deleted entity are dropped after their useful life.
 h.account(2).gone=true;const again=await fault(a.end(s));assert.equal(again,null);await h.pump();h.clock.advance(31000);await h.tick(1);assert.equal((await h.rows(1,'rtc/outbox/')).length,0);
 // A caller cannot open a session to a deleted entity (no keys): temporarily unavailable, as for any unknown keys.
 assert.equal((await fault(a.open(h.principal(2),CALL))).code,'temporarily_unavailable');
});

test('export and inventory: the owner export carries settings and history, never secrets, links, SDP or sessions',async()=>{
 const h=await rtcHost();const {a,b,s,link}=await connected(h);await a.candidates(s,[relay()]);await h.pump();await b.listen();
 await h.run(2,'rtc.block',{input:{principal:h.principal(3)}});await h.run(2,'rtc.mute',{input:{kind:'purpose',value:FILES}});await h.run(2,'rtc.set-contact-rtc',{input:{parent:'grant-9',purposes:[CALL]}});
 const exported=await h.run(2,'rtc.export'),text=JSON.stringify(exported);
 assert.equal(exported.version,1);assert.equal(exported.blocked.length,1);assert.equal(exported.contacts[0].parent,'grant-9');assert.equal(exported.tickets.length,1);
 for(const secret of [link,new URL(link).searchParams.get('bindle_meta'),b.secret,'candidate:','a=fingerprint',s.sid])assert.equal(text.includes(secret),false,secret.slice(0,20));
 // Every stored family has an export contributor or a reasoned exclusion.
 const families=new Set();for(const n of [1,2])for(const [key] of await h.rows(n))families.add(key.split('/').slice(0,2).join('/')+'/');
 families.add('rtc/policy');families.add('rtc/closed');families.add('rtc/outbox-seq');
 for(const row of exportInventory([...families]))assert.ok(row.contributor||row.reason,row.prefix);
 assert.equal(exportInventory(['rtc/policy'])[0].contributor,'rtc');assert.match(exportInventory(['rtc/ep/x'])[0].reason,/Secret/);
});

test('uniform ingest: one answer for unknown, unadmitted, blocked, stale and keyless; malformed batches refused whole',async()=>{
 const h=await rtcHost({hold:true});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const s=await a.open(h.principal(2),CALL);await a.invite(s);const [item]=(await h.held());
 const answers=[];answers.push(await h.ingest(2,item.input.batch));// unadmitted (no basis)
 await h.run(2,'rtc.block',{input:{principal:h.principal(1)}});answers.push(await h.ingest(2,item.input.batch));
 answers.push(await h.ingest(3,buildBatch({messages:[JSON.parse(item.input.batch).messages[0]]})));// another entity: aud mismatch
 const keyless=h.account(1).certKeys;h.account(1).certKeys=()=>[];answers.push(await h.ingest(2,item.input.batch));h.account(1).certKeys=keyless;
 for(const answer of answers)assert.deepEqual(answer,{accepted:true});
 assert.equal((await h.rows(2,'rtc/in/')).length,0);assert.equal((await h.rows(3,'rtc/in/')).length,0);
 const batch=JSON.parse(item.input.batch);batch.messages.push('not-a-jws');assert.equal((await fault(h.ingest(2,JSON.stringify(batch)))).code,'rtc_batch_invalid');
 h.clock.advance(5*MIN);assert.equal((await fault(h.ingest(2,item.input.batch))).code,'rtc_batch_invalid','iat window (step 1)');
});

test('one bad message in a batch does not stop the others (per-message silence)',async()=>{
 const h=await rtcHost({hold:true});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});(await h.held());
 const s1=await a.open(h.principal(2),CALL,{basis:link}),s2=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s1);await a.invite(s2);
 const [one,two]=(await h.held()).map(x=>JSON.parse(x.input.batch)),other=await (await import('./helpers/rtc-wire-fixture.mjs')).keyPair();
 const bad=one.messages[0].replace(/\.[^.]+$/,'.'+(await (await import('../packages/rtc/certificates.mjs')).signMessage(payloadOf(one.messages[0]),other.privateKey)).split('.')[2]);
 await h.ingest(2,buildBatch({certificates:[...one.certificates,...two.certificates],messages:[bad,two.messages[0]],links:[link]}));
 assert.deepEqual((await record(h,2,'rtc/in/')).map(r=>r.sid),[s2.sid]);
});

test('a forged certificate, another entity\'s certification key and a stolen leg key are refused silently',async()=>{
 const h=await rtcHost({hold:true});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});(await h.held());
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);const [item]=(await h.held());
 // Entity 3 replays A's batch as its own: the certificate names A, verified only under A's keys.
 const swapped=h.account(1).certKeys;h.account(1).certKeys=h.account(3).certKeys;await h.ingest(2,item.input.batch);h.account(1).certKeys=swapped;
 assert.equal((await h.rows(2,'rtc/in/')).length,0);assert.equal((await h.run(2,'rtc.tickets')).tickets[0].usesLeft,5,'no use spent by a failing invite');
 await h.ingest(2,item.input.batch);assert.equal((await h.rows(2,'rtc/in/')).length,1);await h.ingest(2,item.input.batch);assert.equal((await h.run(2,'rtc.tickets')).tickets[0].usesLeft,4,'a retried copy is ignored');
});

test('queue overflow ends the session failed and reports a gap',async()=>{
 const h=await rtcHost();const {a,b,s}=await connected(h);
 for(let i=0;i<RTC_BOUNDS.queueEvents+2;i++){if(i&&i%250===0)h.clock.advance(MIN);await a.candidates(s,[relay()]);await h.pump(1);}
 const out=await b.listen();assert.equal(out.gap,true);
 assert.equal((await record(h,2,'rtc/in/'))[0].endReason,'failed');await h.pump();assert.equal((await record(h,1,'rtc/out/'))[0].state,'ended');
 for(const [,ep] of await h.rows(2,'rtc/ep/'))assert.ok(ep.q.count<=RTC_BOUNDS.queueEvents);
});

test('messages per leg: 256 per minute at the sender\'s provider',async()=>{
 const h=await rtcHost();const {a,s}=await connected(h);let limited=0;
 for(let i=0;i<258;i++){if(i%16===0)await h.pump();const r=await fault(a.candidates(s,[relay()]));if(r?.code==='rate_limited'){limited++;s.seq--;}}
 assert.equal(limited,3,'the invite counted as the first message of the leg');h.clock.advance(MIN);assert.deepEqual(await a.candidates(s,[relay()]),{accepted:1});
});

test('listen long-polls until an event arrives or the wait ends',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600});
 const waiting=b.listen({wait:2});const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();
 const out=await waiting;assert.equal(out.events.length,1);assert.equal(out.events[0].type,'invite');
});

test('signatures: a wrong leg key at send, a bad message signature at ingest, a forged control statement, a lower aep',async()=>{
 const h=await rtcHost({hold:true});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:9,expires_in:3600});(await h.held());
 const s=await a.open(h.principal(2),CALL,{basis:link});
 // The sender's provider verifies its own endpoint's messages under the leg it certified.
 const other=await (await import('./helpers/rtc-wire-fixture.mjs')).keyPair(),forged=await (await import('../packages/rtc/certificates.mjs')).signMessage(payloadOf(await a.sign(s,'invite',a.inviteBody(s),{seq:0})),other.privateKey);
 await rejects(a.send(s,[forged]),'invalid_args');
 await a.invite(s);const [item]=(await h.held()),batch=JSON.parse(item.input.batch);
 // Step 4: a message whose signature does not verify under the certified delegate is dropped silently.
 const tampered={...batch,messages:[batch.messages[0].replace(/\.[^.]+$/,'.'+forged.split('.')[2])]};
 assert.deepEqual(await h.ingest(2,JSON.stringify(tampered)),{accepted:true});assert.equal((await h.rows(2,'rtc/in/')).length,0);
 await h.ingest(2,item.input.batch);await b.listen();const c=await b.claim(s.sid);await b.accept(c);h.net.hold=false;await h.pump();await a.listen();
 // A control statement claiming to come from A but signed with entity 3's certification key ends nothing.
 const {signControl}=await import('../packages/rtc/certificates.mjs');
 const control=await signControl({issuer:ISS,sub:subOf(1),aud:identityOf(subOf(2)),sid:s.sid,leg:null,reason:'revoked',now:h.clock.now()},h.account(3).cert);
 await h.ingest(2,buildBatch({controls:[control]}));assert.equal((await record(h,2,'rtc/in/'))[0].state,'connected');
 const genuine=await signControl({issuer:ISS,sub:subOf(1),aud:identityOf(subOf(2)),sid:s.sid,leg:null,reason:'revoked',now:h.clock.now()},h.account(1).cert);
 await h.ingest(2,buildBatch({controls:[genuine]}));assert.equal((await record(h,2,'rtc/in/'))[0].endReason,'revoked');
 // Step 6: once an epoch is recorded for a sender, a lower one is refused.
 h.account(1).aep=3;const s2=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s2);await h.pump();assert.equal((await record(h,2,'rtc/in/')).length,2);
 h.account(1).aep=1;const s3=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s3);await h.pump();assert.equal((await record(h,2,'rtc/in/')).length,2,'a lower aep is refused');
});

// ---- seeded chaos (design §8.2) ------------------------------------------------------------------------------------
import {forEachSeed} from './helpers/chaos.mjs';
const STEPS=Number(process.env.RTC_CHAOS_STEPS??200),SEEDS=Number(process.env.RTC_CHAOS_SEEDS??8);
/** Invariants over every entity's stored state and every device's delivered events (C1, C2, C6 of design §8.2). */
async function invariants(h,devices,wins){
 for(const a of h.accounts.values()){
  const rows=new Map(await a.store.list({prefix:'rtc/'})),list=prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);
  const outs=list('rtc/out/'),ins=list('rtc/in/');
  // C6: storage bounds.
  assert.ok(outs.filter(r=>r.state!=='ended').length<=RTC_BOUNDS.callerOpen,'caller open bound');
  // RTC wargame M1: bearer-link invites ring up to calleeRinging; self and principal-bound tickets use the reserve too.
  assert.ok(ins.filter(r=>r.state==='ringing'&&!r.held).length<=RTC_BOUNDS.calleeRinging+RTC_BOUNDS.calleeRingingReserve,'callee ringing bound');
  assert.ok(ins.filter(r=>r.state==='connected').length<=RTC_BOUNDS.calleeConnected,'callee connected bound');
  assert.ok(list('rtc/ep/').length<=RTC_BOUNDS.endpoints&&list('rtc/ep/').every(ep=>ep.q.count<=RTC_BOUNDS.queueEvents&&ep.q.bytes<=RTC_BOUNDS.queueBytes),'endpoint and queue bounds');
  assert.ok(list('rtc/outbox/').length<=RTC_BOUNDS.outbox&&list('rtc/missed/').length<=RTC_BOUNDS.missed,'outbox and missed bounds');
  assert.ok(list('rtc/inq/').length<=RTC_BOUNDS.inbox,'inbound queue bound');
  const perPeer=new Map();for(const [key] of rows)if(key.startsWith('rtc/outbox/')){const p=key.split('/')[2];perPeer.set(p,(perPeer.get(p)??0)+1);}
  for(const n of perPeer.values())assert.ok(n<=RTC_BOUNDS.outboxPeer,'per-peer outbox bound');
  const om=rows.get('rtc/outbox-seq'),im=rows.get('rtc/inq-meta');
  if(om)assert.equal(om.count,list('rtc/outbox/').length,'the outbox counter matches its rows');if(im)assert.equal(im.count,list('rtc/inq/').length,'the inbound counter matches its rows');
  for(const r of ins){
   // C1: at most one claimant, and it is an endpoint the invite was delivered to.
   if(r.claim)assert.ok(r.delivered.includes(r.claim.endpoint)||r.state==='ended','claimant was notified');
   assert.ok(!r.mine||r.claim,'a callee leg exists only after a claim');
  }
  // C2: queued SDP/candidates only for the two legs of a claimed session.
  for(const [key,row] of rows)if(key.startsWith('rtc/epq/')&&row.type==='message'){const p=payloadOf(row.message),ep=key.split('/')[2];
   if(!['sdp','candidates'].includes(p.type))continue;const out=rows.get('rtc/out/'+row.sid);const inn=ins.find(r=>r.sid===row.sid&&r.claim?.endpoint===ep);
   assert.ok(out?.mine?.endpoint===ep&&out.theirs||inn&&inn.claim.outcome==='accept',`address material only to a session leg (${p.type})`);}
 }
 for(const [sid,set] of wins)assert.ok(set.size<=1,`at most one successful claim for ${sid}`);
 for(const d of devices)for(const e of d.events){
  if(e.type==='invite'){assert.equal(payloadOf(e.invite).body.offer,null);continue;}
  if(e.type!=='message')continue;const p=payloadOf(e.message);if(!['sdp','candidates'].includes(p.type))continue;
  const mine=d.sessions.get(e.sid);assert.ok(mine,'address material reached only a device holding a leg');
  if(mine.role==='callee')assert.ok(wins.get(e.sid)?.has(d.endpoint),'the callee device is the claimant');
 }
}
test('seeded chaos: invites, claims, cancels, signals, expiry, faults and restarts keep the invariants',async()=>{
 await forEachSeed(SEEDS,async random=>{
  const h=await rtcHost({seed:random.seed,entities:3,hold:true});const devices=[],tickets=new Map(),wins=new Map(),calls=[];
  for(const n of [1,2,3])for(let i=0;i<2;i++){const d=h.device(n);await d.register([CALL,SYNC]);devices.push(d);}
  for(const n of [1,2,3]){const d=devices.find(x=>x.n===n);tickets.set(n,(await d.run('rtc.mint-ticket',{purposes:[CALL],uses:1000,expires_in:30*86400})).link);}
  const tolerate=async fn=>{try{return await fn();}catch(e){if(e?.code==='ERR_ASSERTION')throw e;return null;}};
  for(let step=0;step<STEPS;step++){
   const op=random.pick(['call','call','listen','listen','listen','claim','claim','claim','cancel','signal','signal','end','deliver','deliver','pump','advance','crash','down']);
   if(op==='call'){const d=random.pick(devices),to=random.int(3)+1,own=to===d.n,purpose=own&&random.chance(0.5)?SYNC:CALL;
    await tolerate(async()=>{const s=await d.open(h.principal(to),purpose,{media:purpose===SYNC?['data']:['audio'],...own?{}:{basis:tickets.get(to)}});calls.push({d,s});await d.invite(s);});}
   if(op==='listen'){if(random.chance(0.8))await h.flushNetwork({random,dropRate:0.05,dupRate:0.2});await tolerate(()=>random.pick(devices).listen());}
   if(op==='claim'){const d=random.pick(devices),open=d.claims().filter(e=>!d.sessions.has(e.sid));if(open.length){const e=random.pick(open),outcome=random.chance(0.8)?'accept':'decline';
    await tolerate(async()=>{const c=await d.claim(e.sid,outcome);const set=wins.get(e.sid)??new Set();set.add(d.endpoint);wins.set(e.sid,set);await(outcome==='accept'?d.accept(c):d.decline(c));if(random.chance(0.5))await h.flushNetwork({random,dupRate:0.2});});}}
   if(op==='cancel'&&calls.length){const {d,s}=random.pick(calls);await tolerate(()=>d.cancel(s));}
   if(op==='signal'){const d=random.pick(devices),held=[...d.sessions.values()].filter(s=>s.peerLeg);if(held.length)await tolerate(()=>d.candidates(random.pick(held),[relay()]));}
   if(op==='end'){const d=random.pick(devices),held=[...d.sessions.values()].filter(s=>s.peerLeg);if(held.length)await tolerate(()=>d.end(random.pick(held)));}
   if(op==='deliver')await h.flushNetwork({random,dropRate:0.1,dupRate:0.2});
   if(op==='pump')await h.pump(2);
   if(op==='advance'){h.clock.advance(random.chance(0.15)?random.int(150000):random.int(15000));await h.tickAll();}
   if(op==='crash')await h.restart(random.int(3)+1);
   if(op==='down'){const sub=subOf(random.int(3)+1);if(h.net.down.has(sub))h.net.down.delete(sub);else h.net.down.add(sub);}
   await invariants(h,devices,wins);
  }
  // Quiesce: the network heals, everything is delivered, and every session reaches a terminal state by its lifetime.
  h.net.down.clear();h.net.hold=false;await h.flushNetwork();await h.pump();
  for(let i=0;i<4;i++){h.clock.advance(7*3600000);await h.tickAll();await h.pump();}
  for(const a of h.accounts.values())for(const [key,r] of await a.store.list({prefix:'rtc/'}))if(key.startsWith('rtc/out/')||key.startsWith('rtc/in/'))assert.equal(r.state,'ended',`${key} is terminal`);
  for(const a of h.accounts.values())assert.equal((await a.store.list({prefix:'rtc/outbox/'})).size,0,'the outbox drains or expires');
  for(const a of h.accounts.values())assert.equal((await a.store.list({prefix:'rtc/inq/'})).size,0,'the inbound queue is processed');
  await invariants(h,devices,wins);
  h.clock.advance(2*DAY);await h.tickAll();for(const a of h.accounts.values())assert.equal((await a.store.list({prefix:'rtc/in/'})).size+(await a.store.list({prefix:'rtc/out/'})).size,0,'records are deleted 24 h after the end');
 });
});

// ---- review follow-ups (DEVLOG RTC-d "Review follow-ups"; PoCs turned into regressions) -----------------------------
const P256={name:'ECDSA',namedCurve:'P-256'};
async function legPair(){const p=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',p.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...p,jwk,jkt:await jwkThumbprint(jwk)};}
const sidNew=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
/** A callee leg that entity `n`'s provider certifies itself (a provider may certify any leg of its own entity). */
async function forgedAccept(h,n,s,callerN=1){
 const k=await legPair(),B=h.account(n),now=h.clock.now(),aud=identityOf(subOf(callerN));
 const cert=await signLegCertificate({issuer:ISS,sub:B.sub,identity:identityOf(B.sub),aud,sid:s.sid,role:'callee',purpose:REF[CALL],client:{client_id:APP+'/client',origin:APP},delegate:k.jwk,aep:0,now,maxSeconds:900,allowLoopback:true},B.cert);
 const m=await signMessage({bindle:'rtc-message',v:1,iss:ISS,sub:B.sub,aud,sid:s.sid,leg:k.jkt,to:s.leg.jkt,seq:0,iat:Math.floor(now/1000),type:'accept',body:{answer:null,sas_nonce:null}},k.privateKey);
 return {cert:cert.certificate,m};
}
const countBound=account=>{const orig=account.service.bound,box={n:0};account.service.bound={check:async input=>{box.n++;return orig.check(input);}};return box;};

test('review M2: a send never runs the callee\'s admission; ingest only queues and answers before steps 2–8',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:3,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link}),checks=countBound(h.account(2));h.kicked.clear();
 assert.deepEqual(await a.invite(s),{accepted:1});
 // Structural, not timing: nothing at the callee ran inside the sender's request.
 assert.equal(checks.n,0,'no bound check (callee admission) during send');
 assert.equal((await h.rows(2,'rtc/in/')).length+(await h.rows(2,'rtc/inq/')).length,0,'nothing reached the callee during send');
 assert.equal((await h.rows(1,'rtc/outbox/')).length,1);assert.ok(h.kicked.has(subOf(1)),'the sender asked its adapter for a pass after commit');
 // Delivery reaches only the receiver's queue: step 1 and an immediate answer, no admission.
 h.kicked.clear();await h.drainAll();
 assert.equal(checks.n,0,'ingest runs no admission');assert.equal((await h.rows(2,'rtc/inq/')).length,1);assert.equal((await h.rows(2,'rtc/in/')).length,0);assert.ok(h.kicked.has(subOf(2)));
 await h.inbox(2);assert.ok(checks.n>0,'steps 2–8 run on the receiver\'s own pass');assert.equal((await h.rows(2,'rtc/in/')).length,1);assert.equal((await h.rows(2,'rtc/inq/')).length,0);
 // The answer is the same whether the callee blocked the caller or not, and it never waits on admission.
 await h.run(2,'rtc.block',{input:{principal:h.principal(1)}});const before=checks.n,s2=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s2);
 h.net.hold=true;const [item]=await h.held();h.net.hold=false;assert.deepEqual(await h.receive(2,item.input.batch),{accepted:true});assert.equal(checks.n,before);
 // A full inbound queue sheds with 503 (the sender retries), independent of steps 2–8.
 const B=h.account(2);await B.store.put('rtc/inq-meta',{seq:1000,count:RTC_BOUNDS.inbox,bytes:0});assert.equal((await fault(h.receive(2,item.input.batch))).status,503);
});

test('review M3: forged extra callee legs get at most one failed reply each and a bounded number per session',async()=>{
 const h=await rtcHost({entities:3});const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();
 h.net.down.add(subOf(2));// B's provider stops taking deliveries, so replies would stay queued
 const first=await forgedAccept(h,2,s),repeat=await forgedAccept(h,2,s);
 await h.ingest(1,buildBatch({certificates:[first.cert],messages:[first.m]}));// the first answer becomes the callee leg
 for(let i=0;i<3;i++)await h.ingest(1,buildBatch({certificates:[repeat.cert],messages:[repeat.m]}));
 assert.equal((await h.rows(1,'rtc/outbox/')).length,1,'one failed reply for a leg however often it is replayed');
 for(let i=0;i<9;i++){const f=await Promise.all([1,2,3,4].map(()=>forgedAccept(h,2,s)));await h.ingest(1,buildBatch({certificates:[...f.map(x=>x.cert)],messages:f.map(x=>x.m)}));}
 const rows=await h.rows(1,'rtc/outbox/');assert.ok(rows.length<=RTC_BOUNDS.controlReplies,`at most ${RTC_BOUNDS.controlReplies} control replies, got ${rows.length}`);
 const legs=rows.flatMap(([,r])=>r.controls.map(c=>c.leg));assert.equal(new Set(legs).size,legs.length,'one failed reply per (sid, leg)');
});

test('review M3: a failing peer never stalls delivery to others, and a full outbox refuses the send',async()=>{
 const h=await rtcHost({entities:3});const {a,s}=await connected(h);const c=h.device(3);await c.register();
 h.net.down.add(subOf(2));
 // More rows for the failing peer than one drain pass visits (32), all ahead of the next peer's rows.
 for(let i=0;i<40;i++)assert.deepEqual(await a.candidates(s,[relay()]),{accepted:1});
 const {link}=await c.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600});
 const s3=await a.open(h.principal(3),CALL,{basis:link});await a.invite(s3);
 const keys=(await h.rows(1,'rtc/outbox/')).map(([k])=>k),firstC=keys.findIndex(k=>k.includes(encodeURIComponent(subOf(3))));assert.ok(firstC>=40,'the healthy peer\'s row sits behind the failing peer\'s rows');
 for(let i=0;i<3;i++){h.clock.advance(1000);await h.tickAll();}
 await h.inbox(3);await c.listen();assert.equal(c.claims().length,1,'the invite to the healthy peer is delivered');
 // The failing peer's message rows are capped (with room kept for control statements); the sender learns it.
 let accepted=40,refused=null;for(let i=0;i<20&&!refused;i++){refused=await fault(a.candidates(s,[relay()]));if(refused)s.seq--;else accepted++;}
 assert.equal(refused?.code,'rate_limited','an overflow refuses the send instead of reporting it accepted');
 const toB=()=>h.rows(1,'rtc/outbox/'+encodeURIComponent(JSON.stringify([ISS,subOf(2)]))+'/');
 assert.equal((await toB()).length,RTC_BOUNDS.outboxPeer-RTC_BOUNDS.outboxPeerControlReserve);
 // A revocation still fits in the reserve.
 await h.run(1,'rtc.end-session',{input:{sid:s.sid}});assert.equal((await toB()).length,RTC_BOUNDS.outboxPeer-RTC_BOUNDS.outboxPeerControlReserve+1);
 assert.ok(accepted>40);
 // The total cap: message batches stop at the reserve; control statements may use it, and are dropped only when full
 // (the session still ends locally; the peer's leg certificates bound the rest, spec §14).
 const s2=(await connected(h,{a,b:h.device(3)})).s,A=h.account(1),meta=await A.store.get('rtc/outbox-seq');
 await A.store.put('rtc/outbox-seq',{...meta,count:RTC_BOUNDS.outbox-RTC_BOUNDS.outboxControlReserve});
 await rejects(a.candidates(s2,[relay()]),'rate_limited','total message cap');s2.seq--;
 await A.store.put('rtc/outbox-seq',{...meta,count:RTC_BOUNDS.outbox-1});
 const before=(await h.rows(1,'rtc/outbox/')).length;await h.run(1,'rtc.end-session',{input:{sid:s2.sid}});
 assert.equal((await h.rows(1,'rtc/outbox/')).length,before+1,'a control statement uses the reserve');
 assert.equal((await record(h,1,'rtc/out/')).find(r=>r.sid===s2.sid).state,'ended');
});

test('review M1: a peer\'s control statement verifies against the keys pinned on the session after its keys stop being served',async()=>{
 const h=await rtcHost();const {a,s}=await connected(h);
 assert.ok((await record(h,1,'rtc/out/'))[0].peerKeys.length>0,'the caller pinned the callee keys');assert.ok((await record(h,2,'rtc/in/'))[0].peerKeys.length>0,'the callee pinned the caller keys');
 await h.run(2,'rtc.end-session',{input:{sid:s.sid,caller:h.principal(1)}});
 h.account(2).keyless=true;// e.g. the identity tombstone ran before the drain, or the account was suspended
 await h.pump();await a.listen();
 const out=(await record(h,1,'rtc/out/'))[0];assert.equal(out.state,'ended');assert.equal(out.endReason,'revoked');
 assert.equal(payloadOf(a.events.find(e=>e.type==='state'&&e.state==='ended').control).reason,'revoked');
 // A ringing session: the caller holds only the keys pinned at open. RTC wargame H1: the callee claimed it (its answer
 // not sent yet), since an unanswered invite now ends silently towards the caller.
 const c=h.device(3);await c.register();const {link}=await c.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600});
 const ringing=await a.open(h.principal(3),CALL,{basis:link});await a.invite(ringing);await h.pump();await c.listen();await c.claim(ringing.sid);
 await h.run(3,'rtc.lifecycle',{actor:h.system(3),input:{event:'deletion'}});h.account(3).keyless=true;await h.pump();
 assert.equal((await record(h,1,'rtc/out/')).find(r=>r.sid===ringing.sid).endReason,'revoked','verified with the keys pinned at open');
 // A key rotated between open and answer: the keys that verified the answer are pinned too.
 const h2=await rtcHost(),a2=h2.device(1),b2=h2.device(2);await a2.register();await b2.register();
 const t2=(await b2.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600})).link,s2=await a2.open(h2.principal(2),CALL,{basis:t2});
 const rotated=await legPair(),B2=h2.account(2);B2.cert={kid:'cert-2',privateKey:rotated.privateKey};B2.certJwk=rotated.jwk;
 await a2.invite(s2);await h2.pump();await b2.listen();const c2=await b2.claim(s2.sid);await b2.accept(c2);await h2.pump();
 assert.equal((await record(h2,1,'rtc/out/'))[0].state,'connected');
 await h2.run(2,'rtc.end-session',{input:{sid:s2.sid,caller:h2.principal(1)}});B2.keyless=true;await h2.pump();
 assert.equal((await record(h2,1,'rtc/out/'))[0].endReason,'revoked','verified with the rotated key pinned at the answer');
});

test('review L1: the per-caller limit counts invites across every callee entity on the host',async()=>{
 const N=9,h=await rtcHost({entities:N});const A=h.account(1);let admitted=0;
 for(let n=2;n<=N;n++){const d=h.device(n);await d.register();const {link}=await d.run('rtc.mint-ticket',{purposes:[CALL],uses:10,expires_in:3600});
  for(let i=0;i<4;i++){// 4 per callee: under the pair limit (6 per 10 min) and the callee's ringing slots (4)
   const k=await legPair(),sid=sidNew(),now=h.clock.now(),aud=identityOf(subOf(n));
   const cert=await signLegCertificate({issuer:ISS,sub:A.sub,identity:identityOf(A.sub),aud,sid,role:'caller',purpose:REF[CALL],client:{client_id:APP+'/client',origin:APP},delegate:k.jwk,aep:0,now,maxSeconds:900,allowLoopback:true},A.cert);
   const m=await signMessage({bindle:'rtc-message',v:1,iss:ISS,sub:A.sub,aud,sid,leg:k.jkt,to:null,seq:0,iat:Math.floor(now/1000),type:'invite',body:{purpose:REF[CALL],media:['audio'],ring_until:Math.floor(now/1000)+60,basis:{link_digest:await linkDigest(link)},context:null,offer:null,callback_digest:null,sas_commit:null}},k.privateKey);
   await h.ingest(n,buildBatch({certificates:[cert.certificate],messages:[m],links:[link]}));
  }
  await d.listen();admitted+=d.claims().length;
 }
 assert.equal(admitted,LIMITS.caller.max,'one caller principal is limited across callee entities, not per callee writer');
 // Concurrent passes (the detached task and the alarm) process each queued batch once, so nothing is counted twice.
 const h2=await rtcHost({entities:2}),A2=h2.account(1),d2=h2.device(2);await d2.register();const t2=(await d2.run('rtc.mint-ticket',{purposes:[CALL],uses:10,expires_in:3600})).link;
 for(let i=0;i<4;i++){const k=await legPair(),sid=sidNew(),now=h2.clock.now(),aud=identityOf(subOf(2));
  const cert=await signLegCertificate({issuer:ISS,sub:A2.sub,identity:identityOf(A2.sub),aud,sid,role:'caller',purpose:REF[CALL],client:{client_id:APP+'/client',origin:APP},delegate:k.jwk,aep:0,now,maxSeconds:900,allowLoopback:true},A2.cert);
  const m=await signMessage({bindle:'rtc-message',v:1,iss:ISS,sub:A2.sub,aud,sid,leg:k.jkt,to:null,seq:0,iat:Math.floor(now/1000),type:'invite',body:{purpose:REF[CALL],media:['audio'],ring_until:Math.floor(now/1000)+60,basis:{link_digest:await linkDigest(t2)},context:null,offer:null,callback_digest:null,sas_commit:null}},k.privateKey);
  await h2.receive(2,buildBatch({certificates:[cert.certificate],messages:[m],links:[t2]}));}
 await Promise.all([h2.inbox(2),h2.inbox(2),h2.inbox(2)]);
 assert.equal(h2.hostWindows.get(JSON.stringify(['caller',ISS,A2.sub])).count,4,'each queued batch counted once');assert.equal((await h2.rows(2,'rtc/in/')).length,4);
 // A retried copy of an admitted invite is not counted again; a limiter that fails drops the invite (fail closed).
 const h3=await rtcHost({entities:2}),a3=h3.device(1),b3=h3.device(2);await a3.register();await b3.register();const t3=(await b3.run('rtc.mint-ticket',{purposes:[CALL],uses:5,expires_in:3600})).link;
 const s3=await a3.open(h3.principal(2),CALL,{basis:t3});await a3.invite(s3);h3.net.hold=true;const [copy]=await h3.held();h3.net.hold=false;
 for(let i=0;i<3;i++)await h3.ingest(2,copy.input.batch);
 assert.equal(h3.hostWindows.get(JSON.stringify(['caller',ISS,subOf(1)])).count,1,'a retried invite is counted once');
 h3.account(2).service.hostLimits={take:async()=>{throw new Error('limiter unavailable');}};
 const s4=await a3.open(h3.principal(2),CALL,{basis:t3});await a3.invite(s4);await h3.pump();
 assert.equal((await h3.rows(2,'rtc/in/')).length,1,'no admission while the host limiter fails');
});

test('review L2: a repeat claim is refused once the session ended (no certificate for a dead session)',async()=>{
 const h=await rtcHost();const {a,b,s,c}=await connected(h);
 const again=await b.run('rtc.claim',{...b.auth(),sid:s.sid,outcome:'accept',delegate:c.leg.jwk});assert.equal(payloadOf(again.certificate).sid,s.sid,'a repeat while live is allowed');
 await a.end(s);await h.pump();assert.equal((await record(h,2,'rtc/in/'))[0].state,'ended');h.clock.advance(60000);
 await rejects(b.run('rtc.claim',{...b.auth(),sid:s.sid,outcome:'accept',delegate:c.leg.jwk}),'claimed');
 // A decline may be repeated only until its message was sent.
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:1,expires_in:3600});const s2=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s2);await h.pump();await b.listen();
 const d=await b.claim(s2.sid,'decline');await b.run('rtc.claim',{...b.auth(),sid:s2.sid,outcome:'decline',delegate:d.leg.jwk});
 await b.decline(d);await rejects(b.run('rtc.claim',{...b.auth(),sid:s2.sid,outcome:'decline',delegate:d.leg.jwk}),'claimed');
 // The rule itself (sessions.mjs): the same claimant repeating on an ended accept or a sent decline is refused.
 const ended={state:'ended',endReason:'hangup',delivered:['ep'],claim:{endpoint:'ep',jkt:'k',outcome:'accept'}};assert.deepEqual(decideClaim(ended,{endpoint:'ep',jkt:'k',outcome:'accept',now:0}),{won:false,code:'claimed'});
 const sentDecline={state:'ended',endReason:'declined',declineSent:true,delivered:['ep'],claim:{endpoint:'ep',jkt:'k',outcome:'decline'}};assert.equal(decideClaim(sentDecline,{endpoint:'ep',jkt:'k',outcome:'decline',now:0}).won,false);
 assert.equal(decideClaim({...sentDecline,declineSent:false},{endpoint:'ep',jkt:'k',outcome:'decline',now:0}).repeat,true);
});

test('review L3: narrowing the IP policy applies to live sessions at once',async()=>{
 const h=await rtcHost();await h.run(1,'rtc.set-policy',{input:{other:'public'}});const {a,s}=await connected(h);
 assert.deepEqual(await a.candidates(s,[srflx()]),{accepted:1});
 await h.run(1,'rtc.set-policy',{input:{other:'relay'}});
 await rejects(a.candidates(s,[srflx()]),'invalid_args','relay-only after narrowing');s.seq--;assert.deepEqual(await a.candidates(s,[relay()]),{accepted:1});
 // Widening never reaches a live session: it keeps the policy pinned at open.
 await h.run(1,'rtc.set-policy',{input:{other:'public'}});const second=await connected(h,{a:h.device(1),b:h.device(2)});await h.run(1,'rtc.set-policy',{input:{other:'relay'}});await h.run(1,'rtc.set-policy',{input:{other:'public'}});
 assert.deepEqual(await second.a.candidates(second.s,[srflx()]),{accepted:1});
});

test('review L4: the export carries contact parents and ticket purposes and principal binding, never the meta',async()=>{
 const h=await rtcHost();const b=h.device(2);await b.register();
 await h.run(2,'rtc.set-contact-rtc',{input:{parent:'grant/with slash',purposes:[CALL]}});
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:2,expires_in:3600,principal:h.principal(1)});
 const contributors=createExportContributors({accountStore:h.account(2).store}),page=async name=>{const c=contributors.find(x=>x.name===name),rows=[];let cursor=null;for(let i=0;i<16;i++){const p=await c.page({owner:subOf(2),cursor,limit:100});rows.push(...p.rows.map(r=>r.record));if(p.done)break;cursor=p.cursor;}return rows;};
 assert.ok((await page('rtc')).some(r=>r.parent==='grant/with slash'&&r.purposes?.[0]===CALL));
 const [ticket]=await page('rtc-tickets');assert.deepEqual(ticket.purposes,[CALL]);assert.deepEqual(ticket.principal,h.principal(1));
 const text=JSON.stringify(ticket);assert.equal(text.includes(new URL(link).searchParams.get('bindle_meta')),false);assert.equal(ticket.jti,undefined);
});

// RTC-i review L2: the one `claimed` raised after a durable effect. A won claim whose session ends while its leg
// certificate is being signed answers `claimed` (spec §7.2) although the claim record was committed. The answer is
// final, not effect-free (packages/federation/runtime.mjs NO_EFFECT_CODES): no certificate is handed out, the record
// keeps the claim, and a retry with the same leg key answers `claimed` again.
test('late claim: a won claim whose session ended during signing answers claimed, finally and retry-stably',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:4,expires_in:3600});
 const s=await a.open(h.principal(2),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();
 const svc=h.account(2).service,certFor=svc.certFor.bind(svc);let ended=0;
 svc.certFor=async input=>{const cert=await certFor(input);if(!ended++){const [[path,rec]]=await h.rows(2,'rtc/in/');await svc.store.transaction(async tx=>{await tx.put(path,{...rec,...await tx.get(path),state:'ended',endReason:'cancelled'});});}return cert;};
 const leg=await (await import("./helpers/rtc-wire-fixture.mjs")).keyPair();
 const first=await fault(b.run('rtc.claim',{...b.auth(),sid:s.sid,outcome:'accept',delegate:leg.jwk}));
 assert.equal(first?.code,'claimed','the late case answers claimed');
 const [[,rec]]=await h.rows(2,'rtc/in/');assert.equal(rec.claim?.jkt,leg.jkt,'the claim record is durable (not effect-free)');assert.equal(rec.mine?.certificate,null,'no certificate was stored');
 assert.equal((await fault(b.run('rtc.claim',{...b.auth(),sid:s.sid,outcome:'accept',delegate:leg.jwk})))?.code,'claimed','a retry answers claimed again');
});
