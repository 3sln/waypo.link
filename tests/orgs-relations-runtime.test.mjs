// ORG-10f over the durable Node runtime: real account single writers (one per organization), the identity repository
// and key registry, the owner routes (routes/orgs.mjs) driven with the actor the HTTP router builds, and full HTTP
// through the Node application for the public relation surfaces (routes/relations.mjs: /bindle/rpc, /oauth/token,
// /relations/accept, /relations/join, /relations/events). Same host only: two organizations relate through the
// same-host transport (RL-15). Local behaviour only: no foreign provider, no production key custody.
//
// The application hop (an approved federation grant on a live connection) is supplied to relations.certify as the
// federation shard supplies it (its grant record), over a real app connection in the grantee's writer; the OAuth consent
// and the preferences/v2 relay projection that normally carry it are covered at the engine level
// (tests/orgs-relations-access.test.mjs) and the stored session key by tests/orgs-relations-routes.test.mjs.
import {rpcInit,rpcAware} from './helpers/rpc.mjs';
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
import {fakeHasher,fakeWebAuthn,passkeyResponse} from './helpers/identity-engine.mjs';
import {dpopKey} from './authorization-entry-helpers.mjs';

const ORIGIN='https://relations-runtime.example',DAY=86400000;
export const RELATION_FLAGS={ORGANIZATIONS_ENABLED:'true',DIRECTORY_ENABLED:'true',ORG_RELATIONS_ENABLED:'true'};
const PLANS={check:async()=>({paid:true,plan:'organization-internal',source:'test'})};
export async function relationsRuntime(t,{flags=RELATION_FLAGS,config={},clock}={}){
 const directory=await mkdtemp(join(tmpdir(),'orgs-relations-')),now=clock?clock.now:Date.now;
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',ORGANIZATION_PLANS:PLANS,...clock?{LIFECYCLE_CLOCK:clock.now}:{},...config}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:fakeWebAuthn(),passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:new URL(ORIGIN).hostname,termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'},env={...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATION_PLANS:PLANS};
 const person=async()=>{
  const pending=await identity.signup({method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);await identity.registerPasskey({pendingToken:pending.pendingToken,response:passkeyResponse(pending,'passkey-'+pending.account.id)},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id);
  /** One owner-route call as the router would make it. `stale`: an authentication older than the step-up window. */
  const call=async(method,path,{input,routeEnv=env,stale=false}={})=>{
   const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
   const record=await repository.get(id),authTime=now()-(stale?3600000:0);
   const response=await stages.owner({request,env:routeEnv,url:new URL(request.url),path,id,object,context:{remoteIP:'127.0.0.1'},owner:{devices:[]},actor:personActor({owner:id,iss:ORIGIN,authTime,verification:{stepUpAt:authTime,enrolledAt:record.credentials[0]?.createdAt,securityChangedAt:record.security?.changedAt??0}})})
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
 const http=async(path,init={})=>rpcAware(await app.fetch(new Request(ORIGIN+path,{...init,headers:{'CF-Connecting-IP':'192.0.2.20',...init.headers??{}}})));
 /** One alarm-equivalent relations step for each organization (tick: drain, resync, sweep; key refresh). */
 const flush=async(...orgs)=>{for(let i=0;i<3;i++)for(const o of orgs)await accountHandle(env,o.id).relationsFlush(o.id);};
 return {app,env,accounts,repository,person,organization,http,flush};
}
const b64=bytes=>Buffer.from(bytes).toString('base64');
/** The uniform refusal: 404 with `not_found` (the owner-route funnel may add its fixed message). */
const unknown=(r,label)=>assert.deepEqual([r.status,r.body.error],[404,'not_found'],label);

test('runtime: two organizations invite, accept, share; a member’s app uses the import through BindleEntity and the token form; narrow, suspend and end take effect at once',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),b=await f.person(),m=await f.person();
 const acme=await f.organization(a,'Acme'),ledgerly=await f.organization(b,'Ledgerly',[m]);
 const rel=p=>`/api/orgs/${p.id}/relations`;
 // Empty tab; members never see it.
 const empty=await a.call('GET',rel(acme));assert.equal(empty.status,200,JSON.stringify(empty.body));assert.equal(empty.body.enabled,true);assert.deepEqual([empty.body.instances,empty.body.invitations,empty.body.imports],[[],[],[]]);
 unknown(await m.call('GET',rel(ledgerly)));
 // Lookups: the catalogue (listed by 3sln.me, publisher unverified), the pool, the counterparty.
 const catalogue=(await a.call('GET',rel(acme)+'/catalogue')).body.relations;const share=catalogue.find(r=>r.key==='share');
 assert.deepEqual(catalogue.map(r=>r.key),['share','group','supply','accounting-engagement']);assert.equal(share.publisherVerified,false);assert.equal(share.listedBy,'3sln.me');assert.match(share.pin.artefact,/\.example\//);
 const second=await acme.controller.addResource(acme.id,{name:'Ledgers 2026',provider:'hosted'});
 const pool=(await a.call('GET',rel(acme)+'/resources')).body.resources;assert.equal(pool.length,2,JSON.stringify(pool));assert.ok(pool.every(r=>r.id.startsWith(`${ORIGIN}/entities/${acme.id}/resources/`)&&Array.isArray(r.contracts[OBJECT_STORAGE])));
 const [R1,R2]=[pool.find(r=>r.label!=='Ledgers 2026').id,pool.find(r=>r.label==='Ledgers 2026').id];
 const cp=(await a.call('POST',rel(acme)+'/counterparty',{input:{handle:'@'+ledgerly.handle}})).body.counterparty;assert.deepEqual([cp.sub,cp.kind,cp.name,cp.identity],[ledgerly.id,'organization','Ledgerly',`${ORIGIN}/identity/${ledgerly.id}`]);
 assert.equal((await a.call('POST',rel(acme)+'/counterparty',{input:{handle:b.handle}})).status,404,'a person is never a counterparty (RL-17)');
 assert.equal((await a.call('POST',rel(acme)+'/counterparty',{input:{handle:acme.handle}})).status,404,'nor the organization itself');
 const preview=(await a.call('POST',rel(acme),{input:{operation:'preview',relation:share.pin,slot:'owner',counterparty:ledgerly.principal}})).body;
 assert.deepEqual(preview.warnings.sort(),['new-counterparty','new-relation']);assert.equal(preview.matrix.gives[0].to,'recipient');
 // Widening needs a fresh step-up (RL-2); the refusal is the code every widening org action uses.
 const staleCreate=await a.call('POST',rel(acme),{input:{operation:'create',relation:share.pin,slots:['owner']},stale:true});assert.deepEqual([staleCreate.status,staleCreate.body.error],[401,'reauthentication_required']);
 const created=await a.call('POST',rel(acme),{input:{operation:'create',relation:share.pin,slots:['owner']}});assert.equal(created.status,200,JSON.stringify(created.body));const instance=created.body.instance;
 const values={'0':[{resource:R1,methods:{[OBJECT_STORAGE]:['capabilities','get','put']},scope:{maxObjectBytes:64}},{resource:R2,methods:{[OBJECT_STORAGE]:['capabilities','get']}}]};
 // Production gate 1: a body-supplied `from` is refused; the sender is never taken from a request.
 const smuggled=await a.call('POST',rel(acme),{input:{operation:'invite',instance,slot:'recipient',invitee:ledgerly.principal,values,from:{iss:ORIGIN,sub:ledgerly.id}}});assert.deepEqual([smuggled.status,smuggled.body.error],[400,'invalid_request']);
 const invited=await a.call('POST',rel(acme),{input:{operation:'invite',instance,slot:'recipient',invitee:ledgerly.principal,values}});assert.equal(invited.status,200,JSON.stringify(invited.body));
 // The offer reached Ledgerly through the same-host transport: an inbound item with its link, named for the admins.
 let tab=(await b.call('GET',rel(ledgerly))).body;assert.equal(tab.inbound.items.length,1,JSON.stringify(tab.inbound));const item=tab.inbound.items[0];
 assert.deepEqual([item.from.sub,item.fromName,item.fromHandle,item.meta],[acme.id,'Acme',acme.handle,invited.body.invitation]);
 assert.equal((await a.call('GET',rel(acme))).body.invitations[0].inviteeName,'Ledgerly');
 // The accept landing carries the link to the invitee's console in the fragment only.
 const landing=await f.http('/relations/accept',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({bindle_meta:item.meta}).toString(),redirect:'manual'});
 assert.equal(landing.status,303);assert.equal(landing.headers.get('Location'),`/console?view=organizations&org=${ledgerly.id}&tab=relationships#relation-invitation=${item.meta}`);
 const garbageLanding=await f.http('/relations/accept',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'bindle_meta=nope',redirect:'manual'});assert.equal(garbageLanding.headers.get('Location'),'/console?view=organizations');
 // Acceptance: the full disclosure, then accept echoing its digest (with receiving).
 const disclosure=(await b.call('POST',rel(ledgerly),{input:{operation:'inbound-preview',invitation:item.meta}})).body;
 assert.deepEqual([disclosure.inviter.identity,disclosure.relation.publisherVerified,disclosure.receives.length,disclosure.gives.length],[`${ORIGIN}/identity/${acme.id}`,false,1,0]);assert.ok(disclosure.warnings.includes('new-counterparty'));
 assert.equal((await b.call('POST',rel(ledgerly),{input:{operation:'inbound-preview',invitation:item.meta.slice(0,-3)+'AAA'}})).body.error,'invitation_invalid');
 const accepted=await b.call('POST',rel(ledgerly),{input:{operation:'accept',invitation:item.meta,disclosure:disclosure.disclosure,receive:true}});assert.equal(accepted.status,200,JSON.stringify(accepted.body));assert.equal(accepted.body.state,'live');
 await f.flush(acme,ledgerly);
 // The grantee's imports: one entry, two resources, available; the member holds no grant yet, so sees nothing (RL-13).
 const imports=(await b.call('GET',rel(ledgerly)+'/imports')).body.imports;assert.equal(imports.length,1,JSON.stringify(imports));assert.equal(imports[0].status,'available');assert.equal(imports[0].grantorName,'Acme');
 const imp1=imports[0].resources.find(r=>r.resource===R1).id;assert.match(imp1,/^imp_/);
 assert.deepEqual((await m.call('GET',rel(ledgerly)+'/imports')).body,{imports:[]});
 tab=(await a.call('GET',rel(acme))).body;const edge=tab.instances[0].counterparts[0];assert.deepEqual([edge.name,edge.outgoing.state,edge.outgoing.live,edge.incoming.state],['Ledgerly','live',true,null]);
 // The admin grants the member the import; now the member sees exactly it.
 const membership=(await b.call('GET',`/api/orgs/${ledgerly.id}/members`)).body.members.find(x=>x.principal.sub===m.id);
 const granted=await b.call('POST',`/api/orgs/${ledgerly.id}/member-grants`,{input:{membership:membership.id,grants:[{resource:imp1,methods:{[OBJECT_STORAGE]:['capabilities','get']}}]}});assert.equal(granted.status,200,JSON.stringify(granted.body));
 const mine=(await m.call('GET',rel(ledgerly)+'/imports')).body.imports;assert.deepEqual(mine.map(x=>[x.id,x.status,x.grantorName]),[[imp1,'available','Acme']]);
 // The grantee's federation shard sees the import mirrors in its resource sync (provider 'relation').
 const descriptors=await accountHandle(f.env,ledgerly.id).relationImportDescriptors(ledgerly.id);assert.ok(descriptors.some(d=>d.id===importResourceId(ORIGIN,ledgerly.id,imp1)&&d.provider==='relation'&&d.available===true));
 // A member's application: an app connection at Ledgerly, an approved grant for the import, and the member context.
 const app=await ledgerly.controller.appBindleConnect(ledgerly.id,{id:'https://erp.example/client.json',name:'ERP',origin:'https://erp.example'},0);
 const fed=importResourceId(ORIGIN,ledgerly.id,imp1),key=await dpopKey();
 const grantRecord={id:'grant-erp-1',clientId:'https://erp.example/client.json',active:true,resources:{files:[fed]},methods:{files:{[OBJECT_STORAGE]:['capabilities','get','put']}},connection:{id:app.id,generation:app.generation}};
 const memberCtx={principal:{iss:ORIGIN,sub:m.id},membership_id:membership.id,generation:membership.generation};
 const certify=extra=>accountHandle(f.env,ledgerly.id).relationsCertify(ledgerly.id,{clientId:grantRecord.clientId,clientOrigin:'https://erp.example',grants:[grantRecord.id],grantRecords:[grantRecord],field:'files',resource:fed,jkt:key.jkt,delegate:key.jwk,member:memberCtx,connection:{id:app.id,generation:app.generation},...extra});
 await assert.rejects(certify({jkt:(await dpopKey()).jkt}),e=>e.code==='relation_certificate_unavailable','the delegate must be the token key');
 const issued=await certify();assert.deepEqual(issued.methods,{[OBJECT_STORAGE]:['capabilities','get']},'member ∩ application ∩ edge');assert.equal(issued.broker.endpoint,`${ORIGIN}/bindle/rpc`);assert.equal(issued.resource,R1);
 // The grantor's data: one object in R1.
 const r1=await acme.controller.metadata.get('resource/'+R1.split('/').pop());await acme.controller.hostedOperation(r1,'put',{key:'ledgers/2026.csv',data:new TextEncoder().encode('id,amount\n1,10\n'),condition:{absent:true}});
 const rpc=async(authorization,envelope,{htuKey=key,ath}={})=>{const body={version:'0',tx:crypto.randomUUID(),resource:R1,contract:OBJECT_STORAGE,method:'get',args:{key:'ledgers/2026.csv'},...envelope};
  const r=await f.http('/bindle/rpc',rpcInit(body,{Authorization:authorization,DPoP:await htuKey.sign({htu:ORIGIN+'/bindle/rpc',ath:ath??authorization.split(' ')[1]})}));return {status:r.status,body:await r.json(),headers:r.headers};};
 const read=await rpc('BindleEntity '+issued.certificate);assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(Buffer.from(read.body.result.data).toString(),'id,amount\n1,10\n');
 // The real storage dispatcher enforces the composed assignedScope, including on a ranged read.
 await acme.controller.hostedOperation(r1,'put',{key:'ledgers/large.csv',data:new Uint8Array(65),condition:{absent:true}});
 const oversized=await rpc('BindleEntity '+issued.certificate,{args:{key:'ledgers/large.csv'}});
 assert.deepEqual([oversized.status,oversized.body.error],[403,'forbidden'],'maxObjectBytes survives relations.authorize → storage');
 const range=await rpc('BindleEntity '+issued.certificate,{args:{key:'ledgers/large.csv',range:{start:0,end:1}}});
 assert.deepEqual([range.status,range.body.error],[403,'forbidden'],'a range does not bypass the full-object byte limit');
 // Outside the certificate's methods, another resource, another key: the one uniform 401.
 for(const [label,result] of [['put',await rpc('BindleEntity '+issued.certificate,{method:'put',args:{key:'x',data:new Uint8Array([0]),condition:{absent:true}}})],['other resource',await rpc('BindleEntity '+issued.certificate,{resource:R2})],['other key',await rpc('BindleEntity '+issued.certificate,{},{htuKey:await dpopKey()})]])
  assert.deepEqual([result.status,result.body.error],[401,'invalid_token'],label);
 // The certificate presented to the grantee itself (not the edge's grantor) is refused the same way.
 // Token form: one exchange, then DPoP-bound calls with the relation access token.
 const tokenResponse=await f.http('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',DPoP:await key.sign({htu:ORIGIN+'/oauth/token'})},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:issued.certificate,client_id:grantRecord.clientId}).toString()});
 const tokenBody=await tokenResponse.json();assert.equal(tokenResponse.status,200,JSON.stringify(tokenBody));assert.equal(tokenBody.token_type,'DPoP');assert.match(tokenBody.access_token,new RegExp(`^rel1\\.${acme.id}\\.`));assert.equal(tokenBody.refresh_token,undefined);
 const bad=await f.http('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',DPoP:await key.sign({htu:ORIGIN+'/oauth/token'})},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:issued.certificate,client_id:'https://other.example/client.json'}).toString()});assert.deepEqual([bad.status,(await bad.json()).error],[400,'invalid_grant']);
 const bound=await rpc('DPoP '+tokenBody.access_token);assert.equal(bound.status,200,JSON.stringify(bound.body));assert.equal(bound.headers.get('Content-Type'),'application/vnd.bindle.rpc+cbor');
 // CBOR transport on the relation routes (protocol §5): both schemes refuse JSON with 415 and a non-canonical body with 400.
 for(const authorization of ['BindleEntity '+issued.certificate,'DPoP '+tokenBody.access_token]){
  const raw=async(body,type)=>f.http('/bindle/rpc',{method:'POST',headers:{'Content-Type':type,Authorization:authorization,DPoP:await key.sign({htu:ORIGIN+'/bindle/rpc',ath:authorization.split(' ')[1]})},body});
  const json=await raw(JSON.stringify({version:'0',tx:crypto.randomUUID(),resource:R1,contract:OBJECT_STORAGE,method:'get',args:{key:'ledgers/2026.csv'}}),'application/json');assert.equal(json.status,415,authorization.split(' ')[0]);assert.equal((await json.json()).error,'unsupported_media_type');
  const indefinite=await raw(Uint8Array.from([0xbf,0xff]),'application/vnd.bindle.rpc+cbor');assert.equal(indefinite.status,400,authorization.split(' ')[0]);assert.equal((await indefinite.json()).error,'invalid_request');
 }
 // Narrowing at the grantor: dropping R1 refuses the next call at once, before any event is delivered (C6).
 const narrowed=await a.call('POST',rel(acme),{input:{operation:'narrow',instance,counterpart:ledgerly.principal,entries:{'0':[R2]}}});assert.equal(narrowed.status,200,JSON.stringify(narrowed.body));
 assert.equal((await rpc('BindleEntity '+(await certify().catch(()=>({certificate:issued.certificate}))).certificate)).status,401,'R1 is no longer granted');
 assert.equal((await rpc('DPoP '+tokenBody.access_token)).status,401,'nor through the bound token');
 // Narrowing operations are never gated by the relations flag; widening is (the uniform 404).
 const off={...f.env,ORG_RELATIONS_ENABLED:'false'};
 assert.equal((await a.call('POST',rel(acme),{input:{operation:'suspend',instance,counterpart:ledgerly.principal},routeEnv:off})).status,200,'suspend is never gated');
 unknown(await a.call('POST',rel(acme),{input:{operation:'resume',instance,counterpart:ledgerly.principal},routeEnv:off}));
 unknown(await a.call('GET',rel(acme)+'/catalogue',{routeEnv:off}));
 assert.equal((await a.call('GET',rel(acme),{routeEnv:off})).status,200,'existing relations stay readable');
 assert.equal((await a.call('POST',rel(acme),{input:{operation:'resume',instance,counterpart:ledgerly.principal},stale:true})).body.error,'reauthentication_required');
 assert.equal((await a.call('POST',rel(acme),{input:{operation:'resume',instance,counterpart:ledgerly.principal}})).status,200);
 // End (final): the grantee's import goes unavailable once the event arrives, and nothing revives it.
 const ended=await a.call('POST',rel(acme),{input:{operation:'end',instance,counterpart:ledgerly.principal}});assert.equal(ended.status,200);assert.equal(ended.body.outgoing.state,'ended');
 await f.flush(acme,ledgerly);
 assert.equal((await b.call('GET',rel(ledgerly)+'/imports')).body.imports[0].status,'unavailable');
 assert.deepEqual((await m.call('GET',rel(ledgerly)+'/imports')).body.imports,[],'narrowing removes the member’s only held import');
 assert.deepEqual((await a.call('POST',rel(acme),{input:{operation:'resume',instance,counterpart:ledgerly.principal}})).status,404,'an ended half never resumes');
 assert.equal((await rpc('BindleEntity '+issued.certificate,{resource:R2,args:{key:'ledgers/2026.csv'}})).status,401);
});

