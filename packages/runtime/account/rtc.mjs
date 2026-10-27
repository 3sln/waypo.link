// RTC-d account slice: the rtc-signaling/v1 built-in occupant in each entity's own writer (docs/architecture/
// rtc-signaling.md §3.1, §3.4, §8.1; engine operations in packages/app/domains/rtc.mjs, rules in packages/rtc/*.mjs).
// Provisional (coordinator), not signed off by the user; behind RTC_SIGNALING_ENABLED (default off). `methods` are
// installed on AccountController.prototype (`this` is the controller); `rpc` lists what `invoke` accepts.
//
//   rtcDispatch(owner, {operation, actor, input})  endpoint and owner operations. The actor comes from a trusted adapter
//                                                  (the RTC-e RPC router builds {kind:'app'} from the verified federation
//                                                  RPC context; owner routes build {kind:'owner'}), never from a request
//                                                  body; its owner must be this writer's owner. While RTC_SIGNALING_ENABLED
//                                                  is off every widening operation answers the uniform 404
//                                                  (packages/runtime/public-unknown.mjs `lookupUnknown`).
//   rtcListen(owner, {actor, input})               rtc.listen outside the account gate (a long poll never holds the writer)
//   rtcPeer(owner, {operation, input})             the same-host transport target: only `rtc.ingest`, as a system step.
//                                                  Gate 'none' (as relationsPeer): two writers delivering to each other
//                                                  never wait on each other's account gate; each step is its own storage
//                                                  transaction. Ingest only queues the step-1-valid batch and answers;
//                                                  steps 2–8 run on this writer's detached task or alarm (review M2).
//   rtcPublicKeys(subject)                         local read for peers on this host (gate none): the identity URI,
//                                                  ACTIVE certification keys (directory shape), handle and `aep`
//   rtcAlarm()                                     account alarm hook: rtc.tick (expiry, retention, outbox drain)
//   rtcDrain(owner)                                account deletion E4 hook (DRAINS): rtc.lifecycle `deletion` once, then
//                                                  the outbox, so peers get control statements before the purge
//   rtcRosterDirectory({control})                  tests and operators (internal): the RTC directory (review F2)
//   rtcContractListen(owner, context)              RTC-e: the contract's `listen` from the verified federation RPC
//                                                  dispatch context, outside the account gate (a real long poll)
//   rtcAppChanged(owner, {clientId, purposes, at}) RTC-e: the federation shard's bound-approval hook after a grant
//                                                  revocation, an app removal or bound narrowing: `purposes: null`
//                                                  runs rtc.lifecycle `app-revoked`, a list runs `app-narrowed`. RTC-i
//                                                  review L1: it first records {purposes, revision, at} for the client
//                                                  (rtc/approval/), which contractActor intersects with any older
//                                                  dispatch approval
//   rtcAppRevoked(owner, {clientId?, all?})        RTC-e: the account's connection cascade (disconnect, removal,
//                                                  sever) runs rtc.lifecycle `app-revoked` (internal)
//   rtcResourceMethod(c, owner, context)           RTC-e: the RESOURCE_METHOD_HANDLERS entry for the signaling contract
//                                                  (packages/runtime/account/storage.mjs): builds {kind:'app'} from the
//                                                  verified dispatch context and calls rtcDispatch (`listen` here never
//                                                  waits: it runs inside the account gate)
//   rtcRelayResourceMethod(c, owner, context)      RTC-f: the RESOURCE_METHOD_HANDLERS entry for ice-relay/v1 (the
//                                                  built-in relay occupant `${subject}/relay`): the same verified actor,
//                                                  `credentials` → rtc.relay-credentials
//
// Ports (all built here; none is called inside a storage transaction, and nothing fetches another provider):
//   keys          same-host principals: the peer writer's rtcPublicKeys, memoized 60 s. Foreign principals (RTC-e):
//                 the RtcKeyRoster (packages/rtc/federation.mjs) over an IdentityDirectory built only while
//                 DIRECTORY_ENABLED, RTC_FOREIGN_ENABLED (for this owner), a DIRECTORY_EGRESS port and a non-empty
//                 RTC_FOREIGN_ISSUERS allowlist are all present; reads are cache-only, fetches run in the background
//                 (detached task, alarm) or at `open` (§4.1)
//   signer        certificationSigner over this account (the person's or organization's ACTIVE certification key)
//   linkSigner    the identity signing key (ticket metas)
//   bound         config.RTC_BOUND_CHECK(input) -> boolean: FederationService.checkBound, wired by the adapter (RTC-e);
//                 absent means nothing is approved, so every endpoint operation is refused (fail closed). Used only
//                 outside the account gate (fan-out eligibility); a contract RPC's actor carries the approval from its
//                 verified dispatch context instead (RTC-i bug 1: no call into the federation shard inside the gate)
//   contacts      ContactEndpointService.inspect over this owner's contact links
//   transport     foreignRtcTransport (RTC-e): same-host principals through sameHostRtcTransport over rtcPeer; other
//                 issuers only through the adapter's SSRF-screened RTC_EGRESS ({send}), the RTC_FOREIGN_ISSUERS
//                 allowlist and the peer's validated manifest endpoint
//   pushTransport config.RTC_PUSH ?? LIFECYCLE_PUSH ?? createPushTransport (PUSH_ENABLED and VAPID keys), the
//                 existing Web Push transport (RTC-e doorbell)
//   defer         a detached task on this controller (one at a time) running rtc.inbox and rtc.outbox-drain after the
//                 current request has answered; the alarm (rtc.tick, also scheduled) is the durable fallback
//   relay         RTC-f: RtcRelay over the service: the TURN adapter from turnAdapterFrom(config) (RTC_TURN_ADAPTER, or
//                 CloudflareTurnAdapter from CLOUDFLARE_TURN_KEY_ID and the CLOUDFLARE_TURN_API_TOKEN secret), the
//                 external spend authority config.RTC_RELAY_SPEND (none in production: the relay-spend budget gate),
//                 the owner's plan from the billing entitlement, and `defer` (revocation on this controller's detached
//                 task; the alarm's rtc.tick sweep is the fallback)
//   hostLimits    config.WORK_AUTHORITY.consume (the host's shared fixed-window guard, as message postbacks use it),
//                 keyed by an HMAC of the caller principal (ABUSE_HASH_KEY or KEY_ENCRYPTION_KEY; SHA-256 without one)
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {flagsFor} from './flags.mjs';
import {lifecycleBlocked} from '../lifecycle-runner.mjs';
import {certificationSigner,certificationKeyList} from '../../identity/member-certificates.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {base64url} from '../../core/records.mjs';
import {siteGlobal} from '../../flags/read.mjs';
import {IdentityDirectory} from '../../federation/directory.mjs';
import {foreignIssuers,directoryHostLimiter} from './foreign-directory.mjs';
import {createPushTransport} from '../../messaging/web-push.mjs';
import {RtcKeyRoster,RtcDeliveryError,foreignRtcTransport,rtcEgress} from '../../rtc/federation.mjs';
import {RTC_FEATURE,RTC_SIGNALING_CONTRACT,RTC_SIGNALING_SLOT} from '../../rtc/extension.mjs';
import {RtcService,rtcProvider,sameHostRtcTransport,RTC_ENDPOINT_OPERATIONS,RTC_OWNER_OPERATIONS,RTC_WIDENING,RTC_SIGNALING_FLAG,RTC_LIMIT_VALUES,RtcIngest,RtcInbox,RtcTick,RtcLifecycle,RtcOutboxDrain,RTC_CONTRACT_OPERATIONS,RTC_FOREIGN_FLAG,RtcRelay,RtcRelaySweep,RTC_RELAY_OPERATIONS,RTC_RELAY_CONTRACT_OPERATIONS,RTC_TURN_FLAG,turnAdapterFrom} from '../../app/domains/rtc.mjs';
import {ICE_RELAY_CONTRACT} from '../../rtc/extension.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,MEMO_MS=60000;
const WIRE=Object.freeze(Object.fromEntries([...RTC_ENDPOINT_OPERATIONS,...RTC_OWNER_OPERATIONS,...RTC_RELAY_OPERATIONS].map(O=>[O.operation,O])));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const notFound=()=>{throw new StorageError('not_found','Not found.',404);};
const memories=new WeakMap();
const memory=c=>{let m=memories.get(c);if(!m){m={parties:new Map(),kicking:false,again:false,owner:null,directory:null,push:undefined,relay:false};memories.set(c,m);}return m;};
/** RTC-e: the foreign-issuer allowlist for RTC (same parser and rules as ORG_FOREIGN_ISSUERS; empty by default). */
export const rtcForeignIssuers=config=>foreignIssuers(config,'RTC_FOREIGN_ISSUERS');
const foreignOn=(config,owner)=>{try{return typeof owner==='string'&&flagsFor(config,{subject:{kind:'account',owner}}).enabled(RTC_FOREIGN_FLAG)===true;}catch{return false;}};
/** RTC-e: this entity's IdentityDirectory for RTC peers (one per controller, rebuilt when the allowlist changes), or
 * null while any gate is missing. It keeps rtc-signaling.v1 from manifests and spends the shared directory egress as
 * tenant `owner`, and (review F4) the host-wide per-site budgets through WORK_AUTHORITY. Pins live in this account's
 * store beside the organization directory's (same pin rules). `control: true` (review F2) is the control-only
 * delivery path: gated by the allowlist, DIRECTORY_ENABLED and the egress, never by RTC_FOREIGN_ENABLED, so the kill
 * switch never suppresses a `revoked` or `failed` control statement. */
