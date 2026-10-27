# Annual plan unit economics

Initial USD base catalog updated by the user on 2026-10-13: Free 500 MB, Paid 5 GB/$5 yearly, Plus 100 GB/$35 yearly, Ultra 1 TB/$250 yearly. Units are decimal; 1 TB is 1,000 GB. Billing remains disabled. These are planning calculations, not measured production costs or an invoice ceiling. The previous analysis is retained as a [superseded historical snapshot](unit-economics-2026-10-12.md).

Actual buyer prices come from configured Polar currency prices. This model uses only the base USD scenario; it does not forecast settlement value, FX, tax or contribution for other currencies. Reconcile those against actual provider transactions before treating regional prices as equally profitable.

## Storage and payment baseline

R2 Standard storage is $0.015/GB-month. Polar Starter's modeled domestic annual transaction fee is 5% + $0.50. Both rates were checked against primary sources on 2026-10-13. Free provider allowances belong to the entire deployment; they are not allocated to each user. Tax, international cards, payout, refunds, disputes and higher Polar subscription plans can change payment economics. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Polar pricing](https://polar.sh/resources/pricing).

| Plan | Annual gross | Modeled payment fee | Full logical payload storage/year | Remaining before other costs |
| --- | ---: | ---: | ---: | ---: |
| Free, 500 MB | $0 | $0 | $0.09 | −$0.09 |
| Paid, 5 GB | $5 | $0.75 | $0.90 | $3.35 |
| Plus, 100 GB | $35 | $2.25 | $18.00 | $14.75 |
| Ultra, 1 TB | $250 | $13.00 | $180.00 | $57.00 |

Formula: quotaGB × occupancy × $0.015 × 12. This table assumes one retained payload copy and full occupancy throughout the year. Staging, old versions and archives add physical bytes; two full copies of an Ultra account cost $360/year before activity, exceeding its gross revenue. Bounded physical retention and cleanup are necessary for these prices. A storage allowance does not include an equivalent TURN relay allowance.

## Reproducible activity scenarios

Run `node scripts/cost-model.mjs`. The calculator now accepts free/paid/plus/ultra cohorts and includes line items, payment fees, shared allowance rounding, semantic sensitivities and fleet totals. It makes no provider requests. Other provider-rate inputs retain their documented 2026-10-12 snapshot and must be rechecked before launch. [Calculator](../../scripts/cost-model.mjs).

The model's unrestricted typical full-storage scenario uses a 1.10 physical-to-logical byte multiplier, with its explicitly listed request/index assumptions. Ultra shares Plus's illustrative activity profile; larger storage is not assumed to imply proportionally more requests or vectors. This is a sensitivity calculation, not a capacity measurement.

| Full-storage typical scenario/year | Free | Paid | Plus | Ultra |
| --- | ---: | ---: | ---: | ---: |
| Modeled infrastructure before shared allowances | $0.206 | $1.769 | $23.460 | $201.660 |
| Net annual receipts before payout | $0 | $4.25 | $32.75 | $237.00 |
| Contribution before payout/support/overhead | −$0.206 | $2.481 | $9.290 | $35.340 |

Substituting the implemented per-owner launch semantic maxima gives:

| Full-storage comparison/year | Free | Paid | Plus | Ultra |
| --- | ---: | ---: | ---: | ---: |
| Modeled infrastructure | $0.404 | $1.496 | $21.120 | $199.320 |
| Contribution before payout/support/overhead | −$0.404 | $2.754 | $11.630 | $37.680 |

This comparison holds nonsemantic workload assumptions fixed, uses 1,000 retained vectors, 500 queries/month and 1,000 document embedding attempts/month, and includes no additional budget-authority overhead. Retained vectors cost money after admissions stop. Free users require an explicit funded subsidy; unused paid storage can improve margins but must not be assumed for every subscriber.

## Actual admission boundaries

Covered logical mutations and physical bucket-put attempts share one activity ledger. Free permits 500/hour and 1,000/day; Paid, Plus and Ultra permit 2,000/hour and 10,000/day. All use rolling windows, with 120 units/app/minute and 240/account/minute. The service ceiling is 10 million admitted units/month, including its archive reserve. A normal hosted upload uses a logical unit plus a physical unit. Failed admitted work is nonrefundable. [Enforcement and migration](storage-write-costs.md).

These counters do not cover every billed request, row, read, semantic operation or external service. Account and service authorities add their own SQL/DO costs. HTTP abuse checks, signup budgets, byte quota, index/count bounds, bounded retries and cleanup complement them. Service shard exhaustion can occur while capacity remains in another partition. Monthly provider invoice reconciliation is still required.

The portal's visible idle file-offer polling can produce 86,400 requests per 30-day month for a continuously open device, more than the illustrative typical account profile. Multiple devices multiply this. Activity writes are coalesced, but permission/authentication reads remain. Measure real request fan-out, active duration, rows, FTS churn, restoration, physical retention and payload downloads before treating a scenario as representative.

Production evidence remains pending: provider billing reconciliation, measured workloads, actual payments/payouts, abuse controls, backup/restore at meaningful size and a funded free-service reserve. The implementation's 1 TB quota is not a claim of a tested 1 TB restoration or a one-blob upload; object and message size/count limits remain separate. Economics/operations reviewer ___ / Date ___ / Outcome ___.

## Hosted relay (provisional)

