# Layered classification in Parlay

> **Group:** 3sln.me reference service (Parlay design; one additive Bindle contract change)
>
> **Status:** provisional (2026-10-29), documentation only. Recommended by the coordinator and adopted under the owner's delegation of 2026-10-29 (DEVLOG, "Older items": the layered classification design gets written up). Not signed off; no code, spec, artefact or flag was changed. Nothing here is implemented, deployed or production-verified, and every cost figure is a planning estimate, not a measurement. Production release remains disabled. Sign-off: Reviewer ___ Date ___ Outcome ___.
>
> **Covers:** how Parlay combines four classification layers (rules, a per-user learned filter, embedding similarity, the LLM classifier); thresholds and deferral; the combined result and its provenance; the proposed additive change to `item-classification/v1` (label forms and examples); privacy of per-user filter state; cost and allowance effects; cold start; evaluation; interaction with the `sys:classification-failed` tag; phases and open questions.
>
> **Does not cover:** the embedding contract itself ([media and embeddings spike](media-and-embeddings-spike.md)); the item-classification contract text ([spec](../spec/extensions/item-classification.md), which this document proposes to amend, not amends); plan prices and the AI allowance sizing ([unit economics](unit-economics.md)); Parlay's rules language; other apps' classification.

## 0. Recommendation in one screen

Today every Parlay item that needs auto-classification goes to one paid LLM call (`packages/messaging-engine/domains/classify.mjs`, the built-in classifier on Workers AI Clef, worst case about 2,500 µUSD per call). A Paid account's 40,000 µUSD monthly AI pool holds only a few tens of such calls, and when the pool is spent items fail with the failure tag. Most mail is not hard to classify: the same senders and the same kinds of message recur, and the owner's own tags show what they mean. So classification becomes a cascade that stops at the cheapest layer that is confident:

