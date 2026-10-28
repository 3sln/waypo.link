# Size limits — design spike

> **Group:** Bindle protocol (interop size bounds) and 3sln.me reference service (policy limits and aggregate budgets), with Parlay impact
>
> **Status:** provisional design spike (2026-10-28), documentation only. Input: DEVLOG "2026-10-28 — Owner direction: strict size limits on events, messages and similar". Every proposal here is a coordinator proposal: Reviewer ___ Date ___ Outcome ___. No code, spec or DEVLOG entry was changed. Production release remains disabled.
>
> **Covers:** an inventory of every message-like surface and its current size limits (spec text against code constants, with file:line citations); a proposed coherent limits table (per-item caps, aggregates, where each is enforced, error code, interop or policy); principles; Cloudflare platform ceilings that bound us; worst-case scaling arithmetic for unit economics; gaps ranked by risk; spec impact; open owner questions.
>
> **Does not cover:** the CBOR profile itself ([CBOR for RPC spike](cbor-rpc-spike.md), being revised; this spike only notes where CBOR changes the unit), the classifier, description and embedding contracts (in progress elsewhere; their figures are quoted as they stand on disk), pricing, storage quotas per plan ([offload retention](offload-retention.md)), and rate limits that are not about bytes or counts per message (sign-in, recovery, abuse controls in [release gates](../3sln/release-gates.md)). Cloudflare figures not found in repo docs are marked **unverified**.

Line numbers are as of HEAD `d58305f` plus the uncommitted working tree on 2026-10-28. Several cited files are being edited by other agents (classifier, recovery, CBOR, transfer); re-check those citations before acting on them.

## 0. Summary

- Most surfaces already have a size cap, usually both in spec and in code, and most of them agree. The cap set grew one surface at a time, so it lacks a shared vocabulary. Units are mixed (UTF-8 bytes, UTF-16 code units, code points, characters of base64url). Error codes are mixed (`too_large`, `body_too_large`, `result_too_large`, `record_too_large`, `oversize`, `archive_too_large`, `invalid_args`, `invalid_size`). Bindle never says whether a figure is a maximum a host may lower or a minimum every implementation must accept.
- **The biggest gap is in the core.** The core RPC envelope bound (1,500,000 bytes) is not in [protocol](../spec/protocol.md). It appears only in the implementation note ([federation implementation:51](../spec/federation-implementation.md)) and in messaging §11. The JSON paths that enforce it call `JSON.parse` with no depth or member bound.
- **Aggregates are counted in messages more than in bytes.** Byte-rate budgets exist for messaging receipts, the email bridge and signaling `data`. They do not exist for RPC ingress in general, for non-empty event-bus reads, or for integration-event backlogs beyond row counts.
- **"Large data goes by URL" cannot be done today.** Hosted objects are capped at 1 MiB whether they are written inline over RPC or through a presigned URL ([object-urls.mjs:35](../../packages/federation/object-urls.mjs), [:42](../../packages/federation/object-urls.mjs)). So a photo, an email attachment or a document larger than 1 MiB has no path at all.
- **One surface can grow past its own cap.** A `preferences-updated` integration event carries a full preference snapshot, and that snapshot has no aggregate bound (32 fields × 16 values × 2,048 characters). The event itself is capped at 32 KiB in code ([integration-events.mjs:50](../../packages/runtime/integration-events.mjs), [:328](../../packages/runtime/integration-events.mjs)). Large preferences can therefore make every later event `oversize`, and the connection degrades.
- The proposal (§3): a three-term vocabulary (**ceiling**, **floor**, **effective**); one error shape (`too_large`, 413, naming the limit); size caps that are the same on every plan, while aggregates scale with plan; and a worst-case bytes-per-entity-per-day table (§5) for unit economics.

## 1. Inventory of current limits

Legend: **S** = stated in a spec, **C** = enforced in code, **S≠C** = they disagree, **C only** = only code, **none** = no bound found. Interop surfaces are marked (I); 3sln.me or Parlay policy is marked (P).

### 1.1 Core RPC, manifests, discovery (I)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| RPC request envelope (Bearer) | 1,500,000 bytes, implementation note only: [federation-implementation.md:51](../spec/federation-implementation.md); messaging [§11:756](../spec/extensions/messaging.md). **Not in [protocol.md](../spec/protocol.md).** | Streamed byte count, then `JSON.parse`: [federation/http.mjs:12-13](../../packages/federation/http.mjs) (1,500,000 on `/bindle/rpc`, otherwise 131,072); DPoP/entity RPC [routes/federation.mjs:152](../../packages/runtime/routes/federation.mjs); relation RPC [routes/relations.mjs:52](../../packages/runtime/routes/relations.mjs) | **S (non-normative) / C.** No depth or member bound on these parses ([CBOR spike:29](cbor-rpc-spike.md)). Error `body_too_large` (413). |
| RPC result | as above | Canonical-JSON length > 1,500,000 → `result_too_large`: [federation/service.mjs:492](../../packages/federation/service.mjs), [:541](../../packages/federation/service.mjs); SDK refuses > 1,500,000: [sdk/src/tokens.mjs:13-15](../../packages/sdk/src/tokens.mjs) | The result is measured as `canonical()` rather than as sent bytes. Under CBOR both become encoded bytes ([CBOR spike:150](cbor-rpc-spike.md), Q14 [:236](cbor-rpc-spike.md)). |
| Descriptor `limits.maxRequestBytes` / `maxResultBytes` | Named, no range: [contracts.md:42](../spec/contracts.md) | Per resource, e.g. events 32,768 / 278,528 ([events/limits.mjs:26-27](../../packages/events/limits.mjs)), classifier 32,768 ([classifier.mjs:97](../../packages/runtime/account/classifier.mjs)) | No floor and no ceiling in the spec, and no rule that the advertised value is enforced. |
| Provider manifest | 64 KiB, ≤ 48 extension entries of ≤ 4 KiB: [protocol.md:81](../spec/protocol.md), [extensions.md:106](../spec/extensions.md) | [sdk/src/identity.mjs:58,66](../../packages/sdk/src/identity.mjs); [federation/runtime.mjs:44,55](../../packages/federation/runtime.mjs); [core/extensions.mjs:83](../../packages/core/extensions.mjs) | S = C. |
| Extension descriptor | 16 KiB: [extensions.md:63](../spec/extensions.md) | `descriptorBytes:16384` [core/extensions.mjs:83](../../packages/core/extensions.mjs) | S = C. |
| Fragment fields | 1–32 fields; `maxLength` 1–2,048; cardinality ≤ 16: [protocol.md:125,129,130](../spec/protocol.md) | [federation/schema.mjs:28,33,36](../../packages/federation/schema.mjs) | S = C per field. **No aggregate bound on a preference value set** (worst case is about 1 Mi characters). |
| Client ID metadata document | 16 KiB, 3 s: [federation-implementation.md:27](../spec/federation-implementation.md) | [federation/client-metadata.mjs:17](../../packages/federation/client-metadata.mjs) | S = C. |
| Resource discovery responses | 100 items, 64 KiB; cursor ≤ 1 KiB: [integrations.md:237,258](../spec/extensions/integrations.md) | [federation/resource-discovery.mjs:18,132](../../packages/federation/resource-discovery.mjs) (16 KiB text check) | S≠C: the 16 KiB check applies to a different response in the same module; confirm which response each check covers. |
| Device authorization form | 8 KiB: [device-authorization.md:56](../spec/extensions/device-authorization.md) | token forms 8,192 [federation/http.mjs:58,71](../../packages/federation/http.mjs) | S = C. |
| Incremental authorization suggestion | 2 KiB: [incremental-authorization.md:48](../spec/extensions/incremental-authorization.md) | requests ≤ 16 KiB canonical [federation/incremental.mjs:63](../../packages/federation/incremental.mjs) | Both present, measuring different objects. |
| App metadata fetch | JSON 64 KiB, HTML 128 KiB, 6 fetches: [app-metadata.md:40](../spec/extensions/app-metadata.md) | [apps/metadata.mjs:4](../../packages/apps/metadata.mjs); Node 131,072 [node-metadata-fetch.mjs:18](../../packages/apps/node-metadata-fetch.mjs) | S = C. |
| Resource contributions (importer) | 64 KiB request, 128 KiB result, 64 KiB descriptor, 60/min: [resource-contributions.md:73](../spec/extensions/resource-contributions.md) | brokered `callBytes:16384` [federation/brokered.mjs:39](../../packages/federation/brokered.mjs); body ≤ 1,500,000 [:255](../../packages/federation/brokered.mjs) | Provisional; the bound on the brokered call differs from the importer ceilings. |

