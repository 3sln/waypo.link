import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createMemoryEngine,OWNER,OTHER,fakeClock,seededRandom,createRandom,MEMORY_OPERATIONS} from '../packages/app/memory-providers.mjs';
import {EDGE_OPERATIONS} from '../packages/app/edge-operations.mjs';
import {ACCOUNT_OPERATIONS} from '../packages/app/operations.mjs';
import {AppAction,AppQuery} from '../packages/app/engine.mjs';
import {PROVIDERS} from '../packages/app/providers.mjs';
import {FLAGS} from '../packages/flags/registry.mjs';
import {memoryFlagStats} from '../packages/flags/stats.mjs';
import {createScheduler,forEachSeed} from './helpers/chaos.mjs';
const beam='BEAM_ENABLED',search='SEMANTIC_SEARCH_ENABLED',activity='ACTIVITY_V2_ENABLED',names=[beam,search,activity];
const draft=()=>({id:'00000000-0000-4000-8000-000000000010',status:'draft',variants:[{key:'control',weight:5000},{key:'treatment',weight:5000}],eligibility:{percent:10000},variantSalt:'draft-salt'});
const system={kind:'system',reason:'flag-effects'};
async function fixture(options={}){
 const f=await createMemoryEngine(options),boot={kind:'boot',expect:{'boot/principal':1}},admin={kind:'admin',owner:OWNER,expect:{['principal/'+OWNER]:1}},other={kind:'admin',owner:OTHER,expect:{['principal/'+OTHER]:1}};
 await f.flagStore.commit({expect:{'boot/principal':null,['principal/'+OWNER]:null,['principal/'+OTHER]:null},writes:{'boot/principal':{active:true},['principal/'+OWNER]:{active:true},['principal/'+OTHER]:{active:true}}});
 const run=(op,input={},actor=boot,id)=>f.run('flags.'+op,{actor,input,...id!==undefined?{id}:{}});
 const prepare=async(op,name,extra={},actor=boot)=>{
  const {record,version}=await run('get',{name},actor),input={name,expectedRevision:record?.rev??null,expectedVersion:version,...extra},preview=await run('preview',{...input,action:op},actor);
  return {...input,stepUpAt:f.clock.now(),stepUpMethod:'passkey',reason:'Engine administration exercise.',typedName:name,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates};
 };
 const change=async(op,name,extra={},actor=boot)=>run(op,await prepare(op,name,extra,actor),actor);
 const edit=async(name,patch,actor=boot)=>{const {record}=await run('get',{name},actor);return change('update',name,{record:{...record,...patch}},actor);};
 return Object.assign(f,{boot,admin,other,call:run,prepare,change,edit});
}
const rejected=(operation,code)=>assert.rejects(operation,{code});

test('flag registry has every administration operation, isolated from account RPC',()=>{
 for(const [name,Operation]of Object.entries(EDGE_OPERATIONS)){assert.equal(MEMORY_OPERATIONS[name],Operation);assert.equal(ACCOUNT_OPERATIONS[name],undefined);assert(Operation.prototype instanceof (['flags.record','flags.stats-rollup','flags.seed','flags.take-control','flags.update','flags.rollback','flags.reshuffle','flags.experiment-start','flags.experiment-stop','flags.experiment-conclude'].includes(name)?AppAction:AppQuery));}
 for(const [name,placement,kind]of [['flags','both','effect'],['flagStore','edge','platform'],['flagStats','both','effect']]){assert.equal(PROVIDERS[name].placement,placement);assert.equal(PROVIDERS[name].kind,kind);}
});

