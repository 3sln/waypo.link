// ORG-10f owner-route authorization matrix. Real durable account writers; no foreign provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {IdentityService} from '../packages/identity/service.mjs';
import {identityBackupPort} from '../packages/runtime/identity-backup.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {stages} from '../packages/runtime/routes/orgs.mjs';
import {personActor} from '../packages/orgs/authority.mjs';
import {importResourceId} from '../packages/runtime/account/relations.mjs';
import {OBJECT_STORAGE} from '../packages/orgs/relation-catalogue.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';
import {dpopKey} from './authorization-entry-helpers.mjs';

const ORIGIN='http://localhost:8788',PASSWORD='Relations runtime password, long enough!',DAY=86400000;
const RELATION_FLAGS={ORGANIZATIONS_ENABLED:'true',DIRECTORY_ENABLED:'true',ORG_RELATIONS_ENABLED:'true'};
const PLANS={check:async()=>({paid:true,plan:'organization-internal',source:'test'})};
async function relationsRuntime(t,{flags=RELATION_FLAGS,config={},clock}={}){
 const directory=await mkdtemp(join(tmpdir(),'orgs-relations-')),now=clock?clock.now:Date.now;
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',ORGANIZATION_PLANS:PLANS,...clock?{LIFECYCLE_CLOCK:clock.now}:{},...config}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'},env={...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATION_PLANS:PLANS};
 const person=async()=>{
  const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id);
  /** One owner-route call as the router would make it. `stale`: an authentication older than the step-up window. */
  const call=async(method,path,{input,routeEnv=env,stale=false}={})=>{
   const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
   const record=await repository.get(id),authTime=now()-(stale?3600000:0);
   const response=await stages.owner({request,env:routeEnv,url:new URL(request.url),path:new URL(request.url).pathname,id,object,context:{remoteIP:'127.0.0.1'},owner:{devices:[]},actor:personActor({owner:id,iss:ORIGIN,authTime,verification:{stepUpAt:authTime,enrolledAt:record.passwordSetAt,securityChangedAt:record.security?.changedAt??0}})})
    .catch(error=>new Response(JSON.stringify({error:error.code,message:error.message}),{status:error.status??500}));
   return {status:response.status,body:await response.json()};
  };
  return {id,object,call,handle:(await repository.get(id)).handle};
 };
 const organization=async(admin,name,members=[])=>{
  const created=await admin.call('POST','/api/orgs',{input:{request:`relations-${name.toLowerCase()}-request-0001`.slice(0,40),name,label:'company'}});assert.equal(created.status,200,JSON.stringify(created.body));
  const org=created.body.organization.id;
  for(const x of members){const invite=await admin.call('POST',`/api/orgs/${org}/invitations`,{input:{invitee:{iss:ORIGIN,sub:x.id},grants:[]}});assert.equal(invite.status,200,JSON.stringify(invite.body));assert.equal((await x.call('POST',`/api/orgs/${org}/accept`,{input:{invitation:invite.body.meta}})).status,200);}
  return {id:org,handle:(await repository.get(org)).handle,principal:{iss:ORIGIN,sub:org},controller:accounts.get(org)};
 };
 const http=(path,init={})=>app.fetch(new Request(ORIGIN+path,{...init,headers:{'CF-Connecting-IP':'192.0.2.20',...init.headers??{}}}));
 /** One alarm-equivalent relations step for each organization (tick: drain, resync, sweep; key refresh). */
 const flush=async(...orgs)=>{for(let i=0;i<3;i++)for(const o of orgs)await accountHandle(env,o.id).relationsFlush(o.id);};
 return {app,env,accounts,repository,person,organization,http,flush};
}

