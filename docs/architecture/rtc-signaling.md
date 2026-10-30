# Signaling: design and 3sln.me implementation (revision 3.2)

> **Group:** 3sln.me architecture (development record, not published)
>
> **Status:** design and implementation notes for [signaling](../spec/extensions/signaling.md) **revision 3.2** (draft). The engine phase (signaling Appendix C.5 steps 2 to 4 and the core-removal half of step 5) is **implemented locally behind default-off flags** (2026-10-28), with its independent review fixes applied. The provider owner pages and the conformance peer rewrite are in progress, and the enrolment approval page (step 7) has not started. Nothing is published, deployed or production-verified. Every decision is provisional (coordinator) and **not signed off by the owner**. Rewritten 2026-10-28 from the revision 1 RTC design, which is kept below as a superseded record.
>
> **Covers:** how 3sln.me implements the generic signaling primitives: the `self`, `pairing` and `offer` bases; bound and open offers; service-class endpoints; pairings and rules P1 to P4; session kinds and session handler approvals in intents; the `webrtc` and `data` profiles; limits; lifecycle and the §14.2 narrowing; connection-generation liveness; the built-in relay; what moved to Parlay; and what remains.
>
> **Does not cover:** the normative rules, which are in the [signaling spec](../spec/extensions/signaling.md) (if this document disagrees with it, the spec wins and the difference belongs in DEVLOG.md); calls and call invitations ([Bindle Messaging §5.5](../spec/extensions/messaging.md) and the Parlay app); device authorization ([device authorization](../spec/extensions/device-authorization.md)); local clients ([local clients spike](local-clients-spike.md)); production gates, which are in [release gates](../3sln/release-gates.md) ("Signaling") and [security](../spec/security.md).

Decision records: DEVLOG.md 2026-10-28, "Signaling revision 3.2 engine phase implemented locally (Appendix C.5 steps 2–4 and the core-removal half of 5)" and "Signaling revision 3.2 engine: independent review fixes (H-1, M-1 to M-4, L-1 to L-3, L-6)"; the spec revisions are listed in its status paragraph. This document adds no decision of its own. The spec's decisions are SG-1 to SG-51 (signaling §19.2), and the 3sln.me readings are listed under "Divergences and implementation choices" below. Reviewer ___ / date ___ / outcome ___.

**How to read section references.** The sections of this part have no numbers. Section numbers such as §5, §8.1, §8.3 or §9 cited by older documents and code comments that point at `docs/architecture/rtc-signaling.md` refer to the superseded revision 1 record (Part II below), whose headings are unchanged. The file keeps its name so that those links still resolve.

# Part I: signaling revision 3.2 (current)

## Direction

The owner, 2026-10-27: "I only intended for a general signaling mechanism, app to app, user to user, provider to provider, etc; something flexible enough for all use cases, but I didn't intend to build actual calling into bindle, that's an app level concern." And, as relayed to revision 3: core signaling is unaware of calls and contacts, and provides the primitives that apps need.

So the provider supplies one generic, signed session channel and three ways to admit an invite. It defines no use vocabulary, presentation, ringing or missed-call list. What a session is for is a session kind that an app publishes. Calling is built in Parlay (below).

## The mechanism in one paragraph

An endpoint (one app connection on one device instance, or one enabled provider feature) talks only to its own entity's provider, through the signaling contract (spec §10). For each session leg it generates a fresh ES256 key, which its provider certifies in a short-lived **leg certificate** (at most `max_leg_certificate_seconds`, 120 to 900 s; 3sln.me issues 600 s). Every message is signed end to end with that key. Providers relay messages unchanged to each other through the declared `endpoint` (`/bindle/signaling` on 3sln.me) and verify the same signatures endpoints do, with no request-path key fetch and a uniform `202`. The recipient provider admits an invite only on a **basis**, routes it to the endpoints of exactly one app fixed by that basis, and lets the **first claim** win atomically at the entity's single writer. Before that claim nothing reveals whether the recipient has an endpoint, is online, admitted or blocked the initiator (spec §12.1). Unclaimed sessions end silently.

## Building blocks

| Piece | What it is | Spec |
| --- | --- | --- |
| Extension declaration | `{spec, options}` in the manifest `extensions` array; options `endpoint` (an audience option), `max_leg_certificate_seconds` and `profiles`. Prerequisites: the directory and artefact-versions extensions. The declaration confers no authority. | §3.1 |
| Signaling fragment | `…/fragments/signaling/v1`: one exclusive `resource` field, contract `…/contracts/signaling/v1`, `x-bindle-brokerable: false` (only the issuer can certify leg keys), `consumers: ["application", "provider"]`, no per-consumer options. The grant says that an app may use signaling; which kinds it may use is the owner's session handler approval, checked live. | §3.2 |
| Ice-relay fragment | `…/fragments/ice-relay/v1`: `relays`, 0 to 4, `ordered`, brokered relay resources allowed; one method, `credentials({sid?})`. | §3.3, §16.7 |
| Session kinds | Intent kinds with a `session` member (AMD-SG-I1). Core registers none. | §3.4, §20.1 |
| Profiles | `webrtc` (Annex A) and `data`. A new profile needs a spec revision. | §3.5, §16 |

There is no slot, no provider feature of signaling's own, no artefact kind, no link type and no AMD-X1 bound option. The interim `…/extensions/rtc-signaling/v1` identity is retired (extensions §2.8, EXT3-35).

## Session kinds and handler approvals (intents)

Intents supplies two things to signaling, and nothing else: the kind registry and per-app approvals. It never routes an incoming invite, and no chooser or intents default is consulted (spec §5.4, SG-44).

- **The `session` member** (`packages/intents/sessions.mjs`, validated by `packages/intents/schema.mjs`): `parties` (`self`, `other` or `any`), `profiles` (each with its parameters; both registered profiles take `{}`) and optional `bases` (a subset of `self`, `pairing` and `offer`; `none` is reserved). Both providers enforce `bases`. The kind's existing intent members supply the title, publisher, the `data` schema and disclosure (which become the invite `context`), sensitivity categories and versioning.
- **Session handler approvals** are stored in intents memory per (app or provider feature, kind line), pinned to the approved `{version, digest}`, with the per-app `auto_connect` setting for `self` kinds. They are exported with the `intent-choices` row. A later kind version is admitted only when it is additive without new disclosure (spec §15).
- **Live checks.** Every widening contract method (`open`, `register`, `renew`, `offer`, `claim` with `accept`, `send` other than end, cancel or decline, and relay credentials) checks the approval live and answers `approval_required` without one. Narrowing methods (`revoke_offer`, `unregister`, `decline`) are never gated.
- **Removing an approval** runs the §14.2 narrowing in the same transaction.
- **Flag.** `SESSION_KINDS_ENABLED`, separate from `INTENT_LINKS_ENABLED`, because session kinds are not tied to the intent-links extension (spec §20.1.8).

