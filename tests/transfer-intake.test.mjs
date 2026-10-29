import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/src/index.js';
import {IdentityService} from '../packages/identity/service.mjs';
import {TransferEnrollmentAction} from '../packages/identity/transfer-enrollment.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';
import {confirmedEmails} from '../packages/identity/emails.mjs';
const OWNER='11111111-1111-4111-8111-111111111111',context={origin:'https://dest.example',remoteIP:'127.0.0.1'},input={package:{sub:OWNER,test:true},method:'passkey',turnstileToken:'proof',termsAccepted:true,termsVersion:'v1',ageConfirmed:20};
// Passwords were dropped (owner approval 2026-10-28): a move enrolls with a passkey (transfer-intake-passkey.test.mjs covers the
// ceremony itself). `enroll` runs both phases: registration for a new identity, or an assertion resuming an enrolled one.
// `foreign` models another device racing the enrollment: it can only answer a resume with its own (unregistered) credential.
const enroll=async(x,{id='cred-1',pkg=input.package,foreign=false}={})=>{const o=await x.run('passkey-options',{...input,package:pkg});return x.run('start',{method:'passkey',package:pkg,passkeyTicket:o.passkeyTicket,response:o.resume?{id:foreign?id:x.account.credentials[0].id,challenge:o.authenticationOptions.challenge}:{id,challenge:o.registrationOptions.challenge}});};
function fixture({contact=false,challenge=true}={}){
 let account=null,seq=0;const calls=[],repository={async get(){return structuredClone(account);},async findByEmail(){return null;},async compareAndSwap(id,revision,value){if(account?.revision!==revision)return false;account=structuredClone(value);return true;}};
 const identity={setupSendAdmission:IdentityService.prototype.setupSendAdmission,repository,config:{origin:context.origin,termsVersion:'v1',requireReachability:contact},clock:()=>1000,crypto:{random:()=>String(++seq),hash:async(domain,value)=>domain+':'+value},origin(ctx){assert.equal(ctx.origin,context.origin);},async guard(){calls.push('challenge');if(!challenge)throw Object.assign(Error('challenge'),{code:'challenge_failed'});},ageAttestation(){return {ageMinimum:16};},webauthn:{async registrationOptions({account}){return {challenge:'reg-'+(++seq),user:{id:account.id}};},async verifyRegistration({response,challenge}){if(response.challenge!==challenge)throw Error('invalid');return {id:response.id,publicKey:'pk-'+response.id,counter:0};},async authenticationOptions(){return {challenge:'auth-'+(++seq)};},async verifyAuthentication({response,challenge,credential}){if(response.challenge!==challenge||response.id!==credential.id)throw Error('invalid');return {counter:(credential.counter??0)+1};}},rateLimiter:{async check(){calls.push('admission');return true;}},audit(){},async save(value,revision){value.revision=revision+1;if(!await repository.compareAndSwap(value.id,revision,value))throw Object.assign(Error('conflict'),{code:'conflict'});},async requireSetupChannel(value){if(contact&&!confirmedEmails(value).length)throw Object.assign(Error('contact'),{code:'contact_required'});},mailer:{async sendSetupCode(value){calls.push(value);}}};
 const ports={async check(){calls.push('check');return {sub:OWNER,kind:'person'};},async reserve(){calls.push('reserve');account??={id:OWNER,status:'pending-transfer',revision:0,credentials:[],transferIn:{reservation:'r'}};return {sub:OWNER,reservation:'r'};},async begin(){calls.push('import');return {state:'awaiting-source'};},async status(){return {state:'pending'};},async cancel(){return {state:'cancelled'};}};
 const engine=new Engine({providers:{identity:Provider.fromSingleton(identity)}}),run=async(method,value)=>{const feed=engine.dispatch(new TransferEnrollmentAction(method,value,context,ports));let result;feed.addEventListener('result',event=>result=event.detail);await feed.next('complete');return result;};
 return {run,calls,repository,identity,ports,get account(){return account;}};
}
test('intake engine proves credential, CAPTCHA and admission before importing keys; receipt grants only move operations',async()=>{
 const x=fixture(),result=await enroll(x);assert.deepEqual(x.calls,['challenge','check','admission','reserve','import']);assert.equal(result.sessionToken,undefined);assert.equal(x.account.passwordHash,undefined);assert.deepEqual(x.account.credentials.map(c=>c.id),['cred-1']);assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});await assert.rejects(x.run('status',{transferToken:OWNER+'.wrong'}),{code:'unauthorized'});assert.equal((await enroll(x)).resumed,true);
});
test('failed challenge and asserted client enrollment never reserve or import',async()=>{
 const x=fixture({challenge:false});await assert.rejects(enroll(x),{code:'challenge_failed'});assert.deepEqual(x.calls,['challenge']);await assert.rejects(x.run('passkey-options',{...input,enrolled:true}),{code:'invalid_request'});await assert.rejects(x.run('start',{method:'passkey',package:input.package,passkeyTicket:OWNER+'.t',response:{},enrolled:true}),{code:'invalid_request'});
 // A password enrollment is refused before any gate (passwords dropped 2026-10-28).
 await assert.rejects(x.run('start',{...input,method:'password',password:'a sufficiently long password'}),{code:'invalid_method'});assert.deepEqual(x.calls,['challenge']);assert.equal(x.account,null);
});
test('reachability gates custody; server-issued email proof unlocks retry, rejects replay and invalid code',async()=>{
 const x=fixture({contact:true}),result=await enroll(x),receipt={transferToken:result.transferToken};assert.equal(result.contactRequired,true);assert(!x.calls.includes('import'));await assert.rejects(x.run('retry',{...receipt,package:input.package}),{code:'contact_required'});await x.run('email-start',{...receipt,email:'user@example.example'});const mail=x.calls.find(value=>value?.code);await assert.rejects(x.run('email-confirm',{...receipt,code:mail.code==='00000000'?'11111111':'00000000'}),{code:'invalid_challenge'});await x.run('email-confirm',{...receipt,code:mail.code});await assert.rejects(x.run('email-confirm',{...receipt,code:mail.code}),{code:'invalid_challenge'});await x.run('retry',{...receipt,package:input.package});assert.equal(x.calls.at(-1),'import');
});
test('seeded concurrent enrollment has one credential winner and at most one key import',async()=>{
 await forEachSeed(12,async random=>{const x=fixture(),scheduler=createScheduler(random);x.identity.repository=scheduler.wrap(x.repository,'repository');const results=await scheduler.run([()=>enroll(x,{id:'cred-a',foreign:true}),()=>enroll(x,{id:'cred-b',foreign:true})]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(x.account.credentials.length,1);assert.equal(x.calls.filter(value=>value==='import').length,1);});
});

test('form handoff is transient, escaped, bounded, exact-field and credential-query free',async()=>{
 const {stages}=await import('../packages/runtime/routes/transfer-in.mjs');let boot;
 const env={APP_ORIGIN:context.origin,flags:{for:()=>({global:()=>true})},TRANSFER_IN_INTAKE:{},TRANSFER_IN_DOCUMENT:async value=>{boot=value.packageJSON;return new Response('<html></html>');}};
 const route=async(text,{query='',type='application/x-www-form-urlencoded'}={})=>stages.public({env,path:'/bindle/portability/transfer-in',request:new Request(context.origin+'/bindle/portability/transfer-in'+query,{method:'POST',headers:{'Content-Type':type},body:text})});
 let response=await route(new URLSearchParams({package:JSON.stringify({value:'</script><script>alert(1)</script>'})}).toString());assert.equal(response.status,200);assert(!boot.includes('<'));assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert(response.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
 assert.equal((await route('package={}&extra=true')).status,400);assert.equal((await route('package={}&package={}')).status,400);assert.equal((await route('package={}',{query:'?token=secret'})).status,404);assert.equal((await route('package='+('x'.repeat(1048576)))).status,413);assert.equal((await route('{}',{type:'application/json'})).status,400);
 assert.equal((await stages.public({env:{...env,flags:{for:()=>({global:()=>false,evaluate:()=>({value:false}),envState:()=>({state:'unset'})})}},path:'/bindle/portability/transfer-in',request:new Request(context.origin+'/bindle/portability/transfer-in')})).status,404);
});

test('expired or wrong-owner transfer receipts cannot query status or retry imports',async()=>{
 const x=fixture(),result=await enroll(x);await assert.rejects(x.run('status',{transferToken:'22222222-2222-4222-8222-222222222222.'+result.transferToken.split('.')[1]}),{code:'unauthorized'});
 // This repository fixture deliberately returns the row for every lookup: the verifier must bind its ID too.
 x.identity.clock=()=>45*86400000+1000;await assert.rejects(x.run('status',{transferToken:result.transferToken}),{code:'unauthorized'});await assert.rejects(x.run('retry',{transferToken:result.transferToken,package:input.package}),{code:'unauthorized'});
});
test('an import response failure preserves the restricted receipt for an authenticated retry',async()=>{
 const x=fixture();let attempts=0;x.ports.begin=async()=>{attempts++;if(attempts===1)throw Object.assign(Error('lost response'),{code:'temporarily_unavailable'});return {state:'awaiting-source'};};
 const result=await enroll(x);assert.equal(result.retry,true);assert.equal(result.error,'temporarily_unavailable');assert(result.transferToken);assert.deepEqual(await x.run('retry',{transferToken:result.transferToken,package:input.package}),{state:'awaiting-source'});assert.equal(attempts,2);
});
test('form and API method allowlist is explicit, and public GET never consumes a package',async()=>{
 const {allowedMethods,stages}=await import('../packages/runtime/routes/transfer-in.mjs');assert.deepEqual(allowedMethods('/api/transfer-in/start'),['POST']);assert.equal(allowedMethods('/api/transfer-in/unknown'),null);
 const env={flags:{for:()=>({global:()=>true})},TRANSFER_IN_INTAKE:{}};
 const response=await stages.public({env,path:'/bindle/portability/transfer-in',request:new Request(context.origin+'/bindle/portability/transfer-in')});assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'POST');
 const query=await stages.unauthenticated({env,path:'/api/transfer-in/status',request:new Request(context.origin+'/api/transfer-in/status?transferToken=secret')});assert.equal(query.status,404);
});
test('transfer receipts outlive both source delay paths and expire at 45 days',async()=>{
 const x=fixture(),result=await enroll(x);for(const days of [1.1,8,44.9]){x.identity.clock=()=>1000+days*86400000;assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});}x.identity.clock=()=>1000+45*86400000;await assert.rejects(x.run('status',{transferToken:result.transferToken}),{code:'unauthorized'});
});
test('a lost reply after enrollment save resumes with CAPTCHA and the same credential, without replacing it or spending admission again',async()=>{
 const x=fixture(),save=x.identity.save.bind(x.identity);let lose=false;x.identity.save=async(...args)=>{await save(...args);if(lose){lose=false;throw Object.assign(Error('lost HTTP response'),{code:'temporarily_unavailable'});}};
 const o=await x.run('passkey-options',input);lose=true;await assert.rejects(x.run('start',{method:'passkey',package:input.package,passkeyTicket:o.passkeyTicket,response:{id:'cred-1',challenge:o.registrationOptions.challenge}}),{code:'temporarily_unavailable'});const original=structuredClone(x.account.credentials);assert.equal(original.length,1);
 await assert.rejects(x.run('start',{...input,method:'password',password:'a different long enough password'}),{code:'invalid_method'});await assert.rejects(x.run('passkey-options',{...input,package:{...input.package,test:false}}),{code:'intake_conflict'});
 // The source is now unavailable or has already moved; resume must use the package binding saved at enrollment.
 x.ports.check=async()=>{throw Error('source moved');};x.identity.clock=()=>1000+8*86400000;
 const result=await enroll(x,{id:'cred-other'});assert.equal(result.resumed,true);assert.deepEqual(x.account.credentials.map(c=>c.id),original.map(c=>c.id));assert.equal(x.calls.filter(value=>value==='admission').length,1);assert.equal(x.calls.filter(value=>value==='reserve').length,1);assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});
});
test('authenticated receipt renewal preserves the verified-contact requirement and revokes the prior receipt',async()=>{
 const x=fixture({contact:true}),first=await enroll(x),renewed=await enroll(x);assert.equal(renewed.contactRequired,true);assert.equal(renewed.resumed,true);assert(!x.calls.includes('import'));await assert.rejects(x.run('status',{transferToken:first.transferToken}),{code:'unauthorized'});assert.deepEqual(await x.run('status',{transferToken:renewed.transferToken}),{state:'pending'});
});

test('intake email enrollment shares the existing per-account cooldown and send ceiling',async()=>{const x=fixture({contact:true}),result=await enroll(x),receipt={transferToken:result.transferToken};let now=1000;x.identity.clock=()=>now;await x.run('email-start',{...receipt,email:'one@example.example'});await assert.rejects(x.run('email-start',{...receipt,email:'two@example.example'}),{code:'rate_limited'});now+=60000;await x.run('email-start',{...receipt,email:'two@example.example'});now+=60000;await x.run('email-start',{...receipt,email:'three@example.example'});now+=60000;await assert.rejects(x.run('email-start',{...receipt,email:'four@example.example'}),{code:'rate_limited'});});
