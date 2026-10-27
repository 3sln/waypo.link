// D092 phase 1: policy projections only. This module has no blob or deletion port.
import {AppAction,AppQuery,ownerOf} from '../app/engine.mjs';
import {fault} from '../app/faults.mjs';
import {UUID,canonical} from '../core/primitives.mjs';
import {key} from '../core/records.mjs';
import {storageState} from './storage-quota.mjs';
import {OVER_QUOTA_EPISODE,OVER_QUOTA_NOTICE_MS,recordOverQuotaExportOffer} from './export-hooks.mjs';
import {assertBillingConfiguration,entitlementFromState,BILLING_PLANS} from '../billing/catalog.mjs';
import {BILLING_TRANSITION_PREFIX} from '../billing/service.mjs';
export const RETENTION_POLICY='D092-2026-10-23',RETENTION_LEDGER='retention/ledger-v1',RETENTION_WARNING='retention/warning-v1',CATALOG_PENDING_PREFIX='retention/catalog-pending/';
const MINUTE=60000,HOUR=3600000,DAY=86400000,int=n=>Number.isSafeInteger(n)&&n>=0,FREE_BYTES=BILLING_PLANS.free.storageBytes;
/** Review follow-up bounds (provisional, DEVLOG D092 review follow-ups). */
export const RETENTION_BOUNDS=Object.freeze({
 observedStepMs:DAY,          // L5: one clock reading advances the persisted observation by at most this much
 observedPersistMs:HOUR,      // L1: an observation-only advance is persisted at most hourly, without a revision bump
 activeWakeMs:6*HOUR,         // M3: an active episode re-evaluates at least this often (catch-up exceeds wake interval)
 pausedWakeMs:HOUR,           // M3: paused episodes and paused transition consumption retry hourly
 declinedRetryMs:DAY,         // L4: a configured port that answered not-configured is asked again after a day
 purchaseReleaseWindowMs:90*DAY, // M4: at most one purchase-based anchor release per window
 sustainedPaidMs:30*DAY,      // M4: continuous adequate paid entitlement that releases an anchor
 inventoryRowLimit:5000,      // L1: owner inventory rows scanned per request
 priorEpisodes:8,             // L7: replaced episodes kept as bounded evidence history
 billingPauseMs:72*HOUR,      // B1 (wargame 2026-10-23): a billing pause lasts at most this long, then the last authoritative state applies
 history:32,
});
const ACTIVE=['within-quota','grace','cleanup-eligible','paused-safety'],SENT=['accepted','delivered','bounced'];
const enabled=(r,owner)=>r.flags.for({subject:{kind:'account',owner}}).enabled('OVER_QUOTA_RETENTION_ENABLED');
const exportEnabled=(r,owner)=>r.flags.for({subject:{kind:'account',owner}}).enabled('ACCOUNT_EXPORT_ENABLED');
const disabled=()=>fault('not_found','Not found.',404);
async function bound(tx,owner){if(await tx.get('owner')!==owner)fault('forbidden','Account owner mismatch.',403);if(await tx.get('deletion/fence-v1')||await tx.get('lifecycle/purge-v1'))fault('account_deleting','Account deletion has begun.',410);}
async function* pages(tx,prefix){let startAfter;for(;;){const rows=await tx.list({prefix,...startAfter?{startAfter}:{},limit:200});for(const row of rows)yield row;if(rows.size<200)return;startAfter=[...rows.keys()].at(-1);}}
const safeBytes=n=>{if(!int(n))fault('retention_unavailable','Storage accounting requires review.',503);return n;};
/** L5/N6: a persisted high-water observation. One reading advances it at most one step, so a single far-future
 * reading cannot jump past the deadline. After downtime it catches up to the previous persisted reading `readAt`
 * once the current reading corroborates it (readAt <= now): two separate readings then agree time reached readAt.
 * The result never exceeds the current reading, so notices are never early and the cutoff never moves earlier. */
export const observe=(prev,now,readAt)=>{if(!int(prev))return now;if(now<=prev)return prev;let next=Math.min(now,prev+RETENTION_BOUNDS.observedStepMs);if(int(readAt)&&readAt<=now&&readAt>next)next=readAt;return next;};
const advanced=(next,prior,field)=>(next?.[field]??0)>=(prior?.[field]??0)+RETENTION_BOUNDS.observedPersistMs;
/** Owner metadata inventory, never a bucket listing. Units (hosted resources and inbox collections) come from their
 * own few records. N2: per-unit bytes come from a transactionally maintained totals port when one is wired (`unitBytes`), otherwise
 * from a row scan bounded by `rowLimit`. When neither can establish exact bytes, units stay listed with `bytes:null`
 * and byte fit is unknown, so an owner can still choose whole units by name. Unknown membership never yields bytes. */
