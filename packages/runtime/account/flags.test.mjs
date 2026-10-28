// FF-5b owns account/**; keep this workstream's tests inside that boundary.
import {SEMANTIC_MIN_ACCOUNT_AGE_MS} from './search.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {AccountController} from '../accounts.mjs';
import {SqliteMetadata,SerialGate} from '../../../apps/node/resources.mjs';
import {createAppEngine,read,perform,AppQuery} from '../../app/engine.mjs';
import {FlagsRuntime,flagWriter} from '../flags.mjs';
import {createFlags} from '../../flags/evaluate.mjs';
import {validateSnapshot} from '../../flags/snapshot.mjs';
import {memoryFlagStats} from '../../flags/stats.mjs';
import {fakeClock,forEachSeed,createScheduler,injectFaults} from '../../../tests/helpers/chaos.mjs';
import {AccountFeatureState,flagsFor,ownerFlags,writerConfig,withWriterFlags,recordFlag} from './flags.mjs';
import {deviceAuthorizationEnabled,deviceGrantMountable,deviceGrantRunner} from '../device-grant.mjs';
import {incrementalAuthorizationEnabled,incrementalMountable,incrementalRunner} from '../incremental-authorization.mjs';
import {lifecycleMode} from '../lifecycle-runner.mjs';
import {linksEnabled} from './links.mjs';
import {clientMetadataEnabled,federationSchemas,messagingMailboxMounted,federationDeclarations} from '../federation.mjs';
import {integrationPorts} from '../integration-ports.mjs';
import {manifest} from '../../../tests/event-bus-fixture.mjs';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',experimentId='00000000-0000-4000-8000-000000000003',client='https://client.example/client.json',start=Date.UTC(2026,9,21,12);
const record=(patch={})=>({rev:1,on:true,onValue:true,fallthrough:false,salt:'writer-flags',...patch}),snapshot=(flags={},version=1)=>({v:1,version,issuedAt:start,flags});
const port=(flags,env={})=>createFlags({snapshot:snapshot(flags),env,clock:()=>start});
const ctx=(id=owner)=>({subject:{kind:'account',owner:id}});
class Decision extends AppQuery{static deps=['config'];fetch({config}){return ownerFlags(config,this.actor.owner,this.input?.clientId).evaluate(this.id);}}
function engine(providers={}){return createAppEngine({providers:{clock:fakeClock(start),random:{uuid:()=>other,bytes:n=>new Uint8Array(n).fill(8)},audit:{record(){}},...providers}});}
async function account(t,{flags={},env={},version=1}={}){
 const db=new SqliteMetadata(':memory:'),clock=fakeClock(start),runtime=new FlagsRuntime({env,clock:clock.now,store:{flagsSnapshot:async()=>snapshot(flags,version)}}),config={APP_ORIGIN:'https://host.example',LOCAL_DEVELOPMENT:'true',KEY_ENCRYPTION_KEY:'local-only-key',...env},bucket={get:async()=>null,put:async()=>{},delete:async()=>{}};
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await controller.warm(owner);const writer=flagWriter(controller,runtime);t.after(()=>db.close());
 return {db,clock,runtime,config,controller,writer,invoke:(method,...args)=>writer.invoke({method,args:[owner,...args]})};
}