### 1.2 Signed objects, artefacts, directory (I)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| Compact JWS (general) | `kid` 1–200 characters: [keys.md:34](../spec/keys.md). **No overall size.** | Per profile: intents header ≤ 512 [intents/format.mjs:25](../../packages/intents/format.mjs); certificate header ≤ 1,024 [messaging-protocol/certificate.mjs:11](../../packages/messaging-protocol/certificate.mjs); generic JWS hint ≤ 32,768 [account/relations.mjs:75](../../packages/runtime/account/relations.mjs) | Each profile bounds itself, so a new profile can forget to. |
| Relation documents / events | 32 KiB: [organizations.md:526,733](../spec/extensions/organizations.md) | [orgs/relation-documents.mjs:26](../../packages/orgs/relation-documents.mjs), [orgs/relation-events.mjs:44](../../packages/orgs/relation-events.mjs) | S = C. |
| Identity document | 32 KiB; with moves 152,576 bytes, ≤ 64 keys: [organizations.md:122](../spec/extensions/organizations.md), [identity-portability.md:181-191](../spec/extensions/identity-portability.md) | [identity/document-budget.mjs:15](../../packages/identity/document-budget.mjs) | S = C. A worked example of a budget derived from worst-case arithmetic; reuse the method. |
| Portability statement / attestation / package | 3,072 / 2,560 / 8 KiB: [identity-portability.md:135,303,330](../spec/extensions/identity-portability.md) | [identity/node-portability-fetch.mjs:21,28](../../packages/identity/node-portability-fetch.mjs) (1 MiB fetch ceiling) | S = C on the objects; the fetch ceiling is looser. |
| Directory manifest fetch | 64 KiB (manifest bound) | `DIRECTORY_LIMITS.maxBytes:65536`, cache 8 MiB / 256 entries [federation/directory.mjs:14](../../packages/federation/directory.mjs) | S = C. |
| Artefact envelope / body / slot | envelope 256 KiB, body 64 KiB canonical, depth 32, 4,096 members, slot 16 KiB, 1,024 versions: [artefacts.md:63](../spec/artefacts.md); fetch 256 KiB decompressed [:245](../spec/artefacts.md) | `ARTEFACT_LIMITS` [core/artefacts.mjs:8,37](../../packages/core/artefacts.mjs); publisher elision [core/public-contracts.mjs:50](../../packages/core/public-contracts.mjs) | S = C. Validators disagree on numeric field bounds ([protocol.md:139](../spec/protocol.md), CR-X3-30); this concerns field bounds, not sizes. |
| Strict JSON default | — | `maxBytes 262144, maxDepth 32` [core/strict-json.mjs:13](../../packages/core/strict-json.mjs) | A good shared parser; the RPC paths do not use it. |

### 1.3 Integration events and event buses (I)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| Integration event (SET JWT) | **none** for the event; response from the integration ≤ 4 KiB: [integrations.md:498,608](../spec/extensions/integrations.md) | `setBytes:32768` claims, wire ≤ 4×setBytes characters, oversize → `oversize`: [integration-events.mjs:50,164,239,328](../../packages/runtime/integration-events.mjs); Parlay receiver 65,536 [apps/parlay/worker/http.mjs:55](../../apps/parlay/worker/http.mjs) | **C only**, and S≠spike: the CBOR spike proposes 64 KiB encoded for the COSE_Sign1 CWT ([CBOR spike:301](cbor-rpc-spike.md)). Under CBOR the unit becomes encoded bytes. |
| Integration event backlog | "bounded per connection, below account-wide" (no figure) | 512 rows/account, 64/connection, 64 doorbell rows: [integration-events.mjs:50](../../packages/runtime/integration-events.mjs) | Rows only; with 32 KiB events, ≤ 16 MiB per account. |
| Event-bus record `data` | `max_record_bytes` 64–16,384 UTF-8 JSON: [events.md:96,176](../spec/extensions/events.md) | `maxRecordBytes:16384` [events/limits.mjs:8](../../packages/events/limits.mjs); `record_too_large` [events/schema.mjs:48](../../packages/events/schema.mjs); bus manifest checks [federation/event-buses.mjs:65,72](../../packages/federation/event-buses.mjs) | S = C. Schema rules make the worst case computable ([events.md:118](../spec/extensions/events.md)). |
| Publish request | none beyond RPC | descriptor `maxRequestBytes:32768` [events/limits.mjs:27](../../packages/events/limits.mjs) | C only. |
| Read result | 256 KiB, 100 records, 2/s per grant: [events.md:333](../spec/extensions/events.md) | `maxResultBytes:262144`, descriptor + 16 KiB [events/limits.mjs:12,27](../../packages/events/limits.mjs) | S = C. **Non-empty reads are not metered** (§5). |
| Retained per bus | 10,000 records, 16 MiB, 7/30 days: [events.md:326,329](../spec/extensions/events.md) | [events/limits.mjs:7-8](../../packages/events/limits.mjs) | S = C. |
| Publish aggregate | 60/min/publisher/bus, 120/min/bus; 2,000 (Free) / 20,000 (paid) per day: [events.md:327-328](../spec/extensions/events.md) | [events/limits.mjs:9-11](../../packages/events/limits.mjs) | S = C. |

