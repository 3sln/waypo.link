import test from 'node:test';
import {rpcHeaders,encodeRPC,rpcBody,RPC_MEDIA_TYPE} from '../helpers/rpc.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestEngine,memoryStore} from './helpers/engine.mjs';
import {party,claimsFor,world,NOW} from './vectors/fixtures.mjs';
import * as B from '../../packages/messaging-protocol/index.mjs';
import {ReceiveDomain} from '../../packages/messaging-engine/store/mailbox.mjs';
import {SHELL_OPERATIONS} from '../../apps/parlay/worker/operations.mjs';
import {INTEGRATION_OPERATIONS,resourceId} from '../../apps/parlay/worker/integration.mjs';
import {sealedDelegateKeys} from '../../apps/parlay/worker/delegate-keys.mjs';
import {clientMetadata,metadataPort} from '../../apps/parlay/worker/metadata.mjs';
import {createHTTP} from '../../apps/parlay/worker/http.mjs';
import {LEGACY_JTI_CACHE,CTI_CACHE} from '../../apps/parlay/worker/integration.mjs';
import {verifyIntegrationEvent,INTEGRATION_EVENT_MEDIA_TYPE} from '../../packages/sdk/src/integration-events.mjs';
import {decode as decodeCBOR} from '../../packages/sdk/src/cbor.mjs';
import {brokeringKeys} from '../../packages/federation/signing.mjs';
import {fragmentOutcome} from '../../packages/core/fragments.mjs';
import {digest,canonical} from '../../packages/core/records.mjs';
import {validateIntegrationManifest} from '../../packages/federation/integrations.mjs';
const vectors=JSON.parse(await readFile(new URL('./vectors/vectors.json',import.meta.url))),alice=await party('alice',vectors.keys),owner=alice.principal.subject,config={principal:alice.principal,ingress:alice.ingress,plan:'free'},resource=resourceId(config),encoder=new TextEncoder();
const grant={revision:1,active:true,recipients:[],connection:'connection-1',generation:3},verified={owner,issuer:alice.principal.issuer,connection:grant.connection,generation:3,purpose:'invoke',resource,grant:'grant-1',methods:['describe'],live:true};
function engine(t,{providers={}}={}){const h=createTestEngine({owner,store:memoryStore([['owner',owner],['config',config],['shell:authorization',grant]]),registry:{...SHELL_OPERATIONS,...INTEGRATION_OPERATIONS},providers:{receive:ReceiveDomain,...providers}});t.after(()=>h.dispose());return h;}
const RETIRED_INTAKE='https://spec.bindle.example/contracts/public-intake/v1';
const event=(type,payload,over={})=>({owner,issuer:alice.principal.issuer,connection:grant.connection,cti:Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),seq:1,type,payload,...over});

