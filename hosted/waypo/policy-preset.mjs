// 3sln.me commercial decisions belong here, never in the portable OSS engine.
export const THREESLN_PERSONAL_PLAN = Object.freeze({id: '3sln-personal-annual-v1', annualUsd: 10, includedStorageBytes: 10_000_000_000, overageBudget: 0});
export const THREESLN_TRIAL_CANDIDATE=Object.freeze({days:30,storageBytes:1_000_000_000,enabledByDefault:false});
export function create3slnPolicyConfiguration({issuer, revision = 1, executeRetention = false, trialStorageBytes = 0, quota = {}}) {
  if (!Number.isSafeInteger(trialStorageBytes) || trialStorageBytes < 0) throw new TypeError('Explicit trial capacity required');
  return {
    issuer, revision, mode: 'hosted', contactRequired: true,
    retention: {enabled: true, execute: executeRetention, firstYearGapMonths: 2, ordinaryGraceMonths: 1, substantialExtraMonths: 1, establishedGapMonths: 6, establishedGraceMonths: 3, paidGraceMonths: 3, fundingGraceMonths: 1, archiveBaseDays: 30, archiveDaysPerPaidYear: 30, archiveMaxDays: 180},
    plans: {[THREESLN_PERSONAL_PLAN.id]: {paidStorageBytes: THREESLN_PERSONAL_PLAN.includedStorageBytes, trialStorageBytes}},
    quota,
  };
}