### 1.4 Messaging (Bindle Messaging / Parlay) (I unless marked)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| Body | 1 MiB; no separate attachments in v1: [messaging.md:326,754](../spec/extensions/messaging.md) | `maxBodyBytes:1048576` [messaging-protocol/constants.mjs:25](../../packages/messaging-protocol/constants.mjs); [identity/messaging-ingress.mjs:19](../../packages/identity/messaging-ingress.mjs) | S = C. §11 says "maxima … Hosts MAY advertise smaller" and sets no floor. |
| Envelope | 64 KiB: [messaging.md:326,755](../spec/extensions/messaging.md) | `maxEnvelopeBytes:65536` | S = C. |
| Complete request | 1,500,000: [messaging.md:756](../spec/extensions/messaging.md) | `maxRequestBytes:1500000`; Parlay ingress default [apps/parlay/worker/http.mjs:12](../../apps/parlay/worker/http.mjs) | S = C. |
| Multicast batch | ≤ 32 contexts, `batch` part ≤ 512 KiB: [messaging.md:566-568](../spec/extensions/messaging.md) | `maxBatchContexts:32,maxBatchBytes:524288` | S = C. |
| Subject | ≤ 200 code points: [messaging.md:311](../spec/extensions/messaging.md) | `maxSubjectPoints:200` | Code points only (worst case 800 UTF-8 bytes, inside the envelope bound). |
| Participants | 2 to `maxParticipants` (≤ 32): [messaging.md:408,413,752](../spec/extensions/messaging.md) | `maxParticipants:32` | S = C; `participants_exceeded` (403). |
| Call invitation body | ≤ 4 KiB, ≤ 8 offers, principals ≤ 256 bytes: [messaging.md:362,375](../spec/extensions/messaging.md) | — (proposed, unsigned) | S only. |
| Invitation link (`connect` intent) | about 2 KB, within intents §3.5: [messaging.md:232](../spec/extensions/messaging.md) | intents limits (§1.5) | S = C via intents. |
| Invitation response | **none in §11** | `maxInvitationResponseBytes:8192` [messaging-protocol/constants.mjs:25](../../packages/messaging-protocol/constants.mjs) | **C only.** |
| Receipt | fixed shape, no byte bound: [messaging.md:615](../spec/extensions/messaging.md) | — | Small by construction (about 1 KB); no stated cap. |
| First-contact (credential-less) request | same body/envelope caps as everything else; per-source and per-owner budgets with no figures: [messaging.md:601-605](../spec/extensions/messaging.md) | Parlay public limits 5/sender, 50/domain, 200/owner per day [receive-budget.mjs:13-15](../../packages/messaging-engine/domains/receive-budget.mjs) | A stranger may send 1 MiB on first contact. |
| Bridged intake `deliver` | `message.parts` ≤ 1 MiB total: [messaging.md:694](../spec/extensions/messaging.md) | `maxIntakeParts:16` | S = C. |
| Archive segments | **no size in §10** ([messaging.md:713-745](../spec/extensions/messaging.md)) | `objectBytes 1 MiB, segmentBytes 786,432, segments 2,048` [archive-writer.mjs:21](../../packages/messaging-engine/store/archive-writer.mjs); reader parses lines up to **64 MiB** [:113](../../packages/messaging-engine/store/archive-writer.mjs) | **C only**; the reader bound is 64× the writer bound. An importer from another implementation has no stated maximum. |
| Receipt budgets (P) | messaging-app reference values | Free 30/min, 300/h, 1,000/day and 16/128/512 MiB; Ultra 240/2,000/10,000 and 256 MiB/2 GiB/8 GiB: [runtime/message-receipt-budget.mjs:13-18](../../packages/runtime/message-receipt-budget.mjs); Parlay copy [receive-budget.mjs:16](../../packages/messaging-engine/domains/receive-budget.mjs) | Byte-aware. Per-day bytes exceed the Free storage quota (500 MB), so the quota is the real bound. |
| Conversation allowances (P) | [messaging-app.md:286-307](messaging-app.md) | per author 5,000 records / 256 MiB; per owner 50,000 / 2 GiB; room 512 MiB [conversations.mjs:47,63](../../packages/messaging-engine/domains/conversations.mjs); hot 64 MiB / 5,000 items, inline body < 4 KiB [mailbox.mjs:21](../../packages/messaging-engine/store/mailbox.mjs) | Present. |
| Outbox (P) | attempt response ≤ 64 KiB: [messaging-app.md:334](messaging-app.md) | 1,000 recipients/tasks, 32 MiB pending, 4 concurrent, response 65,536 [outbox.mjs:8](../../packages/messaging-engine/domains/outbox.mjs) | Present. |
| Parlay owner API (P) | — | 4 MiB JSON, depth 32 [apps/parlay/worker/http.mjs:83](../../apps/parlay/worker/http.mjs); progress responses 4 MiB [web/providers/mailbox.mjs:12,23](../../apps/parlay/web/providers/mailbox.mjs) | Larger than any message needs; the reason is unrecorded. |
| Web-archive content type | ≤ 64 entries: [message-content.md:114](../spec/extensions/message-content.md) | renderer accepts 10 MiB archive, 1 MiB per entry, 4 MiB total [content/render.mjs:21,33,48](../../packages/content/render.mjs) | The renderer accepts 10× what a message body can carry. Harmless, but inconsistent. |
| Message presentations / actions (P) | 128 KiB per result, 32 revisions: [message-actions.md:7](message-actions.md) | `PRESENTATION_MAX_BYTES 131072`, metadata 120,000 [message-presentations.mjs:10](../../packages/runtime/message-presentations.mjs); form bodies 16 KiB / 64 fields [content/form-policy.mjs:23,26](../../packages/content/form-policy.mjs); form response 128 KiB [apps/form-fetch-policy.mjs:3](../../packages/apps/form-fetch-policy.mjs) | S = C. |

### 1.5 Intents (I)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| Intent object / `data` / signed payload / `bintent` / link | 4,608 / 4,480 / 5,120 bytes; 6,400 / 7,168 characters; link 8,192: [intents.md:89-97](../spec/extensions/intents.md) | `INTENT_LIMITS` [intents/format.mjs:8,17,21,23,26,30](../../packages/intents/format.mjs); protocol-handler substitution 24,576 [:35](../../packages/intents/format.mjs) | S = C. |
| Kind `max_bytes` | 64–4,480: [intents.md:97](../spec/extensions/intents.md) | [intents/schema.mjs:24,40](../../packages/intents/schema.mjs) | S = C. |
| Capability values in intent data | inside `data` | depth 8 | Bounded by `data`. |

