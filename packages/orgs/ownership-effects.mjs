// The ownership outbox as individual rows (2026-10-24, "Break-glass and ownership outbox scaling"; provisional
// coordinator work, unsigned). Before this, every effect lived in one `ownershipOutbox` array on the organization record:
// 1,000 critical effects made a 500 KB record and 5,000 passed the 2 MB Durable Object value limit, and each append
// rescanned the array. Each effect is now its own key, written in the SAME transaction as the record (so every guarantee
// of the commit that queues it holds), with indexes that keep queueing, draining and pruning bounded.
//
// Keys (organization account store):
//   org/effect/<id>                        the effect row {id, kind, ..., createdAt, doneAt, attempts, nextAt}
//   org/effect-due/<nextAt15>/<id>         while pending: the drain reads due effects in time order
//   org/effect-done/<doneAt15>/<id>        once done: kept 30 days, at most OUTBOX_DONE_KEPT rows (oldest go first)
//   org/effect-claim/<claim>/<id>          a pending break-glass owner notice, by claim (an ended claim drops them)
// Record summary `ownershipEffects:{v:1, pending, done, subs:{[subscriptionId]: pending count}}`: the pending cap and
// "is a revoke or refund for this subscription still pending" are answered from it without reading rows. It stays
// bounded: `subs` only names subscriptions the record's billing map already holds.
//
// Per transaction, `queueEffect` buffers new rows on the record (non-enumerable) and `loadEffect`/`claimEffects` load
// rows for change; `flushEffects` (OwnershipService#beforeCommit) writes them with their indexes and the summary.
// A record still carrying the pre-release in-record `ownershipOutbox` array is migrated by its next commit: pending rows
// and the newest OUTBOX_DONE_KEPT done rows of the last 30 days become rows, and the array is removed. Until then the
// readers below count the array too.
const DAY=86400000,BOX=Symbol('orgs.ownership-effects');
export const EFFECT_KEYS=Object.freeze({row:'org/effect/',due:'org/effect-due/',done:'org/effect-done/',claim:'org/effect-claim/'});
export const EFFECT_RETENTION_MS=30*DAY;
const pad=at=>String(Math.max(0,Math.min(Number.isFinite(at)?Math.floor(at):0,999999999999999))).padStart(15,'0');
const legacy=r=>Array.isArray(r?.ownershipOutbox)?r.ownershipOutbox:[];
const pending=e=>Boolean(e)&&!e.doneAt;
export const effectSummary=r=>{r.ownershipEffects??={v:1,pending:0,done:0,subs:{}};r.ownershipEffects.subs??={};return r.ownershipEffects;};
function box(r){
 if(!r[BOX])Object.defineProperty(r,BOX,{value:{added:[],rows:new Map()},enumerable:false,configurable:true,writable:true});
 return r[BOX];
}
/** The rows this transaction queued or loaded, with their state now and as stored (null for a new row). */
function touched(r){
 const b=r?.[BOX];if(!b)return [];
 return [...b.added.map(e=>({e,before:null})),...[...b.rows.values()].map(x=>({e:x.value,before:x.before===null?null:JSON.parse(x.before)}))];
}
/** Pending effects now (stored summary, this transaction's changes and any legacy array). Only pending rows count. */
export function pendingEffects(r){
 let n=r?.ownershipEffects?.pending??0;for(const {e,before} of touched(r))n+=(pending(e)?1:0)-(pending(before)?1:0);
 return n+legacy(r).filter(pending).length;
}
/** Whether a pending effect (a revoke or a refund) names subscription `id`. */
export function subscriptionEffectPending(r,id){
 let n=r?.ownershipEffects?.subs?.[id]??0;for(const {e,before} of touched(r))n+=(pending(e)&&e.subscriptionId===id?1:0)-(pending(before)&&before.subscriptionId===id?1:0);
 return n>0||legacy(r).some(e=>pending(e)&&e.subscriptionId===id);
}
/** The effects this transaction queued so far (tests and diagnostics). */
export const queuedEffects=r=>[...(r?.[BOX]?.added??[])];
/** Buffers a new effect row for this transaction's flush. */
export function queueEffect(r,row){box(r).added.push(row);return row;}
/** The effect `id` for change in this transaction (a queued, legacy or stored row), or undefined. */
export async function loadEffect(tx,r,id){
 const b=box(r);if(b.rows.has(id))return b.rows.get(id).value;
 const own=b.added.find(e=>e.id===id)??legacy(r).find(e=>e?.id===id);if(own)return own;
 if(typeof id!=='string')return undefined;const value=await tx.get(EFFECT_KEYS.row+id);if(value===undefined)return undefined;
 b.rows.set(id,{value,before:JSON.stringify(value)});return value;
}
/** Pending owner-notice effects of break-glass claim `claim` (and any of its rows still in a legacy array), for change. */
export async function claimEffects(tx,r,claim){
 const out=[],prefix=EFFECT_KEYS.claim+claim+'/';let after='';
 for(;;){const rows=[...await tx.list({prefix,startAfter:after,limit:128})];for(const [k] of rows){after=k;const e=await loadEffect(tx,r,k.slice(prefix.length));if(e&&!out.includes(e))out.push(e);}if(rows.length<128)break;}
 for(const e of [...box(r).added,...legacy(r)])if(e?.claim===claim&&!out.includes(e))out.push(e);
 return out;
}
/** The earliest nextAt among pending effects (stored and this transaction's), or null. */
export async function firstDueAt(store,r){
 let at=null;const [first]=[...await store.list({prefix:EFFECT_KEYS.due,limit:1})];if(first)at=Number(first[0].slice(EFFECT_KEYS.due.length,EFFECT_KEYS.due.length+15));
 for(const {e} of touched(r))if(pending(e))at=Math.min(at??Infinity,e.nextAt??0);
 for(const e of legacy(r))if(pending(e))at=Math.min(at??Infinity,e.nextAt??0);
 return at;
}
/** Up to `limit` stored effects due at `now`, in nextAt order (outside a transaction; the drain re-reads each). */
export async function dueEffects(store,now,limit){
 const out=[];for(const [k] of await store.list({prefix:EFFECT_KEYS.due,limit})){
  const at=Number(k.slice(EFFECT_KEYS.due.length,EFFECT_KEYS.due.length+15));if(at>now)break;
  const e=await store.get(EFFECT_KEYS.row+k.slice(EFFECT_KEYS.due.length+16));if(pending(e))out.push(e);
 }
 return out;
}
const indexKeys=e=>pending(e)?[EFFECT_KEYS.due+pad(e.nextAt??0)+'/'+e.id,...e.kind==='owner-notice'&&typeof e.claim==='string'?[EFFECT_KEYS.claim+e.claim+'/'+e.id]:[]]:[EFFECT_KEYS.done+pad(e.doneAt)+'/'+e.id];
function count(s,e,sign){
 if(!e)return;if(pending(e)){s.pending+=sign;if(typeof e.subscriptionId==='string'){const n=(s.subs[e.subscriptionId]??0)+sign;if(n>0)s.subs[e.subscriptionId]=n;else delete s.subs[e.subscriptionId];}}else s.done+=sign;
}
async function store(tx,s,e,before){
 const old=before?indexKeys(before):[],next=indexKeys(e);
 for(const k of old)if(!next.includes(k))await tx.delete(k);for(const k of next)if(!old.includes(k))await tx.put(k,1);
 await tx.put(EFFECT_KEYS.row+e.id,e);count(s,before,-1);count(s,e,1);
}
async function remove(tx,s,doneKey){
 const id=doneKey.slice(EFFECT_KEYS.done.length+16),e=await tx.get(EFFECT_KEYS.row+id);
 await tx.delete(doneKey);await tx.delete(EFFECT_KEYS.row+id);if(e&&pending(e))for(const k of indexKeys(e))await tx.delete(k);
 if(!e||!pending(e))s.done=Math.max(0,s.done-1);
}
/**
 * Writes this transaction's effects: the one-time legacy migration, new rows, changed rows, then bounded pruning of
 * done rows (older than 30 days, and the oldest beyond `doneKept`). Never refuses a row: capacity is checked where a new
 * non-critical effect is queued (OwnershipService#outbox). Returns whether anything was written.
 */
