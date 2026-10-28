// Signaling leg certificates and control statements (docs/spec/extensions/signaling.md §6). Pure functions, no I/O.
// Provisional (coordinator), not signed off by the user. Appendix C.1 certificates.mjs: kept, with the rev 3.2 renames
// (`role` initiator/recipient, `kind` and `profile` instead of `purpose`, `client.feature`).
//
// A leg certificate is the provider's statement that one per-session ES256 key (`delegate`, thumbprint `cnf.jkt`)
// belongs to an endpoint (an app instance or a provider feature, §4.2) of entity (`iss`, `sub`) for one session `sid` and role. It is signed with an ACTIVE
// certification key of that entity (organizations §3a.3), never its identity signing key. A control statement is the
// provider's own signed `end` for a leg or a session. Both profiles have their own `typ` (AMD-SG-K1), distinct from
// member and entity certificates, delegations, relation events and messages.
//
// What lives here (issuance policy that needs storage, such as refusing a `delegate` certified in a live session or
// within 24 h, belongs to the session engine, service.mjs):
//   parseLegCertificate / verifyLegCertificate / signLegCertificate / renewalPreserves
//   parseControl / verifyControl / signControl
//   verifyKeyStatus / certificationKey / directoryCertificationKeys
//                     the "verify against the issuer's active certification keys as already held" rule, over the
//                     directory's key shape ({kid, use, alg, jwk, state}); only `use: 'cert'` and `state: 'active'`
//                     verify, so the identity signing key (`use: 'sig'`) never does (R4-H1, review L5)
import {base64url} from '../core/records.mjs';
import {delegatePublicJwk,jwkThumbprint,isJkt,originValid} from '../identity/delegation.mjs';
import {memberURL} from '../identity/member-certificates.mjs';
import {MESSAGE_TYP,LEG_CERTIFICATE_TYP,CONTROL_TYP,fail,plain,exactly,parseSignalingJws,verifySignature,signJws} from './jws.mjs';
import {sidValid,kindReferenceValid,profileValid,sameKind,validateMessagePayload} from './messages.mjs';

