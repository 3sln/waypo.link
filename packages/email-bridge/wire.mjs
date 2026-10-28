// The few wire helpers the provider bridge shares with the messaging spec (messaging.md §9). Core must not import
// Parlay packages (extraction import boundary), so these come from core modules or are restated here and pinned
// against the Parlay receiver by tests/email-bridge-handoff.test.mjs.
import {ijsonJCS} from '../core/strict-json.mjs';
/** RFC 8785 over the messaging I-JSON profile (packages/core/strict-json.mjs). The `author_proof_invalid` fault code is
 * the one this helper always threw (contacts spike CR-C0 moved it without behaviour change). */
export const jcs=value=>ijsonJCS(value,{code:'author_proof_invalid'});
// Extensions rev 3.2 (§11.1, CR-X3-26): the former public-message-intake slot, republished as the intake fragment.
// Placeholders under spec.bindle.example. Contacts spike CR-C0 moved them here from packages/links/types.mjs.
export const PUBLIC_INTAKE_FRAGMENT='https://spec.bindle.example/fragments/public-intake/v1';
/** The public-intake contract a resource in the intake field serves (`deliver`). Core consumers (brokered records, the
 * email bridge) depend on the field and this contract, never on a particular messaging app or its flag. */
export const PUBLIC_INTAKE_CONTRACT='https://spec.bindle.example/contracts/public-intake/v1';
export const INTAKE_FRAGMENT=PUBLIC_INTAKE_FRAGMENT,INTAKE_CONTRACT=PUBLIC_INTAKE_CONTRACT;
export const base64url=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
export const decodedLength=value=>Math.floor(value.length*3/4);
export const sha256=async value=>base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)));
/** normalizedDigest: SHA-256 over JCS of the delivered `message` object (spec §9, the receiver's reading). */
export const intakeDigest=message=>sha256(jcs(message));
