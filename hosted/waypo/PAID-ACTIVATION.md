# Dormant paid plans and subscription servicing

Paid features are implemented as optional hosted policy and Polar adapters. They
remain **off by default**. Credentials, product IDs and environment selection do
not enable them. These controls are operator configuration, never request input.

| Controls | Result |
| --- | --- |
| Both omitted/false | Free 500,000,000-byte shared storage floor; free guarded signaling. No billing UI, webhook, customer projection, SDK client or vendor dispatch selected by hosted composition. |
| `subscriptionServicingEnabled:true` | Existing canonically bound subscriptions can be inspected, reconciled and cancelled. No customer enrollment, trial, checkout or portal. |
| `paidPlansEnabled:true` | Paid plan definitions available; `enableActions:true` additionally permits new checkout/portal. `enableTrial:true` additionally permits the explicit trial offer. |

`enableActions` or `enableTrial` without `paidPlansEnabled` is invalid. Disabling
new offers should retain explicitly enabled subscription servicing while any
subscriptions remain: cancellation is an obligation, not an upsell gate. An
operator must not simply turn both controls off with renewal obligations left.

The annual $10/10 GB preset is dormant commercial direction, not published terms
or a profitability claim. Overages remain disabled. Paid capacity cannot bypass
logical reservations, work budgets, physical storage capacity or admission caps.
Expired/revoked paid capacity returns to the free floor; existing excess data
must not be treated as newly funded storage. Free signaling stays independent.

## Verified authority

Raw signed Polar webhooks trigger bounded canonical customer-state reads; their
payload alone never grants capacity. State binds exact configured organization,
product, external customer and (in servicing mode) previously bound subscription
ID. Reconciliation epochs reject old in-flight results and receipts suppress
known repeats; old evicted receipts cause a fresh canonical read, not reuse of
an old entitlement. Checkout return URLs confer no authority.

Only an authorized purchase creates a customer binding. Status and free-account
usage create no financial rows. Unbound servicing refreshes/webhooks cannot enroll
customers. Servicing-only portal access is refused because an unrestricted
vendor portal could permit purchases. A failed/uncertain cancellation is never
recorded as confirmed. Owner authority is rechecked after external waits.

## Economic guards

`billingLimits` accepts finite positive integer fields (maximum 1,000,000):

| Field | Default |
| --- | ---: |
| checkout | 256 vendor attempts/day |
| portal | 512/day |
| refresh | 4,096 admitted refreshes/day |
| cancel | 2,048 vendor attempts/day |
| reconcile | 10,000 vendor attempts/day |
| maxBindings | 4,096 retained financial bindings |

These are provisional reference safety limits, not spend estimates. Each actual
vendor operation is prepaid durably before I/O, including canonical order reads
and both cancellation GET/update calls. A user refresh also spends reconciliation
capacity. Existing per-account action limits and reconciliation 60/minute limit
remain. Cancellation has an independent daily lane; purchase/refresh traffic
cannot spend it. Counter high-water time prevents clock rollback reopening a day.
Tightening/raising limits does not erase prior use. Unknown external effects have
no automatic refunds or retries. A user may deliberately retry within remaining
budget, so an uncertain checkout can leave another external checkout session;
no claim of exactly-once vendor checkout creation is made.

Counters are installation-wide **only if backed by the same transactional store**.
Multiple deployments sharing a Polar organization/wallet must share that budget
namespace; independent stores do not enforce a shared fleet cap. Immutable
issuer/environment/organization anchors reject rebinding; losing one half of an
anchored counter fails closed. Fixed row stock avoids caller-controlled budget
indexes. UTC windows can burst across a boundary. These caps do not measure or
limit Polar's own payment processing charges automatically.

Binding stock is retained until a separately qualified financial retention/purge
policy exists. It has no TTL-based refund and is not silently reset by config
revision. Existing installations with older uncounted financial rows require an
explicit migration before allowing new purchases; do not initialize an empty
counter over an old populated catalog. At capacity, refuse new purchases while
existing servicing remains available. Account deletion is not permission to
erase payment evidence.

Budget exhaustion never implies successful cancellation. The HTTP response gives
an explicit unconfirmed status, retry delay and manual staff/payment-provider
recovery route via the payment receipt. Operators must monitor reserved servicing
capacity and act on failed cancellation attempts before renewal.

## Still required before activation

Full merged engine gate and maintained Node/Worker/browser qualification; actual
Polar sandbox reconciliation/checkout/cancellation and signed webhook delivery;
final product/price/trial/terms and profitability approval; safe old-ledger stock
migration where relevant; shared budget topology; financial record retention;
and alerting/manual cancellation procedure. No production vendor calls occurred
for these tests. Restorable log-aware encrypted account archive/restore remains
disabled until independently qualified; paid inactivity archival must not activate
using the older catalog-only adapter. Log cold archival and owner export are
separate facilities and do not satisfy that requirement.
