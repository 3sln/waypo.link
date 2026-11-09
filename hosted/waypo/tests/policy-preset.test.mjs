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
