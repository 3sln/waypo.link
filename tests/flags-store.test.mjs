import test from 'node:test';import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/index.js';
import {AppAction,AppQuery,perform,read} from '../packages/app/engine.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {AdminStorage,remoteAdminStore} from '../packages/identity/admin-store.mjs';
import {FlagService,seedContexts} from '../packages/flags/service.mjs';
import {FLAGS} from '../packages/flags/registry.mjs';
import {evaluate} from '../packages/flags/evaluate.mjs';
import {fakeClock,createRandom,injectFaults} from './helpers/chaos.mjs';
// FF-3 owns the public operations. These thin ngin operations exercise this
// provider through Actions/Queries without editing its domain/catalogue files.
class FlagAction extends AppAction {static deps=['flags'];run({flags}){return flags[this.input.method](this.input.value,this.actor);}}
class FlagQuery extends AppQuery {static deps=['flags'];fetch({flags}){return flags[this.input.method](this.input.value,this.actor);}}
const start=1792000000000,beam='BEAM_ENABLED',search='SEMANTIC_SEARCH_ENABLED',activity='ACTIVITY_V2_ENABLED';
const owner='00000000-0000-4000-8000-000000000099';
function fixture({env={},faults=[],onCommit}={}){
 const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw),clock=fakeClock(start),random=createRandom(17),store=injectFaults(storage,faults),flags=new FlagService({store,env,clock:clock.now,randomId:()=>`00000000-0000-4000-8000-${String(random.int(1e9)).padStart(12,'0')}`,onCommit}),engine=new Engine({providers:{flags:Provider.fromSingleton(flags)}});
 const context={actor:{kind:'boot',expect:{'boot/principal':null},audit:{kind:'boot',session:'verified'}},stepUpAt:start,stepUpMethod:'passkey'},admin={...context,actor:{kind:'admin',owner,expect:{['principal/'+owner]:null,catalog:null}}};
 const query=(method,value={},ctx=context)=>read(engine,new FlagQuery({actor:ctx,input:{method,value}})),action=(method,value,ctx=context)=>perform(engine,new FlagAction({actor:ctx,input:{method,value}}));
 const change=async(method,name,extra={},ctx=context)=>{const current=await query('get',{name},ctx),input={name,expectedRevision:current.record?.rev??null,expectedVersion:current.version,...extra},preview=await query('preview',{...input,action:method.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())},ctx);return action(method,{...input,reason:'Controlled local flag test.',typedName:name,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates},ctx);};
 return {raw,storage,store,flags,clock,context,admin,query,action,change,close:()=>raw.close()};
}
const draft=()=>({id:'00000000-0000-4000-8000-000000000010',status:'draft',variants:[{key:'control',weight:5000},{key:'treatment',weight:5000}],eligibility:{percent:10000},variantSalt:'draft-salt'});
async function edit(f,name,patch={},ctx=f.context){const {record}=await f.query('get',{name},ctx);return f.change('update',name,{record:{...record,...patch}},ctx);}
async function audit(f){return (await f.storage.list('audit/',{limit:100})).map(row=>row.value);}

test('AdminStorage permits only bounded flag keys and exposes an atomic, detached snapshot through RPC',async()=>{
 const f=fixture();try{
  assert.deepEqual(await f.storage.flagsSnapshot(),{v:1,version:0,issuedAt:0,flags:{}});
  for(const key of ['flag/../boot','flag/beam','flag-rev/BEAM_ENABLED/0','flag-rev/BEAM_ENABLED/1/2','flags-head/x'])await assert.rejects(f.storage.get(key),TypeError);
  await f.change('seed',beam);const remote=remoteAdminStore((method,args)=>f.storage.invoke(method,args)),snap=await remote.flagsSnapshot();assert.equal(snap.version,1);assert.equal(snap.issuedAt,start);assert.equal(snap.flags[beam].rev,1);assert.equal(snap.flags[beam].revision,undefined);
  snap.flags[beam].on=true;assert.equal((await remote.flagsSnapshot()).flags[beam].on,false);assert.equal((await f.storage.get('flags-head')).revision,1);
 }finally{f.close();}
});

