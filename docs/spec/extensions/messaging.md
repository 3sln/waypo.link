# Bindle Messaging interop v1 — normative draft

> **Group:** Bindle extension
>
> **Status:** design candidate (2026-10-20); protocol validation and a local mailbox engine exist for the Parlay app; not a published occupant, independent interop or production-verified.
>
> **Covers:** Bindle Messaging interop between people: addresses, delegation, records, invitations and call invitations.
>
> **Does not cover:** the Parlay app itself (`apps/parlay`); message content rules ([message content](message-content.md)); 3sln.me app messages ([messages from connected apps](../../3sln/services/app-messages.md)).

> **Pending [extensions revision 3](../extensions.md) (draft, unsigned, 2026-10-27).** Where this document relies on slots or the `email-bridge` consumer, extensions revision 3.2 and protocol §2–§4 govern instead. The `messaging-address` consumer is withdrawn by the [contacts and links spike](../../architecture/contacts-and-links-rethink.md) (CL-4, CR-X1). Change request CR-X3-31 (CR-X3-04 is void), [extensions Appendix A](../extensions.md#appendix-a-migration-and-impact-change-requests-not-applied).

Status: **design candidate**, 2026-10-20. Protocol validation and a local mailbox engine exist in `packages/messaging-protocol/` and `packages/messaging-engine/`; provider delegation/status routing exists behind `LINKS_ENABLED` (default off). These are local implementations, not a complete published occupant, independent interop or production verification. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders until publication authority is agreed. MUST/SHOULD/MAY are draft requirements.

Naming (2026-10-27, DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"): this spec is **Bindle Messaging** (the user's 2026-10-20 name; formerly "BindleBox interop", `docs/spec/bindlebox.md`). The reference messaging app is **Parlay** (owner's working name, provisional), built in this monorepo under `apps/parlay` with `packages/messaging-protocol` and `packages/messaging-engine`. Identifiers moved with the rename while nothing is published: `…/bindlebox/v1` became `…/messaging/v1`, `application/vnd.bindlebox.*` became `application/vnd.bindle.messaging.*`, and the `bindlebox-*` signing domains became `bindle-messaging-*`. The spec is published by the messaging app's side, not by the core; its slot documents are `docs/artefacts/slots/messaging-ingress-v1.json` and `docs/artefacts/slots/public-message-intake-v1.json`, the single copies the provider and Parlay both pin. The former core messaging spec (blob messaging, collections and Views) is retired to apps/parlay/docs/legacy/messaging.md (Parlay legacy record `apps/parlay/docs/legacy/messaging.md`).

Architecture and rationale: [Parlay architecture](../../architecture/messaging-app.md). Extraction: [messaging extraction](../../architecture/messaging-extraction.md). Review: [messaging app review](../../release/messaging-app-review.md). Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This profile defines peer-to-peer messaging between independent messaging apps acting for Bindle identities. It depends on the following core work:

- [protocol](../protocol.md);
- [extensions](../extensions.md);
- the generic link envelope in [links](links.md) §1–§5 and §7.1–§9;
- [message content](message-content.md);
- the core directory/identity-document profile (implemented locally for organizations; Parlay integration is a separate dependency);
- the `key-delegation.v1` feature (§3, assumed);
- the links contract (§4.2, assumed).

`key-delegation.v1` and the links contract are core amendments **proposed by this document**. They are not yet in the core specs, and their owners must accept them before publication or a conformance claim. Slots, integration events and brokered resources follow [extensions](../extensions.md) and [integrations](integrations.md) revision 2 as published.

It replaces these drafts for peer messaging:

| Draft | Reused | Removed |
| --- | --- | --- |
| contact delivery (Parlay legacy record `apps/parlay/docs/legacy/contact-delivery.md`) | Envelope, display-string rules, verification order, replay | Bearer RPC, anonymous branches |
| [links](links.md) | Contact type (§6, §6.1–§6.3, delivery half of §7.5) | — |
| contact endpoints (Parlay legacy record `apps/parlay/docs/legacy/contact-tokens.md`) | — | Legacy `?sig=` and inbox bearers |
| conversations v1 (Parlay legacy record `apps/parlay/docs/legacy/conversations.md`) | — | Central authority, `actor:"bearer"` |

The [scaling spike](../../release/messaging-scaling-spike.md) P0 items are answered in architecture §18.

## 1. Terms and identifiers

- **Principal**: a Bindle identity `(iss, sub)`, where `iss` is the provider origin and `sub` is the stable account UUID.
- **Occupant**: the recipient's mailbox resource in the messaging-ingress slot (§2.1), hosted by a messaging app.
- **Ingress**: the occupant's public HTTPS delivery URL.
- **Delegate key**: an app-held P-256 key certified for a principal (§3).
- **Obligation**: a sender's durable duty to deliver one envelope to one recipient.

| Identifier | Value |
| --- | --- |
| Profile | `https://spec.bindle.example/messaging/v1` |
| Messaging-ingress slot | `https://spec.bindle.example/slots/messaging-ingress/v1` |
| Mailbox contract | `https://spec.bindle.example/messaging/v1/contracts/mailbox` |
| Contact link type | `https://spec.bindle.example/messaging/v1/links/contact` |
| Author purpose | `https://spec.bindle.example/messaging/v1/purposes/author` |
| Receipt purpose | `https://spec.bindle.example/messaging/v1/purposes/receipt` |
| Archive purpose | `https://spec.bindle.example/messaging/v1/purposes/archive` |
| Public-intake slot and contract | `https://spec.bindle.example/slots/public-message-intake/v1`, `https://spec.bindle.example/contracts/public-intake/v1` |
| Ingress descriptor media type | `application/vnd.bindle.messaging.ingress+json` |
| Intake media type | `application/vnd.bindle.messaging.intake+json` |

## 2. Slot, contract and ingress descriptor

### 2.1 Messaging-ingress slot manifest

This is a slot per [extensions §2](../superseded/extensions-rev2.md#2-slot-manifests). The manifest is immutable at its URL.

```json
{
  "id": "https://spec.bindle.example/slots/messaging-ingress/v1",
  "title": "Receives messages",
  "description": "The one app that receives peer messages, contact links and bridged email for you.",
  "publisher": "https://spec.bindle.example",
  "fields": {
    "occupants": {
      "title": "Messaging app",
      "type": "resource",
      "cardinality": {"min": 0, "max": 1},
      "contracts": ["https://spec.bindle.example/messaging/v1/contracts/mailbox"]
    }
  },
  "slot": {"v": 1, "field": "occupants", "selection": "exclusive", "consumers": ["provider"], "supersedes": null}
}
```

Only provider features consume this slot. Other apps never obtain a credential for the mailbox contract (review P-17).

A provider that routes links to messaging apps declares this consumer entry in its manifest `extensions` (extensions §4):

```json
{"slot": "…/messaging-ingress/v1", "digest": "sha256-…", "role": "consumer", "ref": "messaging-address", "purpose": "Tells people who hold your contact links where to deliver."}
```

A messaging app declares the matching occupant entry in the `extensions` of its client metadata, next to its `bindle_integration` member ([integrations §2](integrations.md)), whose `resources` list the mailbox contract:

```json
{"slot": "…/messaging-ingress/v1", "digest": "sha256-…", "role": "occupant", "ref": "mailbox"}
```

An app that also accepts bridged email declares an occupant entry for `…/slots/public-message-intake/v1` as well (§9).

### 2.2 Mailbox contract (provider to occupant)

Provider consumers invoke the mailbox resource over ordinary resource RPC ([protocol §5](../protocol.md#5-rpc-transport)) using the brokered consumer credential.

| Method | Args | Result |
| --- | --- | --- |
| `describe` | `{}` | The ingress descriptor body of §2.3, without `expiresAt`. |
| `linkRevoked` | `{jti}` | `{}`. Informs the occupant that the provider revoked a link. The occupant also polls `links.changes` (§4.2), so a lost call is recovered. |

`describe` is declared `"effect": "read"`. Bridged intake uses the separate public-intake contract (§9).

`describe` MUST be side-effect free. The provider MUST validate the result against §2.3 before serving it, and treats an invalid result as "no occupant".

### 2.3 Ingress descriptor

The descriptor answers `GET <contact link>` with `Accept: application/vnd.bindle.messaging.ingress+json` at the link's owner host, once links §8 steps 1–2 have succeeded. The body is JSON:

| Member | Meaning |
| --- | --- |
| `version` | `1` |
| `profiles` | Nonempty array of supported profile identifiers. Includes `…/messaging/v1`. |
| `ingress` | Absolute HTTPS URL on the occupant's origin, with no userinfo, query or fragment. It SHOULD be the same for every mailbox the instance hosts. The instance routes by the signed `payload.recipient` and the credential, so the URL does not identify the user (review S-8). |
| `multicast` | Optional absolute HTTPS URL (§7.3), on the same origin as `ingress`. |
| `verifies` | Optional array of issuer origins whose principals this occupant can currently verify (§3.3). Absent means unknown. Senders use it to warn before composing. |
| `limits` | `{maxParticipants, maxMessageBytes, maxEnvelopeBytes, maxBatchContexts?}`, each a positive safe integer no larger than the §11 maxima. |
| `kinds` | The link's signed `kinds`. |
| `expiresAt` | Unix milliseconds, at most 1 hour after the response. |

- **Errors.** With no occupant, an occupant pending consumer re-review, or an occupant whose `describe` failed validation, the owner host returns `recipient_unavailable`, always as 503 with `Retry-After: 3600` and a uniform body. A single status means it cannot distinguish an absent occupant from one mid-switch (review S-8, P-5). Senders treat `recipient_unavailable` as retryable until the obligation's deadline.
- **Response headers.** Responses are `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, with credentialless CORS (`*`), and they never vary on cookies.
- **Side effects.** Resolution delivers nothing and consumes no quota.
- **Sender caching.** A sender MAY cache a descriptor until `expiresAt`. On 404, 410 or `ingress_moved` from the ingress, it MUST discard the cache and re-resolve at most once per attempt.
- **Profile negotiation.** A sender MUST pick a profile listed in `profiles`. It MUST NOT downgrade to an unlisted profile or to any unauthored path.

**No public per-entity resolution.** Parlay needs no public lookup from a handle or principal to an ingress, and it defines none. This answers the open question in extensibility design §10.1.

- Senders reach a person only through a capability: a contact link, which yields a descriptor, or an established conversation, whose bindings arrive signed by the peer.
- A peer whose stored ingress fails with 404, 410 or `ingress_moved` waits for the new occupant's `ingress` or `rejoin` record (§6.3, §6.6), which the new occupant sends to every conversation peer when an import completes.
- No enumeration surface is added to core.

Host-wide fetch rules apply to descriptor fetches, ingress POSTs and directory lookups. Senders MUST use HTTPS (loopback only in explicit development), MUST NOT follow redirects, MUST screen private, loopback and link-local addresses at connect time, and MUST bound connect, response size and total time.

### 2.4 Integration events and identity keys

This section reconciles with [integrations](integrations.md) §5–§6.

- **Credentials.** Provider consumers reach the occupant through the brokered consumer credential (integrations §5.3).
- **Events.** The occupant receives the SET events of integrations §6.2 at its `events_endpoint`. It interprets them as follows:
  - `connection-revoked` or `credential-revoked` covering the mailbox grant: the occupant has been removed or severed. It stops admitting traffic for that owner and stops renewing its delegation.
  - `resource-detached` for the mailbox: the same.
  - `preferences-updated`: storage or classifier changes.

  Each SET is signed and verified as integrations §6.1 requires (review S-16).
- **No identity-key events.** Integrations defines no identity-key-rotation or link-revocation event. The occupant therefore resolves its owner's identity key through the directory, exactly as for any other principal (§3.3), and polls `links.changes` (§4.2) every 5 minutes and before admitting the first delivery on any parent it has not checked in that time.
- **Requested for later.** Proposed `identity-key-rotated` and `link-changed` events would make these updates faster. They have been requested from the integrations owner, but nothing here depends on them.

## 3. Principals and delegate keys

### 3.1 Author descriptor

`author` is `{principal:{issuer, subject, identityURI}, identityDocument, keyId, delegate}`:

- `keyId` is the principal's identity signing key, exactly as the directory publishes it;
- `delegate` is `"jkt:"` followed by the RFC 7638 SHA-256 thumbprint (canonical unpadded base64url) of the delegate public key.

`identityURI` and `identityDocument` MUST have `issuer` as their origin. Naming is as in contact delivery S13 and stays provisional.

### 3.2 Delegation certificate (core feature `key-delegation.v1`, assumed)

A provider declaring `"key-delegation.v1": {}` in `features` issues certificates to an app installation only after explicit owner consent naming the purposes. A certificate is a compact JWS. Its protected header is exactly `{alg:"ES256", kid:<identity keyId>, typ:"bindle-key-delegation+jwt"}`. Its payload contains exactly:

| Member | Definition |
| --- | --- |
| `bindle` | `"key-delegation"` |
| `v` | `1` |
| `iss`, `sub` | The principal. |
| `delegate` | `{kty:"EC", crv:"P-256", x, y}`, a public key only. |
| `jkt` | RFC 7638 thumbprint of `delegate`. |
| `purposes` | A nonempty, unique, ascending array of purpose URIs. |
| `client` | `{client_id, origin, ingress?}`. `origin` is the app installation's verified origin. `ingress`, when present, is the provider-recorded ingress URL from the occupant's validated `describe` result (review S-4). |
| `cnx` | Opaque connection-incarnation identifier, 1 to 64 characters. |
| `since` | Unix seconds at which this `jkt` was first certified for this principal and connection. |
| `jti` | Unique certificate ID. |
| `iat`, `exp` | Unix seconds, with `iat < exp ≤ iat + 86400`. |

The JWS rules of [keys §3](../keys.md#3-compact-jws-profile) apply: strict I-JSON, exact members, received-bytes signing input, and a 64-byte signature.

Issuance rules (reviews S-3, S-12, P-3):

- A provider MUST certify the Parlay author, receipt and archive purposes only to the installation that is the current messaging-ingress occupant, and MUST set `client.ingress` for it. At most one installation per principal holds these purposes at any time.
- Certifying a new `jkt` for a principal MUST revoke every earlier `jkt` carrying these purposes. This applies to a new key in the same installation and to a new occupant.
- Removing or replacing the occupant revokes its `jkt` at once.
- A provider MUST support revoking every delegation issued to a `client_id`, for the case of a breached app instance.

A provider MUST stop issuing certificates for a `cnx` immediately when the connection is revoked or the occupant removed, when the account is suspended, or when the owner revokes the key. Every profile verified against an identity key MUST reject a delegate key, and every profile verified against a delegate key MUST check that the certificate lists that profile's purpose.

### 3.3 Verifying an author

A receiver MUST perform all of these checks:

1. Resolve the principal's identity key under the directory profile, with pinned continuity. A key embedded in the message, certificate or headers is never a trust anchor.
2. Verify the certificate signature with that key, its `typ` and its `bindle` value.
3. Check that `iss`/`sub` equal `author.principal`, that `jkt` equals `author.delegate` and the thumbprint of `delegate`, and that `purposes` contains the author purpose.
4. Check `iat - 60 ≤ now ≤ exp + 60`, and `payload.createdAt ≥ (since - 60) × 1000`.
5. Verify `proof.signature` (§5.3) with `delegate`.

Until the directory profile exists, a receiver can resolve only principals whose provider exposes a directory to it. All other principals are refused with `author_unverifiable` (401), and no network fetch is attempted.

### 3.4 Delegation status (assumed)

`GET {identityURI}/delegations/{jkt}` returns `{status:"active"|"revoked", revokedHour?}`. `revokedHour` is the Unix hour, floored, so the response carries no reason and only a coarse time (review S-3). Receivers MAY cache the result for up to 5 minutes. The lookup goes through the same SSRF controls and fetch budget as directory lookups.

**When a status check is required.** A receiver MUST check status before applying any of the following, and MUST refuse with `author_unverifiable` (503 with `Retry-After`) when status cannot be determined:

- `conversation-init`;
- an invitation response;
- every record with a lasting effect: `edit`, `retract`, `rotate`, `leave`, `ingress`, `peer-proposal`, `peer-response`, `peer-hello`, `rejoin`;
- every receipt (§8.1).

For `message` records and one-offs, the receiver MAY rely on certificate expiry.

**Exposure.** For checked records, exposure after a revocation is bounded by the status cache (5 minutes). For other records it is bounded by the certificate lifetime.

**After learning of a revocation.** A receiver MUST quarantine every record from that `jkt` that has not yet been applied and whose `createdAt` is at or after `revokedHour - 1 h`. Quarantined records are shown to the owner for review, not applied.

## 4. Contact link type

### 4.1 Meta members

This type is defined over the generic link envelope of [links](links.md) §2–§5. `type` is `…/parlay/v1/links/contact`.

The exact meta member set is the common members (links §3.2) plus `sub, resource, kinds, mimeTypes, maxMessages, maxBytes, maxMessageBytes`, with an optional `audience` (links §7.1).

- `kinds` is a nonempty, unique, ascending subset of `["conversation-init","one-off"]`.
- `resource` is an opaque parent identifier at most 128 characters long, meaningful only to the occupant.
- `collections` and tag members MUST NOT appear.

Bounds and quota semantics are those of contact endpoints. On a conditional link, quotas apply per verified author principal per UTC day (links §7.1). An unconditional link MUST reject `bindle_data`.

### 4.2 Issuance (core links contract, assumed)

A messaging app obtains links through a provider-hosted resource implementing `https://spec.bindle.example/contracts/links/v1`, requested by fragment. Its methods:

- `issue({type, claims})` returns `{link, jti}`. The provider fills `iss`, `aud`, `jti`, `iat`, `exp`, signs with the identity key and stores the exact header and claims.
- `revoke({jti})` returns `{}`.
- `evaluate({jti, principal})` returns `{state}`, one of `eligible`, `ineligible`, `unavailable`, under links §7.5 reuse rules. A local block of that principal, or a policy change, MUST invalidate any reused positive decision immediately (review S-20).
- `list({type, cursor})` returns `{links:[{jti, header, claims, revoked, occupantGeneration}], cursor}`.
- `changes({since})` returns the `jti` values revoked or issued since a provider sequence number.

The provider issues only types that a registered link-type binding maps to a slot whose current occupant is the caller. For this type, the caller must be the messaging-ingress occupant. Core keeps this registration as a small table from link type to slot.

**Occupant replacement.** Links remain valid when the occupant changes. The new occupant reads them with `list`. Each link records the `occupantGeneration` that issued it.

The previous app has seen every link capability, so on replacement the provider (or the new occupant) MUST show the owner the links issued under the previous occupant and offer to revoke and reissue them in bulk (review S-14).

### 4.3 Intake configuration

The occupant stores intake per parent, as in links §6.2:

- `revision`;
- `autoTags`;
- `optionalTags` with labels.

These are disjoint, hold at most 32 IDs together, and are updated by compare-and-swap. Intake is owner-private organization. It is not part of the link, the signature or `md`.

### 4.4 Intake representation

`GET {ingress}/intake` with `Authorization: BindleLink <bindle_meta>` and `Accept: application/vnd.bindle.messaging.intake+json` returns `{version:1, intakeRevision, optionalTags:[{id,label?}], kinds, mimeTypes, maxMessageBytes, quotaScope, expiresAt, conditional, policy?}`. These are the members of links §6.3 minus `form` and `type`.

The request is side-effect free. It MUST NOT disclose `autoTags`, policy tags, quota usage or anything about the requester.

### 4.5 Presenting the link at delivery

A delivery through a contact link sends `Authorization: BindleLink <bindle_meta>` to the ingress. The occupant MUST:

1. parse the value under links §2 rule 4;
2. verify the meta per links §3.3, against the identity key it holds for `sub` and its stored exact claims;
3. check that the link is not revoked by itself or by the provider, and that `type` is this type;
4. check that `payload.recipient.contactId` equals `jti` and `payload.recipient.resource` equals `resource`.

Failures produce the uniform `link_invalid` (401). `bindle_data` MUST NOT be presented at delivery (`link_malformed`).

### 4.6 Conditional links

At admission, the occupant obtains the decision for the author principal through `evaluate`, reusing a decision as links §7.5 permits. `ineligible` is `audience_ineligible` (403). `unavailable` is `audience_unavailable` (503).

## 5. Envelope

### 5.1 Shape

The envelope is exactly `{payload, proof}`. The payload fields are:

| Field | Definition |
| --- | --- |
| `version` | `1` |
| `profile` | `…/messaging/v1` |
| `kind` | `one-off`, `conversation-init` or `conversation-record` |
| `noReply` | `true` exactly for `one-off`, otherwise `false` |
| `operationId` | Lowercase UUID, stable across retries |
| `createdAt` | Unix milliseconds, immutable |
| `recipient` | For link kinds: `{issuer, owner, contactId, resource}`, matching the presented link. For `conversation-record`: `{issuer, owner, conversationId, incarnation}`, the recipient principal and its admission incarnation for this author. |
| `content` | `{mimeType, byteLength, sha256}` of the exact body, or `null` for control records without a body |
| `subject` | Plain text, at most 200 code points |
| `optionalTags` | Link kinds only: a sorted, unique subset of the current intake allowlist (at most 32). Empty for records. |
| `author` | §3.1 |
| `conversation` | Required for `conversation-init` (§6.1). Absent otherwise. |
| `record` | Required for `conversation-record` (§6.3). Absent otherwise. |
| `resendOf` | Optional. The event ID (records) or `operationId` (link kinds) of an earlier envelope that this one re-sends with identical content. Receivers that hold the original show it once, marked "resent". |

The parsing rules are those of contact delivery "One semantic envelope":

- display strings carry no `Cc` characters, line or paragraph separators, or bidi controls (S6);
- unknown or duplicate members, nonfinite or unsafe numbers, invalid Unicode and a byte-order mark are rejected;
- no normalization is applied;
- the sender chooses no destination, folder or collection.

Bodies use [message content](message-content.md). The v1 body limit is 1 MiB, and v1 has no separate attachment transfer: the body is the whole custody unit. The envelope limit is 64 KiB.

### 5.2 Domain prefixes

| Signed object | Prefix |
| --- | --- |
| Envelope proof | `bindle-messaging-envelope-v1\n` |
| Genesis | `bindle-messaging-genesis-v1\n` |
| Receipt | `bindle-messaging-receipt-v1\n` |
| Invitation response | `bindle-messaging-invitation-response-v1\n` |

These are added to the [keys §4](../keys.md#4-signature-domains) signature-domain table. They differ from every `bindle-contact-*` prefix, so a contact-delivery v1 signature never verifies as Parlay.

### 5.3 Proof

`proof` is `{alg:"ES256", kid, delegation, signature}`:

- `kid` is `author.delegate`;
- `delegation` is the compact certificate of §3.2;
- `signature` is canonical unpadded base64url of the 64-byte `r||s` over `prefix || UTF8(JCS({alg, kid, payload}))`, using RFC 8785 JCS.

`delegation` is outside the signed input. A sender MAY replace it with a renewed certificate for the same `jkt` on retry.

### 5.4 Semantic digest and event identity

`semanticEnvelope` is the envelope with `proof.signature`, `proof.delegation` and every nested signature or certificate removed. `payloadDigest = SHA256(UTF8(JCS(semanticEnvelope)))`.

- For `conversation-record`, the **event ID** is `payloadDigest` computed with the `recipient` member also removed. The same author event therefore has one ID across all recipients, while each recipient's delivery context still binds its own incarnation.
- Randomized signature bytes and renewed certificates never change identity.

### 5.5 Call invitations (proposed, unsigned)

Proposed 2026-10-27, provisional (coordinator), not signed off, not implemented. Bindle Messaging owns this text; it moved here from [signaling](signaling.md) revision 2.1 §20.12 and the [signaling-modes spike](../../architecture/signaling-modes-spike.md) §4, and is aligned with signaling revision 3.2. Signaling attaches no meaning to calls. Sign-off: reviewer ___ / date ___ / outcome ___.

A call invitation is an ordinary message whose body has media type `application/vnd.bindle.messaging.call-invite+json` (placeholder). It travels as a `conversation-record` of `type: "message"`, or a `one-off`, under every rule of §5 to §8. Whether it is accepted at all is decided exactly as for any message: the receiver's first-contact filtering (§6.7) and content refusal apply unchanged. Whether it may alert is decided only by the rule under **Receivers** below.

**Body.** Strict I-JSON under §5.1's parsing rules, at most 4 KiB, with exactly these members:

| Member | Definition |
| --- | --- |
| `v` | `1` |
| `call` | Lowercase UUID chosen by the caller. It identifies the call across edits, and is the session `context.call`. |
| `state` | `"ringing"` in the original message. An `edit` (§6.3) MAY change it to `"cancelled"` or `"ended"`. |
| `media` | A nonempty, unique, ascending subset of `["audio", "video"]`: what the caller offers. It lives only here, never in signaling parameters. |
| `createdAt` | Unix milliseconds, equal to the envelope's `createdAt`. |
| `expiresAt` | Unix milliseconds, at least `createdAt` + 10,000, and at most the earliest `expires_at` in the original message's `session.offers` (in milliseconds) minus 60,000 (a skew margin). Default `createdAt` + 60,000, within that bound. |
| `caller` | `{iss, sub}`, equal to the envelope's verified author principal (§3.3). |
| `session` | `{kind, profile, offers}`: `kind`, an artefact reference to the call session kind below; `profile`, `"webrtc"`; `offers`, 1 to 8 entries `{principal, offer, expires_at}`, one per invited principal, unique, never `caller`, and in a `conversation-record` only genesis participants. Each is a bound, single-use signaling offer (signaling §5.7) with the `expires_at` (Unix seconds) its `offer` result returned. Open offers are not used. |

**Size.** `caller` and each offer `principal`, serialized as `{"iss":…,"sub":…}`, are at most 256 bytes; a principal longer than that cannot be invited by this version of the body. With that bound, 8 entries always fit the 4 KiB cap: one compact entry is at most 349 bytes (a 256-byte `principal`, a 43-character token, a 10-digit `expires_at` and 40 bytes of names and punctuation), 8 entries at most 2,792 bytes, and every other member together at most about 630 bytes (a 256-byte `caller` and the call kind's reference, under 160 bytes), about 3,420 bytes in all. A larger group call uses a group service (signaling §8.6).

An `edit` changes only `state`, and MAY set `offers` to an empty array. The envelope `subject` is `"Audio call"` or `"Video call"` (localizable), so that a receiver without this type still shows something meaningful. A body that breaks these rules is refused with `malformed`, after author verification and before custody.

**The call session kind.** Bindle Messaging publishes `https://spec.bindle.example/messaging/v1/sessions/call` as an intent kind with `effect: "join"`, `capability: false`, `max_bytes: 64`, data `{call}` (`uuid`, required, display `presence`) and `session` `{"v": 1, "parties": "other", "profiles": {"webrtc": {}}, "bases": ["offer"]}`. An app that places or answers calls holds the owner's session handler approval for it (signaling §20.1.4).

**Using signaling.**
1. **Placing.** The caller's app mints one bound offer per invited principal (signaling `offer` with `principals`, §5.7; bound offers are single-use, spent when the dial-back is admitted), lists them with their `expires_at` in `offers`, and then sets `expiresAt` within the bound above. Order does not matter: the bound is checked against the offers' own expiry, not `createdAt`.
2. **Answering.** Only after an explicit user action, and only while `expiresAt` has not passed (30 s skew) and the latest `state` is `"ringing"`, the callee's app calls signaling `open` with `to` = `caller`, the listed `kind` and `profile`, `basis` = its own principal's offer, `context` = `{call}` and `params` = `{offer}` (an SDP offer or `null`). No media parameter is sent.
3. **Binding.** The caller's app claims automatically only as signaling §5.5 allows (the minting endpoint, after its digest-keyed outstanding-offer check), and additionally only for a call it is still placing. The callee's app checks that the connected peer's verified principal equals `caller` before sending media.
4. **Ending.** The caller's app SHOULD revoke unused offers and send an `edit` with `"cancelled"` when it stops before anyone answers, or `"ended"` when the call ends. "Missed" is a local presentation of an invitation that expired unanswered.

A dial-back made near `expiresAt` can still miss its offer if the invite is delayed, for example by a key refresh and re-send at the caller's provider (signaling §9.3); the session then simply does not connect, and the caller MAY place the call again.

**Receivers** MUST NOT auto-answer. A receiver MUST NOT alert (ring, notify urgently or request a presentation hint) for a call invitation unless the receiving owner has sent at least one message (a `conversation-record` of `type: "message"`, §6.3) to that author in a conversation whose genesis participants are exactly the two of them. The author is compared by origin principal ([identity portability §8.1](identity-portability.md#81-stable-identifier)), so a move by either party neither grants nor loses this. The rule is the same for group calls: an invitation in a conversation with more than two genesis participants alerts only if the owner has such a two-party conversation with its author, and is otherwise stored and shown inertly. Once met, the condition persists until the owner blocks the author, or clears it with a per-author control, after which only messages the owner sends later count; muting a conversation does not clear it. It also MUST NOT alert for an invitation that is past `expiresAt` or no longer `"ringing"`, or whose author already alerted 3 times in the last 10 minutes. This one rule covers first contact, unaccepted conversations, one-way followers and contacts admitted through public or leaked invitations, without depending on any app's contact lists. Other invitations MAY be stored and shown inertly. Offers are capabilities: they are kept out of notifications, previews, search indexes, logs and exports. Any alert through the owner's provider uses only the best-effort notice-contract presentation hint (a separate proposal), never a guaranteed channel. Call invitations count as ordinary messages against every §11 limit.

**Vectors needed:** valid audio and video invitations; a `caller` mismatch; `expiresAt` later than the earliest offer `expires_at` minus 60 s, or earlier than `createdAt` + 10 s; an edit that changes `media`; an offer naming a non-participant or the caller; a `session` carrying a media parameter; alerting refused with no prior two-party message from the owner, and allowed after one; a group-call invitation not alerting without that two-party message; the condition surviving the author's move, and ending on a block or an owner clear; a body with 8 entries and 256-byte principals within 4 KiB; 9 entries, or a 257-byte principal, refused.

## 6. Conversations

### 6.1 Genesis and bootstrap

`conversation` is `{genesis, sharedSecret, returnControl, creatorBinding}`, trimmed from contact delivery "Conversation bootstrap".

`creatorBinding` is recipient-specific and is not part of the shared genesis. It is `{ingress, incarnation, profiles, limits, multicast?}`:

- the creator's ingress, which MUST equal the creator certificate's `client.ingress`;
- a fresh incarnation that the creator issues for this invitee;
- the creator's own descriptor members.

Without `creatorBinding`, the invitee could not reply (review P-1).

- `sharedSecret` is 256 random bits, encoded as 43-character base64url.
- `genesis` is `{payload, proof}` signed by the creator's delegate key with the genesis prefix. Its payload is `{version:1, profile, conversationId (UUID), createdAt, creator: author descriptor, participants: [{principal, keyId}] (2 to maxParticipants, unique principals, creator and approached recipient each exactly once), secretEpoch (UUID), secretDigest (SHA-256 of the secret), subject, content}`.
- `returnControl` is `{resource, nonce (22-character base64url), expiresAt (at most 7 days after createdAt), maxResponseBytes: 8192}`. It authorizes only §6.2.

**Provisional BB4-I3 reconciliation (2026-10-20; reviewer/date/outcome pending):** this implementation permits only participants named in genesis. Adding a principal beyond genesis requires a new conversation; no later record expands that list. This restriction remains provisional.

The participant list is a **proposal**, not a roster. Receiving it admits nobody. The UI shows it as "proposed by the creator, unverified" (review S-17). The invitee MUST refuse with `participants_exceeded` (403) when `participants.length` exceeds its own `maxParticipants`.

### 6.2 Invitation response

The invitee POSTs `{payload:{version:1, profile, conversationId, genesisDigest, nonce, decision:"accept"|"decline", acceptListed, responder: author descriptor, binding, createdAt}, proof}` to `returnControl.resource`, signed with the invitation-response prefix. `binding` is `{ingress, incarnation, profiles, limits, multicast?}`.

- `binding` is present only on `accept`. `incarnation` is a fresh opaque ID (1 to 64 characters) that the responder will require on records from the creator.
- `acceptListed` (boolean, default `false`) records the invitee's opt-in to accept the other genesis participants who reach it with `peer-hello` (§6.3).
- **Processing order** (review S-11):
  1. The creator checks the nonce, then that `conversationId` and `genesisDigest` are its own and that the responder is a genesis participant. All of these happen before any crypto, directory lookup or status fetch.
  2. The nonce is single-use. A second response with identical bytes returns the stored result. Different bytes return `invitation_used` (409).
  3. `returnControl.resource` MUST be on the origin of the creator certificate's `client.ingress`. Invitees fetch it under the §2.3 fetch rules.
- The creator verifies the responder against the `keyId` in the genesis participant entry, under §3.3, with the status check of §3.4. `binding.ingress` MUST equal the responder certificate's `client.ingress`.
- `accept` adds the responder to the creator's accepted-peer set, with the returned ingress and incarnation.
- After `expiresAt` the response is refused with `invitation_expired` (410).

### 6.3 Records

`record` is `{type, conversationId, epoch, stream, counter, previous, parents, target?, data?}`.

- **Streams.** A stream is keyed by `(author principal, conversationId, jkt)`. `stream` is the delegate `jkt`. `counter` starts at 1 in each stream. `previous` is the author's prior event ID in that stream.
- **A new key opens a new stream.** When the author's first record in a new stream has `counter` 1, its `previous` MAY name the last known head of the author's earlier stream. Receivers treat the new stream as a continuation, never as equivocation (review P-3). Two keys never sign concurrently for one principal, because §3.2 revokes the earlier key.
- **Counter jumps.** A counter more than 1,024 above the receiver's frontier for that stream is refused with `counter_gap` (400).
- **Gaps.** Audiences differ per event, so gaps are normal. Receivers keep at most 256 gap exceptions per stream and expire them at the 7-day window (review S-10).
- **Parents.** `parents` holds at most 8 event IDs.
- **Epoch (provisional BB4-I3).** `epoch` is the secret epoch the sender used. One event uses one epoch across its frozen audience, even when peers disagree about rotation. An occupant does not regenerate the same event under different epochs for different recipients; unavailable epochs remain retryable until the obligation deadline. Independent reviewer/date/outcome pending.

| `type` | Body | Members | Receiver effect |
| --- | --- | --- | --- |
| `message` | yes | — | Append. |
| `edit` | yes | `target` (event ID) | New revision, applied only when the target's author equals this author. The original is retained. |
| `retract` | no | `target` | Tombstone, applied only when the target's author equals this author. Suppresses rendering of the target. |
| `peer-proposal` | no | `data:{principal, keyId, introduction?}` | **Provisional BB4-I3:** offer a genesis-listed peer to the owner. With prior `acceptListed: true` consent, a verified introduction may auto-accept that genesis participant, subject to block/removal/decline fences and the local group bound. Otherwise an explicit owner decision is required. Principals outside genesis are not added. Independent reviewer/date/outcome pending. `introduction`, when present, is the proposed peer's **own** complete signed invitation response or `peer-hello`. It is the only way a third party can convey that peer's ingress, and the receiver MUST verify it under §3.3 and §3.4 against the proposed principal, with `binding.ingress` equal to that peer certificate's `client.ingress` (review S-2). A creator relays introductions for genesis participants who accepted. |
| `peer-response` | no | `data:{proposal, decision}` | Updates the proposer's view of this owner's decision. |
| `peer-hello` | no | `data:{binding:{ingress, incarnation, profiles, limits, multicast?}, startCounter}` | Sent directly from one participant to another, to an ingress learned from a verified introduction. Its credential is a pair token computed with the fixed incarnation `hello` (§6.4). The receiver answers an accepted hello with its own `peer-hello`, so each side learns the incarnation the other issued for it. The receiver adds the author to its accepted-peer set **automatically** only if it accepted the same genesis with `acceptListed: true` and the genesis lists the author, or it accepted a `peer-proposal` naming the author. Otherwise it offers the hello to the owner. `binding.ingress` MUST equal the author certificate's `client.ingress`. The receiver's frontier for that stream starts at `startCounter`. |
| `rotate` | no | `data:{newEpoch, secretDigest}`. The new secret travels only in the protected `secret` part (§7.1). | Proposal. Local selection is explicit. |
| `rejoin` | no | `data:{binding}` | §6.6 |
| `secret-share` | no | `data:{epoch, secretDigest}`, with the secret in the protected `secret` part | §6.6 |
| `leave` | no | — | Courtesy notice. The receiver removes the author from its outgoing audience. |
| `ingress` | no | `data:{binding}` | Updates the receiver's binding for this author. Accepted only when `binding.ingress` equals the `client.ingress` of a currently valid certificate whose status is active (review S-4). |

Unknown `type` values are refused (`record_unsupported`, 415).

**Edit and retract before the target arrives** (review P-8). If the target is unknown, the receiver stores a pending mutation keyed by `(author principal, target)`, bounded to 64 per conversation with the oldest dropped first. It applies the mutation when the target arrives, and only if the target's author matches. It never refuses with `record_forbidden` merely because the target has not arrived yet.

`record_forbidden` (403) is returned only when a known target has a different author.

**Audience of edits and retractions.** The audience of an `edit` or `retract` is the target's original audience intersected with peers still authorized. It is not the current peer set.

**Missing parents.** A missing parent gets a placeholder. Beyond 64 outstanding placeholders, the receiver collapses further ones into a single gap marker and still accepts the event (review P-7).

**Provisional wargame reconciliation (2026-10-23).** One author holds at most 16 of the 64 placeholders, and its further missing parents are not tracked; placeholders expire after 7 days; the gap marker is set only when the room-wide pool overflows and clears once no placeholder is outstanding, so it is a hint rather than a completeness guarantee. Pending mutations at the 64 bound evict the oldest of the author holding the most, not the oldest overall. A counter at or below the stream frontier is never applied as a new event: the same event is a duplicate, a different event under a consumed counter is equivocation (found through a per-stream counter index kept beyond replay retention), and an abandoned counter is a duplicate that is not applied. A not-applied duplicate costs one record of allowance and leaves a replay row. Each room's stored bytes (envelope plus any body held in the mailbox, for every event) are bounded cumulatively, per room and per author; past the bound records are refused with `recipient_storage_unavailable`.

### 6.4 Conversation credential

Records travel with `Authorization: BindleConversation <epoch>.<pairToken>`, where:

`pairToken = base64url(HMAC-SHA256(secret, "bindle-messaging-pair-v1\n" || conversationId || "\n" || authorIss || " " || authorSub || "\n" || recipientIss || " " || recipientSub || "\n" || incarnation))`

The token is specific to one author, one recipient and one incarnation. A member cannot reuse it to speak as someone else, or replay it to another member (review S-13).

The receiver precomputes the expected token digests for its accepted peers and keeps them in an edge index, so it can refuse a bad credential without waking the mailbox (§7.4). The token is a pre-authentication gate only. Before any crypto or directory work, the receiver checks that the token matches, that `(conversationId, author principal)` is in its accepted-peer set, that the epoch is accepted, and that `recipient.incarnation` is its current incarnation for that author. For `peer-hello`, the incarnation is `hello`, and the author must instead be a genesis participant or a principal named in an accepted proposal. Any failure returns the uniform `not_authorized` (403).

The secret never appears in URLs, logs, search, notifications, previews, or exports that carry no capabilities.

### 6.5 Consent, block, rotation and late events

- **Block.** A local block or removal immediately invalidates the author's incarnation. Records from that original author are refused, even when forwarded by others.
- **Re-acceptance** issues a new incarnation, through a `peer-hello` or by re-invitation. Records bound to an old incarnation are refused with `incarnation_stale` (409).
- **Rotation overlap.** After an owner accepts a rotation, the previous epoch remains accepted for 7 days. A sender that receives `not_authorized` for a record after a rotation it knows of treats the obligation as `retry_scheduled` with reason `epoch` until the deadline. It never treats it as terminal (review P-6).
- **Late events.** A valid signature never overrides a newer local block.
- **Equivocation.** Two different events with the same `(author, conversationId, stream, counter)` are equivocation. The receiver keeps both as evidence, quarantines the later one, and stops accepting that stream until the owner acts. Other streams of the same author are unaffected.
- **Rotation conflicts (provisional, 2026-10-23).** Pending rotations are keyed by `(epoch, proposer)`. Two proposals of one epoch with different secret digests are a conflict the owner sees; accepting needs the owner to name the proposer, and an epoch already selected never takes a second secret; a late differing proposal records a secret conflict naming its proposer, which the owner can dismiss.
- **Group bound.** `maxParticipants` bounds each owner's accepted-peer set for a conversation. An occupant refuses to accept a peer beyond it. Senders pre-check descriptor limits at compose time, and the UI shows "some participants can't see messages from everyone" when bindings show that limits differ (review P-12).

### 6.6 Rejoin after an app switch

Until archive encryption exists, conversation secrets are not exported (§10). A new occupant restores each conversation as follows:

1. It sends a `rejoin` record to each peer, carrying its new binding.
2. `rejoin` is the one record accepted without a pair token. The receiver requires all of the following:
   - the author principal is in its accepted-peer set for that conversation;
   - the certificate's status is active and `client.ingress` equals `binding.ingress`;
   - a limit of one `rejoin` per author per conversation per day.
3. The receiver updates the binding, issues a fresh incarnation, and replies to the new ingress with a `secret-share` record (protected `secret` part) containing the current secret, plus a `peer-hello`.

A peer that is offline answers when it returns. Until then, obligations to that peer are `retry_scheduled` with reason `epoch`.

**Provisional BB4-I3 reconciliation:** while a restored mailbox awaits its secret, records from accepted peers are refused with `recipient_unavailable` (503, `Retry-After: 60`) after author verification, rather than treated as terminal authorization failures. The edge uses its awaiting-secret fence to route these accepted peers without an available pair-token digest. Only a valid, digest-bound `secret-share` installs the missing secret. Other authors remain refused. Independent reviewer/date/outcome pending.

**Provisional wargame reconciliation (2026-10-23):** the restored mailbox installs a `secret-share` only for the epoch it had selected before the switch, or for another epoch still inside its overlap; its selected epoch never changes, and it keeps awaiting until that epoch's secret is installed. A share of an expired epoch is ignored. If no peer holds the selected epoch's secret (for example an own rotation nobody selected), the mailbox stays awaiting until the owner acts.

### 6.7 Request filtering is not observable

A receiver MAY filter, deprioritize or auto-reject first-contact requests (`one-off`, `conversation-init`, bridged intake) under owner policy. This includes classifier-based rules ([architecture §12.1](../../architecture/messaging-app.md#121-public-request-filtering-and-auto-rejection)).

Filtering happens **after** custody. A receiver:

- MUST still return the ordinary receipt for an admitted request;
- MUST NOT return any error code, header, receipt member, timing class or reply that depends on classification, score, rule or allowlist state;
- for an auto-rejected `conversation-init`, MUST send no invitation response. The invitation lapses at `returnControl.expiresAt`, which is indistinguishable from an owner who did not answer.

Refusals that happen *before* custody (credential, rate limit, size, author) use the ordinary §8.3 codes and never depend on content classification.

## 7. Transports

### 7.1 Single delivery

The sender POSTs to `{ingress}` with `multipart/form-data` carrying:

1. an `envelope` part (`application/json`);
2. a `message` part whose Content-Type equals `content.mimeType`, omitted when `content` is `null`;
3. a protected `secret` part (`application/octet-stream`, the 32 secret bytes), only for `rotate` and `secret-share` records.

The multipart framing rules of contact delivery "Signed contact URL POST" apply: no preamble, no duplicate or extra parts, only two part headers, no transfer encodings, and inert filenames.

There is exactly one credential, chosen by kind:

| Credential | Used for |
| --- | --- |
| `BindleLink` | Link kinds |
| `BindleConversation` | Records |
| None | `rejoin` only (§6.6) |

Cookies are not sent. An optional `Idempotency-Key` header MUST equal `operationId`.

### 7.2 Success

The success response is 200 `{receipt}` (§8.1).

### 7.3 Multicast (optional)

Multicast is available when a descriptor or binding names `multicast` on the same origin as its `ingress`. A sender MAY combine deliveries of **one identical body** to recipients whose own verified descriptors or bindings name that same URL. It POSTs to `{multicast}` with `multipart/form-data`:

- a `batch` part: `{version:1, batchId (UUID), content, contexts:[{credential:{scheme:"BindleLink"|"BindleConversation", value}, envelope}]}`;
- the `message` part.

Limits:

- every context MUST share `batch.content`;
- at most `limits.maxBatchContexts` contexts, never more than 32;
- the `batch` part is at most 512 KiB.

The host MUST:

- charge the batch as one request per context against per-source limits, **before** dispatching any context;
- verify each context's credential at the edge (§7.4) without waking a mailbox, with uniform timing for known and unknown mailboxes (reviews S-1, S-8);
- then process each surviving context exactly as a §7.1 request: author, budgets, replay and that owner's own transaction. An error confined to one context never fails another.
- charge each context against the recipient allowances that an individual request would consume.

The response is 200 `{results:[{index, state, receipt?, error?}]}`, with one entry per context in order:

| `state` | Meaning |
| --- | --- |
| `delivered` | A receipt for owner custody is included. |
| `accepted-host` | The credential verified and the context is staged. The sender must reconcile it later. |
| `rejected` | An error code is included. A context with an unknown or unauthorized credential returns `recipient_unavailable`. |
| `unknown` | The outcome is not known. |

A whole-request failure (400, 413, 429, 503) leaves every context unresolved.

The sender reconciles unresolved contexts with unchanged envelopes, by single POST or a later batch. It never automatically resends a context that is already resolved.

### 7.4 Edge credential index

An instance MUST be able to refuse a bad credential without waking the target mailbox. Each mailbox therefore publishes, transactionally with every change, entries into an instance-wide edge index:

| Credential | Index entry |
| --- | --- |
| Links | `{jti → owner, claimsDigest, revoked}` |
| Conversations | `{H(conversationId, author principal, recipient owner) → SHA-256(expected pairToken), accepted epochs, incarnation}` |

The edge checks the presented credential against the index first. Only matching requests reach the mailbox. Index entries contain no secrets and no plaintext pair tokens.

## 8. Receipts, replay, windows and errors

### 8.1 Receipt

`receipt` is `{payload, proof}`. Its payload is exactly `{version:1, purpose:"bindle-messaging-receipt-v1", recipient: principal, ingress, operationId, eventId?, payloadDigest, bodyDigest, kind, receivedAt, state:"delivered", custody:"complete"}`.

The proof is signed with the receipt prefix by the recipient occupant's delegate key, whose certificate carries the receipt purpose. It includes `delegation`.

A sender MUST check all of the following (reviews S-12, P-4):

1. The certificate is valid under §3.3 steps 1–3 with the receipt purpose, and its status is active (§3.4).
2. `receivedAt` lies within `[iat - 60 s, exp + 60 s]` of the certificate and at or after `since`.
3. `recipient` equals the obligation's principal.
4. `ingress` equals the URL it POSTed to (or the context's ingress for multicast), and equals the certificate's `client.ingress`.
5. `payloadDigest`, `bodyDigest`, `operationId` and `eventId` equal its own values.

A receipt that fails these checks leaves the obligation `unknown`.

A receipt proves that the recipient's **current** chosen app took durable custody of these exact bytes under this identity. It does not prove reading, notification, device delivery or consent to anything else.

### 8.2 Replay namespaces

| Kind | Namespace key | Acceptance window |
| --- | --- | --- |
| Link kinds | `(recipient owner, contactId, author principal, operationId)` (contact delivery S2) | `createdAt` within 24 h in the past and 60 s in the future |
| Records | `(recipient owner, conversationId, author principal, stream, counter)`, together with `eventId` | 7 days |

For records, the receiver keeps per-stream frontiers (the highest contiguous counter) plus bounded gap exceptions (§6.3). A bare highest-seen counter is not sufficient.

Retention and restore:

- Receipts and fences are kept for 9 days and are exported (§10).
- Retraction and erase anti-resurrection state is kept for the life of the conversation.
- Both are restored, with control generations, before any traffic is admitted after an import or restore.
- After a restore, an envelope whose `createdAt` predates the restored checkpoint is admitted only if it appears in the imported replay set (review S-9).

The same key with a different `payloadDigest` is `operation_conflict` (409). An identical replay returns the stored receipt without another charge, write or notification, after live authorization has been rechecked.

### 8.3 Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `malformed` | 400 | Framing or schema |
| `link_malformed` | 400 | Link value invalid under links §2 |
| `envelope_expired` | 400 | `createdAt` outside the acceptance window |
| `counter_gap` | 400 | Counter jump above §6.3's bound |
| `clock_skew` | 400 | Future-dated beyond 60 s. Carries `serverTime`. |
| `link_invalid` | 401 | Link fails verification |
| `author_unverifiable` | 401 or 503 | Author cannot be verified now. 503 is retryable. |
| `author_required` | 403 | No author |
| `not_authorized` | 403 | Uniform conversation-gate or host refusal |
| `audience_ineligible` | 403 | Conditional link refuses this author |
| `participants_exceeded` | 403 | Group larger than the receiver accepts |
| `record_forbidden` | 403 | Known target has a different author |
| `operation_conflict` | 409 | Same replay key, different content |
| `incarnation_stale` | 409 | Record bound to an old incarnation |
| `invitation_used` | 409 | Nonce already consumed with different bytes |
| `invitation_expired` | 410 | Response after `expiresAt` |
| `ingress_moved` | 410 | Occupant changed |
| `too_large` | 413 | Over a size limit |
| `record_unsupported` | 415 | Unknown record type |
| `unsupported_profile` | 415 | Profile not supported |
| `rate_limited` | 429 | `Retry-After` set |
| `recipient_unavailable` | 503 | No current occupant. `Retry-After` set. |
| `recipient_storage_unavailable` | 503 | Storage resource unavailable. `Retry-After` set. |
| `audience_unavailable` | 503 | Conditional decision unavailable |

Bodies are `{error, message}` with a fixed, safe message. Responses are no-store and no-referrer, CORS is credentialless, and redirects are never issued.

Sender classification:

- 429, every 503, timeouts and resets are retryable until the deadline.
- 401/403 allow one repair (re-resolve, renew), except as §6.5 says for rotation.
- 404, 410 and `ingress_moved` lead to a re-resolve where a link exists. For a conversation peer they become `retry_scheduled` with reason `moved`, awaiting that peer's `ingress` or `rejoin` record until the deadline.
- 400, 409, 413 and 415 are terminal.

## 9. Bridged and public intake (provider or app to occupant)

The messaging spec publishes slot `https://spec.bindle.example/slots/public-message-intake/v1`, as in the extensibility design §7.1:

- one resource field `occupant`;
- contract `https://spec.bindle.example/contracts/public-intake/v1`;
- `selection: "exclusive"`;
- `consumers: ["provider"]`.

Only the provider consumes this slot (its `email-bridge` feature). Application consumers (third-party channel bridges such as SMS) are deferred until a concrete bridge needs them (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset", review fixes, provisional): admitting them opens a new ingress path into the owner's mailbox and needs its own review of consumer provenance keys, consent and rate limits. While nothing is published, adding them is a correction of v1; afterwards it is a new slot URL (extensions §7). A Parlay mailbox resource implements both the mailbox contract and the public-intake contract, and its integration manifest declares occupant entries for both slots, with `digest`.

**Method `deliver({message, provenance})`.** It is idempotent per `tx`, and has effect `write`. The provider bridge uses `tx = UUIDv5(feature ref, contract, entity, ingress fingerprint)` (extensions §5.3).

- `provenance` is a compact JWS (`typ` `bindle-intake-provenance+jwt`), signed by the consumer's published key: for the provider, its bridge key, discovered like the app-notification keys. Its payload is exactly `{bindle:"intake-provenance", v:1, iss, channel:"email"|<consumer-defined>, recipient: principal, receivedAt, sender:{envelopeFrom, headerFrom, replyTo?}, dmarc:"pass"|"fail"|"none"|"unknown", automation: hint labels, ingressFingerprint, normalizedDigest, jti}`.
- `message` is `{parts:[{mimeType, dataBase64url}]}`, at most 1 MiB in total after the consumer's MIME bounds.

The result is `{disposition:"stored-receipt"|"stored-invitation"|"refused"}`. It is owner-visible status only.

**The occupant MUST** (review S-6):

1. verify the provenance JWS against the consumer's discovered key;
2. check that `recipient` equals its owner and that `iss` is the authenticated consumer;
3. check that SHA-256 of the canonical parts equals `normalizedDigest`;
4. deduplicate on `jti` and `tx`;
5. bound `receivedAt` to the last 7 days;
6. show `dmarc` and the sender fields only as the consumer's assertions.

It MUST present the item as channel-origin with an unverified sender. It MUST NOT sign the item as authored by anyone, admit the sender into a conversation, or reply over that channel. A sender becomes a participant only through the bridge's mailbox-confirmation and identity flow, followed by an ordinary `conversation-init` or invitation response.

**The provider's SMTP behaviour and auto-reply MUST NOT vary with occupancy, occupant availability or `disposition`** (extensions §9.8, no occupancy oracle). See [architecture §13](../../architecture/messaging-app.md#13-email-bridge-handoff-shared-slice-x12).

## 10. Portable archive

To keep history portable, the occupant writes to the owner's `object-storage/v1` resource under `parlay/v1/`.

**Manifest.** `manifest.json` is a compact JWS (`typ` `bindle-messaging-archive+jwt`) signed by the occupant's delegate key under an archive purpose `…/purposes/archive` (review S-15). Its payload is `{version:1, generation, writer:{client_id, cnx}, leaseUntil, segments:[{name, sha256, firstAt, lastAt}], controlGeneration}`. It is advanced by compare-and-swap.

- An importer MUST verify the manifest and segment hashes, and verify retained envelope proofs where present.
- An importer MUST take over the writer lease by writing a new generation naming itself. A previous writer whose lease has been taken MUST stop writing (review P-4).

**Segments** are immutable JSON-lines files of records, each `{type, …}`, where `type` is one of:

`item`, `body-ref`, `peer` (binding, incarnations both ways, accepted epochs), `stream-head` (own author streams per conversation), `frontier`, `gap`, `tombstone`, `pending-mutation`, `block`, `replay` (receipts and fences within the windows), `outbox` (unresolved obligations with their exact envelopes), `quota` (per-day counters), `link-parent` (intake and parent records, without metas), `view`, `rule`, `tag-label`, `overlay`.

Bodies are stored at `bodies/<sha256>`.

**Not exported until segment encryption exists:**

- conversation secrets;
- link metas;
- delegate private keys, which are never exported.

The new occupant obtains links from `links.list` (§4.2), regains secrets through `rejoin` (§6.6) and generates its own key.

**Import order:**

1. control state: blocks, tombstones, pending mutations, frontiers, replay;
2. peers and stream heads;
3. outbox. The previous occupant's delegate key is revoked, so imported unresolved obligations are re-signed by the new key as new events carrying `resendOf`. Recipients that already hold the original show the copy once, marked "resent";
4. items.

During import the occupant admits only records and link deliveries whose replay and control state are already restored. Others get `recipient_storage_unavailable` with a short `Retry-After`. Senders' one-off deadlines are 23 h, so imports that may run longer SHOULD restore control state first (it is small) and then admit traffic while items stream in.

**Encryption** of segments is a later profile. Until then the archive is plaintext to the storage provider, and the owner MUST be told so.

## 11. Limits

These are maxima in v1. Hosts MAY advertise smaller limits.

| Limit | v1 maximum |
| --- | --- |
| Accepted peers per conversation (per owner) | 32 |
| Body | 1 MiB |
| Envelope | 64 KiB |
| Complete request | 1,500,000 bytes |
| Multicast contexts | 32 |
| Multicast `batch` part | 512 KiB |
| Causal parents | 8 |
| Missing-parent placeholders before collapse | 64 |
| Pending mutations per conversation | 64 |
| Gap exceptions per stream | 256 |
| Counter jump | 1,024 |
| Pending proposals per conversation | 16 |
| `rejoin` per author per conversation per day | 1 |
| Delegation certificate lifetime | 24 h |
| Status cache | 5 min |
| Descriptor cache | 1 h |
| Clock skew | 60 s |
| Link-kind window | 24 h |
| Record window | 7 days |
| Rotation overlap | 7 days |
| Receipt and fence retention | 9 days |

## 12. Security considerations

- **Credentials and authorship are independent.** A link or a secret admits a delivery. The author proof names who is speaking. Neither one substitutes for the other.
- **Delegate key compromise** allows signing as the principal for Parlay purposes only, until revocation plus the remaining certificate lifetime (§3.2). The status check on first contact and peer admission bounds the most valuable cases.
- **Expanded work.** Multicast, invitations and proposals are charged as the equivalent individual work (§7.3). No receiver fans out on behalf of a sender, and no receiver fetches recursively.
- **Enumeration resistance.** Uniform `link_invalid`, `not_authorized` and `recipient_unavailable` responses prevent enumeration of accounts and mailboxes.
- **Plaintext custody.** Providers and apps see content. This profile is not end-to-end encrypted.

See also [security](../security.md) and the [review](../../release/messaging-app-review.md).

## 13. Conformance and status

Fixed vectors are needed before publication:

- certificate;
- envelope for each kind;
- semantic digest with a renewed certificate;
- receipt;
- invitation response;
- multicast context;
- negative vectors for the S-rules inherited from contact delivery.

An interop claim requires two independently implemented occupants on separate origins, run through the spike's failure scenarios. A local test pass does not establish interop.

| Surface | Status |
| --- | --- |
| Protocol and mailbox engine | Implemented locally in `packages/messaging-protocol/` and `packages/messaging-engine/`, including receive/send, conversations, outbox, archive and owner metadata operations. |
| Provider delegation | Local issuance/status/revocation adapters and routes exist behind `LINKS_ENABLED` (default off); `packages/runtime/routes/delegation.mjs`. |
| Published occupant and independent interop | Not established. Engine tests do not establish two independently implemented occupants or production provider conformance; see [extraction](../../architecture/messaging-extraction.md). |
