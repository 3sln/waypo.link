# Private installation evaluation

> Source-development reference: refreshed from open-source Waypo commit `f916cac`. The hosted source pin now selects this reviewed revision for local pair qualification; production remains disabled. These controls are not a claim about the currently deployed service, a completed security audit, or production qualification.


Waypo is incomplete and production release is disabled. This guide describes the implemented Node installation boundary, not approval to expose it publicly. No Waypo.link, Polar or Cloudflare account is required. Use the [implementation map](plan.md) for verification status and [durable adapter guide](durable-adapters.md) for persistence and recovery constraints.

## Local installation

Install Node 24, then run `npm ci` and `npm test` in the repository. Install scripts apply the pinned Native compatibility patches; do not skip them. Create a private configuration without printing its secret:

```sh
node --input-type=module <<'JS'
import {mkdir, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
await mkdir('.data/private', {recursive: true, mode: 0o700});
await writeFile('.data/private/config.json', JSON.stringify({
  issuer: 'http://localhost:9511/api/auth',
  adminUrl: 'http://localhost:9512',
  rpID: 'localhost',
  host: '127.0.0.1',
  port: 9511,
  adminPort: 9512,
  database: '.data/private/installation.sqlite',
  installationId: 'private-' + randomBytes(16).toString('hex'),
  authSecret: randomBytes(48).toString('base64url'),
  admission: 'closed',
  allowInsecureLoopback: true,
  allowPrivateOperatorEnrollment: true,
  services: {sync: false, attachments: false, signaling: false, notifications: false},
  support: {mode: 'disabled'}
}, null, 2), {mode: 0o600, flag: 'wx'});
JS
```

This intentionally refuses to overwrite an existing configuration. Read its generated `installationId` and use that exact value in the trusted provisioning command:

```sh
node packages/adapters/node/provision.mjs \
  --database .data/private/installation.sqlite \
  --installation-id YOUR_GENERATED_INSTALLATION_ID \
  --acknowledge-new-installation
WAYPO_CONFIG=.data/private/config.json npm run dev
```

Provisioning refuses an existing database path. Do not delete or reprovision an existing installation to recover access. The runtime creates a separate native authentication database beside the installation database; both are needed for a consistent backup.

## Private disk storage and operator limits

The Node provider stores metadata in its SQLite databases and immutable document snapshots/attachments in an ordinary private directory. No object-storage service is needed. Enable sync and select a directory on your own disk; keep it outside the website document root. The default directory is the metadata database path plus `.objects`.

These are additions to your private configuration, not a complete replacement:

```json
{
  "services": {
    "sync": true,
    "attachments": true,
    "signaling": true,
    "objectsDirectory": ".data/private/app-objects",
    "limits": {
      "documents": 128,
      "documentBytes": 1048576,
      "updateBytes": 131072,
      "structLength": 2097152
    }
  },
  "policy": {
    "mode": "self-hosted",
    "revision": 2,
    "quota": {
      "selfHostedStorageBytes": 100000000000,
      "fleetStorageBytes": 1000000000000
    }
  }
}
```

The example grants each account 100 decimal GB of logical data, independently of Waypo.link's 500 MB hosted offer. The policy quota is authoritative; `services.limits.accountBytes` is only the standalone engine fallback when no policy capacity port is present. Increase the policy revision when changing a live policy. Configure your own disk-headroom and request/work budgets before exposing the installation to other people; logical quotas are not a disk reservation or a guaranteed dollar ceiling.

`services.limits` accepts known finite integer overrides. The same settings reach the service engine, HTTP request bounds and retained cleanup on Node and Worker. Unknown names, `null`, infinity, negative values and unsupported upper bounds fail startup rather than silently disabling protection. No field accepts an unlimited sentinel. Ordinary account policy and app authorization remain in force.

