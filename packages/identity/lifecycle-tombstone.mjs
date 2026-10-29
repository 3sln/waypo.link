import {legacyEmailView} from './emails.mjs';
import {revokeAllLineage} from './linked-approval.mjs';
import {AdminService} from './admin.mjs';
import {isUUID as uuid} from '../core/primitives.mjs';
import {settlementMarker} from './redirect-records.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

// Kept on the tombstone so permanent namespace claims stay bound and are never recycled. Everything else,
// including the identity `security` state (account-deletion-export.md §2.1), is discarded. A moved identity
// (identity portability PORT-2, design §6.5) additionally keeps its `moved` record until `movedUntil`.
const RETAINED=['id','handle','assignmentId','systemIdentity','onboardingIdentity','createdAt'];
export const RETAINED_MOVED=Object.freeze([...RETAINED,'moved']);
// 'password-retired': the password retirement reset (packages/identity/password-retirement.mjs) of a password-only identity.
export const TOMBSTONE_REASONS=new Set(['inactive','owner','admin-email','admin-underage','admin-closure','moved','password-retired']);
/** The audit type the transfer-out commit writes on the identity (packages/identity/transfer-out.mjs). */
export const MOVED_AUDIT='identity-moved';
/** The deletion reason recorded on an identity tombstone, or null when it carries none. */
export function deletionReason(account){const event=Array.isArray(account?.audit)?account.audit.map(entry=>entry?.event).find(name=>typeof name==='string'&&name.startsWith('account-deleted-')):null,reason=event?.slice('account-deleted-'.length);return TOMBSTONE_REASONS.has(reason)?reason:null;}
const time=value=>Number.isSafeInteger(value)&&value>=0;
/** Design §6.4–§6.5 windows of a moved record at `now`: `live` while the redirect runs (a target and a redirect base,
 * before `redirectUntil`), `proof` while the statement and attestation are kept (before `movedUntil`, at least 30 days
 * after commit), and the next time either ends. */
export function movedWindow(moved,now){
 if(!moved||typeof moved!=='object'||moved.ended===true)return {live:false,proof:false,nextAt:null};
 const live=typeof moved.redirectBase==='string'&&time(moved.redirectUntil)&&now<moved.redirectUntil&&moved.to?.iss!==undefined,proof=time(moved.movedUntil)&&now<moved.movedUntil&&typeof moved.attestation==='string';
 const next=[live?moved.redirectUntil:null,proof?moved.movedUntil:null].filter(time);return {live,proof,nextAt:next.length?Math.min(...next):null};
}
/** What a moved tombstone keeps at `now` (design §6.5 items 3–4): the record while its windows run, then only the
 * marker that the identity moved. After `movedUntil` nothing that names the new address is kept. */
export function retainedMoved(moved,now){
 const window=movedWindow(moved,now);if(!moved||typeof moved!=='object')return null;
 if(window.live||window.proof){const kept=structuredClone(moved);if(!window.live){for(const name of ['redirectBase','reminderEmail','extensionOrder','retarget','destinationKeys'])delete kept[name];}return kept;}
 return null;
}

/** Trusted account-lifecycle identity port over the identity repository. It is
 * never an HTTP operation. `get` projects only what notice/arming needs. `tombstone`
 * irreversibly removes authentication and private contact data while keeping the
 * handle, aliases and assignment so the name is never recycled. Email claims are
 * released through the repository's revision-checked swap, never a raw delete. */
