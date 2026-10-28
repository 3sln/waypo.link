// Interim owner-local RTC purpose approvals (extensions revision 3.2, CR-X3-20/CR-X3-24: AMD-X1 `bind` removed, so a
// per-app purpose approval no longer rides the federation grant). Provisional (coordinator), not signed off by the
// user; legacy rtc-signaling.v1 only, behind RTC_SIGNALING_ENABLED (default off).
// TODO(signaling Appendix C.2: approvals move to intents session handler approvals): delete this module with the
// legacy RTC package.
//
// One record per application in the owner's own account store, written only by the owner (rtc.approve-app, an owner
// operation; never inside an application's authorization flow) and by narrowing lifecycle steps:
//   rtc/approval/<base64url SHA-256 of "rtc-approval\0" + client id>
//     {v:1, clientId, purposes:[line] (sorted, unique, at most 16), versions:{[line]:{version, digest}}, revision, at}
// `versions` pins each line to the provider-held purpose reference (packages/rtc/purposes.mjs registeredPurpose) at
// approval time: a line whose held reference later changes is no longer approved until the owner approves it again
// (a widening). Narrowing is immediate (the record shrinks in the same transaction that ends the app's sessions and
// endpoint registrations for the removed lines). Records of an older shape (the former `rtcAppChanged` change log,
// without `versions`) approve nothing (fail closed).
//
// The application still needs a live grant on the signaling fragment: an application only reaches RTC through
// federation dispatch on an approved, assigned resource, and the grant-revocation hook (FederationService
// `grantChanged` -> account rtcAppChanged purposes:null) deletes the record and ends the app's RTC state.
import {digest} from '../core/records.mjs';

export const APPROVAL_PREFIX='rtc/approval/';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** The storage key of `clientId`'s approval record. */
export const approvalKey=async(crypto,clientId)=>APPROVAL_PREFIX+await digest(crypto,'rtc-approval\0'+clientId);
/** Whether `record` approves `line` at the held reference `ref` ({version, digest}). Malformed: false. */
export function approvalAllows(record,line,ref){
 if(!plain(record)||record.v!==1||!Array.isArray(record.purposes)||!plain(record.versions)||!record.purposes.includes(line))return false;
 const pin=Object.hasOwn(record.versions,line)?record.versions[line]:null;
 return plain(pin)&&plain(ref)&&pin.version===ref.version&&pin.digest===ref.digest;
}
/** The record for `purposes` pinned to `refs` ({[line]: {version, digest}}), after `prior` (for the revision). */
export function approvalRecord({clientId,purposes,refs,prior,at}){
 const lines=[...new Set(purposes)].sort();
 return {v:1,clientId,purposes:lines,versions:Object.fromEntries(lines.map(l=>[l,{version:refs[l].version,digest:refs[l].digest}])),revision:(plain(prior)&&Number.isSafeInteger(prior.revision)?prior.revision:0)+1,at};
}
/** The lines `prior` approves at their current held references (`refOf(line)` -> {version, digest} | null). */
export function approvedLines(prior,refOf){
 if(!plain(prior)||!Array.isArray(prior.purposes))return [];
 return prior.purposes.filter(l=>typeof l==='string'&&approvalAllows(prior,l,refOf(l)));
}
/** The owner's view of a record: {clientId, purposes (only lines still usable), at} or null. */
export function approvalView(record,refOf){
 if(!plain(record)||typeof record.clientId!=='string')return null;
 return {clientId:record.clientId,purposes:approvedLines(record,refOf),at:Number.isSafeInteger(record.at)?record.at:null};
}
