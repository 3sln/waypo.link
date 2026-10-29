// Extensions rev 3.2 code review fixes (2026-10-27; review M1–M6 and the cheap Lows), engine level where the rule is
// business logic: the connections domain (packages/app/domains/connections.mjs over packages/apps/connections.mjs), the
// federation service's initial authorization flow, the fragment and extension processors, and the account alarm's
// scheduled feature sweep on the real AccountController. Every test here fails on the tree before these fixes.
// Local behaviour only; .example hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash,randomUUID} from 'node:crypto';
import {createAppEngine,perform,read,AppQuery} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {AppConnections,MESSAGING_INGRESS_FRAGMENT_DOCUMENT} from '../packages/apps/connections.mjs';
import * as C from '../packages/app/domains/connections.mjs';
import {validateIntegrationManifest} from '../packages/federation/integrations.mjs';
import {EXT,declare,featureTx,readExtensions,BINDLE_REGISTRY} from '../packages/core/extensions.mjs';
import {fragmentOutcome} from '../packages/core/fragments.mjs';
import {validateSchema,pinSchema} from '../packages/federation/schema.mjs';
import {validateBusManifest,EVENT_BUS_CONTRACT} from '../packages/federation/event-buses.mjs';
import {createFieldOperation,nextFieldDispatch,recordFieldOutcome,PROVIDER_REGISTRY} from '../packages/federation/extensions.mjs';
import {SUSPENSION_REVOCATION_MS,FEATURE_SWEEP_MS,FEATURE_DEFINITIONS,providerFeatureDeclarations,messagingMailboxMounted} from '../packages/app/domains/provider-features.mjs';
import {federationDeclarations} from '../packages/runtime/federation.mjs';
import {brokeringMounts} from '../packages/runtime/integration-ports.mjs';
import {providerFeatureMounts} from '../packages/runtime/account/connections.mjs';
import {surfaceConfig} from '../packages/runtime/account/flags.mjs';
import {FederationService,MemoryFederationStore} from '../packages/federation/index.mjs';
import {AuthorizationEntries} from '../packages/federation/authorization-entries.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {fakeClock} from './helpers/chaos.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://3sln.example',DAY=86400000,HOUR=3600000;
const INGRESS=MESSAGING_INGRESS_FRAGMENT_DOCUMENT.id;
const MAILBOX='https://spec.bindle.example/messaging/v1/contracts/mailbox';
// The email bridge was struck (2026-10-28): the messaging-mailbox feature is the one provider feature left.
const MAILBOX_FEATURE=EXT.messagingMailbox;
const withPrerequisite=spec=>spec===MAILBOX_FEATURE?[declare(EXT.keyDelegation),declare(spec)]:[declare(spec)];
const code=c=>e=>{assert.equal(e.code,c,`expected ${c}, got ${e.code}: ${e.message}`);return true;};