test('legacy read-site tables: exact strings, booleans, defaults, dependencies and mount evidence',()=>{
 for(const raw of [undefined,'',false,true,'false','true','TRUE',0]){
  assert.equal(linksEnabled({LINKS_ENABLED:raw}),raw===true||raw==='true',`links ${raw}`);
  assert.equal(deviceAuthorizationEnabled({DEVICE_AUTHORIZATION_ENABLED:raw}),raw===true||raw==='true',`device ${raw}`);
  assert.equal(clientMetadataEnabled({CLIENT_METADATA_ENABLED:raw}),raw==='true',`metadata ${raw}`);
  assert.equal(lifecycleMode({LIFECYCLE_ENABLED:raw,LIFECYCLE_DRY_RUN:'false'}),raw===true||raw==='true'?'live':'off',`lifecycle ${raw}`);
  assert.equal(messagingMailboxMounted({KEY_DELEGATION_ENABLED:raw,INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',MESSAGING_DESCRIBE(){}}),raw==='true',`messaging mailbox ${raw}`);
  assert.equal(messagingMailboxMounted({LINKS_ENABLED:raw,INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',MESSAGING_DESCRIBE(){}}),false,`LINKS_ENABLED never mounts the mailbox ${raw}`);
  if(raw!==true)assert.equal(incrementalAuthorizationEnabled({INCREMENTAL_AUTH_ENABLED:raw}),raw==='true',`incremental ${raw}`);
  for(const dry of [undefined,'',false,true,'false','true','FALSE'])assert.equal(lifecycleMode({LIFECYCLE_ENABLED:'true',LIFECYCLE_DRY_RUN:dry}),dry===false||dry==='false'?'live':'dry-run');
 }
 assert.equal(deviceGrantMountable({DEVICE_AUTHORIZATION_ENABLED:'true',FEDERATION_ENABLED:'true',KEY_ENCRYPTION_KEY:'key'}),true);
 assert.equal(deviceGrantMountable({DEVICE_AUTHORIZATION_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_REFRESH_ENABLED:'false',KEY_ENCRYPTION_KEY:'key'}),false);
 assert.equal(incrementalMountable({INCREMENTAL_AUTH_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_ENTRY_ENABLED:'true'}),true);
 const mint=()=>{},all={INTEGRATIONS_ENABLED:true,BROKERING_ENABLED:'true',KEY_DELEGATION_ENABLED:true};assert.equal(typeof integrationPorts(all,{mint,egress:{},describe(){}}).MESSAGING_DESCRIBE,'function');
 assert.equal(integrationPorts({...all,INTEGRATIONS_ENABLED:'false'},{mint}).BROKERING_CONSUMER_MINT,undefined);
 assert.equal(Object.keys(federationSchemas({INTEGRATIONS_ENABLED:true,EXTENSIONS_ENABLED:true})).length,2);
});

// The classifier is a built-in resource since extensions rev 3.2, no longer a built-in integration; google-drive is
// the remaining built-in integration that exercises the connect-built-in writer path.
test('writer Actions honor account, percentage and kill; cached engines do not capture the first rollout',async t=>{
 const f=await account(t,{flags:{INTEGRATIONS_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})}});
 let result=await f.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}});assert.equal(result.$fault,undefined);assert.equal(result.kind,'app-connection');
 await f.runtime.publish(snapshot({INTEGRATIONS_ENABLED:record({rules:[{when:{},serve:{value:true,percent:0}}]})},2));
 result=await f.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}});assert.equal(result.$fault?.code,'not_found');
 assert.equal((await f.invoke('connectionsOwner',{operation:'connections.list'})).connections.length,1,'owner read ignores targeting');
 await f.runtime.publish(snapshot({INTEGRATIONS_ENABLED:record({rules:[{when:{},serve:{value:true,percent:10000}}]})},3));
 assert.equal((await f.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}})).$fault,undefined);
 const killed=await account(t,{flags:{INTEGRATIONS_ENABLED:record({fallthrough:true})},env:{INTEGRATIONS_ENABLED:'false'}});assert.equal((await killed.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}})).$fault?.code,'not_found');
});

test('classifier engine gates both owner and verified client; dependency kills and store outage refuse new work',async t=>{
 const rules=[{when:{accounts:[owner],clients:[client]},serve:{value:true}}],flags={INTEGRATIONS_ENABLED:record({rules}),EXTENSIONS_ENABLED:record({rules})},e=engine({config:{flags:port(flags)}});
 for(const [id,clientId,allowed]of [[owner,client,true],[other,client,false],[owner,'https://excluded.example',false]])assert.equal((await read(e,new Decision({actor:{kind:'system',owner:id},id:'EXTENSIONS_ENABLED',input:{clientId}}))).value,allowed);
 const f=await account(t,{flags:{FEDERATION_ENABLED:record({fallthrough:true}),DEVICE_AUTHORIZATION_ENABLED:record({fallthrough:true})},env:{FEDERATION_ENABLED:'false'}});assert.deepEqual(await f.invoke('approvalNoticeContacts'),{subscriptions:[]});
 const down=await account(t);down.runtime.entry=null;down.runtime.store.flagsSnapshot=async()=>{throw Error('offline');};assert.equal((await down.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}})).$fault?.code,'not_found');
});

