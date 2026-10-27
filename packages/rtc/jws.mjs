// RTC-a: the links §3.1 compact JWS profile as used by rtc-signaling.v1 (docs/spec/rtc-signaling.md §5, §6.1).
// Pure functions, no I/O. Provisional (coordinator), not signed off by the user.
//
// Every RTC JWS is ES256 with a protected header of exactly {alg, kid, typ}. The `typ` separates the three profiles
// (message, leg certificate, control statement) from each other and from every other Bindle profile, so a parser for
// one never accepts another. Segments must be canonical unpadded base64url, JSON must be strict I-JSON (duplicate
// members, lone surrogates, -0, unsafe integers and nesting deeper than 8 are refused), and the signature input is the
// received bytes, never a re-serialization. The ES256 signature must be low-S (s <= n/2; review L3, provisional): a
// high-S twin of a valid signature verifies under WebCrypto, so without this a relayer could mint a second, distinct
// compact form of the same message. Signing here always normalizes to low-S.
import {base64url,fromBase64url,textEncoder} from '../core/records.mjs';
import {strictJSON} from '../links/envelope.mjs';

export const RTC_MESSAGE_TYP='bindle-rtc-message+jwt',RTC_LEG_CERTIFICATE_TYP='bindle-rtc-leg-certificate+jwt',RTC_CONTROL_TYP='bindle-rtc-control+jwt';
export class RtcWireFault extends Error {constructor(code='rtc_invalid',message=code){super(message);this.name='RtcWireFault';this.code=code;}}
export const fail=(code='rtc_invalid',message)=>{throw new RtcWireFault(code,message);};
const B64=/^[A-Za-z0-9_-]+$/,KID=/^[^\u0000-\u001f\u007f]{1,200}$/u;
const ES256={name:'ECDSA',hash:'SHA-256'},P256={name:'ECDSA',namedCurve:'P-256'};
const N=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,HALF_N=N>>1n;
const scalar=bytes=>bytes.reduce((v,b)=>(v<<8n)|BigInt(b),0n);
/** True when a 64-byte r||s ES256 signature has s in [1, n/2] (and r in [1, n-1]). */
export const lowS=signature=>{if(!(signature instanceof Uint8Array)||signature.length!==64)return false;const r=scalar(signature.subarray(0,32)),s=scalar(signature.subarray(32));return r>0n&&r<N&&s>0n&&s<=HALF_N;};
const normalizeS=signature=>{const s=scalar(signature.subarray(32));if(s<=HALF_N)return signature;const out=new Uint8Array(signature);let v=N-s;for(let i=63;i>=32;i--){out[i]=Number(v&255n);v>>=8n;}return out;};
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
/** Exactly these members (no more, no fewer). */
export const exactly=(v,names)=>plain(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));

/** Canonical unpadded base64url bytes; anything else (padding, noncanonical trailing bits, other alphabets) throws. */
export function segmentBytes(value){
 if(typeof value!=='string'||!value||!B64.test(value))fail();let bytes;try{bytes=fromBase64url(value);}catch{fail();}
 if(base64url(bytes)!==value)fail();return bytes;
}
/** A canonical base64url string decoding to exactly `size` bytes (or at least `min` and at most `max`). */
export function b64Bytes(value,{size,min=size,max=size}={}){try{const bytes=segmentBytes(value);return bytes.length>=min&&bytes.length<=max?bytes:null;}catch{return null;}}
const json=segment=>{let parsed;try{parsed=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(segmentBytes(segment)));}catch(error){if(error instanceof RtcWireFault)throw error;fail();}if(!plain(parsed))fail();return parsed;};

/**
 * Strict syntax of one RTC JWS. `typ` is the only accepted typ; `maxBytes` bounds the compact string. `kid(value)`
 * decides header kid validity (default: 1–200 characters without controls). Returns {header, payload, input,
 * signature}; throws RtcWireFault(`code`) on anything else. No signature check here.
 */
export function parseRtcJws(compact,{typ,maxBytes,kid=value=>typeof value==='string'&&KID.test(value),code='rtc_invalid'}={}){
 try{
  if(typeof compact!=='string'||!compact.length||textEncoder.encode(compact).length>maxBytes)fail();
  const parts=compact.split('.');if(parts.length!==3)fail();
  const header=json(parts[0]),payload=json(parts[1]),signature=segmentBytes(parts[2]);
  if(!exactly(header,['alg','kid','typ'])||header.alg!=='ES256'||header.typ!==typ||!kid(header.kid)||signature.length!==64||!lowS(signature))fail();
  return {header,payload,input:textEncoder.encode(`${parts[0]}.${parts[1]}`),signature,compact};
 }catch(error){if(error instanceof RtcWireFault)fail(code);throw error;}
}
/** ES256 over the received bytes under a P-256 public JWK. Never throws. */
export async function verifyRtcSignature(parsed,publicJwk,crypto=globalThis.crypto){
 try{const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:publicJwk.x,y:publicJwk.y},P256,false,['verify']);return await crypto.subtle.verify(ES256,key,parsed.signature,parsed.input);}catch{return false;}
}
/** Encodes `claims` (in the caller's member order) under header {alg:'ES256', kid, typ}. */
export async function signRtcJws({typ,kid,claims,privateKey},crypto=globalThis.crypto){
 const encode=v=>base64url(textEncoder.encode(JSON.stringify(v))),head=`${encode({alg:'ES256',kid,typ})}.${encode(claims)}`;
 return `${head}.${base64url(normalizeS(new Uint8Array(await crypto.subtle.sign(ES256,privateKey,textEncoder.encode(head)))))}`;
}
