// ORG-10b/10c RelationService: instances, participation, invitations, redemption, per-view arity, flood limits and mute,
// edges and imports (docs/architecture/organizations-design.md §8b.2–§8b.7, §8b.10; spec docs/spec/organizations.md §9).
// Provisional (coordinator), not signed off by the user; behind ORG_RELATIONS_ENABLED (default off, RL-1).
//
// Every operation runs in ONE organization's account single writer and commits through the organization service's
// frame (packages/orgs/memberships.mjs): powers come from the roster (an admin whose governance is held has none),
// audits are hash-chained, and admin notices queue in the same commit. There is no central host: each party's own
// store holds its own participation, counterparts and halves (spec §9.3), and parties exchange only
//   - the relation invitation (signed link, carrying the inviter's fresh participation statement),
//   - redemption {invitation, statement} → the inviter's fresh statement,
//   - relation events (edge state, edge ended, introductions, recognition), signed with the sending organization's
//     certification key, through a durable outbox (packages/orgs/relation-events.mjs, ORG-10e).
// Same-host and cross-provider relations share this one code path (RL-15). Only the ports differ:
//   transport    {offer(invitee, {meta}), retract(invitee, {jti}), redeem(inviter, {invitation, statement}),
//                 deliver(from, counterpart, jws)}; same host: dispatches to the other organization's writer
//                 (sameHostRelationTransport); ORG-11a adds the foreign transport behind ORG_FOREIGN_RELATIONS_ENABLED,
//                 delivering events only to the manifest `events_endpoint` (relation-events.mjs manifestEventDelivery).
//   counterparts {resolve(principal) -> {kind, handle?, keys:[{kid, publicJwk}], aep}} (identity signing keys, for
//                 statements and invitations); certificationKey({iss, sub, kid}) -> {publicJwk, identity?} | null,
//                 CACHE-ONLY (warmed by the background key refresh; events and entity certificates verify against it).
//   signer       (org) -> {kid, privateKey}: the entity's identity signing key (statements, invitations).
//   certification (org) -> {kid, privateKey}: the entity's certification key (relation events, entity certificates).
//   connections  {check(connection, clientId) -> boolean}: the federation connection port (the generation fence).
//   successors   {origin(principal)} (optional): the successor index; relations.observe-counterpart keeps a local view.
//   writeCapable (contract, method) -> boolean: contracts method metadata (relation-access.mjs read list by default).
//   documents    RelationDocuments.resolve(pin) (packages/orgs/relation-documents.mjs).
//   resources    (tx, id) -> {id, contracts} | null: the organization's OWN pool (federation/resource/<id>); imports are
//                never in it, which is how the composition rule holds (spec §9.7).
//
// Store (organization account):
//   rel/state                 {instances, incoming, day:{date,count}, fullNoticeDay}   RL-11 counters
//   rel/instance/<i>          participation {instance, relation, slots, state:'pending'|'live'|'left', creator}
//   rel/cp/<i>/<p>            counterpart in my view {principal, slot, as, state, grant, acceptance, peerGrant, peerAcceptance, peerAep}
//   rel/inv/<jti>             invitation I issued {meta, instance, as, slot, invitee, values, receive, state, expiresAt}
//   rel/pair/<p>              {sent:[ms], pending:jti|null}
//   rel/inbound/<jti>         inbound invitation item for my admins {meta, from, expiresAt}
//   rel/accepting/<jti>       my pending acceptance between commit and redemption
//   rel/mute/<p>, rel/doc/<digest>, rel/used/<id>, rel/seen/<p>, rel/outbox/<notBefore>/<seq>, rel/outbox-seq, rel/aep/<p>, rel/jti/<p>/<jti>
//   rel/import/…, rel/import-id/…  (packages/orgs/relation-imports.mjs); federation/resource/imp_… mirrors (relation-access.mjs)
//   rel/hold/…, rel/successor/…, rel/billing, rel/closing, rel/intro/…, rel/proof/…  (packages/orgs/relation-keys.mjs)
import {Provider} from '../../vendor/ngin/index.js';
import {AppAction,AppQuery} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {jcs,plain} from '../core/strict-json.mjs';
import {digest} from '../core/records.mjs';
import {principalKey,samePrincipal} from './grants.mjs';
import {organizationPowers} from './authority.mjs';
import {memberPowers} from './grants.mjs';
import {rosterOf} from './roster.mjs';
import {validPrincipal} from './memberships.mjs';
import {relationPin,samePin,edgeEntries,projectForSlot,slotOf} from './relation-documents.mjs';
import {participationStatements} from './relation-statements.mjs';
import {RELATION_INVITATION_DEFAULT_MS,RELATION_INVITATION_MAX_MS,RELATION_LIMITS,signRelationInvitation,parseRelationInvitation,invitationDigest,invitationAllowed,identityURI} from './relation-invitations.mjs';
import {half,bump,outgoingLive,incomingLive,requiredSatisfied,clampEntries,halfEvent,RELATION_EDGE_OPERATIONS,RELATION_EDGE_SYSTEM_OPERATIONS} from './relation-edges.mjs';
import {syncImports,holdImports,importById,importView,isImportId,IMPORT_PREFIX,RELATION_IMPORT_OPERATIONS} from './relation-imports.mjs';
import {enqueueCounterpartKeyRefresh,enqueueMemberKeyRefresh,MEMBER_REFRESH_CLAIMED} from './key-refresh.mjs';
import {K,pad,ik,party} from './relation-keys.mjs';
import {relationEventMethods,RELATION_EVENT_OPERATIONS} from './relation-events.mjs';
import {relationLifecycleMethods,RELATION_LIFECYCLE_OPERATIONS,RELATION_LIFECYCLE_SYSTEM_OPERATIONS} from './relation-lifecycle.mjs';
import {relationAccessMethods,defaultWriteCapable,RELATION_ACCESS_SYSTEM_OPERATIONS} from './relation-access.mjs';
import {relationUpgradeMethods,RELATION_UPGRADE_OPERATIONS} from './relation-upgrades.mjs';
import {scopeValid} from '../identity/entity-certificates.mjs';

export const ORG_RELATIONS_FLAG='ORG_RELATIONS_ENABLED',ORG_FOREIGN_RELATIONS_FLAG='ORG_FOREIGN_RELATIONS_ENABLED';
const DAY=86400000,OUTBOX_RETRY_MS=72*3600000,JTI_KEEP_MS=10*60000,BATCH=256,INVITATION_RETENTION_MS=30*DAY,JTI_SWEEP_BUDGET=4096;
const fail=(code='not_found',message='Not found.',status=404)=>{throw new AppFault(code,message,status);};
const invalid=()=>fail('invitation_invalid','This invitation is invalid.',400);
const pk=principalKey;
const JTI=/^[a-f0-9]{64}$/;
const titleKey=t=>String(t).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');

/** Same-host transport (RL-15): `dispatch(sub, operation, input)` performs a SYSTEM operation in the named
 * organization's own writer. Offers, retractions and redemptions carry `input.from`, the sending organization as the
 * router's own binding (adapter evidence; their payloads are signed links and statements, verified by the receiver).
 * Relation events carry no `from` at all: the receiver takes the sender from the event's verified signature (ORG-10e),
 * exactly as an event from another provider. */
export function sameHostRelationTransport({issuer,dispatch}){
 const local=p=>p?.iss===issuer;
 const call=async(to,operation,input,from)=>{if(!local(to))throw new AppFault('relation_foreign_unavailable','Cross-provider relations are not available.',503);return dispatch(to.sub,operation,{...input,from:{iss:from.iss,sub:from.sub}});};
 return Object.freeze({
  offer:(from,to,input)=>call(to,'relations.offer',input,from),
  retract:(from,to,input)=>call(to,'relations.retract',input,from),
  redeem:(from,to,input)=>call(to,'relations.redeem',input,from),
  deliver:async(from,to,jws)=>{if(!local(to))throw new AppFault('relation_foreign_unavailable','Cross-provider relations are not available.',503);return dispatch(to.sub,'relations.ingest',{event:jws});},
 });
}
/** The default own-pool resource port: the federation resource record in this organization's account store. */
export const ownResources=async(tx,id)=>{if(typeof id!=='string'||isImportId(id))return null;const r=await tx.get('federation/resource/'+id);return r&&plain(r.contracts)&&!r.imported&&!r.grantor&&r.provider!=='relation'?{id,contracts:r.contracts,...plain(r.scoping)?{scoping:r.scoping}:{}}:null;};

/** The default own-pool listing (relations.resources): own federation resource records, never imports. */
export const ownPool=async tx=>{const out=[];for(const [key,r] of await tx.list({prefix:'federation/resource/',limit:512})){const id=key.slice('federation/resource/'.length),own=await ownResources(tx,id);if(own)out.push({id,label:typeof r.label==='string'?r.label:id,contracts:structuredClone(own.contracts),...own.scoping?{scoping:structuredClone(own.scoping)}:{}});}return out;};

export class RelationService{
 constructor({organizations,documents,signer,counterparts,transport,resources=ownResources,pool=ownPool,catalogue,issuer,clock,random,acceptEndpoint,certification,connections,successors,writeCapable=defaultWriteCapable,federationSubject,brokerEndpoint,allowLoopback=false,federationEvidence=false}){
  if(!organizations?.frame||!documents?.resolve||typeof signer!=='function'||!counterparts?.resolve||!transport)throw new TypeError('RelationService needs organizations, documents, signer, counterparts and transport.');
  Object.assign(this,{orgs:organizations,documents,signer,counterparts,transport,resources,issuer:issuer??organizations.issuer,clock:clock??organizations.clock,random:random??organizations.random});
  this.acceptEndpoint=acceptEndpoint??(p=>`${p.iss}/relations/accept`);
  Object.assign(this,{certification,connections,successors,writeCapable,federationSubject,brokerEndpoint,allowLoopback,federationEvidence:federationEvidence===true,pool,catalogueEntries:typeof catalogue==='function'?catalogue:async()=>[]});
  // Review M1: the organization's commits withdraw open invitations on a pending deletion or an issuer's removal.
  (organizations.commitHooks??=[]).push((tx,r,actor)=>this.onOrganizationCommit(tx,r,actor));
  this.statements=participationStatements({signer,keys:async p=>(await this.counterparts.resolve(p))?.keys??[],clock:this.clock,random:this.random});
 }
 get metadata(){return this.orgs.metadata;}
 flag(owner,name=ORG_RELATIONS_FLAG){try{return this.orgs.flags?.for({subject:{kind:'account',owner}}).enabled(name)===true;}catch{return false;}}
 requireEnabled(actor){if(!this.flag(actor?.owner))fail();}
 self(owner){return {iss:this.issuer,sub:owner};}
 foreign(p){return p?.iss!==this.issuer;}
 /** Refuses a counterpart on another provider: ORG-11 transport is not implemented, and its kill switch defaults off. */
 requireLocal(owner,p){if(this.foreign(p))fail(this.flag(owner,ORG_FOREIGN_RELATIONS_FLAG)?'relation_foreign_unavailable':'not_found',this.flag(owner,ORG_FOREIGN_RELATIONS_FLAG)?'Cross-provider relations are not available yet.':'Not found.',this.flag(owner,ORG_FOREIGN_RELATIONS_FLAG)?503:404);}
 async resolveParty(p){let r;try{r=await this.counterparts.resolve(p);}catch{r=null;}return r;}

