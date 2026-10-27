# Artefact references: additive versions, integrity and caching

Provisional design, 2026-10-21; implementation status updated 2026-10-22. ART-1–ART-6 have local implementations; the slice table records the remaining adapter handoff and verification. Reviewer ___ Date ___ Outcome ___. Normative draft: [spec/artefacts.md](../spec/artefacts.md). Every decision below is **provisional and unsigned**. On 2026-10-22 the user accepted all four §13 recommendations; they are now ART-D12 to ART-D15. Those choices are the user's; the design as a whole still awaits review sign-off.

User direction (verbatim): "Another things I think we should make sure of is that our references between public artefacts must have integrity hashes; but there's a catch. These files can change, but addatively. So we need a way for references to specify version + hash for that particular version; then validators to extract that version from the public artefact, check the hash and confirm validity. Providers that depend on public artefacts should cache the versions they depend on so if one disappears or is inaccessible temporarily nothing breaks."

## 0. Decisions in one screen

| ID | Decision | Section |
| --- | --- | --- |
| ART-D1 | **Major version in the URL, additive minor versions inside the document.** A breaking change is still a new URL (a new line). | §2 |
| ART-D2 | **Envelope with an append-only log of full snapshots.** `versions[i]` = `{version, prev, body}`; no deltas, no annotations. Old bodies may be elided to `{version, prev}` and served per version (R1-H5). | §3 |
| ART-D3 | **Hash-chained version records**, digest = SHA-256 over RFC 8785 JCS of `{t, id, kind, version, prev, body}`, encoded `sha256-<base64url>` as today. | §4 |
| ART-D4 | **Strict I-JSON parse, safe integers only** (R1-H6). No Unicode normalization. Hash the value you validate; refuse, never encode, out-of-profile values. | §4.2 |
| ART-D5 | **Structured references only**: the container's URL member, plus `version`, plus `digest`. No compact string syntax. | §5 |
| ART-D6 | **Additive = embedding at declared growth points + reader safety** ("implementers may accept more, old readers never receive more than they admitted"). Text is frozen. | §6 |
| ART-D7 | **Per-provider head per line, per-pin versions.** Heads advance only on demand; stored records always win over the network. | §7 |
| ART-D8 | **Content-addressed provider store, retained while referenced.** Mirrors serve records by digest, own store only. | §8 |
| ART-D9 | **Notices are sticky and bound to the chain. Retraction closes the line from version N on**, never breaks a digest and never silently revokes. Signatures are optional provenance. | §9 |
| ART-D10 | **Grants pin (URL, version, digest)**; upgrade without asking only when nothing widens; an existing method whose request schema changed counts as widening. | §10 |
| ART-D11 | **Legacy artefacts stay valid** as single-version lines; migrated version 1 bodies equal the legacy document, so legacy digests keep matching. | §11 |
| ART-D12 | **Envelope at the canonical URL eventually**, version records at `<id>/versions/<n>`. During the transition the legacy body stays at the URL and the envelope is served at `<id>/envelope` until dependents declare `artefact-versions.v1`. Decided by the user, 2026-10-22 (former Q1). | §3, §11 |
| ART-D13 | **An unsigned retraction only blocks new pins and notifies.** Suspending existing grants needs a signature by a key pinned for the line. Decided by the user, 2026-10-22 (former Q2). | §9 |
| ART-D14 | **New lines use open result objects**; existing v1/v2 bodies stay frozen as version 1. Decided by the user, 2026-10-22 (former Q3). | §6.2 |
| ART-D15 | **No garbage collection of version records** in the first implementation. Decided by the user, 2026-10-22 (former Q4). | §8 |

## 1. What exists today (grounding)

**Artefacts.** `docs/artefacts/**` holds bare bodies: JSON Schema contracts (`$id`, `x-methods`: preferences v1/v2, profile, object storage, app messages, resource descriptor, resource scoping, event bus v1, automation), fragments (`id`, `fields`: app-message preferences), slots (`slots/item-classifier-v1.json`), a submission schema (conversation v1) and a manifest profile (`docs/architecture/artefacts/components-profile-v1.json`). Versioning is by URL suffix only (`…/v1`, `…/v2`). Descriptions say "publish changes under a new URL". The catalog is [packages/core/public-contracts.mjs](../../packages/core/public-contracts.mjs); `scripts/build-docs.mjs` copies source bytes to the canonical paths.

**Rules.** Protocol §3: a fragment URL is an immutable schema version; providers pin the canonical JSON SHA-256 at approval. AMD-C2 lets requests carry `digest`. Extensions §4.3 pins a slot manifest "once per URL for the whole provider". Events §2 and §5 bind bus grants to the pinned manifest digest. Integrations §2.3 stages manifest changes for owner review. Security says to "freeze immutable revision URL plus content digest".

**Code.**
- `canonical()` in [packages/core/primitives.mjs](../../packages/core/primitives.mjs): keys sorted by UTF-16 code unit, `JSON.stringify` scalars. For values from `JSON.parse` that are valid I-JSON this is exactly RFC 8785 JCS (same key order, same string escaping, same ECMAScript number serialization). It does not reject duplicate keys (the parse already dropped them), lone surrogates or non-canonical number text.
- `pinSchema` in [packages/federation/schema.mjs](../../packages/federation/schema.mjs) stores `federation/schema/<url>` → `{schema, digest}` and fails `schema_changed` on any difference. `pinSlotManifest` ([extensions.mjs](../../packages/federation/extensions.mjs)) and `pinBusManifest` ([event-buses.mjs](../../packages/federation/event-buses.mjs)) reuse the same key space and add `sha256-` prefixes inconsistently (stored without, compared with). [packages/events/store.mjs](../../packages/events/store.mjs) copies `digest` into bus records.
- **There is no network fetch of artefacts.** `schemaFetcher` in [packages/runtime/federation.mjs](../../packages/runtime/federation.mjs) and [incremental-authorization.mjs](../../packages/runtime/incremental-authorization.mjs) serves only a configured map (`federationSchemas(config)`), failing `untrusted_schema_host` otherwise. Contract method effects come from a reviewed in-code catalogue (`contractPins` in [introspection.mjs](../../packages/federation/introspection.mjs)), not from fetched contracts.
- Client metadata ([client-metadata.mjs](../../packages/federation/client-metadata.mjs)) has a real bounded fetch with an LRU cache, but it is a mutable declaration, not an artefact, and stays out of scope.

