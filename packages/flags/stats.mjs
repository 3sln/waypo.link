/**
 * flagStats port contract (FF-3 engine, FF-4 adapters, FF-5b server call sites):
 * configure({experimentId:UUID,variants:[key]|[{key,...}],metrics:[name],
 *   concludedAt?:epochMs|ISO|null}) -> {accepted,reason?}. Trusted lifecycle
 * metadata must be installed before recording, including ALL variants. Only
 * declared server metrics may be configured (the flag service checks registry).
 * Variant/metric sets are immutable; conclusion can be added once, never undone.
 * record({experimentId,variant,kind:'exposure'|declaredMetric,owner:verifiedUUID,
 *   day?:'YYYY-MM-DD',delivery?:{lane:0..63,sequence:positiveSafeInteger}})
 *   -> {accepted:boolean,reason?:'duplicate'|'day_closed'|'unknown_experiment'|
 *       'concluded'}. owner is consumed only by transient HMAC and shard routing;
 *   it MUST NOT appear in persisted data, return values, logs, errors or audit.
 * day defaults to the injected clock's UTC day. Late/future days are dropped;
 * closed days can never recreate a sketch. Counts are events, not unique events
 * or users. Only EXPOSURES contribute to distinct-account cohort eligibility.
 * delivery is an optional retry watermark, NOT a per-event receipt. A lane is a
 * fixed infrastructure producer, never an account/client identifier. Sequences
 * increase per (experiment,variant,day,kind,lane). Replays and out-of-order lower
 * sequences are dropped; losses are tolerated. Retries MUST reuse delivery;
 * without it a delivery is a new event and callers MUST NOT retry uncertainty.
 * No per-user/event ID deduplication table or event log is permitted.
 * results({experimentId}) -> {experimentId,visible,reason?,variants:[{variant,
 *   daily:[{day,distinct,exposures,outcomes,rates}],totals:{exposures,outcomes,
 *   rates}}]}. Rate={rate,interval:{low,high}|null}|null. All counts <20 are
 * '<20'. Rates/complements and totals that reveal suppressed cells are hidden.
 * No account, region, client, date-range or arbitrary filters are accepted.
 * rollup() -> {rolledUp,expired}; adapters MUST schedule it at UTC midnight
 * (and restore the alarm after restart), before 02:00 UTC. Every operation also
 * rolls up overdue days/deletes expired results atomically before proceeding.
 * Results expire exactly 90*24h after conclusion; no stale-result fallback.
 *
 * Core storage: {transaction(async tx=>...)}, tx={get,put,delete,list}, optional
 * getAlarm/setAlarm. Transactions serialize reads, increments, rollup and expiry
 * including async HMAC; a failed transaction commits nothing. Clocks/randomness
 * are injected. A dailyKey is random per store/UTC day, persisted only until
 * rollup. Neither keys nor registers cross the public port. Internal snapshot()
 * is counter-store RPC only: FF-3/HTTP/CLI MUST expose results(), never snapshot.
 *
 * Sixteen disjoint shards: hash(experimentId,variant,identityAccountShard).
 * An account cannot appear in two shards for a variant. Live HLLs merge by max;
 * independently keyed shard hashes are uniform over disjoint account sets.
 * Rolled-up shards carry scalar estimates only, summed WITHIN a day; retaining
 * registers to merge after rollup would violate privacy §3. No sum across days.
 */
