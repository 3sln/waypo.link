import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {ProduceRetention,RetentionStatus,SaveRetentionKeep,ViewRetentionWarning,retentionDue} from '../retention.mjs';
import {lifecycleLog} from '../lifecycle-runner.mjs';
import {OVER_QUOTA_EPISODE} from '../export-hooks.mjs';
import {flagsFor} from './flags.mjs';
const engines=new WeakMap();
/** D092 N2: per-unit bytes from the account item index (one SQL GROUP BY per unit kind; no metadata row paging).
 * Only used once the index and its backfill report ready; otherwise the Engine falls back to a bounded scan.
 * The Engine accepts these bytes only when they reconcile exactly with logical accounting. */
export async function retentionUnitBytes(c,owner,tx){
 // Readiness is read through the caller's account transaction (the store is serialized; no nested access).
 const sql=c.itemIndex?.sql;if(!sql||!tx||!await tx.get('item-index-ready')||!await tx.get('search-backfill-ready'))return null;
 const collections={},resources={};
 for(const row of sql.exec("SELECT collection AS id, COALESCE(SUM(json_extract(record,'$.size')),0) AS bytes FROM inbox_catalog WHERE owner=? GROUP BY collection",owner))collections[row.id]=Number(row.bytes);
 for(const row of sql.exec("SELECT resource AS id, COALESCE(SUM(json_extract(record,'$.size')),0) AS bytes FROM hosted_catalog GROUP BY resource"))resources[row.id]=Number(row.bytes);
 return {collections,resources};
}
export function retentionEngine(c){let engine=engines.get(c);if(!engine){engine=createAppEngine({providers:{accountStore:c.metadata,clock:{now:()=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK():Date.now()},random:cryptoRandom,audit:nullAudit,flags:{for:ctx=>flagsFor(c.config,ctx)},config:new Proxy(c.config,{get:(target,name,receiver)=>name==='retentionUnitBytes'?(owner,tx)=>retentionUnitBytes(c,owner,tx):Reflect.get(target,name,receiver)})}});engines.set(c,engine);}return engine;}
export const methods={
 // M3: the producer computes its own next wake (notice slot, retry, deadline or bounded re-evaluation); none when idle.
 async retentionProduce(owner){const result=await perform(retentionEngine(this),new ProduceRetention({actor:{kind:'system',owner}}));for(const alert of result.alerts??[])lifecycleLog(this.config,alert);if(Number.isSafeInteger(result.wakeAt))await this.scheduleAlarm?.(result.wakeAt);return result;},
 async retentionStatus(owner){await this.retentionProduce(owner);return read(retentionEngine(this),new RetentionStatus({actor:{kind:'owner',owner}}));},
 async retentionKeep(owner,input){await this.retentionProduce(owner);await perform(retentionEngine(this),new SaveRetentionKeep({actor:{kind:'owner',owner},input}));return read(retentionEngine(this),new RetentionStatus({actor:{kind:'owner',owner}}));},
 // N4: lets the route answer the uniform flag-off 404 before spending the owner's request budget.
 async retentionHasEpisode(owner){if(await this.metadata.get('owner')!==owner)return false;return (await this.metadata.get(OVER_QUOTA_EPISODE))!==undefined;},
 async retentionViewed(owner){return perform(retentionEngine(this),new ViewRetentionWarning({actor:{kind:'owner',owner}}));},
 // M3: never warms (un-shelves) the account and never refreshes billing; only accounts with retention work run the producer.
 async retentionAlarm(){
  const owner=await this.metadata.get('owner');if(!owner||!flagsFor(this.config,{subject:{kind:'account',owner}}).enabled('OVER_QUOTA_RETENTION_ENABLED'))return;
  if(!await this.metadata.transaction(tx=>retentionDue(tx)))return;
  const run=()=>this.retentionProduce(owner);
  try{return this.gate?await this.gate.run(run):await run();}
  catch(error){if(['account_deleting','forbidden'].includes(error?.code))return;await this.scheduleAlarm?.(Date.now()+3600000);return {error:error?.code??'retention_unavailable'};}
 },
};
export const rpc={retentionHasEpisode:{lifecycle:'suspended'},retentionStatus:{lifecycle:'suspended',warm:true},retentionKeep:{lifecycle:'suspended',warm:true},retentionViewed:{lifecycle:'suspended',warm:true}};
