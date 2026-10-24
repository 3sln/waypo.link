// Admin summaries for large organizations (2026-10-24, "Break-glass and ownership outbox scaling"; provisional
// coordinator work, unsigned). Maintained by the roster in the same transaction as the membership rows, so the
// break-glass eligibility and quorum checks and the member outbox never enumerate every admin.
//
// Keys (organization account store, beside packages/orgs/roster.mjs):
//   org/admin/<principalKey>                       {id, since, u, f}: a live membership holding an admin grant.
//                                                  `since` is the member-outbox sequence after which it is an admin
//                                                  (its notices are those with seq > since); u/f are the times of its
//                                                  rows below (null: none).
//                                                  A legacy value is the bare membership id (since 0, no rows).
//   org/admin-unbounded/<issuer>/<t15>/<key>       live, unheld, no membership expiry, with an admin grant without an
//                                                  expiry; t = the earliest such grant's grantedAt. Break-glass tenure.
//   org/admin-from/<t15>/<key>                     live, unheld, membership and some admin grant not expired when it
//                                                  was written; t = the earliest notBefore among those grants. The
//                                                  roster re-indexes the row when a grant expires (`admin-reindex` due).
//   org/admin-ended/<seq12>/<key>                  {id, since, until, r}: an admin who stopped being one at outbox seq
//                                                  `until`, kept only while a fan-out notice with seq <= until is pending;
//                                                  `r` is the organization's admin-removal counter (roster.removals).
//   org/outbox/fanout/<seq12>                      a pending member outbox event addressed to the admins by fan-out.
// The record's `roster` summary gains `admins` (the org/admin/ row count) and `ix` (this layout's version).
// Every reader verifies the membership row itself; an index only bounds which rows are read.
import {principalKey} from './grants.mjs';

export const ADMIN_INDEX_VERSION=3;
export const ADMIN_KEYS=Object.freeze({admin:'org/admin/',unbounded:'org/admin-unbounded/',from:'org/admin-from/',ended:'org/admin-ended/',fanout:'org/outbox/fanout/'});
/** Provisional figures: a notice to at most this many admins still carries its recipients inline (the pre-existing event
 * shape); above it the drain delivers the admins in pages of ORG_FANOUT_PAGE through a cursor on the event. */
export const ORG_INLINE_ADMINS=64,ORG_FANOUT_PAGE=256;
const pad=at=>String(Math.max(0,Math.min(Math.floor(at),999999999999999))).padStart(15,'0');
export const seqKey=n=>String(Math.max(0,n)).padStart(12,'0');
const live=m=>m?.state==='live';
const adminGrants=m=>Array.isArray(m?.grants)?m.grants.filter(g=>g?.power==='admin'):[];
/** Whether a membership row belongs in the admin index (as Roster#admins has always filtered it). */
export const isAdminRow=m=>live(m)&&adminGrants(m).length>0;
const issuerPart=iss=>encodeURIComponent(JSON.stringify(iss??null));
/** The org/admin-unbounded/ partition of one issuer (break-glass eligibility is for admins homed on this provider). */
export const unboundedPrefix=iss=>ADMIN_KEYS.unbounded+issuerPart(iss)+'/';
/** The org/admin-unbounded/ time of a membership row (the earliest grantedAt of an admin grant without an expiry, on a
 * live, unheld membership without an expiry), or null. */
export function unboundedTime(m){
 if(!live(m)||m.hold||m.expires_at!==undefined)return null;
 const times=adminGrants(m).filter(g=>g.expires_at===undefined&&Number.isSafeInteger(g.grantedAt)).map(g=>g.grantedAt);
 return times.length?Math.min(...times):null;
}
/** The org/admin-from/ time (the earliest notBefore among admin grants not expired at `now`, on a live, unheld membership
 * not expired at `now`), or null. */