import {UUID} from '../core/primitives.mjs';
import {timeValue} from './snapshot.mjs';
import {accountShard,murmur3_32} from './hash.mjs';
import {createHll,accountHll,estimateHll} from './hll.mjs';
import {utcDay,DAY_MS,RESULT_RETENTION_MS,statsError,resultRequest,experimentResults} from './experiments.mjs';
export const FLAG_STATS_SHARDS=16;
const clockDefault={now:()=>Date.now()},randomDefault={bytes:n=>crypto.getRandomValues(new Uint8Array(n))};
const copy=x=>x===undefined?undefined:structuredClone(x),validId=x=>typeof x==='string'&&UUID.test(x),keyName=x=>typeof x==='string'&&x.length>0&&x.length<=64&&!/[\u0000-\u001f\u007f]/.test(x);
function fields(x,allowed){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw statsError();}
export function flagStatsShard({experimentId,variant,owner}){if(!validId(experimentId)||!keyName(variant)||!validId(owner))throw statsError();return murmur3_32(`${experimentId}\x1f${variant}\x1f${accountShard(owner)}`)%FLAG_STATS_SHARDS;}
function configuration(input){
 fields(input,['experimentId','variants','metrics','concludedAt']);const {experimentId,metrics}=input,variants=Array.isArray(input.variants)?input.variants.map(v=>typeof v==='string'?v:v?.key):null,concludedAt=input.concludedAt==null?null:timeValue(input.concludedAt);
 if(!validId(experimentId)||!Array.isArray(variants)||variants.length<2||variants.length>8||variants.some(v=>!keyName(v))||new Set(variants).size!==variants.length||!Array.isArray(metrics)||metrics.length>5||metrics.some(m=>!/^[_a-z][_a-z0-9]{0,63}$/.test(m)||['exposure','constructor','prototype','__proto__'].includes(m))||new Set(metrics).size!==metrics.length||concludedAt!==null&&!Number.isFinite(concludedAt))throw statsError();
 return {experimentId,variants,metrics:[...metrics],concludedAt};
}
function event(input){
 fields(input,['experimentId','variant','kind','owner','day','delivery']);flagStatsShard(input);
 if(!keyName(input.kind)||input.day!==undefined&&(typeof input.day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(input.day)))throw statsError();
 if(input.delivery!==undefined){fields(input.delivery,['lane','sequence']);if(!Number.isInteger(input.delivery.lane)||input.delivery.lane<0||input.delivery.lane>63||!Number.isSafeInteger(input.delivery.sequence)||input.delivery.sequence<1)throw statsError();}return input;
}
export class FlagStatsStore{
 constructor({storage,shard=0,clock=clockDefault,random=randomDefault}){if(!Number.isInteger(shard)||shard<0||shard>=FLAG_STATS_SHARDS)throw statsError();this.storage=storage;this.shard=shard;this.clock=clock;this.random=random;this.prefix=`stats/${shard}/`;}
 async transaction(operation){
  return this.storage.transaction(async raw=>{
   const prefix=this.prefix,tx={get:k=>raw.get(prefix+k),put:(k,v)=>raw.put(prefix+k,v),delete:k=>raw.delete(prefix+k),list:async p=>new Map([...await raw.list({prefix:prefix+p})].map(([k,v])=>[k.slice(prefix.length),v]))},now=this.clock.now(),today=utcDay(now),sweep=await this.sweep(tx,now,today),value=await operation(tx,now,today,sweep);
   if(raw.setAlarm){let next=(Math.floor(now/DAY_MS)+1)*DAY_MS;for(const c of (await tx.list('experiment/')).values())if(c.concludedAt!==null)next=Math.min(next,c.concludedAt+RESULT_RETENTION_MS);const existing=await raw.getAlarm?.();await raw.setAlarm(existing>now?Math.min(existing,next):next);}return value;
  });
 }
 async sweep(tx,now,today){
  let expired=0,rolledUp=0;const configs=await tx.list('experiment/'),expiredIds=new Set();
  for(const [key,c]of configs)if(c.concludedAt!==null&&now>=c.concludedAt+RESULT_RETENTION_MS){await tx.delete(key);expiredIds.add(c.experimentId);expired++;}
  for(const [key,row]of await tx.list('day/')){
   if(expiredIds.has(row.experimentId)){await tx.delete(key);continue;}
   if(row.day<today&&row.cells.some(c=>c.hll)){for(const c of row.cells){if(c.hll){c.distinct=estimateHll(c.hll);delete c.hll;}delete c.watermarks;}await tx.put(key,row);rolledUp++;}
  }
  for(const [key]of await tx.list('key/'))if(key.slice(4)<today)await tx.delete(key);
  return {expired,rolledUp};
 }
 configure(input){
  const config=configuration(input);return this.transaction(async(tx,now)=>{
   if(config.concludedAt!==null&&config.concludedAt>now)throw statsError();if(config.concludedAt!==null&&now>=config.concludedAt+RESULT_RETENTION_MS)return {accepted:false,reason:'expired'};
   const key=`experiment/${config.experimentId}`,before=await tx.get(key);
   if(before&&(JSON.stringify(before.variants)!==JSON.stringify(config.variants)||JSON.stringify(before.metrics)!==JSON.stringify(config.metrics)||before.concludedAt!==null&&before.concludedAt!==config.concludedAt))throw statsError('experiment_stats_frozen');
   await tx.put(key,config);return {accepted:true};
  });
 }
 record(input){
  event(input);input={...input,...input.delivery?{delivery:{...input.delivery}}:{}};if(flagStatsShard(input)!==this.shard)throw statsError('wrong_stats_shard');
  return this.transaction(async(tx,now,today)=>{
   const day=input.day??today;if(day!==today)return {accepted:false,reason:'day_closed'};const config=await tx.get(`experiment/${input.experimentId}`);
   if(!config)return {accepted:false,reason:'unknown_experiment'};if(config.concludedAt!==null)return {accepted:false,reason:'concluded'};
   if(!config.variants.includes(input.variant)||input.kind!=='exposure'&&!config.metrics.includes(input.kind))throw statsError();
   const key=`day/${day}/${input.experimentId}`,row=await tx.get(key)??{day,experimentId:input.experimentId,cells:[]};let c=row.cells.find(c=>c.variant===input.variant);
   if(!c){c={variant:input.variant,events:{},hll:createHll(),watermarks:{}};row.cells.push(c);}
   const mark=input.delivery?`${input.kind}/${input.delivery.lane}`:null;if(mark&&(c.watermarks[mark]??0)>=input.delivery.sequence)return {accepted:false,reason:'duplicate'};
   if((c.events[input.kind]??0)>=Number.MAX_SAFE_INTEGER)throw statsError('stats_overflow');
   if(input.kind==='exposure'){let dailyKey=await tx.get(`key/${day}`);if(!dailyKey){dailyKey=Array.from(this.random.bytes(32));if(dailyKey.length!==32||dailyKey.some(n=>!Number.isInteger(n)||n<0||n>255))throw statsError();await tx.put(`key/${day}`,dailyKey);}await accountHll(c.hll,dailyKey,input.owner);}
   c.events[input.kind]=(c.events[input.kind]??0)+1;if(mark)c.watermarks[mark]=input.delivery.sequence;await tx.put(key,row);return {accepted:true};
  });
 }
 snapshot(input){
  resultRequest(input);const {experimentId}=input;if(!validId(experimentId))throw statsError();return this.transaction(async tx=>({experimentId,shard:this.shard,config:await tx.get(`experiment/${experimentId}`)??null,days:[...await tx.list('day/')].map(([,d])=>d).filter(d=>d.experimentId===experimentId).map(d=>({day:d.day,cells:d.cells.map(({variant,events,hll,distinct})=>({variant,events,...hll?{hll}:{distinct}}))}))}));
 }
 rollup(){return this.transaction((tx,now,today,sweep)=>sweep);}
}
/** Compose all sixteen internal counter ports. Errors/missing shards never
 * return partial results. configure/rollup are idempotent across partial failure;
 * record has no implicit retry. Do not expose the shards or snapshots to clients.
 */
