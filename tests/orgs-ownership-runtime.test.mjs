// Organization billing and ownership transfer over the durable Node runtime: real account single writers, routes,
// identity repository, key registry and identity-backup port; Polar is the offline model (sandbox only). The owner
// stage is driven with the actor the HTTP router builds (packages/runtime/http.mjs), including step-up evidence.
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
import {fakeHasher,fakeWebAuthn,passkeyResponse} from './helpers/identity-engine.mjs';
import {fakeClock} from '../packages/app/memory-providers.mjs';
import {IdentityCrypto} from '../packages/identity/crypto.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './helpers/org-polar.mjs';
import {transferIdentityPort} from '../packages/identity/transfer-out.mjs';
import {organizationIdentityPort} from '../packages/identity/organizations.mjs';

const ORIGIN='http://localhost:8788',DAY=86400000;
test('runtime: checkout at creation, verified webhook delegation, transfer effect, key rotation and recovery reissue',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'orgs-ownership-')),clock=fakeClock(Date.now()),polar=fakeOrgPolar({clock});
 const app=await createNodeServer({directory,config:{...ORG_POLAR_CONFIG,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',ORGANIZATIONS_ENABLED:'true',ORGANIZATION_BILLING_CLIENT:polar.client,LIFECYCLE_CLOCK:clock.now}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const backup=identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts});
 const identity=new IdentityService({repository,identityBackup:backup,turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:fakeWebAuthn(),passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const person=async()=>{const pending=await identity.signup({method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);await identity.registerPasskey({pendingToken:pending.pendingToken,response:passkeyResponse(pending,'passkey-'+pending.account.id)},base);const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);return pending.account.id;};
 const A=await person(),B=await person(),env={...ORG_POLAR_CONFIG,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATIONS_ENABLED:'true',ORGANIZATION_BILLING_CLIENT:polar.client};
 const verification=()=>({stepUpAt:clock.now(),enrolledAt:clock.now()-30*DAY,securityChangedAt:clock.now()-60*DAY});
 const call=async(id,method,path,input)=>{
  const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
  const response=await stages.owner({request,env,url:new URL(request.url),path:new URL(request.url).pathname,id,object:accountHandle(env,id),actor:personActor({owner:id,iss:ORIGIN,authTime:clock.now(),verification:verification()}),context:{remoteIP:'127.0.0.1'}}).catch(error=>new Response(JSON.stringify({error:error.code,message:error.message}),{status:error.status??500}));
  return {status:response.status,body:await response.json()};
 };
 // Plans: the provisional sandbox catalog.
 const plans=await call(A,'GET','/api/orgs/plans');assert.equal(plans.body.configured,true);assert.equal(plans.body.server,'sandbox');assert.deepEqual(plans.body.plans.map(p=>p.id),['org-team','org-business','org-scale']);
 // Creation needs a verified payment bound to the request; a checkout alone does nothing.
 const request='runtime-request-00001',input={request,name:'Acme',plan:'org-team'};
 let created=await call(A,'POST','/api/orgs',input);assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.payment.required,true);assert.equal(created.body.organization,null);
 const checkout=await call(A,'POST','/api/orgs/checkout',{request,plan:'org-team',ageConfirmed:18});assert.match(checkout.body.checkout.url,/sandbox\.polar\.sh/);
 created=await call(A,'POST','/api/orgs',input);assert.equal(created.body.payment.required,true);
 polar.pay(polar.checkoutBy(()=>true).id);created=await call(A,'POST','/api/orgs',input);assert.equal(created.status,200,JSON.stringify(created.body));
 const org=created.body.organization.id,oldFile=created.body.recoveryFile;assert.ok(oldFile);
 let view=await call(A,'GET',`/api/orgs/${org}/ownership`);assert.equal(view.body.billing.standing,'paid');assert.equal(view.body.billing.plan,'org-team');assert.ok(view.body.decisions.includes('offer'));
 // A verified webhook for the organization's customer reaches its writer through the person billing slice's delegation.
 const hook=await accountHandle(env,org).billingWebhookVerified(org,{owner:org,id:'evt_runtime_1',bodyHash:'c'.repeat(64),type:'subscription.updated',customerId:'x'});assert.equal(hook.accepted,true);assert.equal(hook.duplicate,false);
 assert.equal((await accountHandle(env,org).billingWebhookVerified(org,{owner:org,id:'evt_runtime_1',bodyHash:'c'.repeat(64),type:'subscription.updated'})).duplicate,true);
 // Offer: resolve the handle, then offer to the resolved account.
 const handle=(await repository.get(B)).handle;assert.equal((await call(A,'POST',`/api/orgs/${org}/transfer-recipient`,{handle:'no-such-handle'})).status,404);
 const resolved=await call(A,'POST',`/api/orgs/${org}/transfer-recipient`,{handle});assert.equal(resolved.body.recipient.id,B);
 assert.equal((await call(B,'POST',`/api/orgs/${org}/transfer-recipient`,{handle})).status,404);
 const offered=await call(A,'POST',`/api/orgs/${org}/transfer`,{operation:'offer',recipient:B,handle,confirm:true});assert.equal(offered.status,200,JSON.stringify(offered.body));
 // The recipient discovers the offer (the index hint is confirmed by the organization) and accepts with the digest.
 const listed=await call(B,'GET','/api/orgs');assert.equal(listed.body.offers.length,1,JSON.stringify(listed.body));const offer=listed.body.offers[0].offer;assert.equal(offer.decisions.join(),'accept,decline');
 const accepted=await call(B,'POST',`/api/orgs/${org}/transfer`,{operation:'accept',transfer:offer.id,disclosure:offer.plans[0].digest,confirm:true,ageConfirmed:18});assert.equal(accepted.status,200,JSON.stringify(accepted.body));
 polar.pay(polar.checkoutBy(k=>k.metadata['3sln_me_org_purpose']==='transfer').id);
 await accountHandle(env,org).billingWebhookVerified(org,{owner:org,id:'evt_runtime_2',bodyHash:'d'.repeat(64),type:'order.paid'});
 view=await call(A,'GET',`/api/orgs/${org}/ownership`);assert.equal(view.body.transfer.state,'paid');assert.equal(view.body.ownerOfRecord.sub,A);
 const keyBefore=(await accountHandle(env,org).orgsSigningProvenance(org)).kid;
 // Review M1 (recovery file v3): before the change the previous owner's token is the organization's current credential.
 const transferIdentity=transferIdentityPort(repository),before=await repository.get(org);
 assert.ok(await transferIdentity.verifyRecovery(org,oldFile.recoveryToken),'the creation file verifies before the ownership change');
 clock.advance(DAY+1000);await accounts.get(org).alarm();
 view=await call(B,'GET',`/api/orgs/${org}/ownership`);assert.equal(view.body.ownerOfRecord.sub,B,JSON.stringify(view.body));assert.equal(view.body.recovery.state,'missing');assert.ok(view.body.decisions.includes('reissue-recovery'));
 // `missing` means no valid file: the ownership effect cleared the credential (one CAS, security epoch bumped) before
 // reporting success, so the previous owner's token verifies nowhere.
 {const after=await repository.get(org);assert.equal(after.recoveryHash,null);for(const name of ['recoveryFileId','recoveryIssuedAt','recoveryBackupVersion'])assert.equal(after[name],undefined,name);
  assert.ok(after.security.epoch>before.security.epoch,'the organization security epoch was bumped');assert.ok(after.audit.some(e=>e.type==='recovery-file-invalidated'));
  assert.equal(await transferIdentity.verifyRecovery(org,oldFile.recoveryToken),null,'transfer-out no longer accepts the previous owner\'s file');
  assert.equal((await transferIdentity.get(org)).recovery,null);
  await assert.rejects(identity.recover({recoveryToken:oldFile.recoveryToken,turnstileToken:'ok'},base),'recovery refuses the previous owner\'s file');
  assert.equal((await organizationIdentityPort(repository).invalidateRecovery(org)).invalidated,false,'invalidation is idempotent');}
 assert.notEqual((await accountHandle(env,org).orgsSigningProvenance(org)).kid,keyBefore,'the organization signing key rotated at the ownership change');
 assert.ok(polar.effects.revoked.length===1&&polar.effects.refunds.length===0,'the previous subscription is cancelled at once, without a refund');
 // Discovery follows the organization's answer: B owns it, A remains a member.
 assert.equal((await call(B,'GET','/api/orgs')).body.organizations.find(o=>o.id===org)?.role,'owner-of-record');assert.equal((await call(A,'GET','/api/orgs')).body.organizations.find(o=>o.id===org)?.role,'member');
 assert.equal((await call(A,'GET',`/api/orgs/${org}/membership`)).body.organization.ownerOfRecord,false);
 // Recovery file v3: the previous owner's file is not the organization's current credential once the new owner reissues
 // (organization files recover nothing until ORG-12; the credential hash, not a key, decides).
 const hash=token=>new IdentityCrypto().hash('recovery',token);
 {const denied=await call(A,"POST",`/api/orgs/${org}/recovery-file`);assert.equal(denied.status,404,JSON.stringify(denied.body));}
 const reissued=await call(B,'POST',`/api/orgs/${org}/recovery-file`);assert.equal(reissued.status,200,JSON.stringify(reissued.body));
 const fresh=await repository.get(org);assert.equal(fresh.recoveryHash,await hash(reissued.body.recoveryFile.recoveryToken));assert.notEqual(fresh.recoveryHash,await hash(oldFile.recoveryToken));
 assert.equal(fresh.recoveryFileId,JSON.parse(reissued.body.recoveryFile.content).fileId);assert.equal(reissued.body.recoveryFile.content.includes('keychain'),false);
 assert.equal((await call(B,'GET',`/api/orgs/${org}/ownership`)).body.recovery.state,'issued');
});

// Wargame F-05 (2026-10-23): a reconcile the provider port refuses for capacity falls back to the time rules (which never
// change the owner) and is reported to the operator through the lifecycle log, instead of failing silently forever.
test('runtime: a reconcile refused for subscription capacity raises an operator alert',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'orgs-capacity-')),clock=fakeClock(Date.now()),polar=fakeOrgPolar({clock}),log=[];
 const app=await createNodeServer({directory,config:{...ORG_POLAR_CONFIG,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',ORGANIZATIONS_ENABLED:'true',ORGANIZATION_BILLING_CLIENT:polar.client,LIFECYCLE_CLOCK:clock.now,LIFECYCLE_LOG:entry=>log.push(entry)}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const identity=new IdentityService({repository,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:fakeWebAuthn(),passwordHasher:fakeHasher,config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'},pending=await identity.signup({method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);await identity.registerPasskey({pendingToken:pending.pendingToken,response:passkeyResponse(pending,'passkey-'+pending.account.id)},base);
 const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
 const A=pending.account.id,env={...ORG_POLAR_CONFIG,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATIONS_ENABLED:'true',ORGANIZATION_BILLING_CLIENT:polar.client};
 const call=async(method,path,input)=>{const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});const response=await stages.owner({request,env,url:new URL(request.url),path:new URL(request.url).pathname,id:A,object:accountHandle(env,A),actor:personActor({owner:A,iss:ORIGIN,authTime:clock.now()}),context:{remoteIP:'127.0.0.1'}}).catch(error=>new Response(JSON.stringify({error:error.code}),{status:error.status??500}));return {status:response.status,body:await response.json()};};
 const input={request:'runtime-request-00002',name:'Acme',plan:'org-team'};await call('POST','/api/orgs',input);await call('POST','/api/orgs/checkout',{request:input.request,plan:'org-team'});polar.pay(polar.checkoutBy(()=>true).id);
 const created=await call('POST','/api/orgs',input);assert.equal(created.status,200,JSON.stringify(created.body));const org=created.body.organization.id;
 for(let i=0;i<17;i++)polar.subscribe({org,owner:A,purpose:'renew',binding:'renew-flood-'+i});
 log.length=0;await accountHandle(env,org).orgsBillingSync(org);
 assert.ok(log.some(e=>e.reason==='subscription-capacity'&&e.org===org),JSON.stringify(log.map(e=>e.reason)));
 assert.equal((await call('GET',`/api/orgs/${org}/ownership`)).body.ownerOfRecord.sub,A);
});
