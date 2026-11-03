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
