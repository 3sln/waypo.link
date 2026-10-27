// RTC-f: the built-in ice-relay/v1 occupant (packages/rtc/relay.mjs; spec docs/spec/rtc-signaling.md §3.3, §10, §12,
// §14; design §8.1 RTC-f). Engine level: every call is a dispatched ngin Action on the loopback host of
// tests/helpers/rtc-fixture.mjs, with a fake TURN provider and a fake spend authority (no real secret, no network).
// The Node runtime part checks only reachability (descriptor, manifest, account slice) with injected doubles.
// Local behaviour only: nothing here is evidence of Cloudflare conformance, relay spend enforcement or delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rtcHost,CALL,SYNC,FILES,APP,OTHER_APP,DAY,subOf,fault} from './helpers/rtc-fixture.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {RtcRelay,RELAY_LIMITS,RELAY_PLAN_BYTES,RELAY_EXPIRY_GRACE_MS,contractIceServers,validateIceRelayResult,legLive,leaseKey,turnAdapterFrom,relayConfigured} from '../packages/rtc/relay.mjs';
import {RELAY_RETRY_MS} from '../packages/rtc/relay-credentials.mjs';
import {CloudflareTurnAdapter} from '../packages/rtc/turn.mjs';
import {RTC_WIDENING,RTC_NEVER_GATED,RTC_SYSTEM_OPERATIONS,RTC_RELAY_OPERATIONS,RTC_RELAY_CONTRACT_OPERATIONS} from '../packages/app/domains/rtc.mjs';
import {exportInventory} from '../packages/runtime/export-contributors.mjs';
import {ICE_RELAY_CONTRACT,ICE_RELAY_SLOT,ICE_RELAY_SLOT_MANIFEST} from '../packages/rtc/extension.mjs';
import {createSlotOperation,nextSlotDispatch,recordSlotOutcome} from '../packages/federation/extensions.mjs';

const MIN=60000,ENVELOPE=RELAY_LIMITS.envelopeBytes,LAPSE=RELAY_LIMITS.ttlSeconds*1000+RELAY_EXPIRY_GRACE_MS;// a recorded credential has lapsed (review L1 grace)
const TURN_URLS=['stun:stun.cloudflare.com:3478','turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:3478?transport=tcp','turns:turn.cloudflare.com:5349?transport=tcp','turn:turn.cloudflare.com:53?transport=udp','turn:turn.cloudflare.com:80?transport=tcp','turns:turn.cloudflare.com:443?transport=tcp'];

/** A TURN provider double: credentials with expiry on the host clock, revocation, failure switches and a one-shot
 * `hook` run inside `issue` (to interleave other operations with an issuance; the provider stamps expiry after it).
 * `multi` makes one issuance carry two usernames (two server entries with distinct credentials). */
function fakeTurn(){
 const creds=new Map();let n=0;
 const t={clock:null,creds,issued:[],revoked:[],calls:{issue:0,revoke:0},failIssue:false,failRevoke:false,hook:null,multi:false,
  async issue({ttl}){t.calls.issue++;if(t.hook){const hook=t.hook;t.hook=null;await hook();}if(t.failIssue)throw Object.assign(new Error('down'),{code:'turn_unavailable'});
   const names=Array.from({length:t.multi?2:1},()=>'u'+(++n));for(const username of names){creds.set(username,{expiresAt:t.clock.now()+ttl*1000,revoked:false,ttl});t.issued.push(username);}
   return {iceServers:names.map(username=>({urls:[...TURN_URLS],username,credential:'secret-'+username})),expiresIn:ttl};},
  async revoke(username){t.calls.revoke++;if(t.failRevoke)throw new Error('revoke failed');const c=creds.get(username);if(c)c.revoked=true;t.revoked.push(username);},
  /** Usernames the provider would still accept. */
  live(){return [...creds].filter(([,c])=>!c.revoked&&c.expiresAt>t.clock.now()).map(([u])=>u);},
 };
 return t;
}
/** A spend authority double: records reservations, commits with their attribution (review M1) and releases; `hook`
 * runs once inside `reserve` (a slow authority). */
function fakeSpend(){const s={events:[],commits:[],reserves:[],enforced:true,hook:null,async reserve(i){if(s.hook){const hook=s.hook;s.hook=null;await hook();}s.events.push(['reserve',i.bytes,i.ttl]);s.reserves.push(i);return s.enforced?{enforced:true,id:s.events.length}:{enforced:false};},async commit(r,attribution){s.events.push(['commit',r.id]);s.commits.push(attribution);},async release(r){s.events.push(['release',r.id]);}};return s;}

/** The loopback host with an RtcRelay on every entity (no `defer`: the end path revokes at once). `wakes` records every
 * alarm request [owner, time] (review L3); `defer: true` records detached-pass requests in `defers` instead. */
async function relayHost({flags={},plan='plus',limits=RELAY_LIMITS,adapter=true,defer=false,...rest}={}){
 const turn=fakeTurn(),spend=fakeSpend(),plans=new Map(),wakes=[],defers=[];
 const h=await rtcHost({flags:{RTC_TURN_ENABLED:true,...flags},relay:a=>new RtcRelay({service:a.service,adapter:adapter?turn:null,spend,plan:async o=>plans.get(o)??plan,limits,wake:(owner,time)=>{wakes.push([owner,time]);},...defer?{defer:owner=>{defers.push(owner);}}:{}}),...rest});
 turn.clock=h.clock;return Object.assign(h,{turn,spend,plans,wakes,defers});
}
/** A connected cross-entity session: A (entity 1) calls B (entity 2) through B's ticket. */
async function connected(h,{purpose=CALL,media=['audio','video'],a=h.device(1),b=h.device(2)}={}){
 if(!a.endpoint)await a.register();if(!b.endpoint)await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[purpose],uses:8,expires_in:3600});
 const s=await a.open(h.principal(b.n),purpose,{media,basis:link});await a.invite(s);await h.pump();
 await b.listen();const c=await b.claim(s.sid);await b.accept(c);await h.pump();await a.listen();
 return {a,b,s,c,link};
}
/** A ringing cross-entity session (caller leg only). */
async function ringing(h,{a=h.device(1),b=h.device(2)}={}){
 if(!a.endpoint)await a.register();if(!b.endpoint)await b.register();
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses:8,expires_in:3600});
 const s=await a.open(h.principal(b.n),CALL,{media:['audio'],basis:link});await a.invite(s);await h.pump();await b.listen();
 return {a,b,s,link};
}
const creds=(d,s,extra={})=>d.run('rtc.relay-credentials',{...d.auth(),sid:s.sid,...extra});
const usernames=out=>[...new Set(out.ice_servers.map(x=>x.username))];
const leases=async(h,n)=>(await h.rows(n,'rtc/relay/')).map(([,v])=>v);
const revokedAll=(h,names)=>names.every(u=>h.turn.creds.get(u)?.revoked===true);
/** Every rtc/ value of entity n as JSON (never contains a credential). */
const dump=async(h,n)=>JSON.stringify(await h.rows(n,'rtc/'));

test('classification: credentials is widening and relay-contract only; the sweep is a never-gated system step',()=>{
 assert.ok(RTC_WIDENING.has('rtc.relay-credentials'));assert.ok(!RTC_NEVER_GATED.includes('rtc.relay-credentials'));
 assert.ok(RTC_NEVER_GATED.includes('rtc.relay-sweep'));assert.ok(RTC_SYSTEM_OPERATIONS.some(O=>O.operation==='rtc.relay-sweep'&&O.lifecycle==='suspended'));
 assert.deepEqual(RTC_RELAY_OPERATIONS.map(O=>O.operation),['rtc.relay-credentials']);assert.deepEqual({...RTC_RELAY_CONTRACT_OPERATIONS},{credentials:'rtc.relay-credentials'});
});

test('contract fitting and the generic ice-relay/v1 result check (spec §3.3)',()=>{
 const fitted=contractIceServers([{urls:TURN_URLS,username:'u',credential:'c'}]);
 assert.deepEqual(fitted.map(s=>s.urls.length),[4,2],'TURN URLs only, at most 4 per entry, same credential');
 assert.ok(fitted.every(s=>s.urls.every(u=>/^turns?:/.test(u))),'no STUN (an endpoint under relay policy never uses it)');
 assert.deepEqual(contractIceServers([{urls:['stun:stun.cloudflare.com:3478']}]),[],'nothing usable');
 assert.equal(contractIceServers(Array.from({length:6},(_,i)=>({urls:['turn:t.example:1','turn:t.example:2','turn:t.example:3','turn:t.example:4','turn:t.example:5'],username:'u'+i,credential:'c'}))).length,4,'at most 4 entries');
 const now=Date.UTC(2026,9,27);
 assert.ok(validateIceRelayResult({ice_servers:fitted,expires_at:now/1000+300},{now}));
 assert.ok(validateIceRelayResult({ice_servers:[{urls:'stun:stun.example:3478'}],expires_at:now/1000+1},{now}),'a third-party occupant may hand out STUN');
 for(const bad of [{ice_servers:fitted,expires_at:now/1000},{ice_servers:[],expires_at:now/1000+9},{ice_servers:[{urls:['turn:x.example']}],expires_at:now/1000+9},{ice_servers:[{urls:['http://x.example'],username:'u',credential:'c'}],expires_at:now/1000+9},
  {ice_servers:fitted,expires_at:now/1000+9,sid:'x'},{ice_servers:[{urls:Array(5).fill('turn:x.example'),username:'u',credential:'c'}],expires_at:now/1000+9},{ice_servers:Array(5).fill({urls:'stun:x.example'}),expires_at:now/1000+9}])
  assert.equal(validateIceRelayResult(bad,{now}),null,JSON.stringify(bad).slice(0,80));
});

