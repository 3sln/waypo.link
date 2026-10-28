// Pinned contract result shaping (packages/federation/integrations.mjs shapeContractResult; signaling engine review
// 2026-10-28 M-1): pure maps keep their data keys, `anyOf`/`oneOf` map values are shaped by validate-then-copy, and a
// schema that mixes named `properties` with an open `additionalProperties` never lets through a member that a later
// version may name. Local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppEngine,read} from '../../packages/app/engine.mjs';
import {IntegrationContract,versionedContractProvider,shapeContractResult,compileContractVersion} from '../../packages/federation/integrations.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {fakeClock} from '../helpers/chaos.mjs';

const clock=fakeClock(1000000),random={uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},audit={record:async()=>{}};
async function pinned(schema,method){
 const id=schema.$id,record=versionRecord({id,kind:'rpc-contract'},{version:1,prev:null,body:schema}),digest=await versionDigest(record);
 const engine=createAppEngine({providers:{clock,random,audit,config:{INTEGRATIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'},integrations:versionedContractProvider({enabled:true,resolve:async()=>({record,digest})})}});
 return input=>read(engine,new IntegrationContract({input:{contract:id,reference:{version:1,digest},method,...input}}));
}

test('a pinned preferences-v2 read keeps scalar and reference values, withholding members the pin does not name',async()=>{
 const {default:schema}=await import('../../docs/artefacts/preferences-v2.json',{with:{type:'json'}});
 const query=await pinned(schema,'read'),args={fragment:'https://fragments.example/f/v1'};
 const reference={id:'https://provider.example/r/1',label:'Notes',status:'available',contracts:['https://contracts.example/c/v1'],methods:{'https://contracts.example/c/v1':['read']},token:'opaque',token_type:'DPoP',expires_at:1,broker:{endpoint:'https://broker.example/rpc',origin:'https://broker.example',resource:'https://broker.example/r',later:'x'},later:'hidden'};
 const result={fragment:args.fragment,revision:'7',values:{theme:'dark',count:3,relay:[reference],settings:{nested:'hidden'}},requiresConsent:['other'],later:'hidden'};
 const out=(await query({args,result})).result;
 assert.deepEqual(out.values.theme,'dark');assert.equal(out.values.count,3);
 assert.deepEqual(out.values.relay,[{id:reference.id,label:'Notes',status:'available',contracts:reference.contracts,methods:reference.methods,token:'opaque',token_type:'DPoP',expires_at:1,broker:{endpoint:reference.broker.endpoint,origin:reference.broker.origin,resource:reference.broker.resource}}]);
 assert.deepEqual(out.values.settings,{},'an open object value keeps no member the pin does not name');
 assert.equal(out.later,undefined);assert.deepEqual(out.requiresConsent,['other']);
 // dependentRequired (token needs token_type and expires_at) is enforced, not refused.
 const {token_type:_,...untyped}=reference;
 await assert.rejects(query({args,result:{...result,values:{relay:[untyped]}}}),{code:'invalid_result'});
});

test('named properties beside an open additionalProperties keep the named members only (a later version may name the rest)',()=>{
 const root={'x-methods':{get:{result:{type:'object',properties:{name:{type:'string'}},additionalProperties:{type:'string'}}}}};
 assert.deepEqual(shapeContractResult(root,'get',{name:'a',email:'later-named'}),{name:'a'});
 const map={'x-methods':{get:{result:{type:'object',additionalProperties:{type:'object',properties:{n:{type:'integer'}}}}}}};
 assert.deepEqual(shapeContractResult(map,'get',{x:{n:1,secret:'s'},y:{n:2}}),{x:{n:1},y:{n:2}},'a pure map keeps its keys and shapes each value');
 const compiled=compileContractVersion({...root,$id:'https://contracts.example/x/v1'});
 assert.deepEqual(compiled.shape('get',{name:'a',email:'later-named'}),{name:'a'});
});
