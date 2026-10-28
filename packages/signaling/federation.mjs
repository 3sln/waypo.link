// Signaling foreign transport, key roster and outbound delivery port (docs/spec/extensions/signaling.md §5.1, §6.1,
// §9, §12.1; carried from rtc-signaling design RTC-e by signaling Appendix C.1 federation.mjs: kept, renamed).
// Provisional (coordinator), not signed off by the user. Behind SIGNALING_FOREIGN_ENABLED (default off) and an explicit
// foreign-issuer allowlist (SIGNALING_FOREIGN_ISSUERS, empty by default): with either missing nothing here dials.
// Nothing is production-verified, and the security.md S4 egress gate is NOT passed.
//
//   SignalingKeyRoster          the `keys` port for FOREIGN principals: cache-only reads over the host's
//                               IdentityDirectory; a bounded roster of principals kept warm (admitted peers and
//                               recipients of the last 24 h), a bounded refresh queue and, before any identity-document
//                               fetch, the issuer's manifest floor plus a valid signaling declaration (§3.1, §9.2 step 3).
//   signalingEgress             wraps the adapter's SSRF-screened POST egress with the allowlist, the batch media type
//                               and the §9.1 body bound. It never follows a redirect.
//   foreignSignalingTransport   {foreign:true, deliver(from, to, batch)}: same-host principals go to the same-host
//                               transport; others only to the declared `endpoint` of the peer's current issuer (§9.1).
//                               Called only from SignalingService.drain, never inside a sender's request.
import {principalKey} from '../core/principals.mjs';
import {validateSignalingOptions,SIGNALING_EXTENSION} from './extension.mjs';
import {BATCH_MEDIA_TYPE,LIMITS,parseBatch} from './messages.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Roster bounds (provisional). RTC-e review F1: `queue`/`perIssuer` bound the plain claimed lane, `perSource` its
 * queued entries per source network and `sourceRate` its schedules per source network per minute (per writer);
 * `priority` bounds the live and linked lanes together, `laneRate` the schedules per presented link per minute;
 * `liveMs` how long a peer counts as live after its last verified message or session tick. Verification follow-ups:
 * `priorityPerIssuer` bounds the live and linked entries of one issuer, so one peer provider cannot fill `priority`. */
export const ROSTER_LIMITS=Object.freeze({entries:512,ttlMs:86400000,queue:64,perIssuer:16,perSource:4,sourceRate:8,priority:32,priorityPerIssuer:8,laneRate:4,negativeMs:60000,liveMs:600000,run:8,sources:1024});
/** Queue lanes in service order, with the directory fetch class each one spends (directory.mjs DIRECTORY_PRIORITIES). */
const LANES=Object.freeze([['live','linked'],['linked','linked'],['claimed','claimed']]);
const RANK=Object.freeze({claimed:0,linked:1,live:2});
/** A delivery failure the sender must not retry (4xx other than 429, a redirect, a refused target). */
export class SignalingDeliveryError extends Error{constructor(code,{permanent=false,status=0}={}){super(code);this.name='SignalingDeliveryError';this.code=code;this.permanent=permanent;this.status=status;}}
const retry=code=>{throw new SignalingDeliveryError(code);};
const permanent=(code,status=0)=>{throw new SignalingDeliveryError(code,{permanent:true,status});};

/**
 * The key roster (§8.2 step 3, §4.1, design §3.4). `directory({control})` returns the host's IdentityDirectory for this
 * entity (built with `features: [SIGNALING_EXTENSION]` and the signaling issuer allowlist) or null while gated off; with
 * `control: true` it is gated only by the allowlist, DIRECTORY_ENABLED and the egress, never by SIGNALING_FOREIGN_ENABLED
 * (review F2: control-only delivery is narrowing). Reads never dial; only `warm` (the initiator-initiated fetch at
 * `open`, §4.1), `run` (background, from the alarm or the detached task) and `feature` for delivery do, and only
 * under the directory's budgets.
 *
 * Review F1 (unauthenticated roster starvation): every fetch class has its own budget. `warm` spends `interactive`;
 * refresh-ahead of tracked peers spends `background`; a claim scheduled from an unverified batch spends `claimed`
 * (a third of the per-site budget), or `linked` (another third) when the claim is backed by a locally verified
 * relationship: a peer with a live or pending session (`live` lane, served first) or an invite whose offer_digest
 * names a live offer here (`linked` lane; §9.2 step 3 lanes, AMD-RV2). Plain claims are capped per source network.
 */
