# Development log

## Working agreement

This log is the project ledger for decisions, implementation, evidence, and pending work. Major choices remain provisional until a human signs below; unsigned entries do not automatically block reversible work. Production authentication, migrations, deployment, and externally consequential changes require their implementation gates to be satisfied. Every agent must report changes here through the coordinator.

## 2026-10-11 — Bootstrap and first vertical slice

Initial workspace was empty and had no Git repository. Coordinator delegated independent protocol/contracts, authentication/security, and frontend/SDK work; coordinator owns the reference resource engine, HTTP adapter, integration verification, and this ledger. Agents use the inherited model and reasoning configuration; no model override was available under the current delegation instructions.

### Decision register

| ID | Decision and rationale | Status / human sign-off |
| --- | --- | --- |
| D001 | Use **Bindle** as provisional protocol name and `/.well-known/bindle/manifest.json`, matching the supplied path. The brief also says Bridle; settle spelling before public release. | Provisional. Reviewer: ___ Date: ___ Outcome: ___ |
| D002 | Discover a manifest at `https://host/.well-known/bindle/manifest.json`; send the handle separately as a login hint. `https://user@host` denotes URL userinfo, not a user-specific host resource. Stable subject URLs are distinct from mutable email/login handles. | Recommended. Reviewer: ___ Date: ___ Outcome: ___ |
| D003 | Build on OAuth authorization code + S256 PKCE, with exact registered redirects and issuer binding, rather than inventing an authentication protocol. Redirect login is the v0 baseline; embedded login remains deferred pending a secure browser flow. | Recommended; production gate. Reviewer: ___ Date: ___ Outcome: ___ |
| D004 | Email fallback occurs only after definitive absent discovery (404/410) and explicit user choice. Network/TLS/server failures must not silently change identity provider. Verified email association never silently merges accounts. | Recommended. Reviewer: ___ Date: ___ Outcome: ___ |
| D005 | Fragment/contract definitions are immutable, versioned HTTPS URLs. Public metadata describes fields; personal preference values remain private. Apps explicitly request contract methods and users see the exact resource selection. | Recommended. Reviewer: ___ Date: ___ Outcome: ___ |
| D006 | Effective resource authorization intersects the approved resource set with current preference assignments, supported contracts, method allowlist, live grant, and expiry. New assignments need renewed consent; removals revoke effective access immediately. | Implemented in local engine. Reviewer: ___ Date: ___ Outcome: ___ |
| D007 | Sync writes require optimistic concurrency; transaction IDs deduplicate identical requests and reject different payloads under the same ID. Replays still require live authorization. | Implemented in local engine; durable deduplication pending. Reviewer: ___ Date: ___ Outcome: ___ |
| D008 | Use **entity** for the authority owning data, with individuals first and organizations later; subject denotes its token identity. Organizational delegation must have explicit membership/roles and no implicit graph inheritance. | Provisional. Reviewer: ___ Date: ___ Outcome: ___ |
| D009 | Start with profile, preferences, resource discovery, and object storage; design separate contracts for files/collections and events. Implement one hosted storage backend before Google Drive/WebDAV/S3 adapters. Avoid claiming all providers have identical guarantees. | Recommended. Reviewer: ___ Date: ___ Outcome: ___ |
| D010 | Provide an offline runnable, loopback-only, in-memory prototype first. It is not an identity provider and has no real email delivery, passkey verification, or provider credentials. Production services will reuse the authorization semantics behind authenticated owner sessions. | Current implementation boundary. Reviewer: ___ Date: ___ Outcome: ___ |
| D011 | Integrate actual local 3sln dodo/ngin source with license/provenance, because external DNS/source retrieval failed. Do not guess stack APIs or install unverified replacements. | Implemented. Reviewer: ___ Date: ___ Outcome: ___ |
| D012 | Hosted v0 trusts the operator with plaintext data and encrypted-at-rest connector secrets. Self-hostability is not end-to-end encryption or portable domain identity; user-only encryption and provider migration need separate designs. | Explicit custody boundary. Reviewer: ___ Date: ___ Outcome: ___ |
| D013 | Use issuer-side resource gateway only, static registered clients, five-minute tokens, and mandatory live grant checks in v0. Remote resource delegation and iframe authentication require separate trust profiles. | Recommended. Reviewer: ___ Date: ___ Outcome: ___ |

### Completed work

- Reference authorization engine: resource ownership, explicit consent, resource/method-scoped grants, live revocation, expiry, current preference intersection, transaction replay, and optimistic storage writes.
- HTTP demo adapter: loopback binding, Host/Origin checks, JSON/body limits, same-origin static content policy, fixture consent/preferences/revocation and RPC routes. It intentionally publishes no authentication/discovery manifest.
- Five initial engine tests passed, covering authorization and sync boundaries rather than implementation snapshots.
- Protocol/contracts/auth/security drafts now exist in `docs/spec/`, with primary standards references and detailed email-link/recovery edge cases.
- Real dodo/ngin source snapshots are vendored with original MIT licenses and commit provenance. SDK discovery and custom login element plus stack-based consent/account UI are implemented.
- `docs/implementation.md` records prototype/spec differences explicitly; `AGENTS.md` preserves coordination and review expectations for future work.

### Integration verification

The initial HTTP test could not bind `127.0.0.1` because the sandbox returned `EPERM`. It was adapted to invoke the actual HTTP request callback with readable request streams and response doubles, exercising routing, Host/Origin controls, JSON validation, consent and RPC without a listening socket. This is useful adapter verification but does not establish real network/browser behavior. The runnable server remains available for use outside that sandbox.

Current automated suite passes core authorization/sync, HTTP adapter, and SDK discovery tests. Frontend DOM integration and malformed-manifest hardening are being completed; final results will be appended below. No claim of production conformance or completed identity service is made.

Final coordinator review found and fixed an authorization edge case: removing then restoring a preference resource could revive an old approval. Removing an assignment now permanently narrows existing grants; restoration requires renewed consent. The regression test covers this alongside new-resource expansion. Demo token lifetimes now match the draft five-minute ceiling. SDK metadata checks now reject version/issuer mismatches and delegated endpoints and bound response size/time.

Frontend DOM smoke passed real dodo/ngin rendering, empty-selection/unacknowledged-consent rejection, grant/revoke updates, and default/custom-host login behavior. This used an already installed local happy-dom, without dependency installation. The local dodo checkout's 0.0.9 API did not support current stack composition; the frontend agent corrected the vendor snapshot to the published 0.1.0 package already present in a sibling project. Provenance records that source accurately.

The current consent screen demonstrates one resource fragment, with a separate storage configuration action and optional decline even with no assigned storage. Configuration does not grant app access. The final DOM smoke additionally checks removal makes the request resource unavailable and that decline works without setup. It does **not** yet implement a general schema renderer, required-fragment setup wizard, atomic fields, or multi-fragment requests. These are mandatory next UX work; real-browser/accessibility and human usability validation remain pending.

Final checks: `npm test` passed **10 tests**; portable `npm run test:dom` passed using the already installed happy-dom via `BINDLE_DOM_MODULE_URL`. The repo declares the exact happy-dom development version for normal installation; no dependency installation was performed in this restricted session. DOM smoke files are preserved in `tests/browser/`. Prototype remains runnable via `npm run dev` on a host allowing loopback sockets. Production work is outstanding as detailed below and in `docs/implementation.md`.

### Pending milestones and completion gates

1. **Spec review and local demonstration:** finish protocol/auth/contracts/security drafts; demonstrate optional decline before configuration, explicit resource/method consent, existing app visibility, revocation, and login-handle behavior. Add realistic usability sessions with first-time users and accessibility/browser checks. Automated unit tests do not establish intuitive UX.
2. **Production identity service:** durable transactional account/email/session store; mail delivery and rate limits; opaque single-use token hashing; scanner-safe magic-link GET; explicit cross-account outcomes; WebAuthn registration/assertion verification, recovery and credential management; audit events. Test concurrency and takeover attempts.
3. **Federated relying-party flow:** registered clients/redirects, authorization transactions, code exchange, PKCE/state/issuer validation, token audience binding, expiration/revocation, safe discovery, and conformance tests with an independently hosted provider. Do not advertise interoperability before this passes.
4. **Persistent storage:** durable grants/preferences/deduplication; isolated app namespaces, quotas, data export/deletion, conditional writes; hosted storage adapter and two-device sync conflict tests. Current demo has account-wide selected-bucket access and no app namespace.
5. **Provider integrations:** Google Drive OAuth scopes/refresh handling, S3 signing/credential isolation, WebDAV capability checks; SSRF defenses and backend-specific consistency tests. Credentials stay provider-side. Provider contract declarations require tested behavior.
6. **Organization subjects:** memberships, scoped delegation, administrator consent, resource ownership transfer/recovery; explicit authorization design before implementation.
7. **Release:** choose protocol name and canonical domain, licensing for first-party code, dependency/version policy, security review, operational backups/restore, and deployment destination. Human approval records remain blank until actually signed.

### Evidence and limits

Node v24.6.0 is available. Initial external shell requests to stack.3sln.com and raw.githubusercontent.com failed DNS; browser access to the requested stack URLs failed. Local sibling projects provide stack source evidence. No secrets were fetched and no remote service was modified. Memory-only fixtures reset on restart. Public identifiers under `*.example` are examples and are not published contracts.

## 2026-10-11/12 — Release expansion: identity, contact capabilities, messaging, Workers

User expanded the actual-release scope to contact tokens, blob messaging, notifications, PWA, recovery, abuse defenses, cold storage, real provider integrations and Cloudflare deployment. User requested a dedicated UI red-team agent and a final screenshot walkthrough.

Coordinator delegated deep identity implementation/security review, contact/messaging/notification design and implementation, stack-based release UI, and dedicated adversarial browser work. Heavy messaging/security decisions use GPT-6 Astra with high reasoning; identity/UI engineering uses GPT-6.1 Sol with high reasoning, under the user's request for appropriate intelligence. Coordinator implements Worker bindings, storage integration, infrastructure and release workflow.

### Additional decision register

| ID | Decision / consequence | Human review |
| --- | --- | --- |
| D014 | Contact URLs use `/users/{handle}/message#token=...`, never HTTP URI userinfo. Fragment keeps the bearer out of server URL logs and referrers; API uses Authorization. GET never delivers a message or consumes a token. | Reviewer: ___ Date: ___ Outcome: ___ |
| D015 | Contact tokens are ES256/Ed25519 JWS signed by an entity-specific key and bound to exact live registered grants, collection/MIME/expiry/count/byte limits. Signatures alone do not bypass revocation or quotas. Hosted v0 signing keys are server-custodied and encrypted; user-controlled signing-key portability remains additional work. | Reviewer: ___ Date: ___ Outcome: ___ |
| D016 | Use collections for message grouping, with read status, owner moves/tags/classification, sticky quarantine and bounded declarative rules. Human content and automation blobs share transport but not automatic rendering. | Reviewer: ___ Date: ___ Outcome: ___ |
| D017 | Start with bounded JSON web archives containing HTML/assets; no filesystem extraction, recursive archives or remote fetches. Current renderer reconstructs inert structural HTML and strips all media/style; rich safe asset/data-URL rendering remains release work. | Reviewer: ___ Date: ___ Outcome: ___ |
| D018 | Notifications use transactional outbox and leased delivery; check current unread/quarantine/preferences again immediately before transport. Generic push text by default. Email requires verified destination and consent; unsubscribing invalidates already leased deliveries. | Reviewer: ___ Date: ___ Outcome: ___ |
| D019 | Free account activation requires terms, server-verified Turnstile, passkey or strong optional password, and downloaded recovery-file proof/ack. Recovery secrets/sessions are hashed, single use, and never persisted in browser storage. Pending setup token may live in sessionStorage for same-tab resume. | Reviewer: ___ Date: ___ Outcome: ___ |
| D020 | Cloudflare adapters use sqlite Durable Objects for identity/CAS, abuse windows and account metadata; R2 for message blobs and cold metadata snapshots. Services use ngin actions/queries plus injected runtime resources. No public demo mutation routes on Worker. | Reviewer: ___ Date: ___ Outcome: ___ |
| D021 | Initial identity directory is a serialized global registry for atomic handle/email claims, with bounded account envelopes; scaling/sharding and benchmarking are required before claiming low-cost high-scale readiness. | Reviewer: ___ Date: ___ Outcome: ___ |
| D022 | Seven-day cold-cache eviction is non-destructive and separate from user-requested inactivity/deletion schedules. Automatic permanent deletion remains disabled until notification, grace, activity and backup removal invariants are implemented; requested 2-day/7-day new-account and 1-year age-scaled policies are still release work. | Reviewer: ___ Date: ___ Outcome: ___ |
| D023 | Object storage descriptor publication authority is `https://3sln.me/artefacts/contracts/object-storage/v1`; negotiate read/write/list/range/presign capabilities rather than falsely claiming every backend's conditional writes. Presigned read URLs can remain usable until expiry after revocation; explicit separate permission needed. | Reviewer: ___ Date: ___ Outcome: ___ |
| D024 | Manual publish workflow with tests, dependency audit, real Wrangler/browser tests and machine-recorded release gates. Main pushes run CI; do not publish. | Reviewer: ___ Date: ___ Outcome: ___ |

### Implementation and environment evidence

- Real maintained SimpleWebAuthn verification, Argon2id policy, session/CSRF, mandatory recovery, email proof/link/login services are implemented with injected resources. Mail transport remains unconfigured.
- Contact signing/verification, live quotas/revocation, collection/message/read/move/tag/rules/quarantine, inert HTML/archive validation, notification preferences/leases/unsubscribe are implemented and tested.
- Worker adapter and `wrangler.jsonc` target 3sln.me with Durable Objects/R2 bindings; separate `wrangler.local.jsonc` explicitly enables test CAPTCHA behavior only locally. Production `RELEASE_READY=false` prevents public signup.
- `.mcp.json` configures pinned Chrome DevTools MCP with isolated headless Chrome and telemetry disabled. Installed browser tooling and real local Chrome work. Wrangler local execution is running on localhost:8787.
- Storia's manual publish/browser-gating workflow reviewed; corresponding gated workflow prepared.
- Dependency audit caught vulnerable original happy-dom test dependency. Updated to21.0.1; installation audit then reported zero vulnerabilities.
- Actual Worker passkey signup+verification reaches recovery. Real browser found auth DOM input-reuse failure; frontend agent correcting keyed/remounted fields. Password signup exposed Workers' prohibition on dynamic WASM compilation; platform adapter being corrected to statically imported Argon2 module. These findings prevent release claims.
- Security cross-review found archive race, non-atomic deletion/marker, missing method allowlists, JSON primitive handling, abuse alarm race and blob compensation gaps. Fixes and adapter tests in progress; see `docs/release/ui-redteam.md` and release gate file.

### Release state

`release-status.json` is intentionally false. Public provider keys, CAPTCHA production configuration, Cloudflare bot/WAF policy, mail/push transport verification, provider conformance, rich archive rendering, complete federated OAuth/preferences and account-lifecycle delivery/deletion gates remain unresolved. A polished screen is not evidence these features work. Screenshot walkthrough will present actual verified local behavior and these boundaries.

## 2026-10-12 — Cloudflare hosted email resource

User requested Cloudflare-native hosted email and dedicated verify/login/notify/accounts/security sender addresses. Replaced the unused Resend implementation with the structured Cloudflare Email Sending beta binding in `apps/worker/email.mjs`; `transports.mjs` re-exports it without changing the portable injectable identity/notification delivery interfaces. Isolating mail from the Node web-push imports preserves Worker test bundling.

| Decision | Consequence | Human review |
| --- | --- | --- |
| Hosted email policy (provisional) | Bind `EMAIL` with exactly five `allowed_sender_addresses`; `MAIL_ENABLED="false"` by default. Require explicit enablement, binding and canonical HTTPS origin. Provider acknowledgement is not idempotency or exactly-once delivery. | Reviewer: ___ Date: ___ Outcome: ___ |

Coordinator wired the resource into Worker identity mailer and exposes email availability only when configuration admits a transport. Association uses the actual identity `purpose='link'` and `/email/confirm` route; login uses `purpose='login'` and `/email/login`. Links retain fragment tokens, ten-minute expiry and explicit confirmation. Association additionally reminds users to confirm in their requesting browser session. Invalid recipients, control characters, substituted origins and unsupported purposes fail before binding calls; provider errors are replaced with a generic message and an allowlisted code, with no adapter logs or raw secret-bearing errors.

Unread reminders contain only generic text and manual fragment unsubscribe, with allowed `List-Unsubscribe` and no RFC8058 one-click claim. Finite account and security notice templates reserve their requested sender roles, but the hosted reminder dispatcher, lifecycle jobs and security event callers remain unconnected. Templates are currently English; locale selection/catalogue integration remain outstanding. Lifecycle deletion gates are unchanged. Stable retry payloads cannot prevent duplicate external sends after an ambiguous acknowledgement because the documented binding has no idempotency argument.

Verification: all eight new Cloudflare binding tests passed; `npm test` passed **109 tests**. Production Wrangler dry run succeeded and listed `EMAIL` with all five permitted senders and `MAIL_ENABLED="false"`; its first invocation reported an unwritable external log path, so a second dry run redirected logs into `.output/wrangler-email.log` and completed cleanly. Mock and bundle results do not establish deliverability.

[Email deployment instructions](docs/deployment/email.md) link official Workers API, binding restrictions, header policy and onboarding documentation. Email Sending domain onboarding supports the intended transactional-user mail; verified-destination-only Email Routing capability cannot establish public signup readiness. End-to-end delivery, suppression/bounce operations, template localization and release sign-off remain provisional.

## 2026-10-11 — Encrypted recovery-file design

User requested a recovery file encrypted under a key derived from all selected typed personal-information answers, with readable questions and optional hints. [Recovery-file v1 proposal](docs/spec/recovery-file.md) records the exact envelope, authenticated header, combined-answer encoding, normalization rules, browser/service boundary, and required evidence. This is a provisional design, not completed implementation or security approval.

| ID | Decision / consequence | Human review |
| --- | --- | --- |
| D025 | Encrypt the existing independently random recovery credential locally with one key derived from every selected answer; no signing keys or account credentials are derived from PII. Offer an additional private passphrase. Public questions/hints and offline guessing are explained explicitly. | Reviewer: ___ Date: ___ Outcome: ___ |
| D026 | Versioned bounded envelope: fixed Argon2id v19, 64 MiB, three iterations, one lane, random 16-byte salt; AES-256-GCM with independent random 12-byte IV and authenticated question/type/hint/profile metadata. Reject unknown/downgraded algorithms and oversized work before derivation; no weaker fallback. | Reviewer: ___ Date: ___ Outcome: ___ |
| D027 | Typed normalization preserves numeric leading zeros, explicit international phone country code, Gregorian year-first dates, and all selected answers. Text uses explicit whitespace rules and locale-independent lowercasing; exact NFC passphrases are separate. This does not claim full Unicode casefold or universal Unicode-version independence; conformance vectors and supported Unicode repertoire remain release evidence. | Reviewer: ___ Date: ___ Outcome: ___ |
| D028 | Keep answer processing in private browser state and preferably fresh recovery documents that never loaded third-party scripts; use a terminating first-party Argon2 worker and narrowly scoped WASM CSP permission. Same-document CAPTCHA scripts otherwise remain trusted with answers. Preserve existing random-token proof, pending-account confirmation and resumable recovery semantics. | Reviewer: ___ Date: ___ Outcome: ___ |

Design review examined the existing identity `downloadRecovery`, `confirmRecovery`, and `recover` methods, their replay/resume tests, browser asset build, and installed hash-wasm argument types. Primary references are linked in the proposal. Design-only work ran no implementation tests. Coordinator and implementation agents must reconcile any final module/schema/normalization differences here and in the proposal before reporting completion. Human sign-offs remain blank.

## 2026-10-11 — Portable runtime, device management, portal contributions and verified encrypted recovery

Current implementation supersedes the earlier prototype evidence above. The production release remains disabled; the following is verified local work, not a production sign-off.

| ID | Decision / consequence | Human review |
| --- | --- | --- |
| D029 | Hosted outbound mail uses Cloudflare `EMAIL.send`, explicitly gated by `MAIL_ENABLED`, with fixed sender roles (`verify`, `login`, `notify`, `accounts`, `security`) and a Wrangler sender allowlist. Self-hosted adapters use their operator's domain/brand. Provider acceptance is not inbox delivery or exactly-once delivery. | Reviewer: ___ Date: ___ Outcome: ___ |
| D030 | One portable Request/Response application, identity repository, account controller and abuse policy run behind Cloudflare Durable Object/R2 adapters and a single-process Node SQLite/private-files adapter. Runtime capabilities are injected; Node proxy trust and distributed operation require separate implementations. | Reviewer: ___ Date: ___ Outcome: ___ |
| D031 | Contact invitations are signed endpoint URLs, replacing the earlier token/URL duality. HTML GET provides a host composer; explicit token MIME GET mints a separate short-lived bearer; multipart POST sends a bounded blob. Live parent revocation/quarantine/scopes/quotas apply to both delivery paths. Sender annotations remain separate from owner classification. | Reviewer: ___ Date: ___ Outcome: ___ |
| D032 | Multiple passkeys and revocable device sessions share the account authority. Phone-to-TV/device sign-in uses a short-lived request, human confirmation and one-time poll-secret handoff; a QR carries an approval reference, never an owner session. | Reviewer: ___ Date: ___ Outcome: ___ |
| D033 | Portal contributions are statically installed code with deterministic manifests and capability-gated commands; UI receives pure view data. Contextual keybindings and user overrides have a bounded declarative parser. Localization uses actual MIT-licensed `@3sln/bab` source; user content is not translated. | Reviewer: ___ Date: ___ Outcome: ___ |
| D034 | All portal form values are captured into a private browser submission vault; ngin Actions receive opaque operation IDs. Recovery answers/credentials never enter Query projections, preferences, URL parameters or application logs. Fresh recovery documents load no third-party scripts; this is not a sandbox against an already compromised origin. | Reviewer: ___ Date: ___ Outcome: ___ |

### Verified behavior

- Worker and Node use maintained WebAuthn verification and Argon2id implementations. Static WASM imports address Workers' dynamic-compilation prohibition. Signup remains pending until a recovery credential is acknowledged; recent authorization and exact-origin CSRF guard credential/device changes. Interrupted recovery can resume with the original file until replacement setup is confirmed. Verified email is a contact channel until the owner explicitly opts into email login.
- Account operations and cold shelving are serialized through the same account gate. Snapshot readback/hash/owner/version validation precedes atomic metadata eviction. Message payloads are immutable private objects; metadata changes no longer read or rewrite those payloads. The retention/deletion scheduler is still incomplete and disabled.
- Static portal modules, Publications sample CRUD, bab English/Spanish catalogs, context-sensitive commands, chords and shortcut overrides are implemented. The Publications sample is opt-in code, not a publicly deployed feature.
- Encrypted recovery now has one to twelve editable/reorderable questions, typed normalization, public optional hints, a recommended private passphrase, local encryption and a mandatory answer round-trip before account activation. A hint matching its full raw or normalized answer is rejected at setup. Every answer participates; no alternate weaker key slot exists. The downloaded file has only public question metadata and ciphertext, containing the independently random server recovery credential inside.
- A dedicated terminating browser worker derives the fixed 64 MiB/three-pass Argon2id key. Recovery documents and this worker use narrowly scoped `wasm-unsafe-eval`; third-party scripts/frames are excluded. CAPTCHA runs before the fresh restore document; only its short-lived challenge is handed through tab storage, never answers or recovery credentials. The round-trip checks the in-memory encrypted envelope and does not prove a durable filesystem write.
- Cloudflare mail is wired to identity association/opt-in login but disabled by default. Reminder, lifecycle and security template resources exist; their hosted event scheduling/delivery is not yet wired. Node embedders can inject a mail resource. Email templates still need locale integration and live delivery verification.

### Evidence and remaining work

`npm test` passed 124 tests after the encrypted-core/hint changes; Worker integration passed 16 tests; portal Action/Query state checks passed 3 tests; DOM smoke passed. A fresh isolated Wrangler instance passed all 5 real Chrome suites/cases: Node/browser cryptography plus archived seven-type vector, hostile-metadata/wrong-answer/wrong-issuer privacy audit, repeated-submit/navigation cancellation, full passkey setup/assertion, and full password resume/recovery/rotation/contact delivery. CI now includes state and encrypted-browser checks. Browser runner uses a fresh temporary data store and unused port, and redacts signed invitation query material from its saved log.

Independent [recovery security audit](docs/release/recovery-security-audit.md) found no unresolved critical/high defect demonstrated in its scope. This is not a broad release certification. [Recovery-file specification](docs/spec/recovery-file.md) and archived vectors document the exact format, Unicode limitations, offline-guessing risk and implementation boundary. No answer-derived encryption can make public/guessable PII a strong secret. Low-memory mobile performance, live production CAPTCHA, real email delivery and human approval remain unverified.

Production deployment is still blocked by actual release work recorded in `release-status.json`: complete federation/preferences integration and interoperability, provider OAuth keys/flows/conformance, rich HTML/archive asset rendering, hosted push/email dispatch and localization, requested lifecycle notices/grace/deletion, production bot controls, data/record garbage collection and cost/load verification, resolved independent audit findings, and terms/privacy review. Do not enable `RELEASE_READY` based only on the local UI tests. R2 buckets are `3sln-me-blobs` and `3sln-me-account-archives`.

| D035 | First-party implementation and documentation use the repository MIT license to permit reuse/self-hosting. Upstream 3sln stack, bab and maintained cryptography sources retain their own MIT notices/provenance. Human confirmation of the release's licensing/publication policy remains unsigned. | Reviewer: ___ Date: ___ Outcome: ___ |

Final screenshot walkthrough: [standalone HTML](docs/walkthrough.html) and [Markdown](docs/walkthrough.md), with reviewed local test screenshots under `docs/walkthrough-assets/`. Recovery images contain readable public metadata and masked/empty inputs, never live answer material or credentials. Current landing, resource, notification and security screens make unavailable capabilities visible. English/Spanish recovery UI entries were added through bab catalogs; user prompts/hints stay unchanged. Narrow-phone/reorder/Spanish-restore verification passed with zero browser runtime errors. The production-config bundle dry run still succeeds with mail and release flags disabled.

Final combined browser rerun after recovery spacing/cancellation/localization changes: **6/6 passed** in a clean temporary Wrangler runtime, including question reorder/mobile/Spanish metadata preservation. The walkthrough's eleven account/recovery screenshots were refreshed from this exact run. The runner no longer streams full Worker request logs to the console and redacts signed query capabilities in the saved diagnostic log.

Final CI browser group includes the repaired signed-endpoint composer fixture and eleven UI fault cases. **17/17 passed** in a fresh isolated runtime after dialog focus/keybinding hardening and the separate notification-email capability flag. Enabling identity verification mail cannot advertise reminder delivery while its dispatcher is unwired. Walkthrough screenshots were refreshed from this final run. Human sign-offs and all production release gates remain unchanged.

## 2026-10-11 — Dedicated system-email sender subdomain

User changed the hosted sender domain to `sys.3sln.com`, reserving bare-domain addresses for potential user mail. This supersedes the earlier `@3sln.me` sender examples without rewriting their historical evidence. Hosted Wrangler now explicitly sets `MAIL_SENDER_DOMAIN="sys.3sln.com"` and permits only `verify`, `login`, `notify`, `accounts` and `security` at that domain. Self-hosted defaults remain operator-controlled; account/verification/unsubscribe links remain on the identity app origin. Setup docs now name the sending subdomain and parent DNS zone.

| D036 | Use `sys.3sln.com` for hosted system senders, keeping bare domains available for user email. Direction explicitly requested by user; configuration verification remains separate from deliverability. | Reviewer: ___ Date: ___ Outcome: ___ |

Verification: all nine focused email adapter/configuration tests passed, including host-origin links with a separate sender domain. Production Wrangler dry run passed with the five `@sys.3sln.com` senders and `MAIL_ENABLED="false"`.


## 2026-10-11 — Corrected system sender domain

User corrected the intended/onboarded sender subdomain to `sys.3sln.me`. This supersedes D036's `sys.3sln.com` address choice; historical test results above remain unchanged. Hosted sender configuration, allowlist, tests and deployment instructions now use `verify`, `login`, `notify`, `accounts` and `security` at `sys.3sln.me`. Account URLs still use `3sln.me`.



## 2026-10-11 — Shared storage plans, billing and search groundwork

User revised the free plan to **500 MB** and requested visible metering. Implemented decimal-byte plan definitions: free 500,000,000 bytes, Plus 5 GB at $5/year, Pro 100 GB at $30/year. The portal shows used, reserved and remaining space, messages/files breakdown, localized annual prices and clear over-limit behavior. Reading, exporting and deleting remain available after a downgrade; positive storage growth is refused. External provider storage does not count as hosted bytes.

| Decision | Direction and current limits | Human sign-off |
| --- | --- | --- |
| D037 | Use the requested annual plans and decimal byte limits. Pricing remains provisional: full Pro payload storage alone is approximately $18/year before billing fees, indexing, operations and support. See [scaling analysis](docs/architecture/scaling.md). | Reviewer: ___ Date: ___ Outcome: ___ |
| D038 | Enforce one account-owned quota across message payloads and hosted files. Durable reservations precede blob uploads; final metadata commits recheck entitlement and expiry. Bounded cleanup retries abandoned uploads. | Reviewer: ___ Date: ___ Outcome: ___ |
| D039 | Keep payloads in R2 and use account-local SQLite indexes for bounded inbox/file pages. Large accounts retain indexed SQLite metadata until a paged cold-archive format is implemented; the old bounded whole-account archive is not a large-account scaling solution. | Reviewer: ___ Date: ___ Outcome: ___ |
| D040 | Polar checkout never grants capacity. Authenticated, replay-protected webhook processing reconciles authoritative provider state, validates configured annual products and applies deadline-bound entitlements. Billing remains disabled with credential/product placeholders. | Reviewer: ___ Date: ___ Outcome: ___ |
| D041 | Search is a derived, owner-isolated FTS index with revisioned durable events, source authorization on every result, tag filters, bounded candidates and semantic provider ports. Query execution reads no payload blobs. Semantic provider deployment, relevance validation and broader source adapters remain pending. | Reviewer: ___ Date: ___ Outcome: ___ |
| D042 | Identity-directory sharding, paged cold metadata, production load/cost benchmarks and complete source-index erasure must precede a large-scale release claim. The current global identity directory and account deletion remain release gates. | Reviewer: ___ Date: ___ Outcome: ___ |

Independent agents reviewed architecture/economics, billing and quota behavior, search source authorization and UI failure states. Fixed post-commit HTTP errors caused by the execution-context variable, stale derived catalogs being treated as source authority, and cold-account queue processing incorrectly producing tombstones. Bounded migration now queues existing valid messages. Metadata edits enqueue work without fetching message bodies; alarms process extraction separately. Runtime mutation queues enforce free/paid queue budgets; legacy backfill obeys the plan queue bound while reserving capacity for new items, and advances independently of catalog migration on alarms. A full queue rejects the source mutation rather than silently omitting search work; this backpressure policy remains provisional. Search currently integrates message sources; hosted-file and arbitrary module source indexing need adapters. Content extraction and indexing have explicit bounds and are not a claim that every byte or unsupported message format is searchable.

Credentials, product IDs and provider catalog verification remain operator setup work. See [billing setup](docs/deployment/billing.md), [search specification](docs/spec/omni-search.md), [scaling review](docs/release/scaling-review.md) and [independent storage audit](docs/release/storage-billing-audit.md).

Verification after reconciliation: `npm test`176/176, actual Worker integration16/16, UI state7/7, DOM smoke, Chrome21/21 and production Worker dry run passed. New screenshots were visually reviewed and added to [walkthrough](docs/walkthrough.md), explicitly labeled as API-fault-injection fixtures for billing/search. The PWA shell caches the new public modules and offline tests confirm private account responses remain uncached. No production readiness is claimed.

## 2026-10-12 — Provisioned semantic search, sharded identity and spend controls

User requested a cheap Workers AI embedder, real Vectorize resources, a financial model, severe account admission limits, and removal of shared hot-path resources. Semantic search uses Cloudflare Vectorize indexes `bindle-search-bge-small-v1` and `-s1`, `-s2`, `-s3`: 384-dimensional cosine indexes for the fixed English `@cf/baai/bge-small-en-v1.5` model. Hosted Wrangler binds all four plus `AI`; local defaults do not call paid providers.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D043 | Explicit owner opt-in for remote English semantic processing. Embed only the first 480 UTF-8 bytes; bounded document/query attempts and conservative spend reservations; lexical indexing survives semantic failure. The current 1,000 upsert ceiling is lifetime attempts, not a recyclable active-vector allowance. | Reviewer: ___ Date: ___ Outcome: ___ |
| D044 | Four fixed account-routed Vectorize shards, no query fan-out; sixteen budget partitions with exact aggregate ceilings and durable prepaid leases. Preserve routing and all outstanding/spent obligations during any later migration; reject silent remaps. | Reviewer: ___ Date: ___ Outcome: ___ |
| D045 | Five independent 64-bucket identity lookup families remove the global directory from ordinary authentication/session updates. Recoverable, token-checked cross-shard uniqueness claims. Explicit fresh-layout gate; no automatic legacy migration. See [identity review](docs/architecture/identity-sharding.md). | Reviewer: ___ Date: ___ Outcome: ___ |
| D046 | Valid CAPTCHA/terms/complete signup must pass IP, subnet, country-region and global windows. Defaults: one per IP/three hours, two/IP/day, fifteen/subnet/day, five/country/hour, twenty-five/country/day, ten/global/hour and two hundred/global/day. A durable 1,000-new-admission rollout ceiling prevents admission growth forever under daily limits; this is not a count of existing accounts. Country comes from trusted Cloudflare metadata, never a client-supplied country header. Unknown regions share a restrictive fallback. Local test configuration explicitly relaxes IP cooldown. | Reviewer: ___ Date: ___ Outcome: ___ |
| D047 | The $5/month/$0.50/day semantic operation ledger is not a provider invoice cap. Recurring stock charges, R2, SQL, ingress, cleanup, support and payment risk remain liabilities. [Cost model](docs/architecture/unit-economics.md) and [calculator](scripts/cost-model.mjs) separate global allowances from per-user marginal cost and model full/heavy use. Requested operator cash-budget preference; provisional guards do not authorize deployment. | Reviewer: ___ Date: ___ Outcome: ___ |

Independent source audits found and resolved corrupt-accounting admission, a lease refill race that resurrected spent credit, and a healthy concurrent identity operation that falsely reported conflict after committing. Global allocations commit before external operations, expired/ambiguous leases receive no refunds, and exact-version routing is persisted. Uneven partitions and unused daily leases can pause service early; no automatic borrowing or budget reset exists. Admission counters are application work controls, not a guarantee that incoming denial-of-wallet traffic cannot generate provider charges. Identity maintenance, metadata retention/purge, physical-byte overhead and production load verification remain explicit release work.

Verification before the subsequent beaming work: full core/Node suite213/213; actual Worker security/contact suite16/16; rebuilt Chrome suite22/22, including semantic consent, mode selection and revocation states using labeled API fixtures. These are local results.

## 2026-10-12 — Device names and paid WebRTC beaming in progress

User requested customizable device names, self-device and contact file transfers, multi-file selective acceptance, sender- or receiver-created QR/NFC invitations, and streaming downloads. Nearby QR/NFC pairing requires no prior contact; remote contact delivery needs an explicit beam grant, not generic messaging access. Remote offers notify all eligible recipient devices, with an atomic first-accept claim choosing exactly one device. Self transfers can target a named signed-in device. Contact metadata disclosure is owner-controlled.

Design, backend and browser agents have distinct ownership and are coordinating request/transport contracts. Direct WebRTC data channels avoid hosted payload copies; browser streaming and bounded fallback are under implementation. Cloudflare TURN documentation exposes short-lived credential issuance and per-allocation approximate limits, but no documented enforceable per-tenant byte cap. A declared file size or an application reservation cannot constrain a malicious holder's TURN traffic; relay must remain disabled unless actual enforcement is available. Paid status alone is not sufficient protection against relay costs. Push notification delivery remains a separate unverified gate; an in-portal offer notification is not proof of push delivery.

| D048 | Explicit, single-recipient acceptance of authenticated file manifests; grant-scoped remote contact offers and one-use nearby invitations. Streaming bounded chunks, cancellation and integrity checks; real TURN port prepared with an enforceable-cost gate. Design/implementation/review ongoing, not release-ready. | Reviewer: ___ Date: ___ Outcome: ___ |

Root hot-path follow-up: repeated authenticated reads no longer rewrite account owner metadata or activity within fifteen minutes, and warm reads cannot postpone an earlier pending alarm. A native SQLite regression verifies zero repeated activity writes and preserved schedule. The beaming poll scenario and its higher request count are now called out in the economics document; the earlier typical activity inputs are not measured portal usage.


## 2026-10-12 — Work admission, MCP OAuth and conversations

The reconciled runtime suite passed 247/247 before the new MCP/conversation additions. This includes independent concurrency, spend, cleanup and beaming security regressions. Cleanup now backs off after failures and pauses after eight attempts while retaining outstanding ownership; it does not discard data or release uncertain reservations. Native Node alarms claim their scheduled record before executing so a handler can reliably schedule future work.

| Decision | Direction and current limits | Human sign-off |
| --- | --- | --- |
| D049 | Provisional monthly covered-change limits: free 1,000, Plus 5,000, Pro 10,000; service 250,000, allocated through sixteen fixed partitions and durable prepaid leases. Expose usage/reset in the portal. Preserve reads, export, deletion, revocation, privacy disablement and billing upgrades. These counters do not cap every billable request or the provider invoice. | Reviewer: ___ Date: ___ Outcome: ___ |
| D050 | Separate HTTP MCP service and OAuth authority outside Bindle. Explicit collection/action consent, PKCE, audience-bound tokens, live source checks and revocation. Sixty-four fixed authorization shards avoid centralized token introspection. Registered clients only initially; no uncontrolled dynamic registration or remote metadata fetching. Implementation and independent audit pending. | Reviewer: ___ Date: ___ Outcome: ___ |
| D051 | Sender-generated shared conversation secret permits default bearer replies; unequal per-member rights require independent identity proof and signed membership records. A creator coordinator serializes changes; removal rotates the secret for retained members. Initial secret disclosure grants pending invitees bearer authority. Contact revocation does not retrospectively revoke an independent conversation. | Reviewer: ___ Date: ___ Outcome: ___ |
| D052 | Persist all-recipient delivery obligations and show partial/failure states. Local text conversations are the first implementation subset; cross-host interoperability, membership convergence, abuse budgets and full conformance remain release gates. | Reviewer: ___ Date: ___ Outcome: ___ |

Federated mutation journals need a separate admission review before enabling that currently unconfigured surface; read RPCs already avoid outcome journals and payload copies. Ingress, exempt reads, beaming signaling and provider storage liabilities remain outside the covered-change counter. No production deployment or release readiness is claimed.


## 2026-10-12 — App resources and agent adapters: comparative design

User asked for a backed comparison of contributed resources, apps as resources, and importing existing MCP endpoints. Independent high-intelligence review recommends a provisional **apps-as-resources plus optional MCP adapter** direction. See [three-option analysis](docs/architecture/app-resource-options.md) and [independent audit](docs/release/resource-contributions-audit.md). This supersedes a universal one-resource-per-callable assumption in the first draft. Apps may still contribute genuine domain resources; native host modules and direct existing resource methods remain valid without MCP.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D053 | App state uses whichever resources/contracts the app already has permission to access, app-owned state, or both. Files are one example, not a constraint. Add no separate app-state subsystem. | Reviewer: ___ Date: ___ Outcome: ___ |
| D054 | One owner-specific app connection resource may expose individually granted methods in a pinned generated contract. An MCP importer maps exact upstream tools to safe method IDs and immutable schemas. Reuse existing preference/resource/contract/method grants; a generic tools-call tunnel would bypass that granularity. | Reviewer: ___ Date: ___ Outcome: ___ |
| D055 | Automatic MCP compatibility establishes adapter interoperability only. Unknown tools, changed schemas/revisions, producer disconnect and dependencies require live checks and appropriate owner review. It establishes neither calendar/storage semantic compliance nor permission. Remote code semantics cannot be attested merely by pinning metadata. | Reviewer: ___ Date: ___ Outcome: ___ |
| D056 | Optional stateless/stateful callbacks require a separately authenticated endpoint and a short-lived provider-audience token intersecting approved dependencies and operation budgets. Parent completion closes redemption and reconciles required dependent effects; expiry never manufactures successful writes. This callback adapter remains design work, not implemented capability. | Reviewer: ___ Date: ___ Outcome: ___ |

The separately implemented 3sln HTTP MCP service remains outside Bindle. The portable app/resource adapter and generated contract projection are the Bindle-facing design. No upstream adapter, contribution registry or webhook delegation implementation is claimed yet.


## 2026-10-12 — Reconciled local implementation checkpoint

MCP now has separate 64-shard OAuth authorization, exact collection/function consent, hashed durable credentials, S256 PKCE, audience checks, rotating refresh tokens with reuse-family revocation, and official SDK HTTP tools/resources/prompts. OAuth request admission and bounded cleanup fail closed. Empty operator-reviewed client configuration permits no production authorization flow. Independent review fixed malformed expiry acceptance and avoided holding shard transactions across account/provider work. Revocation stops newly admitted operations; already admitted work may finish. See [MCP audit](docs/release/mcp-audit.md).

Conversations now have encrypted private shared capabilities, independently signed source/membership records, explicit initial invitation MIME and admission, bearer-default replies, per-member restrictions, epoch rotation, threads, bounded durable all-member fanout and honest per-recipient status. Invalid authority/schema/replay requests do not burn normal acceptance work. Source acceptance and recipient inbox copies are separate covered effects; protective restrictions/removal remain available at exhaustion. Independent review fixed source-key and capability-hash binding, cross-conversation message-ID collisions, historical snapshot delivery, and atomic inbox semantic fingerprint receipts across a crash. See [conversation audit](docs/release/conversations-audit.md). General cross-provider discovery/transport/conformance remains gated.

The real Worker conversation check exposed a runtime-specific public-JWK export difference that Node fixtures did not show; explicit public-field construction fixed it. The actual Worker test now verifies signed service creation, bearer delivery, secret-free human inbox rendering and rejection of forged administrator rights. A separate real two-Node-server loopback test verified HTTP peer posting and delivery; neither establishes unrestricted production federation or DNS-rebinding safety.

Independent UI review fixed callback query substitution, stale same-owner thread selection, source-qualified permission/draft identities, non-JSON 401 handling, private state clearing, offline mutation busy state and out-of-order reconnect owner replacement. Real Chrome caught an invalid compound class token that Happy DOM accepted. Consent now renders with no checked defaults, separate destructive warnings and clear deny controls. Reviewed fresh screenshots and updated [walkthrough](docs/walkthrough.md); mocked API records are labeled explicitly. Screenshots normalize document scroll so sticky navigation is captured consistently.

Final evidence: **274/274 runtime tests**, **18/18 actual Worker tests**, **33/33 UI state/audit tests**, **27/27 Chrome browser checks**, plus a focused 5/5 screenshot/layout refresh. Production Worker dry run passed; no application deployment occurred. Synthetic provider vectors were removed from all four shards. TURN relay, billing, full notifications, provider OAuth credentials, general federation, large-account lifecycle and the new upstream app/MCP contribution adapter remain release work. No human approval or release readiness is fabricated.


## 2026-10-12 — User approval: app connection resources and management

User explicitly approved the app-connection-as-resource direction: “app connections as their own resources makes the most sense for me as well,” and requested a place to track and remove/dissociate connected apps. This records approval of D054's resource model only; it does not imply approval of every importer, generated-contract or callback detail in D054–D056. Those implementation/security details retain their separate review places.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D057 | Track owner-specific app connection resources in Connected apps. Disconnect stops new authorized calls and token refresh for the connection; revoking one agent grant remains a narrower operation. Preserve user-owned data and disconnected history. Fresh explicit consent can reconnect, with a new generation so old credentials cannot regain access. | Resource model approved by user in conversation, 2026-10-12. Lifecycle details: Reviewer ___ / Date ___ / Outcome ___ |

Backend, frontend and independent security agents are implementing/reviewing durable connection ownership, live generation checks and localized management UI. The existing MCP consent is the first implemented connection source; general Bindle login/import adapters remain separate release work.


## 2026-10-12 — App manifest presentation and discovery

User requested app names/icons and other presentation from Bindle manifests, linked PWA manifests, or discovered manifest links in provided app index/auth pages. Added optional Bindle `application` metadata using web app presentation fields plus `web_manifest`, operator-reviewed source URLs, inert bounded parsing and once-per-reviewed-request snapshots. Registered app identity stays visible; presentation does not confer trust or authority.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D058 | Prefer explicit registered overrides, then Bindle app presentation, then linked/discovered web app manifests. Discovery is bounded and credential-free; missing/unsupported metadata falls back without blocking consent or owner disconnection. | Reviewer ___ / Date ___ / Outcome ___ |
| D059 | Node may opt into a DNS-pinned HTTPS/443 discovery adapter with public IPv4 enforcement and process-local budgets. Cloudflare discovery remains disabled without equivalent verified actual-destination enforcement. Store raster icon references but use safe initials until a bounded raster cache is implemented; never auto-fetch external icons in account/consent views. | Reviewer ___ / Date ___ / Outcome ___ |

Independent architecture/runtime/UI reviews cover revocation generations, pending consent, private-data boundaries, metadata SSRF, inert HTML, credential isolation and graceful partial failures. User approval of the resource model is recorded under D057; these new networking/presentation choices retain separate review points.


Implementation reconciliation: durable app connections now use the existing owner `resource/*` catalog, canonical resource URLs, authenticated client provenance and generation-bound MCP grants. GET `/api/apps` and CSRF-protected DELETE `/api/apps/:id` provide owner management. Disconnect is local and immediate, with no 64-shard revocation fanout; new access/refresh/code admission and final account dispatch recheck the connection. Fresh inspected consent reconnects at a newer generation. Records are bounded and retained as revocation tombstones; owner data and unrelated storage resources are preserved. Upstream tool import and the Bindle grant bridge remain separate work; empty contracts do not claim conformance.

Presentation is pinned during consent inspection. Bounded single-flight collection runs outside authority transactions, with declared metadata available on both platforms. Optional Node discovery is wired behind `APP_METADATA_DISCOVERY_ENABLED=true`, uses only public IPv4 HTTPS/443 and actual-dial DNS pinning, and passed a real MDN index-to-manifest read-only check. No credentials or icon bytes were fetched. Cloudflare external discovery remains disabled; remote icons remain references until a safe raster cache exists. Node quotas are process-local, not an invoice cap.

Final checks for this change: **308/308 runtime tests**, **18/18 actual Worker tests** (including connected-app listing/disconnect/data preservation), **40/40 UI state/audit checks**, **28/28 full Chrome checks**. A subsequent **12/12 focused Chrome check** verified card readability, the v9 public-shell cache and private-cache/session regressions after final polish. Worker deployment dry run passed. Updated screenshot walkthrough uses labeled fixtures. User resource-model approval is recorded; no production readiness or application deployment is claimed.


## 2026-10-12 — Shared callable foundation, browser automation and user commands

User asked for browser automation integration and whether connected apps should contribute portable user commands. Independent architecture and security agents recommend existing resource/contract/method operations as the common foundation, with human UI, HTTP MCP and browser WebMCP as adapters. The recommendation and command profile are recorded in [callables and user commands](docs/architecture/callables-and-user-commands.md), [browser architecture](docs/architecture/browser-automation.md) and [contribution specification](docs/spec/resource-contributions.md).

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D060 | Keep callable business operations independent of MCP and host presentation. Optional declarative user-command metadata requests presentation in a palette, menu, button or supported typed form; do not automatically expose every low-level tool as a human command. | Reviewer ___ / Date ___ / Outcome ___ |
| D061 | Share schemas, validation and business dispatch while retaining separate authenticated owner, OAuth assistant and explicitly enabled browser-session authority. A human confirmation cannot elevate an assistant request or confer persistent automation access. | Reviewer ___ / Date ___ / Outcome ___ |
| D062 | Start native browser automation with the portal's own five collection/item operations, exact session-scoped collection/function grants, trusted mutation review, generation-bound connection checks and abort cleanup. Browser callback metadata establishes no authenticated assistant identity. Cooperative third-party frames, upstream imports and closed-browser execution remain separate work. | Reviewer ___ / Date ___ / Outcome ___ |

Implemented a shared five-operation catalog and explicit Automation hub with English/Spanish strings. Browser grants require deliberate selection, expire with the owner session and retain one-use, argument-bound mutation receipts. Independent audits cover immutable arguments, stale registration, cancellation, malformed grant/receipt records, revocation and caller separation. Unsupported browsers keep HTTP MCP and connected-app management reachable. No arbitrary app command renderer or generic contribution registry is claimed as implemented; that proposed layer will reuse existing grants rather than invent app state or a second permission plane. Production remains gated.

Verification checkpoint: **333/333 runtime tests**, **43/43 UI state/audit checks**, **20/20 actual Worker tests**, and **31/31 full Chrome checks** passed, including one real native WebMCP test against local Wrangler (experimental Chrome flags; no modelContext/owner API mocks). Worker deployment dry run passed. Native discovery, filtered listing, trusted confirmed hosted-file write, byte readback and disable/revocation were verified. An earlier overlapping browser-run attempt overwrote the shared generated test configuration; sequential rerunning removed that test interference and passed. Screenshot review identified raw arguments dominating confirmation; readable operation summaries are receiving targeted polish before the final screenshot checkpoint.

Final polish checkpoint: readable mutation review now shows the operation, collection, file/message identifier, conditional-write semantics, decoded byte size and a bounded inert plain-text preview; exact immutable arguments stay available in collapsed details. EN/ES review labels and metadata summaries are localized. **43/43 UI checks** passed again, followed by **14/14 focused Chrome checks** covering native WebMCP, fixture/unsupported flows and session/cache adversarial behavior. Updated the [screenshot walkthrough](docs/walkthrough.md) with actual native desktop/review images and a labeled mobile fixture. Browser runner now uses a per-run generated configuration/secrets directory to prevent the observed overlap interference. These are local checks; no production application deployment occurred.


## 2026-10-12 — User approval: callable commands and storage without enumeration

User approved the shared callable direction ("Sounds like the right path, let's do it") and explicitly requested that the common Drive/S3/WebDAV object-storage interface omit listing. This records approval of D060–D061's direction, not every future importer, schema or grant-bridge detail. Existing sign-off spaces retain their implementation-review purpose.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D063 | No public object-storage listing method, permission or capability. Apps retain a known bootstrap key/reference and maintain bounded directory/index objects. Inbox collection listing is separate. Conditional index updates are mandatory where writes are advertised; index/object updates are distinct effects with crash/orphan reconciliation and directory backup requirements. | No-list direction approved by user, 2026-10-12. Detailed semantics: Reviewer ___ / Date ___ / Outcome ___ |
| D064 | Implement the first optional host-neutral user-command projection over pinned callable methods. Trusted host adapters preserve the original immutable caller and use the existing dispatch/grants/journal; bounded inert metadata supplies presentation only. General upstream import and the production authority bridge remain distinct work. | Callable direction approved by user, 2026-10-12. Adapter review: Reviewer ___ / Date ___ / Outcome ___ |

Removed listing from the unpublished object-storage v1 draft artefact, capability descriptions, runtime gateway and demo. Stale stored listing capabilities cannot expose storage `items_list` through MCP/browser access; inbox tools retain their own listing support. MCP tool discovery now intersects exact grants with live source capabilities. External connector verification requires a known small file key and performs an exact read, with no enumeration fallback; UI closes on success, retains failures for retry and excludes hosted resources from external credential verification.

Independent storage review documents provider-ID/bootstrap and atomicity limitations. Google Drive currently has a defensive direct-child read adapter using existing file IDs and internal native enumeration helpers, with mocked provider checks. It has **no completed OAuth onboarding/refresh, write/delete support, logical-key mapping, persisted directory-root workflow or real-account verification**. The portal therefore keeps it unavailable; it is not yet an end-to-end Drive sync integration. See [storage contract and directory model](docs/spec/storage.md).

The first callable adapter and actual federation fixtures are implemented. Independent audit reproduced and fixed mutable nested caller credentials during asynchronous confirmation. Host-neutral invocation and existing portal contributions share dispatch without granting assistant requests owner authority; 17/17 implementation/independent command checks pass. Arbitrary external app installation, generalized renderer and upstream importer are not claimed complete. See [implementation reconciliation](docs/architecture/callables-and-user-commands.md).

Final checks: **356/356 runtime tests**, **43/43 UI state/audit checks**, **20/20 actual Worker checks**, and Worker dry run passed. The existing **31 Chrome checks** passed with the new contract; the added known-file verification check initially needed waits/scoped selectors for asynchronous rendering and duplicate background/dialog alerts, then passed independently. A subsequent focused run passed all **12 native/session/cache checks**, and the corrected verification fixture passed **1/1**, exercising exact key submission, failed-read retry, success close and hosted-button exclusion. No application deployment or production provider conformance is claimed.


## 2026-10-12 — Canonical branding and managed Google Drive

User requested the organization logo from `../.github`; the local checkout is `../dotgithub` (repository `3sln/.github`, revision `458ad44a83a9f4b54136c96ca74122cabd99be8b`). Copied canonical mark, outlined light/dark wordmarks and 512px avatar unchanged. Used the wordmark in the portal, mark/PNG for favicon/PWA/apple touch, and exact PNG as a Cloudflare email CID attachment with escaped HTML and unchanged plaintext. Inbox-provider sender avatar/BIMI certification remains separate; see [branding setup](docs/deployment/branding.md). Generic self-hosted branding is retained.

Portable OAuth/PKCE, encrypted owner/session-bound one-use state, refresh, dedicated folders, stable logical keys, immutable uploads, durable generated-ID journals, digest/membership checks, logical deletion and mapping-preserving same-account reconnect are implemented and wired through Account, Worker/Node APIs and localized portal flows. [Deployment setup](docs/deployment/google-drive.md), [independent architecture/security review](docs/architecture/google-drive-integration.md).

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D065 | Managed Drive writes use immutable provider files and atomic host-owned key-map publication; this is conditionalAuthority=bindle-host, not upstream Drive CAS. Retain old/deleted physical files and ambiguous-operation IDs with explicit bounds/disclosure. Preserve root/map on same-principal reconnect. Disconnect removes local credentials; project-wide Google revocation remains an explicit Google Account action because it affects other clients. | Reviewer ___ / Date ___ / Outcome ___ |
| D067 | Optional resource-scoping metadata describes enforceable controls. Store selected resource + scope privately in the shared preference field; all consumers share this field scope. Project only a resolved scoped resource reference and consumer-specific token with appropriate grants. An owner save reviews exact currently effective consumers/effects; no per-app scope UI or raw parent credentials are introduced. | Field-value/reference/token model explicitly clarified by user, 2026-10-12. Contract/lifecycle details: Reviewer ___ / Date ___ / Outcome ___ |

Independent Drive review fixed late refresh/disconnect resurrection, stale refresh responses, ciphertext transplantation, moved/changed downloads, malformed responses and reconnect publication races. Durable gateway verification caught ranged metadata reporting partial rather than full object size and corrected it. OAuth callback moves bounded data into a private fragment then clears history before rendering; code never enters the Query model. Known-file verification preserves newly refreshed credentials. Tests distinguish fixtures from real Worker boundaries and provider conformance.

The scoped-field model is specified in [resource-scoping.md](docs/architecture/resource-scoping.md) and linked from the preference projection contract. It is proposed protocol/editor work, not a completed general scoping implementation. Independent review clarified effective exact-field authorization and child-relative output sanitization.

Predeployment review found an actual public-cost path: invalid unsubscribe requests could allocate arbitrary Account Durable Objects. Added active-identity checking before dispatch and an independent no-allocation regression. Secret-free production bootstrap tests verify signup503, demo404, unavailable federation manifest/MCP and disabled Google.

Verification: **396/396 runtime tests**, **52/52 UI checks**, **25/25 actual Worker checks**, **36/36 full Chrome checks**, followed by **16/16 focused branding/Google/session/cache checks**, and Worker dry run passed. The screenshot walkthrough now includes canonical branding, inline email preview and labeled Google setup fixtures. No live Google conformance or public release readiness is claimed.


## 2026-10-12 — Credential-encryption key scope

The master key supplies AES-256-GCM for provider-held credentials/private capabilities: per-user Google tokens/OAuth state, S3/WebDAV credentials, server-held account signing keys, contact URLs, conversation capabilities and file-sharing invitations. It does not provide end-to-end file encryption, replace password hashing, hold authenticator passkey private keys or replace the separate recovery-file key derivation. Loss or unplanned replacement would make existing encrypted records unreadable.


## 2026-10-12 — Portable recovery identity design

Historical proposal: the combined name/recovery format below is superseded by the later **UUID identity, separate name certificates and automatic free names** entry.

User requested a provider-signed recovery file containing the assigned name and signing/encryption keychain, so leaving and returning preserves identity and existing signatures/contact links. [Portable recovery identity proposal](docs/spec/recovery-identity.md) specifies a version 2 decrypted payload inside the existing version 1 answer-encrypted envelope, provider signing authority separate from `KEY_ENCRYPTION_KEY`, original AccountObject signer adoption, and a distinct encryption key. Private keys remain inside the encrypted download; a populated encryption keychain does not imply existing content uses it.

Implementation boundary agreed for this work: recover retained identity/account state; preserve subject, handle assignment and current keys; validate the provider-signed backup and live random recovery credential; never import over a current keychain or reconstruct grants from private keys. After upgrade, persisted account policy must require the signed v2 input so removing its signature cannot reach the legacy v1 path. Legacy files retain their explicitly recognized token-only behavior until upgraded. Replacement-file activation keeps existing transaction resume and token-invalidation semantics.

Code inspection found that identity-shard lookup cleanup can release a handle claim when its account record is missing. These existing lookups are not durable name reservations. Reconstitution after deletion therefore remains disabled until retained authoritative reservation and revocation state, collision handling and crash-safe restoration exist. Current grants, revocations, expiry, quota use, quarantine and collection state remain authoritative; key possession does not recreate deleted permissions or data. Existing recovery resets login authenticators/sessions but is not full compromise remediation for copied identity keys, linked email or application/resource permissions.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D068 | Recovery carries a provider-signed name/subject assignment and the original signing plus separate encryption keychain. Independent stable provider signer; bind the random recovery credential and keychain into the signed package. | User requested portable signed identity direction in conversation, 2026-10-12. Protocol/security reviewer ___ / Date ___ / Outcome ___ |
| D069 | Return preserves identity for retained accounts and their live authorization state. Missing-account restoration, handle reassignment, cross-provider routing and key rotation require separate protocols; old backup state cannot revive revoked grants. | Reviewer ___ / Date ___ / Outcome ___ |

Design work reviewed the actual recovery, identity-sharding, AccountObject key storage and contact verification implementations. Automated agent cross-review is requested separately and does not constitute human sign-off. Implementation and test outcomes must be appended after execution; this entry claims architecture work only. Public production release remains disabled under the existing security gates.


## 2026-10-12 — Permanent namespace policy and signup clarity

Historical intermediate design: `basename.number` and current-paid eligibility below are superseded by the later **UUID identity, separate name certificates and automatic free names** entry. Permanent nonreassignment remains required.

User explicitly directed that handles never be recycled: free accounts receive a provider-assigned numeric suffix, while paid accounts may claim a short name without the suffix. [Permanent account names](docs/spec/identity-names.md) specifies immutable canonical `basename.number` names, shared or disjoint sharded monotonic suffix allocation, a permanent claim ledger separate from live lookup cleanup, and one nontransferable paid short alias per subject. Subscription lapse, inactivity and account deletion never release either kind of claim. Ledger history and counter high-water marks cannot roll back; existing namespace backfill and disaster-recovery continuity remain explicit production evidence requirements.

This direction supersedes any earlier suggestion that a released handle might be reassigned. Adding a paid alias preserves the canonical name, original subject, keychain, contact URLs and previously issued identity recovery assignment. Provider signatures attest historical issuance and do not recreate deleted authority or grants. Independent agent review checked the permanent-ledger and one-alias boundaries, including that a definite unsuccessful alias claim must not consume the owner's sole successful claim.

Signup now accepts a 3–18 character base name and explains the assigned numeric suffix. Login accepts the full handle, including the dot separator. Recovery setup displays the exact server-issued handle, preserving it as untranslated owner data while localizing interface text in English and Spanish. Only the public handle is added to the browser projection; recovery keys/tokens remain in private operation state. No paid-claim form is introduced before its API is integrated.

Validation: existing browser Action/state checks **3/3 passed**. Direct happy-dom checks passed for signup/login bounds, numeric-handle login, English/Spanish explanatory text, literal complete-handle rendering, and browser Unicode-sets input-pattern validity. This is DOM evidence, not a real-browser or deployed namespace conformance claim. Separate durable recovery integration tests **5/5 passed** before namespace wiring, including retained signer/contact policy, rejection without mutation, missing account/key denial, signing-authority absence and legacy-to-v2 resume. Full integration results after namespace wiring remain to be recorded by the coordinator.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D070 | Handles are permanently nonreassignable. New free canonical names use `basename.number` from a durable provider-wide/sharded allocator; permanent claims survive live lookup cleanup and deletion. | Explicit user direction in conversation, 2026-10-12. Allocation/migration reviewer ___ / Date ___ / Outcome ___ |
| D071 | One paid short alias supplements the immutable canonical identity; retain its claim after billing lapse/deletion, with no release or transfer. Failed unavailable-name claims must not burn the owner's sole successful alias entitlement. | User requested paid short names, 2026-10-12. Alias lifecycle/security reviewer ___ / Date ___ / Outcome ___ |


## 2026-10-12 — UUID identity, separate name certificates and automatic free names

Latest explicit user decisions supersede the earlier combined recovery/name and chosen-base suffix proposals. Identity is a stable UUIDv4. Signup assigns `n.<lowercase Crockford Base32 numeric identifier>` without asking for a base name. A customer who has ever been a verified paid subscriber may claim one permanent 3–32 character custom alias, including after cancellation; aliases begin with a letter or digit and otherwise contain lowercase letters, digits, underscores or hyphens. No alias contains a dot, reserving `n.` for free numeric allocation. Every name remains permanently nonreassignable.

Recovery payload v2 now contains only issuer, stable UUID, independently generated signing/encryption private keychain, reset credential and bounded version/warning/provider-proof metadata. It contains no handle, alias, name assignment or name certificate, even inside the reversible signed proof. Public name certificates are separately signed and downloaded and contain only issuer/UUID/canonical-name/assignment-lineage/issuance metadata and public proof. Both proofs use distinct signature domains and the configured provider authority. [Recovery and certificate specification](docs/spec/recovery-identity.md); [namespace policy](docs/spec/identity-names.md). The outer answer-encrypted envelope remains v1; explicit legacy payload-v1 compatibility is retained under account policy.

Independent cryptographic agent review found asynchronous caller-mutation races in creation/verification. Inputs are now bounded and snapshotted before asynchronous cryptography; delayed-import/verification adversarial regressions cover both cases. Crypto tests **6/6 passed**, covering exclusion of names from recovery, no private material in certificates, purpose separation, scalar/public-point matching, UUIDv4, trusted-authority binding and mutation rejection.

Signup no longer requests a name; the actual allocated handle is displayed during recovery setup using separate public response metadata. Account security now displays the stable UUID, canonical name and custom alias. The one-alias form explains permanent commitment and ever-paid eligibility, requires explicit acknowledgement, and relies on server-verified paid history. It publishes a name only after server success and refresh. Both name-certificate download actions verify the provider signature and selected issuer/UUID/name before downloading the public artifact. OwnerFlow guards prevent late responses from crossing account changes. New DOM/Action checks **4/4 passed**, alongside existing browser-state checks **3/3 passed**; no real-browser, deployed or operational backup conformance is implied by those checks. Independent agent review found no blockers in the new alias/certificate UI or owner-change guards. `npm test` also passed **423/423** at this integration checkpoint; the coordinator records any later whole-tree/browser results.

| Decision | Direction and qualifications | Human sign-off |
| --- | --- | --- |
| D072 | Stable UUIDv4 is the identity. Recovery excludes every name/assignment; name certificates are separate public signed artifacts. Supersedes the combined payload portion of D068. | Explicit user direction, 2026-10-12. Crypto/protocol reviewer ___ / Date ___ / Outcome ___ |
| D073 | Free signup automatically allocates `n.<Crockford Base32>` using the durable shared/sharded numeric allocator. Permanent claims and nonrollback requirements remain; supersedes `basename.number` in D070. | Explicit user direction, 2026-10-12. Namespace/migration reviewer ___ / Date ___ / Outcome ___ |
| D074 | Verified paid subscription history permanently grants eligibility for one nontransferable custom alias, even after cancellation. Server billing history is authoritative. | Explicit user direction, 2026-10-12. Billing/security reviewer ___ / Date ___ / Outcome ___ |

Full runtime/Worker/browser results after all integration changes must be appended by the coordinator. Missing-account reconstruction, provider signing-key rotation, legacy namespace backfill, disaster-recovery nonrollback and production release retain their existing gates; no human approval is fabricated here.

## 2026-10-12 — Final identity/name integration and verification

Latest user direction implemented: cryptographically random UUIDv4 subjects; automatic `n.<Crockford Base32>` free aliases with canonical case/ambiguous-character normalization; permanent paid aliases available from verified historical payment, including after cancellation; original numbered alias retained. The signed PII-encrypted identity backup has no handles or name certificates. Authenticated public certificate downloads bind each retained handle to its UUID separately. Claiming an alias preserves identity keys and existing recovery authority. Owner projections discover committed paid aliases even if the publication CAS lost its response.

Independent review fixed interrupted legacy-to-v2 recovery resumption, mutation during verification, signing/certificate mutable-input races, counter-corruption/reset reuse, paid-claim collision/crash recovery, and raw-spelling login rate-limit bypass. Browser recovery cancellation now aborts authority verification and prevents late credential submission or KDF startup. Oversized streaming Worker coverage uses a paced client upload so early413 responses do not race Undici's eager upload with EPIPE; byte limits and fail-closed assertions remain intact.

Validation:425/425 core/SDK/runtime checks;56/56 UI state checks; actual Chrome+local Wrangler signup/passkey/password/PII recovery checks5/5; separate public-certificate/canonical-login/authority-cancellation checks2/2. Final actual Worker and deployment dry-run results are recorded below after completion. [Independent review](docs/release/recovery-identity-audit.md) and [walkthrough screenshots](docs/walkthrough.md#26-stable-identity-and-permanent-handle-aliases) distinguish local verification from live provider conformance.

Recovery signing uses an independent RECOVERY_SIGNING_KEY Worker secret, separate from the other keys. Local Wrangler uses a distinct private authority; Node persists its own authority. [Operator requirements](docs/deployment/identity-backups.md) document no blind signing-key rotation, namespace backfill/high-water continuity, and deferred missing-account reconstitution. Public release gates remain false.

Coordinator reconciliation reviewer: ___ Date: ___ Outcome: ___. These nonblocking signoff places do not fabricate human approval or replace production gates.

Final checks completed: actual workerd/SQLite/R2 Worker suite25/25 passes, including byte-bounded chunked contact delivery; production Wrangler deployment dry-run succeeds. Chrome certificate/login and cancellation checks2/2 pass with actual signature verification, verified download and no horizontal overflow on390px viewport. Remaining release gates include live billing/provider conformance, namespace migration/backup continuity, signing-key rotation policy and missing-account reconstitution.

## 2026-10-12 — @3sln/js-tools content-addressed client build

User explicitly requested the 3sln/js-tools packaging model. Replaced copied stable module URLs/manual PWA version list with pinned js-tools0.2.0 build artifacts: individually content-addressed authored modules, hashed CSS and bootstraps, a complete import map, self-contained recovery worker and external SDK modules, and public/private build manifests. A reviewed adapter completes pinned0.2.0's missing `.mjs` map entries and origin-absolute aliases, verifies the full declared public graph, and regenerates bootstraps with js-tools' own wireupSource. Source imports and source-module bytes remain unchanged; server policy and credentials stay outside the public boundary.

Generated import-map CSP hashes preserve isolated recovery policy without broad inline script. Immutable assets preserve exact bytes and year-long public caching; live HTML remains no-store. PWA installation authenticates every public cache asset before publishing the generation. The cache manifest comes from build outputs, not a manually updated list. The branded dynamic webmanifest is not precached. Existing tabs keep their worker generation; older public cache retention and built offline branding are documented operational limits.

Actual Chrome found Workers Assets canonicalizing the generated offline `.html` asset with307, correctly rejected by strict precache fetching. The narrow Worker asset adapter now follows only one exact same-origin canonicalization through ASSETS, preserving successful HTML bytes; external/query/alternate/repeated redirects fail closed. Worker regression tests cover this. First-registration tests navigate after activation instead of relying on forced clients.claim. Documented SDK URLs are retained as no-cache loaders to hashed standalone bundles, with exact anonymous CORS rather than imposing our import map on other apps.

Independent verification: deterministic rebuild and authored-byte preservation; full alias/target graph and singleton checks; public/private boundary review; full SHA-256 checks over declared precache artifacts under Node/custom branding. Actual Chrome/local Wrangler checks16/16 cover hashed portal/recovery/certificates/offline; a second13/13 run covers SDK cross-origin loading, immutable headers, CSP and offline UI. Core430/430, UI-state56/56 and Worker27/27 pass. Final full browser and dry-run outcomes follow after completion. No updated application deployment or release activation occurred.

D075 — Adopt js-tools content addressing and generated cache generations. Independent architecture/security agent: source/artifact/HTTP review passed, see [audit](docs/release/build-cache-audit.md). Human reviewer: ___ Date: ___ Outcome: ___. D076 — Preserve external SDK compatibility through standalone hashed ESM and revalidating public loaders. Human reviewer: ___ Date: ___ Outcome: ___. [Operator build guide](docs/deployment/client-build.md).

Final js-tools checkpoint: full Chrome/local Wrangler suite41/41 passes; core430/430, UI-state56/56 and Worker27/27 pass; production deployment dry-run succeeds. Initial dependency audit found five high advisories through an unused HMR type-only core0.4 subtree. Independent source/API and real watcher/websocket testing approved the exact HMR0.1.12→core0.7.5 override. Regenerating only the js-tools subtree applied it while preserving app dependencies; complete npm audit now reports zero vulnerabilities. This compatibility override is documented for future tooling upgrades. No updated app deployment or public-release activation occurred.

## 2026-10-12 — Viable release assessment and completion order

User requested the remaining work before a viable release. Current source has passing local suites (430 core/SDK/runtime, 27 Worker, 56 UI-state, 41 real Chrome/local Wrangler) and a clean dependency audit;. These checks do not establish external-provider conformance or operational readiness. The all-false release ledger needs evidence reconciliation rather than indiscriminate activation.

Completion order: (1) finish and independently validate the real Bindle OAuth/PKCE → fragment consent → scoped resource RPC flow and external SDK, with a second host/client interoperability fixture; (2) complete human messaging/archive rendering, durable push/email dispatch, preferences/unsubscribe, scanner-safe login and lifecycle notices, including localization and retries; (3) prove real Google/S3/WebDAV storage behavior, address the current Drive 1 MiB object ceiling and retained-version cleanup, then verify live Polar billing and permanent alias eligibility; (4) prove backup/restore, permanent namespace nonrollback and key custody/rotation policy, reconcile the promised deleted-account identity restoration, and keep destructive lifecycle jobs gated until notices and grace periods work; (5) production Turnstile/bot rules, capped-load/cost and abuse exercises, independent security/UX review, accessibility and actual-device tests; (6) self-host setup rehearsal, docs/screenshots, terms/privacy approval, staging deployment and evidence-backed release gate reconciliation. TURN requires enforceable spend controls; credentials alone do not establish safe relay availability.

Operator dependencies: production Turnstile configuration; Polar API/webhook/product identifiers; push sender configuration and any relay credentials once relay enforcement exists; product/legal approval of terms, privacy, retention and recovery policies.  No public opening or feature-scope reduction is authorized by this assessment.

Release acceptance reviewer: ___ Date: ___ Outcome: ___. Independent agent review and resolved findings are recorded separately; this checkpoint does not fabricate approval.

## 2026-10-12 — Native Bindle completion and default object storage

The real Node and Worker identity stores now compose account-local Bindle authorization, shared preferences and resource authority. Login uses exact provider/client/callback binding, S256 PKCE and one-use authorization codes; owner consent renders typed, localized fields and exposes existing consumers. Applications receive opaque field-derived resource references and separate child tokens, never connector configuration or parent storage credentials. The owner preferences editor uses revision and live-consumer review checks for a single shared save; resource generation, field incarnation, connection generation and recovery epoch remain live checks, including before journal replay.

Independent protocol and security review found and drove fixes for scalar-only edits accidentally expanding resource subsets, resource reordering changing authority, scope canonicalization, prototype-named fields, refresh replay rollback, expired credential accumulation and unknown UUID shard allocation. Browser work also fixed cross-origin SDK loading, bound browser fetch, provider-login continuation, typed multi-value editing and explicit optional-fragment decline preservation. Rotating refresh credentials stay in memory, preserve original grant ceilings and have an absolute eight-hour family lifetime; spent-refresh replay invalidates the family and its child credentials. Requests, codes, access tokens, families, journals and issued object capabilities are bounded per account and pruned by account-local maintenance.

| Decision | Direction and rationale | Sign-off |
| --- | --- | --- |
| D077 | Use the existing durable identity/account implementations for Bindle; one UUID-routed federation shard per active identity, no global grant index on the request path. Reject missing/inactive identities before allocating account shards. | Architecture reviewer ___ / Date ___ / Outcome ___ |
| D078 | Make object presigning a uniform contract capability, choosing native only where every delegated bound can be enforced, otherwise opaque host proxy URLs. Require presign plus get/put on the same field; each URL narrows to one object, operation and bounded lifetime. This supersedes the earlier implementation's refusal to presign scoped resources. Native URLs disclose the backing address and revoke at expiry; proxy URLs check live authority. | User direction recorded 2026-10-12. Protocol/security reviewer ___ / Date ___ / Outcome ___ |
| D079 | Every account owns a stable, non-disconnectable, metadata-only default hosted storage resource. Stored bytes share the visible message/object plan quota; consent remains mandatory for app access. Cold restoration preserves the same resource ID. Legacy accounts with 100 manual resources receive the default without evicting user resources; additions remain blocked while over the existing cap. | User direction recorded 2026-10-12. Storage/migration reviewer ___ / Date ___ / Outcome ___ |
| D080 | Derive provider object-URL HMAC authority using a distinct HKDF domain from the credential-encryption master key. Public proofs contain only an account locator, random ID, fixed operation and expiry; private grant state remains in the account shard. Recovery signing authority is separate. | Cryptography/operations reviewer ___ / Date ___ / Outcome ___ |
| D081 | Initial hosted Bindle registration uses operator-reviewed client origins/callbacks and immutable fragment schemas. The protocol remains open and portable; dynamic origin proof, discovery fetch and safe egress are separate release work, rather than accepting arbitrary URLs as trusted clients. Federation remains production gated. | Federation release-profile reviewer ___ / Date ___ / Outcome ___ |
| D082 | Keep human message rendering in an iframe with an empty sandbox and restrictive CSP. A sanitizer or native setHTML can remove unsafe markup but does not replace origin/network isolation. Object proxy downloads use inert attachment responses. | Messaging/security reviewer ___ / Date ___ / Outcome ___ |

Default-storage validation: seven native Node tests pass, including fresh authenticated API access, metadata-only initialization, stable restart/cold restoration, corrupt/foreign pointer rejection, shared message/object quota and the 2,000-message archive boundary. The actual Worker test verifies signup/API visibility, disconnect rejection and R2 restoration of exactly one default. An independent reviewer separately reproduced the legacy 100-resource migration and 2,001-row archive restoration. [Independent audit](docs/release/federation-completion-audit.md).

Before the signed-URL service integration, the combined core/SDK suite passed 489/489 and UI-state tests 56/56. The actual native Worker federation tests passed 2/2 (full consent/resource RPC/refresh replay and credential-maintenance alarm), and the previous actual-Chrome run passed 44/44. Those browser results predate the default-resource and signed-URL UI changes; final combined verification is recorded below after integration. These are local implementation results, not external-provider production conformance or approval to open signup.

### Distributed-name discovery steering

The user requested Cloudflare's distributed-web resolver and confirmed the [2021 ENS/IPFS announcement](https://blog.cloudflare.com/cloudflare-distributed-web-resolver/). Current primary-source research found the specific DoH experiment was [deprecated July 1, 2025](https://developers.cloudflare.com/fundamentals/api/reference/deprecations/). The user was informed during implementation. The replacement follows the same public-name → DNSLink → public manifest → live HTTPS provider model through maintained resolver operators, instead of depending on that retired endpoint or substituting ordinary DNS for ENS. [Research and live observations](docs/release/distributed-discovery-interop.md).

D083 — **Deferred by explicit user decision, 2026-10-12.** Distributed/Web3 name discovery is removed from the current SDK and release scope. The experimental Cloudflare resolver is retired; live review also found the selected public IPFS gateway retired, an alternative gateway redirecting to it, and no verified current `.crypto` availability. The proposed pluggable DNSLink/DoH implementation and its added CID dependency were withdrawn. Keep ordinary HTTPS `.well-known/bindle/manifest.json` discovery and exact issuer/origin checks. Retain the research as historical evidence; reconsider naming-provider support only with maintained, dependable resolver/content retrieval options. User decision recorded; future reconsideration reviewer ___ / Date ___ / Outcome ___.

Signed-URL integration checkpoint: full core/SDK regression 492/492, actual Worker focused tests 3/3 (including real binary proxy URLs), and updated actual Chrome federation flows 3/3 pass. Independent review reproduced a URL-expiry gap between initial admission and dispatch, drove a final-boundary guard, then verified the operation does not execute after expiry. Native mode pins the preflighted object version and required range headers; proxy mode preserves the original child authority and enforces exact-size/type/conditional writes. The legacy 100-resource migration also now remains usable through MCP rather than failing its previous collection cap. Final combined checks after distributed-name implementation remain pending below.

## 2026-10-12 — Physical storage-write cost guard

The user identified write/update churn as a fee risk. Existing monthly work admission already protects covered logical changes, but is explicitly not a count of actual bucket puts. Added a separate meter at the I/O boundary for uploads, replacements, message/conversation bodies, large stored mutation outcomes and cold archives. BLOBS and ARCHIVES share one account meter; private caller attribution is immutable per call and removed from provider options. The guarded port exposes only get/put/delete, so a future list/copy/multipart API cannot silently bypass Class A admission. Each attempted put is nonrefundable; completed replay does not call the bucket again. Reads, deletion and safety operations remain available.

D084 — Initial write limits are 5 attempts/app/rolling minute, 10/account/rolling minute, and 1,000/5,000/10,000 foreground attempts per UTC month for free/Plus/Pro. A total 250,000 service allowance is split into 225,000 foreground and 25,000 archive maintenance attempts; each account has 16 reserved archive attempts/month so foreground exhaustion need not prevent shelving. Sixteen immutable service shards allocate small prepaid leases off the normal path. These are operator-configurable conservative defaults, separate from logical work and byte quota. Cost/product reviewer ___ / Date ___ / Outcome ___.

D085 — Foreground and archive allocation share an atomic combined monthly counter per service shard. Total partition capacity depends only on the service ceiling; maintenance is carved out, and the allocation policy is pinned on first use for that month. Changing a percentage cannot create a second spending pool. Missing authority, corrupt counters, clock rollback and uncertain allocations fail closed; resetting/rolling back state is not a supported replenishment operation. Architecture/operations reviewer ___ / Date ___ / Outcome ___.

Independent accounting review drove fixes for falsey corrupt state, shared lifetime-null resets, duplicate-instance lease overcredit, clock transitions, missing authorities, retry timing and mid-month pool changes. Root composition tests verify changing keys/versions or writer IDs cannot bypass app/account bursts, both bucket ports share limits, failures remain charged, completed writes are not repeated, maintenance survives foreground exhaustion, and unmetered bucket methods are absent. Actual Worker signed-upload tests verify 429 + Retry-After, one persisted physical attempt for repeated completed upload and only one stored object after a denied second write. Retry timing survives account faults, native journals, federation faults and Durable Object RPC.

Validation before the final UI cost-meter follow-up: core/SDK 515/515, UI state 56/56, actual Worker 31/31. Final targeted accounting/composition checks 16/16 also pass after the last malformed-counter/config guard. Earlier direct-HTTPS browser integration passed 44/44, with a subsequent 3/3 Spanish default-storage follow-up; cost-meter browser evidence follows below. [Design and price interpretation](docs/architecture/storage-write-costs.md), [independent review](docs/release/storage-write-budget-review.md).

Cost scope is deliberately precise: the cap bounds covered application bucket-put attempts, not the entire Cloudflare invoice. R2 Standard Class A pricing/free allowance and billing rounding were checked against primary documentation; other workloads may share free allowances, provider-internal retries are not measured here, and storage bytes, reads, compute/search and external services retain separate controls. Native signed write URLs remain unavailable without enforceable one-use/cost admission; proxy uploads use this guard. External S3/WebDAV dispatcher writes remain unavailable rather than making unverified billing/control claims.

Foreground writes also pause if retained-upload or garbage cleanup is paused, preventing replacement churn from accumulating abandoned physical objects outside logical quota. Reads, deletion and reserved archives remain available. Final core/SDK 517/517, actual Worker 31/31, DOM smoke and full actual-browser 45/45 pass; targeted accounting/composition 17/17. Dependency audit reports zero vulnerabilities. The console exposes monthly physical-write usage separately from bytes and logical work, with localized exhaustion/retry messages and no automatic write retry. Final meter layout follow-up and deployment dry-run evidence follow below. Production release gates remain disabled.

Final UI state 57/57 and SDK/localization 22/22 pass. After polishing mobile meter spacing and adding the cleanup-pause translation, focused Chrome 9/9 passes, including rectangle checks for nonoverlapping meter text and Spanish rendering. Updated walkthrough screenshots show the real Worker-backed storage meter. Wrangler deployment dry run passes; this checkpoint is not a production deployment.

## 2026-10-13 — Practical write bursts

The user identified the initial 5/app and 10/account rolling-minute policy as restrictive for legitimate sync and batches. Supersedes D084's minute limits with 120 attempts per app per account and 240 per account across all writers in a rolling 60 seconds. The full allowance can be used immediately; this is not a paced two-writes-per-second throttle. Monthly plan and shared service ceilings remain unchanged, so the burst increase does not raise the admitted monthly bucket-write ceiling. Defaults and both Wrangler configs agree; low-limit boundary tests now declare their intended fixture policy explicitly. Cost/product reviewer ___ / Date ___ / Outcome ___.

Validation: core/SDK 517/517 passes after the burst-policy change; whitespace check passes.

## 2026-10-13 — Shared storage-write ceiling raised

User-approved policy supersedes D084's service ceiling: 10,000,000 physical bucket-write attempts per UTC month, split into 9,000,000 foreground and 1,000,000 reserved archive attempts. Runtime defaults and both Wrangler configs agree. Per-account monthly allowances, rolling burst limits, shard layout and atomic accounting are unchanged. Existing authority records pin their monthly policy, so an already-used shard retains its existing policy until the next UTC month; this change does not reset or bypass counters. User direction recorded; operations reviewer ___ / Date ___ / Outcome ___.

Validation: core/SDK 517/517 passes, including exact shard-capacity conservation at the new 10M ceiling; whitespace check passes.

## 2026-10-13 — Rolling account write allowances

User requested identical paid-plan write limits and minute/hour/day account protection instead of a monthly physical-write lockout. D086 supersedes D084's foreground account monthly quotas: Free 500/hour and 1,000/day; Plus and Pro both 2,000/hour and 10,000/day, rolling windows. App minute cap remains 120 per app per account, combined account minute cap 240. Shared service 10M/month and archive reserve remain separate. Hour/day history uses bounded conservative minute buckets; retry timing must reflect actual recovery and all blocking windows. Migration must preserve service ledger/credits, recent burst history and fail-closed corruption handling. Product/architecture reviewer ___ / Date ___ / Outcome ___. Independent implementation audit and real browser evidence pending.

The user subsequently explicitly approved moving logical work admission to minute/hour/day and combining it with physical writes. D087: one shared activity ledger admits each covered logical mutation attempt and each bucket-put attempt as one unit; operations may cost multiple units. Account allowances and paid parity above apply to the combined units. The active controller removes old owner/service logical monthly caps and uses the shared 10M/month activity authority; old work/month records and standalone implementation remain historical and their credits are never imported. Independently configurable physical/logical admission flags share the meter when enabled. Product/security reviewer ___ / Date ___ / Outcome ___.

User additionally required all message-delivery APIs to use the same account limits and normal HTTP rate-limit path. Verified contact endpoint and bearer delivery already enter the shared HTTP message abuse policy and recipient receive/guarded blob admission; conversation public ingress and recipient inbox do likewise. Narrow review identified missing cross-origin retry-header exposure and conversation retry timing propagation. Fixes retain the existing HTTP policy, report the denied window's conservative retry bound, and preserve recipient timing through delivery transports/backoff. Actual Worker regression evidence pending.

Final combined-policy verification: core/SDK 531/531; actual Worker 33/33, including message recipient quota and shared HTTP ingress cases; full Chrome 45/45 and focused rolling UI Chrome 9/9; UI state 58/58; SDK/localization 22/22; DOM smoke and Wrangler deployment dry run pass. Independent unified-meter audit 36/36 passes; final message transport audit recorded separately. Updated walkthrough screenshots show one activity allowance.

Final message follow-up: real Worker focused 2/2 verifies reminted bearer tokens cannot replenish recipient allowance, multipart/bearer replay creates no duplicate object, and normal shared HTTP ingress denial exposes Retry-After: 60. Same-origin and remote conversation transports preserve bounded recipient retry timing; queued retry scheduling waits at least that delay. Additional remote contact-token mint throttling regression passes.

Independent final message review passes 19/19 (conversation/Node HTTP and actual Worker message cases), with no focused blocker. Final deployment dry run passes after transport fixes.

## 2026-10-13 — Revised paid storage catalog

User-approved D088 catalog: Free 500MB; Paid $5/year5GB; Plus $35/year100GB; Ultra $250/year1TB, decimalbytes. All paid tiers share existingactivitylimits and paidfeatures. Polar requires three distinct annualUSD products, IDs PAID/PLUS/ULTRA. Existing unversioned oldplus5GB mapsPaid and oldpro100GB mapsPlus; newstate must be versioned so renaming cannot silently upgrade old5GB accounts to100GB. Paidhandle eligibility remains permanent. Implementation, migration, Ultraquota, browser and independent review evidence pending. Product/operations reviewer ___ / Date ___ / Outcome ___.

Catalog implementation: runtime uses free/paid/plus/ultra and catalogVersion2; verified legacy terms map without capacity escalation and retain an original bounded deadline through reconciliation/restarts. Existing ever-paid markers/handleclaims remain valid. Unknown historical product/price orders require operator reconciliation before retiring a prior live catalog. Ultra's aggregate quota and message-domain ceiling are 1,000,000,000,000 bytes; individual object/message/count/cold-archive bounds remain separate. New Polar catalog validates all three products, prices and shared organization.

Backend verification: core537/537, actual Worker33/33, focused billing/migration/Ultra/activity61/61. Independent catalog/quota review69/69 passes, including exact quota boundaries, >100GB logical message admission, expiry, markers and webhook checks. These use seeded accounting and small actual bodies, not a physical 1TB upload/restore. Economics calculator derives plan capacities/prices from the canonical billing catalog, four-tier finite scenarios verified; provider R2/payment rates rechecked. Frontend full-browser and final dry-run evidence pending below.

Final UI verification: actual Chrome46/46 full regression and10/10 focused catalog/integration checks pass; UIstate59/59, SDK/localization22/22 and DOM smoke pass. Newcheckout IDs, exactannualprices, Spanishlabels, 1TBformatting and320px layout verified. Updated walkthrough includes cleanfourcardpricing desktop/mobile screenshots. Backend537/537 andactualWorker33/33 remain passing. Billing staysdisabled; no liveproductpreflight/checkout/deployment claimed.

## 2026-10-13 — Provider-backed regional pricing

User clarified actual prices vary by currency and should come from Polar for the buyer's region. D089: retain the approved USD amounts only as base catalog/economics anchors; active paid UI quotes verified configured Polar fixed prices. Pinned SDK1.0.2/2026-10 exposes no read-only geo-price resolver. Use country as a display hint to select an available common currency, expose a user override, and send that explicit currency to checkout for consistency. No GET/status creates checkout sessions, no locally invented FX conversion, no client amount/product URL authority. Workercountry comes from request.cf; Node discards spoofedforwardingheaders and uses socketIP. Providerzero-decimal behavior must govern formatting rather than IntlISO assumptions. Product/security reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — One Polar webhook and metadata catalog

Product-management events share the webhook with subscriptions, paid orders and refunds, with live API verification on login and billing-sensitive actions. D090: metadata mode pins POLAR_ORGANIZATION_ID, discovers only exact provider-origin-tagged annual fixed-price plans, validates a bounded whole catalog, and publishes an atomic monotonic snapshot. Known paid IDs remain paid/plus/ultra; Free remains local. No product event directly grants an account. Product parameters cover name, storage, rolling-hour/day activity; minute/service/archive budgets remain operator controls. One portable shared registry (Worker Durable Object, Node SQLite) caches public matrices for <=5minutes; ordinary account admission reads validated persisted entitlement parameters, avoiding a hot shared catalog on every write. Invalid/duplicate metadata fails closed without static fallback. Archived products are not subscription revocation proof. Active reconciliation is bounded, API failures never extend paid deadlines or block login/read/delete. Architecture/security reviewer ___ / Date ___ / Outcome ___.

User asked about Polar tier upgrades. Primary provider docs confirm subscription product changes with immediate invoicing, next-invoice proration or next-period scheduling. D091 proposed policy: immediately invoiced prorated upgrades; renewal-time downgrades. Current app uses the authenticated Polar portal and its organization default, not a custom direction-specific policy adapter. No live provider setting changed. API reconciliation must ignore pending future plans for current quota and not grant failed/unpaid upgrades. Billing/product reviewer ___ / Date ___ / Outcome ___.

The user explicitly approved D091's direction-specific policy and requested implementation plus exact product metadata. Owner-confirmed app plan changes must modify the existing subscription with immediate invoice proration for higher tiers and next-period scheduling for lower tiers; durable operation identity prevents duplicate external mutations after uncertain responses. Confirmed catalog price/currency/revision and subscription binding must remain live. Portal plan editing must be disabled operationally to avoid bypassing the app policy; payment/cancellation portal remains available. No live billing mutation or organization setting change is performed without the operator's configured account.

## 2026-10-13 — Finite over-quota retention and generic offload

User rejected indefinite retention after downgrade and requested a grace/cutoff plus practical large-data offload; then generalized destination from S3credentials to any connected storage resource. D092 provisional design: 30-day over-quota retention after effective reduction, growthpaused immediately, read/export/deleteavailable, cleardeadline andmultichannelnotices; no purge enabled beforefunctionalexport+terms+race/safety verification. Ownerkeepselection/wholedata sets preferred overarbitraryfilepruning. Identity/keychain/permanenthandle records remainseparatefromlargepayloadretention. D093: resource-generic copy→strongverify→durablecheckpoint→exactversion source deletion; destination mustwritable/verifiable andlivegeneration/scopevalid. No duplicate credential entryforalreadyconnectedresources. Read-onlyproviders remainunavailableuntilwriterconformance. Download/rclone viaowner-only inventory/export outsideBindleappstoragecontract, resumabletransferindependentofordinaryFreeactivitycaps butboundedbyseparateescape budget. No largeZIP primary andnoSSHrsyncserver. Offload/export differsfromliveexternalbackingmigration; oldappreferences mustnotbesilentlyrewired. Independent architecture/design agent drafting details. Retention/product/operations reviewer ___ / Date ___ / Outcome ___.

Independent designer found a preexisting message deletion crash gap (metadata committed before garbage ownership persisted). Billing/backend owner notified to persist garbage within the same deletion transaction before any physical I/O. Hosted-object deletion already owns its garbage durably.

## 2026-10-13 — Explicit generated-identity signup entry

User requested a distinct create-account action on sign-in now free identities are generated rather than chosen from unregistered emails/handles. The existing dedicated signup endpoint already assigns the identity without an email or handle input. Frontend owner will promote the login-card action to a clear provider-branded create-account button, preserving self-host branding, localization, terms/security checks, credential and recovery setup, and return to existing sign-in. Production signup remains gated by the existing release configuration. Browser flow evidence pending.

## 2026-10-13 — Service-owned billing metadata namespace

User rejected `bindle_plan` because Bindle names the open ecosystem/spec, not the service. Supersedes D090's pending metadata spelling with `3sln_me_catalog`, `3sln_me_service`, `3sln_me_plan`, `3sln_me_storage_bytes`, `3sln_me_activity_hour`, and `3sln_me_activity_day`. Hosted billing policy is outside the Bindle protocol. A bounded configurable `POLAR_METADATA_PREFIX` lets self-hosts select their own service namespace; origin and organization binding remain required. No prior metadata catalog was deployed, so accepting the rejected keys for compatibility is unnecessary. Implementation and independent verification pending. Architecture reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Billing and explicit-signup implementation checkpoint

Final source implements provider-backed currency prices, atomic metadata registry and signed single webhook, service-owned configurable `3sln_me_` metadata, live bounded reconciliation, owner-confirmed existing-subscription upgrades/downgrades and scheduled-change cancellation. Unknown financial outcomes remain durably locked for recheck rather than issuing duplicate mutations. Accepted upgrades expose at most15minutes provisional capacity with a spent-period marker; pending refund/failure evidence wins over payment proof. Settled refund handling follows live subscription state, not automatic revocation from an event alone. Returning login remains available during exhausted activity budgets/provider outages. Message deletion persists cleanup ownership in the same transaction as logical deletion.

Explicit signup is a prominent localized provider-branded button in sign-in, tested through real passkey creation/recovery and closed-registration/back navigation. Fixed-path MCP/device signup continuation preserves pending context without widening arbitrary redirects. Final frozen source verification: core561/561, actualWorker34/34, independentbilling/activityaudit74/74, fullChrome52/52, focusedfinancialChrome11/11, UIstate67/67 and Bab4/4. Screenshots and walkthrough refreshed; financial screenshots use injected provider fixtures. No live Polar purchase, webhook delivery or production entitlement conformance claimed. Billing and public production signup remain gated. Generic provider offload and finite retention are documented designs; destructive cutoff is not enabled. Final bundle dry run pending. Product/security/operations reviewer ___ / Date ___ / Outcome ___.

Final packaging verification: DOM smoke passes; Wrangler deployment dry run passes against the frozen source. Provider credentials/catalog and real sandbox lifecycle verification remain required before billing enablement.

## 2026-10-13 — Production Polar verification with discount

Direction: use normal production Polar with a discount code instead of sandbox for verification. Local fixtures continue isolated sandbox configuration. Verification must include discounted/zero-total behavior without confusing active subscription quota with the permanent ever-paid anti-abuse handle marker. Provider verification reviewer ___ / Date ___ / Outcome ___.

Production discount preparation identified two real-provider mismatches before live testing: checkout disabled code entry, and permanent handle eligibility required a full-price receipt. Follow-up enables provider code entry and validates positive settled discounted payments separately from zero-total subscription quota. Independent review also found order arithmetic must not depend on `tax_behavior`, which is absent from the current Order schema; inclusive/exclusive arithmetic must be checked from the actual documented amount fields. Implementation/tests in progress.

Discount follow-up final verification: core566/566 and independent billing/payment audit41/41 pass. Provider code entry is enabled; checkout response arithmetic remains bound to the quoted product/currency and authenticated owner. Positive discounted settlement qualifies for permanent paid-handle eligibility; zero-total/credit-only orders do not mint that marker. Negative credit invoices cannot hide an earlier qualifying payment, inclusive order amounts work without an invented tax_behavior field, and tax-only refunds end pending upgrade grace. No UI source changes.

Discount follow-up Wrangler deployment dry run passes.

## 2026-10-13 — Organization-global Polar webhook filtering

User requires ignored acknowledgements for unexpected event types and unrelated products because Polar subscriptions are organization-wide. Review identified signed unknown SDK types and unrelated customer external IDs currently return errors, and unrelated product events can refresh the catalog unnecessarily. Backend follow-up must authenticate raw bodies first, use an explicit supported event set, classify service ownership without unrelated-account effects, handle refund order routing, and preserve actual revocation/archive/tag-removal reconciliation. Invalid authentication remains rejected. Exact recommended11event selection documented; subscription.updated covers all changes/renewals. Independent review and signed-event/no-sideeffect regression evidence pending. Security reviewer ___ / Date ___ / Outcome ___.

Global webhook hardening final verification: core574/574, actualWorker35/35, independentfocused42/42 including the actual multi-request Worker case; registry14/14. Both Polar signature-secret encodings are tested. Authenticated unknown/unwanted events and unrelated owners/products return200ignored; invalid/expired signatures return403, malformed relevant payloads return400. Archived/replaced products and prior customer subscriptions remain reconcilable for revocation. A real Worker test exposed globally retained request-bound catalog stubs/pending I/O; the fix retains only public snapshots across requests and binds remote calls to each request, with concurrent independence regression. No frontend source changed. Final deployment dry run passes.

## 2026-10-13 — Live webhook catalog 503 diagnosis

A reported billing_catalog_mismatch response prompted a regression: a Paid product with annual/count1 metadata and USD/GBP/EUR/MXN fixed prices matches the contract and is accepted. Because catalog validation is atomic across all three plans, generic mismatch could hide missing Plus/Ultra service tags or another price/product condition. Narrow diagnostic patch now reports the plan and failed nonsecret catalog requirement without relaxing validation or returning secret/customer payloads.  Focused40/40 passes; fullcore and packaging evidence pending.

Catalog diagnostic patch final verification: core576/576, focused40/40, Wrangler dry run passes. Actual reported Paid multi-currency shape accepted; missing qualifying Plus metadata has an exact diagnostic regression. No schema/timeout/security relaxation. Includes previously untracked signed webhook routing regressions in this commit.

## 2026-10-13 — Independent public-signup gate

Add independent SIGNUP_ENABLED gate while retaining RELEASE_READY=false and unsigned full release checks. Accountcreation still requires Turnstile, severe IP/subnet/region/global admissions, accepted terms, credential setup and mandatory recovery. The public Turnstile site key is persisted in hosted config; the matching secret stays a runtime secret. Backend gate must agree between config andPOST and failclosed for missingpublic/secret/recovery/encryption keys. Implementation/tests pending; release certification not implied.

Signup gate final verification: core577/577, focusedunit2/2 and actualWorker2/2 pass; Wrangler dryrun passes. Both public config andPOST share prerequisites. Explicitfalse overrides RELEASE_READYtrue; omittedflag retains legacyfallback. Missingcaptcha proof403 and missingpublickey503 create no account. No frontendsource changed, existing explicitsignup/recovery browser regressions remain relevant.

## 2026-10-13 — Free-only automatic account retention

Operator requires newaccountsetup notice recommending notifications for a fewdays usagefollowup (push orassociatedverifiedemail), onlyfree/unpaid. Automatic accountremoval mustexclude paidaccounts and retain identity ofeverpaid subscribers evenafterdowngrade; do not confuse this with explicitownerrequesteddeletion. Guards needed atwarning/scheduling andfinalpurge with fresh durable evidence, includingmigration, outage andupgrade races. Onboarding mustreflect actuallyavailable deliverychannels rather thanclaim inactivepush/email delivery. Backend, frontend andindependent audit assigned nonoverlappingownership; verificationpending. Product/lifecycle reviewer ___ / Date ___ / Outcome ___.

Mandatory activation supersedes optional contact onboarding: hosted signup must verify email or acknowledge an encrypted push challenge before active session issuance. New limited pending setup cookie, email8digitcode, proofgeneration, credential/recovery resumption and separate setup capability flags are being integrated. Existingactive identities are grandfathered; no global active-account lockout added. Operator copy: “For unpaid accounts, we might check in periodically to ask if you’re still using the account.” Repeated attempts/grace then suspension and deletion must be explained; externalprovider data stays untouched while hosted data is purged only by a future verified executor. Sender templates now support bounded suspension/deletion day countdowns; they are not a live scheduler.

Hosted pending config sets PUSH_ENABLED/MAIL_ENABLED/SIGNUP_CONTACT_REQUIRED true. Real maintained WebPush encryption uses nativefetch and fixed known provider origins; local transport3/3, mail14/14+transport total17/17, actualWorker encryption1/1 and actualWrangler-emittedmodule config test pass. Signup remains paused while the mandatoryactivation UI is integrated; existinglogin/billing remain available.

Independent focused activation/retention audit41/41 passes. Retention helper requires trustworthy newidentity provenance and sticky paid-tier protection; it does not infer never-paid from an empty account store or lazy handlemarker absence. Fullfrontend/Worker verification pending. New lifecycle architecture [account-retention](docs/architecture/account-retention.md) records provider-accepted attempt evidence, phased access freezing/reactivation and externalstorage exclusions. User-authorized lifecycle executor remains outstanding; neither delivery nor automatic suspension/purge is claimed. R2primarydocs checked: IA30day minimum,.01GB-month/.01retrieval/noIAfree allowance; account suspension and economic tiering are separate, not a blanket claim of savings.

## 2026-10-13 — Bab in browser, server and static generation

Operator asked whether createLocalization replaces @3sln/bab and whether static pages should use Bab during generation. Confirmed helper wraps actual createTranslator/ObjectCatalogue/ChainCatalogue from exactvendored @3sln/bab0.2.0 with provenance; it is not anothertranslationengine. Browser andserver sharecatalogues; serviceworker build now compiles EN/ES setupnotifications withBab. Landing has an authored English bot/noJS HTMLshell plus localized interactiveapp; documentation is generated with hardcodedEnglish shell/prose. Designdirection: useBab in generators too, explicitlocalizedpublicURLs/lang/hreflang andmatching initialclientlocale. Documentprose requiresactualtranslations; codeexamples/contractidentifiers staycanonical. Staticlanding/doclocale generation remains pending rather than falselyclaiming current docs translated. Reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Curated public documentation and landing polish

Operator clarified documentation remains English-only and must contain only Bindle specification, application integration and reusable hosting/provider instructions. Public generation now uses an explicit allowlist instead of recursively publishing development documents, removes stale generated tracking pages, and excludes walkthrough assets. Independent review identified mixed normative/tracking paragraphs and exact federation wire-profile omissions; preserving technical requirements while removing signoff tables/operator history is under correction. Internal source documents and reviewer blanks remain in the repository. Publication boundary reviewer ___ / Date ___ / Outcome ___.

Landing navigation drops the redundant “The Idea” anchor while retaining the explanatory section. Selector spacing, 44px targets and a two-row narrow header are under real Chrome verification at1440/390/320px, including Spanish selection and translated hero copy. A visual review caught the320px logo suffix wrapping; correction and final screenshots pending. Current core613/613 and actualWorker37/37 pass; final browser/build evidence remains pending. The separate lifecycle draft has targeted12/12 evidence but no scheduler/suspension/purge integration and is excluded from this activation checkpoint.

Publication review corrections complete:31 explicit public English pages now include the exact federation OAuth/RPC wire profile. Mixed normative paragraphs preserve technical requirements while only tracking sentences/tables and operator history are omitted. Public generation tests4/4 include actual webhook authentication/revocation, portal policy, discounted eligibility, duplicate-email delivery, namespace/recovery invariants and all-page tracking exclusion. Shared browser assets were not mutated during review. Final fullcore617/617 includes12 isolated lifecycle draft tests outside the checkpoint; actualWorker37/37 and Wrangler packaging dry run pass. Fresh320px Spanish landing screenshot independently inspected: logo suffix stays on one line, mobile header clean, no redundant idea link. Full browser/build/walkthrough evidence pending.

Activation/UI/publication checkpoint final evidence: frozen asset build537f64a58fc28f933954; full realChrome57/57 (54 baseline +3 isolated federation) and focused landing/adversarial16/16 pass. Password and virtual-passkey mandatory-contact flows use actual durable Node state and an injected local mail transport, not live mailbox delivery. English desktop/320px and Spanish account-setup screenshots added to [walkthrough](docs/walkthrough.md), appendix29, which stays private to the repository. Routine notification dispatch and automatic lifecycle suspension/purge remain disabled/unimplemented. Reviewer ___ / Date ___ / Outcome ___.

A 320px check exposed normalTurnstile300px overflow absent from local fixtures. Follow-up uses fully visible compact challenge consistently to preserve proof across resize, with a dimension-realistic fixture. Production email/push delivery still unverified; fullrelease certification remainsfalse.

Responsive CAPTCHA follow-up: BrowserProvider explicitly requests compact150x140 Turnstile at all widths so viewport changes preserve the challenge and proof. No clipping, scaling or bypass added. Official [widget configuration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/) confirms flexible still has a300pxminimum. Fresh assets and targetedChrome17/17 pass, including production-sized iframe bounds across320/390/1440/320 and unchanged proof/render count. Previous full57/57/core617/617/Worker37/37 remain checkpoint evidence; this frontend-only fix received the targeted rerun.

## 2026-10-13 — Balanced language selector inset

Operator clarified the selector issue concerns inner spacing: selected text is inset but the native arrow sits against the right edge. Replace only its visual arrow with a CSS chevron while preserving the native select, keyboard behavior and accessible label. Text and arrow both have12px edge insets, with separate reserved arrow space. Forced-colors mode retains the system control. Browser screenshot/keyboard verification and deployment pending.

Operator supersedes compact CAPTCHA choice: request a rectangular widget spanning its container, visible only when automatic checks require user interaction. Use documented Turnstile size=flexible and appearance=interaction-only; keep real server Siteverify enforcement and proof lifecycle. Flexible has300pxminimum, so narrow form layout must accommodate it without clipping, scaling or challenge replacement. UI agent owns form layout/provider and realistic hidden→interactive browser verification; selector text/chevron equal12px edge insets remain in scope. Reviewer ___ / Date ___ / Outcome ___.

Selector/Turnstile correction final local evidence: build320c527147bff6a97e79;16 baseline browser cases pass, final targeted2/2 pass after restoring the hero's20pxpagegutter. Realistic fixtures cover automatic-hidden and65pxrectangular interactive states in signin/signup/email/device forms at320/390/1440, exact widget/slot width and resize preserving proof. Official before/after-interactive callbacks change spacing only; Cloudflare controls challenge visibility. Selector retains native accessible/keyboard behavior with matching12pxtext/chevron edge insets and system control in forced-colors. Local screenshots independently inspected.

## 2026-10-13 — Conversation storage and contact handoff redesign

Operator requests a design review while testing the app: first-contact email-type messages become conversations, participant-specific conversation grants, independent copies per user and cold-object storage with active Durable Object promotion. Smart design and independent review agents assigned nonoverlapping proposal/review files. Existing implementation uses shared epoch conversation secrets and account-local conversation metadata; current shelving does not include conversation rows. Proposal must reconcile protocol versions, canonical ordering vs recipient custody, admission/fanout/quota, generation-fenced warm/shelf recovery and browser/PWA protocol-handler feasibility. Canonical signed HTTPS contact endpoints remain the baseline; same-provider signed-in/signed-out/new-account and external-provider/app handoff flows require explicit, capability-safe continuations. This checkpoint records design work; no runtime migration, spec version publication or deployment has been performed. Existing implementation authorization remains in effect; a concrete reviewed design should guide later changes. Architecture/security reviewer ___ / Date ___ / Outcome ___.

Additional operator requirements: edits retain transparent immutable history; sender deletion leaves a marker and recipient can inspect content already received. Recipient-owned local erasure and account retention remain separate. Typing/activity heartbeats, presence/status and read receipts are optional sharing signals, distinct from private read state and durable delivery acknowledgements; privacy/TTL/abuse policy must be explicit. Reactions are included as bounded authenticated conversation mutations. Designer and independent reviewer informed; proposal/review and decision reconciliation pending.

Federation correction during review: operator challenged an assumed per-conversation coordinator because participants should routinely use different providers. A provider-local actor can serve federated calls, but an online canonical sequencer remains an availability/control dependency. Reopened design and independent review to compare coordinator-based ordering against independently writable owner replicas, signed immutable events and durable sender-side fanout without a central sequencer. Local DO partitioning must not be part of the public contract. Partition-time ordering, membership/revocation and delivery guarantees must be stated honestly; prior proposal/review do not certify this revised architecture. Protocol/federation reviewer ___ / Date ___ / Outcome ___.

Credential/peer-policy steering supersedes the proposed admin-roster chain: operator leans shared conversation secret plus identity-signed interactions and locally accepted participant whitelist, with all peers able to propose changes and asynchronous participant acceptance. Compare this against initiator-issued per-party credentials and alternatives before fixing the interface. Genesis signature seeds a conversation; it must not silently install a permanent administrator. Local acceptance is directed and cannot consent for other peers. Sender fanout snapshots only its accepted destinations; each recipient independently authorizes display/history/storage. Secret possession alone never establishes identity or approval. Pending/quarantined traffic, secret rotation, partitions, history sharing and no-force-store budgets need exact contracts. Both agents instructed to supersede prior centralized/admin assumptions and re-review this latest model. No implementation or production changes performed.

Identity/discovery decisions from operator: provider manifest advertises directory_url; GET uses one full public handle encoded via handle query, returning stable identity/identity-document information. Host-level manifest remains user-independent; numeric and paid aliases resolve the same UUID. URL userinfo is not a user path. Associated external email addresses are private associations, not public directory aliases. Identity document should contain only necessary public identity/key/protocol metadata, not avatar, real name or bio. Optional contact-scoped profile disclosure reuses existing global discloseToContacts (defaultfalse) intersected with per-link profileFields (defaultempty); revocation/quarantine/expiry and owner field limits remain authoritative. OAuth app-profile permission is distinct. Existing public key endpoint is conversation-specific and can lazily establish keys for active legacy records; generic identity discovery must be read-only over established assigned keys. Proposal/review being finalized; no generic identity endpoint or v2conversation runtime is yet published. Discovery/privacy reviewer ___ / Date ___ / Outcome ___.

Conversation redesign recommendation finalized provisionally in [proposal](docs/architecture/conversation-contact-design.md), independently cross-reviewed in [review](docs/release/conversation-contact-design-review.md). Latest user steering supersedes the earlier single sequencer/admin chain: independent owner replicas with a shared conversation secret plus independent actor signatures and directed local approvals. Signed proposals are individually accepted; no required creator-online/admin authority or instantaneous global whitelist/rotation is claimed. Owner-local actor granularity is an implementation choice; cold storage uses bounded segments, verified checkpoints and durable writer fencing. Message mutations preserve transparent histories and sender tombstones; local erasure is independent. Optional presence/typing/read receipts default off, reactions durable and bounded. All features belong to a versioned public conversation resource contract over existing Bindle RPC and grants.

Canonical HTTP contact links retain machine negotiation and explicit composer flows across same-provider sessions/signup/external accounts. Browser/PWA enhancement uses web+bindle with HTTPS fallback, native bindle only where native apps register it; secret capabilities are not nested into handler URLs. General identity.json discovery follows required directory_url/full-handle lookup, minimal established public keys/identity metadata, and optional contact-scoped presentation. Existing contact-profile disclosure already has global and per-link field controls. No v2runtime, generic directory endpoint, identity document, PWA handler or new contract publication is implemented by this documentation commit. Independent reviewers found no remaining design contradiction after the latest revisions; human reviewer/date/outcome remain blank.

Pending implementation order: finalize canonical wire schemas/proofs/frontiers/errors and exact public contract; implement directory/identity read-only discovery and key continuity; portable replica/approval/fanout vertical slice; durable cold warm/shelf crash recovery; edits/tombstones/reactions and optional signals; contact continuation/handoff; multi-provider interoperability/privacy/abuse/cost validation. Main proof gates include recipient-signed owner-bound ACKs, replay and removal races, bounded unapproved traffic, no retroactive history disclosure, and Node/workerd failure injection. Documentation-only verification: relative links/whitespace checks; no runtime tests or deployment performed.

## 2026-10-13 — Contact-page recipient presentation and owner-bucket archives

Operator requests permitted contact profile details on the link's HTML composer. Frontend now fetches the existing contact-profile representation after live claims, using bounded8KiB/5s/no-credentials/no-referrer/no-redirect transport. Name/bio are literal presentation; recipienthandle remains visible and never retargets from profile identity fields. Profiles remain exact owner/global/link-permission controlled; missing/unavailable profiles do not block composer, revoked links reveal no profile, and stale context cannot overwrite a new target. Existing avatarURL uses an explicit noreferrer/noopener link rather than automatic external requests. Claims/send transport also rejects redirects. New interface copy uses Bab EN/ES;100char names wrap on320px.

Final evidence: fullcore617/617(includes12 isolated lifecycle draft tests outsidemain), focusedstate10/10, actualWorker/fault/retry Chrome3/3, Bab4/4, final localized/maxname Chrome1/1 withsixscenarios. Assetbuild4aedf58b926dd24a28f1 frozen. Independent read-only implementation audit found no new authorization/capability-leak/active-content blocker and attributed evidence accurately. Deployment checkpoint pending; no new profile grants introduced.

Operator's archive requirements incorporated separately into design: coldconversation data and restore metadata live in the owner's bucket with files/messages, protected system namespace and quota, encrypted to the existing recovery encryption public key. Ciphertext download/transfer plus offline restored keys; explicit complete snapshot cut includes accepted hot journals and required restore mappings. Provider retains private keys today, so this is not E2EE. Identity/data migration preserves UUID and key/history continuity, while provider-bound contactURLs/authentication/app/connector access requires explicit reconnect/cutover. Proposal/review remain design-only; no encryption/backup/migration implementation or newdirectory publication claimed. Architecture/crypto reviewer ___ / Date ___ / Outcome ___.

Positive per-link field/global-toggle enforcement remains actual localWorker3/3 evidence. Private walkthrough appendix32 includes the local name-only disclosure screenshot. Updated archive/migration/owner-bucket proposal independently re-reviewed: explicit signed complete snapshot, encrypted segments and system metadata/quota overhead, offline historical erase-frontier limits, no E2EE claim; runtime implementation still pending. Human signoffs remain blank.

## 2026-10-13 — Optional public-handle email bridge

Operator proposes paid-account public-handle SMTP outreach, off by default; header/AI classification distinguishes one-off automated receipts from human conversation requests. Owner rules choose collection, priority and notification behavior; age-based archive/delete plus spam retention requested. Sender invitation must bind an independently verified mailbox/account and wait for recipient acceptance; no email header or model label grants peer identity/admission. Smart design and independent review agents own new proposal/review documents. No inbound Email Worker, DNS/catchall change, classifier execution or actual outgoing email is implemented by this checkpoint.

Primary Cloudflare documentation confirms Clef-flash typed-probability decisions (not a validated spam detector), currently$.038/Minputtokens/nooutputcharge. Inference needs per-account and service spend guards plus evaluation, fixed output labels and no tools/rules from email text. Current rules only match grant/mime/collection with collection/tag/classification/quarantine actions; age, priority and deletion scheduling remain new work. Existing Worker has fetch/scheduled only, and system send binding uses sys.3sln.me roles. Immediate EmailMessage.reply has receiving-domain/DMARC/sender/loop restrictions distinct from delayed structured send. Unknown/disabled recipient generic SMTP rejection is preferred over unsolicited marketing/backscatter; any positive reply requires loop suppression, bounded dedup and provider/authentication eligibility. Paid expiry/disable must fence delayed work without recycling aliases or erasing existing content. Product/security/economics reviewer ___ / Date ___ / Outcome ___.

Public-email bridge proposal and independent review finalized in [design](docs/architecture/public-email-bridge.md) and [review](docs/release/public-email-bridge-review.md). Provisional recommendation: current paid opt-in, finite dedicated intake/mail/AI budgets, deterministic automation receipts, suspectedspam quarantine30days+recoverabletrash7days visibly owner-configured, and pending personal invitations. Sender mailbox control and chosen identity proof are distinct from email authentication; owner approval does not silently approve an unknown key. One bounded compliant immediate live-event reply; one accepted notice only after proposal-scoped mailbox confirmation/consent. Unknown/disabled/ineligible use generic SMTP refusal rather than unsolicited marketing/backscatter. Raw spoofable headers, Reply-To and AI never authorize. AI labels are advisory, cost-capped; archive/age deletion executes only current owner rules with trustedreceive times. Exact MIME/SMTP provenance, proof/state formats, dedup/crash recovery, classifier evaluation and billing/storage/encrypted backup conformance remain implementation gates. No receivinghandler/DNSroute/newsender/modelinference/actualmail has been added. Human signoffs blank.

## 2026-10-13 — Public page system color scheme

Operator reports light landing vs dark automatic Turnstile mismatch. Frontend assigned native prefers-color-scheme support for landing/public authentication pages, preserving existing light palette and matching dark surfaces/text/form controls/heroillustration/logo/focus states. Keep Turnstile's automatic theme and preserve challenge through preference changes. Scope avoids accidentally placing bright console panels against globally changed light text. Paired desktop/mobile light/dark browser snapshots and contrast/overflow/proof-continuity verification pending; no email design or auth safety gates changed.

Public system-theme implementation finalized: public landing/auth/contact/recovery/MCP pages follow prefers-color-scheme with scoped dark surfaces, native controls, matching on-dark logo and visible focus. Signed-in console retains its existing light palette. Preference switches preserve Turnstile instance/proof; button colors switch atomically to avoid transient low contrast. Independent mobile screenshot review caught and confirmed correction of oversized dark selector arrow; regression now requires12px/no-repeat. Finalbuild dbef6fe47d9aeec3614b; relevant branding/landing/profile3cases and CAPTCHA/theme2cases passed, finaltheme1/1 covers320/1440 EN/ES controls contrast>=4.5, focus, overflow, dynamic preference and console palette/logo. Deployment verification pending. UI reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Guided signup and dedicated receipt/classification budgets

Operator requests one-question-at-a-time signup wizard rather than an overloaded entry form. Preserve mandatory verified contact, terms, credential and downloaded/tested recovery gates; improve progressive disclosure, back/retry/resume, localization and keyboard/mobile/theme behavior. Frontend implementation assigned after frozen theme checkpoint.

Operator also requests per-owner plan-scaled and per-contact-link receipt limits, independently bounded classification, paid opt-in per-link/bridge, and model categories including suspectedspam/conversation/outreach/promotion/verification/codes. Existing receive paths already enforce HTTP ingress, lifetime grant, account quota and combined activity/storage write guards; dedicated receipt limits supplement those. Smart design and independent abuse/economic review assigned; rejection notices must be coalesced and bounded rather than notification amplification. Architecture reviewer ___ / Date ___ / Outcome ___.

Receipt runtime slice provisionally approved: supplemental owner limits in UTC fixed minute/hour/day windows; admitted-new-message attempts rather than accepted-delivery counts. Owner message ceilings free30/300/1000, Paid120/1000/5000, Plus240/2000/10000, Ultra240/2000/10000. Corresponding MiB byte ceilings free16/128/512, Paid64/512/2048, Plus128/1024/4096, Ultra256/2048/8192; contact-parent defaults half. Existing ingress/lifetime/quota/combined activity and physical-write limits may bind earlier; this is not a throughput guarantee. Established authorized matching replay avoids a new debit; downstream failures may conservatively consume admission, with no unsafe refund. Fixed-window boundary bursts remain bounded by other guards. Owner-local durable transaction, bounded parent/state cardinality, no global per-message counter or rejected-attempt writes. Contact invitations and admitted conversation content share the owner allowance; classifier and rejection-alert delivery stay separate pending implementation. Human product reviewer ___ / Date ___ / Outcome ___.

Receipt limiter implemented and independently audited: new portable MessageReceiptBudget supplements contact receipt/conversation invitations and stored conversation events. Atomic owner/local-parent counters, approved plan matrix, confirmed entitlement only,256parent/120KBstatebounds, fail-closed corrupted/clockrollback records, typed429/Retry-After and413unfitpayload. Signed-contact error CORS now uses shared exact route matcher and Vary:Accept. Authorized established replay bypasses new debit and blobwrite; failed downstream remains nonrefundable. Owner snapshot reports messageReceiptAdmission explicitly as admitted-new-message-attempts. Public messaging developer documentation includes defaults/config/retrysemantics; architecture documents retain separate accepted-reservation design. Finalcore628/628 includes12 isolated uncommitted lifecycle draft tests; independentfocused11/11; actualworkerd37/37. Independent audit found no unresolved blocker in this limited scope. Classification/paid per-link opt-in/multilabel results/rejectionsummary delivery remain design-only; no externalmail, model inference, inboundSMTP, DNS or newsender performed. Human signoffs remain blank.

## 2026-10-13 — Neutral dark palette, automatic device QR and public status cleanup

Operator rejects the green dark-page wash. Supersede prior public dark surfaces with neutral charcoal/graphite, neutral text/borders; retain small brand accents and system preference/Turnstile continuity. Frontend owns palette/contrast/screenshots before final wizard publication.

Operator requests phone/TV QR immediately after automatic Turnstile completion, spinner while proof/request/QR are being prepared, widget UI only when provider requires interaction. Implement per-entry one-shot flow, private proof readiness, timeout, cancel/stale-response fences and explicit error retry; retain explicit approving-phone consent and matching-code check. Independent reviewer assigned device delta.

Operator reports Service status footer is misleading. Current modal only displays placeholder service-capability information, with no health/availability probe. Remove its landing-page entry; no real uptime/status endpoint or external status page is introduced. Future status reporting must use actual health/incident data, separately from development readiness. UI/product reviewer ___ / Date ___ / Outcome ___.

Operator requests intentional consumer marketing focused on quickly understood value. Landing now leads with apps/files/choice and three concrete benefits: sign in to compatible apps with per-app access decisions, use included or connected storage, control contact links. Recovery/key-management details stay in setup/security flows; no E2EE, zero-spam, active email-bridge or universal-app compatibility promise is added. Authored crawlable HTML and Bab EN/ES copy must mirror the same benefits; responsive screenshots and layout checks pending with frontend final build.

Device cancellation audit found a real cross-record race: consumed handoff could create a valid session after Cancel. Provisional fix links consumed request to only its issued session hash, cancellation marks/fences owner revision even if target not yet saved, issuance never retries prepared account CAS, and post-save cancellation rechecks perform exact compensation. Successful cancellation requires proven removal/fencing; already issued cookies may arrive but confer no authority after revocation. No new authentication hot-path lookup or blanket session revocation. Legacy consumed requests without linkage cannot claim revoked sessions; bounded cleanup uncertainty must be shown honestly. Independent backend review/race tests pending. Security reviewer ___ / Date ___ / Outcome ___.

Final integrated portal checkpoint: assetbuild1fcee438b80c6a9d365a frozen. Guided method/contact/email/terms/credential signup, pending emailaddress/code orpush delivery screens, existing downloaded/tested recovery gates retained. Native emaildrafts remain browser memory only; password submitted once then cleared; denied browserstorage cannot retain stale private setup. Back/locale/modal/theme preserve relevant inputs, entering wizard focuses heading. Blank/reused CAPTCHA proof cannot submit signup; submitted attempts reset existing widget for a fresh proof, stale callbacks fenced. Pause synchronously cancels KDF/clears local authority/navigates; late credential, encryption, recovery and activation projections are fenced without claiming reversal of already submitted server operations.

Phone/TV now starts one request automatically when private Turnstile proof is ready; spinner while preparing, interaction-only widget, bounded startup timeout and explicit retry. Readiness routes through real #app intent listener (also fixes inherited push-proof event routing). Entry generation/accountcontext/offline/late-response fences, retained private request code, poll-error hotloop prevention, and honest uncertain-cancel messaging. Backend cancellation race fix has independent9/9 deterministic checks; actual localWorker Chrome demonstrates automaticQR then explicit matching-code phone approval to the same account.

Independent frontend/security audit found no unresolved blocker in this scope: own28/28 action/provider checks, inspectedUIstate82/82 and finalfocusedChrome18/18. Coordinator finalcore637/637 (12 unused uncommitted lifecycle model tests excluded from the commit), actualworkerd37/37. Independent desktop/mobile visual checks confirm neutralcharcoal, balancedselector, beneficiarymarketing and no public status-placeholder entry. Browser screenshots includeEN/ES,320/1440,light/dark, all signupsteps and localWorker TVhandshake. No production account, message, email or modelinference was created by these localchecks. Deployment/CI finalverification pending.

CI investigation: latest mainChecks run38472580651 had55/57 browsercases pass and two notification fixtures timing out on disabled controls under Linuxnativepermissionstate. Core/Worker/DOM/build checks passed. Make fixturepermission explicitlydefault beforebootstrap; retain actual denied/unsupported checks and old-service-worker no-false-proof/no-permission-call assertions. No forced clicks, skipped tests or weaker production guards. Final LinuxCI proof remains pending on the upcoming commit.

Actual local Worker automatic QR + explicit phone approval and deterministic cancellation races remain separate evidence. Classification/alert sender/SMTP bridge/v2 encrypted archives remain separate pending work; production releaseReady gate remains false.

## 2026-10-13 — Static landing and separate console routing

Operator requests immediate authored landing HTML at `/`, with the account application at `/console`. Frontend owns `index.html`/`index.es.html` static documents, `console.html` application shell, build assets, optional narrow landing enhancement, browser navigation and service-worker migration. Shared Worker/Node HTTP routing now selects the console shell for `/console` and existing contact/device/email/recovery/MCP/Google continuation pages while preserving their public URLs and recovery CSP. Root GET/HEAD with `signin`, `signup` or `return_to` uses a private same-origin307 to `/console` with unchanged query; the redirect never interprets or follows a return target. `/console/` canonicalizes similarly. Plain root performs no account/session lookup or server-side personalization. Exactly one `lang=es` query selects Spanish static HTML; other inputs default English, with no language cookie or Accept-Language variation. Worker assets follow only exact same-origin internal console/Spanish HTML canonicalization; Node's existing file adapter serves those same explicit filenames. Routing tests and independent review pending. Architecture/security reviewer ___ / Date ___ / Outcome ___.

Backend routing verification: shared handler/real Node temporary-file host tests pass7/7, actual localWorker canonicalization tests pass5/5 including console and both generated offline landing snapshots. Successful static root responses are deliberately public,max-age=0,must-revalidate, identical across sessions; console/contact/continuation pages remain no-store. Escaped host branding replaces only the marked static logo contents. Independent routing review initially passed6/6 before the final branding case. A concurrent fullcore run completed642 with637pass/5fail solely from frontend's in-progress offline-generator fixture migration; final integrated rerun remains required after source freeze. No build/deploy performed by backend owner; human signoffs remain blank.

Backend routing final core rerun after the frontend offline fixtures settled: npm test644/644 pass, log `/tmp/bindle-landing-routing-final-core.log`; focused routing7/7 includes literal replacement-character host branding. Prior5fixture failures are resolved in this later run. ActualWorker routing5/5 remains separate evidence. No backend-owned build/deployment; integrated browser/UI verification and human signoff remain pending.

## 2026-10-13 — Conservative100000 account admission ceiling

Operator requests a global cap of100000 free users. Provisional safe checkpoint raises existing SIGNUP_MAX_ADMISSIONS ceiling and portable fallback from1000 to100000, preserving the same durable signup:lifetime-admission key/count. Node now forwards the same environment configuration. This is deliberately lifetime admitted attempts, not concurrent/current-free census: pending/failed/paid/deleted admissions remain charged and upgrades never free slots, so later paid expiry cannot oversell reusable capacity. Existing hourly/daily/network/CAPTCHA gates remain. Invalid configuration and corrupt counts fail closed. True reusable free slots require a separate reviewed billing-expiry/downgrade/import/reservation lifecycle and full-capacity product policy; finite sharded leases are documented as a later optimization, not introduced now. See [capacity semantics and migration gate](docs/architecture/free-account-admission-cap.md). Before asserting total service population coverage, inventory/debit any older account cohort not covered by the original counter; no production inventory or reset is performed. Focused admission tests6/6 passed before final strict-type extension; fullcore pending. Product/security reviewer ___ / Date ___ / Outcome ___.

Admission-cap implementation verification: strict final focused7/7 passes, including actual Node signup with environment cap1, explicit config override2 and preserved durable stock across restart. Concurrent final-slot, corrupt/configtype and lower-limit checks pass. Fullcore647/647 passed before the added Node integration case; final test-inclusive rerun in progress. The implementation does not free slots on billing or deletion and does not reset the existing counter. No production counters, account data, build or deployment changed.

Final cap-inclusive core run648/648 passes (`/tmp/bindle-admission-cap-final-tests.log`), including Node restart/config precedence. Independent cap/economics cross-review assigned separately; human signoffs remain blank. No production capacity/baseline reconciliation was performed.

## 2026-10-13 — Free-account funding sensitivity

Operator requests a 100,000 free-user ceiling and monthly/yearly exposure. Existing durable admission stock is conservatively capped at 100,000; pending/failed setups and accounts later paid/deleted retain admission charges. No automatic slot reuse or counter reset is introduced. This upper bound requires any older/imported retained accounts to be included in the baseline; it is not a live free-account census. Full active free-slot reuse remains a separate lifecycle design.

Coordinator added [funding sensitivity](docs/architecture/free-account-cap-costs.md) and reproducible offline [calculator](scripts/free-account-cost-model.mjs), using primary Cloudflare rates verified today. At 100,000 full 500 MB quotas, single-copy logical payload is 50 TB: approximately $750/month or $9,000/year in Standard R2 storage alone before shared allowance. Explicit low/moderate/full-and-high-activity hypotheses total about $56/$455/$3,406 per month; none is a measured forecast or invoice ceiling. Existing 10M combined activity/write units, semantic membership/spend estimates, signup throttles and actor shelving are distinct controls. Read/anonymous traffic, fanout, SQL/index bytes, actor awake duration, replicas and notifications still prevent a proven all-in spend maximum. Recommend a funded 10,000-account review milestone before approaching the authorized ceiling; no lower cap imposed without operator direction. Product/funding reviewer ___ / Date ___ / Outcome ___. Independent review pending.

## 2026-10-13 — Public machine-readable contract registry

Operator reports unresolvable artefact links and contract identifiers serving prose. Add an explicit catalog of five existing RPC contract JSON Schemas and a separately labelled conversation-v1 submission schema. Generated `/artefacts/contracts/` registry and `index.json` point directly to unchanged machine JSON; canonical extensionless identifiers return JSON even with browser HTML Accept. Exact `.json` and older source/raw aliases resolve identical bytes, with public CORS, bounded methods and no account lookup. Existing documentation links/nav and agent index point to the registry/direct definitions. Proposed v2 and superseded automation fixtures remain unpublished; build removes stale artefacts outside the allowlist. Machine definition `$id` is checked against the catalog at build time. Shared/temp-publication tests7/7 passed; actualWorker canonicalization tests running. No frontend build/deployment performed by this owner. Protocol reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Revised signup cohorts and system contact direction

Latest operator direction supersedes the first 100,000-only free admission proposal: free-origin signup admission stock is 10,000; overall signup admission stock (including paid) is 100,000. One existing durable authority must atomically migrate and maintain both counters without reset, with old stock conservatively seeded into free-origin stock. Paid pending setup bypasses only free-origin capacity and cannot activate until live verified subscription proof plus existing credential/contact/terms/recovery gates. When free capacity closes, offer paid signup and email-confirmed waitlist; when global capacity closes, both signup paths stop. Authoritative stale-form errors are separate from bounded cached public availability. This caps cohorts, not current free users after paid-origin subscription lapse. Implementation/review underway; human product signoff ___ / Date ___ / Outcome ___.

Operator replaced the unshipped developer feedback form with a contact token for the protected developer identity. The form/service/mail implementation was removed before commit/deployment; its review is historical. Reserve internal handles and render a trusted platform/system badge; provide a generic operator-issued bootstrap for system accounts, not a Ray-only path. Latest access threshold is below 1,500 active users for everyone, otherwise paid users only. Active-population definition and exact Ray provider identity remain explicit user clarification gates.

Operator then simplified contact issuance: users explicitly request a contact token, granted for the current day with a clear refusal reason otherwise. Eligibility is checked at issuance. They explicitly withdrew eligibility-loss revocation; do not introduce ongoing billing checks, per-message policy lookups or reconciliation of permanent developer links. Daily expiry plus ordinary recipient revocation/rate controls suffice. These latest instructions supersede the prior automatic/permanent contact and non-resurrection design. Architecture/implementation review pending; human signoff ___ / Date ___ / Outcome ___.

## 2026-10-13 — Separate free/overall signup stock, paid setup and confirmed waitlist

Supersedes the earlier single100000/free-user interpretation: preserve the existing global admission authority and count, atomically add a free-origin cohort count initialized conservatively from legacy global admissions. Overall limit100000; free-origin limit10000. Free attempts debit both; paid-pending attempts debit only overall, with additional5/hour25/day paid admission guards. Failed/pending/deleted/expired-paid admissions are never refunded. This is lifetime admission stock, not current-free occupancy; paid-origin accounts retain the existing eventual free fallback. Pre-counter production inventory reconciliation remains a release gate.

Public `/api/signup/status` is a bounded advisory read, with one original60second expiry shared across memo/edge/public cache layers, no visitor-dependent cache keys and no identity bootstrap. Stale forms receive authoritative `signup_capacity_reached`503 with free/global distinction and no invented reopening deadline. Paid setup keeps immutable plan/incarnation and a24hour checkout-start deadline; the reviewed catalog price digest, exact UUID/customer/product/organization and setup metadata bind one durable checkout lock per owner regardless of caller request ID. Unknown provider outcomes cannot auto-create another checkout. Current exact-plan active or canceled paid-period proof, verified contact, primary credential and tested recovery are required before first owner session; permanent paid history, provisional upgrades and past-due grace do not activate pending accounts. Existing active-account recovery remains independent of signup capacity.

The shared Worker/Node waitlist uses1000pending/10000joined limits,10minute explicit mailbox-confirmation POST,180day membership, encrypted email/HMAC indexes, separate deletion-only withdrawal proofs and bounded32-row cleanup alarms. IP/subnet/target/global work/mail controls precede durable admission; the mail attempt is claimed before external delivery and ambiguous sends are not retried/refunded. Joined-address management can recover deletion access without extending retention. Mail GETs never subscribe, waitlist membership creates no account or reserved slot, and no automatic invitation campaign is included. Existing verified system mail adapter is reused; tests send no real email.

Implementation/design: [signup capacity and setup boundary](docs/architecture/signup-capacity-paid-waitlist.md). Local initial full core669/669 passed before final additional boundary tests; focused paid/capacity/waitlist24/24 passed. Final full-core and independent review pending. Human product/security reviewer ___ / Date ___ / Outcome ___.

Independent review found and fixed a preactivation paid-recovery bypass: a downloaded recovery file could change pending to recovering before payment. The durable initialPaymentRequired marker now survives that transition and is cleared only with successful paid activation. Added exact exploit and already-activated/lapsed recovery regressions; focused paid6/6 passes. Independent recheck and final core rerun pending. Reviewer ___ / Date ___ / Outcome ___.

Independent paid/capacity/waitlist review reran26/26 focused tests and the original recovery exploit; it now returns payment_required without a session. The first-activation marker also preserves recovery after later subscription lapse. No further structural blocker reported. Expired ready-checkout URLs and provider-unknown attempts deliberately require explicit operator reconciliation; a free status does not safely authorize replacement or reset. Final npm result pending. Human reviewer ___ / Date ___ / Outcome ___.

Final paid/capacity/waitlist backend checkpoint: `npm test` passed674/674 in `/tmp/bindle-paid-waitlist-reviewed-core.log`, including the paid-recovery correction and Node alarm restoration. Independent focused26/26 and exploit recheck passed; review records no remaining backend blocker in [signup/waitlist review](docs/release/signup-waitlist-review.md). Registry separate shared7/7 and real Worker2/2 evidence remains in its review. Frontend/build/provider integration is a separate coordinator checkpoint; no production purchase, email, deployment or counter reset occurred. Human reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Owner Views and unified incoming projection

Under the latest unified-store instruction, the reviewer/architect implemented the first reversible backend slice described in [message Views](docs/architecture/message-views.md): saved owner Views with revision-checked edits/deletes; typed indexed `/api/incoming` queries; normalized tag indexes; authenticated owner/filter/View-bound cursors that report `cursor_stale` after index changes; bounded legacy backfill. Existing collection partitions and app/MCP authority remain untouched and independent of saved filters. No message body/archive scan or AI work is used by metadata filters. View deletion never deletes retained content.

Retained conversation event messages project to one source/room card with stable ID, first/latest retained times, any-event unread state, latest-event tags/classification and retained event count. Empty/no-delivery rooms remain in the existing conversations API; invitations remain incoming messages. Room-level tag/read mutations, destination-free frontend and new public contract publication are not claimed by this slice. Added metadata indexes consume SQL/storage overhead; bounded grammar/page size does not imply constant SQL rows read.

Focused Views+scaling30/30 and full core698/698 passed (`/tmp/bindle-views-focused.log`, `/tmp/bindle-views-core.log`). Actual Node route checks cover session, Origin, CSRF, allowed methods, strict parameters and stale revisions. Other concurrently owned changes/known lifecycle drafts in the full suite remain independently scoped. Root source cross-review and integrated Worker/browser checks pending; no build/deployment/provider mail was performed. Human product/security reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Generic protected system identity bootstrap

Implemented the provisional [system identity invitation design](docs/architecture/system-identities-contact.md) and [operator runbook](docs/architecture/system-bootstrap-operations.md). A separate HMAC key authenticates exact origin, purpose, protected handle, role, stable owner/assignment, nonce and at most seven days of validity. An optional pinned email applies through initial activation, including preactivation recovery. The ordinary credential, verified contact and downloaded/tested recovery gates remain mandatory. The projected system/developer badge grants no administrative authority.

Node and Worker reserve the permanent alias and setup browser before creation, deduplicate the overall-only admission debit with a durable nonce/full-claims receipt, and verify the immutable provenance marker on account creation and updates. Concurrent requests create one owner. Lost acknowledgements never reset namespace ownership or issue fresh setup credentials from a consumed invitation; unfinished passkey setup can require explicit operator reconciliation. Existing assigned/tombstoned names are not overwritten. Expiry is checked again before account creation after credential work. The internal system admission lane is unavailable through public signupPlan.

The private CLI writes exclusive 0600 key/invitation files, rejects symlinked or publicly readable key inputs and emits no secret stdout. No actual provider secret, invitation or production identity was provisioned. Frontend import and provider deployment remain separate coordinated work.

Final focused bootstrap14/14, actual Worker bootstrap1/1, and full `npm test`701/701 passed (`/tmp/bindle-system-bootstrap-final-focused.log`, `/tmp/bindle-system-bootstrap-final-worker.log`, `/tmp/bindle-system-bootstrap-full-core.log`). Tests cover both durable adapters, crash acknowledgement ordering, concurrent/replayed/copy-browser use, unsafe file handling, protected-name conflicts, preactivation email/recovery and no session before setup. Coordinator/independent source audit remains a separate gate; local injected transports do not prove real mail or provider delivery. Human security/product reviewer ___ / Date ___ / Outcome ___.

## 2026-10-13 — Actual recent-activity source for daily developer contact policy

Implemented the provisional [active population source](docs/architecture/active-population.md), using authenticated owner use within 30 days as the working definition of active and 1500 as the issuance threshold. This is distinct from overall/free-origin signup stock. Thirty-two existing AbuseGuard actor names store unique-owner expiry-day rows and small aggregate buckets; confirmed daily owner metadata suppresses repeated source calls before the existing 15-minute activity coalescing return. No message ingress, typing heartbeat, public counter or receipt-time developer entitlement check was added.

A bounded 100-account census with durable minute alarms initializes existing identities and merges concurrent newer activity. The source returns unavailable until completion; it does not invent a zero baseline. Legacy 15-minute activity uncertainty adds a conservative temporary allowance, and unknown historical activity is counted conservatively. Completed baselines pin shard generations. The policy cache expires absolutely after 60 seconds. Node restores the census alarm; Worker reuses the existing class/bindings and scheduled hook.

Coordinator review rejected coupling optional metrics failures to authentication. The final implementation preserves pending daily activity, attempts rare-source invalidation, backs off retries, and keeps normal login/read/recovery available. Known failures suspend permissive population snapshots until reconciliation; partitions that prevent both recording and invalidation can temporarily lag the observed count. This is a growth-policy metric, not an instantaneous security ceiling. Recent lifecycle changes can conservatively age out rather than immediately subtract. These limitations and the still-provisional product definition are explicit in the architecture document.

Final population/work-audit focused19/19, actual Worker population1/1, and `npm test`710/710 passed (`/tmp/bindle-active-population-focused-final.log`, `/tmp/bindle-active-population-worker.log`, `/tmp/bindle-active-population-core-final.log`). Node restart, interrupted census, concurrent merges, bounded state, expiry, clock rollback, corruption, shard replacement and nonblocking failure paths are covered. No production census/account mutation, build or deployment occurred. Coordinator source audit and integrated issuance/UI remain separate gates. Human product/security reviewer ___ / Date ___ / Outcome ___.


## 2026-10-13 — Messages, conversations and Views: product model confirmation

User explicitly confirmed that there should be no user-facing inbox containers: retained messages/conversations belong to one logical incoming store, and configurable Views are filtered projections. Views may overlap, and deleting a View does not delete its items. Contact required/optional tags and owner rules supply organization. Existing collection authorization partitions remain a compatibility detail until a separately reviewed migration; editing a View never broadens app or agent authority. Public messaging/contact drafts now distinguish this model from their retained legacy APIs. Frontend migration and conversation-card read/tag persistence are being independently reviewed; completion is not claimed by this log entry.

User direction confirmed in conversation. Implementation sign-off: reviewer ___ / date ___ / outcome ___.

Views follow-up: root review identified latest-event tags as an organization-loss risk. A persistent owner conversation overlay now carries tags/classification and revision independently of event arrivals/deletions; it survives an empty retained history and later replies. `PATCH /api/incoming` requires organization revision, and mark-read additionally requires the displayed activity revision. A local arrival-order watermark prevents later/equal-timestamp replies being marked read by a stale action; it emits no shared receipt or legacy event rewrite. Unshipped builtin `inbox` is replaced by `all` / All messages. Frontend received exact fields. Focused Views10/10 pass in `/tmp/bindle-views-persistent-final.log`; integrated core rerun underway. Persisted overlays and event sequence mapping are owner configuration/read state and must be included by future complete export/restore, not discarded as reconstructible indexes.

Independent active-population audit found an optional RPC could hang owner use despite caught errors. Designer bounded touch/invalidation waits while preserving durable pending retries and uncertain-commit idempotency; independent focused11/11 pass in `/tmp/bindle-population-independent.log`. Absolute cache leases, initial/generation baseline gates and double-partition lag are documented honestly in the [review](docs/release/system-identity-contact-review.md). No remaining narrow blocker; product active-definition and production baseline approval remain blank. Reviewer ___ / Date ___ / Outcome ___.

Population independent review follow-up: stalled optional RPCs are now bounded to 250ms for recording and at most a further 100ms for invalidation. Timed-out idempotent work may still commit; pending retries remain durable. An unrelated earlier account alarm now re-arms a future pending retry instead of losing it. Independent focused11/11 passed after both corrections, with no remaining narrow source blocker reported. Product definition and first production baseline remain unsigned.

## 2026-10-13 — Daily developer-contact grant audit and crash-safe deduplication

Independent implementation audit found two blockers in the new issuance-only helper: the internal day/tier pointer could be overwritten by concurrent grant creation, and a committed parent with interrupted endpoint/URL finalization could become permanently unusable. Fixed the existing contact hooks so pointer reuse atomically checks its exact binding and unchanged scope, mandatory/optional tags and limits; concurrent requests reuse one parent. Endpoint completion preserves existing audience/claims/quarantine, and URL persistence keeps the first committed encrypted signature. A crash before completion resumes that same parent. Revoked daily grants are not replaced.

Expired internal-grant cleanup checks owner/id and removes a pointer only when it still references that parent. Ordinary contact grants, already received messages and receipt records remain intact. The route derives recipient, beneficiary and tier from trusted server context; caller-supplied recipient/tier fields are rejected. Fresh confirmed base entitlement excludes provisional upgrades, past-due state and expired/stale proofs. Eligibility is checked only for issuance: the daily bearer remains usable under normal contact limits until expiry/manual revocation, without a new beneficiary payment/population check on receipt.

New developer-contact focused9/9 passed; combined contact/endpoints/tags/population focused36/36 and full `npm test`723/723 passed (`/tmp/bindle-developer-contact-audit-focused.log`, `/tmp/bindle-developer-contact-audit-core.log`). Tests use local durable metadata and injected storage, with no production account or external message. Coordinator final source review and integrated Worker/browser validation remain separate. Human security/product reviewer ___ / Date ___ / Outcome ___.

Final Views correction core checkpoint: npm test723/723 passed, exit0, `/tmp/bindle-views-population-final-core.log`; focused Views10/10 and independent population11/11 pass. Source remains frozen for coordinator cross-review and frontend integration. No publication or provider verification claimed. Human reviewer ___ / Date ___ / Outcome ___.


## 2026-10-14 — Interactive message forms/actions: design and security spike

User proposed restricted forms in messages, button-only notification actions, credentialless submissions with optional account signatures, and postback updates retaining visible message history. This is design/spike work, not an authorization to loosen the existing renderer policy before review. Three independent tracks are examining action semantics, renderer/credential threats, and a controlled browser spike. The current frozen app/build remains unchanged by this experiment.

Provisional direction: declarative actions executed by trusted host code; no sender scripts or native uncontrolled form submission. An action result is separate from a conversation reply unless explicitly declared. Postback appends a local presentation revision and preserves the original and prior states; it cannot mutate shared conversation history or expand grants. Shadow DOM may scope message styling inside an isolated renderer, but is not the security boundary. Remote resources are blocked by default, with a separate deliberate user decision; author CSS must not style trusted recipient/identity consent controls. Target, action, message revision, fields and any optional identity signature are bound together and revalidated before dispatch. Unknown delivery outcomes require reconciliation rather than blind repeat execution.

Open decisions include exact endpoint trust/delegation rules, inline control rendering, signature encoding/reuse of existing protocols, and which notification actions may execute directly. See forthcoming [action design](docs/architecture/message-actions.md), [security review](docs/release/message-actions-security-review.md), and [controlled browser spike](docs/release/message-forms-browser-spike.md). Human architecture/security sign-off: reviewer ___ / date ___ / outcome ___. No form support, postback deployment or cross-browser security guarantee is claimed here.


User refined the pipeline: sanitize into an inert fragment, traverse it to enforce policy/install controlled form handlers, then mount; native `setHTML()` requires an Element/ShadowRoot context, with template content under browser investigation. Detached parsing alone is not accepted as a network-suppression guarantee. User also requires an unavailable-native fallback: provisionally a lazy, pinned, self-hosted DOMPurify module behind a local adapter, followed by the same form/URL/resource/CSS validation. It must not silently substitute raw `innerHTML`; failed sanitizer loading yields a readable safe text view with actions disabled. Browser spike and independent review are incorporating both refinements; the existing application renderer is unchanged.


User clarified notification/result behavior: derive concise notification text/actions from each message; selecting an action opens the message and displays a submitting state. Successful local postback appends an edit/history revision; a redirect or a declared `_blank` postback opens a new tab; ordinary success/error produces a bounded status toast. Design agents are aligning the proposal and review with this flow. Redirects are captured as validated navigation intents, never automatically followed with submitted fields/capabilities/signatures, including 307/308. External navigation is a distinct browser visit and may use that site's ordinary cookies; cookie-free form transport remains mandatory. New-tab HTML results require the isolated sanitized viewer, never unchecked HTML in a privileged top-level app document.

Notification extraction will favor validated explicit summary/action metadata, then conservative plain-text title/heading/body fallbacks. Actions must map to validated supported form/action bindings rather than inferred arbitrary links; field values, hidden markup and credential material are excluded. Direct notification clicks open foreground review/status; browser action support is feature-detected. This is a provisional deterministic heuristic, not permission inferred by AI or a claim of comprehensive CSS visibility analysis. Sign-off remains with the linked message-action proposal/review.


Coordinator reconciled the proposal and independent review. The controlled Chrome 155.0.8059.80 spike passed 11 checks: custom native sanitizer retained forms/styles while removing scripts/handlers; `template.content` staging made no observed requests before insertion; a detached live-document element did request an image before traversal; Shadow DOM alone allowed overlay/network behavior; the isolated CSS-enabled frame clipped overlays and denied remote/native submissions; credentialless fetch omitted seeded cookies, ignored Set-Cookie and refused redirect following. Evidence is scoped to the fixture and installed Chrome, not the complete interactive renderer, DOMPurify fallback, OS notifications, broker SSRF isolation, signatures or cross-browser conformance. Independent design review found no remaining structural blocker; product/security sign-offs remain blank. No application runtime, frozen build or production release was changed by this design/spike.


## 2026-10-14 — Ordinary identities for application senders

User requires messages, including application messages, to be signed and notifications to identify the verified sender handle/application with an icon where available. Preferred direction: an app uses an ordinary Bindle identity (stable identifier, handle/aliases, provider discovery/directory, signing keys and optional shared profile), rather than a separate app-only sender/key registry. App connections remain user-owned resource/grant records, distinct from the application's sender identity; one app identity can have many users' independent connections. Apps may use an existing provider; each app need not operate its own directory service.

Provisional permissions model separates authenticated sender identity from recipient-issued delivery authority. Login never automatically permits messages. A recipient can issue a sender-bound, limited/revocable contact grant, visible as a messaging permission in Connected apps, without placing a raw capability into a shared preferences fragment. Generic identity block controls apply to apps and people. Every authenticated notification derives sender labels from verified message provenance and approved profile data, not sender HTML or arbitrary senderMetadata. Names/icons are descriptive; the verified handle/domain remains visible.

Frontend-only apps cannot safely keep a global app private key. A generic explicitly enrolled/delegated signer or verifiable connection provenance must preserve the real actor/delegator; a public client ID, registration or recipient consent cannot authorize signing as the application's global identity. Signed-message migration needs a versioned envelope and must not relabel legacy unsigned records, bridged email or receiver attestations as original-sender signatures. These points are being independently reviewed in the sender-identity proposal/review; no runtime signing enforcement or sender directory deployment is claimed.

Notification resource policy also needs local cached bounded raster avatars or a neutral fallback: the Notifications standard specifies credential-including resource fetches, so direct sender-controlled icon URLs can undermine privacy even when form dispatch uses omit. Human architecture/security sign-off: reviewer ___ / date ___ / outcome ___.


The [ordinary sender identities proposal](docs/architecture/message-sender-identities.md) and [independent review](docs/release/message-sender-identities-review.md) are now complete as provisional designs. The [message actions proposal](docs/architecture/message-actions.md) has been reconciled with the identity/signature model. Independent cross-review found no structural blocker, including the distinction between app-owner signer delegation and recipient consent, authority/key-qualified stable principals (foreign providers cannot impersonate by claiming the same UUID), and private per-connection delivery bindings. No public profile/envelope artifact, runtime sender enforcement or notification-branding implementation was introduced by these documentation changes. Human signoffs remain blank; cryptographic schemas, migration and durable/cross-provider conformance are explicit implementation gates.


## 2026-10-14 — Browser app notifications use app connections, not contact identities

User refined the app-messaging direction after considering public frontend clients: app notifications are domain/application-bound, invoked through the Bindle SDK, with no contact link/token. This supersedes the previous ordinary-app-identity/delegated-signer requirement for this browser-originated owner-notification path. Ordinary federated identity messages retain their separate author-signature and recipient-admission model; backend apps may still act as identities when appropriate.

Provisional architecture reuses the owner's approved app-connection/resource/RPC grant with an explicit create-own-notification method. Recipient, app identity/client, canonical exact origin and trusted presentation derive from the provider's immutable approved binding and live token/grant; caller fields cannot select another sender or recipient. Messaging is a separate consent, not a login side effect. No raw contact capability or app-held global signing key is needed. Host-signed stored provenance records prove what the provider admitted under the connection, not a publisher's independent cryptographic authorship.

Browser protection requires server-side matching of the browser-controlled Origin to the exact app origin bound to that token before any effect, strict CORS, and rejection of absent/null/wrong origins for this profile. The existing general federation endpoint's missing-Origin/provider-origin exceptions are not sufficient and must not carry into this method. SDK code loaded into another website runs under that website's origin; a legitimate cross-origin app iframe retains its own origin, and the parent cannot override it through ordinary browser JS. Cross-frame message handling must not become an unauthenticated notification relay.

This is browser-origin isolation, not remote code attestation: public client identifiers, headers from nonbrowser HTTP clients, copied bearer credentials, and DPoP do not prove the application's publisher authored a message. Capability remains owner/connection limited; verified service assertions need a separate authenticated workload/identity path. The designer/security reviewer are reconciling these guarantees and supersession notes; no notification SDK method/runtime gate is implemented by this log entry. Human architecture/security sign-off: reviewer ___ / date ___ / outcome ___.


Final provisional [app notifications design](docs/architecture/app-notifications.md) and [independent review](docs/release/app-notifications-review.md) are recorded. Earlier sender/action proposals explicitly distinguish this superseding browser path from signed federated sender identities. SDK `notify` is a convenience over one exact owner-local resource method/grant, not an alternate transport/authority system. Toggle changes cannot widen previously issued token scopes; fresh explicit grant acquisition is required. Finite receipt/outbox state preserves unknown outcomes without inventing a second operation. Source review confirmed browser-origin gates are missing from the existing general RPC exceptions, so this profile is not currently implemented. Cross-review found no remaining structural design blocker; browser/Node/Worker validation and human signoffs remain open. Documentation-only work; no runtime, build or production changes.

## 2026-10-14 — App messages and credentialless form results implementation checkpoint

The implementation supersedes the preceding documentation-only checkpoint: SDK `userMessage` uses the owner-local `app-messages/v1` contract, with explicit consent, exact browser-origin checks, provider-signed admission provenance and the automatic `app-message` delivery tag. SDK input has no action descriptors; ordinary HTML forms and marked links supply renderer-derived actions. Public contract and preference JSON are included in the curated registry.

The prepared form broker separates authenticated owner review/preparation from cookie-free dispatch. Purpose-bound short-lived MAC verification precedes actor routing; dispatch rechecks live account/app authority, consumes its capability and persists pending intent atomically. Unknown network outcomes are not silently retried. Optional transport defaults to disabled until destinations are operator-approved. Only original verified app HTML has submission authority; owner-local result revisions cannot inherit the original signature. Node transport pins public DNS resolution; Worker transport uses strictly public routing plus DNS screening, which is not connection pinning. Full backend suite passed 793 tests before the added toast-link test; final independent HTTP and browser integration gates remain pending.

User approved links in custom submission-status toasts. `application/vnd.bindle.submission-status+json` permits a bounded plain-text status and at most two labeled HTTPS navigation links, with no callback or follow-up form semantics. HTTP failures remain failures regardless of the declared status. The console must show destinations and open links in isolated new tabs. Non-HTML/empty responses do not overwrite message bodies. Frontend typed-toast rendering, result viewer and integrated browser verification are still in progress; no deployment is claimed here.

Architecture/security sign-off: reviewer ___ / date ___ / outcome ___. Product/browser sign-off: reviewer ___ / date ___ / outcome ___.

Independent actual HTTP-to-SQLite review added five regressions and found no remaining broker blocker: private identity epoch at preparation, cookie/Origin/MAC/body guards before actor access, recovery/inactivity/local-presentation refusal, retained replay and bounded toast links. Full working-tree core suite now passes **800/800** (`/tmp/bindle-postbacks-http-audit-core.log`, including 12 pre-existing isolated lifecycle draft tests outside the intended commit); focused broker plus HTTP checks pass **24/24**. The historical cookie-authenticated dispatch gap is closed in source and tests, as recorded in [the independent review](docs/release/message-actions-security-review.md). Browser CSP, cancellation and actual console interaction remain distinct gates. Node hosts now accept a code-injected transport port without weakening their default DNS-pinned network adapter or accepting a transport through JSON configuration. Private key-generation checks passed permissions, signature verification, public-only export, quiet output and refusal to overwrite existing files; no production key was provisioned by those temporary-fixture checks.

Browser integration found two boundaries requiring concrete changes: inherited page CSP requires an external hashed renderer controller, and a global vendor sanitizer imported shared chunks incompatible with an exact script allowlist. The sanitizer is therefore a separate standalone js-tools bundle with no imports. Only the two exact hashed script URLs are permitted by the opaque frame's CSP; narrow static CORS serves those public assets. Parent console CSP permits self frames, while the actual message frame retains no `allow-same-origin`, native forms, author scripts or remote-resource permission.

The isolated result tab exposed a cross-window messaging distinction: a callback created by the console still sends from the console realm when manipulating a popup-owned iframe. Replacing the child `source === parent` initialization condition requires an equally explicit binding, rather than accepting arbitrary messages. Provisional approved direction: a cryptographically random 256-bit per-mount nonce in trusted bootstrap metadata, one-time nonce and exact provider-Origin validation before accepting the single transferred port, with provider Origin derived from the trusted controller/metadata rather than caller payload. The mounting side still checks exact child Window, opaque Origin and nonce; owner/source/generation checks stay outside the frame. No credentials or owner capability enter message DOM. Independent source review and real-browser wrong/stale initialization tests remain gates. Security sign-off: reviewer ___ / date ___ / outcome ___.

Actual Worker suite passes **46/46** after updating stale contact fixtures to explicitly grant optional tags; unauthorized tags remain rejected and required delivery tags are verified. DOM smoke and **99/99** UI-state tests passed before the final added message-action state suite. A separate production provider app-message signing key has now been provisioned through Wrangler without printing it; only its verify-only public key is in production configuration. This is secret provisioning, not a deployment or claim that app connections/forms are production-enabled.


## 2026-10-14 — Defer fetched-HTML result tabs

User chose to defer the `target="_blank"` result-viewer path and other nonessential surfaces that need deeper specification. This supersedes the earlier isolated-popup and cross-realm initialization plan. Keep the narrow implemented paths: successful HTML postbacks with transparent local history, bounded status toasts with HTTPS navigation links, and reviewed HTTPS redirects to real pages. Authored `_blank` forms cannot submit in this profile. A submitted HTML response requesting a separate tab yields an informational status and leaves the current message unchanged; new `new-tab` presentation writes are refused, while historical entries remain readable. Frontend popup code and its widened initialization surface are being removed; exact parent-window checks remain for ordinary opaque frames. Backend focused checks pass27/27 and full working-tree core passes801/801 (`/tmp/bindle-blank-deferred-core.log`, including the12pre-existing lifecycle draft tests outside the intended commit). Final browser checks remain pending.

Rare form-control names that trigger the pinned sanitizer's DOM-clobber protections will remain unsupported in fallback rendering. Do not weaken or hook the sanitizer to force parity in this release; show explanatory unavailable/omitted-content UI instead of a blank result. Ordinary field names still require actual native/fallback browser verification. Further normalization/interoperability design is pending. Scope/security sign-off: reviewer ___ / date ___ / outcome ___.


## 2026-10-14 — Message content rules and recipient motion policy

User clarified that Bindle specifies observable rules, not which renderer, APIs, or SDK implementations to use. The curated [message content normative draft](docs/spec/message-content.md) defines plain/HTML UTF-8 interpretation, permitted opaque data, safe presentation, privacy, provenance, intentional navigation/submission, retained results and recipient motion controls. Reference-service constraints and the private experimental archive format are explicitly distinguished from universal requirements; no extra RPC contract/schema stub was invented. Independent review: [message content review](docs/release/message-content-review.md).

Motion is enabled by default but recipient/platform reduced-motion choices prevail. Bindle requires a finite recipient-controlled display budget and prevention of delayed/interaction/re-render restarts, without choosing a universal duration or prescribing APIs. Finite effects may settle to a safe terminal state; infinite/unfinishable effects require static fallback. This applies to every supported motion mechanism; disabling styling animation alone is not a claim to control GIF/video.

3sln's implementation uses a browser-local message-animation preference and a five-second styling-motion budget. Those are service policy, separate from the spec. The renderer handles supported effects within its isolated content boundary; after cutoff it removes motion declarations recursively from author styles and inline declarations, with static fallback on unsupported inspection. Source/owner authority remains independent. Independent testing found and corrected reduced-motion/persistence and background/reconnect budget gaps, and verified that animation enumeration must include the closed content tree. Actual controlled Chrome native/fallback plus motion checks pass2/2; independent preference/episode regressions pass4/4; complete UI-state checks pass109/109. Cross-engine and deployment claims remain pending. Protocol/product/security sign-off: reviewer ___ / date ___ / outcome ___.

Full browser run of the preceding build completed78/79; the sole failure was a stale expectation that the message sandbox had no trusted controller script, and its old DOM heading query did not account for the closed content tree. The fixture now checks the opaque `allow-scripts` sandbox (no same-origin/forms permission), directly observes only controlled test content, and retains the author-script nonexecution check. Actual Worker suite46/46, core802/802 (including12pre-existing lifecycle draft tests excluded from intended commit), dependency audit0vulnerabilities, and Cloudflare bundle dry-run passed before the final geometry/motion asset rebuild. Final frozen-build integration remains the next gate.

## 2026-10-14 — Frozen rich-message verification and private-host onboarding direction

Final frozen build `d089927129d93a7c490a` passed main browser76/76 and separate federation4/4, alongside core802/802 (12 unrelated lifecycle draft tests remain outside intended release), Worker46/46 and UIstate109/109. Independent checks established native/fallback motion handling, reviewed credentialless submissions, retained HTML history, redirect/status navigation and honest unknown outcomes. [Walkthrough section36](docs/walkthrough.md) records local screenshots and controlled external-transport limitations. These are not deployment evidence. APP_NOTIFICATION_SIGNING_JWK was securely provisioned without printing its private value; no current source deployment is claimed.

User requested a fixed-account self-host mode: ordinary login remains available with public signup closed; an operator-issued capability lists only its authorized onboardable names and starts the existing credential/terms/recovery flow. Fixed-name admission must remain distinct from platform/system badges and privileges. Existing permanent assignment/tombstone invariants apply. Tokens authorize per-name onboarding, not arbitrary signup, account takeover or recovery. A token-bearing path is a capability whose infrastructure logging risk must be explicit; browser scrubbing and response headers cannot erase a reverse proxy's prior request log. Exact route, credential handoff, expiry, resumability and independently reviewed storage changes are in design. Architecture/security/product sign-off: reviewer ___ / date ___ / outcome ___.

## 2026-10-14 — Contact POST and bearer-RPC delivery candidate

[Wire draft](docs/spec/contact-delivery.md), [architecture decision](docs/architecture/contact-delivery-wire.md), [independent security review](docs/release/contact-delivery-review.md) and [DX review](docs/release/contact-delivery-dx-review.md) separate document delivery from authorship and conversation consent. Both transports use one canonical envelope, body digest, stable operation ID and parent-scoped receipt. Multipart is exactly envelope JSON plus message bytes; RPC carries the same envelope plus canonical base64url bytes. Required tags come from verified grants, optional tags are an allowed selection, and Views remain projections rather than authority partitions.

One-offs carry no reply grant. Conversation initiations carry a creator-signed proposal, protected shared secret, proposed participant identities and a bounded recipient-specific acceptance return capability; receipt does not imply membership. Identity-authored records require author proofs. Anonymous one-offs are an explicit permitted mode with visibly unverified authorship and a provider-signed admission receipt; a provider signature must never be presented as the anonymous author's identity proof. RPC contact credentials are explicitly typed and bound to a single contact resource/method/audience, distinct from legacy inbox JWTs and OAuth grants. Negotiation reuses the contact-token MIME with an explicit profile and rejects legacy token substitution.

The complete candidate schema and signature/digest vectors remain private architecture artefacts; the curated prose explicitly describes proposed rather than implemented behavior. The three fixed-vector checks pass, including re-signature invariance, exact-byte tampering and domain separation. No current runtime or SDK conformance, published contact RPC contract, directory/key-continuity completeness, or conversation-v2 implementation is claimed. Existing public JSON remains unchanged. Earlier legacy prose naming multipart `blob` was corrected to actual `message`. Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___; unsigned decisions do not automatically block development.

## 2026-10-14 — Final private-host names, identity badges and injected resolution

User refinements supersede the earlier name-to-badge mapping and issuer-bound badge proposal. Badges are local UI presentation: the host supplies `{id,name,description,svg}` definitions; the app compiles bounded static SVG into a single content-addressed sprite. The embedder does not need to provide a sprite map. `HOST_NAME_POLICY` now contains only version/reserved/onboarding sets, explicitly replacing defaults when configured. Those sets protect canonical names even when invitation issuance is disabled. Permanent issued assignments survive later policy removal.

The default badge resolver reads mutable identity `badgeIds`, initially selected per name in the signed onboarding token. A code-injected `resolveIdentityBadges` can instead resolve roles or another host-owned policy. Its frozen descriptor excludes credentials, sessions, verified emails and key material. Known IDs alone are projected; a500ms asynchronous deadline or hook failure yields no badges without changing credential authority. Injected code remains trusted host code, without CPU isolation. There is no badge-derived subscription or administrative authority and no new management UI/API in this slice; future tools can manage trusted identity records.

[Host-name/badge decision](docs/architecture/host-name-badge-policy.md), [independent review](docs/release/self-host-onboarding-review.md), and [self-host instructions](docs/self-hosting.md) record the final interface. The compiler rejects active/external SVG rather than silently widening content support, caches one bounded immutable configuration compilation, and changes its content key when mutable input changes. Public configuration contains only badge metadata and the hashed sprite URL; private onboardable names and raw SVG are excluded. GET/HEAD/conditional sprite routes perform no identity access; invalid badge definitions degrade optional presentation while namespace policy remains fail closed.

Actual local Worker evidence now passes the complete two-name flow: closed public signup, purpose-separated issuance, atomic per-name admission (two overall slots, zero free-origin slots), signed initial badge IDs, no implicit system identity, invitation replay refusal, credential-based pending resumption with rotated setup cookie, recovery activation and normal alias sign-in. The fixture initially retained its old setup cookie after credential resumption; honoring the deliberate cookie rotation fixed the test without weakening runtime binding. Independent backend audit8/8 and final UI-state122/122 pass. Full integrated core/Worker/build/browser gates remain in progress. Human architecture/product/security sign-off: reviewer ___ / date ___ / outcome ___; this is not production provisioning evidence.

## 2026-10-14 — Verified onboarding/message checkpoint; multi-account work queued

Frozen public build `d0894d61d7781b92e3cf` passed the complete browser gate78/78 plus fresh federation4/4 (82/82), actual Worker47/47, UI-state122/122, DOM smoke and Cloudflare bundle dry-run. Latest core838/838 includes12 pre-existing lifecycle draft tests outside this checkpoint's commit; the corresponding committed suite excludes those drafts. The unrelated account-lifecycle implementation/test and icon file remain untouched. Generated docs contain34 curated pages; contact-delivery prose is a reviewed candidate, with its unimplemented JSON contract excluded from the public registry. [Walkthrough](docs/walkthrough.md) sections36–37 distinguish actual Worker/Node behavior from intercepted source screenshots.

The first Worker run hit an undici connection reset in its oversize streamed-body fixture; the isolated file passed9/9. Bounding test-file concurrency at four gave the complete47/47 run without changing receipt validation. Browser investigation captured Playwright's duplicate opaque-child-frame attachment assertion; installing its matched browser alone did not remove it. The final fixture uses default pinned headless shell156.0.8078.4, explicit Close/real frame detachment between independent deliveries, and a test-only clone observer of real fetch responses instead of a CDP response-body handle invalidated by child navigation. It never synthesizes/resends a request or modifies the delivered Response. Three independent repetitions passed7/7 each, followed by the complete82/82 gate. Native pointer/history, cookie, status/body and server send-count checks remain. Rapid direct switching/reload with an open unknown frame is outside this stabilized independent-case fixture; no product fix is claimed for the driver invariant. [Independent investigation](docs/release/node-browser-background-review.md).

A separate source-confirmed Node alarm shutdown race was fixed narrowly: closed metadata does not retry/read/rearm after an in-flight callback fails. Deterministic tests2/2 and full core838/838 passed. Synchronous close does not promise to drain or durably complete in-flight maintenance.

User added simultaneous provider-local accounts, account selection for connected apps, destination-account notifications, and app-triggered login/select/reauthentication/end-session flows. Design-only drafts: [session authority](docs/architecture/multi-account-sessions.md), [UI/privacy](docs/architecture/multi-account-ui.md), [independent review](docs/release/multi-account-review.md). Implementation is pending. Account inventories and sign-in state must not be disclosed to third-party apps before consent. Cross-origin popup/redirect already isolate provider DOM; Strict cookies do not become available in cross-site iframes merely through Storage Access permission. A neutral iframe launcher may coexist with trusted top-level approval, preserving cookie and clickjacking boundaries. Existing handle-bound consent requests must remain immutable; changing account requires a fresh bound request. App-token logout and provider-session logout remain distinct, with explicit provider UI for session changes. Vault concurrency, request-local member binding, stale-owner fences, notification navigation and partial logout retry authority require the next implementation checkpoint. Architecture/security/privacy sign-off: reviewer ___ / date ___ / outcome ___.

## 2026-10-14 — Coordinator handover; recognizable Bindle links and conditional contact links

Coordination moved from the Codex session to Claude Code (Opus 5.5) as coordinator. Uncommitted multi-account work and the unanswered embeddable custom-elements request carry over unchanged; working-tree `npm test` passed 839/839 at handover.

User proposed a generic, tooling-recognizable link envelope (`bindle_meta` / `bindle_data` query parameters, each with a magic intent member) and conditional contact links that become valid only once the opener attaches a signed audience response. User-confirmed direction:

| Decision | Consequence | Human review |
| --- | --- | --- |
| Link envelope | `bindle_meta` is a compact JWS whose readable payload carries a magic member, a `type` URI and version; the signature covers the canonical link audience (origin+path). Unrelated query params are ignored and never signed; duplicate `bindle_*` params are rejected. `bindle_data` is unsigned by the link owner and uses a distinct magic value. Conditional is a requirement on a contact link, not a separate kind. | Direction confirmed by user 2026-10-14. Spec sign-off: Reviewer ___ Date ___ Outcome ___ |
| Conditional responses | Signed by the audience identity's key, binding the exact meta digest, audience handle + stable identity, link URL, mint timestamp, explicit validity period and a fresh random nonce. The response is an eligibility pre-check only; delivery still requires an author proof from the same identity. Conditions are host policy, evaluated at render and at delivery; no condition language is specified. Cross-host verification depends on the not-yet-implemented directory/identity-document profile. | Direction confirmed by user 2026-10-14. Reviewer ___ Date ___ Outcome ___ |
| No anonymous link messages | Every message delivered through any contact link must carry a resolvable identity author proof. The sole exception is app messages via the front-end SDK app-connection path, which is not link delivery. Supersedes the anonymous one-off provision in [contact delivery](docs/spec/contact-delivery.md); reconciliation pending. | User decision 2026-10-14. Reviewer ___ Date ___ Outcome ___ |
| Developer contact | 3sln.me's `ray` contact becomes one conditional link evaluated against current eligibility (confirmed paid entitlement, or all accounts while active population < 1500), likely replacing daily per-user grant issuance. Eligibility is then rechecked at receipt, superseding the earlier accepted "1-day expiry, no receipt recheck" trade-off. | Provisional pending spec. Reviewer ___ Date ___ Outcome ___ |

Normative draft (`docs/spec/links.md`), architecture note and independent security/interop review are being produced by a delegated design agent; design only, no runtime change yet. Implementation follows after multi-account sessions land, to avoid overlapping contact/auth edits.

## 2026-10-14 — Link decisions resolved; label-agnostic tags with suspected automated classification

Links design landed: [normative draft](docs/spec/links.md), [decision note](docs/architecture/bindle-links.md), [independent review](docs/release/bindle-links-review.md) (3 high, 9 medium, 7 low findings, all addressed in the draft). Notable refinements: `bindle_data` is itself a compact JWS signed by the audience key; `md` binds the signed meta segments; responses carry a 16-byte nonce, `iat`/`exp` with at most 300 s validity and 60 s skew, single-use evaluation with bounded refuse-not-evict replay state; conditional-link message/byte limits apply per author principal per UTC day; meta carries no free-text display fields and `policy` must come from an operator registry. Coordinator resolved two design questions from prior user direction: developer contact moves to one conditional link (user stated this when proposing conditional links), and anonymous delivery on legacy `?sig=` links ends in the same change that ships identity-authored delivery. Still open for the user: whether foreign-provider identities may ever qualify for developer contact (default: no, 3sln.me identities only; foreign verification is impossible until the directory profile exists anyway). Implementation slices L0 (authored delivery), L1–L3 and L4b (parser, issuance, response signing, replay store) are delegated; L4 HTTP routing, L5 developer contact and L6 contact UI wait for the multi-account slice to release `packages/runtime/http.mjs` and `apps/web`. Contact-delivery/contact-tokens drafts are being reconciled to the no-anonymous decision. Reviewer ___ Date ___ Outcome ___.

User direction: automated tagging (AI classifier and other heuristics) applies only "Suspected <X>" tags (Suspected Spam, Social, Promotional, Recruitment, …); owner rules finalize them, with editable default rules promoting e.g. Suspected Spam → Spam. Tags are label-agnostic identifiers with localized labels. Contact-link required/optional tags are not subject to the suspected convention; they apply as granted. Design and backend implementation delegated (`docs/architecture/tags.md`); the AI classifier call itself remains gated by the public-email bridge design. Reviewer ___ Date ___ Outcome ___.

User decision (2026-10-14): contact-link auto-associated tags are not part of the signed link. They move to per-link server-side intake configuration (revisioned, owner-editable without reissuing the link); deliveries record the intake revision applied. Coordinator extended the same treatment to the sender-selectable optional-tag allowlist, discoverable via the contact-profile representation. Legacy signed `requiredTags`/`optionalTags` seed intake on first read. Signed limits, `kinds` and `resource` remain in the meta. Intake edits never change `md`, stored claims, quotas or outstanding responses. Links spec, delivery, tag-model and contact-docs agents notified. Reviewer ___ Date ___ Outcome ___.

User confirmed (2026-10-14) the optional-tag extension: optional tags are not embedded in links; consumers send a side-effect-free metadata request to the link to learn accepted optional tags (IDs with localized labels), intake revision, kinds/limits and conditional status. Coordinator decision: auto tags are owner-internal and are not disclosed in that metadata. Deliveries naming a tag outside the current allowlist get a specific rejection so clients can refresh metadata. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Embeddable elements design

[Design](docs/architecture/embeddable-elements.md) and [independent review](docs/release/embeddable-elements-review.md) (22 findings incl. 2 blockers, 4 high, addressed in §16). Elements: `<bindle-session>`, `<bindle-sign-in>` (with `<bindle-login>` alias), `<bindle-account>`, `<bindle-monogram>`, optional `<bindle-access-summary>`; framework-branded. Phase 1 uses no iframe: login, select-account, reauthenticate and end-session all run through provider popup/redirect via the provider-owned authorization entry; the embedder learns only typed input and, after consent, the approved identity. Phase 2 (provider iframe account panel, label-only, every action escalates to a popup, partitioned cookie created by explicit opt-in) is gated on browser evidence and a user decision.

Coordinator reconciliation: D7 accepted — popup completion relays the authorization code from the app's own same-origin callback page over a same-origin BroadcastChannel to the waiting tab, validated by the existing single-use transaction; auth.md to be updated (it currently describes a provider postMessage carrying a completion reference). D8 accepted — app sign-out (revokes the app's tokens) is distinct from provider end-session (explicit provider UI), matching earlier user direction; auth.md to be updated. D6 (spec carve-out for a framed label-only panel) deferred to the user's phase-2 decision. Phase-1 SDK flows, elements and SDK string catalogue delegated, built mock-first against the not-yet-implemented authorization entry. Reviewer ___ Date ___ Outcome ___.

L0 identity-authored contact delivery landed locally, not yet wired into HTTP: `packages/messaging/contact-delivery{,-wire,-service}.mjs`. It has strict envelope/multipart/RPC parsers, author proofs with same-host verification only (foreign authors return `author_unverifiable` with no lookup), parent-scoped receipts keyed by operation ID, intake-revision tag provenance and provider-signed receipts. There is no anonymous branch. Conversation initiation is validated but refused (415) until the conversation-v2 runtime exists. Conditional parents are refused (503) until per-author daily quotas exist. [Independent review](docs/release/contact-delivery-impl-review.md): 4 medium, 2 low-medium, rest low/info; all fixed or mitigated. `npm test` passed 898/898. The review found spec defects S1–S16, being reconciled; coordinator decisions: the replay namespace includes the author principal; conditional links use per-author daily quotas; no sender-visible collection choice (the single incoming store plus Views model). Reviewer ___ Date ___ Outcome ___.

Package name for the published SDK and elements: `@3sln/bindle` (user decision 2026-10-14).

User direction (2026-10-14): the Bindle spec should say nothing about UI. The framing and presentation rules now in `docs/spec/auth.md:31` and `docs/spec/protocol.md:38` were written by the earlier coordinator. Proposal pending user confirmation: move them into 3sln.me's own security docs, and keep only the interop content in the spec (manifest presentation hint, universal redirect support, the shape of the result-return exchange). Coordinator also raised a token-lifetime gap: 5-minute in-memory access tokens with no refresh token mean front-end-only apps lose access on reload and after 5 minutes. Recommendation pending user decision: rotating, grant-bound browser refresh tokens with live revocation checks, and defer the phase-2 iframe panel.

## 2026-10-14 — Label-agnostic tags landed (backend)

[Design](docs/architecture/tags.md), independently reviewed (3 blockers fixed: app-sent `sys:` tags, unbounded classifier entry, sender headers reaching final tags). Tags are identifiers: reserved `sys:` system IDs (look-alike prefixes rejected) with localized labels via bab, user tags with owner-registry labels so renames never retag. Eleven categories have `sys:suspected.X` and `sys:X` forms; `personal`/`work` are final-only. Automated output (`MessagingService.applyAutomatedTags`, internal; no model call yet) only adds suspected tags with evidence. Versioned default rules promote suspected→final on classifier evidence only; header heuristics stay suspected; only Spam also quarantines; owner edits/deletions survive upgrades. Rules fire once per message (no chains); automation never undoes owner removals or quarantine release. Contact-link intake tags apply as granted, may use final `sys:` IDs but never suspected ones. The `classification` enum folds into `sys:` tags with lazy migration and batched index re-projection. Combined working tree `npm test` 913/913 after all concurrent agents' changes.

Coordinator decisions on the agent's open questions (provisional): (1) all default promotions ship enabled, per user's "promote Suspected Spam → Spam and so on"; (2) MCP/agent grants may add/remove user tags and final system tags within their granted scope, never add `sys:suspected.*` (classifier provenance is reserved); (3) notifications wait for pending classification only when classification is enabled for that source, bounded by a short timeout, then notify as unclassified (matches the bridge design). Remaining wiring after the multi-account slice: tag label routes, `data.tagLabels`, add/remove tag forms, `migrateTags` in search document building, system-tag styles. Reviewer ___ Date ___ Outcome ___.

Contact-delivery reconciliation complete: spec items S1–S16 are written into [contact delivery](docs/spec/contact-delivery.md), marked proposed where not implemented. Delivery receipts are now keyed by owner, parent, author principal and operation ID, with a test showing a different author's reused operation ID is a separate delivery. Provisional local identity naming is `<issuer>/identity/<subject>`, `…/identity.json`, `…#<kid>`, pending the directory profile. `grant.delivery.collection` is documented only as a reference-host implementation detail. `npm test` 913/913. Still open: a conversation-init vector for the nested-signature rule. Reviewer ___ Date ___ Outcome ___.

Bindle links L1, L2, L3 and L4b are implemented as unrouted library code:
- `packages/messaging/bindle-links.mjs`: the shared raw-query parser, strict I-JSON/JWS profile and md/H digests.
- Fixed vectors in `docs/architecture/artefacts/bindle-links.vectors.json`.
- New-form contact meta issuance, inspection and challenge rotation (`contact-endpoints.mjs`).
- Revisioned intake replacing signed tags (`tag-policy.mjs`), with the side-effect-free metadata representation `application/vnd.bindle.contact-intake+json` ([links §6.2–6.3](docs/spec/links.md)).
- Same-host response signing and verification (`packages/identity/link-response.mjs`).
- The bounded replay record (`link-replay.mjs`).

Signed limits, `kinds` and `resource` stay in the meta. The [implementation review](docs/release/bindle-links-review.md) found 2 Medium issues: anonymous bearer minting for new-form links (now 406) and new-form creation through the legacy request spread (`create()` is now legacy-only). Both are fixed, along with 5 Low. Open: edge routing (#7, L4). `npm test` 925/925.

L4 wiring left for after multi-account:
- `http.mjs` routes via `parseLinkQuery`/`parseLinkMeta`.
- `accounts.mjs` passes `linkPolicies` and replaces the signed-tag pre-check with intake.
- Expose `createLink`/`rotateChallenge`/`updateIntake`/`linkMetadata` and the link-response resolver/signer.
- A per-account `LinkReplayRecord` behind rate limits.
- `requiredTags` dropped from `inspectContact`.

Not routed or production-verified. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Adaptive app sign-in direction (FedCM, popup fallback, key-bound embed restore)

User direction: use FedCM where the browser supports it, otherwise a popup/redirect OAuth-style flow. The app keeps a returned token whose only use is restoring a signed-in provider iframe. The iframe verifies it against a device key generated in its own partitioned storage, so login restores across reloads without giving the app direct access. Bindle spec must contain no UI rules; framing/presentation guidance moves to reference-host docs, leaving only interop (manifest capability advertisement including optional FedCM config URL, universal redirect, exchange shapes).

Coordinator provisional refinements, being designed and reviewed (`docs/architecture/adaptive-app-sign-in.md`):
- The iframe mounts first and generates a non-extractable WebCrypto key in IndexedDB. Only its thumbprint is bound into the sign-in, DPoP-style.
- The embed token is passed by postMessage or URL fragment, never the query.
- Restore requires a fresh proof of possession of the key.
- The embed token never authorizes resource RPC. The app's API access is a separate rotating, grant-bound refresh credential with live revocation, fixing the 5-minute/no-refresh gap for front-end-only apps.
- This supersedes the partitioned-cookie phase-2 panel.

FedCM details to be verified against current official documentation before relying on them. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Multi-account console slice implemented locally

Per-account AEAD, HttpOnly, SameSite=Strict cookies were chosen over the per-device coordinator, which would have let an old cookie gain authority over later-added accounts. Requests bind the tab's account and session context, which are checked before any owner actor routing. Routes cover inventory, switch, sign out one/all and cleanup retry. The 5-account limit revokes the refused new session, and same-account re-sign-in revokes the old session. Legacy single cookies migrate once, and the Node adapter now emits multiple Set-Cookie headers correctly. The localized chooser has per-tab selection, cross-tab refresh and stale-response fences. Push payloads carry the destination account (handle only when previews are on), and clicks switch only after confirmation. Enabled only when `SESSION_COOKIE_KEY` (32 random bytes, base64url) is configured; production will need it as a Wrangler secret before enablement. Tests: core 926/926, Worker 48/48, UI-state 141/141, real Chromium against a local Worker 2/2 (initially from an isolated copy). [Independent review](docs/release/multi-account-review.md): one medium-low issue (stale cleanup cookie blocking sign-out) and several low ones, fixed. Accepted limitations: duplicate-cookie lockout edge, push subscription kept after sign-out, non-atomic cross-tab limit, copied cookies valid until revoked, no key rotation, Chromium only, real push delivery unwired.

Coordinator fixed the shared asset build broken by the tag UI: `packages/messaging/tags.mjs` and its dependency-free `store.mjs` added to `publicSources`. Build passes and UI-state 141/141 on the combined tree. Security sign-off: Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Embeddable elements phase 1 implemented mock-first

Built in `packages/sdk`:
- flows, a callback relay with acknowledgement (D7), and a split between app sign-out and provider end-session (D8);
- elements `<bindle-session>`, `<bindle-sign-in>` (with `<bindle-login>` alias), `<bindle-account>` and `<bindle-monogram>`;
- an SDK string catalogue (`packages/i18n/sdk-catalogue.mjs`, en/es).

Provisional defaults: popup with automatic redirect fallback, and an overridable default host. The `@3sln/bindle` name is isolated in `packages/sdk/package.json`. Entry-based flows (identity-optional sign-in, switch, reauthenticate, end-session, revocation, popup completion) are verified only against the `testing.mjs` double. The server-side authorization entry (S4) does not exist yet; its assumed contract is recorded in the agent's report and forwarded to the adaptive sign-in design.

Tests: `npm test` 929/929 (47 SDK), `test:dom` passes, Chromium embed checks 3/3; Firefox and WebKit not run. Independent implementation review: 12 findings, all fixed.

Open items:
- `define.mjs` is about 24 KiB min+brotli against an 18 KiB budget.
- Hosted loaders for `define.mjs`/`callback.mjs` still need build and route entries.
- Pluggable `transports`/`entryExtensions` are reserved for adaptive sign-in. Single-token-pair assumptions in sign-out/revoke options will need revision for the separate refresh and embed credentials.

Coordinator updated `tests/e2e/federation.test.mjs` to check all keyed `bindle.pending-login:*` records; the new keyed storage made the old assertion vacuous. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Embed islands direction (queued behind adaptive sign-in design)

User direction for post-sign-in iframe UI. Islands are small provider iframes sharing one cached shell (`/embed?client=<id>#<part>`): the fragment selects an allowlisted part, a nonce-bound MessageChannel carries theme/locale/props and outbound events, and the embedder never commands actions. Within the embed partition, one leader island (Web Locks) holds the key-bound embed session and fans state out over BroadcastChannel. Avoid SharedWorker (unsupported on Chrome Android). Dropdown overflow and size-based leakage need explicit design. Islands use fixed or embedder-chosen sizes, never content-derived ones.

Snapshot privacy (coordinator analysis, user agreed): DOM-reconstruction snapshotting cannot read cross-origin iframes, and canvas tainting prevents pixel reads. Screen capture (`getDisplayMedia`/element capture) is user-permissioned and has no content opt-out; it counts as user consent, not a silent leak. `#avatar` guarantees: bytes served only to the embed-session bearer with `Cross-Origin-Resource-Policy: same-origin`, no CORS, `no-store`, rendered from an in-memory blob, no observable load/error/timing signals.

User direction: `#avatar` scales to its iframe, centered and as large as fits, so the embedder sets the avatar size by sizing the iframe. Custom elements supply good defaults, e.g. login/profile button size. Elements also provide a composed profile button: avatar, a dropdown with account switching, and slots for embedder content. Design consequence: embedder slot content cannot live inside a provider iframe. The dropdown container belongs to the custom element in the embedder's DOM, with the switcher island embedded within it and slotted content around it. Islands design (`docs/architecture/embed-islands.md`) starts once the adaptive sign-in embed session lands. Reviewer ___ Date ___ Outcome ___.

User direction (2026-10-14), composed profile button popover requirements for the islands/elements design:
- **Placement.** The popover stays within the viewport and anchors correctly. Use the Popover API top layer with CSS anchor positioning and `position-try` fallbacks, plus a measured flip/shift/size JS fallback where unsupported. Respect RTL and safe-area insets, and reposition rather than close on scroll/resize.
- **Closing.** It closes when expected: outside pointer, Escape, focus leaving, account switch/sign-out, and navigation. Clicks into other cross-origin iframes never reach the document, so pair light-dismiss with window blur/activeElement checks while not treating focus moving into our own switcher island as "outside".
- **Small screens.** It becomes a modal surface. Bottom sheet by default; side sheet when the anchor sits in a side rail, or via an explicit placement attribute. Modal dialog semantics with focus trap, scroll lock, swipe/drag dismiss, a visible close control, visualViewport/virtual-keyboard awareness and reduced-motion support.
- **Island sizes.** Islands inside adapt via embedder-set sizes, never content-derived ones.

## 2026-10-14 — Adaptive app sign-in design drafted

[Design](docs/architecture/adaptive-app-sign-in.md), [independent review](docs/release/adaptive-app-sign-in-review.md) (1 blocker, 3 high, all addressed or surfaced). FedCM, popup and redirect all converge on the PKCE code exchange; the token response carries app credentials plus an `embed_token` bound to the frame key. Refresh tokens persist across reloads only when DPoP-bound, with a revocation cascade. A dedicated cookieless embed origin is used. The FedCM cookie is restricted to `Path=/fedcm/api/` and treated as a session cookie. Verified FedCM facts: Chromium-only (108+); the accounts endpoint gets SameSite=None cookies and `Sec-Fetch-Dest: webidentity`; `params` from Chrome 132; inside an iframe the RP is the iframe's origin. BroadcastChannel is partitioned in all three engines.

Spec cleanup done:
- UI and framing rules moved from `auth.md`/`protocol.md` into a reference-host section of `security.md`.
- The manifest gains `fedcm_config_url`, `embed_binding_profiles_supported` and `dpop_signing_alg_values_supported`.

Blocker AS-R1, pending user decision: when the app relays the frame's key thumbprint, nothing attests the key lives in a provider frame. An app backend can bind the embed token to its own key and read whatever the frame would show. As designed, the frame guarantees rendering integrity only, not confidentiality from the app. That conflicts with the user's goals (account switcher and `#avatar` hidden from the app). The coordinator is proposing to the user confidentiality paths where the frame obtains its token without the app relaying it: FedCM invoked inside the frame on Chromium, and a frame-opened first-party popup bridge on other engines. Embed-token opener posting was dropped because the popup's COOP severs the opener and rendezvous polling enables device-code-style phishing. Reviewer ___ Date ___ Outcome ___.

User decision (2026-10-14) resolving AS-R1: the app must never forward the sign-in request. The provider frame itself opens the sign-in popup or tab on user activation; the app never sees it or holds a handle. The frame passes its key thumbprint into the sign-in context (message or query param; public value) and the flow binds that key to the final embed credential. The embed credential returns only to the frame (`opener.postMessage` with exact embed-origin targetOrigin). The app receives only its own authorization code for its granted access. Confidentiality of frame content (account switcher, `#avatar`) from the app is restored as a requirement. Design revision and fresh review of the binding/delivery path and the opener-preserving COOP change are in progress. Reviewer ___ Date ___ Outcome ___.

User direction (2026-10-14) for the islands/elements design: custom elements listen to island messages on their ports and on the session bus, and translate them into DOM events on the relevant custom elements: sign-in, account chosen, account changed, sign-out, and so on. Coordinator constraints:
- Elements validate origin/nonce/schema before translating, and never forward raw island payloads.
- Event detail carries only what the app is entitled to: the approved identity and app-credential status after consent, never the account inventory or other islands' data.
- One transition yields one event per element, even with several islands. The leader island is the source of truth, and `<bindle-session>` fans events out to the other elements.
- Account change fires after the app credential for the new account is ready, with a distinct failure event if the exchange fails.
- Event names, bubbling/composed behavior, ordering and replay-on-late-listener rules are to be specified in the islands design.

User correction (2026-10-14), superseding the coordinator's "one transition yields one event" constraint and the `<bindle-session>` fan-out: each island emits only the messages that fit its own part. Each wrapper element decides how to compose, debounce or dedupe the events it exposes, so it makes sense as a self-contained unit. No global single-event guarantee across elements. Validation, translation and entitlement limits on event detail still apply per element.

Adaptive sign-in revision 2 ([design](docs/architecture/adaptive-app-sign-in.md), review round 2 appended): the frame creates the authorization entry on user activation with the clicked intent and its own key thumbprint, and opens the popup itself. The popup renders nothing until the opener proves possession of that key. On approval it posts `{code,state,iss,claim}` to the opener with exact embed-origin targetOrigin. The frame redeems the single-use claim with its key and forwards only the code to the app, and only when the parent origin matches the registered redirect origin; the registered callback remains the fallback. App-opened popups, redirect, and FedCM invoked by the app yield app credentials only. One static popup page is served without COOP so the opener survives; without the handshake it replaces itself with the normal COOP `same-origin` page. Sandboxing is detected as a usability guard, not a security boundary. FedCM inside the frame (`mediation:'required'`, key proof over a server nonce) is the Chromium variant. `auth.md` now has a "Provider-operated components" interop rule: component credentials never reach the client and are issued only on key-proven delivery. The fresh reviewer found no path for app script or app server to obtain an embed credential bound to its own key; 10 round-2 findings fixed. Open: in Chrome the FedCM dialog may name the embed host rather than the app; apps sending `COOP: same-origin` lose the confidential frame (integrator guidance: `same-origin-allow-popups`, to verify). Real-browser evidence still missing: per-engine COOP/opener behavior, iOS opener retention, Android process isolation. Reviewer ___ Date ___ Outcome ___.

User direction (2026-10-14), contact link default HTML representation:
- **Intent link.** Includes `bindle+intent://add-contact?contact-url=…` so any Bindle intent handler can add the contact.
- **Previews.** Carries Open Graph/Twitter and oEmbed discovery tags so the link previews well in chat and notes apps.
- **Profile in previews.** When the link's grant permits recipient profile disclosure, name and avatar render in the page and previews; "a platform that has the link already has access."

Coordinator constraints:
- oEmbed returns `link`/`photo` only.
- `noindex, nofollow` (meta plus `X-Robots-Tag`).
- Generic card for revoked or undisclosed links.
- Crawler fetches never deliver, consume quota/nonces or evaluate `bindle_data`.
- Interop text (intent URI and parameters) goes in `links.md`; rendering stays in host docs.

Open user question: `registerProtocolHandler` and PWA `protocol_handlers` require a `web+` prefix, so web apps, 3sln.me included, cannot register `bindle+intent`. Proposed: `web+bindle:` (registrable by both web and native handlers). The scheme is isolated in one constant pending the answer. Assigned to the links-integration agent. Reviewer ___ Date ___ Outcome ___.

User decisions (2026-10-14):
- **Scheme.** The intent scheme is `web+bindle`. Contact pages offer `web+bindle://add-contact?contact-url=…` and `web+bindle://send-message?contact-url=…`.
- **No composer on the page.** The public HTML contact page includes no messaging API. Signed-out or non-associated viewers see link and permitted profile information plus the intent buttons.
- **Provider app handling.** Viewers signed into the provider, or opening the link as a deep link into the provider app, get app handling: start a message, or prompt to send a message or add to contacts.

For 3sln.me:
- Session detection is client-side after a static first render, because Strict cookies are not sent on the cross-site navigation from chat apps.
- The handoff goes into a console route that keeps the capability out of server logs, with account choice when several are signed in.
- The PWA captures contact-link paths (`handle_links`/`launch_handler`) and registers the `web+bindle` handler.
- Composition, authored delivery and conditional audience responses happen only in the provider app.

This supersedes the earlier L6 plan for an opener composer on the public page. Reviewer ___ Date ___ Outcome ___.

User addition (2026-10-14): the 3sln.me contact page offers a sign-up option for viewers without a Bindle-capable app. Handler presence is undetectable by design, so it appears as a secondary option under the intent buttons and is hidden once a signed-in session is detected. The link carries through guided signup outside the server-visible query and returns into the send-message/add-contact prompt, respecting signup capacity, paid and waitlist states.
Refinement (2026-10-14): that secondary option is "sign in or sign up with 3sln.me" (existing sign-in UI with a create-account path), since viewers may have an account that is not signed in on that browser.

## 2026-10-14 — Embed islands design

[Design](docs/architecture/embed-islands.md) and [independent review](docs/release/embed-islands-review.md): 18 findings (3 High, 8 Medium, 7 Low), all incorporated into revision 2.

Decisions:
- **Shell and messages.** The fragment is exactly the part name, so a CSS skeleton paints before script runs. The nonce, locale and color scheme travel in the iframe `name`. Inbound messages are presentation-only; outbound messages are per part, entitlement-checked, and `#avatar` emits only `ready`.
- **Leader and timing.** Web Locks leader with BroadcastChannel fan-out. Account-dependent work runs in per-island workers, so page-observable timing is uniform.
- **Avatar.** Bearer-only, re-encoded raster, never cached. Shows a monogram fallback when unbound.
- **`<bindle-account>`.** One `<dialog>`: an anchored popover on wide screens, a modal sheet on narrow ones. The switcher iframe is never reparented.
- **Events.** Per-element events with a frozen `state` for late listeners.

Breaking changes in island mode: `role=menu` becomes a dialog, top-layer positioning, switch/manage move into the island.

Found a real bug in the adaptive sign-in design: the embed API rejected same-origin GETs, which carry no `Origin`. The fix was routed to the design and implementation agents. The manifest standardizes on `embed_profiles_supported`, and a field for the islands embed origin is being added.

Coordinator decisions on the agent's questions (provisional; user may override):
1. The profile button defaults to avatar-only, with an optional label attribute.
2. The `forget` command (app sign-out tells islands to drop local data) is accepted as the sole embedder-initiated command, since it only reduces data.
3. Islands are on by default. Nothing is publicly released, so there is no compatibility reason for opt-in.
4. The sheet breakpoint is 600 px, measured on the viewport.

Implementation slices I1–I8 follow the authorization-entry/app-session server slice now in progress. Reviewer ___ Date ___ Outcome ___.

User addition (2026-10-14): the contact page sign-in UI also lets viewers sign in with their own provider. If that provider's Bindle manifest declares intent support (`intents_supported`, provisional name), the flow appends `bindle_intent=<web+bindle intent>` to its login URL. The 3sln.me and self-hosted implementation declare and handle it.

Coordinator constraints:
- Append only after definitive discovery that declares support; otherwise fall back to the intent buttons.
- The receiving provider validates the intent as untrusted input and only prompts after login, never acting automatically.
- The contact capability reaching the chosen provider is acknowledged, with log-redaction and no-referrer guidance.
- Spec text goes in `links.md` and `protocol.md` §2.

Assigned to the links-integration agent. Reviewer ___ Date ___ Outcome ___.
Sign-in design aligned with islands §20 (leader-only restore, cap of 4 sessions and 2 streams per partition with oldest evicted, `Origin` required for non-GET and on GET when present, avatar re-encoded fetch-only). Superseded sections of embeddable-elements.md are marked. Manifest names settled: `embed_profiles_supported` and `embed_origin`, the latter an explicit exception to the issuer-origin endpoint rule.

## 2026-10-14 — Elements and sign-in must be provider-agnostic; 3sln.me components profile

User direction: the custom elements and sign-in flow must work with any Bindle provider: third-party, self-hosted or 3sln.me. Elements and UI are not part of the Bindle spec. A 3sln.me-defined sub-spec (components profile, published under a 3sln.me artefact URI) governs provider-operated components. A provider must declare support in its Bindle manifest before elements try to use it; otherwise elements render a simplified UI.

This supersedes placing `embed_origin`/`embed_profiles_supported` and component specifics in core `protocol.md`/`auth.md`. Core keeps only a generic, narrow profile-declaration container plus genuine interop: authorization entry, intents, revocation, DPoP, FedCM config URL.

A design agent is defining:
- the profile spec;
- the core container;
- a full / standard / minimal mode matrix with one element API;
- client identity across providers;
- an audit of SDK and design hard-coding.

The authorization-entry implementer was told to keep component fields out of core and to read them through a single profile accessor. Reviewer ___ Date ___ Outcome ___.
User clarification (2026-10-14): manifests declare granular support (which spec features and intents, embed host, available island parts and versions, theming and credential profiles). Elements adapt per feature to that declaration rather than to coarse modes. Sent to the components-profile design agent.
User confirmed (2026-10-14): core Bindle states an explicit provider conformance floor (manifest, authorization code + PKCE redirect, issuer binding, registered callbacks). Below it, elements report "unsupported provider"; core-only providers get the standard UI; the components profile is optional. The standard-UI profile button renders an initials avatar from display name, falling back to handle. Sent to the components-profile agent.

## 2026-10-14 — Authorization entry, DPoP app sessions and embed credentials implemented locally (unmounted)

New `packages/federation/{authorization-entries,dpop,app-sessions,embed-bindings,components-profile}.mjs` and route module `packages/runtime/federation-entry-http.mjs`.

- **Entries.** Pre-owner entries pin client/callback/PKCE/state/scopes/intent/nonce/expiry. Owner selection durably records owner and request ID first.
- **Sessions.** Refresh is DPoP-bound (30 d absolute / 7 d idle, provisional), with rotation, a 30 s same-key grace and reuse revocation. RFC 7009 revocation cascades to embed credentials.
- **Claims.** Key-bound and single-use.
- **Components profile.** Values are advertised only via `componentsDeclaration()` at provisional URI `https://3sln.me/artefacts/profiles/components/v1`, pending the components-profile design.

`npm test` 975/975, Worker 49/49. One SDK mock test ("exposes nothing before approval") failed once and passed in isolation and 6 reruns; tracked as possibly flaky.

[Review](docs/release/authorization-entry-impl-review.md): F1 (sessions died after 127 rotations), F2, F3, F4, F5, F7 and F9 fixed. Release gates:
- F6: an app server attesting its own key never receives the claim, but only because of popup `targetOrigin` delivery, which needs browser evidence.
- F7-mount: the CSP must survive `securePage`.
- F8: the manifest must not advertise unmounted routes.

Coordinator decision (provisional): access tokens stay short-lived (≤5 min) Bearer, while refresh tokens are DPoP-bound. Same-page script can use a non-extractable key anyway, so DPoP-binding 5-minute access tokens adds little against XSS. `auth.md` to be reconciled.

SDK follow-ups:
- accept DPoP sessions (`refresh_expires_in` beyond 28800, refresh proof);
- check `login_presentation` before choosing popup.

Mount hunks for `http.mjs` and composition wait until the links-integration agent releases `http.mjs`. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Boot token and administrator model direction

User direction:
- **Boot handle.** The `boot` handle is permanently reserved. A bootstrap token, carrying mint timestamp and nonce, only claims `boot` and is usable exactly once, within about 30 minutes of minting.
- **Restore.** The same single use may instead restore lost boot access. Reuse requires redeploying with a new token.
- **Expiry.** Boot access expires; boot exists only to create administrators.
- **Boot powers.** Boot mints claim tokens for reserved handles and sets reservations, roles and badges. Only boot creates or revokes administrators and defines which roles are internal-only versus assignable to ordinary users.
- **Admin powers.** Admins can do everything else boot can: reserve handles, configure badges/roles, mint claim tokens, search users, change roles within class rules.

Coordinator provisional refinements:
- Deployment config holds only the token's SHA-256 digest, never the token.
- Consumption is recorded durably and forever, keyed by digest.
- Every privileged action requires step-up reauthentication, rate limits and an append-only audit log.
- Roles (privilege) stay distinct from badges (presentation).
- Reconcile with the existing HMAC system invitations and HOST_NAME_POLICY.

Delegated design, backend and independent review (`docs/architecture/boot-and-admin.md`). Admin console UI is a later slice. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Components profile and provider-agnostic elements

[Profile spec](docs/profiles/components-v1.md) (URI `https://3sln.me/artefacts/profiles/components/v1`, in the public docs build) with descriptor `docs/architecture/artefacts/components-profile-v1.json` (registry publication pending). Also the [decision note](docs/architecture/components-profile.md) and [independent review](docs/release/components-profile-review.md): 21 findings (4 High, 12 Medium, 5 Low), all addressed.

Core `protocol.md` §2 now has:
- an explicit conformance floor;
- a versioned `features` object (`authorization-entry.v1`, `fedcm.v1`, `intents.v1`, `client-id-metadata.v1`);
- a generic `profiles` container.

Revocation, DPoP and refresh keep standard OAuth names. Embed origin, shell, channel, parts, theme tokens, island events and key binding live only in the profile. Elements compute behavior per feature, with one event API. The audit found 34 hard-coding findings (16 SDK, 6 monogram, 2 server, 10 design/spec).

Coordinator decisions on open questions (provisional):
1. Islands mount for any provider declaring the profile, with an embedder attribute to restrict to an issuer allowlist or disable.
2. 3sln.me will declare `client-id-metadata.v1`, so apps need no per-provider registration; consent shows the verified client origin. Implementation pending.
3. Dialog container in every mode.
4. Initials: one letter for single-word names, two for multi-word.
5. Island sandboxing deferred until browser evidence supports it.

Now running:
- SDK provider-agnostic implementation, including alias removal, the bundle budget and the flaky SDK test.
- Islands protocol, runtime and parts (`apps/embed`, `islands-protocol.mjs`).

The links agent was told to move intents and link responses onto `features`. Pending after the links agent releases runtime files:
- server profile constant and manifest shape (S1/S2);
- registry publication;
- mount hunks for authorization entry, embed and admin routes.

Reviewer ___ Date ___ Outcome ___.

COOP/opener spike ([results](docs/release/coop-opener-spike.md), harness `node tests/spikes/coop-opener/run.mjs`): Chromium 156 and Firefox 157 gave identical results. WebKit could not run on this machine (`newPage()` hangs); mobile behavior is unproven.

Confirmed:
- A frame-opened popup keeps its opener only when the popup sends no COOP at all, under an app with no COOP or `same-origin-allow-popups`.
- An app with `same-origin` makes `window.open` return null.
- Exact-origin messages to an app-opened popup's opener are dropped. This is browser evidence for the attestation property behind release gate F6, in two engines.
- `location.replace` to a COOP page severs the opener.
- An unnamed popup is unreachable by the app; a named one is reachable.
- With `allow-popups` the popup inherits the sandbox with a non-null origin, so detection needs the `document.domain` probe.
- BroadcastChannel/localStorage are partitioned. Playwright defaults disable partitioning, so tests must enable it.

Design corrections, forwarded to the islands implementer:
- never name the popup;
- try/catch `window.open`;
- the embed popup page sends no COOP whatsoever;
- integrator guidance: app COOP must be absent or `same-origin-allow-popups`.

WebKit/iOS evidence remains a release gate.

## 2026-10-14 — Links integration (L4/L5/L6) landed locally

- **Routing.** Edge routing uses the shared raw-query parser (review #7 fixed). Contact links serve:
  - the HTML page with OG/Twitter/oEmbed previews and noindex;
  - JSON inspection, which alone evaluates `bindle_data`;
  - side-effect-free intake metadata (`application/vnd.bindle.contact-intake+json`);
  - the contact-delivery bearer.
- **Delivery.** Authored-only through URL POST and `/bindle/rpc` (`ContactDeliveryService` split into prepare/commit). Legacy anonymous `?sig=` and inbox-bearer submission are retired with `403 author_required`.
- **Conditional links.** Host policy with bounded decision reuse (positive until UTC midnight, otherwise 15 min) and per-author UTC-day quotas; the L0 503 refusal is removed.
- **Developer contact.** One conditional link owned by the protected developer identity (paid, or active population < 1500, same-host only). Daily-grant issuance is removed and expired daily grants are reclaimed in bounded passes.
- **Public contact page.**
  - No composer: link info, permitted profile, `web+bindle` send-message/add-contact intents.
  - "Sign in or sign up with 3sln.me", including handoff to the viewer's own provider via `features["intents.v1"]` and `bindle_intent`.
  - Composition, disclosure/Continue-as and sending happen in the console (`/console#contact=…`) with an account chooser.
  - PWA protocol handler and `handle_links`.
- **Owner side.** Intake editor and challenge rotation; tag labels, pills and add/remove forms; sign-out removes that account's push subscription on the device.
- **Tests.** Core 976/976, Worker 49/49, UI-state 155/155, build and Worker dry run pass, Chromium link checks with 13 screenshots in `artifacts/browser/links-*.png`. Conditional/developer-contact browser runs use the Node adapter.
- **Reviews.** [Three independent reviews](docs/release/links-integration-review.md): security (no Critical/High, S1–S10 fixed or accepted), UX (2 High, 9 Medium fixed), previews/intents (R1, R3, R5–R9 fixed; R2, R4 accepted; R10 open).
- **Provisional decisions needing sign-off:** contact page `connect-src https:` for client-side handle discovery (R4); `intent`/`bindle_intent` added to log redaction (R2); revocation fence before the gate; receipt signed with the recipient's key pending admission-key discovery.
- **Remaining gaps:** cross-host audience verification; conversation-init via links; admission-key discovery; HTML-with-data vs §9.3 reconciliation; legacy inbox bearers survive only for conversation-v1 invitations.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Boot and admin backend implemented locally (unmounted)

[Design](docs/architecture/boot-and-admin.md), [independent review](docs/release/boot-and-admin-review.md).

- **Boot token.** Digest-only configuration (`BOOTSTRAP_TOKEN_SHA256`), a 30-minute window with 2-minute skew, consumption recorded forever. A single use covers claim or restore.
- **Boot principal.** Boot is a deploy-token principal, not an account, with its own `__Host-bindle_boot` cookie. It has no recovery; lost access means a new token. Access expires after `BOOT_ACCESS_HOURS` (default 24) with an acknowledged setup.
- **Actor separation.** Console requests declare `X-Bindle-Admin-Actor: boot|admin`, with no fallback between credentials.
- **Admins.** Internal accounts holding the boot-only `admin` role. Internal status is proven by provenance on every read (`bs1` marker or matching admin-minted claim); admins cannot flag accounts internal.
- **Role and badge classes.** Boot sets internal, delegable or user. Admins may assign only delegable internal roles/badges to internal accounts and user-class roles to anyone. Claims for static reserved names are boot-only.
- **Reservations and claims.** Static `HOST_NAME_POLICY` reservations are a floor, with runtime additions. Reserved-name claims reuse the onboarding lane, bound to their exact digest. The `bs1` CLI path is retained.
- **Controls.** Step-up, per-actor rate limits, a hash-chained append-only audit log.

Review: F1 high (any admin could create internal accounts with arbitrary roles/badges, including static names) fixed by the delegable and boot-only static-name rules. F2–F7 fixed with regressions. Boot-admin tests 20/20 on both adapters.

Coordinator provisional decisions on open questions:
- admins must use passkeys for step-up;
- boot may end its own access early;
- admin suspension freezes the automatic account lifecycle;
- unused or expired claims release their name (identity-shards change pending);
- runtime badge editing and external audit anchoring deferred.

Mounting (http.mjs, Node store, Worker `AdminAuthority` DO) and the admin console UI are in progress. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Federation, embed origin and admin routes mounted; browser regressions fixed

- **Federation and embed origin.** The authorization entry slice and dedicated embed origin are mounted behind `FEDERATION_ENABLED`, `FEDERATION_ENTRY_ENABLED` and `EMBED_ORIGIN`. Worker uses one global entry store in a dedicated `FederationObject` with alarm cleanup; Node uses SQLite. `securePage({keepPolicy})` preserves handler CSP/COOP (F7 resolved). The manifest emits `features`/`profiles` only for mounted routes (F8 resolved). The components profile is published in the registry as provisional.
- **Admin.** Mounted only when `BOOTSTRAP_TOKEN_SHA256` is set or `ADMIN_ENABLED=true`. Worker uses an `AdminAuthority` DO (migration `v6`), Node uses `admin.sqlite`.
- **Regressions fixed.**
  - A shadowed `restored` variable in multi-account boot skipped recovery and billing resume.
  - Federation routes ignored member cookies (new `ownerContext`).
  - The top-bar switch button overflowed at 320 px.
  - SDK `define`/`callback` were missing from CORS.
  - The entry view refused same-origin GETs.
- **Tests updated for intended changes:** the expired session opens the chooser; header-less private writes return 409; contact copy.
- **Browser runner.** Raises only aggregate signup windows for its throwaway Worker; per-IP and production limits are unchanged.
- **Results.** Full browser gate green: portal 84/84, federation 4/4, authorization entry 2/2.
- **Review.** [Mount review](docs/release/federation-mount-review.md): M1, M3, M4, M6 fixed. M2 (no provider UI for `?entry=` yet, so the entry flag stays off) and M5 (single entry store availability) open. `boot/begin` lacks a rate limit.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Islands runtime implemented (unrouted)

Built:
- I1: protocol module `packages/sdk/src/islands-protocol.mjs`; validators return frozen copies or null.
- I2/I3: `apps/embed` shell, service worker, runtime, Web Locks leader worker, and parts `avatar`, `account-switcher`, `sign-in`.
- A5 client pieces: non-extractable IndexedDB key, leader-only restore, frame-initiated popup bridge following the COOP spike rules.
- I6: `packages/i18n/islands-catalogue.mjs`.

Tests: `npm test` 1078 passing. Chromium and Firefox island checks 18/18, using the real federation stack with two marked test shims. Frozen-leader failover is tested in Node with real `navigator.locks`. WebKit untested.

[Implementation review](docs/release/embed-islands-review.md): 10 findings plus 1 uncertain, all fixed. Among them:
- `forget` lost across bfcache;
- a signed-out switcher listing bindings;
- memory-only storage breaking leader fencing;
- the service worker pinning unhashed assets;
- binding-count-dependent redraw timing;
- an armed frame sliding under the cursor.

Platform findings: Firefox sends `Origin: null` under no-referrer; the island worker script requires COEP.

Open:
- server `view.subject`;
- avatar, events and session-end routes;
- shell serving and build entries;
- A7 authorize acknowledgement;
- FedCM in frame.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Boot and admin console UI

Boot setup/sign-in and the admin console are implemented. `admin-entry.mjs` loads only on `/console?boot|?admin`. `admin-console.mjs` is dynamically imported only after boot or confirmed admin authority, and is excluded from the service-worker precache. Strings: about 390 en/es entries.

Backend additions:
- `boot/end` (early end of boot access) and `boot/session` (CSRF restore);
- an admin-only `access` probe;
- passkey-only admin step-up, and `step-up/end` on leaving the console;
- `boot/logout` always clears;
- `boot/begin` rate limits: 5/min and 20/h per IP pseudonym, 200/h global.

Tests: UI-state 170/170, boot-admin 30/30. Real-browser e2e passes the boot → admin → passkey step-up → reserve → mint → onboarding claim → user lookup → audit verification path, plus dark/mobile, no admin code for ordinary accounts, and early boot end. Screenshots in `artifacts/browser/admin-*.png`.

[Reviews](docs/release/admin-ui-review.md): security found no Critical/High (3 low/medium and 3 info fixed). UX: 13 of 14 fixed, including all 3 High; U13 partial.

Coordinator fixed the onboarding config gap: `/api/config` `tokenOnboardingEnabled` now also honors `ADMIN_CLAIMS_ENABLED`.

Pending:
- identity-shards release of expired, unbound preissued reservations;
- backend wiring of the admin-suspension lifecycle freeze (the UI makes no claim).

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — SDK and elements provider-agnostic

`packages/sdk` now works against any conforming provider:
- conformance-floor check;
- versioned `features`/`profiles` via a capabilities module;
- per-provider client IDs and client-ID-metadata support;
- popup and FedCM only when declared;
- DPoP-bound refresh with nonce retry;
- per-session revocation;
- the dialog-based profile button in every mode;
- scheme-aware OKLCH initials avatars;
- an islands hook.

New modules: `capabilities`, `tokens`, `dpop`, `fedcm`, `handle`, `relay`, plus avatar/initials/tile/account-view elements.

The `<bindle-login>` alias and TypeScript shim are removed. The coordinator switched the remaining console, demo and smoke-test usages to `<bindle-sign-in>`, dropped `login-element` from the SDK CORS allowlist, and deleted the file.

The flaky elements test was a fixed 40 ms wait; it now waits for the session event (24/24 under parallel load). The contact-page discovery regression was fixed in the SDK by restoring the frozen floor-checked `manifest` in discovery results.

Bundle: the first render needs 17.68 KiB min+brotli (budget 18), with the controller and account view lazy-loaded. The public standalone bundle is 38.0 KiB unsplit, since js-tools has no code splitting.

Tests: core 1083/1083, UI-state 170/170, DOM smoke, and Chromium/Firefox element and provider-matrix checks 15/15; WebKit not runnable here. [Implementation review](docs/release/components-profile-review.md): no blockers; 4 Medium and 3 of 7 Low fixed, the rest recorded.

`auth.md` is reconciled: `token_type` describes only the access token, so short-lived Bearer access may accompany a DPoP-bound refresh token, and clients accept either. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Claim-name release and admin-hold lifecycle freeze

**Claim-name release.** Expired, never-redeemed admin claims release their name through the identity storage alarm on both adapters: Node `identities.sqlite` and the Worker `IdentityDirectory`. Release applies only to still-`preissued`, unbound, digest-matching reservations at least 10 minutes past expiry, and never to static, `boot`, assigned or redeemed names. Release and redemption are transactions on the same row, so exactly one wins; covered by a randomized race test in both orders.

**Lifecycle freeze.** Admin suspension freezes `AccountLifecycle` through a required `adminHold` port. Reactivation resumes once and restarts the clock, never deleting immediately, and paid protection is still checked first.

The automatic account-lifecycle executor (warnings, suspension, deletion for unpaid inactive accounts) is not wired to any scheduler. The freeze, and the user's retention policy itself, therefore have no runtime effect yet. This is a known roadmap gap, not new behavior.

Reservations created before the expiry index are not released. Tests: core 1098/1099 (the one failure is in in-progress islands serving), Worker 50/50. [Review](docs/release/boot-and-admin-review.md) follow-ups found no Critical/High, and its fixes are applied. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Islands served on the embed origin

- **Build.** Islands have their own checked import-map graph under `/embed/assets/`. The shell carries an inline import map whose hash is in its CSP; per-client `{{CONFIG}}` is filled at request time with verified escaping.
- **Routes.** On the embed origin only: shell with per-client `frame-ancestors`, assets with CORP/COEP, service worker, avatar, events and session end. The session view carries the subject.
- **Avatar.** Reads only provider-owned assets or `EMBED_AVATAR_ORIGINS` (Worker), re-encoded to PNG.
- **`Origin: null`.** Accepted only with `Sec-Fetch-Site: same-origin`, a Firefox no-referrer case. The coordinator recorded this in adaptive sign-in §13.4 and updated §14 discovery to the `features`/`profiles` model.

Tests: core 1100/1100, Worker 50/50, UI-state 182/182, build and dry run pass. Chromium and Firefox islands pass end to end against a local Worker; WebKit untested. [Serving review](docs/release/embed-islands-review.md): S2–S5 fixed.

Open:
- avatar CPU cost (S1);
- client consumption of `/events` and `session/end`;
- Node avatar fetcher;
- the A7 popup is still a stand-in;
- service worker untested in a browser;
- FedCM in frame;
- the islands browser test is not yet in the `test:e2e` runner.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Provider authorization-entry page (A7)

The provider page handles `?entry=` for login, select-account, reauthenticate and end-session, in popup and redirect presentation, and for frame-initiated popups:
- no account state before the opener key handshake;
- exact embed-origin delivery;
- frame-busting and delay-to-arm on approval.

Legacy consent now shares a consent kit with the entry page. Strings live in `packages/i18n/authorize-catalogue.mjs` (en/es).

Tests: core 1099/1099, UI-state 182/182 (12 new), entry e2e on a real local Worker 7/7 (Chromium), legacy federation 4/4. End-session ran against a simulated route, since there is no adapter end-session hook. [Reviews](docs/release/authorize-entry-ui-review.md): 6 security and 15 UX findings fixed.

The entry flag stays off in production until these are fixed:
- **S1 (high):** an app backend can probe, before consent, whether and as whom the user selected an account. The deny path trusts an unverified cookie prefix and responses differ by selection state.
- No end-session hook.

Other open items:
- weak anonymous cancel/end-session CSRF;
- no console `?entry=` return or add-account deep link;
- no "already approved" signal, so only identity-only entries are one click;
- `maxAge:0` never succeeds;
- entry view lacks `embed.origin`;
- `uiLocales` ignored;
- hard-coded brand text.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Authorization entry hardening

All seven server gaps from the A7 review are fixed:
- **S1 pre-consent leak.** Selection is per account. Owner steps verify session and CSRF before reading entry state. Cancel never consults an owner. The plain page declares plain mode on load. A test runs 20 probes × 4 selection states × plain/embed-plain and compares bytes and work counts.
- **End-session hook (Worker/Node).** Ends only this browser's session for that account after that member's CSRF, revoking first. `end-session` is advertised only when the hook exists.
- **CSRF.** Every entry POST requires exact Origin, same-origin Fetch Metadata and a per-entry token from the view.
- **`maxAge:0`.** Satisfied by a sign-in or step-up after entry creation. Device-approval sessions count only after step-up.
- **`embed.origin`.** Now included in the view.
- **Already approved.** A provider-page-only resubmittable access signal.
- **M5.** The entry store is sharded 64 ways by entry ID, with budgets on the caller's shard.

[Review](docs/release/authorization-entry-hardening-review.md): 6 findings fixed (plain-mode leak, double code, priorApproval scope, legacy end-session, device-approval freshness). Gates green: core 1133/1133, Worker 51/51, UI-state 185/185, browser gate 85+4+2+5.

`FEDERATION_ENTRY_ENABLED` remains off pending:
- human sign-off;
- registered production clients or `client-id-metadata.v1`;
- Firefox/WebKit/mobile evidence;
- checks against a deployed Worker.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Account lifecycle runner wired (flags off, dry run)

The lifecycle executor is wired behind `LIFECYCLE_ENABLED=false` and `LIFECYCLE_DRY_RUN=true`.

- **Scheduling.** Worker: cron `17 */6 * * *` drives a bounded, leased, resumable sweep in a new `LifecycleScheduler` DO (migration v7), which arms accounts that have no traffic. Account DO alarms run lifecycle ticks. Node: the same sweep every 6 h and at startup.
- **Notices.** Push to all devices plus email from `accounts@sys.3sln.me` when a verified email exists, with spaced attempts.
- **Suspension.** 423 on every account method outside an allowlist (status, reactivation, billing/webhooks, unsubscribe).
- **Reactivation.** `/api/account/lifecycle(/reactivate)` requires a sign-in within 15 minutes; the console shows an "I'm still using it" prompt.
- **Cold tiering.** R2 bindings offer no copy or in-place class change, so objects are moved with an etag-guarded same-key `put` to `InfrequentAccess`.
- **Purge.** Requires `LIFECYCLE_PURGE_ENABLED` and the final grace period. It commits a `purging` fence, tombstones the identity (handle kept, email released) and deletes only owned blobs. Accounts with external connectors are held.
- **Unused-account threshold.** 2 days, per spec.

Tests: core 1135/1135, Worker 51/51, UI-state 185/185, Worker dry run passes. [Review](docs/release/lifecycle-runner-review.md): 9 of 10 fixed, including purge after an unenforced period, tombstones enforced only in live mode, and webhooks refused while suspended.

In progress before purge can ever be enabled:
- refunded, charged-back and archived-product payers must count as ever-paid (item 5);
- a cost-based size threshold for cold tiering;
- documentation status updates.

Reviewer ___ Date ___ Outcome ___.

Lifecycle follow-ups:
- **Ever-paid marker.** Any order, refund, chargeback or subscription, observed by webhook or live Polar check, sets a permanent marker. Purge additionally requires a fresh successful Polar check; failure or ambiguity holds the account. All six cases are tested: refund, chargeback, archived product, deleted product, missed webhook recovered by API, API down.
- **Cold tiering threshold.** Only objects of 4 MiB or more move to InfrequentAccess (break-even about 1.9 MB). Hosted objects are currently capped at 1 MiB, so in practice nothing tiers. Suspended reads are still blocked.
- **Docs.** Retention and email docs now state the flags default off with dry run.

Unverified offline: Polar list behavior; a sandbox check is required before purge is ever enabled. Core 1141/1141, Worker 51/51, UI-state 185/185. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Client ID metadata documents (`client-id-metadata.v1`)

Implemented locally behind `CLIENT_METADATA_ENABLED` (default false), following the provisional decision to declare it.

**Resolution (`ClientDirectory`, `packages/federation/client-metadata.mjs`).**
- Exact URL syntax, GET with no redirects, 16 KiB limit, 3 s abort, exact validation.
- Cached 5 min–24 h; failures cached for 60 s and never as documents.
- Global, per-site and per-site entry budgets are charged before any fetch.
- Blocked hosts (including subdomains) and the provider's own hosts are refused. Static registrations take precedence and are never fetched.

**Egress.** Node uses the DNS-pinned adapter. Workers use strictly-public global fetch plus a DoH screen, which does not pin the connection.

**Trust and consent.**
- A validated snapshot passes as a separate argument and is persisted on owner approval (at most 128 per owner), so codes, refresh and RPC never refetch.
- CORS origin is derived from the client ID.
- Consent and entry pages name the app by verified host. `client_name` is shown only as isolated text labelled unverified, with a "not reviewed" notice; logos are never shown.

**Admin.** `blockClient`/`clientBlocks` with audit, plus a "Client hosts" console screen. The manifest declares the feature only when enabled with an egress port.

Tests: core 1157/1157, Worker 51/51, UI-state 189/189, Worker dry run passes. [Review](docs/release/client-metadata-review.md): no High findings; subdomain block bypass, budget churn, self-host clients and others fixed.

Residual risks:
- a distinct-ID flood can exhaust the global budget and evict cached clients;
- Node ignores `Cache-Control`;
- an existing token used without Origin survives up to 5 minutes after a block.

Production declaration still needs Workers egress verification against private and rebinding targets, plus sign-off. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Elements mount provider islands

`packages/sdk/src/elements/islands.mjs` now mounts provider islands per the declared parts:
- handshake to the exact embed origin;
- every message validated and translated into element events;
- island sign-in completes only after the app's own code exchange;
- failures fall back to the standard UI.

Islands stay mounted across sign-out so `forget` precedes `session{null}`. The leader consumes `/embed/api/events`. The island page sends `session/end` on pagehide, since worker requests did not reach the server. FedCM in the frame (`mediation:'required'`, key proof over a server nonce, feature-detected) is verified only against a test double; the provider FedCM endpoints do not exist yet. Fixed: app sign-out wiped the islands' pending sign-in. `islands-embed` and a new `islands-sw` suite (service worker over real HTTPS) joined the browser gate.

Tests: core 1159/1159, DOM smoke; islands, SW, provider-matrix and embed-elements pass in Chromium and Firefox. First render 16.94 KiB min+brotli; the mounter is 3.10 KiB, lazy.

[Review](docs/release/embed-islands-review.md) "Element integration": 8 of 11 fixed. Open:
- EL-2: the pagehide session end departs from EIR-4;
- EL-3: FedCM can lose user activation on slow networks;
- EL-11.

Server work remaining:
- FedCM endpoints and `fedcm:{configUrl,assertUrl}` in the shell config;
- entries accepting `embed-fedcm`;
- possibly one event stream per instance.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Identity/access test audit and engine-level chaos

[Audit](docs/release/test-audit-identity.md) classified about 60 identity-domain test files by level. Changes:
- Removed 7 real-time waits (sleeps, timeouts, a flaky DPoP edge) in favor of events, mock timers or fixed clocks.
- Removed 2 redundant tests.
- Sped up real-Argon2 recovery tests from 3.5 s to 1.1 s.
- Added about 80 engine-level edge, contention, fault and scaling tests, deterministic per seed and passing at five seed bases.

Shared helper `tests/helpers/chaos.mjs`:
- `createRandom`;
- `forEachSeed`, which names the failing seed and replays via `CHAOS_SEED`;
- `createScheduler`;
- `injectFaults` (throw, partial commit, duplicate, timeout);
- `fakeClock`.

Eight defects found and fixed:
- a redelivered shard prepare misreported as a conflict;
- a repository without a handle allocator stored raw-case handles, so case-variant duplicates were possible;
- the revoked-session count included expired sessions;
- cancel racing a decision produced a double entry outcome;
- 1 ms skew reset the admin rate window;
- concurrent claim mints both succeeded;
- unreserve racing a mint left an orphan live claim;
- a forward clock jump locked abuse/signup windows.

Core 1275/1275 in 11.3 s, Worker 51/51. Still open: revokeClaim racing a redemption past admission (fix in progress); duplicate capacity claims spend twice (fails closed). Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Messaging/data test audit and engine-level chaos

[Audit](docs/release/test-audit-messaging.md): most messaging-domain tests already call services directly (engine level). HTTP-level coverage is limited to the links, billing signature, conversation HTTP, beaming and MCP routes; `contact-preview` alone checks rendered HTML. Changes:
- Removed wall-clock dependence from 15 tests (frozen or injected clocks, mock timers, explicit drains), saving about 2.5 s of real waiting.
- Removed one duplicate test. Documented the remaining overlaps and internal-key assertions.

Added seeded engine suites, reproducible via `CHAOS_SEED`: `engine-links`, `engine-delivery`, `engine-tags`, `engine-billing`, `engine-storage-chaos`, `engine-search`, `engine-lifecycle`, `engine-item-index`. Helpers: `tests/helpers/engine.mjs` runs operations as ngin Actions over injected providers, plus `tests/helpers/messaging-fixture.mjs`.

Defect fixed: after a failed attempt whose blob cleanup also failed, retries of the same conversation event received 409 for up to 20 minutes. `packages/conversations/runtime.mjs` now releases the stale reservation first. The chaos test fails without the fix on seeds 2, 7 and 13.

Core 1275, Worker 51. In progress:
- a clock port for message-postbacks (UTC-midnight flake);
- form-fetch timers;
- a vacuous assertion in the portal callable-commands audit test.

Reviewer ___ Date ___ Outcome ___.
Messaging test leftovers closed: message-postbacks takes an injected clock (`FORM_POSTBACK_CLOCK`, default `Date.now`) with explicit UTC-midnight rollover tests; form-fetch deadlines use mock timers ticked after the request is in flight; the callable-commands audit test now asserts refusal-without-dispatch and single dispatch with the original token (no portal defect). Core 1276/1276.
Admin claim revocation and redemption now serialize on the claim record via a `redeemName` hook. Exactly one wins; a redeemed claim refuses revocation (`claim_in_use`) and keeps internal provenance. A marked but unfinished redemption cannot be revoked but still expires and is swept. Free and paid signup capacity claims carry the pre-generated account ID as a receipt, so a redelivered claim spends one unit, and a mismatched receipt fails closed. Seeded tests: `claim-redemption-chaos` (30 seeds, real services) and `signup-capacity-receipts`. Core 1279/1279, Worker 51/51.

## 2026-10-14 — UI polish pass

- **Tokens and accessibility.** About 46 ad-hoc grey text colors (many 2.3–3.9:1) consolidated into a `--muted` token at 4.7–5.4:1 (WCAG AA). The focus-ring token raised from 2.3:1 to 3.9:1 and extended to textareas, `summary` and `[tabindex]`. Minimum text size is 10 px.
- **Overflow fixes.** Rules cards (all widths), desktop sidebar, mobile security details, and an admin table at 320 px.
- **Admin overview.** Stat numbers were rendered at label size because of a selector bug; fixed.
- **Controls.** Device-page buttons grouped, "Sign out of all accounts" demoted from primary, five navigation entries given distinct icons, handles and island labels bidi-isolated.
- **Redeemed claims.** Shown as "Redeemed {time}" with no revoke or link actions. The coordinator exposed `redeemedAt` in the admin overview (boot-admin 36/36).
- **Evidence.** Before/after screenshot matrix (4 widths × light/dark × en/es, 452 captures) in `artifacts/browser/polish-*`. [UX/a11y review](docs/release/ui-polish-review.md): 8 findings fixed. Gates: UI-state 190/190, DOM smoke, core 1279/1279, browser gate pass.

Product decisions deferred to the user:
- dark theme for the signed-in console and docs;
- crowded mobile top bar;
- plural-aware Spanish keys;
- rule status pill placement;
- two primary buttons on the contact page;
- signed-out device-review affordance;
- raw shortcut `when` expressions in Preferences;
- the `n....` sign-in placeholder;
- "Set up" shown on unavailable resources.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — UI chaos suites

New suites:
- `tests/browser/ui-chaos.mjs` (UI-state, happy-dom): 100 seeds × 30 actions mixing account switches, offline/online, expiry, and faulted or out-of-order replies, plus hung requests, duplicate events, recovery, admin step-up and authorization entry.
- e2e: a fault harness `tests/e2e/chaos.mjs` with `ui-chaos`, `ui-chaos-scale` and `ui-chaos-contention`, plus `tests/browser/islands-chaos.mjs`. All are in the browser gate runner.

Defects fixed:
- raw "Failed to fetch" replaced with honest localized errors;
- an unreadable 2xx reply was treated as a refusal, clearing billing-change state;
- a 60 s request deadline added, so spinners no longer hang indefinitely;
- a failed refresh after a successful save reported failure;
- beam mutations lacked a busy guard (double submit);
- the account list could stay "Loading…" indefinitely;
- a wizard double-click skipped a signup question;
- transient faults on the entry page showed "expired";
- the contact page had no retry after a failed load;
- a bfcache restore blanked the console (it now reloads).

Gates: core 1279, UI-state 199, DOM smoke, full browser gate pass. [Flake review](docs/release/ui-chaos-review.md): 5/5 reruns per suite; four potentially vacuous assertions tightened, not yet re-reviewed. Headless Chromium only; bfcache was replayed with synthetic events.

Reported: View creation lacks an idempotency key, so a retry after a lost reply duplicates the View. Reviewer ___ Date ___ Outcome ___.

## 2026-10-14 — Final cleanup sweep

- **Dead code.** Removed unreferenced `packages/runtime/offload-metadata.mjs`, `apps/worker/transports.mjs` and `apps/web/src/release-model.mjs`, plus unused `NotificationDispatcher`, `lifecycleGated`, `MCPState`, `OBJECT_STORAGE`, `DPOP_ALGS`, `STORAGE_WRITE_LAYOUT` and five redundant generated-manifest exports.
- **Kept.** Documented public `PART_PATTERN` and `colorTokens`; documented cost-model scripts. `app-message-key` and `prepare-argon2` are now referenced from the app-messages and recovery-file specs.
- **Shared helpers.** UUID and canonical-JSON helpers consolidated into `packages/core/primitives.mjs` across 29 server files. Variants with different semantics were left alone, including the admin-store `canonical` that the audit hash chain depends on (commented).
- **Event rename.** `<bindle-sign-in>` now emits `bindle-sign-in-request`.
- **Idempotent View creation.** `POST /api/views` accepts a client `operationId` (UUID v4). A repeat returns the original View; reuse with a different definition returns `view_operation_conflict`; the 64 most recent receipts per owner are kept. The console keeps one ID per unchanged create attempt. Covered by `tests/engine-views.test.mjs` and a UI chaos case.
- **Gate.** `embed-elements` and `provider-matrix` added to the browser gate.

Tests: core 1283/1283, Worker 51/51, UI-state 200/200, DOM smoke, build and dry run pass. Browser gate: 175 of 179 passed, 4 WebKit cases skipped (WebKit unavailable here). Reviewer ___ Date ___ Outcome ___.

## 2026-10-15 — Engine-first application architecture (user direction)

Coordinator review found that the server app is mostly not an ngin Engine. Only identity, with a few Actions/Queries, and portal use ngin. Messaging, contact links/delivery, tags, conversations, storage, billing, search, lifecycle, federation and admin are plain service classes called directly from `packages/runtime/http.mjs`. The earlier description of services as ngin actions/queries (D020) was only partly true. The recent `tests/helpers/engine.mjs` wrapped plain service calls in a generic Action, so those tests were service-level tests; the helper is being removed and the suites relabeled.

User direction: the entire app logic, front end and back end, must be drivable through an ngin Engine regardless of environment, so agents and tests can explore and verify behavior against the engine before building or changing UI.
- Server domain operations become Actions/Queries composed into one application Engine.
- Storage, clocks, network, mail, push, billing and platform adapters (R2, Durable Objects, SQLite) become providers.
- Worker/Node HTTP layers become thin dispatch adapters.
- Client `bl/*` Actions get engine-level tests against fake providers, without rendering.

Plan: architecture design and pilot domain first, then a domain-by-domain migration behind existing tests. Reviewer ___ Date ___ Outcome ___.

## 2026-10-15 — Engine-first pilot

Added the application engine:
- `createAppEngine` in `packages/app`, which refuses providers outside the catalogue, requires clock, random and audit, and installs a read-only audit interceptor;
- the provider catalogue (platform stores, effects, domain stores);
- operation conventions: `{actor,id,input}`, one change event per mutation, at most one transaction per single writer, no nested dispatch, declared operation policy;
- owner-scoped providers that refuse a mismatched actor or bound store at lease time.

The engine runs inside each account's single writer (Durable Object or Node controller) through the shared `AccountController`. Views, incoming and tags now run end to end as 12 engine operations through one account `dispatch` RPC; the controller methods remain as facades. `DELETE /api/rules/:id` is now a single transaction, and a seeded test shows the old two-transaction shape lost updates.

Tooling:
- harness `createTestEngine` in `tests/helpers/app-engine.mjs` (faults, scheduler, fake clock, seeded IDs);
- engine CLI `npm run engine -- script.json` with `--db`, `--seed`, `--list`, `--repl`;
- client engine harness, with `tests/browser/engine-accounts.mjs` dispatching the real multi-account Actions against fake providers.

`tests/helpers/engine.mjs` was removed; delivery, billing and links suites are relabeled service-level until migrated. [Design](docs/architecture/app-engine.md), [review](docs/release/app-engine-review.md): 3 major findings fixed (method-name policy, test composition diverging from production, missing owner binding); `faultOf` adoption and a workerd rollback test deferred. Gates: core 1299, Worker 52, UI-state 205, DOM smoke, build, dry run and browser gate pass.

Coordinator decisions (provisional):
1. Owner-scoped providers are the authorization house style.
2. One generic `dispatch` RPC per single writer.
3. The request-tier engine is per isolate, with per-request actor/context passed explicitly as input.
4. Accepted behavior changes: `PUT /api/rules` without `rules` returns 400; rules/labels operations warm the account first; deleting a rule no longer revalidates the others; incoming updates warm before validation.
5. Audit: security-relevant operations are audited durably in the account's own store; other audit events go to logs.
6. MCP and automation tools become dispatches with an app actor.
7. The memory provider set moves into `packages/app`, so the CLI does not import test code.

Known flakes under heavy load: `ui-chaos` "recovery unlock" and `islands-runtime`. Being investigated. Reviewer ___ Date ___ Outcome ___.

## 2026-10-20 — Scope reduction: messaging leaves core; manifest extensions; activity stays

User direction:
- **Messaging leaves core.** Peer-to-peer messaging is removed from the core Bindle spec and from 3sln.me. It becomes its own app with its own interop spec (name TBD, e.g. "Bindle Inbox"), built adjacently in this repo as monorepo packages for now and split out later.
- **Manifest extensions.** The Bindle manifest gains an extension mechanism, probably an `extensions` array of objects pairing a role/slot manifest URL with metadata, so several apps can participate in one slot. The slot definition may decide selection policy, or the consumer may. This needs a robust, wargamed design covering edge cases.
- **Email bridge.** The public-handle email auto-reply (valuable as marketing) reconciles with this. When the user has a messaging app whose extension accepts public messages, that app handles bridged email, via the messaging extension or an intent mechanism.
- **Activity stays in core.** Notifications and app-originated alerts, as distinct from peer-to-peer communication, are presented in an activity UI with fine-grained push control. Each item is tagged with its app (an implicit filter facet), and apps can add their own tags.
- **Classification as a slot.** The messaging app consumes the host's classification/decision model through a preferences slot when available, and omits AI auto-classification otherwise.

NOTES.md adds near-term design work:
- **Apps and integrations under one umbrella.** Built-in integrations (e.g. Google Drive) and third-party apps share setup/config UI driven by config fragments. Manifests declare a webhook for preference updates.
- **Resource discovery and brokering.** Providers expose resources through a search/filter/browse endpoint by protocol or query. The Bindle provider brokers the introduction and owns the coupling credential, so it can sever access on demand. Consumers talk to resource providers directly via the returned RPC endpoint.
- **Messaging robustness** (now the messaging app's concern): participant limits, per-recipient delivery status with resend, a DO-queued send path with SSE progress, an optional host-level multicast receiving endpoint, and a scaling/edge-case research spike.

Later:
- a zero-KYC subscription/invoice registry;
- AI model resources and intelligence profiles via contracts.

Engine-first migration of messaging domains pauses until extraction boundaries are designed. Phase 0 (per-domain route/controller split) was interrupted mid-way by a usage limit and is being completed.

User direction (2026-10-20): generalize the QR device sign-in into a link plus correlation-code approval flow for other uses, e.g. console/CLI apps signing in. The approver opens the link in a signed-in browser (or signs in first) and confirms. The resulting session or token has the same or a shorter time limit than the approving session. Coordinator framing: align with the OAuth 2.0 Device Authorization Grant (RFC 8628) for app clients, while keeping provider session extension as the existing device sign-in. Phishing-resistant code display and consent copy are required, since device-code phishing is a known attack class. Design delegated (`docs/architecture/linked-approval.md`). Reviewer ___ Date ___ Outcome ___.
Phase 0 completed (Codex; coordinator-verified): `packages/runtime/http.mjs` is now a 75-line router delegating to per-domain `packages/runtime/routes/*`; account controller methods are split into `packages/runtime/account/*`; the in-memory provider set moved to `packages/app/memory-providers.mjs`; the per-slice file ownership map is in app-engine §12. Behavior unchanged: core 1299/1299, Worker 52/52 with real sockets (the Codex sandbox could not bind localhost).

## 2026-10-20 — Load-sensitive flakes fixed; messaging scaling spike; activity design

**Flakes (Codex).** Root causes, none fixed by raising timeouts:
- Islands tests used fixed sleeps that could precede message delivery, and failed assertions leaked ports and popup polling. Now observed-delivery waits, guaranteed cleanup and labeled fail-fast deadlines.
- The UI chaos "recovery unlock" case could start its duplicate dispatch after the first completed, leaving an unanswered request. The test now holds the first request open.
- Beaming tests registered late dynamic imports, so teardown restored `Event` before the final test. Imports now load before registration, with pending work drained.

Each suite passed 10 consecutive runs under 12 busy-loop children plus 4 concurrent processes, and lost-message injection now fails in about 2 s. Scratch probe files deleted. Coordinator-verified: core 1299/1299, UI-state 205/205.

**Messaging scaling spike (Codex).** [Spike](docs/release/messaging-scaling-spike.md): lessons from SMTP, XMPP, Matrix, ActivityPub, Signal/MLS and AT Protocol with primary sources, plus a P0/P1 checklist for the messaging app. P0 covers:
- app/core boundary;
- immutable event and audience identity;
- atomic acceptance with durable fan-out and honest per-recipient states;
- retry budgets and host breakers;
- key continuity;
- published bounds;
- retention without resurrection;
- metadata custody;
- SMTP provenance without backscatter.

**Activity (Codex).** [Core interop draft](docs/spec/activity.md), [host activity center](docs/architecture/activity-center.md) and [adversarial review](docs/release/activity-design-review.md). Signed app activity with required app attribution and namespaced app tags; lifecycle and limits; per-app opt-in push routing; multi-account safety; an exact migration list.

Open questions: push/digest limits; whether updates mark read items unread; expiry/history caps. Reviewer ___ Date ___ Outcome ___.

## 2026-10-20 — Link-and-code approval design (device authorization)

[Core draft](docs/spec/device-authorization.md), [host design](docs/architecture/linked-approval.md), [security review](docs/release/linked-approval-review.md).

- **One request type, two kinds.** "session" extends a provider login to another device; "app" serves CLI/TV clients via RFC 8628. Both share one user-code namespace and one `/approve` page.
- **Feature and binding.** Declared via RFC 8628 manifest fields plus `features["device-authorization.v1"]`. DPoP is mandatory, including for access tokens.
- **Lifetime.** Ends at the earliest of the approving session's expiry, the policy cap, or a user-chosen shorter duration (1 h preselected). Ending the approving session revokes everything it approved, transitively.
- **Freshness.** Approval requires a passkey or password step-up within 5 minutes. Sessions created by device approval, email link or recovery never count as fresh until their own step-up.

Mitigations after review:
- the user always types or pastes the code; QR carries only a request locator, with no confirm-only path in v1;
- codes are looked up only for a signed-in account, with failed-guess limits per account and network prefix plus a global budget sized to live codes;
- codes are stored as server-keyed hashes; device codes are single use;
- polls cause no storage writes;
- the requesting screen asks "Continue as @handle?";
- apps are named by verified host only; a country-mismatch warning instead of location; no pushed approval prompts, and a notice after every approval.

The review found two high-severity defects in the current device sign-in, being fixed now (slice LA1a, via Codex):
- **LA-R1:** device-approved sessions passed freshness for 15 minutes and got full 24 h lifetimes, enabling chained approvals, passkey addition or email linking.
- **LA-R2:** the QR review page displayed the code beside the entry field, and approval submitted the URL's code rather than the typed one.

Open questions:
- app credential cap (24 h or 30 days after step-up);
- whether ordinary sign-out also ends sessions it approved;
- the device grant for unreviewed metadata-document clients;
- default duration;
- pasted codes for CLIs;
- proof-of-work.

Reviewer ___ Date ___ Outcome ___.

## 2026-10-20 — Extensions, slots and unified integrations (design rev 2)

[Extensions draft](docs/spec/extensions.md), [integrations draft](docs/spec/integrations.md), [design note](docs/architecture/extensibility-design.md), [two-lens review](docs/release/extensibility-review.md): 24 security findings (3 High) and 22 interop findings (6 High), all answered in revision 2.

- **Slots.** A slot is a preference fragment with a `slot` member and exactly one resource field. Occupancy is the owner's value for that field, and consuming a slot is an ordinary fragment grant, so there is no new authorization primitive. A provider unaware of slots sees an ordinary fragment.
- **Selection policy** is fixed by the slot: `exclusive`, `ordered`, `broadcast` or `consumer-choice`. Owners pick occupants and order; consumers apply the policy. Failover never switches occupants after an ambiguous outcome, and `any-error` failover is allowed only for contracts whose methods are all read/pure.
- **Extensions.** Manifest `extensions` entries are claims, never assignments: `{slot, digest?, role: occupant|consumer, ref, purpose?, required?, options?}`. They appear in provider and integration manifests.
- **Profiles stay distinct.** A profile describes the host (one per provider, a map); only profiles may use the component-origin envelope. All three containers share processing rules.
- **Integrations.** Apps and integrations are one concept (external or built-in). The integration manifest lives within OAuth client metadata, and approval creates the existing app connection, extended with state and generation. Preference updates are RFC 8417 events carrying a full snapshot and a sequence number.
- **Discovery** is a provider-only search/filter/browse/probe call.
- **Brokering.** Consumers call integrations directly with 300 s provider-minted RFC 9068 tokens returned through `preferences/v2`. Severance commits first, then sends invalidations; a conforming integration cuts access within 360 s even if the invalidation is lost.

Core amendments C1–C11 are proposed, not yet applied. Notable ones:
- C1: fragment schemas accept the `slot` member (current `schema.mjs` rejects unknown members);
- C3: one unapproved occupant no longer hides the field from consumers;
- C8: bounded-delay revocation for brokered resources.

Implementation slices X1–X12 (critical path X1 → X3 → X4) are in the design note. Open questions:
- public per-entity slot resolution;
- the 360 s revocation bound versus introspection for write contracts;
- a separate integration-manifest fetch;
- built-in occupants never preselected;
- slot registry location.

Reviewer ___ Date ___ Outcome ___.

User accepted the coordinator recommendations (2026-10-20):

Device authorization:
- app credentials up to 30 days only with fresh sign-in at approval;
- ordinary sign-out also ends sessions it approved, after a clear warning;
- no device grant for unreviewed metadata-document clients initially;
- 1 h default for app approvals and normal session length for session approvals;
- pasted codes acceptable for CLIs;
- no proof-of-work yet.

Extensions:
- 360 s bounded revocation acceptable for read-only brokered contracts, while write-capable contracts require live introspection;
- built-in occupants are never preselected;
- core amendments C1–C11 approved provisionally.

## 2026-10-20 — BindleBox messaging app design

[Design](docs/architecture/messaging-app.md), [interop draft](docs/spec/bindlebox.md), [extraction plan](docs/architecture/messaging-extraction.md), [two-lens review](docs/release/messaging-app-review.md): 3 blockers and 14 highs, all fixed in docs. The blockers were one-way conversations, groups never forming, and app switching that made users look like forgers. Name recommendation: BindleBox, chosen from eight candidates; no trademark search done.

- **Signing.** The app holds its own per-user key, bound by a provider-signed certificate (≤24 h, limited to message/receipt/archive signing, naming the app's certified delivery URL). Rotation revokes the predecessor, and revocation checks are mandatory for edits, deletes, membership changes and receipts. The identity key stays with the provider and still signs links.
- **Core keeps** the generic link envelope, response signing, replay records and landing pages; link issuance/policy services for apps; the new key-delegation feature; activity; the SMTP entry point.
- **BindleBox takes** the contact-link type, conversations, Views, tags and rules.
- **Send queue.** One per-user queue on the app's Durable Object with per-recipient tasks, network calls outside transactions, spike-derived retry budgets, and a monotonic recipient count. Per-recipient delivered/pending/failed/cancelled states, "Retry missing", automatic per-person catch-up, and SSE progress that survives reconnects.
- **Host multicast** is optional, at most 32 recipients per request, with credentials verified before any mailbox wakes.
- **Email bridge** via the public-message-intake slot, with one invariant auto-reply.
- **No public per-entity slot lookup is needed**; contact links and signed conversation updates suffice.

Extraction plan: new `packages/links`, `packages/content`, `packages/bindlebox-protocol`, `packages/bindlebox-engine` and `apps/bindlebox`, with an import-boundary test. Existing messages are reset rather than migrated (pending user confirmation). BindleBox is engine-first with a multi-party network simulator. Slices: C0–C3 core, B0–B9 BindleBox, then cutover X1 and email bridge X12.

User addition: for public/anonymous requests, BindleBox supports auto-rejection rules through classification, with tiers:
- "very likely spam" auto-rejected by a default rule (recoverable for a short period);
- "could be spam" tagged and deprioritized by a default priority rule, but reachable.

Being folded into the design. Reviewer ___ Date ___ Outcome ___.
BindleBox public-request spam tiers (design §12.1, spec §6.7):
- "very likely spam" (classifier probability ≥0.97, provisional) is promoted to `sys:spam` and auto-rejected, with no notification and only the fixed bridge reply.
- "could be spam" (0.70–0.97) stays `sys:suspected.spam`, quiet and sorted low but acceptable.
- Thresholds are bound to the classifier model version, and a model change suspends auto-reject until re-tuned.
- With no classifier, deterministic heuristics only and never auto-reject.
- A recoverable "Rejected" view (500 items or 7 days); allowlisted senders never auto-rejected; per-sender, per-domain and per-owner rate limits.
- Rejection happens after storage, so senders learn nothing about classification.
Abuse cases A-1–A-8 added to the review (not independently re-reviewed). The activity-center migration table is corrected so `email.mjs` and `dispatcher.mjs` stay in core.

## 2026-10-20 — Device sign-in security fixes (LA1a) and step-up follow-ups

LA1a (Codex) fixes LA-R1 and LA-R2:
- device-approved, email-link and recovery sessions require their own credential step-up before counting as fresh;
- device sessions inherit the approving session's expiry and revoke transitively when it ends;
- QR/links carry only a request locator, and approval submits the typed code, compared by hash in constant time, never displayed.

Regression tests and en/es copy added. `protocol.md` lists `device-authorization.v1` (proposed), `device-login.md` carries a supersession note, and the new spec is in the public docs.

Browser-gate follow-ups:
- `identity-names` relied on activation sessions counting as fresh.
- The `authorization-entry-ui` end-session flake was pre-existing: random test IPs collided on the per-IP signup cooldown. Fixed with sequential test addresses; no limits changed.
- The occasional 10-minute core run traced to fixed 10 ms sleeps in `packages/sdk/test/flows.test.mjs`, which fail under parallel load and then hang the run.

Coordinator decision:
- Signup activation that itself completed a passkey or password ceremony counts as fresh, while device approval, email link and recovery do not.
- An owner step-up route plus an inline "Confirm it's you" prompt replaces forced sign-out/sign-in.

Being implemented together with the flows-test and ui-chaos-scale timing fixes. Reviewer ___ Date ___ Outcome ___.

## 2026-10-20 — Integrated roadmap; Wave 0 committed; Wave 1 started

The [integrated implementation roadmap](docs/architecture/implementation-roadmap.md) merges the extensibility, BindleBox, linked-approval, activity and app-engine slice plans into seven dependency-ordered waves. It uses prefixed slice IDs, append-only registries, single owners per file per wave, and default-off flags. BB-CUT is the only irreversible step (message data reset; tag before it). Engine migrations ENG-2/3/4/5 are cancelled: messaging domains are built engine-first inside BindleBox.

Wave 0 (commit c86e0ae):
- six default-off flags;
- the BindleBox test glob;
- an append-only storage resource-method dispatch registry;
- core spec amendments AMD-C1–C11 applied to the specs (code work tracked under EXT slices);
- linked-approval decisions recorded.

Gates: core 1324, Worker 53, UI-state 216, Worker dry run pass.

Wave 1 streams in flight:
- Codex: EXT-X1 slot validation, EXT-X9a conformance fixture, LA6 SDK device helper, LA4 approval page (mock-first), BB-C2 records/content move, BB-B0 BindleBox skeleton.
- Claude: LA1 identity core, IDKEYS-1 key registry, EXT-X5 brokering keys/JWKS.

BB-B1 protocol follows B0.
User decision (2026-10-20): the peer messaging interop spec is named "Bindle Messaging" (descriptive), separate from the messaging app product name. App name pending: coordinator recommends "Parley", with "3sln Messages" as the plain fallback; no trademark search done. A mechanical rename of `bindlebox` docs and packages follows the app-name decision, after the current wave lands.

EXT-X5 landed (provisional): `packages/federation/signing.mjs` provides purpose-separated ES256 brokering keys (invoke, describe, discover, event), sealed at rest with an HKDF/AES-GCM key derived from `KEY_ENCRYPTION_KEY`. Each purpose has a published standby key, and retired keys stay at least 630 s. RFC 9068 `at+jwt` minting runs at most 300 s (60 s for discover/describe), with low-s-only verification. A flag-gated `/oauth/brokering/jwks` route and a provisional `brokering_jwks_uri` appear only with `BROKERING_ENABLED`. [Review](docs/release/brokering-keys-review.md): 2 medium and 4 low findings fixed. Pending: integrator wiring of the `brokering` option into `handleFederation`, the X8 move of `brokering_jwks_uri` into `brokered-resources.v1`, a key-compromise runbook with CDN purge. Reviewer ___ Date ___ Outcome ___.

IDKEYS-1 (BB-C0) landed: `packages/identity/keys.mjs`, an engine-first `IdentityKeyRegistry` with Ensure, Rotate (CAS on `expectedKid`), Revoke and legacy Register; queries by kid, current key and history; `verifyKeyContinuity`; and a `resolveIdentityKey` directory hook. Signing keys keep `contact-key/` records for compatibility; encryption keys get their own. Key states only move forward (active → retired → revoked). `contact-tokens.mjs` delegates to and re-exports the registry, and `account/identity.mjs` runs on the engine. 13 tests including 25 seeded chaos runs and a rejected pre-rotation recovery file. [Review](docs/release/identity-keys-review.md): 6 findings fixed. Rotation stays internal (no route) until C1a moves link minting to the current key. An open race in `packages/conversations/runtime.mjs` is outside scope; that module is deleted at BB-CUT, and its replacement must not repeat the race. Core 1403/1403, Worker 53/53. Reviewer ___ Date ___ Outcome ___.

Wave 1 Codex streams landed. Each passes its own suite; cross-stream integration is pending:
- **EXT-X1 slot validation:** `packages/federation/extensions.mjs`, fragment validator tolerance per AMD-C1, digest pinning, policy semantics, engine wrappers flag-gated and unmounted; 19 tests.
- **EXT-X9a:** reusable engine-backed integration server fixture `tests/fixtures/integration-server.mjs` (webhooks, discovery, token stubs, invalidation); 6 tests plus 6 conformance todos.
- **LA6 SDK device helper:** `packages/sdk/src/device.mjs` with RFC 8628 polling, DPoP and cancellation. Transport injection is required because Node fetch adds a forbidden header; identity hints require a trusted `expectedSubject`. 25 harness tests; `.example` CLI examples.
- **LA4 approval page:** `apps/web/src/{bl,ui}/approve.mjs` plus catalogue, built mock-first; 13 browser checks across widths, languages and themes, including same-tab sign-in and step-up. Legacy QR review page removed; unmounted pending LA3.
- **BB-C2 pure move:** `packages/core/records.mjs`, `packages/content/*`, `runtime/lifecycle-notices.mjs`, with re-exports.
- **BB-B0 skeleton:** `packages/bindlebox-engine/*`, harness and seeded network simulator, import-boundary test, `scripts/bindlebox.mjs`; 9 tests.

Known cross-stream breakages to reconcile:
- UI-state/device-login tests asserting the removed review page;
- e2e fixtures serving form-policy without its moved dependency;
- link HTTP 404 assertions;
- a key-registry ordering assertion;
- a DOM storage check;
- an intermittent Worker EPIPE.

BB-B1 protocol started.

## 2026-10-20 — Event buses, rich consent and incremental authorization (user direction)

- **Event buses in core.** An integration can request read, write or readwrite access to an event bus identified by URI. A bus manifest describes the bus, its purpose and its schema. As with preference fragments, the user can see who has access to each bus, what kind of access, the bus's purpose, and in human terms what that access lets an app do.
- **Consent screens.** Integration consent is a guided walkthrough of exactly what the user is signing up for: what each requested access or grant lets the app do. Not too verbose, but not lacking the detail needed to understand it.
- **Incremental authorization.** Apps can request new permissions, privileges and preference fragments lazily, on demand, through a redirect or through the isolated 3sln.me custom elements and islands. Unconfigured fragments must be filled in before consent, so the request lets the user fill them in.
- **Configuration requests.** Apps can ask to open a preference fragment, or a single field, for the user to edit, for example to request a particular configuration. The user must actually configure it or accept the app's suggested configuration.
- **Request suppression.** The user can choose never to let an app make a given request again, to prevent spammy behavior.

Design delegated (`docs/spec/events.md`, `docs/spec/incremental-authorization.md`, `docs/architecture/consent-experience.md`). Reviewer ___ Date ___ Outcome ___.

LA1 landed: `packages/identity/linked-approval.mjs` holds one record type for session and app requests.
- Codes are base-20 with an HMAC index (`LINKED_CODE_KEY` or `KEY_ENCRYPTION_KEY`) and are looked up only when signed in.
- Guess budgets per account, per network and globally (sized to live codes); polls never write; consumption is single-use; "Continue as" on the requesting screen.
- App credentials 30 d / 7 d idle; atomic lineage revocation with an outbox.
- Contract in linked-approval §10.1: browser `LinkedApprovalAction`/`LinkedResolveQuery`, and an unrouted system `LinkedSystemAction` for LA2 with `LinkedLineageQuery` checked on every refresh, failing closed.
- New operations return `not_found` unless `DEVICE_AUTHORIZATION_ENABLED` is on. Legacy `/api/auth/device/*` aliases run on the new core with the flag off.

25 tests including chaos interleavings; core 1428/1428, Worker 53/53. Review S3, S4, S6, S7, S8 fixed and S5 partly fixed. Open:
- **S1:** admin suspension and lifecycle tombstones clear sessions without revoking lineage, so an app could return after reactivation. Must land before LA2 issues app credentials.
- **S2:** no physical deletion of linked-approval records yet.

Integration pass started. Reviewer ___ Date ___ Outcome ___.

User direction (2026-10-20): integration/app credential lifetimes should not be aggressive, since users can revoke manually; apps refresh automatically, involving the user only after very long disuse. Coordinator decision (provisional), superseding the 30 d absolute / 7 d idle app lifetime:
- access tokens of at most 5 minutes;
- DPoP-bound refresh tokens rotated on every use with reuse detection;
- live grant/account checks on every refresh, so revocation and suspension stay immediate;
- no absolute lifetime for an app connection;
- idle expiry of 180 days by default (host-configurable);
- one fresh step-up at approval only.
Device session approvals keep session semantics, capped by the approving session. To be applied across `auth.md`, `device-authorization.md`, `linked-approval.md`, `packages/federation/app-sessions.mjs` and the linked-approval core after the Wave 1 integration pass. Reviewer ___ Date ___ Outcome ___.

## 2026-10-20 — Event buses, consent walkthrough and incremental authorization (design rev 2)

[Events](docs/spec/events.md), [incremental authorization](docs/spec/incremental-authorization.md), [consent experience](docs/architecture/consent-experience.md), [two-lens review](docs/release/events-consent-review.md). All findings were addressed in revision 2; the fixes have not been independently re-reviewed.

- **Buses reuse slots.** A bus manifest is a one-occupant slot with a required `bus` member. The occupant is a resource implementing a new `event-bus/v1` contract, and read/write/readwrite access is an ordinary fragment grant, so revocation and access listings come for free.
- **Hosting** is the owner's choice: 3sln.me (immediate revocation, push available) or an integration (pull only, every publish checked live).
- **Delivery.** Push is a data-free doorbell on the integration event channel, with one pending doorbell per subscriber. Reads are cursor-based with long-polling; SSE deferred.
- **Ordering.** One total order per bus; retention gaps are always reported; new readers start at approval unless the owner opts into history.
- **Cost.** Publishing draws a separate event allowance, so feeds never block owner writes. Per-feed byte caps, a daily long-poll budget, and empty reads are charged.
- **New intents** `grant-more` and `configure` go through the authorization entry. Results are granted / partial (with the full current grant) / declined, or configured / unchanged.
- **`configure` never changes permissions.** Suggestions cover plain fields only, each accepted individually; URL, email/host and cross-app-received fields need their own confirmation.
- **Tokens** are issued only when access was actually added.
- **Suppression is invisible to apps,** which see only a decline. Blocking requires one armed click, and decline cooldowns (24 h / 7 d / 30 d) count only real owner decisions.
- **Consent copy** comes from the 3sln.me reviewed catalogue, then the named contract publisher, never the app. The app's reason is shown as its own claim. Four risk tiers, never conveyed by color alone.

Slices EV/IA/CX are added to the roadmap; AMD-C12–C20 are proposed and unsigned. Reviewer ___ Date ___ Outcome ___.

BB-B1 landed: `packages/bindlebox-protocol`, a pure, deterministic Bindle Messaging v1 library (Web Crypto only, no I/O, clock or randomness). It covers envelope, genesis, invitation-response, receipt and descriptor shapes for all kinds and 11 record types; digests, event IDs and domain-separated signers; delegation certificate parsing/verification with injected directory/status ports; receipts returning `unknown` on any doubt; pair-gate credentials, audience freezing and author-keyed replay; strict delivery/multicast/RPC parsers; failure classification. 21 fixed signed vectors plus multipart, multicast and pair-token vectors; seeded fuzzing caught one bug. Core 1470 (6 todo), BindleBox suite 44 including the import boundary. [Review](docs/release/bindlebox-protocol-review.md): BR-1 high (a signed `identityURI` could redirect the status check and bypass revocation; now pinned to the directory value), BR-2/3 medium and BR-4–10 low, all fixed. Spec items for the design owner: `secret-share` should require a status check; envelopes are signed per recipient; multicast results lack per-context status; gap/introduction liveness. Reviewer ___ Date ___ Outcome ___.

Wave 1 integration (Codex, coordinator-verified):
- legacy QR approval works through the LA1 aliases, with a Worker CAS fix for consumed requests extending expiry; the code-revealing review page stays removed;
- the moved form-policy dependency is bundled for fixtures;
- link HTTP tests no longer depend on prebuilt assets;
- fixed DOM sleeps replaced with event waits;
- a Worker test transport upload race (EPIPE) fixed, 12 stress runs passing;
- S1: suspension and tombstoning atomically revoke approval lineage, with the durable outbox kept and tests proving reactivation cannot revive app authority;
- S2: bounded cleanup of expired approval records with Node alarm restoration;
- EXT-X5 brokering JWKS wired into federation behind its flag.

Gates: core 1470 (46 s), Worker 55, UI-state 215, DOM, build, dry run, browser gate 179 with 4 WebKit skips. Wave 1 committed as ec34575.

Wave 2a started:
- Codex: EXT-X2 declaration registry, BB-B3 send queue/events, EV-1 bus manifest validation.
- Claude: LA2 device grant (also applying the new app lifetime model), EXT-X3 integration manifest, BB-C1a core links (link minting moves to the current registry key), ACT-1 activity backend, BB-B2 receive/contacts/intake with spam tiers.

IDKEYS-2 proceeds next with 24 h delegation certificates as a provisional default pending the user's answer.
User decision (2026-10-20): app/integration access tokens last 15 minutes when bearer and up to 60 minutes when DPoP-bound, both host-configurable. Rationale: every RPC checks the live grant, so revocation stays immediate regardless of token lifetime, and longer lifetimes cut refresh writes (288 per active day at 5 minutes vs 96 at 15) and rotation races. Rotation, reuse detection, no absolute lifetime and the 180-day idle expiry are unchanged. Sent to LA2.

EXT-X3 landed (unmounted): `packages/federation/integrations.mjs` parses `bindle_integration` from client metadata only. Every URL must sit on the `client_id` origin and path prefix, with an 8 KiB bound; confidential members in a public document invalidate the manifest. AMD-C7 accepts `private_key_jwt` clients only with integrations.v1. Key sets use the client-metadata egress and cache, with RFC 7638 thumbprints pinned, and the §2.3 classifier adopts only narrowing changes. [X3 review](docs/release/extensibility-review.md): S1 high (a copied public key bypassed pinning) fixed by keeping added keys pending until a pinned key vouches for them, a provisional deviation from integrations §2.3 needing sign-off; S3–S5 fixed. S2 open: the Node egress adapter hides 404/410 and drops `Cache-Control` (queued for the Wave 2 integration pass). The spec example names setup fragments `id` while code uses `fragment`; both accepted pending a spec fix. Reviewer ___ Date ___ Outcome ___.

Wave 2a Codex streams landed:
- **EXT-X2:** append-only manifest declaration registry with flag-and-mount gates and bounds; existing manifests byte-identical.
- **EV-1:** bus manifest validation and pinning with engine Query/Action behind a new default-off `EVENT_BUSES_ENABLED`; provisional unpublished `docs/artefacts/event-bus-v1.json`; 11 tests.
- **BB-B3:** durable per-recipient send tasks, retry budgets, host breakers, cancellation fencing, Retry missing/catch-up, and resumable progress (finite SSE replay batches). 23 tests including SQLite recovery and the 1000-recipient bound. Submission accepts prepared signed envelopes; manual retry grants one additional ten-attempt allowance.

Pending for later integration: alarm wiring, receive catch-up wiring, archive capacity reclamation, Worker queue recovery verification. Cross-stream test failures await the Wave 2a integration pass after the Claude streams land.

BB-C1a landed (provisional): generic link machinery in `packages/links/{envelope,replay,audience,preview,profile,policies}.mjs`, with identical re-exports from the old paths (test-asserted). Contact links are minted with the current registry key, re-checked at commit; retired keys still verify, revoked keys never do. A flag-gated links contract (`issuance`, `types`, `engine`: issue, revoke, rotate, evaluate, list, changes) authorizes app actors by current slot occupancy through a `LINK_SLOT_OCCUPANT` port, refusing everything without it. Owner account slice and routes; no RPC exposure yet. 13 new tests. [Review](docs/release/core-links-review.md): revoked links holding the cap for about 13 months, orphan grants after a rotation race and a missing owner check, all fixed. `evaluate` trusts the app-supplied principal (rate-limited); C1b must send a verifiable author proof before mounting. Provisional rule: a new slot occupant inherits the previous app's links. Identity key rotation may now get a route. Reviewer ___ Date ___ Outcome ___.

ACT-1 landed (provisional, behind `ACTIVITY_V2_ENABLED`): `packages/activity` plus engine domain `activity`.
- App-bound create/replace/retract with per-revision ES256 admission evidence.
- Namespaced app tags, refusing all `sys:` and colon look-alikes.
- Incarnation-scoped deduplication; hashed collapse groups that coalesce only pending work.
- Exact-revision replace/retract with a reserved tombstone slot; terminal expiry; private read/archive.
- Per-app limits across reconnections plus account totals, with a separate retract reserve and receipt lane. App operations are not owner-dispatchable.
- v1 messages are surfaced through a read adapter, marked unverified unless the caller checks them. `/api/activity` route added.

16 new tests. [Review](docs/release/activity-design-review.md#act-1-implementation): S1/S2 medium (receipt starvation, per-app storage exhaustion) and S3–S5/S9 fixed, plus an issuer omission in budget, tag and receipt keys found during fixes; S6, S7 and S10 open. Pending: an activity resource descriptor in `packages/runtime/federation.mjs` (integration pass), v2 forms, lifecycle export, ACT-2 dispatch. Reviewer ___ Date ___ Outcome ___.

BB-B2 landed (provisional, unmounted): the BindleBox receive path for link-kind deliveries.
- **Cheapest refusal first:** the edge-index credential check runs without waking a mailbox, followed by exact meta segments, framing, owner key and author verification. Live status is checked per spec §3.4, and known revocations are refused otherwise.
- **One admission transaction** covers replay, the live authorization recheck, budgets, storage and the receipt, so a receipt is never issued before commit.
- **Contacts:** parents via the links contract, local-first revocation, adding contacts from a link, blocks.
- **Budgets** per sender, per domain and per owner, plus §12.1 public-request limits.
- **Spam tiers** apply after custody: model-pinned thresholds, calibration mode, heuristics that never reject, an allowlist, and a 500-item / 7-day recoverable Rejected view. Bridged intake checks provenance.
- **Delegation:** status caches and a recheck sweep quarantine items when a revocation is learned.

23 simulator tests; BindleBox suite 93/93. [Review](docs/release/bindlebox-receive-review.md): BB2-R1–R8 fixed (orphaned staged bodies, body overwrite on conflict, refusal amplification, intake dedup binding, occupant self-calibration, spoofed allowlist, incomplete erasure, allowance overspend). BB2-I1 open: owner policy changes do not yet clear cached audience decisions. Operation registration is left for integration. Reviewer ___ Date ___ Outcome ___.

LA2 landed (unmounted, flag off): the RFC 8628 provider for reviewed clients only, as engine `AppAction`s over a `deviceGrant` provider (`DeviceAuthorize`, `DeviceToken`, `DeviceReview`, `DeviceApprove`, `DeviceRpc`, `DeviceCancel`, `DeviceLineageDrain`). DPoP-bound access and refresh, single redemption, lineage checks on every refresh and RPC. The wiring contract for LA3 is in linked-approval §10.2. App lifetimes per user decisions now apply to every app grant: no absolute limit, `APP_REFRESH_IDLE_DAYS`=180, `APP_ACCESS_TOKEN_MINUTES`=15, `APP_DPOP_ACCESS_TOKEN_MINUTES`=60, a 30 s grace, live checks on refresh and RPC (RPC already rechecked grants). App approval duration choices are now `ongoing` (default), `1h` and `8h`, consistent with the later no-absolute-lifetime direction, superseding the earlier 1 h default. 13 tests with seeded single-redemption chaos. [Review](docs/release/linked-approval-review.md): LA2-S1, S4–S7, S9, S11 fixed. Open: SDK token ceilings and `refresh_expires_in` semantics (a release blocker), `service.mjs` initial `issueAccess` still 5 min, LA4 duration list, LA7 `expiresAt:null`. Reviewer ___ Date ___ Outcome ___.

Wave 2a integration (Codex, coordinator-verified):
- SDK and federation lifetimes aligned (15 min bearer / 60 min DPoP access, rotating refresh, sliding 180-day idle, bounded history, child tokens, cleanup);
- approval choices `ongoing`/`1h`/`8h` with en/es copy and null expiry;
- the flag-gated activity resource descriptor, with consent → token → RPC coverage;
- Node egress preserves 404/410 and Cache-Control;
- the integrations spec example uses `fragment`;
- BindleBox operations and providers registered, and the CLI simulator wired with an end-to-end send → receive → verified receipt → status proof;
- CLI operation expectations derived from registries.

Gates: core 1595, Worker 55, UI-state 215, BindleBox 96, DOM, build, dry run, audit; browser gate 179 with 4 WebKit skips.

Wave 2a committed and deployed as 0b92f9a (flags off). Wave 2b started:
- Codex: LA5 requesting screen; CX-1 consent risk/wording model (`packages/consent`).
- Claude: IDKEYS-2 app key delegation certificates (24 h host-configurable maximum, provisional) with a public status endpoint; ACT-2 activity push policy.

IDKEYS-2 landed (provisional, flag off). `packages/identity/delegation.mjs` issues `key-delegation.v1` certificates as engine Actions/Queries:
- only to the messaging-ingress occupant reported by a fail-closed `DELEGATION_SLOT_OCCUPANT` port;
- only for consented author, receipt and archive purposes, with proof of possession, refusing identity-key aliases;
- signed with the current registry key; host-configurable lifetime `DELEGATION_CERTIFICATE_SECONDS` (24 h maximum, provisional);
- a new key revokes its predecessor, and renewal keeps `since`;
- revocation by key, by client or all; bounded history and audit.
Core encodes certificates itself, since it cannot import the protocol library; a cross-test pins compatibility. Public status `GET /identity/<sub>/delegations/<jkt>` gives uniform answers with `max-age=300`, immutable once a revocation is persisted. 14 tests. [Review](docs/release/key-delegation-review.md): KD-1/2/3/5/6/7 fixed, KD-8 partly fixed. KD-4 open as a production gate: uninstall and suspension hooks must revoke delegations, which needs lifecycle/suspension, EXT-X4 and C1b wiring. Reviewer ___ Date ___ Outcome ___.

CX-1 landed: `packages/consent/{effects,localization,reviewed-contracts,index}.mjs`.
- Four risk tiers.
- Wording precedence: 3sln.me catalogue, then contract publisher, then fallback, never the app, with factual attribution. App claims shown separately.
- en/es localization; feed-reader escalation.
- Unreviewed apps refused tier-4 requests.
- Engine queries unmounted and default-off.
25 tests. Integration must supply verified metadata snapshots and a registrable-domain resolver.

LA5 (Codex) implemented the flag-gated requesting flow (start, poll, accept, cancel, locator validation, expiry, backoff, cancellation fencing; 14 harness tests). It stopped short of the visible screen because `ui/release-auth.mjs` and `release.mjs` were outside its ownership. The coordinator granted an exception for those device hunks, and the screen is being finished.

ACT-2 landed (provisional, behind `ACTIVITY_V2_ENABLED`): activity push policy as engine operations.
- Per-app, per-incarnation opt-in (default off).
- Ordered app-scoped rules overriding the app's priority claim (capped at normal).
- Mutes, quiet hours (fixed offset or IANA zone), digests, per-app and account budgets, collapse cooldowns, Web Push `Topic`.
- Generic lock-screen text unless both account and device consent.
- The leased outbox re-checks state before transport.
Owner operations are reachable only via the flag-checked `activityPush` RPC, avoiding ACT1-S10. [Review](docs/release/activity-design-review.md): R1–R7, R10 fixed. Open:
- R8: named zones deviate from the design; accepted as an improvement, pending design update;
- R9: preview enablement without device proof;
- R11.
Also pending: an outbox scheduler and `sw.js` rendering of activity notices. Core 1646/1646. Reviewer ___ Date ___ Outcome ___.

LA5 finished behind the default-off flag: device choice, link and code, locator-only QR, account confirmation, polling, expiry and cancellation. The legacy QR flow keeps working. 15 engine and 28 browser tests (en/es, 320/390/1440 px, light/dark). LA3 must mount the linked routes and add QR locator support.

Wave 2b verified: core 1646, Worker 55, UI-state 215, DOM, build, dry run. Codex full browser gate 178 with one provider-matrix assertion failure that passed 3/3 in isolation (watch for flakiness) and 4 WebKit skips.

Wave 2b committed and deployed as 5c46045 (flags off). Wave 3a started:
- Codex: BB-B5 BindleBox views/rules/tags/classify; BB-B8 app shell with workerd durable queue recovery tests; ACT-3 activity UI.
- Claude: LA3 device authorization mount; EXT-X4 connections domain (providing the occupancy ports and closing KD-4); BB-B4 conversations (option A, provisional pending user confirmation).

EXT-X4 landed (provisional, behind `INTEGRATIONS_ENABLED`): connections as engine operations over the app-connection record.
- **States:** configuring, active, degraded, manifest-invalid, suspended, disconnected (the spec's six). Every loss of authority bumps the generation.
- **Sources:** external integrations connect from X3 snapshots, built-ins from a provider registry.
- **Occupancy:** slot occupancy is the owner's ordered value, gated by declarations and contracts; exclusive replacement requires recent authentication.
- **Outbox:** a transactional outbox for X6, X7 and X8.
- **Ports:** `LINK_SLOT_OCCUPANT` and `DELEGATION_SLOT_OCCUPANT` are provided with a seat-incarnation `cnx`.
- **KD-4 closed:** durable cascades revoke delegations and link authority on disconnect, suspend, vacate, replacement and manifest invalidation. Account suspension severs all connections via hook, observed directory status and a lifecycle-epoch fence.
Minimal outside edits: port fallbacks in `account/links.mjs` and `account/identity.mjs`; a legacy `severed` hook in `accounts.mjs`. 14 tests. [Review](docs/release/extensibility-review.md#x4-implementation): R1 (high) through R7 fixed. Open: admin suspension and lifecycle freeze should call `connectionsSeverAccount` directly (integration pass). Core 1711, Worker 59. Reviewer ___ Date ___ Outcome ___.

Wave 3a Codex streams landed:
- **BB-B5:** BindleBox views, rules, tags and classify as default-off engine operations with owner overrides, idempotent Views, and classifier fallback with model-bound thresholds. The index queries KV metadata. Pending: composing `organizationProviders(...)` into the shell and connecting custody writers to `projectIncoming`/`removeIncoming`.
- **ACT-3:** activity center UI (feed with app attribution, facets, read/archive, push settings) behind the flag; 30 tests across languages, themes and widths. Needs `/api/config` to expose `activityV2Enabled`. Search and date filters are page-scoped; owner/system facets need backend data.
- **BB-B8:** default-off BindleBox Worker and Node shells, SQLite storage, HTTP-to-dispatch adapters, delegation renewal, manifests and transactional queue alarms. workerd tests prove recovery after remote custody with exactly one recipient effect, a BB-CUT prerequisite. 15 tests; the app'"'"'s own Worker dry run passes; handoff notes in `apps/bindlebox/worker/README.md`. Independent review pending.

Cross-stream issues for the integration pass: an unmapped import in `apps/web/src/bl/activity.mjs` (since fixed per ACT-3), contact-preview failures, `signup-views`/`ui-adversarial` e2e failures.

LA3 landed: the linked-approval and device-grant routes are mounted behind `DEVICE_AUTHORIZATION_ENABLED` via `packages/runtime/device-grant.mjs`, the identity/federation/site route hunks, a `FederationObject` subclass in the Worker and Node composition. `device-authorization.v1` is declared only when mounted. `/approve` loads the approval page, and the browser runner gained `E2E_DEVICE_AUTHORIZATION=1`. Worker-tested CLI and session flows, flag-off behavior and lineage drain; device e2e with the flag on 33/33. [Review](docs/release/linked-approval-review.md): LA3-S1–S5 fixed, S6 accepted.

Open:
- Node fetch sends a lone `Sec-Fetch-Mode`, so the mount relaxes spec §4.1 refusal (spec reconciliation needed);
- the SDK should back off on 429/503;
- production `/approve` inline sign-in lacks Turnstile (gate before enabling).

Full e2e with the flag on had 4 failures: legacy QR worker-flow (passes with the flag off), a flaky contact composer, and two embed/Firefox cases. Reviewer ___ Date ___ Outcome ___.

BB-B4 landed (provisional, unmounted; option A pending user confirmation): `packages/bindlebox-engine/domains/conversations.mjs`.
- Create, invite and accept in both directions; groups via relayed introductions and `acceptListed` hellos.
- Per-recipient signing with stream heads persisted before signing; audiences frozen through BB-B3.
- An edge pair-gate with single-transaction admission.
- Remove, readmit, leave, block; the live group bound.
- Edit/retract history with pending mutations.
- Secret rotation as a proposal with a 7-day overlap and conflict flags.
- App-switch rejoin with a digest-bound secret-share; honest per-recipient status.
- One delegate-key snapshot per operation, avoiding the IDKEYS-1 race.
22 simulator tests (5-party mesh across three hosts). [Review](docs/release/bindlebox-conversations-review.md): BB4-S1–S9 fixed, none critical or high.
Open for integration:
- BB4-I1: B3 retries reuse the original certificate, so tasks older than 24 h fail and need renewal on retry;
- BB4-I2: B3 task rows keep secret parts after completion;
- BB4-I3: spec reconciliation (awaiting-secret 503, one epoch per event, no members beyond genesis, proposal auto-accept versus §6.3);
- BB4-I4: registration and composition.
Reviewer ___ Date ___ Outcome ___.

Wave 3a integration (Codex, coordinator-verified):
- BindleBox composition of conversations, organization providers, ingress, edge flushing and custody indexing, with a three-party shell simulator test;
- send retries renew expired delegation certificates, and completed-task secrets are purged with bounded cleanup (BB4-I1/I2);
- four spec deviations reconciled as provisional, with genesis-only membership enforced (BB4-I3);
- `activityV2Enabled` exposed in config;
- admin suspension and lifecycle freeze/tombstone call connection severance directly;
- SDK device polling backs off on 429/503;
- Turnstile on `/approve` inline sign-in;
- precise Node lone `Sec-Fetch-Mode` handling in the spec;
- fixes for QR test supersession, asset-build and inspector-port races, and provider image readiness.

Gates: core 1726, Worker 60, UI-state 215, BindleBox 157, DOM, build, dry run, audit; full e2e 179 with flags off and 179 with device authorization on (4 WebKit skips each).

Wave 3a committed and deployed as 08ac4a7 (flags off; `/approve` returns 404 with the flag off). Wave 3b started:
- Codex: LA7 devices/revocation UI, CX-2 consent walkthrough screens (mock-first for the new intents), IA-3 SDK incremental helpers.
- Claude: IA-1/IA-2 incremental authorization backend and suppression; EV-2 3sln.me-hosted event bus engine with long-polls in a separate Durable Object; BB-C1b link handoff to the messaging occupant (closing the evaluate author-proof item) plus BB-B7 bridge receiver.

BB-C1b and BB-B7 landed (behind `BINDLEBOX_ENABLED`, local only).

C1b:
- Links `evaluate` now requires a host-verified author-signed envelope (`packages/links/author-proof.mjs`), closing C1a review items 1, 4 and 5.
- Contact links resolve to the current occupant's ingress at the provider (edge-stage route, uniform 503).
- A link-type → slot table and the messaging-address declaration row.
- The links contract is a resource method building the app actor only from verified context.
- Links stay with the slot when the occupant changes (provisional).

B7: bridged intake is checked (consumer, provenance), deduplicated and stored as an unverified channel item, classified later, with no reply path.

Tests: core 1812, Worker 61. [Review](docs/release/link-handoff-bridge-review.md): LH-1, 2, 4, 5, 7a, 8 fixed. Open:
- LH-3: needs the X4 connection ID in the occupancy port;
- LH-6: conditional links cannot admit authors from other hosts (provisional);
- LH-7c/d: B2 never prunes tx/jti rows, and the B8 shell does not call the bridge yet.

Not yet wired: provider `describe` (EXT-X7), adapter `mounts.messagingAddress` and federation routing for the links contract. Until then descriptors answer `recipient_unavailable` and nothing is advertised. Reviewer ___ Date ___ Outcome ___.

EV-2 landed (provisional, behind `EVENT_BUSES_ENABLED`): the 3sln.me-hosted bus as engine operations in `packages/events` and the `events` domain.
- **Owner:** one bus per manifest per account, built only from the reviewed registry and revalidated with EV-1.
- **Publish:** schema-checked, host-stamped producer, opaque receipts, a 24 h publish journal (never under 10 min).
- **Order:** one total order per bus; retention, cap and purge losses always reported as gaps.
- **Readers:** start at approval unless the owner opts in; cursors are MAC-bound to the read approval; grants are checked live and again at commit.
- **Allowance:** a separate event allowance with publisher shares; charged empty reads draw a separate 25% readers' share (a provisional deviation from §9).
- **Long-polls:** leased in the account object and held in a new `EventBusWaiter` Durable Object (binding `EVENT_BUS_WAITS`, migration v8).
31 tests including chaos ordering and workerd. [Review](docs/release/events-consent-review.md#ev-2-implementation): S0–S3, S6 fixed; S4 partly fixed; S5 accepted.
Integration hunks needed before apps can reach buses:
1. federation passes `context.grant {fragment, digest, readSince}`;
2. bus descriptors in the federation resource provider;
3. `/bindle/rpc` holds long-polls at the edge via `holdBusRead`;
4. approval and revocation call `eventBusReader`;
5. the account alarm calls `eventBusSweep` (S4, a gate before enabling).
Reviewer ___ Date ___ Outcome ___.

IA-1/IA-2 landed (provisional, unmounted, `INCREMENTAL_AUTH_ENABLED` off): `grant-more` and `configure` entry intents as engine operations.
- **Results:** granted / partial (with the full current grant) / declined; configured / unchanged.
- **Tokens:** issued only when a commit actually changed a grant, and a new session never outlives the newest existing one.
- **`configure`** never calls the grants port. Suggestions are taken per field, and URL, email/host, marked and shared fields need their own confirmation.
- **Suppression** is per app site, covering own-host versions and `supersedes` chains. Apps see only declined/unchanged, with identical dwell and counters.
- **Caps and cooldowns:** 3/h, 6/d, 20/30 d; ladder 24 h / 7 d / 30 d counting only owner decisions. Server-enforced 1.5 s minimum dwell.
- **Tier 4:** unreviewed apps cannot ask for tier-4 access.
36 tests. [Review](docs/release/events-consent-review.md#ia-implementation): IA-R1 high (unreviewed act-as-you when a contract was missing from consent facts) and R3–R10 fixed. **IA-R2 open, a release blocker:** re-running `login` with extra fragments on an existing connection bypasses suppression, caps and cooldowns.

Wave 3b Codex streams landed:
- **IA-3:** lazy SDK incremental helpers with full-grant outcomes, fresh configure reads, no automatic consent retries; two-line transport hook in `flows.mjs`.
- **LA7:** devices UI with lineage, last use, lifetime and cascade confirmations, plus approval notice templates with an injected delivery adapter. App-family listing, full app-session lineage and one/all session revocation need backend work; notice host wiring and service-worker rendering are outstanding.
- **CX-2:** default-off mock-first consent walkthrough with risk groups, attributed descriptions, separate app claims, inline setup, partial grants and explicit settings suggestions; 43 tests. Configure-in-embed uses the plain-page fallback pending IA-4.

Wave 3b integration started: IA-R2 fix (Claude, owns the incremental, suppression and authorization-entries modules) in parallel with the wiring pass (Codex, everything else).

IA-R2 closed: re-running `login`, select-account or reauthenticate with extra access on an existing connection (counted per app site) is treated as a `grant-more` for caps, cooldowns, suppression and tier-4 refusal. Alternating login and grant-more lands on the same counters. Blocked items are trimmed to access already held, so the app sees a plain decline. Requests become optional, and consent marks additions via `incrementalLogin`; the CX-2 UI must render this (verify after the wiring pass). The re-review found and fixed:
- IA-R2a (high): a fresh sibling client ID counted as a first connection; "existing" is now per app site;
- IA-R2b (medium): a suppressed login item stepped no cooldown, distinguishing it from a decline;
- IA-R2c (low): a decision counted for every selecting account; now only the decider's.
41 IA tests. Reviewer ___ Date ___ Outcome ___.

Wave 3b wiring (Codex):
- **IA/CX:** durable ports, token and 429 `owner_review_uri` wiring, real consent views and decisions, exact intent and result vocabulary, DPoP handling, superseded pages.
- **EV-2:** grant context, descriptors, edge-held long-polls, approval/revocation hooks, sweep continuation, reconnect-safe reader epochs.
- **BindleBox:** connection-ID checks (LH-3), tx/jti pruning (LH-7c), B8 bridge dispatch (LH-7d), messaging-address mount evidence; EXT-X7 `describe` deferred.
- **LA7:** app session inventory, lineage and last use, one/all revocation, host approval notices, service-worker rendering.
- **Tests:** configure-view parsing, sign-out confirmation flows, a beaming fixture race.

Gates: core 1827, Worker 63, UI-state 253, BindleBox 162, both full e2e configurations (WebKit skips only).

Follow-ups assigned to the IA agent: replay test stabilization, resumable setup retry after a partial commit, and CX-2 rendering of `incrementalLogin` additions (missing).

IA handoff closed:
- replaying an incremental code revokes its single issued session exactly once under any interleaving (15 stable repeated runs);
- committing decisions journal validated approvals and setup values before saving, so retries after a partial failure resume without redoing work, while a different decision or cancel is refused during the attempt;
- consent shows login additions on existing connections as "New access requested by ‹app›", separate from "Already granted to ‹app›" (en/es).
The partial-failure path is exercised with fault-injected ports, not through the real Node ports. Gates: core 1829, Worker 63, UI-state 256, BindleBox 162, consent 24+26, approve 14, DOM, build, dry run.

Wave 3b committed and deployed as c1468d8 (flags off; full browser gate 184 with 4 WebKit skips). Wave 4 started:
- Codex: EXT-X10 built-in classifier occupant and Drive manifest, BB-B9 BindleBox web UI with cutover browser prerequisites, IA-4 embedded request element.
- Claude: EXT-X6 integration event outbox (signed SET snapshots), EXT-X7 resource discovery, brokered records and `describe` (unblocking messaging descriptors), BB-B6 encrypted archive in the owner's storage plus app-switch export/import.
EV-3 push doorbells follow X6.

Wave 4 Codex streams landed:
- **EXT-X10:** built-in classifier occupant (`packages/runtime/account/classifier.mjs`) over the existing `ai` provider, requiring an explicit `CLASSIFIER_MODEL_VERSION`; slot manifest `docs/artefacts/slots/item-classifier-v1.json`; Google Drive as a built-in integration with existing connector behavior unchanged; 17 tests. Provisional `pre-dispatch` failover, since X4 rejects `any-error` without contract pins. Pending: register the recognized slot, update BindleBox'"'"'s placeholder URL and copy, wire artifact publication and discovery. Live Clef accuracy unverified.
- **IA-4:** request element modules, an `apps/embed/src/parts/request.mjs` island part, default-off with activation checks, exact-origin popup results and redirect fallback; an IA-3 `prepareOnly` hook; 14 engine tests plus 18 browser checks in Chromium and Firefox. Pending: embed boot/shell/worker/channel wiring, element registration, backend acceptance of embedded incremental delivery.
- **BB-B9:** default-off BindleBox web client on ngin/dodo (en/es; delivery counts, Retry missing, SSE recovery, drafts, Views, rescue, B6 handoff controls). All six cutover browser prerequisites pass across locales, themes and widths; 41 tests. Pending: shell mounting/B6 port composition, verified contact resolution for new conversations, Rejected body reads. Timeline transfer is unbounded (`apps/bindlebox/web/README.md`).

EXT-X6 landed (provisional, behind `INTEGRATIONS_ENABLED`): `packages/runtime/integration-events.mjs` drains the X4 outbox into coalesced per-connection rows and delivers RFC 8417 SETs signed with the event-purpose brokering key.
- Each SET carries exactly the §6.1 claims, a strictly increasing per-connection `seq`, and a minimized snapshot.
- Revocations are delivered first and in every state.
- Leased attempts are re-signed with the same `jti` and retried with backoff (10 s initially, at most 1 h apart) for 72 h, then degrade the connection or record an unacknowledged revocation.
- SSRF-safe egress (Node DNS-pinned; Worker strictly public plus DoH).
X6 owns the X4 outbox cursor, so a second consumer needs its own. 12 tests plus conformance. [Review](docs/release/extensibility-review.md#x6-implementation): S1/S2 medium (revocations refused at caps; serialized retries) and S3–S6, S8 fixed; S7 open. Integration pending: `AccountController.alarm` calls `integrationEventsAlarm`, X4 commits call `integrationEventsKick`, and `INTEGRATION_EVENT_PORTS` composition (signer, egress, X8 snapshot port). Reviewer ___ Date ___ Outcome ___.

EXT-X7 landed (provisional, flags off).
- **Discovery** is provider-only: signed 60 s tokens, SSRF-safe egress, 64 KiB / 100-item bounds, item-level validation, a 5-minute cache, and per-connection/account/integration/process budgets with per-connection cooldowns.
- **Brokered records:** fresh authenticated lookup, slot-pinned contracts, generation and incarnation fencing, §4.4 revalidation, severance rows for X8, and a `mintable` hook.
- **C1b `describe`:** ingress bound to the client_id origin. The mailbox describe uses purpose `invoke` (feature `messaging-address`, 60 s), per bindlebox §2.2 and integrations §5.5.
21 tests. [Review](docs/release/extensibility-review.md): X7-R1–R5, R7 fixed; R6 moot. Open:
- Node DNS-pinned POST egress;
- the §8 hint endpoint (needs an issuer-wide connection → account directory);
- AMD-C10 checks;
- X8 draining.
Production wiring needs `BROKERING_MINT`, `INTEGRATION_EGRESS` and `MESSAGING_DESCRIBE`; until then messaging descriptors stay `recipient_unavailable`. Reviewer ___ Date ___ Outcome ___.

BB-B6 landed (provisional, default off, unmounted): an encrypted, signed archive in the owner's storage, plus app-switch export and import.
- **Archive:** history and contacts written as objects encrypted to the owner's identity key; key-holder access only with a fresh proof from the occupant's key; compaction, crash-safe resume, writer lease.
- **Switch:** import only against the exact export, absent-only and resumable, then rejoin.
- **Retention:** tombstones are never resurrected; rollback is refused.
- **Capacity:** archived send obligations leave the queue; old objects are reclaimed.
Unresolved obligations from the old app become a resend list rather than automatic re-signing. Spec §10 deviations are recorded. 17 simulator tests. [Review](docs/release/bindlebox-archive-review.md): BB6-S1–S6, S9–S11 fixed. Open:
- BB6-S7: new traffic is not held during import (gate before enabling; needs receive, conversations and shell changes);
- BB6-S8: imported envelopes are not re-checked;
- the real key-holder port;
- BB-B2 stages large bodies in user storage in plaintext.
Core 1904/1904. Reviewer ___ Date ___ Outcome ___.

EV-3 landed (provisional, behind `EVENT_BUSES_ENABLED` and `INTEGRATIONS_ENABLED`): push is a data-free `bus-advanced/v1` SET on the X6 channel, carrying only the subscriber's own bus ID and visible head.
- At most one doorbell pending per subscription, at most one sent per 5 s, with a 31-per-hour fair share per subscription.
- Its row budget is separate and lowest priority, so it never blocks owner writes or revocation SETs.
- A mandatory live grant check port (`doorbellGrant`); send-time checks fail closed.
- Subscribe caps of 8 per connection, 16 per bus and 64 per account.
[Review](docs/release/events-consent-review.md): R1, R1b, R3–R5, R6a–c fixed (not re-reviewed). Residuals: subscribe caps hint at other subscribers; a subscribed bus wakes the alarm on every publish. The app-initiated push request via `configure` (Q11) is not built.

Wave 4 streams complete. Wave 4 integration started (Codex).

Wave 4 integration (Codex, coordinator-verified; [notes](docs/release/wave4-integration.md)), all behind existing default-off flags:
- **X6:** alarm and kick hooks, signing and egress ports on Worker and Node.
- **X7:** minting, discovery and messaging `describe`; Node DNS-pinned POST transport.
- **EV-3:** subscription routing, publish kicks, live grants, revocation cancellation, owner push controls.
- **X10:** canonical classifier slot registration, publication and discovery.
- **IA-4:** SDK registration, embed wiring and attested incremental popup delivery.
- **B9/B6:** mounted clients, archive ports with a development key holder, verified contacts, Rejected reads, pagination.
- **B6 gates:** import holds (S7), imported envelope and body verification (S8), and encrypted staging of large bodies, with regression tests.

Gates: core 1929, Worker 65, UI-state 258, BindleBox 194, BindleBox web 41, DOM, build, dry run, audit; full e2e 180 with flags off and 180 with device authorization on (4 WebKit skips each).

Deferred: the X8 snapshot stub, X7 hints/AMD-C10, app-initiated push configuration, production key-holder/service verification. Legacy or redacted imports remain explicitly unverified.

Wave 4 committed and deployed as 4829b79 (flags off). Wave 5 started:
- Codex: EXT-X11 unified Apps & integrations console, CX-3 access views ("what this app can do"; who has access per fragment, resource and bus), EV-4 integration-hosted bus conformance suite.
- Claude: EXT-X8 `preferences/v2`, brokered token minting, live introspection for write contracts, and severance with a guaranteed bound.
EXT-X9b conformance follows X8; then BB-CUT.

Wave 5 streams:
- **EV-4:** integration-hosted bus conformance suites (host and client) with a default-off engine fixture `tests/fixtures/integration-bus.mjs`; narrow `packages/events/client.mjs` validation fixes (malformed records/metadata, reader claims/bounds, publish receipts); third-party instructions in `docs/integration.md`. 18 tests plus 13 adapter tests.
- **CX-3:** flag-gated access components in `apps/web/src/ui/access/**` with en/es copy, CX-1 risk tiers, attributed wording and explicit revocation confirmations; 28 tests. Removal revokes the whole fragment, since method narrowing is unavailable. Shell composition, request history and integration-hosted feed management pending.
- **EXT-X11:** the Codex job stopped mid-way on a "model at capacity" error; a Claude agent is finishing from the partial work (fallback per user preference).

Watch items: islands Firefox theme and Chromium avatar timeouts in one broader e2e run; a `brokered-severance` 403 in the X8 work in progress.

EXT-X11 landed (provisional, behind `INTEGRATIONS_ENABLED`; started by Codex, finished by Claude): one Apps & integrations console listing apps, external integrations and built-ins with state and verified host.
- Built-in and external connect; setup through config fragments.
- Slot occupancy per selection policy; exclusive replacement needs a reviewed confirmation and inline step-up.
- Picking third-party resources through X7 discovery.
- Disconnect with the cascade explained.
- Manifest-pinned management links, the creation-hint management link (integrations §4.5), and CX-3 access links; cancel keeps the setup draft.
18 engine tests and 13 Chromium checks (en/es, light/dark, 320/390/1440 px; screenshots in `artifacts/browser/connections/`). Pending: shell mounting; server adapters for the X4 owner RPC, setup save and SSRF-safe client-metadata lookup (no HTTP routes exist yet); approving staged manifests. Reviewer ___ Date ___ Outcome ___.

EXT-X8 landed (provisional, flags off, unmounted):
- `preferences/v2` returns uniform references; brokered members carry an endpoint, the resource, a 300 s RFC 9068 token and exact methods. v1 withholds brokered members (AMD-C3/C9).
- Minting checks, signs, then rechecks against X7 severance, and the federation shard checks before and after, so a released token's `exp` is at most commit + 300 s.
- Severance rows drain into X6 revocations carrying `access_ends_by`.
- RFC 7662 introspection with `private_key_jwt` and pinned keys; write methods are mintable only while introspection is mounted.
- A `brokered-resources.v1` registry row; `brokering_jwks_uri` stays top-level until that row is declared.
18 tests. [Review](docs/release/extensibility-review.md#x8-implementation): R1, R3, R4, R6 fixed; R2 partly fixed; R5, R7 open. The agent ran a prohibited `git checkout --` on three test files containing only its own edits; no other agent was affected.

Wave 5 integration (provisional, flags off; Codex started, Claude finished after Codex capacity errors):
- **X8:** a single mount setting, `BROKERED_INTROSPECTION_MOUNTED`, enables together the introspection route (own rate limit), the `integrations.v1` and `brokered-resources.v1` declarations, minting, the severance drain and the snapshot port (R7 closed). `brokering_jwks_uri` moved into `brokered-resources.v1`. R2 is closed except that grant IDs don't rotate on reapproval; only a changed field revokes tokens. R5 partly fixed (verify read-only, per-IP limit).
- **X11/CX-3:** the connections console and access views are mounted behind `INTEGRATIONS_ENABLED`, with owner action, setup save, SSRF-safe client-metadata lookup and staged-manifest approval routes. The domain library is vendored as `vendor/tldts` (7.4.19, MIT, provenance recorded) in place of a bare npm import, which had broken beaming and multi-account e2e. Request history needs an audit store that does not exist.
- **X9b:** the integration conformance suite has no remaining todos, and third-party docs are added.
- **Islands flakes fixed at root:** Chromium avatar swaps waited on rAF, which hidden frames never run; Firefox restores that lost the race with the code exchange backed off 2/4/8 s, now starting at 250 ms. Each has a regression test.
- **Security review:** S1 high (token-endpoint auth downgrade), S2, S3, S5 fixed; S4, S6 partly fixed. Open: a durable assertion-replay store, hints and `bindle_connection` support, and a diff in the review screen.

Gates (coordinator-verified): core 1980, Worker 65, UI-state 290, BindleBox 194/41, DOM, build, dry run, audit; e2e 213 twice (flags off and device authorization on, 4 WebKit skips each). Reviewer ___ Date ___ Outcome ___.

Wave 5 committed and deployed as 4aa7b46 (flags off). All roadmap waves through Wave 5 have landed. BRIDGE (Wave 7) started ahead of BB-CUT, since it does not depend on the cutover. BB-CUT awaits explicit user confirmation of the irreversible message data reset.

BRIDGE landed (provisional; behind `EMAIL_BRIDGE_ENABLED` and `BINDLEBOX_ENABLED`, plus an owner opt-in, all default off): `packages/email-bridge/*` (engine, MIME parser, reply builder, Worker adapter, `EmailBridgeObject`, Node adapter) and the Worker `email` handler.
- **Intake:** bounded MIME parse with one generic SMTP refusal; a holding queue per owner.
- **Provenance:** SPF/DKIM/DMARC recorded as provenance only, and trusted only with `EMAIL_BRIDGE_AUTHSERV_STRIPS` operator attestation.
- **Replies:** automated mail never gets one. One invariant auto-reply goes only to aligned senders, under per-sender, per-domain, per-recipient and global limits plus a suppression list. The follow-up is sent once on acceptance, to a DMARC-validated sender.
- **Delivery:** to the public-message-intake occupant, fail closed.
Intake wire constants are restated locally (import boundary) and pinned to the protocol by test. [Review](docs/release/email-bridge-review.md): EB-1 high (trusting a sender-written Authentication-Results header), EB-2, 3, 6, 7, 8, 10 fixed; EB-4 timing partly mitigated by a 1.5 s floor; EB-5 open (BindleBox charges budgets by the unverified header From).
Pending core hunks: the `EMAIL_BRIDGE` binding and migration; account RPCs `emailBridgeEntitled`, `integrationsIntakeSeat` and `integrationsIntakeDeliver` plus a `PROVIDER_CONSUMERS` row; `EMAIL_BRIDGE_SIGNING_JWK` and key publication; owner routes and the acceptance hook.
Needing sign-off: a 7-days-less-1-hour hold (vs §13's 30 days); follow-up without mailbox confirmation; the authserv attestation. Not exercised against real Email Routing or reply(). Reviewer ___ Date ___ Outcome ___.

BRIDGE integration (Codex, coordinator-verified): `EMAIL_BRIDGE` binding and migration, account RPCs, brokered delivery to the intake occupant, signing-key publication, owner settings, acceptance follow-up, all behind default-off flags; production secret setup documented in the review. EB-5 fixed: BindleBox charges budgets by verified envelope and provenance data, with regression tests. Gates: core 2012, Worker 67, UI-state 290, BindleBox 196, DOM, build, dry run, audit; e2e 213 (4 WebKit skips). External Email Routing is unverified.

## 2026-10-21 — Consolidated open items; naming and threshold notes

[Open items and sign-off checklist](docs/release/open-items.md) consolidates:
- 37 pending owner decisions;
- per-flag production gates for 15 flag groups;
- open review findings (0 High, 6 Medium, 15 Low/Info);
- 22 unsigned sign-off groups;
- environment limits.
Where review tables lag DEVLOG, DEVLOG is treated as newer.

Corrections recorded here so the ledger matches the conversation:
- **App name.** The coordinator's "Parley" recommendation was withdrawn after a search found an existing enterprise messaging platform named Parley and a federated decentralized chat network named Parley. "Parlay" reads as a betting term. A naming pass with clash checks was offered and is pending the user.
- **Spam thresholds.** The coordinator suggested starting auto-reject at 0.98 rather than 0.97, pending the user.
- **Signup offer tension.** Offering a bundled messaging instance at signup must not conflict with "built-in occupants are never preselected"; the offer must be an explicit opt-in step, not a preselected occupant.
- **Roadmap update.** Conflict-resolution item 14 (30 d / 7 d app credentials) is superseded by the later lifetime model: no absolute lifetime, 180-day idle, 15/60-minute access tokens.

## 2026-10-21 — Feature flags (user direction; design only)

User direction: move feature flags from Workers variables to the admin console, with targeting (A/B, region, user, user shard, percentage). Design: [feature-flags.md](docs/architecture/feature-flags.md). No code changed.

User decisions (2026-10-21, relayed by the coordinator):
- **D-FF1:** env is a kill switch only. Enabling a feature must never need a deploy.
- **D-FF2:** build aggregate-only A/B/n experiments now.

Provisional design decisions (coordinator design, unsigned):
- **Registry and env kill switch.**
  - Flags are declared in a reviewed code registry and configured in the console.
  - If env is unset, the console decides. With no console record, the flag takes its registry safe value.
  - If env is explicitly the safe value, the flag is forced to it, even while the admin store is down. An invalid value counts as a kill.
  - Env `"true"` is honoured only while the flag has no console record (the pre-console state and admin-less self-hosts). After that it is ignored with a warning, so a stale `keep_vars` dashboard value cannot override a console kill.
  - The console shows each flag's env state: unset, kill, ignored, force-on (legacy) or invalid.

  Reviewer: ___ Date: ___ Outcome: ___
- **Cutover.** Seed, then verify, then remove the vars.
  - The seed copies the env values the server observes into console records, one audited commit per flag.
  - Seed-verify compares legacy and console evaluation over a context matrix.
  - Only then are the class (a)/(c) vars removed, from `wrangler*.jsonc` and from the dashboard.
  - Flags on in production today (signup, paid signup, waitlist, semantic search, beaming) stay on. `BILLING_ENABLED` is env-only, so it stays in env.
  - The Node adapter must stop defaulting class (a)/(c) vars to `'false'`, which would now be a kill.

  Reviewer: ___ Date: ___ Outcome: ___
- **Release gates.** No env ceiling enforces them any more. While `RELEASE_READY != 'true'`, any edit that widens a flag with open gates requires:
  - critical tier, passkey step-up, a reason, the typed flag name and a preview acknowledgement;
  - `acknowledgeGates` equal to exactly the open gate set, recorded in the hash-chained audit log.

  Widening only to verified internal accounts is exempt. A test keeps the registry's gate references in sync with open-items.

  Reviewer: ___ Date: ___ Outcome: ___
- **Classification.**
  - 11 rollout flags get targeting.
  - 8 are global-only console switches. Lifecycle dry run is narrow-only.
  - 20 stay env-only: secrets, bindings, mounts, protocol metadata, lifecycle live/purge, work and storage limits, and derived capability values.
  - Stateful flags never target by region.

  Reviewer: ___ Date: ___ Outcome: ___
- **Evaluation and storage.**
  - One synchronous `flags.evaluate(name, ctx)` over a snapshot pinned per request, exposed as engine provider and operations.
  - Percentage uses a salted murmur3 hash. Shard means the identity account bucket. Region comes only from trusted `cf` fields.
  - No anonymous bucketing and no new cookie.
  - Records live in `AdminStorage`, with audit and a monotonic version, cached per isolate and per colo (15 s each).
  - Last-known-good is served up to 1 h. After that each flag uses its outage policy: `safe`, or `last-known` for the signup, federation, brokering and MCP switches.

  Reviewer: ___ Date: ___ Outcome: ___
- **Stateful features.** Flags gate new creation and exposure, never retention. Reverse and cleanup paths ignore targeting. The optional `retainExisting` keeps owners who already have feature state enabled, using a predicate over existing data rather than a stored enrolment record.

  Reviewer: ___ Date: ___ Outcome: ___
- **Experiments (FF-7, in scope).**
  - Assignment comes from a hash of the account ID and a salt, frozen while the experiment runs. There is no per-user storage or event log.
  - Counters record per-variant daily exposure and outcome counts, plus a daily distinct-account HyperLogLog whose key and sketch are deleted at rollup.
  - Results appear only once every variant reaches 100 distinct accounts on at least one day. Cells below 20 are suppressed. Results are deleted 90 days after the experiment concludes.
  - Admins start, stop and conclude experiments in the console.
  - Experiments are forbidden on critical, pricing, limits, consent, security and lifecycle flags.
  - The design matches privacy.md §3, which now states the 90-day result retention and the transient daily key.

  Reviewer: ___ Date: ___ Outcome: ___
- **Lifecycle and abuse limits stay env-only**, with a console "pause lifecycle" control that forces dry run. **One administrator** can make critical edits with the extra confirmations; no second approver. Both were recommended and accepted as provisional via the coordinator relay. Reviewer: ___ Date: ___ Outcome: ___

Slices FF-1…FF-8, including FF-7 for experiment statistics, are in the design §10 with non-overlapping file ownership.

## 2026-10-21 — Privacy policy and terms of service

User requested a privacy policy and terms for 3sln.me. Drafts are in [docs/legal](docs/legal/README.md), written against an evidence-backed inventory of the as-built system at f6d3820. Features behind default-off flags are written as "if you use" / "when available". The drafts are not in effect and need counsel review. Placeholders: company, address, country, governing law and venue, refund policy, EU/UK Art. 27 representatives.

- **Operator and scope.** The policies name a company (name pending) with contact@3sln.com and cover only the hosted service. Self-hosters need their own documents. Reviewer: ___ Date: ___ Outcome: ___
- **Privacy regimes.** The policy covers a global baseline: EU/UK GDPR legal bases, transfers and rights, plus US state notices. It states plainly that content is not end-to-end encrypted and that the operator's systems can read it. No sale, no ads, no third-party analytics. Reviewer: ___ Date: ___ Outcome: ___
- **Age rule (user decision).** Each jurisdiction requires the minimum age at which signup is lawful without verifiable parental consent or mandatory age verification, confirmed by a self-attestation toggle "I am older than N". Jurisdictions where a toggle cannot satisfy the law are blocked. The research snapshot and recommended config are in [age requirements](docs/release/age-requirements.md). Proposed blocks: CN, BR, ID, TR, RU, US-MS, US-TN, plus sanctioned territories. Paid plans require local majority. Not implemented yet. Reviewer: ___ Date: ___ Outcome: ___
- **Publication blockers.** The drafts commit to features the system lacks: owner account deletion, hosted data export, email removal, the age gate, terms re-acceptance on version change, and `/privacy`/`/terms` pages with footer and client-metadata links. These are tracked in the [legal README](docs/legal/README.md). `release-status.json` `termsAndPrivacyApproved` stays false. Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Feature flags FF-1–FF-4, FF-6, FF-7 implemented; legal plumbing

User decisions on the [feature flags design](docs/architecture/feature-flags.md):
- **D-FF1:** env variables are kill switches only. Enabling a feature never needs a deploy.
- **D-FF2:** aggregate-only A/B/n experiments are in scope now.

Landed behind the existing env behaviour. With no console records, evaluation reproduces today's flags exactly, pinned by a test over the current Worker and Node configurations.

- **FF-1:** registry of 39 flags, pure evaluator, monotonic salted percentage hash, snapshot validator, `widens()`.
- **FF-2:** versioned store in `AdminStorage` with the shared audit chain. Covers seed, seed-verify, take-control, update, rollback, reshuffle, gate acknowledgement and experiment lifecycle.
- **FF-3:** `flags.*` engine operations, memory providers and CLI.
- **FF-4:** per-isolate and per-colo caches, last-known-good fallback, trusted `cf` geo, monotonic writer refresh, Node pass-through of unset vars.
- **FF-6:** admin HTTP adapter and console screens: list, edit, preview, explain, history, seed/cutover and experiments. Each save verifies a passkey, because sessions lack credential-method evidence.
- **FF-7:** experiment statistics. Daily counters with a transient HLL key deleted at rollup, 100-account minimum cohort, suppression of cells below 20, 90-day expiry. Worker `FLAG_STATS` Durable Object (binding and migration v10 added) and a Node SQLite store.

Remaining work:
- FF-5a/b/c: migrate read sites off raw env.
- FF-8 cutover: seed, verify, then remove class (a)/(c) vars from wrangler and the dashboard. This is an operator step.
- Production colo propagation is unverified.

**LG-1 and LG-1b (legal plumbing).**
- `/privacy` and `/terms` are built from `docs/legal`, show a draft banner, and are linked from the footers, consent and discovery metadata (`op_policy_uri`/`op_tos_uri`). Client `policy_uri`/`tos_uri` are displayed.
- The per-jurisdiction age gate is in `packages/identity/age-policy.mjs`. It uses trusted `cf` country and region only and is enforced on the server for signup, onboarding claims and paid checkout. Blocked regions see a localized screen. Attestation is recorded, never a birthdate.
- Terms re-acceptance applies when the stored version differs. Cookie, bearer and RPC write paths are gated; reads, export and deletion are not. It is idempotent under concurrent tabs.
- Spanish legal pages show the English text with a localized notice.
- `TERMS_VERSION` is unchanged.

Verification on the integrated tree:

| Suite | Result |
|---|---|
| `npm test` | 2112 pass |
| Worker | 69 pass |
| UI-state | 291 pass |
| admin-flags | 7 engine + 27 Chromium |
| legal | 10 + 37 |
| DOM, build, Worker dry run | pass |
| e2e | 214 pass, 4 WebKit skips (environment) |

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Account deletion and export design

[Design](docs/architecture/account-deletion-export.md), with independent review round 1: 4 High, 12 Medium, 11 Low; 26 resolved in text.
- **Single executor.** Owner, admin and inactivity deletion all run through it.
- **Grace period.** 14 days, or 30 after a recent security change. The security epoch is a dedicated field, not the 100-entry log.
- **Ordering.** Billing is stopped first, then the identity is tombstoned early, before content deletion.
- **Export.** Streamed tar archive with session-cookie download, step-up, notices and rate limits.
- **Email removal.** Requires a waiver if no channel would remain.

The review found that the existing flag-off inactivity purge shares the bugs fixed in the design: alarm shelving hides blobs, search backfill recreates embeddings, and export cleanup is missing. Fix these before `LIFECYCLE_PURGE_ENABLED` is ever enabled.

Open: R1-M12, BindleBox data on account deletion. Recommendation: cascade via an owner-deletion event to operator-run apps. This must be decided before any deletion flag is enabled. Flags: `ACCOUNT_EXPORT_ENABLED`, `ACCOUNT_DELETION_ENABLED`, `EMAIL_REMOVAL_ENABLED`.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Organizations (design in progress)

The user requested "workspaces" for teams and companies:
- independent users;
- per-user grants;
- relationships between self-contained units that change over time;
- inter-entity sharing;
- private membership checks through elements;
- an entity switcher.

The user's first use is their own company ERP.

- **Term.** "Organization" accepted by the user. "Entity" stays the umbrella term ([terminology](docs/architecture/organizations-terminology.md)). Reviewer: ___ Date: ___ Outcome: ___
- **Cross-provider membership is core (user clarification).** Members from any provider sign requests with a key certified by their home provider. Verification chain: home manifest → `directory.v1` identity document → member certificate → DPoP proof → live grants. There is no org sign-in. Certificate acquisition is unspecified (elements, fallback Bindle flow, device grant). The goal is proof of origin attested by the home provider; passkey-signed approvals are optional later. Reviewer: ___ Date: ___ Outcome: ___
- **Status.** [Design](docs/architecture/organizations-design.md) rev 3 and [spec](docs/spec/organizations.md) rev 2.
  - Review round 1 found 5 High, 8 Medium, 8 Low.
  - Review round 2 found 3 High, 8 Medium, 3 Low. All Highs are fixed in text: uniform errors and no request-triggered fetch for non-members; the identity document URL comes only from the directory or a pin; key states only move forward, with no revoked-key resurrection.
  - Open: certificate lifetime (recommend 300 s mandatory), home key reset restoring access immediately, and correlation (later: certificates encrypted to the org).
  - Foreign issuers stay behind an empty allowlist until the Workers outbound-fetch gate passes and an independently written spec-only issuer passes the tests.
- **Pending user decisions.** Signing model confirmation, the org issuer location, the two-admin deadlock, and certificate lifetimes. Accepted-provisional recommendations: no roles (per-member grants plus copy-on-apply templates), paid-only at launch, grantor-initiated offers, and a minimal ERP phase A that includes cross-provider members.

## 2026-10-21 — Feature flags FF-5 complete

FF-5a/b/c migrated read sites in routes, the account writer and jobs, and domain packages to `flags.for(ctx)`. FF-5d integrated them:
- adapters and mounting;
- legacy parsing reproduced per flag;
- verified owner and client context for protocol flows;
- device, incremental and email-bridge flags marked non-retainable with justifications;
- `search_result_opened` left unrecorded, since there is no server signal.

The raw-env guard now enforces everywhere with zero violations. With no console records, behaviour is unchanged, pinned by equivalence tests. Account-targeted bootstrap values are sent with `Cache-Control: private, no-store`.

Remaining: the FF-8 cutover. This means seed and verify in the console, then remove class (a)/(c) vars from wrangler and the Cloudflare dashboard (`keep_vars`). It is an operator step.

Gates:

| Suite | Result |
|---|---|
| `npm test` | 2130 |
| Worker | 70 |
| UI-state | 291 |
| admin-flags | 34 |
| legal | 47 |
| DOM, build, dry run | pass |
| e2e | 214, 4 WebKit environment skips |

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Organizations rev 4: relations (user proposal adopted)

The user proposed public relation documents: named slots with arity and a fragment-access matrix (optionally narrowed by field), opted into by org admins as instances. Multiple instances and slots are allowed, and everything is shared via preferences fragments. The proposal also covers org and user credentials for provenance, separate identity and organization provider roles, and product rules: an account is required to create an org, orgs are always paid, and pricing is tiered first, metered later.

Design rev 4 and spec rev 3 adopt the proposal as the user-facing model, replacing offers and cross-entity tokens. A relation document grants nothing by itself. Each edge needs grantor fragment consent and grantee acceptance. Slot names never authorize. The primitive count drops from 11 to 10.

Entity certificates carry resource and methods (review round 3, H1). Imports are never included in fragments granted over an edge (H2, re-sharing by composition). The ceilings for `reshare` and `actor_disclosure` come from the relation document. Writes use certificates under 60 s old, an effective 90 s with skew.

Review round 3: 2 High (fixed), 7 Medium, 4 Low.

Phase A is unchanged and forward-compatible: no relations, members from any provider, the ERP.

Pending user decisions (recommendations in the design):
- name: "Relation"/"Relationship" ("bond" clashes with finance terms);
- rename "slot" to avoid clashing with extension slots (reviewer suggests "position");
- admission for one-holder slots: creator only;
- counterpart key reset: suspend edges until confirmed;
- delegated admission: later, as an opt-in;
- membership stays separate from relations;
- the org issuer location, the two-admin deadlock, and the 300 s certificate lifetime.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Versioned artefact references (design)

User requirement: references between public artefacts carry integrity hashes. Artefacts change only additively, so a reference names a version plus that version's hash. Validators extract and check the named version, and providers cache the versions they pin.

The [design](docs/architecture/artefact-references.md) and the [spec draft](docs/spec/artefacts.md) (rev 2):
- **Envelope.** Each URL serves an envelope containing full-copy versions, each hash-chained to its predecessor (`{version, prev, body}`). The digest is SHA-256 over JCS. Old bodies can be offloaded to `<id>/versions/<n>`, up to 1,024 versions.
- **References.** A reference is the URL member plus `version` and `digest`. Parsing is strict, numbers are safe integers only, and no Unicode normalization is applied.
- **Additive rule.** Additions are allowed only at the growth points declared for each kind. New fields are withheld from grants pinned below the version that introduced them, and adding them counts as widening on upgrade.
- **Caching and retraction.** Providers store records by digest before a pin commits. Retractions are sticky. Suspending grants requires a publisher signature.
- **Migration.** Existing bodies become version 1, so existing digests are unchanged. The work ships behind the flag `ARTEFACT_VERSIONS_ENABLED`.

Review round 1 found 6 High, all fixed in the text: contract-digest equivocation, digest-mismatch denial of service, unconsented widening through result or bus fields, a preference digest join, the size-cap trap, and contradictory number rules.

Open items:
- Cross-provider equivocation needs a transparency log or gossip before cross-provider relations ship.
- Semantic additivity remains the publisher's obligation.
- Growth rules for the `relation` kind belong to the organizations design.

Recommendations pending user approval:
- serve the envelope at the canonical URL;
- an unsigned retraction only blocks new pins;
- contract result objects are open;
- no garbage collection of stored records in v1.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Organizations rev 4.2: per-edge admission, relation growth rules

**Admission (user decision).** Adding a party to a relation requires consent from every org whose slot grants to the newcomer's slot, each deciding independently with its own fragment values. Partial membership is a normal state. There is no global roster: each party's recognized set is its view, and arity is checked per party. Any party may propose a newcomer through an introduction event, which grants nothing on its own. Pending introductions surface in the activity center and expire after 30 days. A newcomer sees only the edges that are live. This resolves Q12 and turns review round 3's split-view finding into intended behaviour. Reviewer: ___ Date: ___ Outcome: ___

**Relation growth rules** (spec §9.2, per artefacts §6.3):
- New versions may append slots, matrix entries, and fields or methods, and may supersede an entry when following a newer fragment version.
- Slot ids, arity, existing entries, ceilings and text are frozen. Raising a ceiling requires a new relation id.
- Widening an edge's own slot pair needs grantor consent and grantee acceptance.

Validators treat `relation` as an unknown kind until these rules are signed off. Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Organizations rev 4.3: grant-management governance (user decision)

The user decided that changing or removing grants which themselves allow grant management (admin grants) requires the affected holder's consent or an elevation to the org owner, the account paying the bills. This is 3sln.me policy, not Bindle.

**Spec §6.3.** Grant management is provider policy that must be defined and disclosed before members accept admin authority. Four interoperable rules remain:
- admin invitations are bound to a specific member;
- an admin is held after account recovery;
- an org is never left with no one able to run it;
- relation edges never carry admin authority.

**3sln.me policy (design §12b).**
- **Changes by another admin.** These need the holder's consent, which expires after 7 days, or an owner elevation (passkey step-up, immediate notice to the holder, audit entry).
- **Self-resignation.** Free, subject to the last-admin guard.
- **Who the owner is.** The account that created the current subscription checkout. Changing the payment method never moves ownership. Ownership changes only by transfer, or by an admin repaying after a lapse with 72 h notice. Before billing exists, the creator is the owner.

**Resolved.** Q8, the two-admin deadlock: the owner prevails. Phase A now includes the owner of record, consent and elevation, the guards, and audit.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-21 — Account deletion and export: DX-1, DX-3, DX-4, DX-6 implemented and integrated

The slices are implemented per the [design](docs/architecture/account-deletion-export.md) and wired into the Worker and Node adapters behind default-off flags (`ACCOUNT_EXPORT_ENABLED`, `ACCOUNT_DELETION_ENABLED`, `EMAIL_REMOVAL_ENABLED`).

- **DX-1: export core.** Deterministic resumable tar, contributors, sealing and expiry. Durable write intents and lease epochs. History trimming keeps records that are still pending cleanup.
- **DX-3: deletion executor.**
  - `DeletionService` with six engine operations.
  - A generalized `purgeBatch` with persisted, append-only stage plans and a fence before each stage. An unconfigured stage holds.
  - Covers E5 vector hold, E8 shelving re-check, unconditional restore, the empty-object check, the min-merge alarm and the due index.
  - Owner, admin and inactivity deletion share the executor.
  - Chaos coverage: a crash at every mutating call, sign-in racing the deadline, export versus delete, shelving and restore races. A workerd-versus-Node parity test passes.
- **DX-4: billing closure** against Polar fakes. Checkout and plan changes are refused while deletion is scheduled. A paid event on a fenced or deleted owner is revoked and alerted; the alerts go to the structured log, since no operator notice transport exists.
- **DX-6: email removal and security state.**
  - `security:{epoch, changedAt}` is bumped in the same CAS as every security change, read through `identitySecurity(owner)`.
  - `emailRemove` requires step-up, uses a notice waiver, and releases the index in the same write.
  - Route: `POST /api/auth/email/remove`.
- **Integration.**
  - Federation, MCP (64-shard fan-out) and email-bridge erase operations.
  - Cross-slice export/delete chaos tests run against the real `AccountExport`.
  - The due index lives in the scheduler DO (Worker) or `identities.sqlite` (Node).

Provisional decisions taken by the coordinator:

- The inactivity purge now runs the common erasure stages: grants, drain, operator apps, email bridge and exports. The alarm returns early while a purge job exists. These are the review's R1-H2/H3 fixes and only take effect with `LIFECYCLE_PURGE_ENABLED`, which is off. Reviewer: ___ Date: ___ Outcome: ___
- DX-6 deviations:
  - New accounts count as recently security-changed for their first 72 h.
  - Recovery resume and recovery-file rotation bump the epoch.
  - Re-verifying the same email does not bump it.
  - Added an optional `expectedEmail`.
  - The waiver requires current terms acceptance.

  Reviewer: ___ Date: ___ Outcome: ___
- DX-3 deviations:
  - Up to 16 hashed cancel tokens, one per notice.
  - Holds are represented as a field, not a state.
  - The E2 severance reason is `deleted`.
  - A security change during grace requires a newly accepted notice.
  - The completion notice can be dropped after one day.
  - `admin-underage` gets 30-day grace.

  Reviewer: ___ Date: ___ Outcome: ___

Open items:
- R1-M12, BindleBox on deletion. `operatorApps` is an explicit no-op, and the deletion flag stays off until this is decided.
- DX-6 item 6: invalidating notification budgets and unsubscribe tokens.
- Erasing device grants beyond lineage revocation.
- Q3, a Polar sandbox anonymization check.
- Remaining slices: DX-2 export routes, DX-5 deletion routes and notices, DX-7 admin-assisted deletion, DX-8 UI, DX-9 over-quota hook and CLI.

Gates:

| Suite | Result |
|---|---|
| `npm test` | 2238 |
| Worker | 73 |
| UI-state | 291 |
| DOM, build, dry run | pass |
| e2e | 214, 4 WebKit environment skips |

## 2026-10-21 — DX-2 export routes and DX-5 deletion routes and notices integrated

**What landed:**
- Export routes with edge streaming, Range support and resume, a CLI grant and exact-ref pins.
- Node `FileBucket` range reads. Reads without a range are byte-identical to before.
- Deletion routes and a cancel-token page.
- Mail and push notices carrying the cancel link, through the existing transports. The notices port is guarded so a bad `APP_ORIGIN` holds requests instead of breaking account objects.
- Service-worker handling for deletion notices, with URLs restricted to two same-origin destinations bound to the account.

**Blob GC.** All physical blob deletes now go through `collectGarbageRef`. With no active export this is the old path. With an export active, a claim-or-defer transaction prevents GC racing an export pin; 120 seeds exercise both outcomes. The proposed storage-quota release rework was not applied: the path is live, and abandoned upload refs can never be pinned.

**Provisional coordinator decisions** on flags-off differences (Reviewer: ___ Date: ___ Outcome: ___):
- The cancel page and cancel-token endpoint stay live unless the env kill is set, so a ramp-down never strands cancel links already sent. With no request they are inert, and the token endpoint answers `invalid_token`.
- Deletion and export endpoints now answer 405 for wrong methods and 403 for cross-origin requests, instead of 404. A same-origin GET with the flag off and no state still answers 404.
- Deletion status answers even under the env kill; cancel refuses under it.

**Deferred:**
- Exports fail closed (`export_unavailable`) until the export notice/audit port and the keys, grants and external-storage contributors are composed.
- Node deletion email needs an injected mailer that implements `sendDeletionNotice`.
- Open from the previous pass: service-worker handling of security notices (DX-8), DX-6 item 6, R1-M12, and the Q3 Polar sandbox check.
- DX-7 and DX-8.

**Gates:**

| Suite | Result |
|---|---|
| `npm test` | 2263 |
| Worker | 76 |
| UI-state | 291 |
| DOM, build, dry run | pass |
| e2e | 214, 4 WebKit environment skips |
| deletion cancel page (Chromium) | 6 |

## 2026-10-21 — Account deletion and export: DX-7, DX-8 and final integration

**DX-7: admin-assisted deletion and closure.** Admin actions require a passkey step-up, are audited and notify the owner. There is an explicit reopen action, and confirmation links last 24 h. Worker and Node ports cover schedule, cancel, status, confirmation, closure and reopen notices.

**Closure-export sessions.** These are restricted sessions issued to a suspended account with an open export window. They last at most 1 h and never beyond `exportUntil`. The server lets them reach only the session, deletion status and the owner's export routes.

**DX-8: owner "Your data" screen.** It covers export, deletion with a checklist and typed handle, cancel, and email removal with a waiver. It also includes the deletion interstitial, the restricted closure view, and service-worker handling of security and export notices.

**Security fix.** Admin-email scheduling is now bound to the confirmed security epoch and email revision, checked both before and after commit. A stale confirmation returns `confirmation_stale`. A regression test and a 200-seed chaos test cover it.

**Export deferral lifted.**
- The notice port writes an idempotent audit entry, sends mail best-effort, and pushes.
- Grants are exported without tokens, token families or JTIs.
- Keys are exported as public history only.
- Drive mappings are included.
- An end-to-end test runs on the real Node adapter: step-up, 72 h delay, generation, download with Range resume, tar contents checked against the manifest, a redaction check, and expiry.

`sessionFeatures()` projects the three DX flags as evaluated values with `private, no-store`.

**Provisional coordinator decision.** Export part writes bypass the monthly archive write allowance (16 writes, meant for cold shelving), which a single small export exhausted. They are bounded instead by the export limits: one active export, two per week, sized to the account. A dedicated metered budget remains an option. Reviewer: ___ Date: ___ Outcome: ___

**Deferred or open:**
- DX-9: over-quota hook and CLI downloader.
- DX-6 item 6.
- Device grants and S3/WebDAV mappings are not in exports.
- R1-M12 must be decided before the deletion flag is enabled.
- Q3: Polar sandbox check.
- [Legal README](docs/legal/README.md) commitments are updated to "implemented, flag-off".

**Gates:**

| Suite | Result |
|---|---|
| `npm test` | 2295 |
| Worker | 76 |
| UI-state | 291 |
| admin-deletion | 48 |
| account-data | 74 |
| deletion | 6 |
| DOM, build, dry run | pass |
| e2e | 214, 4 WebKit environment skips |

## 2026-10-21 — DX-9 over-quota hook and CLI; ART-1 artefact core library

**DX-9.**
- `export-hooks.mjs` provides the over-quota episode allowance and `exportOffered` evidence as engine operations. The evidence records availability of an export, not delivery.
- `scripts/bindle-export.mjs` downloads via a grant, with checkpoints and resume, and verifies the tar against the manifest. 120 chaos seeds pass, including process interruption and corruption detection.
- Not yet wired into adapters (`CreateExportWithHooks`, offer/evidence registration, the D092 episode producer). No over-quota removal exists or is enabled.

**ART-1.** Pure modules `packages/core/strict-json.mjs` and `packages/core/artefacts.mjs`:
- strict parsing and JCS;
- envelopes, hash chains, offloaded records and reference checks;
- extensible growth rules and retractions;
- H2 evidence rules.

The JSON conformance vectors are in `docs/architecture/artefacts/` for reuse by other implementations. 59 tests run, and are now part of `npm test`. Store, fetch and call-site wiring remain for ART-2 through ART-6.

Gates: `npm test` 2365, Worker 76, UI-state 291, build and dry run pass. e2e: 214, with 4 WebKit environment skips.

## 2026-10-22 — User decisions: Parley data on deletion, org identity, certificates, naming

- **R1-M12 resolved.** The messaging app (the user calls it Parley) is a regular app that stores its data in the user's configured object-storage resource. Deleting a 3sln.me account deletes hosted storage, and Parley gets no special operator treatment. The `operatorApps` stage stays a no-op.

  **Gap:** the current BindleBox implementation keeps hot state in its own `MailboxObject`: metadata, the encrypted delegate key, and up to 64 MiB of bodies while storage is unavailable. As a regular app, it must purge that state when it receives the standard connection-severed / account-deleted signal. This is required before `BINDLEBOX_ENABLED`, but not before `ACCOUNT_DELETION_ENABLED`.

  Reviewer: ___ Date: ___ Outcome: ___
- **Org identity.** An org identity is the same kind of thing as a user identity: a stable UUID, aliases as pointers, keys, and a recovery file containing the org's private key, issued at creation. Rotation and succession are deferred. This goes into organizations rev 5. Reviewer: ___ Date: ___ Outcome: ___
- **Identity portability and intent links (new design work).**
  - Moves between providers use HTTP permanent redirects.
  - 3sln.me transfer-out requires the original recovery file, with 3 months of free redirects and a cheap 10-year extension.
  - Stable, app-agnostic intent links use `bintent=<base64 JSON>`. Apps declare intent handlers in their manifests. The user chooses among handlers and gives first-use consent (once or always). Intent kinds are public artefacts.
  - The split between the Bindle spec and provider choices must be explicit. A design agent is drafting this.

  Reviewer: ___ Date: ___ Outcome: ___
- **Certificate lifetime.** Out of scope for Bindle: the issuer decides and discloses its revocation bound. 3sln.me defaults to about 11 minutes, configurable per org. Reviewer: ___ Date: ___ Outcome: ___
- **Naming.** Relation / Relationship. Keep "slot", and say "relation slot" where ambiguous. Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — Organizations rev 5 (org identity) and review round 4

**Rev 5.**
- Orgs are full identities: stable UUID, aliases, provider-held keys, and a recovery file issued at creation and held by the owner. It is reissued when ownership changes.
- Break-glass is now ordinary org recovery. Recovery raises the org authority epoch. On 3sln.me, the recoverer becomes candidate owner after 72 h, and only the current owner can cancel.
- The certificate lifetime is chosen by the issuer, which must disclose it. 3sln.me defaults to 660 s, configurable per org.

**Review round 4** (2 High, 5 Medium, 2 Low):
- **H1, fixed.** Recovery files contain the identity signing key, so a former owner or a file thief could mint certificates offline. Certificates are now signed only by provider-held certification keys (`use:"cert"`) that never appear in files or exports.
- **Medium, fixed.**
  - Counterparts reject a lower org epoch.
  - The epoch is raised only when a recovery takes effect.
  - Verifiers may cap a certificate's effective lifetime.
  - Org recovery files get a generated high-entropy passphrase.
- **H2, open.** Portability must not accept key possession or a superseded file as transfer authority. Verifiers keep the original `(iss, sub)` and pin a signed successor statement; redirects are hints only. Forwarded to the portability designer.
- **Open: owner absent during an org recovery.**
  - Reviewer proposal: an admin objection extends the window to 14 days, and a recovery-derived owner cannot remove admins for 30 days.
  - Also proposed: an owner on recovery hold cannot cancel.
  - Needs a user decision.
- **Low, open.** Link responses and author proofs are still signed with the identity key. This is for the messaging and links owners.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — App removal design (clean and force) and the subject-deleted signal

The user asked for clean app removal: the user is sent to the app's own cleanup UI, where they can keep, delete or archive data, and then all access is revoked. Force removal revokes immediately with no cleanup. Account deletion signals every installed app so it can clean up.

The [design](docs/architecture/app-uninstall.md) (rev 2) and [spec](docs/spec/app-removal.md) (rev 2) cover:
- **One revocation commit for both modes.** Every authority the app holds is revoked; no user data is deleted.
- **The clean removal request.** Provider-signed, single-use and valid for 5 minutes, bound to the browser.
- **Declaration.** The app declares `bindle_integration.removal` in its manifest.
- **`subject-deleted` event.** Sent after revocation, once brokered access has ended (`access_ends_by`). Delivery is drained for up to 72 h and is best-effort on the app's side.

User decisions:
- No hard deadline. `cleanup_by` is only a reminder: the app operates normally until it completes or the user force-removes it. Reminders fire at `cleanup_by`, +24 h and +7 days, and force removal becomes the primary action. Reviewer: ___ Date: ___ Outcome: ___
- App settings are kept after removal, with a delete option in "What's left". Reviewer: ___ Date: ___ Outcome: ___
- No `subject-deleted` signal to apps that were already removed. Reviewer: ___ Date: ___ Outcome: ___

Review round 1 found three High issues:
- **H1, fixed.** Freeze and closure disconnect connections before E2, so `subject-deleted` reached no one. The recipient rule is fixed.
- **H2, accepted under the no-deadline decision.** A pending-removal app keeps acting. Consent pages now show the pending removal next to "Remove now".
- **H3, open.** For org-installed apps, a single admin can trigger app-side deletion of org data. An `actor` claim was added; the gate itself is a user decision (second admin or a 24 h delay).

**404 vs 410.** Every public surface gives a uniform "unknown" answer. 410 is used only on owner-authenticated or internal paths, and account-deletion-export §2.4 was updated to match. A possible public leak remains: a signed contact delivery during the deletion fence can surface a 410 through `routes/shared.mjs` `status()`. Queued as a code fix. Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — Identity portability and intent links (design, review round 1)

**Identity portability** ([spec](docs/spec/identity-portability.md) rev 2, [design](docs/architecture/identity-portability.md)):
- **What moves.** The identity keeps its UUID and key; the host changes. Handles never move. Verifiers key by the origin principal `(iss₀, sub)` and keep a successor pin.
- **Proof of a move.** A move statement signed by the identity key, plus an old-provider attestation bound to one destination, one transfer, one statement and `redirect_base`. Key possession alone never suffices.
- **Transfer authority.** The current recovery credential, plus either a step-up session or a 7-day public wait. The wait cannot start within 7 days of an authority reset or a channel change. Notices also go to channels removed in the last 30 days, with a cancel link that needs no sign-in.
- **Adoption.** No automatic adoption while the source still serves the identity as active. Verifiers use attestation key sets at most 1 h old.
- **Redirects.** 308 redirects are hints only. Canonical paths only.
- **3sln.me specifics.** 90 free days of redirects, a US$10 ten-year extension (Polar one-time), and a "moved" tombstone with proposed privacy and terms text.
- **Review round 1.** 3 High, all fixed in the text: the recover-then-wait hijack, an automatic hijack through a leaked attestation key or lapsed source domain, and unbound authorizations.
- **Residual.** A verifier that first meets an identity after its source is gone cannot detect a forged chain; only pre-rotation would close that.
- **Open:**
  - a 24 h delay before person moves commit;
  - admin blocking of suspicious org moves;
  - pre-rotation;
  - the user's confirmation that "original recovery file" means the current file;
  - the extension price;
  - the export window.

**Intent links** ([spec](docs/spec/intents.md) rev 2, [design](docs/architecture/intent-links.md)):
- **Format.** `bintent=<base64url JSON>` carrying a pinned intent-kind artefact plus data. Unsigned links are shown as from an unknown sender. Signed links use certification keys.
- **Handlers.** Declared in the integration manifest. The provider hands off by form POST, then by fragment to the handler. Handlers must confirm actions, refuse framing, and name the acting account.
- **Migration.** `send-message` and `add-contact` subsume `web+bindle` and `bindle_intent`.
- **Review round 1.** 5 High, all fixed in the text:
  - publisher spoofing;
  - borrowed voice in previews;
  - forged attribution through retired keys;
  - unguarded handler routes;
  - drive-by "always", which now needs fetch-metadata user-activation signals.

  Mediums are fixed too: kind lookups happen only after sign-in, plus canonical validation and migration paths.
- **Open:**
  - handle-entry phishing;
  - offering org-installed apps to members;
  - the fragment form being required for contact links (recommended);
  - signed intents (not in v1, recommended).

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — Uniform public 404 for unknown targets (U404), with the credential boundary

Implements the app-uninstall §7.5a rule ([inventory](docs/release/uniform-unknown-review.md)).
- **Targets.** A public lookup that names an identity, link, owner or room gives one uniform 404 whether the target is missing, never created, deleted, deleting behind a fence, suspended or moved. This covers contact links and their previews, avatars, ingress descriptors, contact-delivery JWTs, public conversation routes, delegation certificates and OAuth identity admission. Contact links are the one place a link or delivery-token refusal is also folded into the 404, because the link names the target.
- **Deletion-fence leak fixed.** Public delegation reads no longer opt into purging access, and identity admission goes through the account single writer (`PublicIdentityAvailable` / `PublicAccountAvailable`), so a still-active directory entry can't bypass a committed deletion fence.
- **Credentials keep their protocol refusals.** Bearer and DPoP tokens, refresh tokens and codes, object capabilities, embed credentials, MCP tokens, postback capabilities and introspection keep their standard 400/401 refusals (RFC 6749/6750/7662/9449). A credential whose own account is deleted, deleting, suspended or moved gets the same refusal, never 404 or 410.
- **Correction during implementation.** The first pass also turned credential refusals into 404 and rewrote 16 protocol test files to match. That was reverted, and the original assertions are restored.
- **Test fixture bug found.** The shared matrix had never mounted introspection: it passed a string where the flag needs a boolean, so the "404" came from the router's catch-all. Fixed. The matrix is now split into target and credential surfaces and runs on Node, the engine (12 seeded fence schedules) and workerd.
- **Not claimed:** constant-time responses. Presence-dependent lookup cost remains, and only the avatar has a fixed deadline. Streams that are already open keep their committed status.
- **Gates:** core 2417, Worker 77, UI-state 291, e2e 214 passed with 4 WebKit skips (browser not installed), asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — User decisions: legal operator, artefacts, organizations, portability

**Legal** ([README](docs/legal/README.md)):
- **Operator:** Stubbs Software Solutions LLC, doing business as 3sln, 41 West Highway 14 #1645, Spearfish, SD 57783, United States. This is filled into the privacy policy and terms.
- **Governing law:** the user said "United States". Contract law is set per state, so the clause now reads "the State of [STATE], United States", pending the user's choice of state.
- **Still open:**
  - the refund policy;
  - the venue;
  - EU/UK representatives. The user has none and asked whether Polar acting as merchant of record removes the need. Coordinator's view: it doesn't, because Polar's role covers the payment, not the account data 3sln controls. Counsel should confirm.

**Artefacts:** the four recommendations in artefact references §13 (Q1–Q4) are accepted:
- the envelope goes at the canonical URL after a transition at `<id>/envelope`;
- unsigned retractions only block new pins and notify;
- new lines use open result objects;
- version records are not garbage-collected in v1.

**Organizations:**
- **Q3 accepted:** no roles. Per-member grants, copy-on-apply templates and app-published member-scoped fields; live groups deferred.
- **Grant-change elevation (3sln.me policy):** the change goes to the subject first. The requester may elevate to the owner if the subject rejects it or doesn't answer in time. The elevation then stays with the owner until the owner accepts or rejects, the requester retracts, or the subject accepts. No timeout resolves a request in anyone's favour. This supersedes the R4-M4 owner-absent proposal. The 7-day response period is the coordinator's provisional default.
- **Still open:** Q13 (membership separate from relations); the user asked for more explanation.

**Identity portability:**
- **Q1 accepted with conditions:** the destination rotates the key at transfer-in.
  - Provenance is chained: the old key signs the new one, and the key history stays published.
  - Old-key artefacts issued before rotation, such as existing contact links, stay valid, and messages sent through them are honoured.
  - A holder of an old recovery file can't mint new old-key artefacts.
- **Q2–Q4 accepted:**
  - a US$10 ten-year extension that anyone can buy;
  - a 30-day read-only export window, then purge, deleting the proof once redirects end;
  - labelled unattested transfer-in from 3sln-format files.
- **M10:** other admins can block an org move, but not the owner, and a blocked requester can elevate to the owner. This is the coordinator's reading of the user's answer.
- **Still open:**
  - the 24 h person-move delay; the user asked for its rationale;
  - pre-rotation;
  - whether "original recovery file" means the current one.

The design docs are being updated to match.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — EU/EEA/UK sign-ups blocked for launch; membership out of Bindle; move delays

**Legal:**
- **Governing law:** South Dakota (user).
- **Venue:** the state or federal courts in South Dakota. This is the coordinator's default, pending confirmation.

**EU/EEA/UK** ([spike](docs/release/eu-uk-representative-spike.md)):
- **The rules:** a service that targets people there must appoint a representative under GDPR Art. 27, UK GDPR Art. 27 and DSA Art. 13. No exemption fits a core account service. Neither regime bans non-resident services outright.
- **The decision:** per the user's instruction, sign-ups are blocked for launch.
  - `AGE_POLICY.representativeBlocked` holds EU27 + IS/NO/LI + GB, and `ageRequirement` reports `blockedReason:'representative'`. The per-country age rules are kept for when the block is lifted.
  - Billing offers only USD in those locations.
  - The privacy policy, the terms and age-requirements.md say where the service is available.
- **Later:** entering the EU and UK means appointing representatives, with GDPR quotes at about €420–850 a year per regime, plus a DSA legal representative.
- **Gates:** core 2419, Worker 78, UI-state 291, legal 47, signup e2e 6, asset build and Worker dry run.

**Organizations** (spec rev 4.2, design rev 5.3):
- **Membership is internal (user):** grants, templates, governance and the elevation rule are 3sln.me provider policy (design §12c). The Bindle spec keeps only what crosses a party boundary: member certificates, the token exchange, member context and the interoperable outputs apps rely on, organization identities, and relations.
- **3sln.me membership:** a grants list keyed by the member's origin principal, recording the key the member was added under.
- **Q13:** closed.
- **Where the split may need care** (design §12c.4):
  - Q15: apps need a standard effective-methods output;
  - org moves need a portable export of memberships;
  - security floors for cross-provider members.
- **Still open:** Q14 (tight verification for grant elevations).

**Identity portability** (design rev 4, spec rev 3.1):
- **Person moves:** a 24 h notified delay (user). A dispute from a known device or a confirmed email holds the move or aborts it, and a held move never auto-commits. The elevated-resolution procedure is the coordinator's proposal (§6.1a).
- **Org moves:** admins can block a non-owner's move, and the requester can escalate to the owner. An owner's move can't be blocked, only objected to. Owner decisions need tight verification (coordinator's proposal: a step-up with a credential older than 7 days, no security change in 30 days, notices, and a short delay).
- **Pre-rotation, corrected:**
  - What it buys: the provider-held signing key is separated from an owner-held next key, so a signing-key leak cannot rotate or move the identity.
  - What it doesn't: it doesn't detect forks from an old recovery file; only witnesses, an append-only log or verifier pins do. The earlier "only pre-rotation closes" wording is removed.
  - Decision open.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — Refunds, ownership transfer, delegated portability decisions, provisional intent/removal calls

**Legal (user):**
- **Refunds:** none as of right. A refund may be requested and is granted or refused at our discretion; mandatory consumer law is unaffected.
- **Disputes:** the courts of South Dakota.
- **Placeholders:** none remain. Counsel review is still required.

**Organizations** (design rev 5.4, spec rev 4.3):
- **Ownership transfer (user):** the recipient sets up billing first, and the transfer takes effect on verified payment. A fresh billing period starts, and the previous owner's payment confers nothing. The old subscription is cancelled. The offering owner passes tight verification and admins are notified. On transfer:
  - the recovery file is reissued and the 30-day move cooling starts;
  - pending elevations pass to the new owner;
  - the old owner stays a member.
- **Agent-added figures, for the user's review:** a 24 h transfer minimum, a 14-day offer lapse, and a full refund if a transfer fails after payment.
- **Provisional (coordinator, delegated by the user, not signed off):**
  - two 72 h break-glass exceptions to "no timeout decides";
  - accepting after rejecting;
  - a held owner can't cancel a recovery;
  - a 7-day response period;
  - Q14: tight verification for grant-change escalations;
  - Q15: a standard effective-methods output for apps;
  - a portable membership export in the spec;
  - the cross-provider member security floors restored to the spec as MUSTs.

**Identity portability** (design rev 5, spec rev 3.2). The user delegated these to a security design agent; they are not signed off by the user:
- **P14:** "original" means the current recovery file, at least 7 days old.
- **P15:** pre-rotation is deferred. Every recovery-file issuance rotates the signing key. The future shape is one file holding the next key.
- **P16, v1 fork detection:** chained provider attestation keys with verifier pinning, the 3sln.me root shipped in the SDK, and an `attestation_first_use` flag. The upgrade path is shared pins, then a move log with at least two independent operators.
- **P17:** disputes resolve through a proof ladder: a known channel, then elevated proof, then support. The winning proof removes the disputing devices and restarts a 72 h delay. Holds expire after 30 days.
- **P18:** the owner's tight verification requires an aged credential; a recovery file does not substitute.
- **P19:** the timing figures are confirmed, plus a 30-day held-move expiry and a 30-day contest window.
- **Follow-ups:**
  - the recovery-identity spec gains rotation on issuance and the credential age;
  - the SDK ships the attestation root;
  - PORT-9 and PORT-10 code changes (contact-delivery bearers minted with the original key; key-history pruning).

**Intent links** (rev 3). Provisional (coordinator, delegated, not signed off):
- **Signed-in viewers:** see their own connected apps that handle the kind, which comes first.
- **Viewers whose account is elsewhere:** "Where's your account?" handle entry, with the destination shown, handle only, the choice remembered, and a disclosure for capability kinds.
- **Org-installed handlers:** offered only in member context.
- **Also adopted:** the fragment form for capability kinds, "always" skipping the interstitial (except anti-bounce), and no signed intents in v1.

**App removal** (rev 3). Provisional (coordinator, delegated, not signed off):
- an organization's clean removal follows a 24 h admin-notified delay;
- consent pages show a pending removal with ⟦Remove now⟧.

None of the provisional items blocks implementation.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — DX-10: account export integration

The integration status for each backlog item is in [account deletion and export](docs/architecture/account-deletion-export.md).
- **Done:**
  - export hooks are wired in the Worker and Node;
  - internal over-quota offer and owner evidence methods, where `exportOffered` records availability, not delivery;
  - exports include device grants;
  - Node grant-store wiring is fixed;
  - paging and integration tests.
- **Deviation (provisional):** S3/WebDAV exports carry namespace metadata only, because those connectors persist no object or version mappings. Credentials and endpoints are omitted, and the manifest states the limitation.
- **Deferred:**
  - the D092 over-quota episode producer and its notices, which need a durable billing-transition contract;
  - invalidating notification budgets and unsubscribe tokens on email removal, which needs an identity hook;
  - Q4 keeps its approval hold;
  - the operator-alert transport and the Polar sandbox verification remain open.
- **Not added:** over-quota removal.
- **Gates:** Worker 78, UI-state 291, e2e 214 with 4 WebKit skips, asset build and Worker dry run. Core passes except for two flag-count assertions that change with the concurrent ART-3 flag row.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — ART-2 and ART-3: artefact publication, store and resolver

Following [artefact references](docs/architecture/artefact-references.md) ART-D12–D15:
- **Publication:** the docs build emits envelopes and version records, and canonical URLs keep their legacy bodies during the transition. Records are tracked in a lock file (`docs/artefacts/artefacts.lock.json`).
- **Store and resolver:** engine operations, behind the new default-off `ARTEFACT_VERSIONS_ENABLED` (class a, critical). Existing pins survive turning the flag off, and version records are never deleted. Tests include 24 seeded chaos schedules.
- **Deviation:** the conversation artefact uses a separate backing body file to avoid a `.json` file/directory collision. Its canonical response is unchanged.
- **Not yet:** serving `<id>/envelope` and `<id>/versions/<n>` needs a `routes/site.mjs` hunk. Adapter wiring is ART-4 and mirror serving is ART-7.
- **Gates:** focused 75, Worker 78, UI-state 291, asset build and Worker dry run. The flag-registry test is updated for the 43rd flag.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — ART-4: artefact pin call sites and transition serving (partial)

- **Done:**
  - Schema, extension, event-bus and event-store pins go through the engine-backed resolver (`packages/runtime/artefact-pins.mjs`), with durable Worker and Node wiring.
  - Legacy pins keep working with the flag on or off.
  - `<id>/envelope` and `<id>/versions/<n>` are served, and canonical URLs are unchanged.
  - Tests cover concurrent pin/publish schedules and adapter persistence.
- **Remaining, moved to ART-5:**
  - the R1-H4 grant-matching migration in `federation/service.mjs` and `incremental.mjs`;
  - passing bus versions through `app/domains/events.mjs` and `runtime/account/events.mjs`.
- **Gates:** core 2471, Worker 80, UI-state 291, e2e 214 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — PORT-1, PORT-9, PORT-10: succession codec, old-key honouring, rotation at recovery issuance

Following [identity portability](docs/architecture/identity-portability.md) rev 5, P11, P15 and P16:
- **PORT-1:** `packages/identity/succession.mjs` holds the pure codec and verification for statements, attestations, chains, packages, redirect targets and attestation-key continuity, with conformance vectors and property tests.
- **PORT-10:** issuing a recovery file rotates the signing key with continuity. A new identity's first file adopts the existing signer.
  - Rotation commits before the identity record's compare-and-swap, so a per-owner `identity-key-recovery/<owner>/` record lists the key IDs that issued files depend on. Those keys are never pruned.
  - Any other rotation clears the record.
  - `recoveryCredential()` exposes the issue time for P14; records without it have no provable age.
- **PORT-9:** contact-delivery bearers, including legacy inbox `?sig=` bearers, are signed by the current key, so links survive rotation. Retired keys that stored records reference are never pruned, and published keys carry `retired`. A bearer in flight during a rotation is refused, and the client mints a new one.
- **Spec defects found:**
  - §1.1 assumes a signed-in reissue path that doesn't exist; only setup sessions call `downloadRecovery`.
  - The codec settles three underspecified points: it keeps `?` on an empty query; a first fetch where no key qualifies counts as an attestation reset; and it refuses a later move signed by an earlier key (§8.6).
- **Unresolved:**
  - a recovery already in progress before deploy can't resume with its original file after downloading the replacement;
  - the fetch-based checks (§8.3 items 4–5) belong to PORT-5;
  - P11, P15 and AMD-P11 are unsigned.
- **Gates:** core 2468, Worker 80, UI-state 291, e2e 214 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — ART-5 (partial): versioned grants and consent; bus version forwarding

- **Done** (behind `ARTEFACT_VERSIONS_ENABLED`):
  - fragment version pins and legacy grant matching (R1-H4);
  - silent re-grant only for scalar additive changes, with history;
  - consumer visibility follows the pinned version;
  - the consent views show versions, and SDK incremental requests validate them;
  - bus versions are forwarded through the events domain (the ART-4 remainder).
- **Remaining, moved to ART-5b with ART-6:**
  - persisting incremental-authorization versions (`incremental-ports.mjs`, `authorization-entries.mjs`);
  - contract upgrade deltas;
  - the `bindle.cv` contract version map (R1-H1).
- **Until then:** resource upgrades conservatively require review.
- **Gates:** core 2485, Worker 80, UI-state 291, consent 51 each in Chromium and Firefox, e2e 214 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — PORT review round: fixes for c15aa37

An independent adversarial review found no High issues: old files can't get signatures honoured after rotation, and current-key bearers add no new minting power. Its findings are fixed, each with a regression test:
- **M1, legacy resume lockout:** an issuance rotation also binds the key it retires, so the still-current file can restore or resume after a lost identity commit or a legacy always-rotate.
- **M2, stale issuance unbinding the current key:** issuance merges into the binding instead of replacing it. Only a rotation outside issuance clears it, and revocation removes a kid. `RECOVERY_BINDING_LIMIT = 8` trims the oldest entries first, never the ones just named. This is a provisional coordinator decision, made because without it rotation would eventually be skipped for good.
- **L1, ECDSA malleability in move records:** the succession codec signs and accepts low-s only. The vectors are re-encoded, with signing inputs unchanged.
- **L2, bearer in flight across a rotation:** refusal is kept per spec. The design §7.1 now documents the sender re-minting once on 401 and retrying the same `operationId`, and a test covers it.
- **Gates:** core 2484, Worker 80, UI-state 291, e2e 214 with 4 WebKit skips (a first run timed out during concurrent consent edits; the rerun was clean), asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — ART-5b and ART-6 engine paths: versioned incremental grants, contract deltas, bindle.cv validation

- **Done** (behind `ARTEFACT_VERSIONS_ENABLED`):
  - durable version pins for incremental authorization;
  - contract upgrade deltas and silent-advance history;
  - digest validation (R1-H1), where a foreign mismatch fails only that request;
  - pinned result projection in the brokered, introspection and integrations paths;
  - seeded concurrency tests.
- **Deviation (provisional):** result projection removes every member the pinned version doesn't name, and unsupported schema constructs fail closed.
- **Remaining end to end:** signing, forwarding grants to tokens, runtime flag and resolver wiring, and detailed consent rendering.
- **Gates:** core 2512, Worker 80, UI-state 291, consent, DOM, asset build and Worker dry run. e2e: 213 passed, plus 1 one-second refresh-lifetime timing assertion that passed 4/4 on an isolated rerun; 4 WebKit skips.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-22 — ART-8 (artefact versions end to end) and PORT-2/PORT-3 (transfer-out source engine, moved routes)

**ART-8** ([artefact references](docs/architecture/artefact-references.md)):
- signed `bindle.cv`, with grants forwarded to tokens;
- runtime flag and resolver wiring for `ARTEFACT_VERSIONS_ENABLED`, plus the Worker and Node adapter hunks;
- pinned validation and projection;
- detailed consent rendering of version deltas.

Optional publisher provenance signatures remain unimplemented. The slice table names what remains.

**PORT-2 and PORT-3** ([identity portability](docs/architecture/identity-portability.md) §10.1), behind the new default-off `IDENTITY_TRANSFER_OUT_ENABLED`, for persons only:
- **The source engine** (`packages/identity/transfer-out.mjs`, plus the account single writer):
  - begin, both authorization paths, statement, cancel, expire and commit;
  - the 24 h delay with dispute hold or abort, the P17 proof ladder and 30-day hold expiry;
  - the P14 current-file age rule.
- **After a move:**
  - the `moved` tombstone reason and purge plan;
  - the 30-day read-only export window, which reuses closure-export sessions;
  - moved routes and redirects;
  - the `identity_moved` hook at the authorization request.
- **Spec defects found:**
  - no removed-email history, so path (b) notices reach only emails detached by elevated proof;
  - no active-account recovery reissue path, so the current file is invalidated after an elevated abort;
  - step-up credentials aren't recorded, so the contest window is keyed by passkey or session.
- **Not built yet:**
  - organization moves, which wait for the organizations slices;
  - certification-key revocation on commit;
  - a guard against `keys.mjs` minting keys for moved owners;
  - a multi-key attestation set (PORT-4);
  - advertising `portability.v1`, which needs `directory.v1`;
  - an admin route for support decisions.

**e2e fixture:** `tests/e2e/multi-account.test.mjs` gives each signup a distinct test IP. Random per-call IPs could collide and trip the per-IP signup cooldown. No limits were changed.

**Gates (combined tree):** core 2562, Worker 80, UI-state 292, consent 53 each in Chromium and Firefox, e2e 214 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — App removal (AU-S1 to AU-S5, AU-S7, AU-14) and portability PORT-4/PORT-5

**App removal** ([app uninstall](docs/architecture/app-uninstall.md) rev 3), behind its default-off flag:
- **Built:**
  - removal wire validation and signed requests;
  - the engine state machine with no hard deadline (UD-1);
  - an atomic revocation commit, with force removal at any moment;
  - routes and the back channel;
  - `subject-deleted` delivery that skips already-removed apps (UD-3);
  - the console removal flows, return confirmation and history, and pending controls;
  - the consent-page pending line (AU-14);
  - guarded settings deletion (UD-2);
  - best-effort push reminders, with no delivery claim.
- **Parley:** purges MailboxObject state on `subject-deleted` and on terminal revocation, and has a removal page. Archive delete and export stay hidden until their service ports are configured.
- **Organizations:** refused behind the tested AU-13 24 h policy hook.
- **Remaining:**
  - AU-S6's producer ledger (only settings deletion exists);
  - email and activity-centre reminders;
  - intercepting server-completed entries;
  - shared-settings deletion, which first needs other consumers revoked.

**Portability PORT-4 and PORT-5** ([identity portability](docs/architecture/identity-portability.md) §10.1), behind the default-off `IDENTITY_TRANSFER_IN_ENABLED` and `IDENTITY_SUCCESSOR_ADOPTION_ENABLED`:
- **Destination engine:**
  - intake, checks and activation;
  - rotation at activation with chained provenance;
  - the attestation key set as one continuity chain;
  - labelled unattested intake;
  - a custody fence in `keys.mjs`, so moved owners can't mint keys.
- **Verifier adoption:**
  - successor pins, per-issuer attestation pins and first-use tracking;
  - pending successors and the fetch-based checks.
- **Deviations (provisional):**
  - returning to 3sln.me and displacing an unattested identity are recognised but refused, because the repository can't replace a terminal record;
  - Node transfer-in egress isn't wired, pending a DNS-pinned transport;
  - verifiers pin attestation keys from first contact, which narrows the P16 residual.
- **Spec defects found:**
  - §8.3 item 4 can't hold for intermediate hosts when a verifier is several moves behind, so it's checked against the final destination;
  - §8.3 item 5 is ambiguous on a return, so identity URIs are compared;
  - §8.5 pending successors for unattested intermediate hops can never be adopted.
- **Unresolved:**
  - no active-account recovery issuance path, so activation reports `recoveryRequired`;
  - the 3sln.me attestation root isn't minted, so the shipped list is empty and attestations fail closed;
  - the intake route (PORT-6), `directory.v1` mounting, and the organizations and Parley callers.

**Gates (combined tree):** core 2651, Worker 80, UI-state 292, e2e 214 with 4 WebKit skips, removal browser matrix 24/24, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Intent links (INT-1 to INT-7, INT-9) and active-account recovery reissue

**Intent links** ([intent links](docs/architecture/intent-links.md) rev 3, behind default-off flags; INT-8 `signIntent` deferred):
- **Built:**
  - the `bintent` codec, validation and projection, plus the `intent` kind's growth table and the three registered kinds;
  - handler declarations, with a one-call hook in integrations;
  - the router engine with consent memory, defaults, exclusions and ignored kinds;
  - `/i` GET and POST with the landing page: signed-in viewers see their own connected handlers first, and "Where's your account?" handle entry carries the provisional mitigations;
  - the chooser, consent and settings UI;
  - contact-page migration M2–M3, with the legacy `web+bindle` and `bindle_intent` paths kept;
  - `bintent` log redaction;
  - Parley's handlers and confirmations.
- **Deviations:** stored defaults reconcile before intent operations, and publisher resolution uses configured artefacts.
- **Unverified:** deployed redaction, OS and PWA protocol installation, and production gates.

**Active-account recovery reissue** ([recovery identity](docs/spec/recovery-identity.md) "Active-account reissue", provisional and unsigned):
- **Who:** a step-up within 5 minutes with a passkey or password enrolled at least 7 days earlier. The step-up now records the credential used, and passwords record `passwordSetAt`. Forced paths (after an elevated abort, and after PORT-4 activation) skip the age rule, but only for credentials enrolled before the marker was armed.
- **Two phases:**
  - Begin rotates the signing key (P15) and stages the new file for 30 minutes; the old file keeps working.
  - Confirm commits the new file, restarts `recoveryIssuedAt` (P14), records a security change and sends notices.
- **Pending transfer-out:** cancelled at confirm, so an owner can retire a stolen file. P14 can't be dodged, because the new file is under 7 days old.
- **Refused:** during a deletion, a contested move or the support lock, and for moved or arriving identities. Within 30 days of an elevated abort, a reissue by a different credential escalates to support.
- **UI:** a recovery-file panel in Account & security (en and es), with a browser suite (`test:recovery-reissue`).
- **Residuals in the spec:**
  - the restorability check isn't atomic with the identity commit (only admin rotations could hit it);
  - a full key history skips rotation silently;
  - the encryption key is never rotated;
  - the dispute "reissue" choice doesn't arm the forced path.

**Gates (combined tree):**
- core 2713 and Worker 81, both rerun independently by the coordinator;
- UI-state 292;
- full e2e passed;
- asset build and Worker dry run.

The intent agent's final Worker and browser reruns were blocked by its sandbox; the combined-tree gates cover them.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Organizations phase A: ORG-0 (power resolver), ORG-1 (organization entity), ORG-7 (directory.v1)

Following the [organizations design](docs/architecture/organizations-design.md) rev 5.4, §13.

**ORG-7 `directory.v1`**, behind the default-off `DIRECTORY_ENABLED`:
- publisher routes for handle lookup and identity documents;
- an engine-backed `resolveIdentityKey` hook;
- a bounded verifier with SSRF-safe fetch, budgets, caching and continuity pins;
- conditional `portability.v1` advertisement;
- unknown, deleted and suspended identities answer the uniform 404.

Foreign issuers default to an empty allowlist. Production egress and independent-provider conformance are unverified. The verifier lives in `packages/federation`, and an account adapter enforces lifecycle fences.

**ORG-0, the power resolver seam:**
- the router builds `{actor}`, and the single writer re-resolves powers, ignoring any powers the caller supplied;
- operations declare `static entities`, defaulting to person only;
- existing tests are unchanged.

**ORG-1, the organization entity**, behind the default-off `ORGANIZATIONS_ENABLED`:
- **Identity:** `kind:'organization'`, with its own handle and keys and a v2 recovery file issued at creation.
- **Refusals:** every session and recovery path refuses an organization, and organization moves stay refused.
- **Creation:** resumable and idempotent. The paid check is a port, which in production is an operator allowlist that fails closed. The creator becomes owner of record and the initial admin.
- **Management:** rename (display name), the kind label, and a 30-day delayed deletion.

**Provisional deviations:**
- named account methods still take the owner id;
- a due deletion holds at `deletion-due` until a purge hand-off exists;
- handles aren't renamable;
- at most 10 organizations per creator;
- the audit isn't hash-chained;
- Node needs `ORGANIZATIONS_PAID_ALLOWLIST` in its config.

**Spec defect:** ORG-0's `epoch` is undefined. The person's `security.epoch` is used, which is broader than `aep`. The same-host `aep` source for the §12c.3 hold is unspecified, and ORG-2 needs it.

**Unresolved:**
- R4-M5 passphrase encryption and the console (ORG-5);
- organization recovery-file reissue;
- `orgs.forget` wiring;
- flag targeting for organization accounts.

**Gates (combined tree):** core 2748 and e2e 214 with 4 WebKit skips (both rerun by the coordinator), Worker 83, UI-state 292, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Organizations phase A: ORG-2 (membership), ORG-3 (member grants), ORG-4 (member certificates)

Following the [organizations design](docs/architecture/organizations-design.md) rev 5.4, behind the default-off `ORGANIZATIONS_ENABLED`, `MEMBER_CERTIFICATES_ENABLED` and `ORG_FOREIGN_MEMBERS_ENABLED`.

**ORG-2, membership:**
- invitations (bound to the invitee for governance powers), accept, leave, remove and the expiry sweep;
- the admin power, with the last-admin, no-operator and non-expiring-admin guards (provisional);
- the §12b.2a elevation rule: subject first, then the owner after a rejection or 7 days, configurable per organization, with no timeout deciding;
- the `member-removed` outbox;
- the §12c.3 hold after an authority reset.

**Same-host `aep`** (provisional coordinator decision, filling the spec defect ORG-0 found): `packages/identity/authority-epoch.mjs`, an authority epoch bumped only on authority resets (recovery completion, elevated abort, transfer-in). It is narrower than `security.epoch`.

**ORG-3, member grants:**
- the effective-authority evaluator as a pure function;
- the RPC authorization and preferences-projection hook;
- the standard effective-methods output for apps (spec §7.5).

**ORG-4, member certificates:**
- **Home issuer:** the `key-delegation.v1` member profile, signed only by certification keys; consent per (organization, client); multiple keys per consent; `aep`, status and revocation; 660 s default lifetime or the organization's own setting.
- **Verifier:** uniform `invalid_grant` with equal work for members, non-members and forged certificates, and no fetch on the request path. Also DPoP replay protection, the lifetime cap, `aep` checks and the direct form.
- **Token form:** mints DPoP-bound member access in the organization's federation shard, carrying `member` provenance, with no refresh token and expiry no later than the certificate's.
- A test-only second issuer gives self-consistency evidence only.

**Needs reconciling:**
1. foreign issuers aren't usable at runtime (no ORG-7 directory instance is wired to the foreign key port);
2. RPC with member tokens rides the DPoP path, which is mounted only with the device grant;
3. not built yet: confidential member clients (uniform refusal), a direct-form HTTP route, and ORG-6a acquisition;
4. purpose URIs are placeholders;
5. transfer-out still attests `security.epoch` as `aep`;
6. outbound `member-removed` delivery needs the configured event adapter.

**Gates (combined tree):** core 2792, Worker 83, UI-state 292, e2e 214 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Org phase A review fixes, foreign directory wiring, member RPC; ORG-5 console (partial) and ORG-6a acquisition

**Independent review of 5e6c459 and b28786e:** no High findings. The actor seam, epochs, grants evaluator, certificate verification, last-admin races and directory SSRF checks held. Six findings are fixed, each with a regression test:
- **M1:** the owner could remove an admin instantly with a 0 ms response period. The minimum is now 24 h (`ORG_MIN_RESPONSE_MS`, provisional). Lowering it notifies all admins and applies only to new requests.
- **M2:** a held owner could reject through `mute`. Now `requireFresh` applies, and a held owner's mute records only the preference.
- **M3:** membership operations ignored the deletion fence. They are now refused unless the organization is active; leave, decide, mute and reconfirm stay open. The admin member listing is refused too.
- **M4:** the per-app token-form failure budget was charged before signature verification, enabling lockouts. It's now charged only after verification; the per-network budget always applies.
- **LM1:** a refresh-queue write revealed membership through timing. Nothing is written on the request path now; the background refresh walks the roster.
- **L1:** a held sole admin blocked other admins from leaving. The guard now applies only to an effective admin grant.

**Integration:**
- **Foreign directory:** constructed in the Node and Worker account controllers (`foreign-directory.mjs`) behind `ORG_FOREIGN_MEMBERS_ENABLED` and `DIRECTORY_ENABLED`. The new `ORG_FOREIGN_ISSUERS` config is empty by default, and any invalid entry empties it. End-to-end SSRF tests run on both runtimes, with Node-only DNS and socket test hooks.
- **Transfer-out** attests `authorityEpoch()`.
- **Member tokens:** a member-only `MemberDpopRpc` path is mounted independently of the device grant.

**ORG-5 console (partial):**
- the context switcher;
- creation (behind the paid allowlist), rename and kind label;
- members, invitations and the acceptance page;
- per-member grants, the elevation flows and the audit view;
- the organization recovery-file download at creation.

Missing server APIs: organization connections and preferences adapters, discovering organizations as a non-owner, and request discovery for non-admins.

**ORG-6a:** a top-level acquisition consent page and an SDK `member.mjs` helper.
- **Deviation:** consent and issuance are separate operations, so consent may survive a failed issuance.
- **Not yet reviewed:** acquisition hasn't been through the security review.

**Gates (combined tree):** core 2817, Worker 87, UI-state 314, org browser matrix 50, e2e 214 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Org discovery, request discovery, org-context apps and preferences; ORG-6a review fixes

**ORG-6a review** (independent; no High findings):
- **Clean:** CSRF, framing, auto-submit, redirects, Referer, holder-key binding, message fencing, the SDK key and ORG-D9 all held.
- **Fixed, each with a regression test:**
  - **M1, a stale proof stranded a consent:** consent and first issuance now commit in one transaction (`memberCertificateAcquire`). The page requests a fresh proof after the click, retries once, then posts `bindle:member-error`.
  - **M2, the consent screen didn't name the organization or app:** inspect returns the organization's name and handle, its host and whether it's verified, plus the app's registered name and origin. Unverified ones get a warning.
  - **L1, the subject was disclosed before consent:** nothing reaches the app before the click.
- **Open question:** any signed-in user can see a local organization's display name by its identity URI. Organization identity documents are public anyway; this is a provisional judgement.

**Org engine and console** (behind `ORGANIZATIONS_ENABLED`):
- **Discovery:** a person's account lists the organizations they joined (up to 256), and `GET /api/orgs` reads each one as that person. A non-member, an ended member, another organization's member and an unknown ID all get the identical 404 (ORG-D9).
- **Requests:** `GET /api/orgs/{id}/requests` shows the subject, requester or owner only their own requests, with the decisions the server would accept. Seeded chaos found offered accepts the server would reject; that's fixed.
- **Organization context:** connections and preferences act for the organization, with the admin check in the organization's writer.
  - **Residual:** the preferences session check and the write sit in different writers, so a concurrent demotion can race one write.
- **Console:** the org switcher, member view, request decisions, apps and preferences panels, and the paused state with "cancel deletion" for the M3 fence.
- **Existing bug fixed:** invitation links sent only the `jti`, so acceptance from a link always failed.

**Gates (combined tree):**
- core 2838, Worker 89, UI-state 328 (rerun by the coordinator);
- org browser suites 128 and certify suites 24 (Chromium/Firefox);
- e2e 214;
- asset build and Worker dry run.

`tests/e2e/org-console.test.mjs` runs under `test:organizations`, not the full e2e.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Portability UI and redirect extension (PORT-6, PORT-7); organization billing and ownership transfer

**PORT-6 and PORT-7** ([identity portability](docs/architecture/identity-portability.md) §10.1), behind the portability flags:
- **PORT-6:**
  - isolated transfer-out and transfer-in documents and the moved-account console with its read-only export;
  - the redirect page and pending-successor review;
  - dispute and hold UI;
  - the intake route PORT-4 left out.
- **PORT-7:** the US$10 ten-year redirect extension as a Polar one-time purchase. Sandbox only.
- **Limits:**
  - intake supports password and free-plan enrollment only;
  - Node intake keeps its transport gap;
  - not built yet: ending or retargeting redirects, expiry reminders, and support adjudication;
  - external-provider conformance and payments are unverified.

**Organization billing** (`packages/billing/organizations.mjs`), behind `ORGANIZATIONS_ENABLED`, Polar sandbox only:
- **Tiers (provisional product data, prices unsigned):** Team 1 TB at US$1,200 a year, Business 10 TB at US$6,000, Scale 100 TB at US$36,000, each with AI credits.
- **Billing model:** the organization is the Polar customer, and checkout metadata names the paying person, who becomes owner of record.
- **Creation:** reserved unpaid, completing on verified payment. `organizationEntitlementPort` replaces the allowlist, which remains an operator override.
- **Lapse:** a 14-day grace (provisional), then read-only, with leaving, removals, decisions and export open. Then an admin claim takes effect 72 h after its payment unless the owner pays.

**Ownership transfer** (`packages/orgs/ownership.mjs`) follows ORG-D21 and §12b.3a:
- the recipient's checkout gives a fresh period, and the old subscription is cancelled;
- the recovery file is reissued, the 30-day move cooling starts, elevations pass to the new owner, and the old owner stays a member;
- effects go through a durable outbox, so a replay never refunds twice;
- a console panel covers offer, accept and cancel.

**Provisional and open:**
- a full refund of a closed paid claim;
- deletion is refused once a transfer is paid;
- the 72 h lapse claim uses a 5-minute step-up; whether it needs P18 tight verification is open;
- the encryption key isn't rotated at transfer;
- break-glass recovery is only a hook.

**Gates (combined tree):** core 2887, Worker 89 and e2e 264 with 4 WebKit skips (both rerun by the coordinator; e2e now includes the portability suites), UI-state 337, test:organizations, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Review fixes for f7eda06 (organization billing, ownership transfer, redirect extension)

An independent review found 2 High, 1 Medium and 2 Low. Each is fixed, with a regression test and chaos coverage that fails if the fix is disabled:
- **H1, a lapse claim could seize an organization whose owner was paying.** Archiving a catalog price dropped an active subscription, and any partial refund counted as unpaid.
  - Subscriptions now verify against their first-verified amount and currency.
  - Only a full refund, or one at least the order's net, counts as unpaid.
  - A subscription the provider can't confirm is held, raises an operator alert and freezes the unpaid clock and any claim.
  - Former owners' subscriptions are revoked even when `missing`.
- **H2, a claim could take effect on stale data during a provider outage.** Transfers and claims now apply only on a provider snapshot under 5 minutes old, otherwise they retry. An owner payment begun before `notBefore` always defeats the claim, and an uncaptured one holds it for up to 2 days (provisional).
- **M1:** a refunded redirect extension can be bought again.
- **L1:** a losing paid redirect order is refunded. If the refund fails, the webhook returns 503 and Polar retries.
- **L2:** only the current renewal (otherwise the first paid) is kept, and duplicates are refunded.
- **Cleanup:** the dead `recoveryClaim` freeze path is removed (break-glass is phase B), with a design note. One redundant check leaves the `billing_held` branch unreachable. The behaviour is safe, because the claim is refused earlier; it's left as is for now.

Sandbox only, with no live payment.

**Gates:** core 2900, Worker 89, UI-state 337, test:organizations, e2e 264 with 4 WebKit skips, asset build and Worker dry run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Organization tier pricing checked against unit economics

The placeholder organization prices were tested against a worst-case cost model: full occupancy, every AI credit spent, all-international Polar fees and a support allowance (`organizationEconomics` in scripts/cost-model.mjs, documented in unit-economics.md).
- **Team stays at $1,200/yr** (60.7% worst-case margin).
- **Business rises from $6,000 to $7,200/yr** (50.2% → 56.5%).
- **Scale rises from $36,000 to $60,000/yr** (27% → 53.4%).

A new guard test (tests/cost-model-organizations.test.mjs) requires at least 50% on every tier.

**Provisional:**
- one AI credit is at most US$0.0001 of modelled provider spend;
- backups as a second copy aren't priced in (they would bring Scale to 20%);
- whether Polar accepts $60,000 card charges is unverified;
- AI credit enforcement is not wired.

Individual Ultra (1 TB, $250, user-set) keeps the thin margin already recorded in unit-economics.md. That's unchanged and noted for review.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Portability wargame fixes (F1–F13)

A red-team pass over identity portability found 13 issues (one High). Each has a permanent regression test that fails when its fix is reverted: tests/portability-wargame-out.test.mjs (source side, plus a seeded commit-window chaos case) and tests/portability-wargame-in.test.mjs (destination and verifier side, plus a seeded successor-queue chaos case). UI-state coverage is in tests/browser/successor-warning.mjs. Design §3.2, §3.3, §3.5, §5, §6.1, §6.1a, §6.3, §6.4 and §7, and spec §5.2 and §8.3/§8.5/§8.7, record the behaviour.

**Provisional (unsigned):**
- **F1 (High), requester-side elevation needs a dispute.** An elevated restart is refused unless the previous move ended with recorded tier-0 disputers. Requester-side `elevate` is refused on an undisputed move. Only recorded disputers can be named: the disputing email or push subscription, the disputing session and that session's passkey. A removal that would leave no notice target is refused before the identity changes. The restart lock now records who disputed.
- **F2, commit re-checks.** The commit cancels unless the security epoch and the recovery credential (ref and issue time) still match. `markMoved` takes these as required expected values and re-checks them in the identity's own write. No attestation is returned before stage 1; until then the move endpoint answers 202 with `retry_after: 60`. A definite stage-1 refusal unwinds the commit to `cancelled` and drops the unreturned attestation, so a commit whose identity leaves `active` in that window now ends deterministically.
- **F3, path (a) needs a notice channel.** Path (a) is refused without a verified email or push subscription, matching path (b). A pending move with no notice target is cancelled (`no-notice-channel`) rather than counted as noticed. In-account session notices were not counted, because nothing records that a session saw one.
- **F4:** path (b) verifies the presented recovery credential before eligibility facts and before any escalation to the contest lock.
- **F5:** `restartChoice('keep')` is refused from the requester's session or passkey and needs a device known before the move began. `reissue` stays open to any signed-in device.
- **F6:** a source directory naming a different identity URI counts as a return only if a later chain record moves there.
- **F7, still-serving warning.** "Still serving" and "declares portability.v1" are now separate facts. `pending()` shows `oldHostServing`. `confirm()` requires the acknowledgement whenever the old host still serves. The successor page renders the warning and sends `acknowledgeSourceActive` only after the warning was shown and ticked.
- **F8, successor queue.** `present()` runs offline chain checks before queuing. Rows get attempt counts, backoff, drop-after-8 and a per-origin cap of 8. `drain()` takes due rows by `nextAt`, at most 4 per origin per pass. A chain signed by a key other than the pinned one can't be checked offline; those rows are bounded rather than refused.
- **F9:** an unbegun `pending-transfer` reservation expires after 7 days, and the owner's cancel releases a reservation that has no transfer-in record.
- **F10, held transfer-ins.** A `held` transfer-in gives up automatically after 45 days, longer than the source's 30-day replay window. The owner can abandon it after that window. Both raise an operator alert.
- **F11, destination start.** The source's 202 `authorize_url` carries `?statement=<digest>`. A move authorized from that page binds that exact digest, accepts `transfer: null` and waives the `iat` floor (spec §6.1 item 1). The transfer-out page accepts the `statement` parameter, and the verifier client accepts a query on `authorize_url`.
- **F12:** the move endpoint answers about a moved identity only for an exact replay of the attested statement. Everything else takes the unknown-identity path (404 while unmounted).
- **F13:** a paid redirect extension processed after the redirect stopped being live is refunded in full, unless it is the recorded extension. A failed refund still answers 503. An order routed to another subject is still ignored.
- **Also confirmed and fixed:**
  - An identity that moved in can now move out: `seq` and `prev` continue its arrival chain, and the attestation carries that `seq`.
  - Percent-encoded capability parameter names now get `no-store`.

Existing tests were updated where they encoded the old behaviour (pre-emptive naming, requester `keep`, early attestation, flag-off 409, ignored late orders).

**Review follow-ups (independent review of these fixes, same day; provisional):**
1. **The requester is never its own tier-0 disputer.** An in-account dispute from the requester's session or passkey counts as a withdrawal: "abort" cancels as `withdrawn` without a restart block, and "hold" is refused (`dispute_not_allowed`). Self-disputes already recorded on legacy records never count toward the elevate gate or the restart lock's disputers. At least one non-requester disputer is required.
2. **Successor queue eviction.** Rows record whether they verified offline under the pinned key. Unverified rows are evicted first and capped at 2 per origin, so junk can't evict a verified row. A full queue evicts from the origin with the most rows instead of dropping the new row.
3. **Transfer-in begin order.** Begin claims the reservation (`begun`, compare-and-swap on its id) before writing the `importing` record. A lost race leaves no orphan record. After a crash, a begun reservation with no record is released by the owner's cancel.
4. **Redirect extension refunds.** A new order that is already partly refunded is never recorded; its remainder is refunded. A refund on a redirect that isn't live is confirmed by re-reading the order, and otherwise answers 503.
5. **Held transfer-in warning.** An operator alert fires at 30 days held (`transfer-in-held-warning`). The give-up or owner abandon needs both 45 days held and 15 days since the warning. A legacy held record without `heldSince` starts its clock at its next step.
6. **Transfer-in document injection (from the intents review).** The transfer-in document embeds the posted package with a replacer function, so `$'`, `$&` or `` $` `` in it can't splice page markup into the data script. This was the only `.replace` in transfer-pages.mjs.


**Gates:** `npm test` 2954 of 2958. The 4 failures are in orgs certificate and integration-conformance tests, which other agents had files open for and which import no portability module. UI-state 341, tests/browser/transfer-browser.mjs 24, portability suites 156 (162 after the review follow-ups). Full browser e2e (`test:e2e`) was not run.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Intents and app-removal wargame fixes

A red-team review of intent links, app removal and artefacts confirmed five findings. Each is fixed, with a regression test that fails if its fix is reverted (checked by mutating each fix):
- **F1 (Medium), junk intent kinds grew the shared artefact store and spent the global fetch budget.** The router now checks the operator registry before any store read, pin or fetch. The fetch port refuses an unregistered id as `artefact_unregistered` before charging any budget or negative cache. The provider's own exhausted budget (`artefact_budget_exhausted`) is never persisted as `negativeUntil`. The in-process negative cache is LRU-bounded at 1,024 ids.
- **F2 (Low–Medium), forged assertions could spend a victim app's back-channel budget.** The per-source limit stays before lookup. The per-client budget now counts only failed verifications of a locally matched removal, and is peeked before verifying. `FixedWindowGuard.consume` gains a windowed `peek`.
- **F5 (Low–Medium), an open removal survived disconnect and reinstall.** Disconnect and account-wide severance now conclude the open removal (`forced`, outcome `disconnected`) and delete its index row in the same commit. Force refuses `connection_stale` after a disconnect or reinstall, and the reminder tick skips disconnected or other-generation connections.
- **F3 (Low), `$'` and `` $` `` in a legacy link spliced page markup into the intent page.** Every insertion uses a replacer function, and `'` and `>` are escaped.
- **F4 (Low), one failing removal cascade blocked all later ones, re-arming every 60 s forever.** Rows now keep per-row attempts and back off from 1 min, doubling to a 6 h cap. After 8 failures a row is marked `stuck` and one `operator-alert` is logged. The alarm re-arms at the earliest next attempt.

Plausible items:
- **Fixed:** COOP `same-origin` on intent pages; the activation ticket is bound to a server-rendered POST or query intent (fragment and legacy tickets stay unbound, since the server never sees that value); starting from `suspended` refuses when the resume severs; integration-event leases re-check the live connection; the tick rewrites only advanced records; concluded removals are pruned.
- **Checked, unchanged:** back-channel `jti` replay protection is durable and bounded (`removalNonce`, 256 live per shard). `revokeRemovalFederation` still revokes rows with no connection binding or timestamp, because failing closed is the safe direction and such rows are short-lived.
- **Not added:** a per-account kind-miss limit, since an unregistered kind no longer costs any shared resource.

**Provisional:**
- the drain backoff, cap and stuck threshold (1 min, 6 h, 8 attempts);
- removal retention (90 days after conclusion, at most 100 concluded records per account);
- the `forced`/`disconnected` conclusion for a removal superseded by a disconnect.

The repro for F5 also counted the reinstalled app's own legitimate reminder, so the ported test counts only the old removal's notices.

**Review follow-ups** (independent review of these fixes; each has a regression test that fails when reverted):
- **F2 was only partly fixed.** An attacker could open their own removal of the victim app and spend the shared per-client failure budget. The budget is now keyed per removal and client. A shared per-client backstop was not added, because it would reopen the same starvation.
- **The reminder skip silenced connected apps.** The tick now skips only a connection that is missing, disconnected or reinstalled since start, the same rule force uses. A generation bump while connected keeps reminding.
- **An F1 variant remained.** Junk digests or versions of a registered kind spent the fetch budget. The configured port serves only local operator bytes, so it no longer charges a budget.
- **The alarm re-armed with no port.** With no `APP_REMOVAL_REVOKE_EXTERNAL`, rows stay pending without re-arming the alarm every 60 s.

**Gates:**
- focused intents, app-removal, artefact and integration-event suites: 247 of 247;
- UI-state 341 of 341, test:connections 18 + 13, Worker 89 of 89;
- core: 2,926 of 2,963. The 37 failures are 36 in orgs-memberships, orgs-ownership, orgs-discovery and orgs-certificates-runtime, from concurrent organization roster work outside this change, and the timing-sensitive resource-discovery cool-down test, which passes when rerun.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Organizations wargame fixes (F-01–F-07)

A red-team review of organizations found three High and four Medium findings, plus eight plausible items. Every confirmed finding is fixed. Each has a regression test (ported from the repro where one existed) that fails when its fix is reverted; that was checked revert by revert. Design notes are in [organizations design §13.2](docs/architecture/organizations-design.md#organizations-wargame-fixes-2026-10-23-provisional-coordinator-work), and two narrow rules are added to spec §5.2 and §7.2. Everything stays behind `ORGANIZATIONS_ENABLED` and the Polar sandbox: loopback fixtures and an offline Polar model, not production verification.
- **F-01 (High), mute grew the record without bound.**
  - A mute must name a valid principal.
  - Any valid principal is recorded, member or not (revised after re-review, below).
  - At most 64 per member, and the route now follows the flag (uniform 404 when off).
  - Every roster row has a 64 KiB budget, and app clients per member are capped at 32.
- **F-02 (Medium, structural), the whole roster lived in one value.** Memberships, invitations, requests and outbox events are now separate keys.
  - They commit in the same transaction, with indexes and a time index for the sweep. The record keeps bounded summary state.
  - At 5,000 members (the Scale plan) the largest value is under 2 KB.
  - Joins, decisions, the member view and the sweep cost the same store work at 100 and 5,000 members.
  - Closed invitations and requests, and delivered outbox events, are pruned after 30 days.
  - The admin listing is paged. The pre-release single-value shape is not migrated, because organizations are unreleased (flags off).
- **F-03 (High), an objecting admin could seize a held owner's organization.**
  - A held owner of record can renew; paying grants no governance.
  - A lapse claim whose deadline passes while the owner's hold is objected is escalated to an operator (audit and alert) instead of taking effect. It still closes if the owner pays.
- **F-04 (Medium):** an ownership change clears the new owner's membership expiry.
- **F-05 (Medium), the 17th subscription wedged reconciliation.**
  - Only live or held subscriptions are re-read and counted.
  - Settled subscriptions are forgotten after 30 days.
  - A claim checkout is reused for the same admin and terms, and capped at 4 a day; a superseded claim's payment is refunded.
  - A capacity refusal raises an operator alert.
- **F-06 (High), one member could lock everyone out of member tokens.**
  - Member tokens no longer share the shard's 256-token bound with app tokens.
  - At most 8 live per (membership, client), with the oldest evicted.
  - The organization-wide bound is the plan's members × 8.
- **F-07 (Medium), large organizations' member keys went stale.**
  - The refresh queue is time-ordered, and discovery is scaled to the roster.
  - Refreshes are enqueued at join, at an epoch rise and at same-host issuance.
  - The request path enqueues uniformly for any valid claimed principal through a bounded queue, keeping LM1's timing protection.
- **Plausible items, all confirmed and fixed:**
  - (1) per-event outbox back-off, so failures don't block later events;
  - (2) ending a membership closes the member's own requests;
  - (3) a new subscription failing verification is held with an alert;
  - (4) the refund check reads the current period's order;
  - (5) the membership port uses the writer's clock;
  - (6) the audit read is a bounded page;
  - (7) `token()` counts live rows and keeps its cleanup;
  - (8) a claim's standing is computed inside its commit.

**Provisional:**
- the retention windows (30 days for closed rows and settled subscriptions, 90 days for undeliverable events);
- the caps (64 mutes, 32 clients, a 64 KiB row, 8 tokens per membership and client, 4 claim checkouts a day);
- escalating rather than refusing the claim effect while the owner's hold is objected;
- storing any valid principal in a mute list (bounded by the cap and the row budget).

**Not fixed:**
- Superseded claim checkouts are not expired at Polar, because the pinned SDK has no expiry call. Their payment is refunded as unbound.
- Member-token issuance still lists every token row in the shard.

**Review follow-ups** (independent review of these fixes found no High issues; each item has a regression test that fails when reverted):
- **F-07 (Medium), unauthenticated claims could grow the key cache.** A request-path refresh stores no negative row. Key rows are indexed by expiry and pruned by the background run and the sweep. The claimed queue evicts its oldest entry when full.
- **F-01, the mute cap was a membership oracle.** The cap is checked first. After re-review, any valid principal is stored: when only known requesters were stored, the list's length still leaked membership. Mute and unmute now do identical work for members and non-members.
- **Refund idempotency:** the pinned Polar SDK (1.0.2) takes no idempotency key on `refunds.create`, so `drainOwnership` holds a lease. An overlapping drain backs off, and each order is refunded once.
- **F-07, request-path cost correlated with membership.** The request path now only notes the claimed principal in memory, and the enqueue runs in the background run after the uniform answer.
- **F-05:** claim-checkout reuse and the daily limit are re-checked in the commit; a concurrent same-terms start returns the committed claim.
- **F-06:**
  - at most 16 live member tokens per membership across clients;
  - the organization bound is the plan's members × 16;
  - a refused mint still commits the expired-token pruning.
- **F-03:**
  - an escalated claim closes after 30 days with every order of its subscription refunded;
  - ownership refunds now cover every order;
  - an operator can close or proceed (`orgs.claim-resolve`);
  - a held owner's view shows billing and renew only.
- **Sweep:** each due entry runs in its own transaction, and a failing one backs off without stalling the rest.
- **Small fixes:** `memberById` checks the row id, the app-client list is least-recently-used, and the runtime verifier and key cache use the writer's clock.
- **Scalability:** at 5,000 members, the console's default member listing read 5,004 rows and returned 3.3 MB.
  - It now pages 100 members and 100 requests (at most 500), with cursors and a "Load more" button (English and Spanish).
  - Requests are read with a bounded indexed query, and dedupe uses a Set instead of a quadratic scan.
  - The listing's store work is now flat at 100, 800 and 5,000 members (tested).

**Invitation preview and withdrawal** (for the org console; provisional):
- `orgs.invitation-preview` returns the organization's name and kind from its own record, only for an invitation the caller could accept now. Every other case, including an unknown organization, gets one uniform `not_found`.
- `orgs.invitation-revoke` (admin, also open while the flag is off) closes an invitation as `revoked`. It is pruned like other closed invitations, and acceptance then fails as `invitation_invalid`.
- The join screen shows the previewed name, and the share view has a Withdraw link button (English and Spanish).
- Spec §5.1 gains MAY rules for both.

**Provisional (follow-ups):**
- the 30-day escalation bound;
- the per-membership token total of 16;
- least-recently-used client eviction (a forgotten client misses only the removal event; its tokens still fail the generation check).

**Gates** (final tree, after the review follow-ups, invitation preview and withdrawal, paging and re-review fixes):
- core 3,095 of 3,095;
- test:organizations, full chain: 47, 46, 98 (browser) and 4 (e2e), all passing;
- UI-state 367 of 367 and Worker 90 of 90.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Organization console UX pass

This pass covers the organization console findings from the browser QA probe: F-1, F-2, F-3, F-4, the organization parts of F-8 and F-19, F-10 and F-12. The console's code is in `apps/web/src/ui/org-console.mjs`, `ui/org-messages.mjs`, `bl/organizations.mjs`, `bl/org-entry.mjs` and `providers/organizations.mjs`, plus the organization wiring in `release.mjs`.

**Provisional decisions:**
- **F-2, rendering and address.**
  - The organization console now renders inside the normal shell, as the `organizations` view composed in `release.mjs`.
  - Its address is `/console?view=organizations[&org=<uuid>]`, following the existing `?view=` links. No new server path is needed.
  - Entering the view and changing context push history entries, so Back and Forward reconcile from the address and reload reopens the same context.
  - The context bar always states who you are acting as. Unavailable organizations cannot be chosen.
- **F-1, unsaved recovery file.**
  - "This organization still needs its recovery file saved" is kept in `localStorage` as organization ids only, under `3sln-org-recovery-unsaved:<account>`. The file, the passphrase and any key material are never written there.
  - Leaving the recovery step is guarded in two ways:
    - `beforeunload` covers closing or reloading the page;
    - an in-app guard covers shell navigation, account switching, sign-out and Back. It offers "Stay and finish" or "Leave without saving".
  - The unsaved organization shows a persistent banner.
  - The banner offers a fresh file through the existing owner-of-record reissue (`POST /api/orgs/{id}/recovery-file`, fresh step-up). That reissue rotates the signing key before binding (P15), so the lost copy stops working. A non-owner sees that only the owner can issue a file.
  - "Mark as saved" needs an explicit confirmation.
- **F-3, invitations.**
  - The invitation link is now read before the browser provider strips link capabilities from the address bar. That stripping was the root cause of the link never opening.
  - The link opens a join screen that shows:
    - what joining means;
    - the expiry and the bound account, both from the token's claims, as untrusted hints;
    - a switch-account prompt when the invitation is for another account.
  - A signed-out landing keeps the invitation in `sessionStorage` for that tab only. The auth card says the person will return to it, and the join screen opens after sign-in or signup.
  - Paste accepts the full link or the bare signed token. The organization comes from the token's `aud`.
  - Owners get a share view with copy, expiry, audience and access.
- **F-4, forms instead of JSON.**
  - An invitee is entered by handle (resolved by the server) or by full identity link.
  - The audience is either one account or anyone with the link.
  - Grants are an admin checkbox plus an optional resource row (address, contract, methods) over the `packages/orgs/grants.mjs` vocabulary.
  - Members show their handle, "you" and admin badges, and an editable access form.
  - Kind labels are translated.
  - Audit rows are readable sentences.
- **F-8 messages.** Every console error and notice code maps to English source text translated through `packages/i18n/catalogues.mjs`, in English and Spanish, with a generic fallback.
- **F-12 creation eligibility.** It is shown up front:
  - allowlisted: the form is shown;
  - checkout: the sandbox text and the form are shown;
  - unavailable: there is no form, a state is shown, and there is a link to Billing.
- **F-19.** The organization skip link shows only on focus.
- **Theme.** The console uses the shell's tokens (`--line`, `--surface`, `--lime`, `--focus`, `--forest`, `--muted`) and inherited text colour, with no palette of its own.
- **F-10.**
  - Organization confirmation boxes show an inline "Tick this box to continue" message after a failed submit.
  - App-wide, `styles.css` marks any unticked required checkbox after a submit attempt (`:user-invalid`). `release-primitives` and connections forms call `reportValidity()`.
- **Additive backend, routes only (`packages/runtime/routes/orgs.mjs`):**
  - `POST /api/orgs/{id}/invitee {handle}`: admin-only, gated by the organization's own membership view. It returns the person's `{iss, sub, handle}`.
  - `GET /api/orgs/plans` adds `creation`: `allowlisted`, `checkout` or `unavailable`, for this person.
  - `GET /api/orgs/{id}/members|requests` add the public handle of each local principal.

**Gaps (not done):**
- The join screen cannot show the organization's name and kind before joining. Invitations deliberately carry no inviter text, and no server-validated invitation preview exists. Adding one needs a membership-domain operation in `packages/orgs/memberships.mjs`.
- Invitations cannot be revoked: there is no withdraw operation in the membership domain. The share view says so.
- Display names are not shown, because only handles are public.
- F-10 is fixed inline for the organization and connections forms. Other required-checkbox forms (signup, billing, accounts, account data, consent) rely on the shared CSS marker plus the browser's validation message.
- Dark mode of the shell itself belongs to the concurrent styles work. The console follows its tokens.

**Gates:**
- `npm test` 3,006 of 3,006;
- `npm run test:ui-state` 347 of 347;
- `npm run test:organizations`: 47 of 47, engine 42 of 42, browser 98 of 98 and e2e 4 of 4;
- `npm run build:assets` verified;
- `tests/e2e/org-console.test.mjs` 4 of 4 on an ephemeral Worker;
- connections browser 13 of 13;
- the new `tests/orgs-console-routes.test.mjs` passes, as part of `npm test`.

Reviewer: ___ Date: ___ Outcome: ___


## 2026-10-23 — D092 phase 1: policy and read-only visibility

Person billing reconciliation now records verified storage-entitlement reductions in the same transaction as its committed state. The causal provider event, before/after plan and bytes, revision, effective time and reason are durable. The account-owned producer consumes those transitions behind the default-off `OVER_QUOTA_RETENTION_ENABLED` flag. It persists the thirty-day absolute deadline, warning projection, notice schedule and separate attempt evidence, and connects the episode to the existing over-quota export allowance. The default notice port records `not-configured` and sends no message.

Owner Engine operations expose whole hosted-resource and inbox-collection units with byte totals and validate a revisioned keep selection against the current quota. Thin HTTP and the bilingual console expose the warning, exact UTC/local cutoff, selection and export link. Eligibility is computed only; phase 1 has no retention executor, no `reducing` transition and no user-data deletion.

**Provisional:**
- the thirty-day policy version, bounded anti-abuse history and conservative whole-unit selection model;
- catalog reductions require an explicit operator notice date and otherwise remain recorded without starting an episode;
- physical storage debt, adoption/backfill notice policy, terms migration, real notice delivery and destructive execution remain later work; these are reconciled against the broader phase outline in [offload-retention.md](docs/architecture/offload-retention.md#bounded-implementation-phases);
- export availability and a viewed account warning are separate evidence from provider acceptance, delivery or bounce.

**Spec reconciliation:** Engine operations are `retention.produce`, `retention.status`, `retention.keep`, `retention.view`, `retention.catalog-notice` and `retention.notice-result`. The system-only catalog action can supply a notice date after the original transition was consumed without an episode; first creation uses the later of the operator date and consumption time, and never extends an existing funded cutoff. Status exposes logical excess and reservations, with `physicalRetainedBytes:null` explicitly unknown because existing garbage references lack durable sizes and successful-delete receipts. This physical-debt metric is deferred from the broader phase outline. Whole-unit inventory pages metadata within an account transaction; million-item scalability is not claimed. Terms adoption and existing-excess backfill remain unadopted policy.

**Files changed by this pass:** `packages/app/operations.mjs`; `packages/billing/service.mjs`; `packages/flags/registry.mjs`; `packages/runtime/{retention,accounts,export-hooks}.mjs`; `packages/runtime/account/{retention,billing,index}.mjs`; `packages/runtime/routes/{retention,index,shared}.mjs`; `apps/web/src/bl/account-data.mjs`; `apps/web/src/ui/account-data.mjs`; `tests/{billing-retention-transitions,engine-retention,flags-registry,retention-http,retention-webhook-chaos}.test.mjs`; `tests/worker/retention.test.mjs`; `tests/browser/{retention,account-data-browser}.mjs`; `package.json`; `docs/architecture/{offload-retention,account-deletion-export}.md`; `DEVLOG.md`. Concurrent changes in shared files belong to their separate work entries.

**Validation:** final `npm test`: 3,050 of 3,050; `npm run test:ui-state`: 364 of 364; `npm run test:worker`: 90 of 90, including actual workerd SQLite retention parity. Focused flag registry tests: 14 of 14; retention Engine review checks: 13 of 13. Real-webhook chaos covers 16 seeded schedules with 12 contention rounds each, and the Node HTTP check verifies restart persistence and owner/CSRF guards. Chromium/Firefox retention cases pass 4 of 4 in English/Spanish. The broader account-data browser file passes 46 of 58; all 12 failures pin the previous dark background `rgb(24, 35, 29)` while the concurrent theme renders `rgb(34, 40, 38)`. Those unrelated assertions were preserved. An earlier core run encountered a transient syntax error during concurrent organization edits; the final full run is green.

**Review follow-ups (2026-10-23, provisional; each has a regression test that fails when its fix is reverted):**
- M1, backdated episodes: the producer records a flag-adoption point in the ledger. Transitions recorded before it are backfill: a fresh episode with effective time and deadline taken from consumption, nothing from history. Every new deadline is floored at `max(effectiveAt, consumedAt) + 30 days`. Notice slots already past at creation, or overtaken by a later due slot, are marked `skipped` instead of firing together. The late-consumption Engine test now pins the design rule "fresh notified episode, not backdated cleanup". The billing transition still records the provider's paid-through time.
- M2, flag gating: the routes return the uniform `{error:'not_found'}` 404 with `OVER_QUOTA_RETENTION_ENABLED` off. As with deletion and export status, a persisted episode stays readable but not writable. `retention.keep`, `retention.view` and `retention.catalog-notice` refuse with the flag off, and `retention.status` answers `not_found` without an episode. `retention.notice-result` stays available so evidence for an existing episode can still be recorded during a ramp-down. The client treats a retention 404 as absent.
- M3, alarm load: the retention alarm no longer warms (un-shelves) an account or refreshes billing. It runs the producer only with an active or paused episode, unconsumed transitions or catalog-pending rows. The producer returns its next wake: a notice slot, retry or deadline, at least every six hours while an episode is active, hourly while paused, and none when idle.
- M4, anchor release policy (provisional; reviewer sign-off below): a funded anchor is released by (a) a verified purchase that raises entitlement above the anchor's reduced quota and covers current usage, at most once per 90 days; (b) 30 days of continuous adequate paid entitlement; or (c) its deadline passing while the account fitted its quota, which is never reused. Quick toggles inside the purchase window reuse the funded cutoff. Continuity is observed at producer runs, and every entitlement reduction triggers one.
- L1: producer runs write the episode, warning and ledger only on a semantic change. An observation-only advance is persisted at most hourly without a revision bump, so `OfferOverQuotaExport`'s `expectedRevision` stays valid. Status scans the inventory only for an unresolved episode, at most 5,000 rows per request (`inventoryTruncated`; keep refuses with `retention_inventory_too_large`). Routes have a 30-per-minute per-owner budget that follows the app-removal admission pattern.
- L2: `retention.view` stamps only an active episode, and only once. L3: `retention.notice-result` accepts evidence only for accepted, delivered or bounced attempts. Port outcome timestamps outside `[attemptedAt, completion]` are dropped. L4: `not-configured` records `checkedAt` and `port: absent|declined`. An absent port is re-asked once configured, and a declining port after a day.
- L5: eligibility and notice due times use a persisted high-water observation that advances at most one day per reading. Wakes are computed against that observation, so a lagging observation does not spin. L6: a malformed transition with no episode is skipped (`malformed-skipped`) with an `over-quota-retention` operator alert, logged through `lifecycleLog`. L7: replaced resolved episodes keep their notice, view and export-offer evidence in a bounded ledger history of 8. L8: a provider effective time up to five minutes ahead of the clock is recorded as now, with `providerEffectiveAt`; larger skew is still not evidence. L9: local cutoff times name the viewer's IANA zone. An out-of-range deadline renders as unavailable in the panel and banner instead of throwing.

**Follow-up files:** `packages/runtime/retention.mjs`; `packages/runtime/account/retention.mjs`; `packages/runtime/routes/retention.mjs`; `packages/billing/service.mjs` (skew clamp only); `apps/web/src/ui/account-data.mjs` (cutoff rendering helpers only); `apps/web/src/bl/account-data.mjs` (retention 404 only); `docs/architecture/offload-retention.md`; `tests/{engine-retention,retention-http,retention-webhook-chaos,billing-retention-transitions}.test.mjs`; `tests/worker/retention.test.mjs`; `tests/browser/retention.mjs`. `packages/runtime/accounts.mjs` needed no change.

**Follow-up validation:** `npm test`: 3,099 of 3,099; `npm run test:worker`: 90 of 90; `npm run test:ui-state`: 367 of 367; Chromium/Firefox retention cases in `tests/browser/account-data-browser.mjs`: 4 of 4. Reverting each fix by mutation made its regression test fail (30 mutations, all caught).

**Re-review follow-ups (2026-10-23, provisional; each has a regression test, revert-checked on a scratch copy of the tree so shared files were never rewritten):**
- N1, grace renewal through short paid holds: the review probe (deadlines 32→62→92→122→152 days) is ported as Engine tests with ~1-day and 8-day holds. Decision: a fit caused by an entitlement rise counts against the same 90-day window as `verified-upgrade`. Only fitting achieved by reducing stored bytes (usage within the anchor's reduced quota) qualifies for `deadline-passed-fitting`, and only from at least seven days before the deadline.
- N2, inventory dead end above 5,000 rows: units now come from their few resource and collection records. On Worker and Node, per-unit bytes come from one SQL `GROUP BY` per unit kind over the item index (`inbox_catalog`, `hosted_catalog`) once `item-index-ready` and `search-backfill-ready` are set, read through the account transaction. Otherwise a bounded scan is used. Bytes are shown, and fit enforced, only when they reconcile exactly with logical accounting. Otherwise units stay selectable by name with `keepSelectionFit:'unknown'`, and the console shows an explicit "sizes too large to calculate here; choose by name or export" state. With no listable units it shows an export pointer instead of an empty Save form. This supersedes the L1 refusal above. Remaining limit: more than 5,000 unit records still reports `inventoryTruncated` and cannot save. The aggregate remains linear in indexed rows inside SQLite. No per-unit counters were added, because the message-usage writers live in concurrently owned messaging code.
- N3: anchor release uses the ledger's own step-capped, corroborated observation. A reduction that arrives after more than an hour without a producer run waits one corroborating reading (a minute), leaving the anchor trackers and any resolved episode untouched, instead of deciding reuse on a lagging clock.
- N4: with the flag off, the route asks the new owner-checked RPC `retentionHasEpisode` and answers the uniform 404 before spending the request budget.
- N5: removed the unconditional `scheduleAlarm(now+60s)` after every billing webhook in `packages/runtime/account/billing.mjs`. D092 phase 1 had added it; before that the webhook scheduled nothing, and the producer now schedules its own `wakeAt`.
- N6: the observation catches up after downtime to the previous persisted reading once a later reading corroborates it, and never exceeds the current reading. Notices are therefore never early and the cutoff never moves earlier. Notice due times use the run's corroborated observation, never a reading that the same run persisted. A lagging episode wakes again a minute later.

**Re-review files:** `packages/runtime/{retention,account/retention,routes/retention}.mjs`; `packages/runtime/account/billing.mjs` (webhook alarm line only); `apps/web/src/ui/account-data.mjs` (retention unit list and notice only); `docs/architecture/offload-retention.md`; `tests/{engine-retention,retention-http}.test.mjs`; `tests/browser/retention.mjs`.

**Re-review validation:** `npm test`: 3,115 of 3,115; `npm run test:worker`: 90 of 90; `npm run test:ui-state`: 368 of 368; Chromium/Firefox retention cases: 4 of 4. All 12 scratch-copy reverts made their tests fail.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — UI quality pass (browser probe findings)

Addressed F-5/F-6/F-7/F-9/F-11/F-13/F-14/F-16/F-17/F-18/F-19/F-20/F-21: bounded account-read retries (250/500 ms, three attempts) and explicit Retry state; retained signed-in shell during offline/session outages; signup step history and a cross-tab pending hint; persisted explicit locale; actionable intent/transfer errors and localized certificate fallback; credential-age recovery eligibility before opening the replacement dialog; inclusive configured minimum-age copy and truthful setup progress; connected integration state and configured-only Google Drive offerings; shared light/dark tokens, help associations, contrast and responsive layout fixes; removal of the unsupported Permissions-Policy feature and duplicate catalogue keys. Existing concurrent organization, transfer, removal and retention work was preserved.

**Provisional:** device labels use touch plus narrow viewport to suggest phone/tablet, otherwise computer; TV remains an explicit choice after choosing linked-device sign-in ([linked-approval.md](docs/architecture/linked-approval.md)). Pending setup in other tabs is a nonsecret browser hint: the session endpoint exposes no pending account details, and the hint grants no setup authority. Recovery eligibility is display metadata derived from existing credential timestamps; the identity service rechecks actual authority when requested. Shared theme tokens are available to the concurrently owned organization console; its views were not edited in this pass.

**Validation:** `npm test`: 3,050 passed, zero failed; `npm run test:ui-state`: 364 passed, zero failed; `npm run build:assets` and `npm run check:worker`: passed. Activity Chromium regression: 14 passed; focused theme regression: one passed; focused Connections browser regression: 13 passed; `npm run test:e2e`: 272 passed, zero failed, four skipped across 13 suites (276 tests total); the four skips require the unavailable WebKit executable. The main Worker suite contributed 125 passed, zero failed, zero skipped. The requested eight-case Chromium visual matrix passed within that suite (390×844 / 1280×900 × English/Spanish × light/dark), including account retry and retained offline shell. The first core attempt had one HTTP-page failure while assets were being rebuilt concurrently (the isolated file then passed 7/7); the complete rerun above passed. Updated the old e2e assertion requiring a light-only console to require the shared dark theme and matching logo; the standalone Connections fixture now loads the real shared stylesheet and checks palette consistency. Chromium screenshots cover 390×844 and 1280×900, English/Spanish and light/dark; representative small labels/help/navigation text meet 4.5:1 contrast. This is representative measurement, not an exhaustive contrast audit of every possible account content state.

**Files changed by this pass:** `apps/web/src/bl/{release,connections}.mjs`; `apps/web/src/providers/browser.mjs`; `apps/web/src/certify-member.mjs`; `apps/web/src/ui/{release-app,release-primitives,release-auth,release-signup,release-recovery,release-security,release-views,intent-page,transfer-page,recovery-reissue,activity,devices,account-data,certify-member}.mjs`; `apps/web/src/ui/connections/{index,style}.mjs`; `apps/web/styles.css`; `packages/i18n/catalogues.mjs`; `packages/runtime/{http,recovery-eligibility}.mjs`; `packages/runtime/routes/shared.mjs`; `docs/architecture/linked-approval.md`; `tests/browser/{release-state,ui-chaos,connections-engine,ui-quality-views,activity-browser,connections-browser}.mjs`; `tests/e2e/{ui-quality,ui-adversarial}.test.mjs`; `scripts/run-browser-checks.mjs`; `package.json`; `DEVLOG.md`.

Reviewer: ___ Date: ___ Outcome: ___


## 2026-10-23 — Scalability fixes (legacy message reads, removal index, artefact history, intent index)

Legacy message arrays now use the shared Node/Worker SQL item catalog, preserving the 1,000-message limit and ascending ID ties. All filter combinations have ordered indexes; cursors bind their filters and use two disjoint seeks, including deep equal-timestamp pages. Incomplete migration fails closed. Hosted app removal deletes the resource-index key using registration's shared `(connection, resource)` hash, retaining the same transaction, generation fence, delegation revocation and severance/cascade behavior.

Artefact head/notices now persist separately from 128-digest pages. Exact resolution avoids history metadata; bounded warm authenticated copies reuse verified prefixes, validate/store the new suffix, and assign the digest vector once. Legacy history migrates transactionally. Normalized operator documents are cached per configuration revision, retaining live operator object updates and builtin precedence. Adopted intent handlers have a transactional kind/version index updated with connection mutations; routing rechecks the current generation and exact declaration and deduplicates version resolutions. The adapter still reconciles before every operation. Derived keys use the existing `item-index/` namespace; export files were not changed.

**Provisional:** extra SQL indexes trade write/storage work for bounded filtered reads. Existing intent accounts migrate once in a transaction using 100-row pages; steady-state work depends on matching handlers, not unrelated resources. Unwrapped custom engine stores retain the compatibility scan fallback; durable Node/Worker stores install the wrapper. Warm artefact comparisons remain proportional to bounded envelope bytes, and cold processes authenticate the supplied prefix again. The 16-line authenticated cache is ephemeral; durable records and digest pages remain authoritative. These local measurements do not establish production CPU/memory limits or external service conformance; production release remains disabled.

**Re-measurement:** original report baselines versus final local runs (timings noisy under concurrent work):

| Workload | Before | After |
|---|---|---|
| Legacy page50 / 5,000 messages | 91.540 ms; 5,000 metadata rows / 3,850,000 B | 0.273 ms; 1 housekeeping row / 861 B; SQL separately bounded at 51 rows; identical 33,801 B array |
| Hosted removal / 256 records | 241.209 ms; 14,624 rows / 126 lists | 8.748 ms; 256 rows / 5 lists; zero resource-index lists |
| Latest repin / 1,024 versions | 2,536.116 ms; 1,027 gets / 502,905 B | 107.219 ms; 3 gets / 376 B |
| Cold pin / 1,024 versions | 3,413.827 ms | 400.845 ms; largest stored value 108,670 → 6,785 B |
| Exact resolve / 1,024 versions | 0.876 ms; 108,954 B | 6.448 ms; 472 B (timing regressed in this noisy sample; bytes bounded) |
| Registry check / pin with 5,000 lines | 6.463 / 285.002 ms | 0.100 / 2.955 ms |
| Selective intent / 100 apps, one match | 2.449 ms; 101 rows / 104,789 B | 0.317 ms; 1 index row plus exact connection check / 1,346 B |

The selective intent baseline is a paired run with the indexed capability disabled to exercise the original fallback. Original same-kind routing still needs all 100 candidates: the indexed run reads 100 index rows plus 100 current connections and measured 6.84 ms versus the report's 1.632 ms; no speedup is claimed for all-matching fanout. At 10/50/100 apps the selective run reads one index row and three total gets. Probe scripts, outputs and a fuller report live in `/private/tmp/claude-501/-Users-raystubbs-Projects--3sln-3sln-me/8f763b0e-277c-4c0c-b7f0-8c3d4fc70450/scratchpad/scalefix/REPORT.md`; the original removal script ran unchanged.

**Review/spec reconciliation:** coordinator review found and corrected legacy digest-page migration at page boundaries, sparse-envelope prefix rereads, unknown-to-known kind validation, configured builtin precedence, deep SQL cursor scans, and transaction instrumentation recursion. A separate technical review found no change to removal atomicity/generation semantics and no stale-handler offering path through the indexed router. These are implementation reviews, not approval/sign-off. Architecture notes updated in `app-engine.md`, `app-uninstall.md`, `artefact-references.md` and `intent-links.md`.

**Validation:** final `npm test`: **3,061 passed, zero failed**; final `npm run test:worker`: **90 passed, zero failed**, including actual workerd adapters. Focused message/index tests: 26/26; artefacts: 132/132; combined intents and app-removal engine/wire/runtime tests: 111/111. New metering tests cover flat unrelated-resource work, bounded message rows and query plans/deep cursors, linear removal record reads with zero resource-index lists, bounded artefact repins/resolution, migration, stale/corrupt indexes, rollback and portable Worker-style KV transactions. The first full run exposed four transaction-instrumentation recursion failures from this change; all were fixed and the complete suites rerun successfully. No remaining failure is attributed to concurrent agents. No UI changes or commits in this pass.

**Review follow-ups** (second review of this entry; each fix has a regression test confirmed to fail with the fix reverted):

1. *Stale legacy list (medium-low).* `messagePresentation` rewrote `message/<owner>/<id>` without updating the SQL catalog, so both the legacy array and v2 `messagePage` served stale `presentation` metadata. Fixed by `itemIndex.upsert` in that transaction. Audit of every raw `message/` writer: postback request writes (`message-postbacks.mjs`, two sites; the public projection strips `postbacks`, so this is consistency only) and shelved-archive restore in `warm` now upsert too; store-mediated writers (messaging, contact delivery, conversations, app notifications) already did; search backfill already did; retention/activity/notifications only read. `tests/message-presentations.test.mjs` now uses SQL and seeds through `c.store` instead of a raw put after `item-index-ready`; new test compares legacy-list and `messagePage` entries with the stored record after two saves and a restart. Other raw-put fixtures construct controllers without SQL (scan path) or seed before migration.
2. *Legacy filter drift (low).* **Provisional decisions:** (a) a missing `readAt` counts as unread, matching `readAt==null` in the catalog and the incoming catalog; the scan fallback now agrees. (b) A missing `quarantined` counts as not quarantined (falsy), likewise in both paths. (c) `docs/spec/messaging.md` documents no error for wrong-typed legacy filters, so the legacy array again returns `[]` for them (the v2 page keeps `invalid_args`). (d) The legacy array takes no cursor, as before; the parameter added in this pass was removed. Production writers always store `readAt` and `quarantined`, so (a)/(b) affect only legacy-shaped rows. Test: `tests/messages-legacy-filters.test.mjs` (SQL and scan paths).
3. *Warm accepts what cold rejects (low).* The authenticated-prefix shortcut now reuses a body-less entry only when the next entry still has `version===i+2` and `prev` equal to the stored digest and the supplied record equals the authenticated record canonically; otherwise the cold verifier decides. Test: `tests/artefacts/warm-cold.test.mjs` runs both paths over trailing, wrong-next, tampered, missing-record and valid sparse copies, at core level and through the runtime (including recorded faults).
4. *Intent index epoch (low).* The ready marker is now `item-index/intent-handler-index/state` = `{version:INTENT_INDEX_VERSION}` (1). Any other epoch, including the earlier boolean `.../v1` marker, clears derived keys and rebuilds in 100-row pages inside one transaction. **Provisional:** a rollback to code that did not maintain the index is caught only if the roll-forward release bumps the epoch; that is the documented procedure (`intent-links.md`). Test added to `tests/intents-index.test.mjs`.
5. *Index build at boot (low).* Measured locally (Node SQLite, WAL, ~700 B records): building the 12 indexes over 100,000 existing rows took 2.1–3.4 s in total, 125–436 ms each; 10,000 rows took 190 ms. Construction is therefore no longer used for an existing catalog. An empty catalog still creates all indexes at construction. Otherwise `migrateItemIndex` (on warm and alarm) builds missing indexes, at least one per step, up to 100,000 index-rows per step (count x rows; Workers clocks do not advance during synchronous SQL, so the bound counts work, not time). It arms a 1 s alarm and both legacy and v2 reads return 503 until every index exists. **Provisional:** a single index over a very large catalog is still one unsplittable statement (about 3–4 s per index projected at 1M rows); Worker CPU limits are not measured here. Test added to `tests/messages-index-scale.test.mjs` (30,000 rows: no build at construction, three 503 steps, then ready).
6. *Registry (informational).* `configuredArtefactDocuments` again enforces the 100-fragment bound (counting the Drive builtin while integrations are enabled) on every lookup against a live registry, and returns deep-frozen copies cached per distinct value (byte arrays are copied) instead of live operator or module objects. **Provisional:** an in-place nested edit to an entry already read takes effect only after the entry or registry is replaced. Test added to `tests/artefacts/scale.test.mjs`.

Docs reconciled: `app-engine.md`, `intent-links.md`, `artefact-references.md`. **Follow-up validation:** `npm test`: 3,102 passed, 2 failed. Both failures (`tests/identity-key-tombstones.test.mjs` seeded chaos, `tests/successor-budget.test.mjs` budget constants) are in concurrent identity work, untracked/modified under `packages/identity`, and this pass did not touch them. `npm run test:worker`: 90/90. Focused: artefacts 135/135; intents 61/61; app-removal and engine app-removal 51/51; `tests/messag*` + `engine-item-index` 86/86. Not committed.

Reviewer: ___ Date: ___ Outcome: ___


## 2026-10-23 — Successor chain byte budget and key tombstone compaction

The scalability probe found that rotating successor chains hit the flat 32 KiB document bound at 15 moves (33,932 B), below the 16-move limit. It also found that the key tombstone collection grows by one row per pruned kid (85 after 100 rotations). Spec revision 3.3 is in `docs/spec/identity-portability.md` (§4 and §7 "Size", §5.3, §9.3, §12, AMD-P4); `docs/spec/organizations.md` §3a.3 has a one-line pointer to it; the design is in `docs/architecture/identity-portability.md` §7.1.

**Provisional (security/protocol agent, not signed off):**
- **Per-move caps (§4, §5.3).** Identity URIs inside moves are at most 512 characters. A compact statement is at most 3,072 B and an attestation at most 2,560 B. With 128-character ASCII kids the worst cases are 2,721 B and 2,022 B. Parsers refuse oversize records before any signature work, and signers refuse to produce them.
- **Derived document budget (§7 "Size").** The budget is 32,768 B of base (own members, certification keys and 16 own signing keys) plus 16 × 7,488 B per move (statement, attestation, framing and one 1,792 B chain key for the activation rotation), which is 152,576 B. The client fetch bound equals the budget. Verifiers refuse anything above it, an over-cap record or more than 16 records. A document without `moves` stays at 16 KiB, which the client now enforces. Separate history and key pages were rejected because they add fetch rounds and failure modes without lowering the worst case.
- **Producer guard.** `assessTransferIn` runs at check, reserve and begin, before anything is reserved, imported or signed. It projects the largest document the identity can have at the destination: the source's records, the exact statement size, an attestation at its cap, every imported key, and the base reserve for 16 own keys. It refuses with `identity_uri_too_long`, `move_too_large` or `document_budget_exceeded` (409), and also when the identity would need more than 64 keys. `identityDocument` also refuses to publish over-cap records or more than 64 keys.
- **Found while fixing.** Transfer-in imported only the last 12 ancestors, which would drop statement signers from the 14th rotating move onward. With the full history, pinned keys counting against `KEY_HISTORY_LIMIT` would make the 16th arrival's activation rotation fail with `key_history_full`. Separately, `#admit` could prune a retired link of a moved identity's continuity chain, leaving its published `moves` unverifiable. Fixes: history reaches back to the first statement signer; pinned keys do not count against the 16-key own history (`IMPORTED_HISTORY_LIMIT` 63); and chain links of a moved identity are never pruned. Such an identity's 17th own key at one host is therefore refused with `key_history_full`, and recovery issuance skips and audits, as P15 already does. Lifting that bound needs an independent key-event record, not a larger history.
- **Tombstones.** Pruned kids form an exact set paged at 128 kids per row (`identity-key-pruned/<owner>//<n>/`; the empty segment can never be a kid). There are no digests or Bloom filters, so anti-reuse stays exact. Legacy per-kid rows still refuse reuse and are folded in at the next prune. Bytes still grow by about 40 per prune, which is inherent to exact anti-reuse of arbitrary kids. 100 rotations now leave one row instead of 85. `retainedState` and the `IdentityKeyRetainedState` query report signing (own/pinned), encryption, retained-key, binding and tombstone counts.
- **Reference discovery unchanged.** The scan still runs only at a full-history rotation and covers the account's own grants and links. A per-key index would have to be maintained by the messaging and links writers, and a stale index would let a referenced key be pruned. Deferred to those owners.

**Re-measurement:** the probe's `successors.mjs` was rerun unchanged, rotating. 1/4/8/12/15/16 moves are all adopted (15: 33,932 B, 16: 36,187 B), and 17 is refused as malformed. The new worst case (252-character origins, 512-character URIs, 16 rotations) is a 84,310 B document, and it is adopted.

**Tests:** new `tests/successor-budget.test.mjs` (5), `tests/transfer-in-budget.test.mjs` (3) and `tests/identity-key-tombstones.test.mjs` (5, including seeded chaos). In `tests/transfer-in.test.mjs`, the size-bound test is updated to the new caps. The portability suites (`portability-wargame-*`, `transfer-*`, `successors*`, `identity-succession`, `moved-routes`, `recovery-*`) pass 196/196. Adding `successor-budget`, `identity-key-tombstones`, `identity-keys`, `rotation-honouring`, `key-delegation` and `engine-account-export` gives 255/255. `npm test`: 3,074/3,074. Not covered: Worker adapters (`npm run test:worker` was not run, since no adapter changed), real provider conformance and production limits.


**Independent review follow-up (same day).** These points supersede the "16 KiB without `moves`", "17th own key is refused" and "issuance skips" statements above. Each fix has a regression test that fails when the fix is reverted; reverting each fix in turn was checked by script.
1. **Directory consumer (medium-high).** `packages/federation/directory.mjs` still fetched and validated identity documents at 32,768 B, so contact delivery and organization member-certificate verification would break for chains that now publish. It now uses the shared constants for the fetch bound and validation, and checks the per-record caps and the 16-record limit. The constants moved to the dependency-free `packages/identity/document-budget.mjs`, which `succession.mjs` re-exports. A grep found no other consumer with hard-coded document bounds. Test: `tests/directory.test.mjs`, a moved document above 32 KiB through `IdentityDirectory.refresh`.
2. **No-moves bound (medium).** At 16 KiB, a document without `moves` could not hold 16 own keys: after about 15 recovery reissues `identityDocument` returned null and the identity answered the uniform 404. The bound is now `DOCUMENT_BYTES` = `DOCUMENT_BASE_BYTES` = 32,768 B everywhere: org spec §3a.3, `identityDocument`, `validDocument` and the directory. Tests: 15 rotations still publish a document (`identity-key-tombstones`), plus the directory test.
3. **Moved identities and P15 (medium). Coordinator decision, provisional, not signed off.**
   - The 16-key base is a reserve, not a ceiling. A moved identity keeps own chain keys beyond 16 while its published document has real headroom. `keys.mjs` checks this from the arrival record `transfer-in/v1` (the source's records, this host's statement and attestation), every remaining signing key in published form, the new key at 1,792 B and a 4 KiB header and certification reserve, against the budget and 64 keys. With no arrival record the check fails closed. In tests, a byte-bound run reached 28 own keys and stopped within about 350 B of the real limit, because the estimate counts published times at maximum width. A count-bound run stopped at 64 keys including the certification reserve.
   - When rotation is still impossible, `IdentityService#reissueRecoveryBegin` refuses with `rotation_unavailable` (409) and stages nothing. It never issues a file that holds the same signing key. The console (`apps/web/src/bl/recovery-reissue.mjs`, one catch, no catalogue change) explains that the key cannot be replaced, that the current file keeps working, and that the owner should contact support if it was exposed.
   - The replacement file after an actual recovery keeps the documented P15 skip and audit, so a recovering owner is never locked out. Revisit if the coordinator wants that path refused too.
   - Spec §7 now states what revoking a retired chain key does: the lineage is cut there, existing pins remain, first contact and adoption through that point fail closed (pending successor at most), and later moves out are refused.
   - Tests: `identity-key-tombstones` (growth beyond 16, refusal near the real bound, chain intact), `recovery-reissue` (`rotation_unavailable`, nothing staged, no pruning) and `tests/browser/recovery-reissue-rotation.mjs` (the console message; nothing stored or published).
4. **Attestation-key amplification (low).** `chained()` is memoized per kid within one `evaluateAttestationKeys` call. A 64-key JWKS with 32 never-verifying keys now costs at most 64 ECDSA verifications. Without the memo it cost about 1,000, from re-verifying on every closure pass.
5. **ASCII kids (low).** Move statement and attestation headers, and their signers, require a kid of 1–128 printable ASCII characters (`MOVE_KID`). Non-ASCII characters, lone surrogates and controls are refused, so the stated worst cases hold. Intake refuses a non-ASCII package kid with `identity_key_unsupported`. Spec §7 "Size" now states the one-chain-key-per-move assumption, and what happens when a host rotated more than once: the extra chain keys are counted by the intake projection and limited by rotation headroom.
6. **Chaos test (low).** It now seeds legacy rows, runs 400 steps at `historyLimit` 2, crosses the 128-kid page boundary for every seed, and attempts `importTransfer` reuse of pruned and legacy kids (as the signing key and in the history), plus a positive import. Checked with seeds 1, 17, 40, 78 and 120.

**Validation after the follow-up:**
- Portability suites: 204/204.
- Identity, directory, certificate, rotation-honouring, key-delegation and account-export suites: 229/229.
- Console test: 1/1.
- `npm run test:worker`: 90/90.
- `npm test`: 3,103/3,107. All 4 failures are in `tests/engine-retention.test.mjs`, untracked files of the concurrent over-quota retention work. That file passes 29/29 on a rerun alone, so the failures were mid-edit churn, not this change.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Console first-load performance

**Provisional build decision (not signed off):** reuse `@3sln/js-tools` staging, fingerprinting and wire-up, plus the existing esbuild browser/import-map resolver, to emit a minified, content-addressed ordinary-console composition bundle. Parser-visible modulepreloads cover each page's static entry closure and the console composition root, after the classic bootstrap installs the authorized import map. Transfer, intent, authorization, demo and administrator entry points retain their existing separate selection; organization views remain inside the ordinary composition bundle rather than introducing new runtime view boundaries. No `packages/*` business logic or vendored APIs were changed. The initial console HTML now offers sign-in/account-creation navigation while JS loads; credential forms still require JS.

**Security/architecture reconciliation:** preserve shared entry-module identities across the bundle boundary. The first browser walkthrough caught a duplicate copy of `onboarding-entry.mjs`, which lost the one-use invitation captured before the dynamic import; the final resolver externalizes the entry's static closure to its existing immutable URLs. The real boot → claim → onboarding → administrator walkthrough and an explicit bundle/import identity assertion pass. This is implementation verification, not security approval. The complete public-source graph check remains in place, the import-map CSP digest is regenerated after aliases select the bundle, no CSP source is broadened, and the service worker still derives its integrity/cache generation from emitted bytes. Existing Brotli and one-year immutable headers were verified on the new bundle; no new compression/serving mechanism was needed. Two successive builds produce `eff4d4f4228373b310e6`. Production release remains disabled and the gates in `docs/spec/security.md` remain open; no external provider conformance is claimed.

**Measurement:** `.output/perf/probe.mjs`, invoked through `scripts/run-browser-checks.mjs`, uses a fresh isolated local Worker/asset snapshot, cold contexts and immediate warm HTTP-cache navigations. Slow 4G is CDP 150 ms latency, 200,000 B/s down and 93,750 B/s up, with no CPU throttle. Signed-in API responses use the existing Wave 5 fixture shape through CDP Fetch (Playwright routing would disable HTTP caching); application assets use real Worker networking. Paired runs block service workers to isolate HTTP caching, with a separate service-worker-enabled smoke run passing. Requests include logical cache hits; bytes are CDP encoded transfer including headers, not decoded source. Landing paint is the server heading followed by two animation frames; signed-out readiness is the hydrated sign-in method control; signed-in readiness includes finished account loading and an actual navigation click. One sample per case, so local timing differences are noisy. The externally reported 20 s was not reproduced with these settings.

| Network | Cache | State | Requests before → after | JS requests | Transfer B | Landing paint ms | Interactive ms |
|---|---|---|---:|---:|---:|---:|---:|
| local | cold | signed out | 150 → 11 | 144 → 5 | 713102 → 448499 | 62 → 102 | 864 → 197 |
| local | warm | signed out | 150 → 11 | 144 → 5 | 4306 → 4430 | 133 → 129 | 147 → 143 |
| local | cold | signed in | 152 → 13 | 144 → 5 | 712493 → 447812 | — | 883 → 213 |
| local | warm | signed in | 151 → 12 | 144 → 5 | 3626 → 3808 | — | 167 → 168 |
| slow4g | cold | signed out | 150 → 11 | 144 → 5 | 712971 → 448499 | 483 → 594 | 6313 → 3405 |
| slow4g | warm | signed out | 150 → 11 | 144 → 5 | 4295 → 4430 | 566 → 572 | 589 → 586 |
| slow4g | cold | signed in | 151 → 12 | 144 → 5 | 712312 → 447818 | — | 6332 → 2924 |
| slow4g | warm | signed in | 155 → 13 | 144 → 5 | 4157 → 3092 | — | 345 → 331 |

Preloads alone retained 144 JS requests and moved cold Slow 4G sign-in/console readiness only from 6,313/6,332 ms to 5,949/5,950 ms. The final bundle reduces startup JS requests to five, cold transfer about 37%, and cold Slow 4G signed-in readiness about 54%. Static signed-out paint regresses by 111 ms on Slow 4G because map installation now runs in the head; the shell offers account navigation during that interval. Warm-cache readiness is broadly unchanged. The existing broad offline background precache remains; this change does not claim to reduce its entire asset set. Raw paired JSON, preloads-only results, service-worker smoke data, headers, logs and methodology are in the gitignored `.output/perf/REPORT.md` directory companions.

**Final validation:** `npm test -- --test-concurrency=4`: **3,115/3,115 passed**; `npm run test:ui-state`: **368/368 passed**; `npm run test:worker`: **90/90 passed**; `npm run test:e2e`: **273 passed, 4 skipped, zero failed** out of 277 tests across 13 subprocess summaries (exit 0). The four skips are unavailable WebKit binaries; Chromium and Firefox ran. `npm run build:assets` and `npm run check:worker` both passed (254 addressed source modules plus the generated console bundle; Worker dry-run completed). Focused build/browser regression checks: 3/3; real administrator/onboarding plus build checks: 4/4; paired performance and supplemental service-worker-enabled probes: 1/1 each. Successive final builds have the same build ID. All final core/UI-state/Worker runs were repeated after the shared-module correction.

**Intermediate failures and limits:** the initial full core run was 3,113/3,115, with a generated-asset read racing a build in the deletion HTTP test and a timing-sensitive `egress_busy` discovery test under high concurrency; both pass in the focused 16/16 rerun and final full runs at concurrency four. A browser suite was restarted after an asset-snapshot/build race, and stale-snapshot runs were stopped when the bundle changed. The onboarding duplicate-module failure was an actual implementation bug and was corrected as described above. No remaining failure is attributed to another agent. Concurrent review files appeared under `docs/spec/organizations.md` and `tests/wg2-*.test.mjs` after the final core run started; they are outside this change and were left untouched. No commits were made.

**Review follow-ups (2026-10-23; provisional, awaiting reviewer sign-off):**
- Removed the superseded individual release asset after rewriting every alias, before collecting disk assets, manifest entries and service-worker precache. Browser regression checks reject its presence in the manifest and service worker.
- Moved the console bundle hint from static HTML into external `main.mjs`, using the authorized import map and existing CSP. Only the ordinary release branch adds it, before importing the composition root; host administration, member certification, loopback demo, token onboarding, recovery and invitation routes have no bundle preload hint. This limits the hint; release screens still load their existing composition root. DOM/browser regression coverage checks nine route cases.
- Replaced the signed-in-sounding heading with “Welcome to 3sln.me.” and removed static account navigation that discarded onboarding/invitation context. A `noscript` notice explicitly says JavaScript is required to sign in or create an account. The static console template has no i18n layer; this copy remains English. JavaScript-disabled browser coverage checks console sign-in, token onboarding and invitation shells.
- Externalized `packages/recovery/index.mjs` from the console bundle at its existing immutable import-map URL, retaining the provider's lazy dynamic import. A bundle assertion checks that external URL remains present.
- Added an always-on build assertion over both static and dynamic graph edges: only `main.mjs` may import the release composition root. Every staged public module is checked, including optional entries, preventing another independently shipped module from importing a second Engine composition.
- Validation: two successive `build:assets` runs matched all **448 files byte-for-byte**, build ID `723a1ee6cd1fc5318122`; `check:worker` passed its rebuild and Worker deployment dry-run. `test:ui-state`: **368 passed, zero failed/skipped**. Focused build-model DOM/browser checks: **4/4 passed**. `test:e2e`: **274 passed, 4 skipped, zero failed/cancelled** out of **278 tests across 13 subprocess summaries**, exit 0. All four skips are unavailable WebKit binaries; Chromium and Firefox ran.
- Test-development failures: the initial assertions raced the static shell, expected a relative DOM URL although `link.href` stores an absolute URL, and used a nonexistent recovery route. Corrected the assertions and covered the actual setup/restore routes; focused rerun passes. The existing offline-cache regression also expected the removed individual release asset; updated that serving assertion to require the console bundle, and its final full-run check passes. An initial broad run was stopped after its new assertions failed and its offline-worker test stalled; a subsequent full run retained the old cache assertion and failed it. The final complete run above passes. No production gates or external-service claims changed. Other agents' identity/federation/billing/messaging/organization edits were left untouched. No commits made.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — ORG-12 break-glass design

**Design only** ([organizations design §12d](docs/architecture/organizations-design.md#12d-org-12-break-glass-an-organization-whose-owner-is-gone-3slnme-provider-policy), rev 5.5; spec rev 4.4). No code changed. Nothing is implemented, routed or production-verified. Every item is **provisional** (coordinator, not signed off by the user).

**The problem:** an organization whose owner is gone (dead, unreachable, or without every credential and the organization recovery file) while the subscription keeps renewing. Elevations stay pending, and nobody can transfer, move, delete or reissue the file.

**The design (3sln.me provider policy):**
- **Who starts it.** A claim needs a quorum of two eligible 3sln.me-homed admins with 30 days' tenure. Foreign admins can only object in v1. The candidate is a 3sln.me admin under P18 tight verification.
- **Payment first.** The candidate pays a fresh checkout before the wait starts (the user's transfer billing rule). Any claim that doesn't take effect is refunded in full; a voluntary withdrawal loses the processing fee.
- **Track A** (self-running): a 30-day notified wait. Notices go to every owner channel and every admin. It is available only when the owner had no interactive sign-in for 30 days before the claim and has an out-of-band channel that is not on an admin-controlled domain. It takes effect by itself: a **third explicit exception** to "no timeout decides".
- **Track S** (support-adjudicated): single-admin or member-initiated claims, an admin objection, owner liveness, a claim within 180 days after an owner abort, and contests. It needs a 60-day wait, a two-operator decision and a 7-day final notice.
- **The owner's abort.** Any known device or email aborts with no proof, matching the person-move ladder. After a support decision, a dispute from any known channel still stops the effect and returns the claim to support. A channel support excluded needs a new operator pair to overcome, and support can never exclude the owner's last channel. The owner's tier-1 proof (an aged credential) always aborts, and support cannot override it.
- **The effect commit.** The owner changes, the organization's `aep` rises by one and the recovery binding rotates. The former owner stays a member with governance held. A 90-day contest window follows: no transfer, deletion or move, the former owner can't be removed, and acceptances that narrow governance wait. An upheld contest is a reinstatement, not a transfer, with a 14-day billing grace.
- **Recovery-file reissue:** a defined `missing` state; the reissue needs an aged credential, and is refused within 30 days of a security change unless the file is missing after a change of owner.
- **Out of scope:** `orgs.forget` wiring (the deletion purge hand-off) and flag targeting for organization accounts (the existing account subject is enough).

**Spec rev 4.4 (narrow):** a change of control without the recovery file is an authority reset at effect only (§3), the disclosure covers it (§6.3), plus one conformance check and checkpoint O6.

**Review:** an independent adversarial review (BG-R1) found 3 High, 7 Medium and several Low items. All are applied before publication:
- **H1:** support exclusion could take an organization from an email-only owner.
- **H2:** Track A could take effect with no absence evidence, or with notices going to admin-run mailboxes.
- **H3:** quota exhaustion and support expiry could block a legitimate recovery.
- **Mediums:** reinstatement billing, liveness in `final`, privacy probes, reconciliation with "adjudicates nothing", billing disclosure, and spec over-reach.

**For the user:** decisions BG-1 to BG-17 (design §12d.11, Q20), notably:
- BG-1, the third timeout exception;
- BG-16, support adjudicating held claims, which reverses "3sln.me adjudicates nothing" and makes the implemented `orgs.claim-resolve` "proceed" need two operators;
- BG-13, reinstatement billing.

**Implementation plan:**
- **Slices:** ORG-12a (claim engine), 12b (owner channels, abort tokens, liveness), 12c (billing), 12d (support adjudication), 12e (UI), 12r (reissue hardening), and 12f later (file-based recovery).
- **Flag:** `ORG_BREAK_GLASS_ENABLED`, default off.
- **Tests:** engine tests and seeded chaos with ten invariants, plus named adversarial cases.
- **Production gates:** a hash-chained organization audit, verified notification delivery, organization terms (ORG-13), and an independent security review.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Messaging, search and deletion wargame fixes

A red-team review of messaging, contact links, search, Beam and account deletion/export found five Medium, three Low–Medium and two Low findings. All are fixed. Each repro is ported to a permanent regression test that fails when its fix is reverted; that was checked revert by revert in a scratch copy of the tree. Everything is local loopback behaviour (SQLite metadata, in-memory buckets, Node server fixtures); nothing here is production-verified, and no production gate changes. Every decision below is **provisional** (coordinator, not signed off by the user).

- **M1 (Medium), refused contact deliveries spent the owner's budgets.** `ContactDeliveryService.precheck` runs every check `commit` makes, read-only, in one transaction: parent liveness, recipient, kind, MIME, size, collection, intake tags, the createdAt window, link and author-day quota, and account quota. `deliverLink` calls it inside the gate before the receipt-budget debit, work admission, storage reservation and blob write. `commit` re-runs the same checks authoritatively (one shared private method). This brings the runtime in line with messaging.md "Reference-service receipt limits". Test: `tests/contact-delivery-precheck.test.mjs`.
- **M2 (Low–Medium), link holders could see quarantine.** **Provisional decision:** quarantine is silent, as contact-tokens.md already says.
  - A quarantined link's profile GET/HEAD and oEmbed/HTML preview answer exactly like an active link's. POST delivery stays 202 and lands quarantined and unnotified.
  - Redemption succeeds, and redeemed peers keep seeing the disclosed profile.
  - A conversation invitation through a quarantined parent is admitted as a quarantined, unnotified message, instead of `conversation_contact_denied`.
  - A profile request for a link of another owner now answers `unauthorized`, which becomes the uniform unknown.
  - **Remaining exception:** beam transfer permission is still refused while quarantined, with the same `beam_contact_required` as a contact without beaming. A redeemed peer who could beam before can still infer the pause by trying. Hiding that would mean accepting live transfers silently; that question is left for the user.
  - Specs reconciled: links.md §6.4 no longer lists quarantine among non-verifying links, and contact-tokens.md states the silence rule and the beam exception. `tests/beaming-runtime.test.mjs` and `tests/beaming-security.test.mjs` are updated. Test: `tests/contact-quarantine-silence.test.mjs`.
- **M3 (Medium), revoked or expired links counted toward the 1,000 cap forever.**
  - `createGrant` counts only active, unexpired parents. `revoke` records `revokedAt`.
  - `collectLinkState` (account alarm) gains a bounded `collectDeadParents` sweep with a persisted wrapping cursor (`link-gc-cursor/parents`). It reclaims a parent once the parent has been dead for 72 h (operation age plus minimum receipt retention), every `contact-delivery-receipt` has passed `retainUntil`, and audience replay rows have expired.
  - Reclaiming deletes the parent, its `contact-name/`, `contact-url/`, `beam/grant/` and `beam/redeemed/` rows and its receipts, in 64-row batches. It writes `contact-grant-tombstone/<id>`, which every liveness check (`tokens.live`, `endpointLive`, `deliveryLive`, the endpoint `live`) refuses.
  - The grant behind the `developer-contact/v2` pointer is never reclaimed, so a revoked developer link stays revoked.
  - The new prefix is classified in the export inventory. contact-tokens.md is updated. Test: `tests/contact-grant-reclaim.test.mjs`.
- **Q1 (Medium), more than 32 tags poisoned the search queue.** Both sides are fixed:
  - The search tag bound is now `MAX_USER_TAGS` plus the registered `sys:` set (32 + 24), matching messaging.
  - `messageSearchDocument` builds a deterministic tag set: unique bounded IDs, every system tag, then the first 32 user tags in stored order.
  - `SearchService.drain` acknowledges and tombstones an event that fails deterministic validation (`deterministicSearchFault`) and calls `onRejected`. The account records `search/rejected` and emits a lifecycle-log `operator-alert` (`kind:'search'`). Transient errors still throw and keep the event queued.
  - Test: `tests/search-outbox-poison.test.mjs`, including the 31-tag connected-app path.
- **Q2 (Medium), a full search queue blocked deletion.** `enqueueSearchEvent` always admits tombstones. A tombstone replaces any pending upsert for the same item (same event key, no new queue row). Upserts stay bounded. Test: same file.
- **Q3 (Low), a failed TURN issue locked the participant out.** Any failure before the credentials are recorded revokes the issued credentials, calls `BEAM_RELAY_BUDGET.release(reservation)` when the injected budget provides it (an optional port method, since no implementation is in the repo), and moves `iceIssued[role]` from `'issuing'` back to unset. An unfunded reservation also resets. Test: `tests/beam-ice-retry.test.mjs`.
- **D1 (Medium), a delivery started before the deletion fence committed after it.**
  - New `assertLifecycleOpen(reader)` in `account-deletion.mjs` checks the fence, the purge job and the tombstone.
  - It runs inside `gated()`, so every ungated orchestration (deliverLink, developerContactLink) re-checks inside the gate. It also runs inside the delivery commit transaction, through the controller's `parents.live` port.
  - **Root-cause audit of the other `gate:'none'` writers:**
    - The conversation inbox is reached by the ungated `conversationDrain` self transport; it now checks before writing and inside its commit transaction.
    - The link-audience decision cache writes in a checked transaction (a fault becomes `unavailable`), and audience replay consumption checks first.
    - `exports.step` already fences itself.
    - Corrected after review: not every other ungated method is read-only. `brokeredFederationEvent` (federation-owned file, left to that workstream) and `memberKeysChanged` write account metadata, though no blobs. `memberKeysChanged` now skips its write once a fence, purge job or tombstone exists. A late metadata-only write could still leave stray rows in a tombstoned object.
  - **Defence in depth:** the purge blobs stage makes one final pass from the beginning. Its re-deletes are counted in `job.rechecked`, so tombstone evidence is unchanged.
  - Test: `tests/deletion-delivery-race.test.mjs` (race, commit-transaction re-check, gate refusal, final pass). The conversation-inbox fence is in `tests/conversation-event-metadata.test.mjs`.
- **D2 (Low–Medium), a forged export-grant bearer revealed deletion state.** The grant branch of `routes/exports.mjs` maps lifecycle faults (and `lifecycle_unavailable`) to the same `401 unauthorized` body as an invalid grant, matching object-http.mjs and public-unknown.mjs. Test: `tests/export-grant-lifecycle.test.mjs` (active, deleting and deleted targets).
- **D3 (Low), 64 held accounts could starve the deletion-due sweep.** `deletionDueIndex` gains `page`/`advance` with a persisted cursor (`deletion-due-cursor`, outside the `deletion-due/` prefix). The cursor wraps at the first row not yet due or at the end. `sweepDeletionDue` uses it and falls back to `due` for an injected index without it. Test: `tests/deletion-due-sweep.test.mjs`.
- **Cheap follow-ups:**
  - Conversation `receive` now validates signed event metadata like contact deliveries: at most 16 unique bounded tags, a UUID or null `replyTo`, and a safe-integer `createdAt` no more than 60 s ahead. createdAt also names the history row key, so a string could have addressed other keys. Test: `tests/conversation-event-metadata.test.mjs`.
  - The developer-contact renewal's `quotaFamily` write is now a read-modify-write transaction. It has no revert-failing test: the renewal already runs inside the account gate, so the race cannot be reproduced deterministically.
- **Accepted TOCTOU windows (M1).** `precheck` and `commit` are separate transactions, so a delivery can pass `precheck`, have its budgets debited and its blob staged, and then be refused by `commit` because a concurrent change landed in between (revocation, quarantine-rule or intake edits, quota use by a parallel delivery). This is accepted: the gate serializes owner-account writes, `commit` stays authoritative, the staged blob is released, and the cost is at most one admission per such race.
- **Not covered by a dedicated revert-failing test:** the link-audience decision-cache and replay-consumption fence checks (defensive, reached only through conditional links), and the quotaFamily transaction above.

Verification: `npm test` 3,191 tests, 3,189 pass; the 2 failures are in `tests/engine-legal-identity.test.mjs` (age/region policy, another agent's in-flight edits). `test:worker` 91/91, `test:ui-state` 368/368, the 61 messaging/contact/link/search/beam/conversation/export/deletion test files 450/450, `test:deletion` 6/6 and `test:admin-deletion` 28 + 4 + 16 pass. Files owned by the identity/federation, billing/retention/age-policy and console agents were not edited. No commits made.

**Review follow-ups (independent review, same day; all provisional):**
1. **Medium–High: M2 let a quarantined link bypass quarantine.**
   - An invitation through a quarantined parent saved an `invited` room. A source-pushed membership then activated it with no owner acceptance, and later events were stored unquarantined and notified.
   - `acceptance()` now records `acceptedAt`. `receive('membership')` refuses (`conversation_acceptance_required`) a room that is not `active` unless it is `invited` with `acceptedAt`. The first version still let `removed` through; the second round below closes that, and only then is the flaw closed for active links too.
   - Local-only fields (`collection`, `acceptedAt`, `quarantined`) are never taken from a source-signed payload.
   - Rooms saved through a quarantined parent carry `quarantined:true`. Their events are stored quarantined and unnotified, and they are hidden from the default list (`GET /api/conversations?quarantined=1` lists them).
   - The owner's explicit acceptance releases the room's quarantine.
   - Test: `tests/conversation-quarantine-acceptance.test.mjs` (ported from the review repro).
2. **Low–Medium: a leaked quarantined link could take the single redemption slot.** Redemption still answers 2xx while quarantined but persists nothing; a prior binding still answers 409 to another peer, as for an active link. Test: `tests/contact-quarantine-silence.test.mjs`.
3. **Low: the fence re-check covered only `gated()`.**
   - Inside invoke's gate, `assertDeletionFenceOpen` (tombstone and fence, the entry check's deletion part) runs for every policy not declared `purging`.
   - The conversation self-invite transport, reached from the ungated drain, now runs through `gated()`.
   - The audit text above is corrected.
   - Tests: `tests/deletion-delivery-race.test.mjs`.
4. **Low: M3 removed the hard row bound.**
   - `createGrant` refuses at 2,000 stored parents, dead ones included (`MAX_STORED_GRANTS`). That cap also bounds `tokens.list` and `contacts()`, whose side listings now pass explicit limits.
   - GC reclaims up to 64 parents a run (scanning 256) and re-arms in 10 minutes while a backlog remains.
   - The audience replay purge and `cleanupDailyDeveloperGrants` use wrapping cursors instead of one 1,001-row read.
   - Tests: `tests/contact-grant-reclaim.test.mjs`.
5. **Info:** the TOCTOU sentence above.
6. **Nit:** the stale quarantine comment in `packages/links/preview.mjs` is corrected.
**Review follow-ups, round 2 (re-review, same day; provisional):**
1. **Medium: the consent rule was bypassable through `removed`.** A source could push `removed` to an invited or declined room, deliver events with a snapshot it signed itself, then reactivate the room with a membership, all without the owner's acceptance.
   - `removed` now applies only to an `active` room. For any other state it is a silent no-op. It records `removedEpoch`.
   - A membership activates only an `active` room or an accepted `invited` one. The first activation records `joinedAt` and `joinedEpoch`. A removed or declined room needs a fresh accepted re-invite.
   - Events in a `removed` room are accepted only from a room that was joined, with an epoch at or after `joinedEpoch` and before `removedEpoch`.
   - All receiver-local room fields (`collection`, `acceptedAt`, `joinedAt`, `joinedEpoch`, `removedEpoch`, `quarantined`) are kept across source-signed payloads.
2. **Low–Medium: quarantined invitations could fill the 100-room quota for good.**
   - Invited and declined rooms past `expiresAt` are collected at the next invitation.
   - The 100-room quota counts active, removed and live unquarantined invitations. Quarantined invitations have their own cap of 10. Declined rooms count toward neither and are collected at expiry.
   - The scan is bounded at 512 rows.
3. **Low: a removed member could not accept a re-invite.** A fresh invitation (new `invitationId`) over a `removed` or `declined` record, or over an expired invitation, resets it to `invited`. That drops `acceptedAt` and `joinedAt`, takes `quarantined` from the current parent, and requires a new acceptance.
4. **Low: inference channels recorded.** contact-tokens.md and this entry now list the remaining ways to infer quarantine:
   - beam refusal;
   - an unrecorded quarantined redemption, which later shows no disclosed profile;
   - a second holder answered 2xx where a recorded binding answers 409;
   - hidden quarantined conversation rooms;
   - the 10-room quarantined cap's `conversation_room_quota` (429), which an active parent would not hit.
   - The optional pending binding (owned by the first redeemer, promoted on release) is not implemented: it would add owner-side state and a second way to infer quarantine, for little gain.
- Tests: `tests/conversation-quarantine-acceptance.test.mjs`, ported from the `removed-bypass` and `reinvite` repros, plus a unit test of the room quota.
**Review follow-ups, round 3 (provisional):**
1. **Low: re-invite quota and declines.** A re-invite over a declined room, or over an expired invitation, now goes through `roomQuota`; only a reset of a removed room skips it, since a removed room already counts. A declined room refuses re-invites until its invitation expires (the room view is answered unchanged), so the owner's no stands for the life of that invitation.
2. **Low: inference list and removal grace.** The quarantined cap's 429 is added to the inference list (here and in contact-tokens.md). A removal now records `removedAt`. Events in a removed room are accepted only within 10 minutes of it (`REMOVED_GRACE_MS`), and still only from before the removal epoch.
- Tests: two more in `tests/conversation-quarantine-acceptance.test.mjs` (a decline that stands, then quota on replacing it; the grace expiry). Each fails when its fix is reverted (three revert cases, scratch copy).
- Round 3 verification: the messaging/contact/link/search/beam/conversation/export/deletion files pass 464/464. `npm test` ran 3,319 tests and 3,318 passed. The 1 failure, `tests/resource-discovery.test.mjs` X7-R1, is unrelated to these changes and passes 9/9 on rerun.
- Round 2 verification: `npm test` 3,278 tests, 3,277 pass. The 1 failure, `tests/orgs-wargame.test.mjs` follow-up 6 (operator verification), passes 31/31 on rerun and belongs to concurrent organization/admin work. `test:worker` 91/91, `test:ui-state` 432/432, and the messaging/contact/link/search/beam/conversation/export/deletion files 462/462. All 36 revert checks fail as expected.
- Verification after the follow-ups: `npm test` 3,274 tests, 3,271 pass. The 3 failures are in `tests/billing.test.mjs` (2) and `tests/engine-legal-identity.test.mjs` (1), all in other agents' in-flight billing and age-policy work. `test:worker` 91/91, `test:ui-state` 431/431, `test:deletion` 6/6, and the 63 messaging/contact/link/search/beam/conversation/export/deletion files 458/458.
- Every follow-up test fails when its fix is reverted (checked in a scratch copy). `memberKeysChanged`'s skip has no dedicated test: it is best-effort and needs an organization fixture.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Billing, retention and region wargame fixes

A red-team review of person billing, over-quota retention and the region block found one High, four Medium, one Low–Medium and three further issues (region block failing open, regional price arbitrage, billing state limits). The code findings are fixed. Each repro is now a permanent regression test that fails when its fix is reverted; this was checked one revert at a time in a scratch copy of the tree. Everything is local behaviour (SQLite or in-memory metadata, offline Polar fixtures, Miniflare and Node server fixtures). Nothing here is production-verified or provider-conformance evidence, and no production gate changes. Every decision below is **provisional** (coordinator, not signed off by the user).

- **B1 (High), an unpaid upgrade froze a funded over-quota cutoff indefinitely.** Three fixes:
  - `PlanChanges.fence` finishes the lock and falls through to provider-derived state, with lapse evidence, in two cases: the locked subscription has ended or been revoked, or the upgrade invoice is still past due 30 days after the change (`UPGRADE_PAST_DUE_MS`, provisional). The evidence-less Free hold is gone.
  - A pending, unpaid upgrade is authoritative at the source plan. `fence` returns `authoritative`, and `fetchState` keeps `retentionAuthoritative` true unless the held state is inside the provisional window.
  - A billing pause of retention is bounded at 72 hours (`RETENTION_BOUNDS.billingPauseMs`, provisional). The bound uses the step-capped observation. The ledger keeps `lastAuthoritative` (plan, bytes, paid-through time, billing revision). After the bound the episode proceeds on that state, which becomes Free once its paid-through time passes. One `billing-pause-bound` operator alert is raised per pause.
  - Tests: `tests/retention-upgrade-wargame.test.mjs` (freeze, control, bound) and the past-due case in `tests/billing-upgrade-wargame.test.mjs`.
- **B2 (Medium), revocation during a pending upgrade recorded no retention transition.** It now yields lapse evidence against the source plan (same root fix as B1). Reconcile also no longer drops a reduction when the stored before-image is provisional. The paid-through source plan is the before-image, and the provisional bytes are used when they are larger, so a revocation inside the 15-minute window is recorded too. Tests: `tests/billing-upgrade-wargame.test.mjs` (after and inside the window).
- **B3 (Medium), a dead upgrade lock blocked plan changes forever.** The lock is finished when:
  - the subscription has ended (B1);
  - an accepted upgrade is reverted at the provider (`reverted`);
  - an unconfirmed mutation is still not applied after 15 minutes (`not-applied`);
  - a renewal-time downgrade's schedule disappears at the provider (`canceled` or `not-applied`);
  - the invoice stays past due beyond the bound (`payment-failed`);
  - a new verified paid subscription replaces the locked one (`superseded`, checked in `change()`).
  - An active, unpaid upgrade still holds the lock until payment, revert, revocation, the past-due bound or renewal. That is deliberate: releasing it would grant the unpaid target product.
  - Operator reconcile path: the system-only engine operation `billing.change-lock-reconcile` (`ReconcileBillingChangeLock`, actor `system` with a reason). It re-runs the fence and releases a superseded lock. It releases a lock without its journal row only with `force`. It is not mounted on any route.
  - Tests: `tests/billing-upgrade-wargame.test.mjs`.
- **B4 (Medium), a paying customer dropped to Free after a failed proration invoice.** `proof()` accepts a paid, unrefunded target-product order created after the change, with `billing_reason` either `subscription_update` or `subscription_cycle`. A void invoice is a failure only until a later paid invoice supersedes it, and refund evidence always wins. An active subscription whose `current_period_start` advanced past the source period also settles the change (`renewed`). Tests: same file (cycle after void, update after void, renewal without a visible invoice, refund still wins).
- **B5 (Medium, compliance), the EU block missed outermost regions and Åland.** `representativeBlocked` adds GP, MQ, GF, RE, YT, MF and AX. Their retained ages follow France (15) and Finland (13). age-requirements.md and the representative spike are updated. `tests/engine-legal-identity.test.mjs` is updated for the new list. Test: `tests/region-policy.test.mjs`.
- **B6 (Low–Medium), bytes admitted during an unpaid provisional upgrade escaped retention.** When a provisional window closes unpaid, reconcile records an `upgrade-unpaid` transition effective at the window's end. Retention accepts the new reason and floors the deadline at `max(effectiveAt, consumedAt) + 30 days` (D092 M1). A window confirmed by payment records nothing. Tests: same file.
- **Region block failed open. Provisional decision:**
  - On the Worker (3sln.me), an unknown country (`XX`), Tor (`T1`) or a missing country is blocked for signup and paid checkout (`REGION_POLICY=block-unknown`, the default). An invalid value also blocks.
  - Local development (`LOCAL_DEVELOPMENT=true`) defaults to `allow-unknown`.
  - On Node, the EU/UK representative block is the operator's own policy. `REGION_POLICY` defaults to `allow-unknown`, and an invalid value fails at startup.
  - Node learns a country only from an operator-configured `TRUSTED_COUNTRY_HEADER`. The adapter forwards it through an internal header and drops any client copy, and an injected function port (`REGION_LOCATION_SOURCE`) reads it. A Worker string binding can never supply a location.
  - `requestAgeLocation(request, env)` maps an unknown location to `XX`. `ageRequirement` blocks it with `blockedReason:'region-unknown'`, and the signup screen shows a distinct message ("your region couldn't be determined…", en/es). The API error stays `signup_region_blocked`; `packages/identity/service.mjs` is not edited.
  - Signup, paid checkout, `/api/config` and transfer-in use the new helper.
  - Tests: `tests/region-policy.test.mjs` (unit and Node adapter over real HTTP), `tests/worker/region-policy.test.mjs`, and a DOM case in `tests/browser/legal-engine.mjs`.
- **Billing state limits:**
  - **Receipt cap, assessed.** The SDK verifier already rejects deliveries outside five minutes, so receipts only dedupe redeliveries. At capacity, receipts older than a three-day redelivery horizon are pruned oldest-first, at most 64 per event (`EVENT_MIN_RETENTION_MS`, provisional). The service now returns 503 only for 4096 events within three days. The 4096 cap and the 35-day retention are kept. Each event still lists up to 4097 receipt rows; that cost is bounded, not optimized. `tests/engine-billing.test.mjs` is updated to the new policy.
  - **`outcome_unknown` recheck.** A paid-signup checkout stuck at `creating`/`unknown` may be recreated after one hour (assumed provider session lifetime, unverified), at most three times per setup. Status reports `recheckAt` until then and `payment_required` after it. Test: `tests/paid-signup-recheck.test.mjs`.
- **Open questions (provisional, open):**
  - **Counsel, territorial scope of the representative block:** Jersey (JE), Guernsey (GG), Isle of Man (IM), Gibraltar (GI), Saint-Barthélemy (BL), Saint-Pierre-et-Miquelon (PM), New Caledonia (NC), French Polynesia (PF), Wallis and Futuna (WF) and the French Southern Territories (TF). They are not blocked now. Reviewer: ___ Date: ___ Outcome: ___
  - **Operator pricing policy for per-currency Polar prices (regional arbitrage):** the currency is selectable and Polar charges the configured local amount, so a buyer can pick the cheapest configured currency. Decide whether per-currency prices must stay within a band of USD, or whether currency choice is restricted by country. No code change. Reviewer: ___ Date: ___ Outcome: ___
- **Not fixed or not covered:**
  - The transfer-in route's switch to `requestAgeLocation` has no dedicated revert-failing test.
  - A paid-signup checkout that is `ready` but expired is not rechecked; only ambiguous creations are.
  - A stored provisional state that is never reconciled after its window records its `upgrade-unpaid` transition only at the next reconcile (webhook, status view or plan change). Until then the retention pause bound applies.

**Review follow-up (same day, independent review of the fixes above; provisional).** It supersedes the B1 past-due lapse and the B3 `superseded` rule stated above.
- **H1 (High), a release without payment proof granted the unpaid target plan.** Three routes: one of two subscriptions was upgraded and then "superseded" by the other renewing; a single stale provider read finished the lock as `reverted`; and a provider applied an unconfirmed change after the 15-minute `not-applied` bound.
  - Every release that is not payment-proven and not `ended` (`reverted`, `not-applied`, `superseded`, `payment-failed`) writes a per-subscription guard, `billing/upgrade-guard/<subscription>`, in the same transaction.
  - `fetchState` consults the guard for each subscription. It refuses the target product and holds the paid-through source plan (authoritative) until `proof()` succeeds, an active renewal on the target product happens, or the subscription ends.
  - `supersede` now requires the locked subscription to be gone at the provider (404). If the provider shows it ended, it is finished as `ended` instead. Being outranked by another live subscription is not enough.
  - `reverted` needs two separate observations, both at least GRACE after acceptance (`acceptedAt`, `revertSeenAt`).
  - A second checkout from Free is refused while one session is open (`checkout_open`). The same plan and currency reopen the stored session URL.
  - Tests: `tests/billing-upgrade-wargame.test.mjs` (two subscriptions, stale read, two-observation revert with flip-back, late application, open checkout).
  - `tests/billing.test.mjs` now clears `billing/pending` between its repeated checkout-validation calls.
- **M2 (Medium), B6 bypass.** A revert inside or just after the provisional window was recorded as `catalog` with the provisional before-image, and retention waits on catalog notices. A provisional before-image never carries `catalog` now; it is recorded as `upgrade-unpaid` effective at `provisional.endedAt`. Test: same file.
- **M3 (Medium, compliance), unguarded organization and redirect checkouts.**
  - `routes/identity.mjs` `beforeActivity` runs `PaidCheckoutAllowed` (fresh paid-age attestation, `requestAgeLocation`) for organization creation checkout, `billing-checkout`, `claim`, and transfer `accept`, as it already did for person checkout.
  - `routes/orgs.mjs` strips `ageConfirmed` before the writer's exact-key check. That is a route-layer-only edit; `packages/orgs/*` is untouched.
  - The anonymous redirect-extension purchase (`routes/transfer-pages.mjs`) applies the region policy and requires `ageConfirmed` ≥ the paid minimum age.
  - The organization ownership panels and the redirect page gain a required "I am N or older" checkbox. `bl/organizations.mjs` and `bl/transfer-flow.mjs` send the attestation.
  - The break-glass checkout (`orgs.breakglass-checkout`) has no HTTP route yet. It must get the same gate when it is routed; recorded in age-requirements.md.
  - Tests: `tests/worker/region-policy.test.mjs` (Tor and unattested organization checkouts refused before the writer; non-payment transfer steps not gated), a new case in `tests/redirect-extension-runtime.test.mjs` (that fixture now supplies a US location and attestation), `tests/browser/transfer-engine.mjs`, and `tests/browser/org-ownership-browser.mjs` (ticks the new box).
  - `tests/orgs-ownership-runtime.test.mjs` sends `ageConfirmed` on creation and acceptance, which exercises the strip.
- **L4 (Low).** Past due beyond 30 days releases only the lock. The guard holds the source plan until `row.source.validUntil`. A held source plan lapses with evidence at its paid-through time, or earlier when the provider revokes. Tests: same file.
- **L5 (Low).** On Node with `TRUSTED_COUNTRY_HEADER`, a present but invalid value maps to `XX`. That is behaviourally the same as an absent value (both are unknown under either policy), so no test can fail on revert. age-requirements.md now says the proxy must overwrite the header, not append.
- **L6 (Low).** `allow-unknown` is the default only for `LOCAL_DEVELOPMENT=true` on a loopback `http` `APP_ORIGIN` (`loopbackOrigin`). There was no existing guard against `LOCAL_DEVELOPMENT=true` on a deployed origin. A runtime assertion would break Worker fixtures that pair the flag with `.example` origins, so this is a security.md verification gate instead. `tests/engine-legal-identity.test.mjs` "HTTP config…" now sets `REGION_POLICY:'allow-unknown'`, since that test is about untrusted country fields. Test: `tests/region-policy.test.mjs`.
- **I7 (Info).**
  - In the pause-bound path, `releaseAnchor` judges `lastAuthoritative.billingRevision`. No test can fail on revert: the overridden usage quota already equals the anchor's reduced quota, so the verified-upgrade release cannot trigger.
  - `ReconcileBillingChangeLock` is registered in `ACCOUNT_OPERATIONS` (exported as `BILLING_OPERATIONS`). The account engine gets the `billing` provider. Hosts run it through the new account RPC `billingReconcileChangeLock(owner, {reason, force})` with a system actor; owner dispatch is refused. Test: same file.
  - **`renewed` assumption, unverified.** The `@polar-sh/sdk` 1.0.2 types describe `current_period_start` only as "the start timestamp of the current billing period". Polar's `subscription.past_due` docs say a failed payment moves the subscription to `past_due`. Nothing found says the period advances only after payment, so renewal settles only while the status is `active`. Sandbox verification is open.
- **Correction:** `tests/browser/legal-engine.mjs` now passes 11/11 and is part of `test:ui-state`; the HEAD failure noted earlier no longer applies.
- **Revert checks** (scratch tree copy, one at a time): every fix above fails at least one test when reverted, except L5 and the anchor revision (both explained above). The transfer-in route switch also still has no dedicated test.

Verification (final): `npm test` 3,274/3,274; `test:worker` 91/91; `test:ui-state` 431/431. Billing, retention, region and redirect node suites (`tests/billing*`, `*retention*`, `engine-billing`, `paid-signup*`, `region-policy`, `engine-legal-identity`, `lifecycle-paid-protection`, `redirect-extension-runtime`, `orgs-ownership-runtime`): 232/232. `legal-engine` and browser `retention`: 17/17. `org-ownership-browser` 16/16, `transfer-browser` 24/24, `transfer-engine` 10/10. `packages/identity/service.mjs`, `packages/orgs/*`, messaging and console files were not edited. No commits made.

**Re-review follow-up (same day; provisional).** The re-review confirmed the fixes above and found two issues and one gap:
- **M1 (Medium), a lapsed held state could override a live paid subscription, depending on order.** `fetchState` now treats a held source plan as an ordinary candidate under the same storage and paid-through ranking. Once it has lapsed, it only supplies lapse evidence, used when no paid candidate remains. Test: `tests/billing-upgrade-wargame.test.mjs` (both subscription orders).
- **M2 (Low–Medium), a check-then-act race on `checkout_open`.** `billing/pending` is reserved inside a metadata transaction before the provider call. The reservation is an in-flight marker, `status:'creating'`, valid for `CHECKOUT_INFLIGHT_MS` (two minutes, provisional). It is replaced by the session URL only if the reservation is still ours. Test: three concurrent checkouts create exactly one session.
- **Gap, upgrades made outside the app (provider portal).**
  - `PlanChanges.external` starts the upgrade guard for any upward product change on the verified subscription that has no lock or guard. It holds the previous plan, authoritatively, until a paid target invoice created after the last verified reconcile is proved, or the period renews on the target. Downward changes are not guarded.
  - billing.md now tells the operator to disable plan changes in the Polar customer portal settings; the guard is the fallback.
  - Two existing tests that modelled outside upgrades now supply the paid invoice: `tests/billing-changes.test.mjs` "stale quote…" and the `tests/retention-webhook-chaos.test.mjs` fixture (orders API for upward toggles).
  - Test: same file.
- **Revert checks** (scratch tree copy): each of the three fails its test when reverted.
- One `npm test` run failed `tests/orgs-break-glass-chaos.test.mjs` on a state-coverage assertion. That is another agent's untracked in-flight file and imports none of this code. It passed alone and on the full rerun.

Verification (final, re-review): `npm test` 3,319/3,319; `test:worker` 91/91; `test:ui-state` 432/432. Billing, retention, region and redirect node suites (same set as above): 235/235. No commits made.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — UI quality pass 2 (browser probe round 2)

Status: implemented locally; review/sign-off provisional. Production release remains disabled. No commits or publication performed.

- **H1–H3 / palette audit:** sidebar storage, billing availability and the Beam file picker now use shared surface/ink/line tokens. Audited all background/text color declarations in `apps/web/styles.css`, converting remaining light feature surfaces, gradients and text accents to theme tokens. Explicit dark palettes, decorative overlays/shadows and root token definitions remain intentional. Browser regressions compute WCAG contrast against alpha-composited ancestor backgrounds for these components, breadcrumbs and shell footer in both themes; minimum 4.5:1.
- **M5:** linked-device entry now waits at “This device”, with the touch/narrow hint preselected. Selection can change before Continue; only Continue starts the challenge and linked-start request. Selection freezes once that entry begins. Architecture copy is reconciled in `docs/architecture/linked-approval.md`; engine and real-browser tests cover the boundary. Legacy device QR entry remains automatic.
- **M6–M9:** paid checkout uses the configured inclusive age wording; corrected the stale legal assertion and included it in UI-state. Malformed `/i` query/POST transports render the existing human error surface with the original error status; explicitly preferred JSON clients retain structured errors, including weighted Accept negotiation. Failed export/retention loads no longer assume `jobs` exists; concurrent 429 combinations render an actionable alert. Transfer errors/reasons use the shared catalogue without exposing unknown provider codes, and transfer entry honors explicit `lang`, then saved preferences, then browser language.
- **L8–L11:** retention deadlines show a localized UTC time with machine-readable datetime, decimal human byte sizes use Intl, and keep-unit labels are at least 14px. Shell views have validated `?view=` addresses with initial-load and Back/Forward restoration, coordinated with the existing organization URL owner/recovery guard. Mobile search, Activity actions, auth links, footer links, preferences search and Beam file inputs have 44px minimum targets. Organizations use the existing person icon, distinct from Apps; mobile breadcrumbs wrap fully. Generic 429 errors ask the person to wait and retry while preserving supplied human server explanations.
- **L12:** the external landing module safely applies a saved locale by requesting the existing localized static document, with no inline script. Signup history now keeps `?signup` and a bounded, whitelisted tab-local draft of nonsecret wizard choices; reload resumes pre-account setup. Passwords, CAPTCHA proofs, invitation authority and email addresses are not persisted in that draft. Where an email contact is required, reload returns to the email question before later credential steps so the private in-memory address is entered again. Starting another auth mode removes the signup routing hint.
- **Regression coverage:** `tests/e2e/ui-quality-round2.test.mjs` is included in the default e2e runner. Its Chromium/Firefox matrix covers 390×844 and 1280×900, light/dark, en/es, effective-background contrast, mobile target dimensions, shell Reload/Back, and simultaneous export/retention 429s. Each engine additionally checks linked-device selection before network start, signup reload at terms/credential steps, saved landing locale and explicit/saved transfer locale. Screenshots are under `artifacts/browser/round2-*` (local mock API fixtures against an ephemeral real Worker, not evidence of external provider delivery or production readiness).

Route reconciliation: specialized `#access/...` deep links take priority over general shell restoration; navigating away clears that specialized hash. The existing Wave 5 browser tests caught and now cover this interaction. Transient capability handoffs retain their existing private continuation handling. Organization-owned UI/business files were not edited. Earlier organization, billing and region-policy test failures during concurrent development were resolved by their owners; the final runs below pass.

Final verification: `npm test` **3,274/3,274**; `test:ui-state` **432/432**; full `test:e2e` **292 passed, 0 failed, 4 skipped (296 total across all runner stages)**. The four skips are unavailable WebKit cases; Chromium and Firefox ran successfully. The focused round-2 + Wave 5 + contact-handoff browser run passed **23/23**, including the **18/18** round-2 cases; standalone intent negotiation tests passed **3/3** and are also included in `npm test`. `build:assets` and `check:worker` passed (254 addressed app modules, 36 curated documents, Worker dry-run only). Final asset build: `df2dcba47d97418f2de5`. Screenshots were inspected in both requested engines; the requested matrix is 390×844 and 1280×900, light/dark, en/es. No production capability or external delivery is inferred from these local checks.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Identity and federation wargame fixes

Status: implemented locally; every decision below is provisional and unsigned. Production release remains disabled. No commits or publication. Source: the red-team review of identity core and federation (13 failing repros, now all passing). Engine-level regressions: `tests/identity-wargame2.test.mjs`, `tests/federation-wargame2.test.mjs`, `tests/boot-admin.test.mjs`; each new test was checked to fail with its fix reverted, in a scratch copy of the tree.

Provisional decisions:

- **#1 (High), stolen password → reissue → recover takeover.** User direction 2026-10-23, recorded in [recovery identity](docs/spec/recovery-identity.md#active-account-reissue-provisional) "Cooling-off window":
  - (a) An account with a passkey reissues only after a passkey step-up.
  - (b) A reissued file cannot start `recover()` for 7 days (`recovery_not_ready`).
  - (c) During the window the reissue can be cancelled from any session created before the reissue began, from the link mailed to an email verified before it began, or with the previous file. Notices go to email and push at begin, confirm and cancel.
  - (d) The previous file is cancel-only during the window (`recovery_reissue_pending`). It regains full authority only through cancellation.
  - Cancellation rotates the signing key away from the voided file in the account single writer (P15), restores the previous credential and any forced marker, and raises `federationGeneration`, so no OAuth grant from before or during the window survives. Only one window at a time.
  - The safer variants were weighed but not adopted; they are left to review in the spec. The leaked-file residual under (d) is recorded there.
  - Routes: `/api/auth/recovery/reissue/cancel`, `/cancel-email`, `/cancel-file`. The server-rendered page `/account/recovery/cancel` keeps the capability in the fragment and needs no build entry. The console shows the window with a cancel button on earlier devices, and the recovery page offers a file cancel.
  - Reviewer: ___ Date: ___ Outcome: ___
- **Coordinator decisions on #1 (2026-10-23, provisional):**
  - **Leaked old file.** When the reissue was authorized by a passkey step-up, the previous file can neither cancel it nor recover (`recovery_reissue_locked`, `reissue_cancel_not_allowed`). Only earlier sessions and devices and the pre-reissue email can cancel. When it was authorized by a password (no passkey), the previous file can still cancel. The spec records variant (1) as chosen.
  - **Swapped email.** Replaced and removed verified emails are kept for 7 days (`previousEmails`, at most 5, the earliest kept). They receive the reissue notices, and the cancel link when they were verified before the reissue began.
  - Tests: three new cases in `tests/identity-wargame2.test.mjs`, the passkey branch, the password branch and the swapped email. Each was revert-checked.
  - Reviewer: ___ Date: ___ Outcome: ___
- **Independent review follow-ups (2026-10-23, coordinator decisions, provisional):**
  - **R1 (High).** A password thief could enrol their own passkey, swap the email, wait 8 days, revoke sessions and make a passkey reissue that no owner channel could cancel. Three changes close it:
    - (i) A reissue is file-proof only when the step-up passkey was enrolled before the previous file was issued and before every email change, email removal and other-session revocation of the last 30 days (`authorityEvents`, `recoveryPrevious.fileLocked`). Otherwise the previous file can cancel.
    - (ii) Adding a passkey, changing or removing the email, signing out other devices and setting a password during a recovery now notify email (including recently replaced addresses) and push, with guidance.
    - (iii) Replaced emails stay channels for 30 days.
  - **R2 (Medium).** After a file-proof reissue the cancel link goes only to the current pre-reissue email; replaced addresses get the notice only.
  - **Item 3 (Medium).** MCP grants store the app-grant epoch (`packages/runtime/grant-epoch.mjs`, now also the body of `federationEpoch`) and are refused on verify, execute, exchange and refresh when it changes; legacy grants fail closed. Recovery start and reissue cancellation sever connections and revoke all key delegations (identity port `severConnections`, reason `recovery`), as integrations §7 already required. Key delegations are deliberately not epoch-bound. A cancel also ends sessions created at or after the reissue began, and the sessions that staged and confirmed it.
  - **Item 4.** See the corrected #4 bullet.
  - **Item 5.** Email sign-in windows are now 5 per 15 minutes and 12 per 6 hours per mailbox (no day-long block), 5,000 per hour per region, and 20,000 per hour overall.
  - **Item 6.** The boot passkey begin principal window is raised to 600 per 5 minutes; the per-address windows (10 per minute, 50 per hour) do the work. A nonce-cookie exemption was not chosen because the nonce is caller-minted.
  - **Item 7.** A cancel's rotation before the identity write is safe even if the write never lands: the outgoing kid is merged into the recovery binding, so the new file keeps restoring. There is a test; it is not made atomic, because that needs a cross-store transaction.
  - **Item 8.** A configured identity token key shorter than 16 characters now throws. The `recovery-reissued` push text no longer promises that every device can cancel.
  - Regression tests: `tests/identity-wargame2.test.mjs` (24), `tests/mcp-authority-epoch.test.mjs`, `tests/federation-wargame2.test.mjs` and `tests/boot-admin.test.mjs`. Each fix was revert-checked in a scratch tree.
  - Reviewer: ___ Date: ___ Outcome: ___
- **Re-verification follow-ups (2026-10-23, coordinator decisions, provisional):**
  - **V1 (High).** The thief's passkey predated the owner's current file. They evicted the owner's sessions via the 10-session cap, swapped the email and made a file-proof reissue. Fixes:
    - A reissue is file-proof only when the passkey predates the previous file **and** no channel-removing event (email change or removal, other-session revocation, session-cap eviction, passkey removal) happened in the 30 days before the begin, in any order.
    - Session-cap eviction is now an authority event with a notice.
    - Replaced emails and the lookback are both 30 days, stored one hour longer and evaluated at the begin, so both expire together; this boundary is tested.
    - Recorded trade-off: an owner who changes the email and then reissues within 30 days gets the password branch, which revives R2's scenario for that owner.
  - **Cancel sessions.** A cancel ends the staging and confirming sessions (`stagedSessionId`, `confirmedSessionId`).
  - **Notices and limits.** `removePasskey` and session-cap eviction record authority events and notify. Notices are coalesced per type to one per 10 minutes, with a count. `credentialBegin` is rate limited.
  - **Severing.** Connections are severed first, then delegations. A durable `pendingSever` row in the recovery-start or cancel CAS retries a failed port at activation, at the owner view and on a later cancel.
  - **Anonymous authorization.** A bound of 64 per IPv6 /48 allocation was added, and IPv4-mapped IPv6 addresses now map to their IPv4 /24.
  - **Token key.** Without a configured identity token key outside local development and tests, passkey begin throws instead of using a per-instance key.
  - **Org reissue producer.** `organizationVerification` now sends `hasPasskey` and `method` for the organization recovery-file reissue check in `packages/orgs/ownership.mjs`.
  - Tests: `tests/identity-wargame2.test.mjs`, `tests/federation-wargame2.test.mjs` and `tests/mcp-authority-epoch.test.mjs`, all revert-checked.
  - Reviewer: ___ Date: ___ Outcome: ___
- **Final-check follow-ups (2026-10-23, coordinator decisions, provisional):**
  - **V2 (High).** Filler events could fill the 16-entry event list, which kept its earliest entries, so a later channel removal was dropped and a reissue became file-proof again. Fixes:
    - The file-proof check now reads an uncapped monotonic `lastChannelRemovalAt`. The display list keeps the newest 16.
    - I audited every other capped list used for security decisions in `service.mjs`. `previousEmails` now refuses a ninth email change within retention (`email_change_limited`) instead of dropping an entry. Live passkey sign-in nonces are never evicted; at 32, sign-in waits. Challenge and email-link lists keep the newest and are not authority decisions.
  - **N1 (Medium).** Coalescing applies only to repeats by the same session or credential; a different actor is always notified at once. Pending counts go out as a trailing notice at the account's next write or owner view after the window. The identity service has no alarm, so if nothing touches the account the trailing count waits (recorded limit).
  - **`flushSever`** clears only the row it ran, matched on `at`.
  - Tests: `tests/identity-wargame2.test.mjs`, all revert-checked. The coordinator's V2 and N1 repros now fail (no bypass).
  - Reviewer: ___ Date: ___ Outcome: ___
- **`federationEpoch` drift (reconciled).** The epoch hashes the recovery credential, so any recovery start, reissue confirmation or cancellation revokes every app grant. The spec now says so; this is the safe direction. A monotonic `federationGeneration` joins the digest (records without it keep their epoch) and rises on reissue cancellation and on suspension.
  - Reopened accounts did revive ordinary OAuth families. They no longer do: `AdminService.suspend` and the closure path now raise the generation.
  - Reviewer: ___ Date: ___ Outcome: ___
- **#2 admin console: passkey step-up only.** `AdminService.actor()` requires `stepUpCredential.kind==='passkey'` with the passkey still enrolled. The grep check is replaced by behavioural tests. See [boot and admin](docs/architecture/boot-and-admin.md). Reviewer: ___ Date: ___ Outcome: ___
- **#3 sign-in abuse ordering.** Only per-network windows run before Turnstile. The per-handle window (20 per 5 minutes) is peeked after it and charged only by a completed, failed password check; passkey begin and finish never touch it. The window store gained `peek`. Reviewer: ___ Date: ___ Outcome: ___
- **#4 anonymous authorization requests.** They have their own bounds and join the owner's 32 only at the owner step. Limits: 8 per caller network and client, 16 per caller network across all clients, and 512 per shard, with `temporarily_unavailable` when the shard is full. The caller network is the route's pseudonym of the IPv6 /64 or IPv4 /24 (IPv4-mapped IPv6 counts as its IPv4 /24), and a further 64 per IPv6 /48 allocation bounds requests across its networks (review 2026-10-23), so rotating addresses inside one allocation or cycling client IDs buys nothing. Residual: a flood from more than 32 distinct /64s or /24s can still fill one shard's 512 anonymous slots; owner-bound requests are never affected. Reviewer: ___ Date: ___ Outcome: ___
- **#5 incremental DPoP.** The route only verifies the proof. It is recorded during the exchange, after the code is found and bound to that key, in per-key partitions of 16 (`temporarily_unavailable` when full). Reviewer: ___ Date: ___ Outcome: ___
- **#6, #10 boot login.**
  - Boot passkey challenges are per-caller rows bound to an HttpOnly nonce cookie, single use. Begin limits are 10 per minute and 50 per hour per IP, and 600 per 5 minutes per principal (raised from 60 in the review follow-ups).
  - Boot password attempts are capped at 20 per 5 minutes per principal and 200 per hour globally, before the KDF.
  - Turnstile was deliberately not added to the last-resort path.
  - Reviewer: ___ Date: ___ Outcome: ___
- **#7, #8 email sign-in start.** After Turnstile, a pseudonymized mailbox window (5 per 15 minutes, 12 per 6 hours) plus capacity ceilings of 5,000 per hour per region and 20,000 per hour overall are charged whether or not the address has an account. These are the review follow-up values; the first version had 20 per day per mailbox and 2,000 per hour overall. Both branches do the same token work. On a hit, the challenge write and the provider call run in the background (the platform's `waitUntil`, now passed in the identity context), so neither latency nor provider errors reveal existence. Reviewer: ___ Date: ___ Outcome: ___
- **#9 and challenge eviction.**
  - Passkey sign-in begin is stateless. The token is `pl1.<payload>.<mac>`, an HMAC over {handle, challenge, nonce, expiry}, keyed from `loginTokenKey`, else `linkedCodeKey`, else a per-instance key. Begin therefore reads and writes no account: no account id, no existence or status signal, no eviction and no revision bump.
  - Finish records the nonce as used in its own write.
  - Email sign-in links stay stored (last 4), but they can now be added only within the mailbox window.
  - Reviewer: ___ Date: ___ Outcome: ___
- **#11 and P15 churn.** A setup token buys at most 5 password sets and 5 recovery downloads, each behind the network and per-account windows, checked before any KDF or rotation. The redundant re-verify after hashing is gone. Reviewer: ___ Date: ___ Outcome: ___
- **Authorization code replay** revokes what the first redemption issued (a 10-minute redeemed-code marker, RFC 9700). **Brokered introspection** assertion IDs are stored in the owner's federation shard when a port exists. Reviewer: ___ Date: ___ Outcome: ___
- **P17** compares the credential that confirmed the step-up (a passkey id or `password`), for both the elevated abort and the reissue gate, not the sign-in credential. Reviewer: ___ Date: ___ Outcome: ___

Not fixed or open:

- After a password-authorized reissue (no passkey), a leaked previous file can still cancel it and recover. After a passkey-authorized one, an owner who lost the passkey device and has no earlier session or pre-reissue email cannot cancel. Both are by decision.
- A voided reissue file still disclosed the never-rotated encryption key.
- The organization recovery-file reissue (`packages/orgs/ownership.mjs`) still accepts a password step-up even when the owner has a passkey. That is the same class as #1; the coordinator is routing it to the organization agent.
- The anonymous per-shard bound of 512 can be filled from more than 32 distinct networks.
- Adapters without a federation port fall back to the per-isolate introspection cache.
- A boot password flood can delay a password-only boot operator for up to 5 minutes.
- An owner whose only passkey was enrolled after the current file was issued gets the password branch for a passkey reissue (the previous file can cancel it).
- Key delegations are not epoch-bound; they end by explicit revocation on recovery and cancellation.
- `tests/browser/recovery-reissue-browser.mjs` had a stale step that clicked a replace button the eligibility display disables; it now asserts the disabled button and the server refusal.

Verification:

- After the final-check follow-ups (final): identity, recovery, transfer-out, device-login, federation, MCP, boot, admin, org-grant and email-template suites 534/534; `npm test` 3,343/3,343; `test:worker` 91/91; `test:ui-state` 432/432.
- After the re-verification follow-ups: identity, recovery, transfer-out, device-login, federation, incremental, brokered, MCP, boot, admin and org-grant suites 573/573; `npm test` 3,329/3,329; `test:worker` 91/91; `test:ui-state` 432/432. The V1 repro now fails (no takeover).
- After the independent-review follow-ups: identity, recovery, transfer-out, device-login, federation, incremental, brokered, MCP, boot and admin suites 559/559; `npm test` 3,319/3,319; `test:worker` 91/91; `test:ui-state` 432/432.
- After the coordinator decisions: identity, recovery, transfer-out, device-login, boot-admin and federation-wargame2 suites 314/314. `npm test` 3,271/3,274; the 3 failures are billing checkout (`tests/billing.test.mjs:131`, `:135`) and region (`tests/engine-legal-identity.test.mjs:20`), all in files other agents are editing. `test:worker` 90/91; the alarm timing test `tests/worker/linked-approval.test.mjs:6` passes alone (5/5). `test:ui-state` 431/431.
- `npm test`: 3,248/3,248 on a quiet tree. The final run while other agents were editing gave 3,253/3,262. The 9 failures are billing checkout and upgrade (4), region policy (2) and organization runtime and console routes (3); they are outside this pass. The organization files pass in isolation.
- `test:worker`: 91/91. The final run gave 90/91; the contact-link test that failed passes alone (10/10).
- `test:ui-state`: 431/431.
- `test:recovery-reissue` (Chromium and Firefox, real Node runtime, after `build:assets`): 6/6.
- Worker e2e (`recovery-security`, `recovery-crypto`, `ui-chaos`, `signup-views`, `worker-flow`): 31/31.
- `test:approve`: 14/14. `test:dom` passes.
- Targeted suites (`identity-wargame2`, `federation-wargame2`, `boot-admin`, `recovery-reissue`, its chaos test and `transfer-out`): 110/110.
- Original repros: 11/13. The two that still fail do so by design. C-3 expected the password-only begin to succeed, and it is now refused. B1 sends 32 anonymous begins from one caller, and the ninth is now refused. Adapted versions of both pass.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — ORG-12a/12c break-glass engine and billing

**Implemented locally, engine level** ([organizations design §12d](docs/architecture/organizations-design.md#12d-org-12-break-glass-an-organization-whose-owner-is-gone-3slnme-provider-policy), slices ORG-12a, ORG-12c and most of ORG-12r). Behind the new `ORG_BREAK_GLASS_ENABLED` flag (class a, `G A`, requires `ORGANIZATIONS_ENABLED`, default off, not retained). Nothing is routed to HTTP or the UI. The identity owner-channels adapter (ORG-12b) does not exist yet, so outside tests no claim can start (`break_glass_unavailable`, 503). Tests run against loopback fixtures and the offline Polar model: they show local behaviour, not notification delivery or provider conformance. Every item is **provisional** (coordinator, not signed off by the user), and the design itself is still unsigned (BG-1 to BG-17).

**What exists:**
- **Claim engine** (`packages/orgs/break-glass.mjs`, `BreakGlassService extends OwnershipService`):
  - A pure transition table and function (`BREAK_GLASS_TRANSITIONS`, `breakGlassTransition`) covering T1–T27. Each transition is one commit with exactly one `organization-break-glass-<event>` audit entry. Audit entries carry the statement's digest, never its text, channel addresses or Track S causes.
  - Claim rows `org/claim/<id>`, with a summary `breakGlass` on the record. Eligibility: 30-day admin tenure, homed at 3sln.me, unheld, not expiring, past the 72 h wait; member-initiated claims only when no admin is effective (90-day tenure, always Track S).
  - Quorum, both tracks and their triggers (single admin, member-initiated, no out-of-band channel, an email on the organization's, candidate's or a signer's domain, a recent interactive owner sign-in, a deleted owner, within 180 days of an owner abort, objection, liveness).
  - Every timer in §12d.5, run from `orgs.ownership-tick`; the effect retries hourly on a transient failure.
  - Locks and limits: one pending claim; 3 counted claims per organization a year; counting only once paid or owner-aborted; expired held claims uncounted and unlocked.
  - The per-person ledger: one pending candidacy anywhere, 2 counted claims, 4 unpaid starts. It lives in each person's own account (`orgs.breakglass-ledger`, rows `orgs/break-glass/<org>/<claim>`), reached through a port (`claimLedger`).
- **Owner proof tiers.** Tier 1 is a step-up with a credential enrolled at least 7 days before T1 and no authority reset since. Tier 0 is a known session or credential (from the session's `verification` evidence), or a single-use abort token.
- **Abort tokens:** 256-bit random, stored as SHA-256 hashes on the claim, one per email or push notice, with fresh ones at every final notice. They leave only through the owner-channels port. *Correction (review L1): the first version of this entry said the raw token was erased from the outbox row once delivered; it was not (it stayed in `channels[].abort`). It is now erased when the row is delivered, and from undelivered rows when the claim ends.* Used, unknown, forged and malformed tokens get the identical `{received:true}`.
- **The shared guarded owner-change commit** (`OwnershipService#changeOwner` with `ownerChangeGuard`). Transfer, lapse claim, break-glass effect and reinstatement all go through it. It re-checks in the commit that the organization is active, that the owner of record is still the one the process recorded when it began (`expect`; the lapse claim now records it), and that the payment is a verified, paid, unheld subscription of the new owner from a snapshot no older than 5 minutes. `authorityReset` raises the organization's new `authorityEpoch` (spec §3, rev 4.4); `moveCoolingMs` gives break-glass 90 days.
- **Effect.** The owner changes, `aep` +1, `rotation-pending` then `missing`, the previous owner's subscriptions are revoked with no automatic refund, and the former owner stays a member with governance held (cause `break-glass`). A 90-day contest window follows: no transfer offer or deletion by the new owner, and the former owner's membership cannot be removed or expire.
- **Contest and reinstatement:** a tier-1 contest; two operators uphold or reject. Upholding restores the former owner through the same commit (`aep` +1 again), revokes the break-glass owner's subscription, holds their governance and starts the ordinary 14-day grace.
- **Operators** (`orgs.breakglass-resolve`, system):
  - One operator can acknowledge, add a note or abort.
  - Proceeding, upholding and rejecting each need a proposal and an approval by a **different** operator within 72 h.
  - No operator may be the owner, candidate, initiator, a co-signer or any member.
  - Exclusions may name only channels that disputed this or an earlier claim, never the last channel.
  - After an excluded channel's dispute, the pair that excluded it is barred.
- **Other system operations:** `orgs.breakglass-liveness` (refresh ignored), `-security-change`, `-abort-token`, `-file-recovery` (the ORG-12f seam: freeze, resume, supersede) and `-case`. Runtime RPC: `orgsBreakGlassSignal` and `orgsBreakGlassLedgerApply` (internal only).
- **Ports and seams** (ORG-12b fills them; `packages/identity/*` was not edited):
  - `ownerChannels`: `{snapshot(owner,{org,at})`, `domains({org,principals})`, `notify(owner,{org,claim,event,channel,kind,abort?})}`. Email domains are hashed on arrival, and addresses never cross the port. `ownerChannelsPort()` is the in-memory implementation.
  - The runtime takes `ORGANIZATION_OWNER_CHANNELS`. The identity sign-in hook should call `orgsBreakGlassSignal(org,{operation:'liveness'})` for organizations the person owns.
- **ORG-12c billing** (`packages/billing/organizations.mjs`):
  - Checkout purpose `break-glass`, bound to the claim and created by the candidate after echoing a disclosure digest (fresh period, paid period runs from checkout, refund rule).
  - Reconciliation settles it (T5); a break-glass payment bound to anything else is refunded in full as unbound. The claim's subscription confers nothing until the effect.
  - Refunds go through the existing outbox and drain lease. They are full, except that a voluntary withdrawal keeps the processing fee: `ORGANIZATION_PROCESSING_FEE`, 5% + 0.50, provisional, on the first order only. A retried drain never refunds the fee.
- **ORG-12r:**
  - `recovery.state` is `issued | rotation-pending | missing` (`reissue-required` renamed).
  - A reissue needs a fresh step-up with a credential enrolled at least 7 days earlier. Within 30 days of a security change, replacing an existing file is refused; reissuing from `missing` is immediate.
  - Admins are notified of a reissue start and finish. A reissue aborts a pending claim (T14).
- **BG-16:** `orgs.claim-resolve` now needs an `operator`; "proceed" needs a second, different operator within 72 h, and conflicted operators are refused.

**Implementation readings and deviations (provisional, for review):**
1. **Tier 0 after an owner abort is a dispute, not an abort.** In a claim started within 180 days of an owner abort (and in any claim that has had a support decision), a tier-0 stop holds the claim for support (Track S) instead of aborting it. Only tier 1 aborts. Read literally, T10 would let one stolen device abort every claim at T1 forever, and §12d.2 ("goes straight to support, which may proceed and exclude the channels") could never apply. The owner's protection is unchanged: no effect without a fresh two-operator decision, never against tier 1, never with every channel excluded.
2. **"A different pair" means a pair sharing no operator with a barred pair** (review L6, the stricter reading; it replaces the first reading, "not the same unordered pair"). A barred operator cannot even propose.
3. **Narrowing acceptances are refused, not queued.** During the contest window, an owner's acceptance that narrows or removes a GM grant is refused (`contest_window`) instead of being recorded and applied when the window closes. The request stays elevated, and the owner can accept it after the window.
4. **Objections.** An objection in `gathering` makes the claim Track S. In `held` or `final` it is recorded only; it does not stop a `final` claim's effect.
5. **Not done here:**
   - Moves are not refused while a claim is pending: the portability guard that would read `breakGlass` is outside this slice. Move cooling (90 days) is set.
   - Abort-link per-IP budgets, GET confirmation pages and headers are ORG-12e (the engine counts token failures per claim).
   - The 20-decisions-per-operator-per-day limit belongs to the admin service (ORG-12d).
   - The creation-time `missing` state (a creation file never confirmed) needs a creation-adapter hunk outside `packages/orgs`.
   - Person-side `orgs.breakglass-notices` is ORG-12b/12e.
6. **Claim storage.** Claims are their own rows, but the time rules run in `orgs.ownership-tick` (`advanceExtra`) instead of `org/due/…` entries: one open claim needs no index.

**Review follow-ups** (independent adversarial review, 2026-10-23: 3 High, 4 Medium, 8 Low; all fixed, each with a regression test in `tests/orgs-break-glass-review.test.mjs` that fails when the fix is reverted, checked one revert at a time in a scratch copy of the tree):
- **H1, a filled outbox blocked owner aborts while the claim still took effect.**
  - Only pending ownership-outbox rows count toward the cap, and at most 128 done rows are kept.
  - Critical effects are never refused for capacity: refunds, ledger updates, recovery rotations, and the owner notices of aborts, disputes, liveness, withdrawals, closures and deadlines.
  - One objection per admin per claim. At most 24 non-critical owner notices per claim.
  - The effect is refused while any owner notice for the claim is undelivered (`notices-pending`).
- **H2, one chargeback wedged every billing sync.**
  - New non-throwing `paymentState` (paid, owner, refund or revoke, hold) checked before every effect.
  - A gone payment closes the process: break-glass `closed`/`payment-failed` (new event `unpaid`), transfer `failed`/`payment-failed`, lapse claim `closed`/`payment-failed`.
  - The throwing commit guard is now a backstop that only reschedules.
  - The chaos suite checks "a fresh sync never throws". The provider port's documented capacity refusal (F-05) is the one tolerated exception.
- **H3, ownership could be laundered during the contest window.**
  - While the window is active (or a contest is undecided), lapse-claim start and settlement and break-glass starts are refused (`contest_window`), and the `claim` decision is hidden.
  - A reinstatement restores the former owner from whoever owns the organization now.
- **M1, Track A could take effect with no notice delivered.**
  - Per-channel provider acceptance is recorded on the claim, and retries re-send only unaccepted channels.
  - At the end of the wait, Track A needs the T1, T5 and 72 h (`remind-72h`) notices each accepted on an out-of-band channel. Otherwise the claim is held for support (Track S, new event `undelivered`).
  - Acceptance means the provider accepted the notice, never that it was delivered.
- **M2, a recovery-file reissue could race an owner change.**
  - Reissues are bound to `recoveryGeneration` (raised by every owner change) and to the owner who began them.
  - A `done` for a superseded reissue queues a fresh rotation and answers `{issued:false}`; the edge (`creation.mjs`) then never hands out the file (`organization_owner_changed`). `orgs.recovery-reissue-done` is reachable by a former owner whose powers are held.
  - An owner with a passkey must step up with it (`verification.hasPasskey`/`method`). **Gap:** the identity evidence producer (`organizationVerification`, identity stream) does not send these fields yet, so until it does the rule cannot bite. Not edited here.
- **M3, operators were free UUID strings.**
  - Operator decisions (`orgs.breakglass-resolve`, `orgs.claim-resolve`) need an assertion verified through the `operators` port. An assertion binds exactly one operator, the `support.org-break-glass` capability and one scope (organization, process, decision, exclusions). It lasts at most 5 minutes and is used once (nonce).
  - `hmacOperatorAssertions` is the loopback and test implementation. With no port, decisions are refused.
  - **Production gate: verified operator identity** (ORG-12d supplies the signer and registry; design §12d.12).
- **M4, mail.acme.example evaded the admin-domain rule.** Domains are stored as hashes of the domain and every parent suffix of two or more labels. A public suffix such as co.uk can over-match, which only moves a claim to Track S.
- **L1 to L8:**
  - L1: token erasure (above).
  - L2: unknown owner activity (`lastInteractiveAt:null`) means Track S.
  - L3: owner liveness clears a pending proposal.
  - L4: an owner decision about a held member still aborts the claim.
  - L5: the candidate leaving, or a co-signer withdrawing after payment, counts as voluntary, so the processing fee is kept. Removal, authority resets, suspension and security changes stay full refunds (provisional policy).
  - L6: the stricter operator pair (above).
  - L7: 64 tokens are reserved for final notices.
  - L8: every unusable candidate gets one answer, given only after the initiator is known to be eligible. Refused starts no longer count toward the per-person start limit. Admins and members see only `closed` (no `closedReason`), and audit entries show `owner` instead of the proof tier.
- **Chaos additions:**
  - New schedules: chargebacks, objection spam, notice delivery failing, a stuck outbox, lapse claims during the window, and operator assertions (some forged).
  - New invariants: I11 a fresh sync never throws; I12 an owner stop is never refused for outbox capacity; I13 a Track A effect only after accepted out-of-band T1, T5 and 72 h notices; I14 inside a contest window the owner changes only by reinstatement.
- **Equivalent mutants (removing them changes nothing):** the `state==='final'` term in the dispute check (implied by `decisionMade`), and the approval-time barred-pair check (implied by the proposal-time check).

**Round-2 follow-ups** (second review, 2026-10-23: it confirmed every round-1 finding closed and found 2 Medium and 2 Low gaps; all fixed, with tests in `tests/orgs-break-glass-review2.test.mjs`, each checked one revert at a time in a scratch copy):
- **R2-M1, one channel that never accepted held a claim forever.** The round-1 rule "no effect while any owner notice is pending" is replaced:
  - Track A still needs each of the T1, T5 and 72 h notices accepted on an out-of-band channel. A final claim needs its final notice accepted on a channel support did not exclude; if that has not happened within 7 days of the earliest effect time, the claim goes back to support.
  - A channel is marked `undeliverable` after 8 failed attempts over 7 days (provisional) and is no longer retried. An undeliverable out-of-band channel moves the claim to Track S, and a waiting or final claim to `held`.
  - Support may exclude a channel that disputed or that is undeliverable. A dead owner's push subscription (410) is the expected case.
- **R2-M2, a second concurrent reissue escaped M2.**
  - Every begun reissue is remembered (`recoveryReissues`, up to 8; an overflow rotates the oldest away). Any unconfirmed `done` from a principal who began one queues a rotation and answers `{issued:false}`. A principal who began nothing gets `not_found` and causes no rotation.
  - The edge fails closed: any error or non-confirmation of `done` withholds the file.
- **R2-L1, start still wrote before checking eligibility.** `breakGlassStart` runs every eligibility check, including the uniform candidate answer, pending processes, limits and the outbox backlog, in a read before anything is written. Ledger reservations in other people's accounts happen only for an eligible initiator, and only an eligible initiator sees the ledger's specific refusal codes.
- **R2-L2, pending rows could accumulate.**
  - When a claim ends, its undelivered owner-notice rows are dropped; its closing notice gives up after 8 attempts.
  - Outbox effects are now critical by default. Only a person's new request (an ownership offer, an ordinary break-glass notice) passes `critical:false`, and new claims are refused while 256 effects are pending. So a backlog can never throw inside a system effect commit (the transfer wedge in the repro).
- **Hardenings:**
  - The operator assertion scope names the process kind (`lapse-claim` or `break-glass`).
  - Email domains are IDNA-normalized (URL host parser, to ASCII) before suffix hashing, on both sides.
  - An undecided contest keeps its restrictions at most until the later of the window's end and 30 days after it opened. Then it is escalated to operators (an alert and an audit entry), and it stays decidable.
- **Chaos additions:** schedules for a dead push channel and for reissues racing owner changes. New invariants: I15, an ended claim's owner notices complete or are dropped within days; I16, a reissue is confirmed only for the current owner in its generation, and an unconfirmed one leaves a rotation.

**Tests:**
- `tests/orgs-break-glass.test.mjs` (46 tests) `tests/orgs-break-glass-review.test.mjs` (20 tests) and `tests/orgs-break-glass-review2.test.mjs` (10 tests): every transition and timer at its boundaries, eligibility, tracks, limits, the effect commit, contests, views, the per-person ledger, ORG-12r, and the named adversarial cases. Those cases are: the coalition, the stolen device with a new operator pair, the email-only owner's last channel, operator misuse (single, member, party, self-approval), quota spam, held expiry, a session refresh, admin probing, an aged passkey, foreign co-signers, transfer and lapse races, token replay, harassment, a candidate taken over, an owner renewal, no channel, and a chargeback.
- `tests/orgs-break-glass-chaos.test.mjs`: 24 seeds by default (`CHAOS_SEEDS`, `CHAOS_SEED`), I1–I16 checked after every step; 80 seeds passed once after the round-2 fixes. It covers service restarts, outages, webhook replay, flag flips and clock jumps. 150 seeds passed once locally.
- **Guard removal.** A scratch mutation pass removed 35 security guards one at a time (two operators, last channel, barred pair, operator conflicts, exclusions, tier-1 finality and credential age, known sessions, flag, freshness and billing hold on the effect, freeze, Track S triggers, refresh, lock, limits, uncounted expiry, fee retention, token checks, eligibility, P18, quorum, settlement guards, contest restrictions, the shared commit's owner and freshness guards, lapse two-operator, reissue cooling, lapse/break-glass exclusion). 34 made the suite fail; the remaining one (`state==='final'` in the dispute-only test) is redundant with `decisionMade`, so removing it changes nothing.
- Updated: `tests/orgs-wargame.test.mjs` (two operators), `tests/orgs-ownership.test.mjs`, `tests/orgs-ownership-runtime.test.mjs` (`missing`), and `tests/flags-registry.test.mjs` (58 flags, 25 class a, plus a pin test).

**Before production:**
- ORG-12b, real notification delivery, ORG-12d/12e, organization terms (ORG-13) and an independent security review of ORG-12a–d.
- The organization audit is already hash-chained (`MembershipService#audit`), but no external anchor exists.

Verification (after the round-2 fixes): `npm test` 3,343/3,343. Break-glass and organization node suites (the three break-glass files plus chaos, wargame, ownership and ownership-runtime): 130/130. `npm run test:organizations`: node stages 124/124, 57/57 and 114/114. The final e2e stage `tests/e2e/org-console.test.mjs` fails 2 of 6, unchanged (en and es: the shell URL is `?view=inbox` where `''` is expected; console routing under other agents' edits; no web or build file is touched here). `npm run test:worker` 91/91. No Worker parity test exists for claim rows yet. Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Organization console UX pass 2

Second-round browser QA findings in the organization console. Files: `apps/web/src/bl/organizations.mjs`, `apps/web/src/ui/org-console.mjs`, `apps/web/src/ui/org-messages.mjs`, `apps/web/src/providers/organizations.mjs`. There is one small backend display hunk in `packages/runtime/recovery-eligibility.mjs` and `packages/runtime/http.mjs`, plus five Spanish strings in `packages/i18n/catalogues.mjs`. Nothing under `packages/orgs/*` changed.

All of these decisions are provisional:
1. **H4: stale changes.** Only organization changes (`GUARDED`) wait for an uncertain change to settle. Reads, lookups, local actions, idempotent creation and the recovery steps never wait.
   - A definite refusal (HTTP 4xx other than 408) clears the stale state. The view then refreshes from the server, and every form is rebuilt from that state through `formEpoch`, which keys `#org-main`.
   - An uncertain failure also refreshes. If the refresh works, the person sees `change_uncertain`. If it fails, further changes answer `reload_required`.
   - A refused creation never leaves the console stale. A refused name, kind or plan releases the stored attempt.
2. **M1: admin for existing members.** The member access form no longer offers "Admin" to a non-admin member, because the server refuses it (`bound_invitation_required`). It explains that the power comes through an invitation, and "Prepare an admin invitation" (`invitee-member`) fills the bound invitee and moves focus to the invite form.
   - An existing admin keeps a "Keep the admin power" box. Unticking it removes the power, which the server allows.
   - Resource-grant edits in the same form are unaffected.
3. **M2: recovery check.** A decrypt failure maps to `recovery_mismatch`. Checking before downloading gives `recovery_download_first`. Both download and a successful check clear the error.
4. **M3: two tabs.** The provider's `recoveryTabs` keeps a localStorage claim per organization: `{tab, issue, at, saving}`, refreshed every 15 s, expiring after 60 s and released on `pagehide`. It never stores the file, the passphrase or key material, and storage failures disable coordination.
   - Other tabs show "A recovery file is being saved in another tab" instead of offering a new file, and `regenerate-recovery` refuses with `recovery_saving_elsewhere`.
   - If another tab issued a newer file anyway, Finish refuses with `recovery_superseded` and drops the stale copy. The organization stays marked "not saved".
   - Limitation: a tab learns about another tab's claim only when it next loads or acts. There is no live cross-tab repaint, because wiring one needs shell code owned by another agent.
5. **M4: reissue eligibility.** `GET /api/account` `recovery` now also carries `organizationReissueEligibleAt`: the earliest passkey or password enrolment plus 7 days, matching `tight()` in `packages/orgs/ownership.mjs` (null when the account has no credential). The unsaved banner shows that date, or the "add a credential" text, instead of the button. This is display metadata only. The 30-day security-change cooling period is not exposed; the server's `recovery_reissue_cooling` refusal now has a translated message.
6. **L1–L7.**
   - L1: focus moves to the organization heading after Finish, the share heading after an invitation is created, and the first new member after "Load more".
   - L2: while the step-up card is open, the console is `inert` and says why.
   - L3: notices clear on context switch and on `open` (history navigation). An organization that refuses the membership leaves no context ("Acting as yourself" plus the alert). A newly created organization is listed at once, so no "Acting for …" placeholder appears.
   - L4: an entry also loads the person's own list, and the preview's `member` flag is honoured. An invitation already joined says "You're already a member" and offers "Open organization".
   - L5: unusable invitations hide the token's expiry, the "For" row and "What joining means".
   - L6: the audit log labels link withdrawal and other events. The joiner shows by handle once the member list has loaded it. The person's own actions say "by you" / "por ti".
   - L7: context options include `(@handle)`, or the kind when there is no handle.
7. **L10/L11.**
   - `.org-check` labels are at least 44 px tall.
   - `ol.org-steps` is a numbered, non-interactive text indicator; the current step is underlined.
   - Also fixed: dodo writes a `null` attribute as the string "null", which marked every step `aria-current`. Absent attributes now omit the key.

Tests:
- `tests/browser/organizations-engine.mjs`: 12 new engine tests (H4 ×3, M1, M2, M3 ×2, M4, L1, L3, L4). One assertion now also allows the person's own `list` read at entry.
- `tests/browser/org-console-browser.mjs`: a new "ORG UX pass 2" test runs in Chromium and Firefox, en and es, light and dark, at 390 and 1280 px (16 runs). It uses two tabs in one context for M3. The fixture gained `patch`, a passphrase-checking fake decrypt, a refusable rename and an invalid preview.
- `tests/e2e/org-console.test.mjs`: a new real-shell test covers eligibility, the member admin path, audit wording, 44 px targets and the progress indicator, at 390 and 1280 px, light and dark, en and es, with screenshots in `artifacts/browser/org-ux2-*`.

Verification:
- `npm run test:ui-state`: 431/431.
- `npm test`: 3,271/3,274. The 3 failures are `tests/billing.test.mjs` (2 checkout tests) and `tests/engine-legal-identity.test.mjs` (signup region versus age). The legal-identity failure reproduces with this pass's `http.mjs` hunk reverted, and none of the three touches files changed here.
- `npm run test:organizations`: node stages 94/94 and 57/57, browser stage 97/114.
  - 16 ORG-D21 failures in `org-ownership-browser.mjs` come from another agent's concurrent paid-age checkbox in `ui/org-ownership.mjs`: the test does not tick it.
  - 1 ORG-5 Firefox run failed while the machine was under load ("checkbox did not change state"). It passed 13/13 twice when rerun alone.
  - The chain stops at that stage.
- E2E alone: 4/6. The 2 failures are the existing shell test expecting `''` where the shell now writes `?view=inbox`, from the concurrent shell-routing work in `apps/web/src/release.mjs`.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — App-platform wargame fixes (integrations, MCP, email bridge, AI budget)

Third red-team round against the app platform (findings F1–F10). Each scratch repro is now a permanent regression test. Every new test was checked against a scratch copy of the tree with its fix reverted, and fails there; no shared file was rewritten in place for those checks.

Provisional decisions (unsigned):
1. **F1: AI budget partitions.**
   - Each owner may spend at most `SEMANTIC_OWNER_SHARE_PERCENT` (default 10%) of its partition's daily and monthly semantic allowance.
   - The classifier (Clef) has its own `classifier` ledger in the same sixteen budget authorities. Defaults are $0.50/day and $5/month split across partitions (`CLASSIFIER_GLOBAL_DAILY_MICRO_USD`, `CLASSIFIER_GLOBAL_MONTHLY_MICRO_USD`), with owner share `CLASSIFIER_OWNER_SHARE_PERCENT`, default 10%. Classifier leases never consume a semantic owner admission. Combined estimated admission exposure is now $10/month instead of a shared $5.
   - A classifier request is charged a request-sized estimate instead of a flat 1,000 µUSD. Request bytes bound input tokens, priced at the dated $0.038 per million input tokens, doubled for margin and capped at 1,000 µUSD.
   - Classifier activity work is charged to the consuming app's client id instead of `@classifier`.
   - Consequence: at default totals, one owner gets about 3,125 µUSD/day of classifier money per partition, roughly 10–25 calls, well under the 200/day account allowance. Operators raise the totals to change this. Recorded in `docs/spec/omni-search.md`.
2. **F2: integration event outbox.**
   - Rows are counted per connection exactly, so the 128-row revocation ceiling holds.
   - `credential-revoked` rows of one connection merge while the union fits one event: grants are unioned and the latest `until` is kept.
   - Ingest skips a refused non-revocation event and sets `resync`, instead of stopping. Deliver and status page per connection. Expiry clears the connection's whole backlog.
   - Federation revocation markers carry `until: now + ACCESS_ENDS_BY_MS`. The brokered dedupe set evicts its oldest markers instead of refusing and stalling the drain.
   - Recorded in `docs/spec/integrations.md` §6.4.
3. **F3: MCP `items_list` projection.**
   - Rows carry only `id`, `mimeType`, `size`, `receivedAt`, `readAt`, `tags`, `classification` and `quarantined`, plus `subject` only when `item_read` is consented for that collection.
   - `notificationSummary`, `grantId`, `owner` and `senderMetadata` are never returned.
   - This covers the tool, the collection resource, the `review_collection` prompt and browser automation.
4. **F4: agents may quarantine but never release quarantine.** Releasing stays an owner action in the console. The MCP schema and the account operation both refuse `quarantined:false`, and so does browser automation. Recorded in `docs/spec/mcp-service.md`.
5. **F5: app-notification receipts.**
   - Receipts are capped at 320 live per connection and 1,024 per account. The account cap never refuses a connection holding fewer than 32.
   - A `reserved` receipt left by a crash is a 5-minute lease: once it lapses it stops counting and is swept, and the commit re-checks the lease.
   - Recorded in `docs/architecture/app-notifications.md`.
6. **F6: email bridge source bucket.**
   - The hashed bucket is peeked before the directory lookup and charged only on a refused lookup.
   - Under pressure, an exact-domain refusal allowance (50/h) and a fleet-wide overflow (20,000/h) apply.
7. **F7:** Node wires the app-metadata fetch port only when `siteGlobal(APP_METADATA_DISCOVERY_ENABLED)` is on. `McpAuthorization.inspect` checks the flag per client before using any port. The Worker wires no port. Recorded in `docs/spec/app-metadata.md`.
8. **F8:** the bridge sender cooldown is refunded when `reply()` fails, so a forged mail no longer suppresses the real sender's auto-reply.
9. **F9:** MCP `item_delete` charges the work budget before deleting.
10. **F10: mutation journal.**
    - MCP and automation journal rows expire after 48 h, through an expiry index swept by the account alarm. This is the replay lifetime.
    - Deterministic refusals are recorded as `failed`.
    - Recorded in `docs/spec/mcp-service.md`.
11. **Cheap extras.**
    - Browser automation writes are charged once, at the confirmed prepare step.
    - Google Drive `item_read` is refused before download over 64 KiB.
    - `BROWSER_AUTOMATION_ENABLED` is a new registry kill switch. Deviation from the requested class a: it is **class b** (`safe:true`, env default on, `not-false`). A class-a flag without a console record falls back to `safe`, so keeping today's always-on behaviour would invert the kill switch's meaning. Revoke is never gated. The registry now holds 59 flags.

Not fixed / residual:
- **F2:** the account-wide 512-row limit (1,024 for revocations) has no per-connection reservation. Four connections at their revocation ceiling can still get other connections' non-revocation rows refused; skip-and-resync keeps that from blocking revocations. `drainBrokeredEvents` in `packages/federation/service.mjs` still stops on its first failure.
- **F5:** same-transaction-id retry stays indeterminate for 24 h through the federation call log (`packages/federation/runtime.mjs`). The commit lease re-check has no direct test. `docs/release/app-notifications-review.md` still cites the old 256 cap.
- **F6:** once the overflow is exhausted, new domains in exhausted buckets are refused for the hour. Peek-then-charge is not atomic.
- **F10:** journal rows written before this change carry no expiry. The alarm hook is tested through the sweep function, not a full alarm run.
- **Extras:** S3/WebDAV have no stored size, so they get no pre-download size check (the 1 MiB adapter cap and the MCP output cap remain). The flag rows were added in the review follow-ups below.

Tests (new): `tests/semantic-partition-share.test.mjs` (5), `tests/integration-events-wargame3.test.mjs` (9), `tests/app-notification-receipts-wargame3.test.mjs` (2), `tests/email-bridge-wargame3.test.mjs` (3), `tests/metadata-discovery-flag.test.mjs` (3; the Worker test is a guard), `tests/mcp-wargame3.test.mjs` (8). Updated: `tests/classifier-occupant.test.mjs`, `tests/semantic-global-budget.test.mjs`, `tests/semantic-spend-audit.test.mjs`, `tests/brokered-severance.test.mjs`, `tests/app-metadata.test.mjs`, `tests/flags-registry.test.mjs`.

Verification:
- New files: 30/30. Focused related suites: 371/371.
- `npm test`: 3,440/3,441. The failure, `tests/contact-grant-reclaim.test.mjs` "an expired parent is reclaimed…", passes at HEAD with only this round's files applied, so it comes from concurrent edits elsewhere.
- `npm run test:worker`: 90/91. The failure, U404 in `public-unknown.test.mjs`, is an esbuild bundle error (`agent-base` imports `http`) through the concurrent `apps/node/resources.mjs` portability edit. It passes at HEAD with only this round's files applied.
- `npm run test:ui-state`: 447/447.
- Not committed.

Independent review follow-ups (same day; provisional, unsigned):
1. **F3 completion (HIGH).** `item_write` results over MCP and browser automation now use the `items_list` projection (`subject` only with `item_read`). The journal stores only the projection, and replays project again, so raw rows from before the fix are never returned. `item_delete` journals `{deleted:true}`. Tests: two new cases in `tests/mcp-wargame3.test.mjs`.
2. **F2 resume loss.** A refused `connection-resumed` sets `pendingResume` on the connection record. Resync re-derives the resume while the flag is set, even after later unmapped events have advanced the generation, and clears it on success.
3. **F6 forged envelopes.**
   - Misses charge the exact-domain allowance (50/h) only when the trusted `Authentication-Results` header (configured authserv-id plus the strip attestation) shows `spf=pass` with `smtp.mailfrom` equal to the envelope domain. SPF-aligned mail then falls to a fleet-wide authenticated pool (20,000/h).
   - All other mail uses a separate unauthenticated pool (20,000/h), replacing the overflow pool. On Cloudflare no authserv-id is configured, so all mail is unauthenticated.
   - A directory exception charges nothing.
   - **Residual targeted lock-out:** about 22,000 forged messages in an hour (one bucket of 2,000 plus the unauthenticated pool) refuse unauthenticated mail from every domain whose bucket is exhausted, which on Cloudflare means all of it. With a trusted receiver, the targeted domain's SPF-aligned mail still passes unless the 20,000/h authenticated pool is also drained with real SPF-passing domains. Peek-then-charge is not atomic. Under bucket pressure with a trusted receiver, every message is parsed before the lookup, bounded only by the 1 MiB raw limit.
4. **F1 sybil maths and admission gate.**
   - A partition's default daily semantic allowance is 31,250 µUSD and an owner's share is 3,125. Ten accounts hashed to one partition exhaust its day; accounts land uniformly, so about 160 accounts exhaust every partition's day. The classifier ledger has the same shape, but those accounts must also be paid.
   - Lifetime semantic owner admissions are 62 or 63 per partition (1,000 across 16). About 62 sybils landing in one partition fill it permanently, and about 1,000 fill them all, which equals the 1,000 lifetime signup admission cap.
   - New gate: semantic admission (consent and every reservation) requires a paid entitlement or an account at least 7 days old. Age is measured account-locally from `account/created-at`, now written when the account first binds its owner. Accounts created earlier start the clock at their first eligibility check (`semantic/first-seen`), so the gate never measures from before creation. Identity `createdAt` is not exposed to the account object, and wiring it would touch `apps/node/resources.mjs` and `apps/worker/objects.mjs`, which other agents own.
   - **Not done: recycling owner admissions.** The audit requires reclaiming stock only after provider vector deletion is completed and reconciled, so expiring an inactive owner's admission without verified deletion would undercount retained vectors. Left as a residual: the 7-day gate and the signup cap slow sybils, but don't stop them.
5. **Lease floor.** The `GlobalSemanticBudget` constructor rejects configurations whose daily or monthly owner share cannot hold one lease: 128 µUSD semantic, 3,000 µUSD classifier. Tiny-budget tests were rescaled.
6. **Classifier estimate.**
   - The state is now priced once per question (11×), with tokens bounded by bytes at $0.038 per million. Worst-case bounded requests cost about 2,200 µUSD; "Hello" costs about 101. The classifier lease ceiling (`CLASSIFIER_LIMITS.microUSD`) rises from 1,000 to 3,000, and a request whose estimate would exceed it is refused before any charge.
   - The billing assumption is unverified and needs one real-invocation measurement.
7. **Node flags.**
   - MCP shards already read console records through `config.FLAGS_RUNTIME`, set by `nodeResources`, so no shard config change was needed.
   - `apps/node/server.mjs` no longer freezes `APP_METADATA_DISCOVERY_ENABLED` at boot. The port is wired whenever HTTPS client origins exist, and `McpAuthorization` evaluates the flag per request and per client.
   - The source-check test pins this. The console-record test passed before and after.
8. **Info:** brokered dedupe eviction can re-enqueue a duplicate federation revocation. This is accepted: the duplicate merges per connection and is idempotent at the receiver.
9. **F5 bounds.**
   - The per-connection reserve of 32 is bounded account-wide at 4,096.
   - The authoritative capacity check runs in the same transaction as the `reserved` receipt write, and a failed quota reservation removes its receipt.
   - Cost: a send lists up to 1,025 receipt rows, or 4,097 above 1,024.
10. **Docs.**
    - `BROWSER_AUTOMATION_ENABLED` rows were added to `docs/architecture/feature-flags.md` and `docs/self-hosting.md`. Node does not forward the variable, so it stays on there.
    - `docs/release/app-notifications-review.md` now says 320 per connection and 1,024 per account.
    - The new export keys `account/created-at` and `semantic/first-seen` are inventoried in `packages/runtime/export-contributors.mjs`.

Follow-up verification:
- New wargame files: 40/40. Focused related suites: 417/417.
- `npm test`: 3,525/3,527. The two failures, `tests/conversations-wargame3.test.mjs` "slow peers never refuse…" (52 s, under load) and `tests/bindlebox/receive.test.mjs` "large bodies are staged…", both pass when rerun alone (14/14 and 9/9). They are other agents' areas.
- `npm run test:worker`: 92/92. The earlier bundle failure is no longer present.
- `npm run test:ui-state`: 448/448.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Links, Beam, device and directory wargame fixes

Red-team round 3 findings in links, Beam, device authorization and the federation directory. Each repro is ported to a permanent test under `tests/`. Each test was checked to fail with its fix reverted, in a scratch copy of the tree. Everything below is provisional and unsigned. Production relay, directory egress and device authorization remain flag-gated, and nothing is provider-verified.

Links:
1. **L1: limiter before identity.** The signed contact route runs the per-IP `message` limit and the claimed-principal `link-audience` limit before the identity lookup. A limited caller gets 429 whatever the named identity's lifecycle.
2. **L2/L2b: `POST /api/contacts/redeem`.**
   - Redemption uses the shared `canonicalContactLink`/`parseLinkQuery` path, so `bindle_meta` links redeem over HTTP.
   - Every refusal is one `contact_invalid_redemption` 400: malformed, foreign origin, unknown, inactive or handle-mismatched account, failed verification.
   - Deviation: the identity lookup still precedes the account object. On Node, opening an account object for an arbitrary UUID creates its storage. The lookup's outcome is indistinguishable from a failed verification.
3. **L3: peer index.** Each binding also writes `beam/redeemed-peer/<peer>/<grantId>`, deleted when the parent is reclaimed. `permission()` reads only that peer's bindings, bounded by `MAX_STORED_GRANTS`. Bindings made before this change have no index row; pre-release, so there is no backfill.
4. **L4: app-link purge.** `LinkService.issue` runs a bounded purge (16 rows) past `PURGE_AFTER` on every issue, not only at the cap. It covers revoked rows and expired live ones.
5. **L5: tombstone collection.**
   - Tombstones record the parent's signed `exp`. A cursor sweep in `collectLinkState` collects them once `exp` plus 5 minutes of skew has passed.
   - A tombstone without `exp` is kept for 366 days after reclamation. The sweep runs before parent reclamation.
   - Recorded in `docs/spec/contact-tokens.md`.
6. **Plausible findings, both fixed.**
   - An owner read of an unknown contact URL is `not_found` 404, not a plain Error.
   - `redeem()` reads quarantine, activity and expiry inside its transaction.

Beam and device authorization:
7. **D1: relay usernames.**
   - Issued TURN usernames are persisted per role inside `iceIssued`, which `beamView` strips.
   - They are revoked on cancel, reject and complete, and on the account alarm (`beamTurnSweep`, before cleanup).
   - A failed revocation is retried until the credential has expired.
8. **D2: re-issue.**
   - The TTL is min(300 s, the beam's remaining lifetime).
   - After expiry a participant may re-issue up to 4 times per beam. Each re-issue takes a new reservation and revokes the old username.
   - A failed issuance does not count toward the 4.
9. **D3: non-participants.** The offer route and `BeamService.authorize` answer a non-participant account `beam_not_found` 404 right after `beamRaw`, before expiry, device or account checks.
10. **D4: approval kind.**
    - `linkedApprove` takes the expected `kind`: the session route sends `session`, and the device grant's consent path sends `app`. Absent means `session`.
    - A mismatch is `invalid_code` and leaves the request pending.
    - Minimal one-line edits in `routes/identity.mjs`, `linked-approval.mjs` and `packages/federation/device-authorization.mjs`.
11. **D5: approval window.** Approval sets `pendingUntil` to at least now plus one maximum poll interval (60 s).
12. **Plausible findings, all fixed.**
    - A recipient mailbox holds at most 16 live offers per sender, inside the 128 total.
    - `'issuing'` is a 60 s lease. The bare pre-change marker is treated as lapsed.
    - The reservation is not released when revoking unrecorded credentials fails.
    - D1–D5 are recorded in `docs/architecture/beaming.md` (round 3 table) and `docs/architecture/linked-approval.md`.

Federation and directory (delegated to a forked agent, reconciled here):
13. **F1: directory egress.**
    - `foreignDirectory()` returns one IdentityDirectory per controller, keyed by its store, so the manifest cache, document cache and limiter persist between calls. Concurrent refreshes share one manifest fetch.
    - The consent-screen lookup is cache-only (`directory.peek()`). On a miss it answers unverified and warms the cache in the background. UX consequence: a cold foreign organization reads as unverified on first view.
    - Node egress (`NODE_DIRECTORY_BUDGETS`):
      - Each tenant and issuer has its own interactive budget: 10/min and 60/h.
      - Interactive traffic together is capped at half of every global window and half the concurrency. The other half is reserved for background refresh.
      - Background refresh gets a roster-scaled allowance per tenant and issuer.
      - Global: 600/min, 100,000/day, concurrency 8.
      - Refusals carry `rate_limited`.
    - `/api/member-certificates/acquire` has a per-owner limit (`MEMBER_ACQUIRE_PER_MINUTE` = 30).
14. **F2: handle grammar.** A directory handle is accepted only as `local` or `local@host`, with host equal to the issuer's host and a valid local part. The consent screen shows only the local part next to the audience host. Bare `local` stays accepted because `identityDocument` publishes bare handles.
15. **F3: moves documents.** The Node egress default and ceiling are `MAX_MOVES_DOCUMENT_BYTES`.
16. **F4: key-reset baseline.** The key-reset epoch is stored per claimed (iss, sub), so an issuer change starts a fresh baseline. This is a minimal edit in `packages/orgs/certificates.mjs`.
17. **F5: roster scale.**
    - `directoryLimitsFor(n)`: the per-site budget is n/2 + 30 per minute, the cache holds n + 256 entries, and n is capped at 65,536.
    - Refresh-ahead runs at half the freshness lifetime.
    - The pin-store option with a longer freshness window was rejected, because it would break the 300 s + 60 s revocation bound.
18. **Claimed-refresh starvation.**
    - Member rows refresh before claimed rows.
    - `rate_limited` is not counted as a failed attempt.
    - Claimed refreshes use at most a third of the per-site budget.
19. **RSA keys.** Integration JWK Sets skip RSA keys whose exponent is below 65537 or even.

Independent review follow-ups (all provisional):
20. **F1: Node egress classes and tenants** (`node-directory-fetch.mjs`).
    - Background and interactive traffic are each capped at half of every global window (minute and day) and half the concurrency, so each class keeps a guaranteed half.
    - Background budgets are keyed per tenant across all origins: at most min(allowance, a quarter of the background minute window) per minute, and an eighth of the background day window per UTC day. The caller-supplied allowance is clamped server-side.
    - Per-tenant state is fixed-window counters. This supersedes the per-(tenant, origin) background budget in item 13.
21. **F5: cache byte budget.** The directory document cache is also bounded by bytes: `cacheBytes` is 8 MiB, scaled by 8 KiB per roster identity up to 64 MiB. A single document larger than the budget is not cached.
22. **Claimed limiter order.** The claimed and per-site limiters run before the global limiter, so a refused request spends no global token.
23. **F2: handles.**
    - A handle that fails `directoryHandle` is dropped and the document kept. This supersedes the refusal in item 14.
    - The consent screen shows a directory handle only qualified as `local@<issuer host>`, so a bare handle never reads as a local verified label. The UI already renders the host beside it and is unchanged.
24. **Beam sender lifecycle.** The offer route checks the sender identity exists before opening its account object, and maps `lifecycleUnknown` faults to `beam_not_found` 404.
25. **D2: reservation cap.** One beam's relay reservation, across both participants and every re-issue, is capped at 4 times one participant's envelope (`relayReserved`, stripped from views). A released reservation is uncounted.
26. **D1: lease and TTL.**
    - The success write requires that the call still holds its issuing lease (same `at`); otherwise it fails `beam_turn_lease_lost`, and the credentials are revoked.
    - The TTL is computed after the reservation returns. The failure path resets the slot only when it still holds the lease.

Not fixed / residual:
- **Node egress:** the global ceilings are finite. One tenant's background share is 75/min and 6,250/day at the defaults, which keeps far fewer foreign members warm than item 17's roster scaling asks for; large rosters on Node need the operator to raise the limits.
  - Eight saturating tenants can still exhaust the background day window; interactive keeps its half.
  - Tenant counters are LRU-evicted past 4,096 tenants.
- **RSA:** closed by the coordinator after the concurrent edits landed: client-assertion key selection in `packages/federation/introspection.mjs` now skips RSA keys whose exponent is even or below 65537 (`rsaExponentOk`, `tests/introspection-rsa-exponent.test.mjs`).
- **L4:** the purge still reads the whole `link/` prefix (the store contract has no cursor). It runs on issue only; no alarm hook was added.
- **D1:** the HTTP ice route's post-issue revocation does not clear the stored usernames. The sweep retries them until expiry.
- **D2:** `iceIssued:true` records from before this change have no stored usernames.
- **L3:** pre-change bindings are not backfilled into the peer index.
- **Testing:** browser UI was exercised only through the `test:ui-state` engine suites; there is no new DOM test.

Tests (new):
- `tests/links-wargame3.test.mjs` (8).
- `tests/contacts-redeem-oracle.test.mjs` (3).
- `tests/beaming-nonparticipant.test.mjs` (4).
- `tests/beam-turn-lifecycle.test.mjs` (11).
- `tests/device-approval-paths.test.mjs` (4), with the fixture `tests/helpers/device-approval-fixture.mjs`.
- `tests/directory-tenant-budget.test.mjs` (5).
- `tests/directory-egress-moved.test.mjs` (2).
- `tests/directory-handle.test.mjs` (4).
- `tests/directory-review-followups.test.mjs` (4).
- `tests/directory-roster-scale.test.mjs` (1).
- `tests/orgs-moved-member-epoch.test.mjs` (1).
- `tests/orgs-claimed-refresh-priority.test.mjs` (3).
- `tests/integrations-rsa-exponent.test.mjs` (1).

Tests (updated):
- `tests/beam-ice-retry.test.mjs`: the `iceIssued` slot shape.
- `tests/linked-approval.test.mjs`: the helper passes `kind`.
- `tests/directory.test.mjs`: padding goes through `features`.
- `tests/directory-handle.test.mjs`: rewritten for the follow-up semantics (drop, not refuse; qualified handle).

Verification (after the review follow-ups):
- `npm test`: 3,538/3,538. `tests/engine-account-export.test.mjs` passes (15/15); the uninventoried-prefix failure was not present on this run.
- `npm run test:worker`: 92/92.
- `npm run test:ui-state`: 448/448.
- New round-3 tests: 51/51. Related existing suites: 186/186.
- Every fix and follow-up was revert-checked in a scratch copy of the tree.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Conversations and bindlebox wargame fixes

A red-team round on the local conversation service (`packages/conversations`) and the BindleBox conversation engine found four Medium, three Low–Medium, five Low and several plausible findings. Each repro is now a permanent regression test that fails when its fix is reverted; this was checked one revert at a time in scratch copies of the tree (18 conversation cases, 15 bindlebox cases). Everything is local behaviour (in-memory and SQLite fixtures, Node server, simulator mesh). Nothing is production-verified, and no production gate changes. Every decision below is **provisional** (coordinator, not signed off by the user).

**Conversations** (`packages/conversations/index.mjs`, `runtime.mjs`; tests `tests/conversations-wargame3.test.mjs`)
- **C1 (Medium), one failing peer wedged every room.** Paused outbox tasks never left the outbox and counted toward the 512-task owner bound.
  - Tasks that exhaust 8 attempts move to a dead-letter prefix (`conversation/dead/`) outside the bound. The per-peer delivery records stay `paused`. An admin `retry` requeues dead letters. Dead letters expire after 30 days and are then reported as `expired`.
  - Fair share: a room may hold at most a quarter of the bound (minimum 64). A remote peer may hold at most an eighth (minimum 32); the owner's own self-delivery is exempt. Tasks beyond a peer's share go straight to dead letters as `conversation_peer_backlog`, so the post still succeeds and other rooms keep working. A room past its share is refused with `conversation_outbox_quota`. (Superseded by review follow-up 1.)
  - Removal cancels tasks of any kind to the removed member, except its removal notice, including dead letters, and records `cancelled` per peer. **Spec reconciliation:** conversations.md §59 says contributions accepted before the cutover keep their recipient snapshot, and the existing audit test enforces that. So a pending event accepted before the removal is still delivered within the recipient's 10-minute removal grace, and drain cancels it after that. Drain also cancels a removal notice to a re-added member, and an invitation that was voided, has expired or is stale.
- **C2 (Medium), invite-time permissions survived a lockdown.** `join` takes the member's permissions from the policy current at join time (`send`, `invite`, `admin:false`).
- **C3 (Low–Medium), a removed member's invitations stayed valid.**
  - Each pending row now records `issuer` (the submitting actor) and `epoch`. It commits in the same transaction as its invite task.
  - Removing a member deletes the invitations it issued and cancels their queued invites.
  - After an epoch change, an invitation admits its invitee only if a current admin issued it. Otherwise join refuses with `conversation_invitation_stale` (409), checked after the acceptance is verified.
  - `adminView` (used by `conversationGet` and the `get` action on the coordinator) lists the pending invitations with issuer, epoch, expiry and whether each is still current.
- **C4 (Low–Medium), uncounted full-text copies.**
  - A history row now references its inbox message (`messageId`, no text or title). Its key is stored on the message as `conversation.historyKey`, and `MessagingService.delete` removes the row with the message. The history action reads the text from the message and collects references whose message is gone.
  - At most `MAX_HISTORY_PER_ROOM` (1,000) rows are kept per room, counted in the receiver-local `historyRows`. The oldest are evicted in batches of 64; the messages themselves stay in the inbox.
  - Inbound and inbox-message receipts carry `at`. A bounded, resumable `sweep` collects them after 30 days. Older rows without `at` are stamped when first seen. Events signed before that window (less the 60 s skew) are refused with `conversation_event_stale`, so a collected receipt cannot readmit a replay. The sweep runs from `drain` and, best effort, after each received event.
- **C5 (Low), room-quota accounting could stay stuck.**
  - Removed and left rooms are collected `REMOVED_GRACE_MS` plus 30 days (`ROOM_RETENTION_MS`) after removal, by `roomQuota` and by the sweep. Their history references are collected with them.
  - `create()` now uses the same `roomQuota()` accounting as invitations.
  - New local `leave` operation (`conversationAction` `leave`) for a joined or removed room. A left room refuses later events and memberships and does not count toward the quota. A fresh accepted re-invite resets it. It is local only, as spec §49 allows; the source is not notified, so its tasks to the member are dead-lettered after retries. There is no UI yet.
- **Plausible, fixed: refused re-invites landed and notified.** `conversationInvitation` checks the room state first, with a dry run. A refused re-invite, such as a standing decline, writes no inbox message or notification and answers `{accepted:false,unchanged:true}`.
- `docs/spec/conversations.md` gains a "Local profile limits" note. `export-contributors.mjs` lists reasons for `conversation/dead/` and `conversation/sweep`.

**BindleBox** (`packages/bindlebox-engine/domains/conversations.mjs`, `delegation.mjs`, `receive.mjs`, `archive.mjs`, `store/archive-writer.mjs`; tests `tests/bindlebox/conversations-wargame3.test.mjs`, 14 tests)
- **B1 (Medium), a stale-epoch secret-share wedged a rejoining mailbox.** `onSecretShare` installs a share only for the epoch that was current before the switch, or for another epoch still within its overlap. It never moves current to an expired epoch, and the mailbox keeps `awaitingSecret` until the right secret is installed. Tested with a hostile member and with an honest peer still on the old epoch.
- **B2 (Medium), conversation bodies bypassed the hot-storage allowance.** (Wording corrected after review; the first version overstated what the hot allowance covers.)
  - Bodies of 4 KiB or more are staged to user storage when it is composed (the BB-B2 path). Without it, they are charged to the hot allowance together with the envelope and refused with `recipient_storage_unavailable` at its cap. The hot allowance covers only those large bodies held in the mailbox.
  - Every stored conversation event (envelope plus any body held in the mailbox) also counts toward a cumulative per-room bound of 512 MiB, 128 MiB per author, refused with `recipient_storage_unavailable`, because events are never collected. Charging every event to `hotItems` was rejected: it is a 5,000-item lifetime counter, so it would cap a mailbox at 5,000 records.
  - Link items with large bodies held in the mailbox are now charged envelope plus body. Small link items still have no cumulative bound beyond link quotas and the owner's daily budget.
  - The daily conversation allowance is charged on the whole delivery. Archive import re-charges hot usage for conversation events, as it already did for items.
  - Bodies are stored as bytes rather than number arrays. SQLite-backed Durable Objects allow values of about 2 MiB, and a 1 MiB body serialized as a number array goes past that; as bytes it fits with its envelope (at most 64 KiB).
- **B3 (Low–Medium), quadratic timeline ordering.** `orderEvents` uses a binary heap. The test counts comparisons rather than timing, and a second test checks the heap against the old order on random graphs.
- **B4 (Low), rotation epochs could be squatted.**
  - Pending rotations are keyed by epoch and proposer. Two proposals for one epoch with different digests are flagged as a conflict.
  - Accepting a contested epoch requires naming the proposer, otherwise it refuses with `rotation_conflict` (409).
  - A selected epoch never takes a second secret.
- **B5 (Low), counters at or below the frontier were applied as new.**
  - A compact `conv/counter/` counter→eventId index is written on every admission. It outlives replay retention and is archived.
  - A different event under a used counter is recorded as equivocation and stops the stream. An abandoned counter is receipted but not applied.
- **B6 (Low), the placeholder pool could be exhausted.** Each author may hold 16 placeholders, they expire after 7 days, and `gap` clears when the pool drains.
- **B7 (Low), the revocation recheck missed conversation authors.** Conversation receive writes seen-jkt rows. A revocation learned by the recheck, or in the receive catch path, calls `quarantineJkt`.
- **Plausible, fixed:**
  - An owner-wide per-author daily cap across conversations (10,000 records, 512 MiB).
  - Issuer limiter buckets by registrable domain. This approximates it from the last two labels, without a public suffix list, and the test covers only the helper.
  - When the 64 pending mutations are full, the author with the most loses its oldest.
- One existing test changed: in `tests/bindlebox/conversations-security.test.mjs`, the S7 block relied on applying an abandoned lower counter, which B5 now refuses. Its assertions are unchanged.
- Notes in `docs/spec/bindlebox.md` (§6.3, §6.5, §6.6) and a "Wargame round 3" section in `docs/release/bindlebox-conversations-review.md`.

**Review follow-ups (independent review, same day; all provisional)**
1. **Medium: C1 was not achieved.** Two members who don't acknowledge (offline, or after a local `leave`) wedged a room, and eight wedged the whole owner.
   - Tasks backing off (2 or more attempts) count toward the room and total bounds only up to `BACKOFF_ALLOWANCE` (8). The physical outbox stays under twice a bound.
   - When a share would be exceeded, the heaviest backlogged remote peer gives way: one with a failed attempt, or over its share. Its new task goes to dead letters first, then its existing tasks, as `conversation_peer_backlog`.
   - The owner's own tasks and healthy peers are never displaced. A room is refused only when it is busy with healthy deliveries.
   - Tests: `follow-up 1` (two scenarios: one room, then the owner-wide bound) and the backoff-allowance test. Both revert checks fail.
2. **Low–Medium: storage churn from abandoned-counter duplicates (bindlebox).** A read-only dry admission (frontier, counter index, quarantined stream, event row) runs before staging, so duplicates and abandoned counters are never staged. A not-applied duplicate costs one record of allowance and leaves an `applied:false` replay row, so retries are answered from it. Three revert cases fail.
3. **Low: the hot allowance covered only bodies of 4 KiB or more.** Fixed with the cumulative per-room and per-author bound and the link-path envelope charge described under B2, and the wording corrected. Two revert cases fail.
4. **Low: backlog dead letters were never re-driven.** When a peer accepts a delivery, its backlog dead letters are requeued oldest first, up to its share. Test: `follow-up 4`.
5. **Low: dead-letter expiry was not aligned with the receiver's staleness window.** An event dead letter now expires at `createdAt + RECEIPT_RETENTION_MS - MAX_EVENT_SKEW_MS - 1 h` (`deadExpiry`). Sweep and retry report it `expired` with `conversation_delivery_expired` instead of requeuing it. Test: `follow-up 5`.
6. **Low: invitations survived withdrawal of invite rights.** A permissions or policy change marks pending invitations `stale` when their issuer (or `bearer`, under the policy) no longer holds invite or admin. Join refuses them, the admin view shows them as not current, and their queued invite tasks are cancelled. Test: `follow-up 6/7`.
7. **Info:**
   - Legacy pending rows without an epoch are treated as current (same test).
   - BindleBox `secretConflict` records who caused it, the epoch and the event. The owner clears it with the new `conversations.dismiss-conflict` operation.
   - Issuer refusal buckets: per principal (20), per issuer host (200) and per registrable domain (1,000, a two-label approximation with no public suffix list).
   - `recordRevocation` walks at most 256 indexed rows per call. Its cursor is kept in the revocation row, `delegation.recheck` continues the walk, and the fence row is written at once. Store adapters list by prefix only, so reads per batch are not bounded, and recheck continuation has no dedicated test.
   - Gap marker: it is set only on room-wide pool overflow and clears when the pool drains, so it is a hint, not a completeness guarantee. Missing parents beyond an author's 16 are not tracked (spec §6.3, review doc B6).
- Revert checks for the follow-ups: 7 conversation cases and 9 bindlebox cases, all failing as expected. All earlier cases were rerun against the new code and still fail.

**Not fixed / open**
- B1: if no peer holds the rejoiner's selected epoch secret, for example its own unaccepted rotation, it waits until the owner acts (spec §6.6).
- B3: there is no timeline pagination or cache yet. Opening a conversation still loads and orders every event; only the quadratic cost is gone.
- BindleBox hot usage for conversation bodies is never released, because events are never deleted, and archive import does not recompute it. Both predate this round.
- Conversations: `conversation/delivery/` and `conversation/receipt/` rows on the coordinator are still not collected. Leave is engine and HTTP-action only.

**Verification (after the follow-ups)**
- `npm test`: 3,538/3,538.
- `npm run test:worker`: 92/92. The earlier U404 bundle failure came from another agent's in-flight edit and is gone.
- `npm run test:ui-state`: 448/448.
- `npm run test:bindlebox`: 220/220. One earlier full run failed `tests/bindlebox/worker-shell.test.mjs` at file level under load; it passes 9/9 alone and in the next full run.
- `npm run test:bindlebox:web`: 41/41.
- Conversation files (`tests/conversation*.test.mjs`): 43/43.
- Files owned by the orgs, identity, portability, app-platform and links/federation agents were not edited. Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Portability: redirect end/retarget, expiry reminder, intake gaps

This entry covers the remaining portability work from design §6.4: changing or ending a redirect, and the expiry reminder. It also closes the two intake gaps (Node egress, passkey enrollment). Everything is behind the existing portability flags or the `IDENTITY_TRANSFER_OUT_ENABLED` env kill switch, and is verified only against local doubles. Design §6.4, §6.5, §6.6 (a note for the legal owner) and §10.1 record the as-built behaviour.

Every item below is **provisional and not signed off**.

**1. Changing or ending a redirect**

Files: `packages/identity/redirect-management.mjs`, `packages/identity/redirect-records.mjs`, `packages/runtime/redirect-management.mjs`.

- **Sign-in.** The moved identity signs in at its current provider with 3sln.me acting as a Bindle client.
  - 3sln.me runs the SDK's own `BindleClient` server side as a public client-id-metadata.v1 client, published at `GET /bindle/portability/redirect-client`, with callback `/transfer-manage`.
  - All traffic goes over the portability egress (`TRANSFER_IN_PORTS.fetch`).
  - 3sln.me redeems the code itself with PKCE and revokes the tokens at once.
  - The pending login and the chosen action are sealed with `KEY_ENCRYPTION_KEY` into a 10-minute browser-held transaction, so the server keeps no state. The callback's `state` and `iss` must match.
- **Which identity is accepted.** The token's `issuer`/`subject` counts as the moved identity only when its successor chain verifies from this provider's own record:
  - **Forked chains are refused.** The chain position of our statement must hold our record byte for byte, and must agree with an earlier retarget's head.
  - **Stale chains are refused.** The chain must end exactly at the signed-in identity, as that host's directory and document confirm (spec §8.3 item 4). It must also be no shorter than an earlier retarget.
  - **Later records** must pass spec §8.3 items 1–3 and 5, starting from the key that signed our statement. Unattested records are never accepted.
  - `bindle_moves`/`bindle_origin` are optional. When present, they must match the document.
- **Uniform 404.** Unknown, expired and ended redirects answer the same uniform 404, and so does any verification failure. The answer is byte-identical over HTTP.
- **End.**
  - The redirect stops at once. The target, redirect base, retarget, captured destination keys and reminder email are deleted.
  - The statement and attestation stay until the later of commit + 30 days (the spec §5.2 replay window) and end + 7 days, never past the original `movedUntil`.
  - **No refund.** Design §6.4 provides none, and an extension that ran until the owner ended it delivered what it promised. A recorded extension is kept only as a one-way digest (`settledOrder`), so a redelivered webhook for it is ignored and not refunded as "bought nothing" (F13).
  - A purchase that loses the race to an end bought nothing and is refunded in full, once.
- **Retarget (IP-R1-L3).**
  - It needs a record after ours.
  - The `redirect_base` must be on exactly that later host's origin, supplied in the same authenticated transaction. 3sln.me's own origin is refused.
  - It is refused when chain verification had to trust an attestation key on first use. To keep that rare, the commit captures the destination's attestation-key thumbprints (best effort, new `destinationKeys` port), and they act as roots for that issuer.
- **Idempotency and audit.** End and retarget are idempotent. Each leaves an address-free entry in `moved.audit`, capped at 32 and sanitised of anything containing `@` or `:`.
- **Routes and UI.**
  - Routes: `POST /api/portability/redirect/manage/{begin,complete}` require same-origin intent headers and are rate limited. They follow the env kill switch, and answer 503 when egress or the sealing key is unconfigured.
  - The `/transfer-manage` page is the callback, and the redirect page links to it.
  - New provider catalog row: `redirectManagement`.

**2. Expiry reminder**

- **Opt-in.** The `reminder` choice (only allowed with a redirect) is available on both transfer-out paths and in the page.
- **At commit.** `markMoved` turns the opt-in into the identity's verified email as of the commit write. With no verified email, it records `reminder-unavailable`.
- **Sending.**
  - A `moved-reminder` due row fires at `redirectUntil` − 30 days, and the transfer-due index gains that kind.
  - The sweep makes at most 3 daily attempts through the mail port's new `sendRedirectReminder` (Worker `notify@`; Node's injected mailer). Each attempt is claimed in the record first, so concurrent sweeps never double-send.
  - Transport acceptance is recorded as evidence of an attempt only, never of delivery.
- **Deletion.** The email is deleted and audited:
  - when the redirect ends early;
  - at expiry (`endMoved`);
  - when an extension is recorded after the reminder went out ("extended past the reminder").
  An extension recorded before the reminder keeps the email and moves the reminder to the new expiry.
- **Privacy text.** `docs/legal/privacy.md` has no moved-identity paragraph and is **unchanged**. The legal README says it is updated when the flags turn on. Design §6.6 now carries a note for the legal owner: the proposed paragraph omits the 30-day/7-day statement retention, which names the new address. No legal wording was changed. **Flagged for the legal owner.**

**3. Node transfer-in egress** (implemented by a delegated agent, reconciled here)

- `packages/identity/node-portability-fetch.mjs` follows the reviewed DNS-pinned pattern:
  - `portabilityURL` policy, with queries allowed;
  - A records only, and every answer must be globally routable IPv4; IPv6 fails closed;
  - the screened address is pinned into HTTPS with original-hostname TLS;
  - GET and POST (16 KiB request), identity encoding only, 160 KiB responses, 3 s deadline, concurrency 16;
  - 3xx is returned as data and never followed.
- Node wires `TRANSFER_IN_PORTS`, `TRANSFER_IN_INTAKE` and `TRANSFER_IN_DOCUMENT` as the Worker does. The Node module is imported only from `apps/node/*`.
- Tests: `tests/node-portability-fetch.test.mjs` (10).

**4. Passkey enrollment at transfer-in** (engine and route by a delegated agent; UI here)

- It reuses signup's WebAuthn adapter unchanged, so origin, RP ID and user verification are all required.
- **Phase 1** (`/api/transfer-in/passkey-options`) passes the same gates as a password start, then reserves. It returns a 5-minute challenge bound by a hashed single-use ticket to the reservation, package and source.
- **Phase 2** (`start`, `method:'passkey'`) verifies the registration before issuing the receipt.
- A lost reply resumes only with an assertion, never a password.
- The transfer-in page offers "Use a passkey instead of a password".
- Paid plans at intake remain unsupported.
- Tests: `tests/transfer-intake-passkey.test.mjs` (8, with a contract-fake WebAuthn adapter) and a UI-state test. Real browser WebAuthn at intake is unverified.

**Adversarial self-review** (each has a regression test)

- **A forged successor ending someone else's redirect is refused** (`tests/redirect-management.test.mjs`):
  - an unattested record from an old-file holder;
  - a record attested by the attacker's own host;
  - the victim's real chain under the attacker's identity URI, or claimed from another issuer;
  - `bindle_moves`/`bindle_origin` that disagree with the document;
  - another identity's valid sign-in;
  - a token naming 3sln.me;
  - forks at our position, and a source equivocation after a retarget;
  - stale sign-ins at a previous host.
- **Open redirect via retarget is refused.**
  - Cases covered: other origins, look-alike hosts, a missing trailing `/`, query, fragment, dot segments and encoded dots, `http:`, ports, userinfo, `//` paths, 3sln.me itself and `javascript:`.
  - Retarget with no later move, or with only first-use keys, is also refused.
  - The sign-in adapter follows only an `https:` authorization URL on the discovered issuer.
- **Reminder email leakage is prevented** (`tests/redirect-reminder.test.mjs`):
  - the email is absent from `movedLookup`/308 bodies and from the redirect page status;
  - audit entries drop anything address-like;
  - it is deleted on end, expiry and extension-after-reminder, and the purged tombstone keeps it only while live;
  - the template names only the new host and refuses foreign links.
- **Extension purchase racing an end** (seeded):
  - the end always wins, and no purchase revives the redirect;
  - every order is refunded in full exactly when it bought nothing, never twice.
- **Seeded chaos** across end, retarget, extension (with redelivery), reminder and expiry in three time phases (`tests/redirect-management-chaos.test.mjs`, 24 seeds; also run with CHAOS_SEED 100, 1000 and 5000). Invariants:
  - an end is final;
  - a live base is only the attested or the verified later one;
  - billing exactness;
  - no reminder before its window or for a stopped redirect;
  - an address-free audit;
  - expiry erases everything.

**Residuals and open items**

- **An abandoned former host can roll back.** A former host that still answers for the identity (B→C→D, with C now hostile) can serve a document that drops the C→D record. Until 3sln.me has recorded a retarget to D, such a host can end or retarget the redirect to itself. This is the spec §8.6 residual (only pins, witnesses or a log detect it).
- **Not built:**
  - emitting `bindle_origin`/`bindle_moves` from 3sln.me's own token endpoint for identities that moved in (spec §11 MAY). Management falls back to the document's `moves`;
  - the automatic end after 30 days of 404 at the target;
  - a durable attestation-pin store for management (`REDIRECT_MANAGEMENT_PIN_STORE` is optional; without it, pins are per request);
  - a lost-response replay of `complete`. The code is single use, so the owner signs in again. The action itself is idempotent.
- **Provisional numbers:** the 7-day settlement window, 3 reminder attempts a day apart, the 10-minute transaction, and 20 management requests per minute per subnet.
- **Unverified:** real external providers, client-metadata resolution by other providers, and mail delivery.
- **Worker test failure is not from portability.** `npm run test:worker`'s U404 failure (`agent-base` imports `http`) comes from the concurrent `packages/runtime/account/orgs.mjs` import of `packages/messaging/web-push.mjs` (chain: `routes/member-certificates.mjs` → `account/member-certificates.mjs` → `account/orgs.mjs` → `web-push` → `https-proxy-agent` → `agent-base`), not from the Node portability egress. With only that import stubbed, the U404 harness bundles cleanly.

**Gates**

- Portability suites (transfer-out/in/intake, successors, moved routes, succession, wargame, redirect extension, the new redirect suites, Node egress): 231/231.
- `npm test`: 3,512/3,512.
- `npm run test:ui-state`: 448/448.
- tests/browser/transfer-browser.mjs: 24/24. The matrix now includes the manage page.
- `npm run check:worker` (asset build and Worker dry run): passes.
- `npm run test:worker`: 91/92. The one failure is the U404 bundle error described above, from a concurrent change.
- `npm run test:e2e`: 291 passed, 1 failed, 4 skipped (296).
  - The failure is `tests/e2e/ui-chaos-scale.test.mjs` "long handles … never overflow": Playwright's string `waitForFunction` is blocked by a page CSP (`unsafe-eval`). It touches no portability page.
  - A first run was killed part-way by another agent's `pkill`; these counts are from the rerun.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — ORG-12b/12e owner channels, abort links and console

**Implemented locally** ([organizations design §12d](docs/architecture/organizations-design.md#12d-org-12-break-glass-an-organization-whose-owner-is-gone-3slnme-provider-policy), slices ORG-12b and ORG-12e). Still behind `ORG_BREAK_GLASS_ENABLED` (default off). Tests run on loopback fixtures, the offline Polar model and capturing fake mailers. They show local behaviour only, not notification delivery or provider conformance: "accepted" means a provider (here a fake) accepted a message. ORG-12d (operator case screens, the production operator-assertion signer) and ORG-12f are not done; the `operators` port is unchanged. Every item is **provisional** (coordinator, not signed off by the user).

**ORG-12b, owner channels (`packages/identity/owner-channels.mjs`):**
- `ownerChannelsAdapter` implements the engine port.
  - `snapshot` reads the owner's identity record at T1: the current confirmed email, emails replaced in the 30 days before, push subscriptions, passkeys, the password and live sessions created before T1. It also returns `lastInteractiveAt`. Email and push come first, because the engine keeps 16 channels.
  - `domains` returns the email domains of the organization and of local signing principals.
  - `notify` sends one notice on one recorded channel.
- No address, domain or raw id crosses the port.
  - Channel ids are HMACs of (kind, owner, value) under a key derived from `KEY_ENCRYPTION_KEY`. Without that key the adapter is not built, so claims fail closed with 503.
  - Email domains are hashed on arrival with the engine's own suffix-and-IDNA rule (`emailDomainHashes`, newly exported). The engine now also accepts pre-hashed `domainHashes` and `{hashes}` values.
- Notices: email through the new `sendBreakGlassNotice` in `apps/worker/email.mjs`, with fixed English-then-Spanish templates per notice kind and the organization named only by its public handle. Push goes through the owner's account object (`orgsBreakGlassPush`) and a new service-worker notice type `bindle-org-claim-notice` with fixed texts.
  - For a known session or credential, `notify` answers accepted because the sign-in interstitial shows the claim. That acceptance never counts toward Track A, which needs email or push.
  - The push transport is injected by the adapters as `ORGANIZATION_OWNER_PUSH`. Shared runtime code imports no Node-only module (coordinator note: an earlier draft imported web-push in `account/orgs.mjs` and broke the Worker bundle, U404; fixed before this entry).
- Wired in both adapters (`apps/worker/objects.mjs`, `apps/node/resources.mjs`) as `ORGANIZATION_OWNER_CHANNELS` (`organizationOwnerChannels`).

**ORG-12b, person-side hints** (`orgs.breakglass-hint`, `orgs.breakglass-hints`; rows `orgs/break-glass-hint/<org>` in each person's account):
- At T1 the claim queues `bg-hint` outbox effects:
  - the owner (`owner`);
  - the candidate and up to 14 other eligible local admins (`admin`, at most `HINTS`=16 rows per claim).
- When the claim ends, every hint is dropped. At effect the former owner gets a `former-owner` entry until the contest window ends; it is also dropped when a contest is upheld or rejected.
- Effects may be retried or reordered. Every drop leaves a tombstone for its role and claim (the newest 16 are kept), so a late put stays dropped. The liveness chaos seed 216 found the first, per-role tombstone wrong.
- Hints only route. Every reader confirms with the organization (`orgs.breakglass`), which now also returns `organization:{id, name, handle}`.

**ORG-12b, the sign-in liveness hook** (`packages/identity/service.mjs`, minimal):
- New `interactive(account, kind, context)`, called by password, passkey and email sign-in and by step-up.
- It writes `lastInteractiveAt` in the caller's own CAS, so there is no extra write.
- It then fires `organizationSignals.liveness(owner, {kind, at})` in the background. Both adapters wire that to the person's `orgsBreakGlassOwnerSignal`, which reads the owner hints and sends `orgsBreakGlassSignal(org, {operation:'liveness'})` to each organization.
- With no hint, the cost is one read of the hint prefix: no write in the person's account, nothing sent to any organization. Activation, closure-export sessions and session refreshes never call it.
- Reading: the signal is sent once the credential is verified, before the sign-in CAS. A lost CAS race still signals, which is acceptable because the owner proved presence.

**ORG-12b, abort links** (`packages/runtime/routes/org-claim-abort.mjs`, modelled on `/account/recovery/cancel`):
- The link is `/org-claim/abort#org=<org>&token=bg1.…`, with the capability in the fragment.
- GET serves a confirmation page in English or Spanish (`?lang=es`). It changes nothing and refuses query capabilities. The page script clears the fragment and POSTs only on a press, with `credentials:'omit'`.
  - Headers: `default-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`, no referrer, `X-Robots-Tag: noindex`, COOP, `no-store`.
- `POST /api/org-claim/abort {org, token, confirmed:true}` needs no session, sits behind the router's same-origin check, and is never flag-gated.
  - It has its own budget: `org-claim-abort`, 5 a minute and 20 an hour per address, 200 an hour per /24.
  - Valid, used, unknown, forged and wrong-organization tokens all get the identical `{received:true}`. Only an unreachable writer answers 503, so the owner is never told a claim stopped when nothing was decided.
  - Tokens stay single use in the engine. The engine's per-claim budget only counts failures; it never refuses a valid token, so an attacker cannot use it to block the owner.

**ORG-12e, routes** (`packages/runtime/routes/orgs.mjs`):
- `GET /api/orgs/break-glass` returns the person's confirmed items. It is never gated.
- `GET|POST /api/orgs/{id}/break-glass` and `POST /api/orgs/{id}/break-glass-checkout`.
  - `start`, `accept`, `cosign` and the checkout answer the uniform 404 when the flag is off. `abort`, `withdraw`, `uncosign`, `object` and `contest` are never gated, and capacity admission treats them as protective.
  - The checkout passes `PaidCheckoutAllowed` in `routes/identity.mjs` `beforeActivity`, matched by path like `billing-checkout`.
  - For `abort`, the route adds the current session's creation time from the authenticated owner view, so a session from before T1 is tier 0 (§12d.3). Claim views carry public handles.

**ORG-12e, UI** (built by a forked UI agent against the contract above; the coordinator reviewed it and corrected the interstitial copy):
- New files: `apps/web/src/bl/org-break-glass.mjs`, `apps/web/src/ui/org-break-glass.mjs` and `apps/web/src/ui/org-claim-interstitial.mjs`, plus hunks in the console, the ownership provider, messages, `release.mjs` and `org-entry.mjs`.
- "The owner is gone?" wizard: the alternatives first (contact, transfer, the lapse claim, file recovery), then one question per step: candidate, reason, statement, then a review.
- The claim timeline, and the candidate's checkout disclosure: fee, 30 to 127 days of paid time lost, the waits, abort and contest terms, and the refund rule.
- Co-sign and object items in the personal organizations view (the person-level items).
- A member banner, the owner interstitial (Stop, Contact support, Not now), the contest entry, and a banner when the recovery file is missing. All copy is in English and Spanish.

**Readings and deviations (provisional, for review):**
1. "Co-signature items in activity centres" are the console's person-level items, not activity-v2 records. Activity v2 is app-signed, and the organization member-event transport (`ORGANIZATION_MEMBER_EVENTS`) is unwired.
2. The interstitial is probed only when organizations are enabled for the session. A claim left open after `ORGANIZATIONS_ENABLED` is turned off still reaches the owner by email, push and the abort link.
3. "Any owner-interface action" is the existing engine T14. The identity hook covers interactive sign-ins and step-ups only.
4. A notice for a replaced email still goes out while identity retains that address, about 30 days. After that the channel fails and, after 8 attempts, becomes undeliverable, which moves the claim to Track S.
5. Hints are capped at 16 per claim, to bound the record and the outbox.
6. Node's mailer is injected. A host without `sendBreakGlassNotice` accepts no email notices, so a claim there cannot take effect on Track A.

**Tests:**
- `tests/orgs-break-glass-channels.test.mjs` (12):
  - the adapter's snapshot, domains (IDNA) and notify;
  - hint convergence;
  - the engine with the production adapter, including the admin-domain rule over hashed domains;
  - the M1 acceptance gate (accepted email and push notices let Track A take effect; failing ones hold the claim);
  - hints through effect and the contest window;
  - sign-in liveness through the real identity service: waiting becomes held, gathering moves to Track S, final becomes held with the decision void; the hook never aborts, and the interstitial abort needs a known proof;
  - no-claim sign-in cost (the same identity CAS count, zero person-account writes, the organization untouched);
  - abort tokens (single use, wrong tokens identical);
  - the hint ceiling.
- `tests/orgs-break-glass-runtime.test.mjs` (2, Node runtime):
  - hints and the person route, real sign-in liveness through the person's account, the signed-in abort with and without a pre-T1 session, route flag gating, the paid-age gate and the checkout path to waiting;
  - the abort page and POST over full HTTP with no cookie: headers, GET changes nothing, cross-origin 403, identical answers for wrong, valid and replayed tokens, single use, the budget (5 then 429, per address).
- `tests/orgs-break-glass-liveness-chaos.test.mjs`, seeded. It interleaves sign-ins, step-ups, refreshes, valid, forged and raced abort links, payments, objections, withdrawals, flaky hint and mail effects, clock jumps and drains, and checks invariants L1–L6. 12 seeds by default; 100 and 150 more seeds passed once.
- `tests/worker/orgs-break-glass.test.mjs` (workerd): sign-in with the hook, the page, the POST and the budget, and uniform 404s.
- `tests/browser/org-break-glass-engine.mjs` (12, UI state) and `tests/browser/org-break-glass-browser.mjs` (16: Chromium and Firefox, en and es, light and dark, 390 and 1280).
- `tests/e2e/org-break-glass.test.mjs` (4, the real shell and the real abort page and POST): Chromium and Firefox × en/es, each at 390 and 1280 px, light and dark. Screenshots: `artifacts/browser/org-break-glass-e2e-*`.
  - Environment limitation: Playwright's Firefox loses colour-scheme emulation after the process swap that the abort page's COOP header causes (verified by removing COOP in a scratch probe). The dark colours of that page are asserted in Chromium only.

**Before production:**
- Everything listed for ORG-12a–d still applies: verified notification delivery (mail and push), verified operator identity (ORG-12d), organization terms (ORG-13) and an independent security review.
- A review of the abort-link budget figures and of the hint cap.

**Review follow-ups** (independent review, 2026-10-23: no High, 2 Medium, 3 Low; all addressed, each with a regression test that fails when its fix is reverted, checked one revert at a time unless noted):
- **M1, owner liveness could be lost.** The fire-and-forget signal swallowed failures, reached only organizations whose owner hint had arrived, and the engine read `lastInteractiveAt` only at T1.
  - At the effect, for both tracks, the organization now re-reads the owner's activity through `ownerChannels.snapshot`, outside the transaction (`stepContext`).
    - A sign-in newer than T1, every liveness already applied and any support decision is applied as T9 liveness instead of the effect (`tryEffect`).
    - `effectBlocked` refuses with `owner-unverified` when the activity cannot be read, and with `owner-active` as a backstop.
  - Liveness is idempotent (`livenessAt`). A retried or duplicate signal, or one from before the claim began, changes nothing. A sign-in older than a later support decision does not void that decision again.
  - The person-side signal is durable. Rows `orgs/break-glass-signal/<org>` (`orgs.breakglass-signal`, `orgs.breakglass-signals`) are written before delivery and removed on acceptance. The account alarm retries with backoff, giving up after 8 attempts or 7 days; the effect-time re-read still applies after that. With no hint, a sign-in still writes nothing.
  - Tests: `review M1` in `tests/orgs-break-glass-channels.test.mjs` (Track A, final, the decision-after-sign-in case, an unreadable owner); the retry-row step in `tests/orgs-break-glass-runtime.test.mjs` (first delivery fails, the alarm delivers); a directed chaos case in `tests/orgs-break-glass-liveness-chaos.test.mjs` (signals dropped, delayed or delivered; never an effect after a sign-in; at least one dropped signal caught at the effect); and `dropSignals` added to the general schedule.
- **M2, mail scanners could press the abort button.** Coordinator decision, provisional; the residual is recorded in design §12d.8.
  - Tier 0 is unchanged. The POST now needs:
    - a trusted, user-activated submit (checked in the page);
    - the organization's public handle typed as shown (the link carries `&handle=`; the server requires `confirmed` to match the identity record's handle, or `stop` when there is none);
    - a signed render time in a `<meta>` element (no inline script): POSTs within 2 s of the render, older than 2 h, or with a forged stamp are refused.
  - Residual: a scanner that runs scripts, reads the fragment, waits and synthesizes trusted input can still abort. That only stops a claim, the safe direction.
  - Tests: the runtime test (`too_fast`, `page_expired`, a forged stamp, `confirmation_mismatch`, a bare boolean); the e2e test (the button stays disabled until the word is typed; a scripted submit after the gesture expired sends nothing; mutation-checked by removing the activation guard).
- **L1, the budget could be spent from the owner's network.** The route checks the budget without spending it (`peek`) and charges only refused, malformed and failed outcomes. The writer returns `outcome` privately (`stopped` or `refused`) while the response stays `{received:true}`. An IPv6 address counts per /64 (new optional `address` in `limit`); the network window is unchanged.
  - Tests in the runtime file: four refusals, then the owner's stop from the same address, then one more refusal passes; addresses rotated inside one /64 share the budget, while another /64 does not.
- **L2, timing.** Every POST past the budget check takes at least 250 ms (`POST_FLOOR_MS`), so the response time does not tell outcomes apart. This is cheap padding, not constant-time work: the writer round-trip can still exceed the floor. Informational.
- **L3, the email subject.** The templates already said "your organization @handle" and "tu organización @handle". `tests/orgs-break-glass-mail.test.mjs` locks that: every kind, both languages, the handle never on its own, the fixed `security@` sender, no dangling handle, and link validation including `&handle=`. There was no wording fix to revert, so this test is a lock, not a revert check.

Verification (after the review follow-ups): on a machine shared with other agents' suites.
- `npm run build:assets` passed, and so did `npm run check:worker`.
- Break-glass suites (`tests/orgs-break-glass*.test.mjs` and `tests/worker/orgs-break-glass.test.mjs`): 97/97.
- `npm test`: 3,559/3,559.
- `npm run test:organizations`: node 143/143, engine 57/57, browser 130/130, e2e 10/10 (org-console 6, org-break-glass 4).
- `npm run test:worker`: 92/92.
- `npm run test:ui-state`: 448/448.
- The liveness chaos passed 80 seeds once with both cases, and 150 seeds of the general schedule once before the directed case was added.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Redirect management review fixes

An independent adversarial review of "Portability: redirect end/retarget, expiry reminder, intake gaps" found 3 Medium and 4 Low issues, plus one informational and one minor. Each is fixed and has a regression test, mostly in `tests/redirect-management-review.test.mjs` (10 tests); the passkey fix is in `tests/transfer-intake-passkey.test.mjs`. Design §6.4 records the behaviour.

**Provisional (coordinator decisions, unsigned):**
- **M1 (equivocation lockout).** A hostile former host could fork first and retarget the redirect to itself, which locked the real owner out.
  - Management now compares the presented chain with the recorded retarget's chain digests (now stored as `retarget.digests`).
  - If they diverge after a common prefix (so the record comes from the same source), and the divergent record is validly attested by that source, that is spec §8.4 equivocation evidence. Either action then ends the redirect as `contested`.
  - Both statement digests are recorded on the tombstone (`moved.contested` and the audit). A contested end is never revived; support decides.
- **M2 (refund after an early end).** An ended record used to drop the order digest after a few days, so a late event for the settled order was refunded in full.
  - The ended stub keeps an address-free marker `{endedAt, until, early?, settledOrder?}` for 400 days. The purged tombstone keeps it too, as `movedSettlement`, and `endMoved` prunes it afterwards.
  - Late events for a settled order are ignored.
  - ~~The "refund only orders paid after the stop" rule (applied after early ends only)~~ is removed by re-review R2-5 (below): any order other than the settled one is refunded.
  - Polar's refund and update horizon was not checked against its documentation; 400 days is an assumption.
- **M3 (ending after an intermediate host lapses).** The owner could not end the redirect once a host between us and their current host had disappeared.
  - Ending now needs only the signature proof: our record at its position, and every later statement signed under keys continuity-linked from the key that actually signed our statement, as the signed-in host lists them.
  - Intermediate attestation and let-go failures are tolerated, because ending fails safe. Retargeting keeps the full proof.
  - Also fixed: the host's lineage key under our signer's kid is now checked against our statement's signature, so a reused kid name no longer passes.
  - The automatic end after 30 days of 404/410 at the target is implemented: a daily `moved-probe` due row, `target-gone`, not revivable. Unreachable never counts as gone. It is wired on the Worker and Node sweeps.
- **L1.** The Node egress now passes through an allowlisted request Content-Type (`application/json`, `application/x-www-form-urlencoded`). A sign-in has been run end to end over it against the mock provider.
- **L2.**
  - The sign-in's `BindleClient` fetches go through `budgetedEgress`, which spends the portability per-site and global budgets before any request and adds a deadline.
  - The portability client and limiter are built once per egress port, using the fleet `ABUSE` limiter when present.
- **L3.** Any reminder send that does not throw counts as sent. The attempt is claimed (`state: 'sending'`) before sending, and only a `failed` attempt is retried, so a crash between sending and recording never sends a second email.
- **L4.** A former host, or a holder of the signing key, can end the redirect before any retarget, and after a retarget only with a chain that extends the recorded one (re-review R2-1; documented residual).
  - The verified current owner can revive an owner end with a full-proof retarget, within the 7-day settlement window and before the original expiry. The deleted reminder email stays deleted.
  - Destination key thumbprints are now kept until the record goes, so a revival is not first use.
- **Info.** The redirect transaction is sealed under an HKDF-derived key with a purpose-specific AAD. A record sealed with the shared credential key is refused.
- **Minor (passkey intake).** A fresh challenge for an existing reservation now re-runs the source check and the unattested prompt. Admission and the reservation are still not spent again.

Existing tests changed where they encoded the old behaviour:
- due rows now include `moved-probe`;
- an end can be revived;
- equivocation now ends the redirect as contested rather than refusing;
- an unattested key holder can end, but not retarget;
- the reminder records its state.

**Gates:**
- Portability suites: 242/242.
- `npm test`: 3,550/3,550.
- `npm run test:ui-state`: 448/448.
- tests/browser/transfer-browser.mjs: 24/24.
- `npm run test:worker`: 92/92.
- `npm run check:worker` failed during this run on a syntax error at `packages/runtime/account/orgs.mjs:149`, which another agent is editing concurrently; none of this round's files are involved.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-23 — Redirect management re-review fixes (round 2)

A re-review of "Redirect management review fixes" closed M1, M2 and L1. It found two new Medium issues introduced by those fixes, and three Low ones. The repros now fail as attacks, and the regressions are in `tests/redirect-management-review.test.mjs` (5 new tests, 15 in total).

**Provisional (coordinator decisions, unsigned):**
- **R2-1 (Medium): a former host could end a retargeted redirect without keys.** `verify` returned early for `end`, before the stale-length check.
  - Now every action must present a chain that extends the recorded retarget's digests. A shorter chain is refused as stale.
  - A divergence attested under rooted keys ends the redirect as contested. Any other divergence is refused, not ended.
  - The L4 bullet of the earlier entry is corrected to cover key holders after a retarget.
- **R2-2 (Medium): a hostile former host could revive the owner's end to itself.**
  - The end now records `endedProof`: the head seq and the digests of the records after ours. It is address-free, and keeps the longer of the ender's chain and any recorded retarget.
  - A revival must extend it. A revival chain shorter than the ender's is refused.
  - An attested divergence marks the ended record contested, so it can never be revived. Any other divergence is refused.
- **R2-3 (Low): a contested end could be forced through first-use keys.** Equivocation evidence now counts only when the attestation verifies under a preconfigured root or a pin not made on first use. Retargets store the rooted keys they verified (`retarget.keys`), and those keys feed later checks.
- **R2-4 (Low): the 404 probe was too loose.**
  - The probe now needs at least 3 gone answers, none more than 3 days apart, spanning 30 days.
  - Live or `invalid` answers reset it, and so does a gap.
  - A retarget or a revival deletes the probe state, and a revival re-arms the probe row.
- **R2-5 (Low): the `paidAt < endedAt` rule is dropped.** Any order other than the settled one bought nothing and is refunded. The earlier "Redirect management review fixes" entry is reconciled; the marker no longer carries `early`.

**Gates:**

- Portability suites: 247/247 (chaos suites also run at CHAOS_SEED 1, 100, 1000 and 5000).
- `npm test`: 3,558/3,559. The one failure is `tests/orgs-break-glass.test.mjs` "T10: an email abort link works once…". That test imports no portability module, and the files it exercises (packages/orgs/*, owner-channels) are being edited concurrently by another agent.
- `npm run test:worker`: 92/92.
- `npm run test:ui-state`: 448/448.
- Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — Pending sign-off digest

[Pending sign-offs](docs/release/pending-signoffs.md) collects every provisional decision, number and open question from the entries since 2026-10-22 that awaits the owner. It also includes the earlier unsigned items those entries still refer to: organization prices, BG-1 to BG-17 and P14–P19.
- **Structure:** a highest-impact list first. Then 99 items in nine areas (pricing/billing 12, identity and recovery 10, portability 11, organizations and break-glass 26, messaging and conversations 8, app platform/AI budget 11, region and legal 8, UI 7, operations and limits 6). It ends with a list of unverified external assumptions (Polar semantics, Clef billing, Cloudflare `request.cf`, mail and push delivery, and others).
- **Item format:** each item gives the decision, value, reason, source entry and any recorded safe alternative, with a blank owner line.
- **Status:** it is a digest only. DEVLOG stays the source of record, nothing in it is signed off, and decisions from before 2026-10-22 stay in [open-items.md](docs/release/open-items.md).
- **Scope:** documentation only. No code changed and no tests were run.
- **Update (same day):** the digest now covers ORG-10 relations (RL-1 to RL-17 and Q21, as OB-27 to OB-44) and AU-S6 (AP-12 to AP-14, plus the privacy.md "App storage summaries" bullet as RL-9), for 121 items in all. OB-11's passkey gap is marked closed in code: `organizationVerification` → `recoveryReissueBegin` `passkey_required`, and the identity-wargame2 test was re-run 1/1.
- **Update 2 (same day, HEAD 6bbae45):** the digest now also covers UI quality pass 3, scalability fixes round 2, ORG-12d support adjudication and the operator/lifecycle wargame fixes, with their follow-ups: 27 new items (ID-11, OB-45 to OB-52, MC-9, AP-15, AP-16, UI-8 to UI-11, OL-7 to OL-17), 148 in all, two new highest-impact entries (AP-15, OB-45) and new unverified external assumptions. Documentation only; nothing signed off.
- **Update 3 (2026-10-26, HEAD b09140b):** the digest now also covers break-glass and ownership outbox scaling, ORG-10a-g relations, the drift audit, test reliability fixes, the RTC signaling design and the Beam removal: 50 new items (OB-53 to OB-70, MC-11 to MC-15, RTC-1 to RTC-17, AMD-X1, AMD-R1 to AMD-R6, OL-18 to OL-20), 200 in all including the hand-added MC-10 and AP-17. It adds a section of four open scope questions (SQ-1 to SQ-4), three highest-impact entries (RTC-6, AMD-X1, SQ-1) and new unverified external assumptions. Documentation only; nothing signed off.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — AU-S6 producer summary, What's left and removal reminders

Implemented local AU-S6 Engine queries/actions, with thin owner HTTP and English/Spanish connections views. Hosted and writable gateway-managed Google Drive writes embed producer connection/generation in their existing object metadata: no additional per-object write and no separate file-name ledger per app. Remaining-data queries derive counts and bytes by resource and top-level prefix, excluding overwritten objects attributed to other producers. Account exports include aggregate producer summaries and removal history; privacy wording and the [design status](docs/architecture/app-uninstall.md#9-implementation-slices-non-overlapping-ownership) now describe the implementation.

Owners can keep data, open the account export tools first, or advance bounded deletion through existing executors. Persisted per-resource checkpoints remain discoverable after reload; retries after a crash safely resume. Producer generations through the removal's generation include data from before suspend/resume, while subsequent reinstall generations are excluded. Hosted deletion rechecks the exact object version inside its final transaction; Drive already checks it transactionally. Drive's existing immutable-version retention remains in force and is disclosed in the view. Export-first opens the existing reviewed export flow; it does not claim an archive has already been generated.

Open removals retain the three existing reminder times. The configured fixed account-email sender and fresh verified contact projection now supplement best-effort push. Activity-centre entries derive from durable reminder notices and load with the activity view. Each notice reserves its attempt before external I/O, records channel acceptance/failure/unavailability or an unknown crash outcome, and never claims delivery. Dedicated Node/Worker mail and identity ports do not depend on enabling account-lifecycle jobs. Missing mail/push configuration still leaves console and activity notices available.

**Provisional (coordinator decisions, unsigned):**

- Deriving aggregates from existing durable hosted/Drive indexes replaces the design's proposed minute/64-write counter flush. This satisfies RR1-M7 without a second hot-path write or a new file-name log. Summaries cover current managed objects only, starting with newly attributed writes; older unattributed objects, other providers, retained Drive versions and app-held copies are outside the count. No external cleanup or production conformance is inferred.
- Summary requests scan at most 5,000 existing records, using internal pages of at most 200; display buckets are bounded to 64 prefixes plus other per resource. Deletion defaults to 64 scanned records, at most 200 per action. A bounded continuation checkpoint may contain an existing index position; it is not an accumulating object ledger. Counts describe the current page rather than a complete historic inventory.
- Removal reminder activity queries return at most 100 entries and scan at most 500 notices per request; the activity view initially requests 50. Push remains bounded to ten subscriptions. Existing removal-history retention and production gates remain unchanged.

Local agent cross-review on 2026-10-24 checked storage fencing, runtime callback wiring, export projection and reminder contacts. It found and prompted fixes for persistent deletion-resume visibility, Drive retention disclosure and automatic activity loading. The initial synthetic chaos coverage was supplemented with actual hosted writes, Engine force removal, real connection registration/disconnect/reinstall, crashes after deletion transactions and Engine/service reconstruction. These checks are implementation evidence, not human sign-off.

**Final validation:**

- `npm test`: **3,587 passed, zero failed**, zero skipped.
- `npm run test:worker`: **92 passed, zero failed**, zero skipped, including workerd adapters.
- `npm run test:ui-state`: **451 passed, zero failed**, zero skipped.
- `npm run build:assets`: passed; `npm run check:worker`: passed (dry run only).
- Removal browser suite: **26 passed, zero failed**, zero skipped, Chromium and Firefox; includes English/Spanish remaining-data checks and narrow-screen overflow checks.
- `CHAOS_SEED=74193 node --test tests/engine-producer-summary.test.mjs`: **21 passed, zero failed**. Covers attribution/overwrites, bounded pages and deletion, crash recovery, suspend/resume and reinstall generation fences.

No commit or deployment. Production release remains disabled; mail/push delivery and provider conformance remain unverified. Concurrent organization documents and the pending-signoff digest were not edited by this workstream.

**Review follow-ups (2026-10-24, provisional, unsigned).** A review of the uncommitted AU-S6 work found issues, all fixed here. Each fix has a regression test that was checked to fail when the fix is reverted (in a scratch copy of the tree, not in place). Design notes: [AU-S6 review follow-ups](docs/architecture/app-uninstall.md#9-implementation-slices-non-overlapping-ownership).

- **M1, an old write could reappear after deletion.** Hosted commits now re-check the write condition, usage and the writing app connection's status and generation inside the commit transaction. Drive publication re-checks the connection too. A blob written for a commit that fails is queued for garbage collection. A completed deletion pass is no longer terminal: a later Delete starts a new pass, and the pass count is recorded. Tests stall the blob write and the Drive upload on a deferred promise.
- **M2, privacy.** The privacy bullet now states what is recorded: which app connection and top-level folder wrote each file, which app created it, and how long the markers last. It also states which transports are covered. **This is draft legal text awaiting owner approval.** Markers are removed from `hosted_catalog` SQL rows, owner object pages, read results and `drive/retained/` rows, since deletion does not need them there.
  - *Provisional deviation from RR1-M7's privacy intent:* keeping a marker on each object record, instead of keyless per-prefix counters. The earlier bullet's claim that this "satisfies RR1-M7" is superseded.
  - *Deviation from §6.3, not implemented:* stripping markers when the owner dismisses the page. There are no separate summary rows, and a removed resource's records keep their markers until deleted.
- **M3, last-writer attribution.** Records now keep `createdBy`, preserved when the file is overwritten. By default, Delete removes only files the app created. Files the app last changed but did not create are skipped and counted, unless the owner explicitly chooses "Also delete files this app last changed". The UI copy distinguishes the two.
- **L1, MCP coverage.** MCP storage writes are now attributed to the MCP connection already verified by the account's `mcpOperation`. Browser automation writes are not attributed, and the UI and privacy text say so.
- **L2, undeletable storage.** Disconnected storage, or storage that needs reconnecting, is shown as "not deletable here", and per-resource Delete refuses it. Skips are counted by reason: changed, kept, unavailable, failed and conflict. Permanent executor errors (retention_limit, forbidden, object_limit, invalid_record, reauthorization_required) are counted and checkpointed past; transient errors still stop the batch.
- **L3, keep.** Keep choices are stored under `storage/producer-keep/`, separately from deletion jobs. Keeping stops an unfinished deletion of the same scope. A keep protects the kept generations, by last writer or creator, from a later removal of a reinstall of the same app. The protection lifts only when the owner chooses again (an explicit opt-in to delete kept files), or when they delete under the same removal, which supersedes its own keep.
- **L4, activity reminders.** The reminder refresh now checks the account id, the beam generation and offline state, as well as the ticket. The "Review and remove now" link uses the server's `item.path` only when it is a `/console` path for the current account; otherwise it falls back to `/console?account=<id>&view=connections`.
- **L5, export.** `storage/producer-deletion/` and `storage/producer-keep/` are exported with the removal history (the `app-removals` contributor), without the stored continuation position. The cursor-sealing key is an explicit secret exclusion.
- **I1, cursors.** Summary cursors are AES-GCM sealed with an account-local key and bound to the owner and the removal. Deletion jobs keep their position server-side and never return it to the client. Reminder-list cursors still carry notice keys, which contain no object names; this is unchanged.
- **I2, object pages.** `ItemIndex.objectPage` strips markers, including from older catalog rows.
- **Chaos test.** The test now interleaves writes from the removed app, another app, the owner, unattributed older rows and a reinstall with bounded deletion, across both the hosted and Drive adapters. It also covers executor crashes after the effect and stalled writes that straddle the removal. It checks these invariants after every step:
  - every write outside the deletion target is preserved at its exact version;
  - `totalDeleted` equals the deletions actually committed (it is counted inside each adapter's delete transaction);
  - the final passes leave no data from the removed app;
  - retained Drive rows carry no markers.
- **Not done:** the reminder-cursor change described under I1.

**Re-review follow-ups (2026-10-24, provisional, unsigned).** A re-review closed every earlier finding and raised four more. All are fixed, each with a regression test that was checked to fail when its fix is reverted (in a scratch copy of the tree):

- **Leftover data after pruning (Low/Medium).**
  - When a forced or completed removal record is pruned (`prune` in `packages/app/domains/app-removal.mjs`), a lineage row (`storage/producer-lineage/`) records its connection, generation, client and state. What's left stays reachable and deletable under the same removal id, and the removal list shows it as `pruned`.
  - Each removal alarm runs one bounded sweep batch of 200 rows (`collectMarkers`). It strips markers covered only by pruned lineages, not by a retained removal record or an active keep, and writes only to objects whose markers change. An idle sweep does no scan.
  - When a pass completes, the sweep deletes each swept lineage with its keep and deletion rows, unless an active keep refers to it. In that case the lineage stays, marked swept, until the owner chooses again.
- **Keep and deletion rows (Low).**
  - A keep must name a current storage binding or a resource present among the removal's attributed rows.
  - Keeps are capped at 128 rows per removal. The connection-wide fail-closed cap of 1,000 is removed; keep rows are now read page by page.
  - Superseded keep rows and finished or stopped deletion jobs are pruned when their removal's lineage is swept.
- **Kept files the app only changed (Low).** Kept counts are split into created and changed. A new combined action, "Delete, including kept files and files this app only changed", sends `includeKept` and `includeChanged` together. The UI offers it only when kept-but-changed files exist.
- **Privacy wording (Low).** The bullet now matches the code:
  - the installation generation is recorded;
  - the export contains aggregate counts by last writer plus keep and delete decisions, not the per-file markers;
  - markers last until the removal history is cleared (90 days after conclusion, or beyond 100 concluded removals), then are swept unless kept;
  - an active keep lasts until the owner chooses again; other decision rows go when the history is cleared.

  **This is still draft legal text awaiting owner approval.**
- **Retention (added to the deviation list).** Per-object markers of a removed app's generations last while the removal record is retained, then until the next sweep pass completes. Markers covered by an active keep, and that keep's lineage row, last until the owner chooses again. Lineage rows are derived pointers and are excluded from the export, with a recorded reason; the keep and deletion decisions are exported. A fourth export prefix would also add an export step, which pushed `tests/dx-integration.test.mjs` past its 60-alarm loop.
- **`scratchpad/probe.mjs`.** It now fails with `invalid_token`. This is intended: it writes on behalf of an app connection that has no record, and attribution now fails closed.
- **Re-review validation (2026-10-24):**
  - `npm test`: 3,589 passed, zero failed, zero skipped.
  - `npm run test:worker`: 92 passed.
  - `npm run test:ui-state`: 463 passed.
  - App-removal, activity and connections engine tests: 49 passed.
  - App-removal browser suite: 26 passed.
  - `npm run build:assets`: passed.
  - One earlier full run had a single `tests/dx-integration.test.mjs` failure, caused by the fourth export prefix. After that prefix was removed, the file passed alone, in combined reruns and in the full rerun above. Its 60-alarm loop leaves little headroom.

**Follow-up validation (2026-10-24):**

- `npm test`: **3,584 passed, zero failed**, zero skipped. This is lower than the earlier 3,587 because the producer-summary file was rewritten: 18 tests replace 9 tests plus 12 synthetic chaos subtests.
- `npm run test:worker`: **92 passed, zero failed**, zero skipped.
- `npm run test:ui-state`: **452 passed, zero failed**, zero skipped.
- App-removal engine and activity engine: **25 passed, zero failed**.
- App-removal browser suite (Chromium and Firefox): **26 passed, zero failed**, zero skipped.
- `npm run build:assets`: passed.
- Extra `CHAOS_SEED` runs (7, 100, 4242 and 77777) of both chaos tests passed.

Local evidence only; no human sign-off.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — ORG-10 relations design

**Design only** ([organizations design §8b](docs/architecture/organizations-design.md#8b-org-10-and-org-11-relations-design-for-implementation-rev-56), rev 5.6; [spec](docs/spec/organizations.md) rev 4.5). No code changed. Nothing is implemented, routed or production-verified, and no tests were run. Every item is **provisional** (coordinator, not signed off by the user). It covers ORG-10 (same-provider relations) and ORG-11 (cross-provider relations).

**Kept as settled:** relations are the user's design (§1b, §8a): relationships between organizations, with membership, grants and governance internal (user, 2026-10-22). A public relation document sets slots, arity and an access matrix, and grants nothing by itself. Each edge needs consent from both sides, recognition is per edge, partial membership is normal (user, 2026-10-21), and there is no central host. Business relationships such as parent and subsidiary, vendor and customer, partners and client and firm are relation documents, not built-in kinds.

**New in §8b:**
- **Who establishes relations (3sln.me):** any admin whose governance is not held. Widening outward or accepting inward needs a fresh step-up, the full matrix disclosure, notice to every admin and an audit entry. Narrowing (suspend, end, decline, leave, withdraw) is immediate and needs no consent. There is no subject-first step and no owner elevation: no member's grant-management grant and no control changes, so it is the same act as approving an integration. Changing who may manage relations stays under §12b.
- **What an edge grants:** only its consented fragment grants. Inside the grantee, use goes through the grantee's own member grants, member certificates and entity certificates. No governance, no membership, no transitivity, no onward sharing.
- **Privacy:** only counterparts see a relation. Other members see only the imports they hold grants on, applications learn the grantor of resources assigned to them, and introductions are limited.
- **Lifecycle:** suspend, end and expiry; billing read-only and export-only; transfer (no effect); recovery and break-glass (`aep` at effect); deletion (pre-purge leave); counterpart unreachable; moves in both directions; counterpart authority reset; key compromise.
- **Abuse cases:** request floods, event floods, impersonation, lookalike documents, stale relations after a move, privilege laundering through chains, insider exfiltration, pipeline injection, counterpart takeover, arity squatting, fan-in exhaustion.
- Alternatives considered, and decisions **RL-1 to RL-17** (§8b.9, Q21).

**Spec rev 4.5 (narrow, interop only):**
- **New §9.9, relation events.**
  - **Signing:** each event is signed by the sending entity's certification key with `typ` `bindle-relation-event+jwt`, and its event types are a registry of their own.
  - **Endpoint:** the endpoint comes only from the counterpart issuer's manifest (`relations.v1` `events_endpoint`).
  - **Verification:** no request-path fetch, a uniform `202`, a `jti` recorded only after verification, and per-half generation ordering in which an end is final.
  - **Edge state:** `relation-edge-state` tells the grantee the grantor's resource IDs.
  - **Recovery of lost events:** daily anti-entropy re-sends.
- **Participation statements are fresh-only** (300 s), with the recovery-file-holder residual stated.
- Invitation withdrawal, instance identifiers with at least 122 random bits, a privacy item, conformance tests and checkpoint O7.

**Decisions for the user, notably:**
- RL-2: any admin establishes relations, with no owner elevation.
- RL-4: a counterpart's authority reset holds outgoing edges until an admin confirms, and an attested move holds writes only, for 72 h.
- RL-5 and RL-6: event signing and the issuer-level events endpoint.
- RL-8: no transparency log is needed for ORG-11, because each instance pins the relation digest.
- RL-11: limits.
- RL-17: on 3sln.me v1, relations are between organizations only, while the spec still allows persons as parties.

**Phase labels:** the request called this phase B work, but design §13.3 has ORG-10 in phase C and ORG-11 in phase D. The release gates are unchanged, and implementation may start behind default-off flags (RL-1).

**Implementation plan (§8b.10):**
- **Slices:** ORG-10a to 10g (documents; instances and invitations; edges and imports; entity certificates; events and lifecycle; engine, account and routes; console) and ORG-11a to 11c (transport; moves and resets; a clean-room conformance peer).
- **Flags:** `ORG_RELATIONS_ENABLED`, and a new kill switch, `ORG_FOREIGN_RELATIONS_ENABLED`, both default off. Narrowing is never gated.
- **Engine operations:** listed in §8b.10.
- **Tests:** engine tests, seeded chaos with invariants C1 to C10 (including no transitivity, effective access within every ceiling, and convergence under event loss and reordering), named adversarial cases, and browser tests.

**Review:** a forked adversarial review (RL-R1) found 3 High, 8 Medium and 6 Low issues, all applied (§8b.11):
- **H1:** request-path fetches leaked participation through timing.
- **H2:** no message carried the grantor's resource IDs to the grantee.
- **H3:** the exemption for attested moves allowed a takeover with a stolen recovery file.

The pending sign-off digest (docs/release/pending-signoffs.md) was not updated; RL-1 to RL-17 still need adding to it.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — UI quality pass 3 (browser probe round 3)

**Implemented locally, provisional and unsigned.** Addresses M1–M7 and L1–L11 from the third browser probe. Existing 3sln/dodo/Engine APIs and the vendored js-tools bootstrap remain the integration boundary. No organization documents, pending-signoff digest, or files reserved for the concurrent app-removal workstream were edited by this pass.

- **Abort notices (M1, L10).** A validated capability is retained in tab-scoped `sessionStorage` after removing the fragment, restored on reload, and cleared after a successful submission. Expired-page copy in English and Spanish directs the owner to open the notice link again. The page retains an external script and explicitly allows its same-origin icon; no inline executable script was added.
- **Organization forms (M2, L1–L4, L11).** Failed and indeterminate Start results preserve the private break-glass wizard and answers through refresh; confirmed success clears them. Member punctuation is corrected, channel counts use catalogue plural rules, the owner interstitial focuses its heading, and the admin entry's inner heading is distinct. Contest and objection reasons are textareas with bounded character counters. **Provisional dismissal choice:** “Not now” lasts until reload, explicitly stated in both languages.
- **Transfer and recovery feedback (M4, M5, L5–L7).** Every mapped transfer error has English and Spanish catalogue coverage. `step_up_required` retains the operation privately, points to the existing password/passkey security check, and retries after confirmation. Unchecking redirect clears and disables its reminder. Transfer-in shows no preparation status before starting. Unknown recovery-reissue cancellation codes use a generic translated error.
- **Presentation and localization (M3, M7, L8, L9).** The focused skip link uses paired accent tokens in both themes. Shared styles give buttons, summaries and checkbox label rows a 44px minimum height, with matching standalone transfer controls and console links. Retention formats byte plurals and rounded unit rollover, uses generic labels for unlabeled units, distinguishes empty inventory, and renders one unavailable-size message per invalid unit. Security, device, contact, notification and shortcut copy has Spanish coverage. Developer-contact rate limiting returns a code; the client translates it.
- **Firefox module loading (M6, provisional build choice).** The CSP-hashed import map is parser-visible before preloads and the classic wire-up. The build removes the generator's duplicate map installation while retaining its stylesheet and deferred-entry behavior; its actual vendored API was inspected. Hashed module preloads remain. A local agent cross-review found no actionable CSP/integration issue; this is implementation review, not human sign-off.

**Verification (shared checkout, local evidence only):**

- `npm test -- --test-concurrency=4`: **3,589 passed, zero failed**, zero skipped. Earlier unconstrained runs exposed export-sealing/CLI-range failures and an initially failing concurrent producer-summary test; those files were not changed by this pass. The final full run with bounded concurrency passes, including both export tests. These results do not establish that the unconstrained suite is free of intermittent failures.
- `npm run test:ui-state`: **463 passed, zero failed**, zero skipped (latest run includes a concurrent added test).
- `npm run test:organizations`: **340 passed, zero failed**, zero skipped across its four subprocess suites.
- `npm run build:assets`, twice: passed; **453 identical file paths and SHA-256 digests** across the complete public output.
- `npm run check:worker`: passed, **dry run only**.
- `npm run test:worker`: **92 passed, zero failed**, zero skipped.
- `npm run test:e2e`: **308 passed, zero failed, four skipped** out of 312 tests across its subprocess suites. Skips are optional WebKit checks: that executable is unavailable. Requested Chromium and Firefox coverage ran.
- Supplemental native round-2/round-3 matrix with portability enabled: **34 passed, zero failed**, zero skipped. Chromium and Firefox, 390×844 and 1280×900, light/dark, English/Spanish; focused skip-link contrast ≥4.5:1, 390px console-tour target heights, zero console errors/404s/unhashed module requests on console and transfer pages. Firefox resets media emulation on navigation to an isolated transfer document in this environment; the new matrix reapplies and asserts the requested scheme after navigation. Screenshots are under `artifacts/browser/round3-*`.
- Transfer fixture suite: **24 passed**; transfer engine suite: **17 passed**. Organization browser matrix: **16 passed**, including interstitial focus and reason counters. `git diff --check`: passed.

No commit or deployment. Production release remains disabled. These are local browser/Worker/Node results; external notice delivery and provider conformance remain unverified. All choices above remain provisional pending review.

Reviewer: ___ Date: ___ Outcome: ___


## 2026-10-24 — Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)

**Implemented locally, provisional and unsigned.** Finished and reviewed the interrupted work already present in the shared checkout. Covers probe cliffs #3–#9; #1/#2 and the concurrent organization/admin/flags work remain outside this workstream. No commit or deployment. Production release stays disabled; local adapter behavior is not external-service configuration, delivery or production/provider conformance.

**Provisional decisions and implementation:**

- **Producer history and traversal (#3, #9).** Transactional connection/generation pointers index last writers, distinct creators, live removals, pruned lineages and active keeps by resource and generation. Objects/removal decisions remain authoritative. Summary reads at most 5,000 target pointers/objects; deletion and marker collection process at most 200 target objects. Keep lookup uses the newest relevant choices, excluding the current removal where required, rather than loading a connection's history. Marker context uses bounded generation lookups per marker; finished lineage/keep/job cleanup is bounded. Cross-removal keeps retain their own cleanup coverage until superseded; wrapping the pending cursor catches earlier newly queued lineages. Legacy attribution indexing advances 200 rows per call; owner requests explicitly retry while building, and marker alarms return unfinished and reschedule. Node metadata listing now starts at the greater of prefix and cursor, avoiding a cursor predicate that could scan earlier unrelated keys.
- **RR1-M7 deviation, requiring review.** The earlier marker-on-object deviation remains; derived per-object path pointers add another provisional privacy/storage/write-amplification deviation. The account metadata is a portable ordered key/value store; on Workers it is the Durable Object storage KV API, whose values are not addressable from SQL, so selecting a JSON attribution field would traverse unrelated objects. This implementation therefore uses pointers in the same transaction as the authoritative record. (Corrected by review follow-up 6 below: expression indexes are not Node-only. Durable Object SQLite supports them on ordinary tables, but not on the KV API's backing table.) Equal writer/creator pointers are deduplicated (one pointer for the ordinary creation case); a distinct creator can require a second pointer. Unchanged attribution does not rewrite pointers. Pointers contain existing record paths, no contents, and have no external provider index or production API. They live under the existing derived/transient `storage/producer-gc/` family; conversation maintenance uses the existing transient `conversation/sweep/` family, so export files were left untouched. These choices are provisional, not approval of an RR1-M7 exception.
- **BindleBox timeline and replay expiry (#4).** Persisted causal ordering uses a resumable materialized Kahn traversal, exact event-ID tie ordering and missing-parent tracking. Late parents, edits/retractions and delegation quarantine invalidate the generation; an incomplete generation returns `conversation_index_building`, never a partially ordered/partially quarantined page. A safe dependent-message append avoids rebuilding an already exact order. Pages read the requested projection plus bounded revision/body lookups. Replay deadlines are indexed transactionally, legacy replay rows migrate in 32-row slices, and sweeps use deadline/room cursors. Test fixtures explicitly drive resumable reads; direct-operation tests continue to meter each request.
- **Legacy conversations (#5).** Collected rooms leave resumable history-cleanup jobs. Reinvitation cannot race unfinished history cleanup. Dead letters have peer/oldest and expiry pointers; replay receipts have expiry pointers. A shared sweep budget covers migration, cleanup, deadlines and rooms, with continuation alarms; future receipts cannot starve room collection. Peer recovery queues bounded redrive jobs rather than scanning all dead letters, and rechecks the indexed peer/code in the transaction. Fixed a partial-budget cleanup bug from the interrupted implementation that could discard a job before all history was removed.
- **Retention totals (#6).** SQL catalog triggers maintain item contributions and per-unit totals with each insert/update/delete, atomically with catalog mutations. Owner/collection moves and object changes remove the old contribution and add the new one. Existing catalogs backfill at most 200 source rows per call, safely interleaved with writes/deletes/moves. Ordinary inventory has no message-wide GROUP BY; audit tests retain the full aggregate as an independent oracle. Existing exact-accounting reconciliation, unknown-size behavior and monotonic retention deadlines are preserved.
- **Key tombstones (#7).** Exact SHA-256-addressed membership rows compare actual kids (no Bloom filter), alongside an append-page pointer and bounded archive pages. Both legacy layouts migrate once atomically before relying on the index. **Cold migration is deliberately not bounded:** 12,800 old kids read 131 list rows plus 12,813 gets / 519,664 bytes on the first prune. Subsequent absence/prune never rereads all archive pages. The added exact-membership rows are an explicit storage/write tradeoff for anti-reuse lookup work.
- **Directory working set (#8).** Compact identity/key verification material has a byte/entry-bounded cache independent of disposable full documents/move history. Background verification refresh can reuse compact material; full-history callers still fetch the complete document after eviction. Existing freshness, refresh-ahead, durable pin and revocation bounds are unchanged. Each tier retains its documented cap; combined memory can exceed the former single-tier cap, and serialized-byte accounting is not heap RSS.

**Before/after local probes:** original evidence is `scratchpad/scale2/REPORT.md`; final scripts, JSON, logs and report are under `/private/tmp/claude-501/-Users-raystubbs-Projects--3sln-3sln-me/8f763b0e-277c-4c0c-b7f0-8c3d4fc70450/scratchpad/scalefix2/`. `run-final.py` uses the original `common.mjs` metering and 115-second subprocess timeout; all seven final scripts exit zero. Rows below count list-returned values; bytes include successful point gets. These are not physical SQL read counters. Point-get counts and full timing/migration limitations are in that report.

| Scenario | Before rows / read bytes / ms | After rows / read bytes / ms |
|---|---|---|
| Marker batch: 200 objects, 5k lineage + 5k keep history | 10,200 / 971,670 / 82.303 | 1,001 / 171,133 / 38.633 |
| Full summary: 50k objects across 10 apps | 50,000 / 9,039,868 / 466.129 | 5,000 / 1,049,073 / 61.638 |
| Remaining deletion pass: same fixture | 49,800 / 11,405,312 / 600.382 | 4,800 / 3,515,161 / 365.455 |
| BindleBox page40: 10k events | 10,000 / 5,691,012 / 46.815 | 40 / 9,894 / 1.044 |
| BindleBox idle sweep: 10k replay rows | 10,001 / 290,330 / 12.739 | 2 / 638 / 0.084 |
| Legacy collect room: 1k history refs | 1,001 / 177,554 / 8.932 | 1 / 565 / 0.436 (cleanup resumes later) |
| Legacy redrive: one free slot, 4,939 dead tasks | 2,111 / 3,115,325 / 18.913 | 64 / 93,575 / 0.632 (one actually moved) |
| Retention: 100k messages, 10 units | 10 returned; 100k SQL inputs inferred / 338 / 75.564 | 10 totals / 338 / 0.102 |
| Warm key absence: 12,800 tombstones | 104 / 507,182 / 2.158 | 4 / 1,303 / 2.127 |
| Warm key prune: same history | 331 / 1,526,374 / 12.163 | 31 / 8,936 / 0.855 |

At 5,000 maximum-size directory documents, verification entries improve **323 → 5,000**, evictions **4,677 → 0**, verification-cache serialized bytes **49,282,048 → 1,655,000** (full documents now have their separate capped tier). Fixed-size target/history regressions establish flat rows/bytes with unrelated growth. Marker probe seeding was corrected to select a lineage actually owning all 200 objects first at every scale; its summary target now matches those objects, whereas the original history-summary fixture matched none. Dirty timeline/replay/dead-letter indexes are warmed through their bounded migration before steady-state measurement. Initial probe runs overlapping full suites were materially slower; reported wall times are the final rerun after suite completion, not production throughput guarantees.

**Regression and security evidence:** `tests/producer-scale-work.test.mjs`, `tests/bindlebox/conversations-scale.test.mjs`, `tests/retention-totals-scale.test.mjs`, `tests/identity-directory-scale.test.mjs` and `tests/worker/retention-totals.test.mjs` cover every requested cliff with metered row/byte bounds. Additional checks cover pointer rollback/overwrite/delete, resumable legacy migration, keep coverage after supersession, exact late-parent order and quarantine invalidation, cleanup convergence, room-sweep fairness, actual target-peer redrive, exact anti-reuse after migration, directory expiry and seeded accounting chaos with moves/deletes and rollback. The workerd totals regression asserts flat **actual SQL cursor rowsRead** at 100 versus 10,000 messages. Existing generation-fence, created-file-only default deletion, explicit changed-file opt-in, consent/quarantine, retention-deadline and anti-reuse suites pass.

**Final verification (shared checkout, local evidence):**

- `npm test`: **3,621 passed, zero failed**, zero skipped.
- `npm run test:worker`: **93 passed, zero failed**, zero skipped.
- `npm run test:ui-state`: **471 passed, zero failed**, zero skipped.
- `npm run test:bindlebox`: **226 passed, zero failed**, zero skipped.
- `git diff --check`: passed. No native-browser UI changes were made by this workstream; UI-state/DOM coverage ran. The Worker suite includes actual workerd, and probes use the real local SQLite adapter; external delivery and provider conformance remain unverified.

Earlier runs exposed the interrupted implementation's export-inventory namespace omission and the archive fixture's missing timeline-build retry, both fixed here without editing export implementation. An overlapping run also observed a transient syntax error and later a registry superclass mismatch during concurrent flags edits; a focused rerun and the final full suite pass after that separate work settled. Reserved organization/admin/flags/export/service-worker/Drive implementations were not edited by this workstream. All design choices above await reviewer/date/outcome sign-off; no approval is inferred from passing tests.


**Review follow-ups (2026-10-24, implemented locally, provisional and unsigned):** these fix review findings on this entry. No commit or deployment. For every code item, a check in a scratch copy of the tree confirmed that the new regression test fails once that fix is reverted.

1. **M1: legacy conversation receipts were never collected.** `conversationInbox` (`packages/conversations/runtime.mjs`) wrote `conversation/inbox-message/` receipts through the raw account store, bypassing ConversationService's wrapper, so the post-migration sweep never saw them. The due/dead-peer projection wrapper is now `conversationIndexedMetadata`, an idempotent Proxy exported from `packages/conversations/index.mjs`. AccountController applies it to its whole metadata store, outside the producer and intent wrappers, the same way `producerIndexedMetadata` is applied. ConversationService still applies it for standalone stores; the wrapper returns an already-wrapped store unchanged. Audit: no other writer of indexed families (`conversation/dead/`, `conversation/inbound/`, `conversation/inbox-message/`) exists outside ConversationService. Rooms and history rows are not indexed families. Shelving delete/restore now passes through the wrapper and rewrites the same projections idempotently. Regression: `tests/conversations-receipt-index.test.mjs` drives the real runtime write path after the index migration finished, then checks both the due pointer and collection after retention.
2. **L1: BindleBox archive import bypassed the new indexes.** `applyBatch` in `packages/bindlebox-engine/domains/archive.mjs` now writes `replayDue` for each imported `conv/replay/` row and calls `dirtyTimeline(tx,cid)` for each imported `conv/event/` row. Missing-parent markers are timeline-derived and not archived. Invalidation forces the rebuild, whose clear phase removes stale `missing/` markers and whose scan recomputes them. The live fast-path append runs only on a `ready` state, so it never trusts markers from before the import. Regression: `tests/bindlebox/archive-scale-review.test.mjs` uses a new mailbox that already migrated replay rows and holds a ready, empty materialized order.
3. **L2: `knownResource` for apps with more than 5,000 objects.** It now runs a bounded per-resource probe instead of reading the connection's first 5,000 pointers, and adds no pointer family. It skips from generation to generation through the existing `producer/<connection>/<generation>/` pointers and lists only this resource's encoded `hosted/` and `drive/object/` path ranges in each generation, checking at most 4 pointers per range (`PROBE_POINTERS`). It visits at most 64 distinct writer generations (`PROBE_GENERATIONS`) and fails closed (`not_found`) past that. This is a documented bound, not a full guarantee. Regression in `tests/producer-scale-work.test.mjs`: 5,001 objects in another resource, with a later-generation negative case.
4. **L3: redrive dropped its job early.** When a full page of expired backlog sat at the head of the peer index, `redrive` moved nothing and the job was deleted. `redriveBatch` now reports `more` when the page was full (`found.size===limit`), or when the outbox had no room. The drain keeps the job in both cases. `redrive()` still returns the moved count. Regression: `tests/conversations-scale-review.test.mjs`.
5. **L4: marker-GC `protectedOwn` was too coarse.** The pass now records each own-keep scope that protected an object (`protectedScopes`: a resource, or `~all`; at most 128). At finalization it rereads each recorded scope's keep row and restarts the pass if any of them is no longer active, even while another scope stays active. A legacy in-flight `protectedOwn` keeps its old rule. Regression in `tests/producer-scale-work.test.mjs`: two resource keeps, one superseded after the first batch.
6. **Correction: expression indexes and RR1-M7, provisional conclusion.** The earlier sentence called expression indexes Node-only. That was wrong. A local workerd probe (Miniflare, `useSQLite`) created a partial expression index on `json_extract(value,'$.producer.connection')`/generation over an ordinary DO SQL table. `EXPLAIN QUERY PLAN` used it as a covering index, and 20 matching rows out of 2,000 read 20 rows. Node `node:sqlite` plans the same index. The same probe was refused (`SQLITE_AUTH`) when it read or indexed the DO KV API's backing `_cf_KV` table, which holds the Worker account metadata. **Conclusion (provisional, unsigned):** expression indexes work on both platforms only for records stored as JSON text in an application SQL table. Removing the per-object pointer would mean moving the authoritative `hosted/` and `drive/object/` records out of the portable ordered KV metadata into such a table on both platforms. That is a storage-layer migration across the transactional metadata boundary, outside this fix round. It would also not remove the RR1-M7 concern: the index B-tree still stores the derived connection/generation per object, so it is a comparable privacy/storage deviation maintained by the engine rather than the application. The pointers stay for now. The JSON-table alternative is recorded for the RR1-M7 reviewer. This is local evidence only, not production or provider conformance.
7. **Note (no code change): mixed-version rollout caveat for key tombstone pages.** After the new code commits an owner's tombstone `state` marker, anti-reuse lookups trust only the exact `hash/` membership rows. During a rolling or gradual deployment, an older-version instance pruning that owner's keys would append to tombstone pages (or legacy per-kid rows) without writing membership rows or advancing the state. The new version would then miss those kids, and a pruned kid could be reused. The reverse direction is safe: older readers still scan pages with `kids` arrays and ignore the owner-less hash/state rows. Before release, the rollout must make sure no older writer runs for an owner after the new version has migrated that owner. Examples are a single code version per identity object, or a drain/cutover deployment, or a future guard that re-migrates when legacy rows or unindexed page members appear after `state`. Not implemented. It falls under the production gates and is not inferred from passing tests.

A first full run caught a layering bug in the new wrapper. It had captured the inner store's `transaction` when it was built, which bypassed fault/tracing overrides installed later on the wrapped store. Two `tests/message-postbacks.test.mjs` cases failed. The wrapper now resolves the inner `transaction` per call, and the M1/L3 revert checks were rerun after that change.

Verification after these follow-ups (shared checkout, local evidence; other agents' concurrent work is present):

- `npm test`: **3,655 passed, 1 failed**, zero skipped, zero cancelled. The failure, `tests/redirect-management-signin.test.mjs:36`, is a flaky assertion outside this workstream: a random base64 sealed transaction happened to contain `end`, which matched `/verifier|end|mover/i`. Three isolated reruns passed 6/6. The known `tests/engine-producer-summary.test.mjs` "M1 Drive" case, owned by the Drive agent, passed in this run.
- `npm run test:worker`: **93 passed, zero failed**, zero skipped.
- `npm run test:ui-state`: **471 passed, zero failed**, zero skipped.
- `npm run test:bindlebox`: **227 passed, zero failed**, zero skipped.
- `git diff --check` on the touched files: passed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — ORG-12d support adjudication

**Implemented locally** ([organizations design §12d](docs/architecture/organizations-design.md#12d-org-12-break-glass-an-organization-whose-owner-is-gone-3slnme-provider-policy), slice ORG-12d). Still behind `ORG_BREAK_GLASS_ENABLED` (default off). It runs on loopback fixtures, a local WebAuthn verifier and the offline Polar model. That shows local behaviour only, not production operator identity, key custody or provider conformance. Every item is **provisional** (coordinator, not signed off by the user).

**Operator assertions (`packages/identity/operator-assertions.mjs`), replacing the HMAC shared secret in production wiring:**
- **Signing approach (provisional):** ES256 (ECDSA P-256), the algorithm and JWK codec of the identity key registry.
  - The admin service generates the key pair in the admin store on first use. The private JWK is kept only sealed under `KEY_ENCRYPTION_KEY`, with the same AES-GCM sealing the identity key registry uses (`packages/runtime/secrets.mjs`).
  - The organization writer verifies with the published public key (`operator-key/<kid>`) and never reads the private key.
  - Without `KEY_ENCRYPTION_KEY`, nothing is issued (`operator_assertions_unavailable`, 503).
  - **Residual:** the admin service and the account objects share one deployment and one secret environment, so the separation is logical, not a hard trust boundary.
- **The assertion:** `oa1.<payload>.<signature>`. The signature covers a domain-separated payload: issuer, kid, jti, operator, the `support.org-break-glass` capability, the engine's canonical scope (organization, process kind, process id, decision, sorted exclusions), and issue and expiry times, valid for 5 minutes.
- **The durable registry:**
  - `operator-assertion/<jti>` is committed in the same admin-store commit as the audit intent and the rate windows. Nothing is valid before that commit.
  - The verifier checks the signature, the issuer, the scope, the operator and the lifetime. It then requires an issued, unused registry row matching the scope and kid, and marks it used once under the store's revision check, so every assertion is single use host-wide. The engine's per-process nonce list stays as a second check.
  - Finally it re-checks that the operator still holds the capability: an administrator role plus `support.org-break-glass` through an internal role, with no hold.
  - Internal provenance and active status need the identity record. They are checked at issue, at most 5 minutes before verification (residual).
- **The capability (`roles.mjs` `OPERATOR_CAPABILITY`):** a catalog that classifies it `user`, or puts it in a delegable or user-class role, is invalid. So it is boot-assignable only and never delegable, as §12d.8 requires.
- **Wiring:** `organizationAdminPorts` gives the account objects `ORGANIZATION_OPERATOR_ASSERTIONS` and `ORGANIZATION_SUPPORT_CASES` over the admin store, in both adapters (the Worker reaches the store through `ADMIN_AUTHORITY`). `hmacOperatorAssertions` stays as the test double for the older suites only.

**Admin service (`packages/identity/admin.mjs`), as engine operations `org-cases.{list,get,decide,audit}`:**
- **Operators** are administrator accounts, never boot. They hold the capability, under the console's passkey-only step-up (15-minute read window, 5-minute mutation window). Each decision also needs its own fresh passkey assertion at the HTTP boundary (`adminOperatorPasskeyContext`, one use), as for assisted deletion.
- **Decisions:**
  - Break-glass: `acknowledge`, `note` and `abort` (one operator); `proceed` with exclusions, `uphold` and `reject` (two operators).
  - Lapse claims: `close` (one operator) and `proceed` (two).
  - A reason category and a 10–500-character reason are required for everything except acknowledge (note needs only the reason). The audit keeps a digest of the reason, never its text.
- **Daily limit:** 20 decisions per operator in a fixed 24-hour window (provisional). It is spent in the same commit as the per-actor window; `AdminStorage.commit` now accepts several windows and checks all of them before spending any. Every issued assertion counts, including those the writer later refuses.
- **Where the rules live:** two distinct operators, barred pairs, operator conflicts, exclusions, the last channel and tier-1 finality are the writer's rules (unchanged since ORG-12a). The admin service refuses early, from the organization's current view, the operator's own pending proposal and a barred operator's proceed, which saves an assertion.
- **Audit:** every operator action writes the hash-chained admin audit: `org-case.list`/`view` reads, `org-case.decide` intent then applied or failed with the writer's outcome or code, and `operator-key.create`. `org-cases.audit` returns these newest first, scanning at most 1,000 entries per page.

**Queue (engine hunk, `packages/orgs/break-glass.mjs`):**
- `BreakGlassService#beforeCommit` derives the organization's support case from the record. That is a held claim, an open contest or an escalated lapse claim; the processes exclude each other, so there is at most one.
- On any change it queues one critical `case-index` outbox effect with a rising sequence. The drain writes `org-case/<org>` in the admin store, and a lower sequence never overwrites it. Closed cases stay as tombstones.
- Rows are routing only: the admin service confirms every case with the writer (`orgs.breakglass-case`) before showing or deciding anything. Organizations with no case never write anything.
- The case view now adds `disputed`, `undeliverable` and `excludable` per channel (the writer's own exclusion rule), the proposing operator, the proposal's expiry, `proceedBlocked`, the claim's transition timeline, the escalated lapse claim and the public handle. It still carries no addresses and no statement text.

**Routes (`packages/runtime/admin-org-cases.mjs`, mounted in `admin-http.mjs` next to the flags routes):** `POST /api/admin/org-cases/{list,get,decide,audit}`.
- Requests must be same-origin, with no query string. The `admin` actor header is required; boot is refused with `operator_capability_required`.
- `decide` verifies authority, then requires `passkeyResponse` and confirms it through `/api/admin/step-up`, which accepts passkeys only.
- **Flag gate (provisional reading):** seizing decisions (`proceed`, `uphold`, `reject`, including lapse `proceed`) answer the uniform 404 while `ORG_BREAK_GLASS_ENABLED` is off for the organization. The queue, the case and the safe direction (acknowledge, note, abort, close) are not gated, following §12d.12 and the flag registry's retention reason ("support holds … are never gated"). This narrows the instruction "flag-gate the routes"; review it.

**Console (`apps/web/src/{bl,ui}/admin-org-cases.mjs`; built by a forked UI agent against the contract above, reviewed by the coordinator):**
- A new "Organization cases" view for administrators (hidden in boot mode), in English and Spanish (143 catalogue keys). It has:
  - the queue;
  - the case detail: timers, track and causes, and evidence as channel kinds with ages and disputed, undeliverable and excluded badges, with no addresses;
  - the timeline;
  - single-operator actions;
  - propose and approve, where an approval sends the proposal's exact exclusions;
  - an exclusion picker limited to excludable channels that refuses excluding every channel;
  - contest uphold and reject;
  - lapse close and proceed;
  - barred and flag-off notes;
  - decisions left today;
  - the operator audit.
- Every decision takes a passkey through the real `/api/admin/step-up/begin`.

**Readings and deviations (provisional, for review):**
1. The routes live in `packages/runtime/admin-org-cases.mjs`, not `routes/` as the plan proposed, beside `admin-flags-http.mjs`.
2. The flag gate covers the seizing direction only (above).
3. An assertion is spent when the writer's verifier accepts it, before the writer's own rules run, so a refused decision still uses one assertion and one of the 20 daily decisions.
4. Lapse-claim `proceed` is gated by the break-glass flag too (the conservative choice; `close` is not).
5. No signing-key rotation tooling exists. A key can be retired (`retiredAt`), which stops it verifying.
6. Excluding every channel answers `invalid_exclusion` before `last_channel` when some channel was never excludable (the writer's existing order).

**Tests:**
- `tests/orgs-break-glass-support.test.mjs` (15 tests, engine level, the real AdminService, IdentityService, AdminStorage and production verifier against the break-glass world):
  - the signer and registry (sealed key, published public key, used row; no key, no issue);
  - forged assertions: a tampered payload, a foreign key under the real kid, the HMAC double, an unregistered assertion, altered signature bytes, a retired key;
  - a replay, in this process and host-wide, and an expired assertion;
  - every other scope (organization, process, decision, kind, exclusions, operator), with the assertion still usable for its own scope afterwards;
  - a single operator cannot proceed, through the admin service and with a registry-valid assertion straight to the writer; one operator can hold, note and abort;
  - barred pairs (both operators refused at the admin service and at the writer; a new pair succeeds);
  - the daily limit (20, then `decision_limit` with nothing forwarded; per operator; the window reopens after 24 hours);
  - a non-capability administrator, boot, a capability revoked between issue and use, a held operator, and delegable or user-class catalogs;
  - a password step-up refused, no decision without its own passkey assertion, and the HTTP `/api/admin/step-up` password refusal;
  - the flag gate;
  - the queue: indexing, tombstones, stale sequences and no addresses;
  - a contest upheld by two operators;
  - a lapse claim (proceed by two, close by one, kinds never cross);
  - the audit, including a writer `operator_conflict` recorded as failed and the chain verifying;
  - the HTTP routes.
- `tests/orgs-break-glass-support-chaos.test.mjs`, seeded (`CHAOS_SEEDS`, default 6): operators racing on one held claim. The schedule includes two operators proposing at once, one operator twice at once, racing replays of one assertion, excluded-channel disputes that bar a pair, and clock jumps across the daily window. Invariants S1–S6, with a coverage check that final, barred, replay and approved races all occur. 60 seeds (from 100) passed once.
- **Guard removal (scratch copy):** 16 new guards were removed one at a time, and each made the suite fail. They are the signature, the used-marking, the scope, the registry row, the operator registry, the retired key, the daily window, the capability, the passkey evidence, the flag gate, boot refusal, the non-delegable catalog rule, the case index, the sequence check, and the two early refusals.
- `tests/browser/admin-org-cases-engine.mjs` (8, UI state) and `tests/e2e/admin-org-cases.test.mjs` (1 test, 16 variants: Chromium and Firefox, en/es, 390/1280, light/dark), screenshots `artifacts/browser/admin-org-cases-*`.
  - **Environment limitation:** the e2e runs the real admin shell, a real boot claim, administrator onboarding with Chromium's virtual-authenticator passkey and real step-ups. Only the four `/api/admin/org-cases/*` routes are fixture-fulfilled, because seeding a held claim and a capability-holding operator through the Worker was impractical. The "second operator" is the fixture switching identity. Firefox variants are view-only, since Firefox has no virtual authenticator.

**Before production:** the design's gate table now marks each gate.
- **Verified operator identity:** met locally; production still needs a key custody review, rotation tooling, real WebAuthn evidence and an operator onboarding procedure.
- **Hash-chained organization audit:** partly met (no external anchor).
- **Verified notice delivery:** open.
- **Terms and privacy text (ORG-13):** open.
- **An independent security review of ORG-12a–d:** open; ORG-12d has had none.
- **Real-browser verification:** partly met.

**Shared checkout:** other agents edited files outside this slice during this work (flags, identity keys, retention, bindlebox, conversations). The counts below include their concurrent changes.

Verification (local evidence only):
- `npm test`: 3,621/3,621.
- `npm run test:organizations`: node 159/159, engine 57/57, browser 130/130, e2e 10/10.
- `npm run test:admin-deletion`: 28/28, 4/4, 16/16.
- `npm run test:worker`: 93/93.
- `npm run test:ui-state`: 471/471.
- `npm run test:e2e`: 329 tests, 325 passed, 0 failed, 4 skipped (the optional WebKit checks).

Not committed.

**Review follow-ups** (independent review, 2026-10-24: no High, 3 Medium, 7 Low; all fixed and provisional). Each fix has a regression test in `tests/orgs-break-glass-support-review.test.mjs` (9 tests). The UI parts are covered by `tests/browser/admin-org-cases-engine.mjs`. Each test fails when its fix is reverted, checked one revert at a time in a scratch copy (28 reverts, all failing).
- **M1, a revoked or held operator's proposal still counted as one of the two operators:**
  - The engine `operators` port gains `registered(sub)`. The production verifier backs it with the admin store's registry; the HMAC double with its predicate.
  - Before approving, `orgs.breakglass-resolve` and `orgs.claim-resolve` re-verify the pending proposer outside the transaction. An inactive proposer's proposal is cancelled, with an organization audit entry `organization-support-proposal-cancelled` (reason `proposer-inactive`), and the call becomes a new proposal. If the proposal changed in between, the call is refused with `conflict`.
  - The admin service remembers each operator's pending proposals (`operator-proposals/<operator>`, the 72 h approval window, at most 32). When boot revokes the capability (`setRoles`) or suspends the operator, it sends the new system operation `orgs.breakglass-proposal-cancel` to each of those organizations. Each cancellation is audited in the admin audit (`org-case.proposal-cancel`) and in the organization audit.
  - A catalog change that removes the capability from a role is not cancelled proactively. The approval-time re-check covers it.
  - The case view adds `proposal.proposerActive`. The console then offers a new proposal instead of an approval.
- **M2, the kill switch blocked the reinstatement remedy.** `uphold` is no longer gated by `ORG_BREAK_GLASS_ENABLED` (`ORG_CASE_GATED` = proceed, reject; same in the console). It stays a two-operator decision.
  - **Reading (provisional):** upholding a contest restores the former owner, which is the safe direction a kill switch must never block. Rejecting leaves the break-glass owner in place, so it stays gated with proceed.
- **M3, a lapse-claim reason reached the claimant.** The admin service forwards only `reasonDigest` (the SHA-256 of the text) to both writers; new optional `reasonDigest` inputs exist on `orgs.claim-resolve` and `orgs.breakglass-resolve`. The organization audit carries only the digest. Free-text `note` and `reason` are still accepted from other system callers.
- **L1, a 281–500-character lapse reason spent an assertion and a decision before failing:**
  - Lapse reasons are capped at 280 characters in the admin service and in the console (`invalid_reason`).
  - `resolveClaim` validates `note` before `verifyOperator`, so a bad note never spends an assertion.
- **L2, the reason text was kept nowhere:**
  - The text is stored in an admin-only notes row, `org-case-note/<sha256>`, written in the same commit as the decision's audit intent. The intent's audit entry carries the full digest.
  - `org-cases.audit` attaches the text for operators.
  - The console label now reads: "The organization sees only a digest. The text stays in an admin-only note that operators read in the operator audit."
- **L3, closed-case tombstones filled the queue:**
  - Only live cases sit under `org-case/<org>`, and a closed case's row is deleted.
  - The highest applied sequence is kept in `org-case-seq/<org>`, so late effects are still refused.
- **L4, after a key was retired the signer kept issuing with it (rotate on retire, recorded as provisional):**
  - When the current signer's published key is retired or missing, the next issue generates a new key.
  - It replaces `operator-signer` under compare-and-swap on its revision, audited as `operator-key.rotate`.
- **L5, least privilege:**
  - `AdminStorage` gains three narrow RPC methods that run inside the admin object: `verifyOperatorAssertion`, `operatorRegistered` and `applySupportCase`.
  - Account objects receive only `narrowAdminStore(...)`, never get, list or commit. It is bound to the calling organization: Node binds the account id, and the Worker reads the account object's own `owner`. A case write for any other organization is refused before the call.
  - **Residual:** in the Worker, the `ADMIN_AUTHORITY` binding is still present in every isolate's environment. The narrowing is in what the account code is given, not in the platform's bindings.
- **L6, the signing key's sealing had no purpose binding:**
  - `encryptSecret`/`decryptSecret` take an optional `purpose`, which becomes the AES-GCM additional data. Without one, the additional data stays `3sln.me/credentials/v1`, so existing records are unchanged.
  - The signing key is sealed under `operator-signer/<kid>`.
- **L7, the per-decision passkey was not bound to the decision:**
  - The new `POST /api/admin/org-cases/challenge {org, kind, process, decision, exclude?}` begins the step-up and stores `operator-challenge/<operator>` with the challenge, a digest of the decision and a 5-minute expiry.
  - At decide, the route reads the session's pending challenge before verifying the passkey. The decision requires that challenge and the digest of the decision itself, and consumes the row in its intent commit.
  - The console asks for this challenge instead of `/api/admin/step-up/begin`.
- **Before production:** the gate table gains a row, open and procedural. The two-person rule holds only if boot onboarding binds each operator account to a distinct human and a distinct authenticator.

**Wargame 4 admin items** (deferred to this slice by [Operator and lifecycle wargame fixes](#2026-10-24--operator-and-lifecycle-wargame-fixes), L3 and L4). Tests are in `tests/admin-audit-claims.test.mjs` (5) and `tests/browser/admin-console.mjs` (1 new).
- **(a) audit reads:**
  - `AdminService.audit` charges the per-actor read window (300 per 10 minutes) in a commit that writes no audit entry.
  - `verify: true` (the full chain walk) is boot-only (`verify_boot_only`). Administrators keep the checkpointed check of the page they read.
  - `org-cases.audit` is charged the same way.
- **(b) claims listing:**
  - The overview takes `claimsAfter` and `reservationsAfter` and returns `claimsNext` and `reservationsNext`. The console has "Show more claims" and "Show more reservations".
  - Finished claims (revoked, or expired without redemption) are pruned 30 days after expiry or revocation, at most 20 per mint, scanning from a rotating cursor. Their name pointer is removed too. Their audit entries stay, and each prune is audited (`claim.prune`). Redeemed claims are never pruned, because they are internal provenance.
  - An administrator may hold at most 20 outstanding claims (`claims_outstanding_limit`); boot is not capped.
  - Grace, batch and cap figures are provisional.
- The wargame's `rate-window-collision` repro was not assigned to this slice, and the operator wargame entry above fixed it in the flag service.

**Readings (provisional, for review):**
1. A proposal by an inactive proposer becomes the approver's new proposal; it is not refused.
2. An assertion is still spent once the verifier accepts it, before the writer's rules run (deviation 3 above).
3. The notes row is plain within the admin store, not sealed. Identical reason text shares one row, which keeps its first author and context. The audit entries keep each decision's own operator.

Verification after the follow-ups is listed below.

**Push subscriptions on admin suspension** (operator/lifecycle wargame M1, applied to `admin.mjs` at the coordinator's request):
- Administrator suspension, closure (its auto-suspend) and reopening each end the account's sessions. They now queue the ended sessions' public ids with the identity service's existing `queuePushEnds(account, ids)` in the same compare-and-swap, then run `flushPushEnds(owner)` after it.
- A failed flush stays on the account (`pendingPushEnds`), and the identity service retries it on the account's next save or owner view. No parallel mechanism was added.
- Tests: `tests/admin-push-ends.test.mjs` (3). Removing each of the 4 hooks (three queues and the suspend flush) fails a test.

**UI and test adjustments:**
- The console's "Verify entire chain" button now shows in boot mode only, and the admin e2e asserts that administrators do not see it.
- The operator chaos test's expected refusals gain `step_up_required` and `unauthorized`: an operator racing two decisions holds one bound challenge at a time.

Verification after the follow-ups (local evidence only, on a checkout shared with other agents):
- `npm test`: 3,682/3,682.
- `npm run test:organizations`: node 168/168, engine 57/57, browser 130/130, e2e 10/10.
- `npm run test:admin-deletion`: 28/28, 4/4, 16/16.
- `npm run test:worker`: 93/93.
- `npm run test:ui-state`: 473/473.
- Admin e2e: `tests/e2e/admin-console.test.mjs` 1/1. `tests/e2e/admin-org-cases.test.mjs` 1/1 (16 variants), run in its own Worker as the default runner does; run together with admin-console in one Worker it skips by design.
- `npm run check:worker`: passed (dry run).
- Operator chaos: 60 seeds (from 500) and 40 seeds (from 300) each passed once.
- The full `npm run test:e2e` was not rerun after the follow-ups.

Not committed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — Operator and lifecycle wargame fixes

Wargame 4 red-team findings on operator and lifecycle surfaces. Each repro now has a permanent regression test. Each fix was reverted on its own in a scratch copy of the tree (33 single-fix reverts), and every revert made its test fail.

**Medium:**
- **M1 — push survives session revoke.** A push subscription now records the public id of the session that created it. The subscribe route supplies the id; the request body cannot.
  - Identity writes `pendingPushEnds` in the same CAS that ends the sessions. That covers revoke, cap eviction, recovery and ordinary sign-out of the session's own chain.
  - `flushPushEnds` runs the row after `save` and again on the owner view, following the `pendingSever` retry pattern. It goes through the new `accountChannelsPort.endSessions`, and the row clears only after the account object acknowledges.
  - The account object deletes the bound subscriptions. It keeps a 25 h end marker per session, so a late subscribe from an ended session is refused, and it drops the ended sessions' pending Drive OAuth state.
  - "Sign out other devices" also removes every row not bound to a kept session. That includes legacy unbound rows. The browser's own subscription id is kept: the web client now sends `pushSubscription` with revoke-others.
  - Before any message push, `claimDue` drops rows bound to an ended session. Notice-channel counts and security notices (`accountChannelState`) skip them too.
  - Deletion and portability channel snapshots are copies taken when the request starts (R1-M2: deleting rows later cannot suppress notices). A device revoked during an in-flight request keeps receiving that request's notices; a request started after the drain no longer sees it.
  - The identity edits are minimal: `queuePushEnds`, `flushPushEnds`, `syncPushEnds` and four call-site hunks.
  - With no account-channels port, nothing is queued, so there is no extra CAS.
- **M2 — shared rate keys.** The flag service has its own windows: `flags-admin-<owner>`, `flags-read-admin-<owner>`, `flags-boot` and `flags-read-boot` (`flagRateKey`). The admin service is unchanged.
- **M3 — leftover env force-on during an outage.** The pre-console compatibility rule now applies only when an empty snapshot was actually read and is usable (`flags.usable`). A dependency whose reason is `outage` or `outage-last-known` never returns the legacy env value.
- **M4 — exports that never end.** The changes are in `export-generation.mjs` and `account/exports.mjs`:
  - A non-ready job counts consecutive failures. A second `export_part_missing`, 24 failures or a 3-day deadline from the job's first step marks it `failed` with the last code and `cleanupPending`, then runs `cleanup()`.
  - Failures not caused by the owner's own data volume are marked `uncharged` and no longer count against the weekly allowance. The charged codes are `export_pin_budget`, `export_row_limit` and `export_metadata_limit`.
  - The account alarm backs off from 60 s, doubling to 1 h.

**Low:**
- **L1 — unbounded request/cancel loop.**
  - Owner requests are limited to 3 per account per 24 h inside `schedule()`. Admin bases are exempt, so an owner loop cannot block an admin closure.
  - Receipts are capped at 16 and expire after 30 days.
  - The routes allow 10 POSTs per session and 60 per /24 every 10 minutes.
- **L2 — no wake-up anchor during the Polar call.** After the commit and before any external call, the request writes its due row and arms a 5-minute backstop alarm.
- **L5 — one stale record poisons the snapshot.**
  - Storage reads validate records one at a time (`validateSnapshot(…,{quarantine:true})`). A rejected record is listed in `quarantined`, and only that flag follows its outage policy, never legacy env. Writes stay strict.
  - The console list shows quarantined records (en/es).
  - New `flags.retire` removes one quarantined stored record. It is critical and audited: passkey step-up, reason, typed name and expected version. After review, a still-registered flag's record is replaced by the off record (not deleted).
  - `RETIRED_FLAGS` was added to the registry, guarded by `tests/flags-registry-removals.test.mjs` with the name lock `tests/fixtures/flag-registry-names.json`.
- **L6 — stale writer snapshot.** An account writer re-reads the authority single-flight once its copy is 5 minutes old, even at the edge's version.
- **L7 — Drive disconnect leaves rows.**
  - Disconnect marks the resource `drive/removed/<id>` in its transaction, then sweeps `drive/object/<id>/` and `drive/retained/<id>/` in batches of 100, at most ten per call. Leftovers resume on the next begin or disconnect.
  - **Reconciled with AU-S6 (coordinator):** `drive/object/` rows carrying `producer`/`createdBy` evidence are kept, so What's left can still show that storage as "not deletable here". They are bounded by the 10,000-object cap and are left to the owner's What's left action or the account purge.
  - Upload and folder journals (`drive/pending/`, `drive/folder-pending/`) are kept as evidence, as `tests/google-drive-audit.test.mjs` requires. They are already capped at 100 per account.
- **L8 — abandoned Drive OAuth state.** Each begin prunes up to 50 expired `drive/oauth/` rows, and a session end deletes that session's row (above).

**Plausible items (fixed):**
- `ExportLayout` accepts only `['owner']`. Grant downloads go through the token-verifying `DownloadExport` adapter.
- MCP `eraseSubject` keeps a durable per-owner cursor (`mcp/v1/erase/<owner>`), so a retry resumes.
- The Node deletion-due sweep always starts. Each run follows the live flag port with background semantics: only the env kill stops it (`deletionDueSweepRun`).
- `ownedBlobRef` includes `rpc-results/<owner>/`, and the purge collects journal `resultRef`s.
- A Drive refresh that lists extra scopes moves the resource to `reauthorization_required`.
- Flag-console reads (list, get, history, preview, evaluate, seed-verify) spend the `flags-read-*` window: 300 per 60 s, not audited.

**Deferred (another agent owns `packages/identity/admin.mjs`):**
- **L3:** admin audit reads are unbounded, and `verify` re-walks the whole chain.
- **L4:** the admin overview lists only the first 100 claims and reservations, with no cursor.

**Readings and deviations (provisional, for review):**
1. "A live bound session" means the session has not been ended explicitly. Sessions last at most 24 h, and the client does not re-subscribe at sign-in, so treating natural expiry as revocation would silence push daily. A subscription bound to a naturally expired session stays live until revoke-others, an explicit end or a re-subscribe.
2. The scheduled-notice quiet window was removed after review (below).
3. The export deadline counts from `startedAt`, not `createdAt`, because generation may start after the 3-day security `notBefore`.
4. A quarantined record of a still-registered flag must be retired, then seeded again. It cannot be edited in place.
5. The new account key families are `push-session-ended/`, `drive/removed/` and `deletion/request-log`. The first two are classified in the export inventory; the purge removes all of them.

**Tests (new):**
- `tests/wargame4-flags.test.mjs` (5);
- `tests/flags-registry-removals.test.mjs` (3);
- `tests/wargame4-push-revoke.test.mjs` (3 tests: a node-server suite of 2, account object, identity retry/eviction/revoke-others/recovery);
- `tests/wargame4-export.test.mjs` (5);
- `tests/wargame4-deletion.test.mjs` (5);
- `tests/wargame4-drive.test.mjs` (6);
- `tests/wargame4-lifecycle-storage.test.mjs` (2);
- one DOM test in `tests/browser/admin-flags-engine.mjs`.
- Helpers: `tests/helpers/deletion-world.mjs` and `tests/helpers/export-world.mjs`.
- **Adjusted:**
  - `tests/flags-chaos.test.mjs` counts only audited commits.
  - `tests/flags-engine.test.mjs` lists `flags.retire`.
  - `tests/engine-account-export.test.mjs`: a caller-built grant actor is now refused.

**Shared checkout:** other agents edited files outside this slice during this work. The counts below include their concurrent changes.

Verification (local evidence only):
- `npm test`: 3,653/3,656. All three failures are in `tests/orgs-break-glass-support.test.mjs` (ORG-12d's in-progress `packages/orgs/break-glass.mjs` and `runtime/admin-org-cases.mjs`, which were being edited during the run). An earlier run instead failed 2 `tests/message-postbacks.test.mjs` cases. Those reproduced with this slice's files at HEAD, and a later run passed.
- `npm run test:worker`: 93/93.
- `npm run test:ui-state`: 471/471.
- `npm run test:deletion`: 6/6.
- `npm run test:admin-deletion`: 28/28, 4/4, 16/16.
- `npm run test:admin-flags`: 8/8, 27/27.
- `npm run test:devices`: 17/17, 13/13.

Not committed.

Reviewer: ___ Date: ___ Outcome: ___

**Review follow-ups (2026-10-24, independent review of this entry; 2 Medium, 4 Low, info):**
- **Medium, deletion quiet window:** removed. Every new request gets its own "scheduled" notice and cancel link. A re-request minutes after a cancel left the owner holding only the dead link from the first request. The loop stays bounded by the per-account budget (3 per day), receipts and the route budgets.
- **Medium, `flags.retire` on a registered flag:**
  - In the same commit, it now replaces the stored record with the registry's off record (`empty()`, a fresh salt and the next revision), adds a revision-history row, and records the replacement as the audit `after`.
  - If the env state is force-on-legacy, retire refuses unless `acknowledgeGates:['legacy-env']` is given.
  - An unregistered (retired) name is still deleted.
- **Low:** `accountChannelsPort.endSessions` forwards `keepSubscriptions`. Tested through the real port.
- **Low, Drive sweep:** the per-resource cursor (prefix index, `startAfter`) now persists in the `drive/removed/<id>` marker, so kept producer rows are passed once rather than re-read forever.
- **Low, session-end paths:** `queuePushEndsOn(account, ids, {keep, keepSubscriptions, nonce})` is exported from `identity/service.mjs` for code outside IdentityService. `transfer-out.mjs` `removeDisputers` now queues every removed live session in its CAS. It returns `endedSessions`, and its caller deletes those bound subscriptions locally.
  - **Handed over (ORG-12d owns `admin.mjs`):** the suspend, auto-suspend and unsuspend paths (around admin.mjs:254/:344/:367). By inspection, all three call `identity.queuePushEnds` in the ending CAS and `flushPushEnds` (3 call sites) after it. This slice did not edit or test them.
- **Low, export allowance:**
  - Data failures (`export_payload_missing`/`changed`/`invalid`, `export_path_collision`, plus the volume codes) are charged.
  - System failures are uncharged at most `EXPORT_UNCHARGED_PER_WEEK` (2) times per 7 days.
- **Info:**
  - `pendingPushEnds` is cleared by a random `nonce`, not a millisecond timestamp.
  - The deletion channel-snapshot wording above is corrected.
  - `drive/folder-pending/` journals (sealed tokens from failed connects) are pruned on begin after 7 days.
  - Not acted on: the review's same-browser re-sign-in probe (`repro-relogin-push.test.mjs`) only logs. Ordinary sign-out of a session already ends its bound subscription.
- **Tests:**
  - `tests/wargame4-deletion.test.mjs` +1;
  - `tests/wargame4-flags.test.mjs` +1;
  - `tests/wargame4-push-revoke.test.mjs` +3 (real port, removeDisputers, nonce);
  - `tests/wargame4-drive.test.mjs` +2;
  - `tests/wargame4-export.test.mjs` +2.
  - In a scratch copy, 10 single-fix reverts each made their test fail.
- **Verification after the follow-ups:**
  - `npm test`: 3,681/3,682. The one failure was the seeded chaos test in `tests/orgs-break-glass-support-chaos.test.mjs` (ORG-12d's file, edited during the run). It passed on an immediate rerun, together with `orgs-break-glass-support.test.mjs` (16/16).
  - `test:worker`: 93/93.
  - `test:ui-state`: 473/473.
  - `test:deletion`: 6/6.
  - `test:admin-deletion`: 28/28, 4/4, 16/16.
  - `test:admin-flags`: 8/8, 27/27.
  - `test:devices`: 17/17, 13/13.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — Break-glass and ownership outbox scaling

**Implemented locally, provisional and unsigned.** This fixes probe cliffs #1 and #2 from `scratchpad/scale2/REPORT.md`. Nothing is committed or deployed. Organizations and break-glass stay behind their flags. Everything here is local adapter behavior, not production or provider conformance. ORG-10 relation files were not touched.

**Provisional decisions:**

- **Admin summaries (#1).** New module `packages/orgs/admin-index.mjs`; the roster maintains it in the same transaction as the membership rows.
  - `org/admin/<key>` now holds `{id, since, u, f}`.
  - `org/admin-unbounded/<issuer>/<grantedAt>/<key>` lists live, unheld, non-expiring memberships that hold an admin grant without an expiry.
  - `org/admin-from/<notBefore>/<key>` lists admins whose admin grant and membership have not expired. An `admin-reindex` due entry at each grant expiry keeps it current.
  - The record's `roster` gains an `admins` count and a layout version `ix:3`. Older layouts are rebuilt once by the next roster flush, at O(admins) for that one migration.
- **Eligibility and quorum, same semantics.**
  - `eligibleAdmins` reads only this provider's unbounded index up to `since − 30 days`, oldest first. It stops at `HINTS+2` rows: quorum needs two eligible admins and hints go to at most 16 people.
  - `effectiveAdminExists` replaces `effectiveAdmins().length===0` and is evaluated only when the answer matters (a member-initiated start, or the view's `start` decision).
  - `quorumMet` stops at the second eligible signer.
  - Every candidate row is still checked with the unchanged `eligibleAdmin`/`memberPowers` predicates, and rows changed in the same transaction are considered too. Organizations not yet migrated use the old enumeration.
  - **Visible difference:** with more than 14 eligible admins, the hinted admins are now the longest-tenured instead of the first by principal key. Who is eligible does not change.
- **Recipient fan-out (#1).** A member outbox notice to at most 64 admins (`ORG_INLINE_ADMINS`) still lists its recipients inline, unchanged. Above that, the event carries only its named members plus a cursor (`fanout`). The drain delivers pages of at most 256 admins (`ORG_FANOUT_PAGE`), with at most 8 fan-out pages per drain call.
  - **Snapshot semantics are the same as before:** the admins after the queuing transaction. Each admin's `since` (the outbox sequence it became admin after) bounds the interval. An admin removed while an older fan-out is pending is kept in `org/admin-ended/<until>/<key>` until the last such fan-out ends, then pruned.
  - A failed page is retried from the same cursor, so delivery stays at least once.
  - **Port contract change:** pages carry `page:{index, final}`, and consumers deduplicate by event id plus recipient (admin) id (corrected by review L3 below). `ORGANIZATION_MEMBER_EVENTS` is still unwired, so no consumer exists yet.
- **Ownership outbox rows (#2).** New module `packages/orgs/ownership-effects.mjs`, flushed by `OwnershipService#beforeCommit` in the queuing commit.
  - Each effect is its own row `org/effect/<id>`, with `org/effect-due/`, `org/effect-done/` and `org/effect-claim/` indexes.
  - The record keeps a summary `ownershipEffects:{pending, done, subs}`, which answers the pending cap and "a revoke or refund for this subscription is pending".
  - **Preserved guarantees:**
    - critical effects are never refused, and only pending rows count toward the 256 cap;
    - at most 128 done rows are kept, for 30 days, pruned at flush;
    - the drain lease, refund idempotency (`billing.handled` plus a per-subscription pending count) and the provider re-read before acting are unchanged;
    - an ended claim drops its pending owner notices (via the claim index) and erases their abort tokens.
  - **Migration:** a record still holding the in-record `ownershipOutbox` array is migrated by its next commit, or by a commit the drain makes first. Pending rows plus the newest 128 done rows from the last 30 days become rows, and the array is removed. Until then, the readers count the array too.
  - `readOrganization` and the test `summary()` show the rows as `ownershipOutbox`.

**Before/after probes.** Scripts and output are in `scratchpad/scale3/{before,after}/`. The "before" run was at HEAD 6bbae45 and reproduced the report. The after-scripts use the same seeding, plus one unmeasured migration commit. The outbox backlog is now queued inside one commit, because the outbox no longer accepts a bare record write. Rows are list-returned rows; read bytes include gets.

| Scenario | Before (rows / gets / bytes read / ms) | After |
|---|---|---|
| All-admin start, 5,000 | 25,000 / 10,008 / 6,431,743 / 219 — **rejected** `organization_row_limit` | 44 / 48 / 27,871 / 3.8 — succeeds |
| All-admin start, 500 | 2,500 / 1,008 / 643,741 / 21.3 | 44 / 48 / 27,867 / 3.7 |
| All-admin cosign / objection / abort, 5,000 | not reached | 0/8, 0/8, 4/9 rows/gets; ≤ 7.7 KB |
| All-admin cosign / objection / abort, 500 | 500 rows / 505 gets each, ≈ 311 KB | same as 5,000 |
| All-admin, 50 (inline path, ≤ 64 admins) | start 250/108; cosign 50/55 | start 94/78; cosign 50/55 |
| Member drain, 5,000-admin fan-out | n/a | ≤ 2,055 rows / 146 KB per call; 4 notices → 80 pages, every admin of each snapshot reached (no repeats observed in this run) |
| One-time admin index migration | n/a | 50: 58 rows; 500: 508; 5,000: 5,008 rows / 3.08 MB / 179 ms (once) |
| Outbox 1,000 / 5,000 critical effects: largest value | 500,635 / 2,496,635 B (the record) | 2,470 / 2,568 B (the claim row); record 1,696 B |
| Outbox build, 5,000 | 286 ms, cumulative O(N²) array scans | 146 ms for 5,000 rows in one commit (O(N)) |
| Append one effect with 10 vs 5,000 pending | O(N) record rewrite | 0 vs 16 rows, 3 gets, ≈ 2.3 KB |
| Drain one batch with 5,000 pending | (array scan) | 68 rows / 27 gets / 20.8 KB |
| Done rows after completing 5,000 | 129 in the record | 128 rows, record 1,693 B |

**Regression tests:** `tests/orgs-breakglass-outbox-scale.test.mjs`, 5 tests, in `npm test`.

- An all-admin org at 50, 500 and 5,000 members: start, cosign, objection, abort and the view all succeed, store work is bounded, and 500 → 5,000 is flat.
- Fan-out exactness: a leaver after the event still gets it, a joiner does not, a later event follows the later set, no repeat in the tested schedules (see review L3 below for the race that can still repeat one), pages are bounded to 8 per drain call, and ended rows are pruned.
- Eligibility at 120 admins: tenure-limited admins, the single-admin Track S, holds and a member-initiated start, all through the indexes.
- The outbox at 10, 100, 1,000 and 5,000 effects: the record stays under 8 KiB, no value exceeds 128 KiB, append and drain are flat, the non-critical cap applies, at most 128 done rows remain and there are no orphan rows.
- A legacy in-record outbox migrates and drains exactly once.

A revert check (inline recipients forced for every size) makes the all-admin test fail. Existing tests that inject legacy junk now write `(r.ownershipOutbox??=[]).push(...)`, which exercises the migration. One in-transaction assertion uses `queuedEffects(r)`.

**Not addressed:**
- The claim row's `cosigners` and `adminDomains` arrays grow with the number of distinct co-signers (one cosign is flat).
- `MembershipService#operator`/`hasOperator` (when an admin ends or grants change) and `requests()` still read every admin. Neither is on the break-glass path measured here.

**Verification (shared checkout; the ORG-10 agent's concurrent work is present):**
- `npm test`: **3,696 passed, 0 failed**.
- `npm run test:organizations`: **168 + 57 + 130 + 10 passed, 0 failed**. This includes the Chromium browser and e2e checks.
- `npm run test:worker`: **93 passed, 0 failed**.
- `npm run test:ui-state`: **473 passed, 0 failed**.

Reviewer: ___ Date: ___ Outcome: ___

**Review follow-ups (2026-10-24, break-glass review of this entry: no regressions, three Low; implemented locally, provisional and unsigned).** Each has a regression test in `tests/orgs-break-glass-review3.test.mjs` (3 tests, in `npm test`). In a scratch copy of the tree, reverting each fix made its test fail; reverting L2 also brings back the liveness-chaos failure at seed 94 with `CHAOS_SEEDS=150`.

1. **L1 (older bug): contest escalation had no transition.** The undecided-contest escalation in `advanceExtra` wrote an `organization-break-glass-contest-escalated` audit entry with no claim log entry, so chaos invariant I7 (one audit entry per transition) failed at seeds 128, 156 and 236 with `CHAOS_SEEDS=150`. It is now a table transition, `contest-escalated` (T27, effective→effective), applied through `move` to the contested claim. The record's `breakGlass` summary keeps pointing at whatever claim it named. I7 was not loosened. `CHAOS_SEEDS=300` passes.
2. **L2 (older bug): a sign-in between the T1 snapshot read and the claim commit was lost.** `unseenLiveness` compared `last > createdAt`. The start now re-reads the owner's activity just before its commit (one extra port call) and stores that read's time as `c.snapshotAt`. Status and `lastInteractiveAt` also come from this second read. Liveness is now `last >= snapshotAt`, still above any applied liveness or decision. The liveness signal accepts `at >= snapshotAt`. Claims without `snapshotAt` keep the old rule. The liveness chaos suite passes at seed 94 and at `CHAOS_SEEDS=300`.
3. **L3 (new in this entry): fan-out could repeat an admin.** An admin removed after a live page had already listed them was delivered again in the ended phase. Each live page now records its last key and the organization's admin-removal counter (`roster.removals`), read after listing, in `fanout.seen`. Ended rows carry their removal counter `r`. An ended row whose key a live page covered, removed after that page was read, is skipped.
   - Reading the counter after the listing means a removal racing the read can still be delivered twice, but is never missed.
   - Retried pages also repeat recipients. The `ORGANIZATION_MEMBER_EVENTS` contract (memberships drain comment, design doc) now says consumers deduplicate by event id plus recipient (admin) id. The earlier "nothing is duplicated" wording above is corrected.
   - The event row grows by one `seen` entry (about 100 B) per live page: roughly 2 KB at 5,000 admins.

**Verification after the follow-ups (shared checkout; the ORG-10 agent's concurrent work is present):**
- `npm test`: **3,726 passed, 0 failed**.
- `npm run test:organizations`: **203 + 57 + 130 + 10 passed, 0 failed**, including Chromium browser and e2e checks.
- Chaos with more seeds:
  - `CHAOS_SEEDS=300` `orgs-break-glass-chaos`: 1/1;
  - `CHAOS_SEEDS=300` `orgs-break-glass-liveness-chaos`: 2/2;
  - `CHAOS_SEEDS=60` `orgs-break-glass-support-chaos`: 1/1;
  - `CHAOS_SEEDS=60` `orgs-ownership` + `orgs-wargame`: 51/51.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — ORG-10a-c relations core (flags off)

**Implemented locally** ([organizations design §8b](docs/architecture/organizations-design.md#8b-org-10-and-org-11-relations-design-for-implementation-rev-56), slices ORG-10a, ORG-10b and ORG-10c of §8b.10; [spec](docs/spec/organizations.md) rev 4.5 §9). Behind `ORG_RELATIONS_ENABLED` and `ORG_FOREIGN_RELATIONS_ENABLED`, both class a and default off (RL-1); the §13.3 release gates are unchanged. This is engine-level behaviour on a loopback host of several organizations, each in its own account writer. Nothing is routed, no console exists, and nothing is production-verified. Every item is **provisional** (coordinator, not signed off by the user).

**What exists (packages/orgs/relation-*.mjs):**
- **Documents (10a, `relation-documents.mjs`).** The spec §9.2 validator: size and bounds, `crit` (any entry is invalid here, fail closed), slots, arity and kinds, exact methods, `reshare:true` refused, superseding entries, and, against the pinned fragment bodies, fields, resource-field methods within the field's contracts and the bus `entity` reader. Also the growth table (`relationAdditive`), the per-pair upgrade delta, the "matrix as it applies to a slot" projection, and the `RelationDocuments.resolve(pin)` port, which verifies the pinned version's hash chain through `packages/core/artefacts.mjs` and caches by digest. Each organization also keeps a durable copy per pin (`rel/doc/<digest>`), so its instances keep working if the document disappears.
- **Statements and invitations (10b, `relation-statements.mjs`, `relation-invitations.mjs`).** Participation statements are signed only when presented, for a participation that is live or recorded as pending in the same commit. They verify only under the party's active key, and only while fresh (300 s, or 300 s before the invitation's `iat` when carried in one). Relation invitations are signed links through the shared envelope, with exactly the spec §9.4 members plus the inviter's statement. They are single use and bound to the invitee, expire within 30 days, and a withdrawn one fails exactly as an invalid one.
- **Instances, redemption and limits (10b, `relation-instances.mjs`).**
  - Engine operations: create, invite, inbound items, inbound preview (the full disclosure and its digest), accept, redeem, withdraw, decline, mute, leave, list and get.
  - Widening (create, invite, accept, resume) needs the flag, an admin whose governance is not held and a fresh step-up (RL-2), with an audit entry and a notice to every admin.
  - Narrowing (suspend, end, narrow, withdraw, decline, leave, mute) is never flag-gated, needs no step-up and stays open while deletion is pending (RL-3).
  - Arity is per view, counting the party itself when it holds the slot. Redemption rechecks it, so two invitations for the last place cannot both land.
  - RL-11 limits: 300 invitations a day, 3 per pair in 30 days, one open per pair, 256 inbound items, then refusal with an admin notice and a sender-uniform answer. Muting clears a sender's items. Caps of 256 instances and 1,024 incoming edges.
- **Edges and imports (10c, `relation-edges.mjs`, `relation-imports.mjs`).**
  - Each side keeps, per counterpart, its own grant and acceptance halves and mirrors of the counterpart's halves, with generations.
  - An edge X→Y is live only with X's grant live, Y's acceptance (as last reported by Y) live, X's participation and Y's recognition live, and a granted entry. Required entries must all be granted.
  - Grant values come only from the organization's own pool (`federation/resource/`). `imp_` ids are refused, which is the composition rule.
  - The grantee clamps received entries to the pinned matrix. Imports are keyed by (grantor, instance, entry) and get grantee-scoped `imp_` ids. They are recorded only when the grantee accepted receiving.
  - Use inside the grantee is `effectiveAuthority` (member grant ∩ application ∩ edge methods).
  - `relations.edge-check` is the grantor-side hook ORG-10d's certificate verification will call. It is scoped to one instance, so there is no transitivity.
  - Relation events (`relation-edge-state`, `relation-edge-ended`) go through a durable outbox and `relations.ingest`, which applies spec §9.9 steps 2 and 4–6: counterpart only, `jti` dedupe recorded after the checks, aep floors for widening only, an end is final and the highest generation wins. Responses are uniform, and nothing on that path fetches anything.
  - `relations.resync` (anti-entropy) and `relations.sweep` exist as system operations; no alarm schedules them yet (ORG-10e).
    - Resync re-tells an ended counterpart its final state for 72 h only.
    - Sweep expires invitations, inbound items, granted resources and replay rows, and abandons pending acceptances older than any invitation could live.
  - The outbox is keyed by (notBefore, seq), so backed-off rows never block later ones.
  - The grantor's check re-intersects the grant with the live pool: a resource that left, or a narrowed contract, is refused at once.
  - Resource scoping (`scope`) is refused until the certificate path can enforce it.

**Shared files touched (minimal):** `packages/flags/registry.mjs`, which gains two rows. `ORG_RELATIONS_ENABLED` requires `ORGANIZATIONS_ENABLED` and `DIRECTORY_ENABLED`; `ORG_FOREIGN_RELATIONS_ENABLED` requires `ORG_RELATIONS_ENABLED`; neither is retained when off. `tests/flags-registry.test.mjs` and `tests/fixtures/flag-registry-names.json` were updated to match (61 flags, 27 class a). `packages/app/providers.mjs` gains one catalogue row, `relations` (status `planned` until ORG-10f wires the account slice). `package.json` adds the four relation suites to `test:organizations`. No organization file (`organizations.mjs`, `memberships.mjs`, `app/domains/orgs.mjs`, `runtime/account/orgs.mjs`, `routes/orgs.mjs`) was edited: the service composes the existing `MembershipService` frame, audit, notices and roster. `break-glass.mjs`, `ownership.mjs` and `roster.mjs` (the concurrent scaling work) were not touched.

**Provisional decisions and readings (reconciled with §8b.10):**
- **No `artefact-store.mjs` kind registration.** Spec §9.2 says an unsigned growth table means validators process `relation` as an unknown kind. The table is implemented in `relationAdditive` instead, so registration later is one row.
- **No `packages/links` registration.** As with the organization invitation, the relation invitation is a provider link type with no app slot binding.
- **No `federation/service.mjs` projection hunk yet.** The relay descriptor's token is an entity certificate, which is ORG-10d. `relayDescriptor` builds the rest.
- **Engine operations live in the relation modules** (as `certificates.mjs` does). ORG-10f moves or re-exports them into `packages/app/domains/relations.mjs`.
- **`relations.resume` is treated as widening** (flag and step-up), although §8b.10 lists it with the narrowing actions. It restores outward or inward flow.
- **Same-host transport instead of signatures (RL-15 port).** `sameHostRelationTransport` dispatches the other organization's system operation and passes the sending organization as adapter evidence. Spec §9.9 step 3 (signature against warm certification keys) and step 1's JWS checks are ORG-10e. Redemption, statements and invitation signatures already use the interop formats.
- **One counterpart relationship per pair per instance in a view (v1).** Each counterpart is recognized in one slot, against one of this organization's slots. A second invitation to an already-recognized counterpart in the same instance is refused (`relation_counterpart_exists`). An organization may still hold several slots in an instance.
- **Pending acceptances.** A refusal by the inviter discards the invitee's pending records (spec §9.4 step 5). An unreachable inviter, or a lost response, keeps them, and a retry is answered idempotently by the inviter with a fresh statement.
- **Ending matching halves.** When a counterpart ends a half, this side ends its matching half too, because that half can never be live again, and says so. A counterpart no longer recognized in a view is told "ended" for any half this side never held, and a leaver sends "ended" for both halves. This goes beyond spec §9.6's "for each half it held", but it confers nothing, and the chaos suite needs it to converge when a grant event was lost before the end. Flagged for spec review.
- **An invitation must share or receive something.** An invitation or acceptance that would neither share nor receive is refused. "Receive" counts only where the document has entries in that direction.
- **Not in this pass:** introductions, recognition notices, pre-acceptance, upgrades, entity certificates, RL-4 holds, lifecycle hooks (billing stages, deletion pre-purge, key compromise), routes, console, ORG-11 transport, export and import. Foreign counterparts are refused: `not_found` with the kill switch off, and `relation_foreign_unavailable` with it on, because no transport exists.

**Tests (engine level; local evidence only):**
- `tests/orgs-relation-documents.test.mjs` (8): every validator rule, fragment checks, superseding, projection, every growth-table row and the never-additive changes, the upgrade delta, and resolve, including lookalike and tampered envelopes.
- `tests/orgs-relation-statements.test.mjs` (4): C10 freshness, active-key-only verification, forged, wrong-`typ` and extra-member statements, invitation verification, pure RL-11 issuance checks, and no statement for a party that left.
- `tests/orgs-relations.test.mjs` (17): flags (widening gated, narrowing never), create, invite, accept with the disclosure digest, consent at both ends, single-use invitations (forwarded, withdrawn, expired and garbage all fail identically), withdrawal racing redemption in both orders, a lost redemption response and an unreachable inviter, key rotation (L4), every edge transition (immediate at the holder, converging at the counterpart), leave, privacy (one subsidiary's store never names its sibling; members see only imports they hold grants on), no transitivity or onward sharing and instance-scoped grants, ceilings (document ∩ grantor values ∩ member ∩ application, plus the grantee clamp), the RL-11 limits and caps, arity per view (squatting impossible, split views normal), relation events (uniform, no lookups, reordering, replay, aep floors), lookalike documents, sweep and expiry, and a pending deletion.
- `tests/orgs-relations-chaos.test.mjs` (6 seeds × 120 steps, 6 organizations):
  - C1–C7, and the counters, are checked after every step.
  - The suite runs a daily resync on its simulated clock.
  - At the end, faults stop, anti-entropy runs, every mirror equals its holder's half, a counterpart that is no longer recognized has had its halves ended, and available imports match live grantor edges.
  - Separately, after the review fixes, 120 scratch seeds (200–319, at 200 steps each) passed.
  - C8 and C9 belong to ORG-10e, and certificates in C2 to ORG-10d.
- `tests/orgs-relations-review.test.mjs` (9): regressions for the cross-review findings below. No revert checks were run for them.

**Agent cross-review (2026-10-24; implementation review, not sign-off).** A read-only adversarial review found 1 High, 7 Medium and 13 Low items. It found no path that grants access without both consents, and no transitivity, onward sharing or cross-instance leak.
- **Fixed:**
  - **H1:** an unenforced `scope`. Scope is now refused.
  - **M2:** stale grants after the pool changed. The pool is re-intersected at check, redemption and resume.
  - **M3:** ghost counterparts and stuck pending acceptances after a lost redemption answer. Abandoning tells the inviter; there is a sweep; leaving with a pending acceptance tells the inviter; a retried acceptance holding an ended mirror ends its matching half on activation.
  - **M4:** outbox head-of-line blocking.
  - **M5:** a document fetch, or an invitation-validity oracle, before the admin check.
  - **M6:** key lookups before the claimed inviter is bound to the sender or the local issuer.
  - **M8:** pending acceptances now count toward the incoming cap.
  - **L9:** the aep floor is per sender.
  - **L11:** nothing is sent to ended counterparts after 72 h.
  - **L12:** counterparts are settled after activation.
  - **L13:** empty entries are dropped.
  - **L14:** the idempotent retry works past expiry.
  - **L15:** the resync cursor works, and leaving withdraws every open invitation.
  - **L16:** offers are not recorded while the flag is off.
  - **L17:** the `jti` format is checked.
  - **L18:** decline and mute notify admins.
  - **L21:** discard removes orphaned imports.
- **Left open, provisional:**
  - **M7:** an ended counterpart cannot be re-invited into the same instance. The reading is that an ended half is final per (instance, pair), so a later relationship needs a new instance. To be confirmed against spec §9.9.
  - **L10:** `relations.import-authority` takes the application ceiling from the caller. It is a self-report; the federation hook (ORG-10d) must pass the registered ceiling.
  - **Sweep:** the sweep's per-family scans are bounded to 256 rows without a cursor, until ORG-10e schedules it.
  - **L16, ingest:** ingest stays ungated. Existing edges stay readable, and a counterpart may resume them while the flag is off.
  - **L19:** the one-pairing-per-pair-per-instance limit is a v1 limitation, stated above.
  - **L20:** the grantee clamp uses the union of an entry's fields, because the wire format carries no field. This is defence in depth only.
  - **L18, system-ended halves:** halves ended by ingest are audited only through the counterpart's view.

**Verification (shared checkout with the concurrent scaling work present; local evidence only):**
- `npm test`: **3,735 passed, 0 failed**, 0 skipped, 0 cancelled.
- `npm run test:organizations`: four subprocess suites, **409 passed, 0 failed**, 0 skipped. The node suites are 212, 57 and 130; the browser e2e suite is 10. The first suite now includes the 44 relation tests.
- `npm run test:worker`: **93 passed, 0 failed**, 0 skipped.
- Relation suites alone, run three times with concurrency 4: 35 of 35 each time before the review fixes. After the fixes, 44 of 44.
- No browser or UI test applies: there is no UI in this pass.

**Review follow-ups (2026-10-24, independent review requested by the coordinator; implemented locally, provisional and unsigned).** The review found no Critical or High issues: no access without both consents, no transitivity, nothing beyond the consented fragment. It found one Medium and six Low; its repros are `scratchpad/rel-review/rel-review-repros.test.mjs` F1–F6. Each fix below has a regression test in `tests/orgs-relations-review.test.mjs` (now 15 tests). In a scratch copy of the tree, I reverted each fix and confirmed that its test fails (13 mutations, plus two for L4).
1. **M1: an invitation redeemed while the inviter was deleting.**
   - `relations.redeem` answers the uniform `invitation_invalid` unless the inviting organization is `active` and carries no organization-level hold (`record.hold`), and unless the issuing admin is still an unheld live admin.
   - **Provisional decision (coordinator, unsigned):** scheduling deletion withdraws every open relation invitation. An issuing admin who is removed, leaves or is held has their open invitations withdrawn. An organization-level hold refuses redemption.
   - Mechanism: a minimal commit-hook seam in `packages/orgs/memberships.mjs` (`commitHooks`, run in `beforeCommit` before the roster flush). `RelationService` registers `onOrganizationCommit`, which is bounded per commit, and the sweep finishes any remainder.
2. **L1: a lapsed required entry left the edge live.** `relations.edge-check` now requires every required entry to be live at check time, after expiry and pool re-intersection, so the edge stops at once rather than at the next sweep.
3. **L2: prototype-named keys.**
   - Counterpart-supplied keys meet only own-member lookups: the grantee clamp uses a `Map` and null-prototype objects, and `edgeAllows` and the pool checks use `Object.hasOwn`.
   - The audit also found that a slot named `constructor` passed the document's slot lookup. `slotOf()` now does every slot lookup, and the document validator uses `has(slots, …)`.
4. **L3: sweeps did not reach past the first rows.**
   - Open invitations are indexed by instance (used by leaving), by issuing admin (used by the hook) and by expiry (used by the sweep). Closed invitations are deleted 30 days after closing.
   - Replay rows carry a time index, and the sweep deletes up to 4,096 stale rows per call.
   - The counterpart expiry scan keeps a cursor.
5. **L4: caller-supplied application ceilings.**
   - `relations.import-authority` takes the application ceiling from the active federation grant record (`federation/grant/<id>`, `methods[field]`, as `grants.mjs` does), requires the import among that grant's approved resources for the field, and requires the membership generation to match. A caller-supplied ceiling is refused (`invalid_request`).
   - Until ORG-10d lets connections hold imports, this gives nothing, which is the intended fail-closed state. Connection liveness is read as `grant.active`; the connection-generation fence comes with the ORG-10d federation hook.
   - `orgs.member-authority` (`memberships.mjs` `authority`) had the same pattern and now takes `{membership, generation, grant, field, resource}`, with the ceilings read from its own records. `tests/orgs-memberships.test.mjs` was updated to match.
6. **L5: the invitee offer was synchronous.** It and its retraction now leave through the outbox. Issuing never calls the invitee, so the inviter's latency reveals nothing about the invitee's state. An offer for an instance where the invitee already holds the inviter as a counterpart is dropped.
7. **L6:** the L11 regression test now asserts exact outbox counts: two final halves within 72 h, none after, and nothing sent when leaving towards an ended counterpart.
- **Chaos-model correction:**
  - The chaos suite's "forged" event is now always an impersonation, or a non-counterpart speaking for itself. A counterpart speaking for itself sends a genuine event about its own halves, and had made convergence fail on a few seeds.
  - C3 now asserts the check never allows beyond the direct edge; it may refuse more.
  - Scratch runs after the follow-ups: 180 seeds (400–579, at 200 steps each), all passing.
- **Production gates added** (design §8b.10 "Production gates"):
  - The ORG-10f adapters must take the sending organization (`from`) only from verified evidence, never from a request body.
  - The RL-4 hold on a counterpart's authority reset, and invariant C8, are unimplemented (ORG-10e) and must exist before relations are enabled for any organization.

**Verification after the follow-ups (shared checkout; local evidence only):**
- Relation suites: **50 passed, 0 failed**.
- `npm test`: **3,741 passed, 0 failed**, 0 skipped, 0 cancelled.
- `npm run test:organizations`: **415 passed, 0 failed**, 0 skipped (four suites: 218, 57, 130 and 10).
- `npm run test:worker`: **93 passed, 0 failed**, 0 skipped.
- These counts supersede the earlier figures in this entry.

No commit or deployment. Production release stays disabled. No delivery to a real external provider, provider conformance or production key custody is inferred from these local tests.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — Spec/implementation drift audit

Documentation-only audit against HEAD `1f41f0a`, guided by entries from 2026-10-22 onward. Screened the 37 spec files and the architecture, release, deployment, self-hosting and README documentation (190 Markdown files total). Source comparisons and read-only reproductions focused on concrete limits, flags, routes, status/errors, lifecycle and implemented-versus-planned claims. This is a selective static drift audit, not exhaustive protocol conformance or production verification.

**Documentation reconciliation:**
- Replaced stale blanket “nothing implemented” / Wave 0 status statements with scoped local implementation boundaries for artefacts, intents, portability, organizations, app removal, device/incremental authorization, integrations/events/extensions, BindleBox and authored contact delivery. Remaining foreign-provider, organization-removal, relation transport/certificate and publication gaps stay explicit and unsigned.
- Corrected the total/free signup ceilings, access-token ceilings (15 min Bearer / 60 min DPoP), initial device-token/SDK descriptions, directory and device route/mount status, authored contact transports, checkout age attestation, Node metadata egress and region-policy configuration. Historical reviews retain their dated scope.
- Both `docs/architecture/feature-flags.md` and `docs/self-hosting.md` now list all 61 registry flags (27 class a, 12 class c, 22 class b), distinguishing registry safe values, raw Worker template settings and parsed Node defaults. Corrected device-flag dependencies, Node capability forwarding, terms/VAPID config forwarding and lifecycle dry-run bookkeeping descriptions. Template enablement is not an observation of deployment or verification.
- README/self-hosting now distinguish locally implemented export/deletion stages from open release gates. No decision was signed; no production capability was inferred from configured keys, flags or screenshots.

**Findings retained for review; no code changed by this audit:**
- **Signed intent header validation:** `packages/intents/format.mjs:25` accepts a newline in `kid`, contrary to the links §3.1 profile inherited by intents §3.3. A read-only reproduction confirmed acceptance. Attribution is still stripped; no forged-attribution claim is made.
- **Link authoring interoperability:** `packages/runtime/contact-links.mjs:18–19` rejects unrelated query parameters even though links §2 rule 7 says they do not invalidate a link. This is a suspected sender-helper gap, not a reproduced recipient-admission failure.
- **Organization clean removal:** app-removal §9.6 specifies a provisional notified 24 h start delay, but `packages/app/domains/app-removal.mjs:35,42` refuses organization clean removal as `unsupported_entity`. The explicit policy stays intact; its unimplemented status is now documented.
- **Contact error policy conflict:** contact-delivery S4 still says uniform 401, while the later U404 policy and current contact-target serializers use uniform 404 for refused signed links/contact-delivery targets. S4 was not weakened to match implementation; the conflict is called out for reconciliation. Other credential surfaces retain their protocol refusals.
- **Moved delegation exception:** the 200 final-revoked response during a live redirect window follows the explicit portability §10 rule (`moved.mjs:74–76,101–106`). It is not established as a code defect, despite tension with general U404 wording. After the window, ordinary uniform-404 handling applies. Both rules remain recorded.

Detailed old → new claims, file:line evidence, reproduction, coverage and unverifiable claims: `/private/tmp/claude-501/-Users-raystubbs-Projects--3sln-3sln-me/8f763b0e-277c-4c0c-b7f0-8c3d4fc70450/scratchpad/drift/REPORT.md`.

**Verification (local evidence only):**
- `npm test`: **3,741 passed, 0 failed**, 0 skipped, 0 cancelled.
- Mechanical comparison: all 61 flag classes/safe values/parsed Node defaults match both documentation inventories.
- `git diff --check`: passed. Protected organizations-design §8b and organizations §9 match HEAD byte-for-byte; legal text and pending-signoffs are untouched. Earlier DEVLOG entries are unchanged.
- A final status check found unrelated concurrent relations work (`packages/orgs/relation-statements.mjs` and a new `packages/orgs/relation-keys.mjs`) from the separate relations work. It was left untouched; the test result above is the completed shared-checkout run, not verification of subsequent concurrent edits.
- No browser behavior changed or browser run performed. No external provider, delivery, financial settlement, deployment, legal validity or production key-custody verification was attempted.

No commit or deployment. Production release remains disabled. Findings and decisions remain provisional.

**Coordinator follow-up (provisional):**
- Finding 1 is fixed: signed intent header `kid` values containing control characters are refused as `intent_malformed` (`packages/intents/format.mjs`, `tests/intents-kid-controls.test.mjs`).
- Finding 4 is kept as deliberate authoring strictness. The sender helper refuses extra parameters with an explicit message, while links §2 rule 7 governs recipient verification, which still ignores unrelated parameters.
- Findings 2 (organization clean removal not built) and 3 (contact-delivery 401 versus uniform 404) are open questions for the spec owner, listed in the sign-off digest.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-24 — ORG-10d/e entity certificates and relation events (flags off)

**Implemented locally** ([organizations design §8b](docs/architecture/organizations-design.md#8b-org-10-and-org-11-relations-design-for-implementation-rev-56), slices ORG-10d and ORG-10e of §8b.10; [spec](docs/spec/organizations.md) rev 4.5 §9.4, §9.5, §9.9, §10, §14). This continues "2026-10-24 — ORG-10a-c relations core (flags off)". Everything stays behind `ORG_RELATIONS_ENABLED` and `ORG_FOREIGN_RELATIONS_ENABLED`, both default off (RL-1). It is engine-level behaviour on a loopback host of several organizations, each in its own account writer. Nothing is routed, there is no console, and nothing is production-verified. Every item is **provisional** (coordinator, not signed off by the user).

**ORG-10d, entity certificates (`packages/identity/entity-certificates.mjs`, `packages/orgs/relation-access.mjs`):**
- **The codec.** The spec §9.5 profile has typ `bindle-entity-certificate+jwt` and is signed with the acting organization's certification key, never its identity key. The verifier caps the effective lifetime at 300 s (RL-16).
- **Issuance (`relations.certify`, system).** The grantee issues only after checking its own hops, each live:
  - the import is available;
  - an active federation grant of exactly that client approves the import for the field;
  - the grant's connection is live at the recorded generation (the connection-generation fence);
  - the grant's recorded resource generation equals the import mirror's;
  - in member context, the membership is live at exactly the presented id and generation and holds a grant on the import.
- **What the certificate carries.** Methods are member ∩ application ∩ edge, or application ∩ edge in organization context. The certificate binds the edge (`iss`, and `aud` = the grantor's current identity URI), the instance, the grantor's resource ID (one entry of one edge), the edge's scope, `aep` and the holder key. The actor is pairwise unless the entry says `named`. Every refusal is one code.
- **Verification (`relations.authorize`, system).** The grantor runs spec §5.2 steps 1–3 with the §9.5 substitutions:
  - the live edge in `instance` is found with no fetch, through the successor view, and only the current issuer qualifies;
  - the signature is checked against a cache-only certification key, with a dummy verification on every failure path;
  - the DPoP proof (`ath` in the direct form) has its jti recorded once;
  - then the write age rule, the `aep` floor (a higher `aep` holds the counterpart under RL-4 before the refusal), the hold itself, and the envelope within the certificate and within the edge decision.
  - Every failure is one answer: `invalid_token` 401 (direct) or `invalid_grant` 400 (token form).
- **The edge decision.** `relations.edge-check` now uses the same `edgeDecision`: RL-4 holds, the billing stage, the deletion pre-purge, pool re-intersection, required entries and scope, in that instance only.
- **Connections can hold imports.** Each import resource is mirrored as `federation/resource/imp_…`, with provider `relation` and marked `imported`. It is never in the organization's own pool, never a grant value, and never dispatched locally. `relations.import-authority` now applies the connection-generation fence (review L4 follow-up).
- **Federation hunk (`packages/federation/service.mjs`, minimal):**
  - preferences/v2 projects a relation mirror in relay form, with an entity certificate from a `relationImports` port (`federationRelationImports`) as `token`, `token_type` `BindleEntity`, `grantor`, `instance` and `broker`; any refusal reports the member `unavailable` with no reason;
  - preferences/v2 is served with that port even without brokering;
  - v1 and local RPC dispatch refuse relation mirrors, as for brokered resources.
- **Resource scope is now enforced** (design §8b.2 step 3, resource-scoping.md), instead of being refused. A grant may carry `{prefix?, readOnly?:true, maxObjectBytes?}`, only where the resource offers that control and within its bounds. The grantor enforces it on every call, and certificates carry it.

**ORG-10e, relation events and lifecycle (`packages/orgs/relation-events.mjs`, `packages/orgs/relation-lifecycle.mjs`, `packages/orgs/relation-keys.mjs`):**
- **Signed events.** The drain signs each outbox row at delivery with the sender's certification key (typ `bindle-relation-event+jwt`), with the current `aep`, a fresh `iat` and the row's `jti`. The same-host transport hands the JWS to the other writer with **no `from`**. Ingest takes the sender only from the verified signature (ORG-10f production gate 1, for events).
- **Ingest follows spec §9.9 in order:**
  - step 1: with no fetch, the JWS profile, ≤ 32 KiB, exact members, typ, `aud` and the `iat` window. Only a failure here is refused (400); everything else answers `{accepted:true}` (202);
  - step 2: the origin principal is a counterpart, and the sender is its current issuer;
  - step 3: the signature, against cache-only keys. A missing key schedules one refresh for any claimed sender before step 2, so the schedule never depends on participation, and a dummy verification keeps the cost even;
  - step 4: the jti, recorded only after step 3;
  - step 5: widening below the `aep` floor is ignored, narrowing always applies, and a higher `aep` is an RL-4 reset;
  - step 6: an end is final and the highest generation wins.
- **The events endpoint comes from the manifest only (RL-6).** The `manifestEventDelivery` port takes the counterpart's current issuer (through the successor view) and posts only to its validated `relations.v1.events_endpoint`, an https URL on that issuer's origin. ORG-11a plugs its transport in there; until then it is a port with a test double. A redemption answer naming a URL is ignored.
- **Anti-entropy.** `relations.tick` (the account-alarm entry) runs the resync once a day, resumable by cursor. It also runs the sweep, expires write holds with a notice, flags unreachable counterparts, continues the pre-purge, drains, and returns `wakeAt`.
- **Introductions and recognition (spec §9.4).**
  - `relations.introduce`: RL-12, only for a candidate with a live edge to the proposer in that instance and slot. It is sent only to counterparts with a live edge whose slot has entries with the candidate's slot, never to the candidate, with the proposer's fresh statement.
  - Receivers verify the statement, deduplicate per (instance, proposer, slot, candidate), allow 10 a day per proposer, share the 256-item inbound bound, drop muted proposers silently, record nothing while the flag is off, and expire items after 30 days.
  - `relations.admit` issues an ordinary invitation; only the candidate's acceptance makes an edge.
  - Declining or admitting tells only the proposer (`relation-recognition/v1`). The proposer honours a notice only from a recipient of its own introduction.
- **The lifecycle table (§8b.6):**
  - **RL-4 holds.** A higher `aep` on a verified event or certificate, a key reset, a contested identity or an unattested move gives a full hold. An attested move gives a write-only hold for 72 h with notice. The hold is bound to an `aep`, and imports from the held counterpart are marked. Only `relations.confirm-counterpart` for exactly that `aep` releases it; no event does, and a later reset needs a new confirmation. `relations.observe-counterpart` is the directory refresh's entry point.
  - **Counterpart moves.** The successor view maps the destination's events and certificates to the origin principal. The earlier host fails step 2, and delivery goes to the current principal.
  - **The organization's own move (RL-10).** `lifecycle {event:'moved-in'}` suspends outgoing grants with cause `moved` and re-sends every half. `relations.resume` refuses such an edge (`relation_rebind_required`), and `relations.rebind` (widening) re-binds it from the destination pool. On the grantee, an entry that went from one resource to one other keeps its import id (members' grants survive), its generation rises (application approvals need review), and admins are told.
  - **Billing.** `read-only` refuses write-capable methods and widening. `export-only` suspends outgoing grants with cause `billing`; `active` restores exactly those with a new generation.
  - **Deletion takes effect.** The pre-purge step leaves every instance and stops certification. `relations.purge-ready` reports ready once the final events are delivered or 72 h have passed.
  - **Unreachable counterparts.** Delivery failures are tracked, never treated as revocation. After 30 days the console flag is set and every admin is told once.
  - **Key compromise.** Every outgoing grant half gets a new generation.
- **`packages/orgs/key-refresh.mjs` hunk.** `enqueueCounterpartKeyRefresh` adds recognized counterparts (at activation and on an observed move) to the background-refresh set. Claimed senders use the existing bounded `claimed` rows.

**Shared files touched (minimal):**
- `packages/federation/service.mjs`: the projection hunk above.
- `packages/orgs/key-refresh.mjs`: one export.
- `packages/orgs/relation-statements.mjs`: `parseCompact` takes a `maxDepth`, because events nest deeper than statements.
- `package.json`: the two new suites in `test:organizations`.
- Existing relation tests now sign events through the world helper, and `relations.import-authority` grants carry a client and connection.
- `packages/intents/*` and `routes/intents.mjs` were not touched.

**Provisional decisions and readings (reconciled with §8b.10; unsigned):**
- **`scope` in an entity certificate** is an optional top-level member. Spec §9.5 says "`methods` … and optionally `scope`" inside an "exactly these members" table. Flagged for spec review.
- **Prefix scope is checked as given, fail closed.** The call must name a `key` or `prefix` inside the prefix; a call naming neither is refused, and presign is refused. Unlike attenuated child references, the grantee addresses the grantor's resource ID, so keys are not rewritten.
- **Write-capable methods** are, by default, everything outside a read list (get, list, read, status, describe, capabilities, head, subscribe, unsubscribe). A `writeCapable` port takes contract metadata later.
- **Organization-context certificates** (no member) carry `actor:{client}` only, with methods = application ∩ edge.
- **Relay tokens need the session key's public JWK.** Federation tokens store only the DPoP thumbprint, so the projection port receives `token.jwk` when present and otherwise reports the import `unavailable` (production gate 4).
- **The `aep` baseline** is taken from `counterparts.resolve().aep` at activation. A first sighting with no baseline is recorded without a hold.
- **Under a write-only hold**, widening events are still honoured (only write-capable calls are refused). Under a full hold, nothing widening is.
- **Imports from a held counterpart** are marked and stay certifiable (spec: "marked").
- **`relations.confirm-counterpart`** is a widening action: flag, unheld admin, fresh step-up and billing active.
- **Introductions whose statement is older than 300 s** at receipt (an outbox retry) are dropped. The proposer introduces again. Anti-entropy does not re-send introductions.
- **Import ids on rebinding.** Keeping the import id is limited to entries with exactly one resource before and after. Other rebindings mint new ids.
- **Not in this pass:**
  - the entity-certificate status endpoint (the write age rule applies alone);
  - brokered tokens for integration-hosted grantor resources;
  - failure rate limits on `relations.authorize` (the member path has them);
  - doorbell forwarding and the `packages/events` `entity` reader hunk;
  - export and import of participations (ORG-11b);
  - routes and console (ORG-10f, ORG-10g);
  - cross-provider transport (ORG-11a).
- **C9 in the design** is "an introduction never creates an edge, and the candidate's view never contains an undecided or declining party". It is implemented as stated (see the chaos suite).

**Tests (engine level; local evidence only):**
- `tests/orgs-relations-access.test.mjs` (9):
  - issuance hops and binding;
  - certificate scope: resource, methods, another instance, a third entity;
  - expiry, the 300 s cap, the write age rule, an identity-key signature, the holder proof and its replay;
  - the membership-generation and connection-generation fences;
  - imports reachable only through a live edge;
  - aep floor and RL-4;
  - no fetch, with a uniform refresh schedule;
  - resource scope;
  - the federation relay projection: an available token that works at the grantor, local dispatch refused, unavailable under the fence.
- `tests/orgs-relations-events.test.mjs` (17):
  - the signed path, with no adapter sender read;
  - forged, tampered, cross-profile and earlier-key events;
  - replay and jti poisoning;
  - reordering, and stale and higher `aep`;
  - the always-202 answer;
  - no fetch, with anti-entropy recovery;
  - manifest-only delivery;
  - the daily tick;
  - RL-4 resets, and attested and unattested moves with the successor;
  - the RL-10 own move and rebinding;
  - deletion pre-purge; unreachable counterparts; key compromise and billing stages;
  - introductions and their limits.
- `tests/orgs-relations-chaos.test.mjs` (7):
  - 6 seeds × 120 steps, plus an aggregate of 3 seeds × 160 steps asserting that holds, confirmations, introductions and both honoured and refused certificates occur;
  - new operations: `aep` rises, key resets and move adoptions, confirmations (some stale), introductions with admit or decline, and grantee-issued certificates presented at grantors;
  - checked after every step: **C2** (honoured certificates within their own methods and the live edge), **C8** (a floor above the last confirmation always has a full hold; no widening mirror honoured while held; no held certificate honoured) and **C9** (every counterpart record traces to an invitation between exactly those two parties; no introduction names its holder; recognition only at proposers);
  - before the final convergence check, admins confirm the remaining holds;
  - a scratch sweep of 120 seeds (200–319, 200 steps each) passed on the final code.
- **Revert checks in a scratch copy of the tree:**
  - 20 guard mutations, each caught by its suite: event signature, jti after verification, narrowing whatever its `aep`, the C8 block on widening events, the hold at the edge decision, the write age rule, the envelope resource, the connection fence, the membership generation, scope enforcement, the manifest endpoint origin, earlier-host step 2, local dispatch of mirrors, a confirmation bound to its `aep`, the sender only from the signature, refresh scheduling independent of step 2, the write-only attested hold, the 300 s cap, rebind-not-resume, and the grantee's live-edge check;
  - 5 more against the chaos suite alone: C8 events, a confirmation covering a later reset, C8 certificates, an introduction creating an edge, and C2 certificate methods.

**Verification (shared checkout with concurrent documentation and intents work present; local evidence only):**
- Relation suites alone: documents 8, statements 4, relations 17, review 15, chaos 7, access 9, events 17, so **77 passed, 0 failed**.
- `npm test`: **3,769 passed, 0 failed**, 0 skipped, 0 cancelled.
- `npm run test:organizations`: four subprocess suites, **442 passed, 0 failed**, 0 skipped. The node suites are 245, 57 and 130; the browser e2e suite is 10.
- `npm run test:worker`: **93 passed, 0 failed**, 0 skipped.
- One review test from ORG-10a–c, H1 ("scoping is refused"), was rewritten for the enforced scope: a scope is accepted only where the resource offers it, and the grantor refuses writes under `readOnly`.
- No browser or UI test applies: there is no UI in this pass.

No commit or deployment. Production release stays disabled. No delivery to a real external provider, provider conformance or production key custody is inferred from these local tests.


**Review follow-ups (2026-10-24; independent review of ORG-10d/e requested by the coordinator; implemented locally, provisional and unsigned).** The review found no Critical or High issues. It found 2 Medium and 7 Low, plus test gaps; its repros are `scratchpad/rel-review/rel-review2-repros.test.mjs` N1–N4. Each fix below has a regression test in `tests/orgs-relations-access.test.mjs` or `tests/orgs-relations-events.test.mjs`. In a scratch copy of the tree I reverted each fix and each test gap's guard, and each of those 17 mutations made its suite fail.
- **M1: the pre-purge could report ready without leaving every instance.**
  - `leaveSome` now pages through `rel/instance/` with a cursor kept in `rel/closing`, across calls, until every row has been seen.
  - `relations.purge-ready` reports ready only when the instance counter is zero and the cursor is exhausted (the counter is the one the chaos suite checks against the rows), and the final events are delivered or 72 h have passed.
  - Left participations are now indexed by leave time (`rel/left/`). The sweep deletes them 30 days after leaving, with their counterpart records, imports and import mirrors.
  - Leaving also refreshes the import mirrors, so a left instance's mirror is no longer reported available.
- **M2: the federation resource sync deleted import mirrors.** `performResourceSync` now skips rows with `provider:'relation'`. The test syncs with a provider that does not return the mirror.
- **L1: forged generations outlived a key-compromise recovery.** When an admin confirms an RL-4 hold, the generation floor of every mirror of that counterpart's halves restarts at 0 (an end stays final) and `cp.peerEpoch` rises, so the counterpart's next legitimate state applies. The chaos C6 history allows the fall only across such a confirmation.
- **L2:** `bump` keeps a suspension's `cause` while the half stays suspended, so `relation_rebind_required` survives a later narrowing.
- **L3:** `composeRelationScope` composes the edge scope with the certificate's scope under the storage `assignedScope` semantics: nested prefixes (the narrower wins), readOnly from either, the smaller maxObjectBytes. `relations.authorize` returns the result as `context.assignedScope`, and refuses when the prefixes are disjoint. The grantor cannot know an object's size when it decides, so the oversized-`get` refusal belongs to the ORG-10f dispatch, which must pass this scope to the storage adapter (production gate 3).
- **L4:** a throw inside `edgeDecision` during `relations.authorize` is the uniform failure.
- **L5: in-place import ids now need the grantor's mark.** The grantee keeps an import id only when the grantor marks the one-for-one replacement with `replaces` (the earlier resource ID) on the entry's resource. `relations.rebind` sets the mark. Any other change of resource mints a new id, so member grants never silently carry over to a different resource. **Provisional wire extension:** `replaces` is an optional member of the spec §9.9 entry resources, flagged for spec review.
- **L6 (provisional policy):** while the grantor is fully held under RL-4, `relations.certify` drops write-capable methods; reads stay allowed. If nothing readable is left, it refuses.
- **L7:** the sweep prunes `rel/intro-day/*` counters older than today, and `rel/introduced/*` records older than 30 days.
- **Test gaps closed:**
  - a certificate with the wrong `aud`;
  - the pre-purge fence in both `relations.authorize` and `relations.certify`, checked while the edge itself is still live;
  - a lower `aep` refused by the floor alone, with no hold;
  - recognition notices heard only from recipients of the introduction;
  - the preferences v1 exclusion of relation mirrors.
- **Residual recorded:** under RL-4, the write-only hold on an attested move releases automatically after 72 h. A thief who makes an attested move with a stolen current recovery file, and is not noticed by an admin within those 72 h, regains write access through the edges. This is the remaining residual for attested moves, and it is the user's RL-4 trade-off to confirm.

**Verification after the follow-ups (shared checkout; local evidence only):**
- Relation suites: documents 8, statements 4, relations 17, review 15, chaos 7, access 15, events 22, so **88 passed, 0 failed**.
- `npm test`: **3,780 passed, 0 failed**, 0 skipped, 0 cancelled. A first run stalled in `tests/export-hooks.test.mjs`, which is unrelated to relations. That file passed alone (11 of 11), and the fresh full run above passed. The stalled process was left running, because killing it was not permitted.
- `npm run test:organizations`: **453 passed, 0 failed**, 0 skipped (four suites: 256, 57, 130 and 10).
- `npm run test:worker`: **93 passed, 0 failed**, 0 skipped.
- These counts supersede the earlier figures in this entry.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — Test reliability fixes

**Scope:** completed the interrupted, uncommitted reliability work in resource-discovery, export-hooks and dx-integration tests. No product code changed; assertions remain strict. Decisions remain provisional pending review. The concurrent ORG-10f/g work and its routes were left untouched.

**Root causes and changes:**
- Discovery's 10 ms sleep did not establish ownership of the egress slot: budget admission and real WebCrypto token minting happen asynchronously. Both contention tests now wait for fetcher entry, release their gates in `finally`, and await the original request even on assertion failure. The final discovery must succeed on its first attempt; no busy retries were added. Each discovery makes one egress call. `active++` precedes DNS/fetch; the `send` race's `finally` clears the deadline and decrements `active` before its promise settles. `Promise.race` observes both the deadline and exchange rejection. An abandoned blocked request can reject at its deadline after a test fails; this is a test cleanup problem, not evidence of an unhandled deadline after successful exchange. No slot leak or deadline product bug was found.
- Added direct egress coverage with one slot: success, provider failure status, redirect, thrown transport error, oversized streaming body, stalled transport timeout and private DNS refusal must all release the slot. A transport that ignores abort and rejects late stays observed and cannot release a newer request's slot. Waiting beyond the deadlines checks for stray unhandled rejections.
- Export fixture cleanup previously registered directory removal before adapter shutdown. Node 24 skips later after hooks when an earlier hook throws (confirmed with an isolated controlled hook failure outside the repo), so a removal failure could leave a listening server and hang the file indefinitely. One cleanup hook now closes adapters/connections before removing their directories with bounded retries. Port reservation races retry on EADDRINUSE with cleanup already registered. Clients and CLI children prefer IPv4 to match the explicit 127.0.0.1 listener; tests have 180 s timeouts and CLI children have 120 s hard kill bounds. These close concrete hang paths; the historic 30-minute process was not ours and was neither inspected invasively nor killed, so its precise trigger is unconfirmed.
- DX/export generation advances contributor pages and seal steps across alarms. The old DX limit of 60 had no growth headroom. Bounded loops now allow 1,000 steps, stop on terminal states and still require `ready`, reporting the step count and state on failure.
- Searched all `tests/e2e/*.mjs`: all 90 `waitForFunction` calls already take functions (including the shared `SETTLED` function). No string predicates remained to convert; no browser implementation changed or browser verification was required for this search-only result.

**Verification (local shared checkout; concurrent relations edits continued during these runs):**
- Each affected file ran alone 20 times, sequentially: resource-discovery **200 passed / 0 failed** (10 per run), export-hooks **220 / 0** (11 per run), dx-integration **100 / 0** (5 per run): **520 passed across 60 runs**, no skipped/cancelled tests.
- Full `npm test`, run 1: **3,790 passed, 1 failed**, 0 skipped/cancelled. The failure was the concurrent relations public-events test, `tests/orgs-relations-routes.test.mjs:167`, reading `peerGrant` from an undefined checkpoint.
- Full `npm test`, run 2: **3,789 passed, 2 failed**, 0 skipped/cancelled. Both failures were in the concurrent relations owner-route tests at lines 56 and 75: `400 invalid_request` instead of `404 not_found` and `401 reauthentication_required` respectively (assertions at lines 60 and 88). The earlier public-events failure did not recur. All 26 affected reliability tests passed in both full runs; the full-suite green requirement remains unmet in the excluded, actively changing relations scope.
- `npm run test:worker`: **93 passed, 0 failed**, 0 skipped/cancelled.
- Scoped `git diff --check` passed. Verification logs are outside the repo at `/tmp/bindle-reliability/`. Nothing committed; no existing processes killed; no root scratch files created. No production capabilities or release gates changed.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — ORG-10f/g relations routes and console (flags off)

**Implemented locally, provisional and unsigned.** Continuation of the interrupted ORG-10f/g work, following the ORG-10 design, ORG-10a–c and ORG-10d/e entries and their review follow-ups. The existing uncommitted relations changes were inspected and completed. `ORG_RELATIONS_ENABLED` and `ORG_FOREIGN_RELATIONS_ENABLED` remain default off; production release remains disabled. Engine operations run in each organization's account writer; routes and the vendored ngin/dodo console are adapters. No commit or deployment.

**ORG-10f local adapter gates closed (production verification/sign-off remain open):**

1. **Sender evidence:** signed events take the sender only from signature verification; offers, retractions and redemptions use the same-host router's bound organization. Owner inputs refuse a supplied `from`, public join refuses it, and even signed extra event members fail the exact event profile. Foreign transport remains unavailable.
2. **Import preservation:** confirmed the real runtime resource-provider path returns the writer's relation mirrors, and the existing federation sync preserves `provider:'relation'` mirrors absent from provider output. Member views expose only imports held by that member's grants; narrowing can remove a member's only import entirely.
3. **Alarms and dispatch scope:** every relation mutation arms the account alarm; `relations.tick` runs anti-entropy/sweep/drain and counterpart key refresh. Failed claims defer without permanently occupying the first refresh page. Missing/rotated-key events have a bounded untrusted retry inbox (64 × at most 32 KiB, five retries/5-minute retention); retry still passes signature, generation, epoch and live-edge checks. Background refresh observes identity-backed authority epochs and establishes RL-4 holds; outgoing issuance/events use the identity-backed epoch. RPC storage dispatch receives the composed scope, including full-object byte limits on ranged reads. Review caught duplicate resource references selecting a different matrix entry's scope; scope now comes from a live entry authorizing that method/arguments, with a named regression.
4. **Public holder keys:** verified DPoP proofs supply only `{kty,crv,x,y}` to sessions/access records; refresh retains or safely backfills the public key. DPoP/member tokens can issue usable relay certificates from that stored public key. No private JWK material is stored by this change. Bearer-only access without a certified holder remains unavailable for relay imports.
5. **Pre-purge publication:** configured `ORGANIZATION_PURGE` is held until `relations.purge-ready`. The regression verifies public identity/certification-key publication while final events cannot be delivered, then verifies handoff after readiness. It exposed an existing inherited `tick` collision: OwnershipService shadowed the deletion scheduler. `OrganizationTick` now uses a distinct inherited `deletionTick` port; ownership ticking is unchanged. Production purge is still an injected integration, not a verified production executor.
6. **Authorization adapters:** direct entity RPC, DPoP-bound relation RPC and token exchange invoke `relations.authorize`, preserving its single credential failure. Storage runs under its assigned scope. Signed inbound revocation, narrowing, leaving and paged admin export remain reachable with both relation flags off; widening requires the flag, fresh step-up and unheld admin authority. Unknown public targets answer uniformly. `relations.v1` is declared only for an explicitly mounted foreign transport; no adapter advertises it on flags alone.

**ORG-10g:** Relationships tab; one-question sharing wizard; resolved organization identity; scope/expiry choices; full gives/receives and actor/copy/proxy disclosures before acceptance; new-counterparty/new-relation/lookalike warnings; invitation acceptance landing; invitations and introductions in activity; edge suspend/resume/end/narrow/leave; imports and restricted member imports; admin confirmation bound to the RL-4 hold's loaded epoch; rebind after move; introductions/admission; relationship checklists before control change/deletion; keyboard-operable paged JSON export. English and Spanish text is recorded in `packages/i18n/catalogues.mjs` and follows existing console rendering. Browser checks cover Chromium/Firefox, en/es, light/dark, 390/1280 widths, focus, literal untrusted text, private-state fencing and readable errors. The original console browser fixture now expects the additional authorized member-import read.

**Provisional decisions/reconciliation (no human approval):**

- The shipped relation catalogue uses reserved `relations.3sln.example` pins (share, group, supply, accounting engagement), version 1, publisher explicitly unverified. URL selection only resolves those known pins. Arbitrary document fetch and cross-provider transport remain ORG-11.
- **Upgrade alternative:** the earlier engine contained no upgrade operation and events do not carry per-edge pin migrations. A newer additive full pin now issues a replacement-instance invitation through existing consent/acceptance machinery; previous edges remain unchanged until an admin explicitly ends them. This is the design's “upgrade, or a new instance” alternative, **not** normative same-instance per-edge migration. Tests publish a synthetic newer version; no newer version is shipped in the catalogue. Same-instance upgrades and their dedicated activity queue remain unimplemented, and §8b states this limitation.
- Export is a paged inspection export of whitelisted relation records, excluding sessions, proofs and key caches; it is not an authority-restoring import. Participation restoration and foreign interoperability remain ORG-11b/c.
- Doorbell forwarding/entity bus readers, integration-hosted grantor token brokering and the entity-certificate status endpoint remain the previously recorded follow-ups. No external delivery, provider conformance, production custody, legal approval or release permission is inferred from local tests.
- Delegated implementation review found the scope-selection, rotated-key inbox and refresh-queue issues above; they were corrected. This was implementation cross-review, not independent security sign-off. Every unsigned design decision remains provisional.

**Verification (shared checkout; unrelated reliability-job changes preserved):**

- `npm test`: **3,796 passed, 0 failed**, 0 skipped/cancelled.
- `npm run test:organizations`: **503 passed, 0 failed**, 0 skipped/cancelled (271 runtime/core + 72 engine + 148 DOM/browser + 12 built-shell e2e).
- `npm run test:worker`: **93 passed, 0 failed**, 0 skipped/cancelled.
- `npm run test:ui-state`: **488 passed, 0 failed**, 0 skipped/cancelled.
- `npm run test:e2e`: **327 passed, 0 failed, 4 skipped**, 0 cancelled (331 total across the main and isolated suites). The four skips are existing WebKit cases: its Playwright executable is unavailable on this host. Requested Chromium/Firefox relation matrices passed without skips.
- `npm run check:worker`: passed (Wrangler dry-run; no deployment).
- `git diff --check`: passed.
- `npm run build:assets`: passed; public build `e28cf679a958cdfbc15d`, 262 addressed modules; islands build `5304f30b1d12f7b48826`.
- Targeted relations runtime/ownership integration: **6 passed**; relations route matrix: **7 passed**; upgrade cases: **3 passed**; duplicate-resource scope review: **1 passed**; relations client engine: **15 passed**; relations Chromium/Firefox DOM: **18 passed**; built-Worker-shell relation UI: **2 passed** (routed API fixtures; real runtime same-host data/RPC behavior is tested separately).
- Initial browser-run setup raced the concurrent asset rebuild and failed copying a disappearing asset before any test executed. Re-run after the build completed. Earlier development runs also caught the cold-cache delivery and original console exact-read expectation issues; only final results above supersede them.


**Review follow-ups (2026-10-26; independent review of ORG-10f/g requested by the coordinator; implemented locally, provisional and unsigned).** The review found no Critical, High or Medium issues and four Low items; its repro is `scratchpad/rel-review/rel-review3-repros.test.mjs` (R3-1). The regressions are in `tests/orgs-relations-review3.test.mjs` (8 tests), which is added to `test:organizations`, with two expectations updated in the access and events suites. In a scratch copy of the tree I reverted each of 13 guards, and each mutation made its suite fail. No Beam file was touched.
- **R3-L1: the cold-key inbox could be filled by anyone.**
  - `relationsPeer` buffers a cold-key event only when its claimed sender's origin principal (successor view) is a counterpart, in any state but ended, in the instance the event names. That is a local check, and the answer is the same 202 either way.
  - Inbox rows are keyed by claimed sender: at most 8 per sender and 64 in all.
  - The R3-1 flood (70 strangers and a recognized sender naming a foreign instance) now buffers nothing. A recognized sender with arbitrary keys fills at most 8 rows, and a genuine rotated-key narrowing is still buffered and applied.
- **R3-L1, claimed refreshes.** `relations.ingest` and `relations.authorize` now schedule a background key refresh for a missing key only for a sender recognized in the named instance. The runtime's background run also drops any request-path (`claimed`) queue row of a sender recognized nowhere in the organization's view, without a fetch. The engine's earlier policy had starved the counterpart's refresh behind strangers' rows.
  - **Provisional deviation (flagged for spec review):** spec §9.9 step 3, and invariant C7's last clause in design §8b.10, schedule the refresh "exactly as for a non-counterpart". On this host a refresh is a local read, so nothing reaches an issuer. ORG-11 must revisit this before foreign issuers are fetched, because a fetch made only for counterparts would reveal them to the claimed issuer.
- **R3-L2: stale import mirrors were never removed.** When `FederationService` has a `relationImports` port (the runtime always does), the provider's relation descriptors (`relationImportDescriptors`) are the source of truth for `provider:'relation'` rows. A relation row the provider no longer lists is deleted. Without the port, relation rows are kept (the engine-level M2 test). This supersedes item 2 above ("the existing federation sync preserves `provider:'relation'` mirrors absent from provider output").
- **R3-L3: four guards that survived mutation now have tests:**
  - the mirror sync through the real runtime provider path (`federationControllerOptions(...).resourceProvider` → `relationImportDescriptors`): added, then removed when stale;
  - the `relationsJoin` body-key check (a `from` or any extra member is `invitation_invalid`);
  - the member-access holder JWK, kept only when its thumbprint is the token's `jkt`;
  - the ingest flag gate: while `ORG_RELATIONS_ENABLED` is off, widening events are dropped and narrowing still applies.
- **R3-L4: the counterpart key refresh.**
  - `refreshKeys` resumes a cursor over `rel/cp/` (1,024 rows a run, then it wraps), so every counterpart is reached. The test places 1,100 ended rows before the real counterpart.
  - Key-cache rows not refreshed for a whole cache period are pruned; they belong to principals that are no longer counterparts. Ended counterpart records themselves are kept, because an ended pair is final per instance (ORG-10a–c M7 reading).
  - **The bound chosen:** `KEY_CACHE_MS` drops from 1 h to **300 s**, refreshed at half-life. A revoked or rotated counterpart certification key therefore stops verifying here within about 300 s, plus at most one background run, which matches design §8b.4's key-revocation bound. Same-host refreshes are local reads, so the cost is a bounded number of local reads per alarm run (at most 128).

**Verification after the follow-ups (shared checkout, with the concurrent Beam removal in progress; local evidence only):**
- Relation suites (`orgs-relation-*` and `orgs-relations*`): **114 passed, 0 failed**.
- `npm run test:organizations`: **514 passed, 0 failed**, 0 skipped (suites of 282, 72, 148 and 12).
- `npm run test:worker`: **93 passed, 0 failed**.
- `npm test`: **3,787 passed, 0 failed**, 0 skipped, 0 cancelled. The total is lower than ORG-10f/g's 3,796 because Beam suites were removed concurrently. An earlier run, made while that removal was midway, had 26 failures, all in Beam, contact and links suites. With this round's four changed files restored to HEAD in a scratch copy, those suites still failed. None was a relation suite.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — RTC signaling extension design

**Design only:** [spec](docs/spec/rtc-signaling.md) and [design](docs/architecture/rtc-signaling.md), revision 1, plus a provisional supersession note at the top of [beaming](docs/spec/beaming.md). No code changed. Nothing is implemented, routed or production-verified, and no tests were run. Every item is **provisional** (coordinator), not signed off by the user.

**Direction (user, 2026-10-26):** a generic, secure Bindle extension for cross-provider WebRTC signaling, for own devices or devices of different users, for any purpose. App experiences stay out of core: Beam's file transfer becomes an app on the primitive. Follow-up direction the same day: build it on the existing extension system ([extensions](docs/spec/extensions.md)), name gaps and propose the smallest addition, and reconcile with [beaming](docs/spec/beaming.md).

**Design:**
- **Building blocks, all existing mechanisms:**
  - the `rtc-signaling.v1` feature (provider-to-provider endpoint);
  - the exclusive `rtc-signaling/v1` slot, whose built-in occupant has a non-brokerable contract (`register`, `open`, `claim`, `send`, `listen`, …);
  - an optional `ice-relay/v1` slot;
  - `rtc-purpose` artefacts (media, alert, parties, auto-accept, context schema);
  - an `rtc-ticket/v1` link type (nearby QR, call-me links, callbacks).
- **One extension gap:** AMD-X1, bound consumer options. A slot member `bind` (in `crit`), `options` on slot fragment requests, and per-consumer approved values, with versions, recorded in the grant. These let each app's purposes be part of its approval.
- **Security:**
  - Per-session leg keys, certified by the entity's issuer with its certification key, sign every message end to end, and providers relay them unchanged.
  - DTLS fingerprints are bound into the signed SDP. Endpoints can optionally verify the peer's keys directly, and a committed 6-digit SAS can detect provider substitution.
  - The spec tabulates what each provider can still do.
- **Privacy:**
  - A uniform `202`, no request-path fetch except after a verified link, and no ringing or busy signal.
  - No address leaves a device before the first claim; SDP never carries candidates; relay candidates carry no real `raddr`.
  - Cross-entity sessions default to relay-only, and each party funds its own relay.
  - Per-session keys, so endpoints cannot be linked across sessions; no device inventory crosses entities; SDP is deleted on delivery; session records are kept at most 24 h.
- **Admission:** own entity, a contact link with owner-side RTC configuration, a ticket, or an opt-in request policy (off by default). A relation basis is reserved. Blocking, muting and quarantine are silent.
- **Sessions:**
  - fan-out to eligible endpoints, with an atomic first claim at the callee's writer;
  - crossing invites resolved by the lower `sid`; perfect negotiation with the callee as the polite peer;
  - limits of ring 120 s, session 24 h and leg certificate at most 900 s;
  - moves and revocations end legs through signed control statements;
  - multi-party is a non-goal.

**Decisions for the user:** RTC-1 to RTC-17 (design §9). Notably:
- RTC-1: the shape on the extension system.
- RTC-2: AMD-X1.
- RTC-3: leg-key signatures.
- RTC-6: the relay-only default. With hosted relay off, cross-entity sessions need an opt-in to connect directly.
- RTC-7: each party funds its own relay.
- RTC-8: no presence signal.
- RTC-14: Beam leaves core.
- RTC-17: the caller's app origin is disclosed to the callee.

Proposed amendments (unsigned): AMD-X1 and AMD-R1 to R6.

**Implementation plan (design §8):**
- **Slices:** RTC-a to RTC-i (validators, purposes, AMD-X1, engine and storage, foreign transport, relay, owner UI, the Beam reference app, a clean-room peer).
- **Flags:** `RTC_SIGNALING_ENABLED`, `RTC_FOREIGN_ENABLED` and `RTC_TICKETS_ENABLED`, all class (a) and default off; `RTC_TURN_ENABLED`, class (b). Narrowing is never gated.
- **Tests:** engine tests, seeded chaos with invariants C1 to C10, and adversarial and browser cases.
- **Beam code:** the TURN adapter and the credential lifecycle are reused. Offers, mailbox, signals and invitations are replaced. The routes are retired after migration. The transfer UI and framing move to the app.
- **Coordination:** the shared files (flags registry, providers, route index, `packages/runtime/federation.mjs`, `packages/federation/extensions.mjs` and `schema.mjs`, i18n) are under concurrent edits and change only by hand-off.

**Review:** one forked adversarial round found 7 High, 11 Medium and 6 Low issues (design §10), all applied. The High findings:
- ticket uses spent before verification;
- a session lookup that could never match callee answers;
- a relay-only rule that broke connectivity;
- contradictory host-candidate rules;
- cross-app auto-accept;
- unbounded key refresh;
- a long revocation window.

The pending sign-off digest (docs/release/pending-signoffs.md) was not updated.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — Beam removed from core

**Direction (user, 2026-10-26):** app-level experiences such as device-to-device file transfer belong in apps, not in the 3sln.me core. The generic cross-provider WebRTC signaling extension ([spec](docs/spec/rtc-signaling.md), [design](docs/architecture/rtc-signaling.md)) replaces it; it is designed, not implemented. **Supersedes D048** (paid WebRTC beaming). Implemented locally; nothing is production-verified. Every decision below is **provisional** (coordinator), not signed off by the user.

**Removed:**
- `packages/beaming/` (offers, mailbox, signals, nearby invitations and QR, ICE issuance, funding), `packages/runtime/account/beams.mjs`, `packages/runtime/routes/beams.mjs` and every `/api/beams/*` route.
- The Beam UI: `apps/web/src/{bl,ui,providers}/*beaming.mjs`, the `file-beaming` portal module (nav "Beam files", `beaming.open`, `g f`), the `beam-invite` fragment, `.beam-*` styles and 76 Beam-only strings per locale (en, es).
- Tests: `beam-ice-retry`, `beam-turn-lifecycle`, `beaming-nonparticipant`, `beaming-runtime`, `beaming-security`, `tests/browser/beaming*.mjs`, `tests/e2e/beaming.test.mjs`. Their contact, profile and TURN cases were ported (below).
- Config: the Beam keys in `wrangler.jsonc` and `wrangler.local.jsonc`, and `BEAM_MONTHLY_*` in `apps/node/server.mjs`.

**Kept and moved (generic contact code):**
- `packages/links/contact-profile.mjs` (`ContactProfiles`): the contact profile, per-link profile sharing, redemption bindings with the peer index, saved contacts, disclosure and the public contact profile. Federation's embed view, the public contact profile, contact revocation and the contacts list all use it.
- Account slice `packages/runtime/account/contact-profile.mjs`; routes `packages/runtime/routes/contact-profile.mjs`, mounted where `beams` was, before `contacts`.
- RPC renames: `beamProfile`→`accountProfile`, `beamContactEnable`→`contactSharing`, `beamContactRedeem`→`contactRedeem`, `beamContactRemember`→`savedContactRemember`, `beamDirectory`→`savedContacts`, `beamContactForget`→`savedContactForget`, `beamContactInfo`→`contactInfo`, `beamDisclosed`→`contactDisclosed`. `contactProfile` is unchanged.
- Route rename: `PUT /api/contacts/{id}/beam` became `PUT /api/contacts/{id}/sharing`, body `{profileFields}` (or `discloseProfile`). The other paths are unchanged.
- UI: saved contacts, the contact profile and the sharing dialog now live in the Contacts view (`apps/web/src/{bl,ui}/contact-book.mjs`, state `contactBook`). The account-epoch guard is now `bl/guarded-action.mjs`, still keyed on `beamGeneration`. `RenameDevice` moved to `bl/devices.mjs`.
- Saved contacts (`saved-contact/`) stay for now. **Whether they belong in core is a pending user decision.**

**Decisions (provisional):**
- **Re-key with read fallback.** The new keys and the legacy keys they replace:

  | New key | Legacy key |
  | --- | --- |
  | `profile` | `beam/profile` |
  | `contact-sharing/<grantId>` | `beam/grant/` |
  | `contact-redeemed/<grantId>` | `beam/redeemed/` |
  | `contact-redeemed-peer/<peer>/<grantId>` | `beam/redeemed-peer/` |
  | `saved-contact/<linkOwner>` | `beam/directory/` |

  *Revised by review follow-up R1 (below):* for release v1 every write keeps both keys with one `updatedAt` stamp, the legacy row stays authoritative, and legacy rows are not deleted until `beam-retired-v2`. Revocation cleanup (`links/audience.mjs`) deletes both generations.
- **`beam-retired-v1`** (`packages/runtime/beam-retirement.mjs`): an idempotent account step that runs in bounded batches (64) on warm and on the alarm. It does three things:
  - copies the generic rows forward without deleting them (`beamEnabled` is not copied), and prunes a neutral copy whose legacy twin was deleted (revised by R1);
  - deletes `beam/offer/`, `beam/usage`, `beam/mailbox/`, `beam/invite/` and `beam/nearby/`; on the alarm path only, it first revokes unexpired TURN usernames, within the batch budget (revised by R3);
  - writes the marker `migration/beam-retired-v1` after a clean full cycle. The marker stops only the warm-path calls.
- **Contact `beamEnabled` dropped, not converted.** Contact RTC configuration will be designed with RTC.
- **Export gap fixed.** `beam/` was excluded as transient, so the profile, saved contacts and sharing grants were missing from account export. New contributors: `profile`, `contact-sharing`, `contact-redemptions` and `saved-contacts` (the encrypted link URL is not exported). During v1 they export the authoritative legacy rows, and the neutral copies are listed as excluded forward copies (revised by R1); `profile` and `beam/profile` match exactly (R4). `contact-redeemed-peer/` and `migration/` are excluded as derived.
- **TURN building blocks.** `packages/rtc/turn.mjs` (`CloudflareTurnAdapter`, `RtcError`) and `packages/rtc/relay-credentials.mjs` (lease, issue, revoke, sweep, reservation cap, generalized from Beam's ICE lifecycle) are tested and unused. Nothing else of RTC is built.
- **Flags retired.** `BEAM_ENABLED`, `BEAM_TURN_ENABLED` and `BEAM_STUN_ENABLED` moved to `RETIRED_FLAGS` (`retiredOn 2026-10-26`), guarded by `tests/flags-registry-removals.test.mjs`; they stay in the lock fixture. Flag tests that sampled `BEAM_ENABLED` now use `ACTIVITY_V2_ENABLED`, `EVENT_BUSES_ENABLED` or `SEMANTIC_SEARCH_ENABLED`. Two tests that ran three concurrent experiments now run two, because only two experiment flags remain.
- **Contact routes no longer require a current device session,** which only Beam needed. Other owner contact routes never required one.
- **The peer index is kept** with a bounded `peerBindings(owner, peer)` lookup that no route uses yet. It was Beam's permission lookup and could be dropped later.

**Docs:** [beaming](docs/spec/beaming.md) is now a superseded stub. Its contact-profile rules moved to [contact-tokens](docs/spec/contact-tokens.md) "Contact profile, sharing and saved contacts". The Beam architecture doc, deployment doc and walkthrough images are deleted. rtc-signaling §5 and §6, self-hosting, feature-flags, app-engine, account-deletion-export, messaging-extraction, pending-signoffs (MC-1: the Beam exception is moot) and the other references are updated.

**Tests added:**
- `tests/contact-profile.test.mjs` (15 after the review follow-ups): HTTP profile, sharing, redeem, directory and disclosure; the route registry; the read fallback; the disclosure allowlist; saved-contact bounds; revocation cleanup of both key generations through `collectLinkState`; `beam-retired-v1` batching, marker, idempotence and revocation; the warm migration; and the export inventory and pages.
- `tests/rtc-relay-credentials.test.mjs` (9).
- `tests/browser/contact-profile.mjs` (8).
- Adapted: `links-wargame3`, `contact-quarantine-silence`, `contact-preview`, `work-budget`, `classifier-occupant`, `core-links`, `engine-account-export`, the flag suites, `release-state`, the e2e `ui-chaos`, `ui-quality-round2`/`round3`, `worker-flow` and `links-worker`.

**Review follow-ups (2026-10-26; independent review requested by the coordinator; implemented locally, provisional and unsigned).** The review found nothing blocking and no regression in the contact hardening. Every fix has a regression test that fails when reverted.
- **R1 (Medium): rollback reversibility.** "A newer row under the new key wins" was backwards for the only state in which both rows can exist: a rollback to, or a mixed deployment with, the pre-removal code, which uses only `beam/` keys. Before the fix, a withdrawn disclosure written by rolled-back code was silently re-enabled by a stale neutral copy. Rolled-back code also could not see a moved redemption binding, so a second peer could bind the same link.
  - **Coordinator decision:** dual-write both keys for one release, and keep legacy rows in v1.
  - **Writes and deletes.** Every write stamps the same `updatedAt` on both rows in one transaction, and every delete removes both. The legacy sharing row keeps its stored `beamEnabled`, so a rollback reads it unchanged.
  - **Reads (`pickRow`).** The legacy row decides whether a row exists. Its content wins unless both rows are stamped and the neutral one is strictly newer.
    - **Deviation from the coordinator's wording:** an unstamped legacy row is never treated as older than a migrated copy. It was written by pre-removal code, so it is either the copy's source or a later rollback write.
    - A neutral row whose legacy twin is missing was deleted by pre-removal code and reads as absent. v1 never creates one without the other.
  - **`beam-retired-v1`** copies and prunes from a stored cursor. The alarm path keeps reconciling one slice per alarm even after the marker, so rollback writes made after the marker are still copied.
  - **Export.** During v1, export reads the legacy rows, so dual rows are exported once.
  - **Follow-up `beam-retired-v2`,** after a release, not implemented: reconcile once more, delete the legacy rows, read only the neutral keys, and move the export contributors to them.
  - **Tests:** "R1 rollback: …" (two tests), the v1 reads and dual-write test, and the export test.
- **R3 (Low): conflicting sharing body.** A body with both `discloseProfile:false` and `profileFields` disclosed fields while being classified as protective and terms-exempt.
  - Such bodies are now refused (`contact_sharing_invalid`).
  - Capacity admission, the terms gate and the service share `packages/links/sharing-fields.mjs` (`effectiveSharingFields`, `withdrawsSharing`). A body is protective only when it is a well-formed change that discloses no field.
- **TURN revocation off the request path (Low).** Before the fix, TURN revocation was unbounded and ran on the request path.
  - The warm path never calls the TURN provider. With TURN configured, it leaves offers that still hold live credentials for the alarm.
  - The alarm path revokes within the batch budget.
  - The warm call is wrapped in try/catch and falls back to an alarm a minute later.
- **R4 (Low): exact singleton keys.** `profile` and `beam/profile` match only exactly in the export inventory and pages (`EXPORT_SINGLETON_KEYS`).
- **Pre-existing failure fixed.** The semantic writer test in `packages/runtime/account/flags.test.mjs` failed because the semantic admission gate needs a paid plan or an account at least 7 days old. The fixture now backdates `account/created-at`. `npm test` now also runs `'packages/**/*.test.mjs'`, which adds `packages/runtime/account/flags.test.mjs` and `packages/runtime/routes/flags.test.mjs`.

**Verification (shared checkout, concurrent relations work in flight; local evidence only):**
- `npm test`: **3,796 passed, 0 failed**.
- `test:worker`: **93 passed**.
- `test:ui-state`: **486 passed**.
- `test:organizations`: **514 passed**.
- `test:e2e`: **324 passed, 0 failed, 4 skipped** (328).
- `build:assets` and `check:worker` (dry run) succeeded.
- At that point the semantic writer test in `packages/runtime/account/flags.test.mjs`, which was then outside `npm test`, failed the same way at HEAD 54124aa. It is fixed in the review follow-ups.

**Verification after the review follow-ups:**
- `npm test`, which now includes `packages/**/*.test.mjs`: **3,823 passed, 0 failed**.
- `test:worker`: **93 passed**.
- `test:ui-state`: **486 passed**.
- `test:organizations`: **514 passed**.
- Contact suites (`contact-profile`, `rtc-relay-credentials`, `links-wargame3`, `contact-quarantine-silence`, `engine-account-export`): **52 passed**.
- `test:e2e`, `build:assets` and `check:worker` were not rerun; the follow-ups changed no web UI.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — RTC-a/b/c validators, purposes and bound options (flags off)

**Implemented locally, provisional and unsigned.** First slices of the [RTC signaling](docs/spec/rtc-signaling.md) plan ([design](docs/architecture/rtc-signaling.md) §8.1): RTC-a (wire validators and codecs), RTC-b (the `rtc-purpose` kind) and RTC-c (AMD-X1, bound consumer options in the extension system). The four RTC flags exist and default off, and none gates code yet. Nothing is routed; there is no session engine, transport, relay, owner UI or reference app (RTC-d onward). No commit or deployment. Every decision and reading below is **provisional** (coordinator), not signed off by the user.

**RTC-a (pure, no I/O):**
- `packages/rtc/jws.mjs`: the links §3.1 profile shared by the three RTC JWS types (exact `{alg, kid, typ}` header, canonical segments, strict I-JSON, 64-byte ES256, received-bytes signature input).
- `packages/rtc/messages.mjs`:
  - `bindle-rtc-message+jwt` parse and verify (spec §6.1, §6.2), the §6.4 receipt window and the §7.3 sid comparison;
  - the §6.3 SDP rules: CRLF, trickle, no candidate lines, unspecified `c=`/`a=rtcp`/`o=` addresses, `m=` kinds consistent with the invite's media, a strong fingerprint;
  - the §6.3 candidate rules: RFC 8839 syntax, relay `raddr`, mDNS-only host cross-entity;
  - the §10 IP-policy filter and the "no SDP or candidate before the claim" rule;
  - the §8.1 batch codec and the §8.2 step 1 checks that need no fetch.
- `packages/rtc/certificates.mjs`: leg certificates (§5.1: issuance clamped to the declared bound and the session end; verification against the issuer's active certification keys as held, with the identity URI the verifier resolved itself; renewal invariants) and control statements (§5.2).
- `packages/rtc/tickets.mjs`: the `rtc-ticket/v1` meta payload, callback tickets, canonical basis links and `link_digest` matching. Minting, use counting and revocation stay in RTC-d.
- `packages/rtc/extension.mjs`: the signaling and ice-relay slot manifests, the `rtc-signaling.v1` feature validator and the AMD-X1 bound-artefact table.

**RTC-b:** `packages/rtc/purposes.mjs` validates purpose bodies (§3.4). It reuses the intents data-schema and disclosure validators for `context`, and adds the proposed growth table (AMD-R4), widening detection, invite checks (media, parties, context) and context projection. The four candidate lines are in `docs/artefacts/rtc-purposes/` and are registered as operator documents in `packages/runtime/artefact-pins.mjs`, following the intent-kind pattern; their digests are pinned by tests. Following the `relation` precedent, `rtc-purpose` is **not** in `DEFAULT_KINDS`: until its growth table is signed, only exactly pinned versions are usable, URL-only pins are refused (`artefact_unverifiable`) and heads never advance.

**RTC-c (AMD-X1), behind `EXTENSIONS_ENABLED`:**
- `packages/federation/extensions.mjs`: the `bind` slot member, which must be in `crit` and is unrecognized for a processor without AMD-X1. It also has the pure request, approval (subset), coverage, narrowing and version rules, and the occupant check.
- `packages/federation/service.mjs`:
  - requires valid `options` on bound fragment requests, and refuses `options` elsewhere;
  - pins bound artefact lines from provider-held reviewed references only; an unregistered line is refused, never fetched by URL;
  - shows them in the consent view;
  - records `bound: {schema, values, versions, revision}` in that app's grant;
  - refuses the already-approved shortcut for wider values or a changed version.
  - New ngin operations: `federation.narrow-bound-options` (owner, immediate, every active grant of the app) and `federation.bound-approval` (occupant read; the union of the token's live grants). There is also `checkBound`.
- `packages/federation/runtime.mjs` and the composition row in `packages/runtime/federation.mjs`.
- The shared consent kit (`apps/web/src/ui/authorize-entry-consent.mjs`) lists each requested value with plain facts (title with the host of its id, media, ringing, parties, the context names shown before answering). Nothing is preselected, approval waits for the minimum, and only checked values are sent. Spanish strings are in `packages/i18n/authorize-catalogue.mjs`.
- [extensions §13](docs/spec/extensions.md#13-amendment-amd-x1--bound-consumer-options-proposed-unsigned) now carries the amendment text, marked proposed and unsigned, with rows in §2.1, §2.2, §5.2 and §11. `packages/federation/schema.mjs` needed no change.

**Flags:**
- `RTC_SIGNALING_ENABLED` (a, G A, crit, stateful) requires `EXTENSIONS_ENABLED` and `ARTEFACT_VERSIONS_ENABLED`.
- `RTC_FOREIGN_ENABLED` (a) requires `RTC_SIGNALING_ENABLED` and `DIRECTORY_ENABLED`.
- `RTC_TICKETS_ENABLED` (a) requires `RTC_SIGNALING_ENABLED`.
- `RTC_TURN_ENABLED` (b) is a new flag, not a rename of `BEAM_TURN_ENABLED`.
- Also updated: the registry test (62 flags, 29 class a) with a dedicated RTC test, the name lock, feature-flags.md and self-hosting.md (the stale "61 entries" is now 62). The edits are additive beside the concurrent `LINKS_ENABLED` rename.

**Provisional decisions and readings (reconciled in extensions §13 and design §8.1; none signed):**
- The invite `offer` and accept `answer` are SDP strings; `to` is null for both `invite` and `cancel`; the invite's `ring_until` must also be after `iat`.
- A srflx `raddr` is a host address, so cross-entity it must be unspecified, mDNS or absent (the spec states the rule only for relay and host candidates). Unknown candidate extension attributes are refused, since one could carry an address. Any weak (sha-1, md5) fingerprint invalidates an SDP. Outside `o=`, `c=` and `a=rtcp`, an `IN IP4/IP6` token or a dotted IPv4 literal anywhere in an SDP is refused (defence in depth).
- A batch's messages must all share one (`iss`, `sub`, `aud`); duplicate carried links are refused.
- Purpose `categories` must be a sorted subset of the six known values (stricter than incremental authorization's "unknown values are ignored"). The candidate purposes declare `personal-data`. Their English and Spanish copy is a placeholder for review.
- AMD-X1 readings (extensions §13): `options` carries only bound members; an invalid bound request fails the whole authorization (`invalid_request`), as other invalid fragment requests do here; the approval identity is `bound.revision` (brokered `bindle.grant` derivation deferred, because the only bound slot is non-brokerable); widening is a new consent (`grant-more` deltas and "already granted" labels for bound values are a follow-up); narrowing reaches every active grant of that app; with `EXTENSIONS_ENABLED` off a pending bound request cannot be approved (`unsupported_fragment`).

**Review:** this was a coordinator self-review, not independent sign-off. In a scratch copy of the tree I reverted each of 39 guards (SDP and candidate rules, policy, message bindings, batch step 1, certificate key status, identity, thumbprint, lifetime and skew, ticket bounds, purpose rules and registry validation, `bind`/`crit`, approval subset, narrowing, version use, prior-approval coverage and versions, smuggled options, unregistered lines, narrowing reach, the kill switch, consent no-preselection and minimum, and flag defaults). 38 made their suite fail. Two survivors were fixed by strengthening the tests: prior-approval coverage, now tested with a generic bound enum slot, and narrowing reach, now tested with two grants. The remaining survivor is equivalent: the purpose growth rule's "not added to `required`" clause is already enforced because `required` is a frozen array.

**Verification (shared checkout; concurrent messaging-extraction work in flight; local evidence only):**
- New suites: `rtc-messages` **12**, `rtc-certificates` **8**, `rtc-tickets` **4**, `rtc-purposes` **6**, `extensions-bound-options` **11**, `browser/consent-bound-options` **2** (added to `test:ui-state`); all pass.
- `npm test` in the main checkout: **3,875 tests, 3,870 passed, 5 failed**. The failures are `contact-preview` (4) and `deletion-http` (1), which read the built shell. `.output/public` is incomplete because `npm run build:assets` currently fails in this checkout on the concurrent change `packages/messaging/tags.mjs` → `../core/tags.mjs` ("Unmapped public module"), which is not part of this work. In a fully built scratch copy those suites pass (13/13).
- `npm test` on a scratch copy of HEAD b09140b plus only this work (registry hunks applied to HEAD's registry): **3,864 passed, 0 failed**.
- `npm run test:worker`: **93 passed**. `npm run test:ui-state`: **490 passed** (488 plus the two consent-kit DOM tests).
- `npm run build:assets` on the HEAD-plus-this-work copy: passed (public build `92ac2a21ae362d52d5a1`, 262 modules; islands `5304f30b1d12f7b48826`). It fails in the main checkout for the reason above.
- `npm run test:consent` on that copy: **25 + 28 passed**, including the Playwright consent browser suite.
- E2E on that copy: the CX-2 incremental consent e2e passed. The authorization-entry e2e cases (6 failed, 1 skipped) fail identically on a pristine HEAD scratch copy (`Failed to fetch` on `/api/oauth/entries`), so this is an environment limitation of scratch copies. The full `test:e2e` and `check:worker` were not run in the main checkout, because its asset build is blocked.

Reviewer: ___ Date: ___ Outcome: ___

### Review follow-ups (2026-10-27, independent security review; provisional, unsigned)

An independent review of the uncommitted RTC-a/b/c work raised one medium finding (M1), seven low findings (L1–L8) and three informational items. All are fixed locally. Each confirmed proof-of-concept case is now a regression test. The spec changes are applied as **AMD-RV1** in [rtc-signaling](docs/spec/rtc-signaling.md) §5, §6.3, §10, §11.3 and §18, and the AMD-X1 readings are in [extensions §13](docs/spec/extensions.md#13-amendment-amd-x1--bound-consumer-options-proposed-unsigned). Every reading below is provisional (coordinator) and not signed off.

**Media security (`packages/rtc/messages.mjs`):**
- **M1.** Every `a=fingerprint` line in an SDP must carry the same (algorithm, value) pair, compared case-insensitively. A session-level versus media-level split can no longer make the SAS cover a different fingerprint from the one DTLS checks. An SDP whose only fingerprint is sha-384 or sha-512 is valid but gives no SAS input.
- **L1.**
  - `candidate`, `remote-candidates` and `end-of-candidates` lines are matched case-insensitively, and so are `IN IP4`/`IN IP6` tokens.
  - The `o=` username and session-id must be `-` or digits, and the session version must be digits. Reading: Firefox writes `mozilla...THIS_IS_SDPARTA-…` as the username, so endpoints rewrite it to `-` before sending (it has no protocol effect). Recorded in the spec.
  - `u=`, `e=` and `p=` lines are refused. This goes beyond the review, which named only `u=`.
  - Outside the address fields and the fingerprint value, these are refused: an unanchored dotted run of four numbers, which catches a leading dot and five-number runs, and any run of hex digits, dots and colons with two or more colons, which is IPv6-like. A Chrome-style audio/video offer with real `extmap`, `fmtp` and `ssrc` lines still passes.
- **L2.**
  - In cross-entity sessions, srflx and relay addresses must be public. `nonPublicAddress` refuses unspecified, loopback, RFC 1918, RFC 6598, link-local, multicast and reserved IPv4. It also refuses unspecified, loopback, link-local, site-local, ULA and multicast IPv6, including IPv4-mapped, IPv4-compatible and NAT64 forms of a non-public IPv4 address. Documentation ranges are allowed, since they reveal nothing.
  - Under `public`, a srflx `raddr` must be unspecified, mDNS or absent. Only own-entity `all` may reveal the host base address.
  - An mDNS name must be a UUID followed by `.local`.
  - The spec was less strict on all three points and is amended (AMD-RV1).

**Signatures and keys:**
- **L3** (`jws.mjs`). `parseRtcJws` refuses high-S ES256 signatures (s > n/2), and `signRtcJws` normalizes to low-S. Design §8.1 now states the RTC-d note: a reused `seq` has "the same content" only when its payload bytes are identical. A second signature over the same bytes is a duplicate, while a re-serialized payload with equal JSON is different content.
- **L4** (`certificates.mjs`). `verifyControl` requires `expected.iss` and `expected.sub` (as well as `aud` and `sid`) and refuses when they are missing.
- **L5** (`certificates.mjs`).
  - Keys use the directory document's shape (`{kid, use, alg, jwk, state}`), and only `use: 'cert'` with `state: 'active'` (and `alg` ES256 when present) verifies. The old `status` member is no longer read.
  - `certificationKey` also accepts a lookup function. `directoryCertificationKeys(directory, {issuer, subject, identity})` adapts `Directory.resolve({purpose: 'certification'})`, which matches only `cert` keys active in both the cached document and the pin.
  - A `sig` key never verifies a leg certificate or control statement (R4-H1 preserved).

**Bound options (`packages/federation`):**
- **L6** (`service.mjs`).
  - `federation.bound-approval` is system-only (`actor.kind === 'system'`; any other actor gets `forbidden`).
  - `boundApproval` and `checkBound` require the verified token's `grants` (a nonempty array of at most 256 ids); there is no fallback to all of the consumer's grants. An optional `epoch` filter is applied, and with connections mounted a grant counts only while its connection is live, as in `priorApproval`.
- **L7** (`incremental.mjs`, `incremental-ports.mjs`). `grant-more` for a fragment whose slot has `bind` is refused at admit with `unsupported_fragment` and the message "This access has options that need a full authorization request; incremental requests cannot add them yet." The owner-shard commit refuses it as a backstop.
- **L8** (`service.mjs`). `beginEntryAuthorization` records the bound selections it offered as "already approved" (`request.priorBound`). In the approve transaction, an identical resubmission is approved only while a live grant covers it: active, same epoch, live connection, `boundCovers`, and the same recorded versions. Otherwise the call fails with `stale_consent` once and clears the offer. The entry page already falls back to the consent review on `stale_consent`, so the owner's explicit approval there is an ordinary new consent.

**Informational items:**
- `rtcBoundArtefacts(enabled)` in `packages/rtc/extension.mjs` makes RTC purpose references resolve only while `RTC_SIGNALING_ENABLED` is on; while it is off, a bound purpose request is refused. The composition in `packages/runtime/federation.mjs` uses it (one-line additive edit; `EXTENSIONS_ENABLED` still gates `bind`). Observed: in legacy env mode `siteGlobal` returns `RTC_SIGNALING_ENABLED='true'` even without its dependencies, the same as for other flags.
- `RTC_TURN_ENABLED` now has `requires: ['RTC_SIGNALING_ENABLED']`, the same metadata as `REDIRECT_EXTENSION_ENABLED`. Class b env reads do not evaluate dependencies, so RTC-f must check both flags. Updated: the registry test, feature-flags.md, self-hosting.md and design §3.3/§8.1.
- `principalValid` honours `allowLoopback`.

**Verification (local evidence only):**
- Suites in the main checkout:
  - `rtc-messages` **16**, `rtc-certificates` **10**, `rtc-tickets` **5**, `rtc-purposes` **6**, `rtc-relay-credentials` **9**, `extensions-bound-options` **17**: all pass.
  - Flags suites (`flags-*`, `metadata-discovery-flag`, `wargame4-flags`, `packages/runtime/account/flags.test.mjs`): **127/127**.
  - Incremental, wave3b, artefacts, authorization-entry, consent and classifier suites: **248/248**.
  - `test:worker` **93/93**; `test:ui-state` **490/490**.
- The main checkout's `build:assets` still fails on the concurrent `packages/messaging/tags.mjs` → `../core/tags.mjs` ("Unmapped public module"). This was confirmed on an rsync copy, without building in the checkout itself. So full `npm test` ran on a scratch copy of HEAD b09140b plus only the RTC work. The RTC hunks were applied by hand to HEAD's registry, registry test, name lock and `packages/runtime/federation.mjs`. Results: `build:assets` passed (public `92ac2a21ae362d52d5a1`, islands `5304f30b1d12f7b48826`), and `npm test` gave **3,878 passed, 0 failed**.
- Revert check: in a scratch copy, each of **34** guards was reverted one at a time. All 34 made their suite fail. The first pass had four survivors, and each was fixed by adding a test: the lower-case `IN IP` token, the commit backstop, the version comparison in the live re-check, and the composition gate.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — Messaging extraction prep (no reset)

**Direction (user, 2026-10-20):** peer messaging leaves the core and becomes its own app (Parley). This entry covers only the preparation that needs no user decision.

- **No data was reset and no legacy messaging was deleted.** BB-CUT, with its irreversible `messaging-retired-v1` reset, still needs the user's explicit confirmation ([open items](docs/release/open-items.md) D1).
- Implemented locally; nothing is production-verified.
- Every decision below is **provisional** (coordinator). None is signed off by the user.
- The plan is updated in [messaging extraction](docs/architecture/messaging-extraction.md) §2.8.1, §2.8.2 and §4.

**1. App-originated items have their own activity families.**
- **Families.** `packages/activity/app-messages.mjs` defines `app-message/<owner>/<id>` and `app-message-usage/<owner>`. The record shape is unchanged: signed `appNotification` provenance, placement, tags, read state, presentation history, postbacks and `blobRef`. `createAppNotification` now writes only these families, never `message/` or `message-usage/`.
- **`app-messages-v1`** (marker `migration/app-messages-v1`, plus a cursor):
  - It moves an existing `message/` row only when the row's v1 admission attestation verifies against `APP_NOTIFICATION_PUBLIC_JWKS`, bound to issuer, owner and ID.
  - Each move is one transaction that moves the record and adjusts both counters by `size + presentationBytes`.
  - An existing target is never overwritten. A row whose provenance changed mid-pass is left for the next pass.
  - Without a usable key set nothing moves and the cursor stays put.
  - Unverifiable rows stay in `message/` as peer history, so the §4 reset treats them as peer records. This matches the activity-center rule that unverifiable legacy records are never promoted.
  - **Scheduling.** The warm path runs one 64-row slice per call until the marker exists. The alarm path runs one slice per alarm even after the marker (a rollback to pre-move code could write app rows into `message/`), but reschedules itself only while the marker is missing. Like `beam-retired-v1`, it never fails a request.
- **Readers of both families.**
  - `MessagingService` read, update, `applyAutomatedTags`, delete and the unindexed list.
  - Presentations (the counter follows the item's family) and postbacks (the path is re-resolved inside each transaction).
  - Notification eligibility and `nextDue`.
  - Search revisions and documents; the item-index and search backfills share one cursor across both families (`itemPage`).
  - The retention scan, the storage quota (sum of both counters), shelving archive and restore, and the MCP item tools.
  - The activity legacy adapter: app family first, then remaining legacy rows. Its cursor is `a.<id>` or `m.<id>`; a bare ID is still accepted.
- **Export.**
  - The `messages` contributor reads `message/` and then `app-message/` with the same projection, so the archive shape is unchanged.
  - `quota` adds `app-message-usage/`.
- **Kept on purpose.**
  - `notification-event/`: it is the activity notification queue, and §4 keeps notification state.
  - Item-index and search IDs, which stay keyed by item ID.
  - Consent checks, replay receipts, per-connection budgets, the receipt lane and push, all unchanged.
  - Blob names (`messages/<owner>/…`). **The reset must therefore delete peer blobs per record, never by blob prefix** (recorded in §2.8.2).
- **Still coupled (BB-CUT inventory).** App messages keep `collection` placement and owner rules, so the legacy inbox, retention units and MCP keep seeing them.
- **Tags.** `packages/core/tags.mjs` is the old `messaging/tags.mjs` plus `ownerRules`; the old paths re-export it.
  - `activity/model.mjs`, `app-notifications`, `item-index`, `message-views`, search and MCP import the core module.
  - `app-notifications`, `message-postbacks`, `message-presentations` and `activity/*` no longer import anything from `packages/messaging/`.
- **No dual path.** Peer delivery still writes only `message/`; app intake writes only `app-message/`.

**2. Flags: the links plumbing and the email bridge no longer use Parley's flag.**
- **`LINKS_ENABLED`** (class a, stateful) replaces `BINDLEBOX_ENABLED` in core. It gates the links contract, key-delegation certificates and routes, the messaging-address descriptor and declaration, `MESSAGING_DESCRIBE` and the member-certificate fall-through.
  - `BINDLEBOX_ENABLED` moved to `RETIRED_FLAGS` (`retiredOn 2026-10-26`, `replacement: 'LINKS_ENABLED'`). It stays in the name lock, and a stored console record under the old name is quarantined.
  - **Env compatibility.** The new registry field `envAlias` makes `parseEnv` and `legacyValue` read the retired env name while the new name is unset; the new name always wins. Only `LINKS_ENABLED` declares an alias.
  - The core `wrangler.jsonc` and `wrangler.local.jsonc` now set `LINKS_ENABLED: "false"`. Parley (`apps/bindlebox/*`) keeps reading its own raw `BINDLEBOX_ENABLED`.
- **`EMAIL_BRIDGE_ENABLED` requires no other flag.** `bridgeConfig`, the bridge routes and `recognizedSlots` no longer consult a messaging-app flag. Delivery depends on the public-message-intake slot having an occupant; mail is held with `no-occupant` otherwise, as before.
- **`PUBLIC_INTAKE_CONTRACT`** moved to `packages/links/types.mjs`. `federation/brokered.mjs` imports the slot and contract from there, not from `email-bridge/wire.mjs`, which now re-exports them.

**3. Developer contact through the occupant (behind config, legacy stays the default).**
- **Switch.** `DEVELOPER_CONTACT_MODE`: `legacy` (default, unchanged) or `occupant`. It is config rather than a flag because it selects a deployment's route, not a per-account rollout.
- **Recording the link.** When the developer account's messaging-ingress occupant issues or rotates a `MESSAGING_CONTACT_LINK_TYPE` link with the developer policy through the links contract, `account/links.mjs` records `developer-contact/occupant-v1`. The capability URL is sealed with `KEY_ENCRYPTION_KEY` under its own purpose.
- **`GET /api/developer-contact` in occupant mode:**
  - It hands out that link only if it still verifies, carries the developer policy, and was issued by the seat that holds the slot today. Otherwise it answers `contact-unavailable` or `occupant-changed`.
  - Eligibility comes from the bounded links §7.5 decision for that link (`developerLinkDecide`).
  - It answers `{mode:'occupant', intent:'send-message', …}` and mints no legacy grant.
  - The legacy response shape is unchanged.
- **Console.** The button reads "Write with your messaging app" and hands the link off through the existing intent router as a `send-message` intent (`/i#bintent=…`). Without intents it opens the link's landing page. New strings are added in en and es.
- **`cleanupDailyDeveloperGrants` is kept:** the legacy path still reaches it.

**4. BB-CUT inventory.** Messaging extraction §2.8.1 now records:
- the audit's 17 tests, with the dependency each has and a proposed disposition (two have no direct import and are flagged for re-check);
- search fed by item writes;
- MCP and browser-automation grants that target collections;
- the collection placement of app messages;
- the legal lines to change after the cut: privacy.md l.22, 45–47, 73, 81, 103, 126, 136, 159, 189 and terms.md l.43, 48, 50, 62, 117. Legal text is not edited.

**5. Export inventory gaps.**
- **Gaps confirmed.** `mcp/operation/`, `mcp/operation-expiry/`, `automation/session/`, `automation/confirmation/`, `classifier/usage/v1`, `app-notification-budget/` and `app-notification-receipt/` had no inventory entry, because they are written through constants or template literals that the scan missed.
- **Found while checking.** `message-postback-prepared/`, `developer-contact/` and `link-gc-cursor/`.
- **Now covered.** Each has a reasoned exclusion. The inventory test scans `packages/mcp/account.mjs`, `packages/automation/account.mjs` and `packages/activity/app-messages.mjs`, catches constant-assigned key families, and pins the new families explicitly.
- **Not account data.** `mcp/v1/*` lives in the MCP shard stores, not the account store, so it gets no account export entry.

**Tests.**
- **New:**
  - `tests/app-messages-family.test.mjs` (5), with a seeded run of lost commit acknowledgements and crashes during the move (`CHAOS_SEED` replays a seed);
  - `tests/developer-contact-occupant.test.mjs` (4);
  - a retirement and alias test in `flags-registry-removals`;
  - a console handoff case in `browser/signup-views.mjs`;
  - an occupant-copy render case (en and es) in `browser/contact-links.mjs`.
- **Adapted:**
  - `app-notifications`, `search-outbox-poison` (the app family);
  - `email-bridge`, `worker/email-bridge`, `email-bridge-helpers`, `flags-evaluate`, `flags-registry` and `routes/flags.test.mjs` (the bridge needs no messaging-app flag);
  - the core suites that set the old flag name (now `LINKS_ENABLED`);
  - `engine-account-export` (inventory scope).

**Verification (shared checkout; the RTC agent was editing the registry, federation and catalogues in parallel; local evidence only):**
- `npm test`: **3,874 passed, 0 failed**.
- `test:worker`: **93 passed**.
- `test:ui-state`: **490 passed**.
- `test:e2e`: **324 passed, 0 failed, 4 skipped** (328), after `build:assets`.
- **Build fix.** `build:assets` first failed with "Unmapped public module `../core/tags.mjs`", because the new core tags module was missing from `publicSources` in `jstools.config.mjs`. It is added now, and `build:assets` passes. The RTC entry above records the failure; it is resolved.
- A first `test:e2e` run (74 failures) used a stale asset snapshot from before that fix. It is superseded by the run above.
- `check:worker` was not run.

Reviewer: ___ Date: ___ Outcome: ___

### Review follow-ups (2026-10-27)

An independent review of this uncommitted work found findings F1–F6, I1 and I2. All of the readings below are **provisional** (coordinator). None is signed off. Each of the review's three PoCs is now a regression test.

- **F1: the env alias widened a narrowed flag.**
  - `evaluate.mjs`: when `LINKS_ENABLED` has no record of its own and its `envAlias` (`BINDLEBOX_ENABLED`) is quarantined, the flag takes the outage path, as a quarantined record of its own would. A console kill or allowlist stored under the old name is therefore never widened by the old env name.
  - **Decision (provisional):** `flags.retire` of a retired name whose `RETIRED_FLAGS.replacement` declares it as `envAlias`, while the replacement has no record, carries the record to the new name in the same audited commit. The record is re-validated at rev 1; if its shape no longer fits, the off record is written instead. The commit expects the new record to be absent. The audit and the result carry `carriedTo` and `carried`.
  - Regression for `poc-flag-alias.mjs`, plus a carry test in `flags-registry-removals` (+2 tests).
- **F2: the marker is not a completion signal.**
  - `app-messages-v1` takes `holds` and does nothing while the account is `shelved`. It checks the hold up front and inside every move transaction.
  - The warm restore deletes the marker, the cursor and the reconcile time in the restore transaction whenever the restored rows include `message/` rows.
  - §4 now says the BB-CUT reset runs its own full verify-and-move pass inside the reset step and never gates on the marker.
  - Regression for `poc-shelved-marker.mjs`, which also covers a marker from before shelving.
- **F3: app rows that fail verification.** Design amendment to §4:
  - The reset deletes only positively peer rows.
  - Rows with the v1 purpose and a matching owner and ID that do not verify (unknown kid, changed issuer) are held and reported for operator review, never deleted.
  - Release gate: keep retired kids in `APP_NOTIFICATION_PUBLIC_JWKS` and keep `APP_ORIGIN` unchanged until BB-CUT. The set stays within its 8-key bound, because a larger set is rejected outright. Any account with a non-zero count is reviewed first.
  - Diagnostic: `migration/app-messages-v1-diag` holds `{unverifiedAppShaped, pending, completedAt}` from the last full pass.
- **F4: export and adapter races.**
  - The pass also holds while `export/active` exists (DX-2 pinning), so the `messages` contributor never repeats an archive path. This is the regression for `poc-export-dup.mjs`, including an export that starts mid-slice, where the cursor does not advance.
  - The activity legacy adapter now merges both families in item-ID order with one ID cursor. A move keeps the ID, so pages neither skip nor repeat rows while rows move. The old per-family `a.`/`m.` cursors were introduced in this same uncommitted work; they are still accepted, with the prefix ignored, and the pre-move bare-ID cursor is the native shape.
- **F5: peer-delivery caps.** `MessagingService.receive` and `ContactDeliveryService` check the account caps against both counters (`storedItems`). Only the legacy counter is written. One test each in `messaging` and `engine-delivery`.
- **F6: post-marker reconcile.** After the marker exists, the alarm starts a new reconcile pass at most once a day (`migration/app-messages-v1-reconciled-at`). A pass already in progress continues one slice per alarm. Unverifiable rows are not tracked separately; the daily throttle bounds the re-verification.
- **I1: developer-contact pointer.** The occupant pointer is recorded only when `DEVELOPER_CONTACT_MODE=occupant`. The account cannot see its own handle, so in occupant mode any account's occupant can still leave a pointer. Only the configured developer account's pointer is served, and the export exclusion text now says exactly that.
- **I2: console copy.** Occupant copy ("Write with your messaging app") shows only when intents are available (`intentsAvailable`). Otherwise the en and es link copy shows. The `browser/contact-links.mjs` case covers both.
- **Docs updated:** messaging extraction §2.8.2 and §4, and the feature-flags `LINKS_ENABLED` row.

**Verification (local evidence only; the shared checkout was being edited by other agents and a gate run):**
- Targeted suites in the checkout: **444 passed, 0 failed**. They cover app-messages-family (9), developer-contact-occupant (5), the flags suites, the export suites, app-notifications, the shelving, lifecycle and deletion suites, the contact-delivery suites, `engine-delivery`, `messaging`, `engine-activity` and `search-outbox-poison`.
- `browser/contact-links.mjs`: 17 passed. `browser/signup-views.mjs`: 11 passed.
- Scratch copy of the checkout:
  - `npm test`: **3,897 passed, 0 failed**.
  - `build:assets`: passes.
  - `test:ui-state`: **490 passed**.
- `test:e2e` and `check:worker` were not run for these follow-ups.

Reviewer: ___ Date: ___ Outcome: ___

## 2026-10-26 — Core-scope audit (what belongs in 3sln.me core)

This audit was done at the owner's request. The goal is to keep the core to account, identity and protocol plumbing plus generic Bindle contracts, and to move app experiences into apps. It was carried out at HEAD 2a4d521.

**Classification:**
- **(A) Remove from core.**
  - Beam, the device-to-device file transfer feature: done. See "Beam removed from core". The generic contact profile and sharing code was kept, and the TURN pieces were moved to `packages/rtc/`.
  - Legacy peer messaging: decided on 2026-10-20 that it moves into the Parley app. Preparatory work is done; see "Messaging extraction prep (no reset)". The final cut (BB-CUT) is blocked on the owner confirming the irreversible message-data reset.
- **(B) Keep in core** (generic or account-level):
  - activity centre, notifications and push;
  - device names;
  - intents, links, and the MCP/WebMCP adapters;
  - Google Drive, the email bridge (reshaped around the public-intake slot), the classifier and embeds;
  - the loopback demo.
- **(C) Owner questions:**
  - saved contacts: a core address book, or per app?
  - semantic search: its corpus is mostly message text;
  - what the MCP and automation tools expose once collections are gone.

  These are recorded as SQ-1 to SQ-4 in `docs/release/pending-signoffs.md`.
- **Generic replacement:** apps get the RTC signaling extension (`docs/spec/rtc-signaling.md`) for calls and data transfer instead of a core feature.

Classification is provisional.

Reviewer: ___ Date: ___ Outcome: ___
