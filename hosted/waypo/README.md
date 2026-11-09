# Waypo.link Waypo composition

This isolated package composes Waypo's public Node/Worker, policy and SQLite
ports. It imports no historical Bindle app graph and changes no legacy app,
migration, environment file or package. Production release remains disabled.

The deferred Waypo.link personal-plan candidate is $10 yearly with 10 decimal GB of account-wide
storage. Prices and configured Polar products live here, never in the OSS policy
engine. Basic identity and independently self-hosted Waypo need neither this
package nor a Polar account. Trial capacity is a provisional 30-day/1-GB candidate
and defaults off. Overages remain disabled; see the two unresolved cap/renewal
alternatives in `RESEARCH.md`.

## Initial no-billing launch mode

Owner direction on2026-11-05: initial Waypo.link service is free, with configurable500,000,000-byte account-wide storage and free signaling under abuse safeguards. Billing, paid plans, trials and overages are deferred. Production remains disabled; finite native account admission and global creation-rate blocks are mandatory in this mode; comprehensive work/dollar ceilings and the other release gates are still required.

Worker deployments select exactly one explicit mode. The committed, closed and disabled preview uses `HOSTED_FREE_CONFIG`:

```json
{"mode":"free","environment":"production","freeStorageBytes":500000000,"accountAdmission":{"revision":1,"maxPublicAccounts":1,"maxProtectedAccounts":48,"acceptingNewAccounts":false},"executeRetention":false,"allowedSignupCountries":[],"accountCreationRate":{"revision":1,"global":{"capacity":4,"refillPerMinute":1},"public":{"capacity":2,"refillPerMinute":1},"protected":{"capacity":2,"refillPerMinute":1},"protectedReserveUnits":2,"blockSize":1,"blockMs":60000,"maxWorkers":4,"protectedWorkerSlots":1}}
```

The example is deliberately closed to new public accounts. Select an affordable finite `maxPublicAccounts`, enable `acceptingNewAccounts` only when ready, and increment its policy revision for changes. The separate protected reserve is available only to internally verified deployment enrollment. Retained identities count until native deletion; decreasing a cap never evicts existing users, and paid-to-free transitions allocate no new slot. This bounds identities, not all operation costs. See the adjacent core's `docs/implementation/account-admission.md` for atomicity, bounded existing-install activation and policy-revision behavior.

The explicit `accountCreationRate` policy regulates admitted creation attempts using small prepaid blocks from the durable installation authority, independently of the retained identity cap. Public work cannot spend the protected monetary floor or all protected worker slots. Every credit still debits the same absolute global bucket. Block expiry, cache loss, uncertain responses and native rollback never refund it. Existing sign-in needs no new-account unit. Change the rate-policy revision without resetting spent balance; the full flow and conservative burst envelope are documented in the adjacent core `docs/implementation/account-creation-rate.md`. These guards do not bound already-billed inbound Worker requests or all service costs; edge/CPU/work/byte controls and spend alarms remain required.

No Polar organization/product/customer, access token or webhook secret is needed in this mode. No checkout, billing page, billing mutation or webhook is available; retired billing URLs return404. `HOSTED_FREE_CONFIG` and `HOSTED_BILLING_CONFIG` cannot coexist. Existing paid composition remains available only under a separate explicitly configured billing mode for future work. Node composition's second argument accepts the same explicit free-settings object; the command-line file retains its historical `billing` property name for that settings object, but a free-mode value requires no billing resources.

Free mode projects `policy.freeServices:{storageBytes,signaling:true}` into the portable policy engine. This is deployment policy, not a protocol/discovery extension or client-supplied entitlement. Finite storage bounds are1byte through1TB of configured baseline; fleet physical/work/account admission remains a separate required bound. Contact, enforcement, human inactivity and quota checks remain authoritative. A verified paid/trial term can supply a larger allowance; expiry falls back to the free baseline. Covered unarchived funding warnings are canceled; an existing archive is never silently restored. Signaling remains independent of storage funding while identity/contact/enforcement restrictions still apply.

The normal provider account UI shows core usage/capacity, full-storage guidance and export; free mode supplies no commercial presentation or purchase links. Delete unwanted documents/files in their owning apps. This does not yet supply a provider-wide interactive document deletion browser or the previously discussed large-file streaming path.

Local candidate evidence against the adjacent current core: hosted primary44/44; actual durable Node account/email/session and headless full500MB UI; native Worker authentication/entitlement/session persistence across restart; and complete hosted integration8/8 preserving deferred paid fixtures. Full-storage UI usage is injected through the trusted usage ledger, not500MB of physical objects. Optional screenshots are in ignored `.artifacts/free-hosted/`.

