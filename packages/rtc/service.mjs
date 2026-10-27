// RTC-d RtcService: the `rtc-signaling/v1` built-in occupant, its sessions, admission, tickets, outbox and the same-host
// transport (docs/spec/rtc-signaling.md §4, §6–§9, §12–§14; design docs/architecture/rtc-signaling.md §3, §8.1 RTC-d).
// Provisional (coordinator), not signed off by the user. Everything is behind RTC_SIGNALING_ENABLED (default off):
// while it is off nothing new is reachable (endpoint widening, owner widening and new sessions answer the uniform
// `not_found`), and existing state stays readable, narrowable and endable. Narrowing is never gated.
//
// One RtcService per entity account writer, which is the single authority for that entity's first claim. All behaviour
// is an ngin Action or Query (bottom of this file); the account slice (packages/runtime/account/rtc.mjs) and, later, the
// RPC/HTTP adapters (RTC-e) only build actors from verified evidence and dispatch.
//
// Actors (built by trusted adapters, never from a request body):
//   {kind:'app', owner, clientId, origin, grants:[id], epoch?, jkt?}   an application endpoint, from the verified
//          federation RPC context: the token's subject owner, client, the client's verified origin, the token's grant
//          ids (FederationService.checkBound REQUIRES them, review L6), its epoch and, when DPoP-bound, the key jkt
//   {kind:'owner', owner}                                               the account owner (settings, reads, narrowing)
//   {kind:'system', owner}                                              adapters: ingest, tick, drain, lifecycle
//
// Ports (constructor):
//   store       the account writer's transactional metadata ({transaction(tx => …)}, tx {get, put, delete, list})
//   keys        {certification(principal) -> [{kid, use, alg, jwk, state}] AS HELD (cache-only; never a fetch on a
//                federation request path), identity(principal) -> identity URI the verifier itself resolved | null,
//                handle?(principal) -> verified handle | null, resolveHandle?(handle) -> principal | null,
//                aep?(owner) -> own authority epoch, refresh?(principal, kid, {source, lane}) (schedule a background
//                refresh; never a fetch; review F1: `source` the pseudonymous source network, `lane` a link basis that
//                verified here), live?(principals) (review F1: peers of live or ringing sessions, refreshed first),
//                track?(principal) (RTC-e: keep a foreign peer's keys warm), warm?(principal) (RTC-e: the §4.1
//                caller-initiated fetch at `open`, never on a federation request path), maxLegSeconds?(principal) (the
//                peer issuer's declared bound, as held)}
//   signer      owner -> {kid, privateKey}: the entity's ACTIVE certification key (certificationSigner), loaded
//                outside every storage transaction
//   linkSigner  owner -> {kid, privateKey, publicJwk?}: the identity signing key for ticket metas
//   bound       {check({subject, clientId, fragment, grants, epoch, member, value, reference}) -> boolean}:
//                FederationService.checkBound (AMD-X1 item 4); absent means nothing is approved (fail closed)
//   transport   {deliver(from, to, batch), foreign?:boolean}: sameHostRtcTransport here; RTC-e adds the foreign one
//   contacts    {inspect(link) -> {parent, quarantined} | null}: the owner's contact links (ContactEndpointService)
//   flags       {for(ctx) -> {enabled(name)}}
//   defer       (owner, kind) -> void: asks the adapter to run `rtc.inbox` and `rtc.outbox-drain` soon, OUTSIDE the
//                current request (a detached task or the alarm; review M2). Cross-entity delivery never runs inside the
//                sender's request, and ingest only queues: steps 2–8 run later on the receiver. Absent: the adapter's
//                alarm (rtc.tick) does both.
//   pushTransport {send(subscription, payload, {urgency, ttl})} (RTC-e Web Push doorbell, spec §9.2): the host's push
//                transport; absent means no doorbell. Called after the admitting transaction, never inside it.
//   relay       (RTC-f, attachRelay) the entity's RtcRelay (packages/rtc/relay.mjs), the built-in ice-relay/v1 occupant:
//                every session `end` hands the ended record keys to `relay.ended` after the commit (revocation of
//                that leg's TURN credentials), and rtc.tick runs `relay.sweep`. Absent: no relay operation exists.
//   hostLimits  {take(name, parts) -> boolean}: a host-wide fixed-window limiter shared by every entity writer on this
//                host (review L1), for the §13 limit per caller origin principal across callee entities; the adapter
//                keys it by a keyed hash of `parts`. Absent: only the per-callee-writer count applies (design §8.3 gate).
//
// Store (entity account, prefix rtc/; bounds in sessions.mjs RTC_BOUNDS and design §3.4):
//   rtc/policy                  owner policy {other, self, requests, autoAccept}
//   rtc/ep/<id>                 endpoint {clientId, origin, purposes, bind:{jkt}|{secretHash}, grants, q, gap, …}
//   rtc/epq/<id>/<seq>          endpoint event queue (256 events / 512 KiB; SDP and candidates kept ≤ 60 s)
//   rtc/out/<sid>               caller record; rtc/in/<callerKey>/<sid> callee record (sessions.mjs)
//   rtc/dlv/<endpoint>/<sid>    fan-out index: which endpoints an invite was delivered to (claim, send)
//   rtc/dlg/<jkt>               certified delegates (reuse refused for live sessions plus 24 h)
//   rtc/ticket/<jti>            tickets (tickets.mjs); rtc/contact/<parent> contact-link RTC configuration
//   rtc/block/…, rtc/mute/…, rtc/missed/…, rtc/limit/…, rtc/aep/…, rtc/closed
//   rtc/outbox/<peer>/<seq>     outbox, per peer (1,024 rows, 64 per peer; part of both kept for control statements)
//   rtc/inq/<seq>               inbound queue of step-1-valid batches (256 batches / 4 MiB), processed after the answer
import {Provider} from '../../vendor/ngin/index.js';
import {AppAction,AppQuery,ownerOf} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {base64url,digest} from '../core/records.mjs';
import {samePrincipal} from '../orgs/grants.mjs';
import {delegatePublicJwk,jwkThumbprint,isJkt,originValid} from '../identity/delegation.mjs';
import {parseLinkQuery,parseLinkMeta} from '../links/envelope.mjs';
import {RTC_SIGNALING_SLOT} from './extension.mjs';
import {boundAllows} from '../federation/extensions.mjs';
import {RtcWireFault} from './jws.mjs';
import {parseBatch,batchStep1,buildBatch,parseMessage,verifyMessage,validateMessageContent,candidateAllowedByPolicy,messageAllowedBeforeClaim,linkDigest,mediaValid,iatWithinWindow,RTC_LIMITS} from './messages.mjs';
import {parseLegCertificate,verifyLegCertificate,signLegCertificate,parseControl,verifyControl,signControl,LEG_CERTIFICATE_SECONDS,LEG_CERTIFICATE_MAX_SECONDS} from './certificates.mjs';
import {registeredPurpose,REGISTERED_PURPOSES,validateInviteForPurpose,partiesAdmit,mediaWithin,projectContext} from './purposes.mjs';
import {RTC_TICKET_TYPE,canonicalBasisLink,mintTicketRecord,ticketFromLink,ticketAdmits,spendTicket,ticketView,purposeLinesValid,principalValid,TICKET_KEY,TICKET_PREFIX,TICKET_MAX_USES} from './tickets.mjs';
import {K,readPolicy,ipPolicyFor,policyWidens,isBlocked,isMuted,MUTE_KINDS,muteValue,takeLimits,pruneLimits,basisKind,alertAllowed,candidateEndpoints,DEFAULT_POLICY} from './admission.mjs';
import {transition,canTransition,isLive,dueEvent,recordExpired,decideClaim,claimUsable,offerSeq,payloadDigest,newLeg,gapExpired,RTC_BOUNDS,ORDER_LIMITS,SESSION_MAX_MS,RING_MAX_MS} from './sessions.mjs';

export const RTC_SIGNALING_FLAG='RTC_SIGNALING_ENABLED',RTC_FOREIGN_FLAG='RTC_FOREIGN_ENABLED',RTC_TICKETS_FLAG='RTC_TICKETS_ENABLED';
/** The fragment the application requested (the slot manifest URL), as recorded on its grants. */
export const RTC_FRAGMENT=RTC_SIGNALING_SLOT;
const CLOSED_KEY='rtc/closed',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,ENDPOINT_ID=/^ep_[A-Za-z0-9_-]{22}$/,SID=/^[A-Za-z0-9_-]{22,43}$/;
const DAY=86400000,FORWARD_MS=30000,BATCH=256;
/** RTC-e review F6: a foreign invite is re-sent only after its first `202`, at most twice, these many ms after that
 * acceptance (then after the first re-send); a permanent refusal stops it. */
export const INVITE_RESEND_DELAYS=Object.freeze([3000,12000]);
/** Review F7: doorbell pushes in flight at once (each push transport call has its own 10 s timeout). */
const PUSH_CONCURRENCY=4;
const fail=(code,message=code,status=400)=>{throw new AppFault(code,message,status);};
const notFound=()=>fail('not_found','Not found.',404);
const invalid=(message='Unsupported signaling request.')=>fail('invalid_args',message,400);
const limited=()=>fail('rate_limited','Too many real-time connection requests. Try again later.',429);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,required,optional=[])=>{if(!plain(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))invalid();return v;};
const party=p=>({iss:p.iss,sub:p.sub});
const sameRef=(a,b)=>Boolean(a&&b&&a.purpose===b.purpose&&a.version===b.version&&a.digest===b.digest);
const seconds=ms=>Math.floor(ms/1000);
const labelValid=v=>typeof v==='string'&&v.length>0&&v.length<=64&&v.isWellFormed()&&!/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u.test(v);
/** Web Push services this host accepts at `register` (spec §9.2: only origins it recognizes). Provisional list. */
// RTC-e: aligned with the host's push transport (packages/messaging/web-push.mjs PUSH_ORIGINS), which is the only one
// that can send; the provisional WNS origin was dropped because nothing could deliver to it.
export const PUSH_ORIGINS=Object.freeze(['https://fcm.googleapis.com','https://updates.push.services.mozilla.com','https://web.push.apple.com']);
/** The doorbell payload (spec §9.2): exactly {"t":"rtc","endpoint":<endpoint>}; no caller, purpose or session. */
export const doorbellPayload=endpoint=>({t:'rtc',endpoint});

/** The provider-held purpose for a line: {ref:{purpose, version, digest}, body}, or null (never fetched by URL). */
export function heldPurpose(line){
 const ref=typeof line==='string'?registeredPurpose(line):null;if(!ref)return null;
 const body=REGISTERED_PURPOSES.find(e=>e.id===line)?.versions.find(v=>v.version===ref.version)?.body;
 return body?{ref:{purpose:ref.artefact,version:ref.version,digest:ref.digest},body}:null;
}
const IP_RANK={relay:0,public:1,all:2};
const stricterIp=(a,b)=>(IP_RANK[a]??0)<=(IP_RANK[b]??0)?(a in IP_RANK?a:'relay'):b;
const keysView=keys=>(Array.isArray(keys)?keys:[]).filter(k=>plain(k)&&k.use==='cert'&&k.state==='active'&&plain(k.jwk)).map(k=>({kid:k.kid,use:'cert',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x:k.jwk.x,y:k.jwk.y},state:'active'}));
/** Review M1: the peer's held certification keys pinned on a session record (newest first, at most 8, deduplicated by
 * kid and point), so its control statements verify after it stops serving them. */
const pinKeys=(keys,prior=[])=>{const out=[],seen=new Set();for(const k of [...keysView(keys),...keysView(prior)]){const id=JSON.stringify([k.kid,k.jwk.x,k.jwk.y]);if(!seen.has(id)&&out.length<8){seen.add(id);out.push(k);}}return out;};

/**
 * Same-host transport (design §3.1 `sameHostRtcTransport`): delivers a batch to the peer entity's own writer on this
 * host as the system operation `rtc.ingest`, through exactly the verification path a foreign batch takes (§8.2).
 * `dispatch(sub, operation, input)` reaches that writer. A principal on another issuer is refused here; the foreign
 * transport (RTC-e) is a separate port behind RTC_FOREIGN_ENABLED.
 */
export function sameHostRtcTransport({issuer,dispatch}){
 return Object.freeze({foreign:false,async deliver(from,to,batch){if(to?.iss!==issuer||!UUID.test(to?.sub??''))throw new AppFault('rtc_foreign_unavailable','Cross-provider signaling is not available.',503);return dispatch(to.sub,'rtc.ingest',{batch});}});
}

