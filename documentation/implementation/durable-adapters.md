# Durable bootstrap store adapters

> **Status:** Development documentation. Production release remains disabled.

2026-11-02. Implemented locally in the clean Waypo slice; production remains
disabled. Node SQLite has executed disk/restart/process-exit tests. The Cloudflare
adapter has also executed native workerd SQLite transactions, rollback and
bootstrap persistence across three process starts in `e2e/worker-adapter.test.mjs`.
This is local runtime evidence, not deployed-provider durability verification. Neither adapter makes the
bootstrap slice a complete identity provider.

## Shared engine port

Both adapters provide `transaction(async tx => result)` with `tx.get(key)`,
`tx.put(key, value)` and `tx.delete(key)`. Each callback commits atomically or
rolls back on throw. Callbacks must perform only the supplied store operations and
bounded local computation, not fetches, notifications or other external effects.
Await every store operation. The transaction capability expires when its callback
finishes; never retain it for later tasks.

Keys are nonempty strings up to 256 UTF-8 bytes. Values are JSON-compatible data
up to 256 KiB and depth 32. Undefined, holes in arrays, non-finite numbers, bigint,
binary arrays, getters, custom object instances and cycles are rejected rather
than silently coerced. This is a deliberately small bootstrap/identity metadata
port, not an attachment or CRDT snapshot store. Native storage limits still apply.
Reads and results do not alias mutable persisted state.

Bootstrap core reads deployment configuration at its security-sensitive
boundaries, verifies real cryptographic proofs outside transactions and rechecks
stored challenges/generations at commit. Adapters do not authenticate the operator,
verify WebAuthn, implement grant quorum or authorize account creation. A store
handle itself is a privileged in-process capability; never expose arbitrary get,
put, provisioning or callback execution through public HTTP/RPC.

## Node SQLite

Files:

- `packages/adapters/node/sqlite.mjs`: `openNodeSqliteStore({filename})` and
  `provisionNodeInstallation({filename, installationId})`.
- `packages/adapters/node/provision.mjs`: standalone trusted operator command.
- `packages/adapters/values.mjs`: portable value validation and installation marker.

