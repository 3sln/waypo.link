// Contacts phase 4 reset `contact-links-retired-v1` (docs/architecture/contacts-and-links-rethink.md rev 2 §9; provisional,
// unsigned). Contact links, conditional audiences, per-link profile sharing and the developer occupant link left the core
// (CR-C1), so their account rows are deleted outright. Destructive cleanup is acceptable: there are no real users (owner
// direction 2026-10-27, SQ-1). It runs only after CR-C0 (contacts phase 2): key delegation no longer reads `link/`.
// Nothing is migrated.
//
// Deleted, strictly in this order (every row under each prefix, whatever its content):
//   1. derived and transient families: link-evaluations/ link-audience/ link-replay/ link-gc-cursor/ links-rpc/
//      link-change/ link-state/
//   2. contact-sharing/ (per-link profile sharing), rtc/contact/ (retired RTC per-link calling settings, normally already
//      gone with the signaling reset) and developer-contact/ (the sealed developer occupant link pointer, a contact-link
//      capability; an addition to the §9 list, recorded as a divergence); then the `bio` and `discloseToContacts`
//      members of the `profile` row (displayName and avatar stay)
//   3. link/ records, last among the data
// The marker is written last, so a crash resumes where it stopped; each slice is bounded by `limit` deletions (pages of
// at most 64 rows per transaction) and the account gate serializes slices.
//
// Kept: contact-key/ (identity signing keys, despite the name), key-delegation/, organization and relation invitations
// (orgs/…, relation families), and profile.displayName / profile.avatar. Keys pinned only by `link/` records become
// prunable under the normal key policy (packages/identity/keys.mjs no longer counts link records).
export const CONTACT_LINKS_RESET_MARKER='migration/contact-links-retired-v1';
export const CONTACT_LINKS_RESET_STEPS=Object.freeze([
 'link-evaluations/','link-audience/','link-replay/','link-gc-cursor/','links-rpc/','link-change/','link-state/',
 'contact-sharing/','rtc/contact/','developer-contact/',
 {strip:'profile',members:Object.freeze(['bio','discloseToContacts'])},
 'link/',
].map(step=>Object.freeze(typeof step==='string'?{prefix:step}:step)));
/** Every deleted prefix, in order (for tests and the export inventory). */
export const CONTACT_LINKS_RESET_PREFIXES=Object.freeze(CONTACT_LINKS_RESET_STEPS.filter(step=>step.prefix).map(step=>step.prefix));

/** Removes the retired members of one row in a transaction; true when it changed something. Concurrent writes to the
 * kept members (a profile save) are read inside the same transaction, so they are never lost. */
async function stripMembers(metadata,path,members){
 return metadata.transaction(async tx=>{
  const row=await tx.get(path);if(!row||typeof row!=='object'||Array.isArray(row)||!members.some(name=>Object.hasOwn(row,name)))return false;
  const next={...row};for(const name of members)delete next[name];await tx.put(path,next);return true;
 });
}

/**
 * One bounded slice of the reset over the raw account store `metadata` ({get, put, delete, list, transaction}). Returns
 * {done, deleted}: `deleted` counts deleted rows plus one for a stripped profile. Idempotent: after the marker it does
 * nothing; before it, rerunning a completed step finds nothing to do.
 */
export async function resetContactLinks(metadata,{limit=256}={}){
 if(!Number.isSafeInteger(limit)||limit<1)throw new TypeError('resetContactLinks needs a positive limit');
 if(await metadata.get(CONTACT_LINKS_RESET_MARKER)!==undefined)return {done:true,deleted:0};
 let deleted=0;
 for(const step of CONTACT_LINKS_RESET_STEPS){
  if(step.strip){if(deleted>=limit)return {done:false,deleted};if(await stripMembers(metadata,step.strip,step.members))deleted++;continue;}
  while(deleted<limit){
   const rows=await metadata.list({prefix:step.prefix,limit:Math.min(64,limit-deleted)});if(!rows.size)break;
   await metadata.transaction(async tx=>{await tx.delete([...rows.keys()]);});
   deleted+=rows.size;
  }
  if(deleted>=limit&&(await metadata.list({prefix:step.prefix,limit:1})).size)return {done:false,deleted};
 }
 if(deleted>=limit)return {done:false,deleted};
 await metadata.put(CONTACT_LINKS_RESET_MARKER,{version:1,completedAt:Date.now()});
 return {done:true,deleted};
}
