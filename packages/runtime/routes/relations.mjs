// ORG-10f public relation surfaces (spec docs/spec/organizations.md §9.4, §9.5, §9.9, §14; design §8b.10). Thin: parse,
// rate-limit, call the organization's account slice (packages/runtime/account/relations.mjs), serialize. Provisional
// (coordinator), not signed off by the user. Registered before `memberCertificates` and `federation`, because it answers
// a subset of their paths (entity certificates on /oauth/token and two authorization schemes on /bindle/rpc).
//
//   POST /bindle/rpc   `Authorization: BindleEntity <entity certificate>` + DPoP (ath = the certificate): the direct
//                      form; or `Authorization: DPoP rel1.<org>.<secret>` + DPoP: a relation access token from the
//                      token form. relations.authorize at the grantor organization answers its ONE failure (401
//                      invalid_token) unchanged, then the storage dispatch runs under the composed scope.
//   POST /oauth/token  grant_type=jwt-bearer whose assertion is an entity certificate (typ bindle-entity-certificate+jwt):
//                      the token form's exchange (spec §7.1). Every failure is exactly 400 invalid_grant, no-store.
//   POST /relations/accept   the accept landing (a top-level form POST of the link alone, spec §9.4): accepts nothing;
//                      303 to the console's acceptance page with the link in the URL fragment (never logged by servers).
//   POST /relations/join     the join endpoint (foreign redemptions, ORG-11): only with ORG_FOREIGN_RELATIONS_ENABLED for
//                      the inviting organization; otherwise the uniform 404. The body is exactly {invitation, statement}:
//                      the sender comes from the verified statement, never from the body (production gate 1).
//   POST /relations/events   the events endpoint (RFC 8935 push of signed relation events); always reachable for an
//                      active local organization, so inbound revocations survive a flag ramp-down.
//                      Widening still checks flags in the engine; 202 past spec §9.9 step 1, 400 for step-1 failure.
// Same-host relations never use these HTTP endpoints: they use the account slice's same-host transport (RL-15).
// Uniform 404 (packages/runtime/public-unknown.mjs): an unknown, deleted, suspended or moved organization, and every
// surface that is not mounted, answer exactly like an unknown path. Credential failures answer their protocol refusal.
import {json,accountHandle,flagEnabled,admitSourceNetwork} from './shared.mjs';
import {lookupUnknown} from '../public-unknown.mjs';
import {localAudience} from '../account/member-certificates.mjs';
import {jwsHint} from '../account/relations.mjs';
import {inviterOf} from '../../orgs/relation-invitations.mjs';
import {JWT_BEARER} from '../../orgs/certificates.mjs';
import {readRPCRequestBytes,rpcResponse,RPCWireFault} from '../../core/rpc-wire.mjs';

const ENTITY_TYP='bindle-entity-certificate+jwt',noStore={'Cache-Control':'no-store',Pragma:'no-cache'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOUND=/^DPoP (rel1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43})$/;
const unknown=()=>json({error:'not_found'},404,noStore);
const header=value=>{try{const part=String(value??'').split('.')[0];return JSON.parse(atob(part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4)));}catch{return null;}};
const orgsOn=(env,org)=>flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:org}},true);
/** The organization is an active organization on this host (repository), else null. */
async function organization(env,org){if(!UUID.test(org??''))return null;try{const a=await env.IDENTITY_REPOSITORY?.get(org);return a?.status==='active'&&a.kind==='organization'?a:null;}catch{return null;}}
async function boundedText(request,max){const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}}
/** Per-network budget for the public relation endpoints (fails closed off loopback without an abuse store). RTC-e
 * review F5: the shared helper, refined by `CF-Worker` under a network ceiling. */
async function admit(env,request,local,name,limit){return (await admitSourceNetwork(env,request,local,`relations/${name}`,limit)).ok;}
const invalidToken=(rpc=false)=>(rpc?rpcResponse:json)({error:'invalid_token'},401,{...noStore,'WWW-Authenticate':'DPoP algs="ES256", BindleEntity'});
const RPC_STATUS={unauthorized:401,invalid_token:401,forbidden:403,not_found:404,rate_limited:429,tx_conflict:409,conflict:409,temporarily_unavailable:503,indeterminate:503};

