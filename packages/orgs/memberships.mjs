// ORG-2. The organization record is the transaction boundary for grants, generations, governance and the outbox; the
// roster rows (packages/orgs/roster.mjs) commit in the same transaction, so every operation stays atomic while no
// stored value grows with the roster (wargame F-02, 2026-10-23).
// Adapters MUST supply authenticated principal/evidence; no certificate, key or step-up assertion comes from input.
import {OrganizationService,ORG_RECORD} from './organizations.mjs';
import {organizationPowers,requireFresh} from './authority.mjs';
import {principalKey,samePrincipal,memberPowers,normalizeMemberGrants,effectiveAuthority,memberResourceProjection} from './grants.mjs';
import {invitationProposal,signOrganizationInvitation} from './invitations.mjs';
import {attachRoster,rosterOf,loadOrganization,openRequest,ORG_KEYS,ORG_ROSTER_VERSION,ORG_RETENTION_MS,ORG_OUTBOX_EXPIRY_MS,ORG_SWEEP_BATCH,ORG_ADMIN_DELAY_MS} from './roster.mjs';
import {enqueueMemberKeyRefresh} from './key-refresh.mjs';
import {fanoutPage,fanoutDone} from './admin-index.mjs';
import {AppFault} from '../app/faults.mjs';
const DAY=86400000,fail=(code='not_found',message='Not found.',status=409)=>{throw new AppFault(code,message,status);};
const party=p=>({iss:p.iss??null,sub:p.sub}),hasAdmin=m=>m?.grants?.some(g=>g.power==='admin');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const currentAdmin=(m,now)=>m?.grants?.some(g=>g.power==='admin'&&(g.expires_at===undefined||g.expires_at>now/1000));
const grantShape=g=>Object.fromEntries(Object.entries(g).filter(([k])=>!['grantedBy','grantedAt','notBefore'].includes(k)));
const stamp=(grants,actor,now,prior=[])=>grants.map(g=>prior.find(old=>equal(grantShape(old),g))??{...g,grantedBy:party(actor.principal),grantedAt:now});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const pad=at=>String(Math.max(0,Math.min(at,999999999999999))).padStart(15,'0');
export {ORG_ADMIN_DELAY_MS};
// ORG_MIN_RESPONSE_MS is a provisional coordinator choice (security review M1): no request can elevate before the subject
// had a day to answer. Lowering the period notifies every admin and applies only to requests created afterwards.
export const ORG_RESPONSE_MS=7*DAY,ORG_MIN_RESPONSE_MS=DAY;
/** Per-member list caps (wargame F-01; provisional): muted requesters, and the app clients remembered for removal
 * delivery. Each stored membership row is also held to ORG_ROW_BYTES. */
/** Admin listing page size (default and maximum; provisional). */
export const ORG_MEMBERS_PAGE=100,ORG_MEMBERS_PAGE_MAX=500;
export const ORG_MUTED_LIMIT=64,ORG_CONTEXT_CLIENT_LIMIT=32,ORG_CONTEXT_CLIENT_CHARS=1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** A principal named in input: an https issuer origin (http only on a loopback host) and a UUID subject. */
export function validPrincipal(p){
 if(!plain(p)||Object.keys(p).some(k=>!['iss','sub'].includes(k))||typeof p.iss!=='string'||p.iss.length>255||typeof p.sub!=='string'||!UUID.test(p.sub))return false;
 let url;try{url=new URL(p.iss);}catch{return false;}
 return url.origin===p.iss&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));
}
/** The invitation id an `invitation` input names: the id itself, or the `jti` of its signed link metadata (a lookup
 * only; the stored row must then carry exactly that metadata). */
