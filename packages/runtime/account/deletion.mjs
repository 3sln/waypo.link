import {flagsFor,capability} from './flags.mjs';
// AccountController slice DX-3, account deletion (docs/architecture/account-deletion-export.md §2, §8.2; carve-out from
// FF-5b's account/** glob, R1-M11). `methods` are installed on AccountController.prototype (`this` is the controller);
// `rpc` lists what `invoke` accepts (packages/runtime/account/index.mjs, coordinator registration).
//
// Entry points:
//   deletionRequest(owner, input, {stepUpAt, sessionId})  owner; the trusted route passes step-up evidence from
//       IdentityService.privileged(context, 300000), never the request body.
//   deletionStatus(owner), deletionCancel(owner)          owner (cancel needs no step-up: it is the safe direction)
//   deletionCancelToken(owner, {token})                   cancel-only link page (POST), no session
//   deletionTick(owner, {source})                         the LifecycleScheduler sweep over the deletion-due index
//   deletionSchedule(owner, input), deletionSystemCancel, deletionSystemStatus   DX-7 admin port (system actor)
//   deletionAlarm()                                       internal (no rpc): the account alarm calls it first
//   deletionPortsFor(c)                                   DeletionPorts for this controller (also the lifecycle purge)
//   deletionMaintenanceRefused()                          internal: shelving and semantic backfill refuse while true
// Ports come from `config.ACCOUNT_DELETION_PORTS` (DeletionPorts, packages/runtime/account-deletion.mjs), wired by the
// Worker and Node adapters. Without them every new request refuses and every execution step holds.
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {DeletionService,deletionBlocksMaintenance,REQUEST_KEY,FENCE_KEY} from '../account-deletion.mjs';
import {PURGE_KEY,TOMBSTONE_KEY} from '../lifecycle-storage.mjs';
import {RequestAccountDeletion,AccountDeletionStatus,CancelAccountDeletion,CancelAccountDeletionByToken,StepAccountDeletion,ScheduleAdminDeletion} from '../../app/domains/account-deletion.mjs';
import {lifecycleLog} from '../lifecycle-runner.mjs';
import {AccountExport} from '../export-generation.mjs';
import {BillingClosure} from '../../billing/closure.mjs';

const engines=new WeakMap(),local=new WeakMap();
const clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
/** DeletionPorts for this controller: the adapter's shared `ACCOUNT_DELETION_PORTS`, plus the two account-local
 * ports built over this controller unless the adapter set them explicitly. E6 uses DX-1's
 * AccountExport.cancelAll (its write intents, never a parts-only fallback); E1/E9 and the request-time
 * cancel-at-period-end use DX-4's BillingClosure, `null` when billing is not enabled. Its operator alert has no
 * dedicated transport yet and goes to the structured operator log (never email, endpoints or tokens). */
export function deletionPortsFor(c){
 const configured=c.config.ACCOUNT_DELETION_PORTS;if(!configured||typeof configured!=='object')return configured;
 let own=local.get(c);
 if(!own){
  const clock={now:()=>clockOf(c)()},flags={for:ctx=>flagsFor(c.config,ctx)};let exporter;
  const exportPort={cancelAll:(owner,options)=>(exporter??=new AccountExport({accountStore:c.metadata,archives:c.exportArchives??c.archives,blobs:c.blobs,clock,random:cryptoRandom,flags,config:c.config,...c.config.exportPorts})).cancelAll(owner,options)};
  const billing=capability(c.config,'BILLING_ENABLED')&&c.billing?new BillingClosure({billing:c.billing,metadata:c.metadata,clock,flags,alert:async entry=>lifecycleLog(c.config,{kind:'account-deletion',action:'operator-alert',...entry})}):null;
  own={exports:exportPort,billing};local.set(c,own);
 }
 return {...configured,...configured.exports===undefined?{exports:own.exports}:{},...configured.billing===undefined?{billing:own.billing}:{}};
}
/** The controller's deletion service and engine (one per controller). Flags and ports are read per call. */
export function deletionEngine(c){
 let entry=engines.get(c);
 if(!entry){
  const clock={now:()=>clockOf(c)()};
  const service=new DeletionService({executor:c,ports:()=>deletionPortsFor(c),flags:{for:ctx=>flagsFor(c.config,ctx)},clock,random:cryptoRandom,
   log:event=>lifecycleLog(c.config,{kind:'account-deletion',...event}),wake:time=>typeof c.scheduleAlarm==='function'?c.scheduleAlarm(time):undefined,
   budget:Number.isSafeInteger(c.config.ACCOUNT_DELETION_BATCH)&&c.config.ACCOUNT_DELETION_BATCH>0&&c.config.ACCOUNT_DELETION_BATCH<=512?c.config.ACCOUNT_DELETION_BATCH:64});
  entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,lifecycle:service}})};
  engines.set(c,entry);
 }
 return entry;
}
const ownerActor=(owner,evidence)=>({kind:'owner',owner,...Number.isSafeInteger(evidence?.stepUpAt)?{stepUpAt:evidence.stepUpAt}:{},...typeof evidence?.sessionId==='string'?{sessionId:evidence.sessionId}:{}});