export class SignalingKeyRoster{
 constructor({issuer,directory,clock=()=>Date.now(),allowLoopback=false,limits={}}){
  if(typeof issuer!=='string'||typeof directory!=='function')throw new TypeError('The signaling key roster needs an issuer and a directory port.');
  Object.assign(this,{issuer,directoryPort:directory,clock,allowLoopback,limits:{...ROSTER_LIMITS,...limits}});
  this.roster=new Map();this.queue=new Map();this.misses=new Map();this.lives=new Map();this.sources=new Map();this.lanes=new Map();this.ahead=0;
 }
 dir(options){try{return this.directoryPort(options)??null;}catch{return null;}}
 foreign(p){return Boolean(p)&&typeof p.iss==='string'&&p.iss!==this.issuer&&UUID.test(p.sub??'');}
 usable(d,p){try{return Boolean(d)&&this.foreign(p)&&d.allowed(p.iss)===true;}catch{return false;}}
 /** Cache only: the peer's ACTIVE certification keys that the directory holds in both its cache and its pin, and the
  * pinned identity URI (never the certificate's claim, §5.1). */
 async held(p){
  const d=this.dir();if(!this.usable(d,p))return null;let doc;try{doc=d.peek({issuer:p.iss,subject:p.sub});}catch{doc=null;}if(!doc||!Array.isArray(doc.keys))return null;
  const keys=[];let identity=null;
  for(const k of doc.keys){if(keys.length>=8)break;if(k?.use!=='cert'||k.state!=='active')continue;let r=null;try{r=await d.resolve({issuer:p.iss,subject:p.sub,kid:k.kid,purpose:'certification'});}catch{r=null;}
   if(r?.purpose==='certification'&&r.verifiable===true){keys.push({kid:r.kid,use:'cert',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x:r.publicJwk.x,y:r.publicJwk.y},state:'active'});identity??=r.identity;}}
  return keys.length&&typeof identity==='string'?{keys,identity}:null;
 }
 async certification(p){return (await this.held(p))?.keys??[];}
 async identity(p){return (await this.held(p))?.identity??null;}
 /** The peer issuer's declared `profiles` as held (cache only), or null (§5.1 `unsupported_peer` for a missing one). */
 profiles(p){const f=this.peekFeature(p?.iss);return f?[...f.profiles]:null;}
 /** §5.7 key warming at `offer`: issuer-level metadata only (the validated manifest and its signaling declaration),
  * never a principal's identity document or keys. Background priority, under the directory budgets. */
 warmIssuer(iss){if(typeof iss!=='string'||iss===this.issuer)return;this.feature(iss,'background').catch(()=>null);}
 /** The peer issuer's declared `max_leg_certificate_seconds` as held (cache only), or null. */
 maxLegSeconds(p){const f=this.peekFeature(p?.iss);return f?f.max_leg_certificate_seconds:null;}
 /** §5.1: true only when `p`'s issuer manifest is held fresh (cache only, never dials) and declares no valid
  * signaling declaration, a public fact answered with `unsupported_peer`. Unknown (no fresh manifest) is false. */
 unsupported(p){const d=this.dir();if(!this.usable(d,p))return false;let f=null;try{f=d.peekFeatures(p.iss);}catch{f=null;}return f!==null&&typeof f==='object'&&!validateSignalingOptions(f[SIGNALING_EXTENSION],{issuer:p.iss,allowLoopback:this.allowLoopback});}
 peekFeature(iss,options){const d=this.dir(options);if(!d||typeof iss!=='string'||iss===this.issuer)return null;let f=null;try{f=d.peekFeatures(iss);}catch{f=null;}return f?validateSignalingOptions(f[SIGNALING_EXTENSION],{issuer:iss,allowLoopback:this.allowLoopback}):null;}
 /** The validated signaling declaration of `iss`, fetching its manifest under the directory budgets when not cached.
  * `control: true` (review F2): the control-only delivery path, through a directory not gated by SIGNALING_FOREIGN_ENABLED;
  * a held (cached) feature is used first. */
 async feature(iss,priority='background',{control=false}={}){
  const options=control?{control:true}:undefined,d=this.dir(options);if(!d||typeof iss!=='string'||iss===this.issuer||d.allowed(iss)!==true)return null;
  const held=this.peekFeature(iss,options);if(held)return held;
  let f;try{f=await d.features(iss,priority);}catch{return null;}return validateSignalingOptions(f?.[SIGNALING_EXTENSION],{issuer:iss,allowLoopback:this.allowLoopback});
 }
 /** Keeps `p` warm for 24 h (an admitted peer, a recipient of an open session) and marks it live. Bounded; the oldest
  * entry goes first. */
 track(p){if(!this.foreign(p))return;const k=principalKey(p),now=this.clock();this.roster.delete(k);this.roster.set(k,{p:{iss:p.iss,sub:p.sub},until:now+this.limits.ttlMs});while(this.roster.size>this.limits.entries)this.roster.delete(this.roster.keys().next().value);this.markLive(k,now);}
 markLive(k,now){this.lives.delete(k);this.lives.set(k,now+this.limits.liveMs);while(this.lives.size>this.limits.entries)this.lives.delete(this.lives.keys().next().value);}
 /** Review F1: the foreign peers of this entity's live or pending sessions (SignalingService.tick), served first. */
 live(principals){const now=this.clock();for(const p of Array.isArray(principals)?principals.slice(0,this.limits.entries):[])if(this.foreign(p))this.markLive(principalKey(p),now);for(const [k,until] of this.lives)if(until<=now)this.lives.delete(k);}
 isLive(k){const until=this.lives.get(k);return until!==undefined&&until>this.clock();}
 /** A fixed-window count per key in `map` (bounded); true while under `limit`. */
 rate(map,key,limit,now){let w=map.get(key);if(!w||w.reset<=now)w={n:0,reset:now+60000};if(w.n>=limit)return false;w.n++;map.delete(key);map.set(key,w);while(map.size>this.limits.sources)map.delete(map.keys().next().value);return true;}
 /**
  * Schedules one background refresh (never a fetch here). Issuers outside the allowlist are never scheduled, and a
  * recent failure for the same principal is negatively cached. Review F1: the lane is `live` for a peer with a live
  * or pending session, `linked` when `lane` names an invite offer that is live here (at most one queued entry and
  * `laneRate` schedules a minute per link), else `claimed` (bounded in total and per issuer, and per `source`
  * network: `perSource` queued and `sourceRate` schedules a minute). An entry already queued keeps its place and
  * moves up to the best lane it has been claimed for.
  */
 refresh(p,kid,{source,lane}={}){
  const d=this.dir();if(!this.usable(d,p))return false;const k=principalKey(p),now=this.clock(),named=typeof kid==='string'&&kid.length<=256?kid:undefined;
  const src=typeof source==='string'&&source&&source.length<=128?source:null,link=typeof lane==='string'&&lane&&lane.length<=128?lane:null;
  const cls=this.isLive(k)?'live':link?'linked':'claimed',queued=this.queue.get(k);
  if(queued){if(named)queued.kid=named;if(RANK[cls]>RANK[queued.lane]&&this.room(cls,{p,src,link},now)){queued.lane=cls;queued.link=link;}return true;}
  const miss=this.misses.get(k);if(miss!==undefined&&miss>now)return false;
  if(!this.room(cls,{p,src,link},now))return false;
  this.queue.set(k,{iss:p.iss,sub:p.sub,lane:cls,...named?{kid:named}:{},...src?{source:src}:{},...link?{link}:{}});return true;
 }
 /** Whether lane `cls` admits one more entry (spending its per-source or per-link rate when it does). */
 room(cls,{p,src,link},now){
  const entries=[...this.queue.values()];
  if(cls!=='claimed'){const priority=entries.filter(q=>q.lane!=='claimed');if(priority.length>=this.limits.priority||priority.filter(q=>q.iss===p.iss).length>=this.limits.priorityPerIssuer)return false;if(cls==='linked'&&(entries.some(q=>q.link===link&&q.lane==='linked')||!this.rate(this.lanes,link,this.limits.laneRate,now)))return false;return true;}
  const claimed=entries.filter(q=>q.lane==='claimed');
  if(claimed.length>=this.limits.queue||claimed.filter(q=>q.iss===p.iss).length>=this.limits.perIssuer)return false;
  if(src&&(claimed.filter(q=>q.source===src).length>=this.limits.perSource||!this.rate(this.sources,src,this.limits.sourceRate,now)))return false;
  return true;
 }
 /** One fetch at `priority`: the issuer's manifest (directory floor) must declare a valid signaling declaration before any
  * identity document is fetched (§8.2 step 3). Failures are negatively cached for a minute; a refusal by a budget
  * answers 'limited' and caches nothing. */
 async fetch(p,priority='background'){
  const d=this.dir();if(!this.usable(d,p))return false;const k=principalKey(p);
  // A named kid that is not held (a rotation) refetches a fresh document once (the directory caches that miss 60 s).
  try{
   let f;try{f=await d.features(p.iss,priority);}catch(error){if(error?.code==='rate_limited')throw error;f=null;}
   if(!validateSignalingOptions(f?.[SIGNALING_EXTENSION],{issuer:p.iss,allowLoopback:this.allowLoopback}))throw new Error('no signaling declaration');
   await d.refresh({issuer:p.iss,subject:p.sub,priority,...typeof p.kid==='string'?{kid:p.kid}:priority==='background'?{early:true}:{}});this.misses.delete(k);return true;}
  catch(error){if(error?.code==='rate_limited')return 'limited';this.misses.set(k,this.clock()+this.limits.negativeMs);while(this.misses.size>this.limits.entries)this.misses.delete(this.misses.keys().next().value);return false;}
 }
 /** §5.1 initiator-initiated fetch at `open` (interactive priority, its own budget). Never on a federation request path.
  * Verification follow-ups: not tracked here; SignalingService tracks the recipient once its session record exists. */
 async warm(p){if(!this.foreign(p))return false;if(await this.held(p))return true;return await this.fetch(p,'interactive')===true;}
 /** Background pass: queued refreshes by lane (live, linked, claimed), then refresh-ahead of roster entries, live ones
  * first and the rest in rotation (the directory skips fresh ones). A lane whose budget refuses stops for this pass and
  * keeps its entries; such refusals do not count against `limit`. */
 async run({limit=this.limits.run}={}){
  let fetched=0;const now=this.clock();
  for(const [lane,priority] of LANES){
   for(const [k,q] of [...this.queue]){if(fetched>=limit)break;if(q.lane!==lane||this.queue.get(k)!==q)continue;
    const r=await this.fetch(q,priority);if(r==='limited')break;this.queue.delete(k);fetched++;}
  }
  for(const [k,e] of this.roster)if(e.until<=now)this.roster.delete(k);
  const entries=[...this.roster],live=entries.filter(([k])=>this.isLive(k)),rest=entries.filter(([k])=>!this.isLive(k));
  const order=[...live,...rest.slice(this.ahead%Math.max(1,rest.length)),...rest.slice(0,this.ahead%Math.max(1,rest.length))];
  for(const [k,e] of order){if(fetched>=limit)break;const r=await this.fetch(e.p,'background');if(r==='limited')break;fetched++;if(!this.isLive(k))this.ahead++;}
  return {fetched,queued:this.queue.size,roster:this.roster.size};
 }
}

