// App-originated v1 items (`app-messages/v1.createOwn`, docs/architecture/activity-center.md "Existing local behavior
// and compatibility") live in their own storage families, owned by activity.
//
// Families (owner-scoped through core `key`):
//   app-message/<owner>/<id>/        one admitted v1 app message (signed `appNotification` provenance, placement,
//                                    tags, read state, presentation history, postbacks, `blobRef`)
//   app-message-usage/<owner>/       {bytes, messages} for those records (originals plus local result revisions)
//
// The legacy peer `message/` family and the `app-messages-v1` move out of it were removed with core messaging
// (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset"): the BB-CUT reset deletes every
// `message/` row outright (user decision SQ-1), so this is the only item family. Notification events stay in
// `notification-event/` and the item index and search documents stay keyed by item ID. Blobs keep their
// `messages/<owner>/…` object names.
import {key} from '../core/records.mjs';

export const APP_MESSAGE='app-message',APP_MESSAGE_USAGE='app-message-usage';
export const appMessageKey=(owner,id)=>key(APP_MESSAGE,owner,id);
export const appMessageUsageKey=owner=>key(APP_MESSAGE_USAGE,owner);
export const isAppMessageKey=path=>typeof path==='string'&&path.startsWith(APP_MESSAGE+'/');
/** Keys of stored activity items (app messages). */
export const isItemKey=isAppMessageKey;
/** Listing prefixes for one owner's items (one family since the BB-CUT reset). */
export const itemPrefixes=owner=>[key(APP_MESSAGE,owner)];
/** The usage counter that accounts for the item stored at `path`. */
export const usageKeyOf=(path,owner)=>appMessageUsageKey(owner);
/** `{path, record}` for an item ID, or null. `get(key)` is any single-key read (transaction or store). */
export async function itemRecord(get,owner,id){
 if(typeof id!=='string'||!id)return null;
 const path=appMessageKey(owner,id),record=await get(path);return record!==undefined&&record!==null?{path,record}:null;
}
export const itemPath=async(get,owner,id)=>(await itemRecord(get,owner,id))?.path??null;
/** Paged scan with an opaque cursor (the last full key read). */
export async function itemPage(list,owner,{cursor,limit}){
 const [prefix]=itemPrefixes(owner),rows=await list({prefix,...typeof cursor==='string'&&cursor.startsWith(prefix)?{startAfter:cursor}:{},limit});
 return rows.size>=limit?{rows,cursor:[...rows.keys()].at(-1),done:false}:{rows,cursor:null,done:true};
}

const count=(value)=>Number.isSafeInteger(value)&&value>=0?value:0;
const usageOf=value=>({bytes:count(value?.bytes),messages:count(value?.messages)});
/** Stored item usage, for account-wide item caps. */
export async function storedItems(tx,owner){return usageOf(await tx.get(appMessageUsageKey(owner)));}
/** Bytes an item holds in the usage counter: the original plus every retained local result revision. */
export const itemBytes=record=>count(record?.size)+count(record?.presentationBytes);
