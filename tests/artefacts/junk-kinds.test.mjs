// Wargame F1 regressions: attacker-chosen intent kinds must cost the provider-wide artefact store nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {configuredArtefacts} from '../../packages/runtime/artefact-pins.mjs';
import {artefactFetchPort} from '../../packages/runtime/artefacts.mjs';
import {createAppEngine,perform} from '../../packages/app/engine.mjs';
import {PinArtefact} from '../../packages/federation/artefact-store.mjs';
import {ArtefactFault} from '../../packages/core/artefacts.mjs';
import {ResolveIntent} from '../../packages/intents/router.mjs';
import {encodeIntent} from '../../packages/intents/format.mjs';
// The operator-registered open-conversation line (runtime/artefact-pins.mjs; the hard-coded registry left the intents code
// in contacts phase 4).
const registeredIntent=name=>({'open-conversation':{artefact:'https://spec.bindle.example/intents/open-conversation/v1',version:1,digest:'sha256-BVp7Z5PiP2NNpO9cb-mxI_8uyZWO1PKJ5PsKgPZNU70'}})[name];
import {fakeClock} from '../helpers/chaos.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code=c=>e=>e.code===c;
const legitData={conversation:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',creator:{iss:'https://provider.example',sub:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},profile:'https://profile.example/v1'};
function fixture(t){
 let now=Date.UTC(2026,9,23,12,0,30);const clock={now:()=>now};
 const config={APP_ORIGIN:'https://provider.example',INTENT_LINKS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',INTENT_BUILTINS:[]};
 const artefactStore=new SqliteMetadata(':memory:'),account=new SqliteMetadata(':memory:');t.after(()=>{artefactStore.close();account.close();});
 config.ARTEFACTS=configuredArtefacts({config,store:artefactStore,clock});
 let n=0;const engine=createAppEngine({providers:{accountStore:account,config,clock,random:{uuid:()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0')},audit:{record(){}}}});
 const resolve=value=>perform(engine,new ResolveIntent({actor:{kind:'owner',owner},input:{value,placement:'fragment'}}));
 const junk=i=>encodeIntent({bintent:1,kind:{artefact:`https://junk${i}.attacker.example/k`,version:1,digest:'sha256-'+'A'.repeat(43)},data:{}});
 const legit=encodeIntent({bintent:1,kind:registeredIntent('open-conversation'),data:legitData});
 return {config,artefactStore,resolve,junk,legit,advance:ms=>{now+=ms;}};
}
test('F1a: junk intent kinds create no durable rows in the provider-wide artefact store',async t=>{
 const f=fixture(t);
 for(let i=0;i<200;i++)await assert.rejects(f.resolve(f.junk(i)),code('intent_kind_unavailable'));
 assert.equal((await f.artefactStore.list({prefix:'artefacts/'})).size,0);
});
test('F1b: junk kinds cannot exhaust the global fetch budget or leave durable negative state for registered kinds',async t=>{
 const f=fixture(t);
 for(let i=0;i<64;i++)await assert.rejects(f.resolve(f.junk(i)),code('intent_kind_unavailable'));
 assert.equal((await f.resolve(f.legit)).state,'no-handler');
 f.advance(40000);assert.equal((await f.resolve(f.legit)).state,'no-handler');
});
test('F1: the router consults the operator registry before any store read, pin or fetch',async t=>{
 const f=fixture(t),calls=[],real=f.config.ARTEFACTS;
 f.config.ARTEFACTS={enabled:true,registered:real.registered,resolve:async input=>{calls.push(['resolve',input.artefact]);return real.resolve(input);},pin:async input=>{calls.push(['pin',input.artefact]);return real.pin(input);}};
 await assert.rejects(f.resolve(f.junk(1)),code('intent_kind_unavailable'));
 assert.deepEqual(calls,[]);
 assert.equal((await f.resolve(f.legit)).state,'no-handler');assert.ok(calls.length>0);
});
test('F1: the fetch port refuses unregistered ids; registered local documents spend no budget',async()=>{
 const clock=fakeClock(),ID='https://artefact.example/a',port=artefactFetchPort({documents:{[ID]:{id:ID}},clock});
 for(let i=0;i<50;i++)await assert.rejects(port.fetch(`https://junk${i}.example/k`),code('artefact_unregistered'));
 for(let i=0;i<200;i++)assert.deepEqual(await port.fetch(ID),{id:ID});
});
test('F1: the fetch port negative cache is LRU-bounded',async()=>{
 // Oversized registered documents are negatively cached; a negative hit never reads the document again. With a bound
 // of one entry, A then B evicts A, so the third fetch of A reads it again.
 const clock=fakeClock(),big='x'.repeat(262145),A='https://artefact.example/a',B='https://artefact.example/b',reads=[];
 const documents=new Proxy({[A]:big,[B]:big},{get(target,key){reads.push(key);return target[key];}});
 const bounded=artefactFetchPort({documents,clock,maxNegative:1});
 for(const id of [A,B,A])await assert.rejects(bounded.fetch(id),code('artefact_unavailable'));
 assert.deepEqual(reads,[A,B,A]);reads.length=0;
 const roomy=artefactFetchPort({documents,clock,maxNegative:8});
 for(const id of [A,B,A])await assert.rejects(roomy.fetch(id),code('artefact_unavailable'));
 assert.deepEqual(reads,[A,B]);
});
test('review follow-up 3: junk digests or versions of a registered kind cannot starve legitimate first-time pins',async t=>{
 const f=fixture(t),ref=registeredIntent('open-conversation');
 for(let i=0;i<100;i++){const value=encodeIntent({bintent:1,kind:{...ref,...i%2?{version:ref.version+1+(i%5)}:{digest:'sha256-'+String(i).padEnd(43,'A')}},data:legitData});await assert.rejects(f.resolve(value));}
 assert.equal((await f.resolve(f.legit)).state,'no-handler');
});
test('F1: neither our own exhausted budget nor an unregistered id is persisted as negativeUntil',async t=>{
 for(const fault of ['artefact_budget_exhausted','artefact_unregistered']){
  const store=new SqliteMetadata(':memory:');t.after(()=>store.close());const clock=fakeClock();
  const engine=createAppEngine({providers:{federationStore:store,egress:{fetch:async()=>{throw new ArtefactFault(fault);}},flags:{for:()=>({global:()=>true})},clock,random:{},audit:{record(){}},config:{validateArtefactBody:()=>true}}});
  await assert.rejects(perform(engine,new PinArtefact({input:{artefact:'https://artefact.example/line',kind:'intent'}})),code(fault==='artefact_budget_exhausted'?'artefact_unavailable':fault));
  assert.equal((await store.list({prefix:'artefacts/'})).size,0,fault);
 }
});
