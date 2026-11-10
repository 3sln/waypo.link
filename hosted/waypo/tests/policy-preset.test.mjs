import {nativeCapacityProfile} from './native-capacity.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {WAYPO_LINK_PERSONAL_PLAN, createWaypoLinkPolicyConfiguration} from '../policy-preset.mjs';
test('Waypo.link commercial preset is explicit, portable-engine independent and defaults to no trial/destructive execution', () => {
  const config = createWaypoLinkPolicyConfiguration({issuer: 'https://identity.example/api/auth'});
  assert.equal(WAYPO_LINK_PERSONAL_PLAN.annualUsd, 10);
  assert.equal(config.plans[WAYPO_LINK_PERSONAL_PLAN.id].paidStorageBytes, 10_000_000_000);
  assert.equal(config.plans[WAYPO_LINK_PERSONAL_PLAN.id].trialStorageBytes, 0);
  assert.equal(config.retention.execute, false);
  assert.equal(WAYPO_LINK_PERSONAL_PLAN.overageBudget, 0);
});

test('signup market guard is explicit, transient and never a returning-travel rule',async()=>{const {createHostedSignupGuard}=await import('../composition.mjs');assert.equal(await createHostedSignupGuard()({country:'US',purpose:'new-account-signup'}),false);const guard=createHostedSignupGuard({allowedSignupCountries:['US']});assert.equal(await guard({country:'US',purpose:'new-account-signup'}),true);assert.equal(await guard({country:'US',purpose:'returning-signin'}),false);assert.equal(await guard({country:'CA',purpose:'new-account-signup'}),false);assert.throws(()=>createHostedSignupGuard({allowedSignupCountries:['XX']}));});

test('hosted production composition retains the confirmed permanent Waypo.link issuer while explicit sandbox fixtures remain isolated',async()=>{const {composeWaypoLinkProviderConfiguration}=await import('../composition.mjs');assert.throws(()=>composeWaypoLinkProviderConfiguration({...nativeCapacityProfile(),issuer:'https://other.example/api/auth'},{environment:'production'}),/production issuer is fixed/);assert.equal(composeWaypoLinkProviderConfiguration({...nativeCapacityProfile(),issuer:'https://waypo.link/api/auth'},{environment:'production'}).issuer,'https://waypo.link/api/auth');assert.equal(composeWaypoLinkProviderConfiguration({...nativeCapacityProfile(),issuer:'https://fixture.example/api/auth'},{environment:'sandbox'}).issuer,'https://fixture.example/api/auth');});

test('free first-year retention grants extra month at100MB or14 distinct human days while lesser use keeps ordinary grace',async t=>{
 const {createWaypoLinkFreePolicyConfiguration}=await import('../policy-preset.mjs'),{createPolicyEngine,createPolicyEventsPort,RunMaintenanceAction,ProcessMaintenanceAction,AccountPolicyQuery,addCalendarMonths}=await import('@3sln/waypo/engines/policies'),{TransactionStore}=await import('../../../../waypo/tests/engine/helpers/transaction-store.mjs');
 for(const scenario of [{name:'under-storage-threshold',bytes:99_999_999,days:0,months:1},{name:'at-storage-threshold',bytes:100_000_000,days:0,months:2},{name:'under-human-days-threshold',bytes:0,days:13,months:1},{name:'at-human-days-threshold',bytes:0,days:14,months:2}])await t.test(scenario.name,async()=>{
  const created=Date.UTC(2026,0,1),issuer='https://identity.example/api/auth',config=createWaypoLinkFreePolicyConfiguration({issuer});assert.equal(config.freeServices.storageBytes,500_000_000);assert.equal(config.retention.substantialBytes,100_000_000);let now=created;const store=new TransactionStore(),ports={store,configuration:()=>config,clock:()=>now,authorizeCaller:async()=>true,maintenance:{deliverNotice:async()=>({status:'accepted'})}},engine=createPolicyEngine(ports),events=createPolicyEventsPort(ports),caller={issuer,subject:'owner',sessionId:'private-fixture-session'};
  try{await events.recordAccount({subject:'owner',createdAt:created,contacts:[{id:'verified-email-reference',type:'email',verified:true,healthy:true}]});for(let day=1;day<=scenario.days;day++){now=created+day*86400000;await events.recordHumanInteraction({subject:'owner',eventId:'interactive-'+day,kind:'authentication',at:now});}if(scenario.bytes)await store.transaction(tx=>events.recordServiceUsage(tx,{issuer,subject:'owner',usedBytes:scenario.bytes}));now=addCalendarMonths(now,2);await engine.dispatch(new RunMaintenanceAction({subject:'owner'},caller)).next('result');await engine.dispatch(new ProcessMaintenanceAction({subject:'owner'},caller)).next('result');const view=await engine.query(new AccountPolicyQuery({subject:'owner'},caller)).peek();assert.equal(view.status,'warning');assert.equal(view.deadline,addCalendarMonths(now,scenario.months));assert.equal(config.retention.execute,false,'threshold does not enable destructive execution');}finally{await engine.dispose();}
 });
});

test('initial text support is explicit bounded immutable operator selection with media off',async()=>{
 const {WAYPO_LINK_INITIAL_TEXT_SUPPORT:preset}=await import('../policy-preset.mjs'),{supportLimits}=await import('../../../../waypo/packages/support/limits.mjs'),{composeWaypoLinkProviderConfiguration:compose}=await import('../composition.mjs');
 assert.equal(preset.mode,'enabled');assert.equal(preset.media,false);assert.deepEqual(supportLimits(preset.limits),preset.limits);assert.equal(preset.limits.tickets,4096);assert.equal(preset.limits.userTickets,32);assert.equal(preset.limits.audit,128);assert.equal(preset.limits.criticalAudit,1024);assert.equal(Object.isFrozen(preset),true);assert.equal(Object.isFrozen(preset.limits),true);
 const input={...nativeCapacityProfile(),issuer:'https://fixture.example/api/auth'};assert.equal(compose(input,{environment:'sandbox'}).support,undefined);assert.deepEqual(compose({...input,support:preset},{environment:'sandbox'}).support,preset);
});
