// Signaling federation over the durable Node runtime (retargeted from rtc-federation-runtime.test.mjs for signaling
// rev 3.2): the real router mounts `POST /bindle/signaling` (uniform 404 while SIGNALING_FOREIGN_ENABLED is off or the
// allowlist is empty, 202 into the addressed writer's inbound queue while on), the manifest emits the `{spec, options}`
// signaling declaration (with `profiles`, §3.1) only with the flags, the prerequisites and the adapter's mounts, and the
// lifecycle hook (signalingAppRevoked, from the federation grantChanged hook or the connection ending) clears an app's
// approvals and runs §14.2. Session kinds are operator-registered envelopes (FEDERATION_CONTRACTS), as in
// tests/signaling-runtime.test.mjs. Local behaviour only: no real network, peer provider or push service.
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
import {buildBatch,BATCH_MEDIA_TYPE} from '../packages/signaling/messages.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';
import {kindBody,CHAT,SYNC} from './helpers/signaling-fixture.mjs';
import {federationDeclarations} from '../packages/runtime/federation.mjs';
import {SIGNALING_EXTENSION,SIGNALING_CONTRACT,ICE_RELAY_CONTRACT} from '../packages/signaling/extension.mjs';
import {EXT} from '../packages/core/extensions.mjs';
import {IdentityDirectory} from '../packages/federation/directory.mjs';

const ORIGIN='https://signaling-fed-runtime.example',PEER='https://peer.example',PASSWORD='Signaling federation runtime password, long enough!',APP='https://app.example/client';
const envelope=spec=>({bindle_artefact:1,id:spec.line,kind:'intent',versions:[{version:1,prev:null,body:kindBody(spec)}]});
const KINDS=[{line:CHAT,parties:'any'},{line:SYNC,parties:'self'}],ENVELOPES=Object.fromEntries(KINDS.flatMap(k=>{const e=envelope(k);return [[k.line,e],[k.line+'/envelope',e]];}));
const REF=Object.fromEntries(await Promise.all(KINDS.map(async k=>{const e=ENVELOPES[k.line];return [k.line,{artefact:k.line,version:1,digest:await digestJSON(versionRecord(parseEnvelope(e,{id:k.line}),e.versions[0]))}];})));
const BASE={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',SESSION_KINDS_ENABLED:'true',SIGNALING_ENABLED:'true',DIRECTORY_ENABLED:'true',FEDERATION_CONTRACTS:JSON.stringify(ENVELOPES)};
async function legKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}

async function runtime(t,flags){
 const directory=await mkdtemp(join(tmpdir(),'signaling-fed-runtime-')),sent=[];
 const SIGNALING_EGRESS={send:async input=>{sent.push(input);return {status:202,contentType:'',bytes:new Uint8Array()};}};
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',SIGNALING_EGRESS,SIGNALING_FOREIGN_ISSUERS:JSON.stringify([PEER])}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:new URL(ORIGIN).hostname,termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const env={...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts},base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const person=async()=>{
  const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id),actor={kind:'app',owner:id,clientId:APP,origin:'https://app.example',grants:['grant-ok']},owner={kind:'owner',owner:id,parties:[APP]};
  // The owner's session handler approvals (AMD-SG-I1), with the adapter's P1 evidence of a live grant.
  await reviewed((operation,input,as)=>object.signalingDispatch(id,{operation,actor:as,input}),owner,approvals(APP,[REF[CHAT],REF[SYNC]]));
  return {id,object,actor,owner,identity:`${ORIGIN}/identity/${id}`,dispatch:(operation,input,as=actor)=>object.signalingDispatch(id,{operation,actor:as,input})};
 };
 const post=body=>app.fetch(new Request(ORIGIN+'/bindle/signaling',{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE},body}));
 return {app,person,post,sent,accounts};
}
async function batchFor(aud,{iss=PEER,sub='0a0a0a0a-0000-4000-8000-0000000000ee'}={}){
 const leg=await legKey(),now=Math.floor(Date.now()/1000),sid=Buffer.from(Array(16).fill(5)).toString('base64url');
 return buildBatch({messages:[await signMessage({bindle:'signaling-message',v:1,iss,sub,aud,sid,leg:leg.jkt,to:null,seq:1,iat:now,type:'cancel',body:{}},leg.privateKey)]});
}

