# Accounts-first sign-in: chooser island and persisted app sessions (security design)

> **Group:** `@3sln/bindle` SDK: custom elements and provider islands; 3sln.me reference host
>
> **Status:** provisional. Security design commissioned by the coordinator on 2026-10-29 after the owner direction for the sign-in form component (DEVLOG 2026-10-29, "UI elements W3/W4/W7/W6 and owner directions") and the coordinator decision that persisted app sessions (ui-elements-audit W11) are in scope before release with a security design first. Unsigned. Docs only: this document changes no product code, tests, specs or release gates. Every rule change it proposes (§6) is a recommendation until it is recorded in DEVLOG.md with a sign-off. Nothing here is implemented, routed or production-verified, and no browser behaviour below was measured for this document; claims about browsers are marked *documented* (vendor or MDN documentation, as relied on by [adaptive app sign-in §4](adaptive-app-sign-in.md#4-browser-facts-relied-on)) or *needs evidence*.
>
> **Covers:** how `<bindle-sign-in>` (and the `signed-out="panel"` composition of `<bindle-account>`) can make the list of accounts the main sign-in UI. That means the app's own held and persisted sessions (W11), plus the accounts the home provider's islands hold bindings for in this browser partition, shown inside a signed-out page without telling a hostile embedder anything. It also covers how "Add account" and "Create a 3sln.me account" fit around that list, the threat model, the options considered, the rule changes to [components-v1](../profiles/components-v1.md) P10 and ui-elements-audit C8, and the tests and release-gate rows.
>
> **Does not cover:** provider pages (chooser, consent, login), FedCM inside islands (forbidden by EXT3-34 and not reopened here), organization context selection ([org context spike](org-context-and-layered-preferences-spike.md)), the authorization-entry sign-up hint (a Bindle spec gap noted in DEVLOG), and Bindle interop. Nothing here changes consent, grants, token semantics or component-credential authority (components-v1 §9 C1–C5).

Architecture/security/frontend sign-off: Reviewer ___ / Date ___ / Outcome ___

Builds on: [embed islands](embed-islands.md) (EI-4, EI-13, §3.4, §5, §13), [adaptive app sign-in](adaptive-app-sign-in.md) (§4 partitioning, §5 R1, §7 frame popup, §11.6 app-as-RP FedCM, §12 app credentials, §17 eviction), [components-v1](../profiles/components-v1.md) (§5–§10, P8, P10), [components profile decision note](components-profile.md) (CPR-13), [ui-elements-audit](ui-elements-audit.md) (C1–C11, G3, G3b, W11), [release gates](../3sln/release-gates.md#reference-host-presentation-and-framing-3slnme-policy), [auth](../spec/auth.md) (DPoP-bound persistence), and the current code in `apps/embed/**` and `packages/sdk/src/elements/**` (read only).

## 0. Summary

**Recommendation (provisional):** deliver "accounts first" in two layers and keep the third as the fallback.

1. **App layer (all providers, all browsers, no rule change).** Ship W11: persisted, DPoP-bound app sessions in the app's own IndexedDB. The account list `<bindle-sign-in>` already renders for held sessions then becomes the main UI on every return visit. It is the embedder's own data, so it leaks nothing. This covers most of the owner's direction and should land first.
2. **Island layer (3sln islands, behind a default-off flag).** Add a new part, `chooser/1`: a fixed-size island that, **before any activation**, renders up to three accounts from a **partition-local label cache**. The cache is written only by member islands after successful restores, and the chooser itself makes **no network request**, no storage write, no key use and no lock, bus or service-worker use before activation. Picking a row opens the provider popup with that account as the hint ("Continue as Ada"), so it costs one island click plus one provider click, the same as R1. This needs a narrow P10/C8 amendment (§6) and one new at-rest datum (labels: handle and display name, no avatar bytes).
3. **Provider layer (fallback, unchanged).** "Use another account" and "More accounts" in the chooser, the `sign-in` island and the app's own popup all open the provider's top-level chooser, which is the only place the browser's first-party provider sessions are visible.

The app-side controls around the island are constant whatever the island shows: an "Add account" disclosure (the handle field, which islands may not contain, P8) and "Create a {host} account". With the chooser live, the handle field is **always** behind the disclosure, because showing it directly when the island is empty would reveal that the island is empty.

**Accepted residual, needing owner sign-off (§3.4):** a hostile embedder can overlay or crop the chooser and watch where the user tries to click. That lets it estimate whether this browser holds bindings for this app on this site, and roughly how many. This information is bounded by what the app was itself entitled to (every binding was created by a flow that delivered a code to this `client_id` on this top-level site). The current switcher already carries the same residual.

## 1. Owner direction and constraints (followed exactly)

- **Owner, 2026-10-29:** the sign-in form shows the list of signed-in or available accounts as the main UI when any exist, through the established secure mechanisms (home-provider islands). "Add account" reveals the handle input, and a "Create a 3sln.me account" button is offered. The form should be user-friendly, intuitive and secure.
- **Coordinator, 2026-10-29 (owner delegation):** persisted app sessions are in scope before release, security design first (ui-elements-audit question 4, W11).
- **Blocker found by the element work:** listing the provider's bindings inside a **signed-out** island needs storage, and today also network, before user activation. components-v1 P10 forbids this for `sign-in` ("no storage access and no network request after loading the shell until a user activates it"), and ui-elements-audit C8 extends it to `request` (G3b). Islands may not contain text inputs (P8). The implementer proposed a fixed-size chooser part with the handle field kept app-side behind a constant disclosure.

Constraints this design keeps unchanged: C1 fixed or embedder-set sizes; C2 constant shape, Tab count and scroll; C3 no state-dependent messages, sizes, focus or errors; C4 arming; C5 no theme tokens; C6 embed-origin CSP; C9 entitlement; C11 security copy not slottable; components-v1 §9 C1–C5 (component credentials authorize display only and never mint codes); every approval happens in a top-level provider document; islands never use FedCM; embed origin cookieless.

## 2. What exists today (code, read only)

| Fact | Where | Consequence |
| --- | --- | --- |
| The `sign-in` part starts its worker only inside the activation, and registers no service worker. | `apps/embed/src/parts/sign-in.mjs`, `boot.mjs` (`!['sign-in','request'].includes(part)`) | P10 holds in code. Nothing account-dependent exists in a signed-out sign-in island. |
| Member parts (`avatar`, `account-switcher`) start the worker after `ready`, open IndexedDB, join leader election and restore every stored binding, without activation. | `boot.mjs`, `worker/index.mjs` | Only signed-in compositions mount them. Their restores are the natural writer of a label cache. |
| Bindings are per `(issuer, client_id)` in the embed partition (embed origin + the app's top-level site), store `credential`, `subject`, `delivered`, `pendingUntil`, and hold **no labels**. Views (handle, name, avatar) are memory-only snapshots from restore. | `apps/embed/src/keys.mjs`, `worker/index.mjs` | A signed-out island today could show only subject URLs (and monograms) without network. Labels need a new cache (§5.3). |
| A component credential is live only while its app refresh family is active (status, expiry, idle, subject, client, epoch). | `packages/federation/embed-bindings.mjs` | Bindings and app sessions die together server-side. A binding visible in the island means the app **had** a session for that subject from this browser partition. |
| App sign-out sends `forget{subject}` to every live island and queues it for later ones. | `packages/sdk/src/elements/islands.mjs` | Explicit sign-out removes that account from the island. Bindings outlive the app's view only when the app lost its tokens without signing out (memory-only reload, app-storage eviction). |
| App refresh tokens are never persisted (G3). | `packages/sdk/src/dpop.mjs`, `tokens.mjs` | Today every reload orphans the server family (idle 180 days on 3sln.me) while the island binding stays restorable. This mismatch is why the island "knows" accounts the signed-out app does not. |
| `<bindle-sign-in>` shows held app sessions as the main UI with "Add account" (G2b), and "Create a {host} account". | `packages/sdk/src/elements/sign-in.mjs` | Layer 1 of the recommendation already exists for in-memory sessions. W11 makes it survive reloads. |

## 3. Threat model

### 3.1 Parties and assets

- **Hostile embedder:** any script in the app page, including the app itself, third-party script it loads, and injected script. It controls the iframe element (size, position, `clip-path`, opacity, overlays, `src`, removal), the port, timing of its own main thread and every DOM node outside the island. It cannot read the island's document, pixels or accessibility tree (same-origin policy; [embed islands §7](embed-islands.md#7-snapshot-privacy-statement)).
- **Provider as observer (CPR-13):** the provider can see every request the island makes. An identity-bearing request from a signed-out page (a restore) would tell the provider that *Ada* viewed app X at time T, even though Ada is not signed in to X. P10's network clause exists for this reason.
- **Co-user of the device:** someone else at the same browser profile who sees the chooser.
- **Assets:** (A1) whether this browser partition holds any bindings for this client; (A2) how many; (A3) which accounts (identity); (A4) provider-side page-view telemetry tied to an identity; (A5) user intent (tricking the user into an action).

### 3.2 Channels: today versus with a chooser part

"Today" is the signed-out `sign-in` island (P10). "Chooser" is the recommended `chooser/1` (§5). "Switcher" is the existing signed-in `account-switcher`, given for comparison because it already shows bindings.

| Channel | Today (`sign-in`) | Chooser (`chooser/1`) | Notes and mitigations |
| --- | --- | --- | --- |
| Iframe size and position | Constant (element-chosen 44/48 × locale width) | Constant: element-chosen block size from `density` only, inline size from the container clamp (§5.2) | C1. The island never reports a size, and the element never measures island content. Probe in §7. |
| Load events, frame count, navigations | One `load`, `length` 0 | Same | The element tears down on a second `load` or a `src` change (§5.1 of components-v1), which also defeats re-navigation probes. |
| `postMessage` | `ready` (constant), then `flow`/`code` after activation | Same set. No new outbound type. | §5.4 entitlement invariant. Rows produce the same `flow{started}` as "Use another account". |
| Focus and Tab order | One control, no autofocus | Constant: one roving list stop (rows plus an always-present "Use another account" row) plus one footer control. No autofocus. Arrow keys wrap and never report an edge. | C2, EIR-5. With 0 accounts the list still holds the always-present row. |
| Scrolling | None | None: the island root and list are `overflow:hidden`, rows are fixed, and more than three accounts become a "More accounts at {host}" row | No scroller exists, so scroll chaining, wheel latching and scrollbar presence are constant. No scroll-to-text target exists either. |
| Paint and compositing | Constant | Pixels vary with state | Cross-origin pixels are not readable (no canvas path; [§7 snapshot statement](embed-islands.md#7-snapshot-privacy-statement)). LCP, Element Timing and Event Timing exclude cross-origin iframe content (*documented; needs evidence per engine*). One tile swap per row slot per state (C3), with transparent tiles for empty slots. |
| Main-thread timing and CPU | Zero state work before activation | Constant-shape work in a dedicated worker: one existence check, at most one read-only transaction, a fixed number of raster generations (empty slots padded), one document update | **New residual.** Cross-site frames can share the embedder's renderer main thread (Android Chrome; Firefox without Fission). The document does constant work, but worker CPU, memory and storage I/O contention remain browser-wide side channels (§13.2 of embed islands). Probe with `load`→`ready` latency, rAF jitter and Long Animation Frames in the embedder for 0, 1, 3 and 8 entries (§7). |
| Memory | Constant | Near-constant: fixed tile count, label strings ≤ a few hundred bytes | `performance.measureUserAgentSpecificMemory()` is available only to cross-origin-isolated embedders, and our shell is COEP-compatible (EIR-16), so such an embedder can measure. Cross-origin frame memory is reported aggregated (*documented; needs evidence*). Constant tile count keeps the delta at label-string scale. Probe, record only. |
| Network | Shell (cacheable 5 min) and static assets | Same; no other request before activation | P10 network clause kept for the chooser. Static hashed assets (identical for every user, cookieless) are allowed and named explicitly (§6). The embedder sees no Resource Timing for a cross-origin iframe's subresources (*documented*). |
| Storage | None | One read-only check-then-read of the label store in the worker; never creates or upgrades the database | **P10 storage clause relaxed for this part only (§6).** Storage reads are local: neither the provider nor the embedder observes them except through the timing residual above. |
| Locks, bus, service worker, bfcache | None | None before activation (no Web Locks, no BroadcastChannel, no SW registration, IndexedDB closed after the read) | bfcache eligibility and `notRestoredReasons` stay constant (EIR-4). |
| Accessibility tree, find-in-page, text fragments | Not exposed | Not exposed | Page script cannot read a cross-origin frame's AX tree. `window.find()` and scroll-to-text-fragment do not search cross-origin iframes, and text directives are not honoured on iframe navigations (*documented; needs evidence*). An embedder-set `#:~:text=` on `src` fails part parsing (inert) or causes teardown. |
| Clickjacking and forced activation | One control; nothing grants authority | Rows and "Use another account" grant no authority: each opens a top-level provider popup that is inert for 600 ms and needs its own click | C4 arming (400 ms after visibility, pointer only, IntersectionObserver v2 where available). The embedder cannot synthesize trusted clicks or keys. |
| UI redress probing (overlay, crop) | Nothing to probe | **Residual (§3.4).** A transparent capture layer over row *k* (or a crop showing only row *k*) reveals whether the user tried to click there | Bounded by entitlement (§3.4). The switcher has the same residual today. |
| Provider telemetry (A4) | Shell request only (no identity) | Same before activation; identity only after the user picks a row (hint in the entry) | CPR-13 holds. Contrast with any design that restores before activation (rejected, option b′ in §4). |

### 3.3 Third-party storage realities (what the embed origin can read in a framed, third-party context)

| Engine | Without Storage Access API | CHIPS | Partitioned service workers | Storage Access API | Status |
| --- | --- | --- | --- | --- | --- |
| Chromium (115+) | Its own **partitioned** storage only, keyed by top-level site plus a cross-site-ancestor bit (IndexedDB, Cache, localStorage, BroadcastChannel, Web Locks, SW) | Supported (`Partitioned` cookies) | Yes | Supported. The non-cookie extension gives a handle to **unpartitioned** embed-origin storage. FedCM sign-in can auto-grant. | *documented*; per-feature evidence in this repo pending (embed islands §18) |
| Firefox (Total Cookie Protection default) | Partitioned by top-level site | *needs evidence* (do not rely on it) | Partitioned (*needs evidence*) | Cookies only, with a prompt or heuristics | *documented* for storage; CHIPS and SW *need evidence* |
| WebKit / Safari | Partitioned by top origin. ITP removes script-writable storage after 7 days of use without interaction; partitioned frame storage is expected to follow the app site | *needs evidence* | *needs evidence* | Cookies only, prompt, prior first-party interaction required | *documented*; ITP follow-the-app-site *needs evidence* |
| Brave and other strict browsers | Ephemeral third-party storage (cleared when the site's last tab closes) | — | — | — | Not a target; chooser degrades to empty |

Consequences for this design:

- The chooser can only ever see bindings created **on this top-level site for this `client_id`** (partition plus `(issuer, client_id)` filter, components-v1 §2.2). It can never see first-party provider sessions or other apps' bindings. "Available accounts" in the provider's first-party sense are reachable only in a top-level provider document (popup) or through browser-mediated FedCM (option e).
- CHIPS offers nothing: a partitioned cookie is equivalent to partitioned storage, but it is **sent on requests**, which is worse for A4, and the embed origin is cookieless by rule.
- Storage Access API offers nothing structurally (option d). Firefox and WebKit unpartition cookies only, and the provider's per-account cookies are `SameSite=Strict`, which no engine attaches to a cross-site frame. Chromium's non-cookie grant reaches unpartitioned **embed-origin** storage, which is empty because the embed origin never runs top-level. Making it useful would need a `SameSite=None` provider cookie or a top-level embed document, and both break existing rules.
- A partitioned service worker could serve a cached shell, but API responses are never cached (EI-4) and labels must not be cached in HTTP or SW caches. It adds nothing for the chooser, and the chooser registers none before activation.
- **Clearing site data for the app's site** is expected to clear the embed partition under it in each engine (*needs evidence*; release-gate probe in §7). If an engine does not do this, the chooser could re-identify a user who cleared the app's data, so the chooser must stay disabled in that engine until the evidence exists.

### 3.4 The entitlement bound and the accepted residual

A binding exists only if a flow started in an island delivered a code **to this `client_id`**, on **this top-level site**, for that subject (components-v1 §5.4 `select` rule, `delivered`), and it is live only while that app session's family is (§2). So the information a chooser can leak to its embedder, even through behavioural probing, is limited to a subset of "subjects this app was given on this site from this browser". The app could have recorded that itself at the time. What the embedder can learn beyond its own records:

- that bindings are still present after the app lost its own state (memory-only reload, app-storage eviction). Revocation shows server-side anyway, and the label cache is pruned (§5.3).
- an approximate count, by probing row positions.

It cannot learn identity (A3) without the user completing a flow that grants it, and it cannot learn about other apps, other sites or first-party provider sessions. **Recommended:** accept this residual with owner sign-off. It is the same class the signed-in switcher already carries (embed islands §13.4, "accepted residual: an embedder can hide or overlay islands"). It is gated on the clear-site-data evidence in §3.3.

**Co-user exposure (shared device):** the chooser shows "Ada" to the next person who opens app X on this browser profile, like any account chooser. Mitigations: explicit app sign-out forgets that account (§2, kept); a constant "Remove from this site…" control in the chooser (§5.2); label cache maximum age (§5.3); and owner question 4.

## 4. Options

| Option | What it is | "List as main UI"? | Embedder leak | Provider telemetry before click | Clicks for a returning user | Browser support | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **(a)** Chooser revealed after activation | Constant "Continue with {host}" island. The first click reads storage and then shows the list in the frame. | No: a button first | None before the click; probing after it | None | 3 (reveal, row, provider) | All | Rejected. It misses the owner's direction and adds a click. With 0 bindings the click cannot open a popup synchronously and *then* decide (popups need the activation, and the decision needs an async read), so the 0-account path needs a second click or a pre-opened blank popup that flashes. |
| **(b)** Chooser pre-rendered from the partition, no network | Fixed island. Before activation the worker reads a local label cache (read only) and renders rows. | **Yes** | Timing residual (constant-shape worker work) plus UI-redress probing (§3.4) | None | 2 (row, "Continue as" in provider) | All with partitioned storage; empty where storage is ephemeral or blocked | **Recommended** (with §5 constraints). It is possible only with a new label cache: today's bindings hold no labels. Bindings cannot be validated offline, so rows may be stale up to the cache's maximum age. |
| (b′) Chooser that restores before activation | As (b), but the leader restores to show fresh labels and avatars | Yes | As (b), plus network-timing contention | **Identity-bearing restore on every signed-out page view (A4)** | 2 | All | Rejected: it breaks CPR-13 / P10's network clause, which protects users from provider page-view tracking. |
| **(c)** Top-level popup chooser at the provider origin | `sign-in` island or app button, then a provider popup listing first-party sessions ("Continue as …", add, create) | In the popup, not in the page | None beyond flow timing (adaptive §8.2) | None | 2 (button, provider) = R1 | All (iOS opens a tab; *needs evidence*) | Kept as the fallback and the "Use another account" / "More" target. It is the only path that sees first-party sessions in every browser. |
| **(d)** Storage Access API prompt | Island calls `requestStorageAccess()` to reach unpartitioned state | No | A browser prompt naming the provider on app X; the grant persists (cross-site linkage) | Possibly | 3+ (prompt) | Divergent (§3.3) | Rejected: structurally empty (§3.3), forbidden by P8 and `storage-access 'none'`, and it trades one consent prompt for a cross-site tracking grant. |
| **(e)** FedCM, browser-mediated | **App-as-RP** FedCM (adaptive §11.6; islands never delegate, EXT3-34): passive mode on load or active mode on a button; the browser lists the provider's signed-in accounts | Yes, in browser UI | None designed: FedCM hides login status from the RP until the user picks (*documented; needs evidence*, including rejection timing) | Browser fetches accounts without telling the provider the RP (by design) | 1–2 | Chromium only | Optional enhancement, opt-in (owner question 7). App credentials only (no embed binding). Auto-selected assertions yield memory-only sessions (adaptive §5), so they never feed W11 persistence. |

## 5. Recommended design

### 5.1 Composition (what the embedder renders)

The element decides from **embedder-known facts only**: its own held or persisted sessions, the issuer's declaration, and the element's attributes.

| Embedder-known state | Rendered by `<bindle-sign-in>` (and `signed-out="panel"`) |
| --- | --- |
| App holds ≥1 session (in memory or restored by W11) | **App account list** (exists): rows continue as that account without a flow, per-row sign-out, then "Add account" (reveals the handle field) and "Create a {host} account". No chooser island is mounted. |
| App holds none; `chooser/1` declared and the flag is on | **Chooser island** (fixed box, §5.2), then a constant disclosure **"Sign in with a handle"** (reveals the handle field; label is owner question 8), then a constant **"Create a {host} account"**. The handle field is never shown directly, whatever the island shows. |
| App holds none; no chooser (flag off, not declared, degraded) | As today: the `sign-in` island or the "Continue with {host}" button plus the handle field and "Create a {host} account". |
| Islands off or core-only provider | As today: the handle field shows directly. |

- **While the island mounts** the element shows a same-size embedder-side placeholder (V25 pattern). On handshake failure it falls back to the third row of the table, which is again an embedder-visible transition that does not depend on account state.
- **"Add account" / "Sign in with a handle"** reveals the existing inline-suffix handle field (V14), and submission follows the existing app path (discovery, then app popup or redirect, app credentials only, or a provider-specific `sign-in` island after discovery). The field never reaches an island (no embedder text in islands, C5/§5.3 of components-v1).
- **"Create a {host} account"** stays an app-side constant control on its existing path. Moving it into the island would add nothing, because it is constant either way.
- **No island-to-element message** asks the element to reveal the handle field. The disclosure is purely embedder-side.

### 5.2 The `chooser/1` part

| Aspect | Rule |
| --- | --- |
| Box | Element-chosen. Inline size 280–480 px from the form's container clamp. Block size from `props.density` only: `compact` 208 px (2 account rows), `regular` 256 px (3 account rows); range the island must support 200–320 px. Scaled by the root font-size ratio (EIR-15). Never derived from island content. |
| Structure (constant DOM) | Header with fixed-palette trust text ("Your accounts at {host}" · "{app} can't see this list"); a list of exactly R row nodes (R = 2 or 3 by density) plus one always-present last row; a footer with one constant control "Remove from this site…". |
| Last row | "Use another account" (login intent, no hint) when entries ≤ R. "More accounts at {host}" (login intent, no hint) when entries > R. Same position and same Tab behaviour either way. |
| 0 entries | Same nodes. Empty rows are inert and `aria-hidden`, and the last row is styled as the primary "Continue with {host}" control. A fixed caption reads "Accounts you use on this site appear here". Pixels differ, shape does not. |
| Rows | Display name or handle (two lines, then truncation, full text in the accessible name), plus the **subject monogram** tile (Appendix A of components-v1). There are **no avatar bytes before activation** (owner question 3). |
| Order | Most recently restored first, inside the frame only (never reported). |
| Activation | Arming as C4. Row: synchronously open `about:blank` in the click, then create the entry with `identity` set to the cached handle as an untrusted hint (auth §discovery; the provider shows "Continue as {name}" if that first-party session is live, otherwise sign-in for that account, otherwise its chooser), then the existing popup attestation and code delivery (components-v1 §8–§9). Last row: the same without a hint. |
| Remove | The footer control toggles an in-island confirm mode after activation. Picking a row in that mode, then confirming, deletes that binding and its label (a storage write after activation) and calls `/embed/api/forget` (network after activation). With 0 entries the control is `aria-disabled` (present, constant Tab stop). |
| Inbound | `bindle-island-init`, `locale`, `scheme`, `theme` (ignored, rev 3.3), `props` `{density, seq}`, `prepare` (as `sign-in`), `forget`. No `session`: the chooser is mounted only when the app holds no session. |
| `forget` before activation | Applied immediately: the row disappears from the in-memory view, and the binding and label are deleted locally. This is the **one storage write allowed before activation**, because it is state-reducing and app-initiated (EI-12). The server call is deferred to the next activation or the next member island; the app's own revocation already ended the session server-side. |
| Outbound | `ready`, `flow`, `code` only (no `select`, `escape` or `dismiss`). |
| Degradation | Storage blocked, ephemeral or no database: the island shows the 0-entry state, nothing is reported. Sandboxed: "Open {host}" (noopener) in the last row, as adaptive §10.1. |

### 5.3 Label cache (new at-rest datum in the embed partition)

- **Store:** a new `labels` object store in the existing `bindle-embed` database, keyed by `(issuer, client_id, credential id)`, value `{subject, handle, name?, restoredAt}`. Strings are bounded as in `normalizeView`. **No avatar bytes, no credential, no session token.** EI-4 ("account data and avatar bytes are never cached") is amended only for this record, and only in IndexedDB (never HTTP or SW caches).
- **Writer:** only the **leader** of a member island, inside the transaction that settles a successful restore or a stream `view` change. Deleted in the same transaction as the binding on 401, `forget`, "Remove from this site" and credential pruning.
- **Maximum age:** 30 days since `restoredAt` (owner question 9). The chooser treats older records as absent, and the next member island deletes them.
- **Reader:** the chooser's worker before activation. Steps: `indexedDB.databases()` (Chromium 71+, Safari 14+, Firefox 126+; *needs evidence*) to check that `bindle-embed` exists, **without opening or creating it**. If it exists at a version with the `labels` store, it opens it read-only, runs one `readonly` `getAll` over this client's key range and closes. Otherwise, or if `databases()` is missing, the result is "0 entries". It never upgrades, creates, writes (except `forget`), takes a lock, joins the bus or uses the key.
- **Constant work:** the worker always generates R+1 rasters (monograms for entries, transparent for empty slots, a fixed dummy monogram discarded for padding), and posts its single result no earlier than a fixed floor (for example 150 ms) after `ready`. The document applies one update of identical shape. This does not make the work invisible to browser-wide contention (§3.2), but it keeps the shape and order of work identical.
- **Staleness:** rows can show accounts whose binding was revoked or whose handle changed, for up to the maximum age, because the chooser cannot check without network. A stale row costs one popup that ends in the provider's normal chooser or sign-in. The next member-island restore removes revoked entries. The provider console's "Sign out of all apps" revokes server-side but cannot clear device caches; the console copy should say so.

### 5.4 Persisted app sessions (W11) and how they interact

- **What persists, where:** the app's DPoP key (non-extractable `CryptoKey`), the rotating DPoP-bound refresh token and minimal session metadata (issuer, subject, granted profile and fragments, `authTime`) go in the **app origin's** IndexedDB, owned by the SDK (`BindleClient` key store). Access tokens stay in memory. This is exactly the auth rule "a browser client MAY persist a refresh token only if it is sender-constrained with DPoP" and the release-gate rule "persistent browser refresh tokens are issued only DPoP-bound".
- **Never mixed:** app refresh tokens and keys never enter an island (components-v1 §2.2: the embed origin must not receive app tokens or DPoP keys). Embed credentials, the frame key and the label cache never leave the embed partition (components-v1 §9 C1). The element sends islands only `session{subject}` and `forget`, as today.
- **API (engine-first, `BindleSession` controller):** `persist="device|off"` on `<bindle-session>`. The default is `device` when the issuer advertises `dpop_signing_alg_values_supported` and `refresh_idle_expires_in` and the flow was user-interactive; otherwise memory only. There is no `session` mode, because a `CryptoKey` cannot live in `sessionStorage` and a tab-lifetime emulation is unreliable (owner question 5). New state `restoring`, change cause `restored`, and `bindle-sessions-change` after restore.
- **Restore:** on connect, the controller reads its store, shows held accounts immediately from metadata (embedder data, so no leak), and refreshes lazily on first use or in the background. `invalid_grant` gives cause `revoked` (row removed, existing G6 notice). A network error keeps the row with an offline notice (G14).
- **Rotation across tabs:** serialized with Web Locks on the app origin; re-read under the lock and write the successor before release (adaptive §12). Server reuse detection revokes the family **and its paired component credential**, so the chooser's next member-island restore prunes that label.
- **Never persist** sessions from auto-selected FedCM (`is_auto_selected`) or from any authorization completed without a user interaction (auth SHOULD, adaptive §5).
- **Sign-out:** per account, revoke (RFC 7009 where advertised), delete from the app store and send island `forget{subject}` (exists). "Sign out of all accounts on this device" does the same for all. Explicit sign-out does **not** leave a "signed out" row (owner question 4).
- **How the layers relate after W11:** bindings and app sessions now usually coexist, so the app list covers most return visits and the chooser covers what remains:

| Situation | App layer | Chooser | User sees |
| --- | --- | --- | --- |
| Return visit, both stores intact | Restores sessions | Not mounted | App list (no flow) |
| `persist="off"` app, reload | Nothing held | Rows from the label cache | Chooser, then "Continue as" |
| App storage evicted, embed partition kept | Nothing held | Rows | Chooser (orphaned server families idle out; see §8) |
| Embed partition evicted, app kept | Restores sessions | Not mounted | App list |
| Both evicted, or first visit | Nothing | 0 entries | Chooser empty state: "Continue with {host}" (provider chooser), handle disclosure, create |
| Explicit sign-out of the only account | Removed | `forget` applied | Chooser without that account |

### 5.5 Why this meets "no embedder-visible leak" (within the stated residuals)

- **Geometry:** the box and the surrounding embedder layout depend only on embedder-known state (§5.1), never on island state.
- **Messages:** none before activation beyond the constant `ready`.
- **Focus and scrolling:** constant Tab stops (one list stop and one footer control), no autofocus, no scroller.
- **Network:** none before activation beyond static assets, so the provider learns nothing about identity.
- **Storage:** read only, in a worker, with constant-shape work and no locks, bus or SW, so bfcache is constant.
- **Authority:** every row needs a top-level provider click.
- **Residuals:** browser-wide contention (§3.2) and UI-redress probing (§3.4) remain, each bounded and probed.

## 6. Rule changes needed (proposed; coordinator applies after sign-off)

1. **components-v1 §10 P10**, replacing the sign-in clause:
   > The `sign-in` and `request` islands perform no storage access and no network request after loading the shell until a user activates them. The `chooser` island, until a user activates it, makes no network request other than static, hashed, cookieless assets that are identical for every user, and performs no storage write, key use, Web Locks or BroadcastChannel use, service-worker registration, database creation or upgrade. After `ready` it MAY read its partition-local label cache once, read-only, in a dedicated worker, with work of identical shape for every number of entries; the one permitted write before activation is the local deletion that an inbound `forget` requires.

   *Justification:* P10's two purposes are both kept. CPR-13 (provider page-view tracking) is kept because no network happens. Embedder timing (EIR-3) is kept because the work runs in a worker with constant shape and is probed. A read-only partition read is not observable to the provider at all, and the embedder can observe it only through browser-wide contention, which the switcher already accepts.
2. **ui-elements-audit C8** (coordinator wording): "P10: sign-in and request islands touch no storage and make no network request before activation; the chooser island reads only its label cache and makes no network request before activation (account-chooser-island §6)." G3b is answered by the chooser rather than by a "Continue as" label on the sign-in button.
3. **components-v1 §2** `parts`: allow 1–5 entries and add `chooser/1` to the descriptor enum. **§2.1:** `chooser` requires `credential_binding` with `key-binding.v1` and `authorization-entry.v1` `login`. **§5.3/§5.4/§6:** add the part row and messages of §5.2. **§9.1:** the label cache is part of the island's partitioned storage and is deleted with its binding.
4. **embed-islands:** EI-2 allowlist (`chooser` behind its flag); EI-4 amended for the label record only; §3.2 parts table; §3.4 step 4 notes the chooser's read-only pre-activation read; §5.3 the leader writes labels when it settles restores; §13.2 adds the chooser timing residual; §11 degradation row.
5. **release gates (reference-host islands bullet):** add `chooser` "only behind `CHOOSER_ISLAND_ENABLED` (default off)", the pre-activation rule of item 1, and the verification rows of §7.
6. **No change** to P8 (no inputs; no `requestStorageAccess()`), to EXT3-34 (no FedCM in islands), to the cookieless embed origin, or to components-v1 §9 C1–C5.

## 7. Tests, probes and release-gate rows

**Engine-level (ngin; most tests, per the engine-first preference):**

- Chooser view model as an ngin `Query` over a fake label source:
  - exactly R+1 rows and one footer control for 0, 1, R, R+1 and 8 entries;
  - last-row label switching;
  - truncation;
  - the 30-day maximum age;
  - `(issuer, client_id)` filtering.
- Worker pre-activation operation log, with an instrumented store and fetch: before activation the log contains no `fetch`, no `put`, no `open` that creates or upgrades, no lock or bus use, and exactly one read-only transaction (or none when the database is absent). After `forget` it contains only deletions.
- Label-cache writer: written only in the leader's restore-settle transaction; deleted with the binding on 401, `forget`, remove and prune.
- **Seeded chaos:** random interleavings of claim, restore, stream view change, 401, forget, remove, prune, eviction and chooser mounts, with these invariants:
  - the chooser never shows a label whose binding record is absent;
  - it never shows more than 8 labels;
  - nothing is written before activation except a `forget` deletion;
  - the outbound message sequence before activation is exactly `[ready]`.
- W11 controller tests:
  - persistence only with a DPoP-bound, user-interactive session;
  - restore and `restored` cause;
  - cross-tab rotation under locks with reuse detection;
  - `revoked` on `invalid_grant`;
  - sign-out deletes and forgets;
  - auto-selected FedCM is never persisted.

**Elements gallery** (`tests/browser/elements-gallery.mjs`, Chromium + Firefox; WebKit required before release). Scenarios cover the chooser with 0, 1, 3 and 8 cached entries, light/dark, 390/1280, en/es and RTL. Invariants, which fail the gallery when violated:

- identical iframe border box and identical `getBoundingClientRect` for every embedder node in the composition;
- identical Tab sequence length from before the element to after it;
- port spy shows exactly `[ready]` before activation;
- per-frame network log shows no embed-origin request after the shell and assets before activation;
- one `load`, and `contentWindow.length === 0`;
- bfcache `notRestoredReasons` identical.

**Timing probes (I7 extension; statistical, recorded and gated):** 200 runs each for 0 and 8 entries, comparing island `load`→`ready` latency, embedder rAF jitter and Long Animation Frames over the first 2 s. The two distributions must not be distinguishable at a pre-registered threshold (for example a two-sample Kolmogorov–Smirnov test with p > 0.01), on desktop Chromium/Firefox and Android Chrome (real device before release). Memory probe in a cross-origin-isolated harness: recorded, not gated.

**Browser evidence (release blockers for enabling the flag in an engine):**

- clearing site data for the app's site clears the embed partition (Chromium, Firefox, WebKit);
- `indexedDB.databases()` behaviour in a third-party frame;
- text-fragment and `window.find()` non-traversal of the island;
- Safari ITP removal of partitioned frame storage follows the app site;
- arming against an overlay on a row (activation ignored while disarmed).

**Release-gate rows (proposed text for the reference-host verification paragraph):** "Chooser island (flag on): geometry, Tab count, message sequence, network log and bfcache identical for 0, 1, 3 and 8 cached entries; timing distributions indistinguishable at the registered threshold for 0 and 8 entries on desktop and Android; no pre-activation network, storage write, lock, bus or service-worker use; label cache deleted with its binding and pruned after 30 days; clearing the app site's data clears the chooser in each enabled engine. Persisted app sessions: refresh tokens persisted only when DPoP-bound and user-interactive; refresh reuse revokes the family and its component credential; sign-out deletes and forgets."

## 8. Phasing (provisional)

| Phase | Content | Flag | Rule change |
| --- | --- | --- | --- |
| CH0 | W11 persisted app sessions in the controller, then the elements (engine tests first). **Implemented locally 2026-10-29 (provisional, unsigned):** `packages/sdk/src/session-store.mjs`, `identity.mjs`, `flows.mjs`, elements; tests `packages/sdk/test/session-persistence.test.mjs`, `tests/persisted-sessions-contract.test.mjs`, `tests/browser/persisted-sessions-browser.mjs`, gallery E19f–E19h. Not production-verified. | `persist` attribute | None (fits auth and release gates) |
| CH1 | Label cache writer in member islands, plus pruning | none (inert without a reader) | EI-4 amendment |
| CH2 | `chooser/1` part, element composition, gallery invariants and timing probes | `CHOOSER_ISLAND_ENABLED`, default off | P10/C8, components-v1, embed-islands, release gates |
| CH3 | Browser evidence per engine; enable per engine only when its evidence passes | per-engine enablement | — |

Separately noted (not in scope): memory-only reloads leave orphaned server families until the 180-day idle limit. W11 removes the cause, and the per-client-and-owner session cap (adaptive §12) bounds the rest.

## 9. Open owner questions (with recommended answers)

1. **Amend P10 for the chooser (read-only label cache before activation, still no network)?** Recommended: **yes**, behind the default-off flag, enabled per engine only after §7 evidence passes.
2. **Accept the UI-redress residual** (an embedder can estimate whether, and roughly how many, bindings exist for this app on this site)? Recommended: **yes**, bounded by entitlement (§3.4), matching the switcher's accepted residual. **No** in any engine where clearing the app's site data does not clear the embed partition.
3. **Avatars in the chooser before activation?** Recommended: **no** (monogram plus name only), which keeps "avatar bytes are never cached". Revisit after release.
4. **Should explicit app sign-out keep a "signed out" row, as some account choosers do?** Recommended: **no**. Sign-out forgets, which is safer on shared devices. "Remove from this site…" covers the rest.
5. **W11 modes and default:** `persist="device|off"`, default `device` when DPoP and the idle lifetime are advertised and the flow was interactive, no `session` mode? Recommended: **yes**.
6. **Sequence W11 (CH0) before the chooser (CH2)?** Recommended: **yes**. W11 delivers the direction for most return visits with no rule change. The chooser covers memory-only apps and app-storage eviction.
7. **App-as-RP FedCM (passive or active) as an accounts-first enhancement in Chromium?** Recommended: **opt-in only, default off**, outside this design's gates. It yields app credentials only and never persists auto-selected sessions.
8. **Constant disclosure label when the chooser is live:** "Sign in with a handle" (and "Add account" only in the app-list state)? Recommended: **yes**. "Add account" reads oddly when the island might be empty, and the label must not vary with island state.
9. **Label cache maximum age 30 days since the last successful restore?** Recommended: **yes**, shorter than the 180-day app idle limit, so stale rows age out on devices the person no longer uses.
10. **Show the chooser in the "Add account" view when the app already holds sessions?** Recommended: **no** for v1. Holding sessions plus the chooser would need an inbound "held subjects" message, and the handle field and `sign-in` island already cover adding.
11. **Row counts:** compact 2 + 1 and regular 3 + 1, with "More accounts at {host}" beyond? Recommended: **yes**.
12. **Allow the chooser inside `<bindle-account signed-out="panel">`,** mounted on first intent like the switcher? Recommended: **yes**, with the same fixed box. The intent timing is embedder-side.