const unknown=r=>assert.deepEqual([r.status,r.body.error],[404,'not_found']);
test('owner routes: every operation checks the default-off flag; every safe-direction operation remains dispatched',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),m=await f.person(),o=await f.organization(a,'Matrix',[m]);
 const path=`/api/orgs/${o.id}/relations`,off={...f.env,ORG_RELATIONS_ENABLED:'false'},bothOff={...off,ORGANIZATIONS_ENABLED:'false'};
 const widening=['upgrade','create','invite','accept','admit','resume','rebind','confirm-counterpart','preview','inbound-preview','introduce'];
 for(const operation of widening){unknown(await a.call('POST',path,{routeEnv:off,input:{operation}}));unknown(await m.call('POST',path,{routeEnv:off,input:{operation}}));}
 // Spy only the transport here: the next test exercises the writer's admin/step-up checks. This verifies the route
 // does not strand any narrowing operation, including with the parent flag off and stale authentication.
 const received=[],spy={...bothOff,ACCOUNTS:{get:()=>({invoke:async({method,args})=>{assert.equal(method,'relationsDispatch');received.push(args[1]);return {done:true};}})}};
 for(const operation of ['withdraw','decline','suspend','end','narrow','leave','mute']){
  const r=await a.call('POST',path,{routeEnv:spy,stale:true,input:{operation}});assert.equal(r.status,200,JSON.stringify(r));assert.equal(received.at(-1).operation,'relations.'+operation);
 }
 for(const cursor of ['', '?after=', '?after=rel%2Finstance%2Flast']){assert.equal((await a.call('GET',path+'/export'+cursor,{routeEnv:spy})).status,200);assert.deepEqual(received.at(-1).input,cursor.includes('last')?{after:'rel/instance/last'}:{});}
 for(const suffix of ['/catalogue','/counterparty'])unknown(await a.call(suffix==='/catalogue'?'GET':'POST',path+suffix,{routeEnv:off,...suffix==='/counterparty'?{input:{handle:'someone'}}:{}}));
 assert.equal((await a.call('GET',path,{routeEnv:bothOff})).status,200);
 assert.equal((await m.call('GET',path+'/imports',{routeEnv:bothOff})).status,200);
 unknown(await m.call('GET',path));unknown(await m.call('GET',path+'/resources'));unknown(await m.call('GET',path+'/catalogue'));
 for(const operation of ['__proto__','constructor','authorize','certify','ingest','tick'])assert.equal((await a.call('POST',path,{input:{operation}})).status,400);
});

test('owner routes: all widening operations require a fresh admin; narrowing refuses ordinary members',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),b=await f.person(),m=await f.person();
 const A=await f.organization(a,'RouteA',[m]),B=await f.organization(b,'RouteB'),path=`/api/orgs/${A.id}/relations`;
 const pin=(await a.call('GET',path+'/catalogue')).body.relations[0].pin;
 const instance=(await a.call('POST',path,{input:{operation:'create',relation:pin,slots:['owner']}})).body.instance;
 const inv=(await b.call('POST',`/api/orgs/${B.id}/relations`,{input:{operation:'create',relation:pin,slots:['owner']}})).body.instance;
 const resource=(await b.call('GET',`/api/orgs/${B.id}/relations/resources`)).body.resources[0].id;
 const meta=(await b.call('POST',`/api/orgs/${B.id}/relations`,{input:{operation:'invite',instance:inv,slot:'recipient',invitee:A.principal,values:{'0':[{resource}]}}})).body.invitation;
 const disclosure=(await a.call('POST',path,{input:{operation:'inbound-preview',invitation:meta}})).body.disclosure;
 // A received introduction is a verified-event product. Seed that product to isolate the owner's admit adapter.
 const introduction='i'.repeat(43);await A.controller.metadata.put('rel/intro/'+introduction,{id:introduction,instance,slot:'recipient',candidate:B.principal,expiresAt:Date.now()+60000});
 const inputs={upgrade:{instance,counterpart:B.principal,version:pin},create:{relation:pin,slots:['owner']},invite:{instance,slot:'recipient',invitee:B.principal},accept:{invitation:meta,disclosure,receive:true},admit:{introduction},resume:{instance,counterpart:B.principal},rebind:{instance,counterpart:B.principal,values:{}},'confirm-counterpart':{counterpart:B.principal,aep:0}};
 for(const [operation,input] of Object.entries(inputs)){
  const stale=await a.call('POST',path,{stale:true,input:{operation,...input}});assert.deepEqual([stale.status,stale.body.error],[401,'reauthentication_required'],operation+JSON.stringify(stale));
  unknown(await m.call('POST',path,{input:{operation,...input}}));
 }
 const narrow={withdraw:{invitation:'missing'},decline:{invitation:meta},suspend:{instance,counterpart:B.principal},end:{instance,counterpart:B.principal},narrow:{instance,counterpart:B.principal,entries:{}},leave:{instance},mute:{counterpart:B.principal}};
 for(const [operation,input] of Object.entries(narrow))unknown(await m.call('POST',path,{input:{operation,...input}}));
 unknown(await m.call('POST',path,{input:{operation:'preview',relation:pin,slot:'owner'}}));
 unknown(await m.call('POST',path,{input:{operation:'inbound-preview',invitation:meta}}));
 unknown(await m.call('POST',path,{input:{operation:'introduce',instance,slot:'recipient',candidate:B.principal}}));
 unknown(await m.call('POST',path+'/counterparty',{input:{handle:B.handle}}));
});

