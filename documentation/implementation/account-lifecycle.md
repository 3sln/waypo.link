# Hosted account policy engine

> Current hosted launch policy: free 500 MB account-wide, free abuse-guarded signaling, and no billing. The paid/trial lifecycle paths below describe optional implementation mechanisms, not an active Waypo.link offer. Production retention and deletion still require operational verification.


> **Status:** Development documentation. Production release remains disabled.

2026-11-02. Production execution remains disabled. `packages/policies/index.mjs`
implements portable ngin policy transitions with injected transactional persistence,
time, cryptography, anti-abuse verification, ephemeral signup eligibility,
maintenance effects and transaction-local dependency checks. Hosted policy is
optional for independently self-hosted providers. No Polar account, Cloudflare
account or external geography service is required for basic self-hosting.

The first local policy suite passes eighteen engine tests. It uses an explicitly
trusted test verifier, delivery result fixture, archive fixture and transactional
test resource deletion adapter. This is not external email delivery, a restored
archive, Polar cancellation or production physical deletion evidence. Integration
with actual provider events, a durable scheduler, physical identity deletion,
backup expiry and end-to-end user surfaces remains required. Actual encrypted
resource archive/export/restore/purge adapters now have separate local evidence
described below.

## Provisional delegated defaults

The coordinator selected these engineering defaults under the owner's delegation;
they are configurable and are not a claim of legal/commercial launch approval.
First-year eligibility is two UTC calendar months after the last trusted human
interaction. Calendar arithmetic clamps end-of-month dates and preserves UTC time.
The ordinary response window is one calendar month from the first actual contact
attempt. Substantial history (fourteen distinct human-active days) or current data
(one GB) adds one month. Established free accounts use a six-month inactivity gap
and three-month ordinary response window. Paid accounts receive three months.
Notices are queued initially, after seven days and after twenty-one days.

A paid unanswered deadline queues an idempotent renewal cancellation. Local paid
operation stops admitting optional writes while warning is pending, but sign-in,
contact repair, check-in and export remain available. Archiving waits until the
later of the response deadline and paid-through/trial end. Archive retention is
thirty days plus thirty per completed paid year, capped at 180 days. Future annual
prepayment does not immediately grant a year of archive credit. An old payment is
not permanent retention immunity. Archive expiry rechecks current policy, human
activity, live paid entitlement and protected/shared/service dependencies.

## Trusted boundaries

`createPolicyEventsPort` is an in-process capability, never an HTTP credential API.
It records an actual materialized account, verified contact references, trusted
provider-owned human interactions and verified monotonic subscription snapshots.
Background synchronization, refresh, billing webhooks, notification opens and
external app claims cannot certify human activity. Interactive authentication,
consent, settings and invitation acceptance use distinct event IDs and bounded
idempotency receipts. Current channel references are stored; raw endpoint secrets
and ephemeral country are not lifecycle data.

Pending retention cannot be silently cleared by ordinary traffic. Check-in first
creates a short-lived challenge bound to the exact episode and authenticated
original session. A trusted anti-abuse adapter verifies the purpose, transaction
and freshness; completion consumes that challenge and episode atomically. A
new human interaction at a deletion/archive boundary invalidates queued work and
protects the account while explicit check-in remains required.

Hosted activation requires a verified contact. Contact loss pauses new optional
allocations while preserving ordinary identity and exit paths. An opening notice
clock begins only after the configured transport reports accepted or an individual
endpoint rejection. Unconfigured delivery, unknown errors and provider outages do
not start a deletion clock. Accepted transport is not proof of delivery or reading.
Individual rejected endpoints require at least three attempts and a thirty-day
repair window. Global incidents separately pause destructive finalization.

`SignupEligibilityQuery` consumes an ephemeral trusted country fact only for new
hosted signup. The adapter must derive existing-account status itself, never trust
a caller-supplied flag. Existing users retain travel sign-in. No allowed-country
list is selected by this engine; an injected operator policy decides eligibility.
Neither raw country, a country digest nor country audit records are stored.

