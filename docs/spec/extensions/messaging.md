# Bindle Messaging interop v1 — normative draft

> **Group:** Bindle extension
>
> **Status:** design candidate (2026-10-20); protocol validation and a local mailbox engine exist for the Parlay app; the contacts and links spike changes (invitations, first-contact gate, content refusal) are provisional, unsigned text (2026-10-28); single-use invitations and the first-contact gate are implemented locally in Parlay behind default-off flags, content refusal is not; not a published occupant, independent interop or production-verified.
>
> **Covers:** Bindle Messaging interop between people: delegation, invitations, records and call invitations. (Bridged intake, §9, was removed 2026-10-28.)
>
> **Does not cover:** the Parlay app itself (`apps/parlay`); message content rules ([message content](message-content.md)); 3sln.me app messages ([messages from connected apps](../../3sln/services/app-messages.md)).

> **Extensions revision 3 (draft, unsigned).** §2.1 is written in the [extensions revision 3](../extensions.md) shape (CR-X3-31 and contacts spike CR-X1, CR-M8; applied 2026-10-28, provisional). §9 (bridged intake) was removed 2026-10-28 with the email bridge (owner direction; revisit later). The `messaging-address` consumer is withdrawn by the [contacts and links spike](../../architecture/contacts-and-links-rethink.md) (CL-4). Where any other text here still assumes revision 2 slots, extensions revision 3.3 and protocol §2–§4 govern.

Status: **design candidate**, 2026-10-20. Protocol validation and a local mailbox engine exist in `packages/messaging-protocol/` and `packages/messaging-engine/`; provider delegation/status routing exists behind `KEY_DELEGATION_ENABLED` and the messaging-mailbox feature (default off). **Contacts and links spike applied (2026-10-28; provisional, unsigned; CR-M1 to CR-M8):** contact links, intake configuration, the links contract and the ingress descriptor are withdrawn (CL-4); an invitation is a Messaging intent (§4, CL-5); owner policy gates first contact only (§6.7, CL-6); a receiver may refuse content from an accepted peer (§6.4, CL-21). Single-use invitations and the first-contact gate are implemented locally (contacts phase 3, 2026-10-28); content refusal is not. **Contacts phase 4 (2026-10-28; provisional, unsigned):** the engine no longer accepts the withdrawn link kinds (a `BindleLink` credential is malformed), contact links and the links contract are removed from the reference host and from Parlay, and the core and Parlay data resets (`contact-links-retired-v1`, `parlay-contact-links-retired-v1`) exist locally; none of this is production-verified. **Phase 1 review fixes (2026-10-28; provisional, unsigned):** the inviter enforces the redemption shape (§4.3, §4.4); owner policy applies only after author verification, with pre-crypto budgets for credential-less first contact (§6.7, §7.4); identical redemption retries return the stored receipt (§4.4, §8.2); the inviter verifies only same-host redeemers (CL-24); the `mailbox` field is consumed by the Messaging-published messaging-mailbox feature, which gates key delegation (§2.5). These are local implementations, not a complete published occupant, independent interop or production verification. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders until publication authority is agreed. MUST/SHOULD/MAY are draft requirements.

