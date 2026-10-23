// AccountController slice PORT-2, identity transfer-out (docs/architecture/identity-portability.md §6; engine in
// packages/identity/transfer-out.mjs). `methods` are installed on AccountController.prototype (`this` is the
// controller); `rpc` lists what `invoke` accepts (packages/runtime/account/index.mjs).
//
// Entry points (actors are built here from trusted adapter evidence, never from a request body):
//   transferOutBegin(owner, input, evidence)           owner; evidence {stepUpAt, sessionId, sessionCreatedAt, credentialId?, credentialCreatedAt?}
//   transferOutAuthorize(owner, input, evidence)       owner, path (a)
//   transferOutAuthorizeWaiting(owner, input)          credential (no session), path (b)
//   transferOutStatement(owner, input)                 the move endpoint (system)
//   transferOutCancel(owner, input, evidence)          owner session (evidence.kind 'owner') or recovery credential ('credential')
//   transferOutDispute(owner, input, evidence)         notice link ('dispute-link') or known owner device ('owner')
//   transferOutElevate / transferOutRestartChoice      owner with a fresh step-up
//   transferOutSupport(owner, input)                   support decision (system; admin adapter only)
//   transferOutTick(owner, {source}), transferOutStatus(owner)
//   transferOutAlarm()                                 internal (no rpc): the account alarm calls it after deletion
// Ports come from `config.TRANSFER_OUT_PORTS` (identity, notices, attestor, due, issuer; packages/identity/transfer-out.mjs),
// wired by the Worker and Node adapters. Keys, delegation, connection, grant and purge effects are built over this
// controller. Without the configured ports every new transfer refuses and every step holds.
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {flagsFor} from './flags.mjs';
import {TransferOutService,TRANSFER_KEY,BeginTransferOut,AuthorizeTransferOut,AuthorizeWaitingTransferOut,ReceiveMoveStatement,CancelTransferOut,DisputeTransferOut,ElevateTransferOut,SupportTransferOut,TransferRestartChoice,StepTransferOut,TransferOutStatus} from '../../identity/transfer-out.mjs';
import {deletionPortsFor} from './deletion.mjs';
import {erasureStages} from '../account-deletion.mjs';
import {purgeBatch} from '../lifecycle-storage.mjs';
import {lifecycleLog} from '../lifecycle-runner.mjs';

const engines=new WeakMap();
const clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
const enc=encodeURIComponent;

/** Private key custody ends at commit (spec §6.3): the sealed current keys, retained encryption keys and the recovery
 * binding are deleted; the public records stay published so recorded artefacts keep verifying. */
async function destroyCustody(c,owner){
 await c.metadata.transaction(async tx=>{
  if(await tx.get('owner')!==owner)throw Object.assign(new Error('Account owner mismatch.'),{code:'forbidden'});
  for(const name of ['signing-key','encryption-key'])if((await tx.get(name))!==undefined)await tx.delete(name);
  for(const path of (await tx.list({prefix:`identity-key-retained/${enc(owner)}/`})).keys())await tx.delete(path);
  if((await tx.get(`identity-key-recovery/${enc(owner)}/`))!==undefined)await tx.delete(`identity-key-recovery/${enc(owner)}/`);
  await tx.put('transfer-out/custody-ended-v1',{owner,at:clockOf(c)()});
 });
}
/** The moved purge (design §6.5 item 2): the shared executor with reason `moved`, the common erasure stages and the
 * billing stages, fenced on the committed record, the owner binding, an admin hold and the env kill switch. */