export const methods={
 async deletionRequest(owner,input,evidence){return perform(deletionEngine(this).engine,new RequestAccountDeletion({actor:ownerActor(owner,evidence),input}));},
 async deletionStatus(owner){return read(deletionEngine(this).engine,new AccountDeletionStatus({actor:{kind:'owner',owner}}));},
 async deletionCancel(owner){return perform(deletionEngine(this).engine,new CancelAccountDeletion({actor:{kind:'owner',owner}}));},
 async deletionCancelToken(owner,input){return perform(deletionEngine(this).engine,new CancelAccountDeletionByToken({actor:{kind:'cancel-link',owner},input}));},
 async deletionTick(owner,{source='sweep'}={}){return perform(deletionEngine(this).engine,new StepAccountDeletion({actor:{kind:'system',owner,reason:source}}));},
 async deletionSchedule(owner,input){return perform(deletionEngine(this).engine,new ScheduleAdminDeletion({actor:{kind:'system',owner,reason:'admin'},input}));},
 async deletionSystemCancel(owner,{reason='admin'}={}){return perform(deletionEngine(this).engine,new CancelAccountDeletion({actor:{kind:'system',owner,reason}}));},
 async deletionSystemStatus(owner){return read(deletionEngine(this).engine,new AccountDeletionStatus({actor:{kind:'system',owner}}));},
 /** Account alarm hook (§2.2, R1-H2). Runs one deletion step when a request exists, before `lifecycleTick`, and
  * reports whether the alarm must return right after it (`stop`: a fence, a purge job or a tombstone exists) and
  * the deletion wake time for the alarm's `finally` min-merge. Never throws. */
 async deletionAlarm(){
  let result=null;
  try{const owner=await this.metadata.get('owner');if(owner&&await this.metadata.get(REQUEST_KEY)!==undefined)result=await perform(deletionEngine(this).engine,new StepAccountDeletion({actor:{kind:'system',owner,reason:'alarm'}}));}
  catch(error){lifecycleLog(this.config,{kind:'account-deletion',action:'alarm-error',code:error?.code||'unavailable'});result={action:'error',wakeAt:clockOf(this)()+3600000};}
  // Stop for a deletion fence, or a tombstone with no unfinished inactivity purge. A running inactivity purge is
  // left to lifecycleTick, after which the alarm stops on `alarmFenced` (R1-H2).
  let stop=true;try{stop=await this.metadata.get(FENCE_KEY)!==undefined||await this.metadata.get(TOMBSTONE_KEY)!==undefined&&!(await this.metadata.get(PURGE_KEY).then(job=>job&&(job.reason??'inactive')==='inactive'));}catch{stop=true;}
  return {stop,wakeAt:Number.isSafeInteger(result?.wakeAt)?result.wakeAt:null,action:result?.action??'none'};
 },
 async deletionMaintenanceRefused(){try{return await deletionBlocksMaintenance(this.metadata);}catch{return true;}},
};
export const rpc={
 deletionRequest:{lifecycle:'suspended'},
 deletionStatus:{lifecycle:'suspended'},
 deletionCancel:{lifecycle:'purging'},
 deletionCancelToken:{lifecycle:'purging'},
 deletionTick:{lifecycle:'purging'},
 // DX-7 admin port (packages/runtime/admin-deletion-ports.mjs); edge code only, never a client-selected method.
 deletionSchedule:{lifecycle:'suspended'},
 deletionSystemCancel:{lifecycle:'purging'},
 deletionSystemStatus:{lifecycle:'purging'},
};