export async function retentionInventory(tx,owner,{rowLimit=RETENTION_BOUNDS.inventoryRowLimit,unitBytes}={}){
 const units=new Map();let rows=0;const more=()=>++rows>rowLimit;
 for await(const [,r]of pages(tx,'resource/')){if(more())return {units:[],truncated:true,bytesKnown:false,source:'none'};if(r.owner===owner&&r.provider==='hosted')units.set('resource:'+r.id,{id:'resource:'+r.id,kind:'resource',resourceId:r.id,label:r.name??r.label??r.id,bytes:0,dependencies:[],membership:'whole-resource',restoration:'unknown-app-semantics'});}
 for await(const [,c]of pages(tx,key('collection',owner))){if(more())return {units:[],truncated:true,bytesKnown:false,source:'none'};units.set('collection:'+c.id,{id:'collection:'+c.id,kind:'collection',collectionId:c.id,label:c.name??c.id,bytes:0,dependencies:[],membership:'whole-collection'});}
 const list=()=>[...units.values()].sort((a,b)=>a.id.localeCompare(b.id)),unknown=reason=>{for(const u of units.values())u.bytes=null;return {units:list(),truncated:false,bytesKnown:false,source:reason};};
 let aggregate=null;if(typeof unitBytes==='function'){try{aggregate=await unitBytes(owner,tx);}catch{aggregate=null;}}
 if(aggregate){
  for(const [kind,map]of [['resource',aggregate.resources],['collection',aggregate.collections]])for(const [id,bytes]of Object.entries(map??{})){const u=units.get(kind+':'+id);if(!u||!int(bytes))return unknown('aggregate-membership');u.bytes=bytes;}
  return {units:list(),truncated:false,bytesKnown:true,source:'aggregate'};
 }
 for await(const [path,o]of pages(tx,'hosted/')){if(more())return unknown('row-limit');const u=units.get('resource:'+path.split('/')[1]);if(!u||!int(o?.size))return unknown('scan-membership');u.bytes+=o.size;}
 // Both item families: legacy messages and activity's v1 app messages (still placed in a collection until BB-CUT).
 for(const prefix of [key('message',owner),key('app-message',owner)])for await(const [,m]of pages(tx,prefix)){if(more())return unknown('row-limit');const u=units.get('collection:'+m.collection);if(m.owner!==owner||!u||!int(m.size))return unknown('scan-membership');u.bytes+=m.size;}
 for(const u of units.values())if(!int(u.bytes))return unknown('scan-overflow');
 return {units:list(),truncated:false,bytesKnown:true,source:'scan'};
}
const inventoryOptions=r=>({rowLimit:int(r.config.retentionInventoryRowLimit)?r.config.retentionInventoryRowLimit:RETENTION_BOUNDS.inventoryRowLimit,unitBytes:r.config.retentionUnitBytes});
function validTransition(t){return t&&int(t.revision)&&t.revision>0&&typeof t.causalEventId==='string'&&t.causalEventId.length>0&&int(t.effectiveAt)&&int(t.effectiveAt+OVER_QUOTA_NOTICE_MS)&&['lapse','downgrade','refund','catalog','upgrade-unpaid'].includes(t.reason)&&int(t.before?.storageBytes)&&int(t.after?.storageBytes)&&t.after.storageBytes<t.before.storageBytes&&['free','paid','plus','ultra'].includes(t.before.plan)&&['free','paid','plus','ultra'].includes(t.after.plan);}
function validEpisode(e,owner){return e.owner===owner&&e.policyVersion===RETENTION_POLICY&&UUID.test(e.id??'')&&int(e.revision)&&e.revision!==Number.MAX_SAFE_INTEGER&&int(e.effectiveAt)&&int(e.deadlineAt)&&e.deadlineAt>=e.effectiveAt+OVER_QUOTA_NOTICE_MS&&Array.isArray(e.noticeSchedule)&&e.noticeSchedule.length===3;}
function offer(e,r,owner,now){if(!e.exportOffered&&exportEnabled(r,owner))recordOverQuotaExportOffer(e,{owner,now});}
export const warningOf=e=>({v:1,episodeId:e.id,revision:e.revision,state:e.state,active:e.state!=='resolved',deadlineAt:e.deadlineAt,usageBytes:e.usageBytes,quotaBytes:e.quotaBytes,exportHref:e.exportOffered?.href??null,noticeSchedule:e.noticeSchedule,viewedAt:e.viewedAt??null,removalEnabled:false});
const semantic=e=>{if(!e)return null;const {observedAt,readAt,revision,...rest}=e;return canonical(rest);};
const ledgerSemantic=l=>{if(!l)return null;const {observedAt,readAt,...rest}=l;return canonical(rest);};
/** L1: writes only real changes. An observation-only advance is persisted at most hourly and never bumps the revision. */
async function commit(tx,e,loaded){
 if(!e)return false;const changed=semantic(e)!==semantic(loaded);
 if(!changed&&loaded&&!advanced(e,loaded,'observedAt')&&!advanced(e,loaded,'readAt'))return false;
 if(changed)e.revision++;
 await tx.put(OVER_QUOTA_EPISODE,e);const warning=warningOf(e);if(canonical(await tx.get(RETENTION_WARNING)??null)!==canonical(warning))await tx.put(RETENTION_WARNING,warning);return true;
}
function project(e,usage,now){
 e.usageBytes=usage.usedBytes;e.quotaBytes=usage.storageBytes;e.currentQuotaBytes=usage.storageBytes;delete e.pauseReason;
 // A persisted, step-capped high-water clock: rollback cannot revert eligibility, one future reading cannot grant it.
 e.observedAt=observe(e.observedAt,now,e.readAt);e.readAt=now;
 if(usage.usedBytes<=usage.storageBytes){e.state='resolved';e.resolutionReason=usage.plan!=='free'?'verified-entitlement':'usage-fits';}
 else {e.state=e.observedAt>=e.deadlineAt?'cleanup-eligible':'grace';delete e.resolutionReason;}
}
const pause=(e,reason)=>{e.state='paused-safety';e.pauseReason=reason;};
/** M1: the first notice is at creation (or a future catalog notice date); slots already past at creation are skipped, never fired together. */
function schedule(anchor,now){
 const first=Math.max(anchor.deadlineAt-OVER_QUOTA_NOTICE_MS,now);
 return [first,anchor.deadlineAt-7*DAY,anchor.deadlineAt-DAY].map((at,index)=>({id:String(index),at,attempts:[],...index>0&&at<now?{skipped:{at:now,reason:'past-at-creation'}}:{}}));
}
const summary=e=>({id:e.id,effectiveAt:e.effectiveAt,deadlineAt:e.deadlineAt,state:e.state,resolutionReason:e.resolutionReason??null,viewedAt:e.viewedAt??null,exportOfferedAt:e.exportOffered?.at??null,noticeSchedule:e.noticeSchedule,replacedAt:null});
/** M4 (provisional): release a funded anchor only for adequate verified entitlement; quick toggles stay bounded. */
function releaseAnchor(ledger,{usage,billing,now,e}){
 const a=ledger.anchor;if(!a)return null;
 // N1: only fitting achieved by actually reducing stored bytes (usage within the anchor's reduced quota) counts
 // toward reuse protection; a fit caused by an entitlement rise releases only as a window-bounded verified upgrade.
 const fits=usage.usedBytes<=usage.storageBytes,paid=fits&&usage.plan!=='free',reduced=fits&&int(a.afterBytes)&&usage.usedBytes<=a.afterBytes;
 const fitSince=int(a.fitSince)&&a.fitSince<=now?a.fitSince:reduced?now:null,paidSince=paid&&int(a.paidSince)&&a.paidSince<=now?a.paidSince:paid?now:null;
 const recentPurchase=int(ledger.lastPurchaseReleaseAt)&&ledger.lastPurchaseReleaseAt>now-RETENTION_BOUNDS.purchaseReleaseWindowMs;
 let release=null;
 // Never reuse a cutoff that passed while the account fitted its quota.
 if(fitSince!==null&&fitSince<=a.deadlineAt-7*DAY&&a.deadlineAt<=now)release='deadline-passed-fitting';
 else if(paid&&now-paidSince>=RETENTION_BOUNDS.sustainedPaidMs)release='sustained-paid';
 else if(paid&&int(a.afterBytes)&&usage.storageBytes>a.afterBytes&&int(billing?.billingRevision)&&billing.billingRevision>a.billingRevision&&!recentPurchase)release='verified-upgrade';
 if(!release){if(fitSince!==null&&reduced)a.fitSince=fitSince;else delete a.fitSince;if(paidSince!==null)a.paidSince=paidSince;else delete a.paidSince;return null;}
 if(release==='verified-upgrade')ledger.lastPurchaseReleaseAt=now;
 const {fitSince:_f,paidSince:_p,...kept}=a;ledger.history=[...ledger.history,{...kept,resolution:release,resolvedAt:now}].slice(-RETENTION_BOUNDS.history);ledger.anchor=null;
 if(e?.id===a.id){e.fundingReleased=true;e.releaseReason=release;}
 return release;
}
/** M3: whether an account has retention work. Accounts without it schedule no retention alarm. */
export async function retentionDue(tx){
 const e=await tx.get(OVER_QUOTA_EPISODE);if(e&&ACTIVE.includes(e.state))return true;
 const ledger=await tx.get(RETENTION_LEDGER);
 if((await tx.list({prefix:BILLING_TRANSITION_PREFIX,...ledger?.cursor?{startAfter:ledger.cursor}:{},limit:1})).size)return true;
 return (await tx.list({prefix:CATALOG_PENDING_PREFIX,limit:1})).size>0;
}
/** M3: next wake: a notice slot, a retry, the deadline or a bounded re-evaluation; null when nothing is pending. */
export async function retentionWake(tx,now,{paused=false,more=false,configured=false,corroborate=false}={}){
 const e=await tx.get(OVER_QUOTA_EPISODE),ledger=await tx.get(RETENTION_LEDGER);let wake=Infinity;const at=t=>{wake=Math.min(wake,Math.max(t,now+1000));};
 if(more)at(now+2000);if(corroborate)at(now+MINUTE);
 const backlog=(await tx.list({prefix:BILLING_TRANSITION_PREFIX,...ledger?.cursor?{startAfter:ledger.cursor}:{},limit:1})).size||(await tx.list({prefix:CATALOG_PENDING_PREFIX,limit:1})).size;
 if(backlog)at(now+(paused?RETENTION_BOUNDS.pausedWakeMs:2000));
 if(e&&ACTIVE.includes(e.state)){
  if(e.state==='paused-safety')at(now+RETENTION_BOUNDS.pausedWakeMs);
  else {
   // Deadline and slot times are judged on the step-capped observation: a lagging observation waits for the
   // bounded re-evaluation instead of spinning on a time that real clocks already passed.
   const observed=observe(e.observedAt,now),until=t=>now+Math.max(0,t-observed);
   // N6: a lagging observation catches up on the next corroborating reading, a minute later.
   if(int(e.readAt)&&int(e.observedAt)&&e.readAt>e.observedAt+RETENTION_BOUNDS.observedPersistMs)at(now+MINUTE);
   at(now+RETENTION_BOUNDS.activeWakeMs);if(e.state==='grace')at(until(e.deadlineAt));
   for(const n of e.noticeSchedule??[]){
    if(n.skipped)continue;const a=n.attempts?.at(-1),sent=(n.attempts??[]).filter(x=>x.result!=='not-configured').length;
    if(!a){at(until(n.at));continue;}
    if(SENT.includes(a.result)||a.acceptedAt!==undefined||a.deliveredAt!==undefined||a.bouncedAt!==undefined)continue;
    if(['pending','failed'].includes(a.result)&&sent<8)at(a.retryAt);
    else if(a.result==='not-configured'&&configured)at(a.port==='absent'?now:a.checkedAt+RETENTION_BOUNDS.declinedRetryMs);
   }
  }
 }
 return Number.isFinite(wake)?wake:null;
}
class RetentionAction extends AppAction {static deps=['accountStore','clock','random','flags','config'];static lifecycle='suspended';static termsGate='exempt';static changes='retention-changed';}
/** Bounded outbox consumer. Provider calls happen only after the account commit. */
export class ProduceRetention extends RetentionAction {
 static operation='retention.produce';
 async run(r){
  const owner=this.actor?.owner;if(this.actor?.kind!=='system'||!UUID.test(owner??''))fault('unauthorized','System retention authority is required.',401);
  if(!enabled(r,owner))return {enabled:false,removalEnabled:false};
  const result=await r.accountStore.transaction(async tx=>{
   await bound(tx,owner);const now=r.clock.now();if(!int(now))fault('retention_unavailable','Invalid retention clock.',503);
   const loaded=await tx.get(OVER_QUOTA_EPISODE),loadedLedger=await tx.get(RETENTION_LEDGER)??null,alerts=[];
   let e=loaded?structuredClone(loaded):undefined;const ledger=loadedLedger?structuredClone(loadedLedger):{v:1,cursor:'',history:[],anchor:null};
   if(e&&!validEpisode(e,owner))fault('retention_unavailable','Retention policy requires review.',503);
   // M1: the flag-adoption point. Transitions recorded before it are backfill: fresh notice, no deadline from history.
   if(!ledger.adoption){let through=ledger.cursor;if(!loadedLedger)for await(const [path]of pages(tx,BILLING_TRANSITION_PREFIX))through=path;ledger.adoption={at:now,policyVersion:RETENTION_POLICY,backfillThrough:through};}
   // N3: anchor release judges time on the ledger's own step-capped, corroborated observation.
   const observed=observe(ledger.observedAt,now,ledger.readAt),lagging=now>observed+RETENTION_BOUNDS.observedPersistMs;ledger.observedAt=observed;ledger.readAt=now;let deferred=false;
   const flush=async()=>{await commit(tx,e,loaded);if(deferred||ledgerSemantic(ledger)!==ledgerSemantic(loadedLedger)||advanced(ledger,loadedLedger,'observedAt')||advanced(ledger,loadedLedger,'readAt'))await tx.put(RETENTION_LEDGER,ledger);};
   let usage;try{usage=await storageState(tx,owner,now,r.config);}catch(error){if(!e)throw error;pause(e,'accounting');await flush();return {paused:true,episodeId:e.id,alerts};}
   const billing=await tx.get('billing/state'),sync=await tx.get('billing/sync');
   let billingSafe=true,projected,anchorBilling=billing;try{assertBillingConfiguration(r.config);projected=entitlementFromState(billing,now,r.config);if(billing?.owner!==owner||billing.source!=='polar'||billing.retentionAuthoritative!==true||!int(billing.billingRevision)||billing.plan!=='free'&&(projected.plan==='free'||projected.provisional)||sync?.checked===false&&sync.error&&sync.checkedAt>=billing.reconciledAt)billingSafe=false;}catch{billingSafe=false;}
   // B1: remember the last authoritative entitlement; a billing pause is bounded, after which the episode proceeds on it.
   if(billingSafe){const last={plan:projected.plan,storageBytes:projected.storageBytes,validUntil:projected.validUntil??null,billingRevision:billing.billingRevision};if(canonical(last)!==canonical(ledger.lastAuthoritative??null))ledger.lastAuthoritative=last;delete ledger.billingPausedSince;delete ledger.billingPauseBounded;}
   else {
    if(!int(ledger.billingPausedSince)||ledger.billingPausedSince>observed)ledger.billingPausedSince=observed;
    const last=ledger.lastAuthoritative,bounded=observed-ledger.billingPausedSince>=RETENTION_BOUNDS.billingPauseMs&&int(last?.storageBytes)&&['free','paid','plus','ultra'].includes(last.plan);
    if(!bounded){if(e)pause(e,'billing');await flush();return {paused:true,episodeId:e?.id,alerts};}
    const lapsed=last.plan!=='free'&&!(int(last.validUntil)&&last.validUntil>now);
    usage={...usage,plan:lapsed?'free':last.plan,storageBytes:lapsed?FREE_BYTES:last.storageBytes};anchorBilling={billingRevision:last.billingRevision};
    if(!ledger.billingPauseBounded)alerts.push({kind:'over-quota-retention',action:'operator-alert',reason:'billing-pause-bound',owner,pausedSince:ledger.billingPausedSince});
    ledger.billingPauseBounded=true;
   }
   const rows=await tx.list({prefix:BILLING_TRANSITION_PREFIX,...ledger.cursor?{startAfter:ledger.cursor}:{},limit:32});
   const catalogPending=await tx.list({prefix:CATALOG_PENDING_PREFIX,limit:32});
   // N3/N6: whether a funded anchor may be reused is decided on a corroborated observation; a reduction arriving
   // after a long gap waits one corroborating reading (a minute) instead of reusing a cutoff on a lagging clock.
   // The deferred run leaves the anchor's fit/paid trackers untouched.
   deferred=!!ledger.anchor&&lagging&&(rows.size+catalogPending.size)>0;
   if(!deferred)releaseAnchor(ledger,{usage,billing:anchorBilling,now:observed,e});
   for(const [path,t]of deferred?[]:[...rows,...catalogPending]){
    const fromBilling=path.startsWith(BILLING_TRANSITION_PREFIX),advance=async()=>{if(fromBilling)ledger.cursor=path;else await tx.delete(path);};
    if(!validTransition(t)){
     if(e){pause(e,'billing-transition');await flush();return {paused:true,episodeId:e.id,alerts};}
     // L6: without an episode a malformed row is skipped visibly instead of stalling the cursor.
     alerts.push({kind:'over-quota-retention',action:'operator-alert',reason:'malformed-transition',owner,path});
     ledger.history=[...ledger.history,{path,outcome:'malformed-skipped',at:now}].slice(-RETENTION_BOUNDS.history);await advance();continue;
    }
    // Catalog adoption requires an explicit operator notice date, never provider history.
    const noticeAt=t.reason==='catalog'?await tx.get('retention/catalog-notice/'+t.revision):undefined,backfill=fromBilling&&typeof ledger.adoption.backfillThrough==='string'&&ledger.adoption.backfillThrough!==''&&path<=ledger.adoption.backfillThrough;
    ledger.history=[...ledger.history,{billingRevision:t.revision,reason:t.reason,effectiveAt:t.effectiveAt,outcome:t.reason==='catalog'&&!int(noticeAt)?'catalog-notice-required':backfill?'backfill':'consumed'}].slice(-RETENTION_BOUNDS.history);
    if(usage.usedBytes>usage.storageBytes&&(t.reason!=='catalog'||int(noticeAt))){
     // M1: the notice window always starts no earlier than consumption; a backfill takes nothing from history.
     const start=t.reason==='catalog'?Math.max(noticeAt,now):backfill?now:Math.max(t.effectiveAt,now),effectiveAt=t.reason==='catalog'||backfill?start:t.effectiveAt;
     if(e?.state==='resolved'&&!ledger.anchor){ledger.episodes=[...(ledger.episodes??[]),{...summary(e),replacedAt:now}].slice(-RETENTION_BOUNDS.priorEpisodes);e=null;}
     if(!e){
      const anchor=ledger.anchor??{id:r.random.uuid(),effectiveAt,deadlineAt:start+OVER_QUOTA_NOTICE_MS,billingRevision:t.revision,afterBytes:t.after.storageBytes,paidPeriodStart:billing?.periodStart??null,...backfill?{backfill:true}:{}};ledger.anchor=anchor;
      e={v:1,id:anchor.id,owner,revision:0,policyVersion:RETENTION_POLICY,causalBillingRevision:anchor.billingRevision,causalEventId:t.causalEventId,effectiveAt:anchor.effectiveAt,deadlineAt:anchor.deadlineAt,observedAt:now,initialQuotaBytes:t.after.storageBytes,currentQuotaBytes:usage.storageBytes,quotaBytes:usage.storageBytes,initialUsageBytes:usage.usedBytes,usageBytes:usage.usedBytes,state:'within-quota',noticeSchedule:schedule(anchor,now),keepSelection:[],keepSelectionRevision:0,executionCursor:null,extension:null,...anchor.backfill?{backfill:true}:{}};
     }
     offer(e,r,owner,now);
    }
    await advance();
   }
   // A deferred run leaves a resolved episode alone: reuse of its anchor is decided on the next reading.
   if(e&&!(deferred&&e.state==='resolved')){offer(e,r,owner,now);project(e,usage,now);}
   await flush();return {enabled:true,episodeId:e?.id,observedAt:e?.observedAt,more:!deferred&&(rows.size===32||catalogPending.size===32),corroborate:deferred,alerts};
  });
  if(result.episodeId&&!result.paused)await this.notices(r,owner,result.episodeId,result.observedAt);
  const now=r.clock.now(),wakeAt=await r.accountStore.transaction(tx=>retentionWake(tx,now,{paused:!!result.paused,more:!!result.more,corroborate:!!result.corroborate,configured:typeof r.config.retentionNotice==='function'}));
  return {...result,enabled:true,wakeAt,removalEnabled:false};
 }
 async notices(r,owner,episodeId,observedAt){
  const configured=typeof r.config.retentionNotice==='function';
  for(let slot=0;slot<3;slot++){
   const pending=await r.accountStore.transaction(async tx=>{
    await bound(tx,owner);const e=await tx.get(OVER_QUOTA_EPISODE),now=r.clock.now();if(e?.id!==episodeId||!['grace','cleanup-eligible'].includes(e.state))return;
    // Due times use the step-capped observation too, so a far-future reading cannot fire or skip notices early.
    // N6: due times use this run's corroborated observation (never a reading this run itself persisted).
    const due=Math.min(now,int(observedAt)?observedAt:observe(e.observedAt,now)),n=e.noticeSchedule[slot];if(due<n.at||n.skipped)return;const save=async()=>{e.revision++;await tx.put(OVER_QUOTA_EPISODE,e);await tx.put(RETENTION_WARNING,warningOf(e));};
    // M1: a slot overtaken by a later due slot (downtime, late creation) is skipped, not fired together with it.
    if(!n.attempts.length&&e.noticeSchedule.slice(slot+1).some(m=>!m.skipped&&due>=m.at)){n.skipped={at:now,reason:'superseded'};await save();return;}
    let a=n.attempts.at(-1);
    if(a&&(SENT.includes(a.result)||a.acceptedAt!==undefined||a.deliveredAt!==undefined||a.bouncedAt!==undefined))return;
    // L4: not-configured is not terminal. An absent port is re-asked once configured; a declining port after a day.
    if(a?.result==='not-configured'){if(!configured||a.port!=='absent'&&now<a.checkedAt+RETENTION_BOUNDS.declinedRetryMs)return;a=null;}
    else if(a?.result==='pending'){if(a.retryAt>now)return;}
    else if(a&&a.retryAt>now||n.attempts.filter(x=>x.result!=='not-configured').length>=8)return;
    if(!configured){n.attempts.push({id:`${e.id}:${slot}:${n.attempts.length}`,result:'not-configured',port:'absent',checkedAt:now});await save();return;}
    if(a?.result!=='pending'){a={id:`${e.id}:${slot}:${n.attempts.length}`,attemptedAt:now,result:'pending',retryAt:now+MINUTE};n.attempts.push(a);}
    await save();return {id:a.id,scheduledAt:n.at,deadlineAt:e.deadlineAt,exportHref:e.exportOffered?.href??null};
   });
   if(!pending)continue;
   let outcome;try{outcome=await r.config.retentionNotice({owner,idempotencyKey:pending.id,episodeId,scheduledAt:pending.scheduledAt,deadlineAt:pending.deadlineAt,exportHref:pending.exportHref});}catch{outcome={result:'failed'};}
   await r.accountStore.transaction(async tx=>{
    await bound(tx,owner);const e=await tx.get(OVER_QUOTA_EPISODE);if(e?.id!==episodeId)return;const a=e.noticeSchedule[slot].attempts.find(a=>a.id===pending.id);if(!a||a.result!=='pending')return;
    const now=r.clock.now(),result=['not-configured',...SENT].includes(outcome?.result)?outcome.result:'failed';
    if(result==='not-configured'){Object.assign(a,{result,port:'declined',checkedAt:Math.max(now,a.attemptedAt)});delete a.retryAt;}
    else {a.result=result;a.completedAt=Math.max(now,a.attemptedAt);a.retryAt=a.completedAt+MINUTE;
     // L3: provider timestamps are bounded to [attemptedAt, completion].
     for(const field of ['acceptedAt','deliveredAt','bouncedAt','viewedAt'])if(SENT.includes(result)&&int(outcome?.[field])&&outcome[field]>=a.attemptedAt&&outcome[field]<=a.completedAt)a[field]=outcome[field];}
    e.revision++;await tx.put(OVER_QUOTA_EPISODE,e);const warning=await tx.get(RETENTION_WARNING);if(warning?.episodeId===e.id)await tx.put(RETENTION_WARNING,warningOf(e));
   });
  }
 }
}
/** Selection fit is enforced only when per-unit bytes reconcile exactly with logical accounting; otherwise it is
 * `unknown` and an executor (none exists in phase 1) must re-validate before acting. */
