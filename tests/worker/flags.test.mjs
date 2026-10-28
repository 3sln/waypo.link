import test from 'node:test';import assert from 'node:assert/strict';import {createHarness} from './harness.mjs';
const origin='https://flags.example',owner='00000000-0000-4000-8000-000000000001';
const record=extra=>({rev:1,on:true,onValue:true,fallthrough:true,salt:'worker-integration',retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null,...extra});
test('Worker console flags activate startup ports and device sessions without env rollout values or federation',async t=>{
 const h=await createHarness({adminFlags:true,bindings:{APP_ORIGIN:origin}});t.after(()=>h.close());const account=h.accounts.get(h.accounts.idFromName(owner)),connect=version=>account.invoke({method:'connectionsOwner',flagsVersion:version,args:[owner,{operation:'connections.connect-built-in',input:{integration:'google-drive'}}]});
 assert.equal((await connect(0)).$fault.code,'not_found');
 const namespace=await h.mf.getDurableObjectNamespace('ADMIN_AUTHORITY'),admin=namespace.get(namespace.idFromName('admin-v1')),flags={INTEGRATIONS_ENABLED:record(),DEVICE_AUTHORIZATION_ENABLED:record(),EVENT_BUSES_ENABLED:record()};
 const committed=await admin.invoke('commit',[{expect:{'flags-head':null},writes:{'flags-head':{version:1,issuedAt:Date.now()},...Object.fromEntries(Object.entries(flags).map(([name,row])=>['flag/'+name,row]))}}]);assert.equal(committed.committed,true);
 assert.equal((await connect(1)).kind,'app-connection','same account instance refreshes and rebuilds ports');
 const config=await(await h.mf.dispatchFetch(origin+'/api/config')).json();assert.equal(config.integrationsEnabled,true);assert.equal(config.deviceAuthorizationEnabled,true);assert.equal(config.eventBusesEnabled,true);
 assert.equal((await h.mf.dispatchFetch(origin+'/approve')).status,200,'session-kind linked approval does not require federation');
 const denied=await account.invoke({method:'connectionsOwner',flagsVersion:2,args:[owner,{operation:'connections.connect-built-in',input:{integration:'google-drive'}}]});assert.equal(denied.$fault.code,'flags_unavailable','writer cannot silently use an older edge version');
});
