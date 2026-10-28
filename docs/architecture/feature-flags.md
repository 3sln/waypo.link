# Console-managed feature flags

Provisional design, 2026-10-21; implementation status audited 2026-10-24. Registry, evaluation, persisted snapshots, console operations and aggregate experiments are implemented locally in `packages/flags/`; production cutover and release verification remain gated. Reviewer ___ Date ___ Outcome ___.

This is host/reference-implementation behaviour, not Bindle protocol.

User direction (verbatim): "Let's move the feature flags to the admin console instead of cloudflare workers variables. With normal feature flag options like A/B testing, turning on/off for a certain region, user, user shard, percentage of users, etc."

User decisions (2026-10-21, relayed by the coordinator):
- **D-FF1:** env is a **kill switch only**, not a ceiling. Enabling a feature must never need a deploy.
- **D-FF2:** build aggregate-only A/B/n experiments **now**.

Grounding in the current code:
- The registry declares 61 flags (27 class a, 12 class c, 22 class b); the complete class/default inventory is below.
- `packages/flags/read.mjs` supplies synchronous domain reads over the request-pinned evaluator; Worker and Node adapters bind `FlagsRuntime` snapshots.
- `wrangler.jsonc` sets `keep_vars: true`; template values are configuration, not production verification.

Related documents: [boot-and-admin.md](boot-and-admin.md), [app-engine.md](app-engine.md) §3.5, [identity-sharding.md](identity-sharding.md), [open-items.md](../release/open-items.md) §2, [privacy.md](../legal/privacy.md) §3 "Feature rollouts and experiments".

## 0. Decisions in one screen

1. **Flags are declared in code and configured in the console.** A reviewed registry (`packages/flags/registry.mjs`) declares each flag:
   - class and value type;
   - safe value and allowed targeting dimensions;
   - dependencies and risk tier;
   - outage policy and release-gate references;
   - whether it may run experiments.

   The console cannot invent flags.
2. **Env is a kill switch only (D-FF1).**
   - Env unset: the console decides. With no console record, the flag takes the registry safe value.
   - Env explicitly set to the safe value (`"false"`, or `"true"` for `LIFECYCLE_DRY_RUN`): the flag is forced to its safe value, even while the admin store is down.
   - Env explicitly `"true"` (unsafe): honoured **only while the flag has no console record**, then ignored with a visible warning (§2).
3. **The cutover changes no behaviour.** The planned cutover order is seed, then verify, then remove the vars (§9). It must preserve the observed deployment values; the template does not establish which values are active in production. `BILLING_ENABLED` is class (b), so it simply stays in env.
4. **Release gates move from deploy authority to recorded acknowledgement.** While `RELEASE_READY != 'true'`, any edit that widens a flag with open gates:
   - is critical tier;
   - needs passkey step-up, a reason and the typed flag name;
   - needs the exact set of open gate IDs acknowledged;
   - is recorded in the hash-chained audit log (§6).
5. **One evaluation port: `flags.evaluate(name, ctx)`.** It is a synchronous pure evaluator over a snapshot pinned per request, exposed as engine provider `flags` and engine operations `flags.*`.
6. **Snapshot storage, propagation and outages.**
   - Flags live in the existing `AdminStorage`, sharing its revisions and audit log.
   - Caching is per isolate plus per colo, with about 30–45 s propagation and no per-request DO round trip.
   - A last-known-good snapshot is served for up to `FLAGS_MAX_STALE_MS`, measured from its last successful authority read. After that each flag follows its outage policy. Malformed records are quarantined individually; they do not disable unrelated flags.
7. **A flag flip never destroys data.** Flags gate creation and new exposure. Owner read, export, revoke, disconnect and delete paths, and cleanup work, never depend on targeting.
8. **Experiments ship now and record aggregates only (D-FF2).**
   - Assignment is a hash of the account ID and a salt: sticky without storage, with no anonymous bucketing and no new cookie.
   - Exposure and outcome counters are kept per variant per day. There is no per-user event log.
   - Results are displayed only above a minimum cohort size.
   - Admins start, stop and conclude experiments in the console.

## 1. Classification and rollout notes

Dimensions:
- **G**: global on/off plus a schedule window
- **R**: region (country, subdivision)
- **A**: account allow/deny list
- **S**: identity account shard (00–63)
- **P**: percentage of accounts
- **V**: A/B/n experiment
- **C**: client/app ID

Classes:
- **(a)** console rollout with targeting
- **(c)** console switch with declared dimensions (some allow region or client narrowing)
- **(b)** env-only deploy capability; the console shows it read-only

This rollout table retains the original design context; the complete current class/default inventory is at the end of this document. Production seed and cutover steps below remain a procedure, not evidence they ran.

Columns:
- **Seed today** is the checked-in hosted template value intended for the seed procedure (§9), not an observed production value.
- **Outage** is what the flag uses when there is no usable snapshot (§5).