 // ---- frames ----------------------------------------------------------------------------------------------------
 /** Widening (create, invite, accept, resume): flag, one unheld admin, fresh step-up (RL-2). */
 widen(actor,input,names,apply){this.requireEnabled(actor);return this.orgs.frame(actor,input,names,async(r,v,now,m,tx,roster)=>{await this.requireWidenable(tx);return apply(r,v,now,m,tx,roster);},{admin:true,fresh:true});}
 /** The background key-refresh queue (packages/orgs/key-refresh.mjs): 'member' rows for recognized counterparts (the
  * background-refresh set), bounded 'claimed' rows for any claimed sender on the request path. */
 refreshQueue(tx,p,{now,source}){return source==='claimed'?enqueueMemberKeyRefresh(tx,party(p),{now,source:'claimed',cap:MEMBER_REFRESH_CLAIMED}):enqueueCounterpartKeyRefresh(tx,party(p),{now});}
 /** Narrowing (suspend, end, narrow, withdraw, decline, leave, mute): never flag-gated, open during a pending deletion,
  * one admin, ordinary authentication (RL-3). */
 narrowing(actor,input,names,apply){return this.orgs.frame(actor,input,names,apply,{admin:true,exposure:false,exit:true});}
 /** An admin read. */
 /** Refuses before any document fetch or key lookup unless the actor is an admin of this organization (review M5). */
 requireAdmin(actor){return this.adminRead(actor,()=>null);}
 async adminRead(actor,fn){return this.metadata.transaction(async tx=>{const r=await this.orgs.organization(tx,actor);if(!organizationPowers(r,actor.principal,{now:this.clock.now()}).includes('admin'))fail();return structuredClone(await fn(r,tx));});}
 /** A system step in this organization's writer (adapters build the actor from verified evidence). */
 async system(actor,apply){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const r=await this.orgs.open(tx);if(r?.kind!=='organization')fail();
   const now=this.clock.now(),before=JSON.stringify(r),out=await apply(r,now,tx);await this.orgs.finish(tx,r,before,actor,now);return structuredClone(out);
  });
 }
 async counters(tx){return (await tx.get(K.state))??{v:1,instances:0,incoming:0,day:null};}
 async enqueue(tx,r,to,events,instance,extra={}){
  const seq=((await tx.get(K.outboxSeq))??0)+1;await tx.put(K.outboxSeq,seq);
  await tx.put(K.outbox(0,seq),{...extra,seq,to:party(to),instance,events,jti:this.random.uuid(),aep:r.aep??0,createdAt:this.clock.now(),attempts:0,notBefore:0});
 }
 async emitHalf(tx,r,cp,kind){const h=kind==='grant'?cp.grant:cp.acceptance;if(h&&h.state!=='pending')await this.enqueue(tx,r,cp.principal,halfEvent(kind,h),cp.instance);}
 async docFor(tx,pin){const row=await tx.get(K.doc(pin.digest));if(row&&samePin(row.pin,pin))return row.doc;fail('relation_unavailable','This relation document is unavailable.',409);}
 async resolveDoc(pin){return this.documents.resolve(relationPin(pin));}
 /** Holders of `slot` in my view of an instance: counterparts recognized in it (live or pending), plus me if I hold it. */
 async holders(tx,part,slot){let n=part.slots.includes(slot)&&part.state!=='left'?1:0;for(const cp of (await tx.list({prefix:K.cpPrefix(part.instance)})).values())if(cp.slot===slot&&cp.state!=='ended')n++;return n;}
 async counterpartsOf(tx,instance){return [...(await tx.list({prefix:K.cpPrefix(instance)})).values()];}

 /** Validates grant values for (grantorSlot → granteeSlot): resources from the organization's own pool only, methods
  * within the entry ceiling and the resource's contracts. Returns entries, or null when nothing is granted. */
 async grantEntries(tx,doc,grantorSlot,granteeSlot,values,now){
  if(values===undefined||values===null)return null;
  const bad=()=>fail('relation_values_invalid','Choose resources from this organization for each shared entry.',400);
  if(!plain(values))bad();const entries=edgeEntries(doc,grantorSlot,granteeSlot),byIndex=new Map(entries.map(e=>[String(e.index),e]));
  if(Object.keys(values).some(k=>!byIndex.has(k)))bad();if(!Object.keys(values).length)return null;
  const out=[];
  for(const e of entries){
   const v=values[String(e.index)];if(v===undefined){if(e.required)fail('relation_values_incomplete','Every required entry needs a value.',400);continue;}
   const fields=Object.keys(e.methods);if(!Array.isArray(v)||v.length>16)bad();
   if(!fields.length){if(v.length)bad();out.push({index:e.index,resources:[]});continue;}
   if(!v.length)bad();const resources=[];
   for(const item of v){
    if(!plain(item)||Object.keys(item).some(k=>!['resource','field','methods','scope','expires_at'].includes(k)))bad();
    const field=item.field??(fields.length===1?fields[0]:undefined);if(!fields.includes(field))bad();
    if(isImportId(item.resource))fail('relation_values_invalid','Imported resources cannot be shared onward.',400);
    const own=await this.resources(tx,item.resource);if(!own||resources.some(x=>x.resource===item.resource))bad();
    const methods={};
    for(const [c,ms] of Object.entries(e.methods[field])){const has=Object.hasOwn(own.contracts,c)?own.contracts[c]:undefined;if(!Array.isArray(has))continue;const narrow=item.methods?.[c];const kept=ms.filter(m=>has.includes(m)&&(narrow===undefined||Array.isArray(narrow)&&narrow.includes(m)));if(kept.length)methods[c]=kept.sort();}
    if(item.methods!==undefined&&(!plain(item.methods)||Object.keys(item.methods).some(c=>!Object.hasOwn(methods,c))))bad();
    if(!Object.keys(methods).length)bad();
    if(item.expires_at!==undefined&&(!Number.isSafeInteger(item.expires_at)||item.expires_at<=now/1000))bad();
    // Resource scoping (ORG-10d; resource-scoping.md): {prefix?, readOnly?:true, maxObjectBytes?}, only where the resource
    // offers that control and within its bounds (as federation `configure` does). The grantor enforces it on every call
    // (relation-access.mjs edgeDecision, relation-edges.mjs relationScopeAllows) and certificates carry it.
    if(item.scope!==undefined){const sc=item.scope,options=own.scoping?.fields;
     if(!scopeValid(sc)||!plain(options)||Object.keys(sc).some(k=>!plain(options[k])||k==='prefix'&&Number.isSafeInteger(options[k].maxLength)&&sc.prefix.length>options[k].maxLength||k==='maxObjectBytes'&&Number.isSafeInteger(options[k].maximum)&&sc.maxObjectBytes>options[k].maximum))bad();}
    resources.push({resource:item.resource,field,methods,...item.scope?{scope:{...item.scope}}:{},...item.expires_at!==undefined?{expires_at:item.expires_at}:{}});
   }
   out.push({index:e.index,resources});
  }
  if(!requiredSatisfied(doc,grantorSlot,granteeSlot,out))fail('relation_values_incomplete','Every required entry needs a value.',400);
  return out.length?out:null;
 }

 // ---- documents ---------------------------------------------------------------------------------------------------
 async warnings(tx,doc,counterparty){
  const out=[];if(counterparty&&!await tx.get(K.seen(counterparty)))out.push('new-counterparty');
  if(!await tx.get(K.used(doc.id))){out.push('new-relation');for(const row of (await tx.list({prefix:'rel/used/',limit:512})).values())if(row.id!==doc.id&&titleKey(row.title)===titleKey(doc.title)){out.push('same-title-different-relation');break;}}
  return out;
 }
 /** relations.preview: the validated matrix as it applies to one slot, with lookalike warnings. */
 async preview(actor,input){
  this.requireEnabled(actor);if(!plain(input)||Object.keys(input).some(k=>!['relation','slot','counterparty'].includes(k))||input.counterparty!==undefined&&!validPrincipal(input.counterparty))fail('invalid_request','Unsupported relation request.',400);
  await this.requireAdmin(actor);const {pin,doc}=await this.resolveDoc(input.relation);
  // With a named counterparty, the "never seen before" warning is included (§8b.7 impersonation).
  return this.adminRead(actor,async(r,tx)=>({pin,matrix:projectForSlot(doc,input.slot),warnings:await this.warnings(tx,doc,input.counterparty?party(input.counterparty):null)}));
 }

 // ---- instances -----------------------------------------------------------------------------------------------------
 /** relations.create: a new instance with this organization in one or more slots (widening, step-up). */
 async create(actor,input){
  this.requireEnabled(actor);await this.requireAdmin(actor);const {pin,doc}=await this.resolveDoc(input?.relation);
  return this.widen(actor,input,['relation','slots'],async(r,v,now,m,tx)=>{
   if(!Array.isArray(v.slots)||!v.slots.length||v.slots.length>8||new Set(v.slots).size!==v.slots.length||v.slots.some(s=>!slotOf(doc,s)||!slotOf(doc,s).kinds.includes('organization')))fail('relation_slot_invalid','Choose this organization\'s slot in the relation.',400);
   const c=await this.counters(tx);if(c.instances>=RELATION_LIMITS.instances)fail('relation_limit','This organization has reached the relation limit for now.',429);
   const instance=`${this.issuer}/relations/i/${this.random.uuid()}`;
   await tx.put(K.instance(instance),{v:1,instance,relation:pin,slots:[...v.slots],state:'live',creator:true,createdAt:now});
   c.instances++;await tx.put(K.state,c);await tx.put(K.doc(pin.digest),{pin,doc});await tx.put(K.used(doc.id),{id:doc.id,title:doc.title,at:now});
   await this.orgs.audit(tx,r,'relation-instance-created',actor,{instance,relation:pin,slots:v.slots});this.orgs.notice(r,'relation-instance-created',{instance,relation:pin,slots:v.slots},now);
   return {instance,relation:pin,slots:[...v.slots]};
  });
 }
 /** relations.list: this organization's participations (its own view only). */
 list(actor){return this.adminRead(actor,async(r,tx)=>({instances:[...(await tx.list({prefix:'rel/instance/',limit:RELATION_LIMITS.instances+64})).values()].map(p=>({instance:p.instance,relation:p.relation,slots:p.slots,state:p.state}))}));}
 /** relations.catalogue (flag, admin): the 3sln.me catalogue (RL-14), "listed by 3sln.me", never a verified publisher. */
 async catalogue(actor){this.requireEnabled(actor);await this.requireAdmin(actor);return {relations:structuredClone(await this.catalogueEntries())};}
 /** relations.resources (admin): this organization's own grantable pool. Imports are never in it (spec §9.7). */
 resourcesList(actor){return this.adminRead(actor,async(r,tx)=>({resources:await this.pool(tx)}));}
 /** relations.invitations (admin): the open invitations this organization issued (withdraw from the console). */
 invitations(actor){return this.adminRead(actor,async(r,tx)=>{const now=this.clock.now(),out=[];
  for(const key of (await tx.list({prefix:'rel/inv-open/',limit:RELATION_LIMITS.inbound+64})).keys()){const inv=await tx.get(K.inv(key.slice(key.lastIndexOf('/')+1)));if(inv?.state==='open'&&inv.expiresAt>now)out.push({invitation:inv.jti,instance:inv.instance,slot:inv.slot,as:inv.as,invitee:party(inv.invitee),gives:(inv.grant??[]).map(e=>e.index),receive:inv.receive===true,createdAt:inv.createdAt,expiresAt:inv.expiresAt});}
  return {invitations:out.sort((a,b)=>a.createdAt-b.createdAt)};});}
 /** relations.overview (admin): everything the Relationships tab shows, in one read of this organization's own view. */
 overview(actor){return this.adminRead(actor,async(r,tx)=>{
  const now=this.clock.now(),instances=[];
  for(const part of (await tx.list({prefix:'rel/instance/',limit:RELATION_LIMITS.instances+64})).values()){
   const doc=(await tx.get(K.doc(part.relation.digest)))?.doc;
   instances.push({instance:part.instance,relation:part.relation,title:typeof doc?.title==='string'?doc.title:null,slots:part.slots,state:part.state,counterparts:await this.counterpartViews(tx,part,now)});
  }
  const holds=[...(await tx.list({prefix:'rel/hold/',limit:BATCH})).values()].filter(h=>h.kind==='full'||h.until>now).map(h=>({counterpart:h.principal,kind:h.kind,aep:h.aep,cause:h.cause,since:h.since,...h.until?{until:h.until}:{}}));
  const unreachable=[...(await tx.list({prefix:'rel/reach/',limit:BATCH})).values()].map(x=>({counterpart:x.principal,since:x.since,flagged:now-x.since>=30*DAY}));
  const invitations=[];for(const key of (await tx.list({prefix:'rel/inv-open/',limit:RELATION_LIMITS.inbound+64})).keys()){const inv=await tx.get(K.inv(key.slice(key.lastIndexOf('/')+1)));if(inv?.state==='open'&&inv.expiresAt>now)invitations.push({invitation:inv.jti,instance:inv.instance,slot:inv.slot,as:inv.as,invitee:party(inv.invitee),createdAt:inv.createdAt,expiresAt:inv.expiresAt});}
  const items=[...(await tx.list({prefix:'rel/inbound/',limit:RELATION_LIMITS.inbound})).values()].filter(i=>i.expiresAt>now).map(i=>({kind:'invitation',invitation:i.jti,meta:i.meta,from:i.from,instance:i.instance,relation:i.relation,slot:i.slot,receivedAt:i.receivedAt,expiresAt:i.expiresAt}));
  const introductions=[...(await tx.list({prefix:'rel/intro/',limit:RELATION_LIMITS.inbound})).values()].filter(i=>i.expiresAt>now).map(i=>({kind:'introduction',introduction:i.id,proposer:i.proposer,instance:i.instance,slot:i.slot,candidate:i.candidate,receivedAt:i.receivedAt,expiresAt:i.expiresAt}));
  const imports=[...(await tx.list({prefix:IMPORT_PREFIX,limit:512})).values()].map(row=>importView(row,now));
  return {enabled:this.flag(actor.owner),billing:await this.stage(tx),closing:await this.closing(tx),instances,invitations:invitations.sort((a,b)=>a.createdAt-b.createdAt),inbound:{items,introductions},holds:{holds,unreachable},imports};
 });}
 /** The counterpart rows of one instance as relations.get and relations.overview show them. */
 async counterpartViews(tx,part,now){
  const out=(await this.counterpartsOf(tx,part.instance)).map(cp=>({principal:party(cp.principal),slot:cp.slot,as:cp.as,state:cp.state,
   outgoing:{state:cp.grant?.state??null,generation:cp.grant?.generation??0,entries:structuredClone(cp.grant?.entries??[]),live:outgoingLive(part,cp,now),...cp.grant?.cause?{cause:cp.grant.cause}:{}},
   incoming:{state:cp.acceptance?.state??null,generation:cp.acceptance?.generation??0,live:incomingLive(part,cp)},
   peer:{grant:cp.peerGrant?.state??null,acceptance:cp.peerAcceptance?.state??null}}));
  for(const c of out){const hold=await this.activeHold(tx,c.principal,now),reach=await tx.get(K.reach(c.principal));
   if(hold)c.hold={kind:hold.kind,aep:hold.aep,cause:hold.cause,since:hold.since,...hold.until?{until:hold.until}:{}};if(reach)c.unreachable={since:reach.since,flagged:now-reach.since>=30*DAY};}
  return out;
 }
 /** relations.get: one instance in this organization's own view — counterparts it recognizes and the halves between them. */
 get(actor,input){return this.adminRead(actor,async(r,tx)=>{
  const part=typeof input?.instance==='string'?await tx.get(K.instance(input.instance)):null;if(!part)fail();const now=this.clock.now();
  return {instance:part.instance,relation:part.relation,slots:part.slots,state:part.state,counterparts:await this.counterpartViews(tx,part,now)};
 });}

 // ---- invitations ---------------------------------------------------------------------------------------------------
 /** relations.invite (widening, step-up): binds this organization's values for each entry it grants, issues a relation
  * invitation bound to the invitee and carrying a fresh participation statement, and offers it to the invitee. */
 async invite(actor,input){
  this.requireEnabled(actor);
  const invitee=input?.invitee;if(!validPrincipal(invitee))fail('invalid_request','Name the organization to invite.',400);
  this.requireLocal(actor.owner,invitee);
  if(samePrincipal(invitee,this.self(actor.owner)))fail('relation_party_invalid','An organization cannot relate to itself.',400);
  await this.requireAdmin(actor);const resolved=await this.resolveParty(invitee);if(resolved?.kind!=='organization')fail('relation_party_unsupported','Relations on 3sln.me are between organizations.',400);
  const signer=await this.signer(actor.owner);
  const out=await this.widen(actor,input,['instance','as','slot','invitee','values','receive','expiresAt'],async(r,v,now,m,tx)=>{
   const part=typeof v.instance==='string'?await tx.get(K.instance(v.instance)):null;if(part?.state!=='live')fail();
   const doc=await this.docFor(tx,part.relation),as=v.as??(part.slots.length===1?part.slots[0]:undefined);
   if(!part.slots.includes(as)||!slotOf(doc,v.slot)||!slotOf(doc,v.slot).kinds.includes('organization'))fail('relation_slot_invalid','Choose slots that are part of this relation.',400);
   if(v.receive!==undefined&&typeof v.receive!=='boolean')fail('invalid_request','Unsupported relation request.',400);
   if(await tx.get(K.cp(part.instance,invitee)))fail('relation_counterpart_exists','This organization is already part of your view of this relation.',409);
   // Arity is per view (spec §9.3): never recognize more holders of a slot than `max`.
   if(await this.holders(tx,part,v.slot)>=slotOf(doc,v.slot).arity.max)fail('relation_slot_full','Your view of this slot is full.',409);
   const grant=await this.grantEntries(tx,doc,as,v.slot,v.values,now),receive=v.receive===true&&edgeEntries(doc,v.slot,as).length>0;
   if(!grant&&!receive)fail('relation_invitation_empty','This invitation would neither share nor receive anything.',400);
   const c=await this.counters(tx),pair=(await tx.get(K.pair(invitee)))??{sent:[],pending:null};
   if(pair.pending){const open=await tx.get(K.inv(pair.pending));if(!open||open.state!=='open'||open.expiresAt<=now)pair.pending=null;}
   const refused=invitationAllowed({day:c.day,pair},now);if(refused)fail(refused,refused==='relation_invitation_pending'?'An invitation to this organization is already open.':'Too many relation invitations for now.',429);
   const expiresAt=v.expiresAt??now+RELATION_INVITATION_DEFAULT_MS;if(!Number.isSafeInteger(expiresAt)||expiresAt<=now+1000||expiresAt>now+RELATION_INVITATION_MAX_MS)fail('invalid_request','Choose an expiry within 30 days.',400);
   const jti=this.random.uuid().replaceAll('-','')+this.random.uuid().replaceAll('-',''),iat=Math.floor(now/1000),exp=Math.floor(expiresAt/1000);
   const me=this.self(r.id),statement=await this.statements.sign({org:r.id,party:me,instance:part.instance,relation:part.relation,slot:as});
   const meta=await signRelationInvitation({issuer:this.issuer,org:r.id,signer,jti,iat,exp,instance:part.instance,relation:part.relation,slot:v.slot,invitee,accept:this.acceptEndpoint(invitee),statement});
   await tx.put(K.inv(jti),{v:1,jti,meta,instance:part.instance,as,slot:v.slot,invitee:party(invitee),grant,receive,state:'open',by:party(actor.principal),createdAt:now,expiresAt:exp*1000});
   await tx.put(K.invOpen(part.instance,jti),true);await tx.put(K.invBy(actor.principal,jti),true);await tx.put(K.invDue(exp*1000,jti),true);c.openInvitations=(c.openInvitations??0)+1;
   // The offer to the invitee leaves through the outbox, so the inviter's latency never depends on the invitee's
   // state (muted, full or absent; review L5).
   await this.enqueue(tx,r,invitee,null,part.instance,{kind:'offer',meta});
   pair.sent=[...pair.sent.filter(at=>at>now-RELATION_LIMITS.pairWindowMs),now];pair.pending=jti;await tx.put(K.pair(invitee),pair);
   const today=Math.floor(now/DAY);c.day=c.day?.date===today?{date:today,count:c.day.count+1}:{date:today,count:1};await tx.put(K.state,c);
   await this.orgs.audit(tx,r,'relation-invited',actor,{instance:part.instance,invitation:jti,invitee:party(invitee),slot:v.slot,as,gives:(grant??[]).map(e=>e.index),receive});
   this.orgs.notice(r,'relation-invited',{instance:part.instance,invitation:jti,invitee:party(invitee),slot:v.slot},now);
   return {invitation:meta,jti,expiresAt:exp*1000,instance:part.instance,slot:v.slot};
  });
  return out;
 }
 /** relations.withdraw (narrowing): an unredeemed invitation is refused from now on exactly as an invalid one. */
 async withdraw(actor,input){
  const out=await this.narrowing(actor,input,['invitation'],async(r,v,now,m,tx)=>{
   const jti=typeof v.invitation==='string'&&JTI.test(v.invitation)?v.invitation:null,inv=jti?await tx.get(K.inv(jti)):null;
   if(!inv||inv.state!=='open')fail();
   await this.closeInvitation(tx,r,inv,'withdrawn',now,{actor,reason:'withdrawn'});
   return {withdrawn:true,invitation:jti};
  });
  return out;
 }
 /** Closes an open invitation (withdrawn, expired, redeemed) and its indexes; a withdrawal is retracted at the invitee
  * through the outbox. Audited and announced unless `quiet`. */
 async closeInvitation(tx,r,inv,state,now,{actor={kind:'system'},reason=state,quiet=false}={}){
  if(inv.state!=='open')return false;
  inv.state=state;inv.closedAt=now;inv[state+'At']=now;if(reason!==state)inv.reason=reason;await tx.put(K.inv(inv.jti),inv);
  await tx.delete(K.invOpen(inv.instance,inv.jti));await tx.delete(K.invBy(inv.by,inv.jti));await tx.delete(K.invDue(inv.expiresAt,inv.jti));await tx.put(K.invDone(now,inv.jti),true);
  const c=await this.counters(tx);c.openInvitations=Math.max(0,(c.openInvitations??1)-1);await tx.put(K.state,c);
  const pair=await tx.get(K.pair(inv.invitee));if(pair?.pending===inv.jti){pair.pending=null;await tx.put(K.pair(inv.invitee),pair);}
  if(state==='withdrawn')await this.enqueue(tx,r,inv.invitee,null,inv.instance,{kind:'retract',invitation:inv.jti});
  if(!quiet&&state!=='redeemed'){await this.orgs.audit(tx,r,'relation-invitation-'+state,actor,{invitation:inv.jti,instance:inv.instance,...reason!==state?{reason}:{}});this.orgs.notice(r,'relation-invitation-'+state,{invitation:inv.jti,instance:inv.instance,...reason!==state?{reason}:{}},now);}
  return true;
 }
 /**
  * The organization commit hook (installed on the membership service; runs inside every organization commit, review
  * M1). Provisional (coordinator) decision: a pending deletion withdraws every open relation invitation, and removing
  * or holding the issuing admin (no longer an unheld live admin) withdraws that admin's open invitations. Bounded per
  * commit; the sweep finishes any remainder, and redemption refuses in both cases anyway.
  */
 async onOrganizationCommit(tx,r,actor){
  if(r?.kind!=='organization')return false;
  const c=await tx.get(K.state);if(!(c?.openInvitations>0))return false;
  const now=this.clock.now();let changed=false;
  if(r.state!=='active'){for(const key of (await tx.list({prefix:'rel/inv-open/',limit:BATCH})).keys()){const inv=await tx.get(K.inv(key.slice(key.lastIndexOf('/')+1)));if(inv)changed=await this.closeInvitation(tx,r,inv,'withdrawn',now,{reason:'organization-deletion-pending'})||changed;}return changed;}
  for(const {member:m} of rosterOf(r)?.changedMembers()??[]){if(memberPowers(m,now).includes('admin'))continue;
   for(const key of (await tx.list({prefix:'rel/inv-by/'+principalKey(m.principal)+'/',limit:BATCH})).keys()){const inv=await tx.get(K.inv(key.slice(key.lastIndexOf('/')+1)));if(inv)changed=await this.closeInvitation(tx,r,inv,'withdrawn',now,{reason:'issuer-no-longer-admin'})||changed;}}
  return changed;
 }
 /** relations.offer (system, invitee side): records an inbound item for the admins. The answer is uniform whatever
  * happens: muted senders, malformed offers and a full inbox all look the same to the sender (RL-11). */
 offer(actor,input){return this.system(actor,async(r,now,tx)=>{
  const from=input?.from,meta=input?.meta;if(!validPrincipal(from)||typeof meta!=='string')return {received:true};
  if(!this.flag(r.id))return {received:true};// review L16: nothing is recorded or announced while relations are off
  const parsed=await parseRelationInvitation(meta,{keys:async p=>(await this.resolveParty(p))?.keys??[],now,expect:p=>samePrincipal(p,from)&&!this.foreign(p)});
  if(!parsed||!samePrincipal(parsed.inviter,from)||!samePrincipal(parsed.claims.invitee,this.self(r.id)))return {received:true};
  if(await tx.get(K.mute(from))||await tx.get(K.inbound(parsed.claims.jti))||await tx.get(K.cp(parsed.claims.instance,from)))return {received:true};
  let open=0;for(const [key,item] of await tx.list({prefix:'rel/inbound/',limit:RELATION_LIMITS.inbound+1})){if(item.expiresAt>now)open++;else await tx.delete(key);}
  if(open>=RELATION_LIMITS.inbound){const c=await this.counters(tx),today=Math.floor(now/DAY);if(c.fullNoticeDay!==today){c.fullNoticeDay=today;await tx.put(K.state,c);this.orgs.notice(r,'relation-inbound-full',{limit:RELATION_LIMITS.inbound},now);}return {received:true};}
  await tx.put(K.inbound(parsed.claims.jti),{v:1,jti:parsed.claims.jti,meta,from:party(from),instance:parsed.claims.instance,relation:parsed.claims.relation,slot:parsed.claims.slot,receivedAt:now,expiresAt:parsed.claims.exp*1000});
  this.orgs.notice(r,'relation-invitation-received',{invitation:parsed.claims.jti,from:party(from)},now);
  return {received:true};
 });}
 retract(actor,input){return this.system(actor,async(r,now,tx)=>{const item=typeof input?.jti==='string'?await tx.get(K.inbound(input.jti)):null;if(item&&samePrincipal(item.from,input.from))await tx.delete(K.inbound(input.jti));return {received:true};});}
 /** relations.inbound: pending inbound invitations (admins only). */
 inbound(actor){return this.adminRead(actor,async(r,tx)=>{const now=this.clock.now();return {items:[...(await tx.list({prefix:'rel/inbound/',limit:RELATION_LIMITS.inbound})).values()].filter(i=>i.expiresAt>now).map(i=>({kind:'invitation',invitation:i.jti,meta:i.meta,from:i.from,instance:i.instance,relation:i.relation,slot:i.slot,receivedAt:i.receivedAt,expiresAt:i.expiresAt})),
  introductions:[...(await tx.list({prefix:'rel/intro/',limit:RELATION_LIMITS.inbound})).values()].filter(i=>i.expiresAt>now).map(i=>({kind:'introduction',introduction:i.id,proposer:i.proposer,instance:i.instance,slot:i.slot,candidate:i.candidate,receivedAt:i.receivedAt,expiresAt:i.expiresAt}))};});}
 /** relations.decline (narrowing): drops an inbound item. Nothing is sent to the inviter. */
 decline(actor,input){return this.narrowing(actor,input,['item'],async(r,v,now,m,tx)=>{
  // An introduction: dropped, and only the proposer is told it was declined (spec §9.4; never the candidate).
  const intro=typeof v.item==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v.item)?await tx.get(K.intro(v.item)):null;
  if(intro){await this.decideIntroduction(tx,r,intro,'declined',now);await this.orgs.audit(tx,r,'relation-introduction-declined',actor,{introduction:intro.id,instance:intro.instance});return {declined:true};}
  const item=typeof v.item==='string'&&JTI.test(v.item)?await tx.get(K.inbound(v.item)):null;if(!item)fail();await tx.delete(K.inbound(v.item));await this.orgs.audit(tx,r,'relation-invitation-declined',actor,{invitation:v.item,from:item.from});this.orgs.notice(r,'relation-invitation-declined',{invitation:v.item,from:item.from},now);return {declined:true};});}
 /** relations.mute / unmute (narrowing): a muted organization's invitations are dropped silently; muting clears its
  * pending items, which frees inbound space (RL-11). */
 mute(actor,input){return this.narrowing(actor,input,['organization','muted'],async(r,v,now,m,tx)=>{
  if(!validPrincipal(v.organization)||v.muted!==undefined&&typeof v.muted!=='boolean')fail('invalid_request','Unsupported relation request.',400);
  if(v.muted===false){await tx.delete(K.mute(v.organization));await this.orgs.audit(tx,r,'relation-organization-unmuted',actor,{organization:party(v.organization)});return {muted:false};}
  if(!await tx.get(K.mute(v.organization))){if((await tx.list({prefix:'rel/mute/',limit:RELATION_LIMITS.muted})).size>=RELATION_LIMITS.muted)fail('relation_mute_limit','Too many muted organizations.',429);await tx.put(K.mute(v.organization),{principal:party(v.organization),at:now});}
  let cleared=0;for(const [key,item] of await tx.list({prefix:'rel/inbound/',limit:RELATION_LIMITS.inbound+1}))if(samePrincipal(item.from,v.organization)){await tx.delete(key);cleared++;}
  await this.orgs.audit(tx,r,'relation-organization-muted',actor,{organization:party(v.organization)});this.orgs.notice(r,'relation-organization-muted',{organization:party(v.organization)},now);return {muted:true,cleared};
 });}

 /** The acceptance disclosure (spec §9.4 step 3): inviter identity, relation (publisher unverified), slot, the matrix as
  * it applies to this organization, caveats and warnings, with the digest the acceptance must echo. */
 async disclose(actor,meta){
  const now=this.clock.now(),parsed=await parseRelationInvitation(meta,{keys:async p=>(await this.resolveParty(p))?.keys??[],now,expect:p=>!this.foreign(p)});
  if(!parsed||!samePrincipal(parsed.claims.invitee,this.self(actor.owner)))invalid();
  const c=parsed.claims,inviter=parsed.inviter;this.requireLocal(actor.owner,inviter);
  const theirs=await this.statements.verify(c.statement,{party:inviter,mode:'invitation',invitationIat:c.iat,expect:{instance:c.instance,relation:c.relation}});
  if(!theirs)invalid();
  let resolved;try{resolved=await this.resolveDoc(c.relation);}catch{invalid();}
  const {pin,doc}=resolved,mySlot=c.slot,theirSlot=theirs.slot;
  if(!slotOf(doc,mySlot)?.kinds.includes('organization')||!slotOf(doc,theirSlot))invalid();
  const party_=await this.resolveParty(inviter);if(party_?.kind!=='organization')invalid();
  const view=e=>({index:e.index,fragment:{fragment:e.fragment,version:e.version,digest:e.digest},...e.fields?{fields:e.fields}:{},methods:e.methods,required:e.required,actor_disclosure:e.actor_disclosure});
  const gives=edgeEntries(doc,mySlot,theirSlot).map(view),receives=edgeEntries(doc,theirSlot,mySlot).map(view);
  return {parsed,theirs,pin,doc,mySlot,theirSlot,inviter,party:party_,gives,receives,c};
 }
 async disclosureView(actor,d,tx){
  const warnings=await this.warnings(tx,d.doc,d.inviter);
  const shown={invitation:d.c.jti,inviter:{identity:identityURI(d.inviter),handle:d.party.handle??null,origin:d.inviter.iss},relation:{id:d.doc.id,title:d.doc.title,publisher:d.doc.publisher??null,publisherVerified:false,pin:d.pin},
   slot:d.mySlot,counterpartySlot:d.theirSlot,gives:d.gives,receives:d.receives,warnings,expiresAt:d.c.exp*1000,
   caveats:['counterparty-sees-actor-chain','copies-cannot-be-recalled','proxying-undetectable']};
  return {...shown,disclosure:await digest(globalThis.crypto,jcs(['bindle-relation-disclosure-v1',shown]))};
 }
 /** relations.inbound-preview: the disclosure for an invitation (admins). Every invalid case is the same refusal. */
 async inboundPreview(actor,input){
  this.requireEnabled(actor);await this.requireAdmin(actor);if(!plain(input)||typeof input.invitation!=='string')invalid();
  const d=await this.disclose(actor,input.invitation);return this.adminRead(actor,(r,tx)=>this.disclosureView(actor,d,tx));
 }
 /**
  * relations.accept (widening, step-up). Records this organization's participation and the grants it gives as pending
  * in one commit, redeems at the inviter, verifies the inviter's returned statement and then activates (spec §9.4).
  * A refusal by the inviter discards the pending records; an unreachable inviter leaves them for a retry.
  */
 async accept(actor,input){
  this.requireEnabled(actor);await this.requireAdmin(actor);if(!plain(input)||typeof input.invitation!=='string')invalid();
  const d=await this.disclose(actor,input.invitation),jti=d.c.jti,me=this.self(actor.owner);
  const pending=await this.widen(actor,input,['invitation','disclosure','values','receive'],async(r,v,now,m,tx)=>{
   const shown=await this.disclosureView(actor,d,tx);if(v.disclosure!==shown.disclosure)fail('relation_disclosure_changed','Review what this relation shares before accepting.',409);
   if(v.receive!==undefined&&typeof v.receive!=='boolean')fail('invalid_request','Unsupported relation request.',400);
   let part=await tx.get(K.instance(d.c.instance));
   if(part&&(part.state==='left'||!samePin(part.relation,d.pin)))invalid();
   const old=await tx.get(K.cp(d.c.instance,d.inviter));
   if(old&&!(old.state==='pending'&&old.invitation===jti))fail('relation_counterpart_exists','This organization is already part of your view of this relation.',409);
   const c=await this.counters(tx),doc=d.doc;
   const grant=await this.grantEntries(tx,doc,d.mySlot,d.theirSlot,v.values,now),receive=v.receive===true&&d.receives.length>0;
   if(!grant&&!receive)fail('relation_invitation_empty','Accepting would neither share nor receive anything.',400);
   if(!part&&c.instances>=RELATION_LIMITS.instances)fail('relation_limit','This organization has reached the relation limit for now.',429);
   if(receive&&!old&&c.incoming+(await tx.list({prefix:'rel/accepting/',limit:RELATION_LIMITS.incomingEdges})).size>=RELATION_LIMITS.incomingEdges)fail('relation_limit','This organization has reached the relation limit for now.',429);
   // Arity is per view (spec §9.3): recognizing the inviter, and holding my own slot, never exceed `max` in my view.
   const view={instance:d.c.instance,state:'pending',slots:[...new Set([...(part?.slots??[]),d.mySlot])]};
   if(!old&&(await this.holders(tx,view,d.theirSlot)>=slotOf(doc,d.theirSlot).arity.max||await this.holders(tx,view,d.mySlot)>slotOf(doc,d.mySlot).arity.max))fail('relation_slot_full','Your view of this slot is full.',409);
   if(!part){part={v:1,instance:d.c.instance,relation:d.pin,slots:[],state:'pending',creator:false,createdAt:now};c.instances++;await tx.put(K.state,c);}
   await tx.put(K.instance(part.instance),part);await tx.put(K.doc(d.pin.digest),{pin:d.pin,doc});
   const cp={v:1,instance:part.instance,principal:party(d.inviter),slot:d.theirSlot,as:d.mySlot,state:'pending',invitation:jti,since:now,
    grant:grant?half('pending',0,now,grant):null,acceptance:receive?half('pending',0,now):null,peerGrant:old?.peerGrant??null,peerAcceptance:old?.peerAcceptance??null,peerAep:old?.peerAep??0};
   await tx.put(K.cp(part.instance,d.inviter),cp);
   // Signed in the commit that records the participation as pending (spec §9.3 freshness rule 1).
   const statement=await this.statements.sign({org:r.id,party:me,instance:part.instance,relation:d.pin,slot:d.mySlot,invitation:await invitationDigest(input.invitation)});
   await tx.put(K.accepting(jti),{v:1,jti,instance:part.instance,inviter:party(d.inviter),createdAt:now});
   await this.orgs.audit(tx,r,'relation-acceptance-pending',actor,{instance:part.instance,invitation:jti,inviter:party(d.inviter),slot:d.mySlot,gives:(grant??[]).map(e=>e.index),receive});
   return {statement};
  });
  let answer;
  try{answer=await this.transport.redeem(me,d.inviter,{invitation:input.invitation,statement:pending.statement});}
  catch(error){
   if(error?.code==='invitation_invalid'){await this.discard(actor.owner,jti,d.c.instance,d.inviter);invalid();}
   // The redemption may have succeeded at the inviter with the answer lost: remember that, so abandoning it later
   // tells the inviter (review M3).
   await this.metadata.transaction(async tx=>{const row=await tx.get(K.accepting(jti));if(row){row.attempted=true;await tx.put(K.accepting(jti),row);}});
   fail('relation_redeem_unavailable','The other organization could not be reached. Try again.',503);
  }
  const theirs=await this.statements.verify(answer?.statement,{party:d.inviter,mode:'presented',expect:{instance:d.c.instance,relation:d.pin,slot:d.theirSlot}});
  if(!theirs){await this.discard(actor.owner,jti,d.c.instance,d.inviter,{notify:true});invalid();}
  return this.system({kind:'system',owner:actor.owner},async(r,now,tx)=>{
   const part=await tx.get(K.instance(d.c.instance)),cp=await tx.get(K.cp(d.c.instance,d.inviter));
   if(!part||!cp||cp.state!=='pending'||cp.invitation!==jti)fail('relation_acceptance_conflict','This relation changed. Reload and try again.',409);
   await this.activate(tx,r,part,cp,now,{slot:d.mySlot});
   await tx.delete(K.accepting(jti));await tx.delete(K.inbound(jti));await tx.put(K.used(d.doc.id),{id:d.doc.id,title:d.doc.title,at:now});
   await this.orgs.audit(tx,r,'relation-accepted',actor,{instance:part.instance,invitation:jti,counterpart:party(d.inviter)});
   this.orgs.notice(r,'relation-accepted',{instance:part.instance,counterpart:party(d.inviter),slot:d.mySlot},now);
   return {instance:part.instance,counterpart:party(d.inviter),slot:d.mySlot,counterpartySlot:d.theirSlot,state:'live'};
  });
 }
 /**
  * Drops a pending acceptance (spec §9.4 step 5: discarded if the inviter refuses). When the redemption may have
  * succeeded at the inviter (a lost answer, or an answer whose statement failed), the inviter is told both halves
  * ended, so it does not keep a counterpart this side never activated (review M3).
  */
 async discard(owner,jti,instance,inviter,{notify=false}={}){
  await this.metadata.transaction(async tx=>{
   const row=await tx.get(K.accepting(jti)),cp=await tx.get(K.cp(instance,inviter)),c=await this.counters(tx);
   if(cp?.state==='pending'&&cp.invitation===jti){
    await tx.delete(K.cp(instance,inviter));
    for(const [key,imp] of await tx.list({prefix:IMPORT_PREFIX+principalKey(inviter)+'/'+ik(instance)+'/',limit:65})){for(const x of imp.resources??[]){await tx.delete('rel/import-id/'+x.id);await tx.delete('federation/resource/'+x.id);}await tx.delete(key);}
    const part=await tx.get(K.instance(instance));if(part?.state==='pending'&&!(await this.counterpartsOf(tx,instance)).length){await tx.delete(K.instance(instance));c.instances=Math.max(0,c.instances-1);await tx.put(K.state,c);}
    if(notify||row?.attempted)for(const kind of ['grant','acceptance'])await this.enqueue(tx,{aep:(await tx.get('org/record-v1'))?.aep??0},inviter,halfEvent(kind,{state:'ended'}),instance);
   }
   await tx.delete(K.accepting(jti));
  });
 }
 /** Makes a counterpart live on this side: participation, slot, both of my halves at generation 1, counters, and the
  * edge-state events for each half (spec §9.9 "When events are sent"). */
 async activate(tx,r,part,cp,now,{slot}){
  if(part.state==='pending')part.state='live';if(slot&&!part.slots.includes(slot))part.slots=[...part.slots,slot];part.updatedAt=now;await tx.put(K.instance(part.instance),part);
  cp.state='live';cp.since=now;if(cp.grant)cp.grant=half('live',1,now,cp.grant.entries);if(cp.acceptance){cp.acceptance=half('live',1,now);const c=await this.counters(tx);c.incoming++;await tx.put(K.state,c);}
  await this.emitHalf(tx,r,cp,'grant');await this.emitHalf(tx,r,cp,'acceptance');await this.endMatching(tx,r,cp,now);await this.settleCounterpart(tx,r,part,cp,now);
  await tx.put(K.cp(part.instance,cp.principal),cp);await tx.put(K.seen(cp.principal),{at:now});await this.refreshImports(tx,part,cp,now,r);
  // The counterpart's authority-epoch baseline (RL-4 compares later observations with it) and its place in the
  // background key-refresh set (spec §9.9 step 3 verifies only against keys already held).
  if(!await tx.get(K.aep(cp.principal))){const known=await this.resolveParty(cp.principal);await tx.put(K.aep(cp.principal),{aep:Number.isSafeInteger(known?.aep)&&known.aep>=0?known.aep:0,at:now,baseline:true});}
  try{await this.refreshQueue(tx,cp.principal,{now,source:'member'});}catch{/* best effort */}
 }
 /** A counterpart's end is final, so my matching half can never be live again: end it too and say so. Applied on
  * ingest and at activation (a retried acceptance may already hold an ended mirror). */
 async endMatching(tx,r,cp,now){
  for(const [peer,mine] of [['peerGrant','acceptance'],['peerAcceptance','grant']]){const h=cp[mine];if(cp[peer]?.state!=='ended'||!h||h.state==='ended')continue;
   if(mine==='acceptance'&&h.state!=='pending'){const c=await this.counters(tx);c.incoming=Math.max(0,c.incoming-1);await tx.put(K.state,c);}
   cp[mine]=h.state==='pending'?null:bump(h,'ended',now);if(cp[mine])await this.emitHalf(tx,r,cp,mine);}
 }
 /** relations.redeem (system, inviter side; the join endpoint). Every failure is the same `invitation_invalid`. */
 redeem(actor,input){return this.system(actor,async(r,now,tx)=>{
  if(!plain(input)||typeof input.invitation!=='string'||typeof input.statement!=='string')invalid();
  let jti;try{jti=JSON.parse(atob(input.invitation.split('.')[1].replaceAll('-','+').replaceAll('_','/'))).jti;}catch{invalid();}
  const inv=typeof jti==='string'&&JTI.test(jti)?await tx.get(K.inv(jti)):null;
  if(!inv||inv.meta!==input.invitation||inv.state!=='redeemed'&&(inv.expiresAt<=now||!this.flag(r.id)))invalid();
  if(input.from!==undefined&&!samePrincipal(input.from,inv.invitee))invalid();
  const part=await tx.get(K.instance(inv.instance));if(part?.state!=='live')invalid();
  // No lookup beyond what the presented, verified invitation justifies: only the invitee's keys.
  const theirs=await this.statements.verify(input.statement,{party:inv.invitee,mode:'presented',expect:{instance:inv.instance,relation:part.relation,slot:inv.slot,invitation:await invitationDigest(inv.meta)}});
  if(!theirs)invalid();
  const me=this.self(r.id),fresh=()=>this.statements.sign({org:r.id,party:me,instance:part.instance,relation:part.relation,slot:inv.as});
  if(inv.state==='redeemed'){const cp=await tx.get(K.cp(inv.instance,inv.invitee));if(cp&&cp.invitation===jti&&cp.state!=='ended')return {statement:await fresh()};invalid();}
  if(inv.state!=='open')invalid();
  // Review M1: no new edge while the inviting organization is not active (deletion pending, or an organization-level
  // hold), and none from an invitation whose issuing admin is no longer an unheld live admin.
  if(r.state!=='active'||r.hold)invalid();
  if(!memberPowers(await tx.get('org/member/'+principalKey(inv.by)),now).includes('admin'))invalid();
  const doc=await this.docFor(tx,part.relation);
  if(await tx.get(K.cp(inv.instance,inv.invitee))||await this.holders(tx,part,inv.slot)>=slotOf(doc,inv.slot).arity.max)invalid();
  const c=await this.counters(tx);if(inv.receive&&c.incoming>=RELATION_LIMITS.incomingEdges)invalid();
  const cp={v:1,instance:part.instance,principal:party(inv.invitee),slot:inv.slot,as:inv.as,state:'pending',invitation:jti,since:now,grant:inv.grant?half('pending',0,now,inv.grant):null,acceptance:inv.receive?half('pending',0,now):null,peerGrant:null,peerAcceptance:null,peerAep:0};
  // Values bound at invite time may have left the pool since; a required entry without a resource ends the grant.
  if(cp.grant){cp.grant.entries=await this.liveEntries(tx,doc,inv.as,inv.slot,cp.grant.entries,now);if(!cp.grant.entries.length||!requiredSatisfied(doc,inv.as,inv.slot,cp.grant.entries))cp.grant=null;}
  if(!cp.grant&&!cp.acceptance)invalid();
  await this.closeInvitation(tx,r,inv,'redeemed',now,{quiet:true});
  await this.activate(tx,r,part,cp,now,{});
  await this.orgs.audit(tx,r,'relation-redeemed',{kind:'system'},{instance:part.instance,invitation:jti,counterpart:party(inv.invitee)});
  this.orgs.notice(r,'relation-redeemed',{instance:part.instance,counterpart:party(inv.invitee),slot:inv.slot},now);
  return {statement:await fresh()};
 });}

 /** Grant entries re-intersected with the organization's live pool (contracts may have narrowed, resources may be
  * gone) and expiry; entries left without a resource are dropped unless the entry has no resource field (review M2, L13). */
 async liveEntries(tx,doc,grantorSlot,granteeSlot,entries,now){
  const defined=new Map(edgeEntries(doc,grantorSlot,granteeSlot).map(e=>[e.index,e])),out=[];
  for(const e of entries){const def=defined.get(e.index);if(!def)continue;const atomic=!Object.keys(def.methods).length,resources=[];
   for(const x of e.resources){if(x.expires_at!==undefined&&x.expires_at<=now/1000)continue;const own=await this.resources(tx,x.resource);if(!own)continue;
    const methods={};for(const [c,ms] of Object.entries(x.methods)){const kept=Object.hasOwn(own.contracts,c)&&Array.isArray(own.contracts[c])?ms.filter(m=>own.contracts[c].includes(m)):[];if(kept.length)methods[c]=kept;}if(Object.keys(methods).length)resources.push({...x,methods});}
   if(resources.length||atomic)out.push({...e,resources});}
  return out;
 }
 // ---- edges (ORG-10c) -----------------------------------------------------------------------------------------------
 edgeInput(v){if(typeof v.instance!=='string'||!validPrincipal(v.counterpart)||v.direction!==undefined&&!['outgoing','incoming'].includes(v.direction))fail('invalid_request','Unsupported relation request.',400);}
 async edgeRecords(tx,v){const part=await tx.get(K.instance(v.instance)),cp=part?await tx.get(K.cp(v.instance,v.counterpart)):null;if(!part||!cp||cp.state==='pending')fail();return {part,cp};}
 async changeHalf(tx,r,actor,part,cp,kind,state,now,entries){
  const key=kind==='grant'?'grant':'acceptance',h=cp[key];if(!h||h.state==='ended'||h.state==='pending')fail();
  if(h.state===state&&state!=='live'&&entries===undefined)return false;
  const wasLive=h.state!=='ended';cp[key]=bump(h,state,now,entries);
  if(kind==='acceptance'&&state==='ended'&&wasLive){const c=await this.counters(tx);c.incoming=Math.max(0,c.incoming-1);await tx.put(K.state,c);}
  await this.settleCounterpart(tx,r,part,cp,now);
  await tx.put(K.cp(part.instance,cp.principal),cp);await this.emitHalf(tx,r,cp,kind);await this.refreshImports(tx,part,cp,now,r);
  await this.orgs.audit(tx,r,`relation-${kind}-${state}`,actor,{instance:part.instance,counterpart:party(cp.principal),generation:cp[key].generation});
  this.orgs.notice(r,`relation-${kind}-${state}`,{instance:part.instance,counterpart:party(cp.principal)},now);
  return true;
 }
 /** A counterpart whose every half is ended (or absent) is no longer recognized in my view. A half I never held is
  * then also reported ended, so a counterpart holding a half I never heard about (a lost event) closes it too. */
 async settleCounterpart(tx,r,part,cp,now){
  const done=h=>!h||h.state==='ended';
  if(cp.state==='live'&&done(cp.grant)&&done(cp.acceptance)&&done(cp.peerGrant)&&done(cp.peerAcceptance)){cp.state='ended';cp.endedAt=now;
   for(const kind of ['grant','acceptance'])if(!cp[kind])await this.enqueue(tx,r,cp.principal,halfEvent(kind,{state:'ended'}),part.instance);}
 }
 /** relations.suspend (narrowing): my outgoing grant half (default) or my incoming acceptance half. Immediate. */
 suspend(actor,input){return this.narrowing(actor,input,['instance','counterpart','direction'],async(r,v,now,m,tx)=>{this.edgeInput(v);const {part,cp}=await this.edgeRecords(tx,v);
  const kind=(v.direction??'outgoing')==='outgoing'?'grant':'acceptance';const h=cp[kind];if(h?.state!=='live')fail();await this.changeHalf(tx,r,actor,part,cp,kind,'suspended',now);return this.edgeView(part,cp,now);});}
 /** relations.end (narrowing, final): my outgoing grant half or my incoming acceptance half. */
 end(actor,input){return this.narrowing(actor,input,['instance','counterpart','direction'],async(r,v,now,m,tx)=>{this.edgeInput(v);const {part,cp}=await this.edgeRecords(tx,v);
  const kind=(v.direction??'outgoing')==='outgoing'?'grant':'acceptance';await this.changeHalf(tx,r,actor,part,cp,kind,'ended',now);return this.edgeView(part,cp,now);});}
 /** relations.resume (widening; see the edge module): a suspended half becomes live again with a new generation. */
 resume(actor,input){return this.widen(actor,input,['instance','counterpart','direction'],async(r,v,now,m,tx)=>{this.edgeInput(v);const {part,cp}=await this.edgeRecords(tx,v);
  const kind=(v.direction??'outgoing')==='outgoing'?'grant':'acceptance';if(cp[kind]?.state!=='suspended')fail();
  // RL-10: an outgoing edge that arrived suspended after this organization's move is re-bound (relations.rebind).
  if(cp[kind].cause==='moved')fail('relation_rebind_required','This edge needs new values after the move. Re-bind it.',409);
  let entries;if(kind==='grant'){const doc=await this.docFor(tx,part.relation);entries=await this.liveEntries(tx,doc,cp.as,cp.slot,cp.grant.entries,now);if(!entries.length||!requiredSatisfied(doc,cp.as,cp.slot,entries))fail('relation_values_incomplete','A required entry has no resource left; end this edge instead.',409);}
  await this.changeHalf(tx,r,actor,part,cp,kind,'live',now,entries);return this.edgeView(part,cp,now);});}
 /** relations.narrow (narrowing): keep only some entries or resources of my outgoing grant. Required entries stay
  * non-empty (ending is the way to drop them). Takes effect at the next call. */
 narrow(actor,input){return this.narrowing(actor,input,['instance','counterpart','entries'],async(r,v,now,m,tx)=>{this.edgeInput(v);const {part,cp}=await this.edgeRecords(tx,v);
  if(!cp.grant||!['live','suspended'].includes(cp.grant.state)||!plain(v.entries))fail();
  const doc=await this.docFor(tx,part.relation),kept=[];
  for(const e of cp.grant.entries){const keep=v.entries[String(e.index)];if(keep===undefined)continue;if(keep===true){kept.push(e);continue;}
   if(!Array.isArray(keep)||keep.some(id=>!e.resources.some(x=>x.resource===id)))fail('relation_values_invalid','Keep only resources this edge already shares.',400);
   const resources=e.resources.filter(x=>keep.includes(x.resource));if(resources.length||!Object.keys(edgeEntries(doc,cp.as,cp.slot).find(x=>x.index===e.index)?.methods??{}).length)kept.push({...e,resources});}
  if(Object.keys(v.entries).some(k=>!cp.grant.entries.some(e=>String(e.index)===k)))fail('relation_values_invalid','Keep only entries this edge already shares.',400);
  if(!kept.length||!requiredSatisfied(doc,cp.as,cp.slot,kept))fail('relation_values_incomplete','A required entry cannot be dropped; end this edge instead.',409);
  if(JSON.stringify(kept)===JSON.stringify(cp.grant.entries))return this.edgeView(part,cp,now);
  await this.changeHalf(tx,r,actor,part,cp,'grant',cp.grant.state,now,kept);return this.edgeView(part,cp,now);});}
 edgeView(part,cp,now){return {instance:part.instance,counterpart:party(cp.principal),outgoing:{state:cp.grant?.state??null,generation:cp.grant?.generation??0,live:outgoingLive(part,cp,now)},incoming:{state:cp.acceptance?.state??null,generation:cp.acceptance?.generation??0,live:incomingLive(part,cp)}};}
 /** relations.leave (narrowing): ends every half this organization holds in the instance and tells each counterpart. */
 leave(actor,input){return this.narrowing(actor,input,['instance'],async(r,v,now,m,tx)=>{
  const part=typeof v.instance==='string'?await tx.get(K.instance(v.instance)):null;if(!part||part.state==='left')fail();
  await this.leaveInstance(tx,r,part,now);await this.orgs.audit(tx,r,'relation-instance-left',actor,{instance:part.instance});this.orgs.notice(r,'relation-instance-left',{instance:part.instance},now);
  return {instance:part.instance,state:'left'};
 });}
 async leaveInstance(tx,r,part,now){
  const c=await this.counters(tx);
  for(const cp of await this.counterpartsOf(tx,part.instance)){
   if(cp.state==='ended')continue;// no longer a counterpart: nothing is sent (spec §9.9 delivery; review L11)
   // A pending acceptance whose redemption may have succeeded is told too (review M3).
   const tell=cp.state!=='pending'||(await tx.get(K.accepting(cp.invitation)))?.attempted===true;if(cp.state==='pending')await tx.delete(K.accepting(cp.invitation));
   // Provisional (coordinator): a leaver sends relation-edge-ended for BOTH halves, including one it never held, so a
   // counterpart that holds only a never-accepted grant also ends it and stops recognizing the leaver (spec §9.6 says
   // "for each half it held"; the extra end confers nothing and is recorded for review in DEVLOG ORG-10a-c).
   for(const kind of ['grant','acceptance']){const h=cp[kind];if(h&&h.state!=='ended'){if(kind==='acceptance'&&h.state!=='pending')c.incoming=Math.max(0,c.incoming-1);cp[kind]=h.state==='pending'?null:bump(h,'ended',now);}
    if(tell&&h?.state!=='ended')await this.enqueue(tx,r,cp.principal,halfEvent(kind,{state:'ended'}),part.instance);}
   cp.state='ended';cp.endedAt=now;await tx.put(K.cp(part.instance,cp.principal),cp);await holdImports(tx,{grantor:cp.principal,instance:part.instance,now});await this.mirrorImports(tx,cp.principal,part.instance,now);
  }
  part.state='left';part.leftAt=now;await tx.put(K.instance(part.instance),part);await tx.put(K.left(now,part.instance),true);c.instances=Math.max(0,c.instances-1);await tx.put(K.state,c);
  for(;;){const page=await tx.list({prefix:'rel/inv-open/'+ik(part.instance)+'/',limit:BATCH});
   for(const key of page.keys()){const inv=await tx.get(K.inv(key.slice(key.lastIndexOf('/')+1)));if(!inv||!await this.closeInvitation(tx,r,inv,'withdrawn',now,{reason:'left'}))await tx.delete(key);}
   if(page.size<BATCH)break;}
 }
 /** Recomputes this counterpart's imports from my mirror of its grant half and my acceptance half. */
 async refreshImports(tx,part,cp,now,r){
  // Receiving is not free (R3-M2): without my acceptance half nothing is recorded as received.
  const g=cp.peerGrant;if(!cp.acceptance||!g?.entries||g.state==='ended'){await holdImports(tx,{grantor:cp.principal,instance:part.instance,now});await this.mirrorImports(tx,cp.principal,part.instance,now);return;}
  const doc=await this.docFor(tx,part.relation);
  const {removed,rebound}=await syncImports(tx,{grantor:cp.principal,instance:part.instance,available:incomingLive(part,cp),entries:clampEntries(doc,cp.slot,cp.as,g.entries),now});
  await this.mirrorImports(tx,cp.principal,part.instance,now,removed);
  // RL-10: the grantor re-bound an entry (after its move); the grantee's admins are told, and members keep their grants.
  if(rebound.length&&r)this.orgs.notice(r,'relation-import-rebound',{instance:part.instance,grantor:party(cp.principal),entries:rebound},now);
 }

 /**
  * relations.sweep (system): expiry and retention, bounded per call and resumable (review L3): invitations by expiry
  * index, closed invitations deleted after 30 days, inbound items (at most 256 rows), replay rows by time index (up to
  * 4,096 per call, which covers any resync rate at 256 counterparts), granted-resource expiry over counterparts with a
  * cursor, withdrawals left over by the commit hook, and pending acceptances older than any invitation can live.
  */
 async sweep(actor){let stale=[];const out=await this.system(actor,async(r,now,tx)=>{
  let changed=0;const cursor=(await tx.get(K.sweep))??{};
  for(const [key] of await tx.list({prefix:'rel/inv-due/',limit:BATCH})){const at=Number(key.split('/')[2]);if(at>now)break;const inv=await tx.get(K.inv(key.slice(key.lastIndexOf('/')+1)));
   if(inv?.state==='open'){await this.closeInvitation(tx,r,inv,'expired',now,{quiet:true});changed++;}else await tx.delete(key);}
  for(const [key] of await tx.list({prefix:'rel/inv-done/',limit:BATCH})){const at=Number(key.split('/')[2]);if(at>now-INVITATION_RETENTION_MS)break;await tx.delete(K.inv(key.slice(key.lastIndexOf('/')+1)));await tx.delete(key);changed++;}
  if(r.state!=='active'||r.hold)changed+=await this.onOrganizationCommit(tx,r,actor)?1:0;
  for(const [key,item] of await tx.list({prefix:'rel/inbound/',limit:RELATION_LIMITS.inbound+1}))if(item.expiresAt<=now){await tx.delete(key);changed++;}
  for(const [key,item] of await tx.list({prefix:'rel/intro/',limit:RELATION_LIMITS.inbound+1}))if(item.expiresAt<=now){await tx.delete(key);changed++;}
  changed+=await this.pruneProofs(tx,now);
  changed+=await this.pruneLeft(tx,now);
  changed+=await this.pruneIntroductions(tx,now);
  let budget=JTI_SWEEP_BUDGET;
  while(budget>0){const page=await tx.list({prefix:'rel/jti-at/',limit:Math.min(BATCH,budget)});let stop=page.size<Math.min(BATCH,budget);
   for(const key of page.keys()){const parts=key.split('/'),at=Number(parts[2]);if(at>now-JTI_KEEP_MS){stop=true;break;}await tx.delete(key);await tx.delete('rel/jti/'+parts.slice(3).join('/'));budget--;}
   if(stop)break;}
  stale=[...(await tx.list({prefix:'rel/accepting/',limit:RELATION_LIMITS.incomingEdges})).values()].filter(row=>row.createdAt<=now-RELATION_INVITATION_MAX_MS-DAY);
  const page=await tx.list({prefix:'rel/cp/',...cursor.cp?{startAfter:cursor.cp}:{},limit:BATCH});let last=null;
  for(const [key,cp] of page){last=key;
   const h=cp.grant;if(!h||!['live','suspended'].includes(h.state))continue;
   const kept=h.entries.map(e=>({...e,resources:e.resources.filter(x=>x.expires_at===undefined||x.expires_at>now/1000)}));
   if(JSON.stringify(kept)===JSON.stringify(h.entries))continue;
   const part=await tx.get(K.instance(cp.instance)),doc=await this.docFor(tx,part.relation);
   const atomic=e=>!Object.keys(edgeEntries(doc,cp.as,cp.slot).find(x=>x.index===e.index)?.methods??{}).length,left=kept.filter(e=>e.resources.length||atomic(e));
   await this.changeHalf(tx,r,{kind:'system'},part,cp,'grant',left.length&&requiredSatisfied(doc,cp.as,cp.slot,left)?h.state:'ended',now,left.length?left:undefined);changed++;
  }
  cursor.cp=page.size===BATCH?last:null;await tx.put(K.sweep,cursor);
  return {changed,more:Boolean(cursor.cp)};
 });
  // Pending acceptances older than any invitation can live are abandoned (review M3).
  for(const row of stale)await this.discard(actor.owner,row.jti,row.instance,row.inviter);
  return {changed:out.changed+stale.length,more:out.more};
 }

 /** relations.export: paged admin-readable relation records; never flags, session tokens, keys or proof caches.
  * This is a portable inspection export. Restoring participations at another provider remains ORG-11b. */
 exportRelations(actor,input={}){return this.adminRead(actor,async(r,tx)=>{
  if(!plain(input)||Object.keys(input).some(k=>k!=='after')||input.after!==undefined&&(typeof input.after!=='string'||!input.after.startsWith('rel/')||input.after.length>4096))fail('invalid_request','Invalid export cursor.',400);
  const rows=await tx.list({prefix:'rel/',...input.after?{startAfter:input.after}:{},limit:201}),page=[...rows].slice(0,200);
  const allowed=/^rel\/(instance|cp|import|hold|doc|successor|origin|aep|confirmed)\//;
  return {version:1,organization:this.self(r.id),records:page.filter(([key])=>allowed.test(key)).map(([key,value])=>({key,value})),next:rows.size>200?page.at(-1)?.[0]??null:null};
 });}
 // ---- imports (ORG-10c) ---------------------------------------------------------------------------------------------
 /** relations.imports: admins see every import; other members only the imports they hold grants on (RL-13). */
 imports(actor,input){return this.metadata.transaction(async tx=>{
  const r=await this.orgs.organization(tx,actor),now=this.clock.now(),admin=organizationPowers(r,actor.principal,{now}).includes('admin');
  const member=r.memberships?.[principalKey(actor.principal)];if(!admin&&member?.state!=='live')fail();
  if(admin){const rows=[...(await tx.list({prefix:IMPORT_PREFIX,limit:512})).values()].filter(row=>input?.instance===undefined||row.instance===input.instance);return {imports:rows.map(row=>importView(row,now))};}
  const out=[];for(const g of member.grants??[])if(!g.power&&isImportId(g.resource)){const found=await importById(tx,g.resource,now);if(found)out.push({id:found.resource.id,grantor:{...found.row.grantor},status:found.available?'available':'unavailable',contracts:[...found.resource.contracts]});}
  return {imports:out};
 });}
}
// ORG-10d and ORG-10e methods (one service, one writer; the modules own their records and rules).
Object.assign(RelationService.prototype,relationEventMethods,relationLifecycleMethods,relationAccessMethods,relationUpgradeMethods);

