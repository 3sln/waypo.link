// ORG-1, the organization entity (docs/architecture/organizations-design.md ORG-D2, ORG-D18, §12a, §12b.1, §13.2;
// spec docs/spec/organizations.md §3). Everything here runs inside one account single writer and commits through
// its `accountStore.transaction`; the engine operations are in packages/app/domains/orgs.mjs.
//
// Two placements:
//   the creator's person account   orgs/creation/<request>  a creation reservation (idempotency key, the new UUID)
//                                  orgs/owned/<org>         index of organizations this person is owner of record of
//   the organization's own account org/record-v1            the authoritative organization record (below)
//                                  identity/entity          {v:1, kind:'organization'} (read by app removal, AU-13)
//                                  org/audit/<seq>          owner-interface audit rows (hash-chained by ORG-2)
//                                  org/member/…, org/invitation/…, org/request/…, org/outbox/…, org/due/…
//                                                           the ORG-2 roster rows (packages/orgs/roster.mjs)
//                                  org/principal-epoch/<k>  highest security epoch seen per acting principal
//
// The organization record:
//   {v:1, kind:'organization', id, name, label, ownerOfRecord:{iss,sub}, initialAdmin:{iss,sub}, createdBy:{iss,sub},
//    plan:{source, plan}, request, createdAt, state, deletion|null, revision, updatedAt, auditSeq}
//   state     'active' | 'deletion-scheduled' | 'deletion-due'
//   deletion  {requestedAt, notBefore, by:{iss,sub}} while scheduled or due
//
// Hooks for later slices (not implemented here):
//   ORG-2 membership: `organizationPowers(..., {membership})` in packages/orgs/authority.mjs replaces `initialAdmin`.
//   Ownership transfer (ORG-D21, §12b.3a): `ownerOfRecord` changes only through the transfer or lapse-claim commit in
//   packages/orgs/ownership.mjs (OwnershipService#changeOwner); nothing in this slice writes it after creation.
//   Purge: a due deletion is handed to `purge(org)` when the adapter provides one; otherwise it holds at
//   'deletion-due' (never purges by guessing).
import {AppFault} from '../app/faults.mjs';
import {entityOf,hasPower,requirePower,requireFresh,organizationPowers} from './authority.mjs';

export const ORG_RECORD='org/record-v1',ORG_ENTITY='identity/entity',ORG_AUDIT='org/audit/',ORG_EPOCH='org/principal-epoch/';
export const ORG_CREATION='orgs/creation/',ORG_OWNED='orgs/owned/',ORG_JOINED='orgs/joined/';
/** Provisional (coordinator): at most this many membership hints per person (ORG-5 discovery). */
export const ORG_JOINED_LIMIT=256;
export const ORGANIZATIONS_FLAG='ORGANIZATIONS_ENABLED';
/** Display kind labels (terminology §4). Presentation only; never changes behaviour. */
export const ORG_LABELS=Object.freeze(['organization','company','team','club','household','project']);
/** Provisional (coordinator) figures for phase A; revisable. */
export const ORG_DELETION_DELAY_MS=30*86400000,ORG_CREATION_LIMIT=10,ORG_FRESH_AUTH_MS=900000;
/** Organization plan ids (packages/billing/organizations.mjs, provisional product data) and the provisional period after
 * which an unpaid reservation stops counting toward the creation limit (it can still be resumed). */
export const ORG_PAID_PLANS=Object.freeze(['org-team','org-business','org-scale']),ORG_UNPAID_RESERVATION_MS=7*86400000;
const UUID=/^[a-f0-9-]{36}$/,REQUEST=/^[A-Za-z0-9_-]{16,128}$/;
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,names)=>{if(value===undefined)value={};if(!plain(value)||Object.keys(value).some(name=>!names.includes(name)))fail('invalid_request','Unsupported organization request.',400);return value;};
const party=value=>({iss:value?.iss??null,sub:value?.sub});
const samePrincipal=(a,b)=>plain(a)&&plain(b)&&a.sub===b.sub&&(a.iss??null)===(b.iss??null);

