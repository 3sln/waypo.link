# Current hosted prerelease fixture reconciliation

Source audit of staged hosted a8656d2 against core b4e803d, 19 November 2026.
This is an identified qualification gap, not a newly executed failing E2E result.
The paired engine suite passed83/83; that result does not qualify these separate
actual-adapter prerelease tests. Production and optional paid/analytics activation
remain disabled.

## Concrete stale scenarios

- `hosted/waypo/tests/account-data.worker.test.mjs` still enables `sync:true`,
  requests `sync:read sync:write`, creates `/api/services/documents/hosted`
  and asserts historical account data ownership. Its fixture must instead prove
  actual current independent logs/blobs, current Native/OIDC authorization,
  control/account placement, composed free entitlement, persistence and restart.
  Removing its obsolete assertions without replacing those outcomes is insufficient.
- `hosted/waypo/tests/free-hosted-worker.test.mjs` still enables `sync:true`.
  Preserve its real login, separate public/admin assets, no-Polar/default-off,
  account-rate admission and restart outcomes while selecting the current profile.
- Several actual-adapter tests and fixtures import dependencies, source or built
  assets through `../../../../waypo/...`. In an isolated review checkout this
  can bypass the selected `@3sln/waypo` dependency and silently exercise adjacent
  main instead. Resolve selected-core source/tools/assets explicitly and record
  the resulting exact version. Do not report a dependency pin that the test did
  not actually execute.

## Verification boundary

Reconcile maintained fixtures in an isolated checkout, preserve private synthetic
mail and real credential/OIDC verification, and run exact current Node/Worker
prerelease cases serially with owned-process cleanup. Intentional legacy rejection
tests in engine suites must remain negative tests, not be mechanically rewritten.
No production profile, admission limit or financial budget may be weakened merely
to make an obsolete fixture pass. Current core multi-provider browser passes are
valuable but do not substitute for the hosted composition boundary.

The account/runtime agent owns this followup after freezing the new-profile free
retention composition proof; paid capacity reservation is queued after this free
launch qualification work.

## Current positive free proofs reconciled

See [current hosted free qualification](current-hosted-free-qualification-20261120.md): the current account-data/free Worker cases and free Node case now pass with selected-core provenance and real log/blob operations. The exact old zero-control-work assertion was replaced with actual shared admission accounting; data catalogs remain on account actors. Node's separate notice-only startup guard correction is qualified without enabling destructive retention execution. Remaining optional actual-adapter path references are still open and are not covered by this closure.
