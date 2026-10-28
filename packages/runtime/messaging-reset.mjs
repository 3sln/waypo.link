// BB-CUT reset `messaging-retired-v1` (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset").
//
// User decision SQ-1 (2026-10-27): "Confirmed, drop the data, nobody is actually using 3sln.me yet; destructive cleanup
// is fine for now." Legacy peer messaging left the core, so its rows are deleted outright. This replaces the planned
// verify-and-move machinery (messaging-extraction.md §4, the `app-messages-v1` move and the `beam-retired-v1` dual
// write): it is a plain, bounded, idempotent delete. Nothing is migrated.
//
// What is deleted (every row under each prefix, whatever its content):
//   message/ message-usage/ message-receipt/            legacy peer items, their counters and idempotency receipts,
//                                                       including any app row the old move never reached
//   contact-grant/ contact-grant-tombstone/ contact-name/ contact-url/ contact-author-day/ contact-delivery-receipt/
//   contact-delivery/                                   legacy contact parents (contact links), names, sealed URLs,
//                                                       anti-abuse counts and delivery fences
//   conversation/                                       Conversation v1 rooms, history, events, outboxes, receipts,
//                                                       sweeps, dead letters and blocks
//   contact-redeemed/ contact-redeemed-peer/ saved-contact/ beam/
//                                                       redemption bindings and saved contacts of the legacy parents, and
//                                                       every Beam-era row (beam/profile is first copied to `profile` when
//                                                       `profile` is absent)
//   developer-contact/v1 developer-contact/v2           the legacy developer-contact grant pointers
//   migration/app-messages-v1* migration/beam-retired-v1*   markers and cursors of the retired migrations
// Each deleted `message/` row gets the full item cleanup of `dropLegacyItem` (below), which the shelved-archive restore
// (accounts.mjs `warm`) shares: its blob and presentation-revision blobs go to the existing garbage queue (only refs
// under the owner's `messages/<owner>/` prefix), its postback preparations and `notification-event/` row are deleted,
// and `effects.item` removes it from the item index and tombstones its search document.
//
// What is kept: `app-message/` items (activity), collections, rules, tag labels, Views, `profile`, identity keys,
// notification state, billing and lifecycle state. The contact-link families it kept at the time (`link/`, `link-*`,
// `contact-sharing/`) were deleted later by the contacts phase 4 reset `contact-links-retired-v1`
// (packages/runtime/contact-links-reset.mjs).
// The marker is written last, so a crash resumes. The account gate serializes slices.
import {key} from '../core/records.mjs';
import {erasePostbackPreparations} from './message-postbacks.mjs';

export const MESSAGING_RESET_MARKER='migration/messaging-retired-v1';
export const MESSAGING_RESET_PREFIXES=Object.freeze([
 'message/','message-usage/','message-receipt/',
 'contact-grant/','contact-grant-tombstone/','contact-name/','contact-url/','contact-author-day/','contact-delivery-receipt/','contact-delivery/',
 'conversation/',
 'contact-redeemed/','contact-redeemed-peer/','saved-contact/','beam/',
 'developer-contact/v1','developer-contact/v2',
 'migration/app-messages-v1','migration/beam-retired-v1',
]);

const PROFILE_KEY='profile',LEGACY_PROFILE_KEY='beam/profile';
const named=(row,owner)=>row.owner===owner&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=4096;
// A search document id is `message:<id>` of at most 300 characters (search/outbox.mjs).
const searchable=(row,owner)=>named(row,owner)&&row.id.length<=292;
/** The blob refs a legacy item owns: its content and its presentation revisions, only under `messages/<owner>/`. A ref
 * outside that prefix (corrupt data) is never queued: the bucket is shared between accounts (export-pins.mjs). */
