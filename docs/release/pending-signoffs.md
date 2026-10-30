# Pending sign-offs

Status: digest, written 2026-10-24 at HEAD a38bfed. It covers DEVLOG.md from "2026-10-22 — User decisions: Parley data on deletion, org identity, certificates, naming" through "2026-10-23 — Redirect management re-review fixes (round 2)". An update the same day adds two entries: "2026-10-24 — AU-S6 producer summary, What's left and removal reminders" and "2026-10-24 — ORG-10 relations design". It also covers the earlier organization and portability decisions that those entries still refer to: organization prices, BG-1 to BG-17 and P14–P19.

A second update, at HEAD 6bbae45, adds everything after "2026-10-24 — Pending sign-off digest": "2026-10-24 — UI quality pass 3 (browser probe round 3)"; "2026-10-24 — Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" and its review follow-ups; "2026-10-24 — ORG-12d support adjudication" and its review follow-ups and wargame 4 admin items; and "2026-10-24 — Operator and lifecycle wargame fixes" and its review follow-ups. The new items are ID-11, OB-45 to OB-52, MC-9, AP-15, AP-16, UI-8 to UI-11 and OL-7 to OL-17, plus new unverified external assumptions at the end.

A third update, at HEAD b09140b, adds everything after "2026-10-24 — Operator and lifecycle wargame fixes" that was not yet covered: "2026-10-24 — Break-glass and ownership outbox scaling"; "2026-10-24 — ORG-10a-c relations core (flags off)", "2026-10-24 — ORG-10d/e entity certificates and relation events (flags off)" and "2026-10-26 — ORG-10f/g relations routes and console (flags off)", with their review follow-ups; "2026-10-24 — Spec/implementation drift audit"; "2026-10-26 — Test reliability fixes"; "2026-10-26 — RTC signaling extension design"; and "2026-10-26 — Beam removed from core" with its review follow-ups. The new items are OB-53 to OB-70, MC-11 to MC-15, RTC-1 to RTC-17, AMD-X1, AMD-R1 to AMD-R6 and OL-18 to OL-20. A new section, "Open scope questions (core-scope audit 2026-10-26)", lists four owner questions (SQ-1 to SQ-4), and new unverified external assumptions are added at the end. MC-10 and AP-17, added by hand between the second and third updates, are the drift audit's findings 3 and 2. Three entries join the highest-impact list: RTC-6, AMD-X1 and SQ-1. Some earlier items now carry a dated update note (MC-1, MC-8).

A fourth update, at HEAD 6a192a3, adds the entries after "2026-10-26 — Beam removed from core" that were not yet covered: "2026-10-26 — RTC-a/b/c validators, purposes and bound options (flags off)" and its review follow-ups (AMD-RV1); "2026-10-26 — Messaging extraction prep (no reset)" and its review follow-ups; "2026-10-26 — Core-scope audit"; "2026-10-27 — Browser bug hunt fixes (post Beam removal)" with its deferred items and the F14 owner decision, and "Bug hunt fixes: server review follow-ups"; "2026-10-27 — RTC-d sessions, admission and same-host transport" (RTCd-1 to RTCd-25); "RTC-g owner settings and portal ring" (RTCg-1 to RTCg-16 and follow-ups); "RTC-e foreign transport, endpoint and key roster" (RTCe-1 to RTCe-22, the review and verification follow-ups, AMD-RV2); and "RTC service follow-ups for the owner UI" (RTCs-1 to RTCs-8). The new items are RTCabc-1 to RTCabc-7, the RTC-d, RTC-g, RTC-e and RTCs items under "RTC signaling", MC-16 to MC-22, AP-18, AP-19, UI-12 to UI-15 and OL-21 to OL-23. Five entries join the highest-impact list: RTCe-4, RTCs-1, RTC-17 (with RTCe-22 and RTCs-7), UI-13 and OL-21. RTC-8, RTC-11, RTC-17 and AMD-X1 carry dated update notes, the SQ section's source note is refreshed, and the production gates the RTC entries record are added to the unverified assumptions at the end.

A fifth update, at HEAD 67329c9, adds the entries after "RTC service follow-ups for the owner UI": "2026-10-27 — RTC-f relay occupant (flags off)" and "2026-10-27 — RTC-f review follow-ups" (RTCf-1 to RTCf-14, AMD-RL1); and "2026-10-27 — RTC-i conformance peer: divergences and fixes" and "2026-10-27 — RTC-i review follow-ups" (AMD-RI1 to AMD-RI5). The new items are the RTC-f and RTC-i sub-sections under "RTC signaling": RTCf-1 to RTCf-14 in eight items plus RTCf-rev and RTCf-open, and RTCi-1 to RTCi-11 plus RTCi-open, 22 items in all. AMD-RI1 and AMD-RI2 are recorded on the existing RTCe-3/RTCe-4 item, and the RTCe-16 revision on the RTCe-5/RTCe-16 item, rather than as new items; RTCf-10 carries its own revision note. Three entries join the highest-impact list: RTCf-rev, RTCf-8/RTCf-9 and RTCi-8; entry 18 (RTCe-4) now names AMD-RI1. RTC-7, RTCe-1/RTCe-2 and RTCe-open carry dated update notes, and the relay, price, TURN API, Durable Object and conformance gates are added to the unverified assumptions at the end.

