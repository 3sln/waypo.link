// Bindle Messaging interop v1 identifiers, signature domains and limits (docs/spec/messaging.md §1, §5.2, §11).
// Placeholder identifiers under spec.bindle.example until publication authority is agreed.
const SPEC='https://spec.bindle.example/messaging/v1';
export const PROFILE=SPEC;
// Extensions rev 3.2 (CR-X3-27): former slot URLs become fragment URLs.
export const INGRESS_FRAGMENT='https://spec.bindle.example/fragments/messaging-ingress/v1';
export const MAILBOX_CONTRACT=`${SPEC}/contracts/mailbox`;
// Invitations (spec §4; contacts spike CL-5, provisional, unsigned): the `connect` intent kind and the redemption credential.
export const CONNECT_INTENT=`${SPEC}/intents/connect`;
export const INVITE_SCHEME='BindleInvite';
export const INTAKE_FRAGMENT='https://spec.bindle.example/fragments/public-intake/v1';
export const INTAKE_CONTRACT='https://spec.bindle.example/contracts/public-intake/v1';
export const INTAKE_MEDIA_TYPE='application/vnd.bindle.messaging.intake+json';
export const PURPOSES=Object.freeze({author:`${SPEC}/purposes/author`,receipt:`${SPEC}/purposes/receipt`,archive:`${SPEC}/purposes/archive`});
// Every signed object has its own prefix; none is a prefix of another or of any bindle-contact-* domain.
export const DOMAINS=Object.freeze({envelope:'bindle-messaging-envelope-v1\n',genesis:'bindle-messaging-genesis-v1\n',receipt:'bindle-messaging-receipt-v1\n',invitationResponse:'bindle-messaging-invitation-response-v1\n'});
export const PAIR_DOMAIN='bindle-messaging-pair-v1\n';
export const HELLO_INCARNATION='hello';
export const RECEIPT_PURPOSE='bindle-messaging-receipt-v1';
export const JWS_TYPES=Object.freeze({delegation:'bindle-key-delegation+jwt',provenance:'bindle-intake-provenance+jwt'});
export const KINDS=Object.freeze(['conversation-init','one-off','conversation-record']);
export const RECORD_TYPES=Object.freeze(['message','edit','retract','peer-proposal','peer-response','peer-hello','rotate','rejoin','secret-share','leave','ingress']);
// §3.4 lists the lasting-effect records; secret-share is added because it installs a conversation secret (review B1-F, provisional).
export const STATUS_REQUIRED_RECORDS=Object.freeze(['edit','retract','rotate','leave','ingress','peer-proposal','peer-response','peer-hello','rejoin','secret-share']);
export const LIMITS=Object.freeze({maxParticipants:32,maxBodyBytes:1048576,maxEnvelopeBytes:65536,maxRequestBytes:1500000,maxBatchContexts:32,maxBatchBytes:524288,maxParents:8,maxPlaceholders:64,maxPendingMutations:64,maxGapExceptions:256,maxCounterJump:1024,maxPendingProposals:16,maxCertificateSeconds:86400,statusCacheMs:300000,descriptorCacheMs:3600000,clockSkewMs:60000,firstContactWindowMs:86400000,recordWindowMs:604800000,rotationOverlapMs:604800000,retentionMs:777600000,maxInvitationResponseBytes:8192,maxBootstrapMs:604800000,maxCompactChars:8192,maxSubjectPoints:200,maxTags:32,maxProfiles:16,maxVerifies:64,maxIntakeParts:16,maxHeaderChars:8192});
// §8.3 plus the RPC envelope codes of protocol §5. A status alone never carries classification or policy state.
export const ERRORS=Object.freeze({malformed:400,envelope_expired:400,counter_gap:400,clock_skew:400,invite_invalid:401,author_unverifiable:401,author_required:403,not_authorized:403,participants_exceeded:403,record_forbidden:403,operation_conflict:409,incarnation_stale:409,invitation_used:409,invitation_expired:410,ingress_moved:410,too_large:413,record_unsupported:415,unsupported_profile:415,rate_limited:429,recipient_unavailable:503,recipient_storage_unavailable:503,invalid_args:400,unsupported_contract:400,unsupported_method:400});