export async function flushEffects(tx,r,now,{doneKept}){
 const b=r[BOX];let wrote=false;
 if(Array.isArray(r.ownershipOutbox)){
  const rows=r.ownershipOutbox.filter(e=>typeof e?.id==='string');delete r.ownershipOutbox;wrote=true;const s=effectSummary(r);
  const keep=[...rows.filter(pending),...rows.filter(e=>!pending(e)&&e.doneAt>now-EFFECT_RETENTION_MS).sort((x,y)=>y.doneAt-x.doneAt).slice(0,doneKept)];
  for(const e of keep)if(await tx.get(EFFECT_KEYS.row+e.id)===undefined)await store(tx,s,e,null);
 }
 if(b&&(b.added.length||b.rows.size)){
  const s=effectSummary(r);
  for(const e of b.added.splice(0)){await store(tx,s,e,null);wrote=true;}
  for(const [id,x] of b.rows){if(JSON.stringify(x.value)===x.before)continue;await store(tx,s,x.value,JSON.parse(x.before));x.before=JSON.stringify(x.value);wrote=true;}
  b.rows.clear();
 }
 if(wrote){
  const s=effectSummary(r);
  for(const [k] of await tx.list({prefix:EFFECT_KEYS.done,limit:16})){if(Number(k.slice(EFFECT_KEYS.done.length,EFFECT_KEYS.done.length+15))>now-EFFECT_RETENTION_MS)break;await remove(tx,s,k);}
  const excess=s.done-doneKept;if(excess>0)for(const [k] of await tx.list({prefix:EFFECT_KEYS.done,limit:excess}))await remove(tx,s,k);
 }
 return wrote;
}
/** Every effect row (pending and kept done ones, plus a legacy array not migrated yet), oldest first: tests, export and
 * diagnostics only (reads every row). */
export async function readOwnershipOutbox(metadata,record){
 const rows=[...(await metadata.list({prefix:EFFECT_KEYS.row})).values()];
 for(const e of legacy(record))if(!rows.some(x=>x.id===e?.id))rows.push(e);
 return rows.sort((a,b)=>(a.createdAt??0)-(b.createdAt??0));
}