So the integrity primitive exists (whole-document digest, pin-on-first-use, reject change), but the model forbids any change, the cache is the pin record itself, and nothing fetches yet. The user's requirement changes the model from **immutable** to **append-only**.

**Organizations.** [organizations-design.md](organizations-design.md) §7.2 anticipates public, digest-pinned documents (access profiles; bilateral relationship attestations) that reference fragments. The "relations"/"bond" document is being drafted by another agent. This design gives it a reference shape, `{"fragment": url, "version": n, "digest": "sha256-…"}`, and a kind, `document` (no growth), for signed statements that must never change.

## 2. Lines and versions (ART-D1)

The URL keeps meaning "this line of compatible meaning". `preferences/v1` and `preferences/v2` stay separate lines because v2 changed the shape of resource values. Inside a line, versions 1, 2, 3 … each add something.

This keeps everything that currently binds to a URL working: exact-URL matching (extensions §9.2), suppression matching (incremental authorization §9.1, which matches the URL, so additive versions cannot be used to reset a suppression), registry identifiers, owner values per fragment.

Rejected: versioned URLs per minor (`…/v1.3`) plus an index document. That is the current model with more URLs: every additive change would still be a new identifier, owner values and suppressions would fragment, and the "extract version N from the artefact" step the user asked for would become "fetch another URL".

## 3. The document format (ART-D2)

The URL serves an envelope (spec §2) whose `versions` array holds **complete bodies**. Three options were weighed:

| Option | Extraction | Additivity check | Size | Interop risk |
| --- | --- | --- | --- | --- |
| **A. Full snapshots per version (chosen)** | Index into an array | Tree embedding between two bodies, only when a head advances | Grows linearly; old bodies elided past 256 KiB, up to 1,024 versions (R1-H5) | Minimal: every implementation hashes the same stored body |
| B. Deltas from the previous version (JSON Patch / merge patch) | Replay *N* patches | Must still be checked semantically: an `add` to `required` or a `not` is syntactically additive but narrows acceptance | Smallest | High: patch semantics (array indices, `-`, escaping, merge-patch `null`) differ across libraries, and any difference changes the extracted body and so the digest |
| C. One body, additions annotated with the version that introduced them; strip to extract | Strip annotations > *N* | Structural, but needs a side table of JSON Pointers for enum strings and array elements | Small | High: the stripping algorithm must be bit-identical everywhere, and pointer escaping is a classic differential |

The deciding factor is that **the digest must match across independent implementations**. With A, extraction involves no algorithm at all, so the only shared algorithm is JCS, which already has an RFC and test vectors. B and C both put a second, home-grown algorithm on the digest path. A's cost is size, and artefacts are small (the largest today, `automation-v1.json`, is 12 KiB; 20 versions of it fit the 256 KiB bound). The additivity check in A is a pure function of two bodies, run once per new version per provider, not per request.

Why a log at all, rather than only the latest body plus the digests of earlier versions? Because a provider that meets a reference to version 3 for the first time, while the line is at version 5, must be able to obtain version 3's exact bytes from the artefact itself. That is the user's "extract that version from the public artefact".

Entries have exactly `{version, prev, body}`. Changelog prose was left out deliberately: anything in an entry is hashed and frozen, and unhashed prose next to hashed content invites display of unverified text. Changelogs live in documentation.

**Envelope at the canonical URL.** The canonical identifier serves the envelope, not a bare body. The registry review's criterion ("canonical identifiers return the actual machine definitions") is met, because the envelope *is* the definition. Serving the latest bare body at the URL would reintroduce a mutable document at the identifier, which is the problem being solved. Version records are served at `<id>/versions/<n>` (spec §2). As a convenience, 3sln.me can also serve `<id>/<n>.json` with body *n*. That is non-authoritative and is verified by digest like any other copy.

**Transition (ART-D12, decided by the user, 2026-10-22).** The envelope reaches the canonical URL only once dependents can read it. Until then the legacy body stays at the URL and the envelope is at `<id>/envelope` (spec §11; R1-M6). 3sln.me's own pin code refetches on every pin, so flipping the URL first would break its own legacy pins.

## 4. Canonical hashing (ART-D3, ART-D4)

### 4.1 What is hashed

The version record `{"t":"bindle.artefact-version.v1","id","kind","version","prev","body"}`:

- `prev` chains versions, so a pin on version *N* anchors 1 … *N*−1. A provider that first meets a line at version 5 can then verify version 3 from the same document with no further references. It also gives the user's "verifiable chain from the new version to the old": verifying the chain from *M* back to *N* proves that *N* is an ancestor of *M*, and the embedding check proves each step was additive.
- `id` and `kind` stop cross-URL replay and stop a publisher from changing which growth rules apply.
- `t` is JSON-level domain separation. It keeps version digests disjoint from legacy body digests and every other `canonical()` digest in the codebase, with no byte concatenation to get wrong.

The record is built by the validator, not stored, so the envelope stays readable.

### 4.2 Canonicalization and the parsing differentials it closes

JCS (RFC 8785) over UTF-8. JCS assumes I-JSON input; the spec makes that a validator obligation and adds one rule:

| Attack or differential | Closed by |
| --- | --- |
| **Duplicate keys**: `{"effect":"read","effect":"destructive"}`. `JSON.parse` keeps the last value, some parsers keep the first, and a hash over one parse would validate the other | Strict parser rejects duplicates at any depth, comparing names after unescaping (`"a"` and `"a"` collide) |
| **Number formatting**: `1.0`, `1e2`, `100`, `-0` all hash identically under JCS, but `1.0` is a float to some languages and an integer to JSON Schema, and `9007199254740993` silently becomes `…992` in JavaScript | Safe integers in plain decimal only (R1-H6): no fractions, exponents or `-0`. Two byte-different documents can then differ only in whitespace and string escapes |
| **Lone surrogates**: `JSON.stringify` escapes them, JCS implementations in other languages reject or replace them | Rejected |
| **Unicode normalization**: "café" in NFC versus NFD | No normalization anywhere. They hash differently, and changing one into the other in a later version is a modification (rejected by embedding). Identifiers that matter for matching (field, method, type names) are already ASCII-pattern-restricted by their own rules |
| **Key order for astral characters**: code point order and UTF-16 order differ above U+FFFF | JCS mandates UTF-16 order, which is what `Array.prototype.sort` already does |
| **BOM, invalid UTF-8, overlong encodings** | Rejected |
| **"Collision" via non-canonical JSON**: two different byte strings with one digest | By design they denote the same value, and validators interpret only the parsed value they hashed. With the rules above, the only remaining freedom is whitespace and escaping, which change no value under any conforming parser |

