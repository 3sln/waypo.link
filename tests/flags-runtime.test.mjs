import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Engine,Provider} from '../vendor/ngin/index.js';
import {AppAction,AppQuery,createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {FlagsRuntime,FLAGS_TTL_MS,FLAGS_FALLBACK_MS,flagsMaxStale,flagContext,flagWriter,flagAccounts,workerFlags,disabledFlagStats} from '../packages/runtime/flags.mjs';
import {FLAGS} from '../packages/flags/registry.mjs';import {legacyValue,billingConfigured} from '../packages/flags/env.mjs';import {accountShard} from '../packages/flags/hash.mjs';
import {nodeResources,SqliteMetadata} from '../apps/node/resources.mjs';import {nodeFlagEnv,createNodeServer} from '../apps/node/server.mjs';
import {AdminStorage} from '../packages/identity/admin-store.mjs';
import {UpdateFlag} from '../packages/app/domains/flags.mjs';
import {fakeClock,forEachSeed,createScheduler} from './helpers/chaos.mjs';
// FF-3 owns the catalogue and public operations. Test-local ngin wrappers drive
// the production platform provider without creating a second domain API.
class Pin extends AppQuery{static deps=['flags'];async fetch({flags}){return flags.pin(this.input);}}
class Publish extends AppAction{static deps=['flags'];run({flags}){return flags.publish(this.input);}}
const start=1792000000000,owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',beam='BEAM_ENABLED',signup='SIGNUP_ENABLED';
const record=(patch={})=>({rev:1,on:true,onValue:true,fallthrough:true,salt:'runtime-salt',...patch});
const snapshot=(version=1,flags={[beam]:record(),[signup]:record()})=>({v:1,version,issuedAt:0,flags});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function cachePort(clock){const rows=new Map(),calls=[];let down=false;return {rows,calls,set down(v){down=v;},async match(key){calls.push(['match',key]);if(down)throw new Error('Cache unavailable');const row=rows.get(key);return row&&clock.now()<row.until?row.response.clone():undefined;},async put(key,response){calls.push(['put',key]);if(down)throw new Error('Cache unavailable');rows.set(key,{response:response.clone(),until:clock.now()+Number(response.headers.get('Cache-Control').match(/max-age=(\d+)/)[1])*1000});}};}
function fixture(options={}){
 const clock=options.clock??fakeClock(start),cache=options.cache===undefined?cachePort(clock):options.cache,state={snapshot:options.snapshot??snapshot(),down:false,reads:0};
 const store=options.store??{async flagsSnapshot(){state.reads++;if(state.down)throw new Error('Store unavailable');return structuredClone(state.snapshot);}},runtime=new FlagsRuntime({...options,clock:clock.now,cache,store}),engine=new Engine({providers:{flags:Provider.fromSingleton(runtime)}}),pending=[],execution={waitUntil:promise=>pending.push(promise)};
 return {clock,cache,state,store,runtime,execution,pin:input=>read(engine,new Pin({input})),publish:input=>perform(engine,new Publish({input})),flush:async()=>{await Promise.all(pending.splice(0));await runtime.writes;},close:()=>engine.dispose()};
}
const request=(cf,headers={'CF-Connecting-IP':'192.0.2.1'})=>Object.assign(new Request('https://host.example/api/config',{headers}),{cf});

test('isolate and colo tiers expire after 15 s each; copies preserve authority-read time',async()=>{
 const f=fixture();try{
  const first=await f.pin();assert.equal(first.enabled(beam),true);assert.equal(f.state.reads,1);assert.equal(f.runtime.entry.checkedAt,start);assert.equal(f.runtime.entry.snapshot.issuedAt,0);
  f.clock.advance(14999);assert.equal((await f.pin()).version,1);assert.equal(f.state.reads,1);
  const cold=fixture({clock:f.clock,cache:f.cache,store:f.store});try{assert.equal((await cold.pin()).version,1);assert.equal(f.state.reads,1);assert.equal(cold.runtime.entry.checkedAt,start);}finally{cold.close();}
  f.state.snapshot=snapshot(2,{[beam]:record({on:false})});f.clock.advance(1);
  const stale=await f.pin({execution:f.execution});assert.equal(stale.version,1);await f.flush();assert.equal((await f.pin()).version,2);assert.equal(first.enabled(beam),true);assert.equal(f.state.reads,2);
  const fresh=f.cache.rows.get(f.runtime.cacheKey+'/fresh'),fallback=f.cache.rows.get(f.runtime.cacheKey+'/fallback');assert.equal(fresh.until-f.clock.now(),15000);assert.equal(fallback.until-f.clock.now(),FLAGS_FALLBACK_MS);
 }finally{f.close();}
});

test('cold isolate uses fresh colo without authority; fallback survives a store outage without renewing max-stale',async()=>{
 const f=fixture();await f.pin();f.state.down=true;
 const cold=fixture({clock:f.clock,cache:f.cache,store:f.store});try{assert.equal((await cold.pin()).enabled(beam),true);assert.equal(f.state.reads,1);}finally{cold.close();}
 f.clock.advance(FLAGS_TTL_MS+1);const fallback=fixture({clock:f.clock,cache:f.cache,store:f.store});try{const port=await fallback.pin({execution:fallback.execution});await fallback.flush();assert.equal(port.enabled(beam),true);assert.equal(fallback.runtime.entry.checkedAt,start);
  f.clock.set(start+3600001);const expired=await fallback.pin({execution:fallback.execution});await fallback.flush();assert.equal(expired.enabled(beam),false);assert.equal(expired.evaluate(beam).reason,'outage');assert.equal(expired.enabled(signup),true);assert.equal(expired.evaluate(signup).reason,'outage-last-known');
 }finally{fallback.close();f.close();}
});

test('warm last-known-good is usable up to max-stale, then only last-known flags use the seven-day fallback',async()=>{
 const f=fixture({env:{FLAGS_MAX_STALE_MS:'300000'}});try{
  await f.pin();f.state.down=true;f.clock.advance(300000);assert.equal((await f.pin()).enabled(beam),true);f.clock.advance(1);const stale=await f.pin();assert.equal(stale.enabled(beam),false);assert.equal(stale.enabled(signup),true);
  f.clock.set(start+FLAGS_FALLBACK_MS);const gone=await f.pin();assert.equal(gone.enabled(signup),false);assert.equal(gone.evaluate(signup).reason,'outage');
 }finally{f.close();}
 for(const value of [undefined,'',0,'299999','86400001','typo',null])assert.equal(flagsMaxStale(value),3600000);assert.equal(flagsMaxStale('300000'),300000);assert.equal(flagsMaxStale('86400000'),86400000);
});

test('Cache API failure/absence never prevents store evaluation, and a failed store never manufactures a snapshot',async()=>{
 for(const cacheFailure of ['absent','throw','malformed']){
  const f=fixture({cache:cacheFailure==='absent'?null:undefined});try{if(cacheFailure==='throw')f.cache.down=true;if(cacheFailure==='malformed')await f.cache.put(f.runtime.cacheKey+'/fresh',new Response('{}',{headers:{'Cache-Control':'max-age=15'}}));assert.equal((await f.pin()).enabled(beam),true);assert.equal(f.state.reads,1);
   f.state.down=true;f.clock.advance(3600001);assert.equal((await f.pin()).enabled(beam),false);assert.equal((await f.pin()).enabled(signup),true);
  }finally{f.close();}
 }
 const cold=fixture({env:{BEAM_ENABLED:'true',SIGNUP_ENABLED:'false'}});try{cold.state.down=true;const port=await cold.pin();assert.equal(port.enabled(beam),false);assert.equal(port.evaluate(beam).reason,'outage');assert.equal(port.evaluate(signup).reason,'env-kill');}finally{cold.close();}
});

test('env kill and invalid values override cached and fallback state; admin-less environments preserve legacy flags',async()=>{
 for(const raw of ['false','typo']){const f=fixture({env:{BEAM_ENABLED:raw,SIGNUP_ENABLED:raw}});try{await f.pin();f.state.down=true;f.clock.advance(3600001);const port=await f.pin();for(const name of [beam,signup]){assert.equal(port.enabled(name),false);assert.equal(port.evaluate(name).reason,'env-kill');}}finally{f.close();}}
 const runtime=new FlagsRuntime({env:{BEAM_ENABLED:'true',SIGNUP_ENABLED:'true'},clock:()=>start});const port=await runtime.pin();assert.equal(port.enabled(beam),true);assert.equal(port.enabled(signup),true);assert.equal(port.evaluate(beam).reason,'legacy-env');
 assert.equal(workerFlags({APP_ORIGIN:'https://host.example'}).store,null);const env={APP_ORIGIN:'https://host.example'};assert.equal(workerFlags(env),workerFlags(env));assert.deepEqual(await disabledFlagStats.record({owner}),{accepted:false,reason:'disabled'});assert.equal((await disabledFlagStats.results()).visible,false);
});

test('store refreshes are single-flight; requests stay pinned while a newer publication overtakes the read',async()=>{
 const f=fixture();try{
  const before=await f.pin(),hold=deferred();f.store.flagsSnapshot=async()=>{f.state.reads++;await hold.promise;return snapshot(2,{[beam]:record({on:false})});};f.clock.advance(15000);
  const ports=await Promise.all(Array.from({length:10},()=>f.pin({execution:f.execution})));assert(ports.every(p=>p.version===1));assert.equal(f.state.reads,2);
  await f.publish(snapshot(3));hold.resolve();await f.flush();assert.equal((await f.pin()).version,3);assert.equal(before.version,1);assert.equal(before.enabled(beam),true);
  await f.publish(snapshot(2));assert.equal((await f.pin()).version,3);
  f.state.down=true;f.store.flagsSnapshot=async()=>{throw new Error('down');};f.clock.advance(3600001);assert.equal((await f.pin()).enabled(beam),false);
 }finally{f.close();}
});

test('invalid snapshots, regressions and equivocation cannot renew last-known-good age',async()=>{
 const f=fixture();try{await f.pin();const checkedAt=f.runtime.entry.checkedAt;
  for(const bad of [{...snapshot(2),v:2},snapshot(0),snapshot(1,{[beam]:record({on:false})})]){f.clock.advance(15000);f.state.snapshot=bad;await f.pin();assert.equal(f.runtime.entry.snapshot.version,1);assert.equal(f.runtime.entry.checkedAt,checkedAt);}
  f.clock.set(start+3600001);assert.equal((await f.pin()).enabled(beam),false);
 }finally{f.close();}
});

test('trusted cf geo, verified session owner, identity shard and client form a pinned context; headers cannot pick a subject',async()=>{
 const req=request({country:'US',regionCode:'TX'},{'CF-Connecting-IP':'192.0.2.1','X-Bindle-Account':other,'X-Client-Id':'spoof','CF-IPCountry':'DE'}),ctx=flagContext({session:{account:{id:owner}},client:{clientId:'https://client.example'}},{request:req,now:start});
 assert.deepEqual(ctx,{subject:{kind:'account',owner},client:{clientId:'https://client.example'},region:{country:'US',subdivision:'TX'},shard:accountShard(owner),now:start});assert.equal(flagContext({}, {request:req}).subject.kind,'anonymous');
 for(const [platform,geo,headers]of [['node',{country:'US',regionCode:'TX'},undefined],['worker',{country:'US',regionCode:'TX'},{}],['worker',{country:'XX',regionCode:'TX'},undefined],['worker',{country:'us',regionCode:'TX'},undefined]])assert.equal(flagContext({}, {platform,request:request(geo,headers)}).region.country,'unknown');
 assert.equal(flagContext({}, {request:request({country:'US',regionCode:'../TX'})}).region.subdivision,'unknown');
 const f=fixture({snapshot:snapshot(1,{[signup]:record({fallthrough:false,rules:[{when:{subdivisions:['US-TX']},serve:{value:true}}]}),[beam]:record({fallthrough:false,rules:[{when:{shards:[accountShard(owner)]},serve:{value:true}}]})})});try{const flags=await f.pin({request:req});assert.equal(flags.enabled(signup),true);assert.equal(flags.for({session:{account:{id:owner}}}).enabled(beam),true);assert.equal(flags.for({}).enabled(beam),false);f.clock.advance(1);assert.equal(flags.for({}).version,1);}finally{f.close();}
});

test('writer refreshes to at least edge version, never regresses, and refuses unavailable versions',async()=>{
 const f=fixture();try{await f.pin();f.state.snapshot=snapshot(4);assert.equal((await f.pin({minVersion:4})).version,4);f.state.snapshot=snapshot(2);f.clock.advance(15000);assert.equal((await f.pin()).version,4);f.state.down=true;await assert.rejects(f.pin({minVersion:5}),{code:'flags_unavailable',status:503});await assert.rejects(f.pin({minVersion:-1}),{code:'flags_unavailable'});
  const envelope={method:'noop',args:[],flagsVersion:0},calls=[],accounts=flagAccounts({get:id=>({invoke:input=>{calls.push({id,input});}})},await f.pin());accounts.get(owner).invoke(envelope);assert.equal(calls[0].input.flagsVersion,4);assert.equal(envelope.flagsVersion,0);
 }finally{f.close();}
});

test('overlapping writer operations and alarms keep their own pinned port without serializing fanout',async()=>{
 const f=fixture(),hold=deferred(),entered=deferred(),seen=[];const controller={config:{},async invoke({method}){const before=this.config.flags.version;if(method==='slow'){entered.resolve();await hold.promise;}seen.push([method,before,this.config.flags.version]);return this.config.flags.version;},async alarm(){return this.config.flags.version;}},writer=flagWriter(controller,f.runtime);
 try{const first=writer.invoke({method:'slow',flagsVersion:1});await entered.promise;f.state.snapshot=snapshot(2);assert.equal(await writer.invoke({method:'fast',flagsVersion:2}),2);hold.resolve();assert.equal(await first,1);assert.deepEqual(seen,[['fast',2,2],['slow',1,1]]);
  f.clock.advance(300000);f.state.snapshot=snapshot(3);assert.equal(await writer.alarm(),3);f.state.down=true;assert.equal((await writer.invoke({method:'fast',flagsVersion:4})).$fault.code,'flags_unavailable');
 }finally{hold.resolve();f.close();}
});

test('writers refresh only to catch up with an edge version; alarms refresh after five minutes',async()=>{
 const f=fixture();try{await f.pin({writer:true});f.state.snapshot=snapshot(2);f.clock.advance(15000);assert.equal((await f.pin({writer:true,minVersion:1})).version,1);assert.equal(f.state.reads,1);assert.equal((await f.pin({writer:true,alarm:true})).version,1);assert.equal(f.state.reads,1);f.clock.advance(285000);assert.equal((await f.pin({writer:true,alarm:true})).version,2);assert.equal(f.state.reads,2);}finally{f.close();}
});

test('no console records preserve the actual Worker vars, local vars and Node defaults',async()=>{
 const billing={POLAR_ACCESS_TOKEN:'local-token',POLAR_WEBHOOK_SECRET:'local-secret',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra',POLAR_SERVER:'sandbox'};
 for(const [name,platform,env]of [...await Promise.all(['wrangler.jsonc','wrangler.local.jsonc'].map(async name=>[name,'worker',JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8')).vars])),['Node defaults','node',nodeFlagEnv({})]]){
  const effective={...env,...billing},f=fixture({env:effective,platform,snapshot:snapshot(0,{})});try{
   const old=flag=>{const item=FLAGS[flag],value=legacyValue(flag,effective,{platform});return value&&item.requires.every(dep=>old(dep)!==FLAGS[dep].safe)&&(!item.capabilities?.includes('billing-configuration')||billingConfigured(effective))?value:item.safe;};
   const port=await f.pin();for(const item of Object.values(FLAGS))assert.equal(port.enabled(item.name),old(item.name),name+': '+item.name);
  }finally{f.close();}
 }
 assert.deepEqual(nodeFlagEnv({}),{});assert.deepEqual(nodeFlagEnv({BEAM_ENABLED:'true',BILLING_ENABLED:'true'}),{BEAM_ENABLED:'true'});
 const dir=await mkdtemp(join(tmpdir(),'flags-node-defaults-'));let app;try{app=await createNodeServer({directory:dir});const config=app.resources.accounts.get(owner).config;for(const f of Object.values(FLAGS).filter(f=>f.class!=='b'))if(process.env[f.name]===undefined)assert.equal(config[f.name],undefined,f.name);assert.equal((await app.resources.flagsRuntime.pin()).enabled(beam),false);}finally{await app?.close();await rm(dir,{recursive:true,force:true});}
});

test('Node commits invalidate synchronously and publish immediately; pinned ports remain unchanged; stats survive restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'flags-node-'));let resources,engine;try{
  resources=await nodeResources({directory,config:{APP_ORIGIN:'https://host.example'}});const initial=await resources.flagsRuntime.pin();assert.equal(initial.version,0);
  const result=await resources.adminStore.commit({expect:{'flags-head':null},writes:{'flag/BEAM_ENABLED':record(),'flags-head':{version:1,issuedAt:start}}});assert.equal(result.committed,true);assert.equal((await resources.flagsRuntime.pin()).enabled(beam),true);assert.equal(initial.enabled(beam),false);assert.equal(initial.version,0);
  engine=createAppEngine({providers:{flagStore:resources.adminStore,config:{RELEASE_READY:'true',FLAGS_PLATFORM:'node'},clock:{now:()=>start},random:{uuid:()=>crypto.randomUUID()},audit:{record:()=>{}}}});await perform(engine,new UpdateFlag({actor:{kind:'boot',expect:{'boot/principal':null}},input:{name:beam,expectedRevision:1,record:record({on:false}),stepUpAt:start,stepUpMethod:'passkey'}}));assert.equal((await resources.flagsRuntime.pin()).version,2);assert.equal((await resources.flagsRuntime.pin()).enabled(beam),false);
  const input={experimentId:owner,variants:['control','treatment'],metrics:['beam_completed']};assert.equal((await resources.flagStats.configure(input)).accepted,true);assert.equal((await resources.flagStats.record({experimentId:owner,variant:'control',kind:'exposure',owner})).accepted,true);
  await resources.close();resources=await nodeResources({directory,config:{APP_ORIGIN:'https://host.example'}});assert.equal((await resources.flagsRuntime.pin()).version,2);assert.equal((await resources.flagStats.results({experimentId:owner})).visible,false);assert(resources.flagStats.db.prepare("SELECT value FROM flag_stats WHERE key LIKE 'stats/%/day/%'").all().some(row=>JSON.parse(row.value).cells.some(cell=>cell.events.exposure===1)));
 }finally{engine?.dispose();await resources?.close();await rm(directory,{recursive:true,force:true});}
});

class Commit extends AppAction{static deps=['store'];run({store}){return store.commit(this.input);}}
test('seeded concurrent SQLite publication/read/cache failures preserve committed prefixes and writer monotonicity',async()=>{
 await forEachSeed(20,async random=>{
  const clock=fakeClock(start),raw=new SqliteMetadata(':memory:'),store=new AdminStorage(raw),scheduler=createScheduler(random),tracked=scheduler.wrap(store,'admin'),delivery=scheduler.wrap({snapshot:value=>value},'response');let storeDown=false;const source={async flagsSnapshot(){if(storeDown)throw new Error('Seeded store outage');return delivery.snapshot(await tracked.flagsSnapshot());}},f=fixture({clock,store:source,maxStale:300000}),writer=fixture({clock,cache:null,store:source}),engine=new Engine({providers:{store:Provider.fromSingleton(tracked)}}),committed=new Map([[0,{}]]),observed=[];
  try{
   await f.pin();await writer.pin();const publish=async i=>{const before=await tracked.get('flags-head'),version=(before?.version??0)+1,value=record({rev:version,on:i%2===0,fallthrough:i%3!==0}),result=await perform(engine,new Commit({input:{expect:{'flags-head':before?.revision??null},writes:{'flag/BEAM_ENABLED':value,'flags-head':{version,issuedAt:clock.now()}}}}));if(result.committed)committed.set(version,{[beam]:value});return result;};
   for(let round=0;round<5;round++){
    clock.advance(random.int(360000)+15000);f.cache.down=random.chance(.3);storeDown=random.chance(.3);
    const results=await scheduler.run([()=>publish(round*2),()=>publish(round*2+1),async()=>{const port=await f.pin();observed.push({version:port.version,value:port.enabled(beam),usable:clock.now()-f.runtime.entry.checkedAt<=f.runtime.maxStale});return port.version;},async()=>{const port=await writer.pin();observed.push({version:port.version,writer:true});return port.version;}]);assert(results.every(r=>r.status==='fulfilled'),results.filter(r=>r.status==='rejected').map(r=>r.reason));
    // Pin to the latest edge version through the same writer refresh contract.
    const version=(await f.pin()).version;try{const port=await writer.pin({minVersion:version});assert(port.version>=version);}catch(error){assert.equal(error.code,'flags_unavailable');assert(storeDown);}
   }
   let previous=0;for(const entry of observed){assert(committed.has(entry.version));if(entry.writer){assert(entry.version>=previous);previous=entry.version;}else assert.equal(entry.value,entry.usable&&Boolean(committed.get(entry.version)[beam]?.on&&committed.get(entry.version)[beam]?.fallthrough));}
   for(const row of f.cache.rows.values()){const entry=await row.response.clone().json();assert.deepEqual(entry.snapshot.flags,Object.fromEntries(Object.entries(committed.get(entry.snapshot.version)).map(([name,r])=>[name,{retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null,...r}])));}
  }finally{engine.dispose();f.close();writer.close();raw.close();}
 });
});
