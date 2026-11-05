# Private installation evaluation

> **Status:** Development documentation. Production release remains disabled.

Waypo is incomplete and production release is disabled. This guide describes the implemented Node installation boundary, not approval to expose it publicly. No Waypo.link, Polar or Cloudflare account is required. Use the [implementation map](plan.md) for verification status and [durable adapter guide](durable-adapters.md) for persistence and recovery constraints.

## Local installation

Use Node 24 for the currently tested reference installation, then run `npm ci` and `npm test` in the repository. Install scripts apply the pinned, reviewed OAuth patch; do not skip them. Create a private configuration without printing its secret:

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

## Temporary setup and authority

Open `http://localhost:9512` in a passkey-capable browser and select **Show browser fingerprint**. The browser creates a local approval key and displays its fingerprint. Opening the page confers no access. Copy that fingerprint into a deployment-controlled `approval` object in the private configuration:

```json
{
  "generation": 1,
  "fingerprint": "p256-sha256:THE_EXACT_DISPLAYED_FINGERPRINT_SUFFIX",
  "issuedAt": 0,
  "expiresAt": 0
}
```

Use current Unix milliseconds for `issuedAt`, and a short future deadline for `expiresAt` (the browser E2E uses thirty minutes). Restart the runtime, return to the original browser and open the temporary bootstrap login. The displayed fingerprint must be copied exactly, including its prefix; the illustrative suffix above is not a valid approval.

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

The two private configuration shapes are shown below; replace every illustrative field with the actual current installation values. Approval generations are durable and independent; use a newer generation when replacing an observed or consumed approval. If an ordinary identity is still usable, skip enrollment and perform only the separate authority approval. Each browser/UV recovery flow expires within two minutes and never extends the operator approval deadline. Signing out before native command acceptance denies the operation; signing out after acceptance does not undo that exact accepted command. Current account, policy, approval and deadline restrictions still apply.

Excluded former policy-authority roles are disabled. Pending governance/staff/account invitations, operations and personal opaque credentials are cancelled. Installation-owned service principals and their credentials survive. Recovery does not erase/restore ordinary app data, move billing or silently transfer identity. Remove both deployment approvals after completion.

For Worker operators, the browser/runtime behavior is proven locally. The [operator inspection guide](operator-inspection.md) describes the separate bounded, authenticated maintenance helper for reading governance revision and approval generations. Its presence does not establish production deployment approval or remote verification. Do not expose a permanent public inspection route or copy a fixture-only RPC into production.

## Deployment responsibilities

Outside loopback, use HTTPS and exact configured identity/admin URLs behind a reverse proxy. The Node listener is HTTP on explicit internal ports; preserve the expected Host header and keep those listeners private. Choose an RP ID compatible with both user and admin hosts before enrolling passkeys. Moving an enrolled installation to an unrelated RP ID is not a transparent configuration change.

Keep database files, authentication secrets, object-encryption keys and configuration outside source control and public document roots. Back up installation metadata, native authentication data and private object storage consistently. Retain every required decryption-key version. Optional services, email/push delivery, public client discovery, retention execution and support media require their own configured adapters and budgets; enabling a UI switch does not establish those capabilities.

The separate admin and user apps have their own manifests. An installation can keep public signup closed while serving its existing users. A private installation does not need the hosted billing extension, signup-country policy or Turnstile when its chosen admission policy does not require them.


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


## Guarded email initiation

Email admission is an optional deployment capability for private OSS installations, not an OIDC registration requirement. With `emailHuman.required:true`, the public email form requests a short-lived stateless admission ticket, completes the isolated check, then submits the ticket and proof before any account lookup or email-flow creation. Configure the explicit admission limits (`ttlMs`, `maxPending`, `maxPerRecipient`, `maxPerBrowser`, `verifyLeaseMs`) and a purpose-bound verifier; there is no separate core GC cadence setting. Exact stored expiries drive durable cleanup.

The challenge must use a different configured hostname. Its cookie-free shell has an exact trusted main or admin parent binding; it receives only public widget configuration and an operation nonce, never the recipient address, ticket or identity cookie. Tickets/proofs stay in parent memory and are discarded on edits, restart, expiry, reload or account changes. Missing required readiness fails closed. A successful start is an opaque receipt: it does not establish account existence or promise delivery. Check the inbox only if that address can receive sign-in mail.

Local Node and native Worker UI gates use an explicitly synthetic isolated widget and mocked strict Siteverify transport, alongside real email-approval and signed-passkey flows. They establish binding, privacy and runtime behavior, not real vendor human detection or live delivery. Other trusted verifier transports can be composed without requiring a Cloudflare account; do not treat a request-supplied success boolean as verification.

Waypo.link additionally requires shared native email-send admission for its hosted native binding. That service policy is distinct from portable human admission and does not impose commercial quotas or prices on self-hosted providers. See [hosted email](hosted-email.md). This isolated hosted candidate pins core revision `2c842d48683beaa1879f41eefb58dd32d485c154`; the child passed clean core CI and was merged in `ed854b3`. Local hosted primary and runtime checks passed against the exact pin; final private paired CI remains a pre-merge gate.
