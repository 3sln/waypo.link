// ORG-4 member key-cache refresh queue (wargame finding F-07, 2026-10-23; provisional coordinator work). Shared by
// packages/orgs/certificates.mjs, which runs it, and packages/orgs/memberships.mjs, which enqueues a member at join and
// at an authority-epoch observation inside its own record transaction.
//
// Keys (the organization's account store):
//   org/cert/refresh/<dueAt, 15 digits>/<principalKey>  {issuer, subject, dueAt, attempts, source}: time-ordered, so a
//                                                       run reads only the rows that are due
//   org/cert/refresh-of/<principalKey>                  -> the queue key (one row per principal)
//   org/cert/refresh-size                               {member, claimed}: row counts per source
//   org/cert/refresh-claimed/<enqueuedAt>/<principalKey> -> the queue key of a 'claimed' row, oldest first: a full
//                                                       claimed set evicts its oldest entry (review follow-up 1)
// Sources: 'member' (roster discovery, join, epoch observation, same-host issuance hints; bounded by the roster size
// plus MEMBER_REFRESH_CLAIMED) and 'claimed' (the request path, for any syntactically valid claimed principal whose
// cached keys are missing or stale, member or not; bounded by MEMBER_REFRESH_CLAIMED).
// ORG-10e: relation counterparts join the background-refresh set as 'member' rows (enqueueCounterpartKeyRefresh, at
// recognition and on an observed move), because relation events and entity certificates verify only against keys
// already held (spec §9.9 step 3, §9.5). A claimed event sender is enqueued as 'claimed' exactly as a claimed member
// certificate would be, so the schedule never depends on participation (RL-R1-H1).
import {principalKey as memberPrincipalKey} from './grants.mjs';

export const MEMBER_REFRESH_PREFIX='org/cert/refresh/',MEMBER_REFRESH_INDEX='org/cert/refresh-of/',MEMBER_REFRESH_SIZE='org/cert/refresh-size',MEMBER_REFRESH_CLAIMED_INDEX='org/cert/refresh-claimed/';
/** Bound of request-path ('claimed') entries; member entries may use the roster size on top of it. */
export const MEMBER_REFRESH_CLAIMED=256,MEMBER_REFRESH_MEMBER_DEFAULT=65536;
const pad=at=>String(Math.max(0,Math.min(Math.floor(at),999999999999999))).padStart(15,'0');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const refreshKey=(dueAt,principal)=>MEMBER_REFRESH_PREFIX+pad(dueAt)+'/'+memberPrincipalKey(principal);
async function sizes(tx){const row=await tx.get(MEMBER_REFRESH_SIZE);return {member:Number.isSafeInteger(row?.member)&&row.member>0?row.member:0,claimed:Number.isSafeInteger(row?.claimed)&&row.claimed>0?row.claimed:0};}

/** Enqueues a key refresh for `principal` ({iss, sub}) due at `now`, inside the caller's transaction `tx` (get, put,
 * delete). Deduplicated per principal (an existing later row is moved to `now`; a 'claimed' row found by a member
 * source becomes a 'member' row). Never throws for a full queue: returns false. `cap` bounds member rows. */