test('credentials: the caller leg once opened, the callee leg once its accept won; bound to the session, never stored',async()=>{
 const h=await relayHost();const {a,b,s}=await ringing(h);
 assert.equal((await fault(creds(b,{sid:s.sid}))).code,'not_found','an unclaimed callee record has no leg');
 const out=await creds(a,s);
 assert.ok(validateIceRelayResult(out,{now:h.clock.now()}),'a valid ice-relay/v1 result');
 // Review M1(b): while the caller leg rings, the credential never outlives ring_until (not the full 300 s).
 const ringRec=(await h.rows(1,'rtc/out/')).find(([,v])=>v.sid===s.sid)[1];assert.equal(ringRec.state,'ringing');
 assert.ok(out.expires_at*1000<=ringRec.ringUntil&&ringRec.ringUntil-h.clock.now()<RELAY_LIMITS.ttlSeconds*1000,'capped at ring_until');
 assert.equal(h.turn.creds.get(usernames(out)[0]).expiresAt<=ringRec.ringUntil,true,'the provider TTL too');
 assert.deepEqual(h.spend.events.map(e=>e[0]),['reserve','commit']);assert.equal(h.spend.events[0][1],ENVELOPE);
 const c=await b.claim(s.sid);await b.accept(c);await h.pump();
 const outB=await creds(b,c);assert.equal(usernames(outB).length,1);
 assert.equal(outB.expires_at,Math.floor(h.clock.now()/1000)+RELAY_LIMITS.ttlSeconds,'an accepted (connected) leg gets the full TTL');
 const [la]=await leases(h,1);assert.deepEqual(Object.keys(la).sort(),['at','clientId','createdAt','endpoint','endsAt','expiresAt','issues','key','leg','month','reserved','sid','state','usernames','v'].sort());
 assert.equal(la.leg,s.leg.jkt);assert.deepEqual(la.usernames.map(u=>u.username),usernames(out));
 for(const n of [1,2])assert.ok(!(await dump(h,n)).includes('secret-'),'the credential is never stored');
 // A second request while the credential has more than the renewal window left is refused; inside the window a renewal
 // is issued and the credential still in use is NOT revoked (it lapses within 60 s).
 const again=await fault(creds(b,c));assert.equal(again.code,'rate_limited');assert.match(again.message,/already has relay credentials/);
 h.clock.advance(RELAY_LIMITS.ttlSeconds*1000-RELAY_LIMITS.renewWindowMs+1000);
 const renewed=await creds(b,c);assert.notDeepEqual(usernames(renewed),usernames(outB));
 assert.equal(h.turn.creds.get(usernames(outB)[0]).revoked,false,'early renewal keeps the old credential');
 assert.equal((await leases(h,2))[0].usernames.length,2);
 h.clock.advance(61000+RELAY_EXPIRY_GRACE_MS);for(const n of [1,2])await h.run(n,'rtc.relay-sweep',{actor:h.system(n)});
 assert.deepEqual((await leases(h,2))[0].usernames.map(u=>u.username),usernames(renewed),'expired usernames are dropped by the sweep');
 assert.equal(h.turn.calls.revoke,0,'without a revocation call (they already expired, and the leg is live)');
});

test('credentials are refused for non-live, foreign, other-endpoint, other-app and other-owner legs',async()=>{
 const h=await relayHost({entities:3});const {a,b,s,c}=await connected(h);
 const sibling=h.device(1);await sibling.register();
 const otherApp=h.device(1,{grant:h.grant(1,{clientId:OTHER_APP+'/client',origin:OTHER_APP})});await otherApp.register();
 const outsider=h.device(3);await outsider.register();
 // A refusal never reaches the TURN provider or the spend authority (refused before the provider call, not only when
 // the issuance is recorded).
 const nf=async(p,label)=>{const calls=h.turn.calls.issue,spent=h.spend.events.length;assert.equal((await fault(p))?.code,'not_found',label);assert.equal(h.turn.calls.issue,calls,`${label}: provider not called`);assert.equal(h.spend.events.length,spent,`${label}: no spend reservation`);};
 await nf(creds(outsider,s),'a third entity naming another entity\'s session (foreign leg)');
 await nf(creds(sibling,s),'the same owner and app, another endpoint: not its leg');
 await nf(otherApp.run('rtc.relay-credentials',{...a.auth(),sid:s.sid}),'another app of the same owner using A\'s endpoint');
 await nf(a.run('rtc.relay-credentials',{endpoint:a.endpoint,endpoint_secret:'wrong',sid:s.sid}),'a wrong endpoint secret');
 await nf(a.run('rtc.relay-credentials',{endpoint:a.endpoint,sid:s.sid}),'the endpoint identifier alone');
 await nf(creds(a,{sid:'A'.repeat(22)}),'an unknown session');
 assert.equal((await fault(h.run(1,'rtc.relay-credentials',{actor:{...a.actor,owner:subOf(2)},input:{...a.auth(),sid:s.sid}}))).code,'forbidden','another owner in this writer');
 assert.equal((await fault(h.run(2,'rtc.relay-credentials',{actor:b.actor,input:{...a.auth(),sid:s.sid}}))).code,'not_found','A\'s endpoint at B\'s writer');
 assert.equal((await fault(a.run('rtc.relay-credentials',{...a.auth(),sid:s.sid,extra:1}))).code,'invalid_args');
 assert.equal((await fault(a.run('rtc.relay-credentials',{...a.auth()}))).code,'invalid_args');
 // Live legs of both parties do work (B through its own claimed record).
 assert.ok(await creds(a,s));assert.ok(await creds(b,c));
 // A declined callee leg, an ended session and a ringing session past ring_until are not live.
 const d=await ringing(h);const declined=await d.b.claim(d.s.sid,'decline');await nf(creds(d.b,declined),'declined callee');
 await a.end(s);await h.pump();await nf(creds(a,s),'ended (caller)');await nf(creds(b,c),'ended (callee)');
 const r=await ringing(h);h.clock.advance(121000);await nf(creds(r.a,r.s),'ringing past ring_until, before any tick');
 assert.equal(legLive({state:'connected',role:'callee',endsAt:Infinity,mine:{jkt:'x',certificate:'c',endpoint:'e1'},claim:{outcome:'accept',endpoint:'e2'}},0),false,'the claimant must be the leg');
 // Less than 10 s of session life left: refused. Credentials issued near the end never outlive the session.
 const late=await connected(h,{a:h.device(1),b:h.device(2)});h.clock.advance(86400000-130000);
 const out=await creds(late.a,late.s);assert.ok(out.expires_at*1000<=late.s.result.expires_at*1000+86400000);
 const rec=(await h.rows(1,'rtc/out/')).find(([,v])=>v.sid===late.s.sid)[1];assert.ok(out.expires_at*1000<=rec.endsAt,'TTL capped by the session\'s remaining life');
 assert.ok(h.turn.creds.get(usernames(out)[0]).ttl<RELAY_LIMITS.ttlSeconds);
 h.clock.advance(125000);await nf(creds(late.b,late.c),'under 10 s left');
});

