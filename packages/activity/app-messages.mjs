// App-originated v1 items (`app-messages/v1.createOwn`, docs/architecture/activity-center.md "Existing local behavior
// and compatibility") get their own storage families, owned by activity, so the BB-CUT peer-messaging reset
// (messaging-extraction.md §4, `messaging-retired-v1`) can delete `message/*` without ever reaching them.
//
// Families (owner-scoped through core `key`):
//   app-message/<owner>/<id>/        one admitted v1 app message: the same record shape the legacy store used
//                                    (signed `appNotification` provenance, placement, tags, read state, presentation
//                                    history, postbacks, `blobRef`), so the existing APIs read it unchanged
//   app-message-usage/<owner>/       {bytes, messages} for those records (originals plus local result revisions)
//   migration/app-messages-v1        marker: one full pass over `message/` reached its end. NOT a completion signal:
//                                    rows restored later (shelving) or written by rolled-back code can land in
//                                    `message/` after it; the restore clears it, and the BB-CUT reset runs its own
//                                    full verify-and-move pass and never gates on it (messaging-extraction.md §4)
//   migration/app-messages-v1-cursor the pass position
//   migration/app-messages-v1-diag   {unverifiedAppShaped, pending, completedAt}: rows that look like this owner's app
//                                    messages (v1 purpose, matching owner and ID) but do not verify against the
//                                    current key set (rotated kid, changed APP_ORIGIN, key set trimmed); operator
//                                    review, never an automatic delete (review F3)
//   migration/app-messages-v1-reconciled-at  last completed post-marker reconcile pass (daily throttle, review F6)
//
// Readers resolve an item ID through `itemPath`/`itemRecord` (this family first, then the legacy `message/` family);
// listings use `itemPrefixes`. Notification events stay in `notification-event/` (the activity notification queue,
// which the reset keeps) and the item index and search documents stay keyed by item ID, so none of them move.
// Blobs keep their `messages/<owner>/…` object names; the reset must delete peer blobs per record, never by prefix.
import {key} from '../core/records.mjs';
import {verifyLegacyAppMessage,LEGACY_PURPOSE} from './legacy.mjs';

export const APP_MESSAGE='app-message',APP_MESSAGE_USAGE='app-message-usage';
export const APP_MESSAGES_MARKER='migration/app-messages-v1',APP_MESSAGES_CURSOR='migration/app-messages-v1-cursor';
export const APP_MESSAGES_DIAGNOSTIC='migration/app-messages-v1-diag',APP_MESSAGES_RECONCILED='migration/app-messages-v1-reconciled-at';
/** Keys a restore of `message/` rows must clear so the next warm runs a full pass again (review F2). */
export const APP_MESSAGES_PASS_KEYS=Object.freeze([APP_MESSAGES_MARKER,APP_MESSAGES_CURSOR,APP_MESSAGES_RECONCILED]);
/** A row shaped like one of this owner's v1 app messages (whether or not its attestation verifies). */
export const appShaped=(row,owner)=>row?.appNotification?.purpose===LEGACY_PURPOSE&&row.owner===owner&&row.appNotification.owner===owner&&typeof row.id==='string'&&row.appNotification.id===row.id;
export const appMessageKey=(owner,id)=>key(APP_MESSAGE,owner,id);
export const appMessageUsageKey=owner=>key(APP_MESSAGE_USAGE,owner);
export const isAppMessageKey=path=>typeof path==='string'&&path.startsWith(APP_MESSAGE+'/');
/** Keys of message-shaped items in either family (legacy peer store or app messages). */
export const isItemKey=path=>typeof path==='string'&&(path.startsWith('message/')||isAppMessageKey(path));
/** Listing prefixes for one owner's items, legacy family first (stable order for paged scans). */
export const itemPrefixes=owner=>[key('message',owner),key(APP_MESSAGE,owner)];
/** The usage counter that accounts for the item stored at `path`. */
export const usageKeyOf=(path,owner)=>isAppMessageKey(path)?appMessageUsageKey(owner):key('message-usage',owner);
/** `{path, record}` for an item ID, or null. `get(key)` is any single-key read (transaction or store). */
export async function itemRecord(get,owner,id){
 if(typeof id!=='string'||!id)return null;
 for(const path of [appMessageKey(owner,id),key('message',owner,id)]){const record=await get(path);if(record!==undefined&&record!==null)return {path,record};}
 return null;
}
export const itemPath=async(get,owner,id)=>(await itemRecord(get,owner,id))?.path??null;
/** Paged scan over both families with one opaque cursor: the last full key read (its prefix names the phase). A short
 * legacy page continues into the app family in the same call, so a scan that fits in one page finishes in one call. */
export async function itemPage(list,owner,{cursor,limit}){
 const [legacy,app]=itemPrefixes(owner),rows=new Map(),after=prefix=>typeof cursor==='string'&&cursor.startsWith(prefix)?{startAfter:cursor}:{};
 if(!(typeof cursor==='string'&&cursor.startsWith(app))){
  const first=await list({prefix:legacy,...after(legacy),limit});for(const [k,v]of first)rows.set(k,v);
  if(first.size>=limit)return {rows,cursor:[...rows.keys()].at(-1),done:false};
 }
 const wanted=limit-rows.size,rest=await list({prefix:app,...after(app),limit:wanted});for(const [k,v]of rest)rows.set(k,v);
 return rest.size>=wanted?{rows,cursor:[...rows.keys()].at(-1),done:false}:{rows,cursor:null,done:true};
}