test('BB-B8 client metadata carries a confidential integration manifest: resource contracts claimed, the item-classification fragment pinned by digest',async()=>{
 const client=clientMetadata();assert.equal(client.token_endpoint_auth_method,'private_key_jwt');
 // Extensions rev 3.2 (CR-X3-27): no occupant or consumer declarations; Parlay claims the mailbox contract (the
 // public-intake contract went with the email bridge, 2026-10-28) and
 // requests the shared Bindle item-classification fragment (CR-X3-25, IC-4) as an optional setup grant, pinned by its
 // digest: the text and fallback classifier fields with capabilities and classify, and their detail fields; it sends its
 // own categories with each call.
 assert.equal(client.bindle_integration.extensions,undefined);
 const classifier=JSON.parse(await readFile(new URL('../../docs/artefacts/fragments/item-classification-v1.json',import.meta.url)));assert.equal(fragmentOutcome(classifier).status,'valid');
 const setup=client.bindle_integration.setup.fragments.find(f=>f.fragment===classifier.id);assert.equal(setup.required,false);assert.equal(setup.digest,'sha256-'+await digest(crypto,canonical(classifier)));
 assert.deepEqual(setup.fields,['text','fallback','textDetail','fallbackDetail']);for(const field of setup.fields)assert.ok(Object.hasOwn(classifier.fields,field),field);
 assert.deepEqual(setup.methods,{text:{'https://spec.bindle.example/contracts/item-classification/v1':['capabilities','classify']},fallback:{'https://spec.bindle.example/contracts/item-classification/v1':['capabilities','classify']}});assert.equal(JSON.stringify(client).includes('decision-model'),false);assert.equal(JSON.stringify(client).includes('item-classifier/v1'),false);
 const parsed=validateIntegrationManifest(client.bindle_integration,{clientId:client.client_id,confidential:true});assert.equal(parsed.status,'valid');assert.equal(parsed.manifest.extensions,undefined);
 assert.deepEqual(parsed.manifest.resources.contracts,['https://spec.bindle.example/messaging/v1/contracts/mailbox']);assert.equal(JSON.stringify(client).includes('public-intake'),false);
 const shipped=JSON.parse(await readFile(new URL('../../apps/parlay/integration.json',import.meta.url)));assert.deepEqual(shipped.resources.contracts,[B.MAILBOX_CONTRACT]);
 assert.equal((await metadataPort()('/bindle/client.json')).bindle_integration.v,1);
 await assert.rejects(metadataPort()('/bindle/jwks.json'),e=>e.code==='recipient_unavailable');
 const publicSet=await metadataPort({services:{publicJwks:async()=>({keys:[{...alice.identity.publicJwk,kid:'client-1',untrusted:'omitted'}]})}})('/bindle/jwks.json');assert.equal(publicSet.keys[0].untrusted,undefined);assert.equal(publicSet.keys[0].alg,'ES256');
 await assert.rejects(metadataPort({services:{publicJwks:async()=>({keys:[{...vectors.keys.alice.identity,kid:'private'}]})}})('/bindle/jwks.json'),e=>e.code==='recipient_unavailable');
});

test('BB-B8 delegation renewal seals one key, verifies provider certificates and persists the half-life alarm',async t=>{
 const h=engine(t),secret=B.base64url(new Uint8Array(32).fill(7)),clientId='https://alice.box.example/client.json',directory=world({alice});let calls=0,firstJkt;
 const certify=async({owner:subject,input,renew})=>{
  assert.equal(subject,owner);assert.equal(renew,calls>0);const jkt=await B.thumbprint(input.delegate);firstJkt??=jkt;assert.equal(jkt,firstJkt);
  const publicKey=await B.importVerifyKey(input.delegate),pop=encoder.encode('bindle-key-delegation-pop-v1\n'+JSON.stringify({aud:alice.principal.issuer,client_id:clientId,iat:input.proof.iat,jkt,sub:owner}));
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,B.fromBase64url(input.proof.signature),pop),true);calls++;
  const claims=claimsFor('alice',input.delegate,jkt,{now:h.clock.now(),iat:Math.floor(h.clock.now()/1000),purposes:input.purposes});return {certificate:await B.encodeDelegation(claims,{privateKey:alice.identityPrivate,keyId:alice.keyId})};
 };
 // Use the same harness engine with the real key provider, including the actual renewal Action/audit.
 const keys=sealedDelegateKeys({store:h.store,secret,clientId,certify,directory,clock:h.clock}),run=createTestEngine({owner,store:h.store,clock:h.clock,registry:SHELL_OPERATIONS,providers:{delegateKeys:keys}});t.after(()=>run.dispose());
 const first=await run.run('shell.delegation-renew'),saved=await h.store.get('shell:delegate'),alarm=await h.store.get('shell:renewal');assert.equal(first.jkt,firstJkt);assert.equal(alarm.at,h.clock.now()+43200000);assert.equal(JSON.stringify(saved).includes('"d":'),false);
 const reopened=sealedDelegateKeys({store:h.store,secret,clientId,certify,directory,clock:h.clock}),snapshot=await reopened.current();assert.equal(snapshot.privateKey.extractable,false);assert.equal(snapshot.kid,`jkt:${firstJkt}`);
 await reopened.renew();assert.equal(calls,2);assert.equal((await h.store.get('shell:delegate')).sealed,saved.sealed,'renewal preserves the private key and immutable send identity');
 await assert.rejects(sealedDelegateKeys({store:h.store,secret:B.base64url(new Uint8Array(32).fill(8)),clientId,certify,directory,clock:h.clock}).current(),e=>e.code==='recipient_unavailable');
});