import {relationsHost,ISS,STORE} from './helpers/relations-world.mjs';
import {FederationService,MemoryFederationStore} from '../packages/federation/index.mjs';
import {PREFERENCES_V2} from '../packages/federation/service.mjs';
import {createAppSession,issueAppAccess,boundTokenId} from '../packages/federation/app-sessions.mjs';
import {federationRelationImports} from '../packages/orgs/relation-access.mjs';
import {parseEntityCertificate} from '../packages/identity/entity-certificates.mjs';
test('relay: a DPoP session stores only its public key and preferences issues a usable entity certificate from that stored key',async t=>{
 const h=await relationsHost({orgs:2});t.after(()=>h.close());const [A,B]=h.list,client='https://app.example/client',origin='https://app.example',fragment='https://schema.example/files/v1',key=await dpopKey();
 const resource=await A.resource(`${ISS}/r/1/files`,{[STORE]:['get','put']});const {instance}=await h.relate(A,B,{give:{0:[{resource}]}}),imp=(await B.imports())[0].resources[0].id;
 h.connections.set('c1',{generation:1,clientId:client});
 const store=new MemoryFederationStore(),schema={id:fragment,title:'Files',description:'Files',publisher:'https://schema.example',fields:{store:{title:'Files',type:'resource',cardinality:{min:0,max:4},contracts:[STORE]}}};
 const certify=federationRelationImports({certify:input=>B.system('relations.certify',input),clientOrigin:()=>origin});
 const service=new FederationService({issuer:ISS,clock:()=>h.clock.now(),store,relationImports:certify,clients:[{id:client,name:'App',origin,redirectUris:[origin+'/callback']}],schemaHosts:['schema.example'],schemaFetcher:async()=>schema,authenticateOwner:async()=>({subject:B.id}),dispatchCapability:async()=>{throw Error('unexpected local dispatch');}});
 const grant={id:'g1',active:true,subject:B.id,clientId:client,fragment,digest:'d',epoch:1,connection:{id:'c1',generation:1},fields:['store'],methods:{store:{[STORE]:['get']}},resources:{store:[imp]}};
 await B.metadata.put('federation/grant/g1',grant);
 let issued,session;
 await store.transaction(async tx=>{
  await tx.set('federation/resource/'+imp,await B.get('federation/resource/'+imp));await tx.set('federation/schema/'+fragment,{schema,digest:'d'});
  await tx.set('federation/preferences/'+B.id+'|'+fragment,{fragment,digest:'d',values:{store:[imp]},revision:'r'.repeat(43),resourceRevisions:{store:'s'.repeat(43)}});await tx.set('federation/grant/g1',grant);
  session=await createAppSession(service,tx,{subject:B.id,clientId:client,epoch:1,grants:['g1'],connection:grant.connection},key.jkt,{access:'dpop',jwk:{...key.jwk,d:'must-never-be-stored',key_ops:['sign']}});
  issued=await issueAppAccess(service,tx,session.family);
 });
 const hash=await boundTokenId(service,issued.access_token),record=await store.transaction(tx=>tx.get('federation/token/'+hash));
 assert.deepEqual(session.family.jwk,key.jwk);assert.deepEqual(record.jwk,key.jwk);assert.equal(record.jkt,key.jkt);
 assert.deepEqual(Object.keys(record.jwk).sort(),['crv','kty','x','y']);
 const envelope={version:'0',tx:crypto.randomUUID(),resource:'@preferences',contract:PREFERENCES_V2,method:'read',args:{fragment}};
 const [entry]=(await service.rpc(issued.access_token,envelope,{tokenHash:hash})).result.values.store;
 assert.equal(entry.status,'available');assert.equal(entry.token_type,'BindleEntity');const claims=parseEntityCertificate(entry.token).payload;assert.equal(claims.instance,instance);assert.deepEqual(claims.methods,{[STORE]:['get']});
 const proof=await key.sign({htu:ISS+'/bindle/rpc',ath:entry.token,iat:Math.floor(h.clock.now()/1000)});
 const authorized=await A.system('relations.authorize',{form:'direct',certificate:entry.token,proof,htm:'POST',htu:ISS+'/bindle/rpc',envelope:{resource,contract:STORE,method:'get',args:{key:'a'},tx:crypto.randomUUID()}});
 assert.equal(authorized.allowed,true);
});

