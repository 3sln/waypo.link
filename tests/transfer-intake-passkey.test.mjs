// Feature 4: passkey enrollment at transfer-in (packages/identity/transfer-enrollment.mjs), engine level.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/src/index.js';
import {TransferEnrollmentAction} from '../packages/identity/transfer-enrollment.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const context={origin:'https://dest.example',remoteIP:'127.0.0.1'};
const gates={method:'passkey',turnstileToken:'proof',termsAccepted:true,termsVersion:'v1',ageConfirmed:20};
const pkgOf=sub=>({sub,test:true});
// A WebAuthn adapter with the real adapter's contract: it verifies the response against the challenge it is given and
// the service config's origin and RP ID (as @simplewebauthn/server does in packages/identity/webauthn.mjs).
function fakeWebAuthn(){
 let n=0;const issued=[];
 return {issued,
  async registrationOptions({account,config}){const challenge='reg-'+(++n);issued.push({challenge,userID:account.id,rpID:config.rpID});return {challenge,rp:{id:config.rpID},user:{id:account.id}};},
  async verifyRegistration({response,challenge,config}){if(response.challenge!==challenge||response.origin!==config.origin||response.rpID!==config.rpID||response.userID===undefined)throw Error('invalid');return {id:response.id,publicKey:'pk-'+response.id,counter:0,transports:['internal']};},
  async authenticationOptions({config}){const challenge='auth-'+(++n);return {challenge,rpId:config.rpID};},
  async verifyAuthentication({response,challenge,credential,account,config}){if(response.challenge!==challenge||response.origin!==config.origin||response.rpID!==config.rpID||response.id!==credential.id||response.userHandle!==account.id)throw Error('invalid');return {counter:(credential.counter??0)+1,backedUp:false};},
 };
}
const attest=(options,{id='cred-1',origin=context.origin,rpID='dest.example',challenge=options.challenge}={})=>({id,challenge,origin,rpID,userID:options.user?.id});
const assertion=(options,account,{id='cred-1',origin=context.origin,rpID='dest.example'}={})=>({id,challenge:options.challenge,origin,rpID,userHandle:account});
function fixture({contact=false,webauthn=fakeWebAuthn()}={}){
 const rows=new Map(),calls=[];let seq=0;
 const repository={async get(id){return structuredClone(rows.get(id)??null);},async findByEmail(){return null;},async compareAndSwap(id,revision,value){if((rows.get(id)?.revision)!==revision)return false;rows.set(id,structuredClone(value));return true;}};
 const identity={repository,webauthn,config:{origin:context.origin,rpID:'dest.example',termsVersion:'v1',requireReachability:contact},clock:()=>1000,crypto:{random:()=>'t'+(++seq),hash:async(domain,value)=>domain+':'+value},
  origin(ctx){assert.equal(ctx.origin,context.origin);},async guard(){calls.push('challenge');},ageAttestation(){return {ageMinimum:16};},
  passwordHasher:{hash:async value=>'hash:'+value,verify:async(value,hash)=>hash==='hash:'+value},rateLimiter:{async check(){calls.push('admission');return true;}},audit(){},
  async save(value,revision){value.revision=revision+1;if(!await repository.compareAndSwap(value.id,revision,value))throw Object.assign(Error('conflict'),{code:'conflict'});},
  async requireSetupChannel(value){if(contact&&!value.verifiedEmail)throw Object.assign(Error('contact'),{code:'contact_required'});}};
 const ports={async check({package:p}){calls.push('check');return {sub:p.sub,kind:'person'};},async reserve({package:p}){calls.push('reserve');if(!rows.has(p.sub))rows.set(p.sub,{id:p.sub,handle:'h-'+p.sub.slice(0,4),status:'pending-transfer',revision:0,credentials:[],transferIn:{reservation:'r-'+p.sub.slice(0,4)}});return {sub:p.sub,reservation:'r-'+p.sub.slice(0,4)};},
  async begin(){calls.push('import');return {state:'awaiting-source'};},async status(){return {state:'pending'};},async cancel(){return {state:'cancelled'};}};
 const engine=new Engine({providers:{identity:Provider.fromSingleton(identity)}});
 const run=async(method,value)=>{const feed=engine.dispatch(new TransferEnrollmentAction(method,value,context,ports));let result;feed.addEventListener('result',event=>result=event.detail);await feed.next('complete');return result;};
 return {run,calls,rows,identity,ports,webauthn};
}
const options=(x,sub=OWNER)=>x.run('passkey-options',{...gates,package:pkgOf(sub)});
const finish=(x,opts,extra={},sub=OWNER)=>x.run('start',{method:'passkey',package:pkgOf(sub),passkeyTicket:opts.passkeyTicket,response:attest(opts.registrationOptions,extra),...extra.label?{label:extra.label}:{}});

