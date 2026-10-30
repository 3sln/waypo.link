# CBOR for RPC — design spike

> **Group:** Bindle protocol (core RPC transport and integration events), with 3sln.me reference service and Parlay impact
>
> **Status:** provisional design spike (2026-10-28, revision 2), documentation only. The owner decisions recorded in §8 (owner direction and approvals relayed by the coordinator in session, 2026-10-28) fix the direction; every detail not listed there as owner-approved is a coordinator proposal. Sign-off of the profile and event details: Reviewer ___ Date ___ Outcome ___. No code, spec or DEVLOG entry was changed. Production release remains disabled. **Correction (2026-10-29):** cborg is licensed Apache-2.0 only in every published version checked, not Apache-2.0/MIT as revision 2 stated; it is therefore not vendored (the repository vendors MIT snapshots), and its strict-mode verdicts and re-encodings are kept as an offline test fixture with provenance (`tests/vectors/cbor-cborg-oracle.json`), pending an owner decision. §0 item 6, §4.5 and §7.3 are corrected in place. **Phase 5 (events) implemented locally (2026-10-29):** integration events are untagged COSE_Sign1 CWTs exactly as §5.2–§5.5 describe (`packages/core/cose.mjs`; brokering `event` key in `packages/federation/signing.mjs`; outbox and egress in `packages/runtime/integration-events.mjs`; Parlay receiver; SDK `verifyIntegrationEvent` at `@3sln/bindle/integration-events.mjs`); SET JWT delivery is removed. The 64 KiB bound (§8 item 23) is applied to the encoded message, with a 16 KiB encoded bound on configured preference value sets (size-limits spike). Resets performed in code: `integration-events-cti-v1` (outbox rows' SET `jti` discarded once per account store; rows, `seq` and generations kept) and Parlay's `shell:set-jtis` cache (deleted by the first event). Specs updated: cbor §9, integrations §6.1/§11/§13, keys §4, federation-implementation, release gates. Not done here: events §7.2 (owned by another workstream at the time), offline non-JavaScript event vectors. Format details stay provisional.
>
> **Covers:** which wire surfaces move from JSON to CBOR and which stay JSON; the deterministic CBOR profile (data model, numbers including 64-bit integers, bignums and decimal fractions, map keys, strictness, bounds); handling of numbers JavaScript cannot represent exactly; compact forms for data-intensive payloads (typed arrays, multi-dimensional arrays, tables) and the allowed-tag list; how JSON-Schema contracts describe bytes, big integers and decimals; the RPC fingerprint; media type, errors, limits, CORS; codec choice for browsers, Workers and Node; integration events as COSE_Sign1-signed CWTs; security pitfalls; spec impact, migration, tests, implementation phases and the decisions record.
>
> **Does not cover:** artefact, manifest, OAuth, JWKS or directory formats (they stay JSON, §1); signaling inter-provider batches (stay JSON, §1.4); relation events (open, §8 item 21); Parlay's own conversation ingress wire; pricing or performance budgets beyond the bounds named here.

Input: DEVLOG "2026-10-28 — Owner direction: CBOR for RPC" (better density, binary data, tables and numbers; pitfalls accepted; until the spike lands, inline binary stays base64url in JSON) and "2026-10-28 — Owner direction: CBOR numbers unrestricted; events question" (do not limit integers to the JavaScript safe range; unsafe values such as large integers and decimals need care at the application level but must not be barred). Later owner decisions the same day, relayed by the coordinator: integration events move to CBOR; artefacts and signaling stay JSON; the remaining spike recommendations are approved; artefacts, contracts and fragments are rewritten in place before release, not versioned; and the profile must not stifle CBOR's efficiency for data-intensive apps (typed arrays, tables and other compact forms), so strictness targets ambiguity and resource exhaustion, not expressiveness (§2.7, §8). Code references are to HEAD d58305f. Hosts under `.example` are placeholders.

## 0. Recommendation in one screen

1. **Scope (owner-approved 2026-10-28).** Every Bindle RPC envelope (`{version, tx, resource, contract, method, args}` and its result/error envelope) moves to CBOR on every route that carries one: the issuer `rpc_endpoint` (Bearer, DPoP, `BindleEntity` and relation-token schemes) and an integration's brokered `rpc_endpoint`. **Integration events** (integrations §6, including event-bus doorbells) move to CBOR as COSE_Sign1-signed CWTs (§5). Everything else stays JSON: OAuth and metadata endpoints, manifests, JWKS, client metadata documents, directory and identity documents, artefacts (contracts, fragments, kinds), owner console APIs, discovery (phase 1), signaling inter-provider batches, and every JWS/JWT other than integration events (signed objects, DPoP proofs, certificates, access tokens). Rationale in §1.
2. **Profile.** RFC 8949 §4.2.1 core deterministic encoding, required in both directions and verified on decode, plus Bindle rules: no indefinite lengths, text-string map keys only (except inside the COSE layer of §5), no duplicate keys, `undefined` and other simple values refused, no tags except an explicit allow-list: 2, 3 (bignums), 4 (decimal fractions), the little-endian RFC 8746 typed arrays and tag 40 row-major multi-dimensional arrays, each under exact rules (§2.1, §2.7). Tables use a plain-CBOR columnar convention declared by contracts (`x-table`), not a packing scheme. **Integers are unrestricted (owner direction 2026-10-28):** the full 64-bit range of major types 0/1, and bignums beyond it. Floats use the shortest exact form; an integral float within ±(2^53−1) is refused (it must be an integer), while integral floats outside that range stay floats; no NaN, infinities or −0 (§2.2). Because the decoder accepts exactly one encoding per value, **the received bytes are the canonical bytes**, and decode→encode is the identity.
3. **JavaScript mapping.** Integers decode to `number` when within ±(2^53−1) and to `bigint` otherwise; decimal fractions decode to an immutable codec class; nothing is ever silently rounded (§2.6). Apps and providers must handle `bigint` and decimals deliberately (§3).
4. **Contracts.** Contract documents stay JSON Schema. New subset keywords: `x-type: "bytes"` (a CBOR byte string), `x-type: "decimal"`, and `x-minimum`/`x-maximum` as exact decimal strings for bounds the JSON artefact cannot write as numbers. `type: "integer"` implies no JavaScript range. Validators compare exactly, never through `Number` (§2.5). Contracts are rewritten in place before release (owner direction 2026-10-28): `object-storage/v1` and item-classification v1 gain byte fields at their existing URLs.
5. **Transport (owner-approved).** `Content-Type` and `Accept` `application/vnd.bindle.rpc+cbor` (project-private). Envelope `version` stays `"0"`. HTTP status rules unchanged. Error envelopes are CBOR. Bound: 1,500,000 **encoded** bytes (§4).
6. **Codec (owner-approved).** A small strict in-house codec (`packages/core/cbor.mjs`, standalone copy in the SDK), about 500 lines with bignums, decimals, typed arrays and the COSE_Sign1 layer. `cborg` only as an offline oracle: it is Apache-2.0 only, so it is not vendored; its strict-mode verdicts are checked in as a fixture with provenance (correction 2026-10-29). No `cbor-x` (§4.5).
7. **Migration (owner-approved).** Clean break, no dual stack, no runtime flag. Destructive resets are listed with the phase plan (§7.2, §7.4).

## 1. Scope: what moves, what stays

### 1.1 Inventory of wire surfaces (HEAD)

| Surface | Today | Where | Decision |
| --- | --- | --- | --- |
| Consumer RPC, Bearer | JSON, `JSON.parse` (lenient: last duplicate wins, no depth bound), ≤1,500,000 bytes | `packages/federation/http.mjs` `jsonBody`; SDK `tokens.mjs` `sendRPC`/`boundedJSON`, `identity.mjs` `rpc` | **CBOR** |
| Consumer RPC, DPoP (device grant, member RPC, event-bus held reads) | JSON, `JSON.parse` | `packages/runtime/routes/federation.mjs` `dpopRpc`; SDK `device.mjs` | **CBOR** |
| Relations RPC (`BindleEntity`, relation tokens) | JSON, `JSON.parse` | `packages/runtime/routes/relations.mjs` `rpc` | **CBOR** |
| Brokered RPC (consumer → integration) | JSON, strict I-JSON (`parseRPC`) | `apps/parlay/worker/http.mjs`, `packages/messaging-protocol/wire.mjs` | **CBOR** (owner-approved) |
| Runtime outer error path on `/bindle/rpc` | JSON `{error,message}` | `packages/runtime/http.mjs` | **CBOR** on that path |
| Integration events (and event-bus doorbells on that channel) | SET JWT, `application/secevent+jwt`, RFC 8935 push | integrations §6, events §7.2 | **CBOR: COSE_Sign1 CWT** (owner decision 2026-10-28, §5) |
| Relation events | JWS `bindle-relation-event+jwt`, RFC 8935-style push | organizations §9.9 | JSON/JWS for now; alignment open (§8 item 21) |
| Integration discovery (`/bindle/resources`) | JSON, strictJSON | integrations §4 | JSON (phase 1; revisit, §1.4) |
| OAuth (`/oauth/token`, revoke, device authorization) | form in, JSON out | auth, device-authorization | JSON (standard) |
| Authorization request API, owner APIs (`/api/oauth/requests`, `/api/preferences`, `/api/grants`) | JSON | federation-implementation HTTP flow | JSON (console and login plumbing; unsafe numbers as strings, §3.4) |
| Manifests, JWKS, client metadata, directory, `identity.json` | JSON | protocol §2, organizations §3a | JSON (metadata by standard; browsers and crawlers) |
| Artefacts (contracts, fragments, kinds) and their digests | JSON, RFC 8785 JCS over strict I-JSON | artefacts §3–§4 | JSON (owner decision, §1.3) |
| Signed objects carried in RPC | compact JWS over strict JSON | keys §2–§3 | JWS unchanged (§1.4) |
| Signaling provider-to-provider batches | `application/vnd.bindle.signaling+json`, arrays of JWS | signaling §9.1 | JSON (owner decision, §1.4) |
| Signaling client-to-provider | ordinary RPC on the signaling contract | signaling contract section | CBOR by inheritance |
| Storage object URLs (`/bindle/objects/…`) | raw bytes | storage service | unchanged |
| Parlay conversation ingress | multipart with JSON parts and JWS | messaging | unchanged (app protocol, out of core scope) |

### 1.2 Boundary rule

**CBOR where Bindle defines the payload as contract-typed data exchanged between Bindle parties (RPC, and the integration event channel that carries RPC-shaped snapshots). JSON where an external standard defines the format, where the bytes are hashed or signed as published documents, or where the reader is a browser, crawler or human.**

### 1.3 Artefacts stay JSON (owner decision 2026-10-28)

Contracts, fragments and kinds are published documents fetched by browsers and mirrors and read by people and JSON Schema tooling; artefacts §3 already removed the disagreement-prone parts of JSON. They contain no binary. A contract document describes CBOR values (§2.5) without itself being CBOR. Before release they are rewritten in place when their content changes (owner direction 2026-10-28); their pinned digests change with them (§7.2).

### 1.4 What else stays JSON, re-examined

Same lens as for events (consistency, binary payloads, numbers):

- **Signaling batches (owner decision: stay JSON).** They are JSON arrays of JWS strings whose signatures cover JSON payloads; moving them means a second signed-object profile for no number or binary need (signaling `data` is base64url inside a signed JWS payload and stays so).
- **Signed objects inside RPC** (leg certificates, offers, move statements, signed intents) stay compact JWS strings carried as CBOR text strings. Keys §3.4 already says a verifier verifies the **received** segments and never re-serializes, so nothing changes.
- **Discovery** (`/bindle/resources`): descriptors, URLs and small safe-range limits; no bytes, no big numbers. JSON in phase 1; it is the one candidate to revisit once integrations speak CBOR for RPC and events anyway.
- **OAuth, JWT access tokens, DPoP proofs, JWKS, manifests and metadata** stay JSON by external standards (RFC 6749, 9068, 9449, 7517, 8414 and the protocol §2 metadata rules).
- **Owner console APIs** stay JSON: the readers are our own pages; unsafe numbers cross that boundary as strings (§3.4).

## 2. Encoding profile ("Bindle CBOR")

### 2.1 Data model

| CBOR | Allowed | JavaScript value |
| --- | --- | --- |
| Major 0/1 (unsigned/negative integer) | full range: 0 … 2^64−1 and −1 … −2^64 | `number` if within ±(2^53−1), else `bigint` |
| Major 2 (byte string) | definite length | `Uint8Array` (a copy, not a view of the request buffer) |
| Major 3 (text string) | definite length, valid UTF-8, no lone surrogates, no noncharacters (same rule as `strict-json` `scalarString`) | `string` |
| Major 4 (array) | definite length | `Array` |
| Major 5 (map) | definite length, text-string keys only, no duplicates | null-prototype-safe plain object; keys defined, never assigned (`__proto__` is data) |
| Major 6, tags 2/3 (bignums) | only for integers beyond the 64-bit range (§2.2) | `bigint` |
| Major 6, tag 4 (decimal fraction) | normalized form only (§2.2) | `BindleDecimal` (codec class, §2.6) |
| Major 6, tags 69–71, 72, 77–79, 84–86 (RFC 8746 typed arrays, little-endian) | §2.7 | `Uint16Array`, `Uint32Array`, `BigUint64Array`, `Int8Array`, `Int16Array`, `Int32Array`, `BigInt64Array`, float16 array, `Float32Array`, `Float64Array` |
| Major 6, tag 40 (RFC 8746 multi-dimensional array, row-major) | §2.7 | `{shape, data}` codec object |
| Major 6, any other tag | **refused** | — |
| Major 7 | `false`, `true`, `null`; float16/32/64 under §2.2 | `boolean`, `null`, `number` |
| Major 7 others | `undefined`, other simple values, break (0xff) refused | — |

**Tag policy: no tag is accepted unless this table allows it.** The allow-list, its rationale and the tags considered and refused are in §2.7. In short: dates are integers (milliseconds since the epoch, as object storage `modifiedAt` already is), so no tags 0/1; no tag 32 URIs; no bigfloats (tag 5, §2.2); no Packed CBOR, string references or library record extensions; no tag 55799 self-describe prefix; no tag 18/61 in RPC bodies (the event layer of §5 is untagged too). A later need adds a tag by a profile revision, never by a contract.

### 2.2 Numbers

**Integers (owner direction 2026-10-28: no JavaScript-range limit).**

1. An integer in −2^64 … 2^64−1 MUST use major type 0/1 with the shortest head (§4.2.1). The 9-byte head carries the full 64-bit range.
2. An integer outside that range MUST use tag 2 (value n ≥ 2^64) or tag 3 (value −1−n, n ≥ 2^64), whose content is a definite-length byte string holding n big-endian **without leading zero bytes**. Together these mean: content length ≥ 9 and first byte ≠ 0x00. A bignum that fits major 0/1 (for example `c2 41 01`) or has a leading zero is refused. This is RFC 8949 §3.4.3 preferred serialization made mandatory.
3. Bignum content is bounded to **128 bytes** (|n| < 2^1024, more than 308 decimal digits). This is a resource bound like depth or item count, not a semantic limit; it caps `BigInt` construction and decimal conversion cost per item (proposed value).

**Decimal fractions (tag 4): allowed (recommended, in line with the owner's "do not bar unsafe decimals").** The content is `[exponent, mantissa]`, value = mantissa × 10^exponent. Rules that make each value have exactly one encoding:

4. The exponent is a major 0/1 integer (RFC 8949 §3.4.4 forbids a bignum exponent), **negative**, and ≥ −1,024 (proposed resource bound).
5. The mantissa is a major 0/1 integer or a bignum under rules 1–3, is **non-zero** and **not divisible by 10** (no trailing zeros).
6. Consequently a decimal whose value is integral is never a decimal: it is an integer (rules 1–2), and zero is the integer 0. So `[-1, 15]` (1.5) is the only encoding of 1.5 as a decimal; `[-2, 150]`, `[0, 15]`, `[1, 15]` and `[-1, 0]` are refused.

Decimals carry value, not scale: 1.50 and 1.5 are the same decimal. A contract that needs a fixed scale (currency) states it (§2.5) or uses integer minor units, which remain the recommended money representation.

**Bigfloats (tag 5): not allowed (recommended).** No contract or consumer needs binary floating values beyond float64; they would add a second binary-float type overlapping float64 with its own normalization rule (odd mantissa). Add by profile revision if a use appears.

**Floats.**

7. Floats use preferred serialization: the shortest of float16, float32, float64 that represents the value exactly (§4.2.1). Decoders refuse a longer form than necessary (owner-approved).
8. NaN, +∞, −∞ and −0.0 are refused (encode and decode). Subnormals are allowed. NaN and infinities have no JSON counterpart for owner surfaces and no contract use; −0 would be a second zero.
9. **Numeric reduction only within ±(2^53−1)** (revised; accepted by the owner as the plan, 2026-10-28). A float whose value is an integer with magnitude ≤ 2^53−1 is refused; that value MUST be encoded as an integer. A float with a larger integral value (for example 1e20, `fb 4415af1d78b58c40`) stays a float.

**Why rule 9 replaces "reduce every integral float".** The rule exists so that one JavaScript value has one encoding. In JavaScript, `1` and `1.0` are the same `number`, so within the safe range a float and an integer would decode to the same value; refusing the float keeps decode→encode the identity. Outside the safe range the two are already different JavaScript types: the integer 2^60 decodes to `2n**60n` (`bigint`, exact), the float 2^60 decodes to `1152921504606846976` (`number`, an approximation). Reducing that float to an integer (as dCBOR does up to 64 bits) would change its JavaScript type on the round trip (`number` in, `bigint` out) and would assert an exactness the float never had; reducing 1e300 would produce a 125-byte bignum. Not reducing at all would force JavaScript senders to mark floats explicitly, because `Number.isInteger(1.0)` is true. Rule 9 is exactly the line JavaScript draws, so the JavaScript encoder needs no hints: a safe-integer `number` or any `bigint` is an integer, every other `number` is a float. Typed-language encoders need one hook (an integral float within ±(2^53−1) is written as an integer) and decoders one check; vectors cover both edges (2^53−1 and 2^53, both signs).

Diagnostic examples (hex):

| Value | Encoding | Decodes to |
| --- | --- | --- |
| 2^53−1 | `1b 001fffffffffffff` | `9007199254740991` |
| 2^53 | `1b 0020000000000000` | `9007199254740992n` |
| 2^64−1 | `1b ffffffffffffffff` | `18446744073709551615n` |
| −2^64 | `3b ffffffffffffffff` | `-18446744073709551616n` |
| 2^64 | `c2 49 010000000000000000` | `18446744073709551616n` |
| 1.5 (decimal) | `c4 82 20 0f` | `BindleDecimal` 1.5 |
| 1.5 (float) | `f9 3e00` | `1.5` |
| 2.0 (float) | `f9 4000` | refused (must be `02`) |
| 1 as bignum | `c2 41 01` | refused (must be `01`) |

A decimal 1.5 and a float 1.5 are different data items of different types; each has one encoding. Schemas decide which a field accepts (§2.5).

### 2.3 Deterministic and strict decoding

Senders MUST emit core deterministic encoding (RFC 8949 §4.2.1): shortest heads for integers and lengths, definite lengths, map keys sorted by the bytewise order of their encoded form (shorter keys first; this differs from the JSON canonical form's UTF-16 key order, and nothing persists across the break), plus the number rules of §2.2.

Receivers MUST refuse, before using any value:

- non-shortest heads (integers, lengths, floats);
- indefinite lengths and stray breaks;
- maps whose keys are not text strings, are out of order, or repeat (an out-of-order check also catches duplicates);
- any tag not allowed by §2.1; a typed array, tag 40 or tag 4 item that breaks §2.7 or §2.2; a tag 2/3 whose content is not a byte string, has a leading zero, is shorter than 9 bytes or longer than 128; a tag 4 that is not a two-element array meeting §2.2 rules 4–6; any tag directly enclosing another tag, except tag 4 around a bignum mantissa and tag 40 around a typed array;
- `undefined` or an unassigned simple value; scalar NaN, ±∞, −0.0 (typed arrays: NaN only, §2.7); an integral float within ±(2^53−1);
- trailing bytes after the top-level item;
- a declared length larger than the bytes remaining (checked **before** allocation; a map of n pairs needs at least 2n remaining bytes, an array at least n);
- nesting deeper than 32 (a tag counts as a level), more than 65,536 entries in one container, more than 131,072 data items in one message (a typed array counts as one item; its elements are bounded by the message size) (proposed values);
- the top-level item not being a map.

With these rules exactly one byte sequence decodes to each accepted value, so a deterministic re-encoding of the decoded value equals the received bytes, and implementations may hash either.

### 2.4 Fingerprints

Protocol §5 says the fingerprint covers resolved resource, contract, method and canonical args. Today it is `SHA-256(canonical(JSON))` over `{resource, addressedResource, contract, method, args, scope, epoch, resourceGeneration, …}` (`packages/federation/runtime.mjs`; also `packages/core/engine.mjs` and `packages/federation/object-urls.mjs`).

Proposal: `SHA-256("bindle-rpc-fingerprint-v1" ‖ 0x00 ‖ dCBOR(map))` with the same members, where dCBOR is the §2 encoder. The JSON `canonical()` cannot be reused: it renders a `Uint8Array` as `{"0":…,"1":…}` (a byte string and a look-alike map would collide) and `JSON.stringify` throws on `bigint`. Because the encoder writes a safe-range `bigint` exactly as the equal `number`, engine callers that pass `5n` or `5` get the same fingerprint. The fingerprint is provider-internal; the spec states only the equality semantics ("same decoded value under the Bindle CBOR profile"), and the exact construction lives in federation-implementation. Every stored fingerprint changes (§7.2).

### 2.5 Contracts: JSON Schema to CBOR

| Schema | Accepts | JavaScript value |
| --- | --- | --- |
| `type: "integer"` | major 0/1 and tags 2/3; **no implied range** | `number` or `bigint` |
| `type: "number"` | integers as above, and floats; never a decimal | `number` or `bigint` |
| **`x-type: "decimal"`** | tag 4 and integers (major 0/1, tags 2/3, because integral decimals are encoded as integers); never a float. A node with `x-type` MUST NOT also have `type`. | `BindleDecimal`, `number` or `bigint` |
| `type: "string"` (and `format`, `pattern`, `minLength`/`maxLength` in code points) | major 3 only; never a byte string | `string` |
| **`x-type: "bytes"`** with optional `minLength`/`maxLength` in **bytes** | major 2 only | `Uint8Array` |
| **`x-type: "typed-array"`** with required `x-element` (`"i8"`, `"u16"`, `"u32"`, `"u64"`, `"i16"`, `"i32"`, `"i64"`, `"f16"`, `"f32"`, `"f64"`) and optional `minItems`/`maxItems` in **elements** | the one §2.7 tag for that element type; never a plain array or a byte string (`u8` data is `x-type: "bytes"`) | the matching typed array |
| **`x-type: "ndarray"`** with required `x-element` and optional `x-shape` (array of positive integers or `null` per dimension) | tag 40 under §2.7 | `{shape, data}` |
| **`x-table`** on a `type: "object"` node: `{"columns": {name: column schema}, "maxRows": n}` | a map with exactly the declared columns, each an array or typed array, all of equal length ≤ `maxRows` | object of columns |
| `type: "object"` | major 5 only; a `Uint8Array`, typed array or `BindleDecimal` is not an object | object |
| `const`/`enum` | compared by deterministic encoding, not `JSON.stringify` | — |

**Ranges beyond what the artefact can write.** Contract documents are JSON artefacts whose own numbers stay within ±(2^53−1) (artefacts §3). So bounds outside that range, and decimal bounds, use **`x-minimum`/`x-maximum`**: exact decimal strings matching `^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$`, inclusive. A node MUST NOT carry both `minimum` and `x-minimum` (or both maxima). Examples:

- int64: `{"type":"integer","x-minimum":"-9223372036854775808","x-maximum":"9223372036854775807"}`
- uint64: `{"type":"integer","minimum":0,"x-maximum":"18446744073709551615"}`
- a handler that wants plain `number`s: `{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}` (the validator then guarantees `typeof v === "number"`)
- an amount: `{"x-type":"decimal","minimum":0,"x-maximum":"1000000"}`

A fixed-scale keyword for decimals (for example `x-maxScale`) is deferred until a contract needs it.

**Validators** (`compileContractVersion` and the native validator in `packages/federation/schema.mjs`, which today checks `Math.abs(item) > Number.MAX_SAFE_INTEGER` and `Number.isSafeInteger`):

- type tests use `typeof v === "number" || typeof v === "bigint"` for integers (with `Number.isInteger` for numbers) and `instanceof BindleDecimal` for decimals, never `Number.isInteger` alone;
- comparisons are exact: `bigint`/`number` relational operators in JavaScript compare mathematical values exactly, so integer bounds work directly; decimal values and decimal-string bounds compare by scaling both to a common power of ten as `bigint`; a float against a decimal bound compares as an exact rational (`m × 2^e` against `d × 10^k`, cross-multiplied in `bigint`); **no comparison ever goes through `Number(x)` or `parseFloat`**;
- `multipleOf` on integers uses `bigint` remainder when the value is a `bigint`; on floats it is unchanged;
- `x-type`, `x-minimum` and `x-maximum` join `x-methods`/`x-permissions` in the supported set. Generic JSON Schema tools ignore them, so Bindle validators remain authoritative. `contentEncoding` stays unsupported so that base64 text and bytes cannot be confused.

**Existing contracts.** In the working tree, 25 of the 66 `type: "integer"` nodes under `docs/artefacts` have no maximum, so under the new rule they accept 64-bit and bignum values. Since contracts are rewritten in place before release (owner direction 2026-10-28), each gets an explicit bound where its handler assumes a `number`, and a contract lint warns on unbounded integers. Bytes-native fields are written in place too: `object-storage/v1` `data` becomes bytes in `get`/`put` (owner direction 2026-10-28: no v2), and item-classification v1 `item.data` becomes bytes (≤262,144) coordinated with the classifier workstream (owner-approved). Protocol §6's "immutable at its URL" rule is suspended for this pre-release rewrite by owner direction; the spec change must say so.

### 2.6 Codec value types (JavaScript)

- **Integers.** The decoder reads 9-byte heads with `DataView.getBigUint64`, then returns a `number` when the value is within ±(2^53−1) and a `bigint` otherwise (for major 1 the value is −1−n, so n = 2^53−1 yields −2^53, a `bigint`). Bignums decode to `bigint` from their bytes. The encoder accepts `number` (safe integer or non-integral finite float) and `bigint` of any size up to the bignum bound; a safe-range `bigint` encodes exactly like the equal `number`, so decode yields a `number` (the one deliberate type normalization, which keeps the identity rule on bytes). An unsafe integral `number` encodes as a float (§2.2 rule 9); senders that mean an exact large integer pass a `bigint`.
- **`BindleDecimal`.** An immutable (frozen) class exported by the codec with `mantissa` (always `bigint`) and `exponent` (a negative `number`). `BindleDecimal.from(string)` parses an exact decimal literal and returns the normalized result (a `number`/`bigint` when the value is integral, by §2.2 rule 6); `toString()` returns the exact plain decimal. `valueOf` and `Symbol.toPrimitive` throw for a numeric hint and `toJSON` throws, so arithmetic or `JSON.stringify` cannot silently coerce it. No arithmetic is provided; apps that compute bring their own decimal library and convert through strings.
- **No precision loss.** Neither direction ever passes a value through a lossy conversion. The encoder refuses −0, NaN, ±∞, unsafe values it cannot classify, and objects of other classes.
- **Structured clone.** `bigint` survives structured clone and Workers RPC; a `BindleDecimal` instance does not survive as a class instance. Values crossing isolates (route → Durable Object) travel as encoded CBOR bytes, which journal storage needs anyway (§6 item 4).
- **Typed arrays and tag 40.** Decoded into fresh aligned buffers as native typed arrays (§2.7); the encoder emits the matching little-endian tag for a typed array value and refuses `Uint8ClampedArray` and `Uint8Array` as typed arrays (a `Uint8Array` is a byte string). Tag 40 values are a frozen `{shape, data}` codec object.
- **COSE mode.** The event layer (§5) decodes maps with integer keys at its top level only (COSE headers, CWT claims) into `Map`s; nested maps keep the text-key rule. RPC bodies never use this mode.

### 2.7 Compact forms for data-intensive payloads (owner direction 2026-10-28)

Owner direction: the profile must not stifle CBOR's efficiency for data-intensive apps (numeric tables, embeddings, large structured transfers). Strictness targets **ambiguity** (two encodings of one value) and **resource exhaustion**, not expressiveness. Each candidate was judged on: does every value keep exactly one encoding (so the received bytes stay canonical and the fingerprint stays a hash of them, §2.4); can a strict decoder bound its cost before allocating; codec size; browser and Worker performance; and how a contract declares it.

**Fingerprint rule (decided by this design).** The profile only admits forms whose encoding is unique per value. Fingerprints and replay therefore keep hashing the received (equivalently, re-encoded) bytes, with no unpacking step. A form whose encodings are not unique (packing, string references) is admitted only together with a mandatory deterministic algorithm that makes them unique again; none is admitted now.

**Recommended allowed-tag list:**

| Tag | Meaning | Rules |
| --- | --- | --- |
| 2, 3 | bignums | §2.2 rules 1–3 |
| 4 | decimal fraction | §2.2 rules 4–6 |
| 69, 70, 71 | uint16, uint32, uint64 arrays, little-endian (RFC 8746) | below |
| 72 | sint8 array | below |
| 77, 78, 79 | sint16, sint32, sint64 arrays, little-endian | below |
| 84, 85, 86 | float16, float32, float64 arrays, little-endian | below; NaN refused |
| 40 | multi-dimensional array, row-major (RFC 8746 §3.1.1) | below |

**(a) Typed arrays (RFC 8746): allow, little-endian only.** The content is a definite-length byte string whose length is a multiple of the element size; the bytes are the elements, so there is no per-element head. A float32 embedding of 1,536 dimensions costs 6,144 bytes plus a 4-byte head, against up to 7,680 bytes as a plain CBOR array of float32 items (and 9 bytes per item where a value needs float64), and decodes as one copy instead of 1,536 head parses. Determinism rules:

- **One tag per element type.** Little-endian only (the byte order of every platform JavaScript engines run on, so the copied buffer is used directly as a `Float32Array` etc.); the big-endian tags 65–67, 73–75, 80–83 are refused. Tag 64 (uint8) and 68 (clamped uint8) are refused because a uint8 array is a byte string (major 2, `x-type: "bytes"`); allowing both would give one value two encodings. Float128 (83, 87) is refused: no JavaScript type. Tag 76 is reserved by RFC 8746.
- **Floats carry exact IEEE bit patterns.** NaN is refused in any payload (many bit patterns, one meaning). −0 and ±∞ are allowed inside typed arrays because each is one bit pattern that round-trips exactly through `Float32Array`/`Float64Array`; the scalar rule (§2.2 rule 8) stays as it is for JSON-facing reasons. No shortest-form rule applies: the element type is the schema's choice, and a float64 array whose values fit float32 is still a float64 array.
- **A typed array and a plain array are different data items.** The schema decides which a field takes; there is no reduction between them.
- **Decode cost.** The length check precedes allocation; the decoder copies the bytes into a fresh, aligned `ArrayBuffer` (it copies byte strings anyway) and scans float arrays once for NaN. uint64/sint64 arrays decode to `BigUint64Array`/`BigInt64Array` (exact); float16 arrays decode to `Float16Array` where the runtime has it and otherwise to a codec wrapper over the bytes.

**Multi-dimensional arrays (tag 40): allow, row-major only.** Content `[dimensions, elements]`: `dimensions` an array of 1–8 positive integers whose product (computed in `bigint`, bounded) equals the element count; `elements` a typed array (as above) or a plain array. Column-major tag 1040 is refused (a second encoding of the same matrix). Tag 41 (homogeneous array) is refused: schemas already express homogeneity. This covers batches of embeddings and dense numeric matrices.

**(b) Tables and structs.**

- **Columnar convention in plain CBOR (recommended; contract-level, no tag).** A table is a map from column name to a column, each column an array or typed array, all of equal length: `{"id": <uint64 array>, "name": ["a","b",…], "score": <float32 array>}`. Keys appear once, numeric columns use typed arrays, and the encoding is fully deterministic with no new codec feature. Row-major alternatives (`{"columns": [...], "rows": [[...], ...]}`) are also plain CBOR and deterministic; contracts may use either, the columnar form is recommended for numeric data.
- **Packed CBOR (draft-ietf-cbor-packed): not now.** At the time of writing it is an expired Internet-Draft (revision 19, "Revised I-D Needed — Issue raised by WGLC"), not an RFC. It uses simple values 0–15 and tag 6 for shared-item references, tags 128–143 and tag 6 for argument references, tags 113/1113 for table setup and further function tags. A value has many valid packings (the draft defines unpacking as deterministic, not packing), references can expand far beyond the received size, and the draft names no mandatory expansion limit (it suggests a 20–40 indirection limit). Adopting it would need: fingerprints over the dCBOR encoding of the **unpacked** data model (so received bytes are no longer canonical), hard bounds on expanded bytes, expanded item count and reference depth, and roughly doubling the codec. The columnar convention plus typed arrays recover most of its density for the tables Bindle contracts carry. Revisit if it becomes an RFC and a measured payload needs it.
- **String references (tags 25/256): not now.** They are first-come IANA registrations from an external specification, not IETF standards. An encoder chooses which repeated strings to reference, so encodings are not unique unless a greedy "reference every eligible repeat" rule is mandated; they also make decoding stateful. Their main benefit, repeated map keys in row-oriented arrays of maps, is removed by the columnar convention.
- **Record extensions (cbor-x "records", tag 105 with private-range record tags): never.** They are one library's non-standard extension, not an IETF or IANA-standard mechanism; revision 19 of the Packed CBOR draft even uses tag 105 for a different function, which shows the collision risk.

**(c) Dates and URIs: not allowed.** Tag 1 (epoch time, integer or float) and tag 0 (RFC 3339 text, many spellings of one instant) would add second encodings of values the profile already carries as integer milliseconds; tag 32 (URI) would add a second encoding of a text string that contracts already constrain with `format: "uri"`. Neither adds density or expressiveness.

**Codec and performance.** The allow-list adds about 80 lines (typed-array tag table, length and NaN checks, tag 40 shape check). Typed arrays are the cheapest data items to decode in a browser or Worker: one bounds check and one copy, then a native view. No feature on the list needs decoder state across items, so the decoder stays a single linear pass.

**Contract declarations** are in §2.5 (`x-type: "typed-array"`, `x-type: "ndarray"`, `x-table`).

## 3. Handling unsafe numbers

"Unsafe" here means a value JavaScript `number` cannot hold exactly: integers beyond ±(2^53−1) (`bigint`) and decimals (`BindleDecimal`). The profile carries them exactly; mistakes happen afterwards. Guidance for apps, the SDK and providers (normative wording to land in `docs/spec/cbor.md` and the SDK guide):

### 3.1 In code

- **Never coerce.** No `Number(x)`, unary `+`, `parseInt`, `parseFloat`, `Math.*` or `Intl.NumberFormat#format(Number(x))` on a `bigint` or decimal. `Number(2n**64n + 1n)` rounds silently. Mixed `bigint` + `number` arithmetic throws a `TypeError`; treat that as a bug signal, not something to "fix" with `Number()`.
- **Type tests.** An integer field may be `number` or `bigint` unless its contract bounds it to the safe range. Handlers either declare that bound (the validator then guarantees `number`) or handle both types.
- **Equality and keys.** `1n === 1` is false and `new Map` treats `1n` and `1` as different keys. The codec normalizes decoded values, but app-built values may be `bigint`; compare or key by the deterministic encoding or by decimal string.
- **Large integral floats are approximations.** 1e20 in a `type: "number"` field is a float; if a contract needs an exact large integer it says `type: "integer"` and senders pass a `bigint`.
- **Money.** Prefer integer minor units with explicit bounds; use `x-type: "decimal"` when a decimal value is genuinely needed; never floats.

### 3.2 Storage

- Durable Object storage clones `bigint` correctly but not `BindleDecimal`; store decimals as their string or as encoded CBOR.
- D1 and SQLite store signed 64-bit integers; uint64 values above 2^63−1 do not fit, and JavaScript drivers may return lossy `number`s above 2^53. Store unsafe values as TEXT (exact decimal string) or as BLOB (encoded CBOR, or fixed-width big-endian when ordering matters; decimal strings do not sort numerically).
- Node's record store serializes with `JSON.stringify` (`apps/node/resources.mjs`), which **throws** on `bigint`. Retained RPC results are stored as encoded CBOR bytes (§6 item 4); any other record holding contract values needs the same treatment or an explicit string mapping.

### 3.3 Display

- Format `bigint` with `BigInt.prototype.toLocaleString` or `Intl.NumberFormat#format(bigint)`; format decimals by passing their exact string to `Intl.NumberFormat#format` (string inputs are formatted exactly) or by rendering `toString()` directly.
- UI inputs that accept such values parse to `bigint`/`BindleDecimal.from` and reject what does not parse exactly; never round on entry.

### 3.4 JSON-facing surfaces

Owner console APIs (`/api/preferences`, `/api/grants`, authorization requests), audit exports, logs, and any JSON a provider emits: `JSON.stringify` throws on `bigint` and on `BindleDecimal` (by design), so a stray value fails loudly. At each JSON boundary:

- render integers beyond ±(2^53−1) and all decimals as **decimal strings**, with the API schema saying which members are strings for that reason (I-JSON, RFC 7493 §2.2, forbids such numbers as JSON numbers);
- use an explicit per-field mapping, not a global replacer that would also stringify values a reader expects as numbers;
- the reverse path (owner edits a preference in the console) parses the string back with the same exact parser before validation.

**Denial of service.** A request that puts a `bigint` into a field later passed to `JSON.stringify` (a log line, a Node row, an audit record) would make that path throw. Contract bounds prevent it for bounded fields; handlers of unbounded fields must not pass values into JSON-only sinks. Provider counters, quotas and metrics never take unbounded caller-supplied integers.

## 4. Transport

### 4.1 Media type and versioning (owner-approved)

- Request `Content-Type: application/vnd.bindle.rpc+cbor`; `Accept` the same. Responses carry the same type, plus the existing `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- A Bindle-specific type lets routes dispatch before decoding, gives a clear 415, and cannot be mistaken for another CBOR body; the `+cbor` suffix (RFC 8949 §9.5) keeps generic tooling working. It is project-private, like `application/vnd.bindle.signaling+json`; registration waits for publication authority.
- Envelope `version` stays the text `"0"`. A JSON body gets 415.
- No manifest negotiation member now. If a second encoding is ever needed, add `rpc_media_types` to the manifest then.

Example request in diagnostic notation:

```
{"tx": "2f17cceb-7cae-49cd-ae13-1aad1ceab264", "args": {"key": "app/directory.json"},
 "method": "get", "version": "0", "contract": "https://3sln.me/artefacts/contracts/object-storage/v1",
 "resource": "https://example.org/entities/e_123/resources/r_456"}
```

(Keys appear in deterministic order: shorter encoded keys first.) `tx` stays a text UUID: it is logged, compared and shown in tooling as text, and changing its type touches every journal key.

### 4.2 Errors and status codes

HTTP status rules are unchanged: 400 malformed envelope (now including any profile violation), 401, 403, 413 body too large, 415 wrong media type, 429 with `Retry-After`, 200 for contract errors in the error envelope. Every body the RPC route generates is CBOR: the result/error envelope `{"version":"0","tx":…,"error":{"code":…,"message":…}}` and route-level errors `{"error":code,"message":…}`. Platform-generated responses (a CDN 502 page) can still be anything, so clients decode only when the response `Content-Type` matches and otherwise report a transport failure.

Finding while reading: the relations route maps `tx_conflict`/`conflict` to 409 and `indeterminate` to 503, while core RPC returns those in a 200 envelope (protocol §5). The CBOR change should not widen this; reconcile separately.

### 4.3 Size limits (owner-approved)

Bounds are on encoded bytes: request and result ≤1,500,000 bytes, checked while streaming the body (as `readBody` does now) and again before sending a result. Descriptor `maxRequestBytes`/`maxResultBytes` count encoded CBOR bytes. A 1 MiB object travels in about 1,048,600 bytes instead of about 1,398,200 base64 characters. `maxObjectBytes` keeps counting decoded bytes.

### 4.4 CORS and browsers

RPC requests are already non-simple (an `Authorization` header, often `DPoP`, and `application/json`), so they are preflighted today. The new media type adds no preflight; `Access-Control-Allow-Headers` already covers `Content-Type`. `fetch` sends a `Uint8Array` body and reads `arrayBuffer()`/a stream; nothing needs a browser CBOR API. The `/bindle/rpc` error path that sets `Access-Control-Allow-Origin: *` for bearer requests must emit CBOR too. `bigint` is available in every supported browser, Workers and Node.

### 4.5 Codec choice (owner-approved)

| Option | For | Against |
| --- | --- | --- |
| **Own minimal strict codec** (chosen) | Exactly the profile, about 500 lines including bignums, decimals, typed arrays and COSE_Sign1; auditable in one sitting; same pattern as `strict-json.mjs`/`jcs`; one module for Worker, Node and the standalone SDK; no tag or extension machinery to disable | We own float16 conversion, bignum and decimal normalization and the edge cases; mitigated by vectors, fuzzing and an oracle |
| `cborg` | Designed for deterministic IPLD use; documented strict options (minimal encoding, duplicate-key rejection, no indefinite lengths, tag allow-list); decodes 64-bit integers beyond the safe range as `bigint`; Apache-2.0 (not dual-licensed; corrected 2026-10-29) | Larger than the profile; defaults differ (maps vs objects, tag handling), so a wrapper still enforces §2.2 rule 9, decimal normalization and the item caps; options must be verified against the pinned version |
| `cbor-x` | Fastest JavaScript codec; MIT | Extensions on by default or easy to enable; lenient decoding by design; no strict-deterministic decode mode. Not suitable as the trust boundary. |

Own codec in `packages/core/cbor.mjs` (the SDK re-exports it from `packages/sdk/src/cbor.mjs`). `cborg` is Apache-2.0 only in every version checked, so it is not vendored under `vendor/` (which holds MIT snapshots) and is never imported from runtime, SDK or test code (the generator runs offline against a separately installed copy). Its strict-mode verdicts and re-encodings for a generated corpus are recorded offline as `tests/vectors/cbor-cborg-oracle.json`, with provenance (version, tarball URL, integrity, licence) and the generator script; whether to vendor it awaits an owner decision (correction 2026-10-29).

Performance: decoding is a linear scan with `TextDecoder` for strings and `slice` for bytes; on Workers a 1.5 MB message costs single-digit milliseconds of CPU. Bignum and decimal decoding is linear in their (bounded) content. Workers RPC between the route and Durable Objects passes encoded bytes (§2.6).

## 5. Integration events in CBOR (owner decision 2026-10-28)

The owner decided that integration events (integrations §6) move to CBOR. This section designs the signed event; its details are provisional until the profile is signed off.

### 5.1 Why (the case the decision rests on)

- **Consistency.** A `preferences-updated` event's `values` equals what the integration's preferences/v2 RPC read returns (integrations §6.2). With RPC in CBOR, that read can carry bytes, 64-bit integers, bignums and decimals. A JSON SET would need a second, lossy JSON projection of the same snapshot (base64 for bytes, strings for big numbers) and a rule for comparing it with the RPC read. In CBOR the event snapshot and the read are the same data model and the same codec.
- **One encoding for integrations.** Integrations already decode the Bindle CBOR profile for brokered RPC (owner-approved). Events in CBOR remove the remaining strict-JSON path from the integration surface.
- **Numbers.** `seq` and `generation` counters, and contract values in snapshots, follow the unrestricted integer rule without a JSON range exception.
- **What is given up.** RFC 8417 SET semantics and RFC 8935 tooling (generic SET receivers, JWT libraries everywhere). Integrations need a COSE verifier; the SDK provides one, and libraries exist in common languages (for example go-cose, coset for Rust, pycose, .NET `System.Security.Cryptography.Cose`). JSON SETs are better known; that was the case for keeping them, and the owner weighed it.

**Alternative rejected: CBOR payload inside the existing JWS.** A JWS whose payload is base64url of CBOR keeps JWT tooling for the signature but loses it for the payload, restores the base64 cost the change removes, and mixes two encodings in one object. COSE_Sign1 signs CBOR natively.

### 5.2 Format

A delivery is a `POST` of one **untagged COSE_Sign1** (RFC 9052 §4.2) whose payload is a **CWT claims set** (RFC 8392), `Content-Type: application/cwt`. The structure is `[protected, unprotected, payload, signature]`:

| Element | Exact content |
| --- | --- |
| `protected` | byte string containing the deterministic encoding of exactly `{1: -7, 4: kid, 16: "application/vnd.bindle.integration-event+cwt"}`: `alg` ES256, `kid` as the UTF-8 bytes of the brokering JWK's `kid`, and `typ` (RFC 9596) |
| `unprotected` | the empty map `{}` (no header parameters may sit outside the signature) |
| `payload` | byte string (never `nil`: no detached payloads) containing the claims set below |
| `signature` | byte string of exactly 64 bytes: ECDSA P-256/SHA-256 `r ‖ s`, which is WebCrypto's output format and the same as JWS ES256 |

Claims set (a map; integer labels per RFC 8392 at the top level, text keys elsewhere; deterministic order puts integer labels first):

| Label | Claim | Value |
| --- | --- | --- |
| 1 | `iss` | the issuer origin (as the SET `iss` today) |
| 2 | `sub` | the entity |
| 3 | `aud` | exactly the integration's `events_endpoint` |
| 6 | `iat` | integer seconds |
| 7 | `cti` | 16 random bytes, the same across retries of one event (replaces `jti`) |
| `"events"` | Bindle | a map with exactly one member: event type identifier → payload map (integrations §6.2 and events §7.2 unchanged in content; `connection`, `generation`, `seq` present) |

No other claims. Freshness stays the `iat` window, so no `exp`/`nbf`. Proposed size bound: 64 KiB encoded (integrations §6 states none today; relation events use 32 KiB).

Signing input is the RFC 9052 `Sig_structure` `["Signature1", protected, external_aad, payload]`, deterministically encoded, with **`external_aad` = the UTF-8 bytes `bindle-integration-event-v1`**. The verifier supplies the same constant, so a signature made for any other COSE profile, even one that forgot its `typ`, does not verify here. A COSE `Sig_structure` begins with the array byte `0x84` and the string "Signature1", so it can never equal a JWS signing input (base64url ASCII) made with the same key.

### 5.3 Keys and algorithm pinning

- The signing keys are the existing **brokering key set** (integrations §5.3), published as JWKS (JSON, unchanged), P-256. Purposes stay separated by distinct `kid` per purpose (as for `at+jwt` today) plus the COSE `typ` and `external_aad`. Keys §4 gains a row: integration event, COSE_Sign1, separation by protected `typ` plus `external_aad` domain string.
- `alg` is read **only** from the protected header and MUST be exactly −7, and the key MUST be a P-256 key from the brokering key set of the issuer recorded for the connection. Fully-specified algorithm identifiers (ESP256, from the JOSE/COSE fully-specified algorithms work) are the cleaner pin; adopt them once the registry value is confirmed and libraries support it. Until then, −7 plus the mandatory curve check is equivalent.
- Refused: any other or additional header parameter, `crit`, counter signatures, `x5chain`/`x5t` or any key material in headers (keys are never taken from the message), COSE_Sign, COSE_Mac0, tags 18/61, detached payloads.
- Signers emit low-S signatures (as link-meta issuance already does); verifiers accept either and never deduplicate or key on signature bytes (deduplication is by `cti`).

### 5.4 Verification order

The integration MUST, in this order:

1. Check `Content-Type` and the size bound; decode the outer array strictly (§2.3 rules, no tags, COSE mode for the header map only).
2. Decode `protected`; it must be exactly the three-member map above with the expected `typ`; `unprotected` must be `{}`; `signature` must be 64 bytes.
3. Decode `payload` strictly (top-level integer labels allowed, nested maps text-keyed); it must be exactly the claims set above. (As with JWT today, claims are read before verification to find the connection; strict decoding bounds that work.)
4. The connection is known for (`iss`, `connection`); if unknown, reject without a fetch.
5. Verify the signature over the `Sig_structure` built from the **received** `protected` and `payload` bytes (never a re-encoding), under the integrations §5.5 step 2 key rules.
6. `aud`, `sub` and the `iat` window as integrations §6.1 steps 4–6.

A `cti` already processed is answered 202 and not reprocessed.

### 5.5 Delivery semantics

Delivery keeps RFC 8935's shape: `POST`, 202 on acceptance, 400 as a permanent rejection, anything else retried; every attempt re-signed with a new `iat` and the same `cti`; retry, outbox, coalescing and degradation rules of integrations §6.3–§6.4 unchanged; response bodies bounded to 4 KiB. A 400 body MAY be a CBOR map `{"err": text, "description": text}` using the RFC 8935 error codes, `Content-Type: application/cbor`; the provider reads at most the code for audit. Because the body is not a SET, the spec must say "modelled on RFC 8935", not "conforms to".

### 5.6 Cost

- **Implementation:** about 120 lines on top of the codec (COSE mode maps, `Sig_structure`, header checks, WebCrypto `ECDSA`/`P-256`/`SHA-256` sign and verify; no DER conversion, since WebCrypto already uses `r ‖ s`). One SDK helper `verifyIntegrationEvent` for integrations.
- **Vectors:** COSE working group ES256 Sign1 examples for the generic layer; Bindle event vectors produced by one non-JavaScript COSE implementation offline and checked in.
- **Keys:** none new; the JWKS and rotation rules are reused.
- **Integrator cost:** a COSE library or the SDK helper instead of a JWT library; partly offset because they already need the CBOR codec for RPC.

## 6. Security pitfalls

1. **Strictness is the boundary.** Every refusal in §2.3 happens in the codec, before any value reaches validation, authorization, the journal or event processing. No route may decode with a lenient decoder "for errors only". Today's core RPC routes use plain `JSON.parse` (last duplicate wins); the CBOR codec closes that gap.
2. **Allocation and number cost.** Check every declared length against the remaining input before allocating; never pre-size arrays from a header; count items globally; reject a 9-byte head declaring 2^64 items in O(1). Bignum content (≤128 bytes) and decimal exponents (≥ −1,024) are bounded so that `BigInt` construction, comparison against bounds and decimal-string rendering stay cheap; validators must never expand 10^exponent beyond the bound.
3. **Type confusion.** JSON-era checks treat any non-array object as an object: `object()` in `packages/federation/schema.mjs` returns true for a `Uint8Array`, `same()` in `compileContractVersion` uses `JSON.stringify`, and `canonical()` renders bytes as an index map. Before bytes, `bigint` or decimals are accepted anywhere: object checks use a plain-object test (`strict-json` `plain`), bytes are checked only via `x-type`, decimals only via `x-type: "decimal"`, integer checks accept `bigint`, equality uses the deterministic encoding, and no `string` check accepts bytes (or the reverse).
4. **Storage of results.** Node's record store serializes values with `JSON.stringify` (`apps/node/resources.mjs`), which would corrupt a retained `Uint8Array` and throw on a `bigint`; Durable Object storage clones bytes and `bigint` but not `BindleDecimal`. Retain journal results as their encoded CBOR bytes (an opaque blob, base64 inside Node JSON rows) on both adapters, which also replays byte-identical responses.
5. **Compact-form bounds.** Typed-array lengths are checked against remaining input and element size before allocation; tag 40 shape products are computed in bounded `bigint` and must equal the element count; no admitted form references earlier data, so there is no expansion beyond the received size (the reason Packed CBOR and string references are out, §2.7).
6. **Silent precision loss.** The worst failure is not a crash but a `Number()` somewhere between decode and use. Validators and the SDK never convert; §3 is the app guidance; tests include values at 2^53±1 and 2^64±1 through every built-in contract that takes integers.
7. **Logging and redaction.** Providers SHOULD NOT log payloads. Error messages must never echo decoded values or raw bytes; diagnostic notation is for local development only; audit metadata stays text (contract, method, tx, status, sizes).
8. **Brokered and event parity.** Integrations decode with the same profile. A lenient integration decoder cannot change provider fingerprints, but it can disagree with the provider on what a request meant; the conformance suite tests integrations' RPC and event verification.
9. **Event signatures.** §5.3 pinning and §5.4 order; signature over received bytes; `external_aad` domain; keys never from the message.
10. **Content sniffing.** Responses keep `nosniff` and `no-store`; clients refuse responses whose media type is not the RPC type.

## 7. Specs, migration, tests, phases

### 7.1 Specs and sections to change

| Document | Change |
| --- | --- |
| New `docs/spec/cbor.md` (or a section of `keys.md`) | The Bindle CBOR profile of §2 (numbers, tags, decoder requirements), §3 handling rules, COSE mode, vectors reference |
| `docs/spec/protocol.md` §5, §6 | CBOR envelope, media type, diagnostic example, error envelope encoding, encoded-byte bounds, fingerprint equality semantics; §6 conformance adds decoder strictness; §6 note that pre-release artefacts are rewritten in place |
| `docs/spec/federation-implementation.md` | HTTP flow step 7; CORS/bounds (encoded bytes, 415); persistence (fingerprint construction, retained results as bytes) |
| `docs/spec/contracts.md` | `x-type: "bytes"`, `x-type: "decimal"`, `x-minimum`/`x-maximum`, integer semantics without implied range, exact comparison rule; descriptor limits count encoded bytes; object store v1 `data` as bytes |
| `docs/spec/artefacts.md` | Artefacts remain JSON (their own numbers stay safe-range); contract schema subset gains the new keywords; pre-release in-place rewrite |
| `docs/spec/extensions/integrations.md` | §5 brokered RPC and §5.5 validation use the CBOR profile; §4 discovery stays JSON (stated); **§6 events rewritten as COSE_Sign1 CWTs (§5)**; §11 item 4 `typ` list; §13 event conformance |
| `docs/spec/extensions/events.md` | §7.2 doorbells ride the COSE event channel; transport by inheritance |
| `docs/spec/keys.md` | §4 row for the integration-event COSE profile; one line: signed objects inside CBOR are text strings, §3.4 unchanged |
| `docs/spec/extensions/item-classification.md` | §3 `item.data` as bytes. **Owned by the classifier workstream; coordinate, do not edit from here** |
| `docs/spec/extensions/signaling.md` | Contract section: transport by inheritance; §9 batches stay JSON; `data` stays base64url inside JWS (stated) |
| `docs/spec/extensions/device-authorization.md`, `organizations.md` (relations RPC) | Transport by inheritance; one line each. Relation events unchanged pending §8 item 21 |
| `docs/spec/extensions/messaging.md` (Parlay) | Mailbox and intake RPC over CBOR; intake `message.parts` may become bytes, rewritten in place |
| `docs/3sln/services/storage.md` | Presign stays (browser-native fetch, objects beyond the RPC bound, ranges); inline bytes cover small objects |
| `docs/spec/security.md`, `docs/3sln/release-gates.md` | Decoder strictness, number handling and fuzzing as a release gate; COSE event verification conformance |

Inline bytes do not replace presigned URLs: an `<img src>`, a download or a 100 MB classifier input still needs a URL.

### 7.2 Migration and destructive resets

**Clean break, no dual stack, no runtime flag (owner-approved).** A flag or dual stack doubles the parsing surface that §6 hardens and keeps the lenient JSON path alive. Destructive resets (accepted pre-release; each logged in DEVLOG when performed):

- **RPC journals and retained results** (fingerprint construction and result storage change).
- **Object-URL mint records** (fingerprints change).
- **Artefact digests and pins for rewritten contracts** (`object-storage/v1`, item-classification v1, Parlay intake if changed, and contracts given explicit integer bounds): `artefacts.lock.json` regenerated; stored grants, authorization requests and artefact pins that reference a rewritten contract's old digest are reset or re-pinned.
- **Integration event state:** pending outbox entries are markers re-derived at send time and survive; any stored signed-but-undelivered SET attempt is discarded; integration-side processed-`jti` caches (Parlay worker included) are reset, since `cti` replaces `jti`. Connection `seq` and generation counters are kept.

Unaffected: preferences values, connection records, signing keys and JWKS.

### 7.3 Test strategy

- **Vectors** (`tests/vectors/cbor-profile.json`, hex plus expected value or expected refusal): RFC 8949 Appendix A cases inside the profile; integers at 2^53−1, 2^53, 2^63, 2^64−1 and their negatives; bignums at 2^64 and the 128-byte bound; decimals; one refusal vector per §2.3 rule (non-shortest heads, indefinite items, unsorted/duplicate/integer keys, each disallowed tag, nested tag, bignum that fits 64 bits, leading-zero bignum, oversized bignum, decimal with non-negative exponent, typed array with a big-endian or uint8 tag, typed array length not a multiple of the element size, NaN in a float array, tag 40 shape mismatch, column-major tag 1040, Packed CBOR and string-reference tags, trailing-zero mantissa, zero mantissa, bignum exponent, `undefined`, integral float within the safe range, NaN, ±∞, −0.0, trailing byte, truncation, length bomb, depth 33).
- **Properties (seeded, engine-level preference):** random profile values (including random `bigint`s and decimals) round-trip; decode(x) succeeds ⇒ encode(decode(x)) = x; every truncation is refused; random byte mutations are refused or obey the identity; validators agree with an exact rational reference on random values against random bounds.
- **Cross-implementation:** the offline `cborg` oracle fixture (strict mode; not vendored, Apache-2.0 only) agrees on accept/refuse and bytes for the generated corpus where its feature set overlaps (differences triaged against the RFC); vectors from one non-JavaScript deterministic encoder checked in as fixtures; COSE WG Sign1 ES256 examples and offline-produced Bindle event vectors.
- **Fuzzing:** a bounded seeded fuzz run in `npm test`; a longer run before release as a gate.
- **Transport and events:** existing RPC tests (journal, tx_conflict, indeterminate, bounds, revocation) over CBOR; 415 for JSON; 413 on encoded size; schema tests for `x-type`, `x-minimum`/`x-maximum` and the type-confusion cases of §6; Worker and Node adapters both store byte and `bigint` results; event tests for every §5.4 refusal (wrong `typ`, extra header, unprotected parameter, wrong `alg`, wrong curve, wrong `external_aad`, detached payload, tampered payload, replayed `cti`); browser fixture with the standalone SDK against local Wrangler.

### 7.4 Implementation phases

1. **Codec.** `packages/core/cbor.mjs` and the SDK copy: profile, bignums, `BindleDecimal`, typed arrays and tag 40, COSE mode; vector file; `cborg` oracle verdicts as an offline fixture (not vendored); property and fuzz tests. Spec: `docs/spec/cbor.md`.
2. **RPC envelope and journal fingerprint.** Federation `http.mjs`, runtime `dpopRpc`, relations and member RPC, outer error path, fingerprint construction, journal result storage as bytes, contract validators (plain-object checks, exact numbers, encoding-based `const`/`enum`). Protocol §5 and federation-implementation edits in the same change. *Resets: RPC journals, retained results, object-URL mint records.*
3. **SDK and clients.** SDK `sendRPC`/`rpc`/device client, SDK test double (`packages/sdk/src/testing.mjs`), Parlay web client, `bigint`/decimal handling and JSON-boundary mapping in owner UIs.
4. **Brokered RPC.** Parlay worker and `messaging-protocol` `parseRPC`; integrations §5 edits.
5. **Events (COSE).** Provider event signer, SDK `verifyIntegrationEvent`, Parlay worker receiver; integrations §6, events §7.2 and keys §4 edits. *Resets: undelivered signed SET attempts, integration-side `jti` caches.*
6. **Contract `x-type: "bytes"` and in-place rewrites.** `x-type` (`bytes`, `decimal`, `typed-array`, `ndarray`), `x-table`, `x-minimum`/`x-maximum` in both validators; `object-storage/v1` `data` as bytes; item-classification `item.data` (coordinated with the classifier workstream); explicit integer bounds on the 25 unbounded nodes; Parlay intake parts if wanted. *Resets: artefact lock and digests, pins in grants and authorization requests for rewritten contracts.*
7. **Conformance.** Protocol §6 additions, integration RPC and event conformance, release-gate entry (strictness, numbers, fuzzing, COSE).

## 8. Decisions record

Owner direction and approvals were given in session on 2026-10-28 and relayed by the coordinator. "Provisional" rows are coordinator proposals awaiting sign-off.

| # | Question | Decision | Status |
| --- | --- | --- | --- |
| 1 | Brokered RPC to integrations moves too? | Yes, same envelope family and profile | Owner-approved 2026-10-28 |
| 2 | Integration events become CBOR? | Yes: untagged COSE_Sign1 over a CWT claims set (§5) | Owner decision 2026-10-28; format details (§5.2–§5.5) provisional |
| 3 | Signaling inter-provider batches become CBOR or COSE? | No, stay JSON/JWS | Owner decision 2026-10-28 |
| 4 | Artefacts (contracts, fragments) become CBOR? | No, stay JSON | Owner decision 2026-10-28 |
| 5 | Media type | `application/vnd.bindle.rpc+cbor`, project-private | Owner-approved 2026-10-28 |
| 6 | Bump envelope `version`? | No, stays `"0"` | Owner-approved 2026-10-28 |
| 7 | Float form | Shortest exact form (preferred serialization) | Owner-approved 2026-10-28 |
| 8 | Integral floats | Refused only within ±(2^53−1) (must be integers); larger integral floats stay floats (§2.2 rule 9) | Accepted by the owner as the plan 2026-10-28 |
| 9 | Integer range | Full 64-bit range of major 0/1; bignums (tags 2/3) beyond, preferred serialization mandatory | **Owner direction 2026-10-28** (supersedes the earlier ±(2^53−1) proposal) |
| 10 | Bignum size bound | 128-byte content | Provisional (resource bound) |
| 11 | Decimal fractions (tag 4) | Allowed, normalized (negative exponent ≥ −1,024, mantissa non-zero and not divisible by 10, integral values as integers) | Allowed per owner direction ("do not bar unsafe decimals"); rules provisional |
| 12 | Bigfloats (tag 5) | Not allowed; add by profile revision if needed | Provisional |
| 13 | NaN, infinities, −0 | Refused | Provisional (retained from revision 1) |
| 14 | Contract numeric keywords | `type: "integer"` without implied range; `x-type: "decimal"`; `x-minimum`/`x-maximum` as exact strings; exact validator comparison | Provisional |
| 15 | Own codec or library? | Own strict codec; `cborg` test-only oracle (kept as an offline fixture, not vendored: Apache-2.0 only, corrected 2026-10-29; vendoring pending an owner decision) | Owner-approved 2026-10-28 |
| 16 | Clean break or flag? | Clean break, no flag | Owner-approved 2026-10-28 |
| 17 | `object-storage` bytes | Rewrite `object-storage/v1` in place with `data` as bytes; no v2 | **Owner direction 2026-10-28** (supersedes the v2 proposal) |
| 18 | Pre-release artefact changes | Artefacts, contracts and fragments are rewritten in place, not versioned or kept as withdrawn-but-resolvable | Owner direction 2026-10-28 (general rule) |
| 19 | Item-classification `item.data` as bytes | Yes, coordinated with the classifier workstream | Owner-approved 2026-10-28 |
| 20 | RPC bound | 1,500,000 bytes, counted encoded | Owner-approved 2026-10-28 |
| 21 | Relation events (organizations §9.9) to COSE too? | Recommended: yes, same COSE_Sign1 profile with its own `typ` (`application/vnd.bindle.relation-event+cwt`), `external_aad` and the certification key, in a later phase; JWS until decided | **Open** |
| 22 | Discovery (`/bindle/resources`) | JSON in phase 1; revisit after events land | Provisional |
| 23 | Event size bound | 64 KiB encoded | Provisional |
| 24 | Compact forms | Profile stays rich: strictness targets ambiguity and resource exhaustion, not expressiveness | **Owner direction 2026-10-28** |
| 25 | Allowed-tag list | 2, 3, 4; typed arrays 69–71, 72, 77–79, 84–86 (little-endian only; no 64/68, no big-endian, no float128); tag 40 row-major. Refused: 0, 1, 32, 1040, 41, Packed CBOR (draft, not RFC), string references 25/256, cbor-x records, every other tag | Provisional (recommended under item 24) |
| 26 | Fingerprint with compact forms | Only unique-encoding forms are admitted, so fingerprints keep hashing the received bytes; a non-unique form would need fingerprints over the unpacked data model plus a deterministic packing rule | Provisional |
| 27 | Tables | Plain-CBOR columnar convention declared with `x-table`; typed arrays for numeric columns; `x-type: "typed-array"`/`"ndarray"` | Provisional |