function rtcDirectory(c,{control=false}={}){
 const config=c.config,m=memory(c);if(!m.owner||typeof config.DIRECTORY_EGRESS!=='function'||!siteGlobal(config,'DIRECTORY_ENABLED')||control!==true&&!foreignOn(config,m.owner))return null;
 const issuers=rtcForeignIssuers(config);if(!issuers.length)return null;const key=JSON.stringify([m.owner,issuers]);
 if(m.directory?.key===key)return m.directory.value;
 const value=new IdentityDirectory({config,issuers,feature:'rtc',tenant:m.owner,features:[RTC_FEATURE],fetch:config.DIRECTORY_EGRESS(issuers),hostLimiter:directoryHostLimiter(config),store:{transaction:fn=>c.metadata.transaction(tx=>fn({get:k=>tx.get(k),set:(k,v)=>tx.put(k,v)}))}});
 m.directory={key,value};return value;
}

/** A same-host principal's public RTC record: this writer for its own owner, else the peer writer (memoized 60 s). */
async function partyRecord(c,sub){
 if(!UUID.test(sub??''))return null;const m=memory(c),now=Date.now(),hit=m.parties.get(sub);if(hit&&now-hit.at<MEMO_MS)return hit.value;
 let value=null;
 try{if(await c.metadata.get('owner')===sub)value=await c.rtcPublicKeys(sub);else{const stub=c.config.CONVERSATION_ACCOUNT?.(sub);const r=stub?await stub.invoke({method:'rtcPublicKeys',args:[sub]}):null;value=r?.$fault?null:r??null;}}catch{value=null;}
 m.parties.set(sub,{value,at:now});if(m.parties.size>2048)m.parties.delete(m.parties.keys().next().value);return value;
}

