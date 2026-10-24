// Intent links rev 3: pure bounded wire codec. No identity claims survive unverified signatures.
import {strictJSON,jcs,plain,textEncoder} from '../core/strict-json.mjs';
import {parseReference} from '../core/artefacts.mjs';
export class IntentFault extends Error {constructor(code='intent_malformed'){super(code);this.name='IntentFault';this.code=code;}}
export const fail=(code)=>{throw new IntentFault(code);};
export const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
export const guarded=fn=>{try{return fn();}catch(e){if(e instanceof IntentFault)throw e;fail();}};
export const INTENT_LIMITS=Object.freeze({unsignedBytes:4608,dataBytes:4480,signedBytes:5120,unsignedValue:6400,signedValue:7168,url:8192});
const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const bytes=value=>{if(typeof value!=='string'||! /^[A-Za-z0-9_-]+$/.test(value))fail();const out=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(b64(out)!==value)fail();return out;};
const object=(v,{signed=false,now}={})=>{
 if(!exact(v,['bintent','kind','data'],signed?['iat','exp','minter']:['exp'])||v.bintent!==1||!plain(v.data)||!exact(v.kind,['artefact','version','digest']))fail();
 const ref=parseReference(v.kind,{kind:'intent'});if(ref.latest||ref.legacy||!ref.version)fail();
 if(v.exp!==undefined&&(!Number.isSafeInteger(v.exp)||v.exp<0)||v.iat!==undefined&&(!Number.isSafeInteger(v.iat)||v.iat<0)||v.exp!==undefined&&v.iat!==undefined&&v.exp<=v.iat)fail();
 if(signed&&(!Number.isSafeInteger(v.iat)||!exact(v.minter,['iss','sub'])||!origin(v.minter.iss)||!uuid(v.minter.sub)))fail();
 if(v.exp!==undefined&&v.exp<=(now??Math.floor(Date.now()/1000)))fail('intent_expired');
 if(textEncoder.encode(jcs(v.data,{maxDepth:8})).length>4480)fail();return v;
};
export const origin=v=>{try{const u=new URL(v);return typeof v==='string'&&u.protocol==='https:'&&u.origin===v;}catch{return false;}};
export const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export function encodeIntent(input){return guarded(()=>{const text=jcs(input,{maxDepth:8});if(textEncoder.encode(text).length>4608)fail();object(input);const value=b64(textEncoder.encode(text));if(value.length>6400)fail();return value;});}
export function decodeIntent(value,{now}={}){return guarded(()=>{
 if(typeof value!=='string'||!value.length||value.length>(value.includes('.')?7168:6400))fail();
 const signed=value.includes('.');let raw;
 if(signed){const parts=value.split('.');if(parts.length!==3)fail();const h=strictJSON(bytes(parts[0]),{maxBytes:512,maxDepth:8});if(!exact(h,['alg','kid','typ'])||h.alg!=='ES256'||h.typ!=='bindle-intent+jwt'||typeof h.kid!=='string'||!h.kid.length||h.kid.length>200||/[\u0000-\u001f\u007f]/.test(h.kid)||bytes(parts[2]).length!==64)fail();raw=bytes(parts[1]);}else raw=bytes(value);
 const v=strictJSON(raw,{maxBytes:signed?5120:4608,maxDepth:8});if(!signed&&b64(textEncoder.encode(jcs(v,{maxDepth:8})))!==value)fail();object(v,{signed,now});if(signed){delete v.minter;delete v.iat;}return v;
});}
const name=v=>{try{return decodeURIComponent(v).toLowerCase();}catch{return v.toLowerCase();}};
export function parseIntentURL(input,options){return guarded(()=>{
 if(typeof input!=='string'||input.length>8192)fail();const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password)fail();let value,placement,mixed=false;
 const hash=input.indexOf('#'),base=hash<0?input:input.slice(0,hash),q=base.indexOf('?');for(const part of (q<0?'':base.slice(q+1)).split('&')){const eq=part.indexOf('='),key=eq<0?part:part.slice(0,eq),decoded=name(key);if(decoded==='sig'||decoded.startsWith('bindle_'))mixed=true;if(decoded!=='bintent')continue;if(key!=='bintent'||eq<0||value!==undefined)fail();value=part.slice(eq+1);placement='query';}
 if(hash>=0){const fragment=input.slice(hash+1);if(fragment.startsWith('bintent=')||name(fragment.split('=')[0])==='bintent'){if(value!==undefined||!fragment.startsWith('bintent='))fail();value=fragment.slice(8);placement='fragment';}}
 if(value===undefined||mixed)fail();return {intent:decodeIntent(value,options),value,placement};
});}
export function parseProtocolIntent(substitution,options){return guarded(()=>{if(typeof substitution!=='string'||substitution.length>24576)fail();const decoded=decodeURIComponent(substitution),match=/^web\+bindle:\/\/intent\?bintent=([A-Za-z0-9_.-]+)$/.exec(decoded);if(!match||decoded.length>8192)fail();return {intent:decodeIntent(match[1],options),value:match[1],placement:'scheme'};});}
