// DX-2 exact immutable-ref deferral. Call from the account writer, BEFORE a
// physical delete; leave a deferred row in blob-garbage/ for the next sweep.
// DX-1 writes these hashes and its reverse index in the cursor transaction.
import {AppQuery} from '../app/engine.mjs';
const encoder=new TextEncoder();
export async function exportPinKey(ref){if(typeof ref!=='string'||!ref||ref.length>4096)throw new TypeError('Invalid blob reference');const digest=await crypto.subtle.digest('SHA-256',encoder.encode(ref));return 'export/pin/'+[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function exportPinned(reader,ref){return !!(await reader.get(await exportPinKey(ref)));}
export class ExportPinStatus extends AppQuery {static operation='exports.pin';static deps=['accountStore'];static lifecycle='purging';static termsGate='exempt';async fetch({accountStore}){if(this.actor?.kind!=='system'||await accountStore.get('owner')!==this.actor.owner)throw Object.assign(new Error('Account owner mismatch.'),{code:'forbidden',status:403});return {pinned:await exportPinned(accountStore,this.input?.ref)};}}

export const GARBAGE_CLAIM='blob-garbage-claim/';
/** DX-2: the one physical delete of a `blob-garbage/` row. Without an active export it is exactly the previous
 * delete-then-forget. While an export is active, a ref its pager pinned is deferred (the row stays for a later
 * sweep), and the delete is linearized against the pager with a claim row: either the pager's pin transaction
 * commits first and the sweep defers, or the claim commits first and DX-1's pin transaction refuses the ref
 * (`export_payload_missing`), so an export never indexes bytes that are about to disappear. */
export async function collectGarbageRef(c,key,ref){
 if(await c.metadata.get('export/active')===undefined){await c.blobs.delete(ref);await c.metadata.delete(key);return 'deleted';}
 const pin=await exportPinKey(ref),claim=GARBAGE_CLAIM+pin.slice('export/pin/'.length);
 const claimed=await c.metadata.transaction(async tx=>{if(await tx.get(pin))return false;await tx.put(claim,{ref});return true;});
 if(!claimed)return 'deferred';
 await c.blobs.delete(ref);await c.metadata.transaction(async tx=>{await tx.delete(key);await tx.delete(claim);});return 'deleted';
}
