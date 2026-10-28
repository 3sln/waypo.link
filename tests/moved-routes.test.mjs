// PORT-3: moved responses, the redirect router, `identity_moved` at the authorization request and the move endpoint
// (docs/architecture/identity-portability.md §5, §6.3–§6.5; docs/spec/identity-portability.md §5.2, §10, §11), plus
// an HTTP integration of PORT-2 over the real router, IdentityService and AccountController.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {createIdentityEngine} from '../packages/identity/index.mjs';
import {lifecycleIdentityPort} from '../packages/identity/lifecycle-tombstone.mjs';
import {identityEngine,activate,signupInput,sessionContext,PASSWORD} from './helpers/identity-engine.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {transferIdentityPort,attestorFromJwk,transferDueIndex,TRANSFER_KEY} from '../packages/identity/transfer-out.mjs';
import {signMoveStatement,verifyMoveAttestation,parseMoveStatement} from '../packages/identity/succession.mjs';
import {stages,rawTarget,movedLookup,movedAuthorization,movedResponse,movedDirectoryResponse,movedIdentityDocument,allowedMethods,MOVE_PATH} from '../packages/runtime/routes/moved.mjs';
import {ROUTES} from '../packages/runtime/routes/index.mjs';
import {keyPair} from './helpers/transfer-out.mjs';

const {default:http}=await import('../packages/runtime/http.mjs');
const ORIGIN='https://3sln.example',DEST='https://dest.example',BASE=`${DEST}/from/3sln/`,SUB='cccccccc-cccc-4ccc-8ccc-cccccccccccc',DAY=86400000,HOUR=3600000;
const movedAccount=(overrides={})=>({id:SUB,handle:'goneperson',status:'moved',moved:{v:1,to:{iss:DEST,identity:`${DEST}/identity/${SUB}`},redirectBase:BASE,boundRedirectBase:BASE,statement:'s.t.u',attestation:'a.b.c',committedAt:Date.now()-DAY,redirectUntil:Date.now()+89*DAY,movedUntil:Date.now()+89*DAY,exportUntil:Date.now()+29*DAY},...overrides});
const repo=(account=movedAccount(),{fail=false}={})=>({async get(id){if(fail)throw new Error('down');return id===account?.id?structuredClone(account):null;},async findByHandle(handle){if(fail)throw new Error('down');return handle===account?.handle?structuredClone(account):null;}});
const edge=(url,{method='GET',env={}}={})=>{const request=new Request(url,{method});return stages.edge({request,env:{APP_ORIGIN:ORIGIN,IDENTITY_REPOSITORY:repo(),...env},url:new URL(request.url)});};

test('routes: moved is registered first and declares its paths',()=>{
 assert.equal(ROUTES[0].MOVE_PATH,MOVE_PATH);assert.deepEqual(allowedMethods(MOVE_PATH),['POST']);assert.deepEqual(allowedMethods('/api/account/transfer-out'),['GET']);
 for(const action of ['begin','authorize','cancel','dispute','elevate','restart-choice','link','waiting','withdraw'])assert.deepEqual(allowedMethods(`/api/account/transfer-out/${action}`),['POST']);
 assert.equal(allowedMethods('/api/account/transfer-out/other'),null);
});

test('raw targets are taken from the request string, never re-serialized',()=>{
 assert.deepEqual(rawTarget('https://3sln.example/users/a/contact/x?b=%2F&c=+&d=~#frag'),{path:'/users/a/contact/x',rawQuery:'b=%2F&c=+&d=~'});
 assert.deepEqual(rawTarget('https://3sln.example/identity/x'),{path:'/identity/x',rawQuery:null});
 assert.deepEqual(rawTarget('https://3sln.example/a?'),{path:'/a',rawQuery:''});
});

