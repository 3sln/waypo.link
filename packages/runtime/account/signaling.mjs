// Signaling account slice: the built-in signaling resource in each entity's own writer (docs/spec/extensions/
// signaling.md rev 3.2; engine operations in packages/app/domains/signaling.mjs, rules in packages/signaling/*.mjs).
// Renamed from account/rtc.mjs (Appendix C.2): the interim approval records, `narrowedApproval` and bound copying are
// gone; kind approval is the intents session handler approval, read by the engine from this account's own store.
// Provisional (coordinator), not signed off by the user; behind SIGNALING_ENABLED and SESSION_KINDS_ENABLED (default
// off). `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists what `invoke`
// accepts.
//
//   signalingDispatch(owner, {operation, actor, input})   endpoint and owner operations; the actor comes from a trusted
//                                                          adapter (RPC dispatch context, owner routes), never a body
//   signalingListen(owner, {actor, input})                 signaling.listen outside the account gate (a long poll)
//   signalingPeer(owner, {operation, input})               the same-host transport target: only `signaling.ingest`
//   signalingPublicKeys(subject)                           local read for peers on this host (gate none)
//   signalingAlarm()                                       account alarm hook: signaling.tick
//   signalingDrain(owner)                                  account deletion drain: lifecycle `deletion`, then the outbox
//   signalingRosterDirectory({control})                    tests and operators (internal)
//   signalingContractListen(owner, context)                the contract's `listen` from the verified dispatch context
//   signalingAppRevoked(owner, {clientId?, all?})          lifecycle hooks (Appendix C.2): the grant on the signaling
//                                                          field revoked (FederationService grantChanged), or the app's
//                                                          connection ending (disconnect, removal, severance): clears
//                                                          its session handler approvals and runs §14.2
//   signalingClientSessionRevoked(owner, {clientId, clientSession})  one client session ended (§5.8, §14.2)
//   signalingResourceMethod(c, owner, context)             RESOURCE_METHOD_HANDLERS entry for signaling/v1
//   signalingRelayResourceMethod(c, owner, context)        RESOURCE_METHOD_HANDLERS entry for ice-relay/v1
//
// Ports (built here; none is called inside a storage transaction, and nothing fetches another provider):
//   keys      same-host principals: the peer writer's signalingPublicKeys, memoized 60 s; foreign principals: the
//             SignalingKeyRoster over an IdentityDirectory built only while DIRECTORY_ENABLED, SIGNALING_FOREIGN_ENABLED
//             (for this owner), a DIRECTORY_EGRESS port and a non-empty SIGNALING_FOREIGN_ISSUERS allowlist exist
//   kinds     session-kind versions held by this provider: the artefact store (config.ARTEFACTS: operator-registered
//             local bytes only, no network fallback), never fetched on a federation request path (§3.4)
//   signer    certificationSigner over this account (the entity's ACTIVE certification key)
//   transport foreignSignalingTransport: same-host principals through sameHostSignalingTransport over signalingPeer;
//             other issuers only through the adapter's SSRF-screened SIGNALING_EGRESS and the allowlist
//   entityKind the identity record's kind (person or organization), for the service designation (§4.3)
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {flagsFor} from './flags.mjs';
import {lifecycleBlocked} from '../lifecycle-runner.mjs';
import {certificationSigner,certificationKeyList} from '../../identity/member-certificates.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {base64url} from '../../core/records.mjs';
import {parseEnvelope,versionRecord,digestJSON} from '../../core/artefacts.mjs';
import {siteGlobal} from '../../flags/read.mjs';
import {IdentityDirectory} from '../../federation/directory.mjs';
import {foreignIssuers,directoryHostLimiter} from './foreign-directory.mjs';
import {createPushTransport} from '../../activity/web-push.mjs';
import {SignalingKeyRoster,SignalingDeliveryError,foreignSignalingTransport,signalingEgress} from '../../signaling/federation.mjs';
import {SIGNALING_EXTENSION,SIGNALING_CONTRACT,SIGNALING_FRAGMENT,ICE_RELAY_FRAGMENT,ICE_RELAY_CONTRACT} from '../../signaling/extension.mjs';
import {SignalingService,signalingProvider,sameHostSignalingTransport,ENDPOINT_OPERATIONS,OWNER_OPERATIONS,WIDENING,SIGNALING_FLAG,SESSION_KINDS_FLAG,SIGNALING_FOREIGN_FLAG,LIMIT_VALUES,SignalingIngest,SignalingInbox,SignalingTick,SignalingLifecycle,SignalingOutboxDrain,CONTRACT_OPERATIONS,SignalingRelay,SignalingRelaySweep,RELAY_OPERATIONS,RELAY_CONTRACT_OPERATIONS,TURN_FLAG,turnAdapterFrom} from '../../app/domains/signaling.mjs';
import {configuredArtefactDocuments} from '../artefact-pins.mjs';
import {appConnectionState} from '../../apps/connections.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,MEMO_MS=60000;
const WIRE=Object.freeze(Object.fromEntries([...ENDPOINT_OPERATIONS,...OWNER_OPERATIONS,...RELAY_OPERATIONS].map(O=>[O.operation,O])));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const notFound=()=>{throw new StorageError('not_found','Not found.',404);};
const memories=new WeakMap();
const memory=c=>{let m=memories.get(c);if(!m){m={parties:new Map(),kicking:false,again:false,owner:null,directory:null,push:undefined,relay:false};memories.set(c,m);}return m;};
/** The foreign-issuer allowlist for signaling (same parser and rules as ORG_FOREIGN_ISSUERS; empty by default). */
export const signalingForeignIssuers=config=>foreignIssuers(config,'SIGNALING_FOREIGN_ISSUERS');
const foreignOn=(config,owner)=>{try{return typeof owner==='string'&&flagsFor(config,{subject:{kind:'account',owner}}).enabled(SIGNALING_FOREIGN_FLAG)===true;}catch{return false;}};
/** This entity's IdentityDirectory for signaling peers, or null while any gate is missing. `control: true` is the
 * control-only delivery path, never gated by SIGNALING_FOREIGN_ENABLED (a kill switch never suppresses `revoked`). */
