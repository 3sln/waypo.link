/**
 * FF-1 registry contract (host behaviour, not protocol). FLAGS[name] is immutable:
 * {name,class,type,safe,onValue,dimensions,requires,risk,outage,gates,gateReferences,
 * experiment,stateful,retainExisting,placement,client,narrowOnly,derived,envDefault,
 * envDefaults,envParse}. requires are flag names; dependencyMode may select global.
 * envDefault is the raw Worker default; envDefaults.node pins adapter differences.
 * gates are release-status IDs; gateReferences point at the unsigned release ledger.
 * Experiment metric names are server-side event names, never arbitrary client input.
 * Consumers use flags.for(ctx): {version,evaluate(name),enabled(name),global(name),
 * background(name),envState(name)}; evaluate returns {value,reason,variant?,experimentId?}.
 * See snapshot.mjs for the persisted {v:1,version,issuedAt,flags} schema.
 */
export const GATE_SOURCE='docs/release/open-items.md#2-per-feature-flag-gates-before-enabling-in-production';
export const GATE_REVISION='da57c7b1a49b7b2878ac8c329915ea0be4925cc3edad9e51bd4261e52f519c22';
const common=['cloudflareTurnstileProductionConfigured','cloudflareBotProtectionVerified','realBrowserFlowsPassing','durableStorageAndArchiveRecoveryVerified','notificationTransportsVerified','emailLifecycleVerified','storageProviderConformanceVerified','federatedOAuthConformanceVerified','generalPreferenceConsentComplete','webArchiveRenderingComplete','lifecycleNoticesAndDeletionVerified','securityRedTeamFindingsResolved','termsAndPrivacyApproved'];
export const RELEASE_GATES=Object.freeze(common);
const rows=[
 ['ARTEFACT_VERSIONS_ENABLED','a','G',{risk:'crit',stateful:true,retainExisting:false,retentionReason:'Pins and records live in the provider-wide artefact store; no account-local predicate.',envParse:'boolean'}],
 ['INTENT_LINKS_ENABLED','a','G A S P C',{risk:'crit',requires:['ARTEFACT_VERSIONS_ENABLED'],stateful:true,client:true,envParse:'boolean'}],
 ['INTENT_APP_HANDLERS_ENABLED','a','G A S P C',{risk:'crit',requires:['INTENT_LINKS_ENABLED','CLIENT_METADATA_ENABLED'],envParse:'boolean'}],
 ['SIGNED_INTENTS_ENABLED','c','G',{risk:'crit',requires:['INTENT_LINKS_ENABLED'],envParse:'boolean'}],
 ['ACTIVITY_V2_ENABLED','a','G A S P C V',{stateful:true,client:true,experiment:{metrics:['activity_opened']},envParse:'boolean'}],
 ['EVENT_BUSES_ENABLED','a','G A S P',{stateful:true,envParse:'boolean'}],
 ['INTEGRATIONS_ENABLED','a','G A S P C',{risk:'crit',stateful:true,envParse:'boolean'}],
 ['APP_CLEAN_REMOVAL_ENABLED','a','G A S P C',{risk:'crit',stateful:true,retainExisting:false,retentionReason:'Open removals always conclude and remind regardless of flag state.',requires:['INTEGRATIONS_ENABLED'],envParse:'boolean'}],
 ['SUBJECT_DELETED_EVENTS_ENABLED','a','G',{risk:'crit',requires:['INTEGRATIONS_ENABLED'],envParse:'boolean'}],
 ['INCREMENTAL_AUTH_ENABLED','a','G A S P C',{risk:'crit',requires:['FEDERATION_ENABLED'],stateful:true,retainExisting:false,retentionReason:'Pending requests and grants live in federation stores; no account-local predicate.',envParse:'boolean'}],
 ['EXTENSIONS_ENABLED','a','G A C',{stateful:true,envParse:'boolean'}],
 ['BINDLEBOX_ENABLED','a','G A S P',{stateful:true,envParse:'boolean'}],
 ['EMAIL_BRIDGE_ENABLED','a','G A S P',{risk:'crit',requires:['BINDLEBOX_ENABLED'],stateful:true,retainExisting:false,retentionReason:'Holding queues and opt-in live in the external email-bridge store; no account-local predicate.',envParse:'boolean'}],
 ['SEMANTIC_SEARCH_ENABLED','a','G A S P V',{experiment:{metrics:['search_result_opened']},capabilities:['AI','SEARCH_VECTORS']}],
 ['BEAM_ENABLED','a','G A S P V',{stateful:true,experiment:{metrics:['beam_completed']}}],
 ['DEVICE_AUTHORIZATION_ENABLED','a','G A C',{risk:'crit',stateful:true,retainExisting:false,retentionReason:'Linked requests and lineages live in identity stores; session authorization is independent of federation.',envParse:'boolean'}],
 ['APP_METADATA_DISCOVERY_ENABLED','a','G C',{}],
 ['ACCOUNT_EXPORT_ENABLED','a','G A S P',{risk:'crit',stateful:true,envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','durableStorageAndArchiveRecoveryVerified','notificationTransportsVerified','securityRedTeamFindingsResolved']}],
 ['OVER_QUOTA_RETENTION_ENABLED','a','G A S P',{risk:'crit',stateful:true,retainExisting:false,retentionReason:'The producer follows the flag kill switch; persisted episodes remain read-only evidence when disabled.',envParse:'boolean'}],
 ['ACCOUNT_DELETION_ENABLED','a','G A S P',{risk:'crit',stateful:true,envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','lifecycleNoticesAndDeletionVerified','emailLifecycleVerified','notificationTransportsVerified','durableStorageAndArchiveRecoveryVerified','securityRedTeamFindingsResolved']}],
 ['EMAIL_REMOVAL_ENABLED','a','G A S P',{risk:'crit',envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','emailLifecycleVerified','lifecycleNoticesAndDeletionVerified']}],
 // Identity portability PORT-2/PORT-3 (identity-portability design §10.2). Gates NEW transfers only: pending transfers,
 // statements, commits and steps follow the env kill switch (background), so a ramp-down never strands a move, and
 // committed redirects are a commitment that no flag gates. Cancellation and disputes are never gated.
 ['IDENTITY_TRANSFER_OUT_ENABLED','a','G A S P',{risk:'crit',stateful:true,retainExisting:false,retentionReason:'Pending transfers continue under the env kill switch (background), not the evaluated flag; committed redirects are never flag-gated.',envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','securityRedTeamFindingsResolved','lifecycleNoticesAndDeletionVerified','notificationTransportsVerified']}],
 // Organizations phase A (organizations design §13.1, ORG-0/ORG-1). Gates creation and exposure; an existing
 // organization's own account (and its owner of record's index) is retained, and cancelling a scheduled deletion is never
 // gated. The subject is the organization's account, or the creating person for creation.
 ['ORGANIZATIONS_ENABLED','a','G A',{risk:'crit',stateful:true,envParse:'boolean'}],
 // ORG-4 (organizations design §13.1). 3sln.me as a HOME provider issuing member certificates: gates consent and
 // issuance only; listing, revocation and status are never gated. Subject: the member's account.
 ['MEMBER_CERTIFICATES_ENABLED','a','G A',{risk:'crit',requires:['DIRECTORY_ENABLED'],stateful:true,retainExisting:false,retentionReason:'Consents and keys persist and stay listable, revocable and status-checked; narrowing stops new consent and issuance, and outstanding certificates expire within the issuer lifetime.',envParse:'boolean'}],
 // ORG-4. Verifying certificates from OTHER issuers (outbound directory fetches): the kill switch for that SSRF surface,
 // also behind an issuer allowlist that is empty by default (R2-M6). Same-host members keep working. Subject: the organization.
 ['ORG_FOREIGN_MEMBERS_ENABLED','a','G A',{risk:'crit',requires:['ORGANIZATIONS_ENABLED'],stateful:true,retainExisting:false,retentionReason:'A kill switch: foreign issuers stop being verified at once; same-host members are unaffected.',envParse:'boolean'}],
 // ORG-12 break-glass (organizations design §12d.12). Gates STARTING a claim and its EFFECT only: with it off, pending
 // claims stay pending and cannot take effect; aborts, withdrawals, objections, support holds and aborts, and refunds are
 // never gated (abort is the safe direction). Subject: the organization's account.
 ['ORG_BREAK_GLASS_ENABLED','a','G A',{risk:'crit',requires:['ORGANIZATIONS_ENABLED'],stateful:true,retainExisting:false,retentionReason:'Pending claims stay pending and can never take effect while it is off; aborts, withdrawals, objections, support holds and refunds are never gated.',envParse:'boolean'}],
 // ORG-10 relations (organizations design §8b.10, RL-1). Gates NEW relations only: creating instances, inviting,
 // accepting, redemption of a new edge and resuming. Narrowing (suspend, end, narrow, withdraw, decline, leave, mute),
 // inbound revocation events and export are never gated, so turning it off leaves existing edges readable and endable.
 // Subject: the organization's account.
 ['ORG_RELATIONS_ENABLED','a','G A',{risk:'crit',requires:['ORGANIZATIONS_ENABLED','DIRECTORY_ENABLED'],stateful:true,retainExisting:false,retentionReason:'Existing edges stay readable, narrowable and endable; only new instances, invitations, acceptances and resumptions stop. Narrowing, leaving, inbound revocation and export are never gated.',envParse:'boolean'}],
 // ORG-11 kill switch: every outbound fetch or POST to another provider for relations and accepting foreign redemptions,
 // certificates and events. Also needs the foreign-issuer allowlist (R2-M6). Local narrowing is never gated; outbound
 // events stay queued while it is off. ORG-11 transport is not implemented, so foreign counterparts are refused today.
 ['ORG_FOREIGN_RELATIONS_ENABLED','a','G A',{risk:'crit',requires:['ORG_RELATIONS_ENABLED'],stateful:true,retainExisting:false,retentionReason:'A kill switch: cross-provider relation egress and foreign redemptions stop at once; local narrowing is never gated and outbound events stay queued.',envParse:'boolean'}],
 ['SIGNUP_ENABLED','c','G R',{risk:'crit',outage:'last-known'}],
 ['PAID_SIGNUP_ENABLED','c','G R',{risk:'crit',outage:'last-known',capabilities:['billing-configuration']}],
 ['WAITLIST_ENABLED','c','G R',{outage:'last-known'}],
 ['FEDERATION_ENABLED','c','G',{risk:'crit',outage:'last-known'}],
 ['BROKERING_ENABLED','c','G C',{risk:'crit',outage:'last-known',requires:['INTEGRATIONS_ENABLED'],dependencyMode:'global',envParse:'boolean'}],
 ['MCP_ENABLED','c','G C',{risk:'crit',outage:'last-known'}],
 ['CLIENT_METADATA_ENABLED','c','G',{risk:'crit'}],
 ['DIRECTORY_ENABLED','c','G',{risk:'crit',envParse:'boolean'}],
 // Identity portability PORT-4/PORT-5 (identity-portability design §10.2). Transfer-in gates new intakes and begins
 // only: polling, activation and cancellation of an existing transfer-in follow the env kill switch (background), so a
 // ramp-down never strands an identity whose source already committed. Adoption off: verifiers adopt no move.
 ['IDENTITY_TRANSFER_IN_ENABLED','c','G',{risk:'crit',requires:['SIGNUP_ENABLED'],envParse:'boolean'}],
 ['IDENTITY_SUCCESSOR_ADOPTION_ENABLED','c','G',{risk:'crit',envParse:'boolean'}],
 ['LIFECYCLE_DRY_RUN','c','G',{safe:true,onValue:true,narrowOnly:true,risk:'crit',envDefault:true,envParse:'not-false-boolean'}],
 ['LIFECYCLE_ENABLED','b','',{envParse:'boolean'}],['LIFECYCLE_PURGE_ENABLED','b','',{}],
 ['WORK_LIMITS_ENABLED','b','',{safe:true,envParse:'work-authority',envDefaults:{node:'true'}}],
 ['STORAGE_WRITE_ENABLED','b','',{safe:true,envParse:'boolean',envDefaults:{node:'true'}}],
 ['REDIRECT_EXTENSION_ENABLED','b','',{requires:['BILLING_ENABLED'],envParse:'boolean'}],
 ['BILLING_ENABLED','b','',{}],['MAIL_ENABLED','b','',{}],['PUSH_ENABLED','b','',{}],['BEAM_TURN_ENABLED','b','',{}],
 ['BEAM_STUN_ENABLED','b','',{envDefaults:{node:'true'}}],
 ['FEDERATION_REFRESH_ENABLED','b','',{safe:true,envDefault:true,envParse:'not-false'}],
 // Browser automation kill switch (wargame 3). It shipped always-on, so it stays default on; env 'false' refuses tool
 // discovery, grants, prepare, confirm and invoke. Revoking a session grant is never gated (the safe direction).
 ['BROWSER_AUTOMATION_ENABLED','b','',{safe:true,envDefault:true,envParse:'not-false'}],
 ['FEDERATION_ENTRY_ENABLED','b','',{}],['ONBOARDING_ENABLED','b','',{}],['ADMIN_ENABLED','b','',{}],
 ['ADMIN_CLAIMS_ENABLED','b','',{derived:true,envParse:'true-only'}],
 ['BROKERED_INTROSPECTION_MOUNTED','b','',{derived:true,envParse:'true-only',parent:'BROKERING_ENABLED'}],
 ['EVENT_BUS_WAITS_MOUNTED','b','',{derived:true,envParse:'true-only',parent:'EVENT_BUSES_ENABLED'}],
 ['PUSH_AVAILABLE','b','',{derived:true,envParse:'true-only'}],['EMAIL_AVAILABLE','b','',{derived:true,envParse:'true-only'}],
 ['EMAIL_SETUP_AVAILABLE','b','',{derived:true,envParse:'true-only'}],['WAITLIST_MAIL_AVAILABLE','b','',{derived:true,envParse:'true-only'}]
];
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const FLAGS=freeze(Object.fromEntries(rows.map(([name,kind,dimensions,extra])=>[name,{name,class:kind,type:'boolean',safe:false,onValue:true,dimensions:dimensions?dimensions.split(' '):[],requires:[],risk:kind==='b'?null:'std',outage:kind==='b'?null:'safe',gates:[...common],gateReferences:[GATE_SOURCE],gateRevision:GATE_REVISION,experiment:null,stateful:false,retainExisting:false,placement:extra.stateful?'account':'edge',client:false,narrowOnly:false,derived:false,envDefault:undefined,envDefaults:{},envParse:'string',...extra,...extra.stateful?{retainExisting:extra.retainExisting??true,...extra.retainExisting===false?{}:{hasState:name}}:{}}])));
export const registry=FLAGS;
export const FLAG_NAMES=Object.freeze(Object.keys(FLAGS));
/** Wargame 4 L5: names removed from the registry. A deployment may still store a console record for one; that record is
 * quarantined (only that flag falls back) until an operator runs the audited critical `flags.retire`. Removing a flag
 * means moving it here with the date; tests/flags-registry-removals.test.mjs guards the move. */
export const RETIRED_FLAGS=Object.freeze({});
export function getFlag(name){if(typeof name!=='string'||!Object.hasOwn(FLAGS,name))throw Object.assign(new TypeError(`Unknown flag: ${String(name)}`),{code:'unknown_flag'});return FLAGS[name];}
export function validateRegistry(entries=FLAGS){
 const seen=new Set(),active=new Set();
 function visit(name){if(active.has(name))throw new TypeError(`Flag dependency cycle: ${name}`);if(seen.has(name))return;const f=entries[name];if(!f)throw new TypeError(`Unknown flag dependency: ${name}`);active.add(name);for(const dep of f.requires)visit(dep);active.delete(name);seen.add(name);}
 for(const [name,f]of Object.entries(entries)){if(f.stateful&&f.dimensions.includes('R')||f.experiment&&(f.risk==='crit'||!f.dimensions.includes('V'))||f.class==='b'&&f.dimensions.length)throw new TypeError(`Invalid flag declaration: ${name}`);visit(name);}return entries;
}
validateRegistry();
