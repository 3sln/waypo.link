# Bindle CBOR profile — normative draft

> **Group:** Bindle core
>
> **Status:** draft, 2026-10-29, implemented locally and provisional. Owner-approved points (CBOR spike §8, owner direction and approvals relayed in session, 2026-10-28): RPC moves to CBOR, including brokered integration RPC; media type `application/vnd.bindle.rpc+cbor`, project-private; envelope `version` stays `"0"`; clean break with no JSON fallback and no flag; the 1,500,000-byte bound counted in encoded bytes; unrestricted integers with bignums beyond 64 bits; decimal fractions allowed; shortest-form floats, with integral floats refused only within ±(2^53 − 1); a strict in-house codec. Everything else here (the allowed-tag list, the resource bounds, the decimal and bignum limits, refusing scalar NaN, ±∞ and −0, the JavaScript mapping) is a coordinator proposal awaiting sign-off. The codec is `packages/core/cbor.mjs` (re-exported by the SDK as `packages/sdk/src/cbor.mjs`); the RPC wire helpers are `packages/core/rpc-wire.mjs` (`packages/sdk/src/rpc-wire.mjs`). Nothing is production-verified.
>
> **Covers:** the deterministic CBOR profile every Bindle RPC body uses: data model, numbers, allowed tags, decoder refusals, resource bounds, the JavaScript value mapping and handling rules for numbers JavaScript cannot hold exactly, fingerprint equality, and a summary of the RPC transport.
>
> **Does not cover:** the RPC envelope and status rules ([protocol §5](protocol.md#5-rpc-transport)); the fingerprint construction and journal storage ([OAuth and RPC wire profile](federation-implementation.md#persistence-and-scaling)); how contracts describe CBOR values ([contracts](contracts.md#contract-schema-keywords)); signed objects, which stay compact JWS strings ([keys](keys.md)); artefacts, manifests, OAuth, discovery and signaling batches, which stay JSON; integration events, which stay SET JWTs until the COSE phase of the spike lands.

MUST, MUST NOT, SHOULD and MAY express draft requirements.

Sign-off of the provisional points: Reviewer ___ Date ___ Outcome ___.

## 1. Encoding

Senders MUST emit [RFC 8949 §4.2.1](https://www.rfc-editor.org/rfc/rfc8949#section-4.2.1) core deterministic encoding: shortest heads for integers and lengths, definite lengths only, and map keys sorted by the bytewise order of their encoded form (shorter keys first; this is not the UTF-16 order of the JSON canonical form). The number rules of §3 apply in addition. Receivers MUST verify all of it on decode (§5). Because exactly one byte sequence decodes to each accepted value, the received bytes are the canonical bytes: re-encoding a decoded value reproduces them.

## 2. Data model

| CBOR | Allowed | JavaScript value |
| --- | --- | --- |
| Major 0/1 (integers) | full range: 0 … 2^64 − 1 and −1 … −2^64 | `number` within ±(2^53 − 1), otherwise `bigint` |
| Major 2 (byte string) | definite length | `Uint8Array` (a fresh copy) |
| Major 3 (text string) | definite length, valid UTF-8, no lone surrogates, no noncharacters | `string` |
| Major 4 (array) | definite length | `Array` |
| Major 5 (map) | definite length, text-string keys only, no duplicates | object whose members are defined, never assigned (`__proto__` is data) |
| Tags 2, 3 (bignums) | only beyond the 64-bit range (§3) | `bigint` |
| Tag 4 (decimal fraction) | normalized form only (§3) | `BindleDecimal` |
| Tags 69–71, 72, 77–79, 84–86 (RFC 8746 typed arrays, little-endian) | §4 | `Uint16Array`, `Uint32Array`, `BigUint64Array`, `Int8Array`, `Int16Array`, `Int32Array`, `BigInt64Array`, `Float16Array` (or a byte wrapper where the runtime lacks it), `Float32Array`, `Float64Array` |
| Tag 40 (RFC 8746 multi-dimensional array, row-major) | §4 | frozen `{shape, data}` object |
| Major 7 | `false`, `true`, `null`; float16, float32 and float64 under §3 | `boolean`, `null`, `number` |

Everything else is refused: any other tag, `undefined`, unassigned simple values and the break byte outside an indefinite item (indefinite items are refused anyway). Dates are integers (milliseconds since the epoch), so there are no date tags; URIs are text strings constrained by contracts, so there is no tag 32. A new tag needs a revision of this profile, never a contract.

## 3. Numbers

1. **Integers are unrestricted.** An integer in −2^64 … 2^64 − 1 MUST use major type 0 or 1 with the shortest head.
2. **Bignums.** An integer outside that range MUST use tag 2 (n ≥ 2^64) or tag 3 (value −1 − n, n ≥ 2^64) around a byte string holding n big-endian without leading zero bytes, so the content is at least 9 bytes long and does not start with 0x00. A bignum that fits major 0/1, or has a leading zero, is refused. The content is bounded to 128 bytes (a resource bound).
3. **Decimal fractions (tag 4).** The content is `[exponent, mantissa]` with value mantissa × 10^exponent. The exponent is a major 0/1 integer, negative and at least −1,024. The mantissa is a major 0/1 integer or a bignum under rule 2, non-zero and not divisible by 10. An integral value is never a decimal: it is an integer, and zero is the integer 0. Decimals carry value, not scale: 1.50 and 1.5 are the same decimal, and `[-1, 15]` is its only encoding.
4. **No bigfloats.** Tag 5 is refused.
5. **Floats** use the shortest of float16, float32 and float64 that represents the value exactly; a longer form is refused.
6. **No NaN, infinities or −0** as scalar floats, in either direction. Subnormals are allowed.
7. **Integral floats.** A float whose value is an integer with magnitude at most 2^53 − 1 is refused; that value MUST be encoded as an integer. A larger integral float (for example 1e20) stays a float. This is exactly the line JavaScript draws: a safe-integer `number` or any `bigint` encodes as an integer, every other finite `number` as a float.

| Value | Encoding (hex) | Decodes to |
| --- | --- | --- |
| 2^53 − 1 | `1b 001fffffffffffff` | `9007199254740991` |
| 2^53 | `1b 0020000000000000` | `9007199254740992n` |
| 2^64 − 1 | `1b ffffffffffffffff` | `18446744073709551615n` |
| −2^64 | `3b ffffffffffffffff` | `-18446744073709551616n` |
| 2^64 | `c2 49 010000000000000000` | `18446744073709551616n` |
| 1.5 (decimal) | `c4 82 20 0f` | `BindleDecimal` 1.5 |
| 1.5 (float) | `f9 3e00` | `1.5` |
| 2.0 (float) | `f9 4000` | refused (must be `02`) |
| 1 as a bignum | `c2 41 01` | refused (must be `01`) |

## 4. Compact forms

Strictness targets ambiguity and resource exhaustion, not expressiveness (owner direction 2026-10-28). Only forms with exactly one encoding per value are admitted, so fingerprints keep hashing the received bytes.

- **Typed arrays** (tags 69–71, 72, 77–79, 84–86): the content is a byte string whose length is a multiple of the element size, little-endian. Big-endian tags, tags 64 and 68 (a uint8 array is a byte string) and float128 are refused. NaN is refused in float arrays; −0 and ±∞ are allowed there because each is one bit pattern. A typed array and a plain array are different data items, and a float64 array whose values fit float32 stays a float64 array.
- **Multi-dimensional arrays** (tag 40, row-major): content `[dimensions, elements]`, with 1 to 8 positive integer dimensions whose product equals the element count; elements are a typed array or a plain array. Column-major tag 1040 and tag 41 are refused.
- **Tables** use a plain-CBOR columnar convention declared by the contract (`x-table`): a map from column name to an array or typed array, all of equal length.
- **Refused:** Packed CBOR (an expired Internet-Draft; packings are not unique and expansion is unbounded), string references (tags 25 and 256; encoder-chosen), library record extensions, the tag 55799 self-describe prefix.

## 5. Decoding

A receiver MUST refuse the whole message, before using any value, on:

- non-shortest heads (integers, lengths, floats);
- indefinite lengths and stray breaks;
- map keys that are not text strings, are out of order or repeat;
- any tag not allowed by §2; a typed array, tag 40 or tag 4 item breaking §3 or §4; a tag 2 or 3 whose content is not a byte string, has a leading zero, or is shorter than 9 or longer than 128 bytes; a tag directly enclosing another tag, except tag 4 around a bignum mantissa and tag 40 around a typed array;
- `undefined` or an unassigned simple value; scalar NaN, ±∞ or −0; an integral float within ±(2^53 − 1);
- trailing bytes after the top-level item;
- a declared length larger than the bytes remaining, checked before allocating (a map of n pairs needs at least 2n remaining bytes, an array at least n);
- nesting deeper than 32 (a tag counts as a level), more than 65,536 entries in one container, more than 131,072 data items in one message (a typed array counts as one item);
- a message longer than 1,500,000 bytes;
- for an RPC body, a top-level item that is not a map.

A route MUST NOT decode with a lenient decoder, not even for error reporting. Refusal messages MUST NOT echo decoded values or input bytes.

## 6. JavaScript mapping and unsafe numbers

"Unsafe" means a value a JavaScript `number` cannot hold exactly: an integer beyond ±(2^53 − 1) (`bigint`) or a decimal (`BindleDecimal`). The profile carries them exactly; implementations and apps MUST NOT lose precision afterwards.

- **Encoder.** A safe-range `bigint` encodes exactly like the equal `number`, so it decodes as a `number` (the one deliberate type normalization). An unsafe integral `number` encodes as a float (§3 rule 7); senders that mean an exact large integer pass a `bigint`. Values of other classes are refused.
- **`BindleDecimal`** is immutable, with a `bigint` mantissa and a negative exponent. `BindleDecimal.from(text)` parses an exact decimal literal (returning an integer when the value is integral); `toString()` renders it exactly. Numeric coercion and `JSON.stringify` throw. It does not survive structured clone as a class instance, so values crossing isolates or stored durably SHOULD travel as encoded CBOR or as decimal strings.
- **Never coerce.** Code MUST NOT pass a `bigint` or decimal through `Number()`, unary `+`, `parseInt`, `parseFloat` or `Math.*`. An integer field may hold `number` or `bigint` unless its contract bounds it to the safe range; handlers either declare that bound or handle both types. Equality and map keys SHOULD use the deterministic encoding or a decimal string (`1n === 1` is false).
- **Money** SHOULD be integer minor units with explicit bounds; `x-type: "decimal"` where a decimal is genuinely needed; never floats.
- **Storage.** SQLite and D1 hold signed 64-bit integers; unsafe values are stored as exact decimal text or as encoded CBOR.
- **JSON-facing surfaces** (owner console APIs, MCP, automation, audit exports, logs) render integers beyond ±(2^53 − 1) and all decimals as decimal strings through an explicit per-field mapping, and bytes as base64 at their own boundary. A handler of an unbounded field MUST NOT pass its value into a JSON-only sink. Providers SHOULD NOT log payloads.
- **Display** formats a `bigint` with `toLocaleString` or `Intl.NumberFormat#format(bigint)` and a decimal through its exact string.

Implementation note (3sln.me): RPC adapters decode maps as `Object.prototype` objects whose members are defined, not assigned, which is the shape `JSON.parse` gave handlers; the codec's own default is null-prototype maps. When encoding handler results, an object member whose value is `undefined` is omitted, as `JSON.stringify` did; an `undefined` anywhere else is refused.

## 7. Fingerprints

Two RPC requests are the same for transaction deduplication exactly when their fingerprinted members (protocol §5) are the same decoded value under this profile. Because the profile admits one encoding per value, an implementation may hash the deterministic encoding. The 3sln.me construction, a domain-separated SHA-256 or keyed HMAC over the encoding, is in the [OAuth and RPC wire profile](federation-implementation.md#persistence-and-scaling).

## 8. RPC transport summary

Every Bindle RPC request, result or error envelope, and every route-level error on an RPC endpoint, is one map in this profile, sent with `Content-Type` and `Accept` `application/vnd.bindle.rpc+cbor` (project-private; registration waits for publication authority). This holds for the issuer RPC endpoint under every authorization scheme and for an integration's brokered `rpc_endpoint`. A request with any other media type, JSON included, is answered 415; one longer than 1,500,000 encoded bytes 413; any decoding refusal 400. Clients decode a response only when its `Content-Type` is the RPC type and otherwise report a transport failure. Details are in [protocol §5](protocol.md#5-rpc-transport).

## 9. COSE mode

The codec has a mode in which the top-level map may use integer labels and decodes to a `Map`, reserved for COSE headers and CWT claims of integration events. RPC bodies never use it. Integration events are not yet CBOR.

## 10. Vectors and tests

Accept and refuse vectors are in `tests/vectors/cbor-profile.json`, exercised by `tests/cbor.test.mjs` together with seeded round-trip, truncation, mutation and fuzz properties. `tests/vectors/cbor-cborg-oracle.json` records offline verdicts and re-encodings of the cborg library in strict mode, with provenance; cborg itself is not vendored (it is Apache-2.0 only, and vendoring awaits an owner decision).