A sixth update, on the uncommitted working tree at HEAD ce28f79, adds the three RTC wargame entries: "2026-10-27 — RTC wargame findings and fixes (engine/route)", "2026-10-27 — RTC wargame M2/M6: ticket lifecycle and spam controls" and "2026-10-27 — RTC wargame review follow-ups" (AMD-RW1 to AMD-RW6). The new items are the "RTC wargame" sub-section under "RTC signaling": 21 decision items (RTCw-H1 to RTCw-L5 with the review's R and I fixes, RTCw-M2-1 to RTCw-M2-5, RTCw-M6-1 to RTCw-M6-5, AMD-RW1, AMD-RW2) plus RTCw-info, RTCw-copy, RTCw-resid and RTCw-open, 24 items in all, which brings the digest to 319. RTC-11, RTCd-4/RTCd-5, RTCd-10, RTCd-11, RTCd-14, RTCd-18/RTCd-19, RTCg-13/RTCg-15/RTCg-16 and RTCe-3/RTCe-4 carry dated update notes, and RTCi-11 is revised in place (the relay actor now carries the narrowed signaling approval). Four entries join the highest-impact list: provider block and mutes (RTCw-M6-1, RTCw-M6-2), tickets tied to the minting app (RTCw-M2-1 to RTCw-M2-3), the new limit values (RTCw-M1, RTCw-M3, RTCw-M2-2) and cross-application visibility (AMD-RW1); entry 18 (RTCe-4) now records the 202-with-dark-ingest answer for a per-account flag-off. The flag-cohort drain-rate residual and the wargame's local-only evidence are added to the unverified assumptions at the end.

A seventh update, on the uncommitted working tree at HEAD 74b94ee (2026-10-28), adds every entry after "2026-10-27 — RTC wargame review follow-ups", from "2026-10-27 — Bug hunt round 3 (browser)" through "2026-10-28 — Contacts phase 2: CR-C0 safety gates implemented locally". Unlike earlier updates it lists one item per decision group, with a link to each DEVLOG entry, in the new section "Core scope, extensions revision 3, signaling revision 3 and contacts": 22 items (OD-1 to OD-4, EXT3-21, the EXT3 set, EXT3-impl, EXT3-surf, EC-1, SG-C5-1, SG-rest, SG-AMD, SG-ENG, MSG-55, LC-1 to LC-14, MC-23, CL-1 to CL-25, CL-17, CR-C0, UI-16, OL-24 and ID-12), which brings the digest to 341. Three owner approvals that DEVLOG records (EXT3-25, EXT3-26 and the islands document at the `embed_origin` root) are listed there separately as approved, not pending. Signaling revision 3.2 supersedes the RTC signaling sub-sections, which stay as history. Four entries join the highest-impact list: EXT3-21, signaling C.5 step 1, CL-17 and the signaling `data` budget's cost.

An eighth update, on the uncommitted working tree at HEAD d58305f (2026-10-28), records the owner approvals of 2026-10-28 ([DEVLOG "Owner approvals and directions (in session)"](../../DEVLOG.md#2026-10-28--owner-approvals-and-directions-in-session)). They are listed as approved, with that date and link, at the start of the seventh-update section: the contacts rethink §11 Q1–Q3 answers, the widened `audience` definition in extensions §2.4 (so `transfer_in_endpoint` needs no exception), the signaling `data` budget of 256 KiB per hour on every plan with organization and service-entity budgets to be tiered by an organization plan, and the platform and integrations spike questions 1–8 (question 5 answered as the owner's Cloudflare account). The same entry's new owner directions (the Cloudflare integration as a console app, the paid built-in classifier with tier-scaled rate limits, which supersedes "no default classifier", and the Parlay classification UX) are directions, not sign-offs of any design. SG-ENG and its highest-impact entry are updated: at the new budget Paid holds the 50% floor without relay, and only Paid with its whole relay allowance stays under it, behind the relay byte-cap gate (RTCf-rev). The "RPC payloads" line of that entry is a coordinator recommendation, not an owner approval, and is not listed as approved.

A ninth note (2026-10-28): the email bridge was removed under DEVLOG "Owner direction: strike the email bridge for now" (revisit later). Its rows below are marked removed rather than deleted.

How to read this file:

- [DEVLOG.md](../../DEVLOG.md) is the source of record. This file only summarises it, and where the two differ, DEVLOG wins. Sign-offs go on the DEVLOG entry's `Reviewer / Date / Outcome` line, not here.
- **Nothing here is signed off**, except the owner approvals listed as such at the start of the seventh-update section (including those the eighth update adds). Every other item is provisional, open, or a user statement whose DEVLOG sign-off line is still blank. Items marked *(user)* are positions the user stated. They are listed because their ledger lines are unsigned, not because they are in doubt.
- "Source" gives the DEVLOG entry title, without the date when it is 2026-10-23. "Safe alternative" is filled in only where DEVLOG or the cited design records one.
- Decisions from before 2026-10-22 (spam thresholds, the messaging app name, the BindleBox cutover reset, conversation gate A/C and others) are in [open-items.md](open-items.md) §1. They are not repeated here.
- Everything is local behaviour behind default-off flags. Polar is sandbox only, and no mail, push or provider delivery has been verified. Production release remains disabled.

## Highest-impact items

These items reverse an earlier stated position, carry legal or compliance weight, or affect money.

1. **OB-1 — BG-1: Track A break-glass takes effect by timeout.** This is a third exception to "no timeout decides".
2. **OB-16 — BG-16: support adjudicates held break-glass claims.** This reverses "3sln.me adjudicates nothing". Lapse-claim "proceed" now needs two operators.
3. **RL-1 — Unknown regions are blocked on the Worker.** A missing country, `XX` or Tor (`T1`) cannot sign up or check out.
4. **RL-2 / RL-3 — EU territory list and counsel questions.** Seven outermost regions and Åland were added to the block. Ten other territories are not blocked, pending counsel.
5. **AP-1 — The classifier budget is split out, doubling exposure.** It gets its own ledger, and combined estimated AI admission exposure rises from $5 to $10 a month.
6. **PB-12 — Retention grace and anchor-release rules.** These include the 30-day deadline, the 90-day release window, the 7-day fitting rule and the 72 h billing-pause bound.
7. **ID-1 to ID-4 — Recovery-file reissue rules.** These include the 7-day credential age, the 7-day cooling-off, cancel-only previous files and the file-proof passkey rule.
8. **PB-1 — Organization tier prices.** Team $1,200, Business $7,200 and Scale $60,000 a year.
9. **OB-13 — BG-13: reinstatement billing.** No checkout first, a 14-day grace, and the break-glass owner's refund at support's discretion.
10. **PB-7 — Break-glass processing fee.** 5% + $0.50 is kept on a voluntary withdrawal, and what counts as voluntary is set (BG-4, BG-17).
11. **PB-11 — Regional pricing arbitrage policy (open).** Buyers can choose the cheapest configured currency.
12. **OB-28 — ORG-10 RL-2: any admin establishes relations.** There is no owner approval, elevation or delay, which is a governance call.
13. **AP-15 — RR1-M7 privacy deviation: per-object app markers plus a pointer index.** Together they effectively make a per-app file record, which the RR1-M7 privacy position was meant to avoid. The DEVLOG says it is not approval of an exception.
14. **OB-45 — Operator key custody residual.** Operator assertion keys are held by the admin service, but the admin service and the account objects share one deployment and one secret environment, so the separation is logical, not a hard trust boundary. Production needs a key custody review.
15. **RTC-6 — Cross-user calls are relay-only by default.** Cross-entity sessions use the `relay` IP policy, and with hosted relay off they need an owner opt-in to connect directly, so cross-user calls do not work until the opt-in or a funded relay exists (RTC-7).
16. **AMD-X1 — Bound consumer options in the extension system.** A proposed change to the extension system itself (a `bind` slot member in `crit`, `options` on slot requests, per-consumer approved values recorded in the grant). The rest of the RTC design depends on it.
17. **SQ-1 — Confirm the irreversible BB-CUT message-data reset.** *(Answered by the user and implemented 2026-10-27; see SQ-1 below.)* The only irreversible step in the roadmap: all existing local messages, contacts, conversations and blocks would be discarded when legacy messaging leaves core.
18. **RTCe-4 — Uniform 404 instead of the spec's 202 at `POST /bindle/rtc`.** For an `aud` that names no active entity here, and while foreign RTC is off deployment-wide, the route answers the uniform 404, which differs from spec §8.2 ("202 for every batch that passes step 1"). It needs a spec amendment, now named AMD-RI1 (proposed, unsigned; the RTC-i conformance run kept the reading as intentional). *Revised 2026-10-27 (RTC wargame L3/R1):* a per-account flag-off no longer answers 404; it answers exactly as a flag-on entity does (400 at step 1, else 202 with a dark ingest that can fill the queue to 503), so the 404 now covers only an unknown or inactive `aud` and the deployment-wide flags. A drain-rate residual remains (RTCw-resid). Its companion AMD-RV2 (refresh scheduling that may depend on step 2) is also an unsigned spec departure.
19. **RTCs-1 — Declining an unanswered call is silent (with RTCg-5).** The engine now ends an unanswered incoming call without telling the caller, who sees the call ring out. This changes what "decline" means for RTC-8 and withdraws the earlier "send `revoked`" reading, so a caller cannot tell a decline from an unanswered ring.
20. **RTC-17 — The caller's application origin is disclosed to the callee (with RTCe-22, RTCs-7).** It is now implemented in the owner view and the ring. This host cannot verify the origin, so a foreign caller's is shown as "reported by" its provider. If rejected, the field and the ring line go.
21. **UI-13 — F14: the meta-CSP `sandbox` token.** A security-relevant edit the permission classifier refused. The token has no effect in a `<meta>` CSP, but removing it touches `CONTENT_CSP` and the activity content adapter together. Only the owner can decide.
22. **OL-21 — `LINKS_ENABLED` replaces `BINDLEBOX_ENABLED` in core, with an env alias.** A flag rename with a retired-name alias and a carry rule (OL-22). A deployment's behaviour depends on the alias and on the old name's quarantine.
23. **RTCf-rev — Hosted relay needs a spend authority that enforces per-owner byte caps (production gate).** A TURN credential does not limit bytes, and the local allowance limits issuances, not bytes. Before `RTC_TURN_ENABLED` is enabled anywhere, the operator's spend authority must cap each owner's bytes from the TURN provider's usage feed, attributing usage through the usernames it receives at `commit` and revoking overruns. Unenforced, one abusive account can cost about US$259 a month (US$3,110 a year), more than any plan's annual price.
24. **RTCf-8, RTCf-9 — Relay plan allowances.** Free 0, Paid 1 GB, Plus 10 GB and Ultra 100 GB of relay a month, and nothing for organizations. On an unrechecked US$0.05/GB planning rate, a fully used allowance leaves margins of 53.5% to 54.7%; a TURN price above about US$0.064/GB puts Paid under the 50% floor.
25. **RTCi-8 — The `rtc-signaling/v1` contract ships first-party, and the shipped documents override operator registrations.** While the RTC flags are on, the built-in slot manifest and contract take precedence over any operator registration for the same ids. This sets the trust and precedence rule for first-party documents (the `ice-relay/v1` documents are still open).
26. **RTCw-M6-1, RTCw-M6-2 — Provider-level block and mute, with mutes scoped to the asserting provider (AMD-RW4, AMD-RW5).** An owner can block or mute a whole caller provider, and mute a calling app's origin. A blocked provider's invites drop silently and are answered like any other batch. Because a foreign caller's app identity is only what its provider asserts, an app or origin mute set for a foreign caller covers only that provider's callers; unscoped mutes now cover same-host callers only. This host and the owner's own entity are never blockable or provider-mutable. Both amendments are proposed and unapplied.
27. **RTCw-M2-1 to RTCw-M2-3 — Call links are tied to the app that minted them (AMD-RW6).** A ticket records its minting app, is revoked when the app is removed (or when a purpose it names is narrowed away), and each app may hold at most 64 live tickets of the owner's 256, with a mint window of 120 an hour. Legacy tickets without an app are revoked by no app event. Four apps together can still fill the cap.
28. **RTCw-M1, RTCw-M3, RTCw-M2-2 — New RTC limit policy values.** `self` 120 invites an hour per entity, outside every cross-entity window; principal-bound ticket (`preferred`) invites 60 an hour per callee, outside the per-callee and issuer windows; all same-host callers together 40 of the 60 per-callee invites an hour; a ringing reserve of 2 above the 4 ringing slots for `self` and `preferred`; 8 live endpoints per app within 32, and at most 16 endpoints per invite fanned out round-robin across apps; 64 tickets and 120 mints an hour per app. All provisional provider policy, untested under load (AMD-RW1, AMD-RW3).
29. **AMD-RW1 — Every approved app sees every invite of its purpose.** Proposed spec text: every application approved for a purpose sees each invite fanned out to it (caller, caller's app origin and `client_id`, purpose, media, context, basis kind and raw invite) and may accept or decline it for the owner, and approval is consent to that. To stop an app seeing calls the owner narrows or revokes its approval; a mute only silences the alert (spec text corrected 2026-10-27 to match the implementation).
30. **EXT3-21 — What "core" means.** Core is the conformance floor plus the extension mechanism, and the areas the owner called core are Bindle-owned extensions. This reading reconciles two owner statements and needs the owner's sign-off.
31. **SG-C5-1 — Signaling C.5 step 1: kind authorization and bases (SG-2, SG-23 to SG-30, SG-36 to SG-46, AMD-SG-I1).** The engine phase is implemented locally behind default-off flags; no signaling flag may be enabled before this sign-off.
32. **CL-17 — The Bindle Messaging gate covers first contact only.** A provisional widening of the 2026-10-14 decision, with first contact by `connect` invitations and contacts out of core.
33. **SG-ENG — The signaling `data` budget's cost.** The budget itself is owner-approved 2026-10-28 at 256 KiB per hour per entity on every plan ([DEVLOG "Owner approvals and directions (in session)"](../../DEVLOG.md#2026-10-28--owner-approvals-and-directions-in-session)). At that budget Paid holds the 50% margin floor without relay (60.5%) but not with its whole relay allowance (48.5%), which waits on the relay byte-cap gate (unit economics, "Relayed signaling `data` bytes"); the request prices are not rechecked against a primary source.

## Pricing and billing

**PB-1. Organization tier prices**
- Decided: these are the organization plan prices, and every tier must keep a worst-case margin of at least 50% (guard test).
- Value: Team 1 TB at US$1,200/yr (60.7% worst-case margin). Business 10 TB at US$7,200/yr, raised from $6,000 (56.5%). Scale 100 TB at US$60,000/yr, raised from $36,000 (53.4%). Each tier includes AI credits.
- Why: the placeholder Business and Scale prices fell below 50% under a full-occupancy, all-credits-spent, international-fee model.
- Source: "Organization tier pricing checked against unit economics"; "Portability UI and redirect extension (PORT-6, PORT-7); organization billing and ownership transfer".
- Model assumptions (also provisional): one AI credit costs at most US$0.0001 of provider spend. Backup copies are not priced in; including them would bring Scale to a 20% margin.
- Safe alternative: none recorded.
- Owner: ___

**PB-2. Individual Ultra margin**
- Decided: the user-set Ultra plan is unchanged and keeps its thin margin.
- Value: 1 TB at US$250.
- Why: the price was set by the user and is noted only for review.
- Source: "Organization tier pricing checked against unit economics".
- Safe alternative: none recorded.
- Owner: ___

**PB-3. Organization lapse: grace and admin claim**
- Decided: an unpaid organization gets a grace period, then becomes read-only. After that, an admin's lapse claim takes effect unless the owner pays.
- Value: a 14-day grace. Leaving, removals, decisions and export stay open while read-only. The claim takes effect 72 h after the admin's payment. An uncaptured owner payment holds the claim for up to 2 days. Effects apply only on a provider snapshot under 5 minutes old.
- Why: an organization whose owner stops paying should not stay stuck.
- Source: "Portability UI and redirect extension (PORT-6, PORT-7)…"; "Review fixes for f7eda06…".
- Open: the lapse claim uses a 5-minute step-up. Whether it needs P18 tight verification is unresolved.
- Safe alternative: none recorded.
- Owner: ___

**PB-4. Lapse-claim and ownership refunds**
- Decided: a closed paid claim is refunded in full. A partial refund counts as unpaid only if it is a full refund or at least the order's net. Deletion is refused once a transfer is paid. The encryption key is not rotated at transfer.
- Value: as stated.
- Why: no one should pay for an effect that did not happen, and a small partial refund must not let a claim seize a paying organization (H1).
- Source: "Portability UI and redirect extension…"; "Review fixes for f7eda06…".
- Safe alternative: none recorded.
- Owner: ___

**PB-5. Ownership-transfer figures (agent-added)**
- Decided: the agent added timing and refund figures to the user's transfer rule (recipient pays first, fresh billing period).
- Value: a 24 h minimum before a transfer, a 14-day offer lapse, and a full refund if the transfer fails after payment.
- Why: the user's rule needed concrete bounds.
- Source: "2026-10-22 — Refunds, ownership transfer, delegated portability decisions, provisional intent/removal calls".
- Safe alternative: none recorded.
- Owner: ___

**PB-6. Claim-checkout and subscription bookkeeping**
- Decided: claim checkouts are reused and capped. Settled subscriptions are forgotten. An escalated claim closes with refunds.
- Value: 4 claim checkouts per day, with reuse for the same admin and terms. Settled subscriptions are forgotten after 30 days. An escalated claim closes after 30 days, and every order of its subscription is refunded.
- Why: the 17th subscription wedged reconciliation (F-05), and an escalation needs an end.
- Source: "Organizations wargame fixes (F-01–F-07)".
- Safe alternative: none recorded.
- Owner: ___

**PB-7. Break-glass payment, refunds and processing fee**
- Decided: the candidate pays before the wait starts. A claim that ends without effect is refunded in full, except that a voluntary withdrawal keeps the processing fee.
- Value: `ORGANIZATION_PROCESSING_FEE` is 5% + 0.50, on the first order only. Voluntary means the candidate leaves or a co-signer withdraws after payment. Removal, authority resets, suspension and security changes get full refunds. The candidate's disclosure says 30 to 127 days of paid time may be lost.
- Why: paying makes harassment cost something (BG-4), and keeping the fee stops voluntary churn (BG-17).
- Source: "ORG-12a/12c break-glass engine and billing" (L5); "ORG-12b/12e owner channels, abort links and console".
- Safe alternative: BG-4 as originally written absorbed all fees ("fees are absorbed"). BG-17 then introduced the fee deduction.
- Owner: ___

**PB-8. Redirect extension refunds and settlement**
- Decided: ending a redirect early gives no refund. Any order other than the settled one is refunded in full. A settlement marker is kept so a late webhook is not refunded again.
- Value: the marker lives 400 days. There is a 7-day settlement window, and the owner can revive an end within it.
- Why: an extension that ran until the owner ended it delivered what it promised. Without the marker, late events were refunded (M2, R2-5).
- Source: "Portability: redirect end/retarget, expiry reminder, intake gaps"; "Redirect management review fixes"; "Redirect management re-review fixes (round 2)".
- Safe alternative: none recorded.
- Owner: ___

**PB-9. Upgrade locks, guards and the past-due bound**
- Decided: an upgrade released without payment proof holds the paid-through source plan until payment is proved. A past-due upgrade releases only its lock.
- Value: `UPGRADE_PAST_DUE_MS` is 30 days. The provisional window is 15 minutes. A revert needs two separate observations. Plan changes made outside the app (the provider portal) are guarded the same way.
- Why: releases without payment proof granted the unpaid target plan (H1).
- Source: "Billing, retention and region wargame fixes".
- Safe alternative: none recorded. The operator is told to disable plan changes in the Polar customer portal, and the guard is the fallback.
- Owner: ___

**PB-10. Checkout limits and webhook receipts**
- Decided: one open checkout is allowed from Free. A stuck paid-signup checkout may be recreated. Webhook receipts are pruned under pressure.
- Value: an in-flight marker lasts 2 minutes (`CHECKOUT_INFLIGHT_MS`). A checkout stuck at `creating`/`unknown` may be recreated after 1 hour, at most 3 times. Receipts older than 3 days are pruned, at most 64 per event (`EVENT_MIN_RETENTION_MS`). The 4,096-event cap and 35-day retention are kept.
- Why: to prevent duplicate checkouts and permanent 503s.
- Source: "Billing, retention and region wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**PB-11. Regional price arbitrage (open question)**
- Decided: nothing. A buyer can choose any configured currency, and Polar charges the local amount.
- Value: two options are recorded: keep per-currency prices within a band of USD, or restrict currency choice by country.
- Why: a buyer can pick the cheapest configured currency.
- Source: "Billing, retention and region wargame fixes" (open questions).
- Safe alternative: none recorded.
- Owner: ___

**PB-12. Over-quota retention: deadline, grace and anchor release (D092)**
- Decided: an entitlement reduction starts a notified 30-day episode. A funded deadline is released only under specific rules. Phase 1 deletes no data.
- Value:
  - The deadline is at least `max(effectiveAt, consumedAt)` + 30 days, and backfilled transitions are never backdated.
  - An anchor is released by any one of:
    - a verified purchase that covers usage, at most once per 90 days;
    - 30 days of continuous adequate paid entitlement;
    - the deadline passing while the account fits its quota, never reused.
  - A fit caused by an entitlement rise counts against the same 90-day window. A fit counts as `deadline-passed-fitting` only when bytes were reduced, and only from at least 7 days before the deadline.
  - A billing pause of retention is bounded at 72 h (`billingPauseMs`). Reductions in the operator catalog need an explicit notice date.
  - Inventory selection is whole-unit. Status reads at most 5,000 rows, and routes allow 30 requests per minute per owner.
- Why: to stop grace renewal through short paid holds (N1) and indefinite freezes from unpaid upgrades (B1).
- Source: "D092 phase 1: policy and read-only visibility" (M4, N1); "Billing, retention and region wargame fixes" (B1, B6).
- Safe alternative: none recorded. Terms adoption, backfill notice policy and destructive execution are explicitly later work.
- Owner: ___

## Identity and recovery

**ID-1. Active-account recovery-file reissue**
- Decided: a signed-in owner can replace the recovery file in two phases.
- Value:
  - It needs a step-up within 5 minutes with a passkey or password enrolled at least 7 days earlier.
  - Begin rotates the key and stages the new file for 30 minutes. Confirm commits it and restarts `recoveryIssuedAt`, so P14 applies again.
  - Forced paths skip the age rule.
  - It is refused during a deletion, a contested move or the support lock.
  - Within 30 days of an elevated abort, a reissue by a different credential escalates to support.
- Why: there was no signed-in reissue path (a spec defect), and an owner must be able to retire a stolen file.
- Source: "Intent links (INT-1 to INT-7, INT-9) and active-account recovery reissue".
- Safe alternative: none recorded.
- Owner: ___

**ID-2. Reissue cooling-off window** *(user direction 2026-10-23; ledger line blank)*
- Decided: a reissued file cannot start a recovery for a period, and during it the reissue can be cancelled.
- Value:
  - An account with a passkey reissues only after a passkey step-up.
  - A reissued file cannot start `recover()` for 7 days.
  - During those 7 days, a cancel can come from a session that predates the reissue, from the link sent to a pre-reissue email, or with the previous file.
  - The previous file is cancel-only until then.
  - Cancelling rotates the key and raises `federationGeneration`.
- Why: a stolen password could otherwise be used to reissue the file and then recover the account (#1, High).
- Source: "Identity and federation wargame fixes".
- Safe alternative: safer variants were weighed but not adopted. They are recorded in recovery-identity.md "Cooling-off window".
- Owner: ___

**ID-3. Who can cancel: the file-proof rule**
- Decided: a passkey-authorized reissue is "file-proof": the previous file can neither cancel it nor recover. That holds only when the passkey predates the previous file and no channel-removing event happened in the 30 days before begin. A password-authorized reissue stays cancellable with the previous file (variant 1).
- Value: the lookback is 30 days and uses an uncapped `lastChannelRemovalAt`. Channel-removing events are an email change or removal, signing out other sessions, a session-cap eviction and a passkey removal. After a file-proof reissue, the cancel link goes only to the current pre-reissue email.
- Why: this closes R1, V1 and V2. In those, a thief with a password enrols a passkey, swaps the email, evicts sessions or fills the event list.
- Source: "Identity and federation wargame fixes" (coordinator decisions; R1, R2, V1, V2).
- Trade-offs on record:
  - An owner who changes email and then reissues within 30 days gets the password branch.
  - A passkey-only owner who lost the device and has no earlier session or email cannot cancel.
- Safe alternative: none recorded beyond the variants in the spec.
- Owner: ___

**ID-4. Replaced emails stay notice channels**
- Decided: replaced and removed verified emails keep receiving reissue and security notices for a period.
- Value: 30 days, stored one hour longer. A ninth email change within retention is refused (`email_change_limited`). Notices are coalesced to one per type per 10 minutes, for the same actor only.
- Why: a swapped email must not silence the owner (the swapped-email case, R1 (iii)).
- Source: "Identity and federation wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**ID-5. Recovery revokes every app grant**
- Decided: any recovery start, reissue confirmation or cancellation revokes every app grant. Key delegations are not epoch-bound and are revoked explicitly instead.
- Value: `federationEpoch` hashes the recovery credential. `federationGeneration` rises on cancel and suspension. MCP grants fail closed on an epoch change.
- Why: this is the safe direction, and it stops reopened accounts reviving OAuth families.
- Source: "Identity and federation wargame fixes" (`federationEpoch` drift, item 3).
- Safe alternative: none recorded.
- Owner: ___

**ID-6. Recovery binding limit**
- Decided: issuance merges into the recovery key binding, which keeps a bounded number of entries.
- Value: `RECOVERY_BINDING_LIMIT` = 8, trimming the oldest first.
- Why: without a bound, rotation would eventually be skipped for good (M2).
- Source: "2026-10-22 — PORT review round: fixes for c15aa37".
- Safe alternative: none recorded.
- Owner: ___

**ID-7. Reissue when rotation is impossible**
- Decided: when an identity can no longer rotate its key, a signed-in reissue is refused rather than issuing a file with the same key. After an actual recovery, the existing P15 skip-and-audit stays.
- Value: the refusal is `rotation_unavailable` (409). For a moved identity, the 16-key base is a reserve, not a ceiling.
- Why: a reissue must never hand out a file that holds the old signing key. A recovering owner must never be locked out.
- Source: "Successor chain byte budget and key tombstone compaction" (follow-up 3; "Revisit if the coordinator wants that path refused too").
- Safe alternative: also refuse the post-recovery path (named as the revisit option).
- Owner: ___

**ID-8. Same-host authority epoch (`aep`)**
- Decided: a new authority epoch rises only on authority resets: recovery completion, elevated abort and transfer-in.
- Value: `packages/identity/authority-epoch.mjs`. It is narrower than `security.epoch`.
- Why: it fills the spec defect ORG-0 found, where `epoch` was undefined.
- Source: "Organizations phase A: ORG-2 (membership), ORG-3 (member grants), ORG-4 (member certificates)".
- Safe alternative: none recorded.
- Owner: ___

**ID-9. Admin console needs a passkey step-up**
- Decided: admin actions require a passkey step-up with that passkey still enrolled.
- Value: `stepUpCredential.kind==='passkey'`.
- Why: identity wargame finding #2.
- Source: "Identity and federation wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**ID-10. Setup-token churn limits**
- Decided: a setup token allows only a few password sets and recovery downloads.
- Value: 5 of each, checked before any KDF or rotation.
- Why: to stop P15 rotation churn (#11).
- Source: "Identity and federation wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**ID-11. Push subscriptions end with an explicit session end, not natural expiry**
- Decided: a push subscription records the public id of the session that created it. It ends when that session is ended explicitly, but not when the session expires naturally.
- Value:
  - "Explicit end" covers revoke, session-cap eviction, recovery, ordinary sign-out of the session's own chain, "sign out other devices", and administrator suspension, closure and reopening.
  - A natural 24 h expiry does not end the subscription. It stays live until revoke-others, an explicit end or a re-subscribe.
  - The account object keeps a 25 h end marker per ended session, so a late subscribe from that session is refused.
  - "Sign out other devices" also removes every subscription not bound to a kept session, including legacy unbound rows. The browser's own subscription id is kept.
  - Before any message push, rows bound to an ended session are dropped, and notice-channel counts skip them.
  - Deletion and portability channel snapshots are copies taken when the request starts. A device revoked during an in-flight request keeps receiving that request's notices.
  - A failed end stays on the account as `pendingPushEnds` and is retried on the next save or owner view. It clears by a random nonce.
- Why: a revoked device must stop receiving pushes. Sessions last at most 24 h and the client does not re-subscribe at sign-in, so treating natural expiry as revocation would silence push daily.
- Source: "Operator and lifecycle wargame fixes" (M1, reading 1, and review follow-ups); "ORG-12d support adjudication" (push subscriptions on admin suspension).
- Safe alternative: end the subscription on natural expiry too. It was rejected as silencing push daily.
- Owner: ___

## Portability

**PT-1. P14: "original recovery file" means the current file**
- Decided: transfer-out needs the current recovery file, and it must be at least 7 days old.
- Value: 7 days.
- Why: it settles the user's open question about "original".
- Source: "2026-10-22 — Refunds, ownership transfer, delegated portability decisions…" (delegated to a security design agent).
- Safe alternative: none recorded.
- Owner: ___

**PT-2. P15: pre-rotation deferred; rotate at every issuance**
- Decided: there is no pre-rotation in v1, and every recovery-file issuance rotates the signing key.
- Value: the future shape is one file holding the next key.
- Why: rotation at reissue buys most of what pre-rotation would.
- Source: as PT-1; "2026-10-22 — PORT-1, PORT-9, PORT-10…" (which also lists P11 and AMD-P11 as unsigned).
- Safe alternative: adopt pre-rotation now (the deferred option).
- Owner: ___

**PT-3. P16: v1 fork detection**
- Decided: forks are detected with chained provider attestation keys plus verifier pinning. The 3sln.me root ships in the SDK, with an `attestation_first_use` flag. Verifiers pin from first contact.
- Value: the upgrade path is shared pins, then a move log run by at least two independent operators.
- Why: a verifier that first meets an identity after its source is gone could not otherwise detect a forged chain.
- Source: as PT-1; "App removal (AU-S1…) and portability PORT-4/PORT-5" (first-contact pinning deviation).
- Safe alternative: none recorded.
- Owner: ___

**PT-4. P17: dispute proof ladder**
- Decided: disputes resolve by a known channel, then elevated proof, then support. The winning proof removes the disputing devices and restarts a 72 h delay.
- Value: holds expire after 30 days. The comparison uses the credential that confirmed the step-up.
- Why: a move needs a deterministic resolution procedure (§6.1a, the coordinator's proposal).
- Source: as PT-1; "Identity and federation wargame fixes" (P17 comparison).
- Safe alternative: none recorded.
- Owner: ___

**PT-5. P18: tight verification for owner decisions**
- Decided: owner decisions on organization moves (and P18 references elsewhere) need an aged credential. A recovery file does not substitute.
- Value: the proposal is a step-up with a credential older than 7 days, no security change in 30 days, notices, and a short delay.
- Why: an owner's move cannot be blocked, so it must be hard to impersonate.
- Source: "2026-10-22 — EU/EEA/UK sign-ups blocked…"; "2026-10-22 — Refunds, ownership transfer…".
- Safe alternative: none recorded.
- Owner: ___

**PT-6. P19: timing figures**
- Decided: the portability timing parameters (design §6.7) are confirmed.
- Value: the existing figures, plus a 30-day held-move expiry and a 30-day contest window. A person move has a 24 h notified delay *(user)*, and a held move never auto-commits. The 7-day public wait applies, and it cannot start within 7 days of an authority reset or channel change. Notices also go to channels removed in the last 30 days.
- Why: to give owners time to notice and dispute.
- Source: as PT-1; "2026-10-22 — Identity portability and intent links (design, review round 1)".
- Safe alternative: none recorded.
- Owner: ___

**PT-7. Organization move blocking (M10 reading)**
- Decided: other admins can block a non-owner's org move, and the blocked requester can escalate to the owner. An owner's move can only be objected to.
- Value: as stated.
- Why: this is the coordinator's reading of the user's answer.
- Source: "2026-10-22 — User decisions: legal operator, artefacts, organizations, portability"; "2026-10-22 — EU/EEA/UK sign-ups blocked…".
- Safe alternative: none recorded.
- Owner: ___

**PT-8. Transfer-in deviations**
- Decided:
  - returning to 3sln.me, and displacing an unattested identity, are recognised but refused;
  - intake supports free plans only, with password or passkey enrollment;
  - S3/WebDAV account exports carry namespace metadata only.
- Value: as stated.
- Why: the repository cannot replace a terminal record, and those connectors persist no object mappings.
- Source: "App removal … and portability PORT-4/PORT-5"; "Portability: redirect end/retarget…"; "2026-10-22 — DX-10: account export integration".
- Safe alternative: none recorded.
- Owner: ___

**PT-9. Move hardening rules (wargame F1–F13)**
- Decided:
  - an elevated restart needs a recorded non-requester dispute, and the requester is never its own disputer;
  - path (a) needs a verified email or push channel;
  - `keep` needs a device known before the move began;
  - the commit re-checks the epoch and the recovery credential;
  - a "still serving" acknowledgement is required.
- Value:
  - an unbegun reservation expires after 7 days;
  - a held transfer-in warns at 30 days and gives up after 45 days held and 15 days after the warning;
  - successor queue rows are dropped after 8 attempts, at most 8 per origin and 2 unverified per origin;
  - the move endpoint answers 202 `retry_after: 60` until stage 1.
- Why: red-team findings, one High.
- Source: "Portability wargame fixes (F1–F13)".
- Safe alternative: none recorded.
- Owner: ___

**PT-10. Successor document size budget**
- Decided: each move record has a size cap, and an identity document's budget grows with its moves.
- Value:
  - identity URIs are at most 512 characters, a statement at most 3,072 B and an attestation at most 2,560 B;
  - the base is 32,768 B, plus 7,488 B per move, up to 16 moves (152,576 B);
  - at most 64 keys, `IMPORTED_HISTORY_LIMIT` 63, and kids are 1–128 printable ASCII characters.
- Why: the flat 32 KiB limit failed at 15 moves.
- Source: "Successor chain byte budget and key tombstone compaction".
- Safe alternative: separate history and key pages were rejected.
- Owner: ___

**PT-11. Redirect management (end, retarget, revive, auto-end)**
- Decided: the owner signs in at their current provider to end or retarget the redirect.
  - Equivocation evidence under rooted keys ends the redirect as `contested`, and support decides.
  - Every action must extend the recorded chain.
  - The redirect ends by itself when the target is gone.
- Value:
  - the transaction lasts 10 minutes, with 20 management requests per minute per subnet;
  - the statement is retained until the later of commit + 30 days and end + 7 days;
  - there is a 7-day revive window;
  - auto-end needs at least 3 gone answers, none more than 3 days apart, spanning 30 days;
  - the expiry reminder is opt-in, sent 30 days before expiry, with 3 daily attempts.
- Why: to stop a hostile former host from ending, retargeting or reviving the redirect (M1, M3, R2-1, R2-2).
- Source: "Portability: redirect end/retarget, expiry reminder, intake gaps"; "Redirect management review fixes"; "Redirect management re-review fixes (round 2)".
- Safe alternative: none recorded.
- Owner: ___

## Organizations and break-glass

The 17 BG decisions are design §12d.11. The coordinator recommends "Adopt" for each except BG-12 ("Defer").

**OB-1. BG-1: a third timeout exception (Track A)**
- Decided: Track A break-glass takes effect by itself after its wait if nothing stops it. This is a third explicit exception to "no timeout decides".
- Value: a 30-day notified wait after verified payment. The T1, T5 and 72 h notices must each be accepted on an out-of-band channel, or the claim is held for support.
- Why: support deciding every claim makes operators the weak point and is slow for the common case of a departed owner.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c break-glass engine and billing" (M1).
- Safe alternative: support decides every claim (Track S only).
- Owner: ___

**OB-2. BG-2: break-glass timers**
- Decided: these are the break-glass timers.
- Value: 7 + 7 days to gather. A 30-day Track A wait and a 60-day Track S wait. A 7-day final notice. 30/60-day support bounds. A 90-day contest window and move cooling. A 30-day lock. Track S for 180 days after an owner abort.
- Why: 30 days exceeds most holidays, and 90 days covers a long hospital stay.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-3. BG-3: quorum**
- Decided: a claim needs two eligible admins homed at 3sln.me. A single admin, members, or any objection goes to Track S.
- Value: 30 days' admin tenure. Foreign admins can only object in v1. Member-initiated claims need 90 days' tenure.
- Why: objection-to-support gives every admin a veto on the self-running track.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…".
- Safe alternative: a majority rule, rejected as letting a coalition outrun a lone objector.
- Owner: ___

**OB-4. BG-4: candidate pays first**
- Decided: payment comes before the wait starts. A claim with no effect is refunded in full.
- Value: see PB-7 for the fee.
- Why: it applies the user's transfer rule and makes harassment cost something.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-5. BG-5: owner liveness holds the claim**
- Decided: any interactive owner sign-in or step-up during the wait or final notice holds the claim for support. Track A also needs 30 days without an owner sign-in before the claim, and emails on admin-controlled domains do not count as channels.
- Value: 30 days. Liveness is re-read at the effect, and an unreadable owner blocks the effect.
- Why: an owner who is present must never lose ownership by inattention.
- Source: "ORG-12 break-glass design"; "ORG-12b/12e…" (M1).
- Safe alternative: none recorded.
- Owner: ___

**OB-6. BG-6: the former owner stays a member**
- Decided: at the effect, the former owner stays a member, with governance powers held.
- Value: cause `break-glass`.
- Why: this is safe if their account was compromised and recoverable if not.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-7. BG-7: contest-window restrictions**
- Decided: during the contest window the new owner cannot transfer, delete or move, and the former owner cannot be removed.
- Value: 90 days. The implementation **refuses** narrowing acceptances, where the design said they wait (deviation 3). An undecided contest is escalated after the later of the window's end and 30 days.
- Why: a reinstatement could not undo a purge.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…".
- Safe alternative: queue narrowing acceptances, as the design text says.
- Owner: ___

**OB-8. BG-8: support powers**
- Decided: one operator can hold or abort. Two operators can proceed or exclude channels. Nobody overrides tier-1 proof. There are no operator-started claims and no legal-process path in v1.
- Value: approval by a different operator within 72 h. A "different pair" shares no operator with a barred pair (stricter reading L6). The assertion is single-use and lasts 5 minutes.
- Why: no single operator should be able to seize an organization.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…" (M3, L6).
- Note: BG-8 says counsel should review legal process before public organizations (ORG-13).
- Safe alternative: none recorded.
- Owner: ___

**OB-9. BG-9: a held owner may abort with tier 0**
- Decided: a held owner may abort with tier-0 proof, unlike in file recovery.
- Value: tier 0 is a known session or credential, or a single-use abort token.
- Why: the claimants hold no evidence, so the safe direction wins.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-10. BG-10: no evidence uploads**
- Decided: support keeps claim evidence out of band.
- Value: none uploaded into the product.
- Why: it keeps special-category data out of storage and the audit log.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-11. BG-11: organization recovery-file reissue**
- Decided: a reissue needs an aged credential and notifies admins.
- Value: the credential must be at least 7 days old. Replacing an existing file is refused within 30 days of a security change. A reissue from `missing` after an owner change is immediate.
- Why: the file holds the organization's private keys.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…" (ORG-12r).
- Passkey rule (closed in code, still provisional): an owner who has a passkey must step up with it. ORG-12a M2 had recorded that the rule could not bite yet. It is now wired end to end:
  - `organizationVerification` in `packages/identity/authority-epoch.mjs` sends `hasPasskey` and `method`;
  - `packages/identity/service.mjs` puts that evidence on the owner view;
  - `packages/runtime/http.mjs` passes it into `personActor`;
  - `recoveryReissueBegin` in `packages/orgs/ownership.mjs` refuses with `passkey_required` (401).
  - Tests: `tests/identity-wargame2.test.mjs`, "organization verification carries hasPasskey and the step-up method…", covers the producer and the actor (re-run 2026-10-24, 1/1 pass). `tests/orgs-break-glass-review.test.mjs` covers the refusal.
  - The "Not fixed" bullet in "Identity and federation wargame fixes" predates the V1 follow-up that wired the producer.
  - Rule source: "Identity and federation wargame fixes" (V1 org reissue producer); "ORG-12a/12c…" (M2).
- Safe alternative: none recorded.
- Owner: ___

**OB-12. BG-12: designated successor and escrow deferred**
- Decided: both are deferred.
- Value: designated successor is the first follow-up.
- Why: it does not help organizations without one.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-13. BG-13: contest and reinstatement billing**
- Decided: the former owner may contest within 90 days without being a member. An upheld contest is a reinstatement, not a transfer.
- Value: no checkout first and a 14-day billing grace. The former owner's unused time is refunded or credited. The break-glass owner's refund is at support's discretion.
- Why: making a wronged owner pay first would let a seizure stand.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-14. BG-14: file-based recovery is a later slice**
- Decided: file-based recovery stays a separate slice (ORG-12f).
- Value: ORG-12f must implement the freeze and precedence rules of §12d.7.
- Why: rebuilding it here was gold-plating.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**OB-15. BG-15: aborts and disputes**
- Decided: before a support decision, every tier-0 abort aborts. After a two-operator proceed, a tier-0 dispute returns the claim to support. Support can never exclude the owner's last channel. Only tier 1 ends a claim after a decision.
- Value: the implementation reads tier 0 after an owner abort (within 180 days) as a dispute, not an abort (deviation 1). A channel becomes undeliverable after 8 failed attempts over 7 days.
- Why: one stolen device can only cost support time.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…" (deviation 1, R2-M1).
- Safe alternative: none recorded.
- Owner: ___

**OB-16. BG-16: support becomes an adjudicator**
- Decided: Track S lets support decide held claims. This reverses "3sln.me adjudicates nothing".
- Value: lapse-claim "proceed" (`orgs.claim-resolve`) now needs two distinct, unconflicted operators within 72 h.
- Why: without it, organizations with one admin, no admins or a contested owner have no path.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…".
- Safe alternative: keep "adjudicates nothing" and give those organizations no path.
- Owner: ___

**OB-17. BG-17: counted limits**
- Decided: a claim counts toward the yearly limits only once paid or owner-aborted. Expired held claims never count.
- Value: 3 counted claims per organization per year. Per person: 1 pending candidacy, 2 counted claims and 4 unpaid starts.
- Why: rogue admins should not burn a legitimate recovery's quota.
- Source: "ORG-12 break-glass design"; "ORG-12a/12c…".
- Safe alternative: none recorded.
- Owner: ___

**OB-18. Abort links resist mail scanners**
- Decided: an abort POST needs a user-activated submit, the organization's handle typed as shown, and a signed render time.
- Value:
  - POSTs within 2 s of render or after 2 h are refused;
  - the budget is 5 per minute and 20 per hour per address (IPv6 per /64), and 200 per hour per /24, charged only on failures;
  - every POST takes at least 250 ms;
  - hints are capped at 16 per claim.
- Why: mail scanners could otherwise press the abort button (M2).
- Source: "ORG-12b/12e owner channels, abort links and console".
- Residual: a script-running scanner can still abort, which is the safe direction.
- Safe alternative: none recorded.
- Owner: ___

**OB-19. Earlier delegated organization calls**
- Decided:
  - two 72 h break-glass exceptions to "no timeout decides": post-recovery auto-effect and billing lapse;
  - accepting after rejecting;
  - a held owner cannot cancel a recovery;
  - a 7-day response period;
  - Q14 tight verification for grant-change escalations;
  - Q15 a standard effective-methods output;
  - a portable membership export in the spec;
  - cross-provider member security floors as MUSTs.
- Value: as stated.
- Why: the user delegated these to the coordinator.
- Source: "2026-10-22 — Refunds, ownership transfer, delegated portability decisions, provisional intent/removal calls".
- Safe alternative: R4 reviewer proposal for an absent owner: an admin objection extends the window to 14 days, and an owner derived from a recovery cannot remove admins for 30 days. It was superseded by the elevation rule.
- Owner: ___

**OB-20. Membership guards and limits**
- Decided: there are guards on admins and response periods.
- Value: the minimum response period is 24 h (`ORG_MIN_RESPONSE_MS`), and lowering it notifies admins. Last-admin, no-operator and non-expiring-admin guards apply. At most 10 organizations per creator. Handles cannot be renamed. Deletion is delayed 30 days.
- Why: the owner could otherwise remove an admin instantly (M1).
- Source: "Org phase A review fixes…"; "Organizations phase A: ORG-0, ORG-1, ORG-7"; "…ORG-2, ORG-3, ORG-4".
- Safe alternative: none recorded.
- Owner: ___

**OB-21. Roster caps and retention**
- Decided: per-member state is bounded.
- Value:
  - 64 mutes, and any valid principal is stored;
  - 32 app clients, least recently used evicted;
  - a 64 KiB row;
  - 8 member tokens per membership and client, and 16 per membership;
  - an organization bound of members × 16;
  - closed rows and settled subscriptions kept 30 days, undeliverable events 90 days;
  - console pages of 100, up to 500.
- Why: to fix unbounded growth and a membership oracle (F-01, F-06).
- Source: "Organizations wargame fixes (F-01–F-07)".
- Safe alternative: none recorded.
- Owner: ___

**OB-22. Claim escalation while the owner's hold is objected**
- Decided: a lapse claim whose deadline passes while the owner's hold is objected goes to an operator instead of taking effect.
- Value: it closes after 30 days with refunds.
- Why: an objecting admin could otherwise seize a held owner's organization (F-03).
- Source: "Organizations wargame fixes (F-01–F-07)".
- Safe alternative: refuse the claim outright (escalating was chosen over refusing).
- Owner: ___

**OB-23. Invitation preview and withdrawal**
- Decided: invitations get a server-validated preview and an admin withdraw action.
- Value: a uniform `not_found` for every case the caller could not accept now.
- Why: the join screen could not name the organization.
- Source: "Organizations wargame fixes (F-01–F-07)".
- Safe alternative: none recorded.
- Owner: ___

**OB-24. Organization display names are visible to signed-in users (open question)**
- Decided: any signed-in user can see a local organization's display name by its identity URI.
- Value: a provisional judgement.
- Why: organization identity documents are public anyway.
- Source: "Org discovery, request discovery, org-context apps and preferences; ORG-6a review fixes".
- Safe alternative: none recorded.
- Owner: ___

**OB-25. Organization app removal**
- Decided: an organization's clean app removal follows an admin-notified delay.
- Value: 24 h. This was chosen over a second-admin gate for H3.
- Why: one admin could otherwise trigger app-side deletion of organization data.
- Source: "2026-10-22 — App removal design…"; "2026-10-22 — Refunds, ownership transfer…".
- Safe alternative: a second admin's approval.
- Owner: ___

**OB-26. Organization identity and certificates** *(user decisions; ledger lines blank)*
- Decided: an organization is a full identity with a recovery file issued at creation. The issuer chooses the certificate lifetime and discloses it.
- Value: 660 s default (about 11 minutes), configurable per organization. The recovery file is reissued on an owner change.
- Why: user decision.
- Source: "2026-10-22 — User decisions: Parley data on deletion, org identity, certificates, naming"; "2026-10-22 — Organizations rev 5…".
- Safe alternative: none recorded.
- Owner: ___

### ORG-10 and ORG-11 relations (design only)

Source for every item below: "2026-10-24 — ORG-10 relations design", and organizations design §8b.9 (rev 5.6; spec rev 4.5). It is design only: no code, no tests, nothing routed. The design's own IDs are kept in each title. Its "RL-n" labels are relation decisions and are unrelated to this file's region/legal RL prefix.

**Phasing note.** Design §13.3 puts ORG-10 (same-provider relations) in phase C, before the first external organization. It puts ORG-11 (cross-provider relations) in phase D, after the egress gate, artefact-reference caching and clean-room conformance. The request called this phase B work. RL-1 proposes that implementation start now behind the default-off flags `ORG_RELATIONS_ENABLED` and `ORG_FOREIGN_RELATIONS_ENABLED`, with the phase gates unchanged.

Already settled by the user and not repeated here: relations as relationships between organizations, the public relation document, per-edge consent from both sides, partial membership, and no central host.

**OB-27. ORG-10 RL-1: phasing**
- Decided: implementation starts now behind default-off flags, and the §13.3 release gates stay (ORG-10 in phase C, ORG-11 in phase D).
- Value: `ORG_RELATIONS_ENABLED` and the kill switch `ORG_FOREIGN_RELATIONS_ENABLED`, both default off. Narrowing is never gated.
- Why: the user's own companies can use `group` and `supply` on one host first, without loosening any cross-provider gate.
- Safe alternative: wait for phase C/D before implementing (implied by the phase labels; not recorded as an option).
- Owner: ___

**OB-28. ORG-10 RL-2: any admin establishes relations**
- Decided: any admin whose governance is not held can establish a relation. There is no subject-first step, no owner elevation and no delay.
- Value: a fresh step-up, full matrix disclosure, notice to every admin and an audit entry.
- Why: a relation changes no member's grant-management grant and no control. It is the same act as approving an integration.
- Safe alternative: owner approval for every outward edge, or a notified delay before an edge goes live. Both were rejected in §8b.8. Owner approval is kept as a possible per-organization setting later.
- Owner: ___

**OB-29. ORG-10 RL-3: narrowing is immediate**
- Decided: any admin can narrow a relation at once, with no consent.
- Value: suspend, end, decline, leave and withdraw.
- Why: narrowing is always safe, and it is the remedy against a rogue admin's edge.
- Safe alternative: none recorded.
- Owner: ___

**OB-30. ORG-10 RL-4: counterpart authority reset**
- Decided: when a counterpart has an authority reset, its outgoing edges are held until an admin confirms. An automatically adopted, attested move gets a lighter hold.
- Value:
  - Full-hold triggers: an `aep` increase, a key reset without continuity, an unattested or hand-adopted move, or a contested identity. The confirmation is bound to that `aep`.
  - An attested move: write-capable methods are refused for 72 h, with notice to admins, or until an admin confirms.
  - No relation event releases any hold.
- Why: relations are low-churn, so confirming is cheap. A thief holding the current recovery file can make an attested move after a 7-day public wait (review RL-R1-H3).
- Safe alternative: a full hold on attested moves too. It was rejected as stalling ordinary moves.
- Owner: ___

**OB-31. ORG-10 RL-5: relation event signing**
- Decided: relation events are signed with the sending entity's certification key. They have their own type registry, generation ordering, cache-only verification and daily anti-entropy (spec §9.9).
- Value: `typ` `bindle-relation-event+jwt`. This departs from the `typ` RFC 8417 recommends and keeps the RFC 8935 media type.
- Why: the key is already discoverable, and the `typ` separates events from certificates and intents.
- Safe alternative: the issuer's brokering key set, rejected in §8b.8.
- Owner: ___

**OB-32. ORG-10 RL-6: issuer-level events endpoint**
- Decided: the endpoint comes only from the validated manifest, never from a response or an identity document.
- Value: `relations.v1` `events_endpoint`.
- Why: it closes an SSRF path and settles part of AMD-O10.
- Safe alternative: none recorded.
- Owner: ___

**OB-33. ORG-10 RL-7: fresh-only participation statements**
- Decided: participation statements are fresh-only, not revocable.
- Value: 300 s.
- Why: there is no new state, and a provider cannot be made to present a stale statement.
- Residual: a recovery-file holder can sign fresh statements outside the provider until the key rotates. The statements confer nothing.
- Safe alternative: sign statements with the certification key, which closes the residual now.
- Owner: ___

**OB-34. ORG-10 RL-8: no transparency log for ORG-11**
- Decided: ORG-11 needs no transparency log.
- Value: each instance pins the relation digest.
- Why: per-instance digest agreement already stops parties from disagreeing. Revisit if relations gain automation that advances the head.
- Safe alternative: a transparency log before ORG-11, rejected in §8b.8.
- Owner: ___

**OB-35. ORG-10 RL-9: no public bilateral attestation**
- Decided: the public bilateral attestation stays deferred, and no relation is published anywhere.
- Value: none.
- Why: privacy first. It would publish business relationships. Revisit on demand.
- Safe alternative: none recorded.
- Owner: ___

**OB-36. ORG-10 RL-10: organization moves and relations**
- Decided: when an organization moves, its outgoing edges arrive suspended and an admin re-binds them. Incoming edges survive. Imports update in place.
- Value: imports are keyed by origin principal, instance and entry.
- Why: it follows portability §11 (re-consent when identifiers change) with the least churn for counterparts.
- Safe alternative: none recorded.
- Owner: ___

**OB-37. ORG-10 RL-11: limits**
- Decided: these are starting limits for 3sln.me.
- Value:
  - 300 invitations a day per organization;
  - 3 per inviter and invitee pair per 30 days, and one pending per pair;
  - 256 pending inbound items per organization, after which new items are refused and admins told;
  - 10 introductions a day per proposer and receiver, plus muting;
  - 256 live instances and 1,024 live incoming edges per organization, until measured.
- Why: a group of 64 subsidiaries or a buyer with 256 suppliers fits in one day, and filling a target's inbox needs 256 paid organizations.
- Safe alternative: none recorded.
- Owner: ___

**OB-38. ORG-10 RL-12: introductions**
- Decided: an organization can be introduced only if it has a live edge to the proposer in that instance, or asked to be introduced.
- Value: none.
- Why: to avoid disclosing a candidate's dealings without cause.
- Safe alternative: none recorded.
- Owner: ___

**OB-39. ORG-10 RL-13: who sees relations**
- Decided: admins see all relations. Other members see only the imports they hold grants on.
- Value: none.
- Why: relations are governance-level information.
- Safe alternative: none recorded.
- Owner: ___

**OB-40. ORG-10 RL-14: first catalogue**
- Decided: the first relation documents are published under a reserved `.example` placeholder until publication authority is agreed. The catalogue says "listed by 3sln.me", never "verified publisher".
- Value: `share`, `group`, `supply` and `accounting-engagement`.
- Why: it follows AGENTS.md on `.example` domains and keeps "publisher unverified" truthful.
- Safe alternative: none recorded.
- Owner: ___

**OB-41. ORG-10 RL-15: one code path**
- Decided: same-host redemption and events use the same statement and event ports as cross-provider ones. Only the transport differs.
- Value: none.
- Why: ORG-11 then adds transport, not semantics, and ORG-10 tests exercise the interop rules.
- Safe alternative: none recorded.
- Owner: ___

**OB-42. ORG-10 RL-16: entity-certificate lifetime**
- Decided: entity certificates on 3sln.me are shorter-lived than member certificates.
- Value: 300 s. Member certificates stay at 660 s.
- Why: entity certificates are cheap to re-issue, and a shorter lifetime bounds revocation on the grantee side, which the grantor cannot see.
- Safe alternative: none recorded.
- Owner: ___

**OB-43. ORG-10 RL-17: only organizations are relation parties on 3sln.me**
- Decided: on 3sln.me v1, only organizations can create, join or be invited into relations. The spec keeps `person` in `kinds` for sole traders.
- Value: none.
- Why: it follows the user's "relations are relationships between orgs" without narrowing the spec for other providers. Revisit if sole traders ask for it.
- Safe alternative: none recorded.
- Owner: ___

**OB-44. Q21: the relations design as a whole**
- Decided: Q21 asks the user to accept the provisional decisions RL-1 to RL-17 above, with the design and spec rev 4.5 changes they rest on.
- Value: the spec changes are:
  - relation events (§9.9);
  - fresh-only participation statements;
  - invitation withdrawal;
  - instance identifiers with at least 122 random bits;
  - a privacy item, conformance tests and checkpoint O7.
- Why: the coordinator's recommendations are in §8b.9. A forked adversarial review (RL-R1: 3 High, 8 Medium, 6 Low) was applied.
- Safe alternative: none recorded.
- Owner: ___

### ORG-12d support adjudication

Source for every item below: "2026-10-24 — ORG-12d support adjudication", including its review follow-ups and wargame 4 admin items, unless an item names another. Everything is behind `ORG_BREAK_GLASS_ENABLED` (default off) and runs on loopback fixtures, a local WebAuthn verifier and the offline Polar model. The DEVLOG marks every item provisional.

**OB-45. ES256 operator assertions, keys held by the admin service (custody residual)**
- Decided: operator assertions are signed with ES256 (ECDSA P-256) instead of the HMAC shared secret. The admin service generates and holds the key pair, and the organization writer only verifies.
- Value:
  - the private JWK is kept sealed under `KEY_ENCRYPTION_KEY` in the admin store, with the same AES-GCM sealing as the identity key registry;
  - the sealing is bound to its purpose (`operator-signer/<kid>`) through the AES-GCM additional data;
  - the writer verifies with the published `operator-key/<kid>` and never reads the private key;
  - without `KEY_ENCRYPTION_KEY`, nothing is issued (`operator_assertions_unavailable`, 503);
  - the assertion is `oa1.<payload>.<signature>`, covers a domain-separated scope, and lasts 5 minutes;
  - it is registered in the same admin-store commit as the audit intent, so nothing is valid before that commit;
  - it is single use host-wide, checked against a registry row under the store's revision check, with the engine's per-process nonce list as a second check;
  - the verifier re-checks that the operator still holds the capability (administrator role plus `support.org-break-glass`, no hold);
  - internal provenance and active status are checked at issue, at most 5 minutes before verification;
  - account objects receive only `narrowAdminStore(...)`, bound to the calling organization.
- Why: it replaces the HMAC shared secret in production wiring, and the verified-operator-identity gate needs a real signer.
- Residual: the admin service and the account objects share one deployment and one secret environment, so the separation is logical, not a hard trust boundary. In the Worker, the `ADMIN_AUTHORITY` binding is still present in every isolate's environment. The narrowing is in what the account code is given, not in the platform's bindings. Production still needs a key custody review, rotation tooling, real WebAuthn evidence and an operator onboarding procedure.
- Safe alternative: none recorded. The HMAC double stays only as a test double for older suites.
- Owner: ___

**OB-46. Rotate on retire**
- Decided: when the current signing key's published key is retired or missing, the next issue generates a new key rather than failing.
- Value: the new key replaces `operator-signer` under compare-and-swap on its revision, audited as `operator-key.rotate`. A retired key (`retiredAt`) stops verifying. There is no other rotation tooling.
- Why: after a key was retired, the signer kept issuing with it (review L4).
- Source: "ORG-12d support adjudication" (deviation 5; review follow-up L4).
- Safe alternative: none recorded.
- Owner: ___

**OB-47. Operator daily decision limit, and refused decisions still spend quota**
- Decided: each operator may issue a limited number of decisions a day, and a decision the writer later refuses still counts.
- Value:
  - 20 decisions per operator in a fixed 24-hour window;
  - it is spent in the same commit as the per-actor window, and `AdminStorage.commit` checks all windows before spending any;
  - every issued assertion counts, including those the writer later refuses;
  - an assertion is spent when the writer's verifier accepts it, before the writer's own rules run, so a refused decision still uses one assertion and one of the 20;
  - the admin service refuses early, from the current view, an operator's own pending proposal and a barred operator's proceed, which saves an assertion;
  - at the cap the answer is `decision_limit`, with nothing forwarded;
  - lapse reasons are capped at 280 characters, and a bad note never spends an assertion.
- Why: the entry gives no reason beyond the limit itself, which it marks provisional.
- Source: "ORG-12d support adjudication" (daily limit; readings and deviations 3; review follow-ups L1 and reading 2).
- Safe alternative: none recorded. Refunding quota on writer refusal is not recorded as an option.
- Owner: ___

**OB-48. Flag gate: uphold is exempt, and the gate covers the seizing direction only**
- Decided: while `ORG_BREAK_GLASS_ENABLED` is off for the organization, `proceed`, `reject` and lapse `proceed` answer the uniform 404. `uphold`, the queue, the case view and the safe direction (`acknowledge`, `note`, `abort`, lapse `close`) are not gated.
- Value: `ORG_CASE_GATED` = proceed, reject. Uphold stays a two-operator decision.
- Why: following §12d.12 and the flag registry's reason that support holds are never gated. Upholding a contest restores the former owner, a safe direction a kill switch must never block. Rejecting leaves the break-glass owner in place, so it stays gated.
- Source: "ORG-12d support adjudication" (flag gate; readings 2 and 4; review follow-up M2).
- Note: the DEVLOG says this narrows the instruction "flag-gate the routes", and asks for review.
- Safe alternative: gate uphold too (the state before review follow-up M2), which would block the reinstatement remedy while the switch is off.
- Owner: ___

**OB-49. Operators: administrator accounts, passkey-bound decisions**
- Decided: operators are administrator accounts, never boot. Each decision needs its own passkey assertion, bound to that decision.
- Value:
  - operators hold the capability under the console's passkey-only step-up (15-minute read window, 5-minute mutation window);
  - `OPERATOR_CAPABILITY` is boot-assignable only and never delegable, and a catalog that classifies it as user class or delegable is invalid;
  - `POST /api/admin/org-cases/challenge` stores a digest of the decision and a 5-minute expiry, and the decide route consumes it in its intent commit;
  - an operator racing two decisions holds one bound challenge at a time;
  - boot is refused with `operator_capability_required`.
- Why: no single operator, and no stolen session, should be able to seize an organization (§12d.8).
- Open: the two-person rule holds only if boot onboarding binds each operator account to a distinct human and a distinct authenticator. The DEVLOG's gate table lists this as open and procedural.
- Source: "ORG-12d support adjudication" (operators; capability; review follow-up L7; before production).
- Safe alternative: none recorded.
- Owner: ___

**OB-50. Operator proposals: cancellation and approval**
- Decided: a proposal by an inactive operator (revoked, held or suspended) stops counting as one of the two operators.
- Value:
  - before approving, the writer re-verifies the pending proposer, cancels an inactive proposer's proposal with the organization audit entry `organization-support-proposal-cancelled` (reason `proposer-inactive`), and the call becomes a new proposal. If the proposal changed in between, the call is refused with `conflict`;
  - the admin service remembers each operator's pending proposals (`operator-proposals/<operator>`, the 72 h approval window, at most 32) and cancels them when boot revokes the capability or suspends the operator;
  - a catalog change that removes the capability from a role is not cancelled proactively, and the approval-time re-check covers it.
- Why: a revoked or held operator's proposal had still counted as one of the two operators (review M1).
- Source: "ORG-12d support adjudication" (review follow-up M1; readings 1).
- Safe alternative: none recorded.
- Owner: ___

**OB-51. Reason text handling**
- Decided: the organization and claimants see only a digest of a decision reason. The text stays in an admin-only note.
- Value:
  - the admin service forwards only `reasonDigest` (SHA-256) to both writers, and the organization audit carries only the digest;
  - the text is stored in `org-case-note/<sha256>`, written in the same commit as the decision's audit intent, and shown to operators in the operator audit;
  - the notes row is plain within the admin store, not sealed, and identical text shares one row, which keeps its first author and context;
  - reasons are 10–500 characters, 280 for lapse claims;
  - the console says: "The organization sees only a digest. The text stays in an admin-only note that operators read in the operator audit."
- Why: a lapse-claim reason had reached the claimant (review M3), and the text was otherwise kept nowhere (L2).
- Source: "ORG-12d support adjudication" (decisions; review follow-ups M3, L1, L2; reading 3).
- Safe alternative: none recorded. Sealing the notes row is not recorded as an option.
- Owner: ___

**OB-52. ORG-12d readings and deviations from the plan**
- Decided: the implementation departs from the plan in small ways.
- Value:
  - the routes live in `packages/runtime/admin-org-cases.mjs` beside `admin-flags-http.mjs`, not under `routes/`;
  - excluding every channel answers `invalid_exclusion` before `last_channel` when some channel was never excludable (the writer's existing order);
  - only live cases sit under `org-case/<org>`, a closed case's row is deleted, and the highest applied sequence is kept in `org-case-seq/<org>`;
  - rows are routing only, and the admin service confirms every case with the writer before showing or deciding;
  - `org-cases.audit` scans at most 1,000 entries per page;
  - the case view carries no addresses and no statement text.
- Why: engine and console reasons recorded in the entry.
- Source: "ORG-12d support adjudication" (readings and deviations 1 and 6; queue; review follow-up L3).
- Safe alternative: none recorded.
- Owner: ___

### ORG-10 relations implementation (ORG-10a to ORG-10g)

Source for every item below: "2026-10-24 — ORG-10a-c relations core (flags off)", "2026-10-24 — ORG-10d/e entity certificates and relation events (flags off)" and "2026-10-26 — ORG-10f/g relations routes and console (flags off)", including their review follow-ups, unless an item names another. This is the implementation of the design items above (OB-27 to OB-44). Everything is behind `ORG_RELATIONS_ENABLED` and `ORG_FOREIGN_RELATIONS_ENABLED` (class a, default off), on loopback hosts of several organizations. No foreign transport exists. Every item is a coordinator decision or reading, not signed off.

**OB-53. Relation lifecycle readings that go beyond the spec or limit v1**
- Decided: several readings of spec §9 were chosen to make the engine converge, and are flagged for spec review.
- Value:
  - when a counterpart ends a half, this side ends its matching half too, and a counterpart no longer recognized in a view is told "ended" for any half this side never held. This goes beyond §9.6's "for each half it held". The chaos suite needs it to converge when a grant event was lost before the end;
  - an ended counterpart cannot be re-invited into the same instance: an ended half is final per (instance, pair), so a later relationship needs a new instance (M7, "to be confirmed against spec §9.9");
  - v1 allows one counterpart relationship per pair per instance in a view (a second invitation is refused as `relation_counterpart_exists`), though an organization may hold several slots in an instance (L19);
  - `relations.resume` is treated as widening (flag and step-up), although design §8b.10 lists it with the narrowing actions;
  - an invitation or acceptance that would neither share nor receive is refused;
  - there is no `artefact-store.mjs` kind registration and no `packages/links` registration; the growth table lives in `relationAdditive`.
- Why: convergence under lost events, and the smallest change that keeps the consent rules.
- Source: "ORG-10a-c relations core" (provisional decisions and readings; review M7, L19).
- Safe alternative: none recorded.
- Owner: ___

**OB-54. Open invitations are withdrawn when the issuer or organization is no longer in good standing**
- Decided: redeeming an invitation is refused uniformly (`invitation_invalid`) unless the inviting organization is `active` with no organization-level hold and the issuing admin is still an unheld live admin.
- Value: scheduling deletion withdraws every open relation invitation. An issuing admin who is removed, leaves or is held has their open invitations withdrawn. An organization-level hold refuses redemption. A bounded per-commit hook (`commitHooks` in `packages/orgs/memberships.mjs`) does it, and the sweep finishes any remainder.
- Why: an invitation was redeemable while the inviter was being deleted (review M1).
- Source: "ORG-10a-c relations core" (review follow-up M1, labelled "Provisional decision (coordinator, unsigned)").
- Safe alternative: none recorded.
- Owner: ___

**OB-55. Key refresh runs only for recognized counterparts (deviation from spec §9.9 step 3)**
- Decided: `relations.ingest` and `relations.authorize` schedule a background key refresh for a missing key only for a sender recognized in the named instance. The spec says to schedule the refresh "exactly as for a non-counterpart".
- Value:
  - the runtime's background run drops a request-path (`claimed`) queue row of a sender recognized nowhere in the organization's view, without a fetch;
  - the cold-key retry inbox buffers an event only for a claimed sender that is a counterpart (any state but ended) in the named instance: at most 8 rows per sender, 64 in all, five retries and 5 minutes' retention, 32 KiB each. The answer is the same 202 either way;
  - the DEVLOG flags it for spec review. It also departs from the last clause of invariant C7 in design §8b.10.
- Why: strangers could fill the inbox and starve the counterpart refresh (review R3-L1). On this host a refresh is a local read, so nothing reaches an issuer.
- Must be revisited **before ORG-11**: once foreign issuers are fetched, a fetch made only for counterparts would reveal them to the claimed issuer.
- Source: "ORG-10f/g relations routes and console" (review follow-up R3-L1).
- Safe alternative: the earlier engine policy refreshed for any claimed sender, which matches the spec and starved the counterpart refresh behind strangers' rows.
- Owner: ___

**OB-56. Counterpart key cache of 300 s**
- Decided: a revoked or rotated counterpart certification key stops verifying within about 300 s.
- Value:
  - `KEY_CACHE_MS` drops from 1 h to 300 s, refreshed at half-life, so the bound is about 300 s plus at most one background run (design §8b.4's key-revocation bound);
  - at most 128 refreshes per alarm run, and a cursor over `rel/cp/` (1,024 rows a run, then it wraps) so every counterpart is reached;
  - key-cache rows not refreshed for a whole cache period are pruned;
  - ended counterpart records are kept, because an ended pair is final per instance.
- Why: to match the revocation bound. Same-host refreshes are local reads, so the cost is a bounded number of reads per alarm run. Foreign issuers will make each refresh a fetch (see OB-55).
- Source: "ORG-10f/g relations routes and console" (review follow-up R3-L4).
- Safe alternative: none recorded; 1 h was the earlier value.
- Owner: ___

**OB-57. Entity certificate readings and wire extensions**
- Decided: the entity certificate profile makes several readings of spec §9.5 and §9.9, flagged for spec review.
- Value:
  - `scope` is an optional top-level member, although §9.5 says "exactly these members";
  - a prefix scope is checked as given and fails closed: a call naming neither a `key` nor a `prefix` inside it is refused, and presign is refused;
  - write-capable methods are everything outside a read list (get, list, read, status, describe, capabilities, head, subscribe, unsubscribe), until a `writeCapable` port takes contract metadata;
  - organization-context certificates carry `actor:{client}` only, with methods = application ∩ edge;
  - an optional `replaces` member on entry resources (the earlier resource ID) is a **provisional wire extension**. The grantee keeps an import id only when the grantor marks a one-for-one replacement with it, and any other change of resource mints a new id, so member grants never carry over to a different resource;
  - the `aep` baseline is taken from `counterparts.resolve().aep` at activation, and a first sighting with no baseline is recorded without a hold.
- Why: the spec tables did not cover these cases.
- Source: "ORG-10d/e entity certificates and relation events" (provisional decisions and readings; review follow-up L5).
- Safe alternative: none recorded.
- Owner: ___

**OB-58. RL-4 holds: what a hold allows, and the 72 h residual**
- Decided: policy details of holds on a counterpart's authority reset.
- Value:
  - under a write-only hold (an attested move) widening events are still honoured and only write-capable calls are refused. Under a full hold nothing widening is;
  - imports from a held counterpart are marked and stay certifiable;
  - while the grantor is fully held, `relations.certify` drops write-capable methods and keeps reads, and refuses if nothing readable is left (L6);
  - `relations.confirm-counterpart` is a widening action (flag, unheld admin, fresh step-up, billing active) and is bound to exactly the held `aep`;
  - confirming a hold restarts the generation floor of every mirror of that counterpart's halves at 0 (an end stays final);
  - **residual:** the write-only hold on an attested move releases automatically after 72 h. A thief who makes an attested move with a stolen current recovery file, and is not noticed by an admin within 72 h, regains write access through the edges.
- Why: the DEVLOG calls the residual "the user's RL-4 trade-off to confirm".
- Source: "ORG-10d/e entity certificates and relation events" (provisional decisions; review follow-ups L1, L6; residual).
- Safe alternative: none recorded.
- Owner: ___

**OB-59. Introductions: freshness, rate and expiry**
- Decided: `relations.introduce` (RL-12) receipt rules.
- Value: an introduction whose statement is older than 300 s at receipt is dropped, and the proposer introduces again. Anti-entropy does not re-send introductions. Receivers deduplicate per (instance, proposer, slot, candidate), allow 10 a day per proposer, share the 256-item inbound bound, drop muted proposers silently, record nothing while the flag is off, and expire items after 30 days. The sweep prunes day counters older than today and `rel/introduced/*` records older than 30 days.
- Why: outbox retries must not carry stale statements.
- Source: "ORG-10d/e entity certificates and relation events"; its review follow-up L7.
- Safe alternative: none recorded.
- Owner: ___

**OB-60. Lifecycle effects on relations (billing, deletion, unreachable counterparts, own move)**
- Decided: how organization lifecycle states act on relations (design §8b.6).
- Value:
  - `read-only` refuses write-capable methods and widening. `export-only` suspends outgoing grants with cause `billing`, and `active` restores exactly those with a new generation;
  - deletion: the pre-purge leaves every instance and stops certification. `relations.purge-ready` reports ready when the instance counter is zero, the cursor is exhausted, and the final events are delivered or 72 h have passed. A configured `ORGANIZATION_PURGE` is held until then;
  - delivery failures are never treated as revocation. After 30 days an unreachable counterpart is flagged on the console and every admin is told once;
  - the organization's own move (RL-10) suspends outgoing grants with cause `moved`. `relations.resume` refuses them (`relation_rebind_required`) and `relations.rebind` (widening) re-binds from the destination pool;
  - a key compromise gives every outgoing grant half a new generation;
  - left participations are deleted 30 days after leaving, with their counterpart records, imports and mirrors.
- Why: design §8b.6 and the review fixes (M1, L2).
- Source: "ORG-10d/e entity certificates and relation events"; "ORG-10f/g relations routes and console" (adapter gate 5).
- Safe alternative: none recorded. Production purge is still an injected integration, not a verified executor.
- Owner: ___

**OB-61. Holder public keys are stored on sessions and access records**
- Decided: verified DPoP proofs supply `{kty,crv,x,y}` to sessions and access records, so DPoP and member tokens can issue relay certificates. Refresh retains or backfills the public key. No private key material is stored.
- Value: Bearer-only access without a certified holder stays unavailable for relay imports. A relay token whose session key is unknown reports the import `unavailable`. The member-access holder JWK is kept only when its thumbprint equals the token's `jkt`.
- Why: entity certificates bind the holder key, and federation tokens had stored only a thumbprint.
- Source: "ORG-10f/g relations routes and console" (adapter gate 4; review R3-L3); "ORG-10d/e entity certificates and relation events".
- Safe alternative: none recorded.
- Owner: ___

**OB-62. Relation upgrade is a replacement-instance invitation**
- Decided: a newer additive full pin issues a replacement-instance invitation through the existing consent and acceptance machinery. Previous edges stay unchanged until an admin ends them. This is the design's "upgrade, or a new instance" alternative, **not** normative same-instance per-edge migration.
- Value: tests use a synthetic newer version; the shipped catalogue has none. Same-instance upgrades and their dedicated activity queue are unimplemented, and design §8b says so.
- Why: the engine had no upgrade operation and events carry no per-edge pin migrations.
- Source: "ORG-10f/g relations routes and console" (provisional decisions).
- Safe alternative: same-instance per-edge migration (the design's normative route, unimplemented).
- Owner: ___

**OB-63. Shipped relation catalogue and inspection-only export**
- Decided: the console ships four relation pins on reserved `relations.3sln.example` URLs (share, group, supply, accounting engagement), version 1, publisher explicitly unverified. URL selection resolves only those pins. Export is a paged inspection export of whitelisted relation records, excluding sessions, proofs and key caches. It is not an authority-restoring import.
- Value: arbitrary document fetch and cross-provider transport remain ORG-11. Participation restoration and foreign interoperability remain ORG-11b/c. English and Spanish strings were added to `packages/i18n/catalogues.mjs`.
- Why: the `.example` domains keep examples reserved until publication authority is agreed.
- Source: "ORG-10f/g relations routes and console" (provisional decisions).
- Safe alternative: none recorded.
- Owner: ___

**OB-64. Relations with the flags off: what still works**
- Decided: narrowing is never flag-gated, and ingest stays ungated for existing edges.
- Value: signed inbound revocation, narrowing, leaving and paged admin export stay reachable with both flags off. Widening, including `relations.confirm-counterpart` and `relations.resume`, needs the flag, a fresh step-up and an unheld admin. While `ORG_RELATIONS_ENABLED` is off, widening events are dropped and narrowing still applies. Offers are not recorded while the flag is off (L16). Unknown public targets answer uniformly. `relations.v1` is declared only for an explicitly mounted foreign transport, so no adapter advertises it on flags alone.
- Why: existing edges must be revocable, and a counterpart may resume them while the flag is off.
- Source: "ORG-10a-c relations core" (left open L16); "ORG-10f/g relations routes and console" (adapter gate 6; review R3-L3).
- Safe alternative: none recorded.
- Owner: ___

**OB-65. Relation work deferred, and production gates added**
- Decided: these are not built, and the gates are recorded for later.
- Value:
  - not built: the entity-certificate status endpoint (the write age rule applies alone), brokered tokens for integration-hosted grantor resources, failure rate limits on `relations.authorize`, doorbell forwarding and the `packages/events` `entity` reader, same-instance upgrades, export import (ORG-11b), cross-provider transport (ORG-11a);
  - the sweep's per-family scans were bounded to 256 rows without a cursor until the tick scheduled them; ORG-10e's `relations.tick` now schedules it;
  - gates added to design §8b.10: ORG-10f adapters take the sending organization only from verified evidence; the storage adapter must receive the composed scope (production gate 3, done locally in ORG-10f); the RL-4 hold and invariant C8 must exist before relations are enabled for any organization (implemented locally in ORG-10e).
- Why: scope control, and no production verification is inferred from local tests.
- Source: "ORG-10a-c relations core" (review follow-ups); "ORG-10d/e entity certificates and relation events" (not in this pass); "ORG-10f/g relations routes and console".
- Safe alternative: none recorded.
- Owner: ___

### Break-glass and ownership outbox scaling

Source for every item below: "2026-10-24 — Break-glass and ownership outbox scaling", including its review follow-ups. Local adapter behaviour, behind the organization and break-glass flags. Probes are local.

**OB-66. Hinted admins are now the longest-tenured**
- Decided: when more than 14 admins are eligible, the admins hinted for a break-glass claim are the longest-tenured, instead of the first by principal key. Who is eligible does not change.
- Value: `eligibleAdmins` reads the provider's unbounded index up to `since − 30 days`, oldest first, and stops at `HINTS+2` rows (hints go to at most 16 people, and quorum needs two eligible admins). `quorumMet` stops at the second eligible signer. Every candidate row is still checked with the unchanged `eligibleAdmin`/`memberPowers` predicates.
- Why: all-admin organizations at 5,000 admins were rejected with `organization_row_limit`. The DEVLOG lists the hint order as the one "visible difference".
- Source: "Break-glass and ownership outbox scaling" (eligibility and quorum).
- Safe alternative: none recorded. The prior order was by principal key.
- Owner: ___

**OB-67. Admin summary indexes and the one-time migration**
- Decided: the roster maintains per-admin summaries and indexes in the same transaction as the membership rows (`packages/orgs/admin-index.mjs`).
- Value: `org/admin/<key>` holds `{id, since, u, f}`, with `org/admin-unbounded/…` and `org/admin-from/…` indexes, an `admin-reindex` due entry at each grant expiry, and an `admins` count and layout `ix:3` on the record. Older layouts are rebuilt once by the next roster flush, at O(admins). The probe cost was 5,008 rows, 3.08 MB and 179 ms at 5,000 admins.
- Why: probe cliff #1.
- Not addressed: the claim row's `cosigners` and `adminDomains` still grow with distinct co-signers. `MembershipService#operator`/`hasOperator` and `requests()` still read every admin.
- Source: "Break-glass and ownership outbox scaling" (admin summaries; not addressed).
- Safe alternative: none recorded.
- Owner: ___

**OB-68. Recipient fan-out above 64 admins, delivered at least once**
- Decided: a member outbox notice to at most 64 admins (`ORG_INLINE_ADMINS`) lists recipients inline. Above that it carries a cursor, and the drain delivers pages of at most 256 admins (`ORG_FANOUT_PAGE`), at most 8 pages per drain call.
- Value: the snapshot is the admins after the queuing transaction, bounded by each admin's `since`. Removed admins are kept in `org/admin-ended/` until the last older fan-out ends. A failed page retries from its cursor, and a removal racing the read can be delivered twice but is never missed. **Port contract change:** consumers deduplicate by event id plus recipient (admin) id. `ORGANIZATION_MEMBER_EVENTS` is still unwired. The event row grows about 100 B per live page, roughly 2 KB at 5,000 admins.
- Why: the all-admin notice wrote a row per admin in one commit.
- Source: "Break-glass and ownership outbox scaling" (recipient fan-out; review follow-up L3).
- Safe alternative: none recorded. The earlier "nothing is duplicated" wording was corrected.
- Owner: ___

**OB-69. Ownership outbox rows: caps and migration**
- Decided: each ownership effect is its own row (`org/effect/<id>`, `packages/orgs/ownership-effects.mjs`), and the record keeps a summary.
- Value: critical effects are never refused, and only pending rows count toward the 256 cap. At most 128 done rows are kept, for 30 days, pruned at flush. Refund idempotency, the drain lease and the provider re-read are unchanged. A record with the old `ownershipOutbox` array migrates on its next commit, or a commit the drain makes first: pending rows plus the newest 128 done rows from the last 30 days.
- Why: probe cliff #2. A 5,000-effect outbox had been one 2.5 MB record.
- Source: "Break-glass and ownership outbox scaling" (ownership outbox rows).
- Safe alternative: none recorded.
- Owner: ___

**OB-70. Break-glass review fixes: contest escalation and snapshot liveness**
- Decided: three fixes to older break-glass behaviour.
- Value:
  - contest escalation is now a table transition, `contest-escalated` (T27, effective to effective), so chaos invariant I7 (one audit entry per transition) holds. I7 was not loosened;
  - the start re-reads the owner's activity just before its commit and stores that time as `c.snapshotAt`. Liveness is `last >= snapshotAt`, so a sign-in between the snapshot read and the claim commit is not lost. Claims without `snapshotAt` keep the old rule;
  - the L3 fan-out repeat fix is OB-68.
- Why: chaos seeds 94, 128, 156 and 236 failed.
- Source: "Break-glass and ownership outbox scaling" (review follow-ups L1, L2).
- Safe alternative: none recorded.
- Owner: ___

## Messaging and conversations

**MC-1. Quarantine is silent; Beam exception left to the user**
- Decided: a quarantined link answers exactly like an active one. Deliveries land quarantined and unnotified.
- Value: Beam permission is still refused while quarantined, so a redeemed peer can infer the pause. The other inference channels are listed and accepted.
- Why: this matches contact-tokens.md.
- Source: "Messaging, search and deletion wargame fixes" (M2).
- Open: whether to hide the Beam refusal. That would mean accepting live transfers silently. "Left for the user."
- Update 2026-10-26: moot. Beam was removed from the core (provisional, unsigned), so no Beam permission exists to refuse; the remaining listed inference channels still need sign-off.
- Safe alternative: none recorded.
- Owner: ___

**MC-2. Dead contact links are reclaimed**
- Decided: revoked or expired links stop counting toward the cap and are reclaimed later.
- Value: reclaimed 72 h after death. At most 2,000 stored parents (`MAX_STORED_GRANTS`). 64 reclaimed per run. Tombstones without `exp` are kept 366 days.
- Why: dead links counted toward the 1,000 cap forever (M3).
- Source: "Messaging, search and deletion wargame fixes"; "Links, Beam, device and directory wargame fixes" (L5).
- Safe alternative: none recorded.
- Owner: ___

**MC-3. Legacy message filter semantics**
- Decided:
  - a missing `readAt` counts as unread;
  - a missing `quarantined` counts as not quarantined;
  - a wrong-typed legacy filter returns `[]`;
  - the legacy array takes no cursor.
- Value: as stated.
- Why: the catalog and scan paths must agree.
- Source: "Scalability fixes (legacy message reads, removal index, artefact history, intent index)".
- Safe alternative: none recorded.
- Owner: ___

**MC-4. Conversation outbox: fair share and dead letters**
- Decided: failing peers go to dead letters, so one peer cannot wedge a room.
- Value: dead letters after 8 attempts, expiring after 30 days (aligned to the receipt window). A room gets a quarter of the bound (at least 64) and a peer an eighth (at least 32). `BACKOFF_ALLOWANCE` is 8.
- Why: one failing peer wedged every room (C1).
- Source: "Conversations and bindlebox wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**MC-5. Conversation history, rooms and invitations**
- Decided: history, rooms and invitations are bounded and collected.
- Value:
  - 1,000 history rows per room;
  - receipts swept after 30 days;
  - removed and left rooms collected after 10 minutes plus 30 days;
  - 100 rooms, plus 10 quarantined invitations;
  - a declined room refuses re-invites until its invitation expires;
  - stale invitations are refused after an epoch or permission change.
- Why: to fix uncounted copies and stuck quotas (C3–C5).
- Source: "Messaging, search and deletion wargame fixes"; "Conversations and bindlebox wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**MC-6. BindleBox storage bounds**
- Decided: conversation storage is bounded cumulatively.
- Value:
  - 512 MiB per room and 128 MiB per author;
  - a per-author daily cap of 10,000 records and 512 MiB;
  - 16 placeholders per author, expiring after 7 days;
  - issuer refusal buckets of 20 per principal, 200 per host and 1,000 per registrable domain (a two-label approximation).
- Why: conversation bodies bypassed the hot allowance (B2).
- Source: "Conversations and bindlebox wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**MC-7. Messaging app data on account deletion** *(user decision; ledger line blank)*
- Decided: Parley is a regular app with no operator treatment. It purges its own MailboxObject state on `subject-deleted`.
- Value: required before `BINDLEBOX_ENABLED`.
- Why: user decision (R1-M12).
- Source: "2026-10-22 — User decisions: Parley data on deletion…".
- Safe alternative: none recorded.
- Owner: ___

**MC-8. Beam relay credentials**
- Decided: TURN credentials are short-lived and capped per beam.
- Value: TTL is min(300 s, the beam's remaining life). 4 re-issues. The reservation cap is 4 × the participant envelope. 16 live offers per sender.
- Why: findings D1 and D2.
- Source: "Links, Beam, device and directory wargame fixes".
- Update 2026-10-26: Beam was removed from the core. The credential lease, revoke and sweep logic survives unused in `packages/rtc/relay-credentials.mjs` for the future RTC relay occupant, which will set its own per-leg bounds; these values no longer apply to any shipped feature.
- Safe alternative: none recorded.
- Owner: ___

**MC-9. Conversation index trade-offs (BindleBox and legacy)**
- Decided: conversation reads use derived indexes that are maintained with each write and built in bounded steps. A read of an incomplete index fails instead of returning a partial page.
- Value:
  - BindleBox ordering uses a resumable materialized traversal. A late parent, an edit, a retraction or a delegation quarantine invalidates the generation, and an incomplete generation returns `conversation_index_building`, never a partially ordered or partially quarantined page;
  - replay deadlines are indexed, and legacy replay rows migrate in 32-row slices;
  - legacy dead letters have peer, oldest and expiry pointers, and replay receipts have expiry pointers;
  - one shared sweep budget covers migration, cleanup, deadlines and rooms, with continuation alarms;
  - peer recovery queues bounded redrive jobs and keeps the job while a full page or no outbox room remains;
  - collected rooms leave resumable history-cleanup jobs, and reinvitation waits for them;
  - a safe dependent-message append skips a rebuild;
  - the new families live under the existing transient `conversation/sweep/` family, and export files were left untouched.
- Why: ordering, replay expiry and dead-letter redrive scanned every row (probe cliffs #4 and #5). The trade-off is extra write-time pointers and a transient unavailable state while an index builds.
- Source: "Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" (#4, #5; review follow-ups M1, L1, L3).
- Safe alternative: none recorded.
- Owner: ___

**MC-10. Contact-delivery status: 401 versus uniform 404 (open spec question)**
- Decided: nothing yet. `docs/spec/contact-delivery.md` (S4) requires a uniform 401 for unauthenticated signed-URL or contact-bearer delivery, but the adapters (`packages/runtime/public-unknown.mjs`, `routes/delivery.mjs`) answer refused contact targets with the uniform 404 from the later uniform-unknown work.
- Value: the current behaviour is uniform 404 for refused signed contact targets. Missing or invalid OAuth credentials keep standard credential refusals.
- Why: the two rules predate each other's revision; the drift audit kept the explicit S4 text and documented the adapter boundary instead of rewriting it.
- Source: "Spec/implementation drift audit" (finding 3).
- Safe alternative: treat signed contact targets as a named exception to the uniform-404 rule (keep 404), or restore 401 for them; either way, one spec should be updated to match.
- Owner: ___

**MC-11. Beam keys re-keyed with a read fallback, then dual-written for one release**
- Decided: the generic contact-profile rows moved from `beam/` keys to neutral keys. For release v1 every write keeps both keys with one `updatedAt` stamp, the legacy row stays authoritative, and legacy rows are not deleted.
- Value:
  - the mapping is `profile` ← `beam/profile`, `contact-sharing/<grantId>` ← `beam/grant/`, `contact-redeemed/<grantId>` ← `beam/redeemed/`, `contact-redeemed-peer/<peer>/<grantId>` ← `beam/redeemed-peer/`, and `saved-contact/<linkOwner>` ← `beam/directory/`;
  - every delete removes both rows, and revocation cleanup (`links/audience.mjs`) deletes both generations;
  - the legacy row decides whether a row exists. Its content wins unless both rows are stamped and the neutral one is strictly newer. **Deviation from the coordinator's own wording:** an unstamped legacy row is never treated as older than a migrated copy, because it is the copy's source or a later rollback write;
  - the alarm path keeps reconciling one slice per alarm after the marker, so rollback writes are still copied.
- Why: "a newer row under the new key wins" was backwards for a rollback or mixed deployment with pre-removal code. A withdrawn disclosure could be silently re-enabled, and a second peer could bind the same link (review R1, Medium).
- Source: "Beam removed from core" (decisions; review follow-up R1).
- Safe alternative: none recorded. The first version of the decision (neutral keys win when newer) is the one review R1 replaced.
- Owner: ___

**MC-12. Contact `beamEnabled` dropped, not converted; Beam flags retired**
- Decided: the per-contact `beamEnabled` setting is not copied to the new keys. Contact RTC configuration will be designed with RTC (RTC-4, AMD-R5).
- Value: `BEAM_ENABLED`, `BEAM_TURN_ENABLED` and `BEAM_STUN_ENABLED` moved to `RETIRED_FLAGS` (`retiredOn 2026-10-26`) and stay in the lock fixture. The legacy sharing row keeps its stored `beamEnabled` during v1, so a rollback reads it unchanged.
- Why: the DEVLOG records it as dropped, not converted, with contact RTC configuration left to the RTC design.
- Source: "Beam removed from core" (decisions).
- Safe alternative: none recorded.
- Owner: ___

**MC-13. Contact routes no longer require a current device session**
- Decided: the device-session requirement, which only Beam needed, was removed from the contact routes. Other owner contact routes never required one. `PUT /api/contacts/{id}/beam` became `PUT /api/contacts/{id}/sharing` (body `{profileFields}` or `discloseProfile`), and the Beam RPCs were renamed (`beamContactRedeem` to `contactRedeem` and so on).
- Value: the peer index is kept, with a bounded `peerBindings(owner, peer)` lookup that no route uses yet. It was Beam's permission lookup and could be dropped later.
- Why: a device session had no purpose on contact routes once Beam left.
- Source: "Beam removed from core" (decisions).
- Safe alternative: none recorded.
- Owner: ___

**MC-14. `beam-retired-v1`: deletion of Beam data, and the deferred `beam-retired-v2`**
- **Retired 2026-10-27:** the step and its dual write were removed; the BB-CUT reset deletes the `beam/*` rows instead (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Decided: an idempotent account step (`packages/runtime/beam-retirement.mjs`, batches of 64) runs on warm and on the alarm. It copies generic rows forward without deleting them, and deletes `beam/offer/`, `beam/usage`, `beam/mailbox/`, `beam/invite/` and `beam/nearby/`. On the alarm path only, it first revokes unexpired TURN usernames within the batch budget. The marker `migration/beam-retired-v1` is written after a clean full cycle and stops only warm-path calls.
- Value: `beam-retired-v2` is **not implemented**. After a release it would reconcile once more, delete the legacy rows, read only the neutral keys, and move the export contributors to them.
- Why: the warm path never calls the TURN provider, so TURN revocation stays off the request path.
- Source: "Beam removed from core" (decisions; review follow-ups, TURN revocation).
- Safe alternative: keep the legacy rows indefinitely (current state until v2).
- Owner: ___

**MC-15. Account export gains contact-profile contributors; conflicting sharing bodies are refused**
- Decided: `beam/` was excluded from export as transient, so the profile, saved contacts and sharing grants were missing. New contributors: `profile`, `contact-sharing`, `contact-redemptions` and `saved-contacts`.
- Value: the encrypted link URL is not exported. `contact-redeemed-peer/` and `migration/` are excluded as derived. During v1 the contributors export the authoritative legacy rows, and neutral copies are listed as excluded forward copies. `profile` and `beam/profile` match only exactly. A sharing body with both `discloseProfile:false` and `profileFields` is refused (`contact_sharing_invalid`); a body is protective, and terms-exempt, only when it is well-formed and discloses no field.
- Why: a fixed export gap, and a body that disclosed fields while classified as protective (review R3).
- Source: "Beam removed from core" (decisions; review follow-ups R3, R4).
- Safe alternative: none recorded.
- Owner: ___

**MC-16. App-originated items have their own activity families**
- Decided: `packages/activity/app-messages.mjs` defines `app-message/<owner>/<id>` and `app-message-usage/<owner>`, with the record shape unchanged. `createAppNotification` writes only these families, never `message/` or `message-usage/`, and peer delivery still writes only `message/` (no dual path). The readers of both families are the messaging service, presentations, postbacks, notification eligibility, search, the retention scan, the storage quota (sum of both counters), shelving, the MCP item tools and the activity legacy adapter. The export `messages` contributor reads `message/` then `app-message/` with one projection. `notification-event/`, item-index and search IDs and the `messages/<owner>/…` blob names are kept. `packages/core/tags.mjs` is the old messaging tags module plus `ownerRules`, with the old paths re-exporting it.
- Value: app messages keep `collection` placement and owner rules, so the legacy inbox, retention units and MCP still see them (BB-CUT inventory). The reset must delete peer blobs per record, never by blob prefix.
- Why: it separates app items from peer history ahead of the Parley extraction, without a reset.
- Source: "Messaging extraction prep (no reset)" (decision 1).
- Safe alternative: none recorded.
- Owner: ___

**MC-17. `app-messages-v1` moves rows only after verification, and holds**
- **Retired 2026-10-27:** the move was removed; the BB-CUT reset deletes every `message/` row (user decision SQ-1) (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Decided: the move runs only for a `message/` row whose v1 admission attestation verifies against `APP_NOTIFICATION_PUBLIC_JWKS`, bound to issuer, owner and ID. Each move is one transaction that adjusts both counters by `size + presentationBytes`; an existing target is never overwritten; without a usable key set nothing moves. Unverifiable rows stay in `message/` as peer history. The warm path runs one 64-row slice per call until the marker exists; the alarm path runs one slice per alarm even after the marker (a rollback to pre-move code could write app rows into `message/`). After the marker, the alarm starts a new reconcile pass at most once a day. The pass does nothing while the account is `shelved` or while `export/active` exists, and a warm restore of `message/` rows deletes the marker, cursor and reconcile time.
- Value: batches of 64 rows, one reconcile pass a day (`migration/app-messages-v1-reconciled-at`). The activity legacy adapter merges both families in item-ID order with one ID cursor (the old `a.`/`m.` cursors are still accepted). `MessagingService.receive` and `ContactDeliveryService` check the account caps against both counters (`storedItems`); only the legacy counter is written.
- Why: review F2 (the marker is not a completion signal), F4 (export duplicates, adapter races), F5 (peer-delivery caps) and F6 (post-marker reconcile).
- Source: "Messaging extraction prep (no reset)" (decision 1; review follow-ups F2, F4, F5, F6).
- Safe alternative: none recorded.
- Owner: ___

**MC-18. The BB-CUT reset deletes only positively peer rows; unverifiable app-shaped rows are held**
- **Superseded 2026-10-27:** the reset is a plain delete of every legacy family; the JWKS/`APP_ORIGIN` release gate no longer applies (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Decided: the reset deletes only rows that are positively peer rows. Rows with the v1 purpose and a matching owner and ID that do not verify (unknown kid, changed issuer) are held and reported for operator review, never deleted. The reset runs its own full verify-and-move pass inside the reset step and never gates on the marker.
- Value: release gate: keep retired kids in `APP_NOTIFICATION_PUBLIC_JWKS` (within its 8-key bound, since a larger set is rejected outright) and keep `APP_ORIGIN` unchanged until BB-CUT; any account with a non-zero count is reviewed first. Diagnostic: `migration/app-messages-v1-diag` holds `{unverifiedAppShaped, pending, completedAt}` from the last full pass.
- Why: deleting a row that was really an app message after a key or origin change would be irreversible loss (review F3). This amends messaging-extraction §4; it does not confirm the reset (SQ-1).
- Source: "Messaging extraction prep (no reset)" (review follow-ups F2, F3).
- Safe alternative: none recorded.
- Owner: ___

**MC-19. Developer contact through the messaging occupant (`DEVELOPER_CONTACT_MODE`)**
- **Superseded 2026-10-27:** occupant is the only route; `DEVELOPER_CONTACT_MODE` and the legacy grant were removed (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Decided: `DEVELOPER_CONTACT_MODE` is `legacy` (default, unchanged) or `occupant`, as config rather than a flag because it selects a deployment's route. When the developer account's messaging-ingress occupant issues or rotates a messaging contact link with the developer policy, `account/links.mjs` records `developer-contact/occupant-v1`, the capability URL sealed with `KEY_ENCRYPTION_KEY` under its own purpose. In occupant mode `GET /api/developer-contact` hands out that link only if it still verifies, carries the developer policy and was issued by the seat that holds the slot today (otherwise `contact-unavailable` or `occupant-changed`), and answers `{mode:'occupant', intent:'send-message', …}` with no legacy grant. The pointer is recorded only when the mode is `occupant`; since the account cannot see its own handle, any account's occupant can leave a pointer there, and only the configured developer account's pointer is served. The console button "Write with your messaging app" uses the intent router and shows only when intents are available, with the en and es link copy otherwise. `cleanupDailyDeveloperGrants` is kept.
- Value: as stated.
- Why: it lets the developer contact go through whichever app holds the slot, without the legacy path.
- Source: "Messaging extraction prep (no reset)" (decision 3; review I1, I2).
- Safe alternative: keep the legacy path (the default).
- Owner: ___

**MC-20. Core-scope classification (provisional)**
- Decided: Beam and legacy peer messaging are removed from core (class A). Kept in core (class B): the activity centre, notifications and push; device names; intents, links and the MCP/WebMCP adapters; Google Drive, the email bridge, the classifier and embeds; the loopback demo. Three owner questions (class C) are SQ-2 to SQ-4. Apps get the RTC signaling extension for calls and data transfer instead of a core feature.
- Value: the audit ran at HEAD 2a4d521; the generic contact profile and sharing code was kept and the TURN pieces moved to `packages/rtc/`.
- Why: the owner asked to keep core to account, identity and protocol plumbing plus generic Bindle contracts.
- Source: "Core-scope audit (what belongs in 3sln.me core)".
- Safe alternative: none recorded.
- Owner: ___

**MC-21. Contact-profile stale-write guard and withdraw-wins**
- Decided: `GET /api/profile` returns an opaque `revision` (the first 16 bytes of a SHA-256 digest of the four profile fields, hex). `PUT /api/profile` accepts an optional `expectedRevision` and refuses a mismatch with `409 profile_stale`; a `PUT` without it stays unconditional. There is no stored counter and no migration. The client keeps fields editable while loading, disables Save with `aria-busy` until loaded, and after a stale refusal shows the latest profile with an explanation. A stale tab that withdraws disclosure (`discloseProfile:false`) is not refused: only the withdrawal is applied and newer fields are kept, also when it races a write. Stale saves that keep disclosure on are still refused.
- Value: as stated. The withdraw-wins rule (L-1) is provisional.
- Why: stale tabs silently overwrote newer contact data (F1), and a withdrawal must never be blocked.
- Source: "Browser bug hunt fixes (post Beam removal)" (decision 1); "Bug hunt fixes: server review follow-ups" (L-1).
- Safe alternative: none recorded.
- Owner: ___

**MC-22. Legacy app messages in the activity view**
- Decided: with `ACTIVITY_V2_ENABLED` on, the activity view pages v1 app messages from `/api/activity/legacy` after the native feed ends, through a string cursor `legacy|<adapter cursor>|<offset>` that shares the Previous/Next stack. Legacy rows are always current and unarchived, appear only in the active feed and for filters they can match (app, read state, tag applied locally), open through the v1 message API and cannot be archived; search covers only their subject. The nav badge counts native unread items plus unread legacy app messages. Rows read from `app-message/` project as `verified:true` (the move required a verified attestation); rows still in `message/` stay `verified:false`.
- Value: at most 4 adapter pages per render.
- Why: legacy items were unreachable from the activity view (F3, F4).
- Source: "Browser bug hunt fixes (post Beam removal)" (decisions 2 and 3).
- Safe alternative: none recorded. Peer messages are still not shown by the activity view, so the badge no longer counts them while v2 is on; that gap predates this work and is deferred (UI-15).
- Owner: ___

## App platform and AI budget

**AP-1. Separate classifier budget (doubles exposure)**
- Decided: the classifier (Clef) gets its own ledger, and its leases never consume a semantic owner admission.
- Value: $0.50/day and $5/month globally, with a 10% owner share. Combined estimated admission exposure is **$10/month instead of a shared $5**. One owner gets about 3,125 µUSD/day per partition, roughly 10–25 calls.
- Why: classifier and semantic spend starved each other (F1).
- Source: "App-platform wargame fixes (integrations, MCP, email bridge, AI budget)".
- Safe alternative: a shared $5 ledger (the prior state).
- Owner: ___

**AP-2. Semantic owner share and admission gate**
- Decided: each owner gets a share of its partition. Semantic admission needs a paid plan or an account at least 7 days old.
- Value: `SEMANTIC_OWNER_SHARE_PERCENT` is 10%. The partition day is 31,250 µUSD and the owner's share 3,125. Lease floors are 128 µUSD (semantic) and 3,000 µUSD (classifier).
- Why: sybil maths. About 62 sybils fill a partition's admissions.
- Source: "App-platform wargame fixes…".
- Residual: admissions are not recycled.
- Safe alternative: none recorded.
- Owner: ___

**AP-3. Classifier request estimate**
- Decided: a classifier request is charged by request size, not a flat rate.
- Value: $0.038 per million input tokens, priced once per question (11×), and refused above a 3,000 µUSD ceiling.
- Why: a flat 1,000 µUSD misprices requests.
- Source: "App-platform wargame fixes…".
- Safe alternative: none recorded.
- Owner: ___

**AP-4. Agents may quarantine but never release**
- Decided: releasing quarantine stays an owner action in the console. MCP and automation refuse `quarantined:false`.
- Value: as stated.
- Why: finding F4.
- Source: "App-platform wargame fixes…".
- Safe alternative: none recorded.
- Owner: ___

**AP-5. MCP projection and journal**
- Decided: `items_list` and `item_write` return a fixed projection, and `subject` only with `item_read`. The journal stores the projection.
- Value: journal rows expire after 48 h.
- Why: findings F3 (High) and F10.
- Source: "App-platform wargame fixes…".
- Safe alternative: none recorded.
- Owner: ___

**AP-6. App notifications and the email bridge**
- Status: the email-bridge pools are removed 2026-10-28 (owner direction; revisit later); the receipt caps still stand.
- Decided: receipts are capped, and the email bridge has separate admission pools.
- Value: 320 receipts per connection and 1,024 per account, with a reserve of 32 bounded at 4,096. The bridge allows 50 per hour per exact domain (SPF-aligned) and 20,000 per hour in each of the authenticated and unauthenticated pools.
- Why: findings F5 and F6.
- Source: "App-platform wargame fixes…".
- Residual: about 22,000 forged messages per hour can lock out all unauthenticated mail on Cloudflare.
- Safe alternative: none recorded.
- Owner: ___

**AP-7. `BROWSER_AUTOMATION_ENABLED` is class b**
- Decided: the new kill switch is class b, which deviates from the requested class a.
- Value: `safe:true`, on by default.
- Why: a class-a flag without a console record falls back to safe, which would invert the switch.
- Source: "App-platform wargame fixes…".
- Safe alternative: class a, as requested.
- Owner: ___

**AP-8. App removal policy** *(user decisions UD-1 to UD-3; ledger lines blank)*
- Decided: there is no hard deadline, and `cleanup_by` is only a reminder. Settings are kept after removal. Already-removed apps get no `subject-deleted` signal.
- Value: reminders at `cleanup_by`, +24 h and +7 days. `subject-deleted` delivery is drained for up to 72 h.
- Why: user decision.
- Source: "2026-10-22 — App removal design (clean and force) and the subject-deleted signal".
- Safe alternative: none recorded.
- Owner: ___

**AP-9. Removal drain and retention**
- Decided: a failing removal cascade backs off and is eventually marked stuck. Concluded removals are pruned.
- Value: back-off from 1 minute, doubling to 6 h. Stuck after 8 failures. Kept 90 days, at most 100 concluded per account. A removal superseded by a disconnect concludes as `forced`/`disconnected`.
- Why: one failing removal blocked all later ones (F4).
- Source: "Intents and app-removal wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**AP-10. Intent-link routing calls**
- Decided:
  - signed-in viewers see their own handlers first;
  - other viewers get a "Where's your account?" handle entry;
  - org-installed handlers are offered only in member context;
  - capability kinds use the fragment form;
  - "always" skips the interstitial;
  - there are no signed intents in v1.
- Value: as stated.
- Why: decisions delegated to the coordinator.
- Source: "2026-10-22 — Refunds, ownership transfer, delegated portability decisions, provisional intent/removal calls".
- Safe alternative: none recorded.
- Owner: ___

**AP-11. Artefact projection and registry behaviour**
- Decided:
  - result projection removes every member the pinned version does not name;
  - unsupported schema constructs fail closed;
  - an index rollback is caught only if the roll-forward bumps the epoch;
  - an in-place nested registry edit applies only after replacement.
- Value: as stated.
- Why: to fail closed.
- Source: "2026-10-22 — ART-5b and ART-6 engine paths…"; "Scalability fixes…".
- Safe alternative: none recorded.
- Owner: ___

**AP-12. AU-S6: producer summaries derived from existing indexes**
- Decided: "What's left" summaries come from the existing durable hosted and Drive indexes. Writes embed the producer connection and generation in existing object metadata, so there is no extra per-object write and no file-name log per app.
- Value: summaries cover only current managed objects, starting with newly attributed writes. Out of scope: older unattributed objects, other providers, retained Drive versions and copies held by apps.
- Why: it satisfies RR1-M7 without a second hot-path write or a new file-name log. It replaces the design's proposed counter flush (once a minute or every 64 writes).
- Source: "2026-10-24 — AU-S6 producer summary, What's left and removal reminders".
- Safe alternative: the design's counter flush (the superseded proposal).
- Owner: ___

**AP-13. AU-S6: summary and deletion bounds**
- Decided: summary scans and owner-driven deletion are bounded per request. Counts describe the current page, not a complete history.
- Value:
  - summaries scan at most 5,000 records, in internal pages of at most 200;
  - display buckets are 64 prefixes plus "other" per resource;
  - deletion scans 64 records by default, at most 200 per action, with a bounded continuation checkpoint.
- Why: to keep removal requests bounded without an accumulating object ledger.
- Source: "2026-10-24 — AU-S6 producer summary, What's left and removal reminders".
- Safe alternative: none recorded.
- Owner: ___

**AP-14. AU-S6: removal reminders by email and in the activity centre**
- Decided: open removals keep the three reminder times. The account-email sender and verified contacts now supplement best-effort push, and activity-centre entries come from durable reminder notices. No notice ever claims delivery.
- Value: activity queries return at most 100 entries and scan at most 500 notices. The view first requests 50. Push stays bounded to ten subscriptions.
- Why: reminders were push-only and best-effort.
- Source: "2026-10-24 — AU-S6 producer summary, What's left and removal reminders".
- Safe alternative: none recorded.
- Owner: ___

**AP-15. RR1-M7 deviation: per-object producer pointers (requires privacy review)**
- Decided: on top of the earlier marker-on-object deviation (AP-12), the engine writes derived per-object path pointers, in the same transaction as the authoritative record. Together they effectively make a per-app file record. The DEVLOG says this is a provisional privacy/storage/write-amplification deviation and not approval of an RR1-M7 exception.
- Value:
  - transactional connection/generation pointers index last writers, distinct creators, live removals, pruned lineages and active keeps by resource and generation;
  - they sit under the derived `storage/producer-gc/` family, hold existing record paths and no contents, and have no external provider index or production API;
  - equal writer and creator pointers are deduplicated (one pointer for the ordinary creation case), and a distinct creator can need a second;
  - unchanged attribution does not rewrite pointers;
  - the account metadata is a portable ordered key/value store (on Workers the Durable Object KV API), whose values are not addressable from SQL.
- Why: summaries and deletion would otherwise traverse unrelated objects. A local workerd probe showed expression indexes work only for JSON stored in an ordinary SQL table, and the KV API's backing table refused them (`SQLITE_AUTH`).
- Source: "Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" (RR1-M7 deviation; review follow-up 6).
- Safe alternative: move the authoritative `hosted/` and `drive/object/` records into an application SQL table and index with expression indexes. It is a storage-layer migration across the transactional metadata boundary. It would not remove the concern either, because the index B-tree still stores the derived connection and generation per object. It is recorded for the RR1-M7 reviewer.
- Owner: ___

**AP-16. Producer index bounds and fail-closed probes**
- Decided: producer summaries, deletion and marker collection run on bounded passes over the pointers, with documented limits that fail closed.
- Value:
  - summaries read at most 5,000 target pointers or objects, and deletion and marker collection at most 200 target objects;
  - keep lookup uses the newest relevant choices, and cross-removal keeps keep their own cleanup coverage until superseded;
  - `knownResource` for large apps skips between generations and checks at most 4 pointers per range (`PROBE_POINTERS`) over at most 64 writer generations (`PROBE_GENERATIONS`), and past that it answers `not_found`;
  - marker collection records at most 128 protected keep scopes (`protectedScopes`) and restarts the pass if any is no longer active;
  - legacy attribution indexing advances 200 rows per call, owner requests retry while it builds, and marker alarms reschedule;
  - Node metadata listing starts at the greater of prefix and cursor.
- Why: the 5,000-object summary and the 200-object deletion batch were the probe cliffs #3 and #9. The DEVLOG calls the probe bound "a documented bound, not a full guarantee".
- Source: "Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" (#3, #9; review follow-ups L2 and L4).
- Safe alternative: none recorded.
- Owner: ___

**AP-17. Clean removal for organization apps is not built**
- Decided: organization connections report clean removal as unsupported (`unsupported_entity`), although `docs/spec/app-removal.md` §9.6 describes a provisional policy where the reference host starts clean removal after a notified 24 h delay.
- Value: plain disconnect only, for organization apps.
- Why: the organization side of removal was never implemented; the spec status now records the boundary.
- Source: "Spec/implementation drift audit" (finding 2).
- Safe alternative: keep it unsupported until built (current state).
- Owner: ___

**AP-18. The email bridge needs no messaging-app flag**
- Status: Removed 2026-10-28 (owner direction; revisit later). `EMAIL_BRIDGE_ENABLED` is retired; nothing to sign.
- Decided: `EMAIL_BRIDGE_ENABLED` requires no other flag, and `bridgeConfig`, the bridge routes and `recognizedSlots` no longer consult a messaging-app flag. Delivery depends on the public-message-intake slot having an occupant; mail is held with `no-occupant` otherwise, as before. `PUBLIC_INTAKE_CONTRACT` moved to `packages/links/types.mjs`, and `federation/brokered.mjs` imports it from there.
- Value: as stated.
- Why: the bridge is core plumbing and must not depend on Parley's flag.
- Source: "Messaging extraction prep (no reset)" (decision 2).
- Safe alternative: none recorded.
- Owner: ___

**AP-19. Provider authorization page: bounded `lang` parameter and first-party schema text**
- Decided: `/oauth/authorize?request_id=` accepts one bounded `lang` tag and still refuses every other parameter (documented in `docs/spec/federation-implementation.md`). First-party schema text goes through the catalogue only for a schema whose id is in a fixed set (`app-messages/v1`) and whose publisher is `https://3sln.me`; third-party schema text stays literal even if it matches a catalogue key.
- Value: as stated.
- Why: the spec constrains only the app ("redirects with only the returned `request_id`"), so the provider-side strictness was an implementation choice (F16).
- Source: "Browser bug hunt fixes (post Beam removal)" (decision 5).
- Safe alternative: keep refusing every extra parameter.
- Owner: ___

### RTC signaling

Source for every item below: "2026-10-26 — RTC signaling extension design", the RTC signaling spec (in git history: `git show bbbbdad:docs/spec/superseded/rtc-signaling.md`) and [design](../architecture/rtc-signaling.md) (revision 1, §9 and §18). The design was reviewed by a forked adversarial review that found 7 High, 11 Medium and 6 Low issues, all applied. (At the design's writing nothing was implemented; the slices added since are listed in the sub-sections after AMD-R6, and are local only.) Every item is provisional, with a recommendation but no sign-off. Planned flags are `RTC_SIGNALING_ENABLED`, `RTC_FOREIGN_ENABLED` and `RTC_TICKETS_ENABLED` (class a, default off) and `RTC_TURN_ENABLED` (class b). The design lists release gates, among them sign-off of RTC-1 to RTC-17 and AMD-X1 and AMD-R1 to R6, an independent security review, a clean-room second provider and real-device WebRTC tests.

**RTC-1. Shape on the extension system**
- Decided: Recommended: adopt.
- Value: a `features` entry (`rtc-signaling.v1`) for provider-to-provider traffic, an exclusive `rtc-signaling/v1` slot with a built-in non-brokerable occupant for apps, `rtc-purpose` artefacts, and an `rtc-ticket/v1` link type.
- Why: It reuses every extension mechanism and adds no parallel one.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded. Design spec §16 rejects a new extension mechanism.
- Owner: ___

**RTC-2. AMD-X1 bound consumer options in extensions**
- Decided: Recommended: adopt.
- Value: a slot member `bind` (listed in `crit`), `options` on slot fragment requests, and a per-consumer approved value recorded in the grant. See AMD-X1.
- Why: The application's purposes must be part of what the owner approves for it.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: one slot per purpose (rejected, spec §16).
- Owner: ___

**RTC-3. End-to-end message signatures by per-session leg keys**
- Decided: Recommended: adopt.
- Value: per-session leg keys, certified by the entity's issuer, sign every message, instead of provider-signed hop-by-hop events. Providers relay messages unchanged.
- Why: It lets endpoints detect a peer provider rewriting DTLS fingerprints.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: provider-signed hop-by-hop events.
- Owner: ___

**RTC-4. Admission bases**
- Decided: Recommended: adopt, and revisit relations after ORG-11.
- Value: own entity, a link (a contact with RTC configuration, or a ticket), or an opt-in request policy (off by default). A relation basis is reserved.
- Why: Admission needs a basis, and silent handling of blocks, mutes and quarantine.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-5. No address before the claim**
- Decided: Recommended: adopt.
- Value: no address leaves a device before the first claim; SDP never carries candidates or addresses; an optional candidate-free offer may ride in the invite.
- Why: IP privacy before the callee chooses to answer.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-6. Cross-entity sessions are relay-only by default**
- Decided: Recommended: adopt, with that consequence.
- Value: the cross-entity default IP policy is `relay`; direct connection only by owner opt-in; own devices may default to direct. **With hosted relay off, cross-user calls need an explicit opt-in to connect directly.**.
- Why: It stops a stranger learning a callee's address.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded. The design's trade-off is the opt-in itself.
- Owner: ___

**RTC-7. Each party funds its own relay**
- Decided: Recommended: adopt.
- Value: own `ice-relay/v1` occupants or an app relay; hosted relay stays off until budget enforcement exists.
- Why: The relay-budget gate from the beaming architecture (externally enforced aggregate spend) is still unmet.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Update (2026-10-27): the built-in hosted relay occupant is implemented locally (RTC-f, RTCf-1 to RTCf-14), but it stays off on every deployment until an operator supplies a spend authority that enforces per-owner byte caps (RTCf-rev). Third-party relays remain other occupants of the same slot (RTCf-14).
- Owner: ___

**RTC-8. No ringing, busy or presence message in v1**
- Decided: Recommended: adopt.
- Value: decline only on user action.
- Why: A ring or busy signal reveals presence.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: a per-contact "show that I'm being rung" opt-in, to reconsider later.
- Update (2026-10-27): the owner's decline of an unanswered invite is now a silent local end that tells the caller nothing (RTCg-5, RTCs-1). Only a device's own `claim` with `outcome: decline` (RTCd-7) sends a signed `decline`.
- Owner: ___

**RTC-9. Lifetimes**
- Decided: Recommended: adopt.
- Value: ring at most 120 s, session at most 24 h, leg certificate at most 900 s (issuer-declared, 120 to 900). 3sln.me issues 600 s. Review R7 lowered the certificate lifetime from 3,600 s to bound the revocation window.
- Why: Bound replay and revocation windows.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-10. Optional committed SAS profile**
- Decided: Recommended: adopt as optional.
- Value: 6 digits, optional.
- Why: It detects provider substitution for users who want that.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-11. Reference-host limits (spec §13 fixes only the kinds)**
- Decided: Recommended: adopt as starting values and tune with load tests.
- Value: per (caller, callee) 6 invites per 10 min; per caller principal 30 invites per hour across all entities; per (sending issuer, callee) 20 per hour and per (sending issuer, link parent) 60 per hour; per callee 4 ringing sessions and 60 invites per hour; 32 held requests per callee; per caller entity 8 open sessions and 60 `open` per hour; per leg 256 messages per minute.
- Why: Abuse bounds.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Update (2026-10-27): implemented in RTC-d. The per-caller-principal limit across entities is a host-wide window through `WORK_AUTHORITY` (RTCd-14), and the foreign directory budgets, `warms` limit and shedding values are in RTCe-17 and RTCe-19.
- Update (2026-10-27, RTC wargame): new values and windows (RTCw-M1, RTCw-R2, RTCw-M3, RTCw-M2-2). A `self` window of 120 invites an hour per entity replaces the shared cross-entity windows for own-device invites; same-host callers count as per-principal shares of the issuer windows, with a per-callee `sameHost` window of 40 of the 60; principal-bound ticket (`preferred`) invites have their own per-callee window of 60 an hour, outside `callee` and `issuerCallee`; a ringing reserve of 2 above the 4 ringing slots serves `self` and `preferred`; 8 live endpoints per application within 32, at most 16 per fan-out; tickets 64 per app with a `mint` window of 120 an hour. Proposed as AMD-RW1 and AMD-RW3.
- Owner: ___

**RTC-12. Device delivery**
- Decided: Recommended: adopt. Web Push delivery is unverified.
- Value: long poll required; Web Push and integration doorbells optional; WebSocket deferred.
- Why: A hibernating WebSocket profile is a likely later 3sln.me addition.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-13. Multi-party is a non-goal**
- Decided: Recommended: adopt.
- Value: no group member in v1.
- Why: Scope.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-14. Beam leaves core and may return as a reference app**
- Decided: Recommended: adopt.
- Value: revised 2026-10-26: Beam code and routes were removed outright, without waiting for the app (see MC-11 to MC-15).
- Why: User direction that app experiences belong in apps. Supersedes D048 (paid WebRTC beaming).
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-15. Retention**
- Decided: Recommended: adopt.
- Value: session records at most 24 h after end; missed list at most 30 days; no SDP or candidate retention.
- Why: Privacy.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-16. Core shows a portal ring notification only as a fallback**
- Decided: Recommended: adopt.
- Value: the application owns the call experience.
- Why: App experiences stay out of core.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: none recorded.
- Owner: ___

**RTC-17. The caller's application origin is disclosed to the callee**
- Decided: Recommended: adopt.
- Value: `client.origin` is carried in the leg certificate.
- Why: It lets callees judge which app is calling.
- Source: "RTC signaling extension design" (design §9).
- Safe alternative: omit it for caller privacy.
- Update (2026-10-27): implemented (RTCs-7), with a "reported by {provider}" label for foreign callers (RTCe-22). It is a highest-impact item.
- Owner: ___

**AMD-X1. Bound consumer options (extensions §2.1, §2.2, §5.2; wire profile)**
- Decided: Proposed, unsigned. It changes the extension system itself and is the one extension-system addition RTC needs. The four rules (spec §3.5): a slot member `bind` (a nonempty list of `options.consumer` names), which MUST be listed in `crit`, so a processor without AMD-X1 treats the slot as an ordinary fragment and the occupant refuses every bound operation; a slot fragment request carries `options` validated against `options.consumer`; the provider discloses the requested values at consent, records the approved subset per consumer (with `{version, digest}` per approved versioned line) and changes `bindle.grant` whenever they change, with widening needing `grant-more` and narrowing immediate; the occupant enforces the approved values on every invocation, never shared with other consumers.
- Value: as stated.
- Why: Slot consumer options live only in declarations, and slot atomic fields and scope selections are shared by every consumer, so an app's purposes could not be approved per app.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: one slot per purpose (rejected in spec §16).
- Update (2026-10-27): implemented behind `EXTENSIONS_ENABLED` (RTCabc-5, RTCabc-6); extensions §13 carries the text, marked proposed and unsigned.
- Owner: ___

**AMD-R1. Certification key uses (organizations §3a.3; links §7.2 signature-domain table)**
- Decided: Proposed, unsigned. Certification keys gain two uses, `bindle-rtc-leg-certificate+jwt` and `bindle-rtc-control+jwt`, and rows are added for both and for `bindle-rtc-message+jwt` (leg keys).
- Value: as stated.
- Why: `typ` separates the profiles so no verifier accepts one as another.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: none recorded.
- Owner: ___

**AMD-R2. Feature table (protocol §2)**
- Decided: Proposed, unsigned. Add `rtc-signaling.v1`.
- Value: as stated.
- Why: Provider discovery of the feature.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: none recorded.
- Owner: ___

**AMD-R3. Doorbell event (integrations §6.2)**
- Decided: Proposed, unsigned. Register the `rtc-ring/v1` event, payload exactly `{endpoint}`, so a confidential integration's server can wake its native app.
- Value: as stated.
- Why: An optional wake path for native apps.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: none recorded; the doorbell is optional.
- Update (2026-10-27): not implemented; the Web Push doorbell is (RTCe-13), and `rtc-ring/v1` is listed in RTCe-open.
- Owner: ___

**AMD-R4. `rtc-purpose` artefact kind (artefacts §6.3)**
- Decided: Proposed, unsigned. Register the kind and its growth table.
- Value: as stated.
- Why: Purposes are versioned artefacts.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: none recorded.
- Owner: ___

**AMD-R5. `rtc-ticket/v1` link type, and contact-link RTC configuration (links)**
- Decided: Proposed, unsigned. Register the link type, and give contact links owner-side RTC configuration beside intake configuration.
- Value: as stated.
- Why: Nearby pairing, call-me links and callbacks need bounded single-purpose capabilities.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: admission by contact links only (rejected in spec §16).
- Owner: ___

**AMD-R6. Beaming superseded (beaming)**
- Decided: Proposed, unsigned. Beam's signaling contract, relay rules and nearby invitations are superseded by the RTC spec; Beam's transfer experience may return as an application on the `file-transfer/v1` purpose. Applied early: Beam was removed from core on 2026-10-26 and beaming.md is a superseded stub.
- Value: as stated.
- Why: User direction on 2026-10-26.
- Source: "RTC signaling extension design" (spec §18).
- Safe alternative: none recorded.
- Owner: ___


The sub-sections below add the implementation slices that followed the design. They are all local behaviour behind default-off flags (`RTC_SIGNALING_ENABLED`, `RTC_FOREIGN_ENABLED`, `RTC_TICKETS_ENABLED`, `RTC_TURN_ENABLED`) and the empty-by-default `RTC_FOREIGN_ISSUERS` allowlist. Nothing in them is verified against a real second provider, push service, relay, Durable Object or browser WebRTC stack. Their IDs are the DEVLOG's own (RTCd-n, RTCg-n, RTCe-n, RTCs-n, RTCf-n, RTCw-M2-n, RTCw-M6-n), except RTC-a/b/c, RTC-i and the wargame's engine/route findings and review fixes, whose DEVLOG entries number no decisions: those items carry digest labels (RTCabc-n, RTCi-n, RTCw-H1, RTCw-R1 and so on) and cite the DEVLOG bullet, divergence or finding. Items with a label ending in `rev`, `resid`, `open`, `copy` or `info` are likewise digest labels for review fixes, residual risks, deferrals, copy and documented non-changes that the DEVLOG records without an ID. Where one item covers several DEVLOG IDs, the title lists them. The production gates these entries record are collected under "Unverified external assumptions".

#### RTC-a/b/c: validators, purposes and bound options

Source for every item below: "RTC-a/b/c validators, purposes and bound options (flags off)", including its "Review follow-ups (2026-10-27, independent security review…)" (the spec changes are AMD-RV1).

**RTCabc-1. SDP, candidate and batch readings (RTC-a)**
- Decided: these are the coordinator's readings of spec §6.3, where the spec text was silent or looser.
- Value:
  - the invite `offer` and the accept `answer` are SDP strings; `to` is null for `invite` and `cancel`; the invite's `ring_until` must also be after `iat`;
  - a srflx `raddr` is a host address, so cross-entity it must be unspecified, mDNS or absent; unknown candidate extension attributes are refused;
  - any weak (sha-1, md5) fingerprint invalidates an SDP; outside `o=`, `c=` and `a=rtcp`, an `IN IP4/IP6` token or a dotted IPv4 literal anywhere in an SDP is refused;
  - a batch's messages must share one (`iss`, `sub`, `aud`); duplicate carried links are refused.
- Why: no address may leave a device before the claim (RTC-5), and an address-bearing field the spec forgot to list would leak one.
- Source: "RTC-a/b/c validators, purposes and bound options" (provisional decisions and readings).
- Safe alternative: none recorded.
- Owner: ___

**RTCabc-2. AMD-RV1: media-security rules added by the independent review**
- Decided: the review's M1 and L1–L3 findings are fixed by stricter validation, and the spec is amended as AMD-RV1 (rtc-signaling §5, §6.3, §10, §11.3, §18). The amendment is proposed and unsigned.
- Value:
  - every `a=fingerprint` line must carry the same (algorithm, value) pair, compared case-insensitively, so the SAS covers what DTLS checks; an SDP whose only fingerprint is sha-384 or sha-512 is valid but gives no SAS input;
  - `candidate`, `remote-candidates`, `end-of-candidates` and `IN IP4/IP6` are matched case-insensitively; the `o=` username and session id must be `-` or digits; `u=`, `e=` and `p=` lines are refused (beyond the review, which named only `u=`); unanchored dotted four-number runs and IPv6-like colon runs are refused. Firefox's `mozilla...THIS_IS_SDPARTA` username must be rewritten to `-` by the endpoint before sending;
  - cross-entity, srflx and relay addresses must be public (a non-public IPv4/IPv6 list, including mapped, compatible and NAT64 forms, is refused; documentation ranges are allowed); under `public`, a srflx `raddr` must be unspecified, mDNS or absent, and only own-entity `all` may reveal the host base address; an mDNS name must be a UUID plus `.local`.
- Why: a session-level versus media-level fingerprint split could make the SAS cover a different fingerprint than DTLS (M1), and the spec was less strict than the validators on the address points (L2).
- Source: "RTC-a/b/c validators, purposes and bound options", "Review follow-ups" (M1, L1, L2).
- Safe alternative: none recorded; the spec text before AMD-RV1.
- Owner: ___

**RTCabc-3. Signature and key rules (review L3 to L5)**
- Decided: stricter signature and key handling in the RTC JWS profile.
- Value:
  - high-S ES256 signatures are refused and signing normalizes to low-S;
  - a reused `seq` has "the same content" only when its payload bytes are identical (design §8.1): a second signature over the same bytes is a duplicate, a re-serialized payload with equal JSON is different content;
  - `verifyControl` requires `expected.iss` and `expected.sub` as well as `aud` and `sid`;
  - keys use the directory document shape, and only `use: 'cert'` with `state: 'active'` verifies a leg certificate or control statement; a `sig` key never does.
- Why: signature malleability, ambiguous duplicates, and keeping the R4-H1 rule that signing keys cannot certify.
- Source: "RTC-a/b/c validators, purposes and bound options", "Review follow-ups" (L3, L4, L5).
- Safe alternative: none recorded.
- Owner: ___

**RTCabc-4. Purpose bodies and the unsigned growth table (RTC-b)**
- Decided: purpose `categories` must be a sorted subset of the six known values, which is stricter than incremental authorization's "unknown values are ignored". `rtc-purpose` is not in `DEFAULT_KINDS`.
- Value: until the AMD-R4 growth table is signed, only exactly pinned versions are usable, URL-only pins are refused (`artefact_unverifiable`) and heads never advance. The four candidate lines in `docs/artefacts/rtc-purposes/` are registered as operator documents and declare `personal-data`; their English and Spanish copy is a placeholder for review. The `rtc-purpose` references resolve only while `RTC_SIGNALING_ENABLED` is on (`rtcBoundArtefacts`).
- Why: it follows the `relation` kind's precedent, and the purposes' copy is what an owner reads at consent.
- Source: "RTC-a/b/c validators, purposes and bound options" (RTC-b; decisions); "Review follow-ups" (informational).
- Safe alternative: none recorded.
- Owner: ___

**RTCabc-5. AMD-X1 implementation readings (RTC-c)**
- Decided: these are the readings behind AMD-X1 (extensions §13, proposed and unsigned).
- Value:
  - `options` carries only bound members; an invalid bound request fails the whole authorization (`invalid_request`);
  - the approval identity is `bound.revision` (brokered `bindle.grant` derivation deferred, because the only bound slot is non-brokerable);
  - widening is a new consent (`grant-more` deltas and "already granted" labels for bound values are a follow-up); narrowing is immediate and reaches every active grant of that app (`federation.narrow-bound-options`);
  - with `EXTENSIONS_ENABLED` off a pending bound request cannot be approved (`unsupported_fragment`); bound artefact lines are pinned from provider-held reviewed references only, never fetched by URL.
- Why: the amendment text left these open.
- Source: "RTC-a/b/c validators, purposes and bound options" (RTC-c; decisions).
- Safe alternative: none recorded.
- Owner: ___

**RTCabc-6. AMD-X1 review rules: occupant read, incremental requests, stale consent (review L6 to L8)**
- Decided: three guards on bound options.
- Value:
  - `federation.bound-approval` is system-only, and `boundApproval`/`checkBound` require the verified token's `grants` (a nonempty array of at most 256 ids), with no fallback to all of the consumer's grants; with connections mounted a grant counts only while its connection is live;
  - `grant-more` for a fragment whose slot has `bind` is refused at admit with `unsupported_fragment` ("incremental requests cannot add them yet");
  - an identical resubmission of an offered "already approved" bound selection is approved only while a live grant covers it (same epoch, live connection, same recorded versions); otherwise `stale_consent`, once, and the entry page falls back to the full consent review.
- Why: the occupant read must not widen to grants the token does not carry, and a bound approval must not survive a changed version.
- Source: "RTC-a/b/c validators, purposes and bound options", "Review follow-ups" (L6, L7, L8).
- Safe alternative: none recorded.
- Owner: ___

**RTCabc-7. RTC flag shape**
- Decided: four class-a/b flags, all default off.
- Value: `RTC_SIGNALING_ENABLED` requires `EXTENSIONS_ENABLED` and `ARTEFACT_VERSIONS_ENABLED`; `RTC_FOREIGN_ENABLED` requires `RTC_SIGNALING_ENABLED` and `DIRECTORY_ENABLED`; `RTC_TICKETS_ENABLED` requires `RTC_SIGNALING_ENABLED`; `RTC_TURN_ENABLED` (class b) is a new flag, not a rename of `BEAM_TURN_ENABLED`, and requires `RTC_SIGNALING_ENABLED`. Class b env reads do not evaluate dependencies, so RTC-f must check both flags. In legacy env mode `siteGlobal` returns `RTC_SIGNALING_ENABLED='true'` even without its dependencies, as for other flags.
- Why: gating by dependency keeps a half-enabled RTC unreachable.
- Source: "RTC-a/b/c validators, purposes and bound options" (flags); "Review follow-ups" (informational).
- Safe alternative: none recorded.
- Owner: ___

#### RTC-d: sessions, admission and same-host transport

Source for every item below: "RTC-d sessions, admission and same-host transport (flags off)" and its "Review follow-ups (2026-10-27)". Behaviour is local; while `RTC_SIGNALING_ENABLED` is off every widening operation answers the uniform `not_found`, and narrowing is never gated.

**RTCd-1. Session records**
- Decided: the caller's provider keeps `rtc/out/<sid>` and the callee's keeps `rtc/in/<caller principal>/<sid>`. An own-entity session has both records in one writer; they end together and no control statement goes to oneself.
- Value: as stated.
- Why: a `sid` that another caller chose must never collide (§8.2 step 2).
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-1).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-2, RTCd-21, RTCd-22. Same-host transport is asynchronous, with a bounded inbound queue**
- Decided: no request delivers across entities. A commit asks the adapter for a detached pass, with the alarm as the fallback. `rtc.ingest` checks step 1, stores the batch in `rtc/inq/` and answers `{accepted:true}`; `rtc.inbox` runs steps 2 to 8 later on the receiver, as of the batch's receipt time.
- Value: the inbound queue overflows at 256 batches or 4 MiB, and `rtc.ingest` then answers `temporarily_unavailable` (503), which the sender retries (§8.3), rather than dropping silently. Passes are serialized per service, and peer calls use gate `none`.
- Why: the first version ran the callee's whole ingest inside the sender's request, so timing was a presence oracle (review M2); a silent drop would lose at-least-once delivery.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-2 revised, RTCd-21, RTCd-22; review M2).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-3. Replay window**
- Decided: payload-bytes digests are kept for the last 128 accepted `seq` values per leg. A reused `seq` older than that is ignored as a duplicate. The sender's provider applies the same rule to its own endpoint; different bytes end the leg `failed` with a control statement, and an out-of-order `send` is refused with `invalid_args`.
- Value: 128.
- Why: bounded replay protection without buffering for the sender's own endpoint.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-3).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-4, RTCd-5. Held invites and mutes**
- Decided: invites through the `none` basis (off by default) and through a quarantined contact parent are recorded in the owner's missed and held list and never delivered to endpoints or alerted. Blocked invites are dropped and never listed. A mute of a principal, purpose or application delivers the invite without alert and never excludes an endpoint.
- Value: as stated.
- Why: §4.4 leaves the presentation to the provider, and silence must not reveal blocks or quarantine.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-4, RTCd-5).
- Safe alternative: none recorded.
- Update (2026-10-27, RTC wargame): blocks also cover a whole caller provider (RTCw-M6-1, AMD-RW4), and mutes gain `issuer` and `origin` kinds, with app and origin mutes for foreign callers scoped to the asserting provider (RTCw-M6-2, RTCw-R3, AMD-RW5). Own-entity invites are never blocked or provider-muted (RTCw-M6-3).
- Owner: ___

**RTCd-6. Auto-accept projection**
- Decided: the provider computes `auto_accept` per endpoint in the invite projection: own entity, the purpose allows `self`, the owner enabled it for that application, and the caller certificate's `client_id` is the endpoint's application. Nothing more is enforced at `claim`, because a provider cannot verify a user action there.
- Value: as stated.
- Why: auto-answer must be an owner choice per app, never a caller's.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-6).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-7. Decline by a device claim**
- Decided: a decline is a `claim` with `outcome: decline` followed by the leg's signed `decline` message. The callee record ends at the claim; that one message may still be sent. A decline claim and a `send` of only `end`, `cancel` or `decline` are narrowing.
- Value: as stated. This is the device-level decline; the owner-level decline of an unanswered invite is silent (RTCg-5, RTCs-1).
- Why: a device that answers has already revealed itself, and ending must never be gated.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-7).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-8, RTCd-9, RTCd-20. Wire details the spec does not name**
- Decided: the endpoint secret travels as an `endpoint_secret` member of the arguments, and a DPoP-registered endpoint refuses it. `open` takes `purpose` as the line URL, pins the provider's held reference, and an opened session with no invite times out after 120 s. `expires_at` from `register` and `open` is in Unix seconds, like certificate `exp`.
- Value: as stated.
- Why: §9.1 does not name these.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-8, RTCd-9, RTCd-20).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-10. Tickets are stored apart from LinkService**
- Decided: tickets live in `rtc/ticket/<jti>` with their own cap, not on LinkService `link/` parents. The link is `<issuer>/rtc/t/<jti>?bindle_meta=…`, signed with the identity signing key, and the owner host verifies the exact stored meta. Callback tickets also need `RTC_TICKETS_ENABLED` and are refused for own-entity sessions.
- Value: 256 live tickets per owner.
- Why: it kept RTC-d independent of the links code; moving tickets onto LinkService is left to the links owner.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-10).
- Safe alternative: tickets as LinkService parents.
- Update (2026-10-27, RTC wargame): within the 256, at most 64 live tickets per minting app and a `mint` window of 120 an hour (RTCw-M2-2); tickets record their minting app and die with it (RTCw-M2-1, RTCw-M2-3); dead rows are pruned before each cap check (RTCw-L5).
- Owner: ___

**RTCd-11. No presence oracle through keys**
- Decided: while RTC is on, `rtcPublicKeys` answers every active same-host entity with a certification key, creating it on first need, so `open` succeeds alike whether or not the callee ever registered. An unknown or deleted principal answers `temporarily_unavailable`.
- Value: as stated.
- Why: a callee with no certification key made `open` fail, which revealed registration; identity documents are public anyway.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-11).
- Safe alternative: none recorded.
- Update (2026-10-27, RTC wargame L3, I3): the key is now created whatever the callee entity's own RTC flags say, so `open` also cannot reveal the callee's flag cohort (RTCw-L3).
- Owner: ___

**RTCd-12, RTCd-23, RTCd-25. Deletion, retired keys and moves**
- Decided: account deletion (`rtcDrain`, and the purge's identity stage before the tombstone) ends every live session with control `revoked`, removes endpoints and closes the RTC family to new admissions. Session records pin the peer's certification keys (`peerKeys`, at most 8), so a control statement may verify against keys the peer used for the session even after it stops serving them, including a key revoked at a move. A deletion with reason `moved` still sends `revoked`; a `moved` control is not implemented.
- Value: at most 8 pinned keys per session. A control can only end that one session with that party, so a compromised retired key can at worst end sessions early.
- Why: the purge tombstoned the account before the drain, so deletion controls were dropped (review M1). §5.2 has no deletion reason.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-12, RTCd-25); "Review follow-ups" (M1, RTCd-23).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-13. Authority-epoch rows are recorded only for admitted traffic**
- Decided: an `aep` row is recorded only for an admitted invite or a live session's messages, so a dropped invite records nothing (§8.2 step 6 "live admission state").
- Value: as stated.
- Why: a dropped invite must leave no state that reveals the drop.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-13).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-14. Limits are per callee writer, plus one host-wide caller window**
- Decided: the per-(caller, callee), per-(issuer, callee), per-(issuer, link parent) and per-callee limits are counted in the callee's writer. The §13 limit per caller origin principal across its entities is one host-wide window through `WORK_AUTHORITY`, keyed by an HMAC of the principal, counted after verification and before the transaction. A limiter that throws drops the invite (fail closed). A retried copy of an existing session's invite returns before any limit.
- Value: the RTC-11 numbers, with the per-writer count kept as defence in depth. For same-host callers the per-(issuer, callee) limit (20 an hour) binds before the held-request bound (32). A host without `WORK_AUTHORITY` counts per writer only. *Revised 2026-10-27 (RTC wargame M1, R2):* same-host callers now count as per-principal shares of the issuer windows, bounded together by the per-callee `sameHost` window (40 an hour), so for 40 same-host callers the held-request bound (32) binds instead; `self` invites skip the host-wide caller window (RTCw-M1).
- Why: the per-writer count never bound a caller across callees (review L1).
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-14 corrected); "Review follow-ups" (L1).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-15, RTCd-16, RTCd-17. Event queue, long poll and gating**
- Decided: an event that would exceed 256 events or 512 KiB is dropped, `gap` is set and the session ends `failed` with a control statement to the peer. `listen` waits in memory within one writer with gate `none`; push subscriptions are validated (HTTPS, a provisional list of recognized Web Push origins) and stored. `listen`, `endpoints` and owner reads of existing state are never gated; `unblock` and `unmute` are widening and gated.
- Value: 256 events, 512 KiB.
- Why: bounded per-leg memory, and state that stays narrowable and readable while the flag is off.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-15, RTCd-16, RTCd-17).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-18, RTCd-19. Fan-out eligibility and the unimplemented capacity preference**
- Decided: fan-out eligibility needs the federation bound check, which lives outside the writer, so it is evaluated before the transaction and re-read inside it. The §13 SHOULD "prefer `self` and principal-bound bases when ringing capacity is short" is not implemented: the callee's four ringing slots are first come.
- Value: 4 ringing slots per callee.
- Why: RTCd-19 is a deliberate omission, recorded so the SHOULD is not assumed met.
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-18, RTCd-19).
- Safe alternative: implement the preference.
- Update (2026-10-27, RTC wargame M1, R2): the preference is now implemented as a ringing reserve: bearer-link invites ring up to 4, and `self` and principal-bound ticket invites presented by their named principal may use 2 more (RTCw-M1). RTCd-19's omission is superseded.
- Owner: ___

**RTCd-24. A full outbox can drop a control statement**
- Decided: a control statement that finds even its reserve full is dropped, but the session still ends locally. The peer's acceptance of the revoked leg is then bounded by the leg certificate's lifetime (at most 900 s, §14).
- Value: outbox caps 1,024 in total and 64 per peer, outbox rows keyed per peer; message batches stop 128 and 16 short of those caps, which are reserved for control statements. A `failed` reply to an extra or late callee leg is sent at most once per (sid, leg) and at most 4 times per session. A full outbox makes `send` fail with `rate_limited` and nothing is accepted.
- Why: the outbox could be filled and drain was head-of-line blocked (review M3).
- Source: "RTC-d sessions, admission and same-host transport" (RTCd-24); "Review follow-ups" (M3).
- Safe alternative: none recorded.
- Owner: ___

**RTCd-rev. Review rules on claims and live IP policy (review L2, L3, L4; digest label)**
- Decided: a repeat claim is allowed only while `claimUsable` (an accepted session still live, or a decline whose message has not been sent). `send` applies the stricter of the session's pinned IP policy and the owner's current one, so narrowing reaches a live session and widening never does. Export gains `rtc/contact/<parent>` parents and ticket `purposes` and `principal`; the ticket meta and `jti` are never exported.
- Value: as stated.
- Why: repeat claims on ended sessions, a narrowed policy ignored by live sessions, and missing export fields (review L2 to L4).
- Source: "RTC-d sessions, admission and same-host transport", "Review follow-ups" (L2, L3, L4).
- Safe alternative: none recorded.
- Owner: ___

#### RTC-g: owner settings and portal ring

Source for every item below: "RTC-g owner settings and portal ring (flags off)" and its "Review follow-ups (2026-10-27)". The review's F1 option was chosen by the coordinator, not the user.

**RTCg-1, RTCg-3. Owner actor only, and no master switch**
- Decided: owner routes act only as the signed-in person (`{kind:'owner'}`), never as an actor from the body; an organization admin acting for an organization is not offered. RtcService has no owner on/off for calls: availability is the flag plus the owner's choices per basis (contact links, requests, approved apps), and the view is the "enable" surface.
- Value: as stated.
- Why: a master switch would be a new owner operation, and org acting needs a design.
- Source: "RTC-g owner settings and portal ring" (RTCg-1, RTCg-3).
- Safe alternative: add an owner-level calls switch (listed under "Missing interfaces", only if wanted).
- Owner: ___

**RTCg-2. Widening routes answer the uniform 404 while the flag is off**
- Decided: while `RTC_SIGNALING_ENABLED` is off, `unblock`, `unmute` and any well-formed widening `set-policy` or `set-contact-rtc` answer exactly `{"error":"not_found"}` (404), byte-identical to an unknown `/api` path; a malformed one is still the ordinary 400. Every other `not_found` (unknown ticket, session, endpoint) maps to the same body. Reads answer with `enabled:false`.
- Value: as stated.
- Why: the flag state must not be visible, while state stays narrowable.
- Source: "RTC-g owner settings and portal ring" (RTCg-2 and its information item).
- Safe alternative: none recorded.
- Owner: ___

**RTCg-4. Portal ring eligibility**
- Decided: the ring covers an incoming (`callee`) record that is ringing, not held, not claimed, not own-entity, for a purpose with `alert: true`, not muted by principal or purpose, before `ringUntil`, and `alert === true` once the field exists. Nothing rings while the flag is off, even for an invite still ringing from before. Suppressing the ring while an endpoint for the purpose was seen recently is not implemented.
- Value: as stated.
- Why: `lastSeen` is set when a listen starts, so a long poll and a background app that cannot alert look the same; suppressing could hide calls the owner never hears.
- Source: "RTC-g owner settings and portal ring" (RTCg-4); "Review follow-ups" (F2).
- Safe alternative: suppress on `lastSeen`, left to the coordinator.
- Owner: ___

**RTCg-5. Declining an unanswered invite is a silent local end (see RTCs-1)**
- Decided: declining or ending an incoming record that no device has answered sends nothing to the caller, whose session rings out at `ring_until` (§12 "No presence oracle"; §4.4). The ring's Decline, the settings' Decline (ringing) and Remove (held) need no dialog, and the console hides the record in that tab until its deadline. Answered (claimed) and outgoing sessions keep "End" behind a confirmation, which does tell the other side. "Not now" hides the notice in this tab and sends nothing. The earlier reading (send `revoked`) is withdrawn.
- Value: the wording "The caller is not told whether you declined or put this off: the call just rings out. Not now only hides this notice here."
- Why: the first version sent `revoked`, a presence oracle (review F1). The engine now enforces the rule (RTCs-1).
- Source: "RTC-g owner settings and portal ring" (RTCg-5; review F1, coordinator option (a)).
- Safe alternative: tell the caller the call ended (the withdrawn reading), or a per-contact "show that I'm being rung" opt-in (RTC-8).
- Owner: ___

**RTCg-6, RTCg-14. What the ring shows before a claim**
- Decided: the ring carries only `sid`, the verified caller principal, a handle only for an active account on this host (foreign handles wait for the roster), the purpose and its title, media and the ring deadline, and the owner's own apps registered for the purpose (`clientId` and verified origin). It never carries context, basis or callback links, endpoint labels or secrets. The caller's app origin was left out here and added later (RTCs-7, RTCe-22). A principal shows as `@handle` when this host verified it, else the issuer host and the first 8 characters of `sub`, marked `translate="no"`.
- Value: the route tests pin the exact keys.
- Why: §9.1 and §12 limit data before the claim.
- Source: "RTC-g owner settings and portal ring" (RTCg-6, RTCg-14).
- Safe alternative: none recorded.
- Owner: ___

**RTCg-7, RTCg-8. "Open in app" and ring delivery**
- Decided: "Open in {app}" navigates in a new tab (`noopener noreferrer`) to the root of an endpoint's verified origin (https, or loopback http locally); the portal never claims. The ring polls `GET /api/rtc/ring` while the tab is visible on routes where it renders, shows at most 3 invites, and renders into its own polite live region so its arrival never rebuilds the console or moves focus.
- Value: 10 s polling; errors back off 10 s × 2^n, capped at 300 s, ±10% jitter, never sooner than `Retry-After`; one tab per account polls (leader lease of 1.5 intervals over BroadcastChannel `bindle-rtc-ring`, a hello wait of about 250 ms, each tab polling alone without BroadcastChannel); polling stops while the answer is `idle` (no invite, endpoint, contact link or live call link for an alerting purpose) until something can ring again.
- Why: polling cost and the web push doorbell dependency (the doorbell is RTCe-13); the ring must not take focus.
- Source: "RTC-g owner settings and portal ring" (RTCg-7, RTCg-8; review F4, F5, F8).
- Safe alternative: none recorded.
- Owner: ___

**RTCg-9, RTCg-10, RTCg-11, RTCg-12. Apps, automatic answers, contact links and requests**
- Decided: the apps list is read-only and comes from the owner's federation grants on the signaling slot fragment. Automatic answers are per app through `rtc.set-policy` `autoAccept`, only for purposes with `auto_accept: "self"` that the app holds. Contact links get one form per active link (parent is the grant id) offering purposes whose `parties` is not `self`; unchecking everything removes the configuration. The `none` basis is per purpose whose `parties` is not `self`, off by default; requests never ring and wait in the held list. The privacy and requests forms each send only their own policy members.
- Value: as stated. Review F7: `set-contact-rtc` with any purposes requires `parent` to be one of the owner's active contact links, otherwise the uniform 404; removing a configuration is allowed for any parent.
- Why: the owner approves each way of being called separately.
- Source: "RTC-g owner settings and portal ring" (RTCg-9 to RTCg-12; review F7).
- Safe alternative: none recorded.
- Owner: ___

**RTCg-13, RTCg-15, RTCg-16. Confirmations, controls not offered, and network privacy defaults**
- Decided: ending a session, revoking a call link, removing a device, blocking, clearing the whole missed list and narrowing an app run only from a matching `rtc-confirm` dialog; removing one missed entry, unblocking and declining from the ring do not ask. Mute and unmute have routes but no controls, call links are listed and revocable but only apps mint them (no QR code), and there is no command-palette entry. For other people `other` defaults to `relay` and offers `public`, and `all` is never offered; own devices default to `all` ("Direct") and offer `public` and `relay`.
- Value: as stated.
- Why: RTC-6 for the default; commands carry no feature gate and would reveal the view while off.
- Source: "RTC-g owner settings and portal ring" (RTCg-13, RTCg-15, RTCg-16).
- Safe alternative: none recorded.
- Update (2026-10-27, RTC wargame M6): RTCg-15 is partly superseded. Settings now list provider blocks and every mute with Unblock or Unmute, and the ring offers "Mute this app" (no dialog) and, for a foreign caller, "Block this provider" behind a confirmation (RTCw-M6-4, RTCw-M6-5). Bulk call-link revocation runs from its own dialogs (RTCw-M2-5). Muting a person, purpose or app from settings is still not offered.
- Owner: ___

**RTCg-copy. Owner-facing wording (digest label)**
- Decided: the English and Spanish strings for the calls view and ring are provisional copy.
- Value: Relay: "Relay only (recommended): The other person never sees your IP address; the relay does. The connection goes through the relay, which can be slower, and it cannot connect if neither you nor the app has a relay." Public: "Allow your public address…" (can reveal approximate location and internet provider). Relay operators: "A relay sees your IP address, that a connection happens and how much data it carries, but it cannot read calls or files." Contact links: "Who can call you … never written into the link". Requests: "Requests never ring: they wait in your missed and held list." SAS: "…if both of you see the same code, no provider or network in between can listen in. The app you use can still see the call." Block: "Their calls and requests are dropped without telling them and are not listed as missed."
- Why: these are privacy and legal-adjacent statements; the review (F6) corrected the relay, SAS and local-address wording.
- Source: "RTC-g owner settings and portal ring" (wording decisions; review F6).
- Safe alternative: none recorded. Counsel has not reviewed this copy.
- Owner: ___

#### RTC-e: foreign transport, endpoint and key roster

Source for every item below: "RTC-e foreign transport, endpoint and key roster (flags off)", its "Review follow-ups (2026-10-27, independent security review…)" and its "Verification follow-ups (2026-10-27, verification review of the fix round…)". Foreign issuers stay behind an empty allowlist until the Workers egress gate passes (security.md S4 unchecked; R2-M6 unmet).

**RTCe-1, RTCe-2. Contract route and bound check**
- Decided: the application actor `{kind:'app', owner, clientId, origin, grants, epoch, jkt?}` is built only from the verified dispatch context, with the token's grant ids required and the registered client's origin. `listen` and `endpoints` are reads and never journaled; RTC write results (leg certificates, ticket links) are not kept in the federation journal, so a retried `tx` answers `indeterminate`. While `RTC_SIGNALING_ENABLED` is off the `${subject}/rtc` descriptor is withdrawn, so even narrowing is unreachable through the contract (owners narrow through the RTC-g routes). `config.RTC_BOUND_CHECK` is `FederationController.checkBound` in the owner's shard on both adapters.
- Value: on Workers it calls the federation DO from inside an account call; the DO is not gated, so this looks safe but is unverified on a real DO.
- Why: §12 says ticket links are never retained.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-1, RTCe-2).
- Safe alternative: none recorded.
- Update (2026-10-27, RTC-i): contract writes no longer call `checkBound` from inside the account gate, which deadlocked on Node. They use the approval on the dispatch context (RTCi-1, RTCi-2). The port is still used for fan-out from stored endpoint records, outside the gate.
- Owner: ___

**RTCe-3, RTCe-4. One `aud` per batch, and the uniform 404 versus the spec's 202 (AMD-RI1, AMD-RI2)**
- Decided: a batch whose elements name more than one `aud` is refused at the route (`rtc_batch_invalid`). While `RTC_FOREIGN_ENABLED` is off (site-wide or for the addressed entity), and for an `aud` that names no active entity here, `POST /bindle/rtc` answers the uniform 404. Step 2 to 8 outcomes stay a uniform 202 with an empty body. This **differs from §8.2's "202 for every batch that passes step 1"**, and the spec needs a matching amendment (proposed, unsigned; not applied to the text).
- Value: the per-entity 404 reveals to any sender whether foreign RTC is enabled for that account (its flag cohort); it disappears when the flag is site-wide. Recorded, not changed.
- Why: an identity's existence and lifecycle are public through its identity document, so the 404 reveals nothing steps 2 to 8 decide.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-3, RTCe-4; RTCe-4 note in the review follow-ups); "RTC-i conformance peer: divergences and fixes" (divergences 6 and 8); spec §18 (AMD-RI1, AMD-RI2).
- Safe alternative: the spec's text, a uniform 202 for every addressed batch that passes step 1.
- Update (2026-10-27, RTC-i): the clean-room conformance run found both readings and kept them as intentional (two todos marked "plausibly intentional"). The amendments now have names in spec §18, proposed and not applied to the text: **AMD-RI1** (an unknown or inactive `aud` answers the uniform 404, with the rationale that the identity document and the directory `?sub=` lookup already make an entity's existence public, and that the 404 lets a sender stop retrying a dead target) and **AMD-RI2** (step 1 also checks that every element names the same `aud`, a `400`; it depends only on the batch, so it is no oracle). The spec status paragraph names AMD-RI1. Both need protocol and security review.
- Update (2026-10-27, RTC wargame L3, R1): the per-entity form is gone. A per-account flag-off now answers exactly as a flag-on entity: the route runs step 1 itself before the per-account branch (400 alike), and a step-1-valid batch goes to the flag-off writer as a `dark` ingest that takes a queue slot (503 alike when full) and is dropped unprocessed, else 202 (RTCw-L3). The uniform 404 now covers only an `aud` that names no active entity (AMD-RI1) and the deployment-wide flags or allowlist. The "Value" sentence above about the flag cohort is superseded, except for the drain-rate residual in RTCw-resid.
- Owner: ___

**RTCe-5, RTCe-16. The foreign allowlist and the manifest row**
- Decided: `RTC_FOREIGN_ISSUERS` is a JSON array of https origins, at most 64, empty by default; any invalid entry empties it. It gates directory fetches, delivery and roster scheduling; a claimed sender on a non-allowlisted issuer is never fetched, its keys are never held and its batches drop silently at step 3. While it is empty or invalid, `/bindle/rtc` answers the same uniform 404 as flag-off and the manifest withholds `rtc-signaling.v1`. The manifest row (`endpoint` `/bindle/rtc`, `max_leg_certificate_seconds` 600) needs `RTC_SIGNALING_ENABLED`, `RTC_FOREIGN_ENABLED`, `DIRECTORY_ENABLED`, `mounts.rtc` and a non-empty valid allowlist. On Node the `rtc` mount is set when `RTC_EGRESS` exists; on Workers it is always set. The occupant `extensions` entry is kept only beside a declared `extensions.v1`, which no slice declares yet.
- Value: 64 origins, 600 s.
- Why: it keeps cross-provider reach off until the egress gate passes.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-5, RTCe-16; review F7); "RTC-i conformance peer: divergences and fixes" (divergence 7, RTCe-16 revised).
- Safe alternative: none recorded.
- Update (2026-10-27, RTCe-16 revised by RTC-i): the manifest declared `rtc-signaling.v1` without `extensions.v1`, against §3.1. The signaling occupant row now declares `extensions.v1` itself (flags `RTC_SIGNALING_ENABLED` and `EXTENSIONS_ENABLED`, mount `rtcOccupant`), so the occupant's `extensions` entry is published as §3.2 and §15 expect. The `rtc-signaling.v1` row also needs `EXTENSIONS_ENABLED`, `ARTEFACT_VERSIONS_ENABLED`, the occupant mount and a mounted artefact store. Side effect: other rows' `extensions` entries (messaging-address and the RTC-f relay occupant) are now kept whenever this row declares `extensions.v1`, under their own flags and mounts. A later row that also wants `extensions.v1` must take over this member, because a duplicate feature fails closed. The sentence above about the occupant entry "kept only beside a declared `extensions.v1`, which no slice declares yet" is superseded.
- Owner: ___

**RTCe-6. Control statements bypass the foreign flag (corrected)**
- Decided: outbound control-only batches are not gated by `RTC_FOREIGN_ENABLED` (narrowing). They need only the allowlist, `DIRECTORY_ENABLED` and the egress, and their endpoint lookup takes the roster's control path (a held feature first, else a manifest fetch under the directory budgets). This host's endpoint still refuses a peer's controls while the flag is off (uniform 404). With an empty allowlist nothing is delivered.
- Value: as stated.
- Why: the first version's lookup went through the flag-gated directory, so the kill switch suppressed `revoked`/`failed` controls (review F2).
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-6; review F2).
- Safe alternative: none recorded.
- Owner: ___

**RTCe-7, RTCe-8. Delivery outcomes and invite re-send (corrected)**
- Decided: 202 is delivered. A network error, 429 or 5xx is retried with per-peer backoff until the item's useful life (§8.3). Any other answer (400, 404, a redirect) and an off-allowlist target are permanent and the row is dropped. After the first 202 a foreign invite is re-sent unchanged (current certificate and links) at most twice, 3 s after the acceptance and 12 s later, never after a permanent refusal; the callee ignores copies of an existing session.
- Value: 3 POSTs over a whole unanswered ring (before the fix, about 10).
- Why: §8.3 SHOULD re-send for a held-key miss; unbounded re-sends multiplied traffic about 10× (review F6).
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-7, RTCe-8 corrected; review F6).
- Safe alternative: none recorded.
- Owner: ___

**RTCe-9, AMD-RV2. Key refresh scheduling departs from the spec sentence**
- Decided: for every claimed sender of a step-1-valid batch whose keys are not held, or which names a kid that is not held, a refresh is attempted before steps 2 to 8, never as a fetch on the request path. Whether it is queued, and in which lane, depends on the source network (plain claims), a live or ringing session with the sender (`live`), or a link basis of an invite in the same batch that verified at step 2 without spending (`linked`). This departs from the spec sentence "the schedule does not depend on step 2" and is proposed as **AMD-RV2**, unsigned and not applied to the text.
- Value: only the sender's issuer can observe the difference, as the order of this host's directory GETs to it under load. Under load it could also infer whether a presented ticket or contact link is still live (within the step 3 exception, but recorded). The response and its timing never depend on steps 2 to 8.
- Why: it stops an unauthenticated flood of claimed senders from starving honest callers (RTCe-19 values).
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-9 corrected; review F1).
- Safe alternative: the spec sentence, which was the first implementation and was the cause of the starvation finding.
- Owner: ___

**RTCe-10, RTCe-11, RTCe-12. Key rotation, declared bound and no foreign handle**
- Decided: a certification key published at least one directory freshness period before use is picked up by refresh-ahead and sessions continue. An abrupt rotation loses the messages signed with the unheld key, their `seq` gap ends the leg `failed` after 10 s, and both providers converge to `ended`. A peer's leg certificates are checked against its issuer's declared `max_leg_certificate_seconds` as held, else 900. No foreign handle is shown in invite projections.
- Value: the operational rule is to publish a new certification key before signing with it.
- Why: no verified directory binding is held for a foreign handle.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-10, RTCe-11, RTCe-12).
- Safe alternative: none recorded.
- Owner: ___

**RTCe-13. Web Push doorbell**
- Decided: the doorbell reuses the host push transport (RFC 8291, `PUSH_ENABLED` and VAPID keys), is sent only to the subscription validated and stored at `register` after the admitting transaction commits, at most once per alerting invite per endpoint, with `Urgency: high`, the whole remaining ring seconds as TTL (nothing below 1 s), and the payload exactly `{"t":"rtc","endpoint":…}`. A subscription reported gone is removed. Pushes go out in parallel, at most 4 at a time, each with a 10 s timeout. The provisional WNS origin was dropped from `PUSH_ORIGINS`.
- Value: concurrency 4, timeout 10 s.
- Why: bounded by the invite limits; the host transport cannot deliver to WNS.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-13; review F7).
- Safe alternative: none recorded. Push delivery itself is unverified.
- Owner: ___

**RTCe-14, RTCe-21. Lifecycle triggers, and narrowing ends ringing invites silently**
- Decided: `FederationService.boundSync` runs after `revoke`, `narrowBoundOptions` and the app-removal cascade and tells the runtime the union of the client's remaining active bound grants, so the account runs `rtc.lifecycle` `app-revoked` or `app-narrowed`. The connection cascade (disconnect, removal, sever) also runs `app-revoked`. Both are best effort, not durable; the occupant re-checks the live approval on every operation and at fan-out. `app-narrowed` and `app-revoked` also end an unanswered, not held, ringing callee record when every endpoint it was delivered to belongs to that app and the app no longer holds the purpose; the end is silent towards the caller. An invite also delivered to another app's endpoint, or for a purpose the app keeps, or delivered to no endpoint, keeps ringing.
- Value: as stated.
- Why: a revoked app must not leave ringing invites; silence towards the caller keeps §12 (supersedes the "observed, not changed" bullet of RTCs-8).
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-14; review follow-up (b), RTCe-21).
- Safe alternative: none recorded.
- Owner: ___

**RTCe-15, RTCe-18. Successor index not wired; roster in memory**
- Decided: `current` is identity and moved identities are refused as before (RTCd-25 applies). The roster and refresh queue are in memory per writer and lost on eviction (cache-only); directory pins persist in the account store beside the organization directory's, under the same no-rollback rules.
- Value: roster bound 512 principals and 24 h; refresh queue 64 in total, 16 per issuer, 60 s negative cache.
- Why: moves are identity-portability work.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-15, RTCe-18).
- Safe alternative: none recorded.
- Owner: ___

