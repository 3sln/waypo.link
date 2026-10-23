// ORG-1 owner routes (thin adapters over packages/app/domains/orgs.mjs and packages/orgs/creation.mjs). Every route
// acts through the ORG-0 actor (`route.actor`); organization routes pass `actingAs(actor, organization)` and the
// organization's account writer resolves the powers. Behind ORGANIZATIONS_ENABLED for the signed-in person, except
// cancelling a scheduled deletion, which a ramp-down must never strand.
//
//   GET    /api/orgs                       organizations the person is owner of record of (and pending creations)
//   POST   /api/orgs                       {request, name, label?} create; the response carries the recovery file once
//   GET    /api/orgs/{id}                  the organization (any power)
//   GET    /api/orgs/{id}/audit            owner-interface audit rows
//   POST   /api/orgs/{id}/name             {name, expectedRevision?}   admin
//   POST   /api/orgs/{id}/label            {label, expectedRevision?}  admin
//   POST   /api/orgs/{id}/deletion         {expectedRevision?}         owner of record, fresh authentication
//   DELETE /api/orgs/{id}/deletion                                     owner of record or admin
import {json,body,accountHandle,flagEnabled,privateHeaders} from './shared.mjs';
import {createAppEngine,perform} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {actingAs} from '../../orgs/authority.mjs';
import {OrganizationCreation,organizationCreationProvider,CreateOrganization} from '../../orgs/creation.mjs';
import {organizationIdentityPort} from '../../identity/organizations.mjs';
import {identityBackupPort} from '../identity-backup.mjs';

const ROOT='/api/orgs',ORG=/^\/api\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(audit|name|label|deletion|members|invitations|accept|leave|member-grants|grant-decision|membership-policy|reconfirm|mute-requests))?$/;
const POST_ACTIONS={name:'orgs.rename',label:'orgs.set-label',deletion:'orgs.schedule-deletion',invitations:'orgs.invite',accept:'orgs.accept',leave:'orgs.leave','member-grants':'orgs.member-grants','grant-decision':'orgs.decide-grants','membership-policy':'orgs.membership-policy',reconfirm:'orgs.reconfirm','mute-requests':'orgs.mute-requests'};
export function allowedMethods(path){
 if(path===ROOT)return ['GET','POST'];const match=ORG.exec(path);if(!match)return null;
 return !match[2]?['GET']:['audit','members'].includes(match[2])?['GET']:match[2]==='deletion'?['POST','DELETE']:['POST'];
}
const call=async(object,owner,request)=>object.orgsDispatch(owner,request);
/** The creation sequence's ports over this deployment's account writers, identity repository and backup port. */
function creation(env){
 if(!env.IDENTITY_REPOSITORY||!env.ACCOUNTS)return null;
 const invoke=async(owner,method,args)=>{const result=await env.ACCOUNTS.get(owner).invoke({method,args:[owner,...args]});if(result?.$fault)throw Object.assign(new Error(result.$fault.message),{code:result.$fault.code,status:result.$fault.status});return result;};
 return new OrganizationCreation({issuer:env.APP_ORIGIN,identity:organizationIdentityPort(env.IDENTITY_REPOSITORY),backup:identityBackupPort({config:env,accounts:env.ACCOUNTS}),
  person:{reserve:(actor,input)=>invoke(actor.entity.id,'orgsDispatch',[{operation:'orgs.reserve',actor,input}]),confirm:(owner,input)=>invoke(owner,'orgsConfirm',[input])},
  org:{initialize:async(org,input)=>invoke(org,'orgsInitialize',[{...input,addedUnder:await accountHandle(env,input.creator.sub).orgsSigningProvenance(input.creator.sub)}])}});
}
export const stages={
 async owner({request,env,path,id,object,actor}){
  const allow=allowedMethods(path);if(!allow)return;
  const match=ORG.exec(path),cancel=match?.[2]==='deletion'&&request.method==='DELETE';
  if(!cancel&&!['leave','grant-decision','reconfirm','mute-requests'].includes(match?.[2])&&!flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:match?.[1]??id}},true))return json({error:'not_found'},404);
  const self={principal:actor.principal,entity:actor.entity,authTime:actor.authTime,epoch:actor.epoch,aep:actor.aep??0,...actor.verification?{verification:actor.verification}:{}};
  if(path===ROOT){
   if(request.method==='GET')return json(await call(object,id,{operation:'orgs.list',actor:self}),200,privateHeaders);
   const input=await body(request,8192),ports=creation(env);if(!ports)return json({error:'organization_unavailable',message:'Organizations are not available on this host.'},503);
   const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,organizationCreation:organizationCreationProvider(ports)}});
   try{return json(await perform(engine,new CreateOrganization({actor,input})),200,privateHeaders);}finally{await engine.dispose();}
  }
  const org=match[1],orgObject=org===id?object:accountHandle(env,org),as=actingAs(actor,{kind:'organization',id:org});
  if(match[2]==='accept')as.addedUnder=await object.orgsSigningProvenance(id);
  if(request.method==='GET')return json(await call(orgObject,org,{operation:match[2]==='audit'?'orgs.audit':match[2]==='members'?'orgs.members':'orgs.get',actor:as}),200,privateHeaders);
  if(cancel)return json(await call(orgObject,org,{operation:'orgs.cancel-deletion',actor:as,input:{}}),200,privateHeaders);
  return json(await call(orgObject,org,{operation:POST_ACTIONS[match[2]],actor:as,input:await body(request,8192)}),200,privateHeaders);
 },
};
