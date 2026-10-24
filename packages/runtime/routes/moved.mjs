// PORT-3: moved responses and the redirect router (docs/architecture/identity-portability.md §5, §6.3–§6.5;
// docs/spec/identity-portability.md §5.2, §10, §11), plus the thin HTTP adapters of PORT-2's engine
// (packages/identity/transfer-out.mjs, dispatched through packages/runtime/account/transfer-out.mjs).
//
// Redirects (edge stage, so they precede every per-identity route, including the BindleBox descriptor):
//   /users/<handle>[/...] and /identity/<sub>[/...] of an identity in status `moved` whose redirect window is live
//   answer `308` to `redirect_base` + the path as received (without its leading `/`) + `?` + the raw query, byte for
//   byte. Only exact, non-normalized paths with RFC 3986 query characters are redirected (spec §10, IP-R1-L1); anything
//   else falls through to the ordinary routes, which answer a non-active identity with the uniform 404. Key-delegation
//   status is never redirected: delegations died at commit, so it answers the final `revoked` itself (IP-R1-L5).
//   Redirects are never authority (spec §10): identity-document requests carry the moved record in the body. Headers:
//   `Referrer-Policy: no-referrer`; `no-store` on capability URLs (parameter names compared decoded), otherwise `private, max-age=86400`; never varying
//   on request headers. No per-request record is kept. After the redirect window the identity answers exactly as a
//   deleted one (the ordinary routes' uniform 404 and invalid-credential refusals). Committed redirects are a
//   commitment, so no flag gates them.
//
// The authorization request (`POST /api/oauth/requests`) answers `identity_moved` with `{to}` while the redirect runs
// (spec §11): routes/federation.mjs calls `movedAuthorization` before its public-identity probe.
//
// Move endpoint `POST /bindle/portability/move` (spec §5.2): mounted while IDENTITY_TRANSFER_OUT_ENABLED is globally
// on, and for idempotent replies about committed moves whatever the flag says: only an exact replay of the attested
// statement (and its bound redirect_base, inside the proof window) answers 200 from the moved record; every other
// request about a moved identity takes the same path as an unknown one (404 while unmounted, 409 refused while
// mounted), so the endpoint is no moved-status oracle (F12). 200 attested, 202 pending, 409 refused (uniform), 429/503
// retryable. `portability.v1` is not advertised: it requires `directory.v1`, which is not mounted.
//
// Attestation keys `GET /bindle/portability/attestation-keys` (spec §5.1, PORT-4 P16): the published key set of
// IDENTITY_ATTESTATION_KEYS (or the legacy IDENTITY_ATTESTATION_KEY), public members and continuity only, credentialless
// CORS. Not flag-gated: keys that signed attestations stay published for as long as the provider operates. Without a
// configured set it answers the uniform 404.
//
// Owner API (session, CSRF; engine-checked step-up): GET /api/account/transfer-out and POST …/{begin,authorize,cancel,
// dispute,elevate,restart-choice}. Credentialless API (no session; notice links and the isolated recovery page):
// POST …/link (dispute token), …/waiting (path (b)), …/withdraw (path (b) withdrawal with the same file). The isolated
// pages themselves and the support console are PORT-6 and the admin slice.
import {redirectCapability} from '../redirect-extension.mjs';
import {Query} from '../../../vendor/ngin/index.js';
import {isUUID} from '../../core/primitives.mjs';
import {normalizeHandle} from '../../identity/handles.mjs';
import {redirectablePath,redirectTarget,parseMoveStatement} from '../../identity/succession.mjs';
import {movedWindow} from '../../identity/lifecycle-tombstone.mjs';
import {redirectTo} from '../../identity/redirect-records.mjs';
import {statusCacheControl,isJkt} from '../../identity/delegation.mjs';
import {TRANSFER_FLAG} from '../../identity/transfer-out.mjs';
import {ATTESTATION_KEYS_PATH,parseAttestationKeySet,publishedAttestationJwks} from '../../identity/attestation-keys.mjs';
import {json,body,privateHeaders,routeFlags,flagGlobal,accountHandle,pseudonym,subnet} from './shared.mjs';

