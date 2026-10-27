import {key} from '../core/records.mjs';

// Account-local storage effects of the lifecycle executor: irreversible hosted
// purge after the final grace period, and suspension-time cold tiering. Every
// batch is bounded, resumable from a durable cursor and fenced by a fresh
// lifecycle step (phase, paid protection, admin hold) before it touches data.
export const PURGE_KEY='lifecycle/purge-v1',COLD_KEY='lifecycle/cold-v1',TOMBSTONE_KEY='lifecycle/tombstone-v1';
const ARCHIVE_ROWS=2200,MAX_COLD_BYTES=16777216;

/** Only provider-owned hosted prefixes with exact owner evidence are removable.
 * External connector objects are never addressed by these references. */
// Wargame 4: oversized connector RPC results (`rpc-results/<owner>/…`, referenced by a journal's `resultRef`) are hosted too.
export function ownedBlobRef(owner,ref){return typeof ref==='string'&&ref.length<=1024&&(ref.startsWith(`messages/${owner}/`)||ref.startsWith(`objects/${owner}/`)||ref.startsWith(`rpc-results/${owner}/`))&&!ref.includes('..');}
function collectRefs(value,out,depth=0){
 if(depth>6||!value||typeof value!=='object')return out;
 if(typeof value.blobRef==='string')out.add(value.blobRef);
 if(typeof value.resultRef==='string'&&value.resultRef.startsWith('rpc-results/'))out.add(value.resultRef);
 for(const child of Array.isArray(value)?value:Object.values(value))if(child&&typeof child==='object')collectRefs(child,out,depth+1);
 return out;
}
function rowRefs(path,value){const refs=collectRefs(value,new Set());if(path.startsWith('blob-garbage/')&&typeof value==='string')refs.add(value);return refs;}
async function archiveEnvelope(c,owner){
 const object=await c.archives.get(`accounts/${owner}.json`);if(!object)return null;
 if(object.size>8388608)throw Object.assign(new Error('Account archive exceeds bounds'),{code:'lifecycle_archive_invalid'});
 const envelope=await object.json();if(envelope?.version!==1||envelope.owner!==owner||!Array.isArray(envelope.rows)||envelope.rows.length>ARCHIVE_ROWS)throw Object.assign(new Error('Account archive invalid'),{code:'lifecycle_archive_invalid'});
 return envelope;
}
async function archiveRows(c,owner){return (await archiveEnvelope(c,owner))?.rows??null;}
// Identifies the archive contents E7 handled, so E8's final re-check can tell a later shelving apart (R1-H2).
function archiveIdentity(envelope){if(!envelope)return null;if(typeof envelope.digest==='string')return envelope.digest;let a=0x811c9dc5;const text=JSON.stringify(envelope.rows);for(let i=0;i<text.length;i++)a=Math.imul(a^text.charCodeAt(i),16777619)>>>0;return `r${envelope.rows.length}-${text.length}-${a.toString(16)}`;}

/** Purge preconditions read outside the lifecycle transaction. External
 * connector resources keep their host-held mappings until a verified owner
 * reconstruction export exists (docs/release/account-lifecycle-executor-design.md),
 * so such accounts are held at purge review instead of being deleted. */
export async function externalResourcesPresent(c,owner){
 const external=row=>row&&row.kind!=='app-connection'&&row.provider!=='hosted';
 for(const value of (await c.metadata.list({prefix:'resource/'})).values())if(external(value))return true;
 if((await c.metadata.list({prefix:'drive/',limit:1})).size)return true;
 if(await c.metadata.get('shelved')){const rows=await archiveRows(c,owner);if(!rows)return true;if(rows.some(row=>Array.isArray(row)&&String(row[0]).startsWith('resource/')&&external(row[1])))return true;}
 return false;
}
export async function purgeEligibleInTransaction(tx){for(const value of (await tx.list({prefix:'resource/'})).values())if(value&&value.kind!=='app-connection'&&value.provider!=='hosted')return false;return !(await tx.list({prefix:'drive/',limit:1})).size;}