| Setting | Default | Current implementation ceiling |
| --- | --- | --- |
| Documents/account across apps | 64 | 1,024, also constrained by serialized metadata capacity |
| Document snapshot | 128 KiB | 4 MiB |
| Individual update | 64 KiB | 128 KiB with journaling; 4 MiB with `journalUpdates: 0` |
| Attachment | 4 MiB | 4 MiB: buffered-object/encryption safety limit |
| Attachments/account | 4,096 | 4,096: current fixed paged catalog |
| Update structures / total structure length | 4,096 / 262,144 | 65,536 / 8,388,608 |

The complete allowed fields and ceilings are in `packages/services/limits.mjs`. Stage, garbage, receipt and journal controls are finite too. Raising a document count does not enlarge the underlying portable metadata row: new growth stops with `account_metadata_capacity` at 240 KiB, leaving headroom for maintenance. That permanent capacity response means clean up/split data or improve paging; retrying the same write does not help. Larger independent account quotas do not alter that boundary.

The bundled SDK has matching optional local limits, so an app can use a larger configured document without patching the SDK:

```js
const document = createSyncedDocument({
  namespace, documentId: 'settings', kv, transport,
  limits: {documentBytes: 1048576, updateBytes: 131072, structLength: 2097152}
});
```

All devices opening that larger document need compatible limits. The defaults remain unchanged for existing apps. The SDK keeps its finite 1 MiB offline outbox and caps individual updates at 128 KiB; make large edits as bounded transactions. Changing a limit does not change CRDT semantics or the wire format. Lowering limits below already saved state can require local recovery; the SDK refuses to discard that state and retains `exportStoredState()` for recovery. Server limit changes likewise do not delete existing objects.

The 4 MiB attachment ceiling is not a commercial restriction: this version buffers whole objects and has not yet implemented streaming/multipart large files. Raising a number alone would create an unsafe memory promise. Compression/compaction and the generic document SDK are not a general blob store. Back up the metadata database, native authentication database, private objects and every required encryption-key version together. Optional object encryption is available through the deployment keyring; retain its keys when disabling sync. Existing object storage and garbage collection remain available while sync is disabled; a fresh disabled installation creates no object directory.

This source revision targets Node 24. Native identity guards inspect the actual SQLite transaction boundary; startup refuses an unsupported connection instead of treating a missing transaction flag as permission. The account-creation credit authority is contacted outside that transaction.

## Temporary setup and authority

Open `http://localhost:9512` in a passkey-capable browser and select **Show browser fingerprint**. The browser creates a local approval key and displays its fingerprint. Opening the page confers no access. Copy that fingerprint into a deployment-controlled `approval` object in the private configuration:

Stop the local runtime while editing its private configuration. The following command reads the existing installation marker, selects a generation newer than every recorded approval and writes a 30-minute approval. It refuses an initialized installation; it never resets setup or modifies the database. Set the two environment values yourself; the fingerprint is public, but must come from the browser you intend to approve.

```sh
WAYPO_CONFIG=.data/private/config.json \
WAYPO_BOOTSTRAP_FINGERPRINT='p256-sha256:PASTE_THE_BROWSER_FINGERPRINT' \
node --input-type=module <<'JS'
import {readFile, writeFile, rename} from 'node:fs/promises';
import {openNodeSqliteStore} from './packages/adapters/node/sqlite.mjs';
import {BOOTSTRAP_KEYS} from './packages/identity-core/index.mjs';
const path = process.env.WAYPO_CONFIG;
const config = JSON.parse(await readFile(path, 'utf8'));
const fingerprint = process.env.WAYPO_BOOTSTRAP_FINGERPRINT;
if (!/^p256-sha256:[A-Za-z0-9_-]{43}$/.test(fingerprint ?? '')) {
  throw Error('Paste the exact fingerprint shown by the setup browser');
}
const store = openNodeSqliteStore({filename: config.database});
let generation;
try {
  generation = await store.transaction(async tx => {
    const marker = await tx.get(BOOTSTRAP_KEYS.installation);
    if (marker?.id !== config.installationId || marker.status !== 'locked') {
      throw Error('Only an existing, locked installation can enter initial setup');
    }
    return Math.max(marker.consumedGeneration ?? 0,
      marker.approvalBinding?.generation ?? 0, config.approval?.generation ?? 0) + 1;
  });
} finally { await store.close(); }
const issuedAt = Date.now();
config.approval = {generation, fingerprint, issuedAt, expiresAt: issuedAt + 30 * 60 * 1000};
await writeFile(path + '.next', JSON.stringify(config, null, 2), {mode: 0o600, flag: 'wx'});
await rename(path + '.next', path);
console.log('Approval generation', generation, 'expires', new Date(config.approval.expiresAt).toISOString());
JS
```

