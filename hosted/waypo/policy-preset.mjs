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
// Operator-selected initial free launch capability; generic composition stays off.
export const WAYPO_LINK_INITIAL_FREE_STORAGE_SERVICES=Object.freeze({blobs:true});
export const WAYPO_LINK_FREE_STORAGE_BYTES=500_000_000;
export function createWaypoLinkFreePolicyConfiguration({issuer,revision=1,executeRetention=false,freeStorageBytes=WAYPO_LINK_FREE_STORAGE_BYTES}={}){
 if(!Number.isSafeInteger(freeStorageBytes)||freeStorageBytes<1||freeStorageBytes>1_000_000_000_000)throw TypeError('Finite free storage capacity required');
 const config=createWaypoLinkPolicyConfiguration({issuer,revision,executeRetention});
 // Retention grace threshold is separate from the storage quota. The free
 // 500MB profile must be able to earn storage-based grace before filling up.
 return {...config,retention:{...config.retention,substantialBytes:100_000_000,substantialHumanDays:14},plans:{},freeServices:{storageBytes:freeStorageBytes,signaling:true}};
}

// Explicit operator-selected initial text-feedback profile. Never applied by
// generic composition; these finite resource guards are not a financial promise.
export const WAYPO_LINK_INITIAL_TEXT_SUPPORT=Object.freeze({mode:'enabled',media:false,limits:Object.freeze({tickets:4096,userTickets:32,messages:256,notes:128,media:4,uploadBytes:5242880,ticketBytes:10485760,deploymentBytes:67108864,stages:4,audit:128,criticalAudit:1024,proposals:16,ticketTextBytes:524288,deploymentTextBytes:134217728,stageMs:600000,retentionMs:2592000000})});
