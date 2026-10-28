# Identity portability: moves, attestations and successor pins — normative draft

> **Group:** Bindle extension
>
> **Status:** design candidate, revision 3.3; provisional; parts implemented locally behind flags; pending extensions revision 3 (CR-X3-14).
>
> **Covers:** identity moves, attestations and successor pins.
>
> **Does not cover:** key discovery ([Organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1)); signed-object rules ([keys](../keys.md)); 3sln.me recovery files ([recovery identity](../../3sln/accounts/recovery-identity.md)).

> **Pending [extensions revision 3](../extensions.md) (draft, unsigned, 2026-10-27).** Where this document relies on the `portability.v1` and `directory.v1` features, extensions revision 3.2 and protocol §2–§4 govern instead. Change request CR-X3-14, [extensions Appendix A](../extensions.md#appendix-a-migration-and-impact-change-requests-not-applied).

Status: **design candidate, 2026-10-22, revision 3.3.** Revision 3.3 (2026-10-23) replaces the flat 32 KiB bound on a moved identity's document with a byte budget derived from the worst-case size of each move, so that 16 legal moves always fit, and caps identity URIs, header kids (printable ASCII) and each move record, raises the bound of a document without `moves` to 32,768 bytes, and states what revoking a chain key does (§4 "Size", §5.3, §7 "Size"); *provisional, not signed off (DEVLOG 2026-10-23, "Successor chain byte budget and key tombstone compaction")*. Revision 3.2 applies design P14 and P16, which were *decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user*. P14: a current recovery credential must be at least 7 days old (§2, §6.1 item 2). P16: attestation keys form a continuity chain that verifiers pin, with an `attestation_first_use` signal (§5.1, §8.3, §8.6, §11). Pre-rotation is deferred (design P15) and is not part of this version. Revision 3.1 corrects the §8.6 residual (pre-rotation alone does not close first-contact forks; design §2.5–§2.6) and follows the organizations spec's renaming of "grant-management policy" to "membership and grant policy". The 3sln.me person-move delay and organization-move rules decided on 2026-10-22 are provider policy under §6.1 and live in the design (§6.1a, §6.2). Revision 3 applies the user's 2026-10-22 decision on design Q1 (rotation at transfer-in, with provenance chained and old-key issuance honoured only when recorded before rotation): §2, §7.1, §12 and AMD-P10/P11. Revision 2 applies the confident fixes of [review round 1](../../architecture/identity-portability.md#review-round-1) (marked IP-R1-…); its open items remain open. Succession verification, transfer-out/in engines, moved routes, owner transfer pages and sandbox redirect extensions are implemented locally (`packages/identity/succession.mjs`, `transfer-out.mjs`, `transfer-in.mjs`, and `packages/runtime/routes/transfer-pages.mjs`). New transfer-out, transfer-in and successor adoption are separately gated by their default-off registry flags; committed redirects remain available without those flags. External-provider interoperability, production billing and production verification remain unestablished. Not signed off or published. Rationale, flows, the 3sln.me product rules, threat model, slices and tests: [identity portability design](../../architecture/identity-portability.md). It incorporates the constraints of [organizations review round 4](../../architecture/organizations-design.md#review-round-4) (R4-H1, R4-H2) as relayed by the coordinator on 2026-10-22. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements. §13 lists the core amendments this draft needs; they are **proposed and unsigned**.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This document extends [protocol](../protocol.md), [auth](../auth.md), the `directory.v1` profile in [organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1), the [Organizations link envelope](organizations-link-envelope.md) (formerly links; contacts and links spike CR-K2, provisional), [recovery identity](../../3sln/accounts/recovery-identity.md) and [Parlay](messaging.md). It replaces the sentence of protocol §1 that leaves "domain/key continuity and cross-provider identity migration" to a future specification. It defines interoperability rules only. How a provider presents a move, what it charges, how long it redirects and how long it keeps data are provider policy.

## 1. Model

An identity is a stable UUID `sub` with provider-custodied keys, created at one provider. Handles are aliases in a provider's namespace and never move.

A **move** changes the provider that hosts an identity. The `sub` is unchanged and the signing key arrives unchanged (the destination then rotates it with continuity, §7.1), and the identity is reachable at the new provider under a new identity URI. A move is proven by two signatures:

- a **move statement** signed by the identity's signing key, which says where the identity went; and
- a **move attestation** signed by the old provider, which says the old provider verified the identity's current authority to leave.

Neither signature alone is authority. A signing key is in every recovery file ever issued for the identity, including superseded copies, so possession of the key proves nothing about who currently controls the identity (organizations §3, R4-H2). The old provider's attestation without the key holder's statement would let a compromised old domain redirect identities on its own.

Verifiers keep the identity's **origin principal** as its stable identifier and pin the latest verified move as a **successor pin**. HTTP redirects from the old provider are routing hints for browsers and clients; they never establish where an identity lives.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Origin principal | `(iss₀, sub)`, where `iss₀` is the issuer at which the identity was created. For an identity that has never moved, it is its `(iss, sub)`. It never changes. |
| Host | The provider currently hosting the identity. Its issuer is the identity's **current issuer**. |
| Source, destination | The host before and after one move. |
| Move statement | A JWS signed by the identity's signing key naming the source and destination (§4). |
| Move attestation | A JWS signed by the source's attestation key over one move statement (§5). |
| Move record | `{statement, attestation}`. A record whose `attestation` is `null` is **unattested**. |
| Successor chain | The ordered move records of an identity, published by its host as `moves` (§7). |
| Successor pin | A verifier's record of the latest move it has verified for an origin principal (§8.2). |
| Transfer authority | What the source verifies before it attests (§6). |
| Current recovery credential | A provider's per-identity recovery secret that would start a recovery at that provider right now. A superseded, consumed or invalidated credential is not current, and neither is a credential that can only resume a recovery already in progress. "The original recovery file" in 3sln.me's terms means the file carrying this credential (design P14). |
| Attestation key chain | A provider's attestation keys, linked from its first (root) key by continuity signatures (§5.1). |
| Portable identity package | The JSON object that carries an identity's private keys from the source side to the destination (§9). |
| Key history | The signing keys an identity has used, each with its validity interval (`created` to `retired`) and the continuity statements linking each key to the next (§7.1). |
| Recorded issuance | A record, made by the party that verifies or re-serves an artefact, of that exact artefact (its exact protected header and claims, or a digest of its signing input), made when it was issued or received (§7.1). |

## 3. Feature declaration

A provider declares `"portability.v1"` in `features` ([protocol §2](../protocol.md#2-discovery-and-login)) with these members, each an HTTPS URL on the issuer origin:

| Member | Role | Meaning |
| --- | --- | --- |
| `move_endpoint` | source | Receives move statements and answers with attestations (§5.2). |
| `attestation_jwks_uri` | source | A JWKS of the provider's ES256 attestation keys (§5.1). |
| `transfer_in_endpoint` | destination, optional | Accepts a top-level form POST carrying a portable identity package (§9.2). |

`portability.v1` requires `directory.v1`. A provider without `move_endpoint` and `attestation_jwks_uri` cannot be the source of an attested move; its identities can still leave through an unattested move (§8.5), with the consequences stated there. Invalid members make the feature absent under the protocol §2 processing rules.

## 4. Move statement

A move statement is a compact JWS under the profile of [keys §3](../keys.md#3-compact-jws-profile): strict I-JSON, exact members, received-bytes signing input and a 64-byte signature.

The protected header is exactly `{"alg":"ES256","kid":<kid>,"typ":"bindle-identity-move+jwt"}`. `kid` names the signing key (`use:"sig"`) that is `active` for the identity at the source when the statement is made.

The payload has exactly these members:

| Member | Definition |
| --- | --- |
| `bindle` | `"identity-move"` |
| `v` | `1` |
| `sub` | The identity's UUID, lowercase canonical form. Unchanged by every move. |
| `kind` | `"person"` or `"organization"`. It MUST equal the identity's kind at the source, and no move changes it. |
| `seq` | Positive safe integer: `1` for the identity's first move, and the previous statement's `seq` plus one afterwards. |
| `prev` | `null` when `seq` is 1. Otherwise the digest of the previous statement: `sha256-` followed by the canonical unpadded base64url SHA-256 of the ASCII bytes of its received signing input (`segment1 "." segment2`). |
| `from` | `{"iss","identity"}`: the source's issuer origin and the identity URI at the source. |
| `to` | `{"iss","identity"}`: the destination's issuer origin and the identity URI at the destination, which MUST be on the destination's origin. |
| `iat` | Unix seconds. |

`from.iss` and `to.iss` MUST differ. A move back to an earlier host is allowed and has a new identity URI and a higher `seq`.

**Size.** `from.identity` and `to.identity` are at most 512 characters each. The header `kid` is 1 to 128 printable ASCII characters (`!` to `~`). A verifier refuses any other `kid`, including non-ASCII characters, controls and lone surrogates. The compact statement is at most 3,072 bytes. A statement within these limits is at most 2,721 bytes. A verifier refuses a longer statement before checking its signature. A signer refuses to produce one, and a destination refuses a move whose statement would be longer (§9.3).

Any holder of the signing key can produce a valid statement. That is why a statement never authorizes anything by itself (§8.3, §8.5).

## 5. Move attestation

### 5.1 Attestation keys

The source signs attestations with dedicated ES256 keys published at `attestation_jwks_uri`. They are provider keys, never identity keys, and they sign only attestations. Every key carries `kid`, `use:"sig"` and `alg:"ES256"`.

- A provider MUST keep listing every attestation key that signed an attestation for as long as it operates, including after it stops using the key, so that verifiers can check old successor chains after redirects end (§10). A key that is compromised is removed from the set, and the provider SHOULD tell the identities whose attestations it signed. A provider SHOULD rotate its signing attestation key at least yearly, so that a later compromise exposes fewer future attestations.
- **Continuity (P16).** Every attestation key except the provider's first carries `"continuity":{"kid":<earlier kid>,"sig":<base64url>}`. `sig` is a 64-byte ES256 signature by the listed key `kid` over the ASCII bytes of `bindle-attestation-key-continuity-v1.` followed by the new key's RFC 7638 SHA-256 thumbprint (unpadded base64url). The signing key MUST be listed when the new key is introduced. A key whose continuity signer is later removed (for example after a compromise) stays trusted only where a verifier had already pinned it. A provider that loses every attestation private key must start a new root, which verifiers treat as an attestation reset (below).
- **Verifier pinning (P16).** A verifier keeps, per issuer, the thumbprints of the attestation keys it has accepted. On its first fetch for an issuer it pins every listed key whose `continuity` is absent or verifies against another listed key, and records that the pin was made on first use. Later, a key is **trusted** when it is pinned, or chains to a pinned key that is still listed; trusted keys are added to the pin. A JWKS in which no listed key is pinned, or a record signed by a key that does not chain to a pinned key, is an **attestation reset**. Records signed by untrusted keys are not adopted automatically (§8.3 item 3), existing pins and adoptions are kept, and the verifier SHOULD alert its operators. A verifier MAY be configured with root thumbprints in advance (for example, an SDK shipping its home provider's root), and then never pins that issuer on first use.
- The JWKS is fetched under the protocol §2 manifest rules. A verifier MAY keep a fetched key to verify records it has **already adopted** (§8.3) and to check chains when the issuer is gone. Before an **automatic adoption** (§8.3, §8.6) it MUST use a JWKS fetched within the last hour while the issuer is reachable, and a `kid` absent from a successful fetch is treated as revoked: records it signs are not adopted automatically, and a pin adopted under it is kept but flagged for review (IP-R1-M3).

### 5.2 The move endpoint

The destination sends `POST <move_endpoint>` with `Content-Type: application/json` and the body `{"v":1,"statement":"<JWS>","transfer":<string|null>,"redirect_base":"<URL>"}`:

- `transfer` is the source-issued transfer identifier from the package (§9.1), or `null`;
- `redirect_base` is an HTTPS URL on the destination's origin (the origin of `to.iss`), without query, fragment, userinfo, dot segments or percent-encoded `/`, `\` or `.`, whose path ends in `/`. It MUST be unique to this source at the destination, so that the destination can tell which original origin to reconstruct (§10). The source uses it only to build redirects. The source binds it to the statement on the first request it accepts for that statement, and a request with the same statement and a different `redirect_base` is `refused` (IP-R1-L2).

The request carries no credentials. The statement is checked against the source's own records, and the source acts only on an authorization it already holds (§6). Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{"status":"attested","attestation":"<JWS>","redirect_until":<unix seconds or null>}` | The move has committed at the source (§6.3). |
| 202 | `{"status":"pending","authorize_url":"<URL>","retry_after":<seconds>}` | Transfer authority is not yet established. `authorize_url` is on the source's origin (it may carry a query, for example the statement digest an authorization will be made against, but no fragment); the destination sends the user there by top-level navigation, and repeats the identical POST after `retry_after`. |
| 409 | `{"status":"refused"}` | Uniform for every other outcome: unknown, suspended or ended identity; an invalid statement; a cancelled or expired transfer; a move already attested to another destination; policy refusal. |
| 429, 503 | — | Retryable, with `Retry-After`. |

The endpoint is idempotent per statement: repeating the identical body returns the current status, and an attested statement returns the same attestation for at least as long as the source keeps a redirect record, and at least 30 days, so that a lost response never strands a committed move (IP-R1-L4).

A move is **pending** only once a transfer authorization (§6.1 items 2, 3 and 5) exists for the identity. A statement that arrives with no authorization creates no state that blocks anything: the `202` answer and its `authorize_url` are computed per statement, and any number of statements may be in that condition. An authorization binds to exactly one destination origin and, once a statement is matched to it, to that statement's digest. A different statement for an identity whose move is pending or attested is then `refused`. Otherwise a holder of any old recovery file could block every legitimate move by posting statements first (IP-R1-H3).

### 5.3 Attestation format

The protected header is exactly `{"alg":"ES256","kid":<attestation kid>,"typ":"bindle-move-attestation+jwt"}`. The payload has exactly:

| Member | Definition |
| --- | --- |
| `bindle` | `"move-attestation"` |
| `v` | `1` |
| `iss` | The source's issuer origin, equal to the statement's `from.iss`. |
| `sub`, `seq` | Equal to the statement's. |
| `statement` | The digest of the statement's received signing input, in the `prev` encoding (§4). |
| `to` | Equal to the statement's `to`. |
| `aep` | The identity's authority epoch at the source when the move committed ([organizations §2](organizations.md#2-terms)). |
| `at` | Unix seconds of the commit. |

The compact attestation is at most 2,560 bytes. Its `kid` follows the §4 rule, so an attestation within the §4 limits is at most 2,022 bytes. A verifier refuses a longer attestation, and a source never signs one.

## 6. Transfer authority and commit

### 6.1 What the source must verify

A source MUST NOT attest a move unless every one of these holds. Items 2, 3 and 5 are established when the user authorizes the transfer. At commit, the source re-checks item 1 and that the authorization is neither expired nor cancelled, the credential is still current, and no authority reset of the identity happened since:

1. **Statement.** The statement verifies under the identity's `active` signing key; `sub`, `kind`, `from` and `seq`/`prev` match the source's records; the identity is active, not suspended, deleting or deleted; and no other move of this identity is pending or attested at this source. **Binding (IP-R1-H3):** the statement's `to.iss` and the request's `redirect_base` are on exactly the destination origin the user confirmed under item 5; if the authorization carries a transfer identifier, the request's `transfer` equals it; and the statement's `iat` is no earlier than 5 minutes before the authorization was created, unless the authorization was made against that exact statement digest (the destination-start flow).
2. **Current recovery credential.** The identity's current recovery credential was presented to the source in this transfer, on a source page, or the source has an equivalent current per-identity secret if it issues no recovery files. A superseded, consumed or invalidated credential never qualifies. Nor does a credential issued less than **7 days** before the transfer was authorized (design P14): issuing a new credential usually needs only a signed-in session, so a fresh credential would add nothing to a hijacked session. **Possession of the identity's private keys never qualifies**, and neither does a recovery file whose credential is not current.
3. **Current control.** Exactly one of:
   - **(a) Session path.** A fresh authenticated session of the identity at the source, with user verification (a step-up) no older than 10 minutes when the user confirmed the transfer. A session whose authority derives from an authority reset of the identity (a recovery, a credential reset or a key reset) completed less than 7 days earlier does not satisfy this path. Otherwise a stolen recovery file would recover the account and then satisfy (a) at once. Nor does a step-up performed with a credential enrolled less than 7 days earlier, or a session of an identity whose contact channels changed in that time (IP-R1-M1). When the user confirms, the source MUST send notice of the pending move, naming the destination's origin, to every current contact channel and every active session before it commits.
   - **(b) Waiting-period path.** A public waiting period of at least 7 days. It cannot start while an authority reset of the identity, or a change of its contact channels, completed less than 7 days earlier; a recovery-derived controller therefore waits at least 14 days in all (IP-R1-H1). It starts only once the source has sent notice of the pending move, naming the destination's origin, to every current contact channel and every active session of the identity, and to every contact channel removed or replaced in the preceding 30 days. Each notice carries a cancellation capability that works without signing in, because the person it protects may have lost every credential. Any fresh authentication as the identity during the period can cancel the move. Any authority reset, credential enrolment or contact-channel change during the period cancels it.
   - For an identity of kind `organization`, which has no sessions of its own (organizations §3), "the identity's session" in (a) means the session of the person exercising item 4, and the 7-day exclusions apply to authority resets of that person **and** of the organization. In (b), notices go to every person holding owner-interface authority over the organization, and at least the persons holding transfer authority under item 4 can cancel.
4. **Organizations.** For an identity of kind `organization`, additionally: current authority to transfer the organization under the provider's disclosed membership and grant policy ([organizations §6.3](organizations.md#63-owner-interface)), exercised by a person authenticated with their own identity. Authority obtained through organization recovery does not count until that recovery has taken effect under the same policy. The organization's own recovery credential satisfies item 2, not this item.
5. **Destination shown.** The user confirmed the move on a source page that named the destination by its origin, highlighting its registrable domain, and stated that the source will stop speaking for the identity.

How the source collects these is provider policy. It MAY require more, such as longer waiting periods, extra notices, a delay before commit that a dispute can hold, or a delay before an organization move. (3sln.me: design §6.1a and §6.2.)

### 6.2 Cancellation and expiry

A pending transfer expires if no matching statement arrives within a bound the source chooses (at most 7 days after authorization on path (a)). Cancellation and expiry discard the authorization, and the source then answers `refused` for the statement.

Cancellation and commit are serialized in the identity's single writer: a cancellation that commits first wins, and a commit re-checks that no cancellation, reset or channel change exists. The cancelling page MUST offer to invalidate the presented recovery credential (issuing a new recovery file), because whoever started the move holds the current credential and could otherwise start again at once (IP-R1-M2). Repeated starts with the same credential after a cancellation SHOULD be refused until the owner has chosen.

### 6.3 Commit at the source

Attesting is one atomic commit at the source. In it, the source MUST:

- record the move and stop treating the identity as active: it issues no certificate, signs no new artifact with the identity's keys, and accepts no authorization or token request for it;
- mark every certification key (`use:"cert"`) of the identity `revoked`;
- revoke every session, client session, refresh token and access token of the identity. Grants and tokens never migrate (protocol §1);
- revoke every key delegation it certified for the identity (for example [Bindle Messaging §3.2](messaging.md)), so that delegation status answers `revoked` from the source itself (§10);
- conclude every open app removal as forced and sever every connection, with terminal `connection-revoked`. It MUST NOT emit `subject-deleted` ([app removal §8](app-removal.md), AR-9), at commit, at the end of the redirect period, or in any later cleanup; a moved identity is not deleted, and apps keep its state;
- destroy its custody copies of the identity's private keys, so that it can sign nothing for the identity afterwards;
- refuse every later recovery, credential reset or reactivation of the identity;
- never attest another move of this identity. Only the current host can attest the next one.

After the commit, the source answers for the identity only as §10 describes. Surfaces reachable without the owner's own authenticated session answer either with the §10 redirect (while the source keeps a redirect record) or exactly as for a deleted identity under [app removal §8.5](app-removal.md) (RR1-R1): the uniform 404 for lookups and the invalid-credential refusal for per-identity credentials. A distinguishable `410 identity_moved` is permitted only on the owner's own authenticated surfaces, such as an export console. It MAY keep the account's data for an export period under its own policy, but nothing in that period lets it speak for the identity. It SHOULD notify the identity's channels that the move completed.

## 7. Identity documents for moved identities

This section extends the identity document of organizations §3a.3.

- The host of an identity that has moved at least once MUST include `moves`: an array of move records in ascending `seq`, starting at `seq` 1, each `{"statement":"<JWS>","attestation":"<JWS>"|null}`. The origin issuer is `moves[0]`'s statement `from.iss`.
- The last record's `to` MUST equal the document's own `iss` and identity URI.
- At most 16 records. A document with `moves` is at most 152,576 bytes (§7 "Size"). An identity that would exceed 16 moves cannot move again under this version.
- The host MUST NOT list as `active` any signing key that the source listed as `retired` or `revoked` before the move. The no-rollback rule of §3a.4 continues across hosts.
- The host MUST keep listing every signing key that signed a statement in `moves` (as `active`, or as `retired` once rotated), with its continuity chain to the current key, so that first-contact verifiers can check the chain (§8.6). This is an exception to the omission allowance of §3a.3.
- Certification keys (`use:"cert"`) are the destination's own fresh keys. A destination MUST NOT reuse a certification key of an earlier host, and no package or file carries one (§9.1).
- Certificates that the destination issues carry an `aep` strictly greater than the latest attested `aep`.

**Size.** The budget is derived from the worst-case move, so 16 legal moves always fit when each destination rotates once at activation (§7.1):

- Each move adds its record (a statement of at most 3,072 bytes, §4, and an attestation of at most 2,560 bytes, §5.3, with 64 bytes of JSON framing) and one signing-key entry of at most 1,792 bytes: the key that the destination rotates to at activation, which later hosts keep listing. That is 7,488 bytes per move.
- The current host's own members get a base of 32,768 bytes: the non-`moves` members, its certification keys, and the signing keys of its own history. The base covers 16 such keys. A document without `moves` has the same bound, 32,768 bytes (organizations §3a.3), so an identity that never moved can always list its 16 keys.
- The budget is 32,768 + 16 × 7,488 = 152,576 bytes. A document is at most 64 keys.
- A verifier MUST refuse a document above the budget, a record above its cap, or more than 16 records. The fetch bound is the budget.
- A host MUST NOT publish a document that a verifier would refuse. A destination therefore refuses a move before it reserves, imports or signs anything when the identity's largest possible document at the destination would exceed the budget or 64 keys (§9.3). That document is the source's records, this move's statement with an attestation at its cap, every key the destination will import and publish, and the base.
- **More than one rotation per host.** The per-move allowance assumes one chain key per move. A host that rotated more than once leaves extra chain keys, which every later host must keep listing. They use up headroom that the allowance does not reserve. The destination's check above counts them, so such an identity can still move whenever its real document fits. When it would not fit, the identity cannot move again under this version.
- **Rotation headroom.** A host keeps every key of the continuity chain from the key that signed the first record to the current key (the listing rule above), and never removes one to make room. The 16 keys in the base are a reserve, not a ceiling. A host MAY keep further own keys while its published document still fits the budget and 64 keys. It MUST refuse a rotation that would exceed either bound.

**Revoking a chain key.** A revoked key vouches for nothing (organizations §3a.4), so revoking a retired key of the chain cuts the continuity lineage at that key:

- statements signed by that key, or by any earlier key, no longer verify against the published key list;
- verifiers that already adopted those records keep their pins (§8.2);
- a verifier meeting the identity for the first time (§8.6), or adopting through a record at or before the cut, cannot verify the chain. It does not adopt automatically, and the record may be offered as a pending successor (§8.5) at most;
- a destination refuses a later move out (§9.3, the chain does not verify).

Revoke a chain key only on compromise. Revoking it costs the identity its verifiable portability history.

**Activation.** A destination MUST NOT serve the identity as active, issue certificates or sign fresh artifacts for it until it holds either a verified attestation for the last move or, for an unattested move, a stored decision under its own policy to host an unattested identity (§8.5).

### 7.1 Signing-key rotation at the destination

The identity's signing key arrives unchanged, and the move statement for this move is signed by it. Every recovery file or package issued before the move also holds that key, so leaving it in service would let any old copy keep signing as the identity.

- **Rotation.** A destination SHOULD rotate the signing key when it activates the identity, in the same commit and before it signs any fresh artefact for the identity. (3sln.me always does, design §7.) The rotation is a continuity statement (organizations §3a.4) signed by the old key that names the new key. The next move statement is signed by the new key.
- **Key history stays published.** The host MUST keep listing every signing key in the identity's key history as `retired` with `created` and `retired` (Unix seconds, the time of the rotation), together with the continuity statements linking it to the current key, for as long as it hosts the identity, so that verifiers can walk the chain. This extends the §7 listing rule and is an exception to the omission allowance of organizations §3a.3. A key is revoked, rather than retired, only on compromise or at the identity's request; revoking it ends everything this section would honour.
- **What a retired key still verifies.** A signature by a retired key is valid only for an artefact that is bound to a time before the key was retired:
  1. the verifier holds a **recorded issuance** of that exact artefact, made before the key's `retired` time. For a host this is its issuance store (for links, the exact stored header and claims of [link envelope §3.3](organizations-link-envelope.md#33-owner-side-validity)). Records the destination imports from the source count when the source recorded them before its commit (§6.3), because a source signs nothing after commit; or
  2. the artefact is otherwise anchored before the retirement: the verifier itself received and stored it before learning of the rotation, or it is a statement of the pinned successor chain (`moves`) or a continuity statement in the key history.

  A signature by a retired key on anything else is invalid, whatever its `iat` or other self-declared time says, because the signer chooses those. A holder of an old recovery file can still produce signatures with the retired key, but none of them is honoured.
- **Fresh tokens use the current key.** A host MUST NOT sign anything new with a retired key. A short-lived token the host mints today from an artefact issued under a retired key (for example a contact-delivery bearer minted from a pre-rotation contact link) is new issuance: the host signs it with the current key, and verifiers check it against the current key.
- **Old links keep working.** A contact link, or any other host-verified link, issued before the move keeps verifying at the destination when the destination imported its exact stored record (§11, "Links"), and deliveries through it are accepted under the same rules as before the move. The sender's author proof is signed by the sender's own key, so the recipient's rotation does not affect it.

## 8. Verifier rules

### 8.1 Stable identifier

Verifiers MUST key every relationship with an identity (memberships, relation edges, contacts, peer records, app accounts) by its **origin principal**. For an identity that has never moved, that is its `(iss, sub)`, so existing records need no change.

A verifier that receives an artifact whose `(iss, sub)` is not an origin principal it knows looks the pair up in its successor index (§8.2). A pair that maps to an origin principal is that identity. A pair that maps to nothing is an identity the verifier does not know.

### 8.2 Successor pins

Per origin principal, a verifier that relies on the identity over time keeps:

- the current issuer and identity URI;
- the highest `seq` verified and the digest of that statement (the chain head);
- the signing-key pin and the retired, revoked and superseded kids of §3a.4;
- the highest `aep` accepted.

It also keeps an index from each `(current issuer, sub)` it has adopted to the origin principal. Certificates and fresh signatures verify only under the identity document at the pinned current identity URI. **An artifact whose `iss` is an earlier host of the identity fails**, because that host no longer speaks for it.

**Index conflicts (IP-R1-M5).** `sub` values are chosen by issuers, so a hostile issuer can mint an identity under another identity's `sub`. A move whose `(to.iss, sub)` is already an origin principal the verifier knows, or already maps to a different origin principal, is not adopted; the verifier treats both identities as contested under §8.4. A destination likewise keys hosted identities by origin principal and refuses a transfer-in whose `sub` it already uses for a different origin principal.

**State bounds.** Per origin principal the pin is constant-size plus at most 16 index entries (§7). A verifier MAY drop the pin and index of an identity with which it no longer holds any relationship.

### 8.3 Adopting an attested move

A verifier adopts a move record automatically only when all of the following hold:

1. The statement verifies under the pinned signing key, or a key linked to it by a valid continuity chain, and that key was active at the pinned host.
2. `from` equals the pinned current issuer and identity URI; `seq` equals the pinned `seq` plus one; `prev` equals the pinned chain head (`null` for `seq` 1); `sub` and `kind` are unchanged.
3. The attestation verifies under a key from `from.iss`'s `attestation_jwks_uri` (fetched from that issuer's manifest, or cached under §5.1) that is **trusted** under the §5.1 pinning rules, and its `iss`, `sub`, `seq`, `statement` and `to` match. A key that is untrusted because of an attestation reset fails this item for a reason other than unavailability (§8.5).
4. The destination's manifest meets the protocol §2 conformance floor and declares `directory.v1`. The destination's directory `?sub=` lookup returns exactly `to.identity` (organizations §3a.1, R2-H2), so that a record cannot point the verifier at an attacker-influenced path on the destination's origin (IP-R1-M4). The identity document at `to.identity` has matching `iss` and `sub`, a `moves` array ending with this record, and a signing key equal to or continuity-linked from the pinned key, and it does not violate the no-rollback rule.
5. **The source has let go (IP-R1-H2).** The source does not serve the identity as active: its directory `?sub=` lookup answers with the §10 redirect or moved body carrying this exact record, or with 404. A `200` that still lists the identity as hosted there means the attestation was not produced by a committed move (a leaked or misused attestation key, or a source that keeps serving after attesting), and the record is not adopted automatically. A `200` naming a different identity URI at the source counts as let go only when a later record of the chain being verified moves the identity to exactly that URI (a return, §4); otherwise it is treated as still serving (a fabricated `from.identity` must not pass). An unreachable source is `temporarily_unavailable`; after 7 days of failed attempts the verifier MAY treat the source as gone for this item.

On adoption the verifier atomically: updates the successor pin; maps `(to.iss, sub)` to the origin principal; stops accepting the earlier host's certification keys; and raises its recorded `aep` floor to the attested `aep`. Adoption is an **authority reset** in the sense of organizations §5.2a, so owner-interface authority is held until re-confirmed.

Records are applied in `seq` order. A verifier more than one move behind applies each record in turn.

### 8.4 Equivocation and rollback

- A record whose `seq` is at or below the pinned `seq` and that is byte-identical to a record already verified is a replay and is ignored. One that differs and does not carry a valid attestation is ignored.
- A record that differs from one already verified at the same `seq` but carries a valid attestation from the same source, whether it arrives before or after adoption, is evidence of **equivocation**, not a replay (IP-R1-M6). Two different records with valid attestations for the same origin principal and `seq` are **equivocation**. The verifier MUST NOT adopt either, MUST keep the pin, MUST treat the identity as contested (no owner-interface authority, no new relationships) and SHOULD report it to its operators. Resolution is a human decision under §8.5.

### 8.5 Unattested moves and local confirmation

An unattested record, or an attested record that fails §8.3 for a reason other than unavailability, MUST NOT be adopted automatically. Key possession alone is not authority, whether or not the source still exists.

A verifier MAY offer the record to the human who owns the relationship (a contact's owner, an organization's operators) as a **pending successor**. It MUST NOT offer one while the pinned host declares `portability.v1` and serves the identity as active with the pinned key: a legitimate owner can obtain an attestation there, so an unattested record in that state is most likely a superseded-file fork (IP-R1-M7). The §8.3 item 4 directory check applies to pending successors too. Before adoption the verifier MUST show:

- that the old provider did not confirm the move;
- the old and new hosts by origin;
- whether the old host still serves the identity as active.

Adopting it is an explicit local act with the effects of §8.3, including the authority reset. A verifier MUST NOT adopt a pending successor while the pinned host serves the identity as active with the pinned key, unless the human confirms after that warning. "Serves as active" is judged from the pinned host's directory and identity document alone, whether or not it declares `portability.v1`; declaring `portability.v1` only decides whether the record may be offered at all.

### 8.6 First contact with a moved identity

A verifier meeting an identity for the first time at its current host verifies the whole successor chain from the origin. Each statement must verify under the key its `kid` names in the current identity document, which MUST list that key (as `active` or `retired`) and link it to the current `active` key by continuity. Each record must also pass §8.3 items 2 and 3, read against the previous record instead of a pin; the attestation is what binds the key to the identity at each earlier host, because a source attests only statements signed by the identity's active key (§6.1). Each record must also pass §8.3 item 5 against its own source, under the same 7-day rule. If every record verifies, the verifier keys the identity by its origin principal and pins it as in §8.2.

**Fetch budget (IP-R1-M8).** A chain can name up to 16 issuers, each needing a manifest, an attestation JWKS and a directory lookup. A verifier first checks everything it can without a fetch: every statement's signature under the current document's keys, `seq`/`prev` linkage, `from`/`to` continuity and sizes. It verifies a chain only when the claimed origin principal matches a relationship it already holds, or when a role requires origin linking (an application linking an existing account, §11); otherwise it keys the identity by its current `(iss, sub)` and MAY verify the chain later in the background. Fetches are under the organizations §3a.5 per-issuer and global budgets, and a chain is verified in the background, never on a request path that organizations §5.2 forbids.

**Residual.** An attested chain is as strong as each source's attestation key for as long as anyone verifies the chain. A party holding any old recovery file of the identity and either a leaked attestation key or the lapsed domain of a source that has stopped answering can construct an alternative chain that a verifier meeting the identity for the first time cannot tell apart from the real one. Verifiers that already pinned the identity detect it as a broken `from` or as equivocation. Key rotation at the destination (§7.1) does not close this, because the forged chain branches off before the move. Pre-rotation would not close it alone either: a holder of an old file that contains a spent rotation key can still produce a validly signed fork at that key's position. Only an independent record of key events (witnesses or an append-only log) or the verifier's own pin detects a fork.

**Mitigation in this version (design P16, §2.7).** An attacker who controls a lapsed source domain but holds none of its attestation private keys can only publish a new root. Every verifier that pinned that source's attestation keys before, or was configured with its root, treats that as an attestation reset and does not adopt automatically. The residual is limited to verifiers with no prior pin for the source. When verifying a chain required pinning any source's attestation keys on first use, the verification result MUST carry `attestation_first_use: true`, and roles that link existing accounts act on it (§11). Pre-rotation is deferred (design P15). A shared-pin profile and an append-only move log are the upgrade path (design §2.7) and are not part of this version.

If any record cannot be verified (an unattested record, or an issuer or attestation key that is unreachable), the verifier MUST NOT treat the identity as that origin principal. It keys it by its current `(iss, sub)` as a separate identity and shows any origin claim as unverified. It never merges the two later without a human decision.

### 8.7 How verifiers learn of moves

- **Background refresh.** A verifier that refreshes pinned identity documents (organizations §5.2) receives the source's §10 response for a moved identity and evaluates the record it carries or the destination document it points to.
- **Presentation.** The identity, or its host on its behalf, MAY present its `moves` through any channel a role's specification defines. Verification is identical. A role that forbids request-triggered fetches (organizations §5.2, R2-H1) verifies presented records in the background and fails the triggering request uniformly. A verifier SHOULD check presented records offline against its pin (linkage from the pinned head and place, and the signature of any record signed by the pinned key) before queuing them, and SHOULD bound its queue per origin principal with retry backoff and a drop-after limit, so that presentations naming unreachable hosts cannot starve later ones.

Neither path trusts an HTTP redirect.

### 8.8 Where identity URIs come from

Organizations §3a.1 (R2-H2) gains one source: an identity URI is also obtained from the `to.identity` of a move record that the verifier has adopted under §8.3 or §8.6.

## 9. Portable identity package

### 9.1 Format

The package is a JSON object of at most 8 KiB with exactly:

| Member | Definition |
| --- | --- |
| `bindle` | `"identity-package"` |
| `v` | `1` |
| `sub`, `kind` | As in §4. |
| `from` | `{"iss","identity"}` of the source. |
| `keys` | `{"signing":{"kid","jwk"},"encryption":{"kid","jwk"}?}`, private JWKs (P-256; ES256 for signing, ECDH-ES for encryption). |
| `transfer` | `{"id","exp"}` when the source has authorized the transfer, otherwise absent. `id` is 16–64 characters of `[A-Za-z0-9_-]`. |

A package MUST NOT contain a recovery credential, password or passkey material, session or client credentials, OAuth grants, certification keys, handles or profile data. A destination MUST reject unknown members and private and public key material that does not correspond, using the correspondence checks of [recovery identity](../../3sln/accounts/recovery-identity.md#recovery-wire-schema-and-api).

### 9.2 Delivery

- **From the source side.** The source's page MAY deliver the package by a top-level form POST (`application/x-www-form-urlencoded`, exactly one field `package`, the JSON text) to the destination's `transfer_in_endpoint`, after §6.1 items 2, 3 and 5 are satisfied. The page sends `Referrer-Policy: no-referrer`. The destination MUST NOT log the body, and MUST treat the POST only as the start of its own interactive flow: it authenticates or enrolls its user before storing keys.
- **From a recovery file.** A destination MAY derive a package from a recovery file in a format it implements. It MUST discard the source's recovery credential without storing or transmitting it, and the package then has no `transfer`. Decrypting the file shows the destination the source's **current** recovery credential, which is transfer authority at the source (§6.1 item 2) and recovery authority there; "discard" cannot be verified. So when the source declares `portability.v1` and is reachable, a destination SHOULD NOT ask for the source's recovery file: it sends the user to the source's `authorize_url`, and the source's page delivers the package (IP-R1-M9). Deriving from a file is for sources that cannot attest.

The recovery file format is provider policy and is not part of this specification. The package is the interoperable unit.

### 9.3 Destination checks

Before signing a statement, the destination MUST:

- refuse a `sub` that it already hosts or has hosted, unless its own records or the identity's verified chain show that this identity previously moved out of it. One exception: `sub` values are public, so anyone can import fake keys under a victim's `sub` as an unattested identity to block a later move. An attested move therefore displaces an identity that the destination hosts unattested under the same `sub`. The destination ends that identity first;
- check, when the source is reachable, that `keys.signing`'s public key is the `active` signing key in the source's current identity document for `sub` (otherwise it can only produce an unattested move);
- store the keys under its own custody before activation;
- refuse a move whose `from.identity` or `to.identity` exceeds 512 characters, whose statement would exceed 3,072 bytes (§4), or whose largest possible document at the destination would exceed the §7 budget or 64 keys. These checks come before anything is reserved, imported or signed.

## 10. Redirects from the source

A source MAY redirect requests for a moved identity. Whether and for how long it does so is provider policy. While it does:

- **Scope.** Only URLs whose routing at the source is determined by the moved identity: its identity URI and the subtree under it, directory lookups naming its handles or `sub`, its link and delivery URLs, and any other per-identity route. Never the manifest, authorization, token, revocation, RPC or intent-link endpoints, which are host-level. Never key-delegation status routes: the source answers those itself with the final `revoked` status, because delegations it certified died at commit (§6.3) and the destination cannot know them.
- **Status.** `308 Permanent Redirect`, so that methods and bodies are preserved.
- **Target.** `redirect_base` from §5.2, followed by the request path without its leading `/`, followed by `?` and the request's raw query exactly as received when it has one. The destination reconstructs the original URL as `from.iss` plus that suffix. The source redirects only a request whose path, as received, matches the per-identity route without normalization, contains no dot segment, empty segment, backslash or percent-encoded `/`, `\` or `.`, and whose raw query contains only RFC 3986 query characters; any other request answers as for an unknown identity (IP-R1-L1). A source that has verified a later move of the same identity under §8.3 MAY redirect to the later host instead, which shortens chains, but only to a `redirect_base` on that later record's `to.iss` origin that the identity itself supplied through an authenticated action at the source, never one taken from an unauthenticated notice (IP-R1-L3). It MUST NOT redirect to its own origin or to an unattested destination.
- **Body.** An identity-document or directory request MAY carry the JSON body `{"v":1,"iss","sub","moved":{"statement","attestation"}}`, so that a client that does not follow redirects can evaluate the record (§8.7).
- **Headers.** `Referrer-Policy: no-referrer`. `Cache-Control: no-store` for any URL carrying `bindle_meta`, `bindle_data`, `sig` or `bintent`, and otherwise at most `private, max-age=86400`; never `immutable` and never cacheable by shared caches, because a return (design §3.5) or an early end must take effect. The redirect never varies on request headers.
- **Logs.** A source SHOULD NOT keep per-request records of redirected requests beyond its ordinary abuse controls. The redirect discloses the new host to whoever holds an old URL; logs would additionally disclose who followed it.

**What clients do with a redirect.** A browser navigating follows it, and the destination's page names both hosts. A non-browser Bindle client treats the redirect as a hint only. It MAY follow at most three cross-origin redirects in one resolution under the SSRF rules of protocol §2, detecting cycles. It accepts what it finds only if a move record verifies under §8.3 or §8.6. Fetch implementations drop `Authorization` on cross-origin redirects, so a client re-sends an authorized request (for example `BindleLink` delivery) itself, after verification. The no-redirect rule of organizations §3a.3 is relaxed only in this way.

**After redirects end.** The source then treats the identity exactly as a deleted identity, under its existing rules (for example the uniform 404 of §3a.2). It keeps publishing its attestation keys (§5.1). Verifiers that adopted the move are unaffected. Holders of old URLs that never learned of the move lose them, unless the identity presents its chain to them (§8.7).

The source MUST NOT reassign the identity's handles (identity names) or reuse its `sub` for another identity.

**Ending early.** The identity may ask the source to end its redirect at any time. The source authenticates the request as the moved identity only through a chain it verifies under §8.3 or §8.6 (for example the destination's `bindle_origin`/`bindle_moves`, §11). A source SHOULD end the redirect when the identity URI it redirects to has answered 404 for 30 days, so that a redirect does not outlive the identity's deletion at the destination.

## 11. Effects on other specifications

- **Authorization.** The source's authorization request endpoint answers a request naming a moved identity with the error `identity_moved` and `{"to":{"iss","identity"}}` while it keeps a redirect record, and otherwise as for a deleted identity. A client MUST NOT forward the request, PKCE material, codes or tokens to the new issuer. It MAY start fresh discovery at `to.iss`, after showing that host to the user (protocol §2).
- **Applications.** Applications key their users by origin principal (§8.1). A destination MAY add `bindle_origin` (`{"iss","sub"}`) and `bindle_moves` (the `moves` array) to its token response for a moved identity; an application MUST verify them under §8.6 before linking the user to an existing account, and otherwise treats the user as new. When the verification result carries `attestation_first_use: true`, the application SHOULD also confirm ownership of the existing account through a channel it already holds (for example its own verified email for that account) before linking.
- **Links.** A destination that imported a moved identity's issued links MAY verify them at redirected URLs. It then applies link envelope §3.2 against the reconstructed original URL and the original origin recorded in the move, not its own origin, and requires the exact stored header and claims it imported. Links it did not import fail with `link_invalid`. Revocation state is imported with the links, and a link absent from the import is revoked.
- **Organizations.** Memberships and relation edges are keyed by origin principal. Member and entity certificates from a moved identity name its current issuer, and verifiers map them through the successor index (§8.2). Certificates issued by the source stop verifying when its certification keys are revoked at commit (§6.3), and the client re-acquires certificates from the destination. An organization's own move changes its identity URI. Certificates must name the current identity URI as `aud`, and clients re-acquire them.
- **Data.** Moving an identity does not move its data, grants, resources, connections it holds as grantor or resource URLs. Those migrate only through export and import formats, which this specification does not define. Counterparts re-consent to any resource whose identifier changed.

## 12. Conformance tests

- **Statement and attestation:** exact members and headers; a wrong `typ`; a statement signed by a retired, revoked or non-active key; `kind` change; `from.iss` equal to `to.iss`; `seq` gaps and `prev` mismatches; an attestation over another statement, another `to` or another `seq`; an attestation signed by an identity key; an unknown attestation `kid`.
- **Transfer authority:** a superseded, consumed or invalidated recovery credential is refused; key possession without a credential is refused; a session within 7 days of an authority reset cannot use path (a); a waiting period without notices does not start; fresh authentication cancels it; an authority reset during the period cancels it; an organization move without transfer authority under the provider's policy is refused even with the organization's current credential; uniform `refused` for every refusal.
- **Commit:** after attesting, the source issues no certificate and no signature, refuses authorization requests with `identity_moved`, lists its certification keys as revoked, holds no private key copy, and refuses a second statement.
- **Verifiers:** automatic adoption needs both signatures; an unattested record is never adopted automatically; a redirect without a verifiable record is never followed as authority; equivocation fails closed and keeps the pin; a lower `seq` replay is ignored; a document reviving a source-retired kid is rejected; certificates from the source fail after adoption and certificates from the destination fail before it; adoption raises the `aep` floor and holds owner-interface authority; first contact keys by origin principal only when every record verifies; a three-hop chain applies in order; a cycle and a fourth redirect hop fail.
- **Redirects:** target construction preserves the raw query byte for byte; host-level endpoints are never redirected; capability URLs carry `no-store`; after the redirect period the identity answers as deleted and attestation keys stay published.
- **Review round 1:** a statement whose `to.iss` or `redirect_base` differs from the confirmed origin is refused; statements posted without authorization block nothing; path (b) cannot start within 7 days of a recovery, notices reach channels removed in the last 30 days, and a notice link cancels without sign-in; a channel change or credential enrolment during the period cancels; a step-up with a credential enrolled within 7 days fails path (a); an organization move uses the acting person's session and cancels on that person's reset; an attestation for an identity the source still serves as active is not adopted; a JWKS `kid` absent on refetch blocks adoption; a differing attested record below the pin is equivocation; a record whose `to.identity` disagrees with the destination directory is not adopted; an index conflict is contested; no pending successor is offered while the source serves the identity actively with `portability.v1`; delegation status answers `revoked` and is never redirected; dot-segment and encoded-slash paths are not redirected; the commit and later cleanup emit no `subject-deleted`; public surfaces after the period answer the uniform 404.
- **Recovery-credential age (P14):** a current credential issued less than 7 days before authorization is refused on both paths; a credential that can only resume an in-progress recovery is refused.
- **Attestation-key continuity (P16):** a key whose `continuity` signature fails, or names an unlisted key, is untrusted; a key chained from a pinned key is accepted and pinned; a JWKS with a new root and no pinned key is an attestation reset, and its records are not adopted automatically but may be offered as pending successors; first-use pinning sets `attestation_first_use`; a preconfigured root is never pinned on first use; a lapsed-domain fork (old key, new attestation root, directory answering moved) is refused by a verifier holding the old pin.
- **Rotation at activation (§7.1):** the continuity statement is signed by the old key and names the new key; the retired key stays listed with `created` and `retired`; a link whose exact record was stored before the rotation verifies under the retired key, and so does a delivery through it; a bearer minted from such a link is signed by the current key; a signature by the retired key over claims with no record made before the rotation fails, even with an earlier `iat`; a move statement or participation statement signed by the retired key fails; revoking the retired key ends verification of its recorded links.
- **Size (§4, §5.3, §7):** a 16-move chain where every destination rotates at activation, with 252-character origins and 512-character identity URIs, is adopted. A 17th record, a 513-character identity URI, a non-ASCII or lone-surrogate `kid`, a statement above 3,072 bytes, an attestation above 2,560 bytes, a moved document above 152,576 bytes and a document without `moves` above 32,768 bytes are each refused. A document without `moves` that lists 16 own keys is published. A destination refuses an intake whose largest possible document exceeds the budget or 64 keys, and it reserves, imports and signs nothing for it. The 16th move of a rotating chain activates with every statement signer still listed. A host refuses a rotation that would remove a chain key. It keeps own keys beyond 16 while its document fits, and refuses the rotation that would not fit.
- **Destination:** a reused `sub` is refused; a package with a recovery credential, certification key or unknown member is refused; mismatched key material is refused; no activation before attestation or an explicit unattested decision; `aep` above the attested floor; fresh certification keys.

## 13. Core amendments — proposed (unsigned)

| ID | Document | Change |
| --- | --- | --- |
| AMD-P1 | protocol §1, §6 | Replace "Domain/key continuity and cross-provider identity migration remain a future specification; a v0 export MUST NOT imply portable identity" with a pointer to this document: an export alone still implies no portable identity, and grants and tokens issued to applications still never migrate. Remove "provider migration" from the §6 out-of-scope list. |
| AMD-P2 | protocol §2 | Add the `portability.v1` feature row (§3). |
| AMD-P3 | auth, "Identity and discovery" | Clients key identities by origin principal (§8.1), which equals issuer plus subject until a verified move. Add the `identity_moved` result and the optional `bindle_origin`/`bindle_moves` token-response members (§11). "Account merge and identity migration are explicitly outside v0" points here for migration; merge stays out of scope. |
| AMD-P4 | organizations §3, §3a, §5.2, §5.2a, §5.3, §9.5 (owned by the organizations author) | §3's portability bullet is satisfied by §6 here. §3a.1 adds §8.8. §3a.3 adds `moves`, the §7 byte budget (152,576 bytes; 32,768 bytes without `moves`) and the cross-host no-rollback rule (§7), and its no-redirect fetch rule gains the §10 hint exception. §5.2 step 1 and §9.5 look up the successor index (§8.2). §5.2a lists move adoption as an authority reset. §5.3 stores members by origin principal. Certification keys are re-established at the destination as in §7. |
| AMD-P5 | link envelope §3.2 (formerly links §3.2); [keys §4](../keys.md#4-signature-domains) (formerly links §7.2) | Imported links at redirected URLs (§11). Signature-domain rows for `bindle-identity-move+jwt` (identity signing key) and `bindle-move-attestation+jwt` (provider attestation key, never an identity key). The former links §7.3 part (audiences resolved through the successor index) is void: audiences are withdrawn (contacts spike CL-3). |
| AMD-P6 | recovery identity, "Return, compromise and missing state" | A recovery file is never transfer authority by itself (§6.1). "Another provider cannot claim the original provider's name namespace without an authenticated migration protocol" becomes "names never move; identities move under identity portability". |
| AMD-P7 | identity names, "Rollback and deletion" | A moved identity's names stay claimed forever, as for deletion. They resolve to a redirect only during the source's redirect period. |
| AMD-P8 | Bindle Messaging §3.3; contact delivery | Receivers key peers by origin principal. An author whose `(issuer, subject)` is unknown, and whose identity document carries `moves`, is verified under §8.6 before it is matched to an existing peer. |
| AMD-P9 | app removal §8 (AR-9) | Already proposed there: no `subject-deleted` for a move, its redirect end or later cleanup. §6.3 here adopts it. |
| AMD-P10 | organizations §3a.3 (owned by the organizations author) | Signing keys gain an OPTIONAL `retired` member (Unix seconds), required with `created` for keys in a moved identity's key history (§7.1). "`retired` keys verify only artifacts that the issuer itself stores and re-serves" gains §7.1's second case: artefacts the verifier recorded, or that are anchored, before the retirement. |
| AMD-P11 | link envelope §3.2, §3.3 (formerly links); contact endpoints and contact delivery (withdrawn with contact links) | "`kid` MUST identify an active key" becomes: an active key, or a retired key of the link subject when the exact stored header and claims were recorded before that key's retirement (§7.1). Contact-delivery bearers are signed with the subject's current key, not the parent link's `kid`. |