Restart the runtime and return to the original browser. The browser proves possession of its private key to open the temporary bootstrap login. The fingerprint alone cannot sign that proof. An approval lasts at most one hour; its bootstrap session lasts at most fifteen minutes and cannot outlive the approval. If setup expires before the final authority handoff, repeat the command with the current browser fingerprint and a newer generation. If setup has finished, use the separate recovery process below instead.

With `allowPrivateOperatorEnrollment` explicitly enabled, the approved bootstrap browser can create an ordinary identity using a user-verified passkey without email delivery. Enter a **Public display name**, select **Begin passkey account**, then **Prepare account passkey** and **Create account and accept this passkey**. Registration is followed by **Verify passkey for this setup** and **Accept policy authority and finish setup**: a separate fresh passkey assertion and explicit acceptance of policy authority. The temporary bootstrap session itself is never an administrator. Public registration remains closed. This deployment exception does not make email or push optional for the hosted public service.

Remove the approval after successful setup. Its generation is consumed durably; an old approval cannot reopen initial setup. Add further privileged users through the administration access/grant workflows, using ordinary identities. Installation-owned service credentials are separate from the account of their creator. Do not treat a copied browser key or configuration fingerprint as a permanent administrator credential.

## Recovering policy authority after all identities are lost

This is a deployment-controlled recovery of an existing installation. Keep the original databases, object keys and installation marker. Initial bootstrap stays consumed. The Node and native Worker browser fixtures both exercise the six-step recovery flow with genuine WebAuthn, including a valid assertion without user verification being refused; production Worker operator inspection tooling remains a separate gap described below.

On Node, obtain the current governance revision from the existing private metadata database. From the repository directory, with `WAYPO_CONFIG` pointing to the private configuration file, this command prints only the revision and refuses a missing or mismatched installation:

```sh
WAYPO_CONFIG=.data/private/config.json node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {openNodeSqliteStore} from './packages/adapters/node/sqlite.mjs';
import {ADMINISTRATION_KEY} from './packages/administration/index.mjs';
import {BOOTSTRAP_KEYS} from './packages/identity-core/index.mjs';
const config = JSON.parse(await readFile(process.env.WAYPO_CONFIG, 'utf8'));
const store = openNodeSqliteStore({filename: config.database});
try {
  const revision = await store.transaction(async tx => {
    const marker = await tx.get(BOOTSTRAP_KEYS.installation);
    const state = await tx.get(ADMINISTRATION_KEY);
    if (marker?.status !== 'initialized' || marker.id !== config.installationId ||
        state?.version !== 1 || state.issuer !== config.issuer ||
        state.audience !== new URL(config.adminUrl).href ||
        !Number.isSafeInteger(state.revision) || state.revision < 0) {
      throw Error('Existing initialized governance does not match the configuration');
    }
    return state.revision;
  });
  console.log(revision);
} finally {
  await store.close();
}
JS
```

The adapter opens only an already-provisioned file. This command reads state; it does not initialize missing governance, change principals or grant authority. Do not substitute the native authentication database for the metadata database. If the check fails, investigate the configuration/backup rather than deleting records.

Open `deployment-recovery` beneath the configured administration URL, and select **Show this browser’s recovery fingerprint**. This creates a separate browser-held key, not a new bootstrap approval. There are two independent operator approvals:

1. If no usable ordinary identity remains, set `deploymentEnrollmentApproval` in the private deployment configuration using the exact browser fingerprint, a new generation, current governance revision and deadline of at most one hour. Keep public admission closed, disable `allowPrivateOperatorEnrollment` and remove the original bootstrap approval. Restart. The approved browser selects **Open deployment-approved enrollment**, creates and explicitly accepts a user-verified passkey, and obtains an ordinary identity. The enrollment lease lasts ten minutes and does not confer administrative authority. Copy the actual account reference shown by the page.
2. Remove that enrollment approval. Separately configure `deploymentRecoveryApproval` with its own new generation, the same browser fingerprint, the exact current revision, a deadline of at most one hour, a reviewed reason and the exact replacement `authoritySubjects` list (at most 48). Restart. The original browser proves its key, reviews the exact replacement set and consequences, selects **Verify passkey for this recovery**, then explicitly accepts the recovered policy authority.

The exact two configuration shapes are in the [configuration shapes below](#deployment-recovery-configuration-shapes). Approval generations are durable and independent; use a newer generation when replacing an observed or consumed approval. If an ordinary identity is still usable, skip enrollment and perform only the separate authority approval. Each browser/UV recovery flow expires within two minutes and never extends the operator approval deadline. Signing out before native command acceptance denies the operation; signing out after acceptance does not undo that exact accepted command. Current account, policy, approval and deadline restrictions still apply.

Excluded former policy-authority roles are disabled. Pending governance/staff/account invitations, operations and personal opaque credentials are cancelled. Installation-owned service principals and their credentials survive. Recovery does not erase/restore ordinary app data, move billing or silently transfer identity. Remove both deployment approvals after completion.

For Worker operators, `tools/worker-recovery-inspect.mjs` supplies a narrowly scoped, temporary authenticated helper for reading governance revision and approval generations; see the [operator inspection guide](operator-inspection.md). Its local RPC and dry-run behavior is tested. The actual remote create/inspect/delete lifecycle is not yet qualified for release. The helper has a maximum five-minute lifetime and is not a permanent public inspection endpoint. Do not replace it with a fixture-only RPC or expose database inspection publicly.

## Deployment responsibilities

Outside loopback, use HTTPS and exact configured identity/admin URLs behind a reverse proxy. The Node listener is HTTP on explicit internal ports; preserve the expected Host header and keep those listeners private. Choose an RP ID compatible with both user and admin hosts before enrolling passkeys. Moving an enrolled installation to an unrelated RP ID is not a transparent configuration change.

Keep database files, authentication secrets, object-encryption keys and configuration outside source control and public document roots. Back up installation metadata, native authentication data and private object storage consistently. Retain every required decryption-key version. Optional services, email/push delivery, public client discovery, retention execution and support media require their own configured adapters and budgets; enabling a UI switch does not establish those capabilities.

The separate admin and user apps have their own manifests. An installation can keep public signup closed while serving its existing users. A private installation does not need the hosted billing extension, signup-country policy or Turnstile when its chosen admission policy does not require them.

Evidence: coordinator exercised this minimal configuration on separate loopback ports with a freshly provisioned temporary database: health, locked bootstrap status, enabled private-operator configuration and the actual setup HTML all returned 200; runtime and temporary files were then removed. The identity owner separately records the five-step browser enrollment result in private opt-in browser evidence, including a valid UV-absent rejection and explicit authority handoff. Full production restoration, public TLS configuration and operator deployment remain release gates.

### Optional service presentation extension

Core self-hosting needs no billing provider. Without an extension, the user account and relevant consent pages show configured core capacity and permissions; `provider` is `null` and no commercial offer is invented.

A constructor-owned provider extension may implement `describeAccountServices({request, owner})`. `owner` is frozen `{issuer, subject, sessionId}` from the native owner session. The hook must only read/project existing canonical rows: viewing a page must not create billing customers, bindings, reservations or policy accounts. Core checks the native owner/session again after awaited reads. Provider descriptions are advisory; core policy supplies all service authority.

The optional result is `null` or a strict JSON object (at most 4096 encoded bytes): `{version:1, ownerId, funding:{status,endsAt,renewal}, terms:{storage,signaling}, offer, manageUrl}`. Funding status is `none|trial|funded|expired|past_due|revoked|unknown`; `endsAt` is a finite nonnegative millisecond timestamp or `null`; renewal is `scheduled|canceled|unknown`. Terms are nullable text (240 bytes each); offer is `null` or `{summary,trialSummary}` with the same text limit and nullable trial summary. `manageUrl` is `null` or a same-origin URL without credentials, query or fragment. The bounded HTTP envelope (8192 bytes) includes core capacity, configured services, owner ID and observation time, and never includes session IDs. Invalid or unavailable presentation fails closed to optional-status-unavailable, without signing the owner out.

## Deployment recovery configuration shapes

These are illustrative JavaScript objects, not ready-to-run configuration. Use the exact browser fingerprint and current persisted governance revision described above. Do not expose these approvals through public APIs.

```js
// deploymentEnrollmentApproval
{mode: 'deployment-enrollment', generation: 1,
 fingerprint: 'p256-sha256:EXACT_BROWSER_FINGERPRINT',
 issuedAt: /* current epoch milliseconds */,
 expiresAt: /* at most one hour later */,
 expectedRevision: /* current persisted governance revision */}

// deploymentRecoveryApproval, separately approved after ordinary enrollment
{generation: 1, fingerprint: 'p256-sha256:EXACT_BROWSER_FINGERPRINT',
 issuedAt: /* current epoch milliseconds */,
 expiresAt: /* at most one hour later */,
 expectedRevision: /* current persisted governance revision */,
 authoritySubjects: ['actual-native-user-id'],
 reason: 'Operator-reviewed recovery'}
```

Generation namespaces are independent. Replacing an observed or consumed approval requires a newer generation. Remove approvals after completion. This changes policy authority on the existing installation; it does not reset bootstrap or restore deleted account data.

### Initial setup session safety

The approved browser continues proving possession of its local approval key for sensitive setup requests; the temporary cookie alone is insufficient. Keep using that browser until setup finishes. Clearing its local key requires a new deployment approval, rather than silently trusting the cookie. Fresh passkey verification is tied to the actual provider session. Signing out before the server accepts the authority handoff prevents completion; use **Restart authority verification**, sign in with the existing passkey and verify it again. A handoff already accepted by the server may finish after a later sign-out. Initial setup and the separate deployment recovery process have distinct trust rules; initial setup never resets an initialized installation.


## Optional identity capacity policies

Private self-hosted installations may omit the Native credential capacity profile. Waypo.link requires explicit `nativeCredentials`, `nativeRetainedLimits`, `nativeStorageCapacity` and enabled `sessionSecurity` policies. These are implementation controls, independent of an app's storage allowance and protocol grants.

`nativeRetainedLimits` selects finite installation and per-owner session/key counts. Expiring or retiring a session does not refund its physical row until garbage collection removes it. Selected limits enter the stored policy fingerprint; changing configuration cannot silently reset counters.

`nativeStorageCapacity` selects `maxBytes`, reserved `headroomBytes` and a bounded `retryMs`. The Node adapter conservatively measures allocated SQLite pages, including reusable free pages; deletion may require offline operator reclamation before the measured size falls. The Worker uses its native allocated-size getter. Publication above the ordinary threshold receives temporary capacity backoff, while bounded maintenance can use the reserve. This is not an exact limit on every database write. Keep the original databases and keys; do not reset the installation to reclaim quota.

From an existing valid session, an owner can review and freshly verify a selected session revocation without minting another ordinary session. That narrow management path does not supply login when every session is lost, grant applications additional access, or promise recovery after absolute storage exhaustion. Configured hosted email-backed management and first-passkey enrollment additionally require an issuer-bound budgeted transport and production-mode purpose-specific human verification. Local Node/Worker qualification uses synthetic external email/Siteverify only. Governed administrator reauthentication and lost-session recovery remain separate.
