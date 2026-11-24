# SDK provider retry deadlines

> Source-development guidance. The historical scheduling evidence below comes from core `21ecbc3`; it does not qualify the current hosted source pair. Production/public operation remains disabled.

## Current log and blob clients

The hosted storage primitives are independent logs and blobs. Low-level calls do not promise automatic replay of every failed operation. For finite log operations, `appendWithRetry` and `readWithRetry` provide bounded, provider-directed recovery; the current defaults allow two retries within 20 seconds. An append keeps the same operation ID, captured bytes and expected-head precondition. A provider's longer retry floor must not be shortened to fit that window. When recovery cannot safely finish, the caller receives a failure; these helpers are not a persistent offline outbox.

Low-level blob writes expose retry information but do not automatically repeat an uncertain PUT or DELETE. Reconcile the current version before deciding what to do next. The resumable native-transfer upload helper has a separate reconciliation contract. A lost connection is not proof that a write failed, and choosing a new operation ID or dropping a precondition can turn a retry into a different operation.

A typed, explicitly hinted refusal at the service-admission boundary occurs before the resource operation runs. That differs from an ambiguous network outcome or an arbitrary backend 503. Tests and applications that use raw HTTP must preserve this distinction rather than repeat all failed writes. Temporary pressure does not invalidate the user's identity or justify discarding application-owned state.

## Historical scheduling and compatibility evidence

The document and subscription clients discussed below are retained implementation references. They are not the current hosted log/blob capabilities and must not be inferred from current discovery metadata.

A provider's daily/monthly work refusal can require up to 31 days of backoff. That network deadline is distinct from a local timer interval. SDK/sample adapters retain the absolute deadline, schedule local wakeups no longer than seven days, and check the deadline again before making a provider request. A timer wakeup, focus/reconnect, online event or local edit does not confer fresh provider authority or bypass the stored floor.

The document SDK persists `retryAfterAt` in its existing namespace/document row. Reopening the same durable store preserves the deadline and pending edits. Its `nextPollMs` is a bounded local wakeup interval, not permission to contact the provider early. Edits remain local and exportable while limited; a 429 does not invalidate the account or erase its outbox. Previously in-flight and newer deltas may require separate acknowledged synchronization passes once the deadline expires.

Subscription channels retain the full ticket-mint deadline for their lifetime. Their local timers use the shorter bound and reconnect rechecks the floor. The channel has no durable KV port: recreating it may perform an initial new ticket request; no cross-reload persistence is claimed. Rendezvous retains the deadline in its immutable client instance and returns a local `rendezvous_backoff` when the floor exceeds the bounded operation timeout. A small remaining wait may complete locally before a request at or after the floor. Neither path revokes an account on temporary 429/503 pressure.

The shared parser accepts standard Retry-After seconds/date and bounded JSON retry milliseconds, conservatively selecting the longer valid value up to the implementation's 31-day supported range. Unknown/malformed hints do not create unbounded state. Long hints never become a single oversized `setTimeout`. Sample resource parsing, adaptive polling, identity rechecks and signaling queues use the same distinction; stale signaling payloads still expire under their normal short queue policy, while newly queued operations respect the retained provider floor.

These are client scheduling/compatibility rules, not protocol authentication, pricing or billing decisions. Clients cannot enforce server budgets; server admission still validates authority and charges independently. Device clock changes or caller recreation of ephemeral clients cannot grant new server permissions. The root provider's period wallet, rate limits and resource caps remain authoritative.

Fake-clock/timer tests cover actual monthly wallet 429 through HTTP response parsing, durable document reopen/outbox convergence, subscription timer chunks and reconnect, rendezvous operation deadlines, sample polling/identity checks, stale signaling expiry and temporary token-response projection. No real month-long wait or production request is used.
