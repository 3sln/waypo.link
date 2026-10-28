import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAppEngine,AppQuery,read} from '../packages/app/engine.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';import {validateRecord} from '../packages/flags/snapshot.mjs';import {FLAGS} from '../packages/flags/registry.mjs';import {flagsFor,siteEnabled,siteGlobal,existingFeature,capability} from '../packages/flags/read.mjs';
import {FlagsRuntime} from '../packages/runtime/flags.mjs';
import {nodeResources} from '../apps/node/resources.mjs';import {deviceAuthorizationEnabled,deviceGrantMountable} from '../packages/runtime/device-grant.mjs';
import {eventBusesEnabled} from '../packages/events/limits.mjs';import {brokeringFlag,integrationsFlag} from '../packages/federation/brokered.mjs';import {brokeringEnabled} from '../packages/federation/signing.mjs';
import {recognizedFields,PUBLIC_INTAKE_FRAGMENT_DOCUMENT} from '../packages/apps/connections.mjs';import {bridgeConfig} from '../packages/email-bridge/engine.mjs';import {billingEnabled} from '../packages/billing/catalog.mjs';
import {AccountStorageWriteBudget} from '../packages/runtime/storage-write-budget.mjs';
import {ConsentModel} from '../packages/consent/effects.mjs';
import {fakeClock,forEachSeed,createScheduler} from './helpers/chaos.mjs';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',client='https://client.example/app',origin='https://host.example',values=[undefined,'',true,false,'true','false','invalid',null,0,1];
const record=extra=>({rev:1,on:true,onValue:true,fallthrough:false,salt:'integration-salt',...extra}),snapshot=(flags={},version=1)=>({v:1,version,issuedAt:0,flags});
const ctx=id=>({subject:{kind:'account',owner:id},client:{clientId:client}}),port=(flags={},env={})=>createFlags({snapshot:snapshot(flags),env});
const bool=value=>value===true||value==='true',strict=value=>value==='true';
class ReadFeature extends AppQuery{static deps=['config'];fetch({config}){return {value:siteEnabled(config,this.id,ctx(this.actor.owner)),global:siteGlobal(config,this.id),readable:existingFeature(config,this.id,this.actor.owner),mount:capability(config,'EVENT_BUS_WAITS_MOUNTED')};}}
const engine=config=>createAppEngine({providers:{config,clock:fakeClock(),random:{uuid:()=>other},audit:{record(){}}}});

test('remaining domain read sites preserve legacy parsing, including booleans, exact strings and default-on enforcement',async()=>{
 for(const value of values){
  const env={EVENT_BUSES_ENABLED:value,BROKERING_ENABLED:value,INTEGRATIONS_ENABLED:value,EMAIL_BRIDGE_ENABLED:value,KEY_DELEGATION_ENABLED:value,BILLING_ENABLED:value,DEVICE_AUTHORIZATION_ENABLED:value,APP_ORIGIN:origin};
  for(const config of [env,{...env,flags:createFlags({snapshot:snapshot({},0),env})}]){
   for(const [fn,expected]of [[eventBusesEnabled,bool],[brokeringFlag,bool],[integrationsFlag,bool],[brokeringEnabled,strict],[billingEnabled,strict],[deviceAuthorizationEnabled,bool]])assert.equal(fn(config),expected(value),fn.name+' '+String(value));
   assert.equal(bridgeConfig(config).enabled,bool(value),'bridge '+String(value));// Slots are gone (extensions rev 3.2): the intake field is a recognized provider-consumable field whatever the flag;
   // the bridge flag gates the email-bridge feature, not field recognition.
   assert.ok(Object.hasOwn(recognizedFields(config),PUBLIC_INTAKE_FRAGMENT_DOCUMENT.id),'intake field '+String(value));
  }
  assert.equal(new AccountStorageWriteBudget({metadata:{},config:{STORAGE_WRITE_ENABLED:value}}).enabled,value!==false&&value!=='false');
 }
 assert.equal(deviceGrantMountable({DEVICE_AUTHORIZATION_ENABLED:true}),false,'app grant still requires federation');
 assert.equal(deviceAuthorizationEnabled({flags:port({DEVICE_AUTHORIZATION_ENABLED:record({fallthrough:true})}),FEDERATION_ENABLED:'false'}),true,'session-kind authorization is independent of federation');
});

