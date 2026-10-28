// The core signed-object compact JWS profile as signaling.v1 uses it (docs/spec/extensions/signaling.md §6.1, §6.3,
// §7.1; keys.md §3). Pure functions, no I/O. Provisional (coordinator), not signed off by the user.
// Signaling rev 3.2, Appendix C.1 jws.mjs: the `typ` list stays here; strict JSON comes from packages/core/strict-json.mjs
// and compact JWS parse, sign and verify from packages/core/signed-object.mjs (contacts spike CR-C0), never from
// packages/links or packages/orgs.
//
// Every signaling JWS is ES256 with a protected header of exactly {alg, kid, typ}. The `typ` separates the three profiles
// (message, leg certificate, control statement) from each other and from every other Bindle profile, so a parser for
// one never accepts another. Segments must be canonical unpadded base64url, JSON must be strict I-JSON (duplicate
// members, lone surrogates, -0, unsafe integers and nesting deeper than 8 are refused), and the signature input is the
// received bytes, never a re-serialization. The ES256 signature must be low-S (s <= n/2; review L3, provisional): a
// high-S twin of a valid signature verifies under WebCrypto, so without this a relayer could mint a second, distinct
// compact form of the same message. Signing here always normalizes to low-S.
import {SignedObjectFault,lowS,segmentBytes as coreSegmentBytes,parseCompactJWS,verifyCompactJWS,signCompactJWS} from '../core/signed-object.mjs';

/** §6.1, §6.2, §7.1: the three profiles' `typ` values (AMD-SG-K1 registers them). */
export const MESSAGE_TYP='bindle-signaling-message+jwt',LEG_CERTIFICATE_TYP='bindle-signaling-leg+jwt',CONTROL_TYP='bindle-signaling-control+jwt';
export class SignalingWireFault extends Error {constructor(code='signaling_invalid',message=code){super(message);this.name='SignalingWireFault';this.code=code;}}
export const fail=(code='signaling_invalid',message)=>{throw new SignalingWireFault(code,message);};
const KID=/^[^\u0000-\u001f\u007f]{1,200}$/u;
/** True when a 64-byte r||s ES256 signature has s in [1, n/2] (and r in [1, n-1]). */
export {lowS};
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
/** Exactly these members (no more, no fewer). */
export const exactly=(v,names)=>plain(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));

/** Canonical unpadded base64url bytes; anything else (padding, noncanonical trailing bits, other alphabets) throws. */
export function segmentBytes(value){try{return coreSegmentBytes(value);}catch(error){if(error instanceof SignedObjectFault)fail();throw error;}}
/** A canonical base64url string decoding to exactly `size` bytes (or at least `min` and at most `max`). */
export function b64Bytes(value,{size,min=size,max=size}={}){try{const bytes=segmentBytes(value);return bytes.length>=min&&bytes.length<=max?bytes:null;}catch{return null;}}

/**
 * Strict syntax of one signaling JWS. `typ` is the only accepted typ; `maxBytes` bounds the compact string. `kid(value)`
 * decides header kid validity (default: 1–200 characters without controls). Returns {header, payload, input,
 * signature}; throws SignalingWireFault(`code`) on anything else. No signature check here.
 */
export function parseSignalingJws(compact,{typ,maxBytes,kid=value=>typeof value==='string'&&KID.test(value),code='signaling_invalid'}={}){
 try{return parseCompactJWS(compact,{typ,maxBytes,kid,maxDepth:8});}
 catch(error){if(error instanceof SignedObjectFault)fail(code);throw error;}
}
/** ES256 over the received bytes under a P-256 public JWK. Never throws. */
export const verifySignature=(parsed,publicJwk,crypto=globalThis.crypto)=>verifyCompactJWS(parsed,publicJwk,crypto);
/** Encodes `claims` (in the caller's member order) under header {alg:'ES256', kid, typ}. */
export const signJws=({typ,kid,claims,privateKey},crypto=globalThis.crypto)=>signCompactJWS({typ,kid,claims,privateKey},crypto);