The portable engine has no price or universal paid storage allowance. Trusted
configuration maps stable verified plan IDs to paid/trial capacities; unknown
plans fail closed. With no configured allowance, paid/trial bytes remain zero.
Subscription snapshots are monotonic and include the verified plan mapping;
stale events cannot undo newer state. A success redirect or payment method does
not grant entitlement. Trial checkout, vendor products and prices live in the
separate deployment composition. Overages remain zero unless a separately
implemented explicit spending policy exists.

The earlier ten-USD/year, ten-GB hosted preset is historical and inactive. The current hosted free policy is independently configured; other operators choose their own allowances without patching Waypo or using a billing vendor.

Account and fleet reservations atomically bound logical bytes, in-flight capacity
and hourly work units. Reservations have fixed expiry, bounded counts, exact
request idempotency and commit receipts. An admitted byte allowance cannot bypass
work limits or create automatic financial overage authority. Read/export budgets
remain distinct from optional writes. The default work and fleet limits are
engineering candidates, not measured economics or advertised service guarantees.

## Maintenance and physical effects

`RunMaintenanceAction({subject})` and `ProcessMaintenanceAction({subject})` process
explicit account identifiers supplied by bounded operator enumeration. There is no
unbounded account/object scan. Outbox leases, attempts, retries, notices, audit,
check-in challenges and reservations have hard bounds. `retention.execute` defaults
false; disabling it leaves warnings and safe identity access available.

External delivery, cancellation, archive and deletion happen outside metadata
transactions, with stable job IDs for idempotent adapters. Cancellation is called
confirmed only after the adapter confirms it; failed/unknown cancellation remains
visible. Check-in drops cancellation jobs not yet dispatched. If an external
cancellation was already running, its later confirmation is reported explicitly;
check-in never silently reauthorizes renewal. Verified paid-through access survives
canceling renewal. Explicit fraud/entitlement revocation is a separate status. Archive confirmation requires an encrypted, integrity-checked manifest
reference. A manifest fixture is not an implemented export/archive adapter.

Physical archive and deletion adapters MUST invoke the supplied `authorize(tx)` capability
inside the same trusted transaction that removes authoritative personal data. It
rechecks exact archive/deletion ID/revision, human activity, current policy, paid state,
incident state and protected/shared/service dependencies. A missing guard fails
closed. The scope is local personal identity/resources only: it never authorizes
deleting an installation-owned service principal, another person's data or data
at another independent provider. Referenced immutable blobs require a subsequent
bounded durable GC job and finite backup expiry; these adapters are not implemented
by the policy engine. Cross-database implementations must demonstrate their actual
atomic/fencing boundary rather than claim an atomic commit across unrelated stores.

Explicit archived-account restoration, current-capacity admission and any new
paid agreement are required before restarting paid work. The draft engine denies
silently clearing an archived account through check-in. Actual resource restore
requires current quota through its trusted authorization callback; full provider
HTTP/identity restore and physical backup erasure remain open integration gates.


## Funding lapse is independent of human abandonment

`RunFundingMaintenanceAction` and `ProcessFundingMaintenanceAction` manage a
separate resource episode when hosted paid/trial funding ends while bytes remain.
The provisional grace is one calendar month from an actual accepted/individual
rejected notice attempt, with opening/day-seven/day-twenty-one notices. Continued
human sign-in, reading or check-in cannot fund retained paid bytes indefinitely.
After grace, authorized personal optional resources enter a finite archive and
then bounded cleanup. Free identity, sign-in, contact, appeal and export during
archive remain available; being unpaid never schedules identity deletion.

A separate resource revision fences payment, usage and funding-state changes
without treating human activity as payment. Actual `archiveResources` and
`deleteResources` adapters must consume a current same-transaction authorization
callback and use the `optional-personal-resources-only` scope. New verified funding
before archive cancels that pending episode. Renewing after archive requires an
explicit restore path; payment alone cannot silently restore deleted data.

The service dependency guard means unresolved real shared/control/funding
obligations needing transfer. An immutable creator audit reference on an
installation-owned service principal is NEVER such a dependency. Personal account
cleanup cannot revoke or delete that independent service principal/credential.


