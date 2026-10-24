// ORG-2 roster storage (wargame finding F-02, 2026-10-23; provisional coordinator work). The organization record
// `org/record-v1` holds only bounded summary state; every membership, invitation, grant-management request and member
// outbox event is its own key in the organization's account store, written in the SAME transaction as the record, so
// every operation stays atomic. A `Roster` is a per-transaction unit of work: rows are loaded on demand, mutated in
// place, and `flush()` writes only the rows that changed and maintains the secondary indexes. No operation reads the
// whole roster, except the admin listing and the paginated background reads.
//
// Keys (organization account store):
//   org/member/<principalKey>                 membership row (principalKey as in grants.mjs)
//   org/member-id/<membership id>             -> principalKey
//   org/admin/<principalKey>                  -> membership id, while the row is live and holds an admin grant
//   org/invitation/<id>                       invitation row; org/invitation-open/<id> -> expiresAt while pending
//   org/request/<id>                          grant-management request row
//   org/request-target/<membership id>/<id>   by subject; org/request-by/<principalKey>/<id> by requester;
//   org/request-open/<id>                     -> state, while 'subject' or 'elevated'
//   org/outbox/pending/<seq>                  member outbox event awaiting delivery ({..., attempts, nextAt})
//   org/outbox/delivered/<seq>                delivered event, kept for ORG_RETENTION_MS
//   org/due/<ms, 15 digits>/<kind>/<ref>      time index: the sweep reads only what is due
// The record carries `roster:{v:2, live, admins, ix}` (live membership and admin counts, admin index layout) and
// `outboxSeq`. The admin summaries and the member outbox fan-out are packages/orgs/admin-index.mjs (2026-10-24).
// The pre-release single-value shape (memberships, invitations, grantRequests and memberOutbox inside the record) is
// not migrated: organizations are behind ORGANIZATIONS_ENABLED and unreleased.
import {AppFault} from '../app/faults.mjs';
import {principalKey} from './grants.mjs';
import {readOwnershipOutbox} from './ownership-effects.mjs';
import {ADMIN_INDEX_VERSION,ADMIN_KEYS,ORG_INLINE_ADMINS,isAdminRow,indexAdmin,rebuildAdminIndexes,seqKey as fanoutSeq} from './admin-index.mjs';

const DAY=86400000;
export const ORG_ROSTER_VERSION=2;
export const ORG_KEYS=Object.freeze({member:'org/member/',memberId:'org/member-id/',admin:'org/admin/',invitation:'org/invitation/',invitationOpen:'org/invitation-open/',request:'org/request/',requestTarget:'org/request-target/',requestBy:'org/request-by/',requestOpen:'org/request-open/',outboxPending:'org/outbox/pending/',outboxDelivered:'org/outbox/delivered/',due:'org/due/'});
/** Provisional figures (coordinator, 2026-10-23). Closed invitations and requests and delivered outbox events are kept
 * this long, then pruned; an outbox event nobody could deliver is dropped after ORG_OUTBOX_EXPIRY_MS. */
export const ORG_RETENTION_MS=30*DAY,ORG_OUTBOX_EXPIRY_MS=90*DAY,ORG_SWEEP_BATCH=256;
/** Byte budget of any one stored roster row (membership, invitation, request, outbox event). Far below the 2 MB
 * Durable Object value limit; the per-member lists have their own entry caps as well. */
export const ORG_ROW_BYTES=64*1024;
export const ORG_ADMIN_DELAY_MS=3*DAY;
const ROSTER=Symbol('orgs.roster'),OPEN=['subject','elevated'];
const pad=at=>String(Math.max(0,Math.min(at,999999999999999))).padStart(15,'0'),seqKey=n=>String(n).padStart(12,'0');
const hasAdmin=m=>Boolean(m?.grants?.some(g=>g.power==='admin'));
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
export const rosterOf=record=>record?.[ROSTER]??null;
export const openRequest=q=>OPEN.includes(q?.state);

