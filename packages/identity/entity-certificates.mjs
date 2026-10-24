// ORG-10d entity certificates: the codec and issuance signing (docs/spec/organizations.md §9.5, §10, §12 item 4;
// design §8b.3, §8b.10, RL-16; parallel to member-certificates.mjs). Provisional (coordinator), not signed off by the user.
//
// An entity certificate lets a grantee organization's member or application act on ONE imported resource at the
// grantor. It is a compact JWS whose header is exactly {alg:'ES256', kid, typ:'bindle-entity-certificate+jwt'}, signed
// with the ACTING entity's active certification key (never its identity signing key), and whose payload is exactly, in
// this order,
//   {bindle:'entity-certificate', v:1, iss, sub, identity, aud, instance, purposes, client:{client_id, origin},
//    actor:{member?, client?}, resource, methods, scope?, aep, cnf:{jkt}, delegate, jti, iat, exp}
// `scope` is present only when the edge grant carries a resource scope (spec §9.5 "`methods` … and optionally `scope`").
// The typ differs from member certificates, delegations, statements, relation events and intents.
//
// Rules here (the evaluation itself lives in packages/orgs/relation-access.mjs, which owns the records):
//   - lifetime: 300 s on 3sln.me (RL-16), never longer; a shorter request is honoured;
//   - `methods` is a nonempty contract → sorted unique methods map, already intersected by the caller with every hop
//     (member grant ∩ application connection ∩ edge grant ∩ the grantor's resource);
//   - `actor.member` is a pairwise identifier per (acting organization, counterpart, membership) unless the edge entry
//     says `actor_disclosure:"named"`, when it is the member's {iss, sub} (spec §6.1, §12 item 4);
//   - `cnf.jkt` is the RFC 7638 thumbprint of `delegate`, the holder key (the application's session key in relay mode,
//     or the provider gateway's key in proxy mode).
import {base64url,fromBase64url,textEncoder,digest} from '../core/records.mjs';
import {strictJSON} from '../links/envelope.mjs';
import {delegatePublicJwk,jwkThumbprint,originValid,isJkt} from './delegation.mjs';
import {memberURL} from './member-certificates.mjs';

