# Identity portability: provider-signed moves, successor pins and background migration — normative draft

> **Group:** Bindle extension
>
> **Status:** design candidate, revision 4; provisional except the owner-approved points listed below; not implemented (the local code implements revision 3.3 behind default-off flags); pending extensions revision 3 (CR-X3-14).
>
> **Covers:** cooperative identity moves between providers: the provider-signed move record and move acceptance, provider transfer keys, successor pins, redirects from the source, and the background migration of an identity's data.
>
> **Does not cover:** key discovery ([Organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1)); signed-object rules ([keys](../keys.md)); recovery files and how a provider checks a recovery credential (3sln.me: [recovery identity](../../3sln/accounts/recovery-identity.md), [recovery file](../../3sln/accounts/recovery-file.md)); an exit from a defunct or hostile provider (none in this version).

> **Pending [extensions revision 3](../extensions.md) (draft, unsigned, 2026-10-27).** Where this document relies on the `portability.v1` and `directory.v1` features, extensions revision 3.3 and protocol §2–§4 govern instead. Change request CR-X3-14, [extensions Appendix A](../extensions.md#appendix-a-migration-and-impact-change-requests-not-applied).

Status: **design candidate, 2026-10-28, revision 4.** Revision 4 is rewritten in place under the pre-release rule, with no frozen copy of revision 3.3 (owner-approved 2026-10-28; DEVLOG "2026-10-28 — Owner direction: no versioning churn before release"). It carries out the [recovery and transfer spike](../../architecture/recovery-and-transfer-spike.md) §3, §5 and §6.1.

**Owner-approved** (Reviewer: owner; Date: 2026-10-28; Outcome: approved with modifications; DEVLOG "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer"):

- option C: a recovery file is an opaque credential that holds no keys, and the identity signing key stays in provider custody, rotating with continuity and never exported (§1, AMD-P6);
- a move needs the source's cooperation, and the move record names no user key (owner modification; §1, §4);
- a background migration of settings and data from the source to the destination exists (owner modification; §9);
- withdrawal of the portable identity package, transfer-in from recovery files, unattested moves, rotation at every recovery issuance (P15) and retired-key honouring of imported links (P11), and removal of the identity encryption key (§14);
- applications learn of a move only on their next contact (spike Q12, §11), and pin at account link (Q14, adapted to provider transfer keys and provisional until Q16).

**Provisional (coordinator), unsigned:** every format and rule that carries out those points. That is the two-signature design with a mandatory destination acceptance (spike Q15), transfer keys with reduced continuity (Q16), the move-endpoint exchange, the verifier rules, publication, and all of §9 (Q17–Q19, Q22–Q26). The 90-day free redirect window and the US$10 extension (Q13, approved) are 3sln.me policy, not requirements here.

Implementation: the local code (`packages/identity/succession.mjs`, `transfer-out.mjs`, `transfer-in.mjs`, `attestation-keys.mjs`, `successors.mjs`, `packages/runtime/routes/moved.mjs`, and the descriptor `docs/artefacts/extensions/portability-v1.json`) implements revision 3.3 behind default-off flags. It does not implement revision 4. Spike phase 2 deletes the package and transfer-in paths and renames attestation keys to transfer keys; phases 3 and 3b build the record, the acceptance, verifier adoption and the migration channel. External-provider interoperability is not established. Not signed off or published. Rationale, threat model and the 3sln.me rules: the spike and the [identity portability design](../../architecture/identity-portability.md) (the parts the spike supersedes are listed in its §6.1). Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements. §13 lists the core amendments this draft needs. They are **proposed and unsigned**, except where marked applied.

Protocol/security/interop sign-off (provisional parts): reviewer ___ / date ___ / outcome ___.

This document extends [protocol](../protocol.md), [auth](../auth.md), the `directory.v1` profile in [organizations §3a](organizations.md#3a-identity-documents-and-key-discovery-directoryv1), the [Organizations link envelope](organizations-link-envelope.md) and [Parlay](messaging.md). It replaces the sentence of protocol §1 that leaves "domain/key continuity and cross-provider identity migration" to a future specification. It defines interoperability rules only. How a provider authenticates its users, checks a recovery credential, presents a move, what it charges, and how long it redirects and keeps data are provider policy, except where a rule below bounds them.

## 1. Model

An identity is a stable UUID `sub` created at one provider. Handles are aliases in a provider's namespace and never move. The identity's keys are custodied by the provider that hosts it. **No recovery file, export or other artefact carries an identity's private key** (option C, owner-approved). A recovery credential works only at the provider that issued it, and it is never transfer authority by itself (§6.1).

A **move** changes the provider that hosts an identity. The `sub` is unchanged. The destination generates fresh identity signing and certification keys (§7.1), and the identity is reachable there under a new identity URI. A move is **cooperative**: it exists only if the source signs it. It is proven by two provider signatures and never by a user key:

- a **move acceptance**, signed by the destination's transfer key before commit, which says the destination will host this identity (§5.3); and
- a **move record**, signed by the source's transfer key at commit, which says the identity moved, with its current holder's authority, to the destination that accepted it with the key named `dest_key` (§4).

Neither signature alone is authority. The record names no user key, so key rotations at the source or the destination never affect it.

**Trust assumption.** A source is fully trusted for the identities it hosts until a move commits: it custodies their keys and could always impersonate them. A malicious or compromised source can therefore move its own identities to an accomplice destination that signs the acceptance. No other party alone can publish a move. The source's duties (§6.1) and the authority reset at pinned verifiers (§8.3) bound this.

**No exit without the source.** When the source is defunct or hostile, there is no move. The user starts a new identity elsewhere and counterparts re-add it.

Verifiers keep the identity's **origin principal** as its stable identifier and pin the latest verified move as a **successor pin**. HTTP redirects from the source are routing hints and never establish where an identity lives.

After commit, when the source offers it, the destination pulls the identity's data from the source in the background over the **migration channel** (§9).

## 2. Terms

| Term | Meaning |
| --- | --- |
| Origin principal | `(iss₀, sub)`, where `iss₀` is the issuer at which the identity was created. For an identity that has never moved, it is its `(iss, sub)`. It never changes. |
| Host | The provider currently hosting the identity. Its issuer is the identity's **current issuer**. |
| Source, destination | The host before and after one move. |
| Transfer key | A provider ES256 key published at `transfer_jwks_uri` that signs only move records and move acceptances (§5.1). Never an identity key. |
| Move acceptance | A JWS signed by the destination's transfer key, bound to one transfer authorization (§5.3). |
| Move record | A JWS signed by the source's transfer key at commit, naming the destination's transfer key and the acceptance's digest (§4). |
| Moves entry | `{"record","acceptance","source_key"}` as published by the host (§7). |
| Successor chain | The ordered moves entries of an identity, published by its host as `moves` (§7). |
| Successor pin | A verifier's record of the latest move it has verified for an origin principal (§8.2). |
| Transfer-key pin | A verifier's per-issuer record of trusted transfer keys (§5.1). |
| Payload digest | `sha256-` followed by the canonical unpadded base64url SHA-256 of the ASCII bytes of a JWS's **payload segment** (its second segment, as received). |
| Transfer authority | What the source verifies before it signs a record (§6.1). |
| Transfer identifier | A source-issued value of 128 random bits, base64url, that names one transfer attempt (§5.2). |
| Current recovery credential | A provider's per-identity recovery secret that would start a recovery at that provider right now. A superseded, consumed or invalidated credential is not current, and neither is a credential that can only resume a recovery already in progress. |
| Snapshot | The identity's data at the source as of commit, which the migration channel serves (§9.1). |

## 3. Feature declaration

A provider declares `"portability.v1"` in `features` ([protocol §2](../protocol.md#2-discovery-and-login)) with these members, each an HTTPS URL on the issuer origin. Endpoint kinds follow [extensions §2.4](../extensions.md) and §2.8.

| Member | Role | Kind | Meaning |
| --- | --- | --- | --- |
| `transfer_jwks_uri` | source and destination; required | public | A JWKS of the provider's ES256 transfer keys (§5.1). |
| `move_endpoint` | source; optional | audience | Runs the move exchange (§5.2). |
| `migration_endpoint` | source; optional | audience | Serves the migration channel (§9.4). A source without it offers its own export only. |

- `portability.v1` requires `directory.v1`.
- A provider without `move_endpoint` cannot be a source, so its identities cannot move under this specification. A provider that only receives identities declares `transfer_jwks_uri` alone.
- Invalid members make the feature absent under the protocol §2 processing rules.

## 4. Move record

A move record is a compact JWS under the profile of [keys §3](../keys.md#3-compact-jws-profile): strict I-JSON, exact members, received-bytes signing input and a 64-byte signature.

The protected header is exactly `{"alg":"ES256","kid":<source transfer kid>,"typ":"bindle-identity-move+jwt"}`. The payload has exactly these members:

| Member | Definition |
| --- | --- |
| `bindle` | `"identity-move"` |
| `v` | `2`. Verifiers refuse every other value. (The user-key-signed `v:1` statement of revision 3.3 is withdrawn, §14.) |
| `sub` | The identity's UUID, lowercase canonical form. Unchanged by every move. |
| `kind` | `"person"` or `"organization"`. It MUST equal the identity's kind at the source, and no move changes it. |
| `seq` | Positive safe integer: `1` for the identity's first move, and the previous record's `seq` plus one afterwards. |
| `prev` | `null` when `seq` is 1. Otherwise the payload digest of the previous record. |
| `from` | `{"iss","identity"}`: the source's issuer origin and the identity URI at the source. |
| `to` | `{"iss","identity"}`: the destination's issuer origin and the identity URI at the destination, which MUST be on the destination's origin. |
| `dest_key` | The RFC 7638 SHA-256 thumbprint (unpadded base64url) of the destination transfer key that signed the acceptance. |
| `accept` | The payload digest of the acceptance. |
| `aep` | The identity's authority epoch at the source at commit ([organizations §2](organizations.md#2-terms)). |
| `at` | Unix seconds of the commit. |

- `from.iss` and `to.iss` MUST differ. A move back to an earlier host is allowed, with a new identity URI and a higher `seq`.
- The record carries no user key, user key id or consent evidence. The source's signature is its statement that it verified transfer authority (§6.1).
- **No expiry.** A committed move is permanent history. Only the authorization before it (§6.2) and the redirect and migration windows after it (§9.4, §10) expire.
- **Size.** `from.identity` and `to.identity` are at most 512 characters each. The header `kid` is 1 to 128 printable ASCII characters (`!` to `~`); a verifier refuses any other `kid`, including non-ASCII characters, controls and lone surrogates. The compact record is at most 3,072 bytes. A verifier refuses a longer record before checking its signature, and a signer never produces one.
- **Sameness.** Two records with byte-identical payload segments are the same record, whatever their signatures (§5.1, re-signing). Every digest in this specification is a payload digest.

## 5. Transfer keys, the move endpoint and the acceptance

### 5.1 Transfer keys

Transfer keys are provider keys published at `transfer_jwks_uri`. Every key carries `kid`, `use:"sig"` and `alg:"ES256"`. They sign only `bindle-identity-move+jwt` and `bindle-move-acceptance+jwt`, separated by `typ` ([keys §4](../keys.md#4-signature-domains)).

- **Listing.** A provider MUST keep listing every transfer key that signed a record or an acceptance for as long as it operates, including after it stops using the key. A compromised key is removed from the set, and the provider SHOULD tell the counterpart providers of the moves it signed. A provider SHOULD rotate its signing transfer key at least yearly.
- **Continuity (reduced P16).** Every transfer key except the provider's first carries `"continuity":{"kid":<earlier kid>,"sig":<base64url>}`. `sig` is a 64-byte ES256 signature by the listed key `kid` over the ASCII bytes of `bindle-transfer-key-continuity-v1.` followed by the new key's RFC 7638 SHA-256 thumbprint (unpadded base64url). The signing key MUST be listed when the new key is introduced. A provider that loses every transfer private key must start a new root, which verifiers treat as a transfer-key reset (below).
- **Pinning.** A verifier keeps a transfer-key pin per issuer, storing each trusted key's thumbprint **and public JWK**. It creates the pin the first time it pins any identity of that issuer, and an application creates it at account link. On that first fetch it pins every listed key whose `continuity` is absent or verifies against another listed key. Later, a key is **trusted** when it is pinned, or chains by continuity to a pinned key that is still listed or whose public JWK the verifier holds; trusted keys are added to the pin. A listed set in which no key is trusted is a **transfer-key reset**: nothing it signs is adopted automatically (§8.5), existing pins and adoptions are kept, and the verifier SHOULD alert its operators. A verifier MAY be configured with root thumbprints in advance (for example an SDK shipping its home provider's root), and then never pins that issuer on first use.
- **Fetching and revocation.** The JWKS is fetched under the protocol §2 manifest rules. A verifier MAY keep pinned public JWKs to verify records it has already adopted and to check chains after the issuer is gone. Before an **automatic adoption** (§8.3, §8.6) while the issuer is reachable, it MUST use a JWKS fetched within the last hour, and a `kid` absent from a successful fetch is revoked: what it signs is not adopted automatically, and a pin adopted under it is kept but flagged for review (IP-R1-M3).
- **Re-signing.** A provider that rotates away from a compromised key MAY re-sign its committed records or acceptances with byte-identical payloads under a new key. A re-signed record or acceptance is the same object (§4, "Sameness"), not equivocation, and digests still link.

### 5.2 The move endpoint

The destination sends `POST <move_endpoint>` with `Content-Type: application/json` and exactly this body:

```
{"v":2, "sub":"<uuid>", "to":{"iss","identity"}, "transfer":<string|null>,
 "acceptance":<JWS|null>, "redirect_base":"<URL>", "migration_jkt":<thumbprint|null>}
```

- `transfer` is the transfer identifier from an earlier `202`, or `null` to start.
- `acceptance` is a move acceptance bound to `transfer` (§5.3), or `null`.
- `redirect_base` is an HTTPS URL on the origin of `to.iss`, without query, fragment, userinfo, dot segments or percent-encoded `/`, `\` or `.`, whose path ends in `/`. It MUST be unique to this source at the destination, so that the destination can tell which original origin to reconstruct (§10). The source uses it only to build redirects (IP-R1-L2).
- `migration_jkt` is the RFC 7638 SHA-256 thumbprint of a P-256 public key that the destination generated for this move's migration channel (§9.4), or `null` when the destination will not pull data. It is neither a transfer key nor an identity key.

The request carries no credentials. The source acts only on an authorization it already holds (§6.1).

**Exchange.**

1. **Start.** The user at the destination names their account at the source. The destination posts with `transfer` and `acceptance` null. The source answers `202` with a fresh transfer identifier and an `authorize_url`, identically whether or not the identity exists.
2. **Authorize.** The destination sends the user to `authorize_url` by top-level navigation. The user establishes transfer authority on source pages (§6.1). This binds the transfer identifier to the identity, to exactly the destination origin the user confirmed, and to the kinds the user consented to migrate (§9.3).
3. **Accept.** The destination repeats the POST with `transfer` and an acceptance. The source verifies the acceptance under a key from the destination's live `transfer_jwks_uri` (fetched from the destination's manifest within the last hour). It checks that the acceptance's claims equal the authorization and the source's own records: `sub`, `kind`, `seq` (the source's next `seq`), `from` (the source's own issuer and identity URI), `to.iss` (the confirmed origin) and `transfer`. It then stores the acceptance's payload digest and `dest_key`. Until commit it answers `202` with `estimate` (§9.3). A new acceptance for the same `transfer` replaces the stored one only before commit and only from the same destination origin.
4. **Commit.** When the source's own conditions are met (for example a delay that a dispute can hold), it commits (§6.3) and signs the record. The next POST returns `200`.

**Responses.**

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{"status":"moved","record":"<JWS>","acceptance":"<JWS>","redirect_until":<unix seconds or null>,"migration":{"endpoint":"<URL>","token":"<string>","until":<unix seconds>}\|null}` | The move has committed (§6.3). `migration` is `null` when the source has no `migration_endpoint`, when `migration_jkt` was `null`, or when the user consented to no kinds. |
| 202 | `{"status":"pending","authorize_url":"<URL>","transfer":"<id>","retry_after":<seconds>,"estimate":[…]}` | Not yet committed. `authorize_url` is on the source's origin (it may carry a query, but no fragment). `estimate` is present only after authorization (§9.3). The destination repeats the POST after `retry_after`. |
| 409 | `{"status":"refused"}` | Uniform for every other outcome: unknown, suspended or ended identity; an invalid acceptance; a cancelled or expired transfer; a move already committed to another destination; a policy refusal. |
| 429, 503 | — | Retryable, with `Retry-After`. |

**Binding (IP-R1-H3).** The first request that the source accepts with an acceptance binds `redirect_base`, `migration_jkt` and the destination origin to the transfer identifier. A later request for that identifier with a different value of any of them is `refused`. A start creates no state that blocks anything: any number of transfer identifiers may be unauthorized. Once an authorization exists for the identity, no other transfer identifier can be authorized for it, and an acceptance under another identifier is `refused`.

**Idempotency.** Repeating a request returns the current status. After commit, a request with the committed transfer identifier returns the same `200` body, except a fresh `migration.token` (§9.4), for as long as the source keeps a redirect record, and at least 30 days, so that a lost response never strands a committed move (IP-R1-L4).

### 5.3 Move acceptance

The destination signs an acceptance only after the user's authorization exists at the source (it holds a transfer identifier that the source answered with an `estimate`), its preflight passes (§9.3), and its checks pass:

- it does not host, and has not hosted, an identity with this `sub`, unless its own records or the identity's verified chain show that this identity previously moved out of it, and the `sub` is not an origin principal of a different identity it knows (IP-R1-M5);
- `from.identity` and `to.identity` are within 512 characters, and the identity's document at the destination after this move fits the §7 budget and 64 keys.

The protected header is exactly `{"alg":"ES256","kid":<destination transfer kid>,"typ":"bindle-move-acceptance+jwt"}`. The payload has exactly:

| Member | Definition |
| --- | --- |
| `bindle` | `"move-acceptance"` |
| `v` | `1` |
| `sub`, `kind`, `seq`, `from`, `to` | As in §4. They MUST equal the record's. |
| `transfer` | The transfer identifier this acceptance is bound to. |
| `iat` | Unix seconds. |

The compact acceptance is at most 2,560 bytes, and its `kid` follows the §4 rule. A verifier refuses a longer acceptance, and a destination never signs one. An acceptance is inert without a record that names its digest.

## 6. Transfer authority and commit

### 6.1 What the source must verify

A source MUST NOT sign a move record unless every one of these holds. Items 2, 3 and 5 are established when the user authorizes the transfer. At commit, the source re-checks item 1, that the authorization is neither expired nor cancelled, that the credential of item 2 is still current, and that no authority reset of the identity happened since.

1. **Acceptance and binding.** The stored acceptance verifies under §5.2 step 3. `to.iss` and `redirect_base` are on exactly the destination origin the user confirmed under item 5. The identity is active, not suspended, deleting or deleted, and no other move of this identity is pending or committed at this source.
2. **Current recovery credential.** The identity's current recovery credential was presented to the source in this transfer, on a source page, or the source holds an equivalent current per-identity secret if it issues no recovery files. A superseded, consumed or invalidated credential never qualifies. Nor does a credential issued less than **7 days** before the transfer was authorized (design P14): issuing a new credential usually needs only a signed-in session, so a fresh credential adds nothing against a hijacked session. How the credential is presented is provider policy, but it is presented only to the source, never to the destination. (3sln.me presents it by a proof-only presentation of the recovery file, in which the credential stays on the device; spike §4.5, Q29, provisional.)
3. **Current control.** Exactly one of:
   - **(a) Session path.** A fresh authenticated session of the identity at the source, with user verification (a step-up) no older than 10 minutes when the user confirmed the transfer. A session whose authority derives from an authority reset of the identity (a recovery, a credential reset or a key reset) completed less than 7 days earlier does not satisfy this path, so a stolen recovery file cannot recover the account and then satisfy (a) at once. Nor does a step-up performed with a credential enrolled less than 7 days earlier, or a session of an identity whose contact channels changed in that time (IP-R1-M1). When the user confirms, the source MUST send notice of the pending move, naming the destination's origin, to every current contact channel and every active session before it commits.
   - **(b) Waiting-period path.** A public waiting period of at least 7 days. It cannot start while an authority reset of the identity, or a change of its contact channels, completed less than 7 days earlier; a recovery-derived controller therefore waits at least 14 days in all (IP-R1-H1). It starts only once the source has sent notice of the pending move, naming the destination's origin, to every current contact channel and every active session of the identity, and to every contact channel removed or replaced in the preceding 30 days. Each notice carries a cancellation capability that works without signing in. Any fresh authentication as the identity during the period can cancel the move. Any authority reset, credential enrolment or contact-channel change during the period cancels it.
   - For an identity of kind `organization`, which has no sessions of its own (organizations §3), "the identity's session" in (a) means the session of the person exercising item 4, and the 7-day exclusions apply to authority resets of that person **and** of the organization. In (b), notices go to every person holding owner-interface authority over the organization, and at least the persons holding transfer authority under item 4 can cancel.
4. **Organizations.** For an identity of kind `organization`, additionally: current authority to transfer the organization under the provider's disclosed membership and grant policy ([organizations §6.3](organizations.md#63-owner-interface)), exercised by a person authenticated with their own identity. Authority obtained through organization recovery does not count until that recovery has taken effect under the same policy. The organization's own recovery credential satisfies item 2, not this item.
5. **Destination shown.** The user confirmed the move on a source page that named the destination by its origin, highlighting its registrable domain, and stated that the source will stop speaking for the identity. When the source declares `migration_endpoint`, the page also listed the data kinds the destination will be able to copy, with their sizes, and let the user deselect kinds (§9.3).

How the source collects these is provider policy. It MAY require more, such as longer waiting periods, extra notices, a delay before commit that a dispute can hold, or mutual exclusion with other account changes. (3sln.me: design §6.1a and §6.2, and spike §4.2.)

### 6.2 Cancellation and expiry

A transfer authorization expires if the source has not committed within a bound it chooses (at most 7 days after authorization on path (a)). An acceptance is useful only while its authorization lasts. Cancellation and expiry discard the authorization and the stored acceptance, and the source then answers `refused` for the transfer identifier.

Cancellation and commit are serialized in the identity's single writer: a cancellation that commits first wins, and a commit re-checks that no cancellation, reset or channel change exists. The cancelling page MUST offer to invalidate the presented recovery credential (issuing a new recovery file), because whoever started the move holds the current credential and could otherwise start again at once (IP-R1-M2). Repeated starts with the same credential after a cancellation SHOULD be refused until the owner has chosen.

### 6.3 Commit at the source

Signing the record is one atomic commit at the source. In it, the source MUST:

- record the move and stop treating the identity as active: it issues no certificate, signs nothing new for the identity, and accepts no authorization or token request for it;
- fix the identity's data as the migration snapshot (§9.1) and, when `migration` will be returned, issue the migration token (§9.4);
- mark every certification key (`use:"cert"`) of the identity `revoked`;
- revoke every session, client session, refresh token and access token of the identity. Grants and tokens never migrate (protocol §1);
- revoke every key delegation it certified for the identity (for example [Bindle Messaging §3.2](messaging.md)), so that delegation status answers `revoked` from the source itself (§10);
- conclude every open app removal as forced and sever every connection, with terminal `connection-revoked`. It MUST NOT emit `subject-deleted` ([app removal §8](app-removal.md), AR-9), at commit, at the end of the redirect or migration window, or in any later cleanup. A moved identity is not deleted, and apps keep its state;
- destroy its custody copies of the identity's private keys, so that it can sign nothing for the identity afterwards;
- refuse every later recovery, credential reset or reactivation of the identity;
- never sign another record for this identity. Only the current host can sign the next one.

After the commit, the source answers for the identity only as §9 and §10 describe. Surfaces reachable without the owner's own authenticated session answer either with the §10 redirect (while the source keeps a redirect record) or exactly as for a deleted identity under [app removal §8.5](app-removal.md) (RR1-R1): the uniform 404 for lookups and the invalid-credential refusal for per-identity credentials. A distinguishable `410 identity_moved` is permitted only on the owner's own authenticated surfaces, such as an export console. The source MAY keep the account's data for an export period under its own policy (§9.7), but nothing in that period lets it speak for the identity. It SHOULD notify the identity's channels that the move completed.

## 7. Identity documents for moved identities

This section extends the identity document of organizations §3a.3.

- The host of an identity that has moved at least once MUST include `moves`: an array of moves entries in ascending `seq`, starting at `seq` 1, each exactly `{"record":"<JWS>","acceptance":"<JWS>","source_key":<JWK>}`. The origin issuer is the `from.iss` of the first record.
- The last record's `to` MUST equal the document's own `iss` and identity URI.
- `source_key` is the public JWK of the source transfer key that signed the record: exactly `kty`, `crv`, `x`, `y`, `kid`, `use` and `alg`, at most 512 bytes serialized. A verifier uses it only when its thumbprint matches a key in its transfer-key pin or in a live fetch of the source's JWKS ([keys §3](../keys.md#3-compact-jws-profile) item 5). It lets pinned verifiers check a record after the source has shut down.
- At most 16 entries. An identity that would exceed 16 moves cannot move again under this version.
- The host lists no signing key of an earlier host (§7.1). The no-rollback rule of organizations §3a.4 applies to the host's own keys.
- Certification keys (`use:"cert"`) are the destination's own fresh keys. A destination MUST NOT reuse a certification key of an earlier host.
- Certificates that the destination issues carry an `aep` strictly greater than the last record's `aep`.

**Size.**

- Each move adds one entry: a record of at most 3,072 bytes (§4), an acceptance of at most 2,560 bytes (§5.3), a `source_key` of at most 512 bytes, and 96 bytes of JSON framing. That is 6,240 bytes per move.
- The current host's own members get a base of 32,768 bytes: the non-`moves` members, its certification keys and the signing keys of its own history. A document without `moves` has the same bound (organizations §3a.3).
- The budget is 32,768 + 16 × 6,240 = **132,608 bytes**. A document lists at most 64 keys.
- A verifier MUST refuse a document above the budget, an entry above its caps, or more than 16 entries. The fetch bound is the budget.
- A host MUST NOT publish a document that a verifier would refuse. A destination therefore refuses to sign an acceptance (§5.3) when the identity's document after this move could exceed the budget or 64 keys, and a host refuses a key rotation that would exceed either bound.

**Activation.** A destination MUST NOT serve the identity as active, issue certificates or sign artefacts for it until it holds the source's record for this move, verified under §8.3 items 1 and 3 against its own acceptance.

### 7.1 Identity keys at the destination

- At activation, the destination generates a fresh identity signing key. It is the first key of the identity's history at this host: it has no predecessor and no continuity statement. Later rotations follow organizations §3a.4 at this host.
- A destination never receives, imports or lists a private or public signing key of an earlier host. No user-held key is involved in a move.
- Verifiers accept the fresh key because the source's record and the destination's acceptance both name this move. Adoption replaces the verifier's identity-key pin with the destination document's active signing key (§8.3). It is a provider-attested key reset, not a continuity link.
- Artefacts signed by an earlier host's identity or certification keys stop verifying at adoption. In particular, links issued at the source do not verify at the destination, and the destination imports none: the host re-issues what it needs (P11 withdrawn, §14).

## 8. Verifier rules

### 8.1 Stable identifier

Verifiers MUST key every relationship with an identity (memberships, relation edges, peer records, app accounts) by its **origin principal**. For an identity that has never moved, that is its `(iss, sub)`, so existing records need no change.

A verifier that receives an artefact whose `(iss, sub)` is not an origin principal it knows looks the pair up in its successor index (§8.2). A pair that maps to an origin principal is that identity. A pair that maps to nothing is an identity the verifier does not know.

### 8.2 Successor pins

Per origin principal, a verifier that relies on the identity over time keeps:

- the current issuer and identity URI;
- the highest `seq` verified and the payload digest of that record (the chain head);
- the identity-key pin and the retired, revoked and superseded kids of organizations §3a.4, for the current host only;
- the highest `aep` accepted.

It also keeps a transfer-key pin per issuer (§5.1), shared by every identity of that issuer, and an index from each `(current issuer, sub)` it has adopted to the origin principal. Certificates and fresh signatures verify only under the identity document at the pinned current identity URI. **An artefact whose `iss` is an earlier host of the identity fails**, because that host no longer speaks for it.

**Index conflicts (IP-R1-M5).** `sub` values are chosen by issuers, so a hostile issuer can mint an identity under another identity's `sub`. A move whose `(to.iss, sub)` is already an origin principal the verifier knows, or already maps to a different origin principal, is not adopted; the verifier treats both identities as contested under §8.4. A destination likewise keys hosted identities by origin principal (§5.3).

**State bounds.** Per origin principal the pin is constant-size plus at most 16 index entries (§7). A verifier MAY drop the pin and index of an identity with which it no longer holds any relationship.

### 8.3 Adopting a move

A verifier with a successor pin for the origin principal adopts a moves entry automatically only when all of the following hold:

1. **Source signature.** The record's header and payload are exact (§4), and its `kid` resolves to a source transfer key that is trusted under §5.1 for `from.iss`. If the only path to trust is a first fetch of that issuer's JWKS during this verification, the result carries `source_unanchored: true`.
2. **Linkage.** `from` equals the pinned current issuer and identity URI. `seq` equals the pinned `seq` plus one, and `prev` equals the pinned chain head (`null` for `seq` 1). `sub` and `kind` are unchanged.
3. **Destination signature.** The acceptance's header and payload are exact (§5.3), and it verifies under a key from `to.iss`'s live `transfer_jwks_uri` **whose thumbprint equals `dest_key`**. Its `sub`, `kind`, `seq`, `from` and `to` equal the record's, and `accept` equals its payload digest.
4. **Destination agrees.** The destination's manifest meets the protocol §2 conformance floor and declares `directory.v1` and `portability.v1`. Its directory `?sub=` lookup returns exactly `to.identity` (organizations §3a.1, R2-H2; IP-R1-M4). The identity document there has matching `iss` and `sub`, a `moves` array whose last entry carries this record and acceptance (byte-identical payload segments), and an active signing key.
5. **The source has let go (IP-R1-H2).** The source does not serve the identity as active: its directory `?sub=` lookup answers with the §10 redirect or moved body carrying this record (byte-identical payload segment), or with 404. A `200` that still lists the identity as hosted there means the record was not produced by a committed move, and it is not adopted automatically. A `200` naming a different identity URI at the source counts as let go only when a later record of the chain being verified moves the identity to exactly that URI (a return, §4). An unreachable source is `temporarily_unavailable`; after 7 days of failed attempts the verifier MAY treat the source as gone for this item.

**Effects.** On adoption the verifier atomically:

- updates the successor pin (`seq`, chain head, current issuer and identity URI);
- maps `(to.iss, sub)` to the origin principal;
- **replaces the identity-key pin** with the destination document's active signing key (§7.1);
- stops accepting the earlier host's identity and certification keys;
- raises its `aep` floor to the record's `aep`;
- pins the destination's transfer keys if it has no pin for that issuer.

Adoption is an **authority reset** in the sense of organizations §5.2a, so owner-interface authority is held until re-confirmed. Records are applied in `seq` order. A verifier more than one move behind applies each entry in turn.

### 8.4 Equivocation and replay

- An entry whose `seq` is at or below the pinned `seq` and whose record has the same payload segment as a record already verified is a replay, and is ignored. This holds for a re-signed record too (§5.1).
- A record with a valid source signature whose payload segment differs from one already verified at the same `seq`, whether it arrives before or after adoption, is **equivocation** (IP-R1-M6). So are two such records for one origin principal and `seq`. The verifier MUST NOT adopt either, MUST keep the pin, MUST treat the identity as contested (no owner-interface authority, no new relationships) and SHOULD report it to its operators. Resolution is a human decision under §8.5.
- A record whose signature does not verify is ignored.

### 8.5 Records that do not verify

A moves entry that fails §8.3 for a reason other than unavailability, including a record signed by an untrusted transfer key (a transfer-key reset, §5.1), MUST NOT be adopted automatically.

A verifier MAY let the human who owns the relationship (an organization's operators, a peer's owner) link the two identities by an explicit local act. It MUST NOT offer this while the pinned host serves the identity as active with the pinned key. The §8.3 item 4 directory check applies. Before the act the verifier MUST show:

- that the move could not be verified;
- the old and new hosts by origin;
- whether the old host still serves the identity as active.

The act has the effects of §8.3, including the authority reset and the replacement of the identity-key pin.

### 8.6 First contact with a moved identity

A verifier meeting an identity for the first time at its current host verifies the whole successor chain from the origin:

- Each entry must pass §8.3 items 1–3, read against the previous entry instead of a pin (item 2 for the first entry: `seq` 1 and `prev` `null`).
- A source's transfer key is anchored by the verifier's transfer-key pin, by a `source_key` whose thumbprint matches that pin, or by a live fetch of the source's JWKS. Any anchoring by a first fetch sets `source_unanchored: true` on the result.
- Each source must pass §8.3 item 5 under the same 7-day rule.
- The current document must pass §8.3 item 4 for the last entry.

If every entry verifies, the verifier keys the identity by its origin principal, pins the current document's active signing key, and pins as in §8.2. If any entry fails, or any source is both unreachable and unanchored, the verifier MUST NOT treat the identity as that origin principal. It keys it by its current `(iss, sub)` as a separate identity, shows any origin claim as unverified, and never merges the two later without a human decision (§8.5).

**Fetch budget (IP-R1-M8).** A chain can name up to 16 issuers, each needing a manifest, a transfer JWKS and a directory lookup. A verifier first checks everything it can without a fetch: record and acceptance syntax and sizes, `seq`/`prev` linkage, `from`/`to` continuity, `accept` digests, and signatures under any pinned or matching `source_key`. It verifies a chain only when the claimed origin principal matches a relationship it already holds, or when a role requires origin linking (an application linking an existing account, §11). Otherwise it keys the identity by its current `(iss, sub)` and MAY verify the chain later in the background. Fetches are under the organizations §3a.5 per-issuer and global budgets, and a chain is verified in the background, never on a request path that organizations §5.2 forbids.

**Residual.** A first-contact verifier with no pin for a source cannot tell a forged record from a real one when the forger holds that source's leaked transfer key after the source is gone, or controls the source's lapsed domain and publishes a new root (which sets `source_unanchored`). Verifiers that pinned the source's transfer keys detect both: the lapsed domain's keys do not chain to the pin (a transfer-key reset), and a forged record breaks `from` or equivocates. Roles that link existing accounts act on `source_unanchored` (§11). A shared-pin profile or an append-only move log is the upgrade path and is not part of this version.

### 8.7 How verifiers learn of moves

- **Background refresh.** A verifier that refreshes pinned identity documents (organizations §5.2) receives the source's §10 response for a moved identity and evaluates the entry it carries or the destination document it points to.
- **Presentation.** The identity, or its host on its behalf, MAY present its `moves` through any channel a role's specification defines. Verification is identical. A role that forbids request-triggered fetches (organizations §5.2, R2-H1) verifies presented entries in the background and fails the triggering request uniformly. A verifier SHOULD check presented entries offline against its pin (linkage from the pinned head and place, and signatures under pinned transfer keys) before queuing them, and SHOULD bound its queue per origin principal with retry backoff and a drop-after limit, so that presentations naming unreachable hosts cannot starve later ones.

Neither path trusts an HTTP redirect.

### 8.8 Where identity URIs come from

Organizations §3a.1 (R2-H2) gains one source: an identity URI is also obtained from the `to.identity` of a record that the verifier has adopted under §8.3 or §8.6.

## 9. Background migration

A source that declares `migration_endpoint` serves the moved identity's data to the destination after commit. The destination pulls it in the background. Rules here are the minimum an interoperable pull needs; the internal formats of provider-specific kinds are out of scope.

### 9.1 Principles

- **Snapshot.** At commit (§6.3) the identity stops being active at the source, so its data is fixed. The snapshot is that data as of commit, and it never changes. There is no delta sync. Changes made between authorization and commit are in the snapshot.
- **One reader.** The source serves the snapshot read-only to exactly one party: the holder of the migration key named by `migration_jkt` (§9.4).
- **Consent.** The source serves only the kinds the user left selected on the §6.1 item 5 page.
- **Trust never migrates as trust.** Grants, sign-in credentials, verification states, recovery credentials, certificates and key delegations never carry over. At most they arrive as suggestions the user acts on.
- **Never served.** The channel MUST NOT carry private keys, recovery credentials, password or passkey material, session or client credentials, OAuth codes or tokens, integration credentials, or push subscription URLs.

### 9.2 Kinds

A kind is named by a registered short name below, or by an HTTPS URL for a provider-specific kind.

| Kind | Records | Destination duty |
| --- | --- | --- |
| `fragments` | Preference fragments and field values, each with its contract URL and version | Import those whose contract and version it supports, as the owner's values. Others are unsupported (§9.8). |
| `resources` | Hosted storage descriptors: logical keys, versions, content types, and each blob's `entry`, `sha256` and `size` | Import bytes through `blobs` (§9.5). Resource identifiers change, so counterparts re-consent (§11). References to external storage carry no credentials; the user reconnects the integration. |
| `lists` | Provider-held lists, contacts and sharing settings | Entries that point at other identities stay keyed by those identities' origin principals. |
| `activity` | History | Read-only import, bounded by its own retention. Nothing re-fires. |
| `notification-prefs` | Notification preferences | No push subscriptions: devices subscribe again. Undelivered notifications are not migrated. |
| `emails` | Email addresses on domains other than the source's own | Treat every address as **unverified**. An address becomes verified only by the destination's own verification, and becomes a sign-in method only by the user's own later choice. |
| `connected-apps` | Previously connected apps: client id, origin, display name, fragments held | **Reconnect suggestions only.** The destination MUST NOT create a grant or connection from them. Apps it does not know appear by origin only, unverified. |
| `pairings-summary` | The identity's signaling pairings at commit | Suggestions to pair again. A destination MAY create them as new pairings under [signaling §14.3](signaling.md#143-moves), which start pending and need its approvals. No offer or session migrates, and no pairing is live on arrival. |
| `memberships` | The person's organization memberships, by origin principal | A list only. It confers nothing: organizations treat the adoption as an authority reset (§11). |
| `org-memberships` | For an organization moving: the [organizations §13.1](organizations.md#131-portable-membership-export-interop-requirement) membership export, one record per membership | Only a destination that declares the organizations extension and supports its policy records may accept an organization's move (§9.3). Imported governance is held until re-confirmed. |

The members of each generic kind's records beyond `id` and `version` (§9.5) are **TBD** in this version. Until defined, a source documents its format, and a destination that does not recognise a record's format treats it as unsupported (§9.8).

**Never migrated:** grants and tokens; passkeys, sign-in emails and sessions; recovery credentials; handles and name certificates (the user chooses a handle at the destination before acceptance, and the source never reassigns the old one); certificates and key delegations; signaling offers and sessions, and pairings as live pairings; billing, plans and invoices; security logs, audit, lifecycle and quota state. The source SHOULD keep these available in its owner export until deletion (§9.7). State held by applications is not migrated by providers: apps reconnect and re-key by origin principal (§11).

### 9.3 Preflight, before commit

Everything that could make the destination refuse is checked while the move can still be abandoned at no cost.

- **Consent page.** The source's §6.1 item 5 page lists each kind it can serve with its record count and bytes. The user may deselect kinds.
- **Estimate.** After authorization, every `202` carries `estimate`: an array of `{"kind","contract"?,"count","bytes"}` for the selected kinds, `contract` present only for `fragments` (one item per contract URL and version).
- **Destination checks.** Before it signs the acceptance, the destination checks its quota (bytes, with headroom), the kinds and contracts it supports, the organizations extension for an organization move, its §7 budget, and its own activation requirements (for example a free handle and an enrolled sign-in method). It shows the user the estimate, the kinds it cannot import, and the migration window, and signs only once the user proceeds. Otherwise it tells the user what to change (more storage, kinds to deselect at the source, another handle).

### 9.4 The channel and its authorization

- **Endpoint.** `migration.endpoint` in the commit response MUST equal the source's declared `migration_endpoint`. The destination refuses any other value.
- **Token.** `migration.token` is an opaque access token of at least 128 bits of entropy. The source stores only its hash. It is scoped to one moved identity, read-only, limited to the consented kinds, and valid until `migration.until`. Because the source stores only hashes, a repeated `200` (§5.2, "Idempotency") carries a freshly issued token with the same binding, scope and `until`, and earlier tokens stay valid. The binding makes extra tokens useless to anyone without the migration key.
- **Sender constraint.** The token is bound to `migration_jkt` ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) `cnf.jkt`). Every request carries `Authorization: DPoP <token>` and a DPoP proof signed by the migration key, with `htm`, `htu`, `iat`, `jti` and `ath`. The source refuses a proof more than 60 s from its clock and a `jti` replayed within the window. A token without a valid proof is refused.
- **Window.** `until` is at least the end of the source's free redirect window when it has one, and never after `redirect_until`. The source SHOULD extend `until` by any period in which the channel was unavailable, extending its redirect as well if needed. (3sln.me: the free 90-day window, spike Q18.)
- **Throughput.** The channel manifest's `limits` is `{"rps","bytes_per_day"}`. A source MUST offer enough throughput to move its largest plan's quota within 30 days (spike Q24). The source answers excess with `429` and `Retry-After`, and the destination backs off with jitter and never exceeds the advertised rate.
- **Ending.** The destination ends the channel with `complete` (§9.5). The user can end it from the destination, which sends `complete` with `cancelled`. The source cannot authenticate the user directly any more: it accepts an end only over this channel, or through a chain it verifies under §8.3 or §8.6 (§10, "Ending early").
- **Errors.** An invalid, expired or ended token, and an invalid proof, give a uniform `401`. After `until` or `complete`, every request gets that `401`.

### 9.5 Wire

Every response carries `Repr-Digest: sha-256=…` ([RFC 9530](https://www.rfc-editor.org/rfc/rfc9530)) over its exact bytes, and the destination checks it before using the body. All bodies are JSON except blob bodies.

- `GET {endpoint}/manifest` returns `{"v":1,"sub","snapshot_at","until","limits","kinds":[{"kind","contract"?,"version"?,"count","bytes","pages"}],"excluded":[{"kind","reason"}]}`. `excluded` lists kinds the source holds but will not serve (deselected or never migrated).
- `GET {endpoint}/kinds/{kind}?cursor=…` returns `{"records":[…],"next":<cursor|null>}`. A URL-named kind is percent-encoded as one path segment. A page is at most 1 MiB and 500 records. Each record carries a stable source `id` and a `version`. Cursors are opaque and stable, because the snapshot is immutable.
- `GET {endpoint}/blobs/{entry}` returns the bytes, with `Range` support and exact `Content-Length`. The destination checks the SHA-256 and size that the `resources` record listed before it commits the object.
- `POST {endpoint}/complete` with `{"status":"complete"|"cancelled","kinds":[{"kind","imported","skipped","bytes"}]}` ends the channel. The source records the summary, notifies the identity's former channels where it still may, and schedules deletion (§9.7).

**Idempotency and resume.** The destination keys every imported record by `(origin principal, kind, source id, version)` and every blob by its SHA-256, so re-importing is a no-op. It persists each kind's cursor only after that page's records are durably imported, so a crash repeats at most one page.

### 9.6 Order

The destination SHOULD import in this order, so that the account is usable first and complete later:

1. activation at commit (§7): the identity, its fresh keys, its handle and its sign-in methods;
2. settings: `fragments`, `notification-prefs`, `emails`;
3. structure: `lists`, `memberships` or `org-memberships`, `connected-apps`, `pairings-summary`;
4. `resources` metadata, then blobs, smallest first;
5. `activity`;
6. `complete`.

A record that references something not yet imported is imported with a pending reference and resolved when the target arrives. A reference still unresolved at `complete` is reported as skipped.

### 9.7 Source retention and deletion

- The source keeps the snapshot until `complete` plus 7 days, or until `until`, whichever comes first. It then deletes it through its ordinary deletion procedure, never emits `subject-deleted` (AR-9), and keeps the identity's tombstone (handles retained, `sub` never reused), its redirect record and its transfer keys.
- A legal hold overrides deletion for the held data only. Held data is still served within the window.
- The source SHOULD keep its owner export available to the moved identity until deletion (spike Q26). It is the user's fallback for unsupported kinds, a hostile destination or a window that is too short.

### 9.8 Corner cases

| Case | Rule |
| --- | --- |
| Source unavailable | The destination retries with exponential backoff and jitter and resumes from its stored cursors. The move itself is unaffected. When `until` passes, the destination keeps what it has and tells the user what was not received. |
| Source stops serving | A source that returned a `migration` token MUST serve the consented snapshot until `until`. Refusing is a conformance failure. The destination tells the user and points to the source's owner export. |
| Quota exceeded at the destination | The destination pauses blob import, continues with other records, and asks the user to add storage, delete or stop. |
| Unsupported kind, contract or record format | The destination parks such records as inert opaque data, up to 10 MiB per account, and applies them if support arrives within its retention period. Beyond that it skips them and lists them to the user. It never drops a record silently. |
| A record fails import | After three failed attempts, the destination sets it aside as "could not import" with the reason and moves the cursor on. A blob whose digest or size mismatches is fetched once more from scratch, then reported. |
| User cancels | The move is not undone; going back is a new move with a higher `seq`. Cancelling sends `complete` with `cancelled`, after a warning that the source will delete the rest 7 days later. Imported data stays. |
| Another move before the migration completes | The new source SHOULD refuse to authorize an outward move while an inbound migration is incomplete, unless the user overrides after a warning that the rest of the earlier provider's data will not follow. The override sends `complete` with `cancelled` on the earlier channel. |
| Destination gone | The source ends the channel when `to.identity` has answered 404 for 30 days (§10, "Ending early"), and deletes on schedule. |
| Token or migration key leaked | The proof requirement makes the token alone useless. The destination ends the channel with `complete`. Re-issuing a token to a new key is not defined in this version. |
| Traffic to the source after commit | The identity is frozen. Per-identity requests follow the §10 redirects. |

## 10. Redirects from the source

A source MAY redirect requests for a moved identity. Whether and for how long it does so is provider policy. While it does:

- **Scope.** Only URLs whose routing at the source is determined by the moved identity: its identity URI and the subtree under it, directory lookups naming its handles or `sub`, and any other per-identity route. Never the manifest, authorization, token, revocation, RPC, intent-link, `move_endpoint` or `migration_endpoint` routes, which are host-level. Never key-delegation status routes: the source answers those itself with the final `revoked` status, because delegations it certified died at commit (§6.3).
- **Status.** `308 Permanent Redirect`, so that methods and bodies are preserved.
- **Target.** `redirect_base` from §5.2, followed by the request path without its leading `/`, followed by `?` and the request's raw query exactly as received when it has one. The destination reconstructs the original URL as `from.iss` plus that suffix. The source redirects only a request whose path, as received, matches the per-identity route without normalization, contains no dot segment, empty segment, backslash or percent-encoded `/`, `\` or `.`, and whose raw query contains only RFC 3986 query characters; any other request answers as for an unknown identity (IP-R1-L1). A source that has verified a later move of the same identity under §8.3 MAY redirect to the later host instead, but only to a `redirect_base` on that later record's `to.iss` origin that the identity itself supplied through an authenticated action, never one taken from an unauthenticated notice (IP-R1-L3). It MUST NOT redirect to its own origin.
- **Body.** An identity-document or directory request carries the JSON body `{"v":2,"iss","sub","moved":{"record","acceptance"}}`, so that a client that does not follow redirects can evaluate the move (§8.7).
- **Headers.** `Referrer-Policy: no-referrer`. `Cache-Control: no-store` for any URL carrying `bindle_meta`, `sig` or `bintent`, and otherwise at most `private, max-age=86400`; never `immutable` and never cacheable by shared caches, because a return or an early end must take effect. The redirect never varies on request headers.
- **Logs.** A source SHOULD NOT keep per-request records of redirected requests beyond its ordinary abuse controls.

**What clients do with a redirect.** A browser navigating follows it, and the destination's page names both hosts. A non-browser Bindle client treats the redirect as a hint only. It MAY follow at most three cross-origin redirects in one resolution under the SSRF rules of protocol §2, detecting cycles. It accepts what it finds only if a moves entry verifies under §8.3 or §8.6. Fetch implementations drop `Authorization` on cross-origin redirects, so a client re-sends an authorized request itself, after verification. The no-redirect rule of organizations §3a.3 is relaxed only in this way.

**After redirects end.** The source then treats the identity exactly as a deleted identity (for example the uniform 404 of organizations §3a.2). It keeps publishing its transfer keys (§5.1). Verifiers that adopted the move are unaffected. Holders of old URLs that never learned of the move lose them, unless the identity presents its chain to them (§8.7). `redirect_until` is not part of the record, so extending a redirect changes no signed object.

The source MUST NOT reassign the identity's handles or reuse its `sub` for another identity.

**Ending early.** The identity may ask the source to end its redirect at any time. The source authenticates the request as the moved identity only through a chain it verifies under §8.3 or §8.6 (for example the destination's `bindle_origin` and `bindle_moves`, §11). A source SHOULD end the redirect, and the migration channel, when the identity URI it redirects to has answered 404 for 30 days.

## 11. Effects on other specifications

- **Authorization.** The source's authorization request endpoint answers a request naming a moved identity with the error `identity_moved` and `{"to":{"iss","identity"}}` while it keeps a redirect record, and otherwise as for a deleted identity. A client MUST NOT forward the request, PKCE material, codes or tokens to the new issuer. It MAY start fresh discovery at `to.iss`, after showing both origins to the user, highlighting the registrable domain (protocol §2).
- **Applications.** Applications key their users by origin principal (§8.1). They learn of a move only on their next contact; nothing is pushed (spike Q12, owner-approved): a failed refresh followed by `identity_moved`, a `308` with the moved body, or a sign-in at the new provider. A destination MAY add `bindle_origin` (`{"iss","sub"}`) and `bindle_moves` (the `moves` array) to its token response for a moved identity. An application MUST verify them under §8.6 (or §8.3 when it holds a pin) before linking the user to an existing account, and otherwise treats the user as new. When the result carries `source_unanchored: true`, the application SHOULD also confirm ownership of the existing account through a channel it already holds (for example its own verified email for that account) before linking. An application SHOULD pin the issuer's transfer keys (§5.1) at account link (spike Q14, adapted). After linking it asks for grants again and re-pulls any state it holds for the user.
- **Links.** Links issued at the source stop verifying at adoption (§7.1). The destination imports none, and the identity's host re-issues what it needs.
- **Organizations.** Memberships and relation edges are keyed by origin principal. Member and entity certificates from a moved identity name its current issuer, and verifiers map them through the successor index (§8.2). Certificates issued by the source stop verifying when its certification keys are revoked at commit (§6.3), and the client re-acquires certificates from the destination. An organization's own move changes its identity URI; certificates must name the current identity URI as `aud`, and clients re-acquire them. An organization's membership export travels as the `org-memberships` kind (§9.2).
- **Messaging and signaling.** Receivers key peers and pairings by origin principal (AMD-P8). Delegation certificates are re-acquired under the destination's identity key.
- **Data.** An identity's data moves only through the migration channel (§9) or the provider's own export. Grants, connections it holds as grantor and resource identifiers never move. Counterparts re-consent to any resource whose identifier changed.

## 12. Conformance tests

- **Record and acceptance:** exact members and headers; a wrong `typ`; `v` other than 2 in a record; `kind` change; `from.iss` equal to `to.iss`; `seq` gaps and `prev` mismatches; an acceptance whose `sub`, `kind`, `seq`, `from` or `to` differs from the record's; an `accept` digest over another acceptance; a `dest_key` naming a key other than the acceptance's signer; a record or acceptance signed by an identity key; an unknown transfer `kid`; a record above 3,072 bytes and an acceptance above 2,560 bytes refused before signature checks; a 513-character identity URI and a non-ASCII or lone-surrogate `kid` refused.
- **Move endpoint:** a start answers `202` identically for known and unknown identities; unauthorized starts block nothing; an acceptance bound to another transfer identifier, signed by a key not in the destination's live JWKS, or naming another destination origin is refused; a request changing `redirect_base` or `migration_jkt` after binding is refused; a replacement acceptance after commit is refused; the committed `200` body is returned again for at least 30 days; uniform `refused`.
- **Transfer authority:** a superseded, consumed or invalidated recovery credential is refused; a current credential younger than 7 days is refused on both paths, and so is one that can only resume a recovery; a session within 7 days of an authority reset cannot use path (a); a step-up with a credential enrolled within 7 days fails path (a); path (b) cannot start within 7 days of a recovery, notices reach channels removed in the last 30 days, and a notice link cancels without sign-in; fresh authentication cancels the period, and a reset, enrolment or channel change during it cancels it; an organization move without transfer authority under the provider's policy is refused even with the organization's current credential, uses the acting person's session, and cancels on that person's reset.
- **Commit:** after signing, the source issues no certificate and no signature, refuses authorization requests with `identity_moved`, lists its certification keys as revoked, holds no private key copy, signs no second record, answers delegation status `revoked` without redirecting, and emits no `subject-deleted` at commit or in later cleanup.
- **Documents:** a `moves` entry with an extra member or a `source_key` above 512 bytes is refused; a document above 132,608 bytes, more than 16 entries or more than 64 keys is refused; a document without `moves` above 32,768 bytes is refused; a 16-move chain with 512-character identity URIs and records and acceptances at their caps is adopted; a destination document lists no signing key of an earlier host; a destination refuses to sign an acceptance whose resulting document could exceed the budget.
- **Transfer keys:** a key whose `continuity` fails, or names an unlisted key, is untrusted; a key chained from a pinned key is accepted and pinned; a JWKS with a new root and no pinned key is a transfer-key reset and its records are not adopted automatically; first-fetch anchoring sets `source_unanchored`; a preconfigured root is never pinned on first use; a `kid` absent on a refetch within the hour blocks adoption; a lapsed-domain fork (copied public keys plus a new root, directory answering moved) is refused by a verifier holding the old pin; a re-signed record with an identical payload is the same record.
- **Verifiers:** automatic adoption needs both signatures, the destination directory and a source that has let go; a redirect without a verifiable entry is never followed as authority; a record for an identity the source still serves as active is not adopted; equivocation on payload segments fails closed and keeps the pin; a lower-`seq` replay is ignored; adoption replaces the identity-key pin, raises the `aep` floor and holds owner-interface authority; certificates from the source fail after adoption and certificates from the destination fail before it; a record whose `to.identity` disagrees with the destination directory is not adopted; an index conflict is contested; first contact keys by origin principal only when every entry verifies; a chain with an unreachable unanchored source is keyed by current `(iss, sub)`; a three-hop chain applies in order; a cycle and a fourth redirect hop fail.
- **Redirects:** the body carries `{record, acceptance}`; target construction preserves the raw query byte for byte; host-level endpoints, including `move_endpoint` and `migration_endpoint`, are never redirected; dot-segment and encoded-slash paths are not redirected; capability URLs carry `no-store`; after the redirect period the identity answers the uniform 404 and transfer keys stay published.
- **Migration channel:** a request without a DPoP proof, with a proof by another key, a stale proof or a replayed `jti` gets the uniform `401`; a deselected kind is never served and is listed in `excluded`; the commit response's `migration.endpoint` differing from the declared `migration_endpoint` is refused by the destination; pages respect 1 MiB and 500 records and cursors are stable; a response whose `Repr-Digest` mismatches is discarded; a blob with a wrong SHA-256 or size is not committed and is retried once; a crash after a page repeats at most that page; re-import is a no-op; requests after `until` or `complete` get `401`; the snapshot is unchanged by attempts to write after commit; the source deletes at `complete` plus 7 days or at `until`, keeps its tombstone and emits no `subject-deleted`; `emails` arrive unverified; `connected-apps` create no grant; unsupported records are parked up to 10 MiB and then listed; secrets of §9.1 never appear in any page.

## 13. Core amendments — proposed (unsigned)

| ID | Document | Change |
| --- | --- | --- |
| AMD-P1 | protocol §1, §6 | Replace "Domain/key continuity and cross-provider identity migration remain a future specification; a v0 export MUST NOT imply portable identity" with a pointer to this document: an export alone still implies no portable identity, and grants and tokens issued to applications still never migrate. Remove "provider migration" from the §6 out-of-scope list. |
| AMD-P2 | protocol §2; extensions §2.8 | Add the `portability.v1` row (§3): `transfer_jwks_uri` (public, required), `move_endpoint` and `migration_endpoint` (audience, optional). Extensions §2.8's endpoint-kinds row is updated by this revision (provisional). |
| AMD-P3 | auth, "Identity and discovery" | Clients key identities by origin principal (§8.1), which equals issuer plus subject until a verified move. Add the `identity_moved` result and the optional `bindle_origin`/`bindle_moves` token-response members (§11). "Account merge and identity migration are explicitly outside v0" points here for migration; merge stays out of scope. |
| AMD-P4 | organizations §3, §3a, §5.2, §5.2a, §5.3, §9.5 | §3: recovery files hold no private keys, and the portability bullet is satisfied by §6 here (**applied by this revision**, provisional). §3a.1 adds §8.8. §3a.3: `moves` entries are `{record, acceptance, source_key}`, the budget is 132,608 bytes (32,768 without `moves`), and no signing key of an earlier host is listed (**applied**, provisional); the no-redirect fetch rule gains the §10 hint exception. §3a.4: adoption replaces the identity-key pin (**applied**, provisional). §5.2 step 1 and §9.5 look up the successor index (§8.2). §5.2a lists move adoption as an authority reset. §5.3 stores members by origin principal. Certification keys are re-established at the destination (§7). |
| AMD-P5 | [keys §4](../keys.md#4-signature-domains) | Signature-domain rows: `bindle-identity-move+jwt` (source transfer key), `bindle-move-acceptance+jwt` (destination transfer key), and DPoP proofs on the migration channel (the per-move migration key, never an identity or transfer key). The former `bindle-move-attestation+jwt` row and the link-envelope part (imported links at redirected URLs) are withdrawn. |
| AMD-P6 | recovery identity, "Return, compromise and missing state" | A recovery file holds no keys and is never transfer authority by itself (§1, §6.1). "Another provider cannot claim the original provider's name namespace without an authenticated migration protocol" becomes "names never move; identities move under identity portability". |
| AMD-P7 | identity names, "Rollback and deletion" | A moved identity's names stay claimed forever, as for deletion. They resolve to a redirect only during the source's redirect period. |
| AMD-P8 | Bindle Messaging §3.3 | Receivers key peers by origin principal. An author whose `(issuer, subject)` is unknown, and whose identity document carries `moves`, is verified under §8.3 against the receiver's pins (or §8.6 without one) before it is matched to an existing peer; a receiver with no verified chain treats the author as a new peer. |
| AMD-P9 | app removal §8 (AR-9) | Already proposed there: no `subject-deleted` for a move, its redirect or migration end, or later cleanup. §6.3 and §9.7 here adopt it. |
| AMD-P10 | organizations §3a.3 | **Withdrawn** (revision 4): no key history crosses hosts, so the `retired` member for a moved identity's key history is not needed. |
| AMD-P11 | link envelope §3.2, §3.3 | **Withdrawn** (revision 4, owner-approved with P11): retired keys of a moved identity verify nothing at the destination. |

## 14. Withdrawn in revision 4

Owner-approved withdrawals (DEVLOG "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer"):

- the portable identity package (revision 3.3 §9) and `transfer_in_endpoint`;
- transfer-in from recovery files, and any destination use of a source's recovery file;
- unattested moves, and offering unattested records as pending successors;
- key rotation at transfer-in and the honouring of retired keys for recorded issuances (P11, revision 3.3 §7.1), with the key-history listing exception;
- rotation of the identity signing key at every recovery issuance (P15) and the recovery kid binding;
- the identity encryption key.

Withdrawn as a consequence of the owner's "no user key in the move record" modification (replacements provisional):

- the user-key-signed move statement (`v:1`) and the source attestation (`bindle-move-attestation+jwt`), replaced by the record (§4) and the acceptance (§5.3);
- attestation keys, `attestation_jwks_uri` and `attestation_first_use`, replaced by transfer keys, `transfer_jwks_uri` and `source_unanchored` (§5.1, §8.6);
- revoking a chain key as a cut in the successor chain (no user key is in the chain).

The `typ` value `bindle-move-attestation+jwt` and the payload `bindle` values `identity-package` and `move-attestation` stay reserved.