test('seed consumes server env only, is effect-idempotent and verifies the full cutover context matrix',async()=>{
 const f=fixture({env:{BEAM_ENABLED:'true',SEMANTIC_SEARCH_ENABLED:'false',ACTIVITY_V2_ENABLED:'garbage',LIFECYCLE_DRY_RUN:'true'}});try{
  await assert.rejects(f.action('seed',{name:beam,expectedRevision:null,env:{BEAM_ENABLED:'false'}},f.context),{code:'invalid_request'});
  for(const name of [beam,search,activity,'LIFECYCLE_DRY_RUN'])await f.change('seed',name);
  assert.equal((await f.query('get',{name:beam})).record.fallthrough,true);assert.equal((await f.query('get',{name:search})).record.on,false);
  const head=await f.storage.get('audit-head');await assert.rejects(f.action('seed',{name:beam,expectedRevision:1},f.context),{code:'already_managed'});assert.deepEqual(await f.storage.get('audit-head'),head);
  const result=await f.query('seedVerify');assert.equal(result.contexts,seedContexts(start).length);assert.equal(result.flags[beam].safeToRemove,true);assert.equal(result.flags[beam].envState,'ignored');assert.equal(result.flags[search].safeToRemove,false);assert.equal(result.flags[activity].safeToRemove,false);assert.equal(result.flags.SIGNUP_ENABLED.safeToRemove,false);assert.equal(result.flags.LIFECYCLE_DRY_RUN.safeToRemove,false);
  const snapshot=await f.flags.snapshot();for(const ctx of seedContexts(start))assert.equal(evaluate(beam,ctx,snapshot,{}).value,true);
  await edit(f,beam,{fallthrough:false});assert.equal((await f.query('seedVerify')).flags[beam].safeToRemove,false);
  assert((await audit(f)).filter(row=>row.action==='flag.seed').every(row=>row.acknowledgeGates.length===0));
 }finally{f.close();}
});

test('live lifecycle env refuses a behaviour-changing seed; explicit take-control can pause it',async()=>{
 const f=fixture({env:{LIFECYCLE_DRY_RUN:'false'}});try{await assert.rejects(f.change('seed','LIFECYCLE_DRY_RUN'),{code:'seed_mismatch'});assert.equal((await f.flags.snapshot()).version,0);await f.change('takeControl','LIFECYCLE_DRY_RUN');assert.equal((await f.query('evaluate',{name:'LIFECYCLE_DRY_RUN',context:{}})).value,true);}finally{f.close();}
});

test('boot and admin require explicit verified principal expectations and fresh passkey step-up',async()=>{
 const f=fixture({env:{RELEASE_READY:'true'}});try{
  const input={name:beam,expectedRevision:null};for(const ctx of [{},{...f.context,actor:'boot'},{...f.context,actor:{kind:'owner',owner}},{...f.context,actor:{kind:'boot',expect:{}}}])await assert.rejects(f.action('seed',input,ctx),{code:'actor_required'});
  for(const patch of [{stepUpAt:start-300000},{stepUpAt:start+1},{stepUpAt:undefined},{stepUpMethod:'password'}])await assert.rejects(f.action('seed',input,{...f.context,...patch}),{code:'step_up_required'});
  await f.change('takeControl',beam,{},f.admin);assert.equal((await audit(f))[0].actor.kind,'admin');
  // Revocation after adapter verification cannot race through the commit.
  const claim='claim/00000000-0000-4000-8000-000000000022',provenance={...f.admin,actor:{...f.admin.actor,expect:{...f.admin.actor.expect,[claim]:null}}};await f.storage.commit({writes:{[claim]:{state:'revoked'}}});await assert.rejects(edit(f,beam,{on:true},provenance),{code:'conflict'});
  await f.storage.commit({writes:{['principal/'+owner]:{roles:[]}}});await assert.rejects(edit(f,beam,{on:true},f.admin),{code:'conflict'});
 }finally{f.close();}
});

