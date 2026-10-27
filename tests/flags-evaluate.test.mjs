import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluate,evaluateGlobal,globalComponent,createFlags} from '../packages/flags/evaluate.mjs';
import {validateSnapshot} from '../packages/flags/snapshot.mjs';
import {murmur3_32,bucket,accountShard} from '../packages/flags/hash.mjs';
import {widens} from '../packages/flags/widen.mjs';
import {forEachSeed,fakeClock} from './helpers/chaos.mjs';

const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',client='https://client.example';
const account=(id=owner,extra={})=>({subject:{kind:'account',owner:id},now:100,...extra}),anon={subject:{kind:'anonymous'},now:100};
const record=extra=>({rev:1,on:true,onValue:true,fallthrough:false,salt:'flag-salt',retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null,...extra});
const snap=(flags={},version=1)=>validateSnapshot({v:1,version,issuedAt:0,flags});
const rule=(when={},serve={value:true})=>({when,serve});
const experiment=extra=>({id:other,status:'running',variants:[{key:'control',weight:2500},{key:'one',weight:3500},{key:'two',weight:4000}],eligibility:{percent:10000},variantSalt:'experiment-salt',startedAt:0,...extra});

test('Murmur3 known answers and salted bucketing are stable; shards equal identity SHA-256 routing',async()=>{
 for(const [value,expected]of [['',0],['foo',4138058784],['hello',613153351]])assert.equal(murmur3_32(value),expected);
 assert.equal(bucket('salt',owner),murmur3_32(`salt\x1f${owner}`)%10000);
 await forEachSeed(12,random=>{for(let i=0;i<100;i++){const key=i%3===0?'🙂'.repeat(random.int(120)+1):`${random.int(1e9)}-${random.int(1e9)}`;assert.equal(accountShard(key),createHash('sha256').update(key).digest()[0]%64);assert.ok(bucket('salt',key)>=0&&bucket('salt',key)<10000);}});
});

test('every base reason, env kills during outages, dependencies and last-known fallback',()=>{
 const run=(flags,env={},snapshot=snap(flags))=>evaluate('ACTIVITY_V2_ENABLED',account(),snapshot,env);
 assert.deepEqual(run({}),{value:false,reason:'no-record'});assert.deepEqual(run({},{ACTIVITY_V2_ENABLED:'true'}),{value:true,reason:'legacy-env'});
 assert.equal(run({ACTIVITY_V2_ENABLED:record({on:false})},{ACTIVITY_V2_ENABLED:'true'}).reason,'console-off');assert.equal(run({ACTIVITY_V2_ENABLED:record({fallthrough:true})}).reason,'fallthrough');
 for(const env of [{ACTIVITY_V2_ENABLED:'false'},{ACTIVITY_V2_ENABLED:'invalid'}])assert.deepEqual(run({},env,null),{value:false,reason:'env-kill'});
 for(const invalid of [null,{},[],{v:1,version:0,issuedAt:0,flags:{ACTIVITY_V2_ENABLED:{on:true}}}])assert.deepEqual(run({},{ACTIVITY_V2_ENABLED:'true'},invalid),{value:false,reason:'outage'});
 assert.deepEqual(evaluate('BILLING_ENABLED',{},null,{BILLING_ENABLED:'true'}),{value:true,reason:'env-capability'});
 assert.throws(()=>evaluate('UNKNOWN',{},null),{code:'unknown_flag'});
 const flags={EMAIL_BRIDGE_ENABLED:record({fallthrough:true}),BINDLEBOX_ENABLED:record({fallthrough:true})};
 assert.equal(evaluate('EMAIL_BRIDGE_ENABLED',account(),snap(flags)).value,true);assert.equal(evaluate('EMAIL_BRIDGE_ENABLED',account(),snap(flags),{BINDLEBOX_ENABLED:'false'}).reason,'dependency:BINDLEBOX_ENABLED');
 flags.BINDLEBOX_ENABLED=record({rules:[rule({accounts:[other]})]});assert.equal(evaluate('EMAIL_BRIDGE_ENABLED',account(),snap(flags)).reason,'dependency:BINDLEBOX_ENABLED');assert.equal(evaluate('EMAIL_BRIDGE_ENABLED',account(other),snap(flags)).value,true);
 const fallback=snap({SIGNUP_ENABLED:record({fallthrough:true}),ACTIVITY_V2_ENABLED:record({fallthrough:true})});
 assert.deepEqual(evaluate('SIGNUP_ENABLED',anon,null,{}, {fallback}),{value:true,reason:'outage-last-known',detailReason:'fallthrough'});assert.equal(evaluate('SIGNUP_ENABLED',anon,fallback,{}, {usable:false,fallback}).reason,'outage-last-known');assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),null,{}, {fallback}).reason,'outage');assert.equal(evaluate('SIGNUP_ENABLED',anon,null,{SIGNUP_ENABLED:'false'},{fallback}).reason,'env-kill');
 assert.equal(evaluate('PAID_SIGNUP_ENABLED',anon,snap({PAID_SIGNUP_ENABLED:record({fallthrough:true})})).reason,'dependency:billing-configuration');
});

