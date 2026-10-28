// Signaling over the durable Node runtime (retargeted from rtc-runtime.test.mjs for signaling rev 3.2): real account
// single writers (one per person), real certification keys, the artefact store holding an operator-registered session
// kind, and the same-host transport between writers (signalingPeer, gate 'none'). The application hop (a verified
// federation RPC context) is supplied as the RPC adapter supplies it: an {kind:'app'} actor. The owner approves the app
// through the intents session handler approval (owner operation, with the adapter's P1 evidence). Local behaviour only.
import test from 'node:test';
import {reviewed,approvals} from './helpers/signaling-owner-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {IdentityService} from '../packages/identity/service.mjs';
import {identityBackupPort} from '../packages/runtime/identity-backup.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {digestJSON,versionRecord,parseEnvelope} from '../packages/core/artefacts.mjs';
import {signMessage} from '../packages/signaling/certificates.mjs';
import {offerDigest} from '../packages/signaling/messages.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';
import {lifecycleIdentityPort} from '../packages/identity/lifecycle-tombstone.mjs';
import {purgeBatch} from '../packages/runtime/lifecycle-storage.mjs';
import {signalingEngine} from '../packages/runtime/account/signaling.mjs';
import {LIMIT_VALUES} from '../packages/app/domains/signaling.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {kindBody} from './helpers/signaling-fixture.mjs';

const ORIGIN='https://signaling-runtime.example',PASSWORD='Signaling runtime password, long enough to pass!',APP='https://app.example/client';
const LINE='https://chat.example/kinds/callback/v1';
const BODY=kindBody({line:LINE,parties:'other',profiles:{webrtc:{}},bases:['offer']});
const ENVELOPE={bindle_artefact:1,id:LINE,kind:'intent',versions:[{version:1,prev:null,body:BODY}]};
const DIGEST=await digestJSON(versionRecord(parseEnvelope(ENVELOPE,{id:LINE}),ENVELOPE.versions[0]));
const KIND={artefact:LINE,version:1,digest:DIGEST};
const FLAGS={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',SESSION_KINDS_ENABLED:'true',SIGNALING_ENABLED:'true',FEDERATION_CONTRACTS:JSON.stringify({[LINE]:ENVELOPE,[LINE+'/envelope']:ENVELOPE})};
const payloadOf=c=>JSON.parse(Buffer.from(c.split('.')[1],'base64url'));
async function legKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}

async function runtime(t,{flags=FLAGS}={}){
 const directory=await mkdtemp(join(tmpdir(),'signaling-runtime-'));
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true'}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:new URL(ORIGIN).hostname,termsVersion:'2026-10-11'}});
 const env={...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts},base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const person=async({approve=true}={})=>{
  const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id),actor={kind:'app',owner:id,clientId:APP,origin:'https://app.example',grants:['grant-ok']},owner={kind:'owner',owner:id,parties:[APP]};
  // The owner's session handler approval (AMD-SG-I1): widening, needs the flags and the adapter's P1 evidence.
  // Recorded the way the owner page records it (a review, then the armed decision; packages/signaling/owner-pages.mjs).
  if(approve&&flags.SIGNALING_ENABLED==='true')await reviewed((operation,input,as)=>object.signalingDispatch(id,{operation,actor:as,input}),owner,approvals(APP,[KIND]));
  return {id,object,actor,owner,principal:{iss:ORIGIN,sub:id},identity:`${ORIGIN}/identity/${id}`,
   dispatch:(operation,input,as=actor)=>object.signalingDispatch(id,{operation,actor:as,input}),listen:input=>object.signalingListen(id,{actor,input})};
 };
 return {app,env,person};
}
const message=async(leg,claims)=>signMessage({bindle:'signaling-message',v:1,...claims},leg.privateKey);

async function connectedPair(f){
 const a=await f.person(),b=await f.person();
 const ea=await a.dispatch('signaling.register',{kinds:[LINE]}),eb=await b.dispatch('signaling.register',{kinds:[LINE]});
 // B's app asks A to call back: a bound offer for A, carried in B's own app message (out of band here).
 const {offers}=await b.dispatch('signaling.offer',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,kind:LINE,profile:'webrtc',principals:[a.principal],expires_in:600});
 const token=offers[0].offer,leg=await legKey();
 const opened=await a.dispatch('signaling.open',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,to:b.principal,kind:LINE,profile:'webrtc',params:{offer:null},delegate:leg.jwk,basis:{offer:token}});
 const now=Math.floor(Date.now()/1000);
 const invite=await message(leg,{iss:ORIGIN,sub:a.id,aud:b.identity,sid:opened.sid,leg:leg.jkt,to:null,seq:0,iat:now,type:'invite',body:{kind:KIND,profile:'webrtc',answer_by:now+60,basis:{offer_digest:await offerDigest(token)},context:null,params:{offer:null}}});
 assert.deepEqual(await a.dispatch('signaling.send',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,sid:opened.sid,messages:[invite]}),{accepted:1});
 const heard=await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,wait:2});
 const bleg=await legKey();await b.dispatch('signaling.claim',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:opened.sid,outcome:'accept',delegate:bleg.jwk});
 const accept=await message(bleg,{iss:ORIGIN,sub:b.id,aud:a.identity,sid:opened.sid,leg:bleg.jkt,to:leg.jkt,seq:0,iat:now,type:'accept',body:{params:{answer:null}}});
 await b.dispatch('signaling.send',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:opened.sid,messages:[accept]});
 const answered=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:0,wait:2});
 return {a,b,ea,eb,opened,heard,answered,token,KIND};
}

