// Display metadata only: the identity service remains the authority at reissue time.
export function recoveryReissueEligibility(account,now=Date.now()){
 const dates=[...(account?.credentials??[]).map(value=>value.createdAt),...(account?.passwordHash?[account.passwordSetAt]:[])].filter(value=>Number.isSafeInteger(value)&&value>=0&&value<=now);
 const marker=account?.recoveryReissue,forced=marker&&['elevated-abort','transfer-in'].includes(marker.reason)&&Number.isSafeInteger(marker.at)&&marker.at>=0;
 const eligibleAt=dates.length?Math.min(...dates.map(at=>forced&&at<=marker.at?at:at+7*86400000)):null;
 return {reissueEligible:eligibleAt!==null&&eligibleAt<=now,reissueEligibleAt:eligibleAt};
}