/** A display name: 1–80 characters after trimming, NFC, no control or bidi-override characters. */
export function organizationName(value){
 if(typeof value!=='string')fail('invalid_name','Enter an organization name of 1–80 characters.',400);
 const name=value.normalize('NFC').trim();
 if(!name||[...name].length>80||/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/.test(name))fail('invalid_name','Enter an organization name of 1–80 characters.',400);
 return name;
}
export function organizationLabel(value='organization'){if(!ORG_LABELS.includes(value))fail('invalid_label','Choose a supported organization kind.',400);return value;}
export function organizationView(record,actor){
 if(!record)return null;
 return {id:record.id,kind:'organization',name:record.name,label:record.label,handle:record.handle??null,aliases:record.handle?[record.handle]:[],
  ownerOfRecord:party(record.ownerOfRecord),state:record.state,deletion:record.deletion?{...record.deletion,by:party(record.deletion.by)}:null,
  createdAt:record.createdAt,updatedAt:record.updatedAt,revision:record.revision,...actor?{powers:[...actor.powers??[]]}:{}};
}

/**
 * The paid check (ORG-D18): organizations are always paid. `check({creator, now})` resolves {paid:true, plan, source}
 * or {paid:false}. Billing for organizations is not integrated yet, so the production port is this allowlist, which
 * fails closed: only creator accounts the operator lists in `ORGANIZATIONS_PAID_ALLOWLIST` (design §13.3 phase A,
 * "an internal allowlist until billing is enabled") pass, and nothing else does.
 */
export function allowlistPlanPort(raw){
 const listed=new Set(typeof raw==='string'?raw.split(',').map(value=>value.trim().toLowerCase()).filter(value=>UUID.test(value)):[]);
 return Object.freeze({async check({creator}){return listed.has(creator?.sub)?{paid:true,plan:'organization-internal',source:'allowlist'}:{paid:false,reason:'billing_unavailable'};}});
}

export class OrganizationService{
 /** `metadata`: the account store (transaction(fn)); `flags`: {for(ctx)}; `plans`: the paid-check port; `purge`:
  * optional `(org) -> {handedOff:boolean}` executor hand-off; `issuer`: this provider's origin. */
 constructor({metadata,clock={now:()=>Date.now()},random={uuid:()=>crypto.randomUUID()},flags,plans,purge,issuer=null}){
  if(typeof metadata?.transaction!=='function')throw new TypeError('An account store is required.');
  Object.assign(this,{metadata,clock,random,flags,plans,purge,issuer});
 }
 enabled(owner){try{return this.flags?.for({subject:{kind:'account',owner}}).enabled(ORGANIZATIONS_FLAG)===true;}catch{return false;}}
 /** Person placement: the actor must be the person acting as themselves on their own bound account. */
 async person(tx,actor){
  if(actor?.kind!=='owner'||entityOf(actor).kind!=='person'||!hasPower(actor,'owner')||!UUID.test(actor.owner??''))fail('unauthorized','Sign in to continue.',401);
  if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
  return actor.owner;
 }
 /** Organization placement: a resolved organization actor on this organization's bound account. Applies the epoch
  * rule: a principal's epoch never goes backwards here (a request issued before a security change is refused). */
 async organization(tx,actor,{write=false}={}){
  const entity=entityOf(actor);
  if(actor?.kind!=='owner'||entity.kind!=='organization'||entity.id!==actor.owner)fail('not_found','Not found.',404);
  const record=await tx.get(ORG_RECORD);
  if(await tx.get('owner')!==actor.owner||record?.kind!=='organization'||record.id!==actor.owner)fail('not_found','Not found.',404);
  const epochKey=ORG_EPOCH+encodeURIComponent((actor.principal.iss??'')+' '+actor.principal.sub),seen=await tx.get(epochKey);
  if(Number.isSafeInteger(seen)&&actor.epoch<seen)fail('authority_epoch_stale','Your account security changed. Reload and try again.',409);
  if(write&&(!Number.isSafeInteger(seen)||actor.epoch>seen))await tx.put(epochKey,actor.epoch);
  return record;
 }
 async audit(tx,record,action,actor,detail={}){
  record.auditSeq=(record.auditSeq??0)+1;
  await tx.put(ORG_AUDIT+String(record.auditSeq).padStart(12,'0'),{seq:record.auditSeq,at:this.clock.now(),action,principal:actor?.principal?party(actor.principal):null,actor:actor?.kind??'system',...detail});
 }

