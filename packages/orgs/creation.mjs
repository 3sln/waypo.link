// ORG-1 creation (design §12a, ORG-D2, ORG-D18; spec organizations §3). Creation spans three linearizable stores, so it
// is a resumable sequence of idempotent single-writer steps keyed by the creator's request key:
//
//   1. creator's account writer   orgs.reserve      flag, fresh authentication, paid check (port), limit; mints the UUID
//   2. identity repository        create            identity record kind 'organization', a permanently allocated handle
//   3. organization's writer      orgs.initialize   the organization record (owner of record = creator, first admin)
//   4. recovery-file port         issue             the opaque v3 recovery file (no keys, no signature)
//      identity repository        bindRecovery      the file's credential and id; the identity becomes active
//   5. creator's account writer   orgs.confirm      the owned index
//
// A retry with the same request key resumes at the first unfinished step. Once confirmed, a retry returns the
// organization without a file: the file is shown once, and a lost file is replaced by reissue (a later slice), never by
// replaying creation. A retry that finds a file already bound issues a replacement and binds it only if nobody bound
// another file meanwhile, so at most one issued file holds the current token (its credential hash replaces the old one).
//
// Ports {person:{reserve(actor,input), confirm(owner,input)}, org:{initialize(org,input)}, identity
// (organizationIdentityPort), backup:{issue(account, recoveryToken)} (identityBackupPort)}.
import {Provider} from '../../vendor/ngin/index.js';
import {AppAction} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {IdentityCrypto} from '../identity/crypto.mjs';
import {entityOf,hasPower} from './authority.mjs';
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
const unavailable=()=>fail('organization_unavailable','Organizations are temporarily unavailable. Try again.',503);

export class OrganizationCreation{
 constructor({person,org,identity,backup,crypto=new IdentityCrypto(),issuer=null}){Object.assign(this,{person,org,identity,backup,crypto,issuer});}
 async create(actor,input){
  if(actor?.kind!=='owner'||entityOf(actor).kind!=='person'||!hasPower(actor,'owner'))fail('unauthorized','Sign in to continue.',401);
  if(!this.person||!this.org||!this.identity||typeof this.backup?.issue!=='function')unavailable();
  const creatorId=actor.owner,request={principal:{iss:actor.principal?.iss??null,sub:creatorId},entity:{kind:'person',id:creatorId},authTime:actor.authTime??null,epoch:actor.epoch??0};
  const reservation=await this.person.reserve(request,input),org=reservation.org,creator={iss:reservation.creator?.iss??this.issuer,sub:creatorId};
  // Checkout at creation (ORG-D18): an unpaid reservation proceeds only on a verified payment bound to this request.
  if(reservation.state!=='confirmed'&&reservation.payment?.state==='required'){
   if(typeof this.person.payment!=='function')unavailable();
   const paid=await this.person.payment(request,{request:reservation.request});
   if(paid?.payment!=='verified')return {organization:null,recoveryFile:null,existing:false,payment:{required:true,request:reservation.request,org,name:reservation.name,plan:reservation.payment.plan??null,checkout:paid?.checkout??null,server:'sandbox'}};
   if(paid.plan)reservation.plan=paid.plan;
  }
  if(reservation.state==='confirmed'){const identity=await this.identity.get(org);return {organization:{id:org,kind:'organization',name:reservation.name,label:reservation.label,handle:identity?.handle??null},recoveryFile:null,existing:true};}
  const created=await this.identity.create(org,{request:reservation.request,creator});
  if(!created?.ok)unavailable();
  const view=await this.org.initialize(org,{request:reservation.request,creator,name:reservation.name,label:reservation.label,plan:reservation.plan,handle:created.handle});
  const file=await issueOrganizationRecoveryFile({identity:this.identity,backup:this.backup,crypto:this.crypto,org,request:reservation.request});
  await this.person.confirm(creatorId,{request:reservation.request,org,handle:created.handle});
  // Seeds the organization's billing snapshot (best effort; webhooks and the account alarm reconcile later).
  try{await this.org.sync?.(org);}catch{}
  return {organization:view,recoveryFile:file,existing:false};
 }
}
/**
 * Issues an organization recovery file (v3, opaque) and binds its credential: a file already bound is replaced only if
 * nobody bound another meanwhile, so at most one issued file holds the current token. Used at creation and for the
 * owner's reissue after an ownership change (§12b.3a). The file is returned once.
 */
