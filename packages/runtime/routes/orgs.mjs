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
// ORG-12b/12e break-glass (design §12d.12; packages/orgs/break-glass.mjs; provisional, behind ORG_BREAK_GLASS_ENABLED):
//   GET    /api/orgs/break-glass                                     the person's own break-glass items: claims they own
//                                                                    (the interstitial), co-signature and objection items,
//                                                                    and a contest entry; every hint is confirmed by the
//                                                                    organization (orgs.breakglass). Never flag-gated.
//   GET    /api/orgs/{id}/break-glass                                the role-filtered claim view (engine-gated)
//   POST   /api/orgs/{id}/break-glass     {operation, ...}           start | accept | cosign (uniform 404 with the flag
//                                                                    off) · uncosign | withdraw | object | abort | contest
//                                                                    (never gated: the safe direction)
//   POST   /api/orgs/{id}/break-glass-checkout {claim, disclosure, confirm, plan?, currency?, locale?}  the candidate's
//                                                                    checkout; passes PaidCheckoutAllowed (routes/identity.mjs)
// ORG-10f relations (design §8b.10; packages/app/domains/relations.mjs; provisional, behind ORG_RELATIONS_ENABLED):
//   GET    /api/orgs/{id}/relations                                   admin: the Relationships tab (instances, edges both
//                                                                    ways, open invitations, inbound items, holds, imports)
//   POST   /api/orgs/{id}/relations     {operation, ...input}         widening (create | invite | accept | admit | resume |
//                                                                    rebind | upgrade | confirm-counterpart; flag + fresh step-up),
//                                                                    proposals and lookups (introduce | preview |
//                                                                    inbound-preview; flag), narrowing (withdraw | decline |
//                                                                    suspend | end | narrow | leave | mute; never gated)
//   GET    /api/orgs/{id}/relations/export                           admin: export existing relation data (never gated)
//   GET    /api/orgs/{id}/relations/imports                            imports: every import for admins, only those the
//                                                                    member holds grants on for other members (RL-13)
//   GET    /api/orgs/{id}/relations/catalogue                          admin, flag: the RL-14 catalogue
//   GET    /api/orgs/{id}/relations/resources                          admin: the organization's own grantable pool
//   POST   /api/orgs/{id}/relations/counterparty {handle}             admin, flag: resolve an organization handle
// With ORG_RELATIONS_ENABLED off for the organization, widening, proposals and lookups answer the uniform 404; reading
// existing relations, imports and every narrowing operation stay reachable, even during an ORGANIZATIONS_ENABLED
// ramp-down (the safe direction). A body is exactly {operation} plus the operation's input: anything else (a `from`
// above all) is refused by the writer; the sending organization is never taken from a request (production gate 1).
import {json,body,accountHandle,flagEnabled,privateHeaders} from './shared.mjs';
import {RELATION_ROUTE_OPERATIONS,RELATION_NARROWING} from '../../app/domains/relations.mjs';
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