 // ---- person placement ----------------------------------------------------------------------------------------
 /** Step 1 of creation (ORG-D18): needs the flag, a fresh authentication, the paid check and the per-person limit.
  * Idempotent per `request`: the same key returns the same reservation and UUID. */
 async reserve(actor,input){
  const value=exact(input,['request','name','label','plan']);
  if(typeof value.request!=='string'||!REQUEST.test(value.request))fail('invalid_request','A creation request key is required.',400);
  if(value.plan!==undefined&&!ORG_PAID_PLANS.includes(value.plan))fail('invalid_plan','Choose an organization plan.',400);
  const name=organizationName(value.name),label=organizationLabel(value.label);
  if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  const now=this.clock.now();requireFresh(actor,now,ORG_FRESH_AUTH_MS);
  const creator={iss:actor.principal?.iss??this.issuer,sub:actor.owner};
  const prior=await this.metadata.transaction(async tx=>{await this.person(tx,actor);return tx.get(ORG_CREATION+value.request);});
  if(prior){if(prior.name!==name||prior.label!==label)fail('idempotency_conflict','This request was already used for another organization.',409);return structuredClone(prior);}
  // The paid check runs outside the transaction (it may be a remote port) and fails closed on any error.
  let plan;try{plan=await this.plans?.check({creator,now});}catch{plan=null;}
  // Checkout at creation (ORG-D18, packages/orgs/ownership.mjs): with organization billing configured (sandbox only),
  // a creator outside the operator allowlist reserves the UUID unpaid; the sequence resumes once a verified payment
  // for this request exists. Without billing, the allowlist alone decides, failing closed.
  const unpaid=plan?.paid!==true&&this.plans?.payable===true;
  if(plan?.paid!==true&&!unpaid)fail('organization_payment_required','Organizations need a paid plan, which is not available for this account yet.',402);
  if(unpaid)plan={source:'polar',plan:value.plan??'org-team'};
  return this.metadata.transaction(async tx=>{
   await this.person(tx,actor);
   const again=await tx.get(ORG_CREATION+value.request);if(again){if(again.name!==name||again.label!==label)fail('idempotency_conflict','This request was already used for another organization.',409);return structuredClone(again);}
   let open=0;for(const row of (await tx.list({prefix:ORG_CREATION})).values())if(row?.state==='reserved'&&!(row.payment?.state==='required'&&row.reservedAt<now-ORG_UNPAID_RESERVATION_MS))open++;
   const owned=(await tx.list({prefix:ORG_OWNED})).size;
   if(open+owned>=ORG_CREATION_LIMIT)fail('organization_limit','You have reached the organization limit for now.',409);
   const row={v:1,request:value.request,org:this.random.uuid(),name,label,creator,plan:{source:String(plan.source),plan:String(plan.plan)},state:'reserved',reservedAt:now,...unpaid?{payment:{state:'required',plan:plan.plan}}:{}};
   await tx.put(ORG_CREATION+value.request,row);return structuredClone(row);
  });
 }
 /** Final step (system, from the creation adapter): the organization exists; index it for its owner of record. */
 async confirm(actor,input){
  const value=exact(input,['request','org','handle']);
  if(actor?.kind!=='system'||!UUID.test(actor.owner??''))fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const row=await tx.get(ORG_CREATION+value.request);
   if(!row||row.org!==value.org)fail('not_found','Not found.',404);
   if(row.state!=='confirmed'){row.state='confirmed';row.confirmedAt=this.clock.now();await tx.put(ORG_CREATION+value.request,row);}
   if(!await tx.get(ORG_OWNED+row.org))await tx.put(ORG_OWNED+row.org,{v:1,org:row.org,handle:typeof value.handle==='string'?value.handle:null,role:'owner-of-record',createdAt:row.confirmedAt??this.clock.now()});
   return structuredClone(row);
  });
 }
 /** The organizations a person is owner of record of (an index; each organization's own record is authoritative). */
 async list(actor){
  return this.metadata.transaction(async tx=>{await this.person(tx,actor);return {organizations:[...(await tx.list({prefix:ORG_OWNED})).values()].map(row=>({id:row.org,handle:row.handle,role:row.role,createdAt:row.createdAt})),pending:[...(await tx.list({prefix:ORG_CREATION})).values()].filter(row=>row.state==='reserved').map(row=>({request:row.request,id:row.org,name:row.name,...row.payment?{payment:row.payment.state,plan:row.payment.plan??null}:{}}))};});
 }
 // ORG-5 discovery hints (provisional coordinator work). `orgs/joined/<org>` records, in the PERSON's own account, that
 // this person joined an organization. A hint is never evidence: discovery shows an organization only when that
 // organization's writer confirms the person's live membership (packages/orgs/discovery.mjs), so a stale or invented
 // hint reveals nothing and costs only the person's own lookups. Membership itself stays in the organization's record.
 /** The organizations to ask about: owner-of-record index rows and membership hints. */
 async candidates(actor){
  return this.metadata.transaction(async tx=>{await this.person(tx,actor);const owned=[...(await tx.list({prefix:ORG_OWNED})).values()],joined=[...(await tx.list({prefix:ORG_JOINED})).values()];
   return {owned:owned.map(row=>({id:row.org,handle:row.handle??null,role:row.role,createdAt:row.createdAt})),joined:joined.filter(row=>!owned.some(o=>o.org===row.org)).map(row=>({id:row.org,joinedAt:row.joinedAt})),pending:[...(await tx.list({prefix:ORG_CREATION})).values()].filter(row=>row.state==='reserved').map(row=>({request:row.request,id:row.org,name:row.name,...row.payment?{payment:row.payment.state,plan:row.payment.plan??null}:{}})),offers:[...(await tx.list({prefix:'orgs/offers/'})).values()].map(row=>({id:row.org,at:row.at}))};});
 }
 /** Records a hint after the organization accepted this person (called by the acceptance adapter, never from input). */
 async remember(actor,input){
  const value=exact(input,['org']);if(typeof value.org!=='string'||!UUID.test(value.org))fail('invalid_request','Unsupported organization request.',400);
  return this.metadata.transaction(async tx=>{await this.person(tx,actor);if(value.org===actor.owner)fail('invalid_request','Unsupported organization request.',400);
   if(await tx.get(ORG_JOINED+value.org)!==undefined)return {remembered:true};
   if((await tx.list({prefix:ORG_JOINED})).size>=ORG_JOINED_LIMIT)return {remembered:false};
   await tx.put(ORG_JOINED+value.org,{v:1,org:value.org,joinedAt:this.clock.now()});return {remembered:true};});
 }
 /** Drops a hint (after leaving). Owner-of-record rows are not hints and stay. */
 async forgetMembership(actor,input){
  const value=exact(input,['org']);if(typeof value.org!=='string'||!UUID.test(value.org))fail('invalid_request','Unsupported organization request.',400);
  return this.metadata.transaction(async tx=>{await this.person(tx,actor);const had=await tx.get(ORG_JOINED+value.org)!==undefined;if(had)await tx.delete(ORG_JOINED+value.org);return {forgotten:had};});
 }
 /** System: drop the index entry once an organization is gone. */
 async forget(actor,input){
  const value=exact(input,['org']);if(actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);const had=await tx.get(ORG_OWNED+value.org)!==undefined;await tx.delete(ORG_OWNED+value.org);return {forgotten:had};});
 }

 // ---- organization placement ----------------------------------------------------------------------------------
 /** System, from the creation adapter after the identity record exists: writes the organization record. Idempotent
  * for the same creation request; any other existing state refuses (one account, one entity). */
 async initialize(actor,input){
  const value=exact(input,['request','creator','name','label','plan','handle','addedUnder']);
  if(actor?.kind!=='system'||!UUID.test(actor.owner??''))fail('forbidden','System only.',403);
  if(typeof value.request!=='string'||!REQUEST.test(value.request)||!plain(value.creator)||!UUID.test(value.creator.sub??'')||value.creator.sub===actor.owner)fail('invalid_request','Unsupported organization request.',400);
  const name=organizationName(value.name),label=organizationLabel(value.label),creator=party(value.creator);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const existing=await tx.get(ORG_RECORD);
   if(existing){if(existing.request===value.request&&samePrincipal(existing.createdBy,creator))return organizationView(existing);fail('organization_conflict','This account already holds another entity.',409);}
   // The creation adapter only initializes a fresh UUID whose identity record it has just created as an organization
   // (linearizable identity create); an explicit entity marker of any other kind still refuses here.
   const entity=await tx.get(ORG_ENTITY);if(entity!==undefined)fail('organization_conflict','This account already holds another entity.',409);
   const now=this.clock.now();
   const record={v:1,kind:'organization',id:actor.owner,name,label,handle:typeof value.handle==='string'?value.handle:null,ownerOfRecord:creator,initialAdmin:creator,createdBy:creator,
    plan:plain(value.plan)?{source:String(value.plan.source),plan:String(value.plan.plan)}:null,request:value.request,createdAt:now,updatedAt:now,state:'active',deletion:null,revision:1,auditSeq:0};
   await this.initializeMembership?.(tx,record,now,value.addedUnder);
   await this.audit(tx,record,'organization-created',{kind:'system',principal:creator},{name,label});
   await this.beforeCommit?.(tx,record,{kind:'system',principal:creator});
   await tx.put(ORG_ENTITY,{v:1,kind:'organization'});await tx.put(ORG_RECORD,record);
   return organizationView(record);
  });
 }
 async get(actor){return this.metadata.transaction(async tx=>organizationView(await this.organization(tx,actor),actor));}
 /** Shared mutation frame: powers, the epoch rule, optimistic revision and the state guard. */
 async mutate(actor,input,names,{powers,states=['active'],exposure=true,fresh=false},apply){
  const value=exact(input,[...names,'expectedRevision']);
  if(value.expectedRevision!==undefined&&!Number.isSafeInteger(value.expectedRevision))fail('invalid_request','Unsupported organization request.',400);
  if(exposure&&!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  const now=this.clock.now();
  return this.metadata.transaction(async tx=>{
   const record=await this.organization(tx,actor,{write:true});requirePower(record.memberships?{...actor,powers:organizationPowers(record,actor.principal,{now})}:actor,...powers);
   if(fresh)requireFresh(actor,now,ORG_FRESH_AUTH_MS);
   if(value.expectedRevision!==undefined&&value.expectedRevision!==record.revision)fail('organization_stale','This organization changed. Reload and try again.',409);
   if(!states.includes(record.state))fail(record.state==='active'?'organization_not_pending':'organization_deletion_pending',record.state==='active'?'No deletion is pending.':'This organization is scheduled for deletion.',409);
   const changed=await apply(record,value,now,tx),flushed=await this.beforeCommit?.(tx,record,actor);
   if(changed!==false||flushed){record.revision++;record.updatedAt=now;await tx.put(ORG_RECORD,record);}
   return organizationView(record,actor);
  });
 }
 rename(actor,input){return this.mutate(actor,input,['name'],{powers:['admin']},async(record,{name},now,tx)=>{const next=organizationName(name);if(next===record.name)return false;await this.audit(tx,record,'organization-renamed',actor,{from:record.name,to:next});record.name=next;});}
 setLabel(actor,input){return this.mutate(actor,input,['label'],{powers:['admin']},async(record,{label},now,tx)=>{const next=organizationLabel(label);if(next===record.label)return false;await this.audit(tx,record,'organization-label-changed',actor,{from:record.label,to:next});record.label=next;});}
 /** Delayed deletion (§10 "critical actions are delayed and notified"): the owner of record, freshly authenticated.
  * Provisional (coordinator): 30 days, cancellable by the owner of record or any admin until it is due. */
 scheduleDeletion(actor,input){return this.mutate(actor,input,[],{powers:['owner-of-record'],fresh:true},async(record,value,now,tx)=>{record.state='deletion-scheduled';record.deletion={requestedAt:now,notBefore:now+ORG_DELETION_DELAY_MS,by:party(actor.principal)};await this.audit(tx,record,'organization-deletion-scheduled',actor,{notBefore:record.deletion.notBefore});});}
 /** Never flag-gated: a ramp-down must not strand a pending deletion. Too late once due. */
 cancelDeletion(actor,input){return this.mutate(actor,input,[],{powers:['owner-of-record','admin'],states:['deletion-scheduled'],exposure:false},async(record,value,now,tx)=>{if(now>=record.deletion.notBefore)fail('organization_deletion_due','This deletion can no longer be cancelled.',409);record.state='active';record.deletion=null;await this.audit(tx,record,'organization-deletion-cancelled',actor);});}
 /** System step (account alarm): a scheduled deletion becomes due at `notBefore`, then is handed to the purge port. */
 async tick(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const now=this.clock.now();
  const record=await this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const record=await tx.get(ORG_RECORD);if(record?.kind!=='organization')return null;
   if(record.state==='deletion-scheduled'&&now>=record.deletion.notBefore){record.state='deletion-due';record.revision++;record.updatedAt=now;await this.audit(tx,record,'organization-deletion-due',null);await tx.put(ORG_RECORD,record);}
   return record;
  });
  if(!record)return {state:null,wakeAt:null};
  if(record.state==='deletion-scheduled')return {state:record.state,wakeAt:record.deletion.notBefore};
  if(record.state!=='deletion-due')return {state:record.state,wakeAt:null};
  if(typeof this.purge!=='function')return {state:record.state,wakeAt:null,held:true};
  let outcome;try{outcome=await this.purge(record.id);}catch{outcome=null;}
  return {state:record.state,wakeAt:outcome?.handedOff===true?null:now+3600000,held:outcome?.handedOff!==true};
 }
 /** The newest audit rows, a bounded page (at most 200): `before` is the `next` of a previous page (a sequence number).
  * Reads only the rows returned, never the whole log. */
 async audits(actor,input={}){
  const value=exact(input??{},['limit','before']);
  if(value.limit!==undefined&&(!Number.isSafeInteger(value.limit)||value.limit<1)||value.before!==undefined&&(!Number.isSafeInteger(value.before)||value.before<1))fail('invalid_request','Unsupported organization request.',400);
  const limit=Math.min(value.limit??50,200);
  return this.metadata.transaction(async tx=>{const record=await this.organization(tx,actor),end=Math.min(value.before??Infinity,(record.auditSeq??0)+1),from=Math.max(1,end-limit);
   const entries=end>from?[...(await tx.list({prefix:ORG_AUDIT,startAfter:ORG_AUDIT+String(from-1).padStart(12,'0'),limit:end-from})).values()]:[];
   return {entries,next:from>1?from:null};});
 }
}
