# Annual base and optional metered storage: decision packet

2026-11-04. Proposal for later owner signoff, not published pricing or deployment authorization. The user prefers **$10/year including 10 GB, with optional metered excess storage**. Keep that primary direction; do not replace it with capacity tiers. The excess rate, ceilings, trial, rounding and collection terms below remain unapproved. This file sits beside [RESEARCH.md](RESEARCH.md), outside the public documentation/site generator.

## Current implementation boundary

The hosted package has durable paid-period/usage projections and a disabled `overage-candidate.mjs` estimator. Its illustrative rate is $0.05 per excess decimal GB-month; `enabled:false` and `annualCapUsd:0` mean it does not bill or grant extra capacity. It compares exact byte-time and rounded-up whole-GB time, then rounds the estimated settlement upward to cents. Those are candidate calculations, not approved invoice semantics or a production billing engine. No proposed product, price, meter, checkout or overage configuration was activated for this packet.

Installed `@polar-sh/sdk@1.0.2` exposes metering and subscription APIs. Type/export inspection is not evidence that annual byte-time conversion, final invoices or failure handling work remotely. Sandbox integration and reconciliation remain required.

## Proposed user flow

1. Identity remains independent of a storage purchase. Show the $10 annual base and 10 GB capacity clearly before checkout; activate funded capacity only after verified canonical paid state, never a return-URL flag.
2. Overage is off initially. Near capacity, explain the exact metering unit and ask the owner to opt in with both an extra-byte ceiling and a maximum additional charge for the funded term. No wallet or hidden credit balance.
3. Show current logical usage, remaining base space, selected ceilings, accrued estimate and expected next invoice date. Monthly estimates are information, not extra monthly charges. Enforce allocation/reservation limits before accepting writes, including concurrent uploads; reaching a limit offers deletion/export or a deliberate ceiling change, not silent extra spend.
4. Prefer settling accrued usage with annual renewal. If renewal is cancelled, disclose the final usage invoice and collection date before confirmation. Stop future renewal through the existing cancellation flow; cancellation does not remove already accrued usage or physically erase retained bytes.
5. On unpaid usage or renewal, show payment repair and explicit export/retention dates. Limit new expensive allocations under the agreed policy; keep identity, security contact and appeal separate. Deletion/archive follows a finite, disclosed, funded policy rather than an indefinite unpaid balance.

## Meter and rounding decisions

Proposed trusted input is **logical excess byte-time**, not uploads, request counts or keystrokes. Let B(t) be durable logical bytes, I=10,000,000,000 included bytes, and T the exact funded annual duration in milliseconds. Capacity/spend admission separately includes outstanding reservations; charging unused reservations is not assumed and would require explicit terms. Never count the same object once as a reservation and again as committed usage. The estimator convention is:

`Q = 12 × Σ(max(0, B − I) × elapsedMs) / (1,000,000,000 × T)`

Q is a proposed billed “GB-month”: one decimal GB for one twelfth of that funded term. It is neither a calendar month nor Cloudflare's storage unit. Unused included space never becomes negative usage or cash credit.

| Candidate | Behavior and unresolved tradeoff |
| --- | --- |
| Exact positive byte-time | Small fractional excess remains fractional. Preferred engineering candidate for predictable marginal use; requires bounded integer accumulation, rational conversion and exact carry. |
| Whole excess GB over time | Round excess capacity upward before integrating. Easier to describe but a single extra byte can price as 1 GB for that interval; no approval implied. |
| Final currency rounding | Existing estimator rounds the final aggregate upward to one cent. Nearest-cent settlement is an alternative; choose once, disclose ties and retain sub-cent carry consistently. Never round each event/day upward. |

At the unapproved $0.05 rate, 10 GB extra for the entire term is 120 units/$6, including a leap-year term. One extra GB for 31 days of a 365-day term is approximately 1.019178 units/$0.050959 before settlement rounding. Cancellation/partial terms must use the original funded denominator, not retrospectively reprice history. Plan changes need their own golden cases.

