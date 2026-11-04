# Service work cost audit

**2026-11-04 — unsigned internal proposal.** Preserve **$10/year including 10 GB**. Outside public-site generation; no price, allowance, configuration or billing changes. Optional metered heavy sync still needs measured allowances, a rate, spend limits and owner signoff. Ordinary signaling should have abuse limits, not a normal per-message bill.

## Published marginal rates and shared allowances

USD, checked against current official documentation. Included amounts are **monthly account/fleet pools**, never a fresh allocation for every customer.

| Resource | Included pool | Marginal rate |
| --- | --- | --- |
| Workers | $5/month minimum; 10M requests, 30M CPU-ms | $0.30/M requests; $0.02/M CPU-ms |
| Durable Object requests | 1M | $0.15/M |
| DO duration | 400,000 GB-seconds | $12.50/M GB-seconds |
| DO SQLite | 25B rows read; 50M written; 5 GB-month | $0.001/M read; $1/M written; $0.20/GB-month |
| R2 Standard | 10 GB-month; 1M Class A, 10M Class B | $0.015/GB-month; $4.50/M A; $0.36/M B |

Sources: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).

Hidden SQLite-backed KV operations also incur row work; deletes and alarm writes count. Each stub RPC is a DO request. Hibernation-eligible idle objects avoid duration charges; pending work can prevent that. Duration is charged per actual DO instance. The historical fixture shared an installation actor; future per-user/service actors add separate chargeable residency. R2 Internet egress is free; operation and physical-storage charges remain. Vendor billing rounds units, so arithmetic below is not an invoice forecast. [DO billing semantics](https://developers.cloudflare.com/durable-objects/platform/pricing/), [R2 rounding](https://developers.cloudflare.com/r2/pricing/#r2-pricing).

## Sensitivity, not measured amplification

Assume each merged sync batch causes one Worker request, one DO call, 5 CPU-ms, 10 ms chargeable DO time at 0.128 GB allocation, 20 SQL rows read and one R2 checkpoint PUT per 100 batches. Compare **one versus eight total billed SQL writes**, including hidden KV/index/trigger/alarm work. This hypothetical 10 ms duty cycle is not measured residency under sustained 1 Hz traffic. No included pools are subtracted.

| Activity, 365 days | Batches/year | Annual marginal work: 1 write | 8 writes |
| --- | ---: | ---: | ---: |
| Daily | 365 | $0.00060 | $0.00315 |
| Hourly | 8,760 | $0.01429 | $0.07561 |
| 1 Hz, eight hours/day | 10,512,000 | $17.15 | $90.73 |

These totals exclude stored bytes and the shared $60/year plan minimum. Ten physical R2 GB for twelve months adds approximately **$1.80** before pools/rounding. Ten logical GB can require more physical bytes: encryption, journals, checkpoints, retired objects, export pins, archives and retained copies all matter until deletion. SQL storage, additional authorization calls/reads, retries, fanout, mail, payment fees, support and losses are omitted.

For one 0.128 GB actor, continuously **chargeable** residency costs approximately **$50.46/year**, or **$16.82** for eight hours/day, before shared pools and rounding. Substitute that duration component for the table's 10 ms assumption; do not add both. Idle eligibility, timers, pending I/O and WebSocket API choice determine chargeability; 1 Hz alone does not establish it. Physical hibernation delay is not itself billed when idle eligibility holds. [Duration and lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

## Evidence and decisions still needed

A historical 35-second, two-provider workload measured native SQL cursor and logical KV operations, including zero cursor writes and one 199-byte R2 PUT. It did **not** measure hidden-KV billed write amplification, CPU or duration, and is neither current capacity evidence nor zero object I/O. Provenance: core source `ed1ff412ccbda4a73e42cc6420ece54de3eecd9730bd9c28fc5627c11296f9a9`, retained adaptive-metrics report.

Measure actual route costs, failed work, maintenance, cold starts and fleet sizes before setting account/app/fleet request and work allowances. Bound no-op reads, scans, history, payloads and retained physical bytes; admission itself must avoid excessive durable writes. Batch edits and reduce idle polling without weakening fresh authorization. Fix accidental amplification or non-hibernating loops rather than billing our inefficiency onward. Any optional heavy-sync meter needs explicit opt-in, estimates, hard caps, cancellation/unpaid handling and signoff. No profitability claim follows from this audit.
