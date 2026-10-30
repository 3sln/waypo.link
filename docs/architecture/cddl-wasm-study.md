# CDDL via Rust and WebAssembly — design study

> **Group:** Bindle protocol (contract, integration-event and event-bus schemas), with 3sln.me reference-service runtime impact
>
> **Status:** provisional design study (2026-10-29), documentation only. It was run on the owner's 2026-10-29 direction (DEVLOG "Owner directions: CDDL study, sample apps and multi-provider simulation release gate"). The recommendation (§9) is a coordinator proposal: nothing here is owner-approved. No product code, `package.json`, vendored file or spec was changed. Sign-off: Reviewer ___ Date ___ Outcome ___.
>
> **Covers:** whether the MIT-licensed Rust crate `cddl` (anweiss/cddl), compiled to WebAssembly, can replace the in-house JSON-Schema-subset validators (`compileContractVersion` in `packages/federation/integrations.mjs`, the `x-*` keywords in `packages/federation/contract-values.mjs`, and `packages/events/schema.mjs`) for Bindle wire data: RPC arguments and results, integration events and event-bus payloads. It covers how the crate was built, a feature coverage matrix against six contracts from this repository, Node and workerd measurements, differential and hostile-input testing, a maintenance assessment, and a recommendation with an integration or fallback plan.
>
> **Does not cover:** other CDDL implementations (the Ruby `cddl`/`cddlc` reference tools, JavaScript libraries), which were not evaluated; artefact, manifest and OAuth formats, which stay JSON documents; production deployment (nothing was deployed). All measurements are local, on one Apple-silicon laptop. They are not production-verified.

## 0. Result in one screen

- **CDDL as a language fits Bindle better than our JSON Schema subset.** Choices replace `if`/`then`/`else`. Tags, typed arrays, tag 40, bignums and decimal fractions are native. Dependent members can be written as group choices, and maps are closed by default. Every contract we transcribed could be expressed, apart from the cross-field rules no schema language here expresses (§3.3).
- **The `cddl` crate (0.10.7) is not fit to be the production validator today.** Measured defects, each confirmed by a test:
  1. *Unsound map matching.* When a member shares its name with the rule that types it (`key: key`), a missing required member is accepted. Group choices in maps accept members that only another alternative allows. Optional groups (`? ( … )`) are treated as required.
  2. *wasm32 integer bug.* Integer literals above 2^32 − 1 fail to parse on wasm32, so `0..9007199254740991` (our safe-integer bound) cannot be written. Native builds parse it.
  3. *Regular expressions.* `.regexp` is not anchored, against RFC 8610, so `"https://.*"` accepts `javascript:https://x`. Escapes such as `\w` and `\x00` are mangled before compilation.
  4. *Remote-triggerable panic on profile-valid CBOR.* A byte string where a text literal is expected (`{method: h'00'}`) panics, and the panic traps the wasm instance.
  5. *Error messages format the payload.* A rejection embeds the value, which leaks it unless the binding scrubs the message. Rejecting one 1.4 MB request against a six-way choice took 323 ms of CPU and grew linear memory to 71 MB.
  6. *Lenient internal decoder.* It accepts `undefined`, non-shortest heads and duplicate keys. It allocates declared lengths before checking them and recurses without a depth limit, so the strict codec must always run first.
  7. *Missing or broken features.* `.cborseq` does not parse. `~` unwrap inside maps fails. Non-default feature sets do not compile.
- **Size and speed are acceptable; robustness is not.** Size: 2.26 MB raw, 0.43 MB brotli; 1.69 MB / 0.41 MB after `wasm-opt -Oz`. Instantiation is cheap. Small validations take about 0.3 ms in both Node and workerd. A 120,000-item array takes about 200 ms, twice the configured 100 ms CPU limit.
- **Recommendation (§9): fall back to an in-house *narrow Bindle CDDL profile*.** It would be a JavaScript validator over values already decoded by the strict codec, about 1,500 lines plus tests. The Rust crate stays a development-time cross-check, never shipped. "Adopt with patches" is costed in §9.2 and not recommended.

## 1. Candidate and build