test('full boot/admin flow: seed, verify, evaluate, explain, take control, edit, rollback and reshuffle',async()=>{
 const f=await fixture({config:{BEAM_ENABLED:'true'}});try{
  assert.equal((await f.call('evaluate',{name:beam,context:{subject:{kind:'anonymous'}}})).reason,'legacy-env');
  const seeded=await f.change('seed',beam);assert.equal(seeded.record.on,true);assert.equal(seeded.record.fallthrough,true);assert.equal(seeded.revision,1);
  const list=await f.call('list',{},f.admin);assert.equal(list.version,1);assert.equal(list.flags.find(r=>r.name===beam).env.state,'ignored');assert.equal(list.flags.find(r=>r.name==='BILLING_ENABLED').registry.class,'b');
  const verify=await f.call('seed-verify');assert.equal(verify.flags[beam].safeToRemove,true);assert.equal(verify.flags[beam].matches,verify.contexts);
  await rejected(f.change('seed',beam),'already_managed');assert.equal((await f.call('get',{name:beam})).record.rev,1);
  const killed=await f.edit(beam,{on:false},f.admin);assert.equal(killed.revision,2);assert.equal((await f.call('explain',{name:beam,context:{subject:{kind:'account',owner:OWNER}}},f.admin)).reason,'console-off');
  const rollback=await f.change('rollback',beam,{revision:1},f.other);assert.equal(rollback.revision,3);assert.equal(rollback.record.on,true);
  const shuffled=await f.change('reshuffle',beam,{},f.admin);assert.notEqual(shuffled.record.salt,seeded.record.salt);assert.equal(shuffled.revision,4);
  const history=await f.call('history',{},f.admin,beam);assert.deepEqual(history.entries.map(e=>e.record.rev),[4,3,2,1]);
  await f.change('take-control',search,{},f.admin);assert.equal((await f.call('get',{name:search})).record.on,false);
  assert.deepEqual(await f.flagStore.verifyAudit(),{valid:true,seq:6});assert.equal(f.events.filter(e=>e.type==='flags-changed').length,5);
  const audit=(await f.flagStore.list('audit/',{limit:100})).map(r=>r.value);assert(audit.some(e=>e.action==='flag.explain'));assert.equal(audit.find(e=>e.action==='flag.rollback').rollbackRevision,1);
 }finally{await f.dispose();}
});

test('authority is explicit; fresh passkey, principal CAS, reason, typed name and preview are enforced',async()=>{
 const f=await fixture();try{
  for(const actor of [undefined,{kind:'owner',owner:OWNER},{kind:'system'},{kind:'admin',owner:OWNER},{kind:'boot',expect:{}}])await rejected(f.call('list',{},actor??null),'actor_required');
  await rejected(f.run('flags.list'),'actor_required');
  const input=await f.prepare('seed',beam);
  for(const patch of [{stepUpAt:undefined},{stepUpAt:f.clock.now()-300000},{stepUpAt:f.clock.now()+1},{stepUpMethod:'password'}])await rejected(f.call('seed',{...input,...patch}),'step_up_required');
  await rejected(f.call('seed',{...input,reason:'short'}),'reason_required');await rejected(f.call('seed',{...input,typedName:'beam'}),'typed_name_required');await rejected(f.call('seed',{...input,previewDigest:'bad'}),'preview_stale');
  await rejected(f.call('seed',{...input,actor:f.boot}),'invalid_request');
  await rejected(f.call('seed',{...input,internalAccounts:[OWNER]}),'invalid_request');
  await rejected(f.call('seed',input,{kind:'boot',expect:{'boot/principal':2}}),'conflict');
  await rejected(f.call('seed',input,{kind:'admin',owner:OTHER,expect:{['principal/'+OTHER]:null}}),'conflict');
  await f.call('seed',{...input,stepUpAt:f.clock.now()-299999},f.admin);
  const pending=await f.prepare('update',beam,{record:{...(await f.call('get',{name:beam})).record,on:true}},f.admin);
  await f.flagStore.commit({expect:{['principal/'+OWNER]:1},writes:{['principal/'+OWNER]:{active:false}}});await rejected(f.call('update',pending,f.admin),'conflict');
  assert.equal((await f.call('get',{name:beam})).record.rev,1);
 }finally{await f.dispose();}
});

test('gate acknowledgements are exact; trusted internal targeting is exempt and stale previews refuse',async()=>{
 const f=await fixture();try{
  await f.change('take-control',beam);const record=(await f.call('get',{name:beam})).record,input=await f.prepare('update',beam,{record:{...record,on:true,fallthrough:true}});
  assert.deepEqual(input.acknowledgeGates,[...FLAGS[beam].gates].sort());
  for(const acknowledgeGates of [[],['extra'],[...input.acknowledgeGates,'extra'],[...input.acknowledgeGates,input.acknowledgeGates[0]]])await rejected(f.call('update',{...input,acknowledgeGates}),'gates_unacknowledged');
  await f.call('update',input);const entry=(await f.flagStore.list('audit/',{limit:100})).at(-1).value;assert.deepEqual(entry.acknowledgeGates,input.acknowledgeGates);assert.equal(entry.gateRevision,FLAGS[beam].gateRevision);
  await f.edit(beam,{on:false});const internal={...f.admin,internalAccounts:new Set([OWNER])},r=(await f.call('get',{name:beam})).record,pilot=await f.prepare('update',beam,{record:{...r,on:true,fallthrough:false,rules:[{when:{accounts:[OWNER]},serve:{value:true}}]}},internal);assert.deepEqual(pilot.acknowledgeGates,[]);await f.call('update',pilot,internal);
  const stale=await f.prepare('reshuffle',beam);await f.change('seed',search);await rejected(f.call('reshuffle',{...stale,expectedVersion:undefined}),'invalid_request');
  const {expectedVersion,...withoutVersion}=stale;await rejected(f.call('reshuffle',withoutVersion),'preview_stale');
 }finally{await f.dispose();}
});

