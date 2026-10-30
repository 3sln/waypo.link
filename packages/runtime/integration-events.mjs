import {flagsFor,ownerFlags,existingFeature} from './account/flags.mjs';
// EXT-X6, the integration event outbox and its delivery (docs/spec/integrations.md §6, §7.2–7.3, §10, §11;
// docs/architecture/extensibility-design.md EX-7/EX-8, §10 X6). Engine-first: the `integrationEvents` provider is an
// actor-scoped handle over the account store; the Actions/Queries below are the operations, and the account slice at
// the bottom (installed through packages/runtime/account/index.mjs) composes them for the alarm. Everything refuses with
// `not_found` unless INTEGRATIONS_ENABLED is on, and nothing is ingested or sent until a signer (the brokering `event`
// key, packages/federation/signing.mjs) and an SSRF-safe egress port are configured.
//
// Rows. The X4 connections outbox (packages/apps/connections.mjs) is drained into per-connection rows here, in one
// transaction with an ingest cursor, and acknowledged afterwards (a lost ack re-reads from the cursor, never twice):
// `connection-revoked` (generation_floor = the post-bump generation) and `connection-resumed` map to events; the other X4
// events carry nothing an integration may see. Other writers append in their own commit with enqueueIntegrationEvent(tx)
// (credential-revoked, resource-detached, preferences-updated markers), or across single writers with the idempotent
// system Actions. Coalescing: one marker per (connection, fragment) and per detached resource, a newer marker replacing
// an undelivered or in-flight older one; a connection-revoked supersedes pending ones it covers (floors only rise) and
// pending resumes below its floor; a resume supersedes older resumes.
//
// Delivery (CBOR phase 5: untagged COSE_Sign1 CWTs, `application/cwt`, packages/core/cose.mjs; push delivery modelled on
// RFC 8935). Per connection, revocations go first, then resumes, then the rest; across connections every due revocation
// goes before any other row. Each attempt is leased (attempt id, next time) in its own commit before anything is signed,
// then signed afresh (new iat, same 16-byte cti) and POSTed to the pinned events_endpoint; the
// outcome is settled in a second commit that only applies to the same lease. `seq` is assigned when a row is first sent
// and increases strictly per connection id across generations; a preferences snapshot is rebuilt at every attempt, and a
// changed snapshot (or generation) gets a fresh cti and seq, so a receiver that already processed the old cti never
// drops newer state (at-least-once; receivers dedupe by cti and order by seq). 202 acknowledges; 400 is a permanent
// rejection; anything else is retried with exponential backoff (≤ 10 s first, ≤ 1 h apart) for 72 h, after which a
// non-revocation row is dropped and the connection becomes `degraded` (X4 health), and a revocation is recorded as
// unacknowledged (§7.3). A later acknowledgment clears the degradation this module caused.
//
// Host composition installs: the AccountController alarm calling `integrationEventsAlarm(owner)`, X4 commits
// calling `integrationEventsKick(owner)`, and the Worker/Node composition of INTEGRATION_EVENT_PORTS (signer over the
// brokering store, the egress adapters below, X8's preferences snapshot port).
import {Provider} from '../../vendor/ngin/index.js';
import {AppAction,AppQuery,createAppEngine,operations,perform,read} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../app/providers.mjs';
import {PREFERENCES_UPDATED_EVENT,prefixedURL} from '../federation/integrations.mjs';
import {publicAddress} from '../apps/form-fetch-policy.mjs';
// ==== EV-3 doorbell hunk (imports) ====
import {BUS_ADVANCED_EVENT,doorbellTarget,markDoorbellSent,eventDoorbellsProvider,RingEventDoorbells,CancelEventDoorbells,SetEventBusPush,EventBusSubscriptions,EVENT_DOORBELL_APP_OPERATIONS} from '../events/doorbell.mjs';
import {busKeys} from '../events/cursor.mjs';
// ==== end EV-3 doorbell hunk ====
import {INTEGRATION_EVENT_MEDIA_TYPE,INTEGRATION_EVENT_MAX_BYTES,IntegrationEventFault,integrationEventSize,rejectionCode} from '../core/cose.mjs';
export {INTEGRATION_EVENT_MEDIA_TYPE,INTEGRATION_EVENT_TYP,INTEGRATION_EVENT_AAD,verifyIntegrationEvent,parseIntegrationEvent,IntegrationEventFault,integrationEventRejection,ctiId} from '../core/cose.mjs';

const EVENT=name=>`https://spec.bindle.example/events/${name}/v1`;
export const INTEGRATION_EVENT_TYPES=Object.freeze({'preferences-updated':PREFERENCES_UPDATED_EVENT,...Object.fromEntries(['credential-revoked','connection-revoked','subject-deleted','connection-resumed','resource-detached'].map(name=>[name,EVENT(name)])),'bus-advanced':BUS_ADVANCED_EVENT/* EV-3 */});
const REVOCATION=new Set(['connection-revoked','credential-revoked','subject-deleted']),CONTROL=new Set([...REVOCATION,'connection-resumed']),LIVE=['configuring','active','degraded'];
const PRIORITY=Object.freeze({'subject-deleted':0.5,'connection-revoked':0,'credential-revoked':0,'connection-resumed':1,'preferences-updated':2,'resource-detached':2,'bus-advanced':3/* EV-3: lowest */});
const FIELDS=Object.freeze({'subject-deleted':['generation','notBefore'],'preferences-updated':['fragment'],'credential-revoked':['grants','until'],'connection-revoked':['floor','terminal'],'connection-resumed':['generation'],'resource-detached':['resource'],'bus-advanced':['bus','resource']/* EV-3 */});
/** Spec bounds (§6.4, §11.6, §11.10). `window` ≥ 72 h; `firstRetry` ≤ 10 s; `maxRetry` ≤ 1 h; events responses ≤ 4 KiB;
 * `eventBytes` the encoded COSE message bound (64 KiB, spike §8 item 23, provisional). */
