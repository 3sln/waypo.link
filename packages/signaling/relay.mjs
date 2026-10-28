// The built-in `ice-relay/v1` resource (docs/spec/extensions/signaling.md §3.3, §16.7; rtc-signaling design §8.1 RTC-f,
// carried by signaling Appendix C.1 relay.mjs). Provisional (coordinator), not signed off by the user. Issuance stays
// refused until a spend authority enforces a per-owner byte cap from provider usage data (§16.7, AMD-SG-S2).
//
// It issues short-lived TURN credentials only for a LIVE leg of the calling application's own session in this entity's
// writer (an initiator leg once opened, a recipient leg once its accept claim won), checked against the session record inside
// the same storage transaction that records the issuance. A credential never outlives the leg's session (TTL = min(300
// s, remaining session life)) and is revoked, best effort, when the leg ends (SignalingService.end → `ended`), when the
// session is ended by app revocation or narrowing or account deletion (signaling.lifecycle, which ends through the same
// path), and by the sweep (signaling.relay-sweep, also run by signaling.tick on the alarm), which compares every lease with its
// session record and revokes whatever no longer belongs to a live leg. With either flag off the sweep revokes every held
// credential (a kill switch for relay spend; revocation itself is never gated) but keeps the lease of a still-live leg,
// so its per-leg budget is not reset (review L4). The kill switch takes effect within 300 s: no credential is issued
// while a flag is off, and every held one is revoked at the next sweep or lapses by its expiry (review L3).
//
// Reachability: `credentials` needs SIGNALING_ENABLED (with SESSION_KINDS_ENABLED) AND SIGNALING_TURN_ENABLED for the owner (class b flags do not
// evaluate `requires` from env, so both are checked here, DEVLOG 2026-10-26 RTC-a/b/c), and both ports: a TURN
// adapter ({issue({ttl}) -> {iceServers, expiresIn}, revoke(username)}, CloudflareTurnAdapter in production, a test
// double in tests) and an externally enforced spend authority:
//   reserve({owner, bytes, ttl, sid, leg}) -> {enforced:true, …}   before the provider is called
//   commit(reservation, {owner, usernames, expiresAt, ttl, bytes, session, sid, leg, endpoint, clientId})
//                                                                 after it answered, before the credential is returned:
//                                                                 the TURN usernames of this credential, their expiry
//                                                                 (ms, an upper bound) and the leg they belong to, so the
//                                                                 authority can attribute the provider's per-username
//                                                                 usage and revoke an overrun itself (review M1)
//   release?(reservation)                                          when nothing was issued
// A TURN credential is a bearer token with no byte limit, so relayed bytes are bounded ONLY if the authority enforces
// per-owner byte caps from the provider's usage feed. No production spend authority exists: that is the relay-spend
// budget gate (design §8.3), so hosted relay stays unreachable even with both flags on until an operator supplies one.
//
// Generalized from relay-credentials.mjs (Beam's lease/issue/revoke/sweep): the same two-transaction
// lease with a crash-safe 'issuing' marker, revoke-on-failure and keep-unrevoked-for-the-sweep rules, but leases live
// in their own rows (sig/relay/<session key>) so the liveness check reads the session record itself, renewals are
// bounded by a byte budget instead of a fixed count, and an early renewal never revokes the credential still in use.
//
// Store (entity account):
//   sig/relay/<encoded session key>  lease {v, key, sid, leg, endpoint, clientId, endsAt, state, at, issues, reserved,
//                                    usernames:[{username, expiresAt, orphan?}], expiresAt}: TURN usernames only (an
//                                    orphan was issued but never handed out, and is revoked even on a live leg); the
//                                    recorded expiry is an upper bound (time after the provider answered + TTL + a
//                                    grace), so no username is dropped while the provider may still accept it; NEVER the
//                                    credential (a bearer secret that is returned once and never stored or logged)
//   sig/relay-use/m/<YYYY-MM>        reserved bytes and issues this UTC month (current and previous month kept)
//   sig/relay-use/h                  fixed one-hour issuance window
//
// The `ice-relay/v1` contract stays generic (`credentials({sid?})` → `{ice_servers, expires_at}`, any occupant).
// Reading RTCf-2 (provisional): this built-in occupant also takes `endpoint` and, for an endpoint registered without
// DPoP, `endpoint_secret`, with exactly the signaling contract's endpoint binding; like `sid`, a consumer sends them
// only to a built-in occupant, never to a brokered one.
import {AppFault} from '../app/faults.mjs';
import {isLive} from './sessions.mjs';
import {CloudflareTurnAdapter,TURN_MAX_TTL_SECONDS} from './turn.mjs';
import {RELAY_LEASE_MS,RELAY_RETRY_MS,relayUsernames} from './relay-credentials.mjs';

