// SignalingService: the built-in signaling resource of one entity, its sessions, admission, offers, pairings, outbox
// and the same-host transport (docs/spec/extensions/signaling.md rev 3.2 §4–§14). Provisional (coordinator), NOT
// signed off by the owner (Appendix C.5 step 1 outstanding). Everything is behind SIGNALING_ENABLED and
// SESSION_KINDS_ENABLED (default off): while either is off nothing new is reachable (endpoint widening, owner widening
// and new sessions answer the uniform `not_found`), and existing state stays readable, narrowable and endable.
// Narrowing is never gated (§14.1).
//
// One SignalingService per entity account writer, which is the single authority for that entity's first claims, offer
// uses and pairing records (so claim versus offer end is decided against one store, §5.7). All behaviour is an ngin
// Action or Query (bottom of this file); the account slice and the HTTP/RPC adapters only build actors from verified
// evidence and dispatch (engine-first).
//
// Actors (built by trusted adapters, never from a request body):
//   {kind:'app', owner, clientId, origin, grants:[id], epoch?, jkt?, clientSession?, memberContext?, deviceLabel?,
//    feature?}   an endpoint consumer from the verified RPC dispatch context. `feature` (a spec URL) marks a provider
//                feature (§4.2): its clientId is the issuer and it is service-class; 3sln.me builds none today.
//   {kind:'owner', owner, parties?:[clientId], freshAuth?}   the account owner. `parties` is the adapter's evidence of
//                which apps hold a live connection and an active grant on the signaling field (pairing P1, §5.8);
//                `freshAuth` that the owner authenticated freshly (cross-entity pairing creation).
//   {kind:'system', owner}   adapters: ingest, tick, drain, lifecycle
//
// Ports (constructor):
//   store       the account writer's transactional metadata ({transaction(tx => …)}, tx {get, put, delete, list})
//   keys        {certification(principal) -> keys AS HELD (never a fetch on a federation request path),
//                identity(principal) -> identity URI | null, handle?(principal), resolveHandle?(handle), aep?(owner),
//                refresh?(principal, kid, {source, lane}), live?(principals), track?(principal), warm?(principal) (the
//                initiator-initiated fetch at `open`), warmIssuer?(iss) (issuer-level metadata only, at `offer`,
//                §5.7), unsupported?(principal), maxLegSeconds?(principal), profiles?(principal) (the peer's
//                declared profiles, as held)}
//   kinds       {held({artefact, version, digest}) -> session-kind body | null, version(line, version) -> {digest,
//                body} | null}: kind versions this provider holds (its store, a mirror, or a background fetch whose
//                timing never depends on recipient state, §3.4). Never fetched by the service.
//   signer      owner -> {kid, privateKey}: the entity's ACTIVE certification key
//   transport   {deliver(from, to, batch), foreign?:boolean}
//   flags       {for(ctx) -> {enabled(name)}}
//   defer       (owner, kind) -> void: run `signaling.inbox` / `signaling.outbox-drain` soon, OUTSIDE this request
//   pushTransport {send(subscription, payload, {urgency, ttl})} (Web Push doorbell, §11.2), optional
//   hostLimits  {take(name, parts) -> boolean}: the host-wide fixed-window limiter (initiator window across entities)
//   entityKind  owner -> 'person' | 'organization' (service designation, §4.3); default 'person'
//   relay       attachRelay(): the entity's built-in ice-relay resource (relay.mjs)
//   ownerPages  boolean (default false): owner widening operations need a page review (owner-pages.mjs, §20.1.4 and
//               §5.8 page obligations) and cross-entity activation and renewal need fresh authentication. The runtime
//               turns it on; engine rule tests run without it.
//   connections {state(tx, owner, clientId) -> {state: 'live'|'paused'|'ended', generation}}: the app's connection as
//               read in this writer's transaction (packages/apps/connections.mjs appConnectionState). Optional: without
//               it every app connection counts as live (engine tests). With it, every app endpoint, approval, offer and
//               pairing belongs to the connection generation recorded at approval (`sig/app/`): it is inert while that
//               connection is not live, and cleared (§20.1.4, §14.2) once the generation has changed (§5.4, §5.8 P3).
import {Provider} from '../../vendor/ngin/index.js';
import {AppAction,AppQuery,ownerOf} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {base64url,digest} from '../core/records.mjs';
import {samePrincipal,principalKey} from '../core/principals.mjs';
import {validateAdditive} from '../core/artefacts.mjs';
import {delegatePublicJwk,jwkThumbprint,isJkt,originValid} from '../identity/delegation.mjs';
import {validateIntentKind,validateIntentData} from '../intents/schema.mjs';
import {isSessionKind,partiesAdmit,basisAllowed,profileAllowed,addsDisclosure,projectContext,memoryKey,handlerOf,approvalIn,withApproval,withoutApproval,listApprovals,handlerExcluded} from '../intents/sessions.mjs';
import {SignalingWireFault} from './jws.mjs';
import {parseBatch,batchStep1,buildBatch,parseMessage,verifyMessage,validateMessageContent,candidateAllowedByPolicy,messageAllowedBeforeClaim,iatWithinWindow,offerDigest,offerTokenValid,inviteParamsShape,kindReferenceValid,sameKind,profileValid,dataPayloadBytes,LIMITS,PROFILES} from './messages.mjs';
import {parseLegCertificate,verifyLegCertificate,signLegCertificate,parseControl,verifyControl,signControl,LEG_CERTIFICATE_SECONDS,LEG_CERTIFICATE_MAX_SECONDS} from './certificates.mjs';
import {K,readPolicy,ipPolicyFor,policyWidens,stricterIp,isBlocked,blockTarget,blockKey,blockCovers,putBlock,principalBlocks,issuerBlocks,takeLimits,limitsOpen,pruneLimits,fairShare,inviteLimits,capacityCounts,capacityAllows,endpointsFor,LIMITS as LIMIT_VALUES,DEFAULT_POLICY} from './admission.mjs';
import {transition,canTransition,isLive,dueEvent,recordExpired,decideClaim,claimUsable,offerSeq,payloadDigest,newLeg,gapExpired,BOUNDS,ORDER_LIMITS,SESSION_MAX_MS,ANSWER_MAX_MS} from './sessions.mjs';
import {REVIEW_ACTIONS,canonicalInput,storeReview,takeReview,approvalRequired,kindView,kindRisk,pairingEffect,appView,peerView,newerKind,latestHeld,addsDisclosure as kindAddsDisclosure} from './owner-pages.mjs';

export const SIGNALING_FLAG='SIGNALING_ENABLED',SIGNALING_FOREIGN_FLAG='SIGNALING_FOREIGN_ENABLED',SESSION_KINDS_FLAG='SESSION_KINDS_ENABLED';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,ENDPOINT_ID=/^ep_[A-Za-z0-9_-]{22}$/,SID=/^[A-Za-z0-9_-]{22,43}$/,PAIRING_ID=/^pr_[A-Za-z0-9_-]{22}$/,OFFER_ID=/^[A-Za-z0-9_-]{43}$/;
const DAY=86400000,FORWARD_MS=30000,BATCH=256;
/** A foreign invite is re-sent only after its first `202`, at most twice (AMD-RV2, §9.3). */
export const INVITE_RESEND_DELAYS=Object.freeze([3000,12000]);
const PUSH_CONCURRENCY=4;
const fail=(code,message=code,status=400)=>{throw new AppFault(code,message,status);};
const notFound=()=>fail('not_found','Not found.',404);
const invalid=(message='Unsupported signaling request.')=>fail('invalid_args',message,400);
const limited=()=>fail('rate_limited','Too many signaling requests. Try again later.',429);
const unavailable=()=>fail('temporarily_unavailable','Signaling is temporarily unavailable.',503);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,required,optional=[])=>{if(!plain(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))invalid();return v;};
const party=p=>({iss:p.iss,sub:p.sub});
const seconds=ms=>Math.floor(ms/1000);
const labelValid=(v,max=64)=>typeof v==='string'&&v.length>0&&v.length<=max&&v.isWellFormed()&&!/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u.test(v);
const lineValid=v=>typeof v==='string'&&v.length<=256&&kindReferenceValid({artefact:v,version:1,digest:'sha256-'+'A'.repeat(43)});
const clientIdValid=v=>typeof v==='string'&&v.length>0&&v.length<=2048;
const sessionIdValid=v=>v===null||typeof v==='string'&&v.length>0&&v.length<=256;
/** Web Push services this host accepts at `register` (§11.2: only origins it recognizes). Provisional list. */
export const PUSH_ORIGINS=Object.freeze(['https://fcm.googleapis.com','https://updates.push.services.mozilla.com','https://web.push.apple.com']);
/** The doorbell payload (§11.2): exactly {"t":"signal","endpoint":<endpoint>}; no initiator, kind or session. */
export const doorbellPayload=endpoint=>({t:'signal',endpoint});
const keysView=keys=>(Array.isArray(keys)?keys:[]).filter(k=>plain(k)&&k.use==='cert'&&k.state==='active'&&plain(k.jwk)).map(k=>({kid:k.kid,use:'cert',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x:k.jwk.x,y:k.jwk.y},state:'active'}));
/** §6.3 pinned keys: the peer's held certification keys pinned on a session (newest first, at most 8). */
const pinKeys=(keys,prior=[])=>{const out=[],seen=new Set();for(const k of [...keysView(keys),...keysView(prior)]){const id=JSON.stringify([k.kid,k.jwk.x,k.jwk.y]);if(!seen.has(id)&&out.length<8){seen.add(id);out.push(k);}}return out;};
const principalValid=(p,allowLoopback)=>plain(p)&&Object.keys(p).length===2&&originValid(p.iss,allowLoopback)&&typeof p.sub==='string'&&UUID.test(p.sub);
const handlerKey=ep=>ep.feature?{handler:ep.feature,feature:true}:{handler:ep.clientId,feature:false};
const sameHandler=(a,b)=>a.handler===b.handler&&a.feature===b.feature;
/** §5.8 coverage: a side covers an endpoint when the endpoint's app equals its client_id and, when the side binds a
 * client session, the endpoint's recorded client session equals it. A provider feature is never covered. */
const sideCovers=(side,ep)=>Boolean(side&&ep)&&!ep.feature&&ep.clientId===side.client_id&&(side.client_session===null||side.client_session===ep.clientSession);
const mayOpen=(pairing,side)=>pairing.opens==='both'||pairing.opens===side;
/** The approved apps of an entity and their kind lines, sorted ([[clientId, [line…]]…]): the designation page's "Apps this
 * applies to now" and the app set its review binds (reviewBound). Provider features are not apps. */
