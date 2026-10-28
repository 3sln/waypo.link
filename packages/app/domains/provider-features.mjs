// Provider features (extensions revision 3.2 §4.2; draft, unsigned). Each 3sln.me provider feature is the one feature of
// its own provider-published extension, identified by its spec URL, and consumes exactly one provider-consumable field of
// a recognized fragment (`consumers` includes `provider`). This module is the single source for:
//   - which features exist and which field and methods each consumes (FEATURE_DEFINITIONS);
//   - whether the provider validly declares a feature right now (providerFeatureDeclared), used both by the manifest row
//     in packages/runtime/federation.mjs and by the account-side declarations port, so "the declaration is gone" and
//     "the feature's grants are suspended" are the same fact.
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
/** BB-C1b: the messaging-address handoff is mounted only with LINKS, INTEGRATIONS and a describe port. */
export const messagingAddressMounted=config=>siteGlobal(config,'LINKS_ENABLED',true)&&siteGlobal(config,'INTEGRATIONS_ENABLED',true)&&typeof config.MESSAGING_DESCRIBE==='function';
/** Whether this provider declares `spec` under `config` (flags and mounted evidence only; never a populated key alone). */
export function providerFeatureDeclared(config={},spec){
 if(!siteGlobal(config,'EXTENSIONS_ENABLED'))return false;
 if(spec===PROVIDER_EXT.emailBridge)return siteGlobal(config,'EMAIL_BRIDGE_ENABLED')&&siteGlobal(config,'INTEGRATIONS_ENABLED')&&siteGlobal(config,'BROKERING_ENABLED')&&bridgeConfig(config).enabled===true;
 if(spec===PROVIDER_EXT.messagingAddress)return messagingAddressMounted(config);
 return false;
}
/** The provider's own feature declarations as a manifest fragment ({issuer, extensions}), for the declarations port. */
export function providerFeatureDeclarations(config={}){
 const extensions=Object.keys(FEATURE_DEFINITIONS).filter(spec=>providerFeatureDeclared(config,spec)).map(spec=>declare(spec));
 return {issuer:config.APP_ORIGIN,extensions};
}
/** Extension versions the operator blocked (extensions §7): EXTENSION_BLOCKLIST, a JSON array or comma list of URLs. */
export function blockedExtensions(config={}){
 const raw=config.EXTENSION_BLOCKLIST;if(raw===undefined||raw==='')return [];
 let list;try{list=Array.isArray(raw)?raw:String(raw).trim().startsWith('[')?JSON.parse(raw):String(raw).split(',');}catch{return [];}
 return list.map(value=>String(value).trim()).filter(Boolean).slice(0,64);
}