export const TURN_FLAG='SIGNALING_TURN_ENABLED';
export const ICE_RELAY_METHODS=Object.freeze(['credentials']);
/**
 * Per-plan monthly hosted-relay allowance, in reserved bytes (provisional, unsigned; the cost model's relayEconomics()
 * in scripts/cost-model.mjs keeps every paid plan at a 50% or better margin on its typical profile with the whole
 * allowance spent, tests/cost-model-relay.test.mjs). Free includes no hosted relay: free accounts can still assign a
 * third-party relay in the ice-relay fragment (RTC-7, each party funds its own relay). Organization plans are not modelled
 * here and get none.
 */
export const RELAY_PLAN_BYTES=Object.freeze({free:0,paid:1_000_000_000,plus:10_000_000_000,ultra:100_000_000_000});
/**
 * Bounds (provisional). One issuance reserves `envelopeBytes` against the session and the account: 300 s at about
 * 3.3 Mbit/s through this entity's relay in both directions (a relayed video call). The reservation is an admission
 * estimate only: a TURN credential does not cap bytes, so relayed bytes are bounded only if the external spend
 * authority enforces per-owner byte caps from the provider's usage feed, using the usernames `commit` gives it (spec
 * §10: never client-reported byte counts). Without that, one 300 s credential can carry any number of bytes.
 */
export const RELAY_LIMITS=Object.freeze({
 ttlSeconds:TURN_MAX_TTL_SECONDS,
 renewWindowMs:60000,      // a leg renews only within the last 60 s of its current credential
 minSessionMs:10000,       // no credential for a session with less than 10 s left
 envelopeBytes:125_000_000,
 sessionBytes:3_000_000_000,// per leg (session record): 24 issuances, about 2 h relayed
 accountLegs:4,            // legs of this entity holding an unexpired credential (or an issuance in flight) at once
 issuesPerHour:60,
 leases:64,                // lease rows per entity (live sessions are capped far lower, design §3.4)
 usernames:8,              // usernames kept per lease (the current credential, one overlapping renewal, unrevoked);
                           // an issuance needs room for `servers` more, and no unexpired username is ever dropped
 servers:4,urls:4,         // spec §3.3: at most 4 ice_servers with at most 4 URLs each
});
export const LEASE_PREFIX='sig/relay/',USAGE_PREFIX='sig/relay-use/';
export const leaseKey=sessionKey=>LEASE_PREFIX+encodeURIComponent(sessionKey);
const HOUR_KEY=USAGE_PREFIX+'h',monthOf=ms=>new Date(ms).toISOString().slice(0,7),monthKey=month=>`${USAGE_PREFIX}m/${month}`;
const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const notFound=()=>fail('not_found','Not found.',404);
// Every refusal before a credential exists is a no-effect outcome for the ice-relay field's ordered pre-dispatch failover, so a
// consumer moves on to the next (for example third-party) relay occupant. Review M2: only generic codes that BOTH the
// federation runtime's dispatch keeps (packages/federation/runtime.mjs; any other code from a write becomes
// `indeterminate`, which stops failover) AND the ordered field treats as no-effect (extensions NO_EFFECT_CODES) are used:
// `not_found`, `forbidden` (not included in the plan) and `rate_limited` (every quota, limit, busy, already-issued
// and unavailable refusal), with the detail in the message. `temporarily_unavailable` is not kept by the runtime.
const limited=message=>fail('rate_limited',message,429);
const unavailable=()=>limited('Relay credentials are temporarily unavailable. Try again later.');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const seconds=ms=>Math.floor(ms/1000);
/** Review L1: added to a recorded credential expiry (provider clock skew), so the sweep never drops early. */
export const RELAY_EXPIRY_GRACE_MS=5000;
/** Review M1: while a leg rings (not yet claimed or connected) a credential never outlives `ring_until`. */
const liveUntil=rec=>rec.state==='pending'?Math.min(rec.endsAt,rec.answerBy):rec.endsAt;

