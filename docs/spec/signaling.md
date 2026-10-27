# Signaling (`signaling.v1`) — normative draft

Status: **draft, 2026-10-27, revision 1. Specification only: nothing in this document is implemented to this text.** It is intended to replace [RTC signaling](rtc-signaling.md) (`rtc-signaling.v1`), which is **superseded by this draft, pending sign-off**. The local code still implements `rtc-signaling.v1`, with every RTC flag off and nothing published, deployed or production-verified. Appendix C plans the move. Every decision here is provisional (coordinator) and **not signed off by the owner**. The decisions are SG-1 to SG-22 in §19.2. The owner said provisional decisions may be adopted for now without sign-off, so the eight rev 0 owner questions carry provisional answers in §19.3, and the questions still open are in §19.4. The decision records are in [DEVLOG](../../DEVLOG.md), 2026-10-27: "Generic signaling.v1 spec draft (replaces calling-shaped RTC)" (revision 0) and "signaling.v1 spec rev 1 (review fixes)" (revision 1, which answers an independent review; Appendix A.2 maps each finding to its fix). Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

**Owner direction (2026-10-27, verbatim):** "I only intended for a general signaling mechanism, app to app, user to user, provider to provider, etc; something flexible enough for all use cases, but I didn't intend to build actual calling into bindle, that's an app level concern." And: "Core bindle should be about identity, preferences, intents, and resources; a hub for connecting things together."

