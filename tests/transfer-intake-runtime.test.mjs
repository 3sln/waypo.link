import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController,IdentityRepository} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {transferFixture,OWNER} from './helpers/transfer-out.mjs';
import {createNetwork} from './helpers/portability-network.mjs';
import {serveSource,packageFrom} from './helpers/transfer-in.mjs';
import {transferInIdentityPort} from '../packages/identity/transfer-in.mjs';
import {transferIntakeConfig} from '../packages/runtime/transfer-intake.mjs';
const DEST='https://dest.example',bucket=()=>({get:async()=>null,put:async()=>({}),delete:async()=>{}});
async function fixture(t){
 const source=await transferFixture(t,{seed:18}),network=createNetwork();serveSource(network,source);await source.start();const pkg=packageFrom(source,await source.get());
 const metadata=new SqliteMetadata(':memory:'),idDb=new SqliteMetadata(':memory:');t.after(()=>{metadata.close();idDb.close();});const repository=new IdentityRepository({metadata:idDb,config:{}}),identity=transferInIdentityPort(repository,{clock:source.clock.now});
 const flags={for:()=>({enabled:name=>name==='IDENTITY_TRANSFER_IN_ENABLED',background:()=>true,global:name=>name==='IDENTITY_TRANSFER_IN_ENABLED',evaluate:()=>({value:false}),envState:()=>({state:'unset'})})};
 const config={APP_ORIGIN:DEST,flags,LIFECYCLE_CLOCK:source.clock.now,LIFECYCLE_LOG:()=>{},KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),TRANSFER_IN_PORTS:{identity,fetch:network.fetch}};
 const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket(),archives:bucket(),sql:metadata.sql,config});
 return {pkg,metadata,repository,controller,config,network};
}
test('trusted intake RPC checks and reserves over the account durable store without warming or importing keys',async t=>{
 const x=await fixture(t),checked=await x.controller.invoke({method:'transferIntakeAssess',args:[OWNER,{package:x.pkg},{reserve:false}]});assert.equal(checked.mode,'attested');assert.equal(checked.sub,OWNER);assert.equal(await x.metadata.get('owner'),undefined);assert.equal(await x.metadata.get('signing-key'),undefined);assert.equal(await x.repository.get(OWNER),undefined);
 const reserved=await x.controller.invoke({method:'transferIntakeAssess',args:[OWNER,{package:x.pkg},{reserve:true}]});assert.equal(reserved.sub,OWNER);assert.equal((await x.repository.get(OWNER)).status,'pending-transfer');assert.equal(await x.metadata.get('owner'),undefined);assert.equal(await x.metadata.get('signing-key'),undefined);
 const wrong=await x.controller.invoke({method:'transferIntakeAssess',args:['22222222-2222-4222-8222-222222222222',{package:x.pkg}]});assert.equal(wrong.$fault.code,'forbidden');
});
test('edge intake default delegates validated package subjects to the durable account RPC and rejects malformed packages before RPC',async t=>{
 const x=await fixture(t),calls=[],accounts={get(owner){calls.push(owner);return {invoke:args=>x.controller.invoke(args)};}},ports=transferIntakeConfig({env:x.config,repository:x.repository,accounts,fetch:x.network.fetch});
 const checked=await ports.check({package:x.pkg});assert.equal(checked.mode,'attested');assert.deepEqual(calls,[OWNER]);await assert.rejects(ports.check({package:{sub:OWNER}}),{code:'package_invalid'});assert.equal(calls.length,1);assert.equal(await x.metadata.get('owner'),undefined);
});
test('prior move chains pin attestation keys in the durable account store before enrollment, surviving repeated checks',async t=>{
 const {World}=await import('./helpers/portability-network.mjs'),{fakeClock}=await import('./helpers/chaos.mjs'),{attestationPins,portabilityClient}=await import('../packages/identity/successors.mjs');
 const x=await fixture(t),clock=fakeClock(x.config.LIFECYCLE_CLOCK()),world=new World({net:x.network,clock}),a=await world.provider('https://a.example'),b=await world.provider('https://b.example'),id=await world.identity({sub:OWNER});world.host(a,id);await world.move(id,a,b);
 const pkg={bindle:'identity-package',v:1,sub:OWNER,kind:'person',from:{iss:b.origin,identity:b.state.get(OWNER).identity},keys:{signing:{kid:id.current.kid,jwk:id.current.pair.privateJwk}},transfer:{id:'transfer-id-0123456789',exp:1}};
 const call=()=>x.controller.invoke({method:'transferIntakeAssess',args:[OWNER,{package:pkg},{reserve:false}]}),first=await call();assert.equal(first.mode,'attested');
 const pins=attestationPins({store:x.controller.store,client:portabilityClient({fetch:x.network.fetch,clock:clock.now}),clock:clock.now}),before=await pins.read(a.origin);assert(before.thumbprints.length>0);assert.equal(await x.metadata.get('owner'),undefined);assert.equal(await x.metadata.get('signing-key'),undefined);
 assert.equal((await call()).mode,'attested');assert.deepEqual(await pins.read(a.origin),before);
});