test('gate widening uses exact sets, critical reason/name/digest and records the registry revision',async()=>{
 const f=fixture();try{
  await f.change('seed',beam);const {record,version}=await f.query('get',{name:beam}),input={name:beam,expectedRevision:record.rev,expectedVersion:version,record:{...record,on:true,fallthrough:true}},preview=await f.query('preview',input),confirmed={...input,reason:'Enable a reviewed rollout.',typedName:beam,previewDigest:preview.digest};
  assert.equal(preview.critical,true);assert.equal(preview.widens,true);assert.deepEqual(preview.requiredGates,[...FLAGS[beam].gates].sort());
  await assert.rejects(f.action('update',input),{code:'reason_required'});await assert.rejects(f.action('update',{...confirmed,reason:'short'}),{code:'reason_required'});await assert.rejects(f.action('update',{...confirmed,typedName:search}),{code:'typed_name_required'});await assert.rejects(f.action('update',{...confirmed,previewDigest:'stale'}),{code:'preview_stale'});
  for(const acknowledgeGates of [undefined,[],preview.requiredGates.slice(1),[...preview.requiredGates,'extra'],[...preview.requiredGates,preview.requiredGates[0]]])await assert.rejects(f.action('update',{...confirmed,acknowledgeGates}),{code:'gates_unacknowledged'});
  await f.action('update',{...confirmed,acknowledgeGates:[...preview.requiredGates].reverse()});const entry=(await audit(f)).at(-1);assert.equal(entry.action,'flag.update');assert.equal(entry.gateRevision,FLAGS[beam].gateRevision);assert.equal(entry.reason,confirmed.reason);assert.equal(entry.typedName,beam);assert.deepEqual(entry.before,record);assert.deepEqual(entry.after,{...input.record,rev:2});
  assert.equal((await f.storage.verifyAudit()).valid,true);
 }finally{f.close();}
});

test('internal-only exemptions require server provenance; release-ready removes open gate requirements',async()=>{
 const f=fixture();try{
  await f.change('seed',beam);const {record}=await f.query('get',{name:beam}),input={name:beam,expectedRevision:1,record:{...record,on:true,rules:[{when:{accounts:[owner]},serve:{value:true}}]}};
  assert((await f.query('preview',input)).requiredGates.length>0);const trusted={...f.context,internalAccounts:new Set([owner])},preview=await f.query('preview',input,trusted);assert.equal(preview.requiredGates.length,0);assert.equal(preview.critical,true);await f.action('update',{...input,reason:'Verified internal pilot.',typedName:beam,previewDigest:preview.digest},trusted);
  f.flags.env.RELEASE_READY='true';const next=await f.query('preview',{...input,expectedRevision:2,record:{...(await f.query('get',{name:beam})).record,fallthrough:true}});assert.equal(next.critical,false);assert.deepEqual(next.requiredGates,[]);
 }finally{f.close();}
});

test('preview binds snapshot version, env, dependencies and exact impact fractions',async()=>{
 const f=fixture();try{
  await f.change('seed',beam);const {record}=await f.query('get',{name:beam}),input={name:beam,expectedRevision:1,record:{...record,on:true,rules:[{when:{shards:[0,'00',1]},serve:{value:true,percent:1250}}]}},preview=await f.query('preview',input);
  assert.deepEqual(preview.impact.rules[0].percent,{numerator:1250,denominator:10000});assert.deepEqual(preview.impact.rules[0].shards,{numerator:2,denominator:64});f.clock.advance(1000);assert.equal((await f.query('preview',input)).digest,preview.digest);
  f.flags.env.BEAM_ENABLED='false';await assert.rejects(f.action('update',{...input,reason:'Controlled rollout preview.',typedName:beam,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates}),{code:'preview_stale'});delete f.flags.env.BEAM_ENABLED;
  await f.change('seed',search);await assert.rejects(f.action('update',{...input,reason:'Controlled rollout preview.',typedName:beam,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates}),{code:'preview_stale'});
  await assert.rejects(f.action('update',{...input,expectedVersion:1}),{code:'conflict'});
 }finally{f.close();}
});

