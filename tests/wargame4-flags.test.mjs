// Wargame 4 (operator and lifecycle surfaces): flag-console findings M2, M3, L5, L6 and the flag-console read limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FlagsRuntime} from '../packages/runtime/flags.mjs';
import {siteGlobal,siteEnabled} from '../packages/flags/read.mjs';
import {incrementalAuthorizationEnabled} from '../packages/runtime/incremental-authorization.mjs';
import {evaluate} from '../packages/flags/evaluate.mjs';
import {validateSnapshot} from '../packages/flags/snapshot.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {AdminStorage} from '../packages/identity/admin-store.mjs';
import {FlagService,flagRateKey} from '../packages/flags/service.mjs';
import {adminDeletionFixture,OWNER} from './helpers/admin-deletion.mjs';

const start=1792000000000,owner='00000000-0000-4000-8000-000000000001';
const clockAt=t=>{let now=t;return {now:()=>now,advance:ms=>{now+=ms;}};};
const rec=(patch={})=>({rev:1,on:true,onValue:true,fallthrough:true,salt:'s',...patch});
const boot={actor:{kind:'boot',expect:{'boot/principal':null}},stepUpAt:start,stepUpMethod:'passkey'};

test('M3: a cold-start outage never resurrects a leftover env force-on over a console kill',async()=>{
 // Committed console state: federation on, incremental auth killed by the console. Env still carries a legacy "true".
 const env={INCREMENTAL_AUTH_ENABLED:'true',FEDERATION_ENABLED:'true'};
 const committed={v:1,version:7,issuedAt:start,flags:{FEDERATION_ENABLED:rec(),INCREMENTAL_AUTH_ENABLED:rec({on:false,fallthrough:false})}};
 const clock=clockAt(start);
 const warm=new FlagsRuntime({env,clock:clock.now,store:{flagsSnapshot:async()=>structuredClone(committed)}});
 await warm.pin();assert.equal(siteGlobal(warm.bind(env),'INCREMENTAL_AUTH_ENABLED'),false,'control: kill honoured while the store is up');
 const cold=new FlagsRuntime({env,clock:clock.now,store:{flagsSnapshot:async()=>{throw new Error('admin store down');}}});
 const port=await cold.pin();
 assert.equal(port.evaluate('INCREMENTAL_AUTH_ENABLED').value,false);assert.equal(port.usable,false,'nothing was read');
 const config=cold.bind(env);
 assert.equal(siteGlobal(config,'INCREMENTAL_AUTH_ENABLED'),false,'siteGlobal must not resurrect the env force-on during an outage');
 assert.equal(incrementalAuthorizationEnabled(config),false,'incremental authorization stays unmounted');
 assert.equal(siteEnabled(config,'INCREMENTAL_AUTH_ENABLED',{subject:{kind:'account',owner}}),false,'siteEnabled likewise');
 // The pre-console rule still applies when an empty snapshot was actually read (admin-less self-host).
 const empty=new FlagsRuntime({env,clock:clock.now,store:null});await empty.pin();
 assert.equal(siteGlobal(empty.bind(env),'INCREMENTAL_AUTH_ENABLED'),true,'an empty, usable snapshot keeps legacy env semantics');
});

