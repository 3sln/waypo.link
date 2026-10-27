# RTC signaling: design and 3sln.me implementation plan

Design date: 2026-10-26, revision 1. **Implementation status (2026-10-26):** slices RTC-a (wire validators and codecs), RTC-b (the `rtc-purpose` kind) and RTC-c (AMD-X1 bound consumer options) are implemented locally with engine-level and seeded tests; the four flags of §3.3 exist and default off. Nothing is routed, no session engine, transport, relay or UI beyond the consent addition exists, and nothing is production-verified (§8.1 status, DEVLOG 2026-10-26 "RTC-a/b/c validators, purposes and bound options (flags off)"). Every decision here is provisional (coordinator), **not signed off by the user** (§9). Normative rules: [rtc-signaling spec](../spec/rtc-signaling.md). Decision record: [DEVLOG](../../DEVLOG.md) 2026-10-26, "RTC signaling extension design". Reviewer ___ / date ___ / outcome ___.

## 1. Direction and summary

User direction (2026-10-26): spec a Bindle extension for cross-provider WebRTC signaling, generic and secure, usable between devices of one user or of different users, for any purpose (calls, data transfer and so on), as flexible as possible without compromising security or privacy. App-level experiences stay out of the 3sln.me core: Beam's file-transfer experience moves to an app, and the core provides the primitive. Follow-up direction the same day: build it on the extension system already specified in [extensions](../spec/extensions.md), name any gap explicitly and propose the smallest addition, and reconcile with the existing [beaming spec](../spec/beaming.md). Further direction (2026-10-26): Beam was removed from the core outright the same day rather than kept until an application ships (§5, §6); [beaming](../spec/beaming.md) is now a superseded stub.

The design in one paragraph: an application asks for the **`rtc-signaling/v1` slot** (exclusive, provider built-in occupant, non-brokerable contract) with the **purposes** it wants approved, bound per application by the one extension-system addition, **AMD-X1**. Purposes are `rtc-purpose` **artefacts** (media, alerting, parties, auto-accept, a context schema). To call, an endpoint gets a **per-session leg key certified by its own issuer** and signs every signaling message with it. Providers relay those messages unchanged to each other through the **`rtc-signaling.v1` feature endpoint**, verifying them with no request-path fetch and answering a uniform `202`. The callee provider admits an invite only on a **basis** (own entity, a contact link with RTC enabled, an **`rtc-ticket` link**, or an opt-in request policy), fans it out to eligible endpoints, and lets the **first claim** win. No SDP address or candidate leaves a device before that claim, and cross-entity sessions default to **relay-only**, with each party using **its own relay** (the optional `ice-relay/v1` slot). DTLS fingerprints are bound into the signed messages, with optional direct key verification and a committed **SAS** for users who want detection of provider substitution.

## 2. How it fits the extension system