## Profiles

- **`webrtc`.** Offer, answer and candidates, with every SDP and candidate rule of Annex A (no address before the claim, the owner's IP policy: `relay` by default across entities, `public` by opt-in, raw host candidates only between own devices), fingerprint binding and the structural `m=` check. What media a connection carries is the endpoints' concern.
- **`data`.** No transport negotiation: small opaque `data` messages after the claim, for rendezvous, app-level key agreement or device pairing. A payload is 1 to 4,096 bytes, and a leg's payloads total at most 65,536 bytes. Each provider bounds the aggregate `data` bytes it relays per entity in a rolling window (256 KiB per hour per entity on every plan, `BOUNDS.dataBytes`; owner-approved 2026-10-28). It is not a transfer channel.
- **Production gate for `data`** (spec §3.5): the aggregate budget enforced and tested at the engine level (done locally), a cost-model row (done: `dataEconomics()` in `scripts/cost-model.mjs`), and the AMD-SG-S1 custody statement reconciled with security.md (not done). The budget is 256 KiB per hour per entity, the same on every plan (owner-approved 2026-10-28; it was 1 MiB). At that budget Paid's worst-case margin is 60.5%, over the 50% floor, but 48.5% with its full relay allowance as well ([unit economics](unit-economics.md) "Relayed signaling `data` bytes"). `tests/cost-model-margins.test.mjs` asserts the first and records the second as a `todo` naming the relay byte-cap gate.

## Establishment bases

There is one mechanism. The basis decides three things: what admits the invite, which endpoints receive it, and who may claim it without a user action (spec §5.6).

| Basis | Wire | Admits | Routes to | Claim with no user action |
| --- | --- | --- | --- | --- |
| `self` | `basis: null`, same entity | Own entity | The initiating app's eligible endpoints, or a `target` endpoint of the same app | `auto_connect`: same app, `parties: self`, owner setting on the approval (default off) |
| `pairing`, own entity | `basis: null` with `target` of a paired app | As `self`; the pairing widens routing and acceptance only | The `target` endpoint covered by the other side | Yes (`paired`, `auto_connect`) |
| `pairing`, other entity (relation basis) | `{relation: "pairing"}` | A live pairing whose `peer.principal` is the verified initiator, for that kind line, letting the peer open | The endpoints covered by the pairing's `local` side | Yes (`paired`) |
| `offer` | `{offer_digest}`, token carried beside the message in the batch | A live offer with a free use, minted by the recipient for this kind line, version and profile, open or bound to the verified initiator; and a nonempty routing set | The minting endpoint, else the minting app; for a service-class offer, every online endpoint of the minting app or feature | Yes (`offer_match`), after the endpoint's outstanding-offer check on the digest |

A cross-entity invite with no basis admits nothing, silently (the old `none` basis is reserved). Every basis fixes the receiving app, so an invite is never visible to another app (no AMD-RW1 cross-app visibility) and a foreign initiator's asserted `client_id` never influences routing. Delivery goes to at most 16 endpoints of the routing set, most recently active first, with late delivery to an eligible endpoint that registers or listens before `answer_by` (at most 120 s).

## Offers: bound and open

An offer is a **reverse dial**: the minting app opens nothing. It mints offers on its own provider and hands them out through its own channels (for example inside an app message); the holder's app dials back with `open` and `basis: {offer: <token>}` after its user acts.

- **Bound offer.** Names one origin principal (1 to 16 per `offer` call, never the owner). Always single-use; the use is **spent at admission**, whatever happens to the session afterwards.
- **Open offer.** Names no principal and admits any verified principal except the minting entity, up to `uses` sessions (default 1; reference maximum 16, or 10,000 for a service-class endpoint). A use is **reserved** at admission, **spent** only by an `accept` claim and **released** by a decline or an unclaimed end. Spent plus reserved never exceeds `uses`.
- **Expiry.** 10 to 900 s. Only a service-class endpoint may mint longer: up to 90 days for an open offer and 7 days (reference) for a bound one.
- **Storage.** Only the token's SHA-256, the principal or `null`, the kind line, approved version and profile, the minting endpoint and app, whether the minter was service-class, the use counts and `expires_at`. The token is never stored, logged, journalled or delivered to an endpoint. Revoked and expired offers are deleted at once (review M-2); an exhausted one keeps its hash until expiry.
- **What ends an offer.** `revoke_offer` or the owner; expiry; the end of the minting app's or feature's authority for the kind (approval removed or cleared, grant revoked, connection ended, feature disabled); removal of a service designation (offers over 900 s only); a move or deletion. Unregistering or expiry of an endpoint, and revoking one client session of a still-connected app, never end an offer. Pending sessions an offer admitted end silently when it ends; claim versus end is decided atomically at the same writer.
- **No oracle.** Expired, revoked, exhausted, mismatched and unknown offers all admit nothing and get the uniform `202`. A digest that names an offer the initiator may not use is limit-classified as an unbased invite, so a borrowed bound offer buys no exemption.
- **Key warming** at `offer` is issuer-level only: never a named principal's identity document or keys.

**Service-class endpoints** (spec §2, §4.3) are endpoints of a provider feature, or app endpoints of a **service entity**: an organization entity whose owner designated it so, on an owner page that discloses standing reachability. A person entity cannot be designated, an undesignated organization's apps are not service-class, and an endpoint registered in member context never is (review M-4). A service-class offer belongs to the minting app or feature, not to one endpoint: it routes to every eligible endpoint that is **online** (a `listen` outstanding or within 60 s), projects `offer_match` on each, and the first claim wins. 3sln.me builds no provider feature that holds sessions today, and the designation page is one of the outstanding owner pages.

## Pairings (P1 to P4)

A pairing is a per-edge owner record between exactly two parties. It pre-authorizes one app (or one enrolled client session of it) to connect automatically, for one kind, with one other app of the owner or with one peer principal (spec §5.8). Pairing parties are apps; a provider feature is never one, and an own-entity pairing needs two different apps (review L-2).

- **P1, each party granted individually.** Every app party holds its own live connection, signaling grant and session handler approval, each from its own owner action. A pairing never creates or implies them.
- **P2, one edge per pairing.** Connecting a daemon to three apps takes three pairings. Nothing admits "any app". An entity holds at most one cross-entity pairing per (peer principal, kind line).
- **P3, pending until explicitly activated.** A new pairing is `pending` and admits, routes and accepts nothing until an owner control for that one pairing activates it, armed after a delay, once every party satisfies P1. When every party already qualifies at creation, the creation control is the activation control. A pending pairing is deleted after 7 days. A live pairing never returns to pending. A device-authorization pairing is `awaiting_confirmation` until its M4 code comparison (step 7, not built).
- **P4, visible from both parties.** An own-entity pairing is listed with both apps' connection entries; a cross-entity one with its `local` app and in a by-peer list. Either listing can remove it.

Members: `kind` (pinned; re-confirmation when a later version adds disclosure), `local {client_id, client_session}`, `peer` (`{self: …}` or `{principal}`), `opens` (`local`, `peer` or `both`), `accept: "auto"`, `label`, `created_via`, `state`, `expires_at` (cross-entity always expires: default 90 days; the 3sln.me maximum is 366 days). Updates are compare-and-swap on `revision`. Coverage is by `client_id` and, when a side binds one, the endpoint's recorded client session, checked in both roles everywhere a pairing has an effect. Apps learn the pairings that cover them through `endpoints({endpoint})` and `pairing` events; `endpoints({pairing})` lists the other side's live endpoints (own entity, opening side only, with the provider's own labels and no `last_seen`). A pairing is deleted when removed, expired, still pending after 7 days, when either app's approval or grant goes, when its bound client session ends, when its peer or the peer's issuer is blocked, or on move or deletion. Deleting it ends claimed sessions with `revoked` and pending invites silently. Cross-entity creation needs fresh authentication (3sln.me: session `authTime` within 5 minutes).

Only the recipient's own record is enforced by the recipient: a non-conforming peer provider can skip the initiator-side check (spec §5.1 item 7), and the creation page discloses this.

## Limits

Reference values are 3sln.me policy (`LIMITS` in `packages/signaling/admission.mjs`, `BOUNDS` in `packages/signaling/sessions.mjs`); the kinds of limit are normative (spec §13.1). Excess invites are dropped silently after verification and still answered `202`.

- **Recipient windows:** per (initiator, recipient); per initiator across the host (one host-wide window); per (sending issuer, recipient) for cross-entity invites; pending and connected capacity per recipient; messages per leg; and the aggregate `data` budget per entity.
- **Separate windows.** Own-device (`self`) invites, including own-entity `open` calls on the initiator side, use their own window outside every cross-entity window. Bound-offer invites skip the per-recipient and issuer windows. Open-offer invites are charged only to a per-offer window, a per-(principal, offer) window and a per-issuer fair share of the per-offer window (max(W / (n + 1), F)), plus the host-wide initiator window. Own-entity pairings have a window per (pairing, endpoint pair) and at most two live sessions per pair; cross-entity pairings have a window and a live cap per pairing `id`. Dead-offer and unpaired relation invites count as unbased.
- **Sub-budgets.** All pairings together get at most half of the entity's pending capacity, connected capacity and `data` budget (review M-3 corrected the code to half of base pending capacity). Open-offer sessions get at most half of pending and connected capacity.
- **Pending reserve.** Two shares, `self` and cross-entity, two pending sessions each; unbased and open-offer invites never use it.
- **Initiator side:** open sessions and `open` calls per entity; live offers (64 per entity, 32 per app) and mints (120 per hour per app); key-warming fetches; `data` bytes sent.

## Lifecycle and the §14.2 narrowing

The narrowing triggers are exactly those of spec §14.2: endpoint unregister or 30-day idle expiry; revoking a device or app connection; revoking the signaling grant; removing or clearing a session handler approval; an app connection ending for any reason; revoking or ending a client session; disabling or suspending a provider feature; deleting a pairing; removing a service designation; revoking or expiring an offer. Each runs only the steps that apply: stop relaying and certifying for the affected legs; revoke relay credentials; send `revoked` control statements for claimed legs (retried while the certificate is usable); end pending invites silently when no other app still holds them; remove endpoint registrations; revoke offers only when the app's or feature's authority for the kind ends; delete the affected pairings. Narrowing is never gated by a flag; widening owner actions are.

In 3sln.me the hooks are: the intents approval routes (removal runs §14.2 in the same transaction); grant revocation and connection end, which clear approvals and run §14.2 (`AppConnections.disconnect` calls a connection-ended hook; failures of the cascade drain and `grantSync` are retried from `grant-sync` rows on the federation cleanup alarm instead of being swallowed); and the account tick, which sweeps stale apps. Moves (§14.3), the §14.5 unassignment hook, clearing when an adopted manifest stops declaring a kind, and `signalingClientSessionRevoked` (L-4) are not wired yet.

## Connection-generation liveness

Review H-1 found that ending an app connection relied on a hook that could be skipped. The engine now records the app's **connection generation** when the owner approves it (`sig/app/` rows; the `connections` port reads `appConnectionState` from `packages/apps/connections.mjs` in the writer's transaction). Every app endpoint, approval, offer and pairing belongs to that generation:

- **live**: the connection is live at the recorded generation; everything works;
- **inert**: the same generation but paused or fenced, or no generation recorded (for example an imported approval); nothing admits, routes or authorizes until the owner re-approves;
- **stale**: the connection ended or changed generation; the state is cleared (§20.1.4) and §14.2 runs, from the tick sweep or the next touch. Re-approval clears first, so earlier state never revives after a reconnect.

Choice (provisional): any generation change counts as connection end for signaling, including pause and resume, re-setup and a manifest change. That narrows more than §20.1.4 requires, on purpose.

## Relay

The built-in `ice-relay/v1` resource (`packages/signaling/relay.mjs`, with `relay-credentials.mjs` and the Cloudflare adapter in `turn.mjs`) issues short-lived TURN credentials only for a live leg of the calling app's own session (a pending initiator leg before `answer_by`, a connected one, or a recipient leg whose accept won), re-checks the approval for the session's kind version (review L-6), revokes credentials on every end path with a sweep for missed ones, and enforces per-account and per-session quotas (`RELAY_LIMITS`; plan allowances `RELAY_PLAN_BYTES`). A credential is never put in a signaling message or sent to the peer.

Issuance stays refused unless `SIGNALING_TURN_ENABLED` is on **and** the deployment supplies a TURN adapter and an external spend authority that enforces a per-owner byte cap from the relay provider's own usage data (spec §16.7 byte-cap rule, AMD-SG-S2). No spend authority ships, so hosted relay is unreachable on every deployment. Each party funds its own relay; Free has no hosted allowance.

## Transport, delivery and privacy

- **Between providers:** `POST /bindle/signaling` (renamed from `/bindle/rtc`), behind `SIGNALING_FOREIGN_ENABLED` and an empty-by-default `SIGNALING_FOREIGN_ISSUERS` allowlist, with step 1 at the route, dark ingest, the same-host `iss` refusal and shedding. The security.md S4 egress gate is not passed.
- **Same provider:** the same-host transport delivers through exactly the foreign verification path (`signaling.ingest`), with no public endpoint.
- **Devices:** `listen` long poll is required; the Web Push doorbell is optional and carries only `{"t":"signal","endpoint":…}`. The integration doorbell (AMD-SG-E1) is not built.
- **Retention:** payloads deleted on delivery or after 60 s, replay state as hashes, session records deleted within 24 h of the end, no owner-visible invite history.

## Where it lives in 3sln.me

| Area | Files |
| --- | --- |
| Engine | `packages/signaling/`: `messages.mjs` (envelope, bases, `webrtc` and `data` profiles, batch codec), `certificates.mjs` (leg certificates, control statements), `jws.mjs` (`typ` list over `packages/core/signed-object.mjs` and strict JSON), `sessions.mjs` (states `pending`/`connected`/`ended`, first claim, replay, glare ranks from leg-key thumbprints, `BOUNDS`), `admission.mjs` (blocks, IP policy, windows, fair share, capacity classes), `service.mjs` (`SignalingService`: routing set, offers, pairings, projection, outbox, same-host transport, and the ngin Actions and Queries), `federation.mjs` (foreign transport, key roster), `extension.mjs` (descriptor, options validator, fragments, prerequisites), `relay.mjs`, `relay-credentials.mjs`, `turn.mjs`. |
| Intents | `packages/intents/sessions.mjs`, `schema.mjs`; approvals in intents memory; `packages/runtime/routes/intents.mjs`. |
| Runtime | `packages/runtime/account/signaling.mjs` (account slice, contract actor, drain, roster, `legacyRtcReset`), `packages/runtime/routes/signaling.mjs` (the federation endpoint), `packages/runtime/routes/signaling-owner.mjs` (owner JSON routes, adapters for the owner pages), `packages/runtime/federation.mjs` (descriptor and mounts), `packages/runtime/export-contributors.mjs`. |
| Flags | `SIGNALING_ENABLED` (requires `EXTENSIONS_ENABLED`, `ARTEFACT_VERSIONS_ENABLED` and `SESSION_KINDS_ENABLED`, never `INTENT_LINKS_ENABLED`), `SIGNALING_FOREIGN_ENABLED` (requires `DIRECTORY_ENABLED`), `SIGNALING_TURN_ENABLED`, `SESSION_KINDS_ENABLED`; the four `RTC_*` flags are retired. All default off. |
| Storage | `sig/` (was `rtc/`); pairings and provider blocks (`sig/block-iss/`, closing the old export gap) are exported, offers excluded. Legacy `rtc/` development rows are deleted in bounded pages by an alarm step (`legacyRtcReset`) and export-excluded until gone; destructive and pre-release. |
| Owner UI | No signaling view: the IP policy and blocked list are under Account & security, and each app connection lists its approvals, endpoints, live offers and pairings. |
| Tests | Engine-first: `tests/signaling-engine*.test.mjs`, `signaling-admission`, `signaling-chaos` and `signaling-chaos-lifecycle` (seeded, spec-derived), `signaling-wargame*`, `signaling-review*`, `signaling-runtime`, `signaling-federation*`, `signaling-relay*`, `signaling-owner-routes`, `intents-session-kinds`; the conformance peer is being rewritten. |

## What moved to Parlay

Every call-specific part of the old RTC code left core: the ring screen and its poller, the "Calls & connections" view and `calls` portal module, the call purpose and the other `rtc-purpose` documents, missed calls, mutes, alert policy, call-link tickets and 136 call strings. Calling is Parlay's to build on [Bindle Messaging §5.5](../spec/extensions/messaging.md) and these generic methods: Parlay publishes its own call kind, carries bound offers inside its own messages, and owns all presentation. Nothing call-specific was re-homed into `packages/signaling`. Contact-link admission (the `link` basis) was withdrawn in revision 3 and contact links were removed from core in contacts phase 4; an app that wants a person to reach it hands that person an offer.

## What remains

- **Owner pages (in progress, 2026-10-28).** Session handler approval, pairing creation and activation, the live-offer list and the service designation must happen on provider pages that meet the §20.1.4 page obligations. The JSON owner routes are adapters only. Release gate: [release gates](../3sln/release-gates.md) "Signaling", "Owner pages".
- **Conformance peer rewrite (in progress; Appendix C.5 step 6).** The suite is to be rewritten from the revision 3.2 text and pass in strict mode (spec §21; release gate "Conformance").
- **Enrolment approval page (not started; step 7).** Session handler approval and one pairing control per already-connected app on the device-authorization page, the M4 code-comparison confirmation, AMD-SG-D1 if signed off, and local-client enrolment after the local clients spike's identity phases. `signalingClientSessionRevoked` must be wired first (review L-4; release gate "Client sessions").
- **Not yet built:** `clientSession` plumbing from the federation runtime; moves (§14.3); the §14.5 unassignment hook; the integration doorbell (AMD-SG-E1); approval clearing when a manifest stops declaring a kind; the §3.4 background fetch of unheld kind versions.
- **Data budget and cost.** The `data` budget fails the Paid margin floor (above); the AMD-SG-S1 custody statement is unreconciled (release gate "Data profile").
- **Docs.** The pending-signoffs digest still needs the revision 3.2 items (step 8).
- **Owner sign-off** of C.5 step 1 (SG-2, SG-23 to SG-30, SG-36 to SG-46, AMD-SG-I1) is outstanding, which is why every flag stays off.

## Divergences and implementation choices (provisional)

Recorded in the DEVLOG entries above; each is provisional and unsigned, and a spec change for any of them belongs in a later revision:
- an unpaired relation-basis invite is limit-classified as unbased;
- `approval_required` is a no-effect code (`NO_EFFECT_CODES`);
- the offer refresh lane requires the offer to admit the claimed sender (stricter than the text);
- grant revocation also clears session handler approvals (L-7; §20.1.4 lists only connection end and manifest change);
- any connection-generation change counts as connection end (above);
- reference values: `data` budget 256 KiB per hour per entity with a pairing sub-budget of half (lowered from 1 MiB; owner-approved 2026-10-28); pairings capped at half of base pending capacity; maximum pairing expiry 366 days; fresh authentication within 5 minutes;
- offer expiry, the pending-pairing limit and pairing expiry are also enforced at use, not only by sweeps (L-1).

# Part II: superseded record, RTC signaling design revision 1 (2026-10-26)

> **Superseded and retired (2026-10-28), pending owner sign-off.** Everything below is the revision 1 decision record for `rtc-signaling.v1`, kept unchanged so that its decisions (RTC-1 to RTC-17), review findings and section references stay resolvable. The `packages/rtc` code it describes has been replaced by `packages/signaling` (Part I), the `RTC_*` flags are retired, and the dispositions of its decisions are in [signaling Appendix B](../spec/extensions/signaling.md#appendix-b-disposition-of-existing-rtc-decisions). Do not implement from it. The supersession note written on 2026-10-27 follows.


> **Superseded (2026-10-27), pending owner sign-off.** The extension this plan implements, RTC signaling (in git history: `git show bbbbdad:docs/spec/superseded/rtc-signaling.md`), is superseded by the generic [signaling](../spec/extensions/signaling.md) draft, which removes calling concepts (ring, missed calls, alert policy, purposes, call-link tickets) from the provider; calls move to the Parlay app and [Bindle Messaging §5.5](../spec/extensions/messaging.md). Slots, `features` and AMD-X1 used below are removed by [extensions revision 3](../spec/extensions.md) (draft). This plan remains the reference for the flags-off `packages/rtc` code until signaling Appendix C retires it; do not start new work from it.

Design date: 2026-10-26, revision 1. **Implementation status (2026-10-27):** slices RTC-a (wire validators and codecs), RTC-b (the `rtc-purpose` kind), RTC-c (AMD-X1 bound consumer options) and RTC-d (sessions, admission, tickets, the `RtcService` occupant, the same-host transport and the account slice) are implemented locally with engine-level, runtime and seeded chaos tests; the four flags of §3.3 exist and default off. RTC-g (owner routes, the "Calls & connections" console view and the portal ring) is also implemented locally, behind the same flag. RTC-e (the contract route, the foreign transport, `POST /bindle/rtc`, the key roster, the lifecycle triggers and the Web Push doorbell) is implemented locally behind `RTC_FOREIGN_ENABLED` and an empty-by-default `RTC_FOREIGN_ISSUERS` allowlist, with the findings of an independent security review fixed locally (§8.1, RTC-e review follow-ups); the security.md S4 egress gate is not passed. RTC-f (the built-in `ice-relay/v1` relay occupant: live-leg credentials, revocation on every end path, the sweep, per-account and per-session quotas) is implemented locally behind `RTC_SIGNALING_ENABLED` and `RTC_TURN_ENABLED` and two ports, a TURN adapter and an external spend authority; no deployment has the spend authority, so hosted relay stays unreachable (relay-spend budget gate, §8.3). Nothing is production-verified (§8.1 status; DEVLOG 2026-10-26 "RTC-a/b/c validators, purposes and bound options (flags off)", 2026-10-27 "RTC-d sessions, admission and same-host transport (flags off)", 2026-10-27 "RTC-g owner settings and portal ring (flags off)", 2026-10-27 "RTC-e foreign transport, endpoint and key roster (flags off)" and 2026-10-27 "RTC-f relay occupant (flags off)"). Every decision here is provisional (coordinator), **not signed off by the user** (§9). Normative rules: rtc-signaling spec (in git history: `git show bbbbdad:docs/spec/superseded/rtc-signaling.md`). Decision record: [DEVLOG](../../DEVLOG.md) 2026-10-26, "RTC signaling extension design". Reviewer ___ / date ___ / outcome ___.

## 1. Direction and summary

User direction (2026-10-26): spec a Bindle extension for cross-provider WebRTC signaling, generic and secure, usable between devices of one user or of different users, for any purpose (calls, data transfer and so on), as flexible as possible without compromising security or privacy. App-level experiences stay out of the 3sln.me core: Beam's file-transfer experience moves to an app, and the core provides the primitive. Follow-up direction the same day: build it on the extension system already specified in [extensions](../spec/extensions.md), name any gap explicitly and propose the smallest addition, and reconcile with the existing beaming spec. Further direction (2026-10-26): Beam was removed from the core outright the same day rather than kept until an application ships (§5, §6); beaming became a superseded stub (in git history: `git show b7c04cc:docs/spec/superseded/beaming.md`).

The design in one paragraph: an application asks for the **`rtc-signaling/v1` slot** (exclusive, provider built-in occupant, non-brokerable contract) with the **purposes** it wants approved, bound per application by the one extension-system addition, **AMD-X1**. Purposes are `rtc-purpose` **artefacts** (media, alerting, parties, auto-accept, a context schema). To call, an endpoint gets a **per-session leg key certified by its own issuer** and signs every signaling message with it. Providers relay those messages unchanged to each other through the **`rtc-signaling.v1` feature endpoint**, verifying them with no request-path fetch and answering a uniform `202`. The callee provider admits an invite only on a **basis** (own entity, a contact link with RTC enabled, an **`rtc-ticket` link**, or an opt-in request policy), fans it out to eligible endpoints, and lets the **first claim** win. No SDP address or candidate leaves a device before that claim, and cross-entity sessions default to **relay-only**, with each party using **its own relay** (the optional `ice-relay/v1` slot). DTLS fingerprints are bound into the signed messages, with optional direct key verification and a committed **SAS** for users who want detection of provider substitution.

## 2. How it fits the extension system

| Need | Existing mechanism reused | Where |
| --- | --- | --- |
| Provider-to-provider endpoint, discovery and version | `features` entry `rtc-signaling.v1` ([protocol §2](../spec/protocol.md#2-discovery-and-login)); extensions §2.1 sends provider-implemented roles to `features` | spec §3.1 |
| App-facing capability, consent, revocation, pinning, versioning | A slot whose built-in occupant is declared in the provider manifest's `extensions` array, requested as a fragment with `digest` | spec §3.2 |
| Owner-chosen relay funding | A second slot, `ice-relay/v1`, `ordered`, brokered occupants allowed | spec §3.3 |
| Purpose identifiers that apps register | An artefact kind with a growth table, like intent kinds | spec §3.4 |
| Capabilities for nearby pairing, call-me links and callbacks | A link type under links (dissolved; in git history: `git show bbbbdad:docs/spec/superseded/links.md`) | spec §4.3 |
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
| `packages/rtc/relay.mjs` | Built-in `ice-relay/v1` occupant (RTC-f). Uses the `CloudflareTurnAdapter` at `packages/rtc/turn.mjs` and generalizes the lease, revoke and sweep logic of `packages/rtc/relay-credentials.mjs` (both moved from Beam on 2026-10-26; the latter stays a tested building block that nothing calls) and Beam's former D1/D2 credential lifecycle (§5). |
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
| System (never wire-dispatchable) | `rtc.ingest` (step 1, then the bounded inbound queue; answered at once), `rtc.inbox` (steps 2–8 for queued batches, on the receiver's detached task or alarm), `rtc.outbox-drain`, `rtc.tick` (ring and session expiry, replay and limit pruning), `rtc.key-roster` (background refresh roster for admitted peers), `rtc.lifecycle` (move commit, revocation, app disconnect → control statements), `rtc.relay-sweep` |
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
| Sessions (caller or callee record) | 8 open as caller, 4 ringing plus 8 connected as callee; record deleted 24 h after end. Each record pins the peer's certification keys that verified its leg (at most 8), so the peer's control statements verify after its keys stop being served or rotate. At most 4 `failed` control replies per session, one per (session, leg). |
| Per-endpoint event queue | 256 events or 512 KiB; overflow ends affected sessions `failed` and sets `gap`. |
| Replay window | Per (session, leg): highest `seq`, up to 32 buffered messages; dropped 300 s after end. |
| SDP and candidates | Never stored past delivery, or 60 s. |
| Missed and held list | 100 entries and 30 days per entity, owner-deletable. |
| Blocks, mutes | 1,000 blocks and 256 mutes per entity. |
| Contact RTC configuration | 16 purposes per parent, stored on the parent record. |
| Tickets | Live tickets count against the links service's existing per-account parent cap. |
| Limit counters | Fixed windows keyed by hashed (caller origin principal, callee), pruned by `rtc.tick`. The limit per caller origin principal across callee entities is also counted host-wide in the shared `WORK_AUTHORITY` guard, keyed by an HMAC of the principal. |
| Key roster | Admitted foreign principals plus peers of the last 24 h, refreshed by the existing directory background budgets (DEVLOG 2026-10-23 F1/F5). |
| Outbox | 1,024 pending batches per entity and 64 per peer, keyed per peer so a drain pass pages past a failing peer; message batches stop 128 (total) and 16 (per peer) short of the caps, which are kept for control statements; a full outbox refuses `send` with `rate_limited`; a message past its useful life (spec §8.3) is dropped. Delivery never runs inside the sending request. |
| Relay leases (RTC-f) | One per leg that asked for relay credentials (`rtc/relay/<session key>`), at most 64 rows per entity and 8 TURN usernames each, never the credential; revoked at leg end, deleted by the sweep once the leg is dead and its usernames are revoked or expired (at most 300 s). |
| Relay allowance counters (RTC-f) | Reserved bytes per UTC month (current and previous month kept) and one fixed one-hour issuance window (`rtc/relay-use/`). |
| Inbound queue | 256 step-1-valid batches or 4 MiB per entity; `rtc.ingest` answers at once and a full queue answers `503`; steps 2–8 run later, as of receipt. |

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

Migration: none is needed for RTC, because Beam was removed from the core on 2026-10-26 before RTC was built, so file transfer is unavailable until such an app ships. Contact `beamEnabled` grants were dropped, not converted. The `beam-retired-v1` account step re-keys the kept contact rows and deletes Beam-only state. The beaming stub was retired on 2026-10-29 (in git history: `git show b7c04cc:docs/spec/superseded/beaming.md`); the full text, including the streaming and manifest review rules a Beam app would adopt as its own, is in git history (last full commit `54124aa`).

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

**Status (2026-10-27).** RTC-d is implemented locally (provisional, unsigned; DEVLOG 2026-10-27 "RTC-d sessions, admission and same-host transport (flags off)", which lists its spec readings RTCd-1 to RTCd-20):

- `packages/rtc/sessions.mjs` (state machine, first claim, the per-leg ordering and payload-bytes replay window, bounds), `admission.mjs` (bases, owner policy, block and mute, RTC-11 fixed-window limits with hashed keys, fan-out candidates), `tickets.mjs` (minting, owner-host verification by exact stored meta, atomic use counting), `service.mjs` (`RtcService`, its ngin operations, the outbox, `sameHostRtcTransport`), `packages/app/domains/rtc.mjs` (classification) and `packages/runtime/account/rtc.mjs` (the account slice: `rtcDispatch`, `rtcListen`, `rtcPeer`, `rtcPublicKeys`, `rtcAlarm`, `rtcDrain`).
- Shared one-line hunks made with this slice: the `rtc` row in `packages/app/providers.mjs`, the slice entry in `packages/runtime/account/index.mjs`, the `rtcAlarm` call in `packages/runtime/accounts.mjs`, `rtcDrain` in the deletion E4 `DRAINS` list (`packages/runtime/account-deletion.mjs`) and the `rtc` export contributors and exclusions in `packages/runtime/export-contributors.mjs`.
- Tests: `tests/rtc-engine.test.mjs` (fixture `tests/helpers/rtc-fixture.mjs`, including the seeded chaos test) and `tests/rtc-runtime.test.mjs` (two Node account writers).
- Review follow-ups (2026-10-27, DEVLOG RTC-d "Review follow-ups", provisional and unsigned):
  - Delivery is asynchronous at both ends. `commit` never delivers: it asks the adapter (`defer` port) for a pass, which the account slice runs as a detached task after the request answered, with the alarm as the durable fallback. `rtc.ingest` checks step 1, stores the batch in the bounded inbound queue `rtc/inq/` and answers; the new system operation `rtc.inbox` runs steps 2–8 (also run first by `rtc.tick`), one pass at a time per writer.
  - The outbox is keyed per peer (`rtc/outbox/<peer>/<seq>`) with a per-peer cap and a control-statement reserve; a drain pass pages past a held peer; a full outbox refuses `send` with `rate_limited`. `failed` replies to extra callee legs are limited to one per (session, leg) and four per session.
  - Session records pin the peer's certification keys; control statements verify against them when the held keys do not verify. The purge's identity stage runs `rtcDrain` (best effort) before the tombstone; the E4 drain stage still finishes delivery.
  - The per-caller limit across callee entities is a host-wide window (`hostLimits` port → `WORK_AUTHORITY`). Repeat claims only while the claim is usable; `send` applies the stricter of the session's and the owner's current IP policy; contact rows keep `parent`, and ticket rows keep the non-secret `purposes` and `principal` for export.
- Interfaces left for RTC-e onward:
  - **RTC-e (contract route, foreign transport, key roster):** build the `{kind:'app', owner, clientId, origin, grants, epoch?, jkt?}` actor from the verified federation RPC dispatch context (the token's grant ids are required) and call `rtcDispatch`/`rtcListen` with `RTC_CONTRACT_OPERATIONS`; wire `config.RTC_BOUND_CHECK` to `FederationService.checkBound` (absent, every endpoint operation is refused); add a foreign `transport` with `foreign: true` (the service refuses foreign callees with `unsupported_peer` until then); feed `keys.certification`/`keys.identity` for foreign principals from the roster, cache-only, and implement `keys.refresh` (called when a sender's key is not held); call `rtc.ingest` from `POST /bindle/rtc` and answer `202` for every batch that passes step 1 (`rtc_batch_invalid` is the step-1 refusal; `temporarily_unavailable` 503 is a full inbound queue, independent of steps 2–8), and make sure the receiving writer's `defer` pass or alarm runs `rtc.inbox` (the route must never run steps 2–8 itself); the foreign transport is called only from `drain`, which never runs inside a sender's request; trigger `rtc.lifecycle` `app-narrowed`/`app-revoked` from `federation.narrow-bound-options` and grant revocation; the Web Push doorbell (subscriptions are validated and stored, nothing is sent).
  - **RTC-f (relay occupant):** a live-leg check over `rtc/out/<sid>` (`mine`, state) and the claimed `rtc/in/…` record; revocation hooks on the session `end` path (`RtcService.end`).
  - **RTC-g (owner UI and portal ring):** the owner operations and queries in `RTC_OWNER_OPERATIONS` (policy, contact RTC configuration, block, mute, tickets, sessions, missed and held, endpoints, export) through owner routes; `RTC_WIDENING` answers the uniform 404 while the flag is off.

**Status (2026-10-27).** RTC-g is implemented locally (provisional, unsigned; DEVLOG 2026-10-27 "RTC-g owner settings and portal ring (flags off)", readings RTCg-1 to RTCg-16):

- `packages/runtime/routes/rtc-owner.mjs`: `GET /api/rtc/settings`, `GET /api/rtc/ring` and `POST /api/rtc/{action}` for the ten owner operations, as `{kind:'owner'}` through `rtcDispatch`. While `RTC_SIGNALING_ENABLED` is off, widening answers the uniform 404 (byte-identical to an unknown `/api` path), reads, narrowing and ending stay available, and nothing rings. `sessionFeatures` gains `rtcSignalingEnabled`.
- `apps/web/src/bl/rtc-settings.mjs` (Actions), `apps/web/src/ui/rtc-settings.mjs` ("Calls & connections": network privacy, who can call through each contact link, requests, apps with their approved purposes, devices and automatic answers, active sessions, missed and held invites, call links, blocked people, and the code-comparison guidance) and `apps/web/src/ui/rtc-ring.mjs` (the ring, in its own live-region root, and the navigation gate). Shared hunks: the `rtc` portal module, the composition root, the dialog chain, the catalogue (en and es), the stylesheet and two `package.json` script entries.
- Tests: `tests/rtc-owner-routes.test.mjs` (Node runtime and real HTTP), `tests/browser/rtc-settings-engine.mjs` and `tests/browser/rtc-settings.mjs` (in `test:ui-state`), and `tests/browser/rtc-settings-browser.mjs` (Chromium and Firefox; `test:rtc-ui`).
- Interfaces still missing, described in the DEVLOG entry and not added here (the RtcService and federation files belong to other slices): the per-session `alert` in the owner session view (so an application mute also silences the portal ring), an owner route to narrow an app's bound purposes (`FederationService.narrowBoundOptions` has no controller, remote or route method, and narrowing must also trigger `rtc.lifecycle` `app-narrowed`, an RTC-e hook), and, only if wanted, an owner-level on/off switch for calls.

**Status (2026-10-27).** RTC-e is implemented locally (provisional, unsigned; DEVLOG 2026-10-27 "RTC-e foreign transport, endpoint and key roster (flags off)", readings RTCe-1 to RTCe-18):

- `packages/rtc/federation.mjs`: `RtcKeyRoster` (cache-only `keys` for foreign principals over the host's `IdentityDirectory`; bounded roster, refresh queue and negative cache; the manifest floor and a valid `rtc-signaling.v1` before any identity-document fetch; `warm` at `open`, `refresh(principal, kid)`, `track`, `maxLegSeconds`), `rtcEgress` (allowlist, media type and §8.1 bound over the adapter's screened POST egress) and `foreignRtcTransport` (`foreign: true`; 202 delivered, network/429/5xx retried by the outbox, anything else dropped).
- `packages/runtime/routes/rtc.mjs`: `POST /bindle/rtc` calls only `rtc.ingest` on the writer named by the batch's one `aud` (202, `rtc_batch_invalid` 400, uniform 404, per-network 429, full-queue 503).
- Contract route: the `${subject}/rtc` built-in occupant descriptor and the `RESOURCE_METHOD_HANDLERS` entry (`rtcResourceMethod`); the federation dispatch context now carries the token's grant ids, the client's registered origin and the DPoP `jkt`; `listen`/`endpoints` are reads, RTC write results are not kept in the federation journal, and `listen` long-polls outside the account gate (`rtcContractListen`). `config.RTC_BOUND_CHECK` is `FederationController.checkBound` on both adapters.
- `RtcService` additions: kid-aware refresh scheduling before steps 2–8, re-sending an unanswered invite to a foreign callee until `ring_until`, the peer's declared certificate bound, permanent delivery refusals dropped, and the Web Push doorbell over the existing push transport.
- Lifecycle: `FederationService.boundSync` (after revocation, narrowing and app removal) → `rtcAppChanged` → `rtc.lifecycle` `app-revoked`/`app-narrowed`; the account connection cascade also runs `app-revoked`.
- Manifest: `rtc-signaling.v1` (flags plus `mounts.rtc`) and the occupant entry (inert until some slice declares `extensions.v1`).
- Tests: `tests/rtc-federation.test.mjs` (two providers over a fake network, chaos included; fixture `tests/helpers/rtc-federation-fixture.mjs`) and `tests/rtc-federation-runtime.test.mjs` (Node runtime).
- Interfaces left: wiring the successor index (`current`) once adoption is enabled, the integration doorbell event (`rtc-ring/v1`, AMD-R3), a durable retry of the bound-approval hook, a controller/remote/route method for `narrowBoundOptions` (needed by RTC-g), and the `moved` control at move commit (RTCd-25).

**Status (2026-10-27, review follow-ups).** An independent security review of the RTC-e diff found six issues and some low items; all are fixed locally (provisional, unsigned; DEVLOG 2026-10-27 RTC-e entry, "Review follow-ups", which corrects readings RTCe-6 and RTCe-9 and lists the new production gates):

- Key roster (F1): each directory fetch class has its own per-site budget (`interactive` for `warm`, `background` for refresh-ahead, `claimed` and `linked` a third each). Claims go into lanes: peers with a live or ringing session first, then claims whose invite carried a link basis that verified at step 2 (spec §8.2 step 3 exception), then plain claims, capped per source network per writer. The route passes a pseudonymous source network with each batch.
- Kill switch (F2): control-only batches resolve the peer endpoint through a directory path gated only by the allowlist, `DIRECTORY_ENABLED` and the egress, or from a held feature.
- Egress budgets (F3, F4): the Node directory egress shares one budget state across allowlists, with per-class sub-budgets. Every `IdentityDirectory` on a host also spends a host-wide per-site, per-class budget through `WORK_AUTHORITY` (ABUSE Durable Objects on Workers, the in-process abuse store on Node).
- Inbound shedding (F5): the relation endpoints and `/bindle/rtc` share one helper. It refines the source network by `CF-Worker` under a network ceiling. Node takes the client address from `TRUSTED_CLIENT_IP_HEADER` only when that is configured, and drops client copies of `CF-Worker`.
- Invite re-send (F6): only after the first `202`, at most twice, and never after a permanent refusal.
- Low items (F7): `/bindle/rtc` answers the uniform 404, and the manifest withholds `rtc-signaling.v1`, while `RTC_FOREIGN_ISSUERS` is empty. Doorbells go out in parallel, at most four at a time.
- Owner UI: a foreign caller's app origin is labelled "reported by {provider}" in the ring. Narrowing or revoking an app silently ends an unanswered invite that was ringing only through that app.
- Tests: `tests/rtc-review-followups.test.mjs` (the review's three proofs of concept kept as regressions, plus the other findings).

**Status (2026-10-27, verification follow-ups).** A verification review of that fix round found four more issues; all are fixed locally (provisional, unsigned; DEVLOG 2026-10-27 RTC-e entry, "Verification follow-ups"):

- Host budgets: the host-wide keys name the feature (`directory-host-v1/rtc/…`, `…/org/…`), and every class has a per-tenant share (about 1/16 of the class limit) spent first. `interactive` has no host-wide class limit, only the tenant share; `rtc.open` spends a per-owner `warms` limit before the caller-initiated fetch.
- Inbound shedding: the roster `source` is always the plain network pseudonym, and every admission from a network counts against its 16× ceiling. IPv4-mapped addresses are unmapped before bucketing (Node header and socket, and `subnet`).
- Key roster: a peer is tracked (and marked live) only once a session record exists; live and linked entries are capped per issuer.

**Status (2026-10-27, RTC-f).** The relay occupant is implemented locally (provisional, unsigned; DEVLOG 2026-10-27 "RTC-f relay occupant (flags off)", readings RTCf-1 to RTCf-14):

- `packages/rtc/relay.mjs`: `RtcRelay` (one per entity writer, attached to its `RtcService`), `legLive`, the contract fitting (`contractIceServers`), the generic `ice-relay/v1` result check (`validateIceRelayResult`, for any occupant), `RELAY_LIMITS`, `RELAY_PLAN_BYTES`, `turnAdapterFrom` and `relayConfigured`.
- Engine: `rtc.relay-credentials` (application endpoint; widening; RTC_SIGNALING_ENABLED and RTC_TURN_ENABLED, both checked by the occupant) and `rtc.relay-sweep` (system, never gated). `RtcService.end` collects the ended record keys and the commit hands them to `relay.ended` (revocation on the detached task in the runtime, at once in tests); `rtc.tick` runs the sweep, so the alarm revokes whatever the end path missed. With either flag off the sweep revokes every held credential (kill switch); revocation is never gated.
- Shared hunks: the `relay` port and two op classes in `packages/rtc/service.mjs`, the domain re-exports, the account slice (`rtcRelayResourceMethod`, the detached sweep, `rtcDrain` waiting for pending revocations), the `ice-relay/v1` handler in `packages/runtime/account/storage.mjs`, the `${subject}/relay` descriptor, the journal exclusion and the inert manifest occupant row in `packages/runtime/federation.mjs`, two export exclusions, the fixture's optional `relay` factory, and `relayEconomics()` in `scripts/cost-model.mjs`.
- Tests: `tests/rtc-relay.test.mjs` (engine level plus one Node runtime reachability test, with a seeded chaos test) and `tests/cost-model-relay.test.mjs`.
- Review follow-ups (DEVLOG 2026-10-27 "RTC-f review follow-ups"): the spend authority's `commit(reservation, {owner, usernames, expiresAt, ttl, bytes, session, sid, leg, endpoint, clientId})` receives each credential's TURN usernames, expiry and leg, so it can attribute provider usage per credential and revoke overruns; relayed bytes are bounded only if it enforces per-owner byte caps from the provider's usage feed (a production gate below). A ringing leg's credential never outlives `ring_until`. Refusals use only `not_found`, `forbidden` and `rate_limited`, which the federation runtime keeps and the slot treats as no-effect, so failover proceeds. The kill switch takes effect within 300 s.
- Not done: an owner view of relay usage, a revocation hook for revoking only the `ice-relay` grant (credentials then lapse within 300 s), organization relay allowances, the provider consumer (portal) of the slot, and any production spend authority.

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

Release stays disabled. Before any RTC flag is enabled in production: the user's sign-off of RTC-1 to RTC-17 and AMD-X1 and AMD-R1 to R6; an independent security review; a clean-room second provider interoperating over real HTTPS; real-device WebRTC on restrictive NATs, mobile background and foreground suspension; Web Push delivery verified per platform (a stored subscription is not delivery); the existing relay-budget gate (beaming architecture: externally enforced aggregate spend) before `RTC_TURN_ENABLED`, which for RTC-f means an operator-supplied `RTC_RELAY_SPEND` authority that caps aggregate TURN spend at the relay and enforces per-owner byte caps from the provider's usage feed, attributed through the usernames it receives at `commit` (none ships), a recheck of the TURN price and free tier behind the [unit economics](unit-economics.md) allowances, the production `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` configuration as an operator concern ([self-hosting](../self-hosting.md), "Hosted relay"), and verification against the real Cloudflare TURN API that issued credentials work and that revocation ends allocations (only injected doubles were exercised); abuse load tests at the §13 limits; the RTC-e review gates (verifying `CF-Worker` and `CF-Connecting-IP` behaviour and the host-wide directory budget on real Cloudflare, and Node deployments setting `TRUSTED_CLIENT_IP_HEADER` behind a proxy; DEVLOG 2026-10-27 RTC-e "Review follow-ups"); a privacy review of retention and logs; terms stating that RTC is not a telephony or emergency service; accessible incoming-ring and settings surfaces. No configured key, flag or screenshot counts as evidence for any of these.

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