### 1.6 Signaling (I)

| Surface | Spec | Code |
| --- | --- | --- |
| Message JWS | 40,960: [signaling.md:595](../spec/extensions/signaling.md) | `messageBytes:40960` [signaling/messages.mjs:22](../../packages/signaling/messages.mjs) |
| SDP / candidate / candidates per message | 24,576 / 512 bytes: [signaling.md:1153,1170](../spec/extensions/signaling.md) | `sdpBytes 24576, candidateBytes 512, candidates 16` |
| `data` payload / per leg / per entity | 4 KiB / 64 KiB / 256 KiB per hour (owner-approved 2026-10-28): [signaling.md:57,186,965](../spec/extensions/signaling.md); [release-gates.md:63](../3sln/release-gates.md) | `dataBytes 4096, dataLegBytes 65536` [messages.mjs:23](../../packages/signaling/messages.mjs); `dataBytes 262144/h` [sessions.mjs:163](../../packages/signaling/sessions.mjs) |
| Inter-provider batch | 131,072: [signaling.md:716](../spec/extensions/signaling.md) | `batchBytes 131072`, ≤ 4 certificates, 32 messages, 4 controls, 4 offers, context ≤ 2,048 bytes [messages.mjs:23](../../packages/signaling/messages.mjs) |
| Queues | 256 events or 512 KiB per endpoint: [signaling.md:861](../spec/extensions/signaling.md); inbound 256 batches or 4 MiB per entity: [rtc-signaling.md:265](rtc-signaling.md) | `queueEvents 256, queueBytes 524288, inbox 256, inboxBytes 4194304` [sessions.mjs:159-160](../../packages/signaling/sessions.mjs) |

Signaling is the most complete surface: per item, per leg, per entity per window, and queues, all stated in both spec and code. It is the model for the rest.

### 1.7 3sln.me services (P)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| App messages | subject ≤ 120 cp, body ≤ 12,000 cp, args ≤ 16 KiB, ≤ 31 tags × 64 cp: [app-messages.md:37](../3sln/services/app-messages.md) | `APP_NOTIFICATION_MAX_BYTES 16384` [federation/app-notifications.mjs:4](../../packages/federation/app-notifications.mjs); SDK [sdk/src/identity.mjs:406](../../packages/sdk/src/identity.mjs) | **Units clash:** 12,000 code points can be up to 48,000 UTF-8 bytes, so for most non-Latin text the 16 KiB bound applies first (about 5,400 CJK characters). |
| App notifications (connection lane) | 16 KiB; 10/min, 100/day per connection: [app-notifications.md:13,57](app-notifications.md) | as above | Provisional. |
| Activity items | profile reuses message-content: [activity.md:52](../3sln/services/activity.md) | request 16 KiB, subject 120, body 12,000, 31 tags; per account 2,000 items / 16 MiB, per app 500 / 4 MiB, 32 revisions [activity/model.mjs:10,15](../../packages/activity/model.mjs) | C largely; the same units clash. |
| Web push payload | contains no message content: [notifications.md:38](../3sln/services/notifications.md) | endpoint ≤ 2,048 [activity/web-push.mjs:12](../../packages/activity/web-push.mjs) | Push services must accept at least 4,096 bytes (RFC 8030 §7.2); payloads here are tiny. |
| Storage objects | 1 MiB per object is an implementation limit: [federation-implementation.md:51](../spec/federation-implementation.md); [offload-retention.md:25,127](offload-retention.md) | RPC put [account/storage.mjs:134](../../packages/runtime/account/storage.mjs); object HTTP [storage/object-http.mjs:7,33](../../packages/storage/object-http.mjs); presigned write [federation/object-urls.mjs:35,42](../../packages/federation/object-urls.mjs); Drive [storage/google-drive.mjs:134](../../packages/storage/google-drive.mjs); bounded body [storage/policy.mjs:28](../../packages/storage/policy.mjs) | Presigned writes have the same 1 MiB cap. |
| Omni-search | extract ≤ 1 MiB in → ≤ 32 KiB text: [omni-search.md:59](../3sln/services/omni-search.md) | [search/content.mjs:7](../../packages/search/content.mjs); query ≤ 500 characters, filters ≤ 32 × 64, title ≤ 500, readers ≤ 100 [search/schema.mjs:27,31,36,40](../../packages/search/schema.mjs); embed input 33,300 characters [search/cloudflare.mjs:6](../../packages/search/cloudflare.mjs) | Query bound is C only. |
| MCP | input 128 KiB, token forms 8 KiB, pages 50, results 100,000 bytes, content > 64 KiB refused: [mcp-service.md:62](../3sln/services/mcp-service.md) | [mcp/http.mjs:12,62](../../packages/mcp/http.mjs); [mcp/account.mjs:75](../../packages/mcp/account.mjs); [automation/catalog.mjs:20](../../packages/automation/catalog.mjs) | S = C. |
| Email bridge intake | platform inbound 25 MiB is not the admission limit; check `rawSize`, then enforce while reading: [public-email-bridge.md:30,45](public-email-bridge.md) | `MIME_LIMITS`: raw 1 MiB, headers 64 KiB / 256 fields, field 8 KiB, line 4 KiB, depth 4, 32 leaves, 16 parts, delivered 1 MiB, subject 998 [email-bridge/mime.mjs:7](../../packages/email-bridge/mime.mjs); 200 per owner per day, 16 MiB per day, queue 500 / 32 MiB [email-bridge/engine.mjs:35-37](../../packages/email-bridge/engine.mjs) | C and design doc agree. A 1 MiB raw cap refuses most mail that has an attachment. |
| Callable commands / portal | — | descriptor 64 KiB, result 32 KiB, caller 16 KiB [portal/callable-commands.mjs:9,48,59](../../packages/portal/callable-commands.mjs) | C only. |
| Billing webhook | — | 256 KiB [billing/webhook.mjs:5](../../packages/billing/webhook.mjs) | C only. |
| Recovery / transfer files | recovery file 128 KiB, payload 16 KiB: [recovery-file.md:100,105](../3sln/accounts/recovery-file.md) | [recovery/index.mjs:19-20](../../packages/recovery/index.mjs); transfer-in 1 MiB [routes/transfer-in.mjs:15,32](../../packages/runtime/routes/transfer-in.mjs) | Not message-like; listed for completeness (under edit elsewhere). |

### 1.8 In-progress AI surfaces (quoted as on disk; owned elsewhere)