This document defines a Bindle extension on the existing extension system. It has:
- a provider **feature**, `signaling.v1` ([protocol §2](protocol.md#2-discovery-and-login));
- one exclusive **slot**, `signaling/v1`, with a built-in occupant ([extensions](extensions.md));
- the existing `ice-relay/v1` **slot**, unchanged (§3.3).

It defines no artefact kind, no link type and no extension-system member. Instead it reuses core primitives:
- **What a session is for** is an [intent kind](intents.md#4-intent-kinds) with a `session` member.
- **Which app answers** is the owner's intent handler choice for that kind.
- **Shareable admission** uses the owner's existing [contact links](links.md#6-contact-link-type) with owner-side configuration. App-minted links and callbacks wait for the links §6 re-scope (§20.3.2).
- **Presentation** is the app's. The provider keeps only a minimal owner hook for invites no app can see (§11.3). Calling and other use semantics are app-level: a messaging app's call invite, for example, is a message with a JSON media type in the messaging/BindleBox spec, not part of this document.

The intents and links changes this needs, and two security.md statements, are written as proposed, unsigned amendments in §20. None of those documents is edited by this draft.

**Routing is not final.** Intents routing (§5.4) is the leading candidate for invite-style establishment only. A second, always-on establishment mode needs a spike (§5.6, §19.4).

It defines interoperability rules only. It has no ring screen, call list, alert or mute policy, call vocabulary, chooser layout, or SDK behaviour.

## 1. Scope, model and guardrails

### 1.1 What it is

A **signed session channel** between two **endpoints**. An endpoint is an application instance on one device, or a provider feature, acting for an entity. The channel carries a short exchange: invite, claim and answer, a bounded negotiation, end. After that the endpoints talk directly or through relays. A **profile** (§3.5) defines any transport-specific negotiation. This version registers two:
- `webrtc`: the WebRTC offer, answer and candidates (Annex A, §16).
- `data`: no transport negotiation, only small, bounded, opaque `data` messages after the claim. Uses include rendezvous, key agreement for app-level end-to-end encryption, and device pairing. It is not a transfer channel: bulk bytes belong on a direct connection that the endpoints set up themselves.

What a session is for (file transfer, a call, device sync, pairing, a game) is an **app-level** matter. It is named by a session kind that an app or anyone else publishes. The provider never interprets it beyond its schema.

- **Path.** An endpoint talks only to its own entity's provider, through the slot's contract (§10). Providers talk to each other only through the feature endpoint (§9). No endpoint ever contacts the peer's provider to signal.
- **Authentication.** Every message is signed end to end by a per-session **leg key** held by the sending endpoint. The sender's provider certifies that key with a **leg certificate** (§6). Providers relay messages unchanged and verify the same signatures endpoints do.
- **Consent.** An initiator reaches a recipient only on an admission basis (§5.2). The invite reaches only the endpoints of the app the owner chose for that kind (§5.4). A session connects only after one of those endpoints **claims** it (§8.2). Before that claim, nothing reveals whether the recipient has any endpoint, is online, admitted the initiator or blocked it (§12.1).

### 1.2 Guardrails: not a second messaging system

These are requirements, not defaults:

1. **No offline delivery.** Nothing is stored for a recipient that is not admitted and claimed within `answer_by`, which is at most 120 s after the invite. There is no store-and-forward, inbox or later retrieval of messages.
2. **Session caps.**
   - A session lives at most 24 h from its invite (§8.1).
   - A leg sends at most 4,096 messages (`seq` 0 to 4,095).
   - In a `data` session, a `data` payload is at most 4 KiB, and a leg's `data` payloads total at most 64 KiB. `data` messages exist only in the `data` profile.
   - Each provider bounds the `data` bytes it relays for each of its entities in aggregate (§13.1).
   - Providers bound concurrent sessions per entity (§13).
3. **Delete after delivery.** Message payloads (SDP, candidates, `data`) are deleted once delivered, or after 60 s. Replay state keeps only payload hashes, never payloads (§7.3). The invite `context` is deleted when the session is claimed or ends. Session records hold routing metadata only and are deleted at most 24 h after the session ends (§12.4).
4. **No history.** No provider keeps message content after delivery. The only owner-visible record of an invite is an owner-hook entry (§11.3), which holds no message content and is deleted by `answer_by`.
5. **No multi-party.** A session has exactly two legs. There is no group member, and no fan-out after the claim (§8.6).
6. **No pre-claim payload.** Before the claim, only the invite's schema-validated `context` and the profile's pre-claim parameters travel (§7.2, §16.3). Opaque `data` is post-claim only. Providers enforce the address rules for profile parameters (§16.4). They cannot enforce them for `context`: schema validation does not detect an address in an app-defined field, so keeping addresses out of `context` is an endpoint requirement (§7.2), not a provider guarantee.

**Non-goals.** Media relaying by providers, recording, telephony interconnect and emergency calling, presence, reachability guarantees, and sessions that act for no entity (§4.3).

## 2. Terms

| Term | Meaning |
| --- | --- |
| Entity, principal | As in [protocol §1](protocol.md#1-model-and-custody). A principal is `(iss, sub)`. Relationships are keyed by **origin principal** ([identity portability §8.1](identity-portability.md#81-stable-identifier)). |
| Endpoint | A registration, at the entity's provider, of one application connection on one device instance, or of one enabled provider feature (§10.1). Endpoints are provider-local and never disclosed to other entities. |
| Initiator, recipient | The two parties of a session. The initiator sends the invite. |
| Session | One attempt to connect an initiator endpoint with one recipient endpoint. It is identified by `sid` and keyed by (initiator origin principal, `sid`). |
| Leg | One endpoint's participation in one session: its leg key, certificate and message sequence. A session has one initiator leg and at most one claimed recipient leg. |
| Session kind | An intent kind whose body carries a `session` member (§3.4, §20.1). |
| Approved handler | An app, or a provider feature, that the owner approved to start and answer sessions of a kind (§20.1.4). |
| Standing acceptance | An owner setting on a session handler approval that lets that handler accept cross-entity sessions of that kind without a user action at the device (§5.5). Off by default. |
| Routing handler | The one approved handler that receives an entity's incoming invites of a kind (§5.4). |
| Basis | What admits an invite at the recipient provider (§5.2). |
| Claim | The atomic, first-wins answer (accept or decline) by one recipient endpoint (§8.2). |
| Pending | An admitted invite that is not yet claimed, cancelled or past `answer_by`. |
| Profile | A registered transport negotiation (§3.5). |

## 3. Building blocks

### 3.1 Feature declaration

A provider whose entities can hold sessions with entities at other providers declares in `features`:

| Feature | Members | Meaning | When absent |
| --- | --- | --- | --- |
| `signaling.v1` | `endpoint` (issuer origin), `max_leg_certificate_seconds` (integer 120 to 900), `profiles` (nonempty, unique, ascending subset of the registered profile ids) | The provider accepts §9 batches at `endpoint` and sends batches only to peers' declared endpoints. It issues leg certificates (§6.1) no longer than the declared bound, and relays and validates the listed profiles. Requires `directory.v1` ([organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1)), `extensions.v1` and `artefact-versions.v1`. | Its entities can hold sessions only with entities on the same provider, if it offers the slot at all. |

The feature confers no authority.

**Local requirement, not a federation dependency.** A provider that offers the slot MUST implement session kinds and session handler approvals (AMD-SG-I1, §20.1) for its own entities. That is local behaviour. Its manifest does not need to declare `intent-links.v1`, and a peer provider MUST NOT check a peer's `intent-links.v1` declaration, or refuse a peer for lacking one. Nothing a peer does depends on how the other side stores approvals.

### 3.2 The signaling slot

```json
{
  "id": "https://spec.bindle.example/slots/signaling/v1",
  "title": "Signaling",
  "description": "Lets an app or a provider feature set up direct connections between your devices and other people's, for the kinds you approve.",
  "publisher": "https://spec.bindle.example",
  "fields": {
    "signaling": {
      "title": "Signaling service",
      "type": "resource",
      "cardinality": {"min": 0, "max": 1},
      "contracts": ["https://spec.bindle.example/contracts/signaling/v1"]
    }
  },
  "slot": {
    "v": 1,
    "field": "signaling",
    "selection": "exclusive",
    "consumers": ["application", "provider"]
  }
}
```

- **Occupant.** The provider's **built-in** occupant, declared in its manifest `extensions` array as `{"slot": "…/slots/signaling/v1", "role": "occupant", "ref": "signaling"}`. The owner assigns it like any occupant ([extensions §5.1](extensions.md#51-assigning-occupants)).
- **Contract.** It declares `"x-bindle-brokerable": false` at its root. Only the entity's own issuer can certify leg keys, so no integration can occupy the slot in this version.
- **Consumers.** `application` and `provider`:
  - An application consumes the slot by requesting the fragment with its `digest` and the methods it needs. The slot grant says *that* the app may use signaling. *Which kinds* it may use is the owner's handler approval (§20.1.4), checked live by the occupant on every operation.
  - A provider feature consumes the slot under [extensions §5.3](extensions.md#53-provider-consumers): it is declared as a `consumer` in the provider manifest, and enabled by an explicit owner action.
- **No `bind`, no consumer options.** The slot needs no per-consumer bound values, so AMD-X1 is not needed (§19, SG-2).
- Every rule of extensions §5 applies: disclosure before assignment, per-consumer approval, revocation, no occupancy oracle, pinning and versioning.

### 3.3 The ice-relay slot (unchanged)

`https://spec.bindle.example/slots/ice-relay/v1` is kept exactly as [rtc-signaling §3.3](rtc-signaling.md#33-the-ice-relay-slot) defines it:
- one `resource` field `relays`, `cardinality` 0 to 4, contract `…/contracts/ice-relay/v1`;
- `selection: "ordered"`, `failover: "pre-dispatch"`, `consumers: ["application", "provider"]`, no options;
- one method, `credentials({sid?})` → `{ice_servers, expires_at}`, a write effect, with brokered occupants allowed.

Carried rules:
- **AMD-RL1.** A built-in occupant also takes `endpoint` and, for an endpoint registered without DPoP, `endpoint_secret`, bound as in §10.1. `sid`, `endpoint` and `endpoint_secret` are sent only to a built-in occupant, never to a brokered one.
- **Disclosure.** A relay occupant sees its own entity's endpoint addresses and peers' relay addresses, and learns when sessions happen.

§16.7 defines how endpoints use relays.

### 3.4 Session kinds

What a session is for is a **session kind**: an intent kind ([intents §4](intents.md#4-intent-kinds)) whose body has the `session` member defined by AMD-SG-I1 (§20.1). The kind's existing members give everything the old `rtc-purpose` had except calling policy:
- the title, summary and publisher;
- the `data` schema and `disclosure`, which become the invite **context** and its disclosure;
- the sensitivity categories;
- the growth table and versioning.

The `session` member adds:
- `parties`: `self` (own devices only), `other` (other entities only) or `any`;
- `profiles`: the profiles a session of this kind may use, each with its profile-defined parameters. Both registered profiles take `{}` (§3.5, §16.2).

There is no alert, ring, auto-accept or media member in the core. A kind is referenced as an artefact reference `{artefact, version, digest}` ([artefacts §5](artefacts.md#5-references)). Providers resolve kinds only under artefacts §7 and §8, and never fetch a kind on the path of a request from another provider (§9.2).

**Where a recipient provider gets a kind version.** A recipient provider resolves the kind version named in an invite only from:
- its own artefact store, including versions pinned by its entities' approvals;
- a mirror under artefacts §8;
- a background fetch whose triggering and timing do not depend on any recipient's state. That is either a periodic refresh of the kind lines pinned on the host, or a fetch scheduled for every step-1-valid invite that names a version the provider does not hold, whatever steps 2 to 8 later decide. Both run under per-line and global fetch budgets, with negative caching.

It MUST NOT fetch, or decide to fetch, a kind because a particular recipient has an approval, an endpoint, a configured link or any other state. An invite whose kind version is not held is not delivered (§9.2 step 7). The fetch that the invite may have scheduled helps only later invites.

### 3.5 Profiles

A profile defines four things:
- its id;
- its kind parameters (§3.4);
- its invite and accept `params` (§7.2);
- any profile message types, with their validation rules and their privacy policy.

This version registers `webrtc` (Annex A) and `data`:
- **`data`** has no kind parameters (`{}`), invite `params` `{}` and accept `params` `{}`. It defines one profile message type, `data` (§7.2), which either claimed leg may send after the claim:
  - `payload` is base64url of 1 to 4,096 opaque bytes;
  - a leg's payloads total at most 65,536 bytes;
  - the provider's aggregate `data` budget for the entity applies (§13.1).

  A `data` message in a session of any other profile is invalid. A `webrtc` session carries application bytes only over its own data channels.

A provider relays only the profiles it declares in `signaling.v1` `profiles`. A new profile is added by a revision of this document, never by a kind or an app.

**Production gate for `data`.** A provider MUST NOT declare `data` in `profiles` in production until all of these hold:
- the aggregate `data` budget per entity (§13.1) is enforced and tested at the engine level;
- the cost model has a row for relayed `data` bytes: the worst case per plan at the aggregate budget, beside the existing relay rows in `scripts/cost-model.mjs`;
- the custody statement for hosted `data` copies (AMD-SG-S1, §20.9) is reconciled with security.md and signed off.

### 3.6 What the provider does not do

A provider implementing this document MUST NOT:
- ring, alert, notify or otherwise present an invite on its own. Its only duty is the owner hook (§11.3), which never interrupts;
- keep any list of missed, unanswered or declined sessions;
- define alert, mute or interruption policy for sessions;
- interpret a kind's meaning;
- compute or display short authentication strings;
- mint link types for calls.

It MAY show the owner hook, the handoff (§11.4) and the owner controls of §14 in its own interface.

## 4. Parties and consumers

### 4.1 Cases

| Case | How it is met |
| --- | --- |
| Own devices | `self` basis (§5.2). Routed to the initiator's own app, or to a named `target` endpoint (§5.4). Raw host candidates are allowed under `webrtc` (§16.4). The owner's auto-connect setting applies (§5.5). |
| User to user, same provider | The same-host transport (§9.4): the full verification path, with no public endpoint. |
| User to user, cross provider | The feature endpoint (§9), held keys and the uniform response. |
| App to app | Any two approved handlers of the same kind, of the same entity or of different entities. The kind names the use. The `data` profile covers apps that need no media. |
| Provider endpoints | A provider feature consuming the slot (§4.2) is an endpoint for one of its hosted entities, and can be either party. With standing acceptance (§5.5), it can answer with no person present. |
| Headless app servers, conferencing services | An app endpoint with no person at the device (for example a server process, or a conferencing service reached with ordinary two-party sessions, §8.6) accepts cross-entity sessions only under standing acceptance (§5.5). |
| Provider to provider | Two provider features acting for hosted service entities (§4.3) on different providers, through the feature endpoint, exactly as apps do, with standing acceptance where the answering side has no person present. |

### 4.2 Provider-feature endpoints

A provider feature that consumes the slot must satisfy four things:
1. It is declared as a `consumer` of the slot in the provider manifest, and enabled per entity by an owner action ([extensions §5.3](extensions.md#53-provider-consumers)).
2. It declares the session kinds it handles in a provider-authored manifest, as a built-in handler ([intents §5](intents.md#5-handler-declarations)). It is approved per kind by the owner exactly as an app is (§20.1.4).
3. Its endpoints are registered by the provider. Its leg certificates carry `client: {client_id: <issuer URL>, origin: <issuer origin>, feature: <declaration ref>}` (§6.1).
4. It gets no authority beyond the owner's approvals and enablement. It is listed among the slot's consumers (extensions §5.1). Disabling the feature ends its endpoints and sessions (§14.2).
5. **Answering policy.** A provider feature has no user action at a device. For a cross-entity session, it accepts only when the owner set standing acceptance on its approval for that kind (§5.5). Within that setting, the enabled feature's own declared policy decides which admitted invites it accepts. The policy is disclosed when the owner enables the feature and when the owner sets standing acceptance. Without standing acceptance, the feature never accepts a cross-entity session.

### 4.3 Out of scope, and service entities

Every session acts for an entity at each end. A provider acting as itself, for no entity, is not a party in this version (§19.3, answer 8). An operator that needs one hosts a **service entity** and enables a feature for it, with standing acceptance where the feature answers on its own.

A service entity is an ordinary entity, typically an organization entity ([organizations §3](organizations.md#3-organization-entities)), that the operator controls. Its approvals, feature enablement and standing acceptance are owner actions taken through its owner interface ([organizations §6.3](organizations.md#63-owner-interface)), with the same disclosures as for any entity. There is no provider-wide shortcut.

## 5. Authorization

### 5.1 Initiator side

Before certifying an initiator leg (`open`, §10.2), the initiator provider MUST check, live:
1. The entity is active.
2. The calling app's connection is live and holds the slot grant with the method. For a provider feature, its enablement is live.
3. The app is an approved handler of the requested kind, at a version it approved (§20.1.4).
4. The kind's `parties` admits the recipient (the own entity or another).
5. The requested profile is listed in the kind's `session.profiles`, and the invite's profile parameters are within the kind's (§16.2).
6. The entity's own limits allow it (§13).

It resolves the recipient to an origin principal in one of three ways:
- from a principal;
- from a contact link presented as basis;
- from a handle, through the recipient issuer's directory ([organizations §3a.2](organizations.md#3a2-handle-lookup)). A provider without a handle index MAY support principals and links only.

It then checks the recipient's issuer:
- If the issuer's validated manifest is held and declares no `signaling.v1`, or does not list the profile, `open` fails with `unsupported_peer`. That is a public fact.
- If the manifest cannot be obtained or validated, `open` fails with `temporarily_unavailable` (AMD-RI5 reading).

The initiator provider then obtains the recipient's current certification keys. This is an initiator-initiated fetch, never on a federation request path. It is spent from a per-entity budget, and only when the keys are not already held. The provider keeps those keys current for the session's life, and pins them on the session record (§6.3), so that the answer and any control statement verify. If it cannot obtain them, `open` fails with `temporarily_unavailable`. Every other outcome of `open` is the same success (§12.1).

### 5.2 Admission bases

The recipient provider admits an `invite` only on one of these bases, evaluated live:

| Basis | Wire | Admits when |
| --- | --- | --- |
| `self` | `basis: null`, and the initiator origin principal equals the recipient | Always, subject to §5.4 and the owner's settings. |
| `link` | `basis: {"link_digest": <base64url SHA-256 of the canonical link>}`, with the link carried beside the message in the batch (§9.1) | The link verifies at the recipient provider as its owner host and is live, the link is an unconditional contact link (§5.3), and its parent's owner-side signaling configuration (§5.3) admits this kind and this initiator. |
| `none` | `basis: null`, another entity | Only if the owner enabled requests from verified identities for that kind. Default: off. A `none` invite is **held**: it is never delivered to endpoints, and it is recorded only as an owner-hook entry (§11.3). |

**Verifying a link basis.** This is unchanged from [rtc-signaling §4.2](rtc-signaling.md#42-admission-bases):
- The link is canonical: the origin and path plus exactly `bindle_meta` or legacy `sig`, with no `bindle_data` and no unrelated parameters.
- Its SHA-256 equals `link_digest`.
- The recipient provider verifies it as if it had received a request for that URL, under [links §8](links.md#8-processing-order-and-results) steps 1 and 2.
- Only the digest is in the signed invite. The bearer link is never delivered to endpoints (§10.2).

A basis grants nothing beyond reaching the routing handler's endpoints with one invite. The initiator is always identified by its verified leg certificate, never by link possession: the link authorizes reaching, and the certificate says who is asking. A relation basis is reserved (§15).

Block, quarantine and limits (§13) apply after verification and are silent.

### 5.3 Contact-link signaling configuration

Signaling admission on a contact link is **mutable owner-side configuration on an existing contact parent**, keyed by `jti`, like intake configuration ([links §6.2](links.md#62-intake-configuration)). It replaces the RTC per-parent configuration (`rtc/contact/`). AMD-SG-L1a (§20.3.1) defines it. In this revision only the owner configures it, on a parent the owner already has. There are no app-minted or signaling-only parents, no delivery-off switch and no callbacks: those wait for the links §6 re-scope (AMD-SG-L1b, §20.3.2) and are **unavailable** until it lands.

| Member | Definition |
| --- | --- |
| `revision` | A nonnegative safe integer, incremented by every update. Updates are compare-and-swap. |
| `kinds` | A nonempty, unique, ascending list of at most 16 session kind line URLs, each pinned at configuration time to the version the owner saw. |
| `uses` | `null` (unbounded within the parent's life), or an integer from 1 to 1,000: how many invites it can still admit. |
| `principal` | `null` (any verified identity), or `{iss, sub}`: only that origin principal. |
| `minted_by` | Always `null` in this revision (owner-configured). The member is kept for AMD-SG-L1b, where it names the app (`client_id`) or provider feature (`feature`) that minted the parent. |

The configuration is never signed into the link, never disclosed in any link representation, and never delivered to the link holder. It is directional: enabling it on Alice's link lets holders reach Alice, not the reverse. When the configuration's `kinds` becomes empty, the configuration is removed.

**Not on conditional parents.** The owner MUST NOT configure signaling on a conditional contact parent (one whose meta has `audience`, [links §7](links.md#7-audience-requirement-conditional-contact-links)), and a provider refuses such an update. A conditional link presented as a basis admits nothing, silently. The reasons for forbidding it, rather than evaluating the audience policy against the verified certificate principal:
- Audience policy is operator host policy, evaluated at GET and at message admission (links §7.4, §7.5). Evaluating it inside §9.2 would put a policy call, and for foreign principals the unwired links §7.3 directory path, into federation verification, which must stay local and cheapest-first (§9.2 step 7).
- Its quota model is per verified principal per UTC day (links §7.1), which does not map onto `uses`.
- The owner already has an exact, local alternative: `principal` names one origin principal, and is compared with the verified certificate principal at step 8.

A later revision MAY lift this once links §7.3 foreign verification exists, by evaluating the policy on the verified leg-certificate principal at step 8, in the way links §7.5 evaluates it on the author principal.

**What link holders and representations see.** Configuring signaling changes nothing a link representation reports:
- The sender metadata representation ([links §6.3](links.md#63-sender-metadata-representation)) is unchanged. Its `kinds` are still the signed message kinds, and it never reports session kinds, `uses`, `principal` or whether signaling is configured.
- The HTML composer, inspection, contact-profile representation and previews (links §6, §6.4) are unchanged and show no signaling state.
- A GET or HEAD of the link never admits, spends or creates anything.
- The parent still accepts messages exactly as its signed meta and intake allow. Configuring signaling adds a way for holders to reach the owner, and it is disclosed to the owner as such when it is set (§14.1).

An initiator learns which kinds a link admits only out of band, from the owner. A wrong guess gets the same `202` as everything else (§12.1).

The rules carried from tickets are:
- **When checks run.** At §9.2 step 2, the recipient provider only verifies the link itself, without spending anything. At step 7 it checks that the parent is unconditional, live and not exhausted, and that its configuration admits the kind. The use is spent, and `principal` compared with the **verified** leg-certificate principal, atomically at step 8. So forged or failing invites never spend uses.
- **Dead parents.** A parent at zero uses, revoked or expired admits nothing, silently.
- **GET.** A GET of the link never admits, spends or creates anything.

**Callback.** In this revision an invite carries no callback: `callback_digest` MUST be `null` (§7.2). Callbacks are defined, for later, in §20.3.2.

A link is a bearer capability, and its URL is subject to the [contact endpoint](contact-tokens.md#url-secrecy-and-browser-handling) secrecy rules. Shown as a QR code, it proves nothing about proximity. QR display and any other presentation are app-level.

### 5.4 Routing to the handler

An invite names an entity, never an app. The recipient provider chooses the endpoints by the owner's **intent handler choice** for the invite's kind line (AMD-SG-I1, §20.1.5).

**Status.** Intents routing is the leading candidate for establishment mode (a) (§5.6). It is provisional, and not final until the establishment spike reports (§19.4).

An endpoint is **eligible** when all of these hold:
- it is registered for the kind;
- its app (or feature) is an approved handler of the kind, at a version that admits the invite's version (§15);
- its connection or enablement is live;
- it is not the initiator's own endpoint.

The **routing set** is:

1. **Own entity, with `target`.** That one endpoint. It must be eligible, and it must belong to the same app as the initiating endpoint (the same `client_id`, or the same provider feature). `open` refuses any other `target` with `invalid_args`.
2. **Own entity, without `target`.** The eligible endpoints of the initiator's own app (the leg certificate's `client`, which this same provider certified), if that app is an approved handler. Otherwise, the routing handler's eligible endpoints.
3. **Another entity.** The eligible endpoints of the owner's **routing handler** for the kind line, and of no other app. The routing handler is the owner's explicit default for the kind line. If there is none, it is the single approved handler, when there is exactly one (§20.1.5).

**Handoff target.** Each case also fixes the one app that a handoff (§11.4) opens, whether or not it has an eligible endpoint now:
- case 1: the initiating app;
- case 2: the initiating app if it is an approved handler, otherwise the routing handler;
- case 3: the routing handler.

If that rule gives no app (case 2 or 3 with no routing handler), the handoff opens the chooser (§20.1.5).

The provider delivers an admitted, not held, invite to at most 16 endpoints of the routing set, most recently active first. If the routing set is empty, nothing is delivered to endpoints. That happens when the handoff target has no eligible endpoint, or when there is no handoff target. The invite stays pending until `answer_by`, and the provider records a "no handler" activity item that offers the handoff to the handoff target (§11.3, §11.4).

A pending invite is also delivered to an eligible endpoint of the routing set that registers or starts `listen` before `answer_by` (late delivery). This is how a handoff to a closed app reaches the invite.

Consequences, by construction:
- **No cross-app visibility.** One owner-chosen app sees an entity's incoming invites of a kind, so the cross-application visibility of AMD-RW1 does not arise.
- **No preference for asserted clients.** A foreign initiator's asserted `client_id` and `origin` never influence routing (RTCw-R3, I2).

### 5.5 Acceptance

- A session connects only through a claim with outcome `accept` by one recipient endpoint (§8.2). A recipient provider MUST NOT claim on its own.
- **Cross-entity sessions.** The claim MUST result from a user action at the recipient device, except in two cases:
  - the glare rule of §8.3;
  - **standing acceptance.** The owner MAY set standing acceptance on a session handler approval, per (handler, kind) (§20.1.4). It is off by default, and it is allowed only for kinds whose `parties` is `other` or `any`. With it, that handler's endpoints MAY accept admitted, not held, cross-entity invites of that kind without a user action at the device. For a provider feature, the enabled feature's own declared policy decides which of those invites it accepts (§4.2).

  Standing acceptance is how provider-feature endpoints, hosted service entities, headless app servers and conferencing services answer. It changes no admission rule: held invites are never delivered, so they are never accepted, and the routing set is unchanged.

  **Disclosure.** The page that sets standing acceptance MUST tell the owner, before the control is armed, that an automatic answer reveals to any initiator who can reach the entity with that kind (any admitted initiator) that the entity has a live endpoint of that handler. That is, it makes the entity's availability visible to them, which §12.1 otherwise hides. It also names what can admit such initiators: the owner's links configured for that kind. Requests (`none`) are held and never accepted.
- **Own-entity sessions.** The claim MAY be automatic (**auto-connect**) only when all of these hold:
  - the kind's `parties` is `self`;
  - the owner enabled auto-connect for that app and kind (an owner setting on the approval, §20.1.4; default off);
  - the initiator leg certificate's `client.client_id` equals the claiming endpoint's app.

  The provider computes `auto_connect` and `standing_accept` per endpoint in the invite projection (§10.3). It cannot verify a user action at `claim`, so it enforces nothing more there. Which app identities count as "the same app" across a vendor's native and web clients is an open question (§19.4, I3).
- **Decline.** A decline reveals that a recipient device saw the invite. An endpoint MUST NOT decline without a user action or an owner setting. An **owner** who dismisses or declines a pending invite through the provider's interface (for example from the owner hook, §11.3) ends it **silently** (§8.5): nothing is sent to the initiator.

### 5.6 Establishment modes (spike needed)

The owner expects two distinct ways that sessions get established. This revision describes both, but specifies only the first in detail. The second is a separate establishment path, to be shaped by a spike (§19.4, S1 and S2).

**(a) Invite-style.** A user-facing request that an app surfaces, for example through a notification or a message. One party asks; a person on the other side decides. This is what §5.2 to §5.5 specify: admission, routing to one owner-chosen handler, then a claim by user action. Intents routing (§5.4, §20.1) is the **leading candidate** for choosing which app receives such a request. It is not adopted as final.

**(b) Always-on (autonomous).** Endpoints of the same owner, or of pre-authorised peers, wire up automatically when an app opens, with no person deciding each time. Example: a fleet of agent daemons on several machines, sharing a remote-control interface on the owner's phone. No intents choice is involved: the pairing is authorised in advance, and each session just re-establishes it.

What rev 1 already offers toward mode (b):
- own-entity sessions with `target`, and auto-connect for `self` kinds, within one `client_id` (§5.4, §5.5);
- standing acceptance for cross-entity kinds (§5.5);
- a principal-bound configured contact link as a pre-authorised peer's admission (§5.3);
- the separate own-device and principal-bound limit windows (§13.1).

What it does not yet settle, and the spike must:
- whether mode (b) needs its own authorization record, for example a pairing per (peer principal or own app set, kind) with acceptance scoped to that peer, instead of standing acceptance open to any admitted initiator;
- how an opening app finds the endpoints it may wire up to, across different `client_id`s of one vendor (the daemon and the phone interface), without exposing endpoint inventory to other entities (§12.2) and in light of I3 (§19.4);
- whether routing in mode (b) bypasses intents entirely and names the paired app directly;
- reconnection under the 24 h session cap, the `answer_by` window and the own-device window;
- what the owner sees and revokes (the paired apps, peers and devices) in generic surfaces (§14.1).

Until the spike reports, an implementation MUST NOT add a mode (b) path beyond the rev 1 mechanisms listed above.

## 6. Keys and certificates

### 6.1 Leg keys and leg certificates

For each leg, the endpoint generates a fresh ES256 key pair:
- it SHOULD be non-extractable;
- it MUST NOT be reused across sessions, so that no peer can link an endpoint across sessions.

The entity's provider certifies the public key in a leg certificate: a compact JWS under the [links §3.1](links.md#31-jws-profile-shared-with-bindle_data) profile. Its protected header is exactly `{alg:"ES256", kid:<an active certification kid of the entity>, typ:"bindle-signaling-leg+jwt"}`. Its payload is exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"signaling-leg-certificate"`, `1` |
| `iss`, `sub`, `identity` | The leg's entity at its current issuer, and its identity URI. |
| `aud` | The peer entity's identity URI. It equals `identity` for own-entity sessions. |
| `sid` | The session (§7.1). |
| `role` | `"initiator"` or `"recipient"`. |
| `kind` | `{artefact, version, digest}`: the session kind. |
| `profile` | The profile id. |
| `client` | `{client_id, origin, feature}`, as verified by the provider. `feature` is `null` for an app, and the declaration `ref` for a provider feature (§4.2). |
| `cnf`, `delegate` | `{jkt}` and the public JWK, as in [organizations §5.2](organizations.md#52-member-authentication-certificates-and-signed-requests). |
| `aep` | The entity's authority epoch. |
| `jti`, `iat`, `exp` | `exp − iat` is at most the declared `max_leg_certificate_seconds`. `exp` is no later than the session's maximum lifetime (§8.1). For a pending initiator leg, it is no later than `answer_by` plus the declared bound. |

**Issuance rules.** The provider:
- signs only with an `active` certification key (`use: "cert"`), never with the identity signing key;
- signs only after the §5.1 checks (initiator), or after a successful claim (recipient);
- issues only to the endpoint's own connection;
- refuses a `delegate` already certified in any live session of the entity, or within the last 24 h.

An endpoint renews its certificate before expiry (§10.2). The renewed certificate has the same `sid`, `role`, `kind`, `profile` and `cnf`.

**Verification.** Verifiers check:
- the profile, `typ`, exact members, `aud`, `sid`, and `exp` with 60 s skew;
- the signature, against the issuer's `active` certification keys. A certificate signed by an identity signing key, or by a `sig` or `enc` key, fails.
- the `identity` member, which is only a claim. A verifier obtains the identity URI only from the issuer's directory `?sub=` lookup, from its own pin, or from an adopted move record. It checks that the URI equals `identity`, and applies the [organizations §3a.4](organizations.md#3a-identity-documents-and-key-discovery-directoryv1) no-rollback rule.

A foreign peer's certificates are checked against its issuer's declared `max_leg_certificate_seconds`, as held. Without a held value, the maximum is 900 s (RTCe-11).

### 6.2 Control statements

A provider sometimes ends a leg or session on its own: on revocation, expiry or a move. It does so with a control statement:
- protected header exactly `{alg:"ES256", kid:<active certification kid>, typ:"bindle-signaling-control+jwt"}`;
- payload exactly `{bindle:"signaling-control", v:1, iss, sub, aud, sid, leg, type:"end", reason, iat, jti}`;
- `leg` is the affected leg's `jkt`, or `null` for the whole session;
- `reason` is one of `expired`, `revoked`, `moved` or `failed`.

A control statement can only end things. After a verified control statement, nothing from the ended leg or session is accepted again.

**Silence before a claim.** A provider MUST NOT send a control statement for a recipient session that no endpoint has claimed (§8.5).

### 6.3 Signature and key rules (AMD-RV1, carried)

- Every signaling JWS (certificate, control statement, message) MUST carry a **low-S** ES256 signature (`s` at most `n/2`). Verifiers refuse high-S signatures, so a relaying party cannot mint a second compact form.
- A certification key verifies only with `use: "cert"` and `state: "active"`.
- A verifier accepts a control statement only from the session party it expects (`iss` and `sub`, besides `aud` and `sid`), never from whichever entity signed it.
- **Pinned keys.** Session records pin the peer's certification keys that verified its leg: at most 8, taken at `open`, at admission, and on every verified message. A control statement that does not verify under the held keys MAY verify under the pinned ones. A control can only end that one session with that party, so a retired key can at worst end sessions early (RTCd-23).
- The `typ` values separate these profiles from every other certificate and statement profile. AMD-SG-K1 (§20.4) registers them.

## 7. Messages

### 7.1 Envelope

A message is a compact JWS under the links §3.1 profile, at most 40,960 bytes. Its protected header is exactly `{alg:"ES256", typ:"bindle-signaling-message+jwt", kid:<the leg's jkt>}`. Its payload is exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"signaling-message"`, `1` |
| `iss`, `sub` | The sending entity at its current issuer. |
| `aud` | The receiving entity's identity URI. |
| `sid` | 22 to 43 base64url characters encoding at least 128 random bits, chosen by the initiator provider. |
| `leg` | The sender's leg `jkt`. It MUST equal the certificate's `cnf.jkt`. |
| `to` | The receiving leg's `jkt`. It is `null` only for `invite` and `cancel`. |
| `seq` | An integer from 0 to 4,095. Per (`sid`, `leg`), it starts at 0 and increases by exactly 1 per message. |
| `iat` | Unix seconds. |
| `type`, `body` | §7.2. |

### 7.2 Types

**Generic types (every profile):**

| `type` | Sender | `body` (exactly) |
| --- | --- | --- |
| `invite` | initiator | `kind` (`{artefact, version, digest}`); `profile`; `answer_by` (Unix seconds, after `iat` and at most `iat` + 120); `basis` (§5.2); `context` (`null`, or an object valid against the kind's `data` schema at that version); `params` (the profile's invite parameters, §3.5, §16.3); `callback_digest` (MUST be `null` in this revision; reserved for callbacks, §20.3.2). |
| `cancel` | initiator | `{}`. Ends an unclaimed session. |
| `accept` | recipient | `params`: the profile's accept parameters. |
| `decline` | recipient | `reason`: `declined` or `unsupported`. |
| `end` | either | `reason`: `closed`, `failed` or `timeout`. |

**Profile types.** `webrtc` adds `sdp` and `candidates` (§16.3). `data` adds `data` (§3.5): sent by either claimed leg, only after the claim, with `body` exactly `{payload}`.

**Rules:**
- Unknown types or members are invalid. A profile type in a session of another profile is invalid.
- `invite` is the initiator's `seq` 0. `accept` or `decline` is the recipient's `seq` 0.
- Only the initiator leg may send `invite` and `cancel`. Only the claiming recipient leg may send `accept` or `decline`, and only after its claim succeeded.
- **Before the claim**, the initiator leg sends nothing but `invite` and `cancel`. The recipient provider drops any other pre-claim message from the initiator leg at §9.2 step 7, after step 5 has consumed its `seq` (RTCw-L4).
- **`data`.** `data` exists only in `data` sessions, and travels only between the two claimed legs. Providers never inspect its payload. They enforce its per-message and per-leg caps (§3.5) and the aggregate budget (§13.1).
- **Context.** `context` has at most 8 properties and 2,048 serialized bytes (AMD-SG-I1 constrains session kinds so). No property may have `format: contact-link`. An endpoint MUST NOT put a network address of its device (an IP address, a hostname that resolves to it, an mDNS name or an ICE candidate) in `context`, or in any other pre-claim field. Providers validate `context` only against the kind's schema and cannot detect an address in it, so they cannot enforce this rule (§12.3).

### 7.3 Ordering, replay and expiry

- **Order.** A receiver (provider or endpoint) processes each leg's messages in `seq` order. It buffers at most 32 messages ahead of a gap, for at most 10 s, and then ends the leg with `failed`. This end is silent if the session is unclaimed (§8.5).
- **Duplicates.** A duplicate of an accepted (`sid`, `leg`, `seq`) is ignored. Two copies have "the same content" only when their payload bytes (the received second JWS segment) are identical. Reusing a `seq` with different content ends the leg with `failed`. Replay state compares payload bytes, never signatures. It keeps only a SHA-256 hash of each accepted payload segment, never the payload, so replay state outlives no message content (§1.2 item 3).
- **`iat` window.** `iat` MUST be at most 120 s in the past and 30 s in the future at receipt.
- **Replay state** is kept per session until its end plus 300 s. A message for an ended session or leg is ignored.
- **`to`.** A receiving provider drops, at step 7, a message whose `to` names neither its own side's leg nor `null` for `invite` or `cancel`. Its `seq` is consumed, as for other step-7 drops (AMD-RI3).

## 8. Session model

### 8.1 States and lifetimes

Each provider keeps its own record of a session, with states `pending` → `connected` → `ended`. A session goes from `pending` straight to `ended` on:
- a cancel or decline;
- `answer_by` passing;
- a control statement;
- an owner end.

A session's maximum lifetime is 24 h from the invite. After it, providers end the session (`expired`) and accept nothing further. A provider does not stop a connection that the endpoints already established (§17). A longer use opens a new session.

### 8.2 First claim

A recipient endpoint answers with the contract's `claim` (§10.2). Only an endpoint the invite was delivered to may claim.

**At the recipient provider:**
- It decides the first claim atomically, per session, at a single authority for the recipient entity.
- The winner receives its leg certificate. Every other claim fails with `claimed`.
- It tells the other endpoints that were delivered the invite that the session was claimed, without saying by which endpoint or with which outcome.
- A decline claim ends the session for every recipient endpoint.
- Only the winning leg's messages ever reach the initiator.
- A repeat claim by the winner is allowed only while the claim is usable: an accepted session that is still live, or a decline whose message has not been sent (RTCd-rev).

**At the initiator provider.** It accepts only the first `accept` or `decline` for a session. Any later recipient leg is sent a control statement `end` with `failed`, at most once per (session, leg) and at most four times per session.

**Colliding `sid`s.** The recipient provider MUST NOT deliver to an endpoint an invite whose `sid` equals that of another live session already delivered to that endpoint. Such an invite is dropped silently (RTCw-L1).

### 8.3 Glare

An endpoint may have an unclaimed outgoing session to an entity for a kind line, and receive an invite from that entity for the same kind line. It then compares the two `sid` values as byte strings, after base64url decoding:
- The session with the lower `sid` survives.
- The endpoint whose outgoing session has the higher `sid` cancels it.
- It MAY claim the surviving invite with `accept` without a further user action, because its user just asked to connect with that entity for that kind. It does so only when the surviving invite is within what its own cancelled outgoing invite asked for: the same kind line, the same profile, and invite `params` that the profile deems within its own outgoing `params`. For both registered profiles that comparison is trivial: `data` params are `{}`, and `webrtc` params carry no bound (§16.3). Otherwise the endpoint treats the surviving invite as an ordinary one and needs a user action (or standing acceptance).

### 8.4 End

- Either leg ends a connected session with `end`. The initiator ends an unclaimed one with `cancel`.
- On receiving `end`, `cancel` or a control statement, an endpoint MUST close whatever transport the profile set up for that session.
- **A `cancel` that crosses a claim.** A `cancel` that reaches the recipient provider after a successful claim is processed as `end` with `closed`.
- **An `accept` that crosses a cancel.** An `accept` that reaches the initiator provider after the initiator's `cancel` is answered with a control statement `end` (`failed`) for that recipient leg.
- Both sides converge to `ended`.

### 8.5 Silent ends

A recipient session that no endpoint has claimed (pending, held or not) ends **silently**: no message and no control statement go to the initiator's provider, whatever the cause. The causes include:
- an owner dismissal or decline (§5.5);
- an app's approval or grant being narrowed or revoked (§14.2);
- a block;
- a §7.3 failure on the initiator leg (a reused `seq` with different bytes, a buffer overflow, a gap timeout);
- an event-queue overflow;
- account deletion.

The owner's own endpoints that received the invite get a `state: ended` event. The initiator's session ends at `answer_by`. In an own-entity session, the owner's own initiating device is also told `ended`, because it is not another entity.

Claimed sessions end with `end` or a control statement as usual.

### 8.6 Multi-party

Multi-party sessions are a non-goal:
- A mesh is a set of independent two-party sessions.
- A conferencing service is a peer entity reached with ordinary sessions.
- A later version MAY add an explicit group correlation member. The exact-member rules reject one in this version.

## 9. Transport between providers

### 9.1 Endpoint and batch

**Where batches go.** A provider sends messages and control statements for a session only to the `endpoint` of `signaling.v1` in the validated manifest of the peer entity's **current** issuer, found through the successor index for a moved identity. It MUST NOT send to any other URL, including one received in a response, a link or a message. Delivery follows the protocol §2 fetch rules: HTTPS, no redirects, bounded size and time, and screening of private, loopback and link-local targets.

**The request** is a `POST` with `Content-Type: application/vnd.bindle.signaling+json` (a project-private proposed media type) and a body of at most 131,072 bytes:

```json
{"v": 1, "certificates": ["<leg certificate>"], "messages": ["<message>"], "controls": ["<control statement>"], "links": ["<canonical link>"]}
```

**Batch rules:**
- `certificates` (at most 4), `messages` (at most 32) and `controls` (at most 4) may each be empty, but not all three.
- `links` (at most 4, each at most 8,192 characters) carries only the basis links whose digests appear in invites in the same batch.
- Every element of a batch names the same `aud` (AMD-RI2).
- A leg's certificate accompanies its first message to each receiver, and every renewal.

### 9.2 Verification

The receiving provider MUST perform these steps in order:

1. **Shape (no fetch).**
   - Check the batch shape and bounds. For each JWS, check the links §3.1 rules, `typ`, `bindle`, `v`, exact members, low-S, and the `iat` window.
   - Check that `aud` is an absolute HTTPS URL on this provider's issuer origin, with no userinfo, query or fragment, and that every element names the same `aud`.
   - At the public endpoint, refuse any element whose `iss` is this provider's own issuer. Sessions between two entities this provider hosts travel only through the internal path, where the sender's provider applies §7 and §16 first (AMD-RW2).
   - A batch in which any element fails this step is refused as a whole.
2. **Session lookup (no fetch).** Find the session by (**initiator** origin principal, `sid`). The initiator principal is the sender for `role: initiator`, and the entity named by `aud` for `role: recipient`, each mapped through the successor index.
   - **Invite.** The session must not exist yet (a retried copy is ignored at step 5). For a `link` basis, the provider verifies only the link itself, locally, as its owner host: canonical form, digest equal to `link_digest`, and links §8 steps 1 and 2 (§5.2). This reads only its own link records, fetches nothing and spends nothing. It exists so that step 3 can choose a refresh lane. The parent's configuration, liveness and uses are evaluated at step 7, and a use is spent only at step 8 (§5.3).
   - **First answer.** For a recipient leg's `seq` 0 `accept` or `decline` with `to` equal to the initiator leg, the session must exist with no recipient leg recorded. The first one verified at step 4 becomes the recipient leg.
   - **Other messages.** The sender's `leg` must be the session's initiator leg, or its recorded recipient leg.
3. **Certificate.** Verify the leg certificate (§6.1) against the sender's `active` certification keys **as already held**, or as pinned on the session (§6.3).
   - The receiver keeps current, by background refresh, the keys of the entities its hosted entities admit, of the peers of their sessions within the last 24 h, and of the recipients of its own entities' open sessions (§5.1).
   - If the key is not held, the message is not processed and a refresh is scheduled.
   - Refresh scheduling is bounded (a bounded queue, per-issuer and global fetch budgets before any fetch, the manifest floor and a valid `signaling.v1` before identity documents are fetched, negative caching) and never runs on the request path.
   - A receiver MAY order its refresh queue in lanes: first peers with a live or pending session, then invites whose link basis verified at step 2 without spending, then everything else, capped per source network (AMD-RV2). The response and its timing still never depend on steps 2 to 8.
   - **One exception:** for an invite whose link basis verified at step 2, the receiver MAY fetch the sender's identity document during processing, under the same budgets.
4. **Signature.** Verify the message signature under the certificate's `delegate`. Check that the certificate's `sid`, `aud`, `role`, and for an invite `kind` and `profile`, match.
5. **Order and replay.** Apply §7.3. A (`sid`, `leg`, `seq`) is recorded only after step 4.
6. **Authority epoch.** Refuse an `aep` lower than the highest recorded for that sender, and record a higher one. Epochs are recorded only for admitted traffic, and dropped with the state they belong to.
7. **Policy, cheapest first.** The recipient provider MUST evaluate the checks that read only its own records before any check that consults another component or a host-wide service (RTCw-M5). The local checks are, in order:
   - closed account;
   - duplicate;
   - block (§13.2);
   - basis configuration (an unconditional parent, configured for the kind) and parent liveness and uses;
   - `sid` collision (§8.2);
   - pending and connected capacity;
   - per-recipient limits (§13.1).

   Only an invite that passes them reaches the host-wide limiter, handler eligibility (§5.4), context validation against the pinned kind version, and the profile rules (§16).
   - **Unheld kind version.** If the provider does not hold the invite's kind version (§3.4), nothing is delivered and the session silently stays unanswered.
   - **`data` budget.** A `data` message over the recipient entity's aggregate budget (§13.1) ends the leg with `failed`, silently if the session is unclaimed.
   - **Other drops.** The pre-claim and `to` drops of §7.2 and §7.3 happen here.
8. **Apply, atomically.**
   - Re-run the local checks without counting.
   - For a link basis, spend a use and compare `principal` with the verified certificate principal (§5.3).
   - Create or update the session.
   - Deliver to the routing set (§5.4), to the claimed endpoint, or hold.

**Response:**
- `202` with an empty body for every batch that passes step 1, whatever steps 2 to 8 decide. Processing after step 1 MAY be asynchronous, and runs as of the batch's receipt time.
- `400` for a batch that fails step 1.
- **Unknown `aud`.** A batch whose `aud` names no active entity hosted here answers the provider's uniform `404`, the same response as any unknown or inactive identity URL on this origin (AMD-RI1). That fact is already public through the identity document.
- **Per-entity enablement.** Whether the addressed entity has enabled signaling, or is in a rollout cohort, MUST NOT change the response, its timing class or the queue behaviour. Such a batch is checked at step 1, takes queue capacity like any other, and is then dropped unprocessed (RTCw-R1).
  - **Residual: drain rate.** A dark batch is dropped faster than a processed one is verified. An observer who fills an entity's inbound queue and watches when `503` starts and stops can, in principle, estimate the drain rate and so infer enablement. A provider SHOULD pace dark drops at about the processing rate, or account the drop at the processing cost, before releasing queue capacity. This residual is recorded, not closed, in this revision.
- **Load.** A provider MAY shed load by source network before step 1 (`429`). It MAY answer `503` when its inbound capacity for the entity is full; that fill depends on volume, never on steps 2 to 8. It MUST NOT shed by the sender's claimed issuer or principal before verification.

**Control statements** are verified by steps 1, 2 (the session and, if not `null`, the leg must exist), 3 (the signing key is an `active` or pinned certification key of the session party that sent it) and 5 (by `jti`), and are then applied.

### 9.3 Delivery, retries and latency

- **At-least-once delivery.** A sender retries on network errors, `429` and `5xx`, with backoff, until the item's useful life ends:
  - for `invite`, `answer_by`;
  - for a control statement, the latest `exp` of the affected leg certificates;
  - otherwise, 30 s.

  Any other answer, including `404` and redirects, is permanent. Retried JWS values are sent unchanged.
- **Invite re-send.** Because a held-key miss drops an invite after a `202`, an initiator provider MAY re-send an unanswered invite to a foreign recipient. It does so only after the first `202`, at most twice, and never after a permanent refusal (AMD-RV2). The recipient provider ignores copies of an existing session.
- **Controls.** Control-only batches are narrowing. A provider's kill switch for new cross-provider sessions MUST NOT stop them.
- **Latency targets.** A provider SHOULD forward a message within 250 ms of accepting it from its endpoint. It SHOULD make a received message available to the target endpoint within 250 ms of step 8.
- **Request isolation.** Delivery never runs inside the sending request, and the receiver never runs steps 2 to 8 inside the request that carried the batch. So neither side's latency depends on the other's state.

### 9.4 Same-provider sessions

Sessions between two entities on one provider run the full §9.2 path on the receiving entity's authority, through an internal transport. They have the same asynchrony, silence and limits. The public endpoint is never used for them (AMD-RW2).

## 10. The signaling contract

### 10.1 Endpoint binding

`https://spec.bindle.example/contracts/signaling/v1` is invoked by ordinary RPC ([protocol §5](protocol.md)) on the occupant the consumer was granted, with `x-bindle-brokerable: false`. All arguments reject unknown members.

**Live checks.** Every method checks the slot grant (or feature enablement) live. Every widening method also checks the handler approval for the kind live. The widening methods are:
- `open`, `register` and `renew`;
- `claim` with outcome `accept`. A `decline` claim is narrowing and is not gated by the approval;
- `send`, unless every message is `end`, `cancel` or `decline` (RTCw-M4);
- relay credentials (§16.7);
- `mint_link`, when it exists (AMD-SG-L1b, §20.3.2). For it, the check covers every kind the minted configuration would name.

**Endpoint identifiers.** An endpoint identifier alone never authorizes:
- When the RPC token is DPoP-bound, `register` binds the endpoint to that key's `jkt`, and every later call naming the endpoint MUST use the same key.
- Otherwise `register` also returns `endpoint_secret` (at least 128 random bits). Every later call naming the endpoint carries it as the `endpoint_secret` argument, and the provider stores only its hash.
- A DPoP-registered endpoint refuses the `endpoint_secret` argument.

### 10.2 Methods

| Method | Effect | Arguments → result |
| --- | --- | --- |
| `register` | write | `{kinds, label?, push?}` → `{endpoint, endpoint_secret?, expires_at}`. Registers this device instance for the listed kinds; each kind MUST be one the app is approved for. `label` is at most 64 characters of plain text, shown only to the owner. `push` is optional (§11.2). An endpoint lives at most 30 days after its last `listen`. A provider SHOULD bound live endpoints per app within the entity's bound (reference host: 8 of 32). |
| `unregister` | write | `{endpoint}` → `{}`. Ends its legs (§14.2). |
| `endpoints` | read | `{}` → `{endpoints: [{endpoint, label, kinds, last_seen}]}`: this app's endpoints for the owner's own entity only. |
| `open` | write | `{endpoint, to, kind, profile, params, delegate, basis?, target?}` → `{sid, certificate, expires_at, peer_keys}`. `kind` is the line URL, and the provider pins the version the app was approved for. `to` is a principal, a handle (§5.1) or omitted with `basis`. `target` is one of the owner's own eligible endpoints of the same app (§5.4), and is allowed only when `to` is the owner. `basis` is the contact link to present. `peer_keys` are the recipient's active certification keys as held. `approval_required` (with a provider page URL) means the app is not an approved handler of the kind (§20.1.4). There is no `callback` argument in this revision (§20.3.2). |
| `claim` | write | `{endpoint, sid, outcome, delegate}` → `{certificate, peer_keys}`, or the error `claimed`. `outcome` is `accept` or `decline`. Only an endpoint the invite was delivered to may claim. An `accept` claim checks the handler approval live (§10.1). |
| `send` | write | `{endpoint, sid, messages}` → `{accepted}`, with at most 32 JWS messages, all from this endpoint's leg in this session. The provider applies §7 and the profile's rules, including the owner's IP policy, to its own endpoint's messages before relaying, and refuses violations with `invalid_args`. It does not buffer out-of-order messages from its own endpoint. A full outbox refuses with `rate_limited`, and nothing is accepted. |
| `renew` | write | `{endpoint, sid}` → `{certificate}`. |
| `listen` | read | `{endpoint, cursor?, wait?}` → `{cursor, events, gap}`. A long poll, with `wait` at most 25 s (§10.3). |

`mint_link` is **unavailable** in this revision. It is defined, for later, in AMD-SG-L1b (§20.3.2), and a provider MUST NOT offer it before the links §6 re-scope lands. There is no interim ticket type.

**Errors** follow protocol §5. `claimed` and `unsupported_peer` are the method-specific errors that depend on state, and they are returned only to the owner's own endpoints. Both are raised before any session state is written, or after state that is terminal, so a runtime keeps them as no-effect outcomes (RTCi-5). A runtime MAY answer `indeterminate` for a write whose outcome it cannot classify.

**Retention.** Write results that carry a leg certificate or a link are never retained in an RPC journal. A retried `tx` answers `indeterminate`.

### 10.3 `listen` events (AMD-RI4, generalized)

Every event has `type` (`invite`, `message` or `state`), `sid` and `seq`.

- **`invite`** adds:
  - `invite`: the raw invite;
  - `certificate`;
  - `projection`, with these members:
    - `initiator` `{iss, sub}`;
    - `handle`: present only when the provider holds a verified directory binding;
    - `origin`, `client_id` and `feature` from the initiator's certificate;
    - `reported_by`: the initiator's issuer origin for a foreign initiator, else `null`;
    - `kind` `{artefact, version, digest}` and `profile`;
    - `params`: the projected profile parameters;
    - `context`: projected to the version this app approved;
    - `basis`: `self`, `link` or `request`;
    - `auto_connect`: boolean (§5.5);
    - `standing_accept`: boolean, true only for a cross-entity invite routed to a handler whose approval has standing acceptance for the kind (§5.5).

  The basis link is never in an `invite` event.
- **`message`** adds `message` and, with the first message of a leg, `certificate`.
- **`state`** adds `state` (`claimed`, `expired` or `ended`) and, when there is one, `control`.

A queue that overflowed reports `gap: true`. The affected sessions end `failed`, silently if they are unclaimed (§8.5). Reference bounds: 256 events or 512 KiB per endpoint.

## 11. Delivery, presentation and handoff

### 11.1 Long poll (required)

`listen` is the baseline that every occupant implements. A doorbell is never needed for correctness and carries no session content. The endpoint always fetches content with `listen`.

### 11.2 Doorbells (optional)

- **Web Push.** `push` is a [Web Push](https://www.rfc-editor.org/rfc/rfc8030.html) subscription `{endpoint, keys: {p256dh, auth}}`.
  - The push endpoint URL is an outbound fetch target. It MUST be HTTPS and pass the protocol §2 SSRF screening. A provider SHOULD accept, at `register`, only origins it recognizes as Web Push services.
  - The provider sends at most one push per delivered invite per endpoint, encrypted under [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html), with `Urgency: high` and a TTL no longer than the time left to `answer_by`.
  - The payload is exactly `{"t":"signal","endpoint":"<endpoint>"}`: no initiator, kind or session.
  - Pushes count against the recipient's invite limits (§13.1). Held invites are never delivered to endpoints, so they never push.
  - A subscription reported gone is removed.
- **Integration doorbell.** A confidential integration's server MAY receive the SET event `…/events/signaling-doorbell/v1` (payload exactly `{endpoint}`) on its existing events channel ([integrations §6](integrations.md#6-events)), so that it can wake its native app. AMD-SG-E1 registers it.

How an app presents an invite once woken, whether it rings and what it shows, is the app's concern.

### 11.3 The owner hook: the provider's only presentation duty

The provider presents nothing about invites: no ring, alert, notification, push to the owner, activity item or call list. How a request to connect is surfaced to a person is the app's concern (§1.1, §11.2). In particular, a call invite in a messaging app is a message with a JSON media type, specified by the messaging/BindleBox spec, not by this document.

What remains is a minimal **owner hook**, for the invites that no app can see:
- **Which invites.** An admitted, pending invite that is **held** (admitted through `none` or a quarantined contact parent, §13.3), or that has an **empty routing set** (§5.4). Blocked invites never enter it.
- **What it holds.** Only the verified initiator principal (with a handle only under a verified binding), the initiator's app origin labelled "reported by" its issuer for a foreign initiator (RTC-17, RTCe-22), the kind line, the basis kind, the handoff target if any (§5.4), and the time. No `context`, link, `params` or payload.
- **Who reads it.** Only the owner, through the provider's owner interface. It is not an activity item, never interrupts, never notifies and never pushes. Whether and how a provider shows it is provider interface, outside this specification.
- **Lifetime.** An entry lasts until `answer_by`, and is deleted when the invite is claimed or ends. It is not history.
- **Bounds.** Entries count against a per-entity bound. They fold per (initiator origin principal, kind line) for initiators on this provider, and per (initiator issuer, kind line) for foreign initiators, because a foreign issuer can mint principals at will (RTCw-L2, AMD-RW4). Folding keeps one initiator, or one foreign issuer, from evicting the others.
- **Actions,** all through the owner interface:
  - **Hand off:** §11.4. This is offered only for an entry with an empty routing set. A held invite is never handed off or admitted retroactively.
  - **Dismiss:** a silent end (§8.5).
  - **Block** (§13.2).
  - **Allow later,** for a held entry: an explicit configuration change that applies only to later invites.

There is no signaling mute and no interruption policy. A provider that also wants to mirror hook entries into [activity](activity.md) needs a separate amendment first (§20.2).

### 11.4 Handoff to the chosen app

"Hand off" is an intents handoff (AMD-SG-I1, §20.1.7). It applies to establishment mode (a) (§5.6):
- The provider navigates top-level to the handoff target's declared `route` for the kind (§5.4). With no handoff target, it first shows the intents chooser (§20.1.5).
- **Chooser label.** A chooser opened from a hook entry MUST say that it was triggered by an incoming request from another party, whose kind and context the initiator chose and the provider has not verified, beyond the initiator's identity. It preselects nothing (beyond intents §7.3), and choosing records an ordinary approval with every §20.1.4 disclosure.
- The navigation carries a provider-constructed intent of the session kind, whose `data` is the context projected to the handler's approved version, plus a `bsession` hint naming the `sid`.
- The app registers or listens and receives the pending invite by late delivery (§5.4).
- The hint is untrusted. The app claims only after a user action in its own interface, unless auto-connect or standing acceptance applies (§5.5).

## 12. Privacy

### 12.1 No presence oracle

Nothing an initiator or its provider observes may depend on any of the following, except a claim the recipient made (including an automatic one under auto-connect or standing acceptance, which the owner was told reveals availability, §5.5):
- whether the recipient has endpoints, or is online;
- whether it admitted the basis, blocked the initiator, or quarantined the link;
- whether it has an approved or routing handler;
- whether it enabled signaling.

In particular:
- the §9.2 response, its timing and its queue behaviour are uniform;
- `open` succeeds alike for any active entity, whose certification keys are served whether or not it ever registered (RTCd-11);
- there is no ringing or busy indication;
- unanswered and owner-dismissed invites end silently (§8.5);
- a recipient provider MUST NOT send a message the initiator could use to learn any of these.

### 12.2 Device inventory

Endpoints, their count, labels and last-seen times are never disclosed to another entity. Leg keys are per session. The recipient's claimed leg reveals only that one device answered.

### 12.3 Address disclosure

- **Before the claim.** No profile parameter carries an address: providers enforce that for the `webrtc` offer (§16.4). A conforming endpoint also puts no address in `context` (§7.2). Providers cannot enforce the `context` rule, because they validate `context` only against an app-chosen schema. So "no address before the claim" is a provider guarantee for profile parameters and an endpoint obligation for `context`, not a provider guarantee overall.
- **After the claim.** `webrtc` candidates go only to the claimed peer leg, under the IP policy. **IP policy governs only `webrtc` profile messages.**
- **`data`.** `data` exists only in `data` sessions, is opaque and is not inspected. An app that deliberately moves addresses through `data` after a claim is beyond provider enforcement, as it already is through its own servers.

Provider enforcement protects against default ICE leaks, not against an app that chooses to disclose addresses.

### 12.4 Minimal metadata and retention

- **Session records.** Providers keep, per session, only what routing, ordering, replay protection and limits need, and delete session records no later than 24 h after the session ends.
- **No logging of payloads.** Providers MUST NOT log SDP, candidates, addresses taken from candidates, `data`, `context` values, `ice_servers` credentials or links.
- **Payload deletion.** Payloads are deleted once delivered, or after 60 s. `context` is deleted at claim or end.
- **Limit state** is keyed so that it reveals no more than the limit needs: hashed keys, with no principal named in the record. It expires with its window.
- **Owner-hook entries** (§11.3) are deleted when the invite is claimed or ends, and by `answer_by` at the latest.
- **Replay state** holds payload hashes, never payloads (§7.3).

### 12.5 Third parties

Doorbell payloads carry no session content. Kind and identity documents are never fetched on a request path from another provider.

### 12.6 Export and deletion

**Export** includes, as owner data:
- the IP policy and request settings;
- principal blocks and provider blocks;
- signaling configurations on contact parents (`revision`, kinds with pinned versions, uses left, principal, `minted_by`; never the link meta).

Session handler approvals, with their `auto_connect` and `standing_accept` settings, and routing defaults are exported with intents memory (the `intent-choices` family, AMD-SG-I1, Appendix C.2).

**Provider blocks must be exported.** The current code exports `rtc/block/` but neither exports nor excludes `rtc/block-iss/` (a prefix `rtc/block/` does not match it). The renamed provider-block family MUST be exported beside principal blocks.

**Excluded** from export, as transient, derived or secret:
- endpoints (secret: hashed secrets, DPoP bindings, push keys);
- session records, event queues, outboxes and inbound queues, and owner-hook entries;
- replay, delegate, epoch and limit state;
- relay leases.

**Deletion** is §14.4.

## 13. Abuse

### 13.1 Limits

Values are provider policy (reference values are in Appendix B, RTC-11), but the **kinds** of limit are not. Excess invites are dropped silently at §9.2 step 7, still answered `202`.

**A recipient provider MUST limit, after verification:**
- invites per (initiator origin principal, recipient);
- invites per initiator origin principal across all recipient entities on the host, as one host-wide window;
- for cross-entity invites, invites per (sending issuer, recipient) and per (sending issuer, link parent), because one issuer can mint any number of principals;
- pending sessions and invites per recipient;
- connected sessions per recipient;
- messages per leg;
- **the aggregate `data` bytes it relays for each of its entities** in a rolling window, counting what the entity's legs send and receive. This limit kind is required, not optional, because `data` is the only profile whose bytes transit providers (§3.5). Excess `data` ends the leg with `failed` at the receiving side (§9.2 step 7). The sender's provider refuses its own endpoint's excess with `rate_limited`.

**Separate windows (RTCw-M1, R2; AMD-RW3):**
- **Own devices.** `self` invites count only against their own per-entity window, outside every cross-entity window and the host-wide initiator window. No other party can spend it. On the initiator side, own-entity `open` calls count against that same own-device window and not against the entity's `open` window. Otherwise the smaller `open` window binds first and the own-device window never does. That is the reference code today: `opens` (60/h) is taken at every `open`, before `self` (120/h) at admission. Appendix C.1 lists the change.
- **Principal-bound links.** Invites on a principal-bound link presented by the principal it names (callbacks included, once they exist) count against the per-(initiator, recipient) and host-wide initiator windows, the link parent's (issuer, parent) window, and their own per-recipient window. They count against neither the per-recipient window nor the (issuer, recipient) window. This matches the reference code (`inviteLimits`: `pair`, `caller`, `issuerParent` and `preferred`).
- **Same-host share.** A provider that counts its own verified principals as individual shares of the issuer windows MUST also bound their total by a per-recipient window below the per-recipient limit, so that foreign initiators keep headroom.

**Pending reserve.** When pending capacity is short, bearer-link invites MUST NOT use the reserve held for `self` and principal-bound invites.

**An initiator provider MUST limit:**
- open sessions and `open` calls per entity;
- key-warming fetches per entity, spent only when the recipient's keys are not held;
- the `data` bytes its endpoints send, within the aggregate budget above.

Link minting per app (a live-link quota and a mint window per app, RTCw-M2-2, I5) applies once `mint_link` exists (§20.3.2).

It refuses its own app with `rate_limited`.

**Endpoints and outbox.** Endpoints are bounded per entity and per app. The outbox is bounded in total and per peer, with a reserve for control statements, and a drain pass never blocks behind one failing peer.

### 13.2 Block lists

- **Principals.** An owner blocks an origin principal.
- **Providers.** An owner blocks a whole initiator provider (issuer origin). This is needed because a foreign issuer can mint principals at will (AMD-RW4).
- **Effect.** Blocked invites are dropped at the block step (§9.2 step 7), silently. They create no owner-hook entry and are answered like any other batch. Blocking ends the blocked party's pending invites silently.
- **Own-entity exemption.** The owner's own principal and its own provider can never be blocked. An invite from the owner's own entity is never blocked, whatever rows are stored, so a block can never break own-device sessions (RTCw-M6-3).
- **A shared block list.** A provider MAY implement these as one core blocked-principals and blocked-providers list, shared with link intake and other features.

### 13.3 Quarantine and requests

- An invite admitted through a **quarantined** contact parent is answered and processed exactly as through an active one, up to step 7. It is then held: it is never delivered to endpoints, and creates an owner-hook entry (§11.3).
- **Requests** (`none` basis) are held the same way. A bounded number are held per recipient, and the excess is dropped silently.

### 13.4 Revocation

The following stop new admissions at once:
- revoking a link;
- removing a link's signaling configuration, or the kind from it;
- exhausting its uses.

Sessions already connected continue until they end.

## 14. Owner control and lifecycle

### 14.1 Owner controls

These are generic controls. Their presentation belongs in existing surfaces, not a calling view (Appendix C):

| Control | Where it belongs |
| --- | --- |
| Approved handlers per kind, the routing default, per-app auto-connect for `self` kinds, and standing acceptance per (handler, kind) for cross-entity kinds, with its availability disclosure (§5.5) | Intents settings, and app access (AMD-SG-I1). |
| Endpoints per app, with revoke | Devices. |
| Signaling configuration on the owner's unconditional contact links. Setting it discloses that any holder of the link can then request sessions of those kinds (§5.3). App-minted links, grouped by minting app with per-app revoke, come with AMD-SG-L1b. | Links. |
| IP policy for other entities (`relay` by default, `public` by opt-in) and for own devices | Privacy. |
| Requests (`none`) per kind, off by default | Privacy, or the kind's settings. |
| Principal and provider blocks | People, blocked. |
| Held invites and invites with no eligible endpoint | The owner hook (§11.3), wherever the provider's interface shows it. |
| End a live session | The app, or a provider control listing the entity's live sessions. |

Owner actions that widen are governed by the provider's feature gates. Narrowing actions, including ending, revoking, blocking and removing approvals, are never gated.

**Concurrent edits.** Updates to owner signaling settings (IP policy, requests, auto-connect, standing acceptance, link configuration) are compare-and-swap on a revision, so that a stale interface cannot silently undo a newer choice (DEVLOG 2026-10-27, "Bug hunt round 3 (browser)", R1).

### 14.2 Revocation and narrowing

Each of the following has the effects listed after it:
- unregistering an endpoint;
- revoking a session's device or app connection;
- revoking an app's slot grant;
- removing an app's session handler approval for a kind, or the approval being **cleared** under §20.1.4 (the handler's connection ends, including app removal, or an adopted manifest stops declaring the kind);
- an app's connection ending for any reason;
- disabling a provider feature.

These are the only lifecycle triggers. They replace the AMD-X1 bound-narrowing path (`narrowBoundOptions`) and the RTC grant-changed path (Appendix C.2).

The provider at once:
1. Stops relaying and certifying for the affected legs.
2. Revokes their relay credentials, best effort.
3. Sends a control statement `revoked` for each **claimed** leg. It retries for as long as the leg's certificate could still be used.
4. Ends **pending** invites silently (§8.5) when the invite was delivered only to that app's endpoints and the app no longer holds the kind. An invite that was also delivered elsewhere keeps pending (RTCe-21).
5. Narrows link configurations:
   - **App-minted parents** (`minted_by` names that app or feature; none exist until AMD-SG-L1b): when the app's connection or grant ends, it revokes every parent that app minted. When only a kind is removed, it revokes only that app's minted parents whose configuration names the kind (RTCw-M2-3). It never revokes a parent minted by another app, or an owner-configured one.
   - **Owner-configured parents** (`minted_by: null`): it never revokes the parent, which may also carry messages. When the entity no longer has any approved handler for a kind, it removes that kind from every owner-configured configuration, and removes a configuration whose `kinds` becomes empty (§5.3). While another approved handler remains, the kind stays, because invites can still route to it.
6. Removes the app's endpoint registrations for the affected kinds.

A revoked endpoint that still holds an unexpired leg certificate, and posts directly to the peer provider, is refused there once the control statement arrives. The residual window is at most the certificate's remaining lifetime (at most 900 s). If a control statement finds even the reserved outbox full, the session still ends locally, and the same bound applies (RTCd-24).

Re-registering after an endpoint revocation is allowed. To stop an app, the owner removes its approval or grant, or blocks it.

### 14.3 Moves

When an entity's move commits, its source provider:
- ends every session of that entity, with a control statement `moved` for claimed legs and silently for pending ones;
- revokes relay credentials;
- stops issuing leg certificates. Its certification keys are revoked at commit ([identity portability §6.3](identity-portability.md#63-commit-at-the-source)).

Peers resolve the current issuer through successor pins, and deliver only there. Messages naming an earlier issuer fail at step 2. Admission state is keyed by origin principal. Contact links and their signaling configuration work at the destination only if imported. In-progress sessions are not migrated.

### 14.4 Deletion

Account deletion:
- ends every live session, with a control statement `revoked` for claimed legs and silently for pending ones;
- removes the endpoints;
- removes the signaling configurations, and revokes any app-minted links (once AMD-SG-L1b exists);
- closes the entity to new admissions.

The drain that delivers those control statements MUST run before the identity is tombstoned, so that peers can still verify them (RTCd-12, RTC-d review M1). Pinned peer keys (§6.3) cover the peer side.

### 14.5 Authority resets and slot changes

- A higher `aep` from a peer is recorded. A provider MAY end sessions with a peer whose authority reset, and MUST refuse certificates with a lower `aep`.
- Removing the signaling occupant ends every registration and session, as in §14.2.
- Blocking a kind version (artefacts and intents) stops new sessions of that version.

## 15. Interoperability and versioning

- **Discovery.**
  - An initiator provider learns a peer's support, and the peer's profiles, from the peer issuer's manifest (`signaling.v1`).
  - An app learns its own provider's support from the manifest's `extensions` occupant declaration for the slot, beside `extensions.v1`.
  - Providers without `extensions.v1` process the slot fragment as an ordinary fragment. With no built-in occupant, there is no signaling.
- **Versions.** The feature, the message, certificate and control `v`, the slot, the contract, each profile and each kind line version independently, each by its own rule. A receiver rejects an unknown `v`. A new message version is introduced by a new feature version, and a provider MAY declare both.
- **Kind versions.** A recipient provider delivers an invite of kind version *M* to a handler approved for version *N* < *M* only when it has verified that the line is additive from *N* to *M* ([artefacts §7.2](artefacts.md#72-advancing-a-head)). It then projects `context` to version *N*, and still delivers the raw invite unchanged. A version that adds disclosure needs re-approval ([intents §7.2](intents.md#72-remembered-consent)).
- **No registered kinds.** This document registers no session kinds. Apps and other publishers publish them. §20.1.9 gives one worked example, which is not registered.
- **Reserved:**
  - a `relation` basis (an access entry over an [organizations §9](organizations.md#9-relations) edge);
  - brokered signaling occupants;
  - a group member;
  - long-term device keys for end-to-end pinning;
  - a WebSocket or SSE delivery profile;
  - further transport profiles (for example WebTransport);
  - sessions that act for no entity;
  - an establishment path for always-on mode (b) (§5.6);
  - app-minted signaling links, signaling-only parents and callbacks (§20.3.2).

## 16. Annex A: the `webrtc` profile (normative)

### 16.1 Scope

It sets up a WebRTC peer connection. Media and data then flow peer to peer, or through relays.

### 16.2 Kind parameters

`session.profiles.webrtc` is exactly `{}`. There is no media bound: what a connection carries is the endpoints' concern, and a provider could not stop an app streaming video over a data channel anyway (§19.3, answer 5). The only media check left is structural (§16.4).

### 16.3 Parameters and messages

**Invite and accept parameters:**
- Invite `params`: exactly `{offer}`. `offer` is `null`, or an SDP offer that carries no candidates (§16.4).
- Accept `params`: exactly `{answer}`. `answer` is an SDP answer if the invite carried an offer, otherwise `null`.

**Profile messages:**

| `type` | Sender | `body` (exactly) |
| --- | --- | --- |
| `sdp` | either, after the claim | `gen` (integer ≥ 0); `description` (`{type, sdp}`, with `type` `offer`, `answer` or `rollback`, and `sdp` empty for `rollback`). |
| `candidates` | either, after the claim | `gen`; `items` (0 to 16 `{candidate, sdpMid, sdpMLineIndex, usernameFragment}`); `complete` (boolean). |

### 16.4 SDP and candidate rules

These rules exist so that addresses travel only in `candidates` messages, where the sender's provider and the receiver can see and filter them. They are unchanged from rtc-signaling §6.3 with AMD-RV1.

**SDP:**
- An SDP is at most 24,576 bytes of UTF-8, with CRLF line endings.
- It MUST carry `a=ice-options:trickle`.
- It MUST NOT contain `a=candidate`, `a=remote-candidates` or `a=end-of-candidates` lines. Attribute names are compared case-insensitively.
- Every `c=` and `a=rtcp` address MUST be `0.0.0.0` or `::`. The `o=` address MUST be `0.0.0.0`, `::`, `127.0.0.1` or `::1`.
- The `o=` username and session id MUST each be `-` or decimal digits, and the session version decimal digits. An endpoint rewrites a browser's other username to `-`.
- No `u=`, `e=` or `p=` lines.
- Outside the `o=`, `c=` and `a=rtcp` address fields and the `a=fingerprint` value, no line may contain any of these:
  - an `IN IP4` or `IN IP6` token;
  - a dotted run of four numbers;
  - a run of hexadecimal digits, dots and colons with two or more colons.
- Every `m=` media type MUST be `audio`, `video` or `application`. This is a structural check only. It does not bound which of them a session uses.
- **Fingerprints.**
  - The SDP MUST contain an `a=fingerprint` with `sha-256` or stronger. Endpoints MUST NOT apply an SDP that lacks one.
  - Every `a=fingerprint` line, at session and media level, MUST carry the same algorithm and value, compared case-insensitively.
  - An SDP with any weak fingerprint is invalid.

**Candidates:**
- A candidate is an [RFC 8839](https://www.rfc-editor.org/rfc/rfc8839.html) `candidate-attribute` value without `a=`, at most 512 bytes.
- Its `typ` is `host`, `srflx` or `relay`. Unknown extension attributes are refused.
- A `relay` candidate carries `raddr 0.0.0.0 rport 0`, or no `raddr`.
- **In a cross-entity session:**
  - a `host` candidate's address MUST be a UUID followed by `.local` (mDNS);
  - a `srflx` candidate's `raddr` MUST be `0.0.0.0` or `::` with `rport 0`, an mDNS name, or absent;
  - the address of a `srflx` or `relay` candidate MUST NOT be an unspecified, loopback, private, shared (RFC 6598), link-local, unique-local, multicast or reserved address. This includes IPv4-mapped, IPv4-compatible and NAT64 forms of one.
- Raw host addresses are allowed only in own-entity sessions.

**When the rules apply:**
- No SDP and no candidate travels before the claim, except the invite's candidate-free `offer`.
- These rules hold under every IP policy, so both providers and endpoints enforce them.
- Which candidate types an endpoint sends under its owner's policy is enforced only by the sender's own provider.
- A `webrtc` session carries no `data` messages (§3.5). Application bytes go over the session's own data channels.

### 16.5 IP policy

The owner's policy restricts only the candidates an endpoint gathers and sends:
- `relay`: only `relay` candidates.
- `public`: adds `srflx` candidates whose `raddr` is unspecified, mDNS or absent, and mDNS `host` candidates.
- `all`: adds raw `host` addresses. Own-entity sessions only.

**Defaults:**
- For a session with another entity, the default MUST be `relay`. `public` needs the owner's opt-in, per peer or global.
- Own-entity sessions MAY default to `all`.

**Enforcement:**
- The sender's provider enforces the stricter of the session's pinned policy and the owner's current policy on its endpoint's `send` (RTCd-rev). Widening never reaches a live session.
- An endpoint under `relay` gathers only relay candidates, and MAY pair them with any remote candidate.
- If the policy is `relay` and the endpoint has no relay, the session cannot connect. The endpoint reports that, and MAY ask the owner to allow `public` for this session. It MUST NOT fall back silently.
- An endpoint under `relay` does not use STUN.

### 16.6 Fingerprint binding, verification levels and negotiation

**Fingerprint binding.** An endpoint MUST apply an SDP only if it arrived in a message that verified under §6.1 and §7 for this session and the expected peer leg. The signed payload binds `sid`, both principals and both legs, so any party that changes the fingerprint without a leg key is detected.

**Verification levels.** Endpoints verify the peer's certificate in one of two ways:
1. **Provider-supplied keys** (`peer_keys`, `listen`). This is the baseline.
2. **Direct.** The endpoint fetches the peer's identity document from the peer's current issuer, with the same identity and no-rollback rules. Then the endpoint's own provider cannot substitute the peer's keys. The fetch reveals the endpoint's address to the peer's issuer, so an endpoint under `relay` MUST NOT fetch directly without the owner's opt-in.

**Renegotiation.** After the claim, either leg MAY send `sdp` offers, including ICE restarts. Each carries a `gen` one higher than the highest `gen` the sender has seen. The recipient leg is the **polite** peer and the initiator leg the **impolite** peer (the W3C perfect-negotiation pattern).
- **Colliding offers.** When an endpoint receives an offer while its own offer is outstanding, the impolite (initiator) leg ignores the incoming offer. The polite (recipient) leg rolls back its own offer (`rollback`), applies the incoming offer and answers it.
- `candidates` carry the `gen` they belong to. Candidates for a superseded `gen` are ignored.

**Short authentication strings are out of core.** Endpoints MAY compare a SAS over an established channel, for example a ZRTP-style commit and reveal in the data channel, bound to the fingerprints above. Providers carry no SAS fields.

### 16.7 Relays

- Each endpoint obtains relay credentials only for itself: from its own entity's `ice-relay/v1` occupants, or from its app's own relay configuration.
- A credential is never sent in a signaling message, or to the peer.
- **The built-in occupant** issues credentials only for a live leg of its entity:
  - an initiator leg that is pending before `answer_by`, or connected;
  - a recipient leg whose accept claim won.

  The lifetime is at most the shorter of the provider's maximum and the session's remaining life. For a pending leg it is also at most `answer_by`.
- Before issuance it re-checks the handler approval for the session's kind (RTCw-M4).
- It revokes credentials, best effort, when the leg ends, and a sweep revokes whatever the end path missed.
- It enforces its own budget, and MUST NOT rely on client-reported byte counts.
- **Byte cap (normative).** A built-in occupant MUST NOT issue any relay credential unless a per-owner byte cap is enforced from the relay provider's own usage data: usage attributed to the owner through the credential usernames the occupant issued, with credentials revoked when the owner overruns. Client-reported counts, declared sizes, reservations and admission estimates do not satisfy this. A TURN credential is a bearer token with no byte limit of its own, so without such enforcement relayed bytes, and their cost, are unbounded. This carries the RTC-f production gate (RTCf M1(d)) into the normative text. AMD-SG-S2 (§20.9) proposes the matching security.md gate.
- Its refusals before any credential exists are no-effect outcomes (`not_found`, `forbidden`, `rate_limited`), so ordered failover proceeds (RTCf-10).

## 17. What each party can still do

| Party | Can | Cannot |
| --- | --- | --- |
| The initiator's provider | Impersonate the initiator (it certifies leg keys). See the initiator's sessions, peers, kinds, contexts, timing and address. Drop, delay or forge-cancel its signaling. | Read media or data without substituting a leg. Impersonate the recipient to the recipient's provider. |
| The recipient's provider | The same for the recipient. Learn whether, and on which of its user's devices, a session was answered. | Substitute the initiator's keys toward an endpoint that verifies directly (§16.6). |
| Both providers together, or one provider hosting both parties | Mount an undetected man-in-the-middle, unless the endpoints compare a SAS in-band. | Defeat a compared in-band SAS, except by guessing. |
| A relay operator | See its own endpoints' addresses, peers' relay addresses, timing and volume. | Read or alter DTLS-protected media or data. |
| An app | Anything its code does with what it receives, including moving bytes through `data` or its own servers after a claim. | Start or answer sessions of kinds the owner did not approve. See invites routed to another app. Reach other apps' endpoints. |

A provider cannot stop a connection that already exists. Ending a leg relies on the peer endpoint closing it and on relay credentials lapsing.

## 18. Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep `rtc-signaling.v1` as designed | It carries a calling product into the provider: ring screen, missed list, alert and mute policy, media in the purpose, call links and SAS. The owner's direction rules that out. |
| A WebRTC-only wire | Simpler, but it hard-codes SDP and media vocabulary into a core-adjacent extension. Every non-WebRTC use would then need a parallel extension that duplicates admission, claim and the no-oracle rules. |
| **A slim `signaling-purpose` artefact kind with AMD-X1 bound purposes** (the main rejected alternative) | See §19.1. It keeps a second kind registry beside intents, keeps the only extension-system amendment, and either keeps cross-app visibility (AMD-RW1) or re-builds handler choice outside intents. |
| Provider-signed hop-by-hop events | The receiving provider could rewrite DTLS fingerprints undetectably. |
| Long-lived device keys | They link one device across every session and peer. Per-session keys give the same detection without the tracking. |
| Candidates in the invite, sent to every device | They disclose addresses before anyone answers, and make candidate policy unenforceable. |
| A ringing or busy message | It reveals presence to anyone who can reach the recipient. |
| Signaling over messaging or activity | No ordering, latency target or first-claim semantics. Both keep what signaling must delete. |
| Network fetches during verification | Timing would reveal admission and contact relationships. |
| A dedicated ticket link type | Contact links with owner-side configuration (`uses`, `principal`, `minted_by`) express the same capabilities, reuse link verification, revocation and secrecy, and add no link type. |
| Provider presentation (a portal ring, or activity items for invites) | Presentation is the app's (§11.3). Rev 0 used provider-source activity items; the owner moved all presentation to the app layer, leaving only the owner hook. |
| An interim ticket link type until the links re-scope | It would ship a link type due to be removed. Owner-configured parents cover shareable admission now, and app minting waits (§20.3.2). |

## 19. Provisional decisions and owner questions

### 19.1 Routing: intents (leading candidate for mode (a)) versus a slim purpose kind

| | **A. Intents routing (leading candidate)** | **B. Slim `signaling-purpose` kind (documented fallback)** |
| --- | --- | --- |
| What names the use | An intent kind with a `session` member | A separate artefact kind (`id`, `title`, `summary`, `parties`, `profiles`, `context`, `categories`) |
| Per-app authorization | An intents session handler approval (an owner record in intents memory) | AMD-X1 bound consumer options on the slot grant |
| Who receives invites | The owner's routing handler for the kind | Every approved app (AMD-RW1 visibility), or a per-purpose default stored by signaling (a copy of intents §7) |
| Core changes | Intents amendment AMD-SG-I1, which adds an authority record to intents (§20.1.10) | Extensions amendment AMD-X1, plus a kind registration |
| Reuse | Kind registry, growth tables, disclosure, projection, handler declarations, defaults, exclusions, chooser, handoff | Data schema and disclosure validators only |
| Approval check | Local to the account (intents memory), so no federation-shard call inside the account gate. The RTC-i lock-order class goes away. | Federation grant data, needing the RTC-i dispatch snapshot and approval record (RTCi-1, RTCi-2) |
| Cost now | Larger. The intents amendment needs owner sign-off, and code moves from purposes and bound options into intents. | Smaller. Most of it is implemented. |

**Position (provisional).** A is the **leading candidate for establishment mode (a)** (§5.6), and rev 1 specifies it. It matches "a hub for connecting things together": a session kind is just another intent kind, and the owner's existing handler choice decides which app connects. It removes a parallel kind registry and the extension-system amendment, and it fixes cross-app visibility by construction. It is **not adopted as final**: the owner is not sure that intents fit every case, and mode (b) may not use intents at all. The establishment spike decides (§19.4, S1 and S2). B stays the documented fallback. If it is chosen, drop `media`, `alert` and `auto_accept` from the purpose, keep AMD-X1, and adopt AMD-RW1's disclosure.

### 19.2 Decisions (all provisional and unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| SG-1 | A generic signed session channel with profiles. `webrtc` is the first profile, and `data` the second, with the rev 1 limits (§1, §3.5). | Reviewer ___ Date ___ Outcome ___ |
| SG-2 | Session kinds are intent kinds with a `session` member. Intents routing (AMD-SG-I1) is the leading candidate for invite-style establishment (mode (a)), pending the establishment spike. It is not final. The `rtc-purpose` kind and AMD-X1 are dropped, and AMD-RW1 does not arise (§5.4, §5.6, §19.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-3 | Kind authorization is a session handler approval in intents memory, checked live and locally on every widening operation, including `claim` accept (§10.1). The routing handler is the explicit default, else the sole approved handler. When a second handler is approved and no default exists, the sole handler is promoted to the explicit default (§20.1.5). Otherwise the owner hook offers the chooser. | Reviewer ___ Date ___ Outcome ___ |
| SG-4 | No calling and no presentation in the provider. Calling is app-level (a messaging app's call invite is a message with a JSON media type, in the messaging/BindleBox spec). The provider's only duty is the owner hook for held invites and invites with no eligible endpoint, which never interrupts. Signaling creates no activity items, and AMD-SG-A1 and AMD-SG-N1 are withdrawn (§11.3, §20.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-5 | Admission is `self`, owner-side signaling configuration on the owner's existing unconditional contact parents (AMD-SG-L1a, replacing `rtc/contact/`), or `none`. Tickets are dropped, with no interim type. `mint_link`, minted and signaling-only parents, delivery-off and callbacks are unavailable until the links §6 re-scope (AMD-SG-L1b) (§5.3, §20.3). | Reviewer ___ Date ___ Outcome ___ |
| SG-6 | Consumers are `application` and `provider`. Provider features are endpoints, acting as built-in handlers for an entity. Cross-entity, they answer only under standing acceptance, within their declared policy (§4.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-7 | Guardrails: no offline delivery, a 120 s answer window, a 24 h session cap, `seq` ≤ 4,095, delete after delivery, payload hashes only in replay state, no history, no multi-party. `data` exists only in the `data` profile, at ≤ 4 KiB per message and 64 KiB per leg, under a required aggregate per-entity budget, and behind a production gate (§1.2, §3.5, §13.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-8 | Adopt AMD-RI1 (uniform 404 for an unknown `aud`), RI2 (one `aud`), RI3 (`to` drop), RI4 (`listen` members), RI5 (`unsupported_peer`), RV2 (re-send bound, refresh lanes) and RW2 (same-host `iss` refusal), and the per-entity-enablement rule (RTCw-R1), with the drain-rate residual recorded (§9, §10). | Reviewer ___ Date ___ Outcome ___ |
| SG-9 | Abuse limit kinds include the aggregate `data` budget, the own-device, principal-bound and same-host-share windows, and the pending reserve. Own-entity `open` calls count against the own-device window (a code change). The principal-bound windows match the code. Cheap checks run before expensive ones. There are per-app endpoint caps, and per-app link quotas once minting exists (§13.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-10 | Block lists cover principals and providers, with the own-entity exemption, and both are exported. Mutes are dropped, and there is no signaling interruption policy (§11.3, §12.6, §13.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-11 | SAS leaves the core, and fingerprint binding stays. The media bound is dropped. Only the structural `m=` type check (`audio`, `video`, `application`) remains (§16). | Reviewer ___ Date ___ Outcome ___ |
| SG-12 | The initiator's app origin is disclosed to the recipient, labelled "reported by" for a foreign initiator (RTC-17, RTCe-22). | Reviewer ___ Date ___ Outcome ___ |
| SG-13 | Decline reasons are `declined` and `unsupported`. `busy` is dropped, and end reasons are neutral (§7.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-14 | `ice-relay/v1` is unchanged, with AMD-RL1 and the RTC-f rules. No credential is issued unless a per-owner byte cap is enforced from provider usage data (§3.3, §16.7, AMD-SG-S2). | Reviewer ___ Date ___ Outcome ___ |
| SG-15 | New identifiers (`signaling.v1`, `typ`, media type, slot, contract) rather than reusing `rtc-signaling.v1`. Nothing is published, so no compatibility is owed (Appendix C). | Reviewer ___ Date ___ Outcome ___ |
| SG-16 | Auto-connect is an owner setting per app and per `self` kind, and requires the same `client_id` (§5.5). Grouping a vendor's clients is open (I3). | Reviewer ___ Date ___ Outcome ___ |
| SG-17 | Standing acceptance: an owner setting per (handler, kind) for cross-entity kinds, off by default. It lets that handler accept admitted invites without a user action. Its approval page discloses that it makes the entity's availability visible to any admitted initiator. For provider features, the feature's declared policy applies within it (§4.2, §5.5). | Reviewer ___ Date ___ Outcome ___ |
| SG-18 | Signaling configuration is forbidden on conditional contact parents, rather than evaluating audience policy at §9.2. Link representations (links §6.3, the composer and previews) are unchanged by it (§5.3). | Reviewer ___ Date ___ Outcome ___ |
| SG-19 | A recipient provider resolves kind versions only from its store, a mirror, or a background fetch whose triggering does not depend on recipient state (§3.4). | Reviewer ___ Date ___ Outcome ___ |
| SG-20 | `target` is restricted to the initiating app's own endpoints. Glare auto-accept requires the surviving invite to be within the endpoint's own outgoing invite. Each routing case fixes a handoff target (§5.4, §8.3). | Reviewer ___ Date ___ Outcome ___ |
| SG-21 | Two establishment modes: (a) invite-style, specified here with intents routing as the leading candidate, and (b) always-on, described as a separate path that a spike must shape. Until then, no mode (b) path is added beyond the rev 1 mechanisms (§5.6). | Reviewer ___ Date ___ Outcome ___ |
| SG-22 | The intents chooser gets a robust short-list: likely candidates first, an expansion to all capable apps, and a confirmation only when there is one candidate. This is an intents requirement for every chooser, not a signaling rule (§20.1.11). | Reviewer ___ Date ___ Outcome ___ |

### 19.3 Answers to the rev 0 owner questions (provisional, unsigned)

The owner said provisional decisions may be adopted for now without sign-off. These answers are adopted on that basis. Each still needs sign-off.

1. **Intents routing (SG-2, SG-3).** Adopt A provisionally, with M4 (sole-handler promotion, §20.1.5) and M6 (the authority record, made explicit in intents §1, §5 and §9.5, §20.1.10). B stays the documented fallback. Later owner direction narrows this: A is the leading candidate for mode (a) only, pending the spike (§5.6).
2. **Provider presentation (SG-4).** Never interrupt by default. "Unanswered" items are dropped. Held and no-handler cases are kept. Later owner direction goes further: all presentation moves to the app layer, so held and no-handler invites survive only as entries in the minimal owner hook (§11.3), not as activity items, and the provider never interrupts at all.
3. **Contact links (SG-5).** `mint_link` and callbacks are unavailable until the links re-scope. There is no interim ticket type. Owner-side configuration on existing parents ships now, with the H3 audience fix (§5.3, §20.3).
4. **`data` profile (SG-1, SG-7).** Acceptable with the rev 1 changes: 4 KiB per message, 64 KiB per leg, a required aggregate per-entity budget, `data` only in the `data` profile, payload hashes only in replay state, and a production gate (§3.5, §13.1).
5. **Media bound (SG-11).** Dropped. Only the structural `m=` type check remains (§16.2, §16.4).
6. **RTC-17 / SG-12.** Disclose the app origin, labelled "reported by" for a foreign initiator.
7. **AMD-RI1 (SG-8).** The uniform `404` for an unknown identity.
8. **Provider to provider (§4.3).** A hosted service entity is enough, given standing acceptance (H1).

### 19.4 Open questions and spikes

- **S1. Establishment mode (a): do intents fit every case?** The owner is not sure. The spike should test intents routing against concrete invite-style uses, including a messaging app that surfaces call invites as messages, and say where it fails.
- **S2. Establishment mode (b): always-on.** The questions listed in §5.6: its authorization record (if any), endpoint discovery across one vendor's apps without an inventory leak, whether it bypasses intents, reconnection under the session caps and windows, and the owner's revocation surface.
- **I3. A vendor's native and web clients under different `client_id`s.** Auto-connect, `target` and mode (b) all key on one `client_id`, so a vendor's native app and web app cannot auto-connect or target each other. One option is grouping by verified registrable domain, as intents §7.4 already does for exclusions. Owner call.
- **Links re-scope timing.** AMD-SG-L1b (minting, delivery-off, callbacks) waits for the links §6 re-scope that the messaging extraction needs. Its timing is outside this spec.
- **Residuals to accept or close.** The drain-rate residual for dark batches (§9.2), and the unenforceable `context` address rule (§7.2, §12.3).

## 20. Proposed amendments (unsigned)

None of the amendments below is applied to its target document. Each needs protocol and security review and the owner's sign-off.

### 20.1 AMD-SG-I1: session kinds and addressed delivery (intents)

**Target:** [intents](intents.md) §1, §4.1, §4.4, §5, §6, §7, §7.3, §8, §9.5, §12 and §14. **Status:** proposed, unsigned. **Not applied to intents.md.**

**What it adds.** This amendment adds an **authority record** to intents: the session handler approval (§20.1.4). Intents today grants nothing (intents §1, §5, §9.5). §20.1.10 amends those sections explicitly. It is the leading candidate for routing in establishment mode (a) (signaling §5.6), and is not final.

#### 20.1.1 The `session` member

An intent kind body MAY carry `session`, exactly `{"v": 1, "parties": "self"|"other"|"any", "profiles": {<profile id>: <profile parameters>}}`:
- `profiles` names one to four profiles registered by [signaling](signaling.md) §3.5. Each value is validated by that profile. Both registered profiles take `{}`.

A body with `session` (a **session kind**) MUST also have:
- `effect: "join"`;
- `capability: false`, and no field with `format: contact-link`;
- `max_bytes` present and at most 2,048;
- at most 8 data properties.

**Growth table.** Add the row `/session`: frozen. A version cannot add or remove `session`.

#### 20.1.2 Not a link intent

A handling provider refuses a session kind received in a `bintent` at its `intent-links.v1` endpoint (§6), if it has one, with `intent_kind_invalid`, after kind resolution and without handoff. Session kinds reach handlers only through §20.1.6 and §20.1.7. This keeps links from becoming a way to push invites.

#### 20.1.3 Handler declarations

These are unchanged. An app declares a session kind in its manifest `intents` member with `kind`, `version`, `digest` and `route`. `route` is the handoff target of §20.1.7. A provider feature declares session kinds as a built-in handler (§5 "Built-in handlers").

#### 20.1.4 Session handler approval

An entity's **session handler approval** is an owner record with these members:
- the handler (`client_id`, or the provider feature `ref`);
- the kind line, with the `{version, digest}` shown;
- the approval time;
- `auto_connect` (boolean, default `false`; allowed only when `parties` is `self`);
- `standing_accept` (boolean, default `false`; allowed only when `parties` is `other` or `any`). It lets the handler accept admitted cross-entity invites of that kind without a user action at the device ([signaling](signaling.md) §5.5).

**What it authorizes.** It lets that handler register endpoints for, open sessions of, receive invites of, and accept sessions of, that kind under [signaling](signaling.md). It is the only authority for a kind. A manifest declaration confers none (§5).

**How it is recorded.** Only by an owner action on a provider page that:
- meets the §7.1 disclosure obligations;
- also shows `parties`, the profiles, and that the handler will see the verified identity, reported app origin and context of every invite routed to it;
- for `standing_accept`, says before the control is armed that an automatic answer makes the entity's availability visible to any initiator admitted for that kind, and names the configured links that can admit them (signaling §5.5). For a provider feature, it also shows the feature's declared answering policy;
- preselects nothing;
- is same-origin and CSRF-protected, with `frame-ancestors 'none'` and controls armed after a delay.

**Who approves.** The entity's owner:
- for a person, that person;
- for an organization entity, a person authorized by the organization's membership and grant policy, acting through its owner interface ([organizations §6.3](organizations.md#63-owner-interface)), with the same disclosures. Owner-interface authority never reaches apps or other entities;
- for a hosted service entity (signaling §4.3), whoever operates that entity's owner interface under the same rule. The operator gets no provider-wide shortcut.

**Where a provider MAY offer it:**
- at authorization of the signaling slot, for the session kinds in the app's pinned manifest;
- from the chooser (§20.1.5, §20.1.11);
- from the `approval_required` answer of signaling `open` and `register`. That answer carries the URL of a provider page on the provider's own origin, never a URL that the app supplies.

**Lifecycle:**
- **Widening.** A later kind version that adds disclosure needs re-approval, as §7.2. Turning on `auto_connect` or `standing_accept` is widening, and needs the same page.
- **Removal** is immediate narrowing.
- **Clearing.** An approval is cleared when the handler's connection ends, including app removal, or when an adopted manifest snapshot stops declaring the kind. A failed refetch clears nothing.
- **Signaling effects.** Removal, clearing and a connection ending each trigger signaling §14.2 narrowing.
- **Exclusions** (§7.4) apply. An excluded handler cannot be approved for that kind until the exclusion is removed.
- **Privacy.** Approvals and defaults are owner data. They are listed, removable, exported with the account (the `intent-choices` export) and deleted with it, and are never observable by initiators or other apps.

#### 20.1.5 Routing handler

The owner MAY set one approved handler as the **default** for a kind line. The **routing handler** is that default, else the sole approved handler when there is exactly one, else none. A newly approved handler never replaces an existing default (§7.3).

**Promotion of the sole handler.** When the owner approves a second handler for a kind line that has no explicit default, the provider records the existing sole handler as the explicit default in the same transaction. The approval page says so, and offers to make the new handler the default instead. Routing never changes silently because a second app was approved.

With no routing handler, the provider offers a chooser among the approved handlers, and the connected handlers that declare the kind, from the owner hook of [signaling](signaling.md) §11.3, with the short-list of §20.1.11. A chooser opened from an incoming invite MUST say that it was triggered by an incoming request from another party, whose kind and context the provider has not verified (signaling §11.4). Choosing records an approval (§20.1.4), and optionally a default.

#### 20.1.6 Addressed delivery (amends §6)

§6 says "The provider MUST NOT act on an intent itself, MUST NOT call a handler server-to-server, and MUST NOT send the intent anywhere except the route of the handler the viewer chose." Add:

> For a session kind, the provider delivers an admitted invite only to the signaling endpoints of the routing set that [signaling](signaling.md) §5.4 defines: the owner's routing handler, or for own-entity sessions the initiator's own approved app or target. It delivers by the handler's own `listen` calls and payload-free doorbells, never by calling the handler's servers with session content, and never to another app.

#### 20.1.7 Session handoff (amends §8)

A provider MAY hand off a session-kind intent that it constructed itself from a pending invite, at the owner's action in its own interface. The navigation is top-level, with `Referrer-Policy: no-referrer`, to:

`<route>#bintent=<value>&bintent_iss=<issuer>&bsession=<sid>`

- `<value>` is the unsigned intent `{bintent: 1, kind, data}`, where `data` is the invite context projected to the handler's approved version.
- The route is the handoff target's (signaling §5.4).
- `bsession` is an untrusted hint.
- The handler applies every §8 rule. It claims the invite through signaling only after a confirmation in its own interface, except under auto-connect or standing acceptance.
- Direct handoff without a page is allowed only under §7.3's conditions. A click on the provider's own owner-hook control is a same-origin user activation.

#### 20.1.8 Feature and amendment rows

A provider that offers the signaling slot processes session kinds as above. That is local behaviour, and it is not tied to declaring `intent-links.v1` (signaling §3.1). Add a §14 row: "AMD-SG-I1, session kinds, session handler approvals (an authority record), addressed delivery and the chooser short-list, proposed by signaling §20.1."

#### 20.1.9 Worked example (not registered)

The line `https://spec.bindle.example/intents/device-sync/v1` has:
- `effect: "join"`, `capability: false`, `max_bytes: 64`;
- `data` `{"properties": {}, "required": []}`;
- `disclosure` `{"categories": ["personal-data"], "fields": {}}`;
- `session` `{"v": 1, "parties": "self", "profiles": {"data": {}, "webrtc": {}}}`.

An app approved for it with `auto_connect` syncs its own devices without prompting, and only with itself.

#### 20.1.10 Explicit amendments to intents §1, §5 and §9.5

- **§1 Model.** After "An intent grants nothing.", add: "The one authority record this document defines is the **session handler approval** (AMD-SG-I1): an owner record, not an intent, that authorizes a handler to use [signaling](signaling.md) for one session kind. It is recorded only by an owner action, and never by an intent, link or declaration."
- **§5 Handler declarations.** In the first rule, after "`intents` grants nothing", add: "and never creates a session handler approval". In "Change handling", after "Removing a kind clears the viewer's default for that handler and kind", add: "and clears that handler's session handler approval for the kind, which narrows signaling at once (signaling §14.2)". The statement that a declaration "confers no authority" stays true.
- **§9.5 Malicious handlers and minters.** Add: "A session handler approval is authority. An approved handler receives the verified identity, reported app origin and context of every invite routed to it. With `standing_accept`, it answers cross-entity sessions without the owner, revealing availability to admitted initiators. So an approval is recorded only by an owner action with the §20.1.4 disclosures, is removable at any time, is cleared with the connection, and is checked live on every widening signaling operation. For an organization or a hosted service entity, only a person authorized through its owner interface approves (organizations §6.3)."

#### 20.1.11 Chooser short-list (an intents requirement; amends §7.3)

This is a requirement on intents choosers in general, not a signaling rule. Signaling relies on it for mode (a). It amends intents §7.3 for every chooser:
- **Likely candidates first.** The chooser first shows a short list: the handler default (preselected, as §7.3 already says), then the approved handlers for the kind (for a session kind), then the handlers the viewer has used for that kind line, in order of the viewer's own recent use. The order never depends on what a manifest claims about itself.
- **Expand to all.** One control expands the list to every candidate (§5 "Candidates": the built-ins and the connected apps whose pinned manifest declares the kind), and to any catalogue the provider offers by its own policy. Excluded handlers stay hidden (§7.4).
- **One candidate.** With exactly one candidate, the page is a one-control confirmation naming that handler, not a chooser. It keeps the same disclosures, and its control is armed after a delay.

### 20.2 AMD-SG-A1: provider-feature source items (activity) — withdrawn in revision 1

Revision 0 proposed provider-source activity items for invites. Revision 1 withdraws it, following the owner's direction that presentation belongs to apps (§11.3). Signaling creates no activity items, so activity's signed admission evidence requirement does not arise for it.

**Precondition for any later mirror.** A provider that later wants to mirror owner-hook entries into activity MUST first get an activity amendment that defines both of these:
- **A provider-feature source**, `{provider: <issuer>, feature: <ref>}`, that no app can request. The subject app (the handoff target, or `null`) is a filter facet, never the item's author.
- **A system evidence profile.** It is purpose-separated signed admission evidence with its own `typ`, anchored to the admitting issuer's authenticated key discovery. It binds the profile and version, the admitting issuer, the destination account, the item id and revision, the source (provider and feature `ref`) and the feature declaration digest, the subject app or `null`, the operation id, kind and times, the exact content digest and media type, the system tags and the expiry. Items without valid evidence are never promoted to verified activity.

Such mirrored items would also never interrupt by default, and would fold foreign initiators per issuer (§11.3).

### 20.3 AMD-SG-L1: signaling configuration on contact parents (links), split

**Target:** [links](links.md) §6, §6.2, §6.3 and §7. **Status:** proposed, unsigned. Revision 1 splits it into L1a, which is needed now, and L1b, which is deferred.

#### 20.3.1 AMD-SG-L1a (now): owner-side configuration on existing contact parents

- **Signaling configuration.** An existing contact parent gains owner-side `signaling` configuration (signaling §5.3) beside intake configuration (§6.2). It is stored on the parent, compare-and-swap by `revision`, never signed, and never disclosed in any representation. When its `kinds` becomes empty, it is removed. It replaces the RTC per-parent configuration (`rtc/contact/`).
- **Unconditional parents only.** It MUST NOT be set on a parent whose meta has `audience` (§7). An update that tries to is refused. Signaling §5.3 gives the reasons.
- **Representations unchanged.** The §6.3 sender metadata representation keeps its exact member set. Its `kinds` are the signed message kinds, and it never reports session kinds, `uses`, `principal` or whether signaling is configured. The HTML composer, inspection, contact-profile representation and §6.4 previews are unchanged. A GET never admits, spends or creates anything.
- **Messages unchanged.** The parent's message delivery, quotas, intake and §6.1 authorship rules are untouched.
- **Owner disclosure.** Setting it tells the owner that any holder of the link can then request sessions of those kinds, and suggests `principal` for a link that is shared widely.
- **Lifecycle.** Revoking or expiring the parent ends its signaling admission. Narrowing follows signaling §14.2 step 5. Export and deletion follow signaling §12.6 and §14.4.

#### 20.3.2 AMD-SG-L1b (deferred until the links §6 re-scope): minting, minted parents, delivery-off and callbacks

**Unavailable** until the links §6 re-scope that the messaging extraction needs (scope audit, Task 1) lands and this part is signed off. A provider MUST NOT offer any of it before then. It is written here so that the re-scope can account for it.

- **`mint_link`** (signaling contract): `{kinds, uses, expires_in, principal?}` → `{link}`. It mints a contact parent for the owner, with signaling configuration and message delivery off, and with `minted_by` naming the calling app or feature.
  - It is a widening method: the handler approval for every named kind is checked live (signaling §10.1).
  - A minted parent has `exp − iat` of at most 30 days.
  - Minted parents count against a per-app live quota within the account's parent cap, and a per-app mint window.
  - Results that carry a link are never retained in an RPC journal (signaling §10.2).
- **Delivery switch.** A parent MAY have message delivery disabled, so that a parent minted only for signaling admits no message. Its §6.3 representation then needs to report that it accepts no message kinds. The re-scope must decide how, because the signed meta `kinds` is nonempty today.
- **Narrowing.** As signaling §14.2 step 5: revoking minted parents touches only parents whose `minted_by` is the narrowed app. Owner-configured parents lose only the kind.
- **Callbacks.** An invite MAY carry a callback, so the recipient can reach the initiator back:
  - **Minting.** With `open {callback: true}`, the initiator's provider mints a contact parent for the initiator, with `kinds` = the session's kind line, `uses: 1`, `principal` = the recipient's origin principal, delivery off, and `exp` at most 24 h after `iat`. Only its digest (`callback_digest`) is in the signed invite. The link travels in the batch's `links`.
  - **Verification at the recipient provider,** after the certificate and signature are verified (signaling §9.2 step 4):
    - the callback link must be canonical, and its SHA-256 must equal `callback_digest`;
    - its owner (the meta's `iss` and `sub`, mapped through the successor index) must equal the initiator's verified origin principal from the leg certificate;
    - its meta must verify under the initiator issuer's keys as held, with no fetch on the request path.

    If any check fails, the provider **drops the callback silently**: the invite proceeds without it, and nothing tells the initiator.
  - **Retention at the recipient provider.** The link is stored only with the pending session record. It is delivered only to the endpoint whose claim wins, in the `claim` result, and never in a `listen` event. It is deleted at the claim, the end or `answer_by`, whichever comes first, and is never logged.
  - **Retention at the initiator provider.** The callback parent counts against the initiating app's per-app live-link quota. It is revoked when the session ends unclaimed (cancel, decline, `answer_by`, or a silent end observed at `answer_by`). Otherwise it lives until its single use or its `exp`.
  - **Limits.** An invite on a callback presented by the principal it names counts in the principal-bound windows (signaling §13.1).

### 20.4 AMD-SG-K1: signature domains (organizations §3a.3; links §7.2)

This replaces AMD-R1. Certification keys gain the uses `bindle-signaling-leg+jwt` and `bindle-signaling-control+jwt`. Add rows for both, and for `bindle-signaling-message+jwt` (leg keys), separated by `typ`.

### 20.5 AMD-SG-P1: feature table (protocol §2)

This replaces AMD-R2. Add `signaling.v1` (§3.1), with no `intent-links.v1` dependency (§3.1, L5).

### 20.6 AMD-SG-E1: doorbell event (integrations §6.2)

This replaces AMD-R3. Register `signaling-doorbell/v1`, with payload exactly `{endpoint}`.

### 20.7 AMD-SG-N1: push for activity items (notifications) — withdrawn in revision 1

Signaling creates no activity items (§11.3), so it needs nothing from notifications. Endpoint doorbells (§11.2) are signaling's own, and carry no content.

### 20.8 Withdrawn by this draft (proposed)

| Amendment | Proposed withdrawal |
| --- | --- |
| AMD-X1 (extensions §13, applied provisionally to the text on 2026-10-26) | No longer needed: extensions §2.1 `bind`, the §2.2 rule, the §5.2 paragraph, the §11 tests and §13 would be removed. **Not edited by this draft.** |
| AMD-R4 (`rtc-purpose` kind) and AMD-R5 (`rtc-ticket/v1` link type) | Replaced by AMD-SG-I1 and AMD-SG-L1a (L1b later). |
| AMD-RW1 (cross-application visibility) | Does not arise under §5.4. |
| AMD-SG-A1 and AMD-SG-N1 (proposed in revision 0) | Withdrawn in revision 1 (§20.2, §20.7). |

### 20.9 Proposed security.md amendments (AMD-SG-S1, AMD-SG-S2)

**Not applied to security.md.** Both need security review and sign-off.

**Reconciliation note.** The review pointed at security.md "around line 224" for the position on hosted payload copies. security.md has 85 lines. The position is in two places: the security.md "Trust boundaries" paragraph (hosted 3sln infrastructure is trusted with plaintext under v0, with no end-to-end encryption claim, S1) and DEVLOG 2026-10-12, line 224 ("Direct WebRTC data channels avoid hosted payload copies"). The `data` profile introduces small hosted copies of opaque app payloads, so the custody statement needs one sentence more.

**AMD-SG-S1 (security.md "Trust boundaries"): hosted signaling copies.** Proposed text:

> Signaling ([signaling](signaling.md)) relays SDP, ICE candidates and small opaque `data` messages through the providers of both parties. These are hosted plaintext copies: held until delivered or for at most 60 s, never logged, kept in replay state only as hashes, and capped at 4 KiB per `data` message, 64 KiB per leg and an aggregate per-entity budget. Providers make no confidentiality claim for them. Bulk application bytes belong on direct peer connections, which avoid hosted payload copies. An app that needs confidentiality from providers encrypts `data` end to end, and authenticates its keys independently of the provider-certified leg keys (for example with an in-band SAS), because the providers certify those keys.

**AMD-SG-S2 (security.md "Required verification before a public beta" and sign-off checkpoints): relay byte cap.** Proposed text:

> **Hosted relay.** No `ice-relay/v1` credential is issued unless a per-owner byte cap is enforced from the relay provider's own usage data, attributing usage through the issued usernames and revoking credentials that overrun. Client-reported counts, declared sizes, reservations and admission estimates do not satisfy this gate. A TURN credential is a bearer token with no byte limit of its own.

## 21. Conformance tests

### 21.1 Required coverage

Tests MUST cover:

- **Slot and feature.**
  - The slot is processed without `bind`.
  - A brokered registration of the contract is refused.
  - `consumers` includes `provider`, and a provider feature endpoint is gated by its owner enablement.
  - `signaling.v1` `profiles` is respected: `unsupported_peer` for a missing profile.
  - Occupancy is invisible to other providers.
- **Session kinds** (AMD-SG-I1).
  - Each `session` rule: `effect`, `capability`, `max_bytes`, 8 properties, no `contact-link`, frozen `/session`.
  - A session kind in a `bintent` link is refused.
  - Context is projected to an older approved version, only after additivity.
  - No kind is fetched on a federation request path, and no kind fetch is triggered or skipped because of recipient state (§3.4).
- **Approval and routing.**
  - `open` and `register` are refused for an unapproved kind (`approval_required` with a provider-origin URL).
  - Approval removal, approval clearing and a connection ending each run §14.2: sessions and endpoints end, silently for pending invites delivered only to that app.
  - Owner-configured link configurations lose a kind only when no approved handler for it remains, and are removed when empty. The parent is never revoked.
  - A cross-entity invite reaches only the routing handler's endpoints, never another approved app.
  - The sole-approved-handler fallback, and its promotion to the explicit default when a second handler is approved.
  - No routing handler gives an owner-hook entry whose handoff opens the chooser, labelled as triggered by an incoming request.
  - Late delivery to an endpoint that registers before `answer_by`.
  - A foreign initiator's asserted `client_id` never affects routing.
  - Own-entity routing to the initiator's own app and to `target`. A `target` of another app is refused.
  - The handoff target for each routing case, including an own-entity invite whose approved initiating app has no eligible endpoint.
  - Auto-connect is refused when the `client_id` differs, or the kind is not `self`.
  - `claim` accept is refused after the approval is removed. `claim` decline still works.
- **Standing acceptance.**
  - Off by default, and refused for `self` kinds.
  - With it, `standing_accept` is projected only for admitted cross-entity invites routed to that handler. Held invites are never delivered or accepted.
  - A provider feature accepts a cross-entity session only with standing acceptance, and within its declared policy.
  - The approval page carries the availability disclosure.
- **Admission.**
  - Each basis.
  - A contact link without configuration for the kind.
  - A conditional parent: configuration refused, and a conditional link basis admits nothing.
  - The links §6.3 representation, composer and previews are identical with and without signaling configuration.
  - A non-canonical link, and a digest mismatch.
  - Exactly `uses` admitted under concurrent invites.
  - No use is spent by invites that fail certificate or signature checks.
  - A principal-bound link presented by another principal.
  - Revoked, expired and quarantined parents.
  - `none` is off by default and held.
  - Links are never delivered to endpoints.
  - A non-null `callback_digest` is invalid, and `mint_link` is not offered (§20.3.2).
- **Certificates and messages.**
  - Wrong `typ` across every certification-key profile.
  - Identity-key and `sig`-key signatures fail.
  - `aud`, `sid`, `role`, `kind` or `profile` mismatch.
  - A reused `delegate`, and renewal keeping `cnf`.
  - Exact members and high-S signatures.
  - `seq` gaps, duplicates, reuse with different payload bytes versus a re-signature over the same bytes, and the 32-message buffer.
  - The `iat` window.
  - `to` rules, including the AMD-RI3 drop with `seq` consumed.
  - Pre-claim messages other than `invite` and `cancel` are dropped.
  - `data` before the claim, over 4 KiB, over 64 KiB per leg, over the aggregate entity budget, and in a `webrtc` session.
  - Replay state holds hashes, not payloads.
  - A message from an ended leg.
- **Silence** (§8.5, §12.1). Identical initiator observations (no batch, no control) for:
  - an admitted invite, a blocked one and one with no endpoint;
  - an owner dismissal, a narrowed approval, a revoked grant, a gap failure, a reused `seq`, queue overflow and deletion, each before a claim.

  A claimed session still gets its control statement.
- **Transport.**
  - `202` with an identical body and timing class across every step 2 to 8 outcome.
  - A uniform `404` for an unknown `aud`.
  - An entity with signaling disabled answers like an enabled one, including `400` for a step-1-invalid batch, and `503` when its queue is full.
  - Two audiences give `400`.
  - The public endpoint refuses this host's own `iss`.
  - Refresh scheduling is bounded and off the request path, with lanes not depending on the response.
  - Step 2 verifies a link basis without spending. Configuration is evaluated at step 7, and the use spent at step 8.
  - The link-verified fetch exception happens only after verification.
  - Whole-batch refusal.
  - Control statements are retried until the affected certificates expire, and bypass the cross-provider kill switch.
  - Per-issuer limits across many principals from one issuer.
  - Delivery goes only to the current issuer's manifest endpoint.
  - Invite re-send happens only after a `202`, at most twice.
  - Shedding is never by claimed issuer.
- **Abuse.**
  - Every §13.1 limit kind, including the aggregate `data` budget.
  - Own-entity `open` calls count against the own-device window, not the `open` window.
  - Principal-bound invites count against `pair`, `caller`, the parent window and their own window only.
  - Own-device invites unaffected by a flood through the issuer windows.
  - A principal-bound link holder admitted while bearer-link initiators fill the shared windows.
  - The same-host share bound.
  - The pending reserve.
  - Cheap checks first: no handler-eligibility or host-wide call for blocked or unconfigured invites.
  - Per-app endpoint caps. (Link quotas and the mint window come with AMD-SG-L1b.)
- **Blocks.** Principal and provider blocks are silent, create no owner-hook entry, and end pending invites. Own-entity invites are never blocked. The own principal and own issuer cannot be blocked.
- **Owner hook** (§11.3).
  - Exactly held invites and invites with an empty routing set create entries. Signaling creates no activity item, notification or push to the owner.
  - Entries carry no context, link or payload.
  - Deletion on claim, end and `answer_by`.
  - Folding per initiator principal for local initiators, and per issuer for foreign initiators.
- **`webrtc` profile.**
  - Each §16.4 rule.
  - Candidates before the claim.
  - IP policy, and its live narrowing, enforced on the sender's `send`.
  - A `relay` endpoint connecting to a peer that sends `srflx` candidates.
  - Direct identity fetch refused under `relay` without opt-in.
  - The structural `m=` check (`audio`, `video`, `application` only).
  - Glare auto-accept only when the surviving invite is within the endpoint's own outgoing invite.
- **Relays.**
  - Credentials only for live legs, never past `answer_by` while pending, revoked at the end, never in messages.
  - The approval re-check.
  - No credential is issued without an enforced per-owner byte cap from provider usage data.
  - No-effect refusal codes.
  - `relay` policy with no relay failing visibly.
- **Lifecycle.**
  - A move ends sessions with `moved`, and messages via the old issuer fail.
  - Revocation sends `revoked` and refuses later direct posts.
  - Deletion delivers its controls before the identity tombstone.
  - A lower `aep` is refused.
- **Privacy and export.**
  - No SDP, candidates, `data`, context, credentials or links in logs or past their bounds.
  - Exact doorbell payload.
  - No endpoint data in any cross-entity response.
  - Export includes provider blocks (the `rtc/block-iss/` gap closed), link signaling configuration, and approvals with `auto_connect` and `standing_accept` in `intent-choices`. It excludes secrets, transient state and owner-hook entries.

### 21.2 Impact on the existing clean-room suite

The suite is `tests/rtc-conformance.test.mjs` (48 tests) and `tests/rtc-conformance-peer.mjs` (336 lines). The peer is written only from the rtc-signaling text and imports no 3sln.me code.

**Carries over, with renames only.** Rename `typ`, `bindle` magic, the media type, the endpoint path, `role` values, `ring_until` → `answer_by` and `purpose` → `kind`, and drop `media`. These tests then cover the same rules:
- the batch envelope, step-1 JWS profile, exact members and `iat` window;
- whole-batch refusal and high-S;
- the uniform `202` across step 2 to 8 outcomes;
- certificate verification;
- the lower `aep`;
- provider-issued certificates;
- delegate reuse;
- the SDP and candidate rules, before and after the claim;
- sender-side IP policy;
- ordering, duplicates, gaps and `seq` reuse;
- replayed invites;
- both call flows, which become "session flows";
- cancel crossing an accept;
- the first answer only;
- 5xx retries;
- `unsupported_peer`;
- the DPoP-optional manifest;
- control statements from the wrong party;
- fan-out and first claim, now within one routing handler;
- the 32-message buffer;
- the `to` rule;
- the slot request on a provider declaring the feature.

**Changes:**

| Existing test | Change |
| --- | --- |
| "§8.2 an aud naming no hosted entity answers 202" and "§8.1 RTCe-3 … two audiences" (the two todos) | They become assertions of the adopted AMD-RI1 (`404`) and AMD-RI2 (`400`). The suite should then run with 0 todos. |
| "§3.1 … rtc-signaling.v1" (two tests) | Assert `signaling.v1`, including `profiles`, and that no `intent-links.v1` declaration is required of a peer. |
| "§4.3 ticket uses …" and "§4.3 a principal-bound ticket …" | Rewritten against owner-configured contact parents (`uses`, `principal`), set by the owner, not through `mint_link`. |
| "§4.3 inbound/outbound callback …" (two tests) | Parked until AMD-SG-L1b. Meanwhile assert that a non-null `callback_digest` is invalid. |
| "§4.2 link basis …" | The same cases, with contact-link configuration in place of RTC configuration. |
| "§6.2 invite body rules: ring_until, media, context, sas_commit …" and "§6.2 only the caller leg sends sas …" | Drop the SAS cases. Add `params`, `profile` and `kind` cases. |
| "§6.2/§9.1 … ring_until beyond iat + 120 or media beyond the opened media" | Becomes `answer_by`. The media cases are dropped (§16.2). |
| "§4.4/§12 a silent owner decline, an unanswered ring and an app revocation send the caller nothing" | Kept, extended with the §8.5 causes. Its owner-decline step goes through the owner hook's dismiss rather than the RTC owner route. |
| "§9.1 the default Node bound check answers …" (divergence 1) | Becomes "kind approval is checked without a federation-shard call". The deadlock class it guarded no longer applies to kind approvals, but the test stays as a no-hang regression for contract writes. |
| "§9.1 / contracts: x-bindle-brokerable:false" | Kept, against the renamed contract document. |

**New, needed by this draft:**
- the routing tests of §21.1 (only the routing handler sees invites);
- `approval_required`;
- the `data` profile (4 KiB and 64 KiB caps, post-claim only, absent from `webrtc` sessions);
- the per-entity-enablement uniformity;
- the same-host `iss` refusal;
- owner-hook silence toward the peer;
- standing acceptance projected for a cross-entity invite;
- a conditional link basis admitting nothing.

The peer itself needs:
- the new `typ` and member names;
- `params`, and a `data`-profile client;
- no SAS.

It still must import no 3sln.me code, and be rewritten only from this text.

**Still not covered** (as today): timing uniformity under load, glare, real TLS and DNS, roster rotation under load, moves, Web Push delivery, and relay credentials.

## Appendix A: where each fix lives in this text

### A.1 RTC fixes

| Fix (source) | Section here |
| --- | --- |
| Ticket uses spent only after verification; `principal` compared with the verified certificate (review R1) | §5.3, §9.2 step 8 |
| Initiator-keyed session lookup; first verified answer becomes the leg (R2) | §9.2 step 2 |
| IP policy restricts only gathered and sent candidates (R3, R4) | §16.5 |
| Auto-accept only for the same `client_id` (R5, RTCd-6) | §5.5 |
| Bounded refresh scheduling (R6, RTCe F1, AMD-RV2) | §9.2 step 3 |
| 900 s certificate ceiling; controls retried until certificates expire (R7) | §3.1, §9.3, §14.2 |
| Canonical link verification by digest (R9, R19) | §5.2 |
| Identity URI from the directory only (R11) | §6.1 |
| Initiator warms recipient keys at `open` (R12, RTCe V2 `warms`) | §5.1, §13.1 |
| Per-issuer limits (R15) | §13.1 |
| Push endpoint screening; pushes counted (R16) | §11.2 |
| Endpoint binding by DPoP or hashed secret (R17, RTCd-8) | §10.1 |
| Cancel crossing an accept (R18) | §8.4 |
| AMD-RV1 SDP, candidate, fingerprint and signature rules | §6.3, §16.4 |
| Payload-bytes replay comparison (RTCabc-3, RTCd-3) | §7.3 |
| Asynchronous delivery; no cross-entity work in a request; bounded inbound queue and 503 (RTC-d M2, RTCd-21, RTCd-22) | §9.2, §9.3 |
| Per-peer outbox with control reserve; one `failed` reply per leg (RTC-d M3) | §8.2, §13.1 |
| Host-wide initiator window (RTC-d L1, RTCd-14) | §13.1 |
| Repeat claims only while usable; live IP-policy narrowing (RTC-d L2, L3) | §8.2, §16.5 |
| Deletion drain before tombstone; pinned peer keys (RTC-d M1, RTCd-23) | §6.3, §14.4 |
| No oracle via keys (RTCd-11) | §12.1 |
| Silent owner decline in the engine (RTCg-5, RTCs-1) | §5.5, §8.5 |
| Narrowing ends invites pending only through that app, silently (RTCe-21) | §14.2 |
| Foreign app origin "reported by" its provider (RTCe-22) | §10.3, §11.3 |
| Kill switch never suppresses controls (RTCe F2) | §9.3 |
| Invite re-send bound (RTCe F6) | §9.3 |
| Declared certificate bound for foreign peers (RTCe-11) | §6.1 |
| Pending-leg relay TTL cap; no-effect refusal codes; approval re-check before issuance (RTC-f M1(b), M2, RTCw-M4) | §16.7 |
| Relay byte cap enforced from provider usage data before any credential (RTC-f M1(d), production gate) | §16.7, AMD-SG-S2 (§20.9) |
| `unsupported_peer` (RTCi-4, AMD-RI5) and no-effect `claimed` (RTCi-5) | §5.1, §10.2 |
| `to` drop (RTCi-7, AMD-RI3) | §7.3 |
| `listen` members (RTCi-9, AMD-RI4) | §10.3 |
| One `aud` per batch (RTCe-3, AMD-RI2); uniform 404 for an unknown `aud` (RTCe-4, AMD-RI1) | §9.1, §9.2 |
| Silent ends on every pre-claim path (RTCw-H1) | §8.5 |
| Same-host `iss` refusal (AMD-RW2) | §9.2 step 1, §9.4 |
| Receiver-side pre-claim rule (RTCw-L4) | §7.2 |
| Own-device, principal-bound and same-host windows; pending reserve (RTCw-M1, R2, AMD-RW3) | §13.1 |
| Per-app endpoint cap (RTCw-M3) | §10.2 |
| Live approval checks on `send`, `renew` and relay (RTCw-M4) | §10.1, §16.7 |
| Cheap checks first (RTCw-M5, I1) | §9.2 step 7 |
| Colliding `sid` dropped (RTCw-L1) | §8.2 |
| Record folding (RTCw-L2), now per issuer for foreign initiators | §11.3 |
| Per-entity enablement invisible (RTCw-L3, R1) | §9.2 response |
| App-minted links attributed, quota'd, revoked with the app (RTCw-M2, I5, AMD-RW6) | Deferred: §20.3.2, with the narrowing rule in §14.2 |
| Provider block; own-entity exemption (RTCw-M6-1, M6-3, AMD-RW4) | §13.2 |
| Foreign-asserted app scoping (RTCw-R3, I2, AMD-RW5) | §5.4, §11.3 |
| Export gap: provider blocks (`rtc/block-iss/`) are neither exported nor excluded in the current code | §12.6, Appendix C |
| Stale owner settings could overwrite newer ones; no revision on `set-policy` or `set-contact-rtc` (bug hunt round 3, R1; the fix was reverted unshipped) | §14.1 |

### A.2 Independent review of revision 0 (fixed in revision 1)

| Finding | Fix | Section here |
| --- | --- | --- |
| H1 User-action rule blocks provider features, service entities, headless servers, conferencing | Standing acceptance per (handler, kind), off by default, with the availability disclosure. Provider features answer within their declared policy under it. | §4.1, §4.2, §4.3, §5.5, §20.1.4 |
| H2 `data` cost and scope | 4 KiB per message, 64 KiB per leg, a required aggregate per-entity budget, `data` only in the `data` profile, payload hashes only in replay state, a production gate with a cost-model row, and AMD-SG-S1 | §1.2, §3.5, §7.2, §7.3, §9.2, §13.1, §20.9 |
| H3 AMD-SG-L1 underspecified, conflicts with links §6 | Split. L1a now: owner configuration on existing parents, replacing `rtc/contact/`, forbidden on conditional parents (with reasons), links §6.3, composer and previews unchanged. L1b deferred and unavailable: `mint_link`, minted parents, delivery-off, callbacks. | §5.3, §10.2, §20.3 |
| M1 Live-approval list | Adds `claim` accept and `mint_link` | §10.1 |
| M2 Narrowing revoked owner parents | Revoke only parents minted by that app. Owner-configured parents lose the kind (when no approved handler remains), and empty configurations are removed. | §14.2 |
| M3 Callback verification | Canonical form, digest, owner equal to the verified initiator principal, else dropped silently. Retention at both providers, revoked on an unclaimed end, counted in the per-app quota. | §20.3.2 |
| M4 Sole handler | Promoted to the explicit default when a second handler is approved | §20.1.5 |
| M5 Kind resolution | Store, mirror, or a background fetch that does not depend on recipient state | §3.4 |
| M6 Authority record in intents | Stated, with explicit amendments to intents §1, §5 and §9.5, and who approves for organizations and service entities | §20.1, §20.1.4, §20.1.10 |
| M7 Appendix C gaps | Lifecycle hooks, the flag requirements and the `intent-choices` export fields | §14.2, Appendix C.2 |
| M8 Activity items | Superseded by the owner's direction: no activity items. The owner hook never interrupts, folds foreign initiators per issuer, and labels the chooser as triggered by an incoming request. | §11.3, §11.4 |
| M9 Activity evidence | Moot for signaling (no items). A system evidence profile is defined as the precondition for any later mirror. | §20.2 |
| L1 `target` | Same app only | §5.4, §10.2 |
| L2 Glare | Auto-accept only within the endpoint's own outgoing invite | §8.3 |
| L3 Addresses in `context` | Endpoint MUST NOT. Providers cannot enforce it. The §1.2 and §12.3 overclaims are fixed. | §1.2, §7.2, §12.3 |
| L4 Window numbers | Own-entity `open` calls count against the own-device window (a code change). Principal-bound windows aligned with the code. | §13.1, Appendix C.1 |
| L5 `intent-links.v1` | A local requirement, not a federation dependency | §3.1, §20.1.8, §20.5 |
| L6 Own-entity handoff target | Fixed per routing case | §5.4 |
| L7 Dark-batch drain rate | Recorded as a residual, with a SHOULD | §9.2 |
| L8 Relay byte cap | Normative rule, and AMD-SG-S2 | §16.7, §20.9 |
| L9 Step 2 wording; colliding offers | Step 2 verifies the link only. The colliding-offers rule is restored. | §9.2, §16.6 |
| L10 Appendix C files; `rtc/block-iss/` export | Added | §12.6, Appendix C |

### A.3 Owner direction received during revision 1

| Direction | Effect | Section here |
| --- | --- | --- |
| The foundation stays; calling and use semantics move to the app layer. A messaging app (Parlay) implements calling, and a call invite is a message with a JSON media type in the messaging/BindleBox spec. | Activity items and every other provider presentation removed. Only a minimal owner hook remains. AMD-SG-A1 and AMD-SG-N1 withdrawn. | §1, §3.6, §11.3, §14.1, §20.2, §20.7 |
| Intents is right in principle but may not fit every case. Two establishment modes, (a) invite-style and (b) always-on, need a spike. | Intents routing marked the leading candidate for mode (a), not final. Mode (b) described as a separate path. Spike questions S1 and S2. | §5.4, §5.6, §19.1, §19.4 |
| Intents routing needs a robust short-list. | An intents requirement for every chooser (likely candidates first, expand to all, confirm-only for one candidate), not a signaling rule | §20.1.11 |

## Appendix B: disposition of existing RTC decisions

Key: **Kept** means the decision stands, with renames only. **Changed** means its substance is carried in a different form. **Dropped** means it is not carried. Implementation-only readings that this text does not need are marked "kept (impl)" where they still apply to the migrated code.

### B.1 Design decisions RTC-1 to RTC-17

| ID | Verdict | Note |
| --- | --- | --- |
| RTC-1 Shape | Changed | The feature, the exclusive slot and `ice-relay` are kept. Purposes become intent kinds (routing provisional, SG-2), and the ticket link type is dropped with no interim type (SG-5). |
| RTC-2 AMD-X1 | Dropped | §19.1, §20.8. |
| RTC-3 Leg-key signatures | Kept | §6. |
| RTC-4 Admission bases | Changed | `link` means owner-configured, unconditional contact links only. Relation is still reserved (§5.2). |
| RTC-5 No address before the claim | Kept | §1.2, §16.4. |
| RTC-6 Relay-only default | Kept | §16.5. |
| RTC-7 Each party funds its own relay | Kept | §16.7. |
| RTC-8 No ringing, busy or presence | Kept | It is strengthened: `busy` is dropped (SG-13). |
| RTC-9 Lifetimes | Changed | Ring ≤ 120 s becomes `answer_by` ≤ 120 s. Session 24 h and certificate 120 to 900 s are kept. |
| RTC-10 SAS | Dropped | Out of core. In-band SAS is an endpoint matter (§16.6). |
| RTC-11 Limits | Kept | Reference values carry over, with renames: "ringing" becomes "pending". Added: `self` 120/h (own-entity `open` calls now count against it rather than `opens` 60/h, §13.1), `preferred` 60/h (alongside `pair`, `caller` and `issuerParent`), `sameHost` 40/h, pending reserve 2, `warms` 20/h, 8 endpoints per app, and a new aggregate `data` budget per entity (value to be set with the cost-model row). `mint` 120/h and 64 live links per app wait for AMD-SG-L1b. |
| RTC-12 Device delivery | Kept | The integration doorbell is renamed (§11.2). |
| RTC-13 No multi-party | Kept | §8.6. |
| RTC-14 Beam leaves core | Kept | Historical. |
| RTC-15 Retention | Changed | The missed list is dropped. Owner-hook entries are deleted by `answer_by` (§11.3, §12.4). |
| RTC-16 Portal ring fallback | Dropped | No provider presentation. Only the owner hook remains (SG-4). |
| RTC-17 Caller app origin | Kept | Provisional answer 6 (§19.3, SG-12). |

### B.2 Amendments

| ID | Verdict | Note |
| --- | --- | --- |
| AMD-X1 | Dropped | §20.8. extensions §13 is to be withdrawn by a later edit. |
| AMD-R1 | Changed | AMD-SG-K1. |
| AMD-R2 | Changed | AMD-SG-P1. |
| AMD-R3 | Changed | AMD-SG-E1. |
| AMD-R4 | Dropped | Replaced by AMD-SG-I1. |
| AMD-R5 | Changed | The ticket type is dropped. Contact-link configuration moves to AMD-SG-L1a, and minting and callbacks to the deferred AMD-SG-L1b. |
| AMD-R6 | Kept | Historical. |
| AMD-RV1 | Kept | Applied, §6.3, §16.4. |
| AMD-RV2 | Kept | Applied, §9.2, §9.3. |
| AMD-RL1 | Kept | §3.3. |
| AMD-RI1 to RI5 | Kept | Applied, §5.1, §7.3, §9, §10. |
| AMD-RW1 | Dropped | It does not arise (§5.4). |
| AMD-RW2, RW3, RW4 | Kept | Applied, §9.2, §13. |
| AMD-RW5 | Dropped | Mutes are dropped, and there is no signaling interruption policy for the scoping rule to apply to (§11.3). Folding foreign initiators per issuer keeps its intent. |
| AMD-RW6 | Changed | It applies to app-minted contact links once AMD-SG-L1b exists (§14.2, §20.3.2). |

### B.3 RTC-a/b/c (RTCabc)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCabc-1 SDP, candidate and batch readings | Kept | §16.4, §9.1. |
| RTCabc-2 AMD-RV1 | Kept | |
| RTCabc-3 Signature and key rules | Kept | §6.3, §7.3. |
| RTCabc-4 Purpose bodies and growth table | Dropped | Replaced by the `session` member. |
| RTCabc-5, RTCabc-6 AMD-X1 readings and review rules | Dropped | The L8 idea (re-check a stale "already approved" offer inside the approve transaction) applies to approval pages under AMD-SG-I1. |
| RTCabc-7 Flag shape | Changed | Flags are renamed (Appendix C). |

### B.4 RTC-d (RTCd)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCd-1 Records keyed by initiator | Kept | |
| RTCd-2, RTCd-21, RTCd-22 Asynchronous processing, inbound queue | Kept | §9.2, §9.3. |
| RTCd-3 Replay window | Kept | |
| RTCd-4 Held invites | Changed | Owner-hook entries (§11.3). |
| RTCd-5 Mutes | Dropped | |
| RTCd-6 Auto-accept projection | Changed | `auto_connect` for own-entity, `standing_accept` for cross-entity (§5.5). |
| RTCd-7 Decline by claim | Kept | |
| RTCd-8, RTCd-9, RTCd-20 Wire details | Kept | §10. |
| RTCd-10 Tickets apart from LinkService | Dropped | |
| RTCd-11 No oracle via keys | Kept | |
| RTCd-12, RTCd-23, RTCd-25 Deletion, pinned keys, moves | Kept | The `moved` control is still unimplemented. |
| RTCd-13 Epochs | Kept | |
| RTCd-14 Limits | Kept | |
| RTCd-15, RTCd-16, RTCd-17 Queue, long poll, gating | Kept | Flags renamed. |
| RTCd-18, RTCd-19 Eligibility and capacity preference | Changed | Eligibility means the routing set. The preference is the pending reserve. |
| RTCd-24 Full outbox for controls | Kept | |
| RTCd-rev | Kept | |

### B.5 RTC-g (RTCg)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCg-1 Owner actor; RTCg-2 uniform 404 for widening while off | Kept (impl) | |
| RTCg-3 No master switch | Kept | |
| RTCg-4 Ring eligibility | Dropped | |
| RTCg-5 Silent local end | Kept | As the engine rule (§8.5). |
| RTCg-6, RTCg-14 Ring data and principal display | Changed | The same pre-claim minimization for owner-hook entries (§11.3). |
| RTCg-7, RTCg-8 Open in app; ring delivery | Changed | The intents handoff from the owner hook (§11.4). No polling. |
| RTCg-9 to RTCg-12 Apps, automatic answers, contact links, requests | Changed | Folded into generic surfaces (§14.1). |
| RTCg-13 Confirmations | Kept (impl) | For destructive owner actions. |
| RTCg-15 Controls not offered | Dropped | |
| RTCg-16 Network privacy defaults | Kept | §16.5. |
| RTCg-copy | Dropped | |

### B.6 RTC-e (RTCe)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCe-1 Contract route | Kept | The grant ids stay on the dispatch context. |
| RTCe-2 Bound check | Dropped | Kind approval is local (SG-3). |
| RTCe-3, RTCe-4 | Kept | Applied as AMD-RI2 and RI1. |
| RTCe-5, RTCe-16 Allowlist and manifest row | Kept | Renamed. |
| RTCe-6 Controls bypass the flag | Kept | §9.3. |
| RTCe-7, RTCe-8 | Kept | |
| RTCe-9 | Kept | AMD-RV2. |
| RTCe-10, RTCe-11, RTCe-12 | Kept | |
| RTCe-13 Doorbell | Changed | Payload `t:"signal"`. One push per delivered invite, not per "alerting" invite. |
| RTCe-14 Lifecycle triggers | Changed | Triggered by approval removal and grant revocation, not bound narrowing. |
| RTCe-21 | Kept | §14.2. |
| RTCe-15, RTCe-18 | Kept | Still open. |
| RTCe-17, RTCe-19, RTCe-20 | Kept | |
| RTCe-22 | Kept | In the `listen` projection and the owner hook. |
| RTCe-resid, RTCe-open | Kept | The integration doorbell is renamed. |

### B.7 RTC service follow-ups (RTCs)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCs-1 to RTCs-5 Silent end | Kept | Reached through the owner hook's dismiss. |
| RTCs-6 Alert recomputation | Dropped | There is no alert. |
| RTCs-7 Caller origin | Kept | RTC-17. |
| RTCs-8 Narrowing route | Changed | Removing a kind approval is an intents-settings action. |

### B.8 RTC-f (RTCf)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCf-1 to RTCf-14, RTCf-rev, RTCf-open | Kept | "Ringing" reads "pending". The approval check uses kind approval. The values are provider policy. The spend-authority byte-cap production gate is now a normative rule (§16.7) with a proposed security.md gate (AMD-SG-S2). |

### B.9 RTC-i (RTCi)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCi-1 Dispatch-context approval | Changed | Only grant liveness travels on the context. Kind approval is local. |
| RTCi-2 Account-local approval record | Dropped | It is not needed without bound options. |
| RTCi-3 to RTCi-8 | Kept | RTCi-8 applies to the renamed first-party contract. |
| RTCi-9 `listen` members | Changed | New member names (§10.3). |
| RTCi-10 App removal outside the gate | Kept (impl) | A general fix. |
| RTCi-11 Relay actor approval | Changed | The relay checks kind approval locally. |
| RTCi-open | Changed | `temporarily_unavailable` remains open. Purpose-context contract versioning becomes kind-version projection. |

### B.10 RTC wargame (RTCw)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCw-H1, RTCw-L4 | Kept | |
| AMD-RW2 | Kept | |
| RTCw-M1, RTCw-R2 | Kept | |
| RTCw-M3 | Changed | The per-app cap is kept. Round-robin across apps is dropped (one routing app). |
| RTCw-M4 | Kept | |
| RTCw-M5, RTCw-I1 | Kept | |
| RTCw-L1 | Kept | |
| RTCw-L2 | Changed | Owner-hook folding, per issuer for foreign initiators. |
| RTCw-L3, RTCw-R1, RTCw-I3 | Kept | |
| RTCw-L5 Ticket pruning | Changed | Applies to app-minted links (deferred, AMD-SG-L1b). |
| RTCw-info | Kept | Handles are unsupported for `open` on this host, and re-registration after revoke is allowed. |
| RTCw-M2-1, M2-3 | Changed | Apply to app-minted links (deferred). M2-3 now revokes only that app's minted parents; owner-configured parents lose the kind (§14.2). |
| RTCw-M2-2, RTCw-I5 | Changed | A link quota and mint window per app, with AMD-SG-L1b. |
| RTCw-M2-4 Legacy tickets | Dropped | |
| RTCw-M2-5, RTCw-I6 | Changed | Bulk revoke per app in the links view. |
| RTCw-M6-1 | Kept | |
| RTCw-M6-2, RTCw-R3 | Changed | Mutes are dropped. R3's routing half is kept (§5.4). Its mute-scoping half has nothing left to apply to. |
| RTCw-M6-3 | Kept | |
| RTCw-M6-4 Ring controls | Dropped | Replaced by the owner hook's actions. |
| RTCw-M6-5 | Changed | Generic surfaces. |
| RTCw-copy | Dropped | |
| RTCw-resid | Kept | |

## Appendix C: migration plan (non-normative)

**No data migration is needed.** Evidence:
- Every RTC flag (`RTC_SIGNALING_ENABLED`, `RTC_FOREIGN_ENABLED`, `RTC_TICKETS_ENABLED`, `RTC_TURN_ENABLED`) has no `envDefault` in `packages/flags/registry.mjs`, and none is set in `wrangler.jsonc`, `wrangler.local.jsonc`, the Node server or the Worker sources (checked 2026-10-27).
- `RTC_FOREIGN_ISSUERS` is empty by default, and no spend authority ships.
- Nothing is published: the `spec.bindle.example` documents are placeholders.

The storage families are:
- **Owner data:** `rtc/policy`, `rtc/block/`, `rtc/block-iss/`, `rtc/mute/`, `rtc/contact/`, `rtc/missed/` and `rtc/ticket/`.
- **Endpoint secrets:** `rtc/ep/`.
- **Transient:** `rtc/epq/`, `rtc/out/`, `rtc/in/`, `rtc/outbox/`, `rtc/inq/`, `rtc/relay/` and `rtc/closed`.
- **Derived:** `rtc/dlv/`, `rtc/dlg/`, `rtc/limit/`, `rtc/aep/`, `rtc/outbox-seq`, `rtc/inq-meta`, `rtc/approval/` and `rtc/relay-use/`.
- **Federation shard:** AMD-X1 `bound` members on grants. These exist only where `EXTENSIONS_ENABLED` and the RTC flags were on.
- **Host abuse store:** the `rtc/inbound` per-network limiter scope (`packages/runtime/routes/rtc.mjs`, `admitSourceNetwork`). It is transient window state.

Their fate: `rtc/contact/` becomes link signaling configuration on the parent (AMD-SG-L1a). `rtc/missed/`, `rtc/mute/`, `rtc/ticket/` and `rtc/approval/` are dropped. The rest are renamed.

So rows can exist only in local development and test stores. For example, the round 3 browser bug hunt ran a local Worker with `RTC_SIGNALING_ENABLED` and `RTC_TICKETS_ENABLED` on (DEVLOG 2026-10-27). A one-time cleanup step, or a dev reset, is enough. No owner data needs conversion.

**Export gap (pre-existing).** `rtc/block-iss/` is neither exported nor excluded in `packages/runtime/export-contributors.mjs`: the `rtc` contributor claims `rtc/block/`, and that prefix does not match `rtc/block-iss/`. The renamed provider-block family must be exported (§12.6).

### C.1 `packages/rtc` (rename to `packages/signaling`; the owner's choice)

| File | Plan |
| --- | --- |
| `jws.mjs` | Keep. Update the `typ` list. |
| `messages.mjs` | Reduce and split into a generic envelope and types (`answer_by`, `kind`, `profile`, `params`, `callback_digest` always `null`; no SAS, `busy` or `media`), plus profile validators: `webrtc`, which keeps every SDP and candidate rule but only the structural `m=` check, and `data`, which owns the `data` type (4 KiB per message, 64 KiB per leg). |
| `certificates.mjs` | Keep. Renames (`role`, `kind`, `profile`, `client.feature`). |
| `extension.mjs` | Reduce. Slot manifest without `bind` or options, `consumers` with `provider`, a feature validator with `profiles`. Remove the AMD-X1 bound-artefact table. |
| `purposes.mjs` | Remove. Session-kind validation (`session` member) moves to `packages/intents/schema.mjs`, and projection reuses `packages/intents/project.mjs`. |
| `sessions.mjs` | Keep. Rename `ringing` to `pending`. Bounds stay. Replay state stores payload hashes only. |
| `admission.mjs` | Reduce. Remove the mute kinds and alert. Keep the blocks (principal and issuer), limits and windows (`inviteLimits` already matches §13.1 for principal-bound invites). Add the aggregate `data` budget. Eligibility becomes the routing set, read from intents memory. |
| `tickets.mjs` | Remove. Its replacement is owner-side signaling configuration on LinkService contact parents (`packages/links`, AMD-SG-L1a), refused on conditional parents. `minted_by`, quotas, minting and callbacks wait for AMD-SG-L1b. |
| `service.mjs` | Reduce. Remove the missed list, mutes, alert recomputation, ticket operations and RTC owner reads tied to the ring. Add the routing set and handoff target, late delivery, the owner hook, standing acceptance, the live approval check on `claim` accept, and approval checks from intents memory. Change `open`: own-entity opens take the `self` window, not `opens` (§13.1, L4). |
| `federation.mjs` | Keep. Renames. |
| `relay.mjs` | Keep. The approval check uses kind approval. Issuance stays refused until the spend authority enforces a per-owner byte cap from provider usage (§16.7). `scripts/cost-model.mjs` imports it (see C.2). |
| `relay-credentials.mjs`, `turn.mjs` | Keep. `relay-credentials.mjs` is used only by `beam-retirement.mjs`; remove it with `beam-retired-v2`. |

### C.2 Runtime, routes, federation and other packages

| File | Plan |
| --- | --- |
| `packages/app/domains/rtc.mjs` | Rename to `signaling.mjs`. Reduce the operation lists (no ticket, mute, missed or narrow operations). |
| `packages/runtime/account/rtc.mjs` | Reduce. Remove `rtc/approval/`, `narrowedApproval` and the bound copying into actors. Keep the contract actor (grant ids), peer, listen, drain, relay and the roster. |
| `packages/runtime/routes/rtc.mjs` | Keep the logic: step 1 at the route, dark ingest, the same-host `iss` refusal, shedding. Rename the path and media type, and the `rtc/inbound` limiter scope in the host abuse store (to `signaling/inbound`). |
| `packages/runtime/routes/rtc-owner.mjs` | Mostly remove. Drop `GET /api/rtc/ring`, missed, mute, tickets and `narrow-app`. Keep minimal owner routes for the IP policy and requests, principal and provider blocks, end-session, revoke-endpoint, the owner hook (read, dismiss, block, hand off) and auto-connect. Link configuration moves to the links routes, and approvals and standing acceptance to the intents routes. |
| `packages/runtime/routes/index.mjs`, `packages/runtime/account/index.mjs` | Rename the `rtc` and `rtc-owner` route imports and the `rtc` account slice. |
| `packages/runtime/routes/intents.mjs`, `packages/intents/*` | Extend: session kinds, approvals with `auto_connect` and `standing_accept`, the routing default with sole-handler promotion, the chooser short-list, and the `bsession` handoff (AMD-SG-I1). |
| `packages/links/*` | Add owner-side parent signaling configuration (AMD-SG-L1a), refused on conditional parents, leaving the §6.3 representation unchanged. Nothing for minting or delivery-off until AMD-SG-L1b. |
| **Lifecycle hooks** (intents, connections, federation) | Removing or clearing a session handler approval (§20.1.4), and an app connection ending for any reason, each call the signaling §14.2 narrowing. These two hooks replace `narrowBoundOptions` and the RTC grant-changed path. Slot-grant revocation keeps a generic grant-changed hook into the same narrowing. |
| `packages/runtime/federation.mjs` | Reduce. Rename the manifest rows. Remove `rtcBoundArtefacts` and bound resolution. Keep the descriptors. |
| `packages/federation/extensions.mjs`, `service.mjs`, `runtime.mjs`, incremental | Remove AMD-X1: `bind`, bound options, `narrowBoundOptions` (controller, remote, Worker allowlist), `boundApproval`, `checkBound`, `dispatchBound` and the incremental refusal. Keep a generic grant-changed hook for slot-grant revocation, and keep `NO_EFFECT_CODES`. |
| `packages/runtime/artefact-pins.mjs` | Remove the four `rtc-purpose` operator documents. Keep the first-party contract under its new id. |
| `packages/runtime/export-contributors.mjs` | Drop the `rtc/missed/`, `rtc/mute/`, `rtc/ticket/` and `rtc/approval/` rows. Export provider blocks (closing the `rtc/block-iss/` gap). Move `rtc/contact/` into the links parent configuration export. Rename the families. Extend the `intent-choices` row's claimed fields (today `kind default excluded ignored`) with the session handler approval fields: `approvals` (handler, `version`, `digest`, approval time), `autoConnect` and `standingAccept`. |
| `packages/flags/registry.mjs` | `RTC_SIGNALING_ENABLED` → `SIGNALING_ENABLED`, requiring `INTENT_APP_HANDLERS_ENABLED` (which itself requires `INTENT_LINKS_ENABLED` and `CLIENT_METADATA_ENABLED`) besides its current requirements. The review also asked for `ACTIVITY_V2_ENABLED`, because revision 0 presented invites as activity items. Under the owner's later direction signaling creates no activity items, so that requirement is dropped unless an activity mirror (§20.2) is adopted. `RTC_FOREIGN_ENABLED` → `SIGNALING_FOREIGN_ENABLED`. Retire `RTC_TICKETS_ENABLED` into `RETIRED_FLAGS`. Keep or rename `RTC_TURN_ENABLED`. Rename `RTC_FOREIGN_ISSUERS`. |
| `apps/node/resources.mjs`, `apps/worker/objects.mjs` | Remove `RTC_BOUND_CHECK` (kind approval is local). Rename `RTC_EGRESS` and the `RTC_FOREIGN_ISSUERS` allowlist wiring. |
| `apps/worker/federation.mjs`, `apps/worker/index.mjs` | Rename the `rtcOccupant` mount (and its use in `packages/runtime/federation.mjs` descriptors). |
| `scripts/cost-model.mjs` | Follow the `relay.mjs` rename (it imports `RELAY_PLAN_BYTES` and `RELAY_LIMITS`). Add the `data` row needed by the §3.5 production gate. |
| `docs/artefacts/rtc-purposes/*` | Remove. They become app-published kinds. The device-sync example is optional. |
| `docs/artefacts/rtc-signaling-v1.json` | Replace with `signaling-v1.json`. |
| `packages/runtime/account/contact-profile.mjs` | Its `rtc/turn.mjs` import is a Beam leftover (TURN revocation for `beam-retired-v1`). Remove it with `beam-retired-v2`. |

### C.3 Web UI and catalogues

| File | Plan |
| --- | --- |
| `apps/web/src/ui/rtc-ring.mjs`, `apps/web/src/bl/rtc-ring-poll.mjs` | Remove. |
| `apps/web/src/ui/rtc-settings.mjs`, `apps/web/src/bl/rtc-settings.mjs` | Remove the "Calls & connections" view and the `calls` portal module. Re-home the generic controls (§14.1) into app access, Devices, Links, Privacy and the blocked lists. |
| `apps/web/src/ui/authorize-entry-consent.mjs` | Remove the bound-options consent. Add the session-kind approval rows if approvals are offered at authorization. |
| `apps/web/src/release.mjs`, `apps/web/src/ui/release-dialogs.mjs`, `apps/web/src/shared/portal-modules.mjs`, `apps/web/styles.css` | Remove the RTC hunks. |
| `packages/i18n/catalogues.mjs`, `authorize-catalogue.mjs` | Remove most of the about 157 RTC strings per locale (107 + 11 + 36 + 3). Add neutral strings for the owner hook, standing acceptance (with its availability disclosure), the chooser short-list and the re-homed settings. |

### C.4 Tests

| Test | Plan |
| --- | --- |
| `rtc-messages`, `rtc-certificates`, `rtc-federation`, `rtc-federation-runtime`, `rtc-runtime`, `rtc-review-followups`, `rtc-relay`, `rtc-relay-credentials`, `cost-model-relay`, `rtc-bound-default` (no-hang part) | Keep, retargeted to the renames. |
| `rtc-engine`, `rtc-wargame` | Keep most. Retarget the ticket, mute and missed cases to link configuration, the owner hook and blocks. Replace the round-robin cases with routing cases. Add standing acceptance, the `data` budget and the own-device `open` window. |
| `rtc-tickets`, `rtc-tickets-spam` | Rewrite as owner link-configuration tests (uses, principal, conditional-parent refusal, narrowing, provider block). The quota and mint cases wait for AMD-SG-L1b. |
| `tests/helpers/rtc-fixture.mjs`, `tests/helpers/rtc-settings-fixture.mjs` | Rename `rtc-fixture.mjs`. Remove `rtc-settings-fixture.mjs` with the settings view, or reduce it to the re-homed controls. |
| `rtc-purposes` | Replace with intents session-kind tests. |
| `extensions-bound-options`, `browser/consent-bound-options` | Remove with AMD-X1. |
| `rtc-owner-routes`, `rtc-owner-followups` | Reduce to the remaining owner routes and the silent end. |
| `browser/rtc-settings*` | Remove. New browser tests are needed for the re-homed controls, the owner hook, the standing-acceptance disclosure and the chooser short-list. |
| `rtc-conformance*` | §21.2. |

### C.5 Order

1. The establishment spike (S1, S2, §19.4), then owner sign-off of the routing choice (SG-2, SG-21) with AMD-SG-I1 and L1a.
2. Intents session kinds, approvals, standing acceptance and the chooser short-list.
3. Links owner-side signaling configuration (L1a).
4. Engine reduction and renames, including the owner hook, the `data` profile limits and the own-device `open` window.
5. Remove AMD-X1 and wire the lifecycle hooks.
6. UI re-homing.
7. Conformance peer rewrite.
8. Docs: the design doc and the pending-signoffs digest.
9. Later, after the links §6 re-scope: AMD-SG-L1b (minting, delivery-off, callbacks).

Each step is reversible while flags stay off.