test('passkey intake: gates before reservation, challenge bound to the transfer, credential stored without a password',async()=>{
 const x=fixture(),opts=await options(x);
 assert.deepEqual(x.calls,['challenge','check','admission','reserve']);assert.equal(opts.registrationOptions.user.id,OWNER);assert.equal(opts.passkeyTicket.split('.')[0],OWNER);
 const pending=x.rows.get(OWNER);assert.equal(pending.transferPasskey.value,opts.registrationOptions.challenge);assert.notEqual(pending.transferPasskey.hash,opts.passkeyTicket,'only a hash of the ticket is stored');assert.equal(pending.credentials.length,0);assert.equal(pending.transferEnrollment,undefined,'no receipt before the credential is proven');
 const result=await finish(x,opts,{label:'Laptop'});
 assert.equal(result.owner,OWNER);assert.deepEqual(result.transfer,{state:'awaiting-source'});assert.equal(result.sessionToken,undefined);
 const account=x.rows.get(OWNER);assert.equal(account.passwordHash,undefined);assert.equal(account.credentials.length,1);assert.equal(account.credentials[0].id,'cred-1');assert.equal(account.credentials[0].label,'Laptop');assert.equal(account.transferEnrollment.method,'passkey');assert.equal(account.transferPasskey,undefined);assert.equal(account.termsVersion,'v1');assert.equal(account.ageMinimum,16);
 assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});assert.equal(x.calls.filter(c=>c==='import').length,1);
});

test('passkey intake refuses a replayed challenge, a foreign ticket, another identity and a wrong origin or RP ID',async()=>{
 const x=fixture(),opts=await options(x);
 // Wrong origin and wrong RP ID fail verification, and the failed attempt spends the challenge.
 await assert.rejects(finish(x,opts,{origin:'https://evil.example'}),{code:'invalid_passkey'});assert.equal(x.rows.get(OWNER).transferPasskey.value,null);assert.equal(x.rows.get(OWNER).credentials.length,0);
 await assert.rejects(finish(x,opts),{code:'invalid_challenge'},'a spent challenge is never reusable');
 const again=await options(x);assert.equal(x.calls.filter(c=>c==='reserve').length,1,'an abandoned ceremony gets a fresh challenge without reserving again');assert.equal(x.calls.filter(c=>c==='admission').length,1);
 await assert.rejects(finish(x,again,{rpID:'evil.example'}),{code:'invalid_passkey'});
 const third=await options(x);
 // A ticket presented for another identity's package, a forged ticket and a response to another challenge.
 await assert.rejects(x.run('start',{method:'passkey',package:pkgOf(OTHER),passkeyTicket:third.passkeyTicket,response:attest(third.registrationOptions)}),{code:'invalid_challenge'});
 await assert.rejects(x.run('start',{method:'passkey',package:pkgOf(OWNER),passkeyTicket:OWNER+'.forged',response:attest(third.registrationOptions)}),{code:'invalid_challenge'});
 await assert.rejects(x.run('start',{method:'passkey',package:{...pkgOf(OWNER),test:false},passkeyTicket:third.passkeyTicket,response:attest(third.registrationOptions)}),{code:'invalid_challenge'});
 const ok=await finish(x,third);assert.equal(ok.owner,OWNER);
 // Replaying the successful registration is refused: the challenge is gone and a receipt now exists.
 await assert.rejects(finish(x,third),{code:'invalid_challenge'});assert.equal(x.rows.get(OWNER).credentials.length,1);
 // Another identity's challenge cannot complete this one, even with a valid response for that other challenge.
 const other=await options(x,OTHER);
 await assert.rejects(x.run('start',{method:'passkey',package:pkgOf(OWNER),passkeyTicket:other.passkeyTicket,response:attest(other.registrationOptions)}),{code:'invalid_challenge'});
 assert.equal((await finish(x,other,{},OTHER)).owner,OTHER);
});

