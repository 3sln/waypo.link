// ORG-1 owner routes (thin adapters over packages/app/domains/orgs.mjs and packages/orgs/creation.mjs). Every route
// acts through the ORG-0 actor (`route.actor`); organization routes pass `actingAs(actor, organization)` and the
// organization's account writer resolves the powers. Behind ORGANIZATIONS_ENABLED for the signed-in person, except
// cancelling a scheduled deletion, which a ramp-down must never strand.
//
//   GET    /api/orgs                       organizations the person owns or holds a live membership in, each confirmed
//                                          by the organization for this person only (ORG-5 discovery), plus pending creations
//   POST   /api/orgs                       {request, name, label?} create; the response carries the recovery file once
//   GET    /api/orgs/{id}                  the organization (any power)
//   GET    /api/orgs/{id}/audit            owner-interface audit rows, newest page (?limit=&before=)
//   GET    /api/orgs/{id}/members          admin: one page of members and requests (?limit=&after=&requestsAfter=)
//   POST   /api/orgs/{id}/name             {name, expectedRevision?}   admin
//   POST   /api/orgs/{id}/label            {label, expectedRevision?}  admin
//   POST   /api/orgs/{id}/deletion         {expectedRevision?}         owner of record, fresh authentication
//   POST   /api/orgs/{id}/invitation-preview {invitation}             the organization's name and kind for an invitation the
//                                                                     caller could accept now; anything else is the uniform 404
//   POST   /api/orgs/{id}/invitation-revoke  {invitation}             admin: withdraw an open invitation (open during a ramp-down)
//   DELETE /api/orgs/{id}/deletion                                     owner of record or admin
//   GET    /api/orgs/{id}/membership                                  ORG-5: the acting member's own view (any live member)
//   GET    /api/orgs/{id}/requests                                    ORG-5: pending requests where the member is subject,
//                                                                     requester, or owner of an elevated request
//   GET    /api/orgs/{id}/connections                                 ORG-5: the organization's app connections (admin)
//   POST   /api/orgs/{id}/connections     {operation, input}          suspend | disconnect | resume | approve (admin)
//   GET    /api/orgs/{id}/preferences                                 ORG-5: the organization's preference fragments (admin)
//   POST   /api/orgs/{id}/preferences     {fragment, values, expectedRevision}   (admin)
// Organization billing and ownership transfer (ORG-D18, ORG-D21, §12b.3a; packages/orgs/ownership.mjs; SANDBOX ONLY):
//   GET    /api/orgs/plans?currency=                                  the provisional organization plans (sandbox catalog)
//   POST   /api/orgs/checkout             {request, plan, currency?}  creation checkout for an unpaid reservation
//   GET    /api/orgs/{id}/ownership                                   billing standing, offer, claim (role-filtered)
//   POST   /api/orgs/{id}/billing-checkout {plan, currency?}          owner of record: subscribe again (lapsed/legacy)
//   POST   /api/orgs/{id}/transfer-recipient {handle}                 owner of record: resolve a handle before offering
//   POST   /api/orgs/{id}/transfer        {operation, ...}            offer | withdraw | object | block | accept | decline
//   POST   /api/orgs/{id}/claim           {plan, currency?, confirm}  admin: billing-lapse claim (§12b.3)
//   POST   /api/orgs/{id}/recovery-file                               owner of record: reissue the organization file
// Organization console support (additive, 2026-10-23 UX pass; provisional):
//   POST   /api/orgs/{id}/invitee         {handle}                    admin: resolve a 3sln.me handle to {iss, sub} for a bound invitation
//   GET    /api/orgs/plans                also answers `creation`: allowlisted | checkout | unavailable for this person
//   GET    /api/orgs/{id}/members|requests add each local principal's public handle (handles are public, directory.v1)
import {json,body,accountHandle,flagEnabled,privateHeaders} from './shared.mjs';
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {actingAs} from '../../orgs/authority.mjs';
import {OrganizationCreation,organizationCreationProvider,CreateOrganization,OrganizationRecoveryReissue,organizationRecoveryReissueProvider,ReissueOrganizationRecovery} from '../../orgs/creation.mjs';
import {OrganizationBilling} from '../../billing/organizations.mjs';
import {normalizeHandle} from '../../identity/handles.mjs';
import {organizationEntitlementPort} from '../../orgs/ownership.mjs';
import {OrganizationDiscovery,organizationDiscoveryProvider,DiscoverOrganizations,AcceptOrganizationInvitation,LeaveOrganizationEverywhere} from '../../orgs/discovery.mjs';
import {organizationIdentityPort} from '../../identity/organizations.mjs';
import {identityBackupPort} from '../identity-backup.mjs';
// Review 2026-10-23 (M3): organization checkouts and claims pass the person paid-checkout gate in the identity
// beforeActivity stage (routes/identity.mjs); its `ageConfirmed` is removed here before the writer sees the input.
const paidInput=input=>{if(!input||typeof input!=='object'||Array.isArray(input))return input;const {ageConfirmed:_,...rest}=input;return rest;};