test('revocation on every end path: hangup, cancel, decline, unregister, revoke-endpoint, end-session, app revoked or narrowed, ring timeout, peer control, expiry',async()=>{
 const h=await relayHost({entities:3});
 // RTC wargame M3 allows 8 live endpoints per application: each scenario unregisters the previous scenario's devices.
 const used=[],dev=n=>{const d=h.device(n);used.push(d);return d;},tidy=async()=>{for(const d of used.splice(0))if(d.endpoint)await fault(d.run('rtc.unregister',d.auth()));await h.pump();};
 // RTC-11 allows 6 invites per (caller, callee) in 10 min: each scenario starts in a fresh window.
 const both=async()=>{await tidy();h.clock.advance(11*MIN);const x=await connected(h,{a:dev(1),b:dev(2)});return {...x,ua:usernames(await creds(x.a,x.s)),ub:usernames(await creds(x.b,x.c))};};
 const paths={
  'hangup (caller)':async x=>{await x.a.end(x.s);await h.pump();},
  'hangup (callee)':async x=>{await x.b.end(x.c);await h.pump();},
  'unregister (caller endpoint; the callee ends by control statement)':async x=>{await x.a.run('rtc.unregister',x.a.auth());await h.pump();},
  'owner revoke-endpoint (callee)':async x=>{await h.run(2,'rtc.revoke-endpoint',{input:{endpoint:x.b.endpoint}});await h.pump();},
  'owner end-session':async x=>{await h.run(1,'rtc.end-session',{input:{sid:x.s.sid}});await h.pump();},
  'app revoked (callee)':async x=>{await h.run(2,'rtc.lifecycle',{actor:h.system(2),input:{event:'app-revoked',clientId:APP+'/client'}});await h.pump();},
  'app narrowed away from the purpose (caller)':async x=>{await h.run(1,'rtc.lifecycle',{actor:h.system(1),input:{event:'app-narrowed',clientId:APP+'/client',purposes:[SYNC]}});await h.pump();},
 };
 for(const [label,end] of Object.entries(paths)){
  const x=await both();assert.ok(!revokedAll(h,x.ua)&&!revokedAll(h,x.ub),label);
  await end(x);
  assert.ok(revokedAll(h,x.ua),`${label}: caller leg revoked on the end path (no sweep ran)`);assert.ok(revokedAll(h,x.ub),`${label}: callee leg revoked`);
  for(const n of [1,2])for(const l of await leases(h,n))assert.ok(!x.ua.concat(x.ub).some(u=>l.usernames.some(v=>v.username===u)),`${label}: no lease keeps them`);
 }
 // Caller-only legs: cancel while ringing, the callee's decline, and the ring timeout (rtc.tick).
 for(const [label,end] of Object.entries({
  cancel:async r=>{await r.a.cancel(r.s);},
  decline:async r=>{const c=await r.b.claim(r.s.sid,'decline');await r.b.decline(c);await h.pump();},
  'ring timeout':async r=>{h.clock.advance(121000);await h.tick(1);},
 })){await tidy();h.clock.advance(11*MIN);const r=await ringing(h,{a:dev(1),b:dev(2)});const u=usernames(await creds(r.a,r.s));await end(r);
  // At the ring timeout the ringing leg's credential has already lapsed (its TTL is capped at ring_until, review M1).
  if(label==='ring timeout')assert.ok(!h.turn.live().some(v=>u.includes(v)),label);else assert.ok(revokedAll(h,u),label);}
 // The 24 h session cap: a renewal near the end, then expiry through rtc.tick.
 await tidy();h.clock.advance(11*MIN);const x=await connected(h,{a:dev(1),b:dev(2)});h.clock.advance(86400000-200000);const u=usernames(await creds(x.a,x.s));
 assert.equal(h.turn.creds.get(u[0]).ttl,200,'TTL = the session\'s remaining life');h.clock.advance(200000);await h.tick(1);
 const rec=(await h.rows(1,'rtc/out/')).find(([,v])=>v.sid===x.s.sid)[1];assert.equal(rec.state,'ended');assert.equal(rec.endReason,'expired');
 assert.ok(!h.turn.live().some(v=>u.includes(v)),'at expiry the credential has lapsed with the session');
 // Ending an already-ended session revokes nothing more, and leases of dead legs are deleted by the sweep.
 const before=h.turn.calls.revoke;for(const n of [1,2])await h.run(n,'rtc.relay-sweep',{actor:h.system(n)});
 assert.equal(h.turn.calls.revoke,before);for(const n of [1,2])assert.equal((await leases(h,n)).length,0,'no lease outlives its leg');
 assert.equal((await fault(h.run(1,'rtc.relay-sweep',{actor:h.owner(1)}))).code,'forbidden','system only');
});

test('expiry and failures: TURN or spend failure refunds, a revocation failure is retried until expiry, a stale issuing marker clears',async()=>{
 const h=await relayHost();const {a,b,s,c}=await connected(h);
 const use=async n=>(await h.rows(n,'rtc/relay-use/m/')).map(([,v])=>v)[0];
 h.turn.failIssue=true;assert.equal((await fault(creds(a,s))).code,'rate_limited');h.turn.failIssue=false;
 assert.equal((await use(1)).bytes,0,'a failed issuance is refunded');assert.deepEqual(h.spend.events.map(e=>e[0]),['reserve','release']);
 const [lease]=await leases(h,1);assert.equal(lease.state,'idle');assert.equal(lease.reserved,0);assert.equal(lease.issues,0);
 h.spend.enforced=false;assert.equal((await fault(creds(a,s))).code,'rate_limited','no enforced spend reservation, no credential');h.spend.enforced=true;
 assert.equal(h.turn.calls.issue,1,'the provider is never called without an enforced reservation');assert.equal((await use(1)).bytes,0);
 // A session that ends while the provider issues: the credential is revoked and never handed out.
 h.turn.hook=async()=>{await b.end(c);await h.pump();};
 assert.equal((await fault(creds(a,s))).code,'not_found');assert.ok(revokedAll(h,[h.turn.issued.at(-1)]),'issued during the end, revoked at once');
 assert.equal((await use(1)).bytes,0,'refunded: nothing can carry traffic');
 // A revocation failure keeps the username for a retry (and keeps the reservation) until the credential expires.
 const x=await connected(h,{a:h.device(1),b:h.device(2)});const u=usernames(await creds(x.a,x.s));
 h.turn.failRevoke=true;await x.a.end(x.s);await h.pump();
 assert.equal((await leases(h,1)).find(l=>l.sid===x.s.sid).usernames.length,1,'kept for the sweep');
 const swept=await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.equal(swept.pending,1);assert.ok(swept.wakeAt>h.clock.now());
 const tick=await h.tick(1);assert.ok(tick.wakeAt&&tick.wakeAt<=h.clock.now()+MIN+1000,'the alarm comes back for it');
 h.turn.failRevoke=false;await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.ok(revokedAll(h,u));assert.equal((await leases(h,1)).filter(l=>l.sid===x.s.sid).length,0);
 // Without a working provider the username is dropped once its credential expired anyway (no call).
 const y=await connected(h,{a:h.device(1),b:h.device(2)});await creds(y.a,y.s);h.turn.failRevoke=true;await y.a.end(y.s);await h.pump();
 h.clock.advance(RELAY_LIMITS.ttlSeconds*1000+RELAY_EXPIRY_GRACE_MS+1);const calls=h.turn.calls.revoke;await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});
 assert.equal(h.turn.calls.revoke,calls,'expired: no call');assert.equal((await leases(h,1)).filter(l=>l.sid===y.s.sid).length,0);h.turn.failRevoke=false;
 // A crash between the two transactions leaves an 'issuing' marker: refused for 60 s, then cleared by the sweep.
 const z=await connected(h,{a:h.device(1),b:h.device(2)});
 const zrec=(await h.rows(1,'rtc/out/')).find(([,v])=>v.sid===z.s.sid);const lk=leaseKey(zrec[0]);
 await h.account(1).store.put(lk,{v:1,key:zrec[0],sid:z.s.sid,leg:z.s.leg.jkt,endpoint:z.a.endpoint,clientId:APP+'/client',endsAt:zrec[1].endsAt,state:'issuing',at:h.clock.now(),issues:1,reserved:ENVELOPE,usernames:[],expiresAt:0});
 assert.equal((await fault(creds(z.a,z.s))).code,'rate_limited');h.clock.advance(61000);
 await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.equal((await h.account(1).store.get(lk)).state,'idle');assert.ok(await creds(z.a,z.s));
});

test('review M1(a): commit tells the spend authority which TURN usernames it funds, until when, for which owner and leg',async()=>{
 const h=await relayHost();const {a,b,s,c}=await connected(h);h.turn.multi=true;
 const out=await creds(a,s);const [att]=h.spend.commits;
 assert.deepEqual(att.usernames,usernames(out),'every username of the credential');assert.equal(att.usernames.length,2);
 assert.equal(att.owner,subOf(1));assert.equal(att.sid,s.sid);assert.equal(att.leg,s.leg.jkt);assert.equal(att.endpoint,a.endpoint);assert.equal(att.clientId,APP+'/client');
 assert.equal(att.bytes,ENVELOPE);assert.equal(att.ttl,RELAY_LIMITS.ttlSeconds);assert.equal(typeof att.session,'string');
 for(const u of att.usernames)assert.ok(att.expiresAt>=h.turn.creds.get(u).expiresAt,'the expiry is an upper bound of the provider\'s');
 assert.ok(!JSON.stringify(att).includes('secret-'),'never the credential');
 assert.deepEqual({owner:h.spend.reserves[0].owner,sid:h.spend.reserves[0].sid,leg:h.spend.reserves[0].leg},{owner:subOf(1),sid:s.sid,leg:s.leg.jkt},'reserve names the leg too');
 h.turn.multi=false;await creds(b,c);assert.equal(h.spend.commits[1].leg,c.leg?.jkt??h.spend.commits[1].leg);assert.equal(h.spend.commits[1].owner,subOf(2));
});