test('BB-B8 broker Queries bind issuer, connection, generation, resource and methods; writes require live checks',async t=>{
 const h=engine(t),description=await h.run('shell.describe',{input:{verified,resource}});assert.equal(description.ingress,alice.ingress);assert.equal(description.expiresAt,undefined);
 const discovery=await h.run('shell.discover',{input:{verified:{...verified,purpose:'discover'},query:{v:1,contracts:[B.MAILBOX_CONTRACT],limit:0}}});assert.deepEqual(discovery,{v:1,items:[],exists:true});
 // Discovery lists only the mailbox contract; asking for the retired public-intake contract is invalid.
 const listed=await h.run('shell.discover',{input:{verified:{...verified,purpose:'discover'},query:{v:1,contracts:[B.MAILBOX_CONTRACT]}}});assert.deepEqual(listed.items.map(i=>i.contracts),[[B.MAILBOX_CONTRACT]]);
 await assert.rejects(h.run('shell.discover',{input:{verified:{...verified,purpose:'discover'},query:{v:1,contracts:[RETIRED_INTAKE]}}}),e=>e.code==='invalid_input');
 for(const patch of [{issuer:'https://other.example'},{connection:'foreign'},{generation:4},{resource:'https://other.example/r'},{methods:[]}])await assert.rejects(h.run('shell.describe',{input:{verified:{...verified,...patch},resource}}),e=>e.code==='not_authorized');
 await assert.rejects(h.run('shell.discover',{input:{verified:{...verified,purpose:'discover'},query:{v:1,contracts:[B.MAILBOX_CONTRACT],facets:{unknown:{}}}}}),e=>e.code==='unsupported_facet');
 // Contacts spike phase 4: the mailbox contract's linkRevoked method and its shell operation are gone.
 assert.throws(()=>h.run('shell.link-revoked',{input:{verified,resource,args:{jti:'link-1'}}}),/Unknown operation/);
 // The bridged public-intake shell operation went with the email bridge (2026-10-28).
 assert.throws(()=>h.run('shell.public-intake',{input:{verified,resource}}),/Unknown operation/);
});

test('BB-B8 authenticated events are idempotent by cti, keep generation floors monotonic and never revive old consent',async t=>{
 const h=engine(t),fragment='https://messages.example/preferences/message-storage/v1',newer=event('preferences-updated',{fragment,values:{store:'new'}},{seq:2});await h.run('shell.integration-event',{input:{event:newer}});await h.run('shell.integration-event',{input:{event:newer}});await h.run('shell.integration-event',{input:{event:event('preferences-updated',{fragment,values:null})}});
 assert.deepEqual((await h.store.get('shell:preferences/'+encodeURIComponent(fragment))).values,{store:'new'});
 await h.run('shell.integration-event',{input:{event:event('credential-revoked',{grants:['grant-1'],until:NOW+360000})}});
 await assert.rejects(h.run('shell.describe',{input:{verified,resource}}),e=>e.code==='not_authorized');
 await h.run('shell.integration-event',{input:{event:event('connection-revoked',{generation_floor:3,terminal:true})}});assert.equal((await h.store.get('shell:authorization')).active,true,'an old terminal event does not sever the current generation');
 await h.run('shell.integration-event',{input:{event:event('connection-revoked',{generation_floor:4,terminal:true})}});assert.equal((await h.store.get('shell:authorization')).active,false);
 await h.run('shell.integration-event',{input:{event:event('connection-resumed',{})}});assert.equal((await h.store.get('shell:authorization')).active,false);
 await assert.rejects(h.run('shell.integration-event',{input:{event:event('unknown',{}, {connection:'foreign'})}}),e=>e.code==='not_authorized');
});

