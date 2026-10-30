# Organization context selection and layered preferences — design spike

> **Group:** Bindle core and the organizations extension (fragments, projections, member context, member app directory), with the 3sln.me reference service (home-provider chooser, preferences editor, `@3sln/bindle` elements and islands)
>
> **Status:** provisional design spike (2026-10-29), documentation only. Inputs: owner directions of 2026-10-29 (DEVLOG "Owner direction: organization context selection and layered preferences", plus the coordinator-relayed owner directions of the same day: a Slack-like workspace chooser, organizations and members on different providers, and the "tell us where your organization is" fallback). Everything beyond those directions is a coordinator proposal. No decision in this document is signed. Sign-off: Reviewer ___ Date ___ Outcome ___. No code, spec, release-gate or DEVLOG text was changed. Production release remains disabled.
>
> **Covers:** the context model (personal integration vs organization integrations of one app); how the home provider builds the chooser list across providers without a membership or customer-list oracle; remembering and restoring the last context; how apps declare personal-only, organization-only or both; preference layers (user, user in organization, integrator, integrator per member) with their resolution, custody, projection and write authority; the fragment member that separates integrator from user preferences; the chooser, element and editor UI with wireframes; privacy and security; spec impact, a phased engine-first plan and owner questions.
>
> **Does not cover:** organization billing or governance (organizations design §12a–§12d); relations and imported resources beyond the rule in §3.4; how an organization stores member grants (provider policy, organizations §6.3); persisted app sessions (UI audit G3); visual polish of the existing islands (UI audit W2–W8, owned by the elements stream); interop claims or production verification of anything.

