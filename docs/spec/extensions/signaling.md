# Signaling (`signaling.v1`) — normative draft

> **Group:** Bindle extension
>
> **Status:** draft, revision 3.2; the engine phase is implemented locally behind default-off flags (2026-10-28), with Appendix C.5 steps 6 to 8 and the provider pages outstanding; nothing is published, deployed or production-verified. It supersedes [RTC signaling](../superseded/rtc-signaling.md) pending owner sign-off; every decision is provisional.
>
> **Covers:** a generic signed session channel between endpoints: `self`, `pairing` and `offer` bases, pairings, offers and the ICE relay fragment.
>
> **Does not cover:** calls and call invitations ([Bindle Messaging §5.5](messaging.md) and the Parlay app); app sign-in on devices ([device authorization](device-authorization.md)); local clients ([local clients spike](../../architecture/local-clients-spike.md)).

Status: **draft, 2026-10-27, revision 3.2. The engine phase is implemented locally behind default-off flags (2026-10-28, Appendix C.5 steps 2 to 5; provisional, unsigned).** Steps 6 to 8 (conformance peer rewrite, enrolment approval page, docs) and the provider pages for approvals, pairing creation and activation and service designation are outstanding; nothing is published, deployed or production-verified. It replaces [RTC signaling](../superseded/rtc-signaling.md) (`rtc-signaling.v1`), which is **superseded by this draft, pending sign-off**; the local `rtc-signaling.v1` code and its interim extension identity are retired. Appendix C plans the move. Revision 3 is written against [extensions revision 3.2](../extensions.md) (draft, unsigned): a `{spec, options}` declaration, two fragments and no slots. It applies extensions change request CR-X3-03 here (§3.1 to §3.3, §4.2, §6.1, §20.1.4). Every decision here is provisional (coordinator) and **not signed off by the owner**. The decisions are SG-1 to SG-51 in §19.2. The owner said provisional decisions may be adopted for now without sign-off, so the owner questions carry provisional answers in §19.3 to §19.5. The decision records are in [DEVLOG](../../../DEVLOG.md), 2026-10-27: "Generic signaling.v1 spec draft (replaces calling-shaped RTC)" (revision 0), "signaling.v1 spec rev 1 (review fixes)" (revision 1; Appendix A.2), "signaling.v1 spec rev 2 (offer and pairing bases)" (revision 2; Appendix A.4), "signaling.v1 spec rev 2.1 (rev 2 review fixes)" (revision 2.1; Appendix A.5), "signaling.v1 spec rev 3 (core-scope cut, extensions rev 3, pairing consent)" (revision 3; Appendix A.6 maps each applied change request to its section) "signaling.v1 spec rev 3.1 (rev 3 review fixes; open offers)" (revision 3.1; Appendix A.7) and "signaling.v1 spec rev 3.2 (rev 3.1 verification fixes)" (revision 3.2; Appendix A.8). Revision 2.1, with the history of revisions 0 to 2.1 (former Appendix A.1 to A.5) and the bodies of amendments withdrawn since, is frozen in [superseded/signaling-rev2.1.md](../superseded/signaling-rev2.1.md). Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

**Owner direction (2026-10-27, verbatim):** "I only intended for a general signaling mechanism, app to app, user to user, provider to provider, etc; something flexible enough for all use cases, but I didn't intend to build actual calling into bindle, that's an app level concern." And: "Core bindle should be about identity, preferences, intents, and resources; a hub for connecting things together."

**Owner direction (2026-10-27, as relayed to this revision):** "Core signaling should be unaware of calls, contacts etc.; it provides the primitives apps need; it should not spec or implement app-level features." Intent kinds are public, URL-identified artefacts, and core hard-codes none.

