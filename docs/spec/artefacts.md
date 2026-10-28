# Public artefacts: additive versions and integrity references — normative draft

> **Group:** Bindle core
>
> **Status:** provisional draft, revision 3; strict validation and durable publication are implemented locally; alignment with extensions revision 3 is pending (CR-X3-14). Nothing is published as immutable yet.
>
> **Covers:** the public artefact envelope, additive versions, integrity references, caching, notices and grant upgrades.
>
> **Does not cover:** signed-object JWS rules ([keys](keys.md)); the meaning of particular contracts ([contracts](contracts.md)); extension descriptors ([extensions](extensions.md)).

> **Pending [extensions revision 3](extensions.md) (draft, unsigned, 2026-10-27).** Where this document relies on `slot` references, extension declarations carrying `version` (AMD-R3, withdrawn) and its §12 features, extensions revision 3.2 and protocol §2–§4 govern instead. Change request CR-X3-14, [extensions Appendix A](extensions.md#appendix-a-migration-and-impact-change-requests-not-applied).

Status: **provisional draft, 2026-10-22, revision 3** (review round 1 applied; the user's 2026-10-22 decisions on design §13 Q1–Q4 applied in §2, §6.3, §9.2 and §11). Implemented locally: strict envelope/reference validation and additive checks (`packages/core/artefacts.mjs`), durable publication/resolution (`packages/federation/artefact-store.mjs`), versioned preference/grant/contract integration and transition serving. These are local implementation paths behind `ARTEFACT_VERSIONS_ENABLED` (default off), not full external-provider conformance. The draft remains unsigned and nothing is production-verified. Rationale, alternatives, migration and tests: [artefact references](../architecture/artefact-references.md). Human sign-off: reviewer ___ / date ___ / outcome ___.

This document extends [protocol §3, §4 and §6](protocol.md), [extensions §2, §4 and §7](extensions.md), [events §2](extensions/events.md), [contracts](contracts.md), [integrations §2.3](extensions/integrations.md) and [incremental authorization](extensions/incremental-authorization.md). It changes the rule "a public artefact is immutable at its URL" into "a public artefact is **append-only** at its URL". MUST/SHOULD/MAY express draft requirements. Identifiers under `https://spec.bindle.example/` are placeholders. §14 lists the core amendments this draft needs; they are **proposed and unsigned**.

## 1. Scope and terms

A **public artefact** is a public JSON document identified by an absolute HTTPS URL that other parties depend on for meaning or authority: preference fragments, slot manifests, bus manifests, RPC contracts, submission schemas and manifest profiles. Provider manifests, integration manifests, client metadata and JWKS are **not** artefacts under this document; they are mutable declarations with their own snapshot rules.

| Term | Meaning |
| --- | --- |
| **Line** | Everything published at one artefact URL. The URL's path usually ends in a major version (`…/v1`); a breaking change starts a new line at a new URL. |
| **Version** | One entry of the line, numbered 1, 2, 3 … with no gaps. Each version is a complete, self-contained body. |
| **Body** | The artefact as a processor uses it: the fragment, slot manifest, JSON Schema contract, and so on. |
| **Version digest** | The SHA-256 digest of a version record (§4). It commits to the body, the line URL, the kind and every earlier version. |
| **Reference** | A triple (URL, version, version digest) naming exactly one version (§5). |
| **Pin** | A stored reference that some state depends on: a grant, a consent record, an enablement, an integration snapshot, a bus record. |
| **Head** | For one provider and one line, the highest version that provider has verified and accepted. |
| **Authority-bearing use** | A use whose outcome grants, scopes, shows for consent or executes access: grant approval, token minting, RPC argument validation, consent display, slot and bus enablement, brokered method-effect checks. |

## 2. The envelope

The document served at an artefact URL is an **envelope**. While a migrated line still has legacy dependents, the envelope is served at `<line URL>/envelope` instead (§11, "Publication order"):

```json
{
  "bindle_artefact": 1,
  "id": "https://spec.bindle.example/preferences/calendars/v1",
  "kind": "fragment",
  "versions": [
    {"version": 1, "prev": null, "body": {"id": "https://spec.bindle.example/preferences/calendars/v1", "title": "Calendars", "fields": {"calendar": {"title": "Calendar", "type": "resource", "contracts": ["https://spec.bindle.example/contracts/calendar/v1"]}}}},
    {"version": 2, "prev": "sha256-3q2-7w…", "body": {"id": "https://spec.bindle.example/preferences/calendars/v1", "title": "Calendars", "fields": {"calendar": {"title": "Calendar", "type": "resource", "contracts": ["https://spec.bindle.example/contracts/calendar/v1"]}, "weekStart": {"title": "Week starts on", "type": "enum", "values": ["monday", "sunday"], "cardinality": {"min": 0, "max": 1}}}}}
  ],
  "notices": [],
  "signatures": []
}
```

| Member | Required | Rule |
| --- | --- | --- |
| `bindle_artefact` | yes | The integer `1`. Any other value makes the envelope **unrecognized**: no version in it is usable. |
| `id` | yes | The line URL, byte-identical to the URL fetched. HTTPS, at most 256 characters, no userinfo, query or fragment. |
| `kind` | yes | One of the kinds in §6.3. It never changes within a line. An unknown kind is processed under §6.4. |
| `versions` | yes | 1–1,024 entries in ascending order. Entry *i* (0-based) MUST have `version` = *i* + 1. Any entry except the last MAY be **elided** (below). |
| `notices` | no | Deprecation and retraction notices (§9). At most 7 `deprecated` and at most 1 `retracted`. |
| `signatures` | no | Detached publisher signatures (§9.3). At most 64. |

Each version entry has **exactly** the members `version` (integer), `prev` (`null` for version 1, otherwise the version digest of the previous entry) and `body` (an object). Any other member, a missing member or a wrong type makes that entry and every later entry invalid. Unknown top-level envelope members are ignored and carry no meaning.

An **elided** entry has exactly `version` and `prev`, and no `body`. Its version digest is the `prev` of the entry after it, so the chain stays complete. Its version record is served at `<line URL>/versions/<n>` (for example `…/calendars/v1/versions/3`) as `application/json`, and by mirrors under §8.4. A publisher MUST serve the record of every elided entry there and MAY serve any other version's record there. A validator that needs an elided body fetches the record, recomputes its digest and compares it with the successor's `prev`; the record is untrusted until that check passes. The per-version URL is part of the line: it is fetched only under §8.3, and an unreachable per-version URL is the same outcome as an unreachable envelope (§7.4).

Bounds, checked before parsing where possible: envelope at most 256 KiB of UTF-8 (publishers elide old bodies to stay under it); each body at most 64 KiB in canonical form (the existing fragment bound); nesting depth at most 32; at most 4,096 object members and array elements in total per body. A kind may set lower bounds (for example 16 KiB for slot manifests under extensions §4.3).

A line reaches its end only at 1,024 versions, or when a single version record would exceed its body bound. Publishers elide older bodies instead of starting a new line, because a new line loses owner values, suppressions and grants (design §2).

## 3. Strict parsing and canonical form

Validators MUST parse artefact bytes with a strict parser and MUST then use only the parsed value: the value they hash is the value they validate and interpret. A document violating any rule below is **malformed**. A malformed envelope yields no usable version.

1. The bytes are UTF-8 without a byte order mark. Invalid UTF-8 is malformed.
2. The text is a single JSON value ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)) and also [I-JSON](https://www.rfc-editor.org/rfc/rfc7493): no duplicate member names in any object, at any depth, compared after unescaping; no unpaired surrogates, whether raw or `\u`-escaped; no noncharacters (U+FDD0–U+FDEF and the last two code points of every plane), as I-JSON requires.
3. **Numbers are integers in plain decimal form**: every number token matches `-?(0|[1-9][0-9]*)`, is not `-0`, and has a value within ±(2^53 − 1). Fractions and exponents (`0.5`, `1.0`, `1e2`, `1E2`, `1e+21`) are malformed. This removes the one part of JCS that needs a shortest-round-trip float formatter in every language, which is where independent implementations most often disagree. A kind that needs a non-integer bound states it as a string or a scaled integer.
4. Whitespace between tokens and the choice between a literal character and its `\u` escape carry no meaning.
5. Strings are compared and hashed as sequences of code points exactly as written. Validators MUST NOT apply Unicode normalization (NFC, NFKC or any other) or case folding anywhere in this document's processing. Two strings that look alike are different strings.
6. Member names are ordinary data. A parser MUST produce `__proto__`, `constructor` and similar names as plain own members (in JavaScript: define, never assign), so the value hashed equals the value validated.
7. Display strings (any `title`, `description`, `summary` text and notice `reason`) MUST NOT contain C0 or C1 controls, bidirectional controls (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C), U+2028, U+2029, U+200B or U+FEFF. A body violating this fails its kind's validation. Text is frozen once published (§6.2), so deceptive ordering must be refused at first sight.

The **canonical form** of a parsed value is its [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JSON Canonicalization Scheme (JCS) serialization, encoded as UTF-8. Rule 3 makes number serialization trivial; rules 2, 5 and 6 remove the inputs on which JCS implementations can disagree. A serializer used for version records MUST refuse, never encode, any value outside this profile (an absent member, a non-integer, a lone surrogate): silently encoding it produces a digest no other implementation reproduces.

## 4. Version records and digests

For version *N* of a line, the **version record** is the object:

```json
{"t": "bindle.artefact-version.v1", "id": "<line URL>", "kind": "<kind>", "version": N, "prev": "<digest of N-1, or null>", "body": { … }}
```

The **version digest** is `sha256-` followed by the unpadded base64url ([RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5)) encoding of SHA-256 over the canonical form of the version record: 43 characters, matching `^sha256-[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$`.

Consequences:

- `prev` chains the versions. A version digest commits to every earlier version of the line, so a reference to version *N* also anchors versions 1 … *N*−1.
- `id` and `kind` in the record stop a body from being replayed at another URL or under other growth rules.
- `t` separates version digests from every other Bindle digest (for example AMD-C2 legacy body digests, §11).

**Hash agility.** The digest prefix names the algorithm. This envelope version defines only `sha256`. A future algorithm requires a new `bindle_artefact` value, which defines both the digest of references and the `prev` chain. A reference carries exactly one digest. A reference whose algorithm the validator does not support is **unverifiable** (§7.4); validators MUST NOT fall back to a weaker algorithm or to an unpinned fetch.

## 5. References

A reference names one version. In JSON it is three members of one object:

| Member | Rule |
| --- | --- |
| a URL member | The line URL. Existing containers keep their member name: `fragment` in fragment requests and grants, `slot` in extension declarations, `manifest` in bus records, `contract` in contract pins. A new document type uses `artefact`. |
| `version` | Integer ≥ 1. |
| `digest` | The version digest of that version (§4). |

```json
{"fragment": "https://cal.example/preferences/calendars/v1", "version": 2, "digest": "sha256-…"}
```

Rules:

1. **`version` and `digest` travel together.** A reference with `version` but no `digest` is invalid. A reference with `digest` but no `version` is a legacy reference (§11).
2. **No compact string form is normative.** Implementations MUST NOT parse references out of URL fragments or query strings. Display forms (for example `cal.example/preferences/calendars/v1 · version 2 · sha256-3q2-7w…`) are presentation only.
3. **Latest is not a reference.** A request that names only a URL (no `version`) asks the provider to resolve the line's current version and pin it (§7.2). Once pinned, the pin governs. No authority-bearing use ever follows "whatever the URL serves now".
4. **No version ranges.** A reference names exactly one version. Compatibility between versions follows from §6, not from range syntax.
5. References inside artefact bodies (for example a fragment field's `contracts` list) name **lines** by URL only. The versions actually used are pinned by the grant or enablement that uses them (§10).
6. **Kind matches container.** Each URL member implies a kind (`fragment` → `fragment`, `slot` → `slot`, `manifest` → `bus`, `contract` → `rpc-contract`; `artefact` names its kind in the containing document's rules). A reference to a line of another kind is `artefact_invalid`.
7. **Senders SHOULD pin.** Applications and SDKs SHOULD send `version` and `digest` taken from the version they were built and tested against. A URL-only request (rule 3) lets the publisher choose what the provider pins; it is meant for development and owner-initiated setup.

## 6. Additive change

### 6.1 The rule

Version *N*+1 of a line is **additive** over version *N* when both of these hold:

1. **Embedding.** The body of *N* embeds in the body of *N*+1 under §6.2, with additions only at the growth points of the line's kind (§6.3).
2. **Reader safety.** Everything a holder of version *N* can *receive* under version *N*+1 is something version *N* already admitted. Additions may widen what an implementer *accepts* (new optional request members, new methods, new optional fields an owner may configure), but never what an old reader must *understand*.

Embedding is mechanical; meaning is not. A publisher MUST NOT add a member whose text or schema changes how an existing member is interpreted (for example a new field described as "when set, `calendar` is shared publicly", or a new method described as changing what an existing method does). Validators cannot detect this, so §10.5 shows every added text on upgrade, and an implementation's behaviour is never covered by a digest.

A version that is not additive over its predecessor is a **publication fault** (§7.3). It cannot be repaired within the line: the publisher starts a new line, optionally naming the old one in `supersedes` where the kind supports it.

### 6.2 Embedding

`embeds(a, b, p)` holds for values *a* (old) and *b* (new) at JSON Pointer path *p* when:

- *a* is an object: *b* is an object; every member *k* of *a* is in *b* and `embeds(a[k], b[k], p/k)`; and every member of *b* not in *a* is at a growth point that permits `add-member` at *p* and satisfies that growth point's constraint.
- *a* is an array: *b* is an array with length ≥ length of *a*; for each index *i* of *a*, `embeds(a[i], b[i], p/i)`; and if *b* is longer, *p* is a growth point that permits `append` and every appended element satisfies its constraint. Arrays never reorder, insert in the middle or shrink.
- otherwise: *a* and *b* are the same JSON type and the same value. Strings are equal code point by code point.

Growth-point patterns are JSON Pointers in which `*` matches exactly one segment.

The consequence is deliberate: titles, descriptions, `publisher`, existing enum lists, cardinalities, contract lists, method effects, retention and every other existing value are **frozen** once published. Changing displayed text is a change of meaning.

### 6.3 Growth points by kind

| Kind | Pattern | Operation | Constraint |
| --- | --- | --- | --- |
| `fragment` | `/fields` | add-member | The new field has `cardinality.min` = 0 (stated explicitly) and passes the field rules of protocol §3. |
| `fragment` | `/fields/*/values` | append | Only if that field had `"extensible": true` in version *N*. New values match the existing value rules. |
| `slot`, `bus` | `/slot/options/occupant`, `/slot/options/consumer` | add-member | The new option field has `cardinality.min` = 0. |
| `slot`, `bus` | `/fields` | — | No growth: a slot has exactly one resource field (extensions §2). |
| `bus` | `/slot/bus/types` | append | Only if version *N* had `"slot.bus.types_extensible": true` as defined in AMD-R5 (readers then MUST ignore records of unknown types). A new type is a widening for readers (§10.5): records of a type added after a reader's pinned version MUST NOT be delivered to that reader. |
| `rpc-contract` | `/x-methods` | add-member | A new method entry, with `effect` present. |
| `rpc-contract` | `/oneOf`, `/anyOf` (top level) | append | Each appended branch selects only a new method's `method` constant. |
| `rpc-contract` | `…/properties` of an args object schema reachable from an existing method's request branch | add-member | Not listed in `required`, and carrying no `default`. Callers whose grants pin an earlier version never send it (§10.4), and upgrading to it is a widening (§10.5). |
| `rpc-contract` | `/$defs` | add-member | A new definition, reachable only from members added in the same or a later version. It MUST NOT contain `$id`, `$anchor`, `$dynamicAnchor` or `$dynamicRef` anywhere, and every `$ref` in version *N* MUST already resolve within version *N* (no dangling references that a later definition could fill). |
| `rpc-contract` | `/x-methods/*/summary` | add-member | New BCP 47 tags only (incremental authorization §8.1). |
| `rpc-contract`, `bus` | `…/properties` of an object schema reachable from an `x-methods` `result` pointer, or from `/slot/bus/payload` | add-member | Only where version *N* already admitted additional properties at that object (`additionalProperties` absent or `true`). A member added at version *M* is a widening (§10.5): it MUST NOT be returned or delivered under a grant pinned below *M*. |
| `submission-schema`, `manifest-profile` | request objects under `properties` | add-member | Not listed in `required`; the receiving party is the implementer. |
| `document` | — | — | No growth. Used for signed statements and attestations that never change. |

Other specifications MAY register a kind with its own growth table (organizations §9.8 registers `relation`). Until a kind's table is registered and signed, it is processed as unknown (§6.4).

No other path may grow. In particular, these are never additive: changing `required`, `const`, `pattern`, numeric or length bounds, `additionalProperties`, an existing `$defs` entry other than through a growth point above, any `effect` or `introspect` value, `crit`, slot selection, bus `publishers`, `readers`, `history`, `retention` or `categories`, adding a contract to a `contracts` list, and adding a new top-level member.

**Open results in new lines.** A line first published after this document SHOULD leave every result object, and every bus payload object, open (`additionalProperties` absent or `true`), so that results can grow at the growth point above. A reader of an open object MUST ignore members its pinned version does not name. Closing an object at version 1 is permanent for the line. Existing legacy bodies are never reopened: they migrate unchanged as version 1 (§11), so their closed results stay closed.

A new enum value is safe for old readers only where the enum was declared extensible from the start. A fragment field with `"extensible": true` tells every consumer, from its first version, to handle unknown values. Without it, appending is a publication fault.

### 6.4 Unknown kinds

A validator that does not know a line's kind can still verify digests and the `prev` chain. It MUST treat additivity as unverifiable: it may use exactly the versions it holds pinned references for, and MUST NOT advance its head.

## 7. Validation

### 7.1 Extracting and verifying a version

To verify a reference (URL *U*, version *N*, digest *D*) against an envelope:

1. Parse strictly (§3) and validate the envelope (§2). `id` MUST equal *U*.
2. Take entry *N*. Absence means the version is **not yet available** from this copy. If entry *N* is elided, obtain its record under §2 and use it as the entry; its digest must equal entry *N*+1's `prev`.
3. For every *i* from 1 to *N*, recompute the version digest *dᵢ* (§4) and check that entry *i*+1's `prev` equals *dᵢ*. The first failure makes that entry and every later entry invalid.
4. Check *d_N* = *D*. A mismatch is a **digest mismatch** (§7.4).
5. Validate body *N* against its kind's own rules (protocol §3, extensions §2, events §2, and so on), using the value parsed in step 1.

A validator that already holds verified entries 1 … *k* only needs to recompute the new ones, and to check that the copy's entries 1 … *k* produce the same digests.

### 7.2 Advancing a head

A provider keeps, per line, a head *H* and the digests *d₁ … d_H*. When it fetches a copy whose last valid version is *M* > *H*, it:

1. verifies entries 1 … *M* under §7.1;
2. checks that each copy digest *d₁ … d_H* equals its stored digest;
3. checks that each step *i* → *i*+1, for *H* ≤ *i* < *M*, is additive (§6) and that no accepted retraction notice has `from` ≤ *i* + 1 (§9.2);
4. stores the new entries and sets *H* = the highest *i* that passed.

A step that fails 3 is a publication fault from that version on; earlier versions stay accepted. A non-additive step is permanent: the line can never advance past it at this provider, and no operator action changes that. A provider advances its head only when an action needs a version above *H* or when it pins a request that named no version. It never advances a head because a document changed in the background.

### 7.3 Rewritten history

A copy has **rewritten history** when, for any version *i* ≤ *H*, its entry is missing, malformed, renumbered or produces a digest different from the stored *dᵢ*; or when it shows a non-additive step; or when it lacks a notice the provider has already accepted (§9.2). The provider then:

- keeps serving every pinned and accepted version from its own store (§8);
- records a publication fault for the line, visible to operators;
- accepts no new version of the line until an operator clears the fault, and clears it only once the publisher serves a copy consistent with the stored digests;
- never replaces a stored version with the copy's content.

A reference received from another party whose digest disagrees with this provider's stored digest for the same version fails that request as a digest mismatch and is logged. It is **not** by itself a publication fault: anyone can invent a digest or a well-formed record, so treating it as evidence would let any application freeze a line. A provider records **equivocation** only when it holds two conflicting records for one (line, version) that it fetched itself from the line's origin or per-version URL, or that carry valid signatures by a key pinned for the line (§9.3). Equivocation is a publication fault.

### 7.4 Failure outcomes

| Situation | Authority-bearing use | Other uses (registry display, documentation links) |
| --- | --- | --- |
| The referenced digest is in the local store | Proceed from the store, whatever the network says | Proceed |
| Fetch failed or timed out, no stored copy | **Fail closed**: `artefact_unavailable`, retryable | MAY show the URL marked "can't be checked right now" |
| Digest mismatch, no stored copy | **Fail closed**: `artefact_digest_mismatch` | MUST NOT present the fetched body as the referenced version |
| Envelope malformed or unrecognized, no stored copy | **Fail closed**: `artefact_invalid` | As above |
| Version above the head, not additive | **Fail closed** for that version: `artefact_not_additive` | As above |
| Unverifiable (unknown digest algorithm) | **Fail closed**: `artefact_unverifiable` | As above |
| Referenced version retracted (§9.2) | New pins refused: `artefact_retracted`. Existing pins follow §9.2 | Show the notice |

Errors carry no fetched content. They are outcomes of a public lookup and reveal nothing about any owner.

## 8. Caching, retention and fetching

### 8.1 The store

A provider that pins a version MUST store the verified version record, keyed by its version digest, in durable storage before the pin takes effect. A pin never depends on the artefact's origin staying reachable.

The store is provider-wide and content-addressed. Records are immutable: the same digest always maps to the same record.

### 8.2 Retention

A provider MUST retain a version record, and every earlier record of its line (the chain anchors it), for as long as any pin references it. That includes revoked grants that are kept for audit or export. After the last reference goes, it MAY delete the records after a grace period it documents.

### 8.3 Fetching

Artefact fetches are server-side outbound requests under [security](security.md) "SSRF boundary". In addition:

- HTTPS only; no redirects; no cookies, credentials or `Authorization`; `Accept: application/json`;
- response bodies at most 256 KiB after decompression; time-bounded; the response media type is `application/json` or a `+json` type;
- per-origin and global fetch budgets; failures are remembered as failures for at least 60 seconds and never stored as documents. The provider's own exhausted budget is not a failure of the line and MUST NOT be remembered in shared state. A provider whose fetches are limited to an operator registry refuses an unregistered URL before charging any budget or recording anything (2026-10-23 wargame F1, Provisional (coordinator), not signed off by the user);
- an artefact fetch is triggered only by a reference, a request or an operator action, never by a URL taken from a body, a notice, a mirror hint or another party's free text.

Version records are immutable, so a stored record never needs revalidation. While some live pin references a line, a provider SHOULD refresh it at least every 24 hours and MUST NOT refresh it more than once per hour, to learn of notices; a refresh accepts notices (§9.1) but never advances the head (§7.2).

### 8.4 Mirrors

A provider that declares `artefact-mirror.v1` (§12) serves, at `GET /.well-known/bindle/artefacts/<digest>`, the version record with that digest as `application/json`, for records in its own store only. It never fetches on a requester's behalf. Responses carry public CORS and no credentials.

A fetcher MAY obtain a record from a mirror when the origin fails. It recomputes the digest and follows `prev` to fetch earlier records the same way; the digest makes the mirror's integrity irrelevant, but not its freshness. A fetcher uses only mirrors its operator configured, or the issuer of the party that sent it the reference. A mirror cannot supply notices; notices come from the origin.

A mirror can therefore serve a valid version that the origin has since retracted. So a record obtained only from a mirror MAY satisfy a pin the provider already holds, but MAY create a **new** pin only when the provider has fetched the line's notices from the origin within the last 24 hours; otherwise the outcome is `artefact_unavailable`. A mirror record never advances a head and never answers a URL-only request.

## 9. Notices, retraction and signatures

### 9.1 Notices

A notice is an envelope `notices` entry:

| Member | Required | Rule |
| --- | --- | --- |
| `type` | yes | `deprecated` or `retracted`. |
| `head` | yes | The version digest of the line's last version when the notice was issued. It binds the notice to this line's history. |
| `from` | `retracted` only | The lowest affected version, at most the version that `head` names. Because the line is additive, every later version contains whatever made version `from` harmful. |
| `reason` | yes | Plain text, at most 500 code points, under §3 rule 7. Displayed only where the artefact itself is shown, quoted and labelled as the publisher's unverified claim, never linkified. |
| `successor` | no | A line URL. A hint only; it never migrates anything (extensions §7), is never fetched and is never rendered as a link in owner notifications. |
| `issued` | yes | An RFC 3339 date. |

A provider accepts a notice when `head` is the version digest of some entry of the copy, the copy's chain verifies up to that entry (§7.1 steps 1–3, fetching elided bodies), and the copy's digests agree with every stored digest. The provider's own head does not need to reach `head`: a lagging provider still learns of a retraction, and accepting a notice never advances its head. A notice whose `head` fails this is ignored. Notices are **sticky**: once a provider accepts a notice, a later copy without it is rewritten history (§7.3), and the provider keeps the notice.

### 9.2 Honouring a notice

`deprecated`: new pins remain allowed, with the notice shown wherever the artefact is shown for consent. Nothing else changes.

`retracted`: the line is closed. A version appended after `head` is a publication fault. For versions ≥ `from`, the provider:

- MUST refuse new pins, grants, enablements and head advances (`artefact_retracted`);
- MUST keep existing pins verifiable and their records stored. A retraction never invalidates a digest and never deletes a record;
- MUST notify each owner whose grants or enablements pin an affected version, in the provider's own fixed wording, naming the artefact's line URL host and the affected apps or features. The notification links to the provider's own page for the artefact, where the `reason` may be shown under §9.1; it never carries the `reason` or `successor` itself. An unsigned notice is publisher-controlled text sent to every dependent owner, and must not become a phishing channel;
- MUST NOT silently revoke a grant because of a notice;
- MUST NOT suspend existing grants, enablements or invocations under affected pins unless the notice carries a valid signature by a key pinned for the line (§9.3). An unsigned retraction only blocks new pins and notifies, so whoever controls the domain, including a buyer of a lapsed one, cannot switch off dependents with an unsigned edit;
- when the notice carries such a signature, SHOULD suspend new invocations under affected pins until the owner decides, and the owner MAY resume each one after a warning.

Versions below `from` are unaffected. A signed retraction is also the most powerful tool a stolen publisher key gives: it can suspend invocations everywhere. Owners therefore keep the right to resume, and a provider SHOULD stage a key rotation that accompanies a signed retraction for operator review rather than adopt it automatically.

### 9.3 Signatures

Signatures are optional. They add provenance, never integrity: a reference's digest is always checked, and a valid signature never makes a body acceptable that fails its reference.

- **Keys.** A publisher MAY serve a JWKS of Ed25519 (`OKP`, `EdDSA`) or P-256 (`ES256`) public keys at `https://<line origin>/.well-known/bindle/artefact-keys`. A provider pins the JWK thumbprints ([RFC 7638](https://www.rfc-editor.org/rfc/rfc7638)) on its first pin of any line from that origin. Rotation follows the integrations §2.3 continuity rule: a new set is adopted when at least one pinned key is still present; otherwise it is staged for operator review. A provider that found no key set at its first pin records "no keys"; a key set that appears later is staged for operator review, never adopted on first sight, because by then the domain may have changed hands.
- **Entries.** Each `signatures` entry is `{"kid", "alg", "covers", "sig"}`. `covers` is a version digest, or the notice digest `sha256-` over the canonical form of `{"t":"bindle.artefact-notice.v1","id":<line URL>,"notice":<notice>}`. The signing input is the canonical form of `{"t":"bindle.artefact-signature.v1","id":<line URL>,"covers":<covers>}`. `sig` is unpadded base64url.
- **Meaning.** A valid signature shows that the holder of a pinned key endorsed that version or notice. Providers MAY display "signed by the publisher's pinned key". A missing or invalid signature changes nothing, except that a retraction without one cannot suspend existing use (§9.2).

## 10. Grants, consent and upgrades

1. **What a pin binds.** A grant binds, for its fragment, the reference (URL, version, digest), replacing protocol §4's (URL, digest). It also binds a reference for every contract whose methods it grants. Extension enablements, bus grants and integration snapshot entries bind references in the same way.
2. **Values belong to the line.** An owner's preference values are kept per entity and fragment line, not per version. A field added in version 3 is simply unconfigured for grants pinned at version 2, and is never projected to them: a grant's field set is explicit.
3. **Serving older versions.** A provider whose head is *H* serves any accepted version *N* ≤ *H*. A request naming version *N* gets a grant pinned at *N*, and projections and argument validation use version *N*.
4. **Validation and results use the pinned version.** An implementer validates RPC arguments against the request schema of the contract version the caller's grant pins, and returns or delivers only result and payload members that version defines or that were admitted as unnamed additional members before the first version that names them (§6.3). For brokered resources, the provider states that version **and its digest** in the token (AMD-R4); the integration MUST validate against the record with that digest and fail closed (`artefact_digest_mismatch`) if its own copy differs, so a publisher cannot show the consenting provider one body and the implementer another. JSON Schema tooling registers schemas by `$id`, and every version of a line shares one `$id`: implementations MUST compile each version in a separate validator context keyed by its version digest, never by `$id` or URL.
5. **Upgrading a pin.** When an app sends a request naming version *M* of a line on which it holds a grant pinned at *N* < *M*, the provider verifies *N* → *M* under §7.2 and computes the delta:
   - new fields, resources or methods requested are delta items for [incremental authorization](extensions/incremental-authorization.md) (`grant-more`) or the initial consent flow;
   - for every already granted method whose request branch or result schema differs between the pinned contract version and the target contract version, compared after resolving every `$ref` (new optional arguments, new result members, §6.3), the method is a delta item marked "updated", because new arguments can widen what the method does and new result members widen what the app receives. Granted buses whose payload or `types` grew are "updated" in the same way;
   - the delta view shows every display string added between the two versions for granted items (for example a new `summary` translation), because added text can reframe existing items (§6.1);
   - if there are no delta items, the provider advances the grant's pin to *M* without asking the owner, records the change in the owner-visible access history, and never widens any field, resource or method set;
   - if the owner declines the delta, the grant stays pinned at *N* and keeps working;
   - a target version at or above an accepted retraction's `from` is refused (`artefact_retracted`);
   - a request naming a version below the current pin never moves the pin down.
6. **Consent display** shows the version and the line URL host. Changing the pinned version alone never resets an incremental-authorization suppression: suppressions match the line URL, which is unchanged across versions.
7. **Owner-initiated** configuration never upgrades an app's pin.
8. **Reviewed copy is per version.** A provider's reviewed consent copy for a contract (for example 3sln.me's CX-1 catalogue) is bound to a version digest, not a URL. A method whose request branch or result schema changed after the reviewed version is shown as unreviewed until its copy is reviewed again; methods that did not change keep their reviewed copy.

## 11. Legacy artefacts and compatibility

A **legacy artefact** is a document served at an artefact URL without `bindle_artefact`: the format every artefact had before this document. Its **legacy digest** is the AMD-C2 digest, `sha256-` over the canonical form of the whole document.

- A provider treats a legacy artefact as an unversioned line that can never grow. A reference to it has a `digest` and no `version`. A changed document at a legacy URL stays a publication fault (protocol §3).
- When a legacy line migrates to an envelope, version 1's body MUST be byte-for-byte equal in canonical form to the legacy document.
- A reference without `version` whose `digest` equals the legacy digest of an envelope's version-1 body designates version 1. Providers MUST NOT match legacy digests against any other version.
- Existing pins holding a legacy digest stay valid. A provider upgrades such a pin to a version reference only after verifying the legacy digest against the stored document and version 1's body.
- Legacy digests MAY be stored or sent without the `sha256-` prefix (bare 43-character base64url). A legacy reference compares after adding the prefix; a version reference MUST carry it.
- A legacy document is hashed as it always was (a permissive parse, then canonical form). It migrates to version 1 only if it also passes §3; a legacy line whose document fails §3 (for example a non-integer number) stays legacy, and its existing pins stay valid.
- **Publication order.** Serving an envelope at a URL that providers pinned as a legacy document breaks every provider that does not yet declare `artefact-versions.v1`: to them the document changed. A publisher migrating a legacy line MUST keep serving the legacy body at the URL until its known dependents declare the feature, and MUST serve the envelope at `<line URL>/envelope` meanwhile. Once its known dependents declare the feature, the publisher SHOULD serve the envelope at the line URL itself, which is the end state (§2), and MUST keep `<line URL>/envelope` serving the same envelope. A provider that declares the feature MUST try `<line URL>/envelope` when the URL serves a legacy document whose digest matches a stored legacy pin.

The existing 3sln.me canonical JSON function (sorted keys by UTF-16 code unit, `JSON.stringify` scalars) produces the JCS form for every value that passes §3, so existing legacy digests of such documents are already JCS digests. It does not refuse out-of-profile values (it encodes an absent member as `undefined`), so version records use a refusing serializer (§3).

## 12. Feature declaration

| Identifier | Value | Meaning | Fallback when absent |
| --- | --- | --- | --- |
| `artefact-versions.v1` | `{}` | The provider processes envelopes and version references under this document. | Clients send legacy references only, and only for legacy artefacts. A request carrying `version` to a provider without this feature is rejected with `unsupported_artefact_version`. |
| `artefact-mirror.v1` | `{}` | The provider serves §8.4. | No mirror. |

A provider declaring `artefact-versions.v1` MUST also accept legacy artefacts and references (§11).

## 13. Conformance tests

Tests MUST cover:

- **Parsing:** duplicate members at depth, including names equal only after unescaping; raw and escaped unpaired surrogates; BOM; invalid UTF-8; every non-canonical number form in §3 rule 3 and integers beyond ±(2^53 − 1); depth and size bounds; `a` versus `a` producing one digest; NFC versus NFD strings producing different digests.
- **Canonical form:** RFC 8785 test vectors; key order with astral-plane characters (UTF-16 order, not code point order); the vectors file published alongside this document.
- **Chain:** a modified earlier body; reordered or renumbered entries; a missing middle entry; a truncated log; a `prev` mismatch; the same body served at another URL or under another kind.
- **Additivity:** each growth point accepting a valid addition and rejecting an invalid one; each frozen path; enum append with and without `extensible`; a new required field; a changed title; a reordered array.
- **Validation and failure:** every row of §7.4, with and without a stored copy; equivocation between two parties; head advance only on demand.
- **Notices:** sticky notices; retraction closing the line; new pins refused and existing pins kept; signed and unsigned retraction behaviour; a notice bound to another line.
- **Consent:** pinned-version projection; argument validation at the pinned version, including brokered tokens; silent upgrade with no delta; "updated method" delta; declined upgrade keeping the old pin.
- **Legacy:** legacy references against legacy and migrated lines; a legacy digest matching a later version is not accepted; bare and prefixed legacy digests; a legacy document failing §3 staying legacy; the `/envelope` transition.
- **Review round 1:** elided entries and per-version records (valid, wrong digest, unreachable); `__proto__` members; bidi controls in titles; `$defs` with `$anchor` or `$id`, and a dangling `$ref` filled later; a result member added at *M* withheld from grants pinned below *M*; two versions of one line compiled side by side; a forged digest from an application not freezing the line; a lagging provider accepting a retraction whose `head` is beyond its head; a mirror-only first pin refused without a recent origin notice fetch; a brokered token whose digest differs from the integration's copy.

## 14. Core amendments — proposed, unsigned

| ID | Document | Amendment |
| --- | --- | --- |
| AMD-R1 | protocol §3, §6; security | "Immutable at its URL" becomes "append-only at its URL under [artefacts](artefacts.md)". Fragment and contract updates that are additive under artefacts §6 stay at the same URL; breaking changes need a new URL. Protocol §6's "compatible new methods use a new contract version unless a defined optional-method mechanism exists" names artefacts §6.3 as that mechanism. |
| AMD-R2 | protocol §3, §4; wire profile; AMD-C2 | Fragment requests MAY carry `version` with `digest`. Grants bind (URL, version, digest), plus contract references for granted methods. Requests MAY carry `contract_versions: {<contract URL>: {version, digest}}`. |
| AMD-R3 | extensions §2, §4.1, §4.3, §7 | Extension declarations MAY carry `version` with `digest`. The "pinned once per URL for the whole provider" rule becomes the per-line head of artefacts §7.2, with enablements pinned per version. Extensions §7's disappearance rules are restated by artefacts §7.4 and §8. |
| AMD-R4 | integrations §5.3 | Brokered tokens carry `bindle.cv`, a map from contract URL to `{version, digest}` that the grant pins. Integrations validate arguments and shape results at the record with that digest. |
| AMD-R5 | events §2 | Bus manifests are append-only lines of kind `bus`. Adds the optional `slot.bus.types_extensible` member (default `false`); when `true`, readers MUST ignore records whose type they do not know. |
| AMD-R6 | protocol §3 field rules | Fragment fields MAY carry `extensible: true` (enum fields only): consumers MUST accept values not listed in the version they hold. |
| AMD-R7 | protocol §2 features | Add `artefact-versions.v1` and `artefact-mirror.v1` (§12). |