export class RtcService{
 constructor({store,issuer,clock,random,flags,keys,signer,linkSigner,bound=null,transport,contacts=null,defer=null,hostLimits=null,pushTransport=null,federationSubject,allowLoopback=false,crypto=globalThis.crypto,maxLegSeconds=LEG_CERTIFICATE_SECONDS,peerMaxLegSeconds=LEG_CERTIFICATE_MAX_SECONDS}){
  if(typeof store?.transaction!=='function'||typeof issuer!=='string'||typeof keys?.certification!=='function'||typeof keys?.identity!=='function'||typeof signer!=='function'||typeof transport?.deliver!=='function')throw new TypeError('RtcService needs a store, issuer, keys, signer and transport.');
  Object.assign(this,{store,issuer,clock,random,flags,keys,signer,linkSigner,bound,transport,contacts,defer,hostLimits,pushTransport,allowLoopback,crypto,maxLegSeconds,peerMaxLegSeconds});
  this.federationSubject=federationSubject??(owner=>`${issuer}/entities/${owner}`);
  this.waiters=new Map();this.relay=null;
 }
 /** RTC-f: attaches the entity's relay occupant (constructed over this service). */
 attachRelay(relay){this.relay=relay??null;return this.relay;}
 now(){return this.clock.now();}
 self(owner){return {iss:this.issuer,sub:owner};}
 flag(owner,name=RTC_SIGNALING_FLAG,clientId){try{return this.flags?.for({subject:{kind:'account',owner},...clientId?{client:{clientId}}:{}}).enabled(name)===true;}catch{return false;}}
 /** Widening: the uniform `not_found` while RTC_SIGNALING_ENABLED (or the named flag) is off. */
 requireFlag(owner,clientId,name=RTC_SIGNALING_FLAG){if(!this.flag(owner,RTC_SIGNALING_FLAG,clientId)||name!==RTC_SIGNALING_FLAG&&!this.flag(owner,name,clientId))notFound();}
 app(actor){
  if(actor?.kind!=='app'||!UUID.test(actor.owner??'')||typeof actor.clientId!=='string'||!actor.clientId||actor.clientId.length>2048||!originValid(actor.origin,this.allowLoopback)||!Array.isArray(actor.grants)||!actor.grants.length||actor.grants.length>256||actor.grants.some(g=>typeof g!=='string')||actor.jkt!==undefined&&!isJkt(actor.jkt))fail('unauthorized','Application authorization is required.',401);
  return actor;
 }
 system(actor){if(actor?.kind!=='system'||!UUID.test(actor.owner??''))fail('forbidden','System only.',403);return actor.owner;}
 async bindOwner(tx,owner){if(await tx.get('owner')!==owner)fail('forbidden','Account owner mismatch.',403);}
 async peerKeys(p){try{return keysView(await this.keys.certification(party(p)));}catch{return [];}}
 async identity(p){try{const v=await this.keys.identity(party(p));return typeof v==='string'?v:null;}catch{return null;}}
 track(p){try{this.keys.track?.(party(p));}catch{/* best effort */}}
 /** The bound a peer's leg certificates must meet: its issuer's declared max_leg_certificate_seconds when held (RTC-e),
  * else the spec maximum. */
 peerMax(p){if(p?.iss===this.issuer)return this.peerMaxLegSeconds;let v=null;try{v=this.keys.maxLegSeconds?.(party(p));}catch{v=null;}return Number.isSafeInteger(v)&&v>=120&&v<=this.peerMaxLegSeconds?v:this.peerMaxLegSeconds;}
 async ownAep(owner){try{const v=await this.keys.aep?.(owner);return Number.isSafeInteger(v)&&v>=0?v:0;}catch{return 0;}}
 /** AMD-X1 item 4: the live bound approval of `line` (at its pinned version) behind this app's verified token. */
 async approved({owner,clientId,grants,epoch,bound},line){
  const held=heldPurpose(line);if(!held)return false;const reference={version:held.ref.version,digest:held.ref.digest};
  // RTC-i (bug 1): an app actor from a contract RPC carries the bound approval computed in that RPC's authorization
  // transaction (the adapter runs inside the owner's account gate and must not call the federation shard). Stored
  // endpoint records (fan-out) carry none and use the port, outside any account gate.
  if(bound!==undefined){try{return boundAllows({values:bound.values,versions:bound.versions,revision:'dispatch'},'purposes',line,{reference})===true;}catch{return false;}}
  if(!this.bound)return false;
  try{return await this.bound.check({subject:this.federationSubject(owner),clientId,fragment:RTC_FRAGMENT,grants,...epoch!==undefined?{epoch}:{},member:'purposes',value:line,reference})===true;}catch{return false;}
 }
 async requireApproved(app,line){if(!await this.approved(app,line))fail('forbidden','This purpose is not approved for this application.',403);}

