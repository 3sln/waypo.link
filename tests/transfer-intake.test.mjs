import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/src/index.js';
import {IdentityService} from '../packages/identity/service.mjs';
import {TransferEnrollmentAction} from '../packages/identity/transfer-enrollment.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';
const OWNER='11111111-1111-4111-8111-111111111111',context={origin:'https://dest.example',remoteIP:'127.0.0.1'},input={package:{sub:OWNER,test:true},method:'password',password:'a sufficiently long password',turnstileToken:'proof',termsAccepted:true,termsVersion:'v1',ageConfirmed:20};
function fixture({contact=false,challenge=true}={}){
 let account=null,seq=0;const calls=[],repository={async get(){return structuredClone(account);},async findByEmail(){return null;},async compareAndSwap(id,revision,value){if(account?.revision!==revision)return false;account=structuredClone(value);return true;}};
 const identity={setupSendAdmission:IdentityService.prototype.setupSendAdmission,repository,config:{origin:context.origin,termsVersion:'v1',requireReachability:contact},clock:()=>1000,crypto:{random:()=>String(++seq),hash:async(domain,value)=>domain+':'+value},origin(ctx){assert.equal(ctx.origin,context.origin);},async guard(){calls.push('challenge');if(!challenge)throw Object.assign(Error('challenge'),{code:'challenge_failed'});},ageAttestation(){return {ageMinimum:16};},passwordHasher:{hash:async value=>'hash:'+value,verify:async(value,hash)=>hash==='hash:'+value},rateLimiter:{async check(){calls.push('admission');return true;}},audit(){},async save(value,revision){value.revision=revision+1;if(!await repository.compareAndSwap(value.id,revision,value))throw Object.assign(Error('conflict'),{code:'conflict'});},async requireSetupChannel(value){if(contact&&!value.verifiedEmail)throw Object.assign(Error('contact'),{code:'contact_required'});},mailer:{async sendSetupCode(value){calls.push(value);}}};
 const ports={async check(){calls.push('check');return {sub:OWNER,kind:'person'};},async reserve(){calls.push('reserve');account??={id:OWNER,status:'pending-transfer',revision:0,credentials:[],transferIn:{reservation:'r'}};return {sub:OWNER,reservation:'r'};},async begin(){calls.push('import');return {state:'awaiting-source'};},async status(){return {state:'pending'};},async cancel(){return {state:'cancelled'};}};
 const engine=new Engine({providers:{identity:Provider.fromSingleton(identity)}}),run=async(method,value)=>{const feed=engine.dispatch(new TransferEnrollmentAction(method,value,context,ports));let result;feed.addEventListener('result',event=>result=event.detail);await feed.next('complete');return result;};
 return {run,calls,repository,identity,ports,get account(){return account;}};
}
test('intake engine proves credential, CAPTCHA and admission before importing keys; receipt grants only move operations',async()=>{
 const x=fixture(),result=await x.run('start',input);assert.deepEqual(x.calls,['challenge','check','admission','reserve','import']);assert.equal(result.sessionToken,undefined);assert.equal(x.account.passwordHash,'hash:'+input.password);assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});await assert.rejects(x.run('status',{transferToken:OWNER+'.wrong'}),{code:'unauthorized'});assert.equal((await x.run('start',input)).resumed,true);
});
test('failed challenge and asserted client enrollment never reserve or import',async()=>{
 const x=fixture({challenge:false});await assert.rejects(x.run('start',input),{code:'challenge_failed'});assert.deepEqual(x.calls,['challenge']);await assert.rejects(x.run('start',{...input,enrolled:true}),{code:'invalid_request'});
});
test('reachability gates custody; server-issued email proof unlocks retry, rejects replay and invalid code',async()=>{
 const x=fixture({contact:true}),result=await x.run('start',input),receipt={transferToken:result.transferToken};assert.equal(result.contactRequired,true);assert(!x.calls.includes('import'));await assert.rejects(x.run('retry',{...receipt,package:input.package}),{code:'contact_required'});await x.run('email-start',{...receipt,email:'user@example.example'});const mail=x.calls.find(value=>value?.code);await assert.rejects(x.run('email-confirm',{...receipt,code:mail.code==='00000000'?'11111111':'00000000'}),{code:'invalid_challenge'});await x.run('email-confirm',{...receipt,code:mail.code});await assert.rejects(x.run('email-confirm',{...receipt,code:mail.code}),{code:'invalid_challenge'});await x.run('retry',{...receipt,package:input.package});assert.equal(x.calls.at(-1),'import');
});
test('seeded concurrent enrollment has one credential winner and at most one key import',async()=>{
 await forEachSeed(12,async random=>{const x=fixture(),scheduler=createScheduler(random);x.identity.repository=scheduler.wrap(x.repository,'repository');const results=await scheduler.run([()=>x.run('start',input),()=>x.run('start',{...input,password:'another sufficiently long password'})]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(x.calls.filter(value=>value==='import').length,1);});
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
 const x=fixture(),result=await x.run('start',input);await assert.rejects(x.run('status',{transferToken:'22222222-2222-4222-8222-222222222222.'+result.transferToken.split('.')[1]}),{code:'unauthorized'});
 // This repository fixture deliberately returns the row for every lookup: the verifier must bind its ID too.
 x.identity.clock=()=>45*86400000+1000;await assert.rejects(x.run('status',{transferToken:result.transferToken}),{code:'unauthorized'});await assert.rejects(x.run('retry',{transferToken:result.transferToken,package:input.package}),{code:'unauthorized'});
});
test('an import response failure preserves the restricted receipt for an authenticated retry',async()=>{
 const x=fixture();let attempts=0;x.ports.begin=async()=>{attempts++;if(attempts===1)throw Object.assign(Error('lost response'),{code:'temporarily_unavailable'});return {state:'awaiting-source'};};
 const result=await x.run('start',input);assert.equal(result.retry,true);assert.equal(result.error,'temporarily_unavailable');assert(result.transferToken);assert.deepEqual(await x.run('retry',{transferToken:result.transferToken,package:input.package}),{state:'awaiting-source'});assert.equal(attempts,2);
});
test('form and API method allowlist is explicit, and public GET never consumes a package',async()=>{
 const {allowedMethods,stages}=await import('../packages/runtime/routes/transfer-in.mjs');assert.deepEqual(allowedMethods('/api/transfer-in/start'),['POST']);assert.equal(allowedMethods('/api/transfer-in/unknown'),null);
 const env={flags:{for:()=>({global:()=>true})},TRANSFER_IN_INTAKE:{}};
 const response=await stages.public({env,path:'/bindle/portability/transfer-in',request:new Request(context.origin+'/bindle/portability/transfer-in')});assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'POST');
 const query=await stages.unauthenticated({env,path:'/api/transfer-in/status',request:new Request(context.origin+'/api/transfer-in/status?transferToken=secret')});assert.equal(query.status,404);
});
test('transfer receipts outlive both source delay paths and expire at 45 days',async()=>{
 const x=fixture(),result=await x.run('start',input);for(const days of [1.1,8,44.9]){x.identity.clock=()=>1000+days*86400000;assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});}x.identity.clock=()=>1000+45*86400000;await assert.rejects(x.run('status',{transferToken:result.transferToken}),{code:'unauthorized'});
});
test('a lost reply after enrollment save resumes with CAPTCHA and the same credential, without overwriting password or spending admission again',async()=>{
 const x=fixture(),save=x.identity.save.bind(x.identity);let lose=true;x.identity.save=async(...args)=>{await save(...args);if(lose){lose=false;throw Object.assign(Error('lost HTTP response'),{code:'temporarily_unavailable'});}};
 await assert.rejects(x.run('start',input),{code:'temporarily_unavailable'});const originalHash=x.account.passwordHash;
 await assert.rejects(x.run('start',{...input,password:'a different long enough password'}),{code:'intake_conflict'});await assert.rejects(x.run('start',{...input,package:{...input.package,test:false}}),{code:'intake_conflict'});
 // The source is now unavailable or has already moved; resume must use the package binding saved at enrollment.
 x.ports.check=async()=>{throw Error('source moved');};x.identity.clock=()=>1000+8*86400000;
 const result=await x.run('start',input);assert.equal(result.resumed,true);assert.equal(x.account.passwordHash,originalHash);assert.equal(x.calls.filter(value=>value==='admission').length,1);assert.equal(x.calls.filter(value=>value==='reserve').length,1);assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});
});
test('authenticated receipt renewal preserves the verified-contact requirement and revokes the prior receipt',async()=>{
 const x=fixture({contact:true}),first=await x.run('start',input),renewed=await x.run('start',input);assert.equal(renewed.contactRequired,true);assert.equal(renewed.resumed,true);assert(!x.calls.includes('import'));await assert.rejects(x.run('status',{transferToken:first.transferToken}),{code:'unauthorized'});assert.deepEqual(await x.run('status',{transferToken:renewed.transferToken}),{state:'pending'});
});

test('intake email enrollment shares the existing per-account cooldown and send ceiling',async()=>{const x=fixture({contact:true}),result=await x.run('start',input),receipt={transferToken:result.transferToken};let now=1000;x.identity.clock=()=>now;await x.run('email-start',{...receipt,email:'one@example.example'});await assert.rejects(x.run('email-start',{...receipt,email:'two@example.example'}),{code:'rate_limited'});now+=60000;await x.run('email-start',{...receipt,email:'two@example.example'});now+=60000;await x.run('email-start',{...receipt,email:'three@example.example'});now+=60000;await assert.rejects(x.run('email-start',{...receipt,email:'four@example.example'}),{code:'rate_limited'});});