The implementation uses maintained native `node:sqlite` `DatabaseSync`, with no
third-party SQLite dependency. Node added this API in 22.5; flag-free loading began
in **22.13**. Older Node 22 builds are not supported by this entry point. Actual
tests ran on Node **24.6.0**, where SQLite still emits its experimental warning;
this is not a claim to have tested every supported Node version. See
[Node SQLite history/API](https://nodejs.org/api/sqlite.html).

Normal startup opens an existing file and validates its schema version. It never
creates a file, schema or missing installation marker. A zero-length/missing or
unprovisioned file fails closed. Symlinks, non-regular files and hardlinks are
refused. On POSIX, group/other permission bits must be absent. The provisioner
creates the file exclusively with mode 0600; keep its parent directory private
(0700 recommended) and on trusted local storage. The local operator controls
filesystem paths; these checks are not an OS-level defense against an attacker
already able to replace parent directories or write the provider's files.

SQLite uses WAL, `synchronous=FULL`, a five-second busy timeout, parameterized
statements and explicit `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`. Each store instance
shares a serialized queue with other handles to the same database inode in its
Node process. SQLite locking coordinates different processes. This avoids a
second synchronous SQLite handle blocking the same event loop while the first
transaction awaits its store operations. Nested transactions on the same database
fail rather than deadlock. Busy/disk/commit errors fail the operation; they are
not successful acknowledgments.

The queue is a coordination aid, not the source of durability. Process-exit tests
exercise the actual SQLite transaction boundary. Power loss, broken filesystems,
disk exhaustion and network-filesystem semantics are not covered by those tests.
Use local SQLite-supported storage and a tested consistent backup procedure;
copying only a live main database file can omit its WAL. Filesystem permissions
are not database encryption. Key-at-rest policy and backup encryption remain
separate work.

### Explicit first provisioning

Create a private parent directory through your trusted shell/deployment channel,
then run:

```sh
node packages/adapters/node/provision.mjs \
  --database /private/provider/identity.sqlite \
  --installation-id my-provider-installation \
  --acknowledge-new-installation
```

This creates only a locked installation marker. It creates no identity, passkey,
administrator grant or bootstrap approval. The command refuses an existing path,
including an empty file, consumed installation or partly failed provisioning.
On failure it does not erase the file and try again. Startup must never invoke
this command automatically because storage appears empty.

The marker, consumed-generation watermark and latest approval binding must survive
backup/restore. Lost state is an explicit operator recovery event. Do not “repair”
it by deleting the database and rerunning normal startup. Recovery must deliberately
invalidate old sessions/approvals, use a fresh installation binding where needed
and reconcile the provider's existing durable identity/grant state. A full recovery
command is not implemented. Command output contains installation/path/status,
never enrollment/session secrets.

## Cloudflare Durable Objects

`createDurableObjectStore(ctx.storage)` in
`packages/adapters/cloudflare/durable-object.mjs` wraps the **native storage
transaction** and uses the transaction object's get/put/delete methods. It does
not simulate atomicity with a JavaScript mutex or invent SQL transaction
statements. No `allowUnconfirmed` or concurrency-relaxing options are used.
Use a SQLite-backed Durable Object namespace for new installations.
[Cloudflare transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction).

Create the engine and adapter inside the same installation's Durable Object.
Route every installation bootstrap transaction to that object's stable identifier;
two different DOs do not share a transaction. Do not send JavaScript callbacks or
the generic store capability through an external RPC surface. The factory is used by `apps/worker/database.mjs` and the installation class
in `apps/worker/index.mjs`; there is no public provisioning route.

`store.provisionInstallation({installationId})` is a trusted deployment-only port.
Its native transaction lists at most one existing KV key, refuses a nonempty
adapter keyspace and writes the locked marker. It does not inspect unrelated SQL
tables; use a dedicated installation object and do not infer that other SQL-backed
identity state is absent from an empty KV listing. It is not automatically invoked by the
constructor or missing-marker handling. It authenticates no caller itself; the
future operator control plane must do that before invocation. Cloudflare account
credentials or a public “first visitor” request must not be confused with an
ordinary Waypo user's authorization.

Cloudflare may retry a transaction callback; callbacks therefore contain no
external effects. Expiry and proof admission remain in the engine. Native storage
commit/output gates apply; future HTTP handlers must not bypass them or claim
delivery before returning the engine's committed result. Native platform documentation is implementation input. Local workerd rollback
and restart evidence exists; output-gate failure injection, deployed-region
verification and power-loss behavior remain separate gates.

## Executed engine tests and remaining gates

Run `node --test tests/engine/adapters.test.mjs`, or the repository engine test
command. The adapter suite currently exercises:

1. Exclusive acknowledged provisioning, permissions, existing/lost database refusal
   and symlink refusal.
2. Real ngin bootstrap challenge/proof/session state across closing and reopening
   a disk SQLite database; consumed approval remains consumed.
3. Concurrent completion through independent engines/database handles, with one
   winner and rollback of rejected writes.
4. A child process exiting after session writes but before COMMIT: uncommitted
   consumption rolls back and the original proof can complete after restart.
5. A child process exiting after committed completion: consumption survives even
   though the issuing process never delivers its result; replay cannot issue a
   second session.
6. Two independent OS processes competing for the same approval: exactly one
   completion succeeds.
7. JSON bounds, reference isolation, nested transaction denial and invalidation of
   escaped transaction capabilities.
8. Cloudflare adapter mapping/rollback/provisioning semantics against a test
   transaction resource. **This final test is not actual Durable Object evidence.**

The separate `e2e/worker-adapter.test.mjs` runtime suite executes actual workerd
native transaction rollback, nested rollback, stable object routing and ngin
bootstrap persistence over three independent process starts. Its separate Better
Auth integration scenario exercises email admission and session restoration.
These tests use explicit test-only operator endpoints, never production routing.

Remaining gates include deployment operator authorization and recovery, deployment
configuration/recovery handling, browser proof and WebAuthn enrollment/handoff,
storage failure/backups, HTTP origin/CSRF/cookie behavior and production release
review. Do not infer those capabilities from the Node tests or configured bindings.


## Private Worker object storage

Snapshots and attachments use `createR2PrivateObjects` in
`packages/adapters/cloudflare/r2-objects.mjs`, backed by a private `PRIVATE_OBJECTS`
R2 binding. Durable Objects contain authorization metadata and active state, not
snapshot/attachment blobs. Enabling synchronization without the binding fails
startup. The bucket name in the disabled preview config is an operator placeholder;
no bucket is created or made public by startup.

Objects have an installation-prefixed key, a strict private-object key grammar
and a four MiB maximum. Creation uses an atomic conditional R2 PUT with
`onlyIf: new Headers({'If-None-Match': '*'})`; a failed condition returns null
and is reported as an existing immutable object, never acknowledged as a new
write. The adapter awaits object storage before the engine publishes a pointer.
See [Cloudflare's Workers R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [conditional create-once semantics](https://developers.cloudflare.com/r2/api/s3/extensions/).
A later metadata failure can leave a staged orphan; the bounded engine staging/GC
protocol handles that seam rather than pretending R2 and DO commits are atomic.

The workerd adapter suite has executed the local persisted R2 emulator: a 150 KB
object survives process restart, conditional concurrent creation has one winner,
a conflicting write cannot clobber the immutable object, installation namespaces
remain isolated, oversized writes fail, and a staged orphan survives failed
metadata publication until explicit cleanup. Engine tests separately exercise
staging expiry, failed publication and quota accounting. This is actual local
runtime/emulator evidence, not remote R2 durability or production verification.

`e2e/worker-adapter.environment.mjs` runs two native Worker provider processes
behind the same six-origin local TLS network as Node. Private loopback fixture
control and mail transports require an ephemeral secret; proxy routes deny control
paths and never expose that secret. It persists DO and local R2 state across
supervisor restarts and reads the same explicit operator bootstrap configuration.
Client metadata and federation fixture transports have fixed exact destinations;
they are not evidence of a safe general public Worker CIMD transport.

## Provider-managed encryption and key lifecycle

`packages/adapters/encrypted-objects.mjs` wraps the private object backend with
actual AES-GCM encryption before original payload storage. This is provider/server
encryption, not end-to-end encryption against the provider. Fresh 96-bit nonces,
128-bit tags, format version, key ID, installation ID and exact object key bind
each envelope. The logical user limit remains four MiB; the private backend allows
at most 64 extra envelope bytes. The format is a private backend representation,
not a new interoperability encoding.

The explicit keyring has one active encryption key and at most three additional
decrypt-only keys. `WAYPO_OBJECT_KEYS` for Workers, or private Node `objectKeys`,
contains `{activeKeyId, keys:[{id,key}]}` where key is a canonical base64url 32-byte
key. These values are secrets and never enter public configuration responses.
Durable fingerprint bindings reject losing old keys, changing material under an
existing ID and downgrading to an earlier active key. They are established only
after trusted installation provisioning, never by a first public health probe.

Back up all required key versions separately from encrypted data, protect those
backups, and test restoration. There is no automatic key retirement or raw-object
migration. A raw legacy object never becomes "encrypted" merely because a keyring
was configured: envelope verification fails closed. Old versions remain necessary
until an explicit inventory-backed migration/retirement workflow exists. The
four-key bound intentionally refuses unlimited rotations instead of silently
stranding referenced data.

Five tests in `tests/engine/adapters-encrypted.test.mjs` inspect actual ciphertext
files, round-trip after reopening, reject tampering/object/installation swapping,
exercise rotation and missing keys, validate logical/physical byte bounds and
prove durable SQLite key pinning across restart. Resource archive confirmation
also verifies actual encrypted envelopes; a configured flag alone is insufficient.

## Shared durable wakeup scheduling

`packages/adapters/wakeups.mjs` maintains a fixed category map for notifications,
push, policies, support GC and state GC in the same transaction as each producer's
metadata update. Native Worker alarms target the earliest category; completing
one category cannot delete another category's wakeup. Node stores the same map for
its restartable SQL poller. The native workerd adapter suite has verified atomic
alarm/metadata rollback, category preservation and committed alarm state across
process restarts. Worker startup does not initialize authentication/key metadata
before a valid operator-created installation marker exists.

Worker request concurrency: the SQL adapter serializes each standalone query and
schema introspection, while an explicit Kysely or engine metadata transaction
holds the same lease for the entire native Durable Object transaction. The
AsyncLocalStorage lease closes on completion so detached work cannot retain an
unlocked SQL capability. HTTP handling and alarm runners do not hold the database
lease around external email, object or discovery waits. Application creation uses
one shared initialization promise per instance. This preserves atomic native SQL
while allowing unrelated requests to progress during external I/O; bounded
admission and network deadlines remain separate requirements. The native adapter
test delays actual mail transport and checks that health completes first. A
configured six-origin browser profile and slow-discovery concurrency evidence
remain separate from that narrow adapter test.

The current Worker routes an entire installation to one `WaypoInstallation`
Durable Object using `idFromName(installationId)`. Authentication, service
metadata and active document journals share that object's SQL throughput and
storage boundary; immutable snapshots and attachments use private R2. The
per-account 10 GB commercial storage allowance is an object quota, not a promise
that one DO can hold 10 GB of active journals per account or serve unlimited
accounts. No launch account-count/throughput capacity has been measured, so
production capacity and cost remain unestablished. Removing network waits from
the database lock improves availability but does not horizontally shard SQL.

A future partition can retain installation identity/governance in this DO and
place account service state in per-account DOs. That partition must first define
and test live grant/family/epoch fencing across the identity and account objects,
including revocation during an already admitted write. A signed admission token
alone does not establish immediate live revocation. Per-account service DO
partitioning is a candidate seam, not implemented architecture.

The Worker subscription adapter uses native hibernating WebSocket acceptance,
channel tags and serialized `{v,channelId,expiresAt}` routing attachments. Those
attachments contain no user, namespace or grant authority. The portable engine
must authorize every delivered invalidation against the current accepted grant.
Connections have a maximum 15-minute lifetime and use `waypo-sync-v1`; client
payloads are refused. A separate `subscriptions` wakeup category preserves the
journal, recovery, notification and lifecycle deadlines. Native end-to-end
subscription authorization and hibernation evidence are tracked independently
from the routing-port test.

An optional trusted `onStorageOperation` Worker construction port emits only
numeric operation diagnostics, never keys, SQL text, parameters or values. SQL
cursor rowsRead/rowsWritten are reported after consumption when available;
unknown counters stay explicitly unknown. Native KV get/put/delete/list and
alarm calls are separate logical operations, with serialized JSON byte counts
as a size proxy. Hidden native KV SQL rows are not inferred from that proxy.
R2 requests and physical upload/read payload bytes are counted separately,
including encryption overhead. Counters include attempted rolled-back work;
they are neither committed-state counts nor an invoice/billed-CPU measurement.
The local supervisor exposes only fixed numeric totals through private operator
fixture control, with an explicit reset; no production HTTP metrics route exists.

The driver also exposes a trusted native-transaction predicate from its exclusive
ALS lease. Worker auth-state scheduling asserts that predicate before entering
the co-located metadata transaction, so native client/index persistence and the
alarm coalescer commit or roll back together. Node's separate auth/metadata files
instead retain durable native-index polling on startup and during maintenance.