export function lifecycleIdentityPort(repository,{clock=()=>Date.now()}={}){
 if(typeof repository?.get!=='function'||typeof repository.compareAndSwap!=='function')throw new TypeError('An identity repository is required.');
 return Object.freeze({
  async get(owner){
   if(!uuid(owner))throw new TypeError('Invalid account identifier');const account=await repository.get(owner);if(!account)return null;
   // The notice address stands for the record's email in this projection (sign-in and intents spike §3.2).
   const view=legacyEmailView(account),email=view.verifiedEmail;
   // DX-3 adds the canonical handle (typed confirmation), internal provenance (R1-L9), the email sign-in
   // setting (R1-M3) and, once deleted, the reason recorded by the tombstone (restore path, R1-L1).
   return {status:account.status,assignmentId:account.assignmentId,createdAt:account.createdAt,verifiedEmail:email,emailVerifiedAt:email?view.emailVerifiedAt:null,
    handle:typeof account.handle==='string'?account.handle:null,systemIdentity:Boolean(account.systemIdentity),emailLoginEnabled:view.emailLoginEnabled===true,
    ...account.status==='deleted'?{deletionReason:deletionReason(account)}:{},...account.status==='moved'?{moved:true}:{}};
  },
  /** `reason` names the deletion path: 'inactive' (the lifecycle default, unchanged), or the deletion basis
   * ('owner', 'admin-email', 'admin-underage', 'admin-closure'), or 'moved' (PORT-2: the purge after a committed move's
   * export window). It is recorded as `account-deleted-${reason}`. A moved tombstone keeps status `moved` and its
   * `moved` record while the redirect or proof windows run, then answers exactly as a deleted identity. 'moved'
   * only applies to an identity in status `moved`; any other identity refuses it. */
  async tombstone(owner,{assignmentId,reason='inactive'}={}){
   if(!uuid(owner)||typeof assignmentId!=='string'&&assignmentId!==undefined||!TOMBSTONE_REASONS.has(reason))throw new TypeError('Invalid tombstone request');
   for(let attempt=0;attempt<4;attempt++){
    const account=await repository.get(owner);if(!account)return false;
    if(assignmentId!==undefined&&account.assignmentId!==assignmentId)throw Object.assign(new Error('Account assignment changed.'),{code:'lifecycle_assignment_changed',status:409});
    if(account.status==='deleted')return true;
    const moved=reason==='moved';
    if(moved&&account.status!=='moved'||!moved&&account.status==='moved')throw Object.assign(new Error('A moved identity is purged only with reason moved.'),{code:'lifecycle_identity_conflict',status:409});
    if(moved&&time(account.movedPurgedAt))return true;
    const now=clock(),next=Object.fromEntries(RETAINED.filter(key=>account[key]!==undefined).map(key=>[key,structuredClone(account[key])]));
    revokeAllLineage(account,now);if(account.lineageOutbox?.length)next.lineageOutbox=account.lineageOutbox;
    Object.assign(next,{status:'deleted',deletedAt:now,revision:account.revision+1,sessions:[],credentials:[],challenges:[],emailChallenges:[],recoveryHash:null,audit:[{event:`account-deleted-${reason}`,at:now}]});
    if(moved){const kept=retainedMoved(account.moved,now);next.movedPurgedAt=now;if(kept){next.status='moved';next.moved=kept;}else{const marker=plain(account.moved)&&account.moved.ended===true?account.moved.settlement:settlementMarker(account.moved,now);if(marker)next.movedSettlement=structuredClone(marker);}}
    if(await repository.compareAndSwap(owner,account.revision,next))return true;
   }
   throw Object.assign(new Error('The identity changed during deletion; retry later.'),{code:'lifecycle_identity_conflict',status:409});
  }
 });
}

/** Administrator-hold port for the account lifecycle. Uses AdminService's own
 * hold semantics when an admin store exists; an identity suspended by an
 * administrator also counts as held. Failure is reported to the caller, which
 * treats an unreadable hold as held. */
export function lifecycleAdminHoldPort({store,repository}){
 if(typeof repository?.get!=='function')throw new TypeError('An identity repository is required.');
 return async owner=>{
  const hold=store?await AdminService.prototype.lifecycleHold.call({store,repository},owner):{held:false,since:null,releasedAt:null};
  const account=await repository.get(owner);if(!account)throw new Error('Account unavailable');
  return account.status==='suspended'&&!hold.held?{...hold,held:true}:hold;
 };
}

/** Deletion hold port (account-deletion-export.md §4.2, R1-M8): an explicit administrator (legal) hold only.
 * Unlike `lifecycleAdminHoldPort`, identity status `suspended` never holds deletion, so an admin closure or
 * underage deletion is not frozen by its own suspension. Without an admin store nothing can be held. A failing
 * read rejects; the executor treats that as held. */
export function deletionHoldPort({store,repository}){
 if(typeof repository?.get!=='function')throw new TypeError('An identity repository is required.');
 return async owner=>{if(!uuid(owner))throw new TypeError('Invalid account identifier');if(!store)return {held:false,since:null,releasedAt:null};return AdminService.prototype.lifecycleHold.call({store,repository},owner);};
}

/** Built-in admin role port for deletion requests (R1-L9): AdminService's own effective authority over the admin
 * store, without composing the full service. Without an admin store nobody holds the role. Failures reject. */
export function deletionAdminAuthorityPort({store,repository}){
 if(typeof repository?.get!=='function')throw new TypeError('An identity repository is required.');
 const view=Object.assign(Object.create(AdminService.prototype),{store,repository});
 return async owner=>{if(!uuid(owner))throw new TypeError('Invalid account identifier');if(!store)return {admin:false};const authority=await view.authority(owner);return {admin:authority.admin===true};};
}

/** DX-7 closure window port for IdentityService: the applied closure's export window recorded on the admin principal
 * for this exact assignment, or null. No admin store means no closure. */
export function closureWindowPort({store}){
 return Object.freeze({async window(owner,assignmentId){if(!store||!uuid(owner))return null;const row=await store.get('principal/'+owner),closure=row?.assignmentId===assignmentId?row.closure:null;return closure?.state==='applied'&&Number.isSafeInteger(closure.exportUntil)?{exportUntil:closure.exportUntil}:null;}});
}