export function fromTime(m,now){
 if(!live(m)||m.hold||m.expires_at!==undefined&&!(m.expires_at>now/1000))return null;
 const times=adminGrants(m).filter(g=>g.expires_at===undefined||g.expires_at>now/1000).map(g=>Number.isFinite(g.notBefore)?Math.floor(g.notBefore):0);
 return times.length?Math.min(...times):null;
}
// The roster key is principalKey(principal), so the issuer partition is derived from it.
const issuerOf=key=>{try{return JSON.parse(decodeURIComponent(key))[0]??null;}catch{return null;}};
const uKey=(key,t)=>t===null||t===undefined?null:unboundedPrefix(issuerOf(key))+pad(t)+'/'+key;
const fKey=(key,t)=>t===null||t===undefined?null:ADMIN_KEYS.from+pad(t)+'/'+key;
export const adminEntry=v=>typeof v==='string'?{id:v,since:0,u:null,f:null}:v&&typeof v==='object'?v:null;
/** The smallest pending fan-out sequence, or Infinity. */
async function firstFanout(tx){const [first]=[...await tx.list({prefix:ADMIN_KEYS.fanout,limit:1})];return first?Number(first[0].slice(ADMIN_KEYS.fanout.length)):Infinity;}
/** Re-indexes one membership row (`m`, possibly undefined) at roster key `key`. `base` is the member-outbox sequence
 * before this transaction's notices. Returns the change in the admin count. */
export async function indexAdmin(tx,key,m,now,base,removal=()=>null){
 const k=ADMIN_KEYS.admin+key,prev=adminEntry(await tx.get(k));
 if(!isAdminRow(m)){
  if(!prev)return 0;
  for(const x of [uKey(key,prev.u),fKey(key,prev.f)])if(x)await tx.delete(x);
  await tx.delete(k);
  // A fan-out notice queued before this change still owes this admin its pages.
  if(await firstFanout(tx)<=base)await tx.put(ADMIN_KEYS.ended+seqKey(base)+'/'+key,{id:prev.id,since:prev.since??0,until:base,r:removal()});
  return -1;
 }
 const u=unboundedTime(m),f=fromTime(m,now),next={id:m.id,since:prev?prev.since??0:base,u,f};
 for(const [old,nu] of [[uKey(key,prev?.u),uKey(key,u)],[fKey(key,prev?.f),fKey(key,f)]]){if(old&&old!==nu)await tx.delete(old);if(nu&&(old!==nu||prev.id!==m.id))await tx.put(nu,1);}
 if(!prev||JSON.stringify(prev)!==JSON.stringify(next))await tx.put(k,next);
 return prev?0:1;
}
/** One-time layout migration: rebuilds every derived row from the admin index and the stored membership rows.
 * O(admins) once per organization (pre-release; organizations are behind ORGANIZATIONS_ENABLED). Returns the count. */
export async function rebuildAdminIndexes(tx,now){
 for(const prefix of [ADMIN_KEYS.unbounded,ADMIN_KEYS.from])for(const [k] of await tx.list({prefix,limit:1000000}))await tx.delete(k);
 let count=0;
 for(const [k] of await tx.list({prefix:ADMIN_KEYS.admin,limit:1000000})){
  const key=k.slice(ADMIN_KEYS.admin.length),m=await tx.get('org/member/'+key);
  if(!isAdminRow(m)){await tx.delete(k);continue;}
  const u=unboundedTime(m),f=fromTime(m,now);if(u!==null)await tx.put(uKey(key,u),1);if(f!==null)await tx.put(fKey(key,f),1);
  await tx.put(k,{id:m.id,since:0,u,f});count++;
 }
 return count;
}
/**
 * Up to `want` memberships, in index order, from a time-ordered index (`prefix` + 15-digit time + '/' + principalKey)
 * with time <= `upTo`, that `accept` (the authoritative predicate, applied to the roster's copy, so changes made in this
 * transaction count). Rows changed in this transaction that the stored index does not list are considered too.
 */
