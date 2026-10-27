// RTC-d over the durable Node runtime: real account single writers (one per person), real certification keys and the
// same-host transport between writers (rtcPeer, gate 'none'). The application hop (a verified federation RPC context)
// is supplied as the RTC-e adapter will supply it: an {kind:'app'} actor plus the config.RTC_BOUND_CHECK port standing
// in for FederationService.checkBound. Local behaviour only: no HTTP contract route (RTC-e), no foreign provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {IdentityService} from '../packages/identity/service.mjs';
import {identityBackupPort} from '../packages/runtime/identity-backup.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {signMessage} from '../packages/rtc/certificates.mjs';
import {linkDigest} from '../packages/rtc/messages.mjs';
import {RTC_PURPOSE_REFERENCES} from '../packages/rtc/purposes.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';
import {lifecycleIdentityPort} from '../packages/identity/lifecycle-tombstone.mjs';
import {purgeBatch} from '../packages/runtime/lifecycle-storage.mjs';
import {rtcEngine} from '../packages/runtime/account/rtc.mjs';
import {RTC_LIMIT_VALUES} from '../packages/app/domains/rtc.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const ORIGIN='https://rtc-runtime.example',PASSWORD='RTC runtime password, long enough to pass!';
const FLAGS={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',RTC_SIGNALING_ENABLED:'true',RTC_TICKETS_ENABLED:'true'};
const CALL=RTC_PURPOSE_REFERENCES[0];
const payloadOf=c=>JSON.parse(Buffer.from(c.split('.')[1],'base64url'));
async function legKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}

async function runtime(t,{flags=FLAGS}={}){
 const directory=await mkdtemp(join(tmpdir(),'rtc-runtime-')),checks=[];
 // The adapter's FederationService.checkBound port: approves exactly the grant ids it was given, for call.
 const RTC_BOUND_CHECK=async input=>{checks.push(input);return input.grants.includes('grant-ok')&&input.member==='purposes'&&input.value===CALL.artefact&&input.reference.digest===CALL.digest;};
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RTC_BOUND_CHECK}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:new URL(ORIGIN).hostname,termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const env={...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts},base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const person=async()=>{
  const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id),actor={kind:'app',owner:id,clientId:'https://app.example/client',origin:'https://app.example',grants:['grant-ok']};
  return {id,object,actor,principal:{iss:ORIGIN,sub:id},identity:`${ORIGIN}/identity/${id}`,
   dispatch:(operation,input,as=actor)=>object.rtcDispatch(id,{operation,actor:as,input}),listen:input=>object.rtcListen(id,{actor,input})};
 };
 return {app,env,person,checks};
}

