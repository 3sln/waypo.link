// Provisional economics only. This module neither grants capacity nor bills.
export const OVERAGE_CANDIDATE=Object.freeze({usdPerDecimalGbMonth:.05,annualCapUsd:0,enabled:false});
const validTime=value=>Number.isSafeInteger(value)&&value>=0;
const bytes=value=>Number.isSafeInteger(value)&&value>=0;
function term({termStart,termEnd}){if(!validTime(termStart)||!validTime(termEnd)||termEnd<=termStart||termEnd-termStart>367*86400000)throw new TypeError('Bounded funded annual term required');}
export function estimateAnnualOverage({termStart,termEnd,includedBytes,events,rounding='exact-byte-time'}){
 term({termStart,termEnd});if(!bytes(includedBytes)||!Array.isArray(events)||!events.length||events.length>4096||!['exact-byte-time','whole-gb-time'].includes(rounding)||events[0].at!==termStart)throw new TypeError('Bounded complete term usage events required');let usd=0;
 for(let index=0;index<events.length;index++){const event=events[index],end=events[index+1]?.at??termEnd;if(!validTime(event.at)||event.at<termStart||event.at>=termEnd||end<=event.at||end>termEnd||!bytes(event.usedBytes))throw new TypeError('Strictly ordered usage events required');const excess=Math.max(0,event.usedBytes-includedBytes)/1e9,gb=rounding==='whole-gb-time'?Math.ceil(excess):excess;usd+=gb*12*(end-event.at)/(termEnd-termStart)*OVERAGE_CANDIDATE.usdPerDecimalGbMonth;}
 return {usd,settlementCents:Math.ceil(usd*100-1e-10),rounding,monthDefinition:'one twelfth of the funded annual term',enabled:false};
}
export function evaluateRemainingTermReservation({termStart,termEnd,at,includedBytes,currentBytes,additionalReservedBytes=0,accruedUsd,annualCapUsd=0}){
 term({termStart,termEnd});if(!validTime(at)||at<termStart||at>=termEnd||![includedBytes,currentBytes,additionalReservedBytes].every(bytes)||!Number.isSafeInteger(currentBytes+additionalReservedBytes)||![accruedUsd,annualCapUsd].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0))throw new TypeError('Actual usage, reservations and current funded term required');
 const excessBytes=Math.max(0,currentBytes+additionalReservedBytes-includedBytes),remainingLiabilityUsd=excessBytes/1e9*12*(termEnd-at)/(termEnd-termStart)*OVERAGE_CANDIDATE.usdPerDecimalGbMonth,requiredCents=Math.ceil((accruedUsd+remainingLiabilityUsd)*100-1e-10),capCents=Math.floor(annualCapUsd*100+1e-10);
 return {fitsCandidateCap:requiredCents<=capCents,remainingLiabilityUsd,requiredCents,capCents,excessBytes,enabled:false};
}