test('runtime: POST /bindle/signaling is the uniform 404 while SIGNALING_FOREIGN_ENABLED is off; the RTC path is gone',async t=>{
 const f=await runtime(t,BASE),a=await f.person();
 for(const body of [await batchFor(a.identity),'{}','']){const r=await f.post(body);assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'not_found'});}
 const get=await f.app.fetch(new Request(ORIGIN+'/bindle/signaling'));assert.equal(get.status,404);
 const old=await f.app.fetch(new Request(ORIGIN+'/bindle/rtc',{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE},body:await batchFor(a.identity)}));assert.equal(old.status,404);
});

test('runtime: with SIGNALING_FOREIGN_ENABLED on, a step-1-valid batch is queued at the addressed writer (202); unknown targets are the uniform 404',async t=>{
 const f=await runtime(t,{...BASE,SIGNALING_FOREIGN_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:JSON.stringify([{id:APP,name:'App',origin:'https://app.example',redirectUris:['https://app.example/callback']}])}),a=await f.person();
 const ok=await f.post(await batchFor(a.identity));assert.equal(ok.status,202);assert.equal(await ok.text(),'');
 const queued=[...await f.accounts.get(a.id).metadata.list({prefix:'sig/inq/'})];assert.equal(queued.length,1,'only queued: steps 2–8 run later on the writer');
 assert.match(queued[0][1].source??'',/^[0-9a-f]{64}$/,'the pseudonymous source network rides with the batch (review F1)');
 const unknown=await f.post(await batchFor(`${ORIGIN}/identity/0a0a0a0a-0000-4000-8000-0000000000ab`));assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:'not_found'});
 const bad=await f.post('{"v":1}');assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{error:'signaling_batch_invalid'});
 // AMD-RW2: an element issued by this host is refused at the public endpoint (same-host traffic is internal).
 const b=await f.person();const own=await f.post(await batchFor(a.identity,{iss:ORIGIN,sub:b.id}));assert.equal(own.status,400);
 // AMD-RI2: two audiences in one batch are refused whole.
 const two=JSON.parse(await batchFor(a.identity));two.messages.push(JSON.parse(await batchFor(b.identity)).messages[0]);
 assert.equal((await f.post(JSON.stringify(two))).status,400);
 assert.deepEqual(f.sent,[],'nothing was sent outbound');
 // The served manifest carries the declaration with both §3.1 prerequisites, each exactly once.
 const manifest=await (await f.app.fetch(new Request(ORIGIN+'/.well-known/bindle/manifest.json'))).json(),exts=manifest.extensions??[];
 assert.deepEqual(exts.find(e=>e.spec===SIGNALING_EXTENSION)?.options,{endpoint:ORIGIN+'/bindle/signaling',max_leg_certificate_seconds:600,profiles:['data','webrtc']},JSON.stringify(exts));
 for(const spec of [EXT.directory,EXT.artefactVersions])assert.equal(exts.filter(e=>e.spec===spec).length,1,spec);
 assert.ok((manifest.contracts??[]).includes(SIGNALING_CONTRACT));
});