test('validator rejects class b, narrow-only, dimensions, list limits and invalid experiments server-side',async()=>{
 const f=fixture();try{
  await assert.rejects(f.change('seed','BILLING_ENABLED'),{code:'invalid_snapshot'});await f.change('seed','LIFECYCLE_DRY_RUN');await assert.rejects(edit(f,'LIFECYCLE_DRY_RUN',{fallthrough:false}),{code:'invalid_snapshot'});await f.change('seed',beam);
  for(const patch of [{rules:[{when:{countries:['US']},serve:{value:true}}]},{rules:Array.from({length:33},()=>({when:{},serve:{value:true}}))},{deny:{accounts:[],clients:['x']}},{experiment:{...draft(),variants:[{key:'a',weight:2},{key:'b',weight:2}]}}])await assert.rejects(edit(f,beam,patch),{code:'invalid_snapshot'});
  await assert.rejects(edit(f,beam,{salt:'silent reshuffle'}),{code:'invalid_state'});
  const accounts=Array.from({length:1001},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);await assert.rejects(edit(f,beam,{deny:{accounts,clients:[]}}),{code:'invalid_snapshot'});
  await f.change('seed',activity);await assert.rejects(edit(f,activity,{deny:{accounts:[],clients:Array.from({length:1000},(_,i)=>'x'.repeat(300)+i)}}),{code:'invalid_snapshot'});
 }finally{f.close();}
});

test('flag commits share the existing audit and compare principal, dependency and head revisions',async()=>{
 const f=fixture();try{
  await f.storage.commit({audit:{at:start,actor:{kind:'boot'},action:'existing.admin-action'}});let captured;f.flags.store={get:key=>f.storage.get(key),flagsSnapshot:()=>f.storage.flagsSnapshot(),commit:input=>{captured=input;return f.storage.commit(input);}};
  await f.change('seed','INCREMENTAL_AUTH_ENABLED');assert.deepEqual(captured.expect,{'boot/principal':null,'flag/INCREMENTAL_AUTH_ENABLED':null,'flags-head':null,'flag/FEDERATION_ENABLED':null});assert.equal(captured.audit.version,1);assert.equal((await f.storage.get('flag/INCREMENTAL_AUTH_ENABLED')).revision,1);assert.equal((await f.storage.verifyAudit()).seq,2);
  await f.change('seed','FEDERATION_ENABLED');assert.equal(captured.expect['flags-head'],1);assert.equal((await f.flags.snapshot()).version,2);assert.equal((await f.storage.verifyAudit()).valid,true);
 }finally{f.close();}
});

test('rollback is a new version; history retains exactly 100 revisions and reshuffle is separate critical authority',async()=>{
 let invalidated;const f=fixture({env:{RELEASE_READY:'true'},onCommit:s=>{invalidated=s;}});try{
  await f.change('seed',beam);await edit(f,beam,{on:true,fallthrough:true});await f.change('rollback',beam,{revision:1});assert.equal(invalidated.version,3);assert.equal(invalidated.flags[beam].on,false);assert.equal((await f.query('get',{name:beam})).record.rev,3);
  const salt=invalidated.flags[beam].salt;await f.change('reshuffle',beam);assert.notEqual(invalidated.flags[beam].salt,salt);
  for(let i=0;i<100;i++){f.clock.advance(2000);f.context.stepUpAt=f.clock.now();await edit(f,beam,{on:Boolean(i%2)});}
  const history=await f.query('history',{name:beam});assert.equal(history.entries.length,100);assert.equal(history.entries[0].record.rev,104);assert.equal(history.entries.at(-1).record.rev,5);assert.equal(await f.storage.get(`flag-rev/${beam}/4`),null);await assert.rejects(f.change('rollback',beam,{revision:1}),{code:'revision_unavailable'});assert.equal((await f.storage.verifyAudit()).valid,true);
 }finally{f.close();}
});

