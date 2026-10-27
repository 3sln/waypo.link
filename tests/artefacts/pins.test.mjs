import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {federationMetadata} from '../../packages/federation/runtime.mjs';
import {configuredArtefacts,reviewedSchemaFetcher} from '../../packages/runtime/artefact-pins.mjs';
import {pinSchema} from '../../packages/federation/schema.mjs';
import {createExtensionsProvider,PinSlotManifest} from '../../packages/federation/extensions.mjs';
import {createEventBusesProvider,PinBusManifest} from '../../packages/federation/event-buses.mjs';
import {createAppEngine,perform} from '../../packages/app/engine.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {canonical,digest} from '../../packages/core/records.mjs';
import {forEachSeed,createScheduler,fakeClock} from '../helpers/chaos.mjs';
import {manifest as busManifest} from '../event-bus-fixture.mjs';
const ID='https://pins.example/preferences',code=code=>error=>error.code===code;
const fragment=()=>({id:ID,title:'Preferences',description:'Owner choices.',publisher:'https://pins.example',fields:{enabled:{title:'Enabled',type:'boolean',cardinality:{min:0,max:1}}}});
const slot=()=>({...fragment(),fields:{occupants:{title:'Occupants',type:'resource',cardinality:{min:0,max:4},contracts:['https://contracts.example/read/v1']}},slot:{v:1,field:'occupants',selection:'ordered',consumers:['application','provider'],options:{consumer:{}}}});
async function publication(body,kind){const versions=[],digests=[];for(let n=1;n<=2;n++){const next=structuredClone(body);if(kind!=='fragment')next.slot.options={consumer:{}};if(n===2){const fields=kind==='fragment'?next.fields:next.slot.options.consumer;fields.extra={title:'Extra',type:'boolean',cardinality:{min:0,max:1}};}const entry={version:n,prev:digests.at(-1)??null,body:next};versions.push(entry);digests.push(await versionDigest(versionRecord({id:body.id,kind},entry)));}return {envelope:{bindle_artefact:1,id:body.id,kind,versions},digests};}
function harness(t,body=fragment(),{enabled=true,wrap=store=>store}={}){
 const db=new SqliteMetadata(':memory:'),clock=fakeClock(),config={ARTEFACT_VERSIONS_ENABLED:String(enabled),EXTENSIONS_ENABLED:'true',EVENT_BUSES_ENABLED:'true',FEDERATION_SCHEMAS:{[body.id]:body}};
 const port=configuredArtefacts({config,store:wrap(db),clock});config.ARTEFACTS=port;
 const options={store:federationMetadata(db),crypto,schemaHosts:[new URL(body.id).host],schemaFetcher:reviewedSchemaFetcher(config)};
 const engine=createAppEngine({providers:{config,clock,random:{},audit:{record(){}},extensions:createExtensionsProvider(options),eventBuses:createEventBusesProvider(options)}});
 t.after(async()=>{await engine.dispose();await port.engine.dispose();db.close();});return {db,clock,config,port,options,engine};
}
test('flag off retains exact legacy schema/slot/bus pins and namespaces',async t=>{
 for(const [body,Kind,kind]of [[fragment(),null,'fragment'],[slot(),PinSlotManifest,'slot'],[{...busManifest(),slot:{...busManifest().slot,options:{consumer:{}}}},PinBusManifest,'bus']]){
  const h=harness(t,body,{enabled:false}),bare=await digest(crypto,canonical(body));
  const pin=Kind?await perform(h.engine,new Kind({input:{url:body.id}})):await pinSchema(h.options,body.id);
  assert.equal(pin.digest,Kind?'sha256-'+bare:bare);assert.equal(pin.version,undefined);assert.deepEqual((await h.db.get('federation/schema/'+body.id)),{schema:body,digest:bare});assert.equal((await h.db.list({prefix:'artefacts/'})).size,0);
  h.config.FEDERATION_SCHEMAS[body.id]={...body,title:'Changed'};
  await assert.rejects(Kind?perform(h.engine,new Kind({input:{url:body.id}})):pinSchema(h.options,body.id),code('schema_changed'));
  const line=await publication(body,kind);h.config.FEDERATION_SCHEMAS[body.id]=line.envelope;
  await assert.rejects(Kind?perform(h.engine,new Kind({input:{url:body.id}})):pinSchema(h.options,body.id));
 }
});
test('engine slot/bus pins carry exact versions; foreign mismatch fails just its request',async t=>{
 for(const [body,Kind,kind]of [[slot(),PinSlotManifest,'slot'],[{...busManifest(),slot:{...busManifest().slot,options:{consumer:{}}}},PinBusManifest,'bus']]){
  const h=harness(t,body),line=await publication(body,kind);h.config.FEDERATION_SCHEMAS[body.id+'/envelope']=line.envelope;
  const latest=await perform(h.engine,new Kind({input:{url:body.id}}));assert.equal(latest.version,2);assert.equal(latest.digest,line.digests[1]);
  await assert.rejects(perform(h.engine,new Kind({input:{url:body.id,version:1,digest:'sha256-'+'A'.repeat(43)}})),code('artefact_digest_mismatch'));
  const first=await perform(h.engine,new Kind({input:{url:body.id,version:1,digest:line.digests[0]}}));assert.deepEqual(first.schema,body);
  delete h.config.FEDERATION_SCHEMAS[body.id+'/envelope'];assert.deepEqual((await h.port.resolve(first.reference)).body,body);assert.deepEqual((await h.db.get('artefacts/line/'+body.id)).faults,[]);
  h.config.ARTEFACT_VERSIONS_ENABLED='false';assert.deepEqual((await h.port.resolve(latest.reference)).body,line.envelope.versions[1].body);await assert.rejects(perform(h.engine,new Kind({input:{url:body.id,version:1,digest:line.digests[0]}})),code('unsupported_artefact_version'));
 }
});
test('legacy pins migrate only against version one and remain legacy across flag toggles',async t=>{
 const body=fragment(),h=harness(t,body,{enabled:false}),legacy=await pinSchema(h.options,ID),line=await publication(body,'fragment');
 h.config.FEDERATION_SCHEMAS[ID+'/envelope']=line.envelope;h.config.ARTEFACT_VERSIONS_ENABLED='true';
 const pin=await pinSchema(h.options,ID);assert.equal(pin.digest,legacy.digest);assert.equal(pin.version,undefined);assert.deepEqual(pin.schema,body);
 assert.equal((await pinSchema(h.options,{fragment:ID,version:2,digest:line.digests[1]})).version,2);
 h.config.ARTEFACT_VERSIONS_ENABLED='false';assert.deepEqual(await pinSchema(h.options,ID),legacy);
 // Fractional numbers in legacy metadata stay permissive; no envelope is needed to keep the pin valid.
 const permissive={...body,metadata:1.5},other=harness(t,permissive);const loose=await pinSchema(other.options,ID);assert.deepEqual(loose.schema,permissive);assert.equal(loose.version,undefined);
});
test('legacy migration verifies the stored document before accepting an envelope sibling',async t=>{
 const body=fragment(),h=harness(t,body,{enabled:false}),legacy=await pinSchema(h.options,ID),line=await publication(body,'fragment');
 await h.db.put('federation/schema/'+ID,{...legacy,schema:{...body,title:'Corrupt stored body'}});h.config.FEDERATION_SCHEMAS[ID+'/envelope']=line.envelope;h.config.ARTEFACT_VERSIONS_ENABLED='true';
 await assert.rejects(pinSchema(h.options,ID),code('artefact_digest_mismatch'));assert.equal(await h.db.get('artefacts/line/'+ID),undefined);
 await h.db.put('federation/schema/'+ID,legacy);assert.equal((await pinSchema(h.options,ID)).digest,legacy.digest);
});
test('seeded concurrent call-site pins and additive publication preserve exact snapshots',async t=>{
 await forEachSeed(20,async random=>{
  const scheduler=createScheduler(random),body=slot(),h=harness(t,body,{wrap:db=>scheduler.wrap(db,'artefacts')}),line=await publication(body,'slot');
  h.config.FEDERATION_SCHEMAS[ID+'/envelope']={...line.envelope,versions:line.envelope.versions.slice(0,1)};
  const first=await perform(h.engine,new PinSlotManifest({input:{url:ID,version:1,digest:line.digests[0]}}));
  const outcomes=await scheduler.run([
   ()=>perform(h.engine,new PinSlotManifest({input:{url:ID,version:1,digest:line.digests[0]}})),
   async()=>{h.config.FEDERATION_SCHEMAS[ID+'/envelope']=line.envelope;return perform(h.engine,new PinSlotManifest({input:{url:ID,version:2,digest:line.digests[1]}}));},
   ()=>perform(h.engine,new PinSlotManifest({input:{url:ID,version:2,digest:'sha256-'+'A'.repeat(43)}})),
   ()=>h.port.resolve(first.reference)
  ]);
  assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'fulfilled');assert.equal(outcomes[2].status,'rejected');assert.equal(outcomes[2].reason.code,'artefact_digest_mismatch');assert.deepEqual((await h.port.resolve(first.reference)).body,body);
  assert.equal((await h.db.get('artefacts/line/'+ID)).head,2);assert.deepEqual((await h.db.get('artefacts/line/'+ID)).faults,[]);
 });
});