| Surface | Spec | Code | Notes |
| --- | --- | --- | --- |
| Item classification | inline `data` ≤ 262,144 bytes; presigned URL item `size` ≤ 104,857,600; `href` ≤ 4,096; fetch 30 s: [item-classification.md:69,107,118](../spec/extensions/item-classification.md) | SDK `inlineBytes 262144, urlBytes 104857600` [sdk/src/item-classification.mjs:27-28](../../packages/sdk/src/item-classification.mjs); runtime `textBytes 2000, labels 6, responseBytes 16384` [classifier-models.mjs:16](../../packages/runtime/account/classifier-models.mjs); descriptor `maxRequestBytes 32768` [classifier.mjs:97](../../packages/runtime/account/classifier.mjs) | **S≠C (in flux):** the descriptor advertises 32 KiB while the spec admits 256 KiB inline (about 350 KB as base64url JSON). |
| Description / embedding | text ≤ 32,768 bytes; image inline ≤ 262,144, ≤ 16 URLs, ≤ 1 MiB inline per call; `maxBatch × dimensions` ≤ 262,144: [media-and-embeddings-spike.md:100,123,160-174](media-and-embeddings-spike.md) | — | Spike only. The result-size arithmetic is done against the 1,500,000 bound, which is the right method. |

### 1.9 Edges, platform and logs (P)

| Surface | Current | Notes |
| --- | --- | --- |
| Worker edge | No global pre-route guard. Each route streams and counts: default JSON 100,000 [routes/shared.mjs:96](../../packages/runtime/routes/shared.mjs); raw `bytesOf` → `too_large` 413 [:100](../../packages/runtime/routes/shared.mjs); route-specific 16 KiB to 1.5 MB (e.g. [routes/relations.mjs:63,82,91](../../packages/runtime/routes/relations.mjs), [routes/orgs.mjs:194](../../packages/runtime/routes/orgs.mjs), [routes/identity.mjs:48](../../packages/runtime/routes/identity.mjs)). `Content-Length` is not checked before reading. CPU `cpu_ms: 100` ([wrangler.jsonc:249-250](../../wrangler.jsonc)). | Memory is bounded per route. A declared over-limit `Content-Length` is still read up to the cap before refusal. |
| Node edge | [apps/node/server.mjs:113-122](../../apps/node/server.mjs) streams the request into the same `fetch` handler; no explicit `maxHeaderSize`, `headersTimeout`, `requestTimeout` or global body cap. Demo server 100,000 [apps/server/server.mjs:29](../../apps/server/server.mjs). | Relies on Node defaults (unverified here). Matters for self-hosting. |
| Durable Object messages | Worker → DO by stub fetch / RPC; no Queues configured in `wrangler.jsonc`. | Inherits the route caps. |
| DO storage values | Mailbox bodies chunked at 16 KiB [outbox.mjs:77](../../packages/messaging-engine/domains/outbox.mjs); hosted objects ≤ 1 MiB. | Below the 2 MB SQLite row limit ([scaling.md:151](scaling.md)). |
| Logs | `observability.enabled: false` ([wrangler.jsonc:246-247](../../wrangler.jsonc)); 5 `console.*` calls in `packages` + `apps/worker`. Audit events omit raw content ([release-gates.md](../3sln/release-gates.md), "Audit and operational controls"). | No per-record size rule. |

### 1.10 Cloudflare platform ceilings that bound us

| Ceiling | Figure | Source |
| --- | --- | --- |
| SQLite-backed DO storage | 10 GB per object; 2 MB per row; 100 bound parameters per query; about 1,000 req/s soft per object | [scaling.md:151](scaling.md) (reviewed 2026-10-11) |
| Email Routing inbound | 25 MiB per message | [public-email-bridge.md:30](public-email-bridge.md) |
| Worker CPU | 100 ms per invocation as configured | [wrangler.jsonc:250](../../wrangler.jsonc) (configured, not a platform maximum) |
| DO / isolate memory | 128 MB | [unit-economics-2026-10-12.md:112](unit-economics-2026-10-12.md) (billing figure) |
| Worker request body | 100 MB (Free/Pro), 200 MB (Business), 500 MB (Enterprise) | **unverified** |
| Request headers | about 128 KB total, 32 KB per line | **unverified** |
| URL length | about 16 KB | **unverified** (intent links stay ≤ 8,192) |
| Queue message | 128 KB | **unverified** (Queues not used) |
| DO WebSocket message | 1 MiB (or larger with recent changes) | **unverified** (not used for messages) |
| Workers KV value | 25 MiB | **unverified** (not used for messages) |
| R2 object | single PUT about 5 GiB; multipart up to about 5 TiB | **unverified** |
| Workers AI model inputs | per model (token windows, image sizes) | **unverified**; the classifier and media specs must state their own caps below them |
| Web Push payload | push services MUST accept ≥ 4,096 bytes | RFC 8030 §7.2 |

The constraints that actually bind are the 100 ms CPU limit and the 128 MB of isolate memory, not the request-body ceilings. Parsing 1.5 MB of hostile JSON into many small objects can take tens of MB and measurable CPU. That is why §2.1 puts bounds before parsing and inside the parser.

## 2. Principles

1. **Check before allocating, and before parsing.** Order: (a) at the edge, a declared `Content-Length` over the route cap → 413 without reading; (b) while streaming, a byte count over the cap → cancel and 413; (c) in the decoder, bounds on depth, container entries, total items and string length (the strict JSON parser and the CBOR decoder use the same figures: depth 32, ≤ 65,536 entries per container, ≤ 131,072 items per message, [CBOR spike:139](cbor-rpc-spike.md)); (d) schema bounds; (e) engine aggregates (counts, bytes per window, retained bytes). Never decode base64url or a JWS before checking its outer length. Never verify a signature before checking size and framing.
2. **Measure encoded bytes.** Every interop cap is a count of bytes on the wire: UTF-8 JSON today, deterministic CBOR after migration. Code-point and character limits are UI conveniences stated *in addition*, never instead. Where a field holds bytes (CBOR byte string, or base64url on JSON), the cap is on the decoded bytes, and the envelope cap absorbs the base64 expansion. Under CBOR a 1 MiB body fits in a 1,500,000-byte envelope with room to spare. On JSON it needs 1,398,102 characters, which still fits.
3. **Ceilings, floors and effective values.** A Bindle **ceiling** is the most any sender may send and the most any receiver must be ready to process; above it, refusal is always correct. A Bindle **floor** is what every conforming receiver MUST accept. A host's **effective** limit lies in [floor, ceiling] and is advertised where an app needs it: descriptor `limits` for resources, the messaging-ingress fragment's binding limits for mailboxes, the bus descriptor for buses. A signed or relayed object that third parties must verify has floor = ceiling (one fixed bound, as intents and signaling already do), because a verifier cannot negotiate.
4. **Size caps are the same on every plan; aggregates scale with plan.** One message's maximum size must not depend on the recipient's subscription, or a sender cannot predict delivery. Per-day bytes, counts and retained bytes scale with plan.
5. **Large data goes by reference.** Inline caps stay small (≤ 1 MiB). Anything larger goes as a presigned or capability URL to storage, with `size` and a SHA-256 digest in the inline object, so the reference is verifiable and its cap is checkable before fetching (the item-classification §5 pattern). That requires a storage path for objects larger than 1 MiB (G4).
6. **One refusal shape.** `too_large` (HTTP 413) for a single item over a cap, with `error.limit = {name, max}` naming the limit; `rate_limited` (429, `Retry-After`) for window aggregates; `quota_exceeded` / `recipient_storage_unavailable` for retained-bytes exhaustion. Refusals do not echo the payload and are not charged as successful work.
7. **Every cap feeds the cost model.** For each surface: worst-case bytes per entity per day = per-item cap × per-day count, bounded by the per-day byte budget where one exists. §5 lists them; `scripts/cost-model.mjs` should consume the same constants rather than restate them.
8. **Caps live in one place per surface.** Spec figure → one exported frozen constant → descriptor value derived from it → tests asserting spec = constant. Signaling and event buses already work this way.

