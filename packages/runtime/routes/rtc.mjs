// RTC-e: the provider-to-provider endpoint of the rtc-signaling.v1 feature, `POST /bindle/rtc` (docs/spec/rtc-signaling.md
// §8.1, §8.2; design docs/architecture/rtc-signaling.md §3.1, §8.1 RTC-e). Provisional (coordinator), not signed off by
// the user. A thin adapter: it never runs §8.2 steps 2–8. It finds the addressed local entity from the batch's `aud`,
// hands the raw body to that entity's writer as the system step `rtc.ingest` (step 1 and the bounded inbound queue,
// packages/runtime/account/rtc.mjs `rtcPeer`), and answers:
//   202  empty, for every batch that passes step 1, whatever steps 2–8 later decide (they run on the writer's detached
//        task or alarm, never here);
//   400  {error:'rtc_batch_invalid'} for a batch failing step 1 (shape, size, JWS profiles, `aud` origin, `iat`), or
//        whose elements name more than one `aud` (spec §8.1: a batch is between two entities; reading RTCe-3);
//   404  the uniform unknown answer (packages/runtime/public-unknown.mjs) while RTC_FOREIGN_ENABLED is off (site-wide
//        or for the addressed entity) or RTC_FOREIGN_ISSUERS is empty (review F7), and for an `aud` that names no active entity here: an identity's existence and
//        lifecycle are public through its identity document, so this reveals nothing steps 2–8 decide (reading RTCe-4);
//   429  per source network before step 1 (spec §8.2 allows shedding by source network, never by claimed issuer);
//   503  a full inbound queue (RTCd-22), which the sender retries.
// No CORS and no authentication: the spec defines a server-to-server endpoint whose elements are end-to-end signed.
import {json,accountHandle,flagEnabled,flagGlobal,admitSourceNetwork} from './shared.mjs';
import {lookupUnknown} from '../public-unknown.mjs';
import {foreignIssuers} from '../account/foreign-directory.mjs';
import {parseBatch,RTC_BATCH_MEDIA_TYPE,RTC_LIMITS} from '../../rtc/messages.mjs';

export const RTC_ENDPOINT_PATH='/bindle/rtc';
/** Per source network (IPv4 /24, IPv6 /48) per minute, before step 1. Provisional (RTC-11 has no value for it). */
export const RTC_INBOUND_PER_NETWORK=600;
const noStore={'Cache-Control':'no-store',Pragma:'no-cache'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unknown=request=>{const response=json({error:'not_found'},404,noStore);return request?.method==='HEAD'?new Response(null,{status:404,headers:response.headers}):response;};
const invalid=()=>json({error:'rtc_batch_invalid'},400,noStore);
// Review F7: while RTC_FOREIGN_ISSUERS is empty this host talks to no other provider at all, so the endpoint answers the
// uniform 404 (and the manifest withholds rtc-signaling.v1, packages/runtime/federation.mjs).
const on=(env,owner)=>owner?flagEnabled(env,'RTC_FOREIGN_ENABLED',{subject:{kind:'account',owner}},true)&&flagEnabled(env,'RTC_SIGNALING_ENABLED',{subject:{kind:'account',owner}},true):flagGlobal(env,'RTC_FOREIGN_ENABLED')&&flagGlobal(env,'RTC_SIGNALING_ENABLED')&&foreignIssuers(env,'RTC_FOREIGN_ISSUERS').length>0;

async function boundedText(request,max){
 const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}
/** Per-network budget (fails closed off loopback without an abuse store, as the relation endpoints do). Review F5: the
 * shared helper refines the network by `CF-Worker` under a network ceiling; its pseudonymous `source` rides with the
 * batch so the writer's key roster can cap plain claims per source network (review F1). */
const admit=(env,request,local)=>admitSourceNetwork(env,request,local,'rtc/inbound',RTC_INBOUND_PER_NETWORK);
const payloadOf=compact=>{try{const part=String(compact).split('.')[1];return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4)),c=>c.charCodeAt(0))));}catch{return null;}};
/** The one `aud` every element names, or null (a step-1 failure: no fetch, no verification). */
function audienceOf(batch){
 const auds=new Set();for(const compact of [...batch.certificates,...batch.messages,...batch.controls]){const aud=payloadOf(compact)?.aud;if(typeof aud!=='string')return null;auds.add(aud);}
 return auds.size===1?[...auds][0]:null;
}
/** The local entity an identity URI names (`<APP_ORIGIN>/identity/<uuid>`), else undefined for an `aud` on another
 * origin (refused at step 1) and null for one on this origin that names nothing. */
function localEntity(env,aud){
 let u;try{u=new URL(aud);}catch{return undefined;}if(u.origin!==env.APP_ORIGIN)return undefined;
 const prefix=`${env.APP_ORIGIN}/identity/`;if(!aud.startsWith(prefix))return null;const id=aud.slice(prefix.length);return UUID.test(id)?id:null;
}
async function activeEntity(env,id){if(!id)return false;try{const a=await env.IDENTITY_REPOSITORY?.get(id);return a?.status==='active';}catch{return false;}}

export async function rtcEndpoint({request,env,local}){
 if(!on(env))return unknown(request);
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{...noStore,Allow:'POST'});
 const admitted=await admit(env,request,local);if(!admitted.ok)return json({error:'rate_limited'},429,{...noStore,'Retry-After':'60'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==RTC_BATCH_MEDIA_TYPE)return invalid();
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>RTC_LIMITS.batchBytes))return invalid();
 const text=await boundedText(request,RTC_LIMITS.batchBytes);if(text===null)return invalid();
 let batch;try{batch=parseBatch(text);}catch{return invalid();}
 const aud=audienceOf(batch);if(!aud)return invalid();
 const owner=localEntity(env,aud);if(owner===undefined)return invalid();
 if(!owner||!on(env,owner)||!await activeEntity(env,owner))return unknown(request);
 try{await accountHandle(env,owner).rtcPeer(owner,{operation:'rtc.ingest',input:{batch:text,...admitted.source?{source:admitted.source}:{}}});return new Response(null,{status:202,headers:noStore});}
 catch(error){
  if(error?.code==='rtc_batch_invalid')return invalid();
  if(lookupUnknown(error))return unknown(request);
  return json({error:'temporarily_unavailable'},503,{...noStore,'Retry-After':'1'});
 }
}

export const stages={async public(ctx){if(ctx.path===RTC_ENDPOINT_PATH)return rtcEndpoint(ctx);}};