function snapshot(host,{contracts=[MAILBOX]}={}){
 const clientId=`https://${host}/bindle/client.json`,redirectUris=[`https://${host}/bindle/callback`],jwksUri=`https://${host}/bindle/jwks.json`;
 const raw={v:1,resources:{rpc_endpoint:`https://${host}/bindle/rpc`,discovery_endpoint:`https://${host}/bindle/resources`,contracts}};
 const r=validateIntegrationManifest(raw,{clientId,confidential:true,redirectUris,jwksUri});assert.equal(r.status,'valid',r.reason);
 return {client:{id:clientId,name:host,origin:`https://${host}`},snapshot:{clientId,redirectUris,authMethod:'private_key_jwt',jwksUri,thumbprints:['A'.repeat(43)],manifest:r.manifest}};
}
async function fixture({declared=[MAILBOX_FEATURE],fields}={}){
 const clock=fakeClock(Date.UTC(2026,9,27,12)),metadata=new SqliteMetadata(':memory:');await metadata.put('owner',OWNER);
 const decl={list:[...declared],blocked:[]};let n=0;
 const connections=new AppConnections({metadata,origin:ISSUER,clock:clock.now,...fields?{fields}:{},uuid:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,
  declarations:async()=>({manifest:{issuer:ISSUER,extensions:decl.list.flatMap(withPrerequisite)},blocked:decl.blocked})});
 const engine=createAppEngine({providers:{clock,random:{uuid:()=>crypto.randomUUID(),bytes:k=>crypto.getRandomValues(new Uint8Array(k))},audit:memoryAudit({clock}),config:{},connections:C.connectionsProvider({connections,enabled:true,account:async()=>({status:'active'})})}});
 const owner=()=>({kind:'owner',owner:OWNER,authTime:clock.now()}),system={kind:'system',owner:OWNER};
 const op=(Operation,actor,input)=>{const o=new Operation({actor,...input===undefined?{}:{input}});return o instanceof AppQuery?read(engine,o):perform(engine,o);};
 const feature=async spec=>(await op(C.FeatureList,owner())).find(x=>x.feature===spec);
 const announcements=async()=>(await op(C.NoticeList,owner())).notices.filter(x=>x.kind==='announcement');
 return {clock,metadata,decl,owner,system,op,feature,announcements,connect:host=>op(C.ConnectIntegration,system,snapshot(host)),projection:spec=>op(C.FeatureResources,system,{feature:spec}),outbox:async()=>(await op(C.ConnectionOutbox,system,{limit:500})).events,dispose:()=>metadata.close()};
}

// ---- M1: the 30-day bound is dated from the loss, and a scheduled sweep evaluates with nobody reading ----

test('M1: a loss noticed late is dated from the last evaluation that saw the declaration; 30 days then revoke, never resume',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');const t0=f.clock.now();
 const on=await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:a.id}});
 const first=await f.op(C.FeatureSync,f.system);assert.equal(first.next,t0+FEATURE_SWEEP_MS,'the sweep re-arms while a grant is watched');
 f.clock.advance(HOUR);f.decl.list=[]; // lost one hour in, nobody looking
 f.clock.advance(FEATURE_SWEEP_MS-HOUR);await f.op(C.FeatureSync,f.system); // the next sweep notices
 const view=await f.feature(MAILBOX_FEATURE);assert.equal(view.state,'suspended');assert.equal(view.suspendedAt,t0,'dated from the last evaluation that still saw it, never from the noticing');
 // Restored 30 days and 3 hours after the loss could last have been seen: revoked, not resumed.
 f.clock.set(t0+SUSPENSION_REVOCATION_MS+3*HOUR);f.decl.list=[MAILBOX_FEATURE];
 const p=await f.projection(MAILBOX_FEATURE);assert.equal(p.live,false);assert.equal(p.state,'revoked');
 assert.equal((await f.feature(MAILBOX_FEATURE)).reason,'suspension-expired');
 assert.ok((await f.op(C.NoticeList,f.owner())).notices.some(n=>n.kind==='feature-revoked'),'the owner is told');
 assert.notEqual((await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE})).grant,on.grant,'only a fresh enable brings it back, with a new grant');
});

test('M1: a loss nobody observed for 30 days revokes on the first evaluation; clock jumps never revoke or resume early',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');
 await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:a.id}});const seen=f.clock.now();
 f.decl.list=[];f.clock.advance(31*DAY);
 const out=await f.op(C.FeatureSync,f.system);assert.deepEqual(out.changes,[{feature:MAILBOX_FEATURE,state:'revoked'}],'no suspension window remains');assert.equal(out.next,null,'nothing left to watch');
 assert.ok((await f.outbox()).some(e=>e.type==='feature-revoked'));
 // Backward jump: a suspension dated in the "future" neither revokes nor resumes before its time.
 f.decl.list=[MAILBOX_FEATURE];await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE});const lostAt=f.clock.now();f.decl.list=[];
 await f.op(C.FeatureSync,f.system);assert.equal((await f.feature(MAILBOX_FEATURE)).suspendedAt,lostAt);
 f.clock.set(lostAt-10*DAY);await f.op(C.FeatureSync,f.system);assert.equal((await f.feature(MAILBOX_FEATURE)).state,'suspended');assert.equal((await f.feature(MAILBOX_FEATURE)).suspendedAt,lostAt,'the timestamp is kept');
 // Forward jump past the bound: revoked even though the declaration is back.
 f.clock.set(lostAt+SUSPENSION_REVOCATION_MS);f.decl.list=[MAILBOX_FEATURE];assert.equal((await f.projection(MAILBOX_FEATURE)).state,'revoked');
 void seen;
});