test('runtime: two people on one host call through a ticket; the writers deliver to each other through rtcPeer',async t=>{
 const f=await runtime(t),a=await f.person(),b=await f.person();
 const ea=await a.dispatch('rtc.register',{purposes:[CALL.artefact]}),eb=await b.dispatch('rtc.register',{purposes:[CALL.artefact]});
 assert.ok(f.checks.every(c=>c.subject.endsWith('/entities/'+c.subject.split('/').pop())&&c.fragment==='https://spec.bindle.example/slots/rtc-signaling/v1'),'the occupant asks with the token subject and the slot fragment');
 const {link}=await b.dispatch('rtc.mint-ticket',{purposes:[CALL.artefact],uses:2,expires_in:600});
 const leg=await legKey(),opened=await a.dispatch('rtc.open',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,to:b.principal,purpose:CALL.artefact,media:['audio'],delegate:leg.jwk,basis:link});
 assert.equal(payloadOf(opened.certificate).aud,b.identity);assert.ok(opened.peer_keys.length>0);
 const now=Math.floor(Date.now()/1000),invite=await signMessage({bindle:'rtc-message',v:1,iss:ORIGIN,sub:a.id,aud:b.identity,sid:opened.sid,leg:leg.jkt,to:null,seq:0,iat:now,type:'invite',
  body:{purpose:{purpose:CALL.artefact,version:CALL.version,digest:CALL.digest},media:['audio'],ring_until:now+60,basis:{link_digest:await linkDigest(link)},context:null,offer:null,callback_digest:null,sas_commit:null}},leg.privateKey);
 assert.deepEqual(await a.dispatch('rtc.send',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,sid:opened.sid,messages:[invite]}),{accepted:1});
 const heard=await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,wait:2});assert.equal(heard.events[0].type,'invite');assert.equal(heard.events[0].projection.caller.sub,a.id);
 const bleg=await legKey(),claim=await b.dispatch('rtc.claim',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:opened.sid,outcome:'accept',delegate:bleg.jwk});
 assert.equal(payloadOf(claim.certificate).role,'callee');
 const accept=await signMessage({bindle:'rtc-message',v:1,iss:ORIGIN,sub:b.id,aud:a.identity,sid:opened.sid,leg:bleg.jkt,to:leg.jkt,seq:0,iat:now,type:'accept',body:{answer:null,sas_nonce:null}},bleg.privateKey);
 await b.dispatch('rtc.send',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:opened.sid,messages:[accept]});
 const answered=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:0,wait:2});assert.equal(payloadOf(answered.events[0].message).type,'accept');
 // Account deletion E4: the deleting writer's drain ends the session with a control statement to the peer.
 // rtcDrain is internal (the deletion executor calls the controller directly, never through invoke).
 await assert.rejects(b.object.rtcDrain(b.id),e=>e.code==='unsupported_method');
 assert.deepEqual(await f.app.resources.accounts.get(b.id).rtcDrain(b.id),{pending:0});
 const told=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:answered.cursor,wait:2});
 assert.equal(told.events.at(-1).state,'ended');assert.equal(payloadOf(told.events.at(-1).control).reason,'revoked');
 // Widening operations from another writer's owner, or a body-supplied actor for another owner, are refused.
 await assert.rejects(a.dispatch('rtc.register',{purposes:[CALL.artefact]},{...a.actor,owner:b.id}),e=>e.code==='unauthorized');
 await assert.rejects(a.object.rtcDispatch(a.id,{operation:'rtc.ingest',actor:{kind:'system',owner:a.id},input:{}}),e=>e.status===404,'system operations are not wire-dispatchable');
});

test('runtime: with RTC_SIGNALING_ENABLED off every widening operation answers the uniform 404',async t=>{
 const f=await runtime(t,{flags:{EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'}}),a=await f.person();
 for(const [operation,input] of [['rtc.register',{purposes:[CALL.artefact]}],['rtc.open',{}],['rtc.mint-ticket',{}],['rtc.renew',{}]])
  await assert.rejects(a.dispatch(operation,input),e=>e.status===404&&e.code==='not_found',operation);
 await assert.rejects(a.dispatch('rtc.set-policy',{other:'public'},{kind:'owner',owner:a.id}),e=>e.status===404);
 assert.deepEqual((await a.dispatch('rtc.sessions',undefined,{kind:'owner',owner:a.id})).sessions,[]);
 assert.equal(f.checks.length,0,'nothing asked the federation port');
});

// ---- review follow-ups (DEVLOG RTC-d "Review follow-ups") -----------------------------------------------------------
async function connectedPair(f){
 const a=await f.person(),b=await f.person();
 const ea=await a.dispatch('rtc.register',{purposes:[CALL.artefact]}),eb=await b.dispatch('rtc.register',{purposes:[CALL.artefact]});
 const {link}=await b.dispatch('rtc.mint-ticket',{purposes:[CALL.artefact],uses:2,expires_in:600});
 const leg=await legKey(),opened=await a.dispatch('rtc.open',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,to:b.principal,purpose:CALL.artefact,media:['audio'],delegate:leg.jwk,basis:link});
 const now=Math.floor(Date.now()/1000),invite=await signMessage({bindle:'rtc-message',v:1,iss:ORIGIN,sub:a.id,aud:b.identity,sid:opened.sid,leg:leg.jkt,to:null,seq:0,iat:now,type:'invite',
  body:{purpose:{purpose:CALL.artefact,version:CALL.version,digest:CALL.digest},media:['audio'],ring_until:now+60,basis:{link_digest:await linkDigest(link)},context:null,offer:null,callback_digest:null,sas_commit:null}},leg.privateKey);
 await a.dispatch('rtc.send',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,sid:opened.sid,messages:[invite]});
 await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,wait:2});
 const bleg=await legKey();await b.dispatch('rtc.claim',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:opened.sid,outcome:'accept',delegate:bleg.jwk});
 const accept=await signMessage({bindle:'rtc-message',v:1,iss:ORIGIN,sub:b.id,aud:a.identity,sid:opened.sid,leg:bleg.jkt,to:leg.jkt,seq:0,iat:now,type:'accept',body:{answer:null,sas_nonce:null}},bleg.privateKey);
 await b.dispatch('rtc.send',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:opened.sid,messages:[accept]});
 const answered=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:0,wait:2});
 return {a,b,ea,eb,opened,answered};
}