/** Review L1: the host-wide limiter port over the shared WORK_AUTHORITY guard; null where the host has none. */
function hostLimitsFor(config){
 const authority=config.WORK_AUTHORITY;if(typeof authority?.consume!=='function')return null;
 const secret=config.ABUSE_HASH_KEY||config.KEY_ENCRYPTION_KEY;let key=null;
 const hash=async text=>{const bytes=new TextEncoder().encode(text);
  if(typeof secret==='string'&&secret){key??=await crypto.subtle.importKey('raw',new TextEncoder().encode('rtc-limit\0'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)));}
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));};
 return {async take(name,parts){const l=RTC_LIMIT_VALUES[name];if(!l)return false;return await authority.consume(`rtc-${name}-v1/${await hash(JSON.stringify([name,...parts]))}`,{limit:l.max,windowMs:l.windowMs})===true;}};
}
/** Review M2: runs queued inbound batches and the outbox on a detached task after the current request answered
 * (one at a time per controller; it repeats while work remains, up to a bound, and the alarm covers the rest). */
function kick(c){
 const m=memory(c);if(m.kicking){m.again=true;return;}m.kicking=true;
 setTimeout(async()=>{
  try{const owner=await c.metadata.get('owner');if(owner)for(let i=0;i<8;i++){m.again=false;
   const inbox=await run(c,new RtcInbox({actor:system(owner),input:{limit:32}})),out=await run(c,new RtcOutboxDrain({actor:system(owner),input:{limit:64}}));
   if(m.relay){m.relay=false;await run(c,new RtcRelaySweep({actor:system(owner)})).catch(()=>{m.relay=true;return c.scheduleAlarm(Date.now()+60000).catch(()=>null);});}// RTC-f: ended legs' credentials (the sweep re-arms the alarm while revocations remain; a failed pass does here)
   await rtcEngine(c).roster.run({limit:4}).catch(()=>null);// RTC-e: scheduled key refreshes, in the background
   if(!inbox.more&&!out.more&&!m.again)break;}}
  catch{/* the alarm retries */}
  finally{m.kicking=false;if(m.again){m.again=false;kick(c);}}
 },0);
}
const signerFor=c=>certificationSigner({metadata:c.metadata,seal:v=>encryptSecret(v,c.config.KEY_ENCRYPTION_KEY),open:v=>decryptSecret(v,c.config.KEY_ENCRYPTION_KEY)});
const engines=new WeakMap();
/** This entity's RTC service and engine (one per controller). */
export function rtcEngine(c){
 let entry=engines.get(c);if(entry)return entry;
 const config=c.config,issuer=config.APP_ORIGIN,local=p=>p?.iss===issuer&&UUID.test(p?.sub??''),m=memory(c);
 const allowLoopback=config.LOCAL_DEVELOPMENT==='true';
 const roster=new RtcKeyRoster({issuer,directory:options=>rtcDirectory(c,options),allowLoopback});
 const sameHost=sameHostRtcTransport({issuer,dispatch:async(sub,operation,input)=>{
  const stub=config.CONVERSATION_ACCOUNT?.(sub);if(!stub)throw new StorageError('temporarily_unavailable','Unavailable.',503);
  const result=await stub.invoke({method:'rtcPeer',args:[sub,{operation,input}]});
  if(result?.$fault)throw new StorageError(result.$fault.code,result.$fault.message,result.$fault.status);return result;}});
 // RTC-e: outbound foreign delivery only through the adapter's screened egress and the allowlist (no egress, no
 // allowlist or the flag off: the outbox keeps retrying until the item's useful life, then drops it).
 const post=async(url,body)=>{const egress=config.RTC_EGRESS,issuers=rtcForeignIssuers(config);if(typeof egress?.send!=='function'||!issuers.length)throw new RtcDeliveryError('rtc_egress_unavailable');return rtcEgress({send:input=>egress.send(input),issuers})(url,body);};
 const transport=foreignRtcTransport({issuer,local:sameHost,roster,post,enabled:async from=>foreignOn(config,from?.sub)&&siteGlobal(config,'DIRECTORY_ENABLED'),current:async p=>p});
 const pushTransport={send:(subscription,payload,options)=>{if(m.push===undefined)m.push=config.RTC_PUSH??config.LIFECYCLE_PUSH??createPushTransport(config)??null;if(typeof m.push?.send!=='function')throw Object.assign(new Error('Push is unavailable.'),{code:'push_unavailable'});return m.push.send(subscription,payload,options);}};
 const service=new RtcService({store:c.metadata,issuer,clock:{now:()=>Date.now()},random:cryptoRandom,flags:{for:ctx=>flagsFor(config,ctx)},
  keys:{
   certification:async p=>local(p)?(await partyRecord(c,p.sub))?.certification??[]:roster.certification(p),
   identity:async p=>local(p)?(await partyRecord(c,p.sub))?.identity??null:roster.identity(p),
   handle:async p=>local(p)?(await partyRecord(c,p.sub))?.handle??null:null,// foreign handles are never shown (no verified binding held)
   aep:async owner=>(await partyRecord(c,owner))?.aep??0,
   refresh:(p,kid,options)=>local(p)?false:roster.refresh(p,kid,options),unsupported:p=>local(p)?false:roster.unsupported(p),live:principals=>roster.live(principals),track:p=>roster.track(p),warm:p=>roster.warm(p),maxLegSeconds:p=>roster.maxLegSeconds(p),
  },
  signer:owner=>signerFor(c)(owner),
  linkSigner:async owner=>{const k=await c.signingKey(owner);return k?{kid:k.kid,privateKey:k.privateKey}:null;},
  bound:typeof config.RTC_BOUND_CHECK==='function'?{check:input=>config.RTC_BOUND_CHECK(input)}:null,
  contacts:{inspect:async link=>{const owner=await c.metadata.get('owner');let inspected=null;try{inspected=await c.endpoints?.inspect(link);}catch{inspected=null;}const g=inspected?.grant;return g&&g.owner===owner&&typeof g.id==='string'?{parent:g.id,quarantined:g.quarantined===true}:null;}},
  transport,pushTransport,defer:()=>kick(c),hostLimits:hostLimitsFor(config),allowLoopback});
 // RTC-f: the built-in ice-relay/v1 occupant. Unreachable unless both flags are on for the owner AND both ports exist.
 service.attachRelay(new RtcRelay({service,adapter:turnAdapterFrom(config),spend:typeof config.RTC_RELAY_SPEND?.reserve==='function'?config.RTC_RELAY_SPEND:null,
  plan:async owner=>{try{return (await c.billing?.entitlement(owner))?.plan??'free';}catch{return 'free';}},
  defer:()=>{m.relay=true;kick(c);},wake:(owner,time)=>c.scheduleAlarm(time)}));// review L3: pending revocations re-arm the alarm
 entry={service,roster,engine:createAppEngine({providers:{clock:{now:()=>Date.now()},random:cryptoRandom,audit:nullAudit,rtc:rtcProvider(service)}})};
 engines.set(c,entry);return entry;
}
const run=(c,operation)=>{const owner=operation?.actor?.owner;if(typeof owner==='string'&&UUID.test(owner))memory(c).owner??=owner;return runOp(c,operation);};
const runOp=(c,operation)=>operation instanceof AppQuery?read(rtcEngine(c).engine,operation):perform(rtcEngine(c).engine,operation);
const system=owner=>({kind:'system',owner});
const enabled=(c,owner)=>{try{return flagsFor(c.config,{subject:{kind:'account',owner}}).enabled(RTC_SIGNALING_FLAG)===true;}catch{return false;}};
/** RTC-f: the relay also needs RTC_TURN_ENABLED (class b: its `requires` is not evaluated from env, so both are read). */
const relayEnabled=(c,owner)=>{try{return enabled(c,owner)&&flagsFor(c.config,{subject:{kind:'account',owner}}).enabled(RTC_TURN_FLAG)===true;}catch{return false;}};
const hasState=async c=>(await c.metadata.list({prefix:'rtc/',limit:1})).size>0;
/** RTC-i review L1: the account-local record of the last bound change the federation shard reported for a client
 * (`rtc/approval/<SHA-256 of the client id>`): {clientId, purposes (a list, or null when no bound grant remains),
 * revision (a local counter), at (the shard's clock when it read the remaining grants)}. One row per client that
 * ever had a change; replaced, never appended. */