export class Roster{
 /** `tx`: the account transaction (get, put, delete, list({prefix, startAfter, limit}) -> Map). */
 constructor(tx,record){
  this.tx=tx;this.record=record;this.rows=new Map();this.notices=[];this.dues=new Map();this.reindexed=new Set();this.members=Object.create(null);
  Object.defineProperty(record,ROSTER,{value:this,enumerable:false,configurable:true,writable:true});
  // The loaded memberships, keyed by principalKey, as organizationPowers and requestDecisions read them. Never
  // serialized (non-enumerable): the record itself never stores the roster.
  Object.defineProperty(record,'memberships',{value:this.members,enumerable:false,configurable:true,writable:true});
 }
 async #load(key){if(this.rows.has(key))return this.rows.get(key).value;const value=await this.tx.get(key);this.rows.set(key,{value,before:value===undefined?null:JSON.stringify(value)});return value;}
 #set(key,value){const entry=this.rows.get(key);if(entry)entry.value=value;else this.rows.set(key,{value,before:null});}
 async #list(prefix,limit=100000){return [...await this.tx.list({prefix,limit})];}
 #cached(prefix,predicate){const out=[];for(const [key,entry] of this.rows)if(key.startsWith(prefix)&&entry.value!==undefined&&predicate(entry.value))out.push(entry.value);return out;}

