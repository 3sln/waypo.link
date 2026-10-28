// FF-5a owns only runtime routes: run explicitly with node --test packages/runtime/routes/flags.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';
import {createMemoryEngine,OWNER,OTHER} from '../../app/memory-providers.mjs';
import {FlagsRuntime} from '../flags.mjs';
import {createFlags} from '../../flags/evaluate.mjs';
import {forEachSeed,createScheduler,injectFaults,fakeClock} from '../../../tests/helpers/chaos.mjs';
import application from '../http.mjs';
import {flagEnabled,flagGlobal,flagReadable,signupEnabled,sessionFeatures} from './shared.mjs';
import {stages as events} from './events.mjs';
import {stages as connections} from './connections.mjs';
import {stages as integrations} from './integrations.mjs';
import {stages as incremental} from './incremental.mjs';
import {stages as notifications} from './notifications.mjs';
import {stages as links} from './links.mjs';
import {stages as delegation} from './delegation.mjs';
import {stages as appSessions} from './app-sessions.mjs';
import {stages as emailBridge} from './email-bridge.mjs';
const origin='https://provider.example',ctx=owner=>({subject:{kind:'account',owner}});
const request=(path,method='GET',value,headers={})=>new Request(origin+path,{method,headers:{Origin:origin,...value===undefined?{}:{'Content-Type':'application/json'},...headers},...value===undefined?{}:{body:JSON.stringify(value)}});
const route=(env,path,method='GET',value,extra={})=>({env,path,request:request(path,method,value),url:new URL(origin+path),local:false,id:OWNER,owner:{account:{id:OWNER}},...extra});
async function fixture(t,{env={},...options}={}){
 const f=await createMemoryEngine({config:{RELEASE_READY:'true',...env},...options}),actor={kind:'boot',expect:{'boot/principal':1}};t.after(()=>f.dispose());
 await f.flagStore.commit({expect:{'boot/principal':null},writes:{'boot/principal':{active:true}}});
 const call=(op,input)=>f.run('flags.'+op,{actor,input});
 const change=async(op,name,extra={})=>{const {record,version}=await call('get',{name}),input={name,expectedRevision:record?.rev??null,expectedVersion:version,...extra},preview=await call('preview',{...input,action:op});return call(op,{...input,stepUpAt:f.clock.now(),stepUpMethod:'passkey',reason:'Runtime route targeting verification.',typedName:name,previewDigest:preview.digest,acknowledgeGates:preview.requiredGates});};
 const edit=async(name,patch)=>{let {record}=await call('get',{name});if(!record)record=(await change('take-control',name)).record;return change('update',name,{record:{...record,...patch}});};
 const runtime=new FlagsRuntime({store:f.flagStore,env,clock:f.clock.now});
 const ports=async req=>{runtime.invalidate();return {APP_ORIGIN:origin,...env,flags:await runtime.pin({request:req})};};
 return {...f,call,edit,ports,runtime};
}