export const ENTITY_CERTIFICATE_TYP='bindle-entity-certificate+jwt';
export const ENTITY_PURPOSE='https://spec.bindle.example/purposes/relation-access/v1';
/** RL-16: 300 s on 3sln.me (members stay at 660 s). Verifiers cap the effective lifetime at the same value. */
export const ENTITY_CERTIFICATE_SECONDS=300,ENTITY_CERTIFICATE_MIN_SECONDS=30,ENTITY_CERTIFICATE_MAX_BYTES=8192;
/** Write-capable methods need `now − iat` ≤ 60 s, and an `iat` more than 30 s ahead is invalid for them (spec §9.5). */
export const ENTITY_WRITE_AGE_SECONDS=60,ENTITY_WRITE_FUTURE_SECONDS=30,ENTITY_SKEW_SECONDS=60;
const MEMBERS=['bindle','v','iss','sub','identity','aud','instance','purposes','client','actor','resource','methods','scope','aep','cnf','delegate','jti','iat','exp'];
const REQUIRED=MEMBERS.filter(m=>m!=='scope');
const ES256={name:'ECDSA',hash:'SHA-256'},P256={name:'ECDSA',namedCurve:'P-256'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,JTI=/^[A-Za-z0-9_-]{16,128}$/,B64=/^[A-Za-z0-9_-]+$/,KID=/^[\x21-\x7e]{1,128}$/,METHOD=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exactly=(v,names,optional=[])=>plain(v)&&names.every(n=>Object.hasOwn(v,n))&&Object.keys(v).every(n=>names.includes(n)||optional.includes(n));
const nonNegative=v=>Number.isSafeInteger(v)&&v>=0;
const CLIENT_ID=v=>typeof v==='string'&&v.length>0&&v.length<=2048&&v.isWellFormed()&&!/[\p{Cc}\p{Bidi_Control}\u2028\u2029\u200b\ufeff]/u.test(v);

/** A contract → methods map: ≤ 32 contracts, each a nonempty, sorted, unique list of method names. */
export function methodsValid(value){
 if(!plain(value)||!Object.keys(value).length||Object.keys(value).length>32)return false;
 for(const [c,ms] of Object.entries(value)){if(typeof c!=='string'||!c||c.length>2048||!Array.isArray(ms)||!ms.length||ms.length>32||ms.some((m,i)=>typeof m!=='string'||!METHOD.test(m)||(i>0&&ms[i-1]>=m)))return false;}
 return true;
}
/** A relation resource scope (resource scoping, design §8b.2 step 3): {prefix?, readOnly?:true, maxObjectBytes?}. */
export function scopeValid(value){
 if(!plain(value)||!Object.keys(value).length||Object.keys(value).some(k=>!['prefix','readOnly','maxObjectBytes'].includes(k)))return false;
 if(value.prefix!==undefined&&(typeof value.prefix!=='string'||!value.prefix||value.prefix.length>512||value.prefix.startsWith('/')||value.prefix.endsWith('/')||value.prefix.split('/').some(s=>!s||s==='.'||s==='..')||/[\u0000-\u001f\u007f\\]/.test(value.prefix)))return false;
 if(value.readOnly!==undefined&&value.readOnly!==true)return false;
 if(value.maxObjectBytes!==undefined&&(!Number.isSafeInteger(value.maxObjectBytes)||value.maxObjectBytes<1))return false;
 return true;
}
const actorValid=a=>exactly(a,[],['member','client'])&&(a.member===undefined||typeof a.member==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(a.member)||exactly(a.member,['iss','sub'])&&originValid(a.member.iss,true)&&typeof a.member.sub==='string'&&UUID.test(a.member.sub))&&(a.client===undefined||CLIENT_ID(a.client));

function segment(value){if(typeof value!=='string'||!value||!B64.test(value))throw new TypeError('segment');const bytes=fromBase64url(value);if(base64url(bytes)!==value)throw new TypeError('segment');return bytes;}
function json(value){const parsed=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(segment(value)));if(!plain(parsed))throw new TypeError('json');return parsed;}

/** Strict syntax of an entity certificate. Returns {header, payload, input, signature} or null (never throws). No
 * signature check here. */
export function parseEntityCertificate(compact,{allowLoopback=false}={}){
 try{
  if(typeof compact!=='string'||compact.length>ENTITY_CERTIFICATE_MAX_BYTES)return null;
  const parts=compact.split('.');if(parts.length!==3)return null;
  const header=json(parts[0]),payload=json(parts[1]),signature=segment(parts[2]);
  if(!exactly(header,['alg','kid','typ'])||header.alg!=='ES256'||header.typ!==ENTITY_CERTIFICATE_TYP||typeof header.kid!=='string'||!KID.test(header.kid)||signature.length!==64)return null;
  if(!exactly(payload,REQUIRED,['scope'])||payload.bindle!=='entity-certificate'||payload.v!==1)return null;
  const p=payload;
  if(!originValid(p.iss,allowLoopback)||typeof p.sub!=='string'||!UUID.test(p.sub))return null;
  const identity=memberURL(p.identity,allowLoopback);if(!identity||identity.origin!==p.iss||!memberURL(p.aud,allowLoopback)||!memberURL(p.instance,allowLoopback))return null;
  if(!Array.isArray(p.purposes)||p.purposes.length!==1||p.purposes[0]!==ENTITY_PURPOSE)return null;
  if(!exactly(p.client,['client_id','origin'])||!CLIENT_ID(p.client.client_id)||!originValid(p.client.origin,allowLoopback)||!actorValid(p.actor))return null;
  if(typeof p.resource!=='string'||!p.resource||p.resource.length>2048||!methodsValid(p.methods)||(p.scope!==undefined&&!scopeValid(p.scope)))return null;
  if(!nonNegative(p.aep)||!exactly(p.cnf,['jkt'])||!isJkt(p.cnf.jkt)||!exactly(p.delegate,['kty','crv','x','y'])||typeof p.jti!=='string'||!JTI.test(p.jti)||!nonNegative(p.iat)||!nonNegative(p.exp)||p.iat>=p.exp)return null;
  return {header,payload,input:textEncoder.encode(`${parts[0]}.${parts[1]}`),signature};
 }catch{return null;}
}
/** The holder key: the delegate JWK, only when its RFC 7638 thumbprint equals `cnf.jkt`. */
export async function entityHolderKey(payload,crypto=globalThis.crypto){const d=await delegatePublicJwk(payload?.delegate,crypto);return d&&await jwkThumbprint(d.jwk,crypto)===payload.cnf?.jkt?d:null;}
/** ES256 signature of a parsed certificate under a P-256 public JWK. Never throws. */
export async function verifyEntitySignature(parsed,publicJwk,crypto=globalThis.crypto){try{const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:publicJwk.x,y:publicJwk.y},P256,false,['verify']);return await crypto.subtle.verify(ES256,key,parsed.signature,parsed.input);}catch{return false;}}
/** Encodes claims in the profile's member order (`scope` only when present). */
export async function encodeEntityCertificate(claims,{kid,privateKey},crypto=globalThis.crypto){
 if(!exactly(claims,REQUIRED,['scope']))throw new TypeError('Entity certificate claims must have exactly the profile members.');
 const ordered=Object.fromEntries(MEMBERS.filter(n=>Object.hasOwn(claims,n)).map(n=>[n,claims[n]])),encode=v=>base64url(textEncoder.encode(JSON.stringify(v)));
 const head=`${encode({alg:'ES256',kid,typ:ENTITY_CERTIFICATE_TYP})}.${encode(ordered)}`;
 return `${head}.${base64url(new Uint8Array(await crypto.subtle.sign(ES256,privateKey,textEncoder.encode(head))))}`;
}
/** The pairwise actor identifier of a membership towards one counterpart (spec §6.1 `pairwise`). Stable per
 * (acting organization, counterpart origin principal, membership id); never the member's identity. */