const count=(value)=>Number.isSafeInteger(value)&&value>=0?value:0;
const usageOf=value=>({bytes:count(value?.bytes),messages:count(value?.messages)});
/** Both families' usage summed, for account-wide item caps. `legacy` is an already-read `message-usage` row (optional). */
export async function storedItems(tx,owner,legacy){
 const a=usageOf(legacy??await tx.get(key('message-usage',owner))),b=usageOf(await tx.get(appMessageUsageKey(owner)));
 return {bytes:a.bytes+b.bytes,messages:a.messages+b.messages};
}
/** Bytes an item holds in the usage counter: the original plus every retained local result revision. */
export const itemBytes=record=>count(record?.size)+count(record?.presentationBytes);

/**
 * `app-messages-v1`: moves existing app-message rows out of `message/` into `app-message/` by VERIFIED provenance
 * (the issuer's v1 admission attestation against its own published key set, ./legacy.mjs). One bounded slice per call
 * from a stored cursor, each row moved in its own transaction with both usage counters, so a crash resumes and never
 * double-counts. Rows whose provenance does not verify stay where they are: they are inert history, not app activity,
 * and the reset treats them as peer records (§4). The marker is written once a pass reaches the end; callers on the
 * warm path stop there, while the alarm path keeps reconciling one slice at a time (a rollback to pre-move code could
 * write new app rows into `message/`). Without a usable key set nothing moves and the cursor does not advance.
 * `metadata` is the raw transactional account store (never the side-effecting message adapter: a move is neither a
 * deletion nor a new delivery, so no blob, search or notification effect may run).
 */
export async function migrateAppMessages(metadata,{owner,issuer,keys,limit=64,holds=[]}={}){
 if(typeof owner!=='string'||!owner)return {done:false,moved:0,unverified:0,reason:'no-owner'};
 if(!keys||!Array.isArray(keys.keys)||!keys.keys.length)return {done:false,moved:0,unverified:0,reason:'keys-unavailable'};
 // `holds`: keys whose presence pauses the pass (e.g. shelving, an active export), checked up front and inside every move.
 const held=async get=>{for(const k of holds)if(await get(k)!==undefined)return k;return null;};
 {const hold=await held(k=>metadata.get(k));if(hold)return {done:false,moved:0,unverified:0,reason:'held',hold};}
 const prefix=key('message',owner),cursor=await metadata.get(APP_MESSAGES_CURSOR);
 const rows=await metadata.list({prefix,...typeof cursor==='string'&&cursor.startsWith(prefix)?{startAfter:cursor}:{},limit});
 let moved=0,unverified=0,conflicts=0,shaped=0,hold=null;
 for(const [path,row]of rows){
  if(!row?.appNotification||row.owner!==owner||typeof row.id!=='string')continue;
  if(!await verifyLegacyAppMessage(row,{issuer,keys})){unverified++;if(appShaped(row,owner))shaped++;continue;}
  const target=appMessageKey(owner,row.id);
  const result=await metadata.transaction(async tx=>{
   if(await held(k=>tx.get(k)))return 'held';
   const current=await tx.get(path);if(!current?.appNotification||current.owner!==owner||current.id!==row.id)return 'gone';
   // The signed provenance is immutable; a changed one is a different record and is re-verified on the next pass.
   if(JSON.stringify(current.appNotification)!==JSON.stringify(row.appNotification))return 'changed';
   if(await tx.get(target)!==undefined)return 'conflict';
   const bytes=itemBytes(current),stored=await tx.get(key('message-usage',owner)),legacy=usageOf(stored),app=usageOf(await tx.get(appMessageUsageKey(owner)));
   await tx.put(target,current);await tx.delete(path);
   // A legacy counter that is already short (pre-existing drift) is clamped rather than blocking the move.
   await tx.put(key('message-usage',owner),{...stored??{},bytes:Math.max(0,legacy.bytes-bytes),messages:Math.max(0,legacy.messages-1)});
   await tx.put(appMessageUsageKey(owner),{bytes:app.bytes+bytes,messages:app.messages+1});
   return 'moved';
  });
  if(result==='held'){hold=await held(k=>metadata.get(k));break;}
  if(result==='moved')moved++;else if(result==='conflict')conflicts++;
 }
 // A hold that appeared mid-slice leaves the cursor where it was; the slice is repeated once the hold clears.
 if(hold)return {done:false,moved,unverified,conflicts,reason:'held',hold};
 const done=rows.size<limit;
 await metadata.transaction(async tx=>{
  const prior=await tx.get(APP_MESSAGES_DIAGNOSTIC),pending=(cursor?count(prior?.pending):0)+shaped;
  if(done){await tx.delete(APP_MESSAGES_CURSOR);if(await tx.get(APP_MESSAGES_MARKER)===undefined)await tx.put(APP_MESSAGES_MARKER,{version:1,completedAt:Date.now()});await tx.put(APP_MESSAGES_DIAGNOSTIC,{unverifiedAppShaped:pending,pending:0,completedAt:Date.now()});}
  else{await tx.put(APP_MESSAGES_CURSOR,[...rows.keys()].at(-1));await tx.put(APP_MESSAGES_DIAGNOSTIC,{unverifiedAppShaped:count(prior?.unverifiedAppShaped),pending,completedAt:prior?.completedAt??null});}
 });
 return {done,moved,unverified,conflicts,unverifiedAppShaped:shaped};
}
