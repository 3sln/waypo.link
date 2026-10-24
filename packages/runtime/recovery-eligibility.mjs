// Display metadata only: the identity service remains the authority at reissue time.
export function recoveryReissueEligibility(account,now=Date.now()){
 // With any passkey enrolled only passkeys can authorize a reissue (wargame 2026-10-23 #1(a)); otherwise the password.
 const passkeys=account?.credentials??[],dates=(passkeys.length?passkeys.map(value=>value.createdAt):account?.passwordHash?[account.passwordSetAt]:[]).filter(value=>Number.isSafeInteger(value)&&value>=0&&value<=now);
 const marker=account?.recoveryReissue,forced=marker&&['elevated-abort','transfer-in'].includes(marker.reason)&&Number.isSafeInteger(marker.at)&&marker.at>=0;
 const eligibleAt=dates.length?Math.min(...dates.map(at=>forced&&at<=marker.at?at:at+7*86400000)):null;
 return {reissueEligible:eligibleAt!==null&&eligibleAt<=now,reissueEligibleAt:eligibleAt};
}
// Display metadata for an organization recovery-file reissue (packages/orgs/ownership.mjs tight(): a fresh step-up with
// any passkey or the password enrolled at least 7 days earlier). Null when the account has no credential. The
// organization still decides (including its 30-day security-change cooling period).
export function organizationReissueEligibility(account){
 const dates=[...(account?.credentials??[]).map(value=>value?.createdAt),...account?.passwordHash?[account.passwordSetAt]:[]].filter(value=>Number.isSafeInteger(value)&&value>=0);
 return {organizationReissueEligibleAt:dates.length?Math.min(...dates)+7*86400000:null};
}
