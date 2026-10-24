// ORG-4 HTTP adapters (docs/spec/organizations.md §5.2, §7.1–§7.3, §14). Thin: parse, rate-limit, call the account
// slice (packages/runtime/account/member-certificates.mjs), serialize. Registered before `federation` and `delegation`.
//
//   POST /oauth/token  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, assertion, client_id + DPoP header.
//                      Answered here only for an assertion whose `aud` is an organization on this host with
//                      ORGANIZATIONS_ENABLED; everything else falls through to the existing token endpoint. Every failure
//                      is exactly 400 {"error":"invalid_grant"} with no-store (R2-H1); success is the DPoP-bound
//                      member-context token with `bindle_member` and no refresh token. Confidential-client
//                      authentication (client_assertion) is not supported yet and gets the same uniform failure.
//   GET  {identityURI}/delegations/{jkt}   member holder-key status (BindleBox §3.4 semantics) while the directory is
//                      on; a jkt this registry does not know falls through to the BindleBox route (or the unknown 404).
//   GET  /api/member-certificates                 the member's consents and holder keys (never flag-gated once readable)
//   POST /api/member-certificates/revoke          {consent} | {jkt} | {all:true}
//   GET|POST /api/member-certificates/settings/{org}   the organization's certificate lifetime (admin to change)
// The token is a federation access token in the organization's shard (packages/federation/member-access.mjs), so RPC
// uses the existing DPoP path and ORG-3's `token.member` hook. The direct form (`Authorization: BindleMember`) is the
// account method memberDirect; no RPC route mounts it yet.
import {json,body,accountHandle,flagReadable,flagEnabled,flagGlobal,pseudonym,subnet,consume,privateHeaders} from './shared.mjs';
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {InspectMemberAcquisition,AcquireMemberCertificate} from '../../app/domains/member-acquisition.mjs';
import {actingAs} from '../../orgs/authority.mjs';
import {JWT_BEARER} from '../../orgs/certificates.mjs';
import {memberStatusCacheControl} from '../../identity/member-certificates.mjs';
import {isJkt} from '../../identity/delegation.mjs';
import {localAudience} from '../account/member-certificates.mjs';

/** Consent-screen inspections and acquisitions per owner per minute. */
export const MEMBER_ACQUIRE_PER_MINUTE=30;
const STATUS=/^\/identity\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/delegations\/([^/]+)$/;
const SETTINGS=/^\/api\/member-certificates\/settings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const noStore={'Cache-Control':'no-store',Pragma:'no-cache'},publicHeaders={'X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
const invalidGrant=extra=>json({error:'invalid_grant'},400,{...noStore,...extra});
const decode=segment=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(segment.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-segment.length%4)%4)),c=>c.charCodeAt(0))));}catch{return null;}};
/** Routing hints from an UNVERIFIED assertion (never trusted): the audience organization and the client origin. */
function hints(assertion){const parts=typeof assertion==='string'&&assertion.length<=8192?assertion.split('.'):[];const payload=parts.length===3?decode(parts[1]):null;return {aud:typeof payload?.aud==='string'?payload.aud:null,origin:typeof payload?.client?.origin==='string'?payload.client.origin:null};}
const formRequest=request=>request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/x-www-form-urlencoded';
async function boundedText(request,max){const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}}