import {provider,createEntry,providerPage,exchange,refresh,tokenNonce,codeOf,issuer} from './authorization-entry-helpers.mjs';
test('authorization-code exchange and rotation preserve the verified session public key without private material',async()=>{
 const p=await provider(),key=await dpopKey(),{entryId,verifier}=await createEntry(p,{dpopJkt:key.jkt});
 const code=codeOf((await providerPage(p,entryId,p.signIn())).result.redirectUri),htu=issuer+'/oauth/token';
 const response=await exchange(p,code,verifier,{dpop:await key.sign({htu,nonce:await tokenNonce(p),iat:Math.floor(p.clock()/1000)})});assert.equal(response.status,200);
 const token=await response.json(),service=p.shard(p.accounts[0].owner).service;
 const family=async()=>(await service.store.transaction(tx=>tx.list('federation/family/')))[0].value;
 assert.deepEqual((await family()).jwk,key.jwk);
 const renewed=await refresh(p,token.refresh_token,{dpop:await key.sign({htu,nonce:await tokenNonce(p),iat:Math.floor(p.clock()/1000)})});assert.equal(renewed.status,200);
 assert.deepEqual((await family()).jwk,key.jwk);assert.equal(JSON.stringify(await family()).includes('"d":'),false);
});

import {stages as publicRelations} from '../packages/runtime/routes/relations.mjs';
import {signRelationEvent,relationEventPayload} from '../packages/orgs/relation-events.mjs';
import {RELATION_EVENT} from '../packages/orgs/relation-edges.mjs';
import {certificationSigner} from '../packages/identity/member-certificates.mjs';
import {encryptSecret,decryptSecret} from '../packages/runtime/secrets.mjs';
test('public events: signed inbound suspend/end stay reachable with every flag off, sender injection is refused, unknown audiences stay uniform',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),b=await f.person(),A=await f.organization(a,'EventsA'),B=await f.organization(b,'EventsB');
 const path=o=>`/api/orgs/${o.id}/relations`,pin=(await a.call('GET',path(A)+'/catalogue')).body.relations[0].pin;
 const instance=(await a.call('POST',path(A),{input:{operation:'create',relation:pin,slots:['owner']}})).body.instance;
 const resource=(await a.call('GET',path(A)+'/resources')).body.resources[0].id;
 const meta=(await a.call('POST',path(A),{input:{operation:'invite',instance,slot:'recipient',invitee:B.principal,values:{'0':[{resource}]}}})).body.invitation;
 const disclosure=(await b.call('POST',path(B),{input:{operation:'inbound-preview',invitation:meta}})).body.disclosure;
 assert.equal((await b.call('POST',path(B),{input:{operation:'accept',invitation:meta,disclosure,receive:true}})).status,200);await f.flush(A,B);
 const secret=A.controller.config.KEY_ENCRYPTION_KEY,signer=await certificationSigner({metadata:A.controller.metadata,seal:v=>encryptSecret(v,secret),open:v=>decryptSecret(v,secret)})(A.id);
 const off={...f.env,ORGANIZATIONS_ENABLED:'false',ORG_RELATIONS_ENABLED:'false',ORG_FOREIGN_RELATIONS_ENABLED:'false'};
 Object.assign(B.controller.config,{ORGANIZATIONS_ENABLED:'false',ORG_RELATIONS_ENABLED:'false',ORG_FOREIGN_RELATIONS_ENABLED:'false'});
 const send=async payload=>{const jws=await signRelationEvent(payload,signer),request=new Request(ORIGIN+'/relations/events',{method:'POST',headers:{'Content-Type':'application/secevent+jwt'},body:jws});return publicRelations.public({request,env:off,local:true,path:'/relations/events'});};
 const payload=events=>relationEventPayload({from:A.principal,to:B.principal,instance,aep:0,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID(),events});
 const suspended=await send(payload({[RELATION_EVENT.edgeState]:{half:'grant',generation:100,state:'suspended'}}));assert.equal(suspended.status,202);
 assert.equal((await b.call('GET',path(B)+'/imports',{routeEnv:off})).body.imports[0].status,'unavailable');
 const injected=await send({...payload({[RELATION_EVENT.edgeEnded]:{half:'grant'}}),from:B.principal});assert.equal(injected.status,400,'even signed extra sender members fail the exact event profile');
 const unknownPayload=payload({[RELATION_EVENT.edgeEnded]:{half:'grant'}});unknownPayload.aud=ORIGIN+'/identity/'+crypto.randomUUID();const missing=await send(unknownPayload);assert.deepEqual([missing.status,await missing.json()],[404,{error:'not_found'}]);
 const ended=await send(payload({[RELATION_EVENT.edgeEnded]:{half:'grant'}}));assert.equal(ended.status,202);
 const cp=[...(await B.controller.metadata.list({prefix:'rel/cp/'})).values()][0];
 assert.equal(cp.peerGrant.state,'ended');
});

