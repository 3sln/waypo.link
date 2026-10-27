// FF-5c: cutover guard plus domain read-site compatibility/targeting evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {FLAG_NAMES} from '../packages/flags/registry.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {FlagsRuntime} from '../packages/runtime/flags.mjs';
import {onboardingEnabled,onboardingOnly} from '../packages/identity/onboarding.mjs';
import {delegationsEnabled,delegationsProvider,IssueDelegation,RevokeDelegation,DelegationList} from '../packages/identity/delegation.mjs';
import {paidSignupEnabled} from '../packages/billing/signup.mjs';
import {activityEnabled} from '../packages/activity/index.mjs';
import {integrationsEnabled,connectionsProvider,ConnectBuiltIn,ConnectionList,DisconnectConnection} from '../packages/app/domains/connections.mjs';
import {handleMcpPublic,handleMcpOwner} from '../packages/mcp/http.mjs';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {createTestEngine} from './helpers/app-engine.mjs';
import {manifest} from './event-bus-fixture.mjs';
import {busKeys} from '../packages/events/index.mjs';
import {eventBusProvider,CreateEventBus,EventBuses,DeleteEventBus,SweepEventBuses,RevokeEventBusReader} from '../packages/app/domains/events.mjs';
import {fakeClock,forEachSeed,createScheduler,injectFaults} from './helpers/chaos.mjs';