test('L5: one stale console record is quarantined; other flags and the console keep working; retire removes it',async t=>{
 const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw);t.after(()=>raw.close());
 await raw.transaction(async tx=>{await tx.put('admin/flags-head',{version:2,issuedAt:start});await tx.put('admin/flag/EVENT_BUSES_ENABLED',rec());await tx.put('admin/flag/SIGNUP_ENABLED',rec());await tx.put('admin/flag/RETIRED_EXAMPLE_ENABLED',rec());await tx.put('admin/flag/ACTIVITY_V2_ENABLED',{...rec(),onValue:false});});
 const snapshot=await storage.flagsSnapshot(),anon={subject:{kind:'anonymous'},client:null,region:{country:'unknown'},now:start};
 assert.equal(evaluate('SIGNUP_ENABLED',anon,snapshot).value,true,'SIGNUP keeps its committed value');
 assert.equal(evaluate('EVENT_BUSES_ENABLED',anon,snapshot).value,true);
 // The invalid record of a registered flag follows its outage policy, never the legacy env value.
 assert.deepEqual({...evaluate('ACTIVITY_V2_ENABLED',anon,snapshot,{ACTIVITY_V2_ENABLED:'true'})},{value:false,reason:'outage'});
 assert.deepEqual(validateSnapshot(snapshot,{quarantine:true}).quarantined,['ACTIVITY_V2_ENABLED','RETIRED_EXAMPLE_ENABLED']);
 assert.throws(()=>validateSnapshot(snapshot),'strict validation (every write) still refuses');
 const commits=[];const service=new FlagService({store:storage,env:{},clock:()=>start,onCommit:s=>commits.push(s)});
 const list=await service.list({},boot);
 assert.deepEqual(list.quarantined,[{name:'ACTIVITY_V2_ENABLED',registered:true},{name:'RETIRED_EXAMPLE_ENABLED',registered:false}]);
 assert.equal(list.flags.find(f=>f.name==='SIGNUP_ENABLED').record.on,true);
 // A quarantined registered flag cannot be edited in place; retire it (critical, audited) first.
 await assert.rejects(service.preview({name:'ACTIVITY_V2_ENABLED',expectedRevision:null,action:'seed'},boot),{code:'flag_quarantined'});
 await assert.rejects(service.retire({name:'SIGNUP_ENABLED',expectedVersion:2,reason:'retire a valid record',typedName:'SIGNUP_ENABLED'},boot),{code:'not_quarantined'});
 await assert.rejects(service.retire({name:'RETIRED_EXAMPLE_ENABLED',expectedVersion:2,reason:'short',typedName:'RETIRED_EXAMPLE_ENABLED'},boot),{code:'reason_required'});
 await assert.rejects(service.retire({name:'RETIRED_EXAMPLE_ENABLED',expectedVersion:2,reason:'Registry removed this flag.',typedName:'RETIRED'},boot),{code:'typed_name_required'});
 await assert.rejects(service.retire({name:'RETIRED_EXAMPLE_ENABLED',expectedVersion:2,reason:'Registry removed this flag.',typedName:'RETIRED_EXAMPLE_ENABLED'},{...boot,stepUpAt:start-600000}),{code:'step_up_required'});
 const result=await service.retire({name:'RETIRED_EXAMPLE_ENABLED',expectedVersion:2,reason:'Registry removed this flag.',typedName:'RETIRED_EXAMPLE_ENABLED'},boot);
 assert.equal(result.retired,true);assert.equal(result.version,3);assert.equal(result.audit.action,'flag.retire');assert.equal(result.audit.target,'RETIRED_EXAMPLE_ENABLED');assert.equal(result.audit.critical,true);
 assert.deepEqual((await service.list({},boot)).quarantined,[{name:'ACTIVITY_V2_ENABLED',registered:true}]);
 assert.equal(commits.at(-1).version,3);assert.deepEqual(commits.at(-1).quarantined,['ACTIVITY_V2_ENABLED']);
 assert.deepEqual(await storage.verifyAudit(),{valid:true,seq:1});
});

test('L6: an account writer at the current edge version re-reads the authority after ~5 minutes (single-flight)',async()=>{
 const clock=clockAt(start),committed={v:1,version:3,issuedAt:start,flags:{EVENT_BUSES_ENABLED:rec()}};let reads=0;
 const writer=new FlagsRuntime({env:{},clock:clock.now,store:{flagsSnapshot:async()=>{reads++;return structuredClone(committed);}}});
 assert.equal((await writer.pin({writer:true,minVersion:3})).enabled('EVENT_BUSES_ENABLED'),true);assert.equal(reads,1);
 clock.advance(60000);await writer.pin({writer:true,minVersion:3});assert.equal(reads,1,'no re-read inside five minutes');
 clock.advance(300000);await Promise.all([writer.pin({writer:true,minVersion:3}),writer.pin({writer:true,minVersion:3})]);assert.equal(reads,2,'one single-flight re-read');
 clock.advance(3600001);
 const port=await writer.pin({writer:true,minVersion:3});
 assert.notEqual(port.evaluate('EVENT_BUSES_ENABLED').reason,'outage','the writer keeps the committed snapshot past max-stale');
});