test('review L1: the TTL is recomputed after the spend reservation, and the recorded expiry never precedes the provider\'s',async()=>{
 const h=await relayHost();const x=await connected(h);h.clock.advance(86400000-200000);
 // A slow spend authority (50 s) near the session's end: the provider gets what is left then, not at the request.
 h.spend.hook=async()=>{h.clock.advance(50000);};
 const out=await creds(x.a,x.s);const [u]=usernames(out);
 const rec=(await h.rows(1,'rtc/out/')).find(([,v])=>v.sid===x.s.sid)[1];
 assert.ok(h.turn.creds.get(u).expiresAt<=rec.endsAt,'the provider credential never outlives the session');assert.equal(h.turn.creds.get(u).ttl,150);
 // A slow provider (20 s between the TTL and its answer): the provider's credential lapses 20 s after "before + ttl".
 const y=await connected(h,{a:h.device(1),b:h.device(2)});h.turn.hook=async()=>{h.clock.advance(20000);};
 const outY=await creds(y.a,y.s);const [v]=usernames(outY);const providerExpiry=h.turn.creds.get(v).expiresAt;
 assert.ok(outY.expires_at*1000<=providerExpiry,'the client is told the conservative expiry');
 const lease=(await leases(h,1)).find(l=>l.sid===y.s.sid);assert.ok(lease.usernames[0].expiresAt>=providerExpiry,'recorded expiry is an upper bound');
 // The leg ends while revocation fails; after "before + ttl" but before the provider's expiry, the sweep must keep it.
 h.turn.failRevoke=true;await y.a.end(y.s);await h.pump();h.clock.advance(RELAY_LIMITS.ttlSeconds*1000-15000);// before + ttl + 5 s
 assert.ok(h.turn.live().includes(v),'the provider still accepts it');
 await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});
 assert.ok((await leases(h,1)).some(l=>l.usernames.some(x=>x.username===v)),'not dropped while still valid');
 assert.ok(await h.account(1).relay.pending(subOf(1))>=1,'the deletion drain still waits for it');
 h.turn.failRevoke=false;await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.ok(revokedAll(h,[v]),'revoked once revocation works');
});

test('review L2: the per-lease username cap counts the new usernames; an unexpired username is never dropped',async()=>{
 const h=await relayHost();const {a,s}=await connected(h);h.turn.multi=true;
 // Seven unexpired usernames recorded on the leg (inside the renewal window): another issuance would need room for up
 // to L.servers more, so it is refused before the provider is called, and none of the seven is dropped.
 const rec=(await h.rows(1,'rtc/out/')).find(([,v])=>v.sid===s.sid);const lk=leaseKey(rec[0]),exp=h.clock.now()+30000;
 const seven=Array.from({length:7},(_,i)=>({username:'held'+i,expiresAt:exp}));
 await h.account(1).store.put(lk,{v:1,key:rec[0],sid:s.sid,leg:s.leg.jkt,endpoint:a.endpoint,clientId:APP+'/client',endsAt:rec[1].endsAt,state:'idle',at:0,issues:1,reserved:ENVELOPE,usernames:seven,expiresAt:exp});
 const calls=h.turn.calls.issue,refused=await fault(creds(a,s));
 assert.equal(refused.code,'rate_limited');assert.match(refused.message,/Too many relay credentials/);assert.equal(h.turn.calls.issue,calls,'provider not called');
 assert.deepEqual((await h.account(1).store.get(lk)).usernames.map(u=>u.username),seven.map(u=>u.username),'all seven kept');
 // Unrevoked usernames of a failed issuance are kept (room was reserved), whatever else the lease holds.
 const four=seven.slice(0,4);await h.account(1).store.put(lk,{...(await h.account(1).store.get(lk)),usernames:four});
 h.turn.failRevoke=true;h.turn.hook=async()=>{await a.end(s);await h.pump();};assert.equal((await fault(creds(a,s))).code,'not_found');
 const kept=(await h.account(1).store.get(lk)).usernames.map(u=>u.username);
 assert.deepEqual(kept.slice(0,4),four.map(u=>u.username));assert.equal(kept.length,6,'both new usernames kept unrevoked');assert.ok(kept.length<=RELAY_LIMITS.usernames);
});

test('review L3: unrevoked usernames re-arm an alarm (and a detached pass) at min(expiry, now + retry); the kill switch acts within 300 s',async()=>{
 const h=await relayHost({defer:true});const x=await connected(h);
 // Issuance race with revocation failing: the orphan is kept and the catch path asks for a detached pass and an alarm.
 h.turn.failRevoke=true;h.turn.hook=async()=>{await h.run(1,'rtc.end-session',{input:{sid:x.s.sid}});h.defers.length=0;h.wakes.length=0;};// only the catch path's requests count
 const t0=h.clock.now();assert.equal((await fault(creds(x.a,x.s))).code,'not_found');
 assert.ok(h.defers.includes(subOf(1)),'a detached revocation pass is requested from the credentials catch path');
 const wake=h.wakes.find(([o])=>o===subOf(1));assert.ok(wake,'an alarm is requested');assert.ok(wake[1]<=t0+RELAY_RETRY_MS&&wake[1]>t0,'at min(expiry, now + retry)');
 // The (detached) sweep re-arms itself while the revocation still fails.
 h.wakes.length=0;const swept=await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.equal(swept.pending,1);
 assert.ok(h.wakes.some(([o,t])=>o===subOf(1)&&t<=h.clock.now()+RELAY_RETRY_MS),'the sweep re-arms');
 h.turn.failRevoke=false;h.wakes.length=0;await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.equal(h.wakes.length,0,'nothing pending: no alarm');
 assert.ok(revokedAll(h,[h.turn.issued.at(-1)]));
 // An orphan on a still-live leg (the commit failed) is revoked by the sweep too, and does not block a renewal.
 const y=await connected(h,{a:h.device(1),b:h.device(2)});h.turn.failRevoke=true;const commit=h.spend.commit;h.spend.commit=async()=>{throw new Error('authority down');};
 assert.equal((await fault(creds(y.a,y.s))).code,'rate_limited');h.spend.commit=commit;const orphan=h.turn.issued.at(-1);
 h.turn.failRevoke=false;assert.ok(await creds(y.a,y.s),'an orphan never counts as the leg\'s current credential');
 await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.ok(revokedAll(h,[orphan]),'the orphan is revoked although the leg is live');
 // Kill switch: with a flag off nothing is issued, and a held credential lapses by its expiry (at most 300 s) even if no
 // sweep ever runs.
 const z=await connected(h,{a:h.device(1),b:h.device(2)});const [held]=usernames(await creds(z.a,z.s));h.flags.state.names.RTC_TURN_ENABLED=false;
 assert.equal((await fault(creds(z.b,z.c))).code,'not_found');h.clock.advance(RELAY_LIMITS.ttlSeconds*1000);assert.ok(!h.turn.live().includes(held),'lapsed within 300 s');
});

test('review L4: a flag briefly off revokes but keeps the lease of a live leg, so the per-leg budget is not reset',async()=>{
 const h=await relayHost({limits:{...RELAY_LIMITS,sessionBytes:2*ENVELOPE}});const {a,s}=await connected(h);
 const [u]=usernames(await creds(a,s));h.flags.state.names.RTC_TURN_ENABLED=false;await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});
 assert.ok(revokedAll(h,[u]),'revoked while the flag is off');
 const [lease]=await leases(h,1);assert.ok(lease,'the live leg keeps its lease');assert.equal(lease.reserved,ENVELOPE);assert.deepEqual(lease.usernames,[]);
 h.flags.state.names.RTC_TURN_ENABLED=true;assert.ok(await creds(a,s),'the second envelope');h.clock.advance(LAPSE);
 assert.match((await fault(creds(a,s))).message,/used its relay allowance/,'the per-leg budget survived the flag flip');
 // A dead leg's empty lease is still deleted.
 await a.end(s);await h.pump();await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.equal((await leases(h,1)).length,0);
});