/**
 * The POST port over an adapter's SSRF-screened egress `{send({url, headers, body, maxBytes, requestBytes})}` ->
 * {status, contentType, bytes}. Only https URLs on an allowlisted issuer origin, the batch media type, at most the
 * §8.1 body bound; the response body is bounded to 1 KiB and discarded. Returns the status.
 */
export function signalingEgress({send,issuers=[]}){
 if(typeof send!=='function')throw new TypeError('Signaling egress needs a screened send port.');const allowed=new Set(issuers);
 return async(url,body)=>{
  let u;try{u=new URL(url);}catch{permanent('signaling_target_refused');}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.port||u.href!==url||!allowed.has(u.origin))permanent('signaling_target_refused');
  if(typeof body!=='string'||new TextEncoder().encode(body).length>LIMITS.batchBytes)permanent('signaling_batch_invalid');
  let r;try{r=await send({url,headers:{'Content-Type':BATCH_MEDIA_TYPE},body,maxBytes:1024,requestBytes:LIMITS.batchBytes});}catch(error){if(error?.code==='egress_busy')retry('signaling_delivery_busy');retry('signaling_delivery_failed');}
  return Number.isInteger(r?.status)?r.status:502;
 };
}

/** True for a batch that carries only control statements (narrowing: §5.2, §14). */
export function controlOnly(batch){try{const b=parseBatch(batch);return b.messages.length===0&&b.certificates.length===0&&b.controls.length>0;}catch{return false;}}