**Local compatibility:** `waypo-ref.txt` selects reviewed core `4abb38e793cf98d7167211e3cfe8dec2f61e8f95`. Local qualification of this exact source pair uses hosted primary and Node/Worker integration tests plus a Worker dry build. This is not a deployed service or blanket security approval. Default country list remains empty, public routes off, preview flag false, destructive retention off. Account-data sharding is implemented and locally qualified behind explicit operator opt-in; the shipped configuration still binds only the installation actor. Native identity remains installation-local. Live email/push, restoration, comprehensive cost controls and public Cloudflare rollout remain separate gates.

## Deferred billing composition

`worker.mjs` exports the branded `HostedInstallation` Durable Object and normal
Worker entry. `wrangler.jsonc` has no public routes/workers.dev/previews, and its
preview flag is false. It binds native SQLite, private R2 and Waypo's generated
public assets. Configure the provider JSON and a separate `HOSTED_BILLING_CONFIG`
with exact environment, organization/product IDs and optional fixed base-price
ID. Supply `WAYPO_AUTH_SECRET`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` and
object encryption keys through private operator configuration, never committed
vars. The sample's IDs/domains/bucket are placeholders, not provisioned resources.
Build Waypo assets with its existing Worker asset tool before Wrangler dry-run.
The maintained SDK and the complete branded Worker compile together; compilation
is not a deployed production service.

`node.mjs` exports `createWaypoLinkNodeApplication` and `startWaypoLinkNode`, and accepts a
private `{provider,billing}` JSON file when executed directly. Provision the
provider metadata using Waypo's public SQLite adapter first. Run behind the
operator's configured TLS ingress. The optional commercial flags
`enableActions`, `enableCancellation`, `enableTrial`, and `executeRetention` must
be explicit booleans; actions/trials/destructive retention default off. An already canonically bound subscription remains cancelable even when new
billing actions are disabled; flags cannot trap an owner in future renewal.
New hosted signup still requires actual trusted country/admission/contact ports;
this package does not invent an approved global market list.

The generic provider extension exposes a same-origin billing link/page and
owner-bound status, checkout, portal, refresh and cancellation routes. Actual
native session/fence checks derive the subject; request bodies cannot select
another account. Mutations require the exact Origin and empty JSON body. The
raw signed webhook is the only anonymous billing endpoint. It validates the
maintained SDK signature, then reconciles canonical customer/subscription/order
state for the configured organization/product. Redirects never grant entitlement.
SDK network calls occur outside metadata transactions. Same-transaction receipts,
version/epoch checks and policy projection protect retries and concurrency.

A configured fixed annual base-price ID enables paid tenure from canonical paid,
unrefunded order line periods. At most 64 verified periods are retained; at most
72 completed monthly anniversary labels enter the policy engine. Durable bounded
jobs mature those months without waiting for a yearly webhook or user visit.
Usage events from actual service commits accumulate exact byte-milliseconds and
excess byte-milliseconds in bounded integer counters, with six prior-term summaries;
no per-edit event array, payment-card data, email or country is collected here.
These counters are not invoices and do not enable overages. The Worker stores the
`provider-extension` wakeup atomically with its index; Node polls the same durable
index on startup and each second.

`npm test` runs the engine merge gate: commercial policy, paid tenure, bounded
usage accounting, SDK/webhook reconciliation and overage candidates with injected
resources. `npm run test:e2e` separately runs actual Node TLS/native-session/email
proof and browser billing checks, cancellation, and native Miniflare/workerd SQLite
state/session persistence across restart. `npm run test:all` runs both. These use
the adjacent Waypo checkout's development tools. Set `E2E_SNAPSHOTS=true` only for
requested E2E desktop/mobile billing evidence; captures and test state are ignored.
No external checkout or charge is made. Real Polar annual sandbox settlement,
production configuration, all lifecycle/browser gates and launch capacity remain
separate release requirements.

While Waypo is private and this service repository is public, the hosted engine
and integration workflow runs inside **the private `3sln/waypo` repository**:
`hosted-composition.yml`. It checks out a reviewed full commit of this public
repository beside the private reference. No stored cross-repository personal
token is required, and private source/test output stays in private CI.

Core changes run the hosted engine compatibility gate against the reviewed public
baseline. Before merging a new hosted package revision, a trusted maintainer must
dispatch that private workflow with its full `hosted_ref`; the manual default
tests `waypo-ref.txt`, while candidate mode tests the current Waypo revision.
Browser/native checks and snapshots require explicit manual inputs. A public
pull request does not automatically receive a private dependency or a fabricated
green engine check. Automatic public-PR status integration remains a setup item
until a narrowly scoped integration or public Waypo release is selected.
Historical root workflows do not validate this package. Production deployment
remains disabled.

Hosted composition requires explicit `nativeCredentials`, all four
`nativeRetainedLimits`, `nativeStorageCapacity` (`maxBytes`, `headroomBytes`,
`retryMs`), and enabled `sessionSecurity` with a complete finite `mailPolicy`.
The portable core `validateHostedNativeCapacityConfiguration` validates these
before Node creation or Worker environment composition. Private self-hosted core
configuration remains opt-in. No hosted Native policy defaults are selected here.
The closed Wrangler examples contain labeled engineering values only; operators
must replace them with explicitly reviewed capacity limits. Completeness proves
neither affordability nor production readiness. The initial free entitlement
remains 500 MB shared storage and free signaling, without billing.

This isolated security-mail candidate replaces blanket hosted owner-proof denial
with an issuer-bound in-process transport capability plus independently required
production-mode session-security Turnstile readiness. Caller JSON, generic email
readiness, cloned transports and arbitrary budget callbacks cannot enable it.
Only the hosted constructor with a validated finite shared-budget admission hook
registers the frozen transport. Security dispatch uses that exact transport.
Node accepts it only through trusted server options, excluding simultaneous local
or HTTPS email configuration; Worker constructs it inside the installation DO.
The two fixed account-sender templates accept only their exact main-origin
`/passkeys/approve` or `/sessions/approve` operation/token URL and eight-digit code.

Budget and actual native send waits have bounded caller deadlines. One pending
budget RPC per exact namespace and one unsettled native send per exact binding
remain occupied until actual settlement; deadline expiry never refunds a debit,
releases uncertain native work, automatically retries, or promises delivery.
These are isolate-local pending bounds, not a claim of global dynamic sharding.

Local production-component browser tests use genuine bootstrap, real native
storage/migration, mailbox-possession proof and signed virtual-authenticator UV.
Only external Siteverify/widget/email acceptance and ingress country are synthetic;
`.example` origins map privately to local TLS and unrelated origins are blocked.
No identity/session/proof rows are seeded. The private budget-exhaustion control
uses actual portable policy charges, not ledger writes. The explicit1000ms mail
cooldown and other profile values are engineering fixtures, never launch values.
Vendor conformance, physical authenticators, mailbox delivery and production are
unverified. Internal independent review and local frozen-pair qualification are recorded in the core security-mail evidence report;
production/preview/routes remain disabled.

The committed source pairing is `4abb38e793cf98d7167211e3cfe8dec2f61e8f95`: reviewed Native security-mail product `75a422a` plus mandatory explicit hosted work-admission policies. Configured Node and Workers owner-proof/first-key flows are locally qualified with synthetic external email/Siteverify. Real vendor delivery, physical authenticators, lost-session and governed administrator recovery, economic launch policies and production rollout remain separate.

## Optional account-data placement

The Worker exports `HostedAccountData`, which applies the same hosted free-policy composition as `HostedInstallation`. An operator enabling the reviewed storage-routing configuration must add an `ACCOUNT_DATA` Durable Object binding to `HostedAccountData` and an additive SQLite-class migration with a new migration tag. Do not bind the raw portable `WaypoAccountData` class: it would bypass hosted composition. No such binding, migration or activation is shipped in the default configuration. Both example Workers explicitly enable `enable_request_signal`, required for cancellation with their compatibility date.

Automatic initial-free inactivity deletion additionally requires `services.storageRouting.retentionExecution:true`; merely enabling account placement does not enable deletion. Funding/archive history is excluded from that lane. A committed terminal decision prevents fresh authority; already authenticated reads can continue within their existing bounded lease (30 seconds by default, at most 60 seconds when explicitly configured; subscription authority at most 30 seconds), rather than instantaneous distributed revocation. Prepared commands preserve reads, export and a valid human check-in, while writes back off transparently. Operator-specific paid/archive retention remains a separate policy.

The local account-data integration fixture seeds installation governance and app registration only. Native email authentication, consent and tokens use maintained HTTP paths; mail acceptance is synthetic. It checks hosted 500,000,000-byte policy composition, private per-account placement and restart persistence. It does not demonstrate production email delivery or public activation.
