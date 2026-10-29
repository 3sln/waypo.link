// Email-bridge removal reset `email-bridge-retired-v1` (owner direction 2026-10-28: strike the email bridge for now;
// revisit later; provisional, unsigned). The 3sln.me email-bridge extension, its provider feature, the public-intake
// fragment it consumed and the bridge's own resource left the code, so their account rows are deleted outright.
// Destructive cleanup is acceptable: there are no real users (owner direction 2026-10-27, SQ-1). Nothing is migrated.
// The bridge's own storage (settings, holding queue, dedup, reply ledger, sender shards) lived in EmailBridgeObject and
// goes with that class (Wrangler migration v11, `deleted_classes`); Node never had bridge storage.
//
// Deleted, strictly in this order:
//   1. the email-bridge provider-feature grant record (`connections/feature/<digest(spec)>`, only when its `spec` matches)
//   2. connections notices about that feature or the public-intake field (bounded: notices are capped at 64)
//   3. announcement state for the public-intake field (`connections/announced/<digest(fragment)>/…` and
//      `connections/announce-muted/<digest(fragment)>`)
//   4. the public-intake field value (`connections/field/<digest(fragment)>`, only when its `fragment` matches), last
//      among the data
// The marker is written last, so a crash resumes where it stopped; each slice is bounded by `limit` page deletions (plus at
// most the two single feature and field rows) and the account gate serializes slices. Brokered records are kept: a Parlay mailbox record lists the retired public-intake
// contract beside its mailbox contract, and that string is inert now that nothing calls it.
import {digest} from '../core/records.mjs';

export const EMAIL_BRIDGE_RESET_MARKER='migration/email-bridge-retired-v1';
/** The retired identifiers (no longer published or recognized). */
export const RETIRED_EMAIL_BRIDGE=Object.freeze({
 spec:'https://3sln.me/extensions/email-bridge/v1',
 fragment:'https://spec.bindle.example/fragments/public-intake/v1',
});
const FEATURE='connections/feature/',FIELD='connections/field/',NOTICE='connections/notice/',ANNOUNCED='connections/announced/',MUTED='connections/announce-muted/';
const NOTICE_SCAN=128;
/** Whether an account row belongs to the retired email bridge (never exported; deleted by the reset). */
export const retiredEmailBridgeRow=row=>row!==null&&typeof row==='object'&&(row.spec===RETIRED_EMAIL_BRIDGE.spec||row.feature===RETIRED_EMAIL_BRIDGE.spec||row.fragment===RETIRED_EMAIL_BRIDGE.fragment);

/**
 * One bounded slice of the reset over the raw account store `metadata` ({get, put, delete, list, transaction}). Returns
 * {done, deleted}. Idempotent: after the marker it does nothing; before it, rerunning a completed step finds nothing.
 */
export async function resetEmailBridge(metadata,{limit=256}={}){
 if(!Number.isSafeInteger(limit)||limit<1)throw new TypeError('resetEmailBridge needs a positive limit');
 if(await metadata.get(EMAIL_BRIDGE_RESET_MARKER)!==undefined)return {done:true,deleted:0};
 const crypto=globalThis.crypto,featureKey=FEATURE+await digest(crypto,RETIRED_EMAIL_BRIDGE.spec),fragment=await digest(crypto,RETIRED_EMAIL_BRIDGE.fragment);
 let deleted=0;
 const one=async(key,match=()=>true)=>metadata.transaction(async tx=>{const row=await tx.get(key);if(row===undefined||!match(row))return;await tx.delete(key);deleted++;});
 // 1. The feature grant record.
 await one(featureKey,row=>row?.spec===RETIRED_EMAIL_BRIDGE.spec);
 // 2. Notices about the feature or the field.
 const notices=await metadata.list({prefix:NOTICE,limit:NOTICE_SCAN});
 for(const [key,row] of notices){if(deleted>=limit)return {done:false,deleted};if(retiredEmailBridgeRow(row))await one(key,retiredEmailBridgeRow);}
 // 3. Announcement state for the field.
 while(deleted<limit){
  const rows=await metadata.list({prefix:`${ANNOUNCED}${fragment}/`,limit:Math.min(64,limit-deleted)});if(!rows.size)break;
  await metadata.transaction(async tx=>{await tx.delete([...rows.keys()]);});deleted+=rows.size;
 }
 if(deleted>=limit)return {done:false,deleted};
 await one(MUTED+fragment);
 // 4. The field value, last among the data.
 await one(FIELD+fragment,row=>row?.fragment===RETIRED_EMAIL_BRIDGE.fragment);
 await metadata.put(EMAIL_BRIDGE_RESET_MARKER,{version:1,completedAt:Date.now()});
 return {done:true,deleted};
}