/**
 * The foreign transport (`foreign: true`). `local`: the same-host transport. `roster`: SignalingKeyRoster (endpoint lookup).
 * `post(url, body) -> status` (signalingEgress). `enabled(from)`: SIGNALING_FOREIGN_ENABLED for the sending entity; control-only
 * batches are narrowing and are not gated by it (registry comment), but still need the allowlist, the directory and
 * the egress (review F2: their endpoint lookup takes the roster's control path). `current(principal)`: the successor index (identity portability §8), identity by default.
 * Outcomes: 202 delivered; network error, 429 and 5xx are retried by the outbox with backoff until the item's useful
 * life (§8.3); any other answer (400, 404, a redirect) is permanent and the row is dropped.
 */
export function foreignSignalingTransport({issuer,local,roster,post,enabled=async()=>false,current=async p=>p}){
 if(typeof local?.deliver!=='function'||typeof roster?.feature!=='function')throw new TypeError('The foreign signaling transport needs a local transport and a roster.');
 return Object.freeze({foreign:true,async deliver(from,to,batch){
  if(to?.iss===issuer)return local.deliver(from,to,batch);
  if(typeof post!=='function')retry('signaling_foreign_unavailable');
  if(!controlOnly(batch)){let on=false;try{on=await enabled(from)===true;}catch{on=false;}if(!on)retry('signaling_foreign_disabled');}
  let target=null;try{target=await current(to);}catch{target=null;}if(!target||typeof target.iss!=='string')retry('signaling_peer_unresolved');
  // Review F2: a control-only batch resolves the peer's endpoint through the control path (allowlist, DIRECTORY_ENABLED
  // and egress only; a held feature first), so the SIGNALING_FOREIGN_ENABLED kill switch never suppresses `revoked`/`failed`.
  const feature=await roster.feature(target.iss,'background',controlOnly(batch)?{control:true}:undefined);if(!feature)retry('signaling_peer_unsupported');
  const status=await post(feature.endpoint,batch);
  if(status===202)return {accepted:true};
  if(status===429||status>=500)retry('signaling_delivery_failed');
  permanent('signaling_delivery_refused',status);
 }});
}