test('quotas: plan allowance per month, free plan, per-session bytes, concurrent legs, hourly issuance, lease rows',async()=>{
 // Paid: 1 GB a month = 8 envelopes. A small per-session cap and a short renewal path keep this fast.
 const limits={...RELAY_LIMITS,sessionBytes:3*ENVELOPE,accountLegs:2,issuesPerHour:20};
 const h=await relayHost({plan:'paid',limits,entities:4});
 assert.equal(RELAY_PLAN_BYTES.paid/ENVELOPE,8);
 const renew=async(d,s)=>{const out=await creds(d,s);h.clock.advance(LAPSE);return out;};
 const one=await connected(h);for(let i=0;i<3;i++)await renew(one.a,one.s);
 assert.match((await fault(creds(one.a,one.s))).message,/used its relay allowance/,'per-session bytes: 3 envelopes');
 // Concurrent legs: two legs of entity 1 may hold credentials at once; a third waits.
 const two=await connected(h,{a:h.device(1),b:h.device(3)}),three=await connected(h,{a:h.device(1),b:h.device(4)});
 await creds(two.a,two.s);await creds(three.a,three.s);
 const four=await connected(h,{a:h.device(1),b:h.device(2)});
 assert.equal((await fault(creds(four.a,four.s))).code,'rate_limited','concurrent relayed legs');
 h.clock.advance(LAPSE);
 // Monthly allowance: 8 envelopes in all this month (3 + 2 so far).
 await creds(four.a,four.s);const five=await connected(h,{a:h.device(1),b:h.device(3)});await creds(five.a,five.s);h.clock.advance(LAPSE);
 const six=await connected(h,{a:h.device(1),b:h.device(4)});await creds(six.a,six.s);
 const use=(await h.rows(1,'rtc/relay-use/m/'))[0][1];assert.equal(use.bytes,8*ENVELOPE);
 const seven=await connected(h,{a:h.device(1),b:h.device(2)});const q7=await fault(creds(seven.a,seven.s));assert.equal(q7.code,'rate_limited');assert.match(q7.message,/allowance for this month/);
 // A new month starts a new allowance; the month before last is pruned by the sweep.
 h.clock.set(Date.UTC(2026,10,1,0,5));const nov=await connected(h,{a:h.device(1),b:h.device(3)});assert.ok(await creds(nov.a,nov.s));
 h.clock.set(Date.UTC(2026,11,2));await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});
 assert.deepEqual((await h.rows(1,'rtc/relay-use/m/')).map(([k])=>k),['rtc/relay-use/m/2026-11'],'current and previous month only');
 // Free: no hosted relay.
 const f=await relayHost();f.plans.set(subOf(1),'free');const fr=await connected(f);
 assert.equal((await fault(creds(fr.a,fr.s))).code,'forbidden');assert.equal(f.turn.calls.issue,0);
 assert.equal((await f.rows(1,'rtc/relay-use/')).length,0,'nothing reserved');
 // Hourly issuance window.
 const g=await relayHost({limits:{...RELAY_LIMITS,issuesPerHour:2}});const g1=await connected(g);
 await creds(g1.a,g1.s);await creds(g1.b,g1.c);g.clock.advance(RELAY_LIMITS.ttlSeconds*1000-30000);await creds(g1.a,g1.s);
 assert.match((await fault(creds(g1.a,g1.s))).message,/already has relay credentials/);g.clock.advance(RELAY_LIMITS.ttlSeconds*1000-30000);
 assert.match((await fault(creds(g1.a,g1.s))).message,/Too many relay requests/,'2 issuances per hour for entity 1');
 g.clock.advance(3600000);assert.ok(await creds(g1.a,g1.s),'the window resets');
 // Lease rows are bounded.
 const k=await relayHost({limits:{...RELAY_LIMITS,leases:1}});const k1=await connected(k),k2=await connected(k,{a:k.device(1),b:k.device(2)});
 await creds(k1.a,k1.s);assert.equal((await fault(creds(k2.a,k2.s))).code,'rate_limited','lease rows');
});

/** Review M2: one `credentials` call through the federation runtime's real `dispatch` (journal, error allow-list and
 * faultResult; packages/federation/runtime.mjs) with the runtime's own relay dispatcher classification
 * (packages/runtime/federation.mjs `readOnly`, `retainResult`), executed against the engine-level occupant. Returns the
 * RPC result or {__federationError}. */
async function federationDispatch(h,d,args){
 const {FederationController}=await import('../packages/federation/runtime.mjs');const {federationControllerOptions}=await import('../packages/runtime/federation.mjs');
 const OWNER=subOf(d.n),ORIGIN='https://rtc-relay-dispatch.example';
 const real=federationControllerOptions({config:{APP_ORIGIN:ORIGIN},repository:{get:async()=>({id:OWNER,handle:'alice',status:'active'})},accounts:{get:()=>({invoke:async()=>[]})},owner:OWNER}).dispatcher;
 const rows=h.federationRows??=new Map();
 const metadata={transaction:async fn=>fn({get:async k=>structuredClone(rows.get(k)),set:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async p=>[...rows].filter(([k])=>k.startsWith(p)).map(([key,value])=>({key,value}))})};
 const dispatcher={durableJournal:real.durableJournal,readOnly:real.readOnly,retainResult:real.retainResult,execute:ctx=>d.run('rtc.relay-credentials',ctx.args)};
 const subject=`${ORIGIN}/entities/${OWNER}`;
 return FederationController.prototype.dispatch.call({dispatcher,metadata,clock:()=>h.clock.now()},{subject,clientId:APP+'/client',tx:crypto.randomUUID(),resource:`${subject}/relay`,contract:ICE_RELAY_CONTRACT,method:'credentials',args:{...d.auth(),...args},scope:{},epoch:1,resourceGeneration:OWNER},crypto);
}
/** The ordered `ice-relay/v1` slot (built-in occupant first, a third-party relay second): records the built-in
 * occupant's federation outcome and returns the next dispatch's occupant id (null: failover stopped). */
function failoverAfter(result){
 let state=createSlotOperation(ICE_RELAY_SLOT_MANIFEST,[{id:'built-in',status:'available',credentialCurrent:true},{id:'third-party',status:'available',credentialCurrent:true}],{contracts:{[ICE_RELAY_CONTRACT]:{}}});
 const first=nextSlotDispatch(state,{tx:crypto.randomUUID()});assert.equal(first.dispatch.occupant.id,'built-in');
 const error=result?.__federationError;state=recordSlotOutcome(first.state,error?{tx:first.dispatch.tx,code:error.code}:{tx:first.dispatch.tx,ok:true});
 return nextSlotDispatch(state,{tx:crypto.randomUUID()}).dispatch?.occupant.id??null;
}
test('refusals before any credential exists reach the next relay occupant through the federation dispatch path (review M2)',async()=>{
 const seen=[];
 const through=async(h,d,s,label)=>{const out=await federationDispatch(h,d,{sid:s.sid});const code=out?.__federationError?.code;seen.push(code);
  assert.notEqual(code,'indeterminate',`${label}: a refusal is never indeterminate`);assert.equal(failoverAfter(out),'third-party',`${label}: failover reaches the next occupant (${code})`);};
 const free=await relayHost();free.plans.set(subOf(1),'free');const x=await connected(free);await through(free,x.a,x.s,'not included in the plan');
 const off=await relayHost();const y=await connected(off);off.flags.state.names.RTC_TURN_ENABLED=false;await through(off,y.a,y.s,'flag off');
 const down=await relayHost();const z=await connected(down);down.turn.failIssue=true;await through(down,z.a,z.s,'provider down');
 down.turn.failIssue=false;down.spend.enforced=false;await through(down,z.a,z.s,'no enforced spend reservation');down.spend.enforced=true;
 const unconfigured=await relayHost({adapter:false});const u0=await connected(unconfigured);await through(unconfigured,u0.a,u0.s,'unconfigured');
 const lim=await relayHost({limits:{...RELAY_LIMITS,sessionBytes:ENVELOPE,issuesPerHour:1}});const w=await connected(lim);
 await creds(w.a,w.s);await through(lim,w.a,w.s,'already issued');await creds(w.b,w.c);// another entity: its own window
 lim.clock.advance(LAPSE);await through(lim,w.a,w.s,'per-session bytes');
 const q=await relayHost({plan:'paid'});const u=await connected(q);const month=new Date(q.clock.now()).toISOString().slice(0,7);
 await q.account(1).store.put(`rtc/relay-use/m/${month}`,{month,bytes:RELAY_PLAN_BYTES.paid,issues:8});await through(q,u.a,u.s,'monthly allowance');
 const hr=await relayHost({limits:{...RELAY_LIMITS,issuesPerHour:1}});const v=await connected(hr);await creds(v.a,v.s);hr.clock.advance(LAPSE);await through(hr,v.a,v.s,'hourly window');
 const busy=await relayHost();const bz=await connected(busy);busy.turn.hook=async()=>{await through(busy,bz.a,bz.s,'issuance in flight');};await creds(bz.a,bz.s);
 assert.deepEqual(seen,['forbidden','not_found','rate_limited','rate_limited','rate_limited','rate_limited','rate_limited','rate_limited','rate_limited','rate_limited']);
 // A success is a success (journal: the credential itself is never retained), and stops the ordered selection.
 const ok=await relayHost();const k=await connected(ok);const out=await federationDispatch(ok,k.a,{sid:k.s.sid});assert.ok(validateIceRelayResult(out,{now:ok.clock.now()}));assert.equal(failoverAfter(out),null);
 assert.ok(![...ok.federationRows.values()].some(r=>JSON.stringify(r).includes('secret-')),'never journaled');
});