const APPROVAL_PREFIX='rtc/approval/';
const approvalKey=async clientId=>APPROVAL_PREFIX+base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('rtc-approval\0'+clientId))));
/** The dispatch approval narrowed by the client's approval record when that record is at least as new as the
 * approval (the approval's `at` is not later than the record's): a narrowing or revocation that committed after the
 * RPC's authorization transaction but whose hook entered this account's gate first is never bypassed. A malformed
 * record approves nothing (fail closed). An approval read after the record (a later approval or narrowing) stands. */
function narrowedApproval(approval,at,record){
 if(record===undefined||record===null)return approval;
 if(!plain(record)||!Number.isSafeInteger(record.at)||!(record.purposes===null||Array.isArray(record.purposes)))return {values:{},versions:{}};
 if(Number.isSafeInteger(at)&&at>record.at)return approval;
 if(record.purposes===null)return {values:{},versions:{}};
 const keep=new Set(record.purposes),values={};
 for(const [name,list]of Object.entries(approval.values))values[name]=name==='purposes'&&Array.isArray(list)?list.filter(v=>keep.has(v)):list;
 const lines=new Set(Array.isArray(values.purposes)?values.purposes:[]);
 return {values,versions:Object.fromEntries(Object.entries(approval.versions).filter(([line])=>lines.has(line)))};
}