async function movedPurge(c,owner,service){
 const ports=deletionPortsFor(c);if(!ports||typeof ports!=='object'||!ports.identity)return {done:false,halted:true,hold:'deletion-ports-unconfigured'};
 const record=await c.metadata.get(TRANSFER_KEY),clock=clockOf(c),log=event=>lifecycleLog(c.config,{kind:'transfer-out',owner,...event});
 const billing=ports.billing,billingStage=method=>async()=>{if(billing===null)return {done:true,billing:'absent'};if(typeof billing?.[method]!=='function')return {held:true,reason:'billing-unconfigured'};try{return {done:true,evidence:await billing[method](owner)};}catch(error){return {held:true,reason:`billing-${typeof error?.code==='string'?error.code:'unavailable'}`};}};
 const fence=async()=>{
  const live=await c.metadata.get(TRANSFER_KEY);if(live?.state!=='committed'||live.id!==record?.id||await c.metadata.get('owner')!==owner)return false;
  try{if((await ports.hold?.(owner))?.held!==false)return false;}catch{return false;}
  return service.flags.for({subject:{kind:'account',owner}}).background('IDENTITY_TRANSFER_OUT_ENABLED')===true;
 };
 return purgeBatch(c,owner,{identity:ports.identity,fence,budget:64,log,reason:'moved',basis:'moved',requestedAt:record?.committedAt??null,clock,
  stages:{...erasureStages(c,{ports,clock,log}),billingStop:billingStage('revokeAll'),billingAnonymize:billingStage('anonymize')}});
}
/** TransferOutPorts for this controller: the adapter's shared `TRANSFER_OUT_PORTS` plus account-local keys and effects. */
export function transferPortsFor(c,service){
 const configured=c.config.TRANSFER_OUT_PORTS;if(!configured||typeof configured!=='object')return configured;
 const deletion=()=>{const ports=deletionPortsFor(c);return ports&&typeof ports==='object'?ports:{};};
 return {
  ...configured,issuer:configured.issuer??c.config.APP_ORIGIN,hold:configured.hold??deletion().hold,
  keys:configured.keys??{
   async current(owner){const history=await c.identityKeyHistory(owner,{purpose:'signing'});const key=history.find(entry=>entry.current===true&&entry.state==='active');return key?{kid:key.kid,publicJwk:key.publicJwk}:null;},
   matches:(owner,keychain)=>c.recoveryKeysMatch(owner,keychain),
   destroy:owner=>destroyCustody(c,owner),
  },
  effects:configured.effects??{
   revokeDelegations:owner=>c.revokeDelegationsFor(owner,{reason:'system'}),
   severConnections:owner=>c.connectionsSeverAccount(owner,{reason:'system'}),
   async eraseGrants(owner){const erasure=deletion().erasure??{},out={};for(const name of ['federation','mcp']){const port=erasure[name];if(port===null){out[name]='absent';continue;}if(typeof port?.eraseSubject!=='function'){out[name]='unconfigured';continue;}await port.eraseSubject(owner);out[name]='erased';}return out;},
   purge:owner=>movedPurge(c,owner,service),
  },
 };
}
export function transferOutEngine(c){
 let entry=engines.get(c);
 if(!entry){
  const clock={now:()=>clockOf(c)()};
  const service=new TransferOutService({executor:c,ports:()=>transferPortsFor(c,service),flags:{for:ctx=>flagsFor(c.config,ctx)},clock,random:cryptoRandom,
   log:event=>lifecycleLog(c.config,{kind:'transfer-out',...event}),wake:time=>typeof c.scheduleAlarm==='function'?c.scheduleAlarm(time):undefined});
  entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,lifecycle:service}})};
  engines.set(c,entry);
 }
 return entry;
}
const ownerActor=(owner,evidence={})=>({kind:'owner',owner,...Number.isSafeInteger(evidence?.stepUpAt)?{stepUpAt:evidence.stepUpAt}:{},...typeof evidence?.sessionId==='string'?{sessionId:evidence.sessionId}:{},
 ...Number.isSafeInteger(evidence?.sessionCreatedAt)?{sessionCreatedAt:evidence.sessionCreatedAt}:{},...typeof evidence?.credentialId==='string'?{credentialId:evidence.credentialId}:{},...Number.isSafeInteger(evidence?.credentialCreatedAt)?{credentialCreatedAt:evidence.credentialCreatedAt}:{}});