const ROOT='/api/orgs',ROOT_EXTRA=/^\/api\/orgs\/(plans|checkout)$/,ORG=/^\/api\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(audit|name|label|deletion|members|invitations|accept|leave|remove-member|member-grants|grant-decision|membership-policy|reconfirm|mute-requests|invitation-preview|invitation-revoke|membership|requests|connections|preferences|ownership|billing-checkout|transfer-recipient|transfer|claim|recovery-file|invitee))?$/;
const TRANSFER_OPERATIONS={offer:'orgs.transfer-offer',withdraw:'orgs.transfer-withdraw',object:'orgs.transfer-object',block:'orgs.transfer-block',accept:'orgs.transfer-accept',decline:'orgs.transfer-decline'};
const organizationBilling=env=>{const injected=env.ORGANIZATION_BILLING_CLIENT;return new OrganizationBilling({config:env,client:injected&&typeof injected==='object'?injected:undefined});};
const POST_ACTIONS={name:'orgs.rename',label:'orgs.set-label',deletion:'orgs.schedule-deletion',invitations:'orgs.invite',accept:'orgs.accept',leave:'orgs.leave','remove-member':'orgs.remove-member','member-grants':'orgs.member-grants','grant-decision':'orgs.decide-grants','membership-policy':'orgs.membership-policy',reconfirm:'orgs.reconfirm','mute-requests':'orgs.mute-requests','invitation-preview':'orgs.invitation-preview','invitation-revoke':'orgs.invitation-revoke'};
export function allowedMethods(path){
 if(path===ROOT)return ['GET','POST'];const extra=ROOT_EXTRA.exec(path);if(extra)return extra[1]==='plans'?['GET']:['POST'];const match=ORG.exec(path);if(!match)return null;
 return !match[2]?['GET']:['audit','members','membership','requests','ownership'].includes(match[2])?['GET']:['connections','preferences'].includes(match[2])?['GET','POST']:match[2]==='deletion'?['POST','DELETE']:['POST'];
}
const call=async(object,owner,request)=>object.orgsDispatch(owner,request);
// Federation errors carry a code only; give them the statuses the federation HTTP adapter uses (packages/federation/http.mjs)
// so an unknown organization and a refused member both answer the uniform 404 instead of an internal error.
const FEDERATION_STATUS={unauthorized:401,invalid_token:401,rate_limited:429,consent_stale:409,stale_consent:409,csrf:403,forbidden:403,not_found:404,tx_conflict:409,temporarily_unavailable:503,account_context_conflict:409,session_context_conflict:409};
const federationFault=error=>{if(error?.status||typeof error?.code!=='string')return error;return Object.assign(error,{status:FEDERATION_STATUS[error.code]??400,...error.code==='not_found'?{message:'Not found.'}:{}});};
/** The creation sequence's ports over this deployment's account writers, identity repository and backup port. */
function creation(env){
 if(!env.IDENTITY_REPOSITORY||!env.ACCOUNTS)return null;
 const invoke=async(owner,method,args)=>{const result=await env.ACCOUNTS.get(owner).invoke({method,args:[owner,...args]});if(result?.$fault)throw Object.assign(new Error(result.$fault.message),{code:result.$fault.code,status:result.$fault.status});return result;};
 return new OrganizationCreation({issuer:env.APP_ORIGIN,identity:organizationIdentityPort(env.IDENTITY_REPOSITORY),backup:identityBackupPort({config:env,accounts:env.ACCOUNTS}),
  person:{reserve:(actor,input)=>invoke(actor.entity.id,'orgsDispatch',[{operation:'orgs.reserve',actor,input}]),payment:(actor,input)=>invoke(actor.entity.id,'orgsDispatch',[{operation:'orgs.creation-payment',actor,input}]),confirm:(owner,input)=>invoke(owner,'orgsConfirm',[input])},
  org:{initialize:async(org,input)=>invoke(org,'orgsInitialize',[{...input,addedUnder:await accountHandle(env,input.creator.sub).orgsSigningProvenance(input.creator.sub)}]),sync:org=>invoke(org,'orgsBillingSync',[])}});
}
/** ORG-5 discovery ports: the person's own writer for hints, each organization's writer for the person's own view. */
function discovery(env,{id,object}){
 return new OrganizationDiscovery({
  person:{candidates:request=>object.orgsDispatch(id,{operation:'orgs.candidates',actor:request}),remember:(request,input)=>object.orgsDispatch(id,{operation:'orgs.remember-membership',actor:request,input}),forget:(request,input)=>object.orgsDispatch(id,{operation:'orgs.forget-membership',actor:request,input})},
  org:{membership:(org,request)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.membership',actor:request}),ownership:(org,request)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.ownership',actor:request}),
   accept:async(org,request,input)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.accept',actor:{...request,addedUnder:await object.orgsSigningProvenance(id)},input}),
   leave:(org,request,input)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.leave',actor:request,input})}});
}
const discoveryEngine=route=>createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,organizationDiscovery:organizationDiscoveryProvider(discovery(route.env,route))}});
/** Whether this person may create an organization now: on the operator allowlist, by checkout (billing configured), or
 * not at all. Display only; orgs.reserve decides again. */
