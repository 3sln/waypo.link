// Provider features (extensions revision 3.2 §4.2; draft, unsigned). Each 3sln.me provider feature is the one feature of
// its own provider-published extension, identified by its spec URL, and consumes exactly one provider-consumable field of
// a recognized fragment (`consumers` includes `provider`). This module is the single source for:
//   - which features exist and which field and methods each consumes (FEATURE_DEFINITIONS);
//   - each feature's manifest row (PROVIDER_FEATURE_ROWS), spread into packages/runtime/federation.mjs and evaluated
//     by the account-side declarations port with the same mounts (providerFeatureDeclarations), so "the declaration is
//     gone" and "the feature's grants are suspended" are the same fact.
// Pure: no storage. The grants themselves live in the connections domain (packages/apps/connections.mjs).
import {siteGlobal} from '../../flags/read.mjs';
import {EXT,declare} from '../../core/extensions.mjs';
import {MESSAGING_INGRESS_FRAGMENT} from '../../identity/messaging-ingress.mjs';
import {delegationLifetime} from '../../identity/delegation.mjs';
import {memberCertificateLifetime,MEMBER_CERTIFICATE_DEFAULT_SECONDS,MEMBER_REVOCATION_BOUND_SECONDS} from '../../identity/member-certificates.mjs';

export const MAILBOX_CONTRACT='https://spec.bindle.example/messaging/v1/contracts/mailbox';
/** spec URL -> {fragment, field, methods}. Methods per contract are the feature's fixed request (extensions §4.2). */
export const FEATURE_DEFINITIONS=Object.freeze({
 // The email-bridge feature (public-intake `intake` field) was removed on 2026-10-28 (owner direction; revisit later).
 // Bindle Messaging §2.5 (contacts spike CR-X1, provisional): the messaging-mailbox feature replaces the withdrawn
 // messaging-address one. Key delegation certifies the Parlay purposes only through it (identity/delegation.mjs).
 [EXT.messagingMailbox]:Object.freeze({fragment:MESSAGING_INGRESS_FRAGMENT,field:'mailbox',methods:Object.freeze({[MAILBOX_CONTRACT]:Object.freeze(['describe'])})}),
});
/** Suspended grants are revoked after this long of continuous suspension (extensions §4.2). */
export const SUSPENSION_REVOCATION_MS=30*86400000;
/** The scheduled feature sweep (account alarm, packages/runtime/account/connections.mjs connectionsFeatureSweep): how
 * often every account holding an active or suspended feature grant re-evaluates the declarations with nobody reading.
 * A loss is dated from the last evaluation that still saw the declaration (packages/apps/connections.mjs), so the
 * 30-day bound is never late and at most this much early. Same cadence as the 6-hourly lifecycle sweeps. */
export const FEATURE_SWEEP_MS=6*3600000;
/** Messaging §2.5: the mailbox feature's `describe` is mounted only with key delegation, integrations, brokering and a
 * describe port (MESSAGING_DESCRIBE, the brokered consumer call). Contacts spike CR-C0 removed LINKS_ENABLED
 * from it; CR-C7 retired that flag. A host certificate lifetime that does not parse leaves it unmounted (it could not be declared honestly). */
export const messagingMailboxMounted=config=>siteGlobal(config,'KEY_DELEGATION_ENABLED',true)&&siteGlobal(config,'INTEGRATIONS_ENABLED',true)&&siteGlobal(config,'BROKERING_ENABLED',true)&&typeof config.MESSAGING_DESCRIBE==='function'&&delegationLifetime(config.DELEGATION_CERTIFICATE_SECONDS)!==null;
/** The key-delegation options this host declares beside the messaging-mailbox feature: one entry for every certificate
 * profile it issues, so each option is the maximum over them (organizations §14, review M3; provisional): Parlay
 * delegation certificates and, with MEMBER_CERTIFICATES_ENABLED, member certificates and their revocation bound. The
 * directory route's member-certificate entry merges into the published one by the same maximum (core/extensions.mjs
 * OPTION_COMBINE), so the published manifest and the account-side declarations port carry the same options. */
export function messagingKeyDelegationOptions(config={}){
 const options={max_certificate_seconds:delegationLifetime(config?.DELEGATION_CERTIFICATE_SECONDS)??86400};
 if(rowFlag(config??{},'MEMBER_CERTIFICATES_ENABLED')){options.max_certificate_seconds=Math.max(options.max_certificate_seconds,memberCertificateLifetime(config.MEMBER_CERTIFICATE_SECONDS)??MEMBER_CERTIFICATE_DEFAULT_SECONDS);options.revocation_bound_seconds=MEMBER_REVOCATION_BOUND_SECONDS;}
 return options;
}
// The manifest rows of the provider features (packages/runtime/federation.mjs MANIFEST_DECLARATIONS spreads exactly these
// objects), in the registry's row shape {flag, mounted, declare}. Review M2 (2026-10-27): the account-side declarations
// port evaluates the same rows with the same mounts, so a feature counts as declared to its grants exactly when the
// published manifest carries its entry (mount requirements such as BROKERED_INTROSPECTION_MOUNTED included).
export const PROVIDER_FEATURE_ROWS=Object.freeze({
 // Messaging §2.5 (provisional): describe mounted (`mounts.messagingMailbox`). The row also declares its prerequisite,
 // key-delegation (extensions §2.5, messaging §3.2), with this host's delegation certificate lifetime, so both the
 // published manifest and the account-side declarations port hold exactly one key-delegation entry beside it. Its options
 // cover member certificates too when they are on (messagingKeyDelegationOptions); the directory route's member entry
 // merges into it by maximum (routes/directory.mjs, `merge:true`, review M3).
 [EXT.messagingMailbox]:Object.freeze({flag:Object.freeze(['KEY_DELEGATION_ENABLED','INTEGRATIONS_ENABLED','BROKERING_ENABLED','EXTENSIONS_ENABLED']),mounted:c=>c.target==='authority'&&c.mounts?.messagingMailbox===true,declare:c=>({extensions:[declare(EXT.keyDelegation,messagingKeyDelegationOptions(c?.config)),declare(EXT.messagingMailbox)]})}),
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
 const extensions=Object.keys(FEATURE_DEFINITIONS).filter(spec=>providerFeatureDeclared(config,spec,mounts)).flatMap(spec=>PROVIDER_FEATURE_ROWS[spec].declare({config,issuer:config.APP_ORIGIN,target:'authority',mounts:mounts??{}}).extensions);
 return {issuer:config.APP_ORIGIN,extensions};
}
/** Extension versions the operator blocked (extensions §7): EXTENSION_BLOCKLIST, a JSON array or comma list of URLs. */
export function blockedExtensions(config={}){
 const raw=config.EXTENSION_BLOCKLIST;if(raw===undefined||raw==='')return [];
 let list;try{list=Array.isArray(raw)?raw:String(raw).trim().startsWith('[')?JSON.parse(raw):String(raw).split(',');}catch{return [];}
 return list.map(value=>String(value).trim()).filter(Boolean).slice(0,64);
}
