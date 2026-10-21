# Organizations, membership and inter-entity grants — normative draft (skeleton)

Status: **skeleton, 2026-10-21, revision 2.** Nothing here is implemented, published or production-verified. Revision 1 applied the resolved findings of the first independent review ([design, Review round 1](../architecture/organizations-design.md#review-round-1)); items that review left open are not resolved here. Revision 2 applies the user's clarification of 2026-10-21 ([design §1a](../architecture/organizations-design.md#1a-user-clarification-2026-10-21)). Members from any provider are core. Their requests are signed by a key their home provider certified, and the organization verifies that through a directory profile (§3a). There is no separate sign-in at the organization. This replaces the federated login of revision 1. Revision 2 was reviewed in [Review round 2](../architecture/organizations-design.md#review-round-2), and the resolved findings of that round are applied here (marked R2-…); its open items are not resolved. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements. Sections marked **TBD** are reserved and carry no requirements yet. §15 lists the core amendments this draft needs; they are **proposed and unsigned**.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This document extends [protocol](protocol.md), [auth](auth.md), [links](links.md), [extensions](extensions.md), [integrations](integrations.md) and [events](events.md). It defines interoperability rules only, with no user interface beyond the security disclosures it lists. Governance powers, templates, grouping, recovery of organizations, billing and every presentation choice are provider policy.

## 1. Model

An **organization** is an entity ([protocol §1](protocol.md#1-model-and-custody)) that is not a person. Like every entity it has:

- a stable identity `(iss, sub)` at its provider;
- identity keys;
- a resource pool, preferences, connections and grants.

Unlike a person, it has no credentials of its own. People act for it as **members**, and only within grants the organization holds for them.

This document adds no new principal type, token transport, RPC transport or authorization store. It specifies five things:

0. **Identity documents and member certificates** (§3a, §5.2). Any provider publishes read-only identity documents carrying the public keys of its identities. A member's home provider certifies a short-lived holder key, bound to one organization as audience. The organization verifies that chain and then derives authority from the member's `(iss, sub)`. A member's identity is always their home provider's identity, and same-host membership is the case where that issuer is local.
1. **Counterparty kinds for connections** (§4). A connection, the existing coupling of [integrations §1](integrations.md#1-model), may have an integration, a person or an organization as its counterparty. A **membership** is an organization's connection to a person.
2. **Grants to connections and effective authority** (§6). The authority of any actor is the live intersection of the grants along its chain. Nothing is inherited across a connection.
3. **Member context** (§7). An application obtains authority to act for a member within an organization only by presenting a member certificate that the member's home provider issued for that organization and for that application, together with a proof made by the certified key.
4. **Inter-entity grants** (§9–§11). An entity offers another entity grants. The grantee redeems the offer. The provider hosting the resource mints short-lived, sender-bound tokens that carry an actor chain.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Entity | As in protocol §1: a person or an organization. |
| Person | An entity that authenticates as itself. |
| Organization | An entity of kind `organization` (§3). |
| Owner interface | The provider's authenticated interface through which an entity's owner configures preferences, grants and connections. For a person, it is the person. For an organization, it is operated by members the organization authorizes, under provider policy (§6.3). |
| Connection | A provider-held, directional coupling from a **grantor** entity to a **counterparty**, with a state and a generation ([integrations §3](integrations.md#3-connection-lifecycle)). |
| Membership | A connection from an organization to a person (§5). |
| Member | The person counterparty of a live membership. |
| Membership ID | An opaque identifier of one membership (§5.3). |
| Home provider | A person's own provider: the issuer of their `(iss, sub)`. |
| Identity document | The read-only public document describing one identity's public keys and protocol metadata (§3a). |
| Holder key | A P-256 key pair held by the client that acts for a member. Its private key SHOULD be non-extractable. |
| Member certificate | A short-lived JWS by which a home provider certifies a holder key for one identity, one organization (the audience) and one client (§5.2). |
| Authority epoch | A non-negative integer at the home provider that increases whenever the identity's account authority is reset: recovery, a credential reset, or a key reset without continuity (§5.2a). It never decreases (review R2-M1). |
| Grantee | The counterparty of the connection a grant is attached to. |
| Imported resource | A record in a grantee's pool that refers to a resource hosted for a grantor entity (§10). |
| Actor chain | The ordered list of entities, members and clients through which a call is made (§13). |

## 3. Organization entities

- An organization's identity URI, handle and keys follow the same rules as a person's. Handles are discovery hints, never identity (auth).
- The identity document (§3a) carries `kind`, which is either `"person"` or `"organization"`. Absence means `"person"`.
- An organization MUST NOT have passwords, passkeys, email login or recovery credentials that authenticate *as* the organization at the authorization endpoint. Every interactive action for an organization is taken by an authenticated person through the owner interface (§6.3) or member context (§7).
- An organization's identity signing key MAY sign:
  - links the organization issues (links §3);
  - client assertions for inter-entity grants (§9.3);
  - key-continuity statements.

  These are all separated by `typ` or by a domain prefix, as the links §7.2 signature-domain table requires (AMD-O7).
- Organization-specific recovery is provider policy. A provider MUST NOT let a person obtain owner-interface authority over an organization through that person's own account recovery, beyond the authority the person already held.

## 3a. Identity documents and key discovery (`directory.v1`)

This section is the directory/identity-document profile that [contact delivery](contact-delivery.md#authorship-and-signatures), [links §7.3](links.md#73-verifying-the-audience-identity) and [BindleBox §3.3](bindlebox.md#33-verifying-an-author) depend on. It is specified here because organizations need it first. It MAY later move to a companion document unchanged. It is read-only discovery over keys the provider has already established. Nothing here creates, rotates or repairs keys.

### 3a.1 Declaration and naming

- A provider declares `"directory.v1": {"directory_url": "<issuer-origin URL>"}` in `features` (protocol §2).
- Each identity has an **identity URI** on the issuer origin. The reference host uses `<issuer>/identity/<sub>`. Its identity document is at `<identity URI>/identity.json`. Verifiers MUST NOT construct either URL themselves.
- **Where the identity URI comes from** (review R2-H2). A verifier obtains it only from the issuer's directory (§3a.2, by handle or by `sub`), or from its own record pinned when it first verified that `(iss, sub)` through the directory. An identity URI carried in a certificate (`identity`), a link or any other artifact is a claim: the verifier MUST check it is exactly equal to the directory-derived or pinned URI, and MUST NOT fetch it otherwise. Otherwise any path on the issuer origin that an attacker can influence (user content, a misconfigured route) could serve a forged document naming a victim's `sub`.

### 3a.2 Handle lookup

`GET <directory_url>?handle=<URI-encoded full handle>` returns `{"iss","sub","identity"}` for the stable identity currently assigned the handle. Aliases resolve to the same `sub`.

`GET <directory_url>?sub=<sub>` returns the same triple for that stable identity, so a verifier holding only `(iss, sub)` can find the identity URI without trusting an artifact (R2-H2). Subjects are unguessable UUIDs, and the result is the same uniform 404 for unknown and ended identities.

- Unknown, suspended, deleting or deleted identities return a uniform 404.
- This lookup is the existing public handle-resolution tradeoff (auth, "Identity and discovery"). Lookups are rate-limited per network and per handle.
- Organizations use the handle lookup only to bind invitations (§5.1). Request verification uses the `sub` lookup at most once per `(iss, sub)` (then the pinned URI), and never on a request path (§5.2).

### 3a.3 Identity document

`GET <identity URI>/identity.json` returns `application/json`, at most 16 KiB:

```json
{"v":1,"iss":"https://alt.example","sub":"<uuid>","kind":"person",
 "keys":[{"kid":"<kid>","use":"sig","alg":"ES256","jwk":{"kty":"EC","crv":"P-256","x":"…","y":"…"},
          "state":"active","created":1792400000,"predecessor":"<kid>|null","continuity":{…}|null}]}
```

**Contents.** The document contains **only** public identity, key and protocol metadata (DEVLOG 2026-10-13: no avatar, real name or bio). It MAY carry:

- `handle`, the canonical public handle;
- `kind` (§3);
- `keys`;
- `features`, the identity-level protocol members other specifications define, such as entity client metadata (AMD-O10).

It MUST NOT list contacts, memberships, affiliations, connections, delegations, email addresses or profile fields.

**`keys`.** The member lists signing keys (`use:"sig"`) in states `active`, `retired` or `revoked`. `created` is OPTIONAL, and a provider MAY omit keys older than the current key's continuity chain needs, because key history reveals account age and rotation habits (R2-L3). Each key carries the continuity statement of [`keys.mjs`](../../packages/identity/keys.mjs) (domain `3sln-identity-key-continuity-v1`, signed by the predecessor). Encryption keys (`use:"enc"`) MAY appear.

- At most one signing key is `active`. Only an `active` key verifies a **fresh** signature: certificates, link responses, author proofs and client assertions.
- `retired` keys verify only artifacts that the issuer itself stores and re-serves.
- `revoked` keys verify nothing.

**Unknown or ended identities.** For an unknown, suspended, deleting or deleted identity, the response is a uniform 404 with `Cache-Control: no-store`, so suspension and absence cannot be told apart.

**Fetching.**

- Responses carry credentialless CORS (`*`), never vary on cookies, and send `Referrer-Policy: no-referrer`.
- Fetches use the protocol §2 manifest rules: HTTPS, no redirects, bounded size and time, and server-side screening of private, loopback and link-local targets, with revalidation of every DNS result.

### 3a.4 Caching, continuity and revocation bounds

**Caching.**

- A verifier MAY cache an identity document for its HTTP freshness lifetime, capped at **300 s**. A 404 MAY be negatively cached for at most 60 s.
- A `kid` that the cache does not hold triggers at most one refetch per identity per minute.
- The issuer's manifest is cached as protocol §2 allows (at most 1 h).

**Pinning and continuity.**

- A verifier that relies on an identity over time (an organization for its members, a grantor for a grantee) pins the last verified signing `kid`.
- A new `active` key is accepted silently only when a valid continuity chain links it to the pinned key.
- A new key **without** continuity is a **key reset**. The verifier MAY accept it, because the trust anchor is the issuer origin, but MUST treat it as an authority-epoch change (§5.2a).
- **No rollback** (review R2-H3). Key states are monotonic (`active` → `retired` → `revoked`, never back). A verifier MUST persist, per pinned identity, the kids it has seen retired, revoked or superseded. It MUST reject, and MUST NOT treat as a key reset, a document in which such a kid is `active`, or whose `active` key is an ancestor of the pinned key. A stale cache, a CDN serving an old document, or an attacker holding an old compromised key and a path to serve the document cannot then revive that key. Such a rejection fails closed and is reported to the organization's operators.

**Revocation bound.** A key revoked or retired at the issuer stops verifying fresh signatures at every conforming verifier within **300 s + 60 s** skew. Certificates that key signed die with it, and the client re-acquires certificates under the new key.

### 3a.5 Verifying a signature from an unknown provider

A verifier that receives an artifact naming an issuer it has never contacted MUST, in this order:

1. Check everything it can check without a network fetch: the JWS profile (links §3.1 rules: exact members, received-bytes input, 64-byte signature), `typ`, `aud`, expiry, and that the claimed identity is one the verifier has a reason to evaluate. For organizations, that means a membership keyed by that `(iss, sub)` exists (§5.2). Otherwise it fails with no fetch.
2. Apply local issuer policy, such as an allowlist or denylist (provider policy), together with per-issuer and global fetch budgets. These apply before the fetch.
3. Fetch and validate the issuer's manifest against the protocol §2 conformance floor, and require `directory.v1`.
4. Fetch the identity document from the identity URI, check that `iss` and `sub` match, and select the `active` signing key named by the JWS `kid`.
5. Verify the signature.

If the issuer is unreachable, the result is a retryable `temporarily_unavailable`, never acceptance. A malformed manifest or document fails closed.

## 4. Connections and counterparties

A connection has exactly one grantor entity and one counterparty:

| Counterparty kind | Authenticated as | Created by |
| --- | --- | --- |
| `integration` | OAuth client ([integrations §3](integrations.md#3-connection-lifecycle)) | Integration installation (existing) |
| `person` | A member certificate from the person's home provider plus a holder-key proof (§5.2) | Membership acceptance (§5.1) |
| `organization` or `person` as an entity grantee | A client assertion signed by the grantee entity's key (§9.3) | Offer redemption (§9) |

Rules:

1. A connection is **directional**. Authority flows only from grantor to counterparty, and only through grants attached to it (§6). A mutual relationship is two connections, each held by its own grantor. Neither half depends on the other.
2. A connection's states, generation, suspension, disconnection and tombstone semantics are those of [integrations §3.1](integrations.md#31-states), applied to every counterparty kind. Reconnecting creates a new generation, and no earlier grant revives.
3. Either side can end its own half alone:
   - The grantor disconnects through its owner interface.
   - An entity grantee revokes its connection refresh token at the grantor's revocation endpoint ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html)). The grantor MUST then mark the connection `disconnected`.
   - A member leaves (§5.4).
4. Relationship labels such as "parent" or "supplier" are local presentation of the side that sets them. They MUST NOT affect authority, and they are not exchanged as attested data.

## 5. Membership

### 5.1 Invitation link type

An invitation is a link ([links](links.md) §1–§5, §8) of type `https://spec.bindle.example/links/org-invitation/v1`, issued by the organization's provider and signed with the organization's key.

The type-specific meta members are:

- **`invitee`** (optional): the invitee principal `{iss, sub}`, resolved by the issuing provider at issue time from a handle through the invitee's directory (§3a.2), or locally on the same host. When present, only that principal can accept.
- **`grants_digest`** (optional): the digest of the proposed grant set, so a changed proposal invalidates the link.

An invitation that proposes owner-interface authority (§6.3) MUST carry `invitee`. An unbound invitation is a bearer capability and MUST NOT confer more than member grants (review R1-H4).

The link carries no free-text title or inviter-supplied description, as in links §7.1. Display text comes from the owner host's page and is attributed to its origin.

Rules:

- Single use; `exp − iat` ≤ 30 days (**TBD**: final bound). Processing order and uniform errors follow links §8. A bound invitation opened by any other principal yields the same `invitation_invalid` result as an expired or revoked one.
- Before accepting, the owner host MUST disclose:
  - the organization's verified origin and handle;
  - what the organization will learn about the invitee (at least the principal and handle, and any profile fields the invitee chooses to share);
  - that resources the member creates in the organization's pool belong to the organization.
- Acceptance is a request authenticated as in §5.2. The certificate's audience is the organization, and its purpose list includes the acceptance purpose. Acceptance creates the membership, keyed by the certificate's exact `(iss, sub)`, in one commit together with the link's consumption. Because no membership exists yet, step 1 of §3a.5 is satisfied only by the specific live invitation that the acceptance request presents (its `bindle_meta`), when that invitation is bound to the certificate's principal or is unbound. Without the presented link, the existence of some unbound invitation never satisfies step 1, so it cannot be used to make the organization fetch arbitrary issuers (R2-L1).

### 5.2 Member authentication: certificates and signed requests

A member is identified only by their home provider's `(iss, sub)`. The organization's provider never runs a separate sign-in for members. Every member request carries proof of origin: a signature by a holder key that the member's home provider certified, for this organization, within the last few minutes. This holds equally when the home provider is the organization's own provider; in that case the issuer is local and §3a fetches are local reads.

**Certificate.** A member certificate is a compact JWS under the `key-delegation.v1` feature (AMD-O12).

The protected header is exactly `{alg:"ES256", kid:<the identity's active signing kid>, typ:"bindle-member-certificate+jwt"}`. This `typ` differs from `bindle-key-delegation+jwt`, so neither profile accepts the other's certificates.

The payload contains exactly these members:

| Member | Definition |
| --- | --- |
| `bindle` | `"member-certificate"` |
| `v` | `1` |
| `iss`, `sub` | The member's identity. `identity` is its identity URI (§3a.1). |
| `aud` | The organization's identity URI. A certificate is valid for exactly one organization. |
| `purposes` | A nonempty, unique, ascending array, drawn from `…/purposes/member-access/v1` and `…/purposes/member-accept/v1` (the latter only for §5.1). |
| `client` | `{client_id, origin}`: the client that holds the key, as verified by the home provider when it issued the certificate. |
| `cnf` | `{jkt}`: the RFC 7638 thumbprint of the holder public key, which is carried as `delegate`. |
| `aep` | The identity's current authority epoch: a non-negative safe integer that never decreases (R2-M1). |
| `jti`, `iat`, `exp` | Unix seconds. `exp − iat` MUST be at most **600 s**, and SHOULD be at most 300 s. |

Issuance rules for the home provider:

- It signs only with the identity's `active` signing key.
- It issues only while the account is active and the member's consent for (`aud`, `client`) is live.
- It issues only on the strength of an authenticated member session at the home provider, or of a client grant the member approved for this (`aud`, `client`). Either must be listed to the member, with the holder keys it has certified, and revocable by the member at any time. Revoking it makes the status of those keys `revoked` (R2-M2).
- `client.origin` MUST be the origin the home provider observed for the requesting document (the embedder origin of its own frame, the `Origin` of the request, or the exact registered redirect URI the certificate is delivered to), never a value taken from request parameters. The certificate MUST be delivered only to documents of that origin, by the same rules as an authorization code (auth) (R2-M3).
- It refuses a holder key that is, or was, an identity key of the account.
- It answers `GET <identity URI>/delegations/<jkt>` with the status semantics of [BindleBox §3.4](bindlebox.md#34-delegation-status-assumed), applied to member certificates.

**Request proof.** With each request, the client presents the certificate and a proof made by the holder key:

- either at the organization's token endpoint, to obtain a member-context token (§7.2);
- or directly on the request, as `Authorization: BindleMember <certificate>` with a `DPoP` header ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html) proof: `htm`, `htu`, `iat` within 60 s, a unique `jti`, and `ath` = the SHA-256 of the certificate).

**Verification.** The organization's provider MUST verify, in this order:

1. The certificate's syntax, `typ`, `bindle`, `v`, `aud` = this organization, purpose, expiry (60 s skew) and `exp − iat` bound. Then, with no network fetch, that a membership or the presented live invitation (§5.1) exists for that `(iss, sub)`.
2. The signature, under §3a.5 and §3a.4. The `kid` MUST be the identity's `active` signing key.

**No membership oracle** (review R2-H1). Anyone can construct an unsigned or wrongly signed certificate naming any `(iss, sub)`. Step 1 runs before the signature check, so the result MUST NOT depend on whether step 1 passed:

- Every failure at steps 1–6 gives the same error (`invalid_grant` at the token endpoint, the same 401 in the direct form), with the same body.
- The request path MUST NOT perform a network fetch that the request triggered. The organization keeps the identity documents of its members (and of principals named by live bound invitations) warm by **background refresh**, on a jittered schedule independent of requests, within the §3a.4 bounds. A certificate whose key is not in that cache fails uniformly and only schedules a refresh. An unbound-invitation acceptance (§5.1) is the one case that fetches during the request, and then only after the presented link verified.
- When step 1 fails, the provider performs an equivalent signature verification against a fixed dummy key, so that the cost of the two paths is the same.
- Failed presentations are rate-limited per client and per network, with the same limits whether or not step 1 passed.
3. The proof: its signature by `delegate`, a thumbprint equal to `cnf.jkt`, `htm` and `htu`, freshness, and `jti` replay within the proof window. The replay cache MUST be shared by every instance that accepts requests for the organization; a provider that cannot share it SHOULD require DPoP server nonces (R2-L2).
4. Owner-interface actions only (§6.3): the delegation status at the home provider, cached for at most **60 s**. An unreachable status endpoint fails closed for these actions.
5. `aep` against the epoch recorded for the membership (§5.2a). A certificate whose `aep` is **lower** than the recorded epoch MUST fail. A higher one is an authority reset.
6. The membership and the grants, live, under §6.2.

**Revocation reaching the organization.** When a home provider suspends the member, revokes the consent for a client, revokes a holder key or recovers the account, it stops issuing certificates at once. Outstanding certificates then fail:

- for owner-interface actions, at the next status check (at most 60 s);
- otherwise, at certificate expiry: at most 600 s, or 300 s where the recommended lifetime is used, plus 60 s skew.

A home provider MAY also send `connection-revoked` when the organization's provider has an events endpoint. On receipt, the organization ends that member's member-context tokens. This replaces the revision 1 home-validation staleness bound (review R1-H5): renewal needs a fresh certificate, and each certificate is a fresh live check at the home provider.

**Acquisition is out of scope.** How a client obtains a holder key and certificate is not specified here. This specification fixes only the artifact and its verification. Non-normative examples:

- the home provider's embedded elements, which hold a non-extractable key in the provider's own frame and obtain certificates from the provider session the member already has;
- a general Bindle authorization flow at the home provider, for when the member is not signed in there;
- a native or CLI device grant ([device authorization](device-authorization.md)).

Whatever the mechanism, the home provider MUST obtain the member's consent for each (`aud`, `client`) pair before its first certificate, and MUST name the organization (by identity URI and handle) and the client's verified origin when it does.

**What this proves, and its limit.** A verified chain proves that the member's home provider attests that this request came from this identity, through this client, for this organization. That is the proof of origin this specification requires. Identity keys are provider-custodied, so a home provider could forge such a chain for its own users. Every organization trusts each member's home provider for that member, and organizations MAY restrict the issuers they accept. Evidence that is verifiable independently of the provider, such as passkey-signed approvals, is reserved for a later optional profile.

### 5.2a Owner-interface authority after home-account recovery

§3 forbids obtaining owner-interface authority through one's own account recovery. Because a recovered home account keeps its `(iss, sub)`, whoever completed the recovery inherits the membership. Therefore (review R1-H3):

- **Detection.** The organization records the highest `aep` it has accepted for each membership. A higher `aep`, a key reset without continuity (§3a.4), or a `connection-revoked` event from the home provider (whose reason is not disclosed) each count as an authority reset. Certificates with a lower `aep` fail, so once the new epoch is seen, certificates issued before the recovery stop working at once, and replaying them cannot re-trigger holds (R2-M1).
- **Re-confirmation is bound to the epoch.** It names the `aep` value it confirms. A later reset needs a new re-confirmation.
- **Hold.** After any authority reset, the organization's provider MUST hold that member's owner-interface authority until a provider-defined re-confirmation completes. Examples are approval by another operator, or a delay of at least 72 hours with notice to every other operator, any of whom can cancel.
- **Missing `aep`.** A home provider that cannot supply a meaningful `aep` MUST NOT issue member certificates. The member is then unable to authenticate. It is never treated as an epoch that cannot change.
- Member grants MAY resume with the next valid certificate. The hold applies only to owner-interface authority.
- The hold MUST be recorded in the audit and shown to the affected member.

### 5.3 Membership identifier

- A membership ID is an opaque string matching `^[A-Za-z0-9_-]{16,64}$`, issued by the organization's provider.
- It is stable per (organization, person principal), including across leaving and rejoining (a new connection generation), MUST NOT equal or encode the person's `sub` or handle, and MUST NOT be reused for another principal.
- Organizations MUST store members by the full `(iss, sub)` of the home identity, never by a bare local account ID, even when the issuer is local.
- The organization's own applications receive the same membership ID for the same member (§7.2). This deliberately lets an organization's applications agree on a member. It does not prevent an application that the person uses in several entities from linking that person's membership IDs (§12).
- In actor chains sent to other entities (§9.4), the organization MUST send a **pairwise** identifier per grantor unless the grant's `actor_disclosure` is `"named"`. For example, an HMAC of the membership ID under an organization secret, keyed by the grantor.

### 5.4 Leaving, removal and expiry

- A membership MAY carry `expires_at`. Expiry, removal by the owner interface and the member leaving all set the connection to `disconnected` in one commit, which also:
  - ends the member's member-context tokens and owner-interface sessions;
  - enqueues `member-removed` to each of the organization's integrations that has obtained member context for this membership (§7.4);
  - when the organization holds tokens obtained from other entities for this member, triggers revocation of those tokens at their grantors (§9.5).
- A member MUST be able to leave through the organization's provider at any time.
- Leaving or removal MUST NOT transfer, delete or change ownership of any resource. Resources belong to exactly one entity.

## 6. Grants and effective authority

### 6.1 Grant caveats

A grant ([protocol §4](protocol.md#4-grants-and-live-authorization), [security](security.md#grants-and-resource-authority)) attached to a connection MAY carry:

| Caveat | Applies to | Meaning |
| --- | --- | --- |
| `expires_at` | all | Unix seconds. After it, the grant is unusable, and every live check treats it as revoked. |
| `reshare` | entity grantees | Default `false`. When `true`, the grantee may attach a narrower grant on the same resource to its own connection with a third entity (§9.6). **TBD in this version: providers MUST refuse `true`.** |
| `actor_disclosure` | entity grantees | `"pairwise"` (default) or `"named"`. With `"named"`, actor chains name the member by verified `(iss, sub)` (§13). |

Grants to members name resources, methods and an optional scope ([resource scoping](../architecture/resource-scoping.md)). Grants to integrations are unchanged: fragment-based.

### 6.2 Effective authority

For every call, the provider hosting the resource MUST authorize the intersection of the following, each checked live immediately before execution, as protocol §4 requires:

1. Every grant along the actor chain. For a member acting through an application in organization O on O's resource R:
   - the live grant O→application, through its fragment assignment;
   - the live grant O→member on R.

   For an imported resource (§10), add the live grant grantor→O on R. The grantor checks that one, and O checks the hops inside O before requesting a token (rule 4).
2. The state and generation of every connection along the chain.
3. The resource's implemented contracts and the requested method.

Rules:

1. **No implicit flow.** A connection, a relationship label or a counterparty's own authority confers nothing. Authority over a resource exists only through a grant naming that resource (or its scope) on that connection.
2. **Use within the grantee.** An entity grantee MAY exercise a grant only through its own members and its own connected applications, each within its own grants to them. It MUST NOT exercise it for any other entity unless `reshare` applies.
3. **Owner-interface authority is not a grant.** It is never obtainable by an application, never attached to an entity grantee and never part of a token in this version.
4. **Deputies check before asking.** A provider that requests a token from another entity's provider on behalf of its member or application MUST first evaluate its own hops under this section, and MUST NOT request more than that evaluation allows.
5. **Organization as itself.** An integration acting for an organization with no member present (offline access, integrations §3.4) is authorized by the organization's grants to it alone. Member grants do not limit this access, so it is a superset of every member-context authority the same client can obtain (review R1-H1). Therefore:
   - Before approving a connection, the owner interface MUST disclose that organization-as-itself access is not limited by member grants.
   - A provider MUST let the owner approve a connection **without** organization-as-itself resource access. Such a connection may still read its configuration, receive events and contribute resources; it MUST NOT obtain tokens for resource RPC with no member present.
   - The audit MUST distinguish organization-as-itself calls from member-context calls (§13).

### 6.3 Owner interface

- An organization's owner interface is operated only by members whom the organization authorizes under provider policy.
- Owner-interface requests are authenticated under §5.2, including the status check of step 4. The provider's own console is a client like any other: its certificates name the console's client. A provider MAY authenticate a member whose home issuer is local by its ordinary session instead, if that session is bound to the same `(iss, sub)` and the §5.2a epoch rules still apply.
- Everything protocol §3, extensions §5.1 and integrations §3 reserve to "the owner" applies to those members acting through it, with the same disclosures. That includes assigning preference values and occupants, approving integrations and disconnecting them.
- A provider MUST record the acting member in the audit for every owner-interface action (§13).
- Where provider policy grants a member only part of the owner interface, that member MUST NOT confer on any member, application or entity authority over a resource that the member could not confer under that policy. Granting an application a resource is conferring it (review R1-L6).
- A provider MUST prevent an organization from reaching a state in which no member can operate its owner interface, except through provider-defined recovery.

## 7. Member context for applications

### 7.1 Requesting member context

An application connected to organization O acts for a member by presenting a member certificate (§5.2). The certificate must have `aud` = O, a `client` equal to the application, and the `member-access` purpose. There is no authorization page at O and no separate sign-in. The member's consent to this application acting for them in O was obtained by their home provider before it issued the first certificate (§5.2). Which organization to use, and the "choose an organization" experience, belong to acquisition and are out of scope.

The application uses one of two forms:

- **Token form** (RECOMMENDED for applications). The application POSTs to O's token endpoint with:
  - `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` ([RFC 7523](https://www.rfc-editor.org/rfc/rfc7523.html));
  - `assertion=<certificate>`;
  - `client_id` equal to `client.client_id`;
  - a `DPoP` proof by the holder key with `htu` = the token endpoint.

  A confidential client also authenticates as usual.
- **Direct form.** `Authorization: BindleMember` on each request (§5.2).

O's provider verifies the certificate under §5.2. It also checks that O's connection to `client.client_id` is `active` or `degraded`, and that `client.origin` is a verified origin of that client.

### 7.2 Result

- The token form returns a member-context access token:
  - DPoP-bound to the certificate's `cnf.jkt` (`token_type: "DPoP"`);
  - with `exp` no later than the certificate's `exp`;
  - with **no refresh token**. Continuing after expiry requires a new certificate, and therefore a fresh live check at the home provider.
- The token response MUST include:

  ```json
  "bindle_member": {"entity":"https://provider.example/identity/<o>","id":"<membership ID>","label":"<optional>"}
  ```

  `label` appears only if the member shared a display name with O.
- Tokens are bound to `(O, membership, client, jkt)`.
- Bearer access tokens MUST NOT be issued for member context. Every request therefore carries a signature by the certified holder key, and an application backend cannot act for the member without that key.
- Organization-as-itself access (§6.2 rule 5) is the only way to act with no member present.
- **Holder keys (review R1-H2, re-evaluated).** Binding member context to a key in the member's own user agent now depends on where acquisition places the holder key.
  - A home provider SHOULD issue `member-access` certificates only for keys that its acquisition mechanism keeps on the member's device, such as a non-extractable key in its own elements or in the application's browser context.
  - It MUST disclose when the holder is a server-side agent (for example a CLI or device grant to a confidential client), so the member knows that agent can act for them while certificates are issued.
- The response adds no person identifier beyond what the certificate already shows the application. An application that holds a certificate necessarily learns the member's `(iss, sub)` and identity URI. This supersedes, for member context, the revision 1 statement that member-context responses carry no person identifier (review R1-M4). Acquisition mechanisms that keep the certificate inside the home provider's own frame can avoid showing it to the application.
- The preferences projection and every RPC are authorized under §6.2, with the membership and connection checked live on every call.

### 7.3 Uniform outcomes

- The application MUST receive exactly the same `invalid_grant` result (the same 401 in the direct form), with no further members, when:
  - there is no membership, or it is suspended;
  - the client is not connected to O, or `client.origin` is not verified for it;
  - the certificate or the proof fails any step of §5.2.

  Revision 2 returned `invalid_grant` before step 1 and `access_denied` after it, which told a forger whether a membership exists (R2-H1).
- The provider MUST follow the no-oracle rules of §5.2, so that a forged certificate learns nothing about membership. Revision 2's claim that fetch timing was visible only to a consented client was wrong, because certificates can be forged before the signature check (R2-H1).
- Membership is therefore learnable only by a client that holds a genuine certificate for that organization and its key.

### 7.4 Events

Integrations §6.2 gains (AMD-O4):

| Event identifier (placeholder) | Payload beyond `connection`, `generation`, `seq` | Integration obligation |
| --- | --- | --- |
| `…/events/member-removed/v1` | `member` (membership ID) | Discard caches and sessions for that member. The event carries no reason. |

## 8. Member-scoped fragment fields (phase B; TBD)

**TBD.** This section reserves the following and defines no requirement yet.

- A fragment field MAY declare `"scope": "member"` (AMD-O11).
- Its values are set per member through the owner interface and are atomic types only in the first version.
- A preferences read in member context returns the acting member's values. A read in organization context omits member-scoped fields.
- Applications cannot write them.
- Consent discloses that administrators set them per member.

## 9. Inter-entity grants

### 9.1 Offer link type

An offer is a link of type `https://spec.bindle.example/links/entity-offer/v1`, issued by the grantor's provider and signed with the grantor entity's key.

The type-specific meta members are:

- `grantee`: `{iss, sub}`;
- `offer_digest`: the digest of the stored grant proposal;
- `accept`: the grantee provider's `entity-grants.v1` `accept_endpoint`, as resolved by the grantor at issue time.

The proposal itself is not in the link. It lists resources, contracts, methods, scope and caveats. The grantor stores it, and it is disclosed at acceptance (§9.2).

- Single use; `exp − iat` ≤ 30 days (**TBD**).
- Only the named grantee can redeem.
- Errors are uniform under links §8.

### 9.2 Acceptance

1. Opening the offer at the owner host shows the owner host's page, which names the grantor's origin.
2. The page navigates top-level, with a form POST of the link alone, to the grantee provider's `accept_endpoint`. This follows the links §9 opener pattern: that POST MUST NOT accept or sign anything by itself.
3. The grantee provider authenticates a person who can operate the grantee's owner interface. It retrieves the proposal from the grantor (**TBD**: an unauthenticated read bound to the offer, or a read authenticated by the grantee's client assertion). It discloses:
   - the grantor's verified origin **and** the grantor entity's identity URI and handle. Entities on one provider share an origin, so the origin alone does not identify the grantor (review R1-M6);
   - each resource with its methods and scope;
   - `expires_at`, `reshare` and `actor_disclosure`;
   - that the grantor's provider will see the grantee's actor chain;
   - that copies already read cannot be recalled.

   The decision is an explicit, CSRF-protected action on the grantee provider's own page. A grantee provider MUST refuse an offer whose proposal contains a caveat it does not implement. Caveats are fail-closed (review R1-L2).
4. The grantee provider MUST key the resulting connection and imported resources by the grantor's `(iss, sub)`, never by label or handle.

### 9.3 Redemption

The grantee provider redeems at the grantor's token endpoint with:

- `grant_type=https://spec.bindle.example/grant-types/entity-offer/v1`;
- `offer`;
- `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`;
- `client_assertion`: a JWT with header `typ: "bindle-entity-client+jwt"`, signed by the grantee entity's identity signing key. `iss` and `sub` are the grantee's identity URI, `aud` is the grantor's token endpoint, and there is a `jti`. `exp − iat` ≤ 60 s.

The grantor's provider verifies:

1. the assertion key:
   - same host: against its own records;
   - other hosts: under §3a.5, with pinned continuity (§3a.4). A grantee whose provider does not declare `directory.v1` is refused with `entity_unverifiable`, with no fetch beyond the manifest.
2. that the grantee equals `grantee`;
3. the digest and liveness of the offer.

It then creates the connection and returns a connection-bound refresh token (integrations §3.4 bounds), `bindle_connection` and the granted resources. The grantee's events endpoint is taken from its entity client metadata (**TBD**, AMD-O10).

### 9.4 Token requests

To use a granted resource, the grantee provider requests a token from the grantor's token endpoint, by token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)) authenticated with a client assertion as in §9.3, with:

- `resource`: the grantor resource ID;
- `bindle_methods`: a contract → methods map that MUST be a subset of the grant;
- an optional narrower `bindle_scope`;
- `bindle_actor`: `{member?: string, client?: client_id}`, where `member` follows §5.3 and `actor_disclosure`;
- `dpop_jkt`: the thumbprint of the key that will present the token, which the grantee provider MUST have proven through its consumer's session.

The grantor's provider:

- checks §6.2 for its own hops;
- refuses anything outside the grant with `invalid_scope`;
- mints a token with `aud` = the hosting RPC endpoint, `exp − iat` ≤ 300 s and `cnf.jkt` required. When the requested methods include any write-capable method (contracts method metadata), `exp − iat` MUST be ≤ 60 s, because the grantor cannot see revocations inside the grantee (review R1-M1);
- journals calls made with these tokens under the key (grantor entity, connection, `client_id`, `tx`), so that two grantees using the same client cannot collide or replay each other's results (review R1-L1);
- records the actor chain (§13).

Grantor-hosted resources use opaque issuer tokens, which are checked live. For a grantor's integration-hosted resource, the grantor mints a brokered token (integrations §5.3) with `client_id` = the grantee's identity URI and the actor chain in `bindle.actor`.

There is no refresh token for these tokens. Bearer tokens MUST NOT be issued under this section.

### 9.5 Severance and revocation

- Integrations §7 applies to entity-grantee connections. The grantor sends `connection-revoked`, `credential-revoked` and `resource-detached` to the grantee's events endpoint, and the bound `access_ends_by` applies to integration-hosted resources.
- When a member, application or internal grant on the grantee side ends, the grantee provider MUST stop requesting tokens for that actor, and MUST revoke outstanding tokens for it at the grantor's revocation endpoint, enqueued in the same commit and retried. The grantee-side revocation bound is therefore receipt of that revocation, and at worst the token lifetime plus 60 s.
- Grantor-hosted resources stop on the next call after the grantor's commit.

### 9.6 Re-sharing (TBD)

**TBD.** This reserves chained offers from a grantee holding `reshare:true`. Every token is still minted by the resource's host after checking every hop. Revoking any hop cuts every descendant.

## 10. Imported resources

- A grantee provider represents each granted resource as an imported resource in the grantee's pool. It can be assigned to the grantee's fragments and is subject to the grantee's own grants.
- Its `status` is `unavailable` while the connection or grant is not live.
- Under preferences v2 ([contracts](contracts.md#preferences-v2)), an imported resource MAY be projected in relay form (AMD-O5):

  ```json
  {"id":"<grantee's scoped reference>","label":"Acme Ltd · Ledgers 2026","status":"available",
   "contracts":["…"],"token":"<grantor-minted>","token_type":"DPoP","expires_at":1792500000,
   "grantor":"https://3sln.me/identity/<o>",
   "broker":{"endpoint":"https://3sln.me/bindle/rpc","origin":"https://3sln.me","resource":"<grantor resource ID>"}}
  ```

- The consumer cannot see who minted an opaque token. It MUST send `token` only to `broker.endpoint`, and only when `broker.origin` equals the origin of `grantor`, and `broker.endpoint` equals the `rpc_endpoint` of that origin's validated manifest (protocol §2). It MUST NOT send any other credential to `broker.endpoint`. This relaxes, for `grantor` items only, any consumer rule that a broker origin differs from the issuer's (review R1-L5).
- Alternatively, a grantee provider MAY proxy calls through its own gateway. That is provider-internal and needs no projection change.

## 11. Event buses across entities

- [Events §2.1](events.md#21-the-slotbus-member) `readers` gains the value `entity` (AMD-O6). Cross-entity exchange uses the outbox model: each entity publishes only to buses it owns. `entity` in `publishers` is **reserved**; it needs a publisher attribution kind carrying the actor chain, which this version does not define (review R1-L3).
- A provider MUST NOT attach a grant on a bus to an entity grantee unless the manifest lists `entity` in the matching member.
- Doorbells (events §7.2) to an entity grantee go to its events endpoint. The grantee provider MAY forward a doorbell for the imported bus to its own integrations.

## 12. Privacy requirements

1. No endpoint, document, link result or error MAY reveal whether a principal is a member of an organization, except to that principal or under §7.
2. Identity documents MUST NOT list members or affiliations (§3a.3). Home-provider records of which organizations a member uses are private and confer no authority.
3. Invitation, offer and member-context failures are uniform as specified in §5.1, §9.1 and §7.3.
4. Actor chains to other entities use pairwise member identifiers unless `actor_disclosure:"named"` applies.
5. Pairwise identifiers protect against correlation between entities. They do not protect against an application that the person uses in several entities, which can link the contexts through its own client state. Providers MUST NOT describe membership IDs as unlinkable by applications (review R1-M4).
6. Changing a grant from `pairwise` to `named` lets the grantor link past pairwise identifiers to persons. The grantee's acceptance page MUST say so.
7. A home provider necessarily learns which organizations and clients its member acts in, and when certificates are renewed. Consent at first issuance (§5.2) MUST say so. An organization learns the member's home issuer and `(iss, sub)`. A client holding certificates learns the same (§7.2).
8. Directory fetches reveal to the member's home provider that the verifying organization's provider is evaluating that identity. Caching (§3a.4) bounds how often this happens.

## 13. Audit and export

- Each provider MUST record, for every owner-interface action and every authorized call on an entity's resources, the actor chain `{entity, via:[{entity?, member?}, {client?}]}` together with the action, resource, contract, method, `tx` and time. Audit entries MUST NOT contain payloads, tokens or preference values (security).
- Audit history MUST survive the end of the connection it refers to, for the provider's documented retention.
- An organization's export MUST include its memberships (as principals and membership IDs), the grants it issued, its connections, its imported-resource references and its audit, in documented formats. **TBD:** formats and a grantable `audit-log/v1` contract.

## 14. Feature declarations

| Feature | Members | Meaning | When absent |
| --- | --- | --- | --- |
| `directory.v1` | `directory_url` (issuer origin) | Handle lookup and identity documents (§3a). Required of any provider whose identities act in organizations hosted elsewhere, and of any provider that hosts organizations. | Its identities cannot be verified by other hosts. Verifiers fail with no fetch beyond the manifest. |
| `organizations.v1` | none | The provider hosts organizations. It verifies member certificates and serves the member-context token form and `bindle_member` (§5.2, §7). | No organizations at this provider. |
| `key-delegation.v1` (with the AMD-O12 purposes) | none | As a home provider, it issues member certificates (§5.2) and serves their delegation status. | Its identities cannot act as members of organizations. |
| `entity-grants.v1` | `accept_endpoint` (issuer origin) | The provider accepts offers addressed to its entities (§9.2), redeems them as a grantee, and honours the offer grant type, entity token requests and §10 as a grantor. Requires `organizations.v1` or person grantors (**TBD**). | No inter-entity grants with this provider. |

How a client acquires certificates needs no declaration in this specification (§5.2).

## 15. Core amendments — proposed (unsigned)

| ID | Document | Change |
| --- | --- | --- |
| AMD-O1 | protocol §1, §6 | Define entity kinds `person` and `organization`. Remove "organization membership" from the §6 list of out-of-scope items and point here. Delegation stays out of scope. |
| AMD-O2 | protocol §3 | Replace "only the user's authenticated provider UI" with "only the entity's owner interface (organizations: §6.3)". |
| AMD-O3 | auth; federation-implementation | The member-context token form (`jwt-bearer` grant with a member certificate, DPoP-bound, no refresh token); the token response member `bindle_member`; the `BindleMember` authorization scheme. (Revision 1's `entity` entry member, `affiliation` and `auth_time`/`amr` are withdrawn.) |
| AMD-O4 | integrations §1, §3, §6.2 | Connection counterparty kinds. The `member-removed` event. |
| AMD-O5 | integrations §5.1, §5.3; contracts preferences v2 | Relay projection for imported resources, `grantor`, cross-entity brokered tokens with `bindle.actor`. |
| AMD-O6 | events §2.1, §7.2 | The `entity` value in `readers` (`publishers` reserved); doorbells to an entity grantee's events endpoint. |
| AMD-O7 | links | The invitation and offer link types; signature-domain table rows for `bindle-entity-client+jwt` and the new link types. |
| AMD-O8 | security, "Grants and resource authority" | Replace "A future organization owner is a separate principal…" with a pointer to §6. |
| AMD-O9 | contracts, "Useful follow-ons" | Replace the organizations sentence with a pointer here. |
| AMD-O10 | protocol §2; contact delivery; links §7.3; BindleBox §3.3 | The `directory.v1` feature and §3a as the shared directory profile, replacing the "unwritten profile" references. The identity document `kind`. Entity client metadata (`events_endpoint`, key set) under identity-level `features` (**TBD**). |
| AMD-O11 | protocol §3 | The field member `scope: "member"` (phase B). |
| AMD-O12 | `key-delegation.v1` (currently proposed in BindleBox §3.2) | Generalize the core feature to two certificate profiles: `bindle-key-delegation+jwt` (BindleBox, unchanged) and `bindle-member-certificate+jwt` (§5.2), with the purposes `member-access` and `member-accept`. Add rows for both, and for the `BindleMember` DPoP proof, to the links §7.2 signature-domain table. The current implementation's "one active delegate key per principal" rule and its messaging-occupant check (`packages/identity/delegation.mjs`) apply to the BindleBox profile only. Member certificates instead allow several active keys, at least one per (`aud`, `client`) issuance grant (§5.2), or a member's second organization, client or device would revoke the first (R2-M5). |

## 16. Conformance tests (minimum)

- **Membership:**
  - invitation binding, single use, expiry and uniform errors;
  - membership is keyed by the certificate's exact `(iss, sub)`; a certificate for one organization fails at another, including on the same provider;
  - a certificate from a principal with no membership or invitation fails before any network fetch;
  - forged certificates naming a member and a non-member get identical status, body and (within tolerance) timing, and neither triggers a request-path fetch (R2-H1);
  - a certificate whose `identity` differs from the directory-derived or pinned identity URI fails without fetching it (R2-H2);
  - a certificate with a lower `aep` than recorded fails; re-confirmation names the `aep` it confirms (R2-M1);
  - acceptance without the presented invitation link does not satisfy step 1 (R2-L1);
  - an `aep` change, a key reset without continuity, or a `connection-revoked` event holds owner-interface authority until re-confirmation;
  - owner-interface actions fail closed when delegation status is unavailable, and fail within 60 s of a home-side revocation;
  - an unbound invitation cannot confer owner-interface authority;
  - leave, removal and expiry are effective on the next call.
- **Effective authority:**
  - randomized grant sets satisfy effective ⊆ every ceiling (property test);
  - a member-only resource is invisible to the application, and an application-only resource is omitted in member context;
  - owner-interface powers are never in tokens;
  - a connection approved without organization-as-itself access obtains no resource token with no member present.
- **Member context:**
  - not a member, suspended, client not connected, and a certificate that fails after step 1 are indistinguishable to the application (body and status; timing within tolerance);
  - member-context tokens are DPoP-bound to the certificate's key, never outlive the certificate, come with no refresh token, and Bearer is refused;
  - a certificate naming a different client, or a client not connected to O, gets the uniform result.
- **Directory and certificates:**
  - identity documents contain only the permitted members, and unknown and suspended identities give an identical 404;
  - wrong `typ` (including a BindleBox delegation certificate), wrong `aud`, a lifetime over 600 s, a retired or revoked signing key, a holder key equal to an identity key, and a replayed proof `jti` all fail;
  - a key rotation with continuity is accepted silently, and one without continuity counts as an authority reset;
  - a document reviving a retired, revoked or superseded kid, or rolling back to an ancestor key, is rejected and is not treated as a reset (R2-H3);
  - the home provider binds `client.origin` to the observed requester origin and lists every issuance grant and holder key to the member (R2-M2, R2-M3);
  - an unreachable issuer gives a retryable error, never acceptance, and per-issuer fetch budgets hold under a flood of certificates naming unknown issuers.
- **Inter-entity:**
  - an offer redeemed by the wrong entity fails;
  - an assertion with the wrong `typ` or key fails;
  - foreign redemption from a provider without `directory.v1` gives `entity_unverifiable`, with no fetch beyond the manifest;
  - downscoping is enforced and Bearer tokens are refused;
  - tokens carrying write-capable methods live at most 60 s;
  - an offer with an unknown caveat is refused by the grantee;
  - two grantees using one `client_id` and one `tx` neither collide nor replay each other's results;
  - `reshare:true` is refused;
  - grantor revocation stops the next call, and grantee revocation applies on acknowledgement;
  - a bus without `entity` cannot be granted to an entity.
- **Races:**
  - a removal racing token minting;
  - an offer redeemed twice;
  - the last admin removed;
  - a connection generation raised mid-request.
- **Privacy:** no membership signal in identity documents, links, offers or errors; pairwise actor IDs differ per grantor.

## Sign-off checkpoints

- [ ] **O1 — Kinds and connections:** organization as an entity kind; directional connections; no implicit flow.
- [ ] **O0 — Directory:** identity documents, key continuity and caching bounds; verification of unknown providers.
- [ ] **O2 — Members:** home-certified holder keys and signed requests; revocation bounds; membership IDs; uniform member context.
- [ ] **O3 — Inter-entity:** offers, redemption, actor chain, ≤ 300 s DPoP tokens; dependency on the directory profile.
- [ ] **O4 — Privacy and audit:** no enumeration; pairwise identifiers; actor-chain audit.

Reviewer / date / notes: _pending; these checkpoints do not block drafting._