export const MOVE_PATH='/bindle/portability/move';
const ROOT='/api/account/transfer-out',OWNER_ACTIONS=['begin','authorize','cancel','dispute','elevate','restart-choice'],PUBLIC_ACTIONS=['link','waiting','withdraw'];
const HOUR=3600000;
const USERS=/^\/users\/([^/?#]+)(?:\/|$)/,IDENTITY=/^\/identity\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/,DELEGATION=/^\/identity\/([a-f0-9-]{36})\/delegations\/([^/]+)$/;
const CAPABILITY_PARAMS=new Set(['bindle_meta','bindle_data','sig','bintent']);
/** Whether a raw query carries a capability parameter, by its DECODED name (`bindle%5Fmeta=` is `bindle_meta=`). A
 * name that does not decode is treated as a capability: `no-store` is the safe answer. */
export function capabilityQuery(rawQuery){
 if(rawQuery===null||rawQuery===undefined)return false;
 for(const part of rawQuery.split('&')){const name=part.split('=',1)[0];let decoded;try{decoded=decodeURIComponent(name.replaceAll('+',' '));}catch{return true;}if(CAPABILITY_PARAMS.has(decoded))return true;}
 return false;
}

/** The path as received and the raw query (null without `?`), from the request URL string, never re-serialized. */
export function rawTarget(requestURL){
 const scheme=requestURL.indexOf('://');if(scheme<0)return null;const slash=requestURL.indexOf('/',scheme+3);if(slash<0)return {path:'/',rawQuery:null};
 const rest=requestURL.slice(slash),hash=rest.indexOf('#'),bare=hash<0?rest:rest.slice(0,hash),mark=bare.indexOf('?');
 return {path:mark<0?bare:bare.slice(0,mark),rawQuery:mark<0?null:bare.slice(mark+1)};
}
/** A moved identity's live redirect at `now`, or null. Reads the identity directory only; never wakes an account. */
const clockOf=env=>typeof env.MOVED_CLOCK==='function'?env.MOVED_CLOCK():Date.now();
export async function movedLookup(env,{handle,sub},now=clockOf(env)){
 const repository=env.IDENTITY_REPOSITORY;if(!repository)return null;
 let account;
 try{if(sub!==undefined){if(!isUUID(sub))return null;account=await repository.get(sub);}else{let name;try{name=normalizeHandle(decodeURIComponent(handle));}catch{return null;}account=await repository.findByHandle?.(name);}}catch{return null;}
 if(account?.status!=='moved'||!account.moved||typeof account.id!=='string')return null;
 const window=movedWindow(account.moved,now);if(!window.live)return null;
 const moved=account.moved;return {sub:account.id,to:redirectTo(moved),redirectBase:moved.redirectBase,statement:moved.statement,attestation:moved.attestation,redirectUntil:moved.redirectUntil,committedAt:moved.committedAt};
}
/** Spec §11: `{to}` for an authorization request naming a moved identity (`handle@host` on this host) while its
 * redirect runs; null otherwise, after which the request answers exactly as for a deleted identity. */
export async function movedAuthorization(env,identity){
 const parts=typeof identity==='string'?identity.split('@'):[];if(parts.length!==2||parts[1].toLowerCase()!==new URL(env.APP_ORIGIN).host)return null;
 const moved=await movedLookup(env,{handle:encodeURIComponent(parts[0])});return moved?{to:moved.to}:null;
}
/** The §10 redirect for a moved identity, or null when the request is not redirectable. */
export function movedResponse(request,moved,{iss,document=false}={}){
 const target=rawTarget(request.url);if(!target||!redirectablePath(target.path,target.rawQuery))return null;
 let location;try{location=redirectTarget({redirectBase:moved.redirectBase,path:target.path,rawQuery:target.rawQuery});}catch{return null;}
 const capability=capabilityQuery(target.rawQuery)||/\/contact\//.test(target.path);
 const headers={Location:location,'Referrer-Policy':'no-referrer','Cache-Control':capability?'no-store':'private, max-age=86400','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
 if(document&&request.method!=='HEAD')return new Response(JSON.stringify({v:1,iss,sub:moved.sub,moved:{statement:moved.statement,attestation:moved.attestation}}),{status:308,headers:{...headers,'Content-Type':'application/json'}});
 return new Response(null,{status:308,headers});
}
/** Directory hook for the future directory.v1 route (`?handle=` / `?sub=`): the §10 redirect with the moved body. */
export async function movedDirectoryResponse(request,env,{handle,sub}){const moved=await movedLookup(env,{handle,sub});return moved?movedResponse(request,moved,{iss:env.APP_ORIGIN,document:true}):null;}
/** Identity-document hook (`<identity URI>/identity.json` and the subtree): the redirect with the moved body. */
export async function movedIdentityDocument(request,env,sub){const moved=await movedLookup(env,{sub});return moved?movedResponse(request,moved,{iss:env.APP_ORIGIN,document:true}):null;}

async function redirectRoute({request,env,url}){
 if(url.origin!==env.APP_ORIGIN||request.method==='OPTIONS'||!env.IDENTITY_REPOSITORY)return;
 const path=url.pathname,users=USERS.exec(path),identity=users?null:IDENTITY.exec(path);if(!users&&!identity)return;
 const moved=await movedLookup(env,users?{handle:users[1]}:{sub:identity[1]});if(!moved)return;
 const delegation=DELEGATION.exec(path);
 if(delegation){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD'});
  if(!isJkt(delegation[2]))return json({error:'invalid_request',message:'Choose a valid key thumbprint.'},400);
  const result={status:'revoked',revokedHour:Math.floor(moved.committedAt/HOUR),final:true};
  return new Response(request.method==='HEAD'?null:JSON.stringify({status:result.status,revokedHour:result.revokedHour}),{headers:{...privateHeaders,'X-Robots-Tag':'noindex, nofollow','Content-Type':'application/json','Cache-Control':statusCacheControl(result)}});
 }
 return movedResponse(request,moved,{iss:env.APP_ORIGIN,document:Boolean(identity)})??undefined;
}

// ---- move endpoint (spec §5.2) ----------------------------------------------------------------------------------

const moveHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const refused=()=>json({status:'refused'},409,moveHeaders);
async function moveBudget(request,env,local){
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret||typeof env.ABUSE?.consume!=='function')return local?null:json({error:'temporarily_unavailable'},503,{...moveHeaders,'Retry-After':'60'});
 const ip=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');
 for(const [scope,value,limit]of [['ip',ip,60],['network',subnet(ip),240]])if(!await env.ABUSE.consume(`transfer-move:${scope}:${await pseudonym(value,secret)}`,{windowMs:60000,limit}))return json({error:'rate_limited'},429,{...moveHeaders,'Retry-After':'60'});
 return null;
}
async function moveRoute({request,env,local}){
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{...moveHeaders,Allow:'POST'});
 const mounted=flagGlobal(env,TRANSFER_FLAG);
 const limited=await moveBudget(request,env,local);if(limited)return limited;
 let input;try{input=await body(request,16384);}catch{return refused();}
 if(!input||typeof input!=='object'||Object.keys(input).some(name=>!['v','statement','transfer','redirect_base'].includes(name))||input.v!==1||typeof input.statement!=='string'||typeof input.redirect_base!=='string'||!(input.transfer===null||typeof input.transfer==='string'))return refused();
 let sub;try{sub=parseMoveStatement(input.statement).payload.sub;}catch{return refused();}
 let account;try{account=await env.IDENTITY_REPOSITORY?.get(sub);}catch{return json({error:'temporarily_unavailable'},503,{...moveHeaders,'Retry-After':'60'});}
 // A committed move answers from the identity's moved record (kept at least 30 days and through the redirect), so a
 // lost response never strands it, even after the account's own record was purged (IP-R1-L4).
 const moved=account?.status==='moved'?account.moved:null;
 if(moved&&moved.statement===input.statement&&(moved.boundRedirectBase??moved.redirectBase)===input.redirect_base&&movedWindow(moved,clockOf(env)).proof)return json({status:'attested',attestation:moved.attestation,redirect_until:Number.isSafeInteger(moved.redirectUntil)?Math.floor(moved.redirectUntil/1000):null},200,moveHeaders);
 if(!mounted)return json({error:'not_found'},404,moveHeaders);
 if(account?.status!=='active')return refused();
 let result;try{result=await accountHandle(env,sub).transferOutStatement(sub,{statement:input.statement,transfer:input.transfer,redirect_base:input.redirect_base});}catch(error){if(['temporarily_unavailable','transfer_unavailable','lifecycle_unavailable'].includes(error?.code))return json({error:'temporarily_unavailable'},503,{...moveHeaders,'Retry-After':'60'});return refused();}
 if(result?.status==='attested')return json({status:'attested',attestation:result.attestation,redirect_until:result.redirect_until},200,moveHeaders);
 if(result?.status==='pending')return json({status:'pending',authorize_url:result.authorize_url,retry_after:result.retry_after},202,moveHeaders);
 if(result?.status==='unavailable')return json({error:'temporarily_unavailable'},503,{...moveHeaders,'Retry-After':'3600'});
 return refused();
}

// ---- owner and credentialless adapters -------------------------------------------------------------------------

/** Session evidence for the engine: the session's age and passkey (known-device disputes) and its step-up time. Never
 * returns identity secrets. The engine decides what each operation needs. */
export class TransferEvidence extends Query{
 static deps=['identity'];constructor(context){super();this.context=context;}
 async fetch({identity}){
  const {account,session}=await identity.authorized({...this.context,requireCurrentTerms:false},true);
  const credential=account.credentials.find(entry=>entry.id===session.credentialId);
  // `stepUpCredentialId`: the credential that confirmed the step-up (P17 compares it), beside the sign-in credential.
  const used=session.stepUpCredential,stepUpCredentialId=used?.kind==='passkey'&&typeof used.id==='string'?used.id:used?.kind==='password'?'password':null;
  return {owner:account.id,stepUpAt:Number.isSafeInteger(session.stepUpAt)?session.stepUpAt:null,sessionId:await identity.sessionID(session),sessionCreatedAt:session.createdAt,...credential?{credentialId:credential.id,credentialCreatedAt:credential.createdAt}:{},...stepUpCredentialId?{stepUpCredentialId}:{}};
 }
}
function originGuard(request,env){if(new URL(request.url).origin!==env.APP_ORIGIN||request.headers.get('Origin')!==env.APP_ORIGIN||['cross-site','same-site'].includes(request.headers.get('Sec-Fetch-Site')))throw Object.assign(new Error('Reload the account page before continuing.'),{code:'csrf',status:403});}
async function publicBudget(request,env,local,action){
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret||typeof env.ABUSE?.consume!=='function')return local?null:json({error:'transfer_unavailable'},503);
 const ip=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');
 for(const [scope,value,limit]of [['ip',ip,10],['network',subnet(ip),40]])if(!await env.ABUSE.consume(`transfer-${action}:${scope}:${await pseudonym(value,secret)}`,{windowMs:60000,limit}))return json({error:'rate_limited',message:'Please wait before trying again.'},429,{'Retry-After':'60'});
 return null;
}
const invalidLink=()=>json({error:'invalid_token',message:'This link is no longer valid.'},400);
async function publicAction({request,env,url,local},action){
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
 originGuard(request,env);if(url.search||request.headers.get('X-Bindle-Transfer')!=='1')return json({error:'csrf'},403);
 const limited=await publicBudget(request,env,local,action);if(limited)return limited;
 const input=await body(request,8192);if(!isUUID(input?.owner))return action==='link'?invalidLink():json({error:'recovery_invalid',message:'This recovery file cannot authorize a move.'},400);
 const {owner,...rest}=input,object=accountHandle(env,owner);
 let account;try{account=await env.IDENTITY_REPOSITORY.get(owner);}catch{return json({error:'transfer_unavailable'},503);}
 if(account?.status!=='active')return action==='link'?invalidLink():json({error:'recovery_invalid',message:'This recovery file cannot authorize a move.'},400);
 try{
  if(action==='link')return json(await object.transferOutDispute(owner,{token:rest.token,choice:rest.choice},{kind:'dispute-link'}));
  if(action==='withdraw')return json(await object.transferOutCancel(owner,{recoveryToken:rest.recoveryToken},{kind:'credential'}));
  if(!routeFlags(env,{subject:{kind:'account',owner}}).enabled(TRANSFER_FLAG))return json({error:'not_found'},404);
  return json(await object.transferOutAuthorizeWaiting(owner,rest));
 }catch(error){if(action==='link'&&['invalid_token','not_found','forbidden','account_deleted','account_deleting','invalid_request'].includes(error?.code))return error.code==='invalid_request'?json({error:'invalid_request'},400):invalidLink();throw error;}
}
async function ownerAction({request,env,path,url,engine,context,id,object,owner}){
 if(url.search)return json({error:'invalid_request',message:'Unsupported transfer request.'},400);
 if(path===ROOT){if(request.method!=='GET')return json({error:'method_not_allowed'},405,{Allow:'GET'});const status=await object.transferOutStatus(id);if(status?.state==='none'&&!routeFlags(env,{subject:{kind:'account',owner:id}}).enabled(TRANSFER_FLAG))return json({error:'not_found'},404);if(status?.state==='committed'){const cap=await redirectCapability(env,await env.IDENTITY_REPOSITORY.get(id));return json({...status,redirectPage:cap?'/moved/'+cap:null});}return json(status);}
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
 if(typeof context.csrfToken!=='string'||context.csrfToken!==owner.csrfToken)return json({error:'csrf'},403);
 const action=path.slice(ROOT.length+1),input=await body(request,8192),evidence=await engine.query(new TransferEvidence(context)).peek();
 if(evidence.owner!==id)return json({error:'account_context_conflict',message:'Reload the account chooser before continuing.'},409);
 const call={begin:'transferOutBegin',authorize:'transferOutAuthorize',cancel:'transferOutCancel',dispute:'transferOutDispute',elevate:'transferOutElevate','restart-choice':'transferOutRestartChoice'}[action];
 return json(await object[call](id,input,{kind:'owner',...evidence}));
}