1. **Rules and heuristics** (existing rules engine). Free, deterministic, owner-authored.
2. **Per-user learned filter** (naive Bayes first, logistic later), on plain CPU inside the user's Parlay mailbox, trained only from the user's own tags and corrections. Every plan, no provider cost.
3. **Embedding similarity** (label descriptions and per-user label centroids against the item's embedding), the default paid classifier. Roughly 5–35 µUSD per item, about two orders of magnitude under the LLM.
4. **LLM decision model** (the built-in `item-classification/v1` resource), only for labels the cheaper layers left uncertain, or where the tier policy asks for it.

Each label is settled by the first layer that is confident about it; the result records which layer and model decided each label. A cheap layer failing is never a failure of the item; only a paid layer that was entitled, configured and needed, and failed, produces the failure tag.

## 1. Layers

Labels are Parlay's taxonomy (`TAG_CATEGORIES`, plus owner-defined tags later), scored independently in [0, 1] as the contract requires ([item-classification §7](../spec/extensions/item-classification.md#7-result)). A layer yields, per label, a score or an abstention.

### 1.1 Layer 1: rules and heuristics

The existing provisional and final rule runs ([rules.mjs](../../packages/messaging-engine/domains/rules.mjs), `runRulesFresh`) and the heuristic row (`heuristicSuspectedTags`; empty for Bindle messages since the email bridge was removed, so in practice owner and default rules over sender, source, collection and existing tags). A rule that sets or forbids a tag is a hard assertion: it is not a model score, is never overridden by a lower layer, and settles that label (positive or negative). Rule behaviour is unchanged by this design; layers 2–4 only supply the automated evidence the rules already run over.

### 1.2 Layer 2: per-user learned filter

- **Model.** One independent binary model per label (matching the contract's independent scores), over hashed features of the minimised item text (`minimize`, the same truncation the classifier gets), the sender's origin host, `source`, language and conversation kind. Start with multinomial naive Bayes (integer counts per hashed bucket, Laplace smoothing): it is incremental, order-independent and exactly reversible (a correction decrements counts), which matters for deletion (§5). An online logistic regression over the same features may replace it per label when it measurably beats naive Bayes in the harness (§8); the layer's interface does not change.
- **Training signal.** Only the owner's actions: adding a tag to an item (positive for that label), removing an automated tag (negative), explicitly confirming a suggestion. Rule-applied and model-applied tags are not training examples by themselves, to avoid a feedback loop. Optional weak labels from layer 4 are discussed in question 3.
- **Size.** Hashed to a fixed bucket count, so state is bounded (order of 1–2 MiB for the default taxonomy; sized in phase C2) and independent of mail volume.
- **Abstention.** A label has no layer-2 score until it has at least `MIN_POS` positive and `MIN_NEG` negative owner examples (starting point 10 and 10). Below that the layer abstains for that label (§6).

### 1.3 Layer 3: embedding similarity

- The item's text is embedded once through the owner's `embedding/v1` resource ([spike §3](media-and-embeddings-spike.md#3-embedding-contract); the 3sln.me built-in text embedder on paid plans). The vector is compared (cosine) with, per label, the label's **description vector** (embedded once, cached by `space` and description text) and the label's **centroid**: the running mean of vectors of items the owner tagged with that label.
- **Score.** A monotone calibration maps similarity to [0, 1] per label, fitted on the owner's labelled examples once enough exist and on conservative defaults per `space` before that. The score is the larger of the description and (when it has at least `MIN_CENTROID` examples) the centroid component; provenance records which.
- **Storage.** Centroids and description vectors live in the mailbox, bound to the `space` string. Per-example vectors are kept only for a bounded recent window per label (for recomputation and removal); item vectors are otherwise discarded after scoring. A change of `space` discards centroids and the calibration; description scoring works immediately and centroids rebuild from corrections.
- **Disclosure.** The item text goes to the embedder under the same detail and consent rules as a classifier call; the embedder receives no tags ([spike §3.2](media-and-embeddings-spike.md#32-embed-arguments)).

### 1.4 Layer 4: LLM decision model

The existing built-in classifier (or any resource in the fragment's text or fallback field) through the existing `classify` consumer: capabilities check, detail level, failover rules ([item-classification §8.3](../spec/extensions/item-classification.md#83-selection)), pending state and 10-minute deadline are unchanged. What changes is the call's label set: only the labels still uncertain are sent (fewer labels also lowers the cost estimate and may avoid splitting under `maxLabels`, IC-10), and, if the classifier advertises it, with examples (§3). Layer 4 never runs on Free (the built-in is paid-gated, and the owner may assign none).

## 2. Confidence, thresholds and deferral

### 2.1 Decision bands

Per layer and label, two thresholds define three outcomes: `score >= hi` is **positive**, `score <= lo` is **negative**, anything between (or an abstention) is **uncertain**. A label is settled by the first layer that is positive or negative about it. Uncertain labels pass to the next layer; settled labels are not sent on, and are not re-scored by lower layers except in shadow mode (§8).

- Thresholds are per user, per layer, per label, and bound to (`model.id`, `model.version`, taxonomy schema), as the contract requires of consumers ([§7 rule 2](../spec/extensions/item-classification.md#7-result)) and as `normalizePin` already enforces for layer 4. Layers 2 and 3 get synthetic model ids (for example `parlay-filter`, version = algorithm and feature version) so existing pins and `calibration` evidence fit. The filter's learned state changes continuously and is not a version bump; its calibration is re-estimated on the owner's own data instead.
- **Defaults** (starting points to be tuned in the harness, not measured): `hi` 0.90, `lo` 0.05 for layer 2; `hi` 0.85, `lo` 0.15 for layer 3 before calibration, widened until the calibration has enough examples; layer 4 keeps today's per-label pinned thresholds and has no `lo`/uncertain band: whatever it returns is final.
- **Asymmetric cost.** Labels that trigger consequential rule effects (for example `quarantined`, `spam`, `verification`) use stricter cheap-layer bands (higher `hi`), so more of them defer to layer 4; harmless organising labels use looser bands.
- **Self-tuning.** Each layer tracks, per label, agreement between its settled outputs and later owner corrections (progressive validation: score first, then learn). If a layer's recent correction rate for a label exceeds a ceiling, its `hi` rises and `lo` falls (more deferral) until it recovers. A layer never self-tunes toward settling more.

### 2.2 When a layer defers

1. It abstains (not enough examples, no embedder, plan does not include it, resource unavailable or refused).
2. A label's score falls in its uncertain band.
3. Disagreement: layers 2 and 3, when both ran (for example after a paid-tier "verify" policy or in shadow mode), disagree on a label's side; the label is treated as uncertain for the live decision.
4. The tier policy (§4.3) requires the next layer regardless (for example Ultra "verify every positive of a consequential label").

A layer that **errors** (as opposed to abstains) is handled by §7, never by silently deferring.

## 3. Contract change: label forms and examples

An additive change to `item-classification/v1`, rewritten in place (the artefacts were never published; owner direction 2026-10-28 on in-place edits). Needed because a classifier that works from examples (embedding, few-shot or kNN) is a different kind of classifier from one that reads a description, and callers should not guess.

1. **`capabilities`** gains `labelForms`: 1–2 distinct entries from `description`, `examples`; plus `maxExamples` (per label, 1–8) and `maxExampleCodePoints` (1–500) when `examples` is listed. A result without `labelForms` reads as `["description"]`. Existing rules on open results apply: readers ignore unknown forms.
2. **`classify` labels** become `{id, description?, examples?}` with at least one of the two. `examples` is 1–`maxExamples` strings of well-formed Unicode, each 1–`maxExampleCodePoints` code points, not only white space, no controls except LF and TAB, no bidirectional controls. Examples are positive instances only.
3. A call using a form the classifier did not advertise, or exceeding `maxExamples` or `maxExampleCodePoints`, is refused before any effect with `unsupported_item` ([§4.3](../spec/extensions/item-classification.md#43-unsupported_item)); other violations remain `invalid_args`. Candidate selection ([§8.3](../spec/extensions/item-classification.md#83-selection)) skips a candidate whose `labelForms` do not cover what the app must send (descriptions are always available to Parlay, so description-capable candidates are never skipped on this ground).
4. **Security and privacy.** Examples are item-derived user content, not labels in the §10 rule 1 sense: a classifier treats them as data that define a category, keeps them out of its instruction channel, and holds them under §9 (no storage, no logging, no journal). Because they disclose items other than the one being classified, an app sends examples only at detail `full` (recommended; no new fragment field), never at `minimal` or `standard`. Examples are selected from the owner's own tagged items, bounded and truncated; they MUST NOT include items from other owners or conversations the owner has not opted into classification.
5. **Cost.** The classifier's pre-effect cost estimate includes example bytes; the app's label-splitting rule (IC-10) counts examples toward the same per-call bounds.
6. The embedding layer needs no contract change: it uses `embedding/v1` directly. The change above lets a third-party or built-in classifier resource that is example-driven sit in layer 4 or, by owner assignment, replace layer 3 (question 6).

## 4. The combined result and provenance

### 4.1 Combination rule

Scores are not averaged: layers are calibrated differently and a mean of incomparable numbers has no meaning. Each label's final value is the score of the layer that settled it; labels no layer settled are uncertain and receive no automated tag.

### 4.2 Result record

The existing `classificationResult` evidence gains, per label:

`{label, side: positive|negative|uncertain, score?, layer: rules|filter|embedding|llm|none, model: {id, version}, deferredFrom: [layer…]}`

and per item: the layers run, the layers skipped and why (`plan`, `not_needed`, `unavailable`, `allowance`, `abstained`), and the paid cost class actually incurred (`none`, `embed`, `embed+llm`), never a price or content. Automated tags carry the deciding layer so the UI can say "Marked promotional by your learned filter" and an owner correcting it knows which layer to blame. Rules receive tags with the same suspected-tag mechanism as today (`sys:suspected.<category>` with a probability), so existing rule definitions keep working; probability for a rule-settled label is not model evidence and is omitted.

### 4.3 Tier policy

| Plan | Layers | Layer 4 policy |
| --- | --- | --- |
| Free | 1, 2 | none (built-in is paid-gated; an owner-assigned third-party classifier may serve layer 4 under its own terms) |
| Paid | 1, 2, 3, 4 | uncertain labels only; shared AI allowance; items it cannot afford keep their cheap-layer tags |
| Plus | 1–4 | uncertain labels; higher caps |
| Ultra | 1–4 | uncertain labels; optional "verify consequential positives" and a larger spot-audit sample |

These differ only by allowance and caps, not by logic, so the cascade is one code path configured by plan data. This is a coordinator proposal on the unpublished plan table; the owner decides tiers (question 7).

## 5. Privacy and data handling

1. **Where state lives.** Filter counts, calibration, label vectors and centroids are Parlay mailbox data in the user's own mailbox (a reserved key prefix beside `bb:classify:settings`), under the owner's existing storage and deletion rules. There is no shared or global model and no cross-user training or aggregate statistics; operators see only counters without content (layer, outcome class, µUSD).
2. **What is stored.** Hashed bucket counts, not text; fixed-size vectors for a bounded recent window; item ids for those examples so they can be un-learned. Hashed counts are still personal data derived from content and are treated as such, though they are not meant to be invertible (the hash is keyed per mailbox; question 8).
3. **Disclosure to providers.** Layer 2 discloses nothing. Layer 3 discloses item text to the embedder, layer 4 to the classifier, each under the owner's per-field detail level and the existing consent flag (`classify.settings consent`). Filter state is never sent to either.
4. **Export and deletion.** The filter is included in account export as a versioned, documented, bounded blob (counts and calibration; vectors optional), so a move to another provider does not lose training. Deleting the account deletes it with the mailbox. Owner controls: "Reset learned filter" (clears layers 2 and 3 state; rules untouched), per-label reset, and un-learning an individual correction. The deadline and retention behaviour of the pending state is unchanged.
5. **Multi-account and organizations.** State is per mailbox owner. How a person's filter relates to an organization context ([org-context spike](org-context-and-layered-preferences-spike.md)) is left to question 9; the default is no sharing.

## 6. Cold start

- **Day one, no examples.** Layer 1 runs. Layer 2 abstains. Layer 3 scores from label descriptions only (paid plans). Layer 4 handles what layer 3 cannot settle. So a new Paid user's early mail leans on layers 3 and 4 and the cost per item starts highest; Free users get rules only plus a filter that starts working after about `MIN_POS`/`MIN_NEG` corrections per label.
- **Seeding.** Parlay's default rules seed the first labels. Optionally, layer 2 starts from a small shared-nothing generic prior built from the default taxonomy's label descriptions (no user data); recommended off at first (question 4).
- **Warm-up.** Every owner tag action trains layer 2 and, for paid plans, adds the item's vector to layer 3's centroid (one embed call, counted once). A visible "learning" indicator shows per-label example counts so the owner understands why suggestions improve.
- **Bootstrapping from history.** An owner may ask to learn from already tagged items. Layer 2 can backfill with no provider cost; layer 3 backfill costs one embed per example and is capped by the per-app allowance share and the embed per-minute cap.

## 7. Failure tag interaction

Owner direction 2026-10-28 stands: an item whose auto-classification fails gets `sys:classification-failed` with a reason, goes through the final rule run, and can be re-requested with "Classify again". The layered design refines when that applies:

1. **Cheap layers never fail an item.** Layers 1–2 are local and synchronous; an internal error in layer 2 is logged as a counter and treated as abstention.
2. **A paid layer that was entitled, configured and needed, and failed, fails only the labels it was needed for.** Labels settled by earlier layers are tagged normally and the final run uses them. The item gets the failure tag only when at least one label is still uncertain because layer 3 or 4 failed (reasons as today: `allowance`, `unavailable`, `unsupported`, `no-classifier`, `unknown-outcome`, `invalid`, `item-unavailable`, `deadline`, plus a `layer` annotation).
3. **Not entitled is not failure.** On Free, or when the owner assigned no classifier, uncertain labels simply stay untagged with the skip reason `plan` or `not_configured`; the item is not marked failed. The existing capability-gap notice to the owner (item-classification §8.4 rule 2) remains. This also resolves the reviewed "Free owners silently get unscored items" finding.
4. **Pending and notification hold only when needed.** Today every eligible item becomes pending with a held notification. In the cascade, an item settled by layers 1–3 never becomes pending beyond layer 3's seconds; only items waiting for layer 4 hold their notification, bounded by the same 10-minute deadline. Provisional tags from settled labels apply immediately.
5. **Allowance exhaustion degrades gracefully.** Once the pool is spent, layer 3/4 deferrals fail with `allowance`; items whose labels cheap layers settled are unaffected. "Classify again" re-enters at layer 2 (now with newer training) and charges only the paid layers it actually calls.
6. **Never fail over across layers after ambiguity.** The existing rule (item-classification §8.3 rule 4: no second classifier after an ambiguous outcome) applies per paid layer: after an ambiguous layer-3 or layer-4 outcome, the app stops and does not send the item to the other paid layer for that operation.

## 8. Cost model and shared allowance

| Layer | Provider cost | Draws on the AI allowance | Latency |
| --- | --- | --- | --- |
| 1 rules | none | no | in transaction |
| 2 filter | none (Worker CPU: a few thousand hash lookups per item; training is O(features) per correction) | no | sub-millisecond to milliseconds |
| 3 embedding | about 5–35 µUSD per item ([spike §4.3](media-and-embeddings-spike.md#43-cost-units), unverified); description vectors cached | yes: the shared per-plan pool, per-service `embed` cap, per-app 50% share | one embedder round trip |
| 4 LLM | up to about 2,500 µUSD, per-call ceiling 3,000 | yes | seconds; pending state |

Layers 1–2 never touch the AI pool or the local daily call counter (`classify.settings allowance`); that counter is reinterpreted as a count of paid-layer calls. Layer-3 embedding uses the same lease and refuse-before-effect pattern as classification.

**Illustration only (hypothetical settlement rates, not measurements).** For 1,000 items: all-LLM costs up to 2.5 million µUSD. If layers 1–2 settled 60% and layer 3 settled three quarters of the rest, then 400 items reach layer 3 (about 8,000 µUSD at 20 µUSD) and 100 reach layer 4 (up to 250,000 µUSD): about a tenth of the all-LLM spend. A Paid account's 40,000 µUSD pool would then cover on the order of 160 items reaching layer 4 plus embeddings instead of about 16, so the pool is spent far more slowly; but the real settlement rates depend on the owner's mail and must be measured before the allowance table is revised or any claim is made to users. Backfills (§6) and spot audits (§9) are charged against the same pool and per-app share.

## 9. Evaluation and metrics

- **Offline harness.** Engine-level tests (the project's preference) over synthetic and recorded-shape corpora with seeded chaos: label drift, owner corrections, embedder and LLM failures and timeouts, allowance exhaustion, `space` change, deletion and export round trips, and layer disagreement. A stub classifier and stub embedder in `tests/sim` stand in for providers, as the simulation design does; passing shows self-consistency, not provider conformance.
- **Metrics (per mailbox, counters only, never content).** Share of items settled per layer; deferral rate per layer and label; paid-call rate per 100 items and modelled µUSD per item; owner correction rate per layer, label and plan (the practical precision measure); calibration (reliability bins, Brier score) per (model, version); failure-tag rate by reason; pending time (p50, p95); time to first provisional tag.
- **Shadow mode.** New layers and new thresholds first run in shadow: they score and are logged against owner corrections, but do not set tags. Layer 4 may also audit a small sample of settled items on Plus and Ultra (allowance permitting) to estimate the cheap layers' hidden error; the audit result adjusts thresholds and is not shown as a tag.
- **Release criteria** for enabling a layer: correction rate no worse than the layer-4-only baseline for the labels it settles, on the harness and in shadow, and a measured cost reduction. The harness numbers are not production evidence.

## 10. Phases (flags off throughout)

| Phase | Content |
| --- | --- |
| C0 | Contract change (§3) in the spec, artefacts, validation and test double; no consumer uses it yet. |
| C1 | Refactor `classify.mjs` into a layer pipeline with the provenance record (§4), behaviour identical (layer 4 only); failure-tag refinements of §7 items 2, 3 and 5 under a flag. |
| C2 | Layer 2: feature extraction, naive Bayes state, training from owner tag actions, reset and un-learn, export blob; shadow mode, then enabled. |
| C3 | Layer 3: embedder resource use (depends on the embedding contract and built-in embedder phases), description vectors, centroids, calibration. |
| C4 | Tier policy, allowance accounting (`embed` caps, reinterpreted local counter), Classify-again from layer 2, owner-facing provenance text (en/es). |
| C5 | Metrics, spot audit, threshold self-tuning, optional logistic upgrade and layer-4 examples. |

Flag proposal: `CLASSIFY_LAYERED_ENABLED`, with per-layer sub-flags, default off. Release remains gated by [release gates](../3sln/release-gates.md) and DEVLOG.

## 11. Decisions (provisional, unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| LC-1 | Classification in Parlay is a four-layer cascade; each label is settled by the first confident layer; scores are never averaged. | Reviewer ___ Date ___ Outcome ___ |
| LC-2 | Layer 2 is a per-user filter in the user's mailbox, trained only from the user's own actions, on every plan, with no provider cost. | Reviewer ___ Date ___ Outcome ___ |
| LC-3 | Embedding similarity is the default paid classifier; the LLM sees only labels still uncertain. | Reviewer ___ Date ___ Outcome ___ |
| LC-4 | Additive in-place contract change: `labelForms`, optional `description`, optional positive `examples`, sent only at detail `full`. | Reviewer ___ Date ___ Outcome ___ |
| LC-5 | The failure tag applies only when an entitled, needed paid layer failed, and only for the labels it was needed for; not-entitled is not failure. | Reviewer ___ Date ___ Outcome ___ |
| LC-6 | Filter state is exported with the account and deleted with it; owner can reset and un-learn. | Reviewer ___ Date ___ Outcome ___ |

## 12. Open questions (recommended answers)

1. **Naive Bayes or logistic first?** Naive Bayes: incremental, reversible, tiny. Logistic as a later upgrade per label if the harness shows a gain.
2. **Minimum examples before layer 2 acts?** 10 positive and 10 negative per label to start; tune in shadow.
3. **Train layers 2–3 from layer 4's confident outputs (distillation)?** Yes at reduced weight (for example 0.25), capped per label, marked as weak so owner corrections always outweigh it; risk of reinforcing LLM mistakes is bounded by self-tuning and removal on owner correction. Recommend off until phase C5 evidence.
4. **A generic prior for layer 2?** No at first; rules and layer 3 cover day one without shipping any model.
5. **Examples at detail `full` only, or a separate owner setting?** `full` only, no fragment change; revisit if owners want examples without sharing tags.
6. **Can an example-driven classifier resource replace layer 3?** Yes, by owner assignment in the fragment; the default remains Parlay's own layer 3 over `embedding/v1`.
7. **Tier policy and whether Free gets any provider layer?** As §4.3: Free has layers 1–2 only. The owner decides prices and tiers.
8. **Is keyed hashing enough to call filter state non-content?** Treat it as personal data regardless (exported, deleted, never shared); keyed per mailbox, so counts from two mailboxes are not comparable.
9. **Organizations: shared filter?** No sharing in v1; an organization context uses the member's own filter for personal mail and none for organization-owned mail until organization classification is designed.
10. **Is the local daily call counter still needed?** Keep it as a paid-layer safety cap (default unchanged), renamed in the UI and status to reflect paid calls.
11. **Where do layer 2–3 thresholds appear to the owner?** Not at all by default; the owner sees outcomes and corrections, not numbers. A per-label "be more careful" control raises the cheap-layer bands.
12. **State size ceiling?** About 2 MiB per mailbox for layers 2–3 combined, enforced; label count bounded by the taxonomy limit, exceeding it disables layers 2–3 for the excess labels rather than failing.