/** Whether the session record `rec` holds a live leg of this entity that may relay (§16.7): the initiator leg once
 * opened (and, while pending, before answer_by), the recipient leg once its accept claim won; certified; before the
 * session's end. */
export function legLive(rec,now){
 if(!isLive(rec)||!(rec.endsAt>now)||!rec.mine||typeof rec.mine.jkt!=='string'||!rec.mine.certificate)return false;
 if(rec.state==='pending'&&!(rec.answerBy>now))return false;
 return rec.role==='initiator'||rec.role==='recipient'&&rec.claim?.outcome==='accept'&&rec.claim.endpoint===rec.mine.endpoint;
}
const leaseLive=(lease,rec,now)=>Boolean(lease&&rec&&legLive(rec,now)&&rec.mine.jkt===lease.leg&&rec.mine.endpoint===lease.endpoint);
const held=(lease,now)=>(lease?.usernames??[]).some(u=>u.expiresAt>now)||lease?.state==='issuing'&&lease.at+RELAY_LEASE_MS>now;

/**
 * Fits a TURN provider's ICE servers to the `ice-relay/v1` contract (spec §3.3): `turn:`/`turns:` URLs only (an
 * endpoint under `relay` policy never uses STUN, §10, and a TURN allocation also yields a server-reflexive address),
 * grouped by credential, at most 4 URLs per entry and 4 entries. Returns [] when nothing usable remains.
 */
export function contractIceServers(iceServers,limits=RELAY_LIMITS){
 const groups=new Map();
 for(const s of Array.isArray(iceServers)?iceServers:[]){
  if(typeof s?.username!=='string'||!s.username||typeof s.credential!=='string'||!s.credential)continue;
  const urls=(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>typeof u==='string'&&/^turns?:/.test(u)&&u.length<=256);
  const id=JSON.stringify([s.username,s.credential]),g=groups.get(id)??{username:s.username,credential:s.credential,urls:[]};
  for(const u of urls)if(!g.urls.includes(u))g.urls.push(u);groups.set(id,g);
 }
 const out=[];
 for(const g of groups.values())for(let i=0;i<g.urls.length&&out.length<limits.servers;i+=limits.urls)out.push({urls:g.urls.slice(i,i+limits.urls),username:g.username,credential:g.credential});
 return out;
}
/**
 * The generic `ice-relay/v1` result check (spec §3.3), for any occupant, built-in or brokered: exactly
 * {ice_servers, expires_at}; 1–4 servers, each {urls, username?, credential?} with 1–4 `turn:`, `turns:` or `stun:`
 * URLs; a `turn(s):` URL needs a username and credential; `expires_at` in Unix seconds after `now`. Returns a clean
 * copy or null.
 */
export function validateIceRelayResult(value,{now=Date.now()}={}){
 if(!plain(value)||Object.keys(value).sort().join()!=='expires_at,ice_servers'||!Number.isSafeInteger(value.expires_at)||value.expires_at<=seconds(now))return null;
 if(!Array.isArray(value.ice_servers)||!value.ice_servers.length||value.ice_servers.length>4)return null;
 const servers=[];
 for(const s of value.ice_servers){
  if(!plain(s)||Object.keys(s).some(k=>!['urls','username','credential'].includes(k)))return null;
  const urls=Array.isArray(s.urls)?s.urls:[s.urls];
  if(!urls.length||urls.length>4||urls.some(u=>typeof u!=='string'||u.length>256||!/^(turns?|stun):[^\s]+$/.test(u)))return null;
  for(const k of ['username','credential'])if(s[k]!==undefined&&(typeof s[k]!=='string'||!s[k]||s[k].length>512))return null;
  if(urls.some(u=>u.startsWith('turn'))&&(s.username===undefined||s.credential===undefined))return null;
  servers.push({urls:[...urls],...s.username!==undefined?{username:s.username}:{},...s.credential!==undefined?{credential:s.credential}:{}});
 }
 return {ice_servers:servers,expires_at:value.expires_at};
}

/** The production TURN adapter from operator configuration (CLOUDFLARE_TURN_KEY_ID and the CLOUDFLARE_TURN_API_TOKEN
 * secret; docs/self-hosting.md), or an injected `SIGNALING_TURN_ADAPTER` (tests). Null when neither is configured. Never
 * logs or returns the token. */
