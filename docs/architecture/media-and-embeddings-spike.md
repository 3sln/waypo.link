# Media description and embeddings — design spike

> **Group:** Bindle extension contracts (media description, embedding), with 3sln.me reference service impact (paid built-ins, plan allowances, unit economics)
>
> **Status:** provisional design spike (2026-10-28), documentation only. Nothing here is signed off; every recommendation is a coordinator proposal. Sign-off: Reviewer ___ Date ___ Outcome ___. No code, spec, artefact or DEVLOG entry was changed. Production release remains disabled. Workers AI model names, prices, limits and licences quoted here are **unverified** planning inputs.
>
> **Covers:** why media description and embeddings are contracts separate from item classification; the `media-description/v1` and `embedding/v1` contract shapes and their fragments; the vector encoding; 3sln.me's paid built-in describer and embedder (candidate models, cost units, tier allowances, abuse guards, margin floor); coexistence with models the owner exposes through the Cloudflare console app; an end-to-end semantic gallery flow; spec impact, phases and open owner questions.
>
> **Does not cover:** the item-classification contract and fragment, which are being redesigned concurrently ([item classification](../spec/extensions/item-classification.md)) and are only referenced here; 3sln.me omni-search, which keeps its own internal embedding pipeline ([omni-search](../3sln/services/omni-search.md)); a hosted vector-search resource (noted as future, §3.7); pricing changes to plans ([unit economics](unit-economics.md)); the CBOR migration itself ([CBOR RPC spike](cbor-rpc-spike.md)).

Input: DEVLOG "2026-10-28 — Owner direction: content classification, media description and embeddings as separate paid services", read with the same day's directions on the classification redesign, the paid built-in classifier, the Cloudflare console app and CBOR for RPC. Code references are to HEAD d58305f plus the uncommitted classification redesign on disk. Hosts under `.example` are placeholders.

## 0. Recommendation in one screen