 // ---- endpoints (§9.1 register, unregister, endpoints) -------------------------------------------------------------
 async endpointAuth(tx,app,input,now){
  if(typeof input.endpoint!=='string'||!ENDPOINT_ID.test(input.endpoint))notFound();
  const ep=await tx.get(K.endpoint(input.endpoint));if(!ep||ep.clientId!==app.clientId||!(ep.expiresAt>now))notFound();
  // An endpoint identifier alone never authorizes: the DPoP key it was registered with, or its secret (§9.1).
  if(ep.bind.jkt!==undefined){if(app.jkt!==ep.bind.jkt||input.endpoint_secret!==undefined)notFound();}
  else if(typeof input.endpoint_secret!=='string'||input.endpoint_secret.length>128||await digest(this.crypto,'rtc-endpoint\0'+input.endpoint_secret)!==ep.bind.secretHash)notFound();
  return ep;
 }
 async register(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);exact(input,['purposes'],['label','push']);
  if(!purposeLinesValid(input.purposes,16)||input.purposes.some(l=>!heldPurpose(l)))invalid('Choose approved purposes.');
  if(input.label!==undefined&&!labelValid(input.label))invalid('The label is at most 64 characters of plain text.');
  if(input.push!==undefined){const p=input.push;let u=null;try{u=new URL(p?.endpoint);}catch{u=null;}
   if(!plain(p)||!exact(p,['endpoint','keys'])||!u||u.protocol!=='https:'||u.username||u.password||!PUSH_ORIGINS.includes(u.origin)||!plain(p.keys)||Object.keys(p.keys).sort().join()!=='auth,p256dh'||typeof p.keys.auth!=='string'||typeof p.keys.p256dh!=='string'||p.keys.auth.length>64||p.keys.p256dh.length>128)invalid('This push subscription is not accepted.');}
  for(const line of input.purposes)await this.requireApproved(app,line);
  const id='ep_'+base64url(this.random.bytes(16)),secret=app.jkt===undefined?base64url(this.random.bytes(32)):null,now=this.now();
  const bind=secret===null?{jkt:app.jkt}:{secretHash:await digest(this.crypto,'rtc-endpoint\0'+secret)};
  await this.store.transaction(async tx=>{
   await this.bindOwner(tx,owner);if(await tx.get(CLOSED_KEY))notFound();
   let live=0;for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints*2})).values())if(ep.expiresAt>now)live++;
   if(live>=RTC_BOUNDS.endpoints)limited();
   await tx.put(K.endpoint(id),{v:1,id,clientId:app.clientId,origin:app.origin,purposes:[...input.purposes],label:input.label??null,push:input.push?structuredClone(input.push):null,bind,grants:[...app.grants],...app.epoch!==undefined?{epoch:app.epoch}:{},createdAt:now,lastSeen:now,expiresAt:now+RTC_BOUNDS.endpointIdleMs,q:{next:1,count:0,bytes:0},gap:false});
  });
  return {endpoint:id,...secret?{endpoint_secret:secret}:{},expires_at:seconds(now+RTC_BOUNDS.endpointIdleMs)};// Unix seconds, as certificate `exp`
 }
 /** rtc.unregister (narrowing, never gated): ends the endpoint's legs (§14) and deletes it with its queue. */
 async unregister(actor,input){
  const app=this.app(actor);exact(input,['endpoint'],['endpoint_secret']);const now=this.now();
  return this.commit(app.owner,async(tx,fx)=>{await this.bindOwner(tx,app.owner);const ep=await this.endpointAuth(tx,app,input,now);await this.removeEndpoint(tx,fx,ep,now,'revoked');return {};});
 }
 async endpoints(actor){
  const app=this.app(actor),now=this.now();
  return this.store.transaction(async tx=>{await this.bindOwner(tx,app.owner);const out=[];for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints*2})).values())if(ep.clientId===app.clientId&&ep.expiresAt>now)out.push({endpoint:ep.id,label:ep.label,purposes:[...ep.purposes],last_seen:ep.lastSeen});return {endpoints:out};});
 }

 // ---- transactions with deferred effects ------------------------------------------------------------------------------
 /** Runs `fn(tx, fx)` in one storage transaction. `fx.woken` collects endpoints with new events (long polls are woken
  * after commit) and `fx.drain` notes queued outbox rows: the adapter is asked (`defer`) to deliver them soon, never
  * inside this request (review M2: a sender's request never waits on, or runs, the peer's admission). */
 async commit(owner,fn){
  const fx={woken:new Set(),drain:false,doorbells:[]};const out=await this.store.transaction(tx=>fn(tx,fx));
  for(const id of fx.woken)this.wake(id);
  if(fx.drain)this.kick(owner,'outbox');
  if(fx.doorbells.length)await this.ring(fx.doorbells);
  // RTC-f: the legs ended in this transaction lose their relay credentials (best effort; the sweep is the fallback).
  if(fx.relayEnded?.length&&this.relay)await this.relay.ended(owner,fx.relayEnded).catch(()=>null);
  return out;
 }
 /**
  * RTC-e Web Push doorbell (spec §9.2): at most one push per alerting invite per endpoint (collected by admitInvite
  * inside the admitting transaction, sent here after it committed), only to the subscription stored and validated at
  * `register`, `Urgency: high`, a TTL no longer than the remaining ring time, and a payload of exactly
  * {"t":"rtc","endpoint":<endpoint>}. A push is a doorbell only: it is never needed for correctness, and a failure
  * never affects admission. A subscription the push service reports gone is removed from the endpoint.
  */
 async ring(doorbells){
  if(typeof this.pushTransport?.send!=='function')return;
  // Review F7: pushes go out in parallel, at most PUSH_CONCURRENCY at once, so one slow push service never holds the
  // inbox pass for the whole fan-out.
  const one=async d=>{
   const ttl=Math.max(0,Math.floor((d.ringUntil-this.now())/1000));if(ttl<1)return;
   try{await this.pushTransport.send(structuredClone(d.subscription),doorbellPayload(d.endpoint),{urgency:'high',ttl});}
   catch(error){if(error?.code==='push_subscription_gone')try{await this.store.transaction(async tx=>{const ep=await tx.get(K.endpoint(d.endpoint));if(ep?.push&&ep.push.endpoint===d.subscription.endpoint){ep.push=null;await tx.put(K.endpoint(ep.id),ep);}});}catch{/* the next invite retries */}}
  };
  const queue=[...doorbells];await Promise.all(Array.from({length:Math.min(PUSH_CONCURRENCY,queue.length)},async()=>{while(queue.length)await one(queue.shift());}));
 }
 kick(owner,kind){try{this.defer?.(owner,kind);}catch{/* the alarm delivers */}}
 wake(id){const set=this.waiters.get(id);if(set){this.waiters.delete(id);for(const resolve of set)resolve();}}
 waitFor(id,ms){return new Promise(resolve=>{const set=this.waiters.get(id)??new Set();this.waiters.set(id,set);const done=()=>{clearTimeout(timer);set.delete(done);resolve();};const timer=setTimeout(done,ms);set.add(done);});}

 // ---- endpoint queues (§9.1 listen) ---------------------------------------------------------------------------------
 /** Appends one event to an endpoint queue. Returns false on overflow (the endpoint's `gap` is set). SDP and
  * candidates (`sensitive`) are deleted on delivery or after 60 s (§12). */
 async push(tx,fx,endpointId,event,now,{sensitive=false}={}){
  const ep=await tx.get(K.endpoint(endpointId));if(!ep)return false;
  const row={...event,at:now,...sensitive?{expiresAt:now+RTC_BOUNDS.sensitiveMs}:{}},bytes=JSON.stringify(row).length+64;
  if(ep.q.count+1>RTC_BOUNDS.queueEvents||ep.q.bytes+bytes>RTC_BOUNDS.queueBytes){if(!ep.gap){ep.gap=true;await tx.put(K.endpoint(ep.id),ep);}return false;}
  const seq=ep.q.next;ep.q={next:seq+1,count:ep.q.count+1,bytes:ep.q.bytes+bytes};await tx.put(K.endpoint(ep.id),ep);
  await tx.put(K.queue(ep.id,seq),{...row,seq,bytes});fx.woken.add(ep.id);return true;
 }
 /** Deletes queue rows up to `upTo` (acknowledged by the cursor) and, with `sensitive`, SDP/candidate rows past 60 s. */
 async dropQueue(tx,ep,{upTo=0,now,sensitive=false}={}){
  let changed=false,after;
  for(;;){
   const page=await tx.list({prefix:K.queuePrefix(ep.id),limit:BATCH,...after?{startAfter:after}:{}});let stop=false;
   for(const [key,row] of page){after=key;
    if(!(row.seq<=upTo||sensitive&&row.expiresAt<=now)){if(!sensitive){stop=true;break;}continue;}
    await tx.delete(key);ep.q.count=Math.max(0,ep.q.count-1);ep.q.bytes=Math.max(0,ep.q.bytes-(row.bytes??0));changed=true;}
   if(stop||page.size<BATCH)break;
  }
  return changed;
 }
 async listen(actor,input){
  const app=this.app(actor);exact(input,['endpoint'],['cursor','wait','endpoint_secret']);
  if(input.cursor!==undefined&&!(Number.isSafeInteger(input.cursor)&&input.cursor>=0))invalid();if(input.wait!==undefined&&!(Number.isSafeInteger(input.wait)&&input.wait>=0&&input.wait<=25))invalid();
  const deadline=this.now()+Math.min((input.wait??0)*1000,RTC_BOUNDS.listenWaitMs);
  for(let round=0;;round++){
   const now=this.now();
   const out=await this.store.transaction(async tx=>{
    await this.bindOwner(tx,app.owner);const ep=await this.endpointAuth(tx,app,input,now);
    // Reading is allowed while the flag is off for an endpoint that exists (existing state stays readable).
    await this.dropQueue(tx,ep,{upTo:input.cursor??0,now,sensitive:true});
    const events=[];for(const row of (await tx.list({prefix:K.queuePrefix(ep.id),limit:RTC_BOUNDS.listenPage})).values()){const {at,bytes,expiresAt,...event}=row;events.push(event);}
    const gap=ep.gap===true;ep.gap=false;ep.lastSeen=now;ep.expiresAt=now+RTC_BOUNDS.endpointIdleMs;await tx.put(K.endpoint(ep.id),ep);
    return {cursor:events.length?events.at(-1).seq:Math.max(input.cursor??0,0),events,gap,id:ep.id};
   });
   if(out.events.length||out.gap||round>0||this.now()>=deadline){const {id,...rest}=out;return rest;}
   await this.waitFor(out.id,deadline-this.now());
  }
 }

 // ---- outbox (§8.3 at-least-once; design §3.4 1,024 batches, review M3) ------------------------------------------
 async outboxMeta(tx){const m=await tx.get(K.outboxSeq);if(plain(m))return {seq:m.seq,count:m.count};
  // An older number-only row: recount once.
  return {seq:Number.isSafeInteger(m)?m:0,count:(await tx.list({prefix:K.outboxPrefix,limit:RTC_BOUNDS.outbox+1})).size};}
 /** Queues one batch for `to` inside the caller's transaction. Control statements are stored unsigned and signed at
  * drain time, outside any storage transaction. Returns false when the outbox is full: in total (1,024) or for this
  * peer (64). Message batches stop short of both caps by a reserve kept for control statements, so a peer that
  * withholds acceptance, or one busy session, cannot crowd out revocations to everyone else (review M3). */
 async enqueue(tx,fx,{to,certificates=[],messages=[],controls=[],links=[],until,invite}){
  const control=messages.length===0&&controls.length>0,meta=await this.outboxMeta(tx);
  const total=RTC_BOUNDS.outbox-(control?0:RTC_BOUNDS.outboxControlReserve),perPeer=RTC_BOUNDS.outboxPeer-(control?0:RTC_BOUNDS.outboxPeerControlReserve);
  if(meta.count>=total||(await tx.list({prefix:K.outboxPeerPrefix(to),limit:perPeer})).size>=perPeer)return false;
  const seq=meta.seq+1;await tx.put(K.outboxSeq,{seq,count:meta.count+1});
  await tx.put(K.outbox(to,seq),{seq,to:party(to),certificates,messages,controls,links,until,attempts:0,notBefore:0,...typeof invite==='string'?{invite}:{}});fx.drain=true;return true;
 }
 async outboxRemove(key){await this.store.transaction(async tx=>{if(!await tx.get(key))return;await tx.delete(key);const meta=await this.outboxMeta(tx);await tx.put(K.outboxSeq,{seq:meta.seq,count:Math.max(0,meta.count-1)});});}
 /** Queues a control statement `end` (§5.2) for `leg` (null: the whole session) of `rec` to the peer entity. Own-entity
  * sessions end locally on both records instead (one writer). */
 async enqueueControl(tx,fx,owner,rec,{leg=null,reason,now}){
  if(rec.own)return false;const peer=rec.role==='caller'?rec.callee:rec.caller;
  return this.enqueue(tx,fx,{to:peer,controls:[{sid:rec.sid,leg,reason,aud:rec.peerIdentity,iat:seconds(now),jti:base64url(this.random.bytes(24))}],until:now+this.peerMaxLegSeconds*1000});
 }
 /** Delivers due outbox rows, in order per peer (bounded by `limit` rows visited). A failed row backs off (0.5, 1, 2,
  * 4 s, …) and holds the later rows for the same peer, so a receiver sees each leg in order; the pass then pages past
  * that peer's rows (they are contiguous), so one failing or slow peer never stalls the others (review M3). Rows past
  * their useful life are dropped. */
 async drain(owner,{limit=32}={}){
  const now=this.now();let sent=0,pending=0,visited=0,more=false,signer=null,after=null;
  outer:for(;;){
   const page=await this.store.transaction(tx=>tx.list({prefix:K.outboxPrefix,limit:BATCH,...after?{startAfter:after}:{}}));let jumped=false;
   for(const [key,row] of page){
    if(visited>=limit){more=true;break outer;}
    visited++;after=key;const skip=()=>{pending++;after=key.slice(0,key.lastIndexOf('/')+1)+'\uffff';jumped=true;};
    if(row.until<=now){await this.outboxRemove(key);continue;}
    if(row.notBefore>now){skip();break;}
    try{
     let controls=[];if(row.controls.length){signer??=await this.signer(owner);if(!signer)throw new Error('no certification key');
      controls=await Promise.all(row.controls.map(c=>signControl({issuer:this.issuer,sub:owner,aud:c.aud,sid:c.sid,leg:c.leg,reason:c.reason,now:c.iat*1000,jti:c.jti,allowLoopback:this.allowLoopback},signer,this.crypto)));}
     await this.transport.deliver(this.self(owner),row.to,buildBatch({certificates:row.certificates,messages:row.messages,controls,links:row.links}));
     await this.outboxRemove(key);sent++;
     if(row.invite)await this.inviteOutcome(row.invite,{accepted:true});
    }catch(error){
     // RTC-e: a permanent refusal by the peer provider (4xx other than 429, a redirect, a target outside the allowlist)
     // is not retried (§8.3 retries only network errors and 5xx); the row is dropped, and (review F6) an invite of
     // that session is not re-sent again.
     if(error?.permanent===true){await this.outboxRemove(key);if(row.invite)await this.inviteOutcome(row.invite,{accepted:false});continue;}
     const attempts=row.attempts+1;
     await this.store.transaction(async tx=>{if(await tx.get(key))await tx.put(key,{...row,attempts,notBefore:now+Math.min(4000,500*2**(attempts-1))});});
     skip();break;
    }
   }
   if(!jumped&&page.size<BATCH)break;
  }
  return {sent,pending,more};
 }

 /** RTC-e review F6: the delivery outcome of a foreign invite (or one of its re-sends). The first `202` arms at most
  * INVITE_RESEND_DELAYS.length re-sends; a permanent refusal ends re-sending for that session. */
 async inviteOutcome(sid,{accepted}){
  try{await this.store.transaction(async tx=>{const rec=await tx.get(K.out(sid));if(!rec?.inviteRetry)return;
   if(!accepted){delete rec.inviteRetry;delete rec.inviteCompact;}
   else if(rec.inviteRetry.acked!==true)rec.inviteRetry={acked:true,n:0,at:this.now()+INVITE_RESEND_DELAYS[0]};else return;
   await tx.put(K.out(sid),rec);});}catch{/* the re-send is a SHOULD (§8.3) */}
 }
 // ---- inbound queue (§8.2 "processing after step 1 MAY be asynchronous"; review M2) ----------------------------------
 /** Steps 2–8 for queued batches, oldest first, at most `limit` per call (`rtc.inbox`: the adapter's detached task or
  * the alarm, never the sender's request). Each batch is processed as of its receipt time, then removed; processing
  * is idempotent (sessions, `seq` and control `jti` deduplicate), so a crash in between only repeats it. */
 processInbox(owner,options){
  // One pass at a time per service (one per writer): the detached task and the alarm never process a batch twice.
  const run=(this.inboxRun??Promise.resolve()).then(()=>this.inboxPass(owner,options));this.inboxRun=run.catch(()=>null);return run;
 }
 async inboxPass(owner,{limit=16}={}){
  const rows=await this.store.transaction(tx=>tx.list({prefix:K.inboxPrefix,limit}));let processed=0;
  for(const [key,row] of rows){
   try{const elements=await batchStep1(parseBatch(row.batch),{issuer:this.issuer,now:seconds(row.at),parseCertificate:parseLegCertificate,parseControl,allowLoopback:this.allowLoopback,crypto:this.crypto});await this.process(owner,elements,row.at,{source:row.source});}catch{/* steps 2–8 are silent */}
   await this.store.transaction(async tx=>{if(!await tx.get(key))return;await tx.delete(key);const m=await tx.get(K.inboxMeta)??{seq:0,count:0,bytes:0};await tx.put(K.inboxMeta,{seq:m.seq,count:Math.max(0,m.count-1),bytes:Math.max(0,m.bytes-(row.bytes??0))});});
   processed++;
  }
  return {processed,more:rows.size===limit};
 }

 // ---- sessions: shared helpers ----------------------------------------------------------------------------------------
 async twinOf(tx,rec){return rec.own?tx.get(rec.role==='caller'?K.in(rec.caller,rec.sid):K.out(rec.sid)):null;}
 keyOf(rec){return rec.role==='caller'?K.out(rec.sid):K.in(rec.caller,rec.sid);}
 /** The endpoints of this entity that see a session: the caller's endpoint; for a callee record the claimant, or every
  * endpoint the invite was delivered to while unclaimed. */
 audience(rec){return rec.role==='caller'?[rec.mine.endpoint]:rec.claim?[rec.claim.endpoint]:[...rec.delivered];}
 /**
  * Ends a live record (mutating; the caller writes it): the transition, a `state` event to this entity's endpoints,
  * the missed list for an unclaimed callee record, the twin of an own-entity session, and (when `control` is given) a
  * control statement for the peer (`control` = {leg, reason}). Illegal transitions are ignored (already ended).
  */
 async end(tx,fx,owner,rec,event,{now,reason,control,controlStatement=null,silent=false,twin=true}={}){
  if(!canTransition(rec.state,event))return false;const wasRinging=rec.state==='ringing';transition(rec,event,{now,reason});
  if(fx)(fx.relayEnded??=[]).push(this.keyOf(rec));// RTC-f: revoke this leg's relay credentials after the commit
  if(!silent){const state=['timeout','expired'].includes(rec.endReason)?'expired':'ended';for(const id of this.audience(rec))await this.push(tx,fx,id,{type:'state',sid:rec.sid,state,...controlStatement?{control:controlStatement}:{}},now);}
  if(rec.role==='callee'){delete rec.callbackLink;delete rec.invite;if(wasRinging&&!rec.claim&&['timeout','cancelled','expired'].includes(rec.endReason)&&!rec.held)await this.addMissed(tx,{caller:rec.caller,line:rec.purpose.purpose,kind:'missed',at:now});}
  if(rec.role==='caller'){delete rec.basisLink;delete rec.callbackLink;delete rec.inviteCompact;delete rec.inviteRetry;}
  if(control)await this.enqueueControl(tx,fx,owner,rec,{leg:control.leg??null,reason:control.reason,now});
  if(rec.own&&twin){const other=await this.twinOf(tx,rec);if(other&&isLive(other)){await this.end(tx,fx,owner,other,canTransition(other.state,event)?event:'revoke',{now,reason:rec.endReason,silent,twin:false});await tx.put(this.keyOf(other),other);}}
  return true;
 }
 async addMissed(tx,{caller,line,kind,at}){
  const rows=await tx.list({prefix:K.missedPrefix,limit:RTC_BOUNDS.missed+1});
  if(rows.size>=RTC_BOUNDS.missed){const over=rows.size-RTC_BOUNDS.missed+1;let i=0;for(const key of rows.keys()){if(i++>=over)break;await tx.delete(key);}}
  const id=base64url(this.random.bytes(12));await tx.put(K.missed(at,id),{id,caller:party(caller),purpose:line,kind,at});
 }
 async delegateFree(tx,jkt){return !await tx.get(K.delegate(jkt));}
 async recordDelegate(tx,jkt,sid,now){await tx.put(K.delegate(jkt),{sid,until:now+SESSION_MAX_MS+RTC_BOUNDS.delegateMs});}
 async certFor({owner,app,rec,role,delegate,now}){
  const signer=await this.signer(owner);if(!signer)fail('temporarily_unavailable','Real-time connections are temporarily unavailable.',503);
  const identity=await this.identity(this.self(owner));if(!identity)fail('temporarily_unavailable','Real-time connections are temporarily unavailable.',503);
  return signLegCertificate({issuer:this.issuer,sub:owner,identity,aud:rec.peerIdentity,sid:rec.sid,role,purpose:rec.purpose,client:{client_id:app.clientId,origin:app.origin},delegate,aep:await this.ownAep(owner),now,lifetime:this.maxLegSeconds,maxSeconds:this.maxLegSeconds,sessionEndsAt:seconds(rec.endsAt),allowLoopback:this.allowLoopback},signer,this.crypto);
 }

 // ---- open (§4.1, §9.1) -----------------------------------------------------------------------------------------------
 async resolveCallee(to){
  if(typeof to==='string'){if(!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(to)||typeof this.keys.resolveHandle!=='function')notFound();let p=null;try{p=await this.keys.resolveHandle(to);}catch{p=null;}if(!p||!principalValid(p,this.allowLoopback))notFound();return party(p);}
  if(!principalValid(to,this.allowLoopback))invalid('Choose who to connect with.');return party(to);
 }
 async open(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);
  exact(input,['endpoint','to','purpose','media','delegate'],['basis','target','callback','endpoint_secret']);
  const held=heldPurpose(input.purpose);if(!held)invalid('Unknown purpose.');
  if(!mediaValid(input.media)||!mediaWithin(input.media,held.body))invalid('These media are not permitted for this purpose.');
  const to=await this.resolveCallee(input.to),self=this.self(owner),own=samePrincipal(to,self);
  if(!partiesAdmit(held.body,{ownEntity:own}))invalid('This purpose cannot connect with that party.');
  // A peer whose provider does not declare rtc-signaling.v1 is a public fact; with RTC_FOREIGN_ENABLED off this host
  // declares no cross-provider signaling at all.
  if(to.iss!==this.issuer&&(!this.flag(owner,RTC_FOREIGN_FLAG,app.clientId)||this.transport.foreign!==true))fail('unsupported_peer','That person\'s provider does not support real-time connections.',400);
  if(input.target!==undefined&&(!own||typeof input.target!=='string'||!ENDPOINT_ID.test(input.target)))invalid('A target is one of your own devices.');
  if(input.callback!==undefined&&(typeof input.callback!=='boolean'||input.callback&&own))invalid();
  if(input.callback===true&&!this.flag(owner,RTC_TICKETS_FLAG,app.clientId))notFound();
  const basis=input.basis===undefined?null:canonicalBasisLink(input.basis);if(input.basis!==undefined&&(basis===null||own))invalid('This link cannot be presented.');
  const delegate=await delegatePublicJwk(input.delegate,this.crypto);if(!delegate)invalid('A P-256 leg key is required.');
  const jkt=await jwkThumbprint(delegate.jwk,this.crypto);
  await this.requireApproved(app,held.ref.purpose);
  // Caller-initiated key read (§4.1), never on a federation request path; without keys the answer could not verify.
  // RTC-e: for a callee on another provider, the caller-initiated fetch (§4.1; interactive budget) warms the roster,
  // which then keeps the callee's keys current for the session's life.
  // Verification follow-ups: a per-owner `warms` limit is spent before any directory budget (only when the callee's
  // keys are not already held), and the callee is tracked only once its session record exists (below).
  if(to.iss!==this.issuer&&!(await this.peerKeys(to)).length){
   const admitted=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);await this.endpointAuth(tx,app,input,this.now());return takeLimits(tx,[{name:'warms',parts:[owner]}],this.now(),this.crypto);});
   if(!admitted)limited();
   try{await this.keys.warm?.(to);}catch{/* answered below */}
  }
  const now=this.now(),peerKeys=await this.peerKeys(to),peerIdentity=await this.identity(to);
  if(!peerKeys.length||!peerIdentity){
   // RTC-i (§4.1): a callee issuer whose fresh manifest declares no rtc-signaling.v1 is refused with unsupported_peer
   // (a public fact); anything else that left no keys is temporarily_unavailable.
   let unsupported=false;try{unsupported=to.iss!==this.issuer&&this.keys.unsupported?.(party(to))===true;}catch{unsupported=false;}
   if(unsupported)fail('unsupported_peer','That person\'s provider does not support real-time connections.',400);
   fail('temporarily_unavailable','Real-time connections are temporarily unavailable.',503);}
  await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);await this.endpointAuth(tx,app,input,now);});
  const sid=base64url(this.random.bytes(16)),policy=await this.store.transaction(readPolicy);
  const rec={v:1,sid,role:'caller',state:'ringing',own,caller:self,callee:to,peerIdentity,purpose:held.ref,media:[...input.media],createdAt:now,ringUntil:now+RING_MAX_MS,endsAt:now+SESSION_MAX_MS,
   mine:{endpoint:input.endpoint,clientId:app.clientId,origin:app.origin,jkt,delegate:delegate.jwk,certificate:null,exp:0,certSent:null,order:newLeg(),rate:null},theirs:null,
   ip:ipPolicyFor(policy,{crossEntity:!own}),peerKeys:pinKeys(peerKeys),basisLink:basis,...basis?{basisDigest:await linkDigest(basis,this.crypto)}:{},...input.target?{target:input.target}:{},controls:[],inviteSent:false};
  let callback=null;
  if(input.callback===true){const signer=await this.linkSigner?.(owner);if(!signer)fail('temporarily_unavailable','Real-time connections are temporarily unavailable.',503);
   callback=await mintTicketRecord({issuer:this.issuer,sub:owner,purposes:[held.ref.purpose],uses:1,expiresIn:86400,principal:to,signer,now,callback:true,allowLoopback:this.allowLoopback,crypto:this.crypto});
   rec.callbackLink=callback.link;rec.callbackDigest=await linkDigest(callback.link,this.crypto);}
  const cert=await this.certFor({owner,app,rec,role:'caller',delegate:delegate.jwk,now});rec.mine.certificate=cert.certificate;rec.mine.exp=cert.exp;
  await this.store.transaction(async tx=>{
   await this.bindOwner(tx,owner);if(await tx.get(CLOSED_KEY))notFound();await this.endpointAuth(tx,app,input,now);
   if(input.target!==undefined){const t=await tx.get(K.endpoint(input.target));if(!t||t.id===input.endpoint||!(t.expiresAt>now)||!t.purposes.includes(held.ref.purpose))invalid('A target is one of your own eligible devices.');}
   if(!await this.delegateFree(tx,jkt))invalid('This leg key was already used.');
   let open=0;for(const r of (await tx.list({prefix:K.outPrefix,limit:4096})).values())if(isLive(r))open++;
   if(open>=RTC_BOUNDS.callerOpen||!await takeLimits(tx,[{name:'opens',parts:[owner]}],now,this.crypto))limited();
   if(callback){if((await this.liveTickets(tx,now))>=RTC_BOUNDS.tickets)limited();await tx.put(TICKET_KEY(callback.record.jti),callback.record);}
   await tx.put(K.out(sid),rec);await this.recordDelegate(tx,jkt,sid,now);
  });
  if(to.iss!==this.issuer)this.track(to);// RTC-e: the roster keeps the callee's keys current for the session's life
  return {sid,certificate:cert.certificate,expires_at:cert.exp,peer_keys:peerKeys,...callback?{callback:callback.link}:{}};
 }
 async liveTickets(tx,now){let n=0;for(const row of (await tx.list({prefix:TICKET_PREFIX,limit:RTC_BOUNDS.tickets*4})).values())if(!row.revoked&&row.usesLeft>0&&row.expiresAt>now)n++;return n;}

 // ---- claim (§7.2) --------------------------------------------------------------------------------------------------
 async claim(actor,input){
  const app=this.app(actor),owner=app.owner;exact(input,['endpoint','sid','outcome','delegate'],['endpoint_secret']);
  if(!['accept','decline'].includes(input.outcome)||typeof input.sid!=='string'||!SID.test(input.sid))invalid();
  // A decline is narrowing (never gated); an accept connects, so it is widening.
  if(input.outcome==='accept')this.requireFlag(owner,app.clientId);
  const delegate=await delegatePublicJwk(input.delegate,this.crypto);if(!delegate)invalid('A P-256 leg key is required.');
  const jkt=await jwkThumbprint(delegate.jwk,this.crypto),now=this.now();
  const peek=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);const dl=await tx.get(K.delivered(ep.id,input.sid));return dl?await tx.get(dl.key):null;});
  if(!peek)notFound();
  if(input.outcome==='accept')await this.requireApproved(app,peek.purpose.purpose);
  const won=await this.commit(owner,async(tx,fx)=>{
   const ep=await this.endpointAuth(tx,app,input,now),dl=await tx.get(K.delivered(ep.id,input.sid)),rec=dl?await tx.get(dl.key):null;if(!rec)notFound();
   if(!(rec.claim?.jkt===jkt)&&!await this.delegateFree(tx,jkt))invalid('This leg key was already used.');
   const r=decideClaim(rec,{endpoint:ep.id,jkt,outcome:input.outcome,now});
   if(!r.won){if(r.code==='not_delivered')notFound();fail('claimed','This session was already answered.',409);}
   if(!r.repeat){
    await this.recordDelegate(tx,jkt,rec.sid,now);
    rec.mine={endpoint:ep.id,clientId:app.clientId,origin:app.origin,jkt,delegate:delegate.jwk,certificate:null,exp:0,certSent:null,order:newLeg(),rate:null};
    rec.ip=ipPolicyFor(await readPolicy(tx),{crossEntity:!rec.own});
    // The other notified endpoints learn only that the session was claimed: not by which endpoint, nor the outcome.
    for(const id of rec.delivered)if(id!==ep.id)await this.push(tx,fx,id,{type:'state',sid:rec.sid,state:'claimed'},now);
    delete rec.invite;
   }
   await tx.put(dl.key,rec);return {key:dl.key,rec:structuredClone(rec)};
  });
  const cert=await this.certFor({owner,app,rec:won.rec,role:'callee',delegate:delegate.jwk,now});
  // Review L2: the certificate is handed out only while the claim can still be used (the session may have ended
  // while it was signed outside the transaction). RTC-i review L2: that late refusal is `claimed` (spec §7.2) after the
  // claim record was committed; it is final, not effect-free (packages/federation/runtime.mjs NO_EFFECT_CODES).
  await this.store.transaction(async tx=>{const rec=await tx.get(won.key);if(rec?.claim?.jkt===jkt&&rec.mine&&claimUsable(rec)){rec.mine.certificate=cert.certificate;rec.mine.exp=cert.exp;rec.mine.certSent=null;await tx.put(won.key,rec);}else fail('claimed','This session was already answered.',409);});
  // The callback ticket goes only to the endpoint that claimed the session (§4.3).
  return {certificate:cert.certificate,peer_keys:await this.peerKeys(won.rec.caller),...won.rec.callbackLink?{callback:won.rec.callbackLink}:{}};
 }

 // ---- renew (§5.1) --------------------------------------------------------------------------------------------------
 async renew(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);exact(input,['endpoint','sid'],['endpoint_secret']);
  const now=this.now(),found=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);return this.ownSession(tx,ep,input.sid);});
  if(!found||!isLive(found.rec)||!found.rec.mine?.certificate)notFound();
  const cert=await this.certFor({owner,app,rec:found.rec,role:found.rec.role,delegate:found.rec.mine.delegate,now});
  await this.store.transaction(async tx=>{const rec=await tx.get(found.key);if(rec&&isLive(rec)&&rec.mine?.jkt===found.rec.mine.jkt){rec.mine.certificate=cert.certificate;rec.mine.exp=cert.exp;rec.mine.certSent=null;await tx.put(found.key,rec);}else notFound();});
  return {certificate:cert.certificate};
 }
 /** The session `sid` that endpoint `ep` holds a leg in: its out record, or the in record it claimed. */
 async ownSession(tx,ep,sid){
  if(typeof sid!=='string'||!SID.test(sid))return null;
  const out=await tx.get(K.out(sid));if(out&&out.mine?.endpoint===ep.id)return {key:K.out(sid),rec:out};
  const dl=await tx.get(K.delivered(ep.id,sid)),rec=dl?await tx.get(dl.key):null;
  return rec&&rec.claim?.endpoint===ep.id?{key:dl.key,rec}:null;
 }

 // ---- send (§6, §6.3, §10 on the sender's own provider) -------------------------------------------------------------
 async send(actor,input){
  const app=this.app(actor),owner=app.owner;exact(input,['endpoint','sid','messages'],['endpoint_secret']);
  if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>RTC_LIMITS.batchMessages)invalid();
  let parsed;try{parsed=input.messages.map(m=>parseMessage(m,{allowLoopback:this.allowLoopback}));}catch{invalid('A message is invalid.');}
  // `end`, `cancel` and `decline` are narrowing and never gated; everything else needs the flag.
  if(parsed.some(m=>!['end','cancel','decline'].includes(m.payload.type)))this.requireFlag(owner,app.clientId);
  const now=this.now(),nowS=seconds(now);
  const found=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);const s=await this.ownSession(tx,ep,input.sid);return s&&{...s,policy:await readPolicy(tx)};});
  if(!found||!found.rec.mine?.certificate)notFound();
  const rec0=found.rec,certificate={payload:parseLegCertificate(rec0.mine.certificate,{allowLoopback:this.allowLoopback}).payload},crossEntity=!rec0.own,held=heldPurpose(rec0.purpose.purpose);
  // Review L3: the stricter of the policy pinned at open or claim and the owner's current one, so narrowing the IP
  // policy applies to live sessions at once (widening never does).
  const ip=stricterIp(rec0.ip,ipPolicyFor(found.policy,{crossEntity}));
  const prepared=[];
  for(const m of parsed){
   const p=m.payload;
   try{await verifyMessage(m,certificate,{now:nowS,crypto:this.crypto});}catch{invalid('A message does not verify for this leg.');}
   if(p.type==='invite'){
    if(rec0.role!=='caller'||!sameRef(p.body.purpose,rec0.purpose)||!mediaWithin(p.body.media,{media:rec0.media}))invalid('The invite does not match this session.');
    try{validateInviteForPurpose(p.body,held.body,{ownEntity:rec0.own});}catch{invalid('The invite does not match its purpose.');}
    if((p.body.basis?.link_digest??null)!==(rec0.basisDigest??null)||(p.body.callback_digest??null)!==(rec0.callbackDigest??null))invalid('The invite basis does not match this session.');
   }
   if(['accept','decline'].includes(p.type)&&p.type!==(rec0.claim?.outcome==='accept'?'accept':'decline'))invalid('The answer does not match the claim.');
   try{const candidates=validateMessageContent(p,{media:rec0.media,crossEntity});
    // The owner's IP policy restricts what this endpoint SENDS (§10): relay-only by default between entities (RTC-6).
    if(candidates.some(c=>!candidateAllowedByPolicy(c,ip,{crossEntity})))invalid('A candidate is not allowed by your IP privacy setting.');}
   catch(error){if(error instanceof AppFault)throw error;invalid('A message breaks the SDP or candidate rules.');}
   prepared.push({m,p,digest:await payloadDigest(m.compact,this.crypto)});
  }
  return this.commit(owner,async(tx,fx)=>{
   const ep=await this.endpointAuth(tx,app,input,now),rec=(await tx.get(found.key));if(!rec||rec.mine?.jkt!==rec0.mine.jkt||rec.mine.endpoint!==ep.id)notFound();
   const out=[];let accepted=0;
   for(const {m,p,digest:d} of prepared){
    if(rec.state==='ended'&&!(p.type==='decline'&&rec.endReason==='declined'&&!rec.declineSent))break;// a message for an ended session is ignored
    const peerLeg=rec.theirs?.jkt;
    if(!messageAllowedBeforeClaim(p.type)&&rec.role==='caller'&&!rec.theirs)invalid('Only the invite and cancel travel before the claim.');
    if(p.to!==null&&p.to!==peerLeg)invalid('The message names another leg.');
    if(!await this.legRate(tx,rec.mine,now))limited();
    if(p.seq>rec.mine.order.next)invalid('Messages must be sent in order.');
    const r=offerSeq(rec.mine.order,{seq:p.seq,digest:d,compact:m.compact,now});
    if(r.action==='duplicate')continue;
    if(r.action==='fail'){await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:rec.mine.jkt,reason:'failed'}});break;}
    accepted++;out.push(m.compact);
    if(p.type==='invite'){rec.inviteSent=true;rec.ringUntil=Math.min(p.body.ring_until*1000,now+RING_MAX_MS);
     // RTC-e §8.3: a held-key miss at a foreign callee provider drops the invite silently after a 202, so the caller
     // provider re-sends the unchanged invite (with its certificate and links). Review F6: only after the first 202
     // (inviteOutcome) and at most twice; a permanent refusal stops it.
     if(rec.callee.iss!==this.issuer){rec.inviteCompact=m.compact;rec.inviteRetry={acked:false,n:0,at:null};}}
    if(p.type==='decline')rec.declineSent=true;
    // The sender's own record ends here; an own-entity twin ends when this message reaches it (its devices are told).
    if(p.type==='cancel')await this.end(tx,fx,owner,rec,'cancel',{now,silent:true,twin:false});
    if(p.type==='end')await this.end(tx,fx,owner,rec,'end',{now,silent:true,reason:'hangup',twin:false});
   }
   if(out.length){
    const peer=rec.role==='caller'?rec.callee:rec.caller,first=out.some(c=>parseMessage(c,{allowLoopback:this.allowLoopback}).payload.type==='invite');
    const certs=rec.mine.certSent!==rec.mine.certificate?[rec.mine.certificate]:[];rec.mine.certSent=rec.mine.certificate;
    const links=first?[rec.basisLink,rec.callbackLink].filter(Boolean):[];
    // A full outbox refuses the whole send (rolled back, nothing accepted) so the endpoint learns it and may retry,
    // instead of `{accepted:N}` for messages that would never leave (review M3).
    if(!await this.enqueue(tx,fx,{to:peer,certificates:certs,messages:out,links,until:first?rec.ringUntil:now+FORWARD_MS,...first&&rec.inviteRetry?{invite:rec.sid}:{}}))limited();
   }
   await tx.put(found.key,rec);return {accepted};
  });
 }
 /** Messages per leg: 256 per minute (RTC-11), kept on the leg itself. */
 async legRate(tx,leg,now){if(!leg.rate||leg.rate.resetAt<=now)leg.rate={count:0,resetAt:now+60000};if(leg.rate.count>=256)return false;leg.rate.count++;return true;}

 // ---- tickets (§4.3, §9.1 mint_ticket) --------------------------------------------------------------------------------
 async mintTicket(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId,RTC_TICKETS_FLAG);
  exact(input,['purposes','uses','expires_in'],['principal']);
  if(!purposeLinesValid(input.purposes)||!Number.isSafeInteger(input.uses)||input.uses<1||input.uses>TICKET_MAX_USES||!(input.principal===undefined||input.principal===null||principalValid(input.principal,this.allowLoopback)))invalid();
  for(const line of input.purposes){if(!heldPurpose(line))invalid('Unknown purpose.');await this.requireApproved(app,line);}
  const signer=await this.linkSigner?.(owner);if(!signer)fail('temporarily_unavailable','Real-time connections are temporarily unavailable.',503);
  const now=this.now();let minted;try{minted=await mintTicketRecord({issuer:this.issuer,sub:owner,purposes:input.purposes,uses:input.uses,expiresIn:input.expires_in,principal:input.principal??null,signer,now,allowLoopback:this.allowLoopback,crypto:this.crypto});}catch{invalid();}
  await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);if(await tx.get(CLOSED_KEY))notFound();if(await this.liveTickets(tx,now)>=RTC_BOUNDS.tickets)limited();await tx.put(TICKET_KEY(minted.record.jti),minted.record);});
  return {link:minted.link};
 }

 // ---- ingest (§8.2, both for the same-host transport and, in RTC-e, the federation endpoint) ---------------------------
 /**
  * rtc.ingest (system): §8.2 step 1 (shape, syntax, `aud` origin, `iat`) refuses the whole batch with
  * `rtc_batch_invalid`. A batch that passes is stored in the bounded inbound queue and answered `{accepted:true}` at
  * once; steps 2–8 run later (`processInbox`, on this writer's detached task or alarm), so neither the answer nor its
  * timing depends on them (§8.2, §12 no presence oracle; review M2). A full queue answers `temporarily_unavailable`
  * (503, which the sender retries); its fill does not depend on steps 2–8 either. Processing never fetches: keys are
  * read as held (`keys.certification`).
  */
 async ingest(actor,input){
  const owner=this.system(actor);exact(input,['batch'],['source']);const now=this.now();
  // RTC-e review F1: the route's pseudonymous source network (never an address), kept with the queued batch so plain
  // claims can be capped per source network at the roster. Anything else is dropped.
  const source=typeof input.source==='string'&&/^[A-Za-z0-9_:.-]{1,128}$/.test(input.source)?input.source:null;
  try{await batchStep1(parseBatch(input.batch),{issuer:this.issuer,now:seconds(now),parseCertificate:parseLegCertificate,parseControl,allowLoopback:this.allowLoopback,crypto:this.crypto});}
  catch(error){if(error instanceof RtcWireFault)fail('rtc_batch_invalid','The batch is invalid.',400);throw error;}
  const text=typeof input.batch==='string'?input.batch:new TextDecoder().decode(input.batch),bytes=text.length+64;
  await this.store.transaction(async tx=>{
   const m=await tx.get(K.inboxMeta)??{seq:0,count:0,bytes:0};
   if(m.count+1>RTC_BOUNDS.inbox||m.bytes+bytes>RTC_BOUNDS.inboxBytes)fail('temporarily_unavailable','Real-time connections are temporarily unavailable.',503);
   const seq=m.seq+1;await tx.put(K.inboxMeta,{seq,count:m.count+1,bytes:m.bytes+bytes});await tx.put(K.inbox(seq),{batch:text,at:now,bytes,...source?{source}:{}});
  });
  this.kick(owner,'inbox');
  return {accepted:true};
 }
 async process(owner,elements,now,{source=null}={}){
  const self=this.self(owner),selfIdentity=await this.identity(self);if(!selfIdentity)return;
  const certs=new Map(elements.certificates.map(c=>[c.payload.cnf.jkt,c]));
  // §8.2 step 3 (RTC-e): a sender whose keys are not held gets a background refresh scheduled, for every claimed
  // sender of the batch, before and whatever steps 2–8 decide. The roster bounds the queue, applies the directory
  // budgets and never dials a non-allowlisted issuer. A key is "not held" when no certification key is held for the
  // sender or a certificate or control of the batch names a kid that is not among them (a rotation).
  // Review F1: whether a claim is queued, and in which lane, also depends on the source network (plain claims are
  // capped per network), on a live session with the sender (served first) and on a link basis of an invite in the
  // batch that verified here without spending anything (spec §8.2 step 3 exception). The caller's provider can
  // observe at most the order of this host's fetches to it, never an answer or its timing.
  const senders=new Map(),note=(x,kid)=>{const id=JSON.stringify([x.payload.iss,x.payload.sub]),e=senders.get(id)??{p:{iss:x.payload.iss,sub:x.payload.sub},kids:new Set()};if(kid)e.kids.add(kid);senders.set(id,e);};
  for(const m of elements.messages)note(m);for(const c of elements.certificates)note(c,c.header.kid);for(const c of elements.controls)note(c,c.header.kid);
  for(const [id,{p,kids}] of senders){const held=await this.peerKeys(p),missing=[...kids].find(kid=>!held.some(k=>k.kid===kid));if(held.length&&missing===undefined)continue;
   let lane=null;if(p.iss!==this.issuer)try{lane=await this.basisLane(owner,p,elements);}catch{lane=null;}
   try{await this.keys.refresh?.(p,missing,{...source?{source}:{},...lane?{lane}:{}});}catch{/* best effort */}}
  for(const m of elements.messages){try{await this.processMessage(owner,self,selfIdentity,m,certs,elements.links,now);}catch{/* silent */}}
  for(const c of elements.controls){try{await this.processControl(owner,selfIdentity,c,now);}catch{/* silent */}}
 }
 /**
  * Review F1: the refresh lane of a claimed foreign sender whose keys are not held: `link:<digest>` when an invite of
  * the batch from that sender presents a link basis that verifies here at step 2 without spending anything (a live
  * ticket of this owner admitting the sender and purpose, or one of this owner's contact links), else null. Local
  * reads only; never a fetch.
  */
 async basisLane(owner,sender,elements){
  for(const m of elements.messages){
   const p=m.payload;if(p.type!=='invite'||p.iss!==sender.iss||p.sub!==sender.sub||typeof p.body?.basis?.link_digest!=='string')continue;
   let presented=null;for(const l of elements.links)if(await linkDigest(l,this.crypto)===p.body.basis.link_digest){presented=l;break;}
   if(!presented||canonicalBasisLink(presented,{origin:this.issuer})===null)continue;
   const now=this.now(),ticket=await this.store.transaction(tx=>ticketFromLink(tx,presented,{issuer:this.issuer,owner,now,crypto:this.crypto}));
   let ok=Boolean(ticket)&&ticketAdmits(ticket.claims,{purpose:p.body.purpose?.purpose,principal:sender});
   if(!ok&&!ticket){let contact=null;try{contact=await this.contacts?.inspect(presented);}catch{contact=null;}ok=typeof contact?.parent==='string';}
   if(ok)return 'link:'+p.body.basis.link_digest.slice(0,96);
  }
  return null;
 }
 async processMessage(owner,self,selfIdentity,m,certs,links,now){
  const p=m.payload,sender={iss:p.iss,sub:p.sub},nowS=seconds(now);if(p.aud!==selfIdentity)return;
  const inKey=K.in(sender,p.sid),outKey=K.out(p.sid);
  const [inRec,outRec]=await this.store.transaction(async tx=>[await tx.get(inKey),await tx.get(outKey)]);
  const batchCert=certs.get(p.leg);let side=batchCert?(batchCert.payload.role==='caller'?'callee':'caller'):null;
  if(!side){if(inRec?.theirs?.jkt===p.leg)side='callee';else if(outRec&&samePrincipal(outRec.callee,sender)&&outRec.theirs?.jkt===p.leg)side='caller';else return;}
  // Step 2 without spending anything: find the session by (caller origin principal, sid).
  const rec=side==='callee'?inRec:outRec;
  // An invite for an existing session is a retried copy (or a sid another caller chose): ignored before any limit.
  if(side==='callee'){if(p.type!=='invite'&&(!rec||rec.theirs?.jkt!==p.leg))return;if(p.type==='invite'&&rec)return;}
  else {if(!rec||!samePrincipal(rec.callee,sender))return;const answer=p.seq===0&&['accept','decline'].includes(p.type);if(answer?p.to!==rec.mine.jkt:rec.theirs?.jkt!==p.leg)return;}
  // Step 3: the leg certificate against the sender's active certification keys AS ALREADY HELD.
  const certCompact=batchCert?.compact??rec?.theirs?.certificate;if(!certCompact)return;
  const parsedCert=batchCert??parseLegCertificate(certCompact,{allowLoopback:this.allowLoopback});
  const keys=await this.peerKeys(sender),identity=await this.identity(sender);if(!keys.length||!identity)return;// refresh scheduled in process()
  const verified=await verifyLegCertificate(parsedCert,{keys,expected:{aud:selfIdentity,sid:p.sid,role:side==='callee'?'caller':'callee',...p.type==='invite'?{purpose:p.body.purpose}:{}},identity,now:nowS,maxSeconds:this.peerMax(sender),...rec?{sessionEndsAt:seconds(rec.endsAt)}:{},crypto:this.crypto});
  if(verified.payload.iss!==sender.iss||verified.payload.sub!==sender.sub||rec&&!sameRef(verified.payload.purpose,rec.purpose))return;
  // Step 4: the message signature under the certified delegate.
  await verifyMessage(m,verified,{now:nowS,crypto:this.crypto});
  const d=await payloadDigest(m.compact,this.crypto);
  // RTC-e: a verified peer stays in the key roster for 24 h (§8.2 step 3). Verification follow-ups: only a peer with a
  // session record here (an existing one, or an invite once admitted), never a principal that merely verifies.
  if(side==='callee'&&p.type==='invite'){if(await this.admitInvite(owner,self,{m,p,sender,verified,certCompact,digest:d,links,keys,now})===true)this.track(sender);return;}
  this.track(sender);
  return this.commit(owner,async(tx,fx)=>{
   const key=side==='callee'?inKey:outKey,rec=await tx.get(key);if(!rec)return;
   if(!await this.epochOk(tx,sender,verified.payload.aep,now))return;
   // At most one `failed` reply per (sid, leg) and RTC_BOUNDS.controlReplies per session (review M3): a peer provider
   // certifying extra callee legs cannot fill this outbox.
   const replyFailed=async leg=>{const sent=rec.failReplies??[];if(sent.includes(leg)||sent.length>=RTC_BOUNDS.controlReplies)return;rec.failReplies=[...sent,leg];await this.enqueueControl(tx,fx,owner,rec,{leg,reason:'failed',now});await tx.put(key,rec);};
   if(side==='caller'&&p.seq===0&&['accept','decline'].includes(p.type)&&!rec.theirs){
    // §7.2: the first verified seq 0 answer becomes the callee leg; an answer after the caller's cancel, or a later
    // callee leg, is answered with a control statement `end` (`failed`) for that leg (§7.4).
    if(rec.state!=='ringing')return replyFailed(p.leg);
    rec.theirs={jkt:p.leg,certificate:certCompact,order:newLeg(),rate:null,delivered:false};delete rec.inviteCompact;delete rec.inviteRetry;
   } else if(side==='caller'&&rec.theirs&&rec.theirs.jkt!==p.leg)return replyFailed(p.leg);
   if(rec.state==='ended')return;
   // Review M1: the peer's certification keys that verified this leg are pinned on the record, so the peer's control
   // statements still verify after its keys stop being served (deletion, suspension, move) or rotate.
   rec.peerKeys=pinKeys(keys,rec.peerKeys);
   if(batchCert&&rec.theirs)rec.theirs.certificate=certCompact;// a renewal replaces the held certificate
   if(!await this.legRate(tx,rec.theirs,now))return;
   const r=offerSeq(rec.theirs.order,{seq:p.seq,digest:d,compact:m.compact,now});
   if(r.action==='fail')await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:rec.theirs.jkt,reason:'failed'}});
   for(const item of r.ready){if(rec.state==='ended')break;await this.applyPeerMessage(tx,fx,owner,rec,parseMessage(item.compact,{allowLoopback:this.allowLoopback}).payload,item.compact,now);}
   await tx.put(key,rec);
  });
 }
 async epochOk(tx,sender,aep,now,{record=true}={}){
  // Step 6: refuse an `aep` lower than the highest recorded for that sender; a higher one is recorded. Rows are kept
  // only while there is admission state with the sender (24 h after the last session activity), so a dropped invite
  // records nothing (`record: false` checks only).
  const row=await tx.get(K.aep(sender));if(row&&row.until>now&&aep<row.aep)return false;
  if(record)await tx.put(K.aep(sender),{aep:Math.max(aep,row&&row.until>now?row.aep:0),until:now+DAY});return true;
 }
 /** A verified message from the peer leg, in order (step 8 delivery). */
 async applyPeerMessage(tx,fx,owner,rec,p,compact,now){
  // RTC-i (AMD-RI3, proposed): `to` must name this side's leg (§6.1), or be null for invite and cancel. A message naming
  // no leg of the session is dropped here, at step 7, after step 5 consumed its seq, as every other step-7 drop is.
  if(p.to===null?!['invite','cancel'].includes(p.type):p.to!==rec.mine?.jkt)return;
  const certificate=!rec.theirs.delivered?rec.theirs.certificate:undefined;
  const deliver=async(sensitive=false)=>{const target=rec.role==='caller'?rec.mine.endpoint:rec.claim?.endpoint;if(!target)return;
   if(!await this.push(tx,fx,target,{type:'message',sid:rec.sid,message:compact,...certificate?{certificate}:{}},now,{sensitive})){await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:null,reason:'failed'}});return;}
   rec.theirs.delivered=true;};
  const content=()=>{try{validateMessageContent(p,{media:rec.media,crossEntity:!rec.own});return true;}catch{return false;}};
  switch(p.type){
   case 'accept':if(rec.role==='caller'&&rec.state==='ringing'&&content()){transition(rec,'answer-accept',{now});await deliver(p.body.answer!==null);}return;
   case 'decline':if(rec.role==='caller'&&rec.state==='ringing'){await deliver();await this.end(tx,fx,owner,rec,'answer-decline',{now,silent:true});}return;
   case 'cancel':
    if(rec.role!=='callee')return;
    if(rec.state==='connected'&&rec.claim?.outcome==='accept'){await deliver();await this.end(tx,fx,owner,rec,'cancel',{now});}// processed as end (hangup), §7.4
    else await this.end(tx,fx,owner,rec,'cancel',{now});
    return;
   case 'end':if(rec.state==='connected'){await deliver();await this.end(tx,fx,owner,rec,'end',{now,reason:'hangup'});}return;
   case 'sdp':case 'candidates':case 'sas':
    // §6.3: no SDP and no candidate travels before the claim; only to the two session legs.
    if(rec.state==='connected'&&(rec.role==='caller'||rec.claim?.outcome==='accept')&&content())await deliver(p.type!=='sas');return;
   default:return;
  }
 }
 /** Steps 2 and 5–8 for an invite: basis, block, policy, limits, purpose, then atomically spend, create, fan out. */
 async admitInvite(owner,self,{m,p,sender,verified,certCompact,digest:d,links,keys,now}){
  if(!this.flag(owner))return;// no new session while RTC_SIGNALING_ENABLED is off
  const body=p.body,line=body.purpose.purpose,held=heldPurpose(line),own=samePrincipal(sender,self);
  // Step 7 checks that need no storage: the pinned purpose version, media, parties, context and the §6.3 rules.
  if(!held||!sameRef(held.ref,body.purpose))return;
  try{validateInviteForPurpose(body,held.body,{ownEntity:own});validateMessageContent(p,{media:body.media,crossEntity:!own});}catch{return;}
  const basis=basisKind(body,{ownEntity:own});if(basis==='self'&&!own||basis!=='self'&&own)return;
  const linkFor=async digest=>{for(const l of links)if(await linkDigest(l,this.crypto)===digest)return l;return null;};
  let presented=null,linkType=null,contact=null;
  if(basis==='link'){
   presented=await linkFor(body.basis.link_digest);if(!presented||canonicalBasisLink(presented,{origin:this.issuer})===null)return;
   try{const q=parseLinkQuery(presented);linkType=q.form==='link'&&parseLinkMeta(q.meta).claims.type===RTC_TICKET_TYPE?'ticket':'contact';}catch{linkType='contact';}
   if(linkType==='contact'){try{contact=await this.contacts?.inspect(presented);}catch{contact=null;}if(!contact||typeof contact.parent!=='string')return;}
  }
  const callbackLink=body.callback_digest?await linkFor(body.callback_digest):null;if(body.callback_digest&&(!callbackLink||canonicalBasisLink(callbackLink,{origin:sender.iss})===null))return;
  // Eligibility needs the federation grant check, which is outside this writer: done before the transaction, re-read
  // inside it (an endpoint removed meanwhile drops out).
  const candidates=await this.store.transaction(tx=>candidateEndpoints(tx,{line,now}));
  const eligible=new Set();for(const ep of candidates)if(await this.approved({owner,clientId:ep.clientId,grants:ep.grants,epoch:ep.epoch},line))eligible.add(ep.id);
  let handle=null;try{handle=await this.keys.handle?.(sender)??null;}catch{handle=null;}
  const callerClient=verified.payload.client;
  // §13 invites per caller origin principal ACROSS callee entities (review L1): one host-wide window shared by every
  // writer on this host, counted after verification like the others; a limiter that fails drops the invite (closed).
  if(this.hostLimits){let ok=false;try{ok=await this.hostLimits.take('caller',[sender.iss,sender.sub])===true;}catch{ok=false;}if(!ok)return;}
  return this.commit(owner,async(tx,fx)=>{
   if(await tx.get(CLOSED_KEY))return;
   const key=K.in(sender,p.sid);if(await tx.get(key))return;// a retried copy (or a sid another caller chose) is ignored
   if(await isBlocked(tx,sender))return;// dropped silently, never recorded as missed
   if(!await this.epochOk(tx,sender,verified.payload.aep,now,{record:false}))return;
   const policy=await readPolicy(tx);let ticket=null,quarantined=false,parent=null;
   if(basis==='request'&&!policy.requests.includes(line))return;// `none` is off by default
   if(linkType==='ticket'){ticket=await ticketFromLink(tx,presented,{issuer:this.issuer,owner,now,crypto:this.crypto});if(!ticket)return;parent='ticket:'+ticket.jti;}
   if(linkType==='contact'){const config=await tx.get(K.contact(contact.parent));if(!config?.purposes?.includes(line))return;quarantined=contact.quarantined===true;parent='contact:'+contact.parent;}
   // Limits (§13, RTC-11): every kind counts after verification; excess is dropped silently.
   const items=[{name:'pair',parts:[sender.iss,sender.sub]},{name:'caller',parts:[sender.iss,sender.sub]},{name:'issuerCallee',parts:[sender.iss]},{name:'callee',parts:[]}];
   if(parent)items.push({name:'issuerParent',parts:[sender.iss,parent]});
   let ringing=0,connected=0,heldCount=0;for(const r of (await tx.list({prefix:K.inPrefix,limit:4096})).values()){if(r.state==='ringing'&&!r.held)ringing++;if(r.state==='connected')connected++;if(r.held&&r.state==='ringing')heldCount++;}
   const holdIt=quarantined||basis==='request';
   if(holdIt?heldCount>=RTC_BOUNDS.heldRequests:ringing>=RTC_BOUNDS.calleeRinging||connected>=RTC_BOUNDS.calleeConnected)return;
   if(!await takeLimits(tx,items,now,this.crypto))return;
   // Step 8, atomically: spend a ticket use against the VERIFIED principal (§4.3), create the session, fan out.
   if(ticket&&!await spendTicket(tx,ticket.jti,{purpose:line,principal:sender,now}))return;
   await this.epochOk(tx,sender,verified.payload.aep,now);
   const muted=await isMuted(tx,{principal:sender,purpose:line,clientId:callerClient.client_id}),alert=alertAllowed({purposeBody:held.body,basis,muted,quarantined});
   const rec={v:1,sid:p.sid,role:'callee',state:'ringing',own,caller:sender,callee:self,peerIdentity:verified.payload.identity,purpose:held.ref,media:[...body.media],createdAt:now,ringUntil:Math.min(body.ring_until*1000,now+RING_MAX_MS),endsAt:p.iat*1000+SESSION_MAX_MS,
    theirs:{jkt:p.leg,certificate:certCompact,order:newLeg(),rate:null,delivered:true},mine:null,delivered:[],claim:null,basis,alert,held:holdIt,callerClient:{client_id:callerClient.client_id,origin:callerClient.origin},controls:[],peerKeys:pinKeys(keys),...callbackLink?{callbackLink}:{}};
   offerSeq(rec.theirs.order,{seq:0,digest:d,compact:m.compact,now});
   if(holdIt){await tx.put(key,rec);await this.addMissed(tx,{caller:sender,line,kind:'held',at:now});return true;}
   let targets=(await candidateEndpoints(tx,{line,now})).filter(ep=>eligible.has(ep.id));
   if(own){const out=await tx.get(K.out(p.sid));const mineEp=out?.mine?.endpoint;targets=targets.filter(ep=>ep.id!==mineEp);if(out?.target)targets=targets.filter(ep=>ep.id===out.target);}
   targets=targets.slice(0,RTC_BOUNDS.fanout);
   const projection={caller:party(sender),handle,origin:callerClient.origin,client_id:callerClient.client_id,purpose:structuredClone(held.ref),media:[...body.media],context:projectContext(body.context,held.body,held.body),basis,alert};
   for(const ep of targets){
    const auto=own&&held.body.auto_accept==='self'&&(policy.autoAccept[ep.clientId]??[]).includes(line)&&callerClient.client_id===ep.clientId;
    if(await this.push(tx,fx,ep.id,{type:'invite',sid:p.sid,invite:m.compact,certificate:certCompact,projection:{...projection,auto_accept:auto}},now,{sensitive:body.offer!==null})){rec.delivered.push(ep.id);await tx.put(K.delivered(ep.id,p.sid),{key});
     // RTC-e doorbell: only for an alerting invite (counted by the invite limits above), once per endpoint.
     if(alert&&ep.push)fx.doorbells.push({endpoint:ep.id,subscription:ep.push,ringUntil:rec.ringUntil});}
   }
   await tx.put(key,rec);return true;
  });
 }
 async processControl(owner,selfIdentity,parsed,now){
  const c=parsed.payload,sender={iss:c.iss,sub:c.sub};if(c.aud!==selfIdentity)return;
  const found=await this.store.transaction(async tx=>{const inRec=await tx.get(K.in(sender,c.sid));if(inRec)return {key:K.in(sender,c.sid),rec:inRec};const out=await tx.get(K.out(c.sid));return out&&samePrincipal(out.callee,sender)?{key:K.out(c.sid),rec:out}:null;});
  if(!found)return;
  // Step 3 for controls: an active certification key of the session party that sent it, never whoever signed. The
  // keys as held now, else the keys pinned on this session when its leg verified (review M1): a deleting, suspended or
  // moved entity stops serving keys (rtcPublicKeys) before or while its controls travel, and a key may rotate. A
  // control only ends a session (narrowing), and only this session with that party.
  const expected={aud:selfIdentity,sid:c.sid,iss:sender.iss,sub:sender.sub},verifyWith=async keys=>{if(!keys.length)return false;try{await verifyControl(parsed,{keys,expected,now:seconds(now),crypto:this.crypto});return true;}catch{return false;}};
  if(!await verifyWith(await this.peerKeys(sender))&&!await verifyWith(keysView(found.rec.peerKeys)))return;
  await this.commit(owner,async(tx,fx)=>{
   const rec=await tx.get(found.key);if(!rec||rec.controls.includes(c.jti))return;
   if(c.leg!==null&&c.leg!==rec.mine?.jkt&&c.leg!==rec.theirs?.jkt)return;
   rec.controls=[...rec.controls,c.jti].slice(-16);
   await this.end(tx,fx,owner,rec,'control',{now,reason:c.reason==='moved'?'moved':c.reason==='expired'?'expired':c.reason==='revoked'?'revoked':'failed',controlStatement:parsed.compact});
   await tx.put(found.key,rec);
  });
 }

 // ---- owner settings and reads (design §3.2) ---------------------------------------------------------------------------
 owner(actor){return ownerOf(actor);}
 async ownerTx(actor,fn){const owner=this.owner(actor);return this.commit(owner,async(tx,fx)=>{await this.bindOwner(tx,owner);return fn(tx,fx,owner,this.now());});}
 async policy(actor){const owner=this.owner(actor);return this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const p=await readPolicy(tx);return {other:p.other,self:p.self,requests:[...p.requests],autoAccept:structuredClone(p.autoAccept),enabled:this.flag(owner)};});}
 async setPolicy(actor,input){
  exact(input,[],['other','self','requests','autoAccept']);
  if(input.other!==undefined&&!['relay','public'].includes(input.other)||input.self!==undefined&&!['relay','public','all'].includes(input.self))invalid();
  if(input.requests!==undefined&&(!Array.isArray(input.requests)||input.requests.length>16||input.requests.some(l=>!heldPurpose(l))||new Set(input.requests).size!==input.requests.length))invalid();
  if(input.autoAccept!==undefined&&(!plain(input.autoAccept)||Object.keys(input.autoAccept).length>32||Object.entries(input.autoAccept).some(([c,lines])=>!c||c.length>2048||!Array.isArray(lines)||lines.length>16||lines.some(l=>heldPurpose(l)?.body.auto_accept!=='self'))))invalid('Only purposes that allow it can be answered automatically.');
  return this.ownerTx(actor,async(tx,fx,owner)=>{
   const prior=await readPolicy(tx),next={v:1,other:input.other??prior.other,self:input.self??prior.self,requests:[...input.requests??prior.requests].sort(),autoAccept:structuredClone(input.autoAccept??prior.autoAccept)};
   if(policyWidens(prior,next)&&!this.flag(owner))notFound();// narrowing is never gated
   await tx.put(K.policy,next);return {other:next.other,self:next.self,requests:next.requests,autoAccept:next.autoAccept};
  });
 }
 async setContactRtc(actor,input){
  exact(input,['parent','purposes']);if(typeof input.parent!=='string'||!input.parent||input.parent.length>128||!Array.isArray(input.purposes)||input.purposes.length>RTC_BOUNDS.contactPurposes||input.purposes.some(l=>!heldPurpose(l))||new Set(input.purposes).size!==input.purposes.length)invalid();
  return this.ownerTx(actor,async(tx,fx,owner)=>{
   const prior=(await tx.get(K.contact(input.parent)))?.purposes??[];if(input.purposes.some(l=>!prior.includes(l))&&!this.flag(owner))notFound();
   if(input.purposes.length)await tx.put(K.contact(input.parent),{parent:input.parent,purposes:[...input.purposes].sort()});else await tx.delete(K.contact(input.parent));
   return {parent:input.parent,purposes:[...input.purposes].sort()};
  });
 }
 async block(actor,input){
  exact(input,['principal']);if(!principalValid(input.principal,this.allowLoopback))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   if(!await tx.get(K.block(input.principal))){if((await tx.list({prefix:K.blockPrefix,limit:RTC_BOUNDS.blocks})).size>=RTC_BOUNDS.blocks)limited();await tx.put(K.block(input.principal),{principal:party(input.principal),at:now});}
   // Ringing invites from a blocked principal end silently, never recorded as missed.
   for(const [key,rec] of await tx.list({prefix:K.inPrefix,limit:4096}))if(rec.state==='ringing'&&samePrincipal(rec.caller,input.principal)){await this.end(tx,fx,owner,rec,'block',{now});await tx.put(key,rec);}
   return {blocked:true};
  });
 }
 async unblock(actor,input){exact(input,['principal']);if(!principalValid(input.principal,this.allowLoopback))invalid();return this.ownerTx(actor,async(tx,fx,owner)=>{if(!this.flag(owner))notFound();await tx.delete(K.block(input.principal));return {blocked:false};});}
 async mute(actor,input,on=true){
  exact(input,['kind','value']);if(!MUTE_KINDS.includes(input.kind)||input.kind==='principal'&&!principalValid(input.value,this.allowLoopback)||input.kind==='purpose'&&!heldPurpose(input.value)||input.kind==='app'&&(typeof input.value!=='string'||!input.value||input.value.length>2048))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{const key=K.mute(input.kind,muteValue(input.kind,input.value));
   if(on){if(!await tx.get(key)){if((await tx.list({prefix:K.mutePrefix,limit:RTC_BOUNDS.mutes})).size>=RTC_BOUNDS.mutes)limited();await tx.put(key,{kind:input.kind,value:structuredClone(input.value),at:now});}}
   else {if(!this.flag(owner))notFound();await tx.delete(key);}
   return {muted:on};});
 }
 async revokeTicket(actor,input){exact(input,['jti']);if(typeof input.jti!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.jti))invalid();return this.ownerTx(actor,async tx=>{const row=await tx.get(TICKET_KEY(input.jti));if(!row)notFound();await tx.put(TICKET_KEY(input.jti),{...row,revoked:true});return {revoked:true};});}
 async endSession(actor,input){
  exact(input,['sid'],['caller','silent']);if(typeof input.sid!=='string'||!SID.test(input.sid)||input.caller!==undefined&&!principalValid(input.caller,this.allowLoopback))invalid();
  if(input.silent!==undefined&&(input.silent!==true||input.caller===undefined))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const key=input.caller?K.in(input.caller,input.sid):K.out(input.sid),rec=await tx.get(key);if(!rec)notFound();
   // Review F1 (RTC-g; spec §12 "No presence oracle", §4.4): an incoming record no device answered (ringing, no
   // claim, held or not) ends SILENTLY, whether or not `silent` was asked: reason `declined`, `state: ended` only to
   // this owner's own endpoints (its apps stop ringing), no control statement and nothing else to the caller's
   // provider, not recorded as missed; an own-entity twin ends the same way (end() carries no control to it). The
   // caller's session simply rings out at ring_until, exactly as if nobody had seen the invite.
   if(silentEndable(rec)){await this.end(tx,fx,owner,rec,'revoke',{now,reason:'declined'});await tx.put(key,rec);return {sid:rec.sid,state:rec.state,silent:true};}
   // `silent` names only such a record: a claimed (answered) session, an outgoing one or one already ended never ends
   // through it.
   if(input.silent===true)invalid('Only an unanswered incoming call can be declined silently.');
   if(isLive(rec)){await this.end(tx,fx,owner,rec,'revoke',{now,control:{leg:null,reason:'revoked'}});await tx.put(key,rec);}
   return {sid:rec.sid,state:rec.state};
  });
 }
 async revokeEndpoint(actor,input){exact(input,['endpoint']);if(typeof input.endpoint!=='string'||!ENDPOINT_ID.test(input.endpoint))invalid();return this.ownerTx(actor,async(tx,fx,owner,now)=>{const ep=await tx.get(K.endpoint(input.endpoint));if(!ep)notFound();await this.removeEndpoint(tx,fx,ep,now,'revoked');return {revoked:true};});}
 async clearMissed(actor,input={}){exact(input,[],['id']);return this.ownerTx(actor,async tx=>{let n=0;for(const [key,row] of await tx.list({prefix:K.missedPrefix,limit:RTC_BOUNDS.missed*2}))if(input.id===undefined||row.id===input.id){await tx.delete(key);n++;}return {cleared:n};});}
 async ownerRead(actor,fn){const owner=this.owner(actor);return this.store.transaction(async tx=>{await this.bindOwner(tx,owner);return fn(tx,this.now(),owner);});}
 /** The owner's live sessions. Review F2: an incoming record's `alert` is re-evaluated on every read against the
  * current mutes (principal, purpose and the caller's application), so a mute set while an invite rings silences the
  * portal ring at once; it never turns on an invite that did not alert at admission. */
 sessions(actor){return this.ownerRead(actor,async tx=>{const out=[];for(const prefix of [K.outPrefix,K.inPrefix])for(const rec of (await tx.list({prefix,limit:4096})).values())if(isLive(rec)){
  if(rec.role!=='callee'){out.push(sessionView(rec));continue;}
  const client=callerClientOf(rec,this.allowLoopback);
  out.push(sessionView(rec,{alert:rec.alert===true&&client!==null&&!await isMuted(tx,{principal:rec.caller,purpose:rec.purpose.purpose,clientId:client.client_id}),callerOrigin:client?.origin??null}));
 }return {sessions:out};});}
 missed(actor){return this.ownerRead(actor,async tx=>({missed:[...(await tx.list({prefix:K.missedPrefix,limit:RTC_BOUNDS.missed*2})).values()].reverse().map(r=>({id:r.id,caller:r.caller,purpose:r.purpose,kind:r.kind,at:r.at}))}));}
 blocked(actor){return this.ownerRead(actor,async tx=>({blocked:[...(await tx.list({prefix:K.blockPrefix,limit:RTC_BOUNDS.blocks})).values()].map(r=>({principal:r.principal,at:r.at})),muted:[...(await tx.list({prefix:K.mutePrefix,limit:RTC_BOUNDS.mutes})).values()].map(r=>({kind:r.kind,value:r.value,at:r.at}))}));}
 tickets(actor){return this.ownerRead(actor,async(tx,now)=>({tickets:[...(await tx.list({prefix:TICKET_PREFIX,limit:RTC_BOUNDS.tickets*4})).values()].map(r=>ticketView(r,now))}));}
 endpointList(actor){return this.ownerRead(actor,async(tx,now)=>({endpoints:[...(await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints*2})).values()].filter(ep=>ep.expiresAt>now).map(ep=>({endpoint:ep.id,clientId:ep.clientId,origin:ep.origin,label:ep.label,purposes:[...ep.purposes],lastSeen:ep.lastSeen}))}));}
 /** rtc.export: the owner's portable RTC settings and history (policy, blocks, mutes, contact configuration, ticket
  * views and missed invites). Never endpoint secrets, push keys, queues, sessions, SDP, candidates or ticket links. */
 exportRecords(actor){return this.ownerRead(actor,async(tx,now)=>({version:1,policy:await readPolicy(tx),blocked:[...(await tx.list({prefix:K.blockPrefix,limit:RTC_BOUNDS.blocks})).values()],muted:[...(await tx.list({prefix:K.mutePrefix,limit:RTC_BOUNDS.mutes})).values()],
  contacts:[...(await tx.list({prefix:K.contactPrefix,limit:4096}))].map(([key,v])=>({parent:v.parent??decodeURIComponent(key.slice(K.contactPrefix.length)),purposes:v.purposes})),tickets:[...(await tx.list({prefix:TICKET_PREFIX,limit:RTC_BOUNDS.tickets*4})).values()].map(r=>ticketView(r,now)),missed:[...(await tx.list({prefix:K.missedPrefix,limit:RTC_BOUNDS.missed*2})).values()]}));}

 // ---- lifecycle and expiry (§14, §7.1, §12) -------------------------------------------------------------------------
 /** Ends every session the endpoint holds a leg in (control `revoked` to the peer, §14) and deletes it, its queue and
  * its fan-out index. Unclaimed invites delivered to it simply lose that endpoint. */
 async removeEndpoint(tx,fx,ep,now,reason){
  const owner=await tx.get('owner');
  for(const [key,rec] of await tx.list({prefix:K.outPrefix,limit:4096}))if(isLive(rec)&&rec.mine?.endpoint===ep.id){await this.end(tx,fx,owner,rec,'revoke',{now,reason,control:{leg:rec.mine.jkt,reason:'revoked'}});await tx.put(key,rec);}
  for(const [dkey,dl] of await tx.list({prefix:K.deliveredPrefix(ep.id),limit:4096})){const rec=await tx.get(dl.key);
   if(rec&&isLive(rec)&&rec.claim?.endpoint===ep.id){await this.end(tx,fx,owner,rec,'revoke',{now,reason,control:{leg:rec.mine?.jkt??null,reason:'revoked'}});await tx.put(dl.key,rec);}
   else if(rec){rec.delivered=rec.delivered.filter(id=>id!==ep.id);await tx.put(dl.key,rec);}
   await tx.delete(dkey);}
  for(const key of (await tx.list({prefix:K.queuePrefix(ep.id),limit:RTC_BOUNDS.queueEvents*2})).keys())await tx.delete(key);
  await tx.delete(K.endpoint(ep.id));fx.woken.add(ep.id);
 }
 /**
  * rtc.lifecycle (system): `deletion` (the account is being deleted: every live session ends with control `revoked`,
  * every endpoint is removed, and nothing new is admitted; the E4 drain then delivers the controls), `app-revoked`
  * {clientId} (the application lost its slot grant), `app-narrowed` {clientId, purposes} (its bound purposes were
  * narrowed to `purposes`). Narrowing; never gated.
  */
 async lifecycle(actor,input){
  const owner=this.system(actor);exact(input,['event'],['clientId','purposes']);if(!['deletion','app-revoked','app-narrowed'].includes(input.event))invalid();
  if(input.event!=='deletion'&&(typeof input.clientId!=='string'||!input.clientId))invalid();if(input.event==='app-narrowed'&&!Array.isArray(input.purposes))invalid();
  return this.commit(owner,async(tx,fx)=>{
   await this.bindOwner(tx,owner);const now=this.now();let ended=0;
   if(input.event==='deletion')await tx.put(CLOSED_KEY,{at:now});
   const affected=rec=>input.event==='deletion'||rec.mine?.clientId===input.clientId&&(input.event==='app-revoked'||!input.purposes.includes(rec.purpose.purpose));
   const lost=input.event!=='deletion';
   for(const prefix of [K.outPrefix,K.inPrefix])for(const [key,rec] of await tx.list({prefix,limit:4096})){
    if(isLive(rec)&&affected(rec)){await this.end(tx,fx,owner,rec,'revoke',{now,control:{leg:null,reason:'revoked'}});await tx.put(key,rec);ended++;continue;}
    // RTCs follow-up (b): an unanswered invite that was ringing ONLY through this app's endpoints, for a purpose the app
    // no longer holds, ends here, silently towards the caller (no control statement, not missed; spec §12): the
    // owner's portal and devices stop ringing, and the caller's session rings out at ring_until as for any decline.
    if(lost&&silentEndable(rec)&&!rec.held&&Array.isArray(rec.delivered)&&rec.delivered.length&&(input.event==='app-revoked'||!input.purposes.includes(rec.purpose.purpose))){
     let only=true;for(const id of rec.delivered){const ep=await tx.get(K.endpoint(id));if(ep&&ep.clientId!==input.clientId){only=false;break;}}
     if(only){await this.end(tx,fx,owner,rec,'revoke',{now,reason:'revoked'});await tx.put(key,rec);ended++;}
    }
   }
   for(const ep of [...(await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints*2})).values()]){
    if(input.event==='deletion'||input.event==='app-revoked'&&ep.clientId===input.clientId){await this.removeEndpoint(tx,fx,ep,now,'revoked');continue;}
    if(input.event==='app-narrowed'&&ep.clientId===input.clientId){const kept=ep.purposes.filter(l=>input.purposes.includes(l));if(!kept.length)await this.removeEndpoint(tx,fx,ep,now,'revoked');else if(kept.length!==ep.purposes.length)await tx.put(K.endpoint(ep.id),{...ep,purposes:kept});}
   }
   return {ended};
  });
 }
 /**
  * rtc.tick (system): ring and session expiry, 10 s gap timeouts, the 60 s SDP/candidate bound, idle endpoints,
  * record retention (24 h after end; replay state with it), delegates, missed (30 days), limits, epochs and tickets;
  * the inbound queue before all of it and an outbox pass after. Bounded per call; returns {wakeAt}.
  */
 async tick(actor){
  const owner=this.system(actor);let wake=Infinity;
  // Queued batches first, as of their receipt, so their effects precede this pass's expiry.
  const inbox=await this.processInbox(owner,{limit:64});if(inbox.more)wake=Math.min(wake,this.now()+250);
  const live=[];
  await this.commit(owner,async(tx,fx)=>{
   live.length=0;await this.bindOwner(tx,owner);const now=this.now(),soon=t=>{if(t>now)wake=Math.min(wake,t);};
   for(const prefix of [K.outPrefix,K.inPrefix])for(const [key,rec] of await tx.list({prefix,limit:4096})){
    if(recordExpired(rec,now)){await tx.delete(key);continue;}
    if(rec.state==='ended'){soon(rec.endedAt+86400000);continue;}
    const due=dueEvent(rec,now);
    if(due){await this.end(tx,fx,owner,rec,due,{now});await tx.put(key,rec);soon(rec.endedAt+86400000);continue;}
    const legs=[rec.mine?.order,rec.theirs?.order].filter(Boolean);
    if(legs.some(l=>gapExpired(l,now))){await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:rec.theirs?.jkt??null,reason:'failed'}});await tx.put(key,rec);continue;}
    // Review F6: at most INVITE_RESEND_DELAYS.length re-sends, and only after the first 202 (inviteOutcome).
    if(rec.role==='caller'&&rec.state==='ringing'&&!rec.theirs&&rec.inviteCompact&&rec.inviteRetry?.acked===true){
     {
      if(rec.inviteRetry.at<=now&&now<rec.ringUntil){
       const links=[rec.basisLink,rec.callbackLink].filter(Boolean),n=rec.inviteRetry.n+1;
       if(await this.enqueue(tx,fx,{to:rec.callee,certificates:[rec.mine.certificate],messages:[rec.inviteCompact],links,until:rec.ringUntil,invite:rec.sid}))rec.inviteRetry={acked:true,n,at:n<INVITE_RESEND_DELAYS.length?now+INVITE_RESEND_DELAYS[n]:null};
       else rec.inviteRetry={...rec.inviteRetry,at:now+INVITE_RESEND_DELAYS[0]};
       if(rec.inviteRetry.n>=INVITE_RESEND_DELAYS.length){delete rec.inviteCompact;delete rec.inviteRetry;}
       await tx.put(key,rec);
      }
      if(rec.inviteRetry?.at&&rec.inviteRetry.at<rec.ringUntil)soon(rec.inviteRetry.at);
     }
    }
    if(!rec.own&&isLive(rec))live.push(party(rec.role==='caller'?rec.callee:rec.caller));
    soon(rec.state==='ringing'?rec.ringUntil:rec.endsAt);for(const l of legs)if(l.gapSince!==null)soon(l.gapSince+ORDER_LIMITS.gapMs+1);
   }
   for(const ep of [...(await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints*2})).values()]){
    if(!(ep.expiresAt>now)){await this.removeEndpoint(tx,fx,ep,now,'expired');continue;}
    if(await this.dropQueue(tx,ep,{now,sensitive:true}))await tx.put(K.endpoint(ep.id),ep);
    for(const row of (await tx.list({prefix:K.queuePrefix(ep.id),limit:RTC_BOUNDS.queueEvents})).values())if(row.expiresAt)soon(row.expiresAt);
   }
   for(const [key,row] of await tx.list({prefix:K.delegatePrefix,limit:4096}))if(row.until<=now)await tx.delete(key);
   for(const [key,row] of await tx.list({prefix:K.missedPrefix,limit:RTC_BOUNDS.missed*2}))if(row.at+RTC_BOUNDS.missedMs<=now)await tx.delete(key);
   for(const [key,row] of await tx.list({prefix:K.aepPrefix,limit:4096}))if(row.until<=now)await tx.delete(key);
   for(const [key,row] of await tx.list({prefix:TICKET_PREFIX,limit:RTC_BOUNDS.tickets*4}))if(row.expiresAt+DAY<=now||row.revoked&&row.createdAt+DAY<=now)await tx.delete(key);
   await pruneLimits(tx,now);
  });
  // RTC-f: the relay sweep on the alarm (revokes credentials of legs that are no longer live, drops expired leases).
  if(this.relay){const swept=await this.relay.sweep(owner).catch(()=>null);if(swept?.wakeAt)wake=Math.min(wake,Math.max(swept.wakeAt,this.now()+1000));}
  // Review F1: the peers of live or ringing sessions go first in the key roster's refresh order.
  try{this.keys.live?.(live.filter(p=>p.iss!==this.issuer));}catch{/* best effort */}
  const drained=await this.drain(owner).catch(()=>({pending:1}));if(drained.pending||drained.more)wake=Math.min(wake,this.now()+1000);
  return {wakeAt:Number.isFinite(wake)?wake:null,pending:drained.pending??0};
 }
}
/** Review F1: an incoming record that ends silently when its owner declines or removes it (ringing, unclaimed). */
export const silentEndable=rec=>rec?.role==='callee'&&rec.state==='ringing'&&!rec.claim;
/** The caller's application {client_id, origin} of an incoming record, as its verified leg certificate states it
 * (recorded at admission; older records: read from the held certificate), or null. */