function signalingDirectory(c,{control=false}={}){
 const config=c.config,m=memory(c);if(!m.owner||typeof config.DIRECTORY_EGRESS!=='function'||!siteGlobal(config,'DIRECTORY_ENABLED')||control!==true&&!foreignOn(config,m.owner))return null;
 const issuers=signalingForeignIssuers(config);if(!issuers.length)return null;const key=JSON.stringify([m.owner,issuers]);
 if(m.directory?.key===key)return m.directory.value;
 const value=new IdentityDirectory({config,issuers,feature:'signaling',tenant:m.owner,features:[SIGNALING_EXTENSION],fetch:config.DIRECTORY_EGRESS(issuers),hostLimiter:directoryHostLimiter(config),store:{transaction:fn=>c.metadata.transaction(tx=>fn({get:k=>tx.get(k),set:(k,v)=>tx.put(k,v)}))}});
 m.directory={key,value};return value;
}
/** A same-host principal's public signaling record: this writer for its own owner, else the peer writer (60 s memo). */
async function partyRecord(c,sub){
 if(!UUID.test(sub??''))return null;const m=memory(c),now=Date.now(),hit=m.parties.get(sub);if(hit&&now-hit.at<MEMO_MS)return hit.value;
 let value=null;
 try{if(await c.metadata.get('owner')===sub)value=await c.signalingPublicKeys(sub);else{const stub=c.config.CONVERSATION_ACCOUNT?.(sub);const r=stub?await stub.invoke({method:'signalingPublicKeys',args:[sub]}):null;value=r?.$fault?null:r??null;}}catch{value=null;}
 m.parties.set(sub,{value,at:now});if(m.parties.size>2048)m.parties.delete(m.parties.keys().next().value);return value;
}
/** The host-wide limiter port over the shared WORK_AUTHORITY guard; null where the host has none. */
function hostLimitsFor(config){
 const authority=config.WORK_AUTHORITY;if(typeof authority?.consume!=='function')return null;
 const secret=config.ABUSE_HASH_KEY||config.KEY_ENCRYPTION_KEY;let key=null;
 const hash=async text=>{const bytes=new TextEncoder().encode(text);
  if(typeof secret==='string'&&secret){key??=await crypto.subtle.importKey('raw',new TextEncoder().encode('signaling-limit\0'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)));}
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));};
 return {async take(name,parts){const l=LIMIT_VALUES[name];if(!l)return false;return await authority.consume(`signaling-${name}-v1/${await hash(JSON.stringify([name,...parts]))}`,{limit:l.max,windowMs:l.windowMs})===true;}};
}
/**
 * The held session-kind port (§3.4): versions this provider holds in its artefact store, resolved without any network
 * access (the artefact runtime's fetch port reads only operator-registered local documents). `version(line, v)` reads
 * the digest of version `v` from the operator-registered envelope of the line.
 */