| Flag | Class | Dimensions | Safe | Requires | Risk | Outage | Seed today | Notes |
|---|---|---|---|---|---|---|---|---|
| `ACTIVITY_V2_ENABLED` | a | G A S P C V | off | — | std | safe | off | Stateful. C = app creating activity. Client-exposed. |
| `EVENT_BUSES_ENABLED` | a | G A S P | off | — | std | safe | off | Subject = bus owner. Sweeps follow the kill switch only (§4). |
| `INTEGRATIONS_ENABLED` | a | G A S P C | off | — | crit | safe | off | Disconnect, severance and revocation are always available. |
| `INCREMENTAL_AUTH_ENABLED` | a | G A S P C | off | `FEDERATION_ENABLED` | crit | safe | off | Before the owner is known, only G and C rules match. |
| `EXTENSIONS_ENABLED` | a | G A C | off | — | std | safe | off | |
| `LINKS_ENABLED` | a | G A S P | off | — | std | safe | off | Core links contract, key delegation and the messaging-address descriptor. Renamed from `BINDLEBOX_ENABLED` on 2026-10-26 (retired in `RETIRED_FLAGS`; `envAlias` still reads its raw env value while `LINKS_ENABLED` is unset; a quarantined `BINDLEBOX_ENABLED` record with no `LINKS_ENABLED` record takes the outage path instead, and `flags.retire` of that record copies it to `LINKS_ENABLED`, or writes the off record when its shape does not fit; review F1, 2026-10-27, provisional). The separate messaging app deployment keeps its own env: since 2026-10-27 the Parlay app reads `PARLAY_ENABLED` (and `PARLAY_SERVICES`, `PARLAY_EGRESS`, `PARLAY_KEY_ENCRYPTION_KEY`, `PARLAY_CLIENT_ID`, `PARLAY_ADAPTER_MODULE`, `PARLAY_DATA_DIRECTORY`, `PARLAY_LOCAL_TEST_KEY_HOLDER`), reading the retired `BINDLEBOX_<X>` value only while `PARLAY_<X>` is unset (`apps/parlay/env.mjs`, the same new-name-wins rule). The app keeps no flag records, so an alias cannot widen one; the core registry does not name any Parlay switch. |
| `EMAIL_BRIDGE_ENABLED` | a | G A S P | off | — (delivery waits for any public-intake slot occupant) | crit | safe | off | Subject = recipient owner. Paid entitlement and owner opt-in still apply. |
| `SEMANTIC_SEARCH_ENABLED` | a | G A S P V | off | — | std | safe | **on** | Also needs the AI/Vectorize bindings (adapter capability). The global budget is unchanged. |
| `DEVICE_AUTHORIZATION_ENABLED` | a | G A C | off | — | crit | safe | off | Its declaration uses the global component only (§3.6). |
| `APP_METADATA_DISCOVERY_ENABLED` | a | G C | off | — | std | safe | off (Worker unset) | |
| `SESSION_KINDS_ENABLED` | a | G A | off | `ARTEFACT_VERSIONS_ENABLED` | crit | safe | off | Session kinds and session handler approvals (signaling AMD-SG-I1, proposed, unsigned). Separate from `INTENT_APP_HANDLERS_ENABLED`, which requires `INTENT_LINKS_ENABLED`; session kinds are not tied to intent links (signaling §20.1.8). Approval removal is never gated. |
| `SIGNALING_ENABLED` | a | G A | off | `EXTENSIONS_ENABLED`, `ARTEFACT_VERSIONS_ENABLED`, `SESSION_KINDS_ENABLED` | crit | safe | off | Stateful, no retention predicate. The built-in signaling resource, widening contract operations, owner widening and same-provider sessions (signaling rev 3.2, implemented locally, provisional). Narrowing is never gated. Replaces `RTC_SIGNALING_ENABLED` (retired 2026-10-28). |
| `SIGNALING_FOREIGN_ENABLED` | a | G A | off | `SIGNALING_ENABLED`, `DIRECTORY_ENABLED` | crit | safe | off | Kill switch for the signaling declaration, foreign delivery and `/bindle/signaling`; control statements to held sessions are never gated. Replaces `RTC_FOREIGN_ENABLED` (retired 2026-10-28). |
| `SIGNUP_ENABLED` | c | G R | off | — | crit | last-known | **on** | No subject exists yet. R uses the same trusted `cf.country` as admission. |
| `PAID_SIGNUP_ENABLED` | c | G R | off | valid env billing configuration | crit | last-known | **on** | |
| `WAITLIST_ENABLED` | c | G R | off | — | std | last-known | **on** | |
| `FEDERATION_ENABLED` | c | G | off | — | crit | last-known | off | Global protocol surface. Clients are still governed by `FEDERATION_CLIENTS`. |
| `BROKERING_ENABLED` | c | G C | off | `INTEGRATIONS_ENABLED` (global component) | crit | last-known | off | JWKS is global. C narrows minting clients only. |
| `MCP_ENABLED` | c | G C | off | — | crit | last-known | off | Clients are also bound by `MCP_CLIENTS`. |
| `CLIENT_METADATA_ENABLED` | c | G | off | — | crit | safe | off | Per-host control stays the admin client block. |
| `LIFECYCLE_DRY_RUN` | c, narrow-only | G | **on** | — | crit | safe | on | The console can only force dry run ("pause lifecycle"). It can never switch to live. |
| `LIFECYCLE_ENABLED`, `LIFECYCLE_PURGE_ENABLED` | b | — | off | — | — | — | env | Irreversible deletion, so deploy authority is the second factor. |
| `WORK_LIMITS_ENABLED`, `STORAGE_WRITE_ENABLED` | b | — | **on** | — | — | — | env | Abuse and cost guards. A console action must never disable enforcement. |
| `BROWSER_AUTOMATION_ENABLED` | b | — | **on** | — | — | — | env (on; `false` disables) | Kill switch for browser automation (wargame 3, provisional). Off makes every automation operation except revoke `not_found`; revoke is never gated. |
| `BILLING_ENABLED` | b | — | off | — | — | — | env (on) | Polar secrets. Per-user billing would corrupt entitlement. |
| `MAIL_ENABLED`, `PUSH_ENABLED` | b | — | off | — | — | — | env | Bindings or secrets. |
| `SIGNALING_TURN_ENABLED` | b | — | off | `SIGNALING_ENABLED` | — | — | env | Built-in `ice-relay/v1` relay resource (signaling §16.7, implemented locally, provisional). The resource checks both flags itself (class b `requires` is not evaluated from env). Also needs a TURN adapter and the external `SIGNALING_RELAY_SPEND` authority enforcing a per-owner byte cap; none ships. Replaces `RTC_TURN_ENABLED` (retired 2026-10-28). |
| `FEDERATION_REFRESH_ENABLED` | b | — | on | — | — | — | env | Network and protocol metadata. No rollout use. |
| `FEDERATION_ENTRY_ENABLED` | b | — | off | — | — | — | env | Selects a binding and embed-origin routing. |
| `ONBOARDING_ENABLED` | b | — | off | — | — | — | env | Needs the `ONBOARDING_KEY` secret. |
| `ADMIN_ENABLED`, `ADMIN_CLAIMS_ENABLED` | b | — | off | — | — | — | env | The console cannot control itself. |
| `BROKERED_INTROSPECTION_MOUNTED`, `EVENT_BUS_WAITS_MOUNTED` | b, derived | — | off | — | — | — | — | Mount = the parent flag's **global** component ∧ binding. Recomputed by adapters from `flags`. |
| `PUSH_AVAILABLE`, `EMAIL_AVAILABLE`, `EMAIL_SETUP_AVAILABLE`, `WAITLIST_MAIL_AVAILABLE` | b, derived | — | off | — | — | — | — | Capability facts about bound transports, not flags. |

