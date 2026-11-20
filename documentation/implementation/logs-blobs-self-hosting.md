# Private Waypo with disk-backed logs and blobs

This is the current Node setup for the open-source reference implementation. It
uses your disk and SQLite; it needs no Waypo.link, Cloudflare, Polar or S3 account.
Production release remains disabled. The examples are for a fresh private
installation and do not migrate an old CRDT/attachment installation.

Logs and blobs are independent services. Apps own their state model and may build
CRDT synchronization on the ordered log; Waypo does not interpret their payloads.
The Node host archives retained log prefixes into its private object directory and
serves the same log interface across hot/cold storage. Metadata and native identity
live in separate SQLite files. These paths must survive process/container restarts.

> This guide follows the reviewed open-source candidate `e95d17e`. It does not change the hosted service runtime pin or enable public services. Use that source or a later qualified release for the example below.

## 1. Create a private configuration

From the repository root, install Node 24+ and run `npm ci` (including install
scripts). The pinned Native compatibility patches are required. The committed
[example](https://github.com/3sln/waypo/blob/e95d17e/examples/self-hosting/storage.config.json) intentionally has **no
signing secret** and cannot be started as-is. Generate a private copy:

```sh
node --input-type=module <<'JS'
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const config = JSON.parse(await readFile('examples/self-hosting/storage.config.json', 'utf8'));
config.installationId = 'private-' + randomBytes(16).toString('hex');
config.authSecret = randomBytes(48).toString('base64url');
await mkdir('.data/self-hosted', {recursive: true, mode: 0o700});
await writeFile('.data/self-hosted/config.json', JSON.stringify(config, null, 2),
  {mode: 0o600, flag: 'wx'});
JS
```

This refuses to overwrite a configuration. Keep its installation ID, secret and
paths stable. Choose storage/work limits before the first start; protected profile
changes are discussed below. The example binds user/admin listeners to loopback,
keeps registration closed, disables support, analytics and automatic account-retention deletion, and
permits only the deployment-approved private passkey setup exception.

The operator quota is 1,000,000,000 logical bytes per account and 4,000,000,000 across
the installation. Each active account also reserves a separate 2 GiB physical/row
slice; four accounts fit the configured 10 GiB fleet envelope. These are example
operator choices, not hosted product tiers or a claim of exact on-disk usage.

## 2. Provision once, then start

Read the non-secret installation ID from your private configuration:

```sh
WAYPO_INSTALLATION_ID="$(node --input-type=module -e "import {readFile} from 'node:fs/promises'; console.log(JSON.parse(await readFile('.data/self-hosted/config.json','utf8')).installationId)")"
node packages/adapters/node/provision.mjs \
  --database .data/self-hosted/installation.sqlite \
  --installation-id "$WAYPO_INSTALLATION_ID" \
  --acknowledge-new-installation
node packages/adapters/node/work-period-provision.mjs \
  --config .data/self-hosted/config.json \
  --acknowledge-initialize-work-period-budget
WAYPO_CONFIG=.data/self-hosted/config.json node apps/server/node.mjs
```

The first command exclusively creates a **new** metadata database. The second
initializes the explicitly configured installation work wallet. Neither is normal
HTTP startup. Re-running provisioning against an existing file is refused; do not
delete an installation or ledger to recover access or replenish work.

Open the user app at `http://localhost:9511` and the administrative app at
`http://localhost:9512`. `GET /healthz` reports availability and
`productionRelease: false`. A locked setup screen is expected until a browser has
been approved. Node creates `auth.sqlite` and the private `objects` directory under
`.data/self-hosted`; no object-store credentials are required.

## 3. Bootstrap without opening public signup

In the admin app select **Show browser fingerprint**. The browser creates a local
approval key. Seeing/copying its public fingerprint grants no access. Stop the
runtime and use the existing [deployment approval command](self-hosting.md#temporary-setup-and-authority)
with this configuration path and the fingerprint from that browser. It reads the
locked installation marker and selects a fresh approval generation; it does not
reset the database. Restart with the same configuration.

Return to that browser and open the temporary bootstrap login. Create the privately
approved passkey identity, verify the passkey for setup, then explicitly accept the
first policy-authority grant. The temporary login itself is not an administrator.
Approvals last at most one hour, and the temporary bootstrap login at most fifteen
minutes. If it expires before handoff, approve a newer generation. Remove the
approval from configuration after successful setup; the consumed generation cannot
reopen initial setup. Additional people use the administration's invitation/grant
workflows, not public registration.

An initialized installation uses the separate
[deployment-authority recovery procedure](self-hosting.md#recovering-policy-authority-after-all-identities-are-lost).
Changing the initial approval or deleting a session cannot reset initial setup.
Keep both SQLite databases, objects, secrets and required encryption-key versions
for recovery. Password login or a public email service is not required for the
private passkey bootstrap in this example.

## Choose independent services

Before first initialization, edit only the flags you need:

| Purpose | `services.logs` | `services.blobs` |
| --- | --- | --- |
| Ordered app event/state logs only | `true` | `false` |
| Application key/blob store only | `false` | `true` |
| Both | `true` | `true` |

Keep `storageCapacity` and `workBudget` for any of these profiles. Do not add the old
`sync`, `attachments` or `subscriptions` settings: they describe the historical
provider-CRDT implementation. A blobs-only provider need not advertise logs; a
logs-only provider need not advertise blobs. Apps discover each independent OIDC
metadata extension. Disabling a service does not authorize deleting its retained
inventory or changing backend identity.

The basic blob interface accepts buffered objects up to 4 MiB. Optional Native
multipart streaming is mounted by maintained Node/Worker hosts when configured;
apps discover it as `waypo_blobs.transfers`. The local normal-host discovery and
SDK flow is qualified separately from public deployment and maximum-size performance.
To configure its maximum **before starting a fresh installation**, add:

```json
"blobTransfers": {"maxBytes": 134217728}
```

Place this inside `services`, with `blobs: true`. The example already reserves
268,435,456 staged bytes and enough work, rows and physical space for that 128 MiB
maximum. The maximum supported native object remains 128 MiB with 5 MiB parts; it
is a validated implementation bound, not a paid tier. Enabling the field alone is
not evidence that a public deployment's Native capability is qualified. The
[streaming guide](../design/blob-streaming-next.md) explains discovery and app flow. Native
bytes use the operator filesystem, not end-to-end encryption. Optional legacy
object-key encryption must retain all keys required to read old objects.

## Choose quotas and limits deliberately

`policy.quota.selfHostedStorageBytes` controls each account's logical entitlement;
`policy.quota.fleetStorageBytes` controls the combined logical allowance. The example
has no hosted 500 MB entitlement, trial or billing dependency. Self-hosters may
choose larger finite numbers. Keep `services.limits.accountBytes` consistent as the
standalone fallback and for native sizing validation. Increase `policy.revision`
when changing the account policy.

Physical capacity is distinct: it includes live data, metadata, staging, retained
versions/pins and unknown I/O. Native validation requires at least:

`account physical slice >= logical quota + native staging/reservation envelope + 65,536`

The native envelope reserves two copies of a candidate plus bounded metadata while
the old committed version remains charged. Leave extra room for log descriptors,
concurrent work and retained exports; logical quota alone is not a disk reservation.
Fleet bytes/rows must fit the desired number of complete account slices plus shared
base metadata. Garbage collection returns capacity after confirmed retirement;
unknown deletion is not a refund. A permanently undersized profile cannot be fixed
by retrying. Use an OS/filesystem quota or dedicated volume if you need a hard disk
boundary independent of application accounting.

No limit accepts `Infinity`, a negative number or an unlimited sentinel. Product
allowances are configurable; request sizes, memory bounds, catalog ceilings and
replay invariants still protect the implementation. See the
[closed funding matrix](https://github.com/3sln/waypo/blob/e95d17e/docs/review/storage-operation-funding.md) and
[service limits](https://github.com/3sln/waypo/blob/e95d17e/packages/services/limits.mjs) for the actual boundaries.

The work settings are finite per-account/app/fleet rate buckets plus an optional
installation daily/monthly wallet. Owner export and essential cleanup reserves are
included in that wallet, not extra spend outside it. The example's work floors
cover logs/blobs and the optional 128 MiB native profile. To compute your exact
minimum after editing a candidate configuration:

```sh
WAYPO_CONFIG=.data/self-hosted/config.json node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {validateConfiguration} from './apps/server/node.mjs';
import {storageWorkEnvelopes} from './packages/services/storage-work-profile.mjs';
const config = validateConfiguration(JSON.parse(await readFile(process.env.WAYPO_CONFIG, 'utf8')));
console.log(storageWorkEnvelopes(config.services));
JS
```

Validation reports the failing daily/monthly dimension and required minima. Work
units are admission accounting, not currency or a bill. A private host may omit the
period wallet on a fresh deployment if it intentionally wants rate/stock controls
without a period ceiling; that is not an instruction to remove an already anchored
wallet. Examples retain one for predictable resource use.

**Changes to an initialized installation need care.** Weighted `workBudget` changes
bind a different policy digest; simply editing the environment is not a supported
actor-credit migration, even after 30-second balances expire. Physical capacity and
backend bindings are protected too. Do not delete markers or credit rows. The
separate implemented period-wallet CLI supports explicit guarded migration using
`--expected-policy`; it preserves spent work and does not migrate weighted actor
credits or storage/backend identities. Plan headroom up front, back up before an
operator-supported change, and do not treat this example as an in-place upgrade.

Choose the Node or Docker setup for a fresh data directory; do not provision the same installation twice or relocate protected storage bindings as an informal migration.

## Single-container Docker

The [runtime Dockerfile](https://github.com/3sln/waypo/blob/e95d17e/docker/node.Dockerfile) checks the tracked browser
bundle in a build stage, then removes development tools. The final image runs Node
as a non-root user; it does not contain browsers, Docker Compose, Cloudflare tools
or the E2E test environment. Build from the repository root:

```sh
docker build -f docker/node.Dockerfile -t waypo-node:local .
```

For a **fresh** Docker installation, create the private configuration as above, then
edit the copy before provisioning: set `host` to `0.0.0.0`, `database` to
`/data/installation.sqlite`, `authDatabase` to `/data/auth.sqlite`, and
`services.objectsDirectory` to `/data/objects`. The canonical localhost issuer and
ports stay the same for this loopback-only walkthrough. Run the actual provisioning
commands inside the image, with your private directory mounted:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD/.data/self-hosted,target=/data" \
  waypo-node:local node packages/adapters/node/provision.mjs \
  --database /data/installation.sqlite --installation-id "$WAYPO_INSTALLATION_ID" \
  --acknowledge-new-installation
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD/.data/self-hosted,target=/data" \
  waypo-node:local node packages/adapters/node/work-period-provision.mjs \
  --config /data/config.json --acknowledge-initialize-work-period-budget
docker run --name waypo --init --restart unless-stopped \
  --user "$(id -u):$(id -g)" --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp:rw,nosuid,size=16m \
  -p 127.0.0.1:9511:9511 -p 127.0.0.1:9512:9512 \
  --mount "type=bind,source=$PWD/.data/self-hosted,target=/data" \
  waypo-node:local
```

Use the unprivileged account that owns the private directory; do not run these as
root. `--user` also avoids host bind-mount UID mismatches. The image defaults to the
unprivileged `node` user when no override is needed. Runtime writes go to `/data`;
replacing/restarting the container does not reprovision that mounted installation.
The 512 MiB process limit is an example, not the account storage allowance. An
optional [small-heap preset](self-hosting.md#small-container-node-runtime-preset)
exists for constrained Node deployments; total process memory and V8 heap are
separate budgets.

For real network access, choose final HTTPS issuer/admin URLs and a compatible RP
ID before setup, then terminate TLS at your reverse proxy. Keep the internal HTTP
ports private, route each public origin to its corresponding listener, preserve the
original **Host** header (including a non-default port), and support long streamed
responses without buffering whole files. Node rejects a Host that does not match
the configured canonical origin. Loopback HTTP is for local browser evaluation,
not a public deployment setting. A stable domain/RP ID matters to existing passkeys.

The optional container smoke command is documented with its source in
[`e2e/self-hosting-container.mjs`](https://github.com/3sln/waypo/blob/e95d17e/e2e/self-hosting-container.mjs). It provisions
an isolated mounted installation, checks non-root runtime/health/locked UI/closed
signup and persistence across restart, and cleans up only its own container.
Screenshots are opt-in. It does not replace the multi-app/provider release suite.