test('flag combinations: both flags are needed for the owner; turning either off revokes held credentials at the next sweep',async()=>{
 for(const [signaling,turn] of [[false,false],[true,false],[false,true],[true,true]]){
  const h=await relayHost({flags:{RTC_TURN_ENABLED:true}});const {a,s}=await connected(h);
  h.flags.state.names.RTC_SIGNALING_ENABLED=signaling;h.flags.state.names.RTC_TURN_ENABLED=turn;
  const out=await fault(creds(a,s));
  if(signaling&&turn)assert.equal(out,null);else{assert.equal(out.code,'not_found',`signaling=${signaling} turn=${turn}`);assert.equal(h.turn.calls.issue,0);assert.equal((await h.rows(1,'rtc/relay')).length,0,'nothing written');}
 }
 // Per owner: TURN denied for entity 1 only.
 const h=await relayHost();const {a,b,s,c}=await connected(h);h.flags.deny(subOf(1),'RTC_TURN_ENABLED');
 assert.equal((await fault(creds(a,s))).code,'not_found');assert.ok(await creds(b,c));h.flags.allow(subOf(1),'RTC_TURN_ENABLED');
 // Kill switch: credentials held while a flag goes off are revoked by the sweep (revocation is never gated).
 const ua=usernames(await creds(a,s));h.flags.state.names.RTC_TURN_ENABLED=false;await h.tick(1);assert.ok(revokedAll(h,ua),'TURN off');
 h.flags.state.names.RTC_TURN_ENABLED=true;h.clock.advance(RELAY_LIMITS.ttlSeconds*1000);const ub=usernames(await creds(b,c));
 h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');await h.run(2,'rtc.relay-sweep',{actor:h.system(2)});assert.ok(revokedAll(h,ub),'signaling off');
 // Not configured: no adapter is 503 (both flags on); no relay attached is the uniform 404.
 const u=await relayHost({adapter:false});const x=await connected(u);assert.equal((await fault(creds(x.a,x.s))).code,'rate_limited');
 assert.deepEqual(u.spend.events,[],'refused before any spend reservation');assert.equal((await u.rows(1,'rtc/relay')).length,0,'nothing written');
 const plain=await rtcHost({flags:{RTC_TURN_ENABLED:true}});const y=await connected(plain);assert.equal((await fault(y.a.run('rtc.relay-credentials',{...y.a.auth(),sid:y.s.sid}))).code,'not_found');
 assert.deepEqual(await plain.run(1,'rtc.relay-sweep',{actor:plain.system(1)}),{revoked:0,pending:0,wakeAt:null});
});

test('account deletion: rtc.lifecycle deletion revokes every leg; pending revocations hold the drain until expiry',async()=>{
 const h=await relayHost();const {a,b,s,c}=await connected(h);const r=await ringing(h,{a:h.device(1),b:h.device(2)});
 const u=[...usernames(await creds(a,s)),...usernames(await creds(r.a,r.s))];
 await h.run(1,'rtc.lifecycle',{actor:h.system(1),input:{event:'deletion'}});
 assert.ok(revokedAll(h,u));assert.equal(await h.account(1).relay.pending(subOf(1)),0);
 await h.run(1,'rtc.relay-sweep',{actor:h.system(1)});assert.equal((await leases(h,1)).length,0);
 assert.equal((await fault(creds(a,s))).code,'not_found','nothing after the deletion step');
 // B's leg ends by A's control statement, and its credential goes with it.
 const ub=usernames(await creds(b,c).catch(()=>({ice_servers:[]})));await h.pump();if(ub.length)assert.ok(revokedAll(h,ub));
 // With revocation failing, the deletion drain waits (pending) until the credential has expired.
 const h2=await relayHost();const x=await connected(h2);await creds(x.a,x.s);h2.turn.failRevoke=true;
 await h2.run(1,'rtc.lifecycle',{actor:h2.system(1),input:{event:'deletion'}});
 assert.equal(await h2.account(1).relay.pending(subOf(1)),1,'the drain stays pending');
 h2.clock.advance(RELAY_LIMITS.ttlSeconds*1000+1);assert.equal(await h2.account(1).relay.pending(subOf(1)),1,'review L1: the recorded expiry is an upper bound (grace)');
 h2.clock.advance(RELAY_EXPIRY_GRACE_MS);assert.equal(await h2.account(1).relay.pending(subOf(1)),0,'expired: nothing can carry traffic');
});

test('export inventory: relay leases and allowance counters are excluded with reasons',()=>{
 const rows=exportInventory(['rtc/relay/x','rtc/relay-use/m/2026-10','rtc/relay-use/h']);
 for(const r of rows){assert.ok(!r.contributor,r.prefix);assert.match(r.reason,/^(Transient|Derived): RTC relay/);}
});

test('adapter configuration: an injected double or the operator keys; never configured without a spend authority',async()=>{
 const double={issue:async()=>({}),revoke:async()=>{}};
 assert.equal(turnAdapterFrom({RTC_TURN_ADAPTER:double}),double);assert.equal(turnAdapterFrom({}),null);assert.equal(turnAdapterFrom({CLOUDFLARE_TURN_KEY_ID:'k'}),null);
 assert.ok(turnAdapterFrom({CLOUDFLARE_TURN_KEY_ID:'key_example',CLOUDFLARE_TURN_API_TOKEN:'test-token'}) instanceof CloudflareTurnAdapter);
 assert.equal(relayConfigured({RTC_TURN_ADAPTER:double}),false,'no spend authority: the relay-spend budget gate');
 assert.equal(relayConfigured({RTC_TURN_ADAPTER:double,RTC_RELAY_SPEND:fakeSpend()}),true);
 // The CloudflareTurnAdapter under the occupant, with an injected fetch (no network, no real key).
 const calls=[];const fetch=async(url,options)=>{calls.push({url:String(url),options});if(String(url).endsWith('/revoke'))return new Response(null,{status:204});
  return new Response(JSON.stringify({iceServers:[{urls:TURN_URLS,username:'cf-user',credential:'cf-cred'}]}),{status:201});};
 const adapter=new CloudflareTurnAdapter({keyId:'key_example',apiToken:'test-token',fetch});
 const spend=fakeSpend();const h=await rtcHost({flags:{RTC_TURN_ENABLED:true},relay:a=>new RtcRelay({service:a.service,adapter,spend,plan:async()=>'plus'})});
 const {a,s}=await connected(h);const out=await creds(a,s);assert.deepEqual(usernames(out),['cf-user']);assert.ok(out.ice_servers.every(x=>x.urls.length<=4));
 assert.equal(JSON.parse(calls[0].options.body).ttl,300);await a.end(s);await h.pump();assert.ok(calls.at(-1).url.endsWith('/credentials/cf-user/revoke'));
});