export async function scanAdmins(roster,prefix,upTo,accept,want){
 const out=[],seen=new Set();let after='',limit=Math.min(32,want+4);
 scan:for(;;){
  const rows=[...await roster.tx.list({prefix,startAfter:after,limit})];
  for(const [k] of rows){
   after=k;const rest=k.slice(prefix.length),at=Number(rest.slice(0,15)),key=rest.slice(16);
   if(!(at<=upTo))break scan;seen.add(key);const m=await roster.member(key);
   if(m&&accept(m)&&!out.includes(m)){out.push(m);if(out.length>=want)break scan;}
  }
  if(rows.length<limit)break;limit=32;
 }
 if(out.length<want)for(const {member:m} of roster.changedMembers()){if(seen.has(principalKey(m.principal))||out.includes(m)||!accept(m))continue;out.push(m);if(out.length>=want)break;}
 return out;
}
/**
 * The next page of a fan-out notice's admin recipients (`event.fanout` is its cursor): every admin whose interval holds
 * the event's sequence — live admins with since < seq, then admins that ended at or after it — skipping the event's
 * named members (page 0 carries those). At most `limit` index rows are read. `final` once the cursor is exhausted.
 * Review (2026-10-24, L3): each live page remembers the last key it listed and the removal counter read AFTER listing
 * (`cursor.seen`). An ended row whose key a live page covered, removed after that page was read (r > its counter), was
 * delivered by that page and is skipped. A removal racing the read can still be delivered twice (never missed), so the
 * port deduplicates by event id and admin id.
 */
export async function fanoutPage(store,event,limit=ORG_FANOUT_PAGE){
 const s=event.seq,skip=new Set(event.recipients??[]),cursor={phase:'live',after:'',pages:0,...event.fanout,seen:[...event.fanout?.seen??[]]},ids=[];let scanned=0,final=false;
 const removals=async()=>(await store.get('org/record-v1'))?.roster?.removals??0;
 while(scanned<limit){
  const want=limit-scanned;
  if(cursor.phase==='live'){
   const rows=[...await store.list({prefix:ADMIN_KEYS.admin,startAfter:cursor.after?ADMIN_KEYS.admin+cursor.after:'',limit:want})];
   for(const [k,v] of rows){scanned++;cursor.after=k.slice(ADMIN_KEYS.admin.length);const e=adminEntry(v);if(e&&(e.since??0)<s&&!skip.has(e.id)&&!ids.includes(e.id))ids.push(e.id);}
   const done=rows.length<want;if(rows.length||done)cursor.seen.push([done?'\uffff':cursor.after,await removals()]);
   if(done){cursor.phase='ended';cursor.after='';}
  }else{
   // Ended rows are keyed by `until`; start just below this event's sequence.
   const rows=[...await store.list({prefix:ADMIN_KEYS.ended,startAfter:ADMIN_KEYS.ended+(cursor.after||seqKey(s-1)+'0'),limit:want})];
   for(const [k,v] of rows){scanned++;cursor.after=k.slice(ADMIN_KEYS.ended.length);if(!v||!((v.since??0)<s&&v.until>=s)||skip.has(v.id)||ids.includes(v.id))continue;
    const key=cursor.after.slice(13),page=Number.isSafeInteger(v.r)?cursor.seen.find(([end])=>key<=end):null;
    if(page&&v.r>page[1])continue; // the live page that covered this key was read before the removal: already delivered
    ids.push(v.id);}
   if(rows.length<want){final=true;break;}
  }
 }
 return {ids,cursor,final};
}
/** Inside a transaction, after a fan-out notice ended: drops its marker and the ended-admin rows no pending fan-out can
 * still need (at most `budget` per call; the rest go with the next one). */
export async function fanoutDone(tx,seq,budget=64){
 await tx.delete(ADMIN_KEYS.fanout+seqKey(seq));const min=await firstFanout(tx);
 for(const [k,v] of await tx.list({prefix:ADMIN_KEYS.ended,limit:budget})){if(!(v?.until<min))break;await tx.delete(k);}
}
