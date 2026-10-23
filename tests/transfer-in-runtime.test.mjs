// PORT-4 runtime wiring: the account slice (packages/runtime/account/transfer-in.mjs) over a real AccountController and
// its sealed key registry, the account alarm hook, the identity-document port, and the attestation JWKS route of
// packages/runtime/routes/moved.mjs. The source is the real PORT-2 engine served over the simulated network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController,IdentityRepository} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {transferFixture,OWNER,HOUR} from './helpers/transfer-out.mjs';
import {createNetwork} from './helpers/portability-network.mjs';
import {serveSource,packageFrom} from './helpers/transfer-in.mjs';
import {transferInIdentityPort,TransferInIntake,TRANSFER_IN_KEY} from '../packages/identity/transfer-in.mjs';
import {portabilityClient,attestationPins} from '../packages/identity/successors.mjs';
import {createAttestationKeySet,ATTESTATION_KEYS_PATH} from '../packages/identity/attestation-keys.mjs';
import {stages,allowedMethods} from '../packages/runtime/routes/moved.mjs';
import {verifyChain} from '../packages/identity/succession.mjs';

const DEST='https://dest.example';
const bucket=()=>({get:async()=>null,put:async()=>({}),delete:async()=>{}});

async function harness(t,{configured=true}={}){
 const source=await transferFixture(t,{seed:3});const net=createNetwork();serveSource(net,source);
 const metadata=new SqliteMetadata(':memory:'),idDb=new SqliteMetadata(':memory:');t.after(()=>{metadata.close();idDb.close();});
 const repository=new IdentityRepository({metadata:idDb,config:{}}),identity=transferInIdentityPort(repository,{clock:source.clock.now});
 const on={value:true},flags={for:()=>({enabled:name=>name==='IDENTITY_TRANSFER_IN_ENABLED'?on.value:false,background:()=>true,global:name=>name==='IDENTITY_TRANSFER_IN_ENABLED'?on.value:false,evaluate:()=>({value:false}),envState:()=>({state:'unset'})})};
 const attestation=await createAttestationKeySet({kid:'dest-a1'});
 const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket(),archives:bucket(),sql:metadata.sql,config:{APP_ORIGIN:DEST,flags,LIFECYCLE_CLOCK:source.clock.now,LIFECYCLE_LOG:()=>{},KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),IDENTITY_ATTESTATION_KEYS:JSON.stringify(attestation),...configured?{TRANSFER_IN_PORTS:{identity,fetch:net.fetch}}:{}}});
 const client=portabilityClient({fetch:net.fetch,clock:source.clock.now});
 const intake=new TransferInIntake({ports:{issuer:DEST,identity,client,pins:attestationPins({store:controller.store,client,clock:source.clock.now})},flags,clock:source.clock,random:{uuid:()=>crypto.randomUUID()}});
 await source.start();const pkg=packageFrom(source,await source.get());
 return {source,net,metadata,repository,controller,intake,pkg,on,attestation};
}

test('account slice: begin, alarm-driven polling and activation, sealed custody, and the identity document port',async t=>{
 const x=await harness(t);
 await x.intake.reserve({kind:'intake'},{package:x.pkg});
 const begun=await x.controller.transferInBegin(OWNER,{package:x.pkg},{kind:'intake'});
 assert.equal(begun.state,'pending');
 assert.equal(typeof (await x.metadata.get('signing-key')).encrypted?.ciphertext,'string','the imported private key is sealed under KEY_ENCRYPTION_KEY');
 assert.equal(await x.controller.transferInDocument(OWNER),null,'uniform until active');
 x.source.clock.advance(25*HOUR);
 // The account alarm steps transfer-in through the transfer-out hook and min-merges its wake.
 const alarm=await x.controller.transferOutAlarm();assert.equal(alarm.stop,false);
 assert.equal((await x.metadata.get(TRANSFER_IN_KEY)).state,'active');
 assert.equal((await x.controller.transferInStatus(OWNER)).state,'active');
 const doc=await x.controller.transferInDocument(OWNER);
 assert.equal(doc.moves.length,1);assert.equal(doc.keys.filter(k=>k.use==='cert').length,1);
 const chain=await verifyChain({moves:doc.moves,keys:doc.keys.filter(k=>k.use==='sig'),iss:DEST,identity:`${DEST}/identity/${OWNER}`,attestationKeys:async issuer=>(await portabilityClient({fetch:x.net.fetch}).attestationKeys(issuer)).jwks});
 assert.deepEqual(chain.origin,{iss:'https://source.example',sub:OWNER});
 // After activation the controller's ordinary signer is the rotated key, never the imported one.
 const signer=await x.controller.signingKey(OWNER);assert.notEqual(signer.kid,'kid-1');
 assert.equal((await x.controller.transferInTick(OWNER)).action,'active');
});

test('account slice: unconfigured adapters refuse every begin as unavailable; flag off is not found',async t=>{
 const x=await harness(t,{configured:false});
 await assert.rejects(x.controller.transferInBegin(OWNER,{package:x.pkg},{kind:'intake'}),{code:'transfer_in_unavailable'});
 const y=await harness(t);y.on.value=false;
 await assert.rejects(y.controller.transferInBegin(OWNER,{package:y.pkg},{kind:'intake'}),{code:'not_found'});
});

test('attestation JWKS route: the configured chain, public members only, credentialless; uniform 404 without one',async t=>{
 const x=await harness(t);
 assert.deepEqual(allowedMethods(ATTESTATION_KEYS_PATH),['GET','HEAD']);
 const route=env=>stages.public({path:ATTESTATION_KEYS_PATH,request:new Request(`${DEST}${ATTESTATION_KEYS_PATH}`),env});
 const response=await route({IDENTITY_ATTESTATION_KEYS:JSON.stringify(x.attestation)});
 assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 const body=await response.json();assert.deepEqual(body.keys.map(k=>k.kid),['dest-a1']);assert.ok(body.keys.every(k=>!('d' in k)&&k.use==='sig'&&k.alg==='ES256'));
 assert.equal((await route({})).status,404);
 assert.equal((await stages.public({path:ATTESTATION_KEYS_PATH,request:new Request(`${DEST}${ATTESTATION_KEYS_PATH}`,{method:'POST'}),env:{}})).status,405);
});