const run=(c,Operation,params)=>perform(transferOutEngine(c).engine,new Operation(params));

export const methods={
 transferOutBegin(owner,input,evidence){return run(this,BeginTransferOut,{actor:ownerActor(owner,evidence),input});},
 transferOutAuthorize(owner,input,evidence){return run(this,AuthorizeTransferOut,{actor:ownerActor(owner,evidence),input});},
 transferOutAuthorizeWaiting(owner,input){return run(this,AuthorizeWaitingTransferOut,{actor:{kind:'credential',owner},input});},
 transferOutStatement(owner,input){return run(this,ReceiveMoveStatement,{actor:{kind:'system',owner,reason:'move-endpoint'},input});},
 transferOutCancel(owner,input,evidence={}){return run(this,CancelTransferOut,{actor:evidence?.kind==='credential'?{kind:'credential',owner}:ownerActor(owner,evidence),input});},
 transferOutDispute(owner,input,evidence={}){return run(this,DisputeTransferOut,{actor:evidence?.kind==='dispute-link'?{kind:'dispute-link',owner}:ownerActor(owner,evidence),input});},
 transferOutElevate(owner,input,evidence){return run(this,ElevateTransferOut,{actor:ownerActor(owner,evidence),input});},
 transferOutRestartChoice(owner,input,evidence){return run(this,TransferRestartChoice,{actor:ownerActor(owner,evidence),input});},
 transferOutSupport(owner,input){return run(this,SupportTransferOut,{actor:{kind:'system',owner,reason:'support'},input});},
 transferOutTick(owner,{source='sweep'}={}){return run(this,StepTransferOut,{actor:{kind:'system',owner,reason:source}});},
 transferOutStatus(owner){return read(transferOutEngine(this).engine,new TransferOutStatus({actor:{kind:'owner',owner}}));},
 /** Account alarm hook, after the deletion step. Steps a live or committed transfer and reports `stop` (a moved purge
  * owns the account), `moved` (a committed move: the inactivity lifecycle no longer applies) and the wake time for the
  * alarm's min-merge. Never throws. */
 async transferOutAlarm(){
  try{
   // PORT-4: a live transfer-in (polling or activation) steps here too; its wake is min-merged with this one.
   const incoming=typeof this.transferInAlarm==='function'?await this.transferInAlarm():{wakeAt:null},merge=at=>[at,incoming.wakeAt].filter(Number.isSafeInteger).reduce((a,b)=>a===null?b:Math.min(a,b),null);
   const owner=await this.metadata.get('owner'),record=owner?await this.metadata.get(TRANSFER_KEY):undefined;
   if(!record||['cancelled','expired','aborted'].includes(record.state))return {stop:false,moved:false,wakeAt:merge(null)};
   const result=await perform(transferOutEngine(this).engine,new StepTransferOut({actor:{kind:'system',owner,reason:'alarm'}}));
   return {stop:result?.stop===true,moved:result?.moved===true||record.state==='committed',wakeAt:merge(Number.isSafeInteger(result?.wakeAt)?result.wakeAt:null)};
  }catch(error){lifecycleLog(this.config,{kind:'transfer-out',action:'alarm-error',code:error?.code||'unavailable'});return {stop:false,moved:(await this.metadata.get(TRANSFER_KEY).catch(()=>null))?.state==='committed',wakeAt:clockOf(this)()+3600000};}
 },
};
export const rpc={
 transferOutBegin:{},
 transferOutAuthorize:{},
 transferOutAuthorizeWaiting:{},
 transferOutStatement:{lifecycle:'suspended'},
 transferOutCancel:{lifecycle:'purging'},
 transferOutDispute:{lifecycle:'purging'},
 transferOutElevate:{},
 transferOutRestartChoice:{},
 // Support decisions come only from the admin adapter; never a client-selected method.
 transferOutSupport:{lifecycle:'suspended'},
 transferOutTick:{lifecycle:'purging'},
 transferOutStatus:{lifecycle:'suspended'},
};
