# Deployment-authorized Worker recovery inspection

> **Status:** Development documentation. Production release remains disabled.

The reference Worker exports `WaypoInstallation.inspectRecoveryStateFromOperator()` as a deployment RPC. The production HTTP router does not expose it. It reads only installation status/id, governance revision, and the observed/consumed generations of the two deployment recovery engines. It returns no identities, sessions, approval material, browser keys or enrollment lease. Reads do not initialize governance, provision an installation, reset setup or change a generation.

An operator with Cloudflare deployment access can compose a short-lived inspection Worker using `tools/worker-recovery-inspect.mjs`. The target must already run a version with this RPC and export the reference `WaypoInstallation` class. The operator obtains the account id, deployed Worker name and installation id from their deployment configuration; no administrator login is required.

Prepare without cloud writes:

```sh
node tools/worker-recovery-inspect.mjs --account ACCOUNT_ID --worker WORKER_NAME --installation INSTALLATION_ID
```

Review the private generated configuration. It binds the existing namespace in the named Worker; it implements no Durable Object namespace and has no R2/storage binding. The default is `workers_dev:false`, no routes and no previews. `--execute` is a separate deliberate operator action: it rejects an existing temporary name, stages the helper closed, installs a random token through secret stdin, activates a fixed authenticated `/inspect` for at most five minutes, reads the bounded projection, and force-deletes and verifies absence of that helper in `finally`. The token is never printed or put in a URL. SIGINT/SIGTERM stops further publication and allows admitted CLI work and cleanup to finish. An unconfirmed deletion is an error identifying the temporary helper for operator follow-up.

```sh
node tools/worker-recovery-inspect.mjs --account ACCOUNT_ID --worker WORKER_NAME --installation INSTALLATION_ID --execute
```

This maintenance helper is internet-routable and authenticated, not network-private. It rejects missing/wrong credentials, browser-origin requests, alternate paths/query strings and an absent/expired/overlong absolute deadline before touching the installation. Deleting this helper removes only its code: the existing installation namespace is externally bound and must remain intact. The operator can then choose a fresh deployment generation greater than both reported observed and consumed values and bind their separately configured recovery approval to the exact reported governance revision.

Evidence: primary projection/authentication/CLI simulations, actual cross-Worker native workerd RPC and SQLite restart, and actual Wrangler build dry-run pass. The remote CLI deployment lifecycle has not yet been exercised; no public maintenance helper or production resource was created for this evidence. Production release remains disabled.
