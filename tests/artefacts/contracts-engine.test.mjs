import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppEngine,read} from '../../packages/app/engine.mjs';
import {IntegrationContract,versionedContractProvider,contractReferences,validateIntegrationManifest,shapeContractResult} from '../../packages/federation/integrations.mjs';
import {contractPins} from '../../packages/federation/introspection.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {forEachSeed,createScheduler,fakeClock} from '../helpers/chaos.mjs';
const ID='https://contracts.example/object/v1',D='sha256-'+ 'A'.repeat(43),clock=fakeClock(1000000),random={uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},audit={record:async()=>{}};
const body=()=>({$id:ID,oneOf:[{properties:{method:{const:'get'},args:{type:'object',properties:{key:{type:'string'}}}}}],$defs:{result:{type:'object',properties:{name:{type:'string'},nested:{type:'object',properties:{count:{type:'integer'}}},items:{type:'array',items:{type:'object',properties:{id:{type:'string'}}}}}}},'x-methods':{get:{effect:'read',result:'#/$defs/result'}}});
async function fixture({enabled=true,resolve,wrap}={}){
 const record=versionRecord({id:ID,kind:'rpc-contract'},{version:1,prev:null,body:body()}),digest=await versionDigest(record),contexts=[];
 const compiler={async compile(schema,context){contexts.push(context);return {validate:v=>v.method==='get'&&Object.keys(v.args).every(k=>k==='key'),shape:(_,v)=>v};}};
 const provider=versionedContractProvider({enabled,resolve:resolve??(async()=>({record,digest})),compile:(...args)=>(wrap?wrap(compiler):compiler).compile(...args)});
 const engine=createAppEngine({providers:{clock,random,audit,config:{INTEGRATIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:enabled?'true':'false'},integrations:provider}});
 const query=(input={})=>read(engine,new IntegrationContract({input:{contract:ID,reference:{version:1,digest},method:'get',args:{key:'a'},...input}}));return {query,record,digest,contexts};
}
test('contract engine checks record digest and isolates compiler context; results never expose future members',async()=>{
 const f=await fixture(),result={name:'A',email:'hidden',nested:{count:1,secret:'hidden'},items:[{id:'1',secret:'hidden'}]};
 assert.deepEqual(await f.query({result}),{reference:{version:1,digest:f.digest},result:{name:'A',nested:{count:1},items:[{id:'1'}]}});
 assert.equal(result.email,'hidden');assert.equal(f.contexts[0].digest,f.digest);
 await assert.rejects(f.query({args:{key:'a',overwriteAll:true}}),{code:'invalid_args'});
 await assert.rejects(f.query({reference:{version:1,digest:D}}),{code:'artefact_digest_mismatch'});
 assert.equal((await f.query()).valid,true,'a malicious mismatch never poisons the accepted copy');
 const off=await fixture({enabled:false});await assert.rejects(off.query(),{code:'unsupported_artefact_version'});assert.equal(off.contexts.length,0);
 const tampered=await fixture({resolve:async()=>({record:{...f.record,body:{...body(),title:'changed'}},digest:f.digest})});await assert.rejects(tampered.query(),{code:'artefact_digest_mismatch'});
});
test('strict cv maps and version pins; off preserves exact legacy contract pin shape',()=>{
 assert.deepEqual(contractReferences({[ID]:{version:1,digest:D}}),{[ID]:{version:1,digest:D}});
 for(const ref of [{version:1},{version:0,digest:D},{version:1,digest:'A'.repeat(43)},null])assert.throws(()=>contractReferences({[ID]:ref}),{code:'artefact_digest_mismatch'});
 assert.throws(()=>contractReferences({},[ID]),{code:'artefact_digest_mismatch'});
 const extra={[ID]:{version:1,digest:D,methods:{get:{effect:'read'}}}};
 assert.deepEqual(contractPins(extra)[ID],{methods:{get:{effect:'read'}}});assert.deepEqual(contractPins(extra,{artefactVersions:true})[ID],{methods:{get:{effect:'read'}},version:1,digest:D});
 assert.throws(()=>shapeContractResult({'x-methods':{get:{result:{oneOf:[{type:'string'}]}}}},'get','a'),{code:'artefact_unverifiable'});
});
test('integration manifests snapshot contract references only with artefact versions enabled',()=>{
 const clientId='https://integration.example/app/client.json',input={v:1,resources:{rpc_endpoint:'https://integration.example/app/rpc',discovery_endpoint:'https://integration.example/app/resources',contracts:[ID],cv:{[ID]:{version:1,digest:D}}}},context={clientId,confidential:true};
 assert.equal(validateIntegrationManifest(input,context).manifest.resources.cv,undefined);
 assert.deepEqual(validateIntegrationManifest(input,{...context,artefactVersions:true}).manifest.resources.cv,input.resources.cv);
 input.resources.cv[ID].digest='invalid';assert.equal(validateIntegrationManifest(input,{...context,artefactVersions:true}).status,'invalid');
});
test('seeded concurrent request mismatches cannot poison pinned schema contexts',async()=>{
 await forEachSeed(16,async random=>{const scheduler=createScheduler(random),f=await fixture({wrap:c=>scheduler.wrap(c,'compiler')});const work=Array.from({length:8},(_,i)=>()=>f.query(i%3?{result:{name:String(i),email:'hidden'}}:{reference:{version:1,digest:D}}));
  const results=await scheduler.run(work);for(const [i,r] of results.entries())if(i%3){assert.equal(r.status,'fulfilled');assert.deepEqual(r.value.result,{name:String(i)});}else{assert.equal(r.status,'rejected');assert.equal(r.reason.code,'artefact_digest_mismatch');}
  assert(f.contexts.every(c=>c.digest===f.digest));assert.equal((await f.query()).valid,true);
 });
});