test('global component ignores audience and composes dependencies globally',()=>{
 const snapshot=snap({INTEGRATIONS_ENABLED:record({deny:{accounts:[owner],clients:[]},rules:[rule({accounts:[other]})]}),BROKERING_ENABLED:record({fallthrough:true}),ACTIVITY_V2_ENABLED:record({rules:[rule({accounts:[other]})]})});
 assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),snapshot).value,false);assert.deepEqual(evaluateGlobal('ACTIVITY_V2_ENABLED',snapshot),{value:true,reason:'global'});assert.equal(globalComponent('ACTIVITY_V2_ENABLED',snapshot,{ACTIVITY_V2_ENABLED:'false'}),false);
 assert.equal(evaluate('BROKERING_ENABLED',account(),snapshot).value,true);assert.equal(globalComponent('BROKERING_ENABLED',snapshot,{INTEGRATIONS_ENABLED:'false'}),false);
});

test('deny wins retention and experiment; retainExisting never matches anonymous or system subjects',()=>{
 const make=extra=>snap({ACTIVITY_V2_ENABLED:record({retainExisting:true,experiment:experiment(),...extra})}),hasState=()=>true;
 assert.deepEqual(evaluate('ACTIVITY_V2_ENABLED',account(),make({}),{}, {hasState}),{value:true,reason:'retained'});
 assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),make({deny:{accounts:[owner],clients:[]}}),{}, {hasState}).reason,'deny');
 const snapshot=snap({ACTIVITY_V2_ENABLED:record({retainExisting:true,deny:{accounts:[],clients:[client]}})});assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(owner,{client:{clientId:client}}),snapshot,{}, {hasState}).reason,'deny');
 for(const ctx of [anon,{subject:{kind:'system',reason:'cleanup'}},{subject:{kind:'account',owner:'invalid'}}])assert.deepEqual(evaluate('ACTIVITY_V2_ENABLED',ctx,make({}),{}, {hasState}),{value:false,reason:'fallthrough'});
 assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),make({on:false}),{}, {hasState}).reason,'console-off');assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),make({}),{ACTIVITY_V2_ENABLED:'false'},{hasState}).reason,'env-kill');
});

test('ordered rules match lists, identity shard, trusted regions and inclusive/exclusive schedules',()=>{
 const clock=fakeClock(10),window={from:10,until:20},snapshot=snap({ACTIVITY_V2_ENABLED:record({rules:[rule({accounts:[owner],shards:[String(accountShard(owner)).padStart(2,'0')],window})]})});
 for(const [now,value]of [[9,false],[10,true],[19,true],[20,false]]){clock.set(now);assert.equal(evaluate('ACTIVITY_V2_ENABLED',{subject:account().subject},snapshot,{}, {clock:clock.now}).value,value);}
 assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(other),snapshot).value,false);
 const geo=snap({SIGNUP_ENABLED:record({rules:[rule({countries:['US'],subdivisions:['US-TX'],window:{from:'2026-10-21T00:00:00Z',until:'2026-10-22T00:00:00Z'}})]})});
 for(const subdivision of ['TX','US-TX'])assert.equal(evaluate('SIGNUP_ENABLED',{...anon,now:Date.parse('2026-10-21T00:00:00Z'),region:{country:'US',subdivision}},geo).value,true);
 for(const region of [{country:'unknown',subdivision:'TX'},{country:'US',subdivision:'unknown'},{country:'CA',subdivision:'TX'},null])assert.equal(evaluate('SIGNUP_ENABLED',{...anon,now:Date.parse('2026-10-21T00:00:00Z'),region},geo).value,false);
 const ordered=snap({ACTIVITY_V2_ENABLED:record({fallthrough:true,rules:[rule({}, {value:true,percent:0}),rule()]})});assert.deepEqual(evaluate('ACTIVITY_V2_ENABLED',account(),ordered),{value:false,reason:'rule:0'});
 const clients=snap({APP_METADATA_DISCOVERY_ENABLED:record({rules:[rule({clients:[client]},{value:true,percent:10000})]})});assert.equal(evaluate('APP_METADATA_DISCOVERY_ENABLED',{...anon,client:{clientId:client}},clients).value,true);assert.equal(evaluate('APP_METADATA_DISCOVERY_ENABLED',anon,clients).value,false);
});