test('engine domains accept legacy boolean true and reject targeting without a verified owner',async()=>{
 for(const raw of [true,'true',false,'false']){
  const e=createAppEngine({providers:{clock:fakeClock(),random:{uuid:()=>other},audit:{record(){}},config:{INCREMENTAL_AUTH_ENABLED:raw},consent:{model:async()=>({model:true})}}});
  try{if(bool(raw))assert.deepEqual(await read(e,new ConsentModel({input:{}})),{model:true});else await assert.rejects(read(e,new ConsentModel({input:{}})),{code:'consent_disabled'});}finally{await e.dispose();}
 }
});

test('external placements reject retention records explicitly; owner reverse/read paths survive kills after adoption',async()=>{
 for(const name of ['DEVICE_AUTHORIZATION_ENABLED','INCREMENTAL_AUTH_ENABLED','EMAIL_BRIDGE_ENABLED']){assert.equal(FLAGS[name].retainExisting,false);assert.match(FLAGS[name].retentionReason,/store|identity/);assert.throws(()=>validateRecord(name,record({retainExisting:true})),{code:'invalid_snapshot'});}
 for(const name of ['EVENT_BUSES_ENABLED','ACTIVITY_V2_ENABLED','KEY_DELEGATION_ENABLED']){
  const env={[name]:'false'},config={flags:port({[name]:record({on:false})},env)},e=engine(config);
  try{const result=await read(e,new ReadFeature({actor:{kind:'owner',owner},id:name}));assert.equal(result.value,false);assert.equal(result.readable,true);}finally{await e.dispose();}
 }
});

test('Node provisions adapters while off and console snapshots activate existing services without restart',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'flags-integration-'));let resources;t.after(async()=>{await resources?.close();await rm(directory,{recursive:true,force:true});});
 const config={APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),FEDERATION_ENTRY_ENABLED:'true',FEDERATION_CLIENTS:JSON.stringify([{id:client,name:'Fixture',origin:'https://client.example',redirectUris:['https://client.example/callback']}])};
 resources=await nodeResources({directory,config});const runtime=resources.flagsRuntime;
 assert.equal(siteGlobal(config,'FEDERATION_ENABLED'),false);assert(resources.eventWaits);assert(resources.incremental);assert.equal(resources.incremental.mounted,false);assert.equal(capability({...config,...resources.integrationConfig},'BROKERED_INTROSPECTION_MOUNTED'),false);
 const on=snapshot({FEDERATION_ENABLED:record({fallthrough:true}),INTEGRATIONS_ENABLED:record({fallthrough:true}),BROKERING_ENABLED:record({fallthrough:true}),INCREMENTAL_AUTH_ENABLED:record({fallthrough:true}),EVENT_BUSES_ENABLED:record({fallthrough:true}),DEVICE_AUTHORIZATION_ENABLED:record({fallthrough:true})},1);
 await runtime.publish(on);const controller=resources.federationShard(owner);assert.equal(await controller.ready(),true);assert.equal(capability({...config,...resources.integrationConfig},'BROKERED_INTROSPECTION_MOUNTED'),true);assert.equal(deviceGrantMountable(config),true);assert.equal(resources.incremental.mounted,true);
 await runtime.publish(snapshot(Object.fromEntries(Object.keys(on.flags).map(name=>[name,record({on:false})])),2));assert.equal(await controller.ready(),false);assert.equal(capability({...config,...resources.integrationConfig},'BROKERED_INTROSPECTION_MOUNTED'),false);
});

test('seeded overlapping adapter scopes and writer ports retain their pinned snapshot after publication',async()=>{
 await forEachSeed(8,async random=>{
  const clock=fakeClock(),runtime=new FlagsRuntime({clock:clock.now}),config={FLAGS_RUNTIME:runtime},e=engine(config),scheduler=createScheduler(random);await runtime.publish(snapshot({EVENT_BUSES_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})},1));const first=await runtime.pin();
  await runtime.publish(snapshot({EVENT_BUSES_ENABLED:record({on:false})},2));const second=await runtime.pin();
  const reads=await scheduler.run([()=>runtime.run(first,()=>read(e,new ReadFeature({actor:{kind:'owner',owner},id:'EVENT_BUSES_ENABLED'}))),()=>runtime.run(second,()=>read(e,new ReadFeature({actor:{kind:'owner',owner},id:'EVENT_BUSES_ENABLED'})))]);
  assert.equal(reads[0].value.value,true);assert.equal(reads[1].value.value,false);await e.dispose();
 });
});