Numeric and policy settings stay in env: `SIGNUP_*_LIMIT`, `STORAGE_WRITE_*`, `SIGNUP_CONTACT_REQUIRED`, `RELEASE_READY` and `LOCAL_DEVELOPMENT`.

**Retired flags.** `BEAM_ENABLED`, `BEAM_TURN_ENABLED` and `BEAM_STUN_ENABLED` moved to `RETIRED_FLAGS` in [registry.mjs](../../packages/flags/registry.mjs) with `retiredOn: 2026-10-26` when Beam was removed from the core (provisional, unsigned; see DEVLOG). A flag leaves the registry only through `RETIRED_FLAGS`, so existing console records are not orphaned ([removal guard](../../tests/flags-registry-removals.test.mjs)). The `BEAM_MONTHLY_*` settings were removed with them.

A flag is class (b) when any of these holds:
- it selects a binding, secret, route mount or protocol metadata;
- it cannot vary per caller;
- a console write could lower an abuse or deletion safeguard.

Other rules:
- **No region on stateful (a) flags.** Account-placement code has no request geo, so it would disagree with the edge.
- **V is limited.** It is allowed only where the registry declares it, and never on critical-tier, billing, limits, consent or security flags (§7).

## 2. Precedence model

### Raw env states

| Raw env | State | Effect |
|---|---|---|
| unset (or empty) | `unset` | The console decides. |
| exactly the safe value | `kill` | Forced to the safe value. Checked before the snapshot, so it works with the store down. |
| exactly the unsafe value, no console record | `force-on-legacy` | Treated as the on value. This is the pre-console behaviour and the seed source. |
| exactly the unsafe value, console record exists | `ignored` | No effect. The console and `/api/admin` show a warning. |
| anything else | `invalid` | Treated as `kill`, so a typo fails closed. The console shows an error. |

### Evaluation

```
effective(f, ctx):                                     // reason codes in brackets
  if f.class == 'b'                     → envParse(f)                      [env-capability]
  if envState(f) in {kill, invalid}     → f.safe                           [env-kill]
  for d in f.requires: if effective(d, ctx) == d.safe → f.safe             [dependency:d]
  snap = pinned snapshot
  if snap unusable:
     f.outage == 'last-known' && fallback snapshot exists → evaluate on fallback   [outage-last-known]
     else                               → f.safe                           [outage]
  rec = snap.flags[f]
  if !rec: envState(f) == force-on-legacy ? f.onValue : f.safe             [legacy-env | no-record]
  if !rec.on                            → f.safe                           [console-off]
  if subject or client ∈ rec.deny       → f.safe                           [deny]
  if rec.retainExisting && hasState_f(subject) → rec.onValue               [retained]
  if rec.experiment running && eligible(rec.experiment, ctx) → variant(ctx) [experiment:<id>]
  first rule r in rec.rules with matches(r, ctx) → serve(r, ctx)            [rule:i]
  → rec.fallthrough                                                        [fallthrough]
```

### Why `"true"` is ignored once a console record exists

Keeping a deploy-time force-on would break three things:
- **The console kill.** With `keep_vars: true`, a forgotten dashboard `"true"` would silently override a console `off` during an incident.
- **Targeting.** Per-account, percentage and experiment rules could not apply.
- **The release-gate acknowledgement.** A var edit bypasses it.

Honouring `"true"` while no record exists still covers two cases:
- the seed source (the pre-console state);
- self-hosts that never enable administration (`ADMIN_ENABLED` off, no boot). They keep configuring flags in env exactly as today.

The kill direction is the only env state that overrides the console. It is the one that is safe to apply blindly and must work while the store is down.

### Other precedence rules

- **Stale dashboard vars.** A dashboard `"false"` left behind by `keep_vars` would silently kill a flag. So the list view shows every flag's env state as one of:
  - `unset`;
  - `KILL (env)`, as a red banner;
  - `ignored`, a warning;
  - `force-on (legacy)`;
  - `invalid`.

  An edit to a killed flag warns that it has no effect until the var is removed.
- **Parse compatibility.** `envParse` for class (b), and `force-on-legacy` detection, reproduce today's per-flag quirks (`'true'` and `true`, `!=='false'` defaults). A table-driven test pins every flag before any read site changes.
- **Node adapter defaults.** Today Node defaults class (a)/(c) vars to `'false'` (for example `EXTENSIONS_ENABLED:process.env.EXTENSIONS_ENABLED??'false'`). Under D-FF1 that is a **kill**. FF-4 must pass them through unset. The same applies to the explicit `"false"` entries in `wrangler.local.jsonc` (§9).
- **Dependencies.** They come from the registry, are checked for cycles at load, and are evaluated for the same `ctx`. A child's audience is therefore always a subset of its parent's. When an edit makes a child target an audience the parent excludes, the console warns.
- **Global component.** `envState ∉ {kill, invalid} ∧ deps-global ∧ rec.on`. Protocol surfaces use it (§3.6).
- **Kill paths.**
  - Setting the env var to the safe value takes seconds, works with the store down, and is the incident path.
  - Console `on:false` takes 30–45 s.

## 3. Targeting and evaluation

### 3.1 Context

The adapter builds `ctx` from trusted sources only:

```
{ subject: {kind:'account', owner} | {kind:'anonymous'} | {kind:'system', reason},
  client:  {clientId} | null,            // verified registration / signed context, never a header
  region:  {country, subdivision},       // 'unknown' unless trusted
  now }
```

