import {DatabaseSync} from 'node:sqlite';
import {FlagStatsStore,FLAG_STATS_SHARDS,createShardedFlagStats} from '../../packages/flags/stats.mjs';
/** Durable Node flagStats port. Its own database contains aggregate rows only.
 * secure_delete and DELETE journalling avoid retaining overwritten daily keys
 * in a live WAL. Backups/filesystem snapshots remain the operator's concern.
 * close() releases the timer/database; a new instance restores overdue cleanup.
 * Use alarms:false with injected clocks; tests explicitly invoke rollup().
 */
export class SqliteFlagStats{
 constructor(file,{clock={now:()=>Date.now()},random,alarms=true}={}){
  this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS flag_stats (key TEXT PRIMARY KEY, value TEXT NOT NULL)');this.tail=Promise.resolve();this.closed=false;this.timer=null;this.clock=clock;this.alarms=alarms;
  const storage={transaction:operation=>{const run=this.tail.then(async()=>{if(this.closed)throw new Error('Flag statistics store is closed.');this.db.exec('BEGIN IMMEDIATE');try{const tx={get:async key=>{const row=this.db.prepare('SELECT value FROM flag_stats WHERE key=?').get(key);return row?JSON.parse(row.value):undefined;},put:async(key,value)=>{this.db.prepare('INSERT INTO flag_stats(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));},delete:async key=>{this.db.prepare('DELETE FROM flag_stats WHERE key=?').run(key);},list:async({prefix=''})=>new Map(this.db.prepare('SELECT key,value FROM flag_stats WHERE key>=? AND key<? ORDER BY key').all(prefix,prefix+'\uffff').map(r=>[r.key,JSON.parse(r.value)]))};tx.getAlarm=()=>tx.get('@alarm');tx.setAlarm=n=>tx.put('@alarm',n);const result=await operation(tx);this.db.exec('COMMIT');this.arm();return result;}catch(error){this.db.exec('ROLLBACK');throw error;}});this.tail=run.catch(()=>{});return run;}};
  this.port=createShardedFlagStats({clock,shards:Array.from({length:FLAG_STATS_SHARDS},(_,shard)=>new FlagStatsStore({storage,shard,clock,...random?{random}:{}}))});
  // The initial cleanup precedes every caller's work on the same serial queue.
  this.ready=this.port.rollup();this.ready.catch(()=>{});
 }
 arm(){
  if(!this.alarms||this.closed)return;clearTimeout(this.timer);const row=this.db.prepare("SELECT value FROM flag_stats WHERE key='@alarm'").get();if(!row)return;const at=JSON.parse(row.value);
  this.timer=setTimeout(()=>{this.port.rollup().catch(()=>{if(!this.closed){this.timer=setTimeout(()=>this.arm(),60000);this.timer.unref();}});},Math.max(1,Math.min(2147483647,at-this.clock.now())));this.timer.unref();
 }
 async configure(input){await this.ready;return this.port.configure(input);}
 async record(input){await this.ready;return this.port.record(input);}
 async results(input){await this.ready;return this.port.results(input);}
 async rollup(){await this.ready;return this.port.rollup();}
 async close(){await this.tail;this.closed=true;clearTimeout(this.timer);this.db.close();}
}
export const createNodeFlagStats=(file,options)=>new SqliteFlagStats(file,options);