function kindsPort(config){
 const resolve=async ref=>{const artefacts=config.ARTEFACTS;if(!artefacts?.enabled||typeof artefacts.registered==='function'&&artefacts.registered(ref.artefact)!==true)return null;
  let pin;try{pin=await artefacts.resolve({...ref,kind:'intent'});}catch(error){if(error?.code!=='artefact_unavailable'||typeof artefacts.pin!=='function')return null;try{pin=await artefacts.pin({...ref,kind:'intent'});}catch{return null;}}
  return pin&&!pin.affected&&pin.reference?.digest===ref.digest&&pin.reference?.version===ref.version?pin.body:null;};
 return {held:resolve,async version(line,version){try{const documents=configuredArtefactDocuments(config),raw=documents[line+'/envelope']??documents[line];if(!raw)return null;
  const envelope=parseEnvelope(raw,{id:line}),entry=envelope.versions.find(v=>v.version===version);if(!entry)return null;
  return {digest:await digestJSON(versionRecord(envelope,entry))};}catch{return null;}}};
}
/** Runs queued inbound batches and the outbox on a detached task after the current request answered. */
function kick(c){
 const m=memory(c);if(m.kicking){m.again=true;return;}m.kicking=true;
 setTimeout(async()=>{
  try{const owner=await c.metadata.get('owner');if(owner)for(let i=0;i<8;i++){m.again=false;
   const inbox=await run(c,new SignalingInbox({actor:system(owner),input:{limit:32}})),out=await run(c,new SignalingOutboxDrain({actor:system(owner),input:{limit:64}}));
   if(m.relay){m.relay=false;await run(c,new SignalingRelaySweep({actor:system(owner)})).catch(()=>{m.relay=true;return c.scheduleAlarm(Date.now()+60000).catch(()=>null);});}
   await signalingEngine(c).roster.run({limit:4}).catch(()=>null);
   if(!inbox.more&&!out.more&&!m.again)break;}}
  catch{/* the alarm retries */}
  finally{m.kicking=false;if(m.again){m.again=false;kick(c);}}
 },0);
}
const signerFor=c=>certificationSigner({metadata:c.metadata,seal:v=>encryptSecret(v,c.config.KEY_ENCRYPTION_KEY),open:v=>decryptSecret(v,c.config.KEY_ENCRYPTION_KEY)});
const engines=new WeakMap();
/** This entity's signaling service and engine (one per controller). */
export function signalingEngine(c){
 let entry=engines.get(c);if(entry)return entry;
 const config=c.config,issuer=config.APP_ORIGIN,local=p=>p?.iss===issuer&&UUID.test(p?.sub??''),m=memory(c);
 const allowLoopback=config.LOCAL_DEVELOPMENT==='true';
 const roster=new SignalingKeyRoster({issuer,directory:options=>signalingDirectory(c,options),allowLoopback});
 const sameHost=sameHostSignalingTransport({issuer,dispatch:async(sub,operation,input)=>{
  const stub=config.CONVERSATION_ACCOUNT?.(sub);if(!stub)throw new StorageError('temporarily_unavailable','Unavailable.',503);
  const result=await stub.invoke({method:'signalingPeer',args:[sub,{operation,input}]});
  if(result?.$fault)throw new StorageError(result.$fault.code,result.$fault.message,result.$fault.status);return result;}});
 const post=async(url,body)=>{const egress=config.SIGNALING_EGRESS,issuers=signalingForeignIssuers(config);if(typeof egress?.send!=='function'||!issuers.length)throw new SignalingDeliveryError('signaling_egress_unavailable');return signalingEgress({send:input=>egress.send(input),issuers})(url,body);};
 const transport=foreignSignalingTransport({issuer,local:sameHost,roster,post,enabled:async from=>foreignOn(config,from?.sub)&&siteGlobal(config,'DIRECTORY_ENABLED'),current:async p=>p});
 const pushTransport={send:(subscription,payload,options)=>{if(m.push===undefined)m.push=config.SIGNALING_PUSH??config.LIFECYCLE_PUSH??createPushTransport(config)??null;if(typeof m.push?.send!=='function')throw Object.assign(new Error('Push is unavailable.'),{code:'push_unavailable'});return m.push.send(subscription,payload,options);}};
 const service=new SignalingService({store:c.metadata,issuer,clock:{now:()=>Date.now()},random:cryptoRandom,flags:{for:ctx=>flagsFor(config,ctx)},kinds:kindsPort(config),
  keys:{
   certification:async p=>local(p)?(await partyRecord(c,p.sub))?.certification??[]:roster.certification(p),
   identity:async p=>local(p)?(await partyRecord(c,p.sub))?.identity??null:roster.identity(p),
   handle:async p=>local(p)?(await partyRecord(c,p.sub))?.handle??null:null,// foreign handles are never shown (no verified binding held)
   aep:async owner=>(await partyRecord(c,owner))?.aep??0,
   refresh:(p,kid,options)=>local(p)?false:roster.refresh(p,kid,options),unsupported:p=>local(p)?false:roster.unsupported(p),live:principals=>roster.live(principals),track:p=>roster.track(p),warm:p=>roster.warm(p),warmIssuer:iss=>roster.warmIssuer(iss),maxLegSeconds:p=>roster.maxLegSeconds(p),profiles:p=>local(p)?null:roster.profiles(p),
  },
  signer:owner=>signerFor(c)(owner),
  entityKind:async owner=>{try{const a=await config.IDENTITY_ACCOUNT?.(owner);return a?.kind==='organization'?'organization':'person';}catch{return 'person';}},
  // §5.4 "its connection is live": read in the engine's own transaction from this account's app connection records. An
  // app with no record at all has never connected here and cannot authenticate (contractActor checks the connection),
  // so it reads as generation 0; a disconnected record reads as ended.
  connections:{state:async(tx,owner,clientId)=>{const s=await appConnectionState(tx,owner,clientId);return s.state==='absent'?{state:'live',generation:0}:s;}},
  // Owner widening actions are recorded only through the owner pages (signaling/owner-pages.mjs; release gate
  // "Signaling", owner pages): each needs the page's review, and cross-entity activation and renewal fresh authentication.
  ownerPages:true,
  transport,pushTransport,defer:()=>kick(c),hostLimits:hostLimitsFor(config),allowLoopback});
 // The built-in ice-relay/v1 resource: unreachable unless both flags are on for the owner AND both ports exist.
 service.attachRelay(new SignalingRelay({service,adapter:turnAdapterFrom(config),spend:typeof config.SIGNALING_RELAY_SPEND?.reserve==='function'?config.SIGNALING_RELAY_SPEND:null,
  plan:async owner=>{try{return (await c.billing?.entitlement(owner))?.plan??'free';}catch{return 'free';}},
  defer:()=>{m.relay=true;kick(c);},wake:(owner,time)=>c.scheduleAlarm(time)}));
 entry={service,roster,engine:createAppEngine({providers:{clock:{now:()=>Date.now()},random:cryptoRandom,audit:nullAudit,signaling:signalingProvider(service)}})};
 engines.set(c,entry);return entry;
}
const run=(c,operation)=>{const owner=operation?.actor?.owner;if(typeof owner==='string'&&UUID.test(owner))memory(c).owner??=owner;return runOp(c,operation);};
const runOp=(c,operation)=>operation instanceof AppQuery?read(signalingEngine(c).engine,operation):perform(signalingEngine(c).engine,operation);
const system=owner=>({kind:'system',owner});
const enabled=(c,owner)=>{try{const f=flagsFor(c.config,{subject:{kind:'account',owner}});return f.enabled(SIGNALING_FLAG)===true&&f.enabled(SESSION_KINDS_FLAG)===true;}catch{return false;}};
const relayEnabled=(c,owner)=>{try{return enabled(c,owner)&&flagsFor(c.config,{subject:{kind:'account',owner}}).enabled(TURN_FLAG)===true;}catch{return false;}};
const hasState=async c=>(await c.metadata.list({prefix:'sig/',limit:1})).size>0;
/** Deletes up to `limit` legacy `rtc/` rows (the replaced RTC code's families: policy, blocks, mutes, contact
 * configuration, missed list, tickets, interim approvals, endpoints, sessions, queues, outbox, limits). Returns how many
 * remain to delete (0 when done). Destructive by design: no real users held such rows (DEVLOG, Appendix C). */