export async function enqueueMemberKeyRefresh(tx,principal,{now,source='member',cap=MEMBER_REFRESH_MEMBER_DEFAULT}={}){
 if(!plain(principal)||typeof principal.sub!=='string'||!principal.sub||principal.sub.length>256||!Number.isSafeInteger(now))return false;
 const kind=source==='claimed'?'claimed':'member',who={iss:principal.iss??null,sub:principal.sub},index=MEMBER_REFRESH_INDEX+memberPrincipalKey(who);
 const count=await sizes(tx),existingKey=await tx.get(index),existing=typeof existingKey==='string'?await tx.get(existingKey):undefined;
 if(existing){
  const upgrade=kind==='member'&&existing.source==='claimed';
  if(existing.dueAt<=now&&!upgrade)return true;
  if(upgrade){if(count.member>=cap)return true;count.member++;count.claimed=Math.max(0,count.claimed-1);if(typeof existing.claimedKey==='string')await tx.delete(existing.claimedKey);}
  const row={...existing,source:upgrade?'member':existing.source,dueAt:Math.min(existing.dueAt,now)},key=refreshKey(row.dueAt,who);if(upgrade)delete row.claimedKey;
  if(typeof row.claimedKey==='string')await tx.put(row.claimedKey,key);
  if(key!==existingKey){await tx.delete(existingKey);await tx.put(key,row);await tx.put(index,key);}else await tx.put(key,row);
  if(upgrade)await tx.put(MEMBER_REFRESH_SIZE,count);return true;
 }
 if(typeof existingKey==='string')await tx.delete(index); // a dangling index entry
 if(kind==='member'&&count.member>=cap)return false;
 // The claimed set is bounded with eviction: a full set drops its oldest entry, so request-path churn can never refuse
 // newer claims (nor crowd out member entries, which are counted separately).
 if(kind==='claimed')while(count.claimed>=MEMBER_REFRESH_CLAIMED){const [oldest]=[...await tx.list({prefix:MEMBER_REFRESH_CLAIMED_INDEX,limit:1})];if(!oldest)break;await tx.delete(oldest[0]);if(!await removeMemberKeyRefresh(tx,oldest[1],{keepIndex:true}))break;count.claimed=(await sizes(tx)).claimed;}
 count[kind]++;const key=refreshKey(now,who),claimedKey=kind==='claimed'?MEMBER_REFRESH_CLAIMED_INDEX+pad(now)+'/'+memberPrincipalKey(who):undefined;
 await tx.put(key,{issuer:who.iss,subject:who.sub,dueAt:now,attempts:0,source:kind,...claimedKey?{claimedKey}:{}});await tx.put(index,key);if(claimedKey)await tx.put(claimedKey,key);await tx.put(MEMBER_REFRESH_SIZE,count);return true;
}
/** Adds a relation counterpart ({iss, sub}) to the background-refresh set (a 'member' row, deduplicated). */
export function enqueueCounterpartKeyRefresh(tx,principal,{now,cap}={}){return enqueueMemberKeyRefresh(tx,principal,{now,source:'member',...cap===undefined?{}:{cap}});}
/** The due rows, oldest first, at most `limit`: [[key, row]]. Reads only due rows (plus one). */
export async function dueMemberKeyRefreshes(tx,now,limit){
 const out=[];for(const [key,row] of await tx.list({prefix:MEMBER_REFRESH_PREFIX,limit:limit+1})){if(!(row?.dueAt<=now)||out.length>=limit)break;out.push([key,row]);}return out;
}
/** Removes one queue row (and its index entry and count). */
export async function removeMemberKeyRefresh(tx,key,{keepIndex=false}={}){
 const row=await tx.get(key);if(!row)return false;const index=MEMBER_REFRESH_INDEX+memberPrincipalKey({iss:row.issuer??null,sub:row.subject});
 await tx.delete(key);if(await tx.get(index)===key)await tx.delete(index);if(!keepIndex&&typeof row.claimedKey==='string')await tx.delete(row.claimedKey);
 const count=await sizes(tx),kind=row.source==='claimed'?'claimed':'member';count[kind]=Math.max(0,count[kind]-1);await tx.put(MEMBER_REFRESH_SIZE,count);return true;
}
/** Moves one queue row to `dueAt` with `attempts`. */
export async function rescheduleMemberKeyRefresh(tx,key,{dueAt,attempts}){
 const row=await tx.get(key);if(!row)return false;const who={iss:row.issuer??null,sub:row.subject},next=refreshKey(dueAt,who);
 await tx.delete(key);await tx.put(next,{...row,dueAt,attempts});await tx.put(MEMBER_REFRESH_INDEX+memberPrincipalKey(who),next);if(typeof row.claimedKey==='string')await tx.put(row.claimedKey,next);return true;
}
/** The earliest due time in the queue, or null. */
export async function nextMemberKeyRefresh(tx){for(const [,row] of await tx.list({prefix:MEMBER_REFRESH_PREFIX,limit:1}))return Number.isSafeInteger(row?.dueAt)?row.dueAt:null;return null;}