async function creationEligibility(env,billing,actor){
 try{const port=typeof env.ORGANIZATION_PLANS?.check==='function'?env.ORGANIZATION_PLANS:organizationEntitlementPort({allowlist:env.ORGANIZATIONS_PAID_ALLOWLIST,billing});
  if((await port.check({creator:{iss:actor?.principal?.iss??null,sub:actor?.principal?.sub},override:true}))?.paid===true)return 'allowlisted';}catch{}
 try{return billing.configured()?'checkout':'unavailable';}catch{return 'unavailable';}
}
/** Adds the public handle of each principal this host issued (members, request subjects and requesters). */
async function withHandles(env,result){
 const repo=env.IDENTITY_REPOSITORY;if(!result||typeof repo?.get!=='function'||!env.APP_ORIGIN)return result;const cache=new Map();
 const handleOf=async p=>{if(!p||p.iss!==env.APP_ORIGIN||typeof p.sub!=='string')return null;if(!cache.has(p.sub))cache.set(p.sub,Promise.resolve(repo.get(p.sub)).then(a=>a?.status==='active'&&a.kind!=='organization'&&typeof a.handle==='string'?a.handle:null,()=>null));return cache.get(p.sub);};
 const tag=async p=>{const handle=await handleOf(p);return handle?{...p,handle}:p;};
 const out={...result};
 if(Array.isArray(result.members))out.members=await Promise.all(result.members.slice(0,1000).map(async m=>({...m,principal:await tag(m.principal)})).concat(result.members.slice(1000)));
 if(Array.isArray(result.requests))out.requests=await Promise.all(result.requests.map(async q=>({...q,...q.subject?{subject:await tag(q.subject)}:{},...q.requester?{requester:await tag(q.requester)}:{}})));
 return out;
}
export const stages={
 async owner({request,env,url,path,id,object,actor,context}){
  const allow=allowedMethods(path);if(!allow)return;
  const match=ORG.exec(path),extra=ROOT_EXTRA.exec(path),cancel=match?.[2]==='deletion'&&request.method==='DELETE';
  // Exit and reducing paths stay reachable during a ramp-down: leave, decisions (and the requests that drive them),
  // re-confirmation, and the organization's connections (resume and approve check the flag in the writer). Mutes are
  // stored preferences, so they follow the flag (wargame F-01): off, they answer the uniform 404 like any unknown route.
  // Withdrawing, objecting to, blocking or declining an offer, and reading the ownership view, stay reachable too (the
  // writer checks the flag for offers, acceptance and checkouts).
  if(!cancel&&!['leave','grant-decision','reconfirm','requests','connections','transfer','ownership','invitation-revoke'].includes(match?.[2])&&!flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:match?.[1]??id}},true))return json({error:'not_found'},404);
  const self={principal:actor.principal,entity:actor.entity,authTime:actor.authTime,epoch:actor.epoch,aep:actor.aep??0,...actor.verification?{verification:actor.verification}:{}};
  if(extra?.[1]==='plans'){const billing=organizationBilling(env),creation=await creationEligibility(env,billing,actor);if(!billing.configured())return json({configured:false,server:null,plans:[],creation},200,privateHeaders);const currency=url?.searchParams?.get('currency')??'usd';if(!/^[a-z]{3}$/.test(currency))return json({error:'invalid_currency'},400);return json({configured:true,...await billing.plans(currency),creation},200,privateHeaders);}
  if(extra?.[1]==='checkout')return json(await object.orgsDispatch(id,{operation:'orgs.creation-checkout',actor:self,input:paidInput(await body(request,4096))}),200,privateHeaders);
  if(path===ROOT){
   if(request.method==='GET'){const engine=discoveryEngine({env,id,object});try{return json(await read(engine,new DiscoverOrganizations({actor})),200,privateHeaders);}finally{await engine.dispose();}}
   const input=await body(request,8192),ports=creation(env);if(!ports)return json({error:'organization_unavailable',message:'Organizations are not available on this host.'},503);
   const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,organizationCreation:organizationCreationProvider(ports)}});
   try{return json(await perform(engine,new CreateOrganization({actor,input})),200,privateHeaders);}finally{await engine.dispose();}
  }
  const org=match[1],orgObject=org===id?object:accountHandle(env,org),as=actingAs(actor,{kind:'organization',id:org});
  if(match[2]==='accept'||match[2]==='leave'){
   const input=await body(request,8192),engine=discoveryEngine({env,id,object});
   try{return json(await perform(engine,match[2]==='accept'?new AcceptOrganizationInvitation({actor,input:{org,invitation:input?.invitation}}):new LeaveOrganizationEverywhere({actor,input:{org}})),200,privateHeaders);}finally{await engine.dispose();}
  }
  if(match[2]==='ownership'){const currency=url?.searchParams?.get('currency');return json(await call(orgObject,org,{operation:'orgs.ownership',actor:as,input:currency&&/^[a-z]{3}$/.test(currency)?{currency}:{}}),200,privateHeaders);}
  if(match[2]==='transfer'){
   const input=await body(request,8192);if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(TRANSFER_OPERATIONS,input.operation))return json({error:'invalid_request',message:'Unsupported ownership request.'},400);
   const {operation,...requested}=input,rest=operation==='accept'?paidInput(requested):requested,acting=operation==='accept'?{...as,addedUnder:await object.orgsSigningProvenance(id)}:as;
   return json(await call(orgObject,org,{operation:TRANSFER_OPERATIONS[operation],actor:acting,input:rest}),200,privateHeaders);
  }
  if(match[2]==='transfer-recipient'){
   // Handles are public (directory.v1). Resolution is still offered only to an owner who may offer now.
   const input=await body(request,2048),view=await call(orgObject,org,{operation:'orgs.ownership',actor:as,input:{}});if(!view?.decisions?.includes('offer'))return json({error:'not_found'},404);
   let handle;try{handle=normalizeHandle(String(input?.handle??'').trim().replace(/^@/,''));}catch{return json({error:'invalid_handle',message:'Enter a complete 3sln.me handle.'},400);}
   const account=await env.IDENTITY_REPOSITORY?.findByHandle?.(handle);
   if(!account||account.kind==='organization'||account.status!=='active'||account.id===actor.principal.sub)return json({error:'recipient_unavailable',message:'No active 3sln.me person account has that handle.'},404);
   return json({recipient:{id:account.id,handle:account.handle,kind:'person'}},200,privateHeaders);
  }
  if(match[2]==='invitee'){
   // Bound invitations name {iss, sub}; admins type a handle. Handles are public (directory.v1); the lookup is still
   // offered only to a current admin of this organization (the organization's own membership view decides).
   const input=await body(request,2048),view=await call(orgObject,org,{operation:'orgs.membership',actor:as});if(!(view?.powers??[]).includes('admin'))return json({error:'not_found'},404);
   let handle;try{handle=normalizeHandle(String(input?.handle??'').trim().replace(/^@/,'').split('@')[0]);}catch{return json({error:'invalid_handle',message:'Enter a complete 3sln.me handle.'},400);}
   const account=await env.IDENTITY_REPOSITORY?.findByHandle?.(handle);
   if(!account||account.kind==='organization'||account.status!=='active'||!env.APP_ORIGIN)return json({error:'invitee_unavailable',message:'No active 3sln.me person account has that handle.'},404);
   return json({invitee:{iss:env.APP_ORIGIN,sub:account.id,handle:account.handle}},200,privateHeaders);
  }
  if(match[2]==='recovery-file'){
   if(!env.IDENTITY_REPOSITORY||!env.ACCOUNTS)return json({error:'organization_unavailable'},503);
   const service=new OrganizationRecoveryReissue({identity:organizationIdentityPort(env.IDENTITY_REPOSITORY),backup:identityBackupPort({config:env,accounts:env.ACCOUNTS}),
    org:{begin:(target,actorRequest)=>call(orgObject,target,{operation:'orgs.recovery-reissue-begin',actor:actorRequest,input:{}}),done:(target,actorRequest,input)=>call(orgObject,target,{operation:'orgs.recovery-reissue-done',actor:actorRequest,input})}});
   const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,organizationRecoveryReissue:organizationRecoveryReissueProvider(service)}});
   try{return json(await perform(engine,new ReissueOrganizationRecovery({actor,input:{org,request:as}})),200,privateHeaders);}finally{await engine.dispose();}
  }
  if(match[2]==='claim'||match[2]==='billing-checkout')return json(await call(orgObject,org,{operation:match[2]==='claim'?'orgs.claim-start':'orgs.billing-checkout',actor:as,input:paidInput(await body(request,4096))}),200,privateHeaders);
  if(match[2]==='connections'){
   if(request.method==='GET')return json(await orgObject.orgsConnections(org,{operation:'list',actor:as}),200,privateHeaders);
   const input=await body(request,8192);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operation','input'].includes(k))||typeof input.operation!=='string')return json({error:'invalid_request',message:'Unsupported connections request.'},400);
   return json(await orgObject.orgsConnections(org,{operation:input.operation==='list'?'':input.operation,actor:as,input:input.input}),200,privateHeaders);
  }
  if(match[2]==='preferences'){
   const authority=env.FEDERATION_AUTHORITY;if(!authority?.ready?.()||typeof authority.organizationPreferences!=='function')return json({error:'preferences_unavailable',message:'Preferences are not available on this host.'},503);
   const scoped={...context,organization:{epoch:actor.epoch??0,aep:actor.aep??0}},input=request.method==='GET'?undefined:await body(request,16384);
   try{return json(request.method==='GET'?await authority.organizationPreferences(scoped,org):await authority.organizationConfigure(scoped,org,input),200,privateHeaders);}catch(error){throw federationFault(error);}
  }
  if(request.method==='GET'){
   // Paged reads (wargame F-02, item 6): /audit?limit=&before= and /members?limit=&after=, all optional.
   const q=url?.searchParams,int=name=>{const v=q?.get(name);return v!==null&&v!==undefined&&/^\d{1,9}$/.test(v)?{[name]:Number(v)}:{};},page=match[2]==='audit'?{...int('limit'),...int('before')}:match[2]==='members'?{...int('limit'),...q?.get('after')?{after:q.get('after')}:{},...q?.get('requestsAfter')?{requestsAfter:q.get('requestsAfter')}:{}}:{};
   const result=await call(orgObject,org,{operation:{audit:'orgs.audit',members:'orgs.members',membership:'orgs.membership',requests:'orgs.requests'}[match[2]]??'orgs.get',actor:as,...Object.keys(page).length?{input:page}:{}});
   return json(['members','requests'].includes(match[2])?await withHandles(env,result):result,200,privateHeaders);
  }
  if(cancel)return json(await call(orgObject,org,{operation:'orgs.cancel-deletion',actor:as,input:{}}),200,privateHeaders);
  return json(await call(orgObject,org,{operation:POST_ACTIONS[match[2]],actor:as,input:await body(request,8192)}),200,privateHeaders);
 },
};