1. **Three contracts, not one.** Classification scores an item against the caller's labels (advice for rules). Description turns media into text (caption, open tags, extracted text) for people and indexes. Embedding turns text or media into a vector in a named space for similarity search. They differ in input, output, cost, latency, consumer and failure semantics (§1).
2. **`media-description/v1`**: one contract, methods `capabilities` and `describe`, outputs `caption`, `tags` (open vocabulary, with confidence) and `text` (OCR or transcript), each requested explicitly. No caller-label scoring and no safety flags: those are classification, done by calling the classification contract (a resource may implement both) (§2).
3. **`embedding/v1`**: methods `capabilities` and `embed`, batched, text and/or image inputs, one **vector space** per resource identified by an opaque `space` string. Vectors are float32 little-endian byte strings (`x-type: "bytes"`, base64url on today's JSON transport), never number arrays (§3).
4. **Fragments.** A `media-description/v1` fragment shaped like classification's (per-kind `image`, `audio`, `video` plus `fallback`, each with its own detail field, same three levels and tag table by reference). An `embedding/v1` fragment with **one** `embedder` field, `exclusive`, no fallback and no failover, because vectors from different spaces must never be mixed (§1.3).
5. **Shared item envelope.** Kinds, media types, inline/URL forms, the presigned-URL fetch rules, detail levels and tags are defined once (today in item-classification §2–§5) and referenced by all three contracts. Factor them into a shared section when the classification redesign settles (§6.1).
6. **3sln.me built-ins (paid only).** A built-in image describer and a built-in text embedder on 3sln.me's Workers AI account, highly rate-limited. Audio, video and image embeddings are not offered by the built-ins in v1. Owners who want more or other models expose Workers AI models from their own Cloudflare account through the console app, as adapter resources that appear beside the built-ins in the same fields (§4).
7. **One AI allowance per plan.** Classify, describe and embed draw on one monthly micro-USD pool per plan (proposed Paid 40,000, Plus 500,000, Ultra 5,000,000 µUSD a month), with per-service per-minute caps and a per-app share. Sized to hold the 50% margin floor beside typical infrastructure, payment fee and the signaling `data` worst case. **Finding:** the classifier allowances now on disk (`CLASSIFIER_PLAN_LIMITS`) alone put Paid at 12.5% and Plus at 43.7% margin before relay (§4.4).
8. **Vectors live with the app** (its storage resource or backend), under the same access and deletion rules as the source content. 3sln.me offers no vector search resource in this phase (§3.7).

## 1. Separation

### 1.1 Why three contracts

| | Item classification | Media description | Embedding |
| --- | --- | --- | --- |
| Question answered | "How well does this item match each of *my* categories?" | "What is in this media, in words?" | "Where is this content in a similarity space?" |
| Input | Any item kind; caller labels required | Media (image, audio, video); no labels | Text and/or image; batches |
| Output | One score in [0, 1] per caller label | Caption, open tags with confidence, extracted text | Fixed-length float vectors |
| Who reads the output | Owner-controlled rules (spam, routing) | People (alt text, captions) and lexical indexes | Machines only (nearest-neighbour search) |
| Typical consumer | Mail and messaging intake (Parlay) | Gallery, notes, accessibility | Semantic search in any app |
| Path | Synchronous on intake; "unscored" blocks or delays | Background, after upload | Background for documents; interactive for queries |
| Cost profile | Small text, few hundred tokens | Vision or audio model, the most expensive per call | Cheap per call, many calls, batched |
| Model change | Recalibrate thresholds | Old captions remain valid text | Old vectors become useless; re-embed |
| Failover across resources | Allowed only on proven no-effect (IC-5) | Allowed, same rule | **Never**: a different resource is usually a different space |

One contract with optional outputs would force every implementation to carry all three validation and disclosure regimes, every grant to cover all three, and every capabilities answer to describe three different things. Separate contracts let an owner grant a gallery app description and embedding without letting it run classification at the owner's cost, and let a classifier vendor implement one method well.

A single upstream model can still back several contracts: a resource descriptor may list more than one contract, and the owner assigns the same resource to fields in different fragments.

### 1.2 Media description: one contract or two

Options considered:

| Option | Verdict |
| --- | --- |
| A. Caption and tags only; labels go to classification | **Recommend**, plus optional extracted `text` |
| B. Caption, tags and optional caller-label scores | Duplicates classification. Two ways to score images means two calibration paths, and an image classifier field that the owner set could be bypassed by a describer the owner chose for a different purpose |
| C. Two contracts (captioning; tagging) | Splits one model call into two charges and two fetches; the outputs are produced together |

So: one contract, the caller asks for any subset of `caption`, `tags`, `text`. Safety flags are also excluded, because a provider-fixed safety taxonomy is exactly what IC-1 removed from classification; an app that wants "explicit", "violent" or "medical" asks its image classifier with its own labels.

### 1.3 Identity and fragments

| What | Identifier (placeholder authority) |
| --- | --- |
| Contract | `https://spec.bindle.example/contracts/media-description/v1` |
| Fragment | `https://spec.bindle.example/fragments/media-description/v1` |
| Contract | `https://spec.bindle.example/contracts/embedding/v1` |
| Fragment | `https://spec.bindle.example/fragments/embedding/v1` |

Both are Bindle-owned generic contracts, additively versioned under [artefacts §6](../spec/artefacts.md), shared by all apps (the IC-4 pattern: apps use their own grants on the shared fragment, never an app-published one).

**Media-description fragment fields:**

| Field | Type | Attributes |
| --- | --- | --- |
| `image`, `audio`, `video` | resource | 0–1, contract `media-description/v1`, `selection: exclusive`, consumers `application`, `announce: true` |
| `fallback` | resource | as above; serves kinds with no field filled and failover on `unsupported_item` |
| `imageDetail`, `audioDetail`, `videoDetail`, `fallbackDetail` | enum `minimal`, `standard`, `full` | 0–1; unset means `minimal` |

Own detail fields rather than reusing classification's: the describer for images may be a different party from the image classifier, and the owner's willingness to share depends on the party (the reason behind IC-6). The level vocabulary and tag table are reused by reference, so owners see the same three words everywhere. `document` is not a field in v1 (describing a document is summarisation, a different product); the kind vocabulary still contains it, so a later version can add the field.

**Embedding fragment fields:**

| Field | Type | Attributes |
| --- | --- | --- |
| `embedder` | resource | 0–1, contract `embedding/v1`, `selection: exclusive`, consumers `application`, `announce: true` |

No per-modality fields: a text query can only find images if both were embedded in the same space, so text and image embedding must come from one resource. No fallback: a fallback would silently produce vectors in another space. No detail field: an embedder receives only the content to embed, never tags (§3.2), and the fragment's description says so.

## 2. Media description contract

### 2.1 Methods

| Method | Effect | Notes |
| --- | --- | --- |
| `capabilities` | `read` | Exactly `{}`. Not charged, carries no item |
| `describe` | `write` | Discloses the item and may cost the owner (the IC-3 reasoning) |

### 2.2 `describe` arguments

`{detail, item, tags?, want, language?, maxTags?}`. Unknown members are refused.

| Member | Rule |
| --- | --- |
| `detail`, `item`, `tags` | Exactly as item classification §2–§3 and §5 (kinds, media types, `size`, inline `data` at most 262,144 bytes, presigned `url` at most 104,857,600 bytes, tag members allowed per level). Validated completely before any effect |
| `want` | 1–3 distinct values of `caption`, `tags`, `text`. `text` means visible text (OCR) for images, a transcript for audio and video |
| `language` | Optional BCP 47 tag (≤35 characters): the language the caller wants the caption and tags in. Not a statement about the item (that is the `language` tag, which needs `standard`) |
| `maxTags` | Optional integer 1–64, default 16 |

### 2.3 `capabilities` result

`{kinds, outputs, languages?, maxTags, model?}`, open:

- `kinds`: as classification §4.2 (`kind`, `mediaTypes`, `inputs`, `maxBytes`), plus for `audio` and `video` an optional `maxDurationMs`.
- `outputs`: per kind, the subset of `caption`, `tags`, `text` it can produce.
- `languages`: output languages it can honour; absent means it answers in one language it reports per result.
- `maxTags`: 1–64.
- `model`: optional, informational.

### 2.4 Result

`{model, language, caption?, tags?, text?, coverage?}`:

1. `model` is `{id, version}` as classification §7 rule 2.
2. `language` is the BCP 47 tag the outputs are in.
3. `caption`, when requested and produced: 1–1,000 Unicode code points, one plain paragraph, under the same character rules as classification label descriptions (no controls, no bidirectional controls).
4. `tags`, when requested: 0–`maxTags` objects `{tag, confidence}`, distinct `tag`s, each 1–64 code points, lowercase where the script has case, no controls; `confidence` in [0, 1], independent per tag. Open vocabulary: the describer chooses the words.
5. `text`, when requested: 0–32,768 bytes of UTF-8, the same character rules but line breaks allowed.
6. `coverage`, optional: `{durationMs}` actually analysed for audio and video, so an app can tell a sampled description from a complete one.
7. A requested output may be absent only when the item has none (no visible text, silence). An absent requested output is not an error.

All outputs are **untrusted model output**: a caption can repeat injected text from the image itself. Apps render it as plain text, never as markup, and never feed it into an instruction channel.

### 2.5 Errors, retention, determinism

- **Errors:** the classification table (§6 there) applies with `unsupported_item` as the "cannot describe this" error (unknown kind, media type, input form, size, duration, or a requested output the capabilities do not list for that kind), checked before any effect. `invalid_description` replaces `invalid_classification`. No no-effect code after an effect; `indeterminate` instead. No retry against another model, no forwarding.
- **Selection:** as classification §8.3 with the description fragment's fields. Cross-field failover only on `unsupported_item` or a proven no-effect failure, rebuilding under the next field's detail.
- **Undescribed items:** the classification §8.4 rule restated: an app records "not described" with the reason and surfaces capability gaps to the owner.
- **Retention:** none. A describer stores, logs or forwards nothing beyond producing the result, except to the model it invokes. RPC journals do not retain the result (same-`tx` retry answers `indeterminate`).
- **Determinism:** not promised. The same item may yield different captions, even under one model. The result's `model` pair is what an app stores beside derived data; when `capabilities` later reports a different pair, the app may re-describe at its own pace, but old captions stay valid text.

### 2.6 Detail and third-party disclosure

As classification §8.2. At assignment the provider discloses the processor, location where known, model provenance and who pays (extensions §5.2; for adapter resources, the CR proposed in the [platform spike](platform-and-integrations-spike.md) §4.2). The consent text an app shows says that photos (or recordings) are sent to the describer the owner chose.

## 3. Embedding contract

### 3.1 Vector spaces

A **space** is everything that makes two vectors comparable: model, version, dimensions, pooling, normalisation, input preprocessing and any instruction prefix. Each embedder resource reports exactly one space in v1.

1. `space` is an opaque string, 1–128 characters from `[A-Za-z0-9._:@/+-]`. Two vectors are comparable **only** when their `space` strings are equal.
2. An embedder MUST change `space` whenever any change could make new vectors incomparable with old ones.
3. Embedders SHOULD build `space` from public facts only, in the form `<model.id>@<model.version>/<dimensions>/<pooling>/<norm>`, so the same model on two providers (the 3sln.me built-in and the owner's own Cloudflare account) yields the same string and an owner can switch resources without re-indexing.
4. Because a resource can claim a space it does not produce, an app that sees an unchanged `space` on a **different** resource SHOULD verify with a small fixed probe set (embed a few stored inputs again; require cosine similarity ≥ 0.99 against the stored vectors) before reusing its index.

### 3.2 `embed` arguments

`{purpose, inputs, truncate?}`. Unknown members refused.

| Member | Rule |
| --- | --- |
| `purpose` | `document` or `query`. Asymmetric models embed the two differently; symmetric models ignore it |
| `inputs` | 1–`maxBatch` entries, each `{kind: "text", text}` or `{kind: "image", mediaType, size, data | url}` |
| `inputs[].text` | 1–32,768 bytes of UTF-8, well-formed |
| image inputs | The shared item envelope (inline at most 262,144 bytes, or a presigned URL under classification §5); at most 16 URL inputs per call; total inline bytes per call at most 1,048,576 |
| `truncate` | Optional boolean, default `false`. When `false`, an input over the model's limit is `unsupported_item`; when `true`, the embedder truncates and reports it |

No tags and no `detail`: an embedder receives only content. An app MUST NOT add source, sender or context to embedded text unless that text is itself the content the user asked to index.

### 3.3 `capabilities` result

`{space, model, dimensions, modalities, metric, normalized, maxBatch, text?, image?}`, open:

- `dimensions`: 1–4,096 (the bound `WorkersAIEmbeddingAdapter` already enforces).
- `modalities`: `["text"]`, `["image"]` or both. **Both means a shared text↔image space** (CLIP-style): a text query vector can be compared with image vectors. A resource MUST NOT list both unless that holds.
- `metric`: `cosine`, `dot` or `l2`, the comparison the space is designed for.
- `normalized`: `true` when every vector has L2 norm 1 within 1e-3.
- `maxBatch`: 1–256, and `maxBatch × dimensions` at most 262,144 (one result at most 1 MiB of float32, about 1.4 MB as base64url, inside the 1,500,000-byte RPC bound).
- `text`: `{maxBytes, maxTokens?}`; `image`: `{mediaTypes, inputs, maxBytes}`.

### 3.4 Result and vector encoding

`{space, model, dimensions, vectors, truncated?}`:

1. `space`, `model`, `dimensions` equal the capabilities the call ran under. A consumer discards a result whose `space` differs from the one it expected.
2. `vectors` has exactly one entry per input, in input order. Each is a **byte string of exactly `4 × dimensions` bytes: IEEE 754 binary32 values, little-endian**, schema `x-type: "bytes"` with `minLength = maxLength = 4 × dimensions` checked by the contract code.
3. Every component is finite: a vector containing NaN or an infinity makes the whole result invalid (`invalid_embedding` on the embedder side; discarded on the consumer side).
4. `truncated`, present when `truncate` was `true`: one boolean per input.
5. A batch is all or nothing.

Why bytes and not an array of numbers:

| | float32 LE byte string | Array of numbers |
| --- | --- | --- |
| Size, 768 dims | 3,072 bytes (CBOR); 4,096 as base64url on JSON | about 3.8–5.4 KB in deterministic CBOR (per-element heads, shortest-float rules); about 8–10 KB in JSON |
| Determinism | Exact bytes; fingerprints and caches are stable | Deterministic CBOR's numeric reduction turns `0.0` into the integer `0`, and shortest-float rules re-encode components as float16 where exact. Correct, but every element is a schema case |
| Precision | Exactly what models produce (float32) | JSON decimal round-trips are lossy unless printed to 9 significant digits |
| Use | `new Float32Array(bytes.buffer, offset, n)` after an alignment copy; stored as-is | Must be packed before storage or SIMD use anyway |

The CBOR profile's no-NaN rule does not reach inside a byte string, which is why rule 3 is stated by the contract. Until the CBOR transport lands, the same bytes travel as unpadded base64url, exactly as `item.data` does today (IC-9); there is one abstract type and one bound. Reduced-precision forms (float16, int8, binary) are a later capability, never a silent substitution.

### 3.5 Errors, retention, security

- **Errors:** the classification table, with `unsupported_item` for a modality, media type, input form, size, batch size or over-long input (when `truncate` is `false`) outside capabilities, checked before any effect; `invalid_embedding` for an unusable model answer.
- **No failover.** On any failure the app stops for that operation; it never asks another resource, because the answer would be in another space.
- **Retention:** none, as §2.5. Embedders MUST NOT cache inputs or vectors across calls, even for deduplication, unless the cache is keyed and scoped to the calling app and owner and holds no content (a provider-side vector cache is retention).
- **Vectors are content.** Embedding inversion can recover much of a short text from its vector. Apps store vectors under the same access, export and deletion rules as the source, and never publish them.

### 3.6 Where vectors live

In the app's own storage: its granted `object-storage` resource (for example one packed index object per few thousand vectors, with a manifest naming `space`), or its own backend. Vectors count against the owner's storage quota like any app data; at 768 dimensions a 10,000-photo gallery needs about 30 MB of float32.

### 3.7 Vector search as a resource (future, note only)

3sln.me already operates Vectorize for omni-search. A `vector-index/v1` contract (upsert, query, delete by id, per-owner partition, `space`-bound index) would let apps that cannot hold vectors locally search server-side. It needs deletion guarantees (omni-search lists provider deletion and orphan reconciliation as open gates), stored- and queried-dimension cost rows, and a design for ACL-filtered queries. Not proposed now.

## 4. 3sln.me paid built-ins

### 4.1 Shape

Two built-in resources per paid account, exactly like the built-in classifier ([platform spike](platform-and-integrations-spike.md) §3.8): extensions §5.1 kind 1, listed in the manifest `contracts`, offered as candidates only on paid plans, listed in plan `includes` (`media-description`, `embedding`), gated on the server at dispatch, assigned only by the owner with no preselection or built-in preference. Free gets none (owner direction). On downgrade they become unavailable; values and grants are kept.

### 4.2 Candidate models (all unverified)

Names, availability, limits, licences and prices must be checked against Cloudflare's current Workers AI catalogue before any choice. Candidates by role:

| Role | Candidates | Notes |
| --- | --- | --- |
| Image caption, tags, OCR | `@cf/meta/llama-3.2-11b-vision-instruct`, `@cf/google/gemma-3-12b-it`, `@cf/mistralai/mistral-small-3.1-24b-instruct`, `@cf/llava-hf/llava-1.5-7b-hf`, `@cf/unum/uform-gen2-qwen-500m` | One vision-language call produces caption, tags and visible text together under a fixed instruction with the image as data. Check each model's licence and acceptable-use terms (some Llama models require accepting Meta's licence) |
| Cheap image tags | `@cf/microsoft/resnet-50` | Fixed ImageNet classes: usable only as open `tags`, never as caller-label scores. A possible low-cost path for `want: ["tags"]` |
| Audio transcript (later) | `@cf/openai/whisper-large-v3-turbo`, `@cf/openai/whisper` | Priced per audio minute; not in built-in v1 |
| Text embedding | `@cf/baai/bge-m3` (multilingual), `@cf/google/embeddinggemma-300m`, `@cf/qwen/qwen3-embedding-0.6b`, `@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-small-en-v1.5` (omni-search's model, English only, 384 dims) | Prefer one multilingual model; galleries hold captions in many languages |
| Image embedding (shared space) | none confirmed in the catalogue | Without a CLIP-style model the built-in embedder lists `modalities: ["text"]`; cross-modal search goes through describe then embed the caption (§5) |

Video is not described natively by any candidate; it would mean sampling keyframes (cost multiplied by frames) plus a transcript. Not in built-in v1.

### 4.3 Cost units

Each call is priced before any effect as a micro-USD estimate from validated arguments, a lease is taken for it, and the call is refused (no effect) when the pool or a cap would be exceeded, exactly as the classifier does today (`classifierCostMicroUSD`, lease, `classifier` ledger). Planning estimates, **unverified**:

| Call | Assumed size | Planning estimate | Lease cap |
| --- | --- | --- | --- |
| `describe`, one image | ~2,000 input tokens (image plus instruction), ≤200 output tokens | 250–1,000 µUSD depending on model | 1,500 µUSD |
| `embed`, one text input | ≤512 tokens | 5–35 µUSD | 50 µUSD per input |
| `classify` (for comparison) | today's estimate | `CLASSIFIER_LIMITS.microUSD` 3,000 cap | unchanged |

Output tokens dominate vision-model cost; `maxTags` and the caption bound cap them. Over-length images are refused (`unsupported_item`) or downscaled by the provider before the model call, with downscaling disclosed in capabilities (`maxBytes` stays the input bound).

### 4.4 Allowances and the margin floor

Headroom under the 50% floor, from `scripts/cost-model.mjs` (typical profile, Polar fee, signaling `data` worst case; relay shown separately because it already has its own `todo`):

| Plan | Price/year | Typical infra | Fee | `data` worst case | Headroom, no relay | Relay allowance/year | Headroom with relay |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Paid | $5 | $0.98 | $0.75 | $0.25 | **$0.52** | $0.60 | −$0.08 |
| Plus | $35 | $7.62 | $2.25 | $0.25 | **$7.38** | $6.00 | $1.38 |
| Ultra | $250 | $43.26 | $13.00 | $0.25 | **$68.49** | $60.00 | $8.49 |

**Finding.** The classifier allowances on disk (`packages/runtime/account/classifier.mjs` `CLASSIFIER_PLAN_LIMITS`: 200,000 / 800,000 / 4,000,000 µUSD a month) cost up to $2.40, $9.60 and $48 a year. On their own, before relay, that gives Paid **12.5%** and Plus **43.7%** margin (Ultra 58.2%). Adding separate description and embedding allowances on top would break the floor further. This belongs to the concurrent classifier work, but it decides this design.

**Recommendation: one AI allowance per plan** (plan `includes` item `ai-allowance`, in µUSD a month) that `classify`, `describe` and `embed` all draw from:

| Plan | Pool/month | Pool/year | Margin, no relay | Margin with full relay too | Illustration |
| --- | ---: | ---: | ---: | ---: | --- |
| Free | none | — | — | — | — |
| Paid | 40,000 µUSD | $0.48 | 50.9% | 38.9% | ~40–160 image descriptions, or ~1,000+ text embeddings |
| Plus | 500,000 µUSD | $6.00 | 53.9% | 36.8% | ~500–2,000 images |
| Ultra | 5,000,000 µUSD | $60.00 | 53.4% | 29.4% | ~5,000–20,000 images |

- **Per-service caps** as abuse guards inside the pool, per account per minute and per day (starting points: `describe` 2 / 6 / 20 per minute; `embed` inputs 60 / 200 / 600 per minute; `classify` as today's minute caps).
- **Per-app share:** one app may use at most 50% of the monthly pool by default (the classifier's per-app ratio today), so a backfilling gallery cannot starve mail classification. Owner-adjustable per app later.
- **Combined worst case:** with the full relay allowance also spent, every plan is under the floor. This joins the existing relay `todo` (relay byte-cap gate) rather than hiding it; the alternative is one metered pool shared by relay and AI (question 6).
- **Service-wide backstop:** the global ledger (today `CLASSIFIER_GLOBAL_*`) becomes an `ai` ledger sized for this table, with a daily and monthly µUSD ceiling; it is a work-admission bound, not an invoice cap.
- **Proposed cost-model rows:** an `aiEconomics()` function reading the pool from plan data, and `tests/cost-model-margins.test.mjs` asserting the floor with typical infra, fee, `data` and the whole pool spent; the relay-plus-AI case as a `todo` next to the existing one.
- **Abuse guards beyond money:** argument validation before any effect; presigned-URL fetch rules (no redirects, public addresses, byte and time bounds); no retries against another model; the dedupe fingerprint keyed per app with no content (fixing classifier review L3 here); refusals before any effect return no-effect codes; refusals after a lease return `indeterminate` (classifier review M2).

### 4.5 Coexistence with the owner's own Cloudflare models

Through the Cloudflare console app ([platform spike](platform-and-integrations-spike.md) §3.3) the owner exposes a Workers AI model from their own account as an adapter resource implementing `media-description/v1` or `embedding/v1`. It is billed to the owner's Cloudflare account, bounded by owner-set caps, and appears in the same fragment fields as the built-in. The owner chooses per field:

- built-in describer for images, own Cloudflare model as `fallback` (or the reverse for bulk backfills, which the small built-in pool cannot carry);
- built-in embedder or own embedder for `embedder`. When both run the same model with the same parameters, §3.1 rule 3 gives them the same `space`, and switching avoids a re-index after the probe check.

The console's model picker shows, for each model, which contracts and kinds it can serve and its `space`, which feeds both contracts' capabilities. Built-ins and adapter resources follow the same detail rules; adapter resources always count as third-party processing for the owner's detail choice.

## 5. Consumer: semantic gallery search

A gallery app (`gallery.example`) requests an `object-storage` field, the media-description fragment (`image`, `fallback` and their detail fields) and the embedding fragment (`embedder`).

1. **Upload.** The photo goes to the owner's storage resource. The app records the item as `pending description`.
2. **Describe.** The app presigns a read URL (≤5 minutes, opaque key), reads the describer's capabilities (cached up to one hour), and calls `describe` with `want: ["caption", "tags", "text"]`, the owner's language as `language`, and tags only up to the field's detail. It stores `{objectKey, objectVersion, caption, tags, text, describer: {resource, model}}`. On `unsupported_item` it tries `fallback`; on a gap it tells the owner which kind is not covered.
3. **Embed.** The app embeds the caption, tags and extracted text as one `document` input (batched with other photos). If the embedder's `modalities` include `image`, it may also embed the photo itself. It stores packed vectors with their `space` in its storage.
4. **Index.** Lexical index over captions, tags and text (cheap, local, no AI cost); vector index per `space`.
5. **Query.** The user types "dog on a beach at sunset". The app embeds it with `purpose: "query"`, checks `space` against the index, ranks by the space's `metric`, merges with lexical hits, and shows results. Repeated queries use a local cache of query vectors. When the pool is exhausted (`rate_limited`) or the embedder is unavailable, the app falls back to lexical search and says so.
6. **Backlog and budget.** Undescribed and unembedded items are visible ("312 photos not indexed yet"). Backfills run in the background within the app's pool share; the app suggests an owner-run model for bulk work rather than retrying.
7. **Model change.** A new describer `model` leaves captions valid; the app may re-describe opportunistically. A new embedder `space` makes the vector index stale: the app stops semantic queries against it (a query vector from the new space cannot be compared with old vectors), serves lexical results, and re-embeds stored captions, which is cheap and needs no image fetch. Image vectors need the images again. This asymmetry is why caption-then-embed is the recommended default.
8. **Deletion.** Deleting a photo deletes its caption, tags, text and vectors. Exports include them.
9. **Privacy disclosures.** The app's consent copy says photos are sent to the describer and embedder the owner picks, and that vectors are derived data stored with the photos. The provider's assignment screen shows the processor (3sln.me with Cloudflare as processor for built-ins; the owner's Cloudflare account for adapters), location where known, model and who pays.

## 6. Spec impact, phases and questions

### 6.1 Spec impact

| Document | Change | Kind |
| --- | --- | --- |
| [item classification](../spec/extensions/item-classification.md) §2–§5 | Factor the item envelope (kinds, media types, inline and URL forms, presigned-URL rules, detail levels, tags) into a shared section, e.g. `docs/spec/extensions/items.md`, referenced by all three contracts. Coordinate with the concurrent redesign; until then the new contracts reference classification §2–§5 | Bindle, editorial |
| New `docs/spec/extensions/media-description.md`, `docs/artefacts/media-description-v1.json`, fragment | §1.3, §2 | Bindle draft |
| New `docs/spec/extensions/embedding.md`, `docs/artefacts/embedding-v1.json`, fragment | §1.3, §3; uses `x-type: "bytes"` from the CBOR spike, base64url on JSON meanwhile | Bindle draft |
| [extensions](../spec/extensions.md) §5.2–§5.3 | The adapter-resource disclosure CR already proposed in the platform spike covers these resources too | Existing CR |
| [omni-search](../3sln/services/omni-search.md) | Scope note: internal pipeline, unaffected | 3sln.me |
| [unit economics](unit-economics.md), `scripts/cost-model.mjs` | `aiEconomics()` rows and margin test (§4.4) | 3sln.me |
| [release gates](../3sln/release-gates.md) | New row "AI services": verified prices and model licences, provider billing reconciliation, pool and cap enforcement tests, retention verification (no content in logs, journals or caches), vision-model prompt-injection review | 3sln.me |
| Platform plan data | `includes`: `media-description`, `embedding`, `ai-allowance` | 3sln.me |

### 6.2 Phases (flags off throughout)

1. **Owner answers; price and catalogue check** against Cloudflare's primary documentation.
2. **Specs and artefacts (drafts)**, SDK validation for both contracts (including vector byte-length and finiteness checks), SDK test doubles, conformance vectors. Engine-level tests with edge cases and seeded chaos (oversized batches, mixed spaces, NaN components, expired URLs, mid-call entitlement loss).
3. **Shared AI allowance**: move the classifier onto the `ai` pool and ledger; cost-model rows and margin test.
4. **Built-in text embedder** (cheapest, simplest).
5. **Built-in image describer.**
6. **Cloudflare console adapters** for both contracts.
7. **Reference gallery demo** under `.example`, loopback-only like `dev:demo`, to exercise §5.
8. Later: audio and video description, image embeddings when a shared-space model is available, `vector-index/v1`.

### 6.3 Open owner questions (recommended answers)

1. **One description contract with caption, tags and extracted text, and no caller-label scoring or safety flags?** *Recommend yes* (§1.2); label scoring and safety stay in classification.
2. **Description fragment per kind (`image`, `audio`, `video`, `fallback`) with its own detail fields, same three levels?** *Recommend yes*, mirroring classification so owners learn one model.
3. **Embedding fragment with a single `embedder` field, exclusive, no fallback and no failover?** *Recommend yes*; mixing spaces silently corrupts search.
4. **Vectors as float32 little-endian byte strings (base64url on JSON until CBOR)?** *Recommend yes*; reduced-precision forms later as a capability.
5. **One AI allowance per plan shared by classify, describe and embed, with per-service caps and a 50% per-app share?** *Recommend yes*, replacing the separate classifier allowances, which on their own break the floor for Paid and Plus.
6. **Must the 50% floor hold with relay and AI allowances exhausted at once?** *Recommend:* not for local development; yes before either is enabled in production. Track it as the existing relay `todo` now, and decide at release between smaller pools, a single metered pool shared by relay and AI, or price changes.
7. **Pool sizes Paid 40,000 / Plus 500,000 / Ultra 5,000,000 µUSD a month?** *Recommend yes, provisional*, revisited after price verification. Paid's pool is deliberately tiny; Paid users wanting real backfills use their own Cloudflare model.
8. **Built-in scope v1: image description and text embedding only?** *Recommend yes*; audio, video and image embeddings later.
9. **Provider-independent `space` strings so built-in and owner-run copies of one model share a space (with an app-side probe check)?** *Recommend yes.*
10. **Free accounts: no built-in describer or embedder, even though embeddings are cheap?** *Recommend yes*, per the owner direction; Free owners can still assign third-party integrations.
11. **3sln.me vector search resource?** *Recommend defer* (§3.7).
12. **Should omni-search move onto the embedding contract?** *Recommend not now*; it is an internal service with its own budgets and model (bge-small, 384 dimensions), and its open deletion gates come first.
13. **Factor the shared item envelope out of classification now or after its redesign lands?** *Recommend after*, in the same change that adds the two new contracts, to avoid editing a spec under concurrent revision.
