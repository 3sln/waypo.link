# Item classification contract — draft

> **Group:** Bindle extension
>
> **Status:** draft, provisional and unsigned (2026-10-28). Implemented locally by one provider behind default-off flags; not published, deployed or production-verified. The security review of caller-supplied labels that extensions CR-X3-25 requires is pending.
>
> **Covers:** the `item-classification/v1` contract (one method, `classify`) and the item-classification fragment through which apps request a classifier.
>
> **Does not cover:** what any app does with scores (thresholds, tags, rules); how a provider prices or bills classification; resource-field selection and the owner floor ([extensions §3–§6](../extensions.md#3-selection)).

Read [the protocol](../protocol.md) first. Identifiers under `https://spec.bindle.example/` are placeholders until publication authority is agreed. MUST, SHOULD and MAY express draft requirements.

## 1. Identity

| What | Identifier | Document |
| --- | --- | --- |
| Contract | `https://spec.bindle.example/contracts/item-classification/v1` | `docs/artefacts/item-classification-v1.json` (JSON Schema with `x-methods`) |
| Fragment | `https://spec.bindle.example/fragments/item-classification/v1` | `docs/artefacts/fragments/item-classification-v1.json` |

1. A resource that implements this contract lists it in its descriptor's `contracts` with the method `classify`. A provider that supplies such a resource as a built-in lists the contract in its manifest `contracts` ([extensions §5.2](../extensions.md#52-built-ins)). There is no extension declaration.
2. The contract is generic. A classifier resource MUST NOT hard-code categories, prompts or a taxonomy: the caller supplies the labels with every call (§2).
3. The contract is append-only: later versions of the line follow [artefacts §6](../artefacts.md#6-additive-change). The result object is open (§4), so members can be added there.

## 2. `classify`

Arguments are exactly `{item, labels}`.

| Member | Rule |
| --- | --- |
| `item` | Object with exactly the members below, at least one of `text` and `media`. |
| `item.text` | String, at most 4,096 characters, well-formed Unicode (no lone surrogates). |
| `item.hints` | Optional array of at most 16 distinct caller-defined tokens matching `^[a-z0-9][a-z0-9._-]{0,63}$` (for example mail header hints). |
| `item.media` | Optional object `{type, data}`: `type` matches `^[a-z]{1,20}/[a-z0-9][a-z0-9.+-]{0,99}$`; `data` is unpadded base64url of at most 262,144 bytes. Inline only: the provider never fetches a reference. |
| `labels` | Array of 1–16 objects `{id, description}` with distinct `id`s. |
| `labels[].id` | Matches `^[a-z0-9][a-z0-9._-]{0,63}$`. |
| `labels[].description` | 1–200 characters, well-formed, not only white space, and one plain line: no C0 or C1 controls, DEL, U+2028, U+2029 or bidirectional controls. |

Unknown members anywhere in the arguments are refused.

## 3. Validation and limits

1. A resource validates the arguments completely and deterministically before any entitlement check, allowance debit, spend or model call. A violation of §2 is `invalid_args`.
2. A resource MAY have smaller limits than §2 (text bytes, label count, request bytes). It advertises them in its descriptor `limits` as `maxTextBytes`, `maxLabels` and `maxRequestBytes`, and refuses arguments over them with `invalid_args`, also before any effect.
3. A resource advertises the media types it accepts in `limits.mediaTypes` (possibly empty). Media of any other type is refused with `unsupported_media_type`, before any effect.
4. Rate limits, allowances and spend limits are resource policy. Refusals for them are `rate_limited` (or a resource-specific code) and MUST occur before the model is invoked. Under [protocol §5, AMD-C4](../protocol.md#5-rpc-transport), every `invalid_args`, `unsupported_*`, `rate_limited`, `forbidden` and `temporarily_unavailable` refusal means no effect occurred.
5. A model call whose outcome is unknown (timeout, transport failure) is `indeterminate`. A resource MUST NOT retry it against another model, and a consumer MUST NOT advance to the next resource of an `ordered` field after dispatch ([extensions §3.3](../extensions.md#33-failover-for-ordered)).

## 4. Result

The result is `{scores, model}`.

1. `scores` has exactly one member per supplied label id and no others. Each value is a number in [0, 1]. Scores are independent per label: they are not a distribution and need not sum to 1.
2. `model` is `{id, version}`, at most 100 and 64 characters. A different model or version MAY produce different scores for the same input. Consumers bind any threshold to (`model.id`, `model.version`) and their own taxonomy, and treat a new pair as uncalibrated.
3. A result that breaks rule 1 or 2 is not a result: the resource returns an error instead (the reference provider uses `invalid_classification`). A consumer that receives a result breaking rule 1 or 2 discards it.
4. The result object is open. Readers MUST ignore members their pinned version does not name.

## 5. Retention and logging

1. A resource MUST NOT store, log or forward the item, the hints, the labels or the scores beyond producing the result, except to the model it invokes for this call. Allowance counters and spend records hold no content.
2. A provider's RPC journal MUST NOT retain the result. A retry with the same `tx` answers `indeterminate`; the journal keeps only its request fingerprint for the deduplication window.
3. Audit records carry the caller, the resource and the outcome class, never argument or result content ([protocol §5](../protocol.md#5-rpc-transport)).

## 6. Caller-supplied labels

1. Labels are the caller's taxonomy, not instructions. A resource keeps them out of any instruction channel it controls: only fixed text and validated label ids may appear there, and descriptions are passed to the model as data that define categories.
2. The item is untrusted data. A resource frames it as data and gives the model no tools, URLs, retrieval or other side effects.
3. A caller MUST NOT copy item content into labels. A description is fixed taxonomy text authored by the caller.
4. Scores are advice. No score, label or model output authorizes anything; consumers apply them only through their own owner-controlled rules.
5. A grant on this contract lets an app ask bounded questions about text it already holds, at the owner's cost. Resources bound that cost per call and per period (§3 rule 4).

## 7. Fragment

The item-classification fragment has one resource field, `classifiers`: cardinality 0–4, contract `item-classification/v1`, `selection: ordered`, consumers `application`. Any app may request it. Only the owner fills it ([protocol §3, owner floor](../protocol.md#3-fragments-and-preference-values)), and apps that share it see only their own approved values.

## 8. Decisions (provisional, unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| IC-1 | Bindle-owned generic contract; providers implement it, apps own their taxonomies (owner direction 2026-10-27). | Reviewer ___ Date ___ Outcome ___ |
| IC-2 | Media is inline and bounded; no references, so no fetch and no second authorization chain. References would be a later additive member. | Reviewer ___ Date ___ Outcome ___ |
| IC-3 | `classify` carries `effect: write`, because it debits an allowance; it is never treated as read-only or pure. | Reviewer ___ Date ___ Outcome ___ |
| IC-4 | A shared Bindle fragment replaces per-app classifier fragments: the taxonomy travels in the call, so one owner choice serves every app. | Reviewer ___ Date ___ Outcome ___ |
