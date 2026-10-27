# Pending sign-offs

Status: digest, written 2026-10-24 at HEAD a38bfed. It covers DEVLOG.md from "2026-10-22 — User decisions: Parley data on deletion, org identity, certificates, naming" through "2026-10-23 — Redirect management re-review fixes (round 2)". An update the same day adds two entries: "2026-10-24 — AU-S6 producer summary, What's left and removal reminders" and "2026-10-24 — ORG-10 relations design". It also covers the earlier organization and portability decisions that those entries still refer to: organization prices, BG-1 to BG-17 and P14–P19.

A second update, at HEAD 6bbae45, adds everything after "2026-10-24 — Pending sign-off digest": "2026-10-24 — UI quality pass 3 (browser probe round 3)"; "2026-10-24 — Scalability fixes round 2 (producer, conversations, retention totals, tombstones, directory)" and its review follow-ups; "2026-10-24 — ORG-12d support adjudication" and its review follow-ups and wargame 4 admin items; and "2026-10-24 — Operator and lifecycle wargame fixes" and its review follow-ups. The new items are ID-11, OB-45 to OB-52, MC-9, AP-15, AP-16, UI-8 to UI-11 and OL-7 to OL-17, plus new unverified external assumptions at the end.

How to read this file:

- [DEVLOG.md](../../DEVLOG.md) is the source of record. This file only summarises it, and where the two differ, DEVLOG wins. Sign-offs go on the DEVLOG entry's `Reviewer / Date / Outcome` line, not here.
- **Nothing here is signed off.** Every item is provisional, open, or a user statement whose DEVLOG sign-off line is still blank. Items marked *(user)* are positions the user stated. They are listed because their ledger lines are unsigned, not because they are in doubt.
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

## Operations and limits

**OL-1. Sign-in abuse limits**
- Decided: these are the sign-in rate limits.
- Value:
  - email sign-in: 5 per 15 minutes and 12 per 6 hours per mailbox, 5,000 per hour per region and 20,000 per hour overall;
  - per handle: 20 per 5 minutes, charged only by a failed password after Turnstile;
  - boot passkey: 10 per minute and 50 per hour per IP, 600 per 5 minutes per principal;
  - boot password: 20 per 5 minutes per principal and 200 per hour globally, with no Turnstile on the last-resort path.
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
  - the external Email Routing for the bridge, including `reply()` and live DMARC.

  "Accepted" in the code means a provider (or fake) accepted the message, never that it was delivered. Sources: "Portability: redirect end/retarget…"; "ORG-12b/12e…"; "Identity and federation wargame fixes".
- **Push delivery.** Web-push notices and 410 handling for dead subscriptions are unverified, and Track A depends on accepted out-of-band notices. The deletion of session-bound subscriptions (ID-11) was tested only against local adapters. Source: "ORG-12b/12e…"; "Operator and lifecycle wargame fixes".
- **Email bridge `Authentication-Results` trust.** On Cloudflare no authserv-id is configured, so all mail is treated as unauthenticated. Source: "App-platform wargame fixes".
- **Directory and federation interoperability.** Unverified: production directory egress, independent-provider conformance, client-metadata resolution by other providers, and real external portability providers. Sources: "Organizations phase A: ORG-0…"; "Portability: redirect end/retarget…".
- **TURN relay budget.** `BEAM_RELAY_BUDGET.release` was an optional port with no implementation in the repo (removed with Beam on 2026-10-26; the RTC relay occupant still needs an enforceable relay budget). Source: "Messaging, search and deletion wargame fixes".
- **Worker CPU limits for index builds.** A single index over about 1M rows is projected at 3–4 s, and Worker CPU limits are unmeasured. Source: "Scalability fixes…".
- **Round-2 scale probes are local.** The before/after probes use the real local SQLite adapter and count list-returned rows and read bytes, not physical SQL read counters. Wall times are not production throughput. Cold key-tombstone migration (12,800 kids) is unbounded, and its Worker CPU cost is unmeasured. Source: "Scalability fixes round 2…".
- **Durable Object SQLite expression indexes.** The RR1-M7 conclusion rests on one local workerd (Miniflare, `useSQLite`) probe: an expression index worked on an ordinary DO SQL table and `_cf_KV` refused it (`SQLITE_AUTH`). It has not been run on deployed Durable Objects. Source: "Scalability fixes round 2…" (review follow-up 6).
- **Mixed-version rollout of key tombstones.** Safety assumes no older writer touches an owner after the new version migrates it. No guard exists, and the deployment procedure is unspecified. Source: "Scalability fixes round 2…" (review follow-up 7).
- **Operator identity in production.** Real WebAuthn evidence for operators, distinct human and authenticator onboarding, key custody review, and an external anchor for the organization audit are unverified. The admin org-cases e2e fixture-fulfils the four `/api/admin/org-cases/*` routes, and Firefox variants are view-only because it has no virtual authenticator. Source: "ORG-12d support adjudication".
- **Google Drive OAuth behaviour.** The `reauthorization_required` handling for a refresh that lists extra scopes, and the 7-day and 50-row pruning of OAuth and folder journals, were tested only against local fakes. Source: "Operator and lifecycle wargame fixes".
- **WebKit.** The WebKit executable was unavailable, so four optional e2e checks were skipped and no WebKit result exists. Source: "UI quality pass 3"; "ORG-12d support adjudication".
- **Browser platform behaviour.** Unverified: real WebAuthn at transfer-in intake, OS and PWA protocol installation for intents, and deployed `bintent` log redaction. Sources: "Portability: redirect end/retarget…"; "Intent links (INT-1 to INT-7, INT-9)…".
- **Public suffix handling.** The admin-domain and issuer-bucket rules use suffix and two-label approximations without a public suffix list. Sources: "ORG-12a/12c…" (M4); "Conversations and bindlebox wargame fixes".