export function turnAdapterFrom(config={}){
 const injected=config.SIGNALING_TURN_ADAPTER;if(typeof injected?.issue==='function'&&typeof injected.revoke==='function')return injected;
 const keyId=config.CLOUDFLARE_TURN_KEY_ID,apiToken=config.CLOUDFLARE_TURN_API_TOKEN;
 return typeof keyId==='string'&&keyId&&typeof apiToken==='string'&&apiToken?new CloudflareTurnAdapter({keyId,apiToken}):null;
}
/** Whether this host could serve the built-in relay at all (both ports present). Flags are checked separately. */
export const relayConfigured=(config={})=>Boolean(turnAdapterFrom(config))&&typeof config.SIGNALING_RELAY_SPEND?.reserve==='function'&&typeof config.SIGNALING_RELAY_SPEND.commit==='function';


/**
 * The relay resource of one entity writer. `service` is that writer's SignalingService (endpoint authentication, session
 * lookup, flags, clock); `adapter` the TURN adapter; `spend` the external spend authority; `plan(owner)` the owner's
 * current plan id; `defer(owner, 'relay')` asks the adapter for a revocation pass outside the current request (absent:
 * `ended` revokes at once); `wake(owner, time)` asks the adapter for an alarm at `time` (review L3: whenever a dead
 * leg, or an issuance that failed, still holds an unrevoked unexpired username, so retries never wait on an alarm
 * nothing scheduled).
 */
export class SignalingRelay{
 constructor({service,adapter=null,spend=null,plan=null,defer=null,wake=null,limits=RELAY_LIMITS}){
  if(!service?.store)throw new TypeError('SignalingRelay needs its SignalingService.');
  Object.assign(this,{service,adapter,spend,plan,defer,wake,limits});
 }
 get store(){return this.service.store;}
 now(){return this.service.now();}
 /** Both flags, for this owner (and client): SIGNALING_TURN_ENABLED's `requires` is not evaluated from env. */
 enabled(owner,clientId){return this.service.enabled(owner,clientId)&&this.service.flag(owner,TURN_FLAG,clientId);}
 configured(){return typeof this.adapter?.issue==='function'&&typeof this.adapter.revoke==='function'&&typeof this.spend?.reserve==='function'&&typeof this.spend.commit==='function';}
 async allowance(owner){let plan='free';try{plan=await this.plan?.(owner)??'free';}catch{plan='free';}return Object.hasOwn(RELAY_PLAN_BYTES,plan)?RELAY_PLAN_BYTES[plan]:0;}
 /** Review L3: a revocation retry at `time` (an alarm through `wake`) and, with `now`, a detached pass at once. */
 async retry(owner,time,{now=false}={}){
  if(now&&typeof this.defer==='function')try{this.defer(owner,'relay');}catch{/* the alarm retries */}
  if(typeof this.wake==='function'&&Number.isFinite(time))try{await this.wake(owner,time);}catch{/* the next tick retries */}
 }

