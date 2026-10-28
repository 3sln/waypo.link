// The core signed-object profile: compact JWS parse, verify and sign (contacts-and-links spike §4.1 and CR-C0; the
// profile formerly in links §3.1, moving to the core keys specification under CR-K1; provisional, unsigned). No link,
// contact or signaling vocabulary: callers pass their own `typ` and bounds and map SignedObjectFault to their own codes.
// Pure functions, no I/O.
//
// The profile: ES256 only; a protected header of exactly {alg, kid, typ} with the caller's one accepted `typ`; segments in
// canonical unpadded base64url; header and payload strict I-JSON (packages/core/strict-json.mjs strictJSON: duplicate
// members, lone surrogates, noncharacters, -0, non-integers, unsafe integers and nesting deeper than `maxDepth` are
// refused) whose top level is a plain object; a 64-byte r||s signature that is low-S (s <= n/2), so a relayer cannot mint
// a second compact form of one signed object; and the signature input is the received bytes, never a re-serialization.
// Signing always normalizes to low-S.
// Kept exactly as signaling had it (CR-C0 changes no behaviour), open for review: the UTF-8 decoder consumes one leading
// BOM in a header or payload segment before strict JSON sees it, and verification reads only `x` and `y` of the key.
import {base64url,fromBase64url,textEncoder} from './records.mjs';
import {strictJSON} from './strict-json.mjs';

export class SignedObjectFault extends Error {constructor(code='signed_object_invalid'){super(code);this.name='SignedObjectFault';this.code=code;}}
const fail=()=>{throw new SignedObjectFault();};
const B64=/^[A-Za-z0-9_-]+$/,KID=/^[^\u0000-\u001f\u007f]{1,200}$/u;
const ES256={name:'ECDSA',hash:'SHA-256'},P256={name:'ECDSA',namedCurve:'P-256'};
const N=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,HALF_N=N>>1n;
const scalar=bytes=>bytes.reduce((v,b)=>(v<<8n)|BigInt(b),0n);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exactly=(v,names)=>plain(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));

/** True when a 64-byte r||s ES256 signature has r in [1, n-1] and s in [1, n/2]. */
export const lowS=signature=>{if(!(signature instanceof Uint8Array)||signature.length!==64)return false;const r=scalar(signature.subarray(0,32)),s=scalar(signature.subarray(32));return r>0n&&r<N&&s>0n&&s<=HALF_N;};
/** The low-S twin of a 64-byte ES256 signature (the input itself when already low-S). */
export const normalizeLowS=signature=>{const s=scalar(signature.subarray(32));if(s<=HALF_N)return signature;const out=new Uint8Array(signature);let v=N-s;for(let i=63;i>=32;i--){out[i]=Number(v&255n);v>>=8n;}return out;};

/** Canonical unpadded base64url bytes; anything else (padding, noncanonical trailing bits, other alphabets) throws. */
export function segmentBytes(value){
 if(typeof value!=='string'||!value||!B64.test(value))fail();let bytes;try{bytes=fromBase64url(value);}catch{fail();}
 if(base64url(bytes)!==value)fail();return bytes;
}
const segmentJSON=(segment,maxDepth)=>{let parsed;try{parsed=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(segmentBytes(segment)),{maxDepth});}catch{fail();}if(!plain(parsed))fail();return parsed;};

/**
 * Strict syntax of one compact JWS under the profile. `typ` is the only accepted typ; `maxBytes` bounds the UTF-8 compact
 * string; `kid(value)` decides header kid validity (default: 1-200 characters without controls); `maxDepth` bounds JSON
 * nesting (default 8). Returns {header, payload, input, signature, compact}, where `input` is the received signing input
 * bytes. Throws SignedObjectFault on anything else. No signature check here.
 */
export function parseCompactJWS(compact,{typ,maxBytes,kid=value=>typeof value==='string'&&KID.test(value),maxDepth=8}={}){
 if(typeof typ!=='string'||!typ||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new TypeError('parseCompactJWS needs a typ and maxBytes');
 if(typeof compact!=='string'||!compact.length||textEncoder.encode(compact).length>maxBytes)fail();
 const parts=compact.split('.');if(parts.length!==3)fail();
 const header=segmentJSON(parts[0],maxDepth),payload=segmentJSON(parts[1],maxDepth),signature=segmentBytes(parts[2]);
 if(!exactly(header,['alg','kid','typ'])||header.alg!=='ES256'||header.typ!==typ||!kid(header.kid)||signature.length!==64||!lowS(signature))fail();
 return {header,payload,input:textEncoder.encode(`${parts[0]}.${parts[1]}`),signature,compact};
}
/** ES256 over the received signing input of a parsed object, under a P-256 public JWK. Never throws. */
export async function verifyCompactJWS(parsed,publicJwk,crypto=globalThis.crypto){
 try{const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:publicJwk.x,y:publicJwk.y},P256,false,['verify']);return await crypto.subtle.verify(ES256,key,parsed.signature,parsed.input);}catch{return false;}
}
/** Encodes `claims` (in the caller's member order) under header {alg:'ES256', kid, typ} and signs it low-S. */
export async function signCompactJWS({typ,kid,claims,privateKey},crypto=globalThis.crypto){
 const encode=v=>base64url(textEncoder.encode(JSON.stringify(v))),head=`${encode({alg:'ES256',kid,typ})}.${encode(claims)}`;
 return `${head}.${base64url(normalizeLowS(new Uint8Array(await crypto.subtle.sign(ES256,privateKey,textEncoder.encode(head)))))}`;
}
