// Integration events as COSE_Sign1-signed CWTs (docs/architecture/cbor-rpc-spike.md revision 2 §5, phase 5;
// docs/spec/extensions/integrations.md §6.1; docs/spec/cbor.md "COSE profile"). Owner decision 2026-10-28: integration
// events move to CBOR as an untagged COSE_Sign1 (RFC 9052 §4.2) whose payload is a CWT claims set (RFC 8392),
// `Content-Type: application/cwt`. The exact header, claim and verification-order details are provisional (spike §8
// items 2 and 23, unsigned).
//
// Message: [protected, unprotected, payload, signature]
//   protected   = bstr .cbor {1: -7, 4: kid (UTF-8 bytes of the brokering JWK kid), 16: "application/vnd.bindle.integration-event+cwt"}
//   unprotected = {} (empty: nothing may sit outside the signature)
//   payload     = bstr .cbor {1: iss, 2: sub, 3: aud, 6: iat, 7: cti (16 bytes), "events": {type: payload}} (never nil)
//   signature   = 64-byte ECDSA P-256/SHA-256 r ‖ s over Sig_structure ["Signature1", protected, external_aad, payload],
//                 external_aad = UTF-8 "bindle-integration-event-v1"
// Strict rules: alg only from the protected header and exactly -7 with a P-256 key from the issuer's brokering JWKS; keys
// are never taken from the message; `crit`, any other header parameter, tags (18/61), COSE_Sign/COSE_Mac0 shapes and
// detached payloads are refused; the signature is verified over the received protected and payload bytes, never a
// re-encoding. Receivers deduplicate on `cti`, never on signature bytes (signers emit low-S; verifiers accept either).
//
// Pure and runtime-neutral (Workers, browsers, Node): imports only the profile codec. The SDK re-exports the verifier
// (packages/sdk/src/integration-events.mjs). Faults never echo decoded values (spike §6 item 7).
import {encode,decode,CBORFault} from './cbor.mjs';

export const INTEGRATION_EVENT_MEDIA_TYPE='application/cwt';
export const INTEGRATION_EVENT_TYP='application/vnd.bindle.integration-event+cwt';
export const INTEGRATION_EVENT_AAD='bindle-integration-event-v1';
/** Encoded-message bound (spike §5.2, §8 item 23: 64 KiB, provisional). */
export const INTEGRATION_EVENT_MAX_BYTES=65536;
/** Freshness window (integrations §6.1 step 6): 10 minutes back, 30 seconds ahead. */
export const INTEGRATION_EVENT_WINDOW=Object.freeze({pastSeconds:600,futureSeconds:30});
export const COSE_ALG_ES256=-7;
const H_ALG=1,H_CRIT=2,H_KID=4,H_TYP=16,C_ISS=1,C_SUB=2,C_AUD=3,C_IAT=6,C_CTI=7,EVENTS='events';
const CLAIM_LABELS=Object.freeze([C_ISS,C_SUB,C_AUD,C_IAT,C_CTI,EVENTS]);
const utf8=new TextEncoder(),utf8Decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const AAD=utf8.encode(INTEGRATION_EVENT_AAD);
const CONNECTION=/^[A-Za-z0-9._~-]{1,128}$/,CONTROL=/[\u0000-\u001f\u007f]/;

// RFC 8935 §2.4 error codes a receiver may return in a 400 body (here a CBOR map, spike §5.5).
const ERR=Object.freeze({iss:'invalid_issuer',aud:'invalid_audience',signature:'authentication_failed',jwks:'invalid_key',kid:'invalid_key',connection:'invalid_issuer'});
/** A refused integration event: `code` 'invalid_event', `reason` the failed rule, `err` the RFC 8935 error code, status
 * 400 (permanent rejection) — except 413 for an oversize body and 415 for a wrong media type. */
