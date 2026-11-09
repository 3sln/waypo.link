import test from 'node:test';import assert from 'node:assert/strict';
import {isBudgetedHostedSecurityMailTransport} from '@3sln/waypo/email-delivery';
import {createHostedEmailBinding} from '../email-binding.mjs';
import {createHostedEmailBudgetAdmission} from '../email-budget-binding.mjs';
const issuer='https://identity.example/api/auth',configuration={issuer,adminUrl:'https://admin.identity.example/'};
const env={HOSTED_EMAIL_BUDGET_CONFIG:JSON.stringify({billingScope:'fixture',gcIntervalMs:1000,policy:{revision:'fixture',currency:'USD',attemptMicroUSD:1,attemptTtlMs:1000,maxAttempts:8,maxRecipients:8,maxOwners:2,reservedAttempts:1,reservedRecipients:1,reservedOwners:1,daily:{messages:8,microUSD:8,reservedMessages:1,reservedMicroUSD:1},monthly:{messages:8,microUSD:8,reservedMessages:1,reservedMicroUSD:1},fleet:{windowMs:1000,messages:8,reservedMessages:1},recipient:{windowMs:1000,messages:8}}}),HOSTED_EMAIL_BUDGET_KEY:'eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg',EMAIL_BUDGET:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({admitted:true,chargedMicroUSD:1})})}};
test('only exact issuer-bound budgeted hosted transport obtains readiness; JSON, clones, generic hooks and unbudgeted bindings fail',()=>{
 const emailBinding={send:async()=>({messageId:'fixture'})},budget=createHostedEmailBudgetAdmission(env);
 const valid=createHostedEmailBinding({emailBinding,configuration,beforeEmailAttempt:budget,requireEmailBudget:true});
 assert.equal(isBudgetedHostedSecurityMailTransport(valid,issuer),true);
 for(const candidate of [{hostedSecurityMailReady:true},JSON.parse(JSON.stringify(valid)),{...valid},createHostedEmailBinding({emailBinding,configuration}),createHostedEmailBinding({emailBinding,configuration,beforeEmailAttempt:async()=>({admitted:true}),requireEmailBudget:true})])assert.equal(isBudgetedHostedSecurityMailTransport(candidate,issuer),false);
 assert.equal(isBudgetedHostedSecurityMailTransport(valid,'https://other.example/api/auth'),false);
 assert.equal(isBudgetedHostedSecurityMailTransport(valid,issuer+'/'),false);
});

test('hosted mail capability independently requires required production session-security human verifier',async()=>{
 const {isHostedSessionSecurityMailReady}=await import('../../../../waypo/packages/auth/session-security-human.mjs');
 const transport=createHostedEmailBinding({emailBinding:{send:async()=>({messageId:'id'})},configuration,beforeEmailAttempt:createHostedEmailBudgetAdmission(env),requireEmailBudget:true});
 const challengeOrigin='https://challenge.identity.example',verification={verify:async()=>true,configuration:{action:'session-security',testOnly:false,siteKey:'fixture-site',challengeOrigin}};
 const profile={transport,issuer,emailHuman:{required:true},verification,challengeOrigin};assert.equal(isHostedSessionSecurityMailReady(profile),true);
 for(const patch of [{transport:{...transport}},{transport:{hostedSecurityMailReady:true}},{issuer:'https://wrong.example/api/auth'},{emailHuman:{required:false}},{verification:{...verification,configuration:{...verification.configuration,testOnly:true}}},{verification:{...verification,configuration:{...verification.configuration,action:'email-initiation'}}},{challengeOrigin:'https://wrong.example'}])assert.equal(isHostedSessionSecurityMailReady({...profile,...patch}),false);
});

test('Node trusted port rejects clone, wrong issuer and ambiguous legacy configuration before storage creation',async()=>{
 const {createNodeApplication}=await import('@3sln/waypo/node');
 const provider={...configuration,installationId:'mail-capability-fixture',database:'/path-that-must-not-be-opened/security-mail.sqlite',authSecret:'fixture-secret-longer-than-thirty-two-characters'};
 const transport=createHostedEmailBinding({emailBinding:{send:async()=>({messageId:'id'})},configuration,beforeEmailAttempt:createHostedEmailBudgetAdmission(env),requireEmailBudget:true});
 for(const [input,candidate]of [[provider,{...transport}],[{...provider,issuer:'https://wrong.example/api/auth',adminUrl:'https://admin.wrong.example/'},transport],[{...provider,localMail:true},transport],[{...provider,emailDeliveryUrl:'https://sender.example/send',emailDeliveryToken:'fixture'},transport]])await assert.rejects(createNodeApplication(input,{hostedEmailTransport:candidate}),/Exclusive trusted issuer-bound|Local mail capture is restricted/);
});

test('pending budget capability bounds unresolved RPC across recreated admissions and releases only on settlement',async()=>{
 let settle,calls=0,entered;let entry=new Promise(resolve=>entered=resolve);const pendingEnv={...env,EMAIL_BUDGET:{idFromName:n=>n,get:()=>({fetch:()=>{calls++;entered();return new Promise(resolve=>settle=()=>resolve(Response.json({admitted:true,chargedMicroUSD:1})));}})}},input={attemptId:Date.now()+'.'+'A'.repeat(43),purpose:'identity-session-security',to:'owner@mail.example'};
 const controller=new AbortController(),first=createHostedEmailBudgetAdmission(pendingEnv)(input,{signal:controller.signal});await entry;controller.abort();
 for(let i=0;i<8;i++)await assert.rejects(createHostedEmailBudgetAdmission(pendingEnv)(input),/Email budget unavailable/);assert.equal(calls,1);settle();assert.equal((await first).admitted,true);
 entry=new Promise(resolve=>entered=resolve);const next=createHostedEmailBudgetAdmission(pendingEnv)(input);await entry;assert.equal(calls,2);settle();await next;
});