test('M1: the account alarm sweeps feature grants with nobody reading, and enabling a feature arms it',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const decl={list:[MAILBOX_FEATURE]};
 const config={APP_ORIGIN:ISSUER,KEY_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),INTEGRATIONS_ENABLED:'true',LINKS_ENABLED:'true',EXTENSIONS_ENABLED:'true',PROVIDER_FEATURE_DECLARATIONS:()=>({manifest:{issuer:ISSUER,extensions:decl.list.flatMap(withPrerequisite)},blocked:[]}),IDENTITY_ACCOUNT:async owner=>owner===OWNER?{status:'active',handle:'alice'}:null};
 const bucket={put:async()=>{},get:async()=>null,delete:async()=>{}};
 const a=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await a.touch(OWNER);
 const c=await a.connectionsSystem(OWNER,{operation:'connections.connect',input:snapshot('alpha.example')});
 const before=Date.now();await a.connectionsOwner(OWNER,{operation:'connections.enable-feature',input:{feature:MAILBOX_FEATURE,assign:{connection:c.id}}},{authTime:Date.now()});
 const alarm=await db.getAlarm();assert.ok(alarm!==null&&alarm<=Date.now()+FEATURE_SWEEP_MS&&alarm>=before,'enabling arms the sweep within its interval');
 decl.list=[];
 const stored=async()=>[...(await db.list({prefix:'connections/feature/'})).values()].find(r=>r.spec===MAILBOX_FEATURE);
 assert.equal((await stored()).state,'active','nothing has evaluated yet');
 await a.alarmMaintenance();
 assert.equal((await stored()).state,'suspended','the alarm applied the loss');
 assert.ok([...(await db.list({prefix:'connections/notice/'})).values()].some(n=>n.kind==='feature-suspended'),'and told the owner');
 assert.ok((await db.getAlarm())<=Date.now()+FEATURE_SWEEP_MS,'and re-armed itself');
});

// ---- M2: one declaration computation for the manifest row and the account side ----

