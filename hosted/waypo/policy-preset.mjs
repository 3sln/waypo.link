export const WAYPO_LINK_ISSUER='https://waypo.link/api/auth';
// Waypo.link commercial decisions belong here, never in the portable OSS engine.
export const WAYPO_LINK_PERSONAL_PLAN = Object.freeze({id: 'waypo-link-personal-annual-v1', annualUsd: 10, includedStorageBytes: 10_000_000_000, overageBudget: 0});
export const WAYPO_LINK_TRIAL_CANDIDATE=Object.freeze({days:30,storageBytes:1_000_000_000,enabledByDefault:false});
export function createWaypoLinkPolicyConfiguration({issuer, revision = 1, executeRetention = false, trialStorageBytes = 0, quota = {}}) {
  if (!Number.isSafeInteger(trialStorageBytes) || trialStorageBytes < 0) throw new TypeError('Explicit trial capacity required');
  return {
    issuer, revision, mode: 'hosted', contactRequired: true,
    retention: {enabled: true, execute: executeRetention, firstYearGapMonths: 2, ordinaryGraceMonths: 1, substantialExtraMonths: 1, establishedGapMonths: 6, establishedGraceMonths: 3, paidGraceMonths: 3, fundingGraceMonths: 1, archiveBaseDays: 30, archiveDaysPerPaidYear: 30, archiveMaxDays: 180},
    plans: {[WAYPO_LINK_PERSONAL_PLAN.id]: {paidStorageBytes: WAYPO_LINK_PERSONAL_PLAN.includedStorageBytes, trialStorageBytes}},
    quota,
  };
}

// Initial launch mode; paid plans remain a separate, deferred configuration.
export const WAYPO_LINK_FREE_STORAGE_BYTES=500_000_000;
export function createWaypoLinkFreePolicyConfiguration({issuer,revision=1,executeRetention=false,freeStorageBytes=WAYPO_LINK_FREE_STORAGE_BYTES}={}){
 if(!Number.isSafeInteger(freeStorageBytes)||freeStorageBytes<1||freeStorageBytes>1_000_000_000_000)throw TypeError('Finite free storage capacity required');
 const config=createWaypoLinkPolicyConfiguration({issuer,revision,executeRetention});
 return {...config,plans:{},freeServices:{storageBytes:freeStorageBytes,signaling:true}};
}
