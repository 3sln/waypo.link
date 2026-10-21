import {DurableObject} from 'cloudflare:workers';
import {FlagStatsStore,FLAG_STATS_SHARDS,flagStatsShard,createShardedFlagStats} from '../../packages/flags/stats.mjs';
import {statsError} from '../../packages/flags/experiments.mjs';
/** Internal counter DO, exported/wired by FF-4/FF-8. No fetch/HTTP routes.
 * Namespace names are stable infrastructure shards, never account IDs. RPC
 * snapshot is internal counter-store aggregation only, not an admin API.
 * storage.transaction is the atomic boundary, including rollup's key deletion;
 * alarms are committed with writes and restored automatically by the platform.
 */
export class FlagStatsObject extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.stats=new Map();}
 store(shard){if(!Number.isInteger(shard)||shard<0||shard>=FLAG_STATS_SHARDS)throw statsError();if(!this.stats.has(shard))this.stats.set(shard,new FlagStatsStore({storage:this.ctx.storage,shard}));return this.stats.get(shard);}
 configure({shard,...input}){return this.store(shard).configure(input);}
 record(input){return this.store(flagStatsShard(input)).record(input);}
 snapshot({shard,...input}){return this.store(shard).snapshot(input);}
 async rollup(){let rolledUp=0,expired=0;for(let shard=0;shard<FLAG_STATS_SHARDS;shard++){const result=await this.store(shard).rollup();rolledUp+=result.rolledUp;expired+=result.expired;}return {rolledUp,expired};}
 alarm(){return this.rollup();}
}
/** FF-4 binds this port as flagStats; FF-8 supplies the FLAG_STATS namespace. */
export function createWorkerFlagStats(namespace,{clock={now:()=>Date.now()}}={}){
 return createShardedFlagStats({clock,shards:Array.from({length:FLAG_STATS_SHARDS},(_,shard)=>{const stub=namespace.get(namespace.idFromName(`flag-stats-v1/${shard}`));return {configure:input=>stub.configure({shard,...input}),record:input=>stub.record(input),snapshot:input=>stub.snapshot({shard,...input}),rollup:()=>stub.rollup()};})});
}