function invitationId(value){
 if(typeof value!=='string'||value.length>8192)return null;if(/^[a-f0-9]{64}$/.test(value))return value;
 const parts=value.split('.');if(parts.length!==3)return null;
 try{const claims=JSON.parse(atob(parts[1].replaceAll('-','+').replaceAll('_','/')));return typeof claims?.jti==='string'&&/^[a-f0-9]{64}$/.test(claims.jti)?claims.jti:null;}catch{return null;}
}
/** Defaults on a record whose roster is attached; a record without one gets its initial admin row (creation). */
export function membershipState(record,random,now){
 const roster=rosterOf(record);
 if(record.roster?.v!==ORG_ROSTER_VERSION){if(!roster)throw new TypeError('The organization roster is not attached.');const p=record.initialAdmin;record.roster={v:ORG_ROSTER_VERSION,live:0};roster.putMember(principalKey(p),{id:random.uuid().replaceAll('-',''),principal:party(p),state:'live',generation:1,grants:[{power:'admin',grantedBy:party(p),grantedAt:now}],aep:0,addedUnder:null,createdAt:now});}
 record.responsePeriodMs??=ORG_RESPONSE_MS;return record;
}
export class MembershipService extends OrganizationService{
 constructor(options){super(options);this.invitationSigner=options.invitationSigner;this.memberEvents=options.memberEvents;}
 async audit(tx,record,action,actor,detail={}){
  const previous=record.auditHead??null;await super.audit(tx,record,action,actor,detail);
  const key='org/audit/'+String(record.auditSeq).padStart(12,'0'),entry=await tx.get(key);entry.previous=previous;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(entry)));entry.hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');record.auditHead=entry.hash;await tx.put(key,entry);
 }
 /** The record with its roster attached: the acting principal's and the owner of record's memberships preloaded. */
 async organization(tx,actor,options){const r=await super.organization(tx,actor,options);await attachRoster(tx,r,[actor.principal,r.ownerOfRecord]);membershipState(r,this.random,this.clock.now());return r;}
 /** A system read of the record inside `tx` with the roster attached, or the raw value when it is no organization. */
 async open(tx,principals=[]){const r=await tx.get(ORG_RECORD);if(r?.kind!=='organization')return r;await attachRoster(tx,r,[...principals,r.ownerOfRecord]);membershipState(r,this.random,this.clock.now());return r;}
 /** A read outside any write: the record with the named principals' memberships. */
 load(principals=[]){return loadOrganization(this.metadata,principals);}
 /** Before every commit: close requests a membership change made stale, run the registered commit hooks (ORG-10:
  * relation invitations withdrawn on a pending deletion or an issuer's removal), then write the changed roster rows. */
 async beforeCommit(tx,r,actor){const roster=rosterOf(r);if(!roster)return false;await this.settle(tx,r,actor);let hooked=false;for(const hook of this.commitHooks??[])hooked=await hook(tx,r,actor)||hooked;return await roster.flush(this.clock.now())||hooked;}
 async settle(tx,r,actor){
  const roster=rosterOf(r);
  for(const {member:m,before} of roster.changedMembers()){
   if(!before||before.state===m.state&&before.generation===m.generation&&equal(before.grants,m.grants))continue;
   for(const q of await roster.requestsFor(m.id))if(openRequest(q)&&(m.state!=='live'||m.generation!==q.generation||!equal(m.grants,q.base))){q.state='closed';await this.audit(tx,r,'member-grant-request-closed',actor??{kind:'system'},{request:q.id});}
  }
 }
 /** Commit tail shared by every frame: roster rows, then the record when it changed. */
 async finish(tx,r,before,actor,now){await this.beforeCommit(tx,r,actor);if(JSON.stringify(r)!==before){r.revision++;r.updatedAt=now;await tx.put(ORG_RECORD,r);}}

 async initializeMembership(tx,record,now,addedUnder){await attachRoster(tx,record);membershipState(record,this.random,now);record.memberships[principalKey(record.initialAdmin)].addedUnder=structuredClone(addedUnder??null);}
 async frame(actor,input,names,apply,{admin=false,allowOwner=false,exposure=true,fresh=false,exit=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!names.includes(k)))fail('invalid_request','Unsupported membership request.',400);
  if(exposure&&!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  return this.metadata.transaction(async tx=>{
   const r=await this.organization(tx,actor,{write:true}),now=this.clock.now(),roster=rosterOf(r),m=r.memberships[principalKey(actor.principal)];
   // Deletion fence (review M3): only exit paths (leave, decide, mute, reconfirm) stay open while deletion is pending.
   if(!exit&&r.state!=='active')fail('organization_deletion_pending','This organization is scheduled for deletion.',409);
   const powers=organizationPowers(r,actor.principal,{now});
   if(admin&&!powers.includes('admin')&&!(allowOwner&&powers.includes('owner-of-record')))fail('not_found','Not found.',404);
   if(fresh)requireFresh(actor,now);
   const before=JSON.stringify(r),result=await apply(r,input,now,m,tx,roster);await this.finish(tx,r,before,actor,now);return structuredClone(result);
  });
 }
 /** Hook (no-op here): an owner of record's decision on an elevated request, inside its commit. ORG-12a's break-glass
  * service uses it for T14 (an owner decision aborts a pending claim) and the contest-window restriction. */
 async ownerDecision(){}
 notice(r,type,detail,now){
  const row={id:this.random.uuid(),type,at:now,...structuredClone(detail)},roster=rosterOf(r);
  if(type==='member-grant-consent')roster.notice(row,{members:[detail.membership_id]});else if(type==='member-removed')roster.notice(row);else roster.notice(row,{admins:true});
 }
 async operator(r,now){if(!hasOperator(await rosterOf(r).admins(),now))fail('last_admin','The organization needs an active admin without an expiry.',409);}
 async end(r,m,actor,reason,now,tx){
  if(m.state!=='live')return;
  if(samePrincipal(m.principal,r.ownerOfRecord))fail('owner_must_be_member','Transfer ownership before leaving.',409);
  const admin=memberPowers(m,now).includes('admin');m.state='ended';m.generation++;m.endedAt=now;m.endReason=reason;if(admin)await this.operator(r,now);
  for(const client of m.contextClients??[])this.notice(r,'member-removed',{client,membership_id:m.id,generation:m.generation},now);
  const roster=rosterOf(r);
  // Requests about the member, and requests the member made, close with the membership.
  for(const q of [...await roster.requestsFor(m.id),...await roster.requestsBy(m.principal)])if(openRequest(q)){q.state='closed';await this.audit(tx,r,'member-grant-request-closed',actor,{request:q.id});}
  await this.audit(tx,r,'member-ended',actor,{membership:m.id,reason});
 }
 async invite(actor,input){
  let signer;if(this.invitationSigner){const r=await this.load([actor?.principal]);if(!this.enabled(actor?.owner)||!organizationPowers(r,actor?.principal,{now:this.clock.now()}).includes('admin'))fail('not_found','Not found.',404);signer=await this.invitationSigner(actor.owner);}
  return this.frame(actor,input,['invitee','grants','expiresAt','expires_at'],async(r,v,now,m,tx,roster)=>{
  let proposal;try{proposal=invitationProposal(v,now);}catch{fail('invalid_invitation','Unsupported invitation.',400);}
  if(await roster.pendingInvitations(now)>=256)fail('invitation_limit','Too many invitations.',429);
  const id=this.random.uuid().replaceAll('-','')+this.random.uuid().replaceAll('-',''),row={...proposal,id,state:'pending',by:party(actor.principal),createdAt:now};if(signer)Object.assign(row,await signOrganizationInvitation({row,record:r,issuer:this.issuer,signer}));roster.putInvitation(row);
  await this.audit(tx,r,'member-invited',actor,{invitation:id,invitee:row.invitee});return {invitation:id,type:row.type,invitee:row.invitee,expiresAt:row.expiresAt,grants:row.grants,...row.meta?{meta:row.meta,url:row.url}:{}};
 },{admin:true});}
 accept(actor,input){return this.frame(actor,input,['invitation'],async(r,v,now,old,tx,roster)=>{
  const id=invitationId(v.invitation),i=id?await roster.invitation(id):undefined;
  if(!i||(i.meta?i.meta!==v.invitation:i.id!==v.invitation)||i.state!=='pending'||i.expiresAt<=now||i.invitee&&!samePrincipal(i.invitee,actor.principal))fail('invitation_invalid','This invitation is invalid.',400);
  if(typeof actor.addedUnder?.kid!=='string'||!actor.addedUnder.kid||!actor.addedUnder.publicKey||typeof actor.addedUnder.publicKey!=='object')fail('identity_provenance_required','Verified identity key evidence is required.',403);
  const promote=old?.state==='live'&&!currentAdmin(old,now)&&i.invitee&&i.grants.some(g=>g.power==='admin');
  if(old?.state==='live'&&!promote)fail('invitation_invalid','This invitation is invalid.',400);
  if(old&&actor.aep<old.aep)fail('authority_epoch_stale','Authority epoch is stale.',403);
  const key=principalKey(actor.principal),m={id:old?.id??this.random.uuid().replaceAll('-',''),principal:party(actor.principal),state:'live',generation:promote?old.generation:(old?.generation??0)+1,
   grants:[...promote?old.grants:[],...stamp(i.grants,actor,now).map(g=>({...g,...g.power?{notBefore:now+ORG_ADMIN_DELAY_MS}:{}}))],aep:Math.max(old?.aep??0,actor.aep??0),addedUnder:structuredClone(old?.addedUnder??actor.addedUnder??null),createdAt:old?.createdAt??now,...promote?{contextClients:old.contextClients??[],hold:old.hold??null,...old.mutedRequesters?{mutedRequesters:old.mutedRequesters}:{},...old.expires_at!==undefined?{expires_at:old.expires_at}:{}}:{},...!promote&&i.expires_at!==undefined?{expires_at:i.expires_at}:{}};
  roster.putMember(key,m);i.state='accepted';i.membership=m.id;this.notice(r,'member-joined',{membership_id:m.id},now);await this.audit(tx,r,'member-accepted',actor,{membership:m.id});
  // F-07: the new member's certification keys are cached before their first token request.
  await enqueueMemberKeyRefresh(tx,party(actor.principal),{now});
  return {membership_id:m.id,generation:m.generation,adminNotBefore:hasAdmin(m)?now+ORG_ADMIN_DELAY_MS:null};
 });}
 /** Pre-acceptance preview (2026-10-23, provisional): the organization's display name, kind and handle, read from its
  * own record (never inviter-written text), for an invitation the acting principal could accept now (pending,
  * unexpired, unrevoked, and bound to them or unbound) at an active organization. Every other case, including an
  * unknown organization, is the same not_found, so the preview is no oracle about which organizations or invitations
  * exist. Read-only: nothing is consumed. */
 invitationPreview(actor,input){return this.frame(actor,input,['invitation'],async(r,v,now,m,tx,roster)=>{
  const id=invitationId(v.invitation),i=id?await roster.invitation(id):undefined;
  if(r.state!=='active'||!i||(i.meta?i.meta!==v.invitation:i.id!==v.invitation)||i.state!=='pending'||i.expiresAt<=now||i.invitee&&!samePrincipal(i.invitee,actor.principal))fail('not_found','Not found.',404);
  return {organization:{name:r.name,label:r.label,handle:r.handle??null},expiresAt:i.expiresAt,bound:Boolean(i.invitee),member:liveMember(m,now)};
 },{exit:true});}
 /** Admin: withdraws an open invitation. It closes as `revoked` (pruned with the other closed invitations), and
  * accepting it then fails exactly like an invalid one. A reducing operation: open during a ramp-down, a lapse or a
  * pending deletion. */
 revokeInvitation(actor,input){return this.frame(actor,input,['invitation'],async(r,v,now,m,tx,roster)=>{
  const id=invitationId(v.invitation),i=id?await roster.invitation(id):undefined;
  if(!i||i.state!=='pending')fail('not_found','Not found.',404);
  i.state='revoked';i.revokedBy=party(actor.principal);i.revokedAt=now;
  await this.audit(tx,r,'member-invitation-revoked',actor,{invitation:i.id});return {revoked:true,invitation:i.id};
 },{admin:true,exposure:false,exit:true});}
 /** Admin listing, paged (scalability follow-up): up to `limit` (default 100, at most 500) membership rows in key order
  * after `after`, of which the live ones are returned, and one page of stored requests after `requestsAfter`. `next` and
  * `requestsNext` are the cursors (null at the end). Store work is bounded by the page, not the roster. */
 members(actor,input={}){return this.frame(actor,input,['after','limit','requestsAfter'],async(r,v,now,m,tx,roster)=>{
  const cursor=x=>x===undefined||typeof x==='string'&&x.length<=1024;
  if(!cursor(v.after)||!cursor(v.requestsAfter)||v.limit!==undefined&&(!Number.isSafeInteger(v.limit)||v.limit<1||v.limit>ORG_MEMBERS_PAGE_MAX))fail('invalid_request','Unsupported membership request.',400);
  const limit=v.limit??ORG_MEMBERS_PAGE,page=await roster.page({after:v.after,limit}),requests=await roster.requestPage({after:v.requestsAfter,limit});
  return {members:page.members.filter(x=>x.state==='live'),next:page.next,requests:requests.requests,requestsNext:requests.next};
 },{admin:true});}
 leave(actor,input={}){return this.frame(actor,input,[],async(r,v,now,m,tx)=>{if(!m||m.state!=='live')fail('not_found','Not found.',404);await this.end(r,m,actor,'left',now,tx);return {left:true};},{exposure:false,exit:true});}
 remove(actor,input){return this.frame(actor,input,['membership','reason'],async(r,v,now,self,tx,roster)=>{
  const m=await roster.memberById(v.membership);if(m?.state!=='live')fail('not_found','Not found.',404);
  if(hasAdmin(m)&&!samePrincipal(m.principal,actor.principal))return this.request(r,actor,m,[],true,v.reason,now,tx);
  if(!organizationPowers(r,actor.principal,{now}).includes('admin'))fail('not_found','Not found.',404);
  await this.end(r,m,actor,'removed',now,tx);return {removed:true};
 },{admin:true,allowOwner:true});}
 grants(actor,input){return this.frame(actor,input,['membership','grants','reason'],async(r,v,now,self,tx,roster)=>{
  const m=await roster.memberById(v.membership);if(m?.state!=='live')fail('not_found','Not found.',404);
  let grants;try{grants=normalizeMemberGrants(v.grants);}catch{fail('invalid_grants','Unsupported member grants.',400);}
  if(grants.some(g=>g.power==='admin'&&(g.expires_at===undefined||g.expires_at>now/1000))&&!currentAdmin(m,now))fail('bound_invitation_required','New governance powers need a bound invitation.',409);
  const gmChanged=!equal(m.grants.filter(g=>g.power).map(grantShape),grants.filter(g=>g.power));
  if(hasAdmin(m)&&gmChanged&&!samePrincipal(m.principal,actor.principal))return this.request(r,actor,m,grants,false,v.reason,now,tx);
  if(!organizationPowers(r,actor.principal,{now}).includes('admin')&&!samePrincipal(m.principal,actor.principal))fail('not_found','Not found.',404);
  // Self changes may only narrow. New grants to others are normal admin operations.
  if(samePrincipal(m.principal,actor.principal)&&grants.some(g=>!m.grants.some(old=>{const previous=grantShape(old);return g.power?g.power===previous.power&&(g.expires_at??Infinity)<=(previous.expires_at??Infinity):g.resource===previous.resource&&(g.expires_at??Infinity)<=(previous.expires_at??Infinity)&&Object.entries(g.methods??{}).every(([c,ms])=>ms.every(method=>previous.methods?.[c]?.includes(method)));})))fail('self_widening','Self changes may only remove grants.',409);
  m.grants=stamp(grants,actor,now,m.grants).map(g=>({...g,...g.power&&m.grants.find(old=>old.power===g.power)?.notBefore?{notBefore:m.grants.find(old=>old.power===g.power).notBefore}:{}}));await this.operator(r,now);await this.audit(tx,r,'member-grants-changed',actor,{membership:m.id});return {changed:true};
 },{admin:true,allowOwner:true});}
 async request(r,actor,m,grants,remove,reason,now,tx){
  if(typeof reason!=='string'||!reason.trim()||[...reason].length>280||/[\u0000-\u001f]/.test(reason))fail('invalid_reason','Give a reason of at most 280 characters.',400);
  const roster=rosterOf(r),about=await roster.requestsFor(m.id);
  const open=about.find(q=>equal(q.grants,grants)&&q.remove===remove&&openRequest(q));if(open)return {request:open};
  // Closed requests are retained ORG_RETENTION_MS (30 days) after closing, so the 30-day window below sees them all.
  const recent=about.filter(q=>samePrincipal(q.requester,actor.principal)&&q.createdAt>now-30*DAY);if(recent.length>=3)fail('request_limit','Too many requests for this member.',429);
  const q={id:this.random.uuid(),target:m.id,generation:m.generation,base:structuredClone(m.grants),grants,remove,requester:party(actor.principal),reason:reason.trim(),createdAt:now,elevateAt:now+r.responsePeriodMs,state:'subject',subjectRejected:(m.mutedRequesters??[]).some(p=>samePrincipal(p,actor.principal))};
  roster.putRequest(q);this.notice(r,'member-grant-consent',{membership_id:m.id,request:q.id},now);await this.audit(tx,r,'member-grant-requested',actor,{request:q.id});return {request:q};
 }
 decide(actor,input){return this.frame(actor,input,['request','decision'],async(r,v,now,self,tx,roster)=>{
  const q=await roster.request(v.request),m=q?await roster.memberById(q.target):undefined;
  if(!q||!openRequest(q))fail('not_found','Not found.',404);
  if(!m||m.state!=='live'||m.generation!==q.generation||!equal(m.grants,q.base)){q.state='closed';await this.audit(tx,r,'member-grant-request-closed',actor,{request:q.id});return {request:q};}
  const subject=samePrincipal(m.principal,actor.principal),requester=samePrincipal(q.requester,actor.principal),owner=samePrincipal(r.ownerOfRecord,actor.principal),ownerSubject=samePrincipal(m.principal,r.ownerOfRecord),powers=organizationPowers(r,actor.principal,{now});
  if(v.decision==='retract'&&requester)q.state='retracted';
  else if(v.decision==='elevate'&&requester&&!ownerSubject&&(q.subjectRejected||now>=q.elevateAt)){
   if(!powers.includes('admin')&&!powers.includes('owner-of-record'))fail('not_found','Not found.',404);const ownerMember=r.memberships[principalKey(r.ownerOfRecord)];q.state=!ownerMember?.hold&&(ownerMember?.mutedRequesters??[]).some(p=>samePrincipal(p,q.requester))?'rejected':'elevated';this.notice(r,'member-grant-elevated',{request:q.id},now);
  }else if(v.decision==='reject'&&(subject||owner&&q.state==='elevated')){requireFresh(actor,now);if(!subject)await this.ownerDecision(r,q,m,actor,'reject',now,tx);if(!subject&&self?.hold)fail('authority_held','Governance authority is held.',403);if(subject&&!ownerSubject)q.subjectRejected=true;else q.state='rejected';}
  else if(v.decision==='accept'&&(subject||owner&&q.state==='elevated'&&!ownerSubject)){
   requireFresh(actor,now);if(self?.hold)fail('authority_held','Governance authority is held.',403);
   if(!subject)await this.ownerDecision(r,q,m,actor,'accept',now,tx);
   if(!subject){if(!powers.includes('owner-of-record'))fail('authority_held','Governance authority is held.',403);const proof=actor.verification;if(!proof||!Number.isSafeInteger(proof.stepUpAt)||proof.stepUpAt>now||proof.stepUpAt+300000<=now||!Number.isSafeInteger(proof.enrolledAt)||proof.enrolledAt<0||proof.enrolledAt>now-7*DAY||!Number.isSafeInteger(proof.securityChangedAt)||proof.securityChangedAt<0||proof.securityChangedAt>now-30*DAY)fail('tight_verification_required','Confirm with an established credential after the security cooling period.',401);}
   if(q.remove)await this.end(r,m,actor,'removed',now,tx);else{m.grants=stamp(q.grants,actor,now,m.grants).map(g=>({...g,...g.power&&m.grants.find(old=>old.power===g.power)?.notBefore?{notBefore:m.grants.find(old=>old.power===g.power).notBefore}:{}}));await this.operator(r,now);}q.state='accepted';this.notice(r,'member-grants-changed',{membership_id:m.id,request:q.id,requester:q.requester,owner:r.ownerOfRecord,reason:q.reason},now);
  }else fail('invalid_decision','This decision is not available.',409);
  await this.audit(tx,r,'member-grant-decision',actor,{request:q.id,decision:v.decision});return {request:q};
 },{exposure:false,exit:true});}
 // Review M2: mute is a decision path. It needs fresh authentication, and a held member's mute closes nothing as owner;
 // it records only the preference (which decide's elevation also ignores while the owner is held).
 // Wargame F-01 (and its review follow-ups): the requester must be a valid principal (https issuer, UUID subject). Any
 // valid principal is stored, member or not, so neither the answer, the work nor the list's length depends on
 // membership; growth is bounded by the 64-entry cap and the 64 KiB row budget. Open requests by the requester are
 // the only thing that varies, and only in their effect. Mute follows ORGANIZATIONS_ENABLED like every widening path
 // (a subject still answers every request through `decide`).
 mute(actor,input){return this.frame(actor,input,['requester','muted'],async(r,v,now,m,tx,roster)=>{
  if(!m||m.state!=='live'||!validPrincipal(v.requester)||typeof v.muted!=='boolean')fail('invalid_request','Invalid mute.',400);
  requireFresh(actor,now);
  const requester=party(v.requester),list=m.mutedRequesters??[],listed=list.some(p=>samePrincipal(p,requester));
  if(v.muted&&!listed&&list.length>=ORG_MUTED_LIMIT)fail('mute_limit','You have muted the most requesters this organization allows. Unmute someone first.',409);
  m.mutedRequesters=v.muted?listed?list:[...list,requester]:list.filter(p=>!samePrincipal(p,requester));m.mutesRevision=(m.mutesRevision??0)+1;
  if(v.muted)for(const q of await roster.requestsBy(requester)){if(!openRequest(q))continue;if(q.target===m.id&&q.state==='subject')q.subjectRejected=true;if(samePrincipal(m.principal,r.ownerOfRecord)&&q.state==='elevated'&&!m.hold)q.state='rejected';}
  await this.audit(tx,r,'member-request-mute',actor,{requester,muted:v.muted});return {muted:v.muted};
 },{exit:true});}
 policy(actor,input){return this.frame(actor,input,['responsePeriodMs'],async(r,v,now,m,tx)=>{
  if(!Number.isSafeInteger(v.responsePeriodMs)||v.responsePeriodMs<ORG_MIN_RESPONSE_MS||v.responsePeriodMs>365*DAY)fail('invalid_request','The response period must be between one day and one year.',400);
  const previous=r.responsePeriodMs;if(previous===v.responsePeriodMs)return {responsePeriodMs:previous};
  // Existing requests keep the elevateAt computed when they were created, so a lowered period applies only afterwards.
  r.responsePeriodMs=v.responsePeriodMs;if(v.responsePeriodMs<previous)this.notice(r,'member-response-period-lowered',{previous,responsePeriodMs:v.responsePeriodMs},now);
  await this.audit(tx,r,'member-response-period',actor,{previous,responsePeriodMs:v.responsePeriodMs});return {responsePeriodMs:r.responsePeriodMs};
 },{admin:true});}
 async lookup(actor,{principal}={}){if(actor?.kind!=='system')fail('forbidden','System only.',403);return this.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD);if(r?.id!==actor.owner)return null;const m=await tx.get(ORG_KEYS.member+principalKey(principal)),now=this.clock.now();return m?.state==='live'&&(m.expires_at===undefined||m.expires_at>now/1000)?{id:m.id,generation:m.generation,aep:m.aep}:null;});}
 async observe(actor,input){if(actor?.kind!=='system'||(await this.metadata.get(ORG_RECORD))?.id!==actor.owner)fail('not_found','Not found.',404);return this.observeAuthority(input.principal,input);}
 /** Remembers an app client for `member-removed` delivery, most recent last. Beyond ORG_CONTEXT_CLIENT_LIMIT the least
  * recently used client is forgotten (review follow-up 8), so a member is never locked out of a new app; a forgotten
  * client's tokens still fail the live generation check after removal, it only misses the removal event. */
 rememberClient(m,client){
  if(typeof client!=='string'||!client||client.length>ORG_CONTEXT_CLIENT_CHARS)fail('invalid_request','Invalid client.',400);
  m.contextClients??=[];if(m.contextClients.at(-1)===client)return;
  m.contextClients=[...m.contextClients.filter(c=>c!==client),client].slice(-ORG_CONTEXT_CLIENT_LIMIT);
 }
 /** Internal ORG-4 port, never owner wire input. Checks principal + opaque id + generation and tracks recipients. */
 async snapshot(actor,{principal,membership_id,generation,client,aep}={}){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  if(aep!==undefined)await this.observe(actor,{principal,aep});
  return this.metadata.transaction(async tx=>{const r=await this.open(tx,[principal]);if(r?.id!==actor.owner||!this.enabled(actor.owner))fail('not_found','Not found.',404);const m=r.memberships[principalKey(principal)],now=this.clock.now(),before=JSON.stringify(r);
   if(!m||m.state!=='live'||m.expires_at!==undefined&&m.expires_at<=now/1000||m.id!==membership_id||m.generation!==generation)fail('not_found','Not found.',404);
   if(client!==undefined)this.rememberClient(m,client);
   await this.finish(tx,r,before,actor,now);
   return {member:structuredClone(m),connections:[{state:'connected',generation:m.generation,expectedGeneration:generation}]};
  });
 }
 /** Trusted adapter evidence only. Persist resets before denying governance, so rejection cannot roll back a hold. */
 async observeAuthority(principal,{aep,reset=false,addedUnder}={}){
  if(!Number.isSafeInteger(aep)||aep<0)fail('authority_epoch_invalid','Authority epoch unavailable.',403);
  return this.metadata.transaction(async tx=>{const r=await this.open(tx,[principal]);if(r?.kind!=='organization')return null;const m=r.memberships[principalKey(principal)];if(!m||m.state!=='live')return null;
   if(aep<m.aep)fail('authority_epoch_stale','Authority epoch is stale.',403);
   if(aep>m.aep||reset){const now=this.clock.now(),before=JSON.stringify(r);m.aep=aep;m.hold={aep,at:now,noticeAt:null,objected:false};if(addedUnder)m.currentPin=structuredClone(addedUnder);this.notice(r,'member-authority-held',{membership_id:m.id,aep},now);await this.audit(tx,r,'member-authority-reset',{kind:'system',principal},{membership:m.id,aep});
    // F-07: an authority reset can come with new certification keys; refresh the cache.
    await enqueueMemberKeyRefresh(tx,party(principal),{now});await this.finish(tx,r,before,{kind:'system',principal},now);}
   return structuredClone(m);
  });
 }
 reconfirm(actor,input){return this.frame(actor,input,['membership','aep','decision'],async(r,v,now,self,tx,roster)=>{
  const m=await roster.memberById(v.membership);if(m?.state!=='live'||!m.hold||m.aep!==v.aep)fail('authority_epoch_stale','This hold changed.',409);
  const other=!samePrincipal(m.principal,actor.principal),admin=memberPowers(self,now).includes('admin'),owner=samePrincipal(m.principal,r.ownerOfRecord);
  requireFresh(actor,now);
  if(v.decision==='approve'&&other&&admin&&!owner)m.hold=null;
  else if(v.decision==='notice'&&(!other||admin)){if(m.hold.noticeAt===null){m.hold.noticeAt=now;this.notice(r,'member-reconfirmation',{membership_id:m.id,aep:m.aep},now);}}
  else if(v.decision==='object'&&other&&admin){m.hold.objected=true;}
  else fail('invalid_decision','This decision is not available.',409);
  await this.audit(tx,r,'member-reconfirmation',actor,{membership:m.id,aep:v.aep,decision:v.decision});return {held:Boolean(m.hold)};
 },{exposure:false,exit:true});}
 /** System: applies what is due in the time index (at most ORG_SWEEP_BATCH entries; the rest wakes at once). Never
  * reads the whole roster, so its cost follows the work due, not the organization's size. */
 async sweep(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const now=this.clock.now();let wakeAt=null;const wake=t=>{if(t>now)wakeAt=Math.min(wakeAt??Infinity,t);};
  // Review follow-up 7: each due entry runs in its own transaction, so one failing step neither rolls back the others
  // nor stalls the sweep; it is rescheduled on its own back-off (1 minute doubling to 6 hours) and retried.
  for(let n=0;;n++){
   if(n>=ORG_SWEEP_BATCH){wake(now+1000);break;}
   let entry=null;
   try{
    const step=await this.metadata.transaction(async tx=>{
     if(await tx.get('owner')!==actor.owner)fail('forbidden','Account mismatch.',403);
     const r=await this.open(tx,[]);if(r?.kind!=='organization')return {done:true,missing:true};
     const [first]=[...await tx.list({prefix:ORG_KEYS.due,limit:1})];if(!first)return {done:true};
     const at=Number(first[0].slice(ORG_KEYS.due.length,ORG_KEYS.due.length+15));if(at>now)return {done:true,at};
     entry=first;const roster=rosterOf(r),before=JSON.stringify(r);
     await tx.delete(first[0]);await this.dueStep(r,roster,first[1],now,tx,actor);const next=roster.nextDue(now);await this.finish(tx,r,before,actor,now);return {next};
    });
    if(step.missing)return {wakeAt:null};
    if(step.done){if(step.at)wake(step.at);break;}
    if(step.next)wake(step.next);
   }catch(error){
    if(!entry||error?.code==='forbidden')throw error;
    const [key,value]=entry,attempts=(value?.attempts??0)+1,retry=now+Math.min(6*3600000,60000*2**Math.min(attempts,9));
    await this.metadata.transaction(async tx=>{await tx.delete(key);await tx.put(ORG_KEYS.due+pad(retry)+'/'+value.kind+'/'+value.ref,{...value,at:retry,attempts,lastError:typeof error?.code==='string'?error.code:'step_failed'});});
    wake(retry);
   }
  }
  if(typeof this.memberEvents==='function')for(const [,e] of await this.metadata.list({prefix:ORG_KEYS.outboxPending,limit:1}))wake(Math.max(e.nextAt??now,now+60000));
  return {wakeAt};
 }
 async dueStep(r,roster,{kind,ref},now,tx,actor){
  if(kind==='invitation-expiry'){const i=await roster.invitation(ref);if(i?.state==='pending'&&i.expiresAt<=now)i.state='expired';}
  else if(kind==='invitation-prune'){const i=await roster.invitation(ref);if(i&&i.state!=='pending'&&(i.closedAt??0)+ORG_RETENTION_MS<=now)roster.removeInvitation(i);}
  else if(kind==='request-prune'){const q=await roster.request(ref);if(q&&!openRequest(q)&&(q.closedAt??0)+ORG_RETENTION_MS<=now)roster.removeRequest(q);}
  else if(kind==='member-hold'){const m=await roster.member(ref);if(m?.state==='live'&&m.hold&&Number.isSafeInteger(m.hold.noticeAt)&&!m.hold.objected&&m.hold.noticeAt+ORG_ADMIN_DELAY_MS<=now&&m.hold.aep===m.aep){const aep=m.hold.aep;m.hold=null;await this.audit(tx,r,'member-authority-reconfirmed',actor,{membership:m.id,aep});}}
  else if(kind==='member-expiry'){const m=await roster.member(ref);if(m?.state==='live'&&m.expires_at!==undefined&&m.expires_at<=now/1000){const generation=m.generation;try{await this.end(r,m,actor,'expired',now,tx);}catch(error){if(!['last_admin','owner_must_be_member'].includes(error.code))throw error;m.state='live';m.generation=generation;delete m.endedAt;delete m.endReason;m.expiryBlocked=true;roster.due(now+3600000,'member-expiry',ref);}}}
  else if(kind==='outbox-prune'){const key=ORG_KEYS.outboxDelivered+ref,e=await tx.get(key);if(e&&(e.deliveredAt??0)+ORG_RETENTION_MS<=now)await tx.delete(key);}
  else if(kind==='outbox-expire'){const key=ORG_KEYS.outboxPending+ref,e=await tx.get(key);if(e!==undefined){await tx.delete(key);if(e?.fanout)await fanoutDone(tx,e.seq);}}
  else if(kind==='admin-reindex')roster.reindex(ref);
 }
 /** Delivers due member outbox events (at most 32 deliveries). Each event retries on its own back-off, so a failing event
  * never blocks the ones behind it; one undeliverable for ORG_OUTBOX_EXPIRY_MS is dropped. A fan-out event (more than
  * ORG_INLINE_ADMINS admins, packages/orgs/admin-index.mjs) is delivered as pages `{..., recipients, page:{index, final}}`
  * of at most ORG_FANOUT_PAGE recipients through the cursor stored on the event; each page counts as one delivery and a
  * failed page is retried from the same cursor. Delivery is at least once: ORGANIZATION_MEMBER_EVENTS consumers deduplicate
  * by event id plus recipient (admin) id, since a retried or racing page can repeat a recipient (review L3, 2026-10-24). */
 async drain(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);if(typeof this.memberEvents!=='function')return {held:true};
  const record=await this.metadata.get(ORG_RECORD);if(record?.id!==actor.owner)fail('not_found','Not found.',404);
  const now=this.clock.now(),due=[];for(const [key,e] of await this.metadata.list({prefix:ORG_KEYS.outboxPending,limit:33})){if((e.nextAt??0)>now||due.length>=32)break;due.push([key,e]);}
  let budget=32,pages=0;
  for(const [key,first] of due){
   let event=first;
   for(;;){
    // Fan-out pages read up to ORG_FANOUT_PAGE index rows each: at most 8 per call, the rest continue at the next one.
    if(event.fanout&&pages>=8||budget<=0)break;budget--;if(event.fanout)pages++;
    const expired=(event.at??0)+ORG_OUTBOX_EXPIRY_MS<=now;let ok=false,page=null;
    if(!expired){const {attempts:_a,nextAt:_n,fanout:_f,...payload}=event;
     if(event.fanout){page=await fanoutPage(this.metadata,event);payload.recipients=[...event.fanout.pages===0?event.recipients??[]:[],...page.ids];payload.page={index:event.fanout.pages,final:page.final};}
     // An empty last page of a fan-out event has nobody left to tell.
     if(page&&page.final&&event.fanout.pages>0&&!payload.recipients.length)ok=true;
     else try{ok=await this.memberEvents(structuredClone(payload))===true;}catch{ok=false;}}
    const next=await this.metadata.transaction(async tx=>{const row=await tx.get(key);if(!row||row.fanout?.pages!==event.fanout?.pages)return null;const at=this.clock.now(),seq=String(row.seq).padStart(12,'0');
     if(ok&&page&&!page.final){const moved={...row,fanout:{...page.cursor,pages:row.fanout.pages+1}};await tx.put(key,moved);return moved;}
     await tx.delete(key);if(row.fanout&&(expired||ok))await fanoutDone(tx,row.seq);
     if(expired)return null;
     if(ok){const {fanout:_f,...kept}=row;await tx.put(ORG_KEYS.outboxDelivered+seq,{...kept,deliveredAt:at});await tx.put(ORG_KEYS.due+pad(at+ORG_RETENTION_MS)+'/outbox-prune/'+seq,{at:at+ORG_RETENTION_MS,kind:'outbox-prune',ref:seq});return null;}
     const attempts=(row.attempts??0)+1,nextAt=at+Math.min(6*3600000,60000*2**Math.min(attempts,9));await tx.put(ORG_KEYS.outboxPending+pad(nextAt)+'/'+seq,{...row,attempts,nextAt});return null;
    });
    if(!next)break;event=next;
   }
   if(budget<=0)break;
  }
  return {held:false};
 }
 /** ORG-4 adapter port: validate generation live, and durably remember recipients for removal delivery. */
 context(actor,input){return this.frame(actor,input,['client','generation'],async(r,v,now,m)=>{if(!m||m.state!=='live'||m.expires_at!==undefined&&m.expires_at<=now/1000||v.generation!==undefined&&m.generation!==v.generation)fail('not_found','Not found.',404);this.rememberClient(m,v.client);return {membership_id:m.id,generation:m.generation,aep:m.aep};});}
 /** ORG-3 authority query. The ceilings come from this organization's own records, never from the caller (ORG-10 review
  * L4): the application ceiling is the active federation grant's approved methods for `field` on `resource`, and the
  * resource ceiling is the registered resource's contracts. The membership generation must match. */
 authority(actor,input){return this.frame(actor,input,['membership','generation','grant','field','resource','descriptor'],async(r,v,now,self,tx,roster)=>{const m=await roster.memberById(v.membership);if(m&&!samePrincipal(m.principal,actor.principal)&&!organizationPowers(r,actor.principal,{now}).includes('admin'))fail('not_found','Not found.',404);if(!Number.isSafeInteger(v.generation)||m?.generation!==v.generation)return v.descriptor?null:{};
  const g=typeof v.grant==='string'?await tx.get('federation/grant/'+v.grant):null,resource=typeof v.resource==='string'?await tx.get('federation/resource/'+v.resource):null,own=(o,k)=>o&&typeof o==='object'&&typeof k==='string'&&Object.hasOwn(o,k)?o[k]:undefined;
  const application=g?.active===true&&Array.isArray(own(g.resources,v.field))&&own(g.resources,v.field).includes(v.resource)?own(g.methods,v.field):undefined;
  const args={member:m,application,resource:resource?{id:v.resource,contracts:resource.contracts}:null,now};return v.descriptor?memberResourceProjection(args,v.descriptor):effectiveAuthority(args);});}

 // ORG-5 discovery reads (2026-10-23, provisional coordinator work). Both answer only about the acting principal's own
 // live membership; a non-member, an ended or expired member and an unknown organization all get the same not_found
 // (ORG-D9: membership is never publicly checkable). They are exit paths, so they stay open while deletion is pending.
 /** The acting member's own view: the organization's public facts, their grants (without other members' provenance)
  * and powers. */
 membership(actor,input={}){return this.frame(actor,input,[],async(r,v,now,m)=>{
  if(!liveMember(m,now))fail('not_found','Not found.',404);
  return {organization:{id:r.id,name:r.name,label:r.label,handle:r.handle??null,state:r.state,deletion:r.deletion?{notBefore:r.deletion.notBefore}:null,ownerOfRecord:samePrincipal(m.principal,r.ownerOfRecord)},
   membership:{id:m.id,generation:m.generation,grants:publicGrants(m.grants),hold:m.hold?{aep:m.hold.aep,noticeAt:m.hold.noticeAt??null}:null,...m.expires_at!==undefined?{expires_at:m.expires_at}:{},createdAt:m.createdAt},
   powers:organizationPowers(r,actor.principal,{now}).sort()};
 },{exit:true});}
 /** Pending grant-management requests where the acting member is the subject, the requester, or the owner of record
  * of an elevated request; each carries the decisions `decide` would accept from this member now. Not flag-gated,
  * like `decide`, so a subject can always answer. Admins still see every request through `members`. */
 requests(actor,input={}){return this.frame(actor,input,[],async(r,v,now,m,tx,roster)=>{
  if(!liveMember(m,now))fail('not_found','Not found.',404);
  const ownerOfRecord=samePrincipal(r.ownerOfRecord,actor.principal);
  const candidates=[...new Set([...await roster.requestsFor(m.id),...await roster.requestsBy(actor.principal),...ownerOfRecord?(await roster.openRequests()).filter(q=>q.state==='elevated'):[]])].filter(openRequest);
  // `requestDecisions` checks the never-without-an-operator guard, which needs every admin row.
  if(candidates.length)await roster.admins();
  const out=[];
  for(const q of candidates){
   const target=await roster.memberById(q.target),roles=[];
   if(q.target===m.id)roles.push('subject');
   if(samePrincipal(q.requester,actor.principal))roles.push('requester');
   if(q.state==='elevated'&&ownerOfRecord&&!(target&&samePrincipal(target.principal,r.ownerOfRecord)))roles.push('owner');
   if(!roles.length)continue;
   out.push({id:q.id,state:q.state,target:q.target,subject:target?party(target.principal):null,requester:party(q.requester),grants:publicGrants(q.grants),remove:q.remove===true,reason:q.reason,createdAt:q.createdAt,elevateAt:q.elevateAt,subjectRejected:q.subjectRejected===true,roles,decisions:requestDecisions(r,q,actor.principal,now)});
  }
  out.sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  return {requests:out};
 },{exposure:false,exit:true});}
 /** The single-writer power check for organization-context adapters (connections, preferences). `widen` marks an
  * operation that can add authority: it needs ORGANIZATIONS_ENABLED and an active organization. Reducing operations
  * (list, suspend, disconnect) stay available during a ramp-down or a pending deletion. A missing power is not_found. */
 actingAuthority(actor,input){return this.frame(actor,input,['power','widen'],async(r,v,now)=>{
  if(!['admin','owner-of-record'].includes(v.power)||v.widen!==undefined&&typeof v.widen!=='boolean')fail('invalid_request','Unsupported membership request.',400);
  const powers=organizationPowers(r,actor.principal,{now});if(!powers.includes(v.power))fail('not_found','Not found.',404);
  if(v.widen&&!this.enabled(actor.owner))fail('not_found','Not found.',404);
  if(v.widen&&r.state!=='active')fail('organization_deletion_pending','This organization is scheduled for deletion.',409);
  return {organization:r.id,powers:[...powers].sort(),state:r.state,authTime:actor.authTime??null};
 },{exposure:false,exit:true});}
}
/** The never-without-an-operator guard (§12c.3) as a pure check over membership rows (every admin row suffices). */
function hasOperator(members,now){return members.some(m=>memberPowers(m,now).includes('admin'))&&members.some(m=>m.state==='live'&&!m.hold&&m.expires_at===undefined&&m.grants.some(g=>g.power==='admin'&&g.expires_at===undefined&&(g.notBefore??0)<=now));}
/** Whether accepting `q` would pass the guards `decide` applies when it commits: the owner of record cannot be removed
 * (they must transfer ownership first), and no change may leave the organization without a permanent active admin. */