test('runtime: two people on one host connect on a bound offer; the writers deliver to each other through signalingPeer',async t=>{
 const f=await runtime(t),{a,b,ea,heard,answered,token,opened}=await connectedPair(f);
 assert.equal(heard.events[0].type,'invite');assert.equal(heard.events[0].projection.initiator.sub,a.id);assert.equal(heard.events[0].projection.offer_match,true);
 assert.ok(!JSON.stringify(heard).includes(token),'the offer token never reaches a listen event');
 assert.equal(payloadOf(opened.certificate).aud,b.identity);assert.equal(payloadOf(opened.certificate).role,'initiator');
 assert.equal(payloadOf(answered.events[0].message).type,'accept');
 // Account deletion: the deleting writer's drain ends the session with a control statement to the peer.
 await assert.rejects(b.object.signalingDrain(b.id),e=>e.code==='unsupported_method','the drain is internal');
 assert.deepEqual(await f.app.resources.accounts.get(b.id).signalingDrain(b.id),{pending:0});
 const told=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:answered.cursor,wait:2});
 assert.equal(told.events.at(-1).state,'ended');assert.equal(payloadOf(told.events.at(-1).control).reason,'revoked');
 // A body-supplied actor for another owner, and system operations, are refused.
 await assert.rejects(a.dispatch('signaling.register',{kinds:[LINE]},{...a.actor,owner:b.id}),e=>e.code==='unauthorized');
 await assert.rejects(a.object.signalingDispatch(a.id,{operation:'signaling.ingest',actor:{kind:'system',owner:a.id},input:{}}),e=>e.status===404,'system operations are not wire-dispatchable');
});

test('runtime: a kind the provider does not hold cannot be approved; an unapproved kind answers approval_required',async t=>{
 const f=await runtime(t),a=await f.person({approve:false});
 await assert.rejects(a.dispatch('signaling.register',{kinds:[LINE]}),e=>e.code==='approval_required');
 await assert.rejects(a.dispatch('intents.session-approve',{clientId:APP,kind:{...KIND,digest:'sha256-'+'B'.repeat(43)}},a.owner),e=>e.code==='invalid_args');
 // An app without the adapter's evidence of a live grant cannot be approved (uniform 404).
 await assert.rejects(a.dispatch('intents.session-approve',{clientId:'https://other.example/client',kind:KIND},a.owner),e=>e.status===404);
});

