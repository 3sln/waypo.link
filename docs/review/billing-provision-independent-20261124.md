# Independent offline billing provisioning review

Reviewed hosted `2413671` paired with private core `d7f1244` on 24 November
2026. The coordinator independently ran all five provisioning tests in a
separate worktree: **5/5 passed**, no skips or cancellations, 1.948 seconds.

The operator tool holds the shared canonical installation operation lease,
rejects quarantine and uninitialized installations, and checks stopped SQLite
sidecars before both read-only inspection and mutable opening. Genuine hot
rollback and committed uncheckpointed WAL fixtures refuse without changing the
main database or sidecars. An uncertain inspection close retains the lease
through garbage collection until process exit. A live Node provider excludes
the tool until confirmed shutdown.

This is offline provisioning qualification, not paid-capacity or merchant
activation evidence. The core helper/export dependencies must be integrated
with this change; the hosted core pin and complete engine gates must be updated
before promotion. Billing and production remain disabled.