// Coordinator flips this after FF-5a/b land. Never silently grandfather other files.
const ALL_READ_SITES_MIGRATED=true;
const pending=path=>path.startsWith('packages/runtime/routes/')||path.startsWith('packages/runtime/account/')||['packages/runtime/http.mjs','packages/runtime/accounts.mjs',...['lifecycle-runner','integration-ports','integration-events','federation','incremental-authorization','device-grant','app-notifications'].map(name=>`packages/runtime/${name}.mjs`)].includes(path);
const adapters=new Set(['apps/worker/index.mjs','apps/worker/objects.mjs','apps/node/server.mjs','apps/node/resources.mjs']);
const derived=new Set(['BROKERED_INTROSPECTION_MOUNTED','EVENT_BUS_WAITS_MOUNTED','PUSH_AVAILABLE','EMAIL_AVAILABLE','EMAIL_SETUP_AVAILABLE','WAITLIST_MAIL_AVAILABLE','ADMIN_CLAIMS_ENABLED']);
const names=new Set(FLAG_NAMES);
// Lexical scan: comments and quoted text cannot manufacture reads. Keep quoted
// keys for env['FLAG']; templates retain their interpolation expressions.
function tokens(source){
 const result=[];let i=0;
 const push=(at,end,kind='code')=>{result.push({value:source.slice(at,end),at,kind});i=end;};
 const quoted=quote=>{const at=i++;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]===quote)break;}push(at,i,'literal');};
 const regexAllowed=()=>{const last=result.at(-1);return !last||last.kind!=='literal'&&['(','[','{',',',';',':','=','=>','!','?','&&','||','??','return','throw','case','yield','await','${'].includes(last.value);};
 function template(){i++;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]==='`'){i++;return;}if(source[i]==='$'&&source[i+1]==='{'){push(i,i+2);scan(true);}else i++;}}
 function scan(interpolation=false){let depth=0;while(i<source.length){
  const c=source[i],at=i;if(/\s/.test(c)){i++;continue;}
  if(c==='/'&&source[i+1]==='/'){i=source.indexOf('\n',i+2);if(i<0)i=source.length;continue;}
  if(c==='/'&&source[i+1]==='*'){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;continue;}
  if(c==='"'||c==="'"){quoted(c);continue;}if(c==='`'){template();continue;}
  if(c==='/'&&regexAllowed()){i++;let bracket=false;while(i<source.length){const x=source[i++];if(x==='\\'){i++;continue;}if(x==='[')bracket=true;if(x===']')bracket=false;if(x==='/'&&!bracket)break;}while(/[A-Za-z]/.test(source[i]??''))i++;push(at,i,'literal');continue;}
  if(/[A-Za-z_$]/.test(c)){i++;while(/[\w$]/.test(source[i]??''))i++;push(at,i);continue;}
  if(/[0-9]/.test(c)){i++;while(/[\w.]/.test(source[i]??''))i++;push(at,i,'literal');continue;}
  if(c==='}') {if(interpolation&&depth===0){push(i,i+1);return;}depth--;}if(c==='{')depth++;
  const op=['===','!==','?.','==','!=','=>','&&','||','??'].find(v=>source.startsWith(v,i));push(at,i+(op?.length??1));
 }}scan();return result;
}
function rawReads(source){const list=tokens(source),reads=[];for(let i=0;i<list.length;i++){
 const t=list[i],v=t.value,prev=list[i-1]?.value,next=list[i+1]?.value;
 if(names.has(v)&&['.','?.'].includes(prev)&&next!=='=')reads.push({name:v,at:t.at,receiver:list[i-2]?.value});
 if(/^['"]/.test(v)&&names.has(v.slice(1,-1))&&prev==='['&&/^[A-Za-z_$][\w$]*$|^[\])]+$/.test(list[i-2]?.value??'')&&next===']'&&list[i+2]?.value!=='=')reads.push({name:v.slice(1,-1),at:t.at,receiver:list[i-2]?.value});
 // Binding patterns: const {FLAG[: alias]} = env (including nested patterns).
 if(['const','let','var'].includes(v)&&next==='{'){let end=i+1,depth=0;do{if(list[end].value==='{')depth++;if(list[end].value==='}')depth--;end++;}while(end<list.length&&depth);if(list[end]?.value==='=')for(let j=i+2;j<end-1;j++)if(names.has(list[j].value))reads.push({name:list[j].value,at:list[j].at});}
 }return reads.map(r=>({...r,line:source.slice(0,r.at).split('\n').length}));}
async function sources(dir){const files=[];for(const entry of await readdir(new URL('../'+dir+'/',import.meta.url),{withFileTypes:true})){const path=dir+'/'+entry.name;if(path==='apps/parlay'||/^packages\/messaging-(engine|protocol)\//.test(path))continue;if(entry.isDirectory())files.push(...await sources(path));else if(/\.[cm]?js$/.test(path)&&!path.endsWith('.test.mjs'))files.push(path);}return files;}

test('raw-env guard recognizes dot, optional, bracket and destructured reads, excludes writes/comments/strings',()=>{
 assert.equal(rawReads(`env.ACTIVITY_V2_ENABLED; config?.ACTIVITY_V2_ENABLED; env['ACTIVITY_V2_ENABLED']; const {ACTIVITY_V2_ENABLED: activity}=env;`).length,4);
 assert.equal(rawReads('env.ACTIVITY_V2_ENABLED = value; const x={ACTIVITY_V2_ENABLED: true}; // env.ACTIVITY_V2_ENABLED\n "env.ACTIVITY_V2_ENABLED";').length,0);
 assert.equal(rawReads('`text ${env.ACTIVITY_V2_ENABLED} nested ${`text ${env.SIGNUP_ENABLED}`} end`').length,2);
 assert.equal(rawReads("const pattern=/['\"]env.ACTIVITY_V2_ENABLED/; env.SIGNUP_ENABLED;").length,1);
});
test('registry flags have no raw reads outside the env parser and adapter capability derivation',async t=>{
 const violations=[],remaining=[];
 for(const path of [...await sources('packages'),...await sources('apps')]){
  if(path==='packages/flags/env.mjs')continue;const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
  for(const hit of rawReads(source)){
   // The browser/SDK config is the evaluated public feature map (§8), never env.
   if((path.startsWith('apps/web/')||path.startsWith('packages/sdk/'))&&hit.receiver==='config')continue;
   if(adapters.has(path)&&derived.has(hit.name))continue;const message=`${path}:${hit.line} ${hit.name}`;if(!ALL_READ_SITES_MIGRATED&&pending(path))remaining.push(message);else violations.push(message);
  }
 }
 t.diagnostic(`FF-5a/b remaining raw read count: ${remaining.length} (${new Set(remaining.map(v=>v.split(':')[0])).size} files); all-sites constant=${ALL_READ_SITES_MIGRATED}`);
 t.diagnostic(`Other remaining raw read count: ${violations.length} (${new Set(violations.map(v=>v.split(':')[0])).size} files)`);
 assert.equal(violations.length,0,`Unowned raw reads require coordinator migration:\n${violations.join('\n')}`);
});

const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',client='agent.example',origin='https://flags.example';
const context=id=>({subject:{kind:'account',owner:id},client:{clientId:client}}),record=extra=>({rev:1,on:true,onValue:true,fallthrough:false,salt:'ff5c-salt',retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null,...extra}),snapshot=(flags={},version=1)=>({v:1,version,issuedAt:0,flags}),port=(flags={},env={},options={})=>createFlags({snapshot:snapshot(flags),env,...options});
const billing={BILLING_ENABLED:'true',POLAR_ACCESS_TOKEN:'fixture',POLAR_WEBHOOK_SECRET:'fixture',POLAR_SERVER:'sandbox',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra'};
const values=[undefined,'','false','true',false,true,'invalid',0,1];

test('each migrated helper preserves its old predicate with no console records, including parser quirks',()=>{
 for(const enabled of [activityEnabled,integrationsEnabled,delegationsEnabled])for(const config of [undefined,null,{}])assert.equal(enabled(config),false);
 for(const raw of values){
  for(const flags of [undefined,port({}, {ACTIVITY_V2_ENABLED:raw,INTEGRATIONS_ENABLED:raw,LINKS_ENABLED:raw,PAID_SIGNUP_ENABLED:raw,...billing})]){
   const config={ACTIVITY_V2_ENABLED:raw,INTEGRATIONS_ENABLED:raw,LINKS_ENABLED:raw,PAID_SIGNUP_ENABLED:raw,...billing,...flags?{flags}:{}};
   assert.equal(activityEnabled(config,context(owner)),raw==='true',`activity ${raw}`);
   assert.equal(integrationsEnabled(config,context(owner)),raw===true||raw==='true',`integrations ${raw}`);
   assert.equal(delegationsEnabled(config,context(owner)),raw===true||raw==='true',`delegations ${raw}`);
   assert.equal(paidSignupEnabled(config),raw==='true',`paid ${raw}`);
  }
  for(const onboarding of values){const config={ONBOARDING_ENABLED:onboarding,SIGNUP_ENABLED:raw};assert.equal(onboardingOnly(config),onboarding==='true'&&raw==='false');assert.equal(onboardingOnly({...config,flags:port({},config)}),onboarding==='true'&&raw==='false');}
  assert.equal(onboardingEnabled({ONBOARDING_ENABLED:raw,ONBOARDING_KEY:Buffer.alloc(32,73).toString('base64url'),ONBOARDING_NAMES:'["alice"]'}),raw==='true');
 }
 assert.equal(onboardingEnabled({ONBOARDING_ENABLED:'true'}),false,'missing signing key still refuses');
 assert.equal(paidSignupEnabled({PAID_SIGNUP_ENABLED:'true'}),false,'missing billing configuration still refuses');
});

test('owner/client targeting and percentage now control the domain helpers; kill and outage fail closed',()=>{
 for(const [name,enabled]of [['ACTIVITY_V2_ENABLED',activityEnabled],['INTEGRATIONS_ENABLED',integrationsEnabled],['LINKS_ENABLED',delegationsEnabled]]){
  const rules=[{when:{accounts:[owner]},serve:{value:true}}],flags=port({[name]:record({rules})});
  assert.equal(enabled({flags},context(owner)),true);assert.equal(enabled({flags},context(other)),false);assert.equal(enabled({flags}),false);
  assert.equal(enabled({flags:port({[name]:record({rules:[{when:{},serve:{value:true,percent:10000}}]})})},context(owner)),true);
  assert.equal(enabled({flags:port({[name]:record({rules:[{when:{},serve:{value:true,percent:0}}]})})},context(owner)),false);
  assert.equal(enabled({flags:port({[name]:record({fallthrough:true})},{[name]:'false'})},context(owner)),false);
  assert.equal(enabled({flags:createFlags({snapshot:null,env:{[name]:'true'}})},context(owner)),false);
 }
 const flags=port({INTEGRATIONS_ENABLED:record({rules:[{when:{clients:[client]},serve:{value:true}}]}),ACTIVITY_V2_ENABLED:record({rules:[{when:{clients:[client]},serve:{value:true}}]})});
 for(const enabled of [integrationsEnabled,activityEnabled]){assert.equal(enabled({flags},context(owner)),true);assert.equal(enabled({flags},{...context(owner),client:{clientId:'excluded.example'}}),false);}
});

test('signup helpers use trusted request geo, preserve capabilities, and retain last-known during store outage',async()=>{
 const clock=fakeClock(),flags=snapshot({SIGNUP_ENABLED:record({rules:[{when:{countries:['US']},serve:{value:true}}]}),PAID_SIGNUP_ENABLED:record({rules:[{when:{countries:['US']},serve:{value:true}}]})});
 const runtime=new FlagsRuntime({env:billing,clock:clock.now,store:{flagsSnapshot:async()=>flags}});
 for(const [country,trusted,paid,only]of [['US',true,true,false],['CA',true,false,true],['US',false,false,true]]){
  const request=new Request(origin,{headers:trusted?{'CF-Connecting-IP':'192.0.2.1'}:{}});request.cf={country};const pinned=await runtime.pin({request});
  assert.equal(paidSignupEnabled({...billing,flags:pinned}),paid);assert.equal(onboardingOnly({ONBOARDING_ENABLED:'true',flags:pinned}),only);
 }
 runtime.store.flagsSnapshot=async()=>{throw Error('offline');};clock.advance(3600001);const request=new Request(origin,{headers:{'CF-Connecting-IP':'192.0.2.1'}});request.cf={country:'US'};
 assert.equal(paidSignupEnabled({...billing,flags:await runtime.pin({request})}),true);
 assert.equal(paidSignupEnabled({...billing,flags:port(flags.flags,{...billing,BILLING_ENABLED:'false'})}),false,'billing dependency killed');
 assert.equal(paidSignupEnabled({...billing,flags:port(flags.flags,{...billing,PAID_SIGNUP_ENABLED:'false'})}),false);
});

const engine=providers=>createAppEngine({providers:{clock:fakeClock(),random:{uuid:()=>other},audit:{record(){}},...providers}});
test('real delegation and connections Actions honor evaluated owner rollout at composition',async()=>{
 const records=rules=>({LINKS_ENABLED:record({rules}),INTEGRATIONS_ENABLED:record({rules})}),targeted=records([{when:{accounts:[owner]},serve:{value:true}}]);
 // Known buckets for ff5c-salt: owner=1482, other=2250, so a 20% ramp admits only owner.
 const scenarios=[port(targeted),port(records([{when:{},serve:{value:true,percent:2000}}])),port(targeted,{LINKS_ENABLED:'false',INTEGRATIONS_ENABLED:'false'}),createFlags({snapshot:null})];
 for(const [index,flags]of scenarios.entries())for(const id of [owner,other]){
  const actor={kind:'owner',owner:id},allowed=index<2&&id===owner,registry={issue:async()=>({issued:true}),list:async()=>[],revoke:async()=>({revoked:true})};
  const delegation=engine({delegations:delegationsProvider({registry,flags})});
  const issuing=perform(delegation,new IssueDelegation({actor:{kind:'app',owner:id,clientId:client},input:{}}));
  if(allowed)assert.deepEqual(await issuing,{issued:true});else await assert.rejects(issuing,{code:'not_found'});
  assert.deepEqual(await read(delegation,new DelegationList({actor})),[]);assert.deepEqual(await perform(delegation,new RevokeDelegation({actor,input:{all:true}})),{revoked:true});
  const service={metadata:{get:async()=>id},connectBuiltIn:async()=>({connected:true}),list:async()=>[],slots:async()=>[],disconnect:async()=>({disconnected:true})},connections=engine({connections:connectionsProvider({connections:service,flags})});
  const connecting=perform(connections,new ConnectBuiltIn({actor,input:{integration:'builtin'}}));if(allowed)assert.deepEqual(await connecting,{connected:true});else await assert.rejects(connecting,{code:'not_found'});
  assert.deepEqual(await read(connections,new ConnectionList({actor})),{connections:[],slots:[]});assert.deepEqual(await perform(connections,new DisconnectConnection({actor,input:{connection:other}})),{disconnected:true});
  await delegation.dispose();await connections.dispose();
 }
});

test('event Actions target new authority per bus owner; owner deletion/revocation and console-off sweeps survive',async t=>{
 const config={flags:port({EVENT_BUSES_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})})},keys=await busKeys({KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}),f=await createTestEngine({providers:{eventBus:eventBusProvider({config,keys:async()=>keys,issuer:origin,plan:'free'})}});t.after(()=>f.dispose());
 const actor={kind:'owner',owner},system={kind:'system',owner},document=manifest(),create=()=>f.perform(new CreateEventBus({actor,input:{url:document.id,manifest:document}})),created=await create();
 config.flags=port({EVENT_BUSES_ENABLED:record({rules:[{when:{accounts:[other]},serve:{value:true}}]})});await assert.rejects(create(),{code:'not_found'});
 assert.equal((await f.read(new EventBuses({actor}))).length,1);
 config.flags=port({EVENT_BUSES_ENABLED:record({on:false})});await f.perform(new RevokeEventBusReader({actor:system,input:{clientId:client}}));await f.perform(new SweepEventBuses({actor:system}));
 config.flags=port({}, {EVENT_BUSES_ENABLED:'false'});await assert.rejects(f.perform(new SweepEventBuses({actor:system})),{code:'not_found'});
 await f.perform(new DeleteEventBus({actor,id:created.bus.id}));assert.equal((await f.read(new EventBuses({actor}))).length,0);
});

test('event cleanup and owner reads require no signing key; new exposure still fails closed without it',async t=>{
 const config={flags:port({EVENT_BUSES_ENABLED:record({fallthrough:true})})},f=await createTestEngine({providers:{eventBus:eventBusProvider({config,keys:async()=>null,issuer:origin})}});t.after(()=>f.dispose());
 assert.deepEqual(await f.read(new EventBuses({actor:{kind:'owner',owner}})),[]);
 assert.deepEqual(await f.perform(new SweepEventBuses({actor:{kind:'system',owner}})),{more:false});
 const document=manifest();await assert.rejects(f.perform(new CreateEventBus({actor:{kind:'owner',owner},input:{url:document.id,manifest:document}})),{code:'temporarily_unavailable'});
});

function mcpEnv(flags){return {APP_ORIGIN:origin,MCP_CLIENTS:JSON.stringify([{id:client,name:'Fixture',redirectUris:['https://agent.example/callback']}]),flags,MCP_AUTHORITY:{begin:async()=>({requestId:'00.'+'a'.repeat(43)}),exchange:async()=>({access_token:'fixture'}),verify:async()=>({owner,clientId:client,permissions:[],scopes:[]}),inspect:async()=>({client:{id:client}}),approve:async()=>({approved:true}),grants:async()=>[],revoke:async()=>({revoked:true})},ACCOUNTS:{get:()=>({invoke:async()=>[]})}};}
const publicRequest=path=>new Request(origin+path),mcpId='00.'+'a'.repeat(43);
test('MCP discovery is global while registered clients are targeted; owner read/revoke/deny bypass flags',async()=>{
 const flags=port({MCP_ENABLED:record({rules:[{when:{clients:[client]},serve:{value:true}}]})}),env=mcpEnv(flags),authorize='/mcp/oauth/authorize?client_id='+client;
 assert.equal((await handleMcpPublic(publicRequest('/.well-known/oauth-protected-resource/mcp'),env)).status,200);
 assert.equal((await handleMcpPublic(publicRequest(authorize),env)).status,302);
 const off=mcpEnv(port({MCP_ENABLED:record()}));assert.equal((await handleMcpPublic(publicRequest(authorize),off)).status,403);
 const token=new Request(origin+'/mcp/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'client_id='+client});assert.equal((await handleMcpPublic(token,off)).status,403);
 const bearer=new Request(origin+'/mcp',{headers:{Authorization:'Bearer '+mcpId}});assert.equal((await handleMcpPublic(bearer,off)).status,403);
 for(const raw of values){const legacy=mcpEnv(undefined);legacy.MCP_ENABLED=raw;assert.equal((await handleMcpPublic(publicRequest('/.well-known/oauth-protected-resource/mcp'),legacy)).status,raw==='true'?200:503);assert.equal((await handleMcpOwner({request:new Request(origin+'/api/mcp/approve',{method:'POST'}),env:legacy,owner:{account:{id:owner}},body:async()=>({requestId:mcpId})})).status,raw==='true'?200:503);}
 for(const flags of [port({MCP_ENABLED:record({on:false})}),port({MCP_ENABLED:record({fallthrough:true})},{MCP_ENABLED:'false'}),createFlags({snapshot:null})]){
  const env=mcpEnv(flags),call=(path,method='GET',input={})=>handleMcpOwner({request:new Request(origin+path,{method}),env,owner:{account:{id:owner}},body:async()=>input});
  assert.equal((await call('/api/mcp/grants')).status,200);assert.equal((await call('/api/mcp/grants/'+mcpId,'DELETE')).status,200);assert.equal((await call('/api/mcp/requests/'+mcpId)).status,200);assert.equal((await call('/api/mcp/approve','POST',{requestId:mcpId,denied:true})).status,200);assert.equal((await call('/api/mcp/approve','POST',{requestId:mcpId})).status>=400,true);
 }
});

test('seeded concurrent refresh failures preserve request-pinned domain targeting',async()=>{
 await forEachSeed(8,async random=>{
  const scheduler=createScheduler(random),clock=fakeClock(),old=snapshot({INTEGRATIONS_ENABLED:record({rules:[{when:{accounts:[owner]},serve:{value:true}}]})}),next=snapshot({INTEGRATIONS_ENABLED:record({rules:[{when:{accounts:[other]},serve:{value:true}}]})},2);
  const store=scheduler.wrap(injectFaults({flagsSnapshot:async()=>next},[{method:'flagsSnapshot',when:.35}],{random}),'flags-store'),runtime=new FlagsRuntime({store,clock:clock.now});runtime.accept(old);const pinned=await runtime.pin();clock.advance(16000);
  // One refresh waiter: scheduler tasks may not wait on another task's single-flight promise.
  const results=await scheduler.run([()=>runtime.refresh(),async()=>{for(let i=0;i<12;i++){assert.equal(integrationsEnabled({flags:pinned},context(owner)),true);assert.equal(integrationsEnabled({flags:pinned},context(other)),false);}return true;}]);
  assert(results.every(r=>r.status==='fulfilled'));const fresh=await runtime.pin();assert(fresh.version>=pinned.version);assert.equal(integrationsEnabled({flags:pinned},context(owner)),true);
 });
});
