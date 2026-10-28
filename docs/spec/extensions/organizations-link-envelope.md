# Link envelope (Organizations annex) — normative draft

> **Group:** Bindle extension
>
> **Status:** draft, 2026-10-28, provisional and unsigned (contacts and links spike CL-2, CR-LK1). The text is moved from links §1–§5, §8 and the generic part of §9, unchanged in substance, with the contact link type, audiences, response signing and the legacy `?sig=` form removed (CL-3). Organization and relation invitations use it locally behind flags, over the parser in `packages/links/envelope.mjs` (to move to `packages/orgs`, contacts spike CR-C2). Nothing is production-verified.
>
> **Covers:** the `bindle_meta` / `bindle_data` link query envelope used by the invitation link types of [Organizations](organizations.md) (§5.1, §9.4): parsing, the meta header and common claims, owner-side validity, tooling, processing order and results, and the handoff to the opener's provider.
>
> **Does not cover:** signed-object rules ([keys](../keys.md)); the meaning of each invitation type ([Organizations](organizations.md)); intent links ([intents](intents.md)); invitations between people ([Bindle Messaging §4](messaging.md#4-invitations)); capability-URL handling ([security](../security.md#capability-urls)).

This annex is part of the Organizations extension. A provider implements it only for the link types that Organizations defines. Its §1 to §5 keep the numbering of the former links draft; links §8 is §6 here, and the generic part of links §9 is §7. The former draft is kept, frozen, as [links](../superseded/links.md). MUST, SHOULD and MAY express draft requirements. Hosts under `.example` and identifiers under `https://spec.bindle.example/` are placeholders.

## 1. Terms

- **Link**: an absolute HTTPS URL whose query carries a `bindle_meta` parameter defined here.
- **Link type**: the `type` claim of a meta (§3.2). Organizations defines `…/links/org-invitation/v1` and `…/links/relation-invitation/v1`.
- **Owner host**: the origin serving the link path. It issued `bindle_meta` and is its only verifier.
- **Meta**: the `bindle_meta` value, a compact JWS signed by the link owner's locally registered key. It is the capability.
- **Data**: the `bindle_data` value, reserved (§4).
- **Tooling**: any software that reads a link without verifying it (scanners, apps, opener providers, previews).

## 2. Recognizing and parsing link parameters

A verifier MUST operate on the raw query string: the bytes after the first `?` and before any `#`. It splits that string on `&` only (`;` is not a separator) into components. A component's name is the text before its first `=`, or the whole component when it has no `=`. Empty components are ignored. Name percent-decoding means WHATWG percent-decode, which leaves invalid sequences such as `%zz` literal. Every route decision is taken only from this one parser. Implementations MUST share one parser module between edge and storage tiers rather than mixing it with `URLSearchParams`.

1. A component is a **Bindle parameter** if its name, after percent-decoding and ASCII lowercasing, begins with `bindle_`.
2. Every Bindle parameter name MUST be literally `bindle_meta` or `bindle_data`: lowercase and unencoded. Any other Bindle parameter (for example `bindle_x`, `Bindle_meta`, `bindle%5Fmeta`) MUST be rejected. Names are reserved for future versions; a verifier never ignores one it does not understand.
3. Each of the two names MUST appear at most once, and each MUST have `=` and a nonempty value. `bindle_data` without `bindle_meta` MUST be rejected.
4. Each value MUST match `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` as raw bytes. Percent-encoding, `+`, padding and whitespace are rejected, not decoded. A raw byte value is therefore identical to its decoded value.
5. Length limits: `bindle_meta` at most 4,096 characters; `bindle_data` at most 2,048; the complete request target at most 8,192 (a verifier handed an absolute URL MAY apply the limit to the whole URL, which is stricter). Hosts may apply smaller limits.
6. All other components (for example `utm_source`) are **unrelated parameters**. They are never signed, never interpreted, and never reflected into representations, redirects or delivered records. Their presence does not invalidate the link. A host MAY drop them when it scrubs the address bar.
7. Fragments are never Bindle parameters. Bindle values placed only in a fragment are not a link.

Failures in this section are `link_malformed` (§6).

## 3. `bindle_meta`

### 3.1 Signed-object profile

`bindle_meta` is a signed object under the core [compact JWS profile](../keys.md#3-compact-jws-profile) and [strict JSON rules](../keys.md#2-strict-json). Both of its algorithms, `ES256` and `EdDSA`, are permitted.

### 3.2 Header and common claims

The meta protected header is exactly `{"alg","kid","typ"}` with `alg` `ES256` or `EdDSA` and `typ` exactly `"bindle-link-meta+jwt"`. `kid` MUST identify an active key that the owner host registered for the link subject. The owner host never resolves a meta key through a remote document, header or the link itself.

Every meta payload contains these common members, plus the exact type-specific set its `type` defines:

| Member | Definition |
| --- | --- |
| `bindle` | Exactly the string `"link-meta"`. Its only purpose is confirming that the parameter is intended for Bindle. |
| `v` | Integer `1`, the envelope version. |
| `type` | Absolute HTTPS URI of at most 256 characters, identifying the link type and its version. |
| `iss` | The owner host's exact origin (`https://host[:port]`). |
| `aud` | The link's **canonical audience**: the exact origin plus path, without query, fragment or userinfo. |
| `jti` | The owner host's identifier for the underlying authority, such as an invitation record. |
| `iat`, `exp` | Safe-integer Unix seconds, `iat < exp`. |

`aud` is an HTTPS URL; a host configured for local development MAY issue `http://localhost` origins, which tooling MUST NOT present as verified (§5). `iss` MUST equal the owner host's **configured canonical origin**, never a value derived from a `Host` or forwarded header. The request's own origin MUST equal that origin; otherwise the request fails closed. `aud` MUST equal that origin concatenated with the request path exactly as the WHATWG URL parser serializes it. That parser removes dot segments, including `%2e%2e`. Beyond the parser there is no case folding, trailing-slash or percent-encoding normalization. A host whose proxy rewrites paths fails closed. Because unrelated parameters are excluded from `aud`, adding them never moves or breaks the link. Changing host or path does.

A meta carries no free-text title, description, badge or display-name member. Human-readable text comes from the owner host's own page and is attributed to its origin.

### 3.3 Owner-side validity

A valid meta has: correct grammar and profile; `typ`, `bindle`, `v`, `type` supported at this route; `iss`/`aud` matching; `exp` in the future; a live underlying authority whose **exact stored header and claims** equal the received ones; an active key; and a valid signature. A cryptographically valid signature over claims the host did not issue and store is not valid. An unknown `type` at a route is invalid. It is never downgraded to another type.

## 4. `bindle_data` (reserved)

No link type defines data, so every verifier rejects a `bindle_data` value (§6 step 3). The name stays reserved by §2. A future link type that defines data MUST define its format, algorithms and key authority, and MUST first add a row to the [signature-domain table](../keys.md#4-signature-domains). Data never expands meta authority.

## 5. Tooling (non-verifying readers)

Tooling MAY decode the second segment of `bindle_meta` to recognize a link, without verifying it. It MUST treat decoded content as **unverified**. The only identity it may present as the party involved is the origin in `aud`, after checking that `aud` is HTTPS and equals the URL's own origin and path. It MUST NOT present any meta member as attested by anyone other than that origin. It SHOULD NOT automatically dereference URIs found in meta. It MUST NOT treat an unknown `type` as a known one. Tooling cannot verify the owner's signature: link-signing keys have no public discovery profile.

## 6. Processing order and results

The owner host evaluates in this order and stops at the first failure.

| Step | Failure result |
| --- | --- |
| 1. §2 grammar, lengths, duplicates | `link_malformed` — 400 |
| 2. Meta profile, `typ`, magic, `v`, `type`, `iss`/`aud`, stored exact claims, key, signature, expiry, revocation | `link_invalid` — 401, uniform for all causes and disclosing no account, entity or invitation existence |
| 3. Any `bindle_data` (§4) | `link_malformed` — 400 |
| 4. Type-specific steps | As the link type defines |

A link type MAY give the step 2 result its own name, provided it stays uniform across every cause, including the type's own refusals such as a bound invitation opened by another principal (Organizations §5.1, `invitation_invalid`). Error bodies carry only the code and a fixed safe message.

Responses are `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and never vary on cookies. The [capability-URL](../security.md#capability-urls) rules apply to `bindle_meta` and `bindle_data`: neither value appears in access logs, traces, analytics, crash reports or notifications, and neither is placed in service-worker caches.

## 7. Opening a link at another provider

A link type whose invitee may be at another provider (Organizations §9.4) hands the link to the opener's provider as follows:

1. The opener names their provider. The page discovers its manifest as [protocol §2](../protocol.md#2-discovery-and-login) specifies and finds the acceptance endpoint the link type names. A discovery failure never causes a redirect.
2. The page performs a **top-level form POST** (`application/x-www-form-urlencoded`, exactly one field `link`) of the link URL: the canonical audience plus `bindle_meta` only, with no unrelated parameters. Before navigating, it tells the opener that the link, a capability, will be sent to that provider.
3. The incoming cross-site POST MUST NOT accept, sign or record anything. It carries no provider cookies under SameSite rules, and the provider MUST NOT relax SameSite to make it do so. It only renders a page.
4. Before rendering, the provider authenticates its user (re-authenticating if necessary), parses the meta without verifying it, and checks that `link` has exactly one query component, `bindle_meta`; that `aud` is HTTPS and equals `link`'s origin and path; and that `type` is supported.
5. The page is served with `frame-ancestors 'none'`. It prominently names the `aud` origin, highlighting its registrable domain.
6. Any effect happens only on a same-origin, CSRF-protected, per-user rate-limited POST after an explicit user action. The provider constructs any return target only from the meta; there is no caller-supplied return URL. Cancellation sends nothing.

## 8. Conformance vectors

Fixed vectors with disposable test keys come from the former links vector set, [bindle-links.vectors.json](../../architecture/artefacts/bindle-links.vectors.json) (contacts spike CR-LK2), without their legacy `sig`, data and audience parts. They move to an Organizations vector file when the code is re-homed (CR-C2). Mapping from the former links §11 items:

| Case | Content | Former item |
| --- | --- | --- |
| 1 | A valid meta. | 1 |
| 2 | `typ`/`bindle` mismatch (`link_invalid`). | 4, without the meta/data swap |
| 3 | Duplicates, case and percent-encoded names, unknown `bindle_*`, `+`/`%` in values (`link_malformed`). | 5, without the `sig` conflict and the pure-JWS parts |
| 4 | Unrelated parameters ignored, and path changes rejected. | 6 |
| 5 | Length limits, a `bindle_meta` component without `=`, `;` separators, and dot segments in the path. | 12, without the `%73ig` marker |
| 6 | Any `bindle_data` on a current link type, and `bindle_data` without `bindle_meta`, are `link_malformed`. | new (replaces 4's swap and 14) |

Exact-bytes verification (former item 3), padding and noncanonical base64url are tested once, with the signed-object profile ([keys §5](../keys.md#5-conformance-vectors)). Former items 7 and 13 (`md`) are dropped with the data format, and items 2, 8 to 11 and 14 with audiences.

Vectors are tests of this draft, not evidence of deployment.