test('engine edge cases: unmanaged, env-only, narrow-only, invalid rules, salt, missing revision and conflicting id',async()=>{
 const f=await fixture({config:{BEAM_ENABLED:'false'}});try{
  await rejected(f.call('get',{name:'UNKNOWN'}),'unknown_flag');await rejected(f.call('get',{name:beam},f.boot,search),'invalid_request');
  await rejected(f.call('preview',{name:beam,expectedRevision:null,action:'rollback',revision:1}),'not_managed');await rejected(f.prepare('seed','BILLING_ENABLED'),'invalid_snapshot');
  await rejected(f.call('seed-verify',{context:{subject:{kind:'account',owner:OWNER}}}),'invalid_request');await rejected(f.call('seed',null),'invalid_request');
  await f.change('seed',beam);assert.equal((await f.call('seed-verify')).flags[beam].safeToRemove,false);
  await rejected(f.call('update',{name:beam,stepUpAt:f.clock.now(),stepUpMethod:'passkey'}),'invalid_request');
  await rejected(f.edit(beam,{salt:'client-selected'}),'invalid_state');await rejected(f.edit(beam,{rules:[{when:{countries:['US']},serve:{value:true}}]}),'invalid_snapshot');
  await f.edit(beam,{on:true,fallthrough:true});assert.equal((await f.call('evaluate',{name:beam,context:{subject:{kind:'account',owner:OWNER}}})).reason,'env-kill');
  await f.change('take-control','LIFECYCLE_DRY_RUN');await rejected(f.edit('LIFECYCLE_DRY_RUN',{fallthrough:false}),'invalid_snapshot');
  await rejected(f.call('list',[]),'invalid_request');await rejected(f.change('rollback',beam,{revision:99}),'invalid_request');
 }finally{await f.dispose();}
});

test('memory flags lease pins a synchronous evaluator across concurrent commits',async()=>{
 const f=await fixture({config:{RELEASE_READY:'true'}});try{
  await f.change('seed',beam);
  await f.engine.container.use(['flags'],async({flags})=>{const ctx=flags.for({subject:{kind:'account',owner:OWNER}});assert.equal(ctx.enabled(beam),false);await f.edit(beam,{on:true,fallthrough:true});assert.equal(ctx.enabled(beam),false);assert.equal(flags.evaluate(beam,{}).value,false);});
  await f.engine.container.use(['flags'],({flags})=>{assert.equal(flags.version,2);assert.equal(flags.for({}).enabled(beam),true);});
 }finally{await f.dispose();}
});

