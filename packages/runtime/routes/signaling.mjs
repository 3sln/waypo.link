// The provider-to-provider endpoint of the signaling extension, `POST /bindle/signaling` (docs/spec/extensions/
// signaling.md §9.1, §9.2; renamed from routes/rtc.mjs, Appendix C.2: same logic, new path, media type and limiter scope).
// Provisional (coordinator), not signed off by the user. A thin adapter: it never runs §9.2 steps 2–8. It finds the
// addressed local entity from the batch's `aud`, hands the raw body to that entity's writer as the system step
// `signaling.ingest` (step 1 and the bounded inbound queue), and answers:
//   202  empty, for every batch that passes step 1, whatever steps 2–8 later decide;
//   400  {error:'signaling_batch_invalid'} for a batch failing step 1, naming more than one `aud` (AMD-RI2), or with any
//        element whose `iss` is this host (AMD-RW2: same-host traffic travels only through the internal path);
//   404  the uniform unknown answer while SIGNALING_FOREIGN_ENABLED is off site-wide or SIGNALING_FOREIGN_ISSUERS is
//        empty, and for an `aud` that names no active entity here (AMD-RI1; public through the identity document).
//        Never for the addressed entity's own signaling flags (RTCw-R1);
//   429  per source network before step 1 (never by claimed issuer, §9.2 "Load");
//   503  a full inbound queue, which the sender retries.
// The addressed entity's own flags never change the answer: a step-1-valid batch for a flag-off entity is queued `dark`
// (same queue bound, removed unprocessed). The drain-rate residual (§9.2) is recorded, not closed.
import {json,accountHandle,flagEnabled,flagGlobal,admitSourceNetwork} from './shared.mjs';
import {lookupUnknown} from '../public-unknown.mjs';
import {foreignIssuers} from '../account/foreign-directory.mjs';
import {parseBatch,batchStep1,BATCH_MEDIA_TYPE,LIMITS} from '../../signaling/messages.mjs';
import {parseLegCertificate,parseControl} from '../../signaling/certificates.mjs';
import {SIGNALING_ENDPOINT_PATH} from '../../signaling/extension.mjs';

export {SIGNALING_ENDPOINT_PATH};
/** Per source network (IPv4 /24, IPv6 /48) per minute, before step 1. Provisional (RTC-11 has no value for it). */
export const SIGNALING_INBOUND_PER_NETWORK=600;
const noStore={'Cache-Control':'no-store',Pragma:'no-cache'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unknown=request=>{const response=json({error:'not_found'},404,noStore);return request?.method==='HEAD'?new Response(null,{status:404,headers:response.headers}):response;};
const invalid=()=>json({error:'signaling_batch_invalid'},400,noStore);
// While SIGNALING_FOREIGN_ISSUERS is empty this host talks to no other provider at all, so the endpoint answers the
// uniform 404 (and the manifest withholds the signaling declaration, packages/runtime/federation.mjs).
const on=(env,owner)=>owner?['SIGNALING_FOREIGN_ENABLED','SIGNALING_ENABLED','SESSION_KINDS_ENABLED'].every(name=>flagEnabled(env,name,{subject:{kind:'account',owner}},true)):flagGlobal(env,'SIGNALING_FOREIGN_ENABLED')&&flagGlobal(env,'SIGNALING_ENABLED')&&flagGlobal(env,'SESSION_KINDS_ENABLED')&&foreignIssuers(env,'SIGNALING_FOREIGN_ISSUERS').length>0;

async function boundedText(request,max){
 const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}
/** Per-network budget (fails closed off loopback without an abuse store, as the relation endpoints do). Review F5: the
 * shared helper refines the network by `CF-Worker` under a network ceiling; its pseudonymous `source` rides with the
 * batch so the writer's key roster can cap plain claims per source network (review F1). */
const admit=(env,request,local)=>admitSourceNetwork(env,request,local,'signaling/inbound',SIGNALING_INBOUND_PER_NETWORK);
const payloadOf=compact=>{try{const part=String(compact).split('.')[1];return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4)),c=>c.charCodeAt(0))));}catch{return null;}};
/** The one `aud` every element names, or null (a step-1 failure: no fetch, no verification); also null when any
 * element's `iss` is this host's origin `self` (AMD-RW2: same-host traffic never comes through this endpoint). */