test('global protocol mounts ignore audience rules and region; writer stateful flags reject region rules',()=>{
 const flags=port({FEDERATION_ENABLED:record({fallthrough:true}),DEVICE_AUTHORIZATION_ENABLED:record({rules:[{when:{accounts:[other]},serve:{value:true}}]}),INCREMENTAL_AUTH_ENABLED:record({rules:[{when:{clients:[client]},serve:{value:true}}]})}),config={flags,APP_ORIGIN:'https://host.example',FEDERATION_ENTRY_ENABLED:'true',KEY_ENCRYPTION_KEY:'key'};
 assert.equal(deviceGrantMountable(config),true);assert.equal(incrementalMountable(config),true);assert(federationDeclarations(config,{target:'authority',mounts:{deviceAuthorization:true}}).grant_types_supported.includes('urn:ietf:params:oauth:grant-type:device_code'));assert.equal(ownerFlags(config,owner).enabled('DEVICE_AUTHORIZATION_ENABLED'),false);
 assert.throws(()=>validateSnapshot(snapshot({ACTIVITY_V2_ENABLED:record({rules:[{when:{countries:['US']},serve:{value:true}}]})})),{code:'invalid_snapshot'});
 const regional=port({SIGNUP_ENABLED:record({rules:[{when:{countries:['US']},serve:{value:true}}]})});assert.equal(regional.for({region:{country:'US'}}).enabled('SIGNUP_ENABLED'),true);assert.equal(regional.for({region:{country:'unknown'}}).enabled('SIGNUP_ENABLED'),false);
});

test('retention Query reads actual state only; retainExisting loses to console off, deny and env kill',async t=>{
 const f=await account(t,{flags:{INTEGRATIONS_ENABLED:record({retainExisting:true})}});
 await f.db.put('resource/retained',{id:'retained',owner,kind:'app-connection',state:'active',integration:{kind:'built-in'}});
 const state=await read(f.controller.engine,new AccountFeatureState({actor:{kind:'system',owner}}));assert.equal(Object.entries(state).find(([name])=>name==='INTEGRATIONS_ENABLED')[1],true);assert.equal(Object.entries(await read(f.controller.engine,new AccountFeatureState({actor:{kind:'system',owner:other}}))).length,0);
 assert.equal((await f.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}})).$fault,undefined);
 for(const [patch,version]of [[{on:false},2],[{deny:{accounts:[owner],clients:[]}},3]]){await f.runtime.publish(snapshot({INTEGRATIONS_ENABLED:record({retainExisting:true,...patch})},version));assert.equal((await f.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}})).$fault?.code,'not_found');assert.equal((await f.invoke('connectionsOwner',{operation:'connections.list'})).connections.length>=1,true);}
 const killed=await account(t,{flags:{INTEGRATIONS_ENABLED:record({retainExisting:true})},env:{INTEGRATIONS_ENABLED:'false'}});await killed.db.put('resource/retained',{owner,kind:'app-connection',integration:{}});assert.equal((await killed.invoke('connectionsOwner',{operation:'connections.connect-built-in',input:{integration:'google-drive'}})).$fault?.code,'not_found');
 assert.equal([...await f.db.list({prefix:''})].some(([k])=>/enroll|flag-assignment|sticky/.test(k)),false);
});

test('background outbox and sweeps ignore console off and audience, while env kill preserves state',async t=>{
 for(const env of [{},{INTEGRATIONS_ENABLED:'false'}]){
  const f=await account(t,{flags:{INTEGRATIONS_ENABLED:record({on:false}),EVENT_BUSES_ENABLED:record({on:false})},env});let signed=0;
  f.controller.config.INTEGRATION_EVENT_PORTS={signer:{sign:async()=>{signed++;return 'signed';}},egress:{send:async()=>({status:202})}};
  await f.runtime.pin();const out=await f.controller.integrationEventsAlarm(owner);assert.equal(out.ready===false,env.INTEGRATIONS_ENABLED==='false');assert.equal(signed,0);
  assert.deepEqual(await f.controller.eventBusSweep(owner),{more:false});
 }
});

