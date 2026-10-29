// ORG-12b/12e over the durable Node runtime: real account single writers, the identity repository, the production
// owner-channels adapter wired by apps/node/resources.mjs, the person-side hints, the identity sign-in hook into each
// person's account (orgsBreakGlassOwnerSignal), the owner routes and the public abort page and POST (full HTTP through
// the Node application, no session cookie). Polar is the offline model (sandbox only); mail is a capturing fake, so
// "accepted" here means accepted by that fake, never delivery.
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
import {stages as identityStages} from '../packages/runtime/routes/identity.mjs';
import {ORG_CLAIM_ABORT_PATH,ORG_CLAIM_ABORT_API,orgClaimAbortScript,orgClaimRenderStamp,POST_FLOOR_MS} from '../packages/runtime/routes/org-claim-abort.mjs';
import {PaidCheckoutAllowed} from '../packages/identity/age-policy.mjs';
import {personActor} from '../packages/orgs/authority.mjs';
import {fakeHasher,fakeWebAuthn,passkeyResponse} from './helpers/identity-engine.mjs';
import {fakeClock} from '../packages/app/memory-providers.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './helpers/org-polar.mjs';

const ORIGIN='http://localhost:8788',DAY=86400000;
async function fixture(t){
 // The clock starts 40 days back so the 31-day advance stays before real time: the owner-route actor resolves admin
 // powers against real time (packages/orgs/authority.mjs), the writers against LIFECYCLE_CLOCK.
 const directory=await mkdtemp(join(tmpdir(),'orgs-break-glass-')),clock=fakeClock(Date.now()-40*DAY),polar=fakeOrgPolar({clock}),mail=[];
 const mailer={async sendBreakGlassNotice(notice){mail.push(structuredClone(notice));return {messageId:'m'+mail.length};}};
 const flags={ORGANIZATIONS_ENABLED:'true',ORG_BREAK_GLASS_ENABLED:'true'};
 const app=await createNodeServer({directory,mailer,config:{...ORG_POLAR_CONFIG,...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',ORGANIZATION_PLANS:{check:async()=>({paid:true,plan:'organization-internal',source:'test'})},ORGANIZATION_BILLING_CLIENT:polar.client,LIFECYCLE_CLOCK:clock.now}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const secretEnv={KEY_ENCRYPTION_KEY:await readFile(join(directory,'encryption-key'),'utf8')};
 const RECOVERY_SIGNING_KEY=await readFile(join(directory,'recovery-signing-key'),'utf8'),repository=app.resources.repository,accounts=app.resources.accounts;
 const signals=[];
 // The identity service with the sign-in hook wired exactly as apps/node/server.mjs wires it.
 const identity=new IdentityService({repository,clock:clock.now,identityBackup:identityBackupPort({config:{APP_ORIGIN:ORIGIN,RECOVERY_SIGNING_KEY},accounts}),turnstile:{verify:async()=>true},rateLimiter:{check:async()=>true},webauthn:fakeWebAuthn(),passwordHasher:fakeHasher,
  organizationSignals:{liveness:async(owner,input)=>{const result=await accounts.get(owner).invoke({method:'orgsBreakGlassOwnerSignal',args:[owner,input]});signals.push({owner,...input,result});return result;}},
  config:{origin:ORIGIN,rpID:'localhost',termsVersion:'2026-10-11',allowInsecureLocalhost:true}});
 const base={origin:ORIGIN,remoteIP:'127.0.0.1'};
 const env={...ORG_POLAR_CONFIG,...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',RECOVERY_SIGNING_KEY,IDENTITY_REPOSITORY:repository,ACCOUNTS:accounts,ORGANIZATION_BILLING_CLIENT:polar.client};
 const person=async()=>{
  const pending=await identity.signup({method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'ok'},base);await identity.registerPasskey({pendingToken:pending.pendingToken,response:passkeyResponse(pending,'passkey-'+pending.account.id)},base);
  const downloaded=await identity.downloadRecovery({pendingToken:pending.pendingToken},base);
  await identity.confirmRecovery({pendingToken:pending.pendingToken,recoveryToken:downloaded.recoveryToken,downloadConfirmed:true},base);
  const id=pending.account.id,object=accountHandle(env,id);
  const call=async(method,path,{input,verification,owner,routeEnv=env}={})=>{
   const request=new Request(ORIGIN+path,{method,headers:input?{'Content-Type':'application/json'}:{},...input?{body:JSON.stringify(input)}:{}});
   const record=await repository.get(id);
   const response=await stages.owner({request,env:routeEnv,url:new URL(request.url),path,id,object,context:{remoteIP:'127.0.0.1'},owner:owner??{devices:[]},actor:personActor({owner:id,iss:ORIGIN,authTime:clock.now(),verification:verification===undefined?{stepUpAt:clock.now(),enrolledAt:record.credentials[0]?.createdAt,securityChangedAt:record.security?.changedAt??0}:verification||undefined})})
    .catch(error=>new Response(JSON.stringify({error:error.code,message:error.message}),{status:error.status??500}));
   return {status:response.status,body:await response.json()};
  };
  return {id,object,call,handle:(await repository.get(id)).handle};
 };
 /** Full HTTP through the Node application (the router's CSRF, budget and stage order), with no session cookie. */
 const http=(path,{method='GET',body,ip='192.0.2.10',origin=ORIGIN}={})=>app.fetch(new Request(ORIGIN+path,{method,headers:{'CF-Connecting-IP':ip,...body?{'Content-Type':'application/json',Origin:origin}:{}},...body?{body:JSON.stringify(body)}:{}}));
 const quiet=async id=>{for(;;){const r=await repository.get(id),revision=r.revision;r.lastInteractiveAt=clock.now()-60*DAY;r.revision=revision+1;if(await repository.compareAndSwap(id,revision,r))return;}};
 const setEmail=async(id,email)=>{for(;;){const r=await repository.get(id),revision=r.revision;r.emails=[{address:email,state:'verified',verifiedAt:clock.now(),notices:true,source:'linked',addedBy:{session:'passkey',at:clock.now()}}];r.revision=revision+1;if(await repository.compareAndSwap(id,revision,r))return;}};
 return {app,env,accounts,repository,identity,person,http,clock,polar,mail,signals,setEmail,quiet,secretEnv};
}
/** A passkey sign-in of person `x` (credential `passkey-<id>`, registered at signup). */
const signIn=async(f,x)=>{const ctx={origin:ORIGIN,remoteIP:'127.0.0.1'},begin=await f.identity.beginPasskeyLogin({handle:x.handle,turnstileToken:'ok'},ctx);return f.identity.finishPasskeyLogin({challengeToken:begin.challengeToken,response:passkeyResponse(begin,'passkey-'+x.id)},ctx);};
const drain=async(f,org)=>{for(let i=0;i<6;i++)await accountHandle(f.env,org).orgsBillingSync(org);};

test('runtime: hints and the person route, sign-in liveness through the person’s account, signed-in abort, flag gating and the checkout gate',async t=>{
 const f=await fixture(t),a=await f.person(),b=await f.person(),c=await f.person();
 await f.setEmail(a.id,'owner@owner-home.example');
 const created=await a.call('POST','/api/orgs',{input:{request:'break-glass-runtime-0001',name:'Acme <b>Ltd</b>',label:'company'}});assert.equal(created.status,200,JSON.stringify(created.body));const org=created.body.organization.id;
 for(const x of [b,c]){const invite=await a.call('POST',`/api/orgs/${org}/invitations`,{input:{invitee:{iss:ORIGIN,sub:x.id},grants:[{power:'admin'}]}});assert.equal(invite.status,200,JSON.stringify(invite.body));assert.equal((await x.call('POST',`/api/orgs/${org}/accept`,{input:{invitation:invite.body.meta}})).status,200);}
 f.clock.advance(31*DAY);await drain(f,org);
 assert.deepEqual(allowedMethods(`/api/orgs/${org}/break-glass`),['GET','POST']);assert.deepEqual(allowedMethods(`/api/orgs/${org}/break-glass-checkout`),['POST']);assert.deepEqual(allowedMethods('/api/orgs/break-glass'),['GET']);
 assert.deepEqual((await a.call('GET','/api/orgs/break-glass')).body,{items:[]},'nothing to show before any claim');
 // Flag off at the route: start is the uniform 404.
 await f.quiet(a.id);const off={...f.env,ORG_BREAK_GLASS_ENABLED:'false'};
 assert.deepEqual(await b.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'start',candidate:{sub:b.id},category:'owner-unreachable',statement:'Gone for months.',confirm:true},routeEnv:off}),{status:404,body:{error:'not_found'}});
 const started=await b.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'start',candidate:{sub:b.id},category:'owner-unreachable',statement:'Gone for months.',confirm:true}});assert.equal(started.status,200,JSON.stringify(started.body));
 assert.equal(started.body.claim.initiator.handle,b.handle,'handles are added for the console');
 await drain(f,org);
 assert.equal(f.mail.filter(n=>n.event==='claim-started').length,1);assert.equal(f.mail[0].email,'owner@owner-home.example');assert.match(f.mail[0].abortUrl,new RegExp('^'+ORIGIN+ORG_CLAIM_ABORT_PATH+'#org='+org+'&token=bg1\\.'));
 // The owner's interstitial item and the co-signer's activity item, both confirmed by the organization.
 const owned=(await a.call('GET','/api/orgs/break-glass')).body.items;assert.equal(owned.length,1,JSON.stringify(owned));assert.equal(owned[0].role,'owner');assert.equal(owned[0].name,'Acme <b>Ltd</b>');assert.ok(owned[0].claim.decisions.includes('abort'));
 const cosign=(await c.call('GET','/api/orgs/break-glass')).body.items;assert.deepEqual(cosign.map(i=>[i.role,i.claim.decisions.includes('cosign')]),[['admin',true]]);
 assert.deepEqual((await b.call('GET','/api/orgs/break-glass')).body.items,[],'the initiator acts in the console');
 // Withdrawals, co-signature withdrawals and objections are never gated, even with the flag off at the route.
 const claim=started.body.claim.id;assert.equal((await c.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'cosign',claim},routeEnv:off})).status,404,'co-signing is a start-side step');
 {const r=await c.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'cosign',claim}});assert.equal(r.status,200,JSON.stringify(r.body));}
 // The candidate's checkout passes the paid-age gate in the identity stage (as billing-checkout does).
 const queried=[];await identityStages.beforeActivity({request:new Request(ORIGIN+`/api/orgs/${org}/break-glass-checkout`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ageConfirmed:18})}),path:`/api/orgs/${org}/break-glass-checkout`,engine:{query:q=>{queried.push(q);return {peek:async()=>true};}},context:{}});
 assert.ok(queried.some(q=>q instanceof PaidCheckoutAllowed),'PaidCheckoutAllowed runs for the break-glass checkout');
 assert.equal((await b.call('POST',`/api/orgs/${org}/break-glass-checkout`,{input:{claim,disclosure:'0'.repeat(64),confirm:true},routeEnv:off})).status,404,'the checkout is gated');
 const view=(await b.call('GET',`/api/orgs/${org}/break-glass`)).body,disclosure=view.claim.disclosure.find(d=>d.plan==='org-team');
 const checkout=await b.call('POST',`/api/orgs/${org}/break-glass-checkout`,{input:{claim,disclosure:disclosure.digest,confirm:true,plan:'org-team',ageConfirmed:18}});assert.equal(checkout.status,200,JSON.stringify(checkout.body));assert.match(checkout.body.checkout.url,/sandbox\.polar\.sh/);
 f.polar.pay(f.polar.checkoutBy(k=>k.metadata?.['3sln_me_org_purpose']==='break-glass').id);await accountHandle(f.env,org).billingWebhookVerified(org,{owner:org,id:'evt_bg_1',bodyHash:'e'.repeat(64),type:'order.paid'});await drain(f,org);
 const paid=(await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim;assert.equal(paid.state,'waiting',paid.state);
 // The owner signs in: the identity hook reaches A's account, which signals the organization (T9). Nothing returns to identity.
 // Review M1: the first delivery fails (the organization is unreachable); the signal stays queued in A's account and the
 // account alarm delivers it later.
 const person=f.accounts.get(a.id),reach=person.config.CONVERSATION_ACCOUNT;person.config.CONVERSATION_ACCOUNT=sub=>sub===org?{invoke:async()=>({$fault:{code:'temporarily_unavailable',message:'down',status:503}})}:reach(sub);
 await signIn(f,a);await f.identity.settleBackground();
 assert.deepEqual(f.signals.map(s=>[s.owner,s.kind,s.result?.signalled]),[[a.id,'sign-in',0]]);
 const queued=(await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim;assert.equal(queued.state,'waiting','nothing reached the organization yet');
 person.config.CONVERSATION_ACCOUNT=reach;f.clock.advance(2*3600000);await person.orgsAlarm();
 assert.equal((await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim.state,'held-for-support','the retried signal holds the claim');
 assert.equal([...(await person.metadata.list({prefix:'orgs/break-glass-signal/'})).keys()].length,0,'the delivered row is removed');
 // B (no claim of their own) signs in: one hint read, no signal.
 await signIn(f,b);await f.identity.settleBackground();assert.equal(f.signals.at(-1).result.signalled,0);
 // The interstitial's abort: a session created after T1 with no step-up is no proof; a session from before T1 is.
 const after={devices:[{current:true,createdAt:f.clock.now()}]},before={devices:[{current:true,createdAt:paid.createdAt-1000}]};
 assert.equal((await a.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'abort',claim},verification:false,owner:after})).body.error,'owner_proof_required');
 const aborted=await a.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'abort',claim},verification:false,owner:before});assert.equal(aborted.status,200,JSON.stringify(aborted.body));assert.equal(aborted.body.claim.state,'aborted');
 await drain(f,org);assert.deepEqual((await a.call('GET','/api/orgs/break-glass')).body.items,[],'the interstitial item is gone once the claim ended');
 assert.equal(f.polar.effects.refunds.length>=1,true,'the paid claim is refunded');
});