**RTCe-17, RTCe-20. Inbound shedding and the Node client address**
- Decided: `POST /bindle/rtc` and the public relation endpoints share `admitSourceNetwork`: 600 batches a minute per source network (IPv4 /24 or IPv6 /48 of `CF-Connecting-IP`), or per (network, `CF-Worker` zone) under a network ceiling of 16× the per-network budget; it fails closed off loopback without an abuse store. The roster `source` is always the plain network pseudonym (an HMAC), so a zone never buys its own roster source. On Node the client address comes from `TRUSTED_CLIENT_IP_HEADER` only when the operator sets it (unset by default: the socket address); a value that is not one plain IP is `unknown`, client copies of `CF-Worker` are always dropped, and IPv4-mapped IPv6 addresses (any spelling) and `%zone` are normalized before bucketing. The operator's proxy must overwrite that header, never append; it applies to every Node route that reads `CF-Connecting-IP`.
- Value: 600 per minute, ceiling 16×.
- Why: per-network shedding before step 1; a forged zone buys at most 16× for the network it really comes from.
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-17, RTCe-20); "Review follow-ups" (F5); "Verification follow-ups" (V2, V3).
- Safe alternative: none recorded. Not verified on real Cloudflare or behind a real proxy (see the production gates).
- Owner: ___