test('M2: the account-side declarations equal the published authority manifest rows, mount requirements included',()=>{
 const base={APP_ORIGIN:ISSUER,EXTENSIONS_ENABLED:'true',INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',KEY_DELEGATION_ENABLED:'true'};
 // Contacts spike CR-C0: the messaging-mailbox row never needs LINKS_ENABLED (on or off makes no difference).
 // EMAIL_BRIDGE_ENABLED is retired (2026-10-28): setting it declares nothing on either side.
 const variants=[{},{BROKERED_INTROSPECTION_MOUNTED:true},{BROKERED_INTROSPECTION_MOUNTED:true,MESSAGING_DESCRIBE:()=>null},{MESSAGING_DESCRIBE:()=>null},{BROKERED_INTROSPECTION_MOUNTED:true,EMAIL_MAILBOX_FEATURE_ENABLED:'true'},{BROKERED_INTROSPECTION_MOUNTED:true,EXTENSIONS_ENABLED:'false',MESSAGING_DESCRIBE:()=>null},{BROKERED_INTROSPECTION_MOUNTED:true,MESSAGING_DESCRIBE:()=>null,KEY_DELEGATION_ENABLED:'false'},{BROKERED_INTROSPECTION_MOUNTED:true,MESSAGING_DESCRIBE:()=>null,LINKS_ENABLED:'true'},{MESSAGING_DESCRIBE:()=>null,BROKERING_ENABLED:'false'},{MESSAGING_DESCRIBE:()=>null,DELEGATION_CERTIFICATE_SECONDS:'12'}];
 const specs=manifest=>[...readExtensions(manifest,{registry:PROVIDER_REGISTRY,issuer:ISSUER}).extensions.keys()].filter(spec=>Object.hasOwn(FEATURE_DEFINITIONS,spec)).sort();
 const mailbox=[];
 for(const variant of variants){
  const config={...base,...variant};
  const published=specs({issuer:ISSUER,...federationDeclarations(config,{target:'authority',mounts:{messagingMailbox:messagingMailboxMounted(config),...brokeringMounts(config)}})});
  const account=specs(providerFeatureDeclarations(surfaceConfig(config),providerFeatureMounts(config)));
  assert.deepEqual(account,published,JSON.stringify(Object.keys(variant)));
  assert.ok(published.every(spec=>spec===MAILBOX_FEATURE),'the messaging-mailbox feature is the only provider feature declared');
  mailbox.push(published.includes(MAILBOX_FEATURE));
 }
 assert.deepEqual(mailbox,[false,false,true,true,false,false,false,true,false,false],'the mailbox feature needs KEY_DELEGATION, INTEGRATIONS, BROKERING, EXTENSIONS, a describe port and a usable lifetime');
});

test('M3 (verified): grant-more and configure are listed only with a mounted incremental authorization port',()=>{
 const store={transaction:async fn=>fn({get:async()=>undefined,set:async()=>{},delete:async()=>{},list:async()=>[]})};
 assert.ok(!new AuthorizationEntries({store,authority:{},issuer:ISSUER}).intents().some(i=>['grant-more','configure'].includes(i)));
 assert.ok(!new AuthorizationEntries({store,authority:{},issuer:ISSUER,incremental:{mounted:false}}).intents().includes('grant-more'));
 assert.ok(new AuthorizationEntries({store,authority:{},issuer:ISSUER,incremental:{mounted:true}}).intents().includes('grant-more'));
});

// ---- M4: registrable-domain own-flow exclusion in the initial (non-incremental) authorization flow ----

const PROVIDER='https://provider.example',SUBJECT=`${PROVIDER}/entities/alice`,APP='https://app.example/client',CALLBACK='https://app.example/callback',FILES='https://spec.bindle.example/contracts/object-store/v1';
const SHARED='https://schema.example/shared/v1',PLAIN='https://schema.example/plain/v1';
const schemas={
 [SHARED]:{id:SHARED,title:'Files',description:'Where files go',publisher:'https://schema.example',fields:{files:{title:'Files',type:'resource',cardinality:{min:0,max:1},contracts:[FILES],consumers:['application','provider']}}},
 [PLAIN]:{id:PLAIN,title:'Files',description:'Where files go',publisher:'https://schema.example',fields:{files:{title:'Files',type:'resource',cardinality:{min:0,max:1},contracts:[FILES]}}},
};
const NEUTRAL=`${PROVIDER}/resources/neutral`,OWN_ORIGIN='https://files.app.example/r/1',BROKERED=`${PROVIDER}/resources/brokered`;
async function federation(){
 const owner={session:'verified'},resources=[{id:NEUTRAL,label:'Neutral',contracts:{[FILES]:['get']}},{id:OWN_ORIGIN,label:'App-hosted',contracts:{[FILES]:['get']}},{id:BROKERED,label:'Synced by the app',contracts:{[FILES]:['get']},broker:{origin:'https://sync.app.example'}}];
 const service=new FederationService({issuer:PROVIDER,crypto:webcrypto,clock:fakeClock().now,store:new MemoryFederationStore(),clients:[{id:APP,name:'Example app',origin:'https://app.example',redirectUris:[CALLBACK]}],schemaHosts:['schema.example'],schemaFetcher:async url=>structuredClone(schemas[url]),resourceProvider:async()=>structuredClone(resources),authenticateOwner:async authority=>{if(authority!==owner)throw Object.assign(new Error('unauthorized'),{code:'unauthorized'});return {subject:SUBJECT};},dispatchCapability:async()=>({ok:true})});
 const begin=fragment=>{const verifier=randomUUID()+randomUUID();return service.beginAuthorization({clientId:APP,redirectUri:CALLBACK,challenge:createHash('sha256').update(verifier).digest('base64url'),challengeMethod:'S256',state:'s',requests:[{fragment,required:true,purpose:'Files',fields:['files'],methods:{files:{[FILES]:['get']}}}]});};
 const approve=async(requestId,fragment,id)=>{const view=await service.inspect(requestId,owner);return service.approve(owner,{requestId,approved:[{fragment,revision:view.requests[0].revision,fields:['files'],resources:{files:[id]},methods:{files:{[FILES]:['get']}}}]});};
 return {service,owner,begin,approve,configure:(fragment,id,expectedRevision=null)=>service.configure(owner,{fragment,values:{files:id},expectedRevision})};
}

test('M4: inside an app-initiated flow, a shared field offers and accepts no resource from the app\'s registrable domain',async()=>{
 const f=await federation();const {requestId}=await f.begin(SHARED);
 const view=await f.service.inspect(requestId,f.owner);const offered=view.requests[0].resources.map(r=>r.id);
 assert.deepEqual(offered,[NEUTRAL],'neither the app-hosted resource nor the one its integration supplies is a candidate');
 // The owner picks one anyway inside the flow (the shared settings endpoint); the approval refuses it server side.
 await f.configure(SHARED,OWN_ORIGIN,view.requests[0].revision??null);
 await assert.rejects(f.approve(requestId,SHARED,OWN_ORIGIN),code('invalid_grant'));
 await f.configure(SHARED,BROKERED,(await f.service.inspect(requestId,f.owner)).requests[0].revision);
 await assert.rejects(f.approve(requestId,SHARED,BROKERED),code('invalid_grant'));
 await f.configure(SHARED,NEUTRAL,(await f.service.inspect(requestId,f.owner)).requests[0].revision);
 assert.match((await f.approve(requestId,SHARED,NEUTRAL)).redirectUri,/code=/);
});

test('M4: a value chosen before the flow stays usable, and a field nobody else shares is not restricted',async()=>{
 const f=await federation();
 await f.configure(SHARED,OWN_ORIGIN); // the owner's own settings, before any request
 const {requestId}=await f.begin(SHARED);const view=await f.service.inspect(requestId,f.owner);
 assert.ok(view.requests[0].resources.some(r=>r.id===OWN_ORIGIN),'the current value is still shown');
 assert.match((await f.approve(requestId,SHARED,OWN_ORIGIN)).redirectUri,/code=/);
 const plain=await f.begin(PLAIN);const offered=(await f.service.inspect(plain.requestId,f.owner)).requests[0].resources.map(r=>r.id).sort();
 assert.deepEqual(offered,[BROKERED,OWN_ORIGIN,NEUTRAL].sort(),'no other consumer and no provider consumers: no exclusion');
});

// ---- M6: legacy bus manifests only with event buses on; slot consumers reconciled with the field ----

const BUS='https://tasks.example/buses/task-changes/v1';
const bus=(fieldConsumers,slotConsumers=['application','provider'])=>({id:BUS,title:'Task changes',description:'A record when a task changes.',publisher:'https://tasks.example',fields:{bus:{title:'Task changes bus',type:'resource',cardinality:{min:0,max:1},contracts:[EVENT_BUS_CONTRACT],...fieldConsumers?{consumers:fieldConsumers}:{}}},slot:{v:1,crit:['bus'],field:'bus',selection:'exclusive',consumers:slotConsumers,bus:{v:1,types:['created'],payload:{type:'object',additionalProperties:false,properties:{task:{type:'string',maxLength:64}}},max_record_bytes:2048,retention:{min_seconds:60,max_seconds:3600},publishers:['application'],readers:slotConsumers,effects:{read:{en:'See tasks when they change.'},write:{en:'Add task changes.'}}}}});

test('M6: a bus manifest is a requestable fragment only while event buses are implemented, and its field never admits a kind its slot excludes',async()=>{
 assert.throws(()=>validateSchema(bus(),BUS),code('unsupported_fragment'),'event buses off: a top-level slot is unsupported');
 assert.deepEqual(validateSchema(bus(),BUS,{eventBuses:true}),bus());
 const store=new MemoryFederationStore(),options=eventBuses=>({store,crypto:webcrypto,schemaHosts:['tasks.example'],schemaFetcher:async()=>bus(),eventBuses});
 await assert.rejects(pinSchema(options(false),BUS),code('unsupported_fragment'));
 assert.equal((await pinSchema(options(()=>true),BUS)).schema.id,BUS,'a getter (EVENT_BUSES_ENABLED) is read at pin time');
 assert.equal(validateBusManifest(bus(undefined,['provider'])).status,'invalid','slot says provider only, the field (default) admits applications');
 assert.equal(validateBusManifest(bus(['provider'],['provider'])).status,'valid');
 assert.equal(validateBusManifest(bus(['application','provider'],['application'])).status,'invalid');
});

// ---- Lows ----

test('L1: a feature whose declaration is gone is not an enabled consumer for announcements',async t=>{
 const f=await fixture();t.after(f.dispose);const first=await f.connect('first.example');
 await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:first.id}});
 f.decl.list=[]; // nobody has looked since
 await f.connect('second.example');
 assert.deepEqual(await f.announcements(),[],'no announcement for a suspended consumer');
 assert.equal((await f.feature(MAILBOX_FEATURE)).state,'suspended');
});