export function createShardedFlagStats({shards,clock=clockDefault}){
 if(!Array.isArray(shards)||shards.length!==FLAG_STATS_SHARDS)throw statsError();
 return {configure:async input=>{configuration(input);const results=await Promise.all(shards.map(s=>s.configure(input)));return results.find(r=>!r.accepted)??{accepted:true};},record:input=>{event(input);return shards[flagStatsShard(input)].record(input);},results:async input=>{resultRequest(input);const now=clock.now(),snapshots=await Promise.all(shards.map(s=>s.snapshot(input)));return experimentResults(snapshots,{experimentId:input.experimentId,now:Math.max(now,clock.now()),shardCount:FLAG_STATS_SHARDS});},rollup:async()=>{const results=await Promise.all(shards.map(s=>s.rollup()));return results.reduce((a,r)=>({rolledUp:a.rolledUp+r.rolledUp,expired:a.expired+r.expired}),{rolledUp:0,expired:0});}};
}
/** Transactional memory adapter, with a diagnostic dump for privacy tests only. */
export function memoryStatsStorage(){
 let rows=new Map(),tail=Promise.resolve();return {dump:()=>copy([...rows]),transaction(operation){const run=tail.then(async()=>{const draft=new Map(copy([...rows])),tx={get:async k=>copy(draft.get(k)),put:async(k,v)=>{draft.set(k,copy(v));},delete:async k=>draft.delete(k),list:async({prefix=''})=>new Map([...draft].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,copy(v)])),getAlarm:async()=>draft.get('@alarm'),setAlarm:async n=>{draft.set('@alarm',n);}};const result=await operation(tx);rows=draft;return result;});tail=run.catch(()=>{});return run;}};
}
export function memoryFlagStats({clock=clockDefault,random=randomDefault,storage=memoryStatsStorage()}={}){const shards=Array.from({length:FLAG_STATS_SHARDS},(_,shard)=>new FlagStatsStore({storage,shard,clock,random}));return {...createShardedFlagStats({shards,clock}),storage};}