**RTCe-19. Directory fetch classes and host-wide budgets**
- Decided: directory fetches have disjoint classes (`background`, `interactive`, `claimed`, `linked`), spent through per-writer buckets, the Node process-wide egress budget and, host-wide, `WORK_AUTHORITY` keyed `directory-host-v1/<feature>/<class>/<site>` (feature `rtc`, `org` or `other`). Each class also has a per-tenant share spent first. `interactive` has no host-wide class limit, only a tenant share, and `rtc.open` spends a per-owner `warms` limit before the caller-initiated fetch (only when the foreign callee's keys are not held). A failing limiter refuses the fetch (fail closed). Both the RTC and the organizations directories are wired.
- Value: host class limits per minute and site: background 1,200, claimed 120, linked 240; tenant share `ceil(class/16)` (claimed 8, linked 15, background 75, growing with the roster-scaled budget up to 300); interactive tenant share 40 a minute; `warms` 20 an hour per owner; Node egress sub-budgets: `claimed` and `linked` each at most a quarter of the background group's minute and day windows and a third of the tenant allowance. Roster lanes: `live` and `linked` share 32 queued entries with at most 8 per issuer, a plain `claimed` lane has at most 64 queued, 16 per issuer, and 4 queued and 8 schedules a minute per source network per writer; at most one queued entry and 4 schedules a minute per link.
- Why: an unauthenticated sender could starve all fetch classes, and a host-wide interactive cap lets a few accounts deny every other user. The cost of no interactive cap is that volume to one issuer scales with active accounts (about 20 new callees an hour per account).
- Source: "RTC-e foreign transport, endpoint and key roster" (RTCe-19 new); "Review follow-ups" (F1, F3, F4); "Verification follow-ups" (V1, V2, V4; RTCe-19 amended).
- Safe alternative: a host-wide interactive cap, rejected as a denial path.
- Owner: ___

**RTCe-22. A foreign caller's app origin is shown as "reported by" its provider**
- Decided: the ring answer carries `callerOriginReportedBy`, the caller's provider host for a foreign caller and null for a same-host caller. The ring reads "Calling app (reported by {provider}): {host}" (es: "App que llama (según {provider}): {host}"); a same-host caller reads "Calling app: {host}".
- Value: as stated.
- Why: a malicious provider can certify any origin (RTCs-7). If RTC-17 is rejected at sign-off, the label goes with the line.
- Source: "RTC-e foreign transport, endpoint and key roster", "Review follow-ups" (follow-up (a), RTCe-22).
- Safe alternative: omit the origin for caller privacy (RTC-17's alternative).
- Owner: ___

**RTCe-resid. Residual risks recorded, not fixed (digest label)**
- Decided: the entry records these as accepted for now.
- Value:
  - the RTC `claimed` class can still be exhausted host-wide by claims aimed at 16 or more writers (16 × 8 ≥ 120), and `linked` by public contact links of 16 or more writers (16 × 15 ≥ 240); live peers, `warm` and refresh-ahead are protected, and only plain first contact (a `request` basis, off by default) or link-verified first contact is delayed;
  - every Worker-hosted peer provider reaching a writer from Cloudflare's shared egress network shares one plain-claim source and that network's 16× ceiling;
  - interactive outbound volume grows with the number of active accounts;
  - an attacker with many IPv6 /48s can still starve the plain claimed lane;
  - the values (shares, `warms`, `priorityPerIssuer`) are provisional pending §13 load tests.
- Why: closing them needs the load tests and production data.
- Source: "RTC-e foreign transport, endpoint and key roster", "Review follow-ups" (production gates) and "Verification follow-ups" (residual risks).
- Safe alternative: none recorded.
- Owner: ___

**RTCe-open. Not implemented in RTC-e (digest label)**
- Decided: these were deliberately left out: the integration doorbell event `rtc-ring/v1` (AMD-R3), the successor index, a durable retry for the bound-approval hook, the `moved` control at move commit, and publishing the contract and slot artefacts. The narrowing route listed here was added by RTCs-8.
- Value: as stated.
- Why: each depends on another slice or a decision.
- Source: "RTC-e foreign transport, endpoint and key roster" ("Not implemented").
- Safe alternative: none recorded.
- Update (2026-10-27): the `rtc-signaling/v1` contract and slot manifest now ship as first-party built-in documents while the flags are on, but are not published (RTCi-8). The `ice-relay/v1` slot and contract are still not shipped (RTCi-open).
- Owner: ___

#### RTC service follow-ups for the owner UI

Source for every item below: "RTC service follow-ups for the owner UI (flags off)". It closes the RTC-g production gates G1 and G2 locally and provisionally.

**RTCs-1, RTCs-5. The engine enforces the silent decline (the silent-decline rule)**
- Decided: every owner end of an unanswered incoming record is silent, whether or not `silent` was sent: no control statement, no batch and no missed entry, `rtc.end-session` takes an optional `silent: true` that needs `caller`. The route keeps an identical shape check. Declining therefore never tells the caller anything, even for an older client or another adapter.
- Value: `silent` applies to a live callee record that is `ringing` with no claim, held or not; the answer is `{sid, state:'ended', silent:true}`. Before this change `rtc.end-session` without `silent` sent a `revoked` control to the caller of a ringing invite.
- Why: that was an engine-level presence oracle (§12; §4.4: "a decline reveals that a callee device saw the invite"). The rule lives in the engine because the architecture is engine-first. The caller can only observe a claim, so spec §12 holds as written and no spec change is needed.
- Source: "RTC service follow-ups for the owner UI" (RTCs-1, RTCs-5; RTCg-5).
- Safe alternative: tell the caller (the withdrawn RTCg-5 reading), or a per-contact "show that I'm being rung" opt-in (RTC-8).
- Owner: ___

**RTCs-2, RTCs-3. The `declined` reason and the own-entity twin**
- Decided: the silent end uses the existing local `declined` end reason: endpoints see `state: ended`, nothing carries the reason, and it stays out of the missed list. For an own-entity twin, "silently" means no control statement and no missed entry, but the owner's own calling device is told `ended`, because it is not another entity (§12 does not apply).
- Value: as stated.
- Why: an end with no state event would leave the owner's own device ringing until `ring_until`.
- Source: "RTC service follow-ups for the owner UI" (RTCs-2, RTCs-3).
- Safe alternative: none recorded.
- Owner: ___

**RTCs-4. `silent` on any other record is `invalid_args`, not a no-op**
- Decided: `silent: true` against a claimed (answered) session, a record declined by a device claim, an outgoing record or one already ended is refused as `invalid_args`. An unknown record is `not_found`.
- Value: a decline racing the claim or the ring-out shows the console's error and changes nothing.
- Why: a claimed session must never end through `silent`.
- Source: "RTC service follow-ups for the owner UI" (RTCs-4).
- Safe alternative: a no-op returning the state.
- Owner: ___

**RTCs-6. Alert recomputation is one-way**
- Decided: a callee record's `alert` is the admission decision AND no current mute of the principal, purpose or the caller's application, recomputed on every read. A mute set while an invite rings silences it at once; lifting a mute never turns `alert` on for an invite admitted while muted. An unreadable caller application fails closed (`callerOrigin` null, `alert` false).
- Value: as stated.
- Why: the callee's apps already received the invite with `alert: false`, so an unmute must not resurrect it.
- Source: "RTC service follow-ups for the owner UI" (RTCs-6); closes gate G1 locally.
- Safe alternative: none recorded.
- Owner: ___

**RTCs-7. The caller's application origin before claim (RTC-17)**
- Decided: a callee record carries `callerOrigin`, the `client.origin` of the caller's verified leg certificate (new records store `callerClient {client_id, origin}`; older ones read it from the held certificate). The owner view and the ring show it as plain owner data (`translate="no"`), never as a link and never in place of the verified caller principal.
- Value: this host cannot check the origin independently, so a malicious provider could name any origin (RTCe-22 labels foreign ones "reported by").
- Why: §9.1's `listen` projection gives the callee's endpoints the origin before any claim, and RTC-17 (adopt, unsigned) discloses it to the callee.
- Source: "RTC service follow-ups for the owner UI" (RTCs-7).
- Safe alternative: omit it for caller privacy. If RTC-17 is rejected, `callerOrigin` and the ring line must be removed with it.
- Owner: ___

**RTCs-8. Narrowing an app's purposes**
- Decided: `POST /api/rtc/narrow-app` `{clientId, purposes}` runs in the owner stage and is exempt from capacity admission. The fragment is fixed to the signaling slot, and narrowing applies to every active grant of the app for that slot, each keeping its intersection. A widening is a 400 `bound_options_widening` while the flag is on and the uniform 404 while off. The slot schema requires at least one purpose, so "remove all" stays the app access view's revoke; an app with one purpose lists it only. The console confirms through `rtc-confirm`, naming the app and listing "No longer approved" and "Still approved". The federation owner path (`FederationController.narrowBoundOptions`, `federationAuthority`, `federationRemote`, the Worker DO allowlist) was added.
- Value: as stated.
- Why: the RTC-g console had no way to narrow bound purposes.
- Source: "RTC service follow-ups for the owner UI" (RTCs-8).
- Safe alternative: none recorded. A real Durable Object round trip for `narrowBoundOptions` is unverified.
- Owner: ___

#### RTC-f: relay occupant

Source for every item below: "2026-10-27 — RTC-f relay occupant (flags off)" and "2026-10-27 — RTC-f review follow-ups", with spec §3.3 and §18 (AMD-RL1). The built-in `ice-relay/v1` occupant is unreachable unless `RTC_SIGNALING_ENABLED` and `RTC_TURN_ENABLED` are both on for the owner **and** the deployment supplies a TURN adapter and an external spend authority (`RTC_RELAY_SPEND`). No spend authority ships, so hosted relay stays off on every deployment. The Cloudflare adapter ran only against injected test doubles; no real secret was used.

**RTCf-1. When a leg is live**
- Decided: credentials are issued only for a live leg of the calling application's own session. For the caller, the session is opened and ringing before `ring_until`, or connected. For the callee, its accept claim won and the claimant is that leg's endpoint. In both cases the leg is certified, the session is before `endsAt` and at least 10 s of session life remain. Everything else is the uniform `not_found`: another entity's session, another endpoint's or application's leg, an unclaimed or declined callee record, an ended session, or a ringing one past `ring_until` that has not been ticked yet.
- Value: 10 s minimum remaining life. The check runs before the provider or the spend authority is called, and again in the transaction that records the issuance.
- Why: relay spend must follow a real call leg, never a session identifier alone.
- Source: "RTC-f relay occupant" (RTCf-1).
- Safe alternative: none recorded.
- Owner: ___

**RTCf-2, AMD-RL1. The built-in occupant also takes `endpoint` and `endpoint_secret`**
- Decided: `sid` alone does not name a leg, because both legs of an own-entity session share it, and an endpoint identifier alone never authorizes. The built-in occupant therefore also takes `endpoint` and, for a non-DPoP endpoint, `endpoint_secret`, bound exactly as in §9.1. Like `sid`, these are sent only to a built-in occupant. The contract `credentials({sid?}) → {ice_servers, expires_at}` and its result stay generic. The spec change is proposed as **AMD-RL1** (spec §3.3, §18), unsigned.
- Value: as stated.
- Why: without the endpoint binding, either leg of an own-entity session could draw the other's credentials.
- Source: "RTC-f relay occupant" (RTCf-2); spec §18 (AMD-RL1).
- Safe alternative: none recorded.
- Owner: ___

**RTCf-3, RTCf-4. Credential handling, lifetime and renewal**
- Decided: the credential is returned once and never stored, logged or journaled; leases keep TURN usernames only. The result keeps `turn:` and `turns:` URLs only and drops STUN, because an endpoint under `relay` policy never uses it and a TURN allocation also yields a server-reflexive address. A leg holds one credential at a time and may renew only in the last 60 s (less the expiry grace). An early renewal does not revoke the credential still in use; the old one lapses within 60 s or is revoked at leg end.
- Value: TTL min(300 s, the session's remaining life), and while the leg rings also at most `ring_until − now` (review M1(b)), recomputed after `spend.reserve` just before `adapter.issue` (L1). At most 4 URLs per entry and 4 entries. The recorded expiry is (time after `issue` returned) + TTL + `RELAY_EXPIRY_GRACE_MS` (5 s, for provider clock skew); the client is told the conservative `expires_at` (time before `issue` + TTL).
- Why: a credential that outlives its leg is spend nobody can attribute, and revoking the live credential on renewal would cut the allocation.
- Source: "RTC-f relay occupant" (RTCf-3, RTCf-4); "RTC-f review follow-ups" (M1(b), L1).
- Safe alternative: none recorded. Open question for the production gate: whether Cloudflare TURN allocations outlive a credential's expiry. If they do not, a long call needs an ICE restart about every 5 minutes (see "Unverified external assumptions").
- Owner: ___

**RTCf-5, RTCf-6, RTCf-7. Revocation on every end path, the sweep and the issuance race**
- Decided: every session end goes through `RtcService.end` (hangup, cancel, decline answers, peer control statements, endpoint removal, owner end-session, `rtc.lifecycle` `app-revoked`, `app-narrowed` and `deletion`, and the tick's timeout, expiry and gap failure), and its record keys reach `relay.ended` after the commit. The runtime revokes on the controller's detached pass, never inside the request. `rtc.relay-sweep`, which also runs inside `rtc.tick`, revokes every unexpired username of a dead leg, retries failed revocations until expiry, drops expired usernames without a call, deletes dead empty leases, clears an 'issuing' marker older than 60 s and prunes usage months older than the previous month. Liveness is checked again in the recording transaction; if the leg ended during the provider call, the credential is revoked at once, never returned, and the reservation refunded.
- Value: review fixes: unrevoked usernames from a failed issuance are kept and marked `orphan`, which the sweep revokes even on a live leg, and an issuance is admitted only when the lease has room for the most usernames one issuance can add (L2, replacing truncation that could drop unexpired usernames). Retries no longer depend on an unscheduled alarm: a `wake(owner, time)` port arms the writer's alarm, the catch path calls `defer` and `wake`, the sweep re-arms itself while revocations remain, and the runtime schedules a 60 s alarm if the sweep throws (L3). A lease is deleted only when its leg is dead, never merely because a flag is off, so the per-leg budget survives a flag flip (L4).
- Why: no credential the provider still accepts may belong to a non-live leg after a healthy sweep (the seeded chaos invariant).
- Source: "RTC-f relay occupant" (RTCf-5 to RTCf-7); "RTC-f review follow-ups" (L2, L3, L4).
- Safe alternative: none recorded. Residual: a crash between the provider call and the record leaves an unrecorded credential, which lapses within 300 s, as in Beam.
- Owner: ___

**RTCf-8, RTCf-9. Relay budgets and plan allowances**
- Decided: each issuance reserves an admission envelope against per-leg, per-account and per-plan budgets, refunded when nothing issued can still carry traffic. The plan comes from the account's billing entitlement. Organizations get no relay allowance, because none is modelled. These are **admission estimates, not byte caps**: a TURN credential does not limit bytes, and spec §10 forbids client-reported counts.
- Value:
  - 125 MB per issuance (300 s at about 3.3 Mbit/s, both directions); 3 GB per leg (session record);
  - per account and month: **Free 0, Paid 1 GB, Plus 10 GB, Ultra 100 GB**;
  - per account: 4 legs holding credentials at once, 60 issuances an hour, 64 lease rows, at most 8 usernames per lease;
  - cost model (provisional): planning rate US$0.05/GB egress with a deployment-wide free tier, neither rechecked against a primary source. With the whole allowance relayed every month on the typical profile, margins are Paid 53.5%, Plus 54.7% and Ultra 53.5%; prices are unchanged. A TURN price above about US$0.064/GB puts Paid under 50% (`tests/cost-model-relay.test.mjs` guards the floor). At full storage occupancy the person plans are already under 50% without any relay, a pre-existing fact now stated in unit-economics.
- Why: relay is real per-byte spend, and the allowances must keep the 50% margin floor.
- Source: "RTC-f relay occupant" (RTCf-8, RTCf-9; cost model); "RTC-f review follow-ups" (M1(c)). Unit economics "Hosted relay (provisional)".
- Safe alternative: none recorded. It is a highest-impact item.
- Owner: ___

**RTCf-rev. The spend authority contract and the byte-cap production gate (review M1; digest label)**
- Decided: the local allowance limits issuances, not bytes, so relayed bytes are bounded **only** if the external spend authority enforces caps using the usage it is given. `reserve` receives `sid` and `leg`; `commit(reservation, {owner, usernames, expiresAt, ttl, bytes, session, sid, leg, endpoint, clientId})` receives each credential's TURN usernames (never the credential), an upper bound of their expiry and the leg, so the authority can attribute the provider's per-username usage and revoke overruns. `reserve` must answer `enforced: true` before the provider is called.
- Value: **production gate (added):** before `RTC_TURN_ENABLED` is enabled anywhere, the spend authority must enforce per-owner byte caps from the TURN provider's usage feed, attributing usage through the usernames it receives at `commit` and revoking credentials that overrun. An authority that answers `enforced: true` without this does not pass the gate. Stress row (`relayAbuseStress()`): an abusive account with 4 concurrent legs at 4 Mbit/s each for 30 days and no enforcement relays 5,184 GB, about US$259 a month or US$3,110 a year, which puts every plan deeply negative; one unenforced month exceeds the highest annual price.
- Why: a TURN credential is not a byte cap, so without enforcement one account's spend is unbounded.
- Source: "RTC-f review follow-ups" (M1(a), M1(c), M1(d)); `docs/self-hosting.md` "Hosted relay"; design §8.3.
- Safe alternative: keep hosted relay off (the current state on every deployment; RTC-7).
- Owner: ___

**RTCf-10. Refusals let slot failover proceed (revised)**
- Decided: every refusal made before a credential exists is a no-effect outcome for the slot's ordered pre-dispatch failover, so a consumer moves on to the next occupant, for example a third-party relay. The occupant throws only codes that the federation runtime keeps **and** the slot treats as no-effect, with the detail in the message: `not_found`; `forbidden` (not in the plan); `rate_limited` (per-session bytes, the monthly allowance, concurrent legs, the hourly window, lease rows, usernames per lease, an issuance in flight, an already-issued credential, an unavailable provider or spend authority).
- Value: the original codes (`relay_not_included`, `relay_quota`, `relay_limit`, `relay_busy`, `relay_already_issued`, `temporarily_unavailable`) are gone.
- Why: a code outside the runtime's allow-list became `indeterminate`, which stops failover, so the original RTCf-10 claim was false (review M2).
- Source: "RTC-f relay occupant" (RTCf-10); "RTC-f review follow-ups" (M2, RTCf-10 revised).
- Safe alternative: none recorded.
- Update (2026-10-27, RTCf-10 revised): the original reading stopped failover on purpose for `relay_already_issued` and `relay_busy` (409). Busy and already-issued now let failover proceed, because both are no-effect and the only alternative code the runtime keeps, `conflict`, would record an "unknown" outcome. The cost: a consumer that lost its credential may use a third-party relay for up to 4 minutes. The runtime allow-list was not changed; `temporarily_unavailable` is missing from it (RTCi-open).
- Owner: ___

**RTCf-11, RTCf-12. Reachability, the kill switch and deletion**
- Decided: `rtc.relay-credentials` needs both flags, which the occupant checks itself, because class (b) `requires` is not evaluated from env (confirmed again). The account slice adds an early 404, and the `${subject}/relay` descriptor and the manifest occupant row also need both ports. Results are never journaled (`retainResult` excludes the relay contract). With either flag off every lease counts as dead for revocation: issuance stops at once, held credentials are revoked at the next sweep and lapse by their own expiry in any case. `rtc.lifecycle` `deletion` ends every leg, and `rtcDrain` sweeps and reports unrevoked, unexpired usernames as pending.
- Value: the kill switch takes full effect within 300 s; E4 waits for at most about 305 s plus provider latency. `rtc/relay/` (Transient) and `rtc/relay-use/` (Derived) are excluded from exports.
- Why: revocation itself is never gated, so turning relay off cannot strand spend.
- Source: "RTC-f relay occupant" (RTCf-11, RTCf-12); "RTC-f review follow-ups" (L1, L3 kill switch).
- Safe alternative: none recorded.
- Owner: ___

**RTCf-13, RTCf-14. Revoking only the relay grant, and third-party relays**
- Decided: there is no hook for revoking only an app's `ice-relay` grant: federation refuses new calls, and the credentials it holds lapse within 300 s. Revoking or narrowing the signaling slot ends the sessions and so revokes the credentials. Third-party relays are other occupants of the same slot; the contract is unchanged and `validateIceRelayResult` checks any occupant's result. Core has no consumer of the slot yet (neither the portal nor any app code).
- Value: **precondition (recorded):** before any consumer of the slot ships, its per-occupant argument builder must send `sid`, `endpoint` and `endpoint_secret` only to the built-in occupant, never to a brokered one, and must have a test.
- Why: third parties must never learn session identifiers or endpoint secrets (spec §3.3).
- Source: "RTC-f relay occupant" (RTCf-13, RTCf-14); "RTC-f review follow-ups" (Info: brokered occupants).
- Safe alternative: none recorded.
- Owner: ___

**RTCf-open. Not implemented in RTC-f (digest label)**
- Decided: deliberately left out: an owner view of relay usage, organization allowances, the portal as a provider consumer of the slot, a hook for revoking only the `ice-relay` grant (RTCf-13), and first-party `ice-relay/v1` slot and contract documents (RTCi-open).
- Value: as stated.
- Why: each depends on another slice or a decision.
- Source: "RTC-f relay occupant" ("Not done"); "RTC-i conformance peer" (open questions).
- Safe alternative: none recorded.
- Owner: ___

#### RTC-i: conformance peer, divergences and review fixes

Source for every item below: "2026-10-27 — RTC-i conformance peer: divergences and fixes" and "2026-10-27 — RTC-i review follow-ups", with spec §18 (AMD-RI1 to AMD-RI5). A clean-room peer written only from the spec text drove the real Node provider and found 10 divergences. Divergences 6 and 8 are RTCe-4 and RTCe-3 (kept, AMD-RI1 and AMD-RI2, recorded on that item), and divergence 7 revised RTCe-16 (recorded on that item). The suite simulates TLS and DNS through the egress injection ports, so it is not evidence of interoperability over the network.

**RTCi-1. Contract writes carry their bound approval on the dispatch context (divergence 1; review L4)**
- Decided: the default Node bound check hung every contract write, through a lock-order cycle between the owner's account gate and federation-shard gate. `FederationService.rpc` now computes the token's bound approvals per fragment inside the RPC's own authorization transaction (only grants of the token's subject, client and epoch bound to the connection `tokenRecord` has just checked live) and puts them on the dispatch context (`bound`). `contractActor` copies the signaling slot's approval onto the app actor, never from arguments; a missing, malformed or other fragment's approval approves nothing. `RtcService.approved` evaluates it with `boundAllows` and never calls the shard; fan-out from stored endpoint records still uses the port, outside the gate. `boundApproval` runs its connection checks after its store transaction. The Worker gets the same fix. `rtcFlush`, which could self-deadlock and had no caller, is deleted (L4).
- Value: no account-to-shard call is made from inside the account gate on any RTC path.
- Why: an account-to-shard call inside the gate deadlocks against the established shard-to-account order.
- Source: "RTC-i conformance peer" (divergence 1); "RTC-i review follow-ups" (L4).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-2. An account-local approval record closes the narrowing race (review L1)**
- Decided: `rtcAppChanged` records, per client, `rtc/approval/<SHA-256 of the client id>` = `{clientId, purposes (list or null), revision, at}`, where `at` is the federation shard's clock in the `boundSync` transaction (the writer's clock stands in for direct callers), and a late older change never replaces a newer record. The dispatch approval carries `at` (the latest `bound.approvedAt` or `bound.narrowedAt`). `contractActor` intersects the dispatch approval with the record unless the approval is strictly newer: `purposes: null` approves nothing, an equal time intersects (fail closed), and a malformed or unreadable record approves nothing.
- Value: guarantee: any contract operation that enters the account gate after the hook sees the narrowing. Trade-offs recorded: a window remains between the shard commit and the hook entering the gate (an operation queued before the hook keeps its snapshot); `boundSync` stays best effort; comparing `at` relies on the shard's clock on both sides, so a re-approval in the same millisecond as a `boundSync` read is refused until the next change; one row per client, excluded from exports as Derived, which also makes an account with only this row run a cheap `rtc.tick`.
- Why: the dispatch snapshot could be bypassed by a racing narrowing or revocation. The live check before RTC-i had a narrower window, but it deadlocked.
- Source: "RTC-i review follow-ups" (L1).
- Safe alternative: none recorded. The dispatch `at` is unverified on a real Durable Object.
- Owner: ___

**RTCi-3. A root `x-bindle-brokerable: false` annotation is accepted (divergence 2)**
- Decided: `compileContractVersion` accepts `"x-bindle-brokerable": false` as an annotation at the contract root only and as a boolean only. Anywhere else, or non-boolean, it still fails closed (`artefact_unverifiable`). Brokered registration is unchanged: it is decided by the brokered contract pins, and the RTC contract is not among them.
- Value: as stated.
- Why: a clean-room contract carrying the marker could not be registered.
- Source: "RTC-i conformance peer" (divergence 2).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-4, AMD-RI5. `open` toward a peer without the feature answers `unsupported_peer`**
- Decided: `RtcKeyRoster.unsupported(p)` (cache only) is true when the issuer's fresh validated manifest declares no valid `rtc-signaling.v1`, and `open` then refuses with `unsupported_peer`; no identity document is fetched from such an issuer. An unknown or invalid manifest stays `temporarily_unavailable`. Proposed as **AMD-RI5** (spec §9.1 `open`), unsigned and not applied to the text: errors not specific to a method follow protocol §5, so a reference runtime MAY answer `indeterminate` for a write it cannot classify (it does so for `temporarily_unavailable` today).
- Value: as stated.
- Why: the occupant answered `temporarily_unavailable`, and the runtime remapped it to `indeterminate`.
- Source: "RTC-i conformance peer" (divergence 3); spec §18 (AMD-RI5).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-5. One `NO_EFFECT_CODES` set, with `claimed` and `unsupported_peer` (divergence 4; review L2)**
- Decided: the federation dispatcher's two literal lists are now one `NO_EFFECT_CODES` set, with `claimed` and `unsupported_peer` added; a code outside the set still becomes `indeterminate`. The stated rule is that at every raise site either nothing durable was written, or what was written is terminal. One named exception: the late `claimed` (a won claim whose session ended while its certificate was signed) keeps the claim record, leg-key thumbprint and `claimed` pushes, and is final: no certificate is handed out, the session is over and a retry answers `claimed` again.
- Value: `temporarily_unavailable` stays out of the set (RTCi-open).
- Why: the losing concurrent `claim` answered `indeterminate` (§7.2). A distinct code for the late case would invite a pointless retry, and `not_found` would wrongly let slot failover proceed; for slot failover `claimed` (409) is already `unknown`.
- Source: "RTC-i conformance peer" (divergence 4); "RTC-i review follow-ups" (L2).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-6. The manifest's DPoP declaration is optional (divergence 5)**
- Decided: `IdentityDirectory` accepts a manifest without `dpop_signing_alg_values_supported`. When declared it must still be a list of at most 16 algorithm names including `ES256`. The organization foreign directory and the RTC roster do not read it; device authorization's ES256 requirement is a separate client-side check, unchanged.
- Value: as stated.
- Why: protocol §2's floor does not require the declaration, so a conforming peer could not be called.
- Source: "RTC-i conformance peer" (divergence 5).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-7, AMD-RI3. A message naming no leg of the session is dropped**
- Decided: at step 7 the receiving provider drops a message whose `to` is neither the receiving side's leg nor `null` for `invite` or `cancel` (`applyPeerMessage`). Its `seq` is consumed, exactly as the other step-7 drops consume theirs. Proposed as **AMD-RI3** (spec §6.1, §8.2 step 7), unsigned and not applied to the text.
- Value: as stated.
- Why: such a message reached the receiving endpoint, leaving the expected-leg check to endpoints alone (§11.1).
- Source: "RTC-i conformance peer" (divergence 9); spec §18 (AMD-RI3).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-8. The `rtc-signaling/v1` contract ships first-party, and the shipped documents win (divergence 10; review L3)**
- Decided: while `RTC_SIGNALING_ENABLED` and `EXTENSIONS_ENABLED` are on, the §3.2 slot manifest is a built-in reviewed fragment in `federationSchemas`, and the §9.1 contract (`docs/artefacts/rtc-signaling-v1.json`, carrying `"x-bindle-brokerable": false`) is a built-in reviewed contract. **The shipped documents take precedence over operator registrations:** the slot manifest replaces an operator fragment for the same id, and `configuredArtefactDocuments` puts the shipped contract, under its plain id and its `/envelope`, in one source ahead of every other, so an operator that registers either key gets the shipped body under both. With either flag off nothing is added and operator registrations apply as before. Nothing is fetched and no host is trusted beyond these two ids.
- Value: the document is not published (`public-contracts.mjs` and the lock file are unchanged), because the `spec.bindle.example` placeholders are not publishable. The first version let an operator contract win over the built-in one while the built-in slot manifest replaced the operator's; L3 answered that open question provisionally.
- Why: no contract artefact was shipped, so a deployment depended on the operator registering one, and the two precedences were inconsistent.
- Source: "RTC-i conformance peer" (divergence 10; open questions); "RTC-i review follow-ups" (L3); `docs/self-hosting.md`.
- Safe alternative: operator registrations win (the first version's rule for the contract). It is a highest-impact item.
- Owner: ___

**RTCi-9, AMD-RI4. The `listen` event members, and context shaping**
- Decided: the shipped contract's result schemas list every member the occupant returns, because result shaping withholds unknown members. The `listen` event members are this provider's reading, proposed as **AMD-RI4** (spec §9.1 `listen`), unsigned and not applied to the text: every event has `type`, `sid` and `seq`; `invite` adds `invite`, `certificate` and `projection` (`caller`, `handle`, `origin`, `client_id`, `purpose`, `media`, `context`, `basis`, `alert`, `auto_accept`); `message` adds `message` and, with a leg's first message, `certificate`; `state` adds `state` and, when there is one, `control`.
- Value: the projected `context` lists only the properties of the registered purpose lines (`bytes`, `files`). A purpose line with new context properties needs a new contract version, or a shaping rule that keeps purpose-defined context members (open question).
- Why: contract documents written from the spec text would otherwise drop members.
- Source: "RTC-i conformance peer" (divergence 10; open questions); spec §18 (AMD-RI4).
- Safe alternative: none recorded.
- Owner: ___

**RTCi-10. App removal drains its external cascades outside the account gate (review M1)**
- Decided: force-removing an app that holds an RTC bound grant never answered on Node (older code), because the removal RPCs awaited the external cascade drain inside the non-re-entrant account gate, and the shard's `removalRevoke` → `boundSync` hook called back into the same account. `appRemovalOwner` and `appRemovalComplete` are now `gate:'none'`; each takes the gate itself (`underGate`, which checks the deletion fence) only for the commit, the connection cascade and the integration kick, then runs the external cascade drain (and `drainBrokeredEvents`) outside the gate, as the alarm already does. The Worker uses the same methods.
- Value: durability and retries are unchanged; a failed pass arms a 60 s alarm (`drainAfter`). The RPC still awaits the drain, so callers see the same completion.
- Why: removal must answer, and the token and RTC endpoints must go, even with the app's RPCs in flight.
- Source: "RTC-i review follow-ups" (M1).
- Safe alternative: none recorded. The removal drain's call back from the federation Durable Object is unverified on a real Durable Object.
- Owner: ___

**RTCi-11. The relay actor carries the narrowed signaling approval (revised)**
- Decided: *revised 2026-10-27 (RTC wargame M4):* the `ice-relay/v1` actor now carries the **signaling** slot's approval from the same token's dispatch context, narrowed by the same account-local approval record (RTCi-2), and `rtc.relay-credentials` checks the session's purpose against it before anything is reserved (RTCw-M4). A relay token without the signaling grant still carries an empty approval, so the check stays closed and off the shard. The relay grant itself is still not evaluated as a purpose approval.
- Value: as stated. Originally (RTC-i review) the relay actor carried an empty approval and did not read the approval record, on the reasoning that issuance needs a live leg, which required signaling approval at `open` or `claim`. The wargame showed a narrowed app could keep drawing relay credentials on a live session, so the check now runs.
- Why: the signaling approval is not the relay grant, but it is what says whether the session's purpose is still approved; an empty approval for tokens without the signaling grant keeps the check closed and off the shard (an absent approval would fall back to the port, a shard call inside the gate).
- Source: "RTC-i review follow-ups" (relay actor); "RTC wargame findings and fixes (engine/route)" (M4, RTCi-11 revised).
- Safe alternative: the empty approval (the RTC-i reading).
- Owner: ___

**RTCi-open. Open questions and what the suite does not cover (digest label)**
- Decided: open, no proposal adopted.
- Value:
  - `temporarily_unavailable` from RTC writes still becomes `indeterminate` through the runtime, though spec §4.1 says `open` answers it and the RTC-f review asked for it; adding it needs a per-adapter or per-contract no-effect declaration, because generic adapters raise it after partial effects;
  - contract versioning for purposes with new `context` properties (RTCi-9);
  - the `ice-relay/v1` slot and contract are still not first-party documents; the same decision as RTCi-8 probably applies;
  - AMD-RI1 to AMD-RI5 need protocol and security review;
  - not covered by the suite: §8.2 timing uniformity, glare and perfect-negotiation collisions, the SAS, certification-key rotation under load, account moves, Web Push doorbells, relay credentials, the §13 limit values, and real TLS and DNS.
- Why: each needs a decision or a test the slice did not attempt.
- Source: "RTC-i conformance peer" (open questions; not covered); "RTC-i review follow-ups".
- Safe alternative: none recorded.
- Owner: ___

#### RTC wargame: engine, route, tickets and spam controls

Source for every item below: "2026-10-27 — RTC wargame findings and fixes (engine/route)", "2026-10-27 — RTC wargame M2/M6: ticket lifecycle and spam controls" and "2026-10-27 — RTC wargame review follow-ups", with spec §18 (AMD-RW1 to AMD-RW6, all proposed and **not applied** to the normative text). A read-only wargame confirmed each finding with an engine test; the fixes are uncommitted local work on HEAD ce28f79, behind the same default-off flags. The engine/route entry numbers findings (H1, M1 to M5, L1 to L5) and the review numbers its own (R1 to R3, I1 to I6), so those items carry digest labels (RTCw-H1, RTCw-R1 and so on); the M2/M6 entry's IDs (RTCw-M2-n, RTCw-M6-n) are the DEVLOG's own. Revisions to earlier items are recorded on RTC-11, RTCd-4/RTCd-5, RTCd-10, RTCd-11, RTCd-14, RTCd-18/RTCd-19, RTCg-13/RTCg-15/RTCg-16, RTCe-3/RTCe-4 and RTCi-11.

**RTCw-H1, RTCw-L4. Unanswered invites end silently on every path, and the callee provider enforces the pre-claim rule**
- Decided: a §6.4 `fail` on the caller leg (a reused `seq` with different bytes, or a buffer overflow), the 10 s gap timeout in `rtc.tick` and `rtc.lifecycle` `deletion` all end an incoming, ringing, unclaimed record (held or not) with no control statement. The owner's endpoints still get `state: ended`, and the caller's session rings out at `ring_until`. Claimed and connected sessions still get their control statement. Before the claim, the callee provider itself drops at step 7 any caller-leg message other than `invite` or `cancel`, after step 5 consumed its `seq` (the AMD-RI3 reading); it no longer relies on the caller's provider.
- Value: as stated.
- Why: a caller that posts its own signed messages could tell an admitted invite from a dropped one (blocked, unconfigured, over a limit), with or without a callee device (spec §12 MUST).
- Source: "RTC wargame findings and fixes (engine/route)" (H1, L4).
- Safe alternative: none recorded.
- Owner: ___

**AMD-RW2. The public endpoint refuses a batch carrying this host's own issuer**
- Decided: `POST /bindle/rtc` refuses at step 1 (`400 rtc_batch_invalid`) a batch with any element whose `iss` is this host's origin. Same-host traffic travels only through the sender's own provider and the internal `rtcPeer` path, which applies §6 and §6.3 to its own endpoints first. Proposed as **AMD-RW2** (spec §8.1, §8.2 step 1), unsigned and not applied to the text.
- Value: as stated. The check depends only on the batch, so it is no oracle.
- Why: a batch posted directly with this host's `iss` skipped the sender-side checks the internal path applies (H1).
- Source: "RTC wargame findings and fixes (engine/route)" (H1, route); spec §18 (AMD-RW2).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-M1, RTCw-R2, AMD-RW3. Own-device, same-host and bound-ticket invites get their own windows**
- Decided: a `self` invite counts only against a per-entity `self` window and skips the host-wide per-caller limiter. A same-host caller's (issuer, callee) and (issuer, parent) windows are per-principal shares, and every non-preferred same-host invite also counts against a per-callee `sameHost` window, so foreign callers keep headroom; a foreign issuer's windows stay issuer-wide. A `preferred` invite (on a principal-bound ticket, callback tickets included, presented by the principal the ticket names: `samePrincipal(ticket.claims.principal, sender)`) counts against `pair`, `caller`, its ticket's `issuerParent` and a per-callee `preferred` window, never `callee` or `issuerCallee`. Bearer-link invites ring up to `calleeRinging`; `self` and `preferred` invites may also use `calleeRingingReserve` above it. Proposed as **AMD-RW3** (spec §13), revised after the review; unsigned and not applied to the text.
- Value: `self` 120 per hour per entity; `sameHost` 40 of the 60 per-callee invites an hour; `preferred` 60 per hour per callee; ringing 4 plus a reserve of 2. With 40 same-host callers the held-request cap (32) now binds instead of the shared issuer window (20). All provisional provider policy.
- Why: a same-host contact could spend the window `self` invites shared and silence the owner's own device-to-device calls for an hour (M1), and same-host shares could exhaust the per-callee window and drop the bound-ticket friend (R2). Beyond the review's request, `preferred` is also exempt from the foreign `issuerCallee` window, so one bearer-link user of a large provider cannot drop every bound-ticket friend on it; a leaked bound link presented by anyone else spends the ordinary windows.
- Source: "RTC wargame findings and fixes (engine/route)" (M1); "RTC wargame review follow-ups" (R2, and the `issuerCallee` extension, decided provisionally); spec §18 (AMD-RW3).
- Safe alternative: none recorded. It is a highest-impact item (with RTCw-M3 and RTCw-M2-2).
- Owner: ___

**RTCw-M3. Per-application endpoint cap and round-robin fan-out**
- Decided: `register` refuses more than `endpointsPerApp` live endpoints per application within the entity's 32. Fan-out (`fanoutOrder`) takes at most 8 endpoints per application, round-robin across applications: the caller's own application (the certificate's `client_id`, same-host callers only, see RTCw-M6-2) first in each round, then the others by their most recently active endpoint.
- Value: 8 endpoints per application, 32 per entity, at most 16 fanned out per invite.
- Why: one approved application could squat the endpoint cap and the fan-out and exclude every other application.
- Source: "RTC wargame findings and fixes (engine/route)" (M3); spec §18 (AMD-RW1, first sentence).
- Safe alternative: none recorded.
- Owner: ___

**AMD-RW1. Cross-application visibility of invites**
- Decided: proposed spec text (spec §7.2 or §12), unsigned and not applied: every application the owner approved for a purpose sees, at its eligible endpoints, every invite of that purpose fanned out to it (the verified caller principal, the caller's `client.origin` and `client_id`, the purpose, media, projected `context`, basis kind and the raw invite), and any one of them may claim (accept or decline) it for the owner. Approving a purpose for an application is consent to that visibility; an owner who wants an application not to see calls narrows or revokes its approval; a mute (§13) never excludes an endpoint (RTCd-5) and only silences the alert (RTCw-info). Update (2026-10-27): the proposed wording originally said "mute it", which contradicted the implementation; the coordinator corrected the spec row to match. The caller's-application-first preference applies to same-host callers only (RTCw-R3/I2).
- Value: as stated, together with the SHOULDs of RTCw-M3 (8 of 32 endpoints per application, round-robin fan-out).
- Why: M3 showed that one approved application could see every invite; the amendment states that visibility as part of what the owner consents to.
- Source: "RTC wargame findings and fixes (engine/route)" (M3); spec §18 (AMD-RW1).
- Safe alternative: none recorded. It is a highest-impact item.
- Owner: ___

**RTCw-M4. `send`, `renew` and relay credentials re-check the bound purpose (RTCi-11 revised)**
- Decided: `renew`, and `send` unless every message is `end`, `cancel` or `decline`, call `requireApproved` for the session's purpose. A contract RPC's actor carries its per-RPC approval narrowed by the account-local approval record (RTCi-2), so no shard call is made; stored-endpoint paths keep the port. `rtc.relay-credentials` reads the session's purpose in a short transaction and checks it before anything is reserved; the relay actor now carries the signaling approval (see RTCi-11).
- Value: ending is never refused, so narrowing never strands a call that wants to hang up.
- Why: spec §9.1 requires the bound purpose to be checked on every operation; a narrowed app could keep using a live session.
- Source: "RTC wargame findings and fixes (engine/route)" (M4).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-M5, RTCw-I1. Cheap local checks before eligibility (cost amplification)**
- Decided: `admitInvite` runs a local pass first (closed, duplicate, block, epoch, basis configuration, ticket liveness, the sid check, ringing and connected capacity, a read-only `limitsOpen` pre-check, then `takeLimits`). Only an invite that passed it reaches the host-wide limiter, the handle read and the eligibility checks, which are cached per (client, grants, epoch) within the invite. A second transaction re-runs the local checks without counting, atomically with the ticket spend, the record and the fan-out. Held requests skip eligibility.
- Value: limits are counted before eligibility, so an invite dropped by the second pass (a race) has still counted, which §13 allows ("after verification"). Shard calls: 0 for unconfigured and blocked invites.
- Why: eligibility checks ran before block, basis and limits, so a blocked caller could make the callee's provider do shard work per invite.
- Source: "RTC wargame findings and fixes (engine/route)" (M5); "RTC wargame review follow-ups" (I1).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-L1. An invite reusing a live `sid` is dropped**
- Decided: an invite whose `sid` is already in `rtc/dlv/<endpoint>/<sid>` of any live endpoint for another usable session is dropped silently (`sidTaken`, in both passes).
- Value: as stated, no spec change. Keying the index by caller was rejected, because it would change the `claim` and `send` lookups and the index layout for no further gain.
- Why: a colliding `sid` from a second caller redirected the callee's fan-out index.
- Source: "RTC wargame findings and fixes (engine/route)" (L1).
- Safe alternative: key the delivery index by caller (rejected).
- Owner: ___

**RTCw-L2. Missed-list rows fold per caller**
- Decided: `addMissed` folds rows with the same (caller, purpose, kind) into one newest row with a `count`.
- Value: `count` is kept in the row and the export; the owner view is unchanged.
- Why: one repeating caller could evict every other caller's missed history.
- Source: "RTC wargame findings and fixes (engine/route)" (L2).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-L3, RTCw-R1, RTCw-I3. A per-account flag-off answers like a flag-on entity (202 with dark ingest)**
- Decided: 404 at `POST /bindle/rtc` now means only that `aud` names no active entity (AMD-RI1) or that the deployment-wide flags or allowlist are off. The route runs `batchStep1` itself (issuer and crypto only, no per-account state) after the active-entity lookup and before the per-account flag branch, so a step-1-invalid batch answers 400 whatever the entity's flags. A step-1-valid batch for an entity whose own flags are off goes to its writer as a `dark` ingest (`rtc.ingest {dark:true}`): it takes a slot in the same bounded queue at the same byte size, so a full queue answers 503 alike, stores only its size, and `inboxPass` removes it unprocessed. `rtcPublicKeys` creates an entity's certification key whatever its own RTC flags say, so a same-host `open` toward it succeeds alike.
- Value: a flag-off account's writer now stores short-lived `rtc/inq/` rows (at most 256 rows and 4 MiB) and may schedule its RTC alarm. The key creation is bounded by callers' `opens` window (60 per hour per caller) and one key per entity. The route reads its clock from `env.RTC_CLOCK` in tests only.
- Why: the first L3 fix answered 202 for a flag-off entity before step 1 ran, while a flag-on entity answered 400 for a stale batch and only a flag-on queue could fill to 503, so the per-account flag still leaked (R1).
- Source: "RTC wargame findings and fixes (engine/route)" (L3, with its correction); "RTC wargame review follow-ups" (R1, I3).
- Safe alternative: the uniform 404 for a flag-off entity (the earlier RTCe-4 reading, which revealed the account's flag cohort). Residual: see RTCw-resid.
- Owner: ___

**RTCw-L5. Dead tickets are pruned before every cap check**
- Decided: `pruneTickets` reads every ticket row and, while more than `tickets × 3` dead rows (revoked, used up or expired) are kept, deletes the oldest dead ones first. It runs before every cap check (`mint_ticket` and the callback ticket at `open`).
- Value: at most 768 dead rows, so every row fits one 1,024-row read.
- Why: the cap count and the ticket list read at most 1,024 rows, so short-lived tickets could push live ones out of the count.
- Source: "RTC wargame findings and fixes (engine/route)" (L5).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-info. Two documented non-changes (digest label)**
- Decided: documented, not changed.
- Value:
  - `open` with a handle answers `not_found` on the runtime, because this host has no handle-to-principal index the account writer can read without a fetch. Spec §9.1 allows a handle; this host supports principals only until a handle index exists. It is recorded as a divergence with no amendment;
  - an application can undo `revoke-endpoint` by registering again: endpoint revocation removes one device instance and is not an application ban. To stop an application the owner narrows or revokes its grant, or blocks its origin; muting removes only the alert.
- Why: each needs another design (a handle index, an application ban) the slice did not attempt.
- Source: "RTC wargame findings and fixes (engine/route)" (information items 10 and 11).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-M2-1, RTCw-M2-3, AMD-RW6. Tickets record their minting app and are revoked with it**
- Decided: a ticket records the minting app's `clientId` and verified origin from the endpoint actor (`mint_ticket`, and the caller's `open{callback}`), as owner-visible data that never enters the link or the signed meta. `app-revoked` revokes every ticket that app minted; `app-narrowed` revokes each of its tickets that names any removed purpose (the whole ticket, because a link never admits less than it shows and the meta is signed); `deletion` revokes every ticket. Revocation is narrowing and never gated. Proposed as **AMD-RW6** (spec §4.3), unsigned and not applied to the text.
- Value: revoked rows stay listed until the existing prune (a day after creation).
- Why: tickets outlived the app that minted them, so removing an app left its call links working (M2).
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M2-1, RTCw-M2-3); spec §18 (AMD-RW6).
- Safe alternative: none recorded. It is a highest-impact item (with RTCw-M2-2).
- Owner: ___

**RTCw-M2-2, RTCw-I5. Per-app ticket quota and mint window**
- Decided: at most 64 live tickets per app, callbacks included, inside the unchanged account cap of 256; revoked, exhausted and expired tickets free the quota at once. `mint_ticket` also has a per-app, per-account `mint` window, counted after the quota check and also for the callback ticket at `open{callback}`.
- Value: 64 per app; `mint` 120 per hour. 120, not the suggested 30, because the window must stay above the quota so an app can fill it in one burst (for example pairing); it still bounds churn of short-lived tickets.
- Why: one app could squat the whole 256-ticket cap.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M2-2); "RTC wargame review follow-ups" (I5).
- Safe alternative: none recorded. Residual: four approved apps together can still fill the cap (RTCw-resid).
- Owner: ___

**RTCw-M2-4. Legacy tickets without an app**
- Decided: tickets with no `clientId` (minted before this change; the flags were always off, so none should exist outside development) are attributed to no app. The console lists them as "Unknown app" with "Revoke all from unknown apps"; no app event revokes them; they count only against the account cap and still expire at most 30 days after minting.
- Value: as stated.
- Why: attribution is impossible after the fact.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M2-4).
- Safe alternative: revoking every legacy ticket on any app event, or attributing them to the app that next mints (both rejected).
- Owner: ___

**RTCw-M2-5, RTCw-I6. Owner bulk revocation of call links**
- Decided: `rtc.revoke-ticket` takes exactly one of `{jti}`, `{clientId}` (null for legacy) or `{all:true}`. Bulk forms answer `{revoked:true, count}`; an unknown `jti` answers the uniform 404. The console groups call links by minting app with "Revoke all from this app", "Revoke all from unknown apps" and "Revoke all call links", each run only from its own confirmation dialog.
- Value: "Revoke all from unknown apps" opens its own confirmation, "Revoke every call link from unknown apps?" (en and es), not the "this app" wording.
- Why: the owner needs to clear an app's links, or all links, in one step.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M2-5); "RTC wargame review follow-ups" (I6).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-M6-1, AMD-RW4. Blocking a whole caller provider**
- Decided: an owner blocks a caller provider with `rtc.block {issuer}` (an https origin). It is checked at the same admission step as a principal block, so a blocked provider's invites are dropped silently, never recorded as missed, and answered exactly like any other batch (202, same body). Blocking ends that provider's ringing invites silently. Re-blocking is idempotent. Proposed as **AMD-RW4** (spec §13), unsigned and not applied to the text.
- Value: at most 256 provider blocks under `rtc/block-iss/`, separate from the 1,000 principal blocks. No new operation class: `rtc.block` and `rtc.unblock` carry the new input, so their narrowing and widening classification is unchanged.
- Why: a foreign issuer can mint principals at will, so blocking principals one by one did not stop it (M6).
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M6-1); spec §18 (AMD-RW4).
- Safe alternative: none recorded. It is a highest-impact item (with RTCw-M6-2).
- Owner: ___

**RTCw-M6-2, RTCw-R3, AMD-RW5. Provider and app-origin mutes, scoped to the asserting provider**
- Decided: new mute kinds `issuer` (a provider) and `origin` (the calling app's origin from the caller leg certificate). Mutes still deliver without alert, are re-evaluated on every session read, and an unmute never makes an already-admitted silent invite alert (RTCs-6). `app` and `origin` mutes take an optional `issuer`: for a foreign issuer the mute is stored as `app@` or `origin@` with `[issuer, value]` and covers only that provider's callers; an absent, null or own issuer stores the unscoped key, which now covers same-host callers only. An `issuer` mute no longer covers this host's own callers. Fan-out preference by `client_id` applies only to a same-host caller (I2). Proposed as **AMD-RW5** (spec §13), revised after the review; unsigned and not applied to the text.
- Value: the ring's "Mute this app" sends `issuer: callerProvider` for a foreign caller; settings show scoped rows with "(reported by {provider})" and the asserted `client_id` raw, never matched to the owner's approved apps. No migration: a pre-existing unscoped row stops covering foreign callers (the flags have never been on).
- Why: a foreign caller's `client.origin` and `client_id` are only what its provider asserts, so an unscoped mute let a foreign provider get a genuine app muted for everyone (R3).
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M6-2); "RTC wargame review follow-ups" (R3, I2); spec §18 (AMD-RW5).
- Safe alternative: none recorded. It is a highest-impact item (with RTCw-M6-1).
- Owner: ___

**RTCw-M6-3. Own-entity rule for blocks and mutes**
- Decided: this host's own issuer can never be a provider block or provider mute target (`invalid_args`), and the owner's own principal can never be blocked. At admission, an invite from the owner's own entity is never blocked (by principal or provider) and never muted by provider or app origin, whatever rows are stored. Same-host app-origin mutes apply to other people's calls only.
- Value: as stated.
- Why: every own-device session is same-issuer, so a block must never break own-device sessions; this host's principals are verified accounts and are blocked one by one.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M6-3).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-M6-4. Ring controls: "Block this provider" and "Mute this app"**
- Decided: "Block this provider" sits beside "Block caller" and opens the same kind of confirmation ("one tap" read as one tap to the dialog, as for RTCg-13), only for a foreign caller (`callerProvider` not null). "Mute this app" needs no dialog, like other mutes, and moves focus to the next invite; it does not appear for an invite without an origin.
- Value: the ring route adds `callerProvider` (the caller's issuer origin when it is not this host, else null).
- Why: the owner needs the M6 controls where the call arrives.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M6-4).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-M6-5. Settings list blocks and mutes (RTCg-15 partly superseded)**
- Decided: the blocked panel becomes "Blocked and muted", with People, Providers and Muted lists, each removable (Unblock, Unmute). Both are widening, so they answer the uniform 404 while RTC is off, when the view is hidden anyway. Muting a person, a purpose or an app from settings is still not offered.
- Value: as stated.
- Why: provider blocks and the new mutes need a way back.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M6-5).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-copy. Owner-facing wording for the wargame controls (digest label)**
- Decided: the new English and Spanish strings (36 + 36 in the M2/M6 round, 3 + 3 in the review) are provisional copy: the provider-block confirmation naming the provider, the bulk revocation confirmations, the "Blocked and muted" lists, "Mute this app", and "(reported by {provider})" on scoped mute rows.
- Value: as stated.
- Why: a provider block and bulk revocation are consequential owner actions, and "reported by" is a trust statement.
- Source: "RTC wargame M2/M6: ticket lifecycle and spam controls" (UI); "RTC wargame review follow-ups" (R3, I6).
- Safe alternative: none recorded. Counsel has not reviewed this copy.
- Owner: ___