test('L2: turning one field\'s announcements back on resets "at most once" for that field only, and only if it was off',async t=>{
 // A second, test-local provider-only field with no enabled consumer (no second provider feature exists since the email
 // bridge was struck): toggling it must not reset the ingress field.
 const OTHER={...MESSAGING_INGRESS_FRAGMENT_DOCUMENT,id:'https://spec.bindle.example/fragments/other-test/v1',title:'Other test'};
 const f=await fixture({fields:{[INGRESS]:MESSAGING_INGRESS_FRAGMENT_DOCUMENT,[OTHER.id]:OTHER}});t.after(f.dispose);const first=await f.connect('first.example');
 await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:first.id}});
 const s=await f.connect('supplier.example');assert.deepEqual((await f.announcements()).map(n=>n.fragment),[INGRESS]);
 const again=async()=>{await f.op(C.DisconnectConnection,f.owner(),{connection:(await f.op(C.ConnectionList,f.owner())).connections.find(c=>c.id===s.id).id});await f.connect('supplier.example');return (await f.announcements()).length;};
 await f.op(C.SetAnnouncements,f.owner(),{fragment:INGRESS,enabled:true});assert.equal(await again(),1,'turning on a field that was never off resets nothing');
 await f.op(C.SetAnnouncements,f.owner(),{fragment:OTHER.id,enabled:false});await f.op(C.SetAnnouncements,f.owner(),{fragment:OTHER.id,enabled:true});
 assert.equal(await again(),1,'another field\'s reset leaves the ingress field alone');
 await f.op(C.SetAnnouncements,f.owner(),{fragment:INGRESS,enabled:false});await f.op(C.SetAnnouncements,f.owner(),{fragment:INGRESS,enabled:true});
 assert.equal(await again(),2,'only the ingress field announces the same supplier again');
});

