// ORG-2. One organization record is the transaction boundary for grants, generations, governance and the outbox.
// Adapters MUST supply authenticated principal/evidence; no certificate, key or step-up assertion comes from input.
import {OrganizationService,ORG_RECORD} from './organizations.mjs';
import {organizationPowers,requireFresh} from './authority.mjs';
import {principalKey,samePrincipal,memberPowers,normalizeMemberGrants,effectiveAuthority,memberResourceProjection} from './grants.mjs';
import {invitationProposal,signOrganizationInvitation} from './invitations.mjs';
import {AppFault} from '../app/faults.mjs';
const DAY=86400000,fail=(code='not_found',message='Not found.',status=409)=>{throw new AppFault(code,message,status);};
const party=p=>({iss:p.iss??null,sub:p.sub}),hasAdmin=m=>m?.grants?.some(g=>g.power==='admin');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const currentAdmin=(m,now)=>m?.grants?.some(g=>g.power==='admin'&&(g.expires_at===undefined||g.expires_at>now/1000));
const grantShape=g=>Object.fromEntries(Object.entries(g).filter(([k])=>!['grantedBy','grantedAt','notBefore'].includes(k)));
const stamp=(grants,actor,now,prior=[])=>grants.map(g=>prior.find(old=>equal(grantShape(old),g))??{...g,grantedBy:party(actor.principal),grantedAt:now});
// ORG_MIN_RESPONSE_MS is a provisional coordinator choice (security review M1): no request can elevate before the subject
// had a day to answer. Lowering the period notifies every admin and applies only to requests created afterwards.
export const ORG_RESPONSE_MS=7*DAY,ORG_ADMIN_DELAY_MS=3*DAY,ORG_MIN_RESPONSE_MS=DAY;
export function membershipState(record,random,now){
 if(!record.memberships){const p=record.initialAdmin;record.memberships={[principalKey(p)]:{id:random.uuid().replaceAll('-',''),principal:party(p),state:'live',generation:1,grants:[{power:'admin',grantedBy:party(p),grantedAt:now}],aep:0,addedUnder:null,createdAt:now}};}
 record.invitations??={};record.grantRequests??={};record.memberOutbox??=[];record.responsePeriodMs??=ORG_RESPONSE_MS;return record;
}
export class MembershipService extends OrganizationService{
 constructor(options){super(options);this.invitationSigner=options.invitationSigner;this.memberEvents=options.memberEvents;}
 async audit(tx,record,action,actor,detail={}){
  const previous=record.auditHead??null;await super.audit(tx,record,action,actor,detail);
  const key='org/audit/'+String(record.auditSeq).padStart(12,'0'),entry=await tx.get(key);entry.previous=previous;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(entry)));entry.hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');record.auditHead=entry.hash;await tx.put(key,entry);
 }

 initializeMembership(record,now,addedUnder){membershipState(record,this.random,now);record.memberships[principalKey(record.initialAdmin)].addedUnder=structuredClone(addedUnder??null);}
 async frame(actor,input,names,apply,{admin=false,allowOwner=false,exposure=true,fresh=false,exit=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!names.includes(k)))fail('invalid_request','Unsupported membership request.',400);
  if(exposure&&!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  return this.metadata.transaction(async tx=>{
   const r=membershipState(await this.organization(tx,actor,{write:true}),this.random,this.clock.now()),now=this.clock.now(),m=r.memberships[principalKey(actor.principal)];
   // Deletion fence (review M3): only exit paths (leave, decide, mute, reconfirm) stay open while deletion is pending.
   if(!exit&&r.state!=='active')fail('organization_deletion_pending','This organization is scheduled for deletion.',409);
   const powers=organizationPowers(r,actor.principal,{now});
   if(admin&&!powers.includes('admin')&&!(allowOwner&&powers.includes('owner-of-record')))fail('not_found','Not found.',404);
   if(fresh)requireFresh(actor,now);
   const before=JSON.stringify(r),result=await apply(r,input,now,m,tx);if(JSON.stringify(r)!==before){r.revision++;r.updatedAt=now;await tx.put(ORG_RECORD,r);}return structuredClone(result);
  });
 }
 notice(r,type,detail,now){const recipients=type==='member-grant-consent'?[detail.membership_id]:Object.values(r.memberships).filter(m=>m.state==='live'&&hasAdmin(m)).map(m=>m.id);r.memberOutbox.push({id:this.random.uuid(),type,at:now,...type==='member-removed'?{}:{recipients},...structuredClone(detail)});}
 operator(r,now){const members=Object.values(r.memberships);if(!members.some(m=>memberPowers(m,now).includes('admin'))||!members.some(m=>m.state==='live'&&!m.hold&&m.expires_at===undefined&&m.grants.some(g=>g.power==='admin'&&g.expires_at===undefined&&(g.notBefore??0)<=now)))fail('last_admin','The organization needs an active admin without an expiry.',409);}
 async end(r,m,actor,reason,now,tx){
  if(m.state!=='live')return;
  if(samePrincipal(m.principal,r.ownerOfRecord))fail('owner_must_be_member','Transfer ownership before leaving.',409);
  const admin=memberPowers(m,now).includes('admin');m.state='ended';m.generation++;m.endedAt=now;m.endReason=reason;if(admin)this.operator(r,now);
  for(const client of m.contextClients??[])this.notice(r,'member-removed',{client,membership_id:m.id,generation:m.generation},now);
  for(const q of Object.values(r.grantRequests))if(q.target===m.id&&['subject','elevated'].includes(q.state)){q.state='closed';await this.audit(tx,r,'member-grant-request-closed',actor,{request:q.id});}
  await this.audit(tx,r,'member-ended',actor,{membership:m.id,reason});
 }
 async invite(actor,input){
  let signer;if(this.invitationSigner){const r=await this.metadata.get(ORG_RECORD);if(!this.enabled(actor?.owner)||!organizationPowers(r,actor?.principal,{now:this.clock.now()}).includes('admin'))fail('not_found','Not found.',404);signer=await this.invitationSigner(actor.owner);}
  return this.frame(actor,input,['invitee','grants','expiresAt','expires_at'],async(r,v,now,m,tx)=>{
  let proposal;try{proposal=invitationProposal(v,now);}catch{fail('invalid_invitation','Unsupported invitation.',400);}
  if(Object.values(r.invitations).filter(i=>i.state==='pending'&&i.expiresAt>now).length>=256)fail('invitation_limit','Too many invitations.',429);
  const id=this.random.uuid().replaceAll('-','')+this.random.uuid().replaceAll('-',''),row={...proposal,id,state:'pending',by:party(actor.principal),createdAt:now};r.invitations[id]=row;if(signer)Object.assign(row,await signOrganizationInvitation({row,record:r,issuer:this.issuer,signer}));
  await this.audit(tx,r,'member-invited',actor,{invitation:id,invitee:row.invitee});return {invitation:id,type:row.type,invitee:row.invitee,expiresAt:row.expiresAt,grants:row.grants,...row.meta?{meta:row.meta,url:row.url}:{}};
 },{admin:true});}
 accept(actor,input){return this.frame(actor,input,['invitation'],async(r,v,now,old,tx)=>{
  const i=Object.values(r.invitations).find(i=>i.meta?i.meta===v.invitation:i.id===v.invitation);
  if(!i||i.state!=='pending'||i.expiresAt<=now||i.invitee&&!samePrincipal(i.invitee,actor.principal))fail('invitation_invalid','This invitation is invalid.',400);
  if(typeof actor.addedUnder?.kid!=='string'||!actor.addedUnder.kid||!actor.addedUnder.publicKey||typeof actor.addedUnder.publicKey!=='object')fail('identity_provenance_required','Verified identity key evidence is required.',403);
  const promote=old?.state==='live'&&!currentAdmin(old,now)&&i.invitee&&i.grants.some(g=>g.power==='admin');
  if(old?.state==='live'&&!promote)fail('invitation_invalid','This invitation is invalid.',400);
  if(old&&actor.aep<old.aep)fail('authority_epoch_stale','Authority epoch is stale.',403);
  const key=principalKey(actor.principal),m={id:old?.id??this.random.uuid().replaceAll('-',''),principal:party(actor.principal),state:'live',generation:promote?old.generation:(old?.generation??0)+1,
   grants:[...promote?old.grants:[],...stamp(i.grants,actor,now).map(g=>({...g,...g.power?{notBefore:now+ORG_ADMIN_DELAY_MS}:{}}))],aep:Math.max(old?.aep??0,actor.aep??0),addedUnder:structuredClone(old?.addedUnder??actor.addedUnder??null),createdAt:old?.createdAt??now,...promote?{contextClients:old.contextClients??[],hold:old.hold??null,...old.expires_at!==undefined?{expires_at:old.expires_at}:{}}:{},...!promote&&i.expires_at!==undefined?{expires_at:i.expires_at}:{}};
  r.memberships[key]=m;i.state='accepted';i.membership=m.id;this.notice(r,'member-joined',{membership_id:m.id},now);await this.audit(tx,r,'member-accepted',actor,{membership:m.id});return {membership_id:m.id,generation:m.generation,adminNotBefore:hasAdmin(m)?now+ORG_ADMIN_DELAY_MS:null};
 });}
 members(actor,input={}){return this.frame(actor,input,[],async r=>({members:Object.values(r.memberships).filter(m=>m.state==='live'),requests:Object.values(r.grantRequests)}),{admin:true});}
 leave(actor,input={}){return this.frame(actor,input,[],async(r,v,now,m,tx)=>{if(!m||m.state!=='live')fail('not_found','Not found.',404);await this.end(r,m,actor,'left',now,tx);return {left:true};},{exposure:false,exit:true});}
 remove(actor,input){return this.frame(actor,input,['membership','reason'],async(r,v,now,self,tx)=>{
  const m=Object.values(r.memberships).find(m=>m.id===v.membership&&m.state==='live');if(!m)fail('not_found','Not found.',404);
  if(hasAdmin(m)&&!samePrincipal(m.principal,actor.principal))return this.request(r,actor,m,[],true,v.reason,now,tx);
  if(!organizationPowers(r,actor.principal,{now}).includes('admin'))fail('not_found','Not found.',404);
  await this.end(r,m,actor,'removed',now,tx);return {removed:true};
 },{admin:true,allowOwner:true});}
 grants(actor,input){return this.frame(actor,input,['membership','grants','reason'],async(r,v,now,self,tx)=>{
  const m=Object.values(r.memberships).find(m=>m.id===v.membership&&m.state==='live');if(!m)fail('not_found','Not found.',404);
  let grants;try{grants=normalizeMemberGrants(v.grants);}catch{fail('invalid_grants','Unsupported member grants.',400);}
  if(grants.some(g=>g.power==='admin'&&(g.expires_at===undefined||g.expires_at>now/1000))&&!currentAdmin(m,now))fail('bound_invitation_required','New governance powers need a bound invitation.',409);
  const gmChanged=!equal(m.grants.filter(g=>g.power).map(grantShape),grants.filter(g=>g.power));
  if(hasAdmin(m)&&gmChanged&&!samePrincipal(m.principal,actor.principal))return this.request(r,actor,m,grants,false,v.reason,now,tx);
  if(!organizationPowers(r,actor.principal,{now}).includes('admin')&&!samePrincipal(m.principal,actor.principal))fail('not_found','Not found.',404);
  // Self changes may only narrow. New grants to others are normal admin operations.
  if(samePrincipal(m.principal,actor.principal)&&grants.some(g=>!m.grants.some(old=>{const previous=grantShape(old);return g.power?g.power===previous.power&&(g.expires_at??Infinity)<=(previous.expires_at??Infinity):g.resource===previous.resource&&(g.expires_at??Infinity)<=(previous.expires_at??Infinity)&&Object.entries(g.methods??{}).every(([c,ms])=>ms.every(method=>previous.methods?.[c]?.includes(method)));})))fail('self_widening','Self changes may only remove grants.',409);
  m.grants=stamp(grants,actor,now,m.grants).map(g=>({...g,...g.power&&m.grants.find(old=>old.power===g.power)?.notBefore?{notBefore:m.grants.find(old=>old.power===g.power).notBefore}:{}}));this.operator(r,now);await this.audit(tx,r,'member-grants-changed',actor,{membership:m.id});return {changed:true};
 },{admin:true,allowOwner:true});}
 async request(r,actor,m,grants,remove,reason,now,tx){
  if(typeof reason!=='string'||!reason.trim()||[...reason].length>280||/[\u0000-\u001f]/.test(reason))fail('invalid_reason','Give a reason of at most 280 characters.',400);
  const open=Object.values(r.grantRequests).find(q=>q.target===m.id&&equal(q.grants,grants)&&q.remove===remove&&['subject','elevated'].includes(q.state));if(open)return {request:open};
  const recent=Object.values(r.grantRequests).filter(q=>samePrincipal(q.requester,actor.principal)&&q.target===m.id&&q.createdAt>now-30*DAY);if(recent.length>=3)fail('request_limit','Too many requests for this member.',429);
  const q={id:this.random.uuid(),target:m.id,generation:m.generation,base:structuredClone(m.grants),grants,remove,requester:party(actor.principal),reason:reason.trim(),createdAt:now,elevateAt:now+r.responsePeriodMs,state:'subject',subjectRejected:(m.mutedRequesters??[]).some(p=>samePrincipal(p,actor.principal))};
  r.grantRequests[q.id]=q;this.notice(r,'member-grant-consent',{membership_id:m.id,request:q.id},now);await this.audit(tx,r,'member-grant-requested',actor,{request:q.id});return {request:q};
 }
 decide(actor,input){return this.frame(actor,input,['request','decision'],async(r,v,now,self,tx)=>{
  const q=Object.hasOwn(r.grantRequests,v.request??'')?r.grantRequests[v.request]:null,m=Object.values(r.memberships).find(m=>m.id===q?.target);
  if(!q||!['subject','elevated'].includes(q.state))fail('not_found','Not found.',404);
  if(!m||m.state!=='live'||m.generation!==q.generation||!equal(m.grants,q.base)){q.state='closed';await this.audit(tx,r,'member-grant-request-closed',actor,{request:q.id});return {request:q};}
  const subject=samePrincipal(m.principal,actor.principal),requester=samePrincipal(q.requester,actor.principal),owner=samePrincipal(r.ownerOfRecord,actor.principal),ownerSubject=samePrincipal(m.principal,r.ownerOfRecord),powers=organizationPowers(r,actor.principal,{now});
  if(v.decision==='retract'&&requester)q.state='retracted';
  else if(v.decision==='elevate'&&requester&&!ownerSubject&&(q.subjectRejected||now>=q.elevateAt)){
   if(!powers.includes('admin')&&!powers.includes('owner-of-record'))fail('not_found','Not found.',404);const ownerMember=r.memberships[principalKey(r.ownerOfRecord)];q.state=!ownerMember?.hold&&(ownerMember?.mutedRequesters??[]).some(p=>samePrincipal(p,q.requester))?'rejected':'elevated';this.notice(r,'member-grant-elevated',{request:q.id},now);
  }else if(v.decision==='reject'&&(subject||owner&&q.state==='elevated')){requireFresh(actor,now);if(!subject&&self?.hold)fail('authority_held','Governance authority is held.',403);if(subject&&!ownerSubject)q.subjectRejected=true;else q.state='rejected';}
  else if(v.decision==='accept'&&(subject||owner&&q.state==='elevated'&&!ownerSubject)){
   requireFresh(actor,now);if(self?.hold)fail('authority_held','Governance authority is held.',403);
   if(!subject){if(!powers.includes('owner-of-record'))fail('authority_held','Governance authority is held.',403);const proof=actor.verification;if(!proof||!Number.isSafeInteger(proof.stepUpAt)||proof.stepUpAt>now||proof.stepUpAt+300000<=now||!Number.isSafeInteger(proof.enrolledAt)||proof.enrolledAt<0||proof.enrolledAt>now-7*DAY||!Number.isSafeInteger(proof.securityChangedAt)||proof.securityChangedAt<0||proof.securityChangedAt>now-30*DAY)fail('tight_verification_required','Confirm with an established credential after the security cooling period.',401);}
   if(q.remove)await this.end(r,m,actor,'removed',now,tx);else{m.grants=stamp(q.grants,actor,now,m.grants).map(g=>({...g,...g.power&&m.grants.find(old=>old.power===g.power)?.notBefore?{notBefore:m.grants.find(old=>old.power===g.power).notBefore}:{}}));this.operator(r,now);}q.state='accepted';this.notice(r,'member-grants-changed',{membership_id:m.id,request:q.id,requester:q.requester,owner:r.ownerOfRecord,reason:q.reason},now);
  }else fail('invalid_decision','This decision is not available.',409);
  await this.audit(tx,r,'member-grant-decision',actor,{request:q.id,decision:v.decision});return {request:q};
 },{exposure:false,exit:true});}
 // Review M2: mute is a decision path. It needs fresh authentication, and a held member's mute closes nothing as owner;
 // it records only the preference (which decide's elevation also ignores while the owner is held).
 mute(actor,input){return this.frame(actor,input,['requester','muted'],async(r,v,now,m,tx)=>{
  if(!m||m.state!=='live'||!v.requester||typeof v.requester.iss!=='string'||typeof v.requester.sub!=='string'||typeof v.muted!=='boolean')fail('invalid_request','Invalid mute.',400);
  requireFresh(actor,now);
  m.mutedRequesters=(m.mutedRequesters??[]).filter(p=>!samePrincipal(p,v.requester));if(v.muted)m.mutedRequesters.push(party(v.requester));
  for(const q of Object.values(r.grantRequests))if(v.muted&&samePrincipal(q.requester,v.requester)){if(q.target===m.id&&q.state==='subject')q.subjectRejected=true;if(samePrincipal(m.principal,r.ownerOfRecord)&&q.state==='elevated'&&!m.hold)q.state='rejected';}
  await this.audit(tx,r,'member-request-mute',actor,{requester:v.requester,muted:v.muted});return {muted:v.muted};
 },{exposure:false,exit:true});}
 policy(actor,input){return this.frame(actor,input,['responsePeriodMs'],async(r,v,now,m,tx)=>{
  if(!Number.isSafeInteger(v.responsePeriodMs)||v.responsePeriodMs<ORG_MIN_RESPONSE_MS||v.responsePeriodMs>365*DAY)fail('invalid_request','The response period must be between one day and one year.',400);
  const previous=r.responsePeriodMs;if(previous===v.responsePeriodMs)return {responsePeriodMs:previous};
  // Existing requests keep the elevateAt computed when they were created, so a lowered period applies only afterwards.
  r.responsePeriodMs=v.responsePeriodMs;if(v.responsePeriodMs<previous)this.notice(r,'member-response-period-lowered',{previous,responsePeriodMs:v.responsePeriodMs},now);
  await this.audit(tx,r,'member-response-period',actor,{previous,responsePeriodMs:v.responsePeriodMs});return {responsePeriodMs:r.responsePeriodMs};
 },{admin:true});}
 async lookup(actor,{principal}={}){if(actor?.kind!=='system')fail('forbidden','System only.',403);return this.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD);if(r?.id!==actor.owner)return null;const m=r.memberships?.[principalKey(principal)],now=this.clock.now();return m?.state==='live'&&(m.expires_at===undefined||m.expires_at>now/1000)?{id:m.id,generation:m.generation,aep:m.aep}:null;});}
 async observe(actor,input){if(actor?.kind!=='system'||(await this.metadata.get(ORG_RECORD))?.id!==actor.owner)fail('not_found','Not found.',404);return this.observeAuthority(input.principal,input);}
 /** Internal ORG-4 port, never owner wire input. Checks principal + opaque id + generation and tracks recipients. */
 async snapshot(actor,{principal,membership_id,generation,client,aep}={}){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  if(aep!==undefined)await this.observe(actor,{principal,aep});
  return this.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD);if(r?.id!==actor.owner||!this.enabled(actor.owner))fail('not_found','Not found.',404);const m=r.memberships?.[principalKey(principal)],now=this.clock.now();
   if(!m||m.state!=='live'||m.expires_at!==undefined&&m.expires_at<=now/1000||m.id!==membership_id||m.generation!==generation)fail('not_found','Not found.',404);
   if(client!==undefined){if(typeof client!=='string'||client.length>2048)fail('invalid_request','Invalid client.',400);m.contextClients??=[];if(!m.contextClients.includes(client)){if(m.contextClients.length>=256)fail('context_limit','Too many contexts.',429);m.contextClients.push(client);await tx.put(ORG_RECORD,r);}}
   return {member:structuredClone(m),connections:[{state:'connected',generation:m.generation,expectedGeneration:generation}]};
  });
 }
 /** Trusted adapter evidence only. Persist resets before denying governance, so rejection cannot roll back a hold. */
 async observeAuthority(principal,{aep,reset=false,addedUnder}={}){
  if(!Number.isSafeInteger(aep)||aep<0)fail('authority_epoch_invalid','Authority epoch unavailable.',403);
  return this.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD);if(!r)return null;membershipState(r,this.random,this.clock.now());const m=r.memberships[principalKey(principal)];if(!m||m.state!=='live')return null;
   if(aep<m.aep)fail('authority_epoch_stale','Authority epoch is stale.',403);
   if(aep>m.aep||reset){m.aep=aep;m.hold={aep,at:this.clock.now(),noticeAt:null,objected:false};if(addedUnder)m.currentPin=structuredClone(addedUnder);this.notice(r,'member-authority-held',{membership_id:m.id,aep},this.clock.now());await this.audit(tx,r,'member-authority-reset',{kind:'system',principal},{membership:m.id,aep});r.revision++;await tx.put(ORG_RECORD,r);}return m;
  });
 }
 reconfirm(actor,input){return this.frame(actor,input,['membership','aep','decision'],async(r,v,now,self,tx)=>{
  const m=Object.values(r.memberships).find(m=>m.id===v.membership&&m.state==='live');if(!m?.hold||m.aep!==v.aep)fail('authority_epoch_stale','This hold changed.',409);
  const other=!samePrincipal(m.principal,actor.principal),admin=memberPowers(self,now).includes('admin'),owner=samePrincipal(m.principal,r.ownerOfRecord);
  requireFresh(actor,now);
  if(v.decision==='approve'&&other&&admin&&!owner)m.hold=null;
  else if(v.decision==='notice'&&(!other||admin)){if(m.hold.noticeAt===null){m.hold.noticeAt=now;this.notice(r,'member-reconfirmation',{membership_id:m.id,aep:m.aep},now);}}
  else if(v.decision==='object'&&other&&admin){m.hold.objected=true;}
  else fail('invalid_decision','This decision is not available.',409);
  await this.audit(tx,r,'member-reconfirmation',actor,{membership:m.id,aep:v.aep,decision:v.decision});return {held:Boolean(m.hold)};
 },{exposure:false,exit:true});}
 async sweep(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{if(await tx.get('owner')!==actor.owner)fail('forbidden','Account mismatch.',403);const r=await tx.get(ORG_RECORD);if(!r)return {wakeAt:null};membershipState(r,this.random,this.clock.now());const before=JSON.stringify(r),now=this.clock.now();let wakeAt=null;const wake=t=>{if(t>now)wakeAt=Math.min(wakeAt??Infinity,t);};
   if(typeof this.memberEvents==='function'&&r.memberOutbox.some(e=>!e.deliveredAt))wake(now+60000);
   for(const i of Object.values(r.invitations))if(i.state==='pending'){if(i.expiresAt<=now)i.state='expired';else wake(i.expiresAt);}
   for(const m of Object.values(r.memberships))if(m.state==='live'){
    if(m.hold?.noticeAt!==null&&m.hold?.noticeAt!==undefined&&!m.hold.objected){const at=m.hold.noticeAt+ORG_ADMIN_DELAY_MS;if(at<=now){const aep=m.hold.aep;if(aep===m.aep){m.hold=null;await this.audit(tx,r,'member-authority-reconfirmed',actor,{membership:m.id,aep});}}else wake(at);}
    if(m.expires_at!==undefined){if(m.expires_at<=now/1000){const generation=m.generation;try{await this.end(r,m,actor,'expired',now,tx);}catch(error){if(!['last_admin','owner_must_be_member'].includes(error.code))throw error;m.state='live';m.generation=generation;delete m.endedAt;delete m.endReason;m.expiryBlocked=true;wake(now+3600000);}}else wake(m.expires_at*1000);}
    for(const g of m.grants)if(g.notBefore)wake(g.notBefore);
   }
   for(const q of Object.values(r.grantRequests))if(['subject','elevated'].includes(q.state)){const m=Object.values(r.memberships).find(m=>m.id===q.target);if(!m||m.state!=='live'||m.generation!==q.generation||!equal(m.grants,q.base)){q.state='closed';await this.audit(tx,r,'member-grant-request-closed',actor,{request:q.id});}}
   if(JSON.stringify(r)!==before){r.revision++;r.updatedAt=now;await tx.put(ORG_RECORD,r);}return {wakeAt};
  });
 }
 async drain(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);if(typeof this.memberEvents!=='function')return {held:true};
  const record=await this.metadata.get(ORG_RECORD);if(record?.id!==actor.owner)fail('not_found','Not found.',404);
  for(const event of record.memberOutbox.filter(e=>!e.deliveredAt).slice(0,32)){try{if(await this.memberEvents(structuredClone(event))!==true)continue;}catch{continue;}
   await this.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD),row=r?.memberOutbox.find(e=>e.id===event.id);if(row){row.deliveredAt=this.clock.now();await tx.put(ORG_RECORD,r);}});
  }return {held:false};
 }
 /** ORG-4 adapter port: validate generation live, and durably remember recipients for removal delivery. */
 context(actor,input){return this.frame(actor,input,['client','generation'],async(r,v,now,m)=>{if(!m||m.state!=='live'||m.expires_at!==undefined&&m.expires_at<=now/1000||v.generation!==undefined&&m.generation!==v.generation)fail('not_found','Not found.',404);if(typeof v.client!=='string'||v.client.length>2048)fail('invalid_request','Invalid client.',400);m.contextClients??=[];if(!m.contextClients.includes(v.client)){if(m.contextClients.length>=256)fail('context_limit','Too many contexts.',429);m.contextClients.push(v.client);}return {membership_id:m.id,generation:m.generation,aep:m.aep};});}
 authority(actor,input){return this.frame(actor,input,['membership','generation','application','resource','connections','imported','descriptor'],async(r,v,now)=>{const m=Object.values(r.memberships).find(m=>m.id===v.membership);if(m&&!samePrincipal(m.principal,actor.principal)&&!organizationPowers(r,actor.principal,{now}).includes('admin'))fail('not_found','Not found.',404);if(v.generation!==undefined&&m?.generation!==v.generation)return v.descriptor?null:{};const args={member:m,application:v.application,resource:v.resource,connections:v.connections,imported:v.imported,now};return v.descriptor?memberResourceProjection(args,v.descriptor):effectiveAuthority(args);});}
}
