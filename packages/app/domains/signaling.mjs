// Signaling engine domain (docs/spec/extensions/signaling.md rev 3.2; Appendix C.2 `packages/app/domains/signaling.mjs`,
// renamed from rtc.mjs with the ticket, contact-configuration, mute, missed and narrow operations removed). The rules
// live in packages/signaling/*.mjs, which define the ngin Actions and Queries next to SignalingService; this module
// re-exports them and classifies them for the adapters. Provisional (coordinator), not signed off by the user; behind
// SIGNALING_ENABLED and SESSION_KINDS_ENABLED (default off).
//
//   ENDPOINT_OPERATIONS   wire-dispatchable for an application endpoint (the signaling contract, §10.2): the RPC adapter
//                         builds the {kind:'app'} actor from the verified dispatch context and maps contract methods
//                         through CONTRACT_OPERATIONS
//   OWNER_OPERATIONS      wire-dispatchable for the account owner (owner routes): IP policy, blocks, endpoints, offers,
//                         sessions, pairings, the service designation, export, and the intents session handler
//                         approvals (AMD-SG-I1; the records live in intents memory)
//   SYSTEM_OPERATIONS     never wire-dispatchable: ingest, inbox, tick, outbox drain, lifecycle, relay sweep
//   WIDENING              operations that answer the uniform 404 while signaling is off (the engine rechecks)
//   NEVER_GATED           narrowing and reads of existing state
//   RELAY_OPERATIONS      the ice-relay/v1 contract (`credentials`), widening, also needs SIGNALING_TURN_ENABLED
export {SignalingService,signalingProvider,sameHostSignalingTransport,sessionView,silentEndable,doorbellPayload,PUSH_ORIGINS,SIGNALING_FLAG,SIGNALING_FOREIGN_FLAG,SESSION_KINDS_FLAG,
 ENDPOINT_OPERATIONS,OWNER_OPERATIONS,SYSTEM_OPERATIONS,NEVER_GATED,WIDENING,CONTRACT_OPERATIONS,RELAY_OPERATIONS,RELAY_CONTRACT_OPERATIONS,
 SignalingRegister,SignalingUnregister,SignalingOpen,SignalingOffer,SignalingRevokeOffer,SignalingClaim,SignalingSend,SignalingRenew,SignalingListen,SignalingEndpoints,
 SignalingPolicy,SignalingSetPolicy,SignalingBlock,SignalingUnblock,SignalingBlocked,SignalingEndSession,SignalingRevokeEndpoint,SignalingEndpointList,SignalingOffers,SignalingRevokeOffers,SignalingSessions,
 SignalingPairings,SignalingCreatePairing,SignalingActivatePairing,SignalingUpdatePairing,SignalingRemovePairing,SignalingServiceDesignation,SignalingSetServiceDesignation,SignalingReview,SignalingPairingDetail,SignalingExport,
 IntentsSessionApprovals,IntentsSessionApprove,IntentsSessionUnapprove,IntentsSessionAutoConnect,
 SignalingIngest,SignalingInbox,SignalingTick,SignalingOutboxDrain,SignalingLifecycle,SignalingRelayCredentials,SignalingRelaySweep,
 DEFAULT_POLICY,LIMIT_VALUES,BOUNDS,PROFILES} from '../../signaling/service.mjs';
export {SignalingRelay,TURN_FLAG,RELAY_LIMITS,RELAY_PLAN_BYTES,ICE_RELAY_METHODS,turnAdapterFrom,relayConfigured,validateIceRelayResult,contractIceServers,legLive} from '../../signaling/relay.mjs';
export {SESSION_STATES,SESSION_EVENTS} from '../../signaling/sessions.mjs';