test('runtime: the abort page and link need no sign-in, are single use, answer identically and have their own budget',async t=>{
 const f=await fixture(t),a=await f.person(),b=await f.person(),c=await f.person();
 await f.setEmail(a.id,'owner@owner-home.example');
 const org=(await a.call('POST','/api/orgs',{input:{request:'break-glass-runtime-0002',name:'Acme',label:'company'}})).body.organization.id;
 for(const x of [b,c]){const invite=await a.call('POST',`/api/orgs/${org}/invitations`,{input:{invitee:{iss:ORIGIN,sub:x.id},grants:[{power:'admin'}]}});await x.call('POST',`/api/orgs/${org}/accept`,{input:{invitation:invite.body.meta}});}
 f.clock.advance(31*DAY);await drain(f,org);
 const claim=(await b.call('POST',`/api/orgs/${org}/break-glass`,{input:{operation:'start',candidate:{sub:b.id},category:'owner-deceased',statement:'We were told the owner died.',confirm:true}})).body.claim.id;await drain(f,org);
 const link=new URL(f.mail.find(n=>n.event==='claim-started').abortUrl),fragment=new URLSearchParams(link.hash.slice(1)),token=fragment.get('token');assert.equal(fragment.get('org'),org);
 // GET shows a confirmation page and never changes anything (mail scanners), with strict headers.
 for(const lang of ['','?lang=es']){const page=await f.http(ORG_CLAIM_ABORT_PATH+lang);assert.equal(page.status,200);const html=await page.text();
  assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.match(page.headers.get('Content-Security-Policy'),/default-src 'none'/);assert.equal(page.headers.get('Referrer-Policy'),'no-referrer');assert.equal(page.headers.get('Cache-Control'),'no-store');assert.equal(page.headers.get('X-Frame-Options'),'DENY');assert.match(page.headers.get('X-Robots-Tag'),/noindex/);
  assert.match(html,lang?/Detener esta reclamación/:/Stop this claim/);assert.match(html,/<meta name="bindle-rendered" content="\d{13}\.[A-Za-z0-9_-]{43}">/);assert.ok(!/<script>/.test(html),'no inline script');assert.match(html,/<meta name="referrer" content="no-referrer">/);assert.ok(!html.includes(token));}
 assert.equal((await f.http(ORG_CLAIM_ABORT_PATH+'?token='+token)).status,400,'no capability in the query string');
 const script=await f.http(ORG_CLAIM_ABORT_PATH+'.mjs');assert.equal(script.status,200);assert.match(script.headers.get('Content-Type'),/javascript/);
 const source=orgClaimAbortScript();assert.match(source,/history\.replaceState/);assert.match(source,/credentials:'omit'/);assert.match(source,/event\.isTrusted/);assert.match(source,/userActivation/);
 assert.equal((await f.http(ORG_CLAIM_ABORT_PATH,{method:'POST',body:{}})).status,405);
 assert.equal((await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim.state,'gathering','opening the page changed nothing');
 // Review M2: the page carries a signed render time; the owner types the organization handle carried in the link.
 const handle=fragment.get('handle'),orgRecord=await f.repository.get(org);assert.equal(handle,orgRecord.handle,'the link names the organization by its public handle');
 const fresh=/<meta name="bindle-rendered" content="([^"]+)">/.exec(await (await f.http(ORG_CLAIM_ABORT_PATH)).text())[1];assert.match(fresh,/^\d{13}\.[A-Za-z0-9_-]{43}$/);
 const send=(body,ip,extra={})=>f.http(ORG_CLAIM_ABORT_API,{method:'POST',body,ip,...extra});
 assert.equal((await send({org,token,confirmed:handle,rendered:fresh},'192.0.2.30')).status,400,'a POST within 2 s of the render is refused (a scanner pressing at once)');
 assert.equal((await (await send({org,token,confirmed:handle,rendered:fresh},'192.0.2.30')).json()).error,'too_fast');
 const old=await orgClaimRenderStamp(f.secretEnv,Date.now()-3*3600000),rendered=await orgClaimRenderStamp(f.secretEnv,Date.now()-5000);
 assert.equal((await (await send({org,token,confirmed:handle,rendered:old},'192.0.2.31')).json()).error,'page_expired');
 assert.equal((await (await send({org,token,confirmed:handle,rendered:rendered.slice(0,-2)+'AA'},'192.0.2.31')).json()).error,'confirmation_required','a forged stamp is refused');
 assert.equal((await (await send({org,token,confirmed:'not-the-handle',rendered},'192.0.2.32')).json()).error,'confirmation_mismatch','the typed handle must match the organization');
 assert.equal((await send({org,token,confirmed:true,rendered},'192.0.2.32')).status,400,'a bare boolean is no longer a confirmation');
 assert.equal((await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim.state,'gathering','refused confirmations change nothing');
 // POST: cross-origin refused, wrong tokens identical to the real one, then single use.
 assert.equal((await send({org,token,confirmed:handle,rendered},'192.0.2.20',{origin:'https://evil.example'})).status,403);
 const answers=[];
 for(const body of [{org,token:token.slice(0,-3)+'AAA',confirmed:handle,rendered},{org:'12345678-1234-4234-8234-123456789abc',token,confirmed:'stop',rendered},{org,token:'bg1.not-a-token',confirmed:handle,rendered}]){const r=await send(body,'192.0.2.21');answers.push([r.status,await r.text()]);}
 assert.equal((await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim.state,'gathering','wrong tokens change nothing');
 // Review L1: four refusals from one address, then the owner's valid stop from the same address, which is not charged:
 // one more refusal still passes and only the sixth charge is refused.
 const ip='198.51.100.7',statuses=[];
 for(let i=0;i<4;i++)statuses.push((await send({org,token:token.slice(0,-4)+'BBB'+i,confirmed:handle,rendered},ip)).status);
 const real=await send({org,token,confirmed:'@'+handle.toUpperCase(),rendered},ip);answers.push([real.status,await real.text()]);
 const ended=(await a.call('GET',`/api/orgs/${org}/break-glass`)).body.claim;assert.equal(ended.state,'aborted');assert.equal(ended.closedReason,'owner','tier 0 from the email channel');
 const replay=await send({org,token,confirmed:handle,rendered},ip);answers.push([replay.status,await replay.text()]);
 statuses.push((await send({org,token,confirmed:handle,rendered},ip)).status);
 assert.equal(new Set(answers.map(x=>JSON.stringify(x))).size,1,'used, unknown, forged and valid tokens answer identically: '+JSON.stringify(answers));assert.deepEqual(answers[0],[200,'{"received":true}']);
 assert.deepEqual(statuses,[200,200,200,200,429],'refusals and the replay are charged; the valid stop was not');
 assert.equal((await send({org,token,confirmed:handle,rendered},'203.0.113.9')).status,200,'another network keeps its own budget');
 // IPv6: addresses in one /64 share the per-address budget; another /64 does not.
 const six=[];for(let i=1;i<=6;i++)six.push((await send({org,token,confirmed:handle,rendered},`2001:db8:1:2::${i}`)).status);
 assert.deepEqual(six,[200,200,200,200,200,429],'rotating addresses inside one /64 does not reset the budget');
 assert.equal((await send({org,token,confirmed:handle,rendered},'2001:db8:1:3::1')).status,200);
 // Review L2: every POST past the budget takes at least the floor, valid or not.
 const t0=Date.now();await send({org,token,confirmed:handle,rendered},'192.0.2.99');assert.ok(Date.now()-t0>=POST_FLOOR_MS-5);
});