Builds on: [protocol §3–§5](../spec/protocol.md#3-fragments-and-preference-values), [extensions rev 3.3](../spec/extensions.md), [organizations rev 4.5](../spec/extensions/organizations.md) (§5.1–§5.4, §6.2, §7, §8, §12), [organizations design §9](organizations-design.md#9-private-membership-checks-elements-and-switching), [embed islands](embed-islands.md) (§9, §13), [UI elements audit](ui-elements-audit.md) (constraints C1–C11), [incremental authorization](../spec/extensions/incremental-authorization.md) (`configure`), and the current code: `packages/federation/service.mjs` (preferences stored per `(entity, fragment)`, `readPreferences`, preferences/v2 projection), `packages/apps/connections.mjs` (owner-only field assignment), `packages/identity/member-certificates.mjs` (home-side consents per `(aud, client)`), `packages/sdk/src/member.mjs` (ORG-6a explicit acquisition), `apps/embed/src/parts/account-switcher.mjs`.

## 0. Decisions in one screen (all provisional, unsigned)

| ID | Decision | Section |
| --- | --- | --- |
| OC-1 | A **context** is the entity an app acts for: the person's **personal integration** or one **organization integration** (the organization's live connection to the app). The app learns a context only after the user selects it and a credential is ready: a personal session, or a member certificate the organization accepted. | §1 |
| OC-2 | Apps declare what they support in client metadata: `bindle_contexts` ⊆ {`personal`, `organization`}, default `["personal"]`. It is a presentation hint, never authority. | §1.3 |
| OC-3 | The home provider remembers the last context per (person, client) privately, and restores it silently only when consent, membership and availability are still valid. Otherwise it falls back to personal (if declared and connected) or the chooser. | §1.4 |
| OC-4 | **Chooser list across providers:** the home provider's private list of the person's organizations (from invitation acceptances, certificate consents and organizations the person added by handle), annotated with which of them offer this app from a **member app directory** that each organization's provider serves to its members. The home provider fetches the whole directory in the background, never a per-app query. Unknown availability still shows the organization; choosing it fails uniformly when it does not work. | §2 |
| OC-5 | **Manual fallback:** the user can add an organization by handle or invitation in the chooser; the home provider remembers it for the person (all apps, all devices). The app learns nothing. | §2.5 |
| OC-6 | A fragment field gains **`layer`**: `integration` (default; today's meaning), `member` (integrator sets per member; replaces the reserved organizations §8 `scope:"member"`), or `user` (the person sets it). A `user` field may carry **`lockable: true`**, which lets the integrator lock it. | §3, §4 |
| OC-7 | Resolution of a `user` field in organization O: integrator lock → the person's value for O → the person's value outside any organization → O's integrator default → unset. In the personal context: the person's value → unset. | §3.3 |
| OC-8 | **Resource rule:** values set outside any organization may only reference resources the person owns. They are never used in an organization context. In an organization context every resource field resolves from the organization's own values (v1). | §3.4 |
| OC-9 | **Custody follows the setter:** user layers live at the person's home provider; integrator layers at the integration owner's provider. The home provider carries the person's resolved values for O to O as a **user-layer statement** issued with the member certificate. The organization merges and serves one projection. | §3.5 |
| OC-10 | The projection keeps one merged `values` object (existing apps work unchanged) and adds `sources` for `user` fields only (`user`, `default`, `locked`). Apps still cannot write values. | §3.6 |
| OC-11 | Chooser UX: a Slack-like list of context tiles inside the home provider's account-switcher island (fixed size, eight rows), Personal pinned first, then organizations by last use with this app; two levels (account, then contexts) in one island; a sheet on small screens. | §5 |

## 1. Context model

### 1.1 Terms

| Term | Meaning |
| --- | --- |
| Personal integration | The person's own connection to the app at their home provider (`app-connection` in `packages/apps/connections.mjs`) and its fragment grants. Its **integrator** is the person. |
| Organization integration | Organization O's connection to the app at O's provider (integrations §3), with O's fragment grants. Its **integrators** are the people O's membership and grant policy lets operate O's owner interface for that connection (organizations §6.3). |
| Context | The entity the app currently acts for: `personal`, or one organization O through member context (organizations §7). |
| Home provider (Y) | The person's identity provider. Renders the elements' islands, issues member certificates, owns the chooser. |
| Organization provider (X) | O's provider. Verifies certificates, holds O's connections and values, serves member-context tokens and the projection. X may equal Y (same host) or not. |

### 1.2 What the app sees

| Context | Credential | `EntityRef` (organizations design §9.3) | Projection served by |
| --- | --- | --- | --- |
| Personal | Personal session with the home issuer (today) | `{issuer: Y, entity: person URI, kind: 'person', member: null, label}` | Y |
| Organization O | Member-context token from X, DPoP-bound to the element's holder key (organizations §7.2) | `{issuer: X, entity: O, kind: 'organization', member: <membership ID>, label: O's public label}` | X |

Before selection the app sees no list, count, order or availability, and the elements emit nothing that depends on them (embed islands §13.1; UI audit C1–C3). After selection it learns exactly what organizations design §9.4 lists. An organization-only app never receives a personal grant: the person signs in at home only to choose.

The app keeps one live context at a time per account. The SDK may cache the previous context's credential in memory so that switching back is fast, but publishes only the current one. Apps SHOULD partition their local data by `EntityRef`.

### 1.3 Declaring supported contexts

Client metadata (the client-id metadata document, or an operator registration) gains **`bindle_contexts`**: a nonempty array, a subset of `personal` and `organization`, default `["personal"]`.

- The home provider reads it from the verified metadata it already resolves. It decides which tiles the chooser shows: no Personal tile for `["organization"]`, and no organization tiles for `["personal"]`.
- It is a claim by the app about itself. It grants and denies nothing. Explicit acquisition (`<bindle-session entity="<O>">`, ORG-6a) keeps working whatever it says, and an organization's provider does not consult it.
- The element attribute `contexts="personal|organization|both"` only selects the island variant and size (an embedder-side fact, so it leaks nothing). When it disagrees with the metadata, the home provider's reading of the metadata decides which tiles appear.
- Default `["personal"]`, because member context is new and today's apps never asked for it.

### 1.4 Last-used context and silent restore

The home provider keeps, per (person, `client_id`), the last context the person completed: `personal`, or O's origin principal. It never goes to the app or into app storage, and it is listed in the person's console and export (§6.4).

On a new app session with `entity="auto"` (the default when `bindle_contexts` contains `organization`), the island worker resolves it, within the existing serial and padded restore (embed islands §13.2):

1. If the last context is O, and the member consent for (O, client) is live (`member-certificates.mjs`), and the cached member app directory (§2.4) lists the client, and a certificate can be issued without UI (prior consent plus an active home session, organizations design §9.1 rule 4): issue it and let the element exchange it. The app gets `bindle-entity-change {cause: 'restored'}`.
2. Otherwise, if `personal` is declared and the person has a live personal connection: restore personal.
3. Otherwise the app stays without a context, and the user sees the chooser when they open the account panel or the app's gate.

A failed exchange in step 1 falls through to step 2 with the same padding. The app can tell only that it did or did not get the organization back, which it would also learn from its next call. That residual is accepted.

### 1.5 Switching

Switching is a user activation inside the island (UI audit C4 arming). A first use of (O, client) opens the home consent popup (§5.6). The previous context stays current until the new credential is ready (EIR-17). On failure the element emits `bindle-entity-change-failed {code: 'canceled'}` for every cause, and the island itself can say what went wrong, because island pixels are not observable to the app (embed islands §7). The app never sees a programmatic "select context n" message: anything that would let embedder script cycle through contexts and watch the outcomes is a membership oracle, so selection exists only inside the island.

## 2. Building the chooser list across providers

### 2.1 The problem

Three parties each know half:

| Party | Knows | Does not know |
| --- | --- | --- |
| App (its own origin) | Which organizations have connected it (its connections) | Which organizations the user belongs to; must not learn it before selection (organizations §12.1) |
| Home provider Y | Every organization for which it certified the person: a member-accept consent at invitation acceptance (organizations §5.1, acceptance needs a Y-issued certificate) and member-access consents (`member-certificates.mjs`, one record per (`aud`, client)) | Whether a membership is still live (removal at X is not signalled to Y); which organizations have connected this app |
| Organization provider X | O's members and O's connections | Which app the user has open right now |

What Y actually learns: every membership the person has accepted through Y needs a Y-issued `member-accept` certificate, so Y's list of `aud` values is a **superset** of the person's live memberships created while Y was their issuer. It goes stale on removal (X sends nothing to Y). It is incomplete in two cases: memberships created before an identity move to Y (unless the migration channel carries the consent list), and organizations the person was never asked about on this account, for example a membership added by an admin on the same host without an acceptance step, which 3sln.me policy should not allow, but other providers might.

### 2.2 Options

| Option | How | Disclosed to app | To home Y | To org provider X | Oracle risks | Latency, failure, staleness | UX | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) Per-app availability query | When the chooser opens, Y asks X for each remembered O "is client C connected?", authenticated as the member | Nothing | Per-org answer for C | Member M is using app C now ("shopping"), on every open | X learns app usage; unauthenticated variants expose O's integrations to anyone | One cross-provider round trip per org on open; slow or failing X stalls the list; fresh | Accurate when it works | Rejected: leaks app usage to every org provider on every open. Padding and batching hide which org, not which app. |
| (b) App-supplied list | The element passes the app's integrating organizations to the island | Nothing new | The app's customer list, for every visitor | Nothing | Customer list leaks to every visitor's home provider. Hashing or Bloom filters do not help: org identity URIs are public and enumerable. The app can steer the list. | No fetch; as fresh as the app | Accurate if the app is honest | Rejected |
| (c) Private set intersection | The app and Y compute the intersection of the two sets cryptographically | Intersection, unless confined to the island | Intersection | Nothing | If the app gets the result, it is a membership oracle; if not, it is (b) with heavy cryptography | New protocol, per page load, mobile cost | Accurate | Rejected: cost far beyond the benefit |
| (d) Show every remembered membership | Y shows every O it knows; choosing one that does not offer the app fails uniformly | Nothing | Nothing new | A certificate presentation, only when chosen | None beyond today | No fetch; failure only on choice | Dead ends for orgs that don't use the app | Fallback only |
| (e) Member app directory | X serves each member the list of O's connected apps that O lists to members. Y fetches the **whole list** per membership, in the background, with a certificate for Y's own client, and caches it | Nothing | O's member-visible app list (a member is entitled to know it) | Member M's home refreshed the list; nothing about which app is open | None to the app; X learns no app usage; a non-member's fetch fails uniformly (organizations §5.2) | Off the open path; bounded staleness (≤ 1 h, §2.4); X unreachable means "availability unknown", not a stall | Accurate tiles, quick open | **Recommended**, with (d) and (f) as fallbacks |
| (f) User tells us | The user enters O's handle or opens an invitation in the chooser; Y remembers O for the person | Nothing | O's handle the person typed | As (e) once added; a failing presentation if not a member | None to the app; X's answer is uniform | One fetch when added | One-time typing | **Adopted** as the fallback the owner asked for (§2.5) |

### 2.3 Recommendation

Combine (e), (f) and (d):

1. **Membership list (Y, private):** the union of (i) organizations from Y's member-accept and member-access consents, (ii) organizations the person added by handle or invitation (§2.5), and (iii) on 3sln.me, organizations on the same host where the person holds a membership (a local read). The person can forget entries. Y never shares this list.
2. **Availability (from X):** for each listed O, Y keeps the member app directory (§2.4) fresh in the background, and marks O as **offers this app**, **does not offer this app**, or **unknown** (X unreachable, no directory support, or a directory fetch that failed uniformly).
3. **Chooser:** organizations that offer the app appear as tiles. Unknown ones appear under "Other organizations" with "May not offer {app}". Ones that do not offer it are hidden behind "Show all organizations". Choosing any of them runs the ordinary certificate path, and a failure is uniform to the app and explained inside the island.

The app's rule is intact: it learns an organization only after selection and certificate acceptance.

### 2.4 The member app directory (Bindle, organizations extension)

- **Endpoint:** a new `organizations.v1` option, `member_directory_endpoint` (issuer origin, audience endpoint). It is absent at providers that do not serve it, which then fall back to (d).
- **Authentication:** a member certificate with `aud` = O, `client` = the home provider's own client (Y's console, `client_id` = Y's issuer URL, the same convention as provider features in extensions §4.2) and a new purpose **`…/purposes/member-directory/v1`**, presented in the direct `BindleMember` form with a DPoP proof. A certificate with only this purpose authorizes nothing else, and `member-access` does not authorize the directory. Verification and uniform failure follow organizations §5.2 exactly, including the no-oracle rules. Y obtains the consent for (O, Y's console, member-directory) at invitation acceptance, or with a one-time prompt for earlier memberships ("Let 3sln.me check which apps Acme offers you").
- **Response:** `{entity: O, label, handle, generation, apps: [{client_id, origins, name, contexts_offered: true, fragments: [{id, digest, locks: [field], defaults: {field: value}}]}], next_refresh}`. `apps` lists only connections that are `active` or `degraded` and that O lists to members (an owner-interface setting per integration, 3sln.me default on). `fragments` carries only O's **defaults and locks for `user` fields** (§3.3), which the person needs in order to understand their own preferences. It carries no integration-layer value, resource reference or grant, and nothing about other members. Bounds: at most 256 apps, 16 fragments per app, 32 KiB in total. A provider with more apps returns `truncated: true`, and Y treats unlisted apps as unknown.
- **Refresh:** on a jittered background schedule (every 30–60 min per membership), independent of what the person is doing, plus on demand when the person presses Refresh in the island. On-demand refresh fetches the whole list too, so it reveals nothing about which app is open. Y keeps the last good response for 24 h. After that, availability becomes unknown. A uniform failure (not a member any more, consent revoked, X down) leaves O in the list as unknown, and Y shows "We couldn't reach Acme" in the console. After 30 days of continuous failure Y offers to forget O.
- **What X learns:** that M's home provider refreshed M's directory, at times that do not depend on app usage. X already knows M is a member. A non-member's attempt fails uniformly and only schedules nothing (organizations §5.2).
- **What Y learns:** the apps O lists to its members. That is consistent with organizations §12 item 7 (the home provider learns which organizations and clients its member acts in).

### 2.5 Adding an organization by handle or invitation (fallback, fully designed)

**Entry.** The chooser's last row is "Add an organization" (inside the island). It opens a home-provider popup, not an in-island field, because typing needs room and a first-time consent follows anyway:

```
┌ 3sln.me ───────────────────────────────────────────┐
│ Add an organization                                │
│ Organization handle or invitation link             │
│ [ acme@3sln.me                                  ]  │
│ Example: acme@provider.example                     │
│                                  [Cancel] [Continue]│
└────────────────────────────────────────────────────┘
```

**Validation and flow.**

1. Parse as an invitation link (organizations-link-envelope) or as a handle (the same parsing rules as sign-in, protocol §2: a single local part and a DNS host). Show the resolved host before continuing.
2. An invitation runs the ordinary acceptance flow (organizations §5.1), with every disclosure. On success, O joins the list.
3. A handle resolves through X's directory (organizations §3a.2) to O's identity URI, rate-limited at Y per person. Y then shows a consent naming O by handle and verified origin: "Let 3sln.me check whether you're a member of Acme and which apps it offers you." On approval, Y issues a member-directory certificate and fetches the directory (§2.4).
4. **Outcomes inside the popup:** success adds O; every failure (unknown handle, not an organization, not a member, X unreachable, no directory) shows one message: "We couldn't add that organization. Check the handle, or ask the organization for an invitation." The organization is not remembered on failure. The person is the principal here, so organizations §12.1 would permit telling them more. One message is still chosen because it is simpler and gives nothing extra to someone using the person's open session.
5. The app learns nothing at any step. The popup is the home provider's window; the element sees only the island's generic flow start and end (embed islands §4.4).

**Where it lives.** Y's private record per person: `org-contexts/known/<origin principal>` = `{source: 'accepted' | 'consent' | 'added' | 'same-host', addedAt, label, handle, directory: {…cache}, lastOk}`. It is per person, not per app, because a membership is per person; last use is kept per (person, client) (§1.4). It syncs across devices because it is server-side. Nothing goes into app storage or embed-partition storage beyond the existing island bindings.

**Shown with discovered entries.** Added organizations appear in the same list as discovered ones, with the same availability annotation. Source is shown only in the console ("Added by you on 29 Oct").

**Forgetting.** "Forget this organization" in the island's per-tile menu and in the console. It removes the record, its directory cache, the last-used pointers that name it, and the person's preferences for O (after confirmation, §3.7). It does not end the membership (that happens at X, organizations §5.4) or revoke consents, which the console lists separately with their own revoke action. A forgotten organization returns only if the person adds it again or accepts a new invitation.

**What X learns when the person adds O:** a directory lookup for O's handle (public anyway), then a certificate presentation from M's home. A non-member's presentation fails uniformly, as a forged one would.

## 3. Preference layers

### 3.1 Layers

Preferences remain per (entity, fragment), as today (`preferences|<subject>|<fragment>` in `packages/federation/service.mjs`), so one value set serves every app that consumes the fragment. Layers add who sets which field, and where the value comes from.

| Layer | Set by | Keyed by | Stored at | Applies to fields with |
| --- | --- | --- | --- | --- |
| **U0: person, outside any organization** | The person | (person, fragment) | Home Y (the person's existing preferences record) | `layer: user` |
| **U1: person, in organization O** | The person | (person, O, fragment): overrides only | Home Y (new record) | `layer: user` (atomic only, v1) |
| **I: integrator** | Personal integration: the person. Organization integration: O's integrators | (entity, fragment) | The entity's provider (existing record) | `layer: integration`; for `user` fields, O's values act as **defaults**, plus a **lock** set |
| **IM: integrator, per member** | O's integrators | (O, membership, fragment) | X | `layer: member` (atomic only, v1; replaces organizations §8) |

In the personal context, U0 and I are both the person's and live in the same record. The layer only changes what the editor groups together, and whether the value follows the person into organizations. A `user` value follows the person; an `integration` value does not.

### 3.2 Which fields can exist in which layer

| Field `layer` | Atomic | Resource | Lockable | Integrator default | Inherits into organizations |
| --- | --- | --- | --- | --- | --- |
| `integration` (default) | yes | yes | n/a (the person cannot set it in an organization) | n/a | no |
| `member` | yes | no (v1) | n/a | the integrator's own I value MAY serve as the default for members without a value (3sln.me templates) | no |
| `user` | yes | yes, with the §3.4 rule | only with `lockable: true` | yes (O's I value) | atomic: yes; resource: never |

### 3.3 Resolution (normative function, one implementation shared by every host)

For a field f of fragment F, read by an app acting in context c:

| Field `layer` | Personal context (person P) | Organization context (O, member M) | Organization as itself (no member) |
| --- | --- | --- | --- |
| `integration` | I(P) | I(O) | I(O) |
| `member` | I(P) (a personal integration has one member, its owner) | IM(O, M), else I(O) if O uses its value as a default, else unset | omitted (organizations §8) |
| `user`, atomic | U0(P), else unset | 1. lock: I(O) when `lockable` and O locked f; 2. U1(P, O); 3. U0(P); 4. default: I(O); 5. unset | I(O) (default or lock) |
| `user`, resource | U0(P), restricted to P's own resources (§3.4) | I(O) only (v1); U0 is never consulted | I(O) |

Rules:

- **The person's own choice outranks the organization's default.** If I picked dark mode, Acme's default of light does not override it; an O-specific U1 value or a lock does. That matches the owner's "user prefs → user + org prefs" and the common expectation (Slack, mail clients).
- **A lock is the publisher's call first.** A field can be locked only if its publisher declared `lockable: true`. That stops organizations from locking fields such as text size or reduced motion that a publisher considers personal (accessibility). The integrator then chooses whether to lock it.
- **Integrators cannot turn an `integration` field into a user-settable one,** and the person can never override an `integration` or `member` field. "The integrator allows override" is expressed by the publisher choosing `user`, and the integrator choosing not to lock.
- **Cardinality and validity** apply to the resolved value. A value that is invalid against the pinned fragment at its layer is skipped, and resolution continues to the next step (fail closed toward the organization's default, never toward a stale user value).
- **Required fields** (cardinality `min ≥ 1`): a `user` field is satisfied in an organization context when any step yields a value. The integrator's default keeps an organization integration configurable without every member acting. In the personal context, the person fills it as today.

### 3.4 The resource rule

1. **U0 resource values reference only resources the person owns** (`resource.owner === P`, as the current checks already enforce), excluding imported resources (`provider: 'relation'`), whose grantor may be an organization. Resources belong to exactly one entity (organizations §5.4), so U0 can never name an organization's resource. That is the owner's hard rule.
2. **U0 resource values never inherit into an organization context,** in either direction. Using the person's own storage for organization work would move organization data into personal custody, which O cannot see or govern. So in O, a `user` resource field resolves from I(O) only.
3. **U1 holds no resource values in v1.** Phase C (§8) may let the person choose, for a `user` resource field in O, among an **offered set** that O's integrators put in I(O), intersected with the member's effective authority (organizations §6.2, §7.5). That set would be stored at X, keyed by membership, because it names X's resources.
4. Every grant rule still applies to the resolved value: a resource reaches the app only if the grant covers it (protocol §4, extensions §3.4). A resolved value never widens a grant.

### 3.5 Custody and transport

- **Personal context:** everything is at Y, and Y resolves locally.
- **Organization context:** X serves the projection (organizations §7.2), but U0 and U1 are the person's data at Y. Y carries them to X as a **user-layer statement**:
  - a compact JWS, `typ: "bindle-user-preferences+jwt"` (a new keys §4 signature-domain row), signed with the person's certification key, like the member certificate;
  - payload `{bindle: 'user-preferences', v: 1, iss, sub, aud: O, client, cnf: {jkt}, fragments: {<F>: {digest, values: {f: value}}}, iat, exp}`, with `exp` ≤ the certificate's `exp`;
  - `values` holds only the **resolved person value** (U1 if set, else U0) for `user` atomic fields of the fragments the client asked for (at most 8 fragments, 16 KiB). X never learns whether a value is O-specific or global;
  - issued in the same response as the member certificate. The client presents it with the certificate at X's token endpoint (`bindle_user_preferences=<jws>`). X verifies it with the same key path and the same ordering as the certificate (organizations §5.2), binds it to the token, and uses it in step 2/3 of §3.3;
  - fields the person did not consent to share in O (§5.6) are left out, so X falls back to O's default.
- **Freshness:** a change reaches X with the next certificate, within the issuer's lifetime (3sln.me: about 11 min). The editor says so. When an island is live, the element MAY renew early after an edit.
- **Same host:** the same statement is used, verified locally. That keeps one code path, and a single-writer account store never needs to read another account's records.
- **What X keeps:** the statement for the life of the token, plus the latest one per membership to serve reads. It deletes both when the membership ends or the connection is removed. X MUST NOT show statement contents in its owner interface: O's admins never see the person's preferences.
- **I and IM** stay at X. Y obtains O's locks and defaults for the editor from the member app directory (§2.4).

The alternatives were: X fetches from Y at read time (a request-path cross-provider fetch, and Y learns every read); Y pushes changes to X (a new channel and copies to keep in sync); and the app merges two reads (two credentials, and the app becomes the policy enforcer for locks). The statement reuses the certificate path, needs no new endpoint at Y, and works for any acquisition mechanism, including device grants.

### 3.6 What the app's projection returns

- `values`: the merged view per §3.3, in exactly today's shape. An existing app that ignores layers keeps working.
- `sources` (new, optional): present only when the fragment has `user` fields, mapping each returned `user` field to `user` (a person's value), `default` (the integrator's default) or `locked`. It never distinguishes U1 from U0, and never names a member or an admin. Apps use it to show "Set by your organization" in their own settings UI and to deep-link to the editor (§3.7).
- `revision` changes whenever any layer behind a returned field changes, including a new statement with different values.
- `requiresConsent` and `effective_methods` (organizations §7.5) are unchanged.

### 3.7 Writes and authorization

- Applications cannot write any layer (protocol §3).
- **U0 and U1:** only the person, in Y's authenticated editor. Changing a value that apps already receive needs the protocol §3 explanation ("Apps you've approved will see the new value"), which now also lists the organizations where it is in effect (where the field is not locked and has no U1 override).
- **I:** the entity's owner interface: the person for a personal integration, O's integrators for an organization (organizations §6.3), with the existing disclosures. Setting or clearing a lock, or a default for a `user` field, is an integrator write. It shows how many members it affects, as a count only at X; the editor never reveals individual person values.
- **IM:** O's owner interface, per member. The member can see their own values (organizations design §6.3).
- **`configure` intent** (incremental authorization §5): in an organization context it opens Y's editor on the "In Acme" view for `user` fields. For `integration` and `member` fields it shows "Managed by Acme" with no edit control, plus a link to O's console only if the person can operate it there (X decides when they arrive). An app's suggestion never fills a locked field.
- Forgetting O (§2.5) or leaving O deletes U1(P, O) after confirmation. U0 is untouched.

### 3.8 Relation to the reserved member-scoped fields (organizations §8)

**Merge.** `layer: member` is §8's `scope: "member"` under the new member. It is atomic only in v1, set by integrators per member, omitted when the organization acts as itself, and disclosed at consent. AMD-O11 is replaced by the `layer` amendment (§7). One member covers all three setters, so no fragment can declare contradictory scope and layer attributes.

## 4. Fragment changes

### 4.1 Member table rows (extensions rev 3.4; protocol §3 exhaustive table)

| Member | Where | Required | Values | Defined by |
| --- | --- | --- | --- | --- |
| `layer` | field (any type) | no | `integration` (default), `member` or `user`. Who sets the field's value and how it resolves in each context (this spike §3, to be written into extensions as a new §3a). | core (extensions rev 3.4) |
| `lockable` | field with `layer: "user"` | no | Boolean, default `false`. When `true`, an integrator may lock the field to its own value in an organization context. | core (extensions rev 3.4) |

### 4.2 Validity (fail closed)

A fragment is **invalid** when it has any of these:

- `lockable` on a field whose `layer` is not `user`;
- `layer: "member"` on a `resource` field (v1);
- `layer` other than `integration` on a resource field whose `consumers` includes `provider`. Provider features act for the entity with no member and no person present (extensions §4.2), so they consume integrator values only;
- `announce: true` with `layer` other than `integration`. Announcements go to the entity owner about the entity's pool (extensions §6). A person's U0 resource choice is configured in the editor, not announced (v1).

A provider that does not implement rev 3.4 sees an unknown member and reports the fragment **unsupported** (protocol §3). No provider applies `layer` partially.

### 4.3 Interactions

- **`selection`:** applies to the resolved value of a `user` resource field, exactly as to any value. Failover follows the resolved owner order.
- **`consumers`:** see §4.2. `application` consumers read layered fields under ordinary grants.
- **Grants:** unchanged. A grant names fields, not layers. In an organization context, the grant is O's grant to the app, and the person's consent at home (§5.6) covers the statement.
- **Consent screens** for a fragment with `user` fields say: "You'll set {fields} yourself; {org} can set defaults[, and can lock {lockable fields}]". With `member` fields: "{org} admins set {fields} for each member" (organizations §8).

### 4.4 Versioning

Adding `layer` and `lockable` is a revision of the exhaustive table (extensions rev 3.4). Under the pre-release exception (protocol §6, owner direction 2026-10-28), the bundled fragments and descriptors that adopt `layer` are rewritten in place and their pinned digests change. Grants pinned to the old digests fail closed (`artefact_digest_mismatch`) until re-consent, as with the CBOR rewrite. From release, adopting `layer` in an existing fragment needs a new fragment URL (or a new version under artefact versions, not an additive change: changing who sets a field is not additive).

## 5. UI

### 5.1 The chooser (home provider island)

Owner direction: akin to Slack's workspace chooser, not a copy.

- **Tiles:** a 40 px square tile (the organization's monogram from its identity URI, using the existing monogram pattern; no logos, because identity documents carry none), the organization's label (from the member app directory), and its handle in secondary text. The Personal tile uses the person's avatar and the text "Personal". The current context has a check and an accent bar on its leading edge.
- **Order:** Personal pinned first (a stable position, like Slack's home). Then organizations that offer the app, by last use **with this app**, then never-used ones alphabetically. Recency is the person's own usage, rendered in the home provider's frame, and island pixels are not observable to the embedder (embed islands §7), so ordering by recency leaks nothing to the app. Organizations design §9.3 asked for "neutral order"; recency is neutral with respect to the app and to providers. The order is not neutral in the extensions §5 sense of candidate suggestions, and it does not need to be: these are not candidates.
- **Fixed shape (C1, C2):** the context view always has 8 row nodes, constant scroll height and a constant Tab count. Real rows come first through CSS `order`, and empty rows are inert padding behind a caption (UI audit V29). Beyond 7 organizations, row 8 is "All organizations…", which opens a home popup with search.
- **Sections in the list:** offers this app; then "Other organizations" (unknown availability, with "May not offer {app}"), collapsed to one row when more than 2; "Add an organization" is always last.
- **Empty state:** with no organization known to offer the app: the Personal tile if declared, and the caption "No organizations offer {app} to you yet." with "Add an organization". For an organization-only app with none: the same, plus "Ask your organization's admin to set up {app}". The shape is the same in every state; only island pixels differ.
- **Keyboard (inside the island only):** ↑/↓ and Home/End move a roving focus; Enter selects; digits 1–8 select row n; `/` focuses "All organizations…" search; Esc closes (forwarded to the element under the existing close semantics). Digit and arrow keys never reach the island from the app, because forwarded "select n" would let script trigger selections (§1.5). The app MAY bind its own shortcut that calls `element.open('contexts')`, which only opens the panel.
- **Arming (C4):** tiles arm 400 ms after visibility, as today.
- **Small screens:** the same island in the sheet (embed islands §9.4), with 56 px rows, full width, and the context view first.

### 5.2 Accounts × contexts

| Option | Shape | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- |
| A. Two levels in one island | Default view: the current account's contexts. An "Accounts" row switches the island to the existing account list. Picking an account returns to that account's contexts and restores its last context for this app. | Short lists; matches the model (memberships belong to a person); one iframe | One extra tap to change account | **Recommended** |
| B. One combined list | Every (account, context) pair as a tile with an account badge | One tap for any switch | 8 rows fill fast; an organization appears once per account; confusing when two accounts share an organization | Rejected |
| C. Separate islands | A `contexts` island part next to `account-switcher` | Independent sizes | Two iframes, two arming windows, and twice the fixed height | Rejected |

Option A uses `account-switcher.v2` with two internal views of one fixed box. Switching views is island-internal, so the box size, the DOM count per view and the Tab count do not change (C2). Accounts at different home providers keep separate islands, one per issuer, as today. With exactly one account, the Accounts row still exists (constant shape) and reads "Use another account".

### 5.3 Wireframes

Desktop: the app header with `<bindle-account>` open, a 320 × 448 island inside the element's popover.

```
 App header ..................................... [(A) Ada · Acme ▾]
                                         ┌──────────────────────────────┐
                                         │ ┌──────────────────────────┐ │  ← element popover
                                         │ │ (A) Ada Lovelace         │ │  ┐
                                         │ │     ada@3sln.me          │ │  │
                                         │ │ Use Notes as             │ │  │
                                         │ │  (A)  Personal         1 │ │  │ island
                                         │ │ ▌[AC] Acme          ✓  2 │ │  │ (home provider,
                                         │ │  [GL] Globex           3 │ │  │  fixed 320×448,
                                         │ │  [IN] Initech          4 │ │  │  8 rows)
                                         │ │  Other organizations     │ │  │
                                         │ │  [UM] Umbrella  May not… │ │  │
                                         │ │  + Add an organization   │ │  │
                                         │ │ ──────────────────────── │ │  │
                                         │ │ ⇄ Accounts   ⚙ Manage at │ │  │
                                         │ │              3sln.me     │ │  ┘
                                         │ └──────────────────────────┘ │
                                         │ Sign out of Notes            │  ← element (embedder) actions
                                         └──────────────────────────────┘