test('runtime: the lifecycle hook (signalingAppRevoked) clears an application\'s approvals and ends its endpoints; an owner mismatch is ignored',async t=>{
 const f=await runtime(t,BASE),a=await f.person();
 const e1=await a.dispatch('signaling.register',{kinds:[CHAT]});assert.ok(e1.endpoint);
 assert.deepEqual(await f.accounts.get(a.id).signalingAppRevoked(a.id,{clientId:'https://other.example/client'}),{ended:0});
 assert.equal((await a.dispatch('signaling.endpoints',{})).endpoints.length,1,'another app\'s revocation keeps this app\'s endpoint');
 assert.equal((await a.dispatch('intents.session-approvals',undefined,a.owner)).approvals.length,2);
 await f.accounts.get(a.id).signalingAppRevoked(a.id,{clientId:APP});
 assert.equal((await a.dispatch('signaling.endpoints',{})).endpoints.length,0,'app-revoked removes every endpoint of the app');
 assert.deepEqual((await a.dispatch('intents.session-approvals',undefined,a.owner)).approvals,[],'and clears its session handler approvals');
 await assert.rejects(a.dispatch('signaling.register',{kinds:[CHAT]}),e=>e.code==='approval_required','nothing is approved until the owner approves again');
 // An owner mismatch is ignored; the hook is not wire-dispatchable on the account object.
 assert.deepEqual(await f.accounts.get(a.id).signalingAppRevoked('0a0a0a0a-0000-4000-8000-000000000000',{clientId:'x'}),{ended:0});
 // Account severance: {all:true} clears approvals of apps with no endpoint or session.
 await reviewed(a.dispatch,a.owner,approvals(APP,[REF[CHAT]]));assert.equal((await a.dispatch('intents.session-approvals',undefined,a.owner)).approvals.length,1);
 await f.accounts.get(a.id).signalingAppRevoked(a.id,{all:true});assert.deepEqual((await a.dispatch('intents.session-approvals',undefined,a.owner)).approvals,[]);
});

test('manifest: the signaling declaration only with every flag, the prerequisites, the allowlist and the adapter mounts; the contract only with the resource mount',()=>{
 // Extensions rev 3.2: `extensions: [{spec, options}]` and the built-in resources implied by `contracts`.
 const config=(extra={})=>({APP_ORIGIN:ORIGIN,...BASE,ARTEFACTS:{enabled:true},SIGNALING_FOREIGN_ISSUERS:JSON.stringify([PEER]),...extra});
 const declared=(c,mounts)=>federationDeclarations(c,{target:'authority',mounts});
 const signaling=(c,mounts)=>(declared(c,mounts).extensions??[]).find(e=>e.spec===SIGNALING_EXTENSION)?.options;
 const both={signaling:true,signalingResource:true},on={SIGNALING_FOREIGN_ENABLED:'true'};
 assert.equal(SIGNALING_EXTENSION,'https://spec.bindle.example/extensions/signaling/v1');
 assert.deepEqual(signaling(config(on),both),{endpoint:ORIGIN+'/bindle/signaling',max_leg_certificate_seconds:600,profiles:['data','webrtc']});
 assert.equal(signaling(config(),both),undefined,'SIGNALING_FOREIGN_ENABLED off');
 assert.equal(signaling(config(on),{}),undefined,'not mounted');
 assert.equal(signaling(config(on),{signaling:true}),undefined,'no signaling resource mount');
 assert.equal(signaling(config(on),{signalingResource:true}),undefined,'no egress mount');
 for(const name of ['SIGNALING_ENABLED','SESSION_KINDS_ENABLED','DIRECTORY_ENABLED','EXTENSIONS_ENABLED','ARTEFACT_VERSIONS_ENABLED'])assert.equal(signaling(config({...on,[name]:'false'}),both),undefined,`${name} off`);
 assert.equal(signaling(config({...on,ARTEFACTS:undefined}),both),undefined,'no artefact store mounted');
 // §3.1 prerequisites: directory and artefact-versions are declared beside it; no intents or intent-links declaration
 // is needed (INTENT_LINKS_ENABLED stays unset here).
 const exts=declared(config(on),both).extensions??[];
 assert.ok(exts.some(e=>e.spec===EXT.artefactVersions),'artefact-versions declared beside it (directory is added by the directory route wrapper; see the served manifest test)');
 assert.equal(config(on).INTENT_LINKS_ENABLED,undefined);assert.ok(!exts.some(e=>/intent/.test(e.spec)),'no intents declaration is required');
 assert.ok(!exts.some(e=>/rtc/.test(e.spec)),'no legacy rtc declaration');
 // Review F7: with SIGNALING_FOREIGN_ISSUERS empty (the default) or invalid, the declaration is withheld whatever the flags.
 for(const list of [undefined,'[]','["http://x.example"]'])assert.equal(signaling(config({...on,SIGNALING_FOREIGN_ISSUERS:list}),both),undefined,`allowlist ${list}`);
 assert.equal(signaling(config({...on,SIGNALING_FOREIGN_ISSUERS:undefined,RTC_FOREIGN_ISSUERS:JSON.stringify([PEER])}),both),undefined,'the retired RTC_FOREIGN_ISSUERS is not read');
 // The signaling contract is listed with the flags and the resource mount, and never without them; ice-relay only
 // with SIGNALING_TURN_ENABLED and a relay configuration.
 assert.ok((declared(config(),{signalingResource:true}).contracts??[]).includes(SIGNALING_CONTRACT),'signaling contract listed');
 for(const name of ['SIGNALING_ENABLED','SESSION_KINDS_ENABLED','EXTENSIONS_ENABLED'])assert.ok(!(declared(config({[name]:'false'}),{signalingResource:true}).contracts??[]).includes(SIGNALING_CONTRACT),`not while ${name} is off`);
 assert.ok(!(declared(config(),{}).contracts??[]).includes(SIGNALING_CONTRACT),'not without the mount');
 assert.ok(!(declared(config(),{signalingResource:true}).contracts??[]).includes(ICE_RELAY_CONTRACT),'no relay contract without SIGNALING_TURN_ENABLED');
});

