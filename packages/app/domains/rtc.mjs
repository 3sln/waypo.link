// RTC-d engine domain (docs/architecture/rtc-signaling.md §3.2 "Engine operations"). The rules live in
// packages/rtc/{sessions,admission,tickets,service}.mjs, which define the ngin Actions and Queries next to RtcService,
// as packages/app/domains/relations.mjs does for relations; this module re-exports them and classifies them for the
// adapters. Provisional (coordinator), not signed off by the user; behind RTC_SIGNALING_ENABLED (default off).
//
//   RTC_ENDPOINT_OPERATIONS   wire-dispatchable for an application endpoint: the RPC adapter (RTC-e) builds the
//                             {kind:'app'} actor from the verified federation RPC context (subject owner, client,
//                             verified client origin, the token's grant ids and epoch, DPoP jkt) and maps contract
//                             methods through RTC_CONTRACT_OPERATIONS
//   RTC_OWNER_OPERATIONS      wire-dispatchable for the account owner (settings routes and UI, RTC-g)
//   RTC_SYSTEM_OPERATIONS     never wire-dispatchable: ingest (same-host transport now, the federation endpoint in
//                             RTC-e), the inbound queue, tick, outbox drain and lifecycle; adapters build the system actor
//   RTC_WIDENING              operations that answer the uniform 404 while RTC_SIGNALING_ENABLED is off (the engine
//                             also rechecks; claim accept and send of non-narrowing messages are checked inside)
//   RTC_NEVER_GATED           narrowing and reads of existing state: never gated by any RTC flag
//   RTC_RELAY_OPERATIONS      RTC-f: the ice-relay/v1 contract (`credentials` → rtc.relay-credentials) for an
//                             application endpoint; widening, so it also needs RTC_TURN_ENABLED (checked by the occupant)
export {RtcService,rtcProvider,sameHostRtcTransport,heldPurpose,sessionView,RTC_FRAGMENT,RTC_SIGNALING_FLAG,RTC_FOREIGN_FLAG,RTC_TICKETS_FLAG,PUSH_ORIGINS,
 RTC_ENDPOINT_OPERATIONS,RTC_OWNER_OPERATIONS,RTC_SYSTEM_OPERATIONS,RTC_NEVER_GATED,RTC_CONTRACT_OPERATIONS,
 RtcRegister,RtcUnregister,RtcOpen,RtcClaim,RtcSend,RtcRenew,RtcMintTicket,RtcListen,RtcEndpoints,
 RtcPolicy,RtcSetPolicy,RtcSetContactRtc,RtcBlock,RtcUnblock,RtcMute,RtcUnmute,RtcRevokeTicket,RtcEndSession,RtcRevokeEndpoint,RtcClearMissed,RtcSessions,RtcMissed,RtcBlocked,RtcTickets,RtcEndpointList,RtcExport,
 RtcIngest,RtcInbox,RtcTick,RtcOutboxDrain,RtcLifecycle,RtcRelayCredentials,RtcRelaySweep,RTC_RELAY_OPERATIONS,RTC_RELAY_CONTRACT_OPERATIONS} from '../../rtc/service.mjs';
// RTC-f: the built-in ice-relay/v1 occupant (RtcRelay over the entity's RtcService) and its quotas.
export {RtcRelay,RTC_TURN_FLAG,RELAY_LIMITS,RELAY_PLAN_BYTES,ICE_RELAY_METHODS,turnAdapterFrom,relayConfigured,validateIceRelayResult,contractIceServers,legLive} from '../../rtc/relay.mjs';
export {RTC_BOUNDS,SESSION_STATES,SESSION_EVENTS} from '../../rtc/sessions.mjs';
export {LIMITS as RTC_LIMIT_VALUES,DEFAULT_POLICY as RTC_DEFAULT_POLICY} from '../../rtc/admission.mjs';
export const RTC_WIDENING=Object.freeze(new Set(['rtc.register','rtc.open','rtc.renew','rtc.mint-ticket','rtc.unblock','rtc.unmute','rtc.relay-credentials']));