```

Digits at the right edge are the in-island shortcuts (§5.1). The current context (Acme) has the accent bar and check.

Mobile: a sheet at 390 px wide.

```
┌─────────────────────────────────────┐
│ Notes                    (A)·[AC] ▾ │
│                                     │
│ ─────────────── sheet ───────────── │
│  ▔▔▔                                │
│  (A) Ada Lovelace · ada@3sln.me     │
│  Use Notes as                       │
│  ┌───────────────────────────────┐  │
│  │ (A)  Personal                 │  │ 56 px rows
│  │▌[AC] Acme                   ✓ │  │
│  │ [GL] Globex                   │  │
│  │ [IN] Initech                  │  │
│  │ Other organizations (1)     ›│  │
│  │ + Add an organization         │  │
│  │                               │  │ inert padding rows
│  └───────────────────────────────┘  │
│  ⇄ Accounts        Manage at 3sln.me│
│  [ Sign out of Notes ]              │
└─────────────────────────────────────┘
```

Editor at the home provider (`3sln.me`, Apps → Notes → Preferences):

```
Notes · Preferences                                  Context: [ Everywhere ▾ ]
                                                              Everywhere (your preferences)
 Your preferences — apply everywhere unless changed below     In Acme
   Theme              [ Dark ▾ ]                              In Globex
   Language           [ English ▾ ]
   Digest emails      [ Weekly ▾ ]
   Export folder      [ My Drive / Notes ▾ ]   only for Personal; never used in organizations

 App settings (Personal) — set by you as owner of your personal integration
   Storage            [ 3sln.me storage ▾ ]