export const INTEGRATION_EVENT_LIMITS=Object.freeze({rows:512,perConnection:64,window:72*3600000,firstRetry:10000,maxRetry:3600000,timeoutMs:5000,responseBytes:4096,eventBytes:INTEGRATION_EVENT_MAX_BYTES,sends:8,perConnectionSends:2,deadlineMs:20000,ingest:200,log:128,unacked:64,doorbellRows:64,doorbellsPerConnection:32/* EV-3: a separate doorbell row budget */});
const L=INTEGRATION_EVENT_LIMITS;
const ROW='integration-events/row/',CONN='integration-events/conn/',META='integration-events/meta',LOG='integration-events/log/',UNACKED='integration-events/unacked/';
const pad=n=>String(n).padStart(16,'0'),fault=(code,message,status=400)=>{throw new AppFault(code,message,status);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const UUID=/^[a-f0-9-]{36}$/,CONNECTION=/^[A-Za-z0-9._~-]{1,128}$/,GRANT=/^[A-Za-z0-9._~-]{1,128}$/,CODE=/^[a-z0-9_]{1,64}$/;
const httpsId=(v,max=256)=>{if(typeof v!=='string'||v.length>max||/[\u0000- \u007f]/.test(v))return false;try{const u=new URL(v);return u.protocol==='https:'&&u.href===v&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}};
const b64u=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const token16=random=>b64u(random.bytes(16));
const fromToken16=value=>{const raw=atob(value.replaceAll('-','+').replaceAll('_','/')+'==');const out=Uint8Array.from(raw,c=>c.charCodeAt(0));if(out.length!==16)throw new TypeError('A cti is 16 bytes.');return out;};

// ---- Outbox rows (pure transaction functions over tx.get/put/delete/list) ----
function eventInput(e){
 if(!plain(e)||!Object.hasOwn(FIELDS,e.type)||typeof e.connection!=='string'||!CONNECTION.test(e.connection)||Object.keys(e).some(k=>!['type','connection',...FIELDS[e.type]].includes(k)))fault('invalid_request','Unsupported integration event.');
 const out={type:e.type,connection:e.connection},ok=(test)=>{if(!test)fault('invalid_request','Unsupported integration event.');};
 if(e.type==='subject-deleted'){ok(Number.isSafeInteger(e.generation)&&e.generation>=1&&Number.isSafeInteger(e.notBefore)&&e.notBefore>=0);Object.assign(out,{generation:e.generation,notBefore:e.notBefore});}
 else if(e.type==='preferences-updated'){ok(httpsId(e.fragment));out.fragment=e.fragment;}
 else if(e.type==='resource-detached'){ok(httpsId(e.resource,512));out.resource=e.resource;}
 else if(e.type==='connection-revoked'){ok(Number.isSafeInteger(e.floor)&&e.floor>=1&&typeof e.terminal==='boolean');Object.assign(out,{floor:e.floor,terminal:e.terminal});}
 else if(e.type==='connection-resumed'){ok(Number.isSafeInteger(e.generation)&&e.generation>=1);out.generation=e.generation;}
 else if(e.type==='bus-advanced'){ok(typeof e.bus==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e.bus)&&httpsId(e.resource,512));Object.assign(out,{bus:e.bus,resource:e.resource});}/* EV-3 */
 else{ok(Array.isArray(e.grants)&&e.grants.length>0&&e.grants.length<=64&&new Set(e.grants).size===e.grants.length&&e.grants.every(g=>typeof g==='string'&&GRANT.test(g))&&Number.isSafeInteger(e.until)&&e.until>0);Object.assign(out,{grants:[...e.grants],until:e.until});}
 return out;
}
// Every row under a prefix, paged with startAfter (storage pages are bounded; a store that ignores startAfter still
// terminates because only keys after the last one seen are taken). Callers bound the prefix's size by the caps.
async function rowsUnder(tx,prefix,page=256){
 const out=[];let after='';
 for(;;){const got=[...(await tx.list({prefix,startAfter:after,limit:page})).entries()].filter(([k])=>k>after);out.push(...got);if(got.length<page)return out;after=got.at(-1)[0];}
}
async function meta(tx){const m=await tx.get(META);return m?.v===1?{bells:0,...m}:{v:1,cursor:0,order:0,rows:0,log:0,unacked:0,bells:0};}
async function conn(tx,id){const k=await tx.get(CONN+id);return k?.v===1?k:{v:1,seq:0,generation:0};}
async function remove(tx,m,key){await tx.delete(key);if(bell(key))m.bells=Math.max(0,m.bells-1);/* EV-3 */else m.rows=Math.max(0,m.rows-1);}
async function log(tx,m,entry,limits){m.log++;await tx.put(LOG+pad(m.log),entry);if(m.log>limits.log)await tx.delete(LOG+pad(m.log-limits.log));}
async function unacked(tx,m,entry,limits){if(entry.type==='subject-deleted')m.subjectDeletedUndelivered=(m.subjectDeletedUndelivered??0)+1;m.unacked++;await tx.put(UNACKED+pad(m.unacked),entry);if(m.unacked>limits.unacked)await tx.delete(UNACKED+pad(m.unacked-limits.unacked));}
// Appends (or coalesces) one validated event, mutating `m`; the caller writes META. Fails visibly when bounds are full.
async function put(tx,m,e,now,limits){
 // EV-3: doorbells take their own budget and never count against (or get evicted by) the rows below.
 if(e.type==='subject-deleted'){const key=ROW+e.connection+'/subject-deleted';if(await tx.get(key))return {coalesced:true};m.order++;m.rows++;await tx.put(key,{...e,key,order:m.order,priority:PRIORITY[e.type],createdAt:now,nextAt:Math.max(now,e.notBefore),attempts:0});return {coalesced:false};}
 if(e.type==='bus-advanced')return putDoorbell(tx,m,e,now,limits);
 // Wargame3 F2: count this connection's rows exactly (paged), so the per-connection ceilings below actually hold.
 const prefix=ROW+e.connection+'/',rows=(await rowsUnder(tx,prefix)).filter(([k])=>!bell(k)),drop=new Set();let key,carry;
 const supersede=k=>{const old=rows.find(([x])=>x===k)?.[1];if(old){drop.add(k);carry=old.firstAttemptAt;}};
 if(e.type==='preferences-updated'){key=prefix+'p:'+encodeURIComponent(e.fragment);supersede(key);}
 else if(e.type==='resource-detached'){key=prefix+'d:'+encodeURIComponent(e.resource);supersede(key);}
 else if(e.type==='connection-resumed'){
  if(rows.some(([,r])=>r.type==='connection-resumed'&&r.generation>=e.generation||r.type==='connection-revoked'&&r.floor>e.generation))return {coalesced:true};
  for(const [k,r] of rows)if(r.type==='connection-resumed')drop.add(k);key=prefix+'s';
 }else if(e.type==='connection-revoked'){
  // Floors only rise: a pending revoke at or above this floor that is at least as terminal already says everything.
  if(rows.some(([,r])=>r.type==='connection-revoked'&&r.floor>=e.floor&&(r.terminal||!e.terminal)))return {coalesced:true};
  for(const [k,r] of rows)if(r.type==='connection-revoked'&&r.floor<=e.floor&&(e.terminal||!r.terminal)||r.type==='connection-resumed'&&r.generation<e.floor)drop.add(k);
  key=prefix+'r:'+pad(m.order+1);
 }else if(e.type==='credential-revoked'){
  // Wargame3 F2: one pending credential-revoked per connection while the grants fit one event: union the grants and
  // keep the latest `until`. The older row is replaced (never edited in place), so an in-flight attempt on it settles
  // as superseded and the merged row is sent afresh; its 72 h window carries over.
  const merge=rows.find(([k,r])=>r.type==='credential-revoked'&&!drop.has(k)&&new Set([...r.grants,...e.grants]).size<=64);
  if(merge){const [k,r]=merge;drop.add(k);carry=r.firstAttemptAt;e={...e,grants:[...new Set([...r.grants,...e.grants])],until:Math.max(r.until,e.until)};}
  key=prefix+'c:'+pad(m.order+1);
 }else key=prefix+'c:'+pad(m.order+1);
 // X6-S1: a revocation is never refused inside a severance commit. Over the caps it evicts this connection's
 // non-control rows (an integration that misses them reads @preferences); only the hard ceiling (twice the caps,
 // reachable by revocations alone) fails, and visibly.
 if(REVOCATION.has(e.type)){const over=Math.max(rows.length-drop.size+1-limits.perConnection,m.rows-drop.size+1-limits.rows);if(over>0)for(const [k,r] of rows.filter(([k,r])=>!drop.has(k)&&!CONTROL.has(r.type)).slice(0,over))drop.add(k);}
 const ceiling=REVOCATION.has(e.type)?2:1;
 if(rows.length-drop.size+1>limits.perConnection*ceiling||m.rows-drop.size+1>limits.rows*ceiling)fault('integration_events_full','Too many integration events are pending.',503);
 for(const k of drop)await remove(tx,m,k);
 m.order++;m.rows++;
 await tx.put(key,{...e,key,order:m.order,priority:PRIORITY[e.type],createdAt:now,nextAt:now,attempts:0,...carry===undefined?{}:{firstAttemptAt:carry}});
 return {coalesced:drop.size>0};
}
// ==== EV-3 doorbell hunk (rows): docs/spec/events.md §7.2, packages/events/doorbell.mjs ====
// At most one pending `bus-advanced` row per (connection, bus), keyed `b:<bus>`; an existing row is kept (its payload
// is rebuilt at send time). Rows count in `m.bells` against doorbellRows/doorbellsPerConnection only, so a full
// doorbell budget refuses only the doorbell (the ring coalesces it) and never an owner write or a revocation.
const bell=key=>key.slice(ROW.length).split('/')[1]?.startsWith('b:')===true;
async function putDoorbell(tx,m,e,now,limits){
 const prefix=ROW+e.connection+'/',key=prefix+'b:'+e.bus;if(await tx.get(key))return {coalesced:true};
 if((await tx.list({prefix:prefix+'b:',limit:limits.doorbellsPerConnection+1})).size>=limits.doorbellsPerConnection||m.bells>=limits.doorbellRows)fault('integration_events_full','Too many integration events are pending.',503);
 m.order++;m.bells++;await tx.put(key,{...e,key,order:m.order,priority:PRIORITY[e.type],createdAt:now,nextAt:now,attempts:0});return {coalesced:false};
}
/** Same-commit cancellation of one pending doorbell (unsubscribe, revocation, owner pause). */
export async function cancelIntegrationDoorbell(tx,{connection,bus}){
 if(typeof connection!=='string'||!CONNECTION.test(connection)||typeof bus!=='string')return false;
 const key=ROW+connection+'/b:'+bus;if(!await tx.get(key))return false;const m=await meta(tx);await remove(tx,m,key);await tx.put(META,m);return true;
}
// ==== end EV-3 doorbell hunk ====
/** Same-commit enqueue for other writers of this account store (X7 credential-revoked/resource-detached, X8 markers):
 * call inside the transaction that changes the authority or configuration (transactional outbox, §6.3, §7.2). */