test('seeded percentage ramps are monotonic, handle endpoints, and never bucket anonymous subjects',async()=>{
 const percentages=[0,1,200,1000,5000,9999,10000],snapshots=percentages.map(percent=>snap({ACTIVITY_V2_ENABLED:record({rules:[rule({}, {value:true,percent})]})}));
 await forEachSeed(24,random=>{for(let i=0;i<80;i++){const id=`00000000-0000-4000-8000-${String(random.int(1e12)).padStart(12,'0')}`,ctx=account(id),results=snapshots.map(s=>evaluate('ACTIVITY_V2_ENABLED',ctx,s).value);assert.equal(results[0],false);assert.equal(results.at(-1),true);assert.deepEqual(results,[...results].sort());assert.deepEqual(results,snapshots.map(s=>evaluate('ACTIVITY_V2_ENABLED',ctx,s).value));}});
 for(const s of snapshots)for(const ctx of [anon,{subject:{kind:'system',reason:'alarm'}}])assert.equal(evaluate('ACTIVITY_V2_ENABLED',ctx,s).value,false);
});

test('A/B/n assignment is sticky across versions/unrelated edits and respects eligibility and stops',async()=>{
 const e=experiment(),r=record({experiment:e}),first=snap({ACTIVITY_V2_ENABLED:r}),next=snap({ACTIVITY_V2_ENABLED:{...r,rev:2},SEMANTIC_SEARCH_ENABLED:record({fallthrough:true})},99),seen=new Set();
 await forEachSeed(24,random=>{for(let i=0;i<80;i++){const ctx=account(`00000000-0000-4000-8000-${String(random.int(1e12)).padStart(12,'0')}`),a=evaluate('ACTIVITY_V2_ENABLED',ctx,first),b=evaluate('ACTIVITY_V2_ENABLED',ctx,next);assert.deepEqual(a,b);assert.equal(a.reason,`experiment:${e.id}`);assert.equal(a.value,a.variant!=='control');seen.add(a.variant);}});assert.deepEqual([...seen].sort(),['control','one','two']);
 for(const eligibility of [{percent:0},{percent:10000,when:{accounts:[other]}},{percent:10000,when:{window:{from:101}}}])assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),snap({ACTIVITY_V2_ENABLED:record({experiment:experiment({eligibility})})})).reason,'fallthrough');
 assert.equal(evaluate('ACTIVITY_V2_ENABLED',anon,first).reason,'fallthrough');assert.equal(evaluate('ACTIVITY_V2_ENABLED',account(),snap({ACTIVITY_V2_ENABLED:record({experiment:experiment({status:'stopped',stoppedAt:1})})})).reason,'fallthrough');
});

