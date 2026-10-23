import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {federationMetadata} from '../../packages/federation/runtime.mjs';
import {configuredArtefacts,reviewedSchemaFetcher,pinConfiguredContract,configuredContractVersion} from '../../packages/runtime/artefact-pins.mjs';
import {FederationService,PinGrantRequests} from '../../packages/federation/service.mjs';
import {createAppEngine,perform} from '../../packages/app/engine.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {contractMethods} from '../../packages/core/contract-methods.mjs';
import {ClientDirectory} from '../../packages/federation/client-metadata.mjs';
import {createConsentProvider} from '../../packages/consent/model.mjs';
import {consentContracts} from '../../packages/consent/contracts.mjs';
import {forEachSeed,createScheduler,fakeClock} from '../helpers/chaos.mjs';
const ID='https://settings.example/fragment',C='https://contracts.example/files',body={$id:C,oneOf:[{properties:{method:{const:'get'},args:{type:'object',properties:{key:{type:'string'}},additionalProperties:false}}}],'x-methods':{get:{effect:'read',request:{type:'object'},result:{type:'object',properties:{name:{type:'string'}}}}}},fragment={id:ID,title:'Files',description:'Choose files.',publisher:'https://settings.example',fields:{files:{title:'Files',type:'resource',contracts:[C]}}};
async function fixture(t,{enabled=true,scheduler}={}){
 const db=new SqliteMetadata(':memory:'),clock=fakeClock(),config={ARTEFACT_VERSIONS_ENABLED:String(enabled),FEDERATION_SCHEMAS:{[ID]:fragment,[ID+'/envelope']:{bindle_artefact:1,id:ID,kind:'fragment',versions:[{version:1,prev:null,body:fragment}]}},FEDERATION_CONTRACTS:{[C]:body,[C+'/envelope']:{bindle_artefact:1,id:C,kind:'rpc-contract',versions:[{version:1,prev:null,body}]}}};
 const port=configuredArtefacts({config,store:scheduler?scheduler.wrap(db,'artefacts'):db,clock});config.ARTEFACTS=port;
 const service=new FederationService({issuer:'https://provider.example',store:federationMetadata(db),schemaHosts:['settings.example'],schemaFetcher:reviewedSchemaFetcher(config),pinContract:target=>pinConfiguredContract(config,target)}),engine=createAppEngine({providers:{federation:service,clock,random:{},audit:{record(){}}}}),digest=await versionDigest(versionRecord({id:C,kind:'rpc-contract'},{version:1,prev:null,body}));
 t.after(async()=>{await engine.dispose();await port.engine.dispose();db.close();});const pin=extra=>perform(engine,new PinGrantRequests({input:[{fragment:ID,required:true,purpose:'See selected files',fields:['files'],methods:{files:{[C]:['get']}},...extra}]}));return {config,port,pin,digest};
}
test('ART-8 configured contracts pin through the grant engine, validate arguments and shape results by digest',async t=>{
 const f=await fixture(t),[pin]=await f.pin();assert.deepEqual(pin.contract_versions,{[C]:{version:1,digest:f.digest}});
 assert.deepEqual(await configuredContractVersion(f.config,{contract:C,reference:pin.contract_versions[C],method:'get',args:{key:'a'},result:{name:'A',privateEmail:'hidden'}}),{reference:pin.contract_versions[C],result:{name:'A'}});
 await assert.rejects(configuredContractVersion(f.config,{contract:C,reference:pin.contract_versions[C],method:'get',args:{overwrite:true}}),{code:'invalid_args'});
 await assert.rejects(f.pin({contract_versions:{[C]:{version:1,digest:'sha256-'+'A'.repeat(43)}}}),{code:'artefact_digest_mismatch'});assert.equal((await f.pin())[0].contract_versions[C].digest,f.digest);
 f.config.ARTEFACT_VERSIONS_ENABLED='false';await assert.rejects(pinConfiguredContract(f.config,C),{code:'unsupported_artefact_version'});assert.equal((await f.port.resolve({artefact:C,...pin.contract_versions[C]})).body.$id,C);
 const off=await fixture(t,{enabled:false}),[legacy]=await off.pin();assert.equal(legacy.contract_versions,undefined);assert.equal(legacy.version,undefined);await assert.rejects(off.pin({contract_versions:pin.contract_versions}),{code:'invalid_args'});
});
test('ART-8 seeded concurrent contract pins reject forged references without poisoning accepted grants',async t=>{
 await forEachSeed(12,async random=>{const scheduler=createScheduler(random),f=await fixture(t,{scheduler}),results=await scheduler.run(Array.from({length:6},(_,i)=>()=>f.pin(i%2?{}:{contract_versions:{[C]:{version:1,digest:'sha256-'+'A'.repeat(43)}}})));for(const [i,r]of results.entries())if(i%2){assert.equal(r.status,'fulfilled');assert.equal(r.value[0].contract_versions[C].digest,f.digest);}else{assert.equal(r.status,'rejected');assert.equal(r.reason.code,'artefact_digest_mismatch');}});
});

