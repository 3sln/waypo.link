// ORG-1 creation (design §12a, ORG-D2, ORG-D18; spec organizations §3). Creation spans three linearizable stores, so it
// is a resumable sequence of idempotent single-writer steps keyed by the creator's request key:
//
//   1. creator's account writer   orgs.reserve      flag, fresh authentication, paid check (port), limit; mints the UUID
//   2. identity repository        create            identity record kind 'organization', a permanently allocated handle
//   3. organization's writer      orgs.initialize   the organization record (owner of record = creator, first admin)
//   4. identity-backup port       issue             keys created in the organization's writer; the recovery file (v2)
//      identity repository        bindRecovery      the file's credential; the identity becomes active
//   5. creator's account writer   orgs.confirm      the owned index
//
// A retry with the same request key resumes at the first unfinished step. Once confirmed, a retry returns the
// organization without a file: the file is shown once, and a lost file is replaced by reissue (a later slice), never by
// replaying creation. A retry that finds a file already bound issues a replacement that rotates the signing key first
// (identity portability P15), and binds it only if nobody bound another file meanwhile, so at most one issued file holds
// the current key and token.
//
// Ports {person:{reserve(actor,input), confirm(owner,input)}, org:{initialize(org,input)}, identity
// (organizationIdentityPort), backup:{issue(account, recoveryToken, {rotation, keep})} (identityBackupPort)}.
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
  if(reservation.state==='confirmed'){const identity=await this.identity.get(org);return {organization:{id:org,kind:'organization',name:reservation.name,label:reservation.label,handle:identity?.handle??null},recoveryFile:null,existing:true};}
  const created=await this.identity.create(org,{request:reservation.request,creator});
  if(!created?.ok)unavailable();
  const view=await this.org.initialize(org,{request:reservation.request,creator,name:reservation.name,label:reservation.label,plan:reservation.plan,handle:created.handle});
  let file;
  for(let attempt=0;attempt<3&&!file;attempt++){
   const record=await this.identity.record(org);if(!record)unavailable();
   const previous=typeof record.recoveryHash==='string'&&record.recoveryHash?record.recoveryHash:null,recoveryToken=`${org}.${this.crypto.random()}`;
   const issued=await this.backup.issue(record,recoveryToken,{rotation:previous?{always:true}:null,keep:[]}),backup=issued?.backup??issued;
   const kid=backup?.keychain?.signing?.kid;if(typeof kid!=='string')unavailable();
   const bound=await this.identity.bindRecovery(org,{request:reservation.request,expected:previous,recoveryHash:await this.crypto.hash('recovery',recoveryToken),keyKid:kid,rotated:issued?.rotation?.rotated===true});
   if(bound?.ok)file={fileName:`3sln-organization-recovery-${org}.json`,content:JSON.stringify(backup),recoveryToken};
   else if(bound?.status!=='superseded')unavailable();
  }
  if(!file)unavailable();
  await this.person.confirm(creatorId,{request:reservation.request,org,handle:created.handle});
  return {organization:view,recoveryFile:file,existing:false};
 }
}
export function organizationCreationProvider(creation){return class extends Provider{static deps=[];obtain(){return creation;}release(){}};}
/** Edge operation: the whole creation sequence as one Action (the route only parses and serializes). */
export class CreateOrganization extends AppAction{static operation='orgs.create';static deps=['organizationCreation'];static changes='organization-changed';run({organizationCreation}){return organizationCreation.create(this.actor,this.input);}}
