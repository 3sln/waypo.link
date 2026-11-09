# Finite account admission

> Source-development reference: refreshed from open-source Waypo commit `ea5685a`. The hosted source pin now selects this reviewed revision for local pair qualification; production remains disabled. These controls are not a claim about the currently deployed service, a completed security audit, or production qualification.


Account admission is an optional provider implementation policy, separate from OIDC, app registration, and storage entitlements. Waypo.link's free composition requires it explicitly. Private self-hosters may omit it, or choose their own finite limits. There is no automatically selected financially safe account count.

## Operator configuration

A provider can configure:

```json
{
  "accountAdmission": {
    "revision": 1,
    "maxPublicAccounts": 1,
    "maxProtectedAccounts": 48,
    "acceptingNewAccounts": false
  }
}
```

This is a locked example, not a launch-capacity recommendation. `maxPublicAccounts` must be an integer from 1 through 100,000; `maxProtectedAccounts` is 1 through 48. The latter matches the bounded governance-principal engineering capacity. Operators must select public capacity using their storage/work budgets and change the revision whenever a limit or stop setting changes. A maximum count is not a substitute for per-account, per-app and fleet work/byte/concurrency budgets.

The free hosted settings carry this object as `accountAdmission`; the hosted constructor overrides any provider-input value with its validated deployment setting. It cannot be selected in a user or app request. Worker operators update deployment configuration; this work does not provide an administrative budget-editing page or a live vendor-spend feed.

## What is counted

Each real native user occupies exactly one retained allocation, classified as public or protected. Inactivity, archiving, a storage-plan change, signing out, or an expired session does not release that allocation. Physical native user deletion commits the refund in the same transaction. This intentionally conservative count can exceed the number of recently active users; it avoids admission depending on user tracking, background app traffic, or an eventual policy projection. A paid-to-free transition is not a new user creation and therefore needs no new slot.

Ordinary email-created accounts and public passkey accounts use public capacity. An internally verified operator-enrollment receipt can use the separate protected reserve for initial setup or deployment-controlled recovery. A request saying `mode: operator`, a bootstrap cookie alone, or an administrator grant is not sufficient to select that reserve. Existing-account sign-in, export, revocation and recovery of existing credentials do not allocate new users.

## Atomic flow

1. Native user creation opens or joins the actual maintained database transaction.
2. Admission reads the durable policy and counts; it refuses a new public account when stopped or full.
3. The transaction reserves one count, inserts the native user, and commits its allocation together.
4. An insertion failure, failed allocation write, or outer rollback undoes all three changes.

No row is created for an anonymous attempt that never creates a native user. The request path performs no global user scan. The same wrapper applies below the native user hooks, so the trusted passkey-enrollment hook cannot accidentally bypass the public capacity check. Ordinary native reads and session continuation are not gated by the new-account stop.

A refused email approval returns `503 signup_temporarily_unavailable` with `Retry-After: 600` and a message distinguishing new-account admission from existing sign-in. The original one-use login flow is not promised reusable: apps and people should start a fresh sign-in when appropriate, rather than blindly replaying a consumed link.

## Restart, policy changes and existing installations

Official schema migrations create two private native tables. Startup activation seeds existing users in pages of at most 128, conservatively assigning existing identities to public capacity. Each completed page commits its cursor and counts. Until the final page is complete the new runtime refuses to serve; restarting it continues the next page. A large installation should perform this planned maintenance with public registration closed and older writers stopped. Never delete the ledger or reset the database to bypass this process.

After activation, lowering the cap does not evict users or reset consumed capacity. New public accounts remain refused until the retained count fits. A higher policy revision updates limits without resetting counts; stale runtime instances cannot overwrite a newer durable policy or use their old policy for new user creation. Existing session reads continue independently. Policy revisions must be advanced rather than editing limits under an already observed revision.

Malformed state, missing allocations, mismatched policy and incomplete native deletion fail closed. Native mass deletion is limited to at most 16 users per transaction. Arbitrary operator SQL writes outside the maintained provider adapter are not a supported account-creation or cleanup mechanism; those writers must be stopped during migration.

## Evidence and limits

Meaningful tests exercise real maintained BetterAuth SQLite transactions: concurrent final-slot requests, nested rollback, allocation-write failure, native deletion and rollback, policy decrease/stale constructors, corrupt state and resumable migration. A durable Node email flow checks the capacity response, restart and existing-account sign-in during a new-account stop. The hosted native Worker fixture verifies allocation persistence across restart.

This allocator is one release control. It does not claim to enforce cumulative dollar spend, all native credential counts, every support/push/account-shell operation, dynamic actor sharding, or a production Cloudflare rollout. Those remain independently reviewed release gates.

## Separate creation-rate policy

Retained capacity and global creation speed are independent. The free hosted mode also requires an explicit prepaid [account-creation rate policy](account-creation-rate.md). Its rate units are staged before native verification and are not refunded by the native allocation transaction. Existing sign-in never needs a new-account unit.
