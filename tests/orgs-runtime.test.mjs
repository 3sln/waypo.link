// ORG-0/ORG-1 over the durable Node runtime: real account single writers (AccountController behind its gate), the real
// identity repository, key registry and identity-backup port. The owner-route stage is driven directly with the actor
// the HTTP router builds (packages/runtime/http.mjs), so session plumbing is out of scope here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {IdentityService} from '../packages/identity/service.mjs';
import {identityBackupPort,recoveryAuthorityPublic} from '../packages/runtime/identity-backup.mjs';
import {verifyIdentityBackup} from '../packages/recovery/identity-backup.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {stages,allowedMethods} from '../packages/runtime/routes/orgs.mjs';
import {personActor,actingAs} from '../packages/orgs/authority.mjs';
import {fakeHasher} from './helpers/identity-engine.mjs';
import {IdentityCrypto} from '../packages/identity/crypto.mjs';

const ORIGIN='http://localhost:8788',PASSWORD='Organizations runtime test password!';
async function fixture(t,{enabled=true}={}){
 const directory=await mkdtemp(join(tmpdir(),'orgs-runtime-'));
 const app=await createNodeServer({directory,config:{ORGANIZATIONS_ENABLED:enabled?'true':'false',ORGANIZATION_PLANS:{check:async()=>({paid:true,plan:'organization-internal',source:'test'})}}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);
 const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
 await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
 const id=pending.account.id,env={APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATIONS_ENABLED:enabled?'true':'false'};
 const object=accountHandle(env,id);
 const call=async(method,path,{input,authTime=Date.now(),epoch=0}={})=>{
  const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
  const response=await stages.owner({request,env,path,id,object,actor:personActor({owner:id,iss:ORIGIN,authTime,epoch})}).catch(error=>new Response(JSON.stringify({error:error.code}),{status:error.status??500}));
  return {status:response.status,body:await response.json()};
 };
 return {app,identity,repository,accounts,env,id,object,call,base,RECOVERY_SIGNING_KEY};
}

test('ORG-0 runtime: an explicit person actor and the legacy implicit owner dispatch identically; organization actors are refused on generic operations',async t=>{
 const f=await fixture(t);
 const legacy=await f.object.dispatch(f.id,{operation:'views.list'});
 const explicit=await f.object.dispatch(f.id,{operation:'views.list',actor:{principal:{iss:ORIGIN,sub:f.id},entity:{kind:'person',id:f.id},authTime:Date.now(),epoch:0,powers:['admin']}});
 assert.deepEqual(explicit,legacy);
 await assert.rejects(f.object.dispatch(f.id,{operation:'views.list',actor:{principal:{iss:ORIGIN,sub:f.id},entity:{kind:'organization',id:f.id}}}),{code:'not_found'});
 const other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 await assert.rejects(f.object.dispatch(f.id,{operation:'views.list',actor:{principal:{iss:ORIGIN,sub:other},entity:{kind:'person',id:f.id}}}),{code:'forbidden'});
});

test('ORG-1 runtime: creation issues a real organization recovery file over provider-custodied keys; the organization never signs in',async t=>{
 const f=await fixture(t);
 assert.deepEqual(allowedMethods('/api/orgs'),['GET','POST']);
 const created=await f.call('POST','/api/orgs',{input:{request:'runtime-create-000001',name:'Acme Ltd',label:'company'}});
 assert.equal(created.status,200,JSON.stringify(created.body));
 const org=created.body.organization.id,file=JSON.parse(created.body.recoveryFile.content);
 assert.equal(file.entity,org);assert.equal(file.issuer,ORIGIN);
 const verified=await verifyIdentityBackup(file,recoveryAuthorityPublic({RECOVERY_SIGNING_KEY:f.RECOVERY_SIGNING_KEY}),{issuer:ORIGIN,entity:org});
 assert.equal(await f.accounts.get(org).invoke({method:'recoveryKeysMatch',args:[org,verified.keychain]}),true,'the file restores the organization writer\'s current keys');
 const signing=await f.accounts.get(org).invoke({method:'identitySigningKey',args:[org,verified.keychain.signing.kid]});assert.equal(signing.active,true);
 const record=await f.repository.get(org);
 assert.equal(record.kind,'organization');assert.equal(record.status,'active');assert.equal(record.recoveryHash,await new IdentityCrypto().hash('recovery',file.recoveryToken));assert.equal(record.recoveryKeyKid,verified.keychain.signing.kid);assert.equal(record.recoveryBackupVersion,2);
 assert.deepEqual([record.credentials.length,record.sessions.length,record.passwordHash,record.emailLoginEnabled],[0,0,null,false]);
 // No interactive path: the organization's own file recovers nothing (break-glass is phase B), and login finds nothing.
 await assert.rejects(f.identity.recover({recoveryToken:file.recoveryToken,identityBackup:file,turnstileToken:'ok'},f.base),{code:'unauthorized'});
 await assert.rejects(f.identity.loginPassword({handle:record.handle,password:PASSWORD,turnstileToken:'ok'},f.base),{code:'unauthorized'});
 assert.equal((await f.repository.get(org)).status,'active','a refused recovery changes nothing');
 // The organization's own account is never removed by the inactivity lifecycle.
 assert.equal((await f.accounts.get(org).invoke({method:'snapshot',args:[org]})).retention.status,'review-required');
 // Reads and owner-interface changes through the routes.
 const listed=await f.call('GET','/api/orgs');assert.deepEqual(listed.body.organizations.map(o=>o.id),[org]);
 const view=await f.call('GET',`/api/orgs/${org}`);assert.equal(view.body.name,'Acme Ltd');assert.deepEqual(view.body.powers,['admin','owner-of-record']);
 assert.equal((await f.call('POST',`/api/orgs/${org}/name`,{input:{name:'Acme Holdings',expectedRevision:view.body.revision}})).body.name,'Acme Holdings');
 assert.equal((await f.call('POST',`/api/orgs/${org}/label`,{input:{label:'team'}})).body.label,'team');
 assert.equal((await f.call('POST',`/api/orgs/${org}/deletion`,{input:{},authTime:Date.now()-3600000})).body.error,'reauthentication_required');
 assert.equal((await f.call('POST',`/api/orgs/${org}/deletion`,{input:{}})).body.state,'deletion-scheduled');
 assert.equal((await f.call('DELETE',`/api/orgs/${org}/deletion`)).body.state,'active');
 // Another person is refused as if the organization did not exist; the organization writer resolves powers itself.
 const stranger='ffffffff-ffff-4fff-8fff-ffffffffffff';
 await assert.rejects(accountHandle(f.env,org).orgsDispatch(org,{operation:'orgs.get',actor:actingAs(personActor({owner:stranger,iss:ORIGIN}),{kind:'organization',id:org})}),{code:'not_found'});
 // Unknown organizations never bind an account writer.
 const ghost='12345678-1234-4123-8123-123456789abc';assert.equal((await f.call('GET',`/api/orgs/${ghost}`)).status,404);
});

test('ORG-1 runtime: the routes are not exposed while ORGANIZATIONS_ENABLED is off',async t=>{
 const f=await fixture(t,{enabled:false});
 assert.equal((await f.call('GET','/api/orgs')).status,404);
 assert.equal((await f.call('POST','/api/orgs',{input:{request:'runtime-create-000002',name:'Off'}})).status,404);
 assert.equal((await f.call('GET','/api/orgs/12345678-1234-4123-8123-123456789abc')).status,404);
});