export async function enqueueIntegrationEvent(tx,event,{now=Date.now(),limits=L}={}){const e=eventInput(event),m=await meta(tx),out=await put(tx,m,e,now,limits);await tx.put(META,m);return out;}
/** X6-S8: the connection's current configuration `seq`, for X8's preferences/v2 reads (§5.1, §6.2), read in the same
 * account-store transaction as the projection. X6 is the sole consumer of the X4 outbox and acknowledges what it ingests. */
export async function currentSeq(tx,connection){return (await conn(tx,connection)).seq;}
const fromConnectionEvent=e=>!plain(e)||typeof e.connection!=='string'||!CONNECTION.test(e.connection)||!Number.isSafeInteger(e.generation)||e.generation<1?null:e.type==='connection-revoked'?{type:'connection-revoked',connection:e.connection,floor:e.generation,terminal:e.terminal===true}:e.type==='connection-resumed'?{type:'connection-resumed',connection:e.connection,generation:e.generation}:null;

// ---- Endpoint policy and egress (§11.1, §11.6; protocol §2 SSRF rules) ----
const publicHostname=host=>host.length<=253&&host.includes('.')&&host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&!/^\d+(?:\.\d+)*$/.test(host)&&!/(?:^|\.)(?:localhost|local|internal|invalid|test|onion|arpa|home)$/.test(host);
/** A deliverable events endpoint: canonical HTTPS on 443, a public DNS name (no IP literal, no special-use name), no
 * userinfo, query or fragment, and never the issuer's own host. Returns a URL or null. */
export function eventEndpointURL(value,{issuer}={}){
 if(typeof value!=='string'||value.length>2048)return null;let u;try{u=new URL(value);}catch{return null;}
 if(u.href!==value||u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||value.includes('#')||value.includes('?')||!publicHostname(u.hostname))return null;
 if(issuer!==undefined){let own;try{own=new URL(issuer).hostname;}catch{return null;}if(own===u.hostname||u.hostname.endsWith('.'+own))return null;}
 return u;
}
// The pinned snapshot is the only source of the URL: on the client_id origin and path prefix (X3), external, not built-in.
function endpointOf(c,issuer){
 const url=c?.integration?.kind==='external'?c.integration.snapshot?.manifest?.events_endpoint:undefined;
 return typeof url==='string'&&prefixedURL(url,c.clientId)===url&&eventEndpointURL(url,{issuer})?url:null;
}
const subscribed=c=>c.integration?.snapshot?.manifest?.events??[PREFERENCES_UPDATED_EVENT];
const egressError=()=>Object.assign(new Error('The events endpoint could not be reached safely.'),{code:'event_transport_unavailable'});
function egressLimits({timeoutMs=L.timeoutMs,maxConcurrent=4}={}){if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>16)throw new TypeError('Event egress needs timeoutMs ≤ 10 s and maxConcurrent ≤ 16.');return {timeoutMs,maxConcurrent};}
function egressInput({url,body,timeoutMs}={},issuer,limit){const u=eventEndpointURL(url,{issuer});if(!u||!(body instanceof Uint8Array)||!body.length||body.length>L.eventBytes)throw egressError();return {u,body:new Uint8Array(body),timeout:Math.min(Number.isSafeInteger(timeoutMs)&&timeoutMs>0?timeoutMs:limit,limit)};}
const REQUEST_HEADERS=Object.freeze({'Content-Type':INTEGRATION_EVENT_MEDIA_TYPE,Accept:'application/cbor','Accept-Encoding':'identity'});
/** Node egress: DNS-pinned, globally routable IPv4 only (the reviewed form-postback policy), original-hostname TLS
 * verification, port 443, POST, no redirects (3xx is returned and treated as a failure), identity encoding, a 4 KiB
 * body bound and one deadline. `lookup` (node:dns/promises) and `request` (node:https) are injected so this module
 * stays importable by the Worker bundle. */
export function createNodeEventEgress({lookup,request,issuer,...limits}={}){
 if(typeof lookup!=='function'||typeof request!=='function')throw new TypeError('Node event egress needs injected lookup and request.');
 const {timeoutMs,maxConcurrent}=egressLimits(limits);let active=0;
 return {async send(input){const {u,body,timeout}=egressInput(input,issuer,timeoutMs);if(active>=maxConcurrent)throw egressError();active++;
  try{return await new Promise((resolve,reject)=>{
   let req,res,done=false;const timer=setTimeout(()=>finish(egressError()),timeout);
   function finish(error,value){if(done)return;done=true;clearTimeout(timer);if(error){res?.destroy();req?.destroy();reject(egressError());}else resolve(value);}
   Promise.resolve().then(()=>lookup(u.hostname,{all:true,family:4,verbatim:true})).then(records=>{
    if(done)return;if(!Array.isArray(records)||!records.length||records.length>64||records.some(r=>r?.family!==4||typeof r.address!=='string'||r.address.includes(':')||!publicAddress(r.address)))throw egressError();const selected=records[0].address;
    const pinned=(_host,opts,cb)=>{if(typeof opts==='function'){cb=opts;opts={};}if(opts?.all)cb(null,[{address:selected,family:4}]);else cb(null,selected,4);};
    req=request({protocol:'https:',hostname:u.hostname,port:443,path:u.pathname,method:'POST',servername:u.hostname,lookup:pinned,agent:false,rejectUnauthorized:true,maxHeaderSize:8192,headers:{...REQUEST_HEADERS,Host:u.host,'Content-Length':String(body.length)}},incoming=>{
     res=incoming;if(done){res.destroy();return;}try{
      const status=res.statusCode;if(!Number.isInteger(status)||status<200||status>599)throw egressError();
      if(status>=300&&status<400){finish(null,{status,bytes:new Uint8Array()});res.destroy();return;}
      const length=res.headers['content-length'],encoding=res.headers['content-encoding'];if(encoding&&encoding.toLowerCase()!=='identity'||length!==undefined&&(!/^\d+$/.test(length)||Number(length)>L.responseBytes))throw egressError();
      const chunks=[];let total=0;res.on('data',chunk=>{if(done)return;total+=chunk.length;if(total>L.responseBytes){finish(egressError());return;}chunks.push(new Uint8Array(chunk));});res.once('error',()=>finish(egressError()));res.once('aborted',()=>finish(egressError()));
      res.once('end',()=>{const out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}finish(null,{status,bytes:out});});
     }catch{finish(egressError());}
    });req.once('error',()=>finish(egressError()));req.end(body);
   }).catch(()=>finish(egressError()));
  });}finally{active--;}
 }};
}
/** Workers egress: requires `global_fetch_strictly_public` (publicRouting) and screens A/AAAA over DoH, refusing any
 * non-public answer. DoH screening is NOT connection pinning (DNS can change before the native fetch), so the
 * strictly-public routing flag is the actual guard, the residual risk recorded for client-id-metadata.v1. No
 * credentials, no redirects (returned and treated as a failure), identity encoding, a 4 KiB body bound, one deadline.
 * Only the global public fetch is injected; never a VPC or service-binding fetch. */