──── Context: In Acme ────────────────────────────────────────────────────────
 Your preferences in Acme
   Theme              Dark   ↳ from your preferences          [Change for Acme]
   Language           [ Español ▾ ]  changed for Acme          [Reset to inherited]
   Digest emails      Daily  🔒 Set by Acme admins (locked)
   Export folder      Managed by Acme
 Set by Acme admins
   Storage, Workspace defaults  — managed by Acme             (no values shown)
 Changes reach Notes in Acme within about 10 minutes.
```

Indicators: "↳ from your preferences" (inherited from U0), "changed for Acme" with "Reset to inherited" (U1 set), "Acme default" (step 4), and "🔒 Set by Acme admins (locked)". Resource fields marked `user` show "only for Personal; never used in organizations" under the Everywhere view.

### 5.4 Organization console (X)

Per connected app: "Listed to members: on/off" (§2.4). Per fragment: `integration` fields as today; `user` fields as "Members choose. Default: [ … ] [ ] Lock (only when lockable)"; `member` fields under Members → {member} → App settings. The console never shows a member's own values.

### 5.5 What the elements show in the app

- **Trigger:** the person's avatar with a small corner badge (the organization's monogram) and the label "Ada · Acme" once the context is selected. Both are app-entitled after selection (C9). Personal shows no badge. Before selection, the trigger shows the account as today.
- **Gate (UI audit G2, when built):** an organization-only app shows "Choose an organization to continue" with the island. The app cannot tell "has none" from "has not chosen yet".
- **Events:** `bindle-entity-change` gains cause `restored`. `bindle-entity-change-failed` stays `{code: 'canceled' | 'exchange-failed' | 'network-error'}`, with every membership- or availability-dependent failure mapped to `canceled`.
- **No list API:** no getter, event or attribute exposes contexts the user has not selected.

### 5.6 Consent copy (home, before the first certificate for (O, app))

> **Use Notes for Acme?**
> notes.example will act for you in **Acme** (acme@3sln.me, verified origin acme host). Acme decides what Notes can reach there. 3sln.me will see that you use Notes with Acme.
> **Your preferences in Acme:** Notes will use your Theme and Language there (shared with Acme and Notes). Acme can set defaults, and has locked: Digest emails. [Choose what to share]
> [Cancel] [Use Notes for Acme]

It names the organization by handle and verified origin and the client by verified origin (organizations §5.2), says the home provider learns the organization and client (§12 item 7), and lists the `user` fields whose values the statement will carry.

## 6. Privacy and security

### 6.1 Disclosure by party

| Event | App | Home Y | Org provider X |
| --- | --- | --- | --- |
| Elements mount; chooser open | nothing | (already knows its memberships list) | nothing |
| Background directory refresh | nothing | O's member-listed apps | M's home refreshed; no app usage |
| User adds O by handle | nothing | the handle | a failing or succeeding member presentation |
| User selects O (first time) | after success: `EntityRef`, `(iss, sub)`, membership ID, projection | O × client consent | M uses client C (inherent, organizations §7) |
| Statement | resolved `user` values for O (same as its projection) | — | resolved `user` values the person chose to share |
| Silent restore | O again, or nothing | — | a fresh exchange |
| Failure of any kind | `canceled` only | the reason (shown in the island) | uniform 401 |

### 6.2 Properties

- **No membership oracle to the app:** no list, count, order, availability, size, focus or timing signal before selection (§1.2, §5.1); selection only by activation inside the island (§1.5); uniform `canceled`.
- **No customer-list oracle:** apps never hand their organization lists to anyone (option b rejected). X lists apps only to authenticated members, and only those O lists to members.
- **No app-usage oracle at X:** directory fetches are whole-list and scheduled independently of usage (§2.4).
- **Consent at home first:** no member-access certificate or statement without the (O, client) consent naming both (§5.6); no directory certificate without the (O, Y-console) consent.
- **Effective authority narrows only:** the projection and every call stay under organizations §6.2. Layers change values, never authority; a resolved resource still needs the grant (§3.4 rule 4).
- **Cross-organization correlation:** a statement carries only values for its own `aud`. Y never tells one organization about another. Two organizations on the same X can link a member only as they already could. An app the person uses in several contexts can link them, as organizations §12 item 5 already states, and identical `user` values add nothing beyond the `(iss, sub)` the app already sees.
- **Admin visibility:** O's integrators see defaults, locks and IM values, never U0/U1 or statements (§3.5).
- **Forged or replayed statements:** bound to `aud`, `client`, `cnf.jkt` and the certificate lifetime; verified like certificates; X ignores a statement whose `jkt` differs from the token's.
- **Malicious organization:** it can lock only `lockable` fields; it cannot read the person's other organizations or personal resources; resource fields in O come only from O's pool.
- **Malicious app steering:** the app cannot pre-select or highlight tiles; the island decides content.

### 6.3 Leaving an organization, or O removing the app

- **Member leaves or is removed (organizations §5.4):** X ends member-context tokens and deletes the stored statement. The app gets `bindle-entity-change {cause: 'revoked'}` and `member-removed`. At Y, the next directory refresh fails uniformly, O becomes unknown, silent restore stops (§1.4), and after 30 days Y offers to forget O. U1(P, O) is deleted on forget, or 90 days after the first failure with a notice.
- **O disconnects the app, or unlists it:** the next refresh drops the app from O's list. Silent restore stops. A current session ends at X's next live check. U1 is kept while O remains in the list (O may reconnect).
- **Person deletes their home account:** U0, U1, the known list and last-used pointers are deleted with the account. Statements at X expire with their tokens (≤ 11 min) and are deleted at membership end.

### 6.4 Export and deletion per layer

| Layer or record | Exported by | Deleted when |
| --- | --- | --- |
| U0 | the person, at Y (existing preferences export) | the person clears it, or account deletion |
| U1 (per O) | the person, at Y, grouped by organization | reset, forget O, the §6.3 rules, account deletion |
| Known organizations, last-used contexts, directory cache | the person, at Y | forget, account deletion |
| I (including defaults and locks) | the entity's export | the entity's owner interface |
| IM | O's export; the member can view their own | O's owner interface; membership end per O's retention |
| Stored statements | not exported (the person's data, re-derivable at Y) | token expiry, membership end, connection removal |

## 7. Spec impact

**Bindle (proposed amendments, unsigned):**

| ID | Document | Change |
| --- | --- | --- |
| AMD-L1 | protocol §3; extensions rev 3.4 (new §3a "Layers") | `layer` and `lockable` rows; validity rules (§4.2); the resolution function (§3.3); the resource rule (§3.4). Replaces AMD-O11. "Applications cannot write preference values" unchanged. |
| AMD-L2 | contracts: preferences v2 (v1 dropped 2026-10-29) | `sources` member; `revision` covers all layers (§3.6). Pre-release in-place rewrite; lock digests change. |
| AMD-L3 | organizations §7 (new §7.6), §8, §12, §14, §16 | Member app directory and the `member_directory_endpoint` option (§2.4); `member-directory` purpose (AMD-O12 list); user-layer statement at the token endpoint (§3.5); §8 replaced by `layer: member`; privacy items for statements and directory; conformance tests (uniform directory failure, statement binding, no admin visibility). |
| AMD-L4 | keys §4 | `bindle-user-preferences+jwt` signature-domain row. |
| AMD-L5 | protocol §2 client-id-metadata; client registration | `bindle_contexts` (§1.3). |
| AMD-L6 | components profile; embed islands §4, §10, §13 | `account-switcher.v2` with the contexts view; `bindle-entity-change` cause `restored`; constant-shape rules for the contexts view. |
| AMD-L7 | incremental authorization §5 | `configure` in member context opens the person's layer (§3.7). |

**3sln.me (policy and product, not spec):** the chooser order and sections; the "Listed to members" default; refresh cadence and retention (30 days, 90 days); consent copy; the editor and console views; release-gate rows (no list signal before selection across 0–8 organizations; directory fetch independent of app use; statement never shown to admins; lock only with `lockable`).

## 8. Implementation plan (engine-first)

All behaviour as ngin Actions/Queries, tested at the engine level with edge cases and seeded chaos; HTTP routes, islands and elements are thin adapters. New flag `PREFERENCE_LAYERS_ENABLED` (default off), and the existing `ORGANIZATIONS_ENABLED`, `MEMBER_CERTIFICATES_ENABLED` and `ORG_FOREIGN_MEMBERS_ENABLED`.

| Phase | Scope | Main files (proposed) | Evidence |
| --- | --- | --- | --- |
| L0 | Spec text for AMD-L1–L7 after owner answers; validators: `layer`/`lockable` rows and §4.2 rules in `packages/core/fragments.mjs` and `packages/federation/schema.mjs` (fixing the CR-X3-30 disagreement in the same pass) | specs; validators | fail-closed vectors for every invalid combination; unsupported at a rev 3.3 provider |
| L1 | Pure resolution function `packages/core/preference-layers.mjs` (§3.3), shared by every host; U1 store and editor queries at Y; locks and defaults at X; projection merge with `sources` in `service.mjs` and `member-access.mjs`; statement issue and verify, same host | `packages/core/preference-layers.mjs`, `packages/identity/member-certificates.mjs` (statement), `packages/federation/member-access.mjs` | exhaustive table tests (every layer × context × field kind); seeded chaos over edits, locks and membership ends; `npm test` |
| L2 | Chooser engine at Y: known organizations (from consents, same-host memberships, added), member app directory at X (same host), refresh scheduler, last-used and silent restore; `account-switcher.v2` contexts view; element `entity="auto|choose|personal"`, cause `restored`, trigger badge; editor and console views | `packages/orgs/member-directory.mjs`, `packages/identity/org-contexts.mjs`, `apps/embed/src/parts/account-switcher.mjs`, `packages/sdk/src/elements/session.mjs`, `apps/web/src/ui/…` | C2 probes for 0–8 organizations (size, scroll height, Tab count identical); browser gallery shots (W1 harness); en/es; light/dark; 390/1280 |
| L3 | Cross-provider: directory fetch over HTTP with foreign certificates, statement across hosts, add-by-handle; `tests/sim` scenarios (two providers, member at Y in an organization at X, app on its own origin, leave and unlist mid-session) | the same modules with egress ports | simulation G-checks; still self-consistency, not interop |
| L4 (phase C) | Offered-set resource choice in U1 (§3.4 rule 3); `member` resource fields; a rail variant of the contexts view with fixed sizes | — | separate design review |

Ownership note: the elements and islands stream currently owns `packages/sdk/src/elements/**` and `apps/embed/**` CSS. L2 island work should start after W2/W5 land, or with that stream as writer.

## 9. Open owner questions (each with a recommended answer)

1. **Member name and shape:** one `layer` member (`integration` | `member` | `user`) plus `lockable`, replacing §8's `scope: "member"`? *Recommended: yes.*
2. **Precedence:** does the person's value outside any organization outrank the organization's default? *Recommended: yes; a lock or an organization-specific value outranks it.*
3. **Who decides lockability:** the publisher (`lockable`, default false), so organizations cannot lock accessibility-type fields the publisher considers personal? *Recommended: yes.*
4. **Resource fields chosen by the person in an organization:** none in v1 (the organization's values only), with an offered set in phase C? *Recommended: yes.*
5. **Cross-provider transport of the person's values:** the user-layer statement issued with the member certificate, also used on the same host? *Recommended: yes.*
6. **Chooser discovery:** home list plus member app directory (whole-list, background), add-by-handle fallback, uniform failure for unknown availability? *Recommended: yes; reject per-app queries and app-supplied lists.*
7. **Ordering inside the island:** Personal pinned, then last used with this app, then alphabetical? *Recommended: yes (recency is not observable to the app).*
8. **Accounts × contexts:** two levels in one island (option A)? *Recommended: yes.*
9. **`bindle_contexts` default:** `["personal"]`? *Recommended: yes.*
10. **"Listed to members" default** for an organization's connected apps on 3sln.me: on? *Recommended: on, switchable per app.*
11. **Retention of the person's organization-specific values after leaving:** delete on forget, or 90 days after membership loss is noticed, with a notice? *Recommended: yes.*
12. **Integrators delegating `integration` fields to members:** allowed? *Recommended: no in v1; publishers choose `user` for that.*
13. **Layered fields consumed by provider features:** invalid in v1? *Recommended: yes.*
14. **Error detail in the add-organization popup:** one message for every failure, although the person is the principal? *Recommended: yes for v1; revisit if support load shows a need.*
