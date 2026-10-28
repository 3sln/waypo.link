// Core links: the type-neutral contact parent (proposed links amendment, DEVLOG 2026-10-27 "Messaging removed from
// core; Parlay rename; BB-CUT reset"; provisional, unsigned).
//
// A contact parent is the owner host's stored authority behind one issued link: the LinkService record
// `link/<jti>/` (./issuance.mjs), whatever its type. It replaces the legacy messaging `contact-grant/<id>` parent,
// which carried collections, MIME types, delivery quotas, intake tags and quarantine; all of that was messaging and
// left the core with it. Owner-side per-link configuration that core still keeps (profile sharing, audience
// decisions and replay rows) is keyed by the parent's `jti` and is live only while
// the parent is: not revoked, unexpired, and owned by this account.
//
// Cap: an owner holds at most LINK_RECORD_CAP live parents (LinkService refuses issuance beyond it with
// `link_limit`). Revoked and expired records are retained 30 days for list/changes and then reclaimed, so repeated
// issue-and-revoke can leave more records than the cap. Scans therefore page through every row in pages of
// CONTACT_PARENT_SCAN (review L5); nothing is silently truncated.
import {key} from '../core/records.mjs';
import {UUID} from '../core/primitives.mjs';
import {CONTACT_LINK_TYPE,MESSAGING_CONTACT_LINK_TYPE} from './types.mjs';

export const LINK_RECORD_CAP=1000;
export const CONTACT_PARENT_SCAN=2048;
/** Every row under `prefix`, read in pages of `page` with `startAfter` (account store `list` returns a Map). */
export async function scanAll(list,prefix,page=CONTACT_PARENT_SCAN){
 const out=new Map();let cursor;
 for(;;){const rows=await list({prefix,limit:page,...cursor!==undefined?{startAfter:cursor}:{}});for(const [k,v]of rows)out.set(k,v);if(rows.size<page)return out;cursor=[...rows.keys()].at(-1);}
}
export const parentKey=jti=>key('link',jti);
/** True for a parent record owned by `owner` that is neither revoked nor expired at `now` (Unix ms). */
export const liveParent=(record,owner,now)=>Boolean(record&&record.owner===owner&&record.revoked!==true&&Number.isSafeInteger(record.claims?.exp)&&record.claims.exp*1000>now);
/** The parent record for `jti` (any single-key reader: a transaction or the store), or null. */
export async function readParent(get,jti){if(typeof jti!=='string'||!UUID.test(jti))return null;return (await get(parentKey(jti)))??null;}
/** The owner-visible summary of a parent (no meta, signature or capability URL). */
export function parentView(record,now){
 return {id:record.jti,type:record.type,slot:record.slot??null,active:record.revoked!==true&&record.claims.exp*1000>now,createdAt:record.issuedAt??null,expiresAt:record.claims.exp*1000,conditional:Boolean(record.claims.audience),...record.claims.audience?.policy?{policy:record.claims.audience.policy}:{},issuer:record.issuer?.kind==='app'?{kind:'app',clientId:record.issuer.clientId}:{kind:record.issuer?.kind??'owner'}};
}
/** The owner's parents, live and retained, ordered by jti. `list({prefix, limit})` returns a Map (account store). */
export async function contactParents(list,owner,now){
 const rows=await scanAll(list,key('link'));
 return [...rows.values()].filter(record=>record?.owner===owner&&typeof record.jti==='string'&&Number.isSafeInteger(record.claims?.exp)).sort((a,b)=>a.jti<b.jti?-1:a.jti>b.jti?1:0).map(record=>parentView(record,now));
}
