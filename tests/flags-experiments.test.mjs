import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine,Provider} from '../vendor/ngin/index.js';
import {perform,read} from '../packages/app/engine.mjs';
import {auditTrail,memoryAudit} from '../packages/app/providers.mjs';
import {memoryFlagStats,FlagStatsStore,FLAG_STATS_SHARDS,flagStatsShard} from '../packages/flags/stats.mjs';
import {RecordFlagEvent,FlagExperimentResults,RollupFlagStats,experimentResults,wilson,utcDay,DAY_MS,RESULT_RETENTION_MS} from '../packages/flags/experiments.mjs';
import {createHll,addHll,accountHll,mergeHll,estimateHll} from '../packages/flags/hll.mjs';
import {SqliteFlagStats} from '../apps/node/flag-stats.mjs';
import {fakeClock,createRandom} from './helpers/chaos.mjs';
import {seededRandom} from '../packages/app/memory-providers.mjs';
const ID='11111111-1111-4111-8111-111111111111',owner=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12,'0')}`,config={experimentId:ID,variants:['control','treatment'],metrics:['opened']},start=Date.UTC(2026,9,21,12),system={kind:'system',reason:'experiment-counter'};
function harness(port,clock){const audit=memoryAudit({clock}),engine=new Engine({providers:{flagStats:Provider.fromSingleton(port),audit:Provider.fromSingleton(audit)},interceptors:[auditTrail]});return {engine,audit,record:input=>perform(engine,new RecordFlagEvent({actor:system,input:{experimentId:ID,variant:'control',kind:'exposure',...input}})),results:input=>read(engine,new FlagExperimentResults({actor:{kind:'admin'},input:input??{experimentId:ID}})),rollup:()=>perform(engine,new RollupFlagStats({actor:system}))};}
function snapshot({exposures=120,outcomes=20,distinct=100,variants=['control','treatment'],days=['2026-10-21']}={}){return {experimentId:ID,shard:0,config:{...config,variants,concludedAt:null},days:days.map(day=>({day,cells:variants.map(variant=>({variant,events:{exposure:exposures,opened:outcomes},distinct}))}))};}
test('Wilson bounds cover zero/all successes and reject non-binomial event counts',()=>{
 assert.equal(wilson(0,0),null);assert.equal(wilson(2,1),null);assert.equal(wilson(-1,10),null);assert.equal(wilson(.5,10),null);
 assert.ok(Math.abs(wilson(20,100).low-.133366933331)<1e-10);assert.ok(Math.abs(wilson(20,100).high-.288829165594)<1e-10);assert.ok(wilson(0,100).low<1e-15);assert.equal(wilson(100,100).high,1);
});
test('HLL empty, duplicate insertion, accuracy and max-merge algebra',async()=>{
 const key=Array(32).fill(7),a=createHll(),b=createHll();assert.equal(estimateHll(a),0);
 for(let i=0;i<2000;i++)await accountHll(i%2?a:b,key,owner(i));const merged=mergeHll([a,b]);assert.ok(Math.abs(estimateHll(merged)-2000)<100);
 await accountHll(a,key,owner(1));assert.deepEqual(mergeHll([a,b]),merged);assert.deepEqual(mergeHll([b,a,a]),merged);
 assert.throws(()=>mergeHll([a,createHll(10)]),/precision mismatch/);assert.throws(()=>addHll(a,new Uint8Array(1)),/64-bit/);
});
test('results hide empty/single/small cohorts; threshold is per day, never summed',()=>{
 assert.equal(experimentResults([],{experimentId:ID,now:start}).visible,false);
 for(const value of [snapshot({variants:['control']}),snapshot({distinct:99}),snapshot({distinct:60,days:['2026-10-20','2026-10-21']})])assert.equal(experimentResults([value],{experimentId:ID,now:start}).visible,false);
 const value=snapshot();value.days[0].cells[1].distinct=99;assert.equal(experimentResults([value],{experimentId:ID,now:start}).visible,false);value.days.push({day:'2026-10-22',cells:[{variant:'treatment',events:{exposure:100,opened:20},distinct:100}]});assert.equal(experimentResults([value],{experimentId:ID,now:start}).visible,true);
 assert.equal(experimentResults([snapshot()],{experimentId:ID,now:start,shardCount:2}).reason,'incomplete');
});
test('19/20 suppression hides rates and totals that could recover suppressed daily cells',()=>{
 for(const n of [0,19,20]){const result=experimentResults([snapshot({outcomes:n})],{experimentId:ID,now:start}),day=result.variants[0].daily[0];assert.equal(day.outcomes.opened,n<20?'<20':n);assert.equal(day.rates.opened===null,n<20);}
 const small=snapshot({exposures:19,outcomes:19}),large=snapshot();large.days.push({...small.days[0],day:'2026-10-20'});const result=experimentResults([large],{experimentId:ID,now:start});assert.equal(result.variants[0].daily[0].exposures,'<20');assert.equal(result.variants[0].totals.exposures,'<20');assert.equal(result.variants[0].totals.rates.opened,null);
 const repeated=experimentResults([snapshot({outcomes:150})],{experimentId:ID,now:start});assert.equal(repeated.variants[0].daily[0].rates.opened.rate,1.25);assert.equal(repeated.variants[0].daily[0].rates.opened.interval,null);
});
test('unsafe aggregate counters and malformed or prototype metric names fail closed',async()=>{
 const a=snapshot({exposures:Number.MAX_SAFE_INTEGER}),b={...snapshot(),shard:1};assert.throws(()=>experimentResults([a,b],{experimentId:ID,now:start}),{code:'stats_overflow'});
 for(const metrics of [['constructor'],['__proto__'],['prototype'],['exposure'],['opened','opened']])await assert.rejects(memoryFlagStats().configure({...config,metrics}),{code:'invalid_flag_stats'});await assert.rejects(memoryFlagStats().configure({...config,variants:{}}),{code:'invalid_flag_stats'});
});
test('engine records event counts without storing owners; outcomes alone cannot admit a cohort',async t=>{
 const clock=fakeClock(start),port=memoryFlagStats({clock,random:seededRandom(createRandom(17))}),h=harness(port,clock);t.after(()=>h.engine.dispose());await port.configure(config);
 for(const variant of config.variants)for(let i=0;i<140;i++)await h.record({variant,owner:owner(i),kind:'opened'});assert.equal((await h.results()).visible,false);
 for(const variant of config.variants)for(let i=0;i<140;i++)await h.record({variant,owner:owner(i)});await h.record({owner:owner(0)});
 const result=await h.results();assert.equal(result.visible,true);assert.equal(result.variants[0].totals.exposures,141);assert.equal(result.variants[1].totals.exposures,140);assert.equal(result.variants[0].totals.outcomes.opened,140);
 const persisted=JSON.stringify(port.storage.dump());assert.ok(!persisted.includes(owner(0)));assert.ok(!persisted.includes('"owner"'));assert.ok(!JSON.stringify(h.audit.entries).includes(owner(0)));assert.ok(!JSON.stringify(result).includes('hll'));assert.ok(!JSON.stringify(result).includes('dailyKey'));
});
test('UTC rollover ignores local dates, atomically deletes keys/sketches/watermarks and refuses late delivery',async t=>{
 const clock=fakeClock(Date.parse('2026-10-21T23:59:59.999Z')),port=memoryFlagStats({clock,random:seededRandom(createRandom(19))}),h=harness(port,clock);t.after(()=>h.engine.dispose());await port.configure(config);
 assert.equal(utcDay(Date.parse('2026-10-21T20:00:00-06:00')),'2026-10-22');assert.equal(utcDay(Date.parse('2026-10-22T03:00:00+09:00')),'2026-10-21');
 const input={owner:owner(9),day:'2026-10-21',delivery:{lane:1,sequence:1}};assert.equal((await h.record(input)).accepted,true);assert.equal((await h.record(input)).reason,'duplicate');const keys=port.storage.dump().filter(([k])=>k.includes('/key/')).map(([,v])=>v);assert.equal(keys.length,1);
 clock.advance(1);await h.rollup();let rows=port.storage.dump(),encoded=JSON.stringify(rows);assert.ok(!rows.some(([k])=>k.includes('/key/')));assert.ok(!encoded.includes('"hll"'));assert.ok(!encoded.includes('watermarks'));assert.ok(!encoded.includes(owner(9)));for(const key of keys)assert.ok(!encoded.includes(JSON.stringify(key)));
 assert.equal((await h.record(input)).reason,'day_closed');assert.equal((await h.record({...input,day:'2026-10-23'})).reason,'day_closed');assert.equal((await h.record({owner:owner(9)})).accepted,true);rows=port.storage.dump();assert.ok(rows.some(([k])=>k.includes('/key/2026-10-22')));assert.equal(rows.filter(([k])=>k.includes('/day/')).length,2);
});
test('engine results accept no filters, record accepts no arbitrary dimensions, config is frozen',async t=>{
 const clock=fakeClock(start),port=memoryFlagStats({clock}),h=harness(port,clock);t.after(()=>h.engine.dispose());await port.configure(config);
 for(const input of [{account:owner(0)},{owner:owner(0)},{region:'US'},{client:'app.example'},{day:'2026-10-21'},{filter:{}},{shard:0}])await assert.rejects(h.results({experimentId:ID,...input}),{code:'invalid_results_filter'});
 await assert.rejects(h.record({owner:owner(0),region:'US'}),{code:'invalid_flag_stats'});await assert.rejects(h.record({owner:owner(0),kind:'undeclared'}),{code:'invalid_flag_stats'});await assert.rejects(h.record({owner:'anonymous'}),{code:'invalid_flag_stats'});
 await assert.rejects(port.configure({...config,variants:['only']}),{code:'invalid_flag_stats'});await assert.rejects(port.configure({...config,metrics:['other']}),{code:'experiment_stats_frozen'});
 await assert.rejects(perform(h.engine,new RecordFlagEvent({actor:{kind:'owner',owner:owner(0)},input:{}})),{code:'forbidden'});await assert.rejects(read(h.engine,new FlagExperimentResults({actor:system,input:{experimentId:ID}})),{code:'forbidden'});
});
test('90-day conclusion expiry deletes counts at the exact boundary, including idle SQLite restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'flag-stats-')),file=join(dir,'stats.sqlite'),clock=fakeClock(start);let node=new SqliteFlagStats(file,{clock,alarms:false}),port=memoryFlagStats({clock});t.after(async()=>{await node.close();await rm(dir,{recursive:true,force:true});});
 for(const p of [node,port]){await p.configure(config);await p.record({experimentId:ID,variant:'control',kind:'exposure',owner:owner(1)});await p.configure({...config,concludedAt:start});assert.equal((await p.record({experimentId:ID,variant:'control',kind:'exposure',owner:owner(1)})).reason,'concluded');}
 clock.advance(RESULT_RETENTION_MS-1);await node.rollup();await port.rollup();assert.ok(node.db.prepare("SELECT key FROM flag_stats WHERE key LIKE '%/day/%'").all().length>0);
 await node.close();clock.advance(1);node=new SqliteFlagStats(file,{clock,alarms:false});await node.ready;await port.rollup();assert.equal(node.db.prepare("SELECT key FROM flag_stats WHERE key LIKE 'stats/%'").all().length,0);assert.equal(port.storage.dump().filter(([k])=>k.startsWith('stats/')).length,0);assert.deepEqual(await node.results({experimentId:ID}),await port.results({experimentId:ID}));assert.equal((await node.configure({...config,concludedAt:start})).reason,'expired');
});
test('real workerd SQLite DO and Node share recording, results, rollup and expiry behavior',async t=>{
 const {build}=await import('esbuild'),{Miniflare,Log,LogLevel,convertV4MiniflareOptions}=await import('miniflare'),dir=await mkdtemp(join(tmpdir(),'flag-stats-worker-')),out=join(dir,'worker.mjs'),clock=fakeClock(start),random={bytes:n=>new Uint8Array(n).fill(7)},node=new SqliteFlagStats(':memory:',{clock,random,alarms:false});let mf;t.after(async()=>{await mf?.dispose();await node.close();await rm(dir,{recursive:true,force:true});});
 const contents=`import {FlagStatsObject,createWorkerFlagStats} from './apps/worker/flag-stats.mjs';export class TestStats extends FlagStatsObject{store(shard){const s=super.store(shard);s.clock={now:()=>this.now??${start}};s.random={bytes:n=>new Uint8Array(n).fill(7)};return s;}setTime(now){this.now=now;}async rows(){return [...await this.ctx.storage.list()];}}export default {async fetch(request,env){const {method,input}=await request.json(),port=createWorkerFlagStats(env.FLAG_STATS,{clock:{now:()=>input?.now??${start}}});if(method==='time'||method==='rows'){const values=await Promise.all(Array.from({length:16},(_,i)=>{const s=env.FLAG_STATS.get(env.FLAG_STATS.idFromName('flag-stats-v1/'+i));return method==='time'?s.setTime(input.now):s.rows();}));return Response.json(values);}if(method==='records'){return Response.json(await Promise.all(input.map(v=>port.record(v))));}return Response.json(await port[method](input));}};`;
 await build({stdin:{contents,resolveDir:process.cwd()},outfile:out,bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],logLevel:'silent'});mf=new Miniflare(convertV4MiniflareOptions({name:'flag-stats-test',modulesRoot:dir,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],durableObjects:{FLAG_STATS:{className:'TestStats',useSQLite:true}},log:new Log(LogLevel.ERROR)}));
 const call=async(method,input)=>{const response=await mf.dispatchFetch('https://stats.example/',{method:'POST',body:JSON.stringify({method,input})});assert.equal(response.status,200,await response.clone().text());return response.json();};
 assert.deepEqual(await call('configure',config),await node.configure(config));const inputs=config.variants.flatMap(variant=>Array.from({length:130},(_,i)=>({experimentId:ID,variant,kind:'exposure',owner:owner(i)})));
 assert.deepEqual(await call('records',inputs),await Promise.all(inputs.map(v=>node.record(v))));const outcome=config.variants.flatMap(variant=>Array.from({length:20},(_,i)=>({experimentId:ID,variant,kind:'opened',owner:owner(i)})));await call('records',outcome);await Promise.all(outcome.map(v=>node.record(v)));assert.deepEqual(await call('results',{experimentId:ID}),await node.results({experimentId:ID}));
 clock.advance(DAY_MS);await call('time',{now:clock.now()});await call('rollup');await node.rollup();let rows=await call('rows');assert.ok(!JSON.stringify(rows).includes('"hll"'));assert.ok(!JSON.stringify(rows).includes('/key/'));assert.deepEqual(await call('results',{experimentId:ID}),await node.results({experimentId:ID}));
 const concluded={...config,concludedAt:start};await call('configure',concluded);await node.configure(concluded);clock.set(start+RESULT_RETENTION_MS);await call('time',{now:clock.now()});await call('rollup');await node.rollup();rows=await call('rows');assert.ok(rows.every(r=>r.length===0));assert.deepEqual(await call('results',{experimentId:ID}),await node.results({experimentId:ID}));
});