## 3. Proposed limits table

"Typical" is a planning estimate of the 99th percentile, not a measurement (no production data exists). Enforcement letters: **E** edge before parse (Content-Length and streaming count), **D** decoder bounds, **S** schema, **N** engine aggregate. "Kind": **I-fix** Bindle fixed bound (floor = ceiling); **I-range** Bindle ceiling with a floor, host advertises effective; **P** 3sln.me or Parlay policy. Unchanged values are marked "=".

### 3.1 Per-item caps

| Surface | 99% case | Proposed cap | Enforce | Error | Kind |
| --- | --- | --- | --- | --- | --- |
| RPC request envelope | < 16 KiB (metadata calls); ≤ 1.4 MB for 1 MiB object puts on JSON | ceiling **1,500,000 encoded bytes** (=); floor **65,536**; depth 32, 65,536 entries per container, 131,072 items per message; descriptor `maxRequestBytes` in [65,536, 1,500,000] and enforced | E, D, S | `too_large` 413 | I-range, **moves into protocol.md** |
| RPC result | as above | same ceiling and floor; `maxResultBytes` likewise; measured on the encoded result actually sent | D before send | `result_too_large` (keep as the result-side name) | I-range |
| Any compact JWS / COSE_Sign1 not otherwise bounded | < 4 KiB | **32 KiB** default ceiling; protected header ≤ 1 KiB; `kid` ≤ 200 (=) | E, D | profile's code | I-fix (keys.md default) |
| Manifest / extension entries / descriptor / client metadata / directory fetch | 2–10 KiB | = (64 KiB; 48 × 4 KiB; 16 KiB; 16 KiB; 64 KiB) | E, D | as today | I-fix |
| Preference value set per fragment | < 2 KiB | **new: 16 KiB encoded** (checked at configure and at approval) | S | `invalid_preferences` | I-fix |
| Integration event (SET today, COSE CWT later) | < 4 KiB | **32 KiB encoded** (= code); state in integrations §6; requires the preference bound above so a snapshot always fits | D (receiver), S (sender before enqueue) | receiver: 413; sender: never signs an oversize event | I-fix |
| Event-bus record `data` | < 2 KiB | = 64–16,384, host effective advertised | S | `record_too_large` → map to `too_large` | I-range |
| Event-bus publish request | < 18 KiB | **32 KiB** (= code), stated in events §4.4 | E | `too_large` | I-range (floor 20 KiB = max record + framing) |
| Event-bus read result | — | = 256 KiB, ≤ 100 records | engine | — | I-range |
| Messaging body | text < 8 KiB; rich HTML < 64 KiB; inline image would be ≥ 200 KiB | ceiling **1 MiB** (=); floor **256 KiB** | D, S | `too_large` | I-range |
| Messaging envelope | < 4 KiB | = 64 KiB | D | `too_large` | I-fix |
| Messaging request | — | = 1,500,000 | E | `too_large` | I-fix |
| Multicast batch part / contexts | — | = 512 KiB / 32 | D, S | `too_large` | I-range |
| First-contact (credential-less) body | introductions < 4 KiB | **new: 64 KiB** | S (after framing, before author verification) | `too_large` | I-fix (proposal Q3) |
| Subject | < 120 cp | 200 cp (=) **and** ≤ 800 bytes | S | `invalid_envelope` | I-fix |
| Participants | 2–8 | = 32 | S | `participants_exceeded` 403 | I-range (floor 8) |
| Invitation response | < 2 KiB | **8 KiB** (= code), stated in §11 | E | `too_large` | I-fix |
| Receipt payload | about 1 KiB | **new: 4 KiB** | D | `invalid_receipt` | I-fix |
| Call invitation body | < 2 KiB | = 4 KiB | S | `too_large` | I-fix |
| Archive segment object | — | **new in §10: ≤ 1 MiB per object**; importer MUST accept ≤ 1 MiB and MAY refuse larger; reader parse bound = object size (not 64 MiB) | D | import fails closed | I-fix |
| Attachments (future profile) | photo 2–5 MB; document < 25 MB | by reference only; **≤ 100 MiB each, ≤ 16 per message**, each with `size` + SHA-256 in the body | S, then fetch-time bound | `too_large` | I-fix (future; Q4) |
| Intents | link < 2 KiB | = (4,608 / 4,480 / 5,120 bytes; 8,192-character link) | E, D | as today | I-fix |
| Signaling | SDP 4–8 KiB | = all of §1.6 | E, D, N | as today | I-fix |
| Artefacts | contract 12 KiB | = 256 KiB envelope / 64 KiB body / 16 KiB slot | E, D | as today | I-fix |
| Item classification inline / URL | text < 8 KiB; image < 2 MB by URL | = 262,144 decoded / 104,857,600 by URL; descriptor `maxRequestBytes` must cover the inline maximum (≥ 360 KiB on JSON, ≥ 270 KiB on CBOR) | D, S | — | I (owned by the classifier spec) |
| App messages / notifications / activity | < 2 KiB | 16 KiB encoded (=); **state the body as ≤ 12,000 cp and within the 16 KiB total**, so non-Latin users can see the real limit | E, S | `too_large` | P |
| Storage object, inline over RPC | — | = 1 MiB | S | `too_large` | P (implementation) |
| Storage object, presigned / proxy | photo, PDF | **new: 100 MiB per object on every plan** (direct to R2; multipart later), within quota | E (declared size in the token), fetch-time count | `too_large` | P (Q5) |
| Email bridge raw | plain mail < 100 KB; with attachment 1–10 MB | **raw ≤ 10 MiB** read with streaming bounds; delivered text/HTML ≤ 1 MiB; attachments become a stub list (name, type, size) until attachments by reference exist | E, D (MIME) | refused with an owner-visible ledger entry | P (Q6) |
| MCP | — | = (128 KiB in; 100,000-byte results; 64 KiB content) | E, S | as today | P |
| Search query | < 100 characters | = 500 characters, filters 32 × 64; also ≤ 2,000 bytes | S | `invalid_search_query` | P |
| Parlay owner API | compose ≤ 1.4 MB | **lower 4 MiB → 1,500,000** unless a documented bulk operation needs more | E | `too_large` | P |
| Worker edge (global) | — | **new: global ceiling 4 MiB** before routing (the largest route cap), plus per-route caps; a declared `Content-Length` over the route cap → 413 without reading | E | `too_large` | P |
| Node edge | — | **new: explicit** `maxHeaderSize` 16 KiB, `headersTimeout` 10 s, `requestTimeout` 30 s, same global body ceiling | E | 413/408 | P |
| Log record | < 512 bytes | **new: ≤ 4 KiB per record**, fixed fields, no payload bytes, no tokens, no preference values | code review + test | — | P |