Naming (2026-10-27, DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"): this spec is **Bindle Messaging** (the user's 2026-10-20 name; formerly "BindleBox interop", `docs/spec/bindlebox.md`). The reference messaging app is **Parlay** (owner's working name, provisional), built in this monorepo under `apps/parlay` with `packages/messaging-protocol` and `packages/messaging-engine`. Identifiers moved with the rename while nothing is published: `…/bindlebox/v1` became `…/messaging/v1`, `application/vnd.bindlebox.*` became `application/vnd.bindle.messaging.*`, and the `bindlebox-*` signing domains became `bindle-messaging-*`. The spec is published by the messaging app's side, not by the core; its fragment document is `docs/artefacts/fragments/messaging-ingress-v1.json`, the single copy the provider and Parlay both pin (extensions CR-X3-26; the former `docs/artefacts/slots/` copies are retired, and the public-intake fragment was removed 2026-10-28 with the email bridge). **Known divergence (2026-10-28, provisional):** the messaging-ingress artefact still carries the pre-spike field name `ingress` and the old description; §2.1 governs, and the artefact is corrected in the code phase. Fragments are pinned by digest, so until then the two are different fragments. The former core messaging spec (blob messaging, collections and Views) is retired to apps/parlay/docs/legacy/messaging.md (Parlay legacy record `apps/parlay/docs/legacy/messaging.md`).

Architecture and rationale: [Parlay architecture](../../architecture/messaging-app.md). Extraction: [messaging extraction](../../architecture/messaging-extraction.md). Review: [messaging app review](../../release/messaging-app-review.md). Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This profile defines peer-to-peer messaging between independent messaging apps acting for Bindle identities. It depends on the following core work:

- [protocol](../protocol.md);
- [extensions](../extensions.md);
- [message content](message-content.md);
- the core directory/identity-document profile ([organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1); implemented locally for organizations; Parlay integration is a separate dependency);
- the key-delegation extension (`https://spec.bindle.example/extensions/key-delegation/v1`; generic, [organizations AMD-O12](organizations.md), assumed), of which this document defines only the Parlay certificate profile (§3.2);
- [intents](intents.md), for the kinds of §4.

The key-delegation extension is generic: it names no Messaging fragment, field or contract (extensions §2.8 lists it under organizations; AMD-O12). This document defines the Parlay certificate profile (§3.2) and the messaging-mailbox extension (§2.5), whose provider feature gates which installation may hold the Parlay purposes. The dependency runs one way: messaging-mailbox requires key-delegation, never the reverse. Key delegation is not yet in the core specs, and its owner must accept it before publication or a conformance claim. Fragments, provider features and brokered resources follow [extensions](../extensions.md) revision 3.3 and [integrations](integrations.md).

It replaces these drafts for peer messaging:

| Draft | Reused | Removed |
| --- | --- | --- |
| contact delivery (Parlay legacy record `apps/parlay/docs/legacy/contact-delivery.md`) | Envelope, display-string rules, verification order, replay | Bearer RPC, anonymous branches |
| [links](../superseded/links.md) (dissolved) | — | Contact type, intake, links contract, ingress descriptor and conditional links (contacts spike CL-3, CL-4) |
| contact endpoints (Parlay legacy record `apps/parlay/docs/legacy/contact-tokens.md`) | — | Legacy `?sig=` and inbox bearers |
| conversations v1 (Parlay legacy record `apps/parlay/docs/legacy/conversations.md`) | — | Central authority, `actor:"bearer"` |

The [scaling spike](../../release/messaging-scaling-spike.md) P0 items are answered in architecture §18.

## 1. Terms and identifiers

- **Principal**: a Bindle identity `(iss, sub)`, where `iss` is the provider origin and `sub` is the stable account UUID.
- **Occupant**: the recipient's mailbox resource, assigned to the owner's messaging-ingress `mailbox` field (§2.1) and supplied by a messaging app.
- **Ingress**: the occupant's public HTTPS delivery URL.
- **Delegate key**: an app-held P-256 key certified for a principal (§3).
- **Obligation**: a sender's durable duty to deliver one envelope to one recipient.

| Identifier | Value |
| --- | --- |
| Profile | `https://spec.bindle.example/messaging/v1` |
| Messaging-ingress fragment | `https://spec.bindle.example/fragments/messaging-ingress/v1` |
| Messaging-mailbox extension | `https://spec.bindle.example/extensions/messaging-mailbox/v1` |
| Mailbox contract | `https://spec.bindle.example/messaging/v1/contracts/mailbox` |
| Invitation intent kind | `https://spec.bindle.example/messaging/v1/intents/connect` |
| Invitation credential scheme | `BindleInvite` |
| Author purpose | `https://spec.bindle.example/messaging/v1/purposes/author` |
| Receipt purpose | `https://spec.bindle.example/messaging/v1/purposes/receipt` |
| Archive purpose | `https://spec.bindle.example/messaging/v1/purposes/archive` |

## 2. Fragment, mailbox contract and fetch rules

### 2.1 Messaging-ingress fragment

This is a fragment under [protocol §3](../protocol.md#3-fragments-and-preference-values) (extensions revision 3.3; contacts spike CR-X1, provisional). It replaces the revision 2 messaging-ingress slot.

```json
{
  "id": "https://spec.bindle.example/fragments/messaging-ingress/v1",
  "title": "Receives messages",
  "description": "The one app that receives Bindle messages for you.",
  "publisher": "https://spec.bindle.example",
  "fields": {
    "mailbox": {
      "title": "Messaging app",
      "type": "resource",
      "cardinality": {"min": 0, "max": 1},
      "contracts": ["https://spec.bindle.example/messaging/v1/contracts/mailbox"],
      "selection": "exclusive",
      "consumers": ["provider"],
      "announce": true
    }
  }
}
```

Only the owner assigns the field (protocol §3). Its only consumer is the provider feature of the messaging-mailbox extension (§2.5). Other apps never obtain a credential for the mailbox contract (review P-17). The field is named `mailbox`, not `ingress`, because "ingress" is the occupant's delivery URL (§1). `announce: true` lets the provider tell the owner, under the [extensions §6](../extensions.md#6-announcements-announce) floor, that a newly connected messaging app can fill the field; it applies only while the messaging-mailbox feature is enabled. A messaging app lists the mailbox contract in its integration manifest's `resources.contracts`. It declares nothing else for this fragment.

### 2.2 Mailbox contract (provider to occupant)

Only the messaging-mailbox feature (§2.5) invokes the mailbox resource, over ordinary resource RPC ([protocol §5](../protocol.md#5-rpc-transport)) with its brokered consumer credential.

| Method | Args | Result |
| --- | --- | --- |
| `describe` | `{}` | `{version: 1, ingress}` |

- `ingress`: an absolute HTTPS URL on the occupant's origin, with no userinfo, query or fragment. It SHOULD be the same for every mailbox the instance hosts. The instance routes by the signed `payload.recipient` and the credential, so the URL does not identify the user (review S-8).

`describe` is declared `"effect": "read"` and MUST be side-effect free. The provider MUST validate the result (exact members) before using it, treats an invalid result as "no occupant", and records `ingress` as the `client.ingress` of the occupant's delegation certificates (§3.2). The result carries nothing else because the provider uses nothing else (contacts spike CR-M3, review L12).

**Binding parameters.** An occupant states its own parameters to peers only inside signed bindings (`creatorBinding` §6.1, `binding` §6.2 and §6.3):

- `profiles`: a nonempty array of supported profile identifiers, including `…/messaging/v1`.
- `multicast`: optional, an absolute HTTPS URL on the origin of `ingress` (§7.3).
- `limits`: `{maxParticipants, maxMessageBytes, maxEnvelopeBytes, maxBatchContexts?}`, each a positive safe integer no larger than the §11 maxima.

### 2.3 Reaching a person and fetch rules

There is no public lookup from a handle or principal to an ingress (contacts spike CL-4). This answers the open question in extensibility design §10.1.

- A sender reaches a person only through an invitation (§4), whose delegation certificate names the inviter's ingress, or through an established conversation, whose bindings arrive signed by the peer.
- A peer whose stored ingress fails with 404, 410 or `ingress_moved` waits for the new occupant's `ingress` or `rejoin` record (§6.3, §6.6), which the new occupant sends to every conversation peer when an import completes.
- No enumeration surface is added to core.

Host-wide fetch rules apply to invitation redemptions, ingress POSTs, delegation status lookups and directory lookups. Senders MUST use HTTPS (loopback only in explicit development), MUST NOT follow redirects, MUST screen private, loopback and link-local addresses at connect time, and MUST bound connect, response size and total time.

### 2.4 Integration events and identity keys

This section reconciles with [integrations](integrations.md) §5–§6.

- **Credentials.** Provider consumers reach the occupant through the brokered consumer credential (integrations §5.3).
- **Events.** The occupant receives the SET events of integrations §6.2 at its `events_endpoint`. It interprets them as follows:
  - `connection-revoked` or `credential-revoked` covering the mailbox grant: the occupant has been removed or severed. It stops admitting traffic for that owner and stops renewing its delegation.
  - `resource-detached` for the mailbox: the same.
  - `preferences-updated`: storage or classifier changes.

  Each SET is signed and verified as integrations §6.1 requires (review S-16).
- **No identity-key events.** Integrations defines no identity-key-rotation event. The occupant therefore resolves its owner's identity key through the directory, exactly as for any other principal (§3.3).
- **Requested for later.** A proposed `identity-key-rotated` event would make this update faster. They have been requested from the integrations owner, but nothing here depends on them.

### 2.5 Messaging-mailbox extension (provider feature)

Provisional (coordinator), unsigned, 2026-10-28 (contacts spike CR-X1; review M5). Bindle Messaging publishes the extension `https://spec.bindle.example/extensions/messaging-mailbox/v1`. Its descriptor is `{"id": "https://spec.bindle.example/extensions/messaging-mailbox/v1", "title": "Messaging app keys", "description": "Lets the messaging app you choose send and receive Bindle messages as you.", "options": {}}`. Its prerequisite is the key-delegation extension (`…/extensions/key-delegation/v1`), checked as [extensions §2.5](../extensions.md#25-processing-and-bounds) says. A provider that declares it always offers its feature.

Its provider feature follows [extensions §4.2](../extensions.md#42-provider-features) (revision 3.3):

1. **Request.** It requests the messaging-ingress fragment, pinned as in extensions §4.1, with field `mailbox` and methods `{"https://spec.bindle.example/messaging/v1/contracts/mailbox": ["describe"]}`, the descriptor text as its purpose, and no `required`.
2. **Enablement.** Only an explicit owner action in the provider's authenticated interface, with recent owner authentication, enables it. That action is the consent for the request. If the field is empty, the owner may choose its value on the same screen (extensions §3.4, §5.3). It is never offered inside an application's or integration's authorization flow. The feature is listed among the field's consumers wherever the owner sees them.
3. **Use.** While enabled and not suspended, it calls `describe` (§2.2) on the assigned resource, with `client_id` = issuer and `bindle.feature` = the spec URL, on enablement and on every value change, and records the validated `ingress`.
4. **Gate.** Key delegation certifies the Parlay author, receipt and archive purposes only through this feature (§3.2, occupant check). While the feature is not enabled, is suspended, or the field is empty, no certificate carrying these purposes is issued or renewed. Disabling the feature, revoking its grant or changing the field's value revokes every `jkt` carrying these purposes.

**Purpose consent is separate.** Enabling the feature lets the provider read the field and call `describe`; it authorizes no installation to sign. An installation receives the Parlay purposes only when it also holds the owner's explicit purpose consent (§3.2). A provider MAY collect both in one screen of its authenticated interface, with recent authentication, but each remains its own explicit choice.

## 3. Principals and delegate keys

### 3.1 Author descriptor

`author` is `{principal:{issuer, subject, identityURI}, identityDocument, keyId, delegate}`:

- `keyId` is the principal's identity signing key, exactly as the directory publishes it;
- `delegate` is `"jkt:"` followed by the RFC 7638 SHA-256 thumbprint (canonical unpadded base64url) of the delegate public key.

`identityURI` and `identityDocument` MUST have `issuer` as their origin. Naming is as in contact delivery S13 and stays provisional.

### 3.2 Delegation certificate (key-delegation extension, assumed)

A provider declaring the key-delegation extension (`{"spec": "https://spec.bindle.example/extensions/key-delegation/v1", "options": …}`, options as in [organizations §14](organizations.md)) and the messaging-mailbox extension (§2.5) issues Parlay certificates to an app installation only after explicit owner consent naming the purposes. A certificate is a compact JWS. Its protected header is exactly `{alg:"ES256", kid:<identity keyId>, typ:"bindle-key-delegation+jwt"}`. Its payload contains exactly:

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

- **Occupant check** (contacts spike CR-X1, provisional). A provider MUST certify the Parlay author, receipt and archive purposes only while the messaging-mailbox feature is enabled and not suspended (§2.5), only to the installation that supplies the resource currently assigned to the owner's messaging-ingress `mailbox` field (§2.1) and holds the owner's purpose consent, and MUST set `client.ingress` for it from the `ingress` that feature recorded (§2.2). At most one installation per principal holds these purposes at any time.
- Certifying a new `jkt` for a principal MUST revoke every earlier `jkt` carrying these purposes. This applies to a new key in the same installation and to a new occupant. Renewing a certificate for the same `jkt` revokes nothing. An occupant therefore SHOULD keep its delegate key for the life of its occupancy and rotate it only on suspected compromise, because a rotation kills every invitation that embeds a certificate for the old `jkt` (§4.1), including public links without expiry.
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

Until the directory profile exists, a receiver can resolve only principals whose provider exposes a directory to it. All other principals are refused with `author_unverifiable` (401), and no network fetch is attempted. Invitation handling is narrower still: in this version both the handler (§4.2) and the inviter (§4.4) verify only same-host principals (CL-24).

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

## 4. Invitations

Provisional (coordinator), not signed off; applied 2026-10-28 from the [contacts and links spike](../../architecture/contacts-and-links-rethink.md) §4.3 (CL-5, CL-19, CL-20, CL-21, CL-24; CR-M2). This section replaces the contact link type, which is withdrawn (CL-4). Hosts are placeholders under `.example`. **Status (2026-10-28, provisional, unsigned):** single-use invitations (§4.1–§4.5) are implemented locally in Parlay behind default-off flags (contacts phase 3); public and multi-use invitations are not (phase 5). This is a local implementation, not independent interop or production verification.

**Scope.** This specification defines only the invitation intent's data (§4.1), the handler's duties (§4.2), the redemption message (§4.3), the inviter's processing order (§4.4) and the results (§4.5). How many people may redeem an invitation, expiry policy, templates, admission rules, contact lists and their relationship policies, tags, safeguards and labels are **application behaviour**: each messaging app decides them for its owner, and none of them appears on the wire. In particular the wire carries neither a use count nor a direction.

### 4.1 The `connect` intent kind

Bindle Messaging publishes the [intent kind](intents.md#4-intent-kinds) `https://spec.bindle.example/messaging/v1/intents/connect`: `effect` `send`; disclosure categories `personal-data` and `send-as-you` (the redeemer reveals itself and sends as itself); `capability: true`, so the intent travels in the URL fragment ([intents §3.4](intents.md#34-placement-in-a-url)). Its data:

| Member | Field | Display |
| --- | --- | --- |
| `inviter` | principal, required | `value` (the `iss` host; a handle only if the provider already holds a verified binding) |
| `token` | string, required, `format: capability`, 22–43 base64url characters (at least 128 random bits) | `presence` |
| `delegation` | string, required, at most 2,048 characters: the inviter's current delegation certificate (§3.2), compact JWS | `presence` |
| `expires_at` | integer, optional, Unix seconds (absent: the issuer sets no expiry) | `value` |
| `hint` | enum `no-reply`, optional | `value`, labelled "The inviter says you won't be able to reply". Display only; no protocol effect |

The certificate makes an invitation link about 2 KB, within [intents §3.5](intents.md#35-size-bounds). That is the cost of verifying the inviter's ingress without a lookup service. **Disclosure:** anyone who holds the link can read the certificate's `client_id`, `origin`, `cnx` and `since`, so a public link discloses which app installation serves the inviter and since when. An invitation lives only as long as that `jkt` (§3.2): a delegate-key rotation or an app switch ends every invitation issued under it, whatever its `expires_at`.

### 4.2 Handler duties

A handler of `connect`, in this order:

1. Validates the data shape and `expires_at` locally. Nothing is fetched on open or prefetch. Fetches start only after the provider-level consent ([intents §7](intents.md#7-consent-choice-and-memory)), which is a viewer action.
2. Resolves the inviter's identity key through the directory, with pinned continuity, and verifies the `delegation` signature, `typ` and `bindle`, that `iss`/`sub` equal `inviter`, and that `purposes` includes the author purpose. It checks the status of `jkt` (§3.4) and requires `active`. It does not check certificate expiry, because certificates last at most 24 hours and invitations longer. A new delegate key or an app switch revokes the `jkt` (§3.2), so the invitation dies with the inviter's old app. In this version only same-host inviters are verifiable; a foreign inviter fails as in §3.3, without a fetch (CL-24).
3. Takes the redemption target from the certificate's `client.ingress`. There is no ingress data member to forge. The redemption follows the §2.3 fetch rules.
4. Shows the inviter ("Allow alice@a.example to message you?"), with the labelled hint when present. The handle shown is the one bound to `inviter` in the directory identity document resolved in step 2; without such a binding, the `iss` host is shown. Only on the viewer's confirmation does its app admit the inviter to message the viewer; how it records that is application behaviour. **Nothing is sent to any party before steps 2 to 4 succeed.**
5. Sends the redemption (§4.3). It keeps at most one pending redemption per token digest per account, and retries with identical bytes.
6. **Rollback.** It removes the admission only if this flow created it, no conversation with the inviter exists, and either a terminal error arrived or `returnControl.expiresAt` passed without an `accept`.

For a foreign inviter, once enabled, the inviter's provider learns when the viewer consented and which provider fetched.

### 4.3 Redemption message

A redemption is a `conversation-init` (§6.1) signed by the redeemer's delegate key, under the base profile `…/messaging/v1`, with exactly this shape:

- `payload.recipient` is `{issuer, owner, invite}`, where `invite` is the canonical unpadded base64url of SHA-256 over the token's ASCII bytes (§5.1);
- the request carries `Authorization: BindleInvite <token>` (§7.1), on a single delivery only (§7.3);
- the envelope `subject` is `""` and `content` is `null`, and the request has no `message` part;
- its genesis lists **exactly two participants**, the redeemer (the author) and the inviter (`recipient`), with `subject` `""` and `content` `null`.

Its invitation response is never `acceptListed: true` (§6.2). The inviter's binding and limits arrive in its invitation response. Only `conversation-init` carries `invite` or `BindleInvite`; a `one-off` never does (§5.1, §7.1).

### 4.4 Inviter processing order

The inviter's occupant runs the cheap checks first and stops at the first failure:

1. Pre-crypto budgets: per-source and per-invitation rate limits, size and framing (§7.1).
2. **Shape.** A request carrying `BindleInvite` or `recipient.invite` that breaks §4.3, or that carries only one of the two, is `malformed`.
3. A read-only lookup of the token digest. It is `invite_invalid` unless SHA-256 of the `Authorization` token equals `recipient.invite`, the token's indexed owner (§7.4) equals `recipient.owner`, and the token is live: known, not cancelled, not expired, and either not exhausted or already redeemed by the claimed author. A token bound to a different principal than the claimed author is also `invite_invalid`.
4. Author verification (§3.3) with the status check (§3.4). In this version the inviter verifies only same-host authors; any other author is `author_unverifiable` (401) without a fetch (CL-24).
5. **Replay.** If a redemption by the verified author is already recorded under `(owner, token digest, author principal)` (§8.2), the request is answered from that record and nothing is counted: identical `payloadDigest` returns the stored receipt; a different one is `invite_invalid`. This holds while the token is neither cancelled nor expired. Once it is, a recorded redeemer's replay is `invite_invalid` at step 3, like any other request with that token. (Amended 2026-10-28; provisional, unsigned, coordinator decision. The edge index keeps no redeemers for a dead token, and answering such replays would weaken cancellation. A redeemer whose response was lost retries before the token expires.)
6. In one transaction: re-check that the token is live, record the redemption and count the use. A token that became unusable since step 3 (a lost spend race, a cancellation or expiry) is `invite_invalid`. This result follows verification, so its timing differs from step 3's; it reveals only that the token was live moments earlier, which the requester already knew.
7. Hand the redemption to the owner's admission decision, which is application behaviour.

Steps 5 and 6 run in one transaction, so concurrent identical retries record one redemption and each gets the same stored receipt. Passing an exhausted token to verification when the claimed author is a recorded redeemer lets a holder of that token learn whether a named principal redeemed it; this is accepted, because only the token's holders learn it and it keeps retries safe (review M1).

### 4.5 Results

- `malformed` (400) for step 2.
- `invite_invalid` (401) for step 3, including a bound-principal mismatch, with one body and one timing class; and for steps 5 and 6 as stated there.
- `rate_limited` (429) for budgets. A per-invitation 429 reveals liveness only to someone who already holds the token.
- `author_unverifiable` and `too_large` as in §8.3.
- Otherwise the ordinary receipt (§8.1). The outcome is then either an ordinary invitation response `accept` (§6.2), or **no response**, which lapses at `returnControl.expiresAt` exactly as an unanswered first contact does (§6.7). Held, ignored and refused redemptions are indistinguishable, and a refused redemption gets no response.

**No direction on the wire** (CL-21). The redeemer admits the inviter to send to it. Whether the redeemer may send back is decided and enforced by the inviter's app under content refusal (§6.4). A redeemer app that offers compose anyway gets `not_authorized`, at the cost of one refused round trip. `hint` only sets expectations: the inviter derives it at mint time, so it can become stale, which is why it is shown as the inviter's claim. **Unsubscribing** is local and immediate: the redeemer removes or blocks the inviter (§6.5), and sends the courtesy `leave` record (§6.3).

### 4.6 Published intent kinds

Bindle Messaging will publish these intent kind lines (CR-M7; moved from intents §11, contacts spike CL-11). Their bodies are drafts. Each line below is the artefact id of the kind document the repository publishes and pins (`docs/artefacts/intents/connect-v1.json`, `docs/artefacts/intents/open-conversation-v1.json`).

**Identifier note (2026-10-28, provisional, unsigned).** `open-conversation` keeps the identifier it was first published under, `https://spec.bindle.example/intents/open-conversation/v1`, from before Messaging took over the kind lines. An earlier draft of this table named `…/messaging/v1/intents/open-conversation`, which no artefact carries. Renaming the line would change its digest and every handler pin, so the published id stays as is while nothing is published. A rename to the `…/messaging/v1/intents/` pattern before publication would be a new line, not a new version of this one.

| Line | `effect` | `capability` | Data |
| --- | --- | --- | --- |
| `https://spec.bindle.example/messaging/v1/intents/connect` | `send` | `true` | §4.1 |
| `https://spec.bindle.example/intents/open-conversation/v1` | `view` | `false` | `conversation` (required, `uuid`, `presence`), `creator` (required, principal, `value`), `profile` (required, `https-url`, `origin`) |

**Reserved names.** `…/messaging/v1/intents/send-message` and `…/messaging/v1/intents/add-contact` are reserved, not defined: their former data carried a contact link, which is withdrawn (CL-4). Neither is published, and no handler may declare either, until a later revision defines its data. `add-contact` may instead be dropped in favour of `connect`.

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
| `recipient` | For first-contact kinds (`one-off`, `conversation-init`): `{issuer, owner}`, the recipient principal. A `conversation-init` that is an invitation redemption adds `invite` (§4.3; contacts spike CR-M4); a `one-off` carrying `invite` is `malformed`. For `conversation-record`: `{issuer, owner, conversationId, incarnation}`, the recipient principal and its admission incarnation for this author. |
| `content` | `{mimeType, byteLength, sha256}` of the exact body, or `null` for control records without a body |
| `subject` | Plain text, at most 200 code points |
| `author` | §3.1 |
| `conversation` | Required for `conversation-init` (§6.1). Absent otherwise. |
| `record` | Required for `conversation-record` (§6.3). Absent otherwise. |
| `resendOf` | Optional. The event ID (records) or `operationId` (first-contact kinds) of an earlier envelope that this one re-sends with identical content. Receivers that hold the original show it once, marked "resent". |

The former `optionalTags` member is removed with the intake allowlist it drew from (contacts spike CL-4; review L7), so an envelope carrying it fails the exact member set.

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
- the creator's own `profiles`, `limits` and `multicast` (§2.2).

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

**Content refusal by owner policy** (contacts spike CL-21, CR-M6; provisional, unsigned). A receiver MAY refuse content records (`message`, `edit`, `retract`, `peer-proposal`, `peer-response`, `rotate`) from an accepted peer under owner policy, with the uniform `not_authorized` (403) and no other signal. It MUST keep accepting the binding records `leave`, `ingress`, `rejoin`, `secret-share` and `peer-hello` from that peer, MUST keep returning receipts for the records it accepts, and MUST keep accepting invitation responses (§6.2), so that bindings and unsubscribing keep working. A policy change needs no protocol message. A sender that knows of a rotation cannot tell content refusal from rotation lag, so it retries until the obligation deadline (§6.5); that costs refused requests only and reveals nothing more.

### 6.5 Consent, block, rotation and late events

- **Block.** A local block or removal immediately invalidates the author's incarnation. Records from that original author are refused, even when forwarded by others.
- **Re-acceptance** issues a new incarnation, through a `peer-hello` or by re-invitation. Records bound to an old incarnation are refused with `incarnation_stale` (409).
- **Rotation overlap.** After an owner accepts a rotation, the previous epoch remains accepted for 7 days. A sender that receives `not_authorized` for a record after a rotation it knows of treats the obligation as `retry_scheduled` with reason `epoch` until the deadline. It never treats it as terminal (review P-6).
- **Late events.** A valid signature never overrides a newer local block.
- **Equivocation.** Two different events with the same `(author, conversationId, stream, counter)` are equivocation. The receiver keeps both as evidence, quarantines the later one, and stops accepting that stream until the owner acts. Other streams of the same author are unaffected.
- **Rotation conflicts (provisional, 2026-10-23).** Pending rotations are keyed by `(epoch, proposer)`. Two proposals of one epoch with different secret digests are a conflict the owner sees; accepting needs the owner to name the proposer, and an epoch already selected never takes a second secret; a late differing proposal records a secret conflict naming its proposer, which the owner can dismiss.
- **Group bound.** `maxParticipants` bounds each owner's accepted-peer set for a conversation. An occupant refuses to accept a peer beyond it. Senders pre-check binding limits at compose time, and the UI shows "some participants can't see messages from everyone" when bindings show that limits differ (review P-12).

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

### 6.7 First-contact gate and unobservable filtering

Rewritten 2026-10-28 (contacts spike CL-6, CR-M5; provisional, unsigned).

**Gate.** Owner policy gates **first contact only**: `conversation-init` (including invitation redemptions) and `one-off`. A receiver processes first contact in this order and stops at the first failure:

1. Framing, size and the pre-crypto budgets of §7.4.
2. **Not hosted here.** A `recipient` this instance does not host, or whose owner has no current occupant, gets `recipient_unavailable` (503, `Retry-After`), with one body and one timing class for both cases.
3. For an invitation redemption, §4.4 steps 2 and 3.
4. Author verification (§3.3) with the status check (§3.4); for a redemption, §4.4 steps 4 to 6.
5. **Owner policy**, on the verified principal only. First contact from an author whom owner policy does not admit, or whom the owner has blocked, is refused before custody with the uniform `not_authorized` (403), unless it is a valid invitation redemption (§4.3, having passed §4.4). Policy refusal and block share one body and one timing class.

**No refusal before step 5 depends on owner policy**, lists, blocks or invitation admission rules, so a request claiming an admitted author and one claiming a non-admitted author get identical results until the author is verified. Which authors owner policy admits, holds or refuses is application behaviour. A first contact that policy holds for the owner is accepted into custody, and if unanswered it lapses as below. The ingress URL is not a secret and gates nothing.

**What the gate does not cover.** Records, `peer-hello` and `rejoin` stay gated only by the per-conversation accepted-peer set and pair tokens (§6.3 to §6.6), so groups that include people outside the owner's policy, and rejoin, keep working.

**After custody.** A receiver MAY filter, deprioritize or auto-reject admitted first contact under owner policy, including classifier-based rules ([architecture §12.1](../../architecture/messaging-app.md#121-public-request-filtering-and-auto-rejection)). A receiver:

- MUST still return the ordinary receipt for admitted first contact;
- MUST NOT return any error code, header, receipt member, timing class or reply that depends on classification, score, rule, list or policy state, beyond the pre-custody refusal above;
- for a held, ignored or auto-rejected `conversation-init`, MUST send no invitation response. It lapses at `returnControl.expiresAt`, which is indistinguishable from an owner who did not answer.

Other refusals before custody (credential, rate limit, size, author) use the ordinary §8.3 codes and never depend on content classification or owner policy. The user decision of 2026-10-14 "no anonymous link messages" applies, and its scope is provisionally widened to all Bindle first contact (contacts spike CL-17, unsigned): every first contact is authored (§3.3).

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
| `BindleInvite` | Invitation redemptions (§4.3), which are always `conversation-init`. A `one-off` carrying it is `malformed`. |
| `BindleConversation` | Records |
| None | Other first contact (§6.7), and `rejoin` (§6.6) |

Cookies are not sent. An optional `Idempotency-Key` header MUST equal `operationId`.

### 7.2 Success

The success response is 200 `{receipt}` (§8.1).

### 7.3 Multicast (optional)

Multicast is available when a binding names `multicast` on the same origin as its `ingress`. A sender MAY combine deliveries of **one identical body** to recipients whose own verified bindings name that same URL. It POSTs to `{multicast}` with `multipart/form-data`:

- a `batch` part: `{version:1, batchId (UUID), content, contexts:[{credential:{scheme:"BindleConversation", value}, envelope}]}`. Redemptions carry no body and travel only by single delivery (§4.3), so `BindleInvite` never appears in a batch;
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

### 7.4 Edge credential index and first-contact budgets

An instance MUST be able to refuse a bad credential without waking the target mailbox. Each mailbox therefore publishes, transactionally with every change, entries into an instance-wide edge index:

| Credential | Index entry |
| --- | --- |
| Invitations | `{token digest → owner, state, redeemers}`, where `redeemers` lists `H(author principal)` for each recorded redemption of an exhausted token (empty otherwise), so an identical retry by a redeemer reaches §4.4 step 5 |
| Conversations | `{H(conversationId, author principal, recipient owner) → SHA-256(expected pairToken), accepted epochs, incarnation}` |

The edge checks the presented credential against the index first. Only matching requests reach the mailbox. Index entries contain no secrets and no plaintext pair tokens.

**Credential-less first contact** (review H2, provisional) has no index entry. Before waking a mailbox or starting any directory or status fetch, the edge MUST:

- charge it against a per-source budget and a per-`recipient.owner` budget, keyed by the claimed owner whether or not it is hosted, so that a `rate_limited` (429) reveals nothing about hosting;
- refuse a `recipient` that is not hosted here as §6.7 step 2 says, without waking any mailbox;
- bound author-verification fetches per author issuer and globally, cache their results, including failures, for at least the §3.4 status-cache time, and start at most one directory fetch and one status fetch per request.

Redemptions are charged against the same per-source and per-owner budgets.

An edge SHOULD also keep a refusal budget per (claimed `recipient.owner`, author issuer host), checked before the other budgets and the hosted lookup and charged only by a `not_authorized` returned after author verification (provisional, unsigned, 2026-10-28). A full budget stops only that host's senders to that owner for one window, which never exceeds what the per-owner budget already allows. Redemptions are exempt. An edge MUST NOT keep a refusal budget keyed by issuer host alone or by site, because Sybil principals on a large issuer could then lock that issuer's users out of a recipient.

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
| First-contact kinds | `(recipient owner, author principal, operationId)` | `createdAt` within 24 h in the past and 60 s in the future |
| Invitation redemptions, additionally | `(owner, token digest, author principal)` (§4.4 step 5) | While the issuer keeps the invitation's record and the token is neither cancelled nor expired (§4.4 steps 3 and 5) |
| Records | `(recipient owner, conversationId, author principal, stream, counter)`, together with `eventId` | 7 days |

For records, the receiver keeps per-stream frontiers (the highest contiguous counter) plus bounded gap exceptions (§6.3). A bare highest-seen counter is not sufficient.

Retention and restore:

- Receipts and fences are kept for 9 days and are exported (§10).
- Retraction and erase anti-resurrection state is kept for the life of the conversation.
- Both are restored, with control generations, before any traffic is admitted after an import or restore.
- After a restore, an envelope whose `createdAt` predates the restored checkpoint is admitted only if it appears in the imported replay set (review S-9).

In the first-contact and record namespaces, the same key with a different `payloadDigest` is `operation_conflict` (409). In the redemption namespace a different `payloadDigest` is `invite_invalid` (§4.4 step 5), so a redeemer never receives a receipt for another envelope. An identical replay returns the stored receipt without another charge, write or notification, after live authorization has been rechecked; for a redemption, the recorded redemption is that authorization while the token is neither cancelled nor expired, and afterwards a replay is `invite_invalid` (§4.4 step 3; amended 2026-10-28, provisional, unsigned). A returned receipt always matches the request's `operationId`, `payloadDigest` and `eventId`, so it passes §8.1.

### 8.3 Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `malformed` | 400 | Framing or schema |
| `envelope_expired` | 400 | `createdAt` outside the acceptance window |
| `counter_gap` | 400 | Counter jump above §6.3's bound |
| `clock_skew` | 400 | Future-dated beyond 60 s. Carries `serverTime`. |
| `invite_invalid` | 401 | Invitation token unknown, cancelled, expired, exhausted, not matching `recipient`, bound to another principal, or already redeemed by this author with a different envelope (§4.4, §4.5) |
| `author_unverifiable` | 401 or 503 | Author cannot be verified now. 503 is retryable. |
| `author_required` | 403 | No author |
| `not_authorized` | 403 | Uniform first-contact gate after author verification (§6.7), conversation gate, content refusal (§6.4) or host refusal |
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
| `recipient_unavailable` | 503 | Recipient not hosted here, or no current occupant (§6.7 step 2). `Retry-After` set. |
| `recipient_storage_unavailable` | 503 | Storage resource unavailable. `Retry-After` set. |

Bodies are `{error, message}` with a fixed, safe message. Responses are no-store and no-referrer, CORS is credentialless, and redirects are never issued.

Sender classification:

- 429, every 503, timeouts and resets are retryable until the deadline.
- 401/403 allow one repair (renew), except as §6.5 says for rotation. `invite_invalid` and `not_authorized` on first contact are terminal.
- 404, 410 and `ingress_moved` are terminal for first contact (an invitation dies with its inviter's old app, §4.2). For a conversation peer they become `retry_scheduled` with reason `moved`, awaiting that peer's `ingress` or `rejoin` record until the deadline.
- 400, 409, 413 and 415 are terminal.

## 9. Bridged and public intake (removed)

Removed 2026-10-28 (owner direction, DEVLOG "Owner direction: strike the email bridge for now"; revisit later). The public-intake fragment and contract, the `deliver` method, intake provenance and the 3sln.me email-bridge provider callbacks are withdrawn, and nothing here is implemented. The section number is kept so references stay stable. Native first contact is §6.7.

## 10. Portable archive

To keep history portable, the occupant writes to the owner's `object-storage/v1` resource under `parlay/v1/`.

**Manifest.** `manifest.json` is a compact JWS (`typ` `bindle-messaging-archive+jwt`) signed by the occupant's delegate key under an archive purpose `…/purposes/archive` (review S-15). Its payload is `{version:1, generation, writer:{client_id, cnx}, leaseUntil, segments:[{name, sha256, firstAt, lastAt}], controlGeneration}`. It is advanced by compare-and-swap.

- An importer MUST verify the manifest and segment hashes, and verify retained envelope proofs where present.
- An importer MUST take over the writer lease by writing a new generation naming itself. A previous writer whose lease has been taken MUST stop writing (review P-4).

**Segments** are immutable JSON-lines files of records, each `{type, …}`, where `type` is one of:

`item`, `body-ref`, `peer` (binding, incarnations both ways, accepted epochs), `stream-head` (own author streams per conversation), `frontier`, `gap`, `tombstone`, `pending-mutation`, `block`, `replay` (receipts and fences within the windows), `outbox` (unresolved obligations with their exact envelopes), `quota` (per-day counters), `invitation` (issued invitation records: token digest, state, expiry and redemption ledger, never the token), `view`, `rule`, `tag-label`, `overlay`.

Bodies are stored at `bodies/<sha256>`.

**Not exported until segment encryption exists:**

- conversation secrets;
- invitation tokens;
- delegate private keys, which are never exported.

The new occupant regains secrets through `rejoin` (§6.6) and generates its own key. Invitations issued under the previous occupant die with its revoked `jkt` (§4.2).

**Import order:**

1. control state: blocks, tombstones, pending mutations, frontiers, replay;
2. peers and stream heads;
3. outbox. The previous occupant's delegate key is revoked, so imported unresolved obligations are re-signed by the new key as new events carrying `resendOf`. Recipients that already hold the original show the copy once, marked "resent";
4. items.

During import the occupant admits only records and first-contact deliveries whose replay and control state are already restored. Others get `recipient_storage_unavailable` with a short `Retry-After`. Senders' one-off deadlines are 23 h, so imports that may run longer SHOULD restore control state first (it is small) and then admit traffic while items stream in.

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
| Clock skew | 60 s |
| First-contact window | 24 h |
| Record window | 7 days |
| Rotation overlap | 7 days |
| Receipt and fence retention | 9 days |

## 12. Security considerations

- **Credentials and authorship are independent.** An invitation token, owner policy (§6.7) or a conversation secret admits a delivery. The author proof names who is speaking. Neither one substitutes for the other.
- **Delegate key compromise** allows signing as the principal for Parlay purposes only, until revocation plus the remaining certificate lifetime (§3.2). The status check on first contact and peer admission bounds the most valuable cases.
- **Expanded work.** Multicast, invitations and proposals are charged as the equivalent individual work (§7.3). No receiver fans out on behalf of a sender, and no receiver fetches recursively.
- **Enumeration resistance.** Uniform `invite_invalid`, `not_authorized` and `recipient_unavailable` responses prevent enumeration of accounts and mailboxes. Owner policy is applied only after author verification (§6.7), so a forged claim of an admitted author learns nothing about the owner's lists.
- **Unauthenticated cost.** First contact needs no credential. The pre-crypto budgets and fetch bounds of §7.4 keep each such request to at most one directory fetch and one status fetch, and keep unknown recipients from waking any mailbox.
- **Public invitations.** A public `connect` link discloses the inviter's installation metadata in its certificate (§4.1) and admits only a content-free redemption (§4.3), never a message.
- **Plaintext custody.** Providers and apps see content. This profile is not end-to-end encrypted.

See also [security](../security.md) and the [review](../../release/messaging-app-review.md).

## 13. Conformance and status

Fixed vectors are needed before publication:

- certificate;
- envelope for each kind;
- semantic digest with a renewed certificate;
- receipt;
- invitation response;
- invitation redemption: accepted, `invite_invalid` for each token failure with one timing class, replay by the same principal, and a bound token used by another principal;
- redemption shape: `malformed` for a redemption with a subject, a body, a `message` part, a third participant or `invite` without `BindleInvite` (or the reverse), and for a `one-off` carrying `invite` or `BindleInvite`;
- redemption binding: `invite_invalid` for a token whose digest differs from `recipient.invite` and for a token indexed to another owner;
- redemption retry: after a lost response, an identical retry of a redemption that exhausted a single-use token returns the stored receipt; a second redemption by the same author with a different envelope is `invite_invalid`; concurrent identical retries record one redemption; a lost spend race is `invite_invalid`; an identical retry by a recorded redeemer after the token is cancelled or expired is `invite_invalid` (§4.4 step 5);
- redemption gate order (provisional, 2026-10-28; recorded so that a second implementation can match): a request whose envelope breaks the envelope schema, including the parts of the §4.3 shape the schema checks, is `malformed` at framing (§7.1), before any budget, hosted-index or token lookup; the acceptance window (§8.2) is checked after the token checks of §4.4 step 3 and before author verification, so a redemption outside the window is `invite_invalid` when its token fails step 3 and `envelope_expired` otherwise;
- a foreign redeemer gets `author_unverifiable` (401) with no fetch;
- first-contact gate refusal and content refusal (`not_authorized`), with `leave` and `peer-hello` still accepted;
- gate position: a bogus proof claiming an admitted author and one claiming a non-admitted author get identical results; an unknown recipient and a recipient without occupant get one `recipient_unavailable`; no owner-policy result before verification;
- first-contact budgets: per-source and per-owner 429 identical for hosted and unhosted owners; an unknown recipient wakes no mailbox; at most one directory and one status fetch per request;
- multicast context;
- negative vectors for the S-rules inherited from contact delivery.

An interop claim requires two independently implemented occupants on separate origins, run through the spike's failure scenarios. A local test pass does not establish interop.

| Surface | Status |
| --- | --- |
| Protocol and mailbox engine | Implemented locally in `packages/messaging-protocol/` and `packages/messaging-engine/`, including receive/send, conversations, outbox, archive and owner metadata operations. |
| Provider delegation | Local issuance/status/revocation adapters and routes exist behind `KEY_DELEGATION_ENABLED` and the messaging-mailbox feature (default off); `packages/runtime/routes/delegation.mjs`. |
| Invitations (§4), first-contact gate (§6.7) | Single-use invitations and the gate implemented locally in Parlay behind default-off flags (contacts phase 3); public and multi-use links are phase 5. |
| Content refusal (§6.4) | Not implemented (contacts phase 5); until then invitations may not target a `receive-only` list. |
| Contact links (withdrawn, CL-4) | Removed locally (contacts phase 4, 2026-10-28; provisional, unsigned). The engine refuses `BindleLink` as malformed, and the link path, links contract and ingress descriptor are gone from the reference host and Parlay. The core reset `contact-links-retired-v1` and the Parlay reset `parlay-contact-links-retired-v1` delete the retired data locally. |
| Bridged intake (§9) | Removed 2026-10-28 with the email bridge (owner direction; revisit later). |
| Published occupant and independent interop | Not established. Engine tests do not establish two independently implemented occupants or production provider conformance; see [extraction](../../architecture/messaging-extraction.md). |