Existing `canonical()` stays the serializer for legacy digests only. Version records use a refusing serializer and a strict tokenizer (`packages/core/strict-json.mjs`), generalized from the existing `strictJSON`/`jcs` pair in `packages/messaging-protocol/encoding.mjs` (which already refuses duplicates, lone surrogates, BOM, fractions and unsafe integers and defines `__proto__` as an own member) with negative integers admitted (R1-M7).

### 4.3 Digest format and agility

`sha256-` plus 43 characters of unpadded base64url, the format already used by AMD-C2, extension declarations and `validateExtensionDigest`. Not SRI's padded standard base64: one Bindle format is better than matching a web convention nobody here consumes.

Agility is per envelope version: `bindle_artefact: 2` could define `sha512-` for both references and `prev`. References carry exactly one digest. Multiple digests per reference invite "verify whichever is easiest" downgrade bugs, and SHA-256 has no foreseeable need for replacement within this draft's life.

## 5. Reference syntax (ART-D5)

A reference is three members of one JSON object: the container's existing URL member (`fragment`, `slot`, `manifest`, `contract`; `artefact` in new document types), `version` and `digest`. For example, in a fragment request:

```json
{"fragment": "https://cal.example/preferences/calendars/v1", "version": 2, "digest": "sha256-…", "purpose": "…", "fields": ["calendar"]}
```

Alternatives considered:

- `uri#v=3` plus a separate digest: URL fragments already mean JSON Pointer to JSON Schema tooling, and they are stripped or normalized by URL libraries inconsistently. Rejected.
- A single string such as `url@3#sha256-…`: one more grammar to parse, one more differential. Rejected as normative; display only.
- Version ranges (`>=3`): ranges defeat pinning. Compatibility is already guaranteed by additivity, so a holder of version 5 can serve anyone asking for 3.