/** RTC-e: the {kind:'app'} actor from the VERIFIED federation RPC dispatch context (never from arguments): the token's
 * subject owner, client, the client's registered origin, the token's grant ids (required by checkBound), its epoch
 * and, for a DPoP-bound token, the key's jkt. Live checks as every built-in contract handler makes them. */
async function contractActor(c,owner,context,{contract=RTC_SIGNALING_CONTRACT,resource='rtc',operations=RTC_CONTRACT_OPERATIONS,signaling=true}={}){
 const forbidden=()=>{throw new StorageError('forbidden','Real-time connection access denied.',403);};
 const origin=c.config.APP_ORIGIN,subject=`${origin}/entities/${owner}`;
 if(!plain(context)||context.authority!=='bindle'||context.contract!==contract||context.subject!==subject||context.resource!==`${subject}/${resource}`||context.resourceGeneration!==owner||!plain(context.connection)||typeof context.connection.id!=='string'||!Number.isSafeInteger(context.connection.generation)||context.epoch===undefined||context.epoch===null||typeof context.clientId!=='string'||!plain(context.args))forbidden();
 const operation=typeof context.method==='string'&&Object.hasOwn(operations,context.method)?operations[context.method]:null;if(!operation)throw new StorageError('unsupported_method','Unsupported signaling method.',400);
 if(!Array.isArray(context.grants)||!context.grants.length||context.grants.length>256||context.grants.some(g=>typeof g!=='string'))forbidden();
 let appOrigin=null;try{appOrigin=new URL(typeof context.clientOrigin==='string'?context.clientOrigin:context.clientId).origin;}catch{appOrigin=null;}if(!appOrigin||appOrigin==='null')forbidden();
 if(typeof c.config.FEDERATION_IDENTITY_CHECK!=='function'||await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)throw new StorageError('unauthorized','Application authorization is no longer active.',401);
 await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);
 // RTC-i (bug 1): this handler runs inside the owner's account gate, so it must never call into the federation shard
 // (whose gate another RPC may hold while it waits on this account: tokenRecord's connection check). The bound
 // approval of the signaling fragment comes with the verified dispatch context instead (FederationService rpc
 // `bound`, computed in that RPC's own authorization transaction); without one nothing is approved (fail closed).
 // RTC-i review L1: that approval is narrowed by the client's account-local approval record (rtcAppChanged), so a
 // narrowing or revocation whose hook entered this gate before this RPC is never bypassed by an older snapshot.
 // RTC-i review (relay actor): the ice-relay/v1 actor carries an EMPTY approval. Issuance needs a live leg of a session
 // that signaling approval admitted (and narrowing or revocation ends such sessions); the signaling slot's approval
 // is not the relay grant, and an empty one keeps any future approval check on this path closed and off the shard.
 const bound=signaling&&plain(context.bound)&&Object.hasOwn(context.bound,RTC_SIGNALING_SLOT)?context.bound[RTC_SIGNALING_SLOT]:null;
 let approval=plain(bound)&&plain(bound.values)&&plain(bound.versions)?{values:structuredClone(bound.values),versions:structuredClone(bound.versions)}:{values:{},versions:{}};
 if(signaling){let record;try{record=await c.metadata.get(await approvalKey(context.clientId));}catch{record=false;}approval=narrowedApproval(approval,plain(bound)?bound.at:undefined,record===false?{}:record);}
 return {operation,actor:{kind:'app',owner,clientId:context.clientId,origin:appOrigin,grants:[...context.grants],epoch:context.epoch,bound:approval,...typeof context.jkt==='string'?{jkt:context.jkt}:{}}};
}
/** RTC-e RESOURCE_METHOD_HANDLERS entry for `rtc-signaling/v1` (inside the account gate: `listen` never waits here;
 * the runtime dispatcher sends `listen` to rtcContractListen, outside the gate). */