function callerClientOf(rec,allowLoopback){
 const valid=c=>plain(c)&&typeof c.client_id==='string'&&typeof c.origin==='string'?{client_id:c.client_id,origin:c.origin}:null;
 if(rec.callerClient)return valid(rec.callerClient);
 try{return valid(parseLegCertificate(rec.theirs?.certificate,{allowLoopback}).payload.client);}catch{return null;}
}
/**
 * The owner's view of one live session (never SDP, candidates, links or keys). Incoming records also carry `alert`
 * (review F2; `live.alert` is the read-time value from sessions(), else the admission decision) and `callerOrigin`,
 * the calling application's verified origin from the caller's leg certificate (spec §9.1: the invite projection gives
 * a callee's endpoints the caller `client.origin` before any claim; RTC-17, provisional), or null.
 */
export function sessionView(rec,live={}){
 const view={sid:rec.sid,role:rec.role,state:rec.state,own:rec.own,peer:party(rec.role==='caller'?rec.callee:rec.caller),purpose:rec.purpose.purpose,media:[...rec.media],createdAt:rec.createdAt,ringUntil:rec.ringUntil,endsAt:rec.endsAt};
 if(rec.role!=='callee')return view;
 const origin=live.callerOrigin!==undefined?live.callerOrigin:rec.callerClient?.origin;
 return {...view,held:rec.held===true,claimed:Boolean(rec.claim),alert:(live.alert!==undefined?live.alert:rec.alert)===true,callerOrigin:typeof origin==='string'?origin:null};
}