test('runtime review M1: the deletion control reaches the peer even when the identity tombstone ran first',async t=>{
 const f=await runtime(t),{a,b,ea,answered}=await connectedPair(f);
 // The identity stage's own drain could not reach A (or ran before this session's last answer), so the tombstone
 // precedes the E4 drain: rtcPublicKeys now answers null for B, and A's 60 s key memo lapses (an idle stretch in a
 // call). A verifies the control with the keys pinned on the session.
 assert.equal(await lifecycleIdentityPort(f.app.resources.repository).tombstone(b.id,{reason:'owner'}),true);
 const realNow=Date.now;Date.now=()=>realNow()+61000;t.after(()=>{Date.now=realNow;});
 assert.deepEqual(await f.app.resources.accounts.get(b.id).rtcDrain(b.id),{pending:0});
 const told=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:answered.cursor,wait:2});
 assert.equal(told.events.at(-1)?.state,'ended');assert.equal(payloadOf(told.events.at(-1).control).reason,'revoked');
 assert.deepEqual((await a.dispatch('rtc.sessions',undefined,{kind:'owner',owner:a.id})).sessions,[]);
});

test('runtime review M1: the purge runs the RTC drain before the identity tombstone',async()=>{
 const calls=[],metadata=new SqliteMetadata(':memory:');let fences=0;
 const c={metadata,rtcDrain:async owner=>{calls.push(['rtcDrain',owner]);throw new Error('peer down');},connectionsSeverAccount:async()=>{calls.push(['sever']);}};
 const identity={get:async()=>({assignmentId:'x'}),tombstone:async owner=>{calls.push(['tombstone',owner]);return true;}};
 const owner='0a0a0a0a-0000-4000-8000-0000000000aa';
 const out=await purgeBatch(c,owner,{identity,fence:async()=>++fences===1,reason:'inactive'});
 assert.equal(out.halted,true);assert.deepEqual(calls.map(x=>x[0]),['rtcDrain','sever','tombstone'],'a failing drain never blocks the tombstone');
});

test('runtime review L1: the per-caller limit is one window shared by every writer on the host',async t=>{
 const f=await runtime(t),a=await f.person(),b=await f.person();
 const sa=rtcEngine(f.app.resources.accounts.get(a.id)).service,sb=rtcEngine(f.app.resources.accounts.get(b.id)).service,caller=[ORIGIN,'0a0a0a0a-0000-4000-8000-0000000000bb'];
 assert.ok(sa.hostLimits&&sb.hostLimits,'wired to the host WORK_AUTHORITY');
 let admitted=0;for(let i=0;i<20;i++){if(await sa.hostLimits.take('caller',caller))admitted++;if(await sb.hostLimits.take('caller',caller))admitted++;}
 assert.equal(admitted,RTC_LIMIT_VALUES.caller.max);
});