Provisional coordinator allowances, 2026-10-27 (RTC-f), not signed off. Prices are unchanged. Run `relayEconomics()` in `scripts/cost-model.mjs`; `tests/cost-model-relay.test.mjs` fails if a paid plan drops under a 50% margin with its whole relay allowance spent.

TURN relay was not modelled before. The planning rate is US$0.05 per GB of Cloudflare Realtime TURN egress, with a deployment-wide monthly free tier (taken as 1,000 GB, not allocated per account and not counted here). **Neither figure was rechecked against a primary source in this slice; recheck both before any relay flag is enabled.** The built-in relay occupant reserves an envelope of 125 MB per issued credential (300 s at about 3.3 Mbit/s through the account's own relay, both directions, a relayed video call), and each plan gets a monthly allowance of reserved bytes:

| Plan | Relay allowance/month | Relayed video at the envelope | Typical infra/year | Fee | Relay at full allowance/year | Margin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Free | none | none | $0.13 | $0 | $0 | n/a |
| Paid, $5 | 1 GB | about 40 min | $0.98 | $0.75 | $0.60 | 53.5% |
| Plus, $35 | 10 GB | about 6.7 h | $7.62 | $2.25 | $6.00 | 54.7% |
| Ultra, $250 | 100 GB | about 67 h | $43.26 | $13.00 | $60.00 | 53.5% |

The margin uses the model's typical profile (20% occupancy), with the whole allowance relayed every month. At full storage occupancy the person plans are already under 50% without any relay (see the tables above), so a heavy-storage subscriber who also uses the full relay allowance is below the floor. A TURN price above about US$0.064/GB puts Paid under 50% at this allowance.

What this does and does not bound:
- **Relayed bytes are bounded only if the spend authority enforces caps using the usage it is given.** The allowance is an admission estimate per credential, not a byte cap. A TURN credential is a bearer token with no byte limit, so a client can move any number of bytes during its 300 s, and possibly longer if allocations outlive the credential (RTCf-4, open). Spec §10 forbids relying on client byte counts, so spend has to be capped at the relay. That is the external `RTC_RELAY_SPEND` authority, which no deployment has yet (the relay-spend budget gate, [RTC design](rtc-signaling.md) §8.3). The occupant gives it, at `commit`, the TURN usernames of each credential, their expiry, the owner and the leg, so it can attribute the provider's per-username usage and revoke an overrun. The margins in the table hold only under that enforcement.
- **Stress row, no enforcement** (`relayAbuseStress()`): one abusive account holding 4 relayed legs at once (the occupant's limit) at 4 Mbit/s of relay egress each (about 2 Mbit/s each way, an HD video call) for a 30-day month relays 5,184 GB. At the planning rate that is about $259 a month, or $3,110 a year: more than one Ultra year ($250) every month, and 622 times the Paid price over a year. Every plan's margin is deeply negative (Paid −62,143%, Plus −8,815%, Ultra −1,167%). The local allowance does not change this, because it limits issuances, not bytes.
- **Production gate:** before `RTC_TURN_ENABLED` is enabled anywhere, the spend authority must enforce per-owner byte caps (at or below these allowances) from the TURN provider's usage feed, attributing usage through the usernames it receives at `commit` and revoking credentials that overrun. A configured authority that answers `enforced: true` without this is not enough.
- Per session, at most 3 GB (24 envelopes, about 2 h relayed) can be reserved; per account, at most 4 legs at once and 60 credentials an hour.
- Free accounts get no hosted relay. They can assign a third-party relay occupant to the slot (RTC-7: each party funds its own relay); cross-entity sessions otherwise need the owner's opt-in to connect directly (RTC-6).
- Organization plans have no relay allowance in this model.

Economics reviewer ___ / Date ___ / Outcome ___.

## Organization tiers (provisional)

Provisional coordinator pricing, 2026-10-23, not signed off. Run `organizationEconomics()` in `scripts/cost-model.mjs`; `tests/cost-model-organizations.test.mjs` fails if any tier drops under a 50% worst-case margin.

The worst case assumes full occupancy with a 1.10 physical multiplier, every AI credit spent, every card international (Polar 5% + 1.5% international + 0.5% subscription + $0.50), US$0.10 per member a year for certificate, DPoP and directory traffic, US$60 a year for organization-account activity at its work-budget ceiling, and a support allowance of $100, $300 or $1,000. One AI credit is defined as at most US$0.0001 of modelled provider spend. That definition carries weight: at ten times that value, the margin falls under 50%.

| Tier | Price/year | Storage | AI | Fee | Worst-case cost | Margin | Margin with a second copy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Team, 1 TB | $1,200 | $198 | $24 | $84.50 | $472 | 60.7% | 44.2% |
| Business, 10 TB | $7,200 | $1,980 | $240 | $504.50 | $3,135 | 56.5% | 29.0% |
| Scale, 100 TB | $60,000 | $19,800 | $2,400 | $4,200.50 | $27,961 | 53.4% | 20.4% |

The earlier placeholders, $6,000 and $36,000, gave 50.2% and 27% under the same assumptions, so Business and Scale were raised. Typical occupancy, which the person model takes as 20%, puts every tier above 75%. These open points remain:
- whether backups are a separate copy (consider R2 Infrequent Access at $0.01/GB-month) or an add-on;
- whether Polar accepts card payments of $60,000, or Scale needs invoicing;
- per-tier enforcement of AI credits, which is not wired yet.

Economics reviewer ___ / Date ___ / Outcome ___.