| Item | Value |
| --- | --- |
| Crate | `cddl` 0.10.7 (crates.io, published 2026-08-10), the latest release on 2026-10-29 |
| Crate checksum | sha256 `c5251326096ece604213e731457558294e178c9560fe3885436a1e465250edbe` (crates.io index; matches the downloaded `.crate`) |
| Upstream commit | `938a931dd96db1d75425f0015921aacfb628fc94` (`.cargo_vcs_info.json`) |
| Licence | MIT (`LICENSE` in the crate; crates.io metadata `MIT`). Compatible with the AGENTS.md vendoring rule. |
| CBOR decoding | `ciborium-ll` 0.2.2, via the crate's own `Value` tree (`src/validator/cbor_value.rs`) |
| Toolchain | rustc 1.101.0-nightly (2026-09-30); `wasm32-unknown-unknown`; `opt-level = "s"`, LTO, `codegen-units = 1`, `panic = "abort"` |
| Bindings | `wasm-bindgen` 0.2.129, with `wasm-bindgen-cli` 0.2.129 installed into the scratchpad (`--root`). `--target web` output loads in both Node and workerd. |
| Features | `std`, `ast-span`, `cbor`, `json`, `additional-controls`. Builds without `ast-span`, or without `additional-controls`, fail to compile (§7). |

Local environment notes: the Homebrew `cargo` 1.92 has no wasm32 standard library, and the rustup `rust-lld` could not find `libLLVM.dylib`. The build therefore used the rustup nightly toolchain directly, with a scratch linker wrapper that sets `DYLD_LIBRARY_PATH`. No global configuration was changed.

**Binding.** This is the minimal API asked for, in a study crate (`binding/src/lib.rs` in the scratchpad):

- `compile(text) -> handle`. Parse failures return 0, and `last_error()` holds a schema-only message.
- `validate_cbor(handle, rule, bytes) -> JSON`. On failure the result is `{ok:false, errors:[{path, reason}], count}`; on success, `{ok:true}`.
- `validate_json(handle, rule, text)`, for comparison.
- `free(handle)`.

Two upstream limitations needed workarounds:

- **Named rules.** The validator always starts at the first rule. The binding clones the AST once per requested rule, moves that rule first, and caches the clone in the handle.
- **Self-referential handles.** The AST borrows its source text, so the handle owns a leaked `Box<str>` and frees it after the ASTs.

**Errors without payload values.** The crate's raw reasons echo values. For example, `expected "bob-secret-value-long" string length …` and `unexpected key Text("extra")` both came out of the smoke test. The binding therefore never returns `reason` text:

- **Reason.** It maps the text internally to a category: `type`, `missing`, `unexpected`, `size`, `range`, `pattern`, `tag`, `bits`, `embedded`, `value` or `invalid`.
- **Path.** Path segments are emitted only when they are array indexes or names that appear literally in the schema text. Data keys, such as preference field names, become `*`.

For example, `{"path":"/name","reason":"size"}`.

**Reproducibility.** Two clean builds with `--remap-path-prefix` produced byte-identical wasm (sha256 `2d43bae1…3f9`). Without remapping, the module embeds 86 absolute host paths (`/Users/…/.cargo/registry/…`) from panic locations. A vendored build must remap them. Cross-machine reproducibility was not tested.

## 2. Runtimes

