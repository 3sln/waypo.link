// Integration-event verification for integrations (docs/spec/extensions/integrations.md §6.1; CBOR phase 5,
// docs/architecture/cbor-rpc-spike.md §5; provisional). One source of truth: re-exported from packages/core/cose.mjs,
// as ./cbor.mjs re-exports the codec, so the SDK and the provider can never disagree on what an event means. The core
// module imports only the codec, so standalone SDK bundles stay self-contained.
//
//   const event = await verifyIntegrationEvent(new Uint8Array(await request.arrayBuffer()), {
//     contentType: request.headers.get('Content-Type'), issuer, audience: eventsEndpoint,
//     connection: ({iss, connection}) => lookup(iss, connection),   // unknown → falsy, before any key fetch
//     keys: kid => brokeringJwks(issuer, kid),                       // the issuer's brokering JWKS (JSON), cached ≤ 1 h
//   });
//   if (await seen(event.ctiId)) return new Response(null, {status: 202}); // dedupe on cti, never on signature bytes
export {INTEGRATION_EVENT_MEDIA_TYPE,INTEGRATION_EVENT_TYP,INTEGRATION_EVENT_AAD,INTEGRATION_EVENT_MAX_BYTES,INTEGRATION_EVENT_WINDOW,IntegrationEventFault,verifyIntegrationEvent,parseIntegrationEvent,integrationEventRejection,ctiId} from '../../core/cose.mjs';