test('passkey intake: expired challenge, extra fields and an unattested source without confirmation are refused',async()=>{
 const x=fixture(),opts=await options(x);x.identity.clock=()=>1000+300000;
 await assert.rejects(finish(x,opts),{code:'invalid_challenge'});
 await assert.rejects(x.run('passkey-options',{...gates,package:pkgOf(OWNER),password:'a sufficiently long password'}),{code:'invalid_request'});
 await assert.rejects(x.run('start',{method:'passkey',package:pkgOf(OWNER),passkeyTicket:opts.passkeyTicket,response:{},enrolled:true}),{code:'invalid_request'});
 const y=fixture();y.ports.check=async()=>({sub:OWNER,kind:'person',mode:'unattested'});
 await assert.rejects(options(y),{code:'unattested_confirmation_required'});assert(!y.calls.includes('reserve'));
 const z=fixture({webauthn:{}});await assert.rejects(options(z),{code:'passkey_unavailable'});assert(!z.calls.includes('reserve'));
});

test('a lost reply after passkey enrollment resumes only with a passkey assertion, never a password, and is idempotent',async()=>{
 const x=fixture();let lose=false;const save=x.identity.save.bind(x.identity);x.identity.save=async(...args)=>{await save(...args);if(lose){lose=false;throw Object.assign(Error('lost HTTP response'),{code:'temporarily_unavailable'});}};
 const opts=await options(x);lose=true;await assert.rejects(finish(x,opts),{code:'temporarily_unavailable'});
 const enrolled=x.rows.get(OWNER);assert.equal(enrolled.credentials.length,1);
 // A password start cannot take over a passkey enrollment.
 await assert.rejects(x.run('start',{...gates,method:'password',password:'a sufficiently long password',package:pkgOf(OWNER)}),{code:'intake_conflict'});
 const resume=await options(x);assert.equal(resume.resume,true);assert(resume.authenticationOptions.challenge);
 await assert.rejects(x.run('start',{method:'passkey',package:pkgOf(OWNER),passkeyTicket:resume.passkeyTicket,response:assertion(resume.authenticationOptions,OTHER)}),{code:'invalid_passkey'});
 await assert.rejects(x.run('start',{method:'passkey',package:pkgOf(OWNER),passkeyTicket:resume.passkeyTicket,response:assertion(resume.authenticationOptions,OWNER)}),{code:'invalid_challenge'},'a failed assertion spends the challenge');
 const next=await options(x),result=await x.run('start',{method:'passkey',package:pkgOf(OWNER),passkeyTicket:next.passkeyTicket,response:assertion(next.authenticationOptions,OWNER)});
 assert.equal(result.resumed,true);assert.equal(x.rows.get(OWNER).credentials.length,1);assert.equal(x.rows.get(OWNER).credentials[0].counter,1);assert.equal(x.calls.filter(c=>c==='reserve').length,1);assert.equal(x.calls.filter(c=>c==='admission').length,1);
 assert.deepEqual(await x.run('status',{transferToken:result.transferToken}),{state:'pending'});
});