 // ---- memberships ------------------------------------------------------------------------------------------
 async member(key){if(typeof key!=='string')return undefined;const m=await this.#load(ORG_KEYS.member+key);if(m)this.members[key]=m;return m;}
 principal(principal){return this.member(principalKey(principal));}
 async memberById(id){
  if(typeof id!=='string'||!id||id.length>128)return undefined;for(const m of Object.values(this.members))if(m.id===id)return m;
  const key=await this.#load(ORG_KEYS.memberId+id),m=typeof key==='string'?await this.member(key):undefined;return m?.id===id?m:undefined;
 }
 putMember(key,m){this.#set(ORG_KEYS.member+key,m);this.members[key]=m;return m;}
 /** Live memberships holding an admin grant (whatever its time bounds), through the admin index. */
 async admins(){
  for(const [key] of await this.#list(ORG_KEYS.admin))await this.member(key.slice(ORG_KEYS.admin.length));
  return Object.values(this.members).filter(m=>m.state==='live'&&hasAdmin(m));
 }
 /** The admin count after this transaction's changes (the stored summary plus the changed rows), or null before the
  * admin index layout exists. */
 adminCount(){
  if(this.record.roster?.ix!==ADMIN_INDEX_VERSION)return null;let n=this.record.roster.admins??0;
  for(const [key,entry] of this.rows)if(key.startsWith(ORG_KEYS.member)&&entry.value!==undefined&&JSON.stringify(entry.value)!==entry.before)n+=(isAdminRow(entry.value)?1:0)-(entry.before!==null&&isAdminRow(JSON.parse(entry.before))?1:0);
  return Math.max(0,n);
 }
 /** Whether the admin summaries (packages/orgs/admin-index.mjs) can answer for this organization. */
 indexed(){return this.record.roster?.ix===ADMIN_INDEX_VERSION;}
 /** Re-derives a membership's admin index rows at the next flush (a grant expired; the row itself did not change). */
 reindex(key){if(typeof key==='string')this.reindexed.add(key);}
 /** Memberships whose stored row changed in this transaction: [{member, before}] (before is null for a new row). */
 changedMembers(){const out=[];for(const [key,entry] of this.rows)if(key.startsWith(ORG_KEYS.member)&&entry.value!==undefined&&JSON.stringify(entry.value)!==entry.before)out.push({member:entry.value,before:entry.before===null?null:JSON.parse(entry.before)});return out;}
 /** One page of membership rows in key order (admin listing, background key discovery). */
 async page({after='',limit=1000}={}){const rows=[...await this.tx.list({prefix:ORG_KEYS.member,startAfter:after?ORG_KEYS.member+after:'',limit})];for(const [key,value] of rows){const k=key.slice(ORG_KEYS.member.length);if(!this.members[k]){this.members[k]=value;this.rows.set(key,{value,before:JSON.stringify(value)});}}return {members:rows.map(([key])=>this.members[key.slice(ORG_KEYS.member.length)]),next:rows.length===limit?rows.at(-1)[0].slice(ORG_KEYS.member.length):null};}

 // ---- invitations ------------------------------------------------------------------------------------------
 invitation(id){return typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)?this.#load(ORG_KEYS.invitation+id):undefined;}
 putInvitation(row){this.#set(ORG_KEYS.invitation+row.id,row);return row;}
 /** Pending invitations that have not expired (bounded by the invitation limit plus those awaiting the sweep). */
 async pendingInvitations(now){let n=0;for(const [,expiresAt] of await this.#list(ORG_KEYS.invitationOpen,1024))if(expiresAt>now)n++;return n+this.#cached(ORG_KEYS.invitation,i=>i.state==='pending'&&i.expiresAt>now&&!this.#indexedInvitation(i.id)).length;}
 #indexedInvitation(id){const entry=this.rows.get(ORG_KEYS.invitation+id);return entry?.before!==null&&JSON.parse(entry.before).state==='pending';}
 removeInvitation(row){this.#set(ORG_KEYS.invitation+row.id,undefined);}

 // ---- grant-management requests ------------------------------------------------------------------------
 request(id){return typeof id==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(id)?this.#load(ORG_KEYS.request+id):undefined;}
 putRequest(q){this.#set(ORG_KEYS.request+q.id,q);return q;}
 async #byIndex(prefix,predicate){const out=new Set();for(const [key] of await this.#list(prefix)){const q=await this.request(key.slice(prefix.length));if(q)out.add(q);}for(const q of this.#cached(ORG_KEYS.request,predicate))out.add(q);return [...out];}
 /** Requests whose subject is membership `id` (open and retained closed ones). */
 requestsFor(id){return this.#byIndex(ORG_KEYS.requestTarget+id+'/',q=>q.target===id);}
 /** Requests made by `principal`. */
 requestsBy(principal){const key=principalKey(principal);return this.#byIndex(ORG_KEYS.requestBy+key+'/',q=>principalKey(q.requester)===key);}
 /** Open requests ('subject' or 'elevated'). */
 async openRequests(){return (await this.#byIndex(ORG_KEYS.requestOpen,openRequest)).filter(openRequest);}
 /** One page of stored requests (open ones and closed ones still within the retention window), in key order, read
  * with a bounded indexed query: at most `limit` rows are materialized. `next` continues after the last one. */
 async requestPage({after='',limit=100}={}){
  const rows=[...await this.tx.list({prefix:ORG_KEYS.request,startAfter:after?ORG_KEYS.request+after:'',limit})],out=[];
  for(const [key,value] of rows){const q=this.rows.has(key)?this.rows.get(key).value:(this.rows.set(key,{value,before:JSON.stringify(value)}),value);if(q)out.push(q);}
  return {requests:out,next:rows.length===limit?rows.at(-1)[0].slice(ORG_KEYS.request.length):null};
 }
 removeRequest(q){this.#set(ORG_KEYS.request+q.id,undefined);}

 // ---- outbox and time index ----------------------------------------------------------------------------------
 /** Queues a member outbox event. `admins`: also address every live admin (resolved at flush, after all changes). */
 notice(row,{admins=false,members=[]}={}){this.notices.push({row,admins,members});}
 /** Schedules the sweep to look at (kind, ref) at `at` (ms). A stale entry is harmless: the sweep re-checks the row. */
 due(at,kind,ref){if(Number.isSafeInteger(at))this.dues.set(ORG_KEYS.due+pad(at)+'/'+kind+'/'+ref,{at,kind,ref});}
 /** The earliest time scheduled by this transaction after `now`, or null. */
 nextDue(now){let next=null;for(const {at} of this.dues.values())if(at>now)next=Math.min(next??Infinity,at);return next;}

 /** Writes every changed row, its indexes and time entries, then the queued notices. Throws (and so rolls back the
  * whole transaction) when a row exceeds ORG_ROW_BYTES. Returns whether anything was written. */
 async flush(now){
  const tx=this.tx,record=this.record;let wrote=false;
  // One-time admin index layout migration (2026-10-24), before any row below reads it.
  if(record.roster?.v===ORG_ROSTER_VERSION&&record.roster.ix!==ADMIN_INDEX_VERSION){record.roster.admins=await rebuildAdminIndexes(tx,now);record.roster.ix=ADMIN_INDEX_VERSION;wrote=true;}
  // The member-outbox sequence before this transaction's notices: admin changes below take effect after it.
  const base=record.outboxSeq??0;
  // Notices first: resolving the admin recipients may load rows, and the outbox sequence lives on the record.
  if(this.notices.length){
   // Up to ORG_INLINE_ADMINS admins are resolved now (the event lists them); more are delivered by fan-out pages, each
   // admin whose admin interval holds the event's sequence (the same snapshot: the admins after this transaction).
   const anyAdmins=this.notices.some(n=>n.admins),count=anyAdmins?this.adminCount():null,fan=count!==null&&count>ORG_INLINE_ADMINS;
   const admins=anyAdmins&&!fan?(await this.admins()).map(m=>m.id):[];
   for(const {row,admins:all,members} of this.notices.splice(0)){
    const seq=record.outboxSeq=(record.outboxSeq??0)+1,named=members.filter(id=>typeof id==='string'),recipients=[...new Set([...all&&!fan?admins:[],...named])];
    const event={...row,...(all||members.length)?{recipients}:{},...all&&fan?{fanout:{phase:'live',after:'',pages:0}}:{},seq,attempts:0,nextAt:row.at};
    const key=ORG_KEYS.outboxPending+seqKey(seq);this.#size(key,event);await tx.put(key,event);this.due((row.at??now)+ORG_OUTBOX_EXPIRY_MS,'outbox-expire',seqKey(seq));wrote=true;
    if(event.fanout)await tx.put(ADMIN_KEYS.fanout+fanoutSeq(seq),1);
   }
  }
  for(const [key,entry] of this.rows){
   const after=entry.value===undefined?null:JSON.stringify(entry.value);if(after===entry.before)continue;
   const before=entry.before===null?null:JSON.parse(entry.before),value=entry.value;wrote=true;
   if(key.startsWith(ORG_KEYS.member)){const k=key.slice(ORG_KEYS.member.length);this.reindexed.delete(k);await this.#member(k,before,value,now,base);}
   else if(key.startsWith(ORG_KEYS.invitation))await this.#invitation(before,value,now);
   else if(key.startsWith(ORG_KEYS.request))await this.#request(before,value,now);
   if(value===undefined)await tx.delete(key);else{this.#size(key,value);await tx.put(key,value);}
   entry.before=after;
  }
  for(const k of this.reindexed){if(this.indexed()){const d=await indexAdmin(tx,k,await this.member(k),now,base,()=>this.#removal());this.record.roster.admins=Math.max(0,(this.record.roster.admins??0)+d);this.#reindexDue(k,await this.member(k),now);wrote=true;}}
  this.reindexed.clear();
  for(const [key,value] of this.dues){await tx.put(key,value);wrote=true;}
  this.dues.clear();return wrote;
 }
 #size(key,value){const bytes=new TextEncoder().encode(JSON.stringify(value)).length;if(bytes>ORG_ROW_BYTES)fail(key.startsWith(ORG_KEYS.member)?'member_row_limit':'organization_row_limit','This change is too large to store.',413);}
 /** The admin-removal counter (packages/orgs/admin-index.mjs fanoutPage, review L3). */
 #removal(){this.record.roster.removals=(this.record.roster.removals??0)+1;return this.record.roster.removals;}
 /** The admin-from index forgets an expired grant only when the row is re-indexed: schedule that at each expiry. */
 #reindexDue(key,m,now){if(!isAdminRow(m))return;for(const g of m.grants)if(g.power==='admin'&&Number.isSafeInteger(g.expires_at)&&g.expires_at*1000>now)this.due(g.expires_at*1000,'admin-reindex',key);}
 async #member(key,before,m,now,base){
  const tx=this.tx,live=v=>v?.state==='live';
  if(m===undefined)return;
  if(!before||before.id!==m.id)await tx.put(ORG_KEYS.memberId+m.id,key);
  this.record.roster??={v:ORG_ROSTER_VERSION,live:0};
  if(this.indexed()){this.record.roster.admins=Math.max(0,(this.record.roster.admins??0)+await indexAdmin(tx,key,m,now,base,()=>this.#removal()));this.#reindexDue(key,m,now);}
  else{const admin=live(m)&&hasAdmin(m),wasAdmin=live(before)&&hasAdmin(before);if(admin)await tx.put(ORG_KEYS.admin+key,m.id);else if(wasAdmin||!before)await tx.delete(ORG_KEYS.admin+key);}this.record.roster.live=Math.max(0,(this.record.roster.live??0)+(live(m)?1:0)-(live(before)?1:0));
  if(live(m)){
   if(m.expires_at!==undefined&&(before?.expires_at!==m.expires_at||!live(before)))this.due(m.expires_at*1000,'member-expiry',key);
   if(Number.isSafeInteger(m.hold?.noticeAt)&&m.hold.noticeAt!==before?.hold?.noticeAt)this.due(m.hold.noticeAt+ORG_ADMIN_DELAY_MS,'member-hold',key);
   for(const g of m.grants??[])if(Number.isSafeInteger(g.notBefore)&&g.notBefore>now&&!before?.grants?.some(o=>o.notBefore===g.notBefore))this.due(g.notBefore,'member-wake',key);
  }
 }
 async #invitation(before,i,now){
  const tx=this.tx,id=(i??before).id;
  if(i===undefined){await tx.delete(ORG_KEYS.invitationOpen+id);return;}
  if(i.state==='pending'){if(before?.state!=='pending'){await tx.put(ORG_KEYS.invitationOpen+id,i.expiresAt);this.due(i.expiresAt,'invitation-expiry',id);}}
  else if(!before||before.state==='pending'){i.closedAt??=now;await tx.delete(ORG_KEYS.invitationOpen+id);this.due(i.closedAt+ORG_RETENTION_MS,'invitation-prune',id);}
 }
 async #request(before,q,now){
  const tx=this.tx,id=(q??before).id,row=q??before,by=ORG_KEYS.requestBy+principalKey(row.requester)+'/'+id,target=ORG_KEYS.requestTarget+row.target+'/'+id;
  if(q===undefined){for(const key of [by,target,ORG_KEYS.requestOpen+id])await tx.delete(key);return;}
  if(!before){await tx.put(by,1);await tx.put(target,1);}
  if(openRequest(q)){if(!openRequest(before)||before.state!==q.state)await tx.put(ORG_KEYS.requestOpen+id,q.state);}
  else if(!before||openRequest(before)){q.closedAt??=now;await tx.delete(ORG_KEYS.requestOpen+id);this.due(q.closedAt+ORG_RETENTION_MS,'request-prune',id);}
 }
}
/** Attaches a Roster to `record` for transaction `tx` and preloads the named principals (null entries are skipped). */
export async function attachRoster(tx,record,principals=[]){
 const roster=rosterOf(record)??new Roster(tx,record);
 for(const p of principals)if(p&&typeof p.sub==='string')await roster.principal(p);
 return roster;
}
/** A read of the organization record with the named principals' memberships attached (outside any write). */
export async function loadOrganization(metadata,principals=[]){
 return metadata.transaction(async tx=>{const record=await tx.get('org/record-v1');if(record?.kind!=='organization')return record;if(record.roster?.v===ORG_ROSTER_VERSION)await attachRoster(tx,record,[...principals,record.ownerOfRecord]);return record;});
}
/** The whole organization in the legacy single-value shape: tests, export and diagnostics only (reads every row). */
export async function readOrganization(metadata){
 const record=await metadata.get('org/record-v1');if(record?.kind!=='organization'||record.roster?.v!==ORG_ROSTER_VERSION)return record;
 const all=async prefix=>[...await metadata.list({prefix})];
 const memberships=Object.fromEntries((await all(ORG_KEYS.member)).map(([key,value])=>[key.slice(ORG_KEYS.member.length),value]));
 const invitations=Object.fromEntries((await all(ORG_KEYS.invitation)).map(([,value])=>[value.id,value]));
 const grantRequests=Object.fromEntries((await all(ORG_KEYS.request)).map(([,value])=>[value.id,value]));
 const memberOutbox=[...(await all(ORG_KEYS.outboxDelivered)),...(await all(ORG_KEYS.outboxPending))].map(([,value])=>value).sort((a,b)=>a.seq-b.seq);
 // The ownership outbox has been rows since 2026-10-24 (packages/orgs/ownership-effects.mjs); shown here as the old field.
 const ownershipOutbox=await readOwnershipOutbox(metadata,record);
 return {...record,memberships,invitations,grantRequests,memberOutbox,ownershipOutbox};
}