// ---- engine operations ---------------------------------------------------------------------------------------------------
const CHANGED='rtc-changed';
/** The `rtc` provider class over one RtcService (one per entity account writer). */
export function rtcProvider(service){return class extends Provider{static deps=[];obtain(){return service;}release(){}};}
class RtcAction extends AppAction{static deps=['rtc'];static changes=CHANGED;}
class RtcQuery extends AppQuery{static deps=['rtc'];static refreshOn=[CHANGED];}
// Endpoint operations (the application through the signaling contract, §9.1).
export class RtcRegister extends RtcAction{static operation='rtc.register';run({rtc}){return rtc.register(this.actor,this.input);}}
export class RtcUnregister extends RtcAction{static operation='rtc.unregister';static lifecycle='suspended';run({rtc}){return rtc.unregister(this.actor,this.input);}}
export class RtcOpen extends RtcAction{static operation='rtc.open';run({rtc}){return rtc.open(this.actor,this.input);}}
export class RtcClaim extends RtcAction{static operation='rtc.claim';run({rtc}){return rtc.claim(this.actor,this.input);}}
export class RtcSend extends RtcAction{static operation='rtc.send';run({rtc}){return rtc.send(this.actor,this.input);}}
export class RtcRenew extends RtcAction{static operation='rtc.renew';run({rtc}){return rtc.renew(this.actor,this.input);}}
export class RtcMintTicket extends RtcAction{static operation='rtc.mint-ticket';run({rtc}){return rtc.mintTicket(this.actor,this.input);}}
export class RtcListen extends RtcQuery{static operation='rtc.listen';static lifecycle='suspended';fetch({rtc}){return rtc.listen(this.actor,this.input);}}
export class RtcEndpoints extends RtcQuery{static operation='rtc.endpoints';static lifecycle='suspended';fetch({rtc}){return rtc.endpoints(this.actor);}}
// Owner operations.
export class RtcPolicy extends RtcQuery{static operation='rtc.policy';static lifecycle='suspended';fetch({rtc}){return rtc.policy(this.actor);}}
export class RtcSetPolicy extends RtcAction{static operation='rtc.set-policy';static lifecycle='suspended';run({rtc}){return rtc.setPolicy(this.actor,this.input);}}
export class RtcSetContactRtc extends RtcAction{static operation='rtc.set-contact-rtc';static lifecycle='suspended';run({rtc}){return rtc.setContactRtc(this.actor,this.input);}}
export class RtcBlock extends RtcAction{static operation='rtc.block';static lifecycle='suspended';run({rtc}){return rtc.block(this.actor,this.input);}}
export class RtcUnblock extends RtcAction{static operation='rtc.unblock';run({rtc}){return rtc.unblock(this.actor,this.input);}}
export class RtcMute extends RtcAction{static operation='rtc.mute';static lifecycle='suspended';run({rtc}){return rtc.mute(this.actor,this.input,true);}}
export class RtcUnmute extends RtcAction{static operation='rtc.unmute';run({rtc}){return rtc.mute(this.actor,this.input,false);}}
export class RtcRevokeTicket extends RtcAction{static operation='rtc.revoke-ticket';static lifecycle='suspended';run({rtc}){return rtc.revokeTicket(this.actor,this.input);}}
export class RtcEndSession extends RtcAction{static operation='rtc.end-session';static lifecycle='suspended';run({rtc}){return rtc.endSession(this.actor,this.input);}}
export class RtcRevokeEndpoint extends RtcAction{static operation='rtc.revoke-endpoint';static lifecycle='suspended';run({rtc}){return rtc.revokeEndpoint(this.actor,this.input);}}
export class RtcClearMissed extends RtcAction{static operation='rtc.clear-missed';static lifecycle='suspended';run({rtc}){return rtc.clearMissed(this.actor,this.input??{});}}
export class RtcSessions extends RtcQuery{static operation='rtc.sessions';static lifecycle='suspended';fetch({rtc}){return rtc.sessions(this.actor);}}
export class RtcMissed extends RtcQuery{static operation='rtc.missed';static lifecycle='suspended';fetch({rtc}){return rtc.missed(this.actor);}}
export class RtcBlocked extends RtcQuery{static operation='rtc.blocked';static lifecycle='suspended';fetch({rtc}){return rtc.blocked(this.actor);}}
export class RtcTickets extends RtcQuery{static operation='rtc.tickets';static lifecycle='suspended';fetch({rtc}){return rtc.tickets(this.actor);}}
export class RtcEndpointList extends RtcQuery{static operation='rtc.endpoint-list';static lifecycle='suspended';fetch({rtc}){return rtc.endpointList(this.actor);}}
export class RtcExport extends RtcQuery{static operation='rtc.export';static lifecycle='suspended';fetch({rtc}){return rtc.exportRecords(this.actor);}}
// System operations (never wire-dispatchable): adapters build the system actor from verified evidence.
class RtcSystem extends AppAction{static deps=['rtc'];static changes=CHANGED;static lifecycle='suspended';}
export class RtcIngest extends RtcSystem{static operation='rtc.ingest';run({rtc}){return rtc.ingest(this.actor,this.input);}}
export class RtcTick extends RtcSystem{static operation='rtc.tick';run({rtc}){return rtc.tick(this.actor);}}
export class RtcInbox extends RtcSystem{static operation='rtc.inbox';run({rtc}){rtc.system(this.actor);return rtc.processInbox(this.actor.owner,{limit:Number.isSafeInteger(this.input?.limit)&&this.input.limit>0&&this.input.limit<=256?this.input.limit:16});}}
export class RtcOutboxDrain extends RtcSystem{static operation='rtc.outbox-drain';run({rtc}){rtc.system(this.actor);return rtc.drain(this.actor.owner,{limit:Number.isSafeInteger(this.input?.limit)&&this.input.limit>0&&this.input.limit<=256?this.input.limit:32});}}
export class RtcLifecycle extends RtcSystem{static operation='rtc.lifecycle';run({rtc}){return rtc.lifecycle(this.actor,this.input);}}
// RTC-f: the built-in ice-relay/v1 occupant (packages/rtc/relay.mjs). `credentials` is the relay contract's one method;
// the sweep is a system step (never wire-dispatchable, never gated).
export class RtcRelayCredentials extends RtcAction{static operation='rtc.relay-credentials';run({rtc}){if(!rtc.relay)notFound();return rtc.relay.credentials(this.actor,this.input);}}
export class RtcRelaySweep extends RtcSystem{static operation='rtc.relay-sweep';run({rtc}){const owner=rtc.system(this.actor);return rtc.relay?rtc.relay.sweep(owner):{revoked:0,pending:0,wakeAt:null};}}