### 3.2 Aggregates

Per-plan aggregates stay where they are. Each line names the window and the entity.

| Surface | Aggregate (current or proposed) | Entity | Status |
| --- | --- | --- | --- |
| Messaging receipts | Free 1,000 msgs / 512 MiB per day … Ultra 10,000 / 8 GiB; contact scope half | owner, contact | = (code) |
| First contact | 5 per sender, 50 per email domain, 100 per issuer, 200 per owner per day | sender, domain, owner | = (Parlay); **add a byte figure: first-contact bytes ≤ 4 MiB per owner per day** (200 × 64 KiB is 12.5 MiB worst case; most will be small) |
| Conversation | per author 5,000 records / 256 MiB; owner 50,000 / 2 GiB; pending mutations 64 | author, owner, conversation | = |
| Event buses | publish 60/min/publisher, 120/min/bus; 2,000 / 20,000 per day; retained 16 MiB per bus; **new: non-empty read bytes ≤ 1 GiB per grant per day** (then one allowance unit per 256 KiB) | publisher, bus, account, grant | partly new |
| Integration events | 64 pending per connection, 512 per account (rows); with 32 KiB cap ≤ 2 MiB / 16 MiB | connection, account | = (state the byte equivalents in the spec's bounded-backlog sentence) |
| Signaling `data` | 64 KiB per leg; 256 KiB per hour per entity | leg, entity | = |
| App notifications | 10/min, 100/day per connection, under the owner receipt budget | connection | = |
| Email bridge | 200 per owner per day, 16 MiB per day; queue 500 / 32 MiB | owner | = (raise bytes to 64 MiB/day if Q6 accepts 10 MiB raw) |
| RPC ingress | 120 requests/min per IP (rpc class) [routes/federation.mjs:56](../../packages/runtime/routes/federation.mjs) | IP, subnet | **new: ≤ 64 MiB request bytes per access token per minute, ≤ 1 GiB per day**, charged after the edge read |

## 4. Gaps and recommended fixes, ranked by risk

| # | Risk | Gap | Fix | Spec impact |
| --- | --- | --- | --- | --- |
| G1 | High | Core RPC size bound missing from [protocol.md](../spec/protocol.md); the descriptor `maxRequestBytes`/`maxResultBytes` have no range and no enforcement rule; nothing says "encoded bytes" | Add a protocol "RPC limits" paragraph: ceiling 1,500,000 encoded bytes, floor 65,536, descriptor range and enforcement, `too_large`/`result_too_large`. Coordinate with the CBOR spike (its Q14) so one text serves both | protocol §RPC; contracts `resource-descriptor/v1` |
| G2 | High | RPC, relation and federation JSON paths use `JSON.parse` without depth or member bounds ([federation/http.mjs:13](../../packages/federation/http.mjs), [routes/federation.mjs:152](../../packages/runtime/routes/federation.mjs), [routes/relations.mjs:52](../../packages/runtime/routes/relations.mjs)) | Switch to `strictJSON` with depth 32 and container/item bounds until CBOR lands; the CBOR decoder then carries the same bounds | none (implementation); conformance vectors |
| G3 | High | No byte-rate budgets on general RPC ingress or on non-empty event-bus reads; theoretical worst cases are tens to hundreds of GB per day per entity (§5) | Add per-token byte budgets and a per-grant read-byte budget (§3.2); feed them to the cost model | events §9 (read bytes); 3sln.me policy doc |
| G4 | Med-High | Presigned and proxy object writes capped at 1 MiB, the same as inline, so "large data by URL" is impossible: no photos, attachments or documents above 1 MiB, and the email bridge must refuse most attachments | A direct-to-R2 presigned path with a declared size up to 100 MiB, counted against quota; multipart later. Unblocks attachments by reference and classifier URL inputs | storage contract / `object-storage/v1` capabilities (`maxObjectBytes`) |
| G5 | Medium | A preference value set has no aggregate bound, but `preferences-updated` events are capped at 32 KiB in code and unbounded in spec; the CBOR spike proposes 64 KiB | Bound value sets at 16 KiB; state the event cap as 32 KiB encoded in integrations §6; align the CBOR spike's figure | protocol fragment table; integrations §6; CBOR spike §5 |
| G6 | Medium | Messaging spec gaps: no floors; invitation response (8 KiB), receipt and archive segment caps exist only in code or not at all; first contact may carry 1 MiB; the archive reader accepts 64 MiB lines | Add the §3.1 rows to messaging §10/§11; lower the reader bound to the object size | messaging §7.4, §10, §11 |
| G7 | Medium | Edges: no pre-read `Content-Length` refusal, no global Worker ceiling, Node has no explicit header/time limits (slowloris in self-host); Parlay owner API at 4 MiB | Edge guard and Node settings of §3.1; lower Parlay to 1.5 MB or document why not | none (implementation); self-host docs |
| G8 | Medium | Unit clash: code-point limits (12,000 cp body) inside byte limits (16 KiB) on app messages, notifications and activity; messaging subject is code points only | Normative byte caps; code points as UI guidance; the SDK reports the binding limit | app-messages, app-notifications, activity docs; messaging §5.1 |
| G9 | Low-Med | Classifier descriptor advertises 32 KiB while the spec admits 256 KiB inline (in flux) | Owner of the classifier work: derive the descriptor value from the inline bound | item-classification (owned elsewhere) |
| G10 | Low | Error codes for "too big" differ across surfaces | Adopt `too_large` + `error.limit`; keep `result_too_large` for results; map `record_too_large`, `body_too_large`, `oversize`, `archive_too_large`, `invalid_size` onto it (old names kept as aliases where already published) | protocol errors table; messaging §8.3 already has `too_large` |
| G11 | Low | keys.md has no default JWS size; every profile must remember to bound itself | Default 32 KiB ceiling, 1 KiB protected header | keys §3 |
| G12 | Low | Logs have no per-record size rule (observability is off today) | Bounded structured logs, no payloads | 3sln.me ops doc (not DEVLOG) |
| G13 | Low | Web-archive renderer accepts 10 MiB while message bodies are 1 MiB | Lower the renderer to the body cap or note why | message-content §(web archive) note |

## 5. Scaling arithmetic (worst case per entity per day)

Each figure is per-item cap × allowed count, capped by any byte budget. These are adversarial ceilings, not expected load. They are the inputs `scripts/cost-model.mjs` should take as constants.

| Surface | Free | Paid / top plan | Binding constraint | Comment |
| --- | --- | --- | --- | --- |
| Messaging inbound bytes | 512 MiB/day | Ultra 8 GiB/day | storage quota (Free 500 MB) and per-contact half budgets | Free can fill its quota in one day; the quota refusal is the real limit. |
| First contact | 200 × 1 MiB = 200 MiB/day today; 12.5 MiB with the 64 KiB cap | same | per-owner public budget | The proposal cuts stranger-driven bytes 16×. |
| Event-bus publishes | 2,000 × 16 KiB = 31 MiB/day written | 20,000 × 16 KiB = 313 MiB/day | event allowance | Retained ≤ 16 MiB × 8 buses = 128 MiB (Free), × 32 = 512 MiB (paid), counted toward quota. On Free that is a quarter of the quota. Consider 4 MiB per bus on Free. |
| Event-bus reads | 2/s × 272 KiB ≈ 45 GiB/day per grant today | same | **none** (non-empty reads free) | With the proposed 1 GiB/grant/day budget the read-bytes are bounded. |
| Integration events | ≤ 16 MiB backlog per account | same | rows × 32 KiB | Egress to integrations is bounded by retries over 72 h. |
| Signaling `data` | 256 KiB/h → 6 MiB/day per entity | same | aggregate budget | Already priced (`dataEconomics()`, [unit-economics.md:78-85](unit-economics.md)). |
| App notifications | 100 × 16 KiB = 1.6 MiB/day per connection | same | owner receipt budget | |
| Email bridge | 16 MiB/day per owner | same | owner bytes per day | 64 MiB/day if Q6 is accepted. |
| RPC ingress | 120/min × 1.5 MB ≈ 180 MB/min per IP | same | CPU (100 ms) and per-IP limiter only | With a 1 GiB per-token daily budget, about 1 GiB per app per day. |

Cost-model follow-up: add a row per surface with (worst-case bytes/day, expected bytes/day, storage-retained bytes, DO rows written) and check the margin floor against the worst case of a *Free* account, since Free accounts cannot be charged for abuse.

## 6. Spec impact (proposed; nothing edited)

- **protocol.md**: RPC limits paragraph (G1), unified size error (G10); fragment table gains the 16 KiB value-set bound (G5).
- **contracts.md** `resource-descriptor/v1`: ranges for `maxRequestBytes`/`maxResultBytes` and the rule that hosts enforce what they advertise.
- **keys.md** §3: default JWS / COSE_Sign1 ceiling (G11).
- **integrations.md** §6: event size cap; byte equivalents for the bounded backlog.
- **events.md** §4.4/§9: publish request cap, read-byte budget.
- **messaging.md** §7.4/§10/§11: floors, first-contact body cap, invitation-response and receipt caps, archive segment cap, subject byte cap; a short "ceilings and floors" preamble for §11.
- **object-storage/v1** capabilities: `maxObjectBytes` for presigned writes above 1 MiB (G4).
- **3sln.me service docs** (app-messages, app-notifications, activity, storage, mcp, omni-search, public-email-bridge): normative byte caps; email raw admission figure.
- **CBOR spike**: align the event cap (§5 proposes 64 KiB) and state that every limit in this spike is in encoded bytes after migration.
- A small **limits register** (one table per surface, generated from the exported constants) would let tests assert spec = code. It is optional, and it is not proposed here as a new document.

## 7. Open owner questions (with recommended answers)

1. **Should Bindle state floors as well as ceilings?** Recommended: yes. Ceilings for every interop surface; floors where hosts may lower the limit (RPC, message body, participants, bus record); fixed bounds (floor = ceiling) for signed or relayed objects.
2. **Should the RPC bound stay at 1,500,000 bytes, counted as encoded bytes?** Recommended: yes, with a 65,536 floor. This matches CBOR spike Q14.
3. **Should credential-less first contact carry less than 1 MiB?** Recommended: 64 KiB, an interop fixed bound, so strangers cannot push large payloads. Established conversations keep 1 MiB.
4. **Attachments: by reference only, with what caps?** Recommended: a later attachment profile, by reference only, ≤ 100 MiB each, ≤ 16 per message, `size` + SHA-256 inline. Not started until G4 lands.
5. **Presigned object size on hosted storage?** Recommended: 100 MiB per object on every plan, with quota as the aggregate; multipart and larger objects later.
6. **Email bridge raw admission?** Recommended: read up to 10 MiB with streaming MIME bounds, deliver text/HTML ≤ 1 MiB, list attachments as stubs until attachments exist; raise the per-owner bytes per day to 64 MiB.
7. **Integration event cap: 32 KiB or 64 KiB?** Recommended: 32 KiB encoded (as the code does), made safe by a 16 KiB bound on preference value sets.
8. **Byte budgets on RPC ingress and event-bus reads?** Recommended: yes, provisional values: 64 MiB per token per minute and 1 GiB per day for RPC; 1 GiB per grant per day for non-empty reads, then metered.
9. **Code points or bytes?** Recommended: bytes are normative everywhere; code-point limits stay as UI guidance, and SDKs report which limit bound.
10. **Size caps per plan?** Recommended: no. Per-item caps are the same on every plan; only aggregates and retained bytes scale with plan.
11. **One error code?** Recommended: `too_large` (413) with `error.limit {name, max}`, `result_too_large` for results, existing names kept as aliases where already published.
12. **Free event-bus retention: 16 MiB per bus × 8 buses is 128 MiB of a 500 MB quota.** Recommended: 4 MiB per bus on Free, 16 MiB on paid.
13. **Global edge ceiling of 4 MiB, with Parlay's owner API lowered to 1.5 MB?** Recommended: yes, unless a bulk Parlay operation is documented that needs more.