 /** signaling.relay-credentials: `{sid, endpoint, endpoint_secret?}` → `{ice_servers, expires_at}` for the caller's own live leg. */
 async credentials(actor,input){
  const svc=this.service,app=svc.app(actor),owner=app.owner,L=this.limits;
  if(!this.enabled(owner,app.clientId))notFound();
  if(!plain(input)||Object.keys(input).some(k=>!['sid','endpoint','endpoint_secret'].includes(k))||typeof input.sid!=='string'||typeof input.endpoint!=='string')fail('invalid_args','A session and an endpoint are required.',400);
  if(!this.configured())unavailable();
  // §16.7 (RTCw-M4): before issuance the session handler approval for the session's kind is re-checked (intents
  // memory, local; no shard call); read outside the issuing transaction, which re-checks the leg.
  const kind=await this.store.transaction(async tx=>{await svc.bindOwner(tx,owner);const ep=await svc.endpointAuth(tx,app,input,this.now()),found=await svc.ownSession(tx,ep,input.sid);return found?.rec?.kind?structuredClone(found.rec.kind):null;});
  // §16.7: refusals before any credential exists are no-effect (`not_found`, `forbidden`, `rate_limited`) so ordered
  // failover proceeds; a missing approval answers `forbidden` here, not the contract's `approval_required`.
  // L-6: the approval must admit the session's kind version (§15), exactly as `claim` checks it.
  if(!kind)notFound();try{await svc.requireAdmits(app,kind);}catch(error){if(error?.code==='approval_required')fail('forbidden','This kind is not approved for this application.',403);throw error;}
  const allowance=await this.allowance(owner);
  const now=this.now();
  const lease0=await this.store.transaction(async tx=>{
   await svc.bindOwner(tx,owner);if(await tx.get('sig/closed'))notFound();
   const ep=await svc.endpointAuth(tx,app,input,now),found=await svc.ownSession(tx,ep,input.sid);
   // Only this endpoint's OWN live leg: another entity's session, another endpoint's leg, an unclaimed or declined
   // recipient record and an ended session are all the uniform not_found.
   if(!found||!legLive(found.rec,now)||found.rec.mine.clientId!==app.clientId||found.rec.mine.endpoint!==ep.id)notFound();
   const rec=found.rec,until=liveUntil(rec);if(until-now<L.minSessionMs)notFound();
   const key=leaseKey(found.key);let lease=await tx.get(key);
   if(lease&&lease.leg!==rec.mine.jkt)notFound();
   if(!lease){
    if((await tx.list({prefix:LEASE_PREFIX,limit:L.leases+1})).size>=L.leases)limited('Too many relay sessions. Try again later.');
    lease={v:1,key:found.key,sid:rec.sid,leg:rec.mine.jkt,endpoint:ep.id,clientId:app.clientId,endsAt:rec.endsAt,state:'idle',at:0,issues:0,reserved:0,usernames:[],expiresAt:0,createdAt:now};
   }
   if(lease.state==='issuing'&&lease.at+RELAY_LEASE_MS>now)limited('Relay credentials are being issued for this connection. Try again shortly.');
   lease.usernames=lease.usernames.filter(u=>u.expiresAt>now);
   const current=Math.max(0,...lease.usernames.filter(u=>!u.orphan).map(u=>u.expiresAt));
   if(current-RELAY_EXPIRY_GRACE_MS-now>L.renewWindowMs)limited('This connection already has relay credentials. Renew within the last minute.');
   // Review L2: room for the most usernames one issuance may add (L.servers), so a recorded unexpired username is never
   // dropped to make room, not even one left unrevoked by a failure.
   if(lease.usernames.length+L.servers>L.usernames)limited('Too many relay credentials for this connection.');
   if(lease.reserved+L.envelopeBytes>L.sessionBytes)limited('This connection has used its relay allowance.');
   let legs=0;for(const [k,l] of await tx.list({prefix:LEASE_PREFIX,limit:L.leases+1}))if(k!==key&&held(l,now))legs++;
   if(legs>=L.accountLegs)limited('Too many relayed connections at once.');
   if(allowance<=0)fail('forbidden','Hosted relay is not included in your plan.',403);
   const month=monthOf(now),use=await tx.get(monthKey(month))??{month,bytes:0,issues:0};
   if(use.bytes+L.envelopeBytes>allowance)limited('Your relay allowance for this month is used up.');
   const hour=await tx.get(HOUR_KEY),window=hour?.resetAt>now?hour:{resetAt:now+3600000,count:0};
   if(window.count>=L.issuesPerHour)limited('Too many relay requests. Try again later.');
   await tx.put(HOUR_KEY,{resetAt:window.resetAt,count:window.count+1});
   await tx.put(monthKey(month),{month,bytes:use.bytes+L.envelopeBytes,issues:use.issues+1});
   lease={...lease,state:'issuing',at:now,issues:lease.issues+1,reserved:lease.reserved+L.envelopeBytes,month};
   await tx.put(key,lease);
   return {key,sessionKey:found.key,until,at:now,month,sid:rec.sid,leg:rec.mine.jkt,endpoint:ep.id};
  });
  // TTL = min(300 s, what is left of the leg: the session's end, or ring_until while it rings), at the current time.
  const ttlNow=()=>Math.min(L.ttlSeconds,seconds(lease0.until-this.now()));
  let reservation=null,committed=false,issued=null,usernames=[],expiresAt=0;
  try{
   let ttl=ttlNow();if(ttl<1)notFound();
   try{reservation=await this.spend.reserve({owner,bytes:L.envelopeBytes,ttl,sid:lease0.sid,leg:lease0.leg});}catch{reservation=null;}
   if(reservation?.enforced!==true){reservation=null;unavailable();}
   // Review L1: recomputed just before the provider call (the reservation took time).
   ttl=ttlNow();if(ttl<1)notFound();
   const before=this.now();
   try{issued=await this.adapter.issue({ttl});}catch{unavailable();}
   usernames=relayUsernames(issued);
   // Review L1: the provider's credential lapses at most `ttl` after it answered; recorded from then, plus a grace, so
   // the sweep and the deletion drain never treat a username the provider may still accept as expired.
   expiresAt=this.now()+ttl*1000+RELAY_EXPIRY_GRACE_MS;
   const servers=contractIceServers(issued?.iceServers,L);if(!servers.length||!usernames.length||usernames.length>L.servers)unavailable();
   // Review M1: the authority learns exactly which TURN usernames this reservation funds, until when, for which leg.
   await this.spend.commit(reservation,{owner,usernames:[...usernames],expiresAt,ttl,bytes:L.envelopeBytes,session:lease0.sessionKey,sid:lease0.sid,leg:lease0.leg,endpoint:lease0.endpoint,clientId:app.clientId});committed=true;
   await this.store.transaction(async tx=>{
    const rec=await tx.get(lease0.sessionKey),lease=await tx.get(lease0.key),at=this.now();
    // The session may have ended, or the lease been superseded, while the provider was called: never record (and
    // never hand out) a credential for a leg that is no longer live.
    if(!lease||lease.state!=='issuing'||lease.at!==lease0.at||!leaseLive(lease,rec,at))notFound();
    // Review L2: the cap counts the new usernames; unexpired ones are never dropped (the excess is refused and revoked).
    const kept=lease.usernames.filter(u=>u.expiresAt>at);
    if(kept.length+usernames.length>L.usernames)limited('Too many relay credentials for this connection.');
    await tx.put(lease0.key,{...lease,state:'idle',at:0,usernames:[...kept,...usernames.map(username=>({username,expiresAt}))],expiresAt});
   });
   return {ice_servers:servers,expires_at:seconds(before+ttl*1000)};
  }catch(error){
   const unrevoked=[];
   for(const username of usernames)try{await this.adapter.revoke(username);}catch{unrevoked.push({username,expiresAt,orphan:true});}
   if(reservation&&!committed&&typeof this.spend.release==='function')try{await this.spend.release(reservation);}catch{/* the authority expires it */}
   try{await this.store.transaction(async tx=>{
    const lease=await tx.get(lease0.key);
    // The local reservation is refunded only when no issued credential can still carry traffic.
    const refund=!unrevoked.length;
    if(refund){const use=await tx.get(monthKey(lease0.month));if(use)await tx.put(monthKey(lease0.month),{...use,bytes:Math.max(0,use.bytes-L.envelopeBytes),issues:Math.max(0,use.issues-1)});}
    if(!lease)return;
    // Review L2: unrevoked usernames are kept until revoked or expired (the first transaction left room for them).
    const next={...lease,usernames:[...lease.usernames,...unrevoked]};
    if(lease.state==='issuing'&&lease.at===lease0.at){next.state='idle';next.at=0;}
    if(refund){next.reserved=Math.max(0,lease.reserved-L.envelopeBytes);next.issues=Math.max(0,lease.issues-1);}
    await tx.put(lease0.key,next);
   });}catch{/* the sweep reconciles */}
   // Review L3: an unrevoked orphan is retried on a detached pass now and on an alarm until its credential expires.
   if(unrevoked.length)await this.retry(owner,Math.min(expiresAt,this.now()+RELAY_RETRY_MS),{now:true});
   if(error instanceof AppFault)throw error;
   unavailable();
  }
 }

