# Global account-creation rate blocks

> Source-development reference: refreshed from open-source Waypo commit `f916cac`. The hosted source pin now selects this reviewed revision for local pair qualification; production remains disabled. These controls are not a claim about the currently deployed service, a completed security audit, or production qualification.


This optional provider implementation policy regulates how quickly new identities can be attempted. It is separate from the retained-account capacity cap, each account's storage allowance, and ordinary login rate protection. Waypo.link's free mode requires all three relevant account settings explicitly: `accountAdmission`, `accountCreationRate`, and the free storage allowance. Self-hosters choose their own policy.

The durable authority is installation-wide. Cloudflare's per-location rate-limit binding is not substituted for that authority. In the current Node implementation the authority uses the installation's durable metadata database; the current Worker uses its installation control actor. A constructor-owned reserve port can move block issuance to a dedicated control actor without moving it into a native identity transaction.

## A locked configuration example

```json
{
  "accountAdmission": {
    "revision": 1,
    "maxPublicAccounts": 1,
    "maxProtectedAccounts": 48,
    "acceptingNewAccounts": false
  },
  "accountCreationRate": {
    "revision": 1,
    "global": {"capacity": 4, "refillPerMinute": 1},
    "public": {"capacity": 2, "refillPerMinute": 1},
    "protected": {"capacity": 2, "refillPerMinute": 1},
    "protectedReserveUnits": 2,
    "blockSize": 1,
    "blockMs": 60000,
    "maxWorkers": 4,
    "protectedWorkerSlots": 1
  }
}
```

These are deliberately small values for a closed example, not an affordable production recommendation. The operator selects the retained count, creation burst, sustained rate and storage/work budgets together. Bucket capacity and integer refill-per-minute values must be finite and positive. A block contains at most 16 units and lasts at most 60 seconds. There are at most 256 private runtime-boot identities and 512 live pool leases in the authority. Server-generated lease/boot/request IDs are bounded to 64 characters, and the retained ledger is capped at 220 KiB; transport identity is not repeated in every stored lease. Public workers cannot occupy the separately reserved protected-worker slots.

Change the rate policy's revision whenever its values change. Increasing a capacity or revision does not refill already consumed balance. The authority first accrues elapsed refill under the old policy, then clamps remaining balance to the new capacity. A policy change that refuses the current request still commits the new policy. A stale minter cannot restore an older durable policy. The public account-admission stop is separate: it refuses new public creation while existing sign-in and deployment-approved recovery remain available.

## Flow between the control authority and a creation worker

1. A verified email approval that would create a new native user, or a trusted passkey-enrollment receipt, reaches the provider. An already existing identity does not need a new-account credit.
2. Before entering the native verifier/creation transaction, the runtime obtains a small prepaid block when its local cache needs one. The authority atomically debits the global bucket and the selected public/protected bucket before issuing it.
3. The runtime spends units locally and stages private single-use tickets bound to the exact pending user ID or email. Request bodies cannot select the worker identity, reserve pool, ticket or policy.
4. The native user-allocation wrapper checks the branded ticket after its actual SQL transaction queue wait, and checks expiry again after the native user/allocation writes. The existing retained-capacity reservation, user and allocation remain one native transaction.
5. Success consumes an admitted unit. Failed verification, a race that finds an existing account, a later native rollback, a lost response or an abandoned attempt may also burn an admitted unit. None refunds the global rate wallet.

The budget therefore counts **admitted creation attempts**, not a promise to bill or count only successful accounts. Each block is shared across a runtime's requests, not allocated per user or app. The global ledger stores bounded private runtime-boot identifiers and leases; it does not create a durable nonce/receipt for each anonymous caller or store account email, raw IP, country or user activity.

Protected credits require the existing internally verified deployment-enrollment receipt. They debit their own small pool **and the same absolute global bucket**. Public issuance cannot consume the protected global floor or all protected worker slots. A user supplying `mode: operator` or a fake receipt does not acquire that authority.

## No refill from uncertain state

A runtime cache is private, volatile and prepaid. Eviction, process restart, hibernation, expiry and explicit clearing burn unused credits. A new boot cannot import an old block. A lost mint response leaves the durable debit intact. Duplicate mint replies cannot replenish a cache that already accepted or consumed the block.

Each boot has only one live block per pool. A block cannot be replaced while its staged tickets still wait to enter native creation. Native admission or explicit terminal request discard retires those tickets without refunding them. The exhausted prior block ID only acknowledges already charged work; it is not a refund or a new grant. Lease expiry removes an old worker slot but does not return its units.

Block RPCs have a deadline of at most 10 seconds, limited further by the selected block lifetime. A timed-out call can still complete and charge the wallet; its result is never imported later. At most one unresolved call per pool is retained even after cache clearing, and the local waiting queue is bounded. There is no admit-on-error fallback. Staging from inside a maintained native transaction is explicitly refused before any control call, avoiding Native-held-to-control/KV deadlock.

## How much slack is possible?

This is an economical operational guard, not an exact synchronized account counter. A conservative steady-policy burst envelope is the global bucket burst plus the refill that can be issued over one maximum lease lifetime, plus bounded already-admitted native work. A window of duration T must also account for refill over T. Do not claim that only a single block of slack exists.

Across a policy change, still-valid prepaid units from the previous policy may remain until their original expiry. Held/staged block slack is bounded by twice the previous maximum worker count times its block size, with already-admitted native work accounted separately. Tickets cannot extend a lease, and expiry is rechecked inside native creation. Keep request concurrency, native deadlines and deployment-generation adoption bounded as separate controls.

## Failure and release behavior

Temporary rate exhaustion returns429; unavailable or uncertain control state returns503. Both provide a finite `Retry-After` and a message explaining that existing accounts can still sign in. Account creation/passkey/email actions are not automatically replayed: a consumed one-use approval may require a fresh flow.

The Node and Worker compositions use real durable ports. Configured Node rate controls require Node 22.16 or later (Node 24 recommended); startup checks real SQLite transaction introspection rather than treating a missing property on older Node as an idle connection. Private deployments without these controls retain their existing Node baseline. Tests cover multi-runtime/global races, protected floors and slots, cached parallel consumption, expiry/cache loss/restart/lost responses, policy changes, hung control calls, failed durable commits, native queue expiry and rollback, actual Node existing-login bypass, and native Worker persistence. The private bootstrap browser profile can enable the rate policy alongside the retained-account cap.

This does not cap already-billed inbound Worker invocations, all CPU, email, push, storage, support processing or data-plane operations. Public launch still needs ingress/WAF controls, configured CPU limits, independent account/app/fleet work and byte budgets, operator spend alarms and an emergency route/admission shutdown procedure. No production deployment or public Cloudflare qualification follows from these local checks.