test('a moved contact link answers 308 to redirect_base with the raw query byte for byte, no-store and no-referrer; POST keeps 308',async()=>{
 const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',query='bindle_meta=eyJh.Zm9v&x=%2F+~';
 const response=await edge(`${ORIGIN}/users/goneperson/contact/${id}?${query}`);
 assert.equal(response.status,308);assert.equal(response.headers.get('Location'),`${BASE}users/goneperson/contact/${id}?${query}`);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Vary'),null);assert.equal(response.headers.get('Set-Cookie'),null);
 assert.equal((await edge(`${ORIGIN}/users/goneperson/contact/${id}`,{method:'POST'})).status,308);
 const avatar=await edge(`${ORIGIN}/users/goneperson/contact/${id}/avatar`);assert.equal(avatar.headers.get('Location'),`${BASE}users/goneperson/contact/${id}/avatar`);
 // A public page naming the identity is redirected with a private, bounded cache.
 const profile=await edge(`${ORIGIN}/users/goneperson`);assert.equal(profile.status,308);assert.equal(profile.headers.get('Cache-Control'),'private, max-age=86400');
 assert.equal(await edge(`${ORIGIN}/users/goneperson/contact/${id}`,{method:'OPTIONS'}),undefined);
});

test('identity documents redirect with the moved record in the body; delegation status answers the final revoked itself',async()=>{
 const doc=await edge(`${ORIGIN}/identity/${SUB}/identity.json`);
 assert.equal(doc.status,308);assert.equal(doc.headers.get('Location'),`${BASE}identity/${SUB}/identity.json`);
 assert.deepEqual(await doc.json(),{v:1,iss:ORIGIN,sub:SUB,moved:{statement:'s.t.u',attestation:'a.b.c'}});
 const jkt='A'.repeat(43),status=await edge(`${ORIGIN}/identity/${SUB}/delegations/${jkt}`);
 assert.equal(status.status,200);const body=await status.json();assert.equal(body.status,'revoked');assert.ok(Number.isSafeInteger(body.revokedHour));assert.match(status.headers.get('Cache-Control'),/immutable/);assert.equal(status.headers.get('Location'),null);
 assert.equal((await edge(`${ORIGIN}/identity/${SUB}/delegations/bad`)).status,400);
 // Hooks for the directory.v1 slice (not mounted yet) give the same answer.
 const request=new Request(`${ORIGIN}/.well-known/bindle/directory?handle=goneperson`),env={APP_ORIGIN:ORIGIN,IDENTITY_REPOSITORY:repo()};
 const directory=await movedDirectoryResponse(request,env,{handle:'goneperson'});assert.equal(directory.status,308);assert.equal(directory.headers.get('Location'),`${BASE}.well-known/bindle/directory?handle=goneperson`);assert.equal((await directory.json()).sub,SUB);
 assert.equal((await movedIdentityDocument(new Request(`${ORIGIN}/identity/${SUB}`),env,SUB)).status,308);
});

test('only exact, non-normalized paths and RFC 3986 queries are redirected; everything else falls through to the uniform answers',async()=>{
 const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',moved=await movedLookup({IDENTITY_REPOSITORY:repo()},{handle:'goneperson'});
 for(const url of [`${ORIGIN}/users/goneperson//contact/${id}`,`${ORIGIN}/users/goneperson/contact/${id}%2Favatar`,`${ORIGIN}/users/goneperson/%2e%2e/x`])
  assert.equal(movedResponse({url,method:'GET'},moved,{iss:ORIGIN}),null,url);
 // Dot segments are normalized by URL parsing before routing; a raw dot segment is never redirected.
 assert.equal(movedResponse({url:`${ORIGIN}/users/goneperson/./contact/${id}`,method:'GET'},moved,{iss:ORIGIN}),null);
 assert.equal(movedResponse({url:`${ORIGIN}/users/goneperson/a\\b`,method:'GET'},moved,{iss:ORIGIN}),null);
 // A raw query outside RFC 3986 (as some runtimes pass it through unencoded) is never redirected.
 assert.equal(movedResponse({url:`${ORIGIN}/users/goneperson/contact/${id}?a=<b>`,method:'GET'},moved,{iss:ORIGIN}),null);
 assert.equal(movedResponse({url:`${ORIGIN}/users/goneperson/contact/${id}?a=b c`,method:'GET'},moved,{iss:ORIGIN}),null);
});

