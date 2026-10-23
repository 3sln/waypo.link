// ORG-5 over the durable Node runtime: real account single writers, identity repository, federation shards and the
// owner-route stage driven with the actor and session context the HTTP router builds (packages/runtime/http.mjs).
// Covers member discovery, the member's own view and requests, and the organization-context connections and
// preferences adapters, including the uniform refusal for non-members and members of other organizations (ORG-D9).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {IdentityService} from '../packages/identity/service.mjs';
import {identityBackupPort} from '../packages/runtime/identity-backup.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {stages,allowedMethods} from '../packages/runtime/routes/orgs.mjs';
import {personActor} from '../packages/orgs/authority.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';

const ORIGIN='http://localhost:8788',PASSWORD='Organization context runtime password!',FRAGMENT='https://schema.example/org-settings/v1';
const SCHEMA={id:FRAGMENT,title:'Organization settings',description:'Settings the organization shares with its apps.',publisher:'https://schema.example',fields:{displayName:{title:'Display name',type:'string',maxLength:100}}};
async function fixture(t,{enabled=true}={}){
 const directory=await mkdtemp(join(tmpdir(),'orgs-context-'));
 const flags={ORGANIZATIONS_ENABLED:enabled?'true':'false',INTEGRATIONS_ENABLED:'true',FEDERATION_ENABLED:'true'};
 const app=await createNodeServer({directory,config:{...flags,ORGANIZATION_PLANS:{check:async()=>({paid:true,plan:'organization-internal',source:'test'})},FEDERATION_SCHEMAS:JSON.stringify({[FRAGMENT]:SCHEMA}),FEDERATION_CLIENTS:JSON.stringify([{id:'https://app.example/client',name:'Example app',origin:'https://app.example',redirectUris:['https://app.example/callback']}])}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const env={APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,FEDERATION_AUTHORITY:app.resources.federation,...flags};
 const person=async()=>{
  const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  const session=await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id),context={origin:ORIGIN,sessionToken:session.sessionToken,csrfToken:session.csrfToken,expectedOwner:id,remoteIP:'127.0.0.1'};
  const call=async(method,path,{input,authTime=Date.now(),epoch=0}={})=>{
   const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
   const response=await stages.owner({request,env,path,id,object,context,actor:personActor({owner:id,iss:ORIGIN,authTime,epoch})}).catch(error=>error.status?new Response(JSON.stringify({error:error.code,message:error.message}),{status:error.status}):new Response(JSON.stringify({error:'internal_error'}),{status:500}));// as packages/runtime/http.mjs
   return {status:response.status,body:await response.json()};
  };
  return {id,object,context,call};
 };
 return {app,env,accounts,repository,person};
}
const GHOST='12345678-1234-4123-8123-123456789abc';

test('ORG-5 runtime: discovery, the member\'s own view and requests through the routes; outsiders learn nothing',async t=>{
 const f=await fixture(t),a=await f.person(),b=await f.person(),c=await f.person(),e=await f.person();
 const created=await a.call('POST','/api/orgs',{input:{request:'context-runtime-000001',name:'Acme Ltd',label:'company'}});assert.equal(created.status,200,JSON.stringify(created.body));
 const org=created.body.organization.id;
 const other=(await e.call('POST','/api/orgs',{input:{request:'context-runtime-000002',name:'Other Co'}})).body.organization.id;
 assert.deepEqual(allowedMethods(`/api/orgs/${org}/membership`),['GET']);assert.deepEqual(allowedMethods(`/api/orgs/${org}/requests`),['GET']);
 // Before joining, B discovers nothing; A discovers its own organization with powers confirmed by the organization.
 assert.deepEqual((await b.call('GET','/api/orgs')).body.organizations,[]);
 const owned=(await a.call('GET','/api/orgs')).body.organizations;assert.deepEqual(owned.map(o=>[o.id,o.name,o.role,o.powers]),[[org,'Acme Ltd','owner-of-record',['admin','owner-of-record']]]);
 // A bound invitation (with admin) accepted by B through the acceptance route records B's hint.
 const invite=await a.call('POST',`/api/orgs/${org}/invitations`,{input:{invitee:{iss:ORIGIN,sub:b.id},grants:[{power:'admin'}]}});assert.equal(invite.status,200,JSON.stringify(invite.body));
 {const accepted=await b.call("POST",`/api/orgs/${org}/accept`,{input:{invitation:invite.body.meta}});assert.equal(accepted.status,200,JSON.stringify(accepted.body));}
 const listed=(await b.call('GET','/api/orgs')).body.organizations;assert.deepEqual(listed.map(o=>[o.id,o.name,o.role,o.powers]),[[org,'Acme Ltd','member',[]]],'admin waits 72 h, so no powers yet');
 const view=await b.call('GET',`/api/orgs/${org}/membership`);assert.equal(view.status,200);assert.equal(view.body.membership.grants[0].power,'admin');assert.equal(typeof view.body.membership.grants[0].notBefore,'number');
 assert.equal(JSON.stringify(view.body).includes(a.id),false,'a member never sees another member\'s principal through the self view');
 assert.deepEqual((await b.call('GET',`/api/orgs/${org}/requests`)).body.requests,[]);
 // A asks to drop B's (pending) admin grant: B is the subject and sees the request with its decisions; C sees nothing.
 const asked=await a.call('POST',`/api/orgs/${org}/member-grants`,{input:{membership:view.body.membership.id,grants:[],reason:'Not needed yet'}});assert.equal(asked.status,200,JSON.stringify(asked.body));
 const pending=(await b.call('GET',`/api/orgs/${org}/requests`)).body.requests;assert.deepEqual(pending.map(q=>[q.roles,q.decisions,q.reason]),[[['subject'],['accept','reject'],'Not needed yet']]);
 assert.deepEqual((await a.call('GET',`/api/orgs/${org}/requests`)).body.requests.map(q=>[q.roles,q.decisions]),[[['requester'],['retract']]]);
 assert.equal((await b.call('POST',`/api/orgs/${org}/grant-decision`,{input:{request:pending[0].id,decision:'reject'}})).status,200);
 assert.deepEqual((await b.call('GET',`/api/orgs/${org}/requests`)).body.requests[0].decisions,['accept']);
 assert.equal((await a.call('POST',`/api/orgs/${org}/grant-decision`,{input:{request:pending[0].id,decision:'retract'}})).status,200);
 assert.deepEqual((await b.call('GET',`/api/orgs/${org}/requests`)).body.requests,[]);
 // Outsiders: a stranger and a member of another organization get exactly the unknown-organization refusal.
 for(const route of ['membership','requests','members','audit','connections','preferences']){
  const ghost=await c.call('GET',`/api/orgs/${GHOST}/${route}`),stranger=await c.call('GET',`/api/orgs/${org}/${route}`),foreign=await e.call('GET',`/api/orgs/${org}/${route}`);
  assert.equal(ghost.status,404,route);assert.deepEqual(stranger,ghost,route);assert.deepEqual(foreign,ghost,route);
 }
 assert.deepEqual((await e.call('GET','/api/orgs')).body.organizations.map(o=>o.id),[other],'another organization\'s owner sees only their own');
 // Leaving through the route forgets the hint; discovery is empty again.
 assert.equal((await b.call('POST',`/api/orgs/${org}/leave`,{input:{}})).status,200);assert.deepEqual((await b.call('GET','/api/orgs')).body.organizations,[]);
 assert.equal((await b.call('GET',`/api/orgs/${org}/membership`)).status,404);
});

test('ORG-5 runtime: an admin acts for the organization on its connections; members and outsiders cannot; deletion fences widening',async t=>{
 const f=await fixture(t),a=await f.person(),b=await f.person();
 const org=(await a.call('POST','/api/orgs',{input:{request:'context-runtime-000003',name:'Acme Ltd'}})).body.organization.id;
 const invite=await a.call('POST',`/api/orgs/${org}/invitations`,{input:{invitee:{iss:ORIGIN,sub:b.id},grants:[]}});assert.equal((await b.call('POST',`/api/orgs/${org}/accept`,{input:{invitation:invite.body.meta}})).status,200);assert.equal((await b.call('GET',`/api/orgs/${org}/membership`)).status,200,'B is a live plain member');
 // Seed one connection in the organization's own account through the internal writer RPC (the authorization flow for
 // organizations is not part of this slice).
 const seeded=await f.accounts.get(org).invoke({method:'connectionsOwner',args:[org,{operation:'connections.connect-built-in',input:{integration:'google-drive'}}]});
 assert.equal(seeded?.$fault,undefined,JSON.stringify(seeded));
 const listed=await a.call('GET',`/api/orgs/${org}/connections`);assert.equal(listed.status,200,JSON.stringify(listed.body));assert.equal(listed.body.connections.length,1);
 const connection=listed.body.connections[0];
 // The person's own connections are a different account: nothing from the organization appears there, and vice versa.
 assert.deepEqual((await a.object.connectionsOwner(a.id,{operation:'connections.list'})).connections,[]);
 // A plain member and an outsider are refused identically.
 const member=await b.call('GET',`/api/orgs/${org}/connections`);assert.equal(member.status,404);
 assert.equal((await b.call('POST',`/api/orgs/${org}/connections`,{input:{operation:'suspend',input:{connection:connection.id,expectedGeneration:connection.generation}}})).status,404);
 // Operations outside the organization subset do not exist.
 for(const operation of ['connect-built-in','occupy','list'])assert.equal((await a.call('POST',`/api/orgs/${org}/connections`,{input:{operation,input:{}}})).status,404,operation);
 const suspended=await a.call('POST',`/api/orgs/${org}/connections`,{input:{operation:'suspend',input:{connection:connection.id,expectedGeneration:connection.generation}}});assert.equal(suspended.status,200,JSON.stringify(suspended.body));
 let current=(await a.call('GET',`/api/orgs/${org}/connections`)).body.connections[0];assert.equal(current.state,'suspended');
 // A pending deletion: resume (widening) is refused, disconnect (reducing) still works, and the admin member listing is fenced (M3).
 assert.equal((await a.call('POST',`/api/orgs/${org}/deletion`,{input:{}})).status,200);
 const resume=await a.call('POST',`/api/orgs/${org}/connections`,{input:{operation:'resume',input:{connection:current.id,expectedGeneration:current.generation}}});assert.equal(resume.body.error,'organization_deletion_pending');
 assert.equal((await a.call('GET',`/api/orgs/${org}/members`)).body.error,'organization_deletion_pending');
 assert.equal((await a.call('DELETE',`/api/orgs/${org}/deletion`)).status,200);
 current=(await a.call('GET',`/api/orgs/${org}/connections`)).body.connections[0];
 assert.equal((await a.call('POST',`/api/orgs/${org}/connections`,{input:{operation:'resume',input:{connection:current.id,expectedGeneration:current.generation}}})).status,200);
 current=(await a.call('GET',`/api/orgs/${org}/connections`)).body.connections[0];
 assert.equal((await a.call('POST',`/api/orgs/${org}/connections`,{input:{operation:'disconnect',input:{connection:current.id,expectedGeneration:current.generation}}})).status,200);
 assert.equal((await a.call('GET',`/api/orgs/${org}/connections`)).body.connections[0].state,'disconnected');
});

test('ORG-5 runtime: an admin reads and configures the organization\'s preference fragments with the person\'s own session',async t=>{
 const f=await fixture(t),a=await f.person(),b=await f.person();
 const org=(await a.call('POST','/api/orgs',{input:{request:'context-runtime-000004',name:'Acme Ltd'}})).body.organization.id;
 const invite=await a.call('POST',`/api/orgs/${org}/invitations`,{input:{invitee:{iss:ORIGIN,sub:b.id},grants:[]}});assert.equal((await b.call('POST',`/api/orgs/${org}/accept`,{input:{invitation:invite.body.meta}})).status,200);assert.equal((await b.call('GET',`/api/orgs/${org}/membership`)).status,200,'B is a live plain member');
 const empty=await a.call('GET',`/api/orgs/${org}/preferences`);assert.equal(empty.status,200,JSON.stringify(empty.body));assert.deepEqual(empty.body.preferences,[]);
 const saved=await a.call('POST',`/api/orgs/${org}/preferences`,{input:{fragment:FRAGMENT,values:{displayName:'Acme shared name'},expectedRevision:null}});assert.equal(saved.status,200,JSON.stringify(saved.body));
 const read=await a.call('GET',`/api/orgs/${org}/preferences`);assert.equal(read.body.preferences.length,1);assert.equal(read.body.preferences[0].values.displayName,'Acme shared name');assert.equal(read.body.preferences[0].schema.title,'Organization settings');
 // The organization's values are not the person's: A's own preferences remain empty.
 assert.deepEqual((await f.env.FEDERATION_AUTHORITY.preferences(a.context)).preferences,[]);
 // Stale revisions are refused by the existing preferences rules.
 assert.equal((await a.call('POST',`/api/orgs/${org}/preferences`,{input:{fragment:FRAGMENT,values:{displayName:'Late'},expectedRevision:null}})).body.error,'stale_consent');
 // Unsupported fields (shared-consumer updates, settings removal) are not part of the organization adapter.
 assert.equal((await a.call('POST',`/api/orgs/${org}/preferences`,{input:{removeSettings:true,fragment:FRAGMENT}})).body.error,'invalid_request');
 // A plain member is refused as if the organization did not exist, for reads and writes.
 const ghost=await b.call('GET',`/api/orgs/${GHOST}/preferences`);
 assert.deepEqual(ghost,{status:404,body:{error:'not_found',message:'Not found.'}});
 assert.deepEqual(await b.call('GET',`/api/orgs/${org}/preferences`),ghost);
 assert.deepEqual(await b.call('POST',`/api/orgs/${org}/preferences`,{input:{fragment:FRAGMENT,values:{displayName:'Member'},expectedRevision:read.body.preferences[0].revision}}),await b.call('POST',`/api/orgs/${GHOST}/preferences`,{input:{fragment:FRAGMENT,values:{displayName:'Member'},expectedRevision:read.body.preferences[0].revision}}));
 // A forged context naming another person's session is refused by the shard's own session check.
 await assert.rejects(f.env.FEDERATION_AUTHORITY.organizationPreferences({...b.context,organization:{epoch:0,aep:0}},org),e=>e.code==='not_found');
 // Deletion pending: reads still work, writes (which can widen) are refused.
 assert.equal((await a.call('POST',`/api/orgs/${org}/deletion`,{input:{}})).status,200);
 assert.equal((await a.call('GET',`/api/orgs/${org}/preferences`)).status,200);
 assert.equal((await a.call('POST',`/api/orgs/${org}/preferences`,{input:{fragment:FRAGMENT,values:{displayName:'During deletion'},expectedRevision:read.body.preferences[0].revision}})).body.error,'organization_deletion_pending');
});

test('ORG-5 runtime: discovery and the organization-context routes are not exposed while ORGANIZATIONS_ENABLED is off',async t=>{
 const f=await fixture(t,{enabled:false}),a=await f.person();
 assert.equal((await a.call('GET','/api/orgs')).status,404);
 for(const route of ['membership','preferences'])assert.equal((await a.call('GET',`/api/orgs/${GHOST}/${route}`)).status,404,route);
});