export function legacyItemRefs(row,owner){
 if(!row||typeof row!=='object'||typeof owner!=='string'||!owner)return [];
 const prefix=`messages/${owner}/`,refs=[row.blobRef];
 const history=row.presentation?.history;if(Array.isArray(history))for(const r of history.slice(0,64))refs.push(r?.blobRef);
 return [...new Set(refs.filter(ref=>typeof ref==='string'&&ref.length>prefix.length&&ref.length<=4096&&ref.startsWith(prefix)))];
}
/**
 * Full cleanup of one dropped legacy `message/` row inside the caller's transaction `tx`: blob and presentation blobs to
 * the garbage queue, postback preparations and the notification event deleted, and `effects.item(tx,row)` (item index
 * and search tombstone) for a well-formed row of this owner. Shared by the reset and the shelved-archive restore. It
 * never throws on a malformed row: such a row is still deleted by the caller, only the effects it cannot name are skipped.
 * Returns the queued garbage keys and refs.
 */
export async function dropLegacyItem(tx,row,{owner,effects=null}={}){
 const queued=[];if(!row||typeof row!=='object')return queued;
 for(const ref of legacyItemRefs(row,owner)){const path=`blob-garbage/${crypto.randomUUID()}`;await tx.put(path,ref);queued.push({key:path,blobRef:ref});}
 if(named(row,owner)){await tx.delete(key('notification-event',owner,row.id));await erasePostbackPreparations(tx,owner,row.id);}
 if(searchable(row,owner)&&effects?.item)await effects.item(tx,row);
 return queued;
}
/** Review L3: the legacy-authoritative `beam/profile` is copied to `profile` when `profile` is absent, before `beam/`
 * is deleted. Only the known profile fields are kept, each type-checked; anything else stays behind. */
async function preserveLegacyProfile(metadata,owner){
 await metadata.transaction(async tx=>{
  if(await tx.get(PROFILE_KEY)!==undefined)return;const legacy=await tx.get(LEGACY_PROFILE_KEY);if(!legacy||typeof legacy!=='object')return;
  const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)?v:'';
  let avatar=text(legacy.avatar,2048);if(avatar){try{const url=new URL(avatar);if(url.protocol!=='https:'||url.username||url.password)avatar='';}catch{avatar='';}}
  await tx.put(PROFILE_KEY,{displayName:text(legacy.displayName,100),bio:text(legacy.bio,500),avatar,discloseToContacts:legacy.discloseToContacts===true,...typeof owner==='string'?{owner}:{},updatedAt:Number.isSafeInteger(legacy.updatedAt)?legacy.updatedAt:Date.now()});
 });
}

/**
 * One bounded slice of the reset over the raw account store `metadata` ({get, put, delete, list, transaction}).
 * `owner` defaults to the store's `owner` row. `effects` (optional, called inside the slice transaction for each
 * well-formed deleted `message/` row): {item(tx, row)} for the item index and search tombstone. Returns {done, deleted}.
 */
export async function resetLegacyMessaging(metadata,{limit=256,effects=null,owner}={}){
 if(await metadata.get(MESSAGING_RESET_MARKER)!==undefined)return {done:true,deleted:0};
 owner??=await metadata.get('owner');
 let deleted=0;
 for(const prefix of MESSAGING_RESET_PREFIXES){
  if(prefix==='beam/')await preserveLegacyProfile(metadata,owner);
  while(deleted<limit){
   const rows=await metadata.list({prefix,limit:Math.min(64,limit-deleted)});if(!rows.size)break;
   await metadata.transaction(async tx=>{
    const paths=[];
    for(const [path,row]of rows){
     paths.push(path);
     if(prefix==='message/')await dropLegacyItem(tx,row,{owner,effects});
    }
    await tx.delete(paths);
   });
   deleted+=rows.size;
  }
  if(deleted>=limit)return {done:false,deleted};
 }
 await metadata.put(MESSAGING_RESET_MARKER,{version:1,completedAt:Date.now()});
 return {done:true,deleted};
}
