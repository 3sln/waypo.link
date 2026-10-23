// ORG-5 discovery for every member, not only owners (provisional coordinator work, 2026-10-23; design §9.1, ORG-D9).
//
// Membership lives only in each organization's record. A person's own account keeps hints (`orgs/joined/<org>`, plus
// the owner-of-record index), and discovery asks each hinted organization's writer, as that person, for the person's
// own membership view (`orgs.membership`). The organization answers only about the acting principal, and identically
// not_found for a non-member, an ended membership, a disabled organization or an unknown id, so:
//   - nobody but the person can list the person's organizations (the list is read with the person's own actor);
//   - a stale or invented hint discloses nothing and is simply not shown;
//   - no organization learns which other organizations the person belongs to.
// Hints are written by the acceptance adapter after the organization accepted the person, and dropped after leaving.
// The order of the result is neutral (by name, then id), never join order.
//
// Ports (route adapters over the account writers; in-memory fakes in tests):
//   person: {candidates(request) -> {owned, joined, pending}, remember(request, {org}), forget(request, {org})}
//   org:    {membership(org, request), accept(org, request, input), leave(org, request)}
// `request` is the ORG-0 actor shape the writers resolve themselves; it never carries powers.
import {Provider} from '../../vendor/ngin/index.js';
import {AppAction,AppQuery} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {actingAs,entityOf,hasPower} from './authority.mjs';
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uniform=error=>error?.code==='not_found'||error?.status===404;
export const ORG_DISCOVERY_CONCURRENCY=8;

export class OrganizationDiscovery{
 constructor({person,org,concurrency=ORG_DISCOVERY_CONCURRENCY}){Object.assign(this,{person,org,concurrency});}
 /** The person acting as themselves; discovery is never available to an organization actor or an app. */
 self(actor){
  if(actor?.kind!=='owner'||entityOf(actor).kind!=='person'||!hasPower(actor,'owner'))fail('unauthorized','Sign in to continue.',401);
  if(!this.person||!this.org)fail('organization_unavailable','Organizations are temporarily unavailable. Try again.',503);
  return {principal:{iss:actor.principal?.iss??null,sub:actor.owner},entity:{kind:'person',id:actor.owner},authTime:actor.authTime??null,epoch:actor.epoch??0,aep:actor.aep??0,...actor.verification?{verification:actor.verification}:{}};
 }
 as(request,org){if(typeof org!=='string'||!UUID.test(org))fail('invalid_request','Unsupported organization request.',400);return actingAs(request,{kind:'organization',id:org});}
 async discover(actor){
  const request=this.self(actor),{owned=[],joined=[],pending=[]}=await this.person.candidates(request)??{};
  const rows=[...owned.map(row=>({...row,owned:true})),...joined.map(row=>({id:row.id,owned:false}))].filter(row=>UUID.test(row.id??''));
  const out=new Array(rows.length);let next=0;
  const worker=async()=>{for(let i=next++;i<rows.length;i=next++){const row=rows[i];
   try{const view=await this.org.membership(row.id,this.as(request,row.id));
    out[i]={id:row.id,handle:view.organization?.handle??row.handle??null,name:view.organization?.name??null,label:view.organization?.label??null,state:view.organization?.state??null,
     role:row.owned||view.organization?.ownerOfRecord?'owner-of-record':'member',powers:[...view.powers??[]],membership:{id:view.membership?.id,hold:view.membership?.hold??null},available:true};}
   catch(error){
    // A joined hint the organization does not confirm is not shown (removed, expired, disabled or never a member).
    if(uniform(error)&&!row.owned){out[i]=null;continue;}
    out[i]={id:row.id,handle:row.handle??null,name:null,label:null,state:null,role:row.owned?'owner-of-record':'member',powers:[],membership:null,available:false};
   }
  }};
  await Promise.all(Array.from({length:Math.min(this.concurrency,rows.length)},worker));
  const organizations=out.filter(Boolean).sort((a,b)=>String(a.name??a.handle??'').localeCompare(String(b.name??b.handle??''))||a.id.localeCompare(b.id));
  return {organizations,pending:pending.map(row=>({request:row.request,id:row.id,name:row.name}))};
 }
 /** Accept an invitation at the organization, then remember the hint. The hint is best effort: membership is real once
  * the organization committed it, and the hint can be restored by accepting a later invitation. */
 async accept(actor,org,input){
  const request=this.self(actor),result=await this.org.accept(org,this.as(request,org),input);
  try{await this.person.remember(request,{org});}catch{/* the membership stands; discovery may miss it until rejoined */}
  return result;
 }
 /** Leave at the organization, then drop the hint. A not_found leave also drops it (nothing to rediscover). */
 async leave(actor,org,input={}){
  const request=this.self(actor);let result;
  try{result=await this.org.leave(org,this.as(request,org),input);}catch(error){if(uniform(error))try{await this.person.forget(request,{org});}catch{}throw error;}
  try{await this.person.forget(request,{org});}catch{}
  return result;
 }
}
export function organizationDiscoveryProvider(discovery){return class extends Provider{static deps=[];obtain(){return discovery;}release(){}};}
/** Edge operations (the routes only parse and serialize). */
export class DiscoverOrganizations extends AppQuery{static operation='orgs.discover';static deps=['organizationDiscovery'];fetch({organizationDiscovery}){return organizationDiscovery.discover(this.actor);}}
export class AcceptOrganizationInvitation extends AppAction{static operation='orgs.accept-invitation';static deps=['organizationDiscovery'];static changes='organization-changed';run({organizationDiscovery}){return organizationDiscovery.accept(this.actor,this.input?.org,{invitation:this.input?.invitation});}}
export class LeaveOrganizationEverywhere extends AppAction{static operation='orgs.leave-organization';static deps=['organizationDiscovery'];static changes='organization-changed';run({organizationDiscovery}){return organizationDiscovery.leave(this.actor,this.input?.org,{});}}