**RTCw-resid. Residual risks recorded, not fixed (digest label)**
- Decided: the entries record these as accepted for now.
- Value:
  - **flag-cohort drain rate (R1):** a dark row drains faster than a processed one, so a sender comparing drain rates under a sustained flood could still infer an account's per-account flag; it controls processing cost on both sides only coarsely;
  - four approved apps together can still fill the 256-ticket cap (4 × 64); the owner sees each app's links and can revoke them per app;
  - an invite dropped by admission's second pass has still counted against the limits (RTCw-M5);
  - legacy tickets are revoked by no app event (RTCw-M2-4);
  - an application can register again after `revoke-endpoint` (RTCw-info);
  - the values (`self` 120/h, `preferred` 60/h, `sameHost` 40/h, ringing reserve 2, 8 endpoints per app, fan-out 16, 64 tickets per app, `mint` 120/h) are provisional provider policy pending §13 load tests.
- Why: closing them needs load tests, production data or another design.
- Source: "RTC wargame review follow-ups" (R1 residual; open); "RTC wargame M2/M6: ticket lifecycle and spam controls" (RTCw-M2-2 residual, RTCw-M2-4); "RTC wargame findings and fixes (engine/route)" (M5, verification).
- Safe alternative: none recorded.
- Owner: ___

