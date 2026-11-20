# Worker HTTP log tails and a hibernating actor

Status reconciled against the reviewed `b4e803d` integration: the front HTTP/private WebSocket bridge and actual account event engine are mounted in the configured log profile, with local workerd/browser evidence. This is not public Cloudflare deployment, measured idle hibernation duration or billing qualification. The [public tail contract](log-storage-extension.md#public-tail-request-and-response) does not require this internal architecture.

The app uses the same authenticated HTTP CBOR sequence as a self-hosted provider. A front Worker routes through the installation's current authority/admission path, then opens a private WebSocket to the selected account actor. Only the account actor accepts that socket with `ctx.acceptWebSocket`. The public response body and its finite timer stay in the front Worker; the account does not retain an idle HTTP controller or wait-for-next-entry promise. The private client explicitly selects ArrayBuffer delivery before acceptance; browser Blob defaults are not assumed away.

Cloudflare's [lifecycle rules](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) and [hibernating WebSocket API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) govern actual eligibility. Returning from bounded local events is necessary design evidence, not a measurement of remote hibernation or charges.

## Bounded byte flow

1. Front response consumption grants a finite byte window. Queued bytes, frame count, frame size and outstanding credits have separate bounds.
2. The account event checks durable channel/expiry, current signed authority, generation/lifecycle, retained cursor and paid work before each bounded read/send batch.
3. Before synchronous socket I/O, persist pending-send state. After confirmed local dispatch, advance only the physical delivery cursor. Crash/unknown pending state closes the physical stream; reconnect replays from the app's processed cursor.
4. Empty history returns from the event. An authorized append or new credit event can wake bounded work; no idle heartbeat timer, unresolved read or per-message analytics RPC is introduced.
5. Front consumption replenishes bytes. These credits never prove app processing. The app commits its state/cursor before local SDK ACK; a delivered-but-unprocessed item may repeat.

The bridge preserves pre-upgrade HTTP refusals and server retry floors, cancels late upgrades after client abort, strips private transport headers and closes sockets on body cancellation. Missing terminal credit can result in physical close instead of an error frame; safe reconnect still uses the app's last processed cursor. No public app chooses an account route, private credential, paid-work operation or maintenance lane.

## Durable authority, stock and cleanup

Bounded serialized attachments and durable relay rows retain the private caller/lease/work references needed for reentry; they do not expose a native browser cookie or OAuth bearer to the app. An attachment is not independent authority. Current grant/native SID or owner context, route/generation, original authority horizon and lifecycle checks remain mandatory when renewing or performing effects. Private signed receipts cannot be repurposed for another operation or resurrected after expiry.

Account-local SQL/object/export liabilities share a fixed reserved slice and a protected pool; object bytes alone are not the physical budget. Finite ordinary, owner and essential stock remain separate, while all paid work debits the same installation wallet. Tail-pump receipts can prepay several bounded same-operation requests without creating credit on replay or extending expiry. Optional archival cannot consume the protected cleanup lane or postpone due essential backlog behind its own refusal. Idle/tail-expiry-only alarms do not construct unused paid maintenance graphs.

Disconnect, expired/orphan channels and terminal retirement release retained connection stock idempotently and preserve peer wake categories. Automatic alarms and real R2/SQLite cleanup have scoped local evidence. Unknown object effects remain owned liabilities; no time-only refund or missing-marker reseed is inferred. Physical log archival is not the separately unimplemented [paid account archive/restore](paid-dormancy-archive-contract.md).

## What remains to qualify

The current [evidence map](https://github.com/3sln/waypo/blob/def58bd/docs/implementation/plan.md) records actual multi-app/provider live delivery, cold publication/read, restart, trim and account topology. Public multi-provider conformance, real Cloudflare deployment/hibernation cost and selected production exposure remain separate gates. Native/socket attachment limits and deployment policy must be validated for the selected configuration; local defaults are not unlimited capacity promises. Production, paid purchase/trial and optional analytics activation remain OFF.
