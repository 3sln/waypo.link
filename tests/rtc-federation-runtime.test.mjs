// RTC-e over the durable Node runtime: the real router mounts `POST /bindle/rtc` (uniform 404 while RTC_FOREIGN_ENABLED
// is off, 202 into the addressed writer's inbound queue while on), the manifest declares rtc-signaling.v1 only with the
// flags and the adapter's RTC_EGRESS mount, and the federation bound-approval hook (rtcAppChanged) ends an app's
// endpoints. Local behaviour only: no real network, peer provider or push service.
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
import {buildBatch,RTC_BATCH_MEDIA_TYPE} from '../packages/rtc/messages.mjs';
import {RTC_PURPOSE_REFERENCES} from '../packages/rtc/purposes.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';
import {federationDeclarations} from '../packages/runtime/federation.mjs';
import {RTC_FEATURE,RTC_SIGNALING_CONTRACT} from '../packages/rtc/extension.mjs';
import {EXT} from '../packages/core/extensions.mjs';
import {IdentityDirectory} from '../packages/federation/directory.mjs';

const ORIGIN='https://rtc-fed-runtime.example',PEER='https://peer.example',PASSWORD='RTC runtime password, long enough to pass!';
const BASE={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',RTC_SIGNALING_ENABLED:'true',DIRECTORY_ENABLED:'true'};
const CALL=RTC_PURPOSE_REFERENCES[0];
async function legKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}

async function runtime(t,flags){
 const directory=await mkdtemp(join(tmpdir(),'rtc-fed-runtime-')),sent=[];
 const RTC_EGRESS={send:async input=>{sent.push(input);return {status:202,contentType:'',bytes:new Uint8Array()};}};
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RTC_EGRESS,RTC_FOREIGN_ISSUERS:JSON.stringify([PEER])}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:new URL(ORIGIN).hostname,termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const env={...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts},base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const person=async()=>{
  const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id),actor={kind:'app',owner:id,clientId:'https://app.example/client',origin:'https://app.example',grants:['grant-ok']};
  // The interim owner-local approval (extensions rev 3.2 removed AMD-X1 and checkBound).
  await object.rtcDispatch(id,{operation:'rtc.approve-app',actor:{kind:'owner',owner:id},input:{clientId:actor.clientId,purposes:[CALL.artefact]}});
  return {id,object,actor,identity:`${ORIGIN}/identity/${id}`,dispatch:(operation,input)=>object.rtcDispatch(id,{operation,actor,input})};
 };
 const post=body=>app.fetch(new Request(ORIGIN+'/bindle/rtc',{method:'POST',headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body}));
 return {app,person,post,sent,accounts};
}
async function batchFor(aud){
 const leg=await legKey(),now=Math.floor(Date.now()/1000),sid=Buffer.from(Array(16).fill(5)).toString('base64url');
 return buildBatch({messages:[await signMessage({bindle:'rtc-message',v:1,iss:PEER,sub:'0a0a0a0a-0000-4000-8000-0000000000ee',aud,sid,leg:leg.jkt,to:null,seq:1,iat:now,type:'cancel',body:{}},leg.privateKey)]});
}

test('runtime: POST /bindle/rtc is the uniform 404 while RTC_FOREIGN_ENABLED is off',async t=>{
 const f=await runtime(t,BASE),a=await f.person();
 for(const body of [await batchFor(a.identity),'{}','']){const r=await f.post(body);assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'not_found'});}
 const get=await f.app.fetch(new Request(ORIGIN+'/bindle/rtc'));assert.equal(get.status,404);
});

test('runtime: with RTC_FOREIGN_ENABLED on, a step-1-valid batch is queued at the addressed writer (202); unknown targets are the uniform 404',async t=>{
 const f=await runtime(t,{...BASE,RTC_FOREIGN_ENABLED:'true'}),a=await f.person();
 const ok=await f.post(await batchFor(a.identity));assert.equal(ok.status,202);assert.equal(await ok.text(),'');
 const queued=[...await f.accounts.get(a.id).metadata.list({prefix:'rtc/inq/'})];assert.equal(queued.length,1,'only queued: steps 2–8 run later on the writer');
 assert.match(queued[0][1].source??'',/^[0-9a-f]{64}$/,'the pseudonymous source network rides with the batch (review F1)');
 const unknown=await f.post(await batchFor(`${ORIGIN}/identity/0a0a0a0a-0000-4000-8000-0000000000ab`));assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:'not_found'});
 const bad=await f.post('{"v":1}');assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{error:'rtc_batch_invalid'});
 assert.deepEqual(f.sent,[],'nothing was sent outbound');
});