test('M2: flag console calls cannot reset the administrator read window (own keys, own windows)',async t=>{
 const f=await adminDeletionFixture();t.after(()=>f.close());
 const flags=new FlagService({store:f.store,config:f.config,clock:f.clock.now});
 let served=0;
 for(let i=0;i<300;i++){await f.admin.lookup({owner:OWNER},f.context);served++;}
 await assert.rejects(f.admin.lookup({owner:OWNER},f.context),{code:'rate_limited'});
 for(let minute=1;minute<=5;minute++){
  f.clock.advance(61000);
  const actor=await f.admin.actor(f.context,true);
  await flags.explain({name:'SIGNUP_ENABLED',context:{kind:'anonymous'}},{actor});
  for(let i=0;i<299;i++){try{await f.admin.lookup({owner:OWNER},f.context);served++;}catch(e){if(e.code==='rate_limited')break;throw e;}}
 }
 assert.ok(served<=300,`served ${served} lookups within ~6 minutes (limit 300 per 10 minutes)`);
 const actor=await f.admin.actor(f.context,true);
 assert.equal(flagRateKey(actor,true),'flags-read-admin-'+actor.owner);assert.equal(flagRateKey(actor),'flags-admin-'+actor.owner);
 assert.equal(flagRateKey({kind:'boot'},true),'flags-read-boot');assert.equal(flagRateKey({kind:'boot'}),'flags-boot');
 assert.ok(await f.store.rateWindow('flags-read-admin-'+actor.owner),'flag reads spend their own window');
});

test('flag console reads (list, get, history, preview, evaluate, seed-verify) spend the flag read window',async t=>{
 const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw);t.after(()=>raw.close());
 const service=new FlagService({store:storage,env:{},clock:()=>start});
 const reads=[()=>service.list({},boot),()=>service.get({name:'EVENT_BUSES_ENABLED'},boot),()=>service.history({name:'EVENT_BUSES_ENABLED'},boot),()=>service.evaluate({name:'EVENT_BUSES_ENABLED',context:{subject:{kind:'anonymous'}}},boot),()=>service.seedVerify({},boot),()=>service.preview({name:'EVENT_BUSES_ENABLED',expectedRevision:null,action:'seed'},boot)];
 for(let i=0;i<300;i++)await reads[i%reads.length]();
 for(const read of reads)await assert.rejects(read(),{code:'rate_limited'});
 assert.deepEqual(await storage.rateWindow('flags-read-boot'),{start,count:300});
 assert.equal((await storage.list('audit/')).length,0,'plain reads are not audited');
});

test('review: retiring a registered flag replaces its record with the off record and never enables it through env',async t=>{
 const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw);t.after(()=>raw.close());
 // A console kill stored in a shape the deployed registry rejects (quarantined), with a leftover env force-on.
 await raw.transaction(async tx=>{await tx.put('admin/flags-head',{version:2,issuedAt:start});await tx.put('admin/flag/EVENT_BUSES_ENABLED',rec());await tx.put('admin/flag/ACTIVITY_V2_ENABLED',{...rec({on:false,fallthrough:false,rev:4}),onValue:false});});
 const env={ACTIVITY_V2_ENABLED:'true'},owner1='00000000-0000-4000-8000-000000000001';
 const read=async()=>{const rt=new FlagsRuntime({env,clock:()=>start,store:storage});await rt.pin();const c=rt.bind(env);return {global:siteGlobal(c,'ACTIVITY_V2_ENABLED',true),owner:siteEnabled(c,'ACTIVITY_V2_ENABLED',{subject:{kind:'account',owner:owner1}},true)};};
 assert.deepEqual(await read(),{global:false,owner:false});
 const service=new FlagService({store:storage,env,clock:()=>start}),input={name:'ACTIVITY_V2_ENABLED',expectedVersion:2,reason:'Stale record after a deploy.',typedName:'ACTIVITY_V2_ENABLED'};
 await assert.rejects(service.retire(input,boot),{code:'gates_unacknowledged'},'force-on-legacy env needs an explicit acknowledgement');
 await assert.rejects(service.retire({...input,acknowledgeGates:['something-else']},boot),{code:'gates_unacknowledged'});
 const result=await service.retire({...input,acknowledgeGates:['legacy-env']},boot);
 assert.equal(result.record.on,false);assert.equal(result.record.rev,5);assert.deepEqual(result.audit.acknowledgeGates,['legacy-env']);
 const stored=await storage.get('flag/ACTIVITY_V2_ENABLED');assert.equal(stored.on,false,'the record is replaced, not deleted');
 assert.deepEqual(await read(),{global:false,owner:false},'retire must not enable the feature through the leftover env');
 assert.equal((await service.list({},boot)).quarantined.length,0);
 assert.equal((await service.history({name:'ACTIVITY_V2_ENABLED'},boot)).entries[0].action,'flag.retire');
});
