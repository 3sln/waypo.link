# Item classification contract — draft

> **Group:** Bindle extension
>
> **Status:** draft, provisional and unsigned (2026-10-28), rewritten in place under the owner directions of 2026-10-28 (the artefacts were never published). Implemented locally behind default-off flags: shared validation in the Bindle SDK, a test double, and one provider's paid built-in classifier (text only, inline only). Nothing is published, deployed or production-verified. The security review of caller-supplied labels and of the presigned-URL rules is pending.
>
> **Covers:** the `item-classification/v1` contract (`capabilities` and `classify`), the item-classification fragment, and the rules applications follow when they use it.
>
> **Does not cover:** what an app does with scores (thresholds, tags, rules); how a classifier is priced or billed; how a provider surfaces candidates ([extensions §5–§6](../extensions.md#5-candidates-and-assignment)); the Cloudflare integration that may later supply classifiers.

Read [the protocol](../protocol.md) first. Identifiers under `https://spec.bindle.example/` are placeholders until publication authority is agreed. MUST, SHOULD and MAY express draft requirements.

## 1. Identity

| What | Identifier | Document |
| --- | --- | --- |
| Contract | `https://spec.bindle.example/contracts/item-classification/v1` | `docs/artefacts/item-classification-v1.json` (JSON Schema with `x-methods`) |
| Fragment | `https://spec.bindle.example/fragments/item-classification/v1` | `docs/artefacts/fragments/item-classification-v1.json` |

1. A classifier is a resource whose descriptor lists this contract with both methods. It is normally a brokered resource of an integration the owner adds. A provider that supplies one as a built-in lists the contract in its manifest `contracts` ([extensions §5.2](../extensions.md#52-built-ins)). There is no extension declaration.
2. The contract is generic. A classifier MUST NOT hard-code categories, prompts or a taxonomy: the caller supplies the labels with every call (§3).
3. The contract is append-only: later versions of the line follow [artefacts §6](../artefacts.md#6-additive-change). Results are open (§4.2, §7).

## 2. Vocabulary

### 2.1 Item kinds

`text`, `image`, `audio`, `video`, `document` (PDF, office and similar files) and `other`. The caller chooses the kind. A later version of the line may add kinds; readers of a capabilities result ignore kinds they do not know (§4.2).

### 2.2 Media types

An item's `mediaType` is a lowercase media-type essence with no parameters (RFC 6838 restricted names, at most 127 characters), for example `text/plain`. A `text/*` item is UTF-8. In capabilities, a classifier may also list `type/*` and `*/*`.

### 2.3 Detail levels

Every call carries the item's kind, media type and size, because a classifier cannot read the bytes without them and they disclose nothing the bytes do not. Anything else is a **tag**. The detail level says which tags a call may carry:

| Level | Tags allowed |
| --- | --- |
| `minimal` | none |
| `standard` | `language` |
| `full` | `language`, `source`, `origin`, `context` |

A level is a ceiling: a caller MAY send fewer tags than its level allows.

### 2.4 Tags

`tags` is an object with at most these members:

| Member | Rule |
| --- | --- |
| `language` | A BCP 47 tag, at most 35 characters, describing the item's language. |
| `source` | A lowercase token (`^[a-z][a-z0-9-]{0,31}$`) for the channel the item came through. Registered values: `email`, `message`, `upload`, `web`, `feed`, `capture`, `other`. A classifier reads any other value as `other`. |
| `origin` | A lowercase DNS host name the item came from (for example the sending domain or website host). Never a URL, path, address or account. |
| `context` | 1–16 distinct caller-defined tokens matching `^[a-z0-9][a-z0-9._:-]{0,63}$` (for example mail header hints). |

New members arrive only in later versions of the line. An app-specific need uses `context` tokens.

## 3. `classify` arguments

Arguments are exactly `{detail, item, tags?, labels}`.

| Member | Rule |
| --- | --- |
| `detail` | `minimal`, `standard` or `full`: the level the caller applied (§2.3, §8.2). |
| `item.kind` | One of §2.1. |
| `item.mediaType` | §2.2. |
| `item.size` | The item's exact length in bytes. |
| `item.data` | Inline form: a CBOR byte string (`x-type: "bytes"`) of exactly `size` bytes, `size` at most 262,144. RPC is [Bindle CBOR](../cbor.md) (2026-10-29), so there is no base64 form; the contract was rewritten in place. |
| `item.url` | Presigned form: `{href, expiresAt}` (§5), `size` 1–104,857,600. |
| `tags` | Optional; §2.4, and only the members `detail` allows. |
| `labels` | 1–16 objects `{id, description}` with distinct `id`s. |
| `labels[].id` | Matches `^[a-z0-9][a-z0-9._-]{0,63}$`. |
| `labels[].description` | 1–200 Unicode code points, well-formed, not only white space, one plain line: no C0 or C1 controls, DEL, U+2028, U+2029 or bidirectional controls. |

An item has exactly one of `data` and `url`. Unknown members anywhere in the arguments are refused.

1. A classifier validates the arguments completely and deterministically before any effect (fetch, charge, model call). A violation of this section or of §5.1 is `invalid_args`, including tags beyond `detail`.
2. A classifier MUST NOT treat the absence of a tag as information about the item: under `minimal` and `standard` it was withheld, not unknown.

## 4. `capabilities`

### 4.1 Arguments

Exactly `{}`. The method is side-effect-free (`effect: read`): it is not charged and carries no item.

### 4.2 Result

`{kinds, maxLabels, model?}`:

- `kinds`: 0–16 entries `{kind, mediaTypes, inputs, maxBytes}`, one per kind. `mediaTypes`: 1–32 media types or ranges (§2.2). `inputs`: the forms accepted, `inline` and/or `url`; listing `url` means the classifier fetches presigned URLs (§5.2). `maxBytes`: 1–104,857,600; for the inline form the effective bound is the smaller of `maxBytes` and 262,144.
- `maxLabels`: 1–16.
- `model`: optional `{id, version}`, informational. Scores still carry their own `model` (§7).

The result is open: readers ignore unknown members, kinds and input forms. A reader that finds a known member malformed treats the whole result as unusable (§8.3).

### 4.3 `unsupported_item`

A classifier refuses with `unsupported_item` any well-formed call outside its current capabilities: a kind it does not list, a media type no range of that kind matches, an input form it does not accept, a size over its bound, or more labels than `maxLabels`. It checks this before any effect. `unsupported_item` is the contract's "cannot classify this kind of thing" error. It claims no effect, and applications fail over on it (§8.3) and surface it (§8.4).

## 5. Presigned URLs

### 5.1 Rules checked from the arguments

`item.url` is `{href, expiresAt}`:

1. `href` is at most 4,096 characters, an absolute `https:` URL in its WHATWG-serialized form, with no userinfo, no fragment and no port other than 443. Its host is a DNS name with at least two labels: not an IP literal, not `localhost` and not under `.localhost`, `.local`, `.internal` or `.home.arpa`.
2. `expiresAt` is an integer in milliseconds since the epoch, later than the classifier's current time and at most one hour after it.
3. The URL is a read-only capability for exactly one object of exactly `size` bytes. The caller MUST NOT put a credential in it beyond the signature, and SHOULD use an opaque object key, so that under `minimal` the URL does not reveal the item's name or source. It SHOULD expire within five minutes.

### 5.2 Fetching

A classifier that lists `url` fetches like this:

1. Exactly the given `href`, never a URL derived from it, from its response or from the item's content.
2. Only from public addresses. It refuses if any address the host resolves to is loopback, private, link-local, site-local, shared (CGNAT), multicast, reserved, discard-only, documentation (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32, 3fff::/20) or another special-purpose address, or the IPv6 equivalent. It judges the address's bytes, not its spelling: every valid text form of an address is the same address, and an IPv6 address that carries an IPv4 address (IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`) is refused when the IPv4 address is. It refuses the deprecated IPv4-compatible block `::/96` and anything it cannot parse as an address.
   - The address it checks MUST be the address it connects to, on every connection attempt, retries included. Resolving the name to check it and then letting the transport resolve the name again is not enough, because a short-lived DNS answer can change in between (DNS rebinding). A classifier checks inside its transport's own address lookup or connect step, and connects only to the address it checked.
   - A runtime that cannot check the address it actually connects to (no resolver or connect hook) MUST NOT list `url` in `capabilities`, unless it relies on a platform control that refuses non-public destinations and that it has verified for that platform; it names that control in its documentation.
   - The 3sln.me built-in classifier accepts no URLs: its only input is `inline`.
3. One `GET` with no request body, no credentials, cookies, `Authorization` or `Referer`, and no redirects: any 3xx response is a failure, whatever its target. It MAY retry the same `GET` within the time bound; each retry is a new connection attempt under rule 2.
4. Bounded: it reads at most `size` bytes and fails when the body is longer or shorter, or `Content-Length` disagrees with `size`; the whole fetch ends within 30 seconds and no later than `expiresAt`. It holds only the bytes actually received, with a running cap at `size`; it does not reserve `size` bytes before the body arrives.
5. Only status 200 counts. It treats the bytes as `item.mediaType` and MUST NOT pick a different decoder from the response's `Content-Type`.
6. Once it has returned its answer for the call, it never fetches the URL again.

A failure is `item_unavailable`. It is not a no-effect code (§6), because the request reached the item's host: the application does not fail over on it, and may retry with a fresh URL and a fresh `tx`.

## 6. Errors and effects

| Code | When | No effect claimed |
| --- | --- | --- |
| `invalid_args` | §3 or §5.1 violated. | yes |
| `unsupported_item` | §4.3. | yes |
| `rate_limited`, `forbidden`, `temporarily_unavailable` | Classifier policy, before any effect ([protocol §5, AMD-C4](../protocol.md#5-rpc-transport)). | yes |
| `item_unavailable` | §5.2. | no |
| `indeterminate` | Outcome unknown, or any refusal after an effect. | no |

1. A classifier MUST NOT answer a no-effect code after any effect (a fetch, a charge, a model call): it answers `indeterminate`.
2. A classifier MUST NOT retry a model call against another model, and MUST NOT forward the item to another classifier.
3. A classifier MAY return `invalid_classification` when its model produced an unusable answer. A caller treats it as an ambiguous outcome.

## 7. Result

`classify` returns `{scores, model}`.

1. `scores` has exactly one member per supplied label id and no others. Each value is a number in [0, 1]. Scores are independent per label: not a distribution, and they need not sum to 1.
2. `model` is `{id, version}`, at most 100 and 64 code points. A different model or version MAY score the same input differently. Consumers bind any threshold to (`model.id`, `model.version`) and their own taxonomy, and treat a new pair as uncalibrated.
3. A result that breaks rule 1 or 2 is not a result: a consumer discards it and does not send the item to another classifier (§8.3).
4. The result is open. Readers MUST ignore members their pinned version does not name.

## 8. Fragment and applications

### 8.1 Fields

| Field | Type | Attributes |
| --- | --- | --- |
| `text`, `image`, `audio`, `video`, `document` | resource | cardinality 0–1, contract `item-classification/v1`, `selection: exclusive`, consumers `application`, `announce: true` |
| `fallback` | resource | as above; serves kinds with no field filled, the `other` kind, and failover |
| `textDetail` … `documentDetail`, `fallbackDetail` | enum `minimal`, `standard`, `full` | cardinality 0–1 |

The fragment uses only the [protocol §3](../protocol.md#3-fragments-and-preference-values) member table. Any app may request it; only the owner fills it (owner floor), and each app sees only its own approved values. Apps share it rather than publishing their own classifier fragments (IC-4). `announce` lets the provider tell the owner, after connecting an integration, which classifier fields it can fill ([extensions §6](../extensions.md#6-announcements-announce)); classifiers come only from integrations the owner adds, so this is the main way an owner learns of a new one.

### 8.2 Detail

1. Each classifier field has its own detail field, because what an owner is willing to share depends on who runs the classifier, and the per-kind classifiers can be different parties (an owner's own classifier for text, a third-party service for images).
2. An app MUST build each call under the detail value of the field whose resource it calls, and sets `detail` to that value. An absent or unrecognized value, or a detail field the app was not granted, means `minimal`.
3. An app MUST NOT send tags beyond that level and SHOULD send only tags that help classification. The classifier refuses a call whose tags exceed `detail` (§3 rule 1), as a backstop against mistakes.
4. Enforcing the detail level is the app's obligation. The classifier sees only the `detail` the app declares and cannot tell what the owner allowed, and an app can put any data in the item itself. The check in rule 3 catches an app's mistakes; it is not a boundary against an app that means to send more than the owner allowed. An owner limits what an app can disclose by which apps they grant and which classifiers they assign.

### 8.3 Selection

For an item of kind K, an app reads the fragment's values once for the operation ([extensions §3.2](../extensions.md#32-operation-snapshot)) and:

1. Takes the candidates in order: field K (none for `other`), then `fallback` when it holds a different resource. Only resources available to it count ([extensions §3.1](../extensions.md#31-availability-and-representation)).
2. Reads each candidate's capabilities (it MAY cache them for up to one hour per resource and generation, and drops the cache on `unsupported_item`). It skips, without sending the item, a candidate whose capabilities cannot be read, are unusable (§4.2) or do not cover the item (§4.3).
3. Calls `classify` on the first remaining candidate with a fresh `tx`. When the candidate's `maxLabels` is smaller than the app's label set, the app MAY split the labels into calls of at most `maxLabels`, sent to that candidate one after another, each with a fresh `tx`; it merges the scores only when every call reports the same `model`. After `unsupported_item`, or a failure that proves no effect under [extensions §3.3](../extensions.md#33-failover-for-ordered), and before any call to the candidate succeeded, it moves to the next candidate with a fresh `tx`, rebuilding the call under that field's detail. Once a call to a candidate has succeeded, it never moves to another candidate for that operation.
4. After `indeterminate`, `item_unavailable`, `invalid_classification`, a discarded result (§7 rule 3), a timeout after sending or any other ambiguous outcome, it stops: it MUST NOT send the item to another classifier for that operation.

### 8.4 Unscored items and gaps

1. An item the app meant to classify that ends without a score is **unscored**. The app records that state, with the reason, and MUST NOT treat an unscored item as one that was checked and found clean. What an unscored item means for delivery is the app's policy; it SHOULD be the conservative choice for that app.
2. When no candidate exists for a kind, or every candidate refused the item for its capabilities or with `unsupported_item`, the app tells the owner, naming the kind (and media type where useful), so the owner can choose another classifier. A transient failure is not such a gap.
3. An app SHOULD let the owner find its unscored items (for example by a tag or filter) and MAY let the owner ask for them to be classified again. A re-request is a new classification: it is charged and metered like the first, and an app MUST NOT send an item again on its own after an ambiguous outcome (§8.3 rule 4). An app that holds items while they await classification SHOULD bound that wait and treat an item still waiting at the bound as unscored.

> **Note (non-normative, provisional).** Parlay (owner direction 2026-10-28) marks an unscored item with its own "auto-classification failed" tag (`sys:classification-failed`), keeps the reason for display, runs its final rules on it, fails items still pending after 10 minutes the same way, and offers "Classify again" for selected failed items.

## 9. Retention and logging

1. A classifier MUST NOT store, log or forward the item, the URL, the tags, the labels or the scores beyond producing the result, except to the model it invokes for this call. Counters and spend records hold no content.
2. An RPC journal MUST NOT retain the `classify` result. A retry with the same `tx` answers `indeterminate`; the journal keeps only its request fingerprint for the deduplication window.
3. Audit records carry the caller, the resource and the outcome class, never argument or result content ([protocol §5](../protocol.md#5-rpc-transport)).

## 10. Security

1. Labels are the caller's taxonomy, not instructions. A classifier keeps them out of any instruction channel it controls: only fixed text and validated label ids may appear there, and descriptions are passed as data that define categories. A caller MUST NOT copy item content into labels.
2. The item, its tags and the content behind a URL are untrusted data. A classifier frames them as data and gives the model no tools, URLs, retrieval or other side effects. The URL fetch (§5.2) is the only network request a call may cause.
3. Scores are advice. No score, label or model output authorizes anything; consumers apply them only through their own owner-controlled rules.
4. A grant on this contract lets an app disclose items it already holds to the classifier the owner chose, up to the owner's detail level, possibly at the owner's cost. Classifiers bound that cost per call and per period, refusing before any effect (§6).

## 11. Decisions (provisional, unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| IC-1 | Bindle-owned generic contract; classifiers implement it, apps own their taxonomies (owner direction 2026-10-27). | Reviewer ___ Date ___ Outcome ___ |
| IC-2 | The item travels inline (a CBOR byte string, at most 256 KiB) or as a presigned HTTPS URL the classifier fetches under §5 (owner direction 2026-10-28). The fetch is exactly one URL, public addresses only, no redirects, no credentials, bounded in size and time. | Reviewer ___ Date ___ Outcome ___ |
| IC-3 | `classify` carries `effect: write`, because it discloses the item and may cost the owner; it is never treated as read-only or pure. `capabilities` is a read. | Reviewer ___ Date ___ Outcome ___ |
| IC-4 | One shared Bindle fragment instead of per-app classifier fragments; apps use their own grants on it. | Owner-approved 2026-10-28 (DEVLOG "Owner directions: classification, built-in integrations, platform resources"). Reviewer ___ Date ___ Outcome ___ |
| IC-5 | Per-kind classifier fields (`text`, `image`, `audio`, `video`, `document`) plus `fallback`, each `exclusive`; cross-field failover only on `unsupported_item` or a proven no-effect failure (§8.3) (owner direction 2026-10-28). | Reviewer ___ Date ___ Outcome ___ |
| IC-6 | Detail is owner-chosen per classifier field with three levels; kind, media type and size always travel; the call carries `detail` so a classifier can tell withheld from unknown and refuse tags beyond it. | Reviewer ___ Date ___ Outcome ___ |
| IC-7 | `unsupported_item` is the pre-effect, no-effect "cannot classify this" error; a refusal after any effect is `indeterminate`. | Reviewer ___ Date ___ Outcome ___ |
| IC-8 | An item an app meant to classify but could not score is explicitly `unscored`, never treated as checked; capability gaps are surfaced to the owner. | Reviewer ___ Date ___ Outcome ___ |
| IC-9 | The inline item is abstract bytes, a native CBOR byte string now that RPC is CBOR, with one size bound (owner direction 2026-10-28). | Reviewer ___ Date ___ Outcome ___ |
| IC-10 | Apps may split labels across calls to one classifier whose `maxLabels` is smaller, and never fail over after a part succeeded. | Reviewer ___ Date ___ Outcome ___ |
