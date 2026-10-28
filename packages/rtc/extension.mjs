// RTC building blocks in the extension system (docs/spec/rtc-signaling.md §3.1–§3.3, §3.5). Constants and pure
// validators only: nothing here declares the feature, registers the slot or mounts an occupant (RTC-d/RTC-e, behind
// RTC_SIGNALING_ENABLED and RTC_FOREIGN_ENABLED, default off). Provisional (coordinator), not signed off by the user.
import {memberURL} from '../identity/member-certificates.mjs';
import {maxLegSecondsValid} from './certificates.mjs';
import {EXT} from '../core/extensions.mjs';

// Extensions revision 3.2 (CR-X3-24): no slots, no AMD-X1 `bind`. Until signaling Appendix C replaces this package,
// the legacy RTC code keeps working behind its default-off flags with:
//   - the signaling and ice-relay slot manifests republished as ordinary fragments (field attributes `selection` and
//     `consumers`; the ice-relay one is the signaling spec's own fragment, the signaling one keeps the legacy contract
//     at its own URL so it never collides with `…/fragments/signaling/v1`);
//   - the built-in signaling and relay resources implied by the manifest `contracts` list (no occupant declaration);
//   - the provider-to-provider feature as the interim legacy extension EXT.rtcSignalingLegacy (core/extensions.mjs).
// Per-app purpose approval no longer rides the grant (AMD-X1 removed); see packages/runtime/account/rtc.mjs.
// TODO(signaling Appendix C.1 extension.mjs): rebuild as the signaling extension (descriptor, prerequisites, fragments).
export const RTC_FEATURE=EXT.rtcSignalingLegacy;
export const RTC_SIGNALING_FRAGMENT='https://spec.bindle.example/fragments/rtc-signaling/v1';
export const RTC_SIGNALING_CONTRACT='https://spec.bindle.example/contracts/rtc-signaling/v1';
export const ICE_RELAY_FRAGMENT='https://spec.bindle.example/fragments/ice-relay/v1';
export const ICE_RELAY_CONTRACT='https://spec.bindle.example/contracts/ice-relay/v1';
export const RTC_SIGNALING_METHODS=Object.freeze(['register','unregister','endpoints','open','claim','send','renew','listen','mint_ticket']);
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};

/** The legacy signaling fragment: exclusive, application consumers only (an ordinary fragment, extensions §3–§4). */
export const RTC_SIGNALING_FRAGMENT_DOCUMENT=freeze({
 id:RTC_SIGNALING_FRAGMENT,title:'Real-time connections',description:'Lets an application ring you and connect your devices with other devices.',publisher:'https://spec.bindle.example',
 fields:{signaling:{title:'Signaling service',type:'resource',cardinality:{min:0,max:1},contracts:[RTC_SIGNALING_CONTRACT],selection:'exclusive',consumers:['application']}}
});
/** The ice-relay fragment of signaling §3.3 (extensions §11.2): up to four ordered relays, pre-dispatch failover. */
export const ICE_RELAY_FRAGMENT_DOCUMENT=freeze({
 id:ICE_RELAY_FRAGMENT,title:'Connection relays',description:'Relays real-time connections when a direct path is not possible or not allowed.',publisher:'https://spec.bindle.example',
 fields:{relays:{title:'Relays',type:'resource',cardinality:{min:0,max:4},contracts:[ICE_RELAY_CONTRACT],selection:'ordered',consumers:['application','provider']}}
});

/** The legacy extension's options (former `rtc-signaling.v1` members, spec §3.1): `endpoint` on the issuer's origin, `max_leg_certificate_seconds`
 * 120–900. Returns a clean copy or null. Members are exact. */
export function validateRtcFeature(value,{issuer,allowLoopback=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2)return null;
 const url=memberURL(value.endpoint,allowLoopback);if(!url||url.origin!==issuer||!maxLegSecondsValid(value.max_leg_certificate_seconds))return null;
 return {endpoint:value.endpoint,max_leg_certificate_seconds:value.max_leg_certificate_seconds};
}
