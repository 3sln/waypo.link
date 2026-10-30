// Flag profiles for the simulation (spike §3.4). Every value is set explicitly and written to the run manifest, so a
// pass is tied to exactly this profile. Flags that production keeps off are on here; a simulation pass is never cited
// as meeting their production gates.
export const PROFILES=Object.freeze({
 sim:Object.freeze({
  SIGNUP_ENABLED:'true',
  FEDERATION_ENABLED:'true',
  FEDERATION_ENTRY_ENABLED:'true',
  CLIENT_METADATA_ENABLED:'true',
  INTEGRATIONS_ENABLED:'true',
  BROKERING_ENABLED:'true',
  APP_CLEAN_REMOVAL_ENABLED:'true',
  SUBJECT_DELETED_EVENTS_ENABLED:'true',
  ARTEFACT_VERSIONS_ENABLED:'true',
  INTENT_LINKS_ENABLED:'true',
  INTENT_APP_HANDLERS_ENABLED:'true',
  INCREMENTAL_AUTH_ENABLED:'true',
  EXTENSIONS_ENABLED:'true',
  SESSION_KINDS_ENABLED:'true',
  SIGNALING_ENABLED:'true',
  SIGNALING_FOREIGN_ENABLED:'true',
  DIRECTORY_ENABLED:'true',
  EVENT_BUSES_ENABLED:'true',
  ORGANIZATIONS_ENABLED:'true',
  ORG_FOREIGN_MEMBERS_ENABLED:'true',
  ORG_RELATIONS_ENABLED:'true',
  ORG_FOREIGN_RELATIONS_ENABLED:'true',
  MEMBER_CERTIFICATES_ENABLED:'true',
  // Explicitly off in this profile (recorded so a reader does not have to know the defaults).
  KEY_DELEGATION_ENABLED:'false',
  EMAIL_FLOW_V2:'false',
  EMAIL_SIGNUP_ENABLED:'false',
  PAID_SIGNUP_ENABLED:'false',
  WAITLIST_ENABLED:'false',
  BILLING_ENABLED:'false',
  MAIL_ENABLED:'false',
  PUSH_ENABLED:'false',
  LIFECYCLE_ENABLED:'false',
  ACCOUNT_DELETION_ENABLED:'false',
  IDENTITY_TRANSFER_OUT_ENABLED:'false',
  IDENTITY_TRANSFER_IN_ENABLED:'false',
  MCP_ENABLED:'false'
 })
});

/** Operator settings (not flags) every simulated provider runs with, recorded beside the profile. Each person has their
 * own address (TRUSTED_CLIENT_IP_HEADER); the signup windows are sized for a throwaway world in which every signup also
 * shares one region ("unknown") and the global windows. */
export const OPERATOR_SETTINGS=Object.freeze({
 RELEASE_READY:'false',
 SIGNUP_CONTACT_REQUIRED:'false',
 SIGNUP_IP_WINDOW_MS:'1000',SIGNUP_IP_DAILY_LIMIT:'1000',SIGNUP_SUBNET_DAILY_LIMIT:'1000',
 SIGNUP_REGION_HOURLY_LIMIT:'1000',SIGNUP_REGION_DAILY_LIMIT:'1000',SIGNUP_GLOBAL_HOURLY_LIMIT:'1000',SIGNUP_GLOBAL_DAILY_LIMIT:'1000',
 REGION_POLICY:'allow-unknown',
 // Each simulated person has their own address, carried by the simulation's listener as a trusted proxy header.
 TRUSTED_CLIENT_IP_HEADER:'x-sim-client-ip',
 TURNSTILE_SITE_KEY:'sim-turnstile-site-key',TURNSTILE_SECRET_KEY:'sim-turnstile-secret'
});