// ---- seeded chaos (design §8.2 C7): session lifecycle interleaved with issuance and revocation ---------------------------
const STEPS=Number(process.env.RTC_RELAY_CHAOS_STEPS??160),SEEDS=Number(process.env.RTC_RELAY_CHAOS_SEEDS??6),PROVIDER_LAG_MS=5000;
/** After a healthy sweep of every entity: every credential the provider would still accept belongs to a live leg. */
async function noLiveCredentialForDeadLeg(h,label){
 h.turn.failRevoke=false;for(const a of h.accounts.values())await h.run(a.n,'rtc.relay-sweep',{actor:h.system(a.n)});
 const owners=new Map();
 for(const a of h.accounts.values())for(const [,lease] of await a.store.list({prefix:'rtc/relay/'})){
  const rec=await a.store.get(lease.key);for(const u of lease.usernames)owners.set(u.username,{lease,rec,a});}
 for(const u of h.turn.live()){const o=owners.get(u);assert.ok(o,`${label}: live credential ${u} is recorded in a lease`);
  assert.ok(legLive(o.rec,h.clock.now())&&o.rec.mine.jkt===o.lease.leg,`${label}: live credential ${u} belongs to a live leg`);
  // The provider stamps expiry when it answers: a slow provider (the chaos 'slow' step, at most PROVIDER_LAG_MS) can
  // put it that much past the session's end; the end path and the sweep revoke it then.
  assert.ok(h.turn.creds.get(u).expiresAt<=o.rec.endsAt+PROVIDER_LAG_MS,`${label}: ${u} never outlives its session`);}
}
async function boundsHold(h,label){
 for(const a of h.accounts.values()){
  const rows=[...await a.store.list({prefix:'rtc/relay/'})];assert.ok(rows.length<=RELAY_LIMITS.leases,`${label}: lease rows`);
  for(const [,l] of rows){assert.ok(l.usernames.length<=RELAY_LIMITS.usernames,`${label}: usernames per lease`);assert.ok(l.reserved>=0&&l.reserved<=RELAY_LIMITS.sessionBytes,`${label}: per-session bytes`);}
  for(const [,u] of await a.store.list({prefix:'rtc/relay-use/m/'}))assert.ok(u.bytes>=0&&u.bytes<=RELAY_PLAN_BYTES.plus,`${label}: monthly allowance`);
  assert.ok(!JSON.stringify([...await a.store.list({prefix:'rtc/'})]).includes('secret-'),`${label}: no credential stored`);
 }
}
test('seeded chaos: calls, claims, ends, revocations, app changes, flag flips and issuance races keep no live credential on a dead leg',async()=>{
 const stats={issued:0,revoked:0,races:0,raceRevoked:0,slow:0,stuck:0,codes:{}};
 await forEachSeed(SEEDS,async random=>{
  const h=await relayHost({seed:random.seed,entities:3});const devices=[],tickets=new Map();
  for(const n of [1,2,3])for(let i=0;i<2;i++){const d=h.device(n);await d.register([CALL,SYNC]);devices.push(d);}
  for(const n of [1,2,3])tickets.set(n,(await devices.find(x=>x.n===n).run('rtc.mint-ticket',{purposes:[CALL],uses:1000,expires_in:30*86400})).link);
  const tolerate=async fn=>{try{return await fn();}catch(e){if(e?.code==='ERR_ASSERTION')throw e;return null;}};
  const held=d=>[...d.sessions.values()];
  /** Sessions of `d` whose leg is live now (most issuance attempts target these; the rest test refusals). */
  const liveHeld=async d=>{const rows=await h.rows(d.n,'rtc/');return held(d).filter(s=>rows.some(([k,v])=>(k.startsWith('rtc/out/')||k.startsWith('rtc/in/'))&&v.sid===s.sid&&v.mine?.endpoint===d.endpoint&&legLive(v,h.clock.now())));};
  const pickHeld=async d=>{const live=await liveHeld(d);return live.length&&random.chance(0.85)?random.pick(live):held(d).length?random.pick(held(d)):null;};
  const endOp=async()=>{const d=random.pick(devices),list=held(d);if(!list.length)return;const s=random.pick(list);
   const kind=random.pick(['end','cancel','end-session','unregister','revoke-endpoint','app-revoked','app-narrowed','decline']);
   if(kind==='end')await tolerate(()=>d.end(s));if(kind==='cancel')await tolerate(()=>d.cancel(s));if(kind==='decline')await tolerate(()=>d.decline(s));
   if(kind==='end-session')await tolerate(()=>h.run(d.n,'rtc.end-session',{input:{sid:s.sid}}));
   if(kind==='unregister'){await tolerate(()=>d.run('rtc.unregister',d.auth()));d.sessions.clear();await tolerate(()=>d.register([CALL,SYNC]));}
   if(kind==='revoke-endpoint'){await tolerate(()=>h.run(d.n,'rtc.revoke-endpoint',{input:{endpoint:d.endpoint}}));d.sessions.clear();await tolerate(()=>d.register([CALL,SYNC]));}
   if(kind==='app-revoked'||kind==='app-narrowed'){await tolerate(()=>h.run(d.n,'rtc.lifecycle',{actor:h.system(d.n),input:kind==='app-revoked'?{event:'app-revoked',clientId:APP+'/client'}:{event:'app-narrowed',clientId:APP+'/client',purposes:[SYNC]}}));
    for(const x of devices)if(x.n===d.n){x.sessions.clear();if(!(await h.rows(x.n,'rtc/ep/')).some(([,ep])=>ep.id===x.endpoint))await tolerate(()=>x.register([CALL,SYNC]));}}
  };
  for(let step=0;step<STEPS;step++){
   const op=random.pick(['call','call','listen','claim','claim','claim','relay','relay','relay','relay','foreign','race','race','end','end','pump','advance','advance','flag','flaky','sweep','restart','slow','multi','stuck']);
   if(op==='call'){const d=random.pick(devices),to=random.int(3)+1,own=to===d.n;await tolerate(async()=>{const s=await d.open(h.principal(to),own?SYNC:CALL,{media:own?['data']:['audio'],...own?{}:{basis:tickets.get(to)}});await d.invite(s);});}
   if(op==='listen'){await h.pump(2);await tolerate(()=>random.pick(devices).listen());}
   if(op==='claim'){const d=random.pick(devices);await tolerate(()=>d.listen());const open=d.claims().filter(e=>!d.sessions.has(e.sid));if(open.length){const e=random.pick(open);
    await tolerate(async()=>{const c=await d.claim(e.sid,random.chance(0.85)?'accept':'decline');await(c&&random.chance(0.9)?d.accept(c):d.decline(c));});await h.pump(2);}}
   if(op==='relay'){const d=random.pick(devices),s=await pickHeld(d);if(s){await tolerate(async()=>{const out=await creds(d,s).catch(e=>{stats.codes[e.code]=(stats.codes[e.code]??0)+1;throw e;});
    const rec=(await h.rows(d.n,'rtc/')).find(([k,v])=>(k.startsWith('rtc/out/')||k.startsWith('rtc/in/'))&&v.sid===s.sid&&v.mine?.endpoint===d.endpoint)?.[1];
    assert.ok(rec&&legLive(rec,h.clock.now()),'issued only for a live leg');assert.ok(out.expires_at*1000<=rec.endsAt,'bounded by the session');
    if(rec.state==='ringing')assert.ok(out.expires_at*1000<=rec.ringUntil,'a ringing leg: bounded by ring_until (review M1)');});}}
   // Review L1: a slow spend authority (up to 40 s) or a slow provider (up to PROVIDER_LAG_MS) during an issuance; the
   // recorded expiry must still cover the provider's, which noLiveCredentialForDeadLeg checks (every credential the
   // provider accepts is recorded in a lease).
   if(op==='slow'){const d=random.pick(devices),s=await pickHeld(d);if(s){stats.slow++;
    if(random.chance(0.5))h.spend.hook=async()=>{h.clock.advance(random.int(40000));};else h.turn.hook=async()=>{h.clock.advance(random.int(PROVIDER_LAG_MS));};
    await tolerate(()=>creds(d,s));h.spend.hook=null;h.turn.hook=null;}}
   if(op==='multi')h.turn.multi=!h.turn.multi;// review L2: two usernames per issuance
   // Review L3: a sweep that leaves revocations pending re-arms an alarm by itself, at min(expiry, now + retry).
   if(op==='stuck'){const flaky=h.turn.failRevoke;h.turn.failRevoke=true;await endOp();
    for(const n of [1,2,3]){h.wakes.length=0;const swept=await tolerate(()=>h.run(n,'rtc.relay-sweep',{actor:h.system(n)}));
     if(swept?.pending){stats.stuck++;assert.ok(h.wakes.some(([o,t])=>o===subOf(n)&&t<=h.clock.now()+RELAY_RETRY_MS),'pending revocations re-arm the alarm');}}
    h.turn.failRevoke=flaky;}
   if(op==='foreign'){const d=random.pick(devices),other=random.pick(devices.filter(x=>x!==d)),list=held(other);
    // Another device's leg (a session `d` itself has no leg in): always refused. (Both parties of one session share its sid.)
    if(list.length){const s=random.pick(list);const r=await fault(creds(d,s));if(!d.sessions.has(s.sid))assert.ok(r&&['not_found','invalid_args'].includes(r.code),`foreign leg refused (${r?.code})`);}}
   if(op==='race'){const d=random.pick(devices),s=await pickHeld(d);if(s){
    // Mostly the very session being issued for (the end lands between the two transactions), else anything.
    h.turn.hook=random.chance(0.7)?()=>tolerate(()=>random.pick([()=>d.end(s),()=>d.cancel(s),()=>h.run(d.n,'rtc.end-session',{input:{sid:s.sid}}),()=>d.run('rtc.unregister',d.auth()).then(()=>{d.sessions.clear();return d.register([CALL,SYNC]);})])()):endOp;const before=h.turn.issued.length;const out=await tolerate(()=>creds(d,s));
    if(h.turn.issued.length>before){stats.races++;if(!out&&h.turn.creds.get(h.turn.issued.at(-1)).revoked)stats.raceRevoked++;}h.turn.hook=null;}}
   if(op==='end')await endOp();
   if(op==='pump')await h.pump(2);
   if(op==='advance'){h.clock.advance(random.chance(0.2)?random.int(400000):random.int(60000));await h.tickAll();}
   if(op==='flag'&&random.chance(0.5)){for(const n of [1,2,3])for(const name of ['RTC_TURN_ENABLED','RTC_SIGNALING_ENABLED'])h.flags.allow(subOf(n),name);}
   else if(op==='flag'){const n=random.int(3)+1,name=random.pick(['RTC_TURN_ENABLED','RTC_SIGNALING_ENABLED']);if(h.flags.state.deny.get(subOf(n))?.has(name))h.flags.allow(subOf(n),name);else h.flags.deny(subOf(n),name);}
   if(op==='flaky')h.turn.failRevoke=!h.turn.failRevoke;
   if(op==='restart')await h.restart(random.int(3)+1);
   await boundsHold(h,`step ${step} ${op}`);
   if(op==='sweep'||step%20===19)await noLiveCredentialForDeadLeg(h,`step ${step}`);
  }
  // Quiesce: flags back, the provider heals, every session reaches its end, and no credential or lease survives.
  for(const n of [1,2,3])for(const name of ['RTC_TURN_ENABLED','RTC_SIGNALING_ENABLED'])h.flags.allow(subOf(n),name);
  h.turn.failRevoke=false;h.turn.multi=false;await h.pump();await noLiveCredentialForDeadLeg(h,'quiesced');
  for(let i=0;i<5;i++){h.clock.advance(6*3600000);await h.tickAll();await h.pump();}
  await noLiveCredentialForDeadLeg(h,'after the session cap');assert.deepEqual(h.turn.live(),[],'nothing the provider would accept');
  stats.issued+=h.turn.issued.length;stats.revoked+=h.turn.revoked.length;
  for(const a of h.accounts.values())assert.equal((await a.store.list({prefix:'rtc/relay/'})).size,0,'every lease is gone');
 });
 // The schedule really exercised issuance, revocation and the race (not only refusals).
 if(process.env.RTC_RELAY_CHAOS_STATS)console.log(JSON.stringify(stats));
 assert.ok(stats.issued>=SEEDS*3&&stats.revoked>=SEEDS&&stats.races>=1&&stats.slow>=1&&(SEEDS<6||stats.raceRevoked>=1&&stats.stuck>=1),JSON.stringify(stats));
});