test('runtime: the grant hook ends an application\'s RTC endpoints and approval (app-revoked) and narrows them (app-narrowed)',async t=>{
 const f=await runtime(t,BASE),a=await f.person();
 const e1=await a.dispatch('rtc.register',{purposes:[CALL.artefact]});
 assert.deepEqual(await a.object.rtcAppChanged(a.id,{clientId:'https://app.example/client',purposes:[CALL.artefact]}),{ended:0});
 assert.equal((await a.dispatch('rtc.endpoints',{})).endpoints.length,1,'narrowing to a still-approved purpose keeps the endpoint');
 await a.object.rtcAppChanged(a.id,{clientId:'https://app.example/client',purposes:null});
 assert.equal((await a.dispatch('rtc.endpoints',{})).endpoints.length,0,'app-revoked removes every endpoint of the app');
 assert.deepEqual((await a.object.rtcDispatch(a.id,{operation:'rtc.approvals',actor:{kind:'owner',owner:a.id}})).approvals,[],'and its approval record');
 await assert.rejects(a.dispatch('rtc.register',{purposes:[CALL.artefact]}),e=>e.code==='forbidden','nothing is approved until the owner approves again');
 assert.ok(e1.endpoint);
 // Not wire-dispatchable as a system step, and an owner mismatch is ignored.
 assert.deepEqual(await a.object.rtcAppChanged('0a0a0a0a-0000-4000-8000-000000000000',{clientId:'x',purposes:null}),{ended:0});
});

test('manifest: the legacy rtc extension and the signaling contract only with every flag and the adapter mounts',()=>{
 // Extensions rev 3.2: `extensions: [{spec, options}]` and the built-in resources implied by `contracts` (no occupant
 // declaration, no `features`). TODO(signaling Appendix C.1 extension.mjs)
 const config=(extra={})=>({APP_ORIGIN:ORIGIN,...BASE,ARTEFACTS:{enabled:true},RTC_FOREIGN_ISSUERS:JSON.stringify([PEER]),...extra});
 const declared=(c,mounts)=>federationDeclarations(c,{target:'authority',mounts});
 const rtc=(c,mounts)=>(declared(c,mounts).extensions??[]).find(e=>e.spec===RTC_FEATURE)?.options;
 const both={rtc:true,rtcOccupant:true};
 assert.deepEqual(rtc(config({RTC_FOREIGN_ENABLED:'true'}),both),{endpoint:ORIGIN+'/bindle/rtc',max_leg_certificate_seconds:600});
 assert.equal(rtc(config(),both),undefined,'RTC_FOREIGN_ENABLED off');
 assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true'}),{}),undefined,'not mounted');
 assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true',RTC_SIGNALING_ENABLED:'false'}),both),undefined,'signaling off');
 assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true'}),{rtc:true}),undefined,'no signaling resource mount');
 assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true',EXTENSIONS_ENABLED:'false'}),both),undefined,'EXTENSIONS_ENABLED off');
 assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'false'}),both),undefined,'ARTEFACT_VERSIONS_ENABLED off');
 assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true',ARTEFACTS:undefined}),both),undefined,'no artefact store mounted');
 assert.ok((declared(config({RTC_FOREIGN_ENABLED:'true'}),both).extensions??[]).some(e=>e.spec===EXT.artefactVersions),'artefact-versions declared beside it');
 // Review F7: with RTC_FOREIGN_ISSUERS empty (the default) or invalid, the extension is withheld whatever the flags.
 for(const list of [undefined,'[]','["http://x.example"]'])assert.equal(rtc(config({RTC_FOREIGN_ENABLED:'true',RTC_FOREIGN_ISSUERS:list}),both),undefined,`allowlist ${list}`);
 // The signaling contract is listed with the flags and the mount, and never without them.
 assert.ok((declared(config(),{rtcOccupant:true}).contracts??[]).includes(RTC_SIGNALING_CONTRACT),'signaling contract listed');
 assert.ok(!(declared(config({RTC_SIGNALING_ENABLED:'false'}),{rtcOccupant:true}).contracts??[]).includes(RTC_SIGNALING_CONTRACT),'not while signaling is off');
 assert.ok(!(declared(config(),{}).contracts??[]).includes(RTC_SIGNALING_CONTRACT),'not without the mount');
});

test('runtime (review F2, F4): the RTC directory is withheld while RTC_FOREIGN_ENABLED is off except on the control path, and spends the host-wide budget',async t=>{
 const f=await runtime(t,BASE),a=await f.person();await a.dispatch('rtc.register',{purposes:[CALL.artefact]});
 const c=f.accounts.get(a.id);await c.rtcDispatch(a.id,{operation:'rtc.endpoints',actor:a.actor,input:{}});
 assert.equal(c.rtcRosterDirectory(),null,'keys, warm and refreshes stay off with the kill switch');
 const control=c.rtcRosterDirectory({control:true});assert.ok(control instanceof IdentityDirectory,'control-only delivery still resolves endpoints');
 assert.equal(control.allowed(PEER),true);assert.equal(typeof control.hostLimiter?.consume,'function','the host-wide limiter (WORK_AUTHORITY)');assert.equal(control.feature,'rtc','its host keys name the RTC feature');
});
