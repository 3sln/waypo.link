// DX-9 / D092 phase 1. The retention owner persists this account-local episode
// after a verified effective downgrade. These hooks never infer one from Free,
// a pending cancellation or a failed billing reconciliation, and never remove data.
import {AppAction,AppQuery} from '../app/engine.mjs';
import {fault} from '../app/faults.mjs';
import {UUID,canonical} from '../core/primitives.mjs';
import {CreateExport} from '../app/domains/account-export.mjs';
import {AccountExport} from './export-generation.mjs';
export const OVER_QUOTA_EPISODE='retention/episode-v1',OVER_QUOTA_NOTICE_MS=30*86400000;
const int=n=>Number.isSafeInteger(n)&&n>=0;
const unavailable=()=>fault('retention_unavailable','The retention episode requires review.',503);
const scope=(flags,owner)=>flags.for({subject:{kind:'account',owner}});
async function bound(tx,owner){if(await tx.get('owner')!==owner)fault('forbidden','Account owner mismatch.',403);if(await tx.get('deletion/fence-v1')||await tx.get('lifecycle/purge-v1'))fault('account_deleting','Account deletion has begun.',410);}
/** Shared transaction contract for D092 and exports.create. No callback performs
 * network IO inside this transaction. The episode id is an opaque UUID; a new
 * revision, notice retry, restart or cancelled export cannot replenish allowance. */
export async function overQuotaEpisode(tx,owner,id,now){
 await bound(tx,owner);const episode=await tx.get(OVER_QUOTA_EPISODE);
 if(!UUID.test(id??'')||!episode||episode.id!==id||episode.owner!==owner)fault('export_episode_unavailable','No matching over-quota grace episode exists.',409);
 if(episode.v!==1||(!int(episode.revision)||episode.revision===Number.MAX_SAFE_INTEGER)||!int(episode.effectiveAt)||episode.effectiveAt>now||!int(episode.deadlineAt)||episode.deadlineAt<episode.effectiveAt+OVER_QUOTA_NOTICE_MS||!int(episode.quotaBytes)||!int(episode.usageBytes))unavailable();
 if(episode.state!=='grace'||episode.usageBytes<=episode.quotaBytes)fault('export_episode_unavailable','The over-quota episode is not in grace.',409);
 return episode;
}
/** Called by export creation inside its own account transaction. Recording the
 * job and consuming the episode allowance must commit together. */