test('flags.for pins snapshot, context, clock and decisions; background follows env kill only',()=>{
 const clock=fakeClock(10),input={v:1,version:3,issuedAt:0,flags:{ACTIVITY_V2_ENABLED:record({rules:[rule({accounts:[owner],window:{until:20}})]}),EVENT_BUSES_ENABLED:record({on:false})}},flags=createFlags({snapshot:input,clock:clock.now}),ctx=account();delete ctx.now;const pinned=flags.for(ctx),before=pinned.evaluate('ACTIVITY_V2_ENABLED');
 clock.set(30);ctx.subject.owner=other;input.flags.ACTIVITY_V2_ENABLED.on=false;assert.equal(pinned.version,3);assert.equal(pinned.evaluate('ACTIVITY_V2_ENABLED'),before);assert.equal(before.value,true);assert.equal(flags.for(account()).enabled('ACTIVITY_V2_ENABLED'),false);assert.equal(pinned.global('ACTIVITY_V2_ENABLED'),true);assert.equal(pinned.background('EVENT_BUSES_ENABLED'),true);assert.equal(pinned.envState('ACTIVITY_V2_ENABLED').state,'unset');
 assert.equal(createFlags({snapshot:input,env:{EVENT_BUSES_ENABLED:'false'}}).for(anon).background('EVENT_BUSES_ENABLED'),false);
});

test('widening detection handles gates, ordering, schedules, deny removal and verified internal-only exemption',()=>{
 const before=record({rules:[rule({accounts:[owner],window:{from:10,until:20}},{value:true,percent:5000})]});
 assert.equal(widens(before,{...before,rev:2}),false);assert.equal(widens(before,{...before,on:false}),false);
 for(const after of [{...before,fallthrough:true},{...before,salt:'reshuffled'},{...before,retainExisting:true},{...before,experiment:experiment()},{...before,rules:[rule({accounts:[owner,other],window:{from:10,until:20}},{value:true,percent:5000})]},{...before,rules:[rule({accounts:[owner],window:{from:9,until:20}},{value:true,percent:5000})]},{...before,rules:[rule({accounts:[owner],window:{from:10,until:20}},{value:true,percent:6000})]}])assert.equal(widens(before,after),true);
 assert.equal(widens({...before,deny:{accounts:[owner],clients:[]}},before),true);assert.equal(widens(before,{...before,rules:[rule({accounts:[owner],window:{from:11,until:19}},{value:true,percent:4000})]}),false);
 const restricted=record({rules:[rule({accounts:[owner]})]});assert.equal(widens(null,restricted),true);assert.equal(widens(null,restricted,{internalAccounts:new Set([owner])}),false);assert.equal(widens(null,restricted,{internalAccounts:[other]}),true);assert.equal(widens(null,{...restricted,fallthrough:true},{internalAccounts:[owner]}),true);assert.equal(widens(null,{...restricted,retainExisting:true},{internalAccounts:[owner]}),true);
 const excluded=record({fallthrough:true,rules:[rule({accounts:[owner]},{value:false})]});assert.equal(widens(excluded,{...excluded,rules:[]}),true);
 const running=record({fallthrough:true,experiment:experiment()}),stopped={...running,experiment:experiment({status:'stopped',stoppedAt:1})};assert.equal(widens(running,stopped),true,'stopping can expose normal fallthrough to the former control cohort');assert.equal(widens({...running,fallthrough:false},{...stopped,fallthrough:false}),false);
});

test('seeded widening soundness: any newly admitted context requires acknowledgement',async()=>{
 await forEachSeed(30,random=>{
  const owners=Array.from({length:30},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`),generate=()=>record({on:random.chance(.9),fallthrough:random.chance(.3),salt:`salt-${random.int(2)}`,deny:{accounts:owners.filter(()=>random.chance(.08)),clients:[]},rules:Array.from({length:random.int(4)},()=>rule({accounts:owners.filter(()=>random.chance(.5)),window:{from:random.int(3)*10,until:40+random.int(3)*10}},{value:random.chance(.8),percent:random.int(11)*1000})),experiment:random.chance(.25)?experiment({eligibility:{percent:random.int(11)*1000}}):null});
  for(let i=0;i<25;i++){const before=generate(),after=random.chance(.5)?generate():{...before,rev:2,rules:before.rules.map(r=>({...r,serve:{...r.serve,percent:Math.max(0,r.serve.percent-1000)}}))},a=snap({ACTIVITY_V2_ENABLED:before}),b=snap({ACTIVITY_V2_ENABLED:after});if(!widens(before,after))for(const id of owners)for(const now of [0,10,20,39,40,50,60])assert.ok(!evaluate('ACTIVITY_V2_ENABLED',account(id,{now}),b).value||evaluate('ACTIVITY_V2_ENABLED',account(id,{now}),a).value,'undetected widening');}
 });
});