 /** The end path (SignalingService.commit after a transaction that ended sessions): revoke those legs' credentials now, or
  * through the adapter's detached pass when one is wired. The sweep is the durable fallback either way. */
 async ended(owner,keys){
  if(typeof this.defer==='function'){try{this.defer(owner,'relay');return;}catch{/* revoke now */}}
  await this.sweep(owner,{keys}).catch(()=>null);
 }

 /**
  * signaling.relay-sweep (system; also run by signaling.tick): for every lease (or only those of `keys`, session-record keys),
  * compares it with its session record. A lease whose leg is not live (ended, expired, record gone) or whose flags are
  * off has every unexpired username revoked, and so has every orphan (issued, never handed out); one whose revocation
  * fails stays for a retry until its credential expires, and the sweep re-arms itself through `wake` at
  * min(expiry, now + RELAY_RETRY_MS). Expired usernames are dropped without a call. Empty leases of dead legs are
  * deleted, never merely because a flag is off (review L4: that would reset the leg's budget); stale 'issuing'
  * markers are cleared. Old usage months and an expired hour window are pruned. Returns {revoked, pending, wakeAt}.
  */
 async sweep(owner,{keys=null,limit=128}={}){
  const now=this.now();
  const rows=await this.store.transaction(async tx=>{
   const out=[],list=keys?(await Promise.all([...new Set(keys)].slice(0,limit).map(async k=>[leaseKey(k),await tx.get(leaseKey(k))]))).filter(([,v])=>v):[...await tx.list({prefix:LEASE_PREFIX,limit})];
   for(const [lkey,lease] of list){const rec=await tx.get(lease.key),alive=leaseLive(lease,rec,now);out.push({lkey,lease,alive,live:alive&&this.enabled(owner,lease.clientId)});}
   if(!keys){for(const [key,row] of await tx.list({prefix:USAGE_PREFIX+'m/',limit:32}))if(row?.month<monthOf(Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth()-1,1)))await tx.delete(key);
    const hour=await tx.get(HOUR_KEY);if(hour&&!(hour.resetAt>now))await tx.delete(HOUR_KEY);}
   return out;
  });
  let revoked=0,pending=0,wakeAt=null,retryAt=null;const soon=t=>{wakeAt=Math.min(wakeAt??Infinity,t);};
  for(const row of rows){
   const done=new Set(row.lease.usernames.filter(u=>!(u.expiresAt>now)).map(u=>u.username));
   for(const u of row.lease.usernames){if(done.has(u.username)||row.live&&!u.orphan)continue;
    const again=Math.min(u.expiresAt,now+RELAY_RETRY_MS);
    if(typeof this.adapter?.revoke!=='function'){pending++;soon(again);retryAt=Math.min(retryAt??Infinity,again);continue;}
    try{await this.adapter.revoke(u.username);done.add(u.username);revoked++;}catch{pending++;soon(again);retryAt=Math.min(retryAt??Infinity,again);}}
   if(row.lease.state==='issuing')soon(row.lease.at+RELAY_LEASE_MS+1);
   await this.store.transaction(async tx=>{
    const lease=await tx.get(row.lkey);if(!lease)return;
    const usernames=lease.usernames.filter(u=>!done.has(u.username)&&u.expiresAt>this.now());
    const issuing=lease.state==='issuing'&&lease.at+RELAY_LEASE_MS>this.now();
    if(!row.alive&&!usernames.length&&!issuing){await tx.delete(row.lkey);return;}
    if(usernames.length!==lease.usernames.length||lease.state==='issuing'&&!issuing)await tx.put(row.lkey,{...lease,usernames,...lease.state==='issuing'&&!issuing?{state:'idle',at:0}:{}});
   });
  }
  // Review L3: pending revocations re-arm the alarm themselves (a detached pass or a request has no alarm of its own).
  if(retryAt!==null)await this.retry(owner,retryAt);
  return {revoked,pending,wakeAt:wakeAt===null||!Number.isFinite(wakeAt)?null:wakeAt};
 }
 /** Unrevoked, unexpired usernames of legs that are no longer live, and orphans (account deletion waits for these, E4;
  * recorded expiries are upper bounds, review L1). */
 async pending(owner){
  const now=this.now();
  return this.store.transaction(async tx=>{let n=0;for(const [,lease] of await tx.list({prefix:LEASE_PREFIX,limit:this.limits.leases*2})){const rec=await tx.get(lease.key),live=leaseLive(lease,rec,now)&&this.enabled(owner,lease.clientId);n+=lease.usernames.filter(u=>u.expiresAt>now&&(!live||u.orphan)).length+(!live&&lease.state==='issuing'&&lease.at+RELAY_LEASE_MS>now?1:0);}return n;});
 }
}