export async function claimOverQuotaExport(tx,{owner,episodeId,jobId,now}){
 const episode=await overQuotaEpisode(tx,owner,episodeId,now);
 if(!episode.exportOffered||!int(episode.exportOffered.at)||episode.exportOffered.at>now||episode.deadlineAt<episode.exportOffered.at+OVER_QUOTA_NOTICE_MS)fault('export_not_offered','An export must be offered before using this allowance.',409);
 if(episode.exportOffered.jobId)fault('export_episode_used','This episode already used its export allowance.',429);
 if(!UUID.test(jobId??''))throw new TypeError('An export job ID is required.');
 episode.exportOffered={...episode.exportOffered,jobId};episode.revision++;await tx.put(OVER_QUOTA_EPISODE,episode);return episode;
}
class HookAction extends AppAction {static deps=['accountStore','clock','flags'];static lifecycle='suspended';static termsGate='exempt';static changes='retention-changed';}
const authority=(actor,kinds)=>{if(!kinds.includes(actor?.kind)||!UUID.test(actor?.owner??''))fault('unauthorized','Retention authority is required.',401);return actor.owner;};
export class OfferOverQuotaExport extends HookAction {
 static operation='exports.offer-over-quota';
 async run({accountStore,clock,flags}){
  const owner=authority(this.actor,['system']),input=this.input;
  if(!input||Object.keys(input).some(k=>!['episodeId','expectedRevision'].includes(k))||!UUID.test(input.episodeId??'')||!int(input.expectedRevision))fault('invalid_export','Choose a retention episode and revision.',400);
  return accountStore.transaction(async tx=>{
   const now=clock.now(),episode=await overQuotaEpisode(tx,owner,input.episodeId,now);
   if(!scope(flags,owner).enabled('ACCOUNT_EXPORT_ENABLED'))fault('not_found','Not found.',404);
   // Lost replies preserve the first offer and deadline, including after a job
   // consumes it. This is in-app availability evidence, NOT notice delivery.
   if(episode.exportOffered){if(!int(episode.exportOffered.at)||episode.exportOffered.at>now||episode.deadlineAt<episode.exportOffered.at+OVER_QUOTA_NOTICE_MS)unavailable();return structuredClone(episode.exportOffered);}
   if(!int(now+OVER_QUOTA_NOTICE_MS))unavailable();
   if(episode.revision!==input.expectedRevision)fault('retention_conflict','The retention episode changed.',409);
   episode.exportOffered={at:now,href:`/console?account=${owner}&view=account-data`};episode.deadlineAt=Math.max(episode.deadlineAt,now+OVER_QUOTA_NOTICE_MS);episode.revision++;
   await tx.put(OVER_QUOTA_EPISODE,episode);return structuredClone(episode.exportOffered);
  });
 }
}
export class OverQuotaExportEvidence extends AppQuery {
 static operation='exports.over-quota-evidence';static deps=['accountStore','clock'];static lifecycle='suspended';static termsGate='exempt';static refreshOn=['retention-changed','exports-changed'];
 async fetch({accountStore,clock}){
  const owner=authority(this.actor,['owner','system']);
  return accountStore.transaction(async tx=>{await bound(tx,owner);const episode=await tx.get(OVER_QUOTA_EPISODE);if(!episode)return {episode:null,removalEnabled:false};if(episode.owner!==owner)unavailable();return {episode:structuredClone(episode),removalEnabled:false,offerWindowElapsed:int(episode.exportOffered?.at)&&clock.now()>=Math.max(episode.deadlineAt,episode.exportOffered.at+OVER_QUOTA_NOTICE_MS)};});
 }
}
// Coordinator integration: import this class as CreateExport in account/exports
// and replace the exports.create registry entry. It keeps the DX-1 generation,
// download, cleanup and security ports; only creation gains episode admission.
// Creation is kept here to respect DX-9's exclusive file ownership. Until that
// import is applied, the existing HTTP operation remains owner-purpose only.
export class CreateExportWithHooks extends CreateExport {
 async run(r){
  const owner=authority(this.actor,['owner']),input=this.input,s=new AccountExport({...r,...r.config.exportPorts}),now=r.clock.now();
  try{if(typeof s.issuer!=='string'||new URL(s.issuer).origin!==s.issuer)unavailable();}catch{unavailable();}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operationId','purpose','episodeId'].includes(k))||!UUID.test(input.operationId??'')||!['owner','over-quota'].includes(input.purpose??'owner')||(input.purpose==='over-quota'?!UUID.test(input.episodeId??''):input.episodeId!==undefined))fault('invalid_export','Provide an export operation ID and purpose.',400);
  const actor=this.actor;if(!int(actor.stepUpAt)||actor.stepUpAt>now||now-actor.stepUpAt>=300000||actor.stepUpMethod!==undefined&&!['password','passkey'].includes(actor.stepUpMethod))fault('step_up_required','Verify your password or passkey again.',401);
  const purpose=input.purpose??'owner',fingerprint=canonical({purpose,...purpose==='over-quota'?{episodeId:input.episodeId}:{}}),security=await s.security(owner),id=r.random.uuid();
  const job=await r.accountStore.transaction(async tx=>{
   await s.fence(tx,owner);const history=await tx.get('export/history')??[],receipt=history.find(h=>h.operationId===input.operationId);
   if(receipt){if(receipt.fingerprint!==fingerprint)fault('export_operation_conflict','This operation ID was already used.',409);return s.get(tx,owner,receipt.id);}
   if(!scope(r.flags,owner).enabled('ACCOUNT_EXPORT_ENABLED'))fault('not_found','Not found.',404);
   if(await tx.get('export/active'))fault('export_active','An export is already active.',409);
   if(purpose==='over-quota')await claimOverQuotaExport(tx,{owner,episodeId:input.episodeId,jobId:id,now});
   else if(history.filter(h=>h.purpose!=='over-quota'&&h.createdAt>now-7*86400000).length>=2)fault('export_rate_limited','Two exports are available per seven days.',429);
   const job={v:1,id,owner,purpose,...purpose==='over-quota'?{episodeId:input.episodeId}:{},operationId:input.operationId,fingerprint,createdAt:now,notBefore:security.changedAt?Math.max(now,security.changedAt+3*86400000):now,securityEpoch:security.epoch,state:'queued',revision:0,contributor:0,cursor:null,parts:[],buffers:{},sequences:{},payloads:{count:0,bytes:0},counts:{},payloadEntries:[],keys:[],downloadedBytes:0,sessionsSeen:[],noticePending:true};
   const receipts=[...history,{id,operationId:input.operationId,fingerprint,createdAt:now,purpose}],kept=[];
   for(const [i,old]of receipts.entries()){if(i>=receipts.length-32){kept.push(old);continue;}const prior=await tx.get('export/job/'+old.id);if(prior&&(!['cancelled','expired','failed'].includes(prior.state)||prior.cleanupPending))kept.push(old);else await tx.delete('export/job/'+old.id);}
   await tx.put('export/job/'+id,job);await tx.put('export/active',id);await tx.put('export/history',kept);return job;
  });
  if(job.noticePending)await s.deliverNotice(job,'export-created');return s.status(owner,job.id);
 }
}
export const EXPORT_HOOK_OPERATIONS=[CreateExportWithHooks,OfferOverQuotaExport,OverQuotaExportEvidence];