async function token({request,env,local}){
 if(request.method!=='POST'||!formRequest(request))return;
 const text=await boundedText(request.clone(),16384);if(text===null)return;
 const params=new URLSearchParams(text);if(params.get('grant_type')!==JWT_BEARER)return;
 const {aud,origin}=hints(params.get('assertion')),org=localAudience(env,aud);
 if(!org||!flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:org}},true))return;
 const cors=origin&&request.headers.get('Origin')===origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{};
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY,remote=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');
 let network='local';
 if(secret&&typeof env.ABUSE?.consume==='function'){
  const ip=await pseudonym(remote,secret);network=await pseudonym(subnet(remote),secret);
  if(!await consume(env,`member-token/ip/${ip}`,60000,30)||!await consume(env,`member-token/subnet/${network}`,60000,200))return json({error:'slow_down'},429,{...noStore,...cors,'Retry-After':'60'});
 }else if(!local)return json({error:'temporarily_unavailable'},503,{...noStore,...cors});
 const names=[...params.keys()],proofs=request.headers.get('DPoP');
 if(new Set(names).size!==names.length||names.some(name=>!['grant_type','assertion','client_id'].includes(name))||!params.get('client_id')||!proofs||proofs.includes(','))return invalidGrant(cors);
 try{
  // Step 1 (the organization's writer): certificate, proof, membership, epoch and connection, uniformly.
  const admitted=await accountHandle(env,org).memberTokenAdmit(org,{assertion:params.get('assertion'),clientId:params.get('client_id'),dpop:proofs,htu:`${env.APP_ORIGIN}/oauth/token`,network});
  // Step 2 (the organization's federation shard): the DPoP-bound access token carrying ORG-3's `token.member`.
  if(typeof env.FEDERATION_AUTHORITY?.memberAccess!=='function')return invalidGrant(cors);
  const minted=await env.FEDERATION_AUTHORITY.memberAccess(org,{clientId:admitted.context.client.client_id,jkt:admitted.context.jkt,expiresAt:admitted.exp*1000,connection:admitted.connection,member:admitted.member,...Number.isSafeInteger(admitted.capacity)?{capacity:admitted.capacity}:{}});
  if(minted?.token_type!=='DPoP'||typeof minted.access_token!=='string')return invalidGrant(cors);
  return json({access_token:minted.access_token,token_type:'DPoP',expires_in:Math.min(minted.expires_in,admitted.expiresIn),bindle_member:admitted.bindle_member},200,{...noStore,...cors});
 }catch{return invalidGrant(cors);}
}
async function status({request,env,path,local}){
 const match=STATUS.exec(path);if(!match||!flagGlobal(env,'DIRECTORY_ENABLED'))return;
 if(!['GET','HEAD'].includes(request.method))return;
 const [,subject,jkt]=match;if(!isJkt(jkt))return;
 const answer=(value,code,extra)=>new Response(request.method==='HEAD'?null:JSON.stringify(value),{status:code,headers:{...privateHeaders,...publicHeaders,'Content-Type':'application/json',...extra}});
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;
 if(!secret||typeof env.ABUSE?.consume!=='function'){if(!local)return answer({error:'delegation_unavailable'},503,{'Cache-Control':'no-store','Retry-After':'60'});}
 else{const ip=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');if(!await consume(env,`member-status:${await pseudonym(subnet(ip),secret)}`,60000,600)||!await consume(env,`member-status-subject:${await pseudonym(subject,secret)}`,60000,1200))return answer({error:'rate_limited'},429,{'Cache-Control':'no-store','Retry-After':'60'});}
 let result;
 try{const account=await env.IDENTITY_REPOSITORY?.get(subject);result=account?.status==='active'?await accountHandle(env,subject).memberCertificateStatus(subject,jkt):null;}
 catch(error){if(error?.code==='member_certificates_unavailable')return answer({error:'delegation_unavailable'},503,{'Cache-Control':'no-store','Retry-After':'60'});result=null;}
 const known=result?.status==='active'||Number.isSafeInteger(result?.revokedHour);
 if(!known){if(flagReadable(env,'BINDLEBOX_ENABLED',true))return;return answer({error:'not_found'},404,{'Cache-Control':'no-store'});}
 return answer(result.status==='active'?{status:'active'}:{status:'revoked',revokedHour:result.revokedHour},200,{'Cache-Control':memberStatusCacheControl(result)});
}

export const admission={exempt:path=>path==='/api/member-certificates/revoke'};
export function allowedMethods(path){return path==='/api/member-certificates/acquire'?['GET','POST']:path==='/api/member-certificates'?['GET']:path==='/api/member-certificates/revoke'?['POST']:SETTINGS.test(path)?['GET','POST']:null;}
export const stages={
 async public(ctx){if(ctx.path==='/oauth/token')return token(ctx);if(STATUS.test(ctx.path))return status(ctx);},
 async owner({request,env,path,id,object,actor}){
  if(!allowedMethods(path))return;
  if(path==='/api/member-certificates/acquire'){
   const enabled=clientId=>flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:id},client:{clientId}},true)&&flagEnabled(env,'MEMBER_CERTIFICATES_ENABLED',{subject:{kind:'account',owner:id},client:{clientId}},true);
   if(!['GET','POST'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, POST'});
   // Wargame 2026-10-23 F1: a per-owner limit (each inspection may warm the directory for a foreign audience).
   const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;
   if(secret&&typeof env.ABUSE?.consume==='function'&&!await consume(env,`member-acquire/owner/${await pseudonym(id,secret)}`,60000,MEMBER_ACQUIRE_PER_MINUTE))return json({error:'rate_limited'},429,{...privateHeaders,'Retry-After':'60'});
   const directory=env.FEDERATION_AUTHORITY?.directory,clients=env.FEDERATION_AUTHORITY?.clients??[];
   const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:{issuer:env.APP_ORIGIN,allowLoopback:env.LOCAL_DEVELOPMENT==='true',enabled},federationStore:{resolve:clientId=>directory?.resolve(clientId)??clients.find(c=>c.id===clientId)},organizations:{describe:aud=>typeof object?.memberCertificateOrganization==='function'?object.memberCertificateOrganization(id,aud):null},accounts:{get:owner=>owner===id?object:accountHandle(env,owner)}}});
   try{
    if(request.method==='GET'){const input=Object.fromEntries(new URL(request.url).searchParams);return json(await read(engine,new InspectMemberAcquisition({actor:{kind:'owner',owner:id},input})),200,privateHeaders);}
    if(request.headers.get('Origin')!==env.APP_ORIGIN)return json({error:'invalid_origin'},403,privateHeaders);
    return json(await perform(engine,new AcquireMemberCertificate({actor:{kind:'owner',owner:id},input:await body(request,8192)})),200,privateHeaders);
   }finally{await engine.dispose();}
  }
  if(!flagReadable(env,'MEMBER_CERTIFICATES_ENABLED',true)&&!flagReadable(env,'ORGANIZATIONS_ENABLED',true))return;
  if(path==='/api/member-certificates'){if(request.method!=='GET')return json({error:'method_not_allowed'},405,{Allow:'GET'});return json(await object.memberCertificatesList(id),200,privateHeaders);}
  if(path==='/api/member-certificates/revoke'){if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});return json(await object.memberCertificatesRevoke(id,await body(request,4096)),200,privateHeaders);}
  const org=SETTINGS.exec(path)[1];
  if(!flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:id}},true))return json({error:'not_found'},404);
  const as=actingAs(actor,{kind:'organization',id:org}),orgObject=org===id?object:accountHandle(env,org);
  if(request.method==='GET')return json(await orgObject.memberCertificateSettingsDispatch(org,{operation:'orgs.certificate-settings',actor:as}),200,privateHeaders);
  if(request.method==='POST')return json(await orgObject.memberCertificateSettingsDispatch(org,{operation:'orgs.set-certificate-settings',actor:as,input:await body(request,1024)}),200,privateHeaders);
  return json({error:'method_not_allowed'},405,{Allow:'GET, POST'});
 },
};