export async function issueOrganizationRecoveryFile({identity,backup,crypto=new IdentityCrypto(),org,request}){
 for(let attempt=0;attempt<3;attempt++){
  const record=await identity.record(org);if(!record)unavailable();
  const previous=typeof record.recoveryHash==='string'&&record.recoveryHash?record.recoveryHash:null,recoveryToken=`${org}.${crypto.random()}`;
  const issued=await backup.issue(record,recoveryToken),file=issued?.file;
  if(typeof file?.fileId!=='string')unavailable();
  const bound=await identity.bindRecovery(org,{request,expected:previous,recoveryHash:await crypto.hash('recovery',recoveryToken),fileId:file.fileId,issuedAt:file.issuedAt});
  if(bound?.ok)return {fileName:`3sln-organization-recovery-${org}.json`,content:JSON.stringify(file),recoveryToken,fileId:file.fileId};
  if(bound?.status!=='superseded')unavailable();
 }
 unavailable();
}
/** The owner of record's recovery-file reissue (after a transfer or lapse claim, or any time): the organization writer
 * authorizes it (owner of record, fresh step-up) and names the creation request; the file is issued here, at the edge,
 * next to the identity repository. Ports: {org:{begin, done}, identity, backup}. */
export class OrganizationRecoveryReissue{
 constructor({org,identity,backup,crypto=new IdentityCrypto()}){Object.assign(this,{org,identity,backup,crypto});}
 async reissue(request,orgId){
  if(!this.org||!this.identity||typeof this.backup?.issue!=='function')unavailable();
  const {request:creation,generation}=await this.org.begin(orgId,request);
  const file=await issueOrganizationRecoveryFile({identity:this.identity,backup:this.backup,crypto:this.crypto,org:orgId,request:creation});
  // Break-glass review M2/R2-M2: fail closed. The file is handed out only when the organization confirmed it for the
  // current owner; any refusal or error withholds it (a refused confirmation queues the organization's recovery-rotate
  // effect, which clears the credential bound for this file on the identity record, and the owner can reissue again).
  let done=null;try{done=await this.org.done(orgId,request,{fileId:file.fileId,...Number.isSafeInteger(generation)?{generation}:{}});}catch{done=null;}
  if(done?.issued===false&&done.reason==='rotation_pending')fail('recovery_rotation_pending','The previous owner’s file is still being invalidated. Try again in a minute.',409);
  if(done?.issued===false)fail('organization_owner_changed','Ownership of this organization changed while the file was being issued. That file was invalidated.',409);
  if(done?.issued!==true)fail('organization_unavailable','The new recovery file could not be confirmed. Try again; no file was issued to you.',503);
  return {recoveryFile:file};
 }
}
export function organizationRecoveryReissueProvider(service){return class extends Provider{static deps=[];obtain(){return service;}release(){}};}
export class ReissueOrganizationRecovery extends AppAction{static operation='orgs.recovery-reissue';static deps=['organizationRecoveryReissue'];static changes='organization-changed';run({organizationRecoveryReissue}){return organizationRecoveryReissue.reissue(this.input.request,this.input.org);}}
export function organizationCreationProvider(creation){return class extends Provider{static deps=[];obtain(){return creation;}release(){}};}
/** Edge operation: the whole creation sequence as one Action (the route only parses and serializes). */
export class CreateOrganization extends AppAction{static operation='orgs.create';static deps=['organizationCreation'];static changes='organization-changed';run({organizationCreation}){return organizationCreation.create(this.actor,this.input);}}