const experiment={id:experimentId,status:'running',variants:[{key:'control',weight:5000},{key:'on',weight:5000}],eligibility:{percent:10000},variantSalt:'writer-variant',startedAt:start};
test('flags.record writer exposures/outcomes configure all variants, aggregate only, and never retry uncertain delivery',async()=>{
 const clock=fakeClock(start),stats=memoryFlagStats({clock,random:{bytes:n=>new Uint8Array(n).fill(3)}}),rows={ACTIVITY_V2_ENABLED:record({experiment})},flags=port(rows),metadata={get:async key=>key==='flag-experiment/'+experimentId?{name:'ACTIVITY_V2_ENABLED',experiment}:null},c={config:{flags,flagStats:stats,flagStore:metadata}};
 await recordFlag(c,owner,'ACTIVITY_V2_ENABLED','exposure');await recordFlag(c,owner,'ACTIVITY_V2_ENABLED','activity_opened');
 let dump=JSON.stringify(stats.storage.dump());assert.equal(dump.includes(owner),false);assert.equal(dump.includes(other),false);assert.equal(dump.includes('activity_opened'),true);
 const uncertain=injectFaults(stats,[{method:'record',when:1,mode:'after'}]);c.config.flagStats=uncertain;await recordFlag(c,owner,'ACTIVITY_V2_ENABLED','exposure');assert.equal(uncertain.calls.filter(c=>c.method==='record').length,1,'no retry after a possible commit');
 c.config.flags=port({ACTIVITY_V2_ENABLED:record({on:false})});assert.equal(recordFlag(c,owner,'ACTIVITY_V2_ENABLED','exposure'),undefined);
});

test('seeded interleaved writer contexts retain their own snapshot and owner during publication/faults',async()=>{
 await forEachSeed(8,async random=>{
  const scheduler=createScheduler(random),clock=fakeClock(start),a=snapshot({INTEGRATIONS_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})}),b=snapshot({INTEGRATIONS_ENABLED:record({rules:[{when:{accounts:[other]},serve:{value:true}}]})},2),runtime=new FlagsRuntime({clock:clock.now,store:{flagsSnapshot:async()=>b}});runtime.accept(a);
  const interleave=scheduler.wrap(injectFaults({step:async()=>true},[{method:'step',when:.4}],{random}),'interleave'),original={FLAGS_RUNTIME:runtime},config=writerConfig(original),c={config,metadata:{get:async()=>owner},engine:engine({accountStore:{get:async()=>owner}})};
  const results=await scheduler.run([()=>withWriterFlags(c,original,async()=>{const pinned=ownerFlags(config,owner),version=pinned.version,value=pinned.enabled('INTEGRATIONS_ENABLED');try{await interleave.step();}catch{}assert.equal(pinned.enabled('INTEGRATIONS_ENABLED'),value);assert.equal(pinned.version,version);assert.equal(ownerFlags(config,other).enabled('INTEGRATIONS_ENABLED'),!value);return true;}),async()=>{try{await interleave.step();}catch{}await runtime.publish(b);return true;}]);assert(results.every(r=>r.status==='fulfilled'));assert.equal(runtime.entry.snapshot.version,2);
 });
});


test('semantic writer changes configuration with targeting without changing consent or purge access',async t=>{
 const env={AI:{run:async()=>{}},SEARCH_VECTORS:{query:async()=>[],upsert:async()=>{},deleteByIds:async()=>{}},SEMANTIC_SPEND:{reserve:async()=>{}}},f=await account(t,{flags:{SEMANTIC_SEARCH_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})},env});
 // The semantic admission age gate needs a paid plan or an account at least SEMANTIC_MIN_ACCOUNT_AGE_MS old (search.mjs).
 await f.db.put('account/created-at',Date.now()-SEMANTIC_MIN_ACCOUNT_AGE_MS-1000);
 assert.equal((await f.invoke('searchPreferences')).configured,true);assert.equal((await f.invoke('updateSearchPreferences',{enabled:true})).enabled,true);
 await f.runtime.publish(snapshot({SEMANTIC_SEARCH_ENABLED:record({on:false})},2));const status=await f.invoke('searchPreferences');assert.equal(status.enabled,true,'stored consent survives ramp-down');assert.equal(status.available,false);assert.equal(status.configured,false);
 assert.equal((await f.invoke('updateSearchPreferences',{enabled:false})).enabled,false,'opt-out still works');assert.equal((await f.db.get('search-vector-purge')).owner,owner);
});