test('experiment lifecycle, immutable assignments, aggregate results and suppression through engine operations',async()=>{
 const f=await fixture();try{
  await f.change('seed',beam);await rejected(f.change('experiment-start',beam),'invalid_state');await f.edit(beam,{on:true,experiment:draft()});
  const started=await f.change('experiment-start',beam),e=started.record.experiment;assert.equal(e.status,'running');assert.equal(started.stats.accepted,true);assert.notEqual(e.id,draft().id);assert.notEqual(e.variantSalt,draft().variantSalt);
  const context={subject:{kind:'account',owner:OWNER}},assignment=await f.call('evaluate',{name:beam,context});assert.equal(assignment.experimentId,e.id);assert.equal((await f.call('evaluate',{name:beam,context:{subject:{kind:'anonymous'}}})).experimentId,undefined);
  await f.change('seed',search);assert.deepEqual(await f.call('evaluate',{name:beam,context}),assignment);
  await rejected(f.edit(beam,{experiment:{...e,eligibility:{percent:5000}}}),'invalid_state');await rejected(f.change('reshuffle',beam),'invalid_snapshot');await rejected(f.change('experiment-conclude',beam,{winner:'control'}),'invalid_state');
  const result=()=>f.call('experiment-results',{experimentId:e.id},f.admin);assert.deepEqual(await result(),{experimentId:e.id,visible:false,reason:'minimum_cohort',variants:[]});
  for(const actor of [f.admin,{kind:'system',owner:OWNER}])await rejected(f.call('record',{experimentId:e.id,variant:'control',kind:'exposure',owner:OWNER},actor),'forbidden');
  await rejected(f.call('experiment-results',{experimentId:e.id,owner:OWNER}),'invalid_results_filter');await rejected(f.call('experiment-results',{experimentId:e.id},{kind:'owner',owner:OWNER}),'actor_required');
  for(const [variant,offset]of [['control',0],['treatment',1000]])for(let i=0;i<150;i++){
   const owner=`00000000-0000-4000-8000-${String(offset+i+100).padStart(12,'0')}`;assert.equal((await f.call('record',{experimentId:e.id,variant,kind:'exposure',owner},system)).accepted,true);
   if(i<(variant==='control'?25:10))await f.call('record',{experimentId:e.id,variant,kind:'beam_completed',owner},system);
  }
  const visible=await result();assert.equal(visible.visible,true);assert.equal(visible.variants[0].daily[0].outcomes.beam_completed,25);assert.equal(visible.variants[1].daily[0].outcomes.beam_completed,'<20');assert.equal(visible.variants[1].daily[0].rates.beam_completed,null);
  assert(!JSON.stringify(f.audit.entries).includes('00000000-0000-4000-8000-000000001100'));assert(f.audit.entries.filter(e=>e.operation==='flags.record').every(e=>!Object.hasOwn(e.actor,'owner')&&(e.outcome!=='ok'||e.actor.kind==='system')));
  await rejected(f.call('record',{experimentId:e.id,variant:'control',kind:'client_metric',owner:OWNER},system),'invalid_flag_stats');
  await f.change('experiment-stop',beam);assert.equal((await f.call('evaluate',{name:beam,context})).experimentId,undefined);assert.deepEqual(await f.call('record',{experimentId:e.id,variant:'control',kind:'exposure',owner:OWNER},system),{accepted:false,reason:'stopped'});
  await rejected(f.change('experiment-conclude',beam,{winner:'absent'}),'invalid_state');const concluded=await f.change('experiment-conclude',beam,{winner:'treatment'});assert.equal(concluded.record.experiment.status,'concluded');assert.equal(concluded.record.fallthrough,false);assert.equal((await result()).visible,true);
  f.clock.advance(90*86400000);assert.deepEqual(await result(),{experimentId:e.id,visible:false,reason:'expired',variants:[]});assert.equal((await f.call('stats-rollup',{},system)).rolledUp,0);
 }finally{await f.dispose();}
});

test('counter setup failure preserves committed lifecycle and is repaired from trusted metadata',async()=>{
 const clock=fakeClock(),stats=memoryFlagStats({clock,random:seededRandom(createRandom(12))});let fail=false;
 const port={...stats,async configure(input){if(fail){fail=false;throw new Error('counter unavailable');}return stats.configure(input);}};
 const f=await fixture({clock,providers:{flagStats:port}});try{
  await f.change('seed',beam);await f.edit(beam,{on:true,experiment:draft()});fail=true;const start=await f.change('experiment-start',beam);assert.deepEqual(start.stats,{accepted:false,reason:'unavailable'});assert.equal((await f.call('get',{name:beam})).record.experiment.status,'running');
  const e=start.record.experiment;assert.equal((await f.call('record',{experimentId:e.id,variant:'control',kind:'exposure',owner:OWNER},system)).accepted,true);
  await f.change('experiment-stop',beam);fail=true;const end=await f.change('experiment-conclude',beam,{winner:'control'});assert.equal(end.stats.accepted,false);assert.equal((await f.call('experiment-results',{experimentId:e.id})).visible,false);
  assert.equal((await stats.record({experimentId:e.id,variant:'control',kind:'exposure',owner:OWNER})).reason,'concluded');
 }finally{await f.dispose();}
});

