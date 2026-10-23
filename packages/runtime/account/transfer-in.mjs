// AccountController slice PORT-4, identity transfer-in (docs/architecture/identity-portability.md §7; engine in
// packages/identity/transfer-in.mjs). `methods` are installed on AccountController.prototype (`this` is the controller);
// `rpc` lists what `invoke` accepts (packages/runtime/account/index.mjs).
//
// Entry points (actors are built here from trusted adapter evidence, never from a request body):
//   transferInBegin(owner, input, evidence)   the enrolled owner (evidence {kind:'owner'}) or the signup adapter
//                                             ({kind:'intake'}); input {package, source}
//   transferInCancel(owner)                   owner, before the source bound the statement
//   transferInTick(owner, {source})           one bounded step (polling, activation); the account alarm also steps it
//   transferInStatus(owner)
//   transferInDocument(owner)                 the identity document of an active identity, or null (uniform 404);
//                                             the directory.v1 surface that serves it is not mounted yet
// Ports: `config.TRANSFER_IN_PORTS` {identity (transferInIdentityPort), fetch (the SSRF-safe egress port), roots?,
// recovery?, limiter?}. Keys (the controller's identity key registry with the custody fence), certification-key sealing
// and the attestation-key pins (this account's store) are composed here. Without the configured ports every begin
// refuses as unavailable and every step holds.
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {flagsFor} from './flags.mjs';
import {IdentityKeyRegistry} from '../../identity/keys.mjs';
import {TransferInService,TRANSFER_IN_KEY,BeginTransferIn,CancelTransferIn,StepTransferIn,TransferInStatus,identityDocument,certificationKeys} from '../../identity/transfer-in.mjs';
import {portabilityClient,attestationPins} from '../../identity/successors.mjs';
import {attestationRoots,parseAttestationKeySet} from '../../identity/attestation-keys.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {lifecycleLog} from '../lifecycle-runner.mjs';

const engines=new WeakMap();
const clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
/** TransferInPorts for this controller (see the header). Null when the adapter configured none. */
async function transferInPortsFor(c){
 const configured=c.config.TRANSFER_IN_PORTS;if(!configured||typeof configured!=='object'||typeof configured.fetch!=='function'||!configured.identity)return null;
 const cached=engines.get(c);if(cached?.ports)return cached.ports;
 const clock=clockOf(c),seal=value=>encryptSecret(value,c.config.KEY_ENCRYPTION_KEY),open=value=>decryptSecret(value,c.config.KEY_ENCRYPTION_KEY);
 const registry=new IdentityKeyRegistry({store:c.store,seal,open,clock});
 const client=portabilityClient({fetch:configured.fetch,clock,...configured.limiter?{limiter:configured.limiter}:{}});
 const roots=await attestationRoots({issuer:c.config.APP_ORIGIN,set:parseAttestationKeySet(c.config.IDENTITY_ATTESTATION_KEYS??c.config.IDENTITY_ATTESTATION_KEY),configured:configured.roots??{}});
 const pins=attestationPins({store:c.store,client,roots,clock,log:event=>lifecycleLog(c.config,{kind:'transfer-in',...event})});
 const ports={issuer:c.config.APP_ORIGIN,identity:configured.identity,client,pins,seal,...configured.recovery?{recovery:configured.recovery}:{},
  keys:{import:(owner,input)=>registry.importTransfer(owner,input),rotate:(owner,input)=>registry.rotateAtActivation(owner,input),statementSigner:owner=>registry.privateKey(owner,'signing',{transferStatement:true}),destroy:owner=>registry.destroyCustody(owner)}};
 if(cached)cached.ports=ports;
 return ports;
}
export function transferInEngine(c){
 let entry=engines.get(c);
 if(!entry){
  const clock={now:()=>clockOf(c)()};entry={ports:null};
  const service=new TransferInService({executor:c,ports:()=>entry.ports??{},flags:{for:ctx=>flagsFor(c.config,ctx)},clock,random:cryptoRandom,
   log:event=>lifecycleLog(c.config,{kind:'transfer-in',...event}),wake:time=>typeof c.scheduleAlarm==='function'?c.scheduleAlarm(time):undefined});
  Object.assign(entry,{service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,lifecycle:service}})});
  engines.set(c,entry);
 }
 return entry;
}
async function ready(c){const entry=transferInEngine(c);entry.ports??=await transferInPortsFor(c);return entry;}
const run=async(c,Operation,params)=>perform((await ready(c)).engine,new Operation(params));

export const methods={
 async transferInBegin(owner,input,evidence={}){await this.warm(owner);return run(this,BeginTransferIn,{actor:{kind:evidence?.kind==='intake'?'intake':'owner',owner},input});},
 transferInCancel(owner){return run(this,CancelTransferIn,{actor:{kind:'owner',owner},input:{}});},
 transferInTick(owner,{source='sweep'}={}){return run(this,StepTransferIn,{actor:{kind:'system',owner,reason:source}});},
 async transferInStatus(owner){return read((await ready(this)).engine,new TransferInStatus({actor:{kind:'owner',owner}}));},
 /** Public identity-document port (organizations §3a.3 with `moves` and the key history); null unless active. */
 async transferInDocument(owner){
  const identity=this.config.TRANSFER_IN_PORTS?.identity;
  if(await this.metadata.get('owner')!==owner||typeof identity?.get!=='function')return null;
  const account=await identity.get(owner);if(!account||account.id!==owner)return null;
  const registry=new IdentityKeyRegistry({store:this.store,clock:clockOf(this)});
  return identityDocument({issuer:this.config.APP_ORIGIN,identity:account,signing:await registry.history(owner,{purpose:'signing'}),certification:await certificationKeys(this.metadata,owner)});
 },
 /** Account alarm hook (called from transferOutAlarm). Never throws; reports the wake time for the alarm's min-merge. */
 async transferInAlarm(){
  try{
   const owner=await this.metadata.get('owner'),record=owner?await this.metadata.get(TRANSFER_IN_KEY):undefined;
   if(!record||['active','refused','cancelled','failed'].includes(record.state))return {wakeAt:null};
   const result=await run(this,StepTransferIn,{actor:{kind:'system',owner,reason:'alarm'}});
   return {wakeAt:Number.isSafeInteger(result?.wakeAt)?result.wakeAt:null};
  }catch(error){lifecycleLog(this.config,{kind:'transfer-in',action:'alarm-error',code:error?.code||'unavailable'});return {wakeAt:clockOf(this)()+3600000};}
 },
};
export const rpc={
 // A transfer-in identity has no prior account state; the begin warms (binds) the account itself.
 transferInBegin:{lifecycle:'suspended'},
 transferInCancel:{lifecycle:'suspended'},
 transferInTick:{lifecycle:'suspended'},
 transferInStatus:{lifecycle:'suspended'},
 transferInDocument:{lifecycle:'suspended',gate:'none'},
};