export function createWorkerEventEgress({publicRouting=false,fetcher=globalThis.fetch,issuer,...limits}={}){
 if(publicRouting!==true)throw new TypeError('Event egress requires global_fetch_strictly_public.');
 const {timeoutMs,maxConcurrent}=egressLimits(limits);let active=0;
 async function bounded(response,max){const reader=response.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let total=0;try{for(;;){const r=await reader.read();if(r.done)break;total+=r.value.byteLength;if(total>max)throw egressError();chunks.push(r.value);}}catch(e){reader.cancel().catch(()=>{});throw e;}const out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
 async function dns(host,type,signal){
  const endpoint=new URL('https://cloudflare-dns.com/dns-query');endpoint.searchParams.set('name',host);endpoint.searchParams.set('type',String(type));
  const response=await fetcher(endpoint.href,{method:'GET',headers:{Accept:'application/dns-json'},credentials:'omit',redirect:'manual',cache:'no-store',referrerPolicy:'no-referrer',signal});
  if(response.status!==200||!(response.headers.get('Content-Type')||'').toLowerCase().includes('application/dns-json')){await response.body?.cancel();throw egressError();}
  let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,16384)));}catch{throw egressError();}
  if(result?.Status!==0||result.TC===true||!Array.isArray(result.Question)||result.Question.length!==1||result.Question[0].name?.replace(/\.$/,'').toLowerCase()!==host||result.Question[0].type!==type||result.Answer!==undefined&&!Array.isArray(result.Answer))throw egressError();
  const answers=result.Answer??[];if(answers.length>64||answers.some(r=>![5,type].includes(r?.type)))throw egressError();
  const addresses=answers.filter(r=>r.type===type).map(r=>r.data);if(addresses.some(a=>!publicAddress(a)||type===1&&a.includes(':')||type===28&&!a.includes(':')))throw egressError();return addresses;
 }
 return {async send(input){const {u,body,timeout}=egressInput(input,issuer,timeoutMs);if(active>=maxConcurrent)throw egressError();active++;
  const controller=new AbortController();let timer;
  const run=async()=>{
   const a=await dns(u.hostname,1,controller.signal),aaaa=await dns(u.hostname,28,controller.signal);if(!a.length&&!aaaa.length)throw egressError();
   const response=await fetcher(u.href,{method:'POST',headers:REQUEST_HEADERS,body,credentials:'omit',redirect:'manual',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   const status=response.status;if(!Number.isInteger(status)||status<200||status>599){await response.body?.cancel();throw egressError();}
   if(status>=300&&status<400){await response.body?.cancel();return {status,bytes:new Uint8Array()};}
   const length=response.headers.get('Content-Length'),encoding=response.headers.get('Content-Encoding');if(encoding&&encoding.toLowerCase()!=='identity'||length!==null&&(!/^\d+$/.test(length)||Number(length)>L.responseBytes)){await response.body?.cancel();throw egressError();}
   return {status,bytes:await bounded(response,L.responseBytes)};
  };
  try{return await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(egressError());},timeout);})]);}
  catch{controller.abort();throw egressError();}finally{clearTimeout(timer);active--;}
 }};
}

// ---- Verification ----
// Receivers verify with verifyIntegrationEvent (packages/core/cose.mjs, re-exported above and by the SDK as
// @3sln/bindle/integration-events.mjs): the spike §5.4 order, every strict COSE rule, cti returned for dedupe.