// ---- engine operations ---------------------------------------------------------------------------------------------
const CHANGED='relations-changed';
/** The `relations` provider class over one RelationService (one per organization account single writer). */
export function relationsProvider(service){return class extends Provider{static deps=[];obtain(){return service;}release(){}};}
class RelAction extends AppAction{static deps=['relations'];static changes=CHANGED;static entities=['organization'];}
class RelQuery extends AppQuery{static deps=['relations'];static refreshOn=[CHANGED];static entities=['organization'];}
export class RelationExport extends RelQuery{static operation='relations.export';static lifecycle='suspended';fetch({relations}){return relations.exportRelations(this.actor,this.input??{});}}
export class RelationPreview extends RelQuery{static operation='relations.preview';fetch({relations}){return relations.preview(this.actor,this.input);}}
export class RelationList extends RelQuery{static operation='relations.list';static lifecycle='suspended';fetch({relations}){return relations.list(this.actor);}}
export class RelationGet extends RelQuery{static operation='relations.get';static lifecycle='suspended';fetch({relations}){return relations.get(this.actor,this.input);}}
export class RelationInbound extends RelQuery{static operation='relations.inbound';static lifecycle='suspended';fetch({relations}){return relations.inbound(this.actor);}}
export class RelationCatalogue extends RelQuery{static operation='relations.catalogue';fetch({relations}){return relations.catalogue(this.actor);}}
export class RelationResources extends RelQuery{static operation='relations.resources';static lifecycle='suspended';fetch({relations}){return relations.resourcesList(this.actor);}}
export class RelationInvitations extends RelQuery{static operation='relations.invitations';static lifecycle='suspended';fetch({relations}){return relations.invitations(this.actor);}}
export class RelationOverview extends RelQuery{static operation='relations.overview';static lifecycle='suspended';fetch({relations}){return relations.overview(this.actor);}}
export class RelationInboundPreview extends RelQuery{static operation='relations.inbound-preview';fetch({relations}){return relations.inboundPreview(this.actor,this.input);}}
// Widening (flag, step-up).
export class CreateRelation extends RelAction{static operation='relations.create';run({relations}){return relations.create(this.actor,this.input);}}
export class InviteRelation extends RelAction{static operation='relations.invite';run({relations}){return relations.invite(this.actor,this.input);}}
export class AcceptRelation extends RelAction{static operation='relations.accept';run({relations}){return relations.accept(this.actor,this.input);}}
// Narrowing (never flag-gated).
export class WithdrawRelationInvitation extends RelAction{static operation='relations.withdraw';static lifecycle='suspended';run({relations}){return relations.withdraw(this.actor,this.input);}}
export class DeclineRelationItem extends RelAction{static operation='relations.decline';static lifecycle='suspended';run({relations}){return relations.decline(this.actor,this.input);}}
export class LeaveRelation extends RelAction{static operation='relations.leave';static lifecycle='suspended';run({relations}){return relations.leave(this.actor,this.input);}}
export class MuteRelationOrganization extends RelAction{static operation='relations.mute';static lifecycle='suspended';run({relations}){return relations.mute(this.actor,this.input);}}
// System (never wire-dispatchable): adapters build the system actor and `from` from verified evidence.
class RelSystem extends AppAction{static deps=['relations'];static changes=CHANGED;static lifecycle='suspended';}
export class RedeemRelation extends RelSystem{static operation='relations.redeem';run({relations}){return relations.redeem(this.actor,this.input);}}
export class OfferRelation extends RelSystem{static operation='relations.offer';run({relations}){return relations.offer(this.actor,this.input);}}
export class RetractRelationOffer extends RelSystem{static operation='relations.retract';run({relations}){return relations.retract(this.actor,this.input);}}
export class RelationSweep extends RelSystem{static operation='relations.sweep';run({relations}){return relations.sweep(this.actor);}}
export const RELATION_OPERATIONS=Object.freeze([RelationExport,RelationCatalogue,RelationResources,RelationInvitations,RelationOverview,RelationPreview,RelationList,RelationGet,RelationInbound,RelationInboundPreview,CreateRelation,InviteRelation,AcceptRelation,WithdrawRelationInvitation,DeclineRelationItem,LeaveRelation,MuteRelationOrganization,...RELATION_UPGRADE_OPERATIONS,...RELATION_EDGE_OPERATIONS,...RELATION_IMPORT_OPERATIONS,...RELATION_EVENT_OPERATIONS,...RELATION_LIFECYCLE_OPERATIONS]);
export const RELATION_SYSTEM_OPERATIONS=Object.freeze([RedeemRelation,OfferRelation,RetractRelationOffer,RelationSweep,...RELATION_EDGE_SYSTEM_OPERATIONS,...RELATION_LIFECYCLE_SYSTEM_OPERATIONS,...RELATION_ACCESS_SYSTEM_OPERATIONS]);
/** Narrowing operations, which no relations flag ever gates (design §8b.10). */
export const RELATION_NEVER_GATED=Object.freeze(['relations.export','relations.withdraw','relations.decline','relations.leave','relations.mute','relations.suspend','relations.end','relations.narrow','relations.ingest','relations.outbox-drain','relations.resync','relations.sweep','relations.list','relations.get','relations.inbound','relations.imports','relations.overview','relations.invitations','relations.resources','relations.introductions','relations.holds','relations.tick','relations.lifecycle','relations.observe-counterpart','relations.purge-ready','relations.certify','relations.authorize','relations.edge-check']);