- **Account:** the owner UUID from the verified session, or from the session-proven `X-Bindle-Account` member. The console resolves an entered handle to its owner ID when the edit is saved. Handles are immutable.
- **Shard:** the identity `account` family bucket (SHA-256 first byte mod 64, `identity-v1/account/NN`; see [identity-sharding.md](identity-sharding.md)). It is unsalted and shared by every flag, so it is for infrastructure canaries.
- **Region:** Workers use `request.cf.country` and `request.cf.regionCode` (validated ISO codes), and only when `CF-Connecting-IP` is present. Node reports `unknown` unless the operator configures a trusted geo source. An unknown region never matches. Region is coarse and evadable, so it is not a legal or security guarantee.
- **Anonymous:** no cookie and no device ID. A, S, P, V and retention conditions never match an anonymous subject.

### 3.2 Records and rules

```
{ rev, on, onValue, fallthrough, salt, retainExisting:false,
  deny:  {accounts:[…], clients:[…]},
  rules: [{ when:{accounts?, shards?, countries?, subdivisions?, clients?, subject?, window?:{from, until}},
            serve:{value} | {percent /*0..10000 bp*/, value} }],
  experiment: null | {…}   // §7
}
```

- Rules are ordered, and deny lists are checked first.
- Limits: 32 rules, 1,000 list entries per record, a 256 KiB snapshot.
- A matched rule decides the result. If its percentage excludes the subject, the result is `f.safe`; evaluation does not fall through.
- Windows: `from` is inclusive and `until` exclusive, read from the clock provider.

### 3.3 Percentage bucketing

- `bucket(f, key) = murmur3_32(f.salt + '\x1f' + key) mod 10000`.
- The key is the owner UUID, or the client ID for C-only rules.
- Murmur3 is pure JS and synchronous, with known-answer tests on Node, Workers and the browser. It is not a security primitive.
- Raising `percent` only adds subjects.
- The salt is random per flag, set at seed or take-control.
- Reshuffling changes the salt. It is a separate critical action.

### 3.4 Determinism

- Each request or operation pins one snapshot version and memoizes results per `(flag, ctx)`, so nothing flips mid-operation.
- The evaluator is synchronous, so it replaces `env.X==='true'` without async refactors.

### 3.5 Anonymous and pre-signup

- Signup-funnel experiments are deliberately unsupported, because there is no subject to assign.
- Signup flags target by G and R only.

### 3.6 Protocol-visible surfaces

- Discovery metadata, JWKS, `grant_types_supported`, feature declarations and mounted routes use only the global component.
- A targeted refusal returns the surface's standard error (`feature_unavailable`, OAuth `unauthorized_client`/`access_denied`), with no audience detail.

## 4. Stateful features

- **Off means no new creates or grants (`feature_unavailable`).** Existing records stay untouched. The owner can still list, read, export, revoke, disconnect, delete and see status.
- **Reverse paths are never gated by targeting:** integration severance, event-bus reader revocation, delegation revocation, link revoke and the email-bridge opt-out.
- **Background work follows the env kill only, not targeting or console state:** event-bus sweeps, severance drains, revocation outbox delivery and retention. Cleanup must run even when the console has a flag off. If env kills a flag, background work stops and the data stays.
- **The account single writer is authoritative.** For stateful (a) flags it makes the final decision. The edge refuses early and drives the UI. The writer's snapshot version is never older than the edge's (§5).
- **`retainExisting` (per flag, optional) replaces stored "sticky enrolment".**
  - The registry declares an account-placement predicate `hasState_f(owner)`, for example "has at least one connection" or "has an event bus".
  - Owners who already have feature state stay enabled through ramp-downs.
  - No enrolment record is written, which matches privacy §3 ("needs no extra tracking").
  - Console off, deny lists and the env kill still win.

## 5. Storage, propagation and performance

**Store.** `AdminStorage` gains these keys:
- `flag/<NAME>`;
- `flag-rev/<NAME>/<rev>`, keeping the last 100 per flag and pruning in the same commit;
- `flags-head` (`{version}`);
- experiment results metadata (§7).

It also gains the read-only invoke `flagsSnapshot()`, which returns `{v:1, version, issuedAt, flags}` in one DO turn or one SQLite transaction.

Each flag commit uses the existing `commit({expect, writes, audit, rate})`:
- **expect:** the flag revision, dependency revisions, actor principal and `flags-head`;
- **writes:** the record, plus `flags-head.version + 1` (strictly monotonic);
- **audit:** one of `flag.seed`, `flag.take-control`, `flag.update`, `flag.rollback`, `flag.reshuffle`, `flag.experiment-start`, `flag.experiment-stop` or `flag.experiment-conclude`, carrying before, after, reason and any acknowledged gate IDs.

**Edge (Worker isolate).**
- **Tier 1:** a module-scope compiled snapshot, fresh for 15 s.
- **Tier 2:** the colo Cache API. Two entries:
  - `fresh`, with `max-age=15`;
  - `fallback`, kept for 7 days and used only for flags whose outage policy is `last-known`.
- **Refresh:** after the TTL, keep serving last-known-good and refresh with a single-flight `waitUntil`.
- **Stale limit:** past `FLAGS_MAX_STALE_MS` (default 1 h, range 5 min–24 h), the outage policy applies.
- **Hot-path cost:** synchronous lookups plus at most one murmur3 hash per targeted flag.
- **Unverified:** Cache API behaviour on `workers.dev` and in local dev. The adapter must work without tier 2.

**Account single writer.**
- The edge passes its pinned `flagsVersion` in the RPC envelope. The writer refreshes, single-flight, only when its copy is older.
- Alarms refresh when the copy is older than 5 minutes.
- The writer's version never decreases.

**Node.** One process. The commit path invalidates the cache synchronously, so changes apply immediately.

**Outage policies.**
- **`safe`** is the default.
- **`last-known`** applies only to global switches whose sudden loss would be an outage for every user or relying party: signup, waitlist, federation, brokering and MCP. These flags keep the last committed admin state, which is never fresher than a real admin decision. A cold isolate with no fallback still goes to `safe`.