function audienceOf(batch,self){
 const auds=new Set();for(const compact of [...batch.certificates,...batch.messages,...batch.controls]){const payload=payloadOf(compact),aud=payload?.aud;if(typeof aud!=='string'||payload.iss===self)return null;auds.add(aud);}
 return auds.size===1?[...auds][0]:null;
}
/** The local entity an identity URI names (`<APP_ORIGIN>/identity/<uuid>`), else undefined for an `aud` on another
 * origin (refused at step 1) and null for one on this origin that names nothing. */
function localEntity(env,aud){
 let u;try{u=new URL(aud);}catch{return undefined;}if(u.origin!==env.APP_ORIGIN)return undefined;
 const prefix=`${env.APP_ORIGIN}/identity/`;if(!aud.startsWith(prefix))return null;const id=aud.slice(prefix.length);return UUID.test(id)?id:null;
}
async function activeEntity(env,id){if(!id)return false;try{const a=await env.IDENTITY_REPOSITORY?.get(id);return a?.status==='active';}catch{return false;}}

/** §9.2 step 1 exactly as the writer's `signaling.ingest` runs it (no fetch, no per-account state). `env.SIGNALING_CLOCK`
 * ({now() -> ms}) is a test clock only; production uses the system clock, as the writer does. */
async function step1Valid(env,batch){
 const now=typeof env.SIGNALING_CLOCK?.now==='function'?env.SIGNALING_CLOCK.now():Date.now();
 try{await batchStep1(batch,{issuer:env.APP_ORIGIN,now:Math.floor(now/1000),parseCertificate:parseLegCertificate,parseControl,allowLoopback:env.LOCAL_DEVELOPMENT==='true'});return true;}catch{return false;}
}

export async function signalingEndpoint({request,env,local}){
 if(!on(env))return unknown(request);
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{...noStore,Allow:'POST'});
 const admitted=await admit(env,request,local);if(!admitted.ok)return json({error:'rate_limited'},429,{...noStore,'Retry-After':'60'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==BATCH_MEDIA_TYPE)return invalid();
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMITS.batchBytes))return invalid();
 const text=await boundedText(request,LIMITS.batchBytes);if(text===null)return invalid();
 let batch;try{batch=parseBatch(text);}catch{return invalid();}
 const aud=audienceOf(batch,env.APP_ORIGIN);if(!aud)return invalid();
 const owner=localEntity(env,aud);if(owner===undefined)return invalid();
 if(!owner||!await activeEntity(env,owner))return unknown(request);
 if(!await step1Valid(env,batch))return invalid();
 // RTCw-L3 and RTCw-R1: the addressed entity's own flags never change the answer. A flag-off entity's writer queues the
 // batch `dark` (same queue bound, removed unprocessed), so 202 and 503 arise alike.
 const dark=!on(env,owner);
 try{await accountHandle(env,owner).signalingPeer(owner,{operation:'signaling.ingest',input:{batch:text,...admitted.source?{source:admitted.source}:{},...dark?{dark:true}:{}}});return new Response(null,{status:202,headers:noStore});}
 catch(error){
  if(error?.code==='signaling_batch_invalid')return invalid();
  if(lookupUnknown(error))return unknown(request);
  return json({error:'temporarily_unavailable'},503,{...noStore,'Retry-After':'1'});
 }
}

export const stages={async public(ctx){if(ctx.path===SIGNALING_ENDPOINT_PATH)return signalingEndpoint(ctx);}};
