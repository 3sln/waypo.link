# Extension catalogue — design spike

Status: **design spike, 2026-10-27. Documentation only.** No code, spec, DEVLOG or configuration was changed. Every recommendation here is **provisional (coordinator) and not signed off by the owner**. Sign-off: reviewer ___ / date ___ / outcome ___. Whatever is adopted from this spike goes into DEVLOG with its own blank reviewer/date/outcome line, and amendments to existing specs are written as proposals in those specs, not applied here.

Inputs: AGENTS.md; [protocol](../spec/protocol.md), [extensions](../spec/extensions.md), [extensibility design](extensibility-design.md); the 2026-10-27 scope audit (session scratchpad, read-only); DEVLOG through "2026-10-27 — Core-scope step 1"; and three read-only inventories of the repo (organizations, commands/automation, messaging intake). Code references are to the working tree at HEAD 9ba7c9b plus its uncommitted edits. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders.

## 0. Owner direction applied (2026-10-27)

- Core Bindle is "identity, preferences, intents, and resources; a hub for connecting things together".
- Messaging leaves core entirely. The free-marketing auto-response for mail sent to 3sln.me addresses stays. The messaging app fills a slot, and 3sln.me forwards to it.
- Organizations can be an extension. Relations go in the same spec: "bindle organizations as one cohesive spec".
- The activity feed is probably a 3sln.me feature, not a Bindle spec.
- Commands/automation become an extension spec. Apps contribute commands, and the provider exposes them as MCP tools, user commands and so on. "Provider should declare which extensions they support in the manifest."
- The email bridge is either a 3sln.me feature or a hook in the messaging extension. This needs a spike.
- Event buses stay in core, as a hub feature.