// ---- Delivery ----
// Least data (§6.2, §11.5): resource references in a snapshot lose `token`, `token_type` and `expires_at`.
const STRIP=['token','token_type','expires_at'];
// X6-S5: any object with a string `id` is a resource reference; the keys go at every depth inside it, so nothing under
// `broker` or a contract-less reference carries a credential. Owner fields outside references are untouched.
function minimize(value,depth=0,inside=false){
 if(depth>16)fault('unavailable','Preference snapshot too deep.',503);
 if(Array.isArray(value))return value.map(v=>minimize(v,depth+1,inside));
 if(value===null||['string','boolean'].includes(typeof value)||Number.isFinite(value))return value;
 if(!plain(value))fault('unavailable','Preference snapshot is not plain data.',503);
 const resource=inside||typeof value.id==='string';
 return Object.fromEntries(Object.entries(value).filter(([k])=>!(resource&&STRIP.includes(k))).map(([k,v])=>[k,minimize(v,depth+1,resource)]));
}
function backoff(x,attempts){const base=Math.min(x.limits.maxRetry,x.limits.firstRetry*2**Math.min(attempts-1,30));return Math.max(1,Math.floor(base*(0.5+0.5*x.random.bytes(1)[0]/255)));}
function classify(response){
 if(!plain(response)||!Number.isInteger(response.status))return {kind:'retry',code:'transport'};
 if(response.status===202)return {kind:'ack'};
 if(response.status===400){const code=response.bytes instanceof Uint8Array?rejectionCode(response.bytes):null;return {kind:'rejected',code:code&&CODE.test(code)?code:'invalid_request'};}
 return {kind:'retry',code:response.status>=300&&response.status<400?'redirect':'http_'+response.status};
}
function payloadOf(r,c,snap,target){
 if(r.type==='preferences-updated')return {generation:c.generation,body:{fragment:r.fragment,revision:snap.revision??null,values:snap.values===null?null:minimize(snap.values)}};
 if(r.type==='connection-revoked')return {generation:r.floor,body:{generation_floor:r.floor,terminal:r.terminal}};
 if(r.type==='connection-resumed'||r.type==='subject-deleted')return {generation:r.generation,body:{}};
 if(r.type==='credential-revoked')return {generation:c.generation,body:{grants:r.grants,until:r.until}};
 if(r.type==='bus-advanced')return {generation:c.generation,body:{bus:target.bus,head:target.head}};/* EV-3: data-free */
 return {generation:c.generation,body:{resource:r.resource}};
}
async function drop(x,r,code){
 const now=x.clock.now();
 await x.store.transaction(async tx=>{const cur=await tx.get(r.key);if(!cur||cur.order!==r.order)return;const m=await meta(tx);await remove(tx,m,r.key);
  const entry={at:now,connection:r.connection,type:r.type,outcome:'dropped',code};await log(tx,m,entry,x.limits);if(REVOCATION.has(r.type)&&(code==='unknown_connection'||r.type==='subject-deleted'))await unacked(tx,m,{...entry,reason:code},x.limits);await tx.put(META,m);});
 return 'dropped';
}
async function attempt(x,owner,port,r,c){
 const now=x.clock.now(),endpoint=endpointOf(c,x.issuer);
 if(!c)return drop(x,r,'unknown_connection');if(!endpoint)return drop(x,r,'no_endpoint');
 // Revocations are always deliverable; anything else needs a live connection (§3.1: no events while paused).
 if(!REVOCATION.has(r.type)&&!LIVE.includes(c.state))return c.state==='disconnected'?drop(x,r,'disconnected'):now-r.createdAt>=x.limits.window?drop(x,r,'stale'):'held';
 if(!CONTROL.has(r.type)&&!subscribed(c).includes(INTEGRATION_EVENT_TYPES[r.type]))return drop(x,r,'unsubscribed');
 if(r.type==='credential-revoked'&&r.until*1000<=now)return drop(x,r,'moot');
 let snap;
 if(r.type==='preferences-updated'){
  if(typeof x.snapshot!=='function')return 'held';
  try{snap=await x.snapshot({owner,connection:c.id,clientId:c.clientId,generation:c.generation,fragment:r.fragment});}catch{snap=undefined;}
  if(!plain(snap)||!Object.hasOwn(snap,'values')||snap.values!==null&&!plain(snap.values)||snap.revision!==undefined&&snap.revision!==null&&!(typeof snap.revision==='string'&&snap.revision.length<=128||Number.isSafeInteger(snap.revision)))snap=undefined;
 }
 // EV-3: a doorbell's body comes from live subscription state, re-checked inside the lease commit below.
 let target;if(r.type==='bus-advanced'){target=await doorbellTarget(x.store,{row:r,connection:c,owner,subscribed:x.doorbellGrant??null});if(!target)return drop(x,r,'moot');}
 let built;try{built=snap===undefined&&r.type==='preferences-updated'?null:payloadOf(r,c,snap,target);}catch{built=null;}
 const lease=await x.store.transaction(async tx=>{
  const cur=await tx.get(r.key);if(!cur||cur.order!==r.order||cur.nextAt>now)return null;
  // The connection listing predates this pass (and the snapshot fetch): re-check the live record inside the lease, so
  // a disconnect or generation change in between never lets a data-bearing event out (wargame plausible-4).
  // A composition whose connection port is not backed by this store has no row here and relies on the listing.
  if(!REVOCATION.has(r.type)){const live=await tx.get('resource/'+c.id);if(live&&(live.generation!==c.generation||!LIVE.includes(live.state??(live.status==='active'?'active':'disconnected'))))return {stale:true};}
  if(r.type==='bus-advanced'){const again=await doorbellTarget(tx,{row:r,connection:c});if(!again)return {moot:true};built=payloadOf(r,c,snap,again);await markDoorbellSent(tx,{row:r,now});}/* EV-3 */
  // CBOR phase 5 reset (`integration-events-cti-v1`): a row leased under the SET format carries a `jti`; that pending
  // signed attempt is discarded here (bounded: this row, in this commit; idempotent: the field is gone afterwards) and
  // the row is sent afresh with a new cti and seq.
  if(Object.hasOwn(cur,'jti')){delete cur.jti;delete cur.cti;}
  if(built&&(!cur.cti||JSON.stringify([cur.sentGeneration,cur.body])!==JSON.stringify([built.generation,built.body]))){
   const k=await conn(tx,c.id);if(k.seq>=Number.MAX_SAFE_INTEGER)fault('unavailable','Event sequence exhausted.',503);
   Object.assign(cur,{cti:token16(x.random),seq:++k.seq,sentGeneration:built.generation,body:built.body});await tx.put(CONN+c.id,k);
  }
  cur.attempts++;cur.firstAttemptAt??=now;cur.nextAt=now+backoff(x,cur.attempts);cur.attempt=token16(x.random);await tx.put(r.key,cur);return cur;
 });
 if(!lease||lease.stale)return 'skipped';
 if(lease.moot||r.type==='bus-advanced'&&!await doorbellTarget(x.store,{row:r,connection:c,owner,subscribed:x.doorbellGrant??null}))return drop(x,r,'moot');/* EV-3: re-checked just before egress (EV3-R5) */
 let outcome;
 if(!built)outcome={kind:'retry',code:'snapshot_unavailable'};
 else{
  const claims={iss:x.issuer,sub:x.subject(owner),aud:endpoint,iat:Math.floor(now/1000),cti:fromToken16(lease.cti),events:{[INTEGRATION_EVENT_TYPES[r.type]]:{connection:c.id,generation:lease.sentGeneration,seq:lease.seq,...lease.body}}};
  // Never sign an oversize event (size-limits spike): the exact encoded size under the longest allowed kid.
  let bytes;try{bytes=integrationEventSize(claims);}catch(error){if(!(error instanceof IntegrationEventFault))throw error;bytes=null;}
  if(bytes===null)outcome={kind:'rejected',code:'invalid_event'};
  else if(bytes>x.limits.eventBytes)outcome={kind:'rejected',code:'oversize'};
  else try{const signed=await x.signer.sign('event',claims);if(!(signed?.message instanceof Uint8Array))throw egressError();outcome=classify(await x.egress.send({url:endpoint,body:signed.message,timeoutMs:x.limits.timeoutMs}));}catch{outcome={kind:'retry',code:'transport'};}
 }
 return settle(x,owner,port,r,c,lease,outcome);
}
async function settle(x,owner,port,r,c,lease,outcome){
 const now=x.clock.now();
 const s=await x.store.transaction(async tx=>{
  const cur=await tx.get(r.key);if(!cur||cur.attempt!==lease.attempt)return {result:'superseded'};
  const m=await meta(tx),k=await conn(tx,c.id),entry={at:now,connection:c.id,type:r.type,seq:lease.seq??null,attempts:cur.attempts};let result,health;
  if(outcome.kind==='ack'){await remove(tx,m,r.key);k.delivered={seq:lease.seq,at:now};if(k.degraded){delete k.degraded;health=false;}result='acknowledged';}
  else if(outcome.kind==='rejected'){await remove(tx,m,r.key);result='rejected';if(REVOCATION.has(r.type))await unacked(tx,m,{...entry,reason:outcome.code},x.limits);}
  else if(now-cur.firstAttemptAt>=x.limits.window){
   // X6-S2: the endpoint failed for the whole window, so the connection's backlog expires with this row instead of
   // starting its own 72 h one row at a time; revocations among it are recorded as unacknowledged.
   result='expired';for(const [key,row] of await rowsUnder(tx,ROW+c.id+'/')/* wargame3 F2: the whole backlog, paged */){if(row.type==='subject-deleted'&&now-(row.firstAttemptAt??row.nextAt)<x.limits.window)continue;await remove(tx,m,key);
    if(REVOCATION.has(row.type))await unacked(tx,m,{...entry,type:row.type,seq:row.seq??null,reason:'expired'},x.limits);else if(!k.degraded){k.degraded=true;health=true;}
    if(key!==r.key)await log(tx,m,{at:now,connection:c.id,type:row.type,outcome:'expired',code:'backlog'},x.limits);}}
  else{cur.lastError=outcome.code;await tx.put(r.key,cur);result='retrying';}
  if(result!=='retrying')await log(tx,m,{...entry,outcome:result,...outcome.code?{code:outcome.code}:{}},x.limits);
  await tx.put(CONN+c.id,k);await tx.put(META,m);return {result,health};
 });
 // X4 health is fenced by generation; a stale generation (the connection moved on) changes nothing.
 if(s.health!==undefined)try{await port.health({connection:c.id,expectedGeneration:c.generation,degraded:s.health});}catch{}
 if(!['retrying','superseded'].includes(s.result))x.audit.record({operation:'integration-events.delivery',actor:{kind:'system',owner},outcome:s.result,connection:c.id,type:r.type,seq:lease.seq??null,...outcome.code?{code:outcome.code}:{}});
 return s.result;
}
const listed=async port=>{const out=await port.list(),list=Array.isArray(out)?out:out?.connections;if(!Array.isArray(list))fault('unavailable','Connections are unavailable.',503);return list;};
// CBOR phase 5 destructive reset `integration-events-cti-v1` (spike §7.2): rows leased under the SET format carry a
// `jti` (the signed-but-undelivered SET attempt's identity). Once per account store, in one commit bounded by the row
// caps, the `jti` is dropped so the next attempt is a fresh COSE event with a new cti and seq; the marker on META makes
// it idempotent. Rows themselves (re-derived markers), `seq` and generation counters are kept. The lease applies the
// same rule per row, for a delivery pass that runs before any ingest.
export const INTEGRATION_EVENTS_CTI_RESET='integration-events-cti-v1';
async function resetSetAttempts(x){
 if((await x.store.get(META))?.cti===1)return 0;
 return x.store.transaction(async tx=>{const m=await meta(tx);if(m.cti===1)return 0;let n=0;
  for(const [key,row] of await rowsUnder(tx,ROW))if(plain(row)&&Object.hasOwn(row,'jti')){const next={...row};delete next.jti;delete next.cti;await tx.put(key,next);n++;}
  m.cti=1;await tx.put(META,m);return n;});
}
async function ingest(x,owner){
 await resetSetAttempts(x);
 const port=x.connections(owner),before=await x.store.get(META),start=before?.v===1?before.cursor:0;
 const out=await port.outbox({after:start,limit:x.limits.ingest});
 if(!plain(out)||!Array.isArray(out.events)||typeof out.gap!=='boolean')fault('unavailable','The connections outbox is unavailable.',503);
 const connections=out.gap||before?.resync?await listed(port):null,now=x.clock.now();
 const result=await x.store.transaction(async tx=>{
  const m=await meta(tx);if(m.cursor!==start)return {ingested:0,cursor:m.cursor,raced:true};
  let ingested=0,full=false;
  for(const e of out.events.filter(e=>Number.isSafeInteger(e?.seq)&&e.seq>m.cursor).sort((a,b)=>a.seq-b.seq)){
   const mapped=fromConnectionEvent(e);
   // Wargame3 F2: a refused non-revocation (a resume) never stops ingest behind it, since a later revocation for
   // another connection must still get through. It is skipped without advancing that connection's generation, and the
   // resync below re-derives it from current state once there is room. Only a refused revocation stops the cursor.
   if(mapped)try{await put(tx,m,mapped,now,x.limits);ingested++;}catch(error){if(error?.code!=='integration_events_full')throw error;if(REVOCATION.has(mapped.type)){full=true;break;}m.resync=true;m.cursor=e.seq;
    // Review follow-up: remember the skipped resume on the connection record, so later unmapped events that advance
    // k.generation cannot make the resync below believe the connection is current and drop the resume for good.
    if(mapped.type==='connection-resumed'){const k=await conn(tx,mapped.connection);if(!k.pendingResume){k.pendingResume=true;await tx.put(CONN+mapped.connection,k);}}continue;}
   if(mapped||typeof e.connection==='string'&&CONNECTION.test(e.connection)&&Number.isSafeInteger(e.generation)){const k=await conn(tx,e.connection);if(e.generation>k.generation){k.generation=e.generation;await tx.put(CONN+e.connection,k);}}
   m.cursor=e.seq;
  }
  // A gap (X4 trimmed rows we never saw) is repaired from current state: every generation we did not see advance is
  // revoked below its current value, and a live connection is resumed at it. Retried until it fits.
  if(out.gap)m.resync=true;
  if(m.resync&&!full&&connections){
   let pending=false;
   try{for(const c of connections){if(!endpointOf(c,x.issuer)||!Number.isSafeInteger(c.generation))continue;const k=await conn(tx,c.id);if(c.generation<k.generation||c.generation===k.generation&&!k.pendingResume)continue;
    // A pending resume at the current generation needs only the resume (its revocation was already ingested).
    if(c.generation>k.generation||!LIVE.includes(c.state))await put(tx,m,{type:'connection-revoked',connection:c.id,floor:c.generation,terminal:c.state==='disconnected'},now,x.limits);
    // A refused resume leaves this connection for the next resync (its revocation above coalesces), never the others.
    if(LIVE.includes(c.state))try{await put(tx,m,{type:'connection-resumed',connection:c.id,generation:c.generation},now,x.limits);}catch(error){if(error?.code!=='integration_events_full')throw error;pending=true;continue;}
    k.generation=c.generation;delete k.pendingResume;await tx.put(CONN+c.id,k);ingested++;}if(!pending)delete m.resync;}catch(error){if(error?.code!=='integration_events_full')throw error;full=true;}
  }
  await tx.put(META,m);return {ingested,cursor:m.cursor,full,gap:out.gap,...m.resync?{resync:true}:{}};
 });
 if(result.cursor>start)try{await port.ack({through:result.cursor});}catch{/* The cursor already guards against re-ingest. */}
 return result;
}
// Wargame3 F2: delivery and status page through the outbox per connection, at most each connection's own ceiling
// (twice the cap, its doorbells and a subject deletion), so a large backlog under one connection id never hides the rows
// of connections whose ids sort after it.
async function pendingRows(x){
 const per=x.limits.perConnection*2+x.limits.doorbellsPerConnection+1,out=[];let after='';
 for(let guard=0;guard<4096;guard++){
  const [first]=[...(await x.store.list({prefix:ROW,startAfter:after,limit:1})).keys()].filter(k=>k>after);if(!first)break;
  const id=first.slice(ROW.length).split('/')[0],prefix=ROW+id+'/';
  out.push(...[...(await x.store.list({prefix,limit:per})).values()]);after=prefix+'\uffff';
 }
 return out;
}
async function deliver(x,owner,{limit}={}){
 if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>x.limits.sends))fault('invalid_request','Unsupported delivery request.');
 const port=x.connections(owner),started=x.clock.now(),max=limit??x.limits.sends,conns=new Map((await listed(port)).map(c=>[c.id,c]));
 const held=r=>!REVOCATION.has(r.type)&&!LIVE.includes(conns.get(r.connection)?.state??'active')||r.type==='preferences-updated'&&typeof x.snapshot!=='function',load=async()=>(await pendingRows(x)).sort((a,b)=>a.priority-b.priority||a.order-b.order);
 // Head of line per connection: a pending revocation (due or backing off) holds back resumes and other events.
 const head=(rows,id,gone=new Set())=>Math.min(...rows.filter(r=>r.connection===id&&!gone.has(r.key)&&!held(r)).map(r=>r.priority));
 const rows=await load(),gone=new Set(),per=new Map(),failed=new Map(),tally={acknowledged:0,rejected:0,retrying:0,expired:0,dropped:0,held:0,skipped:0,superseded:0};let sent=0;
 for(const r of rows){
  if(sent>=max||x.clock.now()-started>=x.limits.deadlineMs)break;
  if(failed.has(r.connection)||r.nextAt>x.clock.now()||(per.get(r.connection)??0)>=x.limits.perConnectionSends||r.priority>head(rows,r.connection,gone))continue;
  const outcome=await attempt(x,owner,port,r,conns.get(r.connection));tally[outcome]++;
  if(['acknowledged','rejected','retrying','expired'].includes(outcome)){sent++;per.set(r.connection,(per.get(r.connection)??0)+1);}
  if(!['retrying','held','skipped'].includes(outcome))gone.add(r.key);
  // One failure stops this connection until that row's retry: its endpoint is down or slow and must not starve others.
  if(outcome==='retrying')failed.set(r.connection,(await x.store.get(r.key))?.nextAt??x.clock.now());
 }
 const rest=await load();let next=null;
 for(const r of rest)if(!held(r)&&r.priority===head(rest,r.connection))next=Math.min(next??Infinity,Math.max(r.nextAt,failed.get(r.connection)??0));
 return {...tally,sent,pending:rest.length,next};
}
async function status(x){
 const values=async(prefix,limit)=>[...(await x.store.list({prefix,limit})).entries()];
 return {
  pending:(await pendingRows(x)).map(r=>({connection:r.connection,type:r.type,attempts:r.attempts,createdAt:r.createdAt,nextAt:r.nextAt,...r.firstAttemptAt?{firstAttemptAt:r.firstAttemptAt}:{},...r.seq?{seq:r.seq}:{},...r.lastError?{lastError:r.lastError}:{}})),
  connections:(await values(CONN,257)).map(([k,v])=>({connection:k.slice(CONN.length),seq:v.seq,degraded:v.degraded===true,delivered:v.delivered??null})),
  unacknowledged:(await values(UNACKED,x.limits.unacked+1)).map(([,v])=>v),
  log:(await values(LOG,x.limits.log+1)).map(([,v])=>v),
 };
}