async function inventoryFit(tx,owner,r,usage,selection){
 const inv=await retentionInventory(tx,owner,inventoryOptions(r)),exact=inv.bytesKnown&&inv.units.reduce((n,u)=>n+u.bytes,0)===usage.usedBytes;
 const selected=inv.units.filter(u=>selection.includes(u.id)),missing=selected.length!==selection.length,bytes=exact?selected.reduce((n,u)=>safeBytes(n+u.bytes),0):null;
 // Bytes that do not reconcile are not shown as facts.
 const units=exact?inv.units:inv.units.map(u=>({...u,bytes:null}));
 return {...inv,units,exact,missing,bytes,fit:missing?'missing':!exact?'unknown':bytes>usage.storageBytes?'exceeds':'fits'};
}
export class RetentionStatus extends AppQuery {
 static operation='retention.status';static deps=['accountStore','clock','config','flags'];static lifecycle='suspended';static termsGate='exempt';static refreshOn=['retention-changed'];
 async fetch(r){const owner=ownerOf(this.actor);return r.accountStore.transaction(async tx=>{
  await bound(tx,owner);const episode=await tx.get(OVER_QUOTA_EPISODE);
  // M2: with the flag off, only a persisted episode stays readable.
  if(!episode&&!enabled(r,owner))disabled();if(episode&&episode.owner!==owner)fault('retention_unavailable','Retention owner requires review.',503);
  const usage=await storageState(tx,owner,r.clock.now(),r.config);
  // L1: the inventory is evaluated only while an episode needs a keep selection.
  const scan=!!episode&&episode.state!=='resolved',inv=scan?await inventoryFit(tx,owner,r,usage,episode.keepSelection??[]):{units:[],truncated:false,exact:false,source:'none',bytes:null,fit:'unknown'};
  return {keepSelectionBytes:inv.bytes,keepSelectionFit:scan?inv.fit:'unknown',keepSelectionInfeasible:scan&&['missing','exceeds'].includes(inv.fit),episode:episode??null,warning:await tx.get(RETENTION_WARNING)??null,units:inv.units,inventoryComplete:inv.exact,inventoryBytesKnown:inv.exact,inventorySource:inv.source,inventoryTruncated:inv.truncated,usageBytes:usage.usedBytes,quotaBytes:usage.storageBytes,reservedBytes:usage.reservedBytes,storageDebtBytes:Math.max(0,usage.usedBytes-usage.storageBytes),physicalRetainedBytes:null,removalEnabled:false};
 });}
}
export class SaveRetentionKeep extends RetentionAction {
 static operation='retention.keep';
 async run(r){const owner=ownerOf(this.actor),input=this.input;if(!enabled(r,owner))disabled();if(!input||Object.keys(input).some(k=>!['episodeId','revision','keepSelection'].includes(k))||!UUID.test(input.episodeId??'')||!int(input.revision)||!Array.isArray(input.keepSelection)||input.keepSelection.length>200||input.keepSelection.some(id=>typeof id!=='string')||new Set(input.keepSelection).size!==input.keepSelection.length)fault('invalid_keep_selection','Choose whole data units.',400);
  return r.accountStore.transaction(async tx=>{await bound(tx,owner);const e=await tx.get(OVER_QUOTA_EPISODE);if(!e||e.owner!==owner||e.id!==input.episodeId||e.keepSelectionRevision!==input.revision)fault('retention_conflict','The keep selection changed.',409);if(e.state==='resolved')fault('retention_resolved','This retention episode is resolved.',409);
   const usage=await storageState(tx,owner,r.clock.now(),r.config),inv=await inventoryFit(tx,owner,r,usage,input.keepSelection);
   // Remaining limit: more unit records than the row limit cannot be listed, so nothing can be validated.
   if(inv.truncated)fault('retention_inventory_too_large','The data inventory is too large to review here.',503);
   if(inv.fit==='missing')fault('invalid_keep_selection','A data unit no longer exists.',400);if(inv.fit==='exceeds')fault('keep_selection_too_large','The keep selection exceeds the current quota.',409);
   const selection=[...input.keepSelection].sort();if(canonical(selection)!==canonical(e.keepSelection)){e.keepSelection=selection;e.keepSelectionRevision++;e.revision++;await tx.put(OVER_QUOTA_EPISODE,e);const warning=await tx.get(RETENTION_WARNING);if(warning?.episodeId===e.id)await tx.put(RETENTION_WARNING,warningOf(e));}return {saved:true,keepSelection:e.keepSelection,keepSelectionRevision:e.keepSelectionRevision,bytes:inv.bytes,fit:inv.fit};});
 }
}
/** L2: stamps only an active warning, once. */
export class ViewRetentionWarning extends RetentionAction {static operation='retention.view';async run(r){const owner=ownerOf(this.actor);if(!enabled(r,owner))disabled();return r.accountStore.transaction(async tx=>{await bound(tx,owner);const e=await tx.get(OVER_QUOTA_EPISODE);if(!e)return {viewed:false};if(e.owner!==owner)fault('retention_unavailable','Retention owner requires review.',503);if(int(e.viewedAt))return {viewed:true};if(!ACTIVE.includes(e.state))return {viewed:false};e.viewedAt=r.clock.now();e.revision++;await tx.put(OVER_QUOTA_EPISODE,e);const warning=await tx.get(RETENTION_WARNING);if(warning?.episodeId===e.id)await tx.put(RETENTION_WARNING,warningOf(e));return {viewed:true};});}}
/** Provider evidence adapter: acceptance, delivery, bounce and viewing are independent facts of a sent notice. */
export class RecordRetentionNoticeResult extends RetentionAction {
 static operation='retention.notice-result';
 async run(r){const owner=this.actor?.owner,i=this.input;if(this.actor?.kind!=='system'||!UUID.test(owner??''))fault('unauthorized','Notice evidence authority is required.',401);if(!i||Object.keys(i).some(k=>!['episodeId','attemptId','result','at'].includes(k))||!UUID.test(i.episodeId??'')||typeof i.attemptId!=='string'||!['accepted','delivered','bounced','viewed'].includes(i.result)||!int(i.at)||i.at>r.clock.now())fault('invalid_notice_result','Provide verified notice evidence.',400);
  return r.accountStore.transaction(async tx=>{await bound(tx,owner);const e=await tx.get(OVER_QUOTA_EPISODE);if(e?.owner!==owner||e.id!==i.episodeId)fault('retention_conflict','The retention episode changed.',409);const a=e.noticeSchedule.flatMap(n=>n.attempts).find(a=>a.id===i.attemptId);
   // L3: evidence attaches only to an attempt the port accepted; never to not-configured, failed or pending.
   if(!a||!SENT.includes(a.result)||!int(a.attemptedAt)||i.at<a.attemptedAt)fault('invalid_notice_result','Choose a sent notice attempt.',400);const field={accepted:'acceptedAt',delivered:'deliveredAt',bounced:'bouncedAt',viewed:'viewedAt'}[i.result];if(a[field]===undefined){a[field]=i.at;e.revision++;await tx.put(OVER_QUOTA_EPISODE,e);const warning=await tx.get(RETENTION_WARNING);if(warning?.episodeId===e.id)await tx.put(RETENTION_WARNING,warningOf(e));}return {recorded:true};});
 }
}
/** Explicit operator policy input, kept separate from billing's immutable outbox. */
export class SetCatalogRetentionNotice extends RetentionAction {
 static operation='retention.catalog-notice';
 async run(r){const owner=this.actor?.owner,input=this.input;if(this.actor?.kind!=='system'||!UUID.test(owner??''))fault('unauthorized','Operator system authority is required.',401);if(!enabled(r,owner))disabled();if(!input||Object.keys(input).some(k=>!['billingRevision','noticeAt'].includes(k))||!int(input.billingRevision)||!int(input.noticeAt)||input.noticeAt<r.clock.now()||!int(input.noticeAt+OVER_QUOTA_NOTICE_MS))fault('invalid_notice_date','Choose an explicit future catalog notice date.',400);
  return r.accountStore.transaction(async tx=>{await bound(tx,owner);const transition=await tx.get(BILLING_TRANSITION_PREFIX+String(input.billingRevision).padStart(16,'0'));if(!validTransition(transition)||transition.reason!=='catalog')fault('invalid_notice_date','Choose a catalog reduction.',400);const path='retention/catalog-notice/'+input.billingRevision,prior=await tx.get(path);if(prior!==undefined){if(prior!==input.noticeAt)fault('retention_conflict','This catalog notice date is already fixed.',409);return {noticeAt:prior};}await tx.put(path,input.noticeAt);await tx.put(CATALOG_PENDING_PREFIX+input.billingRevision,transition);return {noticeAt:input.noticeAt};});
 }
}
export const RETENTION_OPERATIONS=[ProduceRetention,RetentionStatus,SaveRetentionKeep,ViewRetentionWarning,SetCatalogRetentionNotice,RecordRetentionNoticeResult];
