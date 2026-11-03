import test from 'node:test';
import assert from 'node:assert/strict';
import {THREESLN_PERSONAL_PLAN, create3slnPolicyConfiguration} from '../policy-preset.mjs';
test('3sln commercial preset is explicit, portable-engine independent and defaults to no trial/destructive execution', () => {
  const config = create3slnPolicyConfiguration({issuer: 'https://identity.example/api/auth'});
  assert.equal(THREESLN_PERSONAL_PLAN.annualUsd, 10);
  assert.equal(config.plans[THREESLN_PERSONAL_PLAN.id].paidStorageBytes, 10_000_000_000);
  assert.equal(config.plans[THREESLN_PERSONAL_PLAN.id].trialStorageBytes, 0);
  assert.equal(config.retention.execute, false);
  assert.equal(THREESLN_PERSONAL_PLAN.overageBudget, 0);
});

test('signup market guard is explicit, transient and never a returning-travel rule',async()=>{const {createHostedSignupGuard}=await import('../composition.mjs');assert.equal(await createHostedSignupGuard()({country:'US',purpose:'new-account-signup'}),false);const guard=createHostedSignupGuard({allowedSignupCountries:['US']});assert.equal(await guard({country:'US',purpose:'new-account-signup'}),true);assert.equal(await guard({country:'US',purpose:'returning-signin'}),false);assert.equal(await guard({country:'CA',purpose:'new-account-signup'}),false);assert.throws(()=>createHostedSignupGuard({allowedSignupCountries:['XX']}));});
