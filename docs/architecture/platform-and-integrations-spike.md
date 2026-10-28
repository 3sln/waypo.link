# Platform resources and built-in integrations — design spike

> **Group:** 3sln.me reference service
>
> **Status:** design spike (2026-10-28), documentation only. **Owner approvals (2026-10-28):** the owner approved the recommended answers to questions 1–4 and 6–8, answered question 5 (models run in the owner's Cloudflare account), and gave two new directions: the Cloudflare integration is a console app for browsing the owner's Cloudflare resources and choosing which to expose as Bindle resources and how (§3.3), and paid tiers also get 3sln.me's built-in classifier on 3sln.me's plan with tier-scaled rate limits, which supersedes "no default classifier" (§3.8) (DEVLOG, 2026-10-28, "Owner approvals and directions (in session)"; reviewer: owner; outcome: approved). Only those answers and directions are approved; the rest of the design (plan `includes` data, custody details, caps, phases) stays a provisional coordinator proposal. Sign-off of the whole spike: Reviewer ___ Date ___ Outcome ___. No code was changed. Production release remains disabled.
>
> **Covers:** how 3sln.me presents platform-provided resources as one non-removable integration that summarises the subscription; what a built-in, paid-only integration (Cloudflare first, then Google Drive and others) is, and how one supplies Bindle resources such as a classifier; plan gating, downgrade, secrets custody, data-sharing disclosure, abuse and cost.
>
> **Does not cover:** the item-classification contract and fragment, which are being redesigned concurrently ([item classification](../spec/extensions/item-classification.md)); pricing ([unit economics](unit-economics.md)); the interoperable Bindle rules this applies ([extensions](../spec/extensions.md), [integrations](../spec/extensions/integrations.md)).

Input: the owner directions recorded in DEVLOG "2026-10-28 — Owner directions: classification, built-in integrations, platform resources". Code references are to HEAD d58305f. Hosts under `.example` are placeholders.

## Summary of recommendations

1. **The platform "integration" is a 3sln.me presentation, not a Bindle object** (option C, §2). Built-ins stay extensions §5.1 kind 1 candidates and provider features stay §4.2 features. The console shows one pinned, non-removable "3sln.me" card listing them by plan tier. No grant, client id or connection is created for it.
2. **Plan contents become data.** Each plan lists the built-ins and features it includes, beside `storageBytes` and activity limits. In Polar metadata mode they come from the verified plan parameters. The card, the server-side gates and the economics model all read that one list.
3. **Losing a plan makes things unavailable; it does not revoke them.** Field values and grants are kept. Hosted data follows the existing 30-day [offload grace](offload-retention.md). Provider-feature grants are revoked only after the same grace, with notice.
4. **Cloudflare is a built-in integration** (integrations §1, "built-in" kind, like Google Drive today). The resources it supplies are **adapter resources** (extensions §5.1 kind 2): 3sln.me's adapter gateway calls the owner's own Cloudflare account. It is not a provider feature, not a separately operated OAuth client and not a Worker deployed into the owner's account (not in phase 1).
5. **The Cloudflare integration is a console app inside 3sln.me** (owner direction 2026-10-28). It is a configuration console for browsing the owner's Cloudflare resources (R2 buckets, Workers AI models and so on) and choosing which to expose as Bindle resources and how. First a Workers AI model as a classifier (item classification), then an R2 bucket (object storage). Models run in the owner's Cloudflare account (question 5, owner-answered). AI-agent configuration is deferred (question 6, owner-approved).
6. **Paid-only is enforced on the server** in `connectBuiltIn` and at dispatch, not only by hiding offerings. Google Drive moves under the same gate.
7. **Upstream credentials are sealed** like Drive's (`encryptSecret` under a dedicated key id). They are never returned to the browser, logged, journaled or written to DEVLOG, and they are deleted on disconnect or after grace.
8. **Bindle spec impact is small.** Two clarifying change requests: per-entity provider policy (such as a plan) as *availability*, distinct from suspension; and adapter resources disclosing their processor, location and cost the way built-ins do (§5.2). Everything else is 3sln.me documentation.
9. **Paid tiers also get 3sln.me's built-in classifier** (owner direction 2026-10-28, superseding "no default classifier"): it runs on 3sln.me's plan, implements the generic classification contract, and is highly rate-limited with limits scaling by tier. Free gets none (§3.8).

## 1. Inventory: what the platform provides today

"Surfaced" is where the owner sees it, and "consent" is how a consumer gets it. Every row is local implementation behind flags. None is production-verified.

| Item | Bindle shape | Surfaced | Consent / gating today |
| --- | --- | --- | --- |
| Account storage (`object-storage/v1`, provider `hosted`) | Built-in (§5.2). One per account, `builtin:true`, cannot be deleted (`packages/runtime/account/storage.mjs`, `builtin_resource`) | Storage and billing views (`release-billing.mjs`); field candidates marked "Provided by 3sln.me" | Owner assigns it to a field, then the app grant applies. The EXT3-26 initial-setup exception is the only offer outside that. Quota per plan: 500 MB / 5 GB / 100 GB / 1 TB (`packages/billing/catalog.mjs`) |
| Extra hosted storage resources | Built-in (owner-created) | Storage views | Same rules. Counted in the account quota |
| Activity (`activity` contract, per-app descriptor) | Built-in | Activity center | App grant. `ACTIVITY_V2_ENABLED` |
| App messages (`app-messages/v1` `createOwn`) | Built-in | Connected apps, "Messages" setting | App grant plus a separate owner toggle |
| Identity profile (`@profile` read) | Built-in (core) | Consent screen | App grant |
| Event buses | Built-in descriptors | Fields | App grant. `EVENT_BUSES_ENABLED` |
| Signaling (`signaling/v1`) | Built-in, listed in manifest `contracts` | Fields; signaling owner pages | Owner assigns. Kind approvals via intents |
| Connection relay (`ice-relay/v1`, TURN) | Built-in | Fields | Owner assigns. Per-plan relay allowance (RTC-f, provisional). `SIGNALING_TURN_ENABLED` |
| Classifier (`item-classification/v1`, Workers AI) | Built-in (CR-X3-25) | Fields | An earlier 2026-10-28 direction withdrew the default classifier; the later owner direction of the same day restores a built-in classifier for paid tiers only, on 3sln.me's plan, highly rate-limited per tier (§3.8). Its implementation belongs to the concurrent classifier work |
| Email bridge | Provider feature (`PROVIDER_EXT.emailBridge`, consumes the `intake` field) plus an email-bridge callback resource | Console "Provider features" | Owner enables, with recent auth. Paid-only (`account/email-bridge.mjs`) |
| Messaging mailbox | Provider feature of the Parlay-published extension, with a key-delegation declaration | Console "Provider features" | Owner enables, with recent auth. Several flags |
| Key delegation / member certificates | Extension declaration (not a resource) | Parlay / orgs | Certifies only through the mailbox feature or org membership |
| Google Drive | Built-in integration (`BUILT_IN_INTEGRATIONS`) whose upstream folders are adapter resources | Console "Available built-in services" | Owner connects, then Google OAuth (`drive.file`). Gated only on Google being configured, **not on plan** |
| Omni-search (lexical, semantic) | 3sln.me service, not a Bindle resource | Search UI | Semantic search for paid accounts or accounts at least 7 days old. Budgets per plan (`account/search.mjs`) |
| Notifications (Web Push, email) | 3sln.me service | Notification settings | Owner preferences. Delivery not verified |
| MCP endpoint, browser automation | 3sln.me services with their own grants | MCP and automation settings | Separate consent, outside the Bindle grant namespace |
| Org AI credits | Org tier allowance (not wired) | — | — |

Observations:

- **Nothing summarises a plan.** Plan contents are scattered across code: `storageBytes`, activity limits, relay allowance, the email-bridge check, search budgets.
- **"Built-in" means two different things in the console.** The "Built-in" kind label is used for built-in integrations (Drive). The "Provided by 3sln.me" marker is used for built-in resources.
- **Built-ins have no home in the console.** They appear only as field candidates, and provider features sit in their own section.

## 2. The platform integration model

### 2.1 Options

| Option | Fit with the spec | Verdict |
| --- | --- | --- |
| **A. A provider feature** (§4.2) | Wrong shape. A provider feature *consumes* fields under (issuer, spec URL) and is enabled by consent. Platform resources *supply* fields. One extension can define only one feature, so this would need a fake extension per resource or one omnibus extension. Turning it off would mean suspension semantics, which conflicts with "cannot be removed" | Reject |
| **B. A pseudo built-in integration connection** with a fixed client id (for example `${origin}/integrations/platform`) | The connection would become the supplier, which turns built-ins (kind 1) into connection-supplied candidates. That breaks the §5.2 built-in marker and §6 rule 3 (no self-announcement), and it creates a grant client that owns nothing. Disconnect severance (integrations §7) contradicts "non-removable". It would also make a meaningless "connect 3sln.me" consent | Reject |
| **C. A presentation grouping** over existing built-ins and provider features, driven by plan data | No Bindle change. Bindle says nothing about UI (2026-10-14 direction). Built-ins keep §5.2 neutrality at assignment, and features keep §4.2 consent | **Recommend** |

### 2.2 How option C appears in the console

- **A pinned card titled "3sln.me (your subscription)"** at the top of "Your apps and integrations", with kind "Platform". It has no Disconnect, Remove or Pause action, and the server refuses those actions for it. It shows the plan name, renewal date and a link to billing.
- **Sections in tier order.** "Included with Free", then "Included with Paid", "Plus" and "Ultra" (or the org tiers). Each entry is a built-in or a provider feature with its allowance (for example storage 5 GB, relay 1 GB/month) and its state:
  - **In use**, with "Used by", reusing the field-consumer data already computed for "Where things go";
  - **Available, not assigned**;
  - **Off**, for a feature;
  - **Not in your plan**, with an upgrade link;
  - **Unavailable after downgrade**, with the grace deadline.
- **Entries link out; they never assign.** Each entry links to its field in "Where things go" or to its feature toggle. The card never assigns or enables anything itself. Assignment stays in the neutral candidate list (no preselection, no built-in preference: protocol §3 rule 3, extensions §5.2). Listing higher-tier entries is a plan summary, not a candidate suggestion, and it never appears inside an app's authorization flow.
- **Provider features keep their own consent.** Turning one on still goes through the existing feature review with recent authentication. The card replaces the separate "Provider features" heading. The "Built-in" kind label is reserved for built-in integrations (Cloudflare, Drive), and the "Provided by 3sln.me" marker for built-in resources.
- **3sln.me services that are not Bindle resources** (search, notifications, MCP) are listed as information rows with a link to their settings, so the card describes the whole subscription.

### 2.3 Plan data

- **Extend the plan record** with `includes`: a list of `{item, allowance?}`. An item is a built-in kind (`hosted-storage`, `relay`, …), a provider-feature spec URL, a built-in integration id (`cloudflare`, `google-drive`) or a service (`semantic-search`).
  - Static mode: in `BILLING_PLANS`.
  - Metadata mode: validated like `validPlanParameters`, with unknown items ignored.
- **One source of truth.** Server gates (`email-bridge.mjs`, search admission, relay allowance, `connectBuiltIn`) read `includes` instead of hard-coded `['paid','plus','ultra']` checks.
- **Never trust the browser.** The card renders only what the server reports.

### 2.4 Plan changes

- **Upgrade.** Newly included items appear at once as "Available, not assigned" (built-ins) or "Off" (features and integrations). Nothing is auto-assigned or auto-enabled; only the EXT3-26 initial-setup offer exists.
- **Downgrade or lapse**, taking effect at the authoritative effective time. A billing fallback to Free caused by a malformed state is not a downgrade (offload-retention rule).
  - **Built-ins.** The resource stays in the pool and keeps its field values and grants. It becomes unavailable to consumers (§3.1), so `ordered` fields fail over and others report unavailable.
  - **Hosted storage over quota.** The existing 30-day offload episode applies: growth pauses, and reads, export and deletion stay available.
  - **Provider features.** Grants are suspended in the owner's view (state "Unavailable on your plan"). They resume on re-upgrade within 30 days, and after that they are revoked with notice. This intentionally mirrors §4.2's 30-day suspension bound but is a separate trigger (see §4.2 here).
  - **Built-in integrations.** See §3.5.
- **Anti-replay.** Plan toggling must not reset grace (offload-retention rule). Repeated grace is bounded by paid service actually earned.

## 3. Built-in high-value integrations

### 3.1 What "built-in integration" means

| Option | Meaning | Verdict |
| --- | --- | --- |
| Provider feature | 3sln.me consumes an owner field on its own behalf | Wrong direction. Cloudflare *supplies* resources |
| First-party external integration | 3sln.me operates a separate OAuth client (for example `cf.3sln.example`) that connects over Bindle OAuth and brokers resources | Possible later. It adds a second origin, a brokering key set and token custody for no phase-1 benefit |
| **Built-in integration with adapter resources** | Implemented inside the provider (integrations §1, "built-in"). The owner's explicit action in the authenticated console is the authorization (§3.2), with consent derived from a provider-authored manifest. Upstream accounts are separate resources under one connection. Resources are kind 2 adapter resources, shown as "the upstream service and account, via the provider" | **Recommend.** It is the existing Google Drive pattern (`BUILT_IN_INTEGRATIONS`, `connectBuiltIn`) |
| Deploying a Worker into the owner's Cloudflare account | The owner's account runs a 3sln-authored Worker that is itself a Bindle integration | Defer. Needs script-edit permissions and upgrade management of code in someone else's account. Revisit for agents (§3.3) |

Built-in integrations stay **removable** connections. Only the platform card is non-removable.

### 3.2 Linking the owner's Cloudflare account

- **Credential type.** Prefer Cloudflare's OAuth for third-party apps *if* it is generally available with narrow enough scopes. **Verify against Cloudflare's primary documentation before choosing; this spike makes no claim about it.** Otherwise, use an owner-created, account-scoped API token. The portal provides a permission template listing only the permission groups the enabled capabilities need (Workers AI inference; later, one R2 bucket). The owner pastes the token once.
- **Where entry happens.** Token entry only in the authenticated console, behind recent authentication. Never inside an app's flow, never prefilled from a URL. A visible warning: 3sln.me will never ask for the token elsewhere.
- **Validation.** On entry, verify the token with Cloudflare, record the account id, token id, permission summary and expiry, and refuse tokens broader than the template. "Least privilege" must be checked, not just recommended.
- **Custody.**
  - Seal with `encryptSecret` under a dedicated key id (rotation separate from `KEY_ENCRYPTION_KEY` for Drive), bound to (owner, resource, generation) the way `storage/google-drive.mjs` binds Drive tokens.
  - Never returned to the browser, logged, placed in RPC journals, error messages or analytics, or written to DEVLOG or docs.
  - An upstream 401/403 marks the resource `reauthorization_required`.
  - Disconnect deletes the sealed secret at once and shows a link to revoke the token at Cloudflare, because a local disconnect cannot revoke a pasted token.
- **Accounts.** Several Cloudflare accounts may be linked, each a separate upstream account under one connection.

### 3.3 The Cloudflare console app

**Owner direction (2026-10-28):** the Cloudflare integration is a console app. It provides a portal for browsing the owner's Cloudflare resources (R2 buckets, Workers AI models and so on) and choosing which of them to expose as Bindle resources, and how; the whole integration is a configuration console for that purpose. AI models run in the owner's Cloudflare account.

The console app is the built-in integration's management page in 3sln.me (the built-in counterpart of `management_url`). It shows linked accounts and token health, lists the Cloudflare resources each linked account holds that the integration can use, and lets the owner choose which to expose as adapter resources, under which contract and with which settings (for example which model, which bucket and prefix, which caps). Browsing lists only resource kinds the credential's permission template covers. Exposing a resource creates an adapter resource; un-exposing it removes it. The first resource kinds:

1. **Classifier (phase 2).**
   - **What it is.** An adapter resource implementing `item-classification/v1` over Workers AI in the owner's account. The owner picks a model; the portal lists models with the input kinds each handles, which feeds the redesigned contract's "what can you classify" query.
   - **Who pays.** Inference runs and is billed in the owner's Cloudflare account. 3sln.me bears only the gateway request.
   - **Optional AI Gateway.** Can be selected for the owner's own logging, caching and rate limits. Logging there is the owner's choice and is disclosed as retention by Cloudflare under the owner's account.
   - **Assignment.** The resource fills classification fields only by owner assignment, like any candidate. Per-kind classifiers and the fallback are values of the redesigned fragment (concurrent work).
2. **Object storage (phase 3).** An R2 bucket as an `object-storage/v1` adapter resource, an alternative to hosted storage that does not count against the plan quota.
3. **AI agents (deferred; question 6, owner-approved 2026-10-28).** "Configure AI agents" is under-specified: which contract an agent implements, where it runs, and what authority it holds. It is the case that may justify the deploy-a-Worker option.

### 3.4 Data sharing disclosure

- **Disclosure at assignment.** An adapter resource sends content to a third-party processor (Cloudflare) under the *owner's* Cloudflare account and terms. Assignment must show the processor, the Cloudflare account name or id, the model, the processing location where known, and the fact that the owner's account is billed. Today §5.2 requires cost, location and model provenance only for built-ins (spec CR, §4.2 here).
- **Detail level.** For the classification detail-level preference, every adapter resource and every brokered or contributed classifier counts as **third-party**. The paid built-in classifier (§3.8) runs under 3sln.me's own Cloudflare account, so it is provider-side processing with Cloudflare as 3sln.me's processor; how the detail level treats it is for the concurrent classification redesign to state, and its built-in disclosures (cost, processor and location, model provenance, extensions §5.2) apply.
- **Fetching items.** If the redesigned contract passes items by presigned URL, the adapter fetches it under the protocol §2 SSRF rules, with byte caps and no redirects to private ranges. It never forwards the URL to Cloudflare.
- **Retention.** Adapter dispatch keeps the contract's retention rules (no content in journals or spend records).

### 3.5 Paid-only gating and downgrade

- **Gate on the server.** `connectBuiltIn` refuses `cloudflare` and `google-drive` unless the plan's `includes` lists them. Dispatch to their adapter resources re-checks the entitlement, so a stale UI cannot bypass it. Today Drive is gated only on Google being configured, client-side, in `bl/connections.mjs`.
- **On downgrade.**
  1. The connection moves to `suspended` (integrations §3.1). Its adapter resources become unavailable, and field values and grants are kept.
  2. Sealed upstream credentials are kept for the 30-day grace, then deleted, and the connection is severed with notice (integrations §7).
  3. A re-upgrade within grace resumes. Remote data (R2 objects, Drive files) is never deleted by 3sln.me.
  4. Data in an R2 or Drive store that apps relied on stays in the owner's account. The owner is told so.

### 3.6 Abuse and cost exposure

- **Owner's Cloudflare bill.** A granted app could run up the owner's Cloudflare bill. Mitigations:
  - an owner-set monthly call and byte cap per adapter resource, enforced before dispatch (refusals are no-effect, AMD-C4);
  - per-app rate limits;
  - a usage view in the portal;
  - a default cap that is conservative and visible.
- **3sln.me cost.** Gateway requests and egress, especially blob fetches, count against the activity ledger and need a unit-economics row before enabling.
- **Credential theft.** A stolen sealed token is useless without the key. A stolen key plus database is the Drive threat model, now holding broader credentials, so the key id must be separate and access audited.
- **Using 3sln.me as a proxy.** Only template-scoped tokens are accepted, and only fixed upstream endpoints are called (no owner-supplied URLs). The adapter never acts as a general Cloudflare API proxy.

### 3.7 Other candidates

Google Drive (exists; move it under the paid gate). Later, by value and fit with existing contracts: Dropbox or OneDrive (object storage), S3-compatible buckets, and other inference providers as classifier adapters. Each needs its own design note covering upstream authorization, custody, disclosure and economics before it is listed.

### 3.8 Paid built-in classifier

**Owner direction (2026-10-28), superseding "no default classifier":** paid tiers get 3sln.me's built-in item classifier. It runs on 3sln.me's plan (3sln.me's own account, not the owner's) and implements the generic classification contract. It is highly rate-limited, with limits scaling up by plan tier, because each request costs real money. Free gets none.

- **Shape.** A built-in resource (extensions §5.1 kind 1), offered as a candidate only on paid plans, listed in the plan `includes` (§2.3) and gated on the server at dispatch, like the other paid items. It is assigned only by the owner, with no preselection or built-in preference (protocol §3 rule 3, extensions §5.2).
- **Limits.** Per-tier request limits, refused with the contract's no-effect rate-limit outcome. The values need a unit-economics row before enabling; none is set here.
- **Beside the Cloudflare app.** An owner who wants more, or a different model, exposes a Workers AI model from their own account through the console app (§3.3), billed to them.
- **Downgrade.** As for other built-ins (§2.4): the resource becomes unavailable, and field values and grants are kept.
- Implementation belongs to the concurrent classifier work; nothing here is implemented.

## 4. Security, spec impact, phases, open questions

### 4.1 Security and privacy

- **Non-removable is only cosmetic.** The platform card can be presented as non-removable without weakening owner control. Every built-in can still be unassigned and every feature turned off. "Non-removable" applies only to the card.
- **No impersonation.** Built-in and adapter markers are rendered outside supplier text (§5.3). An integration label claiming "3sln.me" or "Cloudflare" is shown as that supplier's text.
- **No leaks through authorization outcomes.** Plan-gated availability must not leak through §4.3 outcomes. The manifest lists a built-in's contract whatever this owner's plan is, and requests are presented normally.
- **Recent authentication** for: linking or replacing an upstream token, enabling a built-in integration, and assigning an adapter resource to a field a provider feature consumes (§3.4).
- **Release gates.** Cloudflare token custody, cap enforcement and disclosure copy become release-gate rows. Nothing ships on a populated key alone.

### 4.2 Spec impact

| Document | Change | Kind |
| --- | --- | --- |
| [extensions](../spec/extensions.md) §3.1 / §4.2 | Clarify that per-entity provider policy (for example a subscription) may make a built-in or provider feature *unavailable* for an entity. This is availability, not declaration loss: values and grants are kept, and a provider-defined bound for revocation applies with notice | Bindle CR (small) |
| [extensions](../spec/extensions.md) §5.2–§5.3 | Apply the built-in disclosures (cost, processor and location, model provenance) to adapter resources, plus the upstream account and the fact that its owner is billed | Bindle CR (small) |
| [integrations](../spec/extensions/integrations.md) §1 | None needed. Stale "slots" wording seen in passing (out of scope) | — |
| [item classification](../spec/extensions/item-classification.md) | Adapter-resource SSRF rule for presigned URLs; third-party treatment for detail level | Input to the concurrent redesign |
| New 3sln.me docs | `docs/3sln/services/platform.md` (plan contents, card, downgrade); `docs/3sln/services/cloudflare.md` (portal, custody, caps) | 3sln.me only |
| Existing 3sln.me docs | [google-drive-integration](google-drive-integration.md) (paid gate), [unit economics](unit-economics.md) (gateway rows), [release gates](../3sln/release-gates.md) (custody and cap rows), [storage](../3sln/services/storage.md) (R2 adapter later) | 3sln.me only |

### 4.3 Phases (flags off throughout)

1. **Platform card and plan data.** Add `includes`, the card, server-side gates reading it, Drive moved under the paid gate, and downgrade "unavailable" states. Engine-level tests: upgrade, downgrade, grace, replay, and seeded plan churn.
2. **Cloudflare built-in integration and classifier adapter.** Linking, custody, portal, caps, disclosure, and the classifier adapter against the redesigned contract.
3. **R2 object-storage adapter.**
4. **Agents.** Deferred until there is a concrete use (Q6, owner-approved 2026-10-28).

### 4.4 Owner questions (answered)

The owner approved the recommended answers to questions 1–4 and 6–8 and answered question 5 in session on 2026-10-28 (DEVLOG, 2026-10-28, "Owner approvals and directions (in session)"; reviewer: owner; outcome: approved). The questions are kept as asked.

1. **Is the platform card a Bindle object or a 3sln.me presentation?** *Answered (owner-approved 2026-10-28): presentation only (option C).*
2. **On downgrade, keep or remove field values and grants?** *Answered (owner-approved 2026-10-28): keep, as "unavailable", with revocation of provider-feature grants and built-in-integration credentials after 30 days and notice, aligned with offload grace.*
3. **Should higher-tier items the owner lacks be listed?** *Answered (owner-approved 2026-10-28): yes, as "Not in your plan" with an upgrade link, only in the console and never in an app flow.*
4. **Cloudflare credential: OAuth or API token?** *Answered (owner-approved 2026-10-28): OAuth if Cloudflare's third-party OAuth is generally available with narrow scopes (verify first); otherwise an owner-created, account-scoped token checked against a template.*
5. **Should the classifier and other inference run in the owner's Cloudflare account (adapter) or in 3sln.me's account billed back?** *Answered (owner, 2026-10-28): the owner's account* for models exposed through the Cloudflare console app (§3.3). It puts cost on the owner's bill and makes the third-party processor explicit. Separately, paid tiers get 3sln.me's built-in classifier on 3sln.me's plan (§3.8), which supersedes the earlier "no default classifier" rationale.
6. **What does "configure AI agents" mean (contract, runtime, authority)?** *Answered (owner-approved 2026-10-28): defer until there is a concrete use.* Phases 1–3 do not depend on it.
7. **Which tier unlocks built-in integrations?** *Answered (owner-approved 2026-10-28): every paid tier (Paid, Plus, Ultra), consistent with "paid accounts only", with per-tier caps if economics require.*
8. **Do the Bindle clarifications in §4.2 go into the specs now?** *Answered (owner-approved 2026-10-28): propose them as change requests in extensions Appendix A.* Not yet filed there.
