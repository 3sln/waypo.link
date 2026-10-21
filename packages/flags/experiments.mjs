import {AppAction,AppQuery} from '../app/engine.mjs';
import {estimateHll,mergeHll} from './hll.mjs';
export const DAY_MS=86400000,RESULT_RETENTION_MS=90*DAY_MS,MIN_ACCOUNTS=100,MIN_CELL=20;
export const statsError=(code='invalid_flag_stats')=>Object.assign(new TypeError('Invalid experiment statistics request.'),{code});
export function utcDay(now){if(!Number.isSafeInteger(now)||now<0||now>8640000000000000)throw statsError();return new Date(now).toISOString().slice(0,10);}
export function resultRequest(input){if(!input||Object.keys(input).some(k=>k!=='experimentId')||typeof input.experimentId!=='string')throw statsError('invalid_results_filter');return input;}
/** Two-sided 95% Wilson score interval for event successes/trials. Counts are
 * events, not people; repeated outcomes may exceed exposures, in which case a
 * binomial interval is undefined and is null (counts are never clamped).
 */
export function wilson(successes,trials){
 if(!Number.isSafeInteger(successes)||!Number.isSafeInteger(trials)||trials<=0||successes<0||successes>trials)return null;
 const z=1.959963984540054,q=z*z,p=successes/trials,d=1+q/trials,center=(p+q/(2*trials))/d,radius=z*Math.sqrt(p*(1-p)/trials+q/(4*trials*trials))/d;
 return {low:Math.max(0,center-radius),high:Math.min(1,center+radius)};
}
const cell=n=>n<MIN_CELL?'<20':n;
const addCount=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(b)||b<0||!Number.isSafeInteger(n))throw statsError('stats_overflow');return n;};
function counts(exposures,outcomes,metrics,hidden=false){
 const rates={};for(const metric of metrics){const n=outcomes[metric]??0,visible=!hidden&&exposures>=MIN_CELL&&n>=MIN_CELL&&(n>exposures||exposures-n>=MIN_CELL);rates[metric]=visible?{rate:n/exposures,interval:wilson(n,exposures)}:null;}
 return {exposures:hidden?'<20':cell(exposures),outcomes:Object.fromEntries(metrics.map(m=>[m,hidden?'<20':cell(outcomes[m]??0)])),rates};
}
/** Internal shard snapshots only, never an HTTP result. Each account routes to
 * exactly one infrastructure shard per variant/day. Live registers merge by max.
 * After local rollup the sketches are gone: estimates of these disjoint shards
 * add within a day. They NEVER add across days. Shard IDs deduplicate snapshots.
 * No dailyKey or identifier is included in a snapshot. The public result has no
 * slicing, raw snapshot, or bypass-cohort option. Missing shards fail closed.
 */
export function experimentResults(snapshots,{experimentId,now,shardCount=snapshots.length}){
 const shards=new Map();for(const snapshot of snapshots){if(!snapshot||snapshot.experimentId!==experimentId)throw statsError();if(shards.has(snapshot.shard)){if(JSON.stringify(shards.get(snapshot.shard))!==JSON.stringify(snapshot))throw statsError('conflicting_stats_shard');continue;}shards.set(snapshot.shard,snapshot);}
 const parts=[...shards.values()].sort((a,b)=>a.shard-b.shard),meta=parts.find(p=>p.config)?.config;
 const hidden=reason=>({experimentId,visible:false,reason,variants:[]});if(parts.length!==shardCount)return hidden('incomplete');if(!meta)return hidden('empty');
 if(meta.concludedAt!==null&&now>=meta.concludedAt+RESULT_RETENTION_MS)return hidden('expired');
 if(parts.some(p=>JSON.stringify(p.config)!==JSON.stringify(meta)))return hidden('incomplete');
 const days=[...new Set(parts.flatMap(p=>p.days.map(d=>d.day)))].sort(),variants=meta.variants.map(variant=>{
  const daily=days.map(day=>{const rows=parts.flatMap(p=>p.days.filter(d=>d.day===day).flatMap(d=>d.cells.filter(c=>c.variant===variant))),live=rows.filter(r=>r.hll),rolled=rows.filter(r=>!r.hll),outcomes=Object.fromEntries(meta.metrics.map(m=>[m,rows.reduce((n,r)=>addCount(n,r.events[m]??0),0)]));return {day,exposures:rows.reduce((n,r)=>addCount(n,r.events.exposure??0),0),outcomes,distinct:Math.round(rolled.reduce((n,r)=>n+r.distinct,0)+(live.length?estimateHll(mergeHll(live.map(r=>r.hll))):0))};});
  return {variant,daily};
 });
 if(variants.length<2||variants.some(v=>!v.daily.some(d=>d.distinct>=MIN_ACCOUNTS)))return hidden('minimum_cohort');
 return {experimentId,visible:true,variants:variants.map(v=>{const exposureHidden=v.daily.some(d=>d.exposures<MIN_CELL),outcomeHidden=meta.metrics.some(m=>v.daily.some(d=>d.outcomes[m]<MIN_CELL)),outcomes=Object.fromEntries(meta.metrics.map(m=>[m,v.daily.reduce((n,d)=>addCount(n,d.outcomes[m]),0)]));return {variant:v.variant,daily:v.daily.map(d=>({day:d.day,distinct:cell(d.distinct),...counts(d.exposures,d.outcomes,meta.metrics)})),totals:counts(v.daily.reduce((n,d)=>addCount(n,d.exposures),0),outcomes,meta.metrics,exposureHidden||outcomeHidden)};})};
}
// FF-3 may register these classes or use its own authorization facade. Inputs
// come from trusted server code; the provider owns transactional state/rules.
// A record Action has a system actor without owner: generic audit interceptors
// must never receive an account actor or record this.input.
export class RecordFlagEvent extends AppAction{
 static operation='flags.record';static deps=['flagStats'];
 run({flagStats}){if(this.actor?.kind!=='system'||this.actor.owner!==undefined)throw statsError('forbidden');return flagStats.record(this.input);}
}
export class FlagExperimentResults extends AppQuery{
 static operation='flags.experiment-results';static deps=['flagStats'];
 fetch({flagStats}){if(!['admin','boot'].includes(this.actor?.kind))throw statsError('forbidden');return flagStats.results(resultRequest(this.input));}
}
export class RollupFlagStats extends AppAction{
 static operation='flags.stats-rollup';static deps=['flagStats'];
 run({flagStats}){if(this.actor?.kind!=='system'||this.actor.owner!==undefined)throw statsError('forbidden');return flagStats.rollup();}
}
