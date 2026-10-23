// PORT-6: password enrollment for an arriving person. The destination package stays in request memory until
// server-side CAPTCHA, signup admission, age/terms and possession of a new credential have all succeeded.
// The receipt authenticates only the move flow; it is never a general account session or recovery credential.
import {Action} from '../../vendor/ngin/src/index.js';
import {IdentityFault} from './service.mjs';
import {secureEqual} from './crypto.mjs';
const fail=(code,message,status=400)=>{throw Object.assign(new IdentityFault(code,message),{status});};
const RECEIPT_TTL=45*86400000;
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fields=new Set(['package','source','method','password','turnstileToken','termsAccepted','termsVersion','ageConfirmed','unattestedConfirmed']);
export class TransferEnrollment {
 constructor({identity,ports}){this.identity=identity;this.ports=ports;}
 async start(input,context){
  const s=this.identity,p=this.ports;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.has(key)))fail('invalid_request','Check the move request.');
  if(input.method!=='password'||typeof input.password!=='string'||input.password.length<12||input.password.length>1024)fail('invalid_password','Choose a password of 12–1024 characters.');
  await s.guard('signup',input,context);
  if(input.termsAccepted!==true||input.termsVersion!==s.config.termsVersion)fail('terms_required','Agree to the current account terms.');
  const age=s.ageAttestation(input,context);let pkg;try{pkg=typeof input.package==='string'?JSON.parse(input.package):input.package;}catch{fail('package_invalid','This identity package cannot be used.');}
  const packageHash=await s.crypto.hash('transfer-package',canonical(pkg)),source=input.source??'package';
  // A fresh CAPTCHA and the enrolled credential recover a lost HTTP reply. Never depend on the old provider
  // still listing the package key: it may already have committed its side of this very move.
  const prior=typeof pkg?.sub==='string'&&/^[a-f0-9-]{36}$/.test(pkg.sub)?await s.repository.get(pkg.sub):null;
  if(prior?.transferEnrollment){
   const receipt=prior.transferEnrollment;
   if(prior.id!==pkg.sub||!['pending-transfer','active'].includes(prior.status)||receipt.reservation!==prior.transferIn?.reservation||receipt.packageHash!==packageHash||receipt.source!==source||!prior.passwordHash||!await s.passwordHasher.verify(input.password,prior.passwordHash))fail('intake_conflict','This identity is already being enrolled.',409);
   const revision=prior.revision,transferToken=prior.id+'.'+s.crypto.random();
   prior.transferEnrollment={...receipt,hash:await s.crypto.hash('transfer-enrollment',transferToken),expiresAt:s.clock()+RECEIPT_TTL};s.audit(prior,'transfer-in-enrollment-resumed');await s.save(prior,revision);
   try{await s.requireSetupChannel(prior);}catch(error){if(error.code==='contact_required')return {transferToken,owner:prior.id,transfer:{state:'enrolled'},contactRequired:true,resumed:true};throw error;}
   // Retrying begin is idempotent in PORT-4, including after the source has moved.
   let transfer;try{transfer=await p.begin(prior.id,{package:input.package,source});}catch(error){return {transferToken,owner:prior.id,transfer:{state:'enrolled'},retry:true,resumed:true,error:typeof error?.code==='string'?error.code:'temporarily_unavailable'};}
   return {transferToken,owner:prior.id,transfer,resumed:true};
  }
  const facts=await p.check({package:input.package,source});
  if(facts.kind!=='person')fail('not_found','Not found.',404);
  if(facts.mode==='unattested'&&input.unattestedConfirmed!==true)fail('unattested_confirmation_required','Confirm moving without confirmation from the old provider.');
  const passwordHash=await s.passwordHasher.hash(input.password);
  if(!await s.passwordHasher.verify(input.password,passwordHash))fail('credential_required','Verify the new credential.');
  if(!await s.rateLimiter.check({phase:'admitted',operation:'signup',signupKind:'free',remoteIP:context.remoteIP,region:context.region,admissionId:facts.sub}))fail('rate_limited','Account creation is limited. Try again later.',429);
  const reserved=await p.reserve({package:input.package,source:input.source??'package'}),account=await s.repository.get(reserved.sub);
  if(!account||account.status!=='pending-transfer'||account.transferIn?.reservation!==reserved.reservation||account.passwordHash||account.credentials?.length||account.transferEnrollment)fail('intake_conflict','This identity is already being enrolled.',409);
  const revision=account.revision,transferToken=account.id+'.'+s.crypto.random();
  Object.assign(account,{passwordHash,passwordSetAt:s.clock(),termsVersion:s.config.termsVersion,termsAcceptedAt:s.clock(),...age,
   transferEnrollment:{hash:await s.crypto.hash('transfer-enrollment',transferToken),expiresAt:s.clock()+RECEIPT_TTL,reservation:reserved.reservation,packageHash,source}});
  s.audit(account,'transfer-in-enrolled');await s.save(account,revision);
  // Do not hide a retryable import error: the owner keeps the restricted receipt and can retry with the same package.
  if(s.config.requireReachability===true)return {transferToken,owner:account.id,transfer:{state:'enrolled'},contactRequired:true};
  let transfer;try{transfer=await p.begin(account.id,{package:input.package,source:input.source??'package'});}catch(error){return {transferToken,owner:account.id,transfer:{state:'enrolled'},retry:true,error:typeof error?.code==='string'?error.code:'temporarily_unavailable'};}
  return {transferToken,owner:account.id,transfer};
 }
 async authorize(input,context){
  const s=this.identity;s.origin(context);
  if(typeof input?.transferToken!=='string'||input.transferToken.length>512)fail('unauthorized','Start or resume your move.',401);
  const id=input.transferToken.split('.')[0];if(!/^[a-f0-9-]{36}$/.test(id))fail('unauthorized','Start or resume your move.',401);
  const account=await s.repository.get(id),receipt=account?.transferEnrollment;
  if(account?.id!==id||!receipt||receipt.expiresAt<=s.clock()||!['pending-transfer','active'].includes(account.status)||receipt.reservation!==account.transferIn?.reservation||!secureEqual(receipt.hash,await s.crypto.hash('transfer-enrollment',input.transferToken)))fail('unauthorized','Start or resume your move.',401);
  return account.id;
 }
 async emailStart(input,context){
  const owner=await this.authorize(input,context),s=this.identity;
  if(typeof s.mailer?.sendSetupCode!=='function')fail('email_unavailable','Email delivery is not configured.',503);
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('invalid_email','Enter an email address.');
  const account=await s.repository.get(owner),revision=account.revision;
  if(account.status!=='pending-transfer')fail('conflict','This move is no longer enrolling.',409);
  await s.setupSendAdmission(account,'Email',context,email);
  let value;do{value=globalThis.crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=4200000000);
  const code=String(value%100000000).padStart(8,'0');
  account.transferEnrollment.emailChallenge={email,hash:await s.crypto.hash('transfer-email',owner+'|'+email+'|'+code),expiresAt:s.clock()+600000,attempts:0};
  await s.save(account,revision);await s.mailer.sendSetupCode({email,code,issuer:s.config.origin,locale:input.locale==='es'?'es':'en'});return {sent:true};
 }
 async emailConfirm(input,context){
  const owner=await this.authorize(input,context),s=this.identity,account=await s.repository.get(owner),revision=account.revision,c=account.transferEnrollment?.emailChallenge;
  if(account.status!=='pending-transfer'||!c||c.expiresAt<=s.clock()||c.attempts>=5||typeof input.code!=='string'||!/^\d{8}$/.test(input.code))fail('invalid_challenge','Request a fresh email code.');
  c.attempts++;if(!secureEqual(c.hash,await s.crypto.hash('transfer-email',owner+'|'+c.email+'|'+input.code))){await s.save(account,revision);fail('invalid_challenge','That email code is incorrect.');}
  const existing=await s.repository.findByEmail(c.email);if(existing&&existing.id!==owner)fail('email_already_linked','Use another contact address.');
  account.verifiedEmail=c.email;account.emailVerifiedAt=s.clock();account.emailLoginEnabled=false;delete account.transferEnrollment.emailChallenge;await s.save(account,revision);return {verified:true,retry:true};
 }
 async run(method,input,context){
  if(method==='start')return this.start(input,context);
  if(method==='check'){this.identity.origin(context);if(!await this.identity.rateLimiter.check({operation:'transfer-in-check',remoteIP:context.remoteIP,region:context.region}))fail('rate_limited','Try again later.',429);return this.ports.check(input);}
  if(method==='email-start')return this.emailStart(input,context);
  if(method==='email-confirm')return this.emailConfirm(input,context);
  const owner=await this.authorize(input,context);
  if(method==='status')return this.ports.status(owner);
  if(method==='cancel')return this.ports.cancel(owner);
  if(method==='retry'){const account=await this.identity.repository.get(owner);await this.identity.requireSetupChannel(account);return this.ports.begin(owner,{package:input.package,source:input.source??'package'});}
  fail('not_found','Not found.',404);
 }
}
// Existing identity-engine composition supplies the actual identity service (including Turnstile and Argon2).
// `ports` is supplied only by the runtime, never selected or deserialized from a request body.
export class TransferEnrollmentAction extends Action {
 static deps=['identity'];
 constructor(method,input,context,ports){super();Object.assign(this,{method,input,context,ports});}
 async execute({identity},{dispatchFeed}){const result=await new TransferEnrollment({identity,ports:this.ports}).run(this.method,this.input,this.context);dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:result}));}
}