test('runtime: public surfaces are uniform; the join endpoint requires the foreign kill switch and event audiences stay uniform and never read a body `from`',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),b=await f.person();
 const acme=await f.organization(a,'Acme'),ledgerly=await f.organization(b,'Ledgerly');
 // Unknown organization and non-admin answers are the same 404.
 unknown(await a.call('GET',`/api/orgs/${crypto.randomUUID()}/relations`));
 unknown(await b.call('GET',`/api/orgs/${acme.id}/relations`));
 // A BindleEntity header for no local organization, or garbage: the credential refusal, never a target signal.
 for(const authorization of ['BindleEntity garbage','BindleEntity e30.e30.sig','DPoP rel1.'+crypto.randomUUID()+'.'+'a'.repeat(43)]){
  const r=await f.http('/bindle/rpc',rpcInit({},{Authorization:authorization,DPoP:'x'}));
  assert.equal(r.status,401,authorization);assert.equal((await r.json()).error,'invalid_token');}
 // Foreign surfaces: with ORG_FOREIGN_RELATIONS_ENABLED off they do not exist (uniform 404).
 const share=(await a.call('GET',`/api/orgs/${acme.id}/relations/catalogue`)).body.relations[0];
 const instance=(await a.call('POST',`/api/orgs/${acme.id}/relations`,{input:{operation:'create',relation:share.pin,slots:['owner']}})).body.instance;
 const pool=(await a.call('GET',`/api/orgs/${acme.id}/relations/resources`)).body.resources;
 const meta=(await a.call('POST',`/api/orgs/${acme.id}/relations`,{input:{operation:'invite',instance,slot:'recipient',invitee:ledgerly.principal,values:{'0':[{resource:pool[0].id}]}}})).body.invitation;
 const join=(body,env)=>f.http('/relations/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const r1=await join({invitation:meta,statement:'x.y.z'});assert.deepEqual([r1.status,await r1.json()],[404,{error:'not_found'}]);
 const events=await f.http('/relations/events',{method:'POST',headers:{'Content-Type':'application/secevent+jwt'},body:'e30.e30.sig'});assert.equal(events.status,404);
 // The manifest never claims relations.v1 on flags alone.
 const manifest=await (await f.http('/.well-known/bindle/manifest.json')).json();assert.equal(manifest.features?.['relations.v1'],undefined);
 // With the kill switch on, the join endpoint answers, and a body naming a sender is the uniform refusal (gate 1).
 const g=await relationsRuntime(t,{flags:{...RELATION_FLAGS,ORG_FOREIGN_RELATIONS_ENABLED:'true'}}),c=await g.person(),d=await g.person();
 const co=await g.organization(c,'Corvid'),dov=await g.organization(d,'Dove');
 const s2=(await c.call('GET',`/api/orgs/${co.id}/relations/catalogue`)).body.relations[0],i2=(await c.call('POST',`/api/orgs/${co.id}/relations`,{input:{operation:'create',relation:s2.pin,slots:['owner']}})).body.instance;
 const p2=(await c.call('GET',`/api/orgs/${co.id}/relations/resources`)).body.resources;
 const m2=(await c.call('POST',`/api/orgs/${co.id}/relations`,{input:{operation:'invite',instance:i2,slot:'recipient',invitee:dov.principal,values:{'0':[{resource:p2[0].id}]}}})).body.invitation;
 const withFrom=await g.http('/relations/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitation:m2,statement:'x.y.z',from:{iss:ORIGIN,sub:dov.id}})});
 assert.deepEqual([withFrom.status,(await withFrom.json()).error],[400,'invitation_invalid']);
 const forged=await g.http('/relations/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitation:m2,statement:'x.y.z'})});
 assert.deepEqual([forged.status,(await forged.json()).error],[400,'invitation_invalid'],'a statement that does not verify fails the same way');
 const ev=await g.http('/relations/events',{method:'POST',headers:{'Content-Type':'application/secevent+jwt'},body:'e30.e30.sig'});assert.equal(ev.status,404,'an event naming no local organization is unknown');
 // The same-host invitation still works with the kill switch on (the redemption carries the router binding).
 assert.equal((await g.accounts.get(dov.id).relationsPeer(dov.id,{operation:'relations.redeem',input:{invitation:m2,statement:'x.y.z',from:{iss:ORIGIN,sub:co.id}}}).catch(e=>e)).code,'invitation_invalid','a redemption at the wrong writer is refused');
});

test('runtime: the account alarm schedules relations.tick and refreshes counterpart keys; deletion hands off only once relations.purge-ready',async t=>{
 const purged=[],f=await relationsRuntime(t,{config:{ORGANIZATION_PURGE:async org=>{purged.push(org);return {handedOff:true};}}}),a=await f.person(),b=await f.person();
 const acme=await f.organization(a,'Acme'),ledgerly=await f.organization(b,'Ledgerly');
 const share=(await a.call('GET',`/api/orgs/${acme.id}/relations/catalogue`)).body.relations[0];
 const instance=(await a.call('POST',`/api/orgs/${acme.id}/relations`,{input:{operation:'create',relation:share.pin,slots:['owner']}})).body.instance;
 const pool=(await a.call('GET',`/api/orgs/${acme.id}/relations/resources`)).body.resources;
 const meta=(await a.call('POST',`/api/orgs/${acme.id}/relations`,{input:{operation:'invite',instance,slot:'recipient',invitee:ledgerly.principal,values:{'0':[{resource:pool[0].id}]}}})).body.invitation;
 const d=(await b.call('POST',`/api/orgs/${ledgerly.id}/relations`,{input:{operation:'inbound-preview',invitation:meta}})).body;
 assert.equal((await b.call('POST',`/api/orgs/${ledgerly.id}/relations`,{input:{operation:'accept',invitation:meta,disclosure:d.disclosure,receive:true}})).status,200);
 // Queued edge states arm the account alarm; the alarm runs relations.tick (resync, sweep, drain) for each organization.
 const alarmA=await acme.controller.metadata.getAlarm();assert.ok(Number.isSafeInteger(alarmA)&&alarmA<=Date.now()+86400000,'the alarm is armed');
 await acme.controller.alarm();await ledgerly.controller.alarm();await acme.controller.alarm();
 const tick=await acme.controller.metadata.get('rel/tick');assert.ok(tick?.resyncAt>0,'the daily anti-entropy pass ran from the alarm');
 assert.equal((await acme.controller.metadata.list({prefix:'rel/outbox/'})).size,0,'the outbox drained from the alarm');
 assert.equal((await b.call('GET',`/api/orgs/${ledgerly.id}/relations/imports`)).body.imports[0].status,'available');
 // The counterpart key refresh filled Ledgerly's certification-key cache for Acme (events verify only against it).
 const cached=[...(await ledgerly.controller.metadata.list({prefix:'rel/keycache/'})).values()];assert.ok(cached.some(row=>row.identity===`${ORIGIN}/identity/${acme.id}`&&row.keys.some(k=>k.state==='active')),JSON.stringify(cached));
 // The purge integration cannot run while final events remain undelivered, and public certification keys stay
 // published throughout that wait. Simulate the due deletion with a temporarily unavailable same-host transport.
 const transport=acme.controller.config.CONVERSATION_ACCOUNT;
 acme.controller.config.CONVERSATION_ACCOUNT=()=>({invoke:async()=>{throw Error('peer unavailable');}});
 await acme.controller.metadata.transaction(async tx=>{const r=await tx.get('org/record-v1');r.state='deletion-due';await tx.put('org/record-v1',r);});
 await acme.controller.orgsAlarm();
 assert.deepEqual(purged,[],'the configured purge adapter is held until relations.purge-ready');
 const published=await f.http(`/identity/${acme.id}/identity.json`);
 assert.equal(published.status,200,'identity remains published during pre-purge');
 assert.ok((await published.json()).keys.some(k=>k.use==='cert'&&k.state==='active'),'public certification key remains published');
 acme.controller.config.CONVERSATION_ACCOUNT=transport;
 await acme.controller.metadata.transaction(async tx=>{for(const [key,row] of await tx.list({prefix:'rel/outbox/'}))await tx.put(key,{...row,notBefore:0});});
 // Deletion takes effect: the hand-off waits for the pre-purge leave step and its delivered final events.
 const gate=await acme.controller.relationsPurgeGate(acme.id);assert.equal(gate,true,'leaving every instance delivered its final events inline');
 await acme.controller.orgsAlarm();assert.deepEqual(purged,[acme.id],'only now is the configured purge called');
 assert.equal((await acme.controller.metadata.get('rel/instance/'+encodeURIComponent(instance))).state,'left');
 await ledgerly.controller.alarm();
 assert.equal((await b.call('GET',`/api/orgs/${ledgerly.id}/relations/imports`)).body.imports[0].status,'unavailable','the counterpart learned the end before the purge');
 const tab=(await a.call('GET',`/api/orgs/${acme.id}/relations`)).body;assert.equal(tab.closing,true);
 assert.equal((await a.call('POST',`/api/orgs/${acme.id}/relations`,{input:{operation:'create',relation:share.pin,slots:['owner']}})).body.error,'organization_deletion_pending','no widening once the pre-purge began');
});

test('runtime: cold and rotated certification keys replay only from the bounded background inbox; failed claims cannot starve refresh',async t=>{
 const f=await relationsRuntime(t),a=await f.person(),b=await f.person(),A=await f.organization(a,'InboxA'),B=await f.organization(b,'InboxB');
 const path=`/api/orgs/${A.id}/relations`,pin=(await a.call('GET',path+'/catalogue')).body.relations[0].pin;
 const instance=(await a.call('POST',path,{input:{operation:'create',relation:pin,slots:['owner']}})).body.instance;
 assert.ok(await A.controller.metadata.getAlarm(),'creating even an empty instance schedules the relation alarm');
 const resource=(await a.call('GET',path+'/resources')).body.resources[0].id;
 const invitation=(await a.call('POST',path,{input:{operation:'invite',instance,slot:'recipient',invitee:B.principal,values:{0:[{resource}]}}})).body.invitation;
 const disclosure=(await b.call('POST',`/api/orgs/${B.id}/relations`,{input:{operation:'inbound-preview',invitation}})).body.disclosure;
 await b.call('POST',`/api/orgs/${B.id}/relations`,{input:{operation:'accept',invitation,disclosure,receive:true}});
 await f.flush(A,B);
 assert.equal((await B.controller.metadata.list({prefix:'rel/inbox/'})).size,0);
 const {mintCertificationKey}=await import('../packages/identity/transfer-in.mjs'),{encryptSecret,decryptSecret}=await import('../packages/runtime/secrets.mjs');
 const {certificationSigner}=await import('../packages/identity/member-certificates.mjs'),{signRelationEvent,relationEventPayload}=await import('../packages/orgs/relation-events.mjs');
 const {RELATION_EVENT}=await import('../packages/orgs/relation-edges.mjs');
 const secret=A.controller.config.KEY_ENCRYPTION_KEY;
 await mintCertificationKey(A.controller.metadata,A.id,{seal:v=>encryptSecret(v,secret)});
 const signer=await certificationSigner({metadata:A.controller.metadata,seal:v=>encryptSecret(v,secret),open:v=>decryptSecret(v,secret)})(A.id);
 const event=await signRelationEvent(relationEventPayload({from:A.principal,to:B.principal,instance,aep:0,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID().replaceAll('-',''),events:{[RELATION_EVENT.edgeState]:{half:'grant',generation:100,state:'suspended'}}}),signer);
 await B.controller.relationsPeer(B.id,{operation:'relations.ingest',input:{event}});
 assert.equal((await B.controller.metadata.list({prefix:'rel/inbox/'})).size,1,'a new kid buffers even while the previous key cache is fresh');
 await B.controller.relationsAlarm();
 assert.equal((await B.controller.metadata.list({prefix:'rel/inbox/'})).size,0);
 const imports=(await b.call('GET',`/api/orgs/${B.id}/relations/imports`)).body.imports;
 assert.equal(imports[0].status,'unavailable','the alarm verified and applied the rotated-key suspension');
 const {enqueueMemberKeyRefresh,dueMemberKeyRefreshes}=await import('../packages/orgs/key-refresh.mjs');
 await B.controller.metadata.transaction(async tx=>{for(let i=0;i<65;i++)await enqueueMemberKeyRefresh(tx,{iss:ORIGIN,sub:crypto.randomUUID()},{now:Date.now()-1000,source:'claimed'});});
 await B.controller.relationsAlarm();
 const due=await B.controller.metadata.transaction(tx=>dueMemberKeyRefreshes(tx,Date.now(),100));
 assert.ok(due.length<65,'failed claims are deferred so the next page can run');
 assert.ok(await B.controller.metadata.getAlarm(),'failed refreshes retain a retry alarm');
 const identity=A.controller.config.IDENTITY_ACCOUNT;
 A.controller.config.IDENTITY_ACCOUNT=async sub=>{const evidence=await identity(sub);return sub===A.id?{...evidence,aep:1}:evidence;};
 await B.controller.metadata.transaction(tx=>enqueueMemberKeyRefresh(tx,A.principal,{now:Date.now(),source:'member'}));
 await B.controller.relationsAlarm();
 const held=(await b.call('GET',`/api/orgs/${B.id}/relations`)).body.holds.holds;
 assert.ok(held.some(h=>h.counterpart.sub===A.id&&h.aep===1),'background refresh observes the identity authority epoch and establishes RL-4 hold');
 await A.controller.relationsFlush(A.id);
 assert.equal((await A.controller.metadata.get('org/record-v1')).aep,1,'outgoing certificates/events use the identity-backed epoch');

});