test('runtime (review F2, F4): the signaling directory is withheld while SIGNALING_FOREIGN_ENABLED is off except on the control path, and spends the host-wide budget',async t=>{
 const f=await runtime(t,BASE),a=await f.person();await a.dispatch('signaling.register',{kinds:[CHAT]});
 const c=f.accounts.get(a.id);await c.signalingDispatch(a.id,{operation:'signaling.endpoints',actor:a.actor,input:{}});
 assert.equal(c.signalingRosterDirectory(),null,'keys, warm and refreshes stay off with the kill switch');
 const control=c.signalingRosterDirectory({control:true});assert.ok(control instanceof IdentityDirectory,'control-only delivery still resolves endpoints');
 assert.equal(control.allowed(PEER),true);assert.equal(typeof control.hostLimiter?.consume,'function','the host-wide limiter (WORK_AUTHORITY)');assert.equal(control.feature,'signaling','its host keys name the signaling feature');
 assert.deepEqual(control.keepFeatures,[SIGNALING_EXTENSION],'the directory keeps the signaling declaration from manifests');
});

// ---- still-valid rules moved here from rtc-bound-default.test.mjs (its no-hang part is tests/signaling-no-hang.test.mjs) ----
import shipped from '../docs/artefacts/signaling-v1.json' with {type:'json'};
import {compileContractVersion} from '../packages/federation/integrations.mjs';
import {SIGNALING_FRAGMENT,SIGNALING_METHODS} from '../packages/signaling/extension.mjs';

test('the shipped signaling/v1 contract carries contract-level x-bindle-brokerable:false and compiles; the marker is root-only (RTC-i divergence 2, §3.2)',()=>{
 assert.equal(shipped['x-bindle-brokerable'],false);assert.equal(shipped.$id,SIGNALING_CONTRACT);
 assert.deepEqual(Object.keys(shipped['x-methods']).sort(),[...SIGNALING_METHODS].sort());
 for(const gone of ['mint_ticket','mint_link'])assert.equal(Object.hasOwn(shipped['x-methods'],gone),false,gone);
 const v=compileContractVersion(structuredClone(shipped));
 assert.equal(v.validate({method:'register',args:{kinds:[CHAT]}}),true);
 assert.equal(v.validate({method:'register',args:{kinds:[CHAT],extra:1}}),false,'unknown argument members are refused');
 assert.equal(v.validate({method:'register',args:{purposes:[CHAT]}}),false,'the RTC purposes member is gone');
 assert.equal(compileContractVersion({...structuredClone(shipped),'x-bindle-brokerable':true}).validate({method:'endpoints',args:{}}),true);
 const nested=structuredClone(shipped);assert.ok(nested.$defs?.jwk,'the contract has a jwk definition');nested.$defs.jwk={...nested.$defs.jwk,'x-bindle-brokerable':false};
 for(const bad of [{...structuredClone(shipped),'x-bindle-brokerable':'false'},nested]){
  const compiled=compileContractVersion(bad);
  assert.throws(()=>{compiled.validate({method:'endpoints',args:{}});compiled.shape('open',{sid:'s',peer_keys:[{jwk:{}}]});},{code:'artefact_unverifiable'});
 }
});