/** §3.1: a provider declares `max_leg_certificate_seconds` between 120 and 900; 3sln.me issues 600 (RTC-9). */
export const LEG_CERTIFICATE_MIN_SECONDS=120,LEG_CERTIFICATE_MAX_SECONDS=900,LEG_CERTIFICATE_SECONDS=600,SKEW_SECONDS=60;
export const LEG_CERTIFICATE_MAX_BYTES=8192,CONTROL_MAX_BYTES=4096,SESSION_MAX_SECONDS=86400;
export const CONTROL_REASONS=Object.freeze(['expired','revoked','moved','failed']);
const LEG_MEMBERS=['bindle','v','iss','sub','identity','aud','sid','role','kind','profile','client','cnf','delegate','aep','jti','iat','exp'];
const CONTROL_MEMBERS=['bindle','v','iss','sub','aud','sid','leg','type','reason','iat','jti'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,JTI=/^[A-Za-z0-9_-]{16,128}$/;
const nonNegative=v=>Number.isSafeInteger(v)&&v>=0;
const featureURL=v=>{try{const u=new URL(v);return typeof v==='string'&&v.length<=256&&u.protocol==='https:'&&u.href===v&&!u.search&&!u.hash&&!u.username;}catch{return false;}};
const clientId=v=>typeof v==='string'&&v.length>0&&v.length<=2048&&v.isWellFormed()&&!/[\p{Cc}\p{Bidi_Control}\u2028\u2029\u200b\ufeff]/u.test(v);
/** A declared `max_leg_certificate_seconds` (§3.1). */
export const maxLegSecondsValid=v=>Number.isSafeInteger(v)&&v>=LEG_CERTIFICATE_MIN_SECONDS&&v<=LEG_CERTIFICATE_MAX_SECONDS;

export function validateLegPayload(p,{allowLoopback=false}={}){
 const bad=()=>fail('signaling_certificate_invalid');
 if(!exactly(p,LEG_MEMBERS)||p.bindle!=='signaling-leg-certificate'||p.v!==1)bad();
 if(!originValid(p.iss,allowLoopback)||typeof p.sub!=='string'||!UUID.test(p.sub))bad();
 const identity=memberURL(p.identity,allowLoopback);if(!identity||identity.origin!==p.iss||!memberURL(p.aud,allowLoopback))bad();
 if(!sidValid(p.sid)||!['initiator','recipient'].includes(p.role)||!kindReferenceValid(p.kind)||!profileValid(p.profile))bad();
 // `client.feature` is null for an app, else the spec URL of the extension whose provider feature this is (§4.2, §6.1).
 if(!exactly(p.client,['client_id','origin','feature'])||!clientId(p.client.client_id)||!originValid(p.client.origin,allowLoopback)||!(p.client.feature===null||featureURL(p.client.feature)))bad();
 if(!exactly(p.cnf,['jkt'])||!isJkt(p.cnf.jkt)||!exactly(p.delegate,['kty','crv','x','y'])||!nonNegative(p.aep)||typeof p.jti!=='string'||!JTI.test(p.jti))bad();
 if(!nonNegative(p.iat)||!nonNegative(p.exp)||p.exp<=p.iat||p.exp-p.iat>LEG_CERTIFICATE_MAX_SECONDS)bad();
 return p;
}
export function parseLegCertificate(compact,options={}){const parsed=parseSignalingJws(compact,{typ:LEG_CERTIFICATE_TYP,maxBytes:LEG_CERTIFICATE_MAX_BYTES,code:'signaling_certificate_invalid'});validateLegPayload(parsed.payload,options);return parsed;}

const certKey=(key,kid)=>plain(key)&&key.kid===kid&&key.use==='cert'&&key.state==='active'&&(key.alg===undefined||key.alg==='ES256')&&plain(key.jwk)?key.jwk:null;
/**
 * The signing key for `kid` among `keys`, the issuer's keys as already held in the directory document's shape
 * ([{kid, use, alg, jwk, state}], packages/federation/directory.mjs). Only a key with `use: 'cert'` and `state:
 * 'active'` verifies; a `sig` (identity signing) or `enc` key, a revoked, retired or unknown key fails. Returns the
 * JWK or null.
 */
export function verifyKeyStatus(keys,kid){if(!Array.isArray(keys))return null;return certKey(keys.find(k=>plain(k)&&k.kid===kid),kid);}
/** `keys` is either such an array or a lookup `async kid => key | null` (directoryCertificationKeys); the same rule
 * applies to what the lookup returns. */
export async function certificationKey(keys,kid){if(typeof keys!=='function')return verifyKeyStatus(keys,kid);let key;try{key=await keys(kid);}catch{return null;}return certKey(key,kid);}
/**
 * Adapter over the directory's own certification-key lookup (Directory.resolve with purpose 'certification', which
 * matches only `use: 'cert'` keys that are active in both the cached document and the pin). Cache only: nothing is
 * fetched here. `identity` is the identity URI the verifier itself obtained.
 */
export const directoryCertificationKeys=(directory,{issuer,subject,identity})=>async kid=>{
 if(typeof kid!=='string')return null;const r=await directory.resolve({issuer,subject,kid,purpose:'certification',identity});
 return r&&r.purpose==='certification'&&r.verifiable===true?{kid:r.kid,use:'cert',alg:r.alg,jwk:r.publicJwk,state:r.state}:null;
};

/**
 * Verifies a parsed leg certificate (§6.1 "Verification"): exact profile and `typ` (by the parser), `aud` equal to
 * `expected.aud`, `sid` equal to `expected.sid`, `role`, `kind` and `profile` (when expected), `exp`
 * and `iat` within 60 s of `now` (Unix seconds), lifetime at most `maxSeconds`, `exp` no later than `sessionEndsAt`
 * (when given), the holder key matching `cnf.jkt`, the signature under an active certification key from `keys`, the
 * `identity` claim equal to the identity URI the verifier itself obtained (`identity`: directory, pin or move record,
 * never the certificate), and `aep` at least `minAep`. Returns {payload, holder:{jwk,key}, jkt}. Throws SignalingWireFault.
 */
export async function verifyLegCertificate(parsed,{keys,expected={},identity,now,maxSeconds=LEG_CERTIFICATE_MAX_SECONDS,sessionEndsAt,minAep=0,crypto=globalThis.crypto}={}){
 const p=parsed.payload,bad=(code='signaling_certificate_invalid')=>fail(code);
 if(typeof identity!=='string'||identity!==p.identity)bad('signaling_identity_mismatch');
 if(p.aud!==expected.aud||p.sid!==expected.sid||expected.role!==undefined&&p.role!==expected.role||expected.client_id!==undefined&&p.client.client_id!==expected.client_id)bad();
 if(expected.kind!==undefined&&!sameKind(p.kind,expected.kind)||expected.profile!==undefined&&p.profile!==expected.profile)bad();
 if(!maxLegSecondsValid(maxSeconds)||p.exp-p.iat>maxSeconds||sessionEndsAt!==undefined&&p.exp>sessionEndsAt)bad();
 if(!Number.isSafeInteger(now)||now>p.exp+SKEW_SECONDS||p.iat>now+SKEW_SECONDS)bad('signaling_certificate_expired');
 if(p.aep<minAep)bad('signaling_epoch_rollback');
 const holder=await delegatePublicJwk(p.delegate,crypto);if(!holder||await jwkThumbprint(holder.jwk,crypto)!==p.cnf.jkt)bad();
 const jwk=await certificationKey(keys,parsed.header.kid);if(!jwk||!await verifySignature(parsed,jwk,crypto))bad('signaling_signature_invalid');
 return {payload:p,holder,jkt:p.cnf.jkt};
}
/** A renewal keeps `sid`, `role`, `kind`, `profile`, `cnf` (and so `delegate`), the principal, `aud` and `client` (§6.1). */
export const renewalPreserves=(old,next)=>['iss','sub','identity','aud','sid','role','profile'].every(k=>old[k]===next[k])&&old.cnf.jkt===next.cnf.jkt&&sameKind(old.kind,next.kind)&&JSON.stringify(old.client)===JSON.stringify(next.client);

/**
 * Signs a leg certificate. `input`: {issuer, sub, identity, aud, sid, role, kind, profile, client:{client_id, origin, feature},
 * delegate (P-256 public JWK), aep, now (ms), lifetime? (s), maxSeconds (the declared bound), sessionEndsAt? (s),
 * jti?}. `signer`: {kid, privateKey}, which MUST be an active certification key (certificationSigner), never the
 * identity signing key; the caller has already made the §5.1 checks (initiator) or won the claim (recipient). The lifetime
 * is clamped to `maxSeconds` and to the session's end. Returns {certificate, jkt, jti, iat, exp}.
 */
export async function signLegCertificate(input,signer,crypto=globalThis.crypto){
 const delegate=await delegatePublicJwk(input.delegate,crypto);if(!delegate)throw new TypeError('A P-256 leg key is required.');
 if(!maxLegSecondsValid(input.maxSeconds))throw new TypeError('Invalid max_leg_certificate_seconds.');
 const iat=Math.floor(input.now/1000),lifetime=Math.min(input.maxSeconds,Number.isSafeInteger(input.lifetime)&&input.lifetime>0?input.lifetime:LEG_CERTIFICATE_SECONDS),exp=Math.min(iat+lifetime,input.sessionEndsAt??Infinity);
 if(exp<=iat)throw new TypeError('The session has ended.');
 const jkt=await jwkThumbprint(delegate.jwk,crypto),jti=input.jti??base64url(crypto.getRandomValues(new Uint8Array(24)));
 const claims={bindle:'signaling-leg-certificate',v:1,iss:input.issuer,sub:input.sub,identity:input.identity,aud:input.aud,sid:input.sid,role:input.role,kind:{artefact:input.kind.artefact,version:input.kind.version,digest:input.kind.digest},profile:input.profile,client:{client_id:input.client.client_id,origin:input.client.origin,feature:input.client.feature??null},cnf:{jkt},delegate:delegate.jwk,aep:input.aep,jti,iat,exp};
 validateLegPayload(claims,{allowLoopback:input.allowLoopback===true});
 return {certificate:await signJws({typ:LEG_CERTIFICATE_TYP,kid:signer.kid,claims,privateKey:signer.privateKey},crypto),jkt,jti,iat,exp};
}

// ---- control statements (§6.2) -----------------------------------------------------------------------------------
export function validateControlPayload(p,{allowLoopback=false}={}){
 const bad=()=>fail('signaling_control_invalid');
 if(!exactly(p,CONTROL_MEMBERS)||p.bindle!=='signaling-control'||p.v!==1||p.type!=='end'||!CONTROL_REASONS.includes(p.reason))bad();
 if(!originValid(p.iss,allowLoopback)||typeof p.sub!=='string'||!UUID.test(p.sub)||!memberURL(p.aud,allowLoopback)||!sidValid(p.sid)||!(p.leg===null||isJkt(p.leg)))bad();
 if(!nonNegative(p.iat)||typeof p.jti!=='string'||!JTI.test(p.jti))bad();
 return p;
}
export function parseControl(compact,options={}){const parsed=parseSignalingJws(compact,{typ:CONTROL_TYP,maxBytes:CONTROL_MAX_BYTES,code:'signaling_control_invalid'});validateControlPayload(parsed.payload,options);return parsed;}
/** Verifies a parsed control statement: `aud`, `sid`, `iss` and `sub` as expected (all four REQUIRED: the issuer is
 * the session party whose `keys` are given, never whoever signed; review L4), the signing key an active
 * certification key of that party (`keys`), `iat` not in the future beyond the skew. Returns the payload. */
export async function verifyControl(parsed,{keys,expected={},now,crypto=globalThis.crypto}={}){
 const p=parsed.payload;if(['aud','sid','iss','sub'].some(k=>typeof expected?.[k]!=='string'||p[k]!==expected[k]))fail('signaling_control_invalid');
 if(!Number.isSafeInteger(now)||p.iat>now+SKEW_SECONDS)fail('signaling_control_invalid');
 const jwk=await certificationKey(keys,parsed.header.kid);if(!jwk||!await verifySignature(parsed,jwk,crypto))fail('signaling_signature_invalid');
 return p;
}
/** Signs a control statement `end` (`leg` is the affected leg's jkt, or null for the whole session). */
export async function signControl({issuer,sub,aud,sid,leg=null,reason,now,jti,allowLoopback=false},signer,crypto=globalThis.crypto){
 const claims={bindle:'signaling-control',v:1,iss:issuer,sub,aud,sid,leg,type:'end',reason,iat:Math.floor(now/1000),jti:jti??base64url(crypto.getRandomValues(new Uint8Array(24)))};
 validateControlPayload(claims,{allowLoopback});return signJws({typ:CONTROL_TYP,kid:signer.kid,claims,privateKey:signer.privateKey},crypto);
}
/** Signs a message with a leg key (endpoint side and tests). `claims` are the full payload; header kid = `leg`. */
export async function signMessage(claims,legPrivateKey,crypto=globalThis.crypto){
 validateMessagePayload(claims,{allowLoopback:true});
 return signJws({typ:MESSAGE_TYP,kid:claims.leg,claims,privateKey:legPrivateKey},crypto);
}