function acceptable(r,q,m,now){
 if(q.remove)return !samePrincipal(m.principal,r.ownerOfRecord)&&(!memberPowers(m,now).includes('admin')||hasOperator(Object.values(r.memberships).filter(x=>x!==m),now));
 const changed={...m,grants:q.grants.map(g=>({...g,...g.power&&m.grants.find(old=>old.power===g.power)?.notBefore?{notBefore:m.grants.find(old=>old.power===g.power).notBefore}:{}}))};
 return hasOperator(Object.values(r.memberships).map(x=>x===m?changed:x),now);
}
const liveMember=(m,now)=>m?.state==='live'&&(m.expires_at===undefined||m.expires_at>now/1000);
/** Grants as a member may see them: no grantor principal (that would disclose other members to non-admins). */
const publicGrants=grants=>(grants??[]).map(g=>Object.fromEntries(Object.entries(g).filter(([k])=>k!=='grantedBy')));
/**
 * The decisions `MembershipService#decide` accepts from `principal` for request `q` right now, assuming a fresh
 * authentication (and, for an owner's acceptance, tight verification). Mirrors decide's rules exactly; a request that
 * no longer applies offers nothing (decide would close it).
 */
export function requestDecisions(r,q,principal,now){
 const m=Object.values(r.memberships??{}).find(x=>x.id===q?.target);
 if(!q||!['subject','elevated'].includes(q.state)||!m||m.state!=='live'||m.generation!==q.generation||!equal(m.grants,q.base))return [];
 const self=r.memberships[principalKey(principal)],held=Boolean(self?.hold),subject=samePrincipal(m.principal,principal),requester=samePrincipal(q.requester,principal),owner=samePrincipal(r.ownerOfRecord,principal),ownerSubject=samePrincipal(m.principal,r.ownerOfRecord),powers=organizationPowers(r,principal,{now}),out=[];
 if(!held&&(subject||owner&&q.state==='elevated'&&!ownerSubject&&powers.includes('owner-of-record'))&&acceptable(r,q,m,now))out.push('accept');
 if(subject&&(ownerSubject||!q.subjectRejected)||!subject&&owner&&q.state==='elevated'&&!held)out.push('reject');
 if(requester&&q.state==='subject'&&!ownerSubject&&(q.subjectRejected||now>=q.elevateAt)&&(powers.includes('admin')||powers.includes('owner-of-record')))out.push('elevate');
 if(requester)out.push('retract');
 return out;
}