## 6. Console UX and authority

**Who.** Administrators and boot can edit, consistent with the boot model. Nothing is boot-only. Registry classification is code; the irreversible switches stay in env.

**Every mutation requires:**
- explicit `X-Bindle-Admin-Actor`;
- fresh passkey step-up (5 min);
- the per-actor rate window;
- compare-and-swap on `expectedRevision`;
- an audit entry.

**Critical tier** applies to flags declared critical, and to **any flag with open release gates while `RELEASE_READY != 'true'`**. It adds:
- a reason of 10–500 characters;
- the typed flag name;
- a preview acknowledgement: the client sends a digest of the preview it showed, and the server recomputes it, refusing with `preview_stale` if it changed.

**Release-gate acknowledgement** replaces the deploy ceiling (D-FF1).
1. `widens(old, new)` is computed server-side and conservatively. Any change that is not provably narrowing-or-equal counts as widening, including:
   - turning `on`;
   - a non-safe fallthrough;
   - an added or raised rule;
   - a removed deny entry;
   - a longer window;
   - an experiment start.
2. When a gated flag widens while `RELEASE_READY != 'true'`, the request must carry `acknowledgeGates` equal to **exactly** the set of the flag's open gate IDs from the registry. A missing or extra ID is refused with `gates_unacknowledged`.
3. Widening only to accounts with verified **internal** provenance (boot-and-admin) is exempt. That is how pilots happen.
4. The audit entry records the acknowledged gate IDs, the reason and the open-items revision hash the registry was built against.
5. FF-8 adds a check that the registry's gate references match [open-items §2](../release/open-items.md), so the acknowledgement cannot drift from the ledger.
6. Seeding is not widening when it equals the current effective value, so it needs no acknowledgement (§9).

The registry validator enforces narrow-only and class (b) limits server-side.

**Screens** (dodo/ngin, a `flags` view in the console):
1. **List:** name, class, effective global state, **env state** (§2, with a red banner for `KILL (env)` and warnings for `ignored` or `invalid`), console-managed or not, risk, open-gate badge, running experiment, last change.
2. **Edit:** master switch, deny lists, ordered rules (keyboard-accessible reordering), fallthrough and `retainExisting`. Only the dimensions the registry allows are offered.
3. **Preview:**
   - exact fractions for P (percent) and S (n/64);
   - list counts;
   - "unknown fraction" for R, because region is not retained;
   - dependency and env-kill warnings.
4. **Explain:** evaluate for a handle, owner, region or client, with the reason-code trace. Rate-limited and audited.
5. **History:** per-revision diffs and one-click **rollback**, at the same tier.
6. **Experiments:** see §7.
7. **Seed and cutover:** see §9.
8. **Class (b):** read-only, showing the env value and the reason it is env-only.

**Engine operations** (`packages/app/domains/flags.mjs`, edge placement, actor `admin`/`boot` with the adapter-verified `stepUpAt`; the engine re-checks it against the clock):
- **Queries:** `flags.list`, `flags.get`, `flags.history`, `flags.preview`, `flags.explain`, `flags.evaluate`, `flags.seed-verify`, `flags.experiment-results`.
- **Actions:** `flags.seed`, `flags.take-control`, `flags.update`, `flags.rollback`, `flags.reshuffle`, `flags.experiment-start`, `flags.experiment-stop`, `flags.experiment-conclude`.
- **System action:** `flags.record`, for exposure and outcome events.
- **CLI:** all of these run through `npm run engine` over memory providers.

## 7. Experiments (A/B/n): in scope, aggregate-only (D-FF2)

**Eligibility.** A flag may experiment only if the registry declares `experiment: {metrics: [...]}`, with at most 5 server-side outcome metric names. Experiments are forbidden on:
- critical-tier flags;
- pricing, limits and entitlement;
- security behaviour;
- consent or authorization wording;
- account lifecycle.

**Record:**

```
experiment: { id /*uuid*/, status:'draft'|'running'|'stopped'|'concluded',
              variants:[{key, weight /*bp, sum 10000*/}],   // 2..8; first is control = f.safe
              eligibility:{percent /*bp*/, when?/*G A S C conditions, no R for stateful flags*/},
              variantSalt, startedAt, stoppedAt, concludedAt, winner? }
```

**Assignment.**
- Eligible means account subject ∧ `when` ∧ `bucket(f.salt, owner) < eligibility.percent`.
- `variant = cumulative-range(murmur3_32(variantSalt + '\x1f' + owner) mod 10000)`.
- It is sticky because it is derived from the account ID and a salt. Nothing is stored per user, which matches privacy §3 ("computed from your account ID or region").
- Anonymous subjects are never eligible. No cookie is used.
- While an experiment is `running`, the variants, weights, salts and eligibility are **frozen**. A change means stopping and starting a new experiment, which mints a new `id` and `variantSalt`, so cohorts never silently mix.

**Lifecycle (console):**
- **Start** (`draft → running`) is a widening edit, so it goes through step-up, reason and preview, plus the gate acknowledgement if the flag has open gates.
- **Stop** (`running → stopped`) returns every subject to normal rule evaluation. Counters are kept.
- **Conclude** (`stopped → concluded`) records `winner`. The console then offers, as a separate normal edit, to make the winner the flag's rule or fallthrough value.
- Concluded results stay readable for 90 days after `concludedAt`. Counters are then deleted.
- At most 3 experiments run at once per host, to bound the load on the counter DO.

**Recording.**
- `search_result_opened` is declared for future use but remains unrecorded: opening a search result has no verified server-side outcome signal. Search exposure alone must not be counted as an open.
- Device authorization, incremental authorization and email bridge are non-retainable in the registry: their requests, lineages and queues live in external identity/federation/bridge stores, so the account writer has no authoritative `hasState` predicate. Existing owner reads and reverse paths remain available.

