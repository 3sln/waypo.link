// ORG-1 owner routes (thin adapters over packages/app/domains/orgs.mjs and packages/orgs/creation.mjs). Every route
// acts through the ORG-0 actor (`route.actor`); organization routes pass `actingAs(actor, organization)` and the
// organization's account writer resolves the powers. Behind ORGANIZATIONS_ENABLED for the signed-in person, except
// cancelling a scheduled deletion, which a ramp-down must never strand.
//
//   GET    /api/orgs                       organizations the person owns or holds a live membership in, each confirmed
//                                          by the organization for this person only (ORG-5 discovery), plus pending creations
//   POST   /api/orgs                       {request, name, label?} create; the response carries the recovery file once
//   GET    /api/orgs/{id}                  the organization (any power)
//   GET    /api/orgs/{id}/audit            owner-interface audit rows
//   POST   /api/orgs/{id}/name             {name, expectedRevision?}   admin
//   POST   /api/orgs/{id}/label            {label, expectedRevision?}  admin
//   POST   /api/orgs/{id}/deletion         {expectedRevision?}         owner of record, fresh authentication
//   DELETE /api/orgs/{id}/deletion                                     owner of record or admin
//   GET    /api/orgs/{id}/membership                                  ORG-5: the acting member's own view (any live member)
//   GET    /api/orgs/{id}/requests                                    ORG-5: pending requests where the member is subject,
//                                                                     requester, or owner of an elevated request
//   GET    /api/orgs/{id}/connections                                 ORG-5: the organization's app connections (admin)
//   POST   /api/orgs/{id}/connections     {operation, input}          suspend | disconnect | resume | approve (admin)
//   GET    /api/orgs/{id}/preferences                                 ORG-5: the organization's preference fragments (admin)
//   POST   /api/orgs/{id}/preferences     {fragment, values, expectedRevision}   (admin)
import {json,body,accountHandle,flagEnabled,privateHeaders} from './shared.mjs';
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {actingAs} from '../../orgs/authority.mjs';
import {OrganizationCreation,organizationCreationProvider,CreateOrganization} from '../../orgs/creation.mjs';
import {OrganizationDiscovery,organizationDiscoveryProvider,DiscoverOrganizations,AcceptOrganizationInvitation,LeaveOrganizationEverywhere} from '../../orgs/discovery.mjs';
import {organizationIdentityPort} from '../../identity/organizations.mjs';
import {identityBackupPort} from '../identity-backup.mjs';

const ROOT='/api/orgs',ORG=/^\/api\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(audit|name|label|deletion|members|invitations|accept|leave|remove-member|member-grants|grant-decision|membership-policy|reconfirm|mute-requests|membership|requests|connections|preferences))?$/;
const POST_ACTIONS={name:'orgs.rename',label:'orgs.set-label',deletion:'orgs.schedule-deletion',invitations:'orgs.invite',accept:'orgs.accept',leave:'orgs.leave','remove-member':'orgs.remove-member','member-grants':'orgs.member-grants','grant-decision':'orgs.decide-grants','membership-policy':'orgs.membership-policy',reconfirm:'orgs.reconfirm','mute-requests':'orgs.mute-requests'};
export function allowedMethods(path){
 if(path===ROOT)return ['GET','POST'];const match=ORG.exec(path);if(!match)return null;
 return !match[2]?['GET']:['audit','members','membership','requests'].includes(match[2])?['GET']:['connections','preferences'].includes(match[2])?['GET','POST']:match[2]==='deletion'?['POST','DELETE']:['POST'];
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
  person:{reserve:(actor,input)=>invoke(actor.entity.id,'orgsDispatch',[{operation:'orgs.reserve',actor,input}]),confirm:(owner,input)=>invoke(owner,'orgsConfirm',[input])},
  org:{initialize:async(org,input)=>invoke(org,'orgsInitialize',[{...input,addedUnder:await accountHandle(env,input.creator.sub).orgsSigningProvenance(input.creator.sub)}])}});
}
/** ORG-5 discovery ports: the person's own writer for hints, each organization's writer for the person's own view. */
function discovery(env,{id,object}){
 return new OrganizationDiscovery({
  person:{candidates:request=>object.orgsDispatch(id,{operation:'orgs.candidates',actor:request}),remember:(request,input)=>object.orgsDispatch(id,{operation:'orgs.remember-membership',actor:request,input}),forget:(request,input)=>object.orgsDispatch(id,{operation:'orgs.forget-membership',actor:request,input})},
  org:{membership:(org,request)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.membership',actor:request}),
   accept:async(org,request,input)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.accept',actor:{...request,addedUnder:await object.orgsSigningProvenance(id)},input}),
   leave:(org,request,input)=>accountHandle(env,org).orgsDispatch(org,{operation:'orgs.leave',actor:request,input})}});
}
const discoveryEngine=route=>createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,organizationDiscovery:organizationDiscoveryProvider(discovery(route.env,route))}});
export const stages={
 async owner({request,env,path,id,object,actor,context}){
  const allow=allowedMethods(path);if(!allow)return;
  const match=ORG.exec(path),cancel=match?.[2]==='deletion'&&request.method==='DELETE';
  // Exit and reducing paths stay reachable during a ramp-down: leave, decisions (and the requests that drive them),
  // re-confirmation, mutes, and the organization's connections (resume and approve check the flag in the writer).
  if(!cancel&&!['leave','grant-decision','reconfirm','mute-requests','requests','connections'].includes(match?.[2])&&!flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:match?.[1]??id}},true))return json({error:'not_found'},404);
  const self={principal:actor.principal,entity:actor.entity,authTime:actor.authTime,epoch:actor.epoch,aep:actor.aep??0,...actor.verification?{verification:actor.verification}:{}};
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
  if(request.method==='GET')return json(await call(orgObject,org,{operation:{audit:'orgs.audit',members:'orgs.members',membership:'orgs.membership',requests:'orgs.requests'}[match[2]]??'orgs.get',actor:as}),200,privateHeaders);
  if(cancel)return json(await call(orgObject,org,{operation:'orgs.cancel-deletion',actor:as,input:{}}),200,privateHeaders);
  return json(await call(orgObject,org,{operation:POST_ACTIONS[match[2]],actor:as,input:await body(request,8192)}),200,privateHeaders);
 },
};