export class IntegrationEventFault extends Error{
 constructor(reason){super('The integration event is invalid.');this.name='IntegrationEventFault';this.code='invalid_event';this.reason=reason;this.err=ERR[reason]??'invalid_request';this.status=reason==='too_large'?413:reason==='media_type'?415:400;}
}
const bad=reason=>{throw new IntegrationEventFault(reason);};
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!CONTROL.test(v);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Uint8Array)&&!ArrayBuffer.isView(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const b64u=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
/** The canonical text form of a 16-byte `cti` (unpadded base64url, 22 characters) for receiver dedupe stores. */
export const ctiId=cti=>{if(!(cti instanceof Uint8Array)||cti.length!==16)throw new TypeError('A cti is 16 bytes.');return b64u(cti);};

/** Checks the `events` claim: exactly one member, event type identifier → payload map with `connection`, `generation`
 * and `seq`. Returns [type, payload] or null. */
function oneEvent(events){
 if(!plain(events))return null;const entries=Object.entries(events);if(entries.length!==1)return null;
 const [type,payload]=entries[0];
 if(!text(type,512)||!plain(payload)||typeof payload.connection!=='string'||!CONNECTION.test(payload.connection)||!Number.isSafeInteger(payload.generation)||payload.generation<0||!Number.isSafeInteger(payload.seq)||payload.seq<1)return null;
 return [type,payload];
}
/** Claim rules shared by the signer and the verifier, so a provider cannot emit what a receiver refuses. Returns the
 * failing reason or null. */
function claimsReason(c){
 if(!text(c.iss,2048))return 'claims';if(!text(c.sub,512))return 'claims';if(!text(c.aud,2048))return 'claims';
 if(!Number.isSafeInteger(c.iat)||c.iat<0)return 'claims';
 if(!(c.cti instanceof Uint8Array)||c.cti.length!==16)return 'cti';
 if(!oneEvent(c.events))return 'events';
 return null;
}

/** The deterministic encoding of RFC 9052 Sig_structure for COSE_Sign1 with this profile's external_aad. */
export function sigStructure(protectedBytes,payloadBytes,aad=AAD){return encode(['Signature1',protectedBytes,aad,payloadBytes]);}

/** Builds and signs one integration event. `claims` = {iss, sub, aud, iat, cti: Uint8Array(16), events: {type: payload}};
 * `kid` = the brokering key's kid; `sign(bytes)` → 64-byte ECDSA P-256/SHA-256 r ‖ s (low-S). Returns the message
 * bytes, or throws IntegrationEventFault 'too_large' when the encoded message exceeds `maxBytes` (never signed oversize). */
export async function signIntegrationEvent({kid,claims,sign,maxBytes=INTEGRATION_EVENT_MAX_BYTES}={}){
 if(typeof sign!=='function'||!text(kid,200)||utf8.encode(kid).length>200)throw new TypeError('An integration event needs a kid and a signer.');
 const protectedBytes=protectedHeader(kid),payload=claimsBytes(claims);
 if(messageSize(protectedBytes.length,payload.length)>maxBytes)bad('too_large');
 const signature=new Uint8Array(await sign(sigStructure(protectedBytes,payload)));if(signature.length!==64)throw new TypeError('ES256 signatures are 64 bytes.');
 return encode([protectedBytes,{},payload,signature]);
}
const protectedHeader=kid=>encode(new Map([[H_ALG,COSE_ALG_ES256],[H_KID,utf8.encode(kid)],[H_TYP,INTEGRATION_EVENT_TYP]]),{cose:true});
function claimsBytes(claims){
 if(!plain(claims)||Object.keys(claims).length!==6)bad('claims');const reason=claimsReason(claims);if(reason)bad(reason);
 try{return encode(new Map([[C_ISS,claims.iss],[C_SUB,claims.sub],[C_AUD,claims.aud],[C_IAT,claims.iat],[C_CTI,claims.cti],[EVENTS,claims.events]]),{cose:true});}catch(error){if(error instanceof CBORFault)bad('events');throw error;}
}
const headSize=n=>n<24?1:n<256?2:n<65536?3:n<4294967296?5:9;
// array(4) ‖ bstr(protected) ‖ {} ‖ bstr(payload) ‖ bstr(64-byte signature)
const messageSize=(p,c)=>1+headSize(p)+p+1+headSize(c)+c+2+64;
/** The exact encoded size of the message these claims would produce under a kid of `kid` (default: the longest kid
 * allowed, an upper bound), so a sender can refuse an oversize event before asking a signer. Throws on invalid claims. */
export function integrationEventSize(claims,kid='k'.repeat(200)){return messageSize(protectedHeader(kid).length,claimsBytes(claims).length);}

// Minimal head reader for the outer structure, so each strict rule refuses with its own reason before the full strict
// decode (which also refuses non-shortest heads and trailing bytes).
function head(b,p){
 if(p>=b.length)bad('malformed');const ib=b[p],major=ib>>5,ai=ib&31;if(ai<24)return [major,ai,p+1];
 const n=ai===24?1:ai===25?2:ai===26?4:ai===27?8:0;if(!n||p+1+n>b.length)bad('malformed');
 let v=0;for(let i=0;i<n;i++)v=v*256+b[p+1+i];if(!Number.isSafeInteger(v))bad('malformed');return [major,v,p+1+n];
}

/** Strict, unverified structural parse (spike §5.4 steps 1–3, without the media type): returns {kid, protectedBytes,
 * payloadBytes, signature, claims, type, payload}. Nothing returned is trustworthy until the signature verifies; claims
 * are read first only to find the connection (strict decoding bounds that work). */
export function parseIntegrationEvent(bytes,{maxBytes=INTEGRATION_EVENT_MAX_BYTES}={}){
 if(!(bytes instanceof Uint8Array))bad('malformed');if(bytes.length>maxBytes)bad('too_large');if(!bytes.length)bad('malformed');
 let [major,n,p]=head(bytes,0);
 if(major===6)bad('tagged');// tag 18 (COSE_Sign1), 61 (CWT) or anything else: the message is untagged
 if(major!==4||n!==4)bad('structure');// COSE_Sign (4 elements with an array of signatures) fails below; COSE_Mac0 has no 64-byte signature
 [major,n,p]=head(bytes,p);if(major!==2)bad('protected');p+=n;
 if(p>=bytes.length)bad('malformed');if(bytes[p]!==0xa0)bad(bytes[p]>>5===5?'unprotected':'structure');p++;
 if(p>=bytes.length)bad('malformed');if(bytes[p]===0xf6)bad('detached');[major,n,p]=head(bytes,p);if(major!==2)bad('structure');p+=n;
 if(p>=bytes.length)bad('malformed');if(bytes[p]>>5!==2)bad('structure');// a COSE_Sign signatures array, or any non-bstr signature
 let outer;try{outer=decode(bytes,{top:'any',maxBytes,maxDepth:2});}catch(error){if(error instanceof CBORFault)bad('malformed');throw error;}
 const [protectedBytes,unprotected,payloadBytes,signature]=outer;
 if(!plain(unprotected)||Object.keys(unprotected).length)bad('unprotected');
 if(!(signature instanceof Uint8Array))bad('structure');if(signature.length!==64)bad('signature');
 let header;try{header=decode(protectedBytes,{cose:true,maxDepth:2});}catch(error){if(error instanceof CBORFault)bad('protected');throw error;}
 if(header.has(H_CRIT))bad('crit');
 if(header.get(H_ALG)!==COSE_ALG_ES256)bad('alg');
 if(header.size!==3||!header.has(H_KID)||!header.has(H_TYP))bad('header');// x5chain, x5t, COSE_Key, counter signatures, IV, …
 if(header.get(H_TYP)!==INTEGRATION_EVENT_TYP)bad('typ');
 const kidBytes=header.get(H_KID);if(!(kidBytes instanceof Uint8Array)||!kidBytes.length||kidBytes.length>200)bad('kid');
 let kid;try{kid=utf8Decoder.decode(kidBytes);}catch{bad('kid');}if(!text(kid,200))bad('kid');
 let map;try{map=decode(payloadBytes,{cose:true,objects:'plain',maxBytes});}catch(error){if(error instanceof CBORFault)bad('claims');throw error;}
 if(map.size!==CLAIM_LABELS.length||!CLAIM_LABELS.every(k=>map.has(k)))bad('claims');
 const claims={iss:map.get(C_ISS),sub:map.get(C_SUB),aud:map.get(C_AUD),iat:map.get(C_IAT),cti:map.get(C_CTI),events:map.get(EVENTS)};
 const reason=claimsReason(claims);if(reason)bad(reason);
 const [type,payload]=oneEvent(claims.events);
 return {kid,protectedBytes,payloadBytes,signature,claims,type,payload};
}

const mediaType=value=>typeof value==='string'?value.split(';')[0].trim().toLowerCase():'';
const B64U43=/^[A-Za-z0-9_-]{43}$/;
/** Verifies one received integration event in the spike §5.4 / integrations §6.1 order:
 *  1. `contentType` is application/cwt and the body within `maxBytes`; strict outer decode;
 *  2. protected header exactly {1:-7, 4:kid, 16:typ}, unprotected {}, 64-byte signature;
 *  3. strict claims decode (exactly iss, sub, aud, iat, cti, events with one event);
 *  4. `connection({iss, connection, claims})` knows the connection (reject an unknown one before any key is consulted);
 *  5. the signature verifies with the single P-256 JWK whose kid matches, from `keys` (a JWKS object, or
 *     `async kid => jwks` applying the caller's cache rules), over the received protected and payload bytes;
 *  6. `aud` equals `audience`, `sub` equals `subject` (or the `subject` the connection lookup returned), and `iat` lies
 *     within 10 minutes back and 30 seconds ahead.
 * Returns {kid, claims, cti, ctiId, type, payload, record}. Deduplication by `cti` and `seq` ordering are the receiver's.
 * Throws IntegrationEventFault with `reason` (and `err`, the RFC 8935 code for a 400 body); TypeError on misuse. */
export async function verifyIntegrationEvent(bytes,{contentType,keys,issuer,audience,connection,subject,kid:kidTest,now=Date.now(),crypto=globalThis.crypto,maxBytes=INTEGRATION_EVENT_MAX_BYTES}={}){
 if(typeof connection!=='function'||typeof issuer!=='string'||typeof audience!=='string'||subject!==undefined&&typeof subject!=='string'||kidTest!==undefined&&typeof kidTest!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>INTEGRATION_EVENT_MAX_BYTES)throw new TypeError('Integration event verification needs issuer, audience and a connection lookup.');
 if(mediaType(contentType)!==INTEGRATION_EVENT_MEDIA_TYPE)bad('media_type');
 const parsed=parseIntegrationEvent(bytes,{maxBytes}),{kid,claims,payload}=parsed;
 if(kidTest&&!kidTest(kid))bad('kid');
 if(claims.iss!==issuer)bad('iss');
 const record=await connection({iss:claims.iss,connection:payload.connection,claims});if(!record)bad('connection');
 const set=typeof keys==='function'?await keys(kid):keys;if(!plain(set)||!Array.isArray(set.keys)||set.keys.length>64)bad('jwks');
 const matches=set.keys.filter(k=>k?.kid===kid);if(matches.length!==1)bad('kid');const jwk=matches[0];
 if(!plain(jwk)||jwk.kty!=='EC'||jwk.crv!=='P-256'||jwk.alg!==undefined&&jwk.alg!=='ES256'||jwk.use!==undefined&&jwk.use!=='sig'||jwk.d!==undefined||!B64U43.test(jwk.x??'')||!B64U43.test(jwk.y??''))bad('jwks');
 let key;try{key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch{bad('jwks');}
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,parsed.signature,sigStructure(parsed.protectedBytes,parsed.payloadBytes)))bad('signature');
 if(claims.aud!==audience)bad('aud');
 const expected=subject??(typeof record?.subject==='string'?record.subject:undefined);if(expected===undefined||claims.sub!==expected)bad('sub');
 const seconds=Math.floor(now/1000);if(claims.iat>seconds+INTEGRATION_EVENT_WINDOW.futureSeconds||claims.iat<seconds-INTEGRATION_EVENT_WINDOW.pastSeconds)bad('iat');
 return {kid,claims,cti:claims.cti,ctiId:ctiId(claims.cti),type:parsed.type,payload,record};
}

/** A receiver's optional 400 body (spike §5.5): CBOR {"err": code, "description": text}, `Content-Type:
 * application/cbor`. The description is fixed text, never a decoded value. */
export function integrationEventRejection(error){
 const err=error instanceof IntegrationEventFault?error.err:'invalid_request';
 return encode({err,description:'The integration event was rejected.'});
}
/** Reads the error code a receiver returned in a 400 body (provider side; at most the code is kept for audit). */
export function rejectionCode(bytes){
 try{const doc=decode(bytes,{maxBytes:4096,maxDepth:2});return typeof doc.err==='string'&&/^[a-z0-9_]{1,64}$/.test(doc.err)?doc.err:null;}catch{return null;}
}