// RTC-i review L3: one precedence for the shipped first-party documents. While SIGNALING_ENABLED and EXTENSIONS_ENABLED
// are on, the shipped signaling/v1 contract wins over an operator registration of the same id for BOTH the plain id and
// its `/envelope`, as the built-in signaling fragment replaces an operator fragment. With a flag off, operator
// registrations apply.
test('review L3: the shipped contract and signaling fragment win consistently over operator registrations while the flags are on',async()=>{
 const {configuredArtefactDocuments}=await import('../packages/runtime/artefact-pins.mjs');
 const {federationSchemas}=await import('../packages/runtime/federation.mjs');
 const operator={...structuredClone(shipped),title:'Operator registration'},slot={id:SIGNALING_FRAGMENT,title:'Operator fragment',fields:{}};
 const on={EXTENSIONS_ENABLED:'true',SIGNALING_ENABLED:'true',SESSION_KINDS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'};
 const env=body=>({bindle_artefact:1,id:SIGNALING_CONTRACT,kind:'rpc-contract',versions:[{version:1,prev:null,body}]});
 for(const registered of [{[SIGNALING_CONTRACT]:operator},{[SIGNALING_CONTRACT+'/envelope']:env(operator)},{[SIGNALING_CONTRACT]:operator,[SIGNALING_CONTRACT+'/envelope']:env(operator)}]){
  const docs=configuredArtefactDocuments({...on,FEDERATION_CONTRACTS:JSON.stringify(registered),FEDERATION_SCHEMAS:JSON.stringify({[SIGNALING_FRAGMENT]:slot})});
  assert.equal(docs[SIGNALING_CONTRACT].title,shipped.title,'plain id: shipped ('+Object.keys(registered)+')');
  assert.equal(docs[SIGNALING_CONTRACT+'/envelope'].versions[0].body.title,shipped.title,'envelope: shipped ('+Object.keys(registered)+')');
  assert.notEqual(docs[SIGNALING_FRAGMENT]?.title,'Operator fragment','the built-in fragment wins too');
  assert.notEqual(federationSchemas({...on,FEDERATION_SCHEMAS:JSON.stringify({[SIGNALING_FRAGMENT]:slot})})[SIGNALING_FRAGMENT].title,'Operator fragment');
 }
 // Either flag off: nothing first-party is added, so an operator registration applies.
 for(const off of [{SIGNALING_ENABLED:'false'},{EXTENSIONS_ENABLED:'false'}]){
  const docs=configuredArtefactDocuments({...on,...off,FEDERATION_CONTRACTS:JSON.stringify({[SIGNALING_CONTRACT]:operator})});
  assert.equal(docs[SIGNALING_CONTRACT].title,'Operator registration');assert.equal(docs[SIGNALING_CONTRACT+'/envelope'],undefined);
 }
 // The retired RTC contract id is never first-party.
 assert.equal(configuredArtefactDocuments(on)['https://spec.bindle.example/contracts/rtc-signaling/v1'],undefined);
});

// Extensions rev 3.2 code review M5, retargeted: account-wide severance (suspension, recovery, deletion) clears every
// session handler approval of every app, including apps with no registered endpoint or live session, through the
// severance hook itself, so an app that reconnects needs the owner's approval again.
test('review M5: account severance clears every session handler approval, not only those of apps with endpoints or sessions',async t=>{
 const f=await runtime(t,BASE),a=await f.person(),account=f.accounts.get(a.id);
 const approvals=async()=>(await a.dispatch('intents.session-approvals',undefined,a.owner)).approvals;
 assert.equal((await approvals()).length,2,'approved, and the app never registered an endpoint');
 await account.connectionsSeverAccount(a.id,{reason:'suspended'});
 assert.deepEqual(await approvals(),[],'the severance hook cleared the approvals');
});