- `flags.record({experimentId, variant, kind:'exposure'|metric, day})` is called at the server point where the variant actually changes what the subject gets (exposure), or where a declared outcome happens.
- The account writer or edge sends it to a `flagStats` port, fire-and-forget with `waitUntil` and bounded retry. A lost increment is tolerated.
- **Counters:**
  - Exposure and outcome **event counts** per `(experimentId, variant, day, kind)`.
  - **Distinct accounts per variant per day**, estimated with a HyperLogLog sketch over `HMAC(dailyKey, owner)`. `dailyKey` is random per UTC day and held only in the counter store. At the day's rollup (before 02:00 UTC the next day) the sketch is reduced to a number, and both the sketch and `dailyKey` are deleted.
  - After rollup nothing derived from an individual account remains.
  - Day-level distinct counts are not summed across days. Results display per-day uniques and total events.
- **No per-user event log** exists anywhere: not in the account store, not in the counter store, not in logs. `flags.record` never logs the owner.
- **Stores:**
  - Workers: a new `FLAG_STATS` Durable Object, sharded 16 ways by `hash(experimentId, variant, shard)`. Shards are merged on read; HLL registers merge by max.
  - Node: SQLite tables.
  - Tests: memory.

**Results.**
- `flags.experiment-results` returns per-variant daily exposures, outcome counts, distinct-account estimates and the outcome rate with a 95% Wilson interval.
- It shows nothing until **every variant has at least 100 estimated distinct accounts on at least one day**.
- After that, any cell with an event count below 20 is shown as "<20".
- No result can be filtered by account, region or client, so per-cohort slicing cannot isolate small groups.

**Privacy check against [privacy.md](../legal/privacy.md) §3 and §4:**
- Assignment comes from the account ID (experiments) or region (rollouts only). Experiments never use R.
- Results are aggregate counts only, with no profiles.
- Legal basis: legitimate interests, as stated in the §4 table row.

FF-7 must re-check that wording before it lands. Two details are not yet in the policy text:
- the 90-day result retention;
- the transient daily HLL key.

FF-8 will raise both with whoever owns privacy.md.

## 8. Client exposure

- `/api/config` stays global, evaluated for `{subject: anonymous, region}`. Its existing booleans keep their names and become evaluated values.
- Account-targeted values and variants come from the signed-in session bootstrap response as a `features` map (exact response chosen in FF-5a). They are evaluated for the selected account member and sent with `Cache-Control: private, no-store`.
- Embed and SDK receive only registry entries marked `client:true`, evaluated for the verified client ID and the connected owner.
- **Never exposed:** rules, lists, salts, buckets, versions, reason codes, experiment IDs, weights, other subjects' assignments, env state, unexposed flags.
- Client values are UI hints. The server evaluates again on every gated operation.

## 9. Migration and tests

The cutover is ordered and changes no behaviour at any step.

1. **Port with no store.** Ship the FF-1 and FF-4 port. With no records, `force-on-legacy` and `kill` reproduce today exactly. Migrate read sites (FF-5). A guard test bans raw reads of registry flags outside `packages/flags/env.mjs` and the adapters' derived-capability lines.
   - The Node adapter stops defaulting class (a)/(c) vars to `'false'` and passes them unset.
   - Equivalence still holds, because unset with no record gives the safe value, which matches today's `'false'` default.
2. **Store and console** (FF-2, FF-3, FF-6). Records stay absent, so behaviour is unchanged.
3. **Seed.** `flags.seed` (boot or admin, critical tier, one audited commit per flag, idempotent, refuses if a record exists) writes a record from the env value **the server itself observes**: `on` with `fallthrough = onValue` for `force-on-legacy`, otherwise off. The client never supplies values. For the checked-in hosted template this keeps `SIGNUP_ENABLED`, `PAID_SIGNUP_ENABLED`, `WAITLIST_ENABLED` and `SEMANTIC_SEARCH_ENABLED` on (`BEAM_ENABLED` was in this list until it was retired on 2026-10-26). Class (b) flags such as `BILLING_ENABLED` are not seeded and stay in env.
4. **Verify.** `flags.seed-verify` evaluates every class (a)/(c) flag twice over a fixed context matrix (anonymous, account, client, several regions): once with legacy env semantics and once from the console record with env treated as `unset`. The console shows "safe to remove" per flag only when every result matches and env is not `kill`/`invalid`.
5. **Remove vars.** Delete the class (a)/(c) entries from `wrangler.jsonc` and `wrangler.local.jsonc`, **and from the Cloudflare dashboard**, because `keep_vars: true` preserves dashboard-set values across deploys. After deploy, the console must show env state `unset` for each flag.
   - A lingering explicit `"false"` shows as `KILL (env)`.
   - A lingering `"true"` shows as `ignored`.
6. **Local config.** In `wrangler.local.jsonc`, the explicit `"false"` entries are kills under D-FF1, so they are removed in the same step.
7. **Targeting starts.** Only after step 5 for a given flag.

**Engine-level tests** (memory providers, fake clock, seeded random):
- every reason code;
- the env-state table (unset, kill, force-on-legacy, ignored, invalid) and the per-flag parse pins;
- the Node default pass-through;
- dependency AND and the global component;
- deny first;
- anonymous subjects never bucketed or experimented on;
- unknown region never matches;
- windows and size caps;
- hash known-answer vectors;
- a property test that ramping is monotonic;
- a property test that experiment assignment is stable across snapshot versions and edits to unrelated flags;
- frozen experiment fields while running;
- `retainExisting` versus kill precedence;
- `widens()` soundness, as a property test that any edit admitting a new subject is flagged;
- the exact-set check on `acknowledgeGates` and the internal-only exemption;
- server-side refusal of class (b) and narrow-only edits;
- seed idempotency and equivalence across the context matrix;
- no salts, lists, IDs, weights or reasons in `/api/config` or the session response.

**Experiment tests:**
- counters with no owner field, and logs with no owner;
- HLL rollup deletes the sketch and `dailyKey`;
- the 100-account minimum and the "<20" suppression;
- 90-day deletion;
- results cannot be sliced by subject;
- the concurrent-experiment cap.