test('seeded concurrent admin operations preserve committed snapshot prefixes, CAS and complete hash-chained history',async()=>{
 await forEachSeed(12,async random=>{
  const scheduler=createScheduler(random),snapshots=[],commits=[];
  const f=await fixture({seed:random.seed,config:{RELEASE_READY:'true'},wrap:{flagStore:store=>scheduler.wrap({get:key=>store.get(key),list:(...args)=>store.list(...args),verifyAudit:()=>store.verifyAudit(),flagsSnapshot:async()=>{const s=await store.flagsSnapshot();snapshots.push(structuredClone(s));return s;},commit:async input=>{const r=await store.commit(input);if(r.committed&&r.audit)commits.push(r.audit);return r;}},'flagStore')}});
  const retry=async operation=>{for(let n=0;;n++)try{return await operation();}catch(error){if(!['conflict','preview_stale'].includes(error.code)||n>=30)throw error;}};
  try{
   for(const name of names)await f.change('seed',name);
   const inputs=await Promise.all([beam,beam,search,activity].map(async(name,i)=>f.prepare('update',name,{record:{...(await f.call('get',{name})).record,on:true,fallthrough:Boolean(i%2)}},i%2?f.admin:f.other)));
   const outcomes=await scheduler.run([...inputs.map((input,i)=>()=>f.call('update',input,i%2?f.admin:f.other)),()=>f.call('list')]);assert.equal(outcomes.slice(0,4).filter(r=>r.status==='fulfilled').length,1);assert(outcomes.slice(0,4).filter(r=>r.status==='rejected').every(r=>r.reason.code==='conflict'));
   const settled=await scheduler.run([...Array.from({length:6},(_,i)=>()=>retry(()=>f.edit(names[i%3],{on:Boolean(i%2),fallthrough:Boolean((i+1)%2)},i%2?f.admin:f.other))),()=>f.call('list'),()=>f.call('list')]);assert(settled.every(r=>r.status==='fulfilled'),settled.filter(r=>r.status==='rejected').map(r=>r.reason.code).join());
   const audit=(await f.flagStore.list('audit/',{limit:100})).map(r=>r.value),prefix=new Map([[0,{}]]),state={};assert.deepEqual(await f.flagStore.verifyAudit(),{valid:true,seq:audit.length});assert.equal(commits.length,audit.length);
   for(const [i,entry]of audit.entries()){assert.equal(entry.version,i+1);assert.deepEqual(entry.before,state[entry.target]??null);state[entry.target]=entry.after;prefix.set(entry.version,structuredClone(state));}
   for(const [i,s]of snapshots.entries()){assert.deepEqual(s.flags,prefix.get(s.version));if(i)assert(s.version>=snapshots[i-1].version);}
   for(const name of names)assert.deepEqual((await f.call('history',{name})).entries.map(e=>e.record),audit.filter(e=>e.target===name).map(e=>e.after).reverse());
  }finally{await f.dispose();}
 });
});

test('CLI REPL runs the whole explicit-actor flag administration flow over memory',()=>{
 const source=`await (async()=>{
  const boot={kind:'boot',expect:{'boot/principal':null}},call=(op,input={})=>run('flags.'+op,{actor:boot,input}),name='BEAM_ENABLED';
  const change=async(op,extra={})=>{const current=await call('get',{name}),input={name,expectedRevision:current.record?.rev??null,...extra},preview=await call('preview',{...input,action:op});return call(op,{...input,stepUpAt:clock.now(),stepUpMethod:'passkey',reason:'CLI administration exercise.',typedName:name,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates});};
  await change('seed');await call('seed-verify');const first=(await call('get',{name})).record;
  await change('update',{record:{...first,on:true,experiment:${JSON.stringify(draft())}}});
  const start=await change('experiment-start'),experimentId=start.record.experiment.id;
  await run('flags.record',{actor:{kind:'system'},input:{experimentId,variant:'control',kind:'exposure',owner:OWNER}});
  const results=await call('experiment-results',{experimentId});await call('evaluate',{name,context:{subject:{kind:'anonymous'}}});await call('explain',{name,context:{subject:{kind:'account',owner:OWNER}}});
  await change('experiment-stop');await change('experiment-conclude',{winner:'control'});await change('rollback',{revision:1});await change('reshuffle');
  const input={name:'SEMANTIC_SEARCH_ENABLED',expectedRevision:null},preview=await call('preview',{...input,action:'take-control'});await call('take-control',{...input,stepUpAt:clock.now(),stepUpMethod:'passkey',reason:'CLI administration exercise.',typedName:input.name,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates});
  const history=await call('history',{name}),list=await call('list');console.log(JSON.stringify({ff3:true,revisions:history.entries.length,version:list.version,visible:results.visible}));
 })()\n.exit\n`;
 const result=spawnSync(process.execPath,['--no-warnings','scripts/engine.mjs','--repl'],{input:source,encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);assert(result.stdout.includes('{"ff3":true,"revisions":7,"version":8,"visible":false}'),result.stdout+result.stderr);
 const listed=spawnSync(process.execPath,['--no-warnings','scripts/engine.mjs','--list'],{encoding:'utf8'});assert.equal(listed.status,0,listed.stderr);for(const name of Object.keys(EDGE_OPERATIONS))assert(listed.stdout.includes('"operation":"'+name+'"'));
});