test('runtime: with SIGNALING_ENABLED off every widening operation answers the uniform 404',async t=>{
 const f=await runtime(t,{flags:{EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',SESSION_KINDS_ENABLED:'true',FEDERATION_CONTRACTS:FLAGS.FEDERATION_CONTRACTS}}),a=await f.person();
 for(const [operation,input] of [['signaling.register',{kinds:[LINE]}],['signaling.open',{}],['signaling.offer',{}],['signaling.renew',{}]])
  await assert.rejects(a.dispatch(operation,input),e=>e.status===404&&e.code==='not_found',operation);
 await assert.rejects(a.dispatch('intents.session-approve',{clientId:APP,kind:KIND},a.owner),e=>e.status===404);
 assert.deepEqual((await a.dispatch('signaling.sessions',undefined,a.owner)).sessions,[]);
 // Narrowing stays available.
 assert.deepEqual(await a.dispatch('intents.session-unapprove',{clientId:APP,kind:LINE},a.owner),{removed:false,ended:0});
});

test('runtime review M1: the deletion control reaches the peer even when the identity tombstone ran first',async t=>{
 const f=await runtime(t),{a,b,ea,answered}=await connectedPair(f);
 assert.equal(await lifecycleIdentityPort(f.app.resources.repository).tombstone(b.id,{reason:'owner'}),true);
 const realNow=Date.now;Date.now=()=>realNow()+61000;t.after(()=>{Date.now=realNow;});
 assert.deepEqual(await f.app.resources.accounts.get(b.id).signalingDrain(b.id),{pending:0});
 const told=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:answered.cursor,wait:2});
 assert.equal(told.events.at(-1)?.state,'ended');assert.equal(payloadOf(told.events.at(-1).control).reason,'revoked');
 assert.deepEqual((await a.dispatch('signaling.sessions',undefined,a.owner)).sessions,[]);
});

test('runtime review M1: the purge runs the signaling drain before the identity tombstone',async()=>{
 const calls=[],metadata=new SqliteMetadata(':memory:');let fences=0;
 const c={metadata,signalingDrain:async owner=>{calls.push(['signalingDrain',owner]);throw new Error('peer down');},connectionsSeverAccount:async()=>{calls.push(['sever']);}};
 const identity={get:async()=>({assignmentId:'x'}),tombstone:async owner=>{calls.push(['tombstone',owner]);return true;}};
 const owner='0a0a0a0a-0000-4000-8000-0000000000aa';
 const out=await purgeBatch(c,owner,{identity,fence:async()=>++fences===1,reason:'inactive'});
 assert.equal(out.halted,true);assert.deepEqual(calls.map(x=>x[0]),['signalingDrain','sever','tombstone'],'a failing drain never blocks the tombstone');
});

test('runtime review L1: the per-initiator limit is one window shared by every writer on the host',async t=>{
 const f=await runtime(t),a=await f.person(),b=await f.person();
 const sa=signalingEngine(f.app.resources.accounts.get(a.id)).service,sb=signalingEngine(f.app.resources.accounts.get(b.id)).service,initiator=[ORIGIN,'0a0a0a0a-0000-4000-8000-0000000000bb'];
 assert.ok(sa.hostLimits&&sb.hostLimits,'wired to the host WORK_AUTHORITY');
 let admitted=0;for(let i=0;i<20;i++){if(await sa.hostLimits.take('initiator',initiator))admitted++;if(await sb.hostLimits.take('initiator',initiator))admitted++;}
 assert.equal(admitted,LIMIT_VALUES.initiator.max);
});

test('runtime (review H-1): disconnecting the app connection clears signaling with INTEGRATIONS_ENABLED off; nothing revives on reconnect',async t=>{
 const f=await runtime(t),a=await f.person({approve:false}),b=await f.person({approve:false}),client={id:APP,name:'App',origin:'https://app.example'};
 assert.notEqual(f.env.INTEGRATIONS_ENABLED,'true','the shipped default');
 const conn=await b.object.appBindleConnect(b.id,client,0);
 await reviewed(b.dispatch,b.owner,approvals(APP,[KIND]));
 const eb=await b.dispatch('signaling.register',{kinds:[LINE]});
 await b.dispatch('signaling.offer',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,kind:LINE,profile:'webrtc',principals:[a.principal],expires_in:600});
 const off=await b.object.appDisconnect(b.id,conn.id);
 assert.deepEqual((await b.dispatch('intents.session-approvals',undefined,b.owner)).approvals,[],'approvals cleared at connection end');
 assert.deepEqual((await b.dispatch('signaling.endpoint-list',undefined,b.owner)).endpoints,[],'endpoints removed');
 assert.deepEqual((await b.dispatch('signaling.offers',undefined,b.owner)).offers,[],'offers revoked');
 await b.object.appBindleConnect(b.id,client,off.app.generation);
 await assert.rejects(b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret}),e=>e.code==='not_found','the old endpoint secret never revives');
 await assert.rejects(b.dispatch('signaling.register',{kinds:[LINE]}),e=>e.code==='approval_required','no approval revives');
});

test('runtime: removing the app connection clears its approvals and runs §14.2 (lifecycle hook)',async t=>{
 const f=await runtime(t),{b,eb}=await connectedPair(f);
 assert.equal((await b.dispatch('intents.session-approvals',undefined,b.owner)).approvals.length,1);
 await f.app.resources.accounts.get(b.id).signalingAppRevoked(b.id,{clientId:APP});
 assert.equal((await b.dispatch('intents.session-approvals',undefined,b.owner)).approvals.length,0,'approvals cleared');
 assert.deepEqual((await b.dispatch('signaling.endpoint-list',undefined,b.owner)).endpoints,[],'endpoints removed');
 assert.deepEqual((await b.dispatch('signaling.offers',undefined,b.owner)).offers,[],'offers revoked');
 await assert.rejects(b.dispatch('signaling.register',{kinds:[LINE]}),e=>e.code==='approval_required');
 void eb;
});

test('runtime: the one-time dev reset deletes legacy rtc/ rows on the account alarm (Appendix C)',async t=>{
 const f=await runtime(t),a=await f.person(),c=f.app.resources.accounts.get(a.id);
 for(let i=0;i<5;i++)await c.metadata.put(`rtc/approval/${i}`,{v:1});await c.metadata.put('rtc/block-iss/x',{issuer:'https://spam.example'});
 await c.signalingAlarm();
 assert.equal((await c.metadata.list({prefix:'rtc/'})).size,0);
 assert.equal((await c.metadata.list({prefix:'intent-memory/'})).size,1,'new approvals are untouched');
});