test('BB-B8 integration HTTP never accepts a body-supplied verifier, and translates authenticated RPC/events to dispatch',async()=>{
 const calls=[],http=createHTTP({PARLAY_ENABLED:true,mailbox:async()=>({run:async(...args)=>{calls.push(args);return {accepted:true};}}),services:{verifyIntegration:async()=>verified,verifyEvent:async()=>event('unknown',{})}}),headers=rpcHeaders({Authorization:'Bearer broker-test'});
 const request=B.rpcRequest({resource,contract:B.MAILBOX_CONTRACT,method:'describe',args:{},tx:crypto.randomUUID()}),response=await http(new Request('https://messages.example/bindle/rpc',{method:'POST',headers,body:encodeRPC(request)}));assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),RPC_MEDIA_TYPE);assert.deepEqual(await rpcBody(response),{version:'0',tx:request.tx,result:{accepted:true}});
 // JSON is refused with 415 (CBOR body) before verification or dispatch: brokered RPC has no dual stack.
 {const before=calls.length,json=await http(new Request('https://messages.example/bindle/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer broker-test'},body:JSON.stringify(request)}));assert.equal(json.status,415);assert.equal((await rpcBody(json)).error,'unsupported_media_type');assert.equal(calls.length,before);}assert.equal(calls[0][1],'shell.describe');assert.deepEqual(calls[0][2].input.verified,verified);
 assert.equal((await http(new Request('https://messages.example/bindle/events',{method:'POST',headers:{'Content-Type':'application/cwt'},body:Uint8Array.of(0x84)}))).status,202);assert.equal(calls.at(-1)[1],'shell.integration-event');
 {const before=calls.length,set=await http(new Request('https://messages.example/bindle/events',{method:'POST',headers:{'Content-Type':'application/secevent+jwt'},body:'a.b.c'}));assert.equal(set.status,415,'SET JWT delivery is gone (clean break)');assert.equal(calls.length,before);}
 // The retired public-intake contract is refused in the RPC error envelope before verification or any mailbox dispatch.
 const before=calls.length,retired=await http(new Request('https://messages.example/bindle/rpc',{method:'POST',headers,body:encodeRPC(B.rpcRequest({resource,contract:RETIRED_INTAKE,method:'deliver',args:{message:{parts:[]},provenance:'a.b.c'},tx:crypto.randomUUID()}))}));
 assert.equal(retired.status,200);assert.deepEqual(await rpcBody(retired),{version:'0',error:{code:'unsupported_contract'}});assert.equal(calls.length,before);
 const closed=createHTTP({PARLAY_ENABLED:true});{const unavailable=await closed(new Request('https://messages.example/bindle/rpc',{method:'POST',headers,body:encodeRPC(request)}));assert.equal(unavailable.status,503);assert.equal((await rpcBody(unavailable)).error,'recipient_unavailable');}
});

test('AU-S5 verified subject-deleted clears every hot key, pending obligation and alarm silently',async t=>{
 const h=engine(t);for(const key of ['bb:send:task/pending','shell:delegate','shell:renewal','shell:alarm','body/held','receipt/one','conv/work/pending'])await h.store.put(key,{state:'pending',at:NOW+1});
 const deletion=event('subject-deleted',{});await h.run('shell.integration-event',{input:{event:deletion}});assert.equal((await h.store.list({prefix:''})).size,0);
 await h.run('shell.integration-event',{input:{event:deletion}});assert.equal((await h.store.list({prefix:''})).size,0);
});
test('AU-S5 subject-deleted cannot purge another issuer or subject',async t=>{
 const h=engine(t);for(const patch of [{issuer:'https://foreign.example'},{subject:'foreign'}])await assert.rejects(h.run('shell.integration-event',{input:{event:event('subject-deleted',{},patch)}}),e=>e.code==='not_authorized');assert.ok(await h.store.get('config'));
});
test('AU-S5 terminal removal retains the principal mapping for 30 days, then purges unless reconnected',async t=>{
 for(const reconnect of [false,true]){const h=engine(t);await h.run('shell.integration-event',{input:{event:event('connection-revoked',{generation_floor:4,terminal:true})}});const pending=await h.store.get('shell:purge');assert.equal(pending.at,h.clock.now()+30*86400000);assert.ok(await h.store.get('config'));
 if(reconnect)await h.store.put('shell:authorization',{...grant,generation:4});h.clock.advance(30*86400000);const result=await h.run('shell.purge-expired');assert.equal(result.purged,!reconnect);assert.equal((await h.store.list({prefix:''})).size===0,!reconnect);}
});