test('no redirect for active, unknown, expired or unreadable identities, other origins or host-level paths; after the window the identity answers as deleted',async()=>{
 const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',url=`${ORIGIN}/users/goneperson/contact/${id}`;
 assert.equal(await edge(url,{env:{IDENTITY_REPOSITORY:repo(movedAccount({status:'active'}))}}),undefined);
 assert.equal(await edge(`${ORIGIN}/users/someone.else/contact/${id}`),undefined);
 assert.equal(await edge(url,{env:{IDENTITY_REPOSITORY:repo(movedAccount({moved:{...movedAccount().moved,redirectUntil:Date.now()-1}}))}}),undefined);
 assert.equal(await edge(url,{env:{IDENTITY_REPOSITORY:repo(movedAccount({moved:{...movedAccount().moved,redirectBase:null}}))}}),undefined);
 assert.equal(await edge(url,{env:{IDENTITY_REPOSITORY:repo(movedAccount(),{fail:true})}}),undefined);
 assert.equal(await edge(url,{env:{IDENTITY_REPOSITORY:repo(movedAccount({status:'deleted'}))}}),undefined);
 assert.equal(await edge(`https://other.example/users/goneperson/contact/${id}`),undefined);
 for(const path of ['/.well-known/bindle/manifest.json','/oauth/authorize','/oauth/token','/bindle/rpc','/api/oauth/requests'])assert.equal(await edge(ORIGIN+path),undefined,path);
});

test('identity_moved lookup for authorization requests: this host only, live redirect only',async()=>{
 const env={APP_ORIGIN:ORIGIN,IDENTITY_REPOSITORY:repo()};
 assert.deepEqual(await movedAuthorization(env,'goneperson@3sln.example'),{to:{iss:DEST,identity:`${DEST}/identity/${SUB}`}});
 assert.equal(await movedAuthorization(env,'goneperson@other.example'),null);assert.equal(await movedAuthorization(env,'nobody@3sln.example'),null);assert.equal(await movedAuthorization(env,42),null);
 assert.equal(await movedAuthorization({...env,IDENTITY_REPOSITORY:repo(movedAccount({moved:{...movedAccount().moved,redirectUntil:Date.now()-1}}))},'goneperson@3sln.example'),null);
});

// ---- HTTP integration over the real router ----

