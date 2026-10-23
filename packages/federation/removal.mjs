import {FederationFault} from './schema.mjs';
export const REMOVAL_TYP='bindle-removal+jwt',REMOVAL_FEATURE='app-removal.v1';
export const REMOVAL_LIMITS=Object.freeze({lifetime:300,leeway:30,resultBytes:2048,cleanupDefault:900,cleanupMax:86400});
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).every(k=>keys.includes(k));
const bad=new RegExp('['+[[0,31],[127,159],[173,173],[1564,1564],[6158,6158],[8203,8207],[8232,8238],[8288,8303],[65024,65039],[65279,65279],[65529,65531],[917504,921599]].map(([a,b])=>'\\u{'+a.toString(16)+'}-\\u{'+b.toString(16)+'}').join('')+']','u');
const text=(s,n)=>typeof s==='string'&&s.length>0&&s.trim()===s&&s.isWellFormed()&&[...s].length<=n&&!bad.test(s);
const url=s=>{try{const u=new URL(s);return typeof s==='string'&&s.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!/[?#]/.test(s)&&u.href===s?u:null;}catch{return null;}};
const origin=s=>{const u=url(s+'/');return u&&u.origin===s;};
const id=s=>typeof s==='string'&&/^[A-Za-z0-9._~-]{1,128}$/.test(s);
const nonce=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{22,128}$/.test(s);
const fail=reason=>{throw Object.assign(new FederationFault('invalid_token','The removal request is invalid.'),{status:401,reason});};
const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const decode=s=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]*$/.test(s)||s.length%4===1)fail('encoding');let bytes;try{bytes=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}catch{fail('encoding');}if(b64(bytes)!==s)fail('encoding');return bytes;};
const json=s=>{try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(decode(s)),v=JSON.parse(raw);if(!plain(v)||JSON.stringify(v)!==raw)fail('encoding');return v;}catch{fail('encoding');}};
/** Invalid declarations are absent, including endpoint collisions. Public clients cannot opt into back-channel. */
export function validateRemoval(value,{clientId,confidential=false,redirectUris=[],initiateLoginUri,managementUrl,eventsEndpoint,rpcEndpoint,discoveryEndpoint}={}){
 if(!exact(value,['uri','cleanup_seconds','back_channel']))return undefined;const u=url(value.uri),client=url(clientId);if(!u||!client||u.origin!==client.origin||!u.pathname.startsWith(client.pathname.slice(0,client.pathname.lastIndexOf('/')+1))||/%2f|%5c|\\/i.test(u.pathname))return undefined;
 if([...redirectUris,initiateLoginUri,managementUrl,eventsEndpoint,rpcEndpoint,discoveryEndpoint].includes(value.uri)||value.cleanup_seconds!==undefined&&(!Number.isSafeInteger(value.cleanup_seconds)||value.cleanup_seconds<60||value.cleanup_seconds>86400)||value.back_channel!==undefined&&typeof value.back_channel!=='boolean')return undefined;
 return {uri:value.uri,...value.cleanup_seconds===undefined?{}:{cleanup_seconds:value.cleanup_seconds},back_channel:confidential&&value.back_channel===true};
}
function claimsValid(c){
 if(!exact(c,['iss','sub','aud','iat','exp','jti','bindle'])||!origin(c.iss)||!url(c.sub)||!url(c.aud)||!Number.isSafeInteger(c.iat)||c.iat<0||!Number.isSafeInteger(c.exp)||c.exp<=c.iat||c.exp-c.iat>300||!nonce(c.jti))return false;
 const b=c.bindle;if(!exact(b,['v','purpose','removal','connection','generation','cleanup_by','return_uri','actor'])||b.v!==1||b.purpose!=='remove'||!id(b.removal)||!Number.isSafeInteger(b.cleanup_by)||b.cleanup_by<0||!url(b.return_uri)||new URL(b.return_uri).origin!==c.iss)return false;
 if((b.connection===undefined)!==(b.generation===undefined)||b.connection!==undefined&&(!id(b.connection)||!Number.isSafeInteger(b.generation)||b.generation<0))return false;
 return b.actor===undefined||exact(b.actor,['iss','sub'])&&origin(b.actor.iss)&&!!url(b.actor.sub);
}
/** Claims only: the caller signs with a dedicated removal key and pins whether connection/actor may be exposed. */
export function buildRemovalClaims({issuer,subject,clientId,removal,cleanupBy,returnUri,connection,generation,actor,jti,issuedAt,lifetime=300},{clock=()=>Date.now(),crypto=globalThis.crypto}={}){
 const iat=issuedAt??Math.floor(clock()/1000),claims={iss:issuer,sub:subject,aud:clientId,iat,exp:iat+lifetime,jti:jti??b64(crypto.getRandomValues(new Uint8Array(16))),bindle:{v:1,purpose:'remove',removal,cleanup_by:cleanupBy,return_uri:returnUri,...connection===undefined?{}:{connection,generation},...actor===undefined?{}:{actor:structuredClone(actor)}}};
 if(!claimsValid(claims))throw new FederationFault('invalid_request','Invalid removal claims.');return claims;
}
export function peekRemovalRequest(token){
 if(typeof token!=='string'||token.length>8192)fail('malformed');const parts=token.split('.');if(parts.length!==3)fail('malformed');const header=json(parts[0]),claims=json(parts[1]);
 if(!exact(header,['alg','typ','kid'])||header.alg!=='ES256'||header.typ!==REMOVAL_TYP||!/^removal\.[A-Za-z0-9_-]{22}$/.test(header.kid??''))fail('header');return {header,claims,iss:claims.iss,sub:claims.sub,connection:claims.bindle?.connection,parts};
}
/** Relationship is mandatory and runs before key resolution. Replay is consumed only after complete validation. */
export async function verifyRemovalRequest(token,{issuer,clientId,returnUri,keys,relationship,replay,now=Date.now(),leeway=30,crypto=globalThis.crypto}={}){
 if(!Number.isSafeInteger(leeway)||leeway<0||leeway>30)throw new TypeError('Removal leeway must be 0–30 seconds.');const p=peekRemovalRequest(token),{header,claims,parts}=p;
 if(claims.iss!==issuer||typeof relationship!=='function'||!await relationship(p))fail('relationship');const set=typeof keys==='function'?await keys(header.kid):keys,list=Array.isArray(set)?set:set?.keys;if(!Array.isArray(list)||list.length>64)fail('jwks');const matches=list.filter(k=>k?.kid===header.kid);if(matches.length!==1)fail('kid');const k=matches[0];
 if(k.kty!=='EC'||k.crv!=='P-256'||k.d!==undefined||k.alg!==undefined&&k.alg!=='ES256'||k.use!==undefined&&k.use!=='sig')fail('jwks');const signature=decode(parts[2]);if(signature.length!==64)fail('signature');let verified=false;
 try{const key=await crypto.subtle.importKey('jwk',{kty:k.kty,crv:k.crv,x:k.x,y:k.y},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);verified=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,new TextEncoder().encode(parts[0]+'.'+parts[1]));}catch{}if(!verified)fail('signature');
 if(!claimsValid(claims)||claims.aud!==clientId||claims.bindle.return_uri!==returnUri)fail('claims');const seconds=Math.floor(now/1000);if(claims.iat>seconds+leeway||claims.exp<=seconds-leeway)fail('time');
 if(typeof replay!=='function'||await replay(issuer,claims.jti,(claims.exp+leeway)*1000)!==true)fail('replay');return {header,claims};
}
/** Hostile result text is discarded without changing the outcome. */
export function parseRemovalResult(encoded){
 try{if(typeof encoded!=='string'||encoded.length>2731)return undefined;const bytes=decode(encoded);if(bytes.length>2048)return undefined;const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!exact(v,['v','items','message'])||v.v!==1||!Array.isArray(v.items)||v.items.length>16||v.message!==undefined&&!text(v.message,500))return undefined;
  if(v.items.some(i=>!exact(i,['label','disposition','location','note'])||!text(i.label,100)||!['kept','deleted','archived','exported','other'].includes(i.disposition)||!['owner-storage','app','elsewhere'].includes(i.location)||i.note!==undefined&&!text(i.note,200)))return undefined;return v;
 }catch{return undefined;}
}
export function parseRemovalReturn(input,{backChannel=false}={}){
 let p;try{p=input instanceof URLSearchParams?input:new URLSearchParams(input);}catch{return undefined;}const keys=[...p.keys()];if(new Set(keys).size!==keys.length||keys.some(k=>!['removal','outcome','result',...backChannel?['client_assertion','client_assertion_type']:[]].includes(k)))return undefined;
 const removal=p.get('removal'),outcome=p.get('outcome');if((!backChannel||removal!==null)&&!id(removal)||!(backChannel?['completed','failed']:['completed','in-progress','canceled','failed']).includes(outcome))return undefined;const result=parseRemovalResult(p.get('result'));return {...removal===null?{}:{removal},outcome,...result?{result}:{}};
}
/** Local client lookup and outcome validation precede this call; no metadata is fetched here. */
export async function verifyRemovalAssertion(assertion,{removal,...options}){
 if(!id(removal)||typeof assertion!=='string'||assertion.length>4096)fail('assertion');const parts=assertion.split('.');if(parts.length!==3)fail('assertion');const claims=json(parts[1]);if(claims.bindle_removal!==removal)fail('removal');const {verifyClientAssertion}=await import('./introspection.mjs');await verifyClientAssertion(assertion,options);return claims;
}