**Latest versus pinned.** A request may still name only a URL; the provider resolves the current version, pins it, and from then on the pin is the reference. Nothing authority-bearing ever reads "whatever the URL serves now". Bodies keep naming other lines by URL only (for example a fragment field's `contracts`); the grant that uses them pins the contract versions (spec §10).

## 6. The additive-change model (ART-D6)

### 6.1 Principle

Two halves:

1. **Embedding**: every old value is still there, unchanged, at the same place; new things appear only at declared growth points; arrays only append. This is mechanical, needs no understanding of the kind, and catches removal, reordering and edits.
2. **Reader safety**: implementers may come to *accept* more (new methods, new optional request members, new optional preference fields); readers holding an old version must never *receive* anything their version did not admit.

Embedding alone is not enough. Appending to `required` or adding `additionalProperties: false` is a pure addition at the JSON level but narrows acceptance. Hence growth points are a closed per-kind whitelist (spec §6.3), and everything else is frozen.

### 6.2 Per kind, and the enum question

| Kind | May grow | Frozen (examples) | Reason |
| --- | --- | --- | --- |
| Fragment | New **optional** fields; enum values of fields declared `extensible` | Titles, descriptions, existing fields, cardinality, `contracts` | A new optional field is unconfigured for everyone and outside every existing grant's field set. A new required field would make existing configurations invalid |
| Slot manifest | New optional `options` fields | The single resource field, contracts, selection, failover, consumers | Occupancy and selection are policy that consumers depend on (extensions §3) |
| Bus manifest | Option fields; `types` if declared extensible; payload properties where the payload object is open | Publishers, readers, history, retention, categories | Who may publish or read is authority |
| RPC contract | New methods (with schema branch and `$defs`); new optional arguments of existing methods; `summary` translations; result properties where the result object is open | `required`, bounds, effects, introspection, existing results that are closed | New methods need their own grants. New arguments can widen what an already-granted method does (for example `put` gaining an unconditional overwrite), so they are allowed only because implementers validate at the grant's pinned version and an upgrade that reaches them is a consent delta (§10) |
| Submission schema, manifest profile | New optional request properties | Everything else | The receiver is the implementer |
| `document` | Nothing | Everything | Signed statements, bonds, attestations |

**Is a new enum value safe for old consumers?** On the *request* side (a value an implementer receives), yes, because an old caller never sends it. On the *receive* side (preference values, results, bus records), only if every consumer was told from the start to tolerate unknown values. So the spec adds `extensible: true` for fragment enum fields (AMD-R6) and `types_extensible` for buses (AMD-R5). Appending to a non-extensible enum is a publication fault. The publisher must declare extensibility when the enum first appears.

**Consequence for today's contracts.** Every current result schema has `additionalProperties: false`, so none can grow results. That is the honest outcome: an old client that validates strictly would reject new members. **ART-D14 (decided by the user, 2026-10-22):** new lines open their result objects (`additionalProperties` absent or `true`) and tell readers to ignore unknown members. 3sln.me publishes every new line that way. Existing v1/v2 bodies are not touched; they become frozen version 1s with closed results, and growing their results needs a new line.

Titles and descriptions are frozen because they are what owners consent to. A typo fix is a new line. This is strict, but anything looser needs a judgement about "meaning", and validators cannot make it.

### 6.3 Validator cost

The embedding check visits each node of the old body once; growth-point matching is a pattern lookup per added member. It runs once per new version per provider, when a head advances, bounded by 64 KiB per body; a provider advancing across many versions fetches elided bodies once each. Publisher tooling runs the same function in CI.

## 7. Validation (ART-D7)

**Extract and verify** (spec §7.1): strict parse, envelope checks, recompute digests 1 … *N* following `prev`, compare *d_N* to the reference, then validate body *N* with the kind's existing validator (`validateSchema`, `validateSlotManifest`, `validateBusManifest`).

**Heads.** The current "pin once per URL for the whole provider" becomes a provider-wide head per line plus per-pin versions. The head only advances on demand: when a request names a version above it, or when a request names no version. That avoids background rollouts of new versions and keeps the fetch budget tied to user actions.

**Failure policy.** Stored records always win. Without a stored copy, every authority-bearing use fails closed. The user's "nothing breaks" requirement is met by the store, not by leniency. Non-authority display may degrade to "can't be checked right now".

**Rewritten history** covers modified, missing, renumbered or truncated earlier entries, a non-additive step, or a missing sticky notice. The line freezes at the stored head, existing pins continue, and an operator clears the fault only once the publisher serves a consistent copy. This mirrors the current `schema_changed`, minus the outage: today a changed document blocks the line; with the store, existing users never notice.

**Equivocation.** A publisher can serve different histories to different providers. Digest-carrying references between parties expose it when one arrives, but they cannot prevent it, and an unsigned conflicting digest is not evidence (anyone can invent one; R1-H2). Within one relationship, pin-by-digest is enough when the digest travels end to end: the SDK sends `version` and `digest` (spec §5 rule 7) and brokered tokens carry the digest to the implementer (R1-H1). A transparency log or mirror gossip of heads would detect split views between unrelated providers; that is deferred and recorded as a known limit (R1-M1).

## 8. Caching and availability (ART-D8)

| Concern | Design |
| --- | --- |
| Key | Version digest → immutable version record. Plus per line: head, digests 1 … *H*, accepted notices, faults, pinned publisher key thumbprints, `fetchedAt`, negative-cache expiry. |
| Write ordering | The record is stored durably **before** the pin that depends on it commits, in the same transaction where the store allows (Node adapter; the Worker's metadata Durable Object). |
| Retention | While any pin references the version or a later version of the line (the chain anchors earlier ones), including revoked grants kept for audit or export. **ART-D15 (decided by the user, 2026-10-22): the first implementation never deletes version records.** Artefacts are small. If store size ever matters, garbage collection can be added later with a documented grace period (90 days was proposed); that would be a new decision. |
| Freshness | Records never expire. Referenced lines are refreshed at least daily and at most hourly, to learn of notices; refreshes never advance heads (R1-M3). |
| Mirrors | `GET /.well-known/bindle/artefacts/<digest>` serves records from the mirror's own store; it never fetches for a requester (no SSRF, no amplification). The digest makes the mirror untrusted by construction. Fetchers use operator-configured mirrors or the issuer that sent them the reference. Notices only come from the origin, so a mirror cannot hide or forge a retraction, but it can serve a retracted version: mirror-only records create new pins only after an origin notice fetch in the last 24 hours (R1-M2). |
| Fetch limits | The security spec's SSRF boundary, plus: no redirects, no credentials, 256 KiB decompressed, media type check, per-origin and global budgets, 60 s negative cache (in-process cache LRU-bounded at 1,024 ids; the 3sln.me port serves only operator-registered local bytes and charges no fetch budget for them, so junk digests or versions of a registered line starve nothing; a port with real egress reports its own exhaustion as `artefact_budget_exhausted`, which is never persisted as `negativeUntil`; an id outside the operator registry fails `artefact_unregistered` before any budget, negative cache or store write, and the intent router checks the registry before touching the store; wargame F1, 2026-10-23), and fetches triggered only by references, requests or operators. URLs inside bodies, notices (`successor`) and mirror responses never trigger fetches. |
| 3sln.me today | Fetch remains the configured allowlist (`federationSchemas`) until the outbound-fetch production gate (security S4, Workers egress verification) is met. The store and the verification logic do not depend on how the bytes arrived. |

## 9. Lifecycle and governance (ART-D9)

**Who may publish.** Whoever controls the line's URL. That is no change: HTTPS already makes the origin the authority for what the URL means. Domain loss is the real risk. Its damage is bounded because new versions can only add, existing pins are stored, and additions never widen existing grants (§10).

**Deprecation** is a sticky notice and a warning; it changes no behaviour.

**Retraction.** In an additive line, whatever made version *N* harmful is still in every later version. So a retraction says "from *N* on" and closes the line; the fix is a new line, named in `successor`. Honouring a retraction without breaking pins means: refuse new pins at ≥ *N*; keep every stored record and every digest valid; tell affected owners; never silently revoke. **ART-D13 (decided by the user, 2026-10-22): an unsigned retraction only blocks new pins and notifies.** Suspending existing grants requires a valid signature by a key pinned for the line (spec §9.2 makes this a MUST NOT otherwise). That way an expired-domain buyer cannot switch off every dependent provider's grants with one unsigned edit. With a valid signature, suspension remains provider policy, and owners can always resume.

**Signatures.** These are optional detached Ed25519 or ES256 signatures over version or notice digests, with keys at `/.well-known/bindle/artefact-keys` on the line origin. Thumbprints are pinned at first use and rotate under the integrations §2.3 continuity rule. They add provenance for copies obtained from mirrors or caches and survive domain loss. They never substitute for a digest. Digest = "is this the version I depend on"; signature = "did the publisher's key endorse it".

## 10. Consent interplay (ART-D10)

- Grants bind (URL, version, digest) for the fragment, and references for the contracts whose methods they grant.
- Owner values belong to the fragment line, so additive versions never lose configuration. A grant's field set is explicit, so new fields never leak into old grants.
- An implementer validates arguments at the grant's pinned contract version. For brokered resources, the token says which version that is (`bindle.cv`, AMD-R4).
- **Upgrade rule.** An app naming version *M* > pinned *N*:
  - New fields, methods or resources are ordinary incremental-authorization delta items.
  - An already-granted method that gained optional arguments between the pinned and target contract versions is an "updated method" delta item. The app keeps working at the old pin if the owner declines.
  - With no delta items, the pin advances silently and is logged in the owner's access history.

  This is "re-consent only if access widens", with widening defined mechanically and conservatively.
- Suppressions match the URL and are unaffected by version changes. Version churn therefore cannot reset an owner's "don't ask again".
- Consent records store the reference shown, so the record proves which exact text the owner saw.

## 11. Migration

### 11.1 Artefacts

Each existing body becomes version 1 of its line, unchanged, so its legacy digest still designates version 1 (spec §11). Source layout:

- `docs/artefacts/<name>-v<major>.json` stays the version 1 body (frozen bytes).
- Later versions are added as `docs/artefacts/<name>-v<major>/<n>.json`.
- `docs/artefacts/artefacts.lock.json` records `{id, kind, versions: [digest…]}` per line. CI fails if a committed version's digest changes (history rewrite at the source), if a step is not additive, or if a catalog entry lacks a lock entry.
- The build assembles envelopes and emits them at canonical paths; the exact legacy source aliases keep serving the frozen version 1 body.

### 11.2 Code paths that change

| Path | Change |
| --- | --- |
| `packages/core/strict-json.mjs` (new) | Strict tokenizer, parser and refusing JCS (§4.2), generalized from `packages/messaging-protocol/encoding.mjs` without editing it |
| `packages/core/artefacts.mjs` (new) | Envelope validation, record digest, chain verification, embedding plus growth tables, reference parsing, legacy mapping. Pure, shared by server, SDK and build |
| `packages/federation/artefact-store.mjs` (new) | Engine-level store: pin, resolve, advance head, faults, notices, mirrors, through injected `fetch` and `store` ports |
| `packages/federation/schema.mjs`, `extensions.mjs`, `event-buses.mjs` | `pinSchema` / `pinSlotManifest` / `pinBusManifest` delegate to the store; fix the `sha256-` prefix inconsistency in passing |
| `packages/events/store.mjs` | Bus records carry `{manifest, version, digest}` |
| `packages/federation/service.mjs`, `incremental.mjs` | Grants bind versions; upgrade delta; projection and argument validation at the pinned version; preference records keyed by line, with grant matching by line plus version ≤ head instead of `grant.digest === preferences.digest` (R1-H4); `bare()` legacy comparison kept for legacy digests only |
| `packages/federation/introspection.mjs`, `brokered.mjs`, `integrations.mjs`, `packages/consent/reviewed-contracts.mjs` | Contract pins carry version and digest; `bindle.cv` claim with digests; integration snapshot references; CX-1 reviewed copy keyed by version digest (R1-M5) |
| `packages/runtime/federation.mjs`, `incremental-authorization.mjs`, new `packages/runtime/artefacts.mjs` | Replace the inline `schemaFetcher` with the store's allowlist fetch port |
| `packages/core/public-contracts.mjs`, `scripts/build-docs.mjs` | Envelopes, lock file, per-version convenience paths |
| `packages/sdk` | Requests carry `version` and `digest`; `contract_versions` |
| `packages/flags/registry.mjs`, `docs/architecture/feature-flags.md` | Flag row (§11.4) |

### 11.3 Slices (non-overlapping write ownership)

| Slice | Owns | Depends on |
| --- | --- | --- |
| **ART-1** Complete local core implementation and vectors; review unsigned | `packages/core/strict-json.mjs`, `packages/core/artefacts.mjs`, `tests/artefacts/core.test.mjs`, `docs/architecture/artefacts/artefact-envelope.vectors.json` | Spec sign-off on §3–§6 |
| **ART-2** Complete local publication — local build and transition HTTP envelope/record routes implemented 2026-10-22; canonical body unchanged, review unsigned | `docs/artefacts/artefacts.lock.json`, `packages/core/public-contracts.mjs`, `scripts/build-docs.mjs`, `tests/contract-registry.test.mjs` | ART-1 |
| **ART-3** Complete local store and resolver — engine implementation and seeded tests 2026-10-22; durable Worker/Node adapter wiring implemented by ART-4, review unsigned | `packages/federation/artefact-store.mjs`, `packages/runtime/artefacts.mjs`, `packages/flags/registry.mjs` (one row, after FF-5 lands), `tests/artefacts/store.test.mjs`, `tests/artefacts/chaos.test.mjs` | ART-1; FF-5 registry edits merged |
| **ART-4** Complete local pin call sites — engine-backed pins, legacy bridging, durable adapters and transition serving implemented locally 2026-10-22; versioned BusStore path and engine/account input/provider forwarding tested; grant/consent integration remains ART-5, review unsigned | `packages/federation/{schema,extensions,event-buses}.mjs`, `packages/events/store.mjs`, `packages/runtime/{federation,incremental-authorization}.mjs` (fetcher wiring hunks only) | ART-3; FF-5 merged (it owns the two runtime files and has uncommitted edits in `extensions.mjs` and `event-buses.mjs`); before ORG-10's `schema.mjs` hunk |
| **ART-5** Engine and consent implementation complete locally, including initial-grant contract pins, incremental runtime resolvers, per-version reviewed copy and detailed literal deltas. Worker entry/front artefact ports are now wired locally. Resource upgrades conservatively require review; review unsigned | `packages/federation/{service,incremental}.mjs`, consent views and model, runtime federation/incremental composition, SDK request members | ART-4; ART-8 handoff below |
| **ART-6** Engine and shared-runtime implementation complete locally: digest-verified validation/projection, contract snapshot entries, grant-to-token `cv`, signed access-token verification and introspection checks. Worker/Node introspection now forwards the version flag locally. Unsupported schema constructs fail closed; conflicting grant contract pins require consent. Review unsigned | `packages/federation/{signing,introspection,brokered,integrations}.mjs`, shared runtime contract resolver | ART-4; ART-8 handoff below |
| **ART-7** Mirror (deferred) | `packages/runtime/http.mjs` route hunk, `artefact-mirror.v1` declaration | ART-3; outbound-fetch gate |
| Spec amendments AMD-R1…R7 | Coordinator, after sign-off: protocol, extensions, events, integrations, security | Sign-off |

### ART-8 local completion and adapter handoff (2026-10-22)

Implemented locally: signed `bindle.cv` claims; initial and incremental contract-reference persistence; grant-to-mint forwarding; digest-bound native argument/result validation through `IntegrationContract`; live flag composition for entries, incremental, client metadata and account brokering engines; detailed version deltas in both consent surfaces; consent copy isolated per grant/version. Frozen object-storage/v1 has no `x-methods`: a byte-matched compatibility snapshot supplies its existing method/result mapping without modifying the published body. Unknown bodies receive no inferred mapping. Existing stored native pins resolve from durable records even when creation is disabled. Mixed incompatible brokered contract pins fail closed rather than unioning authority.

**Adapter reconciliation (2026-10-24; provisional, unsigned):** the previously pending handoff is present in current code: the Worker front exports `ARTEFACTS`, entry/incremental composition receives the durable artefact port, and Worker/Node brokered introspection forwards `ARTEFACT_VERSIONS_ENABLED`. The earlier unapplied-diff limitation is historical. This confirms local wiring, not provider conformance, production verification or release approval.

Optional publisher provenance signatures and origin key continuity (§9.3) are not implemented by this token-signing work. Notices remain unverified publisher claims and cannot suspend existing use as signed notices. Existing brokered grant references continue through trusted system mint/introspection paths when version creation is disabled; missing/conflicting references fail closed. ART-7 remains deferred. The design's human sign-off and deferred review issues remain open. Reviewer ___ Date ___ Outcome ___. Per the user's ART-8 ownership instruction, no DEVLOG entry was edited.

Historical coordination note from the initial slice plan (the ART-8 status above supersedes these waits): ART-5 and ART-6 both touch federation but different files. If the current edits in `service.mjs` (the preferences/v2 projection work, EXT-X8) are still in flight, ART-5 waits. ART-6 waits for FF-5, whose uncommitted flag-read edits touch `introspection.mjs`, `brokered.mjs`, `integrations.mjs` and `incremental.mjs` (R1-L4).

### 11.4 Rollout flag

```js
['ARTEFACT_VERSIONS_ENABLED','a','G',{risk:'crit',stateful:true,retainExisting:false,retentionReason:'Pins and records live in the provider-wide artefact store; no account-local predicate.',envParse:'boolean'}]
```

Global targeting only: per-account targeting would give one provider two pin semantics for the same line. Under the FF-5 registry, `stateful` implies an account `hasState` predicate unless `retainExisting:false` is stated, so the row states it, as the incremental-authorization and email-bridge rows now do. The flag is default off. While off:

- envelopes are refused (`unsupported_artefact_version`) and only legacy artefacts pin, exactly as today;
- `artefact-versions.v1` is not declared.

Turning it off after versioned pins exist does not downgrade them. Stored records still verify existing pins, new versioned references are refused, and nothing falls back to unverified fetches. The derived `ARTEFACT_MIRROR_MOUNTED` (class b) follows in ART-7.

### 11.5 Tests

Mostly at engine level, through `AppAction`/`AppQuery` operations (`artefacts.pin`, `artefacts.resolve`) with in-memory ports.

- **Engine:**
  - pin latest;
  - pin an older version than the head;
  - a request below the head served from the store;
  - head advance on demand only;
  - a grant pinned at *N* projecting only *N*'s fields;
  - argument validation at *N*;
  - silent upgrade with no delta;
  - "updated method" delta;
  - declined upgrade keeping *N*;
  - legacy pin to version-1 upgrade.
- **Adversarial:**
  - history rewrite: an earlier body edited, an entry removed, renumbered, reordered or truncated, a `prev` swapped, a body replayed under another `id` or `kind`;
  - a duplicate-key differential, `{"effect":"read","effect":"destructive"}` and the escaped-name variant;
  - number forms `1.0`, `1e2`, `-0`, `01` and `9007199254740993`;
  - lone surrogates, raw and escaped;
  - NFC versus NFD title, both as distinct digests and as a non-additive edit;
  - BOM and invalid UTF-8;
  - astral key order;
  - "same digest, different bytes" (whitespace and escapes) yielding identical validation;
  - an appended non-extensible enum;
  - a new required field;
  - a changed `effect`;
  - an equivocating reference from another party;
  - an unsigned retraction not suspending, and a signed one suspending;
  - a notice bound to another line;
  - a retraction removed in a later copy.
- **Seeded chaos** (one PRNG seed per run, printed on failure). Fetch outcomes are drawn from:
  - ok, timeout, 404, 410, 5xx, TLS error;
  - changed content;
  - oversized, truncated or slow body;
  - redirect;
  - wrong media type.

  Store faults (transaction abort, delayed commit) and concurrent pins of different heads interleave with them. Invariants:
  - no authority-bearing decision ever uses an unverified body;
  - a pin, once committed, always resolves;
  - faults and notices are monotonic;
  - heads never decrease;
  - stored records are never overwritten.

## 12. Normative versus 3sln.me-specific

| Normative for every provider (spec) | 3sln.me only (this document) |
| --- | --- |
| Envelope, strict parsing, JCS, record digest, chain | Source layout, lock file, CI checks, convenience `<n>.json` paths |
| Reference members and legacy mapping | Storage keys, transaction placement, no deletion in the first implementation (ART-D15) |
| Growth points and reader safety | Fetch budgets below the spec maxima; allowlist-only fetch until the egress gate |
| Failure outcomes (fail closed) and rewritten-history handling | Operator fault review UI |
| MUST store before pin; retain while referenced | The flag and its rollout |
| Notices, retraction semantics; optional signatures | Mirror rollout timing; which mirrors are configured |
| Grant binding, upgrade and widening rule; `bindle.cv` | Consent copy for "updated method" and version display |
| Feature identifiers | — |

## 13. Questions decided by the user

The user accepted all four recommendations on 2026-10-22. They are recorded as ART-D12 to ART-D15 and carried into the spec. No product questions remain open in this document; the review items R1-M1 and R1-L2 below are still open.

| # | Question | Decision (by the user, 2026-10-22) | Spec |
| --- | --- | --- | --- |
| Q1 → ART-D12 | Should the canonical artefact URL serve the **envelope** (breaking anyone who fetches `$id` expecting a bare JSON Schema), or keep a bare latest body there with the envelope at a sibling URL? | **Envelope at the canonical URL eventually**, version records at `<id>/versions/<n>`. During the transition the legacy body stays at the URL and the envelope is at `<id>/envelope` until dependents declare `artefact-versions.v1`. | §2, §11 (now MUST) |
| Q2 → ART-D13 | May an **unsigned** retraction suspend existing grants, or only block new pins and notify? | **Only block and notify.** Suspending existing grants needs a signature by a key pinned for the line. | §9.2 (now MUST NOT without one) |
| Q3 → ART-D14 | Should new lines publish with **open result objects** (`additionalProperties` allowed, readers ignore unknown) so results can grow additively? | **Yes for new lines.** Existing v1/v2 bodies stay frozen as version 1. | §6.3 |
| Q4 → ART-D15 | Should version records be **garbage-collected** at all? | **Not in the first implementation.** | §8.2 permits deletion; 3sln.me does not delete |

## Reviews

Round 1 below (independent adversarial review, 2026-10-21). Still recommended: a second reviewer on §10 against incremental authorization once ART-5's data model is drafted.

### Review round 1

Independent adversarial review, 2026-10-21. Reviewer: delegated agent (not a human sign-off). Checked against `canonical()` in `packages/core/primitives.mjs`, `strictJSON`/`jcs` in `packages/messaging-protocol/encoding.mjs`, `pinSchema`/`pinSlotManifest`/`pinBusManifest`, grant and preference records in `packages/federation/service.mjs`, `bare()` and suppression matching in `incremental.mjs`/`suppression.mjs`, `REVIEWED_CONTRACTS` in `packages/consent/reviewed-contracts.mjs`, the FF-5 registry diff, organizations design ORG-D19 and spec §9.8, and every file under `docs/artefacts/**` (all except the superseded `automation-v1.json`, which has one negative integer, pass a strict integer-only parse). "Resolved" means the spec or design text now says so; everything stays provisional and unsigned.

#### High

**R1-H1. A split view between the consenting provider and the implementer (resolved).** *Scenario:* AMD-R4's `bindle.cv` carried only a version. A publisher serves the provider's IP a version 3 whose `put` takes only `key` and `body`, and serves the integration's IP a version 3 that adds `overwriteAll`. The owner consents to the first; the integration validates arguments against the second. Both chains are internally consistent and neither party ever sees the other's digest. *Fix:* `bindle.cv` maps contract URL to `{version, digest}`; integrations validate and shape results at that record and fail closed on mismatch (spec §10.4, AMD-R4). Apps SHOULD send digests too (§5 rule 7), so the app's tested view travels end to end.

**R1-H2. Any app can freeze any line (resolved).** *Scenario:* spec §7.3 treated a received reference whose digest disagreed with the stored one as "equivocation evidence" and recorded a publication fault, which stops all new versions until an operator clears it. A malicious client sends `{"fragment": U, "version": 2, "digest": "sha256-AAAA…"}` once per line and freezes every line at the provider. Records are unsigned, so even a well-formed conflicting record is free to fabricate. *Fix:* a foreign mismatch fails only that request and is logged; equivocation is recorded only from two conflicting records the provider fetched itself from the origin, or that carry valid pinned-key signatures (spec §7.3).

**R1-H3. Result and payload growth widened access without consent (resolved).** *Scenario:* `profile/v1` (result open) gains `email` in version 2. The design's upgrade rule compared only request schemas, so the pin advanced silently; worse, nothing told implementers to withhold the new member from grants still pinned at version 1, so every existing grant started receiving `email` as soon as the implementer updated. The same holds for bus payload properties and new bus `types`. *Fix:* a result or payload member added at *M* is never returned or delivered under a pin below *M*; new bus types are withheld from readers pinned earlier; upgrades across result, payload or type growth are "updated" delta items (spec §6.3, §10.4, §10.5).

**R1-H4. Version pins break today's grant matching (resolved in the migration plan).** *Scenario:* `service.mjs` stores `preferences/<subject>|<fragment>` with a `digest` and requires `grant.digest === preferences.digest` for silent re-grant (line 95), for the consumer snapshot (line 123) and at approval (line 206). Once the preference record follows the line's head, every grant pinned at an older version silently drops out of `consumerSnapshot`, so the owner's "who receives this" review under-reports consumers before a shared update. *Fix:* §11.2 now says preference records are keyed by line and grants match by line plus version ≤ head; ART-5 must carry an engine test where a v1-pinned grant still appears among affected apps after the owner saves under v2.

**R1-H5. The 32-version / 256 KiB cap forces the exact churn the design avoids (resolved).** *Scenario:* a busy contract (12 KiB, like `object-storage-v1.json`) hits 256 KiB at about 20 versions. Spec §2 then required a new line, which by ART-D1's own reasoning loses owner values, suppressions and registry identity. A domain buyer can also burn the remaining versions in one afternoon. *Fix:* up to 1,024 versions; any entry except the last may be elided to `{version, prev}`, with its record at `<id>/versions/<n>` verified against the successor's `prev` (spec §2, §7.1). Extraction still comes from the publisher's own artefact, as the user asked.

**R1-H6. The number rule contradicted itself and left the hardest JCS part in place (resolved).** *Scenario:* §3 rule 3 gave `1e+21` as canonical while also requiring integers within ±(2^53−1); `1e21` is an integer outside that range. More generally, canonical non-integer text needs an ECMAScript-exact shortest-round-trip formatter in every language (Python writes `1e-07`, Java `1.0E-7`), the classic JCS differential. No current artefact uses a non-integer. *Fix:* numbers are safe integers in plain decimal only; fractions and exponents are malformed (spec §3 rule 3). This matches the existing Bindle Messaging profile, minus its ban on negatives.

#### Medium

**R1-M1. Pin-by-digest does not stop split views between unrelated providers (open, deferred).** *Scenario:* a publisher shows provider A one history and provider B another. Each is consistent, and no reference ever crosses. Full copies plus `prev` stop rewrites only for a party that already stored digests; a newcomer accepts whatever history it first sees. *Position:* within a relationship, R1-H1 and §5 rule 7 close it. Across unrelated providers, detection needs a transparency log or gossip of heads between mirrors. The record and signature formats are already loggable, so this can be added without a format change. Recorded as a known limit; revisit before cross-provider relations (organizations phase D).

**R1-M2. Mirrors serve valid but retracted versions (resolved).** *Scenario:* origin down; a mirror serves version 4, which the origin retracted yesterday; the provider pins it fresh. *Fix:* a mirror-only record may satisfy existing pins but creates a new pin only after an origin notice fetch in the last 24 hours, and never advances a head or answers a URL-only request (spec §8.4).

**R1-M3. Lagging providers never learned of retractions (resolved).** *Scenario:* heads advance only on demand, and a notice was accepted only if its `head` was in the provider's *accepted* chain. Provider at head 2; the publisher, at version 5, retracts from 2 with `head` = *d₅*: the provider ignored it. Refresh was also only MAY. *Fix:* a notice is accepted when its `head` verifies within the copy's chain and agrees with stored digests, independent of the provider's head; referenced lines SHOULD be refreshed daily; §7.2 step 3 now reads `from` ≤ *i*+1 (spec §7.2, §8.3, §9.1).

**R1-M4. Retraction text as a phishing channel, and key compromise (resolved).** *Scenario:* an expired-domain buyer publishes an unsigned retraction whose `reason` says "Your calendar access was compromised, re-verify at cal-support.example", and every dependent owner is notified with it. Separately, a thief with the publisher's signing key issues a signed retraction and suspends invocations everywhere. *Fix:* owner notifications use the provider's fixed wording and link to the provider's own page; `reason` is shown only there, quoted and never linkified; `successor` is never rendered as a link. Owners can always resume; a key rotation accompanying a signed retraction is staged for operator review; a key set first seen after a "no keys" pin is staged, never adopted (spec §9.1–§9.3). Notices are capped at 7 `deprecated` plus 1 `retracted`, so deprecations can no longer exhaust the room for a retraction.

**R1-M5. Additive JSON Schema changes that are not additive (resolved).** *Scenarios:* (a) a new `$defs` entry carrying `$anchor: "args"` or `$id` captures an existing `$ref`, so an existing method's request schema changes while every old byte stays put; (b) version 1 holds a dangling `$ref` that a later definition fills; (c) a new optional argument with `default` is injected into old callers' requests by validators that apply defaults; (d) every version shares one `$id`, and Ajv-style registries either throw or silently reuse the first compiled version, so "validate at the pinned version" quietly validates at another; (e) the CX-1 catalogue keys reviewed copy by URL, so "Add and replace files" would keep its reviewed badge after `put` gained arguments. *Fix:* spec §6.3 bans `$id`/`$anchor`/`$dynamic*` in added definitions, dangling references and `default` on added arguments; §10.4 requires per-digest validator contexts; §10.5 compares fully resolved branches; §10 rule 8 binds reviewed copy to version digests.

**R1-M6. Migration order breaks today's legacy pins (resolved).** *Scenario:* `pinSchema` and `pinSlotManifest` refetch and validate the document on every pin before consulting the store. If ART-2 starts serving envelopes at canonical URLs while the flag is off, or to any provider without `artefact-versions.v1`, the document "changed": `invalid_schema` or `schema_changed` on every grant flow. Also, stored legacy digests are bare base64url (`federation/schema/<url>`, grants), while references require the prefix; and a legacy document that fails the new strict profile could never migrate. *Fix:* spec §11 keeps the legacy body at the URL with the envelope at `<id>/envelope` until dependents declare the feature, accepts bare legacy digests, and leaves documents that fail §3 as legacy lines with valid pins. Q1 updated.

**R1-M7. A second strict parser, and a serializer that does not refuse (resolved).** *Scenario:* the design proposed a new tokenizer although `packages/messaging-protocol/encoding.mjs` already has a reviewed one. A hand-written tokenizer that assigns `o[k] = v` turns `"__proto__"` into a prototype change, so the hashed value and the validated value differ. `canonical()` encodes an absent `prev` as `"prev":undefined` and hashes it without complaint, producing a digest no other implementation reproduces. *Fix:* generalize the Bindle Messaging pair into core (design §4.2, §11.2); spec §3 rules 6–7 and the refusing-serializer requirement.

**R1-M8. Meaning can change without changing structure (partly resolved).** *Scenario:* version 3 adds an optional field described as "When set, the calendar above is published publicly", or a new method whose summary says existing `read` now also exports. Embedding passes; validators cannot judge meaning. Likewise a new `summary` translation can reframe an already granted method for one language. Bidi controls in a frozen title can make it read differently from its bytes. *Fix:* a publisher MUST NOT add members that reinterpret existing ones (spec §6.1); upgrade deltas show all added display strings (§10.5); display strings refuse controls and bidi overrides (§3 rule 7). *Residual:* this is a publisher obligation, not a mechanical check, and implementation behaviour is never covered by any digest. The design should say so wherever it says "additive is mechanical".

#### Low

**R1-L1. Kind confusion in the shared pin key space (resolved).** `pinSchema`, `pinSlotManifest` and `pinBusManifest` share `federation/schema/<url>`, so one URL pinned as a fragment satisfies a slot pin with the same digest. Version records already bind `kind`; spec §5 rule 6 now makes a container/kind mismatch `artefact_invalid`.

**R1-L2. Relation documents have no kind (open, coordinate).** Organizations rev 3 plans relation documents as *versioned* with re-consent when access widens (organizations design §8a.2, "Upgrades" row), while this design offered `document` (no growth) for "bonds", and Q11 there recommends the name "relation". Spec §6.3 now lets another spec register a kind with its own growth table, processed as unknown until signed. The organizations owner should draft `relation` growth points, treating any added access-matrix entry as a widening. This review does not edit organizations documents.

**R1-L3. Small consent edges (resolved).** An upgrade to a version at or above a retraction's `from` is refused; a request naming a version below the pin never moves it down (spec §10.5). `from` must not exceed the version named by `head` (§9.1). A non-additive step is permanent, so §7.2 no longer implies an operator can clear it.

**R1-L4. Slice ownership against in-flight work (resolved in §11.3, needs coordinator confirmation).** The working tree has uncommitted FF-5 flag-read edits in `packages/flags/registry.mjs`, `packages/runtime/{federation,incremental-authorization}.mjs` (FF-5b owns both) and `packages/federation/{extensions,event-buses,incremental,introspection,brokered,integrations}.mjs`. ORG-10 owns a `packages/federation/schema.mjs` hunk. ART-3, ART-4 and ART-6 now wait for FF-5, and ART-4 lands before ORG-10's hunk. The flag row gained `retainExisting:false` with a reason, because the FF-5 registry now derives an account `hasState` predicate from `stateful`.

**R1-L5. Display-only rows (no change).** The "same digest, different bytes" row in §4.2 is correct once numbers are integers: only whitespace and escapes remain. NFC/NFD handling is right: no normalization, and a change between them is non-additive.

#### Not changed, for the coordinator

- Signatures stay optional. Making them mandatory would turn R1-M1 and domain-loss risk into a key-management problem every publisher must solve; revisit with the transparency question.
- Human sign-off of this round, R1-M1 and R1-L2 is still needed. No DEVLOG entry was written by this review.

### Local history storage and verification (2026-10-23, provisional)

The durable resolver separates line-head/notices/fault metadata from 128-entry digest pages. Exact pin resolution reads the head, pin and content-addressed record without loading the history. Existing inline histories migrate transactionally to pages on the next accepted update. A cold verifier reads digest pages and authenticates the supplied chain; a warm verifier keeps at most 16 detached authenticated lines and compares complete canonical prefix entries, including bodies, before reusing their cryptographic results. A body-less entry is reused only when the following entry still binds its stored digest and the supplied record equals the authenticated one, so warm and cold verifiers reach the same verdict and record the same faults. Modified entries take the normal digest verifier, so changed bodies, predecessor links and truncation still freeze rewritten history. Only newly accepted bodies require validation, additivity checks and record-store work; a previously unknown kind requires validation from the accepted head if it later becomes registered. Digest vectors are assigned once per acceptance.

Operator document registries are normalized once per configuration revision (registry object replacement or JSON-byte change, plus the relevant integration/extension flags). Live object registries still reflect operator additions, removals and entry replacements, and every lookup re-checks the 100-fragment bound; callers receive a frozen copy of each distinct entry, never the operator's object, so an in-place nested edit of an already-read entry takes effect only once the entry or the registry is replaced. Unregistered URLs retain the existing refusal boundary. The remaining work of reading and comparing the bounded envelope scales with its wire size; these changes remove repeated record reads and quadratic prefix copies, and do not establish production egress verification.