// ---- Provider and operations ----
function limitsOf(over={}){
 const l={...L,...over};
 if(Object.keys(l).some(k=>!Object.hasOwn(L,k)||!Number.isSafeInteger(l[k])||l[k]<1)||l.window<L.window||l.firstRetry>L.firstRetry||l.maxRetry>L.maxRetry||l.responseBytes>L.responseBytes||l.timeoutMs>10000||l.rows>L.rows||l.perConnection>L.perConnection||l.doorbellRows>L.doorbellRows||l.doorbellsPerConnection>L.doorbellsPerConnection/* EV-3 */)throw new TypeError('Integration event limits must stay within the integrations §6.4 and §11 bounds.');
 return Object.freeze(l);
}
/** The `integrationEvents` provider class for createAppEngine. `connections(owner)` -> {outbox, ack, list, health}: the
 * X4 system operations for that owner. `signer.sign('event', claims)` -> {token}: brokering keys (X5). `egress.send({url,
 * body, timeoutMs})` -> {status, bytes}: an adapter above. `snapshot({owner, connection, clientId, generation, fragment})`
 * -> {revision, values}: X8's preferences/v2 projection for the integration (values null when its grant is revoked). */
export function integrationEventsProvider({enabled=false,issuer,subject,connections,signer,egress,snapshot,limits,ports,doorbellGrant/* EV-3 */}={}){
 const options=Object.freeze({enabled:enabled===true,issuer,subject:subject??(owner=>`${issuer}/entities/${owner}`),connections,signer,egress,snapshot,ports,limits:limitsOf(limits),doorbellGrant});
 return class extends IntegrationEventsProvider{static deps=['accountStore','clock','random','audit'];constructor(deps){super(deps,options);}};
}
export class IntegrationEventsProvider extends Provider{
 #deps;#options;#held=new WeakMap();
 constructor(deps,options){super();this.#deps=deps;this.#options=options;}
 async obtain({actor}={}){
  const o=this.#options;if(!o?.enabled)fault('not_found','Not found.',404);
  if(!UUID.test(actor?.owner??'')||!['owner','system'].includes(actor?.kind))fault('unauthorized','Sign in to continue.',401);
  const resources={},obtained=[];
  try{
   for(const name of ['accountStore','clock','random','audit']){resources[name]=await this.#deps[name].obtain();obtained.push(name);}
   const bound=await resources.accountStore.get('owner');if(bound!==undefined&&bound!==actor.owner)fault('forbidden','Account owner mismatch.',403);
   const handle=Object.freeze(scope({...o,...o.ports?o.ports():{},store:resources.accountStore,clock:resources.clock,random:resources.random,audit:resources.audit},actor));this.#held.set(handle,{resources,obtained});return handle;
  }catch(error){for(const name of obtained)await this.#deps[name].release(resources[name]);throw error;}
 }
 async release(handle){const held=this.#held.get(handle);if(!held)return;this.#held.delete(handle);for(const name of held.obtained)await this.#deps[name].release(held.resources[name]);}
}
const ready=x=>typeof x.connections==='function'&&typeof x.signer?.sign==='function'&&typeof x.egress?.send==='function'&&typeof x.issuer==='string';
function scope(x,actor){
 const owner=actor.owner,system=()=>{if(actor.kind!=='system')fault('forbidden','This operation is not available to this caller.',403);};
 const input=(value,names)=>{if(value===undefined)return {};if(!plain(value)||Object.keys(value).some(k=>!names.includes(k)))fault('invalid_request','Unsupported integration events request.');return value;};
 const enqueue=event=>x.store.transaction(tx=>enqueueIntegrationEvent(tx,event,{now:x.clock.now(),limits:x.limits}));
 return {
  status:()=>status(x),
  enqueue:value=>{system();const v=input(value,['type','connection','grants','until','resource']);if(!['credential-revoked','resource-detached'].includes(v.type))fault('invalid_request','Unsupported integration event.');return enqueue(v);},
  mark:value=>{system();const v=input(value,['connection','fragment']);if(typeof x.snapshot!=='function')fault('unavailable','Preference snapshots are unavailable.',503);return enqueue({type:'preferences-updated',connection:v.connection,fragment:v.fragment});},
  ingest:()=>{system();return ready(x)?ingest(x,owner):{ready:false};},
  deliver:value=>{system();return ready(x)?deliver(x,owner,input(value,['limit'])):{ready:false};},
 };
}
const CHANGED='integration-events-changed';
/** System. Drains the X4 connections outbox into delivery rows (one commit with the cursor), then acknowledges it. */
export class IngestIntegrationEvents extends AppAction{static operation='integration-events.ingest';static deps=['integrationEvents'];static changes=CHANGED;static lifecycle='purging';run({integrationEvents}){return integrationEvents.ingest();}}
/** System. `input`: {limit?}. One bounded delivery pass; returns the outcome tally and `next` (the earliest wake). */
export class DeliverIntegrationEvents extends AppAction{static operation='integration-events.deliver';static deps=['integrationEvents'];static changes=CHANGED;static lifecycle='purging';run({integrationEvents}){return integrationEvents.deliver(this.input);}}
/** System. `input`: {connection, fragment}: a preferences-updated marker from another single writer (idempotent). */
export class MarkPreferencesUpdated extends AppAction{static operation='integration-events.mark';static deps=['integrationEvents'];static changes=CHANGED;run({integrationEvents}){return integrationEvents.mark(this.input);}}
/** System. `input`: {type:'credential-revoked', connection, grants, until} | {type:'resource-detached', connection, resource}. */
export class EnqueueIntegrationEvent extends AppAction{static operation='integration-events.enqueue';static deps=['integrationEvents'];static changes=CHANGED;static lifecycle='purging';run({integrationEvents}){return integrationEvents.enqueue(this.input);}}
/** Owner or system: pending rows, per-connection seq and health, unacknowledged revocations and the delivery log
 * (owner-visible metadata without payloads, §7.3, §10). */
export class IntegrationEventStatus extends AppQuery{static operation='integration-events.status';static deps=['integrationEvents'];static refreshOn=[CHANGED];fetch({integrationEvents}){return integrationEvents.status();}}
export const INTEGRATION_EVENT_OPERATIONS=operations(IngestIntegrationEvents,DeliverIntegrationEvents,MarkPreferencesUpdated,EnqueueIntegrationEvent,IntegrationEventStatus);

// ---- AccountController slice (packages/runtime/account/index.mjs) ----
// `INTEGRATION_EVENT_PORTS` ({signer, egress, snapshot?, limits?}); snapshot.available=false holds X8 markers. is composed by the Worker and Node adapters. Without a
// signer and egress nothing is ingested or sent (the X4 outbox keeps its bounded rows).
const engines=new WeakMap();
function eventsEngine(c){
 let engine=engines.get(c);
 if(!engine){
  const ports=c.config.INTEGRATION_EVENT_PORTS??{},system=(owner,operation,input)=>c.connectionsSystem(owner,{operation,...input===undefined?{}:{input}});
  engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:ports.audit??nullAudit,accountStore:c.metadata,integrationEvents:integrationEventsProvider({enabled:true,ports:()=>{const ports=c.config.INTEGRATION_EVENT_PORTS??{};return {signer:ports.signer,egress:ports.egress,snapshot:ports.snapshot?.available===false?undefined:ports.snapshot,doorbellGrant:ports.doorbellGrant};},issuer:c.config.APP_ORIGIN,signer:ports.signer,egress:ports.egress,snapshot:ports.snapshot?.available===false?undefined:ports.snapshot,limits:ports.limits,doorbellGrant:ports.doorbellGrant/* EV-3 */,
   connections:owner=>({outbox:input=>system(owner,'connections.outbox',input),ack:input=>system(owner,'connections.ack',input),list:()=>system(owner,'connections.list'),health:input=>system(owner,'connections.health',input)})}),
   // EV-3 doorbell hunk: the doorbell provider shares this engine's account store and X6 rows.
   eventDoorbells:eventDoorbellsProvider({enabled:true,keys:()=>busKeys(c.config),enqueue:(tx,event,{now})=>enqueueIntegrationEvent(tx,event,{now,limits:limitsOf(ports.limits)}),cancel:cancelIntegrationDoorbell,subscribed:input=>{const grant=c.config.INTEGRATION_EVENT_PORTS?.doorbellGrant;if(typeof grant!=='function')throw new AppFault('temporarily_unavailable','Feed notifications are unavailable.',503);return grant(input);},issuer:c.config.APP_ORIGIN})}});
  engines.set(c,engine);
 }
 return engine;
}
const doorbellsEnabled=(config,owner)=>ownerFlags(config,owner).background('INTEGRATIONS_ENABLED')&&ownerFlags(config,owner).background('EVENT_BUSES_ENABLED');/* EV-3 */
async function bound(c,owner){return flagsFor(c.config).background('INTEGRATIONS_ENABLED')&&typeof owner==='string'&&UUID.test(owner)&&await c.metadata.get('owner')===owner;}
export const methods={
 /** The account alarm hook: ingest, one bounded delivery pass, then re-arm for the earliest due row. */
 async integrationEventsAlarm(owner){
  if(!await bound(this,owner))return {ready:false};const engine=eventsEngine(this),actor={kind:'system',owner};
  const ingested=await perform(engine,new IngestIntegrationEvents({actor}));if(ingested.ready===false)return {ready:false};
  const rang=doorbellsEnabled(this.config,owner)&&(typeof this.config.INTEGRATION_EVENT_PORTS?.doorbellGrant==='function'||(await this.metadata.list({prefix:'evbus/sub/',limit:1})).size)?await perform(engine,new RingEventDoorbells({actor})):null;/* EV-3 */
  const delivered=await perform(engine,new DeliverIntegrationEvents({actor}));
  // Wargame3 F2: a pending resync (a skipped resume) or a full outbox is retried even once no row is due.
  const retry=ingested.resync||ingested.full?Date.now()+60000:Infinity;
  const next=Math.min(Number.isSafeInteger(delivered.next)?delivered.next:Infinity,Number.isSafeInteger(rang?.next)?rang.next:Infinity,retry);/* EV-3 */
  if(Number.isSafeInteger(next))await this.scheduleAlarm(Math.max(next,Date.now()+1000));
  return {ingested,delivered,...rang?{rang}:{}};
 },
 /** After any commit that enqueued events (X4 transitions, X7/X8 enqueues): wake the alarm now. */
 async integrationEventsKick(owner){if(!await bound(this,owner))return false;await this.scheduleAlarm(Date.now());return true;},
 async integrationEventsMark(owner,input){if(!await bound(this,owner))throw new AppFault('not_found','Not found.',404);const out=await perform(eventsEngine(this),new MarkPreferencesUpdated({actor:{kind:'system',owner},input}));await this.scheduleAlarm(Date.now());return out;},
 async integrationEventsEnqueue(owner,input){if(!await bound(this,owner))throw new AppFault('not_found','Not found.',404);const out=await perform(eventsEngine(this),new EnqueueIntegrationEvent({actor:{kind:'system',owner},input}));await this.scheduleAlarm(Date.now());return out;},
 // ==== EV-3 doorbell hunk (controller methods; internal until account/events.mjs and the owner RPC mount them) ====
 /** The `event-bus/v1` subscribe/unsubscribe handler body: `context` as eventBusResourceMethod verified it, plus the
  * bus `id` it parsed and the actor it built; `epoch` is `grant:<readSince>`. Then kicks the alarm. */
 async eventDoorbellApp(owner,{method,id,actor,resource,epoch}={}){
  if((method!=='unsubscribe'&&(!ownerFlags(this.config,owner,actor?.clientId).enabled('INTEGRATIONS_ENABLED')||!ownerFlags(this.config,owner,actor?.clientId).enabled('EVENT_BUSES_ENABLED')))||!await bound(this,owner))throw new AppFault('not_found','Not found.',404);
  const Operation=Object.hasOwn(EVENT_DOORBELL_APP_OPERATIONS,method)?EVENT_DOORBELL_APP_OPERATIONS[method]:null;if(!Operation)throw new AppFault('unsupported_method','Unsupported feed method.',400);
  const result=await perform(eventsEngine(this),new Operation({actor,id,resource,epoch}));await this.integrationEventsKick(owner);return result;
 },
 /** Revocation, reduction, disconnect and bus-deletion hooks: {id?, clientId?, connection?}. */
 async eventDoorbellCancel(owner,{id,...input}={}){if(!doorbellsEnabled(this.config,owner)||!await bound(this,owner)||!(await this.metadata.list?.({prefix:'evbus/sub/',limit:1}))?.size)return {cancelled:0};return perform(eventsEngine(this),new CancelEventDoorbells({actor:{kind:'system',owner},...id!==undefined?{id}:{},input}));},
 /** Owner: 'events.push' {enabled} or 'events.subscriptions' for bus `id`. */
 async eventDoorbellOwner(owner,{operation,id,input}={}){
  if(!existingFeature(this.config,'INTEGRATIONS_ENABLED',owner)||!existingFeature(this.config,'EVENT_BUSES_ENABLED',owner)||!await bound(this,owner)||!['events.push','events.subscriptions'].includes(operation))throw new AppFault('not_found','Not found.',404);
  if(operation==='events.push'&&input?.enabled===true&&(!ownerFlags(this.config,owner).enabled('INTEGRATIONS_ENABLED')||!ownerFlags(this.config,owner).enabled('EVENT_BUSES_ENABLED')))throw new AppFault('not_found','Not found.',404);
  const actor={kind:'owner',owner};if(operation==='events.subscriptions')return read(eventsEngine(this),new EventBusSubscriptions({actor,id}));const result=await perform(eventsEngine(this),new SetEventBusPush({actor,id,input}));await this.integrationEventsKick(owner);return result;
 },
 // ==== end EV-3 doorbell hunk ====
 async integrationEventsStatus(owner){if(!await bound(this,owner))throw new AppFault('not_found','Not found.',404);return read(eventsEngine(this),new IntegrationEventStatus({actor:{kind:'system',owner}}));},
};
// Internal only: nothing here is reachable through `invoke` until a later slice mounts it.
export const rpc={};
