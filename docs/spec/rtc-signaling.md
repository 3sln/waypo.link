# RTC signaling (`rtc-signaling.v1`) — normative draft

Status: **design candidate, 2026-10-26, revision 1.** The wire validators (§5, §6, §8.1–§8.2 step 1, §4.3 ticket payloads), the `rtc-purpose` kind (§3.4) and AMD-X1 (§3.5) are implemented locally (slices RTC-a to RTC-c), and so are the session engine, admission, tickets and same-provider transport (RTC-d) and the contract route, foreign transport, §8 endpoint and key roster (RTC-e, behind an empty-by-default foreign-issuer allowlist; [design §8.1](../architecture/rtc-signaling.md#81-slices)); nothing is published or production-verified, and every RTC flag is off. RTC-e readings that differ from this text (an `aud` naming no active entity answers the uniform 404 rather than 202; one `aud` per batch) are recorded as provisional in DEVLOG 2026-10-27 "RTC-e". Every decision is provisional (coordinator), **not signed off by the user**; they are listed as RTC-1 to RTC-17 in the [design](../architecture/rtc-signaling.md#9-provisional-decisions). One adversarial self-review round has been applied (design §10). Track the decision in [DEVLOG](../../DEVLOG.md) (2026-10-26, "RTC signaling extension design"). Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This document defines a Bindle extension under the existing extension system: a provider **feature** ([protocol §2](protocol.md#2-discovery-and-login)), two **slots** ([extensions](extensions.md)), one **artefact kind** ([artefacts §6.3](artefacts.md#63-growth-points-by-kind)) and one **link type** ([links](links.md)). It adds no parallel declaration, discovery, pinning or permission mechanism. The one thing the extension system cannot yet express is named in §3.5, with the smallest proposed addition (AMD-X1). It defines interoperability rules only: no chooser, ring, prompt or settings presentation beyond the disclosures it lists, and no SDK behavior. It satisfies the preconditions [messaging](messaging.md) lists for WebRTC signaling (schemas and bounds, peer identity distinct from bearer possession, replay and expiry, consent, TURN, IP privacy, cancellation, abuse).

## 1. Scope and model

The extension lets two **endpoints** (an application instance on a device, acting for an entity) set up a WebRTC peer connection. Media and data then flow peer to peer, or through relays. The extension carries only signaling. It does not define what the connection is used for: calls, screen sharing, file transfer and device sync are **purposes** (§3.4) defined outside this document.

- **Parties.** The two endpoints may act for the same entity (own devices) or for different entities, on one provider or on two.
- **Path.** An endpoint talks only to its own entity's provider, through the signaling slot's contract (§9). Providers talk to each other through the feature's endpoint (§8). No endpoint ever contacts the peer's provider to signal.
- **Authentication.** Every signaling message is signed end to end by a per-session **leg key** held by the sending endpoint. The sending entity's provider certifies that key with a **leg certificate** (§5). Providers and endpoints verify the same signatures; a provider relays messages and never rewrites them.
- **Consent.** A caller reaches a callee only on an admission basis (§4.2). A session connects only after one callee endpoint **claims** it (§7.2). Nothing before that claim reveals whether the callee has any endpoint, is online or admitted the caller (§12).

**Non-goals.** Multi-party sessions (§7.5), media relaying by providers, recording, telephony interconnect and emergency calling, offline delivery, and any guarantee of reachability.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Entity, principal | As in [protocol §1](protocol.md#1-model-and-custody). A principal is `(iss, sub)`; relationships are keyed by **origin principal** ([identity portability §8.1](identity-portability.md#81-stable-identifier)). |
| Endpoint | A registration, at the entity's provider, of one application connection on one device instance (§9.1). Endpoints are provider-local and never disclosed to other entities. |
| Session | One attempt to connect a caller endpoint with one callee endpoint, identified by `sid` and keyed by (caller origin principal, `sid`). |
| Leg | One endpoint's participation in one session: its leg key, leg certificate and message sequence. A session has one caller leg and at most one accepted callee leg. |
| Caller provider, callee provider | The current issuers of the caller and callee. They are the same provider for same-provider and own-device sessions. |
| Purpose | An artefact of kind `rtc-purpose` (§3.4) naming what a session is for. |
| Basis | What admits an invite at the callee provider (§4.2). |
| Claim | The atomic, first-wins answer (accept or decline) by one callee endpoint (§7.2). |

## 3. Building blocks in the extension system

### 3.1 Feature declaration

A provider whose entities can take part in sessions with entities at other providers declares, in `features`:

| Feature | Members | Meaning | When absent |
| --- | --- | --- | --- |
| `rtc-signaling.v1` | `endpoint` (issuer origin), `max_leg_certificate_seconds` (integer 120 to 900) | The provider accepts §8 batches at `endpoint`, sends them only to peers' declared endpoints, and issues leg certificates (§5.1) no longer than the declared bound. Requires `directory.v1` ([organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1)), `extensions.v1` and `artefact-versions.v1`. | Its entities can hold sessions only with entities on the same provider, if it offers the signaling slot at all. |

The feature describes what the provider implements, so it is a feature and not a slot ([extensions §2.1](extensions.md#21-the-slot-member)). It confers no authority.

### 3.2 The signaling slot

Applications reach the provider's signaling through an ordinary slot:

```json
{
  "id": "https://spec.bindle.example/slots/rtc-signaling/v1",
  "title": "Real-time connections",
  "description": "Lets an application ring you and connect your devices with other devices.",
  "publisher": "https://spec.bindle.example",
  "fields": {
    "signaling": {
      "title": "Signaling service",
      "type": "resource",
      "cardinality": {"min": 0, "max": 1},
      "contracts": ["https://spec.bindle.example/contracts/rtc-signaling/v1"]
    }
  },
  "slot": {
    "v": 1,
    "crit": ["bind"],
    "field": "signaling",
    "selection": "exclusive",
    "consumers": ["application"],
    "bind": ["purposes"],
    "options": {
      "occupant": {},
      "consumer": {
        "purposes": {"title": "Purposes", "type": "url", "maxLength": 256, "cardinality": {"min": 1, "max": 16}}
      }
    }
  }
}
```

- The occupant is the provider's **built-in** occupant, declared in its manifest `extensions` array as `{"slot": "…/slots/rtc-signaling/v1", "role": "occupant", "ref": "rtc"}` ([extensions §4](extensions.md#4-extension-declarations)). It is assigned only by the owner, like every occupant (extensions §5.1).
- The contract `https://spec.bindle.example/contracts/rtc-signaling/v1` (§9.1) declares `"x-bindle-brokerable": false` ([contracts](contracts.md#contract-method-metadata)), so in this version no integration can occupy the slot. Signaling must be issued by the entity's own issuer because only it can certify leg keys (§5.1).
- An application that uses the slot requests the slot manifest as a fragment with its `digest` and the methods it needs, plus its `purposes` as a bound consumer option (§3.5). An integration manifest MAY also carry a matching `consumer` declaration with a plain-text `purpose`; as everywhere, the declaration is informational and the request is what the owner approves.
- Every rule of extensions §5 applies unchanged: disclosure before assignment, per-consumer approval, revocation, the occupancy no-oracle rule (extensions §9, item 8), pinning (§4.3) and versioning (§7).

### 3.3 The ice-relay slot

Relay credentials are a separate, optional slot, so an owner can fund relays from the provider or from an integration they choose:

- `https://spec.bindle.example/slots/ice-relay/v1`: one `resource` field `relays`, `cardinality` 0 to 4, contract `https://spec.bindle.example/contracts/ice-relay/v1`, `selection: "ordered"`, `failover: "pre-dispatch"`, `consumers: ["application", "provider"]`, no options.
- The contract has one method, `credentials({sid?})` → `{ice_servers, expires_at}`. `ice_servers` is a list of at most 4 `{urls, username?, credential?}` with at most 4 `turn:`, `turns:` or `stun:` URLs each. It is a write-effect method (it spends relay budget); brokered occupants are allowed. `sid` is meaningful only to a built-in occupant, which uses it to check the leg is live (§10). A consumer MUST NOT send `sid` to a brokered occupant, so third parties never learn session identifiers.
- A relay occupant sees the IP addresses of its own entity's endpoints and the relay addresses of peers, and learns when sessions happen. The slot disclosure (extensions §5.1) states this.
- A provider feature that consumes this slot (for example to hand relay credentials to its own portal) is a provider consumer under extensions §5.3: it is declared in the provider manifest and enabled by the owner.

§10 defines how endpoints use relays.

### 3.4 Purposes

A purpose is an artefact line of kind `rtc-purpose` ([artefacts §2](artefacts.md#2-the-envelope)). This document registers the kind. Its body has exactly:

| Member | Definition |
| --- | --- |
| `id`, `title`, `summary`, `publisher` | As for intent kinds ([intents §4.1](intents.md#41-body)): `publisher` equals the origin of `id`, and attribution always uses the host of `id`. `summary` says, in the second person, what a session of this purpose does. |
| `media` | A nonempty, unique, ascending subset of `audio`, `data`, `screen`, `video`: the most a session of this purpose may negotiate. |
| `alert` | Boolean. `true` permits the callee's endpoints to alert the user (ring); `false` means sessions are expected to be answered without alerting, and only between endpoints of one entity (`parties` MUST then be `self`). |
| `parties` | `self` (own devices only), `other` (other entities only) or `any`. |
| `auto_accept` | `never` or `self`. `self` permits an owner to let an approved application claim, without a user action, sessions of this purpose opened by **the same application** on another of the owner's endpoints (§4.4). It MUST be `never` unless `parties` is `self`. |
| `context` | `null`, or an object `{data, disclosure}` using exactly the data schema and disclosure rules of [intents §4.2–§4.3](intents.md#42-data-schema), with at most 8 properties and 2,048 serialized bytes. No property may have `format: contact-link`. |
| `categories` | [Incremental authorization §8.3](incremental-authorization.md#83-sensitivity-categories) categories a session of this purpose can involve. |
| `supersedes` | Optional line URL; a hint only. |

**Growth points** (artefacts §6.3): `/title`, `/summary` and `/context/disclosure/fields/*/title` add-member (new language tags only); `/context/data/properties` add-member (not added to `required`, with its disclosure entry in the same version). Everything else is frozen, including `media`, `alert`, `parties`, `auto_accept` and `categories`.

Purposes are referenced as `{purpose, version, digest}` (artefacts §5). A provider pins each purpose version when an owner approves it for an application, resolves purposes only under artefacts §7 and §8, and never fetches a purpose on the path of a request from another provider (§8.2). Candidate lines (bodies in the [design §4](../architecture/rtc-signaling.md#4-candidate-purposes)): `…/rtc-purposes/call/v1`, `…/rtc-purposes/screen-share/v1`, `…/rtc-purposes/file-transfer/v1`, `…/rtc-purposes/device-sync/v1`.

### 3.5 Gap in the extension system: bound consumer options (AMD-X1)

The slot needs each application's **purposes** to be part of what the owner approves for that application, so that the occupant can refuse an application ringing for a purpose the owner never approved. Extensions cannot express this today:

- slot `options.consumer` values live only in declarations, which confer no authority (extensions §4.2);
- slot atomic fields are owner settings shared by every consumer (extensions §2.1), and the scoping contract's selection is shared by every consumer of a field ([resource scoping](../architecture/resource-scoping.md#shared-field-configuration-and-consumer-tokens)).

**AMD-X1 (proposed, unsigned), smallest addition to extensions §2.1 and §5.2:**

1. A slot member `bind`: a nonempty list of names of `options.consumer` members. A slot using `bind` MUST list `"bind"` in `crit`, so a processor without AMD-X1 treats the slot as unrecognized and processes it as an ordinary fragment (extensions §2.2); the application then gets no binding and the occupant refuses every bound operation.
2. A request for a slot fragment with `bind` carries `options`, an object validated against `options.consumer`. Missing or invalid `options` makes the request invalid for that fragment.
3. The provider discloses the requested bound values at consent next to the methods, records the values the owner approves (the owner MAY approve a subset) as part of that consumer's approval, and changes `bindle.grant` whenever they change. Widening them is a new approval through `grant-more` ([incremental authorization §4](incremental-authorization.md#4-grant-more)); narrowing by the owner is immediate. When a bound value is a reference to a versioned artefact line (as RTC purposes are), the provider records, per approved line, the `{version, digest}` it resolved at consent. A later version may be used under that approval only after the provider verified additivity (artefacts §7.2), and a version that adds disclosure (for RTC purposes, `context` properties) is a widening that needs `grant-more`, as intents §7.2 treats widening kind versions. Until the line's kind and growth table are registered and signed, additivity is unverifiable (artefacts §6.4) and only the approved version is usable.
4. The occupant enforces the approved values on every invocation. Bound values are per consumer and never shared with other consumers of the slot field.

Nothing else in this document needs an extensions change.

## 4. Authorization

### 4.1 Caller side

The caller provider MUST, before certifying a caller leg (§9.1 `open`), check live: the caller entity is active; the calling application's connection holds a grant on the signaling occupant with the method; the purpose is among its approved bound `purposes`; the purpose's `parties` admits the callee (own entity or another); the requested `media` is a subset of the purpose's `media`; and the caller's own limits (§13). It resolves the callee to an origin principal: from a handle through the callee issuer's directory ([organizations §3a.2](organizations.md#3a2-handle-lookup)), from a principal, or from the link presented as basis. A callee whose current issuer does not declare `rtc-signaling.v1` is refused with `unsupported_peer`; that is a public fact. The caller provider then obtains the callee's current certification keys (a caller-initiated fetch, never on a federation request path), obtaining the identity URI only as §5.1 requires, and keeps them current for the session's life, so that the callee's answer verifies under §8.2 step 3. If it cannot, `open` fails with `temporarily_unavailable`. Every other outcome of `open` is the same success (§12).

### 4.2 Admission bases

The callee provider admits an `invite` only on one of these bases, evaluated live:

| Basis | Wire | Admits when |
| --- | --- | --- |
| `self` | `basis: null`, caller origin principal equals callee | Always, subject to the owner's per-application settings. |
| `link` | `basis: {"link_digest": <base64url SHA-256 of the canonical link>}`, with the link itself carried beside the message in the batch (§8.1) | The link verifies at the callee provider as its owner host and is live, and its type admits the purpose: a **contact link** (links §6) whose owner-side configuration enables RTC for that purpose (§4.3), or an **RTC ticket link** (§4.3). |
| `none` | `basis: null`, another entity | Only if the callee owner has enabled requests from verified identities for that purpose. Such invites MUST NOT alert (§4.4). Default: off. |

**Verifying a link basis.** The link MUST be canonical as a links §6.4 `contact-url` is (origin and path plus exactly `bindle_meta` or legacy `sig`, no `bindle_data`, no unrelated parameters), and its SHA-256 MUST equal `link_digest`. The callee provider verifies it as if it had received a request for that URL: the link's origin MUST equal the provider's configured canonical origin, its path is the request path, and links §3.2–§3.3 (or the legacy contact-endpoint rules) apply. Only the digest is in the signed invite, so the bearer link is never delivered to endpoints (§9.1).

A basis grants nothing beyond reaching the callee's endpoints with one invite. The caller is always identified by its verified leg certificate, never by link possession: a link authorizes reaching, the certificate says who is calling, as links §6.1 does for messages. Restricting who may use a link is done with a principal-bound ticket (§4.3). A relation basis is reserved for a later version (§15).

Quarantine, blocking and muting (§13) apply after admission and are silent.

### 4.3 Contact-link configuration and the RTC ticket link type

**Contact links.** RTC permission on a contact link is mutable owner-side configuration on the parent (keyed by `jti`), like intake configuration ([links §6.2](links.md#62-intake-configuration)): a list of purpose lines (at most 16). It is not a link member, is never signed into the link, and is never disclosed in any link representation. It is directional: Alice enabling RTC on her link lets holders call Alice, not the reverse. Legacy Beam permissions were dropped when Beam was removed on 2026-10-26 and do not map to any RTC configuration (design §5).

**RTC ticket link** (`type` = `https://spec.bindle.example/links/rtc-ticket/v1`). The meta payload member set is the links §3.2 common members plus exactly:

| Member | Definition |
| --- | --- |
| `sub` | The callee's stable account UUID. |
| `purposes` | Nonempty, unique, ascending list of at most 8 purpose line URLs. |
| `uses` | Integer 1 to 1,000: how many invites it can admit. |
| `principal` | `null` (any verified identity), or `{iss, sub}`: only that origin principal. |

Lifetime (`exp − iat`) is at most 30 days. At §8.2 step 2 the callee provider checks only that the ticket is valid, live and not exhausted. A use is spent, and `principal` compared with the **verified** leg-certificate principal, atomically at §8.2 step 8, so forged or failing invites never consume uses. A ticket at zero uses, revoked or expired admits nothing, silently. A GET of a ticket link never admits, spends or creates anything.

**Callback.** An invite MAY carry `callback`: a one-use ticket minted by the caller's provider, with `principal` set to the callee and `exp` at most 24 h after `iat`, so the callee can ring back. Like a link basis, only its digest is in the signed invite and the link travels beside the message; the callee provider delivers it only to the endpoint that claims the session.

A ticket is a bearer capability: its URL is subject to the secrecy rules of [contact endpoints](contact-tokens.md#url-secrecy-and-browser-handling). Shown as a QR code, it proves nothing about proximity.

### 4.4 Acceptance and alerting

- A session connects only through a claim with outcome `accept` by one callee endpoint (§7.2). A callee provider MUST NOT claim on its own.
- For a cross-entity session, the claim MUST result from a user action at the callee device, except the glare rule of §7.3. For an own-entity session it MAY be automatic only when the purpose has `auto_accept: "self"`, the owner enabled it for that application, and the caller leg certificate's `client.client_id` equals the claiming endpoint's application.
- An invite alerts only when the purpose has `alert: true`, the application is approved for alerting that purpose, the basis is `self` or `link`, and no mute applies. Otherwise it is delivered without alert or not delivered; how a provider presents unalerted invites is its own policy.
- A decline reveals that a callee device saw the invite. A provider MUST NOT send a decline that no user action or owner setting caused.

## 5. Keys and certificates

### 5.1 Leg keys and leg certificates

For each leg, the endpoint generates a fresh ES256 key pair. It SHOULD be non-extractable. It MUST NOT be reused across sessions, so a peer cannot link an endpoint across sessions by its key. The entity's provider certifies the public key in a leg certificate: a compact JWS under the links §3.1 JWS profile, protected header exactly `{alg:"ES256", kid:<an active certification kid of the entity (organizations §3a.3)>, typ:"bindle-rtc-leg-certificate+jwt"}`, payload exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"rtc-leg-certificate"`, `1` |
| `iss`, `sub`, `identity` | The leg's entity at its current issuer, and its identity URI. |
| `aud` | The peer entity's identity URI (equal to `identity` for own-entity sessions). |
| `sid` | The session (§6.1). |
| `role` | `"caller"` or `"callee"`. |
| `purpose` | `{purpose, version, digest}`. |
| `client` | `{client_id, origin}`: the application that holds the key, as verified by the provider. |
| `cnf`, `delegate` | `{jkt}` and the public JWK, as in [organizations §5.2](organizations.md#52-member-authentication-certificates-and-signed-requests). |
| `aep` | The entity's authority epoch. |
| `jti`, `iat`, `exp` | `exp − iat` at most the declared `max_leg_certificate_seconds`, and `exp` no later than the session's maximum lifetime (§7.1). |

Issuance rules: the provider signs only with an `active` certification key, never with the identity signing key; only after the §4.1 checks (caller) or a successful claim (callee); only to the endpoint's own application connection; and it refuses a `delegate` already certified in any live session of the entity or within the last 24 h. An endpoint renews its certificate before expiry through the contract (§9.1); the renewed certificate has the same `sid`, `role` and `cnf`.

Verifiers check: profile, `typ`, exact members, `aud` (the verifier's own entity, or the peer it expects), `sid`, `exp` with 60 s skew, and the signature against the issuer's `active` certification keys (organizations §3a.4 and §3a.5). A certificate signed by the identity signing key fails. The `identity` member is a claim: a verifier (provider or endpoint) obtains the identity URI only from the issuer's directory `?sub=` lookup ([organizations §3a.2](organizations.md#3a2-handle-lookup)), from its own pin or from an adopted move record (organizations §3a.1), checks that it equals `identity`, and applies the §3a.4 no-rollback rule.

### 5.2 Control statements

A provider sometimes ends a leg or session on its own (revocation, expiry, move). It does so with a control statement: protected header exactly `{alg:"ES256", kid:<active certification kid>, typ:"bindle-rtc-control+jwt"}`, payload exactly `{bindle:"rtc-control", v:1, iss, sub, aud, sid, leg, type:"end", reason, iat, jti}`, where `leg` is the affected leg's `jkt` or `null` for the whole session, and `reason` is one of `expired`, `revoked`, `moved`, `failed`. A control statement can only end things; nothing else is defined for it. After a verified control statement, nothing from the ended leg or session is accepted again.

Certification keys gain these two uses (AMD-R1, §18); `typ` separates them from every other certificate and statement profile, so no verifier accepts one profile as another.

*Provisional amendment AMD-RV1 (independent review follow-up, 2026-10-27, unsigned):* every RTC JWS (leg certificate, control statement, message) MUST carry a low-S ES256 signature (`s` at most `n/2`), and verifiers refuse a high-S signature, so a relaying party cannot mint a second compact form of a signed element. A certification key is an identity-document key with `use: "cert"` and `state: "active"`; a `sig` or `enc` key never verifies a leg certificate or control statement. A verifier accepts a control statement only from the session party it expects (`iss` and `sub`, besides `aud` and `sid`), never from whichever entity signed it.

## 6. Messages

### 6.1 Envelope

A message is a compact JWS under the links §3.1 profile, protected header exactly `{alg:"ES256", typ:"bindle-rtc-message+jwt", kid:<the leg's jkt>}`, at most 40,960 bytes, payload exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"rtc-message"`, `1` |
| `iss`, `sub` | The sending entity at its current issuer. |
| `aud` | The receiving entity's identity URI. |
| `sid` | 22 to 43 base64url characters encoding at least 128 random bits, chosen by the caller provider. |
| `leg` | The sender's leg `jkt`. It MUST equal the leg certificate's `cnf.jkt`. |
| `to` | The receiving leg's `jkt`, or `null` only for `invite` and `cancel`. |
| `seq` | Integer 0 to 4,095. Per (`sid`, `leg`), starting at 0 and increasing by exactly 1 per message. |
| `iat` | Unix seconds. |
| `type`, `body` | §6.2. |

### 6.2 Types

| `type` | Sender | `body` (exactly) |
| --- | --- | --- |
| `invite` | caller | `purpose` (`{purpose, version, digest}`), `media` (nonempty subset of the purpose's `media`), `ring_until` (Unix seconds, at most `iat` + 120), `basis` (§4.2), `context` (`null` or an object valid against the purpose's `context.data`), `offer` (`null` or an SDP offer, §6.3), `callback_digest` (`null` or the base64url SHA-256 of a canonical ticket link carried in the batch, §4.3), `sas_commit` (`null` or §11.3). |
| `cancel` | caller | `{}`. Ends an unclaimed session. |
| `accept` | callee | `answer` (an SDP answer if the invite carried an offer, otherwise `null`), `sas_nonce` (`null` or §11.3). |
| `decline` | callee | `reason`: `declined`, `busy` or `unsupported`. |
| `sdp` | either | `gen` (integer ≥ 0), `description` (`{type, sdp}` with `type` `offer`, `answer` or `rollback`; `sdp` empty for `rollback`). |
| `candidates` | either | `gen`, `items` (0 to 16 `{candidate, sdpMid, sdpMLineIndex, usernameFragment}`), `complete` (boolean). |
| `sas` | caller | `nonce` (§11.3). |
| `end` | either | `reason`: `hangup`, `failed` or `timeout`. |

Unknown types or members are invalid. `invite` is the caller's message `seq` 0; `accept` or `decline` is the callee's `seq` 0. Only the caller leg may send `invite`, `cancel` and `sas`; only the claiming callee leg may send `accept` or `decline`, and only after its claim succeeded.

### 6.3 SDP and candidate rules

These rules exist so that addresses travel only in `candidates` messages, where the sender's provider and the receiver can see and filter them (§10, §12):

- An SDP is at most 24,576 bytes of UTF-8 with CRLF line endings. It MUST carry `a=ice-options:trickle`, and MUST NOT contain `a=candidate`, `a=remote-candidates` or `a=end-of-candidates` lines (attribute names compared case-insensitively). Every `c=` and `a=rtcp` address MUST be `0.0.0.0` or `::`, and the `o=` address MUST be `0.0.0.0`, `::`, `127.0.0.1` or `::1`. *AMD-RV1 (provisional, unsigned):* the `o=` username and session id MUST each be `-` or decimal digits and its session version decimal digits (an endpoint whose browser writes another username, such as Firefox, rewrites it to `-` before sending; the field has no protocol effect); the SDP MUST NOT contain `u=`, `e=` or `p=` lines; and outside the `o=`, `c=` and `a=rtcp` address fields and the `a=fingerprint` value no line may contain an `IN IP4`/`IN IP6` token, a dotted run of four numbers, or a run of hexadecimal digits, dots and colons with two or more colons.
- Every `m=` line's media type MUST be `audio`, `video` or `application`, consistent with the invite's `media` (`audio` → `audio`; `video` and `screen` → `video`; `data` → `application`). Providers cannot tell `screen` from `video`; that is the endpoints' concern.
- The SDP MUST contain an `a=fingerprint` attribute (session or media level) with `sha-256` or stronger. Endpoints MUST NOT apply an SDP that lacks one. *AMD-RV1 (provisional, unsigned):* every `a=fingerprint` line in the SDP, at session and media level, MUST carry the same hash algorithm and value (compared case-insensitively), so the fingerprint the SAS covers (§11.3) is the one DTLS authenticates; an SDP with two different fingerprints, or any weak one, is invalid.
- A candidate is an [RFC 8839](https://www.rfc-editor.org/rfc/rfc8839.html) `candidate-attribute` value without the `a=` prefix, at most 512 bytes. Its `typ` is `host`, `srflx` or `relay`. A `relay` candidate MUST carry `raddr 0.0.0.0 rport 0` or no `raddr`, because the related address is the endpoint's own public address. In a cross-entity session a `host` candidate's address MUST be an mDNS name ending in `.local`; raw host addresses are allowed only in own-entity sessions. *AMD-RV1 (provisional, unsigned):* an mDNS name MUST be a UUID followed by `.local` ([RFC 8828 §5.1.1](https://www.rfc-editor.org/rfc/rfc8828.html#section-5.1.1)); in a cross-entity session a `srflx` candidate's `raddr` (its host base address) MUST be `0.0.0.0`/`::` with `rport 0`, an mDNS name or absent, and the address of a `srflx` or `relay` candidate MUST NOT be an unspecified, loopback, private, shared (RFC 6598), link-local, unique-local, multicast or reserved address, including an IPv4-mapped, IPv4-compatible or NAT64 form of one; unknown candidate extension attributes are refused.
- No SDP and no candidate travels before the claim, except the invite's candidate-free `offer`.
- These rules hold under every IP policy, so both providers and endpoints enforce them. Which candidate types an endpoint sends under its owner's policy (§10) is enforced only by the sender's own provider, because the receiver cannot know the sender's policy.

### 6.4 Ordering, replay and expiry

- A receiver (provider or endpoint) processes each leg's messages in `seq` order, buffers at most 32 messages ahead of a gap for at most 10 s, and then ends the leg with `failed`. Duplicates of an accepted (`sid`, `leg`, `seq`) are ignored. Reusing a `seq` with different content ends the leg with `failed`.
- `iat` MUST be at most 120 s in the past and 30 s in the future at receipt.
- Replay state is kept per session until its end plus 300 s. A message for an ended session or leg is ignored.

## 7. Session model

### 7.1 States and lifetimes

Each provider keeps its own record of a session: `ringing` → `connected` → `ended`, with `ended` reached directly from `ringing` by cancel, decline, `ring_until` passing or a control statement. A session's maximum lifetime is 24 h from the invite. After it, providers end the session (`expired`) and accept nothing further. A media connection the endpoints already have is not stopped by a provider (§11.4); a longer use opens a new session.

### 7.2 Fan-out and first claim

An invite names an entity, never a callee endpoint, except that an own-entity invite MAY name one of the entity's own endpoints (§9.1 `open` `target`). An endpoint is **eligible** when it is registered for the purpose, its application holds the slot grant with that purpose approved, and no mute excludes it. The callee provider delivers an admitted invite to the eligible endpoints, at most 16, most recently active first; a `target` must be eligible. The caller's own endpoint never receives its own invite.

A callee endpoint answers with the contract's `claim` (§9.1); only an endpoint the invite was delivered to may claim. The callee provider decides the first claim atomically, per session, at a single authority for the callee entity. The winner receives its leg certificate; every other claim fails with `claimed`, and the provider tells the other notified endpoints that the session was claimed, without saying by which endpoint or with which outcome. A decline claim ends the session for every callee endpoint. Only the winning leg's messages ever reach the caller.

The caller provider likewise accepts only the first `accept` or `decline` for a session; any later callee leg is sent a control statement `end` with `failed`.

### 7.3 Glare and renegotiation

**Crossing invites.** When an endpoint has an unclaimed outgoing session to an entity for a purpose and receives an invite from that entity for the same purpose line, it compares the two `sid` values as byte strings after base64url decoding. The session with the lower `sid` survives. The endpoint whose outgoing session has the higher `sid` cancels it, and MAY claim the surviving invite with `accept` without a further user action, because its user just asked to connect with that entity for that purpose.

**Renegotiation.** After the claim, either leg MAY send `sdp` offers (including ICE restarts). Each offer carries a `gen` one higher than the highest `gen` the sender has seen. The callee leg is the **polite** peer and the caller leg the **impolite** peer, as in the W3C perfect-negotiation pattern: on a collision, the impolite leg ignores the incoming offer, and the polite leg rolls back, applies the incoming offer and answers it. `candidates` carry the `gen` they belong to; candidates for a superseded `gen` are ignored.

### 7.4 End

Either leg ends a connected session with `end`; the caller ends an unclaimed one with `cancel`. On receiving `end`, `cancel` or a control statement, an endpoint MUST close the peer connection for that session.

**Crossing cancel and answer.** A `cancel` that reaches the callee provider after a successful claim is processed as `end` with `hangup`. An `accept` that reaches the caller provider after the caller's `cancel` is answered by the caller provider with a control statement `end` (`failed`) for that callee leg. Both sides converge to `ended`.

### 7.5 Multi-party

Multi-party sessions are a non-goal of this version. A mesh of several participants is a set of independent two-party sessions; a conferencing server is a peer entity reached with ordinary sessions. A later version MAY add an explicit group correlation member; this version defines none, and the exact-member rules reject one.

## 8. Transport between providers

### 8.1 Endpoint and batch

A provider sends messages and control statements for a session to the `endpoint` of `rtc-signaling.v1` in the validated manifest of the peer entity's **current** issuer, found through the successor index for a moved identity. It MUST NOT send to any other URL, including one received in a response, a link or a message. Delivery follows the protocol §2 fetch rules (HTTPS, no redirects, bounded size and time, screening of private, loopback and link-local targets).

The request is a `POST` with `Content-Type: application/vnd.bindle.rtc+json` (a project-private proposed media type) and a body of at most 131,072 bytes:

```json
{"v": 1, "certificates": ["<leg certificate>"], "messages": ["<message>"], "controls": ["<control statement>"], "links": ["<canonical link>"]}
```

`certificates` (at most 4), `messages` (at most 32) and `controls` (at most 4) may each be empty, but not all three. `links` (at most 4, each at most 8,192 characters) carries the links whose digests appear in invites in the same batch (§4.2, §4.3), and nothing else. Messages in one batch belong to sessions between the same two entities. A leg's certificate MUST accompany its first message to each receiver and every renewal; receivers keep it for the session. A batch in which any element fails step 1 of §8.2 is refused as a whole.

### 8.2 Verification

The receiving provider MUST perform these steps in order:

1. **Without any fetch**, check the batch shape and bounds; for each JWS, the links §3.1 rules, `typ`, `bindle`, `v` and exact members; that `aud` is an absolute HTTPS URL on this provider's issuer origin with no userinfo, query or fragment (whether it names a hosted entity is decided silently at step 2); and the `iat` window.
2. **Without any fetch**, find the session by (**caller** origin principal, `sid`). The caller principal is the sender for a message whose certificate has `role: caller`, and the entity named by `aud` for `role: callee`, each mapped through the successor index. For an `invite`, the session must not exist yet (a retried copy of the same invite is ignored at step 5), and the basis is checked (§4.2) without spending anything. For a callee leg's `seq` 0 `accept` or `decline` with `to` equal to the caller leg, the session must exist with no callee leg recorded; the first one verified at step 4 becomes the callee leg (§7.2). For any other message, the sender's `leg` must be the session's caller leg or its recorded callee leg.
3. Verify the leg certificate (§5.1) against the sender's `active` certification keys **as already held**. The receiver keeps current, by background refresh under organizations §3a.4, the keys of the entities its hosted entities admit (holders of their links and tickets it has seen, peers of their sessions within the last 24 h) and of the callees of its own entities' open sessions (§4.1). If the key is not held, the message is not processed, and a refresh for that sender is scheduled exactly as it would be for any other principal naming the same issuer, so the schedule does not depend on step 2. Refresh scheduling follows organizations §5.2: the queue is bounded; per-issuer and global fetch budgets apply before any fetch; the issuer's manifest must meet the protocol §2 floor and declare `directory.v1` and `rtc-signaling.v1` before its identity documents are fetched; failures are negatively cached (§3a.4). **One exception:** for an invite whose link basis verified at step 2, the receiver MAY fetch the sender's identity document during processing, under the same budgets (as organizations §5.1 allows after a presented link verified).
4. Verify the message signature under the certificate's `delegate`, and that the certificate's `sid`, `aud`, `purpose` (for an invite) and `role` match.
5. Apply §6.4 ordering and replay. A (`sid`, `leg`, `seq`) is recorded only after step 4.
6. Refuse an `aep` lower than the highest recorded for that sender. A higher one is recorded. Recorded epochs are kept only for principals in the refresh roster or with live admission state, and dropped with them.
7. Apply policy: block, mute, quarantine, limits (§13), whether any local application is approved for the purpose, and the SDP and candidate rules (§6.3). The callee provider validates `context` against the pinned purpose version it holds; if it holds none, nothing is delivered and the session silently stays unanswered.
8. Apply, atomically: for a ticket basis, spend a use and compare `principal` with the verified certificate principal (§4.3); create or update the session; fan out (§7.2) or deliver to the claimed endpoint.

The response is `202` with an empty body for every batch that passes step 1, whatever steps 2 to 8 decide, and processing after step 1 MAY be asynchronous. A batch failing step 1 gets `400`. A provider MAY shed load by source network before step 1 (`429` or `503`). It MUST NOT shed by the sender's claimed issuer or principal before verification, and its response timing MUST NOT depend on steps 2 to 8.

Control statements are verified by steps 1, 2 (the session and, if not `null`, the leg must exist), 3 (the signing key is an `active` certification key of the session party that sent it), 5 (by `jti`) and then applied.

### 8.3 Delivery, retries and latency

- Delivery is at least once. A sender retries on network errors and `5xx` with backoff (for example 0.5, 1, 2 and 4 s) until the item's useful life ends: `ring_until` for `invite`; for a control statement, the latest `exp` of the affected leg certificates, so a revocation keeps being delivered for as long as the revoked leg could still sign; otherwise 30 s. Retried JWS values are sent unchanged; receivers deduplicate (§6.4).
- Because a held-key miss (§8.2 step 3) drops an invite silently, a caller provider SHOULD keep retrying an undelivered invite until `ring_until`; the callee's background refresh then lets a later retry through.
- A provider SHOULD forward a message to the peer provider within 250 ms of accepting it from its endpoint, and SHOULD make a received message available to the target endpoint within 250 ms of step 8 under normal load. These are targets, not guarantees.

## 9. The signaling contract

### 9.1 Methods

`https://spec.bindle.example/contracts/rtc-signaling/v1`, invoked by ordinary RPC (protocol §5) on the occupant the application was granted. `x-bindle-brokerable: false`. All arguments reject unknown members. Every method checks the slot grant and the bound purposes live.

**Endpoint binding.** An endpoint identifier alone never authorizes. When the RPC token is DPoP-bound, `register` binds the endpoint to that key's `jkt`, and every later call naming the endpoint MUST be made with the same key. Otherwise `register` also returns `endpoint_secret` (at least 128 random bits), which every later call naming the endpoint carries; the provider stores only its hash.

| Method | Effect | Arguments → result |
| --- | --- | --- |
| `register` | write | `{purposes, label?, push?}` → `{endpoint, endpoint_secret?, expires_at}`. Registers this device instance of the application as an endpoint for the listed approved purposes. `label` is at most 64 characters of plain text shown only to the owner. `push` is optional (§9.2). An endpoint lives at most 30 days after its last `listen`. |
| `unregister` | write | `{endpoint}` → `{}`. Ends its legs (§14). |
| `endpoints` | read | `{}` → `{endpoints: [{endpoint, label, purposes, last_seen}]}`: this application's endpoints for the owner's own entity only. |
| `open` | write | `{endpoint, to, purpose, media, delegate, basis?, target?, callback?}` → `{sid, certificate, expires_at, peer_keys, callback?}`. With `callback: true` the provider mints the callback ticket (§4.3) and returns it; the endpoint puts its digest in the invite, and the provider carries the link in the batch. `to` is a principal or handle; `target` is one of the owner's own eligible endpoints (§7.2), allowed only when `to` is the owner. `basis` is the link to present, if any. `peer_keys` are the callee's active certification keys as the provider holds them (§4.1). |
| `claim` | write | `{endpoint, sid, outcome, delegate}` → `{certificate, peer_keys, callback?}`, or error `claimed`. `outcome` is `accept` or `decline`. Only an endpoint the invite was delivered to may claim. `callback` is the invite's callback ticket link, if any. |
| `send` | write | `{endpoint, sid, messages}` → `{accepted}` with at most 32 JWS messages, all by this endpoint's leg in this session. The provider applies §6, §6.3 and the owner's IP policy (§10) to its own endpoint's messages before relaying, and refuses violations with `invalid_args`. |
| `renew` | write | `{endpoint, sid}` → `{certificate}`. |
| `listen` | read | `{endpoint, cursor?, wait?}` → `{cursor, events, gap}`. Long poll, `wait` at most 25 s. Events, in order: `invite` (the raw invite and certificate, plus the provider's projection: verified caller principal, a handle only when the provider holds a verified directory binding, caller `client.origin`, purpose, media, context projected to the application's pinned purpose version, basis kind `self`, `link` or `request`, `alert`; never the basis or callback link itself), `message` (a raw message from the peer leg), and `state` (`claimed`, `expired`, `ended` with the control statement when there is one). A queue that overflowed reports `gap: true`; affected sessions are ended `failed`. |
| `mint_ticket` | write | `{purposes, uses, expires_in, principal?}` → `{link}`. Mints an RTC ticket link for the owner (§4.3), within the application's bound purposes. |

Errors follow protocol §5. `claimed` is the only method-specific error that depends on session state, and it is returned only to the owner's own endpoints.

### 9.2 Delivery to devices

- **Long poll (required).** `listen` is the baseline every occupant implements.
- **Web Push doorbell (optional).** `push` is a [Web Push](https://www.rfc-editor.org/rfc/rfc8030.html) subscription `{endpoint, keys: {p256dh, auth}}`. The provider sends at most one push per alerting invite per endpoint, encrypted under [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html), with `Urgency: high`, a TTL no longer than the remaining ring time, and a payload of exactly `{"t":"rtc","endpoint":"<endpoint>"}`: no caller, purpose or session. The push endpoint URL is an outbound fetch target: it MUST be HTTPS and pass the protocol §2 SSRF screening, and a provider SHOULD accept, at `register`, only origins it recognizes as Web Push services. Pushes count against the callee's invite limits (§13), so registering an endpoint cannot turn invites into traffic toward an arbitrary host.
- **Integration doorbell (optional).** A confidential integration's server MAY receive the SET event `…/events/rtc-ring/v1` (payload exactly `{endpoint}`) on its existing events channel ([integrations §6](integrations.md#6-events)), so it can wake its native app. AMD-R3 registers it.

A doorbell is never needed for correctness and carries no session content. The endpoint always fetches content with `listen`.

## 10. ICE and relays

- **Who provides relays.** Each endpoint obtains relay credentials only for itself, from its own entity's `ice-relay` occupants, or from its application's own relay configuration. A provider never hands relay credentials to the peer's endpoints, and a credential is never sent in a signaling message.
- **Built-in relay occupant.** A provider's built-in relay occupant issues credentials only for a live leg of its entity in a session that has been claimed (callee) or opened (caller), with a lifetime at most the shorter of the provider's maximum and the session's remaining life, and revokes them, best effort, when the leg ends. It enforces its own budget and MUST NOT rely on byte counts reported by clients. A relay operator cannot bind relay traffic to one session; the budget has to be enforced at the relay.
- **IP policy.** Each endpoint operates under its owner's policy for the session, which restricts only the candidates it gathers and sends: `relay` (only `relay` candidates), `public` (adds `srflx` candidates whose `raddr` is unspecified, an mDNS name or absent, and mDNS `host` candidates; AMD-RV1, provisional) or `all` (adds raw `host` addresses, own-entity sessions only, §6.3). For a session with another entity, the default MUST be `relay`, and `public` requires the owner's opt-in (per peer or global). Own-entity sessions MAY default to `all`. The sender's provider enforces the policy on its own endpoint's `send`. An endpoint under `relay` gathers only relay candidates (for example with `iceTransportPolicy: "relay"`) and MAY pair them with any remote candidate: its own address stays hidden whatever the peer sends.
- **No relay available.** If the policy is `relay` and the endpoint has no relay, the session cannot connect. The endpoint reports that and MAY ask the owner to allow `public` for this session. It MUST NOT fall back silently.
- **STUN.** Contacting a STUN server discloses the endpoint's public address to that server's operator. An endpoint under `relay` policy does not use STUN.

## 11. Media security and end-to-end identity

### 11.1 Fingerprint binding

WebRTC authenticates the DTLS handshake against the `a=fingerprint` of the remote SDP. Every SDP here travels inside a message signed by the peer's certified leg key, and the signed payload binds `sid`, both principals (`iss`/`sub` and `aud`) and both legs. An endpoint MUST apply an SDP only if it arrived in a message that verified under §5.1 and §6 for this session and the expected peer leg. A party that can change the fingerprint without a leg key, such as a network attacker, a TURN operator or a party relaying the batch, is detected. A replayed SDP from another session fails on `sid`.

### 11.2 Verification levels

Endpoints verify the peer's leg certificate against keys obtained in one of two ways:

1. **Provider-supplied (baseline).** The keys in `peer_keys` or a `listen` event, as held by the endpoint's own provider. This trusts the endpoint's own provider, as the endpoint already does.
2. **Direct.** The endpoint fetches the peer's identity document from the peer's current issuer itself (organizations §3a.3 and §3a.5), obtaining the identity URI only as §5.1 requires, with the same no-rollback rules. Then the peer's provider is the only party able to impersonate the peer, and the endpoint's own provider cannot substitute the peer's keys. The fetch reveals the endpoint's network address to the peer's issuer, so an endpoint under `relay` policy MUST NOT fetch directly unless its owner opted in.

### 11.3 Short authentication string (optional)

To detect substitution by any provider, two users can compare a short authentication string (SAS). The caller puts `sas_commit` = base64url(SHA-256(`n_c`)) in the invite, where `n_c` is 32 random bytes. The callee puts `sas_nonce` = base64url(`n_e`), 32 random bytes, in its accept. After receiving the accept, the caller sends `sas` with `nonce` = base64url(`n_c`); the callee checks it against the commitment and ends the session with `failed` on mismatch. Both compute

`h = SHA-256("bindle-rtc-sas-v1" || 0x00 || sid || 0x00 || n_c || n_e || fp_caller || fp_callee)`

where `sid` is its ASCII form and `fp_*` are the raw bytes of the `sha-256` fingerprint of each side's applied SDP (unique per SDP under AMD-RV1, §6.3; an SDP whose one fingerprint uses another hash gives no SAS). The SAS is the first 32 bits of `h` as an unsigned big-endian integer, modulo 1,000,000, written as 6 decimal digits with leading zeros. An endpoint MUST NOT display the SAS before the reveal verified against `sas_commit`; a missing reveal means no SAS for that session. Because the caller commits before it sees `n_e`, and reveals `n_c` only after `n_e` is fixed, a substituting party gets one guess per session (about 1 in 1,000,000) at matching the strings. A renegotiation that changes either fingerprint requires a new comparison; this version defines no re-keying of the SAS.

### 11.4 What providers and others can still do

| Party | Can | Cannot |
| --- | --- | --- |
| The caller's provider | Impersonate the caller (it certifies leg keys); see the caller's sessions, peers, purposes, contexts, timing and network address; drop, delay or forge-cancel its signaling; ring the caller falsely; certify a key it holds and thereby take part in a session as the caller. | Read media or data without substituting a leg (detected by SAS). Impersonate the callee to the callee's own provider. |
| The callee's provider | The same for the callee. Learn whether and on which of its user's devices a session was answered. | Substitute the caller's keys toward a callee endpoint that verifies directly (§11.2). |
| Both providers together, or one provider hosting both parties | Mount an undetected man-in-the-middle unless the users compare the SAS. | Defeat a compared SAS except by the one guess. |
| A relay operator | See its own endpoints' network addresses, peers' relay addresses, timing and volume. | Read or alter DTLS-protected media or data. |
| An application | Anything its code does with the media and data it receives. Endpoint code delivery is outside this specification. | Ring for purposes the owner did not approve; reach endpoints of other applications. |

A provider cannot stop a peer connection that already exists. Ending a leg (§7.4, §14) relies on the peer endpoint closing it and on relay credentials lapsing.

## 12. Privacy

- **No presence oracle.** Nothing a caller or its provider observes may depend on whether the callee has endpoints, is online, admitted the basis, blocked or muted the caller, quarantined the link or has an approved application, except a claim the callee made. In particular: the §8.2 response and timing are uniform; `open` succeeds alike (§4.1); there is no ringing or busy indication; the caller's session simply ends at `ring_until` when unanswered. A callee provider MUST NOT send a message the caller could use to learn any of these.
- **Device inventory.** Endpoints, their count, labels and last-seen times are never disclosed to another entity. Leg keys are per session (§5.1). The callee's accepted leg reveals only that one device answered.
- **Address disclosure.** No address leaves an endpoint before the claim (§6.3). Afterwards candidates go only to the accepted peer leg, under the IP policy (§10).
- **Minimal metadata.** Providers keep, per session, only what routing, ordering, replay protection and limits need. They MUST NOT log SDP, candidates, addresses taken from candidates, `context` values, `ice_servers` credentials or ticket links, and MUST delete SDP and candidates once delivered or after 60 s.
- **Retention.** A provider deletes session records no later than 24 h after the session ends. It MAY keep, for the owner's own view, a list of missed and held invites (caller principal, purpose, time) for at most 30 days, deletable by the owner. Rate-limit state is keyed so that it reveals no more than the limit needs and expires with its window.
- **Third parties.** Push payloads carry no session content (§9.2). Purpose and identity documents are never fetched on a request path from another provider (§3.4, §8.2).

## 13. Abuse

- **Limits.** Values are provider policy (the reference host's are in the design, RTC-11); the kinds of limit are not. A callee provider MUST limit, after verification: invites per (caller origin principal, callee); invites per caller origin principal across its entities; invites per (sending issuer, callee) and per (sending issuer, link parent), because one issuer can mint any number of principals; concurrently ringing sessions and invites per callee; and messages per leg. When ringing capacity is short it SHOULD prefer `self` and principal-bound ticket bases over bearer-link bases. Excess invites are dropped silently at §8.2 step 7, still answered `202`. A caller provider MUST limit open sessions and `open` calls per entity, and refuses its own application with `rate_limited`.
- **Blocking.** An owner blocks an origin principal. Blocked invites are dropped silently and never recorded as missed.
- **Muting.** An owner mutes a principal, a purpose or an application. Muted invites are delivered without alert or recorded as missed.
- **Quarantine.** An invite admitted through a quarantined contact parent is answered and processed exactly as through an active one up to step 7, then held as a quarantined request without alert or ring. This follows the quarantine silence of [contact endpoints](contact-tokens.md#live-grants-limits-and-metadata-trust).
- **Requests (`none` basis).** Never alerting, limited as above, with a bounded number held per callee; excess are dropped silently.
- **Revocation.** Revoking a link, removing RTC from a contact link or exhausting a ticket stops new admissions at once. Sessions already connected continue until ended.

## 14. Lifecycle

- **Account moves.** When an entity's move commits, its source provider ends every session of that entity with a control statement `moved`, revokes relay credentials and stops issuing leg certificates (its certification keys are revoked at commit, [identity portability §6.3](identity-portability.md#63-commit-at-the-source)). Peers resolve the entity's current issuer through successor pins and deliver only there (§8.1); messages naming an earlier issuer fail at §8.2 step 2. Admission state is keyed by origin principal. Contact links and tickets work at the destination only if imported (identity portability §11). In-progress sessions are not migrated.
- **Device or application revocation.** When an endpoint is unregistered, its session is revoked or its application loses the slot grant, its provider at once stops relaying and certifying for its legs, revokes their relay credentials (best effort), and sends a control statement `revoked` for each connected leg, retried for as long as the leg's certificate could still be used (§8.3). A revoked endpoint that still holds an unexpired leg certificate and posts directly to the peer provider is refused there once that control statement arrives. The residual window is bounded by the control statement's delivery and, at worst, by the certificate's remaining lifetime, at most `max_leg_certificate_seconds` (900 s).
- **Session expiry.** A session ends at `ring_until` if unclaimed, and at 24 h in any case (§7.1). Leg certificates never outlive the session.
- **Authority resets.** A higher `aep` from a peer is recorded (§8.2 step 6). A provider MAY end sessions with a peer whose authority reset; it MUST refuse certificates with a lower `aep`.
- **Slot changes.** Removing the signaling occupant, revoking an application's grant or narrowing its bound purposes ends affected registrations and sessions as above. Blocking a purpose version (extensions §7) stops new sessions of that version.

## 15. Interoperability and versioning

- **Discovery.** A caller provider learns a peer's support from the peer issuer's manifest: `rtc-signaling.v1` for cross-provider sessions. An application learns its own provider's support from the manifest's `extensions` occupant declaration for the signaling slot. Providers without `extensions.v1` process the slot fragment as an ordinary fragment; with no built-in occupant, there is no signaling (extensions §8).
- **Versions.** The feature, the message `v`, the certificate and control `v`, the slot, the contracts, the link type and each purpose line version independently, each by its own rule. A receiver rejects an unknown `v`. A new message version is introduced by a new feature version, and a provider MAY declare both.
- **Purpose versions.** A callee provider delivers an invite of purpose version *M* to an application that approved version *N* < *M* only when it verified that the line is additive from *N* to *M* (artefacts §7.2); it then projects `context` to version *N* and still delivers the raw invite unchanged. Applications register purposes by publishing `rtc-purpose` lines; a provider SHOULD hold the candidate lines (§3.4) from installation.
- **Reserved.** A `relation` basis (an RTC access entry granted over a relation edge, [organizations §9](organizations.md#9-relations)), brokered signaling occupants, a group member, long-term device keys for end-to-end pinning, and a WebSocket or SSE delivery profile.

## 16. Alternatives considered

| Alternative | Why not |
| --- | --- |
| A new extension mechanism for RTC | The existing feature, slot, artefact and link mechanisms express everything except per-consumer bound options, which AMD-X1 adds in four rules. |
| Provider-signed hop-by-hop events, as relation events use | The receiving provider could rewrite DTLS fingerprints undetectably. End-to-end leg signatures cost one certificate per leg and let endpoints verify what providers verify. |
| Long-lived device keys | Link one device across every session and every peer. Per-session keys plus optional SAS give the same detection without the tracking. Long-term pinning stays reserved. |
| SDP with candidates in the invite, delivered to every device | Discloses the caller's addresses to every callee device before anyone answers, and makes candidate policy unenforceable by providers. |
| A ringing or busy message | Reveals presence to every caller who can reach the callee. |
| Caller's provider funds relays for both parties (Beam's paid-sender rule) | Hands the callee's addresses to the caller's relay operator and lets a callee spend the caller's budget. Each party funding its own relay keeps both bounded. |
| One slot per purpose | A slot can carry exactly one resource field and its own consents; one slot per purpose would multiply grants and leave purposes unversioned outside slots. Purposes as artefacts plus bound options keep one grant. |
| Signaling over messaging or conversations (as opaque blobs) | No ordering, no latency target, no first-claim semantics, and messaging retention keeps what signaling must delete. |
| Network fetches during verification | Timing reveals admission and contact relationships; organizations §5.2 rejected the same. |
| Using contact links only for admission | Nearby pairing, call-me links and callbacks need bounded, single-purpose capabilities; a ticket link type reuses the links machinery for them. |

## 17. Provisional decisions

RTC-1 to RTC-17, each with a recommendation, are in the [design §9](../architecture/rtc-signaling.md#9-provisional-decisions). None is signed off.

## 18. Amendments — proposed (unsigned)

| ID | Document | Change |
| --- | --- | --- |
| AMD-X1 | extensions §2.1, §2.2, §5.2; wire profile | Bound consumer options (§3.5): slot member `bind` (listed in `crit`), `options` on slot fragment requests, per-consumer approval recorded in the grant. Applied provisionally to [extensions §13](extensions.md#13-amendment-amd-x1--bound-consumer-options-proposed-unsigned) on 2026-10-26 (still unsigned). |
| AMD-R1 | organizations §3a.3; links §7.2 signature-domain table | Certification keys gain two uses: `bindle-rtc-leg-certificate+jwt` and `bindle-rtc-control+jwt`. Add rows for both and for `bindle-rtc-message+jwt` (leg keys). |
| AMD-R2 | protocol §2 feature table | Add `rtc-signaling.v1` (§3.1). |
| AMD-R3 | integrations §6.2 | Register the `rtc-ring/v1` doorbell event (§9.2). |
| AMD-R4 | artefacts §6.3 | Register the `rtc-purpose` kind and its growth table (§3.4). |
| AMD-R5 | links | Register the `rtc-ticket/v1` link type (§4.3); contact links gain owner-side RTC configuration (§4.3) beside intake configuration. |
| AMD-RV1 | this document §5, §6.3, §10, §11.3 | Independent security review follow-ups (2026-10-27), applied provisionally and unsigned: one fingerprint pair per SDP (SAS binds the DTLS fingerprint); stricter SDP address hygiene (`o=` fields, no `u=`/`e=`/`p=`, no IPv6-like or dotted-quad runs, case-insensitive candidate lines); public `srflx`/`relay` addresses and UUID mDNS names cross-entity; `srflx` `raddr` under `public`; low-S ES256; `use: "cert"` keys only; control statements only from the expected party. Recorded in DEVLOG 2026-10-26 "RTC-a/b/c", "Review follow-ups". |
| AMD-RV2 | this document §8.2 step 3, §8.3 | RTC-e security review follow-ups (2026-10-27), proposed and unsigned, **not applied to the text above**: a receiver MAY order scheduled refreshes so that peers with a live or ringing session come first and claims whose invite carried a link basis that verified at step 2 come next, and MAY cap the other claims per source network; the response and its timing still never depend on steps 2 to 8. A caller provider re-sends an undelivered invite only after the first `202`, at most twice, and stops after a permanent refusal (§8.3 SHOULD narrowed). See DEVLOG 2026-10-27 RTC-e "Review follow-ups" (readings RTCe-8 and RTCe-9 corrected). |
| AMD-R6 | beaming | Beam's signaling contract, relay rules and nearby invitations are superseded by this document; Beam's transfer experience may return as an application on the `file-transfer/v1` purpose (design §6). Applied early: Beam was removed from the core on 2026-10-26 and [beaming](beaming.md) is now a superseded stub. |

## 19. Conformance tests

Tests MUST cover:

- **Extension system:** the slot processed as an ordinary fragment by a provider without AMD-X1 (via `crit`), with every bound operation refused; bound purposes disclosed, approved as a subset, enforced per consumer, widened only by a new approval and narrowed at once; a brokered registration of the signaling contract refused; occupancy invisible to other providers.
- **Purposes:** each body rule; growth points accepted and frozen members rejected; `auto_accept: self` with `parties` other than `self` rejected; a `contact-link` context field rejected; context projection to an older approved version; no fetch of a purpose on a federation request path.
- **Authorization:** each basis; a contact link without RTC for the purpose; a non-canonical link or one whose digest differs from `link_digest`; ticket uses exhausted under concurrent invites (exactly `uses` admitted); no use spent by invites failing certificate or signature checks; a ticket bound to another principal, including one claimed by an unverified `iss`/`sub`; a revoked or quarantined parent; `none` disabled by default; `parties` and `media` enforced at `open`; auto-accept refused when the caller leg's `client_id` differs from the claiming application; basis and callback links never delivered to endpoints except the callback to the claiming endpoint.
- **Certificates and messages:** wrong `typ` between all certification-key profiles; a certificate signed by the identity signing key; `aud`, `sid` or `role` mismatch; a reused `delegate`; renewal keeping `cnf`; exact members; `seq` gaps, duplicates, reuse with different content and the 32-message buffer; the `iat` window; `to` null outside `invite`/`cancel`; a message from an ended leg.
- **SDP and candidates:** each §6.3 rule, including `a=candidate` in SDP, missing `a=ice-options:trickle`, non-zero `c=` and `a=rtcp` addresses, a relay candidate with a real `raddr`, a raw `host` address cross-entity, a missing fingerprint, two different fingerprints (session and media level), a private `srflx` or `relay` address cross-entity, a non-UUID mDNS name, a high-S signature; candidates before the claim; IP policy enforced on the sender's `send`; a `relay` endpoint connecting to a peer that sends `srflx` candidates.
- **Push:** a push endpoint at a private address or unrecognized origin refused at `register`; pushes counted against invite limits.
- **Endpoints:** calls naming an endpoint without its DPoP key or `endpoint_secret` refused; a claim by an endpoint the invite was not delivered to refused; an ineligible `target` refused.
- **Sessions:** fan-out to exactly the eligible endpoints, most recently active first; concurrent claims with exactly one winner; the callee's first `accept` found under the caller-keyed session and later callee legs refused; a `cancel` crossing an `accept` converging to `ended` at both providers; decline ending every device; the caller accepting only the first answer; crossing invites resolved by lower `sid` at both ends; perfect negotiation collisions both ways; `ring_until` and 24 h expiry; `end` and control statements closing everything.
- **Transport:** `202` with identical body and timing across every step 2 to 8 outcome (unknown identity, unknown session, unadmitted, blocked, muted, quarantined, no approved application, limit exceeded, held key missing); refresh scheduling independent of admission, with a bounded queue, budgets and the manifest floor checked before any identity-document fetch; the link-verified fetch exception only after verification; a batch with one malformed element refused whole; control statements retried until the affected certificates expire; per-issuer limits applied to many principals from one issuer; delivery only to the current issuer's manifest endpoint; retries deduplicated; shedding never by claimed issuer.
- **Privacy:** no SDP, candidates, context, credentials or links in logs or retained records past their bounds; push payload exact; no endpoint data in any cross-entity response; direct identity fetch refused under `relay` policy without opt-in.
- **Relays:** credentials issued only for live legs, bounded by session life, revoked at end, never in messages; `relay` policy with no relay failing visibly.
- **Lifecycle:** a move ending sessions with `moved` and messages via the old issuer failing; device and application revocation sending `revoked` and refusing later direct posts; a lower `aep` refused.
- **SAS:** commitment mismatch ending the session; no SAS shown without a verified reveal; identical strings at both ends for an honest session, including values with leading zeros; a substituted fingerprint changing the string.