test('experiments mint new cohorts on start, freeze assignments, stop and conclude without applying winners',async()=>{
 const f=fixture();try{
  await f.change('seed',beam);await edit(f,beam,{on:true,experiment:draft()});const old=(await f.query('get',{name:beam})).record.experiment;await f.change('experimentStart',beam);let {record}=await f.query('get',{name:beam});assert.notEqual(record.experiment.id,old.id);assert.notEqual(record.experiment.variantSalt,old.variantSalt);assert.equal(record.experiment.startedAt,start);
  await assert.rejects(edit(f,beam,{experiment:{...record.experiment,eligibility:{percent:1}}}),{code:'invalid_state'});await assert.rejects(f.change('reshuffle',beam),{code:'invalid_snapshot'});await assert.rejects(f.change('experimentConclude',beam,{winner:'control'}),{code:'invalid_state'});await assert.rejects(f.change('rollback',beam,{revision:2}),{code:'invalid_snapshot'});
  await edit(f,beam,{on:false});await f.change('rollback',beam,{revision:3});assert.deepEqual((await f.query('get',{name:beam})).record.experiment,record.experiment);
  await f.change('experimentStop',beam);await assert.rejects(f.change('experimentStart',beam),{code:'invalid_state'});await assert.rejects(f.change('experimentConclude',beam,{winner:'missing'}),{code:'invalid_state'});await f.change('experimentConclude',beam,{winner:'treatment'});record=(await f.query('get',{name:beam})).record;assert.equal(record.experiment.status,'concluded');assert.equal(record.fallthrough,false);assert.equal((await f.storage.get('flag-experiment/'+record.experiment.id)).experiment.winner,'treatment');
  await edit(f,beam,{experiment:draft()});await f.change('experimentStart',beam);assert.notEqual((await f.query('get',{name:beam})).record.experiment.id,record.experiment.id);await f.change('experimentStop',beam);await assert.rejects(f.change('rollback',beam,{revision:3}),{code:'invalid_state'});
 }finally{f.close();}
});

test('all three eligible experiments can run together; running experiments cannot start again',async()=>{
 const f=fixture();try{for(const name of [beam,search,activity]){await f.change('seed',name);await edit(f,name,{on:true,experiment:draft()});await f.change('experimentStart',name);}assert.equal(Object.values((await f.flags.snapshot()).flags).filter(r=>r.experiment?.status==='running').length,3);
  // The current registry has exactly three eligible flags, so a valid fourth
  // experiment is unrepresentable. The service also checks the host-wide cap.
  await assert.rejects(f.change('experimentStart',beam),{code:'invalid_state'});
 }finally{f.close();}
});

test('commit faults roll back history, snapshot, rate and audit; lost replies cannot duplicate writes',async()=>{
 let armed=false;const f=fixture({faults:[{method:'commit',mode:'after',when:()=>armed&&!(armed=false)}]});try{await f.change('seed',beam);const {record}=await f.query('get',{name:beam}),input={name:beam,expectedRevision:1,record:{...record,on:true}},preview=await f.query('preview',input),confirmed={...input,reason:'Fault injection rollout.',typedName:beam,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates};armed=true;await assert.rejects(f.action('update',confirmed),{code:'injected_fault'});await assert.rejects(f.action('update',confirmed),{code:'conflict'});assert.equal((await f.flags.snapshot()).version,2);assert.equal((await f.query('history',{name:beam})).entries.length,2);assert.equal((await f.storage.verifyAudit()).valid,true);
  const head=await f.storage.get('audit-head'),rate=await f.raw.get('admin/rate/boot'),raw=f.storage.metadata;f.storage.metadata={get:key=>raw.get(key),list:options=>raw.list(options),transaction:op=>raw.transaction(tx=>op(injectFaults(tx,[{method:'put',when:call=>call.args[0]==='admin/audit-head'}])))};await assert.rejects(edit(f,beam,{on:false}),{code:'injected_fault'});f.storage.metadata=raw;assert.deepEqual(await f.storage.get('audit-head'),head);assert.deepEqual(await f.raw.get('admin/rate/boot'),rate);assert.equal((await f.flags.snapshot()).version,2);
 }finally{f.close();}
});

test('rate limits share the existing actor window and explain is audited without persisting subject input',async()=>{
 const f=fixture({env:{RELEASE_READY:'true'}});try{await f.change('seed',beam);for(let i=0;i<59;i++)await edit(f,beam,{on:Boolean(i%2)});await assert.rejects(edit(f,beam,{on:true}),{code:'rate_limited'});assert.equal((await f.flags.snapshot()).version,60);const result=await f.query('explain',{name:beam,context:{subject:{kind:'account',owner}}});assert.equal(typeof result.value,'boolean');const last=(await audit(f)).at(-1);assert.equal(last.action,'flag.explain');assert.equal(JSON.stringify(last).includes(owner),false);}finally{f.close();}
});