// ---- Node runtime: reachability only (descriptor, manifest, account slice), with injected doubles --------------------
test('runtime: the relay occupant is declared and dispatchable only with both flags and a configured relay; the drain revokes',async t=>{
 const {createNodeServer}=await import('../apps/node/server.mjs');const {federationDeclarations}=await import('../packages/runtime/federation.mjs');
 const {IdentityService}=await import('../packages/identity/service.mjs');const {identityBackupPort}=await import('../packages/runtime/identity-backup.mjs');
 const {accountHandle}=await import('../packages/runtime/routes/shared.mjs');const {fakeHasher}=await import('./helpers/identity-engine.mjs');
 const ORIGIN='https://rtc-relay-runtime.example',PASSWORD='RTC relay runtime password, long enough!';
 const BASE={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',RTC_SIGNALING_ENABLED:'true'};
 const turn=fakeTurn();turn.clock={now:()=>Date.now()};const spend=fakeSpend();
 // Manifest: the occupant entry needs the mount, both flags (TURN from env) and both ports.
 const ext=(c,m={rtcOccupant:true})=>(federationDeclarations({APP_ORIGIN:ORIGIN,...BASE,...c},{target:'authority',mounts:m}).extensions??[]).filter(e=>e.slot===ICE_RELAY_SLOT);
 const ports={RTC_TURN_ADAPTER:turn,RTC_RELAY_SPEND:spend};
 assert.equal(ext({RTC_TURN_ENABLED:'true'}).length,0,'no ports');assert.equal(ext({...ports}).length,0,'TURN off');
 assert.equal(ext({...ports,RTC_TURN_ENABLED:'true',RTC_SIGNALING_ENABLED:'false'}).length,0,'signaling off');
 assert.equal(ext({...ports,RTC_TURN_ENABLED:'true'},{}).length,0,'not mounted');
 // Like the signaling occupant, the entry is kept only beside a declared extensions.v1, which the RTC-i signaling
 // occupant row now declares (packages/runtime/federation.mjs), so with both flags and both ports it is present.
 assert.equal(ext({...ports,RTC_TURN_ENABLED:'true'}).length,1,'declared beside extensions.v1');
 // Descriptor (the owner-assignable resource) and journal: only with RTC_SIGNALING_ENABLED, EXTENSIONS_ENABLED,
 // RTC_TURN_ENABLED and both ports; credentials are never kept in the RPC journal.
 const {federationControllerOptions}=await import('../packages/runtime/federation.mjs');const OWNER='0a0a0a0a-0000-4000-8000-0000000000aa';
 const options=config=>federationControllerOptions({config:{APP_ORIGIN:ORIGIN,...config},repository:{get:async()=>({id:OWNER,handle:'alice',status:'active'})},accounts:{get:()=>({invoke:async({method})=>method==='resources'?[]:{displayName:'Alice'}})},owner:OWNER});
 const relayDescriptor=async config=>(await options(config).resourceProvider()).find(d=>d.id===`${ORIGIN}/entities/${OWNER}/relay`);
 for(const [config,label] of [[{...BASE,...ports},'TURN off'],[{...BASE,RTC_TURN_ENABLED:'true'},'no ports'],[{...BASE,RTC_TURN_ENABLED:'true',RTC_TURN_ADAPTER:turn},'no spend authority'],[{...BASE,...ports,RTC_TURN_ENABLED:'true',RTC_SIGNALING_ENABLED:'false'},'signaling off'],[{...BASE,...ports,RTC_TURN_ENABLED:'true',EXTENSIONS_ENABLED:'false'},'extensions off']])
  assert.equal(await relayDescriptor(config),undefined,label);
 assert.deepEqual((await relayDescriptor({...BASE,...ports,RTC_TURN_ENABLED:'true'})).contracts,{[ICE_RELAY_CONTRACT]:['credentials']});
 const dispatcher=options({...BASE}).dispatcher;assert.equal(dispatcher.retainResult({contract:ICE_RELAY_CONTRACT,method:'credentials'}),false,'never journaled');
 const directory=await mkdtemp(join(tmpdir(),'rtc-relay-runtime-'));
 const app=await createNodeServer({directory,config:{...BASE,RTC_TURN_ENABLED:'true',APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',...ports,RTC_BOUND_CHECK:async input=>input.grants.includes('grant-ok')&&input.value===CALL}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:new URL(ORIGIN).hostname,termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
 const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
 await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
 const id=pending.account.id,env={...BASE,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts},object=accountHandle(env,id);
 const actor={kind:'app',owner:id,clientId:'https://app.example/client',origin:'https://app.example',grants:['grant-ok']};
 const dispatch=(operation,input)=>object.rtcDispatch(id,{operation,actor,input});
 const c=accounts.get(id);await c.metadata.put('billing/state',null);
 // An own-entity session: two endpoints of the same owner (the plan port reads the billing entitlement: free here, so
 // the occupant refuses with relay_not_included, which proves the request reached it with both flags on).
 const e1=await dispatch('rtc.register',{purposes:[CALL]}),e2=await dispatch('rtc.register',{purposes:[CALL]});
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',key.publicKey);
 const opened=await dispatch('rtc.open',{endpoint:e1.endpoint,endpoint_secret:e1.endpoint_secret,to:{iss:ORIGIN,sub:id},purpose:CALL,media:['audio'],delegate:{kty:'EC',crv:'P-256',x,y},target:e2.endpoint});
 const ask=()=>dispatch('rtc.relay-credentials',{endpoint:e1.endpoint,endpoint_secret:e1.endpoint_secret,sid:opened.sid});
 await assert.rejects(ask(),e=>e.code==='forbidden'&&/not included/.test(e.message));assert.equal(turn.calls.issue,0);
 // With a paid entitlement visible to the plan port, the credential is issued through the account slice.
 c.billing.entitlement=async()=>({plan:'plus'});const out=await ask();assert.ok(validateIceRelayResult(out));
 // The contract route: only the ice-relay/v1 resource and method map to the occupant.
 const {rtcRelayResourceMethod}=await import('../packages/runtime/account/rtc.mjs');
 await assert.rejects(rtcRelayResourceMethod(c,id,{authority:'bindle',contract:'https://spec.bindle.example/contracts/rtc-signaling/v1',method:'credentials',args:{}}),e=>e.status===403);
 // The end path on the runtime: an owner end-session revokes on the controller's detached pass (not the alarm).
 const second=await dispatch('rtc.open',{endpoint:e2.endpoint,endpoint_secret:e2.endpoint_secret,to:{iss:ORIGIN,sub:id},purpose:CALL,media:['audio'],delegate:await (async()=>{const k=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',k.publicKey);return {kty:'EC',crv:'P-256',x,y};})(),target:e1.endpoint});
 const out2=await dispatch('rtc.relay-credentials',{endpoint:e2.endpoint,endpoint_secret:e2.endpoint_secret,sid:second.sid});
 await object.rtcDispatch(id,{operation:'rtc.end-session',actor:{kind:'owner',owner:id},input:{sid:second.sid}});
 for(let i=0;i<100&&!usernames(out2).every(u=>turn.creds.get(u).revoked);i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(usernames(out2).every(u=>turn.creds.get(u).revoked),'revoked by the detached pass after the end');
 // Deletion E4: rtcDrain ends the session and revokes its relay credential before the purge.
 // Review L3: the relay's `wake` port schedules this writer's alarm (pending revocations re-arm it).
 const {rtcEngine}=await import('../packages/runtime/account/rtc.mjs');const at=Date.now()+30000;
 const schedule=c.scheduleAlarm,asked=[];c.scheduleAlarm=async t=>{asked.push(t);return schedule.call(c,t);};
 try{await rtcEngine(c).service.relay.wake(id,at);}finally{c.scheduleAlarm=schedule;}assert.deepEqual(asked,[at],'the alarm is armed');
 const drained=await c.rtcDrain(id);assert.equal(drained.pending,0);assert.ok(usernames(out).every(u=>turn.creds.get(u).revoked),'revoked by the deletion drain');
 assert.equal(ICE_RELAY_CONTRACT,'https://spec.bindle.example/contracts/ice-relay/v1');
});
