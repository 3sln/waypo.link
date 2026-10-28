// Provider features (extensions revision 3.2 §4.2; draft, unsigned). Each 3sln.me provider feature is the one feature of
// its own provider-published extension, identified by its spec URL, and consumes exactly one provider-consumable field of
// a recognized fragment (`consumers` includes `provider`). This module is the single source for:
//   - which features exist and which field and methods each consumes (FEATURE_DEFINITIONS);
//   - each feature's manifest row (PROVIDER_FEATURE_ROWS), spread into packages/runtime/federation.mjs and evaluated
//     by the account-side declarations port with the same mounts (providerFeatureDeclarations), so "the declaration is
//     gone" and "the feature's grants are suspended" are the same fact.
// Pure: no storage. The grants themselves live in the connections domain (packages/apps/connections.mjs).
import {siteGlobal} from '../../flags/read.mjs';
import {PROVIDER_EXT,declare} from '../../core/extensions.mjs';
import {PUBLIC_INTAKE_FRAGMENT,PUBLIC_INTAKE_CONTRACT,MESSAGING_INGRESS_FRAGMENT} from '../../links/types.mjs';
import {bridgeConfig} from '../../email-bridge/engine.mjs';

export const MAILBOX_CONTRACT='https://spec.bindle.example/messaging/v1/contracts/mailbox';
/** spec URL -> {fragment, field, methods}. Methods per contract are the feature's fixed request (extensions §4.2). */
export const FEATURE_DEFINITIONS=Object.freeze({
 [PROVIDER_EXT.emailBridge]:Object.freeze({fragment:PUBLIC_INTAKE_FRAGMENT,field:'intake',methods:Object.freeze({[PUBLIC_INTAKE_CONTRACT]:Object.freeze(['deliver'])})}),
 [PROVIDER_EXT.messagingAddress]:Object.freeze({fragment:MESSAGING_INGRESS_FRAGMENT,field:'ingress',methods:Object.freeze({[MAILBOX_CONTRACT]:Object.freeze(['describe'])})}),
});
/** Suspended grants are revoked after this long of continuous suspension (extensions §4.2). */
export const SUSPENSION_REVOCATION_MS=30*86400000;
/** The scheduled feature sweep (account alarm, packages/runtime/account/connections.mjs connectionsFeatureSweep): how
 * often every account holding an active or suspended feature grant re-evaluates the declarations with nobody reading.
 * A loss is dated from the last evaluation that still saw the declaration (packages/apps/connections.mjs), so the
 * 30-day bound is never late and at most this much early. Same cadence as the 6-hourly lifecycle sweeps. */
export const FEATURE_SWEEP_MS=6*3600000;
/** BB-C1b: the messaging-address handoff is mounted only with LINKS, INTEGRATIONS and a describe port. */
export const messagingAddressMounted=config=>siteGlobal(config,'LINKS_ENABLED',true)&&siteGlobal(config,'INTEGRATIONS_ENABLED',true)&&typeof config.MESSAGING_DESCRIBE==='function';
// The manifest rows of the provider features (packages/runtime/federation.mjs MANIFEST_DECLARATIONS spreads exactly these
// objects), in the registry's row shape {flag, mounted, declare}. Review M2 (2026-10-27): the account-side declarations
// port evaluates the same rows with the same mounts, so a feature counts as declared to its grants exactly when the
// published manifest carries its entry (mount requirements such as BROKERED_INTROSPECTION_MOUNTED included).
export const PROVIDER_FEATURE_ROWS=Object.freeze({
 // BB-C1b: the descriptor handoff must be mounted (`mounts.messagingAddress`). Withdrawn by the contacts spike (CL-4);
 // kept until that code path is removed.
 [PROVIDER_EXT.messagingAddress]:Object.freeze({flag:Object.freeze(['LINKS_ENABLED','EXTENSIONS_ENABLED']),mounted:c=>c.target==='authority'&&c.mounts?.messagingAddress===true,declare:()=>({extensions:[declare(PROVIDER_EXT.messagingAddress)]})}),
 // Extensions rev 3.2 (§11.1, Q2 provisional): integrations and brokered resources mounted, and a configured bridge.
 [PROVIDER_EXT.emailBridge]:Object.freeze({flag:Object.freeze(['EMAIL_BRIDGE_ENABLED','INTEGRATIONS_ENABLED','BROKERING_ENABLED','EXTENSIONS_ENABLED']),mounted:c=>c.target==='authority'&&c.mounts?.integrations===true&&c.mounts?.brokeredResources===true&&bridgeConfig(c.config).enabled===true,declare:()=>({extensions:[declare(PROVIDER_EXT.emailBridge)]})}),
});
// The manifest registry's flag rule (packages/federation/runtime.mjs createManifestDeclarationProvider): an explicit
// true or "true" in the surfaced configuration. Never a populated key alone.
const rowFlag=(config,name)=>Object.hasOwn(config,name)&&(config[name]===true||config[name]==='true');
/** Whether this provider declares `spec` under the surfaced `config` and the adapter's `mounts` (the same evidence the
 * authority manifest is built from), by the feature's own manifest row. */
export function providerFeatureDeclared(config={},spec,mounts={}){
 const row=Object.hasOwn(PROVIDER_FEATURE_ROWS,spec)?PROVIDER_FEATURE_ROWS[spec]:null;if(!row)return false;
 return row.flag.every(name=>rowFlag(config,name))&&row.mounted({config,issuer:config.APP_ORIGIN,target:'authority',mounts:mounts??{}})===true;
}
/** The provider's own feature declarations as a manifest fragment ({issuer, extensions}), for the declarations port. */
export function providerFeatureDeclarations(config={},mounts={}){
 const extensions=Object.keys(FEATURE_DEFINITIONS).filter(spec=>providerFeatureDeclared(config,spec,mounts)).flatMap(spec=>PROVIDER_FEATURE_ROWS[spec].declare().extensions);
 return {issuer:config.APP_ORIGIN,extensions};
}
/** Extension versions the operator blocked (extensions §7): EXTENSION_BLOCKLIST, a JSON array or comma list of URLs. */
export function blockedExtensions(config={}){
 const raw=config.EXTENSION_BLOCKLIST;if(raw===undefined||raw==='')return [];
 let list;try{list=Array.isArray(raw)?raw:String(raw).trim().startsWith('[')?JSON.parse(raw):String(raw).split(',');}catch{return [];}
 return list.map(value=>String(value).trim()).filter(Boolean).slice(0,64);
}