export async function rtcResourceMethod(c,owner,context){
 const {operation,actor}=await contractActor(c,owner,context);
 if(operation==='rtc.listen'){const input={...context.args,...context.args.wait!==undefined?{wait:0}:{}};return c.rtcListen(owner,{actor,input});}
 return c.rtcDispatch(owner,{operation,actor,input:context.args});
}

/** RTC-f RESOURCE_METHOD_HANDLERS entry for `ice-relay/v1` on the built-in relay occupant (`${subject}/relay`, declared
 * only while both flags are on and the relay is configured): the verified actor, then rtc.relay-credentials. */
export async function rtcRelayResourceMethod(c,owner,context){
 const {operation,actor}=await contractActor(c,owner,context,{contract:ICE_RELAY_CONTRACT,resource:'relay',operations:RTC_RELAY_CONTRACT_OPERATIONS,signaling:false});
 return c.rtcDispatch(owner,{operation,actor,input:context.args});
}

export const methods={
 async rtcDispatch(owner,{operation,actor,input}={}){
  const Operation=typeof operation==='string'&&operation!=='rtc.listen'&&Object.hasOwn(WIRE,operation)?WIRE[operation]:null;if(!Operation)notFound();
  if(!plain(actor)||actor.owner!==owner||!['owner','app'].includes(actor.kind))throw new StorageError('unauthorized','Sign in to continue.',401);
  const blocked=await lifecycleBlocked(this,'rtcDispatch',{lifecycle:Operation.lifecycle??'active'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  // Uniform 404 while off for widening; the engine rechecks every gate (claim accept and send are checked inside).
  if(RTC_WIDENING.has(operation)&&!enabled(this,owner))notFound();
  if(operation==='rtc.relay-credentials'&&!relayEnabled(this,owner))notFound();// RTC-f: the engine rechecks both
  await this.warm(owner);
  const result=await run(this,new Operation({actor:structuredClone(actor),...input===undefined?{}:{input:structuredClone(input)}}));
  try{if((await this.metadata.list({prefix:'rtc/outbox/',limit:1})).size)await this.scheduleAlarm(Date.now()+1000);}catch{/* the alarm retries */}
  return result;
 },
 /** rtc.listen only, outside the account gate (gate 'none'): a long poll waits up to 25 s and must not hold the writer.
  * Each step inside it is its own storage transaction. */
 async rtcListen(owner,{actor,input}={}){
  if(!plain(actor)||actor.kind!=='app'||actor.owner!==owner)throw new StorageError('unauthorized','Sign in to continue.',401);
  const blocked=await lifecycleBlocked(this,'rtcListen',{lifecycle:'suspended'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  if(await this.metadata.get('owner')!==owner)notFound();
  return run(this,new WIRE['rtc.listen']({actor:structuredClone(actor),input:structuredClone(input??{})}));
 },
 async rtcPeer(owner,{operation,input}={}){
  if(operation!=='rtc.ingest'||!plain(input)||await this.metadata.get('owner')!==owner)notFound();
  // Review F1: the route's pseudonymous source network rides with the batch (the roster caps plain claims per network).
  const result=await run(this,new RtcIngest({actor:system(owner),input:{batch:input.batch,...typeof input.source==='string'?{source:input.source}:{}}}));
  // The batch is only queued here (the answer never waits on steps 2–8); the detached task processes it, and the
  // alarm is the durable fallback, which a session's next deadline also needs.
  try{if(await hasState(this))await this.scheduleAlarm(Date.now()+1000);}catch{/* the alarm retries */}
  return result;
 },
 async rtcPublicKeys(subject){
  if(!UUID.test(subject??'')||await this.metadata.get('owner')!==subject||typeof this.config.IDENTITY_ACCOUNT!=='function')return null;
  const a=await this.config.IDENTITY_ACCOUNT(subject);if(a?.status!=='active')return null;
  // No presence oracle (spec §12): every active entity answers with a certification key while RTC is on, whether or
  // not it ever registered an endpoint, so `open` succeeds alike. The key is created here on first need.
  if(enabled(this,subject))try{await signerFor(this)(subject);}catch{/* a moved identity has none */}
  const certification=(await certificationKeyList(this.metadata,subject)).filter(k=>k.state==='active').slice(0,8).map(k=>({kid:k.kid,use:'cert',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x:k.publicJwk.x,y:k.publicJwk.y},state:'active'}));
  return {identity:a.identityUri??`${this.config.APP_ORIGIN}/identity/${subject}`,certification,handle:typeof a.handle==='string'?a.handle:null,aep:Number.isSafeInteger(a.aep)?a.aep:0};
 },
 async rtcAlarm(){
  let owner;try{owner=await this.metadata.get('owner');if(!owner||!await hasState(this))return;
   const tick=await run(this,new RtcTick({actor:system(owner)}));
   // RTC-e: the key roster's background pass (queued refreshes, then refresh-ahead of peers of the last 24 h).
   const roster=await rtcEngine(this).roster.run().catch(()=>null);let wake=Number.isSafeInteger(tick?.wakeAt)?tick.wakeAt:null;
   if(roster&&(roster.queued||roster.roster))wake=Math.min(wake??Infinity,Date.now()+(roster.queued?5000:300000));
   if(wake!==null)await this.scheduleAlarm(wake);}
  catch{try{if(owner)await this.scheduleAlarm(Date.now()+60000);}catch{/* the next alarm retries */}}
 },
 async rtcDrain(owner){
  if(await this.metadata.get('owner')!==owner||!await hasState(this))return {pending:0};
  if(!await this.metadata.get('rtc/closed'))await run(this,new RtcLifecycle({actor:system(owner),input:{event:'deletion'}}));
  const out=await run(this,new RtcOutboxDrain({actor:system(owner),input:{limit:64}}));
  // RTC-f: relay credentials of the ended legs are revoked before the purge; unrevoked ones keep the drain pending
  // until they are revoked or expire (at most 300 s).
  await run(this,new RtcRelaySweep({actor:system(owner)})).catch(()=>null);const relay=await rtcEngine(this).service.relay?.pending(owner).catch(()=>1)??0;
  return {pending:out.pending+(out.more?1:0)+relay};
 },
 /** Tests and operators (internal, never routed): this writer's RTC directory as the roster sees it (review F2: with
  * `control: true`, the control-only delivery path). */
 rtcRosterDirectory(options){return rtcDirectory(this,options);},
 async rtcContractListen(owner,context){
  if(context?.method!=='listen')throw new StorageError('unsupported_method','Unsupported signaling method.',400);
  const {actor}=await contractActor(this,owner,context);return this.rtcListen(owner,{actor,input:context.args});
 },
 async rtcAppChanged(owner,{clientId,purposes,at}={}){
  if(await this.metadata.get('owner')!==owner||typeof clientId!=='string'||!clientId||clientId.length>2048||!(purposes===null||Array.isArray(purposes)&&purposes.length<=16&&purposes.every(p=>typeof p==='string')))return {ended:0};
  // RTC-i review L1: record the change before anything else (inside this account's gate, so every contract RPC that
  // enters the gate afterwards intersects its dispatch approval with it). A later-reported change never yields to an
  // earlier one that arrives late. Without the shard's `at` (direct callers), this writer's clock stands in.
  const when=Number.isSafeInteger(at)&&at>=0?at:Date.now(),path=await approvalKey(clientId);
  await this.metadata.transaction(async tx=>{if(await tx.get('rtc/closed'))return;const prior=await tx.get(path);if(plain(prior)&&Number.isSafeInteger(prior.at)&&prior.at>when)return;
   await tx.put(path,{clientId,purposes:purposes===null?null:[...purposes],revision:(plain(prior)&&Number.isSafeInteger(prior.revision)?prior.revision:0)+1,at:when});});
  if(!await hasState(this))return {ended:0};
  return run(this,new RtcLifecycle({actor:system(owner),input:purposes===null?{event:'app-revoked',clientId}:{event:'app-narrowed',clientId,purposes:[...purposes]}}));
 },
 async rtcAppRevoked(owner,{clientId,all=false}={}){
  if(await this.metadata.get('owner')!==owner||!await hasState(this))return {ended:0};
  let clients=[];if(all===true){const seen=new Set();for(const ep of (await this.metadata.list({prefix:'rtc/ep/',limit:64})).values())if(typeof ep?.clientId==='string')seen.add(ep.clientId);for(const prefix of ['rtc/out/','rtc/in/'])for(const rec of (await this.metadata.list({prefix,limit:4096})).values())if(typeof rec?.mine?.clientId==='string'&&['ringing','connected'].includes(rec.state))seen.add(rec.mine.clientId);clients=[...seen];}
  else if(typeof clientId==='string'&&clientId)clients=[clientId];
  let ended=0;for(const id of clients)ended+=(await run(this,new RtcLifecycle({actor:system(owner),input:{event:'app-revoked',clientId:id}}))).ended??0;return {ended};
 },
};
export const rpc={rtcDispatch:{lifecycle:'suspended'},rtcListen:{lifecycle:'suspended',gate:'none'},rtcPeer:{lifecycle:'suspended',gate:'none'},rtcPublicKeys:{gate:'none'},rtcContractListen:{lifecycle:'suspended',gate:'none'},rtcAppChanged:{lifecycle:'suspended'}};