export const RTC_ENDPOINT_OPERATIONS=Object.freeze([RtcRegister,RtcUnregister,RtcOpen,RtcClaim,RtcSend,RtcRenew,RtcMintTicket,RtcListen,RtcEndpoints]);
export const RTC_OWNER_OPERATIONS=Object.freeze([RtcPolicy,RtcSetPolicy,RtcSetContactRtc,RtcBlock,RtcUnblock,RtcMute,RtcUnmute,RtcRevokeTicket,RtcEndSession,RtcRevokeEndpoint,RtcClearMissed,RtcSessions,RtcMissed,RtcBlocked,RtcTickets,RtcEndpointList,RtcExport]);
export const RTC_SYSTEM_OPERATIONS=Object.freeze([RtcIngest,RtcInbox,RtcTick,RtcOutboxDrain,RtcLifecycle,RtcRelaySweep]);
/** RTC-f: operations of the ice-relay/v1 contract (application endpoint actor), mapped from contract methods. */
export const RTC_RELAY_OPERATIONS=Object.freeze([RtcRelayCredentials]);
export const RTC_RELAY_CONTRACT_OPERATIONS=Object.freeze({credentials:'rtc.relay-credentials'});
/** Operations that no RTC flag ever gates (design §3.2 narrowing, plus reads of existing state). Decline claims and
 * `send` of only end/cancel/decline are narrowing inside rtc.claim and rtc.send. */
export const RTC_NEVER_GATED=Object.freeze(['rtc.unregister','rtc.end-session','rtc.revoke-endpoint','rtc.block','rtc.mute','rtc.revoke-ticket','rtc.clear-missed','rtc.listen','rtc.endpoints','rtc.policy','rtc.sessions','rtc.missed','rtc.blocked','rtc.tickets','rtc.endpoint-list','rtc.export','rtc.ingest','rtc.inbox','rtc.tick','rtc.outbox-drain','rtc.lifecycle','rtc.relay-sweep']);
/** The contract's method names (§9.1) → engine operations, for the RPC adapter (RTC-e). */
export const RTC_CONTRACT_OPERATIONS=Object.freeze({register:'rtc.register',unregister:'rtc.unregister',endpoints:'rtc.endpoints',open:'rtc.open',claim:'rtc.claim',send:'rtc.send',renew:'rtc.renew',listen:'rtc.listen',mint_ticket:'rtc.mint-ticket'});
export {DEFAULT_POLICY,iatWithinWindow};