test('reachability gate applies to passkey enrollment exactly as to password enrollment',async()=>{
 const x=fixture({contact:true}),opts=await options(x),result=await finish(x,opts);
 assert.equal(result.contactRequired,true);assert(!x.calls.includes('import'));
});

test('password path is unchanged, and a password start supersedes an abandoned passkey challenge on the same reservation',async()=>{
 const x=fixture();await options(x);
 const result=await x.run('start',{...gates,method:'password',password:'a sufficiently long password',package:pkgOf(OWNER)});
 assert.deepEqual(result.transfer,{state:'awaiting-source'});const account=x.rows.get(OWNER);assert.equal(account.passwordHash,'hash:a sufficiently long password');assert.equal(account.transferPasskey,undefined);assert.equal(account.credentials.length,0);
 assert.equal((await x.run('start',{...gates,method:'password',password:'a sufficiently long password',package:pkgOf(OWNER)})).resumed,true);
 await assert.rejects(options(x),{code:'intake_conflict'},'a password enrollment cannot be resumed through the passkey path');
});

test('seeded concurrent passkey and password enrollment of one identity yields one credential kind and one import',async()=>{
 await forEachSeed(12,async random=>{
  const x=fixture(),opts=await options(x),scheduler=createScheduler(random);x.identity.repository=scheduler.wrap(x.identity.repository,'repository');
  const results=await scheduler.run([()=>finish(x,opts),()=>finish(x,opts),()=>x.run('start',{...gates,method:'password',password:'a sufficiently long password',package:pkgOf(OWNER)})]);
  const account=x.rows.get(OWNER),winners=results.filter(r=>r.status==='fulfilled');
  assert(winners.length>=1);assert.equal(Boolean(account.passwordHash)&&account.credentials.length>0,false,'never both a password and a passkey from racing enrollments');
  assert.equal(x.calls.filter(c=>c==='import').length,winners.filter(r=>!r.value.resumed).length);
  assert(x.calls.filter(c=>c==='import').length<=2);
 });
});

test('the passkey options route is POST-only, flag-gated like start and needs the app origin',async()=>{
 const {allowedMethods,stages}=await import('../packages/runtime/routes/transfer-in.mjs');
 assert.deepEqual(allowedMethods('/api/transfer-in/passkey-options'),['POST']);
 const off={flags:{for:()=>({global:()=>false,evaluate:()=>({value:false}),envState:()=>({state:'unset'})})},TRANSFER_IN_INTAKE:{},APP_ORIGIN:context.origin};
 assert.equal((await stages.unauthenticated({env:off,path:'/api/transfer-in/passkey-options',request:new Request(context.origin+'/api/transfer-in/passkey-options',{method:'POST',headers:{Origin:context.origin},body:'{}'})})).status,404);
 const on={...off,flags:{for:()=>({global:()=>true})}};
 assert.equal((await stages.unauthenticated({env:on,path:'/api/transfer-in/passkey-options',request:new Request(context.origin+'/api/transfer-in/passkey-options',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})})).status,403);
});
test('review (minor): a fresh challenge for an existing reservation re-runs the source check and the unattested prompt',async()=>{
 const x=fixture();await options(x);const before=x.calls.filter(c=>c==='check').length;
 // The source now reports the move unattested (or refuses it): a second challenge needs the check and confirmation again.
 x.ports.check=async()=>{x.calls.push('check');return {sub:OWNER,kind:'person',mode:'unattested'};};
 await assert.rejects(options(x),{code:'unattested_confirmation_required'});
 assert.equal(x.calls.filter(c=>c==='check').length,before+1);
 const again=await x.run('passkey-options',{...gates,package:pkgOf(OWNER),unattestedConfirmed:true});assert.ok(again.registrationOptions);
 assert.equal(x.calls.filter(c=>c==='admission').length,1,'admission is not spent again');assert.equal(x.calls.filter(c=>c==='reserve').length,1);
 x.ports.check=async()=>{throw Object.assign(Error('gone'),{code:'not_found',status:404});};
 await assert.rejects(options(x),{code:'not_found'});
});