- **Node 24.6.0.** `WebAssembly.Module` from bytes, then the glue's `initSync`.
- **workerd** (Miniflare from the repository's `node_modules`, compatibility date 2026-10-11, the same `CompiledWasm` module type `tests/worker/harness.mjs` uses for hash-wasm). The worker was bundled with esbuild, imported the `.wasm` as a module, and ran on loopback port 8943. It was never deployed. Every Miniflare instance was disposed at the end of the run.

Both runtimes gave the same verdicts on every case run in both.

## 3. Coverage

### 3.1 Feature probes

There were 66 probes in total (`probes.mjs`), each compiling a CDDL snippet and checking verdicts on values encoded by `packages/core/cbor.mjs`. Every result below is from the wasm build. "Native" means the CLI built from the same sources.

| Area | Works | Wrong or absent |
| --- | --- | --- |
| Maps | closed structs; `?` optional; `* tstr => any` open maps; tables `{ * tstr => T }`; cuts `"a" ^ =>`; literal-keyed group choice (`kind: "a", … // kind: "b", …`) | **Closed coverage under `//`:** `{ a: int, b: int // a: int }` accepts `{a:1, b:"x"}`. **Optional groups:** `? ( token: …, token_type: …, expires_at: … )` and `? named-group` require their members. **Member name equal to rule name:** `{ key: key, … }` with `key = tstr` accepts a map without `key` (native too; also JSON). `~` unwrap inside a map fails. |
| Groups and choices | named and inline groups; type choices; enumerations `&( … )`; type sockets `$x /=`; group sockets `$$x //=` | (see Maps) |
| Arrays | `[1*3 int]`; positional records `[int, tstr, ? bool]`; `[* int, tstr]`; `~` unwrap in arrays | README warns that occurrence matching is greedy beyond the first indicator |
| Generics | `bounded<T> = [0*4 T]` used with several arguments | — |
| Ranges and comparisons | integer and float ranges, `...`, `.lt/.le/.gt/.ge/.ne/.eq`, `.and`, `.within` | **wasm32: any literal above 2^32 − 1 fails to parse** (`0..9007199254740991`, `uint .le 9007199254740991`, `int .ge -9007199254740991`; native parses them). No ranges beyond 64 bits even natively. `uint .size (0..7)` checks the *value* against 0..7 instead of the byte length. |
| `.size` | `bstr .size`, `uint .size n`, `tstr .size` | `tstr .size` counts UTF-8 bytes (RFC 8610), while our JSON Schema `maxLength` counts code points: a semantic difference, not a bug |
| `.bits` | on `uint` and `bstr` | — |
| `.regexp` / `.pcre` | `.pcre` (the `regex` crate here, because `freezer`/`fancy-regex` is off) | **`.regexp` is not anchored** (`"[a-z]+"` accepts `abc1` and `--a--`). **Escapes mangled:** `\w` becomes `w` and `\x00` becomes `x00` (`format_regex`), so `"\\w+"` rejects `abc`. Regexes are recompiled on every validation. |
| `.cbor` | embedded CBOR in `bstr`, including a nested rule | — |
| `.cborseq` | — | **Does not parse**, although the README lists it |
| `.default` | accepted as an annotation | (no defaulting, which is correct for validation) |
| RFC 9165 | `.cat`, `.det`, `.plus` | `.abnf` accepts non-matching text (`'x = 1*3DIGIT'` accepts `ab`) |
| Bignums (tags 2/3) | `integer`, `#6.2(bstr)`, `-(2^64) - 1` | `uint` also accepts tag 2 (the RFC 8610 prelude has `uint = #0`) |
| Decimal fractions (tag 4) | `decfrac`, including a bignum mantissa; exponent bounds `#6.4([e: -2..-1, m: int])` | `number` accepts decimals (prelude: `number = int / float`). Value bounds on decimals (our `x-minimum`) cannot be expressed. |
| Typed arrays (tags 69–86) | `#6.85(bstr)`, choices of tags, size bounds in **bytes** (not elements) | — |
| Tag 40 | `#6.40([dims, data])`, and shape constraints such as `[[2, uint], #6.85(bstr)]` | — |
| Columnar tables | `{ ts: #6.79(bstr) / [* int], value: #6.86(bstr) / [* float] }` | Equal column length is not expressible (`x-table` enforces it today) |
| Float width | `float` vs `int` distinguished; `int` rejects `1.5` and `1e20` | `float16` accepts `1.1` (ciborium widens every float to f64) |
| Uniqueness | — | CDDL has no `uniqueItems` equivalent (needed for classifier label ids) |

Tally: 47 behaved as RFC 8610 and our expectations require, 10 were wrong, and 5 did not compile. Of the five, three (`range beyond 2^32`, `negative beyond 2^31`, `bignum range`) are the wasm32 integer bug; the others are `.cborseq` and, before the probe was corrected, a mistyped cut. Some probes encode documented design limits (bytes vs code points, no uniqueness, equal column lengths) and count as "works".

### 3.2 Real contracts

These were transcribed into CDDL in the scratchpad (`contracts/*.cddl`):

| Contract | Result |
| --- | --- |
| `object-storage/v1` (5-method request choice; `put` with `bstr .size (0..1048576)`; `presign` with the JSON Schema `if`/`then`/`else` rewritten as a plain choice of a read form and a write form; results) | **Does not compile on wasm32** (safe-integer range). With `safe-uint = uint` substituted: 12 of 14 correct. One miss comes from the substitution; the other is the unanchored `.regexp "https://.*"` accepting `javascript:https://x`. The `key: key` / `version: version` style also triggers the missing-member bug (§5). |
| `item-classification` `classify` args (detail-level ceilings as a three-way choice, inline-or-URL item, `bounded<T>` generics, regex tokens) | 8 of 9. `label.id` `Spam!` is accepted because `.regexp` is not anchored. "`data` is exactly `size` bytes" and "distinct label ids" are not expressible. |
| signaling message v1 (JSON JWS payload; per-`type` body choice, `seq: 0..4095`, `to` null only for invite and cancel) | 8 of 8 through `validate_json` |
| event-bus `tasks` payload, plus a record envelope `data: bstr .cbor payload` | 4 of 4 |
| `preferences/v2` result (`values: { * tstr => [0*16 reference] / non-array }`, `token` requiring `token_type` and `expires_at` as a group choice with an empty alternative) | **Does not compile on wasm32** (safe-integer range). With the substitution: 4 of 5; the miss is `token` without `token_type`, accepted (group-choice bug). |
| synthetic numeric ledger (`integer` with bignum, `decfrac`, float32 typed array, tag 40 `[[2,2], float64]`, `.bits` flags, columnar table) | 5 of 5 (unequal column lengths pass by design) |

### 3.3 What CDDL itself cannot say (any implementation)

These were enforced by handler or validator code before, and would stay so:

- equal-length columns (`x-table`);
- uniqueness (`uniqueItems`, distinct label ids);
- cross-member equality (`item.size` equals the length of `item.data`);
- exact decimal value bounds;
- typed-array element counts. CDDL can only bound them in bytes, which equals the element bound multiplied by the element width, so this one can be expressed with arithmetic.

Our current subset handles the first, the second and the fourth. A Bindle profile would need small project controls for them (§9.1).

## 4. Measurements

The Node figures are wall-clock times on a warm JIT after one first call. The workerd figures were measured both inside the isolate (`performance.now()`, which local workerd advances in 1 ms steps) and from outside (the difference between requests doing 1 and N validations). The two agree.

| Metric | Node 24.6 | workerd (local) |
| --- | --- | --- |
| Wasm size | raw 2,256,665 B; gzip −9 604,472 B; brotli −11 425,785 B | same file |
| After `wasm-opt -Oz` (binaryen 132) | raw 1,691,480 B; gzip 570,453 B; brotli 408,380 B. Dropping the crate's own `#[wasm_bindgen]` exports saves only 3%. | — |
| Module compile, cold | 1.7 ms (V8 compiles lazily) | worker `ready` 61 ms vs 52 ms for an empty control worker: about 9 ms added at startup |
| Instantiate | 0.27 ms | below 1 ms |
| Compile schema (object-storage, first) | 7.0 ms (includes JIT warm-up); ledger 0.8 ms; classify 1.0 ms | 2 ms; 1 ms; 1 ms |
| Small `put` (287 B) | 0.33 ms | 0.31–0.34 ms |
| `put` with 1 MiB `bstr` (valid) | **30 ms**. 0.4 ms against `put-args` directly; the cost comes from the `capabilities` alternative's `args: {}` building an error string that formats the 1 MiB value. | 20 ms |
| `classify` with a 256 KiB item | 3.6 ms | 4.1 ms |
| Float64/BigInt64 typed arrays, 1 MiB | 0.38 ms | 0.42–0.5 ms |
| 120,000-item plain arrays (520 KB) | **205 ms** | **203–248 ms** |
| Invalid 1.4 MB `bstr` against a six-way choice | **323 ms** | (not run) |
| Linear memory high-water mark (fresh instance about 1.8 MB) | small 1.9 MB; 1 MiB put 19.1 MB; typed 1 MiB 10.2 MB; 120k items 27.6 MB; **invalid 1.4 MB six-way choice 70.8 MB** | 32 MB after the bench |

Comparison with the Worker limits (Cloudflare limits page, read 2026-10-29: 64 MiB uncompressed bundle, 1 s startup, 128 MB per isolate including wasm):

- **Bundle size.** It fits easily: the current `.output/worker/index.js` is 8.7 MB raw (1.9 MB gzip), and the module adds 1.7–2.3 MB raw.
- **Startup.** About 9 ms is added, well under the 1 s limit.
- **CPU.** Measured against the repository's `limits.cpu_ms: 100` (`wrangler.jsonc`), a single large plain array, or a crafted invalid request, uses two to three times the whole budget.
- **Memory.** Wasm linear memory never shrinks, so one hostile request leaves the isolate about 70 MB heavier for its lifetime.

Typed arrays are the only fast path for large data.

## 5. Differential testing

**Oracle.** The oracle is the in-house `compileContractVersion` on the checked-in `docs/artefacts/object-storage-v1.json`, imported read-only. The generator (`differential.mjs`, xorshift, seed 20261029) produced 6,000 requests. They varied methods (including an unknown one), dropped or added members, and used wrong types, boundary integers (including 2^53 and 2^64 as bigints), ASCII and non-ASCII strings around 1,024, bytes around 1 MiB, and malformed conditions and ranges.

**Excluded.** 964 cases were excluded because the oracle cannot judge them: the in-house compiler fails closed with `artefact_unverifiable` on `presign`, since the published contract uses `if`/`then`/`else`, which `compileContractVersion` does not support. This is an incidental finding about the current validator.

| CDDL variant | Compared | Agree | Disagreements by cause |
| --- | --- | --- | --- |
| As transcribed (`key: key`, `version: version`) | 5,036 | 4,407 | 74 missing `key` or `version` accepted (name-collision bug); 152 more from the same collision (unclassified); 398 non-ASCII strings (bytes vs code points); 5 values ≥ 2^53 (wasm32 substitution) |
| Rule names changed (`key-t`, `version-t`) | 5,036 | 4,701 | 330 non-ASCII strings (bytes vs code points); 5 values ≥ 2^53 (wasm32 substitution) |

With the name collision avoided, every disagreement has a known cause. An earlier run of 20,000 cases showed the same pattern: 825 unexplained, all traced to the collision.

## 6. Hostile input and panic containment

`fuzz.mjs` was run with seeds 7 and 99, the latter at N = 30,000. Each value was checked against four targets: the object-storage request, the ledger entry, `any`, and a recursive node rule.

| Input class | Cases | Traps |
| --- | --- | --- |
| Values accepted by our strict codec (random nested maps, arrays, bignums, decimals, typed arrays, tag 40) | 120,000 | **32**. All 32 are one panic: `cbor.rs:4907` calls `self.state.ctrl.unwrap()` when a byte string meets a text literal without a control, e.g. `{method: h'00'}`. Reproduced natively: `called Option::unwrap() on a None value`. |
| Raw mutated bytes passed straight to the wasm decoder (28,461 of which the strict codec refuses) | 120,000 | 94 (`unreachable`, out-of-memory aborts, `Maximum call stack size exceeded`) |
| Crafted | — | A byte string of declared length 2^32 − 1, an array of 2^32 − 1 or a map of 2^28 elements traps: each is allocated before reading. 100,000 or 1,000,000 nested arrays or tags overflow the stack. The internal decoder **accepts** `undefined` (as null), non-shortest heads, duplicate keys and bignums with leading zeros. Our codec refuses every one of these. |

**Containment.**

- A trap surfaces as a JavaScript `RuntimeError` (`unreachable` or "Maximum call stack size exceeded"). It never crashed the Node process or the workerd isolate.
- After a trap, the same instance appeared to work for one call. A later `compile` on it failed with `memory access out of bounds` from inside `Box<[u8]>::from_abi`. The trapped instance is corrupt and must be discarded.
- The wasm-bindgen glue's `initSync` is a no-op once it has initialized. The study added a `__reset(module)` helper that clears the glue state and instantiates afresh (about 1.6 ms), after which verdicts were correct again.
- In production this means: always decode with the strict codec first, then validate, then re-instantiate on any trap. All compiled schemas in that instance are lost, so they need re-compiling.

## 7. Maintenance assessment (2026-10-29)

- **Activity.**
  - Releases: 0.10.2 (2026-02-11), 0.10.3 (02-24), 0.10.4 (03-18), 0.10.5 (04-02), 0.10.6 (06-29) and 0.10.7 (08-10), after long gaps (0.9.4 in 2023-12, 0.9.5 in 2025-03, 0.10.0/0.10.1 in 2025-08).
  - Repository: 137 stars, 23 open issues; last push 2026-10-25, mostly dependabot.
  - Contributors: essentially one maintainer (anweiss, 1,057 commits; the next human contributor has 30).
  - The README warns that the crate "was originally developed as a personal learning exercise … careful consideration should be made prior to using this crate" in production.
- **Self-assessment** (issue #712, "Road to 1.0"):
  - The AST and API break between releases.
  - There is no fuzz target.
  - 18 reachable `unwrap`/`panic` sites remain in production code.
  - There is no resource-limit policy (nesting, input size, regex time).
  - "CBOR/JSON map matching — the largest cluster … group-choice closed coverage."
  - The JSON and CBOR validators (4,209 and 6,088 lines) have drifted apart.
- **Relevant open issues.** #837 (a map member with a type-choice key rejects every key), #838 (regression on `main`: an undefined group socket rejects an empty map), #676 (a long correctness backlog from the `cddl-codegen` author).
- **Conformance claims.** The README claims RFC 8610 parsing and validation, plus RFC 9165 controls, RFC 9682 grammar and CSV validation. The probes contradict it on `.regexp` anchoring (RFC 8610 §3.8.3), `.cborseq`, `uint`/`number` prelude semantics, unwrap in maps, optional groups and closed maps under group choices. The feature matrix is not CI-tested: `default-features = false` with `std, cbor, json` fails to compile, as does omitting `ast-span`.
- **Fork difficulty.** About 27,000 lines of Rust: a 6,088-line CBOR validator built as a stateful visitor with 210 `add_error(format!(…))` sites, plus a pest grammar and a 4,669-line bridge. The structural problems are map and group-choice matching, eager error formatting and `usize` ranges on wasm32. Fixing them touches the core matching logic, not edges, and upstream is mid-refactor (pest migration, modules draft, 1.0 API work). A fork would diverge quickly.

## 8. Fit with Bindle beyond correctness

- **Double decoding.** The strict codec must run first, for profile conformance. The crate then re-decodes the same bytes into its own `Value` tree, losing our types (`BindleDecimal`, `NDArray`, `Float16Bytes`). Handlers still get their values from our codec, so the validator sees a different representation than the handler.
- **Result shaping.** `shapeContractResult` (conservative projection of results by the pinned schema) has no counterpart in the crate. It would remain JavaScript working over a CDDL AST we would also need in JavaScript.
- **Untrusted schemas.** Event-bus manifests are attacker-authored. Today they forbid `pattern`, require bounds and cap depth (events §2.2). The crate has no compile or validate budgets, recompiles regexes on every call, and `.abnf` builds a pest VM per validation. A bus-manifest profile would have to forbid most of CDDL in any case.

## 9. Recommendation

**Fall back to an in-house narrow CDDL profile.** CDDL becomes the schema language, but the validator is our own small JavaScript one. The `cddl` crate is used only as a development-time oracle, in a lint or CI script over schemas it is known to handle, and is never shipped. Do not adopt the crate as the production validator, with or without patches, at this time. Revisit after upstream 1.0, if a fuzz target, budgets, anchored regexps and closed-map coverage land.

### 9.1 In-house profile: scope estimate

"Bindle CDDL profile", rule-only and narrow, specified in a new `docs/spec` page:

- **Supported:**
  - type rules and group rules; `/` and `//`;
  - maps with text-literal keys (`name:` and `"name" =>`) and `tstr => T` tables; occurrences `?`, `*`, `+`, `n*m`;
  - arrays with positional entries, with occurrence indicators only where matching is deterministic (no backtracking);
  - literals (text; integers of any size as `bigint`; floats; `true`, `false`, `null`); integer ranges as exact bigints and float ranges;
  - the prelude subset: `any uint nint int integer biguint bignint bstr tstr float number bool null decfrac`;
  - tags only from the profile's allowed list (2, 3, 4, 40, 69–72, 77–79, 84–86);
  - controls `.size` (bytes), `.bits`, `.lt .le .gt .ge .eq .ne` (exact rational comparison, as `contract-values.mjs` does today), `.and`, `.within`, `.default` (annotation), `.cbor` (embedded strict decode);
  - `.regexp` limited to anchored I-Regexp (RFC 9485), and forbidden in event-bus manifests;
  - non-recursive generics.
- **Project controls** for what CDDL lacks: `.bindle-columns` (equal-length columns, maximum rows), `.bindle-unique`, and `.bindle-chars` (a code-point length, matching the current `maxLength` semantics). The names are provisional.
- **Excluded:** sockets (pinned contracts have no extension points), `.cborseq`, `.abnf`, `.pcre`, unwrap, cuts, non-text map keys, `.feature`.
- **Implementation.** Parser and resolver, about 600–800 lines. A validator over decoded JavaScript values with closed-map group matching, a step budget and depth limit, and errors carrying only `{path, reason}`, about 600–800 lines. Shaping by map group, about 150 lines. Total: about 1,400–1,800 lines, replacing about 500 lines of JSON-Schema-subset code across the three files. Tests: vectors (accept and refuse), RFC 8610 Appendix examples restricted to the profile, seeded differential tests against the crate natively on the agreed-correct subset, and chaos fuzzing at engine level. Rough effort: 3–5 focused agent days plus an independent review.
- **Where validation runs.** It is unchanged: after strict decode at the RPC routes, in `versionedContractProvider` (validate arguments, then shape results), in event-bus publish (`checkRecord`), and in the classifier and SDK argument checks. Compiled schemas are cached per artefact digest, as today. Bus payload checks become CBOR-typed, which closes CBOR RPC review M1 (bus payloads accepted CBOR-only values as JSON objects).
- **How contracts embed CDDL.** Contract artefacts stay JSON documents. A new contract version, published under a new URL (artefacts are immutable), carries `"cddl": "<text>"` and `x-methods` entries naming rules (`{"put": {"request": "put-request", "result": "put-result", …}}`) instead of JSON pointers. The version digest covers the text. Bus manifests carry `slot.bus.payload_cddl` with stricter bounds (no `.regexp`, every string and array bounded, at most 16 KiB).
- **Migration.** (1) Write and review the profile spec. (2) Implement the validator with vectors. (3) Republish the built-in contracts (object-storage, preferences v1/v2, profile, resource descriptor and scoping, app-messages, item-classification, signaling kinds) as CDDL versions. (4) Switch the bus manifests. (5) Remove `compileContractVersion`'s JSON-Schema walk, `contract-values.mjs`'s `x-*` keywords and `packages/events/schema.mjs`. With no real users yet, these can be clean breaks, logged in DEVLOG. Release gates: the profile spec signed off and an independent review of the validator.

### 9.2 If the owner prefers the crate ("adopt with patches")

**Required patches before any production use:**

- closed-map and group-choice coverage, optional groups, and the name-collision bug;
- `u64`/`i128` ranges on wasm32;
- anchored `.regexp` with correct escapes and compiled once per schema;
- the `ctrl.unwrap()` panic, plus an audit of the other reachable panics;
- lazy error construction that never formats the value (the 210 sites);
- a depth limit and pre-allocation length checks in the decoder (or validating the `Value` our codec produces, via a new entry point);
- validation from a named rule;
- `.cborseq` support.

That is a sizeable fork (an estimated 1–2 weeks, then continuing rebases against an API upstream says will break before 1.0). The integration would also need:

- **Vendoring.** A `vendor/cddl-wasm/` directory with `LICENSE` (MIT, copied from the crate) and a `PROVENANCE.json`. The provenance records the crate version, crates.io sha256, upstream commit, the patch series and its sha256, the pinned toolchain (`rust-toolchain.toml`), the `wasm-bindgen` and `wasm-opt` versions, the `--remap-path-prefix` flags, a build script, and the sha256 of the output. The file is loaded as `CompiledWasm`, as hash-wasm is.
- **Runtime rules.** Strict decode always first. An input-size cap per contract. Re-instantiate on any trap. Isolate memory monitored for the high-water problem.
- **CI.** A reproducible rebuild compared against the vendored hash.

Not recommended, because the in-house profile is about the same effort, ships no binary, works on our decoded types, and keeps the security-relevant semantics under our own review.

## 10. Evidence and environment

The scripts are in the session scratchpad (`…/scratchpad/cddl-study/`), not committed:

- `binding/` (study crate), `build.sh`, `load.mjs`
- `probes.mjs` (§3.1), `contracts.mjs` and `contracts/*.cddl` (§3.2)
- `differential.mjs` (§5), `fuzz.mjs` (§6)
- `bench-core.mjs`, `bench-node.mjs`, `mem.mjs`, `attr*.mjs` (§4)
- `workerd/run-workerd.mjs` (Miniflare)
- the native CLI build in `native-target/`

**Limitations:**

- one machine;
- a nightly rustc;
- local workerd timers in 1 ms steps;
- no production CPU accounting;
- cross-machine reproducibility not checked;
- upstream `main` (after 0.10.7) not tested.

Nothing here verifies production behaviour.