test('owner export: administrator data remains exportable with both flags off, members and unknown organizations are uniform',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),m=await f.person(),A=await f.organization(a,'ExportA',[m]),path=`/api/orgs/${A.id}/relations/export`,off={...f.env,ORGANIZATIONS_ENABLED:'false',ORG_RELATIONS_ENABLED:'false',ORG_FOREIGN_RELATIONS_ENABLED:'false'};
 const result=await a.call('GET',path,{routeEnv:off,stale:true});assert.equal(result.status,200,JSON.stringify(result));assert.equal(typeof result.body,'object');
 unknown(await m.call('GET',path,{routeEnv:off}));unknown(await a.call('GET',`/api/orgs/${crypto.randomUUID()}/relations/export`,{routeEnv:off}));
});

import {allowedMethods as ownerRelationMethods} from '../packages/runtime/routes/orgs.mjs';
import {allowedMethods as publicRelationMethods} from '../packages/runtime/routes/relations.mjs';
test('route method matrix: owner reads/export are GET, operations POST, public handoffs POST',()=>{
 const root='/api/orgs/00000000-0000-4000-8000-000000000001/relations';
 assert.deepEqual(ownerRelationMethods(root),['GET','POST']);
 for(const suffix of ['imports','catalogue','resources','export'])assert.deepEqual(ownerRelationMethods(root+'/'+suffix),['GET']);
 assert.deepEqual(ownerRelationMethods(root+'/counterparty'),['POST']);
 for(const path of ['/relations/accept','/relations/join','/relations/events'])assert.deepEqual(publicRelationMethods(path),['POST']);
 assert.equal(ownerRelationMethods(root+'/upgrade'),null,'version upgrades use the authenticated operation dispatch');
});