let parsedKeys={source:undefined,set:null};
function attestationKeysRoute({request,env}){
 if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD'});
 const source=env.IDENTITY_ATTESTATION_KEYS??env.IDENTITY_ATTESTATION_KEY;
 if(parsedKeys.source!==source)parsedKeys={source,set:parseAttestationKeySet(source)};
 const jwks=publishedAttestationJwks(parsedKeys.set);
 if(!jwks)return json({error:'not_found'},404,{'Cache-Control':'no-store'});
 return new Response(request.method==='HEAD'?null:JSON.stringify(jwks),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
export function allowedMethods(path){
 if(path===MOVE_PATH)return ['POST'];if(path===ATTESTATION_KEYS_PATH)return ['GET','HEAD'];if(path===ROOT)return ['GET'];
 if(path.startsWith(ROOT+'/')&&[...OWNER_ACTIONS,...PUBLIC_ACTIONS].includes(path.slice(ROOT.length+1)))return ['POST'];
 return null;
}
export const admission={exempt:path=>path===ROOT||path.startsWith(ROOT+'/')};
export const stages={
 edge:redirectRoute,
 async public(route){if(route.path===MOVE_PATH)return moveRoute(route);if(route.path===ATTESTATION_KEYS_PATH)return attestationKeysRoute(route);},
 async unauthenticated(route){const action=route.path.startsWith(ROOT+'/')?route.path.slice(ROOT.length+1):null;if(PUBLIC_ACTIONS.includes(action))return publicAction(route,action);},
 async beforeActivity(route){const {path}=route;if(path===ROOT||path.startsWith(ROOT+'/')&&OWNER_ACTIONS.includes(path.slice(ROOT.length+1)))return ownerAction(route);},
};
