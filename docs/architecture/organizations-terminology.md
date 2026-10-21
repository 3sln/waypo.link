# Terminology spike: what to call teams, companies and other collective units

Status: **spike, 2026-10-21. The user accepted the recommendation ("Organization", with "entity" as the umbrella) on 2026-10-21**, as relayed by the coordinator. The acceptance still needs its DEVLOG record. Design only, with no code. The coordinator records the decision in DEVLOG.md. Companion design: [organizations design](organizations-design.md). Draft spec: [organizations](../spec/organizations.md).

Product/protocol sign-off: reviewer ___ / date ___ / outcome ___.

## 1. The finding that decides most of it

Bindle already has an umbrella term. [Protocol §1](../spec/protocol.md#1-model-and-custody) says: "An **entity** is an individual or, later, an organization/team with its own authority and policy." Entities own resources, hold preferences and approve grants. The spec writes `https://example.org/entities/e_123` in its examples.

So the question is not "what is the new primitive?" There isn't one. The unit the user wants is a second **kind of entity**: one that is not a person, has no login credentials of its own, and is governed by people who hold grants in it. The question is what to call that kind, in the spec and in the UI.

That has a useful consequence. An entity of any kind already has its own identity `(iss, sub)`, keys, provider, resource pool, preferences and connections. A collective unit therefore gets the user's "each entity is its own self-contained unit" property for free.

## 2. Tests

Every candidate was scored against six tests.

| # | Test |
| --- | --- |
| T1 | **Fit.** The same word works for a solo company, a team inside a company, a parent company with subsidiaries, a temporary joint venture, a club and a family or household. |
| T2 | **UI.** It reads naturally in "Switch to Acme", "Your ___s", "Create a ___" and "Invite people to ___". |
| T3 | **Spec precision.** It names an actor that owns things, grants access and enters relationships. A *place* does not do those things. |
| T4 | **No clash with OAuth or OIDC.** Their vocabulary includes client, resource owner, subject, audience, scope, claim and actor (`act`, RFC 8693). Products add more: tenant (Microsoft), realm (Keycloak) and entity (OpenID Federation). |
| T5 | **No clash with neighbouring standards.** SCIM has User and Group, plus the Enterprise User `organization` string. ActivityStreams has the actor types Person, Organization, Group, Application and Service. ERP systems use legal entity, company, business unit, organizational unit, party and tenant. |
| T6 | **No clash with existing Bindle terms.** Those are entity, account, identity, principal, provider, app, integration, connection, owner, slot, occupant, bus, fragment and link. |

## 3. Candidates

Scores: ✓ passes, ~ weak, ✗ fails.

| Candidate | T1 | T2 | T3 | T4 | T5 | T6 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **organization / org** | ✓ (family ~) | ✓ | ✓ | ✓ | ✓ | ✓ | ActivityStreams `Organization` and schema.org `Organization` mean the same thing. B2B identity products have converged on it: Auth0, WorkOS, Clerk and GitHub all ship "Organizations" with members and invitations. "Family organization" is stiff, but a display label fixes that (§5). |
| entity | ✓ | ✗ | ✓ | ~ | ~ | ✗ | It is already the umbrella for persons and organizations, so using it for the collective kind alone would be ambiguous. OpenID Federation also uses "Entity" and "Entity Statement". It reads coldly in a UI ("Switch entity"). **Keep it as the spec umbrella and the SDK API term.** |
| workspace | ~ | ✓ | ✗ | ✓ | ✓ | ✓ | A *place*, as in Slack or Notion. A place cannot be a party to a relationship ("the subsidiary grants its parent read access"). The user already suspected this. |
| team | ~ | ✓ | ~ | ✓ | ✓ | ✓ | Too small for a holding company or a joint venture. Good as a display label. |
| tenant | ✗ | ✗ | ~ | ✗ | ✗ | ✓ | Hosting vocabulary. It implies living inside a provider, which is the opposite of portable. Clashes with Microsoft's tenant. |
| group | ✓ | ✓ | ✗ | ✓ | ✗ | ~ | In SCIM a Group is a set of users with no authority or resources of its own. Messaging uses "group conversation". **Reserve it** for a future set of members inside one organization ([design §6.3](organizations-design.md#63-grants-not-roles)). |
| unit | ~ | ✗ | ~ | ✓ | ✗ | ✓ | An LDAP organizational unit or ERP business unit is a node in *one* hierarchy, which contradicts the idea of peer units. |
| party | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | The ERP party model (Person or Organization) matches Bindle's *entity* exactly, and "party to an agreement" fits relationships. But "Switch party" reads as a celebration or a political party. Worth knowing as an alignment, not as a word to use. |
| principal | ✓ | ✗ | ~ | ~ | ✓ | ✗ | Generic security jargon. BindleBox already uses it for `(iss, sub)`. |
| domain | ~ | ~ | ✗ | ✗ | ✗ | ✗ | Collides with DNS, Active Directory and the host part of handles. |
| realm | ~ | ✗ | ~ | ✗ | ✓ | ✓ | An authentication namespace in Keycloak and Kerberos. |
| space | ~ | ✓ | ✗ | ✓ | ~ | ✓ | A place (Matrix spaces, Confluence spaces). |
| guild | ✗ | ~ | ✓ | ✓ | ✓ | ✓ | Reads as gaming (Discord). Wrong register for companies. |
| house / household | ✗ | ~ | ✓ | ✓ | ✓ | ✓ | Families only. Good as a display label. |
| node | ✓ | ✗ | ✗ | ✓ | ✓ | ~ | Network topology. Users would read it as a server. |
| collective | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | Precise and clash-free, but awkward in a UI and close to the "Open Collective" brand. |
| circle, crew, community | ~ | ✓ | ✗ | ✓ | ✓ | ✓ | Social groupings. They cannot carry a company or a legal entity. |
| company, firm, venture | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | Too specific. Good as display labels. |

## 4. Recommendation

| Layer | Term | Rule |
| --- | --- | --- |
| Spec umbrella (unchanged) | **entity** | A person or an organization. Every protocol rule about resources, preferences, grants and connections applies to both kinds. |
| Spec kind | **organization** | An entity that is not a person, has no credentials of its own, and whose owner interface is operated by its members. |
| Spec kind | **person** | An entity that authenticates as itself, which is every account today. |
| Spec relation | **member** / **membership** | A person who holds a membership in an organization. A membership is a connection whose counterparty is a person ([spec §4](../spec/organizations.md#4-connections-and-counterparties)). The member's identity is always their **home provider's** `(iss, sub)`, which may be on any provider. |
| Spec artifacts | **identity document**, **member certificate**, **holder key** | Public key discovery, a home-certified short-lived signing key, and the key itself ([spec §3a, §5.2](../spec/organizations.md#3a-identity-documents-and-key-discovery-directoryv1)). In the UI there is no separate "sign in to the organization"; members act as themselves. |
| SDK and API | **entity** | The *acting* entity, which is either the person or an organization. For example `bindle-entity-change` carries `{entity}`. One event covers "Personal" and every organization. |
| UI | **Organization**, shortened to **Org** where space is tight | Each organization may pick a display **kind label**: Company, Team, Club, Household, Project or Organization. The label is presentation only and never changes behaviour. |
| UI | **Personal**, **People**, **Members**, **Admins** | "Personal" is the person's own context in switchers. "Admin" is the 3sln.me name for a member with full governance powers. The spec does not name admins (see design §7). |

Words to avoid in specs and UI copy:

- "entity statement" (OpenID Federation);
- "tenant" (implies non-portability);
- "group", until internal member sets exist;
- "role" for anything Bindle enforces (see design §6.3).

## 5. Edge cases checked

| Case | Reads as |
| --- | --- |
| Solo founder's company | "Acme Ltd · Company". One member, who is an admin. |
| Team inside a company | Either a separate organization ("Payments · Team") connected to the company, or (later) a member set inside it. Design §8.4 says which to use. |
| Parent and subsidiaries | Three organizations in one `group` relationship (slots "Parent" and "Subsidiary"). The UI shows "Acme UK · Subsidiary in Acme group". Slot names describe, and grant nothing (§6). |
| Joint venture | An organization with expiring connections to both parents. |
| Club | "Chess club · Club". |
| Family | "The Okafors · Household". Minors cannot hold accounts under the current [age policy](../release/age-requirements.md), so household organizations are adults-only until that changes. |
| Person and organization switchers in the UI | "Personal", then "Acme Ltd", then "Acme UK". |
| Spec sentence | "An organization grants a member read on a ledger resource. The organization's ERP integration acts for that member with the intersection of both grants." |

## 6. Relation naming check

Added 2026-10-21, rev 4. The user proposed public relation documents ([design §8a](organizations-design.md#8a-relations-proposal-assessment)) and suggested "bond" or "coven". The candidates were scored against the §2 tests, plus T7: the word must name both the public document ("a supply ___") and an instance of it ("Acme's ___ with Beta").

| Candidate | T1 fit | T2 UI | T4–T6 clashes | T7 | Verdict |
| --- | --- | --- | --- | --- | --- |
| **relation** (spec) / **relationship** (UI) | ✓ (supply, group, engagement, joint venture, household) | ✓ "Relationships", "Join a supply relationship" | CRM "relationship" means the same thing. No OAuth, SCIM or Bindle clash. | ✓ | **Chosen** |
| bond | ✓ | ✓ | ✗ Finance and ERP: bonds payable, surety and customs bonds. Collides in the user's first product. | ✓ | Rejected |
| coven | ~ | ✗ Reads as a joke or as witchcraft | — | ✓ | Rejected |
| pact | ~ Odd for parent and subsidiary | ✓ | ~ "Pact" contract testing (pact.io); treaty connotation | ✓ | Runner-up |
| agreement | ✓ | ✓ | ✗ Implies a legal contract; ERP "purchase agreements" | ✓ | Rejected (misleads about legal effect) |
| alliance | ✗ Peers only | ✓ | — | ✓ | Rejected |
| covenant | ~ | ~ | ✗ Loan covenants; religious | ✓ | Rejected |
| association | ✓ | ✓ | ✗ A legal entity type (an association *is* an organization) | ~ | Rejected |
| federation | ✓ | ~ | ✗ OpenID Federation; "federated" identity | ✓ | Rejected |
| link, connection | — | — | ✗ Existing Bindle terms | — | Rejected |
| charter, accord, compact | ~ | ~ | ~ Honda, adjective ambiguity, governance documents | ✓ | Rejected |

**Terms:**

- Spec: **relation** (the document), **relation instance**, **slot**, **access entry**, **edge** and **party**.
- UI: **Relationship** for an instance ("Acme Ltd ↔ Beta GmbH · Supply"). A **Relationship type** is the document, and roles in it are its slots ("Buyer", "Supplier"), shown with the slot titles from the document.
- Avoid "relation role" in UI copy. Slots carry no authority by name, and "role" is reserved (§4).

**Open naming clash (review R3-M5).** "Slot" is already a Bindle term (extension slots, T6), and relation access entries reference slot manifests, so one spec section uses "slot" in two senses. The reviewer recommends renaming the relation term to **position** ("the buyer position"; T1–T7 pass, with no Bindle, OAuth or ERP clash found). "Seat" and "side" were considered: "side" fails for more than two positions, and "seat" reads as a billing seat in 3sln.me pricing. This needs the user's decision. Also, "relationship" now names an instance in the UI, while spec §4 rule 4 still says "relationship labels" for local labels; these should become "local labels" when the rename lands.