const bucket=()=>({get:async()=>null,put:async()=>({}),delete:async()=>{}});
async function integration(t,{flagOn=true}={}){
 const h=identityEngine({config:{origin:ORIGIN,rpID:'3sln.example',rpName:'Fixture',termsVersion:'2026-10-11'}});
 const {owner,file}=await activate(h.act,signupInput({handle:'mover'})),id=owner.account.id;t.after(()=>h.engine.dispose());
 h.clock.advance(20*DAY);
 const record=await h.repository.get(id);Object.assign(record,{verifiedEmail:'owner@moved.example',emailVerifiedAt:h.clock.now()-15*DAY});record.revision++;assert(await h.repository.compareAndSwap(id,record.revision-1,record));
 const login=await h.act('loginPassword',{handle:'mover',password:PASSWORD,turnstileToken:'verified'}),ctx=sessionContext(login);
 const state={on:flagOn,killed:false},notices=[],rpc=[],base=createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}}});
 const mine=name=>['IDENTITY_TRANSFER_OUT_ENABLED','FEDERATION_ENABLED'].includes(name);
 const flags={for:context=>({...base.for(context),enabled:name=>mine(name)?state.on&&!state.killed:base.for(context).enabled(name),background:name=>mine(name)?!state.killed:base.for(context).background(name),global:name=>mine(name)?state.on&&!state.killed:base.for(context).global(name)})};
 const attestation=await keyPair(),metadata=new SqliteMetadata(':memory:'),dueDb=new SqliteMetadata(':memory:');t.after(()=>{metadata.close();dueDb.close();});
 // Recovery file v3 holds no keychain: the dormant transfer-out engine's key-possession check is the test seam `keyProof`.
 let signer;const transferPorts={keyProof:async(owner,proof)=>owner===id&&proof?.signing?.kid===signer?.kid,identity:transferIdentityPort(h.repository,{clock:h.clock.now}),notices:{async deliver(notice){notices.push(notice);return {accepted:true};}},attestor:attestorFromJwk({kid:'att-1',jwk:attestation.privateJwk}),issuer:ORIGIN,due:transferDueIndex(dueDb),hold:async()=>({held:false})};
 const deletionPorts={identity:lifecycleIdentityPort(h.repository,{clock:h.clock.now}),hold:async()=>({held:false}),billing:null,erasure:{federation:null,mcp:null,emailBridge:null,operatorApps:null},exports:null};
 const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket(),archives:bucket(),sql:metadata.sql,config:{APP_ORIGIN:ORIGIN,flags,LIFECYCLE_CLOCK:h.clock.now,LIFECYCLE_LOG:()=>{},KEY_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),ACCOUNT_DELETION_PORTS:deletionPorts,TRANSFER_OUT_PORTS:transferPorts,IDENTITY_ACCOUNT:o=>h.repository.get(o)}});
 await controller.warm(id);signer=await controller.signingKey(id);const keychain={signing:{kid:signer.kid}};
 const authority={clients:[{id:'app',origin:'https://app.example'}],ready:()=>true,beginAuthorization:async()=>({requestId:'unused'})};
 const env={APP_ORIGIN:ORIGIN,MOVED_CLOCK:h.clock.now,flags,ABUSE_HASH_KEY:'moved-routes-test-hash',ABUSE:{consume:async()=>true},IDENTITY_REPOSITORY:h.repository,IDENTITY_ENGINE:()=>createIdentityEngine(h.resources),FEDERATION_AUTHORITY:authority,
  ACCOUNTS:{get:owner=>({invoke:async call=>{rpc.push(call.method);return owner===id?controller.invoke(call):{$fault:{code:'not_found',message:'Not found.',status:404}};}})}};
 const request=(path,{method='GET',value,headers={},auth=true,origin=ORIGIN,context=ctx}={})=>http.fetch(new Request(ORIGIN+path,{method,headers:{...method==='POST'?{'Content-Type':'application/json',Origin:origin}:{},...auth?{Cookie:'__Host-bindle_session='+encodeURIComponent(context.sessionToken),'X-CSRF-Token':context.csrfToken}:{},...headers},...value===undefined?{}:{body:JSON.stringify(value)}}),env,{});
 const signing=signer.privateKey;
 const statement=(transfer,payload={})=>signMoveStatement({kid:keychain.signing.kid,payload:{bindle:'identity-move',v:1,sub:id,kind:'person',seq:1,prev:null,from:{iss:ORIGIN,identity:`${ORIGIN}/identity/${id}`},to:{iss:DEST,identity:`${DEST}/identity/${id}`},iat:Math.floor(h.clock.now()/1000),...payload}},signing);
 return {h,id,ctx,env,state,controller,metadata,notices,rpc,request,keychain,statement,attestation,file,
  stepUp:()=>h.act('stepUp',{method:'password',password:PASSWORD},ctx),
  move:value=>http.fetch(new Request(ORIGIN+MOVE_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),env,{})};
}