export async function legacyRtcReset(c,{limit=512}={}){
 const rows=await c.metadata.list({prefix:'rtc/',limit:limit+1});if(!rows.size)return 0;
 const keys=[...rows.keys()].slice(0,limit);await c.metadata.transaction(async tx=>{for(const key of keys)await tx.delete(key);});
 if(rows.size>limit)try{await c.scheduleAlarm(Date.now()+1000);}catch{/* the next alarm continues */}
 return rows.size>limit?rows.size-limit:0;
}
/** The {kind:'app'} actor from the VERIFIED federation RPC dispatch context (never from arguments): the token's subject
 * owner, client, the client's registered origin, the token's grant ids, its epoch and, for a DPoP-bound token, the key's
 * jkt. A device-authorization client session is carried when the dispatch context names one (`clientSession`; not
 * plumbed by the federation runtime yet, Appendix C.5 step 7). */
async function contractActor(c,owner,context,{contract=SIGNALING_CONTRACT,fragment=SIGNALING_FRAGMENT,resource='signaling',operations=CONTRACT_OPERATIONS}={}){
 const forbidden=()=>{throw new StorageError('forbidden','Signaling access denied.',403);};
 const origin=c.config.APP_ORIGIN,subject=`${origin}/entities/${owner}`;
 if(!plain(context)||context.authority!=='bindle'||context.contract!==contract||context.subject!==subject||context.resource!==`${subject}/${resource}`||context.resourceGeneration!==owner||!plain(context.connection)||typeof context.connection.id!=='string'||!Number.isSafeInteger(context.connection.generation)||context.epoch===undefined||context.epoch===null||typeof context.clientId!=='string'||!plain(context.args))forbidden();
 const operation=typeof context.method==='string'&&Object.hasOwn(operations,context.method)?operations[context.method]:null;if(!operation)throw new StorageError('unsupported_method','Unsupported signaling method.',400);
 // The authorizing grant is on the fragment itself, so its revocation reaches signalingAppRevoked (grantChanged).
 if(!plain(context.grant)||context.grant.fragment!==fragment)forbidden();
 if(!Array.isArray(context.grants)||!context.grants.length||context.grants.length>256||context.grants.some(g=>typeof g!=='string'))forbidden();
 let appOrigin=null;try{appOrigin=new URL(typeof context.clientOrigin==='string'?context.clientOrigin:context.clientId).origin;}catch{appOrigin=null;}if(!appOrigin||appOrigin==='null')forbidden();
 if(typeof c.config.FEDERATION_IDENTITY_CHECK!=='function'||await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)throw new StorageError('unauthorized','Application authorization is no longer active.',401);
 await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);
 // This handler runs inside the owner's account gate, so it never calls into the federation shard: the session handler
 // approval is read by the engine from this account's own store (SG-3, RTCi-1).
 return {operation,actor:{kind:'app',owner,clientId:context.clientId,origin:appOrigin,grants:[...context.grants],epoch:context.epoch,...typeof context.jkt==='string'?{jkt:context.jkt}:{},clientSession:typeof context.clientSession==='string'&&context.clientSession.length<=256?context.clientSession:null,
  // §4.3: a member-context token (organizations §7) never registers a service-class endpoint (M-4).
  memberContext:context.member===true}};
}
/** RESOURCE_METHOD_HANDLERS entry for `signaling/v1` (inside the account gate: `listen` never waits here). */
export async function signalingResourceMethod(c,owner,context){
 const {operation,actor}=await contractActor(c,owner,context);
 if(operation==='signaling.listen'){const input={...context.args,...context.args.wait!==undefined?{wait:0}:{}};return c.signalingListen(owner,{actor,input});}
 return c.signalingDispatch(owner,{operation,actor,input:context.args});
}
/** RESOURCE_METHOD_HANDLERS entry for `ice-relay/v1` on the built-in relay resource (`${subject}/relay`). */
export async function signalingRelayResourceMethod(c,owner,context){
 const {operation,actor}=await contractActor(c,owner,context,{contract:ICE_RELAY_CONTRACT,fragment:ICE_RELAY_FRAGMENT,resource:'relay',operations:RELAY_CONTRACT_OPERATIONS});
 return c.signalingDispatch(owner,{operation,actor,input:context.args});
}