## Summary of recommendations

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Provider manifest | Keep the three containers. `features` becomes the one place a provider says which **extension specs** it implements. Amend protocol §2 so that registered Bindle extension specs may define feature identifiers, not only protocol.md. Add a feature registry with `requires` edges, and one declaration path in code. |
| 2 | Organizations | **Extension spec "Bindle Organizations"** (`organizations.v1` + `relations.v1`, organizations §3–§13). Four generic pieces move into a **new core identity-documents spec**: `directory.v1`, certification keys, the delegation-certificate framework (`key-delegation.v1`) and an open entity `kind`. No data migration is needed. Cost: M for the spec, M for the code. |
| 3 | Commands | **Extension spec "Bindle Commands"** (`commands.v1`). A command is a method on a contract the app contributes, plus declarative presentation. The provider's MCP endpoint becomes an ordinary Bindle protected resource, so the separate MCP OAuth issuer retires. This is not a slot. |
| 4 | Messaging intake | Confirmed: the owner remembers `public-message-intake/v1` (and `messaging-ingress/v1`), occupant and consumer declarations, and declaration `options`. Both slots move to a **"Bindle Messaging" extension spec** (today's messaging.md). The **email bridge is a 3sln.me feature** that consumes the generic intake slot. The extension gets no email-specific hook; the only addition is an optional `channels` occupant option. |
| 5 | Activity, notifications | The feed, push, reminders and rules become a **3sln.me feature doc**. One real protocol piece remains: the app-to-owner notice contract (`app-messages/v1`, activity admission and provenance). It becomes a small **"Bindle Notices" extension spec**. notifications.md is entirely a 3sln.me feature doc. |
| 6 | Event buses | **Core.** Fold AMD-C12 to C15 into the core documents as core text. Restate the built-in occupant special case as a core rule for class-wide built-in occupants. The audit's move-out suggestion is withdrawn. Add the missing `events.v1` manifest row. |
| 7 | Catalogue | §7: 39 specs placed. Core keeps 21, including the new identity-documents spec. There are 5 named extension specs (Organizations, Messaging, Signaling, Commands, Notices), 6 specs that become 3sln.me feature docs, and 7 retirements. |

---

## 1. Provider manifest: declaring supported extensions

### 1.1 What exists

The provider manifest ([protocol §2](../spec/protocol.md#2-discovery-and-login)) has three declaration containers, all under one processing rule set:

| Container | Identifiers defined by | States | Today |
| --- | --- | --- | --- |
| `features` | "this specification only" (protocol §2), pattern `name.vN` | Which optional Bindle parts the provider implements | The protocol §2 table lists 8 features. Other specs define at least 10 more in their own text: `directory.v1`, `organizations.v1`, `key-delegation.v1`, `relations.v1` (organizations §14), `portability.v1`, `events.v1`, `app-removal.v1`, `subject-deleted.v1`, `artefact-versions.v1`, `rtc-signaling.v1`/`signaling.v1`. |
| `extensions` | Slot publishers (slot URLs) | Which slot roles the provider can occupy (built-in occupants) or consume (provider features) | Implemented behind `EXTENSIONS_ENABLED` (AMD-C6, provisional). |
| `profiles` | Third parties (HTTPS keys) | Which third-party specs the provider implements | Used once: the 3sln.me components profile. |

Applications state their own participation in the `extensions` array of their integration manifest (`bindle_integration`, [integrations §2.2](../spec/extensions/integrations.md)). Each entry can carry `options`, validated against the slot's `options.occupant` or `options.consumer` schema ([extensions §2.1, §4.1](../spec/superseded/extensions-rev2.md#41-the-extensions-array)).

In code (`packages/runtime/federation.mjs`, `MANIFEST_DECLARATIONS`), declarations come from an append-only registry of `{flag, mounted, declare}` rows: a flag alone never declares, the adapter must also report the mount. That is the right shape.

### 1.2 What is missing

1. **Nowhere to define extension-spec features.** `features` is reserved to "this specification". A named extension spec published by Bindle but outside protocol.md (Organizations, Commands, Messaging) has no legitimate place for its identifier. The specs work around this by writing their own feature tables and proposing "add a row to protocol §2" amendments (AMD-C12, AMD-O10 and others). Every extension then becomes a core edit, which is the opposite of the owner's intent.
2. **No registry.** No single index lists every feature identifier, its owning spec, its members or its prerequisites. Prerequisites live only in prose. For example, `signaling.v1` requires `directory.v1`, `extensions.v1` and `artefact-versions.v1`, and `brokered-resources.v1` requires `integrations.v1`.
3. **Two declaration paths in code.** `directory.v1`, `key-delegation.v1`, `organizations.v1` and `portability.v1` are added by a wrapper in `packages/runtime/routes/directory.mjs`, outside `MANIFEST_DECLARATIONS` and on flags alone. That breaks the "mounted, not just flagged" rule the registry enforces.
4. **A declared-in-spec feature no code declares.** `events.v1` (events §13) has no declaration row, although `EVENT_BUSES_ENABLED` mounts hosted buses.
5. **Budget.** `features` is capped at 32 members. The full catalogue below uses about 22, which fits, but the cap should be reviewed once the registry exists.
6. **Terminology clash.** "Extension spec" (a document) and the `extensions` array (slot participation) share a word. Readers already conflate them.

### 1.3 Proposal

- **P1. `features` = supported extension specs.** Amend protocol §2: a feature identifier is defined by protocol.md *or by a Bindle extension spec listed in the feature registry*. The pattern, bounds, processing, claim and downgrade rules are unchanged. A provider declares an extension spec by declaring that spec's feature or features. Third-party specs keep using `profiles`, and slot participation keeps using `extensions`. This answers "provider should declare which extensions they support in the manifest" with the existing container, so no new top-level member is needed.
- **P2. Feature registry.** Add a machine-readable index next to the contract registry, for example `/artefacts/features/index.json`. Each row holds `{id, spec, members_schema, requires: [feature ids], status}`. Normative rule: a client treats a declared feature whose `requires` are not all declared as absent. That is one generic rule instead of one in each spec.
- **P3. Extension spec template.** Each named extension spec owns: its feature identifiers and members; its slots, contracts and artefact kinds; its integration-manifest members, if any; and its own conformance section. Instead of "core amendments", it uses **core extension points**. Those are generic hooks written once in core: unknown values ignored, and a named place where extensions register rows, such as the signature-domain table, certification-key uses, event types and token forms.
- **P4. One declaration path.** Move the `routes/directory.mjs` declarations into `MANIFEST_DECLARATIONS` rows with `mounted` checks, and add the `events.v1` row. This is code work for later and is not done here.
- **P5. Terminology (owner question).** Either rename the `extensions` array to `slots` (cheap: nothing is published, and AMD-C6 is provisional) or always write "slot declarations" in prose. The spike recommends the rename.

Example (placeholders):

```json
{
  "version": "0",
  "issuer": "https://provider.example",
  "features": {
    "extensions.v1": {},
    "integrations.v1": {"hint_endpoint": "https://provider.example/api/integrations/hints"},
    "directory.v1": {"directory_url": "https://provider.example/bindle/directory"},
    "key-delegation.v1": {"max_certificate_seconds": 3600, "revocation_bound_seconds": 60},
    "events.v1": {"hosting": true, "push": true, "event_bus_contract": "https://spec.bindle.example/contracts/event-bus/v1"},
    "organizations.v1": {},
    "relations.v1": {"accept_endpoint": "…", "join_endpoint": "…", "events_endpoint": "…"},
    "commands.v1": {"mcp_endpoint": "https://provider.example/mcp"}
  },
  "extensions": [
    {"slot": "https://spec.bindle.example/slots/public-message-intake/v1", "role": "consumer", "ref": "email-bridge",
     "purpose": "Delivers email sent to your public address."}
  ]
}
```

---

## 2. Organizations: extension or core?

### 2.1 What the organizations spec already is

[organizations.md](../spec/extensions/organizations.md) (rev 4.5, unsigned) is already shaped like an extension. It has its own feature table (§14: `directory.v1`, `organizations.v1`, `key-delegation.v1`, `relations.v1`), provider roles, and a list of core amendments, AMD-O1 to O14, none of which has been applied. Since 2026-10-22, by the owner's decision, its scope is "party boundaries only": membership and internal grants are provider policy. Billing, seats, break-glass governance, templates and the relation catalogue are already placed under 3sln.me policy (organizations-design §7.1).

### 2.2 Every core dependency on organizations

| Dependency | Where | Really about orgs? | Disposition |
| --- | --- | --- | --- |
| **Identity documents and handle lookup, `directory.v1`** (§3a) | Normative for [identity-portability](../spec/extensions/identity-portability.md) (§3 `portability.v1` requires it; §6–§8 extend it), [signaling](../spec/extensions/signaling.md) (§3 requires it; handle lookup §3a.2; verification §3a.4–§3a.5), [Bindle Messaging](../spec/extensions/messaging.md) §3.3, [contact-delivery](../../apps/parlay/docs/legacy/contact-delivery.md), [links §7.3](../spec/extensions/links.md). Code: `federation/directory.mjs` (used by `runtime/account/rtc.mjs` and `foreign-directory.mjs`); portability has its own client in `identity/successors.mjs`. | **No.** §3a says itself it is "specified here because organizations need it first. It MAY later move to a companion document unchanged." | **Core**: a new identity-documents spec. |
| **Certification keys** (`cert` keys in the identity document, uses separated by `typ`) | Member and entity certificates, intents signed form (AMD-I5), relation events, signaling leg certificates (AMD-SG-K1). Code: `identity/member-certificates.mjs` also holds the generic `certificationSigner` and `certificationKeyList`. | **No.** Four features use them, and only two are org features. | **Core**, with a registered table of uses as an extension point. |
| **Delegation certificates, `key-delegation.v1`** | Proposed in messaging §3.2. Generalized by AMD-O12 to three profiles: Parlay delegate, member certificate, entity certificate. Signaling reuses the `cnf`/`delegate` members of §5.2. | **The framework, no; the member and entity profiles, yes.** | The framework goes to **core**. The member and entity profiles go to the **Organizations extension**, and the delegate profile to the **Messaging extension**. |
| **Entity kind** (`kind: person \| organization`; protocol §1 "or, later, an organization") | AMD-O1 (protocol §1/§6), the identity document `kind`, portability move statements §4. Code: `identity/service.mjs` refuses login, authorization and recovery when `kind==='organization'` (via `identity/organizations.mjs`); `identity/lifecycle-protection.mjs`, `transfer-in/out.mjs`, `authority-epoch.mjs`. | **Partly.** "An entity no one signs in as" is generic; for example, signaling §4.3 already wants service entities. | **Core hook**: the entity `kind` is an open vocabulary (absent means `person`, unknown values are non-interactive). The value `organization` is defined by the extension. |
| **Owner interface wording** (AMD-O2: "the entity's owner interface" replaces "the user's provider UI") | protocol §3 | No | **Core** wording change. |
| **Authority epoch `aep`** | Defined in organizations §2/§5.2a, used by portability §5.3, recovery-identity, `identity/authority-epoch.mjs`. | **No.** It is an identity-level reset counter. | **Core** (identity documents). |
| **Origin principal `(iss₀, sub)` and `principalKey`** | Now in `packages/core/principals.mjs` (2026-10-27 step 1); part of stored keys `org/member/…` and `rel/cp/…`. `rtc` still imports it through the `orgs/grants.mjs` re-export, and `orgs/certificates.mjs` has a duplicate `memberPrincipalKey`. | No | Already **core**. Remove the re-export and the duplicate. |
| **Org entities as principals in grants** | `orgs/grants.mjs` `attach(service)` patches `FederationService` (`tokenRecord`, `projectV2`, `readPreferences`, wired at `federation/service.mjs:81`); `federation/device-authorization.mjs` member-token DPoP RPC; `runtime/federation.mjs` (`memberAccess`, `organizationPreferences`, `organizationConfigure`). | **Yes** (member context, AMD-O3) | **Extension**, through a generic core hook: *extension-defined token forms*. An extension feature may define an additional grant type and authorization scheme. Core requires that such tokens still go through the protocol §4 intersection. The `attach` patch becomes a declared federation port instead of monkey-patching. |
| **Consent and intents** | intents §6 (an organization acts only through member context), §8 item 4; code `intents/index.mjs:7` and `router.mjs:38` exclude org-installed connections. | Yes | **Extension**. Intents keeps a generic rule: "a non-interactive entity is never a viewer". |
| **Storage** | No org branches in `packages/storage`. | — | None. |
| **Events** | AMD-O6: the `entity` reader kind and doorbells to an entity grantee. | Yes | **Extension**, through a core hook: `readers` and `publishers` are extensible vocabularies, and unknown values confer nothing. |
| **Integrations** | AMD-O4 (counterparty kinds, `member-removed`, `relation-introduction`), AMD-O5 (relay projection `BindleEntity`, `bindle.actor`). | Yes | **Extension**, through core hooks: registered event types, and preferences-v2 projection `token_type` values. |
| **Links** | AMD-O7: invitation link types and signature-domain rows. | Yes | **Extension**, through the links type registry and the signature-domain table (already extension points in practice). |
| **App removal** | §4.1, §6.2, §8.2, §9.6; code `app/domains/app-removal.mjs:35` `removalPolicy`. | Yes | The extension adds rows. Core keeps a generic hook: "an extension may add removal steps". |
| **Artefacts** | AMD-O14: the `relation` artefact class; artefacts line 156. | Yes | **Extension** registers the kind (artefacts §6 already allows it). |
| **Identity owner channels** | `identity/owner-channels.mjs` imports `orgs/break-glass`. | Yes (3sln.me policy) | Invert the dependency: break-glass registers into owner channels. |
| **Billing** | `billing/organizations.mjs` (Polar, sandbox), `org/billing-event/`, `runtime/account/billing.mjs:30` webhook routing. | **Not Bindle at all** | **3sln.me feature.** Stays in the host, fenced behind ports. |

### 2.3 What stays in core as generic hooks

1. **Identity documents** (a new core spec, carved out of organizations §3a with its text unchanged): `directory.v1`, handle and `?sub=` lookup, the identity document, `sig`/`enc`/`cert` keys, caching, pinning, continuity, no-rollback, the verification order, and `aep`.
2. **Entity kind**: an open enumeration in the identity document and protocol §1. The core rule is that a non-`person` entity has no interactive login and acts only through the mechanisms its defining extension specifies.
3. **Delegation certificates**: the `key-delegation.v1` framework (JWS profile shape, `cnf`, status lookup, lifetime and revocation-bound members) with a profile registry.
4. **Registered tables**: certification-key uses (`typ`), link signature domains, integration event types, preferences-v2 `token_type`, bus reader kinds, token forms and grant types. Each is a core table that extension specs add rows to.

### 2.4 Recommendation: extension

**Bindle Organizations** becomes one named extension spec covering organizations §1–§2 and §3–§13 (entities, connections and counterparties, membership, member certificates, effective authority, member context, member-scoped fields, relations, imported resources, cross-entity buses, privacy, export), with features `organizations.v1` and `relations.v1`. Organizations and relations stay together, as directed.

Why this is clean:
- The spec already separates its contract from provider policy, and declares its own features.
- Every AMD-O amendment is either generic (it goes into core as one of the hooks above) or an org-specific row in an existing table.
- No core spec except intents depends normatively on organizations *outside §3a*. Portability, signaling, Parlay, contact delivery and links depend only on §3a, which moves to core.
- Break-glass, ownership transfer, billing and governance are already 3sln.me policy. They go into a 3sln.me "organizations" feature doc built from organizations-design §12 and the break-glass sections.

**Extraction cost:**
- **Spec: M.** Carve §3a and the delegation framework into identity-documents (S, a move). Rewrite §15's AMD-O list as hook registrations (S–M). Repoint references in portability, signaling, Bindle Messaging, contact-delivery, links and intents (S).
- **Code: M.** Move `identity/organizations.mjs`, `identity/entity-certificates.mjs` and the org parts of `identity/member-certificates.mjs` into `packages/orgs`, keeping `certificationSigner` and `certificationKeyList` in identity. Replace `orgs/grants.attach` with a declared federation token-form port. Replace the `kind==='organization'` checks in identity, intents and app-removal with a generic `interactive(kind)` / non-interactive-entity predicate. Invert the owner-channels → break-glass import. Move the directory-route declarations into `MANIFEST_DECLARATIONS`.
- **Data: none to migrate.** Organizations and relations data exist only in local development stores, and every org flag is off with no deployment (DEVLOG; not independently inspected). Storage families (`org/*`, `orgs/*`, about 50 `rel/*`) keep their key prefixes, because the extraction is a spec and package boundary, not a storage change. The `principalKey` encoding is unchanged.
- **Pre-existing finding, not fixed here:** `packages/runtime/export-contributors.mjs` has no rows or exclusions for `org/`, `orgs/` or `rel/`, although organizations §13.1 requires a portable membership export. Record it in DEVLOG when this spike is taken up.

**Rejected alternative: keep orgs in core.** This would put a second kind of party, governance-adjacent concepts and about 6.3k lines of flags-off code into the mandatory core, with nothing in identity, preferences, intents or resources requiring it.

**Rejected alternative: split relations off on their own,** as the scope audit suggested. The owner wants one cohesive spec, and relations use entity certificates, member context and org identity throughout.

---

## 3. Commands and automation extension

### 3.1 Inventory

| Item | State |
| --- | --- |
| [mcp-service](../3sln/services/mcp-service.md) | By its own words it does "not extend the Bindle protocol or reuse its grant namespace". It runs a separate OAuth issuer at `/mcp/oauth`, with operator-registered clients only, `mcp:<tool>` scopes multiplied by collection IDs, and its own consent and grant records (`mcp/v1/*` across 64 shards). Its five tools (`collections_list`, `items_list`, `item_read`, `item_write`, `item_delete`) work over inbox and storage collections, which are mostly messaging and leave with BB-CUT. |
| [browser-automation](../3sln/services/browser-automation.md) and [design](browser-automation.md) | Portal WebMCP over the same five tools. `prepare`/`confirm`/`invoke` with a 2-minute receipt bound to an argument fingerprint. Session grants are registered as an app connection. |
| [callables and user commands](callables-and-user-commands.md) (D060, D061, D064: the owner approved the direction, but the adapter review is blank) | **The key prior design.** A callable is an existing (resource, contract, method) binding with a pinned revision, schema and effects. The palette, forms, MCP and WebMCP are adapters over that one operation, with "neither a second action registry nor a permission namespace". There is an optional declarative `userCommand` (`label`, `description`, `argumentHints`, `icon`), and effect gating (non-read effects need trusted review). It is implemented as `packages/portal/callable-commands.mjs`, tested against real grants, and wired into no UI. |
| [resource-contributions](../spec/extensions/resource-contributions.md) | An app connection is an owner-scoped resource with individually granted methods. MCP import maps an app's MCP tools into pinned generated contracts, with no `tools_call` tunnel. The "3sln MCP adapter" section projects granted methods as opaque MCP tool names and re-runs the Bindle authorization intersection on `tools/call`. The "Optional user-command presentation" section is the normative `userCommand` text. |
| Method metadata | `x-methods` `effect: read \| pure` and `introspect` (AMD-C10, contracts). `effect: write \| destructive`, localized `summary` and `categories` (AMD-C16, incremental-authorization §8.1). |
| `packages/automation`, `packages/mcp` | Zod tool catalog (`{name, label, readOnly, destructive}`), MCP SDK 2.3.1 stateless HTTP, and the `McpAuthorization` AS. |
| `packages/portal` | Contribution kinds include `commands` and `keybindings`, but only for trusted built-in modules. The palette is built in `apps/web/src/bl/release.mjs`. |

The gap every document names is the unbuilt "OAuth-to-Bindle grant bridge".

### 3.2 Shape: a feature plus method metadata, not a slot

A slot is the wrong container. Slots hold at most 8 owner-assigned occupants under one selection policy. Commands come from every connected app, many per app, and need no selection policy: each command is an independent method grant. The right building blocks already exist: contributed resources, contract methods, method metadata and grants.

**Bindle Commands** (`commands.v1`) defines four things.

1. **The command declaration** is a member on a contract method's pinned metadata, beside AMD-C10/C16 `effect`, `summary` and `categories`:

   ```json
   "x-methods": {
     "createTask": {
       "effect": "write",
       "summary": {"en": "Create a task in your list."},
       "categories": ["personal-data"],
       "x-command": {
         "v": 1,
         "label": {"en": "New task"},
         "description": {"en": "Adds a task with a title and optional due date."},
         "argumentHints": {"title": {"en": "What needs doing"}, "due": {"en": "Optional date"}},
         "surfaces": ["user", "agent"]
       }
     }
   }
   ```

   - `surfaces` is a request, not authority. `user` means eligible for human command surfaces (palette, menus, forms). `agent` means eligible for agent surfaces (MCP, WebMCP).
   - The bounds and exclusions are as in resource-contributions "Optional user-command presentation": no executable content, no HTML, no defaults, no app-supplied confirmation UI, and hints only for existing schema fields.
   - The presentation digest is tracked separately from the semantic pin, so a label change never forces reconsent and never retargets a binding.
   - Missing `effect` means `write` (AMD-C16). It is never treated as read-only.

2. **Where apps list command sources.** The integration manifest gets a member `bindle_integration.commands: [{contract, digest?}]`, at most 16. It names the contributed contracts whose `x-command` methods are offered. Apps without an integration manifest contribute through the existing resource-contribution record. The member is informational, like slot declarations: it creates no grant.

3. **Authorization reuses Bindle grants, with two separate grants:**
   - **The owner's own use** (palette, forms): owner session authority over the owner's own app resource. This already exists for owner-local resources, and still requires effect review for non-read effects.
   - **Agent use:** an agent (an MCP client, or a WebMCP page session) is an **ordinary Bindle OAuth client** of the provider. It requests a fragment grant over the app resources and exact methods it wants, or the provider presents a "choose commands" consent listing eligible methods. The resulting grant is a normal grant record: it shows in grant listings, is revoked through the normal paths, and is checked per call by the protocol §4 intersection. **The separate MCP issuer, `mcp:` scope namespace and `mcp/v1/*` grant store retire.**
   - MCP's HTTP authorization profile needs an OAuth AS with protected-resource metadata. The provider's Bindle AS is that AS. MCP clients identified by URL map onto `client-id-metadata.v1`, which matches MCP's client ID metadata documents. The MCP endpoint's protected-resource metadata names the Bindle issuer. Tokens are ordinary Bindle access tokens with the MCP endpoint as audience.

4. **How the provider exposes commands** (`commands.v1` members):
   - `mcp_endpoint` (issuer origin): MCP Streamable HTTP. `tools/list` returns only methods the presented token's live grant covers, under opaque stable tool names mapped server-side to (owner, resource, binding revision, contract, method). `tools/call` re-runs authorization and effect review. This is the resource-contributions "3sln MCP adapter" text, promoted.
   - `webmcp: true`: the provider's own pages register granted commands with the page's model context. This is the browser-automation design, generalized from five fixed tools to granted commands.
   - User command surfaces need no declaration. They are provider UI.
   - **Effect review** is normative across surfaces. `read` and `pure` may run directly. `write`, `destructive`, external communication and spending need trusted owner review bound to (owner, caller, grant generation, pinned operation, input digest, expiry). A person confirming an agent's call does not raise the agent's authority.
   - **MCP import (optional):** the resource-contributions importer that turns an app's MCP server into pinned generated contracts belongs here as an annex, so an MCP-only app can still contribute commands.

What becomes of the existing documents:
- mcp-service → retired. Its adapter rules live in Bindle Commands, and its HTTP and operational details in a 3sln.me feature doc.
- browser-automation → 3sln.me feature doc (the portal WebMCP surface).
- callables-and-user-commands → rationale for the extension.
- The five collection tools disappear with messaging. Storage operations, if wanted, become built-in commands over `object-storage/v1`, declared by the provider as a built-in contribution.

**Cost:**
- **Spec: M.** Most of the text exists across callables, resource-contributions and mcp-service.
- **Code: M.** Replace the `McpAuthorization` AS with Bindle token validation at the MCP endpoint. Generate `tools/list` from grants. Wire `callable-commands.mjs` into the palette.
- **Data:** the `mcp/v1/*` and `automation/*` rows are local and disposable (flags off). MCP client registrations re-register as Bindle clients.

---

## 4. Messaging intake and the auto-response

### 4.1 What the owner remembers: confirmed

The "slot for that integration/app kind" is real and specified. Two exclusive slots exist, both currently published in [messaging §2.1, §9](../spec/extensions/messaging.md) and copied under `apps/parlay/slots/`:

| Slot | Occupant (contract) | Consumers | Purpose |
| --- | --- | --- | --- |
| `…/slots/messaging-ingress/v1` | The messaging app's mailbox (`describe`, `linkRevoked`) | Provider only: the `messaging-address` feature (`MESSAGING_ADDRESS_DECLARATION`, `packages/links/types.mjs`) | Tells contact-link holders where to deliver peer messages. |
| `…/slots/public-message-intake/v1` | The messaging app's intake resource (`public-intake/v1.deliver({message, provenance})`, effect `write`, idempotent per `tx`) | Provider: the `email-bridge` feature. Application consumers (third-party channel bridges such as SMS) are deferred (messaging §9, review fixes 2026-10-27). | Receives messages arriving from outside Bindle, such as email to a public address. |

"Options/metadata in the bindle manifest for the extension it implements" is also real: every `extensions` entry, in the provider manifest and in an app's integration manifest, may carry `options`, validated against the slot's `options.occupant` or `options.consumer` schema ([extensions §2.1, §4.1](../spec/extensions.md)). Options describe only the declaring party and grant nothing. **Neither messaging slot defines an options schema today.** The only defined one is the classifier's `label`.

### 4.2 How it works today (local, flags off)

1. **Declarations.** 3sln.me declares `{"slot": "…/public-message-intake/v1", "role": "consumer", "ref": "email-bridge"}`. The app declares `{"role": "occupant", "ref": "mailbox"}` in its integration manifest (`apps/parlay/integration.json`).
2. **Filling the slot.** Only the owner fills it, in 3sln.me's own interface: never preselected, and never offered inside the app's authorization flow. Separately, the owner enables the email-bridge feature (extensions §5.3).
3. **The check.** When an email arrives, the bridge asks the account `integrationsIntakeSeat` (`packages/runtime/account/email-bridge.mjs`). That requires an entitled paid plan, `INTEGRATIONS_ENABLED` and `BROKERING_ENABLED`, exactly one occupant of the exclusive slot, and an available brokered record assigned to the `email-bridge` consumer. `integrationsIntakeDeliver` rechecks the seat, then calls `deliver` at the app with a provider-signed provenance JWS (`bindle-intake-provenance+jwt`) and `tx` = UUIDv5(feature ref, contract, entity, ingress fingerprint).
4. **Slot empty.** The mail is **held**, with no SMTP difference. It sits in the per-owner queue with `reason: 'no-occupant'` and retries every 15 minutes, for at most 7 days minus 1 hour. The design says 30 days, but the occupant bounds `receivedAt` to 7 days, so the code uses the shorter hold; this is flagged for sign-off.
5. **The auto-response (free marketing).** It is decided from sender gates only: aligned envelope/From/Reply-To, DMARC, RFC 3834, no automation headers, a 30-day per-sender cooldown, and per-recipient, per-domain and global daily caps. It is **invariant**: one fixed text ("This address receives messages through Bindle … To start a conversation, get Bindle: <link>"), sent whether or not the slot is filled. Extensions §9.8 and messaging §9 forbid any SMTP or reply behaviour that varies with occupancy, so a sender cannot learn whether the owner has a messaging app. Intake, and therefore the reply, is paid-only and owner opt-in. A one-time follow-up is sent when the occupant accepts the message.

So **3sln.me does check whether the slot is filled**, but only to decide between *deliver* and *hold*, never to decide what the sender sees. If the owner wants "auto-reply only when no app fills the slot", the oracle rule must change. That is an owner question (§8, Q2). The spike recommends keeping the invariant reply: it still advertises Bindle on every accepted email, which is the marketing value.

**Fixed 2026-10-27** (DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"): `docs/artefacts/slots/public-message-intake-v1.json` (field `occupant`, consumers provider only, as messaging §9 after the 2026-10-27 review fixes) is now the only copy; `PUBLIC_INTAKE_MANIFEST` imports it and Parlay pins its digest (`tests/messaging-cut.test.mjs`). The ingress slot got the same treatment. Original finding: **Defect to fix when the spec moves:** the core copy of the intake slot (`PUBLIC_INTAKE_MANIFEST`, `packages/apps/connections.mjs:34`) differs from the app copy. It uses field `occupants` instead of `occupant`, `consumers: ["provider"]` instead of `["provider", "application"]`, and different text. A slot is identified by URL and pinned by digest, so the two cannot both be right. Only the publishing spec's copy should exist.

### 4.3 The email bridge question

| | (a) Pure 3sln.me feature | (b) A hook in the messaging extension |
| --- | --- | --- |
| What is specified | Nothing about email in Bindle. 3sln.me runs SMTP ingress, address policy, eligibility and the auto-reply, and hands off through the generic intake slot. | The extension adds an email-specific declaration (an app says "I bridge email") and a provider plug-in contract for SMTP. |
| Interop value | High where it matters: any messaging app that occupies `public-message-intake/v1` receives bridged mail from any provider that runs a bridge. | Low extra value. Email specifics (DMARC, RFC 3834, backscatter, paid gating) are operator policy that differs per provider, and standardizing them adds no cross-party guarantee. |
| Risk | None new. | It turns operator mail policy into protocol and invites providers to differ under one name. |
| Owner's "slot" model | Kept. The slot is the hook; email is just one `channel` value in provenance. | Duplicates the slot with an email-only mechanism. |

**Recommendation: (a), keeping the generic slot as the hook.**
- The **Bindle Messaging extension** owns `public-message-intake/v1`, `public-intake/v1` and the provenance format, all channel-neutral (`channel: "email" | "sms" | …`).
- The **email bridge** is a 3sln.me feature doc, built from public-email-bridge.md plus messaging-app §13: addresses, SMTP, hold, auto-reply, paid eligibility.
- The only addition to the extension is an optional, declaration-only occupant option in a v2 of the slot, so 3sln.me can show "accepts email" next to a candidate app:

  ```json
  "options": {"occupant": {"channels": {"type": "array", "items": {"type": "string", "maxLength": 32}, "maxItems": 8}}}
  ```

  This is a claim and confers nothing. An occupant still answers `refused` for a channel it does not accept. The occupant's declaration would read `{"slot": "…/public-message-intake/v2", "role": "occupant", "ref": "mailbox", "options": {"channels": ["email"]}}`. Adding it is a new slot URL (extensions §7). Since nothing is published, v1 can simply be corrected instead.

---

## 5. Activity and notifications

### 5.1 Activity

The owner is right that the **feed is a 3sln.me feature**. But [activity.md](../3sln/services/activity.md) is not mainly about the feed. It specifies what an *app* may submit to the *provider*: admission under an explicit method grant on the account's activity resource, app attribution, signed admission evidence, namespaced tags, create/replace/retract with revisions, retries and collapse, limits, and the rule that apps never read the owner's read state or feed. Its v1 binding is the published contract `app-messages/v1` (`createOwn`) with a preference fragment, called by third-party apps through the SDK (`userMessage`). That part is protocol: an app written against it works with any provider that implements it.

| Part | Destination |
| --- | --- |
| App → provider notice contract: `app-messages/v1` (renamed, for example `notices/v1`), its fragment, admission, attribution, revisions, idempotency, limits, privacy of recipient state, `priority` as advisory | **Bindle Notices** (a small named extension spec, feature `notices.v1`). It merges app-messages.md and the interop parts of activity.md. |
| Signed admission evidence (canonical format, key discovery) | Notices. It is optional in v1 and becomes required before the feature is advertised, as activity.md already says. |
| Content profile | Notices v1: plain text plus a bounded link list. Whether notices may carry message-content HTML and forms is an owner question (§8, Q3). If not, message-content moves to Bindle Messaging. |
| Feed layout, filters, read/archive, rules, tag UI, provider-source items (held invites and similar, signaling AMD-SG-A1), push routing, multi-account destinations | **3sln.me feature doc** ("Activity center"), from activity-center.md and app-notifications.md. |

Why an extension and not core: the core pillars do not require any provider to present notices. A provider that does not show app notifications should still be fully conforming. **Alternative:** keep `notices/v1` as a core well-known contract with no feature, listed in `contracts`. That is equally cheap and avoids a sixth named spec; this is owner question Q3.

Two dependencies need rewording:
- **Signaling.** Signaling (AMD-SG-A1) should require only that the provider makes held and unanswered invites visible to the owner, without interruption. It should not depend on the notices or activity documents.
- **Events.** events §11 ("bus records never become activity") still holds with Notices.

### 5.2 Notifications

[notifications.md](../3sln/services/notifications.md) contains no interop at all. It is 3sln.me's implementation of push and email reminders: preferences, Web Push subscriptions, a leased outbox, quiet hours and unsubscribe tokens. Its text is still message-centric (`collections`, `excludeTags`, "unread-message notice"). **Destination: a 3sln.me feature doc**, merged with the Activity center doc and rewritten around notices. Signaling's AMD-SG-N1 becomes an internal 3sln.me rule. The code already moved to `packages/activity/notifications.mjs` and `web-push.mjs` (2026-10-27 step 1).

---

## 6. Event buses: core

### 6.1 Confirmation

Keep event buses in core as directed (2026-10-20, repeated 2026-10-27). Buses are hub plumbing: they connect producers and consumers across apps, providers and integrations without new authority. The scope audit's suggestion to publish them as an extension (its §1.1 (d) and Task 3 rank 1) is **withdrawn**. The slot-based design stays, because it gives graceful degradation: a provider without `events.v1` sees an ordinary fragment.

### 6.2 What has to change

| Item | Current | Change |
| --- | --- | --- |
| events.md status | Written as an extension of protocol and extensions, with "core amendments, proposed and unsigned" | Relabel as a **core** spec. Its sign-off stays blank. |
| **AMD-C12** (feature row) | Proposed amendment to protocol §2 | Under §1 P2, `events.v1` is a registry row owned by events.md, a core spec. Add it to the protocol §2 table as well, since it is core. |
| **AMD-C13** (`event-bus/v1` contract) | Proposed for contracts | Publish as a core contract in the registry. |
| **AMD-C14** (generic built-in occupant for every recognized bus slot, without a per-slot declaration) | A special case written into extensions §4.2 from outside | Write it into extensions §4.2 as a **core rule for class-wide built-in occupants**: *a core feature that defines a critical slot member (here `bus`) MAY state that a provider declaring that feature offers a built-in occupant for every valid, recognized slot carrying that member. The occupant is created only by owner action, never preselected, and disclosed as built-in.* This rule is available only to core features, not extension specs. It stays a single use, documented where slots are defined, and an extension cannot use it to create occupants for arbitrary slots. |
| **AMD-C15** (`bus-advanced/v1` SET type; `bindle.bus` brokered token claim) | Proposed for integrations §5.3, §6.2 | Fold into integrations §6.2 (event type table) and §5.3 (claims) as core text. |
| AMD-O6 (`entity` reader kind) | Organizations amends events | events §2.1 defines `readers` and `publishers` as extensible vocabularies: unknown values confer nothing and leave the bus manifest valid for the known values. Organizations registers `entity`. |
| Code | `events.v1` is never declared (no `MANIFEST_DECLARATIONS` row) | Add a row gated on `EVENT_BUSES_ENABLED` plus mounted hosting. Later code work. |
| Code | The audit proposed splitting `events/waiter`, `doorbell` and `cursor` into core plumbing | Unnecessary now, since the whole package is core. |

---

## 7. Target catalogue

Legend:
- **Core**: Bindle core.
- **Ext: X**: a named Bindle extension spec, declared through its feature.
- **3sln.me**: a 3sln.me feature doc (provider policy and presentation, not interop).
- **Parlay app**: a messaging-app document.
- **Retire**: superseded; archive the history under the named destination.

| Spec (`docs/spec/`) | Placement | Notes |
| --- | --- | --- |
| protocol | Core | Amend §1 (open entity kind) and §2 (features from registered extension specs; registry; `requires`). |
| extensions | Core | Add the class-wide built-in occupant rule (§6.2). Decide AMD-X1: signaling withdraws its only use. P5 rename question. |
| contracts | Core | Method metadata gains the `x-command` hook only through Commands. |
| federation-implementation | Core | |
| auth | Core | Add the generic hook for extension-defined token forms (§2.2). |
| security | Core | Production gates. Move host-only gates into feature docs over time. |
| storage | Core | |
| artefacts | Core | |
| integrations | Core | Fold in AMD-C15. Add the registered event-type and `token_type` tables. Commands adds `commands`. |
| incremental-authorization | Core | |
| app-removal | Core | Org rows move to Organizations. |
| app-metadata | Core | |
| resource-contributions | Core (contribution records) / Ext: Commands | The MCP import, MCP adapter and `userCommand` sections move to Commands. |
| intents | Core | Generic "non-interactive entities are never viewers". Org specifics move to Organizations. |
| links | Core | Envelope and generic contact link. Re-scope §6 (contact link with owner-side per-feature configuration). Messaging link specifics move to Messaging. |
| device-authorization | Core | |
| recovery-identity | Core | Identity pillar (UUID identity, name certificates). |
| recovery-file | Core | Identity custody format used by portability and organizations. |
| identity-portability | Core | Repoint §3a references to identity-documents. |
| events | Core | §6. |
| *identity-documents (new)* | Core | Carved from organizations §3a, plus the delegation framework from messaging §3.2 and AMD-O12. |
| organizations | Ext: **Organizations** (`organizations.v1`, `relations.v1`) | §3a moves to core. Billing, break-glass and governance go to a 3sln.me doc. |
| signaling | Ext: **Signaling** (`signaling.v1`) | Already drafted as an extension (unsigned, SG-1 to SG-16). |
| bindlebox | Ext: **Messaging** ("Bindle Messaging") + Parlay app | Interop (slots, mailbox and intake contracts, envelope, conversations wire, archive, delegate certificate profile) is the extension. App internals go to Parlay docs. |
| message-content | Ext: Messaging (default) | Unless the owner wants rich notices (Q3), in which case it moves to Notices. |
| activity | Ext: **Notices** + 3sln.me | §5.1. |
| app-messages | Ext: Notices | v1 binding of the notice contract. |
| *commands (new)* | Ext: **Commands** (`commands.v1`) | §3. |
| notifications | 3sln.me | Activity center doc. |
| mcp-service | Retire → Commands + 3sln.me | Its separate OAuth AS retires. |
| browser-automation | 3sln.me | The WebMCP surface of Commands. |
| omni-search | 3sln.me | Pending SQ-3. Its corpus is mostly messages. |
| account-lifecycle | 3sln.me | Hosted account policy. |
| identity-names | 3sln.me | `n.` names and paid aliases. Handle syntax stays in protocol §2. |
| device-login | 3sln.me | How a provider authenticates its own users is not interop. |
| rtc-signaling | Retire → signaling | Pending SG sign-off. Until then it remains the reference for the flags-off code. |
| beaming | Retire | Beam was already removed. |
| messaging | Retire → Parlay app | BB-CUT, gated on SQ-1 (irreversible reset). |
| contact-tokens | Retire → Parlay app | The saved-contacts section is SQ-2. |
| contact-delivery | Retire → Parlay app | Superseded by Bindle Messaging. |
| conversations | Retire → Parlay app | Superseded by Bindle Messaging conversations. |
| *(docs/profiles/components-v1)* | 3sln.me-published profile | Stays a `profiles` entry. No change. |

Counts over the 39 files in `docs/spec/` plus two new documents:
- **Core: 21**, including identity-documents. resource-contributions is counted here, though part of it moves.
- **Extension material: 6 existing files plus the new commands document**, forming **5 specs**: Organizations, Signaling, Messaging, Notices, Commands. Messaging is formed from bindlebox and message-content; Notices from activity and app-messages; Commands is new.
- **3sln.me feature docs: 6** (notifications, browser-automation, omni-search, account-lifecycle, identity-names, device-login). The activity feed and the email bridge are added as new 3sln.me docs.
- **Retire: 7** (mcp-service, rtc-signaling, beaming, messaging, contact-tokens, contact-delivery, conversations).

### 7.1 Order of work

Each step is docs-first. Code follows only after the owner signs the corresponding decision.

1. **Manifest and registry** (§1 P1, P2, P5): a protocol §2 amendment proposal plus the feature registry. S. It unblocks every extension spec.
2. **Identity-documents core spec** (§2.3): move organizations §3a and the delegation framework. S–M. Signaling, Messaging, Organizations and portability all depend on it.
3. **Events into core** (§6.2): relabel, fold C12–C15 in, write the class-wide occupant rule, and add the extensible reader vocabulary. S.
4. **Bindle Messaging extension and the email-bridge feature doc** (§4): relabel messaging.md, make it the sole publisher of both slots, reconcile the slot copies, and optionally add `channels`. S–M. BB-CUT itself still waits on SQ-1.
5. **Activity split** (§5): Notices extension plus the Activity center feature doc. Rewrite notifications. M.
6. **Bindle Commands** (§3): spec first (M). Then the MCP issuer retirement and palette wiring (M code).
7. **Bindle Organizations** (§2.4): relabel, convert AMD-O into hook registrations, then the package moves. M + M. No data migration.
8. **3sln.me feature doc relabels and retirements** (§7): S each.

Signaling sign-off (SG-1 to SG-16) can proceed in parallel. It needs only steps 1 and 2.

## 8. Open questions for the owner

1. **App name.** You wrote "Parlay". DEVLOG and code mostly say "Parlay". Open item D2 records both as rejected over name clashes, and the code still says Parlay. Which name should the docs use?
2. **Auto-response vs. occupancy.** Keep one invariant reply to every accepted, aligned sender whether or not an app fills the slot (current design; no occupancy oracle)? Or reply only when the slot is empty, which tells senders whether the owner has a messaging app and requires changing extensions §9.8?
3. **Notices.** Should it be a named extension spec or a core well-known contract? And may notices carry rich HTML and forms (keeping message-content on the notice side), or plain text and links only?
4. **MCP authorization.** Agree to retire the separate MCP OAuth issuer, so MCP clients become ordinary Bindle clients with Bindle grants?
5. **Organizations.** Confirm extension status, with `directory.v1`, certification keys, the delegation framework and the open entity kind moving to core identity.
6. **Terminology.** Rename the manifest `extensions` array to `slots`, so that "extension" means only an extension spec?