import {AppAction} from '../../packages/app/engine.mjs';
import {BusStore} from '../../packages/events/store.mjs';
import {busKeys} from '../../packages/events/index.mjs';
import {app} from '../event-bus-fixture.mjs';
class CreatePinnedBus extends AppAction{static deps=['eventBus'];run({eventBus}){return eventBus.create(this.input);}}
class PublishPinnedBus extends AppAction{static deps=['eventBus'];run({eventBus}){const {tx,...args}=this.input;return eventBus.at(this.id).publish(this.actor,args,{tx});}}
test('seeded engine bus creation and event publication keep the pinned manifest through concurrent head advances and flag kill',async t=>{
 const keys=await busKeys({KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
 await forEachSeed(12,async random=>{
  const scheduler=createScheduler(random),body=busManifest();body.slot.options={consumer:{}};
  const h=harness(t,body,{wrap:db=>scheduler.wrap(db,'artefacts')}),line=await publication(body,'bus'),account=new SqliteMetadata(':memory:');t.after(()=>account.close());
  h.config.FEDERATION_SCHEMAS[body.id+'/envelope']={...line.envelope,versions:line.envelope.versions.slice(0,1)};
  let serial=0;const uuid=()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;const actor=app(),store=new BusStore({accountStore:scheduler.wrap(account,'account'),owner:actor.owner,issuer:'https://provider.example',clock:h.clock,random:{uuid},keys,artefacts:h.port,grants:{check:()=>({allowed:true,epoch:'epoch'})}}),engine=createAppEngine({providers:{eventBus:store,clock:h.clock,random:{},audit:{record(){}}}});t.after(()=>engine.dispose());
  const create=()=>perform(engine,new CreatePinnedBus({input:{url:body.id,version:1,digest:line.digests[0]}})),initial=await create();assert.equal(initial.bus.version,1);assert.equal(initial.bus.digest,line.digests[0]);
  const publish=()=>perform(engine,new PublishPinnedBus({actor,id:initial.bus.id,input:{type:'created',data:{task:'task-1'},tx:uuid()}}));
  const outcomes=await scheduler.run([create,publish,async()=>{h.config.FEDERATION_SCHEMAS[body.id+'/envelope']=line.envelope;return perform(h.engine,new PinBusManifest({input:{url:body.id,version:2,digest:line.digests[1]}}));},publish]);
  for(const outcome of outcomes)assert.equal(outcome.status,'fulfilled',outcome.reason?.stack);
  assert.equal((await store.get(initial.bus.id)).version,1);assert.equal((await store.get(initial.bus.id)).head,2);assert.equal((await h.db.get('artefacts/line/'+body.id)).head,2);
  h.config.ARTEFACT_VERSIONS_ENABLED='false';await publish();assert.equal((await store.get(initial.bus.id)).head,3);await assert.rejects(create(),code('unsupported_artefact_version'));
 });
});
test('flag-off runtime fetchers preserve the original missing-fragment faults',async t=>{
 const h=harness(t,fragment(),{enabled:false}),missing=ID+'/missing';await assert.rejects(pinSchema(h.options,missing),{code:'untrusted_schema_host',message:'This fragment has not been registered with this provider.'});
 const options={...h.options,schemaFetcher:reviewedSchemaFetcher(h.config,'unsupported_fragment')};await assert.rejects(pinSchema(options,missing),{code:'unsupported_fragment',message:'Unsupported fragment.'});
});

test('legacy URLs outside the versioned URL profile retain their original pins with the flag on',async t=>{
 for(const id of [ID+'?legacy=1',ID+'/'+'x'.repeat(260)]){
  const body={...fragment(),id},h=harness(t,body,{enabled:false}),pin=await pinSchema(h.options,id);h.config.ARTEFACT_VERSIONS_ENABLED='true';assert.deepEqual(await pinSchema(h.options,id),pin);assert.equal((await h.db.list({prefix:'artefacts/'})).size,0);
 }
});

test('a first legacy pin under the flag retains immutable legacy state after a kill switch',async t=>{
 const body=fragment(),h=harness(t,body),pin=await pinSchema(h.options,ID);assert.equal(pin.version,undefined);assert.deepEqual(await h.db.get('federation/schema/'+ID),{schema:body,digest:pin.digest});
 h.config.ARTEFACT_VERSIONS_ENABLED='false';h.config.FEDERATION_SCHEMAS[ID]={...body,title:'Changed'};await assert.rejects(pinSchema(h.options,ID),code('schema_changed'));
 h.config.FEDERATION_SCHEMAS[ID]=body;assert.deepEqual(await pinSchema(h.options,ID),{schema:body,digest:pin.digest});
});