export const methods={
 async signalingDispatch(owner,{operation,actor,input}={}){
  const Operation=typeof operation==='string'&&operation!=='signaling.listen'&&Object.hasOwn(WIRE,operation)?WIRE[operation]:null;if(!Operation)notFound();
  if(!plain(actor)||actor.owner!==owner||!['owner','app'].includes(actor.kind))throw new StorageError('unauthorized','Sign in to continue.',401);
  const blocked=await lifecycleBlocked(this,'signalingDispatch',{lifecycle:Operation.lifecycle??'active'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  if(WIDENING.has(operation)&&!enabled(this,owner))notFound();
  if(operation==='signaling.relay-credentials'&&!relayEnabled(this,owner))notFound();
  await this.warm(owner);
  const result=await run(this,new Operation({actor:structuredClone(actor),...input===undefined?{}:{input:structuredClone(input)}}));
  try{if((await this.metadata.list({prefix:'sig/outbox/',limit:1})).size||await hasState(this))await this.scheduleAlarm(Date.now()+1000);}catch{/* the alarm retries */}
  return result;
 },
 async signalingListen(owner,{actor,input}={}){
  if(!plain(actor)||actor.kind!=='app'||actor.owner!==owner)throw new StorageError('unauthorized','Sign in to continue.',401);
  const blocked=await lifecycleBlocked(this,'signalingListen',{lifecycle:'suspended'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  if(await this.metadata.get('owner')!==owner)notFound();
  return run(this,new WIRE['signaling.listen']({actor:structuredClone(actor),input:structuredClone(input??{})}));
 },
 async signalingPeer(owner,{operation,input}={}){
  if(operation!=='signaling.ingest'||!plain(input)||await this.metadata.get('owner')!==owner)notFound();
  const result=await run(this,new SignalingIngest({actor:system(owner),input:{batch:input.batch,...typeof input.source==='string'?{source:input.source}:{},...input.dark===true?{dark:true}:{}}}));
  try{if(await hasState(this))await this.scheduleAlarm(Date.now()+1000);}catch{/* the alarm retries */}
  return result;
 },
 async signalingPublicKeys(subject){
  if(!UUID.test(subject??'')||await this.metadata.get('owner')!==subject||typeof this.config.IDENTITY_ACCOUNT!=='function')return null;
  const a=await this.config.IDENTITY_ACCOUNT(subject);if(a?.status!=='active')return null;
  // §12.1: every active entity answers with a certification key whether or not it ever registered, and whatever its own
  // signaling flags say, so `open` toward it never depends on, or reveals, its per-account state (RTCw-L3).
  try{await signerFor(this)(subject);}catch{/* a moved identity has none */}
  const certification=(await certificationKeyList(this.metadata,subject)).filter(k=>k.state==='active').slice(0,8).map(k=>({kid:k.kid,use:'cert',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x:k.publicJwk.x,y:k.publicJwk.y},state:'active'}));
  return {identity:a.identityUri??`${this.config.APP_ORIGIN}/identity/${subject}`,certification,handle:typeof a.handle==='string'?a.handle:null,aep:Number.isSafeInteger(a.aep)?a.aep:0};
 },
 async signalingAlarm(){
  // One-time dev data reset (signaling Appendix C: no data migration; rows exist only in local development and test
  // stores): legacy `rtc/` rows of the replaced RTC code are deleted in bounded pages on any account alarm.
  try{await legacyRtcReset(this);}catch{/* the next alarm retries */}
  let owner;try{owner=await this.metadata.get('owner');if(!owner||!await hasState(this))return;
   const tick=await run(this,new SignalingTick({actor:system(owner)}));
   const roster=await signalingEngine(this).roster.run().catch(()=>null);let wake=Number.isSafeInteger(tick?.wakeAt)?tick.wakeAt:null;
   if(roster&&(roster.queued||roster.roster))wake=Math.min(wake??Infinity,Date.now()+(roster.queued?5000:300000));
   if(wake!==null)await this.scheduleAlarm(wake);}
  catch{try{if(owner)await this.scheduleAlarm(Date.now()+60000);}catch{/* the next alarm retries */}}
 },
 async signalingDrain(owner){
  if(await this.metadata.get('owner')!==owner||!await hasState(this))return {pending:0};
  if(!await this.metadata.get('sig/closed'))await run(this,new SignalingLifecycle({actor:system(owner),input:{event:'deletion'}}));
  const out=await run(this,new SignalingOutboxDrain({actor:system(owner),input:{limit:64}}));
  await run(this,new SignalingRelaySweep({actor:system(owner)})).catch(()=>null);const relay=await signalingEngine(this).service.relay?.pending(owner).catch(()=>1)??0;
  return {pending:out.pending+(out.more?1:0)+relay};
 },
 signalingRosterDirectory(options){return signalingDirectory(this,options);},
 async signalingContractListen(owner,context){
  if(context?.method!=='listen')throw new StorageError('unsupported_method','Unsupported signaling method.',400);
  const {actor}=await contractActor(this,owner,context);return this.signalingListen(owner,{actor,input:context.args});
 },
 /** Lifecycle hooks (Appendix C.2): the app's grant on the signaling field was revoked, or its connection ended. Clears
  * its session handler approvals and runs §14.2. With `all` (account severance) every app with any signaling state. */
 async signalingAppRevoked(owner,{clientId,all=false}={}){
  if(await this.metadata.get('owner')!==owner)return {ended:0};
  let clients=[];
  if(all===true){const seen=new Set();for(const ep of (await this.metadata.list({prefix:'sig/ep/',limit:64})).values())if(typeof ep?.clientId==='string'&&!ep.feature)seen.add(ep.clientId);
   for(const m of (await this.metadata.list({prefix:'intent-memory/'+owner+'/',limit:1024})).values())for(const a of Array.isArray(m?.approvals)?m.approvals:[])if(typeof a?.handler==='string'&&a.feature===false)seen.add(a.handler);
   for(const p of (await this.metadata.list({prefix:'sig/pairing/',limit:512})).values()){if(typeof p?.local?.client_id==='string')seen.add(p.local.client_id);if(typeof p?.peer?.self?.client_id==='string')seen.add(p.peer.self.client_id);}
   for(const o of (await this.metadata.list({prefix:'sig/offer/',limit:512})).values())if(typeof o?.clientId==='string'&&!o.feature)seen.add(o.clientId);
   clients=[...seen];}
  else if(typeof clientId==='string'&&clientId&&clientId.length<=2048)clients=[clientId];
  // Approvals live in intents memory even without any sig/ state, so this always runs for a named client. A failure is
  // retried: the alarm's tick sweeps every app whose connection ended or changed generation (H-1), and the caller's
  // own durable row (cascade, grant-sync, pendingSever) retries the hook itself.
  let ended=0;
  try{for(const id of clients)ended+=(await run(this,new SignalingLifecycle({actor:system(owner),input:{event:'app-revoked',clientId:id}}))).ended??0;}
  catch(error){try{await this.scheduleAlarm(Date.now()+60000);}catch{/* the next alarm retries */}throw error;}
  return {ended};
 },
 /** The app connection ended (AppConnections `ended` hook: every disconnect, whatever INTEGRATIONS_ENABLED says).
  * Runs the clearing at once; on failure the tick's sweep does it (the connection record is the durable marker). */
 async signalingConnectionEnded(owner,clientId){
  if(typeof clientId!=='string'||!clientId||await this.metadata.get('owner')!==owner)return {ended:0};
  try{return await this.signalingAppRevoked(owner,{clientId});}catch{try{await this.scheduleAlarm(Date.now()+1000);}catch{/* the next alarm retries */}return {ended:0,pending:true};}
 },
 // TODO(review L-4, Appendix C.5 step 7): no caller yet. Device-authorization session revocation and the connections
 // code must call this before `clientSession` is plumbed from the federation runtime; today every endpoint records
 // `clientSession: null`, so no bound pairing can cover anything and nothing outlives a revoked session.
 async signalingClientSessionRevoked(owner,{clientId,clientSession}={}){
  if(await this.metadata.get('owner')!==owner||!await hasState(this)||typeof clientId!=='string'||typeof clientSession!=='string')return {ended:0};
  return run(this,new SignalingLifecycle({actor:system(owner),input:{event:'client-session-revoked',clientId,clientSession}}));
 },
};
export const rpc={signalingDispatch:{lifecycle:'suspended'},signalingListen:{lifecycle:'suspended',gate:'none'},signalingPeer:{lifecycle:'suspended',gate:'none'},signalingPublicKeys:{gate:'none'},signalingContractListen:{lifecycle:'suspended',gate:'none'},signalingAppRevoked:{lifecycle:'suspended'}};