**RTCw-open. Open after the wargame (digest label)**
- Decided: open, no proposal adopted.
- Value:
  - AMD-RW1 to AMD-RW6 need protocol and security review, and none is applied to the normative text;
  - whether to exempt `preferred` from the foreign `issuerCallee` window (decided provisionally in RTCw-R2);
  - handle support for `open` (RTCw-info);
  - not run: the Worker runtime against real Durable Objects, real WebRTC and a real second provider over TLS.
- Why: each needs a decision, a review or an environment the slice did not have.
- Source: "RTC wargame findings and fixes (engine/route)" (open; verification); "RTC wargame review follow-ups" (open; verification).
- Safe alternative: none recorded.
- Owner: ___

## Region, legal and compliance

**RL-1. Unknown regions are blocked on the Worker**
- Decided: on 3sln.me, an unknown country cannot sign up or check out.
- Value:
  - an unknown country (`XX`), Tor (`T1`), a missing country or an invalid `REGION_POLICY` is blocked;
  - Node defaults to `allow-unknown` and reads the country only from `TRUSTED_COUNTRY_HEADER`;
  - local development allows unknown countries only on a loopback `http` origin;
  - this applies to signup, paid checkout, `/api/config` and transfer-in.
- Why: the region block failed open.
- Source: "Billing, retention and region wargame fixes".
- Safe alternative: none recorded. Allowing unknown countries was the prior behaviour.
- Owner: ___