test('L3: bindle.grant changes on a value change of approved entries: purposes, ingress and order',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');
 const on=await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:a.id}});const seat=on.approved[0];
 await f.op(C.ConfigureSeat,f.owner(),{fragment:INGRESS,seat,purposes:['https://spec.bindle.example/purposes/author']});
 const afterPurposes=(await f.feature(MAILBOX_FEATURE)).grant;assert.notEqual(afterPurposes,on.grant,'consented purposes changed');
 await f.op(C.ConfigureSeat,f.owner(),{fragment:INGRESS,seat,purposes:['https://spec.bindle.example/purposes/author']});assert.equal((await f.feature(MAILBOX_FEATURE)).grant,afterPurposes,'an unchanged value keeps the grant');
 await f.op(C.SetSeatIngress,f.system,{fragment:INGRESS,seat,generation:a.generation,ingress:'https://alpha.example/ingress'});
 assert.notEqual((await f.feature(MAILBOX_FEATURE)).grant,afterPurposes,'ingress changed');
 // Order: an ordered variant of the ingress field (the provider's pinned document), two approved entries.
 const ordered={...MESSAGING_INGRESS_FRAGMENT_DOCUMENT,fields:{mailbox:{...MESSAGING_INGRESS_FRAGMENT_DOCUMENT.fields.mailbox,selection:'ordered',cardinality:{min:0,max:2}}}};
 const g=await fixture({fields:{[INGRESS]:ordered}});t.after(g.dispose);const x=await g.connect('x.example'),y=await g.connect('y.example');
 await g.op(C.AssignField,g.owner(),{fragment:INGRESS,connection:x.id});await g.op(C.AssignField,g.owner(),{fragment:INGRESS,connection:y.id});
 const enabled=await g.op(C.EnableFeature,g.owner(),{feature:MAILBOX_FEATURE});assert.equal(enabled.approved.length,2);
 await g.op(C.ReorderField,g.owner(),{fragment:INGRESS,seats:[...enabled.approved].reverse()});
 assert.notEqual((await g.feature(MAILBOX_FEATURE)).grant,enabled.grant,'the owner\'s priority among approved resources changed');
});