test('AU-S5 clean cleanup requires a verified matching request, keeps archive by default and purges only after successful work',async t=>{
 const {REMOVAL_OPERATIONS}=await import('../../apps/parlay/worker/removal.mjs'),h=engine(t),run=createTestEngine({owner,store:h.store,clock:h.clock,registry:REMOVAL_OPERATIONS,providers:{mailboxCleanup:{}}});t.after(()=>run.dispose());
 const claims={iss:alice.principal.issuer,sub:config.principal.subject,exp:Math.floor(h.clock.now()/1000)+300,jti:'request-one',bindle:{removal:'removal-one',connection:grant.connection,generation:grant.generation,return_uri:alice.principal.issuer+'/remove/return'}};
 await assert.rejects(run.run('shell.removal-prepare',{input:{claims:{...claims,sub:'other'}}}),e=>e.code==='not_authorized');await run.run('shell.removal-prepare',{input:{claims}});
 await run.run('shell.removal-prepare',{input:{claims:{...claims,jti:'fresh-reissue'}}});assert.equal((await h.store.get('shell:removal')).jti,'fresh-reissue');
 assert.deepEqual(await run.run('shell.removal-options'),{delete:false,export:false});await assert.rejects(run.run('shell.removal-complete',{input:{choice:'delete'}}),e=>e.code==='recipient_unavailable');assert.ok(await h.store.get('config'));
 const result=await run.run('shell.removal-complete',{input:{choice:'keep'}});assert.equal(new URL(result.returnUri).searchParams.get('outcome'),'completed');const {parseRemovalResult}=await import('../../packages/federation/removal.mjs');assert.equal(parseRemovalResult(new URL(result.returnUri).searchParams.get('result')).items[0].disposition,'kept');assert.equal((await h.store.list({prefix:''})).size,0);
});
test('AU-S5 clean archive ports execute before purge and failed external work leaves authority intact',async t=>{
 const {REMOVAL_OPERATIONS}=await import('../../apps/parlay/worker/removal.mjs');for(const fail of [false,true]){const h=engine(t),calls=[],run=createTestEngine({owner,store:h.store,clock:h.clock,registry:REMOVAL_OPERATIONS,providers:{mailboxCleanup:{deleteArchive:async input=>{calls.push(input);assert.ok(await h.store.get('config'));if(fail)throw new Error('offline');}}}});t.after(()=>run.dispose());
 await run.run('shell.removal-prepare',{input:{claims:{iss:alice.principal.issuer,sub:config.principal.subject,exp:Math.floor(h.clock.now()/1000)+300,jti:'request-one',bindle:{removal:'one',connection:grant.connection,generation:grant.generation,return_uri:alice.principal.issuer+'/remove/return'}}}});
 const result=run.run('shell.removal-complete',{input:{choice:'delete'}});if(fail){await assert.rejects(result,/offline/);assert.ok(await h.store.get('config'));}else{await result;assert.equal((await h.store.list({prefix:''})).size,0);}assert.deepEqual(calls,[{owner,prefix:'parlay/v1/'}]);}
});
test('AU-S5 seeded terminal expiry and reconnect race keeps a new generation or clears every obligation',async t=>{
 const {forEachSeed,createScheduler}=await import('../helpers/chaos.mjs');await forEachSeed(20,async random=>{const h=engine(t);await h.run('shell.integration-event',{input:{event:event('connection-revoked',{generation_floor:4,terminal:true})}});h.clock.advance(30*86400000);
 const scheduler=createScheduler(random),operations=scheduler.wrap({purge:()=>h.run('shell.purge-expired'),reconnect:()=>h.store.transaction(async tx=>{if(await tx.get('owner'))await tx.put('shell:authorization',{...grant,generation:4});})});const results=await scheduler.run([()=>operations.purge(),()=>operations.reconnect()]);assert.ok(results.every(r=>r.status==='fulfilled'));
 const keys=await h.store.list({prefix:''});if(keys.size)assert.equal((await h.store.get('shell:authorization')).generation,4);else assert.equal(await h.store.get('bb:send:task/pending'),undefined);
 });
});

