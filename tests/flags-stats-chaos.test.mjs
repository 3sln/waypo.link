import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/index.js';
import {perform,read} from '../packages/app/engine.mjs';
import {auditTrail,memoryAudit} from '../packages/app/providers.mjs';
import {seededRandom} from '../packages/app/memory-providers.mjs';
import {memoryFlagStats,FlagStatsStore,memoryStatsStorage,FLAG_STATS_SHARDS,flagStatsShard} from '../packages/flags/stats.mjs';
import {RecordFlagEvent,FlagExperimentResults,RollupFlagStats,experimentResults,DAY_MS} from '../packages/flags/experiments.mjs';
import {createHll,addHll} from '../packages/flags/hll.mjs';
import {SqliteFlagStats} from '../apps/node/flag-stats.mjs';
import {forEachSeed,createScheduler,injectFaults,fakeClock} from './helpers/chaos.mjs';
const ID='22222222-2222-4222-8222-222222222222',owner=n=>`bbbbbbbb-bbbb-4bbb-8bbb-${n.toString(16).padStart(12,'0')}`,config={experimentId:ID,variants:['control','treatment'],metrics:['opened']},start=Date.UTC(2026,9,21,23,59),system={kind:'system',reason:'experiment-counter'};
function harness(port,clock){const audit=memoryAudit({clock}),engine=new Engine({providers:{flagStats:Provider.fromSingleton(port),audit:Provider.fromSingleton(audit)},interceptors:[auditTrail]});return {audit,engine,record:input=>perform(engine,new RecordFlagEvent({actor:system,input})),results:()=>read(engine,new FlagExperimentResults({actor:{kind:'admin'},input:{experimentId:ID}})),rollup:()=>perform(engine,new RollupFlagStats({actor:system}))};}
const events=storage=>storage.dump().filter(([k])=>k.includes('/day/')).flatMap(([,row])=>row.cells).reduce((n,c)=>n+Object.values(c.events).reduce((n,v)=>n+v,0),0);
test('seeded engine chaos: increments, duplicate/dropped delivery and concurrent UTC rollup never over-count or resurrect keys',async()=>{
 await forEachSeed(8,async random=>{
  const clock=fakeClock(start),port=memoryFlagStats({clock,random:seededRandom(random)}),scheduler=createScheduler(random);await port.configure(config);
  const faults=injectFaults(port,[{method:'record',when:.12,mode:'timeout'},{method:'record',when:.5,mode:'duplicate'}],{random}),resource={...faults,record:input=>faults.record(input),rollup:()=>{clock.set(start+DAY_MS);return port.rollup();}},h=harness(scheduler.wrap(resource,'flagStats'),clock);
  try{
   const inputs=Array.from({length:50},(_,i)=>({experimentId:ID,variant:random.pick(config.variants),kind:random.pick(['exposure','opened']),owner:owner(random.int(20)),day:'2026-10-21',delivery:{lane:i%3,sequence:i+1}})),tasks=inputs.map(input=>()=>h.record(input));tasks.splice(random.int(tasks.length),0,()=>h.rollup());const settled=await scheduler.run(tasks);
   assert.ok(settled.every(r=>r.status==='fulfilled'||r.reason.code==='timeout'));await h.rollup();const encoded=JSON.stringify(port.storage.dump());assert.ok(events(port.storage)<=inputs.length);assert.ok(!encoded.includes('"hll"'));assert.ok(!encoded.includes('/key/'));assert.ok(!encoded.includes('watermarks'));assert.ok(!encoded.includes('"owner"'));assert.ok(!JSON.stringify(h.audit.entries).includes('bbbbbbbb-'));
   const count=events(port.storage);for(const input of inputs)assert.equal((await port.record(input)).reason,'day_closed');assert.equal(events(port.storage),count);
   // New-day accounts may reuse the same producer sequence after old watermarks
   // are discarded. Replays count once, exposures and outcomes stay separate.
   const current={...inputs[0],day:'2026-10-22',kind:'exposure',delivery:{lane:0,sequence:1}};assert.equal((await port.record(current)).accepted,true);assert.equal((await port.record(current)).reason,'duplicate');assert.equal((await port.record({...current,kind:'opened'})).accepted,true);assert.equal(events(port.storage),count+2);assert.ok(scheduler.trace.some(s=>s.includes('rollup')));
  }finally{await h.engine.dispose();}
 });
});
test('seeded shard merge is order-independent and duplicate snapshots do not double counts, live or rolled up',async()=>{
 await forEachSeed(12,async random=>{
  const snapshots=Array.from({length:FLAG_STATS_SHARDS},(_,shard)=>({experimentId:ID,shard,config:{...config,concludedAt:null},days:[{day:'2026-10-21',cells:config.variants.map(variant=>{const hll=createHll();for(let n=0;n<40;n++)addHll(hll,Uint8Array.from({length:8},()=>random.int(256)));return {variant,events:{exposure:50,opened:20},hll};})}]}));
  for(const mode of ['live','rolled','mixed']){const parts=structuredClone(snapshots);if(mode!=='live')for(const part of parts)if(mode==='rolled'||part.shard%2)for(const cell of part.days[0].cells){delete cell.hll;cell.distinct=40;}
   const options={experimentId:ID,now:start,shardCount:FLAG_STATS_SHARDS},expected=experimentResults(parts,options);assert.equal(expected.visible,true);assert.equal(expected.variants[0].totals.exposures,800);assert.equal(expected.variants[0].totals.outcomes.opened,320);assert.deepEqual(experimentResults(random.shuffle([...parts,parts[0],parts[7]]),options),expected);assert.equal(experimentResults(parts.slice(1),options).reason,'incomplete');
   const conflict=structuredClone(parts[0]);conflict.days[0].cells[0].events.exposure++;assert.throws(()=>experimentResults([...parts,conflict],options),{code:'conflicting_stats_shard'});
  }
 });
});
test('seeded concurrent engine deliveries and watermarks have SQLite/memory parity before and after rollup',async()=>{
 await forEachSeed(5,async random=>{
  const clock=fakeClock(start),bytes={bytes:n=>new Uint8Array(n).fill(13)},memory=memoryFlagStats({clock,random:bytes}),node=new SqliteFlagStats(':memory:',{clock,random:bytes,alarms:false});await Promise.all([memory.configure(config),node.configure(config)]);const a=harness(memory,clock),b=harness(node,clock);
  try{
   const plan=random.shuffle(Array.from({length:65},(_,i)=>({experimentId:ID,variant:random.pick(config.variants),kind:random.pick(['exposure','opened']),owner:owner(random.int(20)),delivery:{lane:i%2,sequence:i+1}}))).filter(()=>random.chance(.85));const deliveries=random.shuffle([...plan,...random.shuffle(plan).slice(0,25)]);
   await Promise.all(deliveries.map(input=>Promise.all([a.record(input),b.record(input)])));assert.ok(events(memory.storage)<=plan.length);assert.deepEqual(await a.results(),await b.results());
   const sorted=rows=>rows.sort(([a],[b])=>a.localeCompare(b));assert.deepEqual(sorted(node.db.prepare('SELECT key,value FROM flag_stats').all().map(r=>[r.key,JSON.parse(r.value)])),sorted(memory.storage.dump()));
   clock.advance(DAY_MS);await Promise.all([a.rollup(),b.rollup()]);assert.deepEqual(sorted(node.db.prepare('SELECT key,value FROM flag_stats').all().map(r=>[r.key,JSON.parse(r.value)])),sorted(memory.storage.dump()));assert.deepEqual(await a.results(),await b.results());
  }finally{await a.engine.dispose();await b.engine.dispose();await node.close();}
 });
});
test('atomic failure rolls back both daily key creation and count; input mutation cannot change queued shard/account',async()=>{
 const clock=fakeClock(start),storage=memoryStatsStorage(),input={experimentId:ID,variant:'control',kind:'exposure',owner:owner(1),delivery:{lane:1,sequence:1}},shard=flagStatsShard(input),base=new FlagStatsStore({storage,shard,clock});await base.configure(config);
 const broken={transaction:fn=>storage.transaction(tx=>fn({...tx,put:async(k,v)=>{await tx.put(k,v);if(k.includes('/day/'))throw Object.assign(new Error('Injected write failure.'),{code:'injected_fault'});}}))},store=new FlagStatsStore({storage:broken,shard,clock});await assert.rejects(store.record(input),{code:'injected_fault'});assert.ok(!JSON.stringify(storage.dump()).includes('/key/'));assert.equal(events(storage),0);
 const pending=base.record(input);input.owner=owner(2);input.variant='treatment';input.delivery.sequence=99;assert.equal((await pending).accepted,true);assert.equal((await base.record({experimentId:ID,variant:'control',kind:'exposure',owner:owner(1),delivery:{lane:1,sequence:1}})).reason,'duplicate');assert.equal(events(storage),1);
});
test('seeded rollover during an in-flight write commits the old increment then erases its key and sketch',async()=>{
 await forEachSeed(4,async random=>{
  const clock=fakeClock(start),base=memoryStatsStorage();let entered,release,held=true;const writing=new Promise(r=>{entered=r;}),resume=new Promise(r=>{release=r;}),storage={...base,transaction:fn=>base.transaction(tx=>fn({...tx,put:async(k,v)=>{await tx.put(k,v);if(held&&k.includes('/key/')){held=false;entered();await resume;}}}))},port=memoryFlagStats({clock,storage,random:seededRandom(random)}),h=harness(port,clock);await port.configure(config);
  try{const input={experimentId:ID,variant:random.pick(config.variants),kind:'exposure',owner:owner(random.int(100))},recording=h.record(input);await writing;clock.advance(DAY_MS);const rolling=h.rollup();release();assert.equal((await recording).accepted,true);await rolling;assert.equal(events(base),1);const rows=JSON.stringify(base.dump());assert.ok(!rows.includes('/key/'));assert.ok(!rows.includes('"hll"'));assert.ok(!rows.includes(input.owner));assert.equal((await h.record({...input,day:'2026-10-21'})).reason,'day_closed');}finally{release();await h.engine.dispose();}
 });
});