// Stage plans (account-deletion-export.md §2.3, §6). Stage names are append-only: a persisted job names its
// stage, and every plan is persisted with the job. Owner and admin deletion start at billing-stop; the inactivity
// purge keeps starting at identity. The erasure stages (grants, drain, operator-apps, email-bridge, exports) are
// common to both callers; only billing and the owner notice depend on the reason (R1-H3).
export const PURGE_PLANS=Object.freeze({
 deletion:Object.freeze(['billing-stop','identity','grants','drain','operator-apps','vectors','email-bridge','exports','archive','blobs','billing-anonymize','notice','metadata']),
 // PORT-2: the purge after a committed identity move's export window (identity-portability design §6.5). No
 // operator-app notification and no owner notice: a moved identity is not deleted, so nothing may tell apps to purge
 // it (spec §6.3, AR-9), and the move's own notices already went out. Stages run under the deletion stage names.
 moved:Object.freeze(['billing-stop','identity','grants','drain','vectors','email-bridge','exports','archive','blobs','billing-anonymize','metadata']),
 lifecycle:Object.freeze(['identity','grants','drain','operator-apps','vectors','email-bridge','exports','archive','blobs','metadata']),
 // A caller that injects no stage hooks (the pre-DX-3 lifecycle runner) keeps the original stages only.
 legacy:Object.freeze(['identity','vectors','archive','blobs','metadata']),
});
export const PURGE_REASONS=Object.freeze(['inactive','owner','admin','moved']);
// Injected hook per hook-driven stage. A hook is called as hook(owner, {reason, basis, state, log, budget}).
// It returns undefined/true/{done:true, ...evidence} to advance, {done:false, retryAt?|wakeAt?} to run again later,
// {held:true, reason} to hold, or throws (the caller holds with backoff). `state` is the stage's durable scratch
// object, saved with the job, so a hook can keep its own deadline or counters across batches.
const HOOKS=Object.freeze({'billing-stop':'billingStop',grants:'eraseGrants',drain:'drain','operator-apps':'notifyOperatorApps','email-bridge':'eraseEmailBridge',exports:'exportsCancel','billing-anonymize':'billingAnonymize',notice:'notice'});
const KNOWN_STAGES=new Set([...PURGE_PLANS.deletion,...PURGE_PLANS.lifecycle,...PURGE_PLANS.moved]);
const tombstoneReason=reason=>reason==='inactive'?'inactive-unpaid':reason;
function smallEvidence(value){try{const text=JSON.stringify(value??null);return text.length<=4096?JSON.parse(text):{truncated:true};}catch{return {unserializable:true};}}

/** Advances the irreversible purge by one bounded batch. `fence()` must re-check, before every destructive
 * stage, that the purge is still authorised: for the lifecycle, the account is still purging, unpaid and not
 * administratively held; for deletion, the request is still executing, there is no admin hold and the owner
 * still matches. `reason` is 'inactive' (default), 'owner' or 'admin'; `basis` is the deletion basis. `stages`
 * holds the injected hooks (HOOKS). Both callers pass the common erasure hooks; only owner and admin deletion
 * pass billingStop, billingAnonymize and notice. A hook-driven stage whose hook is missing holds
 * (`stage-unconfigured:<stage>`) rather than skipping erasure. `beforeWipe(owner)` runs right before the
 * account tombstone is written. Returns {done, stage, halted?, hold?, wakeAt?}. */