| Need | Existing mechanism reused | Where |
| --- | --- | --- |
| Provider-to-provider endpoint, discovery and version | `features` entry `rtc-signaling.v1` ([protocol §2](../spec/protocol.md#2-discovery-and-login)); extensions §2.1 sends provider-implemented roles to `features` | spec §3.1 |
| App-facing capability, consent, revocation, pinning, versioning | A slot whose built-in occupant is declared in the provider manifest's `extensions` array, requested as a fragment with `digest` | spec §3.2 |
| Owner-chosen relay funding | A second slot, `ice-relay/v1`, `ordered`, brokered occupants allowed | spec §3.3 |
| Purpose identifiers that apps register | An artefact kind with a growth table, like intent kinds | spec §3.4 |
| Capabilities for nearby pairing, call-me links and callbacks | A link type under [links](../spec/links.md) | spec §4.3 |
| Contact-based admission | Contact links plus mutable owner-side configuration, like intake configuration | spec §4.3 |
| Signatures, key discovery, no-oracle verification | Certification keys, `directory.v1`, background refresh, the organizations §5.2 and §9.9 rules | spec §5, §8 |
| Push to native apps | The integrations SET channel, a doorbell like events §7.2 | spec §9.2 |

**The one gap.** The application's purposes must be part of what the owner approves for that application. Slot consumer options exist only in declarations (no authority), and slot atomic fields and scope selections are shared by every consumer. AMD-X1 adds a `bind` slot member (in `crit`), `options` on slot fragment requests, and a per-consumer approved value recorded in the grant (spec §3.5). Everything else fits as is.

**Considered and not needed.** A slot member declaring an endpoint (slots must not declare endpoints, extensions §9.6, and the feature carries it); inbound delivery to consumers (a long-poll contract method stays inside protocol §5 request/response); brokered signaling occupants (made impossible on purpose with `x-bindle-brokerable: false`, because only the issuer can certify leg keys).

## 3. 3sln.me implementation (engine-first)

All behavior is drivable through the ngin Engine. HTTP routes and UI are thin adapters, as with relations ([organizations design §8b.10](organizations-design.md)).

### 3.1 Components

| Module (new unless noted) | Responsibility |
| --- | --- |
| `packages/rtc/messages.mjs` | Strict parse and verify of `bindle-rtc-message+jwt`, `bindle-rtc-leg-certificate+jwt`, `bindle-rtc-control+jwt`; SDP and candidate rule checks (spec §6.3); IP-policy filter. Pure functions, no I/O. |
| `packages/rtc/certificates.mjs` | Leg certificate issuance on `certificationSigner` (`packages/identity/member-certificates.mjs`), reused as entity certificates do (`packages/identity/entity-certificates.mjs`). Thumbprints from `packages/federation/dpop.mjs` `thumbprint`. |
| `packages/rtc/purposes.mjs` | `rtc-purpose` body validation, growth table, context projection; the intents data-schema validator is reused from `packages/intents/`. |
| `packages/rtc/sessions.mjs` | The session state machine, first-claim, glare-free provider rules, seq/replay windows, expiry. |
| `packages/rtc/admission.mjs` | Bases, contact-link RTC configuration, ticket uses, block/mute/quarantine, limits. |
| `packages/rtc/service.mjs` | `RtcService` and its ngin Actions and Queries (§3.2). |
| `packages/rtc/federation.mjs` | Batch build/parse, `sameHostRtcTransport` (local delivery through the same verification path) and the foreign transport (outbox, retries, manifest endpoint resolution through the successor index). |
| `packages/rtc/relay.mjs` | Built-in `ice-relay/v1` occupant. Wraps the `CloudflareTurnAdapter` now at `packages/rtc/turn.mjs` and the credential lease, revoke and sweep logic now at `packages/rtc/relay-credentials.mjs` (both moved from Beam on 2026-10-26, tested but not yet used), generalizing Beam's former D1/D2 credential lifecycle (§5). |
| `packages/rtc/tickets.mjs` | The `rtc-ticket/v1` link type on the existing links service (`packages/links/`), atomic use counting. |
| `packages/app/domains/rtc.mjs` | Engine domain: re-exports and classifies operations (owner, endpoint, system, narrowing), as `packages/app/domains/relations.mjs` does. |
| `packages/runtime/account/rtc.mjs` | Durable storage slice in the account writer: sessions, endpoints, queues, replay windows, limits. |
| `packages/runtime/routes/rtc.mjs` | `POST /bindle/rtc` federation endpoint (uniform `202`), contract dispatch from the RPC router, owner settings routes. |

### 3.2 Engine operations

| Class | Operations |
| --- | --- |
| Endpoint actions (app via contract) | `rtc.register`, `rtc.unregister`, `rtc.open`, `rtc.claim`, `rtc.send`, `rtc.renew`, `rtc.mint-ticket`, `rtc.relay-credentials` |
| Endpoint queries | `rtc.listen` (long poll), `rtc.endpoints` |
| Owner actions | `rtc.set-app-purposes` (narrow or approve bound purposes; widening goes through `grant-more`), `rtc.set-policy` (IP policy, request policy, auto-accept per app), `rtc.set-contact-rtc` (per contact parent), `rtc.block`, `rtc.unblock`, `rtc.mute`, `rtc.unmute`, `rtc.revoke-ticket`, `rtc.end-session`, `rtc.revoke-endpoint`, `rtc.clear-missed` |
| Owner queries | `rtc.sessions`, `rtc.missed`, `rtc.policy`, `rtc.blocked`, `rtc.tickets`, `rtc.endpoint-list` |
| System (never wire-dispatchable) | `rtc.ingest` (verified foreign batch), `rtc.outbox-drain`, `rtc.tick` (ring and session expiry, replay and limit pruning), `rtc.key-roster` (background refresh roster for admitted peers), `rtc.lifecycle` (move commit, revocation, app disconnect → control statements), `rtc.relay-sweep` |
| Narrowing (never gated by any RTC flag) | `rtc.unregister`, `rtc.end-session`, `rtc.revoke-endpoint`, `rtc.block`, `rtc.mute`, `rtc.revoke-ticket`, `rtc.clear-missed`, decline claims, `send` of `end`/`cancel`, and every system end path |

### 3.3 Flags

| Flag | Class | Default | Gates |
| --- | --- | --- | --- |
| `RTC_SIGNALING_ENABLED` | (a), stateful | off | The slot occupant declaration, contract widening operations, owner widening settings, same-provider sessions. |
| `RTC_FOREIGN_ENABLED` | (a), stateful, `requires: ['RTC_SIGNALING_ENABLED']`, risk crit | off | The `rtc-signaling.v1` feature declaration in `packages/runtime/federation.mjs`, outbound foreign delivery and the `/bindle/rtc` endpoint (answers the uniform `404` when off). |
| `RTC_TICKETS_ENABLED` | (a) | off | Minting `rtc-ticket` links. Admission through existing tickets keeps working until they expire or are revoked. |
| `RTC_TURN_ENABLED` | (b), env capability, `requires: ['RTC_SIGNALING_ENABLED']` | off | The built-in relay occupant. A new flag: `BEAM_TURN_ENABLED` was retired on 2026-10-26 with Beam, not renamed. Hosted relay stays off until an enforceable relay-spend budget gate (formerly the Beam relay-budget gate) is met. |

### 3.4 Storage layout and bounds

All per-entity state lives in the entity's account writer, which is the single authority for first claim.

| Record | Bound |
| --- | --- |
| Endpoints | 32 per entity; 30-day idle expiry; bound to a DPoP `jkt` or a hashed endpoint secret. |
| Certified delegates | Thumbprints of live sessions plus a 24 h window, for reuse refusal. |
| Sessions (caller or callee record) | 8 open as caller, 4 ringing plus 8 connected as callee; record deleted 24 h after end. |
| Per-endpoint event queue | 256 events or 512 KiB; overflow ends affected sessions `failed` and sets `gap`. |
| Replay window | Per (session, leg): highest `seq`, up to 32 buffered messages; dropped 300 s after end. |
| SDP and candidates | Never stored past delivery, or 60 s. |
| Missed and held list | 100 entries and 30 days per entity, owner-deletable. |
| Blocks, mutes | 1,000 blocks and 256 mutes per entity. |
| Contact RTC configuration | 16 purposes per parent, stored on the parent record. |
| Tickets | Live tickets count against the links service's existing per-account parent cap. |
| Limit counters | Fixed windows keyed by hashed (caller origin principal, callee), pruned by `rtc.tick`. |
| Key roster | Admitted foreign principals plus peers of the last 24 h, refreshed by the existing directory background budgets (DEVLOG 2026-10-23 F1/F5). |
| Outbox | 1,024 pending batches per entity; a message past its useful life (spec §8.3) is dropped. |

## 4. Candidate purposes

Draft bodies (all `publisher` = `https://spec.bindle.example`, titles and summaries shortened):

| Line | `media` | `alert` | `parties` | `auto_accept` | `context` |
| --- | --- | --- | --- | --- | --- |
| `…/rtc-purposes/call/v1` | `audio`, `data`, `video` | true | `any` | `never` | `null` |
| `…/rtc-purposes/screen-share/v1` | `audio`, `data`, `screen` | true | `any` | `never` | `null` |
| `…/rtc-purposes/file-transfer/v1` | `data` | true | `any` | `never` | `files` (integer 1–16, `value`), `bytes` (integer 0–10¹², `value`) |
| `…/rtc-purposes/device-sync/v1` | `data` | false | `self` | `self` | `null` |

File names travel inside the data channel after the claim, never in `context`, so a provider and every notified device see only counts.

## 5. Reuse and retirement of Beam code

Beam was removed from the core on 2026-10-26 (user direction; provisional, unsigned). Nothing of RTC beyond the two relay building blocks below exists yet. What happened to each Beam component:

| Beam component | Fate |
| --- | --- |
| `packages/beaming/turn.mjs` (`CloudflareTurnAdapter`) | **Moved** to `packages/rtc/turn.mjs`, tested but unused until `packages/rtc/relay.mjs` wraps it. Its host allowlist and response validation stay. |
| Relay lifecycle in the former `packages/runtime/account/beams.mjs` (`iceIssued`, issuing lease, ≤ 4 re-issues, revocation on terminal states and sweep, reservation cap) | **Moved** to `packages/rtc/relay-credentials.mjs` as a tested but unused building block; to be **generalized** into the relay occupant: usernames persisted per leg, revoked at leg end and by `rtc.relay-sweep`, renewals bounded per leg, reservation from the entity's own budget only. |
| Offer state machine, sender-owned record, recipient mailbox, atomic first-accept | **Deleted.** RTC sessions replace them: the caller's record and the callee's record each live in their own entity's writer; the callee writer decides the claim. |
| Signal records with role and monotonic sequence (`beam_signal_sequence`) | **Deleted.** Leg-signed messages with per-leg `seq` and a 32-message buffer replace them. |
| Nearby invitations (`/api/beams/invites*`, QR SVG) | **Deleted.** One-use `rtc-ticket` links replace them; ticket QR codes will need a local QR renderer again. |
| Contact beam permission (`beamEnabled`) | **Dropped, not converted.** Stored grants are copied to `contact-sharing/<grantId>` without `beamEnabled` by the `beam-retired-v1` account step (legacy rows kept for one release for rollback safety). Contact RTC configuration is designed with RTC (spec §4.3). |
| Contact profile, sharing, saved contacts and the `contact-redeemed-peer/<peer>/<grantId>` index | **Kept** as generic contact code in `packages/links/contact-profile.mjs` (`ContactProfiles`). RTC admission does not use redemption bindings (review R6). The peer index is kept with a bounded `peerBindings` lookup that no route uses yet (it was Beam's permission lookup); disclosure itself reads the binding by grant ID. Whether saved contacts belong in core is a pending user decision. |
| Paid-sender eligibility and monthly offer/byte allowances (`beamFunding`, `BEAM_MONTHLY_*`) | **Deleted from core.** A future Beam app may keep its own policy. The core keeps only the relay budget. |
| `/api/beams/*` routes, `packages/beaming/http.mjs`, `packages/runtime/routes/beams.mjs`, `BEAM_ENABLED`, `BEAM_STUN_ENABLED`, `BEAM_TURN_ENABLED` | **Deleted** on 2026-10-26; the flags moved to `RETIRED_FLAGS`. |
| Browser data-channel framing `3sln-beam-v1`, save sinks, Blob fallback, `apps/web/src/bl/beaming.mjs`, `apps/web/src/ui/release-beaming.mjs` | **Deleted from core.** A future Beam app can recover them from git history (last full commit `54124aa`) as the `file-transfer/v1` data-channel profile. No file-transfer UI remains in core. |

## 6. Beam as a reference application

Future work. Beam can return as a separately registered application (working name `apps/beam/`, its own origin) that:

1. Requests the `rtc-signaling/v1` slot with `purposes: [file-transfer/v1, device-sync/v1]` and `ice-relay/v1` optionally.
2. Uses `open` with `context: {files, bytes}`; the receiving Beam endpoint shows the sender and counts, the user accepts, and the file manifest (names, sizes, selection) is exchanged and confirmed in the data channel under the former `3sln-beam-v1` framing (recoverable from git history), which becomes the purpose's documented data-channel profile.
3. Uses own-device sessions with `target` for "send to my laptop", and one-use tickets with QR for nearby pairing.
4. Enforces paid-sender and allowance rules itself, server-side, if it keeps them.

Migration: none is needed for RTC, because Beam was removed from the core on 2026-10-26 before RTC was built, so file transfer is unavailable until such an app ships. Contact `beamEnabled` grants were dropped, not converted. The `beam-retired-v1` account step re-keys the kept contact rows and deletes Beam-only state. [beaming](../spec/beaming.md) is a superseded stub; its full text, including the streaming and manifest review rules a Beam app would adopt as its own, is in git history (last full commit `54124aa`).

## 7. Core UI surfaces (no file-transfer UI)

These are 3sln.me presentation choices, not spec requirements.

| Surface | Content |
| --- | --- |
| Consent for the slot | Within the existing consent page: the purposes requested, per purpose its title (attributed to the host of its `id`), media, whether it can ring you, who it can connect with; each purpose individually approvable; no preselection. |
| Settings → Connections & calls | Per application: approved purposes with ring on/off, auto-accept for own-device purposes, revoke. IP privacy: relay-only for other people (default), direct for own devices. Requests from people without a link (off by default). Blocked people. Relay source (the `ice-relay` slot assignment). |
| Devices | Per device, its RTC endpoints by application, last seen, revoke. |
| Contact link editor | "Can call or connect with you", with purposes (the former Beam toggle was dropped on 2026-10-26). |
| Call links | Create, show QR, copy, revoke `rtc-ticket` links; uses left and expiry. |
| Incoming ring | A portal notification for an alerting invite whose application has no endpoint currently listening: caller (verified identity, handle only when verified), purpose, the application that will handle it, and Decline, Block, Open. Open navigates to the application's verified origin. The call experience itself is always the application's. |
| Activity | Missed and held invites, with clear, block and allow; active sessions with End. |

## 8. Implementation plan

### 8.1 Slices

| Slice | Content | Write ownership | Depends on |
| --- | --- | --- | --- |
| RTC-a | Message, certificate, control and SDP/candidate validators | `packages/rtc/messages.mjs`, `packages/rtc/certificates.mjs`, `tests/rtc-messages.test.mjs`, `tests/rtc-certificates.test.mjs` | — |
| RTC-b | Purposes kind and context projection | `packages/rtc/purposes.mjs`, `tests/rtc-purposes.test.mjs` | artefact store |
| RTC-c | AMD-X1 bound options in the extension and consent code | `packages/federation/extensions.mjs` hunk, `packages/federation/schema.mjs` hunk, `tests/extensions-bound-options.test.mjs` | coordinator hand-off: these files are under concurrent federation edits |
| RTC-d | Sessions, admission, tickets, service, same-host transport, account slice | `packages/rtc/{sessions,admission,tickets,service}.mjs`, `packages/runtime/account/rtc.mjs`, `packages/app/domains/rtc.mjs`, `tests/rtc-engine.test.mjs`, `tests/helpers/rtc-fixture.mjs` | a, b, c |
| RTC-e | Foreign transport, federation endpoint, key roster | `packages/rtc/federation.mjs`, `packages/runtime/routes/rtc.mjs`, `tests/rtc-federation.test.mjs` | d |
| RTC-f | Relay occupant | `packages/rtc/relay.mjs`, `tests/rtc-relay.test.mjs` | d |
| RTC-g | Owner UI and portal ring | `apps/web/src/bl/rtc-settings.mjs`, `apps/web/src/ui/rtc-settings.mjs`, `apps/web/src/ui/rtc-ring.mjs`, `tests/browser/rtc-settings.mjs` | d |
| RTC-h | Beam reference app (future work; Beam core code was already removed 2026-10-26) | `apps/beam/**` | d–f |
| RTC-i | Clean-room conformance peer (second provider) | `tests/rtc-conformance-peer.mjs` | e |

**Status (2026-10-26).** RTC-a, RTC-b and RTC-c are implemented locally (provisional, unsigned):

- RTC-a: `packages/rtc/jws.mjs` (the shared links §3.1 profile), `messages.mjs` (messages, SDP, candidates, IP policy, batch and §8.2 step 1), `certificates.mjs` (leg certificates, control statements), `tickets.mjs` (the ticket meta payload and canonical basis links; minting and use counting stay in RTC-d) and `extension.mjs` (slot manifests, feature validator, the AMD-X1 bound-artefact table). Tests: `tests/rtc-messages.test.mjs`, `tests/rtc-certificates.test.mjs`, `tests/rtc-tickets.test.mjs`, fixtures in `tests/helpers/rtc-wire-fixture.mjs`.
- RTC-b: `packages/rtc/purposes.mjs` and the four candidate envelopes in `docs/artefacts/rtc-purposes/`, registered as operator documents in `packages/runtime/artefact-pins.mjs` like intent kinds; `rtc-purpose` stays out of `DEFAULT_KINDS` until its growth table is signed (only pinned versions are usable). Tests: `tests/rtc-purposes.test.mjs`.
- RTC-c: AMD-X1 in `packages/federation/extensions.mjs`, `service.mjs` and `runtime.mjs` (gated by `EXTENSIONS_ENABLED`), the composition row in `packages/runtime/federation.mjs`, the consent kit addition in `apps/web/src/ui/authorize-entry-consent.mjs` with Spanish strings in `packages/i18n/authorize-catalogue.mjs`, and extensions §13 (provisional amendment text). `schema.mjs` needed no change. Tests: `tests/extensions-bound-options.test.mjs`, `tests/browser/consent-bound-options.mjs`.
- Flags: `RTC_SIGNALING_ENABLED` (requires `EXTENSIONS_ENABLED` and `ARTEFACT_VERSIONS_ENABLED`), `RTC_FOREIGN_ENABLED` (requires `RTC_SIGNALING_ENABLED` and `DIRECTORY_ENABLED`), `RTC_TICKETS_ENABLED` and `RTC_TURN_ENABLED` (both require `RTC_SIGNALING_ENABLED`). The only code gated so far is the composition's bound-purpose resolution, which also needs `RTC_SIGNALING_ENABLED` (review follow-up).
- Interfaces left for RTC-d onward: `verifyLegCertificate` takes the issuer's certification keys as held and the identity URI the verifier resolved itself; `batchStep1` takes the certificate and control parsers; `FederationService.checkBound`/`boundApproval` give the occupant the live per-app approval (they REQUIRE the verified token's `subject`, `clientId` and `grants`, optionally `epoch`, and count only grants with a live connection; the `federation.bound-approval` operation is system-only); `verifyLegCertificate`/`verifyControl` take `keys` as directory-shaped entries or a lookup (`directoryCertificationKeys` adapts the directory's certification lookup), and `verifyControl` REQUIRES `expected.iss` and `expected.sub`; for §6.4, a reused `seq` has the "same content" only when its payload bytes (the received second JWS segment) are identical, so a re-serialized payload with equal JSON but different bytes is different content and ends the leg, while a second signature over the same payload bytes is the same content (a duplicate); replay state compares payload bytes, never signatures (ECDSA signatures are randomized; low-S only removes the malleated twin); `validateInviteForPurpose` and `projectContext` give the callee checks. Readings of the spec made in code are listed in the DEVLOG entry and extensions §13.

Coordinator-owned shared hunks: `packages/flags/registry.mjs` (four flags), `packages/app/providers.mjs` (domain row), `packages/runtime/routes/index.mjs` (mount), `packages/runtime/federation.mjs` (feature declaration), `packages/i18n/catalogues.mjs` (strings), and the published contract and slot artefacts. These files are under concurrent edits; RTC slices touch them only by hand-off.

### 8.2 Test plan

- **Engine level (most tests):** every spec §19 item as engine tests through `RtcService` with two in-process providers joined by the same-host and a loopback foreign transport.
- **Seeded chaos:** a deterministic seed drives callers, callees with several endpoints, two providers, message loss, duplication, reordering and delay, concurrent claims, glare, revocations, moves, expiry and relay failures. Invariants checked after every step:
  - C1: at most one callee leg per session is accepted, at both providers.
  - C2: no SDP or candidate reaches an endpoint other than the two session legs, and none before the claim.
  - C3: nothing from an ended leg or session is accepted.
  - C4: the federation response (status, body, and timing class in the harness) is the same across every admission outcome.
  - C5: no `host` or `srflx` candidate leaves an endpoint whose owner policy is `relay`; no relay candidate carries a real `raddr`.
  - C6: every storage bound in §3.4 holds.
  - C7: every session ends by its maximum lifetime; every relay credential is revoked or expired by then.
  - C8: blocked, muted, quarantined and unapproved invites never alert.
  - C9: messages go only to the current issuer's manifest endpoint.
  - C10: no request-path fetch occurs except the link-verified exception.
- **Adversarial cases:** forged and cross-profile certificates; a certificate signed by the identity key; a reused `delegate`; replay of an invite to another callee; a `sid` collision chosen by another caller; seq floods and gaps; oversized SDP; addresses smuggled in SDP or `raddr`; candidates before the claim; double accept race; decline after accept; a revoked device posting directly; messages via a moved identity's old issuer; ring floods from one and from many principals; ticket use races; a purpose fetch attempt on the request path; push endpoints at private addresses.
- **Browser (DOM and real WebRTC):** consent and settings in real Chrome; two-browser same-provider and two-provider calls on loopback; relay-only with a local TURN; perfect-negotiation collision; device revocation mid-call.

### 8.3 Production gates

Release stays disabled. Before any RTC flag is enabled in production: the user's sign-off of RTC-1 to RTC-17 and AMD-X1 and AMD-R1 to R6; an independent security review; a clean-room second provider interoperating over real HTTPS; real-device WebRTC on restrictive NATs, mobile background and foreground suspension; Web Push delivery verified per platform (a stored subscription is not delivery); the existing relay-budget gate (beaming architecture: externally enforced aggregate spend) before `RTC_TURN_ENABLED`; abuse load tests at the §13 limits; a privacy review of retention and logs; terms stating that RTC is not a telephony or emergency service; accessible incoming-ring and settings surfaces. No configured key, flag or screenshot counts as evidence for any of these.

## 9. Provisional decisions

Each is provisional (coordinator), not signed off by the user.

| ID | Decision | Recommendation | Sign-off |
| --- | --- | --- | --- |
| RTC-1 | Shape: `features` entry for provider-to-provider, exclusive slot with built-in non-brokerable occupant for apps, `rtc-purpose` artefacts, `rtc-ticket` link type. | Adopt. It reuses every extension mechanism and adds no parallel one. | Reviewer ___ Date ___ Outcome ___ |
| RTC-2 | AMD-X1 bound consumer options in extensions. | Adopt. Alternative: one slot per purpose (rejected, §16 of the spec). | Reviewer ___ Date ___ Outcome ___ |
| RTC-3 | End-to-end message signatures by per-session leg keys certified by the issuer, instead of provider-signed hop-by-hop events. | Adopt. Lets endpoints detect a peer provider rewriting fingerprints. | Reviewer ___ Date ___ Outcome ___ |
| RTC-4 | Admission bases: own entity, link (contact with RTC configuration, or ticket), opt-in requests; relation basis reserved. | Adopt; revisit relations after ORG-11. | Reviewer ___ Date ___ Outcome ___ |
| RTC-5 | No address before the claim; SDP never carries candidates or addresses; optional candidate-free offer in the invite. | Adopt. | Reviewer ___ Date ___ Outcome ___ |
| RTC-6 | Cross-entity default IP policy `relay`; direct only by owner opt-in; own devices may default to direct. | Adopt. Consequence: with hosted relay off, cross-entity sessions need opt-in to connect directly. | Reviewer ___ Date ___ Outcome ___ |
| RTC-7 | Each party funds its own relay (own `ice-relay` occupants or app relay); hosted relay stays off until budget enforcement. | Adopt. | Reviewer ___ Date ___ Outcome ___ |
| RTC-8 | No ringing, busy or presence message in v1; decline only on user action. | Adopt; reconsider a per-contact "show that I'm being rung" opt-in later. | Reviewer ___ Date ___ Outcome ___ |
| RTC-9 | Lifetimes: ring ≤ 120 s, session ≤ 24 h, leg certificate ≤ 900 s (issuer-declared, 120–900; review R7 lowered it from 3,600 s to bound the revocation window). | Adopt; 3sln.me issues 600 s. | Reviewer ___ Date ___ Outcome ___ |
| RTC-10 | Optional committed SAS profile (6 digits). | Adopt as optional. | Reviewer ___ Date ___ Outcome ___ |
| RTC-11 | Reference-host limits (spec §13 fixes only the kinds): per (caller, callee) 6 invites / 10 min; per caller principal 30 invites / h across all entities; per (sending issuer, callee) 20 invites / h and per (sending issuer, link parent) 60 / h; per callee 4 ringing sessions and 60 invites / h; 32 held requests per callee; per caller entity 8 open sessions and 60 `open` / h; per leg 256 messages / min. | Adopt as starting values; tune with load tests. | Reviewer ___ Date ___ Outcome ___ |
| RTC-12 | Device delivery: long poll required; Web Push and integration doorbells optional; WebSocket deferred. | Adopt; a hibernating WebSocket profile is a likely later 3sln.me addition. | Reviewer ___ Date ___ Outcome ___ |
| RTC-13 | Multi-party is a non-goal; no group member in v1. | Adopt. | Reviewer ___ Date ___ Outcome ___ |
| RTC-14 | Beam leaves core and may return as a reference app. Revised 2026-10-26: Beam code and routes were removed outright, without waiting for the app. | Adopt. | Reviewer ___ Date ___ Outcome ___ |
| RTC-15 | Retention: session records ≤ 24 h after end; missed list ≤ 30 days; no SDP or candidate retention. | Adopt. | Reviewer ___ Date ___ Outcome ___ |
| RTC-16 | Core shows a portal ring notification only as a fallback; the application owns the call experience. | Adopt. | Reviewer ___ Date ___ Outcome ___ |
| RTC-17 | The caller's application origin (`client.origin`) is disclosed to the callee in the leg certificate. | Adopt; it lets callees judge which app is calling. Alternative: omit for caller privacy. | Reviewer ___ Date ___ Outcome ___ |

## 10. Review

One adversarial self-review round (forked reviewer, 2026-10-26; an engineering finding, not human sign-off) found 7 High, 11 Medium and 6 Low issues. All are applied to revision 1 as published here.

| ID | Sev. | Finding | Resolution (spec section) |
| --- | --- | --- | --- |
| R1 | High | Ticket uses spent at step 2, before signature checks; `principal` compared with an unverified claim. | Validity checked at step 2; use spent and `principal` compared with the verified certificate atomically at step 8 (§4.3, §8.2). |
| R2 | High | Session lookup keyed by sender, so callee answers could never be found; no rule for the first callee leg. | Lookup by caller origin principal (from `aud` for callee legs); first verified `seq` 0 answer becomes the callee leg (§8.2). |
| R3 | High | Relay-only endpoints told to ignore the peer's non-relay candidates, breaking connectivity without privacy gain. | Policy restricts only gathered and sent candidates (§10). |
| R4 | High | Raw host addresses allowed by `all` but forbidden by §6.3. | `all` is own-entity only; receivers enforce only policy-independent rules (§6.3, §10). |
| R5 | High | Auto-accept let one app's session be auto-claimed by a different app. | Auto-accept only when the caller leg's `client_id` is the claiming application (§3.4, §4.4). |
| R6 | High | Refreshes scheduled from unverified batches had no bounds (amplification, arbitrary hosts). | Organizations §5.2 rules: bounded queue, budgets, manifest floor first, negative caching (§8.2). |
| R7 | High | Revoked device could keep signing for a whole 3,600 s certificate; control statements retried only 30 s. | Control statements retried until the affected certificates expire; certificate ceiling 900 s (§3.1, §8.3, §14). |
| R8 | Med | "Redeemed principals" undefined across providers. | Dropped; principal-bound tickets restrict callers (§4.2, §4.3). |
| R9 | Med | Link verification inside a message underspecified. | Canonical form, digest and "as if requested" verification (§4.2). |
| R10 | Med | `aud` check implied constructing identity URIs. | Step 1 checks only origin and URL shape (§8.2). |
| R11 | Med | Identity URI taken from the certificate claim. | Directory, pin or move record only (§5.1, §11.2). |
| R12 | Med | Caller provider might not hold callee keys when the answer arrives. | Caller-initiated fetch at `open`, kept warm (§4.1). |
| R13 | Med | SAS encoding ambiguous; no rule for a missing reveal. | 32 bits mod 10⁶; no display before a verified reveal (§11.3). |
| R14 | Med | AMD-X1 recorded no purpose versions. | Per-line `{version, digest}`; later versions only when additive; disclosure growth is a widening (§3.5). |
| R15 | Med | One issuer minting principals could exhaust ringing slots. | Per-issuer limits; ringing preference for `self` and bound bases (§13). |
| R16 | Med | Push endpoints as arbitrary outbound targets. | Recognized push origins, pushes counted against invite limits (§9.2). |
| R17 | Med | Endpoint ids were bearer handles. | DPoP `jkt` binding or hashed `endpoint_secret` (§9.1). |
| R18 | Med | Cancel crossing accept undefined. | Converge to `ended` at both providers (§7.4). |
| R19 | Low | Bearer link in the signed invite reached every notified app. | Only `link_digest` and `callback_digest` are signed; links travel in the batch and are never delivered, except the callback to the claimant (§4.2, §8.1, §9.1). |
| R20 | Low | Unbounded delegate and `aep` state. | 24 h delegate window; epochs kept only with roster or admission state (§5.1, §8.2). |
| R21 | Low | Fan-out selection, claim and `target` eligibility, glare exception. | Most recently active first; only notified endpoints claim; eligible `target`; glare exception named (§4.4, §7.2). |
| R22 | Low | Partial batch failure; trickle not required. | Whole-batch refusal; `a=ice-options:trickle` (§6.3, §8.1). |
| R23 | Low | Product UX and host numbers in the spec. | Ticket usage bullets and held-request presentation cut; limit values moved to RTC-11 (§4.3, §4.4, §13). |
| R24 | Low | Stale references; provider consumer of `ice-relay` unmentioned; `sid` sent to brokered relays. | References fixed; extensions §5.3 named; `sid` only to built-in relay occupants (§3.2, §3.3). |

Residuals recorded: the link-verified fetch exception still lets a caller who runs its own provider observe, by an incoming identity-document fetch, that its link verified (as organizations §5.1 accepts); a revoked device keeps signing until the control statement arrives, at most the certificate's remaining lifetime; a provider hosting both parties can mount an undetected man-in-the-middle unless users compare the SAS.
