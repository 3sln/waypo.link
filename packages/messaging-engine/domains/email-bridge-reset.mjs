// Email-bridge removal reset `parlay-email-bridge-retired-v1` (owner direction 2026-10-28: strike the email bridge for
// now; revisit later; provisional, unsigned). Destructive cleanup is acceptable (no real users; DEVLOG 2026-10-27, SQ-1).
//
// Bridged public intake left Parlay: the `bridge.*` operations, `intake.deliver`, `intake.accept`, the public-intake RPC
// handler, address allowlist entries and channel-origin (bridged email) items. This bounded, idempotent reset, in the
// style of the contact-links reset (./contact-links-reset.mjs), deletes the retired mailbox families, in this order:
//   1. `bridge/`        the bridge settings and consumer fingerprint dedup rows;
//   2. `intake/tx/`, `intake/jti/`  the public-intake replay fences (only bridged intake wrote them);
//   3. `allow/e/`       address allowlist entries (principal entries, `allow/p/`, stay);
//   4. channel-origin items (`item/<id>` with origin `channel`), with their pending and Rejected index rows, their
//      incoming projection and any hot usage they held, paged over `item/` with a cursor row.
// The marker is written last, so a crash resumes where it stopped. Native items, native public requests, the intake
// settings (`settings/intake`) and every other family are kept.
//
// Where it runs: the app shells run `mailbox.reset-email-bridge` (system actor) on mailbox open, after the contact-links
// reset, and again from the mailbox alarm until the marker exists (apps/parlay/worker/mailbox.mjs `open` and `alarm`).
import {MailboxAction} from '../engine.mjs';
import {KEYS,actorOwner,chargeUsage} from '../store/mailbox.mjs';
import {removeIncoming} from '../store/item-index.mjs';

export const EMAIL_BRIDGE_RESET='parlay-email-bridge-retired-v1';
export const EMAIL_BRIDGE_RESET_MARKER=`migration/${EMAIL_BRIDGE_RESET}`;
const CURSOR=`${EMAIL_BRIDGE_RESET_MARKER}/items`;
export const EMAIL_BRIDGE_RESET_PREFIXES=Object.freeze(['bridge/','intake/tx/','intake/jti/','allow/e/']);
const listPage=async(store,prefix,after,n)=>new Map([...await store.list({prefix,...after===undefined?{}:{startAfter:after},limit:n})].filter(([key])=>after===undefined||key>after).slice(0,n));
const channelItem=item=>item!==null&&typeof item==='object'&&item.origin==='channel';

// Removes one channel item and its index rows inside the caller's transaction. Returns the number of rows deleted.
async function dropChannelItem(tx,key){
 const item=await tx.get(key);if(!channelItem(item))return 0;const id=key.slice('item/'.length);let n=1;
 await tx.delete(key);await removeIncoming(tx,id);
 if(Number.isSafeInteger(item.receivedAt)&&await tx.get(KEYS.pending(item.receivedAt,id))!==undefined){await tx.delete(KEYS.pending(item.receivedAt,id));n++;}
 if(Number.isSafeInteger(item.rejectedAt)&&await tx.get(KEYS.rejected(item.rejectedAt,id))!==undefined){await tx.delete(KEYS.rejected(item.rejectedAt,id));n++;}
 if(await tx.get(KEYS.body(id))!==undefined){await tx.delete(KEYS.body(id));n++;}
 if(item.hot>0)await chargeUsage(tx,{bytes:-item.hot,items:-1});
 return n;
}

/**
 * One bounded slice of the reset over the raw mailbox store ({get, list, transaction}). At most `limit` rows are deleted
 * or items examined per call, in transactions of at most `page` rows. Returns {done, deleted}.
 */
export async function resetEmailBridge(store,{limit=256,page=64,now=Date.now()}={}){
 if(await store.get(EMAIL_BRIDGE_RESET_MARKER)!==undefined)return {done:true,deleted:0};
 let work=0,deleted=0;
 // 1–3. Retired families, whole prefixes.
 for(const prefix of EMAIL_BRIDGE_RESET_PREFIXES){
  while(work<limit){
   const rows=await listPage(store,prefix,undefined,Math.min(page,limit-work));if(!rows.size)break;
   await store.transaction(async tx=>{for(const key of rows.keys())await tx.delete(key);});work+=rows.size;deleted+=rows.size;
  }
  if(work>=limit)return {done:false,deleted};
 }
 // 4. Channel-origin items, resuming after the stored cursor; each page is decided against the live rows.
 while(work<limit){
  const after=await store.get(CURSOR),n=Math.min(page,limit-work),rows=await listPage(store,'item/',after??undefined,n);if(!rows.size)break;
  await store.transaction(async tx=>{if(await tx.get(CURSOR)!==after)return;for(const [key,item] of rows)if(channelItem(item))deleted+=await dropChannelItem(tx,key);await tx.put(CURSOR,[...rows.keys()].at(-1));});
  work+=rows.size;if(rows.size<n)break;
 }
 if(work>=limit)return {done:false,deleted};
 // 5. Marker last.
 await store.transaction(async tx=>{await tx.delete(CURSOR);await tx.put(EMAIL_BRIDGE_RESET_MARKER,{version:1,completedAt:now});});
 return {done:true,deleted};
}

export class MailboxResetEmailBridge extends MailboxAction {
 static operation='mailbox.reset-email-bridge';static deps=['receive','clock'];static changes='incoming-changed';
 run({receive,clock}){actorOwner(this.actor,['system','owner']);const {limit,page}=this.input??{};return resetEmailBridge(receive.store,{limit:Number.isSafeInteger(limit)&&limit>0&&limit<=4096?limit:256,page:Number.isSafeInteger(page)&&page>0&&page<=256?page:64,now:clock.now()});}
}
export const EMAIL_BRIDGE_RESET_OPERATIONS=[MailboxResetEmailBridge];
