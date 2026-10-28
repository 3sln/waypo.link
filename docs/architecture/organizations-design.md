# Organizations: design spike

Status: **provisional design, 2026-10-24, revision 5.6.** Revision 5.6 adds the ORG-10/ORG-11 relations design for implementation (§8b). It covers who establishes relations inside a 3sln.me organization (any unheld admin, with step-up and notices; narrowing is immediate), the boundary of what an edge grants (no transitivity), cross-provider gaps (signed relation events, the events endpoint from the manifest, fresh-only participation statements; spec rev 4.5), lifecycle, abuse cases, alternatives, decisions RL-1 to RL-17 and an implementation plan. It is design only, Provisional (coordinator), not signed off by the user, with one adversarial self-review round applied; ORG-10a–c were then implemented locally behind default-off flags (§8b status line). Revision 5.5: Revision 5.5 adds the ORG-12 break-glass design for an organization whose owner is gone (§12d): admin quorum, payment by the candidate, a 30-day notified wait, an owner abort from any known channel, support adjudication for contested claims, and recovery-file reissue where it is missing. Spec rev 4.4 gains one rule. It is design only, Provisional (coordinator), not signed off by the user, with one adversarial review round (BG-R1) applied. Revision 5.4: Revision 5.4 applies the user's 2026-10-22 decision that an organization's ownership can be transferred, with the recipient's billing starting over (§1c item 10, §12b.3a), and records the coordinator's provisional answers to the remaining questions (§1d): break-glass exceptions to "no timeout decides", elevations passing to a new owner, held owners and recovery, tight verification for owner GM elevations (Q14), a standard effective-methods output (Q15), a portable membership export, and the cross-provider security floors restored to the spec as minimum requirements. See [Revision 5.4 reconciliation](#revision-54-reconciliation). It is unreviewed. Revision 5.3 applies the user's 2026-10-22 decisions that membership, member grants and governance are internal to the organization (Q13 resolved; new §12c, with the rules moved out of the spec), and that admins can block an admin-requested organization move but never the owner's (§12b.5). See [Revision 5.3 reconciliation](#revision-53-reconciliation). It is unreviewed. Revision 5.2 applies the user's 2026-10-22 decisions: Q3 (no roles) is accepted, and the grant-management elevation rule is refined (§12b.2a). The refinement supersedes the R4-M4 recommendation; see [Revision 5.2 reconciliation](#revision-52-reconciliation). Q13 stays open. It is unreviewed. Revision 5.1 applies AMD-P4 ([identity portability](identity-portability.md)) and AMD-I5 ([intent links](intent-links.md)), answers R4-H2, and records a *recommendation* on R4-M4 that awaits the user. It is unreviewed. Revision 5 (reviewed in [Review round 4](#review-round-4); resolved findings applied as R4-…, open items remain open). Revision 5 applies the user's decisions of 2026-10-22 (§1c): organization identity is the same as user identity, with a recovery file; Q7, Q10 and Q11 are resolved; and messaging apps get no special treatment. It is not independently reviewed. Revision 4.3: Revision 4.3 adds the user's 3sln.me grant-management policy (§12b) and makes governance explicitly provider policy in the spec (§6.3). Revision 4.2: Revision 4.2 defines the additive growth points of the `relation` artefact kind (spec §9.2) and how each maps to widening. Revision 4.1: Revision 4.1 applies the user's decision on relation admission (§8a.9): membership in an instance is per edge, and partial membership is first-class. Revision 4: Revision 4 adopts the user's relations proposal (§1b, §8a), separates provider roles and adds 3sln.me product rules (§12a). Its effect on the review findings is in [Revision 4 reconciliation](#revision-4-reconciliation), and it was reviewed in [Review round 3](#review-round-3), whose resolved findings are applied (R3-…); its open items remain open. Earlier, revision 2 applied the resolved findings of [Review round 1](#review-round-1); open items there remain open. Revision 3 applies the user's clarification (§1a) and is reconciled with the review in [Revision 3 reconciliation](#revision-3-reconciliation). Revision 3 was reviewed in [Review round 2](#review-round-2), whose resolved findings are applied (R2-…); its open items remain open. Current local status (2026-10-24): organization entities, membership, grants, member certificates, directory, console, billing/ownership and break-glass paths have local implementations (§13); relations have local engine, runtime-route and console implementations behind default-off flags (§8b). Production verification and human sign-off remain outstanding. The coordinator records decisions in DEVLOG.md. Every decision below is unsigned until it gets a reviewer, a date and an outcome. Terminology: [organizations terminology](organizations-terminology.md). Draft normative skeleton: [spec/organizations.md](../spec/extensions/organizations.md).

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
7. Three questions stay open (§15): the organization's own issuer (resolved in rev 5), the two-admin deadlock (resolved in rev 4.3), and messaging apps on account deletion. Rev 5: Parlay is a regular app with no special treatment.

## 1b. User input: relations, provider roles, product rules (2026-10-21)

The user had not read this design. They proposed the points below, relayed closely by the coordinator, and asked whether to incorporate them, replace the relationship model with them, or reject them. [§8a](#8a-relations-proposal-assessment) gives the assessment.

1. **Relation documents.** A public, self-describing artefact identified by URI, with named slots. Each slot has an arity and lists fragment references. The document says which fragment of slot X slot Y may access, optionally narrowed to fields. Suggested names: "bond", "coven" or similar.
2. **Instances.** Organization admins opt into an instance of a relation, as a particular slot. An organization may hold several instances of one relation, and several slots.
3. **Fragments.** Everything is shared through preferences fragments. Inside the receiving entity, shared resources can be plugged into its other fragments. Users and organizations learn one concept.
4. **Provenance.** Organization requests bear the organization's identity, and user requests bear the user's (the rev 3 member certificates).
5. **Provider roles.** Identity providers and organization providers are separate roles, and 3sln.me plays both. The common contract must work between organization providers, and between an organization provider and foreign identity providers.
6. **3sln.me product rules.** Creating an organization needs a 3sln.me account. Organizations are always paid. Pricing is tiered at first (up to about 100 TB, plus N AI credits, and so on) and later metered for large organizations.
7. **Versioned integrity references.** Integrity is cross-cutting and designed elsewhere ([artefact references](artefact-references.md), in progress). Relations depend on it.

## 1c. User decisions (2026-10-22)

1. **Organization identity is the same as user identity.** The user's words: "Org identities should be the same as user identities; when the org is created they get a recovery file, including the org's private key. We can consider key rotation/succession options later. Like user identities, there's an underlying stable UUID, the more human friendly aliases are just that, aliases/pointers/handles for the underlying stable UUID."
2. **Where the organization's identity lives (Q7)** is resolved by item 1 plus a separate [identity portability](identity-portability.md) design, which a parallel agent is writing (in progress). It covers provider-to-provider moves through permanent HTTP redirects, 3sln.me transfers that require the original recovery file, and redirect guarantees. This design references it and does not design it.
3. **Certificate lifetime (Q10)** is outside Bindle. The issuer decides, verifiers read it from the certificate, and issuers disclose their revocation bound. 3sln.me defaults to about 11 minutes, configurable per organization.
4. **Naming (Q11):** Relation, Relationship, and "relation slot" where "slot" alone is ambiguous.
5. **Parlay,** the messaging app, is a regular app. It stores its data in the user's configured object-storage resource. Nothing in this design gives operator-run apps special treatment.
6. **No roles (Q3)** is accepted as recommended: per-member grants, copy-on-apply templates and app-published member-scoped fields, with live groups deferred.
7. **Elevation goes to the subject first (refines §12b).** The user's words: "the elevation sits with them until either rejected, accepted, retracted, or the one who's grants are changing accepts. Initially only the subject is given the option to accept the change; but the requester can elevate if the subject rejects the change or takes too long." Applied in §12b.2a. No timeout resolves a request in anyone's favour. This supersedes the R4-M4 recommendation (§5.11).
8. **Membership is internal; relations are between organizations (resolves Q13).** Decided by the user, 2026-10-22: "membership of an org is separate from relations; relations are relationships between orgs. Membership within an org, and access, grants, etc; are internal org matters and probably don't need to be exposed/specced in bindle … For 3sln.me, membership is simply governed by a grants list, associated with the user's identity (and the PK the user was added under)." Applied in §12c and spec rev 4.2. Places where the split may need the user's second look are listed in §12c.4.
9. **Organization moves and admin blocking (M10, final).** Decided by the user, 2026-10-22: other admins can block an org move, but not one the owner requested; the owner is more privileged; and "these elevations need tight verification because they're quite dangerous." Applied in §12b.5 and [portability §6.2](identity-portability.md#62-organizations).
10. **Ownership transfer.** Decided by the user, 2026-10-22: "An organization's ownership can be transferred. The recipient needs to setup billing before receiving the org, and billing starts over for the period, the previous owner's subscription/payment doesn't count." Applied in §12b.3a as 3sln.me provider policy. The mechanics around it (who may receive, verification, delays, refunds, what happens to pending elevations and to the old owner) are the coordinator's and are provisional (§1d).

## 1d. Provisional decisions (coordinator), 2026-10-22

The user delegated these with "go with what makes sense". Each is **Provisional (coordinator), not signed off by the user.** Implementation proceeds on them; they stay revisable, and none blocks a slice.

1. **Break-glass exceptions to "no timeout decides".** The post-recovery 72 h auto-effect (§5.11) and the billing-lapse 72 h rule (§12b.3) are explicit exceptions to §12b.2a item 4. Both are break-glass for an absent owner, and both are ownership claims, not grant-management requests. Applying the rule literally would leave break-glass unable to work in the case it exists for.
2. **A pending elevation passes to a new owner** after a transfer, a lapse claim or a recovery taking effect (§12b.3a).
3. **A subject may accept after rejecting** (§12b.2a item 5).
4. **A held owner cannot cancel a recovery** (§12b.3). A re-confirmed owner can.
5. **The 7-day response period stands,** configurable per organization (§12b.2a item 2).
6. **Q14:** owner decisions on GM elevations use the same tight verification as organization moves, without the notified delay (§12b.2, §15).
7. **Q15:** a standard effective-methods output for apps, never grant records (spec §7.5, phase B).
8. **Portable membership export.** A portable export of memberships and grants for organization moves is an interop requirement (spec §13.1).
9. **Cross-provider security floors restored.** The hold after an authority reset and bound invitations for governance powers return to the spec as minimum requirements (spec §5.1, §5.2a, §6.3), because they protect members homed at other providers. Their 3sln.me specifics stay in §12c.3.
10. **Transfer mechanics** in §12b.3a beyond the user's words (the 24 h minimum delay, the 14-day offer lapse, the automatic refund of a failed transfer, and tight verification on the offering owner).

## 2. Decisions

All decisions are provisional. Each is reversible until the spec is published.

| ID | Decision | Section |
| --- | --- | --- |
| ORG-D1 | **Term.** "Organization" in the spec and the UI ("Org" where space is tight), with an optional display kind label. "Entity" stays the spec umbrella for persons and organizations, and the SDK uses it for the acting entity. **Accepted by the user on 2026-10-21, relayed by the coordinator.** | [terminology](organizations-terminology.md) |
| ORG-D2 | **No new principal type; same identity as persons** (rev 5). An organization is an entity with a stable UUID, aliases, provider-custodied keys, and a recovery file issued at creation to its owner, exactly like a user identity. Nobody signs in *as* it: its **owner interface** is operated by members with governance powers, and the provider uses its key on their behalf. On 3sln.me it is an identity record of kind `organization` in its own account single writer. | §6.1 |
| ORG-D3 | **The directional connection is the mechanism; users see memberships, integrations and relations.** A connection runs from a grantor to an integration, a person or an entity relation party. A membership is an organization→person connection. Each edge of a relation instance is an entity connection. Each side holds and can sever only its own half (rev 4 wording). | §6.5, §8a |
| ORG-D4 | **Grants, not roles.** Grants are the only authority that Bindle evaluates. A grant names its grantee by connection and carries caveats: `expires_at`; for entity grantees also `reshare` (default `false`) and `actor_disclosure`. The spec defines no roles. 3sln.me offers copy-on-apply templates. App-specific vocabularies such as "approver" are member-scoped fields in the app's own public fragment. | §6.3 |
| ORG-D5 | **Members sign their requests with a key their home provider certified** (rev 3, superseding federated login). A member certificate binds a holder key to the member's `(iss, sub)`, one organization (`aud`) and one client, for a lifetime the issuer chooses and discloses (rev 5). Each request carries a proof by that key. The organization verifies home manifest → identity document → certificate → proof, then checks live grants for `(iss, sub)`. There is no sign-in at the organization. Same-provider members are the case where the issuer is local. | §6.2 |
| ORG-D6 | **Effective authority is the intersection along the chain**, checked on every call. Nothing flows across a connection unless a grant at that hop says so. Re-sharing to a third entity needs an explicit `reshare` caveat. Governance powers are never delegated to apps or to other entities in v1. | §6.4 |
| ORG-D7 | **Member context for apps.** An app gets "member M in organization O" only by presenting a certificate that M's home provider issued for O and for that app, either at O's token endpoint (giving a DPoP-bound token that never outlives the certificate, with no refresh token) or directly on each request. The result binds an opaque **membership ID**. Not a member, not connected and failed verification all look the same to the app. | §9, spec §7 |
| ORG-D8 | ~~Offers and grantor-minted cross-entity tokens.~~ **Superseded by ORG-D15 and ORG-D16** (rev 4). | §8a |
| ORG-D9 | **Membership is never publicly checkable.** Membership IDs are pairwise per organization, actor chains are pairwise per grantor, and no endpoint answers "is X a member of Y". | §9.1 |
| ORG-D10 | **Governance is a provider feature.** 3sln.me v1 has a single `admin` power and recommends at least two admins. Critical actions are delayed and notified, and break-glass recovery uses the existing recovery-file format. None of this is spec. Rev 4.3: changing or removing another member's grant-management grant needs that member's consent or the owner's (billing owner's) elevation (§12b). Rev 5.2: the request goes to that member first; the requester may elevate to the owner only after a rejection or a response period, and an elevation stays pending until someone acts (§12b.2a). The spec only requires each provider to define and disclose its policy. Rev 5.3: the membership model itself is provider policy too (ORG-D20). | §7, §10, §12b |
| ORG-D11 | **Resources belong to exactly one entity.** Membership never confers ownership, and leaving transfers nothing. The organization is the controller of its pool, and 3sln.me is its processor. A DPA is needed. | §12 |
| ORG-D12 | **The directory/identity-document profile is specified in [spec §3a](../spec/extensions/organizations.md#3a-identity-documents-and-key-discovery-directoryv1)** (`directory.v1`) and is a phase A prerequisite (rev 3). It is shared with Parlay, links and contact delivery, and may move to a companion document later. | §6.1, §13 |
| ORG-D13 | **Acquiring certificates is out of spec.** The spec fixes the artifact and its verification. Mechanisms are named only as non-normative examples: the home provider's embedded elements with a non-extractable key, a general Bindle authorization flow as a fallback, and native or CLI device grants. 3sln.me's element-based acquisition is an app feature. | §6.2 |
| ORG-D14 | **Proof of origin, not non-repudiation.** The chain proves "this identity's provider attests that this request came from this identity, through this client, for this organization". That is sufficient. The provider could forge, and this is stated as a limit. Passkey-signed approvals and organization-key audit checkpoints are optional later extensions. | §6.2 |
| ORG-D15 | **Relations (the user's proposal, adopted).** Public, versioned relation documents define slots with arity and an access matrix over pinned fragment references. Entities join instances in slots, possibly several slots and several instances. Every edge needs grantor consent (the grantor's own fragment values, per counterpart) and grantee acceptance. The document never authorizes by title or slot name. There is no central host: each party holds its participation. Values received arrive as imported resources, usable in the grantee's own fragments. | §8a, spec §9 |
| ORG-D16 | **Entity certificates.** An organization acting at a counterpart signs its requests with a holder key that **its own** provider certified (`aud` = counterpart, `instance`, `client`, asserted `actor`, a lifetime the issuer discloses, and a 60 s age rule for writes). This gives one credential shape for persons and organizations, and replaces grantor-minted tokens and client assertions. | spec §9.5 |
| ORG-D17 | **Provider roles.** Identity hosting (`directory.v1`, member certificates) and organization hosting (`organizations.v1`, `directory.v1` for its organizations, `relations.v1`) are separate roles; 3sln.me plays both. The common contract needs no registration between providers. | spec §14 |
| ORG-D18 | **3sln.me product rules** (user decisions): creating an organization needs a 3sln.me account; organizations are always paid; tiers first, metered later. App feature, not spec. | §12a |
| ORG-D19 | **Integrity references are a dependency.** Relations need references to fragments as URL plus `version` plus `digest` (ART-D5), instance pins to a relation version, and provider caching, from the [artefact references](artefact-references.md) design. Until it lands: immutable URLs plus a digest. | spec §9.8 |
| ORG-D20 | **Membership is internal to the organization** (rev 5.3, decided by the user, 2026-10-22). Bindle specifies only what crosses a party boundary: member certificates, the authority-epoch signal, the invitation link, the membership ID, the observable end of a membership, member context and the effective-authority outputs. Member records, member grants, templates, governance powers and the grant-management policy are provider policy. On 3sln.me a membership is a grants list keyed by origin principal, recording the keys the member was added under. Rev 5.4 (*Provisional (coordinator), not signed off by the user*): two cross-provider floors return to the spec as minimum requirements (the governance hold after an authority reset, bound invitations for governance powers), and the spec gains a portable membership export and an effective-methods output, neither of which exposes grant records to apps. | §12c, spec §5, §6.3, §7.5, §13.1 |
| ORG-D21 | **Ownership transfer** (rev 5.4). The owner of record offers ownership to a named 3sln.me account. The recipient accepts by completing checkout for the organization's plan; billing starts a fresh period, and the previous owner's paid period confers nothing. The transfer takes effect only once the payment is verified, cancelling the old subscription. Transferability and the billing rule: decided by the user, 2026-10-22. Mechanics: *Provisional (coordinator), not signed off by the user*. | §12b.3a |

Reviewer ___ / date ___ / outcome ___ (for each row).

## 3. What already exists and is reused

| Need | Existing primitive | Reuse |
| --- | --- | --- |
| Unit identity, keys, pool, preferences | Entity ([protocol §1](../spec/protocol.md)), the identity key registry (`packages/identity/keys.mjs`), the account single writer | Unchanged. An organization is one more account record. |
| Association that can be severed | Connection with state, generation, severance and SET events ([integrations §3, §6, §7](../spec/extensions/integrations.md)) | Generalized counterparty (ORG-D3) |
| What an app may touch | Fragment grants, resource fields, scoping ([protocol §3–§4](../spec/protocol.md), [resource scoping](resource-scoping.md)) | Unchanged at the organization level. Intersected with member grants. |
| Short-lived, sender-bound credentials | Brokered tokens with `aud`, `exp` ≤ 300 s and `cnf.jkt`, the generation floor and `access_ends_by` ([integrations §5](../spec/extensions/integrations.md#5-brokered-resources)) | Same shape for cross-entity tokens, plus an actor chain |
| Capability documents bound to a principal | Bindle links with a signed meta, an audience proof and single use ([links](../spec/superseded/links.md)) | Two new link types: organization invitation and relation invitation |
| Public, pinned descriptions of what may be asked | Fragments, slot and bus manifests; AMD-C2 digests; [artefact references](artefact-references.md) (in progress) | Relation documents, a new artefact class built from fragment references |
| A remote provider passing a link to the user's own provider | Links §9 opener flow (top-level POST to the user's provider) | Relation-invitation acceptance at the invitee's provider |
| Business events between parties | Event buses ([events](../spec/extensions/events.md)) | Adds an `entity` consumer kind |
| Asking for more | Incremental authorization ([incremental authorization](../spec/extensions/incremental-authorization.md)) | Unchanged for app grants. Member context uses certificates instead of an authorization entry (rev 3). Cross-entity access *requests* are deferred. |
| Signing for a principal without holding its key | `key-delegation.v1` (`packages/identity/delegation.mjs`): certificate, proof of possession, status endpoint, fencing | **Core in rev 3.** A second certificate profile, `bindle-member-certificate+jwt`, audience-bound to one organization (AMD-O12). |
| Verifying keys across hosts | Directory/identity document, until now unwritten ([contact delivery](../../apps/parlay/docs/legacy/contact-delivery.md#authorship-and-signatures)); `keys.mjs` continuity statements; `resolveIdentityKey` directory hook | Specified as `directory.v1` (spec §3a) |
| UI context switching | Islands and `bindle-account-change` ([embed islands §10](embed-islands.md#10-events)), owner-transition rules ([multi-account UI](multi-account-ui.md#owner-transition-is-a-security-boundary)) | Entity context in the switcher and `bindle-entity-change` |
| Rollout | `packages/flags` registry ([feature flags](feature-flags.md)) | Organization flags and dependencies in §13.1; default off |

## 4. The minimum primitive set

The wargames in §5 derived this set. Revision 4 folds in the user's relations (§8a), which removes three revision 3 primitives (the offer, the cross-entity token, the entity-grant flavour) and adds two (the relation document and the relation instance). Each primitive is either new or a generalization of an existing one.

0. **Identity document and certificates.** A read-only public key discovery per identity (`directory.v1`), plus short-lived certificates in which an entity's own provider binds a holder key to that entity, an audience and a client. **Member certificates** come from a person's home provider (rev 3). **Entity certificates** come from an organization's provider, for relations (rev 4). Every request is signed with the certified key (this generalizes `key-delegation.v1`).
1. **Organization entity** (rev 5). An identity like a person's (stable UUID, aliases, provider-custodied keys, recovery file at creation) of kind `organization`. It has no interactive login, and members operate its owner interface (generalizes the entity).
2. **Directional connection with counterparty kinds.** The counterparty is an integration, a person or an entity relation party. It has a state, a generation and severance. It is mechanics: users see memberships, integrations and relations (generalizes the integration connection).
3. **Membership.** An organization→person connection, plus an opaque membership ID, per-member grants, governance powers and an optional `expires_at` (§8a.6: not a relation). Rev 5.3: only its lifecycle, membership ID and member certificates are spec; its contents are provider policy (§12c).
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

1. Ray, signed in as a person, chooses "Create organization". The provider creates the account record `kind:"organization"` with UUID `o`, issuer `https://3sln.me`, its signing and encryption keys (`IdentityKeyRegistry.ensure`), and a membership `m_ray` holding the `admin` power. Ray, as owner of record (§12b.1), receives the **organization recovery file** through the ordinary recovery-file flow (encrypted under his answers, with save acknowledgement), containing `o` and the organization's private keys (rev 5). The audit records `{actor:{person:ray}, action:"org.create"}`.
2. The console switches context to Acme. This is an owner transition under the [multi-account UI rules](multi-account-ui.md#owner-transition-is-a-security-boundary): a new epoch and blanked state. Every owner-interface request now carries `(session principal, target entity, epoch)`. The server resolves Ray's powers in `o` before every read or mutation.
3. Ray installs the ERP for Acme. This is the ordinary integration flow ([integrations §3.2](../spec/extensions/integrations.md#32-installation)) with the owner `o`. The consent page shows "Connect **Acme Ltd** to erp.example" and is approved by Ray as admin. The connection `c_erp` is created, the ERP's setup fragments are configured with Acme's resources (ledger object store, invoices bus), and the token response carries `bindle_connection`.

*Failure modes.* Ray switches context in another tab mid-consent: the epoch mismatch gives a typed error and no effect. A second admin removes Ray during consent: the commit re-resolves powers and fails. The ERP shows "Acme" in a personal context: it cannot, because tokens bind `sub` to `o`.

*Derived.* The organization entity (1). The owner interface operated by members, which needs the AMD-O2 wording change. The power resolver at the route seam: today `connectionsOwner(owner, …, {authTime})` takes the session owner directly, and ORG-0 changes that (§13).

### 5.2 An employee joins and leaves; a contractor gets time-boxed access

**Joining.**

1. Ray invites Alice with the "Bookkeeper" template, which is a 3sln.me feature. The provider stores a pending membership and issues an invitation link (`bindle_meta`, type `…/links/org-invitation/v1`, single use, `exp` 7 days, optionally bound to `alice@3sln.me` resolved to `(iss, sub)` at issue). Ray sends it any way he likes.
2. Alice opens the link. The owner host verifies it as in [links §8](../spec/superseded/links.md#8-processing-order-and-results). The page shows: who invites (the organization's public name and handle, never inviter-supplied free text), what Acme will learn (her handle and the profile fields she picks), and "Acme controls what you create in Acme".
3. Alice accepts from a client that holds a member certificate her home provider issued for Acme with the `member-accept` purpose (§6.2). The 3sln.me console is such a client: since she is already signed in at home, accepting is one confirmation. One commit:
   - activates `m_alice` (a connection o→person, generation 1);
   - copies the template's grants, with `source` recorded as provenance only;
   - consumes the link and appends to the audit.

   Alice's home provider knows she uses Acme, because it issues the certificates. It keeps that privately as her person→o record. Membership is keyed by her full `(iss, sub)` even when her home is 3sln.me.

**Leaving.**

1. Ray removes Alice, or Alice chooses "Leave Acme". One commit:
   - marks `m_alice` as `disconnected` and raises its generation;
   - invalidates her member-context tokens and owner-interface sessions;
   - enqueues a `member-removed` SET to each of Acme's integrations ([spec §7.4](../spec/extensions/organizations.md#74-events)).
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
4. **Redeem.** Ledgerly's provider POSTs `{invitation, statement}` to Acme's `join_endpoint`. The statement is Ledgerly's participation statement, signed with its identity key. Acme verifies it (locally on one host, or through `directory.v1`), activates its edge Acme→Ledgerly (a connection with the fragment grant) and returns Acme's fresh statement. Ledgerly's provider verifies that statement before activating its own pending participation. Since rev 5.6, events between the two go to each issuer's manifest `events_endpoint`, not to an endpoint named in the response, and Acme's `relation-edge-state` event tells Ledgerly which resource IDs it was granted (§8b.4).
5. **Import.** "Acme Ltd · Ledgers 2026" appears in Ledgerly's pool. Ledgerly's admin grants Bob `get` on it and assigns it to the fragment of Ledgerly's accounting app.
6. **Use.**
   - Bob uses the accounting app in Ledgerly context.
   - For the imported resource, Ledgerly's provider issues an **entity certificate**: `aud` = Acme, `instance`, `client` = accounting.example, `actor:{member:pw(Bob, Acme)}`, `cnf` = the app's key, with the issuer's lifetime (660 s by default on 3sln.me).
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
2. At closing, ownership of U transfers to B's nominee (§12b.3: new subscription, atomic switch). H's staff resign their admin power (self-narrowing is immediate). Otherwise B's owner asks each of them to step down and, if they reject or do not answer within the response period, decides the elevation (§12b.2a), with notice and audit. Closing documents should therefore require the resignations, since the platform will not remove holdouts instantly.
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
| Alice's home account taken over | The attacker can obtain certificates as Alice | Recovery keeps the UUID, so the membership survives, for the real Alice **or for whoever completed the recovery**. Recovery also changes her authority epoch, so the next certificate carries a new `aep`, and Acme holds her admin power until another admin re-confirms or a 72 h notified delay passes (spec §5.2a, R1-H3). Certificates issued before recovery stop at once when Acme sees the higher `aep`, and otherwise expire within the issuer's lifetime. Admin actions check delegation status, so they stop within 60 s. |
| The ERP page's holder key | Misuse in the page (XSS) while the attacker's script runs. A non-extractable key cannot be exported. | Alice revokes the `jkt` at home, and certificates stop. Status-checked actions fail within 60 s, and others within the certificate lifetime. There is no refresh token to steal. |
| Alice's home provider's identity signing key | Forged certificates for its users in any organization | Home rotates and revokes, and organizations stop accepting within 300 s + 60 s (spec §3a.4). Home custody is otherwise an inherent trust (§6.2). |
| An organization's identity key | Forged entity certificates, participation statements, invitations or links | The provider rotates (`keys.mjs` continuity) and revokes the kid. It raises the generation on every inter-entity connection, as for a brokering-key compromise ([integrations §7.1](../spec/extensions/integrations.md#71-operations)). Counterparties cache key sets for at most 1 h; that is the residual risk. Governance is not signed with this key, so membership cannot be forged with it. |
| The provider itself | Total, within its custody | Out of scope, as for persons ([security](../spec/security.md#trust-boundaries)). Self-hosting moves custody, it does not remove it. |

### 5.11 Lost admin (bus factor)

- **Admin lost their device.** Home-provider recovery restores the same `(iss, sub)`, so the membership returns with the next certificate. Recovery changes `aep`, so the admin power resumes after re-confirmation (§5.2a). Nothing organization-specific is needed. This is the common case.
- **Admin gone for good** (left the company, unreachable, died), and another admin exists. Rev 4.3 (§12b): removing a departed admin's GM grant needs that admin's consent, which they cannot give, or an **owner-approved elevation**. Under rev 5.2 (§12b.2a), the removal request goes to the departed admin first; once the response period passes without an answer, the requester elevates it to the owner, who decides. If the owner is the one who is gone, see §12b.3.
- **No admin left, or the owner gone.** Break-glass is now ordinary **organization recovery** (rev 5). It is the same flow as person recovery, applied to the organization's identity, followed by the grant-management policy:
  - **The file.** At creation, the owner of record (§12b.1) receives the organization's recovery file. It is the same format as a person's ([recovery identity](../3sln/accounts/recovery-identity.md)), containing the organization UUID and private keys, and it is issued through the same encrypted, save-confirmed flow.
  - **Reissue.** The file is reissued, and the previous reset credential invalidated, on every **ownership** change (transfer or lapse, §12b.3), so a former owner's copy stops working. Admin changes do not trigger a reissue, because the file belongs to the owner role. A copy reissued after a transfer still contains the same keys, because rotation is deferred. The old reset credential cannot start a recovery, but the old owner did hold the private keys, and that is a stated residual until rotation exists (spec §3). Since review round 4, certificates are signed by provider-held certification keys that no file contains, so the old keys cannot mint working certificates (R4-H1). What remains is limited to non-authorizing signatures (links, participation statements) and whatever identity portability accepts (R4-H2).
  - **Passphrase.** An organization file guards durable private keys of a high-value identity against offline guessing, so 3sln.me requires a generated high-entropy passphrase for it, never personal-knowledge answers (R4-M5).
  - **Recovery.** Completing it requires a person authenticated with their own identity. It increases the organization's authority epoch (spec §3) and confers no owner-interface authority by itself.
  - **After recovery (3sln.me policy).** The recovering person becomes a candidate owner and admin. This takes effect 72 h after notice to the current owner and every admin, and only the **current owner of record**, freshly authenticated, can cancel it. Admins cannot, because the file is the owner's instrument (§12b.2). A **held** owner (§12b.3) cannot cancel; once re-confirmed, they can (*Provisional (coordinator), not signed off by the user*; §1d item 4). If the recovering person *is* the current owner, it takes effect at once. The 72 h auto-effect is an explicit exception to "no timeout decides" (§12b.2a item 4, §1d item 1): it is break-glass for an absent owner. When it takes effect, pending elevations pass to the new owner (§12b.3a).
  - **~~Proposed amendment (R4-M4 position B)~~ — superseded by the user's elevation rule (2026-10-22, §12b.2a).** The 14-day extension on admin objection, the 30-day ban on elevation by a recovery-derived owner, and the "held owner cannot cancel" clause are withdrawn. What the new rule changes here: an owner, including one derived from recovery, can no longer remove admins instantly. Each removal goes to the admin first, and the owner can decide it only after that admin rejects or the response period passes (§12b.2a). Admins therefore get at least that period's notice before any purge, and every step is audited. ~~Still open: whether the 72 h auto-effect above is itself a timeout resolving in the recovering person's favour, and whether a held owner may cancel.~~ **Rev 5.4, Provisional (coordinator), not signed off by the user:** the 72 h auto-effect is an explicit break-glass exception, and a held owner cannot cancel (§1d items 1 and 4). Implementation proceeds on both; they stay revisable.
  - 3sln.me does no KYC and adjudicates no dispute beyond this. *Rev 5.5 (provisional):* when the owner is gone **and** the file is lost, ORG-12 break-glass (§12d) applies. Its Track S lets support decide held claims within that state machine only (§12d.8, BG-16).
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

An organization has everything a person has, including a recovery file, except interactive login (rev 5):

- `(iss, sub)`, with `sub` a UUID;
- a handle in the provider's namespace, such as `acme@3sln.me`, or a custom domain;
- signing and encryption keys custodied by its provider, which signs with them only for authorized owner-interface actions and live grants (spec §3). Members never hold them, and the only export is the owner's recovery file;
- a resource pool, preferences, connections, grants and audit.

Its identity document (directory profile) adds `kind: "organization"`. **Self-contained** therefore means two things. Everything that defines the organization lives in its own account. Every association is a connection it can sever alone.

**Portability.** Export covers members (as principals), grants it issued, connections, imported-resource references, audit and resources. Grants it *holds* from others must be re-confirmed by their grantors after a move, because tokens and grants never migrate automatically ([protocol §1](../spec/protocol.md#1-model-and-custody)). Durable identity across providers needs either:

1. the future identity-continuity spec (a successor statement signed by the old key), shared with persons; or
2. a **custom-domain issuer**: the organization's own domain is the issuer, and the domain owner can repoint it.

For companies, (2) is natural and recommended. It requires custom-domain hosting on 3sln.me, which is an unknown for Workers (§11).

**User's assumption, checked (rev 3).** "User identity is easy to verify from the public key plus the Bindle manifest." That becomes true with `directory.v1` ([spec §3a](../spec/extensions/organizations.md#3a-identity-documents-and-key-discovery-directoryv1)), which is now a phase A prerequisite. Today only same-host keys verify. Two refinements:

- Each request is signed by a short-lived holder key that the home provider certified, not by the identity key, because identity keys are provider-custodied and never leave the provider.
- Verification needs the identity document as well as the manifest.

### 6.2 Members stay independent; how they authenticate (rev 3)

A member is always their own person entity at their home provider. An organization never creates, recovers or suspends a member's identity, and never runs its own sign-in for members.

**Model** ([spec §5.2](../spec/extensions/organizations.md#52-member-authentication-certificates-and-signed-requests)):

- The client acting for the member holds a holder key.
- The home provider certifies that key for (member, organization, client), for a lifetime it chooses and discloses (rev 5; 3sln.me's default is about 11 minutes, configurable per organization).
- Every request carries a proof by the key.
- The organization verifies the chain and derives authority from `(iss, sub)` by live grant checks.

**The verification chain:**

1. The certificate's `iss` → the home manifest (an SSRF-safe fetch, cached ≤ 1 h) → `directory.v1`.
2. The identity URI → the identity document → the `active` signing key (continuity-pinned, cached ≤ 300 s).
3. The certificate itself: `typ`, `aud` = this organization, purpose, `client`, expiry (and the verifier's local maximum, if any), `cnf.jkt` and `aep`.
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
- other requests fail within the issuer's disclosed lifetime plus 60 s: about 12 minutes at 3sln.me's 660 s default. An organization may shorten it for certificates it accepts, as verifier policy, and 3sln.me as issuer honours that setting.

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

**The spec sees only effective authority.** Another provider never evaluates Acme's internal grants. Apps see effective grants in their projection and tokens. Whether a provider uses roles, groups or templates is therefore **its own business**, and the spec defines none. Rev 5.3 (user decision, ORG-D20) extends this to the member records themselves (§12c).

**App-specific permissions** ("can approve purchase orders up to €10k") are app semantics. The Bindle-native way to manage them centrally is a **member-scoped fragment** that the app publishes. For example, `https://erp.example/fragments/member-access/v1` has `role: enum[viewer, clerk, approver, admin]` and `approval_limit: integer`, each marked `"scope":"member"`. Acme's admins set the values per member in the console, and templates can set them too. The member can see their own values. The ERP reads them in member context and enforces them. The app defines the vocabulary as a public URI document, which is the user's hunch in a precise form, and Bindle stores the values without interpreting them. This is phase B. Until then, the ERP keeps its own role table keyed by membership ID.

**Governance powers** (managing members, grants, integrations, relationships, audit, billing, deletion) are owner-interface powers, not contract methods. 3sln.me v1 has one power, `admin`. Granular powers can follow without spec change.

### 6.4 Delegation and attenuation

**The model is grantor-held records plus derived short-lived capabilities.**

- Each hop is a **grant record at that hop's grantor**: U→H at U (the relation edge), H→Carol at H, H→the consolidation app at H. Each grantor revokes its own hop immediately, at its own provider.
- Credentials are short-lived and sender-bound. Since rev 4, each acting entity's own provider certifies a holder key after checking its own hops, and the resource's host verifies the certificate and checks its own hop live (spec §9.5).
- Attenuation: the edge carries only the matrix entries the grantor consented to. Certificate lifetimes are the issuer's choice (rev 5), and write-capable methods need certificates younger than 60 s.

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
| Member removed or expired | Next call (live check) | ≤ 360 s (`access_ends_by`) | The grantee stops certifying keys for that member: the issuer's lifetime + 60 s, and ≤ 60 s for write-capable methods |
| Organization→app connection revoked | Next call | ≤ 360 s | As above |
| Grantor ends an edge | Next call at the grantor | ≤ 360 s | Next call (the grantor checks the edge live) |
| Party leaves the instance | — | — | Unilateral: its edges end, and counterparts get `connection-revoked` (spec §9.6) |
| Home-account recovery, suspension or key or consent revocation | Home stops issuing certificates. Owner-interface actions stop within 60 s (status check). Other calls stop within the issuer's disclosed certificate lifetime plus 60 s (about 12 minutes at 3sln.me's 660 s default). An optional SET to the organization makes it immediate. A recovery also changes `aep`, which holds admin power (§5.2a). | As left | As left |

### 6.7 Audit

Every entity's provider records governance actions and every call with an **actor chain**:

```json
{"entity":"…/<o>","via":[{"entity":"…/ledgerly","member":"p_7f…"},{"client":"https://accounting.example"}],
 "action":"rpc","resource":"…","contract":"…","method":"get","tx":"…","at":1792500123}
```

The audit never contains payloads, tokens or preference values ([security](../3sln/release-gates.md#audit-and-operational-controls)). Admins can read it. Members can read entries about themselves. Grantees can get it through a grantable `audit-log/v1` contract (phase C). Retention is the organization's choice within provider bounds. The audit is hash-chained, as the feature-flag admin audit is.

## 7. Spec versus 3sln.me boundary

### 7.1 Placement

| Item | Bindle spec | Components profile (3sln.me) | 3sln.me feature |
| --- | --- | --- | --- |
| Organization kind; identity-document `kind` | ✓ | | |
| Connection counterparty kinds; a membership's observable lifecycle (live, ended, `member-removed`) and membership ID | ✓ | | |
| Organization-invitation and relation-invitation link types | ✓ | | |
| `directory.v1`; member and entity certificates | ✓ | | |
| Relation documents (artefact class), instances, edges, lifecycle | ✓ | | |
| Provider roles (identity hosting, organization hosting) | ✓ | | |
| Member context (certificate token form, `bindle_member`, uniform failure) | ✓ | | |
| Effective-authority intersection and its outputs to apps and counterparts; no inheritance; deputy rule | ✓ | | |
| Authority-epoch signal from home providers (`aep`, resets) | ✓ | | |
| Grant caveats `expires_at`, `reshare`, `actor_disclosure` (integration grants and relation edges) | ✓ | | |
| Membership records: grants list keyed by origin principal, added-under keys (§12c) | | | ✓ |
| Member grants, holds and re-confirmation after authority resets, bound invitations for governance, last-admin and no-operator guards (§12c.3) | | | ✓ |
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
| A grantor's integration-hosted resource | The grantor's provider verifies the entity certificate, then mints a brokered token whose `client_id` is the grantee entity and which carries the actor chain | A profile of [integrations §5.3](../spec/extensions/integrations.md#53-consumer-credentials) |
| Human conversation | Bindle Messaging between organization principals | **Gap:** "on behalf of member" attribution |
| "Contact Acme" public intake | Contact links on the organization principal | Existing, with the organization as owner, through whichever messaging app occupies its messaging-ingress slot (for example Parlay, a regular app) |
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
| Expiry | The issuer's disclosed lifetime, with no refresh. Write-capable methods need certificates younger than 60 s or a fresh status check. |
| Key binding | `cnf.jkt` is **required**: the consumer app's key in relay mode, or the grantee provider's gateway key in proxy mode |
| Actor chain | `actor: {member?, client?}`, asserted and signed by the acting entity's provider, recorded by the grantor, and never authority by itself |
| Severance | Edge connections follow [integrations §7](../spec/extensions/integrations.md#7-severance). Inside the grantee, revocation means it stops certifying. |

### 8.4 A separate team organization versus a member set

Use a separate organization when the team owns resources, integrations, billing or a lifecycle independent of the parent, such as a possible sale or a reorganization. Otherwise use templates now and member sets later. Never model a department as an organization only to mirror an organization chart: every organization adds governance overhead and another bus factor.

### 8.5 Gaps found

1. ~~Directory/identity-document profile.~~ Specified in rev 3 (spec §3a). The remaining biggest dependency is now **artefact references** (§8a.8).
2. **Entity-signed records.** Bus records and RPC results are attested by their host, not signed by the entity. Invoices that third parties such as auditors must verify later need a JWS-by-entity-key profile.
3. **"On behalf of" in Bindle Messaging.** An organization mailbox message should show "Acme (Alice)". The Parlay author descriptor has no member attribution.
4. **Member-addressed activity.** "PO needs your approval" from Acme's ERP to Alice's activity feed works on one host. Across providers it needs forwarding.
5. **Import fan-in.** A supplier with 500 customers holds 500 imported purchase-order buses, one per edge. Fragment resource fields are bounded (cardinality 8 in examples). It needs a listing query over imports by relation and slot.
10. ~~Admission delegation.~~ Resolved by the user (§8a.9): every grantor consents for itself, and partial membership is normal.
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

- **Consent.** Every edge needs grantor consent and grantee acceptance, so a newcomer reaches each existing party only with that party's consent. Parties may pre-accept *receiving* from future joiners, but never pre-consent to *granting*. Rev 4.1: this is now the user's decision, and partial membership is normal (§8a.9).
- **Arity.** Each party enforces arity over its own view: it never recognizes more holders of a slot than `max`. There is no global roster or consensus, because no central host is wanted and none is needed for authority.
- **Leaving and removal.** Leaving is unilateral and ends all of that party's edges. Removal is per grantor ("stop sharing with them"). There is no instance-wide vote.
- **Upgrade.** Each edge is pinned to a version both ends accepted. A wider version needs re-consent from the grantor and acceptance from the grantee. A non-widening upgrade completes once both ends pin it.
- **Dissolution.** When no edges remain, imported resources go `unavailable`, and the grantee's dependent fragment fields report `requiresConsent`. Nothing is recalled.

### 8a.5 Across providers

- **The instance record.** Each party's provider hosts its own participation. The instance URI is minted by the creator's provider and confers nothing.
- **Signatures.** Participation statements and invitations are signed with each organization's identity key and verified through `directory.v1`. Entity certificates sign every request.
- **The common contract** is `directory.v1` plus `relations.v1` (invitation acceptance, join endpoint, entity certificates) plus severance events. Since rev 5.6 these are relation events signed by the sending entity's certification key (spec §9.9, §8b.4). No registration is needed between providers.

### 8a.6 Membership is not a relation

An "employment" relation was considered as a way to subsume membership, and rejected for now:

- Members get **per-person** grants and governance powers, while slots give **uniform** access to every holder by design. Encoding per-member differences would need a relation per member, or member-scoped values, which brings roles back under another name.
- Membership is internal to one organization, so a public document adds nothing.

The person→organization side of membership, such as a profile share, can use the same fragment-grant mechanics. The console may *list* memberships next to relations for a uniform view.

**Resolved (Q13, decided by the user, 2026-10-22):** "membership of an org is separate from relations; relations are relationships between orgs." Membership stays distinct, and is now also out of the spec except where it crosses a party boundary (ORG-D20, §12c).

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

### 8a.9 Admission and partial membership (user decision, 2026-10-21)

The user's words: "for adding new parties to a relationship, every org in a slot that grants resources to the slot in which an org was added, must consent to share their resources. This means partial additions to the coven can exist, where some parties decide to share, and others do not recognize an org's membership, or haven't yet consented." The user said "coven" casually; the name is still pending (Q11).

**Recognition is per edge.**

- Party X recognizes newcomer Z exactly when an edge between them is live.
- Each grantor whose slot grants to Z's slot decides independently, with its own fragment values. Grantees accept.
- No edge exists until both have acted.
- There is no instance-wide membership: each party's view is its own recognized set. Some parties may share with Z while others decline or have not decided yet. That is a normal state, and nothing waits for views to converge.

**Arity is per view.** A party never recognizes more holders of a slot than `max` allows. `min` is advisory. When views differ, each party's own view is authoritative *for that party only*. Review R3-M1's "split views" are therefore the intended model, not a defect: two suppliers may recognize different "buyers" in a `max: 1` slot, and each is right about its own edges. Nothing may treat a slot holder as globally unique. This resolves R3-M1's open question without a canonical view. R3-M1's position B (only the creator admits) is not needed, because uniqueness matters only within a view, and each view enforces it.

**Who proposes.** Any party may propose a newcomer, through an **introduction** event sent to its counterparts whose slots grant to, or receive from, the newcomer's slot (spec §9.4). It confers nothing. **Recommended over "creator only for one-holder slots"**, because a creator-only rule would recreate a central authority that the per-edge model makes unnecessary. A party is never forced to recognize anyone, and arity protects its own view.

**Admission** into any edge needs that edge's grantor consent and grantee acceptance, through a relation invitation and redemption, as before.

**UX (3sln.me feature):**

- **Recognition state.** Shown to the proposer's admins ("recognized by 2 of 3 grantors you introduced Z to"), from the recognition notices counterparts choose to send. Other parties' admins see their own decision and pending introductions.
- **Pending decisions.** Introductions waiting for a decision appear in the activity center as operator items, with the candidate's identity URI and handle, the relation, the slot and the full matrix that would apply. They expire after 30 days, and an expired introduction is a silent decline.
- **The newcomer** sees only the edges that exist ("Acme shares purchase orders with you"). It never sees "waiting for Beta" or "Beta declined", and nothing implies that unconsented parties share anything.

**Privacy.** Minimal disclosure: the newcomer learns only the edges that exist. Decline and pending states go only to the proposer, and only if the deciding party chooses to send them. This prevents the newcomer from inferring a counterpart's business decisions, and it matches the uniform-outcome rules elsewhere (§9.1).

## 8b. ORG-10 and ORG-11: relations design for implementation (rev 5.6)

Status: **designed 2026-10-24; ORG-10a–g implemented locally through 2026-10-26, behind `ORG_RELATIONS_ENABLED` and `ORG_FOREIGN_RELATIONS_ENABLED` (both default off, RL-1). Provisional (coordinator), unsigned and not production-verified.** ORG-10a–e supply document validation, pinned instances, invitations, signed participation and events, entity certificates, scoped edges/imports, RL-4 holds and lifecycle operations. ORG-10f adds the engine domain, durable account RPCs, verified-sender same-host transport, scoped RPC/token adapters, alarm/key refresh, deletion pre-purge publication gate and routes. ORG-10g adds the console, full matrix review, acceptance, activity, edge controls, imports/member views, holds, rebinding, introductions, export and change-of-control/deletion checklists (en/es). The catalogue supports its reserved `.example` pins only; arbitrary document fetching remains ORG-11. **Upgrade reconciliation (provisional):** a newer additive pin creates a replacement instance/invitation with ordinary full disclosure and acceptance, leaving the previous edge unchanged until explicitly ended; same-instance per-edge migration is not implemented. The shipped catalogue has version 1 only, so it offers no newer versions today. ORG-11 transport, moves/import restoration and clean-room conformance remain unimplemented; foreign counterparts are refused and `relations.v1` is not advertised on flags alone. [ORG-10a–c ledger](../../DEVLOG.md#2026-10-24--org-10a-c-relations-core-flags-off), [ORG-10d/e ledger](../../DEVLOG.md#2026-10-24--org-10de-entity-certificates-and-relation-events-flags-off), [ORG-10f/g ledger](../../DEVLOG.md#2026-10-26--org-10fg-relations-routes-and-console-flags-off). Local adapter gates are closed as recorded below; independent security review, production gates and human sign-off remain outstanding. Reviewer: ___ Date: ___ Outcome: ___

Every rule in this section is **Provisional (coordinator), not signed off by the user**, unless it quotes a user decision. The decisions that need the user are listed in §8b.9 (RL-1 to RL-17). Spec rev 4.5 carries the interoperable part (spec §9.3, §9.4, §9.9, §12, §14, §16).

### 8b.0 What is already settled, and what this section adds

Relations are the user's design. §1b, §8a and spec §9 record it, and this section changes none of it:

- **Between organizations.** The user's words (2026-10-22): "relations are relationships between orgs". Membership, member grants and governance are internal to each organization (§1c item 8, ORG-D20). A relation never touches them. The spec still allows a `person` as a party (spec §9.2 `kinds`), for example a sole trader. 3sln.me offers relations between organizations only in v1 and leaves the spec unchanged (RL-17).
- **The document is the kind.** A relation is a public, versioned document with slots, arity and an access matrix over pinned fragments (ORG-D15, spec §9.2). It grants nothing. Titles and slot names never authorize (§8a.1).
- **Consent per edge.** Every edge needs grantor consent with the grantor's own values and grantee acceptance. Admission and recognition are per edge, partial membership is normal, and arity is per view (§8a.9, the user's decision of 2026-10-21).
- **No central host.** Each party's provider holds its own participation (§8a.5).
- **No onward flow.** `reshare` is refused, imports are omitted from fragments granted over an edge, and owner-interface authority never crosses an edge (spec §6.2 rule 3, §9.7).
- **Entity certificates.** The acting organization's own provider certifies requests after checking its own hops (ORG-D16, spec §9.5).

This section adds what is still missing before ORG-10 and ORG-11 can be built:

1. who inside a 3sln.me organization may establish, widen and narrow relations, and how that fits the elevation model (§8b.2);
2. the exact boundary of what an edge lets the counterpart do (§8b.3);
3. four interop gaps that block cross-provider relations (§8b.4): relation events had no defined signer or verification; the counterpart's events endpoint came from an unauthenticated response; participation statements had no freshness, so a party that had left could still be presented as a participant; and no message told a grantee which of the grantor's resources it had been granted;
4. lifecycle interactions with suspension, billing lapse, transfer, break-glass, deletion and moves (§8b.6);
5. abuse cases (§8b.7), alternatives (§8b.8), decisions (§8b.9) and the implementation plan (§8b.10).

**Phase labels.** The coordinator's request calls this the phase B relations work. §13.3 places ORG-10 in phase C (before the first external organization) and ORG-11 in phase D (after artefact references and the egress gate). This section keeps those release gates and lets implementation start now behind default-off flags (RL-1).

### 8b.1 What a relation is

A relation is whatever its document's matrix says, and nothing else. Familiar business relationships are documents, not built-in kinds:

| Business relationship | Relation document (examples; 3sln.me catalogue, RL-14) | Slots |
| --- | --- | --- |
| One-off sharing ("send the auditor this folder") | `share` | `owner` (1) grants `recipient` (1) a generic storage fragment |
| Parent and subsidiaries | `group` (§5.5) | `parent` (1), `subsidiary` (0–64); optional sibling entries |
| Vendor and customer | `supply` (spec §9.2) | `buyer` (1), `supplier` (1–256) |
| Client and professional firm | `accounting-engagement` (§5.4) | `client` (1), `firm` (1) |
| Partners | A symmetric document: one slot `partner` (2–8) with a sibling entry `partner`→`partner` | — |
| Joint venture, transition services | `joint-venture`, `transition-services` (§5.5, §5.14) | per document |

What a relation is **not**:

- **Not a hierarchy.** A `parent` slot gives the parent only what each subsidiary grants it. The parent does not govern the subsidiary. Governance of a subsidiary is held by direct members (§5.5), and the deferred "governance via relationship" feature (§5.6) remains deferred.
- **Not membership.** Members of one party are never members of another because of a relation (§8a.6).
- **Not a trust signal.** A relation creates no badge, no public listing and no verification of the counterpart's legal identity (§8b.5, RL-9).

### 8b.2 Establishing a relation (3sln.me policy; the spec leaves this to each provider)

Spec §9.4 step 1 requires only "a person who can operate the invitee's owner interface". Who that is, inside an organization, is the provider's membership and grant policy (spec §6.3). For 3sln.me:

**Who may act.** Relation actions are owner-interface actions, so they need the `admin` power (§12b, §12c), exercised by an admin whose governance is not held (§12c.3). Ownership adds nothing, because ownership by itself gives no GM grant (§12b.1 item 5). The owner acts on relations only as an admin.

**Three classes of action.**

| Class | Actions | Needs |
| --- | --- | --- |
| **Widening outward** | Creating an instance with outgoing grants; inviting with bound values; accepting an invitation that grants anything; consenting to an introduced newcomer; accepting a widening upgrade for an outgoing edge; adding resources to an existing outgoing entry | One unheld admin, a fresh passkey step-up (a status-checked certificate, spec §5.2 step 4), the full matrix disclosure, immediate notice to every admin, and an audit entry |
| **Accepting inward** | Accepting an edge that only receives; pre-accepting receipt from future holders of a slot (spec §9.4); accepting `actor_disclosure:"named"` for an edge | The same as widening. Receiving is not free: it admits counterpart-authored data into the organization's pipelines (R3-M2) |
| **Narrowing** | Suspending, ending or narrowing an outgoing edge to its optional entries; declining or ending an incoming edge; leaving an instance; withdrawing an invitation; declining an introduction | One admin, ordinary authentication. Immediate, with notice to every admin and an audit entry. Never needs anyone's consent |

**Why no subject-first step or owner elevation.** The elevation rule (§12b.2a, the user's decision of 2026-10-22) protects a member whose grant-management power another admin is changing. A relation action has no such subject: it changes the organization's grants to another entity, never a member's GM grant. It is the same act as approving an integration's fragment request, with an entity in place of an application (spec §9.1), and approving integrations is an ordinary admin action. So the same rule applies (RL-2):

- Any admin can narrow at once. If one admin creates an edge another admin thinks unwise, the second admin ends it, with no race to win: ending is always allowed and never needs consent.
- Changing **who may manage relations** is a GM change and stays fully under §12b and §12b.2a, subject first and then the owner with tight verification.
- **Tight verification** (portability §6.2 items 1–3) is reserved for changes of control and identity location: moves, transfers and owner GM decisions (§12b.5). No relation action changes control or identity location, so none needs it.

**The flow** (spec §9.3–§9.4, unchanged):

1. An admin picks a relation (catalogue or URL) and the organization's slot. 3sln.me fetches the pinned version, validates it (spec §9.2) and shows the matrix as it applies to that slot.
2. The admin names the counterparty by handle. 3sln.me resolves it to `(iss, sub)` through the directory (spec §3a.2) and shows the identity URI, handle and verified origin before confirming. On a shared origin, the handle and identity URI identify the counterparty, not the origin (R1-M6).
3. The admin binds the organization's own values for each outgoing entry: resources chosen per entry, optional [resource scoping](resource-scoping.md), optional `expires_at`. Imported resources are never offered (spec §9.7).
4. 3sln.me records the participation and the pending outgoing grants, and issues a relation invitation bound to the counterparty, carrying a fresh participation statement (spec §9.3, rev 4.5).
5. The counterparty's admin opens the link at **its own** provider, which shows the spec §9.4 disclosures, binds its values for any entries it grants, and records its participation as pending.
6. Redemption activates both sides (spec §9.4). On one host this is a call between the two organizations' account writers, but it produces and verifies the same participation statements through the same ports (RL-15). ORG-11 then adds only transport.

**Who sees the request.** On 3sln.me, an invitation between two 3sln.me organizations also appears as an item in the invitee organization's admin activity, under the flood limits of §8b.7. Across providers, the invitation is a link delivered out of band, as spec §9.4 already defines. No provider pushes invitations to another provider.

### 8b.3 What a relation grants

**Exactly the live edges, and each edge only its consented fragment grants.** Access always goes through the existing grants and certificates:

```
Acme (grantor)  --edge: ledger-store, get, /ledgers/2026, expires 2027-04-30-->  Ledgerly (grantee)
Ledgerly: imported "Acme · Ledgers 2026" --member grant (Ledgerly policy)--> Bob
Ledgerly: imported resource assigned to the accounting app's fragment --app grant--> accounting.example
Bob's home provider --member certificate--> Ledgerly verifies --entity certificate (resource, methods ⊆ all hops)--> Acme verifies + checks edge live
```

Each hop is a grant at its own grantor, checked live (§6.4). The counterpart learns a pairwise actor identifier unless the edge carries `actor_disclosure:"named"` (spec §6.1).

**A relation never grants:**

- owner-interface authority of any kind, including managing members, grants, integrations or relations (spec §6.2 rule 3);
- membership, or any standing for a counterpart's members inside the organization (§8a.6). A counterpart's member acts only through the counterpart's own entity certificate, bounded by the edge;
- **transitive access.** An edge A→B and an edge B→C give C nothing from A. Being in one instance with someone gives nothing from their other counterparts. Recognition is per edge (spec §9.3), and sibling access exists only where the document has an explicit sibling entry and each sibling consents (§8b.7, "privilege laundering");
- onward sharing (`reshare` refused; the composition rule of spec §9.7);
- access to resources added to the grantor's fragment later, without new consent (spec §9.3);
- any listing of the counterpart's other relations, members, integrations or resources.

**Pre-acceptance** of receipt from future slot holders is the only standing consent, and only for receiving (spec §9.4). Pre-consent to granting stays forbidden.

### 8b.4 Across providers (ORG-11): what Bindle must specify

**Already specified:** the relation document (§9.2), the participation statement (§9.3), the invitation link and redemption (§9.4), entity certificates (§9.5), imported-resource projection (§10), the `entity` bus reader (§11) and provider discovery through `directory.v1` and `relations.v1` (§3a, §14).

**Gaps closed in spec rev 4.5** (rule text in spec §9.3, §9.4, §9.9 and §14):

1. **Relation events had no signer.** Spec §9.6 sends `connection-revoked` to counterparts and §9.4 sends introductions, but integration SETs are signed with the issuer's brokering key set (integrations §6.1), which an organization-only provider need not publish (`brokered-resources.v1`). Rev 4.5 defines a **relation event** (RL-5):
   - It is a SET signed with the sending entity's active certification key, which is already discoverable through `directory.v1`.
   - Its own `typ`, `bindle-relation-event+jwt`, means it can never pass as a certificate or an intent attribution. Its event types are a registry of their own (`relation-edge-state`, `relation-edge-ended`, introduction, recognition, doorbell), so the integrations `connection-revoked` payload is not overloaded.
   - It is addressed to one counterpart and one instance, and carries the sender's `aep`.
   - It is verified **without request-path fetches**, against counterpart keys kept warm by background refresh, as member certificates are (spec §5.2). The refresh schedule does not depend on whether the sender is a counterpart, so timing reveals no participation (RL-R1-H1).
   - Each edge half has a generation; an end is final, and otherwise the highest generation wins, so reordering cannot revive anything.
   - Senders re-send the latest state of every half at least daily (anti-entropy), so a dropped or unverifiable event converges instead of leaving an import `unavailable` for ever.
2. **The events endpoint came from an unauthenticated response.** Redemption returned "its events endpoint", so a malicious counterpart could point another provider's outbound deliveries at an internal or third-party URL. Rev 4.5 takes the endpoint only from the counterpart issuer's validated manifest (`relations.v1` `events_endpoint`), and after a move from the current issuer's manifest through the successor index (RL-6). This also settles the `events_endpoint` part of AMD-O10's TBD for relations, without putting anything in identity documents.
3. **Participation statements never went stale.** A statement confers nothing, but it is shown to admins as evidence ("Acme participates as `buyer`"). Statements had no freshness rule, and a party that had left could still be presented by someone holding its old statement. Rev 4.5 requires a statement to be fresh where it is presented: within 300 s of the invitation's `iat` when carried in an invitation, and within 300 s of verification when returned at redemption or carried in an introduction. A provider never signs a statement for a participation that is not live. Statements therefore need no revocation mechanism (RL-7). This also matches spec §3a.3, under which only an `active` signing key verifies a fresh signature. **Residual:** statements are signed with the identity signing key, which every recovery file contains (R4-H1). A former owner or thief holding a file can sign fresh statements outside the provider. They confer nothing, because redemption and every edge are checked at the parties' own providers, but they can mislead an admin reading an introduction. This goes away with key rotation (deferred, §1c item 1).
4. **The grantee had no way to learn what it was granted.** Entity certificates name the grantor's `resource` (spec §9.5), but no interop message carried the grantor's resource IDs, contracts and methods to the grantee (RL-R1-H2). Rev 4.5's `relation-edge-state` event carries them for every live grant half, after activation, after every change (including rebinding after a move) and in each anti-entropy round.

**Revocation, end to end.**

| What | Mechanism | Bound |
| --- | --- | --- |
| An edge (grantor side) | The grantor ends or suspends it at its own provider. Authority never depends on the event. | Next call at the grantor |
| An edge (grantee side) | The grantee suspends or ends its acceptance half. The grantor learns it from a `relation-edge-state` or `relation-edge-ended` event and treats the edge as not live. | On receipt; the grantee's provider also stops certifying at once |
| An actor inside the grantee | The grantee stops certifying (spec §9.6) | Certificate lifetime + 60 s; writes 60 s (90 s with skew) |
| An entity certificate | The issuer's status endpoint, certification-key revocation (spec §3a.4) | 300 s + 60 s for key revocation |
| A participation statement | Not revocable; stale after 300 s and unsignable once the participation ends | 300 s |
| An unredeemed invitation | Withdrawal, refused exactly as an invalid invitation (spec §9.4, rev 4.5) | Immediate at the inviter |

**Discovery.** `directory.v1` discovers **keys**, never relations. Identity documents still list no affiliations (spec §3a.3), and relation participation stays visible only to counterparts (spec §12 item 9). Endpoints come from the issuer's manifest (`relations.v1`). The bilateral public attestation of R1-M5 stays deferred (RL-9).

**Equivocation.** DEVLOG (2026-10-21, artefact references) asked for a transparency log or gossip before cross-provider relations ship. For relations it is not needed (RL-8). The invitation, both participation statements and every edge carry the relation `{artefact, version, digest}`, and redemption fails unless they match exactly. So two parties in an instance always agree on the exact bytes of the matrix that bounds their edges. A publisher serving different bodies to different parties can only make a join fail (a denial of service against itself), never make two parties disagree about what was consented. Head advancement and the "latest version" of a relation remain artefact-references concerns.

**Gates for ORG-11:** the egress gate of security.md on the production runtime; a non-empty foreign-issuer allowlist (R2-M6); artefact-reference caching of every pinned version a live instance depends on (spec §9.8); conformance against a peer written from the spec alone; and the `ORG_FOREIGN_RELATIONS_ENABLED` kill switch (§8b.10).

### 8b.5 Privacy: who can see that a relation exists

| Who | Sees |
| --- | --- |
| The public, directories, search, identity documents | Nothing. Relation documents are public; instances and parties are not (spec §12 item 9). |
| A counterpart with a live edge | The other party's identity, its slot, the edges between the two of them, and fresh participation statements when presented |
| A party in the same instance with **no** edge to Z | Nothing about Z, unless a counterpart introduces Z (below) |
| A newcomer | Only the edges that exist (spec §9.4). Never who declined or has not decided. |
| The organization's admins | All of its relations, edges, pending invitations, introductions and imports |
| The organization's other members (3sln.me policy) | Only the imported resources they hold grants on, labelled with the grantor's public name and origin (RL-13) |
| The organization's applications | An imported resource's `grantor` and `instance` in the relay projection (spec §10), which reveals the relation to every application the resource is assigned to. The assignment page says so. |
| The grantor, about the grantee's members | Pairwise actor identifiers, or verified principals under `"named"` (spec §6.1, §12 item 4) |
| The home providers of members | Which organization and client a member acts in (spec §12 item 7), never the counterpart |

**Introductions disclose the candidate.** An introduction tells a third party that the proposer is dealing with Z. Bindle cannot prevent a party from telling others about its own business, but 3sln.me sends an introduction only for a candidate that already holds a live edge with the proposing organization in that instance, or that asked to be introduced (RL-12).

### 8b.6 Lifecycle

| Event | Effect on relations (3sln.me, as grantor and as grantee) | Spec basis |
| --- | --- | --- |
| **Edge suspended** by its grantor | Generation raised. The grantee receives `relation-edge-state` with `state:"suspended"`, and imports go `unavailable`. Resuming raises the generation again and sends a live `relation-edge-state` with the entries. | Integrations §3.1; spec §9.9 |
| **Edge ended** or a party **leaves** | Terminal. No grant revives. A later relationship needs a new invitation. | Spec §9.6 |
| **Expiry** (`expires_at` on a grant or participation) | The sweep ends it like a grantor end, then sends the event | Spec §6.1 |
| **Billing lapse: read-only** (§12a) | Outgoing edges keep serving read methods; write-capable methods on the organization's resources are refused, as for members. No widening. Narrowing, leaving and export are never gated. | §12a |
| **Billing lapse: export-only** | Outgoing edges suspended (a suspended `relation-edge-state`), and restored by payment with a new generation. Incoming edges are untouched; they are the counterparts' grants. | §12a |
| **Ownership transfer** (§12b.3a) | No effect. Ownership is a billing role, not an authority reset (spec §3), so counterparts see nothing. The change-of-control checklist lists the organization's relations, so a sale reviews them, as in §5.5 step 3. | §12b.3a |
| **Organization recovery** taking effect, or **break-glass** taking effect (§12d) | The organization's `aep` rises once, at effect only (spec §3, R4-M2). Counterparts see the higher `aep` on the next certificate or event and apply their own policy. On 3sln.me as counterpart, RL-4 applies. | Spec §3, §9.5 |
| **Organization deletion scheduled** (30-day delay) | No effect on relations, and nothing is sent to counterparts, because scheduling is cancellable and a notice would leak the decision. Admins see every relation in the deletion review. | ORG-1 |
| **Organization deletion takes effect** | A **pre-purge step** leaves every instance while the identity is still served: `relation-edge-ended` for each half, and certification for new requests stops. The purge waits until those events are acknowledged or 72 h pass, keeping the certification keys published until then (spec §9.9), and only then serves the identity as deleted. Counterparts that miss the events find the organization unreachable (row below); its grants are gone with its resources, and its certificates no longer verify. | Spec §9.6, §9.9 |
| **A counterpart disappears** (uniform 404, unreachable) | Not treated as revocation, because suspension and deletion are indistinguishable (spec §3a.3). Its certificates already fail verification. Outgoing edges stay until their expiry or an admin ends them; after 30 days unreachable, the console flags them. | Spec §3a.3 |
| **The organization moves** to another provider | See below | Portability §11 |
| **A counterpart moves** | Edges are keyed by origin principal, so they survive. Certificates and events from the destination verify through the successor index. Anything from the earlier host fails. Events go to the destination issuer's `events_endpoint` (RL-6). Under RL-4, an attested move holds only write-capable methods on outgoing edges, for 72 h with notice or until an admin confirms; an unattested, hand-adopted or contested move holds the edges entirely. The destination re-sends the state of every half (anti-entropy). | Spec §3 (origin principal), §9.9 |
| **Counterpart authority reset** (an `aep` increase, a key reset without continuity, a move adoption, a contested identity) | RL-4: 3sln.me holds its outgoing edges to that counterpart, refusing its certificates with the uniform error, and marks imports from it. Only an admin's confirmation releases a full hold; a relation event never does. An attested move gets the lighter write-only hold. | Spec §9.5 (provider policy) |
| **The organization's identity key compromised** | Rotate and revoke (§5.10). Raise the generation on every outgoing edge. Participation statements are re-signed fresh at their next presentation. | §5.10 |

**The organization's own move.** Portability §11 says a move does not move grants or resource identifiers, and that counterparts re-consent to any resource whose identifier changed. For relations (RL-10):

- **Participations travel** in the organization's export (spec §13), keyed by instance and counterpart origin principal.
- **Incoming edges** (counterparts' grants to the moving organization) live at the counterparts. They survive unchanged, and the counterparts map the destination's certificates through the successor index.
- **Outgoing edges arrive suspended** at the destination, because their resource identifiers changed. An admin re-binds the values per entry at the destination: a new consent by the grantor, which is its right. Each counterpart then receives a live `relation-edge-state` with a new generation and the new resource IDs (spec §9.9). Its imports are keyed by (grantor origin principal, instance, entry) (spec §10), so they update in place, and its members' grants on them survive. The grantee is told that the grantor moved and rebound the entry. Re-acceptance is needed only if the rebinding comes with a widening upgrade.
- **Stale relation after a move**: §8b.7.

### 8b.7 Abuse cases

| Abuse | Attack | Mitigation | Residual |
| --- | --- | --- | --- |
| **Relation-request spam flood** | An organization floods another with invitations, or a counterpart floods introductions, to bury a legitimate request or to exhaust admins | Invitations need acceptance, and ignoring costs nothing. 3sln.me limits (RL-11): an organization issues at most 300 relation invitations a day; at most 3 per (inviter, invitee) in 30 days; at most **one** pending per (inviter, invitee), so no single inviter can crowd out others; at most 256 pending inbound items per organization. When that is full, new items are refused and the admins are told. Filling it takes 256 distinct paid organizations, and muting them frees the space. Introductions: at most 10 a day per (proposer, receiver), deduplicated per (instance, candidate, slot), expiring after 30 days (§8a.9). An admin can **mute** an organization: its invitations and introductions are declined silently, and the sender cannot tell. Organizations are paid (§12a), so farms cost money. | A determined paid spammer still costs each target one mute |
| **Event or redemption flood** | A non-counterpart posts forged relation events or redemptions to force directory fetches | Spec §9.9 step 2 and §9.4: no fetch unless the sender is a counterpart in that instance, or the redemption presents a valid, live invitation that this provider issued. The answer is uniform. Per-issuer and global fetch budgets (spec §3a.5). The foreign kill switch. | — |
| **Impersonation of an organization** | A lookalike handle ("acme-ltd" for "acme") invites a firm, or asks to be introduced | The acceptance page shows the identity URI, handle and verified origin, and warns about a counterparty never seen before. Everything is keyed by `(iss, sub)`, never by name (R1-M6). Verified-domain badges are later (§11). | An admin who ignores the warning |
| **Lookalike or widened relation document** | A clone with a wider matrix, or a publisher's domain taken over and widened | The full matrix as it applies to the invitee, the "new relation `id`" and "same title, different `id`" warnings (R3-M6), and re-consent on every widening upgrade | Click-through on widening upgrades |
| **Stale relation after an organization move** | (a) The earlier host keeps signing for the moved organization; (b) someone replays its old participation statements; (c) events keep going to the old endpoint; (d) an unattested "move" is used to take over a counterpart's edges | (a) An artifact whose `iss` is an earlier host fails (spec §3, origin principal), and the source's certification keys are revoked at commit (portability §6.3). (b) Statements are fresh-only (spec §9.3, rev 4.5). (c) The endpoint is taken from the current issuer's manifest only (spec §9.9). (d) Under RL-4 every move adoption is held: an attested one for write-capable methods for 72 h or until an admin confirms (a stolen current file plus the 7-day public wait can produce an attested move, portability §6.1), and an unattested or contested one entirely, until an admin confirms. (e) The destination re-sends edge state, so counterparts converge on the new resource IDs. | A counterpart that runs no successor index keeps failing safe: it refuses the moved organization's certificates |
| **Privilege laundering through chains** | B holds A's ledger through an A–B edge and has a B–C edge. B puts A's import into the storage fragment it shares with C, or issues certificates for C's actors, or relies on a document like `group` to imply sibling access. | No transitivity: authority is only a direct live edge in the certificate's `instance` (spec §9.5). Imports are omitted from every fragment projected or granted over an edge (spec §9.7). A provider certifies only its own entity's actors, and a host refuses a certificate whose `iss` is not the grantee of a live edge. Sibling access exists only through an explicit sibling entry plus each sibling's consent. Admission into one edge never implies another (spec §9.4). | B **proxying** C's requests under its own identity is undetectable by A, is a violation of spec §6.2 rule 2, and is disclosed on the acceptance page (spec §9.7). Copies B already read cannot be recalled. |
| **Insider exfiltration through an outward edge** | A rogue admin creates a `share` edge to an outside organization | Widening needs a fresh step-up, every admin gets an immediate notice, and any admin can end the edge at once (§8b.2). The audit records it, hash-chained. | Data read before another admin ends the edge |
| **Liability dumping or pipeline injection** | An organization pushes unwanted data, such as fake invoices, by inviting a target that only receives, or exploiting pre-acceptance | Acceptance is required. Pre-accepted counterparts are shown to operators and their imports are marked and may be held (spec §9.4, R3-M2). | Pre-acceptance is a deliberate, disclosed risk |
| **Counterpart takeover** | An attacker takes over a counterpart organization through recovery, break-glass, a key reset or a move made with a stolen current recovery file, then uses its edges | RL-4: hold on the `aep` increase, key reset or move adoption. Recovery and break-glass raise `aep` only at effect, so a cancelled attempt cannot churn holds (R4-M2). | A takeover that does not reset authority (stolen admin session at the counterpart) is the counterpart's own breach, bounded by the edge |
| **Arity squatting** | An attacker tries to fill a `max:1` slot to block the real holder | Arity is per view, and each party recognizes only holders it consents to (spec §9.3). An attacker cannot fill another party's view. | — |
| **Import fan-in exhaustion** | A counterpart creates many instances to fill a target's imports | Each edge needs the target's acceptance. 3sln.me caps an organization at 256 live instances and 1,024 live incoming edges until measured (RL-11), and lists imports by relation and slot (§8.5 gap 5). | — |

### 8b.8 Alternatives considered

| Alternative | Why not |
| --- | --- |
| **Relation kinds as a fixed enum** (parent, partner, vendor) with built-in access | Authority by label, rejected since revision 1 (§7.2). The user's documents already cover every kind. |
| **Transitive or inherited access** (a parent reaches its subsidiaries' counterparts; a group reaches every member's resources) | Privilege laundering by design, and incompatible with per-edge consent (the user's decision, §8a.9). Explicit sibling entries cover the real need. |
| **Governance through a relation** (a parent administers subsidiaries) | Governance is non-delegable (§6.4 rule 4). Direct admin memberships serve the case (§5.5). Still deferred, not rejected, as "governance via relationship" (§5.6). |
| **Owner approval for every outward edge** | No subject or control change is involved, and approving an integration is already an admin action with the same exposure. Owner approval would stall every relation while the owner is away, and any admin can still end an edge at once (§8b.2). Kept as a possible per-organization setting later, if asked. |
| **A notified delay before an outward edge goes live** | Data flows are reversible at once, and a delay only postpones the legitimate case. Notices and the ability of any admin to end the edge give the same oversight. |
| **Relation events signed with the issuer's brokering key set** (as integrations do) | Organization-only providers need not publish one, and a provider-level signature does not bind the event to the sending entity. The certification key is already in the entity's identity document. |
| **Per-party events endpoint in the redemption response or the identity document** | The first is SSRF-prone (§8b.4 gap 2). The second puts protocol metadata about relations into identity documents, which list no affiliations. |
| **Revocable participation statements** (status list or revocation SET) | Statements confer nothing. Freshness gives the same result with no new state. |
| **A public bilateral attestation now** (R1-M5) | Useful against lookalikes, but it publishes business relationships. Deferred until a customer asks for it (RL-9). |
| **A central instance roster at the creator's provider** | Rejected in §4. It recreates a central authority that per-edge consent makes unnecessary. |
| **A transparency log for relation documents before ORG-11** | Per-instance digest agreement already prevents parties from disagreeing (§8b.4). |
| **No hold at all on an attested move** (the first draft of RL-4) | Rejected in review RL-R1-H3. Portability §6.1 allows an attested move with the current recovery file plus a 7-day public wait and no fresh session, so a thief holding the file could move a counterpart and use its edges at once. |
| **A full hold on an attested move** | It stalls ordinary moves on every counterpart until an admin acts. A write-only hold for 72 h covers the theft case at lower cost (RL-4). |

### 8b.9 Provisional decisions

Each is **Provisional (coordinator), not signed off by the user.** Implementation may proceed on them behind default-off flags; they stay revisable. Reviewer ___ / date ___ / outcome ___ (for each row).

| ID | Decision | Recommendation and reason |
| --- | --- | --- |
| RL-1 | **Phasing.** Implementation starts now behind default-off flags. The §13.3 release gates stay: ORG-10 before the first external organization (phase C), ORG-11 after the egress gate, artefact-reference caching and clean-room conformance (phase D). | Recommended. It lets the user's own companies use `group` and `supply` on one host first, without loosening any cross-provider gate. |
| RL-2 | **Who establishes relations.** Any unheld admin, with a fresh step-up, a full matrix disclosure, notice to every admin and an audit entry. No subject-first step, owner elevation or delay. | Recommended. A relation changes no member's GM grant and no control (§8b.2). It is the same act as approving an integration. |
| RL-3 | **Narrowing is immediate** by any admin and needs no consent: suspend, end, decline, leave, withdraw. | Recommended. Narrowing is always safe, and it is the remedy against a rogue admin's edge. |
| RL-4 | **Counterpart authority reset (3sln.me policy; resolves R3-M7 for 3sln.me as grantor).** Triggers: a counterpart's `aep` increase, a key reset without continuity, an unattested or hand-adopted move, or a contested identity (equivocation, portability §8). Effect: hold outgoing edges to it, so its certificates get the uniform refusal, until an admin confirms. The confirmation is bound to that `aep`. Imports from it are marked. Triggers also include an automatically adopted, attested move (portability §8.3), but that gets a **lighter hold**: only write-capable methods are refused, for 72 h with notice to the admins or until an admin confirms. Revised after review RL-R1-H3, because an attested move can be made with a stolen current recovery file and a 7-day public wait (portability §6.1). No relation event releases any hold. | Recommended (R3-M7 position B). Relations are low-churn, so confirming is cheap, and the write-only hold spares ordinary moves from a full stall. The spec keeps this as provider policy (spec §9.5). |
| RL-5 | **Relation events are signed with the sending entity's certification key**, `typ` `bindle-relation-event+jwt`, with their own type registry, generation ordering, cache-only verification and daily anti-entropy (spec §9.9). | Recommended. The key is already discoverable, and the `typ` separates it from certificates and intents. It departs from RFC 8417's recommended `typ`, which is allowed, and keeps the RFC 8935 media type. |
| RL-6 | **The events endpoint is issuer-level**, from `relations.v1` `events_endpoint` in the validated manifest, never from a response or an identity document. | Recommended. It closes an SSRF path and settles that part of AMD-O10. |
| RL-7 | **Participation statements are fresh-only** (300 s), not revocable. | Recommended. No new state, and a provider cannot be made to present a stale statement. The residual is that a recovery-file holder can sign fresh statements outside the provider (§8b.4). They confer nothing, and the residual ends with key rotation. Moving statements to the certification key is the alternative if the user prefers to close it now. |
| RL-8 | **No transparency log is required for ORG-11.** | Recommended, for the reason in §8b.4. Revisit if relations gain head-advancing automation. |
| RL-9 | **The public bilateral attestation stays deferred.** No relation is published anywhere. | Recommended. Privacy first; revisit on demand. |
| RL-10 | **Organization moves:** outgoing edges arrive suspended and an admin re-binds them; incoming edges survive; imports update in place, keyed by origin principal, instance and entry. | Recommended. It follows portability §11 (re-consent when identifiers change) with the least churn for counterparts. |
| RL-11 | **Limits** (3sln.me): 300 invitations a day per organization; 3 per (inviter, invitee) per 30 days; one pending per pair; 256 pending inbound items per organization, after which new items are refused and admins are told; 10 introductions a day per (proposer, receiver); muting; 256 live instances and 1,024 live incoming edges per organization until measured. | Recommended as starting values. A group of 64 subsidiaries or a buyer with 256 suppliers fits in one day; filling a target's inbox needs 256 paid organizations. |
| RL-12 | **Introductions** only for a candidate with a live edge to the proposer in that instance, or one that asked. | Recommended, to avoid disclosing a candidate's dealings without cause. |
| RL-13 | **Member visibility** (3sln.me): admins see all relations; other members see only the imports they hold grants on. | Recommended. Relations are governance-level information. |
| RL-14 | **First catalogue:** `share`, `group`, `supply` and `accounting-engagement`, published under a reserved `.example` placeholder until publication authority is agreed. The catalogue shows "listed by 3sln.me", never "verified publisher". | Recommended. It follows AGENTS.md on `.example` domains and keeps "publisher unverified" truthful. |
| RL-15 | **One code path.** Same-host redemption and events go through the same statement and event ports as cross-provider ones; only the transport differs. | Recommended. ORG-11 then adds transport, not semantics, and ORG-10 tests exercise the interop rules. |
| RL-16 | **Entity-certificate lifetime on 3sln.me: 300 s** (members stay at 660 s). | Recommended, as §15 Q10 suggested: entity certificates are cheap to re-issue in proxy and token forms, and a shorter lifetime bounds grantee-side revocation that the grantor cannot see. |
| RL-17 | **Persons as relation parties.** The spec keeps `person` in `kinds` (sole traders). 3sln.me v1 lets only organizations create, join or be invited into relations. | Recommended, because it follows the user's "relations are relationships between orgs" without narrowing the spec for other providers. Revisit if sole traders ask for it. |

### 8b.10 Implementation plan

Engine-first (§13): every operation is an ngin Action or Query in a domain module, dispatched in the organization's account single writer. HTTP routes and the console are thin adapters. Tests are mainly engine-level, with seeded chaos.

**Flags** (rows for `packages/flags/registry.mjs`, default off, added by the flags owner):

| Flag | Class | Requires | Gates | Never gated |
| --- | --- | --- | --- | --- |
| `ORG_RELATIONS_ENABLED` | a, G A, crit, stateful | `ORGANIZATIONS_ENABLED`, `DIRECTORY_ENABLED` | Creating instances, inviting, accepting, widening, introductions, certificate issuance for new edges | Narrowing, leaving, ending, withdrawing, muting, inbound revocation events, export. Turning it off leaves existing edges readable and endable, but stops new ones. |
| `ORG_FOREIGN_RELATIONS_ENABLED` | a, G A, crit, stateful (new) | `ORG_RELATIONS_ENABLED`, plus the foreign-issuer allowlist (R2-M6) | Every outbound fetch or POST to another provider for relations (directory, manifest, document fetch, redemption, event delivery) and accepting foreign redemptions and certificates. The kill switch for that egress surface. | Local narrowing. Outbound events are queued while it is off. Those that pass the 72 h retry window are recovered by anti-entropy re-sends (spec §9.9), and authority never depends on them. |

**Slices** (non-overlapping write ownership; interfaces agreed first, below):

| Slice | Scope | Files (new unless marked) | Depends on |
| --- | --- | --- | --- |
| ORG-10a [S] | **Relation documents.** The `relation` artefact kind: validator (bounds, `crit`, exact methods, `reshare:true` refused, bus `entity` reader check), the growth table and the upgrade delta, the "matrix as it applies to slot X" projection, digest pinning and the cache port. **Status (2026-10-24): implemented locally; unreviewed, not production-verified.** No `artefact-store.mjs` hunk: until the growth table is signed, spec §9.2 says validators process `relation` as an unknown kind, so the table lives in `relation-documents.mjs` (`relationAdditive`) and registration later is one row. | `packages/orgs/relation-documents.mjs`; `packages/federation/artefact-store.mjs` hunk (kind registration only) | ART store |
| ORG-10b [S] | **Instances, invitations and redemption.** Participation records, relation invitations (link type), the acceptance commit (pending), redemption and activation, withdrawal, per-view arity, participation statements (sign fresh, verify, freshness), the flood limits and mute. **Status (2026-10-24): implemented locally behind `ORG_RELATIONS_ENABLED`; unreviewed, not production-verified.** No `packages/links` hunk: like the organization invitation type, the relation invitation is a provider link type with no app slot binding. Engine operations are defined in the relation modules (as `certificates.mjs` does); ORG-10f moves or re-exports them. | `packages/orgs/relation-instances.mjs`, `packages/orgs/relation-invitations.mjs`, `packages/orgs/relation-statements.mjs`; `packages/links` type-registration hunk | 10a, ORG-7 |
| ORG-10c [S] | **Edges and imports.** Edges as entity connections carrying fragment grants (generation, suspend, resume, end, expiry); imported resources keyed by (grantor origin principal, instance, entry); the composition rule (imports never projected over an edge); the preferences projection hook (relay form); imports listing. **Status (2026-10-24): implemented locally behind `ORG_RELATIONS_ENABLED`; unreviewed, not production-verified.** The `packages/federation/service.mjs` relay-projection hunk waits for ORG-10d, because the relay descriptor's token is an entity certificate; `relayDescriptor` builds the rest. Edge-state events are built unsigned and applied with spec §9.9 steps 2 and 4–6; signing and steps 1 and 3 are ORG-10e. | `packages/orgs/relation-edges.mjs`, `packages/orgs/relation-imports.mjs`; one projection hunk in `packages/federation/service.mjs` (serialized after the current editors) | 10b, ORG-3 |
| ORG-10d [S] | **Entity certificates.** Issuance by the acting organization after its own hop evaluation (`resource`, `methods` ⊆ all hops, `aep`, actor with pairwise or named disclosure, 300 s, status); verification at the grantor (edge live in `instance`, origin principal, uniform failure, no-oracle, write age rule); journal key; brokered tokens for integration-hosted resources. **Status (2026-10-24): implemented locally behind `ORG_RELATIONS_ENABLED`; unreviewed by the user, not production-verified.** Codec in `entity-certificates.mjs`; `relations.certify` and `relations.authorize` in `relation-access.mjs`. Imports are mirrored as `federation/resource/imp_…` (provider `relation`), so connections hold them; the `service.mjs` hunk is the preferences/v2 relay projection (the RPC-authorization hunk is ORG-10f's adapter over `relations.authorize`). Resource scope is enforced. Not in this pass: the issuer status endpoint (the write age rule applies alone) and brokered tokens for integration-hosted grantor resources. | `packages/identity/entity-certificates.mjs` (new, IDKEYS stream owner; parallel to `member-certificates.mjs`), `packages/orgs/relation-access.mjs`; one RPC-authorization hunk in `packages/federation/service.mjs` | 10c, ORG-4 |
| ORG-10e [S] | **Relation events and lifecycle.** Signing and verifying relation events (spec §9.9: cache-only verification, generation ordering, `jti` recorded after verification, uniform `202`), `relation-edge-state` carrying entries, daily anti-entropy re-sends, the durable outbox, ingest, introductions and recognition notices, the RL-4 hold, lifecycle hooks (billing stages, deletion effect, key compromise), the expiry and introduction sweep. Bus doorbells to entity grantees. **Status (2026-10-24): implemented locally; unreviewed by the user, not production-verified.** `relation-events.mjs` (codec, ingest, drain, resync, introductions, the RL-6 `manifestEventDelivery` port), `relation-lifecycle.mjs` (RL-4 holds, `observe-counterpart`, `confirm-counterpart`, billing, deletion pre-purge and `purge-ready`, key compromise, own move and `rebind`, unreachable flag, `relations.tick`), and the `key-refresh.mjs` hunk. Doorbells are accepted and not yet forwarded (ORG-10f); the `packages/events` `entity` reader hunk is not in this pass. | `packages/orgs/relation-events.mjs`, `packages/orgs/relation-lifecycle.mjs`; `packages/events` hunk for the `entity` reader; `packages/orgs/key-refresh.mjs` hunk adding counterparts to the background-refresh set (owner of that file) | 10b–10d |
| ORG-10f [S] | **Engine domain, account slice and routes. Status (2026-10-26): implemented locally, flags off; provisional, unsigned, not production-verified.** | `packages/app/domains/relations.mjs`, `packages/runtime/account/relations.mjs`, `packages/runtime/routes/relations.mjs` (join endpoint, events endpoint, accept landing), `relations.v1` manifest members hunk | 10a–10e |
| ORG-10g [A] | **Console. Status (2026-10-26): implemented locally; en/es, Chromium/Firefox, 390/1280 light/dark; provisional, unsigned, not production-verified.** Surfaces listed below. | `apps/web/src/bl/org-relations*.mjs`, `apps/web/src/ui/org-relations*.mjs`, messages hunk | 10f |
| ORG-11a [S] | **Cross-provider transport.** Foreign redemption and acceptance, event delivery to `events_endpoint` from the manifest, SSRF-safe fetches under budgets (reusing `packages/identity/directory.mjs`), the foreign kill switch. | `packages/orgs/relation-transport.mjs`; `packages/orgs/federation.mjs` hunk (directory and successor-index wiring for counterparts); adapter wiring in `apps/worker/objects.mjs` and `apps/node/resources.mjs` (integrator) | 10f, ORG-7, egress gate |
| ORG-11b [S] | **Moves and resets.** Export and import of participations, rebinding outgoing edges after the organization's own move, destination re-sends of every half's state, successor-index mapping for counterparts' moves, the RL-4 triggers (including the write-only hold on an attested move) from directory refresh, and the deletion pre-purge leave step. | `packages/orgs/relation-moves.mjs`; a hunk in `packages/orgs/export.mjs` (new, owned by the ORG-12 export slice, which does not exist yet) | 11a, PORT |
| ORG-11c [S] | **Clean-room conformance peer.** A second relations implementation written from spec §9 alone, run as a separate Node instance, plus the conformance suite. Evidence of interoperability only when written without the 3sln.me code (R2-M6). | `tests/conformance/relations-peer/*` | 11a |

**Engine operations** (`packages/app/domains/relations.mjs`; organization placement and `admin` unless marked):

- *Queries:* `relations.catalogue` (person or organization); `relations.preview` `{artefact, version, digest, slot}` → the validated matrix as it applies to the slot; `relations.list`; `relations.get` `{instance}` → own view, edges both ways, pins, holds; `relations.inbound` (pending invitations and introductions); `relations.imports` `{instance?, slot?}` (also for members, filtered to their grants, RL-13); `relations.audit` `{instance?}`.
- *Widening actions (step-up):* `relations.create` `{relation pin, slots}`; `relations.invite` `{instance, slot, invitee, values, expires_at?}`; `relations.accept` `{invitation, values, receive, preaccept?}`; `relations.admit` `{introduction, values}` (issues the newcomer an invitation); `relations.upgrade` `{instance, counterpart, version: pin, values?, receive?}` (provisional replacement-invitation semantics above); `relations.confirm-counterpart` `{counterpart, aep}` (releases an RL-4 hold).
- *Narrowing actions (never flag-gated):* `relations.withdraw` `{invitation}`; `relations.decline` `{item}`; `relations.suspend`, `relations.resume`, `relations.end` `{instance, counterpart, direction}`; `relations.narrow` `{instance, counterpart, entries}`; `relations.leave` `{instance}`; `relations.mute` `{organization}`.
- *Proposals:* `relations.introduce` `{instance, slot, candidate}`.
- *System (never wire-dispatchable; adapters build a system actor from verified evidence):* `relations.redeem` (join endpoint), `relations.ingest` (events endpoint), `relations.certify` (acting side, from the member-context or proxy path), `relations.authorize` (grantor side, from the RPC hook), `relations.outbox-drain`, `relations.sweep`, `relations.observe-counterpart` (`aep`, key reset, move adoption), `relations.lifecycle` (billing stage, deletion effect, key compromise), `relations.export` and `relations.import` (moves).

**Interfaces agreed first** (ports; each slice codes against these): `RelationDocuments.resolve(pin)`; `Statements.sign(participation)` and `Statements.verify(jws, context)`; `RelationEvents.sign(event)`, `RelationEvents.deliver(counterpart, jws)` and `RelationEvents.verify(jws)`; `EntityCertificates.issue(evaluation)` and `.verify(jws, request)`; `Counterparts.resolve(originPrincipal)` (identity URI, active keys, `aep`, current issuer, events endpoint); `Imports.project(fragment, context)`. Same-host and foreign implementations differ only behind `deliver` and `resolve` (RL-15).

**Test plan.**

- **Engine-level tests per slice**, with injected clock, fake directory, fake transport and capturing outbox: every conformance item of spec §16 "Relations", plus the rev 4.5 additions.
- **Seeded chaos** (`tests/orgs-relations-chaos.test.mjs`): random instances of 2–12 parties across two simulated providers, interleaving invitations, acceptances, redemptions (doubled and raced), withdrawals, introductions, upgrades, narrowing, leaving, expiry, key rotation, `aep` increases, moves, flag flips, billing stages, and event drop, duplication, reordering and delay, with clock jumps. Invariants, checked after every step:
  - **C1** No edge is live without both a grantor consent record and a grantee acceptance record.
  - **C2** Every honoured certificate's `resource` and `methods` lie within the live edge grant in its own `instance` and within the issuer's hop evaluation: effective ⊆ every ceiling.
  - **C3 No transitivity.** C can reach A's resource only through a live direct edge A→C in a common instance, whatever other edges exist.
  - **C4** No imported resource appears in any projection or grant over an edge.
  - **C5** No party recognizes more holders of a slot than `max`.
  - **C6** After a narrowing commit, the next call is refused, whatever happens to event delivery. Under any reordering, duplication or loss of events, an ended half never revives, the highest generation wins, and anti-entropy converges every receiver's view of each half to its holder's state.
  - **C7** Non-counterpart events, redemptions and certificates cause no request-path fetch and identical responses. The background-refresh schedule is the same whether or not the sender is a counterpart.
  - **C8** While an RL-4 hold is active, nothing from that counterpart is honoured; a confirmation for one `aep` does not cover a later reset.
  - **C9** An introduction never creates an edge, and the candidate's view never contains an undecided or declining party.
  - **C10** Statements older than 300 s at presentation, or for a participation that ended, never verify.
- **Adversarial named cases:** forged statement; stale statement replayed after leaving; invitation forwarded to another organization; redemption by a non-invitee; redemption racing withdrawal; lookalike document with the same title; a widening version from a taken-over publisher; re-sharing by composition; a third entity's certificate; proxy forwarding (documented as undetectable); an event from a non-counterpart; an event signed by an earlier host after a move; a redemption response naming an internal events URL (refused; delivery only to the manifest endpoint); an invitation and introduction flood (the legitimate invitation is still deliverable); a held admin trying to accept; a counterpart key rollback; `aep` churn from a cancelled recovery (no hold); deletion effect leaving every instance before the identity is served as deleted; the foreign kill switch stopping all egress while local narrowing still works; a re-signed retry after a lost acknowledgement (`202`, not reprocessed); a forger pre-poisoning a `jti` (impossible, because it is recorded after verification); a resume reordered after an end; a relation event trying to release an RL-4 hold; a takeover by an attested move made with a stolen file (writes held); an invitation whose statement fails after a key rotation (the console says to ask for a new invitation); a grantee's ended acceptance half making the grantor refuse its certificates.
- **Browser tests** for the console surfaces, in Chromium and Firefox, English and Spanish, light and dark, at 390 and 1280 px.
- **Cross-provider:** two Node instances on loopback, then the clean-room peer (ORG-11c). Evidence of interoperability only from the clean-room peer.

**Console surfaces** (one question per step, as elsewhere):

- **Relationships tab** in the organization console: each instance with the relation title, the organization's slot, counterparts in its own view, edge states both ways, holds and expiries.
- **"Share with an organization" wizard:** relation (catalogue or URL) → slot → counterparty by handle, with the resolved identity shown → values per entry, with scoping and expiry → review of the full matrix, what is given and what is received → step-up.
- **Acceptance page** (the top-level POST landing): every spec §9.4 disclosure, the new-counterparty and new-relation warnings, inline configuration of unconfigured fragments, and the step-up.
- **Activity items** for admins: inbound invitations (including replacement invitations for newer additive pins), introductions (30-day expiry), RL-4 holds and unreachable counterparts. No same-instance upgrade queue or newer catalogue version is claimed.
- **Edge detail:** what we give and what we receive, the actor-disclosure setting, Suspend, End and Leave, and the audit.
- **Imports view:** grantor name with origin, pre-accepted and held marks, and assignment to the organization's own fragments, with the note that applications learn the relation (§8b.5).
- **Member view:** imported resources the member holds grants on.
- **Change-of-control and deletion checklists** list the organization's relations.

**Production gates** (in addition to §13): the hash-chained organization audit; an independent security review of spec §9 and these slices; organization terms and the DPA, including controller-to-controller disclosure between related organizations (§12, ORG-13); and production verification of the actual adapters and key custody. For ORG-11, also the production egress gate, nonempty foreign allowlist, pinned artefact-reference caching and clean-room peer conformance. Real external event delivery is never inferred from local tests. The ORG-10e RL-4/C8 implementation and its attested-move trade-off still await review/sign-off. The adapter requirements added by the ORG-10a–e reviews (sender evidence, import preservation, alarm/key refresh, composed storage scope, relay holder public keys, pre-purge key publication and the uniform authorization failure) are implemented locally in ORG-10f/g as itemized below; they remain production-verification and sign-off gates.

**ORG-10f/g local adapter gate closure (2026-10-26; provisional, unsigned):**

1. **Sender evidence closed locally:** events derive the sender solely from the verified certification signature; offers/retractions/redemptions carry the server router binding. Owner inputs reject body-supplied `from`; HTTP join refuses it. Foreign redemption remains unavailable without ORG-11 transport.
2. **Import preservation closed locally:** the real federation resource provider includes account import descriptors; its existing sync preserves `provider:'relation'` mirrors even when absent from a provider response.
3. **Alarm and scope closed locally:** account alarms run `relations.tick`, counterpart certification-key refresh and authority-epoch observations. Cold/new-key events use a bounded untrusted retry inbox; every retry goes through signature verification. Failed refresh claims defer without starving the next queue page. Real RPC dispatch passes the authorizing entry's composed scope to storage, including full-object limits on ranged reads.
4. **Relay holder key closed locally:** verified DPoP evidence stores only the public P-256 JWK; DPoP session/member access projections can issue relay certificates. Bearer-only sessions without a certified holder key still report imports unavailable.
5. **Publication gate closed locally:** configured organization purge is deferred until `relations.purge-ready`; identity/certification keys remain published during that wait. Production purge integration remains unverified.
6. **Authorization adapters closed locally:** direct entity RPC, bound token RPC and token exchange call `relations.authorize`; its one credential failure passes unchanged. Inbound signed revocation, local narrowing/leaving and admin export remain available with both relation flags off; widening still needs the flag, fresh step-up and unheld admin authority.

These closures describe implemented local contracts and tests. They do **not** sign off the RL-4 trade-off, replace the independent security review, verify external delivery/key custody, approve legal terms/DPA, or authorize production release. Doorbell forwarding and entity bus-reader integration remain separately gated work; participation restoration and foreign interoperability remain ORG-11.

### 8b.11 Review round RL-R1

A forked adversarial review of revision 5.6 and spec rev 4.5, 2026-10-24. Reviewer sign-off on this round: reviewer ___ / date ___ / outcome ___. "Resolved" means the text now says it; nobody has signed it.

| Finding | Resolution |
| --- | --- |
| **H1.** Event verification fetched on the request path, so latency revealed participation. Instance URIs are not secret, because applications see them. | Resolved. Spec §9.9 step 3 is cache-only, with counterparts in the background-refresh set and a refresh schedule independent of participation. The "relies on unguessable instance IDs" sentence was removed. |
| **H2.** No message told the grantee the grantor's resource IDs, so ORG-11 and move rebinding could not work. | Resolved. The `relation-edge-state` event carries entries with resource IDs, contracts and methods (spec §9.9, §8b.4 gap 4). |
| **H3.** RL-4's attested-move exception let a thief with a stolen current recovery file move a counterpart and use its edges. | Resolved. An attested move gets a write-only hold for 72 h or until an admin confirms (RL-4). |
| **M1.** Freshness does not bind a recovery-file holder, who can sign statements. | Stated as a residual (spec §9.3, §8b.4, RL-7). The alternative, moving statements to the certification key, is offered in RL-7. |
| **M2.** A retry was answered `400`, and a `jti` could be poisoned before verification. | Resolved. A duplicate gets `202` and is not reprocessed, and a `jti` is recorded only after verification. |
| **M3.** Lost events never reconciled. | Resolved. Daily anti-entropy re-sends (spec §9.9). |
| **M4.** Generation ordering was underspecified, and events could release holds. | Resolved. An end is final and the highest generation wins per half; events never release a hold. |
| **M5.** The integrations event identifier was reused with a different payload. | Resolved. A separate registry: `relation-edge-state`, `relation-edge-ended` and `relation-bus-advanced`. |
| **M6.** Deletion and moves broke signed retries. | Resolved. A pre-purge leave step keeps certification keys published for up to 72 h, and the destination re-sends state after a move. |
| **M7.** "Between organizations only" contradicted spec `kinds`. | Resolved by RL-17: the spec is unchanged, and 3sln.me v1 offers relations between organizations only. |
| **M8.** The limits contradicted their own justification. | Resolved. 300 invitations a day, and a full inbox refuses new items and notifies admins (RL-11). |
| **L1.** Shedding by the claimed issuer let a forger get a victim's events shed. | Resolved. Shedding is by source network before verification, and by budget per verified sender after it. |
| **L2.** The flag coupling was needless, and queued events could expire. | Resolved. The foreign flag depends on `ORG_RELATIONS_ENABLED` plus the allowlist, and anti-entropy covers expired events. |
| **L3.** The file plan missed existing files and gave the wrong owners. | Resolved (§8b.10). |
| **L4.** An invitation dies on key rotation. | Accepted; tested, and the console tells the invitee to ask for a new invitation. |
| **L5.** The §5.4 wargame disagreed with redemption ordering. | Resolved. |
| **L6.** A test for an ended acceptance half was missing. | Added (spec §16). |

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
| **Relation-invitation spam or liability dumping** | Acceptance is required, invitations are rate-limited per inviter, and ignoring costs nothing. Rev 5.6: per-pair and per-organization limits with fair eviction, and muting (§8b.7, RL-11). | — |
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

## 12b. 3sln.me grant-management policy (app feature, not spec)

This is a user decision of 2026-10-21. It is 3sln.me policy only: the spec requires each organization provider to define and disclose its own policy (spec §6.3).

The user's words: "for entities, when it comes to removing or changing grants that allow removing or changing those same grants (as in, changes to admin grants, by another admin) the user who's grants are being changed must consent, or there needs to be an elevation to the org owner (the one who pays the bills)".

### 12b.1 Definitions

- **Grant-management grant (GM grant).** A grant that lets its holder create, change or revoke grants: other members' grants, its own, and other GM grants. In v1 the only GM grant is the `admin` power. Future granular powers such as "manage members" or "manage grants" are GM grants too.
- **Organization owner.** The **owner of record** is exactly one 3sln.me account, determined from billing state:
  1. While billing is enabled and the organization has a subscription that is active, in its grace period or past due, the owner is the 3sln.me account that **created that subscription's checkout**. That is the account recorded on the organization's billing record at checkout, not the Polar customer email or the card.
  2. Changing the payment method within Polar never changes the owner, even when someone else's card is entered.
  3. A different account can become owner only through a **transfer** (§12b.3a), the **lapse rule** (§12b.3), **organization recovery** taking effect (§5.11), or, rev 5.5 (provisional), a **break-glass claim** taking effect or a **reinstatement** after a contest (§12d).
  4. Before billing is enabled (phase A, internal allowlist), the owner is the account designated when the organization was created: its creator.
  5. The owner must be a member. Ownership by itself gives no GM grant. It gives only elevation approvals, transfer and billing.

### 12b.2 The rule

| Action | Needs |
| --- | --- |
| Another admin changes or removes member M's GM grant | M's consent, **or** an owner-approved elevation |
| M narrows or resigns its own GM grant | Nothing, but the last-admin guard applies: the last admin cannot resign. The owner can first make someone else admin. |
| Granting a GM grant to someone new | The normal admin rules: a bound invitation, then a 72 h notified delay after acceptance (R1-H4) |
| Any non-GM grant (resources, member fields, integrations) | The normal admin rules |
| Changing the owner's own GM grant | The owner's consent only. Nothing ranks above the owner, so no elevation is possible. |

**Mechanics:**

- **Consent request.** Single pending request per (target, change), with a reason (plain text, ≤ 280 characters). It goes to the target (the subject) only; see §12b.2a for how it may be elevated. It never expires and never resolves by time. The target sees it in the activity center, approves with fresh authentication, or declines. A decline is no longer silent: the requester learns of it, because it unlocks elevation.
- **Elevation.** Available only under §12b.2a. The owner decides with a fresh passkey step-up (a status-checked certificate, spec §5.2 step 4). **Tight verification** (rev 5.4, Q14; *Provisional (coordinator), not signed off by the user*; implementation proceeds on it and it stays revisable): the owner's acceptance of an elevated GM change needs items 1–3 of the organization-move tight verification ([portability §6.2](identity-portability.md#62-organizations)): a step-up with a passkey or password enrolled more than 7 days earlier (portability P18 removed the person-recovery-file alternative); no security change on the owner's person account in the last 30 days; and notices to every admin. Item 4, the notified delay, does not apply, because a delay would let a rogue admin keep acting for its length. If the owner's account had a security change in the last 30 days, the owner can still reject but cannot accept until 30 days after the change; the subject's own consent still works. Rejecting needs only the fresh step-up. An accepted change takes effect immediately. The affected member is notified immediately with the requester, the owner and the reason, and the change is written to the hash-chained audit. Immediate effect on acceptance is deliberate: elevation exists mainly to stop a rogue admin.
- **Flood and harassment controls.**
  - At most 3 consent or elevation requests per (requester, target) per 30 days.
  - Identical pending requests are deduplicated.
  - The owner and the target can mute a requester: muted requests are declined at once and logged. Muting is the muting person's own action, not a timeout. A target's mute counts as the target's rejection, so the requester may elevate; an owner's mute counts as the owner's rejection of that requester's elevations.
  - *Bounds (wargame F-01, 2026-10-23, revised after re-review; provisional, not signed off).* A mute names a valid principal (an https issuer origin, http only on loopback, and a UUID subject). Any valid principal is recorded, member or not, so neither the answer, the work nor the list's length reveals membership. A member may mute at most 64 requesters, within the 64 KiB row budget. Only the requester's open requests are affected. Muting follows `ORGANIZATIONS_ENABLED` (off: the uniform 404); the subject can still answer every request through `decide`.
  - Repeated requests are visible in the audit.
- **Owner abuse.** The owner can remove any admin through elevation, because the owner pays and is accountable. Since rev 5.2 the owner must also ask the admin first, and can decide only after a rejection or the response period (§12b.2a), so an owner cannot purge admins instantly. The mitigations are otherwise transparency, not prevention:
  - immediate notice to the affected member;
  - the audit entry, visible to every admin;
  - the member's freedom to leave.

  This is stated to members at joining.

### 12b.2a Who decides, and when (user decision, 2026-10-22)

This refines the consent and elevation mechanics above. The user's words: "the elevation sits with them until either rejected, accepted, retracted, or the one who's grants are changing accepts. Initially only the subject is given the option to accept the change; but the requester can elevate if the subject rejects the change or takes too long."

1. **Subject first.** A grant-management change that needs consent goes first to the subject (the member whose GM grant is changing) only. The owner is not asked at this stage.
2. **When the requester may elevate.** The requester may elevate the request to the owner once the subject **rejects** it, or once the **response period** has passed without an answer. The response period is **7 days by default, configurable per organization**. *The 7-day figure is Provisional (coordinator), not signed off by the user* (rev 5.4, §1d item 5); implementation proceeds on it, and it stays revisable. Elevation is the requester's choice; nothing elevates automatically.
3. **What ends an elevation.** An elevated request stays pending with the owner until exactly one of these happens:
   - the owner accepts it (the change takes effect);
   - the owner rejects it (the request closes);
   - the requester retracts it (the request closes);
   - the subject accepts it (the change takes effect, as a consent).
4. **No timeout decides.** No period, before or after elevation, ever resolves a request in anyone's favour. The response period only *unlocks* elevation. A pending request is never auto-approved, auto-declined or expired. **Explicit exceptions** (rev 5.4, *Provisional (coordinator), not signed off by the user*; §1d item 1): the post-recovery 72 h auto-effect (§5.11) and the billing-lapse 72 h rule (§12b.3). Both are break-glass for an absent owner and settle who holds the owner role, not a grant-management request. Rev 5.5 proposes a third, the Track A break-glass effect (§12d.4, BG-1; *Provisional (coordinator), not signed off by the user*). No other timeout decides anything.
5. **Before elevation,** the request is likewise open until the subject accepts, the requester retracts it, or the requester elevates it. A subject's rejection does not close it by itself; it unlocks elevation, and the requester then elevates or retracts. **A subject may accept after rejecting**, before or after elevation, as long as the request is still open; the acceptance is a consent and the change takes effect (rev 5.4, *Provisional (coordinator), not signed off by the user*; §1d item 3).
6. **The owner as requester.** The rule applies to every requester. When the owner is the requester, the request still goes to the subject first, and the owner can decide it only after a rejection or the response period.
7. **The owner as subject.** Nothing ranks above the owner, so a request to change the owner's own GM grant cannot be elevated. It stays open until the owner accepts or rejects it, or the requester retracts it.
8. **Requests that no longer apply** (the subject resigned or left, or the grant changed by another route) close, and the closure is audited.
9. **A change of owner** (transfer, lapse claim or recovery taking effect) passes every elevated request to the new owner unchanged (§12b.3a; *Provisional (coordinator), not signed off by the user*). An elevated request whose subject is the new owner becomes an owner-as-subject request (item 7). A request whose subject is the former owner can now be elevated under item 2.

This is 3sln.me policy. The spec says only that the provider's grant-management policy applies (spec §6.3).

### 12b.3 Ownership changes and edge cases

- **Transfer.** See §12b.3a (rev 5.4, replacing the rev 4.3 nomination rule).
- **Billing lapse.** After the grace period ends without payment, the organization becomes read-only (§12a). Thirty days later, any admin may start a new subscription and propose itself as owner. This takes effect after a **72 h** notice to the old owner and all admins, and the old owner cancels it by paying. The rule stops an absent owner from blocking forever, and paying is the only way to claim the role. The 72 h auto-effect is an explicit break-glass exception to "no timeout decides" (§12b.2a item 4; *Provisional (coordinator), not signed off by the user*). A transfer whose payment is verified during the 72 h closes the claim, since the organization is paid again. When a claim takes effect, the claimant's new subscription starts a fresh period, elevated requests pass to the new owner, the recovery file is reissued and the 30-day move cooling starts.
- **Owner unreachable.** Elevated requests stay pending with the owner; none lapse (§12b.2a). Until the owner returns, a GM change happens only if the subject accepts. Everything else works. If the owner is gone for good and the file is lost, see ORG-12 break-glass (§12d).
- **Owner lost** (home account recovered or compromised):
  - The owner's admin power and elevation authority are **held** after an authority reset (§12c.3, signalled under spec §5.2a, R1-H3). Re-confirmation for the owner is a 72 h notice to all admins; any admin may object, which moves the organization to break-glass.
  - **Break-glass** is organization recovery with the owner's recovery file (§5.11, rev 5). After recovery the recovering person becomes candidate owner and admin under the 72 h rule, and only the current owner can cancel. A held owner cannot cancel until re-confirmed (*Provisional (coordinator), not signed off by the user*, §1d item 4): the hold exists because the owner's account may be in someone else's hands, so it must not carry the power to stop break-glass. It never removes admins by itself; any removals afterwards follow §12b.2.
  - A held owner also cannot offer a transfer (§12b.3a).
- **Owner also the admin being changed.** Only the owner's own consent changes it (table above).
- **Relation edges.** GM grants, like all owner-interface authority, never cross an edge (spec §6.2 rule 3). An external organization can never manage another organization's grants, and relation documents cannot express it.

### 12b.3a Ownership transfer (rev 5.4)

**Decided by the user, 2026-10-22:** "An organization's ownership can be transferred. The recipient needs to setup billing before receiving the org, and billing starts over for the period, the previous owner's subscription/payment doesn't count." Everything below that goes beyond those words is **Provisional (coordinator), not signed off by the user**; implementation proceeds on it, and it stays revisable. This is 3sln.me provider policy. The spec leaves ownership to each provider (spec §6.3).

**Offer.**

- Only the **owner of record** (§12b.1) can offer. A held owner (§12b.3) cannot, and no offer can be made while an organization recovery or a lapse claim is pending.
- The offer names exactly one recipient, who must hold a **3sln.me account**. The owner enters a handle; 3sln.me resolves it to the account and shows the resolved account before the owner confirms. Foreign identities cannot receive ownership, because ownership is a billing role on 3sln.me (§12a).
- Transfer is a dangerous owner action, so the offering owner passes **tight verification** ([portability §6.2](identity-portability.md#62-organizations), items 1–3): a step-up with a passkey or password enrolled more than 7 days earlier (portability P18), and no security change on the owner's person account in the last 30 days. **If there was one, the admins' block power returns,** as for moves: any admin may block the offer until 30 days after the change. A block closes the offer, and the owner may offer again after that.
- **Notices** go at once to every admin and to the recipient, naming the recipient's handle. Admins cannot otherwise block an owner's offer (the owner is more privileged, §12b.5), but any admin may **object**, which is recorded and notifies the owner and every admin again.
- One offer at a time. The owner may **withdraw** it at any moment until the payment is verified. An offer not accepted within **14 days** lapses. A lapse leaves everything as it was, so it decides nothing in anyone's favour (§12b.2a item 4).
- An offer may carry the `admin` power for the recipient. Ownership itself confers no GM grant (§12b.1 item 5), so an offered `admin` is a new GM grant: the offer is its bound invitation, and the 72 h notified delay of §12b.2 runs from the transfer taking effect.

**Acceptance.**

- The recipient signs in to 3sln.me, passes a fresh passkey step-up and sees a disclosure: the organization, its plan and price, that billing **starts a fresh period** now, that the previous owner's payment confers nothing, that they become owner of record (billing, elevations, the recovery file), and the organization's membership and grant policy.
- The recipient accepts by **completing checkout** for the organization's current plan (Polar, §12a). The checkout is created by the recipient's account, so §12b.1 item 1 makes them owner once it is active. There is no proration and no credit for time the previous owner paid for. Changing plan is a separate step after the transfer.

**Effect.**

- The transfer takes effect **only after the payment is verified**: a signature-verified Polar event shows the new subscription active and its first payment captured. A checkout that was merely created, a pending payment or a client-side redirect never counts.
- The transfer also waits at least **24 h after the offer's notices**, so admins see it before it happens. If payment is verified sooner, the switch happens at the end of those 24 h.
- At effect, in one account-writer commit:
  - the owner of record becomes the recipient; if the recipient is not yet a member, a membership is created with an empty grants list plus any offered `admin` (still under its 72 h delay), because the owner must be a member (§12b.1 item 5);
  - the **previous subscription is cancelled at once**, not at period end. There is no automatic refund. The previous owner may ask for one, which 3sln.me decides at its discretion under the [terms](../legal/terms.md) ("Refunds"), without limiting consumer-law rights;
  - the organization recovery file is reissued to the new owner and the old reset credential is invalidated (§5.11);
  - every elevated request passes to the new owner (§12b.2a item 9);
  - the 30-day **move cooling** starts ([portability §6.2](identity-portability.md#62-organizations));
  - notices go to the previous owner, the new owner and every admin, and the commit is written to the hash-chained audit.
- **The previous owner stays a member** with their existing grants, including `admin` if they held it, unless removed. Removing or narrowing their `admin` now follows §12b.2 like anyone else's, with the new owner as the elevation authority.
- **If the transfer cannot take effect** after payment (the offer was withdrawn, an admin block applied, a recovery took effect, or the recipient's account was suspended), the recipient's new subscription is cancelled and **refunded in full**, because they received nothing. The organization's billing and owner stay as they were.

**Interactions.**

- **Billing lapse.** An owner may offer a transfer while billing is past due or read-only, until a lapse claim is pending. An offer made before a claim stays open, and a transfer verified during the claim's 72 h closes the claim (§12b.3). A verified transfer restores normal operation, since the organization is paid again.
- **Recovery.** A recovery started while an offer is open freezes the offer: a verified payment waits. If the recovery is cancelled, the offer resumes. If it takes effect, the offer closes, because the owner changed, and a payment already verified is refunded in full.
- **Phase.** Transfer needs billing, so it arrives with billing (phase C), like the lapse rule (§13.3).

### 12b.4 Effect on the two-admin deadlock (Q8)

**Resolved for the common case.** One admin can no longer remove another without the target's consent or the owner's approval. So the mutual cancel-forever loop of R1-H4 (d) cannot arise: there is nothing to cancel, only a consent request or an elevation.

**Residuals:**

- If the owner is one of two feuding admins, the owner wins, but not instantly: the owner must ask the other admin first and can decide only after a rejection or the response period (§12b.2a). That is intended: the owner pays.
- If the owner is absent, elevated requests stay pending indefinitely, because no timeout resolves them (rev 5.2). A feud then ends only by the subject's consent, a retraction, a transfer, the billing-lapse rule or break-glass. After any change of owner, the elevations pass to the new owner (§12b.2a item 9). Neither feuding admin can remove the other, so the organization keeps operating with both, which is the same visible stalemate Q8's position B accepted.
- The rule creates no race: neither party gains anything by acting first, and a subject who rejects only unlocks elevation sooner.
- 3sln.me still adjudicates nothing beyond these rules.

### 12b.5 Organization moves (M10, decided by the user, 2026-10-22)

The user's words: admins can block "from other admins, no from org owner, original requester can elevate"; the owner is more privileged; and "these elevations need tight verification because they're quite dangerous." The full rules are in [portability §6.2](identity-portability.md#62-organizations). They follow the shape of §12b.2a:

- An admin may request a move. Any other admin may block it, and the owner may cancel it.
- The requester may elevate a blocked request to the owner. It stays pending until the owner accepts or rejects it, the requester retracts it, or every blocking admin withdraws their block (the counterpart of the subject's consent). No timeout decides.
- Admins cannot block a move the owner requests. They can object, with notices to everyone, and the 72 h delay and the 30-day cooling still apply.
- **Tight verification** (portability P18, decided by the security design agent under the user's delegation; not signed off by the user) applies to the owner's decision on an elevated move and to every owner-requested move (portability §6.2). If the owner's account had a security change in the last 30 days, the admins' block power returns.
- Tight verification also covers the owner's acceptance of a GM elevation (§12b.2) and the owner's transfer offer (§12b.3a), in both cases without a notified delay on the decision itself (rev 5.4, Q14; *Provisional (coordinator), not signed off by the user*). A GM elevation still takes effect immediately on acceptance.

## 12c. 3sln.me membership model (provider policy, not spec)

Decided by the user, 2026-10-22 (§1c item 8). Bindle sees a membership only through the outputs of spec §5–§7. Everything here is 3sln.me's choice, and another organization provider may model membership differently.

### 12c.1 The record

A membership is a **grants list keyed by the member's origin principal `(iss₀, sub)`**:

| Field | Meaning |
| --- | --- |
| Key | The origin principal (spec §5.3). Never a handle, a local account ID or the current `iss`. |
| Membership ID | Spec §5.3. Stable for this key across leaving and rejoining. |
| Grants list | The only source of the member's authority inside the organization: per-member entries (resource or scope, methods, optional `expires_at`, granted by, when) and governance powers (`admin` in v1). Templates copy entries in (§6.3). Nothing refers back to a template, a role or a group. |
| Added under | The member's identity signing key (`kid` and public key), pinned when the invitation was accepted, and the certification `kid` that signed the acceptance certificate. |
| Current pins | The signing-key pin and seen-kid sets of spec §3a.4, the highest accepted `aep`, and the successor pin (shared with the successor index, portability spec §8.2). |
| State | Live or ended, an optional membership `expires_at`, and any hold (§12c.3). |

### 12c.2 Member key rotation and moves

The added-under keys are **provenance, not a lock**. Certificates are checked against the member's live identity document (spec §5.2), never against the recorded key, so the record never needs rekeying.

- **Rotation with continuity at the home provider.** The new key links to the pinned key by continuity statements, so it is accepted silently. The pin advances and the grants list is untouched. The chain from the added-under key to today's key stays walkable.
- **Certification-key rotation.** No effect. The recorded certification `kid` is audit provenance only.
- **Key reset without continuity, a higher `aep`, or `connection-revoked`.** An authority reset (spec §5.2a). The grants list stays, governance powers are held (§12c.3), and the record notes where the provenance chain restarted.
- **The member moves.** Adoption through the successor index (portability spec §8.3) maps the new `(iss, sub)` to the same origin principal, so the membership, its ID and its grants list are unchanged. The chain stays unbroken: added-under key → continuity statements → the key that signed the move statement → the destination's activation rotation (portability P11, the chained provenance of Q1). Adoption is an authority reset, so governance powers are held until re-confirmed.
- **Broken chain** (an unattested move adopted by hand, or a key reset). The record keeps the break, who adopted it and when. Provenance restarts from the new key, and the console marks the member "continuity broken on <date>".
- **The organization moves.** Memberships travel with its data import (portability §8). They are keyed by origin principals, so nothing rekeys.

### 12c.3 Rules moved from the spec (rev 5.3)

These were spec requirements until spec rev 4.2. They are now 3sln.me policy, unchanged in substance. **Rev 5.4** (*Provisional (coordinator), not signed off by the user*; §1d item 9): the first and third, the hold and bound governance invitations, are back in the spec as **minimum requirements** (spec §5.1, §5.2a, §6.3), because they protect members homed at other providers. The details below (72 h, who re-confirms, the 72 h wait for a new admin) stay 3sln.me policy above that floor.

- **Hold after an authority reset** (was spec §5.2a, R1-H3). Governance powers are held until a re-confirmation that names the `aep` it confirms; a later reset needs a new one. Re-confirmation is another admin's approval, or a 72 h notice to every other admin, any of whom can cancel; for the owner, §12b.3. Member grants resume with the next valid certificate. The hold is audited and shown to the member.
- **No escalation through one's own account recovery** (was spec §3). A person never gains governance powers through their home-account recovery beyond what they already held.
- **Bound invitations for governance** (was spec §5.1, R1-H4). An invitation that offers `admin` names its invitee. An unbound invitation confers member grants only. A new admin grant also waits 72 h after acceptance (§12b.2).
- **Partial governance** (was spec §6.3, R1-L6). A member holding part of the owner interface cannot confer authority it could not confer itself. Granting an app a resource is conferring it.
- **Never without an operator** (was spec §6.3). The last-admin guard (§12b.2), with organization recovery as the only way back. Rev 5.5 (provisional): or a member-initiated break-glass claim, which support decides (§12d.3).
- **Ending a membership** (was spec §5.4). Admins remove members, membership `expires_at` is swept, and the member can always leave. The spec keeps only the commit's effects.
- **Owner-interface audit** (was spec §6.3, §13). Every owner-interface action records the acting member in the hash-chained audit.
- **Tests moved with them:** an unbound invitation cannot confer `admin`; an `aep` change, key reset, `connection-revoked` or move adoption holds `admin` until re-confirmation; re-confirmation names its `aep`; the last admin cannot be removed under races.

### 12c.4 Where the split may need a second look

The coordinator was asked to list, not decide, the cases where the user's split might be wrong:

1. **Apps enforcing the intersection.** For resources the provider hosts, the provider enforces the intersection, so apps need no grant format. An app that keeps its own data (the ERP's records), or hosts integration-hosted resources, must enforce the member's authority itself. Today it gets only a filtered projection, brokered tokens and, in phase B, member-scoped fields. ~~Whether the member-context projection should state the effective methods per resource is open (§15 Q15).~~ **Rev 5.4:** adopted as a standard *output* shape, never the grant records (spec §7.5, phase B; *Provisional (coordinator), not signed off by the user*).
2. **Organization moves between providers.** A destination must import the organization's memberships and grants. Without a portable format, a move to another provider re-creates member grants by hand. Spec §13 already reserves export formats as TBD. A portable membership export would be the one place internal grants touch the spec. **Rev 5.4:** adopted as an interop requirement (spec §13.1; *Provisional (coordinator), not signed off by the user*).
3. **Security floors for foreign members.** The hold after a home-account recovery and bound governance invitations protect members whose home is another provider. As non-normative security considerations, a careless provider can omit them. **Rev 5.4:** restored as spec minimum requirements (MUST), with the specifics left to provider policy (spec §5.1, §5.2a; *Provisional (coordinator), not signed off by the user*).
4. **Kept in the spec on purpose:** `member-removed`, the membership ID and member-scoped fields. Apps rely on them, so they are interop, not internal mechanics.

## 12d. ORG-12 break-glass: an organization whose owner is gone (3sln.me provider policy)

Status: **design 2026-10-23; ORG-12a, ORG-12c and ORG-12r implemented locally the same day (engine level, behind `ORG_BREAK_GLASS_ENABLED`, default off). Provisional (coordinator), not signed off by the user, and unreviewed.** What exists is engine operations, the runtime wiring and engine/chaos tests over loopback fixtures and an offline Polar model ([DEVLOG 2026-10-23 — ORG-12a/12c break-glass engine and billing](../../DEVLOG.md)). Later the same day ORG-12b (owner channels, abort links, the sign-in liveness hook) and ORG-12e (routes and console UI) were implemented locally, also provisional ([DEVLOG 2026-10-23 — ORG-12b/12e owner channels, abort links and console](../../DEVLOG.md)). ORG-12d (support adjudication: the production operator-assertion signer and registry, the case queue, routes and operator screens) followed on 2026-10-24, provisional ([DEVLOG 2026-10-24 — ORG-12d support adjudication](../../DEVLOG.md)); ORG-12f remains. Nothing is production-verified: notification delivery, operator identity and the hash-chained audit's external anchor are still gates. Implementation readings and deviations from this text are listed in that DEVLOG entry. It is 3sln.me provider policy. The spec gains only one rule, one disclosure item and two conformance checks (spec rev 4.4: §3, §6.3, §16). The decisions the user should review are in §12d.11. An independent adversarial review (2026-10-23, round BG-R1: 3 High, 7 Medium, Low items) was applied before publication. Its findings are marked BG-R1-… where they changed a rule. Reviewer: ___ Date: ___ Outcome: ___

### 12d.1 The gap, and what this section covers

The design already covers an owner who is present (transfer, §12b.3a), a recovery file that exists (organization recovery, §5.11), an owner who stops paying (the lapse claim, §12b.3), and an owner whose account was reset (the hold and re-confirmation, §12b.3). It does not cover an owner who is **gone**: dead, unreachable for good, or someone who lost every credential *and* the organization recovery file, while the subscription keeps renewing (an annual plan, a company card) or the organization cannot wait for a lapse.

Without an owner, the organization keeps working, but these things stop:

- elevated grant-management requests stay pending forever (§12b.2a item 4);
- nobody can offer a transfer, reissue the recovery file or schedule deletion;
- nobody can move the organization, because a move needs the current recovery file (portability §6.2);
- if the last effective admin is also gone, nobody can govern at all.

**ORG-12 break-glass** is a way for the organization's own admins to install a new owner of record without the file. It is built so that nothing happens silently, and so that an owner who answers always wins.

**In scope:** the break-glass claim (§12d.3–§12d.8), and reissuing the organization recovery file where it is missing (§12d.9). File-based organization recovery (§5.11) is not redesigned, but it is implemented on the same state machine (§12d.12, ORG-12f), so the precedence rules live in one place.

**Out of scope** (from the phase B backlog, DEVLOG 2026-10-23):

- **`orgs.forget` wiring.** That system operation drops the owner-of-record index row once an organization is purged. It belongs to the deletion executor hand-off (ORG-1 note 2, `deletion-due`), not to break-glass. A break-glass change of owner moves the index row with the existing `orgs.ownership-index` operation, exactly as a transfer does.
- **Flag targeting for organization accounts.** The new flag (§12d.12) uses the existing account subject, set to the organization's account, exactly as `ORGANIZATIONS_ENABLED` does. Cohort targeting by entity kind is not needed here.
- Also out of scope: designated successors and social recovery (§12d.10, deferred), legal-process overrides (§12d.8), managed work identities (§11), and a person's own account recovery.

**Principles.** Each rule below follows from one of these:

1. **The owner outranks the admins** (user decision, §1c item 9). Nothing admins do can beat an owner who answers.
2. **Aborting is cheap; proceeding is slow and costly.** An abort needs no proof and is never refused. Taking effect needs a quorum, payment, a long notified wait, and no answer from the owner.
3. **Operators can stop a claim but never start or shortcut one.** No operator decision skips a notice, a delay or the payment, and none can override the owner's elevated proof.
4. **The recipient pays first** (user decision, §1c item 10). The candidate owner completes checkout before the claim can take effect, and billing starts a fresh period.
5. **Dangerous owner changes get tight verification** (user decision, §1c item 9). The candidate passes the P18 checks, and the new owner works under restrictions while the former owner can still contest.

### 12d.2 Threat model

| Threat | Attack | Mitigation | Residual |
| --- | --- | --- | --- |
| **Malicious admin coalition** | Every admin colludes to seize the organization from a live owner, perhaps timed to a holiday. | A quorum cannot shortcut anything. The claim takes at least 30 days after payment, and notices go to every owner channel when the wait starts, 7 and 21 days later, and 72 h before effect. Any known owner channel aborts, with no proof needed. Any interactive owner sign-in holds the claim for support. Track A is open only when the owner has not signed in interactively for 30 days before the claim, and an email on a domain the admins, the candidate or the organization control does not count as an out-of-band channel (BG-R1-H2). After effect, the former owner can contest for 90 days, during which the new owner cannot transfer, move or delete the organization, and the former owner's membership cannot be removed. | An owner out of contact on every channel for more than 30 days loses ownership until their contest succeeds. The coalition could already operate the organization (they are its admins); what they gain is the owner's elevation power, under notice. |
| **One rogue admin** | Claims alone, or with a fake co-signer. | Two distinct admins with at least 30 days' tenure. A single-admin organization goes to support (Track S). Any other admin can object, which also sends the claim to support. | A rogue admin plus one careless co-signer still needs the owner to be silent for 30 days. |
| **Social-engineered support** | An attacker convinces support that the owner is dead. | Support cannot start a claim, change the owner, skip a delay or waive payment. A decision to proceed needs two operators, recorded reasons and conflict checks. It is followed by a further 7-day notified period, in which any known owner channel stops the effect, even one support excluded (an excluded channel's dispute needs a new decision by a different pair of operators, BG-R1-H1), and the owner's elevated proof always aborts. Support cannot exclude the owner's last channel. | Two deceived operators plus an owner who never sees any notice. The contest window and the audit remain. |
| **Owner on holiday** | Not an attack: the owner is offline for weeks. | The wait is 30 days, with push and email notices. A sign-in while a claim is pending holds it, so an owner who returns and does nothing loses nothing. After effect, a 90-day contest. | An owner offline for over 30 days with no email access. The contest is the remedy. |
| **Owner's account taken over** | An attacker in the owner's person account aborts every legitimate claim. | The first abort ends the claim. A claim within 180 days of an owner abort goes straight to support, which may proceed and exclude the channels it finds are controlled by someone else. A dispute from an excluded channel still stops the effect, but each one needs a fresh decision by a different pair of operators, so the attacker's power ends at support's patience, never at a silent seizure. | An attacker holding the owner's aged passkey has the same proof as the owner. The claim then cannot proceed in the product; that is intended (abort is the safe direction). The lapse claim still applies: the attacker must keep paying the owner's subscription to block it. Otherwise the remedy is off-platform. |
| **Compromised operator** | One operator, or two colluding, push a claim through. | One operator can only hold or abort. Proceeding needs two different operators, neither a member, the candidate or the owner, and each decision is written to the hash-chained admin audit and the organization's audit, which every admin and the former owner can see. Operators have no route to change an owner directly. | Two colluding operators with an owner who never answers. Insider risk at the provider is otherwise inherent (§10). |
| **Candidate's account taken over** | An attacker in an admin's account names themselves candidate. | P18 tight verification for the candidate at the start and again at checkout: a credential at least 7 days old, and no security change in 30 days. Any authority reset or security change on the candidate's account during the claim closes it. | A takeover that waited 30 days quietly, plus a silent owner. |
| **Notice suppression** | Admins try to stop the owner hearing about the claim. | Notices are sent by 3sln.me to the owner's own person-account channels, which admins cannot change. An email whose domain is the organization's, the candidate's or an initiating or co-signing admin's domain does not count as out of band, because the admins may run that mailbox (BG-R1-H2). An owner with no out-of-band channel sends the claim to Track S. | Delivery is not verified: acceptance by the mail provider is not delivery, and notices can land in spam. |
| **Harassment of a live owner** | Repeated claims to wear the owner down. | Each owner abort locks the organization against new claims for 30 days and sends any claim in the next 180 days to support. Limits: 3 counted claims per organization and 2 per person a year, and one pending claim at a time. A claim counts only once it is paid or aborted by the owner, so unpaid claims cannot use up a legitimate recovery's quota (BG-R1-H3). Every claim costs the candidate a full checkout, refunded only after the claim ends, less the processing fee if the candidate withdraws voluntarily. | Each claim costs the owner one click. |
| **Racing ownership processes** | A transfer, lapse claim, file recovery and break-glass claim are pending together, hoping two take effect. | Exactly one ownership process can be pending at a time, apart from file recovery, which freezes a claim (§12d.7). The effect re-checks the owner of record in the same commit. | — |
| **Payment fraud** | The candidate pays, takes effect, then charges back. | Ownership stays. The organization's standing then follows the ordinary lapse rules, and a chargeback within the contest window counts as grounds in a contest. | The window before standing degrades. |
| **Foreign co-signer forged by its home provider** | A colluding home provider certifies a fake admin co-signature. | In v1 only admins homed at 3sln.me count toward the quorum. Foreign admins can object, which sends the claim to support. | Organizations whose other admins are all foreign go to Track S. |
| **Probing the owner's account** | Admins start claims to learn whether the owner signs in, deleted their account or changed security settings. | Admins see only "held for support", never the cause. Channel kinds and credential ages are shown to operators only (BG-R1-M4). | Admins learn that a claim went to support. |
| **Evidence privacy** | Death certificates and medical details collected and leaked. | The product never accepts evidence uploads. Evidence goes to support out of band and is kept under support's retention. The claim stores only a category, a statement of up to 2,000 characters and case references. | Support's own handling. |

### 12d.3 Actors and proofs

| Actor | Who | What they can do |
| --- | --- | --- |
| **Owner of record** | The account in §12b.1 when the claim starts | Abort through any known channel; elevated proof (tier 1); after effect, contest |
| **Initiator** | An eligible admin, or an eligible member when no admin is effective | Start the claim, withdraw it |
| **Candidate** | The eligible person who would become owner (may be the initiator) | Accept the candidacy (it counts as a signature), pay, withdraw |
| **Co-signers** | Other eligible admins | Co-sign, and withdraw a co-signature until effect |
| **Other admins** | Any effective admin, including foreign admins | Object (sends the claim to support), see the claim |
| **Members** | Everyone else | See that a claim is pending and its dates, in their member view |
| **Support operators** | 3sln.me internal accounts with the `support.org-break-glass` capability (§12d.8) | Hold, abort, and, with two operators, proceed or exclude channels |
| **System** | The organization's sweep | Deadlines, reminders, the effect commit, refunds |

**Owner channels** are taken from the owner's 3sln.me person account when the claim starts, and recorded on the claim:

- a **known session**: a session created before the claim began;
- a **known credential**: a passkey or password enrolled before the claim began. A sign-in with it counts as a known session;
- a **confirmed email**: verified before the claim began, including one removed or replaced in the 30 days before;
- a **push subscription** registered before the claim began.

Notices go to every confirmed email and push subscription, and appear as an interstitial on every known session. Channels added after the claim began can never abort it (the person-move rule, portability §6.1a item 2). The channel snapshot (kinds and enrollment ages, never addresses) is visible to operators and the owner, never to admins (BG-R1-M4).

**Liveness** means an interactive sign-in or step-up on the owner's person account. Background session refreshes do not count, so a dead person's phone cannot hold every claim (BG-R1-M2).

**Proof tiers** (matching the person-move ladder, portability §6.1a item 4):

| Tier | Proof | What it can do |
| --- | --- | --- |
| 0, known channel | Any owner channel above. An email or push notice carries a single-use abort link that needs no sign-in. Abort while no support decision to proceed exists. After one, stop the effect and return the claim to support (§12d.5), including from a channel support excluded (BG-R1-H1). |
| 1, owner elevated proof | A step-up now with a passkey or password enrolled at least 7 days before the claim began, and no authority reset on the owner's person account since the claim began. The person recovery file does not count (P18). | Abort at any point before effect, including after a support decision. Support cannot override it. After effect, contest. |
| 2, support | Two operators, out of band: channel and credential ages, billing records, audit history, documents seen by support | Proceed, or exclude channels for one decision (§12d.8). Never overrides tier 1, and never excludes the owner's last channel. |

**Eligibility.**

- **Initiator and co-signers:** effective admins (not held, not expiring, not under the new-admin 72 h wait) who held `admin` for at least 30 days before the claim began, other than the owner, and homed at 3sln.me. Foreign admins cannot sign in v1 (they can object), which removes the forged-co-signature risk at the cost of sending some organizations to Track S (BG-R1 Low). Each origin principal counts once.
- **Candidate:** a 3sln.me person account that is an effective admin with 30 days' tenure. Its account must be active, with no suspension, deletion or admin hold. It passes P18 items 1–2 (a step-up with a credential enrolled at least 7 days earlier, and no security change in the last 30 days) when it accepts and again at checkout. It may be candidate in only one pending claim anywhere. Foreign members cannot be candidates, because ownership is a 3sln.me billing role (§12b.3a).
- **Member-initiated claims** exist only when the organization has **no effective admin**: then a member with 90 days' tenure, holding a 3sln.me account and passing the same checks, may be both initiator and candidate. The claim is always Track S.
- **Quorum:** two distinct eligible admins among the initiator, the candidate and the co-signers. With only one eligible admin, the claim is Track S.

### 12d.4 Tracks

| | Track A (admin quorum) | Track S (support-adjudicated) |
| --- | --- | --- |
| When | A quorum of two; the owner has at least one out-of-band channel (a confirmed email not on the organization's, candidate's or signing admins' domain, or a push subscription); the owner's person account has had **no interactive sign-in for 30 days** before T1 (BG-R1-H2); no trigger for Track S | Any of: a single eligible admin; a member-initiated claim; the owner has no out-of-band channel, signed in interactively within 30 days before T1, or their person account is deleted; a claim started within 180 days after an owner abort; an admin objection; an interactive owner sign-in while it is pending; a contest |
| Wait after payment | 30 days | 60 days, and support must decide to proceed |
| Takes effect | Automatically at the end of the wait, if nothing stopped it. **This is a third explicit break-glass exception to "no timeout decides"** (§12b.2a item 4, which lists only two; §12d.11 BG-1). | Only after a two-operator decision to proceed, followed by a 7-day final notice, and not before the 60 days end |

A claim can move from Track A to Track S, never back. Admins see only that a claim is "held for support", never which trigger applied (BG-R1-M4).

### 12d.5 State machine

**States.** `gathering` (quorum, candidacy and payment), `waiting`, `held` (support must act), `final` (after a support decision to proceed), `effective` (terminal), and the terminal closures `aborted`, `withdrawn` and `closed` (with a reason). A `frozen` mark can sit on `gathering`, `waiting`, `held` or `final` while a file-based recovery is pending (§12d.7).

**Transitions.** Every transition is one commit in the organization's single writer, with an audit entry and notices.

| # | From | Event | Guard | To | Effects |
| --- | --- | --- | --- | --- | --- |
| T1 | — | Initiator starts | Eligible initiator, valid candidate, reason category and statement. No other ownership process pending (transfer offer, lapse claim, break-glass, file recovery), no move pending, no deletion scheduled, no lock (§12d.8), within the limits. | `gathering` | Owner channels snapshot; notices to the owner and every admin; banner for members |
| T2 | `gathering` | Candidate accepts | P18 items 1–2 | `gathering` | Counts as a signature |
| T3 | `gathering` | Co-sign / withdraw co-signature | Eligible admin | `gathering` | — |
| T4 | `gathering` | Candidate pays | Quorum met (or Track S) and candidacy accepted; P18 rechecked; checkout created by the candidate's account | `gathering` | Checkout with purpose `break-glass` (§12d.6) |
| T5 | `gathering` | Payment verified | A captured first order, from a provider snapshot no older than 5 minutes | `waiting` (Track A) or `held` (Track S) | The wait starts; first scheduled notice |
| T6 | `gathering` | 7 days without quorum and candidacy, or 7 days from quorum without verified payment | — | `closed` (`quorum-lapsed` / `unpaid`) | Refund if any order exists. Not counted toward the limits (BG-R1-H3). |
| T7 | `waiting` | Reminder due: 7 and 21 days after the wait started, and 72 h before effect | — | `waiting` | Notices |
| T8 | `waiting` | Any admin objects | Effective admin | `held` | Track S from now on; notices |
| T9 | `gathering`, `waiting`, `final` | Owner liveness: an interactive sign-in or step-up (BG-R1-M2) | — | `gathering` stays, as Track S; `waiting` and `final` become `held` (a `final` decision is void) | An interstitial asks the owner to abort or contact support |
| T10 | `gathering`, `waiting`, `held` | Owner abort, tier 0 or tier 1 | A known channel or an elevated proof | `aborted` | Refund; lock (§12d.8); notices to everyone. The owner is offered a recovery-file reissue and the member list. |
| T11 | `final` | Owner tier-0 dispute from any known channel | — | `held` | The proceed decision is void; support decides again. After a dispute from an excluded channel, a new decision needs a pair of operators different from the pair that excluded it (BG-R1-H1). |
| T12 | `final` | Owner tier-1 proof | — | `aborted` | As T10, and support cannot proceed with a new claim for 30 days |
| T14 | any open state | Unheld owner of record takes any owner-interface action with fresh authentication (transfer offer, deletion, a decision, reissue) | — | `aborted` (`owner-active`) | As T10. Renewal payment is **not** such an action (§12d.6). |
| T15 | any open state | Initiator or candidate withdraws | — | `withdrawn` | Refund |
| T16 | any open state | Candidate becomes ineligible (left, removed, held, authority reset or security change, account suspended or deleting), or a withdrawn co-signature leaves the quorum short | — | `closed` (`ineligible` / `quorum-withdrawn`) | Refund |
| T17 | any open state | A file recovery takes effect (§5.11) | — | `closed` (`superseded`) | Refund |
| T18 | any open state | File-based recovery starts (§5.11) | — | same state, `frozen` | Deadlines keep running, but nothing takes effect while frozen |
| T19 | `frozen` | That recovery is cancelled | — | unfrozen | If the wait ended while frozen, the effect check runs at once |
| T20 | `held` | One operator acknowledges, or asks parties for more | — | `held` | Case notes (references only) |
| T21 | `held` | One operator aborts | — | `aborted` (`support`) | As T10 |
| T22 | `held` | Two operators decide to proceed, optionally excluding named owner channels | The §12d.8 checks; at least one owner channel stays unexcluded | `final` | 7-day final notice with **fresh abort links** to every owner channel (excluded ones too), every admin and members |
| T23 | `held` | No operator acknowledgement within 30 days, or no decision within 60 days of entering `held` (the clock restarts at each return to `held`; at most 120 days held in total) | — | `closed` (`expired`) | Refund; an operator alert. **No lock and no charge to the limits**, so an understaffed queue never kills a legitimate claim (BG-R1-H3). A held claim never takes effect by itself. |
| T24 | `waiting` (Track A) | The 30 days end | Effect preconditions | `effective` | Effect commit |
| T25 | `final` | The 7 days end, and the 60-day Track S wait has passed | Effect preconditions | `effective` | Effect commit |
| T26 | `waiting` or `final` | The wait ends but a precondition fails transiently (stale provider snapshot, billing hold) | — | same | Retry hourly; this never weakens a guard |
| T27 | `effective` | Former owner contests within 90 days with tier-1 proof (membership not required) | — | `effective` (contested) | A support case; see "Contest" below |

**Effect preconditions**, all re-checked in the effect commit: not frozen; no open hold; the owner of record is the one recorded at T1; the candidate is still eligible, with no security change on their account since T1; the quorum still stands; payment is verified from a snapshot no older than 5 minutes, and no billing hold exists; the organization is active (no deletion scheduled); `ORG_BREAK_GLASS_ENABLED` is on for the organization (§12d.12).

**The effect commit**, in one account-writer transaction, like a transfer (§12b.3a):

- the owner of record becomes the candidate; the candidate's `break-glass` subscription becomes the organization's subscription, and every subscription of the previous owner is revoked at once with no automatic refund;
- the organization's authority epoch increases by one (spec §3, rev 4.4);
- the recovery state becomes `rotation-pending`: the organization's recovery credential is cleared on the identity record (recovery file v3, 2026-10-28; the signing key also rotates), so every earlier file stops working, and the new owner is asked to save a fresh file (§12d.9);
- the former owner stays a member, and their membership cannot be removed during the contest window (BG-R1-M3), but their governance powers are **held** with cause `break-glass` (the §12c.3 hold, re-confirmed by another admin's approval as usual). Their member grants are unchanged;
- elevated requests pass to the new owner (§12b.2a item 9);
- a **90-day contest window** opens, with the restrictions below;
- the owner-of-record index moves (`orgs.ownership-index`); notices go to the former owner's channels, the new owner, every admin and members; the commit is written to the hash-chained audit.

**During the 90-day contest window**, the new owner cannot offer a transfer, schedule deletion or move the organization (the move cooling is 90 days instead of 30, portability §6.2). They can reject elevations at once. An accepted elevation that **narrows or removes** someone's GM grant is recorded and notified to the former owner, but takes effect only when the window closes without an upheld contest, because a reinstatement cannot undo it (BG-R1-M3). Other acceptances take effect at once.

**Contest.** Within 90 days of the effect, the former owner may contest with tier-1 proof, where "the claim began" in the tier-1 definition means T1 of the claim that took effect. A contest opens a support case. If two operators uphold it, the organization goes back to the former owner through a **reinstatement**. That is a restoration, not a transfer, so the transfer billing rule does not apply (BG-R1-M1). One commit restores them as owner of record, cancels the break-glass owner's subscription (any refund at support's discretion), raises the epoch again, rotates the recovery binding, holds the break-glass owner's governance powers and drops the queued elevation acceptances. The organization starts a **14-day grace period** in which the former owner sets up billing; their revoked subscription's unused time is refunded or credited. Without payment, the ordinary read-only and lapse rules follow. A rejected contest closes. After 90 days there is no in-product contest, and a transfer is the only way back.

**Timeouts, in one place:**

| Timer | Value | When it runs out |
| --- | --- | --- |
| Quorum and candidacy | 7 days from T1 | `closed` |
| Payment | 7 days from quorum | `closed` |
| Track A wait | 30 days from verified payment | effect (BG-1) |
| Track S wait | 60 days from verified payment | Nothing by itself; effect needs a support decision to proceed |
| Reminders | when the wait starts, 7 and 21 days later, and 72 h before effect | notices |
| Support acknowledgement | 30 days from `held` | `closed` (`expired`), uncounted |
| Support decision | 60 days from each entry to `held`, at most 120 days in total | `closed` (`expired`), uncounted |
| Final notice | 7 days from a support decision to proceed | effect |
| Contest window and restrictions | 90 days from effect | the window closes |
| Lock after an owner or support abort | 30 days; any claim within 180 days of an owner abort is Track S | — |
| Reinstatement grace | 14 days from reinstatement | ordinary read-only rules |

### 12d.6 Billing

- **Who pays: the candidate**, before the wait starts. The candidate completes checkout for the organization's current plan, with checkout purpose `break-glass` bound to the claim. Billing starts a fresh period, with no proration and no credit for the previous owner's payment (the transfer rule, §1c item 10). Paying first also makes every claim cost something until it ends. **The paid period runs from checkout, so the 30 to 127 days before effect are lost to the candidate**; the checkout disclosure says so (BG-R1-M6).
- **The claim's subscription confers nothing** until the effect: it does not count toward the organization's standing, as for lapse-claim and transfer checkouts.
- **At effect,** the previous owner's subscriptions are revoked at once. There is no automatic refund. The previous owner, or their estate, may ask for one, which 3sln.me decides at its discretion under the terms ("Refunds"), as for transfers.
- **A claim that does not take effect** has every order on its subscription refunded in full, exactly once, through the ownership drain and its lease (§13.2 wargame fixes). Polar's fee on a refunded claim (about 5% + US$0.50 at the modelled rate, about US$1,800 on the Scale plan) is absorbed when the owner or support ends the claim or it expires. **When the candidate or initiator withdraws voluntarily, the processing fee is deducted** from the refund, and the disclosure says so (BG-R1-M6).
- **The owner's renewal does not abort a claim.** A payment is not proof of presence: cards renew by themselves, and a held owner may renew (F-03). Only a tier-0 or tier-1 abort, or an owner-interface action, shows the owner is present.
- **The lapse claim** (§12b.3) and break-glass exclude each other: neither can start while the other is pending. If the organization goes read-only during a break-glass wait, the wait continues; the claimants may withdraw (and are refunded) and use the lapse claim once it becomes available, which is faster because non-payment already shows absence.
- **A billing hold** (a subscription the provider cannot confirm) freezes the effect, as it freezes a lapse claim (§13.2 review fixes).
- **A chargeback after effect** leaves ownership as it is. The organization's standing follows the ordinary grace and read-only rules, and the chargeback counts as grounds in a contest.
- **Support time is not billed.** It is bounded by the limits in §12d.8.

### 12d.7 Interactions

- **Authority epoch.** The organization's `aep` rises once, at the effect commit, and again only at a reinstatement. Claims that end any other way leave it unchanged (spec §3, rev 4.4, mirroring R4-M2). Counterparts may hold edges on the rise under their own policy (spec §9.5). The entity certificates the organization issues afterwards carry the new `aep`.
- **Keys.** The effect rotates the identity signing key, through the `rotation-pending` path that transfers already use, so lost or stolen copies of the old file stop restoring. Copies of earlier private keys cannot be recalled (§5.11). Certification keys are untouched, because no file contains them (R4-H1).
- **Holds.**
  - A **held owner can abort** a break-glass claim with tier 0. This differs from file recovery, where a held owner cannot cancel (§1d item 4): there the claimant holds the owner's file, which is strong evidence, while here the claimants hold none. An attacker who aborts from a taken-over account only sends the next claim to support (BG-9).
  - An authority reset of the candidate closes the claim (T16). An authority reset of a co-signer withdraws their co-signature, which may leave the quorum short and close it.
  - When the owner's hold re-confirmation draws an admin objection, §12b.3 sends the organization to break-glass: with the file, that is §5.11; without it, an ORG-12 claim, which is Track S because of the objection.
- **Ownership transfer.** A claim cannot start while an offer is open. An owner's offer during a claim is an owner-interface action, so it aborts the claim (T14), and the offer proceeds under §12b.3a. A held owner cannot offer. The new owner cannot offer during the contest window.
- **File-based recovery** (§5.11) is stronger evidence. A claim cannot start while one is pending. One started during a claim freezes the claim (T18); if it takes effect, the claim closes as superseded and is refunded; if it is cancelled, the claim resumes (T19). File recovery itself is a separate, later slice (ORG-12f); until it exists, T17–T19 cannot fire.
- **Moves.** A pending move means someone holds the current file, so a claim cannot start then, and no move can be requested while a claim is pending. After effect, the cooling is 90 days, and a move also needs the new file to be at least 7 days old (P14).
- **Deletion.** A claim cannot start while deletion is scheduled. An owner who schedules deletion during a claim aborts it (T14). Admins may still cancel a scheduled deletion, as now.
- **Elevations** pass to the new owner (§12b.2a item 9). During the contest window, each acceptance is also notified to the former owner.
- **Foreign members** can object, which sends a claim to support, but cannot initiate, co-sign or be candidates in v1 (§12d.3). Their notices are in-console only, because the spec defines no outbound notice to a foreign home provider.
- **Member certificates and member context** are unaffected: they rest on each member's home provider, not on the owner. The only membership change is the hold on the former owner's governance powers.
- **Organization audit.** Break-glass depends on the organization audit being hash-chained, which ORG-1 deferred. That is a production gate (§12d.12).

### 12d.8 Audit, notices, rate limits and what support can do

**Audit.** Every transition writes an organization audit entry `organization-break-glass-<event>` with the actor chain, the claim id, the track and the timers. It never includes the statement's text beyond its digest, the evidence, channel addresses, or the cause of a move to Track S. Every admin and the owner of record can read these entries, and so can the former owner during the contest window. Channel kinds and ages, and Track S causes, are kept in the support case, readable by operators and the owner only (BG-R1-M4). Operator actions are written to both the admin audit (boot-and-admin) and the organization audit.

**Notices** go to the owner's channels, every admin and the candidate at T1, T5, each reminder, T8–T12, T21–T25 and T27. Members see a banner with the start date and the earliest effect date. Each email or push notice carries its own abort link: 256-bit random, stored hashed, bound to the claim and the channel, usable once, valid until the claim ends. Every final notice (T22) issues fresh links. GET shows a confirmation page and never changes anything (mail scanners); POST aborts. Pages send `frame-ancestors 'none'` and no referrer.

**Abort-link friction and residual** (review of ORG-12b/12e, 2026-10-23; coordinator decision, provisional, not signed off by the user): tier 0 is unchanged, so the owner's link still aborts with no sign-in. Because a mail scanner may run the page, the POST needs a real user-activation gesture, the organization's public handle typed as shown (checked by the server against the identity record), and at least 2 seconds since a signed render time on the page (pages older than 2 hours are refused). **Residual:** a scanner that runs scripts, reads the fragment, waits and synthesizes trusted input can still abort a claim. That only stops a claim (the safe direction); the claimants may start again within the locks and limits. Abort-link budgets are charged only for refused or failed outcomes, so the owner's own stop never spends the budget of a shared network, and an IPv6 address counts per /64.

**Rate limits:**

- one pending claim per organization, and at most 3 **counted** claims per organization in 365 days, where a claim counts once it is paid or aborted by the owner (BG-R1-H3);
- at most 2 counted claims per person in 365 days, across organizations, as initiator or candidate; one pending candidacy; and at most 4 unpaid starts per person in 365 days;
- a 30-day lock after any owner or support abort, and Track S for 180 days after an owner abort;
- co-signature changes: 10 per admin per day;
- abort-link POSTs: per-IP and per-claim budgets; used, unknown and expired tokens get identical responses;
- support decisions: 20 per operator per day, inside the admin service's existing per-actor window.

**Support operators** hold the internal capability `support.org-break-glass`. It is boot-assignable only, never delegable, and needs an internal account (boot-and-admin roles).

| Support can | Support cannot |
| --- | --- |
| List held claims and read a case: states, timers, tracks, channel kinds and ages, billing standing, audit metadata and its own notes | Read organization resources, member grants beyond counts, preference values or the statement's text unless a party shares it |
| Contact parties out of band, and keep evidence in the support system under its retention | Upload evidence into the organization, or show it to the claimants |
| With **one** operator: acknowledge, hold longer within the 60-day bound, abort | Start a claim, name a candidate or change the owner of record directly |
| With **two** operators: proceed (T22), name owner channels to exclude for that decision, uphold or reject a contest | Skip or shorten a notice, a wait or the final 7 days, or waive payment; exclude the owner's last channel |
| | Override owner tier-1 proof, or proceed after one in the same claim or for 30 days after |
| | Modify the owner's person account (sessions, passkeys, emails). Exclusion applies to this claim only. |
| | Act on a claim in which the operator is a member, the candidate or the owner |

A two-operator decision is two separate step-up-authorized actions by different internal accounts: the first proposes, with a reason category and a free-text reason, and the second approves within 72 h, or the proposal lapses. Each records its reasons. An exclusion names only channels that disputed this or an earlier claim, and records why support believes someone other than the owner controls them.

**Legal process** (a court order or a liquidator's appointment) is not an in-product path in v1; counsel decides how 3sln.me responds (BG-8).

**Reconciliation with earlier stances** (BG-R1-M5). §5.11 and §12b.4 say 3sln.me adjudicates nothing beyond the stated rules. Track S is a bounded exception: support decides only within this state machine, only in held claims, and never in the seizing direction against tier-1 proof. That reverses a recorded stance, so it needs the user's sign-off (BG-16). The implemented lapse-claim escalation lets one operator let a claim proceed (`orgs.claim-resolve`); under principle 3 its "proceed" should need two operators, and ORG-12d changes it.

### 12d.9 Organization recovery-file reissue where it is missing

The owner of record can already reissue the file (`POST /api/orgs/{id}/recovery-file`, a fresh step-up, rotating the signing key under P15). What is missing is a defined **missing** state, and stronger checks, because the file carries the organization's private keys.

- **States.** `recovery.state` is `issued`, `rotation-pending` or `missing`. Any change of owner (transfer, lapse claim, break-glass, reinstatement or file recovery taking effect) moves it to `rotation-pending`, then to `missing` once the old binding is cleared, until the new owner reissues. An organization whose creation file was never confirmed is `missing` too (the UX pass F-1 banner).
- **Who sees it.** The owner gets a persistent banner and an activity item until a file is saved. Admins see only "No current recovery file", never the file. Moves are impossible until a file exists and has aged 7 days (P14). So authority from a break-glass change, or a reinstatement, counts as move authority only after it has taken effect, the 90-day cooling has passed, and a new file issued under it has aged 7 days. The spec deliberately does not state this: it is internal ordering an outside verifier cannot observe (review BG-R1-M7).
- **Who may reissue.** Only the unheld owner of record, with a fresh step-up **using a credential enrolled at least 7 days earlier** (P18 item 1, new here). Every admin is notified.
- **After a recent security change.** If the owner's person account had a security change in the last 30 days (P18 item 2), a reissue that would replace an `issued` file is refused until 30 days after the change. When the state is `missing` after a change of owner, the new owner passed tight verification to get there, so the reissue is immediate. (BG-R1 Low cut the 72 h objection delay drafted here; the P18 checks cover it.)
- **During a claim,** a reissue by the owner is an owner-interface action, so it aborts the claim (T14).
- **A reissue is not an authority reset.** It does not raise the organization's `aep`, as for persons (§13.2 ORG-2/3 note).
- **Admins and operators can never reissue.**

### 12d.10 Alternatives considered

| Alternative | Verdict |
| --- | --- |
| **Support decides everything** (a manual ownership change on request) | Rejected. It makes operators the single point of failure, invites social engineering, does not scale, and contradicts principle 3. |
| **An admin majority takes effect at once or after a short delay** | Rejected. It is silent seizure against an owner on holiday, and it contradicts the owner outranking admins. |
| **Lapse claim only** (wait until the owner stops paying) | Insufficient on its own. Cards renew, an annual plan lasts a year, and the organization degrades to read-only on the way. It stays, and is preferred when it applies. |
| **Threshold escrow of the organization file** (Shamir shares among admins) | Deferred. The owner must opt in beforehand, so it does not help organizations that are already stuck. Share custody is new key material to protect, and any M admins could recover silently unless the same delays apply. |
| **Designated successor** (the owner names one at a calm moment, plus an inactivity trigger, like an inactive-account manager) | Deferred, and recommended as the first follow-up. It is the owner's own pre-consent, so a later version could let a designated successor use Track A with no quorum. It does not help organizations without one (BG-12). |
| **Accepting a file-less claim with the owner's person recovery file** | Rejected (P18). That file is what someone who took over the owner's account is most likely to hold. |
| **DNS proof for domain-anchored organizations** | Later (§5.11). It needs custom-domain issuers first. |
| **Legal process only** | Off-platform. It is slow and jurisdiction-bound, and it does not suit a sole proprietor's small company. Kept as the remedy of last resort (§12d.8). |
| **Owner tier-0 abort always final, even after support** | Rejected. An attacker with one stolen device could block recovery forever. After a two-operator decision, a tier-0 dispute still stops the effect but returns the claim to support, and only tier-1 proof ends it outright. |
| **Support excludes channels, which then cannot stop the effect** (the first draft, following portability §6.1a's removal of disputers) | Rejected after review BG-R1-H1. In the person-move model only the requester's own tier-1 proof removes disputers; here two operators would be enough to take an organization from an owner who has only email. An excluded channel's dispute still stops the effect; it only demands a fresh operator pair. |

### 12d.11 Provisional decisions for the user

Each is **Provisional (coordinator), not signed off by the user.** Implementation may proceed on them behind the default-off flag, and each stays revisable.

| ID | Decision | Recommendation |
| --- | --- | --- |
| BG-1 | A third explicit exception to "no timeout decides": Track A takes effect by itself after 30 days if nothing stopped it. | **Adopt.** The alternative, support deciding every claim, makes operators the weak point and is slower for the common case of a departed owner. The 30 days, the multi-channel notices, the liveness hold and the 90-day contest bound the risk. |
| BG-2 | Timers: 7 + 7 days to gather, a 30-day Track A wait, a 60-day Track S wait, a 7-day final notice, 30/60-day support bounds, a 90-day contest window and move cooling, a 30-day lock, and Track S for 180 days after an owner abort. | **Adopt.** 30 days exceeds most holidays and matches the security-change lookback. 90 days covers a long hospital stay. |
| BG-3 | Quorum is two eligible 3sln.me-homed admins with 30 days' tenure; foreign admins can only object in v1. A single admin, or members when no admin is effective, go to Track S. Any objection sends the claim to Track S. | **Adopt.** A majority rule would let a coalition among many admins move faster than a lone objector could react; objection-to-support gives every admin a veto on the self-running track. |
| BG-4 | The candidate pays before the wait starts. A claim that ends without effect is refunded in full; fees are absorbed. | **Adopt.** It applies the user's transfer rule and makes harassment cost something. |
| BG-5 | Any interactive owner sign-in or step-up during the wait or the final notice holds the claim for support, even without an abort. Track A also needs 30 days without an interactive owner sign-in before the claim, and emails on admin-controlled domains do not count as channels. | **Adopt.** An owner who is present must never lose ownership by inattention. |
| BG-6 | At effect, the former owner stays a member, with governance powers held (cause `break-glass`). | **Adopt.** It is safe if their account was compromised and recoverable if not. |
| BG-7 | During the contest window the new owner cannot transfer, delete or move, and the former owner's membership cannot be removed. Acceptances that narrow or remove GM grants wait until the window closes; other decisions take effect at once. | **Adopt.** A departed admin's grant waits 90 more days, but a gone admin does no harm meanwhile, and a reinstatement could not undo a purge. |
| BG-8 | Support: one operator can hold or abort; two can proceed or exclude channels; nobody overrides tier-1 proof; no operator-started claims or legal-process path in v1. | **Adopt.** Counsel should look at legal process before public organizations (ORG-13). |
| BG-9 | A held owner may abort a break-glass claim with tier 0 (unlike file recovery, §1d item 4). | **Adopt.** The claimants hold no evidence, so the safe direction wins, and abuse is routed to support. |
| BG-10 | No evidence is uploaded into the product. Support keeps it out of band. | **Adopt.** It keeps special-category data out of organization storage and audit. |
| BG-11 | The owner's recovery-file reissue needs an aged credential and notifies admins. Within 30 days of a security change on the owner's account, a reissue that would replace an existing file is refused. A reissue from the `missing` state after a change of owner is immediate. | **Adopt.** The file holds the organization's private keys. |
| BG-12 | Designated successors and threshold escrow are deferred. | **Defer**, with designated successor as the first follow-up. |
| BG-13 | Contest within 90 days, without needing membership. An upheld contest is a reinstatement, not a transfer: no checkout first, a 14-day grace to set up billing, the former owner's unused time refunded or credited, and the break-glass owner's refund at support's discretion. | **Adopt.** The transfer billing rule is for voluntary hand-overs; making a wronged owner pay first would let a seizure stand. |
| BG-14 | File-based recovery (§5.11) stays a separate, later slice (ORG-12f), which must implement the freeze and precedence rules of §12d.7 against this machine. | **Adopt.** Rebuilding it here was gold-plating (BG-R1 Low). |
| BG-15 | Before any support decision, every tier-0 abort aborts. After a two-operator decision to proceed, any tier-0 dispute (including from an excluded channel) stops the effect and returns the claim to support; an excluded channel's dispute needs a new operator pair; support can never exclude the owner's last channel. Only tier-1 proof ends a claim outright after a decision. | **Adopt.** The owner can stop the effect from any known channel at any point, as required, while one stolen device can only cost support time. |
| BG-16 | Track S makes support an adjudicator inside this machine, reversing "3sln.me adjudicates nothing" (§5.11, §12b.4). The lapse escalation's single-operator "proceed" becomes two-operator. | **Adopt.** Without it, organizations with one admin, no admins or a contested owner have no path at all. |
| BG-17 | Counted limits: a claim counts toward the yearly limits only once paid or aborted by the owner; expired held claims never count or lock. Voluntary withdrawal deducts the processing fee from the refund. | **Adopt.** It stops rogue admins burning a legitimate recovery's quota, and stops support delays killing claims. |

### 12d.12 Implementation plan

Engine-first: every operation is an ngin Action or Query in `packages/app/domains/orgs.mjs`, dispatched in the organization's single writer. HTTP and UI are thin adapters. Everything sits behind a new default-off flag, and nothing widens an existing rule.

**Flag** (a row for the flags owner to add to `packages/flags/registry.mjs`):

| Flag | Class | Dimensions | Requires | Notes |
| --- | --- | --- | --- | --- |
| `ORG_BREAK_GLASS_ENABLED` | a | G A | `ORGANIZATIONS_ENABLED` | crit, stateful. The subject is the organization's account. It gates **starting** a claim and the **effect**. With it off, pending claims stay pending and cannot take effect; aborts, withdrawals, objections, support holds and aborts, and refunds are never gated (abort is the safe direction). Production gates: `termsAndPrivacyApproved` (organization terms disclose break-glass), `notificationTransportsVerified`, `securityRedTeamFindingsResolved`, `realBrowserFlowsPassing`, plus the hash-chained organization audit. |

**Slices** (non-overlapping write ownership):

| Slice | Scope | Files (proposed) |
| --- | --- | --- |
| ORG-12a [S] | **Implemented locally 2026-10-23 (provisional).** **Claim engine.** A pure transition function over the §12d.5 table, plus the service: rows `org/claim/<id>` and the existing `org/due/…` time index, eligibility, quorum, tracks, timers, locks and limits, and the effect commit. Extracts the shared owner-change commit from the transfer effect (one hunk in `ownership.mjs`), so transfer, lapse, break-glass, reinstatement and file recovery use the same commit. | new `packages/orgs/break-glass.mjs`; hunks in `packages/orgs/ownership.mjs` and `packages/orgs/roster.mjs`; operations in `packages/app/domains/orgs.mjs` |
| ORG-12b [S] | **Owner channels, abort tokens and liveness.** A person-side port giving the channel snapshot (kinds and enrollment times, never addresses to the organization), abort-token issue and verify, and a fire-and-forget "owner authenticated" hint from sign-in to the organizations the person owns (like the key-refresh hint, revealing nothing). | new `packages/identity/owner-channels.mjs`; one sign-in hook hunk in `packages/identity/service.mjs` (identity stream owner); `packages/runtime/account/orgs.mjs` hunk |
| ORG-12c [S] | **Implemented locally 2026-10-23 (provisional).** **Billing.** Checkout purpose `break-glass`, reconciliation, the effect's subscription switch, and refunds through the drain lease. | hunks in `packages/billing/organizations.mjs` and `packages/orgs/ownership.mjs` (after ORG-12a's hunk) |
| ORG-12d [S] | **Implemented locally 2026-10-24 (provisional, unsigned; [DEVLOG 2026-10-24 — ORG-12d support adjudication](../../DEVLOG.md)).** **Support adjudication.** The `support.org-break-glass` capability, the case list, two-operator proposals and approvals, and the system operation that applies a decision in the organization's writer. Also makes `orgs.claim-resolve` "proceed" two-operator (BG-16). *2026-10-23: the engine side was done in ORG-12a (`orgs.breakglass-resolve` and `orgs.claim-resolve` enforce two distinct, unconflicted operators, each verified from a single-use, scope-bound operator assertion through the `operators` port).* 2026-10-24: the capability is pinned internal and never delegable in the role catalog; the admin service issues ES256 operator assertions (5 minutes, one use, bound to the operator, the capability, the organization, the process kind and id, the decision and the exclusions) only to administrators holding the capability, after a fresh passkey assertion for each decision, at most 20 decisions per operator per day; the private key is generated in the admin store and kept sealed under `KEY_ENCRYPTION_KEY`, and the organization writer verifies with the published public key plus a durable registry of issued assertions (marked used once) and the operator's current capability. The writer indexes held claims, open contests and escalated lapse claims into the admin store (routing only). Thin routes `/api/admin/org-cases/{list,get,decide,audit}`; console case screens in English and Spanish. Seizing decisions (proceed, reject) are gated by `ORG_BREAK_GLASS_ENABLED` for the organization; the queue, the case, the safe direction and upholding a contest are not (review M2). The independent review's follow-ups (3 Medium, 7 Low) are applied: a revoked or held proposer never counts, reasons stay admin-side as digests, the signer rotates on retire, account objects get only a narrow admin-store client, and each passkey challenge is bound to one decision. Not production-verified. | `packages/identity/{roles,admin,admin-store,operator-assertions}.mjs`; `packages/runtime/admin-org-cases.mjs` (not `routes/`: it mounts beside `admin-flags-http.mjs`); hunks in `packages/orgs/break-glass.mjs` (case index, case view), `packages/runtime/{admin-http,account/orgs}.mjs` and both adapters; `apps/web/src/{bl,ui}/admin-org-cases.mjs` |
| ORG-12e [A] | **UI** (below). | new `apps/web/src/{bl,ui}/org-break-glass.mjs`, `apps/web/src/ui/org-claim-interstitial.mjs`, `apps/web/src/ui/org-claim-abort.mjs`, `apps/web/src/ui/admin-org-cases.mjs`; catalogue entries in `packages/i18n/catalogues.mjs` (en, es); routes in `packages/runtime/routes/orgs.mjs` |
| ORG-12f [S], later | **File-based organization recovery** (§5.11), a separate slice: lifting the organization refusal in the identity recovery path to start the §5.11 72 h flow, never a person-style recovery, and implementing T17–T19 against this machine. | hunk in `packages/identity/service.mjs` recovery path (identity stream owner); its own `packages/orgs/file-recovery.mjs` |
| ORG-12r [S] | **Implemented locally 2026-10-23 (provisional), except the creation-time `missing` state.** **Recovery-file reissue hardening** (§12d.9): the states, aged-credential check, admin notices, delay and objection. | hunks in `packages/orgs/ownership.mjs` (reissue begin/done) and `packages/orgs/creation.mjs` |

Order: ORG-12a → 12b and 12c in parallel → 12d → 12e; 12r can go anytime; 12f after 12b.

**Engine operations** (new):

- Actions in the organization's writer:
  - `orgs.breakglass-start` (`orgs.claim-start` is already the lapse claim's);
  - `orgs.breakglass-accept` (the candidate);
  - `orgs.breakglass-cosign` and `orgs.breakglass-uncosign`;
  - `orgs.breakglass-checkout` (the candidate);
  - `orgs.breakglass-withdraw`;
  - `orgs.breakglass-object`;
  - `orgs.breakglass-abort` (the owner, signed in; tier 0 or tier 1 from the session's step-up evidence);
  - `orgs.breakglass-contest` (the former owner, tier 1).
- System actions:
  - `orgs.breakglass-abort-token` (from the public link route, after token verification);
  - `orgs.breakglass-liveness` (the owner-authenticated hint);
  - `orgs.breakglass-resolve` (an approved operator decision);
  - the sweep extends `orgs.ownership-tick`, with each due entry in its own transaction.
- Queries:
  - `orgs.breakglass` (a role-filtered view: the owner, admins, the candidate, members, each seeing what §12d.8 allows, with the decisions the server would accept now);
  - `orgs.breakglass-cases` (system, for operators, paged);
  - person-side, `orgs.breakglass-notices` (claims where the person is owner, for the interstitial), from a hint row written through a port and confirmed by the organization, as for discovery.
- Routes are thin: `/api/orgs/{id}/break-glass[/<action>]`, the public `/org-claim/abort` (GET confirm, POST abort), and admin `/admin/api/org-cases`.

**Tests.** Mostly engine-level, under `npm test` and `npm run test:organizations`:

- `tests/orgs-break-glass.test.mjs`: every row of the §12d.5 table and every timeout, including at the boundaries; eligibility (tenure, held, foreign candidate and co-signer refused, foreign objection accepted); Track A refused after a recent interactive owner sign-in or with only an admin-domain email; quorum; tracks and the one-way move to Track S; limits and locks; uniform `not_found` for non-members and with the flag off; the effect commit (owner, `aep` +1 exactly once, rotation-pending, former owner held, elevations passed, index moved, cooling 90 days, restrictions); reinstatement.
- `tests/orgs-break-glass-chaos.test.mjs`, seeded chaos with schedules logged for replay. It interleaves claim actions, owner aborts from each channel kind, owner sign-ins, co-signature churn, candidate security changes and authority resets, transfer offers, lapse onset and lapse claims, file recovery start and cancel, deletion scheduling and cancellation, webhook replay, reordering and duplicates, provider outages and stale snapshots, member removal, flag flips, clock jumps and process restarts. Invariants:
  - (I1) the owner of record changes only through an effect or reinstatement commit whose preconditions hold in that commit;
  - (I2) no effect after any tier-0 abort or dispute without a later two-operator decision (by a new pair after an excluded channel's dispute), none ever after tier-1, and never with every owner channel excluded;
  - (I3) the `aep` rises exactly once per effect or reinstatement, and never otherwise;
  - (I4) every paid claim that did not take effect is refunded exactly once;
  - (I5) at most one ownership process takes effect per owner of record;
  - (I6) notices to every recorded owner channel are enqueued before the wait starts;
  - (I7) every transition has exactly one audit entry;
  - (I8) no single operator action reaches `final` or `effective`;
  - (I9) a held claim never takes effect;
  - (I10) the flag off never blocks an abort, withdrawal or refund.
- Adversarial cases, each a named test:
  - a full admin coalition against a live owner (abort, then a restart that goes to Track S);
  - a stolen owner device aborting repeatedly, then support exclusion, a further dispute needing a new operator pair, then the real owner's tier 1;
  - two operators excluding an email-only owner's only channel (refused);
  - unpaid claim spam trying to exhaust the yearly limit (uncounted);
  - a held claim expiring (no lock, no count);
  - a session refresh from the owner's device (not liveness);
  - an admin probing the owner's activity (no cause visible);
  - an attacker holding the aged passkey (tier 1 ends the claim; no support override);
  - a single operator trying to proceed;
  - an operator who is a member;
  - a proposal approved by the same operator;
  - a co-signature from a foreign admin (refused; objection accepted);
  - a claim racing a transfer payment;
  - a lapse claim racing break-glass;
  - abort-token replay, a scanner GET and an unknown token (identical responses);
  - harassment beyond the limits;
  - a candidate taken over during the wait;
  - an owner who renews during the wait (no abort);
  - an owner with no channel (Track S);
  - a chargeback after effect.
- Runtime and browser:
  - `tests/orgs-break-glass-runtime.test.mjs`: Node routes, CSRF, the abort page and headers;
  - `tests/browser/org-break-glass-browser.mjs`: Chromium and Firefox, en and es, light and dark, 320 and 1440 px, keyboard and accessibility;
  - a Worker parity run for the claim rows under `npm run test:worker`.

These are loopback fixtures and an offline Polar model. They show local behaviour, not notification delivery or provider conformance.

**UI surfaces** (a one-question wizard style, the 3sln stack, light and dark):

- **Organization console, ownership panel: "The owner is gone?"** It first offers the alternatives that apply (contact the owner; a transfer if they can act; the lapse claim if read-only; file recovery if someone holds the file). Then it asks one question per step: the candidate, the reason category, the statement, and a review that states the 30-day wait, notices to the owner, the owner's right to abort, the 90-day contest and the refund rule.
- **Co-signature requests** appear in other admins' activity centres, with co-sign and object.
- **Candidate checkout disclosure:** the transfer disclosure, plus the abort and contest terms and "refunded in full if this does not take effect".
- **Claim timeline,** for everyone with access: state, track, the earliest effect date and who signed, without channel details.
- **Owner:** email and push notices; a full-screen **interstitial** on sign-in ("Someone is claiming ownership of Acme. ⟦Stop this claim⟧ ⟦Contact support⟧"); an activity item; and a no-sign-in abort page (confirm, then done).
- **Members:** a banner in the member view.
- **Former owner after effect:** a notice with a contest entry, which needs sign-in and an aged credential.
- **Admin console** (operators): a case queue, case detail, a proposal form and second-operator approval.
- **Recovery-file banner** for the `missing` state (§12d.9).

**Before production** (security.md and DEVLOG gates). Status as of ORG-12d, 2026-10-24 (coordinator's reading, provisional; "met locally" means implemented and tested on loopback, never production-verified):

| Gate | Status |
| --- | --- |
| **Verified operator identity** for every support decision | **Met locally (ORG-12d).** The admin service's ES256 signer and the durable operator registry replace the HMAC test double; the engine refuses forged, replayed, mis-scoped and unregistered assertions, non-capability and password-stepped-up administrators. Still open for production: key custody review (the sealed key lives in the admin store under `KEY_ENCRYPTION_KEY`), key rotation tooling, real WebAuthn evidence, and operator onboarding procedure. |
| **Two distinct humans** behind every two-operator decision | **Open (procedural).** The engine and the admin service enforce two distinct operator *accounts*, each with its own passkey assertion bound to the decision. That is a two-person rule only if boot onboarding binds each operator account to a different human and a different authenticator; nothing technical stops one person enrolling two operator accounts. Production needs an onboarding procedure (and its audit) that guarantees this. |
| The hash-chained organization audit | **Partly met.** The organization audit and the admin audit are hash-chained; no external anchor exists. |
| Verified email and push delivery | **Open.** Provider acceptance is recorded, delivery is not verified. |
| Organization terms and privacy text for break-glass and support's evidence handling (ORG-13, counsel) | **Open.** |
| An independent security review of ORG-12a–d | **Open.** ORG-12a–c had independent reviews; ORG-12d has had none yet, and no review has covered ORG-12a–d together. |
| Real-browser verification | **Partly met.** The owner, admin and abort-link flows run in Chromium and Firefox; the operator case screens run in the real admin shell with a real passkey step-up, but against fixture case routes (no seeded held claim through the Worker). |

Until every gate is met the flag stays off outside loopback.

## 13. Implementation slices (later)

Engine-first: every operation is an ngin Action or Query in a domain module, dispatched in the organization's account single writer (the same `createAppEngine` placement as persons). HTTP and UI are thin adapters. Tests are mostly engine-level, with seeded chaos for membership races, revocation fencing and intersection properties ("effective ⊆ every ceiling" for random grant sets).

### 13.1 Flags (`packages/flags/registry.mjs` rows, default off; owned by the flags agent when added)

| Flag | Class | Dimensions | Requires | Notes |
| --- | --- | --- | --- | --- |
| `ORGANIZATIONS_ENABLED` | a | G A | — | crit, stateful. The subject is the organization's account, or the creating person for creation. It gates creation and exposure, never existing organizations' severance or export. |
| `DIRECTORY_ENABLED` | c | G | — | crit. Publishes `directory.v1` (handle lookup and identity documents). Global protocol surface. |
| `MEMBER_CERTIFICATES_ENABLED` | a | G A | `DIRECTORY_ENABLED` | crit, stateful. 3sln.me as a **home** provider issuing member certificates, with consent records and status. The subject is the member's account. Revocation and status stay available when it is off. |
| `ORG_FOREIGN_MEMBERS_ENABLED` | a | G A | `ORGANIZATIONS_ENABLED` | crit, stateful. Verifying certificates from **other** issuers, which means outbound directory fetches. It is the kill switch for that SSRF surface; same-host members keep working. |
| `ORG_BREAK_GLASS_ENABLED` | a | G A | `ORGANIZATIONS_ENABLED` | crit, stateful. Rev 5.5, §12d.12: gates starting a claim and its effect; aborts, withdrawals, objections, support holds and refunds are never gated. |
| `ORG_RELATIONS_ENABLED` | a | G A | `ORGANIZATIONS_ENABLED`, `DIRECTORY_ENABLED` | crit, stateful. Relation documents, instances, entity certificates and imports. Cross-provider use is also behind the foreign-issuer allowlist (R2-M6). Rev 5.6: narrowing, leaving, inbound revocation and export are never gated (§8b.10). |
| `ORG_FOREIGN_RELATIONS_ENABLED` | a | G A | `ORG_RELATIONS_ENABLED`, `ORG_FOREIGN_MEMBERS_ENABLED` | crit, stateful. Rev 5.6 (§8b.10): the kill switch for relations' outbound fetches and posts to other providers and for accepting foreign redemptions and certificates. Local narrowing keeps working; outbound revocation events queue while it is off. |

### 13.2 Slices and ownership (non-overlapping; IDs ORG-#)

| Slice | Scope | Files (proposed) | Phase |
| --- | --- | --- | --- |
| ORG-0 [S] | **Power resolver seam.** Owner routes pass `{actor:{principal, entity, powers, authTime, epoch}}` instead of an implicit owner. For a person acting as themselves the result is unchanged. **Status (2026-10-23): implemented locally, behind no flag (behaviour-preserving); unreviewed.** The router builds the actor (`epoch` = the person's `security.epoch`, see the note below the table); `AccountController.dispatch` and the organization slice re-resolve powers inside the writer and ignore caller-supplied powers; operations declare `static entities` (default person-only). Engine-dispatched owner routes carry the actor; named account RPC methods still take the owner id (= the entity id). | `packages/runtime/routes/*` owner adapters (integrator), new `packages/orgs/authority.mjs` | A |
| ORG-1 [S] | **Organization entity.** Account kind, creation, rename, kind label, keys, deletion (delayed). **Status (2026-10-23): implemented locally behind `ORGANIZATIONS_ENABLED` (default off); unreviewed; not production-verified.** Identity record `kind:'organization'` with an allocated handle, keys in its own writer, a v2 recovery file at creation through the identity-backup port, every interactive and recovery path refused; creation is a resumable, idempotent sequence (reserve → identity → initialize → file → confirm) with the paid check as a port (production: an operator allowlist that fails closed); owner of record = creator, initial admin = creator until ORG-2; rename, kind label, 30-day delayed deletion (provisional) that holds at `deletion-due` until a purge executor hand-off is wired. Organization moves stay refused by the existing portability guards. | `packages/identity/organizations.mjs` and `service.mjs` guard hunks; `packages/orgs/{organizations,creation}.mjs`; `packages/app/domains/orgs.mjs`; `packages/runtime/{account,routes}/orgs.mjs`; `tests/orgs-{entity,runtime}.test.mjs` | A |
| ORG-2 [S] | **Membership.** Invitations (link type), accept, leave, remove, expiry sweep, the admin power, last-admin guard, `member-removed` outbox. **Status (2026-10-23): implemented locally behind `ORGANIZATIONS_ENABLED`; unreviewed, not production-verified.** Subject-first GM consent/elevation, configurable response period, epoch-bound holds and a durable retryable notice outbox are included; see the ORG-2/3 integration note below. | `packages/orgs/{memberships,invitations}.mjs`, `packages/runtime/account/orgs.mjs`, `tests/orgs-*.test.mjs` | A |
| ORG-3 [S] | **Member grants and the evaluator.** Effective authority as a pure function. Hooks into RPC authorization and the preferences projection. **Status (2026-10-23): implemented locally; unreviewed, not production-verified.** Per-resource live intersection, generation fences and derived `effective_methods`; configured account-writer port, with certificate/proof authentication owned by ORG-4. | `packages/orgs/grants.mjs`; one hook in `packages/federation/service.mjs` (serialized after X8 owners) | A |
| ORG-4 [S] | **Member certificates and member context.** Issuance as home (the `key-delegation.v1` profile, consent per (organization, client), `aep`, status), verification, the token form, the `BindleMember` direct form, `bindle_member`, uniform failure. | `packages/identity/delegation.mjs` hunk (IDKEYS stream owner), new `packages/orgs/certificates.mjs`, one token-endpoint hunk in `packages/federation/*` (after the current editors) | A |
| ORG-5 [A] | **Console.** Context switcher, members, grants, audit, invitation acceptance page, organization context for the existing connections and preferences UI. **Status (2026-10-23): implemented locally, unreviewed, not production-verified.** Console and encrypted creation recovery-file flow; member discovery, role-filtered request discovery and organization-context connections/preferences adapters (see the ORG-5 note below). No existing authorization rule was widened. | `apps/web/src/{bl,ui}/org-*.mjs` (after the current apps/web streams) | A |
| ORG-6a [A] | **Minimal acquisition** (3sln.me app feature). A top-level consent page at 3sln.me that issues certificates to the app's holder key, and an SDK helper. **Status (2026-10-23): implemented locally, unreviewed, not production-verified.** Explicit popup consent at `/console?member_certify=1`; exact registered redirect validation, holder PoP and origin/source/state-bound message delivery. Existing consent and issuance are separate account operations; consent survives a failed issuance. | `apps/web/src/{bl,ui}/certify-*.mjs`, `packages/sdk/src/member.mjs` | A |
| ORG-6b [A] | **Islands and elements.** Silent acquisition in the island, the entity section, events, components-profile update. | `apps/embed/src/parts/account-switcher.mjs`, `packages/sdk/src/elements/*`, `docs/profiles/components-v1.md` | B |
| ORG-7 [S] | **Directory profile** (`directory.v1`, spec §3a). Publisher routes; a verifier with SSRF-safe fetch, budgets, caching and continuity pinning, implementing the `resolveIdentityKey` directory hook. Shared with Parlay and links. | new `packages/identity/directory.mjs`, new `packages/runtime/routes/directory.mjs`, `tests/directory*.test.mjs` | A |
| ORG-8 [S] | **Member-scoped fragment fields.** | `packages/federation/schema.mjs` hunk, `packages/orgs/member-fields.mjs` | B |
| ORG-9 [A] | **Templates and drift view.** | `packages/orgs/templates.mjs`, console | B |
| ORG-10 [S] | **Same-provider relations.** Relation-document validation (artefact class), instances and participation, invitations and joins, edges as fragment grants, entity certificates, imported resources, upgrade and leave, bus `entity` kind, `audit-log/v1`, the generic `share` relation. **Rev 5.6:** designed in §8b and split into ORG-10a–g (§8b.10). The file names are revised there, because `packages/orgs/certificates.mjs` already holds member certificates. **Status (2026-10-26): ORG-10a–g implemented locally behind default-off flags, with the provisional replacement-invitation upgrade reconciliation in §8b. Same-instance per-edge upgrades and entity bus doorbell forwarding remain; unsigned and not production-verified.** | §8b.10 | C (implementation may start behind the flag, RL-1) |
| ORG-11 [S] | **Cross-provider relations** (invitations, joins, entity certificates and SETs between providers, over ORG-7). Integrates the artefact-references cache. **Rev 5.6:** split into ORG-11a–c (§8b.10), including a clean-room conformance peer. | §8b.10 | D (implementation may start behind the flag, RL-1) |
| ORG-12 [S] | **Export, break-glass, critical-action delays, change of control.** Rev 5.5: break-glass and recovery-file reissue are designed in §12d, split into ORG-12a–f and ORG-12r (§12d.12). Export and critical-action delays stay here, undesigned. | `packages/orgs/{export,recovery}.mjs`; break-glass files per §12d.12 | B/D |
| ORG-13 | **Legal.** DPA, organization terms, privacy section (counsel). | `docs/legal/*` | before public organizations |

*ORG-0/ORG-1 implementation notes (2026-10-23, Provisional (coordinator), not signed off by the user):* (1) the actor's `epoch` remains the person's `security.epoch` for the old monotonic fence. ORG-2 separately carries `aep`, with the narrower source defined below; routine credential changes do not trigger the governance hold. (2) Scheduling deletion needs the owner of record with a fresh (15 min) authentication; cancelling needs the owner of record or an admin and is never flag-gated. (3) At most 10 organizations per creator (open reservations included). (4) The organization file is returned once by the creation response; client-side passphrase encryption (R4-M5) and the console belong to ORG-5. (5) The organization account is excluded from the inactivity lifecycle (`review-required`).


#### Organization billing and ownership transfer, 2026-10-23 (provisional coordinator work)

Reviewer: ___ Date: ___ Outcome: ___ . These are unsigned implementation choices. DEVLOG.md was not edited under this workstream's instruction. Implemented locally behind `ORGANIZATIONS_ENABLED`, with billing only in the Polar sandbox. Not production-verified; no live payment.

- **Catalog and checkout (ORG-D18, §12a).** Three provisional tiers, up to 100 TB, with AI credits ([billing deployment](../deployment/billing.md#organization-plans-sandbox-only-provisional)), in `packages/billing/organizations.mjs`. The organization account is the Polar customer. Checkout metadata binds the paying person, the purpose and the binding. Creation reserves the UUID unpaid when organization billing is configured, and resumes only on a verified `create` payment bound to the request (`orgs.creation-checkout`, `orgs.creation-payment`). The allowlist port is replaced by `organizationEntitlementPort`, which keeps `ORGANIZATIONS_PAID_ALLOWLIST` as the operator override.
- **Standing and lapse (§12b.3, §1d item 1).** `paid`, `pending` (not yet reconciled), `grace` (agent figure: 14 days after the paid-through time) and `read-only`. A failed renewal never extends the paid-through time. Read-only refuses invites, policy, rename, label, widening grant changes and widening organization-context operations. Leaving, removals, narrowing, decisions and export stay open. After 30 days read-only, an admin other than the owner may claim by paying. The claim takes effect 72 h after it is paid unless the owner pays. A transfer verified during the claim closes the claim. A closed paid claim is refunded in full (agent choice).
  - *Review fixes, 2026-10-23 (provisional, not signed off).* A tracked subscription is verified against the amount and currency of its first verification, never against today's catalog, so archiving or repricing a catalog price cannot make a paying owner unpaid. Only a void, a full refund or a refund of at least the order's net amount counts as unpaid; a partial refund does not. A tracked subscription Polar no longer returns, or that fails verification, is **held**: its stored state is kept, an operator alert is raised (lifecycle log, `organization-billing`), and while any hold exists the unpaid clock does not start, no claim can start and a pending claim cannot take effect. A transfer or claim takes effect only in a step whose provider snapshot is at most 5 minutes old; otherwise the step retries. An owner payment begun before the claim's deadline always defeats the claim, even when it is confirmed later: the claim waits for a fresh snapshot, and for up to 2 days for an uncaptured owner order to settle. Of several paid owner payments, the current renewal binding (else the first paid) is kept and the rest are refunded. When an ownership change takes effect, every live subscription of the previous owner is revoked, including one the last reconcile could not see.
  - *Wargame fixes, 2026-10-23 (provisional, not signed off; details below).* A held owner of record may still renew (paying confers no governance). A claim whose deadline passes while an admin's objection keeps the owner held is escalated to an operator instead of taking effect. Only live or held subscriptions count toward the reconcile limit, and settled ones are forgotten. A claim checkout is reused for the same admin and terms and rate-limited. A new subscription failing verification is held like a known one. The paid check reads the current period's order.
- **Transfer (ORG-D21, §12b.3a).** As specified, with these implementation details:
  - The offer needs P18 tight verification from the session's step-up evidence. A security change in the last 30 days returns the admins' block until that cooling ends.
  - The recipient must be an active 3sln.me person account, resolved from the handle and confirmed. Admins and the recipient get notices, and admins may object.
  - Figures: a 24 h minimum and a 14-day lapse. One offer at a time; the owner may withdraw until payment is verified. The recipient accepts with a fresh step-up and the disclosure digest (plan, price, fresh period, previous payment confers nothing). The checkout is created by the recipient's account.
  - The effect comes only from a reconciled, captured first order, in one record commit. The owner changes; a membership is created if missing, with any offered `admin` under the 72 h delay. The previous owner's subscriptions are revoked at once with no automatic refund. Recovery rotation is queued, the 30-day move cooling is set, and notices and the hash-chained audit are written.
  - Elevated requests pass to the new owner unchanged, because decide derives the current owner. The previous owner stays a member.
  - A withdrawn, lapsed, blocked, declined or failed transfer that was paid, or any unbound payment, is revoked and refunded in full exactly once.
  - Deletion closes an unpaid offer and is refused while a verified transfer is pending.
- **Recovery file.** At the change, the ownership outbox clears the organization's recovery credential on the identity record (`organizationIdentityPort.invalidateRecovery`: recovery hash, file id and version removed, security epoch bumped), then rotates the signing key; the state becomes `missing` only after that write, so the previous owner's file no longer works (recovery file v3, 2026-10-28: files hold no keys, so the rotation alone no longer invalidates one). The new owner reissues a file from the console (`POST /api/orgs/{id}/recovery-file`). Residuals: copies of past private keys in the old file cannot be recalled, and the encryption key is not rotated. Organization recovery (break-glass) is still phase B. The unused recovery-freeze hook (`recoveryClaim`) was removed on 2026-10-23 because no design defines its record, its states or who sets it; the freeze rule in §12b.3a ("A recovery started while an offer is open freezes the offer") is to be implemented with phase B recovery, not before.
- **Console.** Offers addressed to the person (index hints, each confirmed by the organization), creation checkout, and the owner/admin ownership panel: offer, withdraw, object, block, renew, claim and reissue. Navigation goes only to `sandbox.polar.sh`. Discovery roles now follow the organization's live answer.
- **Verification:** engine tests with seeded chaos (transfer vs. removal vs. deletion vs. billing lapse vs. webhook replay, and partial provider faults) in `tests/orgs-ownership.test.mjs`; billing module tests in `tests/billing-organizations.test.mjs`; a Node runtime end-to-end test in `tests/orgs-ownership-runtime.test.mjs`; a Chromium/Firefox, en/es, light/dark, 320/1440 px loopback matrix in `tests/browser/org-ownership-browser.mjs`. These use loopback fixtures and an offline Polar model, not provider conformance.

#### ORG-5 discovery and organization context, 2026-10-23 (provisional coordinator work)

Reviewer: ___ Date: ___ Outcome: ___ . Unsigned implementation choices; DEVLOG.md was not edited under this workstream's instruction.

- **Member discovery (ORG-D9).** The person's own account keeps hints (`orgs/joined/<org>`, at most 256, beside the owner-of-record index). `GET /api/orgs` asks each hinted organization's writer, as that person, for `orgs.membership` (the person's own view) and lists only organizations that confirm a live membership. Non-members, ended or expired members, disabled organizations and unknown ids get the same `not_found`, so a stale or invented hint discloses nothing. Hints are written by the acceptance adapter and dropped on leave; memberships accepted before this change are not rediscovered until a new acceptance. A transient organization failure lists the row as unavailable rather than hiding or failing the list. Order is by name, then id (§9.3).
- **Request discovery.** `orgs.requests` returns open grant-management requests where the member is the subject, the requester, or the owner of record of an elevated request (subject first, §12b.2a), each with the decisions `decide` would accept now. The decisions function mirrors decide's rules and its commit guards (owner of record cannot be removed; never without a permanent active admin). Not flag-gated, like `decide`; admins still see every request through `orgs.members`. The console renders only server-advertised decisions.
- **Organization context for connections and preferences.** `orgs.acting-authority` is the single-writer power check (admin; `widen` operations also need `ORGANIZATIONS_ENABLED` and an active organization). Connections run in the organization's writer in the same gate turn as that check; only list, suspend, resume, disconnect and approve exist for organizations. Preferences run in the organization's federation shard: the person's own session is verified there (CSRF on writes), the admin power is resolved by the organization's writer, and the shard then applies its existing rules to the organization's own subject and epoch. Residual: the preferences check and write are in two writers, so a concurrent demotion can race one write. Only `fragment`, `values` and `expectedRevision` are accepted (no shared-consumer updates or settings removal).
- **Deletion fence (review M3).** The member view and requests stay available while deletion is pending; the admin member listing is refused, and the console shows member management as paused with cancellation for the owner or an admin. Reducing app operations (suspend, disconnect) stay available; resume, approve and preference writes are refused.
- **Invitation entry fix.** Signed invitations are redeemed with the whole compact token (`orgs.accept` matches the signed envelope); the console entry previously passed only its `jti`, which the server refuses. The entry and the acceptance form now carry the bounded token (a pasted link supplies routing hints only).
- **Verification:** engine tests with seeded chaos and disclosure comparisons in `tests/orgs-discovery.test.mjs`; Node runtime route tests in `tests/orgs-context-runtime.test.mjs`; console engine tests and a Chromium/Firefox, en/es, light/dark, 320/390/1440 px loopback matrix (keyboard and accessibility checks) in `tests/browser/`. Loopback fixtures, not production conformance.

#### ORG-2/3 local integration, 2026-10-23 (provisional coordinator work)

Reviewer: ___ Date: ___ Outcome: ___ . These implementation choices are unsigned. DEVLOG.md was deliberately not edited under this workstream's explicit ownership instruction.

- **Same-host authority epoch:** `account.aep` on the person's identity, absent = 0 for legacy records; malformed values fail closed. It rises atomically with **recovery completion**, an explicit credential/key reset, or an elevated abort, never with ordinary passkey addition/removal, email changes, file reissue or a recovery merely starting/resuming. Move activation also advances above the attested floor (an adoption is an authority reset). `security.epoch` remains distinct. `packages/identity/authority-epoch.mjs` defines this provisional source; the identity completion/session and elevated-abort integration hunks supply it. The actor's private verification evidence comes from the session's actual step-up credential, not a posted timestamp.
- **Transaction boundary:** the organization's record and its roster rows (origin-principal keyed memberships, single-use signed invitation proposals, GM requests and the outbox) commit in one transaction. Since the 2026-10-23 wargame fixes (F-02, below) each row is its own key and the record keeps only bounded summary state. Creation seeds the creator's membership in the same commit. Each grant records its grantor and time. Same-host acceptance pins the signing public key and explicitly records session authentication (no certification `kid`); certificate acceptance must supply the identity-key pin and certification `kid` through ORG-4's trusted actor. Membership IDs survive rejoining; connection generations do not. Existing ORG-1 records lazily seed the creator, whose historical key provenance is unknown rather than fabricated.
- **Policy:** a newly accepted admin waits 72 h. Existing members can accept a bound invitation adding admin. GM requests go to the subject, remain open after rejection, and only the requester can elevate after rejection or the configured response period. There is no resolution timer. Owner approval requires a fresh 5-minute step-up, a credential at least 7 days old and no security change for 30 days; subject consent requires fresh authentication. Owner-as-subject cannot be elevated; pending elevated requests derive the current owner at decision time. Rate limits, deduplication and per-member requester mutes apply.
- **Operator/expiry reconciliation (provisional):** an ordinary governance change cannot leave the organization without an immediately active, non-expiring admin. This prevents removing the permanent admin in favour of an expiring replacement. Authority resets can still hold all admins and require re-confirmation/recovery. A due membership expiry that encounters the last-admin/owner membership guard is marked `expiryBlocked` and retried hourly; its expired authority is denied live. The owner must transfer ownership before leaving. These internal safeguards do not move resource ownership.
- **Holds:** an observed higher `aep` persists before governance is refused. Re-confirmation names that epoch; a later reset replaces the hold and its notice window. Another unheld admin can confirm a non-owner, or a 72 h notice can complete unless another admin objects. The owner always follows the notice/objection path. Member resource grants are evaluated independently of the governance hold. Non-epoch reset events are passed by the trusted ORG-4 `observe` port; callers must deduplicate their reset-event delivery.
- **ORG-4 interface:** `membershipEnginePort` in the organization domain and `orgsMembershipPort(controller, owner)` expose `lookup(principal)`, `observe(principal, {aep, reset})` and `context(principal, {client, generation})` as engine operations. They receive verified **origin** principals, never unverified wire assertions. `orgsMemberSnapshot` is the internal account-writer port for the live grant intersection, opaque membership ID, generation and context recipient registration. There is no public membership-check route. The external verifier owns successor resolution, proof/status checks and the complete added-under key evidence.
- **ORG-3 interface:** the federation constructor accepts an `organizations` authority port. The runtime composes `organizationAccountAuthority`; ORG-4 must bind the verified `{principal, membership_id, generation, aep}` (or its nested `membership` equivalent) into `token.member`. Every token load, including dispatch reauthorization, intersects each resource separately. Missing composition refuses member credentials. Both preference projections derive `effective_methods` without grant records; organization-context projections omit it. ORG-4's separate `mc_`/direct certificate authentication must bridge into this credential seam; mounting certificates alone does not establish that bridge.
- **Delivery evidence:** ending a membership changes state and generation and enqueues `member-removed` to the clients that obtained member context in the same commit. All credential readers must check the live generation. `ORGANIZATION_MEMBER_EVENTS(event) -> true` acknowledges the injected at-least-once delivery port, with stable event IDs for deduplication (for a paged fan-out event, 2026-10-24: deduplicate by event id plus recipient id). Without that adapter the durable outbox remains held; delivery, signing of outbound SETs and provider conformance are not inferred. Notices and audit entries are implemented locally; outbound delivery remains a configured external capability. ORG-5 owns the invitation landing/confirmation UI and required pre-acceptance disclosures.
- **Verification:** engine-level membership/evaluator tests, seeded races, signed-envelope checks and real federation RPC/projection tests are in `tests/orgs-{memberships,grants}.test.mjs`. Full gate results are reported by the workstream, not asserted as production verification. No release flag or production gate was widened.

#### Organizations wargame fixes, 2026-10-23 (provisional coordinator work)

Reviewer: ___ Date: ___ Outcome: ___ . A red-team review of organizations found three High and four Medium findings and eight plausible items. These fixes are unsigned implementation choices, behind `ORGANIZATIONS_ENABLED` and the Polar sandbox. They are not production-verified: the regression tests run against loopback fixtures and an offline Polar model.

- **F-01, mute grew the record without bound.** A mute now names a valid principal, which is recorded whoever it is (see the re-review note below). Each member's list holds at most 64 entries, and the mute route follows the flag (§12b controls above).
  - Every stored roster row is held to a 64 KiB budget (`ORG_ROW_BYTES`). A larger change is refused with `member_row_limit` (413), and the whole transaction rolls back.
  - Each member remembers at most 32 app clients (≤ 1,024 characters each) for removal delivery.
- **F-02, one value held the whole roster.** `org/record-v1` exceeded the Durable Object 2 MB value limit near 1,350 members.
  - Each membership, invitation, request and outbox event is now its own key (`packages/orgs/roster.mjs`): `org/member/…`, `org/invitation/…`, `org/request/…`, `org/outbox/{pending,delivered}/…`.
  - Secondary indexes cover membership id, admins, open invitations, and requests by subject, by requester and while open. A time index `org/due/…` drives the sweep.
  - Every operation is still one transaction. A per-transaction unit of work loads only the rows it needs and writes only the rows that changed. The record keeps bounded summary state plus `roster:{v:2, live}` and `outboxSeq`.
  - Joins, decisions, the member's own view and the sweep do the same store work at 100 and 5,000 members (tests/scale/orgs-scale.test.mjs). The largest value stays under 2 KB.
  - A stale request is closed in the commit that changes its subject, not by a sweep scan.
  - Closed invitations and requests, and delivered outbox events, are pruned 30 days after closing (`ORG_RETENTION_MS`, provisional). An event nobody could deliver is dropped after 90 days.
  - The admin listing is paged: 100 members and 100 requests per page by default, at most 500, with cursors `next` and `requestsNext`. The console follows them with "Load more". Requests are read with a bounded indexed query, so the listing's store work does not grow with the roster.
  - The pre-release single-value shape is not migrated: organizations are unreleased.
  - **2026-10-24 (break-glass and ownership outbox scaling; provisional, unsigned; DEVLOG):** the admin index carries each admin's outbox-sequence interval, and two time-ordered admin indexes (unbounded admin grants by grant time per issuer; effective admin grants by `notBefore`) let break-glass eligibility, quorum and "is any admin effective" read only the rows they need, each re-checked. A member outbox event for more than 64 admins no longer lists them: the drain delivers them in pages of at most 256 through a cursor on the event, to exactly the admins of the event's snapshot (an admin removed after the event is remembered until its fan-out ends). The port contract gains `page:{index, final}`. Delivery stays at least once: consumers deduplicate by event id plus recipient (admin) id, because a retried page, or an admin removal racing a page read, can repeat a recipient (an admin removed after a live page covered them is otherwise skipped by a per-page removal counter; review L3). The ownership outbox (§12b) is one row per effect with due/done/claim indexes and a record summary, replacing the in-record `ownershipOutbox` array (migrated once).
- **F-03, an objecting admin could take a held owner's organization.** A held owner could not pay, so the lapse claim succeeded.
  - The owner of record may now renew while held. The ownership view offers them `renew` and no governance decision.
  - A claim reaching its deadline while the owner's hold is objected does not take effect. It is escalated once (audit `organization-lapse-claim-escalated` and an operator alert), stays pending, re-checks hourly and still closes if the owner pays.
- **F-04.** An ownership change clears the new owner's membership `expires_at` and `expiryBlocked`, so the owner of record never loses the power through expiry.
- **F-05, the 17th subscription wedged reconciliation.**
  - The writer re-reads only subscriptions that can still matter: held, not ended, or with a revoke or refund still pending. Revoked or refunded ones are marked `settled` and don't count toward the provider port's limit of 16. The port also caps the total at 64.
  - An ended, settled subscription is forgotten 30 days after it ended, together with its `handled` entry. So is one we revoked or refunded that the provider no longer returns.
  - A claim checkout is reused for the same admin, plan and currency while it is open. At most 4 new claim checkouts are created per organization per day. A replaced claim closes as `superseded`, and a payment on its binding is refunded as unbound.
  - The pinned Polar SDK has no checkout-expiry call, so superseded checkouts are not expired at the provider.
  - A refused reconcile still falls back to the time rules, which never change the owner. A capacity refusal also raises an operator alert (`subscription-capacity`).
- **F-06, one member could exhaust the organization's tokens.**
  - Member-context federation tokens no longer share the shard's 256-token bound with the organization's app tokens. At most 8 live tokens per (membership, client) are kept, and issuing another ends that pair's oldest.
  - The organization-wide bound is the plan's members × 8 (256–65,536), and reaching it refuses.
  - App tokens' bound counts only non-member tokens.
  - Residual: issuing still lists every token row in the shard.
- **F-07, large organizations' keys went stale.** The same-host key cache refresh queue is time-ordered (`org/cert/refresh/<due>/<principal>`), so a run reads only due rows.
  - Discovery covers the whole roster about every TTL/4, with the batch scaled to the roster (64–8,192). The per-run limit scales too (16–128).
  - A member is enqueued at join, at an authority-epoch rise and at same-host certificate issuance, acquisition or consent revocation (a fire-and-forget hint to the organization that never reveals membership).
  - LM1 changes from "no request-path write" to a uniform enqueue. Any syntactically valid claimed principal whose cached keys are missing or stale is enqueued, member or not. Request-path entries are bounded at 256; member entries at the roster size + 256.
- **Plausible items.**
  - (1) Each outbox event retries on its own back-off (1 minute doubling to 6 hours), so failures never block later events.
  - (2) Ending a membership also closes the open requests that member made.
  - (3) A new organization subscription failing verification is held with an operator alert.
  - (4) The paid check reads the order for the current period, so an earlier period's refund no longer marks a renewed subscription refunded.
  - (5) The membership port reads expiry on the writer's injected clock.
  - (6) The audit read is a bounded page (≤ 200, `before` cursor) that reads only the rows it returns.
  - (7) `MemberContextService.token()` counts only live rows, and its cleanup is never rolled back by a refusal.
  - (8) A claim is judged on the standing of the record it commits.
- **Review follow-ups (independent review of these fixes; provisional).**
  - (1) A request-path ('claimed') refresh never stores a negative key row. Every key row is indexed by expiry and pruned by the background run and the sweep. The claimed queue is bounded with eviction of its oldest entry.
  - (2) The mute cap is checked before anything depends on the requester. After re-review, any valid principal is stored, so mute and unmute do identical work for members and non-members, and the list's length reveals nothing.
  - (re-review) The pinned Polar SDK (1.0.2) takes no idempotency key on `refunds.create`, so `drainOwnership` holds a 10-minute lease (`org/ownership-drain-lease`). An overlapping run backs off, so a refund is created once per order.
  - (3) The request path only remembers the claimed principal in memory. The cache check and enqueue run in the background run after the uniform answer, so the request path writes nothing.
  - (4) Claim-checkout reuse and the daily limit are re-checked in the commit; a concurrent same-terms start returns the committed claim.
  - (5) At most 16 live member tokens per membership across its clients (the oldest evicted). The organization bound is the plan's members × 16. A refusal still commits the expired-token pruning.
  - (6) An escalated claim closes after 30 days (`escalation-expired`) with every order of its subscription refunded. Ownership refunds now refund every order of the subscription. An operator can close the claim or let it proceed (system operation `orgs.claim-resolve`, account RPC `orgsClaimResolve`). A held owner's view carries billing and `renew` only.
  - (7) Each sweep entry runs in its own transaction, and a failing entry backs off (1 minute doubling to 6 hours) without stalling the rest.
  - (8) `memberById` checks the row's id. Remembered app clients are least-recently-used (no lockout after 32). The runtime verifier and its key cache use the writer's injected clock.
- **Invitation preview and withdrawal (2026-10-23, provisional).**
  - `orgs.invitation-preview` (`POST /api/orgs/{id}/invitation-preview`) returns the organization's name, kind and handle from its own record. It answers only for a pending, unexpired, unrevoked invitation the caller could accept, at an active organization with the flag on. Everything else, including an unknown organization, is the same `not_found`. The join screen shows the name instead of the earlier "appear once you join" note.
  - `orgs.invitation-revoke` (`POST /api/orgs/{id}/invitation-revoke`, admin) closes an open invitation as `revoked`. It is pruned like other closed invitations, and accepting it fails as `invitation_invalid`. It is a reducing operation, open during a ramp-down, a lapse or a pending deletion. The share view has a Withdraw link button (English and Spanish).
- **Verification:**
  - Engine-level regression and seeded chaos tests, each confirmed to fail when its fix is reverted: tests/orgs-wargame.test.mjs, tests/orgs-invitations.test.mjs, tests/orgs-member-token-cap.test.mjs, tests/orgs-key-cache-capacity.test.mjs, and a route test in tests/orgs-runtime.test.mjs.
  - The 5,000-member test runs in `npm run test:organizations`.

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
  - Invitations bound to principals resolved through the directory. **Members are stored by origin principal** (rev 5.1, AMD-P4; equal to `(iss, sub)` for identities that never moved), local or foreign alike.
  - Per-member grants (resource, methods, `expires_at`) plus the `admin` power.
  - Member context: DPoP-bound tokens that never outlive the certificate, no refresh token, the membership ID, and the projection intersection.
  - Organization-as-itself background access, approved separately (R1-H1).
  - The `aep` hold after recovery (R1-H3), bound admin invitations (R1-H4), the `member-removed` SET and the actor-chain audit.
  - **Organization identity (rev 5):** the identity record with a stable UUID and aliases, keys, and the organization recovery file issued to the owner at creation through the existing recovery-file flow; organization recovery through the person recovery flow, followed by the §12b rules; entity-certificate `aep`; and the per-organization certificate-lifetime setting, with a 660 s default. Rotation and succession, and portability, are not in phase A.
  - **The grant-management policy (rev 4.3, §12b):**
    - the owner of record, which in phase A is the creator, designated while billing is disabled;
    - `admin` as the GM grant;
    - consent requests to the subject first, with no expiry;
    - elevation by the requester after a rejection or the response period (7-day default, configurable per organization), pending until the owner accepts or rejects, the requester retracts or the subject accepts (§12b.2a); owner step-up, immediate notice and audit;
    - self-resignation, the last-admin guard and request rate limits;
    - the owner's own admin power changeable only with the owner's consent.

    Transfer (§12b.3a) and the lapse rule arrive with billing (phase C, before the first external organization). Break-glass stays in phase B. Tight verification for owner GM elevations (Q14) is in phase A, since elevation is.

  - **Rev 4 additions** (product rules, §12a): creation needs a 3sln.me account; the organization is on a paid tier, which for the user's own company can be an internal allowlist until billing is enabled. No relations: one company needs none. Phase A's connections already carry the counterparty kind `entity` in their schema, so relations need no migration later.

  **Before phase A data accrues,** settle Acme's long-lived issuer (Q7).

  The ERP keeps its own app-level roles, keyed by membership ID. Phase A has no templates, island switcher, relations, member fields or export. The scope grew by two pieces of infrastructure, the directory and certificates. Both are shared with Parlay and links, which needed them anyway.
- **Phase B:** silent island acquisition and the entity switcher (ORG-6b), member-scoped fields, the effective-methods output (spec §7.5), templates, export including the portable membership export (spec §13.1), break-glass, and optional passkey-signed approvals and organization-key audit checkpoints.
- **Phase C:** same-provider relations (ORG-10): relation documents pinned by digest (or by artefact references, if they have landed), the generic `share` relation, `group` for the user's companies, `supply` for purchase orders and invoices, an accountant firm on 3sln.me. Organization tiers and Polar billing go live before the first external organization.
- **Phase D:** cross-provider relations (needs artefact references and the egress gate), re-sharing, admission delegation, identity continuity, resource transfer, and metered pricing.

## 14. Changes needed in other documents (coordinator)

- **Spec amendments** AMD-O1 to AMD-O14, as listed in [spec/organizations.md §15](../spec/extensions/organizations.md#15-core-amendments--proposed-unsigned). They change protocol §1, §3 and §6, auth, integrations §1, §3, §5 and §6, events §2.1, links (new types and the signature-domain table), security (grants paragraph), contracts (follow-ons paragraph), and the future directory profile.
- **[Implementation roadmap](implementation-roadmap.md):** add the ORG slices and the dependency on the directory profile.
- **[Open items](../release/open-items.md):** add the §15 questions.
- **[Feature flags](feature-flags.md):** the §13.1 rows (`ORG_RELATIONS_ENABLED` replaces `ORG_RELATIONSHIPS_ENABLED`).
- **[Artefact references](artefact-references.md)** (in progress, other agent): relation documents as an adopting artefact class, with the four needs in spec §9.8.
- **[Unit economics](unit-economics.md) and billing:** an organization tier model (§12a), the lapsed-payment degradation in the account lifecycle design, and the ownership-transfer billing flow (§12b.3a: fresh period, immediate cancellation of the old subscription, full refund of a failed transfer).
- **[Identity portability](identity-portability.md)** (other agent): the 30-day cooling already lists ownership transfers; the transfer offer and owner GM elevations now reuse its tight verification (items 1–3), and organization moves can carry the portable membership export (spec §13.1).
- **[Components profile](../profiles/components-v1.md) and [embed islands](embed-islands.md):** entity section and events (ORG-6).
- **[Privacy](../legal/privacy.md) and [terms](../legal/terms.md):** the organization sections, and the DPA (§12).
- **[Bindle Messaging spec](../spec/extensions/messaging.md):** "on behalf of" attribution, as a request to the messaging owner. Also: §3.2 `key-delegation.v1` becomes the shared core feature with two certificate profiles (AMD-O12), and §3.3 resolves identities through `directory.v1`.
- **[Contact delivery](../../apps/parlay/docs/legacy/contact-delivery.md) and [links §7.3](../spec/superseded/links.md#73-verifying-the-audience-identity):** replace the references to the "unimplemented directory profile" with spec §3a (AMD-O10).

## 15. Open questions for the user

Rev 3 status: Q1 is accepted. Q2 and Q6 are superseded by the 2026-10-21 clarification (§1a). Q7–Q9 were added at the coordinator's request. **Rev 4:** Q4 is decided by the user (paid, §12a), Q5 is superseded by relations, and Q11–Q13 are new. **Rev 5.2:** Q3 is decided by the user (accepted); Q13 stays open pending more explanation. **Rev 5.3:** Q13 is decided by the user (membership is internal, §12c); Q14 and Q15 are new. **Rev 5.4:** Q16 (ownership transfer) is decided by the user; Q14, Q15 and Q17–Q19 are answered as *Provisional (coordinator), not signed off by the user*; implementation proceeds on them and they stay revisable (§1d).

| Q1 | ~~Use "Organization" as the term?~~ | **Accepted** 2026-10-21 (record in DEVLOG) |
| Q2 | ~~Federated login plus DPoP tokens as "signed requests"?~~ | **Superseded.** Home-certified holder keys sign requests (ORG-D5). |
| Q3 | ~~**No roles**~~ **Decided by the user, 2026-10-22: accepted as recommended.** Per-member grants, copy-on-apply templates and app-published member-scoped fields, with live groups deferred. | Yes (accepted) |
| Q4 | ~~Organizations paid-only at launch?~~ | **Decided by the user:** always paid; creation needs a 3sln.me account (§12a) |
| Q5 | ~~Grantor-initiated offers only?~~ | **Superseded** by relations (§8a). There is still no access-request queue in v1. |
| Q6 | ~~Phase A same provider only?~~ | **Superseded.** Phase A includes members from any provider (§13.3). |
| Q7 | ~~**Where does Acme's own identity live?**~~ **Resolved (user, 2026-10-22):** the organization identity is an ordinary identity with a recovery file, and moves follow [identity portability](identity-portability.md) (in progress). Original question: (a) `3sln.me/identity/<o>` now, accepting a one-time re-key later; (b) its own domain as issuer, which needs custom-domain hosting on Workers; (c) write identity continuity first. | **(a) now**, with membership IDs, grants and ERP data keyed so a re-key is a scripted migration. Write identity continuity (c) before the first cross-provider *relationship* (phase D), when re-keying would also break counterparties. Pick (b) only if custom-domain hosting proves cheap. |
| Q8 | ~~**Two-admin deadlock**~~ **Resolved by the user's grant-management rule (2026-10-21, §12b.4)**, which leaves the residuals listed there. Original question: a removal target cancels its own removal, and two rogue admins cancel each other forever. | Position B: a mutual cancellation freezes governance into a visible "disputed" state, with members' grants unaffected. Only the recovery-file holder (meant to be the legal owner, not an operator admin) or an off-platform process ends it. This does not reward whoever acts first. |
| Q9 | **Messaging apps on account deletion.** Rev 5: Parlay (formerly Parlay) is a regular app that stores data in the user's own object-storage resource, and this design treats operator-run apps like any other. | Belongs to the deletion design: [account deletion and export](account-deletion-export.md), finding R1-M12. For organizations: a member's home-account deletion stops certificates, so the membership becomes unusable; the organization keeps the membership record and ex-member data as controller (§12). Deleting the organization itself follows the same deletion design once it covers organization accounts. |
| Q10 | ~~**Certificate lifetime**~~ **Resolved (user, 2026-10-22):** the issuer's choice, disclosed with its revocation bound. 3sln.me defaults to about 11 minutes, configurable per organization. Original question: 300 s default and 600 s maximum? | Yes. It bounds revocation at about 6 minutes (10 at most). Owner-interface actions also check status, within 60 s. Entity certificates are capped at 300 s. |
| Q11 | ~~**Name for relations**~~ **Resolved (user, 2026-10-22):** Relation, Relationship, and "relation slot" where ambiguous. Original question: "Relation" in the spec and "Relationship" in the UI, or one of the user's suggestions ("bond", "coven")? | **Relation / Relationship.** "Bond" clashes with finance vocabulary in an ERP-first product (bonds payable, surety bonds). "Coven" reads as a joke. The full check is in [terminology §6](organizations-terminology.md#6-relation-naming-check). |
| Q12 | ~~**Admission to many-party instances.**~~ **Resolved by the user, 2026-10-21 (§8a.9):** every grantor consents per edge, and partial membership is normal. Any party may propose. Original question: Must every grantor consent to each joiner (chosen), or may a relation document name a slot whose holder admits others on everyone's behalf? | Every grantor, for now. Delegated admission is a real convenience for groups with many subsidiaries, but it is authority by proxy. Add it later as an explicit, per-party opt-in ("I accept whoever the parent admits") with a cap. |
| Q13 | ~~**Membership as a relation?**~~ **Decided by the user, 2026-10-22:** "membership of an org is separate from relations; relations are relationships between orgs." Membership is internal to the organization and is specified only where it crosses a party boundary (ORG-D20, §12c). Earlier explanation, kept for the record: on 2026-10-22 the user asked for more explanation. In plain terms: a relation gives every holder of a slot the same access, defined in a public document; membership gives each person their own grants plus governance powers (admin, ownership), kept private inside the organization. Modelling membership as a relation would mean either one relation per member or per-member values on top of a relation, which is roles again under another name, and the public document would add nothing for an internal arrangement. What stays possible either way: the person→organization direction (for example a profile share) uses the same fragment-grant mechanics, and the console can list memberships and relations side by side. | No (§8a.6). Keep membership distinct, because grants are per person and governance is involved. The console may list memberships and relations together. **Accepted.** |
| Q14 | ~~**Tight verification for GM elevations?**~~ **Provisional (coordinator), not signed off by the user (rev 5.4):** yes, items 1–3 without the delay (§12b.2). Original question: §12b.5 applies tight verification (an aged credential, no recent security change, notices, a short notified delay) to the owner's move decisions only. GM elevations under §12b.2 still take effect immediately, which is deliberate against a rogue admin. Should owner GM elevations also need an aged credential and no recent security change, without the delay? | Yes to the aged credential and the security-change check, no to the delay: the delay would let a rogue admin keep acting for its length. **Adopted provisionally.** |
| Q15 | ~~**Effective methods in member context?**~~ **Provisional (coordinator), not signed off by the user (rev 5.4):** yes (spec §7.5). Original question: An app that enforces member authority over its own data sees only a filtered projection (§12c.4 item 1). Should the member-context projection state the effective methods per resource, as a standard output shape (never the grant records)? | Yes, as an additive projection member in phase B, alongside member-scoped fields. Until then apps keep their own tables keyed by membership ID. **Adopted provisionally.** |
| Q16 | ~~**Can ownership be transferred?**~~ **Decided by the user, 2026-10-22:** yes; the recipient sets up billing before receiving the organization, billing starts over, and the previous owner's payment does not count (§12b.3a). | Mechanics are *Provisional (coordinator), not signed off by the user* (§1d item 10). |
| Q17 | ~~**Do "no timeout decides" exceptions exist?**~~ **Provisional (coordinator), not signed off by the user (rev 5.4):** the post-recovery and billing-lapse 72 h rules are explicit break-glass exceptions (§12b.2a item 4). | — |
| Q18 | ~~**Pending elevations on a change of owner; accepting after rejecting; held owner cancelling a recovery?**~~ **Provisional (coordinator), not signed off by the user (rev 5.4):** elevations pass to the new owner; a subject may accept after rejecting; a held owner cannot cancel a recovery (§12b.2a items 5 and 9, §12b.3). | — |
| Q19 | ~~**Portable membership export and spec security floors (§12c.4 items 2–3)?**~~ **Provisional (coordinator), not signed off by the user (rev 5.4):** both in the spec (spec §5.1, §5.2a, §13.1). | — |
| Q20 | **ORG-12 break-glass** (rev 5.5): the provisional decisions BG-1 to BG-17 in §12d.11, notably a third timeout exception (BG-1), support adjudication (BG-16) and reinstatement billing (BG-13). | The coordinator's recommendations are in §12d.11; implementation may proceed behind the default-off flag. |
| Q21 | **ORG-10/ORG-11 relations** (rev 5.6): the provisional decisions RL-1 to RL-17 in §8b.9. Notably: any admin establishes relations with no owner elevation (RL-2); holding edges on a counterpart's authority reset, except for an attested move (RL-4); relation events signed by certification keys (RL-5); no transparency log for ORG-11 (RL-8); and 3sln.me relations between organizations only (RL-17). | The coordinator's recommendations are in §8b.9. Implementation may proceed behind the default-off flags. |

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

Independent adversarial review of design revision 3 and spec revision 2 (§3a `directory.v1`, §5.2 member certificates, AMD-O12), 2026-10-21. Checked against `packages/identity/{keys,delegation}.mjs`, Parlay §3.4, links §7 and integrations. Reviewer sign-off on this round: reviewer ___ / date ___ / outcome ___. Resolutions are **provisional**. "Resolved" means the text now says it; nobody has signed it.

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

**R2-M5. AMD-O12 conflicted with the current delegation code** (resolved in AMD-O12). `delegation.mjs` keeps one active delegate key per principal (certifying a new jkt revokes the others) and certifies only the messaging-ingress occupant. Reused as-is for member certificates, Alice's phone would revoke her laptop, and her CRM would revoke her ERP. *Fix:* both rules are scoped to the Parlay profile, and member certificates allow keys per issuance grant.

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
| R2-M5 (delegation code assumes one key) | Scoped to Parlay | Extended. AMD-O12 now covers three profiles, and entity certificates allow keys per issuing grant. |
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

## Revision 4.1 reconciliation

| Finding | Earlier status | Revision 4.1 |
| --- | --- | --- |
| R3-M1 (split views of an instance) | Partly resolved; who may admit was open (position A: any party; position B: creator only) | **Resolved by the user's decision.** Per-edge recognition makes per-party views the model, and partial membership is first-class. Arity is enforced per view. Any party may propose, through a non-authorizing introduction. Every edge needs its grantor's consent. Position B is not adopted. |
| Q12 (admission delegation) | Open | **Resolved** (§8a.9). |
| R3-M2 (pre-accepting receipt) | Resolved | Unchanged. Pre-acceptance is a grantee-side recognition and stays marked and visible. |
| Spec §9.3 "no global roster" | Rule | Strengthened into a definition: an instance has no membership list, only per-party views (spec §9.3). |

## Revision 4.2 reconciliation

| Finding | Earlier status | Revision 4.2 |
| --- | --- | --- |
| Artefact-references review R1-L2 (relation documents have no kind) | Open, coordinate | **Resolved in spec §9.2.** The `relation` kind's growth table: new slots (with `min` = 0); appended access entries (`required` only for new slot pairs); appended fields, methods and per-field method maps; and superseding entries to follow fragment growth. Everything else is frozen, including slot names, arity in either direction, `kinds`, existing entries and ceilings. Any delta for an edge's own pair is a widening that needs grantor consent and grantee acceptance. Unknown until the table is signed (artefacts §6.4). |
| R3-L4 (upgrade loopholes) | Resolved: raising ceilings counted as widening | **Tightened.** Ceilings and `required` are frozen values, so raising a ceiling needs a new relation `id`. |

## Revision 4.3 reconciliation

| Finding | Earlier status | Revision 4.3 |
| --- | --- | --- |
| R1-H4 (d), Q8 (two-admin stalemate) | Open | **Resolved** by the user's rule (§12b.4). Residuals are stated there: the owner prevails, and an absent owner falls back to consent, the lapse rule or break-glass. |
| R1-H4 (a)–(c) | Resolved | Unchanged. Adding admins keeps the bound invitation and the 72 h delay. Break-glass now also feeds ownership through transfer or lapse. |
| R1-H3 (recovery takeover) | Resolved (normative hold) | The hold stays normative. The re-confirmation mechanism is now provider policy (spec §5.2a). For 3sln.me, the owner's own reset is re-confirmed by a 72 h notice to the admins, and an objection leads to break-glass. |
| Spec governance rules | Partly normative | **Moved to provider policy** (spec §6.3). The spec requires only a defined, disclosed policy, plus bound owner-interface invitations, recovery holds, the no-operator-less rule and no owner-interface authority across edges. |

## Revision 5 reconciliation

| Finding | Earlier status | Revision 5 |
| --- | --- | --- |
| R2-M4 (lifetime bound versus "about 6 minutes") | Open | **Resolved by the user.** The lifetime is the issuer's choice. Issuers disclose `max_certificate_seconds` and `revocation_bound_seconds`. 3sln.me defaults to 660 s (about 12 minutes worst case) and is configurable per organization. Every latency statement now says "issuer's disclosed lifetime plus 60 s". |
| R3-M5 ("slot" collides with extension slots) | Open | **Resolved by the user:** keep "slot", and write "relation slot" where ambiguous (spec §9.2, terminology §6). "Position" is not adopted. |
| R3-M7 (counterpart organization key reset or recovery) | Open | **Narrowed.** Organizations now have recovery and an authority epoch, and entity certificates carry `aep`, so counterparts can detect organization recovery. Whether to hold edges on an increase is provider policy (spec §9.5). A key reset without continuity is still R2-M8 / R3-M7 territory. |
| R1-H3 (recovery takeover) | Resolved | **Extends to organizations.** Organization recovery is an authority reset that confers no owner-interface authority. The 3sln.me post-recovery rule (72 h, cancellable only by the current owner) applies. |
| R1-H4 (c) (a fired admin keeps the recovery file) | Resolved: file reissued on admin-set change | **Revised.** The file belongs to the owner role and is reissued on ownership change. An admin never holds it. A former owner keeps old key material until rotation exists, which is a stated residual. |
| Q7, Q10, Q11 | Open | **Resolved** (§1c). |
| Q9 / operator-run apps | Open in the deletion design | Parlay is a regular app. The organization design has no special case for operator-run apps. |


## Revision 5.1 reconciliation

| Finding | Earlier status | Revision 5.1 |
| --- | --- | --- |
| **R4-H2** (portability may turn old files into hijack tools) | Open (dependency) | **Answered, resolved pending review.** [Identity portability spec](../spec/extensions/identity-portability.md) §6.1: a move needs the *current* recovery credential plus current control (a fresh session not derived from a recent authority reset, or a public 7-day waiting period). Key possession and superseded files never qualify. For an organization, it also needs transfer authority under the grant-management policy, and recovery-derived authority counts only once that recovery has taken effect. Under §6.3 the source destroys its key copies and revokes its certification keys at commit. Verifiers follow attested successor statements, never redirects (§8, §10), and key everything by **origin principal** (§8.1). Applied in spec §3 (portability, origin principal), §3a.1 (identity URIs from adopted moves), §3a.3 (`moves`, the 32 KiB bound, cross-host no-rollback, fresh certification keys, the redirect hint), §5.2 step 1 and §9.5 (successor index), §5.2a (move adoption is an authority reset) and §5.3 (members stored by origin principal). |
| AMD-I5 (certification keys sign intents) | — | **Confirmed.** Spec §3a.3: certification keys also sign `bindle-intent+jwt`, separated from certificates by `typ`. |
| R4-M4 (owner absent during organization recovery) | Open | **Recommendation recorded, awaiting the user** (§5.11): the 14-day extension on admin objection, no elevation against admins for 30 days, and no cancel by a held owner. Not a decision. *Superseded in rev 5.2.* |
| Phase A (R4 "conditionally sound") | Depended on R4-H2 | Phase A member records must use origin principals from day one. For identities that never moved this equals `(iss, sub)`, so nothing changes now. Organization moves themselves stay out of phase A. |

## Revision 5.2 reconciliation

| Finding or rule | Earlier status | Revision 5.2 |
| --- | --- | --- |
| Q3 (no roles) | Recommended | **Decided by the user, 2026-10-22: accepted.** |
| §12b.2 consent expiry ("expiry counts as a decline") | Rev 4.3 rule | **Replaced** (§12b.2a): requests never expire. The response period only unlocks elevation. |
| §12b.2 immediate owner elevation | Rev 4.3 rule | **Refined** (§12b.2a): subject first; the requester elevates after a rejection or the response period (7-day default, coordinator's proposal, configurable per organization); the elevation is pending until the owner accepts or rejects, the requester retracts or the subject accepts. Applies to the owner as requester too. |
| **R4-M4** (owner absent during organization recovery) | Recommendation awaiting the user | **Recommendation superseded** by the user's rule. The 14-day extension, 30-day cool-off and held-owner clause are withdrawn. The purge scenario is narrowed: a recovery-derived owner can no longer remove admins instantly (§5.11). **Open:** (1) the post-recovery rule takes effect 72 h after notice unless the current owner cancels, and the billing-lapse rule takes effect 72 h after notice unless the old owner pays; both are ownership claims settled by time. They are not grant-management changes in §12b.1's sense, but the recovery rule also confers the admin power. Whether "no timeout decides" extends to them is for the user; applying it literally would leave break-glass unable to work when the owner is gone, which is the case it exists for. (2) Whether a held owner (spec §5.2a) may cancel a recovery. (3) Whether a pending elevation follows the owner role to a new owner after a transfer, lapse or recovery. *Rev 5.4: all three answered provisionally (coordinator); see [Revision 5.4 reconciliation](#revision-54-reconciliation).* |
| Q8 / §12b.4 (two-admin deadlock) | Resolved (rev 4.3) | **Still resolved.** Residuals updated: the owner prevails but not instantly; an absent owner leaves elevations pending, never lapsing. |
| Q13 (membership as a relation) | Open | **Still open.** The user asked for more explanation (2026-10-22); a plainer explanation is in §15. |

## Revision 5.3 reconciliation

| Finding or rule | Earlier status | Revision 5.3 |
| --- | --- | --- |
| Q13 (membership as a relation) | Open | **Decided by the user, 2026-10-22.** Membership is internal; relations are between organizations (§8a.6, ORG-D20). |
| Spec scope | Membership, holds and governance floors in spec §3, §5, §6.3 | **Narrowed** (spec rev 4.2) to party boundaries. Moved to §12c.3: the hold after authority resets (R1-H3), no escalation through own recovery, bound governance invitations (R1-H4), partial governance (R1-L6), the no-operator guard, membership expiry and removal, and owner-interface audit. The R1-H3 and R1-H4 *signals* stay in the spec (`aep`, the bound-invitation mechanism); their *effects* are 3sln.me policy. Findings resolved by those rules stay resolved, now as provider policy. |
| M10 (admin blocking of organization moves) | Applied under the coordinator's reading | **Decided by the user, 2026-10-22** (§12b.5, portability §6.2). Tight verification is the coordinator's proposal. |
| Places the split may be wrong | — | Listed in §12c.4 for the user; Q15 is the one with a concrete proposal. |

## Revision 5.4 reconciliation

Labels: "Decided by the user, 2026-10-22" for the user's own calls; "Provisional (coordinator), not signed off by the user" for answers the user delegated ("go with what makes sense"). Implementation proceeds on the provisional answers; they stay revisable and block nothing.

| Finding or rule | Earlier status | Revision 5.4 |
| --- | --- | --- |
| Ownership transfer (Q16, ORG-D21) | Rev 4.3 sketch: nominate a member, switch when the new subscription activates | **Decided by the user, 2026-10-22:** transferable; the recipient sets up billing first; billing starts over; the previous payment confers nothing. Mechanics in §12b.3a (*provisional, coordinator*): a named 3sln.me account; tight verification on the offering owner; notices and objection; a 24 h minimum; a 14-day offer lapse; effect only on a verified payment; the old subscription cancelled at once with refunds discretionary under the terms; a full refund if the transfer fails after payment; the previous owner stays a member. |
| Revision 5.2 open item (1): 72 h auto-effects versus "no timeout decides" | Open | **Provisional (coordinator):** explicit break-glass exceptions (§12b.2a item 4). |
| Revision 5.2 open item (2): held owner cancelling a recovery | Open | **Provisional (coordinator):** cannot, until re-confirmed (§5.11, §12b.3). |
| Revision 5.2 open item (3): pending elevations on a change of owner | Open | **Provisional (coordinator):** they pass to the new owner (§12b.2a item 9). |
| Accepting after rejecting | Unstated | **Provisional (coordinator):** allowed while the request is open (§12b.2a item 5). |
| 7-day response period | Coordinator's proposal awaiting confirmation | **Provisional (coordinator):** stands, configurable per organization. |
| **R4-M4** | Open in parts | **Resolved provisionally.** With the held-owner rule and the break-glass exception stated, the remaining gap is the one R4-M4 named: a thief with the file and an absent, unheld owner becomes owner after 72 h. That is accepted as the price of break-glass; admins get notice, a recovery-derived owner cannot purge admins instantly (§12b.2a) or move the organization for 30 days (portability §6.2). |
| Q14 (tight verification for GM elevations) | Recommendation | **Provisional (coordinator):** items 1–3, no delay (§12b.2). |
| Q15 (effective methods) | Recommendation | **Provisional (coordinator):** spec §7.5, phase B. |
| §12c.4 item 2 (portable membership export) | Listed for the user | **Provisional (coordinator):** spec §13.1 interop requirement. |
| §12c.4 item 3 (security floors for foreign members) | Listed for the user; non-normative in spec rev 4.2 | **Provisional (coordinator):** MUSTs again in spec §5.1, §5.2a, §6.3 (spec rev 4.3). R1-H3 and R1-H4 are resolved as spec floors plus 3sln.me specifics. |
| Not settled | — | Whether the 24 h transfer minimum and 14-day offer lapse are the right figures, and whether a recipient who is not yet a member should first be invited as one, are left for the user's review; the provisional answers above stand meanwhile. |

## Review round 4

Independent adversarial review of design revision 5 and spec revision 4 (organization identities with recovery files, recovery as break-glass, issuer-chosen certificate lifetimes, rev 4.1 per-edge admission, rev 4.3 grant-management policy), 2026-10-22. Checked against [recovery identity](../3sln/accounts/recovery-identity.md), which confirms that recovery files contain the original **signing and encryption private keys**, for persons and organizations alike. Reviewer sign-off on this round: reviewer ___ / date ___ / outcome ___. Resolutions are **provisional**.

Counts: **2 High, 5 Medium, 2 Low.** Resolved in text: 1 High, 4 Medium, 1 Low. Open: R4-H2 (dependency), R4-M4, R4-L2. *Rev 5.1 update:* R4-H2 is answered (resolved pending review; see [Revision 5.1 reconciliation](#revision-51-reconciliation)). R4-M4's recommendation is superseded by the user's elevation rule (rev 5.2); parts remain open.

### High

**R4-H1. Any recovery-file holder could mint working certificates offline** (resolved). Certificates were signed with the identity's active signing key, the same key every recovery file contains. Rotation does not exist, and reissuing a file keeps the key. *Scenarios:*

- A former owner (after a transfer) keeps the old file. They mint Acme entity certificates with any `resource`, `methods`, `actor` and `aep`, and call Ledgerly's resources on every live edge. This bypasses Acme's provider, its grant evaluation (R3-H1), its audit and the 72 h recovery window.
- A thief who cracks a stolen file offline does the same at once. There is no recovery to cancel.
- For persons, a stolen person file mints member certificates into every organization the person belongs to. That bypasses home suspension, issuance grants (R2-M2) and the `aep` hold (R1-H3), since the attacker writes the current `aep`. Only owner-interface actions are safe, because their status check reports an unknown `jkt` as revoked.

Non-write reads are not status-checked, and writes accept a fresh certificate instead of a status check, so the gap was broad. *Fix:* spec §3 and §3a.3. Certificates are signed only by provider-held **certification keys** (`use:"cert"`), which are listed in the live identity document, never placed in files or exports, and rotated freely. A certificate signed by the identity key fails. *Alternative considered:* mandatory status checks for every certificate. That also works, because status is `active` only for keys the provider certified, but it costs a cross-provider fetch per new key and per verifier, and it fails closed on every outage. The certification key is cheaper and keeps offline verification. After this fix, a former owner's old keys sign only non-authorizing artifacts (links, participation statements), and the R1-H4 (c) residual shrinks to that, plus R4-H2.

**R4-H2. Identity portability may turn old files into hijack tools (answered in rev 5.1, resolved pending review; see [Revision 5.1 reconciliation](#revision-51-reconciliation)).** `identity-portability.md` does not exist yet. §1c says 3sln.me transfers "require the original recovery file", and that provider moves use permanent HTTP redirects. *Scenarios:* (1) if a transfer accepts key possession or any historical file, a former owner moves Acme to a provider they control; (2) if a redirect from the old issuer is enough, whoever controls the old domain redirects the identity; (3) §3a fetches forbid redirects, and memberships, edges, and ERP data are all keyed by `(iss, sub)`, so a move that changes `iss` breaks every key unless portability defines how verifiers carry the old `(iss, sub)` forward. *Requirement added to spec §3:* portability MUST NOT accept a private key or a superseded file as transfer authority. *Open, for the portability author:* the current reset credential plus current owner-interface authority (with the §12b delays) as transfer authority; a successor statement that verifiers pin, rather than HTTP redirects; and an explicit rule that verifiers keep the original `(iss, sub)` as the stable key across moves. Phase A depends on this answer for the user's organization (Q7 is resolved "by portability").

### Medium

**R4-M1. Counterparts had no rule for a lower organization `aep`** (resolved, spec §9.5). The member rule (R2-M1) was not carried over to entity certificates, so an old-epoch certificate kept working after recovery. Counterparts record the highest `aep` per entity, and a lower one fails.

**R4-M2. Presenting a stolen file churned every counterpart** (resolved, spec §3). The epoch rose at recovery *completion*, before the 72 h window, so a thief who was later cancelled had still bumped `aep`. If counterparts hold edges on an increase, that is a repeatable denial of service across all relations. The epoch now rises when recovery takes effect under provider policy, and a cancelled recovery changes nothing.

**R4-M3. Verifiers could not bound issuer-chosen lifetimes** (resolved, spec §5.2). Refusing long certificates breaks interop silently, and the disclosed `revocation_bound_seconds` is an unverifiable claim. Verifiers now SHOULD cap the effective lifetime at `iat` plus their own maximum and answer with the uniform error, so clients renew. With status checks for governance and the 60 s write rule, verifiers bound their own exposure whatever the issuer picks. The 3sln.me default of 660 s is fine.

**R4-M4. The 72 h owner-only cancel fails exactly when break-glass is needed (position B superseded in rev 5.2 by the user's elevation rule, §12b.2a; remaining questions answered provisionally in rev 5.4, see the [Revision 5.4 reconciliation](#revision-54-reconciliation)).** *Scenarios:*

- **The owner is absent** (the case break-glass exists for), and a thief, or an ex-partner who kept a copy, presents the file. Admins are notified but cannot cancel, so after 72 h the thief is owner and admin. As owner, they can then remove every admin immediately through elevation (§12b.2).
- **The owner is the attacker.** Recovery adds nothing to powers they already have, so the 72 h rule is irrelevant.
- **The owner's own account is compromised** and held under §5.2a. It is undefined whether a held owner may cancel.

*Position A (current):* owner-only cancel. The file is the owner's instrument, and admins must not veto a legitimate successor (an estate, a liquidator). *Position B (reviewer leans):* keep the owner-only cancel, but add three things. Any admin objection extends the window to 14 days. A recovery-derived owner cannot use elevation against existing admins for 30 days, so they gain billing and admin but cannot purge. A held owner cannot cancel, but may cancel once re-confirmed. This bounds a thief's damage without letting admins block a real successor forever.

**R4-M5. Offline guessing of organization files** (resolved as 3sln.me policy, §5.11). Person files are protected by answer-derived encryption, which recovery identity already warns is guessable. An organization file protects a higher-value identity, so 3sln.me requires a generated high-entropy passphrase for it.

### Low

- **R4-L1. Recovery versus grant-management policy** (resolved by R4-M2 and stated here). Recovery confers no owner-interface authority (spec §3). The recoverer's admin and owner standing comes only from the §12b.3 rule after the window. A cancelled recovery changes neither grants nor epoch. GM changes by a recovery-derived owner are elevations and are notified, as for any owner.
- **R4-L2. The identity key still signs link responses and author proofs** (open, outside these files). Under Parlay, contact delivery and links, a recovery-file holder can still forge an organization's (or person's) link responses and contact author proofs until rotation exists. Moving those profiles onto certification keys, or onto delegation certificates signed by them, is for the messaging and links owners. Flagged for the coordinator.

### Earlier resolutions under revision 5

| Finding | Status |
| --- | --- |
| R1-H1 organization-as-itself | **Holds.** |
| R1-H2, R2-M2 member-bound tokens and issuance grants | **Held only after R4-H1.** Before it, a person-file holder bypassed both. |
| R1-H3, R2-M1 recovery hold and ordered `aep` | **Hold after R4-H1** (the `aep` could not be forged before), extended to organizations by R4-M1 and R4-M2. |
| R1-H4 governance | (a), (b) hold. (c) is narrowed by R4-H1, and the residual is R4-H2. (d) is resolved by the §12b policy, with the residual R4-M4. |
| R2-H1, R2-H2, R2-H3 directory | **Hold.** The no-rollback rule now also covers certification keys. |
| R2-M6 egress and clean-room issuer | **Holds.** |
| R3-H1, R3-H2 certificate scope and composition | **Hold after R4-H1.** Before it, a key holder could write any scope. |
| R3-M1 to R3-L4 | **Hold** as reconciled in rev 4.1 to 4.3. |

### Phase A forward compatibility

**Conditionally sound.** Phase A must issue member certificates under certification keys from day one, which costs nothing now and is a migration of every verifier later. Its member records stay keyed by `(iss, sub)`. The remaining dependency is R4-H2: until identity portability says how an identity's `(iss, sub)` survives a move, Acme's long-term identity, and every ERP key derived from it, rests on an unwritten design. The reviewer recommends that portability adopt "the original `(iss, sub)` remains the stable key, with a pinned successor statement" before phase A data accrues.