**RL-2. EU block extended to outermost regions and Åland**
- Decided: the representative block adds territories that are legally part of the EU.
- Value: GP, MQ, GF, RE, YT, MF and AX are added. Their retained age rules follow France (15) and Finland (13).
- Why: the block missed them (B5, compliance).
- Source: "Billing, retention and region wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**RL-3. Territorial scope: counsel question (open)**
- Decided: these territories are **not** blocked, pending counsel.
- Value: JE, GG, IM, GI, BL, PM, NC, PF, WF and TF.
- Why: whether GDPR, UK GDPR or DSA reach them is a legal question.
- Source: "Billing, retention and region wargame fixes" (open questions).
- Safe alternative: none recorded. Blocking them is the conservative direction.
- Owner: ___

**RL-4. EU/UK representatives and Polar as merchant of record (counsel)**
- Decided: in the coordinator's view, Polar acting as merchant of record does not remove the need for EU/UK representatives. Sign-ups are blocked for launch *(user)*.
- Value: about €420–850 a year per regime for GDPR, plus a DSA legal representative.
- Why: Polar's role covers the payment, not the account data.
- Source: "2026-10-22 — User decisions: legal operator, artefacts, organizations, portability"; "2026-10-22 — EU/EEA/UK sign-ups blocked for launch…".
- Safe alternative: keep the block.
- Owner: ___

**RL-5. Governing law, venue and refunds** *(user; counsel review still required)*
- Decided: South Dakota law, South Dakota courts, and no refunds as of right.
- Value: venue was the coordinator's default, later stated by the user as "the courts of South Dakota". Billing offers only USD in blocked locations.
- Why: user decision.
- Source: "2026-10-22 — EU/EEA/UK sign-ups blocked…"; "2026-10-22 — Refunds, ownership transfer…".
- Safe alternative: none recorded.
- Owner: ___

**RL-6. Paid-checkout age and region gate everywhere**
- Decided: organization creation, billing, claim, transfer-accept and redirect-extension checkouts require a fresh paid-age attestation and the region policy.
- Value: an "I am N or older" checkbox. The break-glass checkout uses the same gate.
- Why: those checkouts were unguarded (M3, compliance).
- Source: "Billing, retention and region wargame fixes"; "ORG-12b/12e…".
- Safe alternative: none recorded.
- Owner: ___

**RL-7. Moved-identity privacy text (flagged for the legal owner)**
- Decided: no change. privacy.md has no moved-identity paragraph.
- Value: the proposed paragraph omits the 30-day/7-day statement retention, which names the new address.
- Why: the legal README says the text is updated when the flags turn on.
- Source: "Portability: redirect end/retarget, expiry reminder, intake gaps".
- Safe alternative: none recorded.
- Owner: ___

**RL-8. Organization terms and legal process**
- Decided: organization terms (ORG-13) are a production gate. BG-8 asks counsel to review legal process before public organizations.
- Value: none.
- Why: break-glass changes control of an organization.
- Source: "ORG-12 break-glass design".
- Safe alternative: none recorded.
- Owner: ___

**RL-9. Privacy text: new "App storage summaries" bullet (legal-text change awaiting owner approval)**
- Decided: the AU-S6 workstream added a bullet to `docs/legal/privacy.md`, which is uncommitted in the working tree as of this update.
- Value: the bullet reads: "**App storage summaries.** For writes through our storage gateway, we keep bounded counts and byte totals by app connection and resource prefix, without a separate file-name log per app. These summaries help you review what remains after removing an app and are included in your account export. They do not describe copies an app keeps elsewhere."
- Why: the privacy policy must describe the new producer summaries (AP-12).
- Source: "2026-10-24 — AU-S6 producer summary, What's left and removal reminders".
- Note: this is legal text. Counsel review of the privacy policy is still required (RL-5).
- Safe alternative: none recorded.
- Owner: ___

## UI and product copy

**UI-1. Organization console address and recovery-file guard**
- Decided: the console uses a shell address, and an unsaved recovery file is guarded.
- Value:
  - the address is `/console?view=organizations[&org=]`;
  - unsaved state is kept as organization ids only in `localStorage`, guarded by `beforeunload` and an in-app guard;
  - the invitation is kept in `sessionStorage`;
  - two tabs coordinate a recovery claim, refreshed every 15 s and expiring after 60 s.
- Why: browser QA findings F-1 to F-3 and M3.
- Source: "Organization console UX pass"; "Organization console UX pass 2".
- Safe alternative: none recorded.
- Owner: ___

**UI-2. Admin power only through an invitation**
- Decided: the member form does not offer "Admin" to a non-admin member, and points to a bound invitation instead.
- Value: as stated.
- Why: the server refuses the change (`bound_invitation_required`).
- Source: "Organization console UX pass 2".
- Safe alternative: none recorded.
- Owner: ___

**UI-3. Device labels and pending-setup hints**
- Decided:
  - touch plus a narrow viewport suggests a phone or tablet, otherwise a computer;
  - a TV is an explicit choice;
  - pending setup in other tabs is a non-secret hint;
  - recovery eligibility is display metadata only.
- Value: account reads retry at 250 and 500 ms, three attempts.
- Why: findings from the browser QA probe.
- Source: "UI quality pass (browser probe findings)"; "UI quality pass 2".
- Safe alternative: none recorded.
- Owner: ___

**UI-4. Console bundle and static shell copy**
- Decided: the console ships as a content-addressed bundle. The static heading is "Welcome to 3sln.me." A `noscript` notice says JavaScript is required, in English only.
- Value: about 54% faster cold Slow 4G signed-in readiness.
- Why: console first-load performance.
- Source: "Console first-load performance".
- Safe alternative: none recorded.
- Owner: ___

**UI-5. Break-glass wizard and interstitial copy**
- Decided:
  - an "owner is gone?" wizard shows the alternatives first;
  - the owner interstitial offers Stop, Contact support and Not now;
  - co-sign items appear in the console, not in activity v2.
- Value: the disclosure says 30 to 127 days of paid time may be lost.
- Why: ORG-12e.
- Source: "ORG-12b/12e owner channels, abort links and console".
- Safe alternative: none recorded.
- Owner: ___

**UI-6. Cold foreign organizations read as unverified**
- Decided: the consent screen uses a cache-only directory lookup.
- Value: on the first view, a cold foreign organization reads as unverified.
- Why: the fetch is kept off the request path (F1).
- Source: "Links, Beam, device and directory wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**UI-7. Naming** *(user decision; ledger line blank)*
- Decided: keep "Relation / Relationship" and "slot", and say "relation slot" where ambiguous.
- Value: none.
- Why: user decision.
- Source: "2026-10-22 — User decisions: Parley data on deletion, org identity, certificates, naming".
- Safe alternative: none recorded.
- Owner: ___

**UI-8. "Not now" on the owner interstitial lasts until reload**
- Decided: dismissing the break-glass owner interstitial with "Not now" lasts only until the page reloads, and the copy says so in both languages.
- Value: reload.
- Why: the DEVLOG records it as a provisional choice without a further reason.
- Source: "UI quality pass 3 (browser probe round 3)" (provisional dismissal choice).
- Safe alternative: none recorded.
- Owner: ___

**UI-9. What the browser keeps across refresh (abort capability, wizard answers, transfer retries)**
- Decided: some private state is kept in the browser so a refresh or an interrupted step does not lose it.
- Value:
  - a validated abort-notice capability is kept in tab-scoped `sessionStorage` after the fragment is removed, restored on reload, and cleared after a successful submission;
  - failed and indeterminate break-glass Start results keep the private wizard and answers through refresh, and success clears them;
  - a `step_up_required` transfer error keeps the operation privately and retries after the security check.
- Why: browser probe findings M1, M2 and M4.
- Source: "UI quality pass 3 (browser probe round 3)".
- Safe alternative: none recorded.
- Owner: ___

**UI-10. Firefox module loading: import map and preloads (build choice)**
- Decided: the CSP-hashed import map is parser-visible before preloads and the classic wire-up. The build removes the generator's duplicate map installation and keeps its stylesheet and deferred-entry behaviour. Hashed module preloads remain.
- Value: 453 identical file paths and digests across two builds. A local agent cross-review found no actionable CSP issue, which is not human sign-off.
- Why: browser probe finding M6 (Firefox module loading).
- Source: "UI quality pass 3 (browser probe round 3)".
- Safe alternative: none recorded.
- Owner: ___

**UI-11. Admin console: organization cases view and audit controls**
- Decided: administrators get an "Organization cases" view, hidden in boot mode, in English and Spanish. "Verify entire chain" shows in boot mode only.
- Value: 143 catalogue keys. The view shows channel kinds with ages and disputed, undeliverable and excluded badges, no addresses, and "decisions left today". Administrators keep the checkpointed check of the page they read. "Show more claims" and "Show more reservations" paginate the overview.
- Why: ORG-12d needed an operator console, and the full-chain walk is boot-only.
- Source: "ORG-12d support adjudication" (console; wargame 4 admin items).
- Safe alternative: none recorded.
- Owner: ___

**UI-12. Background status polling for deletion and export**
- Decided: a background check skips `/api/account/deletion` while `accountDeletionEnabled` is off and `/api/exports` while `accountExportEnabled` is off, unless the status was last seen pending (a deletion scheduled or executing, an export queued, generating or sealing). An explicit open or refresh always reads both. The timer runs only while something is pending, never while the page is hidden, and resumes on `visibilitychange`.
- Value: back-off starts at 30 s, doubles after each unchanged check, up to 10 min; any change or an explicit open resets it.
- Why: the bug hunt saw needless requests with both features off (F5), while a request started before a flag was turned off must stay visible and serviceable.
- Source: "Browser bug hunt fixes (post Beam removal)" (decision 4).
- Safe alternative: none recorded.
- Owner: ___

**UI-13. F14: the ignored `sandbox` token in the meta CSP (owner decision, not applied)**
- Decided: nothing. Removing the `sandbox` token from the meta CSP was refused by the session's permission classifier as a security-weakening edit, so it is left for the owner. The token has no effect when delivered in a `<meta>` CSP and browsers log a warning; the iframe `sandbox` attribute is what isolates the content, and the review confirmed restored app messages render through the same sandboxed frame.
- Value: removing it means changing `apps/web/src/bl/activity-content.mjs` and `CONTENT_CSP` in `packages/content/render.mjs` together, because `tests/browser/activity-contract.mjs` requires them to match. It is the only remaining console warning in the bug-hunt browser run.
- Why: it is a security-relevant edit with no effect on isolation either way.
- Source: "Browser bug hunt fixes (post Beam removal)" (Not done, F14); "Bug hunt fixes: server review follow-ups" (Owner decision).
- Safe alternative: keep the token and accept the console warning (the current state).
- Owner: ___

**UI-14. Fixed HTML 404 page for unknown browser navigations**
- Decided: a browser navigation (`GET` with `Accept: text/html`) that reaches the static-asset fallthrough and misses gets one fixed `NOT_FOUND_PAGE`, served `noindex` and `no-store` through `securePage`. Account-addressed paths and API routes are answered earlier, so the body is identical for every unknown path. Immutable `/assets/` misses and non-HTML requests keep the asset answer, and both variants send `Vary: Accept`. The uniform-404 rules in `public-unknown.mjs` are untouched.
- Value: as stated.
- Why: a bare 404 for a browser navigation was a poor experience (F18), and the page reveals nothing beyond the public asset set.
- Source: "Browser bug hunt fixes (post Beam removal)" (decision 6); "Bug hunt fixes: server review follow-ups" (I-1).
- Safe alternative: none recorded.
- Owner: ___

**UI-15. Bug-hunt follow-ups deferred as product questions**
- Decided: these were deliberately not implemented.
- Value:
  - F7, splitting the console bundle;
  - the landing tagline "Your files" is a product question now that Beam is gone;
  - a Spanish locale for the landing page;
  - branding of the consent header;
  - with activity v2 on, peer messages are not reachable from the activity view (predates this work; see MC-22).
- Why: they need product direction.
- Source: "Browser bug hunt fixes (post Beam removal)" (follow-ups).
- Safe alternative: none recorded.
- Owner: ___

## Operations and limits

**OL-1. Sign-in abuse limits**
- Decided: these are the sign-in rate limits.
- Value:
  - email sign-in: 5 per 15 minutes and 12 per 6 hours per mailbox, 5,000 per hour per region and 20,000 per hour overall;
  - per handle: 20 per 5 minutes, charged only by a failed password after Turnstile;
  - boot passkey: 10 per minute and 50 per hour per IP, 600 per 5 minutes per principal;
  - boot password: removed (boot is passkey only; coordinator decision under owner delegation, 2026-10-29, provisional), so no boot password window remains.
- Why: identity wargame findings #3 and #6–#10.
- Source: "Identity and federation wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**OL-2. Anonymous authorization requests**
- Decided: anonymous authorization requests have their own bounds.
- Value: 8 per network and client, 16 per network, 64 per IPv6 /48, and 512 per shard.
- Why: finding #4.
- Source: "Identity and federation wargame fixes".
- Residual: more than 32 networks can fill a shard.
- Safe alternative: none recorded.
- Owner: ___

**OL-3. Directory egress budgets on Node**
- Decided: directory fetches on Node are budgeted per tenant and per traffic class.
- Value:
  - per tenant and issuer: 10 per minute and 60 per hour interactive;
  - each class gets half of the global windows;
  - global: 600 per minute, 100,000 per day, concurrency 8;
  - `MEMBER_ACQUIRE_PER_MINUTE` is 30;
  - per site: n/2 + 30 per minute;
  - cache: 8–64 MiB.
- Why: findings F1 and F5.
- Source: "Links, Beam, device and directory wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**OL-4. Break-glass outbox and notice caps**
- Decided: the break-glass outbox and notices are capped.
- Value: 128 done rows kept, 24 non-critical owner notices per claim, new claims refused at 256 pending effects, 64 tokens reserved for final notices, and 16 channels. Owner signals retry for 8 attempts or 7 days.
- Why: a filled outbox blocked owner aborts (H1).
- Source: "ORG-12a/12c break-glass engine and billing"; "ORG-12b/12e…".
- Safe alternative: none recorded.
- Owner: ___

**OL-5. Message index builds at boot**
- Decided: indexes for an existing catalog build in bounded steps. Reads return 503 until the build is done.
- Value: 100,000 index rows per step and a 1 s alarm.
- Why: building 12 indexes over 100,000 rows took 2–3 s.
- Source: "Scalability fixes…" (follow-up 5).
- Safe alternative: none recorded.
- Owner: ___

**OL-6. Search and artefact bounds**
- Decided: search tags are bounded, poison events are tombstoned with an operator alert, and the negative cache is bounded.
- Value: 32 user tags plus 24 system tags. The intent negative cache is an LRU of 1,024.
- Why: findings Q1 and F1.
- Source: "Messaging, search and deletion wargame fixes"; "Intents and app-removal wargame fixes".
- Safe alternative: none recorded.
- Owner: ___

**OL-7. Admin and operator audit reads are bounded**
- Decided: audit reads spend a rate window and the full chain walk is boot-only.
- Value: `AdminService.audit` charges the per-actor read window (300 per 10 minutes) in a commit that writes no audit entry. `verify: true` is boot-only (`verify_boot_only`). `org-cases.audit` is charged the same way.
- Why: admin audit reads were unbounded and `verify` re-walked the whole chain (wargame L3).
- Source: "ORG-12d support adjudication" (wargame 4 admin items (a)).
- Safe alternative: none recorded.
- Owner: ___

**OL-8. Admin claim caps and pruning**
- Decided: an administrator may hold a limited number of outstanding claims, and finished claims are pruned.
- Value:
  - at most 20 outstanding claims per administrator (`claims_outstanding_limit`), and boot is not capped;
  - finished claims (revoked, or expired without redemption) are pruned 30 days after expiry or revocation, at most 20 per mint, from a rotating cursor, with the name pointer removed, and each prune audited (`claim.prune`);
  - redeemed claims are never pruned, because they are internal provenance;
  - the overview pages claims and reservations with `claimsAfter` and `reservationsAfter`.
  - The DEVLOG says the grace, batch and cap figures are provisional.
- Why: the overview listed only the first 100 claims and reservations with no cursor (wargame L4).
- Source: "ORG-12d support adjudication" (wargame 4 admin items (b)).
- Safe alternative: none recorded.
- Owner: ___

**OL-9. Export failure deadlines and charging**
- Decided: an export that cannot finish is failed and cleaned up, and failures not caused by the owner's own data volume do not count against the weekly allowance, up to a cap.
- Value:
  - a second `export_part_missing`, 24 consecutive failures, or 3 days from the job's first step (`startedAt`, not `createdAt`) marks the job `failed` with `cleanupPending`, then runs `cleanup()`;
  - data failures are charged (`export_payload_missing`/`changed`/`invalid`, `export_path_collision`, `export_pin_budget`, `export_row_limit`, `export_metadata_limit`);
  - system failures are uncharged at most `EXPORT_UNCHARGED_PER_WEEK` (2) times per 7 days;
  - the account alarm backs off from 60 s, doubling to 1 h;
  - `ExportLayout` accepts only `['owner']`.
- Why: exports could never end (M4). The deadline counts from `startedAt` because generation may start after the 3-day security `notBefore`.
- Source: "Operator and lifecycle wargame fixes" (M4, reading 3, review follow-up on export allowance).
- Safe alternative: none recorded.
- Owner: ___

**OL-10. Deletion request limits and the deletion notice change**
- Decided: deletion requests are rate-limited, and every new request gets its own "scheduled" notice and cancel link. The earlier quiet window for scheduled notices was removed after review.
- Value:
  - 3 requests per account per 24 h, inside `schedule()`, with admin bases exempt so an owner loop cannot block an admin closure;
  - receipts are capped at 16 and expire after 30 days;
  - routes allow 10 POSTs per session and 60 per /24 every 10 minutes;
  - a request writes its due row and arms a 5-minute backstop alarm before any external Polar call.
- Why: a request/cancel loop was unbounded (L1). A re-request minutes after a cancel left the owner holding only the dead link from the first request, which is why the quiet window was removed.
- Source: "Operator and lifecycle wargame fixes" (L1, L2, reading 2, review follow-up, deletion quiet window).
- Safe alternative: the quiet window (the removed reading).
- Owner: ___

**OL-11. Flag service: separate rate windows, outage reading and quarantine**
- Decided: the flag service has its own rate windows, a leftover env value never forces a flag on during an outage, and one stale record no longer poisons the snapshot.
- Value:
  - windows `flags-admin-<owner>`, `flags-read-admin-<owner>`, `flags-boot` and `flags-read-boot`; flag-console reads (list, get, history, preview, evaluate, seed-verify) spend `flags-read-*` at 300 per 60 s and are not audited;
  - the pre-console compatibility rule applies only when an empty snapshot was actually read and is usable (`flags.usable`), and a dependency whose reason is `outage` or `outage-last-known` never returns the legacy env value;
  - storage reads validate records one at a time, a rejected record is listed in `quarantined`, and only that flag follows its outage policy, never legacy env. Writes stay strict;
  - the console list shows quarantined records (English and Spanish).
- Why: shared rate keys (M2), leftover env force-on during an outage (M3), one stale record poisoning the snapshot (L5).
- Source: "Operator and lifecycle wargame fixes" (M2, M3, L5, plausible items).
- Safe alternative: none recorded.
- Owner: ___

**OL-12. `flags.retire` semantics**
- Decided: a new critical, audited operation removes one quarantined stored flag record. A still-registered flag is replaced by its off record, not deleted.
- Value:
  - it needs a passkey step-up, a reason, the typed name and the expected version;
  - for a registered flag, the same commit replaces the stored record with the registry's off record (`empty()`, a fresh salt and the next revision), adds a revision-history row and records the replacement as the audit `after`;
  - if the env state is force-on-legacy, retire refuses unless `acknowledgeGates:['legacy-env']` is given;
  - an unregistered (retired) name is deleted;
  - a quarantined record of a still-registered flag must be retired, then seeded again, and cannot be edited in place;
  - `RETIRED_FLAGS` is guarded by `tests/flags-registry-removals.test.mjs` and the name lock `tests/fixtures/flag-registry-names.json`.
- Why: a quarantined record needed an explicit, reviewed exit.
- Source: "Operator and lifecycle wargame fixes" (L5, reading 4, review follow-up on `flags.retire`).
- Safe alternative: none recorded.
- Owner: ___

**OL-13. Drive disconnect sweep and abandoned OAuth state**
- Decided: a Drive disconnect marks the resource removed, then sweeps its rows in batches, but keeps rows that carry producer evidence.
- Value:
  - the marker is `drive/removed/<id>`, written in the transaction. The sweep covers `drive/object/<id>/` and `drive/retained/<id>/` in batches of 100, at most ten per call, with a persisted cursor;
  - `drive/object/` rows with `producer` or `createdBy` evidence are kept, bounded by the 10,000-object cap, and left to the owner's What's left action or the account purge;
  - upload and folder journals are kept as evidence (capped at 100 per account), and `drive/folder-pending/` journals are pruned on begin after 7 days;
  - each begin prunes up to 50 expired `drive/oauth/` rows, and a session end deletes that session's row;
  - a refresh that lists extra scopes moves the resource to `reauthorization_required`.
- Why: a disconnect left rows (L7) and OAuth state was abandoned (L8). The kept rows reconcile with AU-S6.
- Source: "Operator and lifecycle wargame fixes" (L7, L8, plausible items, review follow-ups).
- Safe alternative: none recorded.
- Owner: ___

**OL-14. Other lifecycle storage and refresh bounds**
- Decided: small bounds and a new key family set added by the wargame fixes.
- Value:
  - an account writer re-reads the authority single-flight once its copy is 5 minutes old, even at the edge's version;
  - MCP `eraseSubject` keeps a durable per-owner cursor (`mcp/v1/erase/<owner>`);
  - the Node deletion-due sweep always starts, follows the live flag port with background semantics, and only the env kill stops it;
  - `ownedBlobRef` includes `rpc-results/<owner>/`;
  - new account key families `push-session-ended/`, `drive/removed/` and `deletion/request-log`. The first two are classified in the export inventory, and the purge removes all of them.
- Why: wargame 4 findings L6 and the plausible items.
- Source: "Operator and lifecycle wargame fixes" (L6, plausible items, reading 5).
- Safe alternative: none recorded.
- Owner: ___

**OL-15. Retention totals maintained by triggers, with a bounded backfill rebuild**
- Decided: retention totals are kept incrementally by SQL catalog triggers, and an existing catalog is backfilled in small steps.
- Value:
  - triggers maintain item contributions and per-unit totals with each insert, update and delete, atomically with the catalog mutation. A move removes the old contribution and adds the new one;
  - an existing catalog backfills at most 200 source rows per call, interleaved with writes, deletes and moves;
  - ordinary inventory has no message-wide GROUP BY, and audit tests keep the full aggregate as an independent oracle;
  - exact-accounting reconciliation, unknown-size behaviour and monotonic retention deadlines are preserved.
