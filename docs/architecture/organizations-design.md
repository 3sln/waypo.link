# Organizations: design spike

Status: **provisional design, 2026-10-21, revision 4.** Revision 4 adopts the user's relations proposal (§1b, §8a), separates provider roles and adds 3sln.me product rules (§12a). Its effect on the review findings is in [Revision 4 reconciliation](#revision-4-reconciliation), and it was reviewed in [Review round 3](#review-round-3), whose resolved findings are applied (R3-…); its open items remain open. Earlier, revision 2 applied the resolved findings of [Review round 1](#review-round-1); open items there remain open. Revision 3 applies the user's clarification (§1a) and is reconciled with the review in [Revision 3 reconciliation](#revision-3-reconciliation). Revision 3 was reviewed in [Review round 2](#review-round-2), whose resolved findings are applied (R2-…); its open items remain open. Design only: nothing here is implemented, routed or production-verified, and no code changed. The coordinator records decisions in DEVLOG.md. Every decision below is unsigned until it gets a reviewer, a date and an outcome. Terminology: [organizations terminology](organizations-terminology.md). Draft normative skeleton: [spec/organizations.md](../spec/organizations.md).

Protocol/security/architecture sign-off: reviewer ___ / date ___ / outcome ___.

## 1. User direction (2026-10-21, summarized)

- **Purpose.** Something like what users have, but for teams, organizations and companies. It is a place to store resources and manage permissions, access and associations.
- **Identity.** Users stay independent, and these units assign grants to specific users. A user's identity is verifiable from their public key and Bindle manifest, so requests are signed and grants derive from the identity.
- **Relationships.** Parent and subsidiary, siblings, a team and its company. Associations change over time, and each unit is self-contained. Permissions and access between units need a story.
- **Public documents.** Hunch: roles and relationships are public documents identified by URI, like fragments and buses. That needs confirmation.
- **First use.** The user's own company ERP. Units need to share artifacts, event buses, message channels and direct resource RPC on limited grants and tokens. Preferences fragments decide which resources integrations get.
- **Elements.** 3sln.me custom elements let an app check, privately, whether its user belongs to its associated unit. Users can switch the active unit, and the app gets events when they do.
- **Shape.** Wargame to find the minimum primitive set and the unknown unknowns. Granular grants, maybe with templates; maybe no roles at all. Be careful about what is a 3sln.me feature and what is Bindle spec.

## 1a. User clarification (2026-10-21)

The user's words: "The point is to allow users from other identity providers to be members of an org provided by some other provider. So requests need to be signed to prove who they came from. … Why do they need a sign in if they're already signed into their identity provider? Maybe as a fallback, a general bindle sign in … Or maybe they just need to integrate something like 3sln.me UI elements; we probably should leave that part open ended."

The coordinator relayed these decisions:

1. "Organization" is accepted, and "entity" stays the umbrella term.
2. Cross-provider membership is core. Requests are signed by a key the member's home provider certified (`key-delegation.v1`, short-lived, bound to issuer and subject). There is no separate sign-in at the organization.
3. The directory/identity-document profile is a prerequisite of phase A.
4. The spec defines the certificate and how it is verified. How a client acquires a certificate is open-ended.
5. Non-repudiation is reframed as **proof of origin from the home provider**. That provider could still forge, and this is stated as a limit. Passkey-signed approvals and organization-key audit checkpoints are later and optional. Re-evaluate review findings R1-H2 and R1-H5 in this model.
6. Phase A includes cross-provider members. Members are stored by `(iss, sub)` from day one.
7. Three questions stay open (§15): the organization's own issuer, the two-admin deadlock, and operator-run apps on account deletion.

## 1b. User input: relations, provider roles, product rules (2026-10-21)

The user had not read this design. They proposed the points below, relayed closely by the coordinator, and asked whether to incorporate them, replace the relationship model with them, or reject them. [§8a](#8a-relations-proposal-assessment) gives the assessment.

1. **Relation documents.** A public, self-describing artefact identified by URI, with named slots. Each slot has an arity and lists fragment references. The document says which fragment of slot X slot Y may access, optionally narrowed to fields. Suggested names: "bond", "coven" or similar.
2. **Instances.** Organization admins opt into an instance of a relation, as a particular slot. An organization may hold several instances of one relation, and several slots.
3. **Fragments.** Everything is shared through preferences fragments. Inside the receiving entity, shared resources can be plugged into its other fragments. Users and organizations learn one concept.
4. **Provenance.** Organization requests bear the organization's identity, and user requests bear the user's (the rev 3 member certificates).
5. **Provider roles.** Identity providers and organization providers are separate roles, and 3sln.me plays both. The common contract must work between organization providers, and between an organization provider and foreign identity providers.
6. **3sln.me product rules.** Creating an organization needs a 3sln.me account. Organizations are always paid. Pricing is tiered at first (up to about 100 TB, plus N AI credits, and so on) and later metered for large organizations.
7. **Versioned integrity references.** Integrity is cross-cutting and designed elsewhere ([artefact references](artefact-references.md), in progress). Relations depend on it.

## 2. Decisions

All decisions are provisional. Each is reversible until the spec is published.

| ID | Decision | Section |
| --- | --- | --- |
| ORG-D1 | **Term.** "Organization" in the spec and the UI ("Org" where space is tight), with an optional display kind label. "Entity" stays the spec umbrella for persons and organizations, and the SDK uses it for the acting entity. **Accepted by the user on 2026-10-21, relayed by the coordinator.** | [terminology](organizations-terminology.md) |
| ORG-D2 | **No new principal type.** An organization is an entity like a person: it has its own `(iss, sub)`, keys, pool, preferences, connections and grants. It has no credentials of its own. Its **owner interface** is operated by members who hold governance powers. On 3sln.me it is an account record of kind `organization` in its own account single writer. | §6.1 |
| ORG-D3 | **The directional connection is the mechanism; users see memberships, integrations and relations.** A connection runs from a grantor to an integration, a person or an entity relation party. A membership is an organization→person connection. Each edge of a relation instance is an entity connection. Each side holds and can sever only its own half (rev 4 wording). | §6.5, §8a |
| ORG-D4 | **Grants, not roles.** Grants are the only authority that Bindle evaluates. A grant names its grantee by connection and carries caveats: `expires_at`; for entity grantees also `reshare` (default `false`) and `actor_disclosure`. The spec defines no roles. 3sln.me offers copy-on-apply templates. App-specific vocabularies such as "approver" are member-scoped fields in the app's own public fragment. | §6.3 |
| ORG-D5 | **Members sign their requests with a key their home provider certified** (rev 3, superseding federated login). A member certificate binds a holder key to the member's `(iss, sub)`, one organization (`aud`) and one client, for at most 600 s. Each request carries a proof by that key. The organization verifies home manifest → identity document → certificate → proof, then checks live grants for `(iss, sub)`. There is no sign-in at the organization. Same-provider members are the case where the issuer is local. | §6.2 |
| ORG-D6 | **Effective authority is the intersection along the chain**, checked on every call. Nothing flows across a connection unless a grant at that hop says so. Re-sharing to a third entity needs an explicit `reshare` caveat. Governance powers are never delegated to apps or to other entities in v1. | §6.4 |
| ORG-D7 | **Member context for apps.** An app gets "member M in organization O" only by presenting a certificate that M's home provider issued for O and for that app, either at O's token endpoint (giving a DPoP-bound token that never outlives the certificate, with no refresh token) or directly on each request. The result binds an opaque **membership ID**. Not a member, not connected and failed verification all look the same to the app. | §9, spec §7 |
| ORG-D8 | ~~Offers and grantor-minted cross-entity tokens.~~ **Superseded by ORG-D15 and ORG-D16** (rev 4). | §8a |
| ORG-D9 | **Membership is never publicly checkable.** Membership IDs are pairwise per organization, actor chains are pairwise per grantor, and no endpoint answers "is X a member of Y". | §9.1 |
| ORG-D10 | **Governance is a provider feature.** 3sln.me v1 has a single `admin` power and recommends at least two admins. Critical actions are delayed and notified, and break-glass recovery uses the existing recovery-file format. None of this is spec. | §7, §10 |
| ORG-D11 | **Resources belong to exactly one entity.** Membership never confers ownership, and leaving transfers nothing. The organization is the controller of its pool, and 3sln.me is its processor. A DPA is needed. | §12 |
| ORG-D12 | **The directory/identity-document profile is specified in [spec §3a](../spec/organizations.md#3a-identity-documents-and-key-discovery-directoryv1)** (`directory.v1`) and is a phase A prerequisite (rev 3). It is shared with BindleBox, links and contact delivery, and may move to a companion document later. | §6.1, §13 |
| ORG-D13 | **Acquiring certificates is out of spec.** The spec fixes the artifact and its verification. Mechanisms are named only as non-normative examples: the home provider's embedded elements with a non-extractable key, a general Bindle authorization flow as a fallback, and native or CLI device grants. 3sln.me's element-based acquisition is an app feature. | §6.2 |
| ORG-D14 | **Proof of origin, not non-repudiation.** The chain proves "this identity's provider attests that this request came from this identity, through this client, for this organization". That is sufficient. The provider could forge, and this is stated as a limit. Passkey-signed approvals and organization-key audit checkpoints are optional later extensions. | §6.2 |
| ORG-D15 | **Relations (the user's proposal, adopted).** Public, versioned relation documents define slots with arity and an access matrix over pinned fragment references. Entities join instances in slots, possibly several slots and several instances. Every edge needs grantor consent (the grantor's own fragment values, per counterpart) and grantee acceptance. The document never authorizes by title or slot name. There is no central host: each party holds its participation. Values received arrive as imported resources, usable in the grantee's own fragments. | §8a, spec §9 |
| ORG-D16 | **Entity certificates.** An organization acting at a counterpart signs its requests with a holder key that **its own** provider certified (`aud` = counterpart, `instance`, `client`, asserted `actor`, ≤ 300 s, and a 60 s age rule for writes). This gives one credential shape for persons and organizations, and replaces grantor-minted tokens and client assertions. | spec §9.5 |
| ORG-D17 | **Provider roles.** Identity hosting (`directory.v1`, member certificates) and organization hosting (`organizations.v1`, `directory.v1` for its organizations, `relations.v1`) are separate roles; 3sln.me plays both. The common contract needs no registration between providers. | spec §14 |
| ORG-D18 | **3sln.me product rules** (user decisions): creating an organization needs a 3sln.me account; organizations are always paid; tiers first, metered later. App feature, not spec. | §12a |
| ORG-D19 | **Integrity references are a dependency.** Relations need references to fragments as URL plus `version` plus `digest` (ART-D5), instance pins to a relation version, and provider caching, from the [artefact references](artefact-references.md) design. Until it lands: immutable URLs plus a digest. | spec §9.8 |

Reviewer ___ / date ___ / outcome ___ (for each row).

## 3. What already exists and is reused

| Need | Existing primitive | Reuse |
| --- | --- | --- |
| Unit identity, keys, pool, preferences | Entity ([protocol §1](../spec/protocol.md)), the identity key registry (`packages/identity/keys.mjs`), the account single writer | Unchanged. An organization is one more account record. |
| Association that can be severed | Connection with state, generation, severance and SET events ([integrations §3, §6, §7](../spec/integrations.md)) | Generalized counterparty (ORG-D3) |
| What an app may touch | Fragment grants, resource fields, scoping ([protocol §3–§4](../spec/protocol.md), [resource scoping](resource-scoping.md)) | Unchanged at the organization level. Intersected with member grants. |
| Short-lived, sender-bound credentials | Brokered tokens with `aud`, `exp` ≤ 300 s and `cnf.jkt`, the generation floor and `access_ends_by` ([integrations §5](../spec/integrations.md#5-brokered-resources)) | Same shape for cross-entity tokens, plus an actor chain |
| Capability documents bound to a principal | Bindle links with a signed meta, an audience proof and single use ([links](../spec/links.md)) | Two new link types: organization invitation and relation invitation |
| Public, pinned descriptions of what may be asked | Fragments, slot and bus manifests; AMD-C2 digests; [artefact references](artefact-references.md) (in progress) | Relation documents, a new artefact class built from fragment references |
| A remote provider passing a link to the user's own provider | Links §9 opener flow (top-level POST to the user's provider) | Relation-invitation acceptance at the invitee's provider |
| Business events between parties | Event buses ([events](../spec/events.md)) | Adds an `entity` consumer kind |
| Asking for more | Incremental authorization ([incremental authorization](../spec/incremental-authorization.md)) | Unchanged for app grants. Member context uses certificates instead of an authorization entry (rev 3). Cross-entity access *requests* are deferred. |
| Signing for a principal without holding its key | `key-delegation.v1` (`packages/identity/delegation.mjs`): certificate, proof of possession, status endpoint, fencing | **Core in rev 3.** A second certificate profile, `bindle-member-certificate+jwt`, audience-bound to one organization (AMD-O12). |
| Verifying keys across hosts | Directory/identity document, until now unwritten ([contact delivery](../spec/contact-delivery.md#authorship-and-signatures)); `keys.mjs` continuity statements; `resolveIdentityKey` directory hook | Specified as `directory.v1` (spec §3a) |
| UI context switching | Islands and `bindle-account-change` ([embed islands §10](embed-islands.md#10-events)), owner-transition rules ([multi-account UI](multi-account-ui.md#owner-transition-is-a-security-boundary)) | Entity context in the switcher and `bindle-entity-change` |
| Rollout | `packages/flags` registry ([feature flags](feature-flags.md)) | Three new class (a) flags (§13) |

## 4. The minimum primitive set

The wargames in §5 derived this set. Revision 4 folds in the user's relations (§8a), which removes three revision 3 primitives (the offer, the cross-entity token, the entity-grant flavour) and adds two (the relation document and the relation instance). Each primitive is either new or a generalization of an existing one.

0. **Identity document and certificates.** A read-only public key discovery per identity (`directory.v1`), plus short-lived certificates in which an entity's own provider binds a holder key to that entity, an audience and a client. **Member certificates** come from a person's home provider (rev 3). **Entity certificates** come from an organization's provider, for relations (rev 4). Every request is signed with the certified key (this generalizes `key-delegation.v1`).
1. **Organization entity.** An entity of kind `organization`, with no credentials, whose owner interface members operate (generalizes the entity).
2. **Directional connection with counterparty kinds.** The counterparty is an integration, a person or an entity relation party. It has a state, a generation and severance. It is mechanics: users see memberships, integrations and relations (generalizes the integration connection).
3. **Membership.** An organization→person connection, plus an opaque membership ID, per-member grants, governance powers and an optional `expires_at` (§8a.6: not a relation).
4. **Grant with caveats.** A fragment grant, as for apps, or a member resource grant, with `expires_at`. Relation edges add `reshare` (refused for now) and `actor_disclosure`, taken from the access entry.
5. **Effective-authority rule.** Live intersection along the chain: organization→app, organization→member and grantor→organization (the edge). There is no implicit inheritance.
6. **Member context.** A member certificate exchanged at the organization's token endpoint or presented directly, plus `bindle_member` and uniform failure.
7. **Relation document** (rev 4). A public, versioned artefact: slots with arity, and an access matrix over pinned fragment references. It grants nothing.
8. **Relation instance** (rev 4). Parties that joined in slots. It has no central host, and each party holds its own participation. Every edge needs grantor consent and grantee acceptance. Values received arrive as **imported resources**, which the grantee can assign to its own fragments.
9. **Actor-chain audit.** Every governance action and every call records who acted through whom, including the acting entity's certificate at counterparts.

Phase B adds **member-scoped fragment fields**: atomic fields whose values are set per member. This is the Bindle answer to app-specific roles (§6.3).

**Considered and rejected:**

- roles as a protocol concept;
- relation documents *as a source of authority*: titles and slot names never authorize (§8a.1);
- implicit parent→child inheritance;
- "entity as member" (nested membership);
- membership as a relation (§8a.6);
- signing each request with the identity key itself (§6.2). Requests are signed by a certified holder key instead;
- federated sign-in at the organization (revision 2; superseded, §1a);
- ad hoc offers and grantor-minted cross-entity tokens (revision 3; superseded by relations and entity certificates, §8a);
- offline-attenuable capability tokens such as macaroons or Biscuit (§6.4);
- an access-request queue in v1;
- a central host or global roster for relation instances;
- a separate "workspace" container distinct from the entity.

## 5. Wargames

Names: **Acme** is the user's company, on 3sln.me unless stated otherwise. **ERP** is `https://erp.example`, a confidential integration. **Alice** is an employee, **Dana** a contractor, **Ledgerly** an external accounting firm (an organization) and **Bob** an accountant at Ledgerly. **H**, **U** and **S** are a holding company and its UK and US subsidiaries.

### 5.1 Setting up the ERP

1. Ray, signed in as a person, chooses "Create organization". The provider creates the account record `kind:"organization"` with UUID `o`, issuer `https://3sln.me`, its signing and encryption keys (`IdentityKeyRegistry.ensure`), and a membership `m_ray` holding the `admin` power. The audit records `{actor:{person:ray}, action:"org.create"}`.
2. The console switches context to Acme. This is an owner transition under the [multi-account UI rules](multi-account-ui.md#owner-transition-is-a-security-boundary): a new epoch and blanked state. Every owner-interface request now carries `(session principal, target entity, epoch)`. The server resolves Ray's powers in `o` before every read or mutation.
3. Ray installs the ERP for Acme. This is the ordinary integration flow ([integrations §3.2](../spec/integrations.md#32-installation)) with the owner `o`. The consent page shows "Connect **Acme Ltd** to erp.example" and is approved by Ray as admin. The connection `c_erp` is created, the ERP's setup fragments are configured with Acme's resources (ledger object store, invoices bus), and the token response carries `bindle_connection`.

*Failure modes.* Ray switches context in another tab mid-consent: the epoch mismatch gives a typed error and no effect. A second admin removes Ray during consent: the commit re-resolves powers and fails. The ERP shows "Acme" in a personal context: it cannot, because tokens bind `sub` to `o`.

*Derived.* The organization entity (1). The owner interface operated by members, which needs the AMD-O2 wording change. The power resolver at the route seam: today `connectionsOwner(owner, …, {authTime})` takes the session owner directly, and ORG-0 changes that (§13).

### 5.2 An employee joins and leaves; a contractor gets time-boxed access

**Joining.**

1. Ray invites Alice with the "Bookkeeper" template, which is a 3sln.me feature. The provider stores a pending membership and issues an invitation link (`bindle_meta`, type `…/links/org-invitation/v1`, single use, `exp` 7 days, optionally bound to `alice@3sln.me` resolved to `(iss, sub)` at issue). Ray sends it any way he likes.
2. Alice opens the link. The owner host verifies it as in [links §8](../spec/links.md#8-processing-order-and-results). The page shows: who invites (the organization's public name and handle, never inviter-supplied free text), what Acme will learn (her handle and the profile fields she picks), and "Acme controls what you create in Acme".
3. Alice accepts from a client that holds a member certificate her home provider issued for Acme with the `member-accept` purpose (§6.2). The 3sln.me console is such a client: since she is already signed in at home, accepting is one confirmation. One commit:
   - activates `m_alice` (a connection o→person, generation 1);
   - copies the template's grants, with `source` recorded as provenance only;
   - consumes the link and appends to the audit.

   Alice's home provider knows she uses Acme, because it issues the certificates. It keeps that privately as her person→o record. Membership is keyed by her full `(iss, sub)` even when her home is 3sln.me.

**Leaving.**

1. Ray removes Alice, or Alice chooses "Leave Acme". One commit:
   - marks `m_alice` as `disconnected` and raises its generation;
   - invalidates her member-context tokens and owner-interface sessions;
   - enqueues a `member-removed` SET to each of Acme's integrations ([spec §7.4](../spec/organizations.md#74-events)).
2. Issuer-hosted RPC refuses her next call. Brokered tokens end by `access_ends_by` (≤ 360 s).
3. Anything she created stays in Acme's resources. Her personal account is untouched.

**Contractor.** Dana's membership has `expires_at` = the contract end, and her grants may expire earlier. Expiry is checked on every call, as part of the live check, and swept by the lifecycle runner. Admins get a reminder 7 days before. Only an admin can extend.

*Failure modes:*

- **Forwarded invitation.** If it is bound, a different principal gets the uniform `invitation_invalid`. If it is unbound, whoever accepts first joins, so the UI defaults to binding whenever a handle is given.
- **Double accept.** Single-use compare-and-swap.
- **Removal racing an app token exchange.** Minting and the removal share the organization's single writer, so the token is either minted before the commit (and dies at the next live check) or refused.
- **Removing the last admin.** Refused (§10).
- **Alice's home provider is unreachable when she tries to leave from home.** The org-side "leave" still works.

*Derived.* Membership (3), the invitation link type, `expires_at` (4) and the `member-removed` event.

### 5.3 The ERP acts for Alice (message level, rev 3)

Alice's home is `alt.example`. Acme and the ERP connection live on 3sln.me. If Alice's home were 3sln.me, every step would be the same, with the directory reads being local.

1. **Acquire** (out of spec; this is one example).
   - The ERP page creates a non-extractable P-256 holder key K. It asks Alice's home provider for a member certificate for (aud = Acme, client = erp.example), for example through the home provider's embedded elements.
   - The request is silent if Alice is signed in at home and has consented to this pair before. Otherwise the elements show a one-time consent naming "erp.example" and "Acme Ltd (acme@3sln.me)", or fall back to a top-level Bindle authorization at `alt.example`.
   - `alt.example` checks that Alice's account is active, that her consent for the pair is live, and that `client.origin` is erp.example's verified origin. It then signs:

   ```json
   {"alg":"ES256","kid":"k7","typ":"bindle-member-certificate+jwt"}
   {"bindle":"member-certificate","v":1,"iss":"https://alt.example","sub":"<uuid>",
    "identity":"https://alt.example/identity/<uuid>","aud":"https://3sln.me/identity/<o>",
    "purposes":["…/purposes/member-access/v1"],
    "client":{"client_id":"https://erp.example/bindle/client.json","origin":"https://erp.example"},
    "delegate":{"kty":"EC","crv":"P-256","x":"…","y":"…"},"cnf":{"jkt":"…"},"aep":3,
    "jti":"…","iat":1792500000,"exp":1792500300}
   ```
2. **Exchange.** The ERP page POSTs to 3sln.me's token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion=<certificate>` and `client_id`, plus a DPoP proof by K.
3. **Verify** (spec §5.2):
   - First the cheap checks: `typ`, `aud`, lifetime, purpose, and that Acme has a membership for `(https://alt.example, <uuid>)`. If there is none, a dummy signature check runs and the result is the uniform `invalid_grant`. **Nothing is fetched on the request path in either case** (R2-H1).
   - Then the chain, from caches that Acme keeps warm in the background for its members: `alt.example`'s manifest (≤ 1 h) → `directory.v1` → the identity URI pinned from the directory, never the certificate's `identity` claim (R2-H2) → `identity.json` (≤ 300 s, no rollback, R2-H3) → active kid `k7` → signature → the DPoP proof by `delegate`.
   - Last: `aep` is not below the recorded `3` (R2-M1), `c_erp` is active, and `client.origin` is verified for that client.
4. **Result.** A DPoP-bound access token whose expiry is no later than the certificate's, with **no refresh token**, plus `bindle_member: {"entity":"https://3sln.me/identity/<o>","id":"mbr_8Hq…","label":"Alice K."}`.
5. **Failure.** Not a member, not connected and every verification failure give the same `invalid_grant` (R2-H1).
6. **Use.** `@preferences.read` returns the **intersection** projection. Each RPC carries a DPoP proof by K, and the audit records `{client:"erp.example", member:"mbr_8Hq…"}`.
7. **Renewal**, at most every 5 minutes, is a new certificate (silent at home) plus a new exchange. If `alt.example` suspends Alice, no new certificates are issued, and the ERP loses member context within the certificate lifetime plus 60 s.
8. **Night jobs** run with the connection-bound refresh token and **no member**, under the ERP's organization ceiling alone. The audit shows "erp.example (as Acme)". This access is a superset of every member's, so Acme's admin approves it separately (R1-H1).

*Failure modes:*

- **`alt.example` is down.** Renewal fails with a retryable error, and the current token runs to its expiry.
- **The ERP backend wants to act as Alice without her.** It cannot: it has no K, and there is no refresh token. The exception is an acquisition that put the key on a server, which must be disclosed (spec §7.2).
- **A stolen certificate without K.** Useless, because of `cnf`.
- **XSS on erp.example.** The attacker can use K in the page while the script runs, until certificates stop. Alice or an admin can revoke the `jkt` at home.
- **A certificate replayed at Beta, or by another client.** Fails on `aud` and `client`.

*Derived.* Primitive 0, member context (6) and the effective-authority rule (5). The ERP keys all state by `(iss, entity, member)`.

### 5.4 External accountant: a guest member, or an organization grant

**Option A, guest member.** Acme invites Bob directly. This is simple, but Acme must remember to remove him when he leaves Ledgerly. Good for one-off individuals.

**Option B, a relation** (recommended for firms; rev 4):

1. **Relation document.** Acme's admin chooses "Share with an organization" and picks the relation `https://erp.example/relations/accounting-engagement` (version 1, hash pinned), from a provider catalogue or from the ERP vendor. The relation has:
   - slots `client` (1) and `firm` (1);
   - one access entry: `client` grants `firm` its `ledger-store` fragment, `get` only, `actor_disclosure:"pairwise"`;
   - an optional second entry for `audit-log/v1` read.

   The generic `share` relation would do for a one-off (§8a.2).
2. **Invite.** Acme's admin binds Acme's own values: the ledger store, scoped read-only to the prefix `/ledgers/2026`, with `expires_at` 2027-04-30. Acme's provider records Acme's participation in slot `client` and issues a relation invitation (`…/links/relation-invitation/v1`) for slot `firm`, bound to Ledgerly's `(iss, sub)`, `exp` 14 days.
3. **Accept.** Ledgerly's admin opens the link. It goes by top-level POST to **Ledgerly's** provider (the links §9 pattern), which shows:
   - the inviter's identity URI and handle;
   - the relation, with its publisher marked unverified;
   - the matrix as it applies to Ledgerly: it *receives* Acme's ledger fragment and grants nothing.

   The admin accepts on behalf of Ledgerly.
4. **Redeem.** Ledgerly's provider POSTs `{invitation, statement}` to Acme's `join_endpoint`. The statement is Ledgerly's participation statement, signed with its identity key. Acme verifies it (locally on one host, or through `directory.v1`) and activates the edge Acme→Ledgerly, a connection with the fragment grant. It returns Acme's statement and events endpoint.
5. **Import.** "Acme Ltd · Ledgers 2026" appears in Ledgerly's pool. Ledgerly's admin grants Bob `get` on it and assigns it to the fragment of Ledgerly's accounting app.
6. **Use.**
   - Bob uses the accounting app in Ledgerly context.
   - For the imported resource, Ledgerly's provider issues an **entity certificate**: `aud` = Acme, `instance`, `client` = accounting.example, `actor:{member:pw(Bob, Acme)}`, `cnf` = the app's key, ≤ 300 s.
   - The app calls Acme's RPC directly with the certificate and a DPoP proof (relay projection, spec §10).
   - Acme verifies the certificate and checks the edge live.
   - Acme's audit reads "Ledgerly › member p_7f… › accounting.example", backed by Ledgerly's provider signature.
7. **Bob leaves Ledgerly.** Ledgerly stops certifying keys for him, so he loses access within 300 s.
8. **Engagement ends.** The grant expires, the edge ends, and Acme sends `connection-revoked`. The import becomes `unavailable`.

*Failure modes:*

- **Invitation forwarded to another firm.** It is principal-bound, so redemption fails.
- **Invitation spam.** It needs acceptance, and invitations are rate-limited per inviter.
- **A lookalike relation document** ("accounting-engagement" published by an attacker). The publisher is shown as unverified, and the matrix is shown in full before consent (R1-M6).
- **Ledgerly mis-attributes the actor.** The actor is asserted by Ledgerly's provider, and that is disclosed. The edge bounds the damage.
- **Ledgerly copies data out.** There is no recall, which is disclosed.
- **Ledgerly asks for wider access.** The edge carries only what the matrix and Acme's consent allow, so wider access needs a relation upgrade and Acme's consent.
- **Ledgerly's provider lacks `directory.v1`.** Redemption fails as `entity_unverifiable`.

*Derived.* The relation document (7), the instance (8), the entity certificate (0) and imported resources.

### 5.5 Holding company, subsidiaries, and a sale

**Setup.** H, U and S are three organizations. The CFO Carol is a member of H. Consolidation:

- One instance of a `group` relation: slot `parent` (arity 1) and slot `subsidiary` (arity up to 64). Its matrix lets each subsidiary grant the parent its `ledger-store` and `monthly-close` bus fragments. H, U and S each join and consent to their own edges (rev 4).
- H's imports from U and S arrive as imported resources, and H grants Carol access to them.
- H's consolidation app is H's integration.
- Governance of U and S is held by **direct** members (H's finance leads are admins of U and S). Governance never flows through the H←U connection (ORG-D6).

**Intercompany.** U and S are both in the `subsidiary` slot. A sibling entry (`subsidiary`→`subsidiary`, invoices bus) lets them exchange invoices, or they use a separate `supply` instance as in §5.7.

**Sale of U to Buyer B:**

1. U's current admins (H staff) invite B's staff as U admins, with invitations bound to each invitee. Each admin addition is a critical action: notified to every admin, and effective 72 h after the invitee accepts, unless another admin cancels. The invitee's acceptance never shortens the delay (R1-H4). An organization with a single admin has no one to object, so the delay applies only as notice.
2. At closing, B's admins remove H's staff. Removing an admin is critical: delayed and notified, with any other admin able to cancel. A departing admin can remove themselves immediately.
3. U leaves the `group` instance, which ends all of U's edges. H and S end theirs to U.
4. A transition services agreement becomes a new two-party instance of a `transition-services` relation, with `expires_at` 90 days.
5. U's integrations are U's own connections, so nothing moves. This only works if each subsidiary connected its own integrations rather than sharing H's. The design rule: **shared services are the same app connected to each organization separately.**
6. Optionally, U moves to B's provider: export and import, plus identity continuity (a future spec) or a custom-domain issuer (§6.1).

*Failure modes:*

- **H's staff are still admins after closing.** This is the takeover window. The console shows a "change of control" checklist and the audit flags admins whose last activity predates the event.
- **H keeps data it already read.** There is no recall.
- **U's audit still names H employees.** The controller changes, which is a legal flag (§12).

**Spin-off.** The same steps, with the spun-off management as the new admins.

*Derived.* Nothing beyond relations, which confirms that edges plus direct governance are enough. Governance never flows through a relation. Self-containment is a *data-placement* rule: each organization keeps its data in its own pool.

### 5.6 A team inside a company

There are two shapes:

- **Separate organization**: "Payments · Team", connected both ways to Acme. Use it when the team owns resources, integrations or a budget, or may be moved or sold.
- **Templates now, member sets later**: the team is just a way to give several Acme members the same grants.

Reorganizing a separate team organization means editing grants, never moving data. A team organization's admins are added directly, so the company does not automatically govern it (ORG-D6). If that becomes painful, the remedy is the deferred "governance via relationship" feature, not inheritance.

### 5.7 A purchase order and invoice between buyer and supplier

1. The ERP vendor publishes bus manifests `https://erp.example/buses/purchase-orders/v1` and `…/invoices/v1`, with `readers: ["application","provider","entity"]` (AMD-O6). It also publishes the contract `https://erp.example/contracts/purchase-order/v1` with `acknowledge` and `status`, marked `effect: "read"` on `status`.
2. B and S join one instance of `https://erp.example/relations/supply` (spec §9.2 example), as `buyer` and `supplier`. B grants S read on its purchase-order bus fragment and, optionally, `status` and `acknowledge` on its PO desk. S grants B read on its invoices bus. A buyer with many suppliers uses one instance with many `supplier` holders, or one instance per supplier.
3. Each side publishes only to its **own** bus and reads the other's through an imported resource. This is an outbox model: no party can write into the other's log, and `attested_by` is the owning provider.
4. Doorbells chain: B's provider sends `bus-advanced` to S's provider, which is the edge's events endpoint. S's provider sends a doorbell to S's ERP for the imported bus.
5. A PDF attachment lives in B's object store, shared read-only under the prefix `/po-attachments/`. The record carries its key, version and SHA-256.
6. Human questions go through Bindle Messaging between the two organizations' mailboxes.

*Failure modes:*

- **S misses records past retention.** It sees a `gap` and reconciles through `status`.
- **Duplicates.** Deduplicate by `seq`.
- **The record content is disputed later.** Records are not end-to-end signed. This is a gap: entity-signed records (§8.5).
- **Legal e-invoicing mandates** (Peppol, clearance regimes). Out of scope; the ERP bridges to them (§11).
- **Retention.** Bus retention is at most 30 days, so the ERP must keep the books in durable resources, never in buses.

*Derived.* The bus `entity` consumer kind. Write-capable `acknowledge` needs certificates younger than 60 s (spec §9.5). Nothing else new.

### 5.8 An integration gets only what its fragment selects

At the organization level nothing changes. Acme's admin assigns resources to the ERP's fragments, and the ERP gets those resources only ([protocol §3–§4](../spec/protocol.md#4-grants-and-live-authorization)). In member context, the projection is narrowed further to what the member may use (primitive 5, spec §6.2). A resource that the member may use but the ERP may not is invisible to the ERP. A resource that the ERP may use but the member may not is omitted from that member's projection, so the ERP still holds it in organization context. The projection never reveals *why* a resource is missing.

### 5.9 Private membership check and switching the active entity

See §9. In short, an app learns that a user is a member only when the organization accepts a certificate that the user's home provider issued, with the user's consent, for that organization and that app.

### 5.10 Key compromise and rotation

| Compromise | Effect | Response |
| --- | --- | --- |
| Alice's home account taken over | The attacker can obtain certificates as Alice | Recovery keeps the UUID, so the membership survives, for the real Alice **or for whoever completed the recovery**. Recovery also changes her authority epoch, so the next certificate carries a new `aep`, and Acme holds her admin power until another admin re-confirms or a 72 h notified delay passes (spec §5.2a, R1-H3). Certificates issued before recovery expire within 600 s. Admin actions check delegation status, so they stop within 60 s. |
| The ERP page's holder key | Misuse in the page (XSS) while the attacker's script runs. A non-extractable key cannot be exported. | Alice revokes the `jkt` at home, and certificates stop. Status-checked actions fail within 60 s, and others within the certificate lifetime. There is no refresh token to steal. |
| Alice's home provider's identity signing key | Forged certificates for its users in any organization | Home rotates and revokes, and organizations stop accepting within 300 s + 60 s (spec §3a.4). Home custody is otherwise an inherent trust (§6.2). |
| An organization's identity key | Forged entity certificates, participation statements, invitations or links | The provider rotates (`keys.mjs` continuity) and revokes the kid. It raises the generation on every inter-entity connection, as for a brokering-key compromise ([integrations §7.1](../spec/integrations.md#71-operations)). Counterparties cache key sets for at most 1 h; that is the residual risk. Governance is not signed with this key, so membership cannot be forged with it. |
| The provider itself | Total, within its custody | Out of scope, as for persons ([security](../spec/security.md#trust-boundaries)). Self-hosting moves custody, it does not remove it. |

### 5.11 Lost admin (bus factor)

- **Admin lost their device.** Home-provider recovery restores the same `(iss, sub)`, so the membership returns with the next certificate. Recovery changes `aep`, so the admin power resumes after re-confirmation (§5.2a). Nothing organization-specific is needed. This is the common case.
- **Admin gone for good** (left the company, unreachable, died), and another admin exists. The remaining admin removes the departed one: delayed 72 h and notified, unless the departed admin cancels.
- **No admin left.** Break-glass:
  - At creation, 3sln.me gives the organization a **recovery file** in the existing [recovery file](../spec/recovery-file.md) format, with the organization UUID and a reset credential.
  - Restoring it **adds** a new admin principal; it never removes existing admins. The change completes 72 h after notifying every member and every admin. Any current admin who authenticates freshly during that window cancels it, because then the organization is not adminless. A contested organization is a legal dispute that 3sln.me cannot adjudicate (R1-H4).
  - The file is reissued, and the previous one invalidated, whenever the admin set changes, so a departed admin's copy stops working. The console asks a remaining admin to store the new file.
  - 3sln.me does no KYC, so it cannot adjudicate disputes beyond this.
  - **Provisional parameters** for the user to confirm.
- **Domain-anchored organizations** (§6.1) can later add DNS-proof recovery.

### 5.12 Entities on different providers, including self-hosted

| Case | What works | Needs |
| --- | --- | --- |
| Acme on 3sln.me, Alice on `alt.example` (**phase A**) | Alice's clients present certificates from `alt.example`, and 3sln.me verifies them through `alt.example`'s directory | `alt.example` declares `directory.v1` and issues member certificates (`key-delegation.v1` with AMD-O12). No client registration between the providers. |
| Acme self-hosted at `acme.example`, members on 3sln.me | The same, in reverse | `acme.example` implements `organizations.v1` and `directory.v1`, and 3sln.me issues certificates |
| Acme on 3sln.me, Ledgerly on `ledgerly.example` | Relation invitations, joins, entity certificates and SETs | `directory.v1` and `relations.v1` at both ends, plus cached relation versions (artefact references) |
| A member's home provider shuts down | The member cannot authenticate | An admin re-invites the person under their new identity. Membership rebinding through identity continuity is a future spec. |

### 5.13 Auditors

An audit firm gets an organization grant with:

- `expires_at`;
- read-only methods;
- `audit-log/v1` read;
- optionally `actor_disclosure:"named"`, so Acme sees *which* auditor read what, through the verified `(iss, sub)` in the actor chain.

During an audit, Acme may need a **retention lock** on the ledgers, meaning no deletion. That is a later provider feature (§11). Without it, an admin could delete records mid-audit.

### 5.14 Merger and joint venture

- **Merger.** It starts as a relation instance between the two organizations, each granting what is needed. That is fast and reversible. Consolidation follows: export and import, or a later same-provider **resource transfer**. A transfer revokes every grant on the resource and gives it a new identifier; no grant survives a transfer. The surviving organization's admins govern the result.
- **Joint venture.** A new organization. Both parents hold direct admin memberships, and a `joint-venture` relation instance gives the venture expiring grants from each parent. At its end, grants lapse by themselves, the venture exports its data to the parents as their agreement says, and the organization is deleted, which is a delayed critical action.

### 5.15 What the wargames produced

| Scenario | Primitives exercised | New pieces it forced |
| --- | --- | --- |
| ERP setup | 1, 2 | Owner interface operated by members; power resolver |
| Join, leave, contractor | 2, 3, 4 | Invitation link, `expires_at`, `member-removed` |
| ERP acts for Alice | 0, 5, 6 | Directory, member certificate, token form, `bindle_member`, uniform failure |
| Accountant firm | 0, 4, 7, 8, 9 | Relation document and instance, entity certificate, imported resource, `actor_disclosure` (rev 4) |
| Subsidiaries and sale | 2, 4, 7, 8 | Arity, sibling entries, leaving (rev 4) |
| Team | 1, 2, 4 | None (guidance) |
| Purchase order and invoice | 7, 8 | Bus `entity` consumer kind; the 60 s rule for writes |
| Integration fragment | 5 | Projection intersection |
| Membership check and switch | 6 | Entity section in the island, events |
| Key compromise | 2 | Generation raise on inter-entity connections |
| Lost admin | — | 3sln.me break-glass (not spec) |
| Different providers | 0, 7, 8 | `directory.v1`, `relations.v1`, provider roles |
| Auditors | 4, 10 | `actor_disclosure`, retention lock (later) |
| Merger, joint venture | 2, 4 | Resource transfer (later) |

## 6. Authority model

### 6.1 Identity, keys, self-containment, portability

An organization has everything a person has except credentials:

- `(iss, sub)`, with `sub` a UUID;
- a handle in the provider's namespace, such as `acme@3sln.me`, or a custom domain;
- signing and encryption keys custodied by its provider;
- a resource pool, preferences, connections, grants and audit.

Its identity document (directory profile) adds `kind: "organization"`. **Self-contained** therefore means two things. Everything that defines the organization lives in its own account. Every association is a connection it can sever alone.

**Portability.** Export covers members (as principals), grants it issued, connections, imported-resource references, audit and resources. Grants it *holds* from others must be re-confirmed by their grantors after a move, because tokens and grants never migrate automatically ([protocol §1](../spec/protocol.md#1-model-and-custody)). Durable identity across providers needs either:

1. the future identity-continuity spec (a successor statement signed by the old key), shared with persons; or
2. a **custom-domain issuer**: the organization's own domain is the issuer, and the domain owner can repoint it.

For companies, (2) is natural and recommended. It requires custom-domain hosting on 3sln.me, which is an unknown for Workers (§11).

**User's assumption, checked (rev 3).** "User identity is easy to verify from the public key plus the Bindle manifest." That becomes true with `directory.v1` ([spec §3a](../spec/organizations.md#3a-identity-documents-and-key-discovery-directoryv1)), which is now a phase A prerequisite. Today only same-host keys verify. Two refinements:

- Each request is signed by a short-lived holder key that the home provider certified, not by the identity key, because identity keys are provider-custodied and never leave the provider.
- Verification needs the identity document as well as the manifest.

### 6.2 Members stay independent; how they authenticate (rev 3)

A member is always their own person entity at their home provider. An organization never creates, recovers or suspends a member's identity, and never runs its own sign-in for members.

**Model** ([spec §5.2](../spec/organizations.md#52-member-authentication-certificates-and-signed-requests)):

- The client acting for the member holds a holder key.
- The home provider certifies that key for (member, organization, client), for at most 600 s (300 s recommended).
- Every request carries a proof by the key.
- The organization verifies the chain and derives authority from `(iss, sub)` by live grant checks.

**The verification chain:**

1. The certificate's `iss` → the home manifest (an SSRF-safe fetch, cached ≤ 1 h) → `directory.v1`.
2. The identity URI → the identity document → the `active` signing key (continuity-pinned, cached ≤ 300 s).
3. The certificate itself: `typ`, `aud` = this organization, purpose, `client`, lifetime ≤ 600 s, `cnf.jkt` and `aep`.
4. The request proof by the holder key (DPoP: method, URL, freshness, `jti`).
5. Live membership and grants for `(iss, sub)`, intersected with the client's connection. For owner-interface actions, also the delegation status at home.

A membership or a presented invitation must exist before step 1. An unknown principal or issuer therefore never makes the organization fetch anything. Fetches for members happen only in background refreshes, never on the request path, and every failure looks the same, so a forged certificate is not a membership oracle (R2-H1).

**Options compared:**

| Option | Verdict |
| --- | --- |
| **Home-certified holder key, signed requests** (chosen, rev 3) | Matches the user's model: no sign-in at the organization, any provider, and every request proves its origin. Needs `directory.v1` and certificate issuance at home providers. Revocation is bounded by certificate lifetime. |
| Federated sign-in at the organization (rev 2) | Superseded. It added a sign-in, required the organization to be a registered client of every home provider, and did not sign requests. |
| Signing every request with the identity key | Rejected. Identity keys are provider-custodied, so the home provider would sit on every request path, and one key across every organization correlates the member. |

**Acquisition is open-ended (ORG-D13).** Non-normative examples:

- the home provider's elements, holding a non-extractable key in its own frame (3sln.me's way, and an app feature);
- a general Bindle authorization flow at home, as the fallback when the member is not signed in;
- device or CLI grants.

Whatever the mechanism, the home provider obtains consent for each (organization, client) and names both.

**Revocation bounds** (replacing the R1-H5 home check). Renewal requires a new certificate, and each certificate is a live check at home. When a member is suspended, a consent is revoked or a key is revoked at home:

- owner-interface actions fail within 60 s, through the status check;
- other requests fail within the certificate lifetime plus 60 s: ≤ 360 s at the recommended 300 s, or ≤ 660 s at the 600 s maximum.

An optional `connection-revoked` SET to the organization shortens this. Same-host members are checked live.

**Holder keys (R1-H2, re-evaluated).** Member context is DPoP-bound to the certified key and has no refresh token, so a backend cannot act for a member without the key. Where the key lives depends on acquisition. Home providers SHOULD keep `member-access` keys on the member's device and MUST disclose server-side agents.

**Proof of origin, and its limit (ORG-D14).** The chain proves: "the identity's provider attests that this request came from this identity, through this client, for this organization". The user asked for exactly that, and it is sufficient for membership. **Limit:** identity keys are provider-custodied, so a home provider can forge certificates for its own users. An organization trusts each member's home provider for that member, and may restrict accepted issuers (3sln.me feature). Two optional extensions come later, and neither blocks phase A:

- passkey-signed approvals for selected actions (a signed-approval profile, R1-M8);
- audit checkpoints signed with the organization's key (R1-M2).

**Privacy cost** (stated in spec §12):

- The home provider learns which organizations and clients its member uses, and the renewal cadence.
- An app holding certificates learns the member's `(iss, sub)`. For member context this supersedes R1-M4's "no person identifiers".
- Directory fetches tell the home provider that the organization's provider is evaluating the identity. Caching bounds how often.

### 6.3 Grants, not roles

| Model | Pros | Cons |
| --- | --- | --- |
| Live roles (named bundles assigned to people) | Bulk changes | Hidden indirection: "what can Alice do?" needs evaluation. Roles multiply. A role edit silently widens many people. |
| **Per-member grants plus copy-on-apply templates** (chosen) | "What can Alice do" is simply her grants. Removing Alice removes everything. Auditing and revocation are trivial. | A bulk change means re-applying the template. The console shows a drift diff ("3 members differ from Bookkeeper"). |
| Member sets (live groups) | Bulk changes with visible indirection | Deferred. They can be added as a 3sln.me feature without any spec change, because the spec sees only effective authority. |

**The spec sees only effective authority.** Another provider never evaluates Acme's internal grants. Apps see effective grants in their projection and tokens. Whether a provider uses roles, groups or templates is therefore **its own business**, and the spec defines none.

**App-specific permissions** ("can approve purchase orders up to €10k") are app semantics. The Bindle-native way to manage them centrally is a **member-scoped fragment** that the app publishes. For example, `https://erp.example/fragments/member-access/v1` has `role: enum[viewer, clerk, approver, admin]` and `approval_limit: integer`, each marked `"scope":"member"`. Acme's admins set the values per member in the console, and templates can set them too. The member can see their own values. The ERP reads them in member context and enforces them. The app defines the vocabulary as a public URI document, which is the user's hunch in a precise form, and Bindle stores the values without interpreting them. This is phase B. Until then, the ERP keeps its own role table keyed by membership ID.

**Governance powers** (managing members, grants, integrations, relationships, audit, billing, deletion) are owner-interface powers, not contract methods. 3sln.me v1 has one power, `admin`. Granular powers can follow without spec change.

### 6.4 Delegation and attenuation

**The model is grantor-held records plus derived short-lived capabilities.**

- Each hop is a **grant record at that hop's grantor**: U→H at U (the relation edge), H→Carol at H, H→the consolidation app at H. Each grantor revokes its own hop immediately, at its own provider.
- Credentials are short-lived and sender-bound. Since rev 4, each acting entity's own provider certifies a holder key after checking its own hops, and the resource's host verifies the certificate and checks its own hop live (spec §9.5).
- Attenuation: the edge carries only the matrix entries the grantor consented to. Certificates are ≤ 300 s, and write-capable methods need certificates younger than 60 s.

**Rules:**

1. **No implicit flow.** A connection carries nothing by itself.
2. **Use within the grantee.** An entity grantee may exercise a grant through its own members and its own connected apps, within its own grants to them. Otherwise it could not use the grant at all.
3. **No re-sharing without consent.** Passing a grant on to a third entity (re-sharing) requires `reshare:true` on the access entry. Re-shared grants chain, and the original grantor's revocation cuts every descendant, because the resource's host verifies every hop. Re-sharing is phase D; v1 refuses `reshare:true`.
4. **Governance is not delegable to apps or entities** in v1.
5. **Deputies check before certifying.** A provider that issues entity certificates on behalf of its member or app (a deputy) MUST evaluate its own internal chain first. The grantor cannot see inside the grantee.

**Why not macaroons or Biscuit.** Offline-attenuable tokens let H narrow U's capability without contacting U. But Bindle already checks live grants at the issuer for immediate revocation. Offline attenuation would add a token format and a revocation story, and buy only one saved round trip per 5 minutes.

### 6.5 Relations: directional edges, revocable, time-varying (rev 4)

A relation instance (§8a) is the user-facing container. Underneath it is one connection per directed edge, with fragment grants on it. Mutuality comes from the matrix having entries in both directions, and either side can drop its half.

- **Names.** A relation's title and slot names ("parent", "supplier", "auditor") describe the matrix. They never authorize anything by themselves.
- **Time.** Grants carry `expires_at`. A connection can be suspended and resumed (the generation rises) and disconnected (a tombstone, after which no grant revives).
- **History.** The audit keeps who granted what, and when, after the connection is gone.

### 6.6 Revocation and latency

| Revocation | Issuer-hosted RPC | Integration-hosted (brokered) | Relation edge at the grantor (entity certificates) |
| --- | --- | --- | --- |
| Member removed or expired | Next call (live check) | ≤ 360 s (`access_ends_by`) | The grantee stops certifying keys for that member: ≤ 300 s + 60 s, and ≤ 60 s for write-capable methods |
| Organization→app connection revoked | Next call | ≤ 360 s | As above |
| Grantor ends an edge | Next call at the grantor | ≤ 360 s | Next call (the grantor checks the edge live) |
| Party leaves the instance | — | — | Unilateral: its edges end, and counterparts get `connection-revoked` (spec §9.6) |
| Home-account recovery, suspension or key or consent revocation | Home stops issuing certificates. Owner-interface actions stop within 60 s (status check). Other calls stop within the certificate lifetime plus 60 s (≤ 360 s at 300 s certificates). An optional SET to the organization makes it immediate. A recovery also changes `aep`, which holds admin power (§5.2a). | As left | As left |

### 6.7 Audit

Every entity's provider records governance actions and every call with an **actor chain**:

```json
{"entity":"…/<o>","via":[{"entity":"…/ledgerly","member":"p_7f…"},{"client":"https://accounting.example"}],
 "action":"rpc","resource":"…","contract":"…","method":"get","tx":"…","at":1792500123}
```

The audit never contains payloads, tokens or preference values ([security](../spec/security.md#audit-and-operational-controls)). Admins can read it. Members can read entries about themselves. Grantees can get it through a grantable `audit-log/v1` contract (phase C). Retention is the organization's choice within provider bounds. The audit is hash-chained, as the feature-flag admin audit is.

## 7. Spec versus 3sln.me boundary

### 7.1 Placement

| Item | Bindle spec | Components profile (3sln.me) | 3sln.me feature |
| --- | --- | --- | --- |
| Organization kind; identity-document `kind` | ✓ | | |
| Connection counterparty kinds; membership as a connection | ✓ | | |
| Organization-invitation and relation-invitation link types | ✓ | | |
| `directory.v1`; member and entity certificates | ✓ | | |
| Relation documents (artefact class), instances, edges, lifecycle | ✓ | | |
| Provider roles (identity hosting, organization hosting) | ✓ | | |
| Member context (certificate token form, `bindle_member`, uniform failure) | ✓ | | |
| Effective-authority intersection; no inheritance; deputy rule | ✓ | | |
| Grant caveats `expires_at`, `reshare`, `actor_disclosure` | ✓ | | |
| Actor chain in entity certificates | ✓ | | |
| Imported-resource projection (preferences v2 `broker`) | ✓ (amendment) | | |
| Bus `entity` consumer kind; `member-removed` event | ✓ (amendment) | | |
| Privacy rules (no enumeration, pairwise IDs) | ✓ | | |
| What audit records must contain; export contents | ✓ (skeleton) | | |
| Member-scoped fragment fields | ✓ (phase B) | | |
| Entity context in the switcher island; `bindle-entity-change` | | ✓ | SDK |
| Governance powers (`admin`, granular later) | | | ✓ |
| Templates, drift view, member sets (later) | | | ✓ |
| Critical-action delays, change-of-control checklist, break-glass | | | ✓ |
| Kind labels, handles, verified-domain badges | | | ✓ |
| Billing, plans, quotas, seat limits; organizations paid-only; tiers (§12a) | | | ✓ |
| Relation catalogue, the generic `share` relation, relation-document review | | | ✓ |
| Versioned integrity references | Owned by the [artefact references](artefact-references.md) design | | |
| Allowed home issuers, step-up policy, member-directory visibility | | | ✓ |
| Retention locks, legal hold, DPA | | | ✓ |

### 7.2 The user's hunch about URI-identified public documents

- **Confirmed for what is exchanged.** Bus manifests, contracts, slot manifests and fragments are already immutable public documents identified by URI. Inter-entity interop works because both ERPs pin the same purchase-order bus manifest and contract.
- **Confirmed in a narrower form for app-defined roles.** These are member-scoped fields in an **app-published fragment**, which is a public document identified by URI that Bindle stores without interpreting (§6.3).
- ~~Rejected for relationship kinds.~~ **Revised in rev 4: adopted as relation documents** (§8a). The rev 1 objection was to authority flowing from a label. A relation document is an enumerated access matrix, and authority still comes only from consent at both ends of each edge. The deferred "agreement profile" from rev 1 is what relation documents now are. "Titles and slot names never authorize" stays as a hard rule.
- **Deferred, not rejected, for grant templates (corrected in R1-M5).** A template does not need to name private resources. Like a fragment, it can name resource *requirements* (contracts, methods, bus manifests, a maximum `expires_at`), with the private binding chosen when it is applied. A public, digest-pinned **access profile** such as "external accountant, read-only, v1" is therefore a safe later home for the user's hunch. It would drive copy-on-apply templates and offers and let a grantee's page say "this offer matches profile X". It confers no authority, because effective authority is still all the spec sees. It is deferred until two independent parties want the same profile.
- **A safe role for public relationship documents (R1-M5).** A *bilateral, public, revocable attestation* ("Acme UK and Acme Holdings both state they are related"), signed by both entities' keys and conferring no authority, is safe. It helps against lookalike organizations and helps discovery. Both sides must sign it, so no one has to settle an asymmetric claim. Deferred to the directory profile.

## 8. Communication and resource sharing between entities

### 8.1 Mapping onto existing primitives

| Need | Primitive | State |
| --- | --- | --- |
| Share a document store, read-only or scoped | A relation entry over a storage fragment (the generic `share` relation for one-offs), plus [resource scoping](resource-scoping.md) | Relations (rev 4); contracts exist |
| Business event streams | Event bus with the `entity` consumer kind | Amendment AMD-O6 |
| Commands and queries | Resource RPC on a published contract (protocol §5) | Existing RPC, with entity certificates (§8.3) |
| A grantor's integration-hosted resource | The grantor's provider verifies the entity certificate, then mints a brokered token whose `client_id` is the grantee entity and which carries the actor chain | A profile of [integrations §5.3](../spec/integrations.md#53-consumer-credentials) |
| Human conversation | Bindle Messaging between organization principals | **Gap:** "on behalf of member" attribution |
| "Contact Acme" public intake | Contact links on the organization principal | Existing (BindleBox), with the organization as owner |
| Severing, events, bounds | Connection generation, SETs, `access_ends_by` | Reused |
| Brokered credentials the provider can sever | The grantor's provider owns every credential | Reused |
| Asking a counterparty for more access | A relation upgrade, or a new instance | No request queue in v1 |

### 8.2 Imported resources

An imported resource is a record in the grantee's pool. It holds:

- `{grantor, connection, remote resource, contracts, method ceiling, scope, expires_at, label}`;
- a label that is the grantor's public name plus the grantor's resource label. The grantor's label is untrusted text, shown together with the grantor's origin.

It behaves like any other resource:

- it is assignable to fragments;
- its use is subject to member grants;
- its availability follows the connection.

**Delivery to apps** is the provider's choice. In *relay* mode, an entity certificate for the app's own key is placed in the preferences v2 projection with `broker` set to the grantor's RPC endpoint (rev 4); this requires a DPoP-bound consumer session. In *proxy* mode, the grantee's provider forwards the call through its own gateway, with a certificate for that gateway; this is simpler, but costs a hop and the grantee's provider sees the traffic, which is its own custody anyway. The spec fixes only the relay projection and the certificate.

### 8.3 Limited grants and tokens

| Property | Entity certificate (rev 4; replaces the cross-entity token) |
| --- | --- |
| Issued by | The **acting** entity's own provider, after its own hop checks. The grantor verifies it, and for its integration-hosted resources mints a brokered token. |
| Audience | The counterpart entity (`aud`), within one `instance` |
| Scope | The live edge's grants, checked by the grantor on every call |
| Expiry | ≤ 300 s, with no refresh. Write-capable methods need certificates younger than 60 s or a fresh status check. |
| Key binding | `cnf.jkt` is **required**: the consumer app's key in relay mode, or the grantee provider's gateway key in proxy mode |
| Actor chain | `actor: {member?, client?}`, asserted and signed by the acting entity's provider, recorded by the grantor, and never authority by itself |
| Severance | Edge connections follow [integrations §7](../spec/integrations.md#7-severance). Inside the grantee, revocation means it stops certifying. |

### 8.4 A separate team organization versus a member set

Use a separate organization when the team owns resources, integrations, billing or a lifecycle independent of the parent, such as a possible sale or a reorganization. Otherwise use templates now and member sets later. Never model a department as an organization only to mirror an organization chart: every organization adds governance overhead and another bus factor.

### 8.5 Gaps found

1. ~~Directory/identity-document profile.~~ Specified in rev 3 (spec §3a). The remaining biggest dependency is now **artefact references** (§8a.8).
2. **Entity-signed records.** Bus records and RPC results are attested by their host, not signed by the entity. Invoices that third parties such as auditors must verify later need a JWS-by-entity-key profile.
3. **"On behalf of" in Bindle Messaging.** An organization mailbox message should show "Acme (Alice)". The BindleBox author descriptor has no member attribution.
4. **Member-addressed activity.** "PO needs your approval" from Acme's ERP to Alice's activity feed works on one host. Across providers it needs forwarding.
5. **Import fan-in.** A supplier with 500 customers holds 500 imported purchase-order buses, one per edge. Fragment resource fields are bounded (cardinality 8 in examples). It needs a listing query over imports by relation and slot.
10. **Admission delegation.** Joining an n-party instance needs each grantor's consent. A "slot owner admits" policy is deferred (Q12).
6. **Access requests.** There is no asynchronous "please share X with us" queue.
7. **Resource transfer** between entities (merger, sale of a business line).
8. **Identity continuity** for provider moves, shared with persons.
9. **Retention locks and legal hold.**

## 8a. Relations proposal assessment

**Verdict: adopt it.** The user's relations become the user-facing model for every association between entities. They replace revision 3's offers and grantor-minted cross-entity tokens. Connections, fragment grants, the intersection rule and imported resources stay underneath as mechanics. The primitive count goes down.

### 8a.1 Why it is not trust by label

Revision 1 rejected relationship-kind documents because authority must never flow from a label (§7.2). The user's relation document is not a label. It is an **enumerated, pinned access matrix** over public fragments, and every edge still needs explicit consent at both ends:

- the grantor chooses its own fragment values, per counterpart, as protocol §4 already requires per consumer;
- the grantee accepts.

That is exactly how an application's fragment request works today: a public document bounds what may be asked, and the owner decides what is given. The relation document only lets both ends, and their ERPs, agree on the matrix in advance. Review R1-M5 had already found grant-nothing bilateral documents and public access profiles safe. Relation documents are those two ideas merged and made useful. The revision 1 objection survives in one form only, as a hard rule: titles and slot names never authorize (spec §4 rule 4, §9.1).

### 8a.2 Comparison

| Concern | Rev 3 (offers) | User's relations | Chosen |
| --- | --- | --- | --- |
| What a grantee receives | A list of resources and methods chosen ad hoc | Fragments named by a public matrix, filled with the grantor's values | Relations: fragments are the one concept, and both ERPs pin the same document |
| User-facing container | None (a pile of connections) | The instance ("Acme ↔ Beta, Supply") | Relations |
| Many parties (a group with 12 subsidiaries) | 12 × N ad hoc offers | One instance, slots with arity | Relations |
| Authority source | Grantor consent per offer | Grantor consent per edge, bounded by the matrix | Same strength |
| One-off sharing ("send the auditor this folder") | An offer | Needs a relation document | A generic **`share`** relation (one slot each, one entry over a generic storage fragment) covers ad hoc sharing |
| Upgrades | New offer | Additive versions with re-consent when access widens | Relations, which depend on artefact references |

### 8a.3 Mapping onto the existing mechanics

| User concept | Mechanics underneath |
| --- | --- |
| Relation document | A new public artefact class (AMD-O14), versioned with integrity references (§9.8 of the spec) |
| Instance | Each party's participation record, with no central host; a URI minted by the creator's provider |
| A slot holder's access to another's fragment | Edge X→Y = one connection (counterparty kind `entity`) carrying fragment grants. This replaces the resource-list grants of rev 3. |
| Received values usable in the grantee's own fragments | Imported resources (§8.2), within the grantee's own grants. Pushing them onward to a third entity is re-sharing, which stays refused, including by composition: imported resources are omitted from every fragment granted over an edge (spec §9.7, R3-H2). |
| Organization's identity on requests | **Entity certificate** issued by the acting entity's own provider. This replaces grantor-minted token exchange and client assertions, and matches the member certificate: one credential shape for any entity acting anywhere. |
| Joining | A relation-invitation link (replacing the offer link) plus participation statements signed by each party's identity key |

**Net primitive change** (§4): the offer link, the cross-entity token and the entity-grant flavour are removed. The relation document and the relation instance are added. The entity certificate merges into primitive 0. Connections, imported resources and the intersection rule are unchanged.

### 8a.4 Arity and lifecycle (spec §9.3–§9.6)

- **Consent.** Every edge needs grantor consent and grantee acceptance, so a newcomer reaches each existing party only with that party's consent. Parties may pre-accept *receiving* from future joiners, but never pre-consent to *granting*. Delegating admission to a "slot owner" (for example, the parent admits subsidiaries) is deferred (Q12).
- **Arity.** Each party enforces arity over its own view. There is no global roster or consensus, because no central host is wanted and none is needed for authority.
- **Leaving and removal.** Leaving is unilateral and ends all of that party's edges. Removal is per grantor ("stop sharing with them"). There is no instance-wide vote.
- **Upgrade.** Each edge is pinned to a version both ends accepted. A wider version needs re-consent from the grantor and acceptance from the grantee. A non-widening upgrade completes once both ends pin it.
- **Dissolution.** When no edges remain, imported resources go `unavailable`, and the grantee's dependent fragment fields report `requiresConsent`. Nothing is recalled.

### 8a.5 Across providers

- **The instance record.** Each party's provider hosts its own participation. The instance URI is minted by the creator's provider and confers nothing.
- **Signatures.** Participation statements and invitations are signed with each organization's identity key and verified through `directory.v1`. Entity certificates sign every request.
- **The common contract** is `directory.v1` plus `relations.v1` (invitation acceptance, join endpoint, entity certificates) plus SET severance events. No registration is needed between providers.

### 8a.6 Membership is not a relation

An "employment" relation was considered as a way to subsume membership, and rejected for now:

- Members get **per-person** grants and governance powers, while slots give **uniform** access to every holder by design. Encoding per-member differences would need a relation per member, or member-scoped values, which brings roles back under another name.
- Membership is internal to one organization, so a public document adds nothing.

The person→organization side of membership, such as a profile share, can use the same fragment-grant mechanics. The console may *list* memberships next to relations for a uniform view. This is Q13.

### 8a.7 Provider roles

The spec now separates identity hosting from organization hosting (spec §14, "Provider roles"):

- An identity-only provider needs `directory.v1` and member certificates.
- An organization-only provider needs `organizations.v1`, `directory.v1` (for its organizations' own identities) and `relations.v1`.
- 3sln.me declares all of them.

### 8a.8 Integrity references

Relations need, from the [artefact references](artefact-references.md) design:

- fragment, slot and bus references pinned as URL plus `version` plus `digest` (the ART-D5 shape, which the spec now uses);
- instances and edges pinned to a relation version;
- extraction and validation of a pinned version from a later, additively extended document;
- provider caches so instances survive a document's disappearance.

The conflict with protocol §3's "immutable at a URL" rule belongs to that design (AMD-O13). Until it lands, relation documents are treated as immutable at their URLs and pinned with a digest.

## 9. Private membership checks, elements and switching

### 9.1 Rules

1. No endpoint, document or error reveals whether a principal is a member of an organization. That covers identity documents, manifests, links, relation invitations and directory lookups. Relation participation is likewise visible only to counterparts.
2. An app learns about membership only when the organization accepts a certificate (§5.3). That requires three things: the member's home provider issued the certificate for this organization and this app after the member's consent there, the app holds the certified key, and the app has a live connection to the organization. Otherwise the result is uniform.
3. The membership ID is opaque, stable per (organization, person), never equal to the person's `sub`, and never reused. It is shared among the organization's apps, so the ERP and a CRM agree on "employee X", but it differs between organizations. That stops organizations from correlating members with each other. It does **not** stop one app that the person uses in several organizations (or with the switcher) from linking them (R1-M4). The actor chain sent to *another* entity carries a pairwise ID per grantor unless `actor_disclosure:"named"` applies.
4. In member context, an app holding certificates also learns the member's `(iss, sub)` (spec §7.2). There is no "silent restore" rule at the organization. Renewal is a fresh certificate, and the home provider decides when it can issue one without UI: prior consent plus an active home session.

### 9.2 Flow inside an app

- `<bindle-session entity="https://3sln.me/identity/<o>">` makes the SDK acquire a certificate for that organization from the user's home provider, then exchange it at the organization.
- `<bindle-session entity="choose">` lets the home provider's elements or flow show the user's organizations. The home provider renders the choice, so the app never sees the list. Choosing an organization that is not connected to this app ends in the uniform failure.
- How certificates are acquired is the SDK's and home provider's business (ORG-D13). 3sln.me uses its elements, which is an app feature.

### 9.3 Islands and events (components profile, 3sln.me)

- **The `account-switcher` island gains an entity section.** "Personal" plus the organizations the user has acted in (the home provider's private record), rendered inside the island at a fixed size, so the embedder cannot count them (embed islands §13.1). The list order is neutral, and the current entity is marked.
- **Selecting an entity** makes the island, which is the home provider's frame, issue a certificate for that organization to the element's holder key. A first-time consent runs in a popup. The element exchanges the certificate at the organization's token endpoint. The island emits only `flow` start and end, with generic outcomes ([embed islands §4.4](embed-islands.md#44-outbound-island--element-part-specific)), until it delivers the certificate over its port.
- **Element events** (bubbling, composed, dispatched in a microtask after the controller event, with the `state` snapshot updated first):

| Event | Detail | When |
| --- | --- | --- |
| `bindle-entity-change` | `{previous: EntityRef\|null, entity: EntityRef, cause: 'sign-in'\|'switch'\|'revoked'\|'expired'}`, where `EntityRef = {issuer, entity, kind, member: id\|null, label}` | Only after the member-context credential is ready. Personal context has `kind:'person'` and `member:null`. |
| `bindle-entity-change-failed` | `{code: 'canceled'\|'exchange-failed'\|'network-error'}` | Not a member, not connected, declined at home and cancelled all map to `canceled`. The current entity is unchanged. |

The controller never publishes an intermediate `null` during a switch. The previous context stays current until the new credential is ready, matching the EIR-17 rule for accounts.

### 9.4 What the app learns, and when

| Moment | App learns |
| --- | --- |
| Elements mount | Nothing. Islands are constant in shape and timing for every state. |
| Personal sign-in | The person's `(iss, sub)` and personal grants, as today |
| The user opens the switcher | Nothing. The island is cross-origin with a fixed size. |
| The user picks an organization and completes the flow | The organization's URL and public label, the member's `(iss, sub)` (from the certificate), the membership ID, the member's shared label if any, the effective projection, and member-scoped fields (phase B) |
| Not a member, declined or cancelled | `bindle-entity-change-failed {code:'canceled'}`, identical in every case |
| Renewal, at most every 5 minutes | Nothing new |
| The member is removed later | The next exchange or call fails, `bindle-entity-change {cause:'revoked'}` fires, and the backend gets a `member-removed` SET |

## 10. Threat model

| Threat | Mitigation | Residual |
| --- | --- | --- |
| **Confused deputy.** The ERP mixes Acme and Beta, or an app gets an organization's provider to fetch a foreign token for a resource the member may not use. | Tokens bind `entity` and member. Resource IDs are opaque and scoped per entity. The deputy rule (§6.4 rule 5). The grantor re-checks `methods ⊆ grant`. | An app bug inside its own tenant isolation |
| **Grant escalation through relationships** | No implicit flow. Governance is non-delegable. `reshare` is refused in v1. Minting checks the whole chain. | None found within the model |
| **Stale membership caches** in apps or at the home provider | Live checks on every call, short tokens, `member-removed` SETs. Home-side records of organizations are hints and never authority. Tokens never outlive certificates. | An app that ignores SETs and caches its own decisions |
| **Cross-entity correlation of users** | Membership IDs per organization, actor chains pairwise per grantor, no published affiliations | Organizations share member handles out of band |
| **Insider admin abuse** | All admins see the audit. Governance actions are notified to every admin. Critical actions are delayed. Two admins are recommended, and an optional two-admin approval is a later feature. | One admin can do anything within the delay windows; that is inherent |
| **Organization takeover through an admin's home account** | A changed `aep` holds admin power (§5.2a). Admin actions check delegation status (≤ 60 s). The change-of-control checklist. | A home provider that fails to change `aep` on recovery |
| **Directory fetch abuse** (SSRF, amplification, slow issuers) | A membership or invitation must exist before any fetch. Protocol §2 SSRF rules. Per-issuer and global budgets. Caching. A kill switch flag. | A member's own home provider can slow verification of that member |
| **A home provider forges certificates for its users** | Inherent to provider custody and stated. Issuer allowlists. Signed approvals later. | Stated limit (ORG-D14) |
| **A certificate replayed to another organization or client** | Binding by `aud`, `client` and `cnf`; a `jti` on every proof | — |
| **Invitation theft** (organization or relation) | Principal-bound by default, single use, short `exp`, uniform errors, query redaction (links §8) | An unbound invitation is a bearer capability, and the UI says so |
| **Relation-invitation spam or liability dumping** | Acceptance is required, invitations are rate-limited per inviter, and ignoring costs nothing | — |
| **Lookalike or over-broad relation documents** (an attacker publishes "supply" with a wide matrix) | The full matrix, as it applies to the invitee, is disclosed before consent. The publisher is shown as unverified. Entries need exact methods. Grantors pick their own values per counterpart. A 3sln.me catalogue of reviewed relations (later). | Consent fatigue on large matrices |
| **Silent widening through upgrades or future joiners** | A widening upgrade needs re-consent per edge. Pre-consent to granting to future parties is forbidden. | — |
| **A grantee lies about its actor chain** | The chain is asserted and signed by the grantee's provider in the entity certificate, and disclosed as such. The edge bounds the damage. `actor_disclosure:"named"` uses verified principals. | Named chains still rest on the grantee provider's honesty |
| **Membership enumeration by timing** at the token endpoint | The membership check comes before any fetch. Outcomes are uniform. Only holders of a home-issued certificate for that organization can probe at all. | Timing is visible only to those holders, who already have the member's consent |
| **Legal hold versus deletion** | Retention locks are planned (later). Admin deletions are audited and, when critical, delayed. | Until the locks exist, an admin can delete records mid-audit |
| **Data ownership when a user leaves** | Resources belong to the organization, and personal resources stay personal. Leaving transfers nothing. Consent copy at joining says so. | Users who put personal files in organization storage lose access |
| **Export and portability abuse** (an admin exfiltrates everything) | Export is a critical action: delayed, notified and audited | Copies already taken cannot be recalled |
| **Billing abuse** (free organization farms, invitation spam) | Paid-only at launch (Q4), and rate limits on invitations and organization creation | — |
| **Hot organization single writer** (a large organization serializes every member's checks) | Bounded organization size in v1 (for example 1,000 members); measure before raising | Unknown; Cloudflare capacity needs evidence |
| **The provider operator** | Custody disclosure, as for persons | Inherent to hosted custody |

## 11. Unknown unknowns we can anticipate

- **Managed work identities.** Companies often want to *own* employee identities (`alice@acme.example`), with suspension and recovery at offboarding. The user's model is independent identities. Supportable later as 3sln.me "managed persons on a custom domain" without a new primitive. **Deferred**; bring-your-own identity first.
- **Segregation of duties.** Accounting controls require that the person who creates a payment cannot approve it. That is app-enforced, through member-scoped fields plus ERP logic. Bindle grants cannot express "not both".
- **E-invoicing mandates** (EN 16931, Peppol, national clearance). Bindle buses are not a legal invoicing channel. The ERP must bridge.
- **Record retention** of 6–10 years for books. Buses keep at most 30 days and object storage has quotas. ERP data placement must account for this.
- **Employee-monitoring law.** Audit of member actions is monitoring in some jurisdictions, such as works councils in DE or monitoring notices. The organization, as controller, must handle it. Provider transparency (members see their own audit entries) helps.
- **Dissolution and insolvency.** A liquidator needs control. Break-glass covers it, with the recovery file handed over.
- **Death of a sole proprietor.** The same, plus succession guidance in the console.
- **A home provider shutting down** locks members out. Admins need a re-invite path, and identity continuity is later.
- **Home providers that never adopt `directory.v1` and member certificates.** Their users cannot be members of organizations elsewhere. That is fine for the ERP today, since everyone is on 3sln.me, but outside members on other providers depend on those providers adopting the profile. Phase A therefore tests foreign issuers against a second local issuer, such as a separate Node adapter instance, not against a real third party.
- **Key rotation at a home provider** invalidates outstanding certificates, because fresh signatures need the current key. Clients re-acquire, which may cause short blips.
- **Custom domains on Workers** (Cloudflare for SaaS) as organization issuers: cost and certificate operations are unmeasured.
- **Handle squatting and brand impersonation** for organization names. A verified-domain badge is a later 3sln.me feature, and identity names policy applies.
- **Data residency demands** from companies. Not offered; flag in sales copy.
- **SCIM and HR provisioning.** Larger customers expect automated membership. A later `members/v1` contract could let an app *ask* for membership changes through the authorization entry, for an admin to confirm.
- **Consent fatigue.** Members confirm once per app per organization. Admins may later pre-approve that step for apps they installed: a 3sln.me policy choice, and disclosed.

## 12. Legal interactions (flag for counsel)

- **Controller and processor.** For data in an organization's pool, the organization is the **controller** and 3sln.me is its **processor**. The [privacy draft](../legal/privacy.md) currently says 3sln.me is the controller of everything (§1). Organizational accounts therefore need:
  - a **Data Processing Agreement** (GDPR Art. 28);
  - organization terms;
  - a sub-processor list (Cloudflare and others);
  - a new privacy-policy section ("When you are a member of an organization…").
- **Membership data.** 3sln.me stays the controller of each member's personal account. What a member shares with an organization becomes the organization's (controller) data.
- **Data-subject requests.** A request about data in an organization's pool goes to the organization. 3sln.me assists as processor.
- **Audit retention and employee monitoring** are the organization's legal duties. 3sln.me provides the controls.
- **Age.** Members must meet the age rule at their home provider. For foreign members, 3sln.me cannot check the self-attestation. Household organizations with minors are out of scope.
- **Terms already contemplate it.** "If you use the Service for an organization, you confirm you're authorized" ([terms](../legal/terms.md)).
- **Paid-only organizations** (Q4) keep DPA execution and support manageable. Billing stays zero-KYC through the existing merchant of record.
- **The controller is a legal person, not a Bindle organization (R1-M7).** A team organization inside Acme has Acme Ltd as its controller, so two Bindle organizations can share one controller. H, U and S are three controllers, and their sharing is controller-to-controller disclosure that needs its own legal basis (intra-group agreement). Ledgerly may be Acme's processor or an independent controller, depending on the engagement. The DPA must be accepted by someone with authority for the legal person, and organization terms should say who that is. Clubs and households may fall under the household exemption or be unincorporated associations; counsel should decide whether processor terms apply to them at all.
- **3sln.me is not only a processor.** For billing, abuse prevention, security telemetry and the member's own home account, 3sln.me remains an independent controller. The privacy policy needs both roles.
- **Ex-member data.** After Alice leaves, Acme keeps her membership record, audit entries and the records she authored, as controller and within its retention. Her access, erasure and objection requests about them go to Acme. Telling members this at joining is required, not optional.

## 12a. 3sln.me product rules for organizations (app feature, not spec)

These are user decisions of 2026-10-21. Prices are deliberately not fixed here.

- **Creating an organization requires a 3sln.me account.** The creator becomes its first admin. Other members and admins may come from any identity provider (§6.2), and need no 3sln.me account.
- **Organizations are always paid.** There is no free organization tier, which settles former Q4. Paid-only also keeps the processor role and DPA manageable (§12), and keeps organizations out of the free-account admission cap.
- **Tiers first, metering later.** Candidate tier dimensions:

| Dimension | Notes |
| --- | --- |
| Storage | Up to about 100 TB at the top tier. At R2 Standard's $0.015/GB-month ([unit economics](unit-economics.md)), 100 TB is about $1,500 a month in raw storage alone, against today's largest person tier of 1 TB for $250 a year. Top tiers need their own cost model, including backup and restore at that size, which unit economics marks as unproven. |
| AI credits | The classifier and model slots; the work and spend budgets of [semantic spend](../release/semantic-spend-audit.md) |
| Event allowance and bus count | Events Q8 and Q9 limits, scaled per organization |
| Members, including foreign members | Each member adds certificate verification, background directory refresh and audit volume |
| Relation instances and counterparts | Directory fetches, entity certificates and events per edge |
| Connected integrations | Connections and outbox |
| Audit retention and export frequency | Storage and work |

- **Metered pricing for large organizations, eventually.** It needs measured per-organization costs (the account single writer, R2, Workers AI, egress) that do not exist yet. One unknown is the single-writer bound (§10).
- **Billing** uses the existing Polar merchant-of-record path, with zero KYC. The organization is the customer, and a paying admin's card pays for it. Polar's per-transaction fee (5% + $0.50 in the model) favours annual billing. Lapsed payment needs a defined degradation: read-only, then export-only, then deletion after a notice period. It must never cut off severance, leaving or export (§10, export abuse). This is a 3sln.me lifecycle rule to add to the account lifecycle design.
- **Interactions:** `PAID_SIGNUP_ENABLED` and billing configuration; [storage write costs](storage-write-costs.md); the free-account cap docs (organizations do not count).

## 13. Implementation slices (later)

Engine-first: every operation is an ngin Action or Query in a domain module, dispatched in the organization's account single writer (the same `createAppEngine` placement as persons). HTTP and UI are thin adapters. Tests are mostly engine-level, with seeded chaos for membership races, revocation fencing and intersection properties ("effective ⊆ every ceiling" for random grant sets).

### 13.1 Flags (`packages/flags/registry.mjs` rows, default off; owned by the flags agent when added)

| Flag | Class | Dimensions | Requires | Notes |
| --- | --- | --- | --- | --- |
| `ORGANIZATIONS_ENABLED` | a | G A | — | crit, stateful. The subject is the organization's account, or the creating person for creation. It gates creation and exposure, never existing organizations' severance or export. |
| `DIRECTORY_ENABLED` | c | G | — | crit. Publishes `directory.v1` (handle lookup and identity documents). Global protocol surface. |
| `MEMBER_CERTIFICATES_ENABLED` | a | G A | `DIRECTORY_ENABLED` | crit, stateful. 3sln.me as a **home** provider issuing member certificates, with consent records and status. The subject is the member's account. Revocation and status stay available when it is off. |
| `ORG_FOREIGN_MEMBERS_ENABLED` | a | G A | `ORGANIZATIONS_ENABLED` | crit, stateful. Verifying certificates from **other** issuers, which means outbound directory fetches. It is the kill switch for that SSRF surface; same-host members keep working. |
| `ORG_RELATIONS_ENABLED` | a | G A | `ORGANIZATIONS_ENABLED`, `DIRECTORY_ENABLED` | crit, stateful. Relation documents, instances, entity certificates and imports. Cross-provider use is also behind the foreign-issuer allowlist (R2-M6). |

### 13.2 Slices and ownership (non-overlapping; IDs ORG-#)

| Slice | Scope | Files (proposed) | Phase |
| --- | --- | --- | --- |
| ORG-0 [S] | **Power resolver seam.** Owner routes pass `{actor:{principal, entity, powers, authTime, epoch}}` instead of an implicit owner. For a person acting as themselves the result is unchanged. | `packages/runtime/routes/*` owner adapters (integrator), new `packages/orgs/authority.mjs` | A |
| ORG-1 [S] | **Organization entity.** Account kind, creation, rename, kind label, keys, deletion (delayed). | `packages/identity/*` hunks after the current identity work lands; `packages/app/domains/orgs.mjs` | A |
| ORG-2 [S] | **Membership.** Invitations (link type), accept, leave, remove, expiry sweep, the admin power, last-admin guard, `member-removed` outbox. | `packages/orgs/{memberships,invitations}.mjs`, `packages/runtime/account/orgs.mjs`, `tests/orgs-*.test.mjs` | A |
| ORG-3 [S] | **Member grants and the evaluator.** Effective authority as a pure function. Hooks into RPC authorization and the preferences projection. | `packages/orgs/grants.mjs`; one hook in `packages/federation/service.mjs` (serialized after X8 owners) | A |
| ORG-4 [S] | **Member certificates and member context.** Issuance as home (the `key-delegation.v1` profile, consent per (organization, client), `aep`, status), verification, the token form, the `BindleMember` direct form, `bindle_member`, uniform failure. | `packages/identity/delegation.mjs` hunk (IDKEYS stream owner), new `packages/orgs/certificates.mjs`, one token-endpoint hunk in `packages/federation/*` (after the current editors) | A |
| ORG-5 [A] | **Console.** Context switcher, members, grants, audit, invitation acceptance page, organization context for the existing connections and preferences UI. | `apps/web/src/{bl,ui}/org-*.mjs` (after the current apps/web streams) | A |
| ORG-6a [A] | **Minimal acquisition** (3sln.me app feature). A top-level consent page at 3sln.me that issues certificates to the app's holder key, and an SDK helper. | `apps/web/src/{bl,ui}/certify-*.mjs`, `packages/sdk/src/member.mjs` | A |
| ORG-6b [A] | **Islands and elements.** Silent acquisition in the island, the entity section, events, components-profile update. | `apps/embed/src/parts/account-switcher.mjs`, `packages/sdk/src/elements/*`, `docs/profiles/components-v1.md` | B |
| ORG-7 [S] | **Directory profile** (`directory.v1`, spec §3a). Publisher routes; a verifier with SSRF-safe fetch, budgets, caching and continuity pinning, implementing the `resolveIdentityKey` directory hook. Shared with BindleBox and links. | new `packages/identity/directory.mjs`, new `packages/runtime/routes/directory.mjs`, `tests/directory*.test.mjs` | A |
| ORG-8 [S] | **Member-scoped fragment fields.** | `packages/federation/schema.mjs` hunk, `packages/orgs/member-fields.mjs` | B |
| ORG-9 [A] | **Templates and drift view.** | `packages/orgs/templates.mjs`, console | B |
| ORG-10 [S] | **Same-provider relations.** Relation-document validation (artefact class), instances and participation, invitations and joins, edges as fragment grants, entity certificates, imported resources, upgrade and leave, bus `entity` kind, `audit-log/v1`, the generic `share` relation. | `packages/orgs/{relations,instances,certificates,imports}.mjs`, `packages/federation/schema.mjs` hunk (relation validator), events hunk | C |
| ORG-11 [S] | **Cross-provider relations** (invitations, joins, entity certificates and SETs between providers, over ORG-7). Integrates the artefact-references cache. | `packages/orgs/{instances,certificates}.mjs` hunks | D |
| ORG-12 [S] | **Export, break-glass, critical-action delays, change of control.** | `packages/orgs/{export,recovery}.mjs` | B/D |
| ORG-13 | **Legal.** DPA, organization terms, privacy section (counsel). | `docs/legal/*` | before public organizations |

### 13.3 Phases

- **Phase A, the ERP minimum (rev 3; includes members from any provider), behind `ORGANIZATIONS_ENABLED` for the user's own organization:**
  - **`directory.v1`** (ORG-7): 3sln.me publishes handle lookup and identity documents, and verifies foreign identities with continuity pinning, caching bounds and fetch budgets.
  - **Member certificates** (ORG-4):
    - 3sln.me as a home provider issues certificates, with per-(organization, client) consent records, `aep` and delegation status;
    - 3sln.me as an organization's provider verifies certificates through the token form;
    - one minimal acquisition path (ORG-6a), the general Bindle flow at 3sln.me, which an SDK helper uses;
    - a test-only second issuer for foreign-member conformance. This is evidence of self-consistency, not interoperability (R2-M6). Foreign issuers stay disabled by an empty issuer allowlist until (1) the outbound-fetch egress gate of security.md passes on the production runtime, and (2) an issuer written from the spec alone, without the 3sln.me code, passes the conformance suite. The same-host path uses the same certificate code, so phase A data stays forward-compatible.
  - Create an organization, with one admin and a second recommended; console context switching. The console itself acts through certificates from the member's home.
  - Install the ERP as the organization's integration (the existing flow, with owner = organization).
  - Invitations bound to principals resolved through the directory. **Members are stored by `(iss, sub)`**, local or foreign alike.
  - Per-member grants (resource, methods, `expires_at`) plus the `admin` power.
  - Member context: DPoP-bound tokens that never outlive the certificate, no refresh token, the membership ID, and the projection intersection.
  - Organization-as-itself background access, approved separately (R1-H1).
  - The `aep` hold after recovery (R1-H3), bound admin invitations (R1-H4), the `member-removed` SET and the actor-chain audit.

  - **Rev 4 additions** (product rules, §12a): creation needs a 3sln.me account; the organization is on a paid tier, which for the user's own company can be an internal allowlist until billing is enabled. No relations: one company needs none. Phase A's connections already carry the counterparty kind `entity` in their schema, so relations need no migration later.

  **Before phase A data accrues,** settle Acme's long-lived issuer (Q7).

  The ERP keeps its own app-level roles, keyed by membership ID. Phase A has no templates, island switcher, relations, member fields or export. The scope grew by two pieces of infrastructure, the directory and certificates. Both are shared with BindleBox and links, which needed them anyway.
- **Phase B:** silent island acquisition and the entity switcher (ORG-6b), member-scoped fields, templates, export, break-glass, and optional passkey-signed approvals and organization-key audit checkpoints.
- **Phase C:** same-provider relations (ORG-10): relation documents pinned by digest (or by artefact references, if they have landed), the generic `share` relation, `group` for the user's companies, `supply` for purchase orders and invoices, an accountant firm on 3sln.me. Organization tiers and Polar billing go live before the first external organization.
- **Phase D:** cross-provider relations (needs artefact references and the egress gate), re-sharing, admission delegation, identity continuity, resource transfer, and metered pricing.

## 14. Changes needed in other documents (coordinator)

- **Spec amendments** AMD-O1 to AMD-O14, as listed in [spec/organizations.md §15](../spec/organizations.md#15-core-amendments--proposed-unsigned). They change protocol §1, §3 and §6, auth, integrations §1, §3, §5 and §6, events §2.1, links (new types and the signature-domain table), security (grants paragraph), contracts (follow-ons paragraph), and the future directory profile.
- **[Implementation roadmap](implementation-roadmap.md):** add the ORG slices and the dependency on the directory profile.
- **[Open items](../release/open-items.md):** add the §15 questions.
- **[Feature flags](feature-flags.md):** the §13.1 rows (`ORG_RELATIONS_ENABLED` replaces `ORG_RELATIONSHIPS_ENABLED`).
- **[Artefact references](artefact-references.md)** (in progress, other agent): relation documents as an adopting artefact class, with the four needs in spec §9.8.
- **[Unit economics](unit-economics.md) and billing:** an organization tier model (§12a), and the lapsed-payment degradation in the account lifecycle design.
- **[Components profile](../profiles/components-v1.md) and [embed islands](embed-islands.md):** entity section and events (ORG-6).
- **[Privacy](../legal/privacy.md) and [terms](../legal/terms.md):** the organization sections, and the DPA (§12).
- **[BindleBox spec](../spec/bindlebox.md):** "on behalf of" attribution, as a request to the messaging owner. Also: §3.2 `key-delegation.v1` becomes the shared core feature with two certificate profiles (AMD-O12), and §3.3 resolves identities through `directory.v1`.
- **[Contact delivery](../spec/contact-delivery.md) and [links §7.3](../spec/links.md#73-verifying-the-audience-identity):** replace the references to the "unimplemented directory profile" with spec §3a (AMD-O10).

## 15. Open questions for the user

Rev 3 status: Q1 is accepted. Q2 and Q6 are superseded by the 2026-10-21 clarification (§1a). Q7–Q9 were added at the coordinator's request. **Rev 4:** Q4 is decided by the user (paid, §12a), Q5 is superseded by relations, and Q11–Q13 are new.

| Q1 | ~~Use "Organization" as the term?~~ | **Accepted** 2026-10-21 (record in DEVLOG) |
| Q2 | ~~Federated login plus DPoP tokens as "signed requests"?~~ | **Superseded.** Home-certified holder keys sign requests (ORG-D5). |
| Q3 | **No roles**: per-member grants, copy-on-apply templates and app-published member-scoped fields, with live groups deferred? | Yes |
| Q4 | ~~Organizations paid-only at launch?~~ | **Decided by the user:** always paid; creation needs a 3sln.me account (§12a) |
| Q5 | ~~Grantor-initiated offers only?~~ | **Superseded** by relations (§8a). There is still no access-request queue in v1. |
| Q6 | ~~Phase A same provider only?~~ | **Superseded.** Phase A includes members from any provider (§13.3). |
| Q7 | **Where does Acme's own identity live?** (a) `3sln.me/identity/<o>` now, accepting a one-time re-key later; (b) its own domain as issuer, which needs custom-domain hosting on Workers; (c) write identity continuity first. | **(a) now**, with membership IDs, grants and ERP data keyed so a re-key is a scripted migration. Write identity continuity (c) before the first cross-provider *relationship* (phase D), when re-keying would also break counterparties. Pick (b) only if custom-domain hosting proves cheap. |
| Q8 | **Two-admin deadlock** (R1-H4 d): a removal target cancels its own removal, and two rogue admins cancel each other forever. | Position B: a mutual cancellation freezes governance into a visible "disputed" state, with members' grants unaffected. Only the recovery-file holder (meant to be the legal owner, not an operator admin) or an off-platform process ends it. This does not reward whoever acts first. |
| Q9 | **BindleBox and other operator-run apps on account deletion.** | Belongs to the deletion design: [account deletion and export](account-deletion-export.md), finding R1-M12. For organizations: a member's home-account deletion stops certificates, so the membership becomes unusable; the organization keeps the membership record and ex-member data as controller (§12). Deleting the organization itself follows the same deletion design once it covers organization accounts. |
| Q10 | **Certificate lifetime:** 300 s default and 600 s maximum? | Yes. It bounds revocation at about 6 minutes (10 at most). Owner-interface actions also check status, within 60 s. Entity certificates are capped at 300 s. |
| Q11 | **Name for relations.** "Relation" in the spec and "Relationship" in the UI, or one of the user's suggestions ("bond", "coven")? | **Relation / Relationship.** "Bond" clashes with finance vocabulary in an ERP-first product (bonds payable, surety bonds). "Coven" reads as a joke. The full check is in [terminology §6](organizations-terminology.md#6-relation-naming-check). |
| Q12 | **Admission to many-party instances.** Must every grantor consent to each joiner (chosen), or may a relation document name a slot whose holder admits others on everyone's behalf? | Every grantor, for now. Delegated admission is a real convenience for groups with many subsidiaries, but it is authority by proxy. Add it later as an explicit, per-party opt-in ("I accept whoever the parent admits") with a cap. |
| Q13 | **Membership as a relation?** | No (§8a.6). Keep membership distinct, because grants are per person and governance is involved. The console may list memberships and relations together. |

## Review round 1

Independent adversarial review, 2026-10-21. Checked against protocol, auth, security, integrations, extensions, events, incremental authorization, links, contracts, the components profile, `packages/identity/{keys,delegation}.mjs` and the federation package. Reviewer sign-off on this round: reviewer ___ / date ___ / outcome ___. Every resolution below is **provisional**. "Resolved" means the text of the design or spec now says it; it does not mean anyone signed it.

Counts: **5 High, 8 Medium, 8 Low.** Resolved in text: 5 High (H4 partly), 6 Medium, 6 Low. Open: H4 (admin stalemate part), M3 (decision), M8, L7, L8.

### High

**R1-H1. Organization-as-itself access silently voids per-member grants.** *Scenario:* Acme gives Alice only `get` on `/ledgers/2026`. The ERP is a confidential client and holds the connection-bound refresh token. Its backend serves Alice's request "delete invoice 9" with its organization-context token, which is not limited by her grants. Its audit entry reads "erp.example (as Acme)", so segregation-of-duties evidence is lost too. Member intersection (primitive 5) only binds apps that choose to use member context. *Fix (resolved):* spec §6.2 rule 5. The owner interface discloses that organization-as-itself access is a superset. The owner can approve a connection without it. The audit separates the two kinds of call. Phase A includes this so ERP connections never need reconsent later.

**R1-H2. Member context was not bound to the member, which weakened "signed requests" further than stated.** *Scenario:* §5.3 allowed Bearer access tokens, and nothing stopped a confidential backend from holding member-context refresh tokens. The ERP backend could act as Alice for up to the 180-day idle limit with no Alice present. *Fix (resolved):* spec §7.2. Member context requires `dpopJkt`. Access and refresh tokens are DPoP-bound to the member's user-agent key, Bearer is refused, and responses carry no person `(iss, sub)` or handle. Every member request then carries a signature from a key in the member's own browser. That is the closest sound reading of the user's intent available without the directory profile.

**R1-H3. Home-account recovery became organization takeover.** *Scenario (phase A, same host):* Alice is Acme's admin, and her account has email recovery on a mailbox that gets recycled. An attacker recovers the account and enrolls a passkey, so `amr` looks phishing-resistant. Recovery severance kills Alice's sessions, but the membership "survives for the real Alice" (§5.10), so the attacker signs in fresh as admin. This contradicted spec §3's own rule against gaining owner-interface authority through account recovery. *Fix (resolved):* spec §5.2a and design §5.10. Owner-interface authority is held after any home recovery or home-side severance, until re-confirmation by another admin or a 72 h notified, cancellable delay. Member grants may resume.

**R1-H4. Governance delays and break-glass could be bypassed.** *Scenarios:* (a) §5.5 waived the 72 h admin-add delay when the new admin accepted, so a compromised admin plus an accepting attacker took effect at once. (b) An unbound invitation carrying the "Bookkeeper" or admin template was a bearer governance capability. (c) A fired admin who kept the recovery file could take over 7 days later over the current admins' objections. (d) The departed admin could veto their own removal (§5.11 "unless the departed admin cancels"). In a two-admin organization with one rogue admin, each can cancel the other's removal forever. *Fix:* (a), (b) and (c) are resolved: the delay runs from acceptance and the invitee's acceptance never shortens it (§5.5); governance invitations must be bound (spec §5.1); the recovery file only adds an admin, is cancelled by any freshly authenticated admin, and is reissued on every admin-set change (§5.11). (d) is **open**. Position A: the target of a removal never cancels it, and only other admins can, so in two-admin organizations the first to act wins after 72 h. Position B: ties freeze the organization into a "disputed" state that only the recovery-file holder or an off-platform legal process resolves. The reviewer leans B (no race reward), with the recovery file deliberately held by the legal owner rather than by an operator admin.

**R1-H5. Revocation of federated members had no bound.** *Scenario (phase B):* Alice's home provider suspends her, and the `connection-revoked` SET to 3sln.me is lost. Her org-side session and her apps' member-context refresh families (180-day idle) carry on, because "the next federated sign-in fails" never happens. *Fix (resolved):* spec §5.2. Member-context renewal and owner-interface actions require a home validation no older than 1 h (provisional value).

### Medium

**R1-M1. Write tokens across entities outlived revocation inside the grantee.** The grantor cannot see Ledgerly removing Bob. A 300 s relayed token carrying `acknowledge` keeps working, which is weaker than integrations' rule that write-capable brokered contracts need live introspection. *Fix (resolved):* spec §9.4 and §9.5. Write-capable methods get tokens of at most 60 s, and grantee-side revocation at the grantor becomes MUST (outbox, retried).

**R1-M2. Deletion and immutability of ERP records.** An admin, a member with delete rights, or the ERP itself can delete ledgers immediately. Books need 6–10 years of immutable retention (GoBD, HMRC and similar). *Fix (resolved as guidance; no spec change):* in phase A the ERP, not the provider, must be the immutable system of record. It should write append-only and keep its own retention. The provider's retention lock (§11) stays later work. The reviewer also recommends **audit checkpoints signed with the organization's identity key** (a new `typ` row in the links §7.2 domain table). That is cheap, and it lets an auditor detect later rewriting of an exported, hash-chained audit, even though the key is provider-custodied. Not yet specified.

**R1-M3. Phase A identity may not be the long-lived identity.** §6.1 recommends custom-domain issuers for companies, yet phase A puts Acme at `3sln.me/identity/<o>`. Changing the issuer later changes `(iss, sub)`, the ERP's keys, every membership ID and every grant, and identity continuity is unwritten. *Fix:* decide before phase A (§13.3 now says so). This is a **user decision, open**. Choosing `3sln.me` now is fine if a one-time ERP re-key is accepted later.

**R1-M4. The privacy claim for membership IDs was overstated.** Pairwise IDs stop organizations from correlating members with each other. They do not stop one SaaS ERP used by Acme and Beta, or the switcher in one app, from linking `mbr_A` and `mbr_B` through its own client state. *Fix (resolved):* design §9.1 and spec §5.3 and §12. Responses carry no person identifiers, and the limit is stated. Also resolved: switching `pairwise` to `named` lets the grantor link past IDs, so acceptance must disclose it (spec §12.6).

**R1-M5. The rejection of URI documents rests partly on a wrong premise.** "Templates refer to private resources a public document cannot name" is false at the right level of abstraction: fragments already name resource *requirements* and bind private resources at configuration. *Fix (resolved in §7.2):* public access profiles are a safe, deferred home for templates. A safe role also exists for public relationship documents: bilateral, signed by both sides, conferring no authority. The core argument still stands: no authority may flow from a relationship kind.

**R1-M6. Lookalike organizations, and the shared origin on one provider.** Every organization on 3sln.me has the origin `https://3sln.me`, so "the grantor's verified origin" identifies no one. *Scenario (phase C):* an attacker creates `acme-ltd@3sln.me` and offers supplier S a "purchase orders" bus, and S's ERP books fake POs. *Fix (resolved):* spec §9.2. Acceptance names the grantor's identity URI and handle, and connections and imports are keyed by `(iss, sub)`. Verified-domain badges (§11) and bilateral attestations (R1-M5) are the later defence.

**R1-M7. The controller/processor split was too coarse.** The controller is a legal person, not a Bindle organization. Groups have several controllers. Accountants may be processors or controllers. 3sln.me remains a controller for billing, abuse and home accounts. Ex-member data stays with the organization. *Fix (resolved as flags in §12).* Counsel is still required.

**R1-M8. Non-repudiation for an ERP audit trail (open).** The rewritten §6.2 states what is lost relative to the user's intent: offline, third-party-verifiable evidence that a person approved something. Per-request identity-key signatures would not restore it, because those keys are provider-custodied. *Proposal:* a later **signed-approval** profile. The organization's provider (or the home provider, for federated members) obtains a passkey assertion whose challenge is a domain-separated digest of the action, and returns a bundle the ERP stores. *Position against:* WebAuthn assertions are hard to verify offline without the credential's registration context, and the ERP can do this itself without Bindle. The reviewer recommends reserving the profile name now and deferring the work. Nothing in phase A blocks it.

### Low

- **R1-L1. Journal collisions across grantees** (resolved, spec §9.4). The protocol §5 journal key `(entity, client_id, tx)` is ambiguous when two grantees use the same client on a grantor resource. Cross-entity calls are journaled by (grantor entity, connection, client, tx).
- **R1-L2. Unknown caveats** (resolved, spec §9.2). Grantees refuse offers whose caveats they do not implement, so a future caveat cannot be silently dropped.
- **R1-L3. Bus `publishers: entity`** contradicted the outbox model and had no attribution kind (resolved, spec §11). It is now reserved.
- **R1-L4. `member-removed` fan-out** told every integration about churn, including ones that never saw the ID (resolved, spec §5.4). It goes only to integrations that obtained member context for that membership.
- **R1-L5. Broker-origin rule was unimplementable.** A consumer cannot see who minted an opaque token (resolved, spec §10). The consumer now checks `broker.origin` against `grantor` and that origin's manifest.
- **R1-L6. Granular powers could confer more than their holder has.** A future "manage integrations" power could give an app resources its holder cannot see (resolved, spec §6.3).
- **R1-L7. RFC 7009 revocation used as disconnect** (open). Revoking a leaked connection refresh token for hygiene would irreversibly disconnect the relationship. Position A: keep it, because it is simple and either side ending its half is the intent. Position B: use an explicit disconnect operation and let RFC 7009 only rotate. The reviewer leans B.
- **R1-L8. Smaller items** (open, no text change). The `affiliation` parameter tells the home provider about the organization, so it should be organization policy and visible to the member. Client assertions on a shared token endpoint should name the grantor entity (`aud` alone is shared on one provider). Introspection (integrations §5.7) must answer `active:false` once a member-context token's membership ends. An optional `clients` caveat would let Acme restrict which of Ledgerly's apps may use a grant. Membership-ID stability now follows design §9.1 (stable per organization and person) in spec §5.3, which removes a contradiction.

### Answers to the questions this review was asked

- **Escalation.** No path found once H1 and H4 are fixed. Re-sharing is refused, governance cannot be delegated, and the resource host mints every token after checking each hop. Residual: a grantee's own apps receive grants, which is disclosed, and L8 suggests a `clients` caveat.
- **"Signed requests".** Sound as authorization. It is honest only with H2 (keys in the member's own agent) and the §6.2 statement of what is lost. Offline verifiability and non-repudiation are lost; cross-provider independence is unchanged.
- **Minimal set.** Sufficient for every wargame once H1 is added (a connection attribute, not a new primitive). `reshare` could be reduced to a reserved name. Retention lock and signed approvals are the missing ERP pieces, and both are deferred correctly.
- **Phase A forward compatibility.** Sound if H1, H2, H3 and H4 land in phase A, members are keyed by full `(iss, sub)` from the start (phase A must not store bare local UUIDs), and the M3 issuer decision is made first.

## Revision 3 reconciliation

The 2026-10-21 clarification (§1a) changes how members authenticate. Here is how each affected Review round 1 finding stands now. Findings not listed keep their round 1 status. Revision 3 itself is unreviewed.

| Finding | Round 1 resolution | Revision 3 |
| --- | --- | --- |
| R1-H2 (member tokens bound to the member) | Member context needs `dpopJkt`; DPoP-bound access and refresh tokens | **Re-evaluated, still holds, and stronger.** Member-context tokens are bound to the **certified** holder key, cannot outlive the certificate, and come with no refresh token. Where the key lives depends on acquisition: home providers SHOULD keep `member-access` keys on the member's device and MUST disclose server-side agents (spec §7.2). |
| R1-H3 (recovery became takeover) | Hold owner-interface authority after recovery or severance | **Kept, with new detection:** the certificate's `aep`, a key reset without continuity, or a home SET (spec §5.2a). A home provider that cannot supply `aep` MUST NOT issue certificates. |
| R1-H5 (no bound on federated revocation) | 1 h home validation before renewal | **Superseded.** Renewal needs a new certificate, and each certificate is a live check at home. The bound is the certificate lifetime plus 60 s (≤ 360 s at the 300 s default), and 60 s for owner-interface actions through the status check (spec §5.2). |
| R1-M3 (phase A identity) | Decide before phase A | Unchanged. Now Q7, with a recommendation. |
| R1-M4 (membership-ID privacy overstated) | No person identifiers in member-context responses | **Partly superseded.** An app holding a certificate necessarily learns `(iss, sub)`. Pairwise actor IDs toward other entities are unchanged. Spec §7.2 and §12.7. |
| R1-M8 (non-repudiation) | Reserve a signed-approval profile | **Reframed (ORG-D14).** Proof of origin from the home provider is the goal and is sufficient. Forgery by the provider is a stated limit. Signed approvals and organization-key audit checkpoints (R1-M2) are optional, phase B or later. |
| R1-H4 (d) (two-admin stalemate) | Open | Still open. Now Q8 with a recommendation. |
| R1-L8 (`affiliation`, assertion `aud`, introspection) | Open | `affiliation` is **withdrawn**: certificates replace federated login, and the home provider's private record of the member's organizations comes from issuing them. Assertion `aud` naming the grantor entity, introspection answering `active:false` once a membership ends, and the `clients` caveat remain open. |

## Review round 2

Independent adversarial review of design revision 3 and spec revision 2 (§3a `directory.v1`, §5.2 member certificates, AMD-O12), 2026-10-21. Checked against `packages/identity/{keys,delegation}.mjs`, BindleBox §3.4, links §7 and integrations. Reviewer sign-off on this round: reviewer ___ / date ___ / outcome ___. Resolutions are **provisional**. "Resolved" means the text now says it; nobody has signed it.

Counts: **3 High, 8 Medium, 3 Low.** Resolved in text: 3 High, 4 Medium, 3 Low. Open: R2-M4, M6 (partly), M7, M8.

### High

**R2-H1. Forged certificates were a public membership oracle.** *Scenario:* anyone builds a certificate naming the victim `(alt.example, <uuid>)` with `aud` = Acme, a garbage signature and any client, and posts it to Acme's token endpoint. Revision 2 ran the membership check (step 1) *before* the signature check and answered `invalid_grant` for a non-member but `access_denied` for a member, after a fetch to `alt.example` with visibly different timing. That breaks ORG-D9 for every organization, with no consent involved. Spec §7.3's claim that only a consented client could see the difference was wrong, because forging happens before verification. *Fix (resolved):* spec §5.2 and §7.3. One error for every failure. No request-triggered fetch: member identity documents are kept warm by jittered background refresh, and a cache miss fails uniformly and only schedules a refresh. A dummy signature check runs when step 1 fails. Failures are rate-limited identically. The "no fetch for non-members" goal is kept.

**R2-H2. The certificate chose which document vouched for it.** *Scenario:* spec §3a.1 let verifiers fetch the identity URI named in the certificate (`identity`), checking only its origin and that the document's `sub` matched. On any provider that serves attacker-influenced JSON on its origin (user uploads on a self-hosted provider, a debug route, a misconfigured static path), an attacker publishes `{"iss":…, "sub":"<victim>", "keys":[attacker key]}` and signs certificates as the victim into every organization the victim belongs to. *Fix (resolved):* the identity URI comes only from the directory (new `?sub=` lookup) or from a URI pinned when the identity was first verified through the directory. A certificate's `identity` must equal it and is never fetched otherwise (spec §3a.1 and §3a.2).

**R2-H3. Key rollback was not excluded.** *Scenario:* `alt.example` revokes a compromised key `k7` and rotates to `k8`. A stale edge cache, an old document replayed, or an attacker able to serve the document re-presents `k7` as `active`. Revision 2 defined continuity only forwards, and "key without continuity → reset, MAY accept", so the revoked key could verify again, and only owner-interface actions would be held. *Fix (resolved):* spec §3a.4. Verifiers persist monotonic key knowledge. A document reviving a retired, revoked or superseded kid, or going back to an ancestor, is rejected and is never treated as a reset. This mirrors `keys.mjs`'s monotonic states on the verifier side.

### Medium

**R2-M1. An unordered `aep` let old certificates re-trigger holds and blurred re-confirmation** (resolved). With equality-only epochs, an attacker's pre-recovery certificate (valid up to 10 min) presented after the real Alice's new-epoch certificate counted as yet another reset. That causes repeated admin holds, and an operator re-confirming "Alice" could not tell which epoch holder they were confirming. *Fix:* `aep` is a non-decreasing integer. Lower epochs fail outright, which also cuts off pre-recovery certificates as soon as the new epoch is seen. Re-confirmation names the epoch it confirms (spec §2, §5.2 step 5, §5.2a).

**R2-M2. R1-H2 regressed through acquisition** (resolved). Issuance required only "account active and consent live", with no presence. A backend holding a server key and a home-side grant could renew certificates every 5 minutes forever, which is the 180-day refresh problem again under another name. *Fix:* issuance rests on an authenticated home session or a member-approved client grant. Both are listed to the member with their holder keys and are revocable, and revoking flips the key status (spec §5.2). Server-held keys remain allowed but disclosed. R1-H2 therefore **holds conditionally**: as strong as the home provider's grant hygiene, and visible to the member.

**R2-M3. `client.origin` binding was unspecified** (resolved). If acquisition took the client from a parameter, `evil.example` could obtain a certificate naming `erp.example` for its own holder key and act at Acme as the ERP. *Fix:* the origin is the one the home provider observed (embedder, `Origin` header, or the exact redirect URI), and delivery follows authorization-code rules (spec §5.2). The rest of acquisition stays out of spec, as the user directed.

**R2-M4. Lifetime bound versus the stated "about 6 minutes" (open).** The MUST is 600 s, so the worst case for non-owner actions is 660 s, not 360 s. Position A: make 300 s the MUST for `member-access`, which matches the claim and costs home load at one issuance per 5 minutes per (member, organization, client). Position B: keep a 600 s ceiling for flaky networks and state 11 minutes as the bound. The reviewer leans A, since the status check already guards governance and Q10 asks the user exactly this.

**R2-M5. AMD-O12 conflicted with the current delegation code** (resolved in AMD-O12). `delegation.mjs` keeps one active delegate key per principal (certifying a new jkt revokes the others) and certifies only the messaging-ingress occupant. Reused as-is for member certificates, Alice's phone would revoke her laptop, and her CRM would revoke her ERP. *Fix:* both rules are scoped to the BindleBox profile, and member certificates allow keys per issuance grant.

**R2-M6. Phase A evidence and egress (partly resolved).** A test-only second issuer written by the same authors proves self-consistency, not interoperability. Outbound fetches to arbitrary issuers from Workers cannot pin resolved addresses, which is the same unmet gate as `client-id-metadata.v1` in security.md. *Fix (resolved in §13.3):* foreign issuers stay behind an empty allowlist until the egress gate passes and a clean-room issuer built from the spec passes the suite. Same-host members use the same code path, so nothing migrates later. **Open:** who writes the clean-room issuer (an agent with no repository access is the cheap option), and whether a small allowlist of known issuers may be opened earlier.

**R2-M7. Correlation (open).** Apps learn the member's global `(iss, sub)` from the certificate, so any two apps, or one app used across organizations, can correlate the person, and so can colluding organizations' apps. The home provider learns each (organization, client) and a 5-minute usage heartbeat, and status checks reveal when admin actions happen. *Are pairwise subjects needed?* **Not for phase A**: an employer knows its employees, and invitations bind the global `sub` from the directory, which per-organization pairwise subjects would break unless the home provider maps them. **Cheaper later mitigation:** encrypt the certificate to the organization's encryption key (JWE; identity documents already carry `enc` keys), so the app carries an opaque blob it cannot read, while the app keeps its own holder key. Also consider longer-lived issuance grants with shorter renewal batching to blur the heartbeat. Left open for the user, as a privacy-versus-simplicity choice.

**R2-M8. A key reset restores member grants immediately (open).** The trust anchor is the issuer origin, so whoever controls `alt.example`'s origin (a DNS or TLS hijack, or a compromised web tier) can install a key without continuity. Members then act at once; only governance is held. Position A: accept, because the origin is the anchor and hijacks are out of scope, as for every web identity. Position B: let organizations choose, as provider policy, to hold *all* member grants on a reset until re-confirmation, and offer that for high-value organizations. The reviewer leans B as an option, not a default.

### Low

- **R2-L1. The invitation path allowed fetches to arbitrary issuers** (resolved, spec §5.1). Step 1 passed whenever any unbound invitation existed. It now requires the specific invitation link to be presented.
- **R2-L2. DPoP replay across instances** (resolved, spec §5.2 step 3). The `jti` cache must be shared, or nonces are required. Direct-form requests on a multi-instance runtime would otherwise accept a proof once per instance.
- **R2-L3. Identity-document metadata** (resolved, spec §3a.3). `created` and the full key history reveal account age and rotation habits. `created` is optional, and old history may be pruned. Remaining public data (handle, kind, current keys) is the intended minimum.

### H1–H5 under revision 3

| Finding | Status in rev 3 |
| --- | --- |
| R1-H1 organization-as-itself superset | **Holds.** Spec §6.2 rule 5 is unchanged, and certificates do not touch it. |
| R1-H2 member-bound tokens | **Holds conditionally** (R2-M2). The token is bound to the certified key with no refresh token, but where the key lives is acquisition's choice, now member-visible and revocable. |
| R1-H3 recovery takeover | **Holds**, and is stronger with an ordered `aep` (R2-M1). It depends on every home provider bumping `aep` honestly; a malicious home provider is already trusted for its users. |
| R1-H4 governance bypasses | **Holds** for (a)–(c). (d) is still open as Q8. |
| R1-H5 revocation bound | **Superseded and holds**: the certificate lifetime plus 60 s, and 60 s for governance. The figure depends on R2-M4. |

### Malicious home provider (summary)

It can forge its own users into any organization they belong to (stated limit, ORG-D14). It cannot reach other issuers' members. It cannot roll back keys (R2-H3), redirect verifiers to other documents (R2-H2) or block governance except by failing closed. It can learn its users' organization usage (R2-M7). Fetches to it are bounded by SSRF rules, budgets and background-only refresh (R2-H1).

## Revision 4 reconciliation

Revision 4 adopts the user's relations proposal (§8a) and adds entity certificates. Review rounds 1 and 2 keep their resolutions except as listed here. Revision 4 was reviewed in Review round 3 (below).

| Finding | Earlier resolution | Revision 4 |
| --- | --- | --- |
| R1-M5 (public documents are safe if they grant nothing) | Access profiles and bilateral attestations deferred | **Adopted and extended.** Relation documents are pinned access matrices. Authority still comes only from consent per edge. |
| R1-M6 (lookalike organizations on one origin) | Acceptance names identity URI and handle; key by `(iss, sub)` | **Kept, extended to relation documents.** The publisher is shown as unverified and the full matrix is disclosed. Imports are keyed by grantor, instance and entry (spec §10). |
| R1-M1 (write tokens outlive grantee revocation) | Write tokens ≤ 60 s; grantee revocation is a MUST | **Re-expressed.** Write-capable methods need entity certificates younger than 60 s, or a fresh status check at the issuer. Grantee revocation means it stops certifying. |
| R1-L1 (journal collisions) | Key (grantor, connection, client, tx) | **Kept** as (grantor entity, acting entity, `client_id`, `tx`). |
| R1-L2 (unknown caveats) | Grantees refuse unknown caveats | **Kept** for relation documents through `crit`. Unknown critical members invalidate the document. |
| R1-L3 (bus `publishers: entity`) | Reserved | **Kept.** A bus may appear in an access entry only if it lists `entity` in `readers`. |
| R1-L5 (broker-origin rule) | Check `broker.origin` against `grantor` | **Kept.** The projected `token` is now an entity certificate (`token_type: "BindleEntity"`). |
| R1-L7 (RFC 7009 used as disconnect) | Open | **Resolved by construction.** Leaving an instance is an explicit operation (spec §9.6), and no refresh token is involved. |
| R1-L8 (client-assertion `aud` names only the endpoint) | Open | **Resolved.** Entity certificates carry `aud` = the counterpart entity and `instance`. The `clients` caveat stays open: a grantor cannot yet restrict which of the grantee's apps may use an edge. |
| R2-H1 (forged-certificate membership oracle) | Uniform errors, background refresh, dummy verification | **Applies to entity certificates unchanged** (spec §9.5). Step 1 checks for a live edge, not a membership. |
| R2-H2 and R2-H3 (identity URI from the directory only; no key rollback) | Resolved | Apply to organization identities and participation statements unchanged. |
| R2-M5 (delegation code assumes one key) | Scoped to BindleBox | Extended. AMD-O12 now covers three profiles, and entity certificates allow keys per issuing grant. |
| R2-M6 (foreign issuers and egress) | Empty allowlist until the egress gate and a clean-room issuer | **Also gates cross-provider relations** (phase D). |
| R2-M7 (correlation) | Open | Unchanged for members. Relation counterparts learn each other's organization identity, which is intended, plus pairwise member identifiers unless `named`. |
| ORG-D8, §7.2 "relationship kinds rejected" | — | **Superseded** by ORG-D15 and ORG-D16. |

## Review round 3

Independent adversarial review of design revision 4, spec revision 3 (§9 relations, §9.5 entity certificates, §10 imports) and terminology §6, 2026-10-21. Reviewer sign-off on this round: reviewer ___ / date ___ / outcome ___. Resolutions are **provisional**. "Resolved" means the text now says it; nobody has signed it.

Counts: **2 High, 7 Medium, 4 Low.** Resolved in text: 2 High, 4 Medium (M1 partly), 4 Low. Open: R3-M1 (admission authority), M5, M6 (residual), M7.

### High

**R3-H1. Entity certificates lost attenuation.** Rev 3's offers minted per-resource, per-method tokens. Rev 4's entity certificate named only `aud` and `instance`, and the host authorized "against the live edge grants". *Scenario:* Ledgerly gives Bob `get` on the imported "Ledgers 2026" only, and its provider issues Bob's accounting app a certificate. That certificate reaches every resource and every method on Acme's edge to Ledgerly: other ledgers, `put`, `delete`. The deputy rule (§6.2 rule 4) bound nothing, because nothing carried its result. *Fix (resolved):* spec §9.5. Certificates carry `resource` and `methods` (and optional `scope`) ⊆ the issuer's own evaluation and the edge grant. The host matches the envelope against both, and against that instance's edge only.

**R3-H2. Re-sharing by composition.** Imports can be plugged into the grantee's own fragments, and those same fragments are what the grantee grants in other instances. *Scenario:* Ledgerly puts Acme's imported ledger in its generic storage fragment, which it shares with Beta in a `share` relation. A projection that treats imports like any assigned resource re-shares Acme's ledger with `reshare:false` and no deliberate act. This is a likely implementation bug, not an exotic attack. *Fix (resolved):* spec §9.7 composition rule. Imports are omitted from every fragment projected or granted over an edge. Certificates are issued only for the provider's own entity's actors. Hosts refuse a certificate whose issuer is not the grantee of a live edge in the instance. Residual, disclosed: a dishonest provider can proxy a third party under its own identity, which the host cannot see (as before).

### Medium

**R3-M1. Split views of an instance (partly resolved).** With no central host, two suppliers can each hold a different "buyer" in a `max: 1` slot of the same instance, and an ERP keyed by (instance, slot) would merge them. Authority is safe because every edge is consented. Semantics are not. *Resolved:* spec §9.3. Views are per party, nothing may treat a slot holder as globally unique, derived state is keyed by own view and counterpart `(iss, sub)`, and invitations carry the inviter's participation statement. *Open:* who may admit. Position A: any party may invite (today's text), with per-party views and no global truth. Position B: in v1 only the creator admits into slots with `max` below some bound, which gives one canonical view for parent/buyer-style slots, and admission delegation (Q12) relaxes it later. The reviewer leans B for `group`-like relations, where "the parent" must be unique.

**R3-M2. Pre-accepting receipt is not free** (resolved, spec §9.4). "Receiving exposes nothing of its own" overlooked that received data enters automated pipelines. A buyer that pre-accepts invoices from any future supplier invites invoice fraud by lookalikes (R1-M6). Pre-accepted counterparts are shown to operators and their imports are marked, keyed by `(iss, sub)`, and they may be held until confirmed.

**R3-M3. The publisher, not the parties, set `reshare` and `actor_disclosure`** (resolved, spec §9.2). As written, the access entry fixed them. A publisher could therefore impose `"named"` disclosure of every member, and later `reshare:true`, on every instance. The document now sets ceilings, and each edge's grantor or grantee consents per edge.

**R3-M4. Instance binding and freshness** (resolved, spec §9.5). Two entities in two instances could use a certificate for instance I1 against grants made only in I2. Now only the certificate's instance edge applies. The under-60 s write rule is **workable** in the token form (one exchange per minute) and in proxy mode; relay mode needs a projection re-read per minute. It had no skew rule, so `iat` up to 30 s ahead is now allowed and no more, giving a 90 s effective bound.

**R3-M5. "Slot" is already a Bindle term (open).** Relation slots and extension slots (whose manifests appear inside access entries) share a word in one section. The reviewer recommends **position** (terminology §6 note). "Relationship labels" in spec §4 rule 4 also collides with the UI's "Relationship". This needs the user's choice.

**R3-M6. Lookalike relation documents (partly resolved).** A clone at `erp-example.co` with a wider matrix is caught by the full-matrix disclosure and per-entry consent, and ERPs pinned to the real `id` will not recognize it, so it fails safe for automation. *Resolved:* acceptance warns when a relation `id` is new to the invitee, or shares a title with one it already uses (spec §9.4). *Residual:* a takeover of the publisher's domain can append a widening version. Re-consent is required, but admins may click through, so providers should show "publisher's domain changed hands" signals where they can.

**R3-M7. A counterpart organization's key reset (open; extends R2-M8).** A key reset without continuity at a counterpart's provider is accepted by default, and entity certificates have no `aep`, so no hold is defined for relation edges. Position A: the origin is the trust anchor, so accept, as R2-M8 position A. Position B: suspend edges to a counterpart whose key was reset until a grantor operator confirms. That is cheap, because relations are low-churn. The reviewer leans B here, more strongly than for members.

### Low

- **R3-L1. The invitee committed before redemption** (resolved, spec §9.4 step 5). A refused redemption (for example, the inviter's slot is full) left committed grants dangling. They are now pending until the join succeeds.
- **R3-L2. Field narrowing across providers** (resolved as a statement, spec §9.2). It is enforceable, because only the grantor's provider ever projects the grantor's values. It narrows fields, not the data behind a resource, and atomic values become copies.
- **R3-L3. Dissolution is a per-party view and cascades into integrations** (resolved, spec §9.6). A required setup field going `unavailable` returns that integration to `configuring`. Copies, cached projections and bus records stay with the grantee. Writes into the grantor's resources stay the grantor's.
- **R3-L4. Upgrade loopholes** (resolved, spec §9.2). `required` may not change. Raising the `reshare` or `actor_disclosure` ceiling, or adding an entry for a pair, counts as widening and needs re-consent, with grantee acceptance for `"named"`.

### Earlier resolutions under revision 4

| Finding | Status |
| --- | --- |
| R1-H1 organization-as-itself | **Holds.** An organization-as-itself app can use imports with no member, and the actor shows only the client. Grantors cannot tell, which is disclosed with the actor-chain limit. |
| R1-H2, R2-M2 member-bound tokens | **Hold** (unchanged for members). Entity certificates follow the same issuance and status rules. |
| R1-H3, R2-M1 recovery and `aep` | **Hold for members.** Organizations have no `aep`; see R3-M7. |
| R1-H4 governance | **Holds**; (d) open as Q8. Consenting to grant fragments over an edge is conferring under R1-L6. |
| R1-M1 grantee-side revocation | **Holds**, now with scoped certificates (R3-H1) and a skew rule (R3-M4). |
| R1-M6 lookalikes | **Holds**, extended to relation documents (R3-M6) and pre-acceptance (R3-M2). |
| R2-H1 no oracle | **Holds.** It applies to entity certificates, and protects participation privacy (spec §12.9). |
| R2-H2, R2-H3 directory | **Hold** for organization identities and participation statements. |
| R2-M6 egress and clean-room issuer | **Holds**, and also gates phase D. |

### Phase A forward compatibility

**Still sound.** Phase A has no relations, and its connections already carry the counterparty kind `entity`. The R3 fixes add certificate members (`resource`, `methods`) and projection rules that phase A never emits, so neither phase A data nor phase A member tokens change. One caution: if the R3-M5 rename to "position" is accepted, make it before any relation code or schema exists (phase C), because it costs nothing now.