## Actual private resource archive adapter evidence

`createPolicyArchiveAdapter` in `packages/policies/archive-adapter.mjs` writes an
actual encrypted catalog manifest referencing existing immutable private objects.
It verifies actual AEAD envelopes and plaintext content hashes eight objects per
maintenance call before confirmation. It then calls the service engine's catalog
archive primitive inside the same transaction as the current policy guard. Normal
app operations, delayed writes and old document epochs are fenced by that engine.

Four tests in `tests/engine/policies-archive.test.mjs` use real Node SQLite and
actual private encrypted files: Yjs note and attachment archive/export/restore,
closing/reopening every store and engine, one additional manifest without copying
payload blobs, revoked physical authority preventing publication, bounded physical
file deletion, epoch rotation, fixed export leases, manifest adoption and purged
resources remaining purged. Identity deletion is deliberately unconfigured in
these tests and is never claimed from resource cleanup.

Export metadata pages contain at most sixteen object references; individual raw
object reads remain bounded to four MiB and validate the manifest hash. A verified
owner session, not an app token or notice link, authorizes every read and its final
publication check. Accepted download leases are session-bound, at most one hour,
and cannot be created or renewed after the immutable archive deadline. A purge
waits for active accepted leases; it does not cut their objects midway. Restore
requires current funded/self-host quota from a trusted callback, not a request
parameter, and cannot silently extend an export deadline.

A later identity archive adopts a ready funding catalog under the same archive ID
and the minimum existing/new deadline. This is a delegated engineering choice to
prevent stacked subsidy or duplicate retained bytes. If resources were already
purged, a finite metadata-only identity archive never restores those objects or
old storage grants. Full profile/contact/client/authenticator export still needs
a maintained-auth projection port; the catalog is not mislabelled as a complete
identity backup.

Purge tombstones authoritative references first, then deletes at most sixteen
settled objects and acknowledges those keys. Unknown crashed in-flight producers
remain bounded quarantined entries; they are not declared erased. Incomplete
batches return durable progress rather than consuming an external-failure retry
budget. Physical identity removal additionally needs a real tombstone/session/
authorization-family adapter preserving support evidence and independent service
principals. A missing port fails closed.

Provider projection is in `packages/policies/provider-bridge.mjs`: account creation
uses the maintained authentication record's original creation time, verified
contact references omit addresses, and only explicit successful authentication,
consent, settings or invitation acceptance records human activity. Lazy account
projection and bounded existing-user seeding do not certify a new human visit.
New-account region input stays in the eligibility call rather than account state.
The bridge protects live governance authorities (including the initial bootstrap
handoff before governance is first materialized); immutable service-principal
creator audit references do not count as human ownership dependencies.

Entitlements are feature specific. `mayNotify` permits bounded notifications for
free identities independently of paid storage or resource-funding cleanup;
`maySyncWrite` requires current configured storage funding; `maySignal` requires
an enabling operator policy (the initial hosted free policy explicitly enables signaling); older paid/trial funding paths are inactive. Notification consumption
uses its own zero-byte reservation kind while retaining account/fleet work limits.
No free sponsored inbound signaling allowance has been enabled. Login, contact
repair, check-in, appeal and export do not depend on storage quota. The compatibility
`optionalWrites` field describes storage writes only.

`createProviderMaintenance` resolves the current maintained-auth user at delivery
time. Only a currently verified primary email or the trusted provider-owned push
inventory is used. Local mailbox adapter acceptance is a transport attempt, never
proof of a read. Missing global mail/push configuration and transport outages
hold the destructive clock. Permanently removed individual verified endpoints
follow the explicit three-attempt/30-day repair policy, preserving the previous
verified contact reference as unhealthy. An unavailable alternate channel does
not override an accepted attempt for the same reminder. Failed global notice
jobs retry the same bounded row daily after three failures, so a repaired operator
transport can resume without permanent stuck state or growing job arrays.

