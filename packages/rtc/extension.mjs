// RTC building blocks in the extension system (docs/spec/rtc-signaling.md §3.1–§3.3, §3.5). Constants and pure
// validators only: nothing here declares the feature, registers the slot or mounts an occupant (RTC-d/RTC-e, behind
// RTC_SIGNALING_ENABLED and RTC_FOREIGN_ENABLED, default off). Provisional (coordinator), not signed off by the user.
import {memberURL} from '../identity/member-certificates.mjs';
import {RTC_PURPOSE_KIND,registeredPurpose,validatePurpose,purposeDisclosure} from './purposes.mjs';
import {maxLegSecondsValid} from './certificates.mjs';

export const RTC_FEATURE='rtc-signaling.v1';
export const RTC_SIGNALING_SLOT='https://spec.bindle.example/slots/rtc-signaling/v1';
export const RTC_SIGNALING_CONTRACT='https://spec.bindle.example/contracts/rtc-signaling/v1';
export const ICE_RELAY_SLOT='https://spec.bindle.example/slots/ice-relay/v1';
export const ICE_RELAY_CONTRACT='https://spec.bindle.example/contracts/ice-relay/v1';
export const RTC_SIGNALING_METHODS=Object.freeze(['register','unregister','endpoints','open','claim','send','renew','listen','mint_ticket']);
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};

/** The slot manifest of spec §3.2: exclusive, application consumers only, `purposes` bound per consumer (AMD-X1). */
export const RTC_SIGNALING_SLOT_MANIFEST=freeze({
 id:RTC_SIGNALING_SLOT,title:'Real-time connections',description:'Lets an application ring you and connect your devices with other devices.',publisher:'https://spec.bindle.example',
 fields:{signaling:{title:'Signaling service',type:'resource',cardinality:{min:0,max:1},contracts:[RTC_SIGNALING_CONTRACT]}},
 slot:{v:1,crit:['bind'],field:'signaling',selection:'exclusive',consumers:['application'],bind:['purposes'],options:{occupant:{},consumer:{purposes:{title:'Purposes',type:'url',maxLength:256,cardinality:{min:1,max:16}}}}}
});
/** The ice-relay slot of spec §3.3: up to four ordered relay occupants, pre-dispatch failover, no options. */
export const ICE_RELAY_SLOT_MANIFEST=freeze({
 id:ICE_RELAY_SLOT,title:'Connection relays',description:'Relays real-time connections when a direct path is not possible or not allowed.',publisher:'https://spec.bindle.example',
 fields:{relays:{title:'Relays',type:'resource',cardinality:{min:0,max:4},contracts:[ICE_RELAY_CONTRACT]}},
 slot:{v:1,field:'relays',selection:'ordered',failover:'pre-dispatch',consumers:['application','provider']}
});
/** The built-in occupant declaration for a provider manifest's `extensions` array (spec §3.2). Declared by RTC-d only. */
export const RTC_OCCUPANT_DECLARATION=freeze({slot:RTC_SIGNALING_SLOT,role:'occupant',ref:'rtc'});

/**
 * AMD-X1 bound artefact members (federation service option `boundArtefacts`): for the signaling slot, each approved
 * `purposes` value is an rtc-purpose line. `reference(line)` is the provider-held reviewed reference (an unregistered
 * line is refused); `validate(body)` and `disclose(body)` give the consent facts. The kind is unknown to DEFAULT_KINDS,
 * so only the approved version is usable under an approval (spec §3.5 item 3).
 */
export const RTC_BOUND_ARTEFACTS=freeze({[RTC_SIGNALING_SLOT]:{purposes:{kind:RTC_PURPOSE_KIND,urlMember:'purpose',reference:line=>registeredPurpose(line),validate:body=>validatePurpose(body),disclose:body=>purposeDisclosure(body)}}});
/** The composition form (review, informational): the same table, but `reference` resolves only while `enabled()` (the
 * RTC_SIGNALING_ENABLED read) is true, so with the flag off a bound purpose request is refused as unavailable instead
 * of being approved. EXTENSIONS_ENABLED separately gates `bind` itself. */
export const rtcBoundArtefacts=enabled=>freeze({[RTC_SIGNALING_SLOT]:{purposes:{...RTC_BOUND_ARTEFACTS[RTC_SIGNALING_SLOT].purposes,reference:line=>enabled()===true?registeredPurpose(line):null}}});

/** The `rtc-signaling.v1` feature members (spec §3.1): `endpoint` on the issuer's origin, `max_leg_certificate_seconds`
 * 120–900. Returns a clean copy or null. Members are exact. */
export function validateRtcFeature(value,{issuer,allowLoopback=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2)return null;
 const url=memberURL(value.endpoint,allowLoopback);if(!url||url.origin!==issuer||!maxLegSecondsValid(value.max_leg_certificate_seconds))return null;
 return {endpoint:value.endpoint,max_leg_certificate_seconds:value.max_leg_certificate_seconds};
}