test('ART-8 a live directory flag change revalidates registrations and cached metadata with version references',async()=>{
 const clientId='https://integration.example/app/client.json',cv={[C]:{version:1,digest:'sha256-'+'A'.repeat(43)}},manifest={v:1,resources:{rpc_endpoint:'https://integration.example/app/rpc',discovery_endpoint:'https://integration.example/app/discover',contracts:[C],cv}},raw={client_id:clientId,redirect_uris:['https://integration.example/app/callback'],token_endpoint_auth_method:'private_key_jwt',jwks_uri:'https://integration.example/app/jwks',bindle_integration:manifest};let fetches=0;
 const directory=new ClientDirectory({enabled:true,integrations:true,fetch:async()=>{fetches++;return Response.json(raw);}});assert.equal((await directory.resolve(clientId)).integration.manifest.resources.cv,undefined);directory.artefactVersions=true;assert.deepEqual((await directory.resolve(clientId)).integration.manifest.resources.cv,cv);assert.equal(fetches,2);directory.artefactVersions=false;assert.equal((await directory.resolve(clientId)).integration.manifest.resources.cv,undefined);
 const registered=new ClientDirectory({integrations:true,clients:[{id:clientId,origin:'https://integration.example',redirectUris:raw.redirect_uris,authMethod:'private_key_jwt',jwksUri:raw.jwks_uri,bindle_integration:manifest}]});assert.equal((await registered.resolve(clientId)).integration.manifest.resources.cv,undefined);registered.artefactVersions=true;assert.deepEqual((await registered.resolve(clientId)).integration.manifest.resources.cv,cv);
});
test('ART-8 reviewed consent copy stays per method and per digest when two pins share one URL',async()=>{
 const contracts=await consentContracts(),contract='https://3sln.me/artefacts/contracts/object-storage/v1',prior=contracts[contract],schema=structuredClone(prior.schema);schema.$defs??={};schema['x-methods']={get:{}};schema['x-methods'].get.result={type:'object',properties:{privateEmail:{type:'string'}}};
 const pin={schema,version:2,digest:'sha256-'+'A'.repeat(43),reviewedPin:prior},provider=createConsentProvider({contracts,contractsByGrant:{changed:{[contract]:pin}},registrableDomain:h=>h}),model=provider.model({app:'https://app.example/client',grants:[{id:'old',kind:'contract',contract,methods:['get']},{id:'changed',kind:'contract',contract,methods:['get']}]});assert.equal(model.grants.find(g=>g.id==='old').rows[0].risk.reviewed,true);assert.equal(model.grants.find(g=>g.id==='changed').rows[0].risk.reviewed,false);
});

test('ART-8 the frozen storage compatibility snapshot pins its unchanged published body and shapes only v1 results',async t=>{
 const f=await fixture(t),contract='https://3sln.me/artefacts/contracts/object-storage/v1',pin=await pinConfiguredContract(f.config,contract);assert.deepEqual(Object.keys(contractMethods(pin.schema)),['capabilities','get','put','delete','presign']);assert.deepEqual(contractMethods({...pin.schema,title:'Changed'}),{});
 const result=await configuredContractVersion(f.config,{contract,reference:{version:pin.version,digest:pin.digest},method:'delete',args:{key:'a',version:'etag'},result:{deleted:true,privateEmail:'hidden'}});assert.deepEqual(result.result,{deleted:true});
});