export async function purgeBatch(c,owner,{identity,fence,budget=64,log=()=>{},reason='inactive',basis=null,requestedAt=null,stages,beforeWipe,clock=Date.now}={}){
 if(!PURGE_REASONS.includes(reason))throw new TypeError('Invalid purge reason');
 const hooked=stages!==undefined&&stages!==null;if(reason!=='inactive'&&!hooked)throw new TypeError('Deletion requires stage hooks');
 let job=await c.metadata.get(PURGE_KEY);
 if(!job){const current=await identity.get(owner);job={version:1,owner,reason,basis,plan:[...PURGE_PLANS[reason==='inactive'?hooked?'lifecycle':'legacy':reason==='moved'?'moved':'deletion']],stage:null,assignmentId:current?.assignmentId,cursor:null,archiveIndex:0,archiveDigest:null,deleted:0,foreign:0,startedAt:clock(),hooks:{},evidence:{}};job.stage=job.plan[0];await c.metadata.put(PURGE_KEY,job);}
 if(job.version!==1||job.owner!==owner)throw Object.assign(new Error('Purge job requires review'),{code:'lifecycle_unavailable'});
 // A job written before stage plans existed is an inactivity purge on the legacy plan.
 if(!Array.isArray(job.plan)){job.reason='inactive';job.plan=[...PURGE_PLANS.legacy];job.hooks={};job.evidence={};}
 // One executor per job: a deletion never resumes an inactivity job or the reverse.
 if((job.reason??'inactive')!==reason)return {done:false,stage:job.stage,halted:true,hold:'purge-reason-mismatch'};
 // Upgrading a legacy inactivity job once hooks are injected: re-run from grants (every stage is idempotent).
 if(hooked&&job.plan.join()===PURGE_PLANS.legacy.join()){job.plan=[...PURGE_PLANS.lifecycle];if(job.stage!=='identity')job.stage='grants';await c.metadata.put(PURGE_KEY,job);}
 if(!job.plan.every(stage=>KNOWN_STAGES.has(stage))||!job.plan.includes(job.stage))throw Object.assign(new Error('Purge job requires review'),{code:'lifecycle_unavailable'});
 const save=async()=>c.metadata.put(PURGE_KEY,job);
 const advance=async()=>{job.stage=job.plan[job.plan.indexOf(job.stage)+1];await save();};
 let work=0;const remove=async ref=>{const final=job.stage==='blobs'&&job.blobsFinal===true;if(!ownedBlobRef(owner,ref)){if(!final)job.foreign++;return;}await c.blobs.delete(ref);if(final)job.rechecked=(job.rechecked??0)+1;else job.deleted++;work++;};
 for(let guard=0;guard<job.plan.length+2;guard++){
  const stage=job.stage;
  // A fresh fence before every destructive stage (§2.3).
  if(!await fence())return {done:false,stage,halted:true};
  if(Object.hasOwn(HOOKS,stage)){
   const hook=hooked?stages[HOOKS[stage]]:undefined;
   if(typeof hook!=='function')return {done:false,stage,halted:true,hold:`stage-unconfigured:${stage}`};
   const state=job.hooks[stage]??={};
   const result=await hook(owner,{reason,basis,state,log,budget});
   if(result&&typeof result==='object'&&result.held===true){await save();return {done:false,stage,halted:true,hold:typeof result.reason==='string'?result.reason:`${stage}-held`};}
   if(result&&typeof result==='object'&&result.done===false){await save();const wakeAt=result.retryAt??result.wakeAt;return {done:false,stage,...Number.isSafeInteger(wakeAt)?{wakeAt}:{}};}
   job.evidence[stage]=smallEvidence(result&&typeof result==='object'?result:{done:true});delete job.hooks[stage];
   log({action:'purge-stage',stage});await advance();continue;
  }
  if(stage==='identity'){
   // RTC review M1: end the account's live RTC sessions and deliver their control statements while its certification
   // keys are still served to peers (the tombstone stops rtcPublicKeys). Best effort, never blocking the tombstone:
   // peers also verify against the keys pinned on each session, and the E4 `drain` stage retries the outbox.
   try{await c.rtcDrain?.(owner);}catch{/* the drain stage retries */}
   // The connections vocabulary (apps/connections.mjs severAll) names owner deletion 'deleted'.
   // A moved identity's connections were severed at commit with the non-deletion vocabulary; repeat it, never 'deleted'.
   await c.connectionsSeverAccount?.(owner,{reason:reason==='inactive'?'lifecycle-tombstone':reason==='moved'?'system':'deleted'});
   // Authentication, sessions, recovery and the email claim end first; the handle stays reserved forever.
   if(!await identity.tombstone(owner,{assignmentId:job.assignmentId,...reason==='inactive'?{}:{reason:basis}}))throw Object.assign(new Error('Identity unavailable for tombstoning'),{code:'lifecycle_identity_unavailable'});
   log({action:'purge-identity-tombstoned'});await advance();continue;
  }
  if(stage==='vectors'){
   if((await c.metadata.list({prefix:key('search-vector-revision',owner),limit:1})).size){
    if(!await c.metadata.get('search-vector-purge'))await c.metadata.put('search-vector-purge',{owner});
    try{await c.configureSemanticSearch?.(owner);}catch{}
    // Rows that name vector IDs must outlive the vectors: without the index, hold instead of wiping them (R1-M10).
    if(!c.search?.vectorIndex||typeof c.purgeSearchVectors!=='function'){job.vectorIndexUnavailable=true;await save();return {done:false,stage,halted:true,hold:'vector-index-unavailable'};}
    await c.purgeSearchVectors(owner,{limit:20});if(await c.metadata.get('search-vector-purge'))return {done:false,stage};
   }
   await advance();continue;
  }
  if(stage==='archive'){
   const envelope=await c.metadata.get('shelved')?await archiveEnvelope(c,owner):null,rows=envelope?.rows??null;
   job.archiveDigest=archiveIdentity(envelope);
   if(rows){
    const refs=[...new Set(rows.flatMap(row=>Array.isArray(row)?[...rowRefs(String(row[0]),row[1])]:[]))];
    while(job.archiveIndex<refs.length&&work<budget){await remove(refs[job.archiveIndex]);job.archiveIndex++;}
    await save();if(job.archiveIndex<refs.length)return {done:false,stage};
   }
   await advance();continue;
  }
  if(stage==='blobs'){
   for(let pages=0;work<budget&&pages<16;pages++){
    const rows=await c.metadata.list({prefix:'',...job.cursor?{startAfter:job.cursor}:{},limit:32});
    for(const [path,value]of rows)for(const ref of rowRefs(path,value))await remove(ref);
    if(rows.size)job.cursor=[...rows.keys()].at(-1);await save();
    if(rows.size<32){
     // Defence in depth (wargame D1): one final pass from the beginning catches any blob-bearing row written behind
     // the cursor by an operation admitted before the fence. The fence re-checks make that a should-never-happen.
     // Its idempotent re-deletes are counted in `rechecked`, so the tombstone's deletedBlobs/foreign evidence is unchanged.
     if(job.blobsFinal!==true){job.blobsFinal=true;job.cursor=null;await save();continue;}
     // Final guard (R1-H2): rows shelved after E7 are not live, so E8 never saw them. Back to E7.
     const envelope=await c.metadata.get('shelved')?await archiveEnvelope(c,owner):null;
     if(archiveIdentity(envelope)!==job.archiveDigest){job.stage='archive';job.archiveIndex=0;job.blobsFinal=false;await save();log({action:'purge-archive-recheck'});return {done:false,stage:'archive'};}
     await advance();break;
    }
   }
   if(job.stage==='blobs')return {done:false,stage:job.stage};
   continue;
  }
  if(stage==='metadata'){
   if(typeof beforeWipe==='function'){const held=await beforeWipe(owner);if(held&&typeof held==='object'&&held.held===true)return {done:false,stage,halted:true,hold:typeof held.reason==='string'?held.reason:'before-wipe-held'};}
   await c.archives.delete(`accounts/${owner}.json`);
   // A rerun after a crash between the tombstone write and the wipe keeps the first tombstone.
   const prior=await c.metadata.get(TOMBSTONE_KEY);
   const tombstone=prior?.owner===owner?prior:{version:1,owner,deletedAt:clock(),reason:tombstoneReason(reason),...reason==='inactive'?{}:{basis,requestedAt},deletedBlobs:job.deleted,foreignReferences:job.foreign,vectorIndexUnavailable:job.vectorIndexUnavailable===true,counts:{subjectDeletedUndelivered:[...(await c.metadata.list({prefix:'integration-events/row/'})).values()].filter(r=>r.type==='subject-deleted').length+((await c.metadata.get('integration-events/meta'))?.subjectDeletedUndelivered??0)}};
   // The tombstone is written before the wipe and survives it, so a crash never leaves a rebuildable empty account.
   await c.metadata.put(TOMBSTONE_KEY,tombstone);
   if(typeof c.metadata.purgeAll==='function')await c.metadata.purgeAll({keep:['owner',TOMBSTONE_KEY]});
   // Sequenced, not concurrent (R1-M7): a crash between the two leaves an empty object, which the restore path
   // rebuilds from the identity tombstone; it can never leave a wiped object whose tombstone write raced ahead.
   else{await c.metadata.deleteAll();await c.metadata.put({owner,[TOMBSTONE_KEY]:tombstone});}
   log({action:'deleted',reason,deletedBlobs:job.deleted,foreignReferences:job.foreign});
   return {done:true,stage:'deleted'};
  }
  throw Object.assign(new Error('Purge job requires review'),{code:'lifecycle_unavailable'});
 }
 return {done:false,stage:job.stage};
}

