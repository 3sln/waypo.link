# Optional 3sln hosted billing research

Checked 2026-11-02. This package is isolated from the portable Waypo provider and
is not connected to a production checkout or billing account.

The maintained official `@polar-sh/sdk` is 1.0.2, MIT, Node >=22 (npm metadata and
installed package). It lives in [polar/sdk/typescript](https://github.com/polarsource/polar/tree/main/sdk/typescript);
the older `polar-js` repository is archived. Pin the SDK and explicit API module
`@polar-sh/sdk/2026-10`; `createPolar({environment:'sandbox',timeout:5,...})` is the
sandbox client. Production is the SDK default, so the composition must choose
sandbox explicitly unless an operator deliberately enables production actions.

[Official pricing](https://polar.sh/resources/pricing) currently lists Starter at
5% + $0.50 per transaction, with +1.5% for international cards and separate payout
fees. Grandfathered organizations created before 2026-05-27 retain 4% + $0.40 and
+0.5% subscriptions while staying on that plan. A $10 annual US-card sale on
Starter therefore leaves $9 before payout charges; international cards leave
$8.85 before payout charges, assuming a $10 total charge. Taxes and other fees
can alter this arithmetic. Do not assume an operator qualifies for the old rate.

[Webhook documentation](https://polar.sh/docs/integrate/webhooks/endpoints)
explains Standard Webhooks for secrets generated since 2026-09-08 and legacy
Polar HMAC for older secrets. The maintained SDK verifies both, enforces a
five-minute timestamp tolerance, and checks supported event type. Installed
source confirms it does **not** runtime-validate the full event data schema.
Bound the raw body before validation, validate projected fields explicitly,
lookup only a previously bound external customer, then retrieve canonical state
through the authenticated SDK. Never grant storage from checkout return queries,
unverified JSON, email equality or a browser-provided customer/product ID.

The commercial candidate remains $10/year, 10 GB logical private objects, zero
automatic overage charges. A delegated provisional trial candidate is 30 days/
1 GB, disabled until an operator enables it. Neither the portable core nor this
research creates an entitlement merely because a trial or price is described.
Notification work is a separate bounded free allowance; paid storage and signaling
must not gate mandatory security contact, check-in, export or appeal.

Implementation contract under review: authenticated owner checkout/portal action
ports; stable installation+subject external customer binding; signed webhook
admission; bounded per-account canonical reconciliation with durable pending
idempotent policy projection; actual completed paid-period evidence rather than
future annual tenure; retention cancellation through a stable subscription ID and
`cancel_at_period_end:true` (never immediate revocation of already funded time).
Metering should aggregate provider-side byte/work counters into bounded buckets
and durable idempotent events, not emit a billing event for every keystroke.
Sandbox fixtures can prove signed payload handling and maintained SDK request
shapes without creating a real purchase. No production charges have occurred.

## Shared capacity and heavy-use sensitivity

[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
uses a $5/month shared subscription, not $5 per identity: allocate $60/N yearly
across N paying accounts. Included request/CPU allowances are shared too. Model
marginal requests at $0.30/million and CPU at $0.02/million ms after those
allowances, rather than granting each account another free tier.

[R2 Standard](https://developers.cloudflare.com/r2/pricing/) lists $0.015/GB-month,
$4.50/million Class A and $0.36/million Class B requests; Internet egress is free.
A continuously full 10 GB account therefore costs $1.80/year for live object
storage before operation, encryption overhead, retained history and backup
costs. Server AEAD does not duplicate snapshots. A 30-day 1 GB trial costs $0.015
for its live object storage before operations/abuse/contact costs, and does not
justify unlimited repeat trials.

[DO SQLite pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
lists marginal $1/million rows written, $0.001/million read and $0.20/GB-month SQL
storage after shared allowances; deletes and setAlarm also count as writes. The
bounded journal reduces object PUTs, but does not eliminate SQL/account-index/
policy/alarm writes. Retaining 10 GB in SQL instead of R2 would be $24/year on
storage alone, so active journal retention must stay bounded.

`economics.mjs` makes these inputs explicit. At 1,000 payers the shared base
allocation is $0.06/year each. A full 10 GB account leaves $7.14 of a $10 US-card
sale after Starter processing, live R2 storage and this base allocation, before
all remaining costs. This is not profit. An illustrative 240,000 acknowledged
patches/year at an **assumed**, unmeasured ten SQL rows written per patch costs
$2.40 marginal SQL writes. At 2.4 million patches/year it is $24: the price fails
even before object/compute/contact/support costs. The number of actual billed
rows per ACK, checkpoint, replay, policy update and alarm must be measured on the
deployed adapter. Normal editing cannot be made viable merely by naming an
arbitrary low commercial message quota; batching, transaction/index efficiency,
measured fair resource ceilings and the retained-history policy need validation.

Current Worker architecture has one installation DO for all users, not per-user
service DOs. Object quota does not imply measured account concurrency/throughput.
No live capacity, CPU, DO duration, contact delivery, restore/backup, incident or
support cost has been measured; these remain explicit additional model inputs.

### Provisional annual overage candidate

The evaluated candidate is $0.05 per **decimal** GB-month, settled once alongside
the annual base subscription, with a separate annual monetary cap defaulting to
zero. This is neither owner approval nor enabled billing. Event-based byte-time
counts storage above the included allowance; the planning model defines a month
as one twelfth of that funded annual term. Exact byte-time is materially fairer
than rounding each live excess to whole GB: 0.1 GB excess for half a year costs
$0.03 exact, versus $0.30 when each interval rounds upward to one GB. Final cents
would be rounded upward once at annual settlement, not once per usage event.
Real billing must use integer/rational accounting rather than the floating-point
planning estimator.

A write pause alone does not protect the operator after the cap is consumed:
existing excess keeps costing storage. The candidate reservation model therefore
checks accrued cost **plus worst-case storage liability for all live excess and
reserved bytes through the remaining funded term** before accepting extra bytes.
At $0.05, 10 extra GB for an entire annual term reserves $6. This check must be in
the actual catalog/reservation transaction and account for concurrent uploads;
the standalone estimator is not that integration.

Two renewal/cancellation alternatives remain for explicit owner review:

1. Reserve excess capacity through the funded term, with a reduced cap effective
   next term. Users can always cancel future renewal. The operator must define
   consent, settlement and nonpayment handling; this cannot silently impose an
   irrevocable future-charge commitment.
2. Permit a finite excess-only cleanup window when funding/cap commitments end,
   preserving funded baseline data and identity/sign-in/export. The exact excess
   selection, notice, export and deletion contract needs review before enabling.

The maintained Polar schema supports annual recurring products with fixed and
metered prices, and a meter interval following the billing interval plus a cap
amount. No actual annual sandbox invoice, customer cap-change flow or renewal
settlement has been verified here. Overages therefore remain disabled. No small
monthly invoice is created merely to settle a few cents.
