# Organizations, membership and relations — normative draft (skeleton)

Status: **skeleton, 2026-10-24, revision 4.5.** Revision 4.5 (ORG-10/ORG-11 relations design, [design §8b](../architecture/organizations-design.md#8b-org-10-and-org-11-relations-design-for-implementation-rev-56)) closes three cross-provider gaps in relations. Relation events are now signed by the sending entity's certification key, verified without request-path fetches, ordered by generation, carry the grantor's resource IDs to the grantee, and are re-sent for convergence (new §9.9). The counterpart's events endpoint now comes only from its issuer's manifest (§9.9, §14). Participation statements must now be fresh where they are presented (§9.3). It also adds invitation withdrawal (§9.4), unguessable instance identifiers (§9.3), one privacy item (§12), conformance checks (§16) and checkpoint O7. Provisional (coordinator), not signed off by the user; one adversarial self-review round applied. Revision 4.4: Revision 4.4 (ORG-12 break-glass, design §12d) adds one rule: a change of control without the recovery file is an authority reset at effect, and only at effect (§3). It also adds a disclosure item (§6.3), one conformance check (§16) and checkpoint O6. Everything else about break-glass is provider policy. Provisional (coordinator), not signed off by the user; unreviewed. Revision 4.3 records decisions that are Provisional (coordinator), not signed off by the user (design §1d); implementation proceeds on them, and they stay revisable. It restores two cross-provider security floors as minimum requirements, because they protect members homed at other providers: governance powers are held after an authority reset (§5.2a), and unbound invitations never confer governance powers (§5.1). It adds a standard effective-methods output for applications (§7.5, phase B) and a portable export of memberships and grants for organization moves (§13.1). Member grant records stay internal. It is unreviewed. Revision 4.2 applies the user's decision of 2026-10-22 that membership, member grants and governance are internal to the organization (design §12c): this document now keeps only what crosses a party boundary, and the internal rules it used to state (holds after authority resets, bound invitations for governance, membership expiry and removal, partial-governance and no-operator guards) moved to the 3sln.me design as provider policy. It is unreviewed. Revision 4.1 applies AMD-P4 from [identity portability](identity-portability.md) and AMD-I5 from [intents](intents.md), and answers R4-H2. It is unreviewed. Revision 4 (with the resolved findings of [Review round 4](../architecture/organizations-design.md#review-round-4) applied, marked R4-…; its open items are not resolved). Revision 4 applies the user's decisions of 2026-10-22: organization identities are ordinary identities with a recovery file (§3); certificate lifetime is the issuer's choice (§5.2, §9.5); "relation slot" is the term where ambiguous; and portability is referenced, not designed here. It is not independently reviewed. Revision 3.3: Revision 3.3 makes governance explicitly provider policy (§6.3). Revision 3.2: Revision 3.2 registers the `relation` artefact kind's growth points (§9.2, artefact-references review R1-L2). Revision 3.1: Revision 3.1 applies the user's admission decision of 2026-10-21: membership in an instance is per edge, and partial membership is a normal state (§9.3, §9.4). It is not independently reviewed. Revision 3: Revision 3 replaces inter-entity offers with **relations** (§9), following the user's proposal of 2026-10-21 ([design §8a](../architecture/organizations-design.md#8a-relations-proposal-assessment)). It was reviewed in [Review round 3](../architecture/organizations-design.md#review-round-3), whose resolved findings are applied (marked R3-…); its open items are not resolved. Organization identities, directory documents, memberships/grants, member certificates, member RPC, console, billing/ownership and break-glass have local implementations (`packages/orgs/`, `packages/runtime/routes/orgs.mjs`, `directory.mjs`, `member-certificates.mjs`). Relations have an engine-only ORG-10a–c implementation behind default-off relation flags; certificate use, signed relation-event transport, lifecycle reset holds, routes and console remain incomplete. See DEVLOG 2026-10-24 for the precise slice boundary. Nothing is published or production-verified. Revision 1 applied the resolved findings of the first independent review ([design, Review round 1](../architecture/organizations-design.md#review-round-1)); items that review left open are not resolved here. Revision 2 applies the user's clarification of 2026-10-21 ([design §1a](../architecture/organizations-design.md#1a-user-clarification-2026-10-21)). Members from any provider are core. Their requests are signed by a key their home provider certified, and the organization verifies that through a directory profile (§3a). There is no separate sign-in at the organization. This replaces the federated login of revision 1. Revision 2 was reviewed in [Review round 2](../architecture/organizations-design.md#review-round-2), and the resolved findings of that round are applied here (marked R2-…); its open items are not resolved. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements. Sections marked **TBD** are reserved and carry no requirements yet. §15 lists the core amendments this draft needs; they are **proposed and unsigned**.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This document extends [protocol](protocol.md), [auth](auth.md), [links](links.md), [extensions](extensions.md), [integrations](integrations.md) and [events](events.md). It defines interoperability rules only, with no user interface beyond the security disclosures it lists. Governance powers, templates, grouping, recovery of organizations, billing and every presentation choice are provider policy.

**Scope: party boundaries only** (decided by the user, 2026-10-22: "Membership within an org, and access, grants, etc; are internal org matters … bindle is for the contracts/interop between providers, third parties, etc"). How an organization stores its members, what each member may do inside it, and who may change that are the organization provider's own **membership and grant policy** (§6.3). This document specifies only:

- organization identities and identity documents (§3, §3a);
- member certificates, issued by a member's home provider and verified by the organization's provider (§5.2), and the authority-epoch signal between them (§5.2a);
- the invitation a person from any provider opens (§5.1), the membership ID and the observable end of a membership (§5.3, §5.4);
- two minimum security floors that protect members homed at other providers (§5.1, §5.2a; revision 4.3);
- the effective-authority intersection as applications and counterparts receive it (§6.2), member context, `bindle_member` and the effective-methods output (§7), and uniform failure (§5.2, §7.3);
- relations between organizations (§9–§11);
- privacy, audit outputs, the portable membership export and feature declarations that a counterparty, application or destination provider must interoperate with (§12–§14).

## 1. Model

An **organization** is an entity ([protocol §1](protocol.md#1-model-and-custody)) that is not a person. Like every entity it has:

- a stable identity `(iss, sub)` at its provider;
- identity keys;
- a resource pool, preferences, connections and grants.

An organization's identity works exactly like a person's: a stable UUID, aliases (handles) that point to it, provider-custodied keys, and a recovery file issued at creation (§3). What differs is how it acts. Nobody signs in *as* an organization. People act for it as **members**, only within grants the organization holds for them, and its provider uses its key on their behalf.

This document adds no new principal type, token transport, RPC transport or authorization store. It specifies five things:

0. **Identity documents and member certificates** (§3a, §5.2). Any provider publishes read-only identity documents carrying the public keys of its identities. A member's home provider certifies a short-lived holder key, bound to one organization as audience. The organization verifies that chain and then derives authority from the member's `(iss, sub)`. A member's identity is always their home provider's identity, and same-host membership is the case where that issuer is local.
1. **Counterparty kinds for connections** (§4). A connection, the existing coupling of [integrations §1](integrations.md#1-model), may have an integration, a person or an organization as its counterparty. A **membership** is the organization provider's record that a person may act for the organization. Its contents are provider policy; to other parties it behaves as a connection with counterparty kind `person`, live or ended (§5).
2. **Grants to connections and effective authority** (§6). The authority of any actor is the live intersection of the grants along its chain. Nothing is inherited across a connection. A member's share of that intersection is determined by the organization provider's own membership and grant policy; this document defines the intersection and its outputs, not member grant records.
3. **Member context** (§7). An application obtains authority to act for a member within an organization only by presenting a member certificate that the member's home provider issued for that organization and for that application, together with a proof made by the certified key.
4. **Relations** (§9–§11). Public, versioned relation documents define slots and an access matrix over preferences fragments. Entities join instances in slots. Each grantor consents per counterpart, and grantees consume the granted fragments as integrations do. Requests carry entity certificates issued by the acting entity's own provider.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Entity | As in protocol §1: a person or an organization. |
| Person | An entity that authenticates as itself. |
| Organization | An entity of kind `organization` (§3). |
| Owner interface | The provider's authenticated interface through which an entity's owner configures preferences, grants and connections. For a person, it is the person. For an organization, it is operated by members the organization authorizes, under provider policy (§6.3). |
| Connection | A provider-held, directional coupling from a **grantor** entity to a **counterparty**, with a state and a generation ([integrations §3](integrations.md#3-connection-lifecycle)). |
| Membership | The organization provider's record that a person may act for an organization (§5). To other parties it behaves as a connection with counterparty kind `person`. Its contents are provider policy. |
| Membership and grant policy | The organization provider's own rules for who is a member, what each member may do inside the organization, and who may change either (§6.3). Not specified here. |
| Member | The person counterparty of a live membership. |
| Membership ID | An opaque identifier of one membership (§5.3). |
| Home provider | A person's own provider: the issuer of their `(iss, sub)`. |
| Identity document | The read-only public document describing one identity's public keys and protocol metadata (§3a). |
| Holder key | A P-256 key pair held by the client that acts for a member. Its private key SHOULD be non-extractable. |
| Member certificate | A short-lived JWS by which a home provider certifies a holder key for one identity, one organization (the audience) and one client (§5.2). |
| Authority epoch | A non-negative integer at the home provider that increases whenever the identity's account authority is reset: recovery, a credential reset, or a key reset without continuity (§5.2a). It never decreases (review R2-M1). |
| Grantee | The counterparty of the connection a grant is attached to. |
| Imported resource | A record in a grantee's pool that refers to a resource hosted for a grantor entity (§10). |
| Relation | A public, versioned document defining slots and an access matrix over fragments (§9.2). |
| Relation instance | One concrete association of entities, each of which joined it in a slot (§9.3). |
| Edge | The set of grants from one party of an instance to another, realized as a connection (§9.3). |
| Entity certificate | A short-lived JWS by which an entity's provider certifies a holder key for that entity, a counterpart and a client (§9.5). |
| Actor chain | The ordered list of entities, members and clients through which a call is made (§13). |

## 3. Organization entities

- An organization's identity URI, handle and keys follow the same rules as a person's. Handles are discovery hints, never identity (auth).
- The identity document (§3a) carries `kind`, which is either `"person"` or `"organization"`. Absence means `"person"`.
- **Same identity model as persons** (user decision, 2026-10-22). An organization's `sub` is a stable UUID. Handles and other aliases are pointers to it, never identity. Its signing and encryption keys are custodied by its provider, exactly as persons' keys are. At creation, the provider issues an **organization recovery file** in the same format and through the same flow as a person's ([recovery identity](recovery-identity.md), [recovery file](recovery-file.md)), containing the organization's UUID and private keys. Key rotation and succession are deferred, as they are for persons.
- **No interactive login as the organization.** An organization MUST NOT have passwords, passkeys or email login. Every interactive action for it is taken by an authenticated person through the owner interface (§6.3) or member context (§7). The recovery file is used only in the recovery flow.
- **Recovery.** An organization's recovery is an authority reset for the organization. It increases the organization's authority epoch when the recovery **takes effect** under the provider's policy, not when the file is presented. A recovery that the policy cancels leaves the epoch unchanged, so a thief who presents a stolen file and is cancelled cannot force epoch churn, and edge holds, on every counterpart (review R4-M2). Its entity certificates carry the epoch (§9.5). Which person, if any, may operate the recovered organization is decided by the provider's membership and grant policy (§6.3), applied after recovery. Who holds the file is likewise provider policy.
- **Control changes without the recovery file** (revision 4.4; Provisional (coordinator), not signed off by the user). A provider's policy MAY let control of an organization pass to another person without the recovery file, for example a break-glass procedure when the person who held the file is gone ([design §12d](../architecture/organizations-design.md#12d-org-12-break-glass-an-organization-whose-owner-is-gone-3slnme-provider-policy) is 3sln.me's). Such a change is an authority reset for the organization, exactly as a recovery is:
  - it MUST increase the organization's authority epoch when it **takes effect**, and a procedure that is cancelled, aborted or closed MUST leave the epoch unchanged;
  - the provider MUST disclose that such a procedure exists (§6.3).
- **Key use.** Members never hold the organization's private key. The provider signs with it on the organization's behalf, and only for artifacts that an authorized owner-interface action or the organization's own live grants justify: links, entity certificates, participation statements, relation events (§9.9) and continuity statements.
- **Recovery files hold the identity signing key, so it cannot sign certificates** (review R4-H1). Every recovery file ever issued for an identity, including copies held by a former owner or a thief, contains that identity's private signing key, and rotation does not exist yet. Member and entity certificates are therefore signed with a separate **certification key** (§3a.3), which the provider holds and which is never placed in a recovery file or an export. The identity signing key signs only links, participation statements and continuity statements, none of which confers authority at a verifier.
- **Portability** (AMD-P4; answers review R4-H2). Moving an identity between providers, for persons and organizations alike, is defined by [identity portability](identity-portability.md) ([design](../architecture/identity-portability.md)), not here. Possession of an identity's private key, or of a superseded recovery file, MUST NOT be accepted as authority to move or transfer an identity. That requirement is satisfied by identity portability §6.1:
  - a move needs the **current** recovery credential, plus current control through a fresh session or a public 7-day waiting period;
  - for an organization, it also needs current transfer authority under the provider's membership and grant policy (§6.3), exercised by a person with their own identity. Authority from an organization recovery counts only once that recovery has taken effect;
  - the source attests the move, and destroys its key copies and revokes its certification keys when it commits.

  Verifiers follow attested successor statements (identity portability §8), never HTTP redirects.
- **Origin principal** (AMD-P4). Every relationship with an identity (memberships, relation edges, invitations, pins) is keyed by its **origin principal** `(iss₀, sub)`: the issuer at which it was first created. For an identity that never moved, this is its `(iss, sub)`. A verifier maps an artifact's current `(iss, sub)` to the origin principal through its **successor index** (identity portability §8.1–§8.2). An artifact whose `iss` is an *earlier* host of an identity fails.
- An organization's identity signing key MAY sign:
  - links the organization issues (links §3);
  - entity certificates (§9.5) and relation participation statements (§9.3);
  - key-continuity statements.

  These are all separated by `typ` or by a domain prefix, as the links §7.2 signature-domain table requires (AMD-O7).
- Organization-specific recovery, and what a member's own home-account recovery does to their standing in an organization, are the organization provider's membership and grant policy. The interoperable signal is the authority epoch (§5.2a). *(Revision 4.2: the former rule against gaining owner-interface authority through one's own account recovery is now 3sln.me policy, design §12c.3.)*

## 3a. Identity documents and key discovery (`directory.v1`)

This section is the directory/identity-document profile that [contact delivery](../../apps/parlay/docs/legacy/contact-delivery.md#authorship-and-signatures), [links §7.3](links.md#73-verifying-the-audience-identity) and [Parlay §3.3](messaging.md#33-verifying-an-author) depend on. It is specified here because organizations need it first. It MAY later move to a companion document unchanged. It is read-only discovery over keys the provider has already established. Nothing here creates, rotates or repairs keys.

### 3a.1 Declaration and naming

- A provider declares `"directory.v1": {"directory_url": "<issuer-origin URL>"}` in `features` (protocol §2).
- Each identity has an **identity URI** on the issuer origin. The reference host uses `<issuer>/identity/<sub>`. Its identity document is at `<identity URI>/identity.json`. Verifiers MUST NOT construct either URL themselves.
- **Where the identity URI comes from** (review R2-H2). A verifier obtains it only from the issuer's directory (§3a.2, by handle or by `sub`), from its own record pinned when it first verified that `(iss, sub)` through the directory, or from the `to.identity` of a move record it adopted under identity portability §8.3 or §8.6 (AMD-P4, identity portability §8.8). An identity URI carried in a certificate (`identity`), a link or any other artifact is a claim: the verifier MUST check it is exactly equal to the directory-derived or pinned URI, and MUST NOT fetch it otherwise. Otherwise any path on the issuer origin that an attacker can influence (user content, a misconfigured route) could serve a forged document naming a victim's `sub`.

### 3a.2 Handle lookup

`GET <directory_url>?handle=<URI-encoded full handle>` returns `{"iss","sub","identity"}` for the stable identity currently assigned the handle. Aliases resolve to the same `sub`.

`GET <directory_url>?sub=<sub>` returns the same triple for that stable identity, so a verifier holding only `(iss, sub)` can find the identity URI without trusting an artifact (R2-H2). Subjects are unguessable UUIDs, and the result is the same uniform 404 for unknown and ended identities.

- Unknown, suspended, deleting or deleted identities return a uniform 404.
- This lookup is the existing public handle-resolution tradeoff (auth, "Identity and discovery"). Lookups are rate-limited per network and per handle.
- Organizations use the handle lookup only to bind invitations (§5.1). Request verification uses the `sub` lookup at most once per `(iss, sub)` (then the pinned URI), and never on a request path (§5.2).

### 3a.3 Identity document

`GET <identity URI>/identity.json` returns `application/json`, at most 32 KiB (enough for 16 signing keys with continuity statements), or within the byte budget of [identity portability §7](identity-portability.md#7-identity-documents-for-moved-identities) (152,576 bytes) when it carries `moves` (AMD-P4):

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

**Moved identities** (AMD-P4). The host of an identity that has moved carries `moves`, its attested successor chain, as identity portability §7 defines. The no-rollback rule (§3a.4) continues across hosts: a destination never lists as `active` a signing key that an earlier host retired or revoked. Certification keys are never carried across a move: the destination issues its own, and its certificates carry an `aep` above the latest attested one (identity portability §7).

**Certification keys** (`use:"cert"`, review R4-H1). A provider that issues member or entity certificates lists one or more ES256 certification keys for the identity, in states `active`, `retired` or `revoked`. They are provider-held, MUST NOT appear in recovery files or exports, and need no continuity statement: the provider rotates them freely, because the live identity document is their only authority. The no-rollback rule (§3a.4) applies to them as to signing keys. Certificates verify only against an `active` certification key. **Second use** (AMD-I5): certification keys also sign intent attributions (`typ: "bindle-intent+jwt"`, [intents](intents.md)). The two profiles are separated by `typ`, so a certificate verifier never accepts an intent JWS, and an intent verifier never accepts a certificate. **Third use** (revision 4.5): certification keys also sign relation events (`typ: "bindle-relation-event+jwt"`, §9.9), separated from both by `typ`.

- At most one signing key is `active`. Only an `active` key verifies a **fresh** signature: link responses, author proofs and participation statements. Certificates use certification keys (above).
- `retired` keys verify only artifacts that the issuer itself stores and re-serves.
- `revoked` keys verify nothing.

**Unknown or ended identities.** For an unknown, suspended, deleting or deleted identity, the response is a uniform 404 with `Cache-Control: no-store`, so suspension and absence cannot be told apart.

**Fetching.**

- Responses carry credentialless CORS (`*`), never vary on cookies, and send `Referrer-Policy: no-referrer`.
- Fetches use the protocol §2 manifest rules: HTTPS, no redirects (except that a source's `308` for a moved identity is a hint, handled under identity portability §10 and accepted only through a verified move record), bounded size and time, and server-side screening of private, loopback and link-local targets, with revalidation of every DNS result.

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
| `organization` or `person` as a relation party | An entity certificate from the party's own provider (§9.5) | Joining a relation instance (§9.4) |

Rules:

1. A connection is **directional**. Authority flows only from grantor to counterparty, and only through grants attached to it (§6). A mutual relationship is two connections, each held by its own grantor. Neither half depends on the other.
2. A connection's states, generation, suspension, disconnection and tombstone semantics are those of [integrations §3.1](integrations.md#31-states), applied to every counterparty kind. Reconnecting creates a new generation, and no earlier grant revives.
3. Either side can end its own half alone:
   - The grantor disconnects through its owner interface.
   - A relation party leaves the instance (§9.6).
   - A member leaves (§5.4).
4. Relation titles and slot names (such as "parent" or "supplier") describe; they never authorize. Authority comes only from the consented grants on each edge (§9.1).

## 5. Membership

How an organization stores its members, what it records for each, and who may invite, remove or change them are its provider's membership and grant policy (§6.3; user decision, 2026-10-22). This section defines only what crosses a party boundary: the invitation a person from any provider opens (§5.1), the certificate the home provider issues and the organization verifies (§5.2), the authority-epoch signal (§5.2a), the membership ID that applications see (§5.3) and the observable effects of a membership ending (§5.4).

### 5.1 Invitation link type

An invitation is a link ([links](links.md) §1–§5, §8) of type `https://spec.bindle.example/links/org-invitation/v1`, issued by the organization's provider and signed with the organization's key.

The type-specific meta members are:

- **`invitee`** (optional): the invitee principal `{iss, sub}`, resolved by the issuing provider at issue time from a handle through the invitee's directory (§3a.2), or locally on the same host. When present, only that principal can accept.
- **`grants_digest`** (optional): a digest of the proposed grants, in a form the issuing provider defines, so a changed proposal invalidates the link. It is opaque to every other party.

What an accepted invitation confers is decided by the organization provider's membership and grant policy, subject to one floor (revision 4.3; Provisional (coordinator), not signed off by the user): an unbound invitation is a bearer capability, so an organization provider **MUST NOT** let an invitation without `invitee` confer governance powers (any part of owner-interface authority, §6.3). Governance powers may be offered only in an invitation bound to the invitee's principal. A provider MAY add further conditions, such as a delay after acceptance; 3sln.me's are in design §12c.3 (review R1-H4).

The link carries no free-text title or inviter-supplied description, as in links §7.1. Display text comes from the owner host's page and is attributed to its origin.

Rules:

- Single use; `exp − iat` ≤ 30 days (**TBD**: final bound). Processing order and uniform errors follow links §8. A bound invitation opened by any other principal yields the same `invitation_invalid` result as an expired or revoked one.
- The issuing provider MAY let the organization withdraw an unaccepted invitation. A withdrawn invitation MUST then be refused exactly as an invalid one (provisional, 2026-10-23).
- The issuing provider MAY offer a pre-acceptance preview of the organization's display name and kind. The preview MUST come from the organization's own record, never from the link or the inviter, and MUST be given only for an invitation the requester could accept at that moment. Every other case, including an unknown organization, MUST get one indistinguishable refusal (provisional, 2026-10-23).
- Before accepting, the owner host MUST disclose:
  - the organization's verified origin and handle;
  - what the organization will learn about the invitee (at least the principal and handle, and any profile fields the invitee chooses to share);
  - that resources the member creates in the organization's pool belong to the organization;
  - where to read the organization provider's membership and grant policy, including who can change the invitee's grants and how (§6.3).
- Acceptance is a request authenticated as in §5.2. The certificate's audience is the organization, and its purpose list includes the acceptance purpose. Acceptance creates the membership, keyed by the certificate's exact `(iss, sub)`, in one commit together with the link's consumption. Because no membership exists yet, step 1 of §3a.5 is satisfied only by the specific live invitation that the acceptance request presents (its `bindle_meta`), when that invitation is bound to the certificate's principal or is unbound. Without the presented link, the existence of some unbound invitation never satisfies step 1, so it cannot be used to make the organization fetch arbitrary issuers (R2-L1).

### 5.2 Member authentication: certificates and signed requests

A member is identified only by their home provider's `(iss, sub)`. The organization's provider never runs a separate sign-in for members. Every member request carries proof of origin: a signature by a holder key that the member's home provider certified, for this organization, within the last few minutes. This holds equally when the home provider is the organization's own provider; in that case the issuer is local and §3a fetches are local reads.

**Certificate.** A member certificate is a compact JWS under the `key-delegation.v1` feature (AMD-O12).

The protected header is exactly `{alg:"ES256", kid:<an active certification kid of the identity (§3a.3)>, typ:"bindle-member-certificate+jwt"}`. This `typ` differs from `bindle-key-delegation+jwt`, so neither profile accepts the other's certificates.

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
| `jti`, `iat`, `exp` | Unix seconds, `iat < exp`. **The lifetime is the issuer's choice** (user decision, 2026-10-22): verifiers learn it from the certificate. An issuer MUST disclose its maximum certificate lifetime and its revocation bound (§14, `key-delegation.v1` members). A verifier MAY refuse certificates longer than its own policy allows, as local policy. A verifier SHOULD instead cap the **effective** lifetime at `iat` plus its own maximum, treating an older certificate as expired with the ordinary uniform error, so that clients simply renew. The disclosed revocation bound is the issuer's claim; a verifier bounds its own exposure by this cap, by status checks, and by the write-age rule (review R4-M3). |

Issuance rules for the home provider:

- It signs only with an `active` certification key of the identity, never with the identity signing key (R4-H1).
- It issues only while the account is active and the member's consent for (`aud`, `client`) is live.
- It issues only on the strength of an authenticated member session at the home provider, or of a client grant the member approved for this (`aud`, `client`). Either must be listed to the member, with the holder keys it has certified, and revocable by the member at any time. Revoking it makes the status of those keys `revoked` (R2-M2).
- `client.origin` MUST be the origin the home provider observed for the requesting document (the embedder origin of its own frame, the `Origin` of the request, or the exact registered redirect URI the certificate is delivered to), never a value taken from request parameters. The certificate MUST be delivered only to documents of that origin, by the same rules as an authorization code (auth) (R2-M3).
- It refuses a holder key that is, or was, an identity key of the account.
- It answers `GET <identity URI>/delegations/<jkt>` with the status semantics of [Parlay §3.4](messaging.md#34-delegation-status-assumed), applied to member certificates.

**Request proof.** With each request, the client presents the certificate and a proof made by the holder key:

- either at the organization's token endpoint, to obtain a member-context token (§7.2);
- or directly on the request, as `Authorization: BindleMember <certificate>` with a `DPoP` header ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html) proof: `htm`, `htu`, `iat` within 60 s, a unique `jti`, and `ath` = the SHA-256 of the certificate).

**Verification.** The organization's provider MUST verify, in this order:

1. The certificate's syntax, `typ`, `bindle`, `v`, `aud` = this organization, purpose, expiry (60 s skew) and `exp − iat` bound. Then, with no network fetch, that a membership or the presented live invitation (§5.1) exists for the origin principal of that `(iss, sub)`, found through the successor index (AMD-P4).
2. The signature, under §3a.5 and §3a.4. The `kid` MUST be an `active` certification key of the identity. A certificate signed by the identity signing key MUST fail (R4-H1).

**No membership oracle** (review R2-H1). Anyone can construct an unsigned or wrongly signed certificate naming any `(iss, sub)`. Step 1 runs before the signature check, so the result MUST NOT depend on whether step 1 passed:

- Every failure at steps 1–6 gives the same error (`invalid_grant` at the token endpoint, the same 401 in the direct form), with the same body.
- The request path MUST NOT perform a network fetch that the request triggered. The organization keeps the identity documents of its members (and of principals named by live bound invitations) warm by **background refresh**, on a jittered schedule independent of requests, within the §3a.4 bounds. A certificate whose key is not in that cache fails uniformly and only schedules a refresh. Whether a request schedules a refresh MUST NOT depend on whether the claimed principal is a member, and the queue it uses MUST be bounded (wargame F-07, 2026-10-23; provisional). An unbound-invitation acceptance (§5.1) is the one case that fetches during the request, and then only after the presented link verified.
- When step 1 fails, the provider performs an equivalent signature verification against a fixed dummy key, so that the cost of the two paths is the same.
- Failed presentations are rate-limited per client and per network, with the same limits whether or not step 1 passed.
3. The proof: its signature by `delegate`, a thumbprint equal to `cnf.jkt`, `htm` and `htu`, freshness, and `jti` replay within the proof window. The replay cache MUST be shared by every instance that accepts requests for the organization; a provider that cannot share it SHOULD require DPoP server nonces (R2-L2).
4. Owner-interface actions only (those the provider's policy treats as such, §6.3): the delegation status at the home provider, cached for at most **60 s**. An unreachable status endpoint fails closed for these actions.
5. `aep` against the epoch recorded for the membership (§5.2a). A certificate whose `aep` is **lower** than the recorded epoch MUST fail. A higher one is an authority reset.
6. The membership and the grants, live, under §6.2.

**Revocation reaching the organization.** When a home provider suspends the member, revokes the consent for a client, revokes a holder key or recovers the account, it stops issuing certificates at once. Outstanding certificates then fail:

- for owner-interface actions, at the next status check (at most 60 s);
- otherwise, at certificate expiry: within the issuer's disclosed lifetime plus 60 s skew. For 3sln.me as issuer, the default is about 11 minutes (660 s), configurable per organization, so about 12 minutes in the worst case.

A home provider MAY also send `connection-revoked` when the organization's provider has an events endpoint. On receipt, the organization ends that member's member-context tokens. This replaces the revision 1 home-validation staleness bound (review R1-H5): renewal needs a fresh certificate, and each certificate is a fresh live check at the home provider.

**Acquisition is out of scope.** How a client obtains a holder key and certificate is not specified here. This specification fixes only the artifact and its verification. Non-normative examples:

- the home provider's embedded elements, which hold a non-extractable key in the provider's own frame and obtain certificates from the provider session the member already has;
- a general Bindle authorization flow at the home provider, for when the member is not signed in there;
- a native or CLI device grant ([device authorization](device-authorization.md)).

Whatever the mechanism, the home provider MUST obtain the member's consent for each (`aud`, `client`) pair before its first certificate, and MUST name the organization (by identity URI and handle) and the client's verified origin when it does.

**What this proves, and its limit.** A verified chain proves that the member's home provider attests that this request came from this identity, through this client, for this organization. That is the proof of origin this specification requires. Identity keys are provider-custodied, so a home provider could forge such a chain for its own users. Every organization trusts each member's home provider for that member, and organizations MAY restrict the issuers they accept. Evidence that is verifiable independently of the provider, such as passkey-signed approvals, is reserved for a later optional profile.

### 5.2a Authority resets at the home provider

A recovered home account keeps its `(iss, sub)`, so whoever completed the recovery inherits the membership (review R1-H3). This section defines the signal that crosses the boundary between the home provider and the organization's provider:

- **Detection.** The organization records the highest `aep` it has accepted for each membership. A higher `aep`, a key reset without continuity (§3a.4), or a `connection-revoked` event from the home provider (whose reason is not disclosed), or the adoption of a move record (identity portability §8.3, §8.5; AMD-P4) each count as an authority reset. Certificates with a lower `aep` fail, so once the new epoch is seen, certificates issued before the recovery stop working at once, and replaying them cannot re-trigger a reset (R2-M1).
- **Missing `aep`.** A home provider that cannot supply a meaningful `aep` MUST NOT issue member certificates. The member is then unable to authenticate. It is never treated as an epoch that cannot change.
- **Effect: minimum hold** (revision 4.3; Provisional (coordinator), not signed off by the user). Without a hold, whoever recovers or takes over a member's home account inherits that member's governance powers in every organization. Therefore, after an authority reset the organization's provider:
  - **MUST** hold the member's governance powers (owner-interface authority, §6.3) until a re-confirmation under its membership and grant policy;
  - **MUST** bind each re-confirmation to the `aep` (or the reset event) it confirms, so a later reset needs a new one;
  - **MUST NOT** let the held member re-confirm themselves through the reset account alone;
  - **MAY** let member grants resume with the next valid certificate.

  Who re-confirms, any delay and how the hold is shown are provider policy. 3sln.me's are in design §12c.3.

### 5.3 Membership identifier

- A membership ID is an opaque string matching `^[A-Za-z0-9_-]{16,64}$`, issued by the organization's provider.
- It is stable per (organization, person principal), including across leaving and rejoining (a new connection generation), MUST NOT equal or encode the person's `sub` or handle, and MUST NOT be reused for another principal.
- A membership is identified by the **origin principal** of the home identity (§3; for a never-moved identity, its full `(iss, sub)`), never by a bare local account ID, even when the issuer is local (AMD-P4). Certificate verification (§5.2 step 1), the membership ID and `member-removed` therefore follow the member across key rotations and moves. How the provider stores memberships is its own choice.
- The organization's own applications receive the same membership ID for the same member (§7.2). This deliberately lets an organization's applications agree on a member. It does not prevent an application that the person uses in several entities from linking that person's membership IDs (§12).
- In actor chains sent to other entities (§9.5), the organization MUST send a **pairwise** identifier per grantor unless the grant's `actor_disclosure` is `"named"`. For example, an HMAC of the membership ID under an organization secret, keyed by the grantor.

### 5.4 Ending a membership

- How a membership can end (removal, expiry, the member leaving) and who may end it are the provider's membership and grant policy. Whatever the cause, ending a membership sets its connection to `disconnected` in one commit, which also:
  - ends the member's member-context tokens and owner-interface sessions;
  - enqueues `member-removed` to each of the organization's integrations that has obtained member context for this membership (§7.4);
  - stops issuing entity certificates that name this member (§9.5). Outstanding ones end within their lifetime (§9.6).
- A member MUST be able to leave through the organization's provider at any time.
- Leaving or removal MUST NOT transfer, delete or change ownership of any resource. Resources belong to exactly one entity.

## 6. Grants and effective authority

### 6.1 Grant caveats

A grant ([protocol §4](protocol.md#4-grants-and-live-authorization), [security](security.md#grants-and-resource-authority)) attached to a connection MAY carry:

| Caveat | Applies to | Meaning |
| --- | --- | --- |
| `expires_at` | integration grants and relation edges (member grants: provider policy) | Unix seconds. After it, the grant is unusable, and every live check treats it as revoked. |
| `reshare` | relation edges (from the access entry) | Default `false`. When `true`, the grantee may grant the resource onward in another instance (§9.7). **TBD in this version: providers MUST refuse `true`.** |
| `actor_disclosure` | relation edges (from the access entry) | `"pairwise"` (default) or `"named"`. With `"named"`, actor chains name the member by verified `(iss, sub)` (§13). |

What a member may do inside the organization is recorded however the provider's membership and grant policy chooses; this document defines no member grant format (revision 4.2). Grants to integrations are unchanged: fragment-based. Grants to relation parties are fragment-based too, bounded by the access entry (§9.2).

### 6.2 Effective authority

For every call, the provider hosting the resource MUST authorize the intersection of the following, each checked live immediately before execution, as protocol §4 requires:

1. Every grant along the actor chain. For a member acting through an application in organization O on O's resource R:
   - the live grant O→application, through its fragment assignment;
   - the member's authority on R under O's membership and grant policy, evaluated live.

   For an imported resource (§10), add the live grant grantor→O on R. The grantor checks that one, and O checks the hops inside O before issuing an entity certificate (rule 4, §9.5).
2. The state and generation of every connection along the chain.
3. The resource's implemented contracts and the requested method.

**Interoperable outputs** (revision 4.2). Applications and counterparts never see member grant records. They see only results derived from this intersection: the member-context projection and tokens (§7.2), brokered tokens for integration-hosted resources (integrations §5.3), the `methods` of entity certificates (§9.5) and, in phase B, member-scoped field values (§8) and the effective-methods output (§7.5). A provider MUST derive each of them from the intersection above.

Rules:

1. **No implicit flow.** A connection, a relationship label or a counterparty's own authority confers nothing. Authority over a resource exists only through a grant naming that resource (or its scope) on that connection.
2. **Use within the grantee.** An entity grantee MAY exercise a grant only through its own members and its own connected applications, each within its own grants to them. It MUST NOT exercise it for any other entity unless `reshare` applies.
3. **Owner-interface authority is not a grant.** It is never obtainable by an application, never attached to an entity grantee and never part of a token in this version.
4. **Deputies check before certifying.** A provider that issues an entity certificate (§9.5), or requests a token at another entity's provider, on behalf of its member or application MUST first evaluate its own hops under this section, including its own membership and grant policy, and MUST NOT certify or request more than that evaluation allows.
5. **Organization as itself.** An integration acting for an organization with no member present (offline access, integrations §3.4) is authorized by the organization's grants to it alone. Member grants do not limit this access, so it is a superset of every member-context authority the same client can obtain (review R1-H1). Therefore:
   - Before approving a connection, the owner interface MUST disclose that organization-as-itself access is not limited by member grants.
   - A provider MUST let the owner approve a connection **without** organization-as-itself resource access. Such a connection may still read its configuration, receive events and contribute resources; it MUST NOT obtain tokens for resource RPC with no member present.
   - The audit MUST distinguish organization-as-itself calls from member-context calls (§13).

### 6.3 Owner interface

- **Internal to the organization** (decided by the user, 2026-10-22). Who operates an organization's owner interface, what each member may do inside the organization, and how either changes are the organization provider's own **membership and grant policy**. It covers member records, member grants, templates, governance powers, owner and admin rules, consent, approval and delay rules, holds after authority resets above the §5.2a floor, organization recovery and any change of control without the recovery file (§3), ownership and moves (identity portability §6.1 item 4). Beyond the security floors below, this specification defines none of it.
- The interoperable constraints are only these:
  - **Disclosure.** The policy is disclosed to a person before they accept an invitation (§5.1). *(Revision 4.4.)* The disclosure says whether control of the organization can change without the recovery file (§3), and if so, who can start that and what can stop it.
  - **Authentication.** Owner-interface requests by members are authenticated under §5.2, including the status check of step 4. The provider's own console is a client like any other: its certificates name the console's client. A provider MAY authenticate a member whose home issuer is local by its ordinary session instead, if that session is bound to the same `(iss, sub)` and the §5.2a epoch rules still apply.
  - **The protocol's "owner".** Everything protocol §3, extensions §5.1 and integrations §3 reserve to "the owner" is exercised through the owner interface, with the same disclosures. That includes assigning preference values and occupants, approving integrations and disconnecting them.
  - **Never outward.** Owner-interface authority never reaches applications or other entities, and never crosses a relation edge (§6.2 rule 3).
  - **Security floors** (revision 4.3; Provisional (coordinator), not signed off by the user). Governance powers are held after an authority reset (§5.2a), and never conferred by an unbound invitation (§5.1). These protect members whose home is another provider, so they are minimum requirements, not policy choices.
- *Non-normative example:* the 3sln.me membership model and grant-management policy ([design §12b](../architecture/organizations-design.md#12b-3slnme-grant-management-policy-app-feature-not-spec), [§12c](../architecture/organizations-design.md#12c-3slnme-membership-model-provider-policy-not-spec)). Revision 4.2 moved the former requirements on partial owner-interface grants (R1-L6), on never leaving an organization without an operator, and on auditing owner-interface actions there.

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
- A provider MAY bound the live member-context tokens of one `(membership, client)` pair. Reaching that bound MUST end that pair's oldest token rather than refuse the request, and member-context tokens MUST NOT count against a bound shared with other members or with the organization's own application tokens, so one member cannot lock out the others (wargame F-06, 2026-10-23; provisional).
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

### 7.5 Effective methods (phase B)

Revision 4.3; Provisional (coordinator), not signed off by the user (design Q15). An application that keeps its own data, or hosts integration-hosted resources, must enforce the member's authority itself. It gets a standard **output** for that, never the grant records.

- In member context, the preferences projection MAY include, for each resource field value the application can reach, an `effective_methods` member: an array of method names the acting member may invoke on that resource through this application, derived from the §6.2 intersection at the time of the read. A provider that declares `organizations.v1` with `effective_methods: true` (§14) MUST include it.
- It MUST NOT include grant records, grant sources, governance powers, templates, other members' authority, or a grant's `expires_at`. It is a point-in-time statement, not a credential.
- It is advisory. Authorization stays live per call (§6.2); a call outside the listed methods still gets the ordinary refusal, and a listed method can still be refused if authority changed since the read.
- It MUST be absent in organization context (§6.2 rule 5) and for fields the projection omits.
- An application that enforces authority over its own data SHOULD re-read the projection, or rely on `member-removed` and its own short cache, rather than trust an old value.

## 8. Member-scoped fragment fields (phase B; TBD)

**TBD.** This section reserves the following and defines no requirement yet.

- A fragment field MAY declare `"scope": "member"` (AMD-O11).
- Its values are set per member through the owner interface and are atomic types only in the first version.
- A preferences read in member context returns the acting member's values. A read in organization context omits member-scoped fields.
- Applications cannot write them.
- Consent discloses that administrators set them per member.

## 9. Relations

Revision 3 replaces the offers and grantor-minted tokens of revisions 1–2 with relations. The user proposed relations on 2026-10-21; [design §8a](../architecture/organizations-design.md#8a-relations-proposal-assessment) gives the assessment. Connections, fragment grants, the intersection rule (§6.2) and imported resources (§10) remain as the mechanics underneath.

### 9.1 Model

A **relation** is a public, versioned document describing one kind of association between entities. It names **slots**, each with an arity. Its **access matrix** states which preferences fragment an entity in one slot may grant to an entity in another slot, with which fields and methods.

A **relation instance** is one concrete association: the entities that have each explicitly joined it in a slot.

**Authority** comes only from consent at each end of each edge:

- The grantor consents to granting its own fragment values to that counterparty.
- The grantee accepts receiving them.

The document bounds what may be granted. It grants nothing, and neither a relation's title nor a slot name confers anything. This is the consent model protocol §3 already applies to applications, with an entity in place of the application. A grantee entity consumes a grantor's fragment exactly as an integration does.

**Mechanics.** An instance is a set of directional connections (§4) with counterparty kind `entity`, at most one per ordered pair of parties. Each carries fragment grants derived from the matrix entries that apply to that pair. Requests travel with entity certificates (§9.5). Values received appear in the grantee's pool as imported resources (§10).

### 9.2 Relation document

The relation document is served as an artefact envelope ([artefacts](artefacts.md) §2) whose `versions` entries each hold a complete body. One version's body:

```json
{"id":"https://erp.example/relations/supply",
 "title":"Supply","description":"A buyer and its suppliers exchange purchase orders and invoices.",
 "publisher":"https://erp.example","crit":[],
 "slots":{
   "buyer":{"title":"Buyer","arity":{"min":1,"max":1},"kinds":["organization"]},
   "supplier":{"title":"Supplier","arity":{"min":1,"max":256},"kinds":["organization","person"]}},
 "access":[
   {"grantor":"buyer","grantee":"supplier","required":true,
    "fragment":"https://erp.example/buses/purchase-orders","version":1,"digest":"sha256-…",
    "methods":{"bus":{"https://spec.bindle.example/contracts/event-bus/v1":["read","subscribe","unsubscribe"]}}},
   {"grantor":"buyer","grantee":"supplier","required":false,
    "fragment":"https://erp.example/fragments/po-desk","version":2,"digest":"sha256-…",
    "fields":["orders"],
    "methods":{"orders":{"https://erp.example/contracts/purchase-order/v1":["status","acknowledge"]}}},
   {"grantor":"supplier","grantee":"buyer","required":true,
    "fragment":"https://erp.example/buses/invoices","version":1,"digest":"sha256-…",
    "methods":{"bus":{"https://spec.bindle.example/contracts/event-bus/v1":["read","subscribe","unsubscribe"]}}}]}
```

**Relation slots.** "Slot" in this section means a *relation slot*. Where that could be confused with an extension slot (extensions §2), whose manifests access entries may reference, write "relation slot" (user decision, 2026-10-22).

- 1–8 slots. Names match `^[a-z][a-z0-9-]{0,31}$`.
- `arity` is `{min, max}`, with 0 ≤ min ≤ max ≤ 1024.
- `kinds` is a nonempty subset of `person` and `organization`.

**Access entries** (1–64):

- `grantor` and `grantee` are slot names. They MAY be equal, so siblings in one slot can share with each other. An entity never grants to itself.
- `fragment` is a pinned reference (§9.8) to a fragment, including slot and bus manifests.
- `fields` is a subset of the fragment's fields. Absent means all of them. Narrowing is enforced by the grantor's provider, which is the only party that ever projects the grantor's values, so it holds across providers (review R3-L2). It narrows which fields are shared, not the data behind a resource; that is bounded by `methods` and the grantor's per-edge scope choice. Atomic values become the grantee's copies when read.
- `methods` is the exact contract → methods map for each resource field it covers, in the shape of a fragment request (protocol §3). It is required for every resource field covered.
- `required` defaults to `true`. An edge is live only when every required entry for that pair is granted. A grantor MAY decline optional entries.
- `reshare` defaults to `false`; **this version refuses `true`**. `actor_disclosure` is `"pairwise"` (default) or `"named"`. Both carry the §6.1 caveat meanings.
- **The document sets ceilings, the edge decides** (review R3-M3). The document's `reshare` and `actor_disclosure` are the most an edge may carry. They are not imposed by the publisher: the grantor consents to any `reshare`, and the grantee accepts any `"named"` disclosure, per edge. Either side may stay below the ceiling, and an edge below it is still live.

**Processing.**

- The document is I-JSON, at most 32 KiB. Unknown members are ignored, unless named in `crit`, which makes the document invalid for a processor that does not implement them. Unknown members are fail-closed in that sense (review R1-L2).
- Metadata is untrusted plain text. `publisher` is shown only when it is same-origin with `id`, and always as unverified, as for slots (extensions §5.1).
- A provider MUST NOT create a grant from a relation document without the grantor's consent for that counterparty (§9.4).

**Versioning: the `relation` kind and its growth points** (artefact-references review R1-L2). A relation document is an artefact line of kind `relation`. This table registers that kind's growth points under [artefacts §6.3](artefacts.md#63-growth-points-by-kind). Additivity is as defined there, ART-D6: version *N*'s body embeds in version *N*+1's, arrays only append, and text is frozen. Until this table is signed, validators process `relation` as an unknown kind (artefacts §6.4): they may use the versions they hold pins for, and they never advance a head.

| Pattern | Operation | Constraint | Widening for existing edges? |
| --- | --- | --- | --- |
| `/slots` | add-member | The new slot has `arity.min` = 0, stated explicitly, so no existing view becomes incomplete. | No. New slot holders get edges only by per-edge consent (§9.4). |
| `/access` | append | A valid entry. `required: true` is allowed only if version *N* has no entry for the same (`grantor`, `grantee`) slot pair; otherwise it is `required: false`, so existing edges stay live. | **Yes**, for every edge whose pair the entry applies to |
| `/access/*/fields` | append | Only where that entry has `fields` in version *N*. An absent `fields` already means every field of the pinned fragment version, and cannot grow. The new name exists in the entry's pinned fragment version, and a resource field arrives together with its `methods` member (next row). | **Yes** |
| `/access/*/methods` | add-member | Only for a field appended to `fields` in the same version | **Yes** |
| `/access/*/methods/*/*` (one contract's method array) | append | A method of that contract. Adding a new contract key for an existing field is not allowed, as with `contracts` lists (artefacts §6.3). | **Yes** |

**Superseding entries.** A relation cannot change an existing entry's fragment pin in place: `version` and `digest` are values, and values are frozen. To follow a fragment's growth, a later version appends an entry for the same (`grantor`, `grantee`, fragment line) with a higher fragment `version`. For edges pinned at or above the version that appended it, that entry supersedes the earlier ones. It MUST embed the earlier entry's grants: the same `required`, the same ceilings, `fields` ⊇ and `methods` ⊇. Superseding is a **widening** whenever the later fragment version or the larger sets add anything for that pair.

**Never additive** (changing any of these needs a new relation `id`):

- `id`, `kind`, `crit`, `publisher`, and every title and description (text is frozen);
- slot names, as keys;
- `arity`, whether tightened or loosened;
- `kinds`;
- in an existing entry: `grantor`, `grantee`, the fragment reference (`fragment`, `version`, `digest`), existing `fields` and `methods` members, `required`, and the `reshare` and `actor_disclosure` ceilings;
- adding a top-level member;
- removing, reordering or narrowing anything.

Raising a ceiling is therefore not additive either. It can only be done by appending a superseding entry, and superseding entries keep the same ceilings, so in practice it needs a new `id`. This replaces revision 3's statement that raising a ceiling counts as widening (review R3-L4).

**Upgrades** (§9.6; artefacts §10.5). An edge pinned at *N* that moves to *M* computes the delta for its own (`grantor`, `grantee`) pair: entries appended or superseded, and fields or methods appended, between *N* and *M*.

- **A non-empty delta is a widening.** The grantor consents, choosing values for any new entries or fields, and the grantee accepts, with the delta shown to both.
- **An empty delta** (only other pairs or new slots changed) advances the pin without asking, and is recorded in the access history.
- **Pinned versions stay authoritative.** An edge pinned at *N* never receives an entry, field or method added after *N*. A declined delta leaves the edge working at *N*.

### 9.3 Instances, parties and edges

- **Instance identifier.** An opaque HTTPS URI minted by the provider of the entity that creates the instance, for example `https://3sln.me/relations/i/<uuid>`. It identifies the instance and confers nothing. No provider holds authority over other parties' edges. *(Revision 4.5.)* It MUST contain at least 122 bits of randomness and MUST NOT be derived from the parties or the relation. It is not a secret (applications see it, §10), so no rule depends on its secrecy.
- **Participation.** Each party's provider holds that party's participation: the instance, the relation pin, the party's slot or slots, its state, the counterparts it has accepted and the grants it has given.
  - An entity MAY hold several slots in one instance, and MAY join several instances of one relation. Each (instance, slot, party) is distinct.
- **Edges.** For each access entry and each pair (X in its `grantor` slot, Y in its `grantee` slot, X ≠ Y), the edge X→Y is live when all of these hold:
  - X consented to grant that entry to Y;
  - Y accepted receiving from X;
  - both participations are live;
  - both ends pin a common relation version that contains the entry (§9.6).

  Grantor consent includes choosing which of X's assigned resources Y may use, as protocol §4 requires per consumer. Adding resources to X's fragment later never extends Y's access without new consent.
- **Recognition is per edge** (user decision, 2026-10-21). Party X *recognizes* party Z in an instance exactly when at least one edge between X and Z is live. Recognition is not instance-wide.
  - Each existing party whose slot grants to Z's slot recognizes Z independently, by consenting with its own fragment values.
  - Each party that only receives from Z recognizes Z by accepting.
  - Until then, that edge does not exist.
  - Parties whose slots have no access entries with Z's slot never need to recognize Z.
- **Partial membership is a normal state.** No roster, document or provider holds "the members of the instance". Each party's **view** is its own recognized set, plus its counterparts' participation statements. Some parties may recognize Z while others decline, ignore it or have not yet decided. This is neither an error nor an inconsistency, and no protocol step waits for it to converge.
- **Arity is per view.** A party MUST NOT recognize more holders of a slot than its `max`. `min` is advisory: a view below `min` makes the relation incomplete for that party, which a provider MAY surface, and it never invalidates existing edges. Two parties may each recognize a different holder of a slot with `max: 1` (review R3-M1, reframed). Authority is unaffected, because every edge is consented separately. Applications and providers MUST NOT treat a slot holder as globally unique. They MUST key anything derived from an instance by (instance, own view, counterpart `(iss, sub)`), never by instance and slot alone. Every relation invitation MUST carry the inviter's own participation statement for the instance, and the invitee verifies it.
- **Participation statement.** A JWS signed with the party entity's identity key, with header `typ: "bindle-relation-participation+jwt"` and payload exactly:

  ```json
  {"bindle", "v", "instance", "relation": {"artefact", "version", "digest"}, "slot", "party": {"iss", "sub"}, "invitation"?, "iat", "jti"}
  ```

  It is evidence of the party's own claim, verifiable through §3a, and confers nothing.

  **Freshness** (revision 4.5; Provisional (coordinator), not signed off by the user). A statement is not revocable, so it is accepted only while fresh:

  - A provider MUST sign a participation statement only when it presents it, and only for a participation that is live, or that it records as pending in the same commit (§9.4 step 5).
  - A verifier MUST refuse a statement whose `iat` is more than 30 s in the future, and also:
    - when carried in a relation invitation, an `iat` more than 300 s before the invitation's `iat`;
    - when returned at redemption or carried in an introduction, an `iat` more than 300 s before the time of verification.
  - A statement verifies only under the party's `active` signing key (§3a.3). An invitation whose statement no longer verifies, for example after a key rotation, fails as invalid, and the inviter issues a new one.
  - Freshness does not bind a holder of the identity signing key outside the provider, such as a holder of a recovery file (§3). Such a holder can sign fresh statements, which still confer nothing: redemption and every edge are checked at the parties' own providers.

### 9.4 Joining

**Relation invitation link.** A link of type `https://spec.bindle.example/links/relation-invitation/v1`, signed with the inviting entity's key. Its type-specific meta members are:

- `instance`;
- `relation` `{artefact, version, digest}`;
- `slot` (the slot offered);
- `invitee` `{iss, sub}`, required;
- `accept`: the invitee provider's `relations.v1` `accept_endpoint`, resolved at issue time.

It is single use; `exp − iat` ≤ 30 days (**TBD**). Errors are uniform under links §8. The inviter's provider MAY let the inviting entity withdraw an unredeemed invitation; a withdrawn invitation MUST then be refused exactly as an invalid one (revision 4.5).

**Acceptance** at the invitee's provider follows the links §9 opener pattern: a top-level form POST of the link alone, which accepts nothing by itself. The invitee's provider then:

1. Authenticates a person who can operate the invitee's owner interface.
2. Obtains the pinned relation version and validates its hash (§9.8).
3. Discloses:
   - the inviter's identity URI, handle and verified origin. Entities on one provider share an origin, so the origin alone does not identify the inviter (review R1-M6);
   - the relation's title and host, with the publisher shown as unverified. If the invitee has never used this relation `id`, or uses a different `id` with the same or a similar title, the page MUST say so prominently (review R3-M6);
   - the slot;
   - the access matrix **as it applies to the invitee**: what it would receive, and what it would grant, from which of its own fragments, with which fields and methods;
   - the caveats;
   - that the counterparty's provider sees the actor chain;
   - that copies already read cannot be recalled.
4. Lets the admin configure any fragment the invitee would grant that is still unconfigured, inline, as incremental authorization §4.2 does. The admin chooses the resources per entry.
5. Records the participation and the grants it gives, in one commit, as **pending**. They become live only when redemption succeeds, and are discarded if the inviter refuses (for example because its view of the slot is full) (review R3-L1).

**Redemption.** The invitee's provider POSTs `{invitation, statement}` to the inviter's `relations.v1` `join_endpoint`. `statement` is the invitee's participation statement, with `invitation` set to the digest of the invitation meta.

The inviter's provider verifies:

- the statement, through §3a.5, with no request-triggered fetch beyond what the presented, verified invitation justifies;
- that the statement matches the invitation's `invitee`, `instance`, `relation` and `slot`;
- that the invitation is live;
- that the statement is fresh (§9.3).

It then records the counterpart, activates the grants the inviter consented to when inviting, and returns its own participation statement, which the invitee's provider verifies under §3a.5 and §9.3 before activating its own pending participation. *(Revision 4.5.)* The response carries no events endpoint: each side delivers later events under §9.9, starting with the grantor's `relation-edge-state` for each activated grant half, which tells the grantee the resources it may use.

**More than two parties: proposal and admission** (user decision, 2026-10-21).

- **Proposal.** Any party MAY propose a newcomer Z for a slot. Its provider sends an **introduction**, a relation event of type `…/events/relation-introduction/v1` (§9.9), to each counterpart it has a live edge with whose slot has access entries with Z's slot. The introduction carries:
  - `instance`;
  - `slot`;
  - `candidate` `{iss, sub}`;
  - the proposer's participation statement.

  An introduction confers nothing. It only lets the receiving party's provider queue a decision for its operators. A party MAY also propose itself, by asking an existing party for an invitation out of band.
- **Admission into an edge** needs that edge's grantor to consent, with its own fragment values, and its grantee to accept. In practice, a grantor that decides to recognize Z issues Z a relation invitation, and redemption follows as above. Nothing else admits Z into any edge. Admission into one edge never implies admission into another.
- **Recognition notices.** A party that recognizes or declines an introduced candidate MAY tell the proposer, with no reason given, as a `relation-recognition/v1` relation event (§9.9). A party MUST NOT tell anyone other than the proposer, and never the candidate, that it declined or has not decided.
- **What the newcomer sees.** The candidate learns only the edges that exist: the invitations it receives and the edges it redeems. Providers MUST NOT disclose to Z which other parties were introduced to it, declined it or have not decided. Z's interface MUST NOT imply that parties without an edge to Z share anything with it.

- A party MAY pre-accept *receiving* from future parties of a slot. Receiving exposes none of its own resources, but it does admit counterpart-authored data, such as purchase orders and invoices, into its pipelines (review R3-M2). Therefore each counterpart admitted under pre-acceptance MUST be shown to the party's operators, and imported resources from it MUST be marked as pre-accepted to the party's integrations, keyed by the counterpart's `(iss, sub)`. A provider MAY hold such imports `unavailable` until an operator confirms.
- A party MUST NOT pre-consent to *granting* to future parties in this version.

### 9.5 Entity certificates and requests

An entity acting at a counterpart's resources authenticates with an **entity certificate**: a holder key certified by the acting entity's own provider. It is the counterpart of the member certificate (§5.2), and it replaces revision 2's client assertions and grantor-minted token requests.

The header is exactly `{alg:"ES256", kid:<an active certification kid of the entity (§3a.3)>, typ:"bindle-entity-certificate+jwt"}`. The payload contains exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"entity-certificate"`, `1` |
| `iss`, `sub`, `identity` | The acting entity |
| `aud` | The counterpart entity's identity URI |
| `instance` | The relation instance |
| `purposes` | `["…/purposes/relation-access/v1"]` |
| `client` | `{client_id, origin}`: the acting entity's application, or its provider gateway, that holds the key |
| `actor` | `{member?, client?}`, asserted by the issuer. `member` follows §5.3 and `actor_disclosure`. |
| `resource` | The grantor's resource ID this certificate is for (one per certificate), taken from the imported resource (review R3-H1) |
| `methods` | The contract → methods map the issuer's own evaluation (§6.2 rule 4) allows for this actor on `resource`, and optionally `scope`. It MUST be a subset of the edge grant. |
| `aep` | The acting entity's authority epoch (§3, §5.2a). Each counterpart records the highest `aep` it has accepted from that entity. A lower `aep` MUST fail, as for members (R2-M1, review R4-M1). Whether to hold edges on an increase is the counterpart's provider policy. |
| `cnf`, `delegate` | As in §5.2 |
| `jti`, `iat`, `exp` | The lifetime is the issuer's choice and disclosed, as in §5.2. Write-capable methods still need a certificate with `now − iat` ≤ 60 s (below). |

**Issuance.** The acting entity's provider issues a certificate only after evaluating its own hops (§6.2 rule 4): the member is live and holds a grant on the imported resource, and the application's connection is live. It binds `client.origin` and delivers the certificate as §5.2 requires. Its status endpoint applies.

**Presentation and verification.** Presentation uses the §7.1 token form (no refresh token, and expiry no later than the certificate's) or the direct form `Authorization: BindleEntity <certificate>` with DPoP.

The counterpart verifies as in §5.2 steps 1–3, with these substitutions:

- `aud` is this entity.
- Step 1 checks that a live edge from this entity to the certificate's entity exists in `instance`, keyed by the acting entity's origin principal through the successor index (AMD-P4).
- The no-oracle and background-refresh rules of §5.2 apply unchanged.

It then authorizes the call under §6.2: the envelope's `resource`, contract and method MUST match the certificate's `resource` and `methods`, and MUST fall within the live grants of the edge from this entity to the acting entity **in the certificate's `instance`** only (review R3-H1, R3-M4). Grants on other edges between the same two entities never apply. Without per-certificate scope, the deputy's own evaluation would bind nothing: one certificate issued for a member allowed `get` on one ledger would reach every resource and method on the edge.

**Write-capable methods** (contracts method metadata) additionally require a certificate with `now − iat` ≤ 60 s, or a status check at the issuer no older than 60 s. The grantor cannot see revocations inside the acting entity (review R1-M1). For this rule, a certificate whose `iat` is more than 30 s in the future is invalid, and no further skew is allowed: the effective bound is 90 s (review R3-M4). An application in relay mode obtains such certificates by re-reading its projection; write-heavy applications SHOULD use proxy mode or the token form, which needs one exchange per minute.

**Journal and integration-hosted resources.**

- Calls are journaled under the key (grantor entity, acting entity, `client_id`, `tx`) (review R1-L1).
- For a grantor's integration-hosted resource, the grantor's provider mints a brokered token (integrations §5.3) with `client_id` = the acting entity's identity URI and the verified actor in `bindle.actor`.

**Provenance.** Every call at a counterpart thus carries the acting entity's provider-signed identity and asserted actor. Resources and applications record both (§13).

### 9.6 Leaving, removal, upgrade and dissolution

- **Leaving.** A party leaves unilaterally. Its provider disconnects all of its outgoing connections in the instance, stops issuing entity certificates for it, and sends `relation-edge-ended` relation events (§9.9) to each counterpart. Counterparts end their edges to that party.
- **Removal.** There is no instance-wide removal. Each grantor ends its own edges to a party, which is always allowed, as is narrowing to optional entries only. A party is "out" from X's point of view when X has no live edge with it.
- **Grantee-side revocation.** When a member or application inside the acting entity loses its grant, the acting entity stops issuing certificates for it at once. Outstanding certificates end within the issuer's disclosed lifetime plus 60 s skew. Write-capable methods stop within 60 s (90 s with skew), because of the age rule in §9.5.
- **Upgrade.** Each edge is pinned to a relation version that both ends accepted. Moving an edge to a later version requires both ends to pin it. When the later version widens what the edge carries (new entries, fields or methods applying to that pair), the grantor consents to the wider grant and the grantee accepts it, with a disclosure of the difference. Otherwise the move completes when both have pinned. Versions are additive, so an upgrade never narrows anything.
- **Expiry.** A participation and individual grants MAY carry `expires_at` (§6.1).
- **Dissolution.** An instance ends when it has no live edges. Imported resources from ended edges become `unavailable`. Grantee fragments that had them assigned report the field in `requiresConsent`, as AMD-C3 does for unapproved resources. There is no recall. Audit history is kept (§13).
  - Dissolution, like membership of an instance, is a per-party view: each party knows only that its own edges ended (review R3-L3).
  - If the field was required by an integration's setup fragment, that connection returns to `configuring` (integrations §3.1), and the owner is told why.
  - Atomic values and records the grantee already copied, including bus records and cached projections, stay with the grantee. Data the grantee wrote into the grantor's resources stays the grantor's.

### 9.7 Re-sharing (TBD)

**TBD.** This reserves `reshare:true`. A grantee would then assign an imported resource to an entry it grants in another instance. Every certificate would still be verified by the resource's host against every hop. Assigning imported resources to the grantee's *own* fragments for its own members and applications is ordinary use within the grantee (§6.2 rule 2), not re-sharing.

**Composition rule** (review R3-H2). Because an imported resource can sit in the same fragment that the grantee grants to another entity, re-sharing could otherwise happen by composition (for example a generic storage fragment, holding an imported ledger, granted in a `share` relation). Therefore, in this version:

- When a provider projects or grants one of its entity's fragments over an edge, it MUST omit imported resources from every resource field. The edge consent page MUST NOT offer them.
- A provider MUST issue entity certificates only for its own entity's members, applications and gateway, never on behalf of another entity's actors.
- A resource host refuses a certificate whose `iss` is not the grantee of a live edge in `instance` (above), so a third entity cannot use a re-shared reference directly. A proxying provider can still forward a third party's requests under its own identity. That is a violation of §6.2 rule 2 that the host cannot detect, and the relation acceptance page discloses it.

### 9.8 Integrity references (dependency)

The [artefact references](../architecture/artefact-references.md) design and its draft [spec/artefacts.md](artefacts.md) (both provisional, by another agent) define references between public artefacts as three members, the container's URL member plus `version` and `digest` (ART-D5), over envelopes of additive versions (ART-D2, ART-D6), with validation (ART-D7) and caching (ART-D8). This section depends on it for four things:

1. **Fragment references.** References from relation documents to fragments, slot manifests and bus manifests, pinned as `fragment` (or `slot`, `manifest`) plus `version` plus `digest`.
2. **Instance pins.** Pins of each edge and participation to a relation `{artefact, version, digest}`.
3. **Extraction.** Extracting a pinned version from a later, additively extended document, and checking its hash.
4. **Caching.** Provider caching of every pinned version a live instance depends on, so instances keep working when a document disappears or is unreachable. Invitations can only be accepted when the pinned version is obtainable.

This also interacts with protocol §3's rule that a fragment URL identifies an immutable version (AMD-O13). Until that design lands, relation documents and the fragments they reference MUST be treated as immutable at their URLs and pinned with the AMD-C2 `digest`.

### 9.9 Relation events (revision 4.5)

Revision 4.5; Provisional (coordinator), not signed off by the user ([design §8b.4](../architecture/organizations-design.md#8b4-across-providers-org-11-what-bindle-must-specify)). A party's provider informs a counterpart about an instance only through **relation events**. Authority never depends on their delivery: each grantor checks its edges live (§9.5), and a lost event never widens anything.

**Edge halves and generations.** For each ordered pair (X, Y) in an instance there are two halves: X's grant half (X→Y, held at X's provider) and Y's acceptance half of it (held at Y's provider). Each half has a generation at its holder, and every change to a half raises it: activation, a change of entries or resources, suspension, resumption and ending.

**Endpoint.** A provider delivers relation events by push ([RFC 8935](https://www.rfc-editor.org/rfc/rfc8935.html)): a `POST` with `Content-Type: application/secevent+jwt` to the `events_endpoint` of the `relations.v1` feature (§14) in the validated manifest of the counterpart's **current** issuer, found through the successor index for a moved identity (§3). It MUST NOT deliver to any other URL, including one received in a response, a link or an event. Delivery follows the protocol §2 fetch rules: HTTPS, no redirects, bounded size and time, and screening of private, loopback and link-local targets.

**Format.** A JWS, at most 32 KiB, whose header is exactly `{alg:"ES256", kid:<an active certification kid of the sending entity (§3a.3)>, typ:"bindle-relation-event+jwt"}` and whose payload contains exactly:

| Member | Definition |
| --- | --- |
| `bindle`, `v` | `"relation-event"`, `1` |
| `iss`, `sub` | The sending entity, at its current issuer |
| `aud` | The receiving entity's identity URI |
| `instance` | The relation instance |
| `aep` | The sending entity's authority epoch (§3, §5.2a) |
| `iat`, `jti` | Issue time, and an identifier unique per event. A retry is re-signed with a new `iat` and the same `jti`. |
| `events` | An object with exactly one member: an event type from the table below, mapped to its payload |

Event types form their own registry, separate from integrations §6.2 (placeholder identifiers under `https://spec.bindle.example/events/`):

| Type | Payload (exactly) | Meaning |
| --- | --- | --- |
| `relation-edge-state/v1` | `half` (`"grant"` or `"acceptance"`), `generation`, `state` (`"live"` or `"suspended"`), and for a live grant half `entries` | The sender's current half of the edge between it and the receiver. For a live grant half, `entries` lists, per access entry the edge carries (by index in the pinned relation version), the granted resources as `{resource, contracts, methods, scope?, expires_at?}`, where `resource` is the grantor's resource ID used in entity certificates (§9.5) and imported resources (§10). |
| `relation-edge-ended/v1` | `half` | The sender ended its half for good. Nothing revives it; a later relationship needs a new invitation. |
| `relation-introduction/v1` | `slot`, `candidate` `{iss, sub}`, `statement` | An introduction (§9.4). `statement` is the proposer's fresh participation statement. |
| `relation-recognition/v1` | `slot`, `candidate`, `outcome` (`"recognized"` or `"declined"`) | A recognition notice, sent only to the proposer (§9.4). |
| `relation-bus-advanced/v1` | `bus` (the grantor's resource ID), `head` | A doorbell (§11; events §7.2). |

**When events are sent.**

- A grantor sends `relation-edge-state` for its grant half after redemption activates it, and after every later change. A grantee does the same for its acceptance half. A party that leaves (§9.6) sends `relation-edge-ended` for each half it held with each counterpart.
- **Anti-entropy.** A provider re-sends the latest `relation-edge-state` or `relation-edge-ended` of every half it holds, at least once a day, after its own identity moves (once the destination is active), and after any outage of its delivery. A receiver that missed an event therefore converges.

**Verification.** The receiving provider MUST perform these steps in order:

1. **Without any fetch**, check:
   - the links §3.1 JWS rules, the size, the exact members, `typ`, `bindle` and `v`;
   - that `aud` is the identity URI of an entity it hosts;
   - that `iat` is no more than 300 s in the past and no more than 30 s in the future.
2. **Without any fetch**, check that the receiving entity holds a participation in `instance` that lists the sender's origin principal (§3) as a counterpart, live or pending. An `iss` that is an earlier host of that identity fails here.
3. **Without any fetch**, verify the signature against the sender's `active` certification keys as already held by the receiver, which keeps its counterparts' keys current by background refresh under §3a.4. The §5.2 no-oracle rules apply: if the key is not held, the event is not processed, and a refresh for that sender is scheduled exactly as it would be for a non-counterpart naming the same issuer, so the schedule does not depend on step 2. The sender's anti-entropy re-sends recover the event.
4. If this `jti` from this sender was already accepted within the `iat` window, stop without reprocessing. A `jti` is recorded only after step 3 succeeds.
5. For a `relation-edge-state` with `state: "live"`, an introduction or a recognition, refuse an `aep` lower than the highest recorded for that sender. A `relation-edge-ended`, and a `relation-edge-state` with `state: "suspended"`, are applied whatever their `aep`, because honouring a narrowing is always safe. A higher `aep` is recorded, with the effect of §9.5.
6. Apply the event. Per (instance, sender, receiver, half): after `relation-edge-ended`, nothing changes the half again; otherwise the highest `generation` wins, and an event at or below the recorded generation changes nothing. Introductions are deduplicated per (instance, proposer, slot, candidate).

The response is `202` for every event that passes step 1, whatever steps 2–6 decide, so the response reveals nothing about participation. An event that fails step 1 gets `400`. A provider MAY shed load by source network before step 1 (`429` or `503`), and MAY drop excess events from a verified sender after step 3 under a per-sender budget, still answering `202`; anti-entropy recovers them. It MUST NOT shed by the sender's claimed issuer before verification.

**Receiving the grant half.** A grantee derives its imported resources (§10) for an edge from the latest live `relation-edge-state` of the grantor's half, and marks them `unavailable` while that half is suspended, ended or unknown. A grantor treats its edge to a grantee as not live (§9.3) while the grantee's acceptance half is suspended or ended. Events never release a hold that the receiver's own policy applies (§9.5).

**Delivery.** Delivery is at least once, and retries follow integrations §6.4. A grantee that misses a narrowing learns of it from its next refused call, or from anti-entropy. A provider MUST NOT send a relation event to any entity that is not a counterpart in that instance. A provider keeps an entity's certification keys published until its final events are acknowledged or 72 h have passed, before it serves that entity's identity document as deleted.

## 10. Imported resources

- Values a grantee receives through an edge appear in its pool as imported resources. Each is keyed by the grantor's `(iss, sub)`, the instance and the entry, never by label or handle (review R1-M6).
- An imported resource can be assigned to the grantee's own fragments for its own members and applications. Its use is then subject to the grantee's own grants (§6.2). Its `status` is `unavailable` while its edge is not live.
- **Relay projection.** Under preferences v2 ([contracts](contracts.md#preferences-v2)), an imported resource MAY be projected to the grantee's application in relay form (AMD-O5):

  ```json
  {"id":"<grantee's scoped reference>","label":"Acme Ltd · Purchase orders","status":"available",
   "contracts":["…"],"token":"<entity certificate>","token_type":"BindleEntity","expires_at":1792500300,
   "grantor":"https://3sln.me/identity/<o>","instance":"https://3sln.me/relations/i/<uuid>",
   "broker":{"endpoint":"https://3sln.me/bindle/rpc","origin":"https://3sln.me","resource":"<grantor resource ID>"}}
  ```

  `token` is an entity certificate (§9.5), issued by the grantee's provider for the application's session key (`cnf.jkt`) with the actor filled in. The application uses it in the direct form at `broker.endpoint`, or exchanges it at the grantor's token endpoint.
- **Where the token may go.** The consumer MUST send `token` only to `broker.endpoint`, only when `broker.origin` equals the origin of `grantor`, and only when `broker.endpoint` equals the `rpc_endpoint` of that origin's validated manifest (review R1-L5).
- **Proxy mode.** Alternatively, a grantee provider MAY proxy calls through its own gateway, using certificates whose `client` is that gateway.

## 11. Event buses across entities

- [Events §2.1](events.md#21-the-slotbus-member) `readers` gains the value `entity` (AMD-O6). Cross-entity exchange uses the outbox model: each entity publishes only to buses it owns. `entity` in `publishers` is **reserved**; it needs a publisher attribution kind carrying the actor chain, which this version does not define (review R1-L3).
- A bus manifest MAY appear in a relation access entry only if it lists `entity` in `readers`. A provider MUST NOT attach a grant on a bus to an entity grantee unless the manifest lists `entity` in the matching member.
- Doorbells (events §7.2) to an entity grantee are `relation-bus-advanced/v1` relation events (§9.9). The grantee provider MAY forward a doorbell for the imported bus to its own integrations.

## 12. Privacy requirements

1. No endpoint, document, link result or error MAY reveal whether a principal is a member of an organization, except to that principal or under §7.
2. Identity documents MUST NOT list members or affiliations (§3a.3). Home-provider records of which organizations a member uses are private and confer no authority.
3. Invitation, relation-invitation, entity-certificate and member-context failures are uniform as specified in §5.1, §9.4, §9.5 and §7.3.
4. Actor chains to other entities use pairwise member identifiers unless `actor_disclosure:"named"` applies.
5. Pairwise identifiers protect against correlation between entities. They do not protect against an application that the person uses in several entities, which can link the contexts through its own client state. Providers MUST NOT describe membership IDs as unlinkable by applications (review R1-M4).
6. Changing an edge from `pairwise` to `named` (through a relation upgrade) lets the grantor link past pairwise identifiers to persons. The grantee's acceptance page MUST say so.
9. Participation in a relation instance is visible only to its counterparts. Relation documents are public, but instances and their parties are not published.
10. *(Revision 4.5.)* Relation events go only to counterparts in their instance, and a receiver's response does not depend on whether the sender is a counterpart (§9.9).
7. A home provider necessarily learns which organizations and clients its member acts in, and when certificates are renewed. Consent at first issuance (§5.2) MUST say so. An organization learns the member's home issuer and `(iss, sub)`. A client holding certificates learns the same (§7.2).
8. Directory fetches reveal to the member's home provider that the verifying organization's provider is evaluating that identity. Caching (§3a.4) bounds how often this happens.

## 13. Audit and export

- Each provider MUST record, for every authorized call on an entity's resources, the actor chain `{entity, via:[{entity?, member?}, {client?}]}` together with the action, resource, contract, method, `tx` and time. Audit entries MUST NOT contain payloads, tokens or preference values (security). Owner-interface actions are audited under the provider's membership and grant policy (§6.3).
- Audit history MUST survive the end of the connection it refers to, for the provider's documented retention.
- An organization's export MUST include its memberships (as principals and membership IDs), the grants it issued, its connections, its relation participations (with relation pins and counterparts' statements), its imported-resource references and its audit, in documented formats. **TBD:** formats and a grantable `audit-log/v1` contract.

### 13.1 Portable membership export (interop requirement)

Revision 4.3; Provisional (coordinator), not signed off by the user (design §12c.4 item 2). Member grants are internal (§6.3), but an organization that moves to another provider ([identity portability](identity-portability.md)) must not lose them. This is the one place internal grants cross a party boundary, and only to the organization's own destination provider.

- An organization provider MUST be able to export, and a destination provider that accepts organization moves MUST be able to import, a **membership export** containing, per membership:
  - the origin principal (§5.3) and current `(iss, sub)`;
  - the membership ID;
  - state (live or ended) and any membership `expires_at`;
  - the member's resource authority as a list of entries `{resource, methods, expires_at?}`, where `resource` is a resource reference in the exporting organization's pool or a scope, and `methods` are contract method names;
  - governance powers as provider-namespaced identifiers (URIs) with a human-readable label.
- The export MUST NOT contain certificates, holder keys, tokens, consent records or audit payloads.
- A destination MUST NOT confer more resource authority than an entry states. It MAY map governance powers to its own policy or drop them, and MUST NOT confer broader governance than the export lists. Imported governance powers count as an authority reset for the §5.2a floor: they are held until re-confirmed under the destination's policy.
- Membership IDs SHOULD be preserved, so the organization's applications keep recognising members. If the destination cannot preserve them, it MUST send `member-removed` for each old ID to integrations that obtained member context.
- **TBD:** the serialization, its media type and signature. Until then a provider documents its format.



## 14. Feature declarations

| Feature | Members | Meaning | When absent |
| --- | --- | --- | --- |
| `directory.v1` | `directory_url` (issuer origin) | Handle lookup and identity documents (§3a). Required of any provider whose identities act in organizations hosted elsewhere, and of any provider that hosts organizations. | Its identities cannot be verified by other hosts. Verifiers fail with no fetch beyond the manifest. |
| `organizations.v1` | `effective_methods` (optional boolean, phase B) | The provider hosts organizations. It verifies member certificates and serves the member-context token form and `bindle_member` (§5.2, §7). With `effective_methods: true` it includes the §7.5 output. | No organizations at this provider. |
| `key-delegation.v1` (with the AMD-O12 purposes) | `max_certificate_seconds`, `revocation_bound_seconds` | As an issuer, it issues member and entity certificates (§5.2, §9.5) and serves their delegation status. The members disclose its longest certificate lifetime and the bound within which a revocation it commits is reflected in its status responses. | Its identities cannot act as members of organizations. |
| `relations.v1` | `accept_endpoint`, `join_endpoint`, `events_endpoint` (issuer origin; `events_endpoint` since revision 4.5) | The provider's entities can be relation parties. It accepts relation invitations (§9.4), issues and verifies entity certificates (§9.5), and serves the §10 projection. | Its entities cannot join relations. |

How a client acquires certificates needs no declaration in this specification (§5.2).

**Provider roles.** Identity hosting and organization hosting are separate roles. A provider may play either or both, and 3sln.me plays both.

| Role | Declares | Does |
| --- | --- | --- |
| Identity provider (persons) | `directory.v1`, `key-delegation.v1` | Publishes identity documents and issues member certificates for its persons |
| Organization provider | `organizations.v1`, `directory.v1`, `relations.v1` | Hosts organizations; publishes their identity documents; verifies member certificates; issues and verifies entity certificates for its organizations |

The common contract between organization providers is §3a plus §9. Between an organization provider and a foreign identity provider, it is §3a plus §5.2. Neither needs prior registration between the providers.

## 15. Core amendments — proposed (unsigned)

| ID | Document | Change |
| --- | --- | --- |
| AMD-O1 | protocol §1, §6 | Define entity kinds `person` and `organization`. Remove "organization membership" from the §6 list of out-of-scope items and point here. Delegation stays out of scope. |
| AMD-O2 | protocol §3 | Replace "only the user's authenticated provider UI" with "only the entity's owner interface (organizations: §6.3)". |
| AMD-O3 | auth; federation-implementation | The member-context token form (`jwt-bearer` grant with a member certificate, DPoP-bound, no refresh token); the token response member `bindle_member`; the `BindleMember` authorization scheme. (Revision 1's `entity` entry member, `affiliation` and `auth_time`/`amr` are withdrawn.) |
| AMD-O4 | integrations §1, §3, §6.2 | Connection counterparty kinds. The `member-removed` and `relation-introduction` events. |
| AMD-O5 | integrations §5.1, §5.3; contracts preferences v2 | Relay projection for imported resources (`token_type: "BindleEntity"`, `grantor`, `instance`); brokered tokens for relation parties with `bindle.actor`. |
| AMD-O6 | events §2.1, §7.2 | The `entity` value in `readers` (`publishers` reserved); doorbells to an entity grantee's events endpoint. |
| AMD-O7 | links | The organization-invitation and relation-invitation link types. Signature-domain table rows for both, for `bindle-relation-participation+jwt`, for `bindle-relation-event+jwt` (revision 4.5), and for the `BindleMember` and `BindleEntity` proofs. (Revision 2's offer type and `bindle-entity-client+jwt` are withdrawn.) |
| AMD-O8 | security, "Grants and resource authority" | Replace "A future organization owner is a separate principal…" with a pointer to §6. |
| AMD-O9 | contracts, "Useful follow-ons" | Replace the organizations sentence with a pointer here. |
| AMD-O10 | protocol §2; contact delivery; links §7.3; Parlay §3.3 | The `directory.v1` feature and §3a as the shared directory profile, replacing the "unwritten profile" references. The identity document `kind`. Entity client metadata (`events_endpoint`, key set) under identity-level `features` (**TBD**). *(Revision 4.5: for relations, the events endpoint is issuer-level, in `relations.v1` (§9.9, §14), and identity documents carry none.)* |
| AMD-O11 | protocol §3 | The field member `scope: "member"` (phase B). |
| AMD-O13 | protocol §3, §6; contracts | Versioned integrity references (URL plus `version` plus `digest`, additive versions, provider caching) as defined by the [artefact references](../architecture/artefact-references.md) design. They replace "a fragment URL identifies an immutable version" for every artefact class that adopts them. Owned by that design. |
| AMD-O14 | protocol §1; the contract registry | Relation documents as a public artefact class (`/artefacts/relations/`), next to fragments, slots, buses and contracts. |
| AMD-O12 | `key-delegation.v1` (currently proposed in Parlay §3.2) | Generalize the core feature to three certificate profiles: `bindle-key-delegation+jwt` (Parlay, unchanged), `bindle-member-certificate+jwt` (§5.2, purposes `member-access` and `member-accept`) and `bindle-entity-certificate+jwt` (§9.5, purpose `relation-access`). Add rows for both, and for the `BindleMember` DPoP proof, to the links §7.2 signature-domain table. The current implementation's "one active delegate key per principal" rule and its messaging-occupant check (`packages/identity/delegation.mjs`) apply to the Parlay profile only. Member certificates instead allow several active keys, at least one per (`aud`, `client`) issuance grant (§5.2), or a member's second organization, client or device would revoke the first (R2-M5). |

## 16. Conformance tests (minimum)

- **Membership:**
  - invitation binding, single use, expiry and uniform errors;
  - membership is keyed by the origin principal of the certificate's `(iss, sub)`; a certificate for one organization fails at another, including on the same provider;
  - a certificate from a principal with no membership or invitation fails before any network fetch;
  - forged certificates naming a member and a non-member get identical status, body and (within tolerance) timing, and neither triggers a request-path fetch (R2-H1);
  - a certificate whose `identity` differs from the directory-derived or pinned identity URI fails without fetching it (R2-H2);
  - a certificate with a lower `aep` than recorded fails (R2-M1);
  - acceptance without the presented invitation link does not satisfy step 1 (R2-L1);
  - an `aep` increase, a key reset without continuity, a `connection-revoked` event and a move adoption are each recognized as an authority reset;
  - owner-interface actions fail closed when delegation status is unavailable, and fail within 60 s of a home-side revocation;
  - a membership ended for any reason is effective on the next call, ends member-context tokens and emits `member-removed`.
  - *(Revision 4.2: tests of holds, re-confirmation, bound governance invitations and the last-admin race moved to the 3sln.me design, §12c.3.)*
  - *(Revision 4.3, floors restored:)* an unbound invitation never confers governance powers; after each kind of authority reset governance powers are held, member grants may resume, and a re-confirmation bound to one `aep` does not cover a later reset.
- **Effective authority:**
  - randomized grant sets satisfy effective ⊆ every ceiling (property test);
  - a member-only resource is invisible to the application, and an application-only resource is omitted in member context;
  - owner-interface powers are never in tokens;
  - a connection approved without organization-as-itself access obtains no resource token with no member present.
- **Member context:**
  - not a member, suspended, client not connected, and a certificate that fails after step 1 are indistinguishable to the application (body and status; timing within tolerance);
  - member-context tokens are DPoP-bound to the certificate's key, never outlive the certificate, come with no refresh token, and Bearer is refused;
  - a certificate naming a different client, or a client not connected to O, gets the uniform result.
  - *(phase B)* `effective_methods` equals the §6.2 intersection for random grant sets, is absent in organization context, and never contains grant records or expiry.
- **Directory and certificates:**
  - a member or entity certificate signed by the identity signing key (the key in recovery files) fails; only an `active` certification key verifies, and recovery files and exports never contain one (R4-H1);
  - an entity certificate with a lower `aep` than recorded fails (R4-M1);
  - an organization recovery that the provider's policy cancels leaves the authority epoch unchanged (R4-M2);
  - *(revision 4.4)* a change of control without the recovery file increases the authority epoch exactly once, when it takes effect, and one that is aborted or closed leaves it unchanged; a counterpart then refuses the organization's entity certificates that carry the earlier `aep`;
  - a verifier capping effective lifetime treats an older certificate as expired with the uniform error (R4-M3);
  - identity documents contain only the permitted members, and unknown and suspended identities give an identical 404;
  - wrong `typ` (including a Parlay delegation certificate), wrong `aud`, a lifetime above the verifier's local policy, a retired or revoked signing key, a holder key equal to an identity key, and a replayed proof `jti` all fail;
  - a key rotation with continuity is accepted silently, and one without continuity counts as an authority reset;
  - a document reviving a retired, revoked or superseded kid, or rolling back to an ancestor key, is rejected and is not treated as a reset (R2-H3);
  - the home provider binds `client.origin` to the observed requester origin and lists every issuance grant and holder key to the member (R2-M2, R2-M3);
  - an unreachable issuer gives a retryable error, never acceptance, and per-issuer fetch budgets hold under a flood of certificates naming unknown issuers.
- **Relations:**
  - an entity certificate is refused for a resource or method outside its `resource`/`methods`, and for grants on another instance's edge (R3-H1, R3-M4);
  - imported resources never appear in a fragment granted over an edge, and a third entity's certificate is refused at the host (R3-H2);
  - a write with a certificate older than 60 s (or `iat` more than 30 s ahead) fails without a fresh status check (R3-M4);
  - an invitation without the inviter's participation statement is refused, and a refused redemption discards the invitee's pending participation (R3-M1, R3-L1);
  - an invalid relation document (bounds, unknown `crit`, an access entry without methods for a resource field, `reshare:true`) is refused;
  - no edge exists without both grantor consent and grantee acceptance; a third party joining needs each grantor's consent; pre-acceptance of receiving never creates outgoing grants;
  - partial recognition is stable: some grantors recognize a newcomer while others do not, without error; an introduction creates no edge; the newcomer cannot learn which parties declined or have not decided; no party recognizes more holders of a slot than its `max`;
  - a relation invitation redeemed by an entity other than its `invitee`, or with a mismatched statement, fails;
  - arity is enforced in each party's view;
  - an upgrade that widens an edge needs grantor consent and grantee acceptance, and one that does not completes automatically;
  - leaving ends all of the party's edges, and dissolution makes imported resources `unavailable` and reports `requiresConsent` in the grantee's fragments;
  - entity certificates: wrong `aud` or `instance`, no live edge, a lifetime above local policy and replayed proofs all fail uniformly with no request-triggered fetch;
  - an organization created on a provider gets a recovery file; a recovery that takes effect increases its `aep`;
  - write-capable methods require certificate age ≤ 60 s or a fresh status check;
  - two acting entities using one `client_id` and one `tx` neither collide nor replay each other's results;
  - a bus without `entity` cannot be granted through an edge;
  - a relation document that has disappeared does not break a live instance whose pinned version is cached.
  - *(revision 4.5)* participation statements: one older than 300 s at presentation (or than the carrying invitation's `iat`), one more than 30 s in the future, one signed by a non-`active` key, and one for a participation that has ended are each refused; a withdrawn invitation is refused exactly as an invalid one; instance identifiers carry at least 122 bits of randomness;
  - *(revision 4.5)* relation events: wrong `typ` (a certificate or an intent attribution presented as an event), wrong `aud`, oversize, and a stale or future `iat` fail at step 1; an event from a non-counterpart, from an earlier host after a move, or naming an unknown instance gets the same `202`, with no request-path fetch and a refresh schedule independent of participation; a re-signed retry with the same `jti` gets `202` and is not reprocessed, and an unverified event never records a `jti`; a live edge state with a lower `aep` is refused, while an end or a suspension is applied; after an end nothing revives the half, and a lower or equal generation changes nothing, under any reordering; an events URL received in a redemption response or event is never contacted, and delivery goes only to the manifest's `events_endpoint`; anti-entropy re-sends converge a receiver that missed events; losing every event never widens access, and a narrowing takes effect at the grantor on the next call; a grantee's ended or suspended acceptance half makes the grantor refuse that grantee's certificates on the edge; an invitation whose statement no longer verifies after a key rotation fails as invalid.
- **Membership export (§13.1):** a round trip preserves origin principals, membership IDs and resource entries; an import never widens an entry; imported governance powers are held until re-confirmed; the export contains no certificates, keys or tokens.
- **Races:**
  - a removal racing token minting;
  - a relation invitation redeemed twice;
  - a connection generation raised mid-request.
- **Privacy:** no membership or participation signal in identity documents, links, invitations or errors; pairwise actor IDs differ per grantor.

## Sign-off checkpoints

- [ ] **O1 — Kinds and connections:** organization as an entity kind; directional connections; no implicit flow.
- [ ] **O0 — Directory:** identity documents, key continuity and caching bounds; verification of unknown providers.
- [ ] **O2 — Members:** home-certified holder keys and signed requests; revocation bounds; membership IDs; uniform member context.
- [ ] **O3 — Relations:** relation documents, consent per edge, instances without a central host, entity certificates, lifecycle; dependency on artefact references.
- [ ] **O4 — Privacy and audit:** no enumeration; pairwise identifiers; actor-chain audit.
- [ ] **O5 — Floors and portable outputs (rev 4.3; Provisional (coordinator), not signed off by the user):** governance hold after authority resets; bound governance invitations; effective-methods output; portable membership export.
- [ ] **O6 — Control changes without the recovery file (rev 4.4; Provisional (coordinator), not signed off by the user):** an authority reset at effect only; disclosure.
- [ ] **O7 — Relation events and statement freshness (rev 4.5; Provisional (coordinator), not signed off by the user):** events signed by certification keys and verified before use; the events endpoint from the manifest only; fresh-only participation statements; invitation withdrawal.

Reviewer / date / notes: _pending; these checkpoints do not block drafting._