A possible transport quantity is integer micro-units with exact remainder carry; the SDK permits fine decimal unit prices. Event limits, precision and invoice rounding must be sandbox-proven before selecting representation. Emit deterministic bounded aggregate receipts, not unbounded per-edit events, and reconcile ingestion, lost ACKs, replay and invoice totals.

## Annual collection and failure boundary

Polar documents annual usage aggregation with renewal, combined with the base order. Cancelling immediately invoices accrued usage immediately; period-end cancellation invoices final usage at period end. A separate monthly meter cycle is optional, not needed for annual consolidation. Small amounts may carry to another order rather than being collected. Failed separate usage orders can be voided while the subscription remains active; annual active status alone must not admit unlimited excess. These are vendor capabilities, not verified local integration behavior. [Polar usage billing](https://polar.sh/docs/features/usage-based-billing/billing).

The annual model exposes up to a term of unpaid usage. Define low-final-balance writeoff/carry rules and a maximum debt horizon; do not promise a final payment will collect. Cancellation, immediate termination, refunds, chargebacks, failed renewal and failed usage orders need distinct idempotent transitions. Native paidThrough remains evidence of funded time, not proof of collectible future usage. [Polar failed renewals](https://polar.sh/docs/features/subscriptions/failed-payments).

Related internal analysis: [Service work cost audit](SERVICE-WORK-COSTS.md) separates published fleet costs from unmeasured sync amplification and proposed usage limits.

## Fee and retained-byte risk

Official Starter fees are 5%+$0.50 per transaction; international cards add 1.5%, with payout/dispute costs separate. A qualifying older organization may retain 4%+$0.40 plus 0.5% subscriptions, but eligibility is unverified. Check the actual organization plan before signoff. [Polar pricing](https://polar.sh/resources/pricing).

Before tax, international extras or payouts, a $10 Starter payment leaves $9. A combined illustrative $16 annual invoice leaves $14.70. If a standalone $0.05 charge were processed, percentage-plus-fixed fee arithmetic would exceed it; this is not a claim Polar will process a below-minimum invoice. Annual consolidation reduces that fee problem but increases noncollection exposure.

R2 Standard lists $0.015/GB-month plus operation charges. Its shared free allowance is not another free 10 GB for every user. Physical bytes, vendor rounding/daily peaks, journals, superseded objects, encrypted archives, export pins and retained copies differ from logical billed capacity. SQL/CPU/mail/support and payment losses also cost money. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Illustration only: 20 GB for 12 months plus 7 months retained is about $5.70 raw storage at that rate. If only the $10 base collects, its $9 Starter net leaves about $3.30 before every other cost. This is not a profitability forecast. Late-term excess uploads can accrue little usage but leave substantial archive liability. Enforce independent physical-capacity, retained-byte funding and charge ceilings; a Polar invoice cap cannot bound storage cost.

## Decisions explicitly awaiting signoff

- Exact excess rate and unit/rounding/carry semantics. $0.05 is illustrative only.
- Initial byte/spend ceilings. 10 GB extra/$6 per annual term is a candidate, not an approved cap; no larger allowance is implied.
- Annual settlement, small final balances, cancellation/refund policy, debt/writeoff horizon and failed-invoice admission.
- Finite export/grace/archive deadlines and their retained-byte funding, especially when overage never collects.
- Polar trials are the intended route; duration, capacity, conversion disclosure and bounded allocation/abuse controls still need signoff. A 30-day/1 GB trial is only an example. Polar currently requires payment details at checkout and charges after conversion unless cancelled. A no-card alternative would require a separate approved design and is not equivalent to that flow. [Polar trials](https://polar.sh/docs/features/subscriptions/trials).
- Actual fee-plan eligibility and sandbox golden cases for annual renewal, cancellation, rounding, partial periods, duplicate events, failed payments and final invoice collection.

No commercial decision is inferred from the disabled estimator or this research. Public site prices, checkout configuration and production activation remain unchanged.
