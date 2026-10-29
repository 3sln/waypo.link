# Sample apps and multi-provider simulation — design spike

> **Group:** 3sln.me reference service (release verification), with sample Bindle apps and Parlay
>
> **Status:** provisional design spike (2026-10-29), documentation only. Input: owner directions of 2026-10-29 (DEVLOG "Owner directions: CDDL study, sample apps and multi-provider simulation release gate"): build a few semi-realistic sample apps; as a release gate, an end-to-end environment with several providers talking to each other, several apps per user, scaling and organizations; a screenshot mode; runnable in Docker or CI. Everything below beyond those directions is a coordinator proposal. Sign-off: Reviewer ___ Date ___ Outcome ___. No code, spec, release-gate or DEVLOG text was changed. Production release remains disabled.
>
> **Covers:** which sample apps to build and which Bindle surfaces each one uses; the simulation topology (providers, apps, origins, TLS, DNS, egress); the scenario engine (seeded, deterministic, scale knobs, time control); what the simulation asserts as a release gate; screenshot mode and its gallery; Docker and CI packaging; a phased plan, risks and owner questions.
>
> **Does not cover:** interoperability claims. Every provider in the simulation is written by the same authors, so a pass is evidence of self-consistency, not interop (the same caveat as `tests/helpers/second-issuer.mjs` and messaging's CL-24 note). It also does not cover production deployment, real email or push delivery, real authenticators, TURN relays, visual-diff baselines (a later phase), or any change to the production gates in [security](../spec/security.md), [release gates](../3sln/release-gates.md) or DEVLOG.

## 0. Recommendation in one screen

1. **Four small sample apps plus Parlay.** Notes (storage, preferences, sign-in element and islands, app messages, removal), Photos (byte storage, item classification through a stub classifier, intents), Board (organizations with members on two providers, relations, event buses, member tokens) and Meet (scheduling, intents across apps, app messages, and the first browser WebRTC call over Bindle signaling). Parlay covers messaging, invitations through the connect intent, and text classification. They live under `apps/samples/<name>`, share a small kit and use the repo's stack (dodo views, ngin engines, `@3sln/bindle` elements). Each is about 0.8k to 1.6k lines.
2. **One orchestrator, two packagings.** `tests/sim/` starts N real 3sln.me providers on the **Node adapter** (`createNodeServer`, in process), the sample apps, Parlay, a stub classifier and the existing non-3sln peers (`createPeer`, `secondIssuer`). They sit on distinct `https://*.example` origins behind a per-run local CA and a CONNECT proxy, the pattern `tests/browser/islands-sw.mjs` already uses. Server-to-server traffic goes through the adapter's existing DNS and socket seams (`DIRECTORY_DNS_LOOKUP`, `DIRECTORY_HTTPS_REQUEST`, `APP_METADATA_FETCH` and the integration egress), so the screening policy stays as it is. Docker is the same process inside a Playwright image, with the proxy port published so a headed browser on the host can look around. A workerd provider joins in a later phase.
3. **A scenario engine, not a test pile.** Scenarios are seeded scripts of steps over actors (users with a provider, a passkey and per-app browser contexts). Steps run through real browsers or real HTTP/RPC clients. Each scenario declares its expected outcomes, including **expected-pending** steps for features that are not cross-provider yet (for example cross-provider messaging under CL-24). Three scales are offered (small, medium, large). The same seed gives the same ledger digest.
4. **The gate.** Small scale must pass: every step matches its expectation; no page error, CSP violation or 5xx; no egress outside the run's `.example` hosts; post-run invariants hold; replay is deterministic. It runs nightly and on demand, and must be green before any production-gate sign-off. The list of expected-pending steps is reviewed at each sign-off.
5. **Screenshot mode.** `--screenshots` captures a fixed catalogue of moments (consent, owner pages, signaling pages, the org console, Parlay, empty and error states) across Chromium, en/es, light/dark and 390/1280 widths. It uses a frozen browser clock and seeded data, and writes a static `index.html` gallery with a `manifest.json` under `artifacts/sim/<run>/`.
6. **Order.** P0 network and orchestrator with Parlay → P1 Notes and Photos, scenario engine, gallery → P2 Board and Meet → P3 Docker, CI, workerd provider, an identity move between two running providers → P4 scale, visual diffs, release-gate row.

## 1. What exists today (investigation)

| Area | Finding | Consequence |
| --- | --- | --- |
| Browser e2e | `scripts/run-browser-checks.mjs` starts one wrangler Worker on `http://localhost:<port>` with generated vars (flags, `FEDERATION_CLIENTS`, `FEDERATION_SCHEMAS`, fresh signing keys, boot token) and runs `node --test` suites against `E2E_BASE_URL`. `tests/e2e/browser.mjs` gives `launch`, `screenshot` (fonts ready, scroll reset, animations off), soft passkeys (`softWebAuthn`, `passkeyAccount`), `requestSender` and the signup walkers. | The helpers can be reused as they are. The single-origin http setup cannot reach `__Host-` cookies on https `.example` hosts, so the simulation needs real TLS. |
| HTTPS in tests | `tests/browser/islands-sw.mjs` runs wrangler with `--local-protocol https` and a throwaway openssl certificate for `provider.example`, `embed.provider.example` and `app.example`. A test CONNECT proxy maps those names to loopback, and browsers run with `ignoreHTTPSErrors` (Chromium `--ignore-certificate-errors`; Firefox prefs for service workers on overrides). | The pattern for https `.example` origins without editing `/etc/hosts` is already proven here. |
| Several providers | **No test runs two real 3sln.me providers side by side.** Signaling conformance runs one real Node provider (`tests/helpers/signaling-conformance-world.mjs`) against `createPeer` (`tests/signaling-conformance-peer.mjs`, imports no 3sln code) through injected DNS and socket functions. Signaling federation runs several engines in process over a fake network. Organizations use `secondIssuer` (fetch only). Portability uses `tests/helpers/portability-network.mjs` with in-process source and destination engines. `tests/browser/provider-matrix.mjs` uses SDK `createMockProvider` behind `page.route`. The org e2e suites mock every `/api/**` call. | The simulation would be the first place two running providers talk over HTTP. The pieces it needs (seams, peers, fixtures) exist. |
| Egress screening | The Node adapter screens server-to-server fetches. `nonPublicAddress` refuses private addresses, and client metadata fetch requires https on port 443, a registered origin and a public IPv4 address (`packages/apps/node-metadata-fetch.mjs`). Only DNS and the socket can be replaced: `DIRECTORY_DNS_LOOKUP` and `DIRECTORY_HTTPS_REQUEST` ("the screening policy stays", `apps/node/resources.mjs:130`), plus the `APP_METADATA_FETCH`, `SIGNALING_EGRESS` and integration egress injections. | Containers and loopback have private addresses, so a plain Docker network is refused. The simulation injects a name map at those seams (§3.2) and never relaxes the policy. |
| Time | `fakeClock` (`packages/app/memory-providers.mjs`) drives the engine worlds. Node config takes `LIFECYCLE_CLOCK`, `SIGNALING_CLOCK`, `MOVED_CLOCK`, `FORM_POSTBACK_CLOCK` and `RETENTION_CLOCK` as functions. Clients take `client.clock`. | Time control works only for in-process Node providers. This is one more reason the orchestrator runs them in process. |
| Apps | Parlay: client metadata at `/bindle/client.json` (`apps/parlay/worker/metadata.mjs`), `private_key_jwt`, `bindle_integration` with fragments, events, resources and intents (open-conversation, connect) behind `INTENT_LINKS_ENABLED`, and removal behind `APP_CLEAN_REMOVAL_ENABLED`. Its Node shell binds `127.0.0.1:8790`, and provider access comes from `PARLAY_ADAPTER_MODULE`. No other example app exists apart from `examples/device-authorization*`. **No WebRTC code exists anywhere** (no `RTCPeerConnection`); signaling has provider pages but no calling app. | The samples are new code. A call UI has to be built (Meet, §2.4). |
| SDK | `@3sln/bindle` provides `BindleClient` (discover, PKCE, DPoP, `rpc`, `readPreferences`, `userMessage`), `createSession` flows, elements (`<bindle-session>`, `<bindle-sign-in>`, `<bindle-account>`, `<bindle-avatar>`, `<bindle-request>`), islands, item-classification helpers, CBOR, and `testing.mjs` (`createMockProvider`). It has no intent, signaling or event-bus helpers. | Samples build intent links by hand (`?bintent=`) and call signaling and event buses through `rpc`. Gaps found while building them feed the SDK, not the samples. |
| Stack | `vendor/dodo` (vdom `h`, `reconcile`) and `vendor/ngin` (`Engine`, `Provider`, `Action`, `Query`), re-exported by `apps/web/src/shared/stack.mjs`. The pattern: ngin Actions and Queries hold the logic; views are pure dodo functions of state, reconciled on each query emission (`apps/parlay/web/index.mjs`). | Samples follow the same pattern, which matches the engine-first direction (logic drivable without a browser). |
| Flags | Every relevant flag is off by default: `CLIENT_METADATA`, `INTEGRATIONS`, `BROKERING`, `APP_CLEAN_REMOVAL`, `ARTEFACT_VERSIONS`, `INTENT_LINKS`, `INTENT_APP_HANDLERS`, `SESSION_KINDS`, `EXTENSIONS`, `SIGNALING(_FOREIGN)`, `EVENT_BUSES`, `ORGANIZATIONS`, `ORG_FOREIGN_MEMBERS`, `ORG_RELATIONS`, `ORG_FOREIGN_RELATIONS`, `MEMBER_CERTIFICATES`, `DIRECTORY`, `FEDERATION(_ENTRY)`, `INCREMENTAL_AUTH`, `KEY_DELEGATION`, `IDENTITY_TRANSFER_*`. App messages, item classification and embed have no flag of their own. | The simulation runs with a declared flag profile (§3.4). The run records it, so a pass is tied to that profile. |
| CI | `.github/workflows/ci.yml`: one `check` job (30 min) running unit, worker, DOM and ui-state tests, then `run-browser-checks.mjs` with Chromium and Firefox, uploading `artifacts/browser/`. | The simulation becomes a separate job (§3.6) so the main check stays inside its budget. |

## 2. Sample apps

Shared rules for every sample:
- Each sample lives in `apps/samples/<name>/`: `web/` (dodo and ngin), `server.mjs` (a small Node HTTPS app server: static files, `/bindle/client.json`, `/bindle/callback`, and the app's own API only where the app genuinely needs a server), `metadata.mjs`, and `README.md` (one paragraph: what the app shows, its hosts).
- `apps/samples/kit/` holds the shared parts: a `BindleClient` factory, CBOR RPC calls through `client.rpc`, an intent-link builder, an app-server skeleton, shared styles, and an ngin `Engine` bootstrap. The kit is sample-only code. Anything generic it grows is proposed to the SDK separately (core-scope rule).
- **Registration:** every sample serves an OAuth client-id metadata document at `https://<app>.example/bindle/client.json` (`CLIENT_METADATA_ENABLED`). A sample with `resources` or `events_endpoint` is a confidential client (`private_key_jwt` plus `jwks_uri`, integrations §2), with a key generated per run. The others are public browser clients with DPoP-bound refresh tokens. No sample is pre-registered through `FEDERATION_CLIENTS`; the simulation tests the open metadata path. Intent handlers are declared in the metadata `intents` member, like Parlay.
- **Licence and hosts:** MIT, in this repo, `.example` hosts only, not published.

### 2.1 Notes ("a personal notes app")

- **Purpose:** the common first app: sign in, keep text, come back on another device.
- **Surfaces:**
  - `<bindle-session>` and `<bindle-sign-in>` with islands (`embedded-components/v1`: avatar, account-switcher, sign-in) on the provider's embed origin, through `FEDERATION_ENTRY_ENABLED`.
  - `preferences/v2` with a storage resource field (like the `schema.example/sync/v1` fixture).
  - `object-storage/v1` (`put`, `get`, `delete`; the app keeps its own index object because the contract has no listing).
  - Incremental authorization (a second fragment only when the user turns on "Back up attachments").
  - App messages (`client.userMessage`, "Reminder: …").
  - Removal endpoint (`APP_CLEAN_REMOVAL_ENABLED`): cleanup of the index and objects.
- **UI:** a list with an editor, an account chip (island), settings, and empty and offline states.
- **Size:** about 900 lines (web about 600, server and metadata about 150, scenario about 150).
- **Scenario role:** the baseline every simulated user runs. It exercises multi-account (two providers in one browser) and switching accounts.

### 2.2 Photos ("a photo gallery")

- **Purpose:** binary data at volume, classification, sharing through another app.
- **Surfaces:**
  - `object-storage/v1` byte values (CBOR `x-type: bytes`) and `presign` for display.
  - The item-classification fragment with the `image` and `fallback` kinds. The classifier is the stub integration `classify.example` (§3.1), a brokered resource (`INTEGRATIONS_ENABLED`, `BROKERING_ENABLED`) that implements `capabilities` and `classify` with deterministic labels from a hash of the bytes. Labels are advice only. When the classifier is missing, Photos shows the "not classified" state.
  - Intents: Photos **handles** a sample kind `https://photos.example/kinds/view-album/v1` (effect `view`) and **mints** an `open-conversation` link to post an album into Parlay (several apps per user, the chooser and the "always use this app" default).
- **Not used:** `media-description/v1` and `embedding/v1` (spike only, [media and embeddings spike](media-and-embeddings-spike.md)).
- **Size:** about 1,200 lines.
- **Scenario role:** the volume driver (photos per user is a scale knob) and the intent chooser across apps.

### 2.3 Board ("a team task board")

- **Purpose:** organizations in practice.
- **Surfaces:**
  - The org is hosted on provider A, with members homed on A and on B (`ORGANIZATIONS_ENABLED`, `ORG_FOREIGN_MEMBERS_ENABLED` with `ORG_FOREIGN_ISSUERS` set to the run's providers, `MEMBER_CERTIFICATES_ENABLED`, `DIRECTORY_ENABLED`). Members act with member-context tokens (`BindleMember`, SDK `member.mjs`).
  - Org-scoped storage for the board document.
  - A relation from a contractor org on provider B (`ORG_RELATIONS_ENABLED`, `ORG_FOREIGN_RELATIONS_ENABLED`) that gives read access to one board.
  - An event bus (`EVENT_BUSES_ENABLED`; `event-bus-v1` is provisional and unmounted) for "card moved" fan-out to members' open boards.
  - App messages for "assigned to you".
- **UI:** columns and cards, members, an org switcher, a "shared with Contractor Co" banner, and a read-only view for the relation.
- **Size:** about 1,600 lines.
- **Scenario role:** org scale (orgs, members per org, cross-provider share) and event-bus ordering invariants.

### 2.4 Meet ("scheduling plus a call")

- **Purpose:** intents between apps, notifications, and the first real call over Bindle signaling.
- **Surfaces:**
  - Meet handles the sample kind `https://meet.example/kinds/propose-time/v1`, minted from Board cards and Parlay conversations.
  - App messages for invitations and reminders.
  - `preferences/v2` for time zone and working hours.
  - The signaling fragment and `SIGNALING_ENABLED` with `SESSION_KINDS_ENABLED`; `SIGNALING_FOREIGN_ENABLED` with `SIGNALING_FOREIGN_ISSUERS` for a call between users on A and B.
  - A 1:1 WebRTC call using a data channel plus Chromium fake media (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--disable-features=WebRtcHideLocalIpsWithMdns`). Only host candidates are used (no TURN; the ICE relay fragment is left empty). This is allowed, because `nonPublicAddress` refuses only cross-entity srflx and relay candidates.
  - The provider's signaling consent and owner pages appear in the flow.
- **Size:** about 1,300 lines (the call view about 400).
- **Scenario role:** cross-app and cross-provider handoff, and signaling sessions as a scale knob.

### 2.5 Parlay (existing)

- **Surfaces:** messaging mailbox, invitations through the `connect` intent, `open-conversation`, text classification (built-in or stub), removal.
- **Simulation integration:** a `PARLAY_ADAPTER_MODULE` for the simulation that points its services and egress at the simulation network.
- **Cross-provider:** messaging is same-host only (messaging CL-24, release-gates "Messaging invitations"). Cross-provider invitations and messages are **expected-pending** steps: they assert today's refusal and flip to expected-pass when the rule changes.

### 2.6 Test-only shortcuts

| Allowed (recorded in the run manifest) | Not allowed |
| --- | --- |
| Soft passkeys (`softWebAuthn`, `passkeyAccount`) or the CDP virtual authenticator; real adapter verification still runs. | `page.route` or any mock in front of a **provider** API. Mocks are allowed only for third-party resources outside Bindle (none are planned). |
| The local Turnstile token (`local-browser-test-token`) on providers configured for local tests. | `dev:demo` or any demo route; `LOCAL_DEVELOPMENT=true` (it belongs with a loopback http origin only). |
| A captured mail transport (the Node `mailer` injection) as the mailbox for email steps. | Writing grants, sessions, orgs or memberships straight into storage. Seeding goes through real HTTP and RPC or the real engine factories. |
| A per-run local CA and `ignoreHTTPSErrors`; DNS and socket replacement at the existing seams. | Turning off or widening egress screening, or allowlisting private addresses in production code. |
| Clock functions injected into in-process providers; Playwright `page.clock` in screenshot mode. | Secrets, real provider keys or non-`.example` hosts; any outbound network beyond `npm ci` and browser installs. |
| Flags on in the simulation profile that are off in production (recorded). | Claiming a production gate or interop from a simulation pass. |
| Preloading sample intent-kind artefacts in provider config if fetching is not mounted (recorded). | Skipping a consent screen. Every grant in a browser step is approved through the UI; API-driven actors approve through the same entry endpoints. |

## 3. Simulation environment

### 3.1 Topology

All hosts sit under `.example`. Provider names are generic so that no real organization is implied.

| Host | Role |
| --- | --- |
| `alpha.example`, `embed.alpha.example` | 3sln.me provider A (Node adapter, in process). Hosts the org. |
| `beta.example`, `embed.beta.example` | 3sln.me provider B (Node adapter, in process). Members and the contractor org. |
| `gamma.example` | Phase 3: 3sln.me provider C on workerd (`wrangler dev --local-protocol https`). Its egress needs a separate seam (§5, R2). |
| `peer.example` | Non-3sln signaling peer (`createPeer`), served over HTTP. |
| `second.example` | Non-3sln issuer (`secondIssuer`), extended to serve over HTTP. Foreign org member. |
| `notes.example`, `photos.example`, `board.example`, `meet.example` | Sample app servers. |
| `messages.example` | Parlay (keeps its existing client ID host). |
| `classify.example` | Stub classifier integration: confidential client with brokered `capabilities` and `classify`. |

Each user is homed on one provider. The default small world has 3 users on A, 3 on B and 1 on `second.example` (org member only).

### 3.2 Network, TLS and cookies

- **Orchestrator (`tests/sim/network.mjs`).**
  - Creates a per-run CA and one leaf certificate with every simulation host as a SAN (openssl, as in islands-sw), and keeps them in a temporary directory that is deleted after the run.
  - Starts one HTTPS listener per host on a loopback port.
  - Keeps a name map `{host → 127.0.0.1:port}`.
- **Browser side.** A CONNECT proxy resolves only the map's hosts (and refuses everything else, which is also the egress check). Browsers launch with that proxy and `ignoreHTTPSErrors`. Origins are real `https://<host>` on port 443, so `__Host-` cookies, Secure, SameSite, COOP and CSP behave as deployed.
- **Server side.** Each provider gets `DIRECTORY_DNS_LOOKUP` (answers a fixed **public** sentinel address for map hosts, as the signaling conformance world does with 8.8.8.8, and fails for any other name; documentation ranges such as 192.0.2.0/24 cannot be used because the classifier refuses them, and the sentinel is never dialled) and `DIRECTORY_HTTPS_REQUEST` (connects the sentinel to the map's loopback port, trusting the run CA). The same function pair is passed to the `APP_METADATA_FETCH`, `SIGNALING_EGRESS` and integration egress factories, so the policy code (port 443, registered origins, redirects, size and time bounds) runs unchanged.
- **Where the seams live.** They live only in `tests/sim/`. `createNodeServer` already takes them through `config` objects, which cannot be set from environment variables. Nothing is added to `apps/node/server.mjs`'s CLI path.
- **Parlay and samples** use the same lookup and request pair for their outbound calls.

### 3.3 Scenario engine

- **Layout:** `tests/sim/world.mjs` (topology and actors), `tests/sim/steps/*.mjs` (step library), `tests/sim/scenarios/*.mjs`, `scripts/sim.mjs` (CLI).
- **Actors:** `User {provider, handle, authenticator, mailbox, contexts:{app→BrowserContext}, api:{app→BindleClient in Node}}`, `Org {host provider, members, relations}`, `App {origin, metadata, key}`.
- **Steps:** each is `{id, actor, via:'browser'|'api', run(ctx), expect:'pass'|{fault}|'pending:<reason>', shot?:[names]}`.
  - Browser steps use the existing helpers (signup walkers, `softWebAuthn`, `screenshot`).
  - API steps use `requestSender` and an SDK `BindleClient` with the simulation `fetcher` and a memory key store.
  - Engine-level setup (for example the org world fixtures) is allowed only for actors the scenario does not observe through UI.
- **Determinism:** one seed (`--seed`) drives names, avatars, content, ordering and photo bytes (generated deterministically, no image corpus). Steps run in a fixed order. A separate **load phase** runs with a concurrency knob and asserts invariants only, not order. The ledger (each actor's created and expected objects) is digested; the same seed must give the same digest.
- **Time:** providers run on a shared simulation clock injected through `LIFECYCLE_CLOCK`, `SIGNALING_CLOCK`, `MOVED_CLOCK`, `RETENTION_CLOCK` and `FORM_POSTBACK_CLOCK`. Real time is the default. Time-travel steps (`{advance:'25h'}`: a provisional passkey becomes ordinary, a reminder fires, retention runs) advance it and call the lifecycle runners. Browsers follow with `page.clock` in those steps. The workerd provider (phase 3) is real-time only, and time-travel scenarios skip it.
- **Scales** (time estimates are unmeasured and to be confirmed in P1):

| Knob | small (gate) | medium (nightly) | large (manual) |
| --- | --- | --- | --- |
| Providers | A, B (+ peer, second) | A, B, C | A, B, C |
| Users | 7 | 60 | 300 |
| Apps per user | 2–4 | 2–5 | 2–5 |
| Orgs and members per org | 2 × 4 (one relation) | 8 × 10 | 30 × 25 |
| Photos per user | 5 | 40 | 100 |
| Messages (same-provider) | 200 | 5,000 | 50,000 |
| Signaling sessions | 2 (1 cross-provider) | 20 | 100 |
| Browser contexts in parallel | 4 | 8 | 16 (API actors for the rest) |
| Estimated wall time | 8–12 min | 30–45 min | 1.5–3 h |

- **Scenario set (small):**
  1. **S1 onboarding:** signup on A and B through the UI, recovery file, multi-account in one browser.
  2. **S2 Notes:** connect, preferences, storage, incremental fragment, app message, revoke and reconnect, removal cleanup.
  3. **S3 Photos:** upload, stub classification, no-classifier state, `view-album` intent, chooser between Parlay and Photos, "always use".
  4. **S4 Parlay:** same-provider invitation through `connect`, conversation, classification; cross-provider invitation (expected-pending).
  5. **S5 Board:** org on A, foreign members from B and `second.example`, member-token writes, event-bus fan-out to two open boards, contractor relation from B, removal of a member.
  6. **S6 Meet:** `propose-time` from Board and from Parlay, invitation message, a cross-provider call A↔B (signaling consent, connected data channel, hang up), owner page shows the session.
  7. **S7 time:** advance 25 h and 30 d; provisional-passkey promotion, reminder delivery, retention.
  8. **S8 identity move (P3):** move a user from B to A between the two running providers, if the revision 3.3 local implementation can be enabled end to end; otherwise expected-pending.
  9. **S9 load:** the load phase at the chosen scale.

### 3.4 Flag profile

The `sim` profile turns on, for A and B: `FEDERATION`, `FEDERATION_ENTRY`, `CLIENT_METADATA`, `INTEGRATIONS`, `BROKERING`, `APP_CLEAN_REMOVAL`, `SUBJECT_DELETED_EVENTS`, `ARTEFACT_VERSIONS`, `INTENT_LINKS`, `INTENT_APP_HANDLERS`, `INCREMENTAL_AUTH`, `EXTENSIONS`, `SESSION_KINDS`, `SIGNALING`, `SIGNALING_FOREIGN`, `DIRECTORY`, `EVENT_BUSES`, `ORGANIZATIONS`, `ORG_FOREIGN_MEMBERS`, `ORG_RELATIONS`, `ORG_FOREIGN_RELATIONS`, `MEMBER_CERTIFICATES` and `SIGNUP`. In P3 it adds the `IDENTITY_TRANSFER_*` flags. `KEY_DELEGATION` and the sign-in P3 flags (`EMAIL_FLOW_V2`, `EMAIL_SIGNUP_ENABLED`) run as a second profile, `sim-signin`, so a failure points at one feature set. The run manifest records both profiles.

### 3.5 Assertions (what must pass)

- **G1 Expectations:** every step meets its `expect`. An expected-pending step that starts passing fails the run until it is promoted, so stale "pending" entries cannot hide.
- **G2 Page health:** no `pageerror`, no console error, no CSP violation report and no unhandled rejection on any page of any origin. The allowlist of known messages lives in the scenario file with a reason.
- **G3 Server health:** no 5xx and no uncaught error in any provider, app or Parlay log. The proxy and DNS seams saw no host outside the map. Logs pass `redactIntentLog`, and a scan finds no token, recovery secret, code or cookie value.
- **G4 Invariants after the run:**
  - Objects each user created can be read back; deleted ones answer not found.
  - Revoked grants fail with live tokens.
  - Removal leaves no app data.
  - Org rosters agree from both providers' views.
  - Event-bus cursors are monotonic with no gaps.
  - Signaling sessions are closed.
  - Account counts match the ledger.
- **G5 Layout:** the existing `noOverflow` and colour-scheme luminance checks pass on every screenshot surface at 390 px.
- **G6 Determinism:** the ledger digest is identical on a replay of the same seed (checked nightly at small scale).
- **G7 Budget** (informational until P4): p95 per step kind at small scale is recorded and compared with the previous run.

### 3.6 Relation to existing suites

- **Reused:** `tests/e2e/browser.mjs` (launch, `screenshot`, soft passkeys, signup walkers, `requestSender`), the islands-sw certificate and proxy approach, `createPeer`, `secondIssuer`, `fakeClock`, `redactIntentLog`, and the luminance and overflow helpers from the admin and org e2e suites.
- **Not replaced:** engine-level tests stay the main correctness net (engine-level testing preference). The simulation adds no edge-case matrix; it checks that the real pieces compose across origins.
- **Explicitly out:** `dev:demo` and its in-memory routes.

## 4. Packaging, CI and budget

### 4.1 Local

- `npm run sim -- --scale small [--seed 7] [--screenshots] [--headed] [--keep]`.
- `--keep` leaves the world running and prints the proxy address. `npm run sim:browser` opens headed Chromium through that proxy, so you can look around `https://alpha.example/console`, the samples and so on. No hosts-file edits are needed.

### 4.2 Docker

- `tests/sim/docker/Dockerfile` is based on `mcr.microsoft.com/playwright:v1.64.0-noble` (it matches the pinned `playwright`, and the image's Node is upgraded to 24 per `engines`). It runs `npm ci`, `npm run build:assets` and the Parlay asset build, with `scripts/sim.mjs` as the entry point.
- `compose.yaml` has one `sim` service (CPU and memory limits, `artifacts/` as a volume, the proxy published on `127.0.0.1:3128`). In P3 it adds a `gamma` service running workerd.
- Same orchestrator, so Docker and bare runs cannot drift.

### 4.3 CI

A sketch, not to be added until P3:

```yaml
simulation:
  runs-on: ubuntu-latest
  needs: check
  if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' || contains(github.event.pull_request.labels.*.name, 'simulation')
  timeout-minutes: 45
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: {node-version: 24, cache: npm}
    - run: npm ci
    - uses: actions/cache@v4
      with: {path: ~/.cache/ms-playwright, key: pw-${{ hashFiles('package-lock.json') }}}
    - run: npx playwright install --with-deps chromium
    - run: npm run sim -- --scale ${{ inputs.scale || 'small' }} --screenshots --seed ${{ github.run_number }}
    - if: always()
      uses: actions/upload-artifact@v4
      with: {name: simulation, path: artifacts/sim/, retention-days: 14}
```

The workflow gains `schedule: [{cron: '0 4 * * *'}]` and `workflow_dispatch` inputs `scale` and `screenshots`. A fixed-seed replay runs nightly for G6. Firefox is added to screenshot mode once it is stable.

### 4.4 Budget

These figures are estimates, to be measured in P1:
- Small: 2 Node providers, 6 app servers and up to 4 Chromium contexts fit in about 3 to 4 GB of RAM and 2 vCPU. The standard `ubuntu-latest` runner (4 vCPU, 16 GB) is enough.
- Screenshot mode adds about 3 to 5 minutes at small scale: about 60 moments × 8 variants in Chromium, about 500 PNGs, roughly 150 MB of artifacts.
- Medium needs about 6 GB and runs nightly only.

## 5. Screenshot mode

- **Moments (the catalogue, versioned in `tests/sim/shots.mjs`):**
  - Sign-in element and islands on a sample app.
  - The provider sign-in and chooser.
  - First-use consent for each sample (fragments, brokered resource disclosure, incremental expansion).
  - The intent chooser and the "always use this app" prompt.
  - The connections and app-removal pages.
  - The owner pages for signaling sessions and the signaling consent.
  - The org console: roster with foreign members, relation statement, member removal.
  - Parlay: conversation list, conversation, invitation accept, classification states.
  - Notes and Photos with empty, populated, offline and "not classified" states.
  - Board: columns, read-only relation view, an event-bus update arriving.
  - Meet: proposal, call connecting, connected, ended.
  - Failure states: a refused cross-provider invitation (pending), a revoked grant, provider B down (the proxy holds B), storage over quota.
  - Multi-account switcher with accounts on A and B.
- **Variants:** Chromium (Firefox later) × en/es × light/dark × 390×844 / 1280×900.
- **Naming:** `artifacts/sim/<run-id>/shots/<scenario>/<nn>-<moment>--<locale>-<scheme>-<width>.png`.
  - `run-id` = `<UTC date>-<scale>-s<seed>-<git short sha>`.
  - `manifest.json` lists each shot with scenario, step, origin, path, viewport, locale, scheme, flag profile and a pixel hash.
- **Gallery:** `artifacts/sim/<run-id>/index.html`, one static file with no external requests. It groups shots by scenario, filters by locale, scheme and width, shows variants side by side, and puts expected-pending and failure shots in their own section.
- **Stability:**
  - `page.clock.setFixedTime` at a fixed simulation date.
  - Seeded names and deterministic generated avatars and photos.
  - `animations:'disabled'`, fonts ready, scroll reset (the existing `screenshot()`).
  - Random identifiers are masked with Playwright `mask` (UUID, handle suffix, QR codes).
- **Visual diff (P4):** compare pixel hashes against a baseline run's manifest first, then a pixel diff (a small vendored MIT diff or the Playwright test runner's comparator, to be decided). Diffs are reported, never auto-failed, until the owner sets a policy.

## 6. Phased plan

| Phase | Deliverable | Exit check |
| --- | --- | --- |
| P0 | `tests/sim/network.mjs` (CA, listeners, proxy, DNS and socket seams); orchestrator starting A and B in process plus Parlay with a simulation adapter module; S1 plus same-provider S4; a basic `screenshot` capture. | Two real providers exchange directory and metadata fetches over the seams. A browser signs up on both and uses Parlay on A. G1–G3 hold. |
| P1 | `apps/samples/kit`, Notes, Photos, the stub classifier, scenario engine (seed, ledger, scales, load phase), S2 and S3, gallery and manifest, measured budgets. | Small scale deterministic (G6) locally on two machines. |
| P2 | Board (cross-provider org, relation, event bus) and Meet (intents, app messages, cross-provider call); S5–S7; `second.example` and `peer.example` served over HTTP. | All small scenarios green or expected-pending with reasons. |
| P3 | Dockerfile and compose, CI job (nightly plus label), workerd provider C with its egress seam, S8 identity move between running providers, the `sim-signin` profile. | Nightly green for 7 consecutive days. |
| P4 | Medium and large scales, budget trend (G7), visual-diff report, release-gate row ("Multi-provider simulation") proposed in release-gates. | Owner sign-off of the gate row. |

## 7. Risks

- **R1 Egress seams vs realism.** Replacing DNS and the socket is test-only realism: the policy code runs, but real resolution and real public certificates do not. Mitigation: the seams live only in `tests/sim/`, and existing gates (Workers egress against private and rebinding targets) stay separate.
- **R2 Worker egress.** workerd has no DNS or socket seam equivalent; outbound `fetch` from `wrangler dev` to `*.example` would need an outbound proxy or a service binding. Mitigation: provider C comes in phase 3, with a design note before any Worker change. Until then the simulation's evidence is Node-only, as the run manifest states.
- **R3 Flakiness.** Sources: WebRTC, wrangler start-up, event timing. Mitigation: deterministic phase separate from the load phase; waits on observable state only (no sleeps); one retry for browser launch only; failed runs keep traces (`context.tracing`) in artifacts.
- **R4 Not-yet-cross-provider features.** Cross-provider messaging (CL-24), portability revision 4 and foreign members (gated behind a clean-room issuer) mean early runs carry many expected-pending steps. Mitigation: G1 fails on a stale pending entry, and the pending list is reviewed at each sign-off.
- **R5 Sample apps as burden.** Mitigation: keep them small and sample-only; their kit is not a product; anything generic moves to the SDK by separate decision (core scope).
- **R6 Self-consistency mistaken for interop.** Mitigation: the run manifest and the gallery header state it; only `createPeer` and `secondIssuer` are non-3sln, and they share authors.
- **R7 Time and cost.** Mitigation: small scale stays under 15 minutes, outside the main `check` job.
- **R8 Secrets.** None are needed. Keys and CAs are generated per run and deleted; `.example` hosts only; the proxy refuses other names, so a mistake cannot reach the internet.

## 8. Open owner questions (with recommendations)

1. **Gate cadence.** Recommendation: nightly plus on demand (PR label). Must be green before any production-gate sign-off. Not on every PR.
2. **Expected-pending steps.** Recommendation: allowed, each with a reason and a linked spec rule. A pending step that starts passing fails the run until promoted.
3. **Node-first.** Recommendation: the gate runs on the Node adapter in phases P0–P2; the workerd provider follows in P3, after a short design for its egress seam.
4. **Flags in the simulation that production keeps off** (foreign members and relations, signaling foreign, event buses). Recommendation: on in the `sim` profile, recorded, and never cited as meeting their production gates.
5. **Sample set.** Recommendation: Notes, Photos, Board, Meet plus Parlay. Meet carries the first WebRTC call UI. A separate calls app is not needed.
6. **Sample intent kinds** (`view-album`, `propose-time`) hosted on sample origins. Recommendation: yes, as sample artefacts. Spec intents §11 registers no kinds, so samples defining their own is realistic.
7. **Screenshot baselines.** Recommendation: not committed for now; artifacts only. Revisit in P4 (separate branch or artifact store).
8. **Classifier.** Recommendation: a deterministic stub integration (`classify.example`), not a sample app. The 3sln.me built-in classifier (text only, paid) runs in the `sim-signin` profile only if its budget seams allow without external services.
9. **Identity move (S8).** Recommendation: try with revision 3.3 local code in P3; expected-pending if it cannot complete between two running providers.