test('AU-S5 unknown subject event responds 202 without waking a mailbox or consulting archive ports',async()=>{
 let opened=0;const http=createHTTP({PARLAY_ENABLED:true,services:{verifyEvent:async()=>({unknown:true})},mailbox:async()=>{opened++;throw new Error('must not fetch');}}),response=await http(new Request('https://messages.example/bindle/events',{method:'POST',headers:{'Content-Type':'application/cwt'},body:'verified-by-test-port'}));assert.equal(response.status,202);assert.equal(opened,0);
});

// CBOR phase 5: Parlay's receiver with a verifyEvent port over the SDK verifier and real brokering keys.
test('Parlay /bindle/events verifies COSE events through the SDK helper: 202 once per cti, 400 with a CBOR body for a refused event',async t=>{
 const issuer=alice.principal.issuer,audience='https://messages.example/bindle/events',store=new Map();let tail=Promise.resolve(),opened=0;
 const metadata={transaction(fn){const run=tail.then(()=>fn({get:async k=>structuredClone(store.get(k)),set:async(k,v)=>{store.set(k,structuredClone(v));}}));tail=run.catch(()=>{});return run;}};
 const keys=brokeringKeys({issuer,secret:Buffer.alloc(32,3).toString('base64'),metadata}),h=engine(t),fragment='https://messages.example/preferences/message-storage/v1';
 const verifyEvent=async({contentType,bytes})=>{const v=await verifyIntegrationEvent(bytes,{contentType,keys:await keys.jwks(),issuer,audience,subject:owner,connection:({connection})=>connection===grant.connection});return {owner,issuer:v.claims.iss,connection:v.payload.connection,generation:v.payload.generation,seq:v.payload.seq,cti:v.ctiId,type:v.type.split('/').at(-2),payload:v.payload};};
 const http=createHTTP({PARLAY_ENABLED:true,services:{verifyEvent},mailbox:async()=>{opened++;return {run:(o,name,params)=>h.run(name,params)};}});
 const sign=async(over={},cti=new Uint8Array(16).fill(1))=>(await keys.sign('event',{iss:issuer,sub:owner,aud:audience,iat:Math.floor(Date.now()/1000),cti,events:{'https://spec.bindle.example/events/preferences-updated/v1':{connection:grant.connection,generation:3,seq:5,fragment,revision:'r1',values:{store:'cbor'},...over}}})).message;
 const post=(body,type=INTEGRATION_EVENT_MEDIA_TYPE)=>http(new Request(audience,{method:'POST',headers:{'Content-Type':type},body}));
 await h.store.put(LEGACY_JTI_CACHE,['old-jti-1','old-jti-2']);
 const message=await sign();assert.equal((await post(message)).status,202);
 assert.deepEqual((await h.store.get('shell:preferences/'+encodeURIComponent(fragment))).values,{store:'cbor'});
 assert.equal(await h.store.get(LEGACY_JTI_CACHE),undefined,'the SET-era jti cache is reset by the first event');assert.deepEqual(await h.store.get(CTI_CACHE),[Buffer.alloc(16,1).toString('base64url')]);
 // Retry of the same event (new iat, same cti, newer values): acknowledged, not reprocessed.
 assert.equal((await post(await sign({values:{store:'retry'}}))).status,202);assert.deepEqual((await h.store.get('shell:preferences/'+encodeURIComponent(fragment))).values,{store:'cbor'});
 assert.deepEqual(await h.store.get(CTI_CACHE),[Buffer.alloc(16,1).toString('base64url')]);
 // A tampered event is a permanent 400 with a CBOR {err, description} body, and no mailbox is opened for it.
 const before=opened,tampered=new Uint8Array(message);tampered[tampered.length-1]^=1;const refused=await post(tampered);
 assert.equal(refused.status,400);assert.equal(refused.headers.get('Content-Type'),'application/cbor');assert.equal(decodeCBOR(new Uint8Array(await refused.arrayBuffer())).err,'authentication_failed');assert.equal(opened,before);
 assert.equal((await post(message,'application/cbor')).status,415);
 assert.equal((await post(new Uint8Array(65537))).status,413);
});