test('L4: a revoked feature is never regranted by a later value change; only a fresh enable brings a grant',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');
 const on=await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:a.id}});await f.op(C.DisableFeature,f.owner(),{feature:MAILBOX_FEATURE});
 const seq=(await f.outbox()).length;await f.op(C.UnassignField,f.owner(),{fragment:INGRESS,seat:on.approved[0]});
 const view=await f.feature(MAILBOX_FEATURE);assert.equal(view.state,'revoked');assert.equal(view.grant,on.grant);
 assert.ok(!(await f.outbox()).slice(seq).some(e=>e.type==='feature-regranted'));
});

test('L5: a grant is bound to the fragment pin it was approved under: a changed pinned document suspends it, the original resumes it',async t=>{
 const fields={[INGRESS]:MESSAGING_INGRESS_FRAGMENT_DOCUMENT};
 const f=await fixture({fields});t.after(f.dispose);const a=await f.connect('alpha.example');
 const on=await f.op(C.EnableFeature,f.owner(),{feature:MAILBOX_FEATURE,assign:{connection:a.id}});
 fields[INGRESS]={...MESSAGING_INGRESS_FRAGMENT_DOCUMENT,description:'Another document at the same URL.'};
 const p=await f.projection(MAILBOX_FEATURE);assert.equal(p.live,false);assert.equal(p.state,'suspended');assert.equal((await f.feature(MAILBOX_FEATURE)).reason,'pin');
 fields[INGRESS]=MESSAGING_INGRESS_FRAGMENT_DOCUMENT;const back=await f.projection(MAILBOX_FEATURE);assert.equal(back.live,true);assert.equal(back.grant,on.grant);
});