test('HTTP: begin and authorize with a fresh step-up, a move-endpoint commit after 24 h, then redirects, identity_moved and uniform credential refusals',async t=>{
 const x=await integration(t);
 assert.equal((await x.request('/api/account/transfer-out')).status,200);
 const stale=await x.request('/api/account/transfer-out/begin',{method:'POST',value:{destination:DEST}});assert.equal(stale.status,401);assert.equal((await stale.json()).error,'step_up_required');
 await x.stepUp();
 const begun=await x.request('/api/account/transfer-out/begin',{method:'POST',value:{destination:DEST,redirect:true}});assert.equal(begun.status,200,await begun.clone().text());
 const draft=(await begun.json()).draft;
 const authorized=await x.request('/api/account/transfer-out/authorize',{method:'POST',value:{draft,recoveryToken:x.file.recoveryToken,keychain:x.keychain,confirm:true}});
 assert.equal(authorized.status,200,await authorized.clone().text());const view=await authorized.json();assert.equal(view.state,'pending');
 assert.ok(x.notices.some(n=>n.kind==='pending'&&n.channel.email==='owner@moved.example'&&n.disputeToken));
 const body={v:1,statement:await x.statement(view.transfer.id),transfer:view.transfer.id,redirect_base:`${DEST}/from/3sln/`};
 const pending=await x.move(body);assert.equal(pending.status,202);assert.equal((await pending.json()).status,'pending');assert.equal(pending.headers.get('Cache-Control'),'no-store');
 assert.equal((await x.move({...body,redirect_base:'https://evil.example/'})).status,409);
 assert.equal((await x.move({...body,extra:true})).status,409);assert.equal((await x.move({v:1,statement:'x',transfer:null,redirect_base:BASE})).status,409);
 x.h.clock.advance(25*HOUR);
 const attested=await x.move(body);assert.equal(attested.status,200);const answer=await attested.json();assert.equal(answer.status,'attested');
 await verifyMoveAttestation(answer.attestation,{statement:parseMoveStatement(body.statement),publicJwk:x.attestation.publicJwk});
 // The owner's old session is now an invalid credential, exactly as for any unknown session.
 const session=await x.request('/api/session');assert.deepEqual(await session.json(),{authenticated:false});
 // Idempotent replies come from the identity's moved record (also after the account record is purged).
 const replay=await x.move(body);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),answer);
 // Only an exact replay answers about a moved identity; anything else is the unknown-identity path (F12).
 x.state.on=false;assert.equal((await x.move(body)).status,200);assert.equal((await x.move({...body,redirect_base:`${DEST}/x/`})).status,404);x.state.on=true;assert.equal((await x.move({...body,redirect_base:`${DEST}/x/`})).status,409);
 // Redirects through the real router.
 const contact=await x.request('/users/mover/contact/dddddddd-dddd-4ddd-8ddd-dddddddddddd?bindle_meta=abc',{auth:false});
 assert.equal(contact.status,308);assert.equal(contact.headers.get('Location'),`${DEST}/from/3sln/users/mover/contact/dddddddd-dddd-4ddd-8ddd-dddddddddddd?bindle_meta=abc`);
 // The authorization request names the new host while the redirect runs.
 const authz=await http.fetch(new Request(ORIGIN+'/api/oauth/requests',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example'},body:JSON.stringify({clientId:'app',identity:'mover@3sln.example'})}),x.env,{});
 assert.equal(authz.status,400,await authz.clone().text());const moved=await authz.json();assert.equal(moved.error,'identity_moved');assert.deepEqual(moved.to,{iss:DEST,identity:`${DEST}/identity/${x.id}`});
 // Read-only export window: the owner signs in with existing credentials into the restricted session.
 const signin=await x.h.act('loginPassword',{handle:'mover',password:PASSWORD,turnstileToken:'verified'});assert.equal(signin.scope,'closure-export');assert.equal(signin.closure.moved,true);
 const owner=await x.h.service.closureOwner(sessionContext(signin));assert.equal(owner.moved.error,'identity_moved');
 await assert.rejects(x.h.act('loginPassword',{handle:'mover',password:'wrong password that is long',turnstileToken:'verified'}),{code:'unauthorized'});
 // Recovery of a moved account is refused like any invalid recovery.
 await assert.rejects(x.h.act('recover',{recoveryToken:x.file.recoveryToken,turnstileToken:'verified'}),{code:'unauthorized'});
 // After the redirect window: no redirect, and the authorization request answers like a deleted identity.
 x.h.clock.advance(91*DAY);
 const after=await movedLookup(x.env,{handle:'mover'},x.h.clock.now());assert.equal(after,null);
 assert.equal(await movedAuthorization(x.env,'mover@3sln.example'),null);
 assert.equal((await x.request('/api/account/transfer-out/begin',{method:'POST',value:{destination:DEST}})).status,401);
});