export async function pairwiseActor({org,counterpart,membershipId},crypto=globalThis.crypto){return 'pw_'+(await digest(crypto,JSON.stringify(['bindle-relation-actor-v1',org.iss,org.sub,counterpart.iss,counterpart.sub,membershipId]))).slice(0,40);}

/**
 * Signs one certificate after the caller's own evaluation. `input`: {issuer, org (uuid), identity, aud, instance,
 * client:{client_id, origin}, actor, resource, methods, scope?, aep, delegate (P-256 public JWK), lifetime?, now (ms),
 * jti?}. `signer`: {kid, privateKey} (the organization's certification key). Returns {certificate, jkt, jti, iat, exp}.
 * Throws TypeError on input the caller should never produce.
 */
export async function signEntityCertificate(input,signer,crypto=globalThis.crypto){
 const delegate=await delegatePublicJwk(input.delegate,crypto);if(!delegate)throw new TypeError('A P-256 holder key is required.');
 if(!methodsValid(input.methods)||(input.scope!==undefined&&!scopeValid(input.scope))||!actorValid(input.actor)||!nonNegative(input.aep))throw new TypeError('Invalid entity certificate evaluation.');
 const lifetime=Math.min(ENTITY_CERTIFICATE_SECONDS,Number.isSafeInteger(input.lifetime)&&input.lifetime>=ENTITY_CERTIFICATE_MIN_SECONDS?input.lifetime:ENTITY_CERTIFICATE_SECONDS);
 const jkt=await jwkThumbprint(delegate.jwk,crypto),iat=Math.floor(input.now/1000),jti=input.jti??base64url(crypto.getRandomValues(new Uint8Array(24)));
 const claims={bindle:'entity-certificate',v:1,iss:input.issuer,sub:input.org,identity:input.identity,aud:input.aud,instance:input.instance,purposes:[ENTITY_PURPOSE],client:{client_id:input.client.client_id,origin:input.client.origin},actor:structuredClone(input.actor),resource:input.resource,methods:structuredClone(input.methods),...input.scope?{scope:structuredClone(input.scope)}:{},aep:input.aep,cnf:{jkt},delegate:delegate.jwk,jti,iat,exp:iat+lifetime};
 return {certificate:await encodeEntityCertificate(claims,signer,crypto),jkt,jti,iat,exp:claims.exp};
}
