import {revokeAllLineage} from './linked-approval.mjs';
import {AdminService} from './admin.mjs';
import {isUUID as uuid} from '../core/primitives.mjs';

// Kept on the tombstone so permanent namespace claims stay bound and are never recycled. Everything else,
// including the identity `security` state (account-deletion-export.md §2.1), is discarded.
const RETAINED=['id','handle','assignmentId','systemIdentity','onboardingIdentity','createdAt'];
export const TOMBSTONE_REASONS=new Set(['inactive','owner','admin-email','admin-underage','admin-closure']);
/** The deletion reason recorded on an identity tombstone, or null when it carries none. */
export function deletionReason(account){const event=Array.isArray(account?.audit)?account.audit.map(entry=>entry?.event).find(name=>typeof name==='string'&&name.startsWith('account-deleted-')):null,reason=event?.slice('account-deleted-'.length);return TOMBSTONE_REASONS.has(reason)?reason:null;}

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
   const email=typeof account.verifiedEmail==='string'&&Number.isSafeInteger(account.emailVerifiedAt)?account.verifiedEmail:null;
   // DX-3 adds the canonical handle (typed confirmation), internal provenance (R1-L9), the email sign-in
   // setting (R1-M3) and, once deleted, the reason recorded by the tombstone (restore path, R1-L1).
   return {status:account.status,assignmentId:account.assignmentId,createdAt:account.createdAt,verifiedEmail:email,emailVerifiedAt:email?account.emailVerifiedAt:null,
    handle:typeof account.handle==='string'?account.handle:null,systemIdentity:Boolean(account.systemIdentity),emailLoginEnabled:account.emailLoginEnabled===true,
    ...account.status==='deleted'?{deletionReason:deletionReason(account)}:{}};
  },
  /** `reason` names the deletion path: 'inactive' (the lifecycle default, unchanged), or the deletion basis
   * ('owner', 'admin-email', 'admin-underage', 'admin-closure'). It is recorded as `account-deleted-${reason}`. */
  async tombstone(owner,{assignmentId,reason='inactive'}={}){
   if(!uuid(owner)||typeof assignmentId!=='string'&&assignmentId!==undefined||!TOMBSTONE_REASONS.has(reason))throw new TypeError('Invalid tombstone request');
   for(let attempt=0;attempt<4;attempt++){
    const account=await repository.get(owner);if(!account)return false;
    if(assignmentId!==undefined&&account.assignmentId!==assignmentId)throw Object.assign(new Error('Account assignment changed.'),{code:'lifecycle_assignment_changed',status:409});
    if(account.status==='deleted')return true;
    const now=clock(),next=Object.fromEntries(RETAINED.filter(key=>account[key]!==undefined).map(key=>[key,structuredClone(account[key])]));
    revokeAllLineage(account,now);if(account.lineageOutbox?.length)next.lineageOutbox=account.lineageOutbox;
    Object.assign(next,{status:'deleted',deletedAt:now,revision:account.revision+1,sessions:[],credentials:[],challenges:[],emailChallenges:[],passwordHash:null,recoveryHash:null,audit:[{event:`account-deleted-${reason}`,at:now}]});
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