This document defines a Bindle-owned extension ([extensions §1](../extensions.md#1-model), §2.8) with the spec URL `https://spec.bindle.example/extensions/signaling/v1`. It has:
- a provider **declaration**, `{spec, options}` (§3.1);
- two **fragments**, `…/fragments/signaling/v1` (§3.2) and `…/fragments/ice-relay/v1` (§3.3), each filled by a built-in resource that the provider supplies;
- no provider feature of its own, no artefact kind, no link type and no slot.

It reuses existing primitives:
- **What a session is for** is a **session kind**: an [intent kind](intents.md#4-intent-kinds) with a `session` member, published by an app or anyone else. This document registers none.
- **Who may open a session, and which app receives it,** depends on an explicit **establishment basis** (§5.6): `self` (own devices), `pairing` (a per-edge owner record that pre-authorizes two apps, or an app and one peer, for a kind) or `offer` (an expiring, revocable dial-back authorization that an app mints and hands out, bound to named principals or open to any verified principal). Every basis fixes the receiving app; nothing consults an intents default.
- **Presentation and use semantics** are the app's. The provider presents nothing about invites.

The intents and device-authorization changes this needs, and two security.md statements, are written as proposed, unsigned amendments in §20. None of those documents is edited by this draft.

**Intents supply kinds and approvals, not routing.** Signaling reuses intents only for session kinds and per-app session handler approvals (§3.4, §20.1). An incoming invite never reaches a chooser: an `offer` invite goes to the minting app, a `pairing` invite to the paired app, and an own-entity invite to the initiating app or a named `target` endpoint (§5.4).

It defines interoperability rules only: no presentation, no use vocabulary, no chooser layout and no SDK behaviour.

## 1. Scope, model and guardrails

### 1.1 What it is

A **signed session channel** between two **endpoints**. An endpoint is an application instance on one device, or a provider feature, acting for an entity. The channel carries a short exchange: invite, claim and answer, a bounded negotiation, end. After that the endpoints talk directly or through relays. A **profile** (§3.5) defines any transport-specific negotiation. This version registers two:
- `webrtc`: the WebRTC offer, answer and candidates (Annex A, §16).
- `data`: no transport negotiation, only small, bounded, opaque `data` messages after the claim. Uses include rendezvous, key agreement for app-level end-to-end encryption, and device pairing. It is not a transfer channel: bulk bytes belong on a direct connection that the endpoints set up themselves.

What a session is for (for example remote control, file sync, device pairing or an app-defined media session) is an **app-level** matter. It is named by a session kind that an app or anyone else publishes. The provider never interprets it beyond its schema.

- **Path.** An endpoint talks only to its own entity's provider, through the signaling contract (§10). Providers talk to each other only through the declared endpoint (§9). No endpoint ever contacts the peer's provider to signal.
- **Authentication.** Every message is signed end to end by a per-session **leg key** held by the sending endpoint. The sender's provider certifies that key with a **leg certificate** (§6). Providers relay messages unchanged and verify the same signatures endpoints do.
- **Consent.** An initiator reaches a recipient only on an admission basis (§5.2). The invite reaches only the endpoints of one app, fixed by the basis: the paired app, the app that minted the offer, or for an own-entity invite the initiator's own app or the paired app its `target` names (§5.4). A session connects only after one of those endpoints **claims** it (§8.2). Before that claim, nothing reveals whether the recipient has any endpoint, is online, admitted the initiator or blocked it (§12.1).

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
4. **No history.** No provider keeps message content after delivery, or any owner-visible record of invites.
5. **No multi-party.** A session has exactly two legs. There is no group member, and no fan-out after the claim (§8.6).
6. **No pre-claim payload.** Before the claim, only the invite's schema-validated `context` and the profile's pre-claim parameters travel (§7.2, §16.3). Opaque `data` is post-claim only. Providers enforce the address rules for profile parameters (§16.4). They cannot enforce them for `context`: schema validation does not detect an address in an app-defined field, so keeping addresses out of `context` is an endpoint requirement (§7.2), not a provider guarantee.

**Non-goals.** Relaying session content beyond the bounded `data` messages, recording, interconnect with other networks, presence, reachability guarantees, and sessions that act for no entity (§4.3).

## 2. Terms

| Term | Meaning |
| --- | --- |
| Entity, principal | As in [protocol §1](../protocol.md#1-model-and-custody). A principal is `(iss, sub)`. Relationships are keyed by **origin principal** ([identity portability §8.1](identity-portability.md#81-stable-identifier)). |
| Endpoint | A registration, at the entity's provider, of one application connection on one device instance, or of one enabled provider feature (§10.1). Endpoints are provider-local and never disclosed to other entities. |
| Initiator, recipient | The two parties of a session. The initiator sends the invite. |
| Session | One attempt to connect an initiator endpoint with one recipient endpoint. It is identified by `sid` and keyed by (initiator origin principal, `sid`). |
| Leg | One endpoint's participation in one session: its leg key, certificate and message sequence. A session has one initiator leg and at most one claimed recipient leg. |
| Session kind | An intent kind whose body carries a `session` member (§3.4, §20.1). Kinds are public, URL-identified artefacts. This document registers none. |
| Provider feature | The provider feature of some extension ([extensions §4.2](../extensions.md#42-provider-features)), identified by (issuer, that extension's spec URL), that consumes the signaling fragment through a grant (§4.2). |
| Approved handler | An app, or a provider feature, that the owner approved to start and answer sessions of a kind (§20.1.4). |
| Basis | What admits an invite at the recipient provider, and which app it is routed to (§5.2, §5.6). |
| Offer | An expiring, revocable authorization, minted by the recipient-to-be's provider for one of its apps or features, that lets one named principal open one session (a **bound** offer, single-use) or any verified principal open up to `uses` sessions (an **open** offer) of one kind and profile back to that app (§5.7). |
| Service-class endpoint | An endpoint of a provider feature (§4.2), or an app endpoint of a **service entity**: an organization entity ([organizations §3](organizations.md#3-organization-entities)) whose owner has designated it a service entity (§4.3). Nothing else is service-class: not a person entity's apps, not an undesignated organization's apps, and never an endpoint registered in member context ([organizations §7](organizations.md#7-member-context-for-applications)). Only service-class endpoints may mint offers that last longer than 900 s, and their offers belong to the minting app or feature, not to one endpoint (§5.4 case 3, §5.7). |
| Pairing | A per-edge owner record between exactly two parties. It pre-authorizes one app (or one enrolled client session of it) to connect automatically, for one kind, with one other app of the owner or with one peer principal (§5.8). Connecting one app to several others takes several pairings. |
| Claim | The atomic, first-wins answer (accept or decline) by one recipient endpoint (§8.2). |
| Pending | An admitted invite that is not yet claimed, cancelled or past `answer_by`. |
| Profile | A registered transport negotiation (§3.5). |

## 3. Building blocks

### 3.1 Extension declaration

A provider whose entities can hold sessions with entities at other providers declares, in its manifest `extensions` array ([extensions §2.1](../extensions.md#21-the-extensions-array)):

```json
{"spec": "https://spec.bindle.example/extensions/signaling/v1",
 "options": {"endpoint": "https://provider.example/bindle/signaling",
             "max_leg_certificate_seconds": 600, "profiles": ["data", "webrtc"]}}
```

| Option | Value | Meaning |
| --- | --- | --- |
| `endpoint` | A URL on the issuer origin. It is an **audience** endpoint option ([extensions §2.4](../extensions.md#24-options)). | The provider accepts §9 batches here. It sends batches only to peers' declared `endpoint`. |
| `max_leg_certificate_seconds` | An integer from 120 to 900. | The longest leg certificate it issues (§6.1). |
| `profiles` | A nonempty, unique, ascending subset of the registered profile ids. | The profiles it relays and validates (§3.5). |

The descriptor is the one in [extensions §2.3](../extensions.md#23-descriptor). The manifest `contracts` list `…/contracts/signaling/v1` and `…/contracts/ice-relay/v1`, which the provider's built-in resources implement ([extensions §5.2](../extensions.md#52-built-ins)).

**Prerequisites**, checked as in [extensions §2.5](../extensions.md#25-processing-and-bounds): exactly one entry for the directory extension (`…/extensions/directory/v1`, [organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1)) and exactly one for the artefact-versions extension (`…/extensions/artefact-versions/v1`). If either is missing, the declaration is absent for that processor.

Without a valid declaration, a provider's entities can hold sessions only with entities on the same provider, if it supplies the built-in signaling resource at all. The declaration confers no authority.

**Local requirement, not a federation prerequisite.** A provider that supplies the built-in signaling resource MUST implement session kinds and session handler approvals (AMD-SG-I1, §20.1) for its own entities, under the intents extension. That is local behaviour. A peer provider MUST NOT check a peer's intents or intent-links declaration, or refuse a peer for lacking one. Nothing a peer does depends on how the other side stores approvals.

### 3.2 The signaling fragment

```json
{
  "id": "https://spec.bindle.example/fragments/signaling/v1",
  "title": "Signaling",
  "description": "Lets an app or a provider feature set up direct connections between your devices and other people's, for the kinds you approve.",
  "publisher": "https://spec.bindle.example",
  "fields": {
    "signaling": {
      "title": "Signaling service",
      "type": "resource",
      "cardinality": {"min": 0, "max": 1},
      "contracts": ["https://spec.bindle.example/contracts/signaling/v1"],
      "selection": "exclusive",
      "consumers": ["application", "provider"]
    }
  }
}
```

- **Candidate.** The provider's built-in signaling resource, a candidate in each owner's pool. Only the owner assigns it (protocol §3 owner floor; [extensions §5.2, §5.3](../extensions.md#53-assignment-and-disclosure)).
- **Contract.** It declares `"x-bindle-brokerable": false` at its root. Only the entity's own issuer can certify leg keys, so the field has only issuer-hosted candidates ([extensions §5.1](../extensions.md#51-candidates)), and no integration can supply it in this version.
- **Consumers.** `application` and `provider`:
  - An application requests the fragment, pinned by `digest`, with the methods it needs. The grant says *that* the app may use signaling. *Which kinds* it may use is the owner's handler approval (§20.1.4), which the built-in resource checks live on every operation.
  - A provider feature consumes it under extensions §4.2 (§4.2 here).
- There are no per-consumer options. Every grant, disclosure, revocation, no-oracle and pinning rule of protocol §3 and §4 and extensions §3 to §5 applies.

### 3.3 The ice-relay fragment

`https://spec.bindle.example/fragments/ice-relay/v1` carries what [rtc-signaling §3.3](../superseded/rtc-signaling.md#33-the-ice-relay-slot) defined as a slot, restated as a fragment:
- one `resource` field `relays`, `cardinality` 0 to 4, contract `…/contracts/ice-relay/v1`, `selection: "ordered"` (failover only before dispatch, [extensions §3.3](../extensions.md#33-failover-for-ordered)), `consumers: ["application", "provider"]`, no options;
- one method, `credentials({sid?})` → `{ice_servers, expires_at}`, a write effect. Brokered relay resources are allowed.

Carried rules:
- **AMD-RL1.** The built-in relay resource also takes `endpoint` and, for an endpoint registered without DPoP, `endpoint_secret`, bound as in §10.1. `sid`, `endpoint` and `endpoint_secret` are sent only to the built-in resource, never to a brokered one.
- **Disclosure.** A relay resource sees its own entity's endpoint addresses and peers' relay addresses, and learns when sessions happen.

§16.7 defines how endpoints use relays.

### 3.4 Session kinds

What a session is for is a **session kind**: an intent kind ([intents §4](intents.md#4-intent-kinds)) whose body has the `session` member defined by AMD-SG-I1 (§20.1). The kind's existing members give everything the old `rtc-purpose` had except its presentation policy:
- the title, summary and publisher;
- the `data` schema and `disclosure`, which become the invite **context** and its disclosure;
- the sensitivity categories;
- the growth table and versioning.

The `session` member adds:
- `parties`: `self` (own devices only), `other` (other entities only) or `any`;
- `profiles`: the profiles a session of this kind may use, each with its profile-defined parameters. Both registered profiles take `{}` (§3.5, §16.2);
- `bases` (optional): the establishment bases a session of this kind may use, a nonempty, unique subset of `self`, `pairing` and `offer`. When it is absent, every basis is allowed. For example, a remote-control kind declares `["self", "pairing"]`, so that no offer can ever reach a daemon, and a kind used only for requests carried in an app's own messages declares `["offer"]`. Both providers enforce it (§5.1, §9.2 step 7). `none` is reserved (§15) and invalid here.

A kind carries no presentation, acceptance or content policy. What a connection carries (for example the media of an app-defined media session) is the endpoints' concern: it is decided in the app's own messages and, under `webrtc`, in the SDP the endpoints exchange (§16.2). A kind is referenced as an artefact reference `{artefact, version, digest}` ([artefacts §5](../artefacts.md#5-references)). Providers resolve kinds only under artefacts §7 and §8, and never fetch a kind on the path of a request from another provider (§9.2).

**Where a recipient provider gets a kind version.** A recipient provider resolves the kind version named in an invite only from:
- its own artefact store, including versions pinned by its entities' approvals;
- a mirror under artefacts §8;
- a background fetch whose triggering and timing do not depend on any recipient's state. That is either a periodic refresh of the kind lines pinned on the host, or a fetch scheduled for every step-1-valid invite that names a version the provider does not hold, whatever steps 2 to 8 later decide. Both run under per-line and global fetch budgets, with negative caching.

It MUST NOT fetch, or decide to fetch, a kind because a particular recipient has an approval, an endpoint, a pairing or any other state. An invite whose kind version is not held is not delivered (§9.2 step 7). The fetch that the invite may have scheduled helps only later invites.

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

A provider relays only the profiles it lists in its declaration's `profiles` option (§3.1). A new profile is added by a revision of this document, never by a kind or an app.

**Production gate for `data`.** A provider MUST NOT declare `data` in `profiles` in production until all of these hold:
- the aggregate `data` budget per entity (§13.1) is enforced and tested at the engine level;
- the cost model has a row for relayed `data` bytes: the worst case per plan at the aggregate budget, beside the existing relay rows in `scripts/cost-model.mjs`;
- the custody statement for hosted `data` copies (AMD-SG-S1, §20.9) is reconciled with security.md and signed off.

### 3.6 What the provider does not do

A provider implementing this document MUST NOT:
- present an invite to a person on its own, or notify or interrupt anyone about it;
- keep any list of unanswered or refused sessions;
- define interruption policy for sessions;
- interpret a kind's meaning;
- compute or display short authentication strings.

It MAY show the owner controls of §14 in its own interface.

## 4. Parties and consumers

### 4.1 Cases

| Case | How it is met |
| --- | --- |
| Own devices | `self` basis (§5.2). Routed to the initiator's own app, or to a named `target` endpoint (§5.4). Raw host candidates are allowed under `webrtc` (§16.4). The owner's auto-connect setting applies (§5.5). Two different apps of the owner (for example a vendor's daemon and its web app) connect automatically under an own-entity pairing (§5.8). |
| Requests between people, carried in an app's own messages | A bound `offer` (§5.7): the app that asks mints an offer per invited principal and sends it inside its own app message. The invited party's app dials back with it after a user action, and the asking app claims without a further prompt. A short-lived open offer covers an audience the app cannot list by principal (for example a code shown in person). |
| Always-on wiring with a known peer | A cross-entity pairing on both sides (§5.8): the relation basis, with a direction (`opens`) and a mandatory expiry. |
| User to user, same provider | The same-host transport (§9.4): the full verification path, with no public endpoint. |
| User to user, cross provider | The declared `endpoint` (§9), held keys and the uniform response. |
| App to app | Any two approved handlers of the same kind, of the same entity or of different entities. The kind names the use. The `data` profile covers apps that need no `webrtc` connection. |
| Provider endpoints | A provider feature consuming the signaling fragment (§4.2) is an endpoint for one of its hosted entities, and can be either party. Across entities it answers only offers it minted, bound or open (§5.5). It is never a pairing party (§5.8). |
| Headless app clients (for example agent daemons) | Enrolled through device authorization, or as local clients (§5.9). They answer the owner's other apps, or one known peer, under a pairing (§5.8). |
| Public services: bots, support lines, rendezvous and dial-in group services | A service-class endpoint (§2: a provider feature, or an app of a designated service entity) publishes an open offer, multi-use and long-lived up to the service maximum, wherever it wants to be reachable. Any verified principal that holds it dials back, within the offer's `uses` and its open-offer windows, and whichever online endpoint of the service claims first answers automatically (§5.4 case 3, §5.7, §13.1). |
| Service entities, provider to provider | A hosted service entity (§4.3) acts through an app or a provider feature like any entity, through the declared endpoints of both providers: it opens sessions and mints offers, and through an app it may hold pairings with known peers. Two service entities on different providers connect through each other's open offers, or through a pairing between their apps. |

### 4.2 Provider-feature endpoints

The signaling extension defines no provider feature of its own. A provider feature that holds sessions is the one feature of **its own** extension (for example an answering service), and must satisfy all of these:
1. It consumes the signaling fragment under [extensions §4.2](../extensions.md#42-provider-features): it requests a grant on the `signaling` field, and the owner enables it by an explicit action in the provider's interface. Its client identity is (issuer, its extension's spec URL).
2. It declares the session kinds it handles as a built-in handler ([intents §5](intents.md#5-handler-declarations)), identified by its extension's spec URL. The owner approves it per kind exactly as an app (§20.1.4).
3. Its endpoints are registered by the provider. Its leg certificates carry `client: {client_id: <issuer URL>, origin: <issuer origin>, feature: <its extension's spec URL>}` (§6.1).
4. It gets no authority beyond its grant and the owner's approvals. It is listed among the field's consumers wherever the owner sees them. Disabling it, or its suspension under extensions §4.2, ends its endpoints and sessions (§14.2).
5. **Answering.** It has no user action at a device. Across entities it accepts only an `offer`-basis invite for an offer it minted, after the outstanding-offer check (`offer_match`, §5.5, §5.7). Its declared policy, disclosed when the owner enables it, says which offers, bound or open, it mints and answers, and when it declines automatically (§5.5 "Decline"). It is never a pairing party (§5.8).

### 4.3 Out of scope, and service entities

Every session acts for an entity at each end. A provider acting as itself, for no entity, is not a party in this version (§19.3, answer 8). An operator that needs one hosts a **service entity** and enables a feature or connects an app for it.

A service entity is an organization entity ([organizations §3](organizations.md#3-organization-entities)) that the operator controls and whose owner has **designated** it a service entity. The designation is a signaling owner setting of an organization entity, recorded only by an owner action through its owner interface ([organizations §6.3](organizations.md#63-owner-interface)) on a page that meets the §20.1.4 page obligations. That page says that the entity's approved apps, on every endpoint they register, may publish offers lasting up to 90 days (open) or 7 days (bound), that anyone holding an open one can connect automatically, and that holders can tell when the app is running. Its app endpoints are then service-class (§2). Removing the designation is narrowing (§14.2). A person entity cannot be designated.

Its approvals, pairings and feature enablement are owner actions taken through its owner interface, with the same disclosures as for any entity. There is no provider-wide shortcut.

**What is not service-class.** An undesignated organization's apps, including apps that run on members' personal devices, are not service-class: their offers follow the person-app rules (900 s, minting-endpoint routing), so a member's device never becomes a standing, publicly reachable endpoint without a designation its owner chose. An endpoint registered in member context ([organizations §7](organizations.md#7-member-context-for-applications)) is never service-class, even for a designated entity. A person entity gets standing reachability only through a provider feature it explicitly enables, whose answering policy is disclosed then (§4.2). A person who creates and designates a service entity holds a separate entity with its own address; if they run its app on their own device, holders of its open offers can tell when that device runs it, as the designation page disclosed.

## 5. Authorization

### 5.1 Initiator side

Before certifying an initiator leg (`open`, §10.2), the initiator provider MUST check, live:
1. The entity is active.
2. The calling app's connection is live and holds a grant on the signaling field with the method. For a provider feature, its enabled grant is live.
3. The app is an approved handler of the requested kind, at a version it approved (§20.1.4).
4. The kind's `parties` admits the recipient (the own entity or another).
5. The requested profile is listed in the kind's `session.profiles`, and the invite's profile parameters are within the kind's (§16.2).
6. The kind's `session.bases`, when present, includes the basis of the invite (§3.4). An own-entity invite (`basis: null`) counts as `pairing` when its `target` names an endpoint of a paired app (§5.4 case 4), and otherwise as `self`. A cross-entity invite must carry an `offer` or `relation` basis; `open` refuses one without either with `invalid_args` (`none` is reserved, §15).
7. For a `relation` basis (§5.8), the entity holds its own live pairing with `peer.principal` equal to the recipient, for that kind, whose `local` covers the calling app and, when `local.client_session` is set, the calling connection's client session, and whose `opens` lets the local side open (`local` or `both`). Without one, `open` with `relation` fails with `invalid_args`. That reveals only the caller's own records. For an own-entity `target` of a paired app (§5.4 case 4), the same coverage applies to the side the calling app is on: its `client_id`, its client session when that side binds one, and that side's right to open.
8. The entity's own limits allow it (§13).

It resolves the recipient to an origin principal in one of two ways:
- from a principal (always, for an `offer` or `relation` basis);
- from a handle, through the recipient issuer's directory ([organizations §3a.2](organizations.md#3a2-handle-lookup)). A provider without a handle index MAY support principals only.

It then checks the recipient's issuer:
- If the issuer's validated manifest is held and has no valid signaling declaration (§3.1), or its `profiles` option does not list the profile, `open` fails with `unsupported_peer`. That is a public fact.
- If the manifest cannot be obtained or validated, `open` fails with `temporarily_unavailable` (AMD-RI5 reading).

The initiator provider then obtains the recipient's current certification keys. This is an initiator-initiated fetch, never on a federation request path. It is spent from a per-entity budget, and only when the keys are not already held. The provider keeps those keys current for the session's life, and pins them on the session record (§6.3), so that the answer and any control statement verify. If it cannot obtain them, `open` fails with `temporarily_unavailable`. Every other outcome of `open` is the same success (§12.1).

### 5.2 Admission bases

The recipient provider admits an `invite` only on one of these bases, evaluated live:

| Basis | Wire | Admits when |
| --- | --- | --- |
| `self` | `basis: null`, and the initiator origin principal equals the recipient | Always, subject to §5.4 and the owner's settings. |
| `pairing`, own entity | `basis: null`, and the initiator origin principal equals the recipient | As `self`. An own-entity pairing (§5.8) widens routing and acceptance, not admission: it lets the invite reach, and be claimed automatically by, the paired app. |
| `pairing`, another entity (the relation basis) | `basis: {"relation": "pairing"}` | The recipient entity holds a live, not pending, pairing whose `peer.principal` equals the initiator's **verified** origin principal, for this kind line, and whose `opens` lets the peer open (`peer` or `both`) (§5.8). There is no secret: the leg certificate already proves who is asking. |
| `offer` | `basis: {"offer_digest": <base64url SHA-256 of the offer token>}`, with the token carried beside the message in the batch (§9.1) | The offer is live, has a free use, was minted by the recipient entity for this kind line, an admitted version and this profile, and either is open or its principal equals the initiator's **verified** origin principal (§5.7); and the routing set (§5.4 case 3) is not empty. |

A cross-entity invite with `basis: null` (formerly the `none` basis) admits nothing, silently, at §9.2 step 7.

**Verifying an offer basis.**
- The token is 22 to 43 base64url characters, and its SHA-256 equals `offer_digest`.
- At §9.2 step 7 the recipient provider looks the offer up by digest in its own records only, and checks, read-only, that it is live, has a free use (spent plus reserved uses below `uses`), is of the invite's kind line, at a version the minting app's approval admits (§15), and of the invite's profile, and, for a bound offer, that its principal equals the **verified** leg-certificate principal (the certificate was verified at step 3). An open offer admits any verified principal except the minting entity itself. This check changes nothing.
- At §9.2 step 8 it re-confirms all of that atomically, and also that the routing set (§5.4 case 3) is not empty. Only if all of it still holds does it take a use. A mismatch, or an empty routing set, admits nothing and takes nothing, silently.
  - **Bound offer (single-shot).** The single use is **spent** at admission. Whatever happens to the session afterwards (accept, decline, no answer, cancel), the offer is used up.
  - **Open offer.** One use is **reserved** at admission. It is **spent** only by an `accept` claim of that session (§8.2), and **released** if the session is declined or ends unclaimed, so junk that a service declines or ignores does not use up its published offer.
  - Under any concurrency, spent plus reserved uses never exceed `uses`.
- **Limit classification** (§13.1) follows the step 7 check, not the digest alone: an invite whose digest names an offer that is not live, has no free use, or is bound to another principal is classified as an unbased invite, exactly like an unknown digest. So reading someone else's bound offer (for example in an app message that several parties can read) buys no limit exemption.
- **No oracle.** An expired, revoked, exhausted, mismatched or unknown offer each admit nothing, reserve nothing and get the uniform `202`; nothing the initiator observes distinguishes them (§12.1).
- Only the digest is in the signed invite. The token is never delivered to endpoints, and never appears in a `listen` event.

**Kind bases.** An invite whose basis is not in the kind's `session.bases` (§3.4), at the version the recipient holds, admits nothing, silently, at step 7.

A basis grants nothing beyond reaching one routing set (§5.4) with one invite. The initiator is always identified by its verified leg certificate, never by possession of an offer: the offer authorizes reaching, and the certificate says who is asking. Relation values other than `"pairing"`, and the `none` basis, are reserved (§15).

Block and limits (§13) apply after verification and are silent.

### 5.3 Withdrawn: contact-link admission

Revision 3 withdraws the `link` basis, the owner-side signaling configuration on contact parents (AMD-SG-L1a), app-minted links (AMD-SG-L1b) and `mint_link` ([contacts and links spike](../../architecture/contacts-and-links-rethink.md) CL-9, CR-S1 to CR-S3). Deciding which people may reach an app is the app's own matter: an app that wants a person to reach one of its sessions hands that person an offer (§5.7) inside its own message. An invite whose basis carries `link_digest` is invalid as an unknown member (§7.2). The section number is kept so that references stay stable.

### 5.4 Routing to the handler

An invite names an entity, never an app. The recipient provider chooses the endpoints by the invite's basis alone: the minting app for an `offer`, the paired app for a `pairing`, and for an own-entity invite the initiating app or the endpoint its `target` names. No intents default, chooser or owner choice is consulted (§5.6, SG-44).

An endpoint is **eligible** when all of these hold:
- it is registered for the kind;
- its app (or feature) is an approved handler of the kind, at a version that admits the invite's version (§15);
- its connection or enablement is live;
- it is not the initiator's own endpoint.

Each endpoint records the client session of the connection that registered it (for a provider feature, none). Pairing coverage (case 4, §5.5, §10.2) is evaluated against that recorded client session, never against anything the app asserts.

The **routing set** is:

1. **Own entity, with `target` of the same app.** That one endpoint. It must be eligible, and it must belong to the same app as the initiating endpoint (the same `client_id`, or the same provider feature). A `target` of a paired app is case 4.
2. **Own entity, without `target`.** The eligible endpoints of the initiator's own app (the leg certificate's `client`, which this same provider certified). §5.1 item 3 makes that app an approved handler at `open`; if its approval is removed before admission, the set is empty.
3. **`offer` basis.** Never another app than the minting one (the offer's `client_id`, or provider feature).
   - **An offer minted by an endpoint that is not service-class** (a person entity's app, or an undesignated organization's app): the minting endpoint, if it is still eligible; otherwise the eligible endpoints of the minting app for the recipient entity. `offer_match` is projected on the minting endpoint only (§5.5, §10.3).
   - **A service-class offer** (minted by a service-class endpoint, §2): the offer belongs to the minting app or feature, not to the minting endpoint. The routing set is every endpoint of that app or feature that is eligible **and online**, whether or not the minting endpoint still exists. For this case, an endpoint is online when it has a `listen` outstanding or completed one within the liveness window (reference: 60 s); a provider-feature endpoint is online while its feature is enabled and its provider runs it. `offer_match` is projected on every routed endpoint, and the first claim wins atomically (§8.2). The online condition applies only here: a person's app endpoint that is registered but asleep must still receive invites, because a doorbell wakes it (§11.2), while a service instance that has stopped polling should not hold invites it will never answer.
4. **`pairing` basis.** A pairing covers an endpoint only when the endpoint's app equals the pairing side's `client_id` and, when that side sets `client_session`, the endpoint's recorded client session equals it. This applies to both sides and both roles.
   - **Own entity:** `target` names an eligible endpoint covered by the other side of a live own-entity pairing for the kind, where the initiating endpoint is covered by the first side, and that first side may open under `opens` (§5.8). That one endpoint. An own-entity invite without `target` is case 1 or 2.
   - **Another entity (relation basis):** the eligible endpoints covered by the `local` side of the recipient's one pairing for (initiator principal, kind line) (§5.8).

`open` refuses with `invalid_args` a `target` that is neither the initiating app's own endpoint (case 1) nor an endpoint covered under case 4, including a `target` outside a bound client session, or one the initiating side may not open to under `opens`.

The provider delivers an admitted invite to at most 16 endpoints of the routing set, most recently active first. If the routing set is empty, nothing is delivered and nothing is recorded for the owner. The invite stays pending until `answer_by` and then ends silently (§8.5).

A pending invite is also delivered to an eligible endpoint of the routing set that registers or starts `listen` before `answer_by` (late delivery). This is how an offer reaches the minting app when the minting device has gone away, how a service-class offer reaches an instance that comes online, and how an own-entity invite reaches a device of the same app that wakes up. An offer-basis invite whose routing set is empty at admission is not admitted at all (§5.2), so late delivery never holds a use for an app that has no eligible endpoint.

Consequences, by construction:
- **No cross-app visibility.** Each invite reaches exactly one app, fixed by its basis, so the cross-application visibility of AMD-RW1 does not arise.
- **No preference for asserted clients.** A foreign initiator's asserted `client_id` and `origin` never influence routing (RTCw-R3, I2).

### 5.5 Acceptance

- A session connects only through a claim with outcome `accept` by one recipient endpoint (§8.2). A recipient provider MUST NOT claim on its own.
- **Cross-entity sessions.** The claim MUST result from a user action at the recipient device, except in these cases:
  - **offer match** (`offer_match`, §10.3). An `offer`-basis invite delivered to an endpoint with `offer_match: true` MAY be accepted with no user action: for a person's app, because the minting side's user already acted by minting the offer; for a service-class endpoint, because answering holders of its own offers is what it minted them for (§5.7). Before any automatic claim, the endpoint MUST check that the invite's `basis.offer_digest` equals the SHA-256 of an offer token its app still holds outstanding (one it minted, has not revoked and still wants answered), and, for a bound offer, that the verified initiator principal equals the principal that token was minted for. The check is keyed on the digest, which the app computes from its own token, never on `context`, which the initiator chooses. Endpoints with `offer_match: false` claim only after a user action.
  - **paired** (`paired`, §10.3). A relation-basis invite routed to an endpoint covered by the recipient pairing's `local` side MAY be accepted with no user action, within the pairing (`accept: "auto"`, §5.8).
- **Own-entity sessions.** The claim MAY be automatic (**auto-connect**) when either of these holds:
  - **same app:** the kind's `parties` is `self`, the owner enabled auto-connect for that app and kind (an owner setting on the approval, §20.1.4; default off), and the initiator leg certificate's `client.client_id` equals the claiming endpoint's app;
  - **own-entity pairing:** a live pairing for the kind covers the initiating endpoint on one side and the claiming endpoint on the other (each by `client_id` and, when that side binds one, by the endpoint's recorded client session, §5.4 case 4), and `opens` lets the initiating side open (§5.8). The kind's `parties` may then be `self` or `any`.

  The provider computes `auto_connect`, `offer_match` and `paired` per endpoint in the invite projection (§10.3). It cannot verify a user action at `claim`, so it enforces nothing more there. A vendor's native and web clients, under different `client_id`s, are "the same app" only through an explicit own-entity pairing: grouping by registrable domain is not used for signaling (I3, §19.4).
- **Decline.** A decline reveals that a recipient device saw the invite. An endpoint MUST NOT decline without a user action or an owner setting, except that a **service-class endpoint** MAY decline an invite on one of its own offers automatically under its declared policy (for a provider feature, the policy disclosed at enablement, §4.2 item 5). That reveals nothing beyond what its automatic accept already reveals. A declined or unanswered open-offer session releases its reserved use; only an accepted one spends it (§5.2). If the **owner** ends a pending invite through the provider's interface, it ends **silently** (§8.5): nothing is sent to the initiator.

### 5.6 Establishment bases

There is **one** signaling mechanism. The signed session channel (leg certificates, first claim, profiles, silent ends, no presence oracle) is the same for every session. What differs is three things: what admits the invite, which endpoints receive it, and who may claim it without a user action. Those are fixed by the invite's **basis** (SG-23, from the [establishment-modes spike](../../architecture/signaling-modes-spike.md) §1.5). Revision 1's two "establishment modes" are two uses of these bases: invite-style use is the `offer` basis (§5.7), and always-on use is the `pairing` basis (§5.8).

| Basis | Admits | Routes to (§5.4) | Claim without a user action (§5.5) |
| --- | --- | --- | --- |
| `self` | The own entity | The same app, or a `target` of it | Auto-connect: the same app and `parties: self` |
| `pairing` (own entity: extends `self`; another entity: the relation basis) | The paired app, or the paired principal, for the kind | The paired app's endpoints | Yes, within the pairing |
| `offer` | The offer's principal once (bound), or any verified principal within `uses` (open), before expiry | The minting endpoint, else the minting app; for a service-class offer, the minting app's or feature's online endpoints | Yes, under `offer_match`, after the outstanding-offer check |

Consequences:
- **Kinds and approvals come from intents; routing does not** (SG-2, SG-44). Session kinds stay intent kinds, because the registry, disclosure, projection and approvals are all reused.
- **Intents never route incoming events.** An incoming invite never reaches a chooser. A person who starts something hands off through intents to the app that will act; that app then opens, mints an offer or uses a pairing.
- **No owner-visible record.** Every invite has a fixed app. If none of its endpoints is eligible, the invite stays pending, with late delivery, until `answer_by`, and then ends silently.
- **`none` is reserved** (§15, SG-45). Nothing admits a cross-entity invite without an offer or a pairing.

### 5.7 The `offer` basis (invite-style and open)

An offer lets a principal open a session back to the app that minted it. It is a **reverse dial**: the minting side does not open a signaling session. It mints offers on its own provider and hands them out through its own channels: inside an app message that carries a request and whatever presentation the app chooses, or, for an open offer, wherever it wants to be reachable. The holder's app dials back with the offer only after its user acts (for example confirms in the app), or, for an app with no person present, under its own policy. Signaling then connects two parties who have both acted.

There are two shapes, distinguished only by whether the offer names a principal:
- a **bound** offer names one origin principal, and admits only that principal;
- an **open** offer names none, and admits any verified principal except the minting entity itself.

**Minting.** The `offer` method (§10.2) takes `{endpoint, kind, profile, principals?, uses?, expires_in}`:
- `principals`, when present, is 1 to 16 unique origin principals, never the owner's own entity: one bound offer is minted per principal. When it is absent, one open offer is minted;
- `uses` applies to an open offer only: the number of sessions it may admit, from 1 (the default) to a provider maximum (reference: 16 for an endpoint that is not service-class, 10,000 for a service-class endpoint). A bound offer is always **single-use**, spent at admission (§5.2): with `principals`, `uses` MUST be absent or 1, and `offer` refuses any other value with `invalid_args`;
- `expires_in` is from 10 to 900 seconds. A **service-class** endpoint (§2) MAY use up to 7,776,000 seconds (90 days) for an open offer, and up to 604,800 seconds (7 days, reference) for a bound offer. An app SHOULD mint with `expires_in` at least the remaining lifetime of the app message that will carry the offer, plus a skew margin (reference 60 s), so that a dial-back made just before that message expires on the holder's clock still finds the offer live.

Every offer has an expiry and is revocable. There is no offer without one.

**Why the long maximum is only for service-class endpoints.** A long-lived open offer is a standing, publishable address: anyone who obtains it can reach the minting app and, because it answers automatically, can tell when that app is running. For a provider feature or a designated service entity's app that is the point (a bot, a support line, a rendezvous or dial-in group service, a provider-to-provider service entity), and the owner was told so when enabling the feature, designating the entity or approving the app (§4.2, §4.3, §20.1.4). For a person it would be the unsolicited, standing reachability that the contacts and links spike rejected (CL-10), so a person entity's apps, like every other app that is not service-class (§4.3), may mint offers only within the 900 s cap: long enough for a code shown in person or posted to a group the app cannot list by principal, and short enough that a leaked token is soon useless. 90 days matches the default cross-entity pairing expiry (§5.8): it forces a published capability to be rotated at least quarterly, bounds the damage of a leak, and bounds how long an abandoned offer holds a live-offer slot (§13.1). A service-class **bound** offer is capped lower (7 days, reference): it lets one known principal connect automatically once, which is closer to a pairing than to a published address, so a longer standing arrangement with a known peer is a pairing (for an app, §5.8) or a re-minted offer.

Before minting, the provider checks, live, everything §5.1 checks for an initiator (items 1 to 6 and 8, with each principal, or for an open offer any other entity, as the recipient, `offer` as the basis, and the offer limits of §13.1). It then mints one opaque token per offer: at least 128 random bits, encoded as 22 to 43 base64url characters. It returns `{offers: [{principal, offer}], expires_at}`, with `principal` `null` for an open offer. The result is never retained in an RPC journal (§10.2).

**What the provider stores.** Per offer, only: the SHA-256 of the token; the principal, or `null`; the kind line, the version the minting app is approved for, and the profile; the minting endpoint and the minting app (`client_id`, or provider feature), with whether the minting endpoint was service-class; `uses`, and the counts of spent and reserved uses; and `expires_at`. The minting endpoint serves only the routing of an offer that is not service-class and `revoke_offer` without a token list; a service-class offer is routed by its app or feature (§5.4 case 3). The token itself is never stored, logged or delivered to any endpoint after the `offer` result. The holder's provider keeps the token only beside the invite in its outbox, for re-sending until `answer_by` (§9.3); it never logs it, and deletes it with the invite payload once the invite is terminal or `answer_by` passes (§12.4). An offer record is deleted at `expires_at`; until then an exhausted offer keeps its hash so that it can never be reused.

**Key warming (issuer-level only).** At `offer`, the minting provider MAY warm only **issuer-level** metadata of the named principals' issuers: the validated manifest, its signaling declaration and its directory endpoint, from the per-entity warming budget. It MUST NOT fetch a named principal's identity document or certification keys because of an `offer`. Reasons:
- a per-principal fetch at mint time tells the invited party's issuer that someone on the minting provider is about to interact with that principal, before the invited party has acted, and whether or not it ever answers. Disclosing that on the minting page would not remove the leak to a third party;
- an `offer` names up to 16 principals, so per-principal warming would turn one call into up to 16 targeted fetches;
- the dial-back still verifies: a peer the entity talked to in the last 24 h is already kept current (§9.2 step 3); otherwise the first dial-back schedules a refresh, the holder's provider re-sends the invite (§9.3), and the receiver MAY put invites whose `offer_digest` names a live offer in its first refresh lane (§9.2 step 3). The cost is at most one delayed first dial-back.

An open offer names no principal, so nothing is warmed for it.

**Dialing back.** The holder's app calls `open` on its own provider with `to` = the minting entity's principal, `kind` and `profile` as given with the offer, and `basis: {"offer": <token>}`. Its provider checks §5.1 as for any initiator. It cannot check the offer, which only the minting provider holds. It puts `{"offer_digest": …}` in the signed invite and carries the token in the batch's `offers` (§9.1), or on the internal path for a same-provider session (§9.4).

**Admission at the minting provider.** As §5.2 "Verifying an offer basis": checked read-only at §9.2 step 7, then re-confirmed atomically at step 8, with a nonempty routing set. A bound offer's single use is spent then. An open offer reserves one use then, spent only by an `accept` claim and released by a decline or an unclaimed end. Cheap checks run first (§9.2 step 7): the offer lookup and its windows read only the minting provider's own records. Routing is §5.4 case 3. The projection carries `basis: "offer"` (§10.3).

**Automatic answering.** For an offer that is not service-class, `offer_match` is projected true on the minting endpoint. A service-class offer belongs to the minting app or feature, so `offer_match` is true on every routed endpoint (eligible and online, §5.4 case 3), because a service has no person at one device and its instances share one policy. A service-class endpoint MAY also decline automatically under its declared policy, which releases an open offer's use (§5.5). Every other endpoint gets `offer_match: false`. An endpoint with `offer_match: true` still makes the outstanding-offer check before claiming (§5.5); an app MAY share its set of outstanding offer digests among its own endpoints. Service-class endpoints auto-accept holders of their own open offers this way; there is no separate "standing acceptance" setting.

**Revoking.** `revoke_offer({endpoint, offers?})` revokes the listed tokens minted by that endpoint's app, or every live offer the endpoint minted when `offers` is absent. It is narrowing. An app SHOULD revoke offers that it no longer needs (for example when the person who asked gives up, or a published open offer leaks). The owner can list and revoke live offers (§14.1).

**What ends an offer.** Only these:
- `revoke_offer`, or the owner revoking it (§14.1);
- reaching `expires_at`;
- the end of the minting app's or feature's authority for the kind: its session handler approval removed or cleared, its grant on the signaling field revoked, its app connection ending, or the feature disabled or suspended (§14.2);
- for an offer longer than 900 s minted by a service entity's app, removal of the entity's service designation (§4.3, §14.2);
- the entity's move (§14.3) or deletion (§14.4).

Unregistering an endpoint, an endpoint's expiry 30 days after its last `listen` (§10.2), and revoking one client session of an app whose connection otherwise remains never end an offer: the offer belongs to the minting app or feature, and `revoke_offer` covers one endpoint's offers while that endpoint exists. Exhaustion stops new admissions without ending anything.

**Moves.** A move deletes the entity's live offers at the source, and offers are never exported (§12.6, §14.3). A service that moves re-mints and re-publishes its offers from the destination; dial-backs on the old ones admit nothing there.

**Ending what an offer admitted.** When an offer ends (any item above), every session it admitted that is still pending and unclaimed ends **silently** (§8.5): nothing goes to the initiator, whose session ends at `answer_by`. A session already claimed is unaffected by the offer's end. **Claim versus end is atomic.** The authority that decides the first claim (§8.2) also records the offer's end, against the same records, and whichever it records first wins: a claim recorded first connects the session, which the offer's end then leaves alone; an end recorded first ends the session silently, and a later claim fails with `claimed`. An open offer's reserved use is spent or released by that one decision, never both.

**Properties.**
- **No presence oracle in either direction.** A holder who does not act sends nothing, and the offer expires. The minting side learns that a holder acted only when it did. An automatic answer reveals the minting app's availability only to holders of an offer it chose to hand out (§12.1). A dead offer looks like an unknown one (§5.2).
- **The same app on both legs.** The offer routes back to the minting app, whatever the minting entity's intents defaults. Only `offer_match` endpoints answer it automatically.
- **Cross-app interop.** The holder may use any app that holds a session handler approval for the kind and a grant on the signaling field.
- **Several devices of an invited party.** A bound offer admits only the first dial-back that reaches admission, and an open offer only while a use is free. Another device's invite then admits nothing and ends silently at `answer_by`. Telling the other devices that one answered is app-internal.
- **Several invited parties.** One bound offer per principal: a mesh of two-party sessions (§8.6), at most 16 per `offer` call. A larger group is a group service: a service-class endpoint whose open offer each participant dials (§8.6).
- **Bearer secrecy.** An offer is a capability while it is live. A bound offer is useless to anyone but its principal, so another reader of the app message that carried it cannot use it. An open offer is usable by any holder, so an app hands it out only where it means anyone there to connect. Apps keep every offer out of notifications, previews, search indexes and logs, except where they deliberately publish an open offer.
- **Residual: a person's short open offer.** Any holder of an open offer from a person's app, including someone it reached beyond the intended group, can use throwaway principals at an issuer it controls to spend every use the minting app accepts (up to the reference 16), and, while the offer lives, tell from its automatic accept whether the minting app is running. The per-(principal, offer) and per-issuer bounds slow this but cannot stop one holder with many principals. It is inherent to a bearer capability. The bound is the 900 s expiry and the small `uses`, and revoking the offer stops it.
- **Re-minting by a person's app.** A person's app can keep re-minting bound offers (each single-use, at most 900 s, within the mint and live-offer caps, §13.1) and pass them to one peer over its own channel, whose app dials back under its own policy. That is equivalent to a short pairing without the §5.8 owner page. It is accepted, not restricted: the provider cannot verify a user action (§5.5), so a rule against it would be unenforceable; it needs both apps to cooperate over their own channel, which could already carry their bytes; each connection takes a fresh single-use offer, so it stops within 900 s of the minting app stopping; and it reveals nothing to third parties. What a pairing adds, and re-minting cannot, is owner-visible standing consent and acceptance that the provider enforces without the app (§5.8).

### 5.8 The pairing record (always-on)

A **pairing** is a per-edge owner record between exactly two parties. It pre-authorizes one app, or one enrolled client session of it, to connect automatically, for one kind, with one other app of the owner or with one peer principal. Connecting a daemon to three apps takes three pairings, each created by its own owner action; nothing admits "any app" (rule P2 of the [local clients spike](../../architecture/local-clients-spike.md) §4.3, LC-12). A pairing fills the relation basis that revision 1 reserved. It stays a signaling owner record, not a slot assignment or a preferences-assignable resource (LC-11, SG-39). **Pairing parties are apps.** Each side names a `client_id`; a provider feature is never a pairing party, and reaches known peers with offers instead (§4.2, §5.7).

| Member | Definition |
| --- | --- |
| `id`, `revision` | An opaque identifier, and a revision. Updates are compare-and-swap, as for other owner signaling settings (§14.1). |
| `kind` | One session kind line, pinned to the version shown at creation (or at the owner's last re-confirmation, below). |
| `local` | `{client_id, client_session}`: the app on this entity. `client_session` is `null` (any session of that app), or one client session identifier, which binds a single enrolled headless client (§5.9). |
| `peer` | Either `{self: {client_id, client_session}}` (another app of the same entity, with `client_session` as above), or `{principal: {iss, sub}}` (one peer entity, by origin principal). |
| `opens` | Which side opens sessions (added in revision 2.1): `"local"` (only the `local` side opens; the peer side answers), `"peer"` (only the peer side opens; the `local` side answers) or `"both"`. An invite from a side that may not open is not covered by the pairing. A pairing created through device authorization defaults to the interactive app opening and the headless client answering (§5.9). |
| `accept` | `"auto"`, the only value in this version. |
| `label` | Owner-visible plain text, at most 64 characters. |
| `created_via` | `settings`, `device-authorization` or `app-request`. |
| `state` | `pending` (not yet activated), `awaiting_confirmation` (a device-authorization pairing before its code comparison, §5.9) or `live`. |
| `expires_at` | A time. `null` (no expiry) only for an own-entity pairing. A cross-entity pairing always expires: default 90 days after creation, at most 1 year, renewable by the owner on the same page (reference values). A pending pairing expires 7 days after creation (below). |

**Coverage.** A pairing side covers an endpoint only when the endpoint's app equals that side's `client_id` and, when that side sets `client_session`, the endpoint's recorded client session (§5.4) equals it. Coverage is checked in both roles, initiating and answering, and everywhere the pairing has an effect: routing and `target` eligibility (§5.4 case 4), the initiator check (§5.1 item 7), `endpoints({pairing})` (§10.2), and the `auto_connect` and `paired` projection (§5.5, §10.3). A pairing whose side binds a client session never covers another session of the same app, on either side. A local client's `client_id` is already per installation (local clients spike §2.3 rule 1), so a side that names one covers only that installation, and binding its `client_session` as well narrows it to one client session.

**Creation.** Only by an owner action on a provider page that meets the §20.1.4 page obligations (same-origin, CSRF-protected, `frame-ancestors 'none'`, controls armed after a delay, nothing preselected). A provider MAY offer the page from its settings, from the enrolment approval page (§5.9), or at an app's request through a URL on the provider's own origin, never one the app supplies (as for `approval_required`, §20.1.4). The page:
- names both apps by verified origin, or the peer principal (below), the kind and its profiles, and which side opens;
- says that these apps will connect automatically, with no prompt, whenever the opening side is running. For a peer pairing, it also says that the peer can tell when this app is running;
- words the effect from the kind's profiles and sensitivity categories (intents §4), not from the kind's own title alone. For example, a `webrtc` kind whose categories include `personal-data` says "*peer* may open a direct connection with this app, and exchange personal data with it, without asking";
- refuses a combination the kind's `parties` does not admit: an own-entity pairing needs `parties` `self` or `any`, and a cross-entity pairing needs `other` or `any`;
- refuses a cross-entity pairing when the entity already holds a pairing, in any state, with the same `peer.principal` and kind line, and links to that pairing instead. So an entity holds **at most one cross-entity pairing per (peer principal, kind line)**, and admission, routing, `opens`, expiry and the per-pairing limits (§13.1) always resolve to one record. Connecting a second local app to the same peer for the same kind is done at app level, or with a different kind.

**Cross-entity creation, additionally:**
- the owner authenticates freshly (as device authorization §5.1(2) requires for an approval);
- the peer is shown by handle only when the provider holds a verified directory binding for it; otherwise the page shows the full origin principal (`iss` and `sub`) and the issuer's origin, and no app-supplied name;
- an expiry is always set (above), and the page shows it;
- the page discloses that this pairing lets the peer connect automatically, and that whether the peer's own owner must also pair depends on the peer's provider: a conforming provider requires the peer's own record before its app may open (§5.1 item 7), but this provider can enforce only its own record (below).

**Each party is granted individually (P1).** Every app party (both sides of an own-entity pairing, and the `local` side of a cross-entity pairing) holds its own live connection, its own grant on the signaling field with the methods it needs, and its own session handler approval for the kind, each recorded by its own owner action. A pairing never creates, implies or extends any of them. A page MAY offer them beside the pairing only as separate, unchecked controls.

**Pending and explicit activation (P3).** A newly created pairing is **pending**: it is shown to the owner, but it admits, routes and accepts nothing. It goes live only through an owner control for that one pairing, unchecked and armed after a delay, that names both parties (or the peer), the kind and `opens`, and that is available only once every party holds what P1 requires. Approving or granting a party never activates a pairing; an approval page MAY show the pending pairings that the approval would make activatable, with a link to each one's activation control. A pending pairing is deleted if it is still pending 7 days after creation. **Only creation produces a pending pairing**: a live pairing never returns to pending. Two readings of P3 (SG-46):
- **Activation at creation.** When every party already holds what P1 requires when the creation page is shown, that page's pairing control meets every requirement of an activation control, so it is the activation control, and the pairing is created live.
- **Enrolment pages.** A device-authorization pairing under M4 is activated only by its code confirmation (§5.9 step 5). On an M5 enrolment page, where the client's grant and its session handler approval are recorded by the same submit as the pairing control, the pairing goes live in that transaction only if every party then holds what P1 requires; otherwise it stays pending. The pairing control is still separate, unchecked and armed after a delay.

**Visible from both parties (P4).** An own-entity pairing is listed with both of its apps wherever the provider lists the owner's app connections (§14.1). A cross-entity pairing is listed with its `local` app there, and in the owner's list of cross-entity pairings by peer principal (§14.1), because the peer is not an app connection. Either listing can remove it.

**Own-entity pairing extends `self`.** With a live pairing whose sides cover the initiating and the claiming endpoints, and whose `opens` lets the initiating side open:
- `target` may name an eligible endpoint covered by the other side (§5.4 case 4);
- the projection's `paired` and `auto_connect` are true for that endpoint (§10.3);
- the kind's `parties` may be `self` or `any`.

**Cross-entity pairing is the relation basis.**
- A pairing with `peer.principal`, whose `opens` is `peer` or `both`, admits an invite with `basis: {"relation": "pairing"}` whose **verified** initiator origin principal equals it, for that kind line (§5.2).
- The recipient provider looks it up at §9.2 step 7 by a hash of (principal, kind line), reading only its own records, and confirms it against the verified principal at step 8. An invite with no matching pairing admits nothing, and gets the uniform `202`.
- Each owner creates their own side. Between two conforming providers, a session connects only when both sides' records exist: the initiator's provider refuses `open` with `relation` unless its own entity holds a matching pairing that covers the calling app and client session and lets it open (§5.1 item 7).
- **Only the recipient's record is enforced by the recipient.** The initiator-side check runs at the initiator's provider. A non-conforming or malicious peer provider can skip it, so against such a provider only the recipient's own record protects the recipient. The recipient's record still bounds everything that matters to the recipient: which principal, which kind, which local app and client session, the expiry and whether the peer may open at all. The creation page discloses this (above).
- The peer's app is not part of the record. A foreign initiator's `client_id` is only reported by its provider (§10.3), so a cross-entity pairing binds the peer principal, and the peer owner's own pairing binds the peer's app on its side.

**Kind versions.** A pairing covers invites at its pinned kind version, and at later versions that are additive from it without new disclosure (§15). A newer version that adds disclosure needs the owner to **re-confirm** each affected pairing on the creation page, showing the difference. Until then the pairing covers only invites at versions within what was confirmed, and invites at the new version are not covered (they fall back to whatever other basis applies, or admit nothing).

**Routing and acceptance.** Routing is §5.4 case 4, to at most 16 covered endpoints, most recently active first. Covered answering endpoints MAY claim `accept` with no user action (§5.5).

**How an app learns its pairings.** An app never creates a pairing, but it needs the `id` to use one. The provider tells each covered endpoint about the pairings that cover it, and nothing else:
- `endpoints({endpoint})`, called with one of the app's own endpoints (§10.2), returns `pairings`: every pairing, in any state, that covers the calling endpoint on either side, as `{id, state, kind, side, opens, peer, expires_at}`. `side` is `local` or `peer` (which side covers the caller). `peer` is the other party: `{client_id}` for an own-entity pairing, or `{principal}` for a cross-entity one, which the owner paired this app with and which it needs in order to open;
- `listen` delivers a `pairing` event to each covered endpoint when such a pairing is created, changes `state` or is deleted (§10.3).

No method reveals pairings that do not cover the caller, or their labels.

**Discovery, own entity only, opening side only.** `endpoints({pairing})` (§10.2) returns the eligible endpoints covered by the other side of a live own-entity pairing, and only to a calling endpoint that the pairing covers on a side that may open. Each is returned as `{endpoint, label, kinds, client_id}`:
- `label` is the provider's own name for the endpoint's device or client session, as shown in the owner's own lists (for an enrolled client, the owner-authored label given at approval), never the `label` the paired app supplied at `register`. One app never sees text another app wrote about itself;
- there is no `last_seen` for another app's endpoints: listing only live endpoints already says enough to connect, and a last-seen time would let one app watch another app's usage;
- the answering side gets nothing extra.

There is no discovery across entities: the initiator opens to the principal, and the first claim wins (§12.2 unchanged). A fleet that spans entities is out of scope for this version; a connected peer endpoint can relay to its own fleet at app level.

**Reconnection.**
- An opening app opens one session per live paired endpoint, with jitter, and with exponential backoff after failures.
- Before the 24 h cap (§8.1), an app MAY open a replacement session and switch over. Live sessions are capped: per (pairing, endpoint pair) for an own-entity pairing, and per pairing `id` at the recipient for a cross-entity pairing (§13.1).
- `answer_by` is no obstacle, because a paired client is normally listening. If it is not, the invite ends silently, and the app retries with backoff (reference: at most every 15 minutes once idle), or when `endpoints({pairing})` lists a new endpoint.

**Revocation and clearing.** A pairing is **deleted**, and stops admitting, routing and accepting at once, when:
- the owner removes it, or it reaches `expires_at`;
- it is still pending 7 days after creation;
- either app's session handler approval for the kind, or its grant on the signaling field, is removed or cleared (§20.1.4). Clearing deletes the pairing; it never parks it as pending. Restoring the approval does not restore the pairing, which the owner creates again;
- the client session it binds (`local.client_session` or `peer.self.client_session`) is revoked or ends, for example from the owner's list of app connections (§5.9, device authorization §8);
- the owner blocks its `peer.principal`, or the provider that issues it (§13.2);
- the entity moves (§14.3) or is deleted (§14.4).

Deleting a pairing ends its claimed sessions with a control statement `revoked`, and its pending invites silently (§14.2).

### 5.9 Enrolling headless clients

A headless client, such as an agent daemon on a machine with no browser, is a public native client. It enrolls with [device authorization](device-authorization.md) (RFC 8628 with mandatory DPoP; mechanism M4 of the [local clients spike](../../architecture/local-clients-spike.md) §1.2), which 3sln.me implements locally behind `DEVICE_AUTHORIZATION_ENABLED`. A client with a browser on the same device MAY instead enroll with a loopback authorization-code flow with PKCE and mandatory DPoP (M5, spike §2.3 rule 7). This section adds nothing to either protocol. It says how a provider that supplies the built-in signaling resource uses them.

1. **Start.** The client requests authorization with its `client_id`, a `dpop_jkt`, and a request for the signaling fragment with the methods it needs (`register`, `listen`, `claim`, `send`, `renew`, and relay credentials). The `client_id` is either a client ID metadata document listing the grant it uses, or a **local-client identifier**: the RFC 9278 JWK thumbprint URI of its DPoP key, proven at request time, with its local manifest (spike §2.3 rules 1 to 4, a proposed local-clients extension). Under M5, steps 2 and 3 happen on the provider's authorization page instead.
2. **Show.** Under M4, the client shows the `user_code` and `verification_uri`. **Code entry is the default.** The client MAY also show a QR code of `verification_uri_complete`, but a prefilled code loses protection against code substitution (device authorization §10.6), so the provider still asks the owner to type the code unless its policy establishes that the approval is happening alongside the device (device authorization §5.2).
3. **Approve.** The owner authenticates freshly, enters the code (M4) and consents to the fragments. On the same page, the provider MAY offer, as separate, unchecked controls:
   - the session handler approval for the kinds declared in the client's manifest or local manifest (§20.1.4);
   - **one pairing control per already-connected candidate app** (P2, §5.8), each creating a pairing with `local = {client_id: <the client>, client_session: <this grant's client session>}`, `peer` = that app, `opens: "peer"` by default (the interactive app opens, the headless client answers), and `created_via: "device-authorization"`. Each one still needs activation (§5.8): under M4, the confirmation of step 5; under M5, the same submit, as §5.8 "Enrolment pages" allows.
4. **Run.** The client receives DPoP-bound tokens, registers a DPoP-bound endpoint (§10.1), and long-polls `listen`. It needs no person again.
5. **Confirm (M4 only).** A pairing whose bound client session came from the device grant (M4) goes live only after this confirmation. An M5 enrolment happened in the same device's browser and cannot be phished remotely, so it uses no code (§5.8 "Enrolment pages", CR-L5). The owner confirms an M4 pairing **in the paired app** (the pairing's `peer` side, the interactive app) by comparing a short code:
   - the headless client displays a confirmation code: the first 6 decimal digits (reference) of a SHA-256 over a fixed label, the `user_code` of its device authorization and its own DPoP key thumbprint (`dpop_jkt`), which it can compute alone. The provider chose the `user_code` after the client committed its `dpop_jkt`, so a device that can see the legitimate code cannot grind keys offline to match it: each attempt costs a new, rate-limited device authorization;
   - the paired app finds the pairing through `endpoints({endpoint})` or a `pairing` event (§5.8), whatever `opens` is. While the pairing is `awaiting_confirmation`, `endpoints({pairing})` called by an endpoint covered on the `peer` side answers `approval_required` with a provider page URL on the provider's own origin (§20.1.4), for every value of `opens`. That page names the pairing (label, both apps, the kind and `opens`), shows the same code, which the provider derives from the `user_code` and `dpop_jkt` it bound at approval, and asks the owner to confirm only if the code matches the one shown on the device in front of them. The control is armed after a delay and preselects nothing. Confirming is the pairing's activation (§5.8);
   - a mismatch, or a cancel, deletes the pairing. An unconfirmed pairing never admits, routes or accepts anything, and is deleted after 7 days like a pending one.

   This binds the pairing to a device the owner can see, so a phished device code (device authorization §10) does not by itself yield a live automatic connection. The code is a comparison value, not a secret. It does not stop an owner who is talked into reading a code off an attacker's screen; it adds a second, deliberate step in the owner's own app.
6. **Connect.** The opening side's app calls `endpoints({pairing})`, then `open` with `target` set to each live paired endpoint. Each claims at once. With `opens: "local"`, the headless client is the opening side and does the same.

**Standing authorization** is the intersection of four things, each checked live: the client session (device authorization §7: no absolute lifetime by default, an idle limit, live lineage and grant checks); both apps' grants and session handler approvals; the pairing; and the endpoint's registration (§10.2).

**Device-grant lineage (finding, proposed amendment).** Device authorization §7 item 4 revokes a client session when the *approving login session* is ended explicitly, including by sign-out. An owner who approves a daemon from a phone browser, and later signs out of that browser, would silently end every daemon approved from it. That is right for a television, and surprising for a fleet. AMD-SG-D1 (§20.11) proposes that the owner may mark a device grant as a **standing device grant** at approval. It is exempt from exactly three lineage events of the approving session: that session's own sign-out, its natural expiry and its eviction by a session-count limit. Global sign-out ("sign out everywhere"), remote revocation of the approving session, a credential change or removal, recovery, account suspension or deletion, and explicit revocation of the grant still revoke it. Providers MAY restrict which clients are offered the mark, and MUST NOT offer it to a local client whose recorded origin is a web origin. It is proposed, unsigned and **not applied to device-authorization.md**. Until it is adopted, a provider SHOULD warn at approval that signing out of the approving browser ends the client.

**Revocation** uses existing surfaces. The provider's list of the owner's app connections shows the client session (a local client as an unverified app on the owner's device, grouped by the owner's device label; spike §3.2), with its endpoints, its standing status and the pairings it is party to. Revoking it ends its endpoints and sessions (`revoked`, §14.2) and the pairings bound to it (§5.8). Pairings have their own owner control (§14.1).

## 6. Keys and certificates

### 6.1 Leg keys and leg certificates

For each leg, the endpoint generates a fresh ES256 key pair:
- it SHOULD be non-extractable;
- it MUST NOT be reused across sessions, so that no peer can link an endpoint across sessions.

The entity's provider certifies the public key in a leg certificate: a compact JWS under the core **signed-object profile**, which the core [keys](../keys.md#3-compact-jws-profile) specification defines (moved from links §3.1 on 2026-10-27; [contacts and links spike](../../architecture/contacts-and-links-rethink.md) CR-K1, CR-K2). Its protected header is exactly `{alg:"ES256", kid:<an active certification kid of the entity>, typ:"bindle-signaling-leg+jwt"}`. Its payload is exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"signaling-leg-certificate"`, `1` |
| `iss`, `sub`, `identity` | The leg's entity at its current issuer, and its identity URI. |
| `aud` | The peer entity's identity URI. It equals `identity` for own-entity sessions. |
| `sid` | The session (§7.1). |
| `role` | `"initiator"` or `"recipient"`. |
| `kind` | `{artefact, version, digest}`: the session kind. |
| `profile` | The profile id. |
| `client` | `{client_id, origin, feature}`, as verified by the provider. `feature` is `null` for an app, and for a provider feature the spec URL of the extension whose feature it is (§4.2). |
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

A message is a compact JWS under the signed-object profile (§6.1), at most 40,960 bytes. Its protected header is exactly `{alg:"ES256", typ:"bindle-signaling-message+jwt", kid:<the leg's jkt>}`. Its payload is exactly:

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
| `invite` | initiator | `kind` (`{artefact, version, digest}`); `profile`; `answer_by` (Unix seconds, after `iat` and at most `iat` + 120); `basis` (§5.2: `null`, `{offer_digest}` or `{relation: "pairing"}`); `context` (`null`, or an object valid against the kind's `data` schema at that version); `params` (the profile's invite parameters, §3.5, §16.3). Revision 1's `callback_digest` and revision 2's `link_digest` members are removed (§5.3), so an invite that carries either is invalid as an unknown member. |
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
- **Context.** `context` has at most 8 properties and 2,048 serialized bytes (AMD-SG-I1 constrains session kinds so). No property may have the `capability` format. (The former `contact-link` format was withdrawn from intents with contact links in contacts phase 4, 2026-10-28, so no field can carry it.) An endpoint MUST NOT put a network address of its device (an IP address, a hostname that resolves to it, an mDNS name or an ICE candidate) in `context`, or in any other pre-claim field. Providers validate `context` only against the kind's schema and cannot detect an address in it, so they cannot enforce this rule (§12.3).

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

An endpoint has glare when it holds an unclaimed outgoing session for a kind line and receives an invite for the same kind line from the party that session is addressed to, in exactly these cases:
- two `pairing` invites, own-entity (with `target`, §5.4 case 4) or relation basis: each paired app may be opening to the other at the same moment;
- two own-entity same-app invites with `target` (§5.4 case 1), each naming the other endpoint.

Own-entity invites without `target`, which may reach several endpoints, and `offer` dial-backs (below) do not glare; they are ordinary sessions, and collapsing them is an app concern. Within that scope, both endpoints rank the two sessions by their initiator leg keys, never by `sid`, which the peer's provider chose and could steer:
- Let `a` be the `cnf.jkt` of the initiator leg of one session and `b` that of the other, each taken from its verified leg certificate, as base64url-decoded bytes. The rank of the session whose initiator leg is `a` is SHA-256(`"bindle-signaling-glare"` ‖ `a` ‖ `b`), and the rank of the other is SHA-256(`"bindle-signaling-glare"` ‖ `b` ‖ `a`). Both endpoints compute the same two ranks.
- The session with the lower rank, compared as byte strings, survives. The endpoint whose outgoing session has the higher rank cancels it.
- Neither side can steer the outcome: each leg key is generated fresh by its own endpoint (§6.1) and committed in its invite before the other side's key is seen, and the rank depends on both.
- **Equal ranks** happen only if both legs carry the same key, which §6.1 forbids within an entity and which is otherwise negligible. Both endpoints then cancel their outgoing sessions, neither claims, and the apps retry with jittered backoff.
- Glare decides only which session survives. Whether the surviving invite may be claimed without a user action follows §5.5 alone; for crossing `pairing` invites it is claimable under the pairing anyway. An `offer` dial-back does not glare, because the minting side opens nothing. Two mutual offers whose dial-backs cross are two ordinary sessions; collapsing them is an app concern.

### 8.4 End

- Either leg ends a connected session with `end`. The initiator ends an unclaimed one with `cancel`.
- On receiving `end`, `cancel` or a control statement, an endpoint MUST close whatever transport the profile set up for that session.
- **A `cancel` that crosses a claim.** A `cancel` that reaches the recipient provider after a successful claim is processed as `end` with `closed`.
- **An `accept` that crosses a cancel.** An `accept` that reaches the initiator provider after the initiator's `cancel` is answered with a control statement `end` (`failed`) for that recipient leg.
- Both sides converge to `ended`.

### 8.5 Silent ends

A recipient session that no endpoint has claimed ends **silently**: no message and no control statement go to the initiator's provider, whatever the cause. The causes include:
- an owner ending it (§5.5);
- an app's approval or grant being narrowed or revoked (§14.2);
- the offer that admitted it being revoked or expiring (§5.7), or the pairing that admitted or routed it being deleted (§5.8);
- a block;
- a §7.3 failure on the initiator leg (a reused `seq` with different bytes, a buffer overflow, a gap timeout);
- an event-queue overflow;
- account deletion.

The owner's own endpoints that received the invite get a `state: ended` event. The initiator's session ends at `answer_by`. In an own-entity session, the owner's own initiating device is also told `ended`, because it is not another entity.

Claimed sessions end with `end` or a control statement as usual.

### 8.6 Multi-party

Multi-party sessions are a non-goal:
- A mesh is a set of independent two-party sessions.
- A group service is a service entity that each participant reaches with an ordinary two-party session, typically by dialing its open offer (§5.7). Mixing is the service's concern.
- A later version MAY add an explicit group correlation member. The exact-member rules reject one in this version.

## 9. Transport between providers

### 9.1 Endpoint and batch

**Where batches go.** A provider sends messages and control statements for a session only to the `endpoint` option of the signaling declaration (§3.1) in the validated manifest of the peer entity's **current** issuer, found through the successor index for a moved identity. It MUST NOT send to any other URL, including one received in a response, a link or a message. Delivery follows the protocol §2 fetch rules: HTTPS, no redirects, bounded size and time, and screening of private, loopback and link-local targets.

**The request** is a `POST` with `Content-Type: application/vnd.bindle.signaling+json` (a project-private proposed media type) and a body of at most 131,072 bytes:

```json
{"v": 1, "certificates": ["<leg certificate>"], "messages": ["<message>"], "controls": ["<control statement>"], "offers": ["<offer token>"]}
```

**Batch rules:**
- `certificates` (at most 4), `messages` (at most 32) and `controls` (at most 4) may each be empty, but not all three.
- `offers` (at most 4, each 22 to 43 base64url characters) carries only the offer tokens whose digests appear in invites in the same batch. It MAY be omitted when empty.
- Unknown members are invalid, including revision 2's `links`.
- Every element of a batch names the same `aud` (AMD-RI2).
- A leg's certificate accompanies its first message to each receiver, and every renewal.

### 9.2 Verification

The receiving provider MUST perform these steps in order:

1. **Shape (no fetch).**
   - Check the batch shape and bounds. For each JWS, check the signed-object profile rules (§6.1), `typ`, `bindle`, `v`, exact members, low-S, and the `iat` window.
   - Check that `aud` is an absolute HTTPS URL on this provider's issuer origin, with no userinfo, query or fragment, and that every element names the same `aud`.
   - At the public endpoint, refuse any element whose `iss` is this provider's own issuer. Sessions between two entities this provider hosts travel only through the internal path, where the sender's provider applies §7 and §16 first (AMD-RW2).
   - A batch in which any element fails this step is refused as a whole.
2. **Session lookup (no fetch).** Find the session by (**initiator** origin principal, `sid`). The initiator principal is the sender for `role: initiator`, and the entity named by `aud` for `role: recipient`, each mapped through the successor index.
   - **Invite.** The session must not exist yet (a retried copy is ignored at step 5). For an `offer` basis, the batch must carry a token whose SHA-256 equals `offer_digest`; the offer record itself is not read until step 7.
   - **First answer.** For a recipient leg's `seq` 0 `accept` or `decline` with `to` equal to the initiator leg, the session must exist with no recipient leg recorded. The first one verified at step 4 becomes the recipient leg.
   - **Other messages.** The sender's `leg` must be the session's initiator leg, or its recorded recipient leg.
3. **Certificate.** Verify the leg certificate (§6.1) against the sender's `active` certification keys **as already held**, or as pinned on the session (§6.3).
   - The receiver keeps current, by background refresh, the keys of the entities its hosted entities admit, of the peers of their sessions within the last 24 h, and of the recipients of its own entities' open sessions (§5.1).
   - If the key is not held, the message is not processed and a refresh is scheduled.
   - Refresh scheduling is bounded (a bounded queue, per-issuer and global fetch budgets before any fetch, the manifest floor and a valid signaling declaration before identity documents are fetched, negative caching) and never runs on the request path.
   - A receiver MAY order its refresh queue in lanes: first peers with a live or pending session and invites whose `offer_digest` names a live offer of the addressed entity (a read-only lookup of its own records, spending nothing), then everything else, capped per source network (AMD-RV2). The response and its timing still never depend on steps 2 to 8.
4. **Signature.** Verify the message signature under the certificate's `delegate`. Check that the certificate's `sid`, `aud`, `role`, and for an invite `kind` and `profile`, match.
5. **Order and replay.** Apply §7.3. A (`sid`, `leg`, `seq`) is recorded only after step 4.
6. **Authority epoch.** Refuse an `aep` lower than the highest recorded for that sender, and record a higher one. Epochs are recorded only for admitted traffic, and dropped with the state they belong to.
7. **Policy, cheapest first.** The recipient provider MUST evaluate the checks that read only its own records before any check that consults another component or a host-wide service (RTCw-M5). The local checks are, in order:
   - closed account;
   - duplicate;
   - block (§13.2);
   - the kind's `session.bases`, at the held version (§5.2);
   - basis: an invite with no basis from another entity stops here (§5.2); for `offer`, a live offer of this kind line, version and profile with a free use, open or bound to the verified certificate principal, checked read-only (§5.2, §5.7); for `relation`, the live pairing keyed by (initiator principal, kind line) that lets the peer open (§5.8);
   - `sid` collision (§8.2);
   - pending and connected capacity, including the pairing and open-offer sub-budgets and the reserve shares (§13.1);
   - per-recipient limits, or for an open-offer invite only its own windows: per offer, per (principal, offer) and the per-issuer fair share (§13.1).

   Only an invite that passes them reaches the host-wide limiter, handler eligibility (§5.4), context validation against the pinned kind version, and the profile rules (§16).
   - **Unheld kind version.** If the provider does not hold the invite's kind version (§3.4), nothing is delivered and the session silently stays unanswered.
   - **`data` budget.** A `data` message over the recipient entity's aggregate budget (§13.1) ends the leg with `failed`, silently if the session is unclaimed.
   - **Other drops.** The pre-claim and `to` drops of §7.2 and §7.3 happen here.
8. **Apply, atomically.**
   - Re-run the local checks without counting.
   - For an offer basis, re-confirm the step 7 offer check and that the routing set (§5.4 case 3) is not empty, and only then spend a bound offer's single use or reserve one use of an open offer (§5.2, §5.7). Under any concurrency, spent plus reserved uses never exceed `uses`.
   - For a relation basis, compare the pairing's `peer.principal` with the verified certificate principal (§5.8).
   - Create or update the session.
   - Deliver to the routing set (§5.4), or to the claimed endpoint.

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

`https://spec.bindle.example/contracts/signaling/v1` is invoked by ordinary RPC ([protocol §5](../protocol.md)) on the built-in signaling resource the consumer was granted, with `x-bindle-brokerable: false`. All arguments reject unknown members.

**Live checks.** Every method checks the grant on the signaling field (for a provider feature, its enabled grant) live. Every widening method also checks the handler approval for the kind live. The widening methods are:
- `open`, `register`, `renew` and `offer`;
- `claim` with outcome `accept`. A `decline` claim is narrowing and is not gated by the approval;
- `send`, unless every message is `end`, `cancel` or `decline` (RTCw-M4);
- relay credentials (§16.7).

`revoke_offer` and `unregister` are narrowing, and are never gated by the approval.

**Endpoint identifiers.** An endpoint identifier alone never authorizes:
- When the RPC token is DPoP-bound, `register` binds the endpoint to that key's `jkt`, and every later call naming the endpoint MUST use the same key.
- Otherwise `register` also returns `endpoint_secret` (at least 128 random bits). Every later call naming the endpoint carries it as the `endpoint_secret` argument, and the provider stores only its hash.
- A DPoP-registered endpoint refuses the `endpoint_secret` argument.

### 10.2 Methods

| Method | Effect | Arguments → result |
| --- | --- | --- |
| `register` | write | `{kinds, label?, push?}` → `{endpoint, endpoint_secret?, expires_at}`. Registers this device instance for the listed kinds; each kind MUST be one the app is approved for. `label` is at most 64 characters of plain text, shown only to the owner and to the app's own endpoints; it is never shown to another app (§5.8). `push` is optional (§11.2). An endpoint lives at most 30 days after its last `listen`, and then expires with the effects of `unregister` (§14.2). A provider SHOULD bound live endpoints per app within the entity's bound (reference host: 8 of 32). |
| `unregister` | write | `{endpoint}` → `{}`. Ends its legs (§14.2). It never ends an offer (§5.7). |
| `endpoints` | read | `{endpoint?, pairing?}` → `{endpoints: [{endpoint, label, kinds, last_seen?, client_id?}], pairings?}`: this app's endpoints for the owner's own entity only, with `last_seen`. With `endpoint` (one of this app's endpoints, bound as §10.1), it also returns `pairings`, the pairings that cover that endpoint (§5.8 "How an app learns its pairings"). With `pairing` (a pairing `id`, which needs `endpoint`), it also returns the eligible endpoints covered by the other side of that live own-entity pairing, as `{endpoint, label, kinds, client_id}` with the provider's own name (§5.8) as `label` and no `last_seen`, and only when the calling endpoint is covered (app and bound client session) on a side that may open under `opens` (§5.8). A pairing that is pending, does not cover the calling endpoint, does not let its side open, or names a peer principal returns no extra endpoints. A device-authorization pairing awaiting confirmation answers `approval_required` with the confirmation page to an endpoint covered on its `peer` side, whatever `opens` is (§5.9). Never across entities (§5.8, §12.2). |
| `open` | write | `{endpoint, to, kind, profile, params, delegate, basis?, target?}` → `{sid, certificate, expires_at, peer_keys}`. `kind` is the line URL, and the provider pins the version the app was approved for. `to` is a principal or a handle (§5.1). `target` is one of the owner's own eligible endpoints of the same app, or an endpoint covered by the other side of an own-entity pairing that covers the calling endpoint and lets its side open (§5.4 cases 1 and 4), and is allowed only when `to` is the owner. `basis` is `{offer: <offer token>}` (§5.7) or `{relation: "pairing"}` (§5.8), is required when `to` is another entity, and is omitted for `self` and own-entity pairings. `peer_keys` are the recipient's active certification keys as held. `approval_required` (with a provider page URL) means the app is not an approved handler of the kind (§20.1.4). |
| `offer` | write | `{endpoint, kind, profile, principals?, uses?, expires_in}` → `{offers: [{principal, offer}], expires_at}`. Mints one single-use bound offer per listed principal (1 to 16 origin principals, never the owner; `uses` absent or 1), or, when `principals` is absent, one open offer (`principal: null`) admitting up to `uses` sessions (default 1), for the calling app, valid for 10 to 900 s, or from a service-class endpoint up to 90 days (open) or 7 days (bound) (§5.7), within the per-app and per-entity live-offer caps (§13.1). Widening. `approval_required` as for `open`. |
| `revoke_offer` | write | `{endpoint, offers?}` → `{}`. Revokes the listed offer tokens minted by this endpoint's app, or all live offers this endpoint minted when `offers` is absent. Narrowing. Unknown, exhausted or expired tokens are ignored. |
| `claim` | write | `{endpoint, sid, outcome, delegate}` → `{certificate, peer_keys}`, or the error `claimed`. `outcome` is `accept` or `decline`. Only an endpoint the invite was delivered to may claim. An `accept` claim checks the handler approval live (§10.1). For an open-offer session, an `accept` claim spends its reserved use and a `decline` releases it; a bound offer's use was already spent at admission (§5.2). |
| `send` | write | `{endpoint, sid, messages}` → `{accepted}`, with at most 32 JWS messages, all from this endpoint's leg in this session. The provider applies §7 and the profile's rules, including the owner's IP policy, to its own endpoint's messages before relaying, and refuses violations with `invalid_args`. It does not buffer out-of-order messages from its own endpoint. A full outbox refuses with `rate_limited`, and nothing is accepted. |
| `renew` | write | `{endpoint, sid}` → `{certificate}`. |
| `listen` | read | `{endpoint, cursor?, wait?}` → `{cursor, events, gap}`. A long poll, with `wait` at most 25 s (§10.3). |

**Errors** follow protocol §5. `claimed` and `unsupported_peer` are the method-specific errors that depend on state, and they are returned only to the owner's own endpoints. Both are raised before any session state is written, or after state that is terminal, so a runtime keeps them as no-effect outcomes (RTCi-5). A runtime MAY answer `indeterminate` for a write whose outcome it cannot classify.

**Retention.** Write results that carry a leg certificate or an offer token are never retained in an RPC journal. A retried `tx` answers `indeterminate`. Arguments that carry an offer token are never logged.

### 10.3 `listen` events (AMD-RI4, generalized)

Every event has `type` (`invite`, `message`, `state` or `pairing`), `sid` (`null` for `pairing`) and `seq`.

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
    - `basis`: `self`, `pairing` or `offer`;
    - `auto_connect`: boolean, true for an own-entity invite under the same-app rule or an own-entity pairing (§5.5);
    - `offer_match`: boolean, true for an `offer`-basis invite delivered to the minting endpoint of an offer that is not service-class, or to any routed (eligible and online) endpoint of a service-class offer; false otherwise (§5.4 case 3, §5.5, §5.7). The endpoint still makes its outstanding-offer check before claiming automatically;
    - `paired`: boolean, true only when a live pairing covers this endpoint on the answering side (app and bound client session) and covers the initiator on a side that may open: for an own-entity invite, the initiating endpoint's app and client session; for a relation-basis invite, the verified initiator principal (§5.8).

  Each of `auto_connect`, `offer_match` and `paired` permits a claim with no user action. The offer token is never in an `invite` event.
- **`message`** adds `message` and, with the first message of a leg, `certificate`.
- **`state`** adds `state` (`claimed`, `expired` or `ended`) and, when there is one, `control`.
- **`pairing`** adds `pairing`, as one `endpoints({endpoint})` `pairings` entry (§5.8), with `state` `deleted` when the pairing was deleted. It goes only to endpoints the pairing covers.

A queue that overflowed reports `gap: true`. The affected sessions end `failed`, silently if they are unclaimed (§8.5). Reference bounds: 256 events or 512 KiB per endpoint.

## 11. Delivery

### 11.1 Long poll (required)

`listen` is the baseline that every built-in signaling resource implements. A doorbell is never needed for correctness and carries no session content. The endpoint always fetches content with `listen`.

### 11.2 Doorbells (optional)

- **Web Push.** `push` is a [Web Push](https://www.rfc-editor.org/rfc/rfc8030.html) subscription `{endpoint, keys: {p256dh, auth}}`.
  - The push endpoint URL is an outbound fetch target. It MUST be HTTPS and pass the protocol §2 SSRF screening. A provider SHOULD accept, at `register`, only origins it recognizes as Web Push services.
  - The provider sends at most one push per delivered invite per endpoint, encrypted under [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html), with `Urgency: high` and a TTL no longer than the time left to `answer_by`.
  - The payload is exactly `{"t":"signal","endpoint":"<endpoint>"}`: no initiator, kind or session.
  - Pushes count against the recipient's invite limits (§13.1).
  - A subscription reported gone is removed.
- **Integration doorbell.** A confidential integration's server MAY receive the SET event `…/events/signaling-doorbell/v1` (payload exactly `{endpoint}`) on its existing events channel ([integrations §6](integrations.md#6-events)), so that it can wake its native app. AMD-SG-E1 registers it.

How an app presents an invite once woken is the app's concern.

### 11.3 Withdrawn: the owner hook

Revision 3.1 removes the owner hook, the provider's last presentation duty. It served only held requests and own-entity invites with no eligible endpoint; the `none` basis is reserved (§15) and own-entity invites route only to the initiating app or its `target` (§5.4), so an invite with no eligible endpoint simply ends silently at `answer_by`. The provider presents nothing about invites (§3.6). Its earlier text is in the [frozen revision 2.1 copy](../superseded/signaling-rev2.1.md#113-the-owner-hook-the-providers-only-presentation-duty); the section number is kept so that references stay stable.

### 11.4 Withdrawn: handoff to the chosen app

Revision 3.1 removes the intents handoff from the owner hook, with the routing handler and the chooser it opened (§11.3, §20.1.5, §20.1.7). A person who starts something still hands off through intents, which is outside signaling.

## 12. Privacy

### 12.1 No presence oracle

Nothing an initiator or its provider observes may depend on any of the following, except a claim the recipient made (including an automatic one under auto-connect, an offer match or a pairing, §5.5). An automatic claim under an offer match reveals availability only to holders of an offer the minting app chose to hand out: for a bound offer, once, at a moment the one invited principal chooses, because the offer is spent at its first admission (§5.2) and so cannot be used to poll; for a person's open offer, to its holders while it lives, at most 900 s (the residual in §5.7); for a service-class offer, what it publishes the offer for, as the owner was told (§4.3, §20.1.4). Under a pairing it reveals availability only to the paired peer, and the owner was told so (§5.8):
- whether the recipient has endpoints, or is online;
- whether it admitted the basis or blocked the initiator;
- whether an offer was live, exhausted, revoked, expired or bound to another principal, or whether a matching pairing exists;
- whether it has an approved handler;
- whether it enabled signaling.

In particular:
- the §9.2 response, its timing and its queue behaviour are uniform;
- `open` succeeds alike for any active entity, whose certification keys are served whether or not it ever registered (RTCd-11);
- there is no busy or presence indication;
- unanswered and owner-ended invites end silently (§8.5);
- a recipient provider MUST NOT send a message the initiator could use to learn any of these.

### 12.2 Device inventory

Endpoints, their count, labels and last-seen times are never disclosed to another entity. Leg keys are per session. The recipient's claimed leg reveals only that one device answered. `endpoints({pairing})` discloses a paired app's endpoints only to another app of the same entity that the owner paired with it, on the side that may open, with the provider's own device names and no last-seen times (§5.8), never across entities.

### 12.3 Address disclosure

- **Before the claim.** No profile parameter carries an address: providers enforce that for the `webrtc` offer (§16.4). A conforming endpoint also puts no address in `context` (§7.2). Providers cannot enforce the `context` rule, because they validate `context` only against an app-chosen schema. So "no address before the claim" is a provider guarantee for profile parameters and an endpoint obligation for `context`, not a provider guarantee overall.
- **After the claim.** `webrtc` candidates go only to the claimed peer leg, under the IP policy. **IP policy governs only `webrtc` profile messages.**
- **`data`.** `data` exists only in `data` sessions, is opaque and is not inspected. An app that deliberately moves addresses through `data` after a claim is beyond provider enforcement, as it already is through its own servers.

Provider enforcement protects against default ICE leaks, not against an app that chooses to disclose addresses.

### 12.4 Minimal metadata and retention

- **Session records.** Providers keep, per session, only what routing, ordering, replay protection and limits need, and delete session records no later than 24 h after the session ends.
- **No logging of payloads or capabilities.** Providers MUST NOT log SDP, candidates, addresses taken from candidates, `data`, `context` values, `ice_servers` credentials, offer tokens (in `open` and `revoke_offer` arguments, `offer` results and the holder provider's outbox, which deletes them with the invite payload, §5.7), or the federation batch `offers` member. Logging a batch means logging at most its shape and counts.
- **Payload deletion.** Payloads are deleted once delivered, or after 60 s. `context` is deleted at claim or end.
- **Limit state** is keyed so that it reveals no more than the limit needs: hashed keys, with no principal named in the record. It expires with its window.
- **Replay state** holds payload hashes, never payloads (§7.3).

### 12.5 Third parties

Doorbell payloads carry no session content. Kind and identity documents are never fetched on a request path from another provider.

### 12.6 Export and deletion

**Export** includes, as owner data:
- the IP policy;
- principal blocks and provider blocks;
- pairings (§5.8): every member, including `opens` and `state`, and pending ones;
- an organization entity's service designation (§4.3).

Session handler approvals, with their `auto_connect` settings, are exported with intents memory (the `intent-choices` family, AMD-SG-I1, Appendix C.2).

**Provider blocks must be exported.** The current code exports `rtc/block/` but neither exports nor excludes `rtc/block-iss/` (a prefix `rtc/block/` does not match it). The renamed provider-block family MUST be exported beside principal blocks.

**Excluded** from export, as transient, derived or secret:
- endpoints (secret: hashed secrets, DPoP bindings, push keys);
- session records, event queues, outboxes and inbound queues;
- offers (transient capabilities, deleted at expiry, §5.7);
- replay, delegate, epoch and limit state;
- relay leases.

**Deletion** is §14.4.

## 13. Abuse

### 13.1 Limits

Values are provider policy (reference values are in Appendix B, RTC-11), but the **kinds** of limit are not. Excess invites are dropped silently at §9.2 step 7, still answered `202`.

**A recipient provider MUST limit, after verification:**
- invites per (initiator origin principal, recipient);
- invites per initiator origin principal across all recipient entities on the host, as one host-wide window;
- for cross-entity invites, invites per (sending issuer, recipient), because one issuer can mint any number of principals;
- pending sessions and invites per recipient;
- connected sessions per recipient;
- messages per leg;
- **the aggregate `data` bytes it relays for each of its entities** in a rolling window, counting what the entity's legs send and receive. This limit kind is required, not optional, because `data` is the only profile whose bytes transit providers (§3.5). Excess `data` ends the leg with `failed` at the receiving side (§9.2 step 7). The sender's provider refuses its own endpoint's excess with `rate_limited`.

**Separate windows (RTCw-M1, R2; AMD-RW3):**
- **Own devices.** `self` invites count only against their own per-entity window, outside every cross-entity window and the host-wide initiator window. No other party can spend it. On the initiator side, own-entity `open` calls count against that same own-device window and not against the entity's `open` window. Otherwise the smaller `open` window binds first and the own-device window never does. That is the reference code today: `opens` (60/h) is taken at every `open`, before `self` (120/h) at admission. Appendix C.1 lists the change.
- **Same-host share.** A provider that counts its own verified principals as individual shares of the issuer windows MUST also bound their total by a per-recipient window below the per-recipient limit, so that foreign initiators keep headroom.
- **Bound offers.** An invite on a bound offer is bounded by the offer's single use, spent at admission. It counts against neither the per-recipient window nor the issuer windows, and it counts against the per-(initiator, recipient) window.
- **Open offers.** Anyone may hold an open offer, so its invites get their own windows and are charged **only** to those and to the host-wide initiator window. They are never charged to the per-recipient window, the per-(initiator, recipient) window or the per-(sending issuer, recipient) window, which unbased and dead-offer invites fill, so a flood of unbased invites from principals at a large issuer cannot lock that issuer's other users out of a published offer. The windows are:
  - a window **per offer**, W;
  - a window **per (initiator origin principal, offer)**;
  - a **per-issuer fair share** of W: one sending issuer may take at most max(W / (n + 1), F) of the per-offer window, where n is the number of issuers already charged to that offer in the current window (the recipient provider's own issuer counts as one) and F is a floor. The + 1 keeps headroom for an issuer not yet seen: when one arrives, the n earlier issuers hold at most n·W / (n + 1), so at least W / (n + 1) is free, which is at least the newcomer's share (the floor can weaken this when n is large).

  Reference values are examples; the values are provider policy. For an offer that is not service-class: W = 60 per hour, 6 per hour per (principal, offer), F = 6 per hour. For a service-class offer: W = 3,600 per hour, 12 per hour per (principal, offer), F = 60 per hour, and a provider MAY raise W for a service entity within that entity's capacity. At most `uses` sessions are pending on one open offer at once, by construction (§5.2). All of these read only the recipient provider's own records and run in the §9.2 step 7 local checks, before anything host-wide.

  An attacker that controls many issuers can still fill W. The operational responses are to block those providers (§13.2), rotate the offer (revoke it and publish a new one), and mint separate offers per audience or channel, so that one flooded or leaked offer does not take the others down.
- **Dead offers.** An invite whose offer is unknown, expired, revoked or exhausted, or bound to another principal (decided by the read-only check at §9.2 step 7, §5.2), counts as an unbased invite against the per-recipient and issuer windows, so that guessing, borrowing or replaying offers is limited.
- **Own-entity pairings.** Own-entity pairing invites count against their own window per (pairing, endpoint pair) (reference value 30 per hour), and stay outside the cross-entity windows, as `self` does. Both endpoints are local, so the pair is known. There are at most two live sessions per (pairing, endpoint pair) at a time.
- **Cross-entity pairings.** The recipient cannot see the initiator's endpoint (leg keys are fresh per session, and endpoints are never disclosed, §12.2), so a per-endpoint-pair key is unenforceable there. The recipient keys both limits **per pairing `id`**:
  - a window of relation-basis invites per pairing (reference value 30 per hour per local covered endpoint, at most 240 per hour);
  - a live-session cap per pairing of at most 2 × the number of local endpoints the pairing currently covers (at least 2).

  Relation-basis invites stay outside the per-recipient and issuer windows, but count against the per-(initiator, recipient) window.
- **Pairing sub-budget.** All pairings of an entity together get a bounded share of its pending capacity, connected capacity and aggregate `data` budget (reference: at most half of each), so that one paired peer, or a busy fleet, cannot take the whole entity's capacity. Own-entity pairings share it with each other, not with `self` sessions of the same app.
- **Open-offer sub-budget.** Sessions admitted on open offers get a bounded share of the entity's pending capacity and of its connected capacity (reference: at most half of each), so that one published offer, whether its holders' sessions are ignored or auto-accepted and held, cannot take the capacity that bound offers, pairings and own devices need. A provider sizes a service entity's capacity as policy. A use is taken only when the routing set is not empty (§5.2), so an offer with no eligible endpoint (for a service-class offer, no online one) takes no capacity.

**Pending reserve.** When pending capacity is short, invites that count as unbased (invites whose offer did not match) and open-offer invites MUST NOT use the reserve. The reserve is split into two shares, so that one class cannot starve the other:
- a **`self` share**, for own-entity invites (`self` and own-entity pairings);
- a **cross-entity share**, for relation-basis pairing invites and matched bound-offer invites.

Reference value: 2 pending sessions per share.

**An initiator provider MUST limit:**
- open sessions and `open` calls per entity;
- live offers per entity (reference value 64), live offers per app within that (reference value 32), and offer mints per app (reference value 120 per hour), counting each offer an `offer` call mints as one mint, and an open offer as one live offer whatever its `uses`;
- key-warming fetches per entity, spent only when the recipient's keys are not held;
- the `data` bytes its endpoints send, within the aggregate budget above.

It refuses its own app with `rate_limited`.

**Endpoints and outbox.** Endpoints are bounded per entity and per app. The outbox is bounded in total and per peer, with a reserve for control statements, and a drain pass never blocks behind one failing peer.

### 13.2 Block lists

- **Principals.** An owner blocks an origin principal.
- **Providers.** An owner blocks a whole initiator provider (issuer origin). This is needed because a foreign issuer can mint principals at will (AMD-RW4).
- **Effect.** Blocked invites are dropped at the block step (§9.2 step 7), silently, and are answered like any other batch. Blocks apply before any offer, so a blocked principal or provider cannot use an open offer. Blocking ends the blocked party's pending invites silently.
- **Pairings.** Blocking a principal deletes every pairing whose `peer.principal` equals it, and blocking a provider deletes every pairing whose `peer.principal.iss` is that issuer. Their claimed sessions end with a control statement `revoked`, and their pending invites silently (§5.8, §14.2). Unblocking does not restore them.
- **Own-entity exemption.** The owner's own principal and its own provider can never be blocked. An invite from the owner's own entity is never blocked, whatever rows are stored, so a block can never break own-device sessions (RTCw-M6-3).
- **A shared block list.** A provider MAY implement these as one blocked-principals and blocked-providers list, shared with other features.

### 13.3 Withdrawn: requests

Revision 3.1 reserves the `none` basis (§15): a cross-entity invite without an offer or a pairing admits nothing, silently, at §9.2 step 7, and is limited as an unbased invite. There are no held requests. The section number is kept so that references stay stable.

### 13.4 Revocation

The following stop new admissions at once:
- revoking, exhausting or expiring an offer (§5.7). Revoking or expiring one also ends, silently, the pending unclaimed sessions it admitted;
- deleting a pairing for any reason in §5.8 (removal, expiry, clearing, a bound client session ending, or a block). A live pairing never becomes pending again (§5.8).

Sessions already connected continue until they end, except that deleting a pairing ends its claimed sessions with `revoked` (§14.2).

## 14. Owner control and lifecycle

### 14.1 Owner controls

These are generic controls. Their presentation belongs in the provider's existing surfaces, not a view for any one use (Appendix C). The 3sln.me layout proposed by the [local clients spike](../../architecture/local-clients-spike.md) §3.2 is one example: provider sessions under Devices, and every app connection, including headless and local clients, under Connected apps.

| Control | Where it belongs |
| --- | --- |
| Approved handlers per kind, and per-app auto-connect for `self` kinds | Intents settings, and the owner's app connections (AMD-SG-I1). |
| Pairings (§5.8): list (including pending and unconfirmed ones, with `opens` and expiry), activate, remove, change the label, set or renew an expiry, and re-confirm after a kind version adds disclosure | Own-entity: with **both** apps' entries in the provider's list of app connections. Cross-entity: with the `local` app's entry, and in a list of cross-entity pairings by peer principal (P4). Created from there, from the enrolment approval page (§5.9), or at an app's request on a provider page. |
| Live offers (§5.7): list per app (kind, invited principal or "anyone" for an open offer, uses spent of `uses`, expiry; never the token), and revoke one, all of an app's, or all | The app's entry in the list of app connections. Revoking ends the pending sessions an offer admitted, silently. |
| Service designation of an organization entity (§4.3): set, with its disclosure, or remove | The organization's owner interface. Removing it revokes the entity's offers longer than 900 s. |
| Endpoints per app, with revoke | The app's entry in the list of app connections. |
| Headless and local clients enrolled under §5.9, with revoke, and (if AMD-SG-D1 is adopted) whether each is a standing device grant, with its last refresh time and whether its refreshes have come from a new network since approval (§20.11) | The list of app connections, local clients grouped by the owner's device label. The provider's list of its own sessions cross-links to the clients approved from each session. |
| IP policy for other entities (`relay` by default, `public` by opt-in) and for own devices | Privacy. |
| Principal and provider blocks | The blocked list. |
| End a live session | The app, or a provider control listing the entity's live sessions. |

Owner actions that widen are governed by the provider's feature gates. Narrowing actions, including ending, revoking, blocking and removing approvals, are never gated.

**Concurrent edits.** Updates to owner signaling settings (IP policy, auto-connect, pairings) are compare-and-swap on a revision, so that a stale interface cannot silently undo a newer choice (DEVLOG 2026-10-27, "Bug hunt round 3 (browser)", R1).

### 14.2 Revocation and narrowing

Each of the following has the effects listed after it:
- unregistering an endpoint, or its expiry 30 days after its last `listen` (§10.2), which has the same effects;
- revoking a session's device or app connection;
- revoking an app's grant on the signaling field;
- removing an app's session handler approval for a kind, or the approval being **cleared** under §20.1.4 (the handler's connection ends, including app removal, or an adopted manifest stops declaring the kind);
- an app's connection ending for any reason;
- revoking or ending a client session, including an enrolled client's session (§5.9);
- disabling a provider feature, or its suspension (extensions §4.2);
- deleting a pairing for any reason in §5.8, including a block (§13.2) (which affects only that pairing's sessions);
- removing an organization entity's service designation (§4.3) (which revokes only its offers longer than 900 s);
- revoking or expiring an offer (which affects only the pending sessions it admitted, §5.7).

These are the only lifecycle triggers. Appendix C.2 lists the code paths they replace.

The provider at once:
1. Stops relaying and certifying for the affected legs.
2. Revokes their relay credentials, best effort.
3. Sends a control statement `revoked` for each **claimed** leg. It retries for as long as the leg's certificate could still be used.
4. Ends **pending** invites silently (§8.5) when the invite was delivered only to that app's endpoints and the app no longer holds the kind. An invite that was also delivered elsewhere keeps pending (RTCe-21).
5. Removes the app's endpoint registrations for the affected kinds.
6. Revokes the live offers of the affected app or feature for the affected kinds, only when the trigger ends that app's or feature's authority for the kind (approval removal or clearing, grant revocation, the app connection ending, the feature disabled or suspended), and the entity's offers longer than 900 s when its service designation is removed (§5.7 "What ends an offer"). Unregistering or expiry of an endpoint, and revoking one client session of an app whose connection remains, revoke no offer.
7. Deletes the affected pairings: every pairing that names the app for an affected kind, or binds the revoked client session (§5.8). Clearing deletes; it never leaves a pairing pending. Their claimed sessions get `revoked` (step 3), and their pending invites end silently (step 4).

A revoked endpoint that still holds an unexpired leg certificate, and posts directly to the peer provider, is refused there once the control statement arrives. The residual window is at most the certificate's remaining lifetime (at most 900 s). If a control statement finds even the reserved outbox full, the session still ends locally, and the same bound applies (RTCd-24).

Re-registering after an endpoint revocation is allowed. To stop an app, the owner removes its approval or grant, or blocks it.

### 14.3 Moves

When an entity's move commits, its source provider:
- ends every session of that entity, with a control statement `moved` for claimed legs and silently for pending ones;
- revokes relay credentials;
- stops issuing leg certificates. Its certification keys are revoked at commit ([identity portability §6.3](identity-portability.md#63-commit-at-the-source));
- deletes the entity's live offers. Offers are transient and never move: an invited party's dial-back after commit reaches the destination, which holds no such offer, and admits nothing;
- deletes the entity's pairings after export. The destination MAY import exported pairings; an imported pairing is a creation (§5.8): it starts pending, needs the destination's approvals, expires after 7 days if still pending, and an own-entity pairing that binds a `client_session` cannot be imported, because client sessions do not move.

Peers' cross-entity pairings name the moving entity by origin principal, which a move does not change, so they keep matching invites that the moved entity sends from its destination.

Peers resolve the current issuer through successor pins, and deliver only there. Messages naming an earlier issuer fail at step 2. Admission state is keyed by origin principal. In-progress sessions are not migrated.

### 14.4 Deletion

Account deletion:
- ends every live session, with a control statement `revoked` for claimed legs and silently for pending ones;
- removes the endpoints;
- removes the pairings and deletes offers;
- closes the entity to new admissions.

The drain that delivers those control statements MUST run before the identity is tombstoned, so that peers can still verify them (RTCd-12, RTC-d review M1). Pinned peer keys (§6.3) cover the peer side.

### 14.5 Authority resets and resource changes

- A higher `aep` from a peer is recorded. A provider MAY end sessions with a peer whose authority reset, and MUST refuse certificates with a lower `aep`.
- Unassigning the built-in signaling resource from the owner's `signaling` field ends every registration and session, as in §14.2.
- Blocking a kind version (artefacts and intents) stops new sessions of that version.

## 15. Interoperability and versioning

- **Discovery.**
  - An initiator provider learns a peer's support, and the peer's profiles, from the signaling declaration in the peer issuer's manifest (§3.1).
  - An app learns its own provider's support from the same declaration and from `…/contracts/signaling/v1` in the manifest `contracts`. It requests the signaling fragment (§3.2). A provider that supplies no candidate for the field MAY report the request `unavailable` under [extensions §4.3](../extensions.md#43-outcomes-from-public-facts-only).
- **Versions.** The extension (by its spec URL), the message, certificate and control `v`, the fragments, the contract, each profile and each kind line version independently, each by its own rule. A receiver rejects an unknown `v`. A new message version is introduced by a new extension version, and a provider declares one version of the line (extensions §2.2).
- **Kind versions.** A recipient provider delivers an invite of kind version *M* to a handler approved for version *N* < *M* only when it has verified that the line is additive from *N* to *M* ([artefacts §7.2](../artefacts.md#72-advancing-a-head)). It then projects `context` to version *N*, and still delivers the raw invite unchanged. A version that adds disclosure needs re-approval ([intents §7.2](intents.md#72-remembered-consent)), and the owner's re-confirmation of each pairing of that kind line (§5.8).
- **No registered kinds.** This document registers no session kinds. Apps and other publishers publish them as public, URL-identified artefacts. §20.1.9 gives one worked example, which is not registered.
- **Reserved:**
  - `relation` values other than `"pairing"` (for example an access entry over an [organizations §9](organizations.md#9-relations) edge);
  - the `none` basis (verified-identity requests with no offer or pairing). Revisions 0 to 3 held such invites for an owner hook; revision 3.1 removes them (§13.3). It is a possible future basis if a consumer needs one, and would need its own presentation and abuse design;
  - `accept` values other than `"auto"` on a pairing, and pairings that span entities on both sides of a fleet;
  - brokered signaling resources;
  - a group member;
  - long-term device keys for end-to-end pinning;
  - a WebSocket or SSE delivery profile;
  - further transport profiles (for example WebTransport);
  - sessions that act for no entity.

## 16. Annex A: the `webrtc` profile (normative)

### 16.1 Scope

It sets up a WebRTC peer connection. Media and data then flow peer to peer, or through relays.

### 16.2 Kind parameters

`session.profiles.webrtc` is exactly `{}`. There is no bound on what a connection carries: that is the endpoints' concern, and a provider could not enforce one over a data channel anyway (§19.3, answer 5). The only media check left is structural (§16.4).

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

- Each endpoint obtains relay credentials only for itself: from the resources in its own entity's `relays` field (§3.3), or from its app's own relay configuration.
- A credential is never sent in a signaling message, or to the peer.
- **The built-in relay resource** issues credentials only for a live leg of its entity:
  - an initiator leg that is pending before `answer_by`, or connected;
  - a recipient leg whose accept claim won.

  The lifetime is at most the shorter of the provider's maximum and the session's remaining life. For a pending leg it is also at most `answer_by`.
- Before issuance it re-checks the handler approval for the session's kind (RTCw-M4).
- It revokes credentials, best effort, when the leg ends, and a sweep revokes whatever the end path missed.
- It enforces its own budget, and MUST NOT rely on client-reported byte counts.
- **Byte cap (normative).** The built-in relay resource MUST NOT issue any relay credential unless a per-owner byte cap is enforced from the relay provider's own usage data: usage attributed to the owner through the credential usernames it issued, with credentials revoked when the owner overruns. Client-reported counts, declared sizes, reservations and admission estimates do not satisfy this. A TURN credential is a bearer token with no byte limit of its own, so without such enforcement relayed bytes, and their cost, are unbounded. This carries the RTC-f production gate (RTCf M1(d)) into the normative text. AMD-SG-S2 (§20.9) proposes the matching security.md gate.
- Its refusals before any credential exists are no-effect outcomes (`not_found`, `forbidden`, `rate_limited`), so ordered failover proceeds (RTCf-10).

## 17. What each party can still do

| Party | Can | Cannot |
| --- | --- | --- |
| The initiator's provider | Impersonate the initiator (it certifies leg keys). See the initiator's sessions, peers, kinds, contexts, timing and address. Drop, delay or forge-cancel its signaling. | Read media or data without substituting a leg. Impersonate the recipient to the recipient's provider. |
| The recipient's provider | The same for the recipient. Learn whether, and on which of its user's devices, a session was answered. | Substitute the initiator's keys toward an endpoint that verifies directly (§16.6). |
| Both providers together, or one provider hosting both parties | Mount an undetected man-in-the-middle, unless the endpoints compare a SAS in-band. | Defeat a compared in-band SAS, except by guessing. |
| A relay operator | See its own endpoints' addresses, peers' relay addresses, timing and volume. | Read or alter DTLS-protected media or data. |
| An app | Anything its code does with what it receives, including moving bytes through `data` or its own servers after a claim. Mint offers for kinds it is approved for, and hand them to anyone. Keep re-minting single-use bound offers for one cooperating peer app, which emulates a short pairing (§5.7). | Start or answer sessions of kinds the owner did not approve. See invites routed to another app. Reach other apps' endpoints, except those of an app the owner paired with it. Create a pairing. |
| A paired peer | Tell when the paired app is running, and connect to it automatically for the paired kind, when the recipient's pairing lets it open. If its own provider does not conform, keep opening after its own owner removes their side, because only the recipient's record is enforced by the recipient (§5.8). | Connect for another kind, or to another app or client session. Keep connecting after the recipient's owner removes, blocks or lets expire the recipient's side. |
| A holder of someone else's bound offer (for example another reader of the app message that carried it) | Nothing: the offer is bound to one principal. | Use it, or learn whether it was used. |
| A holder of an open offer | Connect to the minting app for that kind and profile, as any verified principal it controls, within `uses`, the expiry and the open-offer windows; tell whether that app is running when it auto-accepts. With throwaway principals at an issuer it controls, spend every use of a person app's short open offer while it lives (§5.7). | Use it after revocation, expiry or exhaustion, or learn which of those happened. Use it while blocked. Reach another app or kind. Hold it past 900 s against a person entity's app. Take more than its issuer's fair share of a service's per-offer window, or lock other holders out with unbased traffic (§13.1). |

A provider cannot stop a connection that already exists. Ending a leg relies on the peer endpoint closing it and on relay credentials lapsing.

## 18. Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep `rtc-signaling.v1` as designed | It carries one app-level product into the provider: presentation, history, interruption policy, media in the purpose, dedicated links and SAS. The owner's direction rules that out. |
| A WebRTC-only wire | Simpler, but it hard-codes SDP vocabulary into a Bindle-owned extension. Every non-WebRTC use would then need a parallel extension that duplicates admission, claim and the no-oracle rules. |
| **A slim `signaling-purpose` artefact kind with AMD-X1 bound purposes** (the main rejected alternative) | See §19.1. It keeps a second kind registry beside intents, keeps the only extension-system amendment, and either keeps cross-app visibility (AMD-RW1) or re-builds handler choice outside intents. |
| Provider-signed hop-by-hop events | The receiving provider could rewrite DTLS fingerprints undetectably. |
| Long-lived device keys | They link one device across every session and peer. Per-session keys give the same detection without the tracking. |
| Candidates in the invite, sent to every device | They disclose addresses before anyone answers, and make candidate policy unenforceable. |
| A busy or presence message | It reveals presence to anyone who can reach the recipient. |
| Signaling over messaging or activity | No ordering, latency target or first-claim semantics. Both keep what signaling must delete. |
| Network fetches during verification | Timing would reveal admission and contact relationships. |
| Provider presentation (a provider screen for invites, activity items, or the revision 1 to 3 owner hook) | Presentation is the app's (§3.6). Rev 0 used provider-source activity items; the owner moved all presentation to the app layer. Rev 3.1 removes the remaining owner hook, which only held requests and invites no app could see (§11.3). |
| Two establishment mechanisms, one for invite-style and one for always-on use | It would duplicate the hard part (certificates, claim, relay, privacy) to vary three cells: admission, routing and acceptance. One mechanism with explicit bases (§5.6). |
| An invite opened by the asking side, beside the app's own request message | It needs signaling-specific admission between parties who already reach each other through the app, routes through the intents default (possibly a different app from the one showing the message), cannot survive offline devices within the 120 s window, and presents the request twice. The reverse dial with an `offer` avoids all four (§5.7). |
| Callbacks (one-use, principal-bound contact links, `callback_digest`) | They need a link per request. The offer is a signaling record with the same binding, and no link (§5.7). |
| Keep the `link` basis (owner-configured contact links) | It makes core signaling aware of contacts, and duplicates admission that apps already decide (for example by their own contact lists). An app hands the people it admits an offer (§5.3, §5.7; contacts and links spike CL-9). |
| Standing acceptance: an owner setting that lets a service answer any admitted initiator (revisions 1 to 2.1; reserved in revision 3) | After the `link` basis went, no basis delivered an unsolicited invite for it to apply to. An open offer from a service-class endpoint gives the same reach with an explicit, expiring, revocable, use-counted and rate-limited capability that the service hands out itself (§5.7, SG-43). |
| A separate multi-use "ticket" basis (contacts and links spike §4.6) | The open offer is that basis, with the offer's existing record, routing, no-oracle and revocation rules. A second basis would duplicate them (SG-43). |
| Keep `none` as held requests | Its only actions were dismiss and block, it gave foreign issuers a way to fill an owner-visible list, and it reopened a weak form of the unsolicited reachability that CL-10 rejected. Reserved instead (§15, SG-45). |
| Route own-entity invites through the intents default when the initiating app cannot receive them | §5.1 item 3 already makes the initiating app an approved handler, so the fallback could fire only in a race, and its chooser path handed off to an app that never received the invite. Cut (SG-44). |
| A pairing as a slot assignment or a preferences-assignable resource | Neither represents cross-entity pairings, and a pairing's direction, automatic acceptance, expiry and kind-version pinning are not resource semantics. A per-edge owner record with P1 to P4 gives the same per-party consent (§5.8; local clients spike §4.2, LC-11). |
| Open standing acceptance for app endpoints that answer one known peer | It exposes availability to every admitted initiator. A pairing scopes it to one peer (§5.5, §5.8). |
| Grouping a vendor's clients by registrable domain (I3) | Implicit and wider than the owner meant. An explicit own-entity pairing names both `client_id`s (§5.8). |
| The intents chooser for incoming invites | The event already landed in a specific app, is time-critical, and no person is on a provider page. Intents stay for handoffs a person starts (§5.6). |

## 19. Provisional decisions and owner questions

### 19.1 Kind authorization: intents kinds and approvals versus a slim purpose kind

| | **A. Intents kinds and approvals (adopted)** | **B. Slim `signaling-purpose` kind (documented fallback)** |
| --- | --- | --- |
| What names the use | An intent kind with a `session` member | A separate artefact kind (`id`, `title`, `summary`, `parties`, `profiles`, `context`, `categories`) |
| Per-app authorization | An intents session handler approval (an owner record in intents memory) | Bound consumer options on the grant (the withdrawn AMD-X1) |
| Who receives invites | The app fixed by the basis (§5.4) | Every approved app (AMD-RW1 visibility), or a per-purpose default stored by signaling |
| Changes elsewhere | Intents amendment AMD-SG-I1, which adds an authority record to intents (§20.1.10) | An extensions amendment like AMD-X1, plus a kind registration |
| Reuse | Kind registry, growth tables, disclosure, projection, handler declarations, exclusions | Data schema and disclosure validators only |
| Approval check | Local to the account (intents memory), so no federation-shard call inside the account gate. The RTC-i lock-order class goes away. | Federation grant data, needing the RTC-i dispatch snapshot and approval record (RTCi-1, RTCi-2) |

**Position (provisional).** A is adopted. Session kinds are intent kinds, and session handler approvals are the kind authorization, for every basis. Signaling takes nothing else from intents: no defaults, chooser or handoff (SG-44). It removes a parallel kind registry and any extension-system amendment, and fixes cross-app visibility by construction. B stays the documented fallback.

### 19.2 Decisions (all provisional and unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| SG-1 | A generic signed session channel with profiles. `webrtc` is the first profile, and `data` the second, with the rev 1 limits (§1, §3.5). | Reviewer ___ Date ___ Outcome ___ |
| SG-2 | Session kinds are intent kinds with a `session` member. Every basis fixes the receiving app (SG-23); rev 3.1 removes the routing handler that revisions 0 to 3 used as an own-entity fallback (SG-44). The `rtc-purpose` kind and AMD-X1 are dropped, and AMD-RW1 does not arise (§5.4, §5.6, §19.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-3 | Kind authorization is a session handler approval in intents memory, checked live and locally on every widening operation, including `claim` accept (§10.1). *Revised in rev 3.1:* the routing default, sole-handler promotion and owner-hook chooser are withdrawn (SG-44). | Reviewer ___ Date ___ Outcome ___ |
| SG-4 | No app-level use and no presentation in the provider. Uses and their presentation are app-level, specified by the apps that define them (rev 3: signaling names none). *Rev 3.1:* the owner hook is removed, so the provider has no presentation duty at all (SG-44, SG-45). Signaling creates no activity items, and AMD-SG-A1 and AMD-SG-N1 are withdrawn (§3.6, §11.3, §20.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-5 | *Revised in rev 3 and 3.1.* Admission is `self`, `pairing` (SG-25) or `offer` (SG-24, SG-43); `none` is reserved (SG-45). The `link` basis, owner-side configuration on contact parents (AMD-SG-L1a), `mint_link` and minted parents (AMD-SG-L1b) are withdrawn (contacts and links spike CL-9; §5.3, SG-36). Callbacks were withdrawn in rev 2, replaced by offers (§5.2, §5.7). | Reviewer ___ Date ___ Outcome ___ |
| SG-6 | Consumers are `application` and `provider`. A provider feature that holds sessions is the one feature of its own extension, identified by (issuer, spec URL), acting as a built-in handler for an entity. Cross-entity, it answers only offers it minted, bound or open, and is never a pairing party (rev 3.1; earlier revisions used standing acceptance) (§4.2, §5.8, SG-43, SG-46). | Reviewer ___ Date ___ Outcome ___ |
| SG-7 | Guardrails: no offline delivery, a 120 s answer window, a 24 h session cap, `seq` ≤ 4,095, delete after delivery, payload hashes only in replay state, no history, no multi-party. `data` exists only in the `data` profile, at ≤ 4 KiB per message and 64 KiB per leg, under a required aggregate per-entity budget, and behind a production gate (§1.2, §3.5, §13.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-8 | Adopt AMD-RI1 (uniform 404 for an unknown `aud`), RI2 (one `aud`), RI3 (`to` drop), RI4 (`listen` members), RI5 (`unsupported_peer`), RV2 (re-send bound, refresh lanes) and RW2 (same-host `iss` refusal), and the per-entity-enablement rule (RTCw-R1), with the drain-rate residual recorded (§9, §10). | Reviewer ___ Date ___ Outcome ___ |
| SG-9 | Abuse limit kinds include the aggregate `data` budget, the own-device and same-host-share windows, and the pending reserve. Own-entity `open` calls count against the own-device window (a code change). Cheap checks run before expensive ones. There are per-app endpoint caps. Rev 3 removes the principal-bound link windows and the per-app link quotas with the `link` basis (§13.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-10 | Block lists cover principals and providers, with the own-entity exemption, and both are exported. Mutes are dropped, and there is no signaling interruption policy (§3.6, §12.6, §13.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-11 | SAS leaves the core, and fingerprint binding stays. The media bound is dropped. Only the structural `m=` type check (`audio`, `video`, `application`) remains (§16). | Reviewer ___ Date ___ Outcome ___ |
| SG-12 | The initiator's app origin is disclosed to the recipient, labelled "reported by" for a foreign initiator (RTC-17, RTCe-22). | Reviewer ___ Date ___ Outcome ___ |
| SG-13 | Decline reasons are `declined` and `unsupported`. `busy` is dropped, and end reasons are neutral (§7.2). | Reviewer ___ Date ___ Outcome ___ |
| SG-14 | `ice-relay` is unchanged in substance (a fragment since rev 3), with AMD-RL1 and the RTC-f rules. No credential is issued unless a per-owner byte cap is enforced from provider usage data (§3.3, §16.7, AMD-SG-S2). | Reviewer ___ Date ___ Outcome ___ |
| SG-15 | New identifiers (the extension spec URL, `typ`, media type, fragments, contract) rather than reusing `rtc-signaling.v1`. Nothing is published, so no compatibility is owed (Appendix C). | Reviewer ___ Date ___ Outcome ___ |
| SG-16 | Auto-connect is an owner setting per app and per `self` kind, and requires the same `client_id` (§5.5). Different apps of the owner (a vendor's native and web clients, I3) auto-connect only under an explicit own-entity pairing (SG-25); grouping by registrable domain is not used for signaling. | Reviewer ___ Date ___ Outcome ___ |
| SG-17 | *Reserved in rev 3, replaced in rev 3.1 by SG-43.* Standing acceptance: an owner setting per (handler, kind) for cross-entity kinds, letting a provider feature or service entity accept admitted invites without a user action. Service-class endpoints now auto-accept holders of their own open offers (§5.7). | Reviewer ___ Date ___ Outcome ___ |
| SG-18 | *Withdrawn in rev 3 with the `link` basis (SG-36).* Signaling configuration was forbidden on conditional contact parents. | Reviewer ___ Date ___ Outcome ___ |
| SG-19 | A recipient provider resolves kind versions only from its store, a mirror, or a background fetch whose triggering does not depend on recipient state (§3.4). | Reviewer ___ Date ___ Outcome ___ |
| SG-20 | `target` is restricted to the initiating app's own endpoints, or a paired app's endpoints under an own-entity pairing (§5.4 cases 1 and 4). *Rev 3.1:* glare decides only which session survives; the glare auto-accept exception is removed (§5.5, §8.3). | Reviewer ___ Date ___ Outcome ___ |
| SG-21 | Superseded in rev 2 by SG-23. (Rev 1: two establishment modes, with mode (b) waiting for a spike.) The spike found that the two modes are two uses of one mechanism, distinguished by basis. | Reviewer ___ Date ___ Outcome ___ |
| SG-22 | *Moved out in rev 3.1.* The chooser short-list is an intents matter, carried as AMD-INT-R1 outside signaling (§20.10, SG-42). | Reviewer ___ Date ___ Outcome ___ |
| SG-23 | One signaling mechanism with explicit establishment bases (`self`, `pairing`, `offer`; rev 2 also had `link`, and `none` is reserved since rev 3.1), each fixing admission, routing and acceptance; no second mechanism. Answers S1 and S2 (§5.6; spike SMS-1, CR-13). | Reviewer ___ Date ___ Outcome ___ |
| SG-24 | Invite-style establishment is a reverse dial with an `offer`: a one-use, short-lived authorization bound to the invited principal, the kind and the profile, minted by `offer` and revoked by `revoke_offer`, carried inside an app message, routed to the minting endpoint or app, and claimable with no user action (`offer_match`), in rev 2.1 by the minting endpoint only (SG-31). It replaces callbacks and `callback_digest` (§5.2, §5.4 case 3, §5.5, §5.7, §10.2; spike SMS-2, CR-1 to CR-4). Rev 3.1 generalizes it to open and multi-use offers (SG-43). | Reviewer ___ Date ___ Outcome ___ |
| SG-25 | Always-on establishment is an owner pairing record: created only by owner action, pending until activated (rev 3: explicit activation, SG-39); own-entity it extends `self` across apps (solving I3 for this use); cross-entity it is the relation basis `{"relation": "pairing"}`, with both owners' records required between conforming providers (rev 2.1: the recipient enforces only its own record, SG-34). Routing to the paired app only, `paired` acceptance, own-entity discovery through `endpoints({pairing})`, revocation through removal, approval or grant clearing, and client-session revocation (§5.4 case 4, §5.8, §10.2, §14; spike SMS-3, CR-5, CR-7, CR-11). | Reviewer ___ Date ___ Outcome ___ |
| SG-26 | Standing acceptance was kept only for provider features and service entities, and app endpoints that answer a known peer automatically use a pairing (§5.5, §20.1.4; spike SMS-3, CR-4). Rev 3 reserved standing acceptance (SG-38), and rev 3.1 replaces it with service-class open offers (SG-43); the pairing rule stands. | Reviewer ___ Date ___ Outcome ___ |
| SG-27 | Session kinds MAY restrict their bases with an optional, frozen `bases` member, enforced by both providers (§3.4, §5.1, §5.2, §20.1.1; CR-6). Limits: offer invites bounded by their offer, live offers per entity and mints per app; pairing invites in their own window per (pairing, endpoint pair), with at most two live sessions; both in the pending reserve (§13.1; CR-8). Rev 2.1 re-keys the cross-entity pairing limits per pairing `id` and splits the reserve (SG-33). Glare covers crossing pairing invites (§8.3; CR-9). | Reviewer ___ Date ___ Outcome ___ |
| SG-28 | Headless clients enroll through device authorization, with code entry by default and a QR code optional. The approval page MAY offer the kind approval and pairings bound to the new client session. A standing device grant that survives the approving session's sign-out is proposed as AMD-SG-D1, not applied (§5.9, §20.11; spike SMS-4). Rev 2.1: a device-authorization pairing goes live only after the owner compares a short code in the paired app; the standing mark is exempt only from the approving session's own sign-out, natural expiry and session-count eviction; the post-approval notification names both the pairing and the mark; providers MAY restrict which clients are offered the mark; last-refresh and network-change signals are shown. Rev 3 adds local clients (SG-40). | Reviewer ___ Date ___ Outcome ___ |
| SG-29 | Intents are for user-initiated handoff only, never for routing incoming events (§5.6; spike SMS-5). *Rev 3.1:* signaling uses no intents routing at all (SG-44); the chooser short list and choice history (spike SMS-6) are an intents matter outside signaling. | Reviewer ___ Date ___ Outcome ___ |
| SG-30 | Signaling stays free of app-level use semantics (spike SMS-7, SMS-8, CR-12). *Revised in rev 3:* signaling references no app-level message or presentation. Bindle Messaging owns its call-invite message ([messaging §5.5](messaging.md#55-call-invitations-proposed-unsigned)), and the presentation hint is a separate notice-contract proposal outside signaling (SG-36). | Reviewer ___ Date ___ Outcome ___ |
| SG-31 | Offers (rev 2.1; rev 3.1 widens `offer_match` and replaces spend-at-admission with reserve-then-spend, SG-43; rev 3.2 restores spend-at-admission for bound offers and spends an open offer's use only on accept, SG-49): only the minting endpoint gets `offer_match`, and it MUST check, before any automatic claim, that `basis.offer_digest` equals the digest of an offer token it holds outstanding and that the verified initiator is that offer's principal; other endpoints of the minting app claim only after a user action. The offer principal is compared read-only at §9.2 step 7 and re-confirmed atomically at step 8; limit classification follows the principal match. Revoking or expiring an offer ends the pending sessions it admitted, silently. A per-app live-offer cap and owner list and revoke controls. Key warming at `offer` is issuer-level only. Mint `expires_in` covers the invitation's lifetime plus a skew margin. Offer tokens and the batch `offers` member are never logged (§5.2, §5.4, §5.5, §5.7, §9.2, §10.3, §12.4, §13.1, §14.1; review H1, M1, L1 to L4). | Reviewer ___ Date ___ Outcome ___ |
| SG-32 | Pairings (rev 2.1): coverage binds `client_id` and any bound `client_session` on both sides and in both roles, for routing, `target`, the initiator check, `endpoints({pairing})` and the projection. A direction member `opens` (`local`, `peer`, `both`); device-authorization pairings default to the interactive app opening. `endpoints({pairing})` answers only the opening side, labels endpoints with the provider's Devices names, and omits `last_seen`. Clearing deletes a pairing; only creation produces a pending pairing, which expires after 7 days (rev 3: activation is explicit, SG-39). Principal and provider blocks delete matching pairings, ending their sessions with `revoked`. Creation checks `parties`; a disclosure-adding kind version needs re-confirmation; moves delete offers and pairings at the source (§5.1, §5.4, §5.5, §5.8, §10.2, §13.2, §13.4, §14.2, §14.3; review H2, H4, M2, M3, L6). | Reviewer ___ Date ___ Outcome ___ |
| SG-33 | Pairing limits (rev 2.1): own-entity per (pairing, endpoint pair); cross-entity per pairing `id` at the recipient, with a live-session cap of 2 × the local covered endpoints; a pairing sub-budget of pending, connected and `data` capacity; the pending reserve split into a `self` share and a cross-entity share (§9.2 step 7, §13.1; review H3). | Reviewer ___ Date ___ Outcome ___ |
| SG-34 | Cross-entity pairing creation (rev 2.1): fresh authentication; a handle only under a verified binding, else the full principal and issuer; wording from the kind's profiles and sensitivity categories; a mandatory expiry (default 90 days, at most 1 year, renewable); disclosure that the recipient enforces only its own record (§5.8, §17; review M4, L7). Rev 3: which bases a kind allows is the kind publisher's choice (SG-27); the rev 2.1 recommendation about one app's kind is that app's matter. | Reviewer ___ Date ___ Outcome ___ |
| SG-35 | Glare (rev 2.1) ranks the crossing sessions by SHA-256 over both initiator leg key thumbprints, never by `sid`; equal ranks cancel both (§8.3; review L5). | Reviewer ___ Date ___ Outcome ___ |
| SG-36 | *New in rev 3 (owner direction, 2026-10-27; contacts and links spike CL-9).* Core signaling is unaware of calls, contacts and other app-level features: it names no use, registers no kind and uses neutral examples. The `link` basis, §5.3's contact-link configuration, AMD-SG-L1a and L1b, `mint_link`, the batch `links` member and the link limits, controls and revocation rows are withdrawn. The call-invite text leaves signaling for Bindle Messaging §5.5. CL-10 (`none` admitting) is not adopted (§5.3, §9.1, §13, §14, §20.3, §20.12). | Reviewer ___ Date ___ Outcome ___ |
| SG-37 | *New in rev 3 (extensions rev 3.2, CR-X3-03).* The extension is declared as `{spec, options}`, with `endpoint` an audience endpoint option, prerequisites (directory, artefact-versions) in prose, and its built-in contracts in `contracts`. The slots become the `signaling/v1` and `ice-relay/v1` fragments, whose fields carry `selection` and `consumers`. A provider feature's identity is (issuer, extension spec URL), and `client.feature` and handler approvals use that spec URL. There is no `ref`, no occupant declaration, no slot and no AMD-X1 (§3.1 to §3.3, §4.2, §6.1, §15, §20.1.4). | Reviewer ___ Date ___ Outcome ___ |
| SG-38 | *New in rev 3, superseded in rev 3.1 by SG-43.* Standing acceptance was reserved because, with the `link` basis gone and requests held, no basis delivered an unsolicited cross-entity invite. Rev 3.1 gives public services an admitting basis instead: the open offer. | Reviewer ___ Date ___ Outcome ___ |
| SG-39 | *New in rev 3 (local clients spike LC-11, LC-12; CR-L10).* A pairing stays a per-edge signaling owner record (not a slot assignment or a preferences-assignable resource), under P1 to P4: each party holds its own grant and approval, which a pairing never creates; one consent per edge; explicit activation, never by approving a party; listed with both parties (§5.8, §14.1, §20.1.4). | Reviewer ___ Date ___ Outcome ___ |
| SG-40 | *New in rev 3 (CR-L4 to CR-L9).* Headless clients MAY enroll as local clients (RFC 9278 thumbprint `client_id`, local manifest) and MAY use the loopback flow (M5). The device-authorization pairing confirmation is required for M4 and optional for M5. A local client's `client_id` is per installation for coverage. A local client declares session kinds without `route` (moot for signaling since rev 3.1, which has no handoff, SG-44). The standing mark is never offered to a local client with a web origin. Headless and local clients are listed with the owner's app connections (§5.8, §5.9, §14.1, §20.1.3, §20.11). | Reviewer ___ Date ___ Outcome ___ |
| SG-41 | *New in rev 3 (contacts and links spike CR-K1, CR-K2, L5).* Leg certificates, messages and control statements use the core signed-object profile, which moves from links §3.1 to a core keys specification; until RTC code is removed it imports the core signed-object module, never organization code (§6.1, §20.4, Appendix C). | Reviewer ___ Date ___ Outcome ___ |
| SG-42 | *Rev 3.1: withdrawn, not needed.* Signaling no longer depends on AMD-INT-R1 (SG-44). AMD-INT-R1, without its call-specific item 5, moves to the intents change requests; its text stays readable in the frozen revision 2.1 copy (§20.10). | Reviewer ___ Date ___ Outcome ___ |
| SG-43 | *New in rev 3.1 (replaces standing acceptance, SG-17, SG-26, SG-38, and the reserved ticket idea); revised in rev 3.2 by SG-47 to SG-51, which take precedence where they differ (service-class narrowed, app-owned service offers, single-use bound offers, accept-only spending of open-offer uses, isolated open-offer windows and sub-budget).* The `offer` basis generalizes minimally: an offer MAY omit `principal` (an **open** offer, admitting any verified principal except the minting entity) and MAY admit `uses` 1 to a provider maximum (default 1). Every offer has an expiry and is revocable. Expiry is 10 to 900 s, except that a **service-class** endpoint (rev 3.2: a provider feature, or an app of a designated service entity, SG-50) MAY mint for up to 90 days; such endpoints project `offer_match` on every endpoint of the minting app or feature and so auto-accept holders of their own offers. A person entity's apps may mint open offers only within 900 s. Abuse bounds: a use is reserved atomically at admission, spent by the first claim and released on an unclaimed end; per-offer, per-(principal, offer) and per-(issuer, offer) windows plus the issuer and host-wide windows; open-offer invites never use the pending reserve; revocation ends pending sessions silently; a dead offer looks like an unknown one; tokens are never logged; all checks are local and run first at step 7 (§2, §4.1, §5.2, §5.5, §5.7, §8.6, §10.2, §10.3, §12.1, §13.1, §17, §20.1.4). | Reviewer ___ Date ___ Outcome ___ |
| SG-44 | *New in rev 3.1.* Intents routing is cut from signaling: no routing handler, explicit default, sole-handler promotion, owner-hook chooser, `bsession` handoff or late delivery to a chosen app. Own-entity invites go to the initiating app or a named `target`. Signaling keeps only session kinds and per-app session handler approvals from intents, and no longer depends on AMD-INT-R1. The owner hook goes with it (§5.4, §5.6, §11.3, §11.4, §19.1, §20.1.3, §20.1.5 to §20.1.7). | Reviewer ___ Date ___ Outcome ___ |
| SG-45 | *New in rev 3.1.* `none` (requests) is reserved as a possible future basis. The requests setting, held entries, "Allow later", `basis: "request"` and the owner-visible held list are removed; a cross-entity invite without an offer or pairing admits nothing and is limited as unbased (§5.2, §13.3, §15). | Reviewer ___ Date ___ Outcome ___ |
| SG-46 | *New in rev 3.1.* Pairing addressing: at most one cross-entity pairing per (peer principal, kind line) on an entity, enforced at creation; apps learn the pairings that cover them through `endpoints({endpoint})` and `pairing` events, and nothing else; the M4 confirmation is reachable from the `peer` (interactive) side for every `opens`; provider features are never pairing parties. P3 readings: activation at creation when every party already qualifies, and single-submit activation on an M5 enrolment page. P4 for cross-entity pairings: listed with the local app and in a by-peer list. The M4 confirmation code includes the provider-chosen `user_code` (§5.8, §5.9, §10.2, §10.3, §14.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-47 | *New in rev 3.2 (review of rev 3.1, H1, L-8, L5).* A service-class offer belongs to the minting app or feature, not the minting endpoint: its dial-backs route to every eligible and online endpoint of that app or feature (online: a `listen` outstanding or within the liveness window, reference 60 s), at most 16, and the first claim wins atomically. Other offers keep minting-endpoint routing. An offer ends only on `revoke_offer` or owner revocation, expiry, the end of the minting app's or feature's authority for the kind, removal of a service designation (offers over 900 s), a move or deletion; never on unregistering or expiry of an endpoint, which §14.2 now lists as acting like `unregister`. A move kills published offers (§5.4, §5.7, §10.2, §10.3, §14.2, §14.3). | Reviewer ___ Date ___ Outcome ___ |
| SG-48 | *New in rev 3.2 (H2, M1).* Open-offer invites are charged only to their own windows (per offer, per (principal, offer), a per-issuer fair share of max(W / (n + 1), F)) and the host-wide initiator window, never to windows that unbased traffic fills. Reference values are examples and provider policy, scaled for services (60/h, 6/h, F 6/h; service-class 3,600/h, 12/h, F 60/h). The operational responses are named. An open-offer sub-budget caps pending and connected sessions admitted on open offers (reference: half of each), and no use is taken when the routing set is empty (§5.2, §5.4, §9.2, §13.1, B.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-49 | *New in rev 3.2 (M2, M4, L1).* Bound offers are single-use again and spent at admission (`uses` absent or 1), so a holder cannot re-dial to poll availability. An open offer's use is reserved at admission, spent only by an `accept`, and released by a decline or an unclaimed end. A service-class endpoint MAY decline automatically under its declared policy. A claim and the offer's end are decided atomically at the first-claim authority (§5.2, §5.5, §5.7, §8.2, §10.2, §12.1). | Reviewer ___ Date ___ Outcome ___ |
| SG-50 | *New in rev 3.2 (M3, L3).* Service-class means provider features and the apps of organization entities whose owner designated them service entities, an explicit owner setting with its own disclosure. Person apps, undesignated organizations' apps (including on members' devices) and member-context endpoints are not service-class. A person entity gets standing reachability only through a provider feature it explicitly enables. Service-class bound offers are capped at 7 days (reference), and the approval and designation pages disclose them (§2, §4.1, §4.3, §5.7, §12.6, §14.1, §14.2, §20.1.4, Q10). | Reviewer ___ Date ___ Outcome ___ |
| SG-51 | *New in rev 3.2 (M5, L2, L4, L-6, L-7, Appendix C.2 residual).* Recorded residual: one holder of a person app's open offer can exhaust it with throwaway principals and watch availability while it lives, bounded by 900 s and its small `uses`. Accepted: a person's app re-minting single-use bound offers equals a short pairing without the owner page, bounded by 900 s per offer and unenforceable to forbid. The holder's provider keeps an offer token only in its outbox, never logged, deleted with the invite payload. `pairings` are returned by `endpoints({endpoint})` everywhere. Glare covers pairing invites and same-app own-entity `target` invites only. The Appendix C.2 flag plan no longer ties signaling to intent-links (§5.7, §5.8, §5.9, §8.3, §10.3, §12.4, §17, Appendix C.2). | Reviewer ___ Date ___ Outcome ___ |

### 19.3 Answers to the rev 0 owner questions (provisional, unsigned)

The owner said provisional decisions may be adopted for now without sign-off. These answers are adopted on that basis. Each still needs sign-off.

1. **Intents routing (SG-2, SG-3).** Adopt A provisionally, with M6 (the authority record, made explicit in intents §1, §5 and §9.5, §20.1.10). Rev 3.1 keeps only kinds and approvals from intents and cuts routing (SG-44).
2. **Provider presentation (SG-4).** The provider never interrupts and, since rev 3.1, presents nothing about invites at all (§3.6).
3. **Contact links (SG-5).** Superseded in rev 3: the `link` basis and every contact-link mechanism are withdrawn (§5.3, SG-36).
4. **`data` profile (SG-1, SG-7).** Acceptable with the rev 1 changes: 4 KiB per message, 64 KiB per leg, a required aggregate per-entity budget, `data` only in the `data` profile, payload hashes only in replay state, and a production gate (§3.5, §13.1).
5. **Content bound (SG-11).** Dropped. Only the structural `m=` type check remains (§16.2, §16.4).
6. **RTC-17 / SG-12.** Disclose the app origin, labelled "reported by" for a foreign initiator.
7. **AMD-RI1 (SG-8).** The uniform `404` for an unknown identity.
8. **Provider to provider (§4.3).** A hosted service entity acting through an app or a provider feature. Revisions 1 to 2.1 relied on standing acceptance for an endpoint that answers any initiator; rev 3.1 uses the service's own open offers instead (SG-43, §5.7).

### 19.4 Answers to the establishment spike (provisional, unsigned)

The [establishment-modes spike](../../architecture/signaling-modes-spike.md) (2026-10-27) answered the rev 1 spike questions. Its decisions SMS-1 to SMS-8 are provisional and unsigned, and are adopted here, as narrowed by rev 3, on the owner's permission to adopt provisional decisions without sign-off.

- **S1. Do intents fit every invite-style case?** No, and they are not needed for it. An incoming request already lands in a specific app (the app whose message carried it), it is time-critical, and no person is on a provider page. Invite-style establishment is the `offer` basis, a reverse dial (§5.7, SG-24). Intents stay for handoffs a person starts (SG-29).
- **S2. The shape of always-on establishment.** The pairing record (§5.8, SG-25, SG-39): its own authorization record, with acceptance scoped to the paired app or peer; own-entity discovery through `endpoints({pairing})`, with no inventory leak across entities; routing that bypasses intents and names the paired app; reconnection by replacement sessions under the 24 h cap, at most two live per endpoint pair, in its own window; and pairing controls listed with both parties (§14.1).
- **I3. A vendor's native and web clients under different `client_id`s.** Solved for signaling by explicit own-entity pairing (CR-11). Grouping by verified registrable domain stays unneeded for signaling; it remains in intents only for exclusions.
- **Links re-scope timing.** Moot: rev 3 withdraws every link mechanism from signaling.

### 19.5 Open questions

**Owner questions from the spike** (with the coordinator's provisional recommendation, adopted for now and unsigned):
1. **Reverse dial (SG-24).** Is it acceptable that the invited party's app initiates the signaling session, so that the asking app answers automatically for its own outstanding offer? Recommended: yes.
2. **Pairing replaces open standing acceptance for app endpoints (SG-26).** Recommended: yes. Rev 3.1 replaces standing acceptance for services with open offers (SG-43, question 10).
3. **Standing device grant (SG-28, AMD-SG-D1).** Should a device grant that the owner marks as standing survive the approving browser's sign-out, revoked explicitly (or by credential removal, recovery, suspension or deletion)? Recommended: yes.
4. **Group size.** Is a mesh of up to 16 offers per `offer` call enough, with larger groups using a group service reached through its open offer (§8.6)? Recommended: yes.
5. **Choice history default.** No longer a signaling question: it moved with AMD-INT-R1 to the intents change requests (SG-42).
6. and 7. **Opening a presentation directly, and app-own push.** Not signaling questions. They belong to the notice-contract and Bindle Messaging proposals, which own them (SG-30).

**Owner questions from the rev 2 review** (provisional recommendation, adopted for now and unsigned):
8. **`pairing` in one app's kind (SG-34).** Moot in rev 3: kinds are app-defined, and which bases a kind allows is its publisher's choice (`session.bases`, §3.4). Signaling neither recommends nor forbids a basis for any use.
9. **Cross-entity pairing expiry (SG-34).** Always expire, default 90 days, at most 1 year, renewable? Recommended: yes.

**New in rev 3 and 3.1** (provisional recommendation, adopted for now and unsigned):
10. **Open offers instead of standing acceptance (SG-43; replaces the rev 3 question on reserving standing acceptance).** Your direction asks for "app to app, user to user, provider to provider … flexible enough for all use cases". Reserving standing acceptance (rev 3) left public services (bots, support lines, rendezvous and dial-in group services, provider-to-provider service entities) with no way to be reached. Rev 3.1 lets an offer omit its principal and admit several uses, so a service publishes an expiring, revocable, use-counted capability and answers its holders automatically. Is the shape right? Recommended: yes, with these bounds (revised in rev 3.2): up to 90 days (open) or 7 days (bound, single-use) only for service-class endpoints, which are provider features and the apps of organization entities that their owner explicitly designated as service entities (not other organizations' apps, which may run on members' devices); 900 s for every other app. A person entity never gets a standing public address through its own apps (CL-10). It gets standing reachability only through a provider feature it explicitly enables, whose policy is disclosed then (§4.2), or by designating a separate service entity, with that page's disclosure (§4.3). A service-class offer belongs to its app, routes to the app's online instances and survives instance churn. The windows are per offer and per principal, with a per-issuer fair share that unbased traffic cannot fill, plus an open-offer sub-budget. A dead offer is indistinguishable from an unknown one. Alternatives: keep open offers short-lived for everyone (services re-mint and re-publish often), or forbid open offers on person entities entirely (loses codes shown in person and group invitations an app cannot list by principal).
11. **Local-clients extension identifier.** The proposed local-clients feature (`local-clients.v1` in the local clients spike) is cited here by mechanism only. Recommended: publish it as a Bindle-owned extension spec URL under extensions §2.8 when local-clients.md is drafted.
12. **`none` reserved (SG-45).** Is it acceptable that a verified identity with no offer and no pairing can never reach an entity through signaling? Recommended: yes. A service that wants to be asked publishes a long-lived open offer from a provider feature or a designated service entity (§4.3). A person's app takes requests over its own channel and answers with a bound offer, or shows a short open offer (at most 900 s) where it means anyone present to connect.

**Still open:**
- **Residuals to accept or close.** The drain-rate residual for dark batches (§9.2), the unenforceable `context` address rule (§7.2, §12.3), and the peer-provider residual of cross-entity pairings: against a non-conforming peer provider, only the recipient's record is enforced (§5.8).
- **The core keys specification:** resolved 2026-10-27 as a new [keys.md](../keys.md) (provisional), to which §6.1 and AMD-SG-K1 point.

## 20. Proposed amendments (unsigned)

None of the amendments below is applied to its target document. Each needs protocol and security review and the owner's sign-off.

### 20.1 AMD-SG-I1: session kinds and addressed delivery (intents)

**Target:** [intents](intents.md) §1, §4.1, §4.4, §5, §6, §7, §7.3, §8, §9.5, §12 and §14. **Status:** proposed, unsigned. **Not applied to intents.md.**

**What it adds.** This amendment adds an **authority record** to intents: the session handler approval (§20.1.4). Intents today grants nothing (intents §1, §5, §9.5). §20.1.10 amends those sections explicitly. The approval authorizes a kind for every basis. Intents chooses nothing for signaling: the basis fixes the receiving app (signaling §5.4, §5.6).

#### 20.1.1 The `session` member

An intent kind body MAY carry `session`, exactly `{"v": 1, "parties": "self"|"other"|"any", "profiles": {<profile id>: <profile parameters>}}`, plus the optional member `bases`:
- `profiles` names one to four profiles registered by [signaling](signaling.md) §3.5. Each value is validated by that profile. Both registered profiles take `{}`.
- `bases`, when present, is a nonempty, unique array whose members are drawn from `self`, `pairing` and `offer` ([signaling](signaling.md) §3.4, §5.6). When it is absent, every basis is allowed.

A body with `session` (a **session kind**) MUST also have:
- `effect: "join"`;
- `capability: false`, and no field with the `capability` format (the former `contact-link` format is withdrawn, contacts phase 4);
- `max_bytes` present and at most 2,048;
- at most 8 data properties.

**Growth table.** Add the row `/session`: frozen. A version cannot add or remove `session`.

#### 20.1.2 Not a link intent

A handling provider refuses a session kind received in a `bintent` at its intent-links endpoint (§6), if it has one, with `intent_kind_invalid`, after kind resolution and without handoff. Session kinds reach handlers only through §20.1.6. This keeps links from becoming a way to push invites.

#### 20.1.3 Handler declarations

An app declares a session kind in its manifest `intents` member with `kind`, `version` and `digest`. `route` is optional and unused for session kinds, because signaling has no handoff (signaling §11.4). A provider feature declares session kinds as a built-in handler (§5 "Built-in handlers"), identified by its extension's spec URL. A local client declares session kinds in its local manifest ([local clients spike](../../architecture/local-clients-spike.md) §2.3 rule 3).

#### 20.1.4 Session handler approval

An entity's **session handler approval** is an owner record with these members:
- the handler (`client_id`, or for a provider feature the spec URL of its extension);
- the kind line, with the `{version, digest}` shown;
- the approval time;
- `auto_connect` (boolean, default `false`; allowed only when `parties` is `self`).

Revisions 1 to 2.1 also defined `standing_accept`. Revision 3.1 replaces it with service-class open offers ([signaling](signaling.md) §5.7), so it does not exist.

**What it authorizes.** It lets that handler register endpoints for, open sessions of, receive invites of, and accept sessions of, that kind under [signaling](signaling.md). It is the only authority for a kind. A manifest declaration confers none (§5).

**How it is recorded.** Only by an owner action on a provider page that:
- meets the §7.1 disclosure obligations;
- also shows `parties`, the profiles, and that the handler will see the verified identity, reported app origin and context of every invite routed to it;
- for a provider feature, shows the feature's declared answering policy (signaling §4.2);
- for a service-class handler (signaling §2: a provider feature, or an app of a designated service entity), says that it may hand out open offers lasting up to 90 days and single-use bound offers lasting up to 7 days, that anyone who holds an open one can connect to it automatically on any of its online endpoints, that holders can tell when it is running, and that it may decline automatically (signaling §4.3, §5.7);
- never activates a pairing. It MAY list the pending pairings that this approval would make activatable (signaling §5.8), with their labels, both apps or the peer, the kind and `opens`, each with a link to its own activation control;
- preselects nothing;
- is same-origin and CSRF-protected, with `frame-ancestors 'none'` and controls armed after a delay.

**Who approves.** The entity's owner:
- for a person, that person;
- for an organization entity, a person authorized by the organization's membership and grant policy, acting through its owner interface ([organizations §6.3](organizations.md#63-owner-interface)), with the same disclosures. Owner-interface authority never reaches apps or other entities;
- for a hosted service entity (signaling §4.3), whoever operates that entity's owner interface under the same rule. The operator gets no provider-wide shortcut.

**Where a provider MAY offer it:**
- at authorization of the signaling fragment, for the session kinds in the app's pinned manifest;
- from the enrolment approval page, for the kinds the enrolling client declares ([signaling](signaling.md) §5.9);
- from the `approval_required` answer of signaling `open` and `register`. That answer carries the URL of a provider page on the provider's own origin, never a URL that the app supplies.

**Lifecycle:**
- **Widening.** A later kind version that adds disclosure needs re-approval, as §7.2. Turning on `auto_connect` is widening, and needs the same page.
- **Removal** is immediate narrowing.
- **Clearing.** An approval is cleared when the handler's connection ends, including app removal, or when an adopted manifest snapshot stops declaring the kind. A failed refetch clears nothing.
- **Signaling effects.** Removal, clearing and a connection ending each trigger signaling §14.2 narrowing, which also revokes the app's offers and deletes its pairings for the kind.
- **Exclusions** (§7.4) apply. An excluded handler cannot be approved for that kind until the exclusion is removed.
- **Privacy.** Approvals are owner data. They are listed, removable, exported with the account (the `intent-choices` export) and deleted with it, and are never observable by initiators or other apps.

#### 20.1.5 Withdrawn in revision 3.1: routing handler

The routing handler, its explicit default, sole-handler promotion and the chooser offered from the owner hook are withdrawn with intents routing (signaling SG-44). Their earlier text is in the [frozen revision 2.1 copy](../superseded/signaling-rev2.1.md#2015-routing-handler).

#### 20.1.6 Addressed delivery (amends §6)

§6 says "The provider MUST NOT act on an intent itself, MUST NOT call a handler server-to-server, and MUST NOT send the intent anywhere except the route of the handler the viewer chose." Add:

> For a session kind, the provider delivers an admitted invite only to the signaling endpoints of the routing set that [signaling](signaling.md) §5.4 defines: the app that minted the offer, the paired app, or for own-entity sessions the initiator's own app or its target. It delivers by the handler's own `listen` calls and payload-free doorbells, never by calling the handler's servers with session content, and never to another app.

#### 20.1.7 Withdrawn in revision 3.1: session handoff

The `bsession` handoff from the owner hook is withdrawn (signaling §11.4, SG-44). Its earlier text is in the [frozen revision 2.1 copy](../superseded/signaling-rev2.1.md#2017-session-handoff-amends-8).

#### 20.1.8 Feature and amendment rows

A provider that supplies the built-in signaling resource processes session kinds as above. That is local behaviour, and it is not tied to declaring the intent-links extension (signaling §3.1). Add a §14 row: "AMD-SG-I1, session kinds (with optional `bases`), session handler approvals (an authority record) and addressed delivery, proposed by signaling §20.1."

#### 20.1.9 Worked example (not registered)

The line `https://sync.example/kinds/device-sync/v1`, published by a hypothetical sync app, has:
- `effect: "join"`, `capability: false`, `max_bytes: 64`;
- `data` `{"properties": {}, "required": []}`;
- `disclosure` `{"categories": ["personal-data"], "fields": {}}`;
- `session` `{"v": 1, "parties": "self", "profiles": {"data": {}, "webrtc": {}}}`.

An app approved for it with `auto_connect` syncs its own devices without prompting, and only with itself.

#### 20.1.10 Explicit amendments to intents §1, §5 and §9.5

- **§1 Model.** After "An intent grants nothing.", add: "The one authority record this document defines is the **session handler approval** (AMD-SG-I1): an owner record, not an intent, that authorizes a handler to use [signaling](signaling.md) for one session kind. It is recorded only by an owner action, and never by an intent, link or declaration."
- **§5 Handler declarations.** In the first rule, after "`intents` grants nothing", add: "and never creates a session handler approval". In "Change handling", after "Removing a kind clears the viewer's default for that handler and kind", add: "and clears that handler's session handler approval for the kind, which narrows signaling at once (signaling §14.2)". The statement that a declaration "confers no authority" stays true.
- **§9.5 Malicious handlers and minters.** Add: "A session handler approval is authority. An approved handler receives the verified identity, reported app origin and context of every invite routed to it. So an approval is recorded only by an owner action with the §20.1.4 disclosures, is removable at any time, is cleared with the connection, and is checked live on every widening signaling operation. For an organization or a hosted service entity, only a person authorized through its owner interface approves (organizations §6.3)."

#### 20.1.11 Chooser short-list (moved out)

Moved to AMD-INT-R1 in revision 2, and out of signaling in revision 3.1 (§20.10).

### 20.2 AMD-SG-A1: provider-feature source items (activity) — withdrawn in revision 1

Revision 0 proposed provider-source activity items for invites. Revision 1 withdraws it, following the owner's direction that presentation belongs to apps. Signaling creates no activity items. The precondition revision 1 set for any later activity mirror is in the [frozen revision 2.1 copy](../superseded/signaling-rev2.1.md#202-amd-sg-a1-provider-feature-source-items-activity--withdrawn-in-revision-1); since revision 3.1 there is nothing left to mirror.

### 20.3 AMD-SG-L1: withdrawn in revision 3

AMD-SG-L1a (owner-side signaling configuration on contact parents) and AMD-SG-L1b (`mint_link`, minted parents and delivery-off) are withdrawn with the `link` basis (§5.3; contacts and links spike CL-9, CR-S3). Nothing is proposed to links.md by this document.

### 20.4 AMD-SG-K1: signature domains (core keys specification)

This replaces AMD-R1. Certification keys gain the uses `bindle-signaling-leg+jwt` and `bindle-signaling-control+jwt`. Add rows for both, and for `bindle-signaling-message+jwt` (leg keys), separated by `typ`, to the signature-domain table. That table is in the core [keys §4](../keys.md#4-signature-domains) specification (contacts and links spike CR-K1); the rows target it and organizations §3a.3.

### 20.5 AMD-SG-P1: extension descriptor

This replaces AMD-R2. Extensions revision 3.2 (draft) already carries the signaling row of its §2.8 table, the descriptor in its §2.3 and the example in its §11.2. What remains is to publish that descriptor with this specification. No protocol feature-table row is added, and the extension has no intents or intent-links prerequisite (§3.1).

### 20.6 AMD-SG-E1: doorbell event (integrations §6.2)

This replaces AMD-R3. Register `signaling-doorbell/v1`, with payload exactly `{endpoint}`.

### 20.7 AMD-SG-N1: push for activity items (notifications) — withdrawn in revision 1

Signaling creates no activity items (§3.6), so it needs nothing from notifications. Endpoint doorbells (§11.2) are signaling's own, and carry no content.

### 20.8 Withdrawn by this draft (proposed)

| Amendment | Proposed withdrawal |
| --- | --- |
| AMD-X1 (extensions revision 2 §13) | Withdrawn by extensions revision 3 (EXT3-16). The code paths are extensions change request CR-X3-20. |
| AMD-R4 (`rtc-purpose` kind) and AMD-R5 (`rtc-ticket/v1` link type) | Replaced by AMD-SG-I1. AMD-R5 has no successor since revision 3 (§20.3). |
| AMD-RW1 (cross-application visibility) | Does not arise under §5.4. |
| AMD-SG-A1 and AMD-SG-N1 (proposed in revision 0) | Withdrawn in revision 1 (§20.2, §20.7). |
| Callbacks and `callback_digest` (rev 1 §5.3, §7.2 and AMD-SG-L1b) | Withdrawn in revision 2, replaced by the `offer` basis (§5.7). |
| AMD-SG-L1a and AMD-SG-L1b | Withdrawn in revision 3 with the `link` basis (§5.3, §20.3). |
| AMD-INT-R1 item 5 (a candidate `start-call` intent kind) | Withdrawn in revision 3: core registers no kinds, and an app publishes its own (§20.10). |
| AMD-INT-R1 items 1 to 4 | Moved out of signaling in revision 3.1, to the intents change requests: signaling no longer routes through intents (§20.10, SG-42, SG-44). |
| AMD-SG-I1 routing handler, promotion and `bsession` handoff (§20.1.5, §20.1.7) | Withdrawn in revision 3.1 (SG-44). |
| The rev 2.1 §20.12 references to app-level messages and presentation | Removed in revision 3. Bindle Messaging owns its call-invite message (messaging §5.5); the presentation hint is a separate notice-contract proposal (§20.12). |

### 20.9 Proposed security.md amendments (AMD-SG-S1, AMD-SG-S2)

**Not applied to security.md.** Both need security review and sign-off.

**Reconciliation note.** The review pointed at security.md "around line 224" for the position on hosted payload copies. security.md has 85 lines. The position is in two places: the security.md "Trust boundaries" paragraph (hosted 3sln infrastructure is trusted with plaintext under v0, with no end-to-end encryption claim, S1) and DEVLOG 2026-10-12, line 224 ("Direct WebRTC data channels avoid hosted payload copies"). The `data` profile introduces small hosted copies of opaque app payloads, so the custody statement needs one sentence more.

**AMD-SG-S1 (security.md "Trust boundaries"): hosted signaling copies.** Proposed text:

> Signaling ([signaling](signaling.md)) relays SDP, ICE candidates and small opaque `data` messages through the providers of both parties. These are hosted plaintext copies: held until delivered or for at most 60 s, never logged, kept in replay state only as hashes, and capped at 4 KiB per `data` message, 64 KiB per leg and an aggregate per-entity budget. Providers make no confidentiality claim for them. Bulk application bytes belong on direct peer connections, which avoid hosted payload copies. An app that needs confidentiality from providers encrypts `data` end to end, and authenticates its keys independently of the provider-certified leg keys (for example with an in-band SAS), because the providers certify those keys.

**AMD-SG-S2 (security.md "Required verification before a public beta" and sign-off checkpoints): relay byte cap.** Proposed text:

> **Hosted relay.** No `ice-relay/v1` credential is issued unless a per-owner byte cap is enforced from the relay provider's own usage data, attributing usage through the issued usernames and revoking credentials that overrun. Client-reported counts, declared sizes, reservations and admission estimates do not satisfy this gate. A TURN credential is a bearer token with no byte limit of its own.

### 20.10 AMD-INT-R1: moved out of signaling

Revision 3.1 withdraws AMD-INT-R1 from this document: signaling no longer depends on it (SG-42, SG-44). Its items 1 to 4 (chooser order and short lists, the single-candidate confirmation, the choice history, and the scope rule that intents never route incoming events) are generic intents obligations, carried as an intents change request. Item 5 was withdrawn in revision 3. The text as proposed is in the [frozen revision 2.1 copy](../superseded/signaling-rev2.1.md#2010-amd-int-r1-chooser-ordering-short-lists-and-scope-intents).

### 20.11 AMD-SG-D1: standing device grants (device authorization)

**Target:** [device authorization](device-authorization.md) §5.1, §7 item 4, §8 and §10. **Status:** proposed, unsigned, from the spike's finding (§1.4). **Not applied to device-authorization.md.**

**Problem.** Device authorization §7 item 4 revokes a client session when the approving login session is ended explicitly, including by sign-out. A headless client enrolled from a phone browser (§5.9) then ends silently when the owner signs out of that browser.

**Proposal.**
- **Marking.** On the approval page (§5.1), the owner MAY mark the grant as a **standing device grant**, with a separate, unchecked control, armed after a delay, that says the client keeps working after the owner signs out of this browser, until it is revoked from the owner's list of app connections. Nothing is preselected. **Providers MAY restrict which clients are offered the mark** (for example only clients whose metadata declares a headless or daemon use, or clients the provider has reviewed). They MUST NOT offer it on a page whose approval it would treat as alongside the device without code typing, and MUST NOT offer it to a local client whose recorded origin is a web origin, whose page origin is shared by everything served there ([local clients spike](../../architecture/local-clients-spike.md) §2.3 rule 16, LC-9).
- **Lineage (rev 2.1).** A standing device grant's client session is exempt from **exactly three** lineage events of the approving login session: that session's own sign-out (the owner signing out of that one browser), its natural expiry, and its eviction by a session-count limit. Everything else in item 4 still revokes it, checked live on every refresh and resource request, failing closed: global sign-out ("sign out everywhere"), remote revocation of the approving session (for example from a list of signed-in sessions), a credential change or removal, recovery, account suspension or deletion, and explicit revocation of the grant. Global sign-out and remote revocation are deliberate "cut everything off" actions, often taken after a suspected compromise, so they must reach standing grants too. Item 6 chains apply unchanged to everything else.
- **Revocation.** The provider's list of the owner's app connections (device authorization §8; for local clients, the grouping of the local clients spike §3.2) lists standing device grants distinctly, and revokes them individually. Revoking one ends the client session, and through signaling §14.2 its endpoints, sessions and bound pairings.
- **Signals (rev 2.1).** For each standing grant, that list shows the time of its last refresh and whether its refreshes have come from a different network than at approval since then (a coarse signal derived from the provider's own request records, such as a changed network prefix or country; not a location), so that an owner can notice a grant used from somewhere unexpected.
- **Pairing confirmation (signaling §5.9 step 5).** A pairing created on an M4 approval page goes live only after the owner compares a short code that the client displays, reached from the paired app, on a provider page. A pairing created on an M5 page needs no code (CR-L5).
- **Lifetime.** The idle limit of §7 item 2 still applies. A provider MAY cap the absolute lifetime of standing grants, and states it in `refresh_expires_in`.
- **Security considerations.** A phished approval marked standing survives the victim's sign-out, so §10.1's mitigations (fresh authentication, code typing by default, post-approval notification) are required for the mark. The post-approval notification names both the standing mark and any pairing created on the page (its label, the paired app and the kind), with a direct link to revoke each.

Until AMD-SG-D1 is adopted, a provider SHOULD warn at approval that signing out of the approving browser ends the client (§5.9).

### 20.12 Withdrawn in revision 3: references to app-level uses

Revision 2.1 listed, as references only, an app's message type and a presentation hint that use signaling. Revision 3 removes them: signaling names no app-level use (SG-30, SG-36). Apps specify their own uses; Appendix A.6 records where that text went.

## 21. Conformance tests

### 21.1 Required coverage

Tests MUST cover:

- **Declaration and fragments.**
  - Both fragments validate against the protocol §3 member table, with `selection` and `consumers` on their fields.
  - A brokered registration of the signaling contract is refused.
  - `consumers` includes `provider`. A provider feature endpoint is gated by its enabled grant, and its leg certificates carry `client.feature` equal to its extension's spec URL.
  - The declaration's `profiles` option is respected: `unsupported_peer` for a missing profile. A declaration without its prerequisites, or whose `endpoint` equals another audience endpoint, is absent.
  - Field values are invisible to other providers.
- **Session kinds** (AMD-SG-I1).
  - Each `session` rule: `effect`, `capability`, `max_bytes`, 8 properties, no capability format, frozen `/session`, and `bases` shape (nonempty, unique, known values; `link` and `none` are invalid).
  - `bases` enforcement: `open`, `offer` and admission each refuse a basis the kind does not list, the recipient silently at step 7.
  - A session kind in a `bintent` link is refused.
  - Context is projected to an older approved version, only after additivity.
  - No kind is fetched on a federation request path, and no kind fetch is triggered or skipped because of recipient state (§3.4).
- **Approval and routing.**
  - `open` and `register` are refused for an unapproved kind (`approval_required` with a provider-origin URL).
  - Approval removal, approval clearing and a connection ending each run §14.2: sessions and endpoints end, silently for pending invites delivered only to that app.
  - Each invite reaches only the app its basis fixes: the minting app, the paired app, or the initiating app or its `target`, whatever the owner's intents defaults. No chooser, handoff or owner-visible record exists for any invite.
  - An own-entity invite whose routing set is empty (for example the initiating app's approval removed before admission) ends silently at `answer_by`.
  - Late delivery to an endpoint that registers before `answer_by`.
  - A foreign initiator's asserted `client_id` never affects routing.
  - Own-entity routing to the initiator's own app and to `target`. A `target` of another, unpaired app is refused.
  - Auto-connect is refused when the `client_id` differs, or the kind is not `self`.
  - `claim` accept is refused after the approval is removed. `claim` decline still works.
- **Offers** (§5.7).
  - `offer` checks the approval, `parties`, profile, `bases` and limits live; refuses the owner's own principal and more than 16 principals; and its result is never journaled.
  - **Uses.** Under concurrent dial-backs, spent plus reserved uses never exceed `uses`; every excess invite admits nothing and ends silently at `answer_by`. A bound offer's single use is spent at its first admission whatever the session's outcome, so a second dial-back (after no answer, a decline or a cancel) admits nothing, and `offer` refuses `uses` other than 1 with `principals`. An open offer's reserved use is spent only by an `accept`, and released by a decline or an unclaimed end, after which another dial-back can use it. An offer-basis invite whose routing set is empty admits nothing and takes no use.
  - A bound offer presented with a wrong principal admits nothing, silently, and reserves nothing; the right principal can still use it.
  - Expired, revoked (`revoke_offer`) and exhausted offers, and another kind line, profile or unadmitted version, admit nothing, with the uniform `202` and no difference in timing class or limit treatment from an unknown digest.
  - An offer-basis invite on an offer that is not service-class is routed to the minting endpoint, else to the minting app's other eligible endpoints. A service-class offer is routed to every eligible and online endpoint of the minting app or feature, whether or not the minting endpoint still exists; a registered endpoint past the liveness window is reached only by late delivery once it listens. Unregistering or expiry of the minting endpoint revokes no offer.
  - `offer_match` is projected true only on the minting endpoint, except that for an offer minted by a service-class endpoint it is true on every routed endpoint of the minting app or feature.
  - **Open offers.** An open offer admits any verified principal except the minting entity, within `uses`. `expires_in` above 900 s is refused for an endpoint that is not service-class, above 90 days for any open offer, and above 7 days for any bound offer. A blocked principal or provider cannot use one. The per-offer and per-(principal, offer) windows and the per-issuer fair share hold, with many principals from one issuer; a flood of unbased invites from one issuer does not stop that issuer's other principals from using an open offer; a new issuer finds headroom after earlier issuers took their shares; the open-offer sub-budget holds; open-offer invites never use the pending reserve; and an invite on an open offer is never charged a host-wide check before the local ones.
  - The approval page of a service-class handler, and the service-designation page, carry the open- and bound-offer disclosure. An app of an undesignated organization (including one on a member's device), an endpoint registered in member context and a person's app are not service-class: 900 s cap and minting-endpoint routing. Removing a designation revokes the entity's offers longer than 900 s.
  - A service-class endpoint's automatic decline releases the open offer's use. A claim racing the offer's revocation or expiry either connects (claim first; the use is spent) or fails with `claimed` (end first; the use is released), never both.
  - The holder's provider never logs the token and deletes it from its outbox with the invite payload.
  - A reference endpoint claims automatically only when `basis.offer_digest` matches an outstanding token it holds and the verified initiator is that token's principal; an invite whose `context` names an outstanding request but whose digest does not match is not auto-claimed.
  - The principal is compared read-only at step 7 and re-confirmed at step 8; a live offer presented by the wrong principal is classified as an unbased invite for limits.
  - `revoke_offer`, owner revocation and expiry each end the pending unclaimed sessions the offer admitted, silently (no batch or control to the initiator).
  - The token, bound or open, is never in a `listen` event, a log (including `open` and `revoke_offer` arguments, `offer` results and the batch `offers` member) or an export; only its hash is stored.
  - Narrowing the minting app revokes its offers. The per-app live-offer cap. The owner lists and revokes live offers without seeing tokens.
  - `offer` triggers no fetch of a named principal's identity document or certification keys; only issuer-level metadata may be warmed.
- **Pairings** (§5.8).
  - Created only through the owner page; no method lets an app create one. Creation is refused when the kind's `parties` does not admit the peer type, when a side names a provider feature, or when a cross-entity pairing for the same (peer principal, kind line) already exists in any state.
  - Pending until explicitly activated: it admits, routes and accepts nothing meanwhile. Approving or granting a party never activates it. The activation control is offered only once every party holds its own grant and approval; a creation whose parties already hold them creates it live. On an M5 enrolment page, the single submit activates it only if every party then qualifies. A pairing still pending after 7 days is deleted.
  - One pairing per edge: no pairing covers a second app or peer. An own-entity pairing is listed with both apps; a cross-entity one with its local app and in the by-peer list; either listing removes it.
  - `endpoints({endpoint})` returns exactly the pairings that cover that endpoint, in every state, and a `pairing` event reaches only covered endpoints on creation, state change and deletion. No other app or endpoint learns a pairing `id`.
  - **`client_session` binding in both roles.** With a side bound to one client session, another session of the same app on that side: cannot open to the paired app (`target` refused, relation `open` refused); is not in the routing set; is not returned by `endpoints({pairing})` and gets no extra endpoints when it calls it; and gets neither `auto_connect` nor `paired` in its projection.
  - **`opens`.** An invite from a side that may not open is not covered (own-entity `target` refused; relation basis admits nothing at the recipient, and the initiator's `open` is refused). `endpoints({pairing})` answers only the opening side. A device-authorization pairing defaults to the interactive app opening.
  - `endpoints({pairing})` labels paired endpoints with the provider's own name for the device or client session (for a local client, the owner-authored label), never the `register` label, and carries no `last_seen` for them.
  - Own-entity: `target` of a covered endpoint is allowed, `auto_connect` and `paired` are projected, and a `target` of an unpaired app is refused.
  - Cross-entity: a relation-basis invite with no matching recipient pairing gets the uniform `202` and admits nothing; the initiator's `open` with `relation` and no own covering pairing is refused. A recipient whose peer provider skips that check still admits only under its own record.
  - Cross-entity creation requires fresh authentication, shows a handle only under a verified binding (else the full principal and issuer), uses wording from the kind's sensitivity categories, and always sets an expiry (default 90 days, at most 1 year).
  - Routing to covered endpoints only.
  - Revoking a device-authorization client session ends paired sessions with `revoked` and deletes the pairings bound to it. Removing a pairing, its expiry, approval or grant clearing, and a principal or provider block matching `peer.principal` do the same. Restoring an approval, or unblocking, does not restore a deleted pairing.
  - A kind version that adds disclosure stops covering until the owner re-confirms the pairing.
  - A pairing bound to a device-grant (M4) client session is `awaiting_confirmation` until the code comparison; `endpoints({pairing})` from the `peer` side answers `approval_required` meanwhile, for each of `opens` `local`, `peer` and `both`; a mismatch deletes it; the code changes with the `user_code`. A pairing bound to an M5 client session never uses a code.
  - **Limits.** Own-entity: at most two live sessions per (pairing, endpoint pair), and the per-(pairing, endpoint pair) window. Cross-entity, at the recipient: the window per pairing `id`, and at most 2 × the number of local covered endpoints live sessions per pairing `id`, whatever number of distinct initiator endpoints, leg keys or `sid`s the peer uses. All pairings together stay within the pairing sub-budget of pending, connected and `data` capacity.
  - Crossing pairing invites resolve by glare (§8.3), and so do crossing same-app own-entity `target` invites; untargeted own-entity invites do not glare.
  - A move deletes the source's offers and pairings; an imported pairing starts pending; a peer's pairing keyed by origin principal keeps matching after the move.
- **No standing acceptance.** No approval carries `standing_accept`, and no projection carries it. A provider-feature or service-entity endpoint claims a cross-entity invite automatically only under `offer_match`.
- **Admission.**
  - Each basis.
  - A cross-entity invite with no basis admits nothing, with the uniform `202`, is limited as unbased, and creates no record; `open` refuses it.
  - An invite carrying `callback_digest` or `link_digest` is invalid (unknown member), a batch carrying `links` fails step 1, and no `mint_link` method exists.
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
  - an owner end, a narrowed approval, a revoked grant, a gap failure, a reused `seq`, queue overflow and deletion, each before a claim.

  A claimed session still gets its control statement.
- **Transport.**
  - `202` with an identical body and timing class across every step 2 to 8 outcome.
  - A uniform `404` for an unknown `aud`.
  - An entity with signaling disabled answers like an enabled one, including `400` for a step-1-invalid batch, and `503` when its queue is full.
  - Two audiences give `400`.
  - The public endpoint refuses this host's own `iss`.
  - Refresh scheduling is bounded and off the request path, with lanes not depending on the response.
  - Whole-batch refusal.
  - Control statements are retried until the affected certificates expire, and bypass the cross-provider kill switch.
  - Per-issuer limits across many principals from one issuer.
  - Delivery goes only to the current issuer's manifest endpoint.
  - Invite re-send happens only after a `202`, at most twice.
  - Shedding is never by claimed issuer.
- **Abuse.**
  - Every §13.1 limit kind, including the aggregate `data` budget.
  - Own-entity `open` calls count against the own-device window, not the `open` window.
  - Own-device invites unaffected by a flood through the issuer windows.
  - The same-host share bound.
  - The pending reserve.
  - Cheap checks first: no handler-eligibility or host-wide call for blocked or unbased invites.
  - Per-app endpoint caps.
- **Blocks.** Principal and provider blocks are silent and end pending invites. Own-entity invites are never blocked. The own principal and own issuer cannot be blocked.
- **No presentation.** Signaling creates no activity item, notification, push to the owner or owner-visible record of any invite.
- **`webrtc` profile.**
  - Each §16.4 rule.
  - Candidates before the claim.
  - IP policy, and its live narrowing, enforced on the sender's `send`.
  - A `relay` endpoint connecting to a peer that sends `srflx` candidates.
  - Direct identity fetch refused under `relay` without opt-in.
  - The structural `m=` check (`audio`, `video`, `application` only).
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
  - No SDP, candidates, `data`, context, credentials, offer tokens or batch `offers` member in logs, or past their bounds.
  - Exact doorbell payload.
  - No endpoint data in any cross-entity response.
  - Export includes provider blocks (the `rtc/block-iss/` gap closed), pairings, and approvals with `auto_connect` in `intent-choices`. It excludes secrets, transient state and offers.
- **Abuse, rev 2 and 2.1.** Bound-offer invites count only against the per-(initiator, recipient) window; wrong-principal, unknown, exhausted or expired offers count as unbased invites; the live-offer (per entity and per app) and mint limits. The pending reserve is split: a flood of cross-entity offer and relation-basis invites cannot take the `self` share, and own-entity invites cannot take the cross-entity share.
- **Glare (rev 2.1).** Both endpoints compute the same ranks from the two initiator leg key thumbprints; a peer that chooses its `sid` cannot change the outcome; equal ranks cancel both sessions.

- **Rev 3.**
  - Enrolment with a local-client identifier (thumbprint `client_id` proven by DPoP at request) under M4 and M5; a local client's pairing covers only its installation.
  - The standing mark is never offered to a local client whose recorded origin is a web origin.
  - The enrolment page offers one pairing control per already-connected candidate app, each needing its own activation.
- **Rev 3.1.** No routing handler, default, chooser or handoff exists; open offers (above); at most one cross-entity pairing per (peer principal, kind line); pairing ids only through `endpoints({endpoint})` and `pairing` events; provider features refused as pairing parties; glare never auto-accepts.
- **Rev 3.2.** Service-class offers route to the app's online endpoints and survive endpoint churn; bound offers are single-use at admission; open-offer uses are spent only by accept; open-offer windows are isolated from unbased traffic, with a per-issuer fair share; the open-offer sub-budget; no use with an empty routing set; the service designation; claim versus offer end is atomic; the glare scope (all above).

**Engine-level and chaos coverage.** These are expected first at the engine level: offer use reservation, spend and release races (including a decline and an unclaimed end racing a new dial-back, and a claim racing revocation), service-class routing under instance churn, the per-issuer fair share, open-offer windows under many principals from one issuer, principal mismatch, minter routing, offer revocation ending admitted pending sessions, pairing pending, activation and revocation (including activation racing a party's revocation), `client_session` coverage in both roles, `opens`, cross-entity per-pairing caps, and device-authorization revocation cascading into paired sessions, plus a seeded chaos test of concurrent offers, claims, offer revocations, pairing removals, blocks and client-session revocations (spike §7 item 2).

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
- both session flows (formerly the two call flows);
- cancel crossing an accept;
- the first answer only;
- 5xx retries;
- `unsupported_peer`;
- the DPoP-optional manifest;
- control statements from the wrong party;
- fan-out and first claim, now within one routing set;
- the 32-message buffer;
- the `to` rule;
- the fragment request on a provider declaring the extension.

**Changes:**

| Existing test | Change |
| --- | --- |
| "§8.2 an aud naming no hosted entity answers 202" and "§8.1 RTCe-3 … two audiences" (the two todos) | They become assertions of the adopted AMD-RI1 (`404`) and AMD-RI2 (`400`). The suite should then run with 0 todos. |
| "§3.1 … rtc-signaling.v1" (two tests) | Assert the `{spec, options}` signaling declaration, including `profiles`, and that no intents or intent-links declaration is required of a peer. |
| "§4.3 ticket uses …" and "§4.3 a principal-bound ticket …" | Retired with the `link` basis (rev 3). |
| "§4.3 inbound/outbound callback …" (two tests) | Callbacks are withdrawn (rev 2). Replace with offer tests: an inbound offer-basis invite admitted within its uses and routed to the minter, and a wrong-principal bound offer admitting nothing and reserving nothing. Assert that an invite carrying `callback_digest` is invalid. |
| "§4.2 link basis …" | Retired (rev 3). Replaced by an assertion that an invite carrying `link_digest`, or a batch carrying `links`, is invalid. |
| "§6.2 invite body rules: ring_until, media, context, sas_commit …" and "§6.2 only the caller leg sends sas …" | Drop the SAS cases. Add `params`, `profile` and `kind` cases. |
| "§6.2/§9.1 … ring_until beyond iat + 120 or media beyond the opened media" | Becomes `answer_by`. The media cases are dropped (§16.2). |
| "§4.4/§12 a silent owner decline, an unanswered ring and an app revocation send the caller nothing" | Kept, extended with the §8.5 causes. Its owner-decline step becomes an owner end of a pending invite, or an approval removal, rather than the RTC owner route. |
| "§9.1 the default Node bound check answers …" (divergence 1) | Becomes "kind approval is checked without a federation-shard call". The deadlock class it guarded no longer applies to kind approvals, but the test stays as a no-hang regression for contract writes. |
| "§9.1 / contracts: x-bindle-brokerable:false" | Kept, against the renamed contract document. |

**New, needed by this draft:**
- the routing tests of §21.1 (each invite reaches only the app its basis fixes);
- `approval_required`;
- the `data` profile (4 KiB and 64 KiB caps, post-claim only, absent from `webrtc` sessions);
- the per-entity-enablement uniformity;
- the same-host `iss` refusal;
- no automatic cross-entity claim except under `offer_match` or `paired`;
- a cross-entity invite with no basis admits nothing;
- the `offer` basis over the feature endpoint: digest and token in the batch, use reservation and spend, principal binding for bound offers, any principal for open offers, uniform `202` for dead offers;
- the relation basis: admitted with a pairing, uniform `202` without one;
- `bases` enforcement at the recipient.

The peer itself needs:
- the new `typ` and member names;
- `params`, and a `data`-profile client;
- the batch `offers` member, and offer and relation bases;
- no SAS.

It still must import no 3sln.me code, and be rewritten only from this text.

**Still not covered** (as today): timing uniformity under load, glare, real TLS and DNS, roster rotation under load, moves, Web Push delivery, and relay credentials.

## Appendix A: where each fix lives in this text

### A.1 to A.5 (moved)

The history of revisions 0 to 2.1 (RTC fixes, the reviews of revisions 0 and 2, the owner direction received during revision 1, and the establishment-modes spike) is in the [frozen revision 2.1 copy](../superseded/signaling-rev2.1.md#appendix-a-where-each-fix-lives-in-this-text), with section and case numbers as they were then. A.6 records revision 3 with revision 3 numbers; A.7 records revision 3.1; A.8 records revision 3.2.

### A.6 Revision 3: owner direction and applied change requests

Sources: the owner direction of 2026-10-27 quoted at the top; the [contacts and links spike](../../architecture/contacts-and-links-rethink.md) revision 2 (CL-* decisions, CR-S* and CR-K* change requests); the [local clients spike](../../architecture/local-clients-spike.md) (LC-11, LC-12, CR-L1 to CR-L10); and [extensions revision 3.2](../extensions.md) Appendix A (CR-X3-03). All are provisional and unsigned.

| Change request or direction | Applied as | Section here |
| --- | --- | --- |
| Owner direction: core signaling unaware of calls and contacts, no app-level features, kinds app-defined | Neutral examples; no presentation, history or use vocabulary in normative text; no registered or recommended kind; SG-36 | Header, §1.1, §1.2, §3.4, §3.6, §4.1, §5.7, §8.6, §11.2, §11.3, §17, §18 |
| Call-invite description moves to Bindle Messaging | Removed here; Messaging owns `application/vnd.bindle.messaging.call-invite+json` and its rules | §20.12 (stub), [messaging §5.5](messaging.md#55-call-invitations-proposed-unsigned), SG-30 |
| Presentation hint stays out (a notice-contract proposal) | Removed here, with the former owner questions 6 and 7 | §11.3, §19.5, §20.12 |
| AMD-INT-R1 as applied to signaling | Call-specific candidate kind (item 5) withdrawn; items 1 to 3 kept only as hosted intents obligations; signaling relies on item 4 | §20.8, §20.10, SG-42 |
| CL-9 / CR-S1: no recipient resolved from a contact link | Two resolution paths: principal or handle | §5.1 |
| CR-S2: remove the `link` rows and the "shrinks to `link` invites" routing text | `link` rows removed; intents routing only in the own-entity fallback; routing cases renumbered | §5.2, §5.4, §5.6, §10.3 |
| CR-S3: remove §5.3, §20.3, `mint_link` and the link control and revocation rows; amend SG-5 and §19.5 | §5.3 and §20.3 are withdrawal stubs; `mint_link` gone; link rows removed from limits, owner controls, narrowing, moves, deletion, export and logging | §5.3, §9.2, §10.1, §10.2, §12.4, §12.6, §13.1, §13.4, §14.1 to §14.4, §20.3, SG-5, SG-18, §19.3, §19.5 |
| CR-S4: remove `links` from the batch | `links` removed; unknown batch members invalid | §9.1, §21.1 |
| CR-S5 / CL-10 (`none` admitting): withdrawn | Not applied. The ticket idea is listed as reserved | §15, SG-36 |
| CR-K1, CR-K2 (signaling part); spike L5 | Signed-object profile repointed to the forthcoming core keys specification; RTC code imports the core signed-object module | §6.1, §7.1, §20.4, SG-41, Appendix C.1 |
| CR-X3-03: declaration `{spec, options}`, prerequisites in prose | §3.1 rewritten; `endpoint` an audience option; contracts in `contracts`; no `extensions.v1` | §3.1, §9.1, §15 |
| CR-X3-03: slots become fragments | `signaling/v1` and `ice-relay/v1` fragments with `selection` and `consumers`; no occupant declaration; built-in resource wording | §3.2, §3.3, §10.1, §14.5, §16.7 |
| CR-X3-03: provider feature identity, `ref` gone | (issuer, spec URL); `client.feature` and handler approvals carry the spec URL | §2, §4.2, §6.1, §20.1.3, §20.1.4, §20.2 |
| CR-X3-03: AMD-SG-P1 and AMD-X1 | AMD-SG-P1 becomes the descriptor; AMD-X1 withdrawn by extensions rev 3 | §20.5, §20.8 |
| CR-X3-03: status note | Replaced by the revision 3 status | Header |
| Intents is an extension | Session kinds and approvals are local behaviour under the intents extension, never a federation prerequisite | §3.1, §20.1.8 |
| CR-L1: explicit activation (P3) | Activation control per pairing; approval never activates | §5.8, §20.1.4 |
| CR-L2: each party granted individually (P1) | Pairings never create or imply grants or approvals | §5.8, §5.9 step 3 |
| CR-L3: per-edge record (P2) | Exactly two parties; fan-out is several pairings | §2, §5.8 |
| CR-L4: local-client enrolment, M5 | Thumbprint `client_id` with local manifest; loopback flow allowed | §5.9 |
| CR-L5: confirmation code for M4 only | Required for M4, optional for M5 | §5.9 step 5 |
| CR-L6: coverage note for local clients | Per-installation `client_id` | §5.8 |
| CR-L7: listing under app connections; pairings on both parties' rows (P4) | Presentation-neutral listing rules | §5.8, §5.9, §14.1, §20.11 |
| CR-L8: session kinds without `route` | Never a handoff target or chooser candidate | §5.4, §20.1.3, §20.1.5 |
| CR-L9: no standing mark for web-origin local clients | Added | §5.9, §20.11 |
| CR-L10: SG row for LC-11 and LC-12 | SG-39 (and SG-40 for CR-L4 to CR-L9) | §19.2 |
| Bases re-check (`self`, `pairing`, `offer`, `none`) | Tables, wire, conformance list and migration plan updated; former owner question 8 answered as moot | §5.6, §7.2, §9.2, §10.3, §19.5, §21, Appendix C |

**Readings added in revision 3** (provisional, not in any change request): standing acceptance is reserved, because no remaining basis delivers an unsolicited cross-entity invite (SG-38, §5.5); the owner-hook handoff applies only to own-entity invites, and held requests are never handed off (§11.4); quarantine is removed with link parents (§13.3); the pending reserve excludes unbased invites (§13.1); session kinds forbid the intents `capability` format, which replaces `contact-link` (§7.2, §20.1.1); `endpoints({pairing})` labels use the owner-authored label for a local client (§5.8); §5.3, §20.3 and §20.12 are kept as stubs so that section references stay stable.

### A.7 Revision 3.1: review of revision 3

Source: an independent review of revision 3 (2026-10-27) and the coordinator's decisions on it. All fixes are provisional and unsigned (SG-43 to SG-46, and revisions of SG-2 to SG-6, SG-17, SG-20, SG-22, SG-23, SG-26, SG-27, SG-29, SG-31, SG-38, SG-42). The A.6 rows that mention the owner hook, held requests, the routing handler, intents routing, glare auto-accept or reserved standing acceptance describe revision 3 and are superseded by these.

| Finding | Fix | Section here |
| --- | --- | --- |
| H1 The intents routing fallback is unreachable except in a race, and its chooser handed off to an app that never received the invite | Intents routing cut: no routing handler, default, promotion, owner-hook chooser, `bsession` handoff or late delivery to a chosen app. Own-entity invites go to the initiating app or a named `target`. Only kinds and approvals come from intents. AMD-INT-R1 moves to the intents change requests; SG-42 withdrawn as not needed | Header, §1.1, §2, §5.4, §5.6, §11.4, §19.1, §20.1, §20.8, §20.10, SG-44 |
| H2 `none` is a dead end; "Allow later" has no target | `none` reserved as a possible future basis; requests setting, held entries, "Allow later", `basis: "request"`, the owner hook and its export, control, retention and test rows removed | §1.2, §3.6, §5.2, §5.6, §8.5, §10.3, §11.3, §12, §13.3, §14.1, §15, SG-45 |
| M1 Several cross-entity pairings per (peer principal, kind line) | At most one, in any state, enforced at creation | §5.4, §5.8, SG-46 |
| M2 Apps cannot learn pairing ids; confirmation path undefined for `opens: "local"` | `endpoints({endpoint})` returns covering pairings; `pairing` `listen` events; the M4 confirmation answers on the `peer` side for every `opens`; the opening side connects | §5.8, §5.9, §10.2, §10.3 |
| M3 Provider features and pairings contradict each other | Features are never pairing parties; they use offers | §4.1, §4.2, §5.8, SG-6 |
| M4 and SG-38 Public services lost their path | The `offer` basis generalizes: open offers (no principal), `uses`, always expiring and revocable; up to 90 days only for service-class endpoints, which auto-accept their own offers on every endpoint; 900 s for person entities' open offers; per-offer, per-(principal, offer) and per-(issuer, offer) windows; reserve at admission, spend at claim; no oracle; standing acceptance and the ticket reservation replaced | §2, §4.1, §4.3, §5.2, §5.5, §5.7, §8.6, §9.2, §10.2, §10.3, §12.1, §13.1, §14.1, §15, §17, §18, §20.1.4, SG-43, Q10 |
| M5 Messaging alert gating depended on Parlay list state | Messaging §5.5: alert only after the owner has sent the author a message in a two-party conversation; kind `parties: "other"`; `expiresAt` bounded by the earliest offer expiry minus 60 s | [messaging §5.5](messaging.md#55-call-invitations-proposed-unsigned) |
| M6 Appendix C claims did not match the code | `relay-credentials.mjs` kept (it holds `relay.mjs`'s lease constants); the `contact-profile.mjs` row removed (no `rtc/turn.mjs` import exists); `signed-object.mjs` "once created"; `tickets.mjs` imports corrected | Appendix C.1, C.2 |
| L1 Cross-entity glare auto-accept is dead | Removed; glare only picks the survivor; crossing offer dial-backs are an app concern | §5.5, §8.3, SG-20 |
| L2 `basis: "request"` never delivered | Removed | §10.3 |
| L3, L4 Messaging kind `parties` and expiry | Messaging §5.5 | messaging §5.5 |
| L5 §20.11 not updated for CR-L5 | M4 only | §20.11 |
| L6 §21.2 routing-handler test | Replaced | §21.2 |
| L7 P3 and P4 readings | Activation at creation listed as a reading; M5 single-submit activation; P4 for cross-entity pairings | §5.8, §5.9, §14.1 |
| L8 Stale history | RTC-11 states current values; the standing-acceptance paragraph moved to §18; A.1 to A.5 and withdrawn amendment bodies moved to the frozen copy | §5.5, §18, §20.2, Appendix A, B.1 |
| L9 Worked-example URL looked core-published | `https://sync.example/kinds/device-sync/v1` | §20.1.9 |
| L10 Confirmation code could be ground offline | The code covers the provider-chosen `user_code`, fixed after the client commits its key | §5.9 |

**Readings added in revision 3.1** (provisional, not in the review): `endpoints` takes an optional `endpoint`, which pairing results need; an `open` to another entity must carry a basis; `revoke_offer` with a token list covers the whole minting app's offers, because a service's minting endpoint may be gone; a decline spends an offer use; blocks apply before offers; service-class is defined by entity kind (not `person`) or provider feature, so it is testable; an open offer counts as one live offer whatever its `uses`.

### A.8 Revision 3.2: verification of revision 3.1

Source: an independent verification review of revision 3.1 (2026-10-27) and the coordinator's decisions on it. All fixes are provisional and unsigned (SG-47 to SG-51, and revisions of SG-31 and SG-43). Two revision 3.1 readings in A.7 are superseded: "a decline spends an offer use" (now only an `accept` spends an open offer's use, and a bound offer is spent at admission), and "service-class is defined by entity kind (not `person`)" (now provider features and designated service entities).

| Finding | Fix | Section here |
| --- | --- | --- |
| H1 A service offer is pinned to the minting instance; §14.2 revokes it when that instance goes | A service-class offer belongs to the minting app or feature and routes to every eligible and online endpoint of it (liveness window, reference 60 s); the first claim wins; endpoint unregister and expiry never revoke offers, and §14.2 step 6 is narrowed to the end of app or feature authority; offers that are not service-class keep minting-endpoint routing | §2, §5.4 case 3, §5.6, §5.7, §10.2, §10.3, §14.2, SG-47 |
| H2 Open-offer invites share windows with unbased junk; one global per-offer window | Charged only to their own windows and the host-wide initiator window; a per-issuer fair share max(W / (n + 1), F); reference values are examples, scaled for services; operational responses named | §9.2, §13.1, §17, B.1, SG-48 |
| M1 No open-offer sub-budget; uses reserved with nobody to answer | Open-offer sub-budget (reference: half of pending and of connected capacity); no admission and no use with an empty routing set | §5.2, §5.4, §9.2, §13.1, SG-48 |
| M2 A service cannot cheaply refuse junk | A service-class endpoint MAY decline automatically under its declared policy; a declined or unanswered open-offer session releases its use, and only an `accept` spends it | §4.2, §5.2, §5.5, §5.7, §10.2, §20.1.4, SG-49 |
| M3 "Service-class" by entity kind is too broad | Provider features and apps of organization entities their owner designated as service entities (explicit, disclosed owner setting); undesignated organizations' apps, member devices, member-context endpoints and person apps are not service-class; Q10 corrected | §2, §4.1, §4.3, §12.6, §14.1, §14.2, §20.1.4, SG-50, Q10 |
| M4 Bound offers reusable after an unanswered dial-back (polling) | Bound offers single-use, spent at admission (`uses` absent or 1); §12.1 reworded | §5.2, §5.7, §10.2, §12.1, §13.1, SG-49 |
| M5 A person's group open offer exhaustible by one holder | Residual stated plainly; 900 s and small `uses` kept as the bound | §5.7, §17, SG-51 |
| L1 Claim versus offer end not atomic | Decided at the first-claim authority; first recorded wins; the reserved use is spent or released, never both | §5.7, §21.1, SG-49 |
| L2 Token in the initiator provider's outbox | Kept only in the outbox until `answer_by`, never logged, deleted with the invite payload | §5.7, §12.4, SG-51 |
| L3 Long-lived bound offers not disclosed | Disclosed on the approval and designation pages; service-class bound offers capped at 7 days (reference) and single-use | §4.3, §5.7, §10.2, §20.1.4, SG-50 |
| L4 A person's app can emulate a pairing by re-minting | Accepted and justified: unenforceable to forbid, needs both apps' cooperation, single-use offers stop within 900 s, nothing leaks to third parties | §5.7, §17, SG-51 |
| L5 A move kills published offers | Stated for service operators | §5.7, SG-47 |
| L-6 `endpoints()` versus `endpoints({endpoint})` | `endpoints({endpoint})` everywhere | §5.8, §5.9, §10.3, SG-51 |
| L-7 Glare scope | Pairing invites and same-app own-entity `target` invites only; untargeted own-entity invites and offer dial-backs do not glare | §8.3, §21.1, SG-51 |
| L-8 Endpoint expiry not a §14.2 trigger | Listed, with the effects of `unregister`; never revokes offers | §10.2, §14.2, SG-47 |
| Appendix C.2 registry row ties signaling to intent-links | Requires a session-kinds and approvals flag, never `INTENT_LINKS_ENABLED` | Appendix C.2, SG-51 |
| Messaging §5.5 body size, alert rule, author comparison | At most 8 offer entries and 256-byte principals, so the body fits 4 KiB; group-call rule stated; the unlock persists until a block or an owner clear; authors compared by origin principal | [messaging §5.5](messaging.md#55-call-invitations-proposed-unsigned) |

**Readings added in revision 3.2** (provisional, not in the review): the online condition applies only to service-class offer routing, because a sleeping person-app endpoint must still be reachable through its doorbell; the empty-routing-set rule applies to every offer, not only open ones, so there is one admission rule; open-offer uses are spent only by `accept` for person apps too, so a person's decline also releases a use; removing a service designation revokes only offers longer than 900 s.

## Appendix B: disposition of existing RTC decisions

Key: **Kept** means the decision stands, with renames only. **Changed** means its substance is carried in a different form. **Dropped** means it is not carried. Implementation-only readings that this text does not need are marked "kept (impl)" where they still apply to the migrated code.

### B.1 Design decisions RTC-1 to RTC-17

| ID | Verdict | Note |
| --- | --- | --- |
| RTC-1 Shape | Changed | The extension and `ice-relay` are kept; since rev 3 the slots are fragments (SG-37). Purposes become intent kinds (SG-2), and the ticket link type is dropped with no successor (SG-5). |
| RTC-2 AMD-X1 | Dropped | §19.1, §20.8. |
| RTC-3 Leg-key signatures | Kept | §6. |
| RTC-4 Admission bases | Changed | The bases are `self`, `pairing` (with the relation basis `{"relation": "pairing"}`) and `offer`, bound or open; `link` is withdrawn and `none` reserved (§5.2, §5.6). |
| RTC-5 No address before the claim | Kept | §1.2, §16.4. |
| RTC-6 Relay-only default | Kept | §16.5. |
| RTC-7 Each party funds its own relay | Kept | §16.7. |
| RTC-8 No ringing, busy or presence | Kept | It is strengthened: `busy` is dropped (SG-13). |
| RTC-9 Lifetimes | Changed | Ring ≤ 120 s becomes `answer_by` ≤ 120 s. Session 24 h and certificate 120 to 900 s are kept. |
| RTC-10 SAS | Dropped | Out of core. In-band SAS is an endpoint matter (§16.6). |
| RTC-11 Limits | Kept | Reference values carry over, with "ringing" read as "pending". Current values: `pair` and `caller` windows; `self` 120/h, which own-entity `open` calls count against instead of `opens` 60/h (§13.1); `sameHost` 40/h; `warms` 20/h; 8 endpoints per app; an aggregate `data` budget per entity (value set with the cost-model row); 64 live offers per entity and 32 per app; 120 offer mints per app per hour; open-offer windows (rev 3.2, examples) of 60/h per offer, 6/h per (principal, offer) and a per-issuer floor of 6/h for offers that are not service-class, and 3,600/h, 12/h and 60/h for service-class offers, with the per-issuer fair share max(W / (n + 1), F); an open-offer sub-budget of half of pending and connected capacity; a 7-day cap on service-class bound offers; 30 pairing invites per hour per own-entity (pairing, endpoint pair), with two live sessions; cross-entity pairings per pairing `id` at 30/h per local covered endpoint (at most 240) and 2 × the local covered endpoints live; a pairing sub-budget of half of pending, connected and `data` capacity; and a pending reserve of 2 per share (`self` and cross-entity). |
| RTC-12 Device delivery | Kept | The integration doorbell is renamed (§11.2). |
| RTC-13 No multi-party | Kept | §8.6. |
| RTC-14 Beam leaves core | Kept | Historical. |
| RTC-15 Retention | Changed | The missed list is dropped. The provider keeps no owner-visible record of invites (§1.2, §12.4). |
| RTC-16 Portal ring fallback | Dropped | No provider presentation (SG-4). |
| RTC-17 Caller app origin | Kept | Provisional answer 6 (§19.3, SG-12). |

### B.2 Amendments

| ID | Verdict | Note |
| --- | --- | --- |
| AMD-X1 | Dropped | §20.8. Withdrawn by extensions revision 3 (EXT3-16). |
| AMD-R1 | Changed | AMD-SG-K1. |
| AMD-R2 | Changed | AMD-SG-P1. |
| AMD-R3 | Changed | AMD-SG-E1. |
| AMD-R4 | Dropped | Replaced by AMD-SG-I1. |
| AMD-R5 | Dropped | The ticket type is dropped. Its rev 1 successors (AMD-SG-L1a and L1b) are withdrawn in rev 3, and callbacks in rev 2, replaced by offers (§5.7). |
| AMD-R6 | Kept | Historical. |
| AMD-RV1 | Kept | Applied, §6.3, §16.4. |
| AMD-RV2 | Kept | Applied, §9.2, §9.3. |
| AMD-RL1 | Kept | §3.3. |
| AMD-RI1 to RI5 | Kept | Applied, §5.1, §7.3, §9, §10. |
| AMD-RW1 | Dropped | It does not arise (§5.4). |
| AMD-RW2, RW3, RW4 | Kept | Applied, §9.2, §13. |
| AMD-RW5 | Dropped | Mutes are dropped, and there is no signaling interruption policy for the scoping rule to apply to. |
| AMD-RW6 | Dropped | There are no app-minted links since rev 3 (§5.3). |

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
| RTCd-4 Held invites | Dropped | No held invites since rev 3.1 (`none` reserved, SG-45). |
| RTCd-5 Mutes | Dropped | |
| RTCd-6 Auto-accept projection | Changed | `auto_connect` for own-entity, `offer_match` and `paired` for cross-entity (§5.5, §10.3), under pairing coverage including bound client sessions. `offer_match` is on the minting endpoint, or on every online endpoint of a service-class minting app or feature (rev 3.1, 3.2). There is no `standing_accept`. |
| RTCd-7 Decline by claim | Kept | |
| RTCd-8, RTCd-9, RTCd-20 Wire details | Kept | §10. |
| RTCd-10 Tickets apart from LinkService | Dropped | |
| RTCd-11 No oracle via keys | Kept | |
| RTCd-12, RTCd-23, RTCd-25 Deletion, pinned keys, moves | Kept | The `moved` control is still unimplemented. |
| RTCd-13 Epochs | Kept | |
| RTCd-14 Limits | Kept | |
| RTCd-15, RTCd-16, RTCd-17 Queue, long poll, gating | Kept | Flags renamed. |
| RTCd-18, RTCd-19 Eligibility and capacity preference | Changed | Eligibility means the routing set. The preference is the pending reserve, split in rev 2.1 into a `self` share and a cross-entity share. |
| RTCd-24 Full outbox for controls | Kept | |
| RTCd-rev | Kept | |

### B.5 RTC-g (RTCg)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCg-1 Owner actor; RTCg-2 uniform 404 for widening while off | Kept (impl) | |
| RTCg-3 No master switch | Kept | |
| RTCg-4 Ring eligibility | Dropped | |
| RTCg-5 Silent local end | Kept | As the engine rule (§8.5). |
| RTCg-6, RTCg-14 Ring data and principal display | Changed | The pre-claim minimization applies to the `listen` projection (§10.3). |
| RTCg-7, RTCg-8 Open in app; ring delivery | Dropped | No provider handoff (rev 3.1). Delivery is `listen` with optional doorbells. |
| RTCg-9 to RTCg-12 Apps, automatic answers, contact links, requests | Changed | Folded into generic surfaces (§14.1). Automatic answers for app endpoints become pairings (rev 2, §5.8), with direction, mandatory cross-entity expiry and code confirmation for device-authorization pairings in rev 2.1, and explicit per-edge activation in rev 3. Contact links are dropped in rev 3, and requests in rev 3.1. |
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
| RTCe-22 | Kept | In the `listen` projection. |
| RTCe-resid, RTCe-open | Kept | The integration doorbell is renamed. |

### B.7 RTC service follow-ups (RTCs)

| ID | Verdict | Note |
| --- | --- | --- |
| RTCs-1 to RTCs-5 Silent end | Kept | As the §8.5 engine rule. |
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
| RTCw-L2 | Dropped | No owner-visible record to fold (rev 3.1). |
| RTCw-L3, RTCw-R1, RTCw-I3 | Kept | |
| RTCw-L5 Ticket pruning | Dropped | No tickets or minted links (rev 3). |
| RTCw-info | Kept | Handles are unsupported for `open` on this host, and re-registration after revoke is allowed. |
| RTCw-M2-1, M2-3 | Dropped | No app-minted links (rev 3). |
| RTCw-M2-2, RTCw-I5 | Dropped | No link quota or mint window (rev 3). |
| RTCw-M2-4 Legacy tickets | Dropped | |
| RTCw-M2-5, RTCw-I6 | Dropped | No signaling links (rev 3). Offers have per-app bulk revoke (§14.1). |
| RTCw-M6-1 | Kept | |
| RTCw-M6-2, RTCw-R3 | Changed | Mutes are dropped. R3's routing half is kept (§5.4). Its mute-scoping half has nothing left to apply to. |
| RTCw-M6-3 | Kept | |
| RTCw-M6-4 Ring controls | Dropped | |
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

Their fate: `rtc/contact/`, `rtc/missed/`, `rtc/mute/`, `rtc/ticket/` and `rtc/approval/` are dropped (`rtc/contact/` by the contacts reset `contact-links-retired-v1`, [contacts and links spike](../../architecture/contacts-and-links-rethink.md) §9). The rest are renamed. Revision 2 adds two new families with no RTC predecessor: pairings (owner data, exported) and offers (transient, excluded from export, deleted at expiry). Revision 2.1 adds members to them (pairing `opens` and `state`; per-app offer counts) and a recorded client session on each endpoint registration; none has existing rows. Revision 3 adds no family. Revision 3.1 adds members to offers (the principal may be `null`; `uses` and spent and reserved counts) and removes the owner-hook entries, which never had rows.

So rows can exist only in local development and test stores. For example, the round 3 browser bug hunt ran a local Worker with `RTC_SIGNALING_ENABLED` and `RTC_TICKETS_ENABLED` on (DEVLOG 2026-10-27). A one-time cleanup step, or a dev reset, is enough. No owner data needs conversion.

**Calling code leaves core.** Every call-specific part of the RTC code (the ring screen and poll, the "Calls & connections" view, the call purpose, call strings) is removed from core. Calling is built in Parlay on Bindle Messaging §5.5 and these generic signaling methods; nothing call-specific is re-homed into the signaling package.

**Export gap (pre-existing).** `rtc/block-iss/` is neither exported nor excluded in `packages/runtime/export-contributors.mjs`: the `rtc` contributor claims `rtc/block/`, and that prefix does not match `rtc/block-iss/`. The renamed provider-block family must be exported (§12.6).

### C.1 `packages/rtc` (rename to `packages/signaling`; the owner's choice)

| File | Plan |
| --- | --- |
| `jws.mjs` | Keep the `typ` list here. Done locally (checked 2026-10-28): it takes compact JWS parsing, signing, verification and the low-S check from `packages/core/signed-object.mjs`. `packages/links` was removed in contacts phase 4, and nothing here may import from `packages/orgs`. |
| `messages.mjs` | Reduce and split into a generic envelope and types (`answer_by`, `kind`, `profile`, `params`, the `self`, `offer_digest` and `relation` bases, and the batch `offers` member; no `link_digest`, `links`, `callback_digest`, SAS, `busy` or `media`), plus profile validators: `webrtc`, which keeps every SDP and candidate rule but only the structural `m=` check, and `data`, which owns the `data` type (4 KiB per message, 64 KiB per leg). |
| `certificates.mjs` | Keep. Renames (`role`, `kind`, `profile`, `client.feature`). |
| `extension.mjs` | Rebuild in the extensions revision 3 shape (CR-X3-24): the descriptor and its options validator (`endpoint` audience, `max_leg_certificate_seconds`, `profiles`), the prerequisite check, and the two fragments with `selection` and `consumers`. No slot, `bind` or AMD-X1 bound-artefact table. |
| `purposes.mjs` | Remove. Session-kind validation (`session` member) moves to `packages/intents/schema.mjs`, and projection reuses `packages/intents/project.mjs`. |
| `sessions.mjs` | Keep. Rename `ringing` to `pending`. Bounds stay. Replay state stores payload hashes only. |
| `admission.mjs` | Reduce. Remove the mute kinds and alert. Keep the blocks (principal and issuer), limits and windows, removing the link windows (`preferred`, `issuerParent`). Add the aggregate `data` budget, the offer and pairing windows and limits, `bases` enforcement, and the offer and relation basis checks at step 7 (with the read-only offer principal comparison and principal-based limit classification). Rev 2.1: cross-entity pairing window and live cap per pairing `id`, the pairing sub-budget, and the split pending reserve. Eligibility becomes the routing set, read from intents memory and the pairing records. |
| `tickets.mjs` | Removed, with no replacement (rev 3; checked 2026-10-28, the file no longer exists, and `packages/links`, which it imported, was removed in contacts phase 4). Offers are new code in `service.mjs` and `admission.mjs`. |
| `service.mjs` | Reduce. Remove the missed list, mutes, alert recomputation, ticket operations and RTC owner reads tied to the ring. Add the routing set (cases 1 to 4), late delivery, the live approval check on `claim` accept, and approval checks from intents memory. Add `offer` and `revoke_offer` with hashed offer records and atomic spend, the pairing record and its lifecycle, `endpoints({pairing})`, and the `offer_match` and `paired` projection members. Rev 2.1: `offer_match` only for the minting endpoint; offer revocation and expiry ending admitted pending sessions; the per-app live-offer cap; issuer-level-only warming at `offer`; the client session recorded on each endpoint and pairing coverage checked against it in both roles; `opens`; Devices-name labels and no `last_seen` in paired results; pairing deletion on clearing, blocks and moves; the 7-day pending expiry; re-confirmation on disclosure-adding kind versions; glare ranks from leg key thumbprints (endpoint SDK). Rev 3: no link routing or standing acceptance; explicit pairing activation, one edge per pairing, and pairing deletion when either party's grant or approval goes. Rev 3.1: no routing handler, owner hook, held requests or handoff; open and multi-use offers with use reservation, the service-class expiry and `offer_match` rules and the open-offer windows; one cross-entity pairing per (peer principal, kind line); `pairings` in `endpoints` and `pairing` events; no glare auto-accept. Rev 3.2: service-class offers owned by the app and routed to its online endpoints; bound offers spent at admission; open-offer uses spent only by accept; open-offer windows outside the unbased windows, with a per-issuer fair share; the open-offer sub-budget; no use with an empty routing set; offers untouched by endpoint unregister and expiry; the service designation. Change `open`: own-entity opens take the `self` window, not `opens` (§13.1, L4). |
| `federation.mjs` | Keep. Renames. |
| `relay.mjs` | Keep. The approval check uses kind approval. Issuance stays refused until the spend authority enforces a per-owner byte cap from provider usage (§16.7). `scripts/cost-model.mjs` imports it (see C.2). |
| `relay-credentials.mjs`, `turn.mjs` | Keep. `relay.mjs` imports `RELAY_LEASE_MS`, `RELAY_RETRY_MS` and `relayUsernames` from `relay-credentials.mjs`, and `CloudflareTurnAdapter` and `TURN_MAX_TTL_SECONDS` from `turn.mjs`, which `relay-credentials.mjs` also imports (checked 2026-10-27). Fold the parts `relay.mjs` uses into it, or keep both files; do not delete `relay-credentials.mjs` on its own. |

### C.2 Runtime, routes, federation and other packages

| File | Plan |
| --- | --- |
| `packages/app/domains/rtc.mjs` | Rename to `signaling.mjs`. Reduce the operation lists (no ticket, contact-configuration, mute, missed or narrow operations). |
| `packages/runtime/account/rtc.mjs` | Reduce. Remove `rtc/approval/`, `narrowedApproval` and the bound copying into actors. Keep the contract actor (grant ids), peer, listen, drain, relay and the roster. |
| `packages/runtime/routes/rtc.mjs` | Keep the logic: step 1 at the route, dark ingest, the same-host `iss` refusal, shedding. Rename the path and media type, and the `rtc/inbound` limiter scope in the host abuse store (to `signaling/inbound`). |
| `packages/runtime/routes/rtc-owner.mjs` | Mostly remove. Drop `GET /api/rtc/ring`, missed, mute, tickets and `narrow-app`. Keep minimal owner routes for the IP policy, principal and provider blocks, end-session, revoke-endpoint and auto-connect. Drop `set-contact-rtc` and `endpoints.inspect` (contacts spike CR-C6). Approvals move to the intents routes. |
| `packages/runtime/routes/index.mjs`, `packages/runtime/account/index.mjs` | Rename the `rtc` and `rtc-owner` route imports and the `rtc` account slice. |
| `packages/runtime/routes/intents.mjs`, `packages/intents/*` | Extend: session kinds (with `bases`), and session handler approvals with `auto_connect` and the service-class disclosure (AMD-SG-I1). No routing default, promotion, chooser or `bsession` handoff for signaling (rev 3.1). AMD-INT-R1 is an intents change request, outside this plan. |
| Pairing owner routes and pages (new) | Create (owner page only), activate, list, relabel, expire, renew, re-confirm and remove pairings, compare-and-swap, with the §5.8 disclosures (rev 2.1: `opens`, `parties` check, fresh authentication and verified-handle display for cross-entity pairings, sensitivity-category wording, mandatory cross-entity expiry, the recipient-only enforcement disclosure). Rev 3: explicit activation (P3), one edge per pairing (P2), parties' grants never created by the pairing (P1), listed with both parties (P4). Rev 3.1: refuse a second cross-entity pairing per (peer principal, kind line) and a provider feature as a party; a by-peer list of cross-entity pairings. Live-offer list (with "anyone" and uses) and revoke. Lives with the owner's app connections. Rev 3.2: the service-designation owner setting for organization entities, with its disclosure; removing it revokes offers longer than 900 s. |
| `packages/runtime` device authorization approval page | Offer the session handler approval and one pairing control per already-connected candidate app, bound to the new client session (default `opens: "peer"`), as separate, unchecked controls (§5.9). Local-client enrolment (thumbprint `client_id`, local manifest, M5) follows the local clients spike phases 2, 3 and 5, behind its own flag. Add the code-comparison confirmation page (M4 only, code over the `user_code` and `dpop_jkt`) reached from the paired app through `approval_required`, and name the pairing in the post-approval notification. Under M5, the same submit activates a pairing whose parties then qualify. The standing device grant waits for AMD-SG-D1 sign-off; until then, warn that signing out of the approving browser ends the client. If adopted: the three-event exemption only, the client restriction, and last-refresh and network-change signals in Devices. Revoking a device-authorization client session calls the signaling §14.2 narrowing. |
| **Lifecycle hooks** (intents, connections, federation) | Removing or clearing a session handler approval (§20.1.4), and an app connection ending for any reason, each call the signaling §14.2 narrowing. These two hooks replace `narrowBoundOptions` and the RTC grant-changed path. Slot-grant revocation keeps a generic grant-changed hook into the same narrowing. |
| `packages/runtime/federation.mjs` | Reduce. Rename the manifest rows. Remove `rtcBoundArtefacts` and bound resolution. Keep the descriptors. |
| `packages/federation/extensions.mjs`, `service.mjs`, `runtime.mjs`, incremental | Remove AMD-X1: `bind`, bound options, `narrowBoundOptions` (controller, remote, Worker allowlist), `boundApproval`, `checkBound`, `dispatchBound` and the incremental refusal. Keep a generic grant-changed hook for slot-grant revocation, and keep `NO_EFFECT_CODES`. |
| `packages/runtime/artefact-pins.mjs` | Remove the four `rtc-purpose` operator documents. Keep the first-party contract under its new id. |
| `packages/runtime/export-contributors.mjs` | Drop the `rtc/missed/`, `rtc/mute/`, `rtc/ticket/` and `rtc/approval/` rows. Export provider blocks (closing the `rtc/block-iss/` gap). Drop `rtc/contact/` with the contacts reset. Rename the families. Extend the `intent-choices` row's claimed fields (today `kind default excluded ignored`) with the session handler approval fields: `approvals` (handler, `version`, `digest`, approval time) and `autoConnect`. Add a pairings row (exported) and exclude offers. |
| `packages/flags/registry.mjs` | `RTC_SIGNALING_ENABLED` → `SIGNALING_ENABLED`, requiring, besides its current requirements, a flag that gates session kinds and session handler approvals, but never `INTENT_LINKS_ENABLED`, because session kinds are not tied to the intent-links extension (§20.1.8). `INTENT_APP_HANDLERS_ENABLED` requires `INTENT_LINKS_ENABLED` today, so either a separate session-kinds flag is added or that requirement is split; the choice is made with the code change (rev 3.2). The review also asked for `ACTIVITY_V2_ENABLED`, because revision 0 presented invites as activity items. Under the owner's later direction signaling creates no activity items, so that requirement is dropped unless an activity mirror (§20.2) is adopted. `RTC_FOREIGN_ENABLED` → `SIGNALING_FOREIGN_ENABLED`. Retire `RTC_TICKETS_ENABLED` into `RETIRED_FLAGS`. Keep or rename `RTC_TURN_ENABLED`. Rename `RTC_FOREIGN_ISSUERS`. |
| `apps/node/resources.mjs`, `apps/worker/objects.mjs` | Remove `RTC_BOUND_CHECK` (kind approval is local). Rename `RTC_EGRESS` and the `RTC_FOREIGN_ISSUERS` allowlist wiring. |
| `apps/worker/federation.mjs`, `apps/worker/index.mjs` | Rename the `rtcOccupant` mount (and its use in `packages/runtime/federation.mjs` descriptors). |
| `scripts/cost-model.mjs` | Follow the `relay.mjs` rename (it imports `RELAY_PLAN_BYTES` and `RELAY_LIMITS`). Add the `data` row needed by the §3.5 production gate. |
| `docs/artefacts/rtc-purposes/*` | Remove from core. Any kind an app needs is published by that app (for example Messaging's call kind, messaging §5.5). The device-sync example is optional. |
| `docs/artefacts/rtc-signaling-v1.json` | Replace with the extension descriptor and the two fragment documents. |

### C.3 Web UI and catalogues

| File | Plan |
| --- | --- |
| `apps/web/src/ui/rtc-ring.mjs`, `apps/web/src/bl/rtc-ring-poll.mjs` | Remove from core. Call presentation is Parlay's. |
| `apps/web/src/ui/rtc-settings.mjs`, `apps/web/src/bl/rtc-settings.mjs` | Remove the "Calls & connections" view and the `calls` portal module. Re-home the generic controls (§14.1) into the owner's app connections, Privacy and the blocked lists. |
| `apps/web/src/ui/authorize-entry-consent.mjs` | Remove the bound-options consent. Add the session-kind approval rows if approvals are offered at authorization. |
| `apps/web/src/release.mjs`, `apps/web/src/ui/release-dialogs.mjs`, `apps/web/src/shared/portal-modules.mjs`, `apps/web/styles.css` | Remove the RTC hunks. |
| `packages/i18n/catalogues.mjs`, `authorize-catalogue.mjs` | Remove most of the about 157 RTC strings per locale (107 + 11 + 36 + 3). Add neutral strings for pairings (with the "connect automatically", peer-availability and activation disclosures), the enrolment pairing controls, and the re-homed settings. Call strings belong to Parlay. |

### C.4 Tests

| Test | Plan |
| --- | --- |
| `rtc-messages`, `rtc-certificates`, `rtc-federation`, `rtc-federation-runtime`, `rtc-runtime`, `rtc-review-followups`, `rtc-relay`, `rtc-relay-credentials`, `cost-model-relay`, `rtc-bound-default` (no-hang part) | Keep, retargeted to the renames. |
| `rtc-engine`, `rtc-wargame` | Keep most. Retarget the mute and missed cases to blocks and silent ends; retire the ticket cases. Replace the round-robin cases with routing cases. Add the `data` budget and the own-device `open` window. |
| `rtc-tickets`, `rtc-tickets-spam` | Remove with the `link` basis; keep any provider-block case as a block test. |
| `tests/helpers/rtc-fixture.mjs`, `tests/helpers/rtc-settings-fixture.mjs` | Rename `rtc-fixture.mjs`. Remove `rtc-settings-fixture.mjs` with the settings view, or reduce it to the re-homed controls. |
| `rtc-purposes` | Replace with intents session-kind tests. |
| `extensions-bound-options`, `browser/consent-bound-options` | Remove with AMD-X1. |
| `rtc-owner-routes`, `rtc-owner-followups` | Reduce to the remaining owner routes and the silent end. |
| `browser/rtc-settings*` | Remove. New browser tests are needed for the re-homed controls, the pairing creation and activation pages and their listings, the enrolment pairing controls, and the live-offer list. |
| New engine tests | Offers and pairings, as §21.1 "Offers", "Pairings" and "Engine-level and chaos coverage", including the rev 2.1 cases (minting-endpoint-only `offer_match`, client-session coverage in both roles, `opens`, per-pairing-id caps, split reserve, block deletion, glare by leg keys) and the rev 3 and 3.1 cases (explicit activation, one edge per pairing, `link_digest` and `links` refused, open offers and use reservation, one cross-entity pairing per peer and kind line). |
| `rtc-conformance*` | §21.2. |

### C.5 Order

1. Owner sign-off of the kind-authorization choice and the bases (SG-2, SG-23 to SG-30, SG-36 to SG-46) with AMD-SG-I1. (The establishment spike reported on 2026-10-27, §19.4.)
2. Intents session kinds (with `bases`) and approvals.
3. Engine reduction and renames, including the `data` profile limits, the own-device `open` window and the removal of link, ticket and call code. Then the `offer` basis (bound and open) and the pairing record with explicit activation, engine-level tests first, behind the default-off signaling flags.
4. The extension in the revision 3 shape (descriptor, fragments, prerequisite check), with AMD-X1 removal (CR-X3-20) and the lifecycle hooks.
5. UI re-homing.
6. Conformance peer rewrite.
7. Enrolment approval page: the pairing controls and the M4 code-comparison confirmation, AMD-SG-D1 if it is signed off, and local-client enrolment after the local clients spike's identity phases.
8. Docs: the design doc and the pending-signoffs digest. (Messaging §5.5 already carries the call-invite text.)

Each step is reversible while flags stay off.