test('legacy read-site table preserves strict strings, boolean sites, mount capability and signup defaults',async()=>{
 for(const raw of [undefined,'','false',false,'true',true,'invalid']){
  const env={APP_ORIGIN:origin,ACTIVITY_V2_ENABLED:raw,INTEGRATIONS_ENABLED:raw,EVENT_BUSES_ENABLED:raw,LINKS_ENABLED:raw,EXTENSIONS_ENABLED:raw,SEMANTIC_SEARCH_ENABLED:raw,WAITLIST_ENABLED:raw,FEDERATION_ENABLED:raw,MCP_ENABLED:raw};
  for(const [name,strict,expected]of [['ACTIVITY_V2_ENABLED',false,raw===true||raw==='true'],['ACTIVITY_V2_ENABLED',true,raw==='true'],['INTEGRATIONS_ENABLED',false,raw===true||raw==='true'],['INTEGRATIONS_ENABLED',true,raw==='true'],['EVENT_BUSES_ENABLED',false,raw===true||raw==='true'],['EVENT_BUSES_ENABLED',true,raw==='true'],['LINKS_ENABLED',true,raw==='true'],['EXTENSIONS_ENABLED',false,raw===true||raw==='true'],['SEMANTIC_SEARCH_ENABLED',true,raw==='true'],['WAITLIST_ENABLED',true,raw==='true']])assert.equal(flagEnabled(env,name,{},strict),expected,`${name}, strict=${strict}, raw=${String(raw)}`);
  for(const name of ['FEDERATION_ENABLED','MCP_ENABLED'])assert.equal(flagGlobal(env,name),raw==='true');
 }
 const ready={RECOVERY_SIGNING_KEY:'key',TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secret',KEY_ENCRYPTION_KEY:'key'};
 assert.equal(flagEnabled({PAID_SIGNUP_ENABLED:'true'},'PAID_SIGNUP_ENABLED'),false,'billing configuration is still required');
 for(const [patch,expected]of [[{},false],[{RELEASE_READY:'true'},true],[{SIGNUP_ENABLED:'true'},true],[{SIGNUP_ENABLED:'false',LOCAL_DEVELOPMENT:'true'},false],[{LOCAL_DEVELOPMENT:'true'},true],[{SIGNUP_ENABLED:'true',SIGNUP_CONTACT_REQUIRED:'true'},false],[{SIGNUP_ENABLED:'true',SIGNUP_CONTACT_REQUIRED:'true',EMAIL_SETUP_AVAILABLE:true},true],[{SIGNUP_ENABLED:'true',SIGNUP_CONTACT_REQUIRED:'true',EMAIL_SETUP_AVAILABLE:'true'},false],[{SIGNUP_ENABLED:'true',RECOVERY_SIGNING_KEY:''},false]])assert.equal(signupEnabled({...ready,...patch}),expected,JSON.stringify(patch));
});

test('engine region rules reach anonymous config, signup and waitlist without leaking configuration',async t=>{
 const f=await fixture(t,{env:{RECOVERY_SIGNING_KEY:'key',TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secret',KEY_ENCRYPTION_KEY:'key',WAITLIST_MAIL_AVAILABLE:true}});
 for(const name of ['SIGNUP_ENABLED','WAITLIST_ENABLED'])await f.edit(name,{on:true,fallthrough:false,rules:[{when:{countries:['MX']},serve:{value:true}}]});
 for(const [country,trusted,expected]of [['MX',true,true],['US',true,false],['MX',false,false]]){
  const req=request('/api/config','GET',undefined,trusted?{'CF-Connecting-IP':'198.51.100.4'}:{});Object.defineProperty(req,'cf',{value:{country,regionCode:'YUC'}});
  const env=await f.ports(req),response=await application.fetch(req,env),value=await response.json();assert.equal(value.signupEnabled,expected);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  const status=await application.fetch(new Request(origin+'/api/signup/status'),env),data=await status.json();assert.equal(data.waitlistEnabled,expected);assert.equal(status.headers.get('Cache-Control'),'private, no-store');
  for(const key of ['rules','salt','reason','version','experimentId','deny'])assert(!Object.hasOwn(value,key));
 }
});

test('engine account and percentage rules reach route creates and session features; kills and dependencies win',async t=>{
 const f=await fixture(t);await f.edit('EVENT_BUSES_ENABLED',{on:true,fallthrough:false,rules:[{when:{accounts:[OWNER]},serve:{value:true}}]});
 let env=await f.ports(),calls=[];const object={admitWork:async()=>{},eventBusOwner:async(id,value)=>{calls.push({id,value});return {created:true,buses:[]};}};
 assert.equal((await events.owner(route(env,'/api/events/buses','POST',{url:'https://app.example/manifest'},{object}))).status,200);
 assert.equal((await events.owner(route(env,'/api/events/buses','POST',{url:'https://app.example/manifest'},{object,id:OTHER}))).status,409);assert.equal(calls.length,1);
 await f.edit('ACTIVITY_V2_ENABLED',{on:true,fallthrough:false,rules:[{when:{subject:'account'},serve:{percent:5000,value:true}}]});env=await f.ports();let enabled=0,disabled=0;
 for(let n=1;n<=80;n++){const owner=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,features=sessionFeatures(env,owner),expected=(await f.call('evaluate',{name:'ACTIVITY_V2_ENABLED',context:ctx(owner)})).value;assert.equal(features.activityV2Enabled,expected);expected?enabled++:disabled++;assert(Object.values(features).every(v=>typeof v==='boolean'));}assert(enabled&&disabled);
 const killed=new FlagsRuntime({store:f.flagStore,env:{EVENT_BUSES_ENABLED:'false'},clock:f.clock.now});assert.equal((await events.owner(route({flags:await killed.pin()},'/api/events/buses','POST',{}, {object}))).status,409);
 await f.edit('FEDERATION_ENABLED',{on:true,fallthrough:true});await f.edit('INCREMENTAL_AUTH_ENABLED',{on:true,fallthrough:true});env=await f.ports();assert.equal(sessionFeatures({...env,INCREMENTAL_AUTHORIZATION:{mounted:true}},OWNER).incrementalAuthEnabled,true);
 const dependency=new FlagsRuntime({store:f.flagStore,env:{FEDERATION_ENABLED:'false'},clock:f.clock.now});env={flags:await dependency.pin(),INCREMENTAL_AUTHORIZATION:{mounted:true,suppressionAdd:async()=>assert.fail('dependency kill must refuse')}};
 assert.equal((await incremental.beforeActivity(route(env,'/api/incremental/suppressions','POST',{client:'https://app.example/client'}))).status,409);
});

test('engine rollout gates connections, classifier offerings, brokered creates and activity push widening',async t=>{
 const f=await fixture(t);for(const name of ['INTEGRATIONS_ENABLED','EXTENSIONS_ENABLED','ACTIVITY_V2_ENABLED'])await f.edit(name,{on:true,fallthrough:false,rules:[{when:{accounts:[OWNER]},serve:{value:true}}]});
 const env=await f.ports(),object={connectionsOwner:async()=>({connections:[]}),activityPush:async()=>({enabled:false})};
 for(const [id,status]of [[OWNER,200],[OTHER,409]])assert.equal((await connections.owner(route(env,'/api/connections/owner','POST',{operation:'connections.connect-built-in',input:{integration:'google-drive'}},{id,object}))).status,status);
 const list=await connections.owner(route(env,'/api/connections/owner','POST',{operation:'connections.list'},{id:OTHER,object}));assert.equal(list.status,200);assert(!(await list.json()).offerings.some(v=>v.id==='classifier'));
 assert.equal((await integrations.owner(route(env,'/api/integrations/records','POST',{}, {id:OTHER,object}))).status,409);
 assert.equal((await notifications.owner(route(env,'/api/notifications/activity','PUT',{enabled:true},{id:OTHER,object}))).status,409);
 assert.equal((await notifications.owner(route(env,'/api/notifications/activity','PUT',{enabled:false},{id:OTHER,object}))).status,200);
});

test('client rollout uses verified directory metadata and persisted connections; headers cannot select a client',async t=>{
 const f=await fixture(t),clientId='https://app.example/client';await f.edit('INTEGRATIONS_ENABLED',{on:true,fallthrough:false,rules:[{when:{clients:[clientId]},serve:{value:true}}]});
 const env={...await f.ports(),FEDERATION_AUTHORITY:{directory:{enabled:true,resolve:async()=>({id:clientId,integration:{status:'valid'},initiateLoginUri:'https://app.example/start'})}}},object={admitWork:async()=>{},connectionsOwner:async()=>({connections:[{id:OWNER,clientId}]})};
 assert.equal((await connections.owner(route(env,'/api/connections/client-metadata','POST',{clientId:'https://unverified.example/client'},{object}))).status,200);
 assert.equal((await connections.owner(route(env,'/api/connections/owner','POST',{operation:'connections.resume',id:OWNER},{object}))).status,200);
 assert.equal((await connections.owner(route(env,'/api/connections/owner','POST',{operation:'connections.connect-built-in',input:{integration:'google-drive'}},{object,request:request('/api/connections/owner','POST',{operation:'connections.connect-built-in',input:{integration:'google-drive'}},{'X-Client-Id':clientId})}))).status,409);
});

test('cold store outage fails safe even for unmanaged legacy children; explicit dependency kills still win',async()=>{
 const runtime=new FlagsRuntime({env:{INCREMENTAL_AUTH_ENABLED:'true',DEVICE_AUTHORIZATION_ENABLED:'true'},store:{flagsSnapshot:async()=>{throw Error('store unavailable');}}}),env={flags:await runtime.pin()};
 for(const name of ['INCREMENTAL_AUTH_ENABLED','DEVICE_AUTHORIZATION_ENABLED']){assert.equal(flagEnabled(env,name),false);assert.equal(flagGlobal(env,name),false);}
 assert.equal(flagEnabled({INCREMENTAL_AUTH_ENABLED:'true'},'INCREMENTAL_AUTH_ENABLED'),true,'unmanaged independent default matches the old route');
 assert.equal(flagEnabled({INCREMENTAL_AUTH_ENABLED:'true',FEDERATION_ENABLED:'false'},'INCREMENTAL_AUTH_ENABLED'),false);
});

test('email bridge targets the verified recipient owner and keeps settings, acceptance status and opt-out accessible',async t=>{
 const f=await fixture(t);await f.edit('LINKS_ENABLED',{on:true,fallthrough:true});await f.edit('EMAIL_BRIDGE_ENABLED',{on:true,fallthrough:false,rules:[{when:{accounts:[OWNER]},serve:{value:true}}]});
 const env={...await f.ports(),EMAIL_BRIDGE_OWNER:{settings:async()=>({enabled:false}),configure:async(_,input)=>input,accepted:async()=>({status:'accepted'})}},object={emailBridgeEntitled:async()=>true};
 assert.equal((await emailBridge.owner(route(env,'/api/email-bridge','PUT',{enabled:true},{id:OWNER,object}))).status,200);
 assert.equal((await emailBridge.owner(route(env,'/api/email-bridge','PUT',{enabled:true},{id:OTHER,object}))).status,409);
 for(const [path,method,input]of [['/api/email-bridge','GET'],['/api/email-bridge','PUT',{enabled:false}],['/api/email-bridge/accepted','POST',{jti:'existing-receipt'}]])assert.equal((await emailBridge.owner(route(env,path,method,input,{id:OTHER,object}))).status,200);
 // Messaging extraction prep: a links (formerly messaging-app) kill no longer touches the bridge.
 let runtime=new FlagsRuntime({store:f.flagStore,env:{LINKS_ENABLED:'false',BINDLEBOX_ENABLED:'false'},clock:f.clock.now});env.flags=await runtime.pin();assert.equal((await emailBridge.owner(route(env,'/api/email-bridge','PUT',{enabled:true},{id:OWNER,object}))).status,200);
 runtime=new FlagsRuntime({store:f.flagStore,env:{EMAIL_BRIDGE_ENABLED:'false'},clock:f.clock.now});env.flags=await runtime.pin();assert.equal((await emailBridge.owner(route(env,'/api/email-bridge','PUT',{enabled:true},{object}))).status,409);assert.equal((await emailBridge.owner(route(env,'/api/email-bridge','PUT',{enabled:false},{object}))).status,200);
});

test('owner reads, status and reversal remain available through deny, console off, env kills and outages after adoption',async t=>{
 const f=await fixture(t);for(const name of ['EVENT_BUSES_ENABLED','LINKS_ENABLED','INTEGRATIONS_ENABLED','ACTIVITY_V2_ENABLED','DEVICE_AUTHORIZATION_ENABLED'])await f.edit(name,{on:false,deny:{accounts:[OWNER],clients:[]}});
 const base=await f.ports(),env={...base,INCREMENTAL_AUTHORIZATION:{mounted:true,suppressionList:async()=>({suppressions:[]}),suppressionRemove:async()=>({removed:true})},FEDERATION_AUTHORITY:{ready:()=>true,appSessions:async()=>({sessions:[]})}};
 const object={eventBusOwner:async()=>({buses:[]}),listLinks:async()=>({links:[]}),revokeLink:async()=>({revoked:true}),listDelegations:async()=>({delegations:[]}),revokeDelegations:async()=>({revoked:true}),integrationsOwner:async()=>({records:[]}),connectionsOwner:async()=>({connections:[]}),activityPush:async()=>({enabled:false})};
 const cases=[[events.owner,'/api/events/buses','GET'],[events.owner,'/api/events/buses/'+OWNER,'DELETE'],[links.owner,'/api/links','GET'],[links.owner,'/api/links/'+OWNER+'/revoke','POST',{}],[delegation.owner,'/api/delegations','GET'],[delegation.owner,'/api/delegations/revoke','POST',{}],[integrations.owner,'/api/integrations/records','GET'],[connections.owner,'/api/connections/owner','POST',{operation:'connections.list'}],[notifications.owner,'/api/notifications/activity','GET'],[incremental.beforeActivity,'/api/incremental/suppressions','GET'],[incremental.beforeActivity,'/api/incremental/suppressions/'+OWNER,'DELETE'],[appSessions.beforeActivity,'/api/app-sessions','DELETE']];
 for(const [handle,path,method,value]of cases){const response=await handle(route(env,path,method,value,{object}));assert.equal(response?.status,200,`${method} ${path}`);}
 assert.equal(flagReadable({...env,flags:createFlags({snapshot:await f.flagStore.flagsSnapshot(),env:{EVENT_BUSES_ENABLED:'false'}})},'EVENT_BUSES_ENABLED'),true);
 f.runtime.store={flagsSnapshot:async()=>{throw Error('outage');}};f.clock.advance(3600001);env.flags=await f.runtime.pin();assert.equal((await events.owner(route(env,'/api/events/buses','GET',undefined,{object}))).status,200);assert.equal((await events.owner(route(env,'/api/events/buses','POST',{}, {object}))).status,409);
});

test('protocol global components ignore account/client targeting, while account values stay private',async t=>{
 const f=await fixture(t);await f.edit('FEDERATION_ENABLED',{on:true,fallthrough:true});await f.edit('DEVICE_AUTHORIZATION_ENABLED',{on:true,fallthrough:false,rules:[{when:{accounts:[OWNER]},serve:{value:true}}]});
 const env=await f.ports();assert.equal(flagGlobal(env,'DEVICE_AUTHORIZATION_ENABLED'),true);assert.equal(sessionFeatures(env,OWNER).deviceAuthorizationEnabled,true);assert.equal(sessionFeatures(env,OTHER).deviceAuthorizationEnabled,false);
 const response=await application.fetch(request('/api/session'),{...env,IDENTITY_ENGINE:async()=>({query:()=>({peek:async()=>({account:{id:OTHER}})}),dispose(){}})});assert.equal(response.headers.get('Cache-Control'),'private, no-store');const value=await response.json();assert.equal(value.features.deviceAuthorizationEnabled,false);assert(Object.values(value.features).every(v=>typeof v==='boolean'));
 for(const secret of ['salt','deny','rules','reason','variantSalt','version','experimentId'])assert(!Object.hasOwn(value.features,secret));
});

test('seeded concurrent snapshot refreshes never mix anonymous config and account assignments within a pin',async t=>{
 await forEachSeed(8,async random=>{
  const f=await fixture(t,{seed:random.seed});await f.edit('ACTIVITY_V2_ENABLED',{on:true,fallthrough:false,rules:[{when:{accounts:[OWNER]},serve:{value:true}}]});
  const scheduler=createScheduler(random),clock=fakeClock(f.clock.now()),store=scheduler.wrap(injectFaults({flagsSnapshot:()=>f.flagStore.flagsSnapshot()},[{method:'flagsSnapshot',when:.25}],{random}),'flags'),initial=await f.flagStore.flagsSnapshot();await f.edit('ACTIVITY_V2_ENABLED',{rules:[{when:{accounts:[OTHER]},serve:{value:true}}]});
  const results=await scheduler.run(Array.from({length:12},(_,n)=>async()=>{const runtime=new FlagsRuntime({store,clock:clock.now,platform:'node'});runtime.accept(initial,clock.now()-16000);const flags=await runtime.pin(),env={flags},before=sessionFeatures(env,OWNER);await Promise.resolve();assert.deepEqual(sessionFeatures(env,OWNER),before);assert.equal(sessionFeatures(env,OTHER).activityV2Enabled,!before.activityV2Enabled);assert.equal(flagEnabled(env,'ACTIVITY_V2_ENABLED'),false);return {version:flags.version,n};}));
  assert(results.every(r=>r.status==='fulfilled'));assert(results.every(r=>[2,3].includes(r.value.version)));
 });
});
