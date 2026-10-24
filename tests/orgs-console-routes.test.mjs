// Organization console support routes (2026-10-23 UX pass, provisional; additive over the ORG-1 owner routes): the
// admin-only invitee handle lookup, handles on member and request listings, and the creation eligibility answer.
// Durable Node runtime with real account writers and identity repository; Polar is the offline model (sandbox only).
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
import {fakeClock} from '../packages/app/memory-providers.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './helpers/org-polar.mjs';
const ORIGIN='http://localhost:8788',PASSWORD='Organization console routes password!',DAY=86400000;
test('console routes: invitee lookup is admin-only, listings carry handles, plans state creation eligibility',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'orgs-console-')),clock=fakeClock(Date.now()),polar=fakeOrgPolar({clock});
 const app=await createNodeServer({directory,config:{...ORG_POLAR_CONFIG,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',ORGANIZATIONS_ENABLED:'true',ORGANIZATION_BILLING_CLIENT:polar.client,LIFECYCLE_CLOCK:clock.now}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const backup=identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts});
 const identity=new IdentityService({repository,identityBackup:backup,turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:{},passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const person=async()=>{const pending=await identity.signup({method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);return pending.account.id;};
 const A=await person(),B=await person();
 const envFor=extra=>({...ORG_POLAR_CONFIG,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATIONS_ENABLED:'true',ORGANIZATION_BILLING_CLIENT:polar.client,...extra});
 let env=envFor({});
 const verification=()=>({stepUpAt:clock.now(),enrolledAt:clock.now()-30*DAY,securityChangedAt:clock.now()-60*DAY});
 const call=async(id,method,path,input)=>{
  const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
  const response=await stages.owner({request,env,url:new URL(request.url),path:new URL(request.url).pathname,id,object:accountHandle(env,id),actor:personActor({owner:id,iss:ORIGIN,authTime:clock.now(),verification:verification()}),context:{remoteIP:'127.0.0.1'}}).catch(error=>new Response(JSON.stringify({error:error.code,message:error.message}),{status:error.status??500}));
  return {status:response.status,body:await response.json()};
 };
 assert.deepEqual(allowedMethods('/api/orgs/00000000-0000-4000-8000-000000000001/invitee'),['POST']);
 // Eligibility: billing configured means checkout; the operator allowlist wins; without billing and unlisted, unavailable.
 assert.equal((await call(A,'GET','/api/orgs/plans')).body.creation,'checkout');
 env=envFor({ORGANIZATIONS_PAID_ALLOWLIST:A});assert.equal((await call(A,'GET','/api/orgs/plans')).body.creation,'allowlisted');
 env=envFor({ORGANIZATION_BILLING_CLIENT:undefined,POLAR_ORG_ACCESS_TOKEN:undefined,...Object.fromEntries(Object.keys(ORG_POLAR_CONFIG).map(k=>[k,undefined]))});
 const off=await call(B,'GET','/api/orgs/plans');assert.equal(off.body.configured,false);assert.equal(off.body.creation,'unavailable');
 env=envFor({});
 // An organization owned by A (sandbox checkout at creation).
 const request='console-request-00001',input={request,name:'Console',plan:'org-team'};
 await call(A,'POST','/api/orgs',input);await call(A,'POST','/api/orgs/checkout',{request,plan:'org-team'});polar.pay(polar.checkoutBy(()=>true).id);
 const created=await call(A,'POST','/api/orgs',input);assert.equal(created.status,200,JSON.stringify(created.body));const org=created.body.organization.id;
 // Invitee lookup: admins resolve a person handle; unknown, organization and non-admin lookups are refused uniformly.
 const handleB=(await repository.get(B)).handle;
 const found=await call(A,'POST',`/api/orgs/${org}/invitee`,{handle:'@'+handleB});assert.equal(found.status,200,JSON.stringify(found.body));assert.deepEqual(found.body.invitee,{iss:ORIGIN,sub:B,handle:handleB});
 assert.equal((await call(A,'POST',`/api/orgs/${org}/invitee`,{handle:'no-such-handle-here'})).status,404);
 assert.equal((await call(A,'POST',`/api/orgs/${org}/invitee`,{handle:'!!'})).status,400);
 assert.equal((await call(B,'POST',`/api/orgs/${org}/invitee`,{handle:handleB})).status,404,'a non-member learns nothing');
 // A bound invitation from the resolved principal; B accepts; the admin listing shows both handles.
 const invited=await call(A,'POST',`/api/orgs/${org}/invitations`,{invitee:{iss:ORIGIN,sub:B},grants:[]});assert.equal(invited.status,200,JSON.stringify(invited.body));
 const accepted=await call(B,'POST',`/api/orgs/${org}/accept`,{invitation:invited.body.meta??invited.body.invitation});assert.equal(accepted.status,200,JSON.stringify(accepted.body));
 const members=await call(A,'GET',`/api/orgs/${org}/members`);assert.equal(members.status,200);
 const handles=Object.fromEntries(members.body.members.map(m=>[m.principal.sub,m.principal.handle]));assert.equal(handles[B],handleB);assert.equal(handles[A],(await repository.get(A)).handle);
 assert.equal((await call(B,'POST',`/api/orgs/${org}/invitee`,{handle:handleB})).status,404,'a plain member cannot use the lookup');
});