test('HTTP: notice-link disputes need the header, a valid token and an active identity; path (b) waiting and withdrawal; flag off hides new transfers',async t=>{
 const x=await integration(t);await x.stepUp();
 const draft=(await (await x.request('/api/account/transfer-out/begin',{method:'POST',value:{destination:DEST}})).json()).draft;
 await x.request('/api/account/transfer-out/authorize',{method:'POST',value:{draft,recoveryToken:x.file.recoveryToken,keychain:x.keychain,confirm:true}});
 const token=x.notices.find(n=>n.disputeToken).disputeToken,link=(value,headers={'X-Bindle-Transfer':'1'})=>x.request('/api/account/transfer-out/link',{method:'POST',auth:false,value,headers});
 assert.equal((await link({owner:x.id,token,choice:'hold'},{})).status,403);
 assert.equal((await link({owner:x.id,token:'z'.repeat(43),choice:'hold'})).status,400);
 assert.equal((await link({owner:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',token,choice:'hold'})).status,400);
 const held=await link({owner:x.id,token,choice:'hold'});assert.equal(held.status,200);assert.deepEqual(await held.json(),{state:'held'});
 assert.equal((await x.metadata.get(TRANSFER_KEY)).state,'held');
 const cancelled=await x.request('/api/account/transfer-out/cancel',{method:'POST',value:{}});assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).state,'cancelled');
 // Path (b) through the credentialless route, then withdrawal with the same file.
 await x.request('/api/account/transfer-out/restart-choice',{method:'POST',value:{choice:'keep'}});
 const waiting=await x.request('/api/account/transfer-out/waiting',{method:'POST',auth:false,headers:{'X-Bindle-Transfer':'1'},value:{owner:x.id,recoveryToken:x.file.recoveryToken,keychain:x.keychain,destination:DEST,confirm:true}});
 assert.equal(waiting.status,200,await waiting.clone().text());assert.equal((await waiting.json()).path,'b');
 const withdrawn=await x.request('/api/account/transfer-out/withdraw',{method:'POST',auth:false,headers:{'X-Bindle-Transfer':'1'},value:{owner:x.id,recoveryToken:x.file.recoveryToken}});assert.equal((await withdrawn.json()).state,'cancelled');
 x.state.on=false;
 assert.equal((await x.request('/api/account/transfer-out')).status,200);
 assert.equal((await x.request('/api/account/transfer-out/begin',{method:'POST',value:{destination:DEST}})).status,404);
 const body={v:1,statement:await x.statement('t'.repeat(32)),transfer:null,redirect_base:BASE};assert.equal((await x.move(body)).status,404);
});

test('HTTP: no state for a statement without authorization; uniform refusal for unknown identities',async t=>{
 const x=await integration(t);
 const body={v:1,statement:await x.statement('t'.repeat(32)),transfer:null,redirect_base:BASE};
 const pending=await x.move(body);assert.equal(pending.status,202);assert.equal(await x.metadata.get(TRANSFER_KEY),undefined);
 const unknown=await x.move({...body,statement:await signMoveStatement({kid:'k',payload:{...parseMoveStatement(body.statement).payload,sub:SUB}},(await keyPair()).privateKey)});assert.equal(unknown.status,409);assert.deepEqual(await unknown.json(),{status:'refused'});
 assert.ok(!x.rpc.includes('transferOutStatement')||x.rpc.filter(m=>m==='transferOutStatement').length===1);
});