- Why: each inventory read re-aggregated every message (probe cliff #6). Measured: 100,000 messages and 10 units, 75.564 ms before and 0.102 ms after.
- Source: "Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" (#6).
- Safe alternative: none recorded.
- Owner: ___

**OL-16. Key tombstones: exact membership rows, unbounded cold migration**
- Decided: anti-reuse lookups use exact SHA-256-addressed membership rows instead of reading all archive pages, at a storage and write cost. The first migration is deliberately not bounded.
- Value:
  - membership rows compare actual kids (no Bloom filter), alongside an append-page pointer and bounded archive pages. Both legacy layouts migrate once, atomically;
  - cold migration for 12,800 old kids read 131 list rows plus 12,813 gets (519,664 bytes) on the first prune;
  - warm prune after that: 31 rows and 8,936 bytes;
  - before release, the rollout must ensure no older writer runs for an owner after the new version has migrated that owner. Otherwise an older instance can prune kids without writing membership rows, and a pruned kid could be reused. Examples are a single code version per identity object, or a drain/cutover deployment. Nothing is implemented, and it falls under the production gates.
- Why: key tombstone anti-reuse lookups read every page (probe cliff #7).
- Source: "Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" (#7; review follow-up 7).
- Safe alternative: none recorded.
- Owner: ___

**OL-17. Directory working-set cache split**
- Decided: compact identity and key verification material has its own byte- and entry-bounded cache, separate from disposable full documents and move history.
- Value: at 5,000 maximum-size documents, verification entries improve from 323 to 5,000 and evictions from 4,677 to 0. Verification-cache serialized bytes go from 49,282,048 to 1,655,000. Each tier keeps its documented cap, so combined memory can exceed the former single-tier cap, and serialized-byte accounting is not heap RSS. Full-history callers still fetch the full document after eviction.
- Why: verification entries were being evicted by full documents (probe cliff #8).
- Source: "Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" (#8).
- Safe alternative: none recorded.
- Owner: ___

**OL-18. Signed intent header `kid` with control characters is refused**
- Decided: a signed intent header whose `kid` contains control characters, such as a newline, is refused as `intent_malformed`. The drift audit's read-only reproduction showed `packages/intents/format.mjs` accepting a newline, contrary to the links §3.1 profile that intents §3.3 inherits.
- Value: attribution was still stripped, so no forged-attribution claim is made. The fix has a test in `tests/intents-kid-controls.test.mjs`. The audit found no other code defect and changed no code itself.
- Why: finding 1 of the audit; the coordinator fixed it as a follow-up.
- Source: "Spec/implementation drift audit" (finding 1; coordinator follow-up).
- Safe alternative: none recorded.
- Owner: ___

**OL-19. Drift audit readings kept as they are**
- Decided: two audit findings were deliberately left unchanged, and both rules stay recorded.
- Value:
  - **link authoring strictness (finding 4):** `packages/runtime/contact-links.mjs` rejects unrelated query parameters when authoring a link, with an explicit message, although links §2 rule 7 says they do not invalidate a link. Recipient verification still ignores them. The audit calls it a suspected sender-helper gap, not a reproduced admission failure;
  - **moved-delegation exception (finding 5):** the 200 final-revoked response during a live redirect window follows the explicit portability §10 rule (`moved.mjs:74–76,101–106`) and is not established as a defect, despite tension with the general uniform-404 wording. After the window, ordinary uniform-404 handling applies;
  - the other two findings (organization clean removal, contact-delivery 401 versus 404) are AP-17 and MC-10.
- Why: the audit kept both as deliberate or explicit policy.
- Source: "Spec/implementation drift audit" (findings 4 and 5; coordinator follow-up).
- Safe alternative: for finding 4, loosen the sender helper to accept unrelated parameters. For finding 5, none recorded.
- Owner: ___

**OL-20. Test reliability fixes: new fixed bounds in tests**
- Decided: test-only changes that keep assertions strict. Product code did not change, and no slot leak or deadline bug was found.
- Value:
  - the discovery contention tests wait for fetcher entry instead of a 10 ms sleep, and release their gates in `finally`;
  - one cleanup hook closes adapters and connections before removing their directories, with bounded retries, because Node 24 skips later `after` hooks when an earlier one throws;
  - the DX and export generation loops allow 1,000 steps (the old limit of 60 had no headroom) and stop on terminal states;
  - clients and CLI children prefer IPv4; tests have 180 s timeouts and CLI children a 120 s hard kill;
  - a historic 30-minute process was not ours and was neither inspected nor killed, so its trigger is unconfirmed.
- Why: flaky and hanging tests. The full-suite green requirement was unmet in the concurrent relations scope at the time of the entry (since reported green by later entries).
- Source: "Test reliability fixes".
- Safe alternative: none recorded.
- Owner: ___

**OL-21. `LINKS_ENABLED` replaces `BINDLEBOX_ENABLED` in core, with an env alias**
- **Update 2026-10-27:** Parlay (`apps/parlay`) now reads `PARLAY_ENABLED`, with `BINDLEBOX_ENABLED` as its own retired env alias; the core rule here is unchanged (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Decided: `LINKS_ENABLED` (class a, stateful) gates the links contract, key-delegation certificates and routes, the messaging-address descriptor and declaration, `MESSAGING_DESCRIBE` and the member-certificate fall-through. `BINDLEBOX_ENABLED` moved to `RETIRED_FLAGS` (`retiredOn 2026-10-26`, `replacement: 'LINKS_ENABLED'`), stays in the name lock, and a stored console record under the old name is quarantined. A new registry field `envAlias` makes `parseEnv` and `legacyValue` read the retired env name while the new name is unset (the new name always wins); only `LINKS_ENABLED` declares one.
- Value: the core `wrangler.jsonc` and `wrangler.local.jsonc` set `LINKS_ENABLED: "false"`. Parley (`apps/bindlebox/*`) keeps reading its own raw `BINDLEBOX_ENABLED`.
- Why: the links plumbing is core and must not hang on Parley's flag; the alias keeps existing deployments' env working.
- Source: "Messaging extraction prep (no reset)" (decision 2).
- Safe alternative: a plain rename without the alias, which would silently turn the links contract off in deployments that still set the old env name.
- Owner: ___

**OL-22. Retiring an aliased flag carries its record; a quarantined alias takes the outage path**
- Decided: when `LINKS_ENABLED` has no record of its own and its `envAlias` (`BINDLEBOX_ENABLED`) is quarantined, the flag takes the outage path, as a quarantined record of its own would, so a console kill or allowlist under the old name is never widened by the old env name. `flags.retire` of a retired name whose `RETIRED_FLAGS.replacement` declares it as `envAlias`, while the replacement has no record, carries the record to the new name in the same audited commit. The record is re-validated at rev 1, and if its shape no longer fits the off record is written; the commit expects the new record to be absent. The audit and the result carry `carriedTo` and `carried`.
- Value: as stated.
- Why: the env alias widened a narrowed flag (review F1).
- Source: "Messaging extraction prep (no reset)" (review follow-up F1).
- Safe alternative: none recorded.
- Owner: ___

**OL-23. Export inventory gaps closed with reasoned exclusions**
- Decided: `mcp/operation/`, `mcp/operation-expiry/`, `automation/session/`, `automation/confirmation/`, `classifier/usage/v1`, `app-notification-budget/`, `app-notification-receipt/`, `message-postback-prepared/`, `developer-contact/` and `link-gc-cursor/` now each have a reasoned exclusion, and `mcp/v1/*` gets none because it lives in the MCP shard stores, not the account store. The inventory test scans `packages/mcp/account.mjs`, `packages/automation/account.mjs` and `packages/activity/app-messages.mjs` and pins the new families.
- Value: the `developer-contact/` exclusion text says exactly that only the configured developer account's pointer is served (MC-19).
- Why: those families had no inventory entry because the scan missed constant-assigned and templated keys.
- Source: "Messaging extraction prep (no reset)" (item 5; review I1).
- Safe alternative: none recorded.
- Owner: ___

## Open scope questions (core-scope audit 2026-10-26)

These are owner questions about what stays in the 3sln.me core now that app experiences, starting with Beam, are leaving it. They are questions, not decisions: nothing is proposed as adopted, and nothing is implemented because of them. DEVLOG records the first as an open gate ("BB-CUT awaits explicit user confirmation of the irreversible message data reset") and the second in "Beam removed from core" ("Whether they belong in core is a pending user decision"). The third and fourth come from the audit. As of HEAD 6a192a3 the DEVLOG entry "2026-10-26 — Core-scope audit" records all three audit questions and points to SQ-1 to SQ-4 here, with the audit's own classification as MC-20.

**SQ-1. Confirm the irreversible BB-CUT message-data reset**
- **Answered 2026-10-27 by the user:** "Confirmed, drop the data, nobody is actually using 3sln.me yet; destructive cleanup is fine for now." The reset is implemented (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Question: confirm that when legacy messaging leaves core (BB-CUT, roadmap Wave 6), a `messaging-retired-v1` step discards all existing local messages, contacts, conversations and blocks instead of migrating them.
- Context: it is the only irreversible step in the roadmap. `/api/collections` is deleted with it. The extraction plan and review S-19 accept dropped blocks "only because no production users exist". The commit should be tagged before cutover. Roadmap prerequisites look met locally, but that is uncertain. This is also item D1 in [open-items.md](open-items.md).
- Source: [open-items.md](open-items.md) D1; [messaging-extraction.md](../architecture/messaging-extraction.md) §4; [implementation-roadmap.md](../architecture/implementation-roadmap.md) Wave 6; DEVLOG "Wave 5 committed and deployed as 4aa7b46".
- Safe alternative: none recorded beyond migration, which the plan rejected in favour of reset.
- Owner: ___

**SQ-2. Saved contacts: a core address book, or a per-app concern?**
- **Provisional answer 2026-10-27 (owner direction, unsigned):** contacts move with the messaging app; core keeps the contact profile and per-link sharing on the type-neutral contact parent (links AMD-L1, proposed) (see DEVLOG "2026-10-27 — Messaging removed from core; Parlay rename; BB-CUT reset").
- Question: should saved contacts be a core address book that apps (RTC calls, file transfer) can read through a contract, or belong to each app?
- Context: `saved-contact/` rows and the contact profile, sharing and peer index (`packages/links/contact-profile.mjs`) were kept in core when Beam was removed ("stay for now"). RTC admission uses contact links with owner-side RTC configuration (RTC-4, AMD-R5), and RTC calls and file transfer would need to find a counterpart. The peer index has a bounded lookup no route uses yet (MC-13). Keeping them in core also makes the dual-write and export decisions (MC-11, MC-15) permanent in practice.
- Source: "Beam removed from core" (kept and moved; decisions).
- Safe alternative: the current state, saved contacts stay in core with no app contract.
- Owner: ___

**SQ-3. Does semantic search stay in core after messaging leaves?**
- Question: should semantic search (Workers AI embeddings and Vectorize) stay in core once messaging leaves? Its corpus is mostly message text.
- Context: `SEMANTIC_SEARCH_ENABLED` is a live flag with its own owner admission gate, share and budget (AP-1, AP-2). If the corpus leaves with messaging, core would keep a search stack with little to index, and the AI exposure figures in AP-1 and AP-2 would need review. If it stays, it needs a new corpus.
- Source: raised by the core-scope audit; no DEVLOG entry records a decision. Budget context is in AP-1 and AP-2.
- Safe alternative: none recorded.
- Owner: ___

**SQ-4. What should the core MCP and browser-automation tools expose?**
- Question: once message collections are deleted, should the core MCP and browser-automation tools expose activity items, app-contributed callables, or nothing?
- Context: the extraction plan turns the MCP `item_read`, `item_write` and `item_delete` tools into activity-item tools ("Core: activity") and says BindleBox MAY later expose its own MCP tools under its own grant. The MCP projection and journal rules (AP-5) and the class-b browser-automation switch (AP-7) concern the same tool surface. "App-contributed callables" would route through the app and extension machinery instead.
- Source: [messaging-extraction.md](../architecture/messaging-extraction.md) (`packages/mcp/account.mjs` row); raised by the core-scope audit. Related: AP-5, AP-7.
- Safe alternative: the extraction plan's recorded default, activity items.
- Owner: ___

## Core scope, extensions revision 3, signaling revision 3 and contacts (2026-10-27 to 2026-10-28)

Added by the seventh update. Each item links its DEVLOG entry; sign-offs go on that entry's `Reviewer / Date / Outcome` line. Signaling revision 3.2 supersedes the design behind the "RTC signaling" sub-sections above. The local `packages/rtc` code, the interim `…/extensions/rtc-signaling/v1` identity and the core call UI were retired locally on 2026-10-28, so those RTC items are now history. Their disposition (kept, changed or dropped) is in [signaling](../spec/extensions/signaling.md) Appendix B. Signaling decisions from revisions 0 to 3.1 were revised in place, so the current set is SG-1 to SG-51 in signaling §19.2.

**Recorded as owner-approved (not pending; listed so they are not asked again):**
- EXT3-25: unknown fragment members fail closed everywhere, reversing AMD-C1's ignorable top-level members. Approved by the owner in session on 2026-10-27 ([DEVLOG](../../DEVLOG.md#2026-10-27--owner-sign-offs-ext3-25-setup-exception-components-direction-contacts-spike-rev-2-address-routing-reconciliation)).
- EXT3-26 (extensions §13 Q6): the strict account-setup exception. The built-in default is never preselected and sits beside an equally prominent "decide later". Approved on 2026-10-27, in the same entry.
- Keep `embed_origin`, with the island document at the origin root. Approved on 2026-10-27, "sounds fine" ([DEVLOG](../../DEVLOG.md#2026-10-27--owner-direction-keep-embed_origin-islands-document-at-the-origin-root)). The code moved on 2026-10-28 ([DEVLOG](../../DEVLOG.md#2026-10-28--embedded-components-migration-implemented-locally-cr-x3-16-incl-cr-x3-35-code-side-of-cr-x3-33)).
- Contacts and links rethink §11 Q1–Q3: the Website contact-link template places joiners in a `request` list (newsletter uses `receive only`); the signed-object profile lives in core keys.md; the redeemer-side "Following" list is an ordinary `can message you` list. Approved by the owner in session on 2026-10-28 ([DEVLOG "Owner approvals and directions (in session)"](../../DEVLOG.md#2026-10-28--owner-approvals-and-directions-in-session)). The CL-* decisions and CR-* change requests themselves stay pending (CL-1 to CL-25 below).
- Extensions §2.4: the `audience` definition covers endpoints that receive secret material, such as a portable identity package, so portability's `transfer_in_endpoint` is audience without an exception. Approved on 2026-10-28, in the same entry. The rest of EXT3-31 stays unsigned.
- Signaling `data` budget: 256 KiB per hour per person entity, the same on every plan, as an abuse guard (pairing sub-budget half); organization and service-entity signaling is tiered by an organization plan (still to be defined) and rate-limited before signaling is enabled for organizations. Approved on 2026-10-28, in the same entry. Implemented locally in `packages/signaling/sessions.mjs`; the rest of SG-ENG stays pending.
- Platform and integrations spike questions 1–4 and 6–8 (presentation-only platform card; keep values and grants as unavailable on downgrade, revoking after 30 days with notice; "Not in your plan" in the console; Cloudflare OAuth if generally available with narrow scopes, else a template-checked scoped token; defer "configure AI agents"; every paid tier unlocks built-in integrations; the two Bindle clarifications proposed as change requests), and question 5 answered as the owner's Cloudflare account. Approved on 2026-10-28, in the same entry ([spike](../architecture/platform-and-integrations-spike.md) §4.4). The rest of the spike stays provisional.

### Owner directions with blank ledger lines *(user)*

**OD-1. Core scope: what Bindle core is**
- Stated: core Bindle is identity, preferences, intents, resources and hub connectivity, and event buses stay in core. Messaging leaves core for Parlay, and calling is app-level. Generic signaling stays, with invite-style and always-on consumers. Organizations and relations become one extension if they shard cleanly. Commands and automation become an extension. The activity feed is a 3sln.me feature. Where the email bridge goes needs a spike. "Parlay" is adopted provisionally as the app name.
- Source: [DEVLOG "Owner direction: core scope, Parlay, signaling consumers"](../../DEVLOG.md#2026-10-27--owner-direction-core-scope-parlay-signaling-consumers); [DEVLOG "Generic signaling.v1 spec draft"](../../DEVLOG.md#2026-10-27--generic-signalingv1-spec-draft-replaces-calling-shaped-rtc) (verbatim).
- Owner: ___

**OD-2. Manifest declarations, slots and the classifier**
- Stated: remove `features`. Anything optional is an extension. No slot exists outside an extension spec, and then remove slots. Selection is a general field attribute. Provider features may consume fragments. No `ref` or local ids without a use case. The classifier becomes a generic AI resource, and message categories belong to Parlay.
- Source: [DEVLOG "Owner direction: manifest declarations"](../../DEVLOG.md#2026-10-27--owner-direction-manifest-declarations-features-slots-ref); [DEVLOG "Owner direction: remove slots"](../../DEVLOG.md#2026-10-27--owner-direction-remove-slots-classifier-scope-surfacing-candidates).
- Owner: ___

**OD-3. Invitations: use cases, admission rules, lists and one-way links**
- Stated: single-use invitations suit person-to-person contact, but website links, admission rules, contact lists and one-way (newsletter) links are needed too. The coordinator's five-setting invitation proposal is provisional and was folded into contacts spike revision 2.
- Source: [DEVLOG "Owner direction: invitation use cases"](../../DEVLOG.md#2026-10-27--owner-direction-invitation-use-cases-admission-rules-lists-one-way-links).
- Owner: ___

**OD-4. Bindle specs kept separate from 3sln.me docs, and every spec published**
- Stated, and applied by the documentation split. The provisional placements: message-content is an extension, app-messages and activity are 3sln.me docs, app-metadata stays an extension pending the owner question, and device-authorization is a Bindle-owned extension under the EXT3-21 reading. On 2026-10-28 the dissolved links record moved to `docs/spec/superseded/`, with a redirect from its old address.
- Source: [DEVLOG "Device sign-in doc scope fix; local clients … doc split direction"](../../DEVLOG.md#2026-10-27--device-sign-in-doc-scope-fix-local-clients-and-pairing-consent-spike-bindle3slnme-doc-split-direction); [DEVLOG "Documentation split"](../../DEVLOG.md#2026-10-27--documentation-split-bindle-core-bindle-extensions-3slnme-full-spec-publication).
- Owner: ___

### Extensions revision 3

**EXT3-21. What "core" means (needs owner sign-off)**
- Decided (provisional): "core" is the conformance floor plus the extension mechanism. The areas the owner called core (intents, hub connectivity, events, authorization entry, device authorization) are Bindle-owned extensions in the core document set.
- Source: [DEVLOG "Extensions rev 3 open questions"](../../DEVLOG.md#2026-10-27--extensions-rev-3-open-questions-provisional-coordinator-answers) (answer 3); [DEVLOG "Extensions revision 3.1"](../../DEVLOG.md#2026-10-27--extensions-revision-31-rev-3-review-fixes-and-cuts-spec-only).
- Owner: ___

**EXT3-1 to EXT3-36 (except EXT3-21, EXT3-25 and EXT3-26). The revision 3 to 3.3 decision set**
- Decided (provisional): `{spec, options}` declarations with the spec URL as identity. No slots, `ref`, `crit`, `supersedes`, `requires` or declaration `digest`. The field attributes `selection`, `consumers` and `announce` (Q1). Provider-feature client identity is (issuer, spec URL), at most one feature per extension. Endpoint options are `audience` or `public`, and only audience endpoints must be distinct (EXT3-31, EXT3-32). Fragments follow artefacts. The candidate and announcement floor. The email bridge is a provider-published extension (Q2; moot since the bridge was removed 2026-10-28). Embedded components become a Bindle-owned extension (EXT3-29, EXT3-34). The UUIDv5 `tx` encoding (EXT3-33). The interim RTC identity (EXT3-35) is retired since 2026-10-28. CR-X3-04 and CR-X3-23 are void, and CR-X3-11 is void since contacts phase 1.
- Source: [DEVLOG "Extensions revision 3 draft"](../../DEVLOG.md#2026-10-27--extensions-revision-3-draft-spec-only-supersedes-rev-2-pending-sign-off); [revision 3.1](../../DEVLOG.md#2026-10-27--extensions-revision-31-rev-3-review-fixes-and-cuts-spec-only); [revision 3.2](../../DEVLOG.md#2026-10-27--extensions-revision-32-rev-31-verification-review-fixes-spec-only); [revision 3.3](../../DEVLOG.md#2026-10-27--extensions-revision-33-spec-reconciled-with-the-revision-32-implementation-spec-only).
- Owner: ___

**EXT3-impl. Revision 3.2 implemented locally, with review-fix readings**
- Decided (provisional): a clean break in manifests, with no `features`/`profiles`. Destructive reset of `connections/slot/` rows (CR-X3-29). A feature is suspended at once on declaration loss and revoked after 30 days dated from `seenAt` (a 6-hourly sweep). `bindle.grant` changes on reorder, purpose or ingress change (a provisional L3 reading of "value change"). The own-flow exclusion applies in the initial flow, `inspect` and `approve`. Deferred: L6, L10, L11 and L12.
- Source: [DEVLOG "Extensions revision 3.2 implemented locally"](../../DEVLOG.md#2026-10-27--extensions-revision-32-implemented-locally-flags-off-cr-x3-1832); [DEVLOG "Extensions revision 3.2 code review fixes"](../../DEVLOG.md#2026-10-27--extensions-revision-32-code-review-fixes-provisional).
- Owner: ___

**EXT3-surf. Candidate surfacing and the classifier (3sln.me policy proposals)**
- Decided (provisional, not applied): offer a resource only for an empty field with a waiting consumer. Ask each (field, resource) pair once. No preselection or self-preferencing. A generic `item-classification/v1` contract with caller-supplied labels, which needs a security review.
- Source: [DEVLOG "Owner direction: remove slots"](../../DEVLOG.md#2026-10-27--owner-direction-remove-slots-classifier-scope-surfacing-candidates).
- Owner: ___

**EC-1. Embedded-components migration choices**
- Decided (provisional, EXT3-34): `parts` as `<name>/<version>`. Islands never delegate to FedCM. No `theme_tokens`, while the wire `theme` member stays as `{}`. The components profile URL is no longer emitted; it was later removed from the registry rather than listed as withdrawn (owner direction 2026-10-28, no versioning churn before release). The Node host accepts only origin-form request targets.
- Source: [DEVLOG "Embedded-components migration"](../../DEVLOG.md#2026-10-28--embedded-components-migration-implemented-locally-cr-x3-16-incl-cr-x3-35-code-side-of-cr-x3-33); [DEVLOG "Embedded-components review follow-ups"](../../DEVLOG.md#2026-10-28--embedded-components-review-follow-ups-l1-l2-i1-i3).
- Owner: ___

### Signaling revision 3.2

**SG-C5-1. Signaling C.5 step 1: kind authorization and bases (blocks enabling any signaling flag)**
- Decided (provisional): SG-2 (session kinds are intent kinds, with session handler approvals), SG-23 to SG-30 (the `offer` and `pairing` bases), SG-36 to SG-46 (core-scope cut, extensions rev 3 shape, pairing consent, local clients, open offers, `none` reserved, intents routing cut) and AMD-SG-I1 (intents session kinds and approvals).
- Source: [DEVLOG "signaling.v1 spec rev 2"](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-2-offer-and-pairing-bases); [rev 3](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-3-core-scope-cut-extensions-rev-3-pairing-consent); [rev 3.1](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-31-rev-3-review-fixes-open-offers); signaling Appendix C.5.
- Owner: ___

**SG-rest. The other signaling decisions: SG-1 to SG-51 not listed above**
- Decided (provisional): a generic channel with `webrtc` and `data` profiles (SG-1, with `data` at 4 KiB per message and 64 KiB per leg). Abuse limit kinds and windows (SG-9, SG-33, SG-48). Blocks (SG-10). The SAS is out of core (SG-11). App-origin disclosure (SG-12). Decline reasons (SG-13). `ice-relay/v1` (SG-14). New identifiers (SG-15). Offer rules (SG-31, SG-47, SG-49). Pairing rules (SG-32, SG-34, SG-46). Glare by leg-key rank (SG-35). Service-class narrowed to provider features and designated organization service entities (SG-50). Residuals accepted (SG-51). SMS-1 to SMS-8 come from the establishment-modes spike.
- Source: [DEVLOG "signaling.v1 spec rev 1"](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-1-review-fixes); [rev 2.1](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-21-rev-2-review-fixes); [rev 3.2](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-32-rev-31-verification-fixes).
- Owner: ___

**SG-AMD. Proposed amendments and owner questions**
- Proposed (unsigned, not applied to their targets): AMD-SG-D1 (a standing device grant that survives the approving browser's sign-out), AMD-SG-S1 and AMD-SG-S2 (security.md: hosted signaling copies, and no relay credential without an enforced per-owner byte cap), AMD-SG-E1 (integration doorbell) and AMD-INT-R1 (intents chooser short-list, moved to the intents change requests). Withdrawn: AMD-X1, AMD-R4, AMD-R5, AMD-RW1, AMD-SG-A1, AMD-SG-N1, and AMD-SG-L1a and L1b with the `link` basis. Owner questions are in signaling §19.3 to §19.5 (Q1 to Q12), with provisional answers adopted.
- Source: the signaling revision entries above.
- Owner: ___

**SG-ENG. Engine phase choices and divergences (implemented locally, flags off)**
- Decided (provisional): fresh authentication for cross-entity pairings means session `authTime` within 5 minutes. The `data` budget is 256 KiB per hour per entity on every plan (owner-approved 2026-10-28, lowered from 1 MiB; listed above), with a pairing sub-budget of half. Pairings are capped at half of base pending capacity (corrected by review M-3). Maximum pairing expiry is 366 days. An unpaired relation invite counts as unbased. `approval_required` is in `NO_EFFECT_CODES`. The offer refresh lane is stricter than the text. Any change of connection generation counts as connection end (H-1). Grant revocation also clears approvals (L-7, a divergence from §20.1.4). Legacy `rtc/` rows are deleted (destructive, pre-release). Open: L-4 (`signalingClientSessionRevoked` uncalled), the provider pages, steps 6 to 8.
- Cost note: at the full 256 KiB `data` budget, Paid's worst case is 60.5% without relay, over the 50% floor, and 48.5% with its whole relay allowance, under it until the relay byte-cap gate holds ([unit economics](../architecture/unit-economics.md), "Relayed signaling `data` bytes").
- Source: [DEVLOG "Signaling revision 3.2 engine phase"](../../DEVLOG.md#2026-10-28--signaling-revision-32-engine-phase-implemented-locally-appendix-c5-steps-24-and-the-core-removal-half-of-5); [DEVLOG "Signaling revision 3.2 engine: independent review fixes"](../../DEVLOG.md#2026-10-28--signaling-revision-32-engine-independent-review-fixes-h-1-m-1-to-m-4-l-1-to-l-3-l-6).
- Owner: ___

**MSG-55. Bindle Messaging §5.5 call invitations**
- Decided (provisional): the call kind uses bases `["offer"]` and `profiles: {"webrtc": {}}`, and the media choice lives in the body. `expiresAt` is at most the earliest offer `expires_at` minus 60 s. At most 8 offer entries. Alerting needs a two-party unlock with the author, which persists until a block or a per-author clear.
- Source: [DEVLOG "signaling.v1 spec rev 3"](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-3-core-scope-cut-extensions-rev-3-pairing-consent); [rev 3.1](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-31-rev-3-review-fixes-open-offers); [rev 3.2](../../DEVLOG.md#2026-10-27--signalingv1-spec-rev-32-rev-31-verification-fixes).
- Owner: ___

**LC-1 to LC-14. Local clients spike**
- Decided (provisional, not applied): a per-installation DPoP-thumbprint `client_id`. A self-asserted local manifest pinned at approval and always shown as unverified. A 30-day idle limit. Loopback code with PKCE and DPoP, behind `LOCAL_CLIENTS_ENABLED`. Pairing rules P1 to P4. Change requests CR-L1 to CR-L10 and CR-A1 to CR-A7 (CR-A1 applied by the documentation split).
- Source: [DEVLOG "Device sign-in doc scope fix; local clients …"](../../DEVLOG.md#2026-10-27--device-sign-in-doc-scope-fix-local-clients-and-pairing-consent-spike-bindle3slnme-doc-split-direction).
- Owner: ___

### Messaging out of core, and contacts

**MC-23. Messaging torn out of core; Parlay rename**
- Decided (provisional): the renames and `PARLAY_*` flags, with an app-side `BINDLEBOX_*` fallback (removing the alias is open). `conversation-v1.json` was first kept published as withdrawn, then removed (owner direction 2026-10-28, no versioning churn before release). Collections, Views, rules, tags and `/api/messages*` stay as activity surfaces. Public-message-intake consumers stay provider-only (M2). The RTC compatibility port is now moot with RTC retired (L6). The BB-CUT reset itself is SQ-1, answered by the user.
- Source: [DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"](../../DEVLOG.md#2026-10-27--messaging-removed-from-core-parlay-rename-bb-cut-reset).
- Owner: ___

**CL-1 to CL-25. Contacts and links rethink**
- Decided (provisional): contacts are not core. First contact is a Bindle Messaging invitation through the `connect` intent, `{inviter, token, delegation, expires_at?, hint?}`. Contact lists live in the messaging app. The signed-object profile moves to keys.md, and the query envelope to the Organizations annex. links.md is dissolved (AMD-L1 withdrawn), and `intents.v1` and `link-response.v1` are withdrawn. Intents register no kinds. Change requests CR-C1 to CR-C10. Answers to the spike questions: the website template uses a `request` list, the signing profile goes in keys.md, and redeemer-side following is a `can message you` list (these three answers are owner-approved 2026-10-28; listed above).
- Source: [DEVLOG "Contacts and links rethink spike"](../../DEVLOG.md#2026-10-27--contacts-and-links-rethink-spike); [spike rev 2](../../DEVLOG.md#2026-10-27--owner-sign-offs-ext3-25-setup-exception-components-direction-contacts-spike-rev-2-address-routing-reconciliation); [phase 1](../../DEVLOG.md#2026-10-28--contacts-and-links-rethink-phase-1-specs-applied).
- Owner: ___

**CL-17. First-contact-only gate (widens the 2026-10-14 decision)**
- Decided (provisional): Messaging §6.7 gates only first contact. It runs budgets, then "not hosted here", token checks, author verification, and finally owner policy on the verified principal. The inviter verifies only same-host redeemers (CL-24). Accepted residual: a token holder can learn whether a named principal redeemed it. A new `…/extensions/messaging-mailbox/v1` provider feature gates the Parlay key-delegation purposes.
- Source: [DEVLOG "Contacts phase 1: spec review fixes"](../../DEVLOG.md#2026-10-28--contacts-phase-1-spec-review-fixes).
- Owner: ___

**CR-C0. `KEY_DELEGATION_ENABLED` safety gate**
- Decided (provisional): a new stateful gate for key-delegation issuance, routes and the member-certificate fallback. Until CR-C7 an unset value falls back to `LINKS_ENABLED`, but a retention resting on `link/` rows alone no longer keeps delegation open (the one deliberate behaviour change). Open for review: the decoder accepts a leading byte-order mark, and core now holds two strict-JSON and two canonical-encoding profiles.
- Source: [DEVLOG "Contacts phase 2: CR-C0 safety gates"](../../DEVLOG.md#2026-10-28--contacts-phase-2-cr-c0-safety-gates-implemented-locally).
- Owner: ___

### Fixes with product choices

**UI-16. Bug hunt round 3 readings**
- Decided (provisional): a stale contact-profile save is refused with `409 profile_stale` unless the stored profile still discloses (refines L-1). A browser navigation to an ended `/oauth/authorize` gets a fixed HTML page. R1 was withdrawn, and D1 to D5 are deferred. The contact-profile surfaces are being removed with contacts.
- Source: [DEVLOG "Bug hunt round 3 (browser)"](../../DEVLOG.md#2026-10-27--bug-hunt-round-3-browser).
- Owner: ___

**OL-24. Cleanup audit and core-scope step 1**
- Decided (provisional): `SIGNED_INTENTS_ENABLED` is kept, reserved for INT-8. Without `DEVELOPER_CONTACT_HANDLE`, developer contact is off; the `ray` default is removed, so deployments must set it. The core-scope step 1 moves changed no behaviour.
- Source: [DEVLOG "Cleanup-audit code fixes"](../../DEVLOG.md#2026-10-27--cleanup-audit-code-fixes); [DEVLOG "Core-scope step 1"](../../DEVLOG.md#2026-10-27--core-scope-step-1-re-home-core-code-out-of-messaging).
- Owner: ___

**ID-12. Recovery reissue cancel from the replacing device signs it out**
- Decided (provisional): the cancel stays offered on the replacing device and signs that browser out. The follow-up is queued: warn on the control.
- Source: [DEVLOG "Recovery reissue: cancel from the replacing device"](../../DEVLOG.md#2026-10-27--recovery-reissue-cancel-from-the-replacing-device-bug-fix).
- Owner: ___

## Unverified external assumptions

These need a real-provider check. Nothing below has been run against the live service.

- **Polar renewal and period semantics.** The `renewed` settlement assumes `current_period_start` advances on renewal, and renewal settles only while status is `active`. The SDK 1.0.2 types do not say the period advances only after payment. Source: "Billing, retention and region wargame fixes" (I7).
- **Polar refund and update horizon of 400 days.** This was not checked against Polar's documentation. Source: "Redirect management review fixes" (M2).
- **Polar checkout session lifetime of about 1 hour.** The paid-signup recheck depends on it. Source: "Billing, retention and region wargame fixes".
- **Polar accepting US$60,000 card charges** (Scale tier). Source: "Organization tier pricing checked against unit economics".
- **Polar SDK gaps.** `refunds.create` takes no idempotency key, so a lease is used instead. There is no checkout-expiry call, so superseded claim checkouts are refunded rather than expired. Sandbox only; no live payment has run. Sources: "Organizations wargame fixes"; "Review fixes for f7eda06".
- **Clef classifier billing.** The $0.038 per million input tokens, byte-bounded estimate needs one real-invocation measurement. Live Clef accuracy is also unmeasured. Source: "App-platform wargame fixes".
- **AI credit cost.** One credit at most US$0.0001 of provider spend is a model assumption, and credit enforcement is not wired. Source: "Organization tier pricing…".
- **Cloudflare `request.cf` behaviour.** The region policy assumes `request.cf.country` gives ISO codes, `XX` for unknown and `T1` for Tor. Source: "Billing, retention and region wargame fixes".
- **The Node trusted country header.** The operator's proxy must overwrite `TRUSTED_COUNTRY_HEADER`, not append to it. This is a security.md verification gate. Source: same.
- **Mail delivery.** Unverified mail includes:
  - Worker `notify@` redirect reminders;
  - `security@` break-glass notices;
  - recovery-reissue and authority-event notices;
  - app-removal reminder emails (AU-S6);
  - email sign-in;
  - the external Email Routing for the bridge, including `reply()` and live DMARC (removed 2026-10-28 (owner direction; revisit later)).

  "Accepted" in the code means a provider (or fake) accepted the message, never that it was delivered. Sources: "Portability: redirect end/retarget…"; "ORG-12b/12e…"; "Identity and federation wargame fixes".
- **Push delivery.** Web-push notices and 410 handling for dead subscriptions are unverified, and Track A depends on accepted out-of-band notices. The deletion of session-bound subscriptions (ID-11) was tested only against local adapters. Source: "ORG-12b/12e…"; "Operator and lifecycle wargame fixes".
- **Email bridge `Authentication-Results` trust.** Removed 2026-10-28 (owner direction; revisit later). On Cloudflare no authserv-id is configured, so all mail is treated as unauthenticated. Source: "App-platform wargame fixes".
- **Directory and federation interoperability.** Unverified: production directory egress, independent-provider conformance, client-metadata resolution by other providers, and real external portability providers. Sources: "Organizations phase A: ORG-0…"; "Portability: redirect end/retarget…".
- **TURN relay budget.** `BEAM_RELAY_BUDGET.release` was an optional port with no implementation in the repo (removed with Beam on 2026-10-26; the RTC relay occupant still needs an enforceable relay budget). Source: "Messaging, search and deletion wargame fixes". Update (2026-10-27): the RTC-f occupant now requires an operator-supplied `RTC_RELAY_SPEND` port, and none ships; see the relay spend authority gate below.
- **RTC signaling, end to end.** The slices RTC-a to RTC-g, the owner-UI service follow-ups and the RTC-i conformance fixes are implemented and tested locally behind default-off flags; the design's own end-to-end checks are not run. Unverified: a clean-room second provider interoperating over real HTTPS, real-device WebRTC on restrictive NATs and under mobile background and foreground suspension, Web Push delivery per platform (a stored subscription is not delivery), abuse load tests at the RTC-11 limits, a privacy review of retention and logs, terms stating RTC is not a telephony or emergency service, and an independent security review of the whole (the independent reviews so far covered the slices separately and are not a sign-off). Source: "RTC signaling extension design" (design §8.3); the RTC-a to RTC-e entries ("Not run" lines).
- **Foreign relation transport and issuer fetching.** Relations (ORG-10) run only between organizations on one local host. Cross-provider transport, issuer fetching and the effect of OB-55's recognized-only refresh on a real issuer are ORG-11 work and unverified. Source: "ORG-10a-c relations core"; "ORG-10f/g relations routes and console".
- **Relation console and routes.** The Chromium and Firefox relation checks run against local fixtures. The built-shell checks use routed API fixtures, and WebKit was unavailable (four skips). Source: "ORG-10f/g relations routes and console".
- **Rollback and mixed-version behaviour of the Beam re-key.** MC-11's dual-write was tested against simulated pre-removal writes, not a real mixed deployment, and TURN credential revocation was tested only against a local adapter. Source: "Beam removed from core".
- **Worker CPU limits for index builds.** A single index over about 1M rows is projected at 3–4 s, and Worker CPU limits are unmeasured. Source: "Scalability fixes…".
- **Round-2 scale probes are local.** The before/after probes use the real local SQLite adapter and count list-returned rows and read bytes, not physical SQL read counters. Wall times are not production throughput. Cold key-tombstone migration (12,800 kids) is unbounded, and its Worker CPU cost is unmeasured. Source: "Scalability fixes round 2…".
- **Durable Object SQLite expression indexes.** The RR1-M7 conclusion rests on one local workerd (Miniflare, `useSQLite`) probe: an expression index worked on an ordinary DO SQL table and `_cf_KV` refused it (`SQLITE_AUTH`). It has not been run on deployed Durable Objects. Source: "Scalability fixes round 2…" (review follow-up 6).
- **Mixed-version rollout of key tombstones.** Safety assumes no older writer touches an owner after the new version migrates it. No guard exists, and the deployment procedure is unspecified. Source: "Scalability fixes round 2…" (review follow-up 7).
- **Operator identity in production.** Real WebAuthn evidence for operators, distinct human and authenticator onboarding, key custody review, and an external anchor for the organization audit are unverified. The admin org-cases e2e fixture-fulfils the four `/api/admin/org-cases/*` routes, and Firefox variants are view-only because it has no virtual authenticator. Source: "ORG-12d support adjudication".
- **Google Drive OAuth behaviour.** The `reauthorization_required` handling for a refresh that lists extra scopes, and the 7-day and 50-row pruning of OAuth and folder journals, were tested only against local fakes. Source: "Operator and lifecycle wargame fixes".
- **WebKit.** The WebKit executable was unavailable, so four optional e2e checks were skipped and no WebKit result exists. Source: "UI quality pass 3"; "ORG-12d support adjudication".
- **Browser platform behaviour.** Unverified: real WebAuthn at transfer-in intake, OS and PWA protocol installation for intents, and deployed `bintent` log redaction. Sources: "Portability: redirect end/retarget…"; "Intent links (INT-1 to INT-7, INT-9)…".
- **Public suffix handling.** The admin-domain and issuer-bucket rules use suffix and two-label approximations without a public suffix list. Sources: "ORG-12a/12c…" (M4); "Conversations and bindlebox wargame fixes".
- **Cloudflare headers for RTC shedding (production gate).** The per-network shedding at `POST /bindle/rtc` and the relation endpoints assumes that `CF-Connecting-IP` and `CF-Worker` behave as described: Cloudflare sets `CF-Worker` on Worker subrequests, never passes a client's copy through, and the networks Workers egress from are as assumed. Not verified on real Cloudflare; do it before relying on per-network shedding. Source: "RTC-e foreign transport, endpoint and key roster" (review follow-ups, production gates).
- **`TRUSTED_CLIENT_IP_HEADER` for proxied Node (production gate).** A Node deployment behind a reverse proxy must set it to a header the proxy overwrites, never appends, and this must be verified per deployment; mapped IPv4-in-IPv6 spellings were tested only against local inputs. Without it every request shares the proxy's network budget, for every Node route that reads `CF-Connecting-IP`. Source: same, with "Verification follow-ups" (V3).
- **Host-wide directory budgets on real Durable Objects (production gate).** The `WORK_AUTHORITY` guard call per directory GET, the per-tenant shares and the hot key per (feature, class, site) under load are untested on deployed Durable Objects. Source: "RTC-e foreign transport, endpoint and key roster" (production gates; RTCe-19).
- **Load tests of the RTC budgets (production gate).** The RTC-11 limits, the roster lanes, the host and per-writer budget values, the tenant shares, `warms` and `priorityPerIssuer` are provisional until load-tested at the spec §13 limits. Source: "RTC-e foreign transport, endpoint and key roster" (production gates, residual risks). Update (2026-10-27): the wargame values (`self` 120/h, `preferred` 60/h, `sameHost` 40/h, ringing reserve 2, 8 endpoints per app, fan-out 16, 64 tickets and `mint` 120/h per app) join this gate; they are provisional provider policy (RTCw-resid).
- **Workers egress and security.md S4 (production gate).** security.md S4 ("auth/grant/race/SSRF verification … complete") is unchecked and the Workers egress gate (R2-M6: DoH screening is not connection pinning) is unmet. Foreign RTC issuers stay behind the empty `RTC_FOREIGN_ISSUERS` allowlist, and cross-provider delivery and directory fetches are unverified on both adapters' real egress. Source: "RTC-e foreign transport, endpoint and key roster" (outbound gate).
- **RTC on real Durable Objects.** Unverified on a real Cloudflare Durable Object: the detached task after the response and `blockConcurrencyWhile` timer behaviour (the alarm is the fallback), the federation-DO round trips for `checkBound` and for `narrowBoundOptions` (the latter is covered only by a static allowlist test), and the in-memory roster and refresh queue lost on eviction. Source: "RTC-d sessions, admission and same-host transport" (review follow-ups); "RTC-e foreign transport, endpoint and key roster"; "RTC service follow-ups for the owner UI".
- **RTC owner console in real conditions.** The calls view and ring were checked in Chromium and Firefox and happy-dom against local fixtures and a local Node server. Not run: the Worker runtime in a browser, WebKit, a browser without `BroadcastChannel` (only a fake-channel unit test), real WebRTC, a second provider, push or a relay. The ring's English and Spanish privacy wording (RTCg-copy) has had no counsel review. Source: "RTC-g owner settings and portal ring"; "RTC service follow-ups for the owner UI".
- **RTC silent decline at the provider (gates G1 and G2 closed locally).** The RTC-g gates (the portal ring needs `alert`; Decline and Remove need the engine's silent end) are closed by local evidence only. They stay provisional until RTCs-1 to RTCs-8 are signed off and the RTC release gates in the design and security.md are met. Source: "RTC-g owner settings and portal ring" (production gates); "RTC service follow-ups for the owner UI".
- **Messaging extraction: rollout and the BB-CUT release gate.** Not run: `check:worker` and `test:e2e` for the review follow-ups, and a real mixed deployment of `app-messages-v1` (rollback to pre-move code, a retired key or changed `APP_ORIGIN` before BB-CUT). The retired-kid and `APP_ORIGIN` gate (MC-18) is not enforced by code. Source: "Messaging extraction prep (no reset)".
- **Bug-hunt browser evidence.** The fixes were checked with Playwright in Chromium against a local Worker and a bug-hunt account copy; F11 was covered only by happy-dom, and the probes are not committed. Nothing was verified in production or against an external provider. Source: "Browser bug hunt fixes (post Beam removal)".
- **Relay spend authority (production gate).** No `RTC_RELAY_SPEND` implementation ships. Before `RTC_TURN_ENABLED` is enabled anywhere, an operator-supplied authority must cap aggregate TURN spend and enforce per-owner byte caps from the TURN provider's usage feed, attributing usage through the usernames it receives at `commit` and revoking overruns. Only a fake authority has run. A configured key, flag or authority answering `enforced: true` is not evidence. Source: "RTC-f relay occupant" (production gates); "RTC-f review follow-ups" (M1(d)).
- **TURN price and free tier.** The planning rate of US$0.05/GB egress and the deployment-wide free tier were not rechecked against a primary source. A price above about US$0.064/GB puts the Paid plan under the 50% margin floor with its full relay allowance. Source: "RTC-f relay occupant" (cost model, production gates).
- **Cloudflare TURN API behaviour.** Unverified against the real API: issuance, whether revocation ends live allocations, and whether an allocation outlives its credential's expiry (RTCf-4; if not, a long call needs an ICE restart about every 5 minutes). The `CloudflareTurnAdapter` ran only over an injected `fetch`, and production `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` configuration is an operator concern. Real WebRTC through a relay was not run. Source: "RTC-f relay occupant" (production gates; "Not run").
- **RTC-f and RTC-i on real Durable Objects.** Unverified on a real Cloudflare Durable Object: the federation-DO round trip of the dispatch `bound` approval (RTCi-1) and its `at` (RTCi-2), the app-removal drain's call back from the federation object outside the account object's `blockConcurrencyWhile` gate (RTCi-10), the relay contract's round trip, and the relay's detached revocation pass and alarm re-arming in the Worker runtime. Source: "RTC-f relay occupant" and "RTC-f review follow-ups" ("Not run"); "RTC-i conformance peer" and "RTC-i review follow-ups" ("Not run").
- **RTC-i conformance is local.** The clean-room peer drove the real Node provider, with DNS and the socket replaced through `DIRECTORY_DNS_LOOKUP` and `DIRECTORY_HTTPS_REQUEST`. It is not evidence of interoperability over real TLS and DNS, and does not cover §8.2 timing uniformity, glare, the SAS, key rotation under load, account moves, Web Push or relay credentials (RTCi-open). Source: "RTC-i conformance peer: divergences and fixes" (not covered).
- **RTC per-account flag cohort through drain rate (recorded residual).** After RTCw-L3/R1 a flag-off account answers like a flag-on one, but its dark rows drain faster than processed rows, so a sender flooding one account could compare drain rates and infer its per-account flag. Not measured, and not fixed; it disappears once the flags are deployment-wide. Source: "RTC wargame review follow-ups" (R1 residual; open).
- **RTC wargame fixes are local.** The wargame and its fixes ran against the Node engine, a simulated multi-provider fixture, happy-dom and Playwright on local fixtures. Not run: the Worker runtime against real Durable Objects (including the dark ingest's queue rows and RTC alarm on flag-off writers), real WebRTC and a real second provider over TLS. AMD-RW1 to AMD-RW6 are proposed, unapplied and unreviewed. Source: the three "RTC wargame" entries (verification, "Not run").