async function rpc({request,env,local}){
 const authorization=request.headers.get('Authorization')??'';let org=null;
 if(authorization.startsWith('BindleEntity ')){const token=authorization.slice(13).trim();if(header(token)?.typ!==ENTITY_TYP)return invalidToken(true);org=localAudience(env,jwsHint(token)?.aud);}
 else{const m=BOUND.exec(authorization);if(!m)return;org=m[2];}
 if(!org||!orgsOn(env,org)||!await organization(env,org))return invalidToken(true);
 if(!await admit(env,request,local,'rpc',600))return rpcResponse({error:'rate_limited'},429,{...noStore,'Retry-After':'60'});
 // CBOR spike §4 (clean break): 415 for any other media type, 413 on encoded size, 400 for a strict-decoding refusal.
 let envelope;try{envelope=(await readRPCRequestBytes(request)).bytes;}catch(error){if(error instanceof RPCWireFault)return rpcResponse({error:error.code,message:error.message},error.status,noStore);throw error;}
 const proofs=request.headers.get('DPoP');if(!proofs||proofs.includes(','))return invalidToken(true);
 try{return rpcResponse(await accountHandle(env,org).relationsRPC(org,{authorization,dpop:proofs,envelope,htu:`${env.APP_ORIGIN}/bindle/rpc`}),200,noStore);}
 catch(error){
  if(error?.code==='invalid_token')return invalidToken(true);
  // Open divergence (CBOR spike §4.2, not widened here): thrown tx_conflict/conflict answer 409 and indeterminate 503,
  // where protocol §5 returns them in a 200 error envelope.
  const status=RPC_STATUS[error?.code]??(Number.isInteger(error?.status)&&error.status>=400&&error.status<500?error.status:400);
  return rpcResponse({error:error?.code??'invalid_request',message:error?.code?error.message:'The request could not be completed.'},status,{...noStore,...Number.isSafeInteger(error?.retryAfter)?{'Retry-After':String(error.retryAfter)}:{}});
 }
}
async function token({request,env,local}){
 if(request.method!=='POST'||request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')return;
 const text=await boundedText(request.clone(),16384);if(text===null)return;
 const params=new URLSearchParams(text);if(params.get('grant_type')!==JWT_BEARER||header(params.get('assertion'))?.typ!==ENTITY_TYP)return;
 const invalid=()=>json({error:'invalid_grant'},400,noStore),hint=jwsHint(params.get('assertion')),org=localAudience(env,hint?.aud);
 if(!org||!orgsOn(env,org)||!await organization(env,org))return invalid();
 if(!await admit(env,request,local,'token',60))return json({error:'slow_down'},429,{...noStore,'Retry-After':'60'});
 const names=[...params.keys()],proofs=request.headers.get('DPoP');
 if(new Set(names).size!==names.length||names.some(n=>!['grant_type','assertion','client_id'].includes(n))||!params.get('client_id')||!proofs||proofs.includes(','))return invalid();
 try{return json(await accountHandle(env,org).relationsToken(org,{assertion:params.get('assertion'),clientId:params.get('client_id'),dpop:proofs,htu:`${env.APP_ORIGIN}/oauth/token`}),200,noStore);}catch{return invalid();}
}
async function accept({request,env}){
 // Accepts nothing: it only carries the link to the invitee organization's console, in the fragment.
 let meta=null;if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/x-www-form-urlencoded'){const text=await boundedText(request,16384);if(text!==null)meta=new URLSearchParams(text).get('bindle_meta');}
 const claims=typeof meta==='string'&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(meta)&&meta.length<=16384?jwsHint(meta):null;
 const invitee=claims?.invitee?.iss===env.APP_ORIGIN&&UUID.test(claims?.invitee?.sub??'')?claims.invitee.sub:null;
 const location=invitee?`/console?view=organizations&org=${invitee}&tab=relationships#relation-invitation=${meta}`:'/console?view=organizations';
 return new Response(null,{status:303,headers:{Location:location,...noStore,'Referrer-Policy':'no-referrer'}});
}
async function join({request,env,local}){
 if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return unknown();
 const text=await boundedText(request,65536);let body=null;try{body=text===null?null:JSON.parse(text);}catch{body=null;}
 const inviter=typeof body?.invitation==='string'?inviterOf(jwsHint(body.invitation)):null,org=inviter?.iss===env.APP_ORIGIN?inviter.sub:null;
 if(!org||!orgsOn(env,org)||!flagEnabled(env,'ORG_FOREIGN_RELATIONS_ENABLED',{subject:{kind:'account',owner:org}},true)||!await organization(env,org))return unknown();
 if(!await admit(env,request,local,'join',60))return json({error:'rate_limited'},429,{...noStore,'Retry-After':'60'});
 try{return json(await accountHandle(env,org).relationsJoin(org,body),200,noStore);}
 catch(error){if(lookupUnknown(error))return unknown();return json({error:'invitation_invalid',message:'This invitation is invalid.'},400,noStore);}
}
async function events({request,env,local}){
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/secevent+jwt')return unknown();
 const jws=(await boundedText(request,32768))?.trim(),org=localAudience(env,jwsHint(jws)?.aud);
 // Verified inbound revocations remain reachable during every flag ramp-down. The engine refuses widening.
 if(!org||!await organization(env,org))return unknown();
 if(!await admit(env,request,local,'events',600))return json({error:'rate_limited'},429,{...noStore,'Retry-After':'60'});
 try{await accountHandle(env,org).relationsEvent(org,jws);return new Response(null,{status:202,headers:noStore});}
 catch(error){if(lookupUnknown(error))return unknown();if(error?.code==='relation_event_invalid')return json({err:'invalid_request',description:'Invalid relation event.'},400,noStore);return new Response(null,{status:202,headers:noStore});}
}

export function allowedMethods(path){return ['/relations/accept','/relations/join','/relations/events'].includes(path)?['POST']:null;}
export const stages={
 async public(ctx){const {request,path}=ctx;
  if(path==='/bindle/rpc'&&request.method==='POST')return rpc(ctx);
  if(path==='/oauth/token')return token(ctx);
  if(request.method!=='POST')return;
  if(path==='/relations/accept')return accept(ctx);
  if(path==='/relations/join')return join(ctx);
  if(path==='/relations/events')return events(ctx);
 },
};