test('event bus writer gates creation but retains owner list, deletion and reader revocation during console off',async t=>{
 const document=manifest(),f=await account(t,{flags:{EVENT_BUSES_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})},env:{KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),FEDERATION_SCHEMAS:{[document.id]:document}}});
 const created=await f.invoke('eventBusOwner',{operation:'events.create',input:{url:document.id}});assert.equal(created.$fault,undefined);assert.equal(created.bus.manifest,document.id);
 await f.runtime.publish(snapshot({EVENT_BUSES_ENABLED:record({on:false})},2));assert.equal((await f.invoke('eventBusOwner',{operation:'events.create',input:{url:document.id}})).$fault?.code,'not_found');
 assert.equal((await f.invoke('eventBusOwner',{operation:'events.buses'})).length,1);
 assert.equal((await f.invoke('eventBusReader',{operation:'revoked',id:created.bus.id,input:{clientId:client}})).$fault,undefined);
 assert.equal((await f.invoke('eventBusOwner',{operation:'events.delete',id:created.bus.id})).deleted,true);
});

test('opaque device and incremental runner Actions use the global component; domain providers own audience checks',async()=>{
 const rules=[{when:{clients:[client]},serve:{value:true}}],flags=port({FEDERATION_ENABLED:record({fallthrough:true}),DEVICE_AUTHORIZATION_ENABLED:record({rules}),INCREMENTAL_AUTH_ENABLED:record({rules:[{when:{accounts:[owner],clients:[client]},serve:{value:true}}]})}),config={APP_ORIGIN:'https://host.example',FEDERATION_CLIENTS:[{id:client,name:'Fixture'}],flags};
 const device=deviceGrantRunner({config,deviceGrant:{authorize:async()=>({authorized:true}),drain:async()=>({drained:true}),cancel:async()=>({cancelled:true})}});
 assert.deepEqual(await device.authorize({body:'client_id='+encodeURIComponent(client)}),{authorized:true});assert.deepEqual(await device.authorize({body:'client_id=https://excluded.example'}),{authorized:true});
 const incremental=incrementalRunner({config,incremental:{admit:async()=>({admitted:true}),cleanup:async()=>({cleaned:true})}}),input={subject:'https://host.example/entities/'+owner,clientId:client,client:{id:client}};
 assert.deepEqual(await incremental.admit(input),{admitted:true});assert.deepEqual(await incremental.admit({...input,subject:'https://host.example/entities/'+other}),{admitted:true});
 config.flags=port({DEVICE_AUTHORIZATION_ENABLED:record({on:false}),INCREMENTAL_AUTH_ENABLED:record({on:false})});assert.deepEqual(await device.drain({}),{drained:true});assert.deepEqual(await device.cancel({}),{cancelled:true});assert.deepEqual(await incremental.cleanup({}),{cleaned:true});
});


test('retention predicates page beyond inactive rows and exclude foreign, expired and completed state',async t=>{
 const f=await account(t),e=engine({accountStore:f.db});for(let i=0;i<70;i++)await f.db.put('evbus/bus/'+String(i).padStart(3,'0'),{owner,state:'deleted'});await f.db.put('evbus/bus/last',{owner,state:'active'});
 await f.db.put('activity-item/'+owner+'/expired',{owner,state:'active',expiresAt:start-1});await f.db.put('activity-item/'+owner+'/foreign',{owner:other,state:'active'});
 await f.db.put('activity-item/'+owner+'/completed',{owner,state:'completed',expiresAt:start+100000});await f.db.put('link/revoked',{owner,revoked:true});
 let state=await read(e,new AccountFeatureState({actor:{kind:'system',owner}}));assert.equal(Object.entries(state).find(([name])=>name==='EVENT_BUSES_ENABLED')[1],true);for(const name of ['ACTIVITY_V2_ENABLED','LINKS_ENABLED'])assert.equal(state[name],false);
 await f.db.put('activity-item/'+owner+'/live',{owner,state:'active',expiresAt:null});await f.db.put('key-delegation/'+owner+'/live',{owner,state:'active'});
 state=await read(e,new AccountFeatureState({actor:{kind:'system',owner}}));for(const name of ['ACTIVITY_V2_ENABLED','LINKS_ENABLED'])assert.equal(state[name],true);
});

test('incremental boolean true preserves its former boolean read site',()=>{
 assert.equal(incrementalAuthorizationEnabled({INCREMENTAL_AUTH_ENABLED:true}),true);assert.equal(flagsFor({INCREMENTAL_AUTH_ENABLED:true}).envState('INCREMENTAL_AUTH_ENABLED').state,'force-on-legacy');
});