`createTurnstileVerifier` uses only the fixed official Siteverify HTTPS endpoint,
a five-second budget and an 8 KiB response bound. Production requires the exact
issuer hostname, `retention-check-in` action, cData equal to the live policy
challenge ID, and a recent challenge timestamp. Secrets stay server-side. The
[official test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
are rejected by production configuration and work only in explicit test mode;
that mode does not claim real human detection. The
[server-side validation contract](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
is combined with the engine's original-session binding, expiration and one-use
consumption. Widget/browser and external Siteverify evidence is a separate gate
from injected-port unit tests.

Owner identity-profile export projects only allowlisted profile, linked-provider,
passkey metadata and consent fields, with at most 64 rows and 256 KiB per page.
It excludes passwords, OAuth access/refresh/ID tokens and private recovery
material and rechecks the owner after database reads. Personal object archives
retain existing immutable encrypted blobs; at most 4,160 references fit a bounded
3 MiB private manifest. Both archive verification and restore verification advance
by eight objects per durable step. A real 132-object paged catalog was archived,
reopened from SQLite/encrypted files and restored through those bounded steps.
These ports alone do not mean the provider UI or physical identity deletion is
fully configured.

The real dummy-key browser probe of the provider child in an `allow-scripts`-only
opaque sandbox proves parent DOM isolation, but does not complete Turnstile:
the SDK rejects nested challenge messages with `Ignored message from wrong
origin: null`. Therefore that embedding is not a configured retention proof.
The coordinator selected a separate operator-configured, cookie-free challenge
host with no identity/admin APIs. That different origin may use
`allow-scripts allow-same-origin` while remaining isolated from provider DOM.
Its parent origins, frame-ancestors and postMessage targets must be trusted
configuration, and Siteverify must validate the challenge hostname. A real two-host browser probe now completes the official dummy widget and
external Siteverify while parent DOM remains inaccessible. This verifies the
isolation/transport arrangement, not real-human detection or a complete retention
workflow. Self-hosts may inject a different anti-abuse port without Cloudflare.

Expired operator-assisted provisional activation has a separate narrow cleanup
entry: the trusted activation engine must authorize the exact expired reservation
and subject in the same transaction, the installation must still be locked, and
both initial-authority and governance records must be absent. That entry writes
the ordinary permanent terminal fence with a hashed reservation reference. Native
cleanup may skip the unavailable governance guard only while those exact
pre-initialization conditions remain; an initialized installation always uses
the normal protected-identity guard. Initial-authority assertion recording and
final handoff also recheck an injected identity eligibility predicate in their
transactions, preventing a previously verified but now terminal provisional
subject from becoming the initial authority. This does not reopen setup or
provide an initialized-installation purge bypass.

The standalone lifecycle browser fixture now exercises real Node SQLite login,
OIDC/PKCE storage grants, encrypted Yjs/attachment bytes, mandatory notice
acceptance, archive catalog/object downloads, release and restore, followed by
terminal identity/object cleanup. The fixture changes only existing retention
timestamps to simulate elapsed periods. It labels paid history as a trusted
sandbox projection, uses the actual isolated official test Turnstile flow, and
makes no external-payment or real-human-detection claim. The founder remains
protected; an ordinary second identity is the target. Runtime defaults still
leave retention execution off.

An accepted archive download can resume the same original session's existing
lease without extending its deadline. Explicit owner release removes only that
session's exact lease, allowing restore after downloads finish. A concurrent
object read rechecks owner/archive state after buffering bytes and fails if
release and purge won; it cannot publish bytes based on a stale lease. Native
SQLite/encrypted-object regressions cover those races. The fixed one-hour lease
and immutable archive expiry still bound export retention.

Native user deletion and post-user receipt cleanup run outside metadata locks.
The helper first persists a bounded contact snapshot, completes metadata-only
cleanup, deletes and confirms absence of the native user, performs bounded
native receipt cleanup, then commits the terminal completion marker and removes
the temporary snapshot. Known native row absence and object-file removal are
observable test assertions, not a forensic disk-erasure or complete historical
verification-row discovery claim. Owner indexes for remaining native credential
classes are tracked separately.
