// The signaling extension in the extensions revision 3.2 shape (docs/spec/extensions/signaling.md §3.1–§3.3, §10.1;
// docs/spec/extensions.md §2.3, §11.2). Constants and pure validators only: nothing here declares the extension or
// mounts a resource (packages/runtime/federation.mjs does, behind SIGNALING_ENABLED and SIGNALING_FOREIGN_ENABLED,
// default off). Provisional (coordinator), not signed off by the user.
//
// Appendix C.1 extension.mjs (CR-X3-24): the descriptor and its options validator (`endpoint` audience,
// `max_leg_certificate_seconds`, `profiles`), the prerequisite check (directory, artefact-versions), and the two
// fragments with `selection` and `consumers`. No slot, `bind` or AMD-X1 bound-artefact table. The descriptor itself is
// held in packages/core/extensions.mjs (BINDLE_DESCRIPTORS, EXT.signaling) beside the other Bindle-owned ones.
import {EXT,BINDLE_REGISTRY,PREREQUISITES,validateOptions} from '../core/extensions.mjs';
import {maxLegSecondsValid} from './certificates.mjs';
import {PROFILES} from './messages.mjs';

export const SIGNALING_EXTENSION=EXT.signaling;
export const SIGNALING_FRAGMENT='https://spec.bindle.example/fragments/signaling/v1';
export const SIGNALING_CONTRACT='https://spec.bindle.example/contracts/signaling/v1';
export const ICE_RELAY_FRAGMENT='https://spec.bindle.example/fragments/ice-relay/v1';
export const ICE_RELAY_CONTRACT='https://spec.bindle.example/contracts/ice-relay/v1';
/** This host's provider-to-provider endpoint path (the declaration's `endpoint`, §3.1, §9.1). */
export const SIGNALING_ENDPOINT_PATH='/bindle/signaling';
/** §10.2: the contract's methods (wire names). */
export const SIGNALING_METHODS=Object.freeze(['register','unregister','endpoints','open','offer','revoke_offer','claim','send','renew','listen']);
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};

/** §3.2: the signaling fragment: exclusive, application and provider consumers, the non-brokerable built-in contract. */
export const SIGNALING_FRAGMENT_DOCUMENT=freeze({
 id:SIGNALING_FRAGMENT,title:'Signaling',description:'Lets an app or a provider feature set up direct connections between your devices and other people\'s, for the kinds you approve.',publisher:'https://spec.bindle.example',
 fields:{signaling:{title:'Signaling service',type:'resource',cardinality:{min:0,max:1},contracts:[SIGNALING_CONTRACT],selection:'exclusive',consumers:['application','provider']}}
});
/** §3.3: the ice-relay fragment: up to four ordered relays, pre-dispatch failover, application and provider consumers. */
export const ICE_RELAY_FRAGMENT_DOCUMENT=freeze({
 id:ICE_RELAY_FRAGMENT,title:'Connection relays',description:'Relays direct connections when a direct path is not possible or not allowed.',publisher:'https://spec.bindle.example',
 fields:{relays:{title:'Relays',type:'resource',cardinality:{min:0,max:4},contracts:[ICE_RELAY_CONTRACT],selection:'ordered',consumers:['application','provider']}}
});

/** The prerequisites §3.1 names in prose (exactly one entry each, no recursion; extensions §2.5). */
export const SIGNALING_PREREQUISITES=PREREQUISITES[EXT.signaling];
/**
 * The signaling options of one issuer (§3.1), after the generic descriptor validation (extensions §2.4): `endpoint` on
 * the issuer origin, `max_leg_certificate_seconds` 120–900, `profiles` a nonempty, unique, ascending subset of the
 * registered profiles. Returns a clean copy or null. Prerequisites and audience distinctness are checked by
 * readExtensions over the whole manifest; this validates an already extracted options object (the roster's cache).
 */
export function validateSignalingOptions(value,{issuer,allowLoopback=false}={}){
 const descriptor=BINDLE_REGISTRY.get(EXT.signaling);if(!descriptor)return null;
 const clean=validateOptions(descriptor,value,{issuer,allowInsecureLocalhost:allowLoopback});
 if(!clean||!maxLegSecondsValid(clean.max_leg_certificate_seconds))return null;
 const p=clean.profiles;if(!Array.isArray(p)||!p.length||!p.every((x,i)=>PROFILES.includes(x)&&(i===0||p[i-1]<x)))return null;
 return {endpoint:clean.endpoint,max_leg_certificate_seconds:clean.max_leg_certificate_seconds,profiles:[...p]};
}
/** The declaration this host emits (§3.1): its endpoint, the leg certificate bound it issues, and its profiles. */
export const signalingDeclaration=({issuer,endpointPath,maxLegSeconds,profiles=PROFILES})=>({spec:EXT.signaling,options:{endpoint:issuer+endpointPath,max_leg_certificate_seconds:maxLegSeconds,profiles:[...profiles]}});
