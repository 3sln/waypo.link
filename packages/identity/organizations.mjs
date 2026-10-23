// ORG-1 identity hunk: organization identity records (docs/spec/organizations.md §3; design ORG-D2, §6.1).
//
// An organization is an ordinary identity record of `kind: 'organization'`: a stable UUID `id`, a permanently
// allocated handle (its alias; the UUID is the identity), provider-custodied keys in its own account single writer, and
// a recovery file issued at creation to its owner of record. It never has credentials, sessions, email login or a
// password, and IdentityService refuses every interactive path for it (`interactiveIdentity`). Organization recovery
// (break-glass, ORG-12) is phase B: until then `recover` refuses an organization like an unknown file.
//
// Status: 'pending-organization' from create until the first recovery file is bound, then 'active'. Identity
// portability already refuses organization moves on `kind` (transfer-out, transfer-in); this record keeps them refused.
//
// Port over the identity repository (`get`, `create`, `compareAndSwap`, `allocateFreeHandle`: the Worker
// ShardedIdentityRepository and the Node repository):
//   get(id)                         -> {id, kind, status, handle, organization, recovery:{issuedAt,keyKid}|null} | null
//   record(id)                      -> the stored record (internal, for the identity-backup port) | null
//   create(id, {request, creator})  -> {ok, handle, status} | {ok:false, status}; idempotent for the same request
//   bindRecovery(id, {request, expected, recoveryHash, keyKid, rotated})  the file's credential, one CAS; activates
import {securityState} from './service.mjs';

const UUID=/^[a-f0-9-]{36}$/,UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** False for identities nobody may sign in as (organizations). Used by IdentityService's session, authorization,
 * pending-setup and recovery paths. */
export function interactiveIdentity(account){return account?.kind!=='organization';}

export function organizationIdentityPort(repository,{clock=()=>Date.now(),crypto:webCrypto=globalThis.crypto}={}){
 if(typeof repository?.get!=='function'||typeof repository.create!=='function'||typeof repository.compareAndSwap!=='function')throw new TypeError('An identity repository is required.');
 const audit=(account,type)=>{account.audit=[...(account.audit||[]).slice(-99),{id:webCrypto.randomUUID(),type,at:clock()}];};
 const cas=async(id,mutate)=>{
  for(let attempt=0;attempt<8;attempt++){
   const account=await repository.get(id);if(!account||account.id!==id)return {ok:false,status:'missing'};
   const next=structuredClone(account),outcome=mutate(next);
   if(outcome?.write!==true)return outcome;
   next.revision=account.revision+1;if(await repository.compareAndSwap(id,account.revision,next))return outcome;
  }
  return {ok:false,status:'conflict'};
 };
 return Object.freeze({
  async get(id){
   if(!UUID.test(id??''))return null;const account=await repository.get(id);if(!account||account.id!==id)return null;
   return {id,kind:account.kind==='organization'?'organization':'person',status:account.status,handle:account.handle??null,organization:plain(account.organization)?structuredClone(account.organization):null,
    recovery:typeof account.recoveryHash==='string'&&account.recoveryHash?{issuedAt:account.recoveryIssuedAt??null,keyKid:account.recoveryKeyKid??null}:null,security:securityState(account)};
  },
  async record(id){if(!UUID.test(id??''))return null;const account=await repository.get(id);return account?.id===id&&account.kind==='organization'?account:null;},
  async create(id,{request,creator,now=clock()}={}){
   if(!UUID_V4.test(id??'')||typeof request!=='string'||!plain(creator)||!UUID.test(creator.sub??''))return {ok:false,status:'invalid'};
   const existing=await repository.get(id);
   if(existing)return existing.kind==='organization'&&existing.organization?.request===request&&existing.organization.creator?.sub===creator.sub?{ok:true,handle:existing.handle,status:existing.status}:{ok:false,status:'sub_in_use'};
   if(typeof repository.allocateFreeHandle!=='function')return {ok:false,status:'unsupported'};
   const assignmentId=webCrypto.randomUUID(),handle=await repository.allocateFreeHandle(null,id,assignmentId);
   const account={id,assignmentId,nameAssignmentId:assignmentId,revision:0,handle,status:'pending-organization',kind:'organization',
    organization:{v:1,request,creator:{iss:creator.iss??null,sub:creator.sub},createdAt:now},admission:{version:1,kind:'organization',plan:'organization'},
    createdAt:now,lastActiveAt:now,security:{epoch:0,changedAt:now},credentials:[],sessions:[],challenges:[],audit:[],recoveryHash:null,emailLoginEnabled:false,passwordHash:null};
   audit(account,'organization-created');
   if(await repository.create(account))return {ok:true,handle,status:account.status};
   const raced=await repository.get(id);
   return raced?.kind==='organization'&&raced.organization?.request===request?{ok:true,handle:raced.handle,status:raced.status}:{ok:false,status:'conflict'};
  },
  /** Binds the recovery credential of a file just issued through the identity-backup port (v2, P15) and activates the
   * identity. A file issued on a retry replaces the earlier credential (the backup port rotated the key first). */
  async bindRecovery(id,{request,expected=null,recoveryHash,keyKid,rotated=false}={}){
   if(typeof recoveryHash!=='string'||!recoveryHash||typeof keyKid!=='string'||!keyKid)return {ok:false,status:'invalid'};
   return cas(id,account=>{
    if(account.kind!=='organization'||account.organization?.request!==request||!['pending-organization','active'].includes(account.status))return {ok:false,status:account.status};
    // `expected`: the credential the issuer saw before issuing. Another file bound meanwhile supersedes this one.
    if((typeof account.recoveryHash==='string'&&account.recoveryHash?account.recoveryHash:null)!==expected)return {ok:false,status:'superseded'};
    const now=clock(),security=securityState(account);
    Object.assign(account,{status:'active',recoveryHash,recoveryIssuedAt:now,recoveryKeyKid:keyKid,recoveryBackupVersion:2,security:{epoch:security.epoch+1,changedAt:Math.max(security.changedAt,now)}});
    if(rotated)audit(account,'recovery-key-rotated');audit(account,'recovery-file-issued');
    return {ok:true,write:true,status:'active'};
   });
  },
 });
}