**Seeded chaos:**
- **Concurrent edits.** Concurrent admins editing the same and different flags while snapshot reads interleave. Assert:
  - the version is strictly monotonic;
  - every snapshot equals a committed prefix;
  - the audit chain verifies and the history is complete;
  - compare-and-swap losers get `conflict`.
- **Cache staleness.** Random refresh failures and delays. Assert:
  - nothing is served past max-stale except `last-known` from the fallback;
  - the writer's version never decreases.
- **Counter shards.** Concurrent increments with dropped messages. Assert that totals are never over-counted.
- **Node parity** over SQLite.

**Browser tests:**
- console DOM and accessibility (en/es, light/dark, 320/1440 px);
- critical confirmation, the gate acknowledgement and `preview_stale`;
- experiment start/stop/conclude;
- env-state banners.

## 10. Implementation slices (non-overlapping write ownership)

| Slice | Scope | Owns | Depends |
|---|---|---|---|
| FF-1 | Registry, pure evaluator (env states, precedence, experiment assignment), hash, snapshot validator, `widens()` | `packages/flags/{registry,evaluate,hash,snapshot,env,widen}.mjs`, `tests/flags-evaluate.test.mjs`, `tests/flags-registry.test.mjs` | — |
| FF-2 | Store and flag service: seed, seed-verify, take-control, update, rollback, reshuffle, the experiment lifecycle *state* (start, stop, conclude), gate acknowledgement, preview digest | `packages/identity/admin-store.mjs` (key regex and `flagsSnapshot` only), `packages/flags/service.mjs`, `tests/flags-store.test.mjs`, `tests/flags-chaos.test.mjs` | FF-1 interfaces |
| FF-3 | Engine domain, catalogue rows (`flags` both/effect, `flagStore` edge/platform, `flagStats` both/effect), memory providers, CLI | `packages/app/domains/flags.mjs`, `packages/app/providers.mjs` (three rows), `packages/app/memory-providers.mjs`, `packages/app/edge-operations.mjs` (new), `scripts/engine.mjs` (registry hook), `tests/flags-engine.test.mjs` | FF-1, FF-2 |
| FF-4 | Runtime propagation (tiers, fallback entry, pinning, outage, writer version refresh); adapters, including the Node pass-through of class (a)/(c) vars; `flagStats` adapter wiring | `packages/runtime/flags.mjs`, `apps/worker/index.mjs`, `apps/worker/objects.mjs`, `apps/node/server.mjs`, `apps/node/resources.mjs`, `tests/flags-runtime.test.mjs` | FF-1, FF-2 |
| FF-5a | Read sites: routes, `/api/config` and the session `features` map | `packages/runtime/routes/**`, `packages/runtime/http.mjs` | FF-4 |
| FF-5b | Read sites: account writer and jobs, `hasState_f` predicates, exposure and outcome `flags.record` call sites in the writer | `packages/runtime/accounts.mjs`, `packages/runtime/account/**`, `packages/runtime/{lifecycle-runner,integration-ports,integration-events,federation,incremental-authorization,device-grant,app-notifications}.mjs` | FF-4, FF-7 port |
| FF-5c | Read sites: domain packages, plus the raw-read guard test | `packages/identity/{onboarding,delegation}.mjs`, `packages/billing/signup.mjs`, `packages/mcp/http.mjs`, `packages/activity/index.mjs`, `packages/app/domains/{activity,connections,events,tags,views}.mjs` (flag reads only), `tests/flags-raw-env.test.mjs` | FF-4 |
| FF-6 | Admin HTTP and console UI: list, edit, preview, explain, history, env-state banners, seed and cutover screen, experiment screens | `packages/runtime/admin-flags-http.mjs` (new; the coordinator adds one mount hunk in `admin-http.mjs`), `apps/web/src/{bl,ui}/admin-flags.mjs`, `apps/web/src/{bl,ui}/admin-experiments.mjs`, the export hunk in `apps/web/src/admin-console.mjs`, i18n strings, `tests/browser/admin-flags*.mjs` | FF-3, FF-7 results query |
| FF-7 | Experiment statistics: the `flagStats` port contract, counter store (event counts, daily HLL with `dailyKey`, rollup and deletion, 90-day expiry, shard merge), results computation (Wilson interval, minimum cohort, small-cell suppression), Worker `FLAG_STATS` DO, Node SQLite store | `packages/flags/{experiments,stats,hll}.mjs`, `apps/worker/flag-stats.mjs` (new), `apps/node/flag-stats.mjs` (new), `tests/flags-experiments.test.mjs`, `tests/flags-stats-chaos.test.mjs` | FF-1 (port contract agreed with FF-3/FF-4/FF-5b first) |
| FF-8 | Coordinator work: `wrangler*.jsonc` (`FLAGS_MAX_STALE_MS`, the `FLAG_STATS` binding and migration, and later the removal of class (a)/(c) vars after seed-verify), registry↔open-items gate sync check, privacy.md follow-up, DEVLOG and doc reconciliation | `wrangler.jsonc`, `wrangler.local.jsonc`, `DEVLOG.md`, this document, `tests/flags-gates-sync.test.mjs` | all |

Interfaces to agree first:
- the `flags.for(ctx)` shape (FF-4);
- the `FlagService` signatures (FF-2 and FF-3);
- the `flagStats.record`/`results` contract (FF-7 with FF-3, FF-4 and FF-5b).

Write ownership does not overlap. The `FLAG_STATS` binding is FF-8's; the DO class file is FF-7's; exporting it from `apps/worker/objects.mjs` is FF-4's one-line hunk.

## 11. Questions

1. ~~Env as permanent ceiling?~~ **Resolved (D-FF1, 2026-10-21):** env is a kill switch only. Under this design, `"true"` is honoured only before a console record exists (§2).
2. ~~Build A/B now or later?~~ **Resolved (D-FF2, 2026-10-21):** now, aggregate-only (§7, FF-7).
3. **Lifecycle and abuse limits stay env-only, with a console "pause lifecycle" that forces dry run.** Recommended. Accepted as provisional (coordinator relay, 2026-10-21). Reviewer ___ Date ___ Outcome ___.
4. **Critical edits by one administrator with the extra confirmations; no second approver.** Recommended. Accepted as provisional (coordinator relay, 2026-10-21). Reviewer ___ Date ___ Outcome ___.

