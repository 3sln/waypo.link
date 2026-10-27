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
//   rtcFlush(owner)                                tests and operators (internal, never routed)
//
// Ports (all built here; none is called inside a storage transaction, and nothing fetches another provider):
//   keys          same-host principals only (the peer writer's rtcPublicKeys, memoized 60 s); foreign principals have
//                 no keys until RTC-e's key roster exists, and RTC_FOREIGN_ENABLED is off
//   signer        certificationSigner over this account (the person's or organization's ACTIVE certification key)
//   linkSigner    the identity signing key (ticket metas)
//   bound         config.RTC_BOUND_CHECK(input) -> boolean: FederationService.checkBound, wired by the adapter (RTC-e);
//                 absent means nothing is approved, so every endpoint operation is refused (fail closed)
//   contacts      ContactEndpointService.inspect over this owner's contact links
//   transport     sameHostRtcTransport over rtcPeer
//   defer         a detached task on this controller (one at a time) running rtc.inbox and rtc.outbox-drain after the
//                 current request has answered; the alarm (rtc.tick, also scheduled) is the durable fallback
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
import {RtcService,rtcProvider,sameHostRtcTransport,RTC_ENDPOINT_OPERATIONS,RTC_OWNER_OPERATIONS,RTC_WIDENING,RTC_SIGNALING_FLAG,RTC_LIMIT_VALUES,RtcIngest,RtcInbox,RtcTick,RtcLifecycle,RtcOutboxDrain} from '../../app/domains/rtc.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,MEMO_MS=60000;
const WIRE=Object.freeze(Object.fromEntries([...RTC_ENDPOINT_OPERATIONS,...RTC_OWNER_OPERATIONS].map(O=>[O.operation,O])));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const notFound=()=>{throw new StorageError('not_found','Not found.',404);};
const memories=new WeakMap();
const memory=c=>{let m=memories.get(c);if(!m){m={parties:new Map(),kicking:false,again:false};memories.set(c,m);}return m;};

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
 const config=c.config,issuer=config.APP_ORIGIN,local=p=>p?.iss===issuer&&UUID.test(p?.sub??'');
 const transport=sameHostRtcTransport({issuer,dispatch:async(sub,operation,input)=>{
  const stub=config.CONVERSATION_ACCOUNT?.(sub);if(!stub)throw new StorageError('temporarily_unavailable','Unavailable.',503);
  const result=await stub.invoke({method:'rtcPeer',args:[sub,{operation,input}]});
  if(result?.$fault)throw new StorageError(result.$fault.code,result.$fault.message,result.$fault.status);return result;}});
 const service=new RtcService({store:c.metadata,issuer,clock:{now:()=>Date.now()},random:cryptoRandom,flags:{for:ctx=>flagsFor(config,ctx)},
  keys:{
   certification:async p=>local(p)?(await partyRecord(c,p.sub))?.certification??[]:[],
   identity:async p=>local(p)?(await partyRecord(c,p.sub))?.identity??null:null,
   handle:async p=>local(p)?(await partyRecord(c,p.sub))?.handle??null:null,
   aep:async owner=>(await partyRecord(c,owner))?.aep??0,
  },
  signer:owner=>signerFor(c)(owner),
  linkSigner:async owner=>{const k=await c.signingKey(owner);return k?{kid:k.kid,privateKey:k.privateKey}:null;},
  bound:typeof config.RTC_BOUND_CHECK==='function'?{check:input=>config.RTC_BOUND_CHECK(input)}:null,
  contacts:{inspect:async link=>{const owner=await c.metadata.get('owner');let inspected=null;try{inspected=await c.endpoints?.inspect(link);}catch{inspected=null;}const g=inspected?.grant;return g&&g.owner===owner&&typeof g.id==='string'?{parent:g.id,quarantined:g.quarantined===true}:null;}},
  transport,defer:()=>kick(c),hostLimits:hostLimitsFor(config),allowLoopback:config.LOCAL_DEVELOPMENT==='true'});
 entry={service,engine:createAppEngine({providers:{clock:{now:()=>Date.now()},random:cryptoRandom,audit:nullAudit,rtc:rtcProvider(service)}})};
 engines.set(c,entry);return entry;
}
const run=(c,operation)=>operation instanceof AppQuery?read(rtcEngine(c).engine,operation):perform(rtcEngine(c).engine,operation);
const system=owner=>({kind:'system',owner});
const enabled=(c,owner)=>{try{return flagsFor(c.config,{subject:{kind:'account',owner}}).enabled(RTC_SIGNALING_FLAG)===true;}catch{return false;}};
const hasState=async c=>(await c.metadata.list({prefix:'rtc/',limit:1})).size>0;

export const methods={
 async rtcDispatch(owner,{operation,actor,input}={}){
  const Operation=typeof operation==='string'&&operation!=='rtc.listen'&&Object.hasOwn(WIRE,operation)?WIRE[operation]:null;if(!Operation)notFound();
  if(!plain(actor)||actor.owner!==owner||!['owner','app'].includes(actor.kind))throw new StorageError('unauthorized','Sign in to continue.',401);
  const blocked=await lifecycleBlocked(this,'rtcDispatch',{lifecycle:Operation.lifecycle??'active'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  // Uniform 404 while off for widening; the engine rechecks every gate (claim accept and send are checked inside).
  if(RTC_WIDENING.has(operation)&&!enabled(this,owner))notFound();
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
  const result=await run(this,new RtcIngest({actor:system(owner),input:{batch:input.batch}}));
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
   const tick=await run(this,new RtcTick({actor:system(owner)}));if(Number.isSafeInteger(tick?.wakeAt))await this.scheduleAlarm(tick.wakeAt);}
  catch{try{if(owner)await this.scheduleAlarm(Date.now()+60000);}catch{/* the next alarm retries */}}
 },
 async rtcDrain(owner){
  if(await this.metadata.get('owner')!==owner||!await hasState(this))return {pending:0};
  if(!await this.metadata.get('rtc/closed'))await run(this,new RtcLifecycle({actor:system(owner),input:{event:'deletion'}}));
  const out=await run(this,new RtcOutboxDrain({actor:system(owner),input:{limit:64}}));return {pending:out.pending+(out.more?1:0)};
 },
 async rtcFlush(owner){return run(this,new RtcTick({actor:system(owner)}));},
};
export const rpc={rtcDispatch:{lifecycle:'suspended'},rtcListen:{lifecycle:'suspended',gate:'none'},rtcPeer:{lifecycle:'suspended',gate:'none'},rtcPublicKeys:{gate:'none'},rtcFlush:{lifecycle:'suspended'}};