/** Suspension-time cold tiering. The R2 Workers binding has no copy or
 * in-place class change; `put` accepts `storageClass`, so the closest supported
 * path rewrites identical bytes at the same key with `InfrequentAccess`, guarded
 * by `onlyIf.etagMatches`. Access is already denied by the lifecycle fence; the
 * tier only changes cost. Hosts without storage-class support (Node FileBucket)
 * report the job unsupported instead of simulating savings. */
export async function coldBatch(c,owner,{generation,blocked,minBytes=0,budget=16,supported=false}){
 let job=await c.metadata.get(COLD_KEY);
 if(!job||job.generation!==generation)return {done:true};
 if(!supported){job={...job,stage:'unsupported'};await c.metadata.put(COLD_KEY,job);return {done:true,unsupported:true};}
 if(job.stage==='done'||job.stage==='unsupported')return {done:true};
 let work=0;
 const tier=async ref=>{
  if(!ownedBlobRef(owner,ref)){job.skipped++;return true;}
  if(!await blocked())return false;work++;
  const object=await c.blobs.get(ref);if(!object||object.storageClass==='InfrequentAccess'||object.size<minBytes||object.size>MAX_COLD_BYTES){job.skipped++;return true;}
  const bytes=await object.arrayBuffer();
  const written=await c.blobs.put(ref,bytes,{storageClass:'InfrequentAccess',onlyIf:{etagMatches:object.etag},...object.httpMetadata?{httpMetadata:object.httpMetadata}:{},...object.customMetadata?{customMetadata:object.customMetadata}:{}});
  if(written)job.moved++;else job.skipped++;return true;
 };
 try{
  if(job.stage==='metadata'){
   for(let pages=0;work<budget&&pages<16;pages++){
    const rows=await c.metadata.list({prefix:'',...job.cursor?{startAfter:job.cursor}:{},limit:32});
    for(const [path,value]of rows){if(path.startsWith('blob-garbage/'))continue;for(const ref of collectRefs(value,new Set()))if(!await tier(ref))return {done:false,halted:true};}
    if(rows.size)job.cursor=[...rows.keys()].at(-1);await c.metadata.put(COLD_KEY,job);
    if(rows.size<32){job.stage='archive';job.archiveIndex=0;await c.metadata.put(COLD_KEY,job);break;}
   }
   if(job.stage==='metadata')return {done:false};
  }
  if(job.stage==='archive'){
   const rows=await c.metadata.get('shelved')?await archiveRows(c,owner):null,refs=rows?[...new Set(rows.flatMap(row=>Array.isArray(row)?[...collectRefs(row[1],new Set())]:[]))]:[];
   while(job.archiveIndex<refs.length&&work<budget){if(!await tier(refs[job.archiveIndex]))return {done:false,halted:true};job.archiveIndex++;}
   if(job.archiveIndex>=refs.length)job.stage='done';await c.metadata.put(COLD_KEY,job);
  }
 }catch(error){
  // Storage admission or provider failure pauses tiering; access stays fenced regardless.
  job.failures=(job.failures||0)+1;job.lastError=error?.code||'cold_storage_unavailable';await c.metadata.put(COLD_KEY,job);return {done:false,failed:true};
 }
 return {done:job.stage==='done'};
}
export const coldJob=generation=>({version:1,generation,stage:'metadata',cursor:null,archiveIndex:0,moved:0,skipped:0});