const serviceApps=rows=>{const apps=new Map();for(const {line,approval} of rows)if(!approval.feature)apps.set(approval.handler,[...apps.get(approval.handler)??[],line]);return [...apps].map(([id,lines])=>[id,[...lines].sort()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);};

/**
 * Same-host transport (§9.4): delivers a batch to the peer entity's own writer on this host as the system operation
 * `signaling.ingest`, through exactly the verification path a foreign batch takes. A principal on another issuer is
 * refused here; the foreign transport (federation.mjs) is a separate port behind SIGNALING_FOREIGN_ENABLED.
 */
export function sameHostSignalingTransport({issuer,dispatch}){
 return Object.freeze({foreign:false,async deliver(from,to,batch){if(to?.iss!==issuer||!UUID.test(to?.sub??''))throw new AppFault('signaling_foreign_unavailable','Cross-provider signaling is not available.',503);return dispatch(to.sub,'signaling.ingest',{batch});}});
}

export class SignalingService{
 constructor({store,issuer,clock,random,flags,keys,kinds,signer,transport,defer=null,hostLimits=null,pushTransport=null,entityKind=null,connections=null,federationSubject,allowLoopback=false,crypto=globalThis.crypto,maxLegSeconds=LEG_CERTIFICATE_SECONDS,peerMaxLegSeconds=LEG_CERTIFICATE_MAX_SECONDS,ownerPages=false}){
  if(typeof store?.transaction!=='function'||typeof issuer!=='string'||typeof keys?.certification!=='function'||typeof keys?.identity!=='function'||typeof kinds?.held!=='function'||typeof signer!=='function'||typeof transport?.deliver!=='function')throw new TypeError('SignalingService needs a store, issuer, keys, kinds, signer and transport.');
  Object.assign(this,{store,issuer,clock,random,flags,keys,kinds,signer,transport,defer,hostLimits,pushTransport,entityKind,connections,allowLoopback,crypto,maxLegSeconds,peerMaxLegSeconds,ownerPages:ownerPages===true});
  this.federationSubject=federationSubject??(owner=>`${issuer}/entities/${owner}`);
  this.waiters=new Map();this.relay=null;
 }
 attachRelay(relay){this.relay=relay??null;return this.relay;}
 now(){return this.clock.now();}
 self(owner){return {iss:this.issuer,sub:owner};}
 flag(owner,name=SIGNALING_FLAG,clientId){try{return this.flags?.for({subject:{kind:'account',owner},...clientId?{client:{clientId}}:{}}).enabled(name)===true;}catch{return false;}}
 /** Signaling is on for this owner: SIGNALING_ENABLED and SESSION_KINDS_ENABLED (both read: a class-a `requires` is not
  * always evaluated by every flag port). */
 enabled(owner,clientId){return this.flag(owner,SIGNALING_FLAG,clientId)&&this.flag(owner,SESSION_KINDS_FLAG,clientId);}
 /** Widening: the uniform `not_found` while signaling (or the named flag) is off. */
 requireFlag(owner,clientId,name){if(!this.enabled(owner,clientId)||name&&!this.flag(owner,name,clientId))notFound();}
 app(actor){
  if(actor?.kind!=='app'||!UUID.test(actor.owner??'')||!clientIdValid(actor.clientId)||!originValid(actor.origin,this.allowLoopback)||!Array.isArray(actor.grants)||!actor.grants.length||actor.grants.length>256||actor.grants.some(g=>typeof g!=='string')||actor.jkt!==undefined&&!isJkt(actor.jkt)||actor.clientSession!==undefined&&!sessionIdValid(actor.clientSession)||actor.memberContext!==undefined&&typeof actor.memberContext!=='boolean'||actor.feature!==undefined&&actor.feature!==null&&typeof actor.feature!=='string')fail('unauthorized','Application authorization is required.',401);
  return actor;
 }
 system(actor){if(actor?.kind!=='system'||!UUID.test(actor.owner??''))fail('forbidden','System only.',403);return actor.owner;}
 async bindOwner(tx,owner){if(await tx.get('owner')!==owner)fail('forbidden','Account owner mismatch.',403);}
 async peerKeys(p){try{return keysView(await this.keys.certification(party(p)));}catch{return [];}}
 async identity(p){try{const v=await this.keys.identity(party(p));return typeof v==='string'?v:null;}catch{return null;}}
 track(p){try{this.keys.track?.(party(p));}catch{/* best effort */}}
 peerMax(p){if(p?.iss===this.issuer)return this.peerMaxLegSeconds;let v=null;try{v=this.keys.maxLegSeconds?.(party(p));}catch{v=null;}return Number.isSafeInteger(v)&&v>=120&&v<=this.peerMaxLegSeconds?v:this.peerMaxLegSeconds;}
 async ownAep(owner){try{const v=await this.keys.aep?.(owner);return Number.isSafeInteger(v)&&v>=0?v:0;}catch{return 0;}}
 async entityIs(owner){try{return await this.entityKind?.(owner)==='organization'?'organization':'person';}catch{return 'person';}}

 // ---- kinds and approvals (§3.4, §15, AMD-SG-I1) ---------------------------------------------------------------------
 /** A held session-kind body for `ref`, or null (never fetched). */
 async heldKind(ref){
  if(!kindReferenceValid(ref))return null;let body=null;try{body=await this.kinds.held(structuredClone(ref));}catch{body=null;}
  if(!plain(body))return null;try{validateIntentKind(body);}catch{return null;}
  return isSessionKind(body)&&body.id===ref.artefact?body:null;
 }
 async versionBody(line,version){let v=null;try{v=await this.kinds.version?.(line,version);}catch{v=null;}if(!plain(v)||typeof v.digest!=='string')return null;const body=await this.heldKind({artefact:line,version,digest:v.digest});return body?{ref:{artefact:line,version,digest:v.digest},body}:null;}
 /** Whether the line is verifiably additive from `from` to `to` (artefacts §7.2): every step held and additive. */
 async additive(from,to){
  if(from.artefact!==to.artefact||from.version>to.version)return false;if(sameKind(from,to))return true;
  let prev=await this.heldKind(from);if(!prev)return false;
  for(let v=from.version+1;v<=to.version;v++){const next=await this.versionBody(from.artefact,v);if(!next)return false;if(v===to.version&&next.ref.digest!==to.digest)return false;
   let ok=false;try{ok=validateAdditive('intent',prev,next.body).additive===true;}catch{ok=false;}if(!ok)return false;prev=next.body;}
  return true;
 }
 /** §15: an approval at `approved` admits an invite at `invite` when equal, or additive in either direction. */
 async admits(approved,invite){return sameKind(approved,invite)||(approved.version<invite.version?await this.additive(approved,invite):approved.version>invite.version&&await this.additive(invite,approved));}
 /** The live session handler approval of `who` ({clientId, feature?}) for `line`: {ref, body, approval} or null. Read in
  * `tx` when given (so it is atomic with the caller's records). */
 async approvalFor(owner,who,line,tx=null){
  const read=async t=>{const memory=await t.get(memoryKey(owner,line)),handler=handlerOf(who),a=approvalIn(memory,handler);if(!a)return null;
   // §20.1.4 "Exclusions (§7.4) apply"; and an app's approval is inert unless its connection is live at the recorded
   // generation (§5.4, P1), so a lagging cleanup never lets a dead or reconnected app use an earlier approval.
   if(!handler.feature&&(handlerExcluded(memory,handler.handler)||(await this.appState(t,owner,handler.handler)).status!=='live'))return null;
   return a;};
  const approval=tx?await read(tx):await this.store.transaction(read);if(!approval)return null;
  const ref={artefact:line,version:approval.version,digest:approval.digest},body=await this.heldKind(ref);
  return body?{ref,body,approval}:null;
 }
 /** `approval_required` carries the provider page URL for this app and kind (§20.1.4; owner-pages.mjs). */
 async requireApproval(app,line){const a=await this.approvalFor(app.owner,app,line);if(!a)throw approvalRequired(this.issuer,app,line);return a;}
 /** The approval of `app` for the kind of a live session, admitting the session's kind version (§15), as `claim` checks. */
 async requireAdmits(app,ref){const a=await this.requireApproval(app,ref.artefact);if(!await this.admits(a.ref,ref))throw approvalRequired(this.issuer,app,ref.artefact);return a;}

 // ---- connection liveness (§5.4, §14.2, §20.1.4 clearing) ------------------------------------------------------------
 async appKey(clientId){return K.app(await digest(this.crypto,'signaling-app\0'+clientId));}
 /**
  * The status of an app's signaling state against its connection: `live` (connection live, at the generation recorded
  * when the owner last approved it), `inert` (that same generation, paused or fenced; or no generation recorded, as for
  * state imported or written before the record existed: inert until the owner approves again) or `stale` (a
  * generation was recorded and the connection has since ended or changed generation): stale state is cleared by the
  * next sweep or approval and never revives (§20.1.4, §5.8 P3). Without a connections port every app is `live`.
  */
 async appState(tx,owner,clientId){
  if(typeof this.connections?.state!=='function')return {status:'live',state:'live',generation:null};
  let c=null;try{c=await this.connections.state(tx,owner,clientId);}catch{c=null;}
  const state=['live','paused','ended'].includes(c?.state)?c.state:'ended',generation=Number.isSafeInteger(c?.generation)?c.generation:null;
  const bound=await tx.get(await this.appKey(clientId));
  if(bound?.clientId!==clientId)return {status:'inert',state,generation};
  if(state==='ended'||generation===null||bound.generation!==generation)return {status:'stale',state,generation};
  return {status:state==='live'?'live':'inert',state,generation};
 }
 /** §20.1.4 clearing and §14.2 for one app whose connection ended (or whose grant on the signaling field was revoked):
  * its session handler approvals go for every kind, then §14.2 narrowing with authority. Narrowing; never gated. */
 async clearApp(tx,fx,owner,clientId,now){
  for(const {line} of await listApprovals(tx,owner)){const key=memoryKey(owner,line),{memory,removed}=withoutApproval(await tx.get(key),{handler:clientId,feature:false});if(removed)await tx.put(key,memory);}
  const ended=await this.narrow(tx,fx,owner,{clientId,authority:true},now);
  await tx.delete(await this.appKey(clientId));return ended;
 }
 /** Every app with any signaling state (approvals, bindings, endpoints, offers, pairings), for the sweep. */
 async appsWithState(tx,owner){
  const seen=new Set();
  for(const {approval} of await listApprovals(tx,owner))if(!approval.feature)seen.add(approval.handler);
  for(const row of (await tx.list({prefix:K.appPrefix,limit:4096})).values())if(typeof row?.clientId==='string')seen.add(row.clientId);
  for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values())if(!ep.feature)seen.add(ep.clientId);
  for(const [,o] of await this.offerRows(tx))if(!o.feature)seen.add(o.clientId);
  for(const p of await this.pairingRows(tx)){seen.add(p.local.client_id);if(p.peer.self)seen.add(p.peer.self.client_id);}
  return [...seen].filter(clientIdValid);
 }
 /** The sweep (tick): clears every app whose signaling state belongs to an ended or earlier connection. */
 async sweepApps(tx,fx,owner,now){
  if(typeof this.connections?.state!=='function')return 0;let n=0;
  for(const clientId of await this.appsWithState(tx,owner))if((await this.appState(tx,owner,clientId)).status==='stale'){await this.clearApp(tx,fx,owner,clientId,now);n++;}
  return n;
 }
 /** Every offer row (paged, never truncated: caps, revocation, owner lists and expiry must see all of them). */
 async offerRows(tx){
  const out=[];let after;
  for(;;){const page=await tx.list({prefix:K.offerPrefix,limit:BATCH,...after?{startAfter:after}:{}});for(const [key,o] of page){after=key;if(plain(o))out.push([key,o]);}if(page.size<BATCH)break;}
  return out;
 }

 // ---- endpoints (§10.1, §10.2 register, unregister, endpoints) -------------------------------------------------------
 async endpointAuth(tx,app,input,now){
  if(typeof input.endpoint!=='string'||!ENDPOINT_ID.test(input.endpoint))notFound();
  const ep=await tx.get(K.endpoint(input.endpoint));if(!ep||ep.clientId!==app.clientId||(ep.feature??null)!==(app.feature??null)||!(ep.expiresAt>now))notFound();
  // §5.4, §14.2 defence in depth: an endpoint of an earlier or dead connection is never authorized, whether or not the
  // connection-end cleanup has run yet (an old endpoint secret never revives after a reconnect).
  if(!ep.feature&&!await this.endpointLive(tx,app.owner,ep))notFound();
  // An endpoint identifier alone never authorizes: the DPoP key it was registered with, or its secret (§10.1).
  if(ep.bind.jkt!==undefined){if(app.jkt!==ep.bind.jkt||input.endpoint_secret!==undefined)notFound();}
  else if(typeof input.endpoint_secret!=='string'||input.endpoint_secret.length>128||await digest(this.crypto,'signaling-endpoint\0'+input.endpoint_secret)!==ep.bind.secretHash)notFound();
  return ep;
 }
 /** Whether an app endpoint's connection is live at the generation it was registered under (features: always). */
 async endpointLive(tx,owner,ep){if(ep.feature)return true;const st=await this.appState(tx,owner,ep.clientId);return st.status==='live'&&(ep.generation??null)===st.generation;}
 async register(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);exact(input,['kinds'],['label','push']);
  if(!Array.isArray(input.kinds)||!input.kinds.length||input.kinds.length>16||new Set(input.kinds).size!==input.kinds.length||!input.kinds.every(lineValid))invalid('Choose approved kinds.');
  if(input.label!==undefined&&!labelValid(input.label))invalid('The label is at most 64 characters of plain text.');
  if(input.push!==undefined){const p=input.push;let u=null;try{u=new URL(p?.endpoint);}catch{u=null;}
   if(!plain(p)||Object.keys(p).sort().join()!=='endpoint,keys'||!u||u.protocol!=='https:'||u.username||u.password||!PUSH_ORIGINS.includes(u.origin)||!plain(p.keys)||Object.keys(p.keys).sort().join()!=='auth,p256dh'||typeof p.keys.auth!=='string'||typeof p.keys.p256dh!=='string'||p.keys.auth.length>64||p.keys.p256dh.length>128)invalid('This push subscription is not accepted.');}
  for(const line of input.kinds)await this.requireApproval(app,line);
  const id='ep_'+base64url(this.random.bytes(16)),secret=app.jkt===undefined?base64url(this.random.bytes(32)):null,now=this.now();
  const bind=secret===null?{jkt:app.jkt}:{secretHash:await digest(this.crypto,'signaling-endpoint\0'+secret)};
  await this.commit(owner,async(tx,fx)=>{
   await this.bindOwner(tx,owner);if(await tx.get(K.closed))notFound();
   let live=0,mine=0;for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values())if(ep.expiresAt>now){live++;if(ep.clientId===app.clientId&&(ep.feature??null)===(app.feature??null))mine++;}
   if(live>=BOUNDS.endpoints||mine>=BOUNDS.endpointsPerApp)limited();
   const st=app.feature?{status:'live',generation:null}:await this.appState(tx,owner,app.clientId);if(st.status!=='live')throw approvalRequired(this.issuer,app,input.kinds[0]);
   const ep={v:2,id,clientId:app.clientId,origin:app.origin,feature:app.feature??null,kinds:[...input.kinds],label:input.label??null,providerLabel:typeof actor.deviceLabel==='string'&&labelValid(actor.deviceLabel)?actor.deviceLabel:null,push:input.push?structuredClone(input.push):null,bind,grants:[...app.grants],...app.epoch!==undefined?{epoch:app.epoch}:{},clientSession:app.clientSession??null,memberContext:app.memberContext===true,generation:st.generation,createdAt:now,lastSeen:now,expiresAt:now+BOUNDS.endpointIdleMs,q:{next:1,count:0,bytes:0},gap:false};
   await tx.put(K.endpoint(id),ep);
   // §5.4 late delivery: a pending invite of this endpoint's routing set reaches it when it registers.
   await this.deliverPending(tx,fx,owner,ep,now);
  });
  return {endpoint:id,...secret?{endpoint_secret:secret}:{},expires_at:seconds(now+BOUNDS.endpointIdleMs)};
 }
 /** signaling.unregister (narrowing, never gated): ends the endpoint's legs (§14.2); never ends an offer (§5.7). */
 async unregister(actor,input){
  const app=this.app(actor);exact(input,['endpoint'],['endpoint_secret']);const now=this.now();
  return this.commit(app.owner,async(tx,fx)=>{await this.bindOwner(tx,app.owner);const ep=await this.endpointAuth(tx,app,input,now);await this.removeEndpoint(tx,fx,ep,now);return {};});
 }
 /** §10.2 endpoints: this app's endpoints; with `endpoint`, the pairings covering it; with `pairing`, the eligible
  * endpoints covered by the other side of that live own-entity pairing, to an endpoint covered on a side that opens. */
 async endpoints(actor,input={}){
  const app=this.app(actor),now=this.now();exact(input??{},[],['endpoint','pairing','endpoint_secret']);input=input??{};
  if(input.pairing!==undefined&&(input.endpoint===undefined||typeof input.pairing!=='string'||!PAIRING_ID.test(input.pairing)))invalid();
  return this.store.transaction(async tx=>{
   await this.bindOwner(tx,app.owner);const out=[];
   for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values())if(ep.clientId===app.clientId&&(ep.feature??null)===(app.feature??null)&&ep.expiresAt>now&&await this.endpointLive(tx,app.owner,ep))out.push({endpoint:ep.id,label:ep.label,kinds:[...ep.kinds],last_seen:seconds(ep.lastSeen)});
   if(input.endpoint===undefined)return {endpoints:out};
   const caller=await this.endpointAuth(tx,app,input,now),pairings=[];
   for(const p of await this.pairingRows(tx))if(this.pairingSideOf(p,caller))pairings.push(this.pairingEntry(p,caller));
   if(input.pairing===undefined)return {endpoints:out,pairings};
   const p=await tx.get(K.pairing(input.pairing)),side=p?this.pairingSideOf(p,caller):null;
   // §5.9: a device-authorization pairing awaiting its code confirmation answers `approval_required` to the peer side.
   if(p&&p.state==='awaiting_confirmation'&&side==='peer'&&p.peer.self)fail('approval_required','This pairing awaits confirmation.',403);
   const extra=[];
   if(p&&p.state==='live'&&p.peer.self&&side&&mayOpen(p,side)){const other=side==='local'?p.peer.self:p.local;
    for(const ep of await endpointsFor(tx,{line:p.kind.artefact,now}))if(ep.id!==caller.id&&sideCovers(other,ep)&&await this.eligible(tx,app.owner,ep,p.kind))extra.push({endpoint:ep.id,label:ep.providerLabel,kinds:[...ep.kinds],client_id:ep.clientId});}
   return {endpoints:[...out,...extra],pairings};
  });
 }

 // ---- transactions with deferred effects ------------------------------------------------------------------------------
 /** Runs `fn(tx, fx)` in one storage transaction; long polls are woken, the outbox drained (`defer`, never inside this
  * request), doorbells rung and ended legs' relay credentials revoked after the commit. */
 async commit(owner,fn){
  const fx={woken:new Set(),drain:false,doorbells:[]};const out=await this.store.transaction(tx=>fn(tx,fx));
  for(const id of fx.woken)this.wake(id);
  if(fx.drain)this.kick(owner,'outbox');
  if(fx.doorbells.length)await this.ring(fx.doorbells);
  if(fx.relayEnded?.length&&this.relay)await this.relay.ended(owner,fx.relayEnded).catch(()=>null);
  return out;
 }
 /** §11.2 Web Push doorbell: at most one push per delivered invite per endpoint, `Urgency: high`, a TTL no longer than
  * the time left to `answer_by`, payload exactly {"t":"signal","endpoint":<endpoint>}. Never needed for correctness. */
 async ring(doorbells){
  if(typeof this.pushTransport?.send!=='function')return;
  const one=async d=>{
   const ttl=Math.max(0,Math.floor((d.answerBy-this.now())/1000));if(ttl<1)return;
   try{await this.pushTransport.send(structuredClone(d.subscription),doorbellPayload(d.endpoint),{urgency:'high',ttl});}
   catch(error){if(error?.code==='push_subscription_gone')try{await this.store.transaction(async tx=>{const ep=await tx.get(K.endpoint(d.endpoint));if(ep?.push&&ep.push.endpoint===d.subscription.endpoint){ep.push=null;await tx.put(K.endpoint(ep.id),ep);}});}catch{/* the next invite retries */}}
  };
  const queue=[...doorbells];await Promise.all(Array.from({length:Math.min(PUSH_CONCURRENCY,queue.length)},async()=>{while(queue.length)await one(queue.shift());}));
 }
 kick(owner,kind){try{this.defer?.(owner,kind);}catch{/* the alarm delivers */}}
 wake(id){const set=this.waiters.get(id);if(set){this.waiters.delete(id);for(const resolve of set)resolve();}}
 waitFor(id,ms){return new Promise(resolve=>{const set=this.waiters.get(id)??new Set();this.waiters.set(id,set);const done=()=>{clearTimeout(timer);set.delete(done);resolve();};const timer=setTimeout(done,ms);set.add(done);});}
 /** §5.4 case 3 "online": a `listen` outstanding, or one completed within the liveness window. */
 online(ep,now){return Boolean(ep.feature)||this.waiters.has(ep.id)||now-ep.lastSeen<=BOUNDS.onlineMs;}

 // ---- endpoint queues (§10.3 listen) --------------------------------------------------------------------------------
 /** Appends one event to an endpoint queue. False on overflow (the endpoint's `gap` is set). Payload-bearing events
  * (`sensitive`: SDP, candidates, `data`) are deleted on delivery or after 60 s (§1.2 item 3). */
 async push(tx,fx,endpointId,event,now,{sensitive=false}={}){
  const ep=await tx.get(K.endpoint(endpointId));if(!ep)return false;
  const row={...event,at:now,...sensitive?{expiresAt:now+BOUNDS.sensitiveMs}:{}},bytes=JSON.stringify(row).length+64;
  if(ep.q.count+1>BOUNDS.queueEvents||ep.q.bytes+bytes>BOUNDS.queueBytes){if(!ep.gap){ep.gap=true;await tx.put(K.endpoint(ep.id),ep);}return false;}
  const seq=ep.q.next;ep.q={next:seq+1,count:ep.q.count+1,bytes:ep.q.bytes+bytes};await tx.put(K.endpoint(ep.id),ep);
  await tx.put(K.queue(ep.id,seq),{...row,seq,bytes});fx.woken.add(ep.id);return true;
 }
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
  const deadline=this.now()+Math.min((input.wait??0)*1000,BOUNDS.listenWaitMs);
  for(let round=0;;round++){
   const now=this.now();
   const out=await this.commit(app.owner,async(tx,fx)=>{
    await this.bindOwner(tx,app.owner);const ep=await this.endpointAuth(tx,app,input,now);
    await this.dropQueue(tx,ep,{upTo:input.cursor??0,now,sensitive:true});
    const gap=ep.gap===true;ep.gap=false;ep.lastSeen=now;ep.expiresAt=now+BOUNDS.endpointIdleMs;await tx.put(K.endpoint(ep.id),ep);
    // §5.4 late delivery: an endpoint that starts `listen` (for a service, comes online) receives pending invites of
    // its routing set it has not had yet.
    if(round===0&&this.enabled(app.owner,app.clientId))await this.deliverPending(tx,fx,app.owner,await tx.get(K.endpoint(ep.id)),now);
    const events=[];for(const row of (await tx.list({prefix:K.queuePrefix(ep.id),limit:BOUNDS.listenPage})).values()){const {at,bytes,expiresAt,...event}=row;events.push(event);}
    return {cursor:events.length?events.at(-1).seq:Math.max(input.cursor??0,0),events,gap,id:ep.id};
   });
   if(out.events.length||out.gap||round>0||this.now()>=deadline){const {id,...rest}=out;return rest;}
   await this.waitFor(out.id,deadline-this.now());
  }
 }

 // ---- outbox (§9.3 at-least-once) -----------------------------------------------------------------------------------
 async outboxMeta(tx){const m=await tx.get(K.outboxSeq);return plain(m)?{seq:m.seq,count:m.count}:{seq:0,count:0};}
 /** Queues one batch for `to`. Control statements are stored unsigned and signed at drain time. False when the outbox
  * is full (message batches stop short of both caps by a reserve kept for control statements). `offers` carry the
  * offer tokens of the invites in this batch (§9.1): kept only in the outbox, never logged, deleted with the row. */
 async enqueue(tx,fx,{to,certificates=[],messages=[],controls=[],offers=[],until,invite}){
  const control=messages.length===0&&controls.length>0,meta=await this.outboxMeta(tx);
  const total=BOUNDS.outbox-(control?0:BOUNDS.outboxControlReserve),perPeer=BOUNDS.outboxPeer-(control?0:BOUNDS.outboxPeerControlReserve);
  if(meta.count>=total||(await tx.list({prefix:K.outboxPeerPrefix(to),limit:perPeer})).size>=perPeer)return false;
  const seq=meta.seq+1;await tx.put(K.outboxSeq,{seq,count:meta.count+1});
  await tx.put(K.outbox(to,seq),{seq,to:party(to),certificates,messages,controls,offers,until,attempts:0,notBefore:0,...typeof invite==='string'?{invite}:{}});fx.drain=true;return true;
 }
 async outboxRemove(key){await this.store.transaction(async tx=>{if(!await tx.get(key))return;await tx.delete(key);const meta=await this.outboxMeta(tx);await tx.put(K.outboxSeq,{seq:meta.seq,count:Math.max(0,meta.count-1)});});}
 /** Queues a control statement `end` (§6.2) for `leg` (null: the whole session) of `rec` to the peer entity. Own-entity
  * sessions end locally on both records instead (one writer). Never for an unclaimed recipient session (§6.2). */
 async enqueueControl(tx,fx,owner,rec,{leg=null,reason,now}){
  if(rec.own)return false;const peer=rec.role==='initiator'?rec.recipient:rec.initiator;
  return this.enqueue(tx,fx,{to:peer,controls:[{sid:rec.sid,leg,reason,aud:rec.peerIdentity,iat:seconds(now),jti:base64url(this.random.bytes(24))}],until:now+this.peerMaxLegSeconds*1000});
 }
 async drain(owner,{limit=32}={}){
  const now=this.now();let sent=0,pending=0,visited=0,more=false,signer=null,after=null;
  outer:for(;;){
   const page=await this.store.transaction(tx=>tx.list({prefix:K.outboxPrefix,limit:BATCH,...after?{startAfter:after}:{}}));let jumped=false;
   for(const [key,row] of page){
    if(visited>=limit){more=true;break outer;}
    visited++;after=key;const skip=()=>{pending++;after=key.slice(0,key.lastIndexOf('/')+1)+'￿';jumped=true;};
    if(row.until<=now){await this.outboxRemove(key);continue;}
    if(row.notBefore>now){skip();break;}
    try{
     let controls=[];if(row.controls.length){signer??=await this.signer(owner);if(!signer)throw new Error('no certification key');
      controls=await Promise.all(row.controls.map(c=>signControl({issuer:this.issuer,sub:owner,aud:c.aud,sid:c.sid,leg:c.leg,reason:c.reason,now:c.iat*1000,jti:c.jti,allowLoopback:this.allowLoopback},signer,this.crypto)));}
     await this.transport.deliver(this.self(owner),row.to,buildBatch({certificates:row.certificates,messages:row.messages,controls,offers:row.offers??[]}));
     await this.outboxRemove(key);sent++;
     if(row.invite)await this.inviteOutcome(row.invite,{accepted:true});
    }catch(error){
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
 async inviteOutcome(sid,{accepted}){
  try{await this.store.transaction(async tx=>{const rec=await tx.get(K.out(sid));if(!rec?.inviteRetry)return;
   if(!accepted){delete rec.inviteRetry;delete rec.inviteCompact;delete rec.offerToken;}
   else if(rec.inviteRetry.acked!==true)rec.inviteRetry={acked:true,n:0,at:this.now()+INVITE_RESEND_DELAYS[0]};else return;
   await tx.put(K.out(sid),rec);});}catch{/* the re-send is a MAY (§9.3) */}
 }
 // ---- inbound queue (§9.2: processing after step 1 MAY be asynchronous) ----------------------------------------------
 processInbox(owner,options){const run=(this.inboxRun??Promise.resolve()).then(()=>this.inboxPass(owner,options));this.inboxRun=run.catch(()=>null);return run;}
 async inboxPass(owner,{limit=16}={}){
  const rows=await this.store.transaction(tx=>tx.list({prefix:K.inboxPrefix,limit}));let processed=0;
  for(const [key,row] of rows){
   if(!row.dark)try{const elements=await batchStep1(parseBatch(row.batch),{issuer:this.issuer,now:seconds(row.at),parseCertificate:parseLegCertificate,parseControl,allowLoopback:this.allowLoopback,crypto:this.crypto});await this.process(owner,elements,row.at,{source:row.source});}catch{/* steps 2–8 are silent */}
   await this.store.transaction(async tx=>{if(!await tx.get(key))return;await tx.delete(key);const m=await tx.get(K.inboxMeta)??{seq:0,count:0,bytes:0};await tx.put(K.inboxMeta,{seq:m.seq,count:Math.max(0,m.count-1),bytes:Math.max(0,m.bytes-(row.bytes??0))});});
   processed++;
  }
  return {processed,more:rows.size===limit};
 }

 // ---- sessions: shared helpers ----------------------------------------------------------------------------------------
 async twinOf(tx,rec){return rec.own?tx.get(rec.role==='initiator'?K.in(rec.initiator,rec.sid):K.out(rec.sid)):null;}
 keyOf(rec){return rec.role==='initiator'?K.out(rec.sid):K.in(rec.initiator,rec.sid);}
 audience(rec){return rec.role==='initiator'?[rec.mine.endpoint]:rec.claim?[rec.claim.endpoint]:[...rec.delivered];}
 /**
  * Ends a live record (mutating; the caller writes it): the transition, a `state` event to this entity's endpoints, the
  * twin of an own-entity session, and (when `control` is given) a control statement to the peer. An unclaimed
  * recipient record ends silently towards the initiator (§8.5): callers pass no `control` for it, and the invite
  * payload (`context`) is deleted at end or claim (§1.2 item 3). Releases or keeps an open offer's reserved use.
  */
 async end(tx,fx,owner,rec,event,{now,reason,control,controlStatement=null,silent=false,twin=true}={}){
  if(!canTransition(rec.state,event))return false;const wasPending=rec.state==='pending'&&!rec.claim;transition(rec,event,{now,reason});
  if(fx)(fx.relayEnded??=[]).push(this.keyOf(rec));
  if(!silent){const state=['timeout','expired'].includes(rec.endReason)?'expired':'ended';for(const id of this.audience(rec))await this.push(tx,fx,id,{type:'state',sid:rec.sid,state,...controlStatement?{control:controlStatement}:{}},now);}
  if(rec.role==='recipient'){delete rec.invite;delete rec.context;if(wasPending)await this.releaseUse(tx,rec);await this.forgetAdmitted(tx,rec);}
  if(rec.role==='initiator'){delete rec.inviteCompact;delete rec.inviteRetry;delete rec.offerToken;}
  if(control)await this.enqueueControl(tx,fx,owner,rec,{leg:control.leg??null,reason:control.reason,now});
  if(rec.own&&twin){const other=await this.twinOf(tx,rec);if(other&&isLive(other)){await this.end(tx,fx,owner,other,canTransition(other.state,event)?event:'revoke',{now,reason:rec.endReason,silent,twin:false});await tx.put(this.keyOf(other),other);}}
  return true;
 }
 /** Ends a recipient record by the rules of its state: silently when unclaimed (§8.5), with a control otherwise. */
 async endRecord(tx,fx,owner,key,rec,{now,event='revoke',reason='revoked',control='revoked'}){
  if(!isLive(rec))return false;
  const unclaimed=rec.role==='recipient'&&rec.state==='pending'&&!rec.claim;
  await this.end(tx,fx,owner,rec,event,{now,reason,...unclaimed||!control?{}:{control:{leg:null,reason:control}}});await tx.put(key,rec);return true;
 }
 async delegateFree(tx,jkt){return !await tx.get(K.delegate(jkt));}
 async recordDelegate(tx,jkt,sid,now){await tx.put(K.delegate(jkt),{sid,until:now+SESSION_MAX_MS+BOUNDS.delegateMs});}
 async certFor({owner,app,rec,role,delegate,now}){
  const signer=await this.signer(owner);if(!signer)unavailable();
  const identity=await this.identity(this.self(owner));if(!identity)unavailable();
  const client=app.feature?{client_id:this.issuer,origin:this.issuer,feature:app.feature}:{client_id:app.clientId,origin:app.origin,feature:null};
  return signLegCertificate({issuer:this.issuer,sub:owner,identity,aud:rec.peerIdentity,sid:rec.sid,role,kind:rec.kind,profile:rec.profile,client,delegate,aep:await this.ownAep(owner),now,lifetime:this.maxLegSeconds,maxSeconds:this.maxLegSeconds,sessionEndsAt:seconds(rec.endsAt),allowLoopback:this.allowLoopback},signer,this.crypto);
 }

 // ---- pairings: records and coverage (§5.8) --------------------------------------------------------------------------
 async pairingRows(tx){return [...(await tx.list({prefix:K.pairingPrefix,limit:BOUNDS.pairings+1})).values()].filter(plain);}
 /** Which side of a pairing covers `ep` ('local' or 'peer', the latter only for an own-entity pairing), or null. */
 pairingSideOf(p,ep){if(sideCovers(p.local,ep))return 'local';if(p.peer.self&&sideCovers(p.peer.self,ep))return 'peer';return null;}
 pairingEntry(p,ep){return {id:p.id,state:p.state,kind:structuredClone(p.kind),side:this.pairingSideOf(p,ep),opens:p.opens,peer:p.peer.self?{client_id:this.pairingSideOf(p,ep)==='local'?p.peer.self.client_id:p.local.client_id}:{principal:party(p.peer.principal)},expires_at:p.expires_at===null?null:seconds(p.expires_at)};}
 async peerIndexKey(principal,line){return K.pairingPeer(await digest(this.crypto,JSON.stringify(['pairing-peer',principalKey(principal),line])));}
 /** Whether a pairing pinned at `p.kind` covers an invite at `ref` (§5.8 "Kind versions"): equal, or a later additive
  * version that adds no disclosure. */
 async pairingCoversVersion(p,ref){
  if(p.kind.artefact!==ref.artefact)return false;if(sameKind(p.kind,ref))return true;
  if(ref.version<p.kind.version||!await this.additive(p.kind,ref))return false;
  const a=await this.heldKind(p.kind),b=await this.heldKind(ref);return Boolean(a&&b)&&!addsDisclosure(a,b);
 }
 /** The live own-entity pairing covering (initiating endpoint → target endpoint) for `ref`, whose initiating side may
  * open (§5.4 case 4, §5.5), or null. */
 async ownPairingFor(tx,initiating,target,ref,now){
  for(const p of await this.pairingRows(tx)){
   if(p.state!=='live'||!p.peer.self||p.expires_at!==null&&p.expires_at<=now||p.kind.artefact!==ref.artefact)continue;
   const forward=sideCovers(p.local,initiating)&&sideCovers(p.peer.self,target)&&mayOpen(p,'local'),backward=sideCovers(p.peer.self,initiating)&&sideCovers(p.local,target)&&mayOpen(p,'peer');
   if((forward||backward)&&await this.pairingCoversVersion(p,ref))return p;
  }
  return null;
 }
 /** The one cross-entity pairing for (peer principal, line), any state, or null (§5.8 "at most one"). */
 async relationPairing(tx,principal,line){const id=await tx.get(await this.peerIndexKey(principal,line));const p=typeof id==='string'?await tx.get(K.pairing(id)):null;return p&&p.peer.principal&&samePrincipal(p.peer.principal,principal)&&p.kind.artefact===line?p:null;}
 async notifyPairing(tx,fx,owner,p,now,state){
  for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values())if(ep.expiresAt>now&&this.pairingSideOf(p,ep))await this.push(tx,fx,ep.id,{type:'pairing',sid:null,pairing:{...this.pairingEntry(p,ep),...state?{state}:{}}},now);
 }
 /** Deletes a pairing (§5.8 "Revocation and clearing"): its claimed sessions end with `revoked`, its pending invites
  * silently (§14.2), covered endpoints get a `pairing` event with state `deleted`. Never parks it as pending. */
 async deletePairing(tx,fx,owner,p,now){
  if(!await tx.get(K.pairing(p.id)))return false;
  await this.notifyPairing(tx,fx,owner,p,now,'deleted');
  await tx.delete(K.pairing(p.id));if(p.peer.principal){const k=await this.peerIndexKey(p.peer.principal,p.kind.artefact);if(await tx.get(k)===p.id)await tx.delete(k);}
  for(const prefix of [K.outPrefix,K.inPrefix])for(const [key,rec] of await tx.list({prefix,limit:4096}))if(isLive(rec)&&rec.pairingId===p.id)await this.endRecord(tx,fx,owner,key,rec,{now});
  return true;
 }

 // ---- routing (§5.4) --------------------------------------------------------------------------------------------------
 /** §5.4 eligibility of `ep` for an invite of `ref`: registered for the kind, its handler approved at a version that
  * admits the invite's, live. Returns the approval ({ref, body, approval}) or null. */
 async eligible(tx,owner,ep,ref,now=this.now()){
  if(!ep||!(ep.expiresAt>now)||!ep.kinds.includes(ref.artefact))return null;
  // §5.4 "its connection or enablement is live": checked here, not only by the connection-end cleanup.
  if(!await this.endpointLive(tx,owner,ep))return null;
  const a=await this.approvalFor(owner,ep,ref.artefact,tx);if(!a||!await this.admits(a.ref,ref))return null;return a;
 }
 /** Whether `ep` is service-class (§2): a provider feature, or an app endpoint of a designated service entity that was
  * not registered in member context. */
 async serviceClass(tx,owner,ep){if(ep.feature)return true;if(ep.memberContext)return false;const s=await tx.get(K.service);return s?.designated===true&&await this.entityIs(owner)==='organization';}
 /**
  * The routing set of a recipient record (§5.4), at most 16 most recently active first: eligible endpoints of the one
  * app its basis fixes, never the initiator's own endpoint. `rec.route` was fixed at admission:
  *   {case:'own', clientId, feature, target?, initiatorEndpoint}   cases 1 and 2
  *   {case:'ownPairing', pairing, target, initiatorEndpoint}        case 4, own entity
  *   {case:'offer', digest}                                         case 3
  *   {case:'relation', pairing}                                     case 4, another entity
  */
 async routingSet(tx,owner,rec,now){
  const r=rec.route,ref=rec.kind,out=[];if(!r)return out;
  const add=async ep=>{if(ep&&ep.id!==r.initiatorEndpoint&&await this.eligible(tx,owner,ep,ref,now))out.push(ep);};
  if(r.case==='own'){
   if(r.target){const t=await tx.get(K.endpoint(r.target));if(t&&t.clientId===r.clientId&&(t.feature??null)===(r.feature??null))await add(t);}
   else for(const ep of await endpointsFor(tx,{line:ref.artefact,now}))if(ep.clientId===r.clientId&&(ep.feature??null)===(r.feature??null))await add(ep);
  }else if(r.case==='ownPairing'){
   const p=await tx.get(K.pairing(r.pairing)),t=await tx.get(K.endpoint(r.target)),initiating=await tx.get(K.endpoint(r.initiatorEndpoint))??r.initiatorSnapshot;
   if(p&&p.state==='live'&&t&&initiating&&(await this.ownPairingFor(tx,initiating,t,ref,now))?.id===p.id)await add(t);
  }else if(r.case==='offer'){
   const o=await tx.get(K.offer(r.digest));if(!o)return out;
   const app=ep=>ep.clientId===o.clientId&&(ep.feature??null)===(o.feature??null);
   if(o.service){for(const ep of await endpointsFor(tx,{line:ref.artefact,now}))if(app(ep)&&this.online(ep,now))await add(ep);}
   else{const minter=await tx.get(K.endpoint(o.endpoint));if(minter&&app(minter))await add(minter);if(!out.length)for(const ep of await endpointsFor(tx,{line:ref.artefact,now}))if(app(ep))await add(ep);}
  }else if(r.case==='relation'){
   const p=await tx.get(K.pairing(r.pairing));if(!p||p.state!=='live'||!p.peer.principal||!samePrincipal(p.peer.principal,rec.initiator)||!mayOpen(p,'peer')||p.expires_at!==null&&p.expires_at<=now||!await this.pairingCoversVersion(p,ref))return out;
   for(const ep of await endpointsFor(tx,{line:ref.artefact,now}))if(sideCovers(p.local,ep))await add(ep);
  }
  return out.sort((a,b)=>b.lastSeen-a.lastSeen||(a.id<b.id?-1:1)).slice(0,BOUNDS.fanout);
 }
 /** The `listen` projection of a recipient record for one endpoint (§10.3). The offer token is never in it. */
 async projection(tx,owner,rec,ep,approval,now){
  const r=rec.route,body=approval.body;
  let context=rec.context??null;if(context!==null&&approval.ref.version<rec.kind.version)context=projectContext(context,body);
  let autoConnect=false,offerMatch=false,paired=false;
  if(rec.own){
   const initiating=await tx.get(K.endpoint(r.initiatorEndpoint))??r.initiatorSnapshot;
   if(r.case==='own'&&body.session.parties==='self'&&approval.approval.autoConnect===true&&rec.initiatorClient.client_id===ep.clientId&&!ep.feature)autoConnect=true;
   if(initiating){const p=await this.ownPairingFor(tx,initiating,ep,rec.kind,now);if(p){autoConnect=true;paired=true;}}
  }else if(r.case==='offer'){const o=await tx.get(K.offer(r.digest));offerMatch=Boolean(o)&&(o.service||o.endpoint===ep.id);}
  else if(r.case==='relation'){const p=await tx.get(K.pairing(r.pairing));paired=Boolean(p)&&p.state==='live'&&sideCovers(p.local,ep)&&mayOpen(p,'peer')&&samePrincipal(p.peer.principal,rec.initiator);}
  return {initiator:party(rec.initiator),...rec.handle?{handle:rec.handle}:{},origin:rec.initiatorClient.origin,client_id:rec.initiatorClient.client_id,feature:rec.initiatorClient.feature,reported_by:rec.initiator.iss===this.issuer?null:new URL(rec.initiator.iss).origin,
   kind:structuredClone(rec.kind),profile:rec.profile,params:structuredClone(rec.params),context,basis:r.case==='own'?'self':r.case==='ownPairing'||r.case==='relation'?'pairing':'offer',auto_connect:autoConnect,offer_match:offerMatch,paired};
 }
 /** Delivers a pending recipient record to `targets` it has not reached yet: an `invite` event with the projection, the
  * fan-out index and a doorbell. Colliding `sid`s are never delivered to one endpoint (§8.2). */
 async deliverTo(tx,fx,owner,key,rec,targets,now){
  let n=0;
  for(const ep of targets){
   if(rec.delivered.includes(ep.id)||rec.delivered.length>=BOUNDS.fanout)continue;
   const taken=await tx.get(K.delivered(ep.id,rec.sid));if(taken&&taken.key!==key)continue;
   const approval=await this.eligible(tx,owner,ep,rec.kind,now);if(!approval)continue;
   const projection=await this.projection(tx,owner,rec,ep,approval,now);
   if(await this.push(tx,fx,ep.id,{type:'invite',sid:rec.sid,invite:rec.invite,certificate:rec.theirs.certificate,projection},now,{sensitive:rec.profile==='webrtc'&&rec.params?.offer!==null})){
    rec.delivered.push(ep.id);await tx.put(K.delivered(ep.id,rec.sid),{key});n++;
    if(ep.push)fx.doorbells.push({endpoint:ep.id,subscription:ep.push,answerBy:rec.answerBy});
   }
  }
  return n;
 }
 /** §5.4 late delivery to one endpoint: every pending, unclaimed recipient record whose routing set now includes it. */
 async deliverPending(tx,fx,owner,ep,now){
  if(!ep)return;
  for(const [key,rec] of await tx.list({prefix:K.inPrefix,limit:4096})){
   if(rec.state!=='pending'||rec.claim||!(rec.answerBy>now)||rec.delivered.includes(ep.id)||!rec.invite)continue;
   const set=await this.routingSet(tx,owner,rec,now);
   if(set.some(e=>e.id===ep.id)&&await this.deliverTo(tx,fx,owner,key,rec,[ep],now))await tx.put(key,rec);
  }
 }

 // ---- open (§5.1, §10.2) ----------------------------------------------------------------------------------------------
 async resolveRecipient(to){
  if(typeof to==='string'){if(!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(to)||typeof this.keys.resolveHandle!=='function')notFound();let p=null;try{p=await this.keys.resolveHandle(to);}catch{p=null;}if(!p||!principalValid(party(p),this.allowLoopback))notFound();return party(p);}
  if(!principalValid(to,this.allowLoopback))invalid('Choose who to connect with.');return party(to);
 }
 /** §5.1 items 3 to 6 against the approved kind: parties, profile and its kind parameters, and the basis. */
 checkKind(body,{own,profile,basis}){
  if(!partiesAdmit(body,{own}))invalid('This kind cannot connect with that party.');
  if(!profileValid(profile)||!profileAllowed(body,profile))invalid('This profile is not allowed for this kind.');
  if(!basisAllowed(body,basis))invalid('This kind does not allow that basis.');
 }
 /** The recipient issuer check (§5.1): `unsupported_peer` for a declaration without the profile, a public fact. */
 peerSupports(owner,clientId,to,profile){
  if(to.iss===this.issuer)return;
  if(!this.flag(owner,SIGNALING_FOREIGN_FLAG,clientId)||this.transport.foreign!==true)fail('unsupported_peer','That provider does not support signaling.',400);
  let profiles=null;try{profiles=this.keys.profiles?.(party(to))??null;}catch{profiles=null;}
  if(Array.isArray(profiles)&&!profiles.includes(profile))fail('unsupported_peer','That provider does not support signaling.',400);
 }
 async open(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);
  exact(input,['endpoint','to','kind','profile','params','delegate'],['basis','target','endpoint_secret']);
  if(!lineValid(input.kind)||!profileValid(input.profile)||!inviteParamsShape(input.profile,input.params))invalid();
  const to=await this.resolveRecipient(input.to),self=this.self(owner),own=samePrincipal(to,self);
  const approved=await this.requireApproval(app,input.kind);
  let basis=null,offerToken=null;
  if(input.basis!==undefined){
   if(own)invalid('An own-entity session takes no basis.');
   if(plain(input.basis)&&Object.keys(input.basis).join()==='offer'&&offerTokenValid(input.basis.offer)){basis='offer';offerToken=input.basis.offer;}
   else if(plain(input.basis)&&Object.keys(input.basis).join()==='relation'&&input.basis.relation==='pairing')basis='relation';
   else invalid('Unsupported basis.');
  }else if(!own)invalid('A session with another entity needs an offer or a pairing.');// `none` is reserved (§15)
  if(input.target!==undefined&&(!own||typeof input.target!=='string'||!ENDPOINT_ID.test(input.target)))invalid('A target is one of your own endpoints.');
  this.peerSupports(owner,app.clientId,to,input.profile);
  const delegate=await delegatePublicJwk(input.delegate,this.crypto);if(!delegate)invalid('A P-256 leg key is required.');
  const jkt=await jwkThumbprint(delegate.jwk,this.crypto);
  // §5.1 items 6 and 7, and the own-entity target (§5.4 cases 1 and 4), against this entity's own records only.
  const now0=this.now();
  const plan=await this.store.transaction(async tx=>{
   await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now0);
   if(own){
    if(input.target===undefined){this.checkKind(approved.body,{own,profile:input.profile,basis:'self'});return {ep,route:'own'};}
    const t=await tx.get(K.endpoint(input.target));if(!t||t.id===ep.id||!(t.expiresAt>now0)||!t.kinds.includes(input.kind))invalid('A target is one of your own eligible endpoints.');
    if(t.clientId===ep.clientId&&(t.feature??null)===(ep.feature??null)){this.checkKind(approved.body,{own,profile:input.profile,basis:'self'});return {ep,route:'own',target:t.id};}
    const p=await this.ownPairingFor(tx,ep,t,approved.ref,now0);if(!p)invalid('A target is one of your own eligible endpoints.');
    // An own-entity pairing allows parties `self` or `any` (§5.8) and counts as the `pairing` basis (§5.1 item 6).
    if(!['self','any'].includes(approved.body.session.parties))invalid('This kind cannot connect with that party.');
    if(!profileAllowed(approved.body,input.profile)||!basisAllowed(approved.body,'pairing'))invalid('This kind does not allow that basis.');
    return {ep,route:'ownPairing',target:t.id,pairing:p.id};
   }
   this.checkKind(approved.body,{own,profile:input.profile,basis:basis==='relation'?'pairing':'offer'});
   if(basis==='relation'){const p=await this.relationPairing(tx,to,input.kind);
    if(!p||p.state!=='live'||p.expires_at!==null&&p.expires_at<=now0||!sideCovers(p.local,ep)||!mayOpen(p,'local')||!await this.pairingCoversVersion(p,approved.ref))invalid('No pairing lets this app open to that party.');
    return {ep,route:'relation',pairing:p.id};}
   return {ep,route:'offer'};
  });
  // §5.1: the recipient's certification keys, an initiator-initiated fetch (never on a federation request path), spent
  // from a per-entity budget only when they are not already held.
  if(to.iss!==this.issuer&&!(await this.peerKeys(to)).length){
   const admitted=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);return takeLimits(tx,[{name:'warms',parts:[owner]}],this.now(),this.crypto);});
   if(!admitted)limited();try{await this.keys.warm?.(to);}catch{/* answered below */}
  }
  const now=this.now(),peerKeys=await this.peerKeys(to),peerIdentity=await this.identity(to);
  if(!peerKeys.length||!peerIdentity){let unsupported=false;try{unsupported=to.iss!==this.issuer&&this.keys.unsupported?.(party(to))===true;}catch{unsupported=false;}if(unsupported)fail('unsupported_peer','That provider does not support signaling.',400);unavailable();}
  // §5.1: the recipient issuer's declared profiles, re-checked after the initiator-initiated fetch above (the first
  // `open` toward an issuer whose manifest was not yet held must still refuse a profile it does not declare).
  this.peerSupports(owner,app.clientId,to,input.profile);
  const sid=base64url(this.random.bytes(16)),policy=await this.store.transaction(readPolicy);
  const rec={v:2,sid,role:'initiator',state:'pending',own,initiator:self,recipient:to,peerIdentity,kind:structuredClone(approved.ref),profile:input.profile,params:structuredClone(input.params),basis:own?(plan.route==='ownPairing'?'pairing':'self'):basis,createdAt:now,answerBy:now+ANSWER_MAX_MS,endsAt:now+SESSION_MAX_MS,
   mine:{endpoint:plan.ep.id,clientId:app.clientId,origin:app.origin,feature:app.feature??null,clientSession:app.clientSession??null,jkt,delegate:delegate.jwk,certificate:null,exp:0,certSent:null,order:newLeg(),rate:null},theirs:null,
   ip:ipPolicyFor(policy,{crossEntity:!own}),peerKeys:pinKeys(peerKeys),...plan.target?{target:plan.target}:{},...plan.pairing?{pairingId:plan.pairing}:{},
   ...offerToken?{offerToken,offerDigest:await offerDigest(offerToken,this.crypto)}:{},controls:[],inviteSent:false};
  const cert=await this.certFor({owner,app,rec,role:'initiator',delegate:delegate.jwk,now});rec.mine.certificate=cert.certificate;rec.mine.exp=cert.exp;
  await this.store.transaction(async tx=>{
   await this.bindOwner(tx,owner);if(await tx.get(K.closed))notFound();await this.endpointAuth(tx,app,input,now);
   if(!await this.delegateFree(tx,jkt))invalid('This leg key was already used.');
   let open=0;for(const r of (await tx.list({prefix:K.outPrefix,limit:4096})).values())if(isLive(r))open++;
   // §13.1 "Own devices": own-entity `open` calls count against the own-device window, not the `open` window.
   if(open>=BOUNDS.initiatorOpen||!await takeLimits(tx,[own?{name:'self',parts:['open']}:{name:'opens',parts:[owner]}],now,this.crypto))limited();
   await tx.put(K.out(sid),rec);await this.recordDelegate(tx,jkt,sid,now);
  });
  if(to.iss!==this.issuer)this.track(to);
  return {sid,certificate:cert.certificate,expires_at:cert.exp,peer_keys:peerKeys};
 }

 // ---- offers (§5.7, §10.2 offer, revoke_offer) ------------------------------------------------------------------------
 async offer(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);
  exact(input,['endpoint','kind','profile','expires_in'],['principals','uses','endpoint_secret']);
  if(!lineValid(input.kind)||!profileValid(input.profile)||!Number.isSafeInteger(input.expires_in))invalid();
  const self=this.self(owner),bound=input.principals!==undefined;
  if(bound&&(!Array.isArray(input.principals)||input.principals.length<1||input.principals.length>BOUNDS.offerPrincipals||!input.principals.every(p=>principalValid(p,this.allowLoopback))||new Set(input.principals.map(principalKey)).size!==input.principals.length||input.principals.some(p=>samePrincipal(p,self))))invalid('Name 1 to 16 other principals.');
  if(bound&&input.uses!==undefined&&input.uses!==1)invalid('A bound offer is single-use.');
  const approved=await this.requireApproval(app,input.kind);
  this.checkKind(approved.body,{own:false,profile:input.profile,basis:'offer'});
  // A cross-entity initiator pins this entity's certification keys before its `open` is admitted (§5.1). Certification
  // keys are minted on first use, so an entity that only receives would have none published: minting an offer is the
  // first moment another entity is expected to open, so the key exists from here on (multi-provider simulation finding).
  if(!await this.signer(owner))unavailable();
  const now=this.now();
  const service=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);return {ep,service:await this.serviceClass(tx,owner,ep)};});
  const maxUses=service.service?BOUNDS.offerUsesService:BOUNDS.offerUsesPerson,uses=bound?1:input.uses??1;
  if(!bound&&(!Number.isSafeInteger(uses)||uses<1||uses>maxUses))invalid('Too many uses for this offer.');
  const maxSeconds=service.service?(bound?BOUNDS.offerServiceBoundSeconds:BOUNDS.offerServiceOpenSeconds):BOUNDS.offerPersonSeconds;
  if(input.expires_in<BOUNDS.offerMinSeconds||input.expires_in>maxSeconds)invalid('This expiry is not allowed.');
  for(const p of bound?input.principals:[])this.peerSupports(owner,app.clientId,party(p),input.profile);
  const principals=bound?input.principals.map(party):[null],tokens=principals.map(()=>base64url(this.random.bytes(32))),expiresAt=now+input.expires_in*1000;
  const digests=await Promise.all(tokens.map(t=>offerDigest(t,this.crypto)));
  await this.store.transaction(async tx=>{
   await this.bindOwner(tx,owner);if(await tx.get(K.closed))notFound();const ep=await this.endpointAuth(tx,app,input,now);
   let entity=0,perApp=0;for(const [,o] of await this.offerRows(tx))if(o.expiresAt>now&&!o.revoked){entity++;if(o.clientId===app.clientId&&(o.feature??null)===(app.feature??null))perApp++;}
   if(entity+principals.length>BOUNDS.offersPerEntity||perApp+principals.length>BOUNDS.offersPerApp)limited();
   if(!await takeLimits(tx,[{name:'mint',parts:[app.feature??app.clientId],amount:principals.length}],now,this.crypto))limited();
   for(let i=0;i<principals.length;i++)await tx.put(K.offer(digests[i]),{v:1,digest:digests[i],principal:principals[i],kind:structuredClone(approved.ref),profile:input.profile,endpoint:ep.id,clientId:app.clientId,feature:app.feature??null,service:service.service,uses,spent:0,reserved:0,expiresAt,createdAt:now,admitted:[]});
  });
  // §5.7 key warming: issuer-level metadata only, never a named principal's identity document or keys.
  for(const iss of new Set(principals.filter(Boolean).map(p=>p.iss)))if(iss!==this.issuer)try{this.keys.warmIssuer?.(iss);}catch{/* best effort */}
  return {offers:principals.map((p,i)=>({principal:p,offer:tokens[i]})),expires_at:seconds(expiresAt)};
 }
 async revokeOffer(actor,input){
  const app=this.app(actor),owner=app.owner;exact(input,['endpoint'],['offers','endpoint_secret']);
  if(input.offers!==undefined&&(!Array.isArray(input.offers)||input.offers.length>BOUNDS.offersPerEntity||input.offers.some(t=>typeof t!=='string'||t.length>64)))invalid();
  const digests=input.offers?await Promise.all(input.offers.filter(offerTokenValid).map(t=>offerDigest(t,this.crypto))):null,now=this.now();
  return this.commit(owner,async(tx,fx)=>{
   await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);
   for(const [key,o] of await this.offerRows(tx)){
    const mine=o.clientId===app.clientId&&(o.feature??null)===(app.feature??null);
    if(mine&&(digests?digests.includes(o.digest):o.endpoint===ep.id))await this.endOffer(tx,fx,owner,key,o,now);
   }
   return {};
  });
 }
 /** Ends an offer (§5.7 "What ends an offer"): its record goes (exhausted ones keep their hash until expiry so a token
  * is never reusable; revoked and expired ones are deleted), and every pending, unclaimed session it admitted ends silently. A claim recorded first is
  * unaffected; an end recorded first makes a later claim fail with `claimed` (both decided in this writer). */
 async endOffer(tx,fx,owner,key,o,now){
  for(const inKey of o.admitted??[]){const rec=await tx.get(inKey);if(rec&&rec.state==='pending'&&!rec.claim){await this.end(tx,fx,owner,rec,'revoke',{now,reason:'revoked'});await tx.put(inKey,rec);}}
  // The record goes at once: a random 256-bit token whose digest is unknown admits nothing (classified unbased), so a
  // revoked or expired offer needs no retained hash, and scans never accumulate dead rows (an exhausted, unended
  // offer keeps its record, which counts as live, until it expires).
  await tx.delete(key);
 }
 /** Releases an open offer's reserved use for a session that ends unclaimed or is declined (§5.2). */
 async releaseUse(tx,rec){if(rec.route?.case!=='offer'||rec.offerUse!=='reserved')return;const o=await tx.get(K.offer(rec.route.digest));if(o){o.reserved=Math.max(0,o.reserved-1);await tx.put(K.offer(o.digest),o);}rec.offerUse='released';}
 async forgetAdmitted(tx,rec){if(rec.route?.case!=='offer')return;const o=await tx.get(K.offer(rec.route.digest));const key=this.keyOf(rec);if(o&&o.admitted?.includes(key)){o.admitted=o.admitted.filter(k=>k!==key);await tx.put(K.offer(o.digest),o);}}
 /** An offer's live state for an invite (§5.2 "Verifying an offer basis"), read-only: the record or null. */
 offerAdmits(o,{line,profile,sender,self,now}){
  if(!o||o.revoked||!(o.expiresAt>now)||o.spent+o.reserved>=o.uses||o.kind.artefact!==line||o.profile!==profile)return false;
  if(o.principal===null)return !samePrincipal(sender,self);
  return samePrincipal(o.principal,sender);
 }

 // ---- claim (§8.2) ----------------------------------------------------------------------------------------------------
 async claim(actor,input){
  const app=this.app(actor),owner=app.owner;exact(input,['endpoint','sid','outcome','delegate'],['endpoint_secret']);
  if(!['accept','decline'].includes(input.outcome)||typeof input.sid!=='string'||!SID.test(input.sid))invalid();
  if(input.outcome==='accept')this.requireFlag(owner,app.clientId);// a decline is narrowing (never gated)
  const delegate=await delegatePublicJwk(input.delegate,this.crypto);if(!delegate)invalid('A P-256 leg key is required.');
  const jkt=await jwkThumbprint(delegate.jwk,this.crypto),now=this.now();
  const peek=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);const dl=await tx.get(K.delivered(ep.id,input.sid));return dl?await tx.get(dl.key):null;});
  if(!peek)notFound();
  // §10.1: an `accept` claim checks the handler approval live; a decline is not gated by it.
  if(input.outcome==='accept'){const a=await this.requireApproval(app,peek.kind.artefact);if(!await this.admits(a.ref,peek.kind))throw approvalRequired(this.issuer,app,peek.kind.artefact);}
  const won=await this.commit(owner,async(tx,fx)=>{
   const ep=await this.endpointAuth(tx,app,input,now),dl=await tx.get(K.delivered(ep.id,input.sid)),rec=dl?await tx.get(dl.key):null;if(!rec)notFound();
   // §5.7 L-1: an offer record ends at `expires_at`, at the moment of decision and not only when `tick` runs: a pending,
   // unclaimed session it admitted ends with it (silently), and this claim then fails like any claim after an end.
   if(rec.route?.case==='offer'&&rec.state==='pending'&&!rec.claim){const o=await tx.get(K.offer(rec.route.digest));if(o&&!(o.expiresAt>now)){await this.endOffer(tx,fx,owner,K.offer(o.digest),o,now);return {expired:true};}}
   if(!(rec.claim?.jkt===jkt)&&!await this.delegateFree(tx,jkt))invalid('This leg key was already used.');
   const r=decideClaim(rec,{endpoint:ep.id,jkt,outcome:input.outcome,now});
   if(!r.won){if(r.code==='not_delivered')notFound();fail('claimed','This session was already answered.',409);}
   if(!r.repeat){
    await this.recordDelegate(tx,jkt,rec.sid,now);
    rec.mine={endpoint:ep.id,clientId:app.clientId,origin:app.origin,feature:app.feature??null,clientSession:app.clientSession??null,jkt,delegate:delegate.jwk,certificate:null,exp:0,certSent:null,order:newLeg(),rate:null};
    rec.ip=ipPolicyFor(await readPolicy(tx),{crossEntity:!rec.own});
    // §5.2: an open offer's reserved use is spent only by an accept, and released by a decline.
    if(rec.route?.case==='offer'&&rec.offerUse==='reserved'){const o=await tx.get(K.offer(rec.route.digest));if(o){o.reserved=Math.max(0,o.reserved-1);if(input.outcome==='accept')o.spent++;o.admitted=(o.admitted??[]).filter(k=>k!==dl.key);await tx.put(K.offer(o.digest),o);}rec.offerUse=input.outcome==='accept'?'spent':'released';}
    for(const id of rec.delivered)if(id!==ep.id)await this.push(tx,fx,id,{type:'state',sid:rec.sid,state:'claimed'},now);
    delete rec.invite;delete rec.context;
   }
   await tx.put(dl.key,rec);return {key:dl.key,rec:structuredClone(rec)};
  });
  if(won.expired)fail('claimed','This session was already answered.',409);
  const cert=await this.certFor({owner,app,rec:won.rec,role:'recipient',delegate:delegate.jwk,now});
  await this.store.transaction(async tx=>{const rec=await tx.get(won.key);if(rec?.claim?.jkt===jkt&&rec.mine&&claimUsable(rec)){rec.mine.certificate=cert.certificate;rec.mine.exp=cert.exp;rec.mine.certSent=null;await tx.put(won.key,rec);}else fail('claimed','This session was already answered.',409);});
  return {certificate:cert.certificate,peer_keys:await this.peerKeys(won.rec.initiator)};
 }

 // ---- renew (§6.1) ----------------------------------------------------------------------------------------------------
 async renew(actor,input){
  const app=this.app(actor),owner=app.owner;this.requireFlag(owner,app.clientId);exact(input,['endpoint','sid'],['endpoint_secret']);
  const now=this.now(),found=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);return this.ownSession(tx,ep,input.sid);});
  if(!found||!isLive(found.rec)||!found.rec.mine?.certificate)notFound();
  await this.requireAdmits(app,found.rec.kind);
  const cert=await this.certFor({owner,app,rec:found.rec,role:found.rec.role,delegate:found.rec.mine.delegate,now});
  await this.store.transaction(async tx=>{const rec=await tx.get(found.key);if(rec&&isLive(rec)&&rec.mine?.jkt===found.rec.mine.jkt){rec.mine.certificate=cert.certificate;rec.mine.exp=cert.exp;rec.mine.certSent=null;await tx.put(found.key,rec);}else notFound();});
  return {certificate:cert.certificate};
 }
 async ownSession(tx,ep,sid){
  if(typeof sid!=='string'||!SID.test(sid))return null;
  const out=await tx.get(K.out(sid));if(out&&out.mine?.endpoint===ep.id)return {key:K.out(sid),rec:out};
  const dl=await tx.get(K.delivered(ep.id,sid)),rec=dl?await tx.get(dl.key):null;
  return rec&&rec.claim?.endpoint===ep.id?{key:dl.key,rec}:null;
 }

 // ---- send (§7, §16 on the sender's own provider) -------------------------------------------------------------------
 async send(actor,input){
  const app=this.app(actor),owner=app.owner;exact(input,['endpoint','sid','messages'],['endpoint_secret']);
  if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>LIMITS.batchMessages)invalid();
  let parsed;try{parsed=input.messages.map(m=>parseMessage(m,{allowLoopback:this.allowLoopback}));}catch{invalid('A message is invalid.');}
  const narrowing=parsed.every(m=>['end','cancel','decline'].includes(m.payload.type));// RTCw-M4: never gated
  if(!narrowing)this.requireFlag(owner,app.clientId);
  const now=this.now(),nowS=seconds(now);
  const found=await this.store.transaction(async tx=>{await this.bindOwner(tx,owner);const ep=await this.endpointAuth(tx,app,input,now);const s=await this.ownSession(tx,ep,input.sid);return s&&{...s,policy:await readPolicy(tx)};});
  if(!found||!found.rec.mine?.certificate)notFound();
  if(!narrowing)await this.requireAdmits(app,found.rec.kind);
  const rec0=found.rec,certificate={payload:parseLegCertificate(rec0.mine.certificate,{allowLoopback:this.allowLoopback}).payload},crossEntity=!rec0.own;
  const ip=stricterIp(rec0.ip,ipPolicyFor(found.policy,{crossEntity}));
  const prepared=[];let dataBytes=0;
  for(const m of parsed){
   const p=m.payload;
   try{await verifyMessage(m,certificate,{now:nowS,crypto:this.crypto});}catch{invalid('A message does not verify for this leg.');}
   if(p.type==='invite'){
    if(rec0.role!=='initiator'||!sameKind(p.body.kind,rec0.kind)||p.body.profile!==rec0.profile)invalid('The invite does not match this session.');
    const wantBasis=rec0.offerDigest?{offer_digest:rec0.offerDigest}:rec0.basis==='relation'?{relation:'pairing'}:null;
    if(JSON.stringify(p.body.basis)!==JSON.stringify(wantBasis))invalid('The invite basis does not match this session.');
    const body=await this.heldKind(rec0.kind);if(!body)invalid('The kind is not held.');
    if(p.body.context!==null)try{validateIntentData(body,p.body.context);}catch{invalid('The context does not match the kind.');}
   }
   if(['accept','decline'].includes(p.type)&&p.type!==(rec0.claim?.outcome==='accept'?'accept':'decline'))invalid('The answer does not match the claim.');
   if(p.type==='data')dataBytes+=dataPayloadBytes(p.body.payload);
   try{const candidates=validateMessageContent(p,{profile:rec0.profile,crossEntity});
    if(candidates.some(c=>!candidateAllowedByPolicy(c,ip,{crossEntity})))invalid('A candidate is not allowed by your IP privacy setting.');}
   catch(error){if(error instanceof AppFault)throw error;invalid('A message breaks the profile rules.');}
   prepared.push({m,p,digest:await payloadDigest(m.compact,this.crypto)});
  }
  return this.commit(owner,async(tx,fx)=>{
   const ep=await this.endpointAuth(tx,app,input,now),rec=await tx.get(found.key);if(!rec||rec.mine?.jkt!==rec0.mine.jkt||rec.mine.endpoint!==ep.id)notFound();
   if(dataBytes){
    // §3.5: 64 KiB of `data` per leg; §13.1: the sender's provider refuses its own endpoint's excess of the entity's
    // aggregate budget (pairing sessions also within the pairing sub-budget) with `rate_limited`.
    if(rec.mine.order.dataBytes+dataBytes>LIMITS.dataLegBytes)invalid('This leg has sent its data allowance.');
    if(!await takeLimits(tx,this.dataLimits(owner,rec,dataBytes),now,this.crypto))limited();
   }
   const out=[];let accepted=0;
   for(const {m,p,digest:d} of prepared){
    if(rec.state==='ended'&&!(p.type==='decline'&&rec.endReason==='declined'&&!rec.declineSent))break;
    const peerLeg=rec.theirs?.jkt;
    if(!messageAllowedBeforeClaim(p.type)&&rec.role==='initiator'&&!rec.theirs)invalid('Only the invite and cancel travel before the claim.');
    if(p.type==='data'&&rec.state!=='connected')invalid('Data travels only after the claim.');
    if(p.to!==null&&p.to!==peerLeg)invalid('The message names another leg.');
    if(!await this.legRate(tx,rec.mine,now))limited();
    if(p.seq>rec.mine.order.next)invalid('Messages must be sent in order.');
    const r=offerSeq(rec.mine.order,{seq:p.seq,digest:d,compact:m.compact,now});
    if(r.action==='duplicate')continue;
    if(r.action==='fail'){await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:rec.mine.jkt,reason:'failed'}});break;}
    accepted++;out.push(m.compact);
    if(p.type==='data')rec.mine.order.dataBytes+=dataPayloadBytes(p.body.payload);
    if(p.type==='invite'){rec.inviteSent=true;rec.answerBy=Math.min(p.body.answer_by*1000,now+ANSWER_MAX_MS);
     if(rec.recipient.iss!==this.issuer){rec.inviteCompact=m.compact;rec.inviteRetry={acked:false,n:0,at:null};}}
    if(p.type==='decline')rec.declineSent=true;
    if(p.type==='cancel')await this.end(tx,fx,owner,rec,'cancel',{now,silent:true,twin:false});
    if(p.type==='end')await this.end(tx,fx,owner,rec,'end',{now,silent:true,reason:'closed',twin:false});
   }
   if(out.length){
    const peer=rec.role==='initiator'?rec.recipient:rec.initiator,first=out.some(c=>parseMessage(c,{allowLoopback:this.allowLoopback}).payload.type==='invite');
    const certs=rec.mine.certSent!==rec.mine.certificate?[rec.mine.certificate]:[];rec.mine.certSent=rec.mine.certificate;
    const offers=first&&rec0.offerToken?[rec0.offerToken]:[];
    if(!await this.enqueue(tx,fx,{to:peer,certificates:certs,messages:out,offers,until:first?rec.answerBy:now+FORWARD_MS,...first&&rec.inviteRetry?{invite:rec.sid}:{}}))limited();
    // The holder's provider keeps the token only beside the invite for re-sending a foreign invite (§5.7, §9.3).
    if(first&&!rec.inviteRetry)delete rec.offerToken;
   }
   await tx.put(found.key,rec);return {accepted};
  });
 }
 /** Messages per leg: 256 per minute (RTC-11), kept on the leg itself. */
 async legRate(tx,leg,now){if(!leg.rate||leg.rate.resetAt<=now)leg.rate={count:0,resetAt:now+60000};if(leg.rate.count>=256)return false;leg.rate.count++;return true;}
 /** §13.1 aggregate `data` budget of the entity (what its legs send and receive), and the pairing sub-budget. */
 dataLimits(owner,rec,bytes){const pairing=Boolean(rec.pairingId);return [{name:'data',parts:[owner],max:BOUNDS.dataBytes,windowMs:BOUNDS.dataWindowMs,amount:bytes},...pairing?[{name:'data-pairing',parts:[owner],max:Math.floor(BOUNDS.dataBytes*BOUNDS.subBudgetShare),windowMs:BOUNDS.dataWindowMs,amount:bytes}]:[]];}

 // ---- ingest (§9.2 step 1 and the inbound queue) ----------------------------------------------------------------------
 /**
  * signaling.ingest (system): step 1 refuses the whole batch with `signaling_batch_invalid`. A batch that passes is
  * queued and answered `{accepted:true}` at once; steps 2–8 run later (processInbox), so neither the answer nor its
  * timing depends on them (§9.2, §12.1). A full queue answers `temporarily_unavailable` (503). `dark` marks a batch for
  * an entity whose own signaling flags are off: same step 1 and queue slot, removed unprocessed (RTCw-R1).
  */
 async ingest(actor,input){
  const owner=this.system(actor);exact(input,['batch'],['source','dark']);const now=this.now();
  if(input.dark!==undefined&&input.dark!==true)fail('signaling_batch_invalid','The batch is invalid.',400);
  const source=typeof input.source==='string'&&/^[A-Za-z0-9_:.-]{1,128}$/.test(input.source)?input.source:null;
  try{await batchStep1(parseBatch(input.batch),{issuer:this.issuer,now:seconds(now),parseCertificate:parseLegCertificate,parseControl,allowLoopback:this.allowLoopback,crypto:this.crypto});}
  catch(error){if(error instanceof SignalingWireFault)fail('signaling_batch_invalid','The batch is invalid.',400);throw error;}
  const text=typeof input.batch==='string'?input.batch:new TextDecoder().decode(input.batch),bytes=text.length+64;
  await this.store.transaction(async tx=>{
   const m=await tx.get(K.inboxMeta)??{seq:0,count:0,bytes:0};
   if(m.count+1>BOUNDS.inbox||m.bytes+bytes>BOUNDS.inboxBytes)unavailable();
   const seq=m.seq+1;await tx.put(K.inboxMeta,{seq,count:m.count+1,bytes:m.bytes+bytes});await tx.put(K.inbox(seq),input.dark?{dark:true,at:now,bytes}:{batch:text,at:now,bytes,...source?{source}:{}});
  });
  this.kick(owner,'inbox');
  return {accepted:true};
 }
 async process(owner,elements,now,{source=null}={}){
  const self=this.self(owner),selfIdentity=await this.identity(self);if(!selfIdentity)return;
  const certs=new Map(elements.certificates.map(c=>[c.payload.cnf.jkt,c]));
  // §9.2 step 3: senders whose keys are not held get a bounded background refresh scheduled; the first lane holds
  // invites whose offer_digest names a live offer of this entity (a read-only lookup, spending nothing, AMD-RV2).
  const senders=new Map(),note=(x,kid)=>{const id=JSON.stringify([x.payload.iss,x.payload.sub]),e=senders.get(id)??{p:{iss:x.payload.iss,sub:x.payload.sub},kids:new Set()};if(kid)e.kids.add(kid);senders.set(id,e);};
  for(const m of elements.messages)note(m);for(const c of elements.certificates)note(c,c.header.kid);for(const c of elements.controls)note(c,c.header.kid);
  for(const [,{p,kids}] of senders){const held=await this.peerKeys(p),missing=[...kids].find(kid=>!held.some(k=>k.kid===kid));if(held.length&&missing===undefined)continue;
   let lane=null;if(p.iss!==this.issuer)try{lane=await this.offerLane(p,elements,now);}catch{lane=null;}
   try{await this.keys.refresh?.(p,missing,{...source?{source}:{},...lane?{lane}:{}});}catch{/* best effort */}}
  const offers=new Map(elements.offers.map(o=>[o.digest,o.token]));
  for(const m of elements.messages){try{await this.processMessage(owner,self,selfIdentity,m,certs,offers,now);}catch{/* silent */}}
  for(const c of elements.controls){try{await this.processControl(owner,selfIdentity,c,now);}catch{/* silent */}}
 }
 async offerLane(sender,elements,now){
  // §9.2 step 3 lanes (AMD-RV2), read-only: only an offer that would admit this claimed sender (live, a free use, open or
  // bound to that principal) earns the priority lane, so reading someone else's bound offer buys no priority (RTCe F1).
  const self=this.self(await this.store.transaction(tx=>tx.get('owner')));
  for(const m of elements.messages){const p=m.payload;if(p.type!=='invite'||p.iss!==sender.iss||p.sub!==sender.sub||!p.body.basis?.offer_digest)continue;
   const o=await this.store.transaction(tx=>tx.get(K.offer(p.body.basis.offer_digest)));if(this.offerAdmits(o,{line:p.body.kind.artefact,profile:p.body.profile,sender,self,now}))return 'offer:'+p.body.basis.offer_digest.slice(0,43);}
  return null;
 }
 async processMessage(owner,self,selfIdentity,m,certs,offers,now){
  const p=m.payload,sender={iss:p.iss,sub:p.sub},nowS=seconds(now);if(p.aud!==selfIdentity)return;
  const inKey=K.in(sender,p.sid),outKey=K.out(p.sid);
  const [inRec,outRec]=await this.store.transaction(async tx=>[await tx.get(inKey),await tx.get(outKey)]);
  const batchCert=certs.get(p.leg);let side=batchCert?(batchCert.payload.role==='initiator'?'recipient':'initiator'):null;
  if(!side){if(inRec?.theirs?.jkt===p.leg)side='recipient';else if(outRec&&samePrincipal(outRec.recipient,sender)&&outRec.theirs?.jkt===p.leg)side='initiator';else return;}
  // Step 2 (no fetch): the session by (initiator origin principal, sid).
  const rec=side==='recipient'?inRec:outRec;
  if(side==='recipient'){if(p.type!=='invite'&&(!rec||rec.theirs?.jkt!==p.leg))return;if(p.type==='invite'&&rec)return;
   if(p.type==='invite'&&p.body.basis?.offer_digest&&!offers.has(p.body.basis.offer_digest))return;}
  else {if(!rec||!samePrincipal(rec.recipient,sender))return;const answer=p.seq===0&&['accept','decline'].includes(p.type);if(answer?p.to!==rec.mine.jkt:rec.theirs?.jkt!==p.leg)return;}
  // Step 3: the leg certificate against the sender's active certification keys AS ALREADY HELD (or pinned).
  const certCompact=batchCert?.compact??rec?.theirs?.certificate;if(!certCompact)return;
  const parsedCert=batchCert??parseLegCertificate(certCompact,{allowLoopback:this.allowLoopback});
  const keys=await this.peerKeys(sender),identity=await this.identity(sender);if(!keys.length||!identity)return;
  const verified=await verifyLegCertificate(parsedCert,{keys,expected:{aud:selfIdentity,sid:p.sid,role:side==='recipient'?'initiator':'recipient',...p.type==='invite'?{kind:p.body.kind,profile:p.body.profile}:{}},identity,now:nowS,maxSeconds:this.peerMax(sender),...rec?{sessionEndsAt:seconds(rec.endsAt)}:{},crypto:this.crypto});
  if(verified.payload.iss!==sender.iss||verified.payload.sub!==sender.sub||rec&&(!sameKind(verified.payload.kind,rec.kind)||verified.payload.profile!==rec.profile))return;
  // Step 4: the message signature under the certified delegate.
  await verifyMessage(m,verified,{now:nowS,crypto:this.crypto});
  const d=await payloadDigest(m.compact,this.crypto);
  if(side==='recipient'&&p.type==='invite'){if(await this.admitInvite(owner,self,{m,p,sender,verified,certCompact,digest:d,keys,now})===true)this.track(sender);return;}
  this.track(sender);
  return this.commit(owner,async(tx,fx)=>{
   const key=side==='recipient'?inKey:outKey,rec=await tx.get(key);if(!rec)return;
   if(!await this.epochOk(tx,sender,verified.payload.aep,now))return;
   const replyFailed=async leg=>{const sent=rec.failReplies??[];if(sent.includes(leg)||sent.length>=BOUNDS.controlReplies)return;rec.failReplies=[...sent,leg];await this.enqueueControl(tx,fx,owner,rec,{leg,reason:'failed',now});await tx.put(key,rec);};
   if(side==='initiator'&&p.seq===0&&['accept','decline'].includes(p.type)&&!rec.theirs){
    // §8.2: the first verified seq 0 answer becomes the recipient leg; an answer after the initiator's cancel, or a
    // later recipient leg, is answered with a control statement `end` (`failed`) for that leg (§8.4).
    if(rec.state!=='pending')return replyFailed(p.leg);
    rec.theirs={jkt:p.leg,certificate:certCompact,order:newLeg(),rate:null,delivered:false};delete rec.inviteCompact;delete rec.inviteRetry;delete rec.offerToken;
   } else if(side==='initiator'&&rec.theirs&&rec.theirs.jkt!==p.leg)return replyFailed(p.leg);
   if(rec.state==='ended')return;
   rec.peerKeys=pinKeys(keys,rec.peerKeys);
   if(batchCert&&rec.theirs)rec.theirs.certificate=certCompact;
   if(!await this.legRate(tx,rec.theirs,now))return;
   const r=offerSeq(rec.theirs.order,{seq:p.seq,digest:d,compact:m.compact,now});
   // §8.5: an unclaimed recipient record ends without any control statement (the initiator's session ends at answer_by).
   if(r.action==='fail')await this.end(tx,fx,owner,rec,'fail',{now,...silentEndable(rec)?{}:{control:{leg:rec.theirs.jkt,reason:'failed'}}});
   for(const item of r.ready){if(rec.state==='ended')break;const q=parseMessage(item.compact,{allowLoopback:this.allowLoopback}).payload;
    // §7.2 (RTCw-L4): before the claim only `invite` and `cancel` travel; anything else is dropped after step 5.
    if(side==='recipient'&&!rec.claim&&!messageAllowedBeforeClaim(q.type))continue;
    await this.applyPeerMessage(tx,fx,owner,rec,q,item.compact,now);}
   await tx.put(key,rec);
  });
 }
 async epochOk(tx,sender,aep,now,{record=true}={}){
  const row=await tx.get(K.aep(sender));if(row&&row.until>now&&aep<row.aep)return false;
  if(record)await tx.put(K.aep(sender),{aep:Math.max(aep,row&&row.until>now?row.aep:0),until:now+DAY});return true;
 }
 /** A verified message from the peer leg, in order (step 8 delivery). */
 async applyPeerMessage(tx,fx,owner,rec,p,compact,now){
  // AMD-RI3: `to` names this side's leg, or is null for invite and cancel; otherwise dropped (seq already consumed).
  if(p.to===null?!['invite','cancel'].includes(p.type):p.to!==rec.mine?.jkt)return;
  const certificate=!rec.theirs.delivered?rec.theirs.certificate:undefined;
  const deliver=async(sensitive=false)=>{const target=rec.role==='initiator'?rec.mine.endpoint:rec.claim?.endpoint;if(!target)return;
   if(!await this.push(tx,fx,target,{type:'message',sid:rec.sid,message:compact,...certificate?{certificate}:{}},now,{sensitive})){await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:null,reason:'failed'}});return;}
   rec.theirs.delivered=true;};
  const content=()=>{try{validateMessageContent(p,{profile:rec.profile,crossEntity:!rec.own});return true;}catch{return false;}};
  const claimedPeer=rec.role==='initiator'||rec.claim?.outcome==='accept';
  switch(p.type){
   case 'accept':if(rec.role==='initiator'&&rec.state==='pending'&&content()){transition(rec,'answer-accept',{now});await deliver(rec.profile==='webrtc'&&p.body.params.answer!==null);}return;
   case 'decline':if(rec.role==='initiator'&&rec.state==='pending'){await deliver();await this.end(tx,fx,owner,rec,'answer-decline',{now,silent:true});}return;
   case 'cancel':
    if(rec.role!=='recipient')return;
    if(rec.state==='connected'&&rec.claim?.outcome==='accept'){await deliver();await this.end(tx,fx,owner,rec,'cancel',{now});}// processed as end (closed), §8.4
    else await this.end(tx,fx,owner,rec,'cancel',{now});
    return;
   case 'end':if(rec.state==='connected'){await deliver();await this.end(tx,fx,owner,rec,'end',{now,reason:'closed'});}return;
   case 'sdp':case 'candidates':if(rec.state==='connected'&&claimedPeer&&content())await deliver(true);return;
   case 'data':{
    if(rec.state!=='connected'||!claimedPeer||!content())return;
    // §3.5, §13.1, §9.2 step 7: the per-leg 64 KiB cap and the entity's aggregate budget; excess ends the leg `failed`.
    const bytes=dataPayloadBytes(p.body.payload);
    if(rec.theirs.order.dataBytes+bytes>LIMITS.dataLegBytes||!await takeLimits(tx,this.dataLimits(owner,rec,bytes),now,this.crypto)){await this.end(tx,fx,owner,rec,'fail',{now,control:{leg:rec.theirs.jkt,reason:'failed'}});return;}
    rec.theirs.order.dataBytes+=bytes;await deliver(true);return;}
   default:return;
  }
 }
 /**
  * Steps 7 and 8 for an invite (§9.2): the local checks cheapest first (closed, duplicate, block, the kind's bases,
  * the basis, sid collision, capacity, the windows), then the host-wide limiter, handler eligibility and context
  * validation, then atomically: re-check, take an offer use (bound: spend; open: reserve) only with a nonempty routing
  * set, create the record, deliver. Every outcome is silent.
  */
 async admitInvite(owner,self,{m,p,sender,verified,certCompact,digest:d,keys,now}){
  if(!this.enabled(owner))return;// no new session while signaling is off for this entity
  const body=p.body,own=samePrincipal(sender,self),ref=body.kind,line=ref.artefact,key=K.in(sender,p.sid);
  const kind=await this.heldKind(ref);if(!kind)return;// §3.4: an unheld kind version is not delivered
  const initiatorClient={client_id:verified.payload.client.client_id,origin:verified.payload.client.origin,feature:verified.payload.client.feature};
  // The basis and its admission class (§5.2, §13.1).
  const wire=body.basis===null?(own?'self':'none'):body.basis.offer_digest?'offer':'relation';
  if(own&&wire!=='self')return;
  let out=null;if(own)out=await this.store.transaction(tx=>tx.get(K.out(p.sid)));
  if(own&&(!out||out.mine?.jkt!==p.leg))return;
  const ownPairing=own&&out.basis==='pairing';
  const kindBasis=own?(ownPairing?'pairing':'self'):wire==='offer'?'offer':'pairing';
  const gate=async(tx,{count})=>{
   if(await tx.get(K.closed))return null;
   if(await tx.get(key))return null;
   if(await isBlocked(tx,sender,{self}))return null;
   if(!await this.epochOk(tx,sender,verified.payload.aep,now,{record:false}))return null;
   // §3.4, §9.2 step 7: the kind's `bases` (and parties and profiles) at the held version, silently.
   if(wire!=='none'&&(!basisAllowed(kind,kindBasis)||!partiesAdmit(kind,{own})||!profileAllowed(kind,body.profile)))return null;
   let cls,route,offer=null,pairing=null,covered=1,endpoints=null;
   if(own){
    if(ownPairing){pairing=await tx.get(K.pairing(out.pairingId));if(!pairing)return null;cls='ownPairing';route={case:'ownPairing',pairing:pairing.id,target:out.target,initiatorEndpoint:out.mine.endpoint};endpoints=[out.mine.endpoint,out.target];}
    else{cls='self';route={case:'own',clientId:out.mine.clientId,feature:out.mine.feature??null,...out.target?{target:out.target}:{},initiatorEndpoint:out.mine.endpoint};}
    // The initiating endpoint as it was at open, for coverage after it unregisters.
    route.initiatorSnapshot={id:out.mine.endpoint,clientId:out.mine.clientId,feature:out.mine.feature??null,clientSession:out.mine.clientSession??null};
   }else if(wire==='none'){cls='unbased';// a cross-entity invite without a basis admits nothing, limited as unbased (§5.2, §15)
   }else if(wire==='offer'){
    offer=await tx.get(K.offer(body.basis.offer_digest));
    // §5.2: the read-only offer check; a dead, mismatched or unknown offer is classified (and limited) as unbased.
    // An offer of an app whose connection is not live (or is from an earlier generation) admits nothing (§5.4, §14.2
    // step 6), whether or not the cleanup has run: classified as unbased like any dead offer.
    if(this.offerAdmits(offer,{line,profile:body.profile,sender,self,now})&&(offer.feature||(await this.appState(tx,owner,offer.clientId)).status==='live')&&await this.admits(offer.kind,ref)){cls=offer.principal===null?'open':'bound';route={case:'offer',digest:offer.digest};}
    else{cls='unbased';offer=null;}
   }else{
    pairing=await this.relationPairing(tx,sender,line);
    if(pairing&&pairing.state==='live'&&mayOpen(pairing,'peer')&&(pairing.expires_at===null||pairing.expires_at>now)&&(await this.appState(tx,owner,pairing.local.client_id)).status==='live'&&await this.pairingCoversVersion(pairing,ref)){cls='relation';route={case:'relation',pairing:pairing.id};
     covered=0;for(const ep of await endpointsFor(tx,{line,now}))if(sideCovers(pairing.local,ep)&&await this.endpointLive(tx,owner,ep))covered++;}
    else{cls='unbased';pairing=null;}
   }
   if(await this.sidTaken(tx,key,p.sid,now))return null;
   const limits=inviteLimits({cls,sender,issuer:this.issuer,pairing:pairing?.id,endpoints,offer:offer?.digest,service:offer?.service,covered});
   if(count&&!await limitsOpen(tx,limits,now,this.crypto))return null;
   if(cls==='open'&&!await fairShare(tx,{offer:offer.digest,issuer:sender.iss,service:offer.service,now},this.crypto))return null;
   // Unbased invites admit nothing, but still count against their windows (guessing or replaying offers is limited).
   if(cls==='unbased'){if(count)await takeLimits(tx,limits,now,this.crypto);return null;}
   const live=[];for(const r of (await tx.list({prefix:K.inPrefix,limit:4096})).values())if(isLive(r))live.push(r);
   const reserve=capacityAllows(capacityCounts(live),cls);if(!reserve)return null;
   // Per-pairing live caps: own-entity per (pairing, endpoint pair) at most 2; cross-entity per pairing id at most
   // 2 × the local covered endpoints (at least 2).
   if(pairing){const n=live.filter(r=>r.pairingId===pairing.id&&(cls!=='ownPairing'||r.route?.target===out.target&&r.route?.initiatorEndpoint===out.mine.endpoint)).length;
    if(n>=(cls==='ownPairing'?BOUNDS.ownPairingLive:Math.max(2,2*covered)))return null;}
   if(count&&!await takeLimits(tx,limits,now,this.crypto))return null;
   if(count&&cls==='open')await fairShare(tx,{offer:offer.digest,issuer:sender.iss,service:offer.service,now,take:true},this.crypto);
   return {cls,route,reserve:reserve==='base'?null:reserve,offer,pairing};
  };
  const first=await this.store.transaction(tx=>gate(tx,{count:true}));if(!first)return;
  // §13.1: the host-wide window per initiator origin principal across recipients (own-device invites are exempt); a
  // limiter that fails drops the invite (closed).
  if(this.hostLimits&&!own){let ok=false;try{ok=await this.hostLimits.take('initiator',[sender.iss,sender.sub])===true;}catch{ok=false;}if(!ok)return;}
  // Context against the kind version (§7.2, the invite's own version).
  if(body.context!==null)try{validateIntentData(kind,body.context);}catch{return;}
  try{validateMessageContent(p,{profile:body.profile,crossEntity:!own});}catch{return;}
  let handle=null;try{handle=await this.keys.handle?.(sender)??null;}catch{handle=null;}
  return this.commit(owner,async(tx,fx)=>{
   const g=await gate(tx,{count:false});if(!g)return;
   const rec={v:2,sid:p.sid,role:'recipient',state:'pending',own,initiator:sender,recipient:self,peerIdentity:verified.payload.identity,kind:structuredClone(ref),profile:body.profile,params:structuredClone(body.params),context:body.context===null?null:structuredClone(body.context),
    createdAt:now,answerBy:Math.min(body.answer_by*1000,now+ANSWER_MAX_MS),endsAt:p.iat*1000+SESSION_MAX_MS,theirs:{jkt:p.leg,certificate:certCompact,order:newLeg(),rate:null,delivered:true},mine:null,delivered:[],claim:null,
    cls:g.cls,route:g.route,...g.reserve?{reserve:g.reserve}:{},...g.pairing?{pairingId:g.pairing.id}:{},initiatorClient,...handle?{handle}:{},invite:m.compact,controls:[],peerKeys:pinKeys(keys)};
   offerSeq(rec.theirs.order,{seq:0,digest:d,compact:m.compact,now});
   const targets=await this.routingSet(tx,owner,rec,now);
   if(g.offer){
    // §5.2 step 8: a use is taken only with a nonempty routing set; bound offers spend it now, open offers reserve it.
    if(!targets.length)return;
    const o=await tx.get(K.offer(g.offer.digest));if(!this.offerAdmits(o,{line,profile:body.profile,sender,self,now}))return;
    if(o.principal===null){o.reserved++;rec.offerUse='reserved';o.admitted=[...(o.admitted??[]),key];}else{o.spent++;rec.offerUse='spent';o.admitted=[...(o.admitted??[]),key];}
    await tx.put(K.offer(o.digest),o);
   }
   await this.epochOk(tx,sender,verified.payload.aep,now);
   await this.deliverTo(tx,fx,owner,key,rec,targets,now);
   // An empty routing set delivers nothing and records nothing for the owner; the invite stays pending (late delivery)
   // until answer_by and then ends silently (§5.4).
   await tx.put(key,rec);return true;
  });
 }
 /** RTCw-L1: whether `sid` is already in the fan-out index of a live endpoint for another usable session. */
 async sidTaken(tx,key,sid,now){
  for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values()){
   if(!(ep?.expiresAt>now))continue;const dl=await tx.get(K.delivered(ep.id,sid));if(!dl||dl.key===key)continue;
   const rec=await tx.get(dl.key);if(rec&&(isLive(rec)||claimUsable(rec)))return true;}
  return false;
 }
 async processControl(owner,selfIdentity,parsed,now){
  const c=parsed.payload,sender={iss:c.iss,sub:c.sub};if(c.aud!==selfIdentity)return;
  const found=await this.store.transaction(async tx=>{const inRec=await tx.get(K.in(sender,c.sid));if(inRec)return {key:K.in(sender,c.sid),rec:inRec};const out=await tx.get(K.out(c.sid));return out&&samePrincipal(out.recipient,sender)?{key:K.out(c.sid),rec:out}:null;});
  if(!found)return;
  // §6.3: only the expected session party, under its held keys or the keys pinned on this session.
  const expected={aud:selfIdentity,sid:c.sid,iss:sender.iss,sub:sender.sub},verifyWith=async keys=>{if(!keys.length)return false;try{await verifyControl(parsed,{keys,expected,now:seconds(now),crypto:this.crypto});return true;}catch{return false;}};
  if(!await verifyWith(await this.peerKeys(sender))&&!await verifyWith(keysView(found.rec.peerKeys)))return;
  await this.commit(owner,async(tx,fx)=>{
   const rec=await tx.get(found.key);if(!rec||rec.controls.includes(c.jti))return;
   if(c.leg!==null&&c.leg!==rec.mine?.jkt&&c.leg!==rec.theirs?.jkt)return;
   rec.controls=[...rec.controls,c.jti].slice(-16);
   await this.end(tx,fx,owner,rec,'control',{now,reason:['moved','expired','revoked'].includes(c.reason)?c.reason:'failed',controlStatement:parsed.compact});
   await tx.put(found.key,rec);
  });
 }

 // ---- owner: policy, blocks, sessions, endpoints, offers (§14.1) -------------------------------------------------------
 owner(actor){return ownerOf(actor);}
 async ownerTx(actor,fn){const owner=this.owner(actor);return this.commit(owner,async(tx,fx)=>{await this.bindOwner(tx,owner);return fn(tx,fx,owner,this.now());});}
 async ownerRead(actor,fn){const owner=this.owner(actor);return this.store.transaction(async tx=>{await this.bindOwner(tx,owner);return fn(tx,this.now(),owner);});}
 async policy(actor){const owner=this.owner(actor);return this.ownerRead(actor,async tx=>{const p=await readPolicy(tx);return {other:p.other,self:p.self,revision:p.revision,enabled:this.enabled(owner)};});}
 /** IP policy, compare-and-swap on `revision` (§14.1); widening needs signaling on, narrowing never. */
 async setPolicy(actor,input){
  exact(input,['revision'],['other','self']);
  if(!Number.isSafeInteger(input.revision)||input.other!==undefined&&!['relay','public'].includes(input.other)||input.self!==undefined&&!['relay','public','all'].includes(input.self))invalid();
  return this.ownerTx(actor,async(tx,fx,owner)=>{
   const prior=await readPolicy(tx);if(prior.revision!==input.revision)fail('conflict','These settings changed. Reload and try again.',409);
   const next={v:2,other:input.other??prior.other,self:input.self??prior.self,revision:prior.revision+1};
   if(policyWidens(prior,next)&&!this.enabled(owner))notFound();
   await tx.put(K.policy,next);return {other:next.other,self:next.self,revision:next.revision};
  });
 }
 blockInput(actor,input,{block}){const self=this.self(this.owner(actor)),target=blockTarget(input,{issuer:this.issuer,validPrincipal:p=>principalValid(p,this.allowLoopback)&&!(block&&samePrincipal(p,self)),validOrigin:o=>originValid(o,this.allowLoopback)});if(!target)invalid();return target;}
 /** §13.2: blocks are silent, end the blocked party's pending invites silently, and delete every pairing whose peer
  * they cover (their claimed sessions get `revoked`). Narrowing; never gated. */
 async block(actor,input){
  const target=this.blockInput(actor,input,{block:true});
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   if(!await putBlock(tx,target,now))limited();
   for(const [key,rec] of await tx.list({prefix:K.inPrefix,limit:4096}))if(rec.state==='pending'&&!rec.own&&!rec.claim&&blockCovers(target,rec.initiator)){await this.end(tx,fx,owner,rec,'block',{now});await tx.put(key,rec);}
   for(const p of await this.pairingRows(tx))if(p.peer.principal&&blockCovers(target,p.peer.principal))await this.deletePairing(tx,fx,owner,p,now);
   return {blocked:true};
  });
 }
 async unblock(actor,input){const target=this.blockInput(actor,input,{block:false});return this.ownerTx(actor,async(tx,fx,owner)=>{if(!this.enabled(owner))notFound();await tx.delete(blockKey(target));return {blocked:false};});}
 blocked(actor){return this.ownerRead(actor,async tx=>({blocked:await principalBlocks(tx),issuers:await issuerBlocks(tx)}));}
 /** An owner end of a live session: an unclaimed recipient record ends silently (§5.5, §8.5); a claimed or outgoing
  * one with a control statement `revoked`. */
 async endSession(actor,input){
  exact(input,['sid'],['initiator']);if(typeof input.sid!=='string'||!SID.test(input.sid)||input.initiator!==undefined&&!principalValid(input.initiator,this.allowLoopback))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const key=input.initiator?K.in(input.initiator,input.sid):K.out(input.sid),rec=await tx.get(key);if(!rec)notFound();
   const silent=silentEndable(rec);if(isLive(rec))await this.endRecord(tx,fx,owner,key,rec,{now});
   return {sid:rec.sid,state:rec.state,...silent?{silent:true}:{}};
  });
 }
 async revokeEndpoint(actor,input){exact(input,['endpoint']);if(typeof input.endpoint!=='string'||!ENDPOINT_ID.test(input.endpoint))invalid();return this.ownerTx(actor,async(tx,fx,owner,now)=>{const ep=await tx.get(K.endpoint(input.endpoint));if(!ep)notFound();await this.removeEndpoint(tx,fx,ep,now);return {revoked:true};});}
 endpointList(actor){return this.ownerRead(actor,async(tx,now)=>({endpoints:[...(await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values()].filter(ep=>ep.expiresAt>now).map(ep=>({endpoint:ep.id,clientId:ep.clientId,origin:ep.origin,feature:ep.feature??null,label:ep.label,kinds:[...ep.kinds],clientSession:ep.clientSession??null,lastSeen:ep.lastSeen}))}));}
 /** §14.1 live offers: per app, kind, the invited principal or `null` ("anyone"), uses spent of `uses`, expiry; never
  * a token. `id` is the stored digest (a hash; it cannot be presented as an offer). */
 offersList(actor){return this.ownerRead(actor,async(tx,now)=>({offers:(await this.offerRows(tx)).map(([,o])=>o).filter(o=>!o.revoked&&o.expiresAt>now).map(o=>({id:o.digest,clientId:o.clientId,feature:o.feature??null,kind:o.kind.artefact,version:o.kind.version,profile:o.profile,principal:o.principal?party(o.principal):null,uses:o.uses,spent:o.spent,reserved:o.reserved,service:o.service,expiresAt:o.expiresAt}))}));}
 /** Owner revocation of one offer `{id}`, all of an app's `{clientId}`, or all `{all:true}`. Narrowing. */
 async revokeOffers(actor,input){
  const keys=Object.keys(plain(input)?input:{});
  if(keys.length!==1||keys[0]==='id'&&!(typeof input.id==='string'&&OFFER_ID.test(input.id))||keys[0]==='clientId'&&!clientIdValid(input.clientId)||keys[0]==='all'&&input.all!==true||!['id','clientId','all'].includes(keys[0]))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{let n=0;
   for(const [key,o] of await this.offerRows(tx))if(!o.revoked&&o.expiresAt>now&&(input.all===true||input.id===o.digest||input.clientId!==undefined&&o.clientId===input.clientId)){await this.endOffer(tx,fx,owner,key,o,now);n++;}
   if(input.id!==undefined&&!n)notFound();return {revoked:n};});
 }
 sessions(actor){return this.ownerRead(actor,async tx=>{const out=[];for(const prefix of [K.outPrefix,K.inPrefix])for(const rec of (await tx.list({prefix,limit:4096})).values())if(isLive(rec))out.push(sessionView(rec));return {sessions:out};});}

 // ---- owner: pairings (§5.8, §14.1) -----------------------------------------------------------------------------------
 pairingView(p){return structuredClone({id:p.id,revision:p.revision,kind:p.kind,local:p.local,peer:p.peer,opens:p.opens,accept:p.accept,label:p.label,created_via:p.created_via,state:p.state,expires_at:p.expires_at,createdAt:p.createdAt});}
 pairings(actor){return this.ownerRead(actor,async tx=>({pairings:(await this.pairingRows(tx)).map(p=>this.pairingView(p))}));}
 /** P1 (§5.8): the app party holds a live connection and grant (adapter evidence `actor.parties`) and its own session
  * handler approval for the kind line (local). */
 async partyQualifies(tx,owner,actor,side,line){return Array.isArray(actor.parties)&&actor.parties.includes(side.client_id)&&Boolean(await this.approvalFor(owner,{clientId:side.client_id},line,tx));}
 async pairingParties(tx,owner,actor,p){const sides=[p.local,...p.peer.self?[p.peer.self]:[]];for(const s of sides)if(!await this.partyQualifies(tx,owner,actor,s,p.kind.artefact))return false;return true;}
 /** P1 per party, for the pages: [{client_id, connected, approved}] (connected: a live connection and grant). */
 async partyStatus(tx,owner,actor,p){const out=[];for(const s of [p.local,...p.peer.self?[p.peer.self]:[]])out.push({client_id:s.client_id,connected:Array.isArray(actor.parties)&&actor.parties.includes(s.client_id),approved:Boolean(await this.approvalFor(owner,{clientId:s.client_id},p.kind.artefact,tx))});return out;}
 /** Owner-page policy (owner-pages.mjs): activating, renewing or re-confirming a cross-entity pairing needs fresh
  * authentication, as creating one does (§5.8). Only under `ownerPages`. */
 freshCross(actor,p){if(this.ownerPages&&p.peer.principal&&actor.freshAuth!==true)fail('reauthentication_required','Confirm it is you to pair with another account.',403);}
 /**
  * Validates a pairing creation (§5.8 "Creation") without writing: refused when the kind's `parties` does not admit the
  * peer type, when the kind's `bases` excludes `pairing`, when the peer is the owner or the local app itself, or
  * (cross-entity) without fresh authentication. A cross-entity pairing always expires (default 90 days, at most 1
  * year). Returns {owner, cross, body, expires, now}. Shared by createPairing and the creation page's review.
  */
 async pairingPlan(actor,input){
  exact(input,['kind','local','peer','opens','label'],['expiresAt','activate','created_via']);
  const owner=this.owner(actor),self=this.self(owner);if(!this.enabled(owner))notFound();// creation widens
  const side=v=>plain(v)&&Object.keys(v).sort().join()==='client_id,client_session'&&clientIdValid(v.client_id)&&sessionIdValid(v.client_session);
  if(!kindReferenceValid(input.kind)||!side(input.local)||!['local','peer','both'].includes(input.opens)||!labelValid(input.label,BOUNDS.pairingLabel))invalid();
  const cross=plain(input.peer)&&Object.keys(input.peer).join()==='principal';
  if(!(cross&&principalValid(input.peer.principal,this.allowLoopback)&&!samePrincipal(input.peer.principal,self)||plain(input.peer)&&Object.keys(input.peer).join()==='self'&&side(input.peer.self)))invalid('Choose the other app or one other principal.');
  // §5.8: an own-entity pairing's peer is "another app of the same entity" (L-2): never the local app itself.
  if(!cross&&input.peer.self.client_id===input.local.client_id)invalid('Choose the other app or one other principal.');
  if(input.created_via!==undefined&&!['settings','app-request'].includes(input.created_via))invalid('Enrolment pairings are created from the enrolment page.');
  if(input.activate!==undefined&&typeof input.activate!=='boolean')invalid();
  if(cross&&actor.freshAuth!==true)fail('reauthentication_required','Confirm it is you to pair with another account.',403);
  const body=await this.heldKind(input.kind);if(!body)invalid('This kind is not available.');
  if(!['any',cross?'other':'self'].includes(body.session.parties)||!basisAllowed(body,'pairing'))invalid('This kind cannot be paired that way.');
  // A provider feature is never a pairing party: sides name apps only (actor.parties lists apps only).
  const now=this.now();let expires=input.expiresAt??(cross?now+BOUNDS.pairingDefaultMs:null);
  if(expires!==null&&(!Number.isSafeInteger(expires)||expires<=now||expires>now+BOUNDS.pairingMaxMs))invalid('Choose an expiry within a year.');
  if(cross&&expires===null)invalid('A pairing with another account always expires.');
  return {owner,cross,body,expires,now};
 }
 /**
  * Creates a pairing by owner action (§5.8 "Creation"): only through the owner interface, never by an app; validated by
  * pairingPlan, and refused when a cross-entity pairing for (peer principal, kind line) exists in any state. It is
  * created live only when `activate` is set and every party already holds what P1 requires; otherwise pending (7 days).
  * Under `ownerPages` it needs the creation page's review.
  */
 async createPairing(actor,input){
  const {cross,expires,now}=await this.pairingPlan(actor,input);
  return this.ownerTx(actor,async(tx,fx,owner)=>{
   if(await tx.get(K.closed))notFound();
   await takeReview(this,tx,actor,'pairing-create',input,this.now());
   if((await this.pairingRows(tx)).length>=BOUNDS.pairings)limited();
   if(cross&&await this.relationPairing(tx,party(input.peer.principal),input.kind.artefact))fail('pairing_exists','A pairing with this account for this kind already exists.',409);
   const p={v:1,id:'pr_'+base64url(this.random.bytes(16)),revision:1,kind:structuredClone(input.kind),local:{client_id:input.local.client_id,client_session:input.local.client_session},peer:cross?{principal:party(input.peer.principal)}:{self:{client_id:input.peer.self.client_id,client_session:input.peer.self.client_session}},opens:input.opens,accept:'auto',label:input.label,created_via:input.created_via??'settings',state:'pending',expires_at:expires,createdAt:now};
   if(input.activate===true&&await this.pairingParties(tx,owner,actor,p))p.state='live';
   await tx.put(K.pairing(p.id),p);if(cross)await tx.put(await this.peerIndexKey(p.peer.principal,p.kind.artefact),p.id);
   await this.notifyPairing(tx,fx,owner,p,now);
   return this.pairingView(p);
  });
 }
 /** P3: the explicit activation control of one pending pairing, available only once every party qualifies. A live
  * pairing never returns to pending. Compare-and-swap on `revision`. Under `ownerPages` it needs the activation page's
  * review, and fresh authentication for a cross-entity pairing. */
 async activatePairing(actor,input){
  exact(input,['id','revision']);if(typeof input.id!=='string'||!PAIRING_ID.test(input.id)||!Number.isSafeInteger(input.revision))invalid();
  const owner=this.owner(actor);if(!this.enabled(owner))notFound();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const p=await tx.get(K.pairing(input.id));if(!p)notFound();if(p.revision!==input.revision)fail('conflict','This pairing changed. Reload and try again.',409);
   if(p.state!=='pending')invalid('Only a pending pairing can be activated.');
   // L-1: a pending pairing older than 7 days, or past its expiry, is gone at the moment of decision (tick deletes it).
   if(p.createdAt+BOUNDS.pairingPendingMs<=now||p.expires_at!==null&&p.expires_at<=now)notFound();
   this.freshCross(actor,p);await takeReview(this,tx,actor,'pairing-activate',input,now);
   if(!await this.pairingParties(tx,owner,actor,p))fail('pairing_parties_incomplete','Each app needs its own access and approval first.',409);
   p.state='live';p.revision++;await tx.put(K.pairing(p.id),p);await this.notifyPairing(tx,fx,owner,p,now);return this.pairingView(p);
  });
 }
 /** Whether an update widens (§14.1): a later or removed expiry, or a re-confirmed kind version. */
 static updateWidens(p,input){return input.kind!==undefined||input.expiresAt!==undefined&&(input.expiresAt===null||p.expires_at!==null&&input.expiresAt>p.expires_at);}
 /** Relabel, set or renew an expiry, or re-confirm a newer kind version (§5.8), compare-and-swap. Relabelling and
  * shortening are never gated; renewing and re-confirming widen (and, under `ownerPages`, need the page's review and,
  * for a cross-entity pairing, fresh authentication). */
 async updatePairing(actor,input){
  exact(input,['id','revision'],['label','expiresAt','kind']);if(typeof input.id!=='string'||!PAIRING_ID.test(input.id)||!Number.isSafeInteger(input.revision))invalid();
  if(input.label!==undefined&&!labelValid(input.label,BOUNDS.pairingLabel)||input.kind!==undefined&&!kindReferenceValid(input.kind))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const p=await tx.get(K.pairing(input.id));if(!p)notFound();if(p.revision!==input.revision)fail('conflict','This pairing changed. Reload and try again.',409);
   // L-1: an expired pairing (or a pending one past 7 days) is never renewed or re-confirmed while its deletion waits
   // for `tick`.
   if(p.expires_at!==null&&p.expires_at<=now||p.state!=='live'&&p.createdAt+BOUNDS.pairingPendingMs<=now)notFound();
   if(input.expiresAt!==undefined){const e=input.expiresAt;if(e===null?Boolean(p.peer.principal):!Number.isSafeInteger(e)||e<=now||e>now+BOUNDS.pairingMaxMs)invalid('Choose an expiry within a year.');}
   const widening=SignalingService.updateWidens(p,input);if(widening&&!this.enabled(owner))notFound();
   if(input.kind!==undefined&&(input.kind.artefact!==p.kind.artefact||input.kind.version<p.kind.version||!await this.additive(p.kind,input.kind)))invalid('Choose a later version of the same kind.');
   if(widening){this.freshCross(actor,p);await takeReview(this,tx,actor,'pairing-update',input,now);}
   if(input.expiresAt!==undefined)p.expires_at=input.expiresAt;
   if(input.kind!==undefined)p.kind=structuredClone(input.kind);
   if(input.label!==undefined)p.label=input.label;
   p.revision++;await tx.put(K.pairing(p.id),p);return this.pairingView(p);
  });
 }
 async removePairing(actor,input){exact(input,['id']);if(typeof input.id!=='string'||!PAIRING_ID.test(input.id))invalid();return this.ownerTx(actor,async(tx,fx,owner,now)=>{const p=await tx.get(K.pairing(input.id));if(!p)notFound();await this.deletePairing(tx,fx,owner,p,now);return {removed:true};});}
 /** One pairing for its owner page: the record, its kind as the pages show it, both parties (P1 status), the peer as it
  * may be shown, and a newer held kind version it could be re-confirmed to (§5.8 "Kind versions"). */
 async pairingDetail(actor,input){
  exact(input,['id']);if(typeof input.id!=='string'||!PAIRING_ID.test(input.id))invalid();const owner=this.owner(actor);
  const r=await this.ownerRead(actor,async(tx,now)=>{const p=await tx.get(K.pairing(input.id));if(!p)notFound();return {p,now,parties:await this.partyStatus(tx,owner,actor,p)};});
  const body=await this.heldKind(r.p.kind);
  return {pairing:this.pairingView(r.p),kind:body?kindView(body,r.p.kind):null,effect:body?pairingEffect(body):null,local:appView(r.p.local),peer:r.p.peer.principal?await peerView(this,r.p.peer.principal):{self:appView(r.p.peer.self)},
   parties:r.parties,newer:body&&r.p.state==='live'?await newerKind(this,r.p.kind):null,maxExpiresAt:r.now+BOUNDS.pairingMaxMs,enabled:this.enabled(owner)};
 }
 pairingSummary(p){return {id:p.id,label:p.label,state:p.state,opens:p.opens,kind:structuredClone(p.kind),local:appView(p.local),peer:p.peer.self?{self:appView(p.peer.self)}:{principal:party(p.peer.principal)},expires_at:p.expires_at};}
 async pairingDisclosure(p,body){const cross=Boolean(p.peer.principal);return {id:p.id,label:p.label,state:p.state,opens:p.opens,cross,expires_at:p.expires_at,kind:kindView(body,p.kind),local:appView(p.local),peer:cross?await peerView(this,p.peer.principal):{self:appView(p.peer.self)},effect:pairingEffect(body),peerCanTellRunning:cross,recipientOnlyEnforcement:cross};}

 // ---- owner: service designation (§4.3) --------------------------------------------------------------------------------
 /** The designation, whether this entity may hold one, and how many live offers lasting longer than 900 s removing it
  * would revoke (§4.3, §14.2). */
 async serviceDesignation(actor){const owner=this.owner(actor);return this.ownerRead(actor,async(tx,now)=>{const s=await tx.get(K.service);let longOffers=0;for(const [,o] of await this.offerRows(tx))if(!o.revoked&&!o.feature&&o.expiresAt>now&&o.expiresAt-o.createdAt>BOUNDS.offerPersonSeconds*1000)longOffers++;return {designated:s?.designated===true,eligible:await this.entityIs(owner)==='organization',revision:s?.revision??0,longOffers};});}
 /** Sets or removes the designation of an organization entity (a person entity cannot be designated). Removing it is
  * narrowing and revokes the entity's offers longer than 900 s (§4.3, §14.2). Setting it needs the page's review under
  * `ownerPages`. */
 async setServiceDesignation(actor,input){
  exact(input,['designated','revision']);if(typeof input.designated!=='boolean'||!Number.isSafeInteger(input.revision))invalid();
  const owner=this.owner(actor);if(input.designated&&(!this.enabled(owner)||await this.entityIs(owner)!=='organization'))notFound();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const prior=await tx.get(K.service),revision=prior?.revision??0;if(revision!==input.revision)fail('conflict','This setting changed. Reload and try again.',409);
   if(input.designated)await takeReview(this,tx,actor,'set-service',input,now);
   await tx.put(K.service,{designated:input.designated,revision:revision+1,at:now});
   let revoked=0;if(!input.designated)for(const [key,o] of await this.offerRows(tx))if(!o.revoked&&!o.feature&&o.expiresAt-o.createdAt>BOUNDS.offerPersonSeconds*1000){await this.endOffer(tx,fx,owner,key,o,now);revoked++;}
   return {designated:input.designated,revision:revision+1,...input.designated?{}:{revoked}};
  });
 }

 // ---- owner: session handler approvals (AMD-SG-I1 §20.1.4; intents operations) -----------------------------------------
 /** The owner's session handler approvals, each with the held kind's title (or null when the version is not held). */
 async approvals(actor){
  const owner=this.owner(actor),rows=await this.ownerRead(actor,tx=>listApprovals(tx,owner)),out=[];
  for(const {line,approval} of rows){const body=await this.heldKind({artefact:line,version:approval.version,digest:approval.digest});
   out.push({kind:line,handler:approval.handler,feature:approval.feature,version:approval.version,digest:approval.digest,autoConnect:approval.autoConnect,autoConnectAllowed:body?.session.parties==='self',title:body?structuredClone(body.title):null,at:approval.at});}
  return {approvals:out};
 }
 /**
  * Records a session handler approval (widening): the owner approved `kind` ({artefact, version, digest} as shown) for
  * `clientId` on a provider page meeting the §20.1.4 obligations (under `ownerPages`, the page's review; `actor.parties`
  * must list the app, so it holds a live connection and grant). `autoConnect` is allowed only for `parties: self`.
  */
 async approve(actor,input){
  exact(input,['clientId','kind'],['autoConnect']);const owner=this.owner(actor);
  if(!clientIdValid(input.clientId)||!kindReferenceValid(input.kind)||input.autoConnect!==undefined&&typeof input.autoConnect!=='boolean')invalid();
  if(!this.enabled(owner)||!Array.isArray(actor.parties)||!actor.parties.includes(input.clientId))notFound();
  const body=await this.heldKind(input.kind);if(!body)invalid('This kind is not available.');
  if(input.autoConnect===true&&body.session.parties!=='self')invalid('Only kinds for your own devices connect automatically.');
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   await takeReview(this,tx,actor,'session-approve',input,now);
   // §20.1.4 "Exclusions (§7.4) apply": an excluded handler cannot be approved for that kind (L-3).
   if(handlerExcluded(await tx.get(memoryKey(owner,input.kind.artefact)),input.clientId))fail('handler_excluded','This app is excluded for this kind. Remove the exclusion first.',409);
   // The approval belongs to the app's current connection generation. State of an ended or earlier connection is
   // cleared first (§20.1.4, §14.2), so restoring an approval never restores pairings, offers or endpoints (§5.8 P3).
   if(typeof this.connections?.state==='function'){const st=await this.appState(tx,owner,input.clientId);if(st.state!=='live'||st.generation===null)notFound();
    if(st.status==='stale')await this.clearApp(tx,fx,owner,input.clientId,now);
    await tx.put(await this.appKey(input.clientId),{clientId:input.clientId,generation:st.generation});}
   const key=memoryKey(owner,input.kind.artefact),memory=await tx.get(key);
   await tx.put(key,withApproval(memory,input.kind.artefact,{handler:input.clientId,feature:false,version:input.kind.version,digest:input.kind.digest,at:now,autoConnect:input.autoConnect===true}));
   // A later version that adds disclosure replaces the earlier approval only after this owner action (re-approval);
   // pairings keep their own pinned version.
   return {kind:input.kind.artefact,clientId:input.clientId,version:input.kind.version,autoConnect:input.autoConnect===true};
  });
 }
 /** Removes a session handler approval (immediate narrowing, never gated): runs §14.2 for that app and kind. */
 async unapprove(actor,input){
  exact(input,['clientId','kind']);if(!clientIdValid(input.clientId)||!lineValid(input.kind))invalid();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const key=memoryKey(owner,input.kind),{memory,removed}=withoutApproval(await tx.get(key),{handler:input.clientId,feature:false});
   if(removed)await tx.put(key,memory);
   const ended=await this.narrow(tx,fx,owner,{clientId:input.clientId,lines:[input.kind],authority:true},now);
   return {removed,ended};
  });
 }
 /** Sets `autoConnect` on an existing approval: turning it on widens (needs signaling on, a `self` kind and, under
  * `ownerPages`, the page's review); turning it off is never gated. */
 async setAutoConnect(actor,input){
  exact(input,['clientId','kind','autoConnect']);if(!clientIdValid(input.clientId)||!lineValid(input.kind)||typeof input.autoConnect!=='boolean')invalid();
  const owner=this.owner(actor);if(input.autoConnect&&!this.enabled(owner))notFound();
  return this.ownerTx(actor,async(tx,fx,owner,now)=>{
   const key=memoryKey(owner,input.kind),memory=await tx.get(key),a=approvalIn(memory,{handler:input.clientId,feature:false});if(!a)notFound();
   if(input.autoConnect){const body=await this.heldKind({artefact:input.kind,version:a.version,digest:a.digest});if(!body||body.session.parties!=='self')invalid('Only kinds for your own devices connect automatically.');await takeReview(this,tx,actor,'session-auto-connect',input,now);}
   await tx.put(key,withApproval(memory,input.kind,{...a,autoConnect:input.autoConnect}));return {autoConnect:input.autoConnect};
  });
 }

 // ---- owner pages: reviews (owner-pages.mjs; §20.1.4, §5.8, §4.3 page obligations) -------------------------------------
 /**
  * `signaling.review` {action, input}: validates a widening owner action as the operation will, computes what its page
  * must disclose, and stores a single-use review (armed after PAGE_REVIEW.dwellMs). Returns {action, review, armAt,
  * expiresAt, input, disclosure}: `input` is exactly what the page commits (with `review` as adapter evidence). A
  * cross-entity pairing that already exists for (peer, kind line) answers {review: null, refusal: {code:
  * 'pairing_exists', existing}} so that the page can link to it (§5.8). Widening: not found while signaling is off.
  */
 async review(actor,input){
  exact(input,['action','input']);const owner=this.owner(actor);
  if(!REVIEW_ACTIONS.includes(input.action)||!plain(input.input))invalid();
  if(!this.enabled(owner))notFound();
  const built=await this.reviewPlan(actor,owner,input.action,input.input);
  if(built.refusal)return {action:input.action,review:null,refusal:built.refusal};
  const canonical=canonicalInput(input.action,built.input),record=await storeReview(this,actor,input.action,canonical,{bound:built.bound,activateNow:built.disclosure.activateNow});
  return {action:input.action,review:record.id,armAt:record.armAt,expiresAt:record.expiresAt,input:canonical,disclosure:built.disclosure};
 }
 /**
  * The disclosed state a review binds besides its canonical input (owner-pages.mjs takeReview rechecks it at commit and
  * refuses with `review_stale` on any difference): for an approval, whether the entity is service-class (§20.1.4
  * service wording); for auto-connect, the approval version and digest whose kind facts were shown; for the service
  * designation, a digest of the approved app set and its kind lines ("Apps this applies to now", §4.3). Null otherwise.
  */
 async reviewBound(tx,owner,action,input){
  if(action==='session-approve')return {serviceClass:(await tx.get(K.service))?.designated===true&&await this.entityIs(owner)==='organization'};
  if(action==='session-auto-connect'){const a=approvalIn(await tx.get(memoryKey(owner,input.kind)),{handler:input.clientId,feature:false});return {approval:a?{version:a.version,digest:a.digest}:null};}
  if(action==='set-service')return {apps:await digest(this.crypto,JSON.stringify(['signaling-service-apps',serviceApps(await listApprovals(tx,owner))]))};
  return null;
 }
 async resolveKind(line){if(!lineValid(line))invalid();const held=await latestHeld(this,line);if(!held)invalid('This kind is not available.');return held;}
 async reviewPlan(actor,owner,action,input){
  if(action==='session-approve'){
   exact(input,['clientId','kind']);if(!clientIdValid(input.clientId))invalid();
   if(!Array.isArray(actor.parties)||!actor.parties.includes(input.clientId))notFound();
   let held;if(typeof input.kind==='string')held=await this.resolveKind(input.kind);
   else{if(!kindReferenceValid(input.kind))invalid();const body=await this.heldKind(input.kind);if(!body)invalid('This kind is not available.');held={ref:{artefact:input.kind.artefact,version:input.kind.version,digest:input.kind.digest},body};}
   const k=held.ref,body=held.body;
   const r=await this.ownerRead(actor,async(tx,now)=>{
    const memory=await tx.get(memoryKey(owner,k.artefact));if(handlerExcluded(memory,input.clientId))fail('handler_excluded','This app is excluded for this kind. Remove the exclusion first.',409);
    if(typeof this.connections?.state==='function'){const st=await this.appState(tx,owner,input.clientId);if(st.state!=='live'||st.generation===null)notFound();}
    const existing=approvalIn(memory,{handler:input.clientId,feature:false}),pending=[];
    for(const p of await this.pairingRows(tx)){
     if(p.state!=='pending'||p.kind.artefact!==k.artefact||p.createdAt+BOUNDS.pairingPendingMs<=now||p.expires_at!==null&&p.expires_at<=now)continue;
     const sides=[p.local,...p.peer.self?[p.peer.self]:[]];if(!sides.some(s=>s.client_id===input.clientId))continue;
     let ok=true;for(const s of sides)if(s.client_id!==input.clientId&&!await this.partyQualifies(tx,owner,actor,s,p.kind.artefact))ok=false;if(ok)pending.push(this.pairingSummary(p));
    }
    return {existing,pending,bound:await this.reviewBound(tx,owner,action,{clientId:input.clientId,kind:k})};
   });
   const serviceClass=r.bound.serviceClass;
   let adds=false;if(r.existing&&r.existing.version!==k.version){const old=await this.heldKind({artefact:k.artefact,version:r.existing.version,digest:r.existing.digest});adds=old?kindAddsDisclosure(old,body):true;}
   return {input:{clientId:input.clientId,kind:k},disclosure:{handler:appView({client_id:input.clientId}),kind:kindView(body,k),risk:kindRisk(body,input.clientId),sees:['identity','origin','context'],serviceClass,
    ...serviceClass?{serviceLimits:{openSeconds:BOUNDS.offerServiceOpenSeconds,boundSeconds:BOUNDS.offerServiceBoundSeconds}}:{},autoConnectAllowed:body.session.parties==='self',
    existing:r.existing?{version:r.existing.version,autoConnect:r.existing.autoConnect}:null,addsDisclosure:adds,activatable:r.pending},bound:r.bound};
  }
  if(action==='session-auto-connect'){
   exact(input,['clientId','kind'],['autoConnect']);if(!clientIdValid(input.clientId)||!lineValid(input.kind)||input.autoConnect!==undefined&&input.autoConnect!==true)invalid();
   const bound=await this.ownerRead(actor,tx=>this.reviewBound(tx,owner,action,input)),a=bound.approval;if(!a)notFound();
   const k={artefact:input.kind,version:a.version,digest:a.digest},body=await this.heldKind(k);if(!body||body.session.parties!=='self')invalid('Only kinds for your own devices connect automatically.');
   return {input:{clientId:input.clientId,kind:input.kind,autoConnect:true},disclosure:{handler:appView({client_id:input.clientId}),kind:kindView(body,k),risk:kindRisk(body,input.clientId)},bound};
  }
  if(action==='pairing-create'){
   exact(input,['kind','local','peer','opens','label'],['expiresAt','created_via']);
   const norm=structuredClone(input);
   if(plain(norm.local)&&norm.local.client_session===undefined)norm.local.client_session=null;
   if(plain(norm.peer)&&plain(norm.peer.self)&&norm.peer.self.client_session===undefined)norm.peer.self.client_session=null;
   if(plain(norm.peer)&&Object.keys(norm.peer).join()==='handle'){
    const handle=typeof norm.peer.handle==='string'?norm.peer.handle.trim().replace(/^@/,''):'';if(!handle||handle.length>320)invalid('Enter a handle.');
    let p=null;try{p=await this.keys.resolveHandle?.(handle);}catch{p=null;}if(!principalValid(p,this.allowLoopback))fail('peer_unknown','No account with that handle was found here.',404);norm.peer={principal:party(p)};
   }
   if(typeof norm.kind==='string'){const line=norm.kind;if(!lineValid(line))invalid();const mine=plain(norm.local)&&clientIdValid(norm.local.client_id)?await this.approvalFor(owner,{clientId:norm.local.client_id},line):null;norm.kind=mine?.ref??(await this.resolveKind(line)).ref;}
   const plan=await this.pairingPlan(actor,norm);
   norm.expiresAt=plan.expires;norm.created_via=norm.created_via??'settings';
   const r=await this.ownerRead(actor,async tx=>{
    const existing=plan.cross?await this.relationPairing(tx,party(norm.peer.principal),norm.kind.artefact):null;if(existing)return {existing};
    return {parties:await this.partyStatus(tx,owner,actor,{local:norm.local,peer:norm.peer,kind:norm.kind})};});
   if(r.existing)return {refusal:{code:'pairing_exists',existing:r.existing.id}};
   return {input:norm,disclosure:{kind:kindView(plan.body,norm.kind),local:appView(norm.local),peer:plan.cross?await peerView(this,norm.peer.principal):{self:appView(norm.peer.self)},opens:norm.opens,label:norm.label,cross:plan.cross,
    expiresAt:plan.expires,effect:pairingEffect(plan.body),peerCanTellRunning:plan.cross,recipientOnlyEnforcement:plan.cross,parties:r.parties,activateNow:r.parties.every(x=>x.connected&&x.approved)}};
  }
  if(action==='pairing-activate'){
   exact(input,['id','revision']);if(typeof input.id!=='string'||!PAIRING_ID.test(input.id)||!Number.isSafeInteger(input.revision))invalid();
   const r=await this.ownerRead(actor,async(tx,now)=>{const p=await tx.get(K.pairing(input.id));if(!p)notFound();if(p.revision!==input.revision)fail('conflict','This pairing changed. Reload and try again.',409);
    if(p.state!=='pending')invalid('Only a pending pairing can be activated.');if(p.createdAt+BOUNDS.pairingPendingMs<=now||p.expires_at!==null&&p.expires_at<=now)notFound();return {p,parties:await this.partyStatus(tx,owner,actor,p)};});
   this.freshCross(actor,r.p);const body=await this.heldKind(r.p.kind);if(!body)invalid('This kind is not available.');
   return {input:{id:input.id,revision:input.revision},disclosure:{...await this.pairingDisclosure(r.p,body),parties:r.parties,activateNow:r.parties.every(x=>x.connected&&x.approved)}};
  }
  if(action==='pairing-update'){
   exact(input,['id','revision'],['expiresAt','kind']);if(typeof input.id!=='string'||!PAIRING_ID.test(input.id)||!Number.isSafeInteger(input.revision))invalid();
   const norm=structuredClone(input);
   const r=await this.ownerRead(actor,async(tx,now)=>{const p=await tx.get(K.pairing(input.id));if(!p)notFound();if(p.revision!==input.revision)fail('conflict','This pairing changed. Reload and try again.',409);
    if(p.expires_at!==null&&p.expires_at<=now||p.state!=='live'&&p.createdAt+BOUNDS.pairingPendingMs<=now)notFound();return {p,now};});
   const p=r.p;
   if(typeof norm.kind==='string'){if(norm.kind!==p.kind.artefact)invalid('Choose a later version of the same kind.');const newer=await newerKind(this,p.kind);if(!newer)invalid('There is no later version of this kind to confirm.');norm.kind={artefact:newer.kind.artefact,version:newer.kind.version,digest:newer.kind.digest};}
   else if(norm.kind!==undefined&&!kindReferenceValid(norm.kind))invalid();
   if(norm.expiresAt!==undefined){const e=norm.expiresAt;if(e===null?Boolean(p.peer.principal):!Number.isSafeInteger(e)||e<=r.now||e>r.now+BOUNDS.pairingMaxMs)invalid('Choose an expiry within a year.');}
   if(!SignalingService.updateWidens(p,norm))invalid('Only renewing or re-confirming a pairing needs a review.');
   if(norm.kind!==undefined&&(norm.kind.artefact!==p.kind.artefact||norm.kind.version<p.kind.version||!await this.additive(p.kind,norm.kind)))invalid('Choose a later version of the same kind.');
   this.freshCross(actor,p);
   const current=await this.heldKind(p.kind),next=norm.kind?await this.heldKind(norm.kind):current;if(!next)invalid('This kind is not available.');
   return {input:norm,disclosure:{...await this.pairingDisclosure(p,next),current:{expires_at:p.expires_at,kind:current?kindView(current,p.kind):null},
    next:{...norm.expiresAt!==undefined?{expires_at:norm.expiresAt}:{},...norm.kind?{kind:kindView(next,norm.kind),addsDisclosure:current?kindAddsDisclosure(current,next):true}:{}}}};
  }
  if(action==='set-service'){
   exact(input,['designated','revision']);if(input.designated!==true||!Number.isSafeInteger(input.revision))invalid();
   if(await this.entityIs(owner)!=='organization')notFound();
   const r=await this.ownerRead(actor,async tx=>({revision:(await tx.get(K.service))?.revision??0,apps:serviceApps(await listApprovals(tx,owner)),bound:await this.reviewBound(tx,owner,action,input)}));
   if(r.revision!==input.revision)fail('conflict','This setting changed. Reload and try again.',409);
   return {input:{designated:true,revision:input.revision},disclosure:{openSeconds:BOUNDS.offerServiceOpenSeconds,boundSeconds:BOUNDS.offerServiceBoundSeconds,personSeconds:BOUNDS.offerPersonSeconds,
    apps:r.apps.map(([clientId,kinds])=>({...appView({client_id:clientId}),kinds}))},bound:r.bound};
  }
  invalid();
 }

 /** signaling.export: owner data (§12.6): the IP policy, principal and provider blocks, pairings (every member, every
  * state) and an organization's service designation. Approvals go with `intent-choices`. Never endpoints, sessions,
  * queues, offers, replay, delegate, epoch, limit state or relay leases. */
 exportRecords(actor){return this.ownerRead(actor,async tx=>{const s=await tx.get(K.service);return {version:2,policy:await readPolicy(tx),blocked:await principalBlocks(tx),blockedIssuers:await issuerBlocks(tx),pairings:(await this.pairingRows(tx)).map(p=>this.pairingView(p)),service:{designated:s?.designated===true}};});}

 // ---- lifecycle and narrowing (§14.2, §14.4) -------------------------------------------------------------------------
 /** Ends every session the endpoint holds a leg in (control `revoked`), drops it from undelivered fan-outs, and deletes
  * it with its queue and fan-out index. Never ends an offer (§5.7). */
 async removeEndpoint(tx,fx,ep,now){
  const owner=await tx.get('owner');
  for(const [key,rec] of await tx.list({prefix:K.outPrefix,limit:4096}))if(isLive(rec)&&rec.mine?.endpoint===ep.id){await this.end(tx,fx,owner,rec,'revoke',{now,control:{leg:rec.mine.jkt,reason:'revoked'}});await tx.put(key,rec);}
  for(const [dkey,dl] of await tx.list({prefix:K.deliveredPrefix(ep.id),limit:4096})){const rec=await tx.get(dl.key);
   if(rec&&isLive(rec)&&rec.claim?.endpoint===ep.id){await this.end(tx,fx,owner,rec,'revoke',{now,control:{leg:rec.mine?.jkt??null,reason:'revoked'}});await tx.put(dl.key,rec);}
   else if(rec){rec.delivered=rec.delivered.filter(id=>id!==ep.id);await tx.put(dl.key,rec);}
   await tx.delete(dkey);}
  for(const key of (await tx.list({prefix:K.queuePrefix(ep.id),limit:BOUNDS.queueEvents*2})).keys())await tx.delete(key);
  await tx.delete(K.endpoint(ep.id));fx.woken.add(ep.id);
 }
 /**
  * §14.2 narrowing for one app (`clientId`) or provider feature (`feature`), for the kind `lines` (absent: every kind):
  * 1. ends the app's live sessions of those kinds (claimed legs get `revoked`; unclaimed recipient records silently);
  * 4. ends pending invites delivered only to that app's endpoints, silently;
  * 5. removes its endpoint registrations for those kinds;
  * 6. with `authority` (approval removal or clearing, grant revocation, connection end, feature disabled), revokes its
  *    live offers of those kinds;
  * 7. deletes the pairings that name the app for those kinds, or bind `clientSession` (a revoked client session).
  * Returns the number of sessions ended. Narrowing; never gated.
  */
 async narrow(tx,fx,owner,{clientId=null,feature=null,lines=null,authority=false,clientSession=null},now){
  const who=feature?{handler:feature,feature:true}:{handler:clientId,feature:false},covers=line=>lines===null||lines.includes(line);
  const mineHandler=leg=>leg&&sameHandler(leg.feature?{handler:leg.feature,feature:true}:{handler:leg.clientId,feature:false},who);
  const sessionMatch=leg=>clientSession===null||leg?.clientSession===clientSession;
  let ended=0;
  for(const prefix of [K.outPrefix,K.inPrefix])for(const [key,rec] of await tx.list({prefix,limit:4096})){
   if(!isLive(rec)||!covers(rec.kind.artefact))continue;
   if(rec.mine&&mineHandler(rec.mine)&&sessionMatch(rec.mine)){await this.endRecord(tx,fx,owner,key,rec,{now});ended++;continue;}
   if(clientSession===null&&silentEndable(rec)&&rec.delivered.length){
    let only=true;for(const id of rec.delivered){const ep=await tx.get(K.endpoint(id));if(ep&&!sameHandler(handlerKey(ep),who)){only=false;break;}}
    if(only){await this.end(tx,fx,owner,rec,'revoke',{now,reason:'revoked'});await tx.put(key,rec);ended++;}
   }
  }
  for(const ep of [...(await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values()]){
   if(!sameHandler(handlerKey(ep),who)||!sessionMatch(ep))continue;
   const kept=lines===null?[]:ep.kinds.filter(l=>!lines.includes(l));
   if(!kept.length)await this.removeEndpoint(tx,fx,ep,now);else if(kept.length!==ep.kinds.length)await tx.put(K.endpoint(ep.id),{...ep,kinds:kept});
  }
  if(authority&&clientSession===null)for(const [key,o] of await this.offerRows(tx))if(!o.revoked&&covers(o.kind.artefact)&&sameHandler(o.feature?{handler:o.feature,feature:true}:{handler:o.clientId,feature:false},who))await this.endOffer(tx,fx,owner,key,o,now);
  if(!feature)for(const p of await this.pairingRows(tx)){
   if(!covers(p.kind.artefact))continue;const sides=[p.local,...p.peer.self?[p.peer.self]:[]];
   const hit=clientSession!==null?sides.some(s=>s.client_id===clientId&&s.client_session===clientSession):authority&&sides.some(s=>s.client_id===clientId);
   if(hit)await this.deletePairing(tx,fx,owner,p,now);
  }
  return ended;
 }
 /**
  * signaling.lifecycle (system): `deletion` (every live session ends with control `revoked` for claimed legs and
  * silently for pending ones, endpoints, pairings and offers go, nothing new is admitted; the drain then delivers the
  * controls before the tombstone), `app-revoked` {clientId|feature} (the app's connection ended or its grant on the
  * signaling field was revoked: its approvals are cleared and §14.2 runs for every kind), `client-session-revoked`
  * {clientId, clientSession} (one client session: its endpoints, sessions and bound pairings; never an offer).
  */
 async lifecycle(actor,input){
  const owner=this.system(actor);exact(input,['event'],['clientId','feature','clientSession']);
  if(!['deletion','app-revoked','client-session-revoked'].includes(input.event))invalid();
  if(input.event!=='deletion'&&!(clientIdValid(input.clientId)||typeof input.feature==='string'))invalid();
  if(input.event==='client-session-revoked'&&(typeof input.clientSession!=='string'||!input.clientSession))invalid();
  return this.commit(owner,async(tx,fx)=>{
   await this.bindOwner(tx,owner);const now=this.now();
   if(input.event==='deletion'){
    await tx.put(K.closed,{at:now});let ended=0;
    for(const prefix of [K.outPrefix,K.inPrefix])for(const [key,rec] of await tx.list({prefix,limit:4096}))if(await this.endRecord(tx,fx,owner,key,rec,{now}))ended++;
    for(const ep of [...(await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values()])await this.removeEndpoint(tx,fx,ep,now);
    for(const p of await this.pairingRows(tx))await this.deletePairing(tx,fx,owner,p,now);
    for(const [key] of await this.offerRows(tx))await tx.delete(key);
    for(const key of (await tx.list({prefix:K.appPrefix,limit:4096})).keys())await tx.delete(key);
    return {ended};
   }
   if(input.event==='client-session-revoked')return {ended:await this.narrow(tx,fx,owner,{clientId:input.clientId,clientSession:input.clientSession},now)};
   // Clearing (§20.1.4): the handler's connection ended, so its session handler approvals go, for every kind. Grant
   // revocation reaches here too and clears approvals as well (a recorded divergence: §20.1.4 lists only connection
   // end and manifest change; §14.2 and §5.8 require the rest for grant revocation).
   if(!input.feature)return {ended:await this.clearApp(tx,fx,owner,input.clientId,now)};
   return {ended:await this.narrow(tx,fx,owner,{feature:input.feature,authority:true},now)};
  });
 }
 /**
  * signaling.tick (system): answer_by and session expiry, gap timeouts, the 60 s payload bound, idle endpoints (30
  * days, with unregister's effects), record retention (24 h after end), offer expiry (silent end of what they
  * admitted; records go at expiry), pairing expiry and the 7-day pending limit, delegates, epochs and limits; the
  * inbound queue first and an outbox pass after. Bounded per call; returns {wakeAt}.
  */
 async tick(actor){
  const owner=this.system(actor);let wake=Infinity;
  const inbox=await this.processInbox(owner,{limit:64});if(inbox.more)wake=Math.min(wake,this.now()+250);
  const live=[];
  await this.commit(owner,async(tx,fx)=>{
   live.length=0;await this.bindOwner(tx,owner);const now=this.now(),soon=t=>{if(t>now)wake=Math.min(wake,t);};
   // Apps whose connection ended or changed generation: §20.1.4 clearing and §14.2, retried on every tick until done
   // (the connection record itself is the durable marker; a failed connection-end hook loses nothing).
   await this.sweepApps(tx,fx,owner,now);
   for(const [key,o] of await this.offerRows(tx)){
    if(o.expiresAt<=now||o.revoked){await this.endOffer(tx,fx,owner,key,o,now);continue;}soon(o.expiresAt);}
   for(const p of await this.pairingRows(tx)){
    if(p.expires_at!==null&&p.expires_at<=now||p.state!=='live'&&p.createdAt+BOUNDS.pairingPendingMs<=now){await this.deletePairing(tx,fx,owner,p,now);continue;}
    if(p.expires_at!==null)soon(p.expires_at);if(p.state!=='live')soon(p.createdAt+BOUNDS.pairingPendingMs);}
   for(const prefix of [K.outPrefix,K.inPrefix])for(const [key,rec] of await tx.list({prefix,limit:4096})){
    if(recordExpired(rec,now)){await tx.delete(key);continue;}
    if(rec.state==='ended'){soon(rec.endedAt+86400000);continue;}
    const due=dueEvent(rec,now);
    if(due){await this.end(tx,fx,owner,rec,due,{now});await tx.put(key,rec);soon(rec.endedAt+86400000);continue;}
    const legs=[rec.mine?.order,rec.theirs?.order].filter(Boolean);
    if(legs.some(l=>gapExpired(l,now))){await this.end(tx,fx,owner,rec,'fail',{now,...silentEndable(rec)?{}:{control:{leg:rec.theirs?.jkt??null,reason:'failed'}}});await tx.put(key,rec);continue;}
    if(rec.role==='initiator'&&rec.state==='pending'&&!rec.theirs&&rec.inviteCompact&&rec.inviteRetry?.acked===true){
     if(rec.inviteRetry.at<=now&&now<rec.answerBy){
      const n=rec.inviteRetry.n+1;
      if(await this.enqueue(tx,fx,{to:rec.recipient,certificates:[rec.mine.certificate],messages:[rec.inviteCompact],offers:rec.offerToken?[rec.offerToken]:[],until:rec.answerBy,invite:rec.sid}))rec.inviteRetry={acked:true,n,at:n<INVITE_RESEND_DELAYS.length?now+INVITE_RESEND_DELAYS[n]:null};
      else rec.inviteRetry={...rec.inviteRetry,at:now+INVITE_RESEND_DELAYS[0]};
      if(rec.inviteRetry.n>=INVITE_RESEND_DELAYS.length){delete rec.inviteCompact;delete rec.inviteRetry;delete rec.offerToken;}
      await tx.put(key,rec);
     }
     if(rec.inviteRetry?.at&&rec.inviteRetry.at<rec.answerBy)soon(rec.inviteRetry.at);
    }
    if(!rec.own&&isLive(rec))live.push(party(rec.role==='initiator'?rec.recipient:rec.initiator));
    soon(rec.state==='pending'?rec.answerBy:rec.endsAt);for(const l of legs)if(l.gapSince!==null)soon(l.gapSince+ORDER_LIMITS.gapMs+1);
   }
   for(const ep of [...(await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values()]){
    if(!(ep.expiresAt>now)){await this.removeEndpoint(tx,fx,ep,now);continue;}
    if(await this.dropQueue(tx,ep,{now,sensitive:true}))await tx.put(K.endpoint(ep.id),ep);
    for(const row of (await tx.list({prefix:K.queuePrefix(ep.id),limit:BOUNDS.queueEvents})).values())if(row.expiresAt)soon(row.expiresAt);
   }
   for(const [key,row] of await tx.list({prefix:K.delegatePrefix,limit:4096}))if(row.until<=now)await tx.delete(key);
   for(const [key,row] of await tx.list({prefix:K.aepPrefix,limit:4096}))if(row.until<=now)await tx.delete(key);
   await pruneLimits(tx,now);
  });
  if(this.relay){const swept=await this.relay.sweep(owner).catch(()=>null);if(swept?.wakeAt)wake=Math.min(wake,Math.max(swept.wakeAt,this.now()+1000));}
  try{this.keys.live?.(live.filter(p=>p.iss!==this.issuer));}catch{/* best effort */}
  const drained=await this.drain(owner).catch(()=>({pending:1}));if(drained.pending||drained.more)wake=Math.min(wake,this.now()+1000);
  return {wakeAt:Number.isFinite(wake)?wake:null,pending:drained.pending??0};
 }
}
/** An incoming record that ends silently when its owner ends it (pending, unclaimed). */
export const silentEndable=rec=>rec?.role==='recipient'&&rec.state==='pending'&&!rec.claim;
/** The owner's view of one live session (never SDP, candidates, data, context, offer tokens or keys). */
export function sessionView(rec){
 return {sid:rec.sid,role:rec.role,state:rec.state,own:rec.own,peer:party(rec.role==='initiator'?rec.recipient:rec.initiator),kind:rec.kind.artefact,profile:rec.profile,clientId:rec.mine?.clientId??null,createdAt:rec.createdAt,answerBy:rec.answerBy,endsAt:rec.endsAt,...rec.role==='recipient'?{claimed:Boolean(rec.claim),initiatorOrigin:rec.initiatorClient?.origin??null}:{}};
}

// ---- engine operations ---------------------------------------------------------------------------------------------------
const CHANGED='signaling-changed';
/** The `signaling` provider class over one SignalingService (one per entity account writer). */
export function signalingProvider(service){return class extends Provider{static deps=[];obtain(){return service;}release(){}};}
class SignalingAction extends AppAction{static deps=['signaling'];static changes=CHANGED;}
class SignalingQuery extends AppQuery{static deps=['signaling'];static refreshOn=[CHANGED];}
// Endpoint operations (the signaling contract, §10.2).
export class SignalingRegister extends SignalingAction{static operation='signaling.register';run({signaling}){return signaling.register(this.actor,this.input);}}
export class SignalingUnregister extends SignalingAction{static operation='signaling.unregister';static lifecycle='suspended';run({signaling}){return signaling.unregister(this.actor,this.input);}}
export class SignalingOpen extends SignalingAction{static operation='signaling.open';run({signaling}){return signaling.open(this.actor,this.input);}}
export class SignalingOffer extends SignalingAction{static operation='signaling.offer';run({signaling}){return signaling.offer(this.actor,this.input);}}
export class SignalingRevokeOffer extends SignalingAction{static operation='signaling.revoke-offer';static lifecycle='suspended';run({signaling}){return signaling.revokeOffer(this.actor,this.input);}}
export class SignalingClaim extends SignalingAction{static operation='signaling.claim';run({signaling}){return signaling.claim(this.actor,this.input);}}
export class SignalingSend extends SignalingAction{static operation='signaling.send';run({signaling}){return signaling.send(this.actor,this.input);}}
export class SignalingRenew extends SignalingAction{static operation='signaling.renew';run({signaling}){return signaling.renew(this.actor,this.input);}}
// A long poll stays a Query (as rtc.listen was), so a 25 s wait never queues behind or holds an Action.
export class SignalingListen extends SignalingQuery{static operation='signaling.listen';static lifecycle='suspended';fetch({signaling}){return signaling.listen(this.actor,this.input);}}
export class SignalingEndpoints extends SignalingQuery{static operation='signaling.endpoints';static lifecycle='suspended';fetch({signaling}){return signaling.endpoints(this.actor,this.input??{});}}
// Owner operations.
export class SignalingPolicy extends SignalingQuery{static operation='signaling.policy';static lifecycle='suspended';fetch({signaling}){return signaling.policy(this.actor);}}
export class SignalingSetPolicy extends SignalingAction{static operation='signaling.set-policy';static lifecycle='suspended';run({signaling}){return signaling.setPolicy(this.actor,this.input);}}
export class SignalingBlock extends SignalingAction{static operation='signaling.block';static lifecycle='suspended';run({signaling}){return signaling.block(this.actor,this.input);}}
export class SignalingUnblock extends SignalingAction{static operation='signaling.unblock';run({signaling}){return signaling.unblock(this.actor,this.input);}}
export class SignalingBlocked extends SignalingQuery{static operation='signaling.blocked';static lifecycle='suspended';fetch({signaling}){return signaling.blocked(this.actor);}}
export class SignalingEndSession extends SignalingAction{static operation='signaling.end-session';static lifecycle='suspended';run({signaling}){return signaling.endSession(this.actor,this.input);}}
export class SignalingRevokeEndpoint extends SignalingAction{static operation='signaling.revoke-endpoint';static lifecycle='suspended';run({signaling}){return signaling.revokeEndpoint(this.actor,this.input);}}
export class SignalingEndpointList extends SignalingQuery{static operation='signaling.endpoint-list';static lifecycle='suspended';fetch({signaling}){return signaling.endpointList(this.actor);}}
export class SignalingOffers extends SignalingQuery{static operation='signaling.offers';static lifecycle='suspended';fetch({signaling}){return signaling.offersList(this.actor);}}
export class SignalingRevokeOffers extends SignalingAction{static operation='signaling.revoke-offers';static lifecycle='suspended';run({signaling}){return signaling.revokeOffers(this.actor,this.input);}}
export class SignalingSessions extends SignalingQuery{static operation='signaling.sessions';static lifecycle='suspended';fetch({signaling}){return signaling.sessions(this.actor);}}
export class SignalingPairings extends SignalingQuery{static operation='signaling.pairings';static lifecycle='suspended';fetch({signaling}){return signaling.pairings(this.actor);}}
export class SignalingCreatePairing extends SignalingAction{static operation='signaling.pairing-create';run({signaling}){return signaling.createPairing(this.actor,this.input);}}
export class SignalingActivatePairing extends SignalingAction{static operation='signaling.pairing-activate';run({signaling}){return signaling.activatePairing(this.actor,this.input);}}
export class SignalingUpdatePairing extends SignalingAction{static operation='signaling.pairing-update';static lifecycle='suspended';run({signaling}){return signaling.updatePairing(this.actor,this.input);}}
export class SignalingRemovePairing extends SignalingAction{static operation='signaling.pairing-remove';static lifecycle='suspended';run({signaling}){return signaling.removePairing(this.actor,this.input);}}
export class SignalingServiceDesignation extends SignalingQuery{static operation='signaling.service';static lifecycle='suspended';fetch({signaling}){return signaling.serviceDesignation(this.actor);}}
export class SignalingSetServiceDesignation extends SignalingAction{static operation='signaling.set-service';static lifecycle='suspended';run({signaling}){return signaling.setServiceDesignation(this.actor,this.input);}}
// Owner pages (owner-pages.mjs): the review a page takes before a widening action, and one pairing's page read.
export class SignalingReview extends SignalingAction{static operation='signaling.review';run({signaling}){return signaling.review(this.actor,this.input);}}
export class SignalingPairingDetail extends SignalingQuery{static operation='signaling.pairing';static lifecycle='suspended';fetch({signaling}){return signaling.pairingDetail(this.actor,this.input);}}
export class SignalingExport extends SignalingQuery{static operation='signaling.export';static lifecycle='suspended';fetch({signaling}){return signaling.exportRecords(this.actor);}}
// Intents session handler approvals (AMD-SG-I1), owner operations on this engine (the records live in intents memory).
export class IntentsSessionApprovals extends SignalingQuery{static operation='intents.session-approvals';static lifecycle='suspended';fetch({signaling}){return signaling.approvals(this.actor);}}
export class IntentsSessionApprove extends SignalingAction{static operation='intents.session-approve';run({signaling}){return signaling.approve(this.actor,this.input);}}
export class IntentsSessionUnapprove extends SignalingAction{static operation='intents.session-unapprove';static lifecycle='suspended';run({signaling}){return signaling.unapprove(this.actor,this.input);}}
export class IntentsSessionAutoConnect extends SignalingAction{static operation='intents.session-auto-connect';static lifecycle='suspended';run({signaling}){return signaling.setAutoConnect(this.actor,this.input);}}
// System operations (never wire-dispatchable): adapters build the system actor from verified evidence.
class SignalingSystem extends AppAction{static deps=['signaling'];static changes=CHANGED;static lifecycle='suspended';}
export class SignalingIngest extends SignalingSystem{static operation='signaling.ingest';run({signaling}){return signaling.ingest(this.actor,this.input);}}
export class SignalingTick extends SignalingSystem{static operation='signaling.tick';run({signaling}){return signaling.tick(this.actor);}}
export class SignalingInbox extends SignalingSystem{static operation='signaling.inbox';run({signaling}){signaling.system(this.actor);return signaling.processInbox(this.actor.owner,{limit:Number.isSafeInteger(this.input?.limit)&&this.input.limit>0&&this.input.limit<=256?this.input.limit:16});}}
export class SignalingOutboxDrain extends SignalingSystem{static operation='signaling.outbox-drain';run({signaling}){signaling.system(this.actor);return signaling.drain(this.actor.owner,{limit:Number.isSafeInteger(this.input?.limit)&&this.input.limit>0&&this.input.limit<=256?this.input.limit:32});}}
export class SignalingLifecycle extends SignalingSystem{static operation='signaling.lifecycle';run({signaling}){return signaling.lifecycle(this.actor,this.input);}}
// The built-in ice-relay/v1 resource (relay.mjs). `credentials` is the relay contract's one method.
export class SignalingRelayCredentials extends SignalingAction{static operation='signaling.relay-credentials';run({signaling}){if(!signaling.relay)notFound();return signaling.relay.credentials(this.actor,this.input);}}
export class SignalingRelaySweep extends SignalingSystem{static operation='signaling.relay-sweep';run({signaling}){const owner=signaling.system(this.actor);return signaling.relay?signaling.relay.sweep(owner):{revoked:0,pending:0,wakeAt:null};}}

export const ENDPOINT_OPERATIONS=Object.freeze([SignalingRegister,SignalingUnregister,SignalingOpen,SignalingOffer,SignalingRevokeOffer,SignalingClaim,SignalingSend,SignalingRenew,SignalingListen,SignalingEndpoints]);
export const OWNER_OPERATIONS=Object.freeze([SignalingPolicy,SignalingSetPolicy,SignalingBlock,SignalingUnblock,SignalingBlocked,SignalingEndSession,SignalingRevokeEndpoint,SignalingEndpointList,SignalingOffers,SignalingRevokeOffers,SignalingSessions,SignalingPairings,SignalingCreatePairing,SignalingActivatePairing,SignalingUpdatePairing,SignalingRemovePairing,SignalingServiceDesignation,SignalingSetServiceDesignation,SignalingReview,SignalingPairingDetail,SignalingExport,IntentsSessionApprovals,IntentsSessionApprove,IntentsSessionUnapprove,IntentsSessionAutoConnect]);
export const SYSTEM_OPERATIONS=Object.freeze([SignalingIngest,SignalingInbox,SignalingTick,SignalingOutboxDrain,SignalingLifecycle,SignalingRelaySweep]);
export const RELAY_OPERATIONS=Object.freeze([SignalingRelayCredentials]);
export const RELAY_CONTRACT_OPERATIONS=Object.freeze({credentials:'signaling.relay-credentials'});
/** Operations no signaling flag ever gates (§14.1 narrowing, and reads of existing state). Decline claims, `send` of
 * only end/cancel/decline and narrowing set-policy/pairing updates are decided inside the engine. */
export const NEVER_GATED=Object.freeze(['signaling.unregister','signaling.revoke-offer','signaling.end-session','signaling.revoke-endpoint','signaling.block','signaling.revoke-offers','signaling.pairing-remove','signaling.listen','signaling.endpoints','signaling.policy','signaling.blocked','signaling.endpoint-list','signaling.offers','signaling.sessions','signaling.pairings','signaling.pairing','signaling.service','signaling.export','intents.session-approvals','intents.session-unapprove','signaling.ingest','signaling.inbox','signaling.tick','signaling.outbox-drain','signaling.lifecycle','signaling.relay-sweep']);
/** Operations that answer the uniform 404 while signaling is off (the engine rechecks every gate). */
export const WIDENING=Object.freeze(new Set(['signaling.register','signaling.open','signaling.offer','signaling.renew','signaling.unblock','signaling.relay-credentials','signaling.pairing-create','signaling.pairing-activate','intents.session-approve','signaling.review']));
/** The contract's method names (§10.2) → engine operations, for the RPC adapter. */
export const CONTRACT_OPERATIONS=Object.freeze({register:'signaling.register',unregister:'signaling.unregister',endpoints:'signaling.endpoints',open:'signaling.open',offer:'signaling.offer',revoke_offer:'signaling.revoke-offer',claim:'signaling.claim',send:'signaling.send',renew:'signaling.renew',listen:'signaling.listen'});
export {DEFAULT_POLICY,iatWithinWindow,LIMIT_VALUES,BOUNDS,PROFILES};