const ROOT='/api/orgs',ROOT_EXTRA=/^\/api\/orgs\/(plans|checkout|break-glass)$/,ORG=/^\/api\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(audit|name|label|deletion|members|invitations|accept|leave|remove-member|member-grants|grant-decision|membership-policy|reconfirm|mute-requests|invitation-preview|invitation-revoke|membership|requests|connections|preferences|ownership|billing-checkout|transfer-recipient|transfer|claim|recovery-file|invitee|break-glass|break-glass-checkout|relations|relations\/imports|relations\/catalogue|relations\/resources|relations\/counterparty|relations\/export))?$/;
const BREAK_GLASS_ROUTE={start:'orgs.breakglass-start',accept:'orgs.breakglass-accept',cosign:'orgs.breakglass-cosign',uncosign:'orgs.breakglass-uncosign',withdraw:'orgs.breakglass-withdraw',object:'orgs.breakglass-object',abort:'orgs.breakglass-abort',contest:'orgs.breakglass-contest'};
// Start-side steps follow ORG_BREAK_GLASS_ENABLED (with ORGANIZATIONS_ENABLED) at the route too; the writer re-checks.
const BREAK_GLASS_GATED=new Set(['start','accept','cosign']);
const breakGlassOn=(env,org)=>{const ctx={subject:{kind:'account',owner:org}};return flagEnabled(env,'ORGANIZATIONS_ENABLED',ctx,true)&&flagEnabled(env,'ORG_BREAK_GLASS_ENABLED',ctx,true);};
const OPEN_CLAIM=['gathering','waiting','held-for-support','final'];
// Capacity admission never refuses the safe direction: a break-glass abort, withdrawal, co-signature withdrawal, objection
// or contest (the owner's abort above all) passes even when the host is under write pressure.
export const admission={protective:[{match:(path,method)=>method==='POST'&&/^\/api\/orgs\/[0-9a-f-]{36}\/break-glass$/.test(path),test:change=>['abort','withdraw','uncosign','object','contest'].includes(change?.operation)}]};
const TRANSFER_OPERATIONS={offer:'orgs.transfer-offer',withdraw:'orgs.transfer-withdraw',object:'orgs.transfer-object',block:'orgs.transfer-block',accept:'orgs.transfer-accept',decline:'orgs.transfer-decline'};
const organizationBilling=env=>{const injected=env.ORGANIZATION_BILLING_CLIENT;return new OrganizationBilling({config:env,client:injected&&typeof injected==='object'?injected:undefined});};
const POST_ACTIONS={name:'orgs.rename',label:'orgs.set-label',deletion:'orgs.schedule-deletion',invitations:'orgs.invite',accept:'orgs.accept',leave:'orgs.leave','remove-member':'orgs.remove-member','member-grants':'orgs.member-grants','grant-decision':'orgs.decide-grants','membership-policy':'orgs.membership-policy',reconfirm:'orgs.reconfirm','mute-requests':'orgs.mute-requests','invitation-preview':'orgs.invitation-preview','invitation-revoke':'orgs.invitation-revoke'};
export function allowedMethods(path){
 if(path===ROOT)return ['GET','POST'];const extra=ROOT_EXTRA.exec(path);if(extra)return ['plans','break-glass'].includes(extra[1])?['GET']:['POST'];const match=ORG.exec(path);if(!match)return null;
 return !match[2]?['GET']:['audit','members','membership','requests','ownership','relations/imports','relations/catalogue','relations/resources','relations/export'].includes(match[2])?['GET']:match[2]==='relations'?['GET','POST']:['connections','preferences','break-glass'].includes(match[2])?['GET','POST']:match[2]==='deletion'?['POST','DELETE']:['POST'];
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
/** Adds public handles to the principals of a break-glass claim view (initiator, candidate, co-signers). */
async function claimHandles(env,view){
 const claim=view?.claim;if(!claim||!env.IDENTITY_REPOSITORY?.get)return view;
 const tag=async p=>{if(!p||p.iss!==env.APP_ORIGIN||typeof p.sub!=='string')return p;try{const a=await env.IDENTITY_REPOSITORY.get(p.sub);return a?.status==='active'&&a.kind!=='organization'&&typeof a.handle==='string'?{...p,handle:a.handle}:p;}catch{return p;}};
 return {...view,claim:{...claim,...claim.initiator?{initiator:await tag(claim.initiator)}:{},...claim.candidate?{candidate:await tag(claim.candidate)}:{},...Array.isArray(claim.cosigners)?{cosigners:await Promise.all(claim.cosigners.slice(0,64).map(async s=>({...s,principal:await tag(s.principal)})))}:{}}};
}
/** ORG-12b/12e: the person's own break-glass items. Hints (the person's account) only route; each organization confirms
 * what this person may see and do now. At most 16 organizations; an unconfirmed hint shows nothing. */
async function breakGlassItems(env,{id,object,actor}){
 let hints=[];try{hints=(await object.orgsBreakGlassHints(id))?.hints??[];}catch{hints=[];}
 const rank={owner:0,'former-owner':1,admin:2},byOrg=new Map();
 for(const h of hints)if(!byOrg.has(h.org)||rank[h.role]<rank[byOrg.get(h.org).role])byOrg.set(h.org,h);
 const items=[];
 for(const h of [...byOrg.values()].slice(0,16)){
  let view;try{view=await accountHandle(env,h.org).orgsDispatch(h.org,{operation:'orgs.breakglass',actor:actingAs(actor,{kind:'organization',id:h.org})});}catch{continue;}
  const claim=view?.claim,open=claim&&OPEN_CLAIM.includes(claim.state),decisions=Array.isArray(view?.decisions)?view.decisions:[];
  const shown=h.role==='owner'?open&&claim.decisions?.includes('abort'):h.role==='former-owner'?decisions.includes('contest'):open&&(claim.decisions??[]).some(d=>['cosign','object','accept','pay','uncosign','withdraw'].includes(d));
  if(!shown)continue;const tagged=await claimHandles(env,view);
  items.push({org:h.org,name:view.organization?.name??null,handle:view.organization?.handle??null,role:h.role,claim:tagged.claim??null,decisions,contest:view.contest??null});
 }
 return {items};
}
/** Public handle and name of local organizations a relations view names (handles are public, directory.v1). */
async function relationNames(env,values){
 const cache=new Map(),lookup=async p=>{if(!p||p.iss!==env.APP_ORIGIN||typeof p.sub!=='string')return {handle:null,name:null};if(!cache.has(p.sub)){if(cache.size>=128)return {handle:null,name:null};cache.set(p.sub,(async()=>{try{const r=await accountHandle(env,p.sub).memberCertificateOrganizationName(p.sub);return {handle:typeof r?.handle==='string'?r.handle:null,name:typeof r?.name==='string'?r.name:null};}catch{return {handle:null,name:null};}})());}return cache.get(p.sub);};
 const tag=async(row,field,prefix=field)=>{if(!row?.[field])return row;const n=await lookup(row[field]);return {...row,[prefix+'Handle']:n.handle,[prefix+'Name']:n.name};};
 const out={...values};
 if(Array.isArray(values.instances))out.instances=await Promise.all(values.instances.map(async i=>({...i,counterparts:await Promise.all((i.counterparts??[]).map(async c=>{const n=await lookup(c.principal);return {...c,handle:n.handle,name:n.name};}))})));
 if(Array.isArray(values.invitations))out.invitations=await Promise.all(values.invitations.map(i=>tag(i,'invitee')));
 if(values.inbound){out.inbound={items:await Promise.all((values.inbound.items??[]).map(i=>tag(i,'from'))),introductions:await Promise.all((values.inbound.introductions??[]).map(async i=>tag(await tag(i,'proposer'),'candidate')))};}
 if(values.holds){out.holds={holds:await Promise.all((values.holds.holds??[]).map(h=>tag(h,'counterpart'))),unreachable:await Promise.all((values.holds.unreachable??[]).map(h=>tag(h,'counterpart')))};}
 if(Array.isArray(values.imports))out.imports=await Promise.all(values.imports.map(i=>tag(i,'grantor')));
 return out;
}
/** ORG-10f: the Relationships tab's thin adapter over relationsDispatch in the organization's writer. */
async function relationsRoute(route,match){
 const {request,env,id,object,actor}=route,org=match[1],sub=match[2],orgObject=org===id?object:accountHandle(env,org),as=actingAs(actor,{kind:'organization',id:org});
 const ctx={subject:{kind:'account',owner:org}},orgsOn=flagEnabled(env,'ORGANIZATIONS_ENABLED',ctx,true),relationsOn=orgsOn&&flagEnabled(env,'ORG_RELATIONS_ENABLED',ctx,true);
 const dispatch=(operation,input)=>orgObject.relationsDispatch(org,{operation,actor:as,...input===undefined?{}:{input}});
 if(sub==='relations'&&request.method==='GET')return json(await relationNames(env,await dispatch('relations.overview')),200,privateHeaders);
 if(sub==='relations/export'){const after=route.url?.searchParams.get('after');return json(await dispatch('relations.export',after?{after}:{}),200,privateHeaders);}
 if(sub==='relations/imports')return json(await relationNames(env,await dispatch('relations.imports',{})),200,privateHeaders);
 if(sub==='relations/resources'){if(!orgsOn)return json({error:'not_found'},404);return json(await dispatch('relations.resources'),200,privateHeaders);}
 if(sub==='relations/catalogue'){if(!relationsOn)return json({error:'not_found'},404);return json(await dispatch('relations.catalogue'),200,privateHeaders);}
 if(sub==='relations/counterparty'){
  if(!relationsOn)return json({error:'not_found'},404);
  // Handles are public (directory.v1); resolution is still offered only to an admin of this organization.
  const input=await body(request,2048),view=await call(orgObject,org,{operation:'orgs.membership',actor:as});if(!(view?.powers??[]).includes('admin'))return json({error:'not_found'},404);
  let handle;try{handle=normalizeHandle(String(input?.handle??'').trim().replace(/^@/,'').split('@')[0]);}catch{return json({error:'invalid_handle',message:'Enter a complete 3sln.me handle.'},400);}
  const account=await env.IDENTITY_REPOSITORY?.findByHandle?.(handle);
  if(!account||account.kind!=='organization'||account.status!=='active'||account.id===org||!env.APP_ORIGIN)return json({error:'counterparty_unavailable',message:'No active 3sln.me organization has that handle.'},404);
  let name=null;try{name=(await accountHandle(env,account.id).memberCertificateOrganizationName(account.id))?.name??null;}catch{name=null;}
  return json({counterparty:{iss:env.APP_ORIGIN,sub:account.id,handle:account.handle,name,identity:`${env.APP_ORIGIN}/identity/${account.id}`,origin:env.APP_ORIGIN,kind:'organization'}},200,privateHeaders);
 }
 // POST /relations {operation, ...input}
 const raw=await body(request,65536);if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.operation!=='string'||!Object.hasOwn(RELATION_ROUTE_OPERATIONS,raw.operation))return json({error:'invalid_request',message:'Unsupported relation request.'},400);
 const {operation,...input}=raw;
 if(!RELATION_NARROWING.has(operation)&&!relationsOn)return json({error:'not_found'},404);
 return json(await dispatch(RELATION_ROUTE_OPERATIONS[operation],input),200,privateHeaders);
}
export const stages={
 async owner(route){const {request,env,url,path,id,object,actor,context}=route;
  const allow=allowedMethods(path);if(!allow)return;
  const match=ORG.exec(path),extra=ROOT_EXTRA.exec(path),cancel=match?.[2]==='deletion'&&request.method==='DELETE';
  // Exit and reducing paths stay reachable during a ramp-down: leave, decisions (and the requests that drive them),
  // re-confirmation, and the organization's connections (resume and approve check the flag in the writer). Mutes are
  // stored preferences, so they follow the flag (wargame F-01): off, they answer the uniform 404 like any unknown route.
  // Withdrawing, objecting to, blocking or declining an offer, and reading the ownership view, stay reachable too (the
  // writer checks the flag for offers, acceptance and checkouts).
  // Break-glass aborts, withdrawals, objections and contests are never gated (§12d.12); start-side steps check below.
  if(match?.[2]?.startsWith('relations'))return relationsRoute(route,match);
  if(!cancel&&extra?.[1]!=='break-glass'&&!['leave','grant-decision','reconfirm','requests','connections','transfer','ownership','invitation-revoke','break-glass'].includes(match?.[2])&&!flagEnabled(env,'ORGANIZATIONS_ENABLED',{subject:{kind:'account',owner:match?.[1]??id}},true))return json({error:'not_found'},404);
  const self={principal:actor.principal,entity:actor.entity,authTime:actor.authTime,epoch:actor.epoch,aep:actor.aep??0,...actor.verification?{verification:actor.verification}:{}};
  if(extra?.[1]==='plans'){const billing=organizationBilling(env),creation=await creationEligibility(env,billing,actor);if(!billing.configured())return json({configured:false,server:null,plans:[],creation},200,privateHeaders);const currency=url?.searchParams?.get('currency')??'usd';if(!/^[a-z]{3}$/.test(currency))return json({error:'invalid_currency'},400);return json({configured:true,...await billing.plans(currency),creation},200,privateHeaders);}
  if(extra?.[1]==='break-glass')return json(await breakGlassItems(env,{id,object,actor}),200,privateHeaders);
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
  if(match[2]==='break-glass'){
   if(request.method==='GET')return json(await claimHandles(env,await call(orgObject,org,{operation:'orgs.breakglass',actor:as})),200,privateHeaders);
   const input=await body(request,8192);if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(BREAK_GLASS_ROUTE,input.operation))return json({error:'invalid_request',message:'Unsupported break-glass request.'},400);
   const {operation,...rest}=input;if(BREAK_GLASS_GATED.has(operation)&&!breakGlassOn(env,org))return json({error:'not_found'},404);
   // Tier 0 (§12d.3): a session created before the claim began is a known owner channel. The creation time comes from
   // the authenticated owner view (packages/identity/service.mjs owner()), never from the request.
   const sessionCreatedAt=(route.owner?.devices??[]).find(d=>d.current)?.createdAt,acting=operation==='abort'&&Number.isSafeInteger(sessionCreatedAt)?{...as,verification:{...as.verification??{},sessionCreatedAt}}:as;
   return json(await claimHandles(env,await call(orgObject,org,{operation:BREAK_GLASS_ROUTE[operation],actor:acting,input:rest})),200,privateHeaders);
  }
  if(match[2]==='break-glass-checkout'){if(!breakGlassOn(env,org))return json({error:'not_found'},404);return json(await call(orgObject,org,{operation:'orgs.breakglass-checkout',actor:as,input:paidInput(await body(request,4096))}),200,privateHeaders);}
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