### Complete flag registry (2026-10-24)

All 62 entries in `packages/flags/registry.mjs` are listed below. Class **a** is a targeted console rollout; **c** is a console switch with its declared dimensions; **b** is an environment capability (derived rows are computed by adapters). **Safe** is the registry fallback, not a deployment setting. For a/c flags, an unset environment delegates to the console and an absent record uses Safe; an explicit safe value kills the feature. Legacy unsafe environment values apply only before a console record exists and with a usable snapshot. Dependencies and service readiness can still refuse an enabled feature.

**Worker template** is the raw value in `wrangler.jsonc` (unset means no explicit value). **Node default** is the adapter's value without environment/config overrides or console records: a/c uses Safe; b uses the adapter environment parser. Derived capabilities depend on injected resources. Local signup additionally has a pre-console compatibility default in `packages/runtime/routes/shared.mjs`: with no signup record, local development may admit signup subject to its remaining gates. None of these values establishes production verification.

| Flag | Class | Safe | Worker template | Node default |
| --- | --- | --- | --- | --- |
| `ARTEFACT_VERSIONS_ENABLED` | a | false | unset | false |
| `INTENT_LINKS_ENABLED` | a | false | unset | false |
| `INTENT_APP_HANDLERS_ENABLED` | a | false | unset | false |
| `SIGNED_INTENTS_ENABLED` | c | false | unset | false |
| `ACTIVITY_V2_ENABLED` | a | false | false | false |
| `EVENT_BUSES_ENABLED` | a | false | false | false |
| `INTEGRATIONS_ENABLED` | a | false | false | false |
| `APP_CLEAN_REMOVAL_ENABLED` | a | false | unset | false |
| `SUBJECT_DELETED_EVENTS_ENABLED` | a | false | unset | false |
| `INCREMENTAL_AUTH_ENABLED` | a | false | false | false |
| `EXTENSIONS_ENABLED` | a | false | false | false |
| `LINKS_ENABLED` | a | false | false | false |
| `EMAIL_BRIDGE_ENABLED` | a | false | false | false |
| `SEMANTIC_SEARCH_ENABLED` | a | false | true | false |
| `DEVICE_AUTHORIZATION_ENABLED` | a | false | false | false |
| `APP_METADATA_DISCOVERY_ENABLED` | a | false | unset | false |
| `ACCOUNT_EXPORT_ENABLED` | a | false | unset | false |
| `OVER_QUOTA_RETENTION_ENABLED` | a | false | unset | false |
| `ACCOUNT_DELETION_ENABLED` | a | false | unset | false |
| `EMAIL_REMOVAL_ENABLED` | a | false | unset | false |
| `IDENTITY_TRANSFER_OUT_ENABLED` | a | false | unset | false |
| `ORGANIZATIONS_ENABLED` | a | false | unset | false |
| `MEMBER_CERTIFICATES_ENABLED` | a | false | unset | false |
| `ORG_FOREIGN_MEMBERS_ENABLED` | a | false | unset | false |
| `ORG_BREAK_GLASS_ENABLED` | a | false | unset | false |
| `ORG_RELATIONS_ENABLED` | a | false | unset | false |
| `ORG_FOREIGN_RELATIONS_ENABLED` | a | false | unset | false |
| `SESSION_KINDS_ENABLED` | a | false | unset | false |
| `SIGNALING_ENABLED` | a | false | unset | false |
| `SIGNALING_FOREIGN_ENABLED` | a | false | unset | false |
| `SIGNUP_ENABLED` | c | false | true | false |
| `PAID_SIGNUP_ENABLED` | c | false | true | false |
| `WAITLIST_ENABLED` | c | false | true | false |
| `FEDERATION_ENABLED` | c | false | false | false |
| `BROKERING_ENABLED` | c | false | false | false |
| `MCP_ENABLED` | c | false | false | false |
| `CLIENT_METADATA_ENABLED` | c | false | false | false |
| `DIRECTORY_ENABLED` | c | false | unset | false |
| `IDENTITY_TRANSFER_IN_ENABLED` | c | false | unset | false |
| `IDENTITY_SUCCESSOR_ADOPTION_ENABLED` | c | false | unset | false |
| `LIFECYCLE_DRY_RUN` | c | true | true | true |
| `LIFECYCLE_ENABLED` | b | false | false | false |
| `LIFECYCLE_PURGE_ENABLED` | b | false | false | false |
| `WORK_LIMITS_ENABLED` | b | true | true | true |
| `STORAGE_WRITE_ENABLED` | b | true | true | true |
| `REDIRECT_EXTENSION_ENABLED` | b | false | unset | false |
| `BILLING_ENABLED` | b | false | true | false |
| `MAIL_ENABLED` | b | false | true | false |
| `PUSH_ENABLED` | b | false | true | false |
| `SIGNALING_TURN_ENABLED` | b | false | unset | false |
| `FEDERATION_REFRESH_ENABLED` | b | true | unset | true |
| `BROWSER_AUTOMATION_ENABLED` | b | true | unset | true |
| `FEDERATION_ENTRY_ENABLED` | b | false | unset | false |
| `ONBOARDING_ENABLED` | b | false | unset | false |
| `ADMIN_ENABLED` | b | false | unset | false |
| `ADMIN_CLAIMS_ENABLED` | b (derived) | false | computed | computed |
| `BROKERED_INTROSPECTION_MOUNTED` | b (derived) | false | computed | computed |
| `EVENT_BUS_WAITS_MOUNTED` | b (derived) | false | computed | computed |
| `PUSH_AVAILABLE` | b (derived) | false | computed | computed |
| `EMAIL_AVAILABLE` | b (derived) | false | computed | computed |
| `EMAIL_SETUP_AVAILABLE` | b (derived) | false | computed | computed |
| `WAITLIST_MAIL_AVAILABLE` | b (derived) | false | computed | computed |