test('default isolated compiler validates the shipped profile contract and projects its pinned result',async()=>{
 const {default:schema}=await import('../../docs/artefacts/profile-v1.json',{with:{type:'json'}}),id=schema.$id;
 const record=versionRecord({id,kind:'rpc-contract'},{version:1,prev:null,body:schema}),digest=await versionDigest(record);
 const provider=versionedContractProvider({enabled:true,resolve:async()=>({record,digest})});
 const engine=createAppEngine({providers:{clock,random,audit,config:{INTEGRATIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'},integrations:provider}});
 const query=input=>read(engine,new IntegrationContract({input:{contract:id,reference:{version:1,digest},method:'read',args:{},...input}}));
 const result={entity:'https://identity.example/entities/a',handle:'a',name:'Alice',avatar:null,email:'hidden'};
 assert.deepEqual((await query({result})).result,{entity:result.entity,handle:'a',name:'Alice',avatar:null});
 await assert.rejects(query({args:{overwriteAll:true}}),{code:'invalid_args'});
 await assert.rejects(query({result:{...result,name:4}}),{code:'invalid_result'});
});

test('brokered mint engine carries only attenuated cv entries and preserves exact flag-off claims',async()=>{
 const {brokeredTokensProvider,MintBrokeredToken}=await import('../../packages/federation/introspection.mjs');
 const {perform}=await import('../../packages/app/engine.mjs');
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',record='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',clientId='https://consumer.example/client.json',fragment='https://consumer.example/preferences/v1';
 for(const enabled of [false,true]){
  const signed=[],store={get:async()=>undefined,transaction:async fn=>fn({get:async()=>undefined})},coupling={subject:'https://issuer.example/entities/'+owner,audience:'https://integration.example/rpc',connection:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',generation:1,resource:'https://integration.example/r/1',grant:'grant',contracts:[ID],clientId,dpop:'none'};
  const resources={severance:async()=>({seq:0,rows:[]}),records:async()=>({records:[{id:record,assignments:[{grant:'grant',consumer:{clientId},binding:{fragment,field:'object'}}]}]}),mintable:async()=>coupling};
  const engine=createAppEngine({providers:{clock,random,audit,brokeredResources:resources,brokeredTokens:brokeredTokensProvider({store,issuer:'https://issuer.example',enabled:true,artefactVersions:enabled,pins:{[ID]:{methods:{get:{effect:'read'}}}},clock:clock.now,mint:async claims=>{signed.push(claims);return {token:'signed',tokenType:'Bearer',expiresAt:clock.now()+300000};}})}});
  const input={clientId,record,fragment,field:'object',methods:{[ID]:['get']},...enabled?{cv:{[ID]:{version:1,digest:D}}}:{}};
  await perform(engine,new MintBrokeredToken({actor:{kind:'system',owner},input}));assert.deepEqual(signed[0].cv,enabled?{[ID]:{version:1,digest:D}}:undefined);
  if(enabled){await assert.rejects(perform(engine,new MintBrokeredToken({actor:{kind:'system',owner},input:{...input,cv:{}}})),{code:'artefact_digest_mismatch'});assert.equal(signed.length,1);}
 }
});

test('two versions sharing $id keep independent validators and result member sets under seeded contention',async()=>{
 await forEachSeed(8,async random=>{
  const old=body(),next=body();next.$defs.result.properties.email={type:'string'};
  const first=versionRecord({id:ID,kind:'rpc-contract'},{version:1,prev:null,body:old}),d1=await versionDigest(first),second=versionRecord({id:ID,kind:'rpc-contract'},{version:2,prev:d1,body:next}),d2=await versionDigest(second),copies={[d1]:first,[d2]:second},scheduler=createScheduler(random);
  const resolver=scheduler.wrap({resolve:async ref=>({record:copies[ref.digest],digest:ref.digest})},'copies'),provider=versionedContractProvider({enabled:true,resolve:r=>resolver.resolve(r)});
  const engine=createAppEngine({providers:{clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},audit,config:{INTEGRATIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'},integrations:provider}});
  const results=await scheduler.run(Array.from({length:8},(_,i)=>()=>read(engine,new IntegrationContract({input:{contract:ID,reference:{version:i%2+1,digest:i%2?d2:d1},method:'get',args:{key:'x'},result:{name:'A',email:'secret'}}}))));
  for(const [i,r] of results.entries()){assert.equal(r.status,'fulfilled',r.reason?.stack);assert.deepEqual(r.value.result,i%2?{name:'A',email:'secret'}:{name:'A'});}
 });
});

test('integration setup retains version references only behind the flag and rejects mismatched setup shapes',()=>{
 const fragment='https://app.example/preferences/v1',entry={fragment,purpose:'Choose an object',fields:['object'],methods:{[ID]:['get']},version:2,digest:D,contract_versions:{[ID]:{version:1,digest:D}}},input={v:1,setup:{fragments:[entry]}},context={clientId:'https://app.example/client.json'};
 const off=validateIntegrationManifest(input,context).manifest.setup.fragments[0];assert.equal(off.version,undefined);assert.equal(off.contract_versions,undefined);
 const on=validateIntegrationManifest(input,{...context,artefactVersions:true}).manifest.setup.fragments[0];assert.equal(on.version,2);assert.deepEqual(on.contract_versions,entry.contract_versions);
 const malformed=structuredClone(input);delete malformed.setup.fragments[0].digest;assert.equal(validateIntegrationManifest(malformed,{...context,artefactVersions:true}).manifest.setup,undefined);
 const inherited=Object.create({version:1,digest:D});assert.throws(()=>contractReferences({[ID]:inherited}),{code:'artefact_digest_mismatch'});
 const proto=JSON.parse('{"__proto__":{"version":1,"digest":"'+D+'"}}');assert.throws(()=>contractReferences(proto),{code:'artefact_digest_mismatch'});assert.equal({}.version,undefined);
});