test('L7: an unknown field member outranks an invalid top-level member (unsupported, never invalid)',()=>{
 const doc={id:'https://f.example/x/v1',title:'',description:'D',publisher:'https://f.example',fields:{r:{title:'R',type:'resource',contracts:['https://c.example/c/v1'],bogus:true}}};
 assert.equal(fragmentOutcome(doc).status,'unsupported');
 assert.equal(fragmentOutcome({...doc,id:'not a url'},doc.id).status,'unsupported');
 assert.equal(fragmentOutcome({...doc,fields:{r:{...doc.fields.r,cardinality:{min:0,max:1,step:1},bogus:undefined}}}).status,'unsupported');
});

test('L8: audience endpoints compare by WHATWG URL serialisation, flat members included (extensions §2.4 rev 3.3)',()=>{
 const issuer='https://p.example',entry=endpoint=>({spec:EXT.authorizationEntry,options:{endpoint,intents:['login']}}),hint=hint_endpoint=>({spec:EXT.integrations,options:{hint_endpoint}});
 const read=manifest=>readExtensions({issuer,...manifest},{registry:BINDLE_REGISTRY,issuer});
 assert.equal(read({extensions:[entry('https://p.example/entry'),hint('https://p.example/hint')]}).extensions.size,2,'distinct endpoints');
 const slash=read({extensions:[entry('https://p.example'),hint('https://p.example/')]});
 assert.equal(slash.extensions.size,0,'`https://p.example` and `https://p.example/` are one endpoint: both entries are invalid');
 const flat=read({token_endpoint:'https://P.example:443/a/../entry',extensions:[entry('https://p.example/entry')]});
 assert.deepEqual(flat.absent.map(a=>a.reason),['audience'],'a flat member equal after parsing collides');
 assert.equal(read({token_endpoint:'https://p.example/entry?x=1',extensions:[entry('https://p.example/entry')]}).extensions.size,1,'queries compare exactly');
});

test('L9: a 5xx never advances ordered failover, whatever error code it carries',()=>{
 const field={title:'R',type:'resource',cardinality:{min:0,max:2},contracts:['https://c.example/c/v1'],selection:'ordered'};
 let state=createFieldOperation(field,[{id:'a',status:'available',credentialCurrent:true},{id:'b',status:'available',credentialCurrent:true}]);
 const tx=randomUUID();let next=nextFieldDispatch(state,{tx});state=recordFieldOutcome(next.state,{tx,httpStatus:500,code:'forbidden'});
 assert.equal(state.outcomes[0].status,'unknown');assert.equal(nextFieldDispatch(state,{tx:randomUUID()}).dispatch,null);
 let ok=createFieldOperation(field,[{id:'a',status:'available',credentialCurrent:true},{id:'b',status:'available',credentialCurrent:true}]);
 const t2=randomUUID();next=nextFieldDispatch(ok,{tx:t2});ok=recordFieldOutcome(next.state,{tx:t2,httpStatus:403});assert.equal(nextFieldDispatch(ok,{tx:randomUUID()}).dispatch.resource.id,'b','a 403 still proves no effect');
});

test('tx: the UUIDv5 name encoding matches the §4.2 example vector, and `|` is refused in the first three inputs',async()=>{
 const SPEC='https://provider.example/extensions/auto-classify/v1',CONTRACT='https://spec.bindle.example/contracts/item-classification/v1';
 assert.equal(await featureTx(SPEC,CONTRACT,'https://provider.example/entities/e_123','fp-1'),'10c1a1f5-0642-5f7e-ab6e-f91bd49eab37');
 await assert.rejects(featureTx(SPEC+'|x',CONTRACT,'e','fp'),TypeError);await assert.rejects(featureTx(SPEC,CONTRACT+'|x','e','fp'),TypeError);await assert.rejects(featureTx(SPEC,CONTRACT,'e|1','fp'),TypeError);
 assert.match(await featureTx(SPEC,CONTRACT,'e','fp|still-fine'),/^[0-9a-f-]{36}$/,'the fingerprint is last, so it may contain `|`');
});
